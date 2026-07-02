# ZSWIFT_PAYMENT_MESSAGE (yswiftpaymentmsg)

SAP Fiori Elements **List Report** (OData V4) — 스위프트 지급 메시지 조회 화면.

이 문서는 **"조회 조건(회사코드·은행그룹)에 따라 테이블 필드를 동적으로 표시/숨김"** 기능을
**AI 없이 손으로 처음부터 다시 구현**할 수 있도록 작업 과정을 단계별로 설명한다.
읽는 순서대로 따라 하면 동일한 결과를 만들 수 있다.

---

## 1. 목표 (요구사항)

1. 처음에는 `PAYM_`로 시작하는 기본 필드만 테이블에 보인다.
2. **회사코드 + 은행그룹**을 입력하고 **조회(GO)** 를 누르면,
   `LayoutConfig` 엔티티를 그 조건(`CompanyCode`, `Bankgr`)으로 조회한다.
3. 조회 결과의 각 행에서 **`Pmedium + '_' + FieldName`** 으로 필드명을 조합한다.
   - 예: `Pmedium = XMLV3`, `FieldName = PYMT_TYPE` → **`XMLV3_PYMT_TYPE`**
4. 조합된 필드를 테이블에 **추가로 보이게** 한다. `PAYM_` 필드는 항상 유지한다.
5. 조건을 바꿔 다시 조회하면, 이전 조건의 동적 필드는 **숨기고** 새 조건 필드만 보인다.

### ⚠️ 이 작업에서 가장 중요한 함정

> **필드를 단순히 "보이게"만 하면, 컬럼은 나타나지만 값이 비어 있다.**
> Fiori Elements 테이블(MDC)은 화면에 보이는 컬럼만 OData `$select`에 넣어 데이터를 가져온다.
> 컨트롤을 직접 `setVisible(true)` 하면 `$select`에 필드가 추가되지 않아 값이 안 들어온다.
>
> **해결: 컬럼 표시/숨김을 반드시 `sap.ui.mdc.p13n.StateUtil` 로 처리한다.**
> StateUtil은 개인화(personalization) 상태를 바꾸면서 테이블을 **리바인드**하므로,
> `$select`에 필드가 포함되어 **값까지 함께 조회된다.** (이 프로젝트에서 계속 실패하던 원인이 이것)

---

## 2. 사전 이해 — 컬럼은 어디서 결정되는가

동적으로 켜려는 필드는 **먼저 `UI.LineItem` 애노테이션에 등록돼 있어야 한다.**
MDC 테이블은 LineItem에 나열된 필드만 "컬럼 후보"로 인식한다. 애노테이션에 없는 필드는
코드에서 `visible:true`를 줘도 **절대 나타나지 않는다.**

- 애노테이션 위치: `webapp/annotations/annotation.xml` (또는 백엔드 CDS의 `@UI.LineItem`)
- 메타데이터에서는 `webapp/localService/mainService/metadata.xml`의 `SAP__UI.LineItem` Collection
- 이 앱은 LineItem에 `PAYM_*` 필드(High) + `XMLV3_*` / `MT101_*` 필드(Low)가 이미 다 들어 있다.
  → 그래서 코드로 숨겼다가 켜는 것만으로 동작한다. **새 필드를 쓰려면 먼저 LineItem에 추가할 것.**

즉 역할 분담:

| 무엇을 | 어디서 정하나 |
| --- | --- |
| 어떤 필드가 컬럼 후보가 될 수 있나 | `UI.LineItem` 애노테이션 |
| 처음에 무엇을 보여주나 | 컨트롤러 확장 (아래) |
| 조회 후 무엇을 추가로 보여주나 | 컨트롤러 확장 (아래) |

---

## 3. 관련 엔티티 (metadata.xml)

**main** (테이블 대상, 키):
`PAYM_BUKRS`(회사코드), `PAYM_BANKG`(은행그룹), `PAYM_LAUFD`, `PAYM_VBLNR` … + `XMLV3_*`, `MT101_*` 필드 다수

**LayoutConfig** (표시 규칙 설정 테이블):

