sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"yspert/yswiftpaymentmsg/test/integration/pages/mainList",
	"yspert/yswiftpaymentmsg/test/integration/pages/mainObjectPage"
], function (JourneyRunner, mainList, mainObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('yspert/yswiftpaymentmsg') + '/test/flp.html#app-preview',
        pages: {
			onThemainList: mainList,
			onThemainObjectPage: mainObjectPage
        },
        async: true
    });

    return runner;
});

