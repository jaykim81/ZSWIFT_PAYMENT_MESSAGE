// 목서버 전용: sendToBankSimu 액션이 XMLV3/MT101 전문(FileContent)을 반환하도록 흉내낸다.
// getInitialDataSet 을 정의하지 않으므로 main.json 의 정적 데이터는 그대로 로드된다.
// (실백엔드에는 영향 없음 — 로컬 목 테스트용)
module.exports = {
    executeAction: function (actionDefinition, actionData, keys) {
        var sName = actionDefinition && actionDefinition.name;
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

        return { FileContent: sContent };
    }
};