| 필드 | 의미 |
| --- | --- |
| `CompanyCode` | 회사코드 (조회 조건, main의 `PAYM_BUKRS`와 매칭) |
| `Bankgr` | 은행그룹 (조회 조건, main의 `PAYM_BANKG`와 매칭) |
| `Pmedium` | 지급매체 (예: `XMLV3`, `MT101`) — 조합 접두어 |
| `FieldName` | 필드명 (예: `PYMT_TYPE`, `INSTDAMT`) — 조합 뒷부분 |
| `Gtype`, `Seqno`, `Hidden`, `doctype` … | (현재 미사용, 확장 여지) |

조합 규칙: **`(Pmedium + "_" + FieldName).toUpperCase()`**

---

## 4. 단계별 구현

### Step 1 — 컨트롤러 확장 파일 생성

`webapp/ext/controller/ListReportExt.controller.js` 를 만든다. (폴더 `ext/controller`도 함께 생성)

`ControllerExtension`을 상속하고, List Report 컨트롤러의 라이프사이클 훅
(`onInit`, `onAfterRendering`)을 override 한다.

### Step 2 — manifest.json에 확장 등록

`webapp/manifest.json`의 `"sap.ui5"` 안(최상단)에 다음을 추가한다.

```json
"extends": {
  "extensions": {
    "sap.ui.controllerExtensions": {
      "sap.fe.templates.ListReport.ListReportController": {
        "controllerName": "yspert.yswiftpaymentmsg.ext.controller.ListReportExt"
      }
    }
  }
},
```

> `controllerName`의 앞부분(`yspert.yswiftpaymentmsg`)은 `sap.app.id`와 같아야 한다.

### Step 3 — 테이블/필터바 핸들 얻기

FE V4의 표준 ID 규칙을 쓴다 (contextPath가 `/main`인 경우):

```js
_getTable:     function () { return this.base.getView().byId("fe::table::main::LineItem"); },
_getFilterBar: function () { return this.base.getView().byId("fe::FilterBar::main"); },
```

> ID가 확실치 않으면 실행 후 콘솔에서
> `sap.ui.core.Element.registry.filter(e => e.isA && e.isA("sap.ui.mdc.Table"))` 로 확인.

### Step 4 — 초기 표시: PAYM_ 이외 컬럼 전부 숨김

`onAfterRendering`에서 (딱 1번만) 실행한다.
`StateUtil.retrieveExternalState`로 현재 컬럼 상태를 읽고, 접두어가 `PAYM_`이 아닌 것들을
`{name, visible:false}`로 모아 `applyExternalState`로 숨긴다.

```js
onAfterRendering: function () {
    if (this._bHooked) { return; }          // 중복 실행 방지
    var oTable = this._getTable();
    var oFilterBar = this._getFilterBar();
    if (!oTable || !oFilterBar) { return; }
    this._bHooked = true;

    oFilterBar.attachSearch(this._onSearch, this);   // Step 5

    var that = this;
    oTable.initialized()
        .then(function () { return StateUtil.retrieveExternalState(oTable); })
        .then(function (oState) {
            var aHide = (oState.items || [])
                .filter(function (o) { return o.name.indexOf("PAYM_") !== 0; })
                .map(function (o) { return { name: o.name, visible: false }; });
            if (aHide.length) {
                return StateUtil.applyExternalState(oTable, { items: aHide });
            }
        });
}
```

### Step 5 — 조회(GO) 이벤트 연결

`oFilterBar.attachSearch(fn)` (Step 4에서 이미 연결) — 사용자가 조회를 누를 때 호출된다.
필터 조건에서 회사코드/은행그룹 값을 꺼낸다.

```js
_getConditionValue: function (mConditions, sFieldName) {
    var a = mConditions[sFieldName];
    return (a && a.length && a[0].values && a[0].values.length) ? a[0].values[0] : null;
},

_onSearch: function () {
    var oView = this.base.getView();
    var m = this._getFilterBar().getConditions();
    var sBukrs = this._getConditionValue(m, "PAYM_BUKRS");
    var sBankg = this._getConditionValue(m, "PAYM_BANKG");

    if (!sBukrs || !sBankg) {          // 조건 없으면 기본 컬럼만 유지
        return this._applyDynamicColumns([]);
    }
    // Step 6 으로
}
```

