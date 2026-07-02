sap.ui.define(
    [
        "sap/ui/core/Fragment",
        "sap/m/MessageToast",
        "sap/m/MessageBox",
        "sap/base/Log"
    ],
    function (Fragment, MessageToast, MessageBox, Log) {
        "use strict";

        // 바운드 액션의 정규화된 이름 + 바인딩 파라미터 자리표시자 "(...)"
        var SIMU_ACTION =
            "com.sap.gateway.srvd.zswift_r_payment_msg_ui.v0001.sendToBankSimu(...)";

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

        return {
            // 정확히 1건 선택됐을 때만 버튼 활성화 (액션이 단일 엔티티에 바운드됨)
            enabledSingleSelection: function (oBindingContext, aSelectedContexts) {
                return !!(aSelectedContexts && aSelectedContexts.length === 1);
            },

            // 전송 시뮬레이션 실행 → 반환된 XMLV3/MT101 전문을 팝업 미리보기
            onSendToBankSimu: function (oContext, aSelectedContexts) {
                var aCtx = (aSelectedContexts && aSelectedContexts.length)
                    ? aSelectedContexts
                    : (oContext ? [oContext] : []);

                if (!aCtx.length) {
                    MessageToast.show("행을 선택하세요.");
                    return;
                }

                var oSelected = aCtx[0]; // 단일 바운드 액션 → 첫 번째 선택 행
                var oModel = oSelected.getModel();
                // FE 기본 배치 방식($auto)으로 호출한다. 실패 시 상세 메시지는 extractErrorText 로 뽑는다.
                var oOperation = oModel.bindContext(SIMU_ACTION, oSelected, { $$groupId: "$auto" });

                oOperation.execute().then(function () {
                    var sContent = extractContent(oOperation);
                    if (!sContent) {
                        MessageToast.show("반환된 전문이 비어 있습니다.");
                    }
                    openPreview(sContent);
                }).catch(function (e) {
                    Log.error("sendToBankSimu execution failed", e);
                    MessageBox.error(
                        "전송 시뮬레이션 호출에 실패했습니다.\n\n" + extractErrorText(e)
                    );
                });
            }
        };
    }
);
