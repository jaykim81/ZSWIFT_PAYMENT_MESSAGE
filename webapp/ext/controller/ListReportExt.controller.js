sap.ui.define(
    [
        "sap/ui/core/mvc/ControllerExtension",
        "sap/ui/mdc/p13n/StateUtil",
        "sap/ui/model/Filter",
        "sap/ui/model/FilterOperator",
        "sap/ui/model/json/JSONModel",
        "sap/base/Log"
    ],
    function (ControllerExtension, StateUtil, Filter, FilterOperator, JSONModel, Log) {
        "use strict";

        var BASE_FIELD_PREFIX = "PAYM_";

        return ControllerExtension.extend("yspert.yswiftpaymentmsg.ext.controller.ListReportExt", {
            override: {
                onInit: function () {
                    this.base.getView().setModel(new JSONModel({ entries: [] }), "layoutConfig");
                },

                onAfterRendering: function () {
                    if (this._bHooked) {
                        return;
                    }
                    var oTable = this._getTable();
                    var oFilterBar = this._getFilterBar();
                    if (!oTable || !oFilterBar) {
                        return;
                    }
                    this._bHooked = true;

                    oFilterBar.attachSearch(this._onSearch, this);

                    // 초기 상태: PAYM_* 이외의 컬럼은 모두 숨김
                    var that = this;
                    oTable.initialized()
                        .then(function () {
                            return StateUtil.retrieveExternalState(oTable);
                        })
                        .then(function (oState) {
                            var aHide = (oState.items || [])
                                .filter(function (oItem) {
                                    return oItem.name.indexOf(BASE_FIELD_PREFIX) !== 0;
                                })
                                .map(function (oItem) {
                                    return { name: oItem.name, visible: false };
                                });
                            if (aHide.length) {
                                return StateUtil.applyExternalState(oTable, { items: aHide });
                            }
                        })
                        .catch(function (oError) {
                            Log.error("Initial column setup failed", oError);
                        });
                }
            },

            _getTable: function () {
                return this.base.getView().byId("fe::table::main::LineItem");
            },

            _getFilterBar: function () {
                return this.base.getView().byId("fe::FilterBar::main");
            },

            _getConditionValue: function (mConditions, sFieldName) {
                var aConditions = mConditions[sFieldName];
                if (aConditions && aConditions.length && aConditions[0].values && aConditions[0].values.length) {
                    return aConditions[0].values[0];
                }
                return null;
            },

            _onSearch: function () {
                var oView = this.base.getView();

                // 조회할 때마다 이전 선택을 비운다.
                // → 필터를 바꾼 뒤 남아있던 stale 컨텍스트에 액션(sendToBankSimu 등)을 걸어
                //   백엔드 "Resource not found for entity" 오류가 나는 것을 방지한다.
                var oTable = this._getTable();
                if (oTable && oTable.clearSelection) {
                    oTable.clearSelection();
                }

                var mConditions = this._getFilterBar().getConditions();
                var sBukrs = this._getConditionValue(mConditions, "PAYM_BUKRS");
                var sBankg = this._getConditionValue(mConditions, "PAYM_BANKG");

                if (!sBukrs || !sBankg) {
                    oView.getModel("layoutConfig").setProperty("/entries", []);
                    // 조건이 없으면 기본(PAYM_*) 컬럼만 남긴다
                    this._applyDynamicColumns([]);
                    return;
                }

                var oListBinding = oView.getModel().bindList("/LayoutConfig", undefined, undefined, [
                    new Filter("CompanyCode", FilterOperator.EQ, sBukrs),
                    new Filter("Bankgr", FilterOperator.EQ, sBankg)
                ], { $$groupId: "$auto" });

                var that = this;
                oListBinding.requestContexts(0, 1000)
                    .then(function (aContexts) {
                        var aEntries = aContexts.map(function (oContext) {
                            return oContext.getObject();
                        });
                        oView.getModel("layoutConfig").setProperty("/entries", aEntries);
                        Log.info("LayoutConfig entries loaded: " + aEntries.length);

                        // Pmedium + '_' + FieldName 조합 (중복 제거, 설정 순서 유지)
                        var aDynamicFields = [];
                        aEntries.forEach(function (oEntry) {
                            var sName = (oEntry.Pmedium + "_" + oEntry.FieldName).toUpperCase();
                            if (aDynamicFields.indexOf(sName) === -1) {
                                aDynamicFields.push(sName);
                            }
                        });

                        return that._applyDynamicColumns(aDynamicFields);
                    })
                    .catch(function (oError) {
                        Log.error("LayoutConfig read failed", oError);
                    });
            },

            _applyDynamicColumns: function (aFieldNames) {
                var oTable = this._getTable();
                var oMetaModel = this.base.getView().getModel().getMetaModel();

                // 엔티티에 실제 존재하는 필드만 표시 대상으로 (없는 조합은 로그만 남김)
                var aValid = aFieldNames.filter(function (sName) {
                    var bExists = !!oMetaModel.getObject("/main/" + sName);
                    if (!bExists) {
                        Log.warning("LayoutConfig field not in entity, skipped: " + sName);
                    }
                    return bExists;
                });

                return StateUtil.retrieveExternalState(oTable).then(function (oState) {
                    var aItems = [];
                    // 현재 보이는 동적 컬럼 중 새 조건에 없는 것은 숨김 (PAYM_*은 항상 유지)
                    (oState.items || []).forEach(function (oItem) {
                        if (oItem.name.indexOf(BASE_FIELD_PREFIX) !== 0 && aValid.indexOf(oItem.name) === -1) {
                            aItems.push({ name: oItem.name, visible: false });
                        }
                    });
                    aValid.forEach(function (sName) {
                        aItems.push({ name: sName, visible: true });
                    });
                    // StateUtil을 통해 컬럼을 추가/제거하면 테이블이 다시 바인딩되어
                    // $select에 필드가 포함되므로 값도 함께 조회된다
                    if (aItems.length) {
                        return StateUtil.applyExternalState(oTable, { items: aItems });
                    }
                });
            }
        });
    }
);