### Step 6 — LayoutConfig 조회 + 필드명 조합

`bindList`로 `/LayoutConfig`를 조건 걸어 읽고, 각 행에서 `Pmedium_FieldName`을 만든다(중복 제거).

```js
    var oLB = oView.getModel().bindList("/LayoutConfig", undefined, undefined, [
        new Filter("CompanyCode", FilterOperator.EQ, sBukrs),
        new Filter("Bankgr",      FilterOperator.EQ, sBankg)
    ], { $$groupId: "$auto" });

    var that = this;
    oLB.requestContexts(0, 1000).then(function (aCtx) {
        var aFields = [];
        aCtx.forEach(function (c) {
            var o = c.getObject();
            var sName = (o.Pmedium + "_" + o.FieldName).toUpperCase();  // XMLV3 + PYMT_TYPE → XMLV3_PYMT_TYPE
            if (aFields.indexOf(sName) === -1) { aFields.push(sName); }
        });
        return that._applyDynamicColumns(aFields);      // Step 7
    });
```

> `requestContexts(0, 1000)` — 설정 행이 1000개를 넘을 일이 없다고 보고 한 번에 읽는다.
> import 필요: `sap/ui/model/Filter`, `sap/ui/model/FilterOperator`.

### Step 7 — 표시/숨김 반영 (핵심)

이 함수가 **값까지 나오게 하는 핵심**이다. 3가지를 한다.

1. **(선택) 엔티티 존재 검증** — 설정에는 있으나 엔티티/LineItem에 없는 조합은 걸러 로그만 남긴다.
   `oMetaModel.getObject("/main/<필드>")`
2. **이전 상태 정리** — 현재 보이는 컬럼 중 `PAYM_`이 아니고 이번 결과에도 없는 것은 숨긴다.
3. **이번 필드 표시** — `{name, visible:true}`로 추가. → **StateUtil이 리바인드하며 `$select`에 포함 → 값 조회됨.**

```js
_applyDynamicColumns: function (aFieldNames) {
    var oTable = this._getTable();
    var oMetaModel = this.base.getView().getModel().getMetaModel();

    // 1) 엔티티에 실제 존재하는 필드만
    var aValid = aFieldNames.filter(function (sName) {
        var bExists = !!oMetaModel.getObject("/main/" + sName);
        if (!bExists) { Log.warning("field not in entity, skipped: " + sName); }
        return bExists;
    });

    return StateUtil.retrieveExternalState(oTable).then(function (oState) {
        var aItems = [];
        // 2) PAYM_ 아니고 이번 결과에 없는, 현재 보이는 컬럼 → 숨김
        (oState.items || []).forEach(function (o) {
            if (o.name.indexOf("PAYM_") !== 0 && aValid.indexOf(o.name) === -1) {
                aItems.push({ name: o.name, visible: false });
            }
        });
        // 3) 이번 결과 필드 → 표시
        aValid.forEach(function (sName) { aItems.push({ name: sName, visible: true }); });

        if (aItems.length) {
            return StateUtil.applyExternalState(oTable, { items: aItems }); // 리바인드 → 값 포함
        }
    });
}
```

### Step 8 — import 목록

`sap.ui.define`의 의존성:

```js
sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/mdc/p13n/StateUtil",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",   // (선택) 조회 결과를 화면 모델에 노출할 때
    "sap/base/Log"
], function (ControllerExtension, StateUtil, Filter, FilterOperator, JSONModel, Log) { ... });
```

전체 완성본은 [`webapp/ext/controller/ListReportExt.controller.js`](webapp/ext/controller/ListReportExt.controller.js) 참고.

---

## 5. 왜 이렇게 동작하는가 (원리 요약)

