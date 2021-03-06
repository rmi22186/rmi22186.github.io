// WARNING - modifying anything in here may cause issues when running your test app

// *******AMPLITUDE INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-amplitude/Amplitude.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******ADOBE INTEGRATION*******
// var a = document.createElement('script');
// a.type = 'text/javascript';
// a.async = false;
// a.src = ('Integrations/mparticle-javascript-integration-adobe/AdobeKit.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(a, s);

// *******APPBOY INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('../Integrations/mparticle-javascript-integration-appboy/AppboyKit.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******CRITEO INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-criteo/CriteoEventForwarder.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******DYNAMIC YIELD*******
// var dynamicyieldscript = document.createElement('script');
// dynamicyieldscript.type = 'text/javascript';
// dynamicyieldscript.async = false;
// dynamicyieldscript.src = ('Integrations/mparticle-javascript-integration-dynamic-yield/DynamicYieldKit.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(dynamicyieldscript, s);

// *******Facebook Analytics INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-facebook/FacebookEventForwarder.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******Google Analytics INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-google-analytics/GoogleAnalyticsEventForwarder.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******Google Adwords INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-adwords/GoogleAdwordsEventForwarder.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******Mixpanel INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-mixpanel/MixpanelEventForwarder.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

// *******Onetrust INTEGRATION*******
// var onetrust = document.createElement('script');
// onetrust.type = 'text/javascript';
// onetrust.async = false;
// // onetrust.src = ('Integrations/mparticle-javascript-integration-onetrust/full.js');
// onetrust.src = ('Integrations/mparticle-javascript-integration-onetrust/build/OneTrustKit.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(onetrust, s);

// *******LeanPlum INTEGRATION*******
// var amp = document.createElement('script');
// amp.type = 'text/javascript';
// amp.async = false;
// amp.src = ('Integrations/mparticle-javascript-integration-leanplum/LeanplumAnalyticsEventForwarder.js');
// amp.src = ('Integrations/integration-builder/build/kit.js');
//
// var s = document.getElementsByTagName('script')[0];
// s.parentNode.insertBefore(amp, s);

/*  use the below only if you are testing a local mparticle.js file
    if so, make mp.async = false above in mparticle script set up
*/

// **********AFTERLOADING SCRIPTS (init) **********//
var afterLoadingScripts = document.createElement('script');
afterLoadingScripts.type = 'text/javascript';
afterLoadingScripts.async = false;
afterLoadingScripts.src = ('../init.js');
var v = document.getElementsByTagName('script')[0];
v.parentNode.insertBefore(afterLoadingScripts, v);
