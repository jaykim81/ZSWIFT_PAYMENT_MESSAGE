# yswiftpaymentmsg 개발 가이드

SAP Fiori Elements V4 List Report (스위프트 지급) 애플리케이션.

- OData V4 서비스: `zswift_r_payment_msg_ui` (메인 엔티티 `main`, 설정 엔티티 `LayoutConfig`)
- 메인 컬럼은 `PAYM_*`(기본 표시) + `XMLV3_*` / `MT101_*`(동적 표시) 필드로 구성

---

## MDC 테이블 컬럼 동적 표시/숨김 (핵심 패턴)

> **입력값에 따라 필드를 동적으로 켜고 끄는 범용 패턴**(월 범위, 접두어, 룩업 테이블 등
> 어떤 조건이든 전략만 갈아끼우는 방식)은 [docs/dynamic-field-visibility.md](docs/dynamic-field-visibility.md)에
> 별도 정리돼 있다. 아래는 이 앱(LayoutConfig/PAYM_)의 구체적 적용이다.

지급 매체(Pmedium)·은행그룹 등 조건에 따라 테이블 컬럼을 켜고 끌 때는
**반드시 `sap.ui.mdc.p13n.StateUtil`을 사용한다.** 아래 규칙을 지킬 것.

### 규칙 1 — 동적 후보 필드는 먼저 LineItem 애노테이션에 등록돼 있어야 한다

MDC 테이블은 `@com.sap.vocabularies.UI.v1.LineItem`(메타데이터의 `SAP__UI.LineItem`)에
나열된 필드만 컬럼 후보로 인식한다. 애노테이션에 없는 필드는 코드로 아무리 `visible:true`를
줘도 나타나지 않는다.

- 후보에 추가하려면: `webapp/annotations/annotation.xml` 또는 백엔드 CDS의 LineItem에 `DataField` 추가
- 처음부터 숨겨두고 싶으면 `Importance=Low`로 넣어두고 컨트롤러에서 숨김 처리
- 기본 표시 개수(현재 `PAYM_*` 10개)는 컨트롤러가 정하는 게 아니라 LineItem 순서/구성이 정한다

### 규칙 2 — 값이 비면 십중팔구 "직접 visible만 토글"한 것

컬럼을 DOM/컨트롤 레벨에서 직접 보이게만 하면 OData `$select`에 필드가 안 들어가
**컬럼은 보이는데 값이 빈다.** `StateUtil.applyExternalState`는 개인화 상태를 바꿔
테이블을 리바인드하므로 `$select`에 필드가 포함되고 값까지 함께 조회된다.
→ 컬럼 표시/숨김은 항상 StateUtil을 통한다.

### 규칙 3 — 조회할 때마다 이전 동적 컬럼을 정리한다

새 조건으로 조회하면 이전 조건의 동적 컬럼이 남을 수 있다. 현재 상태를
`retrieveExternalState`로 읽어 "기본 접두어(`PAYM_`)가 아니고 이번 결과에도 없는" 컬럼은
숨기고, 이번 결과 필드는 표시하는 diff를 만들어 한 번에 적용한다.

### 규칙 4 — 존재하지 않는 조합은 메타모델로 걸러낸다

설정 테이블(LayoutConfig)에는 있지만 엔티티에 없는 필드 조합이 나올 수 있다.
`oMetaModel.getObject("/main/<필드명>")`로 존재 여부를 확인하고, 없으면 로그만 남기고 건너뛴다.
(단, 규칙 1대로 LineItem에도 있어야 실제로 표시된다.)

---

## 컨트롤러 확장 등록

`webapp/manifest.json`의 `sap.ui5`에 확장을 등록한다.

```json
"extends": {
  "extensions": {
    "sap.ui.controllerExtensions": {
      "sap.fe.templates.ListReport.ListReportController": {
        "controllerName": "yspert.yswiftpaymentmsg.ext.controller.ListReportExt"
      }
    }
  }
}
```

테이블/필터바 ID는 FE 규칙을 따른다 (contextPath가 `/main`인 경우):

```js
_getTable:     function () { return this.base.getView().byId("fe::table::main::LineItem"); },
_getFilterBar: function () { return this.base.getView().byId("fe::FilterBar::main"); },
```

---

## 코드 스니펫

### 초기 표시: 기본 접두어 컬럼만 남기고 숨김

