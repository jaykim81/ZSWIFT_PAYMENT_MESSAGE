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
        // ValiLog 는 인스턴스 바운드(단일 mainType) → sendToBankSimu 와 동일한 방식으로 호출
        var VALILOG_ACTION =
            "com.sap.gateway.srvd.zswift_r_payment_msg_ui.v0001.ValiLog(...)";

        var oPreviewDialog;      // 팝업 1회 생성 후 재사용
        var sCurrentContent = ""; // CodeEditor 에 넣을 현재 내용

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

        // CodeEditor 는 렌더링 이후에 값을 넣어야 안정적으로 표시된다 (afterOpen 시점)
        function applyToEditor(oDialog) {
            var oEditor = oDialog.getContent()[0];
            if (!oEditor || typeof oEditor.setValue !== "function") { return; }
            oEditor.setType(isXml(sCurrentContent) ? "xml" : "text");
            oEditor.setValue(sCurrentContent);
            var oAce = (typeof oEditor.getEditor === "function" && oEditor.getEditor()) || oEditor._oEditor;
            if (oAce) {
                oAce.resize(true);
                if (oAce.renderer && oAce.renderer.updateFull) { oAce.renderer.updateFull(true); }
            }
        }

        var oFragCtrl = {
            onCopy: function () {
                if (!sCurrentContent) { return; }
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(sCurrentContent);
                    } else {
                        var oTa = document.createElement("textarea");
                        oTa.value = sCurrentContent;
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
            onClose: function () {
                if (oPreviewDialog) { oPreviewDialog.close(); }
            }
        };

        var oValiLogDialog;   // 팝업 1회 생성 후 재사용
        var oValiLogModel;    // 테이블 바인딩용 JSONModel ("valiLog")

        var oValiLogFragCtrl = {
            onValiLogClose: function () {
                if (oValiLogDialog) { oValiLogDialog.close(); }
            }
        };

        // ValiLog 결과 배열을 테이블 팝업으로 표시
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

        // FileContent 를 팝업(CodeEditor)으로 표시
        function openPreview(sContent) {
            sCurrentContent = formatXml(sContent);

            if (oPreviewDialog) {
                oPreviewDialog.attachEventOnce("afterOpen", function () { applyToEditor(oPreviewDialog); });
                oPreviewDialog.open();
                return;
            }

            Fragment.load({
                name: "yspert.yswiftpaymentmsg.ext.fragment.XmlPreviewDialog",
                controller: oFragCtrl
            }).then(function (oDialog) {
                oPreviewDialog = oDialog;
                oDialog.attachEventOnce("afterOpen", function () { applyToEditor(oDialog); });
                oDialog.open();
            }).catch(function (e) {
                Log.error("preview dialog load failed", e);
                oPreviewDialog = undefined;
                MessageBox.error("미리보기 팝업 표시에 실패했습니다.\n" + (e && e.message ? e.message : ""));
            });
        }

        // 반환 컨텍스트에서 FileContent 안전하게 추출 (복합타입/프리미티브 대비)
        function extractContent(oOperation) {
            var oBound = oOperation.getBoundContext();
            if (!oBound) { return ""; }
            var oObj = oBound.getObject();
            if (oObj && typeof oObj === "object") {
                if (oObj.FileContent != null) { return oObj.FileContent; }
                if (oObj.value != null) { return oObj.value; }
            }
            // 프리미티브로 반환되는 경우
            var sByPath = oBound.getObject("FileContent");
            return sByPath != null ? sByPath : (typeof oObj === "string" ? oObj : "");
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
        // 반환값: 비어있지 않은 FileContent 문자열 배열(중복 제거). 합쳐진 전문은 보통 한 결과에만 담겨 온다.
        function executeInOneChangeSet(oModel, sAction, aCtx) {
            var aOps = aCtx.map(function (oCtx) {
                return oModel.bindContext(sAction, oCtx, { $$groupId: "$auto" });
            });
            return Promise.all(aOps.map(function (oOp) {
                return oOp.execute().then(function () { return extractContent(oOp); });
            })).then(function (aContents) {
                var aDistinct = [];
                aContents.forEach(function (sContent) {
                    if (sContent && String(sContent).trim() && aDistinct.indexOf(sContent) === -1) {
                        aDistinct.push(sContent);
                    }
                });
                return aDistinct;
            });
        }

        return {
            // 1건 이상 선택되면 버튼 활성화 (단일/멀티 모두 허용, 인스턴스 바운드 액션을 선택 건마다 호출)
            enabledSelection: function (oBindingContext, aSelectedContexts) {
                return !!(aSelectedContexts && aSelectedContexts.length >= 1);
            },

            // 전송 시뮬레이션 실행 → 반환된 XMLV3/MT101 전문을 팝업 미리보기
            // 선택 키 전체를 하나의 changeset으로 전송(백엔드가 합쳐 하나의 전문 생성) → 합쳐진 전문만 표시
            onSendToBankSimu: function (oContext, aSelectedContexts) {
                var aCtx = pickContexts(aSelectedContexts, oContext);
                if (!aCtx.length) {
                    MessageToast.show("행을 선택하세요.");
                    return;
                }

                executeInOneChangeSet(aCtx[0].getModel(), SIMU_ACTION, aCtx).then(function (aContents) {
                    if (!aContents.length) {
                        MessageToast.show("반환된 전문이 비어 있습니다.");
                    }
                    // 합쳐진 전문은 보통 1건 → 그대로 표시. (혹시 서로 다른 전문이 여럿 오면 빈 줄로 구분)
                    openPreview(aContents.join("\n\n"));
                }).catch(function (e) {
                    Log.error("sendToBankSimu execution failed", e);
                    MessageBox.error(
                        "전송 시뮬레이션 호출에 실패했습니다.\n\n" + extractErrorText(e)
                    );
                });
            },

            // 적용 룰셋(검증 로그) 조회 → 반환된 JSON 배열을 테이블 팝업으로 표시
            // 시뮬레이션과 동일하게 선택 키 전체를 하나의 changeset으로 전송 → 합쳐진 룰셋 로그를 표로 표시
            onValiLog: function (oContext, aSelectedContexts) {
                var aCtx = pickContexts(aSelectedContexts, oContext);
                if (!aCtx.length) {
                    MessageToast.show("행을 선택하세요.");
                    return;
                }

                executeInOneChangeSet(aCtx[0].getModel(), VALILOG_ACTION, aCtx).then(function (aContents) {
                    var aRows = [];
                    var bParseError = false;
                    aContents.forEach(function (sContent) {
                        try {
                            var aParsed = JSON.parse(sContent);
                            if (Array.isArray(aParsed)) { aRows = aRows.concat(aParsed); }
                        } catch (e) {
                            Log.error("ValiLog response parse failed", e);
                            bParseError = true;
                        }
                    });
                    if (bParseError && !aRows.length) {
                        MessageBox.error("룰셋 로그 응답을 해석할 수 없습니다.");
                        return;
                    }
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