```
[조회 버튼] --attachSearch--> _onSearch
      |
      |  회사코드/은행그룹 읽기
      v
  bindList("/LayoutConfig", 조건) --requestContexts--> 설정 행들
      |
      |  Pmedium + "_" + FieldName (중복 제거)
      v
  _applyDynamicColumns(필드배열)
      |
      |  retrieveExternalState (현재 컬럼 상태)
      |  → 이전 동적컬럼 숨김 + 이번 필드 표시 (diff)
      v
  applyExternalState  ──► 테이블 리바인드 ──► $select에 필드 포함 ──► 컬럼 + 값 동시 표시 ✅
```

핵심 한 줄: **표시/숨김을 StateUtil로 하면 리바인드되어 `$select`에 들어가 값이 나온다.**

---

## 6. 로컬 실행 & 테스트

실백엔드는 인증이 필요하므로, UI 로직 검증은 **목서버**로 하는 것을 권장한다.

```bash
npm install
npm run start-mock     # ui5-mock.yaml, sap-fe-mockserver 사용 (목데이터)
npm start              # 실백엔드 대상 (인증 필요)
```

- 목데이터: `webapp/localService/mainService/data/{main,LayoutConfig}.json`
  동적 컬럼 케이스를 여기에 추가해 테스트한다.
- **대표 테스트 값: 회사코드 `1000`, 은행그룹 `BOFA`**
  → `XMLV3_INSTDAMT`, `XMLV3_PYMT_TYPE` 컬럼이 **값과 함께** 나오면 정상.
- 조건을 `2000` / `CITI`로 바꿔 조회하면 XMLV3 컬럼이 사라지고 `MT101_PURPOSE_CODE`로 교체된다
  (이전 상태 정리가 되는지 확인용).

---

## 7. 체크리스트 (손으로 재현할 때)

- [ ] 켜려는 필드가 `UI.LineItem` 애노테이션에 있는가? (없으면 먼저 추가)
- [ ] `manifest.json`에 컨트롤러 확장을 등록했는가?
- [ ] 표시/숨김을 **컨트롤 직접 조작이 아니라 `StateUtil`로** 하는가? (값 누락 방지)
- [ ] 조회할 때마다 이전 동적 컬럼을 **숨김 처리(diff)** 하는가?
- [ ] `PAYM_`(기본) 컬럼은 diff에서 제외해 항상 유지되는가?
- [ ] 존재하지 않는 조합을 메타모델로 걸러내는가?

---

## 8. 범용 패턴으로 확장

입력값에 따라 필드를 켜고 끄는 방식은 이 앱(LayoutConfig)뿐 아니라 어디에나 쓸 수 있다.
"엔진(표시 반영) + 전략(무엇을 보여줄지 계산)"으로 분리한 **범용 가이드**는 아래에 정리돼 있다.

- [`docs/dynamic-field-visibility.md`](docs/dynamic-field-visibility.md)
  — 월 범위(`202606` → 1~6월 표시), 접두어, 룩업 테이블 등 전략별 예시 + 함정 표
- [`CLAUDE.md`](CLAUDE.md) — 이 앱 기준 규칙 요약

---

## 9. 전송 시뮬레이션 미리보기 (sendToBankSimu → 팝업)

행을 선택하고 **"전송 시뮬레이션"** 버튼을 누르면, 바운드 액션 `sendToBankSimu`를 호출해
반환된 전문(**XMLV3** 또는 **MT101** 문자열, `ZSWIFT_S_XML_RETURN.FileContent`)을 **팝업으로 미리보기**한다.

### 왜 커스텀 액션인가

표준 `DataFieldForAction`(예: 이미 있는 "전송"/`sendToBank`)은 액션을 실행할 뿐,
**반환 문자열을 팝업으로 띄워주지 못한다.** 그래서 반환값을 직접 받아 Dialog에 뿌리는
**커스텀 액션 + 핸들러 모듈** 방식으로 구현한다.

### Step 1 — manifest에 커스텀 액션 등록

테이블(`@UI.v1.LineItem`)의 `controlConfiguration`에 `actions`를 추가한다.
`press`/`enabled`는 핸들러 **모듈 경로 문자열**(`<appId>.<folder>.<file>.<method>`)로 지정한다.