```js
sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/mdc/p13n/StateUtil",
    "sap/base/Log"
], function (ControllerExtension, StateUtil, Log) {
    "use strict";

    var BASE_FIELD_PREFIX = "PAYM_"; // 항상 기본으로 보여야 하는 컬럼의 접두어

    return ControllerExtension.extend("...ext.controller.ListReportExt", {
        override: {
            onAfterRendering: function () {
                if (this._bHooked) { return; }        // 중복 바인딩 방지
                var oTable = this._getTable();
                var oFilterBar = this._getFilterBar();
                if (!oTable || !oFilterBar) { return; }
                this._bHooked = true;

                oFilterBar.attachSearch(this._onSearch, this);

                oTable.initialized()
                    .then(function () { return StateUtil.retrieveExternalState(oTable); })
                    .then(function (oState) {
                        var aHide = (oState.items || [])
                            .filter(function (o) { return o.name.indexOf(BASE_FIELD_PREFIX) !== 0; })
                            .map(function (o) { return { name: o.name, visible: false }; });
                        if (aHide.length) {
                            return StateUtil.applyExternalState(oTable, { items: aHide });
                        }
                    })
                    .catch(function (e) { Log.error("Initial column setup failed", e); });
            }
        }
    });
});
```

### 동적 표시/숨김: diff 계산 후 한 번에 적용 (재사용 함수)

```js
// aFieldNames: 이번 조회 결과로 보여야 할 동적 컬럼명 배열
_applyDynamicColumns: function (aFieldNames) {
    var oTable = this._getTable();
    var oMetaModel = this.base.getView().getModel().getMetaModel();

    // 규칙 4 — 엔티티에 실제 존재하는 필드만 대상으로 (없으면 로그만)
    var aValid = aFieldNames.filter(function (sName) {
        var bExists = !!oMetaModel.getObject("/main/" + sName);
        if (!bExists) { Log.warning("field not in entity, skipped: " + sName); }
        return bExists;
    });

    // 규칙 3 — 현재 상태를 읽어 diff 구성
    return StateUtil.retrieveExternalState(oTable).then(function (oState) {
        var aItems = [];
        // 기본 접두어가 아니고 이번 결과에 없는 동적 컬럼 → 숨김
        (oState.items || []).forEach(function (o) {
            if (o.name.indexOf(BASE_FIELD_PREFIX) !== 0 && aValid.indexOf(o.name) === -1) {
                aItems.push({ name: o.name, visible: false });
            }
        });
        // 이번 결과 필드 → 표시
        aValid.forEach(function (sName) { aItems.push({ name: sName, visible: true }); });

        // 규칙 2 — StateUtil로 적용해야 리바인드되어 값까지 $select에 포함됨
        if (aItems.length) {
            return StateUtil.applyExternalState(oTable, { items: aItems });
        }
    });
}
```

### 설정 엔티티 조회 후 조합 필드 만들기 (예: LayoutConfig)

```js
_onSearch: function () {
    var oView = this.base.getView();
    var m = this._getFilterBar().getConditions();
    var sBukrs = this._getConditionValue(m, "PAYM_BUKRS");
    var sBankg = this._getConditionValue(m, "PAYM_BANKG");

    if (!sBukrs || !sBankg) {
        return this._applyDynamicColumns([]); // 조건 없으면 기본 컬럼만
    }

    var oLB = oView.getModel().bindList("/LayoutConfig", undefined, undefined, [
        new Filter("CompanyCode", FilterOperator.EQ, sBukrs),
        new Filter("Bankgr",      FilterOperator.EQ, sBankg)
    ], { $$groupId: "$auto" });

    var that = this;
    oLB.requestContexts(0, 1000).then(function (aCtx) {
        var aFields = [];
        aCtx.forEach(function (c) {
            var o = c.getObject();
            var sName = (o.Pmedium + "_" + o.FieldName).toUpperCase(); // 예: XMLV3 + PYMT_TYPE → XMLV3_PYMT_TYPE
            if (aFields.indexOf(sName) === -1) { aFields.push(sName); }  // 중복 제거, 순서 유지
        });
        return that._applyDynamicColumns(aFields);
    }).catch(function (e) { Log.error("LayoutConfig read failed", e); });
}
```

### 필터 조건값 안전하게 읽기

```js
_getConditionValue: function (mConditions, sFieldName) {
    var a = mConditions[sFieldName];
    if (a && a.length && a[0].values && a[0].values.length) {
        return a[0].values[0];
    }
    return null;
}
```

전체 구현은 [webapp/ext/controller/ListReportExt.controller.js](webapp/ext/controller/ListReportExt.controller.js) 참고.

---

## 로컬 실행 / 테스트

- 실백엔드(`172.30.1.250:44360`)는 자체서명 인증서 + 인증이 필요해 브라우저 자동화로는 접근 불가.
  UI 동작 검증은 **목서버로 한다**: `npm run start-mock` (`ui5-mock.yaml`, sap-fe-mockserver).
- 목데이터: `webapp/localService/mainService/data/{main,LayoutConfig}.json`.
  동적 컬럼 시나리오를 테스트하려면 여기에 케이스를 추가한다 (예: 1000/BOFA → XMLV3, 2000/CITI → MT101).
- 실백엔드 대상 실행은 `npm start`.
- 테스트 대표 값: **회사코드 `1000`, 은행그룹 `BOFA`** → `XMLV3_INSTDAMT`, `XMLV3_PYMT_TYPE` 컬럼이 값과 함께 표시되면 정상.
