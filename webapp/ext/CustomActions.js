sap.ui.define(
    [
        "sap/ui/core/Fragment",
        "sap/ui/model/json/JSONModel",
        "sap/m/MessageToast",
        "sap/m/MessageBox",
        "sap/base/Log"
    ],
    function (Fragment, JSONModel, MessageToast, MessageBox, Log) {
        "use strict";

        // 바운드 액션의 정규화된 이름 + 바인딩 파라미터 자리표시자 "(...)"
        var SIMU_ACTION =
            "com.sap.gateway.srvd.zswift_r_payment_msg_ui.v0001.sendToBankSimu(...)";
        var VALILOG_ACTION =
            "com.sap.gateway.srvd.zswift_r_payment_msg_ui.v0001.ValiLog(...)";

        // 리턴 구조:
        //  - sendToBankSimu → ZSWIFT_S_XML_RETURN { FileContent(전문), valilog(전체 룰셋 JSON) }
        //  - ValiLog        → ZSWIFT_S_VALI_RETURN { valilog(라인별 룰셋 JSON) }

        // XMLV3 전문이면 true (MT101 전문은 '<' 로 시작하지 않음)
        function isXml(s) {
            return /^\s*</.test(s || "");
        }

        // XML 을 들여쓰기해서 보기 좋게 정리 (XML 이 아닐 땐 원문 유지)
        function formatXml(sXml) {
            if (!isXml(sXml)) { return sXml || ""; }
            var sFormatted = "";
            var iIndent = 0;
            var sTab = "  ";
            var sNormalized = sXml
                .replace(/\r\n/g, "\n")
                .replace(/>\s*</g, "><")
                .replace(/(>)(<)(\/*)/g, "$1\n$2$3");

            sNormalized.split("\n").forEach(function (sNode) {
                var iPad = 0;
                if (sNode.match(/.+<\/\w[^>]*>$/)) { iPad = 0; }
                else if (sNode.match(/^<\/\w/)) { if (iIndent > 0) { iIndent -= 1; } }
                else if (sNode.match(/^<\w[^>]*[^\/]>.*$/) && !sNode.match(/^<\?xml/)) { iPad = 1; }
                sFormatted += sTab.repeat(iIndent) + sNode + "\n";
                iIndent += iPad;
            });
            return sFormatted.trim();
        }

        // ─────────────────────────────────────────────────────────────
        // 통합 시뮬레이션 팝업 (상단: 전문 CodeEditor / 하단: 전체 룰셋 Table)
        // ─────────────────────────────────────────────────────────────
        var oSimDialog;        // 팝업 1회 생성 후 재사용
        var oSimModel;         // 하단 표 바인딩용 JSONModel ("sim")
        var sSimMessage = "";  // 상단 CodeEditor 에 넣을 전문 (afterOpen 시점에 주입)

        // CodeEditor 는 렌더링 이후에 값을 넣어야 안정적 → Dialog 안에서 찾아 값 주입
        function applyToSimEditor(oDialog) {
            var aEditors = oDialog.findAggregatedObjects(true, function (c) {
                return c.isA && c.isA("sap.ui.codeeditor.CodeEditor");
            });
            var oEditor = aEditors[0];
            if (!oEditor || typeof oEditor.setValue !== "function") { return; }
            oEditor.setType(isXml(sSimMessage) ? "xml" : "text");
            oEditor.setValue(sSimMessage);
            var oAce = (typeof oEditor.getEditor === "function" && oEditor.getEditor()) || oEditor._oEditor;
            if (oAce) {
                oAce.resize(true);
                if (oAce.renderer && oAce.renderer.updateFull) { oAce.renderer.updateFull(true); }
            }
        }

        var oSimFragCtrl = {
            onSimCopy: function () {
                if (!sSimMessage) { return; }
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(sSimMessage);
                    } else {
                        var oTa = document.createElement("textarea");
                        oTa.value = sSimMessage;
                        document.body.appendChild(oTa);
                        oTa.select();
                        document.execCommand("copy");
                        document.body.removeChild(oTa);
                    }
                    MessageToast.show("전문을 복사했습니다.");
                } catch (e) {
                    Log.error("clipboard copy failed", e);
                }
            },
            onSimClose: function () {
                if (oSimDialog) { oSimDialog.close(); }
            }
        };

        // 전문(sMessage) + 전체 룰셋(aRows)을 하나의 팝업으로 표시
        function openSimulation(sMessage, aRows) {
            sSimMessage = formatXml(sMessage);
            if (!oSimModel) { oSimModel = new JSONModel(); }
            oSimModel.setData({ rows: aRows || [] });

            if (oSimDialog) {
                oSimDialog.attachEventOnce("afterOpen", function () { applyToSimEditor(oSimDialog); });
                oSimDialog.open();
                return;
            }

            Fragment.load({
                name: "yspert.yswiftpaymentmsg.ext.fragment.SimulationDialog",
                controller: oSimFragCtrl
            }).then(function (oDialog) {
                oSimDialog = oDialog;
                oDialog.setModel(oSimModel, "sim");
                oDialog.attachEventOnce("afterOpen", function () { applyToSimEditor(oDialog); });
                oDialog.open();
            }).catch(function (e) {
                Log.error("Simulation dialog load failed", e);
                oSimDialog = undefined;
                MessageBox.error("시뮬레이션 팝업 표시에 실패했습니다.\n" + (e && e.message ? e.message : ""));
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 적용 룰셋(라인별) 팝업 (Table)
        // ─────────────────────────────────────────────────────────────
        var oValiLogDialog;   // 팝업 1회 생성 후 재사용
        var oValiLogModel;    // 테이블 바인딩용 JSONModel ("valiLog")

        var oValiLogFragCtrl = {
            onValiLogClose: function () {
                if (oValiLogDialog) { oValiLogDialog.close(); }
            }
        };

        function openValiLog(aRows) {
            if (!oValiLogModel) { oValiLogModel = new JSONModel(); }
            oValiLogModel.setData({ rows: aRows || [] });

            if (oValiLogDialog) {
                oValiLogDialog.open();
                return;
            }

            Fragment.load({
                name: "yspert.yswiftpaymentmsg.ext.fragment.ValiLogDialog",
                controller: oValiLogFragCtrl
            }).then(function (oDialog) {
                oValiLogDialog = oDialog;
                oDialog.setModel(oValiLogModel, "valiLog");
                oDialog.open();
            }).catch(function (e) {
                Log.error("ValiLog dialog load failed", e);
                oValiLogDialog = undefined;
                MessageBox.error("룰셋 로그 팝업 표시에 실패했습니다.\n" + (e && e.message ? e.message : ""));
            });
        }

        // 실패 원인을 최대한 자세히 뽑아낸다 (백엔드 OData 오류 / SAP 메시지 / 배치 파싱 오류 구분용)
        function extractErrorText(oError) {
            var aLines = [];
            if (oError && oError.message) {
                aLines.push(oError.message);
            }
            // OData V4 오류 응답 본문(JSON)의 상세 메시지
            var oOData = oError && (oError.error || (oError.cause && oError.cause.error));
            if (oOData) {
                if (oOData.message && aLines.indexOf(oOData.message) === -1) {
                    aLines.push(oOData.message);
                }
                if (oOData.code) { aLines.push("code: " + oOData.code); }
                (oOData.details || []).forEach(function (d) {
                    if (d && d.message) { aLines.push("· " + d.message); }
                });
            }
            // 메시지 매니저에 쌓인 백엔드 트랜지션 메시지
            try {
                var oMM = sap.ui.getCore().getMessageManager();
                (oMM.getMessageModel().getData() || []).forEach(function (m) {
                    if (m && m.message && aLines.indexOf(m.message) === -1) {
                        aLines.push("· " + m.message);
                    }
                });
            } catch (e) { /* ignore */ }
            return aLines.join("\n");
        }

        // 선택 컨텍스트 정리: aSelectedContexts 우선, 없으면 oContext 폴백
        function pickContexts(aSelectedContexts, oContext) {
            if (aSelectedContexts && aSelectedContexts.length) { return aSelectedContexts; }
            return oContext ? [oContext] : [];
        }

        // 선택 건마다 인스턴스 바운드 액션을 걸되, 동일 $auto 배치에 실어 "하나의 changeset"으로 전송한다.
        // → 백엔드 invocationGrouping:#CHANGE_SET 이 선택 키 전체를 한 번에 받아 처리(=표준 sendToBank 동작과 동일).
        // 반환값: 각 호출의 리턴 객체(getObject) 배열. 필드 추출은 호출부에서 distinctField 로 한다.
        function executeInOneChangeSet(oModel, sAction, aCtx) {
            var aOps = aCtx.map(function (oCtx) {
                return oModel.bindContext(sAction, oCtx, { $$groupId: "$auto" });
            });
            return Promise.all(aOps.map(function (oOp) {
                return oOp.execute().then(function () {
                    var oBound = oOp.getBoundContext();
                    return (oBound && oBound.getObject()) || {};
                });
            }));
        }

        // 리턴 객체 배열에서 특정 필드의 비어있지 않은 값(중복 제거)만 뽑는다.
        // 합쳐진 결과는 보통 한 응답에만 담겨 오므로 대개 길이 1.
        function distinctField(aResults, sField) {
            var aOut = [];
            aResults.forEach(function (o) {
                var s = o && o[sField];
                if (s && String(s).trim() && aOut.indexOf(s) === -1) { aOut.push(s); }
            });
            return aOut;
        }

        // JSON 문자열 배열을 파싱해 룰셋 행 배열로 합친다.
        function parseRuleRows(aStrings) {
            var aRows = [];
            aStrings.forEach(function (s) {
                try {
                    var aParsed = JSON.parse(s);
                    if (Array.isArray(aParsed)) { aRows = aRows.concat(aParsed); }
                } catch (e) {
                    Log.error("ruleset JSON parse failed", e);
                }
            });
            return aRows;
        }

        return {
            // 1건 이상 선택되면 버튼 활성화 (단일/멀티 모두 허용, 인스턴스 바운드 액션을 선택 건마다 호출)
            enabledSelection: function (oBindingContext, aSelectedContexts) {
                return !!(aSelectedContexts && aSelectedContexts.length >= 1);
            },

            // 전송 시뮬레이션: 선택 키 전체를 하나의 changeset으로 전송 →
            // 반환된 전문(FileContent) + 전체 룰셋(valilog)을 하나의 통합 팝업으로 표시
            onSendToBankSimu: function (oContext, aSelectedContexts) {
                var aCtx = pickContexts(aSelectedContexts, oContext);
                if (!aCtx.length) {
                    MessageToast.show("행을 선택하세요.");
                    return;
                }

                executeInOneChangeSet(aCtx[0].getModel(), SIMU_ACTION, aCtx).then(function (aResults) {
                    var sMessage = distinctField(aResults, "FileContent").join("\n\n"); // 합쳐진 전문(보통 1건)
                    var aRows = parseRuleRows(distinctField(aResults, "valilog"));       // 전체 룰셋
                    if (!sMessage && !aRows.length) {
                        MessageToast.show("반환 결과가 비어 있습니다.");
                    }
                    openSimulation(sMessage, aRows);
                }).catch(function (e) {
                    Log.error("sendToBankSimu execution failed", e);
                    MessageBox.error(
                        "전송 시뮬레이션 호출에 실패했습니다.\n\n" + extractErrorText(e)
                    );
                });
            },

            // 적용 룰셋(라인별): 선택 키 전체를 하나의 changeset으로 전송 →
            // 반환된 valilog(JSON 배열)를 표 팝업으로 표시
            onValiLog: function (oContext, aSelectedContexts) {
                var aCtx = pickContexts(aSelectedContexts, oContext);
                if (!aCtx.length) {
                    MessageToast.show("행을 선택하세요.");
                    return;
                }

                executeInOneChangeSet(aCtx[0].getModel(), VALILOG_ACTION, aCtx).then(function (aResults) {
                    var aRows = parseRuleRows(distinctField(aResults, "valilog"));
                    openValiLog(aRows);
                }).catch(function (e) {
                    Log.error("ValiLog execution failed", e);
                    MessageBox.error(
                        "적용 룰셋 조회에 실패했습니다.\n\n" + extractErrorText(e)
                    );
                });
            }
        };
    }
);