```json
"controlConfiguration": {
  "@com.sap.vocabularies.UI.v1.LineItem": {
    "tableSettings": { "type": "GridTable" },
    "actions": {
      "sendToBankSimu": {
        "press":   "yspert.yswiftpaymentmsg.ext.CustomActions.onSendToBankSimu",
        "enabled": "yspert.yswiftpaymentmsg.ext.CustomActions.enabledSingleSelection",
        "text": "전송 시뮬레이션",
        "requiresSelection": true
      }
    }
  }
}
```

CodeEditor로 미리보기하므로 라이브러리도 추가한다 (`sap.ui5.dependencies.libs`):

```json
"libs": { "sap.m": {}, "sap.ui.core": {}, "sap.fe.templates": {}, "sap.ui.codeeditor": {} }
```

### Step 2 — 핸들러 모듈 (`webapp/ext/CustomActions.js`)

ControllerExtension이 **아니라** 순수 모듈이다(`return { ... }`).
핸들러 시그니처는 `(oContext, aSelectedContexts)`.

```js
// 정확히 1건 선택됐을 때만 버튼 활성화 (액션이 단일 엔티티에 바운드됨)
enabledSingleSelection: function (oBindingContext, aSelectedContexts) {
    return !!(aSelectedContexts && aSelectedContexts.length === 1);
},

onSendToBankSimu: function (oContext, aSelectedContexts) {
    var aCtx = (aSelectedContexts && aSelectedContexts.length) ? aSelectedContexts
             : (oContext ? [oContext] : []);
    if (!aCtx.length) { MessageToast.show("행을 선택하세요."); return; }

    var oSelected = aCtx[0];                 // 단일 바운드 액션 → 첫 행
    var oModel = oSelected.getModel();
    // 바운드 액션: "<정규화된 액션명>(...)"  — (...)는 바인딩 파라미터 자리표시자(리터럴)
    var oOp = oModel.bindContext(
        "com.sap.gateway.srvd.zswift_r_payment_msg_ui.v0001.sendToBankSimu(...)",
        oSelected, { $$groupId: "$auto" });

    oOp.execute().then(function () {
        var oRet = oOp.getBoundContext().getObject();   // { FileContent: "..." }
        openPreview(oRet && oRet.FileContent || "");
    }).catch(function (e) {
        MessageBox.error("전송 시뮬레이션 호출에 실패했습니다.\n\n" + extractErrorText(e));
    });
}
```

### Step 3 — 팝업 프래그먼트 (`webapp/ext/fragment/XmlPreviewDialog.fragment.xml`)

`sap.ui.codeeditor.CodeEditor`(줄번호 + 구문 강조)로 표시한다.

```xml
<core:FragmentDefinition xmlns="sap.m" xmlns:core="sap.ui.core" xmlns:code="sap.ui.codeeditor">
  <Dialog title="전송 시뮬레이션 미리보기" contentWidth="70%" resizable="true" draggable="true">
    <content>
      <code:CodeEditor type="xml" width="100%" height="60vh" editable="false" lineNumbers="true" />
    </content>
    <beginButton><Button text="복사" icon="sap-icon://copy" press="onCopy" /></beginButton>
    <endButton><Button text="닫기" press="onClose" /></endButton>
  </Dialog>
</core:FragmentDefinition>
```

포인트:
- **CodeEditor는 렌더링 이후 값을 넣어야 안정적**이다 → Dialog `afterOpen` 시점에 `setValue` + ACE `resize`.
- **XMLV3/MT101 자동 구분**: 내용이 `<`로 시작하면 XML(들여쓰기 pretty-print + `type="xml"`), 아니면 MT101 전문으로 보고 원문 그대로 `type="text"`.

### Step 4 — 실패 시 원인 파악 & 함정

- 반환 실패 시 `execute()`가 reject된다. **OData 오류 본문(message/code/details) + 메시지 매니저의 백엔드 트랜지션 메시지**를 모아 보여주면 원인 파악이 쉽다(`extractErrorText`).
- ⚠️ **`SABP_BEHV/100 · Resource not found for entity 'ZSWIFT_R_PAYMENT_MSG'`** 가 뜨면
  이는 **백엔드(RAP)가 그 행을 키로 다시 못 읽어서** 나는 오류다(이 엔티티는 조회 시 만들어지는
  transient 성격). 근본 해결은 백엔드에서 **read-by-key 지원**. UI에서는 완화책으로
  **조회할 때마다 이전 선택을 비운다**(stale 컨텍스트로 액션 호출 방지):

