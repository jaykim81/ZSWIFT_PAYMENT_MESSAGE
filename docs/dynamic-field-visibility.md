# 입력값 기반 동적 필드 표시/숨김 — 범용 가이드

MDC 테이블(FE V4)에서 **사용자 입력값에 따라 컬럼을 켜고 끄는** 모든 경우에 쓰는 공통 패턴.
예: `202606`을 입력하면 1~6월 필드만 보이고 7~12월은 숨김, 지급매체에 따라 해당 필드만 표시 등.

핵심은 두 가지를 **분리**하는 것이다.

1. **엔진(engine)** — "이번에 보여야 할 필드 목록"을 받아 테이블에 반영하는 로직. **항상 동일하다.**
2. **전략(strategy)** — 입력값으로부터 "어떤 필드를 보여줄지" 계산하는 로직. **케이스마다 다르다.**

전략만 갈아끼우면 어떤 조건 기반 표시/숨김도 같은 방식으로 처리된다.

---

## 개념: 관리 대상(managed) vs 보호 대상(protected)

동적으로 켜고 끄는 컬럼(**관리 대상**)과, 항상 그대로 둬야 하는 컬럼(**보호 대상**, 예: 키/기본 정보)을
구분해야 한다. 엔진은 **관리 대상만 건드리고 보호 대상은 절대 손대지 않는다.**

관리 대상 판별은 전략이 함수(`fnIsManaged`)로 넘긴다. 예:
- 접두어: `name.indexOf("PAYM_") !== 0` → PAYM_ 아닌 것만 관리
- 정규식: `/^AMT_M\d{2}$/.test(name)` → 월별 금액 필드만 관리
- 목록: `MANAGED_FIELDS.indexOf(name) !== -1`

---

## 4가지 불변 규칙 (반드시 지킬 것)

1. **표시/숨김은 `StateUtil`로만 한다.** 컨트롤을 직접 `setVisible`하면 OData `$select`에서
   필드가 빠져 **컬럼은 보이는데 값이 빈다.** `StateUtil.applyExternalState`는 테이블을
   리바인드하므로 `$select`에 포함되어 값까지 같이 조회된다.
2. **동적 후보 필드는 먼저 LineItem 애노테이션에 등록돼 있어야 한다.** 애노테이션에 없는
   필드는 `visible:true`를 줘도 나타나지 않는다. (`annotations/annotation.xml` 또는 백엔드 CDS)
3. **입력이 바뀔 때마다 이전 상태를 정리한다.** 관리 대상 중 이번에 보이면 안 되는 컬럼은 숨긴다.
   보호 대상은 diff에 넣지 않는다.
4. **엔티티에 없는 필드는 걸러낸다.** 전략이 만든 필드명이 실제 엔티티에 있는지
   `oMetaModel.getObject("/<엔티티>/<필드>")`로 확인 후 통과시킨다.

---

## 엔진 (그대로 재사용)

```js
sap.ui.define([
    "sap/ui/mdc/p13n/StateUtil",
    "sap/base/Log"
], function (StateUtil, Log) {
    "use strict";

    /**
     * 테이블 컬럼 표시/숨김을 입력값 기반으로 반영하는 범용 엔진.
     * @param {sap.ui.mdc.Table} oTable  대상 테이블
     * @param {string[]} aShowFields     이번에 "보여야 할" 필드명 배열 (전략이 계산)
     * @param {function} fnIsManaged     name → boolean. 이 컬럼이 동적 관리 대상인지 판별
     *                                   (false면 엔진이 절대 건드리지 않음 = 보호 대상)
     * @returns {Promise}
     */
    function applyFieldVisibility(oTable, aShowFields, fnIsManaged) {
        var mShow = {};
        aShowFields.forEach(function (n) { mShow[n] = true; });

        return StateUtil.retrieveExternalState(oTable).then(function (oState) {
            var aItems = [];

            // (규칙 3) 관리 대상인데 이번에 보이면 안 되고, 현재 떠있는 컬럼 → 숨김
            (oState.items || []).forEach(function (o) {
                if (fnIsManaged(o.name) && !mShow[o.name]) {
                    aItems.push({ name: o.name, visible: false });
                }
            });

            // 이번에 보여야 할 컬럼 → 표시 (테이블에 아직 없으면 추가됨)
            aShowFields.forEach(function (n) {
                aItems.push({ name: n, visible: true });
            });

            // (규칙 1) StateUtil로 적용 → 리바인드되어 $select에 값 포함
            if (aItems.length) {
                return StateUtil.applyExternalState(oTable, { items: aItems });
            }
        }).catch(function (e) {
            Log.error("applyFieldVisibility failed", e);
        });
    }

    /** (규칙 4) 엔티티에 실제 존재하는 필드만 통과 */
    function keepExistingFields(oMetaModel, sEntity, aFields) {
        return aFields.filter(function (sName) {
            var bExists = !!oMetaModel.getObject("/" + sEntity + "/" + sName);
            if (!bExists) { Log.warning("field not in entity, skipped: " + sName); }
            return bExists;
        });
    }

    return { applyFieldVisibility: applyFieldVisibility, keepExistingFields: keepExistingFields };
});
```

