// 목서버 전용: 시뮬레이션/룰셋 액션 반환을 흉내낸다.
// getInitialDataSet 을 정의하지 않으므로 main.json 의 정적 데이터는 그대로 로드된다.
// (실백엔드에는 영향 없음 — 로컬 목 테스트용)
//  - ValiLog        → ZSWIFT_S_VALI_RETURN.valilog          (라인별 룰셋 JSON)
//  - sendToBankSimu → ZSWIFT_S_XML_RETURN.FileContent(전문) + .valilog(전체 룰셋 JSON)
module.exports = {
    executeAction: function (actionDefinition, actionData, keys) {
        var sName = actionDefinition && actionDefinition.name;

        // ValiLog: 라인별 룰셋을 JSON 배열 문자열로 valilog 에 담아 반환
        if (sName === "ValiLog") {
            var aLineLog = [
                { fieldname: "PYMT_TYPE", condtype: "1", seqno: 1, value: "2", valueAfter: "3" },
                { fieldname: "INSTDAMT", condtype: "V", seqno: 2, value: "1000.50", valueAfter: "1000.50" },
                { fieldname: "BENEF_ACCT", condtype: "V", seqno: 3, value: "9876543210", valueAfter: "9876543210" }
            ];
            return { valilog: JSON.stringify(aLineLog) };
        }

        if (sName !== "sendToBankSimu") {
            // 다른 액션은 목에서 별도 처리하지 않음
            return undefined;
        }

        var sVblnr = (keys && keys.PAYM_VBLNR) || "XXXXXXXXXX";
        var sBankg = (keys && keys.PAYM_BANKG) || "";

        // CITI(=MT101 시나리오)면 MT101 전문, 그 외에는 XMLV3(pain.001) 전문 예시
        var sContent;
        if (sBankg === "CITI") {
            sContent = [
                "{1:F01BANKKRSEAXXX0000000000}",
                "{2:I101CITIUS33XXXXN}",
                "{4:",
                ":20:" + sVblnr,
                ":28D:00001/00001",
                ":50H:/1234567890",
                "ACME KOREA CO LTD",
                ":30:260702",
                ":21:" + sVblnr,
                ":32B:USD1000,50",
                ":59:/9876543210",
                "BENEFICIARY NAME",
                ":71A:SHA",
                "-}"
            ].join("\n");
        } else {
            sContent = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">',
                "  <CstmrCdtTrfInitn>",
                "    <GrpHdr>",
                "      <MsgId>MSG-" + sVblnr + "</MsgId>",
                "      <CreDtTm>2026-07-02T09:00:00</CreDtTm>",
                "      <NbOfTxs>1</NbOfTxs>",
                "    </GrpHdr>",
                "    <PmtInf>",
                "      <PmtInfId>" + sVblnr + "</PmtInfId>",
                "      <PmtMtd>TRF</PmtMtd>",
                "      <CdtTrfTxInf>",
                "        <Amt>",
                '          <InstdAmt Ccy="USD">1000.50</InstdAmt>',
                "        </Amt>",
                "      </CdtTrfTxInf>",
                "    </PmtInf>",
                "  </CstmrCdtTrfInitn>",
                "</Document>"
            ].join("\n");
        }

        // 전체 룰셋(글로벌) — 라인별과 구분되는 샘플
        var aGlobalLog = [
            { fieldname: "MSG_TYPE", condtype: "G", seqno: 1, value: "pain.001", valueAfter: "pain.001.001.03" },
            { fieldname: "CHARGE_BEARER", condtype: "G", seqno: 2, value: "SHA", valueAfter: "SHA" },
            { fieldname: "BATCH_BOOKING", condtype: "G", seqno: 3, value: "", valueAfter: "false" }
        ];

        return { FileContent: sContent, valilog: JSON.stringify(aGlobalLog) };
    }
};