```js
// ListReportExt.controller.js 의 _onSearch 앞부분
var oTable = this._getTable();
if (oTable && oTable.clearSelection) { oTable.clearSelection(); }
```

### 목 테스트

`webapp/localService/mainService/data/main.js`에 `executeAction`을 export하면 목서버가
`sendToBankSimu` 반환값을 흉내낸다(`getInitialDataSet`을 정의하지 않으면 `main.json` 정적 데이터는 그대로 유지).

```js
module.exports = {
    executeAction: function (actionDefinition, actionData, keys) {
        if (actionDefinition.name !== "sendToBankSimu") { return undefined; }
        // CITI → MT101, 그 외 → XMLV3(pain.001) 샘플 반환
        return { FileContent: /* ...전문 문자열... */ "" };
    }
};
```

전체 구현은 [`webapp/ext/CustomActions.js`](webapp/ext/CustomActions.js),
[`webapp/ext/fragment/XmlPreviewDialog.fragment.xml`](webapp/ext/fragment/XmlPreviewDialog.fragment.xml) 참고.

---

## 10. 범용 패턴으로 확장

입력값에 따라 필드를 켜고 끄는 방식은 이 앱(LayoutConfig)뿐 아니라 어디에나 쓸 수 있다.
"엔진(표시 반영) + 전략(무엇을 보여줄지 계산)"으로 분리한 **범용 가이드**는 아래에 정리돼 있다.

- [`docs/dynamic-field-visibility.md`](docs/dynamic-field-visibility.md)
  — 월 범위(`202606` → 1~6월 표시), 접두어, 룩업 테이블 등 전략별 예시 + 함정 표
- [`CLAUDE.md`](CLAUDE.md) — 이 앱 기준 규칙 요약

---

## 프로젝트 구조

```
webapp/
  ext/
    controller/ListReportExt.controller.js   ← 동적 컬럼 로직 + 조회 시 선택 해제
    CustomActions.js                          ← 전송 시뮬레이션 액션 핸들러 (팝업 미리보기)
    fragment/XmlPreviewDialog.fragment.xml    ← 시뮬레이션 결과 CodeEditor 팝업
  annotations/annotation.xml                  ← 로컬 애노테이션
  localService/mainService/
    metadata.xml                              ← OData V4 메타데이터
    data/{main,LayoutConfig}.json             ← 목데이터
    data/main.js                              ← 목: sendToBankSimu 반환값 흉내 (테스트용)
  manifest.json                               ← 컨트롤러 확장 + 커스텀 액션 등록
CLAUDE.md                                      ← 앱 기준 규칙
docs/dynamic-field-visibility.md              ← 범용 패턴 가이드
```

---

<details>
<summary>생성 정보 (SAP Fiori Application Generator)</summary>

|               |
| ------------- |
|**Generation Date and Time**<br>Thu Jul 02 2026 10:46:43 GMT+0900 (Korean Standard Time)|
|**App Generator**<br>SAP Fiori Application Generator|
|**App Generator Version**<br>1.20.1|
|**Generation Platform**<br>Visual Studio Code|
|**Template Used**<br>List Report Page V4|
|**Service Type**<br>SAP System (ABAP On-Premise)|
|**Service URL**<br>https://172.30.1.250:44360/sap/opu/odata4/sap/zswift_r_payment_msg_ui_v4/srvd/sap/zswift_r_payment_msg_ui/0001/|
|**Module Name**<br>yswiftpaymentmsg|
|**Application Title**<br>스위프트 지급|
|**Namespace**<br>yspert|
|**UI5 Theme**<br>sap_horizon|
|**UI5 Version**<br>1.108.0|
|**Main Entity**<br>main|

### Pre-requisites

- Active NodeJS LTS version and associated supported NPM version (https://nodejs.org)

</details>