> 위를 `webapp/ext/lib/ColumnVisibility.js` 같은 모듈로 두고 컨트롤러에서 `require`해 쓰면
> 여러 뷰에서 공유할 수 있다. (지금 `ListReportExt.controller.js`의 `_applyDynamicColumns`가
> 이 엔진의 "접두어 + 목록" 특화 버전이다.)

---

## 전략 예시

전략은 "**입력값 → 보여줄 필드 배열 + 관리 대상 판별 함수**"만 만들면 된다.

### 전략 A — 월 범위 (`202606` → 1~6월 표시, 7~12월 숨김)

```js
// 관리 대상: AMT_M01 ~ AMT_M12 (월별 금액 필드)
_showMonthsUpTo: function (sYYYYMM) {
    var iMonth = parseInt(String(sYYYYMM || "").slice(4, 6), 10) || 0; // "202606" → 6
    var aManaged = [], aShow = [];
    for (var i = 1; i <= 12; i++) {
        var sField = "AMT_M" + (i < 10 ? "0" + i : i);   // AMT_M01 ...
        aManaged.push(sField);
        if (i <= iMonth) { aShow.push(sField); }          // 입력 월까지만 표시
    }
    var fnIsManaged = function (name) { return aManaged.indexOf(name) !== -1; };
    return applyFieldVisibility(this._getTable(), aShow, fnIsManaged);
}
```

### 전략 B — 접두어 구분 (기본 컬럼은 항상, 나머지는 조건부)

```js
// 관리 대상: 접두어가 기본(PAYM_)이 아닌 모든 컬럼
_showByPrefix: function (aShowFields) {
    var fnIsManaged = function (name) { return name.indexOf("PAYM_") !== 0; };
    return applyFieldVisibility(this._getTable(), aShowFields, fnIsManaged);
}
```

### 전략 C — 룩업 테이블 조회 (예: LayoutConfig)

```js
// 설정 엔티티를 입력 조건으로 조회해 표시할 필드를 결정
_showFromConfig: function (sBukrs, sBankg) {
    var oView = this.base.getView();
    var oMetaModel = oView.getModel().getMetaModel();
    var that = this;

    var oLB = oView.getModel().bindList("/LayoutConfig", undefined, undefined, [
        new Filter("CompanyCode", FilterOperator.EQ, sBukrs),
        new Filter("Bankgr",      FilterOperator.EQ, sBankg)
    ], { $$groupId: "$auto" });

    return oLB.requestContexts(0, 1000).then(function (aCtx) {
        var aFields = [];
        aCtx.forEach(function (c) {
            var o = c.getObject();
            var sName = (o.Pmedium + "_" + o.FieldName).toUpperCase(); // XMLV3 + PYMT_TYPE → XMLV3_PYMT_TYPE
            if (aFields.indexOf(sName) === -1) { aFields.push(sName); }
        });
        aFields = keepExistingFields(oMetaModel, "main", aFields);  // (규칙 4)
        var fnIsManaged = function (name) { return name.indexOf("PAYM_") !== 0; };
        return applyFieldVisibility(that._getTable(), aFields, fnIsManaged);
    });
}
```

---

## 언제 실행하나 (트리거)

- **조회(GO) 버튼**: `oFilterBar.attachSearch(fn)` — 조회 조건 확정 시점. 조건 기반 표시에 가장 흔함.
- **특정 필드 값 변경 즉시**: 해당 필터 필드의 change 이벤트에 연결.
- **초기 진입**: `onAfterRendering` + `oTable.initialized()` 이후 1회 (중복 바인딩 방지 플래그 사용).

```js
onAfterRendering: function () {
    if (this._bHooked) { return; }
    var oTable = this._getTable(), oFilterBar = this._getFilterBar();
    if (!oTable || !oFilterBar) { return; }
    this._bHooked = true;
    oFilterBar.attachSearch(this._onSearch, this);
    // 초기 표시 상태를 여기서 한 번 잡아준다 (전략 호출)
}
```

---

## 자주 겪는 함정

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| 컬럼은 보이는데 값이 빔 | `setVisible` 직접 토글로 `$select` 누락 | `StateUtil.applyExternalState` 사용 (규칙 1) |
| `visible:true` 줘도 컬럼이 안 나옴 | LineItem 애노테이션에 필드 없음 | 애노테이션/CDS에 DataField 추가 (규칙 2) |
| 이전 조회의 컬럼이 남음 | diff에서 숨김 처리 누락 | 관리 대상 중 미표시분을 `visible:false`로 (규칙 3) |
| 기본 컬럼까지 사라짐 | `fnIsManaged`가 보호 대상까지 true 반환 | 판별 함수 범위 축소 |
| 콘솔에 "field not in entity" | 전략이 만든 필드명이 엔티티에 없음 | `keepExistingFields`로 사전 필터 (규칙 4) |

---

이 앱의 실제 구현 사례는 [../CLAUDE.md](../CLAUDE.md)와
[webapp/ext/controller/ListReportExt.controller.js](../webapp/ext/controller/ListReportExt.controller.js) 참고.
