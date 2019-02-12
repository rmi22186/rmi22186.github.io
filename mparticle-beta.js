window.mParticle = window.mParticle || {};
window.mParticle.config = window.mParticle.config || {};
window.mParticle.config.serviceUrl = 'jssdk.mparticle.com/v2/JS/';
window.mParticle.config.secureServiceUrl = 'jssdks.mparticle.com/v2/JS/';
window.mParticle.config.appName = "_mParticle Playground";
window.mParticle.config.minWebviewBridgeVersion = 1
window.mParticle.config.workspaceToken = "D3F80A4C";


(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    NativeSdkHelpers = require('./nativeSdkHelpers'),
    HTTPCodes = Constants.HTTPCodes,
    MP = require('./mp'),
    ServerModel = require('./serverModel'),
    Types = require('./types'),
    Messages = Constants.Messages;

function sendEventToServer(event, sendEventToForwarders, parseEventResponse) {
    if (MP.webviewBridgeEnabled) {
        NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.LogEvent, JSON.stringify(event));
    } else {
        var xhr,
            xhrCallback = function() {
                if (xhr.readyState === 4) {
                    Helpers.logDebug('Received ' + xhr.statusText + ' from server');

                    parseEventResponse(xhr.responseText);
                }
            };

        Helpers.logDebug(Messages.InformationMessages.SendBegin);

        var validUserIdentities = [];

        // convert userIdentities which are objects with key of IdentityType (number) and value ID to an array of Identity objects for DTO and event forwarding
        if (Helpers.isObject(event.UserIdentities) && Object.keys(event.UserIdentities).length) {
            for (var key in event.UserIdentities) {
                var userIdentity = {};
                userIdentity.Identity = event.UserIdentities[key];
                userIdentity.Type = Helpers.parseNumber(key);
                validUserIdentities.push(userIdentity);
            }
            event.UserIdentities = validUserIdentities;
        } else {
            event.UserIdentities = [];
        }

        MP.requireDelay = Helpers.isDelayedByIntegration(MP.integrationDelays, MP.integrationDelayTimeoutStart, Date.now());
        // We queue events if there is no MPID (MPID is null, or === 0), or there are integrations that that require this to stall because integration attributes
        // need to be set, and so require delaying events
        if (!MP.mpid || MP.requireDelay) {
            Helpers.logDebug('Event was added to eventQueue. eventQueue will be processed once a valid MPID is returned or there is no more integration imposed delay.');
            MP.eventQueue.push(event);
        } else {
            Helpers.processQueuedEvents(MP.eventQueue, MP.mpid, !MP.requiredDelay, sendEventToServer, sendEventToForwarders, parseEventResponse);

            if (!event) {
                Helpers.logDebug(Messages.ErrorMessages.EventEmpty);
                return;
            }

            Helpers.logDebug(Messages.InformationMessages.SendHttp);

            xhr = Helpers.createXHR(xhrCallback);

            if (xhr) {
                try {
                    xhr.open('post', Helpers.createServiceUrl(Constants.v2SecureServiceUrl, Constants.v2ServiceUrl, MP.devToken) + '/Events');
                    xhr.send(JSON.stringify(ServerModel.convertEventToDTO(event, MP.isFirstRun, MP.currencyCode, MP.integrationAttributes)));

                    if (event.EventName !== Types.MessageType.AppStateTransition) {
                        sendEventToForwarders(event);
                    }
                }
                catch (e) {
                    Helpers.logDebug('Error sending event to mParticle servers. ' + e);
                }
            }
        }
    }
}

function sendIdentityRequest(identityApiRequest, method, callback, originalIdentityApiData, parseIdentityResponse) {
    var xhr, previousMPID,
        xhrCallback = function() {
            if (xhr.readyState === 4) {
                Helpers.logDebug('Received ' + xhr.statusText + ' from server');
                parseIdentityResponse(xhr, previousMPID, callback, originalIdentityApiData, method);
            }
        };

    Helpers.logDebug(Messages.InformationMessages.SendIdentityBegin);

    if (!identityApiRequest) {
        Helpers.logDebug(Messages.ErrorMessages.APIRequestEmpty);
        return;
    }

    Helpers.logDebug(Messages.InformationMessages.SendIdentityHttp);
    xhr = Helpers.createXHR(xhrCallback);

    if (xhr) {
        try {
            if (MP.identityCallInFlight) {
                callback({httpCode: HTTPCodes.activeIdentityRequest, body: 'There is currently an AJAX request processing. Please wait for this to return before requesting again'});
            } else {
                previousMPID = (!MP.isFirstRun && MP.mpid) ? MP.mpid : null;
                if (method === 'modify') {
                    xhr.open('post', Constants.identityUrl + MP.mpid + '/' + method);
                } else {
                    xhr.open('post', Constants.identityUrl + method);
                }
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('x-mp-key', MP.devToken);
                MP.identityCallInFlight = true;
                xhr.send(JSON.stringify(identityApiRequest));
            }
        }
        catch (e) {
            MP.identityCallInFlight = false;
            Helpers.invokeCallback(callback, HTTPCodes.noHttpCoverage, e);
            Helpers.logDebug('Error sending identity request to servers with status code ' + xhr.status + ' - ' + e);
        }
    }
}

function sendBatchForwardingStatsToServer(forwardingStatsData, xhr) {
    var url, data;
    try {
        url = Helpers.createServiceUrl(Constants.v2SecureServiceUrl, Constants.v2ServiceUrl, MP.devToken);
        data = {
            uuid: Helpers.generateUniqueId(),
            data: forwardingStatsData
        };

        if (xhr) {
            xhr.open('post', url + '/Forwarding');
            xhr.send(JSON.stringify(data));
        }
    }
    catch (e) {
        Helpers.logDebug('Error sending forwarding stats to mParticle servers.');
    }
}

function sendSingleForwardingStatsToServer(forwardingStatsData) {
    var url, data;
    try {
        var xhrCallback = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 202) {
                    Helpers.logDebug('Successfully sent  ' + xhr.statusText + ' from server');
                }
            }
        };
        var xhr = Helpers.createXHR(xhrCallback);
        url = Helpers.createServiceUrl(Constants.v1SecureServiceUrl, Constants.v1ServiceUrl, MP.devToken);
        data = forwardingStatsData;

        if (xhr) {
            xhr.open('post', url + '/Forwarding');
            xhr.send(JSON.stringify(data));
        }
    }
    catch (e) {
        Helpers.logDebug('Error sending forwarding stats to mParticle servers.');
    }
}

module.exports = {
    sendEventToServer: sendEventToServer,
    sendIdentityRequest: sendIdentityRequest,
    sendBatchForwardingStatsToServer: sendBatchForwardingStatsToServer,
    sendSingleForwardingStatsToServer: sendSingleForwardingStatsToServer
};

},{"./constants":3,"./helpers":9,"./mp":14,"./nativeSdkHelpers":15,"./serverModel":18,"./types":20}],2:[function(require,module,exports){
var Helpers = require('./helpers');

function createGDPRConsent(consented, timestamp, consentDocument, location, hardwareId) {
    if (typeof(consented) !== 'boolean') {
        Helpers.logDebug('Consented boolean is required when constructing a GDPR Consent object.');
        return null;
    }
    if (timestamp && isNaN(timestamp)) {
        Helpers.logDebug('Timestamp must be a valid number when constructing a GDPR Consent object.');
        return null;
    }
    if (consentDocument && !typeof(consentDocument) === 'string') {
        Helpers.logDebug('Document must be a valid string when constructing a GDPR Consent object.');
        return null;
    }
    if (location && !typeof(location) === 'string') {
        Helpers.logDebug('Location must be a valid string when constructing a GDPR Consent object.');
        return null;
    }
    if (hardwareId && !typeof(hardwareId) === 'string') {
        Helpers.logDebug('Hardware ID must be a valid string when constructing a GDPR Consent object.');
        return null;
    }
    return {
        Consented: consented,
        Timestamp: timestamp || Date.now(),
        ConsentDocument: consentDocument,
        Location: location,
        HardwareId: hardwareId
    };
}

var ConsentSerialization = {
    toMinifiedJsonObject: function(state) {
        var jsonObject = {};
        if (state) {
            var gdprConsentState = state.getGDPRConsentState();
            if (gdprConsentState) {
                jsonObject.gdpr = {};
                for (var purpose in gdprConsentState){
                    if (gdprConsentState.hasOwnProperty(purpose)) {
                        var gdprConsent = gdprConsentState[purpose];
                        jsonObject.gdpr[purpose] = {};
                        if (typeof(gdprConsent.Consented) === 'boolean') {
                            jsonObject.gdpr[purpose].c = gdprConsent.Consented;
                        }
                        if (typeof(gdprConsent.Timestamp) === 'number') {
                            jsonObject.gdpr[purpose].ts = gdprConsent.Timestamp;
                        }
                        if (typeof(gdprConsent.ConsentDocument) === 'string') {
                            jsonObject.gdpr[purpose].d = gdprConsent.ConsentDocument;
                        }
                        if (typeof(gdprConsent.Location) === 'string') {
                            jsonObject.gdpr[purpose].l = gdprConsent.Location;
                        }
                        if (typeof(gdprConsent.HardwareId) === 'string') {
                            jsonObject.gdpr[purpose].h = gdprConsent.HardwareId;
                        }
                    }
                }
            }
        }
        return jsonObject;
    },

    fromMinifiedJsonObject: function(json) {
        var state = createConsentState();
        if (json.gdpr) {
            for (var purpose in json.gdpr){
                if (json.gdpr.hasOwnProperty(purpose)) {
                    var gdprConsent = createGDPRConsent(json.gdpr[purpose].c,
                        json.gdpr[purpose].ts,
                        json.gdpr[purpose].d,
                        json.gdpr[purpose].l,
                        json.gdpr[purpose].h);
                    state.addGDPRConsentState(purpose, gdprConsent);
                }
            }
        }
        return state;
    }
};

function createConsentState(consentState) {
    var gdpr = {};

    if (consentState) {
        setGDPRConsentState(consentState.getGDPRConsentState());
    }

    function canonicalizeForDeduplication(purpose) {
        if (typeof(purpose) !== 'string') {
            return null;
        }
        var trimmedPurpose = purpose.trim();
        if (!trimmedPurpose.length) {
            return null;
        }
        return trimmedPurpose.toLowerCase();
    }

    function setGDPRConsentState(gdprConsentState) {
        if (!gdprConsentState) {
            gdpr = {};
        } else if (Helpers.isObject(gdprConsentState)) {
            gdpr = {};
            for (var purpose in gdprConsentState){
                if (gdprConsentState.hasOwnProperty(purpose)) {
                    addGDPRConsentState(purpose, gdprConsentState[purpose]);
                }
            }
        }
        return this;
    }

    function addGDPRConsentState(purpose, gdprConsent) {
        var normalizedPurpose = canonicalizeForDeduplication(purpose);
        if (!normalizedPurpose) {
            Helpers.logDebug('addGDPRConsentState() invoked with bad purpose. Purpose must be a string.');
            return this;
        }
        if (!Helpers.isObject(gdprConsent)) {
            Helpers.logDebug('addGDPRConsentState() invoked with bad or empty GDPR consent object.');
            return this;
        }
        var gdprConsentCopy = createGDPRConsent(gdprConsent.Consented, 
                gdprConsent.Timestamp,
                gdprConsent.ConsentDocument,
                gdprConsent.Location,
                gdprConsent.HardwareId);
        if (gdprConsentCopy) {
            gdpr[normalizedPurpose] = gdprConsentCopy;
        }
        return this;
    }

    function removeGDPRConsentState(purpose) {
        var normalizedPurpose = canonicalizeForDeduplication(purpose);
        if (!normalizedPurpose) {
            return this;
        }
        delete gdpr[normalizedPurpose];
        return this;
    }

    function getGDPRConsentState() {
        return Helpers.extend({}, gdpr);
    }

    return {
        setGDPRConsentState: setGDPRConsentState,
        addGDPRConsentState: addGDPRConsentState,
        getGDPRConsentState: getGDPRConsentState,
        removeGDPRConsentState: removeGDPRConsentState
    };
}


module.exports = {
    createGDPRConsent: createGDPRConsent,
    Serialization: ConsentSerialization,
    createConsentState: createConsentState
};

},{"./helpers":9}],3:[function(require,module,exports){
var v1ServiceUrl = 'jssdk.mparticle.com/v1/JS/',
    v1SecureServiceUrl = 'jssdks.mparticle.com/v1/JS/',
    v2ServiceUrl = 'jssdk.mparticle.com/v2/JS/',
    v2SecureServiceUrl = 'jssdks.mparticle.com/v2/JS/',
    identityUrl = 'https://identity.mparticle.com/v1/', //prod
    sdkVersion = '2.8.4',
    sdkVendor = 'mparticle',
    platform = 'web',
    Messages = {
        ErrorMessages: {
            NoToken: 'A token must be specified.',
            EventNameInvalidType: 'Event name must be a valid string value.',
            EventDataInvalidType: 'Event data must be a valid object hash.',
            LoggingDisabled: 'Event logging is currently disabled.',
            CookieParseError: 'Could not parse cookie',
            EventEmpty: 'Event object is null or undefined, cancelling send',
            APIRequestEmpty: 'APIRequest is null or undefined, cancelling send',
            NoEventType: 'Event type must be specified.',
            TransactionIdRequired: 'Transaction ID is required',
            TransactionRequired: 'A transaction attributes object is required',
            PromotionIdRequired: 'Promotion ID is required',
            BadAttribute: 'Attribute value cannot be object or array',
            BadKey: 'Key value cannot be object or array',
            BadLogPurchase: 'Transaction attributes and a product are both required to log a purchase, https://docs.mparticle.com/?javascript#measuring-transactions'
        },
        InformationMessages: {
            CookieSearch: 'Searching for cookie',
            CookieFound: 'Cookie found, parsing values',
            CookieNotFound: 'Cookies not found',
            CookieSet: 'Setting cookie',
            CookieSync: 'Performing cookie sync',
            SendBegin: 'Starting to send event',
            SendIdentityBegin: 'Starting to send event to identity server',
            SendWindowsPhone: 'Sending event to Windows Phone container',
            SendIOS: 'Calling iOS path: ',
            SendAndroid: 'Calling Android JS interface method: ',
            SendHttp: 'Sending event to mParticle HTTP service',
            SendIdentityHttp: 'Sending event to mParticle HTTP service',
            StartingNewSession: 'Starting new Session',
            StartingLogEvent: 'Starting to log event',
            StartingLogOptOut: 'Starting to log user opt in/out',
            StartingEndSession: 'Starting to end session',
            StartingInitialization: 'Starting to initialize',
            StartingLogCommerceEvent: 'Starting to log commerce event',
            LoadingConfig: 'Loading configuration options',
            AbandonLogEvent: 'Cannot log event, logging disabled or developer token not set',
            AbandonStartSession: 'Cannot start session, logging disabled or developer token not set',
            AbandonEndSession: 'Cannot end session, logging disabled or developer token not set',
            NoSessionToEnd: 'Cannot end session, no active session found'
        },
        ValidationMessages: {
            ModifyIdentityRequestUserIdentitiesPresent: 'identityRequests to modify require userIdentities to be present. Request not sent to server. Please fix and try again',
            IdentityRequesetInvalidKey: 'There is an invalid key on your identityRequest object. It can only contain a `userIdentities` object and a `onUserAlias` function. Request not sent to server. Please fix and try again.',
            OnUserAliasType: 'The onUserAlias value must be a function. The onUserAlias provided is of type',
            UserIdentities: 'The userIdentities key must be an object with keys of identityTypes and values of strings. Request not sent to server. Please fix and try again.',
            UserIdentitiesInvalidKey: 'There is an invalid identity key on your `userIdentities` object within the identityRequest. Request not sent to server. Please fix and try again.',
            UserIdentitiesInvalidValues: 'All user identity values must be strings or null. Request not sent to server. Please fix and try again.'

        }
    },
    NativeSdkPaths = {
        LogEvent: 'logEvent',
        SetUserTag: 'setUserTag',
        RemoveUserTag: 'removeUserTag',
        SetUserAttribute: 'setUserAttribute',
        RemoveUserAttribute: 'removeUserAttribute',
        SetSessionAttribute: 'setSessionAttribute',
        AddToCart: 'addToCart',
        RemoveFromCart: 'removeFromCart',
        ClearCart: 'clearCart',
        LogOut: 'logOut',
        SetUserAttributeList: 'setUserAttributeList',
        RemoveAllUserAttributes: 'removeAllUserAttributes',
        GetUserAttributesLists: 'getUserAttributesLists',
        GetAllUserAttributes: 'getAllUserAttributes',
        Identify: 'identify',
        Logout: 'logout',
        Login: 'login',
        Modify: 'modify'
    },
    DefaultConfig = {
        LocalStorageName: 'mprtcl-api',             // Name of the mP localstorage, had cp and pb even if cookies were used, skipped v2
        LocalStorageNameV3: 'mprtcl-v3',            // v3 Name of the mP localstorage, final version on SDKv1
        LocalStorageNameV4: 'mprtcl-v4',            // v4 Name of the mP localstorage, Current Version
        LocalStorageProductsV4: 'mprtcl-prodv4',    // The name for mP localstorage that contains products for cartProducs and productBags
        CookieName: 'mprtcl-api',                   // v1 Name of the cookie stored on the user's machine
        CookieNameV2: 'mprtcl-v2',                  // v2 Name of the cookie stored on the user's machine. Removed keys with no values, moved cartProducts and productBags to localStorage.
        CookieNameV3: 'mprtcl-v3',                  // v3 Name of the cookie stored on the user's machine. Base64 encoded keys in Base64CookieKeys object, final version on SDKv1
        CookieNameV4: 'mprtcl-v4',                  // v4 Name of the cookie stored on the user's machine. Base64 encoded keys in Base64CookieKeys object, current version on SDK v2
        CookieDomain: null, 			            // If null, defaults to current location.host
        Debug: false,					            // If true, will print debug messages to browser console
        CookieExpiration: 365,			            // Cookie expiration time in days
        LogLevel: null,					            // What logging will be provided in the console
        IncludeReferrer: true,			            // Include user's referrer
        IncludeGoogleAdwords: true,		            // Include utm_source and utm_properties
        Timeout: 300,					            // Timeout in milliseconds for logging functions
        SessionTimeout: 30,				            // Session timeout in minutes
        Sandbox: false,                             // Events are marked as debug and only forwarded to debug forwarders,
        Version: null,                              // The version of this website/app
        MaxProducts: 20,                            // Number of products persisted in cartProducts and productBags
        ForwarderStatsTimeout: 5000,                // Milliseconds for forwarderStats timeout
        IntegrationDelayTimeout: 5000,              // Milliseconds for forcing the integration delay to un-suspend event queueing due to integration partner errors
        MaxCookieSize: 3000                         // Number of bytes for cookie size to not exceed
    },
    Base64CookieKeys = {
        csm: 1,
        sa: 1,
        ss: 1,
        ua: 1,
        ui: 1,
        csd: 1,
        ia: 1,
        con: 1
    },
    SDKv2NonMPIDCookieKeys = {
        gs: 1,
        cu: 1,
        l: 1,
        globalSettings: 1,
        currentUserMPID: 1
    },
    HTTPCodes = {
        noHttpCoverage: -1,
        activeIdentityRequest: -2,
        activeSession: -3,
        validationIssue: -4,
        nativeIdentityRequest: -5,
        loggingDisabledOrMissingAPIKey: -6,
        tooManyRequests: 429
    },
    Features = {
        Batching: 'batching'
    };

module.exports = {
    v1ServiceUrl: v1ServiceUrl,
    v1SecureServiceUrl: v1SecureServiceUrl,
    v2ServiceUrl: v2ServiceUrl,
    v2SecureServiceUrl: v2SecureServiceUrl,
    identityUrl: identityUrl,
    sdkVersion: sdkVersion,
    sdkVendor: sdkVendor,
    platform: platform,
    Messages: Messages,
    NativeSdkPaths: NativeSdkPaths,
    DefaultConfig: DefaultConfig,
    Base64CookieKeys:Base64CookieKeys,
    HTTPCodes: HTTPCodes,
    Features: Features,
    SDKv2NonMPIDCookieKeys: SDKv2NonMPIDCookieKeys
};

},{}],4:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    Persistence = require('./persistence'),
    Messages = Constants.Messages,
    MP = require('./mp');

var cookieSyncManager = {
    attemptCookieSync: function(previousMPID, mpid) {
        var pixelConfig, lastSyncDateForModule, url, redirect, urlWithRedirect;
        if (mpid && !MP.webviewBridgeEnabled) {
            MP.pixelConfigurations.forEach(function(pixelSettings) {
                pixelConfig = {
                    moduleId: pixelSettings.moduleId,
                    frequencyCap: pixelSettings.frequencyCap,
                    pixelUrl: cookieSyncManager.replaceAmp(pixelSettings.pixelUrl),
                    redirectUrl: pixelSettings.redirectUrl ? cookieSyncManager.replaceAmp(pixelSettings.redirectUrl) : null
                };

                url = cookieSyncManager.replaceMPID(pixelConfig.pixelUrl, mpid);
                redirect = pixelConfig.redirectUrl ? cookieSyncManager.replaceMPID(pixelConfig.redirectUrl, mpid) : '';
                urlWithRedirect = url + encodeURIComponent(redirect);

                if (previousMPID && previousMPID !== mpid) {
                    cookieSyncManager.performCookieSync(urlWithRedirect, pixelConfig.moduleId);
                    return;
                } else {
                    lastSyncDateForModule = MP.cookieSyncDates[(pixelConfig.moduleId).toString()] ? MP.cookieSyncDates[(pixelConfig.moduleId).toString()] : null;

                    if (lastSyncDateForModule) {
                        // Check to see if we need to refresh cookieSync
                        if ((new Date()).getTime() > (new Date(lastSyncDateForModule).getTime() + (pixelConfig.frequencyCap * 60 * 1000 * 60 * 24))) {
                            cookieSyncManager.performCookieSync(urlWithRedirect, pixelConfig.moduleId);
                        }
                    } else {
                        cookieSyncManager.performCookieSync(urlWithRedirect, pixelConfig.moduleId);
                    }
                }
            });
        }
    },

    performCookieSync: function(url, moduleId) {
        var img = document.createElement('img');

        Helpers.logDebug(Messages.InformationMessages.CookieSync);

        img.src = url;
        MP.cookieSyncDates[moduleId.toString()] = (new Date()).getTime();
        Persistence.update();
    },

    replaceMPID: function(string, mpid) {
        return string.replace('%%mpid%%', mpid);
    },

    replaceAmp: function(string) {
        return string.replace(/&amp;/g, '&');
    }
};

module.exports = cookieSyncManager;

},{"./constants":3,"./helpers":9,"./mp":14,"./persistence":16}],5:[function(require,module,exports){
var Types = require('./types'),
    Helpers = require('./helpers'),
    Validators = Helpers.Validators,
    Messages = require('./constants').Messages,
    MP = require('./mp'),
    ServerModel = require('./serverModel');

function convertTransactionAttributesToProductAction(transactionAttributes, productAction) {
    productAction.TransactionId = transactionAttributes.Id;
    productAction.Affiliation = transactionAttributes.Affiliation;
    productAction.CouponCode = transactionAttributes.CouponCode;
    productAction.TotalAmount = transactionAttributes.Revenue;
    productAction.ShippingAmount = transactionAttributes.Shipping;
    productAction.TaxAmount = transactionAttributes.Tax;
}

function getProductActionEventName(productActionType) {
    switch (productActionType) {
        case Types.ProductActionType.AddToCart:
            return 'AddToCart';
        case Types.ProductActionType.AddToWishlist:
            return 'AddToWishlist';
        case Types.ProductActionType.Checkout:
            return 'Checkout';
        case Types.ProductActionType.CheckoutOption:
            return 'CheckoutOption';
        case Types.ProductActionType.Click:
            return 'Click';
        case Types.ProductActionType.Purchase:
            return 'Purchase';
        case Types.ProductActionType.Refund:
            return 'Refund';
        case Types.ProductActionType.RemoveFromCart:
            return 'RemoveFromCart';
        case Types.ProductActionType.RemoveFromWishlist:
            return 'RemoveFromWishlist';
        case Types.ProductActionType.ViewDetail:
            return 'ViewDetail';
        case Types.ProductActionType.Unknown:
        default:
            return 'Unknown';
    }
}

function getPromotionActionEventName(promotionActionType) {
    switch (promotionActionType) {
        case Types.PromotionActionType.PromotionClick:
            return 'PromotionClick';
        case Types.PromotionActionType.PromotionView:
            return 'PromotionView';
        default:
            return 'Unknown';
    }
}

function convertProductActionToEventType(productActionType) {
    switch (productActionType) {
        case Types.ProductActionType.AddToCart:
            return Types.CommerceEventType.ProductAddToCart;
        case Types.ProductActionType.AddToWishlist:
            return Types.CommerceEventType.ProductAddToWishlist;
        case Types.ProductActionType.Checkout:
            return Types.CommerceEventType.ProductCheckout;
        case Types.ProductActionType.CheckoutOption:
            return Types.CommerceEventType.ProductCheckoutOption;
        case Types.ProductActionType.Click:
            return Types.CommerceEventType.ProductClick;
        case Types.ProductActionType.Purchase:
            return Types.CommerceEventType.ProductPurchase;
        case Types.ProductActionType.Refund:
            return Types.CommerceEventType.ProductRefund;
        case Types.ProductActionType.RemoveFromCart:
            return Types.CommerceEventType.ProductRemoveFromCart;
        case Types.ProductActionType.RemoveFromWishlist:
            return Types.CommerceEventType.ProductRemoveFromWishlist;
        case Types.ProductActionType.Unknown:
            return Types.EventType.Unknown;
        case Types.ProductActionType.ViewDetail:
            return Types.CommerceEventType.ProductViewDetail;
        default:
            Helpers.logDebug('Could not convert product action type ' + productActionType + ' to event type');
            return null;
    }
}

function convertPromotionActionToEventType(promotionActionType) {
    switch (promotionActionType) {
        case Types.PromotionActionType.PromotionClick:
            return Types.CommerceEventType.PromotionClick;
        case Types.PromotionActionType.PromotionView:
            return Types.CommerceEventType.PromotionView;
        default:
            Helpers.logDebug('Could not convert promotion action type ' + promotionActionType + ' to event type');
            return null;
    }
}

function generateExpandedEcommerceName(eventName, plusOne) {
    return 'eCommerce - ' + eventName + ' - ' + (plusOne ? 'Total' : 'Item');
}

function extractProductAttributes(attributes, product) {
    if (product.CouponCode) {
        attributes['Coupon Code'] = product.CouponCode;
    }
    if (product.Brand) {
        attributes['Brand'] = product.Brand;
    }
    if (product.Category) {
        attributes['Category'] = product.Category;
    }
    if (product.Name) {
        attributes['Name'] = product.Name;
    }
    if (product.Sku) {
        attributes['Id'] = product.Sku;
    }
    if (product.Price) {
        attributes['Item Price'] = product.Price;
    }
    if (product.Quantity) {
        attributes['Quantity'] = product.Quantity;
    }
    if (product.Position) {
        attributes['Position'] = product.Position;
    }
    if (product.Variant) {
        attributes['Variant'] = product.Variant;
    }
    attributes['Total Product Amount'] = product.TotalAmount || 0;

}

function extractTransactionId(attributes, productAction) {
    if (productAction.TransactionId) {
        attributes['Transaction Id'] = productAction.TransactionId;
    }
}

function extractActionAttributes(attributes, productAction) {
    extractTransactionId(attributes, productAction);

    if (productAction.Affiliation) {
        attributes['Affiliation'] = productAction.Affiliation;
    }

    if (productAction.CouponCode) {
        attributes['Coupon Code'] = productAction.CouponCode;
    }

    if (productAction.TotalAmount) {
        attributes['Total Amount'] = productAction.TotalAmount;
    }

    if (productAction.ShippingAmount) {
        attributes['Shipping Amount'] = productAction.ShippingAmount;
    }

    if (productAction.TaxAmount) {
        attributes['Tax Amount'] = productAction.TaxAmount;
    }

    if (productAction.CheckoutOptions) {
        attributes['Checkout Options'] = productAction.CheckoutOptions;
    }

    if (productAction.CheckoutStep) {
        attributes['Checkout Step'] = productAction.CheckoutStep;
    }
}

function extractPromotionAttributes(attributes, promotion) {
    if (promotion.Id) {
        attributes['Id'] = promotion.Id;
    }

    if (promotion.Creative) {
        attributes['Creative'] = promotion.Creative;
    }

    if (promotion.Name) {
        attributes['Name'] = promotion.Name;
    }

    if (promotion.Position) {
        attributes['Position'] = promotion.Position;
    }
}

function buildProductList(event, product) {
    if (product) {
        if (Array.isArray(product)) {
            return product;
        }

        return [product];
    }

    return event.ShoppingCart.ProductList;
}

function createProduct(name,
    sku,
    price,
    quantity,
    variant,
    category,
    brand,
    position,
    couponCode,
    attributes) {

    attributes = Helpers.sanitizeAttributes(attributes);

    if (typeof name !== 'string') {
        Helpers.logDebug('Name is required when creating a product');
        return null;
    }

    if (!Validators.isStringOrNumber(sku)) {
        Helpers.logDebug('SKU is required when creating a product, and must be a string or a number');
        return null;
    }

    if (!Validators.isStringOrNumber(price)) {
        Helpers.logDebug('Price is required when creating a product, and must be a string or a number');
        return null;
    }

    if (!quantity) {
        quantity = 1;
    }

    return {
        Name: name,
        Sku: sku,
        Price: price,
        Quantity: quantity,
        Brand: brand,
        Variant: variant,
        Category: category,
        Position: position,
        CouponCode: couponCode,
        TotalAmount: quantity * price,
        Attributes: attributes
    };
}

function createPromotion(id, creative, name, position) {
    if (!Validators.isStringOrNumber(id)) {
        Helpers.logDebug(Messages.ErrorMessages.PromotionIdRequired);
        return null;
    }

    return {
        Id: id,
        Creative: creative,
        Name: name,
        Position: position
    };
}

function createImpression(name, product) {
    if (typeof name !== 'string') {
        Helpers.logDebug('Name is required when creating an impression.');
        return null;
    }

    if (!product) {
        Helpers.logDebug('Product is required when creating an impression.');
        return null;
    }

    return {
        Name: name,
        Product: product
    };
}

function createTransactionAttributes(id,
    affiliation,
    couponCode,
    revenue,
    shipping,
    tax) {

    if (!Validators.isStringOrNumber(id)) {
        Helpers.logDebug(Messages.ErrorMessages.TransactionIdRequired);
        return null;
    }

    return {
        Id: id,
        Affiliation: affiliation,
        CouponCode: couponCode,
        Revenue: revenue,
        Shipping: shipping,
        Tax: tax
    };
}

function expandProductImpression(commerceEvent) {
    var appEvents = [];
    if (!commerceEvent.ProductImpressions) {
        return appEvents;
    }
    commerceEvent.ProductImpressions.forEach(function(productImpression) {
        if (productImpression.ProductList) {
            productImpression.ProductList.forEach(function(product) {
                var attributes = Helpers.extend(false, {}, commerceEvent.EventAttributes);
                if (product.Attributes) {
                    for (var attribute in product.Attributes) {
                        attributes[attribute] = product.Attributes[attribute];
                    }
                }
                extractProductAttributes(attributes, product);
                if (productImpression.ProductImpressionList) {
                    attributes['Product Impression List'] = productImpression.ProductImpressionList;
                }
                var appEvent = ServerModel.createEventObject(Types.MessageType.PageEvent,
                        generateExpandedEcommerceName('Impression'),
                        attributes,
                        Types.EventType.Transaction
                    );
                appEvents.push(appEvent);
            });
        }
    });

    return appEvents;
}

function expandCommerceEvent(event) {
    if (!event) {
        return null;
    }
    return expandProductAction(event)
        .concat(expandPromotionAction(event))
        .concat(expandProductImpression(event));
}

function expandPromotionAction(commerceEvent) {
    var appEvents = [];
    if (!commerceEvent.PromotionAction) {
        return appEvents;
    }
    var promotions = commerceEvent.PromotionAction.PromotionList;
    promotions.forEach(function(promotion) {
        var attributes = Helpers.extend(false, {}, commerceEvent.EventAttributes);
        extractPromotionAttributes(attributes, promotion);

        var appEvent = ServerModel.createEventObject(Types.MessageType.PageEvent,
                generateExpandedEcommerceName(Types.PromotionActionType.getExpansionName(commerceEvent.PromotionAction.PromotionActionType)),
                attributes,
                Types.EventType.Transaction
            );
        appEvents.push(appEvent);
    });
    return appEvents;
}

function expandProductAction(commerceEvent) {
    var appEvents = [];
    if (!commerceEvent.ProductAction) {
        return appEvents;
    }
    var shouldExtractActionAttributes = false;
    if (commerceEvent.ProductAction.ProductActionType === Types.ProductActionType.Purchase ||
        commerceEvent.ProductAction.ProductActionType === Types.ProductActionType.Refund) {
        var attributes = Helpers.extend(false, {}, commerceEvent.EventAttributes);
        attributes['Product Count'] = commerceEvent.ProductAction.ProductList ? commerceEvent.ProductAction.ProductList.length : 0;
        extractActionAttributes(attributes, commerceEvent.ProductAction);
        if (commerceEvent.CurrencyCode) {
            attributes['Currency Code'] = commerceEvent.CurrencyCode;
        }
        var plusOneEvent = ServerModel.createEventObject(Types.MessageType.PageEvent,
            generateExpandedEcommerceName(Types.ProductActionType.getExpansionName(commerceEvent.ProductAction.ProductActionType), true),
            attributes,
            Types.EventType.Transaction
        );
        appEvents.push(plusOneEvent);
    }
    else {
        shouldExtractActionAttributes = true;
    }

    var products = commerceEvent.ProductAction.ProductList;

    if (!products) {
        return appEvents;
    }

    products.forEach(function(product) {
        var attributes = Helpers.extend(false, commerceEvent.EventAttributes, product.Attributes);
        if (shouldExtractActionAttributes) {
            extractActionAttributes(attributes, commerceEvent.ProductAction);
        }
        else {
            extractTransactionId(attributes, commerceEvent.ProductAction);
        }
        extractProductAttributes(attributes, product);

        var productEvent = ServerModel.createEventObject(Types.MessageType.PageEvent,
            generateExpandedEcommerceName(Types.ProductActionType.getExpansionName(commerceEvent.ProductAction.ProductActionType)),
            attributes,
            Types.EventType.Transaction
        );
        appEvents.push(productEvent);
    });

    return appEvents;
}

function createCommerceEventObject(customFlags) {
    var baseEvent;

    Helpers.logDebug(Messages.InformationMessages.StartingLogCommerceEvent);

    if (Helpers.canLog()) {
        baseEvent = ServerModel.createEventObject(Types.MessageType.Commerce);
        baseEvent.EventName = 'eCommerce - ';
        baseEvent.CurrencyCode = MP.currencyCode;
        baseEvent.ShoppingCart = {
            ProductList: MP.cartProducts
        };
        baseEvent.CustomFlags = customFlags;

        return baseEvent;
    }
    else {
        Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
    }

    return null;
}

module.exports = {
    convertTransactionAttributesToProductAction: convertTransactionAttributesToProductAction,
    getProductActionEventName: getProductActionEventName,
    getPromotionActionEventName: getPromotionActionEventName,
    convertProductActionToEventType: convertProductActionToEventType,
    convertPromotionActionToEventType: convertPromotionActionToEventType,
    generateExpandedEcommerceName: generateExpandedEcommerceName,
    extractProductAttributes: extractProductAttributes,
    extractActionAttributes: extractActionAttributes,
    extractPromotionAttributes: extractPromotionAttributes,
    extractTransactionId: extractTransactionId,
    buildProductList: buildProductList,
    createProduct: createProduct,
    createPromotion: createPromotion,
    createImpression: createImpression,
    createTransactionAttributes: createTransactionAttributes,
    expandCommerceEvent: expandCommerceEvent,
    createCommerceEventObject: createCommerceEventObject
};

},{"./constants":3,"./helpers":9,"./mp":14,"./serverModel":18,"./types":20}],6:[function(require,module,exports){
var Types = require('./types'),
    Constants = require('./constants'),
    Helpers = require('./helpers'),
    Ecommerce = require('./ecommerce'),
    ServerModel = require('./serverModel'),
    MP = require('./mp'),
    Persistence = require('./persistence'),
    Messages = Constants.Messages,
    sendEventToServer = require('./apiClient').sendEventToServer,
    sendEventToForwarders = require('./forwarders').sendEventToForwarders;

function logEvent(type, name, data, category, cflags) {
    Helpers.logDebug(Messages.InformationMessages.StartingLogEvent + ': ' + name);

    if (Helpers.canLog()) {
        startNewSessionIfNeeded();

        if (data) {
            data = Helpers.sanitizeAttributes(data);
        }

        sendEventToServer(ServerModel.createEventObject(type, name, data, category, cflags), sendEventToForwarders, parseEventResponse);
        Persistence.update();
    }
    else {
        Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
    }
}

function parseEventResponse(responseText) {
    var now = new Date(),
        settings,
        prop,
        fullProp;

    if (!responseText) {
        return;
    }

    try {
        Helpers.logDebug('Parsing response from server');
        settings = JSON.parse(responseText);

        if (settings && settings.Store) {
            Helpers.logDebug('Parsed store from response, updating local settings');

            if (!MP.serverSettings) {
                MP.serverSettings = {};
            }

            for (prop in settings.Store) {
                if (!settings.Store.hasOwnProperty(prop)) {
                    continue;
                }

                fullProp = settings.Store[prop];

                if (!fullProp.Value || new Date(fullProp.Expires) < now) {
                    // This setting should be deleted from the local store if it exists

                    if (MP.serverSettings.hasOwnProperty(prop)) {
                        delete MP.serverSettings[prop];
                    }
                }
                else {
                    // This is a valid setting
                    MP.serverSettings[prop] = fullProp;
                }
            }

            Persistence.update();
        }
    }
    catch (e) {
        Helpers.logDebug('Error parsing JSON response from server: ' + e.name);
    }
}

function startTracking() {
    if (!MP.isTracking) {
        if ('geolocation' in navigator) {
            MP.watchPositionId = navigator.geolocation.watchPosition(function(position) {
                MP.currentPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
            });

            MP.isTracking = true;
        }
    }
}

function stopTracking() {
    if (MP.isTracking) {
        navigator.geolocation.clearWatch(MP.watchPositionId);
        MP.currentPosition = null;
        MP.isTracking = false;
    }
}

function logOptOut() {
    Helpers.logDebug(Messages.InformationMessages.StartingLogOptOut);

    sendEventToServer(ServerModel.createEventObject(Types.MessageType.OptOut, null, null, Types.EventType.Other), sendEventToForwarders, parseEventResponse);
}

function logAST() {
    logEvent(Types.MessageType.AppStateTransition);
}

function logCheckoutEvent(step, options, attrs, customFlags) {
    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventName += Ecommerce.getProductActionEventName(Types.ProductActionType.Checkout);
        event.EventCategory = Types.CommerceEventType.ProductCheckout;
        event.ProductAction = {
            ProductActionType: Types.ProductActionType.Checkout,
            CheckoutStep: step,
            CheckoutOptions: options,
            ProductList: event.ShoppingCart.ProductList
        };

        logCommerceEvent(event, attrs);
    }
}

function logProductActionEvent(productActionType, product, attrs, customFlags) {
    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventCategory = Ecommerce.convertProductActionToEventType(productActionType);
        event.EventName += Ecommerce.getProductActionEventName(productActionType);
        event.ProductAction = {
            ProductActionType: productActionType,
            ProductList: Array.isArray(product) ? product : [product]
        };

        logCommerceEvent(event, attrs);
    }
}

function logPurchaseEvent(transactionAttributes, product, attrs, customFlags) {
    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventName += Ecommerce.getProductActionEventName(Types.ProductActionType.Purchase);
        event.EventCategory = Types.CommerceEventType.ProductPurchase;
        event.ProductAction = {
            ProductActionType: Types.ProductActionType.Purchase
        };
        event.ProductAction.ProductList = Ecommerce.buildProductList(event, product);

        Ecommerce.convertTransactionAttributesToProductAction(transactionAttributes, event.ProductAction);

        logCommerceEvent(event, attrs);
    }
}

function logRefundEvent(transactionAttributes, product, attrs, customFlags) {
    if (!transactionAttributes) {
        Helpers.logDebug(Messages.ErrorMessages.TransactionRequired);
        return;
    }

    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventName += Ecommerce.getProductActionEventName(Types.ProductActionType.Refund);
        event.EventCategory = Types.CommerceEventType.ProductRefund;
        event.ProductAction = {
            ProductActionType: Types.ProductActionType.Refund
        };
        event.ProductAction.ProductList = Ecommerce.buildProductList(event, product);

        Ecommerce.convertTransactionAttributesToProductAction(transactionAttributes, event.ProductAction);

        logCommerceEvent(event, attrs);
    }
}

function logPromotionEvent(promotionType, promotion, attrs, customFlags) {
    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventName += Ecommerce.getPromotionActionEventName(promotionType);
        event.EventCategory = Ecommerce.convertPromotionActionToEventType(promotionType);
        event.PromotionAction = {
            PromotionActionType: promotionType,
            PromotionList: [promotion]
        };

        logCommerceEvent(event, attrs);
    }
}

function logImpressionEvent(impression, attrs, customFlags) {
    var event = Ecommerce.createCommerceEventObject(customFlags);

    if (event) {
        event.EventName += 'Impression';
        event.EventCategory = Types.CommerceEventType.ProductImpression;
        if (!Array.isArray(impression)) {
            impression = [impression];
        }

        event.ProductImpressions = [];

        impression.forEach(function(impression) {
            event.ProductImpressions.push({
                ProductImpressionList: impression.Name,
                ProductList: Array.isArray(impression.Product) ? impression.Product : [impression.Product]
            });
        });

        logCommerceEvent(event, attrs);
    }
}


function logCommerceEvent(commerceEvent, attrs) {
    Helpers.logDebug(Messages.InformationMessages.StartingLogCommerceEvent);

    attrs = Helpers.sanitizeAttributes(attrs);

    if (Helpers.canLog()) {
        startNewSessionIfNeeded();
        if (MP.webviewBridgeEnabled) {
            // Don't send shopping cart to parent sdks
            commerceEvent.ShoppingCart = {};
        }

        if (attrs) {
            commerceEvent.EventAttributes = attrs;
        }

        sendEventToServer(commerceEvent, sendEventToForwarders, parseEventResponse);
        Persistence.update();
    }
    else {
        Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
    }
}

function addEventHandler(domEvent, selector, eventName, data, eventType) {
    var elements = [],
        handler = function(e) {
            var timeoutHandler = function() {
                if (element.href) {
                    window.location.href = element.href;
                }
                else if (element.submit) {
                    element.submit();
                }
            };

            Helpers.logDebug('DOM event triggered, handling event');

            logEvent(Types.MessageType.PageEvent,
                typeof eventName === 'function' ? eventName(element) : eventName,
                typeof data === 'function' ? data(element) : data,
                eventType || Types.EventType.Other);

            // TODO: Handle middle-clicks and special keys (ctrl, alt, etc)
            if ((element.href && element.target !== '_blank') || element.submit) {
                // Give xmlhttprequest enough time to execute before navigating a link or submitting form

                if (e.preventDefault) {
                    e.preventDefault();
                }
                else {
                    e.returnValue = false;
                }

                setTimeout(timeoutHandler, MP.Config.Timeout);
            }
        },
        element,
        i;

    if (!selector) {
        Helpers.logDebug('Can\'t bind event, selector is required');
        return;
    }

    // Handle a css selector string or a dom element
    if (typeof selector === 'string') {
        elements = document.querySelectorAll(selector);
    }
    else if (selector.nodeType) {
        elements = [selector];
    }

    if (elements.length) {
        Helpers.logDebug('Found ' +
            elements.length +
            ' element' +
            (elements.length > 1 ? 's' : '') +
            ', attaching event handlers');

        for (i = 0; i < elements.length; i++) {
            element = elements[i];

            if (element.addEventListener) {
                element.addEventListener(domEvent, handler, false);
            }
            else if (element.attachEvent) {
                element.attachEvent('on' + domEvent, handler);
            }
            else {
                element['on' + domEvent] = handler;
            }
        }
    }
    else {
        Helpers.logDebug('No elements found');
    }
}

function startNewSessionIfNeeded() {
    if (!MP.webviewBridgeEnabled) {
        var cookies = Persistence.getCookie() || Persistence.getLocalStorage();

        if (!MP.sessionId && cookies) {
            if (cookies.sid) {
                MP.sessionId = cookies.sid;
            } else {
                mParticle.startNewSession();
            }
        }
    }
}

module.exports = {
    logEvent: logEvent,
    startTracking: startTracking,
    stopTracking: stopTracking,
    logCheckoutEvent: logCheckoutEvent,
    logProductActionEvent: logProductActionEvent,
    logPurchaseEvent: logPurchaseEvent,
    logRefundEvent: logRefundEvent,
    logPromotionEvent: logPromotionEvent,
    logImpressionEvent: logImpressionEvent,
    logOptOut: logOptOut,
    logAST: logAST,
    parseEventResponse: parseEventResponse,
    logCommerceEvent: logCommerceEvent,
    addEventHandler: addEventHandler,
    startNewSessionIfNeeded: startNewSessionIfNeeded
};

},{"./apiClient":1,"./constants":3,"./ecommerce":5,"./forwarders":7,"./helpers":9,"./mp":14,"./persistence":16,"./serverModel":18,"./types":20}],7:[function(require,module,exports){
var Helpers = require('./helpers'),
    Types = require('./types'),
    Constants = require('./constants'),
    MParticleUser = require('./mParticleUser'),
    ApiClient = require('./apiClient'),
    Persistence = require('./persistence'),
    MP = require('./mp');

function initForwarders(userIdentities) {
    var user = mParticle.Identity.getCurrentUser();
    if (!MP.webviewBridgeEnabled && MP.configuredForwarders) {
        // Some js libraries require that they be loaded first, or last, etc
        MP.configuredForwarders.sort(function(x, y) {
            x.settings.PriorityValue = x.settings.PriorityValue || 0;
            y.settings.PriorityValue = y.settings.PriorityValue || 0;
            return -1 * (x.settings.PriorityValue - y.settings.PriorityValue);
        });

        MP.activeForwarders = MP.configuredForwarders.filter(function(forwarder) {
            if (!isEnabledForUserConsent(forwarder.filteringConsentRuleValues, user)) {
                return false;
            }
            if (!isEnabledForUserAttributes(forwarder.filteringUserAttributeValue, user)) {
                return false;
            }
            if (!isEnabledForUnknownUser(forwarder.excludeAnonymousUser, user)) {
                return false;
            }

            var filteredUserIdentities = Helpers.filterUserIdentities(userIdentities, forwarder.userIdentityFilters);
            var filteredUserAttributes = Helpers.filterUserAttributes(MP.userAttributes, forwarder.userAttributeFilters);

            if (!forwarder.initialized) {
                forwarder.init(forwarder.settings,
                    prepareForwardingStats,
                    false,
                    null,
                    filteredUserAttributes,
                    filteredUserIdentities,
                    MP.appVersion,
                    MP.appName,
                    MP.customFlags,
                    MP.clientId);
                forwarder.initialized = true;
            }

            return true;
        });
    }
}

function isEnabledForUserConsent(consentRules, user) {
    if (!consentRules
        || !consentRules.values
        || !consentRules.values.length) {
        return true;
    }
    if (!user) {
        return false;
    }
    var purposeHashes = {};
    var GDPRConsentHashPrefix = '1';
    var consentState = user.getConsentState();
    if (consentState) {
        var gdprConsentState = consentState.getGDPRConsentState();
        if (gdprConsentState) {
            for (var purpose in gdprConsentState) {
                if (gdprConsentState.hasOwnProperty(purpose)) {
                    var purposeHash = Helpers.generateHash(GDPRConsentHashPrefix + purpose).toString();
                    purposeHashes[purposeHash] = gdprConsentState[purpose].Consented;
                }
            }
        }
    }
    var isMatch = false;
    consentRules.values.forEach(function(consentRule) {
        if (!isMatch) {
            var purposeHash = consentRule.consentPurpose;
            var hasConsented = consentRule.hasConsented;
            if (purposeHashes.hasOwnProperty(purposeHash)
                && purposeHashes[purposeHash] === hasConsented) {
                isMatch = true;
            }
        }
    });

    return consentRules.includeOnMatch === isMatch;
}

function isEnabledForUserAttributes(filterObject, user) {
    if (!filterObject ||
        !Helpers.isObject(filterObject) ||
        !Object.keys(filterObject).length) {
        return true;
    }

    var attrHash,
        valueHash,
        userAttributes;

    if (!user) {
        return false;
    } else {
        userAttributes = user.getAllUserAttributes();
    }

    var isMatch = false;

    try {
        if (userAttributes && Helpers.isObject(userAttributes) && Object.keys(userAttributes).length) {
            for (var attrName in userAttributes) {
                if (userAttributes.hasOwnProperty(attrName)) {
                    attrHash = Helpers.generateHash(attrName).toString();
                    valueHash = Helpers.generateHash(userAttributes[attrName]).toString();

                    if ((attrHash === filterObject.userAttributeName) && (valueHash === filterObject.userAttributeValue)) {
                        isMatch = true;
                        break;
                    }
                }
            }
        }

        if (filterObject) {
            return filterObject.includeOnMatch === isMatch;
        } else {
            return true;
        }
    } catch (e) {
        // in any error scenario, err on side of returning true and forwarding event
        return true;
    }
}

function isEnabledForUnknownUser(excludeAnonymousUserBoolean, user) {
    if (!user || !user.isLoggedIn()) {
        if (excludeAnonymousUserBoolean) {
            return false;
        }
    }
    return true;
}

function applyToForwarders(functionName, functionArgs) {
    if (MP.activeForwarders.length) {
        MP.activeForwarders.forEach(function(forwarder) {
            var forwarderFunction = forwarder[functionName];
            if (forwarderFunction) {
                try {
                    var result = forwarder[functionName](functionArgs);

                    if (result) {
                        Helpers.logDebug(result);
                    }
                }
                catch (e) {
                    Helpers.logDebug(e);
                }
            }
        });
    }
}

function sendEventToForwarders(event) {
    var clonedEvent,
        hashedEventName,
        hashedEventType,
        filterUserIdentities = function(event, filterList) {
            if (event.UserIdentities && event.UserIdentities.length) {
                event.UserIdentities.forEach(function(userIdentity, i) {
                    if (Helpers.inArray(filterList, userIdentity.Type)) {
                        event.UserIdentities.splice(i, 1);

                        if (i > 0) {
                            i--;
                        }
                    }
                });
            }
        },

        filterAttributes = function(event, filterList) {
            var hash;

            if (!filterList) {
                return;
            }

            for (var attrName in event.EventAttributes) {
                if (event.EventAttributes.hasOwnProperty(attrName)) {
                    hash = Helpers.generateHash(event.EventCategory + event.EventName + attrName);

                    if (Helpers.inArray(filterList, hash)) {
                        delete event.EventAttributes[attrName];
                    }
                }
            }
        },
        inFilteredList = function(filterList, hash) {
            if (filterList && filterList.length) {
                if (Helpers.inArray(filterList, hash)) {
                    return true;
                }
            }

            return false;
        },
        forwardingRuleMessageTypes = [
            Types.MessageType.PageEvent,
            Types.MessageType.PageView,
            Types.MessageType.Commerce
        ];

    if (!MP.webviewBridgeEnabled && MP.activeForwarders) {
        hashedEventName = Helpers.generateHash(event.EventCategory + event.EventName);
        hashedEventType = Helpers.generateHash(event.EventCategory);

        for (var i = 0; i < MP.activeForwarders.length; i++) {
            // Check attribute forwarding rule. This rule allows users to only forward an event if a
            // specific attribute exists and has a specific value. Alternatively, they can specify
            // that an event not be forwarded if the specified attribute name and value exists.
            // The two cases are controlled by the "includeOnMatch" boolean value.
            // Supported message types for attribute forwarding rules are defined in the forwardingRuleMessageTypes array

            if (forwardingRuleMessageTypes.indexOf(event.EventDataType) > -1
                && MP.activeForwarders[i].filteringEventAttributeValue
                && MP.activeForwarders[i].filteringEventAttributeValue.eventAttributeName
                && MP.activeForwarders[i].filteringEventAttributeValue.eventAttributeValue) {

                var foundProp = null;

                // Attempt to find the attribute in the collection of event attributes
                if (event.EventAttributes) {
                    for (var prop in event.EventAttributes) {
                        var hashedEventAttributeName;
                        hashedEventAttributeName = Helpers.generateHash(prop).toString();

                        if (hashedEventAttributeName === MP.activeForwarders[i].filteringEventAttributeValue.eventAttributeName) {
                            foundProp = {
                                name: hashedEventAttributeName,
                                value: Helpers.generateHash(event.EventAttributes[prop]).toString()
                            };
                        }

                        break;
                    }
                }

                var isMatch = foundProp !== null && foundProp.value === MP.activeForwarders[i].filteringEventAttributeValue.eventAttributeValue;

                var shouldInclude = MP.activeForwarders[i].filteringEventAttributeValue.includeOnMatch === true ? isMatch : !isMatch;

                if (!shouldInclude) {
                    continue;
                }
            }

            // Clone the event object, as we could be sending different attributes to each forwarder
            clonedEvent = {};
            clonedEvent = Helpers.extend(true, clonedEvent, event);
            // Check event filtering rules
            if (event.EventDataType === Types.MessageType.PageEvent
                && (inFilteredList(MP.activeForwarders[i].eventNameFilters, hashedEventName)
                    || inFilteredList(MP.activeForwarders[i].eventTypeFilters, hashedEventType))) {
                continue;
            }
            else if (event.EventDataType === Types.MessageType.Commerce && inFilteredList(MP.activeForwarders[i].eventTypeFilters, hashedEventType)) {
                continue;
            }
            else if (event.EventDataType === Types.MessageType.PageView && inFilteredList(MP.activeForwarders[i].screenNameFilters, hashedEventName)) {
                continue;
            }

            // Check attribute filtering rules
            if (clonedEvent.EventAttributes) {
                if (event.EventDataType === Types.MessageType.PageEvent) {
                    filterAttributes(clonedEvent, MP.activeForwarders[i].attributeFilters);
                }
                else if (event.EventDataType === Types.MessageType.PageView) {
                    filterAttributes(clonedEvent, MP.activeForwarders[i].pageViewAttributeFilters);
                }
            }

            // Check user identity filtering rules
            filterUserIdentities(clonedEvent, MP.activeForwarders[i].userIdentityFilters);

            // Check user attribute filtering rules
            clonedEvent.UserAttributes = Helpers.filterUserAttributes(clonedEvent.UserAttributes, MP.activeForwarders[i].userAttributeFilters);

            Helpers.logDebug('Sending message to forwarder: ' + MP.activeForwarders[i].name);

            if (MP.activeForwarders[i].process) {
                var result = MP.activeForwarders[i].process(clonedEvent);

                if (result) {
                    Helpers.logDebug(result);
                }
            }

        }
    }
}

function callSetUserAttributeOnForwarders(key, value) {
    if (MP.activeForwarders.length) {
        MP.activeForwarders.forEach(function(forwarder) {
            if (forwarder.setUserAttribute &&
                forwarder.userAttributeFilters &&
                !Helpers.inArray(forwarder.userAttributeFilters, Helpers.generateHash(key))) {

                try {
                    var result = forwarder.setUserAttribute(key, value);

                    if (result) {
                        Helpers.logDebug(result);
                    }
                }
                catch (e) {
                    Helpers.logDebug(e);
                }
            }
        });
    }
}

function setForwarderUserIdentities(userIdentities) {
    MP.activeForwarders.forEach(function(forwarder) {
        var filteredUserIdentities = Helpers.filterUserIdentities(userIdentities, forwarder.userIdentityFilters);
        if (forwarder.setUserIdentity) {
            filteredUserIdentities.forEach(function(identity) {
                var result = forwarder.setUserIdentity(identity.Identity, identity.Type);
                if (result) {
                    Helpers.logDebug(result);
                }
            });
        }
    });
}

function setForwarderOnUserIdentified(user) {
    MP.activeForwarders.forEach(function(forwarder) {
        var filteredUser = MParticleUser.getFilteredMparticleUser(user.getMPID(), forwarder);
        if (forwarder.onUserIdentified) {
            var result = forwarder.onUserIdentified(filteredUser);
            if (result) {
                Helpers.logDebug(result);
            }
        }
    });
}

function setForwarderOnIdentityComplete(user, identityMethod) {
    var result;

    MP.activeForwarders.forEach(function(forwarder) {
        var filteredUser = MParticleUser.getFilteredMparticleUser(user.getMPID(), forwarder);
        if (identityMethod === 'identify') {
            if (forwarder.onIdentifyComplete) {
                result = forwarder.onIdentifyComplete(filteredUser);
                if (result) {
                    Helpers.logDebug(result);
                }
            }
        }
        else if (identityMethod === 'login') {
            if (forwarder.onLoginComplete) {
                result = forwarder.onLoginComplete(filteredUser);
                if (result) {
                    Helpers.logDebug(result);
                }
            }
        } else if (identityMethod === 'logout') {
            if (forwarder.onLogoutComplete) {
                result = forwarder.onLogoutComplete(filteredUser);
                if (result) {
                    Helpers.logDebug(result);
                }
            }
        } else if (identityMethod === 'modify') {
            if (forwarder.onModifyComplete) {
                result = forwarder.onModifyComplete(filteredUser);
                if (result) {
                    Helpers.logDebug(result);
                }
            }
        }
    });
}

function prepareForwardingStats(forwarder, event) {
    var forwardingStatsData,
        queue = getForwarderStatsQueue();

    if (forwarder && forwarder.isVisible) {
        forwardingStatsData = {
            mid: forwarder.id,
            esid: forwarder.eventSubscriptionId,
            n: event.EventName,
            attrs: event.EventAttributes,
            sdk: event.SDKVersion,
            dt: event.EventDataType,
            et: event.EventCategory,
            dbg: event.Debug,
            ct: event.Timestamp,
            eec: event.ExpandedEventCount
        };

        if (Helpers.hasFeatureFlag(Constants.Features.Batching)) {
            queue.push(forwardingStatsData);
            setForwarderStatsQueue(queue);
        } else {
            ApiClient.sendSingleForwardingStatsToServer(forwardingStatsData);
        }
    }
}

function getForwarderStatsQueue() {
    return Persistence.forwardingStatsBatches.forwardingStatsEventQueue;
}

function setForwarderStatsQueue(queue) {
    Persistence.forwardingStatsBatches.forwardingStatsEventQueue = queue;
}

module.exports = {
    initForwarders: initForwarders,
    applyToForwarders: applyToForwarders,
    sendEventToForwarders: sendEventToForwarders,
    callSetUserAttributeOnForwarders: callSetUserAttributeOnForwarders,
    setForwarderUserIdentities: setForwarderUserIdentities,
    setForwarderOnUserIdentified: setForwarderOnUserIdentified,
    setForwarderOnIdentityComplete: setForwarderOnIdentityComplete,
    prepareForwardingStats: prepareForwardingStats,
    getForwarderStatsQueue: getForwarderStatsQueue,
    setForwarderStatsQueue: setForwarderStatsQueue,
    isEnabledForUserConsent: isEnabledForUserConsent,
    isEnabledForUserAttributes: isEnabledForUserAttributes
};

},{"./apiClient":1,"./constants":3,"./helpers":9,"./mParticleUser":11,"./mp":14,"./persistence":16,"./types":20}],8:[function(require,module,exports){
var ApiClient = require('./apiClient'),
    Helpers = require('./helpers'),
    Forwarders = require('./forwarders'),
    MP = require('./mp'),
    Persistence = require('./persistence');

function startForwardingStatsTimer() {
    mParticle._forwardingStatsTimer = setInterval(function() {
        prepareAndSendForwardingStatsBatch();
    }, MP.Config.ForwarderStatsTimeout);
}

function prepareAndSendForwardingStatsBatch() {
    var forwarderQueue = Forwarders.getForwarderStatsQueue(),
        uploadsTable = Persistence.forwardingStatsBatches.uploadsTable,
        now = Date.now();

    if (forwarderQueue.length) {
        uploadsTable[now] = {uploading: false, data: forwarderQueue};
        Forwarders.setForwarderStatsQueue([]);
    }

    for (var date in uploadsTable) {
        (function(date) {
            if (uploadsTable.hasOwnProperty(date)) {
                if (uploadsTable[date].uploading === false) {
                    var xhrCallback = function() {
                        if (xhr.readyState === 4) {
                            if (xhr.status === 200 || xhr.status === 202) {
                                Helpers.logDebug('Successfully sent  ' + xhr.statusText + ' from server');
                                delete uploadsTable[date];
                            } else if (xhr.status.toString()[0] === '4') {
                                if (xhr.status !== 429) {
                                    delete uploadsTable[date];
                                }
                            }
                            else {
                                uploadsTable[date].uploading = false;
                            }
                        }
                    };

                    var xhr = Helpers.createXHR(xhrCallback);
                    var forwardingStatsData = uploadsTable[date].data;
                    uploadsTable[date].uploading = true;
                    ApiClient.sendBatchForwardingStatsToServer(forwardingStatsData, xhr);
                }
            }
        })(date);
    }
}

module.exports = {
    startForwardingStatsTimer: startForwardingStatsTimer
};

},{"./apiClient":1,"./forwarders":7,"./helpers":9,"./mp":14,"./persistence":16}],9:[function(require,module,exports){
var Types = require('./types'),
    Constants = require('./constants'),
    Messages = Constants.Messages,
    MP = require('./mp'),
    pluses = /\+/g,
    serviceScheme = window.mParticle && window.mParticle.forceHttps ? 'https://' : window.location.protocol + '//';

function logDebug(msg) {
    if (MP.logLevel === 'verbose' && window.console && window.console.log) {
        window.console.log(msg);
    }
}

function canLog() {
    if (MP.isEnabled && (MP.devToken || MP.webviewBridgeEnabled)) {
        return true;
    }

    return false;
}

function returnConvertedBoolean(data) {
    if (data === 'false' || data === '0') {
        return false;
    } else {
        return Boolean(data);
    }
}

function hasFeatureFlag(feature) {
    return MP.featureFlags[feature];
}

function invokeCallback(callback, code, body, mParticleUser) {
    try {
        if (Validators.isFunction(callback)) {
            callback({
                httpCode: code,
                body: body,
                getUser: function() {
                    if (mParticleUser) {
                        return mParticleUser;
                    } else {
                        return mParticle.Identity.getCurrentUser();
                    }
                }
            });
        }
    } catch (e) {
        logDebug('There was an error with your callback: ' + e);
    }
}

// Standalone version of jQuery.extend, from https://github.com/dansdom/extend
function extend() {
    var options, name, src, copy, copyIsArray, clone,
        target = arguments[0] || {},
        i = 1,
        length = arguments.length,
        deep = false,
        // helper which replicates the jquery internal functions
        objectHelper = {
            hasOwn: Object.prototype.hasOwnProperty,
            class2type: {},
            type: function(obj) {
                return obj == null ?
                    String(obj) :
                    objectHelper.class2type[Object.prototype.toString.call(obj)] || 'object';
            },
            isPlainObject: function(obj) {
                if (!obj || objectHelper.type(obj) !== 'object' || obj.nodeType || objectHelper.isWindow(obj)) {
                    return false;
                }

                try {
                    if (obj.constructor &&
                        !objectHelper.hasOwn.call(obj, 'constructor') &&
                        !objectHelper.hasOwn.call(obj.constructor.prototype, 'isPrototypeOf')) {
                        return false;
                    }
                } catch (e) {
                    return false;
                }

                var key;
                for (key in obj) { } // eslint-disable-line no-empty

                return key === undefined || objectHelper.hasOwn.call(obj, key);
            },
            isArray: Array.isArray || function(obj) {
                return objectHelper.type(obj) === 'array';
            },
            isFunction: function(obj) {
                return objectHelper.type(obj) === 'function';
            },
            isWindow: function(obj) {
                return obj != null && obj == obj.window;
            }
        };  // end of objectHelper

    // Handle a deep copy situation
    if (typeof target === 'boolean') {
        deep = target;
        target = arguments[1] || {};
        // skip the boolean and the target
        i = 2;
    }

    // Handle case when target is a string or something (possible in deep copy)
    if (typeof target !== 'object' && !objectHelper.isFunction(target)) {
        target = {};
    }

    // If no second argument is used then this can extend an object that is using this method
    if (length === i) {
        target = this;
        --i;
    }

    for (; i < length; i++) {
        // Only deal with non-null/undefined values
        if ((options = arguments[i]) != null) {
            // Extend the base object
            for (name in options) {
                src = target[name];
                copy = options[name];

                // Prevent never-ending loop
                if (target === copy) {
                    continue;
                }

                // Recurse if we're merging plain objects or arrays
                if (deep && copy && (objectHelper.isPlainObject(copy) || (copyIsArray = objectHelper.isArray(copy)))) {
                    if (copyIsArray) {
                        copyIsArray = false;
                        clone = src && objectHelper.isArray(src) ? src : [];

                    } else {
                        clone = src && objectHelper.isPlainObject(src) ? src : {};
                    }

                    // Never move original objects, clone them
                    target[name] = extend(deep, clone, copy);

                    // Don't bring in undefined values
                } else if (copy !== undefined) {
                    target[name] = copy;
                }
            }
        }
    }

    // Return the modified object
    return target;
}

function isObject(value) {
    var objType = Object.prototype.toString.call(value);

    return objType === '[object Object]'
        || objType === '[object Error]';
}

function inArray(items, name) {
    var i = 0;

    if (Array.prototype.indexOf) {
        return items.indexOf(name, 0) >= 0;
    }
    else {
        for (var n = items.length; i < n; i++) {
            if (i in items && items[i] === name) {
                return true;
            }
        }
    }
}

function createServiceUrl(secureServiceUrl, serviceUrl, devToken) {
    if (mParticle.forceHttps) {
        return 'https://' + secureServiceUrl + devToken;
    } else {
        return serviceScheme + ((window.location.protocol === 'https:') ? secureServiceUrl : serviceUrl) + devToken;
    }
}

function createXHR(cb) {
    var xhr;

    try {
        xhr = new window.XMLHttpRequest();
    }
    catch (e) {
        logDebug('Error creating XMLHttpRequest object.');
    }

    if (xhr && cb && 'withCredentials' in xhr) {
        xhr.onreadystatechange = cb;
    }
    else if (typeof window.XDomainRequest !== 'undefined') {
        logDebug('Creating XDomainRequest object');

        try {
            xhr = new window.XDomainRequest();
            xhr.onload = cb;
        }
        catch (e) {
            logDebug('Error creating XDomainRequest object');
        }
    }

    return xhr;
}

function generateRandomValue(a) {
    var randomValue;
    if (window.crypto && window.crypto.getRandomValues) {
        randomValue = window.crypto.getRandomValues(new Uint8Array(1)); // eslint-disable-line no-undef
    }
    if (randomValue) {
        return (a ^ randomValue[0] % 16 >> a/4).toString(16);
    }

    return (a ^ Math.random() * 16 >> a/4).toString(16);
}

function generateUniqueId(a) {
    // https://gist.github.com/jed/982883
    // Added support for crypto for better random

    return a                            // if the placeholder was passed, return
            ? generateRandomValue(a)    // a random number
            : (                         // or otherwise a concatenated string:
            [1e7] +                     // 10000000 +
            -1e3 +                      // -1000 +
            -4e3 +                      // -4000 +
            -8e3 +                      // -80000000 +
            -1e11                       // -100000000000,
            ).replace(                  // replacing
                /[018]/g,               // zeroes, ones, and eights with
                generateUniqueId        // random hex digits
            );
}

function filterUserIdentities(userIdentitiesObject, filterList) {
    var filteredUserIdentities = [];

    if (userIdentitiesObject && Object.keys(userIdentitiesObject).length) {
        for (var userIdentityName in userIdentitiesObject) {
            if (userIdentitiesObject.hasOwnProperty(userIdentityName)) {
                var userIdentityType = Types.IdentityType.getIdentityType(userIdentityName);
                if (!inArray(filterList, userIdentityType)) {
                    var identity = {
                        Type: userIdentityType,
                        Identity: userIdentitiesObject[userIdentityName]
                    };
                    if (userIdentityType === mParticle.IdentityType.CustomerId) {
                        filteredUserIdentities.unshift(identity);
                    } else {
                        filteredUserIdentities.push(identity);
                    }
                }
            }
        }
    }

    return filteredUserIdentities;
}

function filterUserIdentitiesForForwarders(userIdentitiesObject, filterList) {
    var filteredUserIdentities = {};

    if (userIdentitiesObject && Object.keys(userIdentitiesObject).length) {
        for (var userIdentityName in userIdentitiesObject) {
            if (userIdentitiesObject.hasOwnProperty(userIdentityName)) {
                var userIdentityType = Types.IdentityType.getIdentityType(userIdentityName);
                if (!inArray(filterList, userIdentityType)) {
                    filteredUserIdentities[userIdentityName] = userIdentitiesObject[userIdentityName];
                }
            }
        }
    }

    return filteredUserIdentities;
}

function filterUserAttributes(userAttributes, filterList) {
    var filteredUserAttributes = {};

    if (userAttributes && Object.keys(userAttributes).length) {
        for (var userAttribute in userAttributes) {
            if (userAttributes.hasOwnProperty(userAttribute)) {
                var hashedUserAttribute = generateHash(userAttribute);
                if (!inArray(filterList, hashedUserAttribute)) {
                    filteredUserAttributes[userAttribute] = userAttributes[userAttribute];
                }
            }
        }
    }

    return filteredUserAttributes;
}

function findKeyInObject(obj, key) {
    if (key && obj) {
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop) && prop.toLowerCase() === key.toLowerCase()) {
                return prop;
            }
        }
    }

    return null;
}

function decoded(s) {
    return decodeURIComponent(s.replace(pluses, ' '));
}

function converted(s) {
    if (s.indexOf('"') === 0) {
        s = s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    return s;
}

function isEventType(type) {
    for (var prop in Types.EventType) {
        if (Types.EventType.hasOwnProperty(prop)) {
            if (Types.EventType[prop] === type) {
                return true;
            }
        }
    }
    return false;
}

function parseNumber(value) {
    if (isNaN(value) || !isFinite(value)) {
        return 0;
    }
    var floatValue = parseFloat(value);
    return isNaN(floatValue) ? 0 : floatValue;
}

function parseStringOrNumber(value) {
    if (Validators.isStringOrNumber(value)) {
        return value;
    } else {
        return null;
    }
}

function generateHash(name) {
    var hash = 0,
        i = 0,
        character;

    if (name === undefined || name === null) {
        return 0;
    }

    name = name.toString().toLowerCase();

    if (Array.prototype.reduce) {
        return name.split('').reduce(function(a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
    }

    if (name.length === 0) {
        return hash;
    }

    for (i = 0; i < name.length; i++) {
        character = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + character;
        hash = hash & hash;
    }

    return hash;
}

function sanitizeAttributes(attrs) {
    if (!attrs || !isObject(attrs)) {
        return null;
    }

    var sanitizedAttrs = {};

    for (var prop in attrs) {
        // Make sure that attribute values are not objects or arrays, which are not valid
        if (attrs.hasOwnProperty(prop) && Validators.isValidAttributeValue(attrs[prop])) {
            sanitizedAttrs[prop] = attrs[prop];
        } else {
            logDebug('The attribute key of ' + prop + ' must be a string, number, boolean, or null.');
        }
    }

    return sanitizedAttrs;
}

function mergeConfig(config) {
    logDebug(Messages.InformationMessages.LoadingConfig);

    for (var prop in Constants.DefaultConfig) {
        if (Constants.DefaultConfig.hasOwnProperty(prop)) {
            MP.Config[prop] = Constants.DefaultConfig[prop];
        }

        if (config.hasOwnProperty(prop)) {
            MP.Config[prop] = config[prop];
        }
    }
}

var Validators = {
    isValidAttributeValue: function(value) {
        return value !== undefined && !isObject(value) && !Array.isArray(value);
    },

    // Neither null nor undefined can be a valid Key
    isValidKeyValue: function(key) {
        return Boolean(key && !isObject(key) && !Array.isArray(key));
    },

    isStringOrNumber: function(value) {
        return (typeof value === 'string' || typeof value === 'number');
    },

    isFunction: function(fn) {
        return typeof fn === 'function';
    },

    validateIdentities: function(identityApiData, method) {
        var validIdentityRequestKeys = {
            userIdentities: 1,
            onUserAlias: 1,
            copyUserAttributes: 1
        };
        if (identityApiData) {
            if (method === 'modify') {
                if (isObject(identityApiData.userIdentities) && !Object.keys(identityApiData.userIdentities).length || !isObject(identityApiData.userIdentities)) {
                    return {
                        valid: false,
                        error: Constants.Messages.ValidationMessages.ModifyIdentityRequestUserIdentitiesPresent
                    };
                }
            }
            for (var key in identityApiData) {
                if (identityApiData.hasOwnProperty(key)) {
                    if (!validIdentityRequestKeys[key]) {
                        return {
                            valid: false,
                            error: Constants.Messages.ValidationMessages.IdentityRequesetInvalidKey
                        };
                    }
                    if (key === 'onUserAlias' && !Validators.isFunction(identityApiData[key])) {
                        return {
                            valid: false,
                            error: Constants.Messages.ValidationMessages.OnUserAliasType + typeof identityApiData[key]
                        };
                    }
                }
            }
            if (Object.keys(identityApiData).length === 0) {
                return {
                    valid: true
                };
            } else {
                // identityApiData.userIdentities can't be undefined
                if (identityApiData.userIdentities === undefined) {
                    return {
                        valid: false,
                        error: Constants.Messages.ValidationMessages.UserIdentities
                    };
                // identityApiData.userIdentities can be null, but if it isn't null or undefined (above conditional), it must be an object
                } else if (identityApiData.userIdentities !== null && !isObject(identityApiData.userIdentities)) {
                    return {
                        valid: false,
                        error: Constants.Messages.ValidationMessages.UserIdentities
                    };
                }
                if (isObject(identityApiData.userIdentities) && Object.keys(identityApiData.userIdentities).length) {
                    for (var identityType in identityApiData.userIdentities) {
                        if (identityApiData.userIdentities.hasOwnProperty(identityType)) {
                            if (Types.IdentityType.getIdentityType(identityType) === false) {
                                return {
                                    valid: false,
                                    error: Constants.Messages.ValidationMessages.UserIdentitiesInvalidKey
                                };
                            }
                            if (!(typeof identityApiData.userIdentities[identityType] === 'string' || identityApiData.userIdentities[identityType] === null)) {
                                return {
                                    valid: false,
                                    error: Constants.Messages.ValidationMessages.UserIdentitiesInvalidValues
                                };
                            }
                        }
                    }
                }
            }
        }
        return {
            valid: true
        };
    }
};

function isDelayedByIntegration(delayedIntegrations, timeoutStart, now) {
    if (now - timeoutStart > mParticle.integrationDelayTimeout) {
        return false;
    }
    for (var integration in delayedIntegrations) {
        if (delayedIntegrations[integration] === true) {
            return true;
        } else {
            continue;
        }
    }
    return false;
}

// events exist in the eventQueue because they were triggered when the identityAPI request was in flight
// once API request returns and there is an MPID, eventQueue items are reassigned with the returned MPID and flushed
function processQueuedEvents(eventQueue, mpid, requireDelay, sendEventToServer, sendEventToForwarders, parseEventResponse) {
    if (eventQueue.length && mpid && requireDelay) {
        var localQueueCopy = eventQueue;
        MP.eventQueue = [];
        localQueueCopy.forEach(function(event) {
            event.MPID = mpid;
            sendEventToServer(event, sendEventToForwarders, parseEventResponse);
        });
    }
}

module.exports = {
    logDebug: logDebug,
    canLog: canLog,
    extend: extend,
    isObject: isObject,
    inArray: inArray,
    createServiceUrl: createServiceUrl,
    createXHR: createXHR,
    generateUniqueId: generateUniqueId,
    filterUserIdentities: filterUserIdentities,
    filterUserIdentitiesForForwarders: filterUserIdentitiesForForwarders,
    filterUserAttributes: filterUserAttributes,
    findKeyInObject: findKeyInObject,
    decoded: decoded,
    converted: converted,
    isEventType: isEventType,
    parseNumber: parseNumber,
    parseStringOrNumber: parseStringOrNumber,
    generateHash: generateHash,
    sanitizeAttributes: sanitizeAttributes,
    mergeConfig: mergeConfig,
    returnConvertedBoolean: returnConvertedBoolean,
    invokeCallback: invokeCallback,
    hasFeatureFlag: hasFeatureFlag,
    isDelayedByIntegration: isDelayedByIntegration,
    processQueuedEvents: processQueuedEvents,
    Validators: Validators
};

},{"./constants":3,"./mp":14,"./types":20}],10:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    ServerModel = require('./serverModel'),
    Forwarders = require('./forwarders'),
    Persistence = require('./persistence'),
    Types = require('./types'),
    Messages = Constants.Messages,
    MP = require('./mp'),
    NativeSdkHelpers = require('./nativeSdkHelpers'),
    Validators = Helpers.Validators,
    sendIdentityRequest = require('./apiClient').sendIdentityRequest,
    CookieSyncManager = require('./cookieSyncManager'),
    sendEventToServer = require('./apiClient').sendEventToServer,
    HTTPCodes = Constants.HTTPCodes,
    Events = require('./events'),
    sendEventToForwarders = require('./forwarders').sendEventToForwarders;

var Identity = {
    checkIdentitySwap: function(previousMPID, currentMPID) {
        if (previousMPID && currentMPID && previousMPID !== currentMPID) {
            var cookies = Persistence.useLocalStorage() ? Persistence.getLocalStorage() : Persistence.getCookie();
            Persistence.storeDataInMemory(cookies, currentMPID);
            Persistence.update();
        }
    }
};

var IdentityRequest = {
    createKnownIdentities: function(identityApiData, deviceId) {
        var identitiesResult = {};

        if (identityApiData && identityApiData.userIdentities && Helpers.isObject(identityApiData.userIdentities)) {
            for (var identity in identityApiData.userIdentities) {
                identitiesResult[identity] = identityApiData.userIdentities[identity];
            }
        }
        identitiesResult.device_application_stamp = deviceId;

        return identitiesResult;
    },

    preProcessIdentityRequest: function(identityApiData, callback, method) {
        Helpers.logDebug(Messages.InformationMessages.StartingLogEvent + ': ' + method);

        var identityValidationResult = Validators.validateIdentities(identityApiData, method);

        if (!identityValidationResult.valid) {
            Helpers.logDebug('ERROR: ' + identityValidationResult.error);
            return {
                valid: false,
                error: identityValidationResult.error
            };
        }

        if (callback && !Validators.isFunction(callback)) {
            var error = 'The optional callback must be a function. You tried entering a(n) ' + typeof callback;
            Helpers.logDebug(error);
            return {
                valid: false,
                error: error
            };
        }

        if (identityValidationResult.warning) {
            Helpers.logDebug('WARNING:' + identityValidationResult.warning);
            return {
                valid: true,
                error: identityValidationResult.warning
            };
        }

        return {
            valid: true
        };
    },

    createIdentityRequest: function(identityApiData, platform, sdkVendor, sdkVersion, deviceId, context, mpid) {
        var APIRequest = {
            client_sdk: {
                platform: platform,
                sdk_vendor: sdkVendor,
                sdk_version: sdkVersion
            },
            context: context,
            environment: mParticle.isDevelopmentMode ? 'development' : 'production',
            request_id: Helpers.generateUniqueId(),
            request_timestamp_ms: new Date().getTime(),
            previous_mpid: mpid || null,
            known_identities: this.createKnownIdentities(identityApiData, deviceId)
        };

        return APIRequest;
    },

    createModifyIdentityRequest: function(currentUserIdentities, newUserIdentities, platform, sdkVendor, sdkVersion, context) {
        return {
            client_sdk: {
                platform: platform,
                sdk_vendor: sdkVendor,
                sdk_version: sdkVersion
            },
            context: context,
            environment: mParticle.isDevelopmentMode ? 'development' : 'production',
            request_id: Helpers.generateUniqueId(),
            request_timestamp_ms: new Date().getTime(),
            identity_changes: this.createIdentityChanges(currentUserIdentities, newUserIdentities)
        };
    },

    createIdentityChanges: function(previousIdentities, newIdentities) {
        var identityChanges = [];
        var key;
        if (newIdentities && Helpers.isObject(newIdentities) && previousIdentities && Helpers.isObject(previousIdentities)) {
            for (key in newIdentities) {
                identityChanges.push({
                    old_value: previousIdentities[Types.IdentityType.getIdentityType(key)] || null,
                    new_value: newIdentities[key],
                    identity_type: key
                });
            }
        }

        return identityChanges;
    },

    modifyUserIdentities: function(previousUserIdentities, newUserIdentities) {
        var modifiedUserIdentities = {};

        for (var key in newUserIdentities) {
            modifiedUserIdentities[Types.IdentityType.getIdentityType(key)] = newUserIdentities[key];
        }

        for (key in previousUserIdentities) {
            if (!modifiedUserIdentities[key]) {
                modifiedUserIdentities[key] = previousUserIdentities[key];
            }
        }

        return modifiedUserIdentities;
    },

    convertToNative: function(identityApiData) {
        var nativeIdentityRequest = [];
        if (identityApiData && identityApiData.userIdentities) {
            for (var key in identityApiData.userIdentities) {
                if (identityApiData.userIdentities.hasOwnProperty(key)) {
                    nativeIdentityRequest.push({
                        Type: Types.IdentityType.getIdentityType(key),
                        Identity: identityApiData.userIdentities[key]
                    });
                }
            }

            return {
                UserIdentities: nativeIdentityRequest
            };
        }
    }
};
/**
* Invoke these methods on the mParticle.Identity object.
* Example: mParticle.Identity.getCurrentUser().
* @class mParticle.Identity
*/
var IdentityAPI = {
    HTTPCodes: HTTPCodes,
    /**
    * Initiate a logout request to the mParticle server
    * @method identify
    * @param {Object} identityApiData The identityApiData object as indicated [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/README.md#1-customize-the-sdk)
    * @param {Function} [callback] A callback function that is called when the identify request completes
    */
    identify: function(identityApiData, callback) {
        var preProcessResult = IdentityRequest.preProcessIdentityRequest(identityApiData, callback, 'identify');

        if (preProcessResult.valid) {
            var identityApiRequest = IdentityRequest.createIdentityRequest(identityApiData, Constants.platform, Constants.sdkVendor, Constants.sdkVersion, MP.deviceId, MP.context, MP.mpid);

            if (Helpers.canLog()) {
                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.Identify, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
                    Helpers.invokeCallback(callback, HTTPCodes.nativeIdentityRequest, 'Identify request sent to native sdk');
                } else {
                    sendIdentityRequest(identityApiRequest, 'identify', callback, identityApiData, parseIdentityResponse);
                }
            }
            else {
                Helpers.invokeCallback(callback, HTTPCodes.loggingDisabledOrMissingAPIKey, Messages.InformationMessages.AbandonLogEvent);
                Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
            }
        } else {
            Helpers.invokeCallback(callback, HTTPCodes.validationIssue, preProcessResult.error);
            Helpers.logDebug(preProcessResult);
        }
    },
    /**
    * Initiate a logout request to the mParticle server
    * @method logout
    * @param {Object} identityApiData The identityApiData object as indicated [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/README.md#1-customize-the-sdk)
    * @param {Function} [callback] A callback function that is called when the logout request completes
    */
    logout: function(identityApiData, callback) {
        var preProcessResult = IdentityRequest.preProcessIdentityRequest(identityApiData, callback, 'logout');

        if (preProcessResult.valid) {
            var evt,
                identityApiRequest = IdentityRequest.createIdentityRequest(identityApiData, Constants.platform, Constants.sdkVendor, Constants.sdkVersion, MP.deviceId, MP.context, MP.mpid);

            if (Helpers.canLog()) {
                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.Logout, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
                    Helpers.invokeCallback(callback, HTTPCodes.nativeIdentityRequest, 'Logout request sent to native sdk');
                } else {
                    sendIdentityRequest(identityApiRequest, 'logout', callback, identityApiData, parseIdentityResponse);
                    evt = ServerModel.createEventObject(Types.MessageType.Profile);
                    evt.ProfileMessageType = Types.ProfileMessageType.Logout;
                    if (MP.activeForwarders.length) {
                        MP.activeForwarders.forEach(function(forwarder) {
                            if (forwarder.logOut) {
                                forwarder.logOut(evt);
                            }
                        });
                    }
                }
            }
            else {
                Helpers.invokeCallback(callback, HTTPCodes.loggingDisabledOrMissingAPIKey, Messages.InformationMessages.AbandonLogEvent);
                Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
            }
        } else {
            Helpers.invokeCallback(callback, HTTPCodes.validationIssue, preProcessResult.error);
            Helpers.logDebug(preProcessResult);
        }
    },
    /**
    * Initiate a login request to the mParticle server
    * @method login
    * @param {Object} identityApiData The identityApiData object as indicated [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/README.md#1-customize-the-sdk)
    * @param {Function} [callback] A callback function that is called when the login request completes
    */
    login: function(identityApiData, callback) {
        var preProcessResult = IdentityRequest.preProcessIdentityRequest(identityApiData, callback, 'login');

        if (preProcessResult.valid) {
            var identityApiRequest = IdentityRequest.createIdentityRequest(identityApiData, Constants.platform, Constants.sdkVendor, Constants.sdkVersion, MP.deviceId, MP.context, MP.mpid);

            if (Helpers.canLog()) {
                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.Login, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
                    Helpers.invokeCallback(callback, HTTPCodes.nativeIdentityRequest, 'Login request sent to native sdk');
                } else {
                    sendIdentityRequest(identityApiRequest, 'login', callback, identityApiData, parseIdentityResponse);
                }
            }
            else {
                Helpers.invokeCallback(callback, HTTPCodes.loggingDisabledOrMissingAPIKey, Messages.InformationMessages.AbandonLogEvent);
                Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
            }
        } else {
            Helpers.invokeCallback(callback, HTTPCodes.validationIssue, preProcessResult.error);
            Helpers.logDebug(preProcessResult);
        }
    },
    /**
    * Initiate a modify request to the mParticle server
    * @method modify
    * @param {Object} identityApiData The identityApiData object as indicated [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/README.md#1-customize-the-sdk)
    * @param {Function} [callback] A callback function that is called when the modify request completes
    */
    modify: function(identityApiData, callback) {
        var newUserIdentities = (identityApiData && identityApiData.userIdentities) ? identityApiData.userIdentities : {};
        var preProcessResult = IdentityRequest.preProcessIdentityRequest(identityApiData, callback, 'modify');
        if (preProcessResult.valid) {
            var identityApiRequest = IdentityRequest.createModifyIdentityRequest(MP.userIdentities, newUserIdentities, Constants.platform, Constants.sdkVendor, Constants.sdkVersion, MP.context);

            if (Helpers.canLog()) {
                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.Modify, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
                    Helpers.invokeCallback(callback, HTTPCodes.nativeIdentityRequest, 'Modify request sent to native sdk');
                } else {
                    sendIdentityRequest(identityApiRequest, 'modify', callback, identityApiData, parseIdentityResponse);
                }
            }
            else {
                Helpers.invokeCallback(callback, HTTPCodes.loggingDisabledOrMissingAPIKey, Messages.InformationMessages.AbandonLogEvent);
                Helpers.logDebug(Messages.InformationMessages.AbandonLogEvent);
            }
        } else {
            Helpers.invokeCallback(callback, HTTPCodes.validationIssue, preProcessResult.error);
            Helpers.logDebug(preProcessResult);
        }
    },
    /**
    * Returns a user object with methods to interact with the current user
    * @method getCurrentUser
    * @return {Object} the current user object
    */
    getCurrentUser: function() {
        var mpid = MP.mpid;
        if (mpid) {
            mpid = MP.mpid.slice();
            return mParticleUser(mpid, MP.isLoggedIn);
        } else if (MP.webviewBridgeEnabled) {
            return mParticleUser();
        } else {
            return null;
        }
    },

    /**
    * Returns a the user object associated with the mpid parameter or 'null' if no such
    * user exists
    * @method getUser
    * @param {String} mpid of the desired user
    * @return {Object} the user for  mpid
    */
    getUser: function(mpid) {
        var cookies = Persistence.getPersistence();
        if (cookies) {
            if (cookies[mpid] && !Constants.SDKv2NonMPIDCookieKeys.hasOwnProperty(mpid)) {
                return mParticleUser(mpid);
            } else {
                return null;
            }
        } else {
            return null;
        }
    },

    /**
    * Returns all users, including the current user and all previous users that are stored on the device.
    * @method getUsers
    * @return {Array} array of users
    */
    getUsers: function() {
        var cookies = Persistence.getPersistence();
        var users = [];
        if (cookies) {
            for (var key in cookies) {
                if (!Constants.SDKv2NonMPIDCookieKeys.hasOwnProperty(key)) {
                    users.push(mParticleUser(key));
                }
            }
        }
        return users;
    }
};

/**
* Invoke these methods on the mParticle.Identity.getCurrentUser() object.
* Example: mParticle.Identity.getCurrentUser().getAllUserAttributes()
* @class mParticle.Identity.getCurrentUser()
*/
function mParticleUser(mpid, isLoggedIn) {
    return {
        /**
        * Get user identities for current user
        * @method getUserIdentities
        * @return {Object} an object with userIdentities as its key
        */
        getUserIdentities: function() {
            var currentUserIdentities = {};

            var identities = Persistence.getUserIdentities(mpid);

            for (var identityType in identities) {
                if (identities.hasOwnProperty(identityType)) {
                    currentUserIdentities[Types.IdentityType.getIdentityName(Helpers.parseNumber(identityType))] = identities[identityType];
                }
            }

            return {
                userIdentities: currentUserIdentities
            };
        },
        /**
        * Get the MPID of the current user
        * @method getMPID
        * @return {String} the current user MPID as a string
        */
        getMPID: function() {
            return mpid;
        },
        /**
        * Sets a user tag
        * @method setUserTag
        * @param {String} tagName
        */
        setUserTag: function(tagName) {
            if (!Validators.isValidKeyValue(tagName)) {
                Helpers.logDebug(Messages.ErrorMessages.BadKey);
                return;
            }

            this.setUserAttribute(tagName, null);
        },
        /**
        * Removes a user tag
        * @method removeUserTag
        * @param {String} tagName
        */
        removeUserTag: function(tagName) {
            if (!Validators.isValidKeyValue(tagName)) {
                Helpers.logDebug(Messages.ErrorMessages.BadKey);
                return;
            }

            this.removeUserAttribute(tagName);
        },
        /**
        * Sets a user attribute
        * @method setUserAttribute
        * @param {String} key
        * @param {String} value
        */
        setUserAttribute: function(key, value) {
            var cookies,
                userAttributes;

            mParticle.sessionManager.resetSessionTimer();

            if (Helpers.canLog()) {
                if (!Validators.isValidAttributeValue(value)) {
                    Helpers.logDebug(Messages.ErrorMessages.BadAttribute);
                    return;
                }

                if (!Validators.isValidKeyValue(key)) {
                    Helpers.logDebug(Messages.ErrorMessages.BadKey);
                    return;
                }
                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.SetUserAttribute, JSON.stringify({ key: key, value: value }));
                } else {
                    cookies = Persistence.getPersistence();

                    userAttributes = this.getAllUserAttributes();

                    var existingProp = Helpers.findKeyInObject(userAttributes, key);

                    if (existingProp) {
                        delete userAttributes[existingProp];
                    }

                    userAttributes[key] = value;
                    if (cookies && cookies[mpid]) {
                        cookies[mpid].ua = userAttributes;
                        Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                        Persistence.storeDataInMemory(cookies, mpid);
                    }

                    Forwarders.initForwarders(mParticle.Identity.getCurrentUser().getUserIdentities());
                    Forwarders.callSetUserAttributeOnForwarders(key, value);
                }
            }
        },
        /**
        * Set multiple user attributes
        * @method setUserAttributes
        * @param {Object} user attribute object with keys of the attribute type, and value of the attribute value
        */
        setUserAttributes: function(userAttributes) {
            mParticle.sessionManager.resetSessionTimer();
            if (Helpers.isObject(userAttributes)) {
                if (Helpers.canLog()) {
                    for (var key in userAttributes) {
                        if (userAttributes.hasOwnProperty(key)) {
                            this.setUserAttribute(key, userAttributes[key]);
                        }
                    }
                }
            } else {
                Helpers.debug('Must pass an object into setUserAttributes. You passed a ' + typeof userAttributes);
            }
        },
        /**
        * Removes a specific user attribute
        * @method removeUserAttribute
        * @param {String} key
        */
        removeUserAttribute: function(key) {
            var cookies, userAttributes;
            mParticle.sessionManager.resetSessionTimer();

            if (!Validators.isValidKeyValue(key)) {
                Helpers.logDebug(Messages.ErrorMessages.BadKey);
                return;
            }

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.RemoveUserAttribute, JSON.stringify({ key: key, value: null }));
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                var existingProp = Helpers.findKeyInObject(userAttributes, key);

                if (existingProp) {
                    key = existingProp;
                }

                delete userAttributes[key];

                if (cookies && cookies[mpid]) {
                    cookies[mpid].ua = userAttributes;
                    Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                    Persistence.storeDataInMemory(cookies, mpid);
                }

                Forwarders.initForwarders(mParticle.Identity.getCurrentUser().getUserIdentities());
                Forwarders.applyToForwarders('removeUserAttribute', key);
            }
        },
        /**
        * Sets a list of user attributes
        * @method setUserAttributeList
        * @param {String} key
        * @param {Array} value an array of values
        */
        setUserAttributeList: function(key, value) {
            var cookies, userAttributes;

            mParticle.sessionManager.resetSessionTimer();

            if (!Validators.isValidKeyValue(key)) {
                Helpers.logDebug(Messages.ErrorMessages.BadKey);
                return;
            }

            if (!Array.isArray(value)) {
                Helpers.logDebug('The value you passed in to setUserAttributeList must be an array. You passed in a ' + typeof value);
                return;
            }

            var arrayCopy = value.slice();

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.SetUserAttributeList, JSON.stringify({ key: key, value: arrayCopy }));
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                var existingProp = Helpers.findKeyInObject(userAttributes, key);

                if (existingProp) {
                    delete userAttributes[existingProp];
                }

                userAttributes[key] = arrayCopy;
                if (cookies && cookies[mpid]) {
                    cookies[mpid].ua = userAttributes;
                    Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                    Persistence.storeDataInMemory(cookies, mpid);
                }

                Forwarders.initForwarders(mParticle.Identity.getCurrentUser().getUserIdentities());
                Forwarders.callSetUserAttributeOnForwarders(key, arrayCopy);
            }
        },
        /**
        * Removes all user attributes
        * @method removeAllUserAttributes
        */
        removeAllUserAttributes: function() {
            var cookies, userAttributes;

            mParticle.sessionManager.resetSessionTimer();

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.RemoveAllUserAttributes);
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                Forwarders.initForwarders(mParticle.Identity.getCurrentUser().getUserIdentities());
                if (userAttributes) {
                    for (var prop in userAttributes) {
                        if (userAttributes.hasOwnProperty(prop)) {
                            Forwarders.applyToForwarders('removeUserAttribute', prop);
                        }
                    }
                }

                if (cookies && cookies[mpid]) {
                    cookies[mpid].ua = {};
                    Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                    Persistence.storeDataInMemory(cookies, mpid);
                }
            }
        },
        /**
        * Returns all user attribute keys that have values that are arrays
        * @method getUserAttributesLists
        * @return {Object} an object of only keys with array values. Example: { attr1: [1, 2, 3], attr2: ['a', 'b', 'c'] }
        */
        getUserAttributesLists: function() {
            var userAttributes,
                userAttributesLists = {};

            userAttributes = this.getAllUserAttributes();
            for (var key in userAttributes) {
                if (userAttributes.hasOwnProperty(key) && Array.isArray(userAttributes[key])) {
                    userAttributesLists[key] = userAttributes[key].slice();
                }
            }

            return userAttributesLists;
        },
        /**
        * Returns all user attributes
        * @method getAllUserAttributes
        * @return {Object} an object of all user attributes. Example: { attr1: 'value1', attr2: ['a', 'b', 'c'] }
        */
        getAllUserAttributes: function() {
            var userAttributesCopy = {};
            var userAttributes = Persistence.getAllUserAttributes(mpid);

            if (userAttributes) {
                for (var prop in userAttributes) {
                    if (userAttributes.hasOwnProperty(prop)) {
                        if (Array.isArray(userAttributes[prop])) {
                            userAttributesCopy[prop] = userAttributes[prop].slice();
                        }
                        else {
                            userAttributesCopy[prop] = userAttributes[prop];
                        }
                    }
                }
            }

            return userAttributesCopy;
        },
        /**
        * Returns the cart object for the current user
        * @method getCart
        * @return a cart object
        */
        getCart: function() {
            return mParticleUserCart(mpid);
        },

        /**
        * Returns the Consent State stored locally for this user.
        * @method getConsentState
        * @return a ConsentState object
        */
        getConsentState: function() {
            return Persistence.getConsentState(mpid);
        },
        /**
        * Sets the Consent State stored locally for this user.
        * @method setConsentState
        * @param {Object} consent state
        */
        setConsentState: function(state) {
            Persistence.setConsentState(mpid, state);
            if (MP.mpid === this.getMPID()) {
                Forwarders.initForwarders(this.getUserIdentities().userIdentities);
            }
        },
        isLoggedIn: function() {
            return isLoggedIn;
        }
    };
}

/**
* Invoke these methods on the mParticle.Identity.getCurrentUser().getCart() object.
* Example: mParticle.Identity.getCurrentUser().getCart().add(...);
* @class mParticle.Identity.getCurrentUser().getCart()
*/
function mParticleUserCart(mpid){
    return {
        /**
        * Adds a cart product to the user cart
        * @method add
        * @param {Object} product the product
        * @param {Boolean} [logEvent] a boolean to log adding of the cart object. If blank, no logging occurs.
        */
        add: function(product, logEvent) {
            var allProducts,
                userProducts,
                arrayCopy;

            arrayCopy = Array.isArray(product) ? product.slice() : [product];
            arrayCopy.forEach(function(product) {
                product.Attributes = Helpers.sanitizeAttributes(product.Attributes);
            });

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.AddToCart, JSON.stringify(arrayCopy));
            } else {
                mParticle.sessionManager.resetSessionTimer();



                userProducts = Persistence.getUserProductsFromLS(mpid);

                userProducts = userProducts.concat(arrayCopy);

                if (logEvent === true) {
                    Events.logProductActionEvent(Types.ProductActionType.AddToCart, arrayCopy);
                }

                var productsForMemory = {};
                productsForMemory[mpid] = {cp: userProducts};
                if (mpid === MP.mpid) {
                    Persistence.storeProductsInMemory(productsForMemory, mpid);
                }

                if (userProducts.length > mParticle.maxProducts) {
                    Helpers.logDebug('The cart contains ' + userProducts.length + ' items. Only mParticle.maxProducts = ' + mParticle.maxProducts + ' can currently be saved in cookies.');
                    userProducts = userProducts.slice(0, mParticle.maxProducts);
                }

                allProducts = Persistence.getAllUserProductsFromLS();
                allProducts[mpid].cp = userProducts;

                Persistence.setCartProducts(allProducts);
            }
        },
        /**
        * Removes a cart product from the current user cart
        * @method remove
        * @param {Object} product the product
        * @param {Boolean} [logEvent] a boolean to log adding of the cart object. If blank, no logging occurs.
        */
        remove: function(product, logEvent) {
            var allProducts,
                userProducts,
                cartIndex = -1,
                cartItem = null;

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.RemoveFromCart, JSON.stringify(product));
            } else {
                mParticle.sessionManager.resetSessionTimer();

                userProducts = Persistence.getUserProductsFromLS(mpid);

                if (userProducts) {
                    userProducts.forEach(function(cartProduct, i) {
                        if (cartProduct.Sku === product.Sku) {
                            cartIndex = i;
                            cartItem = cartProduct;
                        }
                    });

                    if (cartIndex > -1) {
                        userProducts.splice(cartIndex, 1);

                        if (logEvent === true) {
                            Events.logProductActionEvent(Types.ProductActionType.RemoveFromCart, cartItem);
                        }
                    }
                }

                var productsForMemory = {};
                productsForMemory[mpid] = {cp: userProducts};
                if (mpid === MP.mpid) {
                    Persistence.storeProductsInMemory(productsForMemory, mpid);
                }

                allProducts = Persistence.getAllUserProductsFromLS();

                allProducts[mpid].cp = userProducts;

                Persistence.setCartProducts(allProducts);
            }
        },
        /**
        * Clears the user's cart
        * @method clear
        */
        clear: function() {
            var allProducts;

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.ClearCart);
            } else {
                mParticle.sessionManager.resetSessionTimer();
                allProducts = Persistence.getAllUserProductsFromLS();

                if (allProducts && allProducts[mpid] && allProducts[mpid].cp) {
                    allProducts[mpid].cp = [];

                    allProducts[mpid].cp = [];
                    if (mpid === MP.mpid) {
                        Persistence.storeProductsInMemory(allProducts, mpid);
                    }

                    Persistence.setCartProducts(allProducts);
                }
            }
        },
        /**
        * Returns all cart products
        * @method getCartProducts
        * @return {Array} array of cart products
        */
        getCartProducts: function() {
            return Persistence.getCartProducts(mpid);
        }
    };
}

function parseIdentityResponse(xhr, previousMPID, callback, identityApiData, method) {
    var prevUser,
        newUser,
        identityApiResult,
        indexOfMPID;

    if (MP.mpid) {
        prevUser = mParticle.Identity.getCurrentUser();
    }

    MP.identityCallInFlight = false;
    try {
        Helpers.logDebug('Parsing identity response from server');
        if (xhr.responseText) {
            identityApiResult = JSON.parse(xhr.responseText);
            if (identityApiResult.hasOwnProperty('is_logged_in')) {
                MP.isLoggedIn = identityApiResult.is_logged_in;
            }
        }
        if (xhr.status === 200) {
            if (method === 'modify') {
                MP.userIdentities = IdentityRequest.modifyUserIdentities(MP.userIdentities, identityApiData.userIdentities);
                Persistence.update();
            } else {
                identityApiResult = JSON.parse(xhr.responseText);

                Helpers.logDebug('Successfully parsed Identity Response');
                if (identityApiResult.mpid && identityApiResult.mpid !== MP.mpid) {
                    MP.mpid = identityApiResult.mpid;

                    checkCookieForMPID(MP.mpid);
                }

                indexOfMPID = MP.currentSessionMPIDs.indexOf(MP.mpid);

                if (MP.sessionId && MP.mpid && previousMPID !== MP.mpid && indexOfMPID < 0) {
                    MP.currentSessionMPIDs.push(MP.mpid);
                    // need to update currentSessionMPIDs in memory before checkingIdentitySwap otherwise previous obj.currentSessionMPIDs is used in checkIdentitySwap's Persistence.update()
                    Persistence.update();
                }

                if (indexOfMPID > -1) {
                    MP.currentSessionMPIDs = (MP.currentSessionMPIDs.slice(0, indexOfMPID)).concat(MP.currentSessionMPIDs.slice(indexOfMPID + 1, MP.currentSessionMPIDs.length));
                    MP.currentSessionMPIDs.push(MP.mpid);
                    Persistence.update();
                }

                CookieSyncManager.attemptCookieSync(previousMPID, MP.mpid);

                Identity.checkIdentitySwap(previousMPID, MP.mpid);

                Helpers.processQueuedEvents(MP.eventQueue, MP.mpid, !MP.requireDelay, sendEventToServer, sendEventToForwarders, Events.parseEventResponse);

                //if there is any previous migration data
                if (Object.keys(MP.migrationData).length) {
                    MP.userIdentities = MP.migrationData.userIdentities || {};
                    MP.userAttributes = MP.migrationData.userAttributes || {};
                    MP.cookieSyncDates = MP.migrationData.cookieSyncDates || {};
                } else {
                    if (identityApiData && identityApiData.userIdentities && Object.keys(identityApiData.userIdentities).length) {
                        MP.userIdentities = IdentityRequest.modifyUserIdentities(MP.userIdentities, identityApiData.userIdentities);
                    }
                }
                Persistence.update();
                Persistence.findPrevCookiesBasedOnUI(identityApiData);

                MP.context = identityApiResult.context || MP.context;
            }

            newUser = mParticle.Identity.getCurrentUser();

            if (identityApiData && identityApiData.onUserAlias && Helpers.Validators.isFunction(identityApiData.onUserAlias)) {
                try {
                    identityApiData.onUserAlias(prevUser, newUser);
                }
                catch (e) {
                    Helpers.logDebug('There was an error with your onUserAlias function - ' + e);
                }
            }
            var cookies = Persistence.getCookie() || Persistence.getLocalStorage();

            if (newUser) {
                Persistence.storeDataInMemory(cookies, newUser.getMPID());
                if (!prevUser || newUser.getMPID() !== prevUser.getMPID() || prevUser.isLoggedIn() !== newUser.isLoggedIn()) {
                    Forwarders.initForwarders(newUser.getUserIdentities().userIdentities);
                }
                Forwarders.setForwarderUserIdentities(newUser.getUserIdentities().userIdentities);
                Forwarders.setForwarderOnIdentityComplete(newUser, method);
                Forwarders.setForwarderOnUserIdentified(newUser, method);
            }
        }

        if (callback) {
            Helpers.invokeCallback(callback, xhr.status, identityApiResult || null, newUser);
        } else {
            if (identityApiResult && identityApiResult.errors && identityApiResult.errors.length) {
                Helpers.logDebug('Received HTTP response code of ' + xhr.status + ' - ' + identityApiResult.errors[0].message);
            }
        }
    }
    catch (e) {
        if (callback) {
            Helpers.invokeCallback(callback, xhr.status, identityApiResult || null);
        }
        Helpers.logDebug('Error parsing JSON response from Identity server: ' + e);
    }
}

function checkCookieForMPID(currentMPID) {
    var cookies = Persistence.getCookie() || Persistence.getLocalStorage();
    if (cookies && !cookies[currentMPID]) {
        Persistence.storeDataInMemory(null, currentMPID);
        MP.cartProducts = [];
    } else if (cookies) {
        var products = Persistence.decodeProducts();
        if (products && products[currentMPID]) {
            MP.cartProducts = products[currentMPID].cp;
        }
        MP.userIdentities = cookies[currentMPID].ui || {};
        MP.userAttributes = cookies[currentMPID].ua || {};
        MP.cookieSyncDates = cookies[currentMPID].csd || {};
        MP.consentState = cookies[currentMPID].con;
    }
}

module.exports = {
    IdentityAPI: IdentityAPI,
    Identity: Identity,
    IdentityRequest: IdentityRequest,
    mParticleUser: mParticleUser,
    mParticleUserCart: mParticleUserCart
};

},{"./apiClient":1,"./constants":3,"./cookieSyncManager":4,"./events":6,"./forwarders":7,"./helpers":9,"./mp":14,"./nativeSdkHelpers":15,"./persistence":16,"./serverModel":18,"./types":20}],11:[function(require,module,exports){
var Persistence = require('./persistence'),
    Types = require('./types'),
    Helpers = require('./helpers');

function getFilteredMparticleUser(mpid, forwarder) {
    return {
        getUserIdentities: function() {
            var currentUserIdentities = {};
            var identities = Persistence.getUserIdentities(mpid);

            for (var identityType in identities) {
                if (identities.hasOwnProperty(identityType)) {
                    currentUserIdentities[Types.IdentityType.getIdentityName(Helpers.parseNumber(identityType))] = identities[identityType];
                }
            }

            currentUserIdentities = Helpers.filterUserIdentitiesForForwarders(currentUserIdentities, forwarder.userIdentityFilters);

            return {
                userIdentities: currentUserIdentities
            };
        },
        getMPID: function() {
            return mpid;
        },
        getUserAttributesLists: function(forwarder) {
            var userAttributes,
                userAttributesLists = {};

            userAttributes = this.getAllUserAttributes();
            for (var key in userAttributes) {
                if (userAttributes.hasOwnProperty(key) && Array.isArray(userAttributes[key])) {
                    userAttributesLists[key] = userAttributes[key].slice();
                }
            }

            userAttributesLists = Helpers.filterUserAttributes(userAttributesLists, forwarder.userAttributeFilters);

            return userAttributesLists;
        },
        getAllUserAttributes: function() {
            var userAttributesCopy = {};
            var userAttributes = Persistence.getAllUserAttributes(mpid);

            if (userAttributes) {
                for (var prop in userAttributes) {
                    if (userAttributes.hasOwnProperty(prop)) {
                        if (Array.isArray(userAttributes[prop])) {
                            userAttributesCopy[prop] = userAttributes[prop].slice();
                        }
                        else {
                            userAttributesCopy[prop] = userAttributes[prop];
                        }
                    }
                }
            }

            userAttributesCopy = Helpers.filterUserAttributes(userAttributesCopy, forwarder.userAttributeFilters);

            return userAttributesCopy;
        }
    };
}

module.exports = {
    getFilteredMparticleUser: getFilteredMparticleUser
};

},{"./helpers":9,"./persistence":16,"./types":20}],12:[function(require,module,exports){
//
//  Copyright 2017 mParticle, Inc.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//
//  Uses portions of code from jQuery
//  jQuery v1.10.2 | (c) 2005, 2013 jQuery Foundation, Inc. | jquery.org/license

var Polyfill = require('./polyfill'),
    Types = require('./types'),
    Constants = require('./constants'),
    Helpers = require('./helpers'),
    NativeSdkHelpers = require('./nativeSdkHelpers'),
    CookieSyncManager = require('./cookieSyncManager'),
    SessionManager = require('./sessionManager'),
    Ecommerce = require('./ecommerce'),
    MP = require('./mp'),
    Persistence = require('./persistence'),
    getDeviceId = Persistence.getDeviceId,
    Events = require('./events'),
    Messages = Constants.Messages,
    Validators = Helpers.Validators,
    Migrations = require('./migrations'),
    Forwarders = require('./forwarders'),
    ForwardingStatsUploader = require('./forwardingStatsUploader'),
    IdentityRequest = require('./identity').IdentityRequest,
    Identity = require('./identity').Identity,
    IdentityAPI = require('./identity').IdentityAPI,
    HTTPCodes = IdentityAPI.HTTPCodes,
    mParticleUserCart = require('./identity').mParticleUserCart,
    mParticleUser = require('./identity').mParticleUser,
    Consent = require('./consent');

(function(window) {
    if (!Array.prototype.forEach) {
        Array.prototype.forEach = Polyfill.forEach;
    }

    if (!Array.prototype.map) {
        Array.prototype.map = Polyfill.map;
    }

    if (!Array.prototype.filter) {
        Array.prototype.filter = Polyfill.filter;
    }

    if (!Array.isArray) {
        Array.prototype.isArray = Polyfill.isArray;
    }

    /**
    * Invoke these methods on the mParticle object.
    * Example: mParticle.endSession()
    *
    * @class mParticle
    */

    var mParticle = {
        useNativeSdk: window.mParticle && window.mParticle.useNativeSdk ? window.mParticle.useNativeSdk : false,
        isIOS: window.mParticle && window.mParticle.isIOS ? window.mParticle.isIOS : false,
        isDevelopmentMode: false,
        useCookieStorage: false,
        maxProducts: Constants.DefaultConfig.MaxProducts,
        maxCookieSize: Constants.DefaultConfig.MaxCookieSize,
        integrationDelayTimeout: Constants.DefaultConfig.IntegrationDelayTimeout,
        identifyRequest: {},
        getDeviceId: getDeviceId,
        generateHash: Helpers.generateHash,
        sessionManager: SessionManager,
        cookieSyncManager: CookieSyncManager,
        persistence: Persistence,
        migrations: Migrations,
        Identity: IdentityAPI,
        Validators: Validators,
        _Identity: Identity,
        _IdentityRequest: IdentityRequest,
        IdentityType: Types.IdentityType,
        EventType: Types.EventType,
        CommerceEventType: Types.CommerceEventType,
        PromotionType: Types.PromotionActionType,
        ProductActionType: Types.ProductActionType,
        /**
        * Initializes the mParticle SDK
        *
        * @method init
        * @param {String} apiKey your mParticle assigned API key
        * @param {Object} [options] an options object for additional configuration
        */
        init: function(apiKey) {
            MP.webviewBridgeEnabled = NativeSdkHelpers.isWebviewEnabled(mParticle.requiredWebviewBridgeName, mParticle.minWebviewBridgeVersion);

            if (MP.webviewBridgeEnabled) {
                NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.SetSessionAttribute, JSON.stringify({ key: '$src_env', value: 'webview' }));
                if (apiKey) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.SetSessionAttribute, JSON.stringify({ key: '$src_key', value: apiKey}));
                }
            } else {
                var config, currentUser;

                MP.integrationDelayTimeoutStart = Date.now();
                MP.initialIdentifyRequest = mParticle.identifyRequest;
                MP.devToken = apiKey || null;
                Helpers.logDebug(Messages.InformationMessages.StartingInitialization);
                //check to see if localStorage is available for migrating purposes
                MP.isLocalStorageAvailable = Persistence.determineLocalStorageAvailability(window.localStorage);

                // Set configuration to default settings
                Helpers.mergeConfig({});

                // Migrate any cookies from previous versions to current cookie version
                Migrations.migrate();

                // Load any settings/identities/attributes from cookie or localStorage
                Persistence.initializeStorage();

                // If no identity is passed in, we set the user identities to what is currently in cookies for the identify request
                if ((Helpers.isObject(mParticle.identifyRequest) && Object.keys(mParticle.identifyRequest).length === 0) || !mParticle.identifyRequest) {
                    var modifiedUIforIdentityRequest = {};
                    for (var identityType in MP.userIdentities) {
                        if (MP.userIdentities.hasOwnProperty(identityType)) {
                            modifiedUIforIdentityRequest[Types.IdentityType.getIdentityName(Helpers.parseNumber(identityType))] = MP.userIdentities[identityType];
                        }
                    }

                    MP.initialIdentifyRequest = {
                        userIdentities: modifiedUIforIdentityRequest
                    };
                } else {
                    MP.initialIdentifyRequest = mParticle.identifyRequest;
                }

                // If migrating from pre-IDSync to IDSync, a sessionID will exist and an identify request will not have been fired, so we need this check
                if (MP.migratingToIDSyncCookies) {
                    IdentityAPI.identify(MP.initialIdentifyRequest, mParticle.identifyRequest);
                    MP.migratingToIDSyncCookies = false;
                }

                currentUser = mParticle.Identity.getCurrentUser();
                // Call mParticle.identityCallback when identify was not called due to a reload or a sessionId already existing
                if (!MP.identifyCalled && mParticle.identityCallback && MP.mpid && currentUser) {
                    mParticle.identityCallback({
                        httpCode: HTTPCodes.activeSession,
                        getUser: function() {
                            return mParticleUser(MP.mpid);
                        },
                        body: {
                            mpid: MP.mpid,
                            is_logged_in: MP.isLoggedIn,
                            matched_identities: currentUser ? currentUser.getUserIdentities().userIdentities : {},
                            context: null,
                            is_ephemeral: false
                        }
                    });
                }

                Forwarders.initForwarders(MP.initialIdentifyRequest.userIdentities);
                if (Helpers.hasFeatureFlag(Constants.Features.Batching)) {
                    ForwardingStatsUploader.startForwardingStatsTimer();
                }

                if (arguments && arguments.length) {
                    if (arguments.length > 1 && typeof arguments[1] === 'object') {
                        config = arguments[1];
                    }
                    if (config) {
                        Helpers.mergeConfig(config);
                    }
                }

                mParticle.sessionManager.initialize();
                Events.logAST();
            }

            // Call any functions that are waiting for the library to be initialized
            if (MP.readyQueue && MP.readyQueue.length) {
                MP.readyQueue.forEach(function(readyQueueItem) {
                    if (Validators.isFunction(readyQueueItem)) {
                        readyQueueItem();
                    } else if (Array.isArray(readyQueueItem)) {
                        processPreloadedItem(readyQueueItem);
                    }
                });

                MP.readyQueue = [];
            }
            MP.isInitialized = true;
        },
        /**
        * Completely resets the state of the SDK. mParticle.init(apiKey) will need to be called again.
        * @method reset
        * @param {Boolean} keepPersistence if passed as true, this method will only reset the in-memory SDK state.
        */
        reset: function(keepPersistence) {
            MP.sessionAttributes = {};
            MP.isEnabled = true;
            MP.isFirstRun = null;
            Events.stopTracking();
            MP.devToken = null;
            MP.sessionId = null;
            MP.appName = null;
            MP.appVersion = null;
            MP.currentSessionMPIDs = [],
            MP.eventQueue = [];
            MP.context = null;
            MP.userAttributes = {};
            MP.userIdentities = {};
            MP.cookieSyncDates = {};
            MP.activeForwarders = [];
            MP.configuredForwarders = [];
            MP.forwarderConstructors = [];
            MP.pixelConfigurations = [];
            MP.cartProducts = [];
            MP.serverSettings = null;
            MP.mpid = null;
            MP.customFlags = null;
            MP.currencyCode;
            MP.clientId = null;
            MP.deviceId = null;
            MP.dateLastEventSent = null;
            MP.sessionStartDate = null;
            MP.watchPositionId = null;
            MP.readyQueue = [];
            MP.migrationData = {};
            MP.identityCallInFlight = false;
            MP.initialIdentifyRequest = null;
            MP.isInitialized = false;
            MP.identifyCalled = false;
            MP.consentState = null;
            MP.featureFlags = {};
            MP.integrationAttributes = {};
            MP.integrationDelays = {};
            MP.requireDelay = true;
            Helpers.mergeConfig({});
            if (!keepPersistence) {
                Persistence.resetPersistence();
            }
            mParticle.identityCallback = null;
            Persistence.forwardingStatsBatches.uploadsTable = {};
            Persistence.forwardingStatsBatches.forwardingStatsEventQueue = [];
        },
        ready: function(f) {
            if (MP.isInitialized && typeof f === 'function') {
                f();
            }
            else {
                MP.readyQueue.push(f);
            }
        },
        /**
        * Returns the mParticle SDK version number
        * @method getVersion
        * @return {String} mParticle SDK version number
        */
        getVersion: function() {
            return Constants.sdkVersion;
        },
        /**
        * Sets the app version
        * @method setAppVersion
        * @param {String} version version number
        */
        setAppVersion: function(version) {
            MP.appVersion = version;
            Persistence.update();
        },
        /**
        * Gets the app name
        * @method getAppName
        * @return {String} App name
        */
        getAppName: function() {
            return MP.appName;
        },
        /**
        * Sets the app name
        * @method setAppName
        * @param {String} name App Name
        */
        setAppName: function(name) {
            MP.appName = name;
        },
        /**
        * Gets the app version
        * @method getAppVersion
        * @return {String} App version
        */
        getAppVersion: function() {
            return MP.appVersion;
        },
        /**
        * Stops tracking the location of the user
        * @method stopTrackingLocation
        */
        stopTrackingLocation: function() {
            mParticle.sessionManager.resetSessionTimer();
            Events.stopTracking();
        },
        /**
        * Starts tracking the location of the user
        * @method startTrackingLocation
        */
        startTrackingLocation: function() {
            mParticle.sessionManager.resetSessionTimer();
            Events.startTracking();
        },
        /**
        * Sets the position of the user
        * @method setPosition
        * @param {Number} lattitude lattitude digit
        * @param {Number} longitude longitude digit
        */
        setPosition: function(lat, lng) {
            mParticle.sessionManager.resetSessionTimer();
            if (typeof lat === 'number' && typeof lng === 'number') {
                MP.currentPosition = {
                    lat: lat,
                    lng: lng
                };
            }
            else {
                Helpers.logDebug('Position latitude and/or longitude must both be of type number');
            }
        },
        /**
        * Starts a new session
        * @method startNewSession
        */
        startNewSession: function() {
            SessionManager.startNewSession();
        },
        /**
        * Ends the current session
        * @method endSession
        */
        endSession: function() {
            // Sends true as an over ride vs when endSession is called from the setInterval
            SessionManager.endSession(true);
        },
        /**
        * Logs an event to mParticle's servers
        * @method logEvent
        * @param {String} eventName The name of the event
        * @param {Number} [eventType] The eventType as seen [here](http://docs.mparticle.com/developers/sdk/javascript/event-tracking#event-type)
        * @param {Object} [eventInfo] Attributes for the event
        * @param {Object} [customFlags] Additional customFlags
        */
        logEvent: function(eventName, eventType, eventInfo, customFlags) {
            mParticle.sessionManager.resetSessionTimer();
            if (typeof (eventName) !== 'string') {
                Helpers.logDebug(Messages.ErrorMessages.EventNameInvalidType);
                return;
            }

            if (!eventType) {
                eventType = Types.EventType.Unknown;
            }

            if (!Helpers.isEventType(eventType)) {
                Helpers.logDebug('Invalid event type: ' + eventType + ', must be one of: \n' + JSON.stringify(Types.EventType));
                return;
            }

            if (!Helpers.canLog()) {
                Helpers.logDebug(Messages.ErrorMessages.LoggingDisabled);
                return;
            }

            Events.logEvent(Types.MessageType.PageEvent, eventName, eventInfo, eventType, customFlags);
        },
        /**
        * Used to log custom errors
        *
        * @method logError
        * @param {String or Object} error The name of the error (string), or an object formed as follows {name: 'exampleName', message: 'exampleMessage', stack: 'exampleStack'}
        */
        logError: function(error) {
            mParticle.sessionManager.resetSessionTimer();
            if (!error) {
                return;
            }

            if (typeof error === 'string') {
                error = {
                    message: error
                };
            }

            Events.logEvent(Types.MessageType.CrashReport,
                error.name ? error.name : 'Error',
                {
                    m: error.message ? error.message : error,
                    s: 'Error',
                    t: error.stack
                },
                Types.EventType.Other);
        },
        /**
        * Logs `click` events
        * @method logLink
        * @param {String} selector The selector to add a 'click' event to (ex. #purchase-event)
        * @param {String} [eventName] The name of the event
        * @param {Number} [eventType] The eventType as seen [here](http://docs.mparticle.com/developers/sdk/javascript/event-tracking#event-type)
        * @param {Object} [eventInfo] Attributes for the event
        */
        logLink: function(selector, eventName, eventType, eventInfo) {
            mParticle.sessionManager.resetSessionTimer();
            Events.addEventHandler('click', selector, eventName, eventInfo, eventType);
        },
        /**
        * Logs `submit` events
        * @method logForm
        * @param {String} selector The selector to add the event handler to (ex. #search-event)
        * @param {String} [eventName] The name of the event
        * @param {Number} [eventType] The eventType as seen [here](http://docs.mparticle.com/developers/sdk/javascript/event-tracking#event-type)
        * @param {Object} [eventInfo] Attributes for the event
        */
        logForm: function(selector, eventName, eventType, eventInfo) {
            mParticle.sessionManager.resetSessionTimer();
            Events.addEventHandler('submit', selector, eventName, eventInfo, eventType);
        },
        /**
        * Logs a page view
        * @method logPageView
        * @param {String} eventName The name of the event. Defaults to 'PageView'.
        * @param {Object} [attrs] Attributes for the event
        * @param {Object} [customFlags] Custom flags for the event
        */
        logPageView: function(eventName, attrs, customFlags) {
            mParticle.sessionManager.resetSessionTimer();

            if (Helpers.canLog()) {
                if (!Validators.isStringOrNumber(eventName)) {
                    eventName = 'PageView';
                }
                if (!attrs) {
                    attrs = {
                        hostname: window.location.hostname,
                        title: window.document.title
                    };
                }
                else if (!Helpers.isObject(attrs)){
                    Helpers.logDebug('The attributes argument must be an object. A ' + typeof attrs + ' was entered. Please correct and retry.');
                    return;
                }
                if (customFlags && !Helpers.isObject(customFlags)) {
                    Helpers.logDebug('The customFlags argument must be an object. A ' + typeof customFlags + ' was entered. Please correct and retry.');
                    return;
                }
            }

            Events.logEvent(Types.MessageType.PageView, eventName, attrs, Types.EventType.Unknown, customFlags);
        },
        Consent: {
            createGDPRConsent: Consent.createGDPRConsent,
            createConsentState: Consent.createConsentState
        },
        /**
        * Invoke these methods on the mParticle.eCommerce object.
        * Example: mParticle.eCommerce.createImpresion(...)
        * @class mParticle.eCommerce
        */
        eCommerce: {
            /**
            * Invoke these methods on the mParticle.eCommerce.Cart object.
            * Example: mParticle.eCommerce.Cart.add(...)
            * @class mParticle.eCommerce.Cart
            */
            Cart: {
                /**
                * Adds a product to the cart
                * @method add
                * @param {Object} product The product you want to add to the cart
                * @param {Boolean} [logEventBoolean] Option to log the event to mParticle's servers. If blank, no logging occurs.
                */
                add: function(product, logEventBoolean) {
                    mParticleUserCart(MP.mpid).add(product, logEventBoolean);
                },
                /**
                * Removes a product from the cart
                * @method remove
                * @param {Object} product The product you want to add to the cart
                * @param {Boolean} [logEventBoolean] Option to log the event to mParticle's servers. If blank, no logging occurs.
                */
                remove: function(product, logEventBoolean) {
                    mParticleUserCart(MP.mpid).remove(product, logEventBoolean);
                },
                /**
                * Clears the cart
                * @method clear
                */
                clear: function() {
                    mParticleUserCart(MP.mpid).clear();
                }
            },
            /**
            * Sets the currency code
            * @for mParticle.eCommerce
            * @method setCurrencyCode
            * @param {String} code The currency code
            */
            setCurrencyCode: function(code) {
                if (typeof code !== 'string') {
                    Helpers.logDebug('Code must be a string');
                    return;
                }
                mParticle.sessionManager.resetSessionTimer();
                MP.currencyCode = code;
            },
            /**
            * Creates a product
            * @for mParticle.eCommerce
            * @method createProduct
            * @param {String} name product name
            * @param {String} sku product sku
            * @param {Number} price product price
            * @param {Number} [quantity] product quantity. If blank, defaults to 1.
            * @param {String} [variant] product variant
            * @param {String} [category] product category
            * @param {String} [brand] product brand
            * @param {Number} [position] product position
            * @param {String} [coupon] product coupon
            * @param {Object} [attributes] product attributes
            */
            createProduct: function(name, sku, price, quantity, variant, category, brand, position, coupon, attributes) {
                mParticle.sessionManager.resetSessionTimer();
                return Ecommerce.createProduct(name, sku, price, quantity, variant, category, brand, position, coupon, attributes);
            },
            /**
            * Creates a promotion
            * @for mParticle.eCommerce
            * @method createPromotion
            * @param {String} id a unique promotion id
            * @param {String} [creative] promotion creative
            * @param {String} [name] promotion name
            * @param {Number} [position] promotion position
            */
            createPromotion: function(id, creative, name, position) {
                mParticle.sessionManager.resetSessionTimer();
                return Ecommerce.createPromotion(id, creative, name, position);
            },
            /**
            * Creates a product impression
            * @for mParticle.eCommerce
            * @method createImpression
            * @param {String} name impression name
            * @param {Object} product the product for which an impression is being created
            */
            createImpression: function(name, product) {
                mParticle.sessionManager.resetSessionTimer();
                return Ecommerce.createImpression(name, product);
            },
            /**
            * Creates a transaction attributes object to be used with a checkout
            * @for mParticle.eCommerce
            * @method createTransactionAttributes
            * @param {String or Number} id a unique transaction id
            * @param {String} [affiliation] affilliation
            * @param {String} [couponCode] the coupon code for which you are creating transaction attributes
            * @param {Number} [revenue] total revenue for the product being purchased
            * @param {String} [shipping] the shipping method
            * @param {Number} [tax] the tax amount
            */
            createTransactionAttributes: function(id, affiliation, couponCode, revenue, shipping, tax) {
                mParticle.sessionManager.resetSessionTimer();
                return Ecommerce.createTransactionAttributes(id, affiliation, couponCode, revenue, shipping, tax);
            },
            /**
            * Logs a checkout action
            * @for mParticle.eCommerce
            * @method logCheckout
            * @param {Number} step checkout step number
            * @param {Object} options
            * @param {Object} attrs
            * @param {Object} [customFlags] Custom flags for the event
            */
            logCheckout: function(step, options, attrs, customFlags) {
                mParticle.sessionManager.resetSessionTimer();
                Events.logCheckoutEvent(step, options, attrs, customFlags);
            },
            /**
            * Logs a product action
            * @for mParticle.eCommerce
            * @method logProductAction
            * @param {Number} productActionType product action type as found [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/src/types.js#L206-L218)
            * @param {Object} product the product for which you are creating the product action
            * @param {Object} [attrs] attributes related to the product action
            * @param {Object} [customFlags] Custom flags for the event
            */
            logProductAction: function(productActionType, product, attrs, customFlags) {
                mParticle.sessionManager.resetSessionTimer();
                Events.logProductActionEvent(productActionType, product, attrs, customFlags);
            },
            /**
            * Logs a product purchase
            * @for mParticle.eCommerce
            * @method logPurchase
            * @param {Object} transactionAttributes transactionAttributes object
            * @param {Object} product the product being purchased
            * @param {Boolean} [clearCart] boolean to clear the cart after logging or not. Defaults to false
            * @param {Object} [attrs] other attributes related to the product purchase
            * @param {Object} [customFlags] Custom flags for the event
            */
            logPurchase: function(transactionAttributes, product, clearCart, attrs, customFlags) {
                if (!transactionAttributes || !product) {
                    Helpers.logDebug(Messages.ErrorMessages.BadLogPurchase);
                    return;
                }
                mParticle.sessionManager.resetSessionTimer();
                Events.logPurchaseEvent(transactionAttributes, product, attrs, customFlags);

                if (clearCart === true) {
                    mParticle.eCommerce.Cart.clear();
                }
            },
            /**
            * Logs a product promotion
            * @for mParticle.eCommerce
            * @method logPromotion
            * @param {Number} type the promotion type as found [here](https://github.com/mParticle/mparticle-sdk-javascript/blob/master-v2/src/types.js#L275-L279)
            * @param {Object} promotion promotion object
            * @param {Object} [attrs] boolean to clear the cart after logging or not
            * @param {Object} [customFlags] Custom flags for the event
            */
            logPromotion: function(type, promotion, attrs, customFlags) {
                mParticle.sessionManager.resetSessionTimer();
                Events.logPromotionEvent(type, promotion, attrs, customFlags);
            },
            /**
            * Logs a product impression
            * @for mParticle.eCommerce
            * @method logImpression
            * @param {Object} impression product impression object
            * @param {Object} attrs attributes related to the impression log
            * @param {Object} [customFlags] Custom flags for the event
            */
            logImpression: function(impression, attrs, customFlags) {
                mParticle.sessionManager.resetSessionTimer();
                Events.logImpressionEvent(impression, attrs, customFlags);
            },
            /**
            * Logs a refund
            * @for mParticle.eCommerce
            * @method logRefund
            * @param {Object} transactionAttributes transaction attributes related to the refund
            * @param {Object} product product being refunded
            * @param {Boolean} [clearCart] boolean to clear the cart after refund is logged. Defaults to false.
            * @param {Object} [attrs] attributes related to the refund
            * @param {Object} [customFlags] Custom flags for the event
            */
            logRefund: function(transactionAttributes, product, clearCart, attrs, customFlags) {
                mParticle.sessionManager.resetSessionTimer();
                Events.logRefundEvent(transactionAttributes, product, attrs, customFlags);

                if (clearCart === true) {
                    mParticle.eCommerce.Cart.clear();
                }
            },
            expandCommerceEvent: function(event) {
                mParticle.sessionManager.resetSessionTimer();
                return Ecommerce.expandCommerceEvent(event);
            }
        },
        /**
        * Sets a session attribute
        * @for mParticle
        * @method setSessionAttribute
        * @param {String} key key for session attribute
        * @param {String or Number} value value for session attribute
        */
        setSessionAttribute: function(key, value) {
            mParticle.sessionManager.resetSessionTimer();
            // Logs to cookie
            // And logs to in-memory object
            // Example: mParticle.setSessionAttribute('location', '33431');
            if (Helpers.canLog()) {
                if (!Validators.isValidAttributeValue(value)) {
                    Helpers.logDebug(Messages.ErrorMessages.BadAttribute);
                    return;
                }

                if (!Validators.isValidKeyValue(key)) {
                    Helpers.logDebug(Messages.ErrorMessages.BadKey);
                    return;
                }

                if (MP.webviewBridgeEnabled) {
                    NativeSdkHelpers.sendToNative(Constants.NativeSdkPaths.SetSessionAttribute, JSON.stringify({ key: key, value: value }));
                } else {
                    var existingProp = Helpers.findKeyInObject(MP.sessionAttributes, key);

                    if (existingProp) {
                        key = existingProp;
                    }

                    MP.sessionAttributes[key] = value;
                    Persistence.update();

                    Forwarders.applyToForwarders('setSessionAttribute', [key, value]);
                }
            }
        },
        /**
        * Set opt out of logging
        * @for mParticle
        * @method setOptOut
        * @param {Boolean} isOptingOut boolean to opt out or not. When set to true, opt out of logging.
        */
        setOptOut: function(isOptingOut) {
            mParticle.sessionManager.resetSessionTimer();
            MP.isEnabled = !isOptingOut;

            Events.logOptOut();
            Persistence.update();

            if (MP.activeForwarders.length) {
                MP.activeForwarders.forEach(function(forwarder) {
                    if (forwarder.setOptOut) {
                        var result = forwarder.setOptOut(isOptingOut);

                        if (result) {
                            Helpers.logDebug(result);
                        }
                    }
                });
            }
        },
        /**
        * Set or remove the integration attributes for a given integration ID.
        * Integration attributes are keys and values specific to a given integration. For example,
        * many integrations have their own internal user/device ID. mParticle will store integration attributes
        * for a given device, and will be able to use these values for server-to-server communication to services.
        * This is often useful when used in combination with a server-to-server feed, allowing the feed to be enriched
        * with the necessary integration attributes to be properly forwarded to the given integration.
        * @for mParticle
        * @method setIntegrationAttribute
        * @param {Number} integrationId mParticle integration ID
        * @param {Object} attrs a map of attributes that will replace any current attributes. The keys are predefined by mParticle.
        * Please consult with the mParticle docs or your solutions consultant for the correct value. You may
        * also pass a null or empty map here to remove all of the attributes.
        */
        setIntegrationAttribute: function(integrationId, attrs) {
            if (typeof integrationId !== 'number') {
                Helpers.logDebug('integrationId must be a number');
                return;
            }
            if (attrs === null) {
                MP.integrationAttributes[integrationId] = {};
            } else if (Helpers.isObject(attrs)) {
                if (Object.keys(attrs).length === 0) {
                    MP.integrationAttributes[integrationId] = {};
                } else {
                    for (var key in attrs) {
                        if (typeof key === 'string') {
                            if (typeof attrs[key] === 'string') {
                                if (Helpers.isObject(MP.integrationAttributes[integrationId])) {
                                    MP.integrationAttributes[integrationId][key] = attrs[key];
                                } else {
                                    MP.integrationAttributes[integrationId] = {};
                                    MP.integrationAttributes[integrationId][key] = attrs[key];
                                }
                            } else {
                                Helpers.logDebug('Values for integration attributes must be strings. You entered a ' + typeof attrs[key]);
                                continue;
                            }
                        } else {
                            Helpers.logDebug('Keys must be strings, you entered a ' + typeof key);
                            continue;
                        }
                    }
                }
            } else {
                Helpers.logDebug('Attrs must be an object with keys and values. You entered a ' + typeof attrs);
                return;
            }
            Persistence.update();
        },
        /**
        * Get integration attributes for a given integration ID.
        * @method getIntegrationAttributes
        * @param {Number} integrationId mParticle integration ID
        * @return {Object} an object map of the integrationId's attributes
        */
        getIntegrationAttributes: function(integrationId) {
            if (MP.integrationAttributes[integrationId]) {
                return MP.integrationAttributes[integrationId];
            } else {
                return {};
            }
        },
        addForwarder: function(forwarderProcessor) {
            MP.forwarderConstructors.push(forwarderProcessor);
        },
        configureForwarder: function(configuration) {
            var newForwarder = null,
                config = configuration;
            for (var i = 0; i < MP.forwarderConstructors.length; i++) {
                if (MP.forwarderConstructors[i].name === config.name) {
                    if (config.isDebug === mParticle.isDevelopmentMode || config.isSandbox === mParticle.isDevelopmentMode) {
                        newForwarder = new MP.forwarderConstructors[i].constructor();

                        newForwarder.id = config.moduleId;
                        newForwarder.isSandbox = config.isDebug || config.isSandbox;
                        newForwarder.hasSandbox = config.hasDebugString === 'true';
                        newForwarder.isVisible = config.isVisible;
                        newForwarder.settings = config.settings;

                        newForwarder.eventNameFilters = config.eventNameFilters;
                        newForwarder.eventTypeFilters = config.eventTypeFilters;
                        newForwarder.attributeFilters = config.attributeFilters;

                        newForwarder.screenNameFilters = config.screenNameFilters;
                        newForwarder.screenNameFilters = config.screenNameFilters;
                        newForwarder.pageViewAttributeFilters = config.pageViewAttributeFilters;

                        newForwarder.userIdentityFilters = config.userIdentityFilters;
                        newForwarder.userAttributeFilters = config.userAttributeFilters;

                        newForwarder.filteringEventAttributeValue = config.filteringEventAttributeValue;
                        newForwarder.filteringUserAttributeValue = config.filteringUserAttributeValue;
                        newForwarder.eventSubscriptionId = config.eventSubscriptionId;
                        newForwarder.filteringConsentRuleValues = config.filteringConsentRuleValues;
                        newForwarder.excludeAnonymousUser = config.excludeAnonymousUser;

                        MP.configuredForwarders.push(newForwarder);
                        break;
                    }
                }
            }
        },
        configurePixel: function(settings) {
            if (settings.isDebug === mParticle.isDevelopmentMode || settings.isProduction !== mParticle.isDevelopmentMode) {
                MP.pixelConfigurations.push(settings);
            }
        },
        _getActiveForwarders: function() {
            return MP.activeForwarders;
        },
        _getIntegrationDelays: function() {
            return MP.integrationDelays;
        },
        _configureFeatures: function(featureFlags) {
            for (var key in featureFlags) {
                if (featureFlags.hasOwnProperty(key)) {
                    MP.featureFlags[key] = featureFlags[key];
                }
            }
        },
        _setIntegrationDelay: function(module, boolean) {
            MP.integrationDelays[module] = boolean;
        }
    };

    function processPreloadedItem(readyQueueItem) {
        var currentUser,
            args = readyQueueItem,
            method = args.splice(0, 1)[0];
        if (mParticle[args[0]]) {
            mParticle[method].apply(this, args);
        } else {
            var methodArray = method.split('.');
            try {
                var computedMPFunction = mParticle;
                for (var i = 0; i < methodArray.length; i++) {
                    var currentMethod = methodArray[i];
                    computedMPFunction = computedMPFunction[currentMethod];
                }
                computedMPFunction.apply(currentUser, args);
            } catch(e) {
                Helpers.logDebug('Unable to compute proper mParticle function ' + e);
            }
        }
    }

    // Read existing configuration if present
    if (window.mParticle && window.mParticle.config) {
        if (window.mParticle.config.serviceUrl) {
            Constants.serviceUrl = window.mParticle.config.serviceUrl;
        }

        if (window.mParticle.config.secureServiceUrl) {
            Constants.secureServiceUrl = window.mParticle.config.secureServiceUrl;
        }

        // Check for any functions queued
        if (window.mParticle.config.rq) {
            MP.readyQueue = window.mParticle.config.rq;
        }

        if (window.mParticle.config.logLevel) {
            MP.logLevel = window.mParticle.config.logLevel;
        }

        if (window.mParticle.config.hasOwnProperty('isDevelopmentMode')) {
            mParticle.isDevelopmentMode = Helpers.returnConvertedBoolean(window.mParticle.config.isDevelopmentMode);
        }

        if (window.mParticle.config.hasOwnProperty('useNativeSdk')) {
            mParticle.useNativeSdk = window.mParticle.config.useNativeSdk;
        }

        if (window.mParticle.config.hasOwnProperty('useCookieStorage')) {
            mParticle.useCookieStorage = window.mParticle.config.useCookieStorage;
        }

        if (window.mParticle.config.hasOwnProperty('maxProducts')) {
            mParticle.maxProducts = window.mParticle.config.maxProducts;
        }

        if (window.mParticle.config.hasOwnProperty('maxCookieSize')) {
            mParticle.maxCookieSize = window.mParticle.config.maxCookieSize;
        }

        if (window.mParticle.config.hasOwnProperty('appName')) {
            MP.appName = window.mParticle.config.appName;
        }

        if (window.mParticle.config.hasOwnProperty('integrationDelayTimeout')) {
            mParticle.integrationDelayTimeout = window.mParticle.config.integrationDelayTimeout;
        }

        if (window.mParticle.config.hasOwnProperty('identifyRequest')) {
            mParticle.identifyRequest = window.mParticle.config.identifyRequest;
        }

        if (window.mParticle.config.hasOwnProperty('identityCallback')) {
            var callback = window.mParticle.config.identityCallback;
            if (Validators.isFunction(callback)) {
                mParticle.identityCallback = window.mParticle.config.identityCallback;
            } else {
                Helpers.logDebug('The optional callback must be a function. You tried entering a(n) ' + typeof callback, ' . Callback not set. Please set your callback again.');
            }
        }

        if (window.mParticle.config.hasOwnProperty('appVersion')) {
            MP.appVersion = window.mParticle.config.appVersion;
        }

        if (window.mParticle.config.hasOwnProperty('sessionTimeout')) {
            MP.Config.SessionTimeout = window.mParticle.config.sessionTimeout;
        }

        if (window.mParticle.config.hasOwnProperty('forceHttps')) {
            mParticle.forceHttps = window.mParticle.config.forceHttps;
        } else {
            mParticle.forceHttps = true;
        }

        // Some forwarders require custom flags on initialization, so allow them to be set using config object
        if (window.mParticle.config.hasOwnProperty('customFlags')) {
            MP.customFlags = window.mParticle.config.customFlags;
        }

        if (window.mParticle.config.hasOwnProperty('workspaceToken')) {
            mParticle.workspaceToken = window.mParticle.config.workspaceToken;
        }

        if (window.mParticle.config.hasOwnProperty('webviewEnabled')) {
            mParticle.webviewEnabled = window.mParticle.config.webviewEnabled;
        }

        if (window.mParticle.config.hasOwnProperty('requiredWebviewBridgeName')) {
            mParticle.requiredWebviewBridgeName = window.mParticle.config.requiredWebviewBridgeName;
        } else {
            mParticle.requiredWebviewBridgeName = window.mParticle.config.workspaceToken;
        }

        if (window.mParticle.config.hasOwnProperty('minWebviewBridgeVersion')) {
            mParticle.minWebviewBridgeVersion = window.mParticle.config.minWebviewBridgeVersion;
        }
    }
    window.mParticle = mParticle;
})(window);

},{"./consent":2,"./constants":3,"./cookieSyncManager":4,"./ecommerce":5,"./events":6,"./forwarders":7,"./forwardingStatsUploader":8,"./helpers":9,"./identity":10,"./migrations":13,"./mp":14,"./nativeSdkHelpers":15,"./persistence":16,"./polyfill":17,"./sessionManager":19,"./types":20}],13:[function(require,module,exports){
var Persistence = require('./persistence'),
    Constants = require('./constants'),
    Types = require('./types'),
    Helpers = require('./helpers'),
    MP = require('./mp'),
    Config = MP.Config,
    SDKv2NonMPIDCookieKeys = Constants.SDKv2NonMPIDCookieKeys,
    Base64 = require('./polyfill').Base64,
    CookiesGlobalSettingsKeys = {
        currentSessionMPIDs: 1,
        csm: 1,
        sid: 1,
        isEnabled: 1,
        ie: 1,
        sa: 1,
        ss: 1,
        dt: 1,
        les: 1,
        av: 1,
        cgid: 1,
        das: 1,
        c: 1
    },
    MPIDKeys = {
        ui: 1,
        ua: 1,
        csd: 1
    };

//  if there is a cookie or localStorage:
//  1. determine which version it is ('mprtcl-api', 'mprtcl-v2', 'mprtcl-v3', 'mprtcl-v4')
//  2. return if 'mprtcl-v4', otherwise migrate to mprtclv4 schema
 // 3. if 'mprtcl-api', could be JSSDKv2 or JSSDKv1. JSSDKv2 cookie has a 'globalSettings' key on it
function migrate() {
    try {
        migrateCookies();
    } catch (e) {
        Persistence.expireCookies(Config.CookieNameV3);
        Persistence.expireCookies(Config.CookieNameV4);
        Helpers.logDebug('Error migrating cookie: ' + e);
    }

    if (MP.isLocalStorageAvailable) {
        try {
            migrateLocalStorage();
        } catch (e) {
            localStorage.removeItem(Config.LocalStorageNameV3);
            localStorage.removeItem(Config.LocalStorageNameV4);
            Helpers.logDebug('Error migrating localStorage: ' + e);
        }
    }
}

function migrateCookies() {
    var cookies = window.document.cookie.split('; '),
        foundCookie,
        i,
        l,
        parts,
        name,
        cookie;

    Helpers.logDebug(Constants.Messages.InformationMessages.CookieSearch);

    for (i = 0, l = cookies.length; i < l; i++) {
        parts = cookies[i].split('=');
        name = Helpers.decoded(parts.shift());
        cookie = Helpers.decoded(parts.join('=')),
        foundCookie;

        //most recent version needs no migration
        if (name === Config.CookieNameV4) {
            break;
        // migration path for SDKv1CookiesV3, doesn't need to be encoded
        } else if (name === Config.CookieNameV3) {
            foundCookie = convertSDKv1CookiesV3ToSDKv2CookiesV4(cookie);
            finishCookieMigration(foundCookie, Config.CookieNameV3);
            break;
        // migration path for SDKv1CookiesV2, needs to be encoded
        } else if (name === Config.CookieNameV2) {
            foundCookie = convertSDKv1CookiesV2ToSDKv2CookiesV4(Helpers.converted(cookie));
            finishCookieMigration(Persistence.encodeCookies(foundCookie), Config.CookieNameV2);
            break;
        // migration path for v1, needs to be encoded
        } else if (name === Config.CookieName) {
            foundCookie = Helpers.converted(cookie);
            if (JSON.parse(foundCookie).globalSettings) {
                // CookieV1 from SDKv2
                foundCookie = convertSDKv2CookiesV1ToSDKv2DecodedCookiesV4(foundCookie);
            } else {
                // CookieV1 from SDKv1
                foundCookie = convertSDKv1CookiesV1ToSDKv2CookiesV4(foundCookie);
            }
            finishCookieMigration(Persistence.encodeCookies(foundCookie), Config.CookieName);
            break;
        }
    }
}

function finishCookieMigration(cookie, cookieName) {
    var date = new Date(),
        cookieDomain = Persistence.getCookieDomain(),
        expires,
        domain;

    expires = new Date(date.getTime() +
    (Config.CookieExpiration * 24 * 60 * 60 * 1000)).toGMTString();

    if (cookieDomain === '') {
        domain = '';
    } else {
        domain = ';domain=' + cookieDomain;
    }

    Helpers.logDebug(Constants.Messages.InformationMessages.CookieSet);

    window.document.cookie =
    encodeURIComponent(Config.CookieNameV4) + '=' + cookie +
    ';expires=' + expires +
    ';path=/' + domain;

    Persistence.expireCookies(cookieName);
    MP.migratingToIDSyncCookies = true;
}

function convertSDKv1CookiesV1ToSDKv2CookiesV4(SDKv1CookiesV1) {
    var parsedCookiesV4 = JSON.parse(restructureToV4Cookie(decodeURIComponent(SDKv1CookiesV1))),
        parsedSDKv1CookiesV1 = JSON.parse(decodeURIComponent(SDKv1CookiesV1));

    // UI was stored as an array previously, we need to convert to an object
    parsedCookiesV4 = convertUIFromArrayToObject(parsedCookiesV4);

    if (parsedSDKv1CookiesV1.mpid) {
        parsedCookiesV4.gs.csm.push(parsedSDKv1CookiesV1.mpid);
        migrateProductsFromSDKv1ToSDKv2CookiesV4(parsedSDKv1CookiesV1, parsedSDKv1CookiesV1.mpid);
    }

    return JSON.stringify(parsedCookiesV4);
}

function convertSDKv1CookiesV2ToSDKv2CookiesV4(SDKv1CookiesV2) {
    // structure of SDKv1CookiesV2 is identital to SDKv1CookiesV1
    return convertSDKv1CookiesV1ToSDKv2CookiesV4(SDKv1CookiesV2);
}

function convertSDKv1CookiesV3ToSDKv2CookiesV4(SDKv1CookiesV3) {
    SDKv1CookiesV3 = Persistence.replacePipesWithCommas(Persistence.replaceApostrophesWithQuotes(SDKv1CookiesV3));
    var parsedSDKv1CookiesV3 = JSON.parse(SDKv1CookiesV3);
    var parsedCookiesV4 = JSON.parse(restructureToV4Cookie(SDKv1CookiesV3));

    if (parsedSDKv1CookiesV3.mpid) {
        parsedCookiesV4.gs.csm.push(parsedSDKv1CookiesV3.mpid);
        // all other values are already encoded, so we have to encode any new values
        parsedCookiesV4.gs.csm = Base64.encode(JSON.stringify(parsedCookiesV4.gs.csm));
        migrateProductsFromSDKv1ToSDKv2CookiesV4(parsedSDKv1CookiesV3, parsedSDKv1CookiesV3.mpid);
    }

    return JSON.stringify(parsedCookiesV4);
}

function convertSDKv2CookiesV1ToSDKv2DecodedCookiesV4(SDKv2CookiesV1) {
    try {
        var cookiesV4 = { gs: {}},
            localStorageProducts = {};

        SDKv2CookiesV1 = JSON.parse(SDKv2CookiesV1);
        cookiesV4 = setGlobalSettings(cookiesV4, SDKv2CookiesV1);

        // set each MPID's respective persistence
        for (var mpid in SDKv2CookiesV1) {
            if (!SDKv2NonMPIDCookieKeys[mpid]) {
                cookiesV4[mpid] = {};
                for (var mpidKey in SDKv2CookiesV1[mpid]) {
                    if (SDKv2CookiesV1[mpid].hasOwnProperty(mpidKey)) {
                        if (MPIDKeys[mpidKey]) {
                            if (Helpers.isObject(SDKv2CookiesV1[mpid][mpidKey]) && Object.keys(SDKv2CookiesV1[mpid][mpidKey]).length) {
                                if (mpidKey === 'ui') {
                                    cookiesV4[mpid].ui = {};
                                    for (var typeName in SDKv2CookiesV1[mpid][mpidKey]) {
                                        if (SDKv2CookiesV1[mpid][mpidKey].hasOwnProperty(typeName)) {
                                            cookiesV4[mpid].ui[Types.IdentityType.getIdentityType(typeName)] = SDKv2CookiesV1[mpid][mpidKey][typeName];
                                        }
                                    }
                                } else {
                                    cookiesV4[mpid][mpidKey] = SDKv2CookiesV1[mpid][mpidKey];
                                }
                            }
                        }
                    }
                }

                localStorageProducts[mpid] = {
                    cp: SDKv2CookiesV1[mpid].cp
                };
            }
        }
        if (MP.isLocalStorageAvailable) {
            localStorage.setItem(Config.LocalStorageProductsV4, Base64.encode(JSON.stringify(localStorageProducts)));
        }

        if (SDKv2CookiesV1.currentUserMPID) {
            cookiesV4.cu = SDKv2CookiesV1.currentUserMPID;
        }

        return JSON.stringify(cookiesV4);
    }
    catch (e) {
        Helpers.logDebug('Failed to convert cookies from SDKv2 cookies v1 to SDKv2 cookies v4');
    }
}

// migrate from object containing globalSettings to gs to reduce cookie size
function setGlobalSettings(cookies, SDKv2CookiesV1) {
    if (SDKv2CookiesV1 && SDKv2CookiesV1.globalSettings) {
        for (var key in SDKv2CookiesV1.globalSettings) {
            if (SDKv2CookiesV1.globalSettings.hasOwnProperty(key)) {
                if (key === 'currentSessionMPIDs') {
                    cookies.gs.csm = SDKv2CookiesV1.globalSettings[key];
                } else if (key === 'isEnabled') {
                    cookies.gs.ie = SDKv2CookiesV1.globalSettings[key];
                } else {
                    cookies.gs[key] = SDKv2CookiesV1.globalSettings[key];
                }
            }
        }
    }

    return cookies;
}

function restructureToV4Cookie(cookies) {
    try {
        var cookiesV4Schema = { gs: {csm: []} };
        cookies = JSON.parse(cookies);

        for (var key in cookies) {
            if (cookies.hasOwnProperty(key)) {
                if (CookiesGlobalSettingsKeys[key]) {
                    if (key === 'isEnabled') {
                        cookiesV4Schema.gs.ie = cookies[key];
                    } else {
                        cookiesV4Schema.gs[key] = cookies[key];
                    }
                } else if (key === 'mpid') {
                    cookiesV4Schema.cu = cookies[key];
                } else if (cookies.mpid) {
                    cookiesV4Schema[cookies.mpid] = cookiesV4Schema[cookies.mpid] || {};
                    if (MPIDKeys[key]) {
                        cookiesV4Schema[cookies.mpid][key] = cookies[key];
                    }
                }
            }
        }
        return JSON.stringify(cookiesV4Schema);
    }
    catch (e) {
        Helpers.logDebug('Failed to restructure previous cookie into most current cookie schema');
    }
}

function migrateProductsFromSDKv1ToSDKv2CookiesV4(cookies, mpid) {
    if (!MP.isLocalStorageAvailable) {
        return;
    }

    var localStorageProducts = {};
    localStorageProducts[mpid] = {};
    if (cookies.cp) {
        try {
            localStorageProducts[mpid].cp = JSON.parse(Base64.decode(cookies.cp));
        }
        catch (e) {
            localStorageProducts[mpid].cp = cookies.cp;
        }

        if (!Array.isArray(localStorageProducts[mpid].cp)) {
            localStorageProducts[mpid].cp = [];
        }
    }

    localStorage.setItem(Config.LocalStorageProductsV4, Base64.encode(JSON.stringify(localStorageProducts)));
}

function migrateLocalStorage() {
    var currentVersionLSName = Config.LocalStorageNameV4,
        cookies,
        v1LSName = Config.LocalStorageName,
        v3LSName = Config.LocalStorageNameV3,
        currentVersionLSData = window.localStorage.getItem(currentVersionLSName),
        v1LSData,
        v3LSData,
        v3LSDataStringCopy;

    if (!currentVersionLSData) {
        v3LSData = window.localStorage.getItem(v3LSName);
        if (v3LSData) {
            MP.migratingToIDSyncCookies = true;
            v3LSDataStringCopy = v3LSData.slice();
            v3LSData = JSON.parse(Persistence.replacePipesWithCommas(Persistence.replaceApostrophesWithQuotes(v3LSData)));
            // localStorage may contain only products, or the full persistence
            // when there is an MPID on the cookie, it is the full persistence
            if (v3LSData.mpid) {
                v3LSData = JSON.parse(convertSDKv1CookiesV3ToSDKv2CookiesV4(v3LSDataStringCopy));
                finishLSMigration(JSON.stringify(v3LSData), v3LSName);
                return;
            // if no MPID, it is only the products
            } else if ((v3LSData.cp || v3LSData.pb) && !v3LSData.mpid) {
                cookies = Persistence.getCookie();
                if (cookies) {
                    migrateProductsFromSDKv1ToSDKv2CookiesV4(v3LSData, cookies.cu);
                    localStorage.removeItem(Config.LocalStorageNameV3);
                    return;
                } else {
                    localStorage.removeItem(Config.LocalStorageNameV3);
                    return;
                }
            }
        } else {
            v1LSData = JSON.parse(decodeURIComponent(window.localStorage.getItem(v1LSName)));
            if (v1LSData) {
                MP.migratingToIDSyncCookies = true;
                // SDKv2
                if (v1LSData.globalSettings || v1LSData.currentUserMPID) {
                    v1LSData = JSON.parse(convertSDKv2CookiesV1ToSDKv2DecodedCookiesV4(JSON.stringify(v1LSData)));
                    // SDKv1
                    // only products, not full persistence
                } else if ((v1LSData.cp || v1LSData.pb) && !v1LSData.mpid) {
                    cookies = Persistence.getCookie();
                    if (cookies) {
                        migrateProductsFromSDKv1ToSDKv2CookiesV4(v1LSData, cookies.cu);
                        window.localStorage.removeItem(v1LSName);
                        return;
                    } else {
                        window.localStorage.removeItem(v1LSName);
                        return;
                    }
                } else {
                    v1LSData = JSON.parse(convertSDKv1CookiesV1ToSDKv2CookiesV4(JSON.stringify(v1LSData)));
                }

                if (Helpers.isObject(v1LSData) && Object.keys(v1LSData).length) {
                    v1LSData = Persistence.encodeCookies(JSON.stringify(v1LSData));
                    finishLSMigration(v1LSData, v1LSName);
                    return;
                }
            }
        }
    }

    function finishLSMigration(data, lsName) {
        try {
            window.localStorage.setItem(encodeURIComponent(Config.LocalStorageNameV4), data);
        }
        catch (e) {
            Helpers.logDebug('Error with setting localStorage item.');
        }
        window.localStorage.removeItem(encodeURIComponent(lsName));
    }
}

function convertUIFromArrayToObject(cookie) {
    try {
        if (cookie && Helpers.isObject(cookie)) {
            for (var mpid in cookie) {
                if (cookie.hasOwnProperty(mpid)) {
                    if (!SDKv2NonMPIDCookieKeys[mpid]) {
                        if (cookie[mpid].ui && Array.isArray(cookie[mpid].ui)) {
                            cookie[mpid].ui = cookie[mpid].ui.reduce(function(accum, identity) {
                                if (identity.Type && Helpers.Validators.isStringOrNumber(identity.Identity)) {
                                    accum[identity.Type] = identity.Identity;
                                }
                                return accum;
                            }, {});
                        }
                    }
                }
            }
        }

        return cookie;
    }
    catch (e) {
        Helpers.logDebug('An error ocurred when converting the user identities array to an object', e);
    }
}

module.exports = {
    migrate: migrate,
    convertUIFromArrayToObject: convertUIFromArrayToObject,
    convertSDKv1CookiesV1ToSDKv2CookiesV4: convertSDKv1CookiesV1ToSDKv2CookiesV4,
    convertSDKv1CookiesV2ToSDKv2CookiesV4: convertSDKv1CookiesV2ToSDKv2CookiesV4,
    convertSDKv1CookiesV3ToSDKv2CookiesV4: convertSDKv1CookiesV3ToSDKv2CookiesV4,
    convertSDKv2CookiesV1ToSDKv2DecodedCookiesV4: convertSDKv2CookiesV1ToSDKv2DecodedCookiesV4
};

},{"./constants":3,"./helpers":9,"./mp":14,"./persistence":16,"./polyfill":17,"./types":20}],14:[function(require,module,exports){
module.exports = {
    isEnabled: true,
    sessionAttributes: {},
    currentSessionMPIDs: [],
    userAttributes: {},
    userIdentities: {},
    consentState: null,
    forwarderConstructors: [],
    activeForwarders: [],
    configuredForwarders: [],
    sessionId: null,
    isFirstRun: null,
    clientId: null,
    deviceId: null,
    mpid: null,
    devToken: null,
    migrationData: {},
    pixelConfigurations: [],
    serverSettings: {},
    dateLastEventSent: null,
    sessionStartDate: null,
    cookieSyncDates: {},
    currentPosition: null,
    isTracking: false,
    watchPositionId: null,
    readyQueue: [],
    isInitialized: false,
    cartProducts: [],
    eventQueue: [],
    currencyCode: null,
    appVersion: null,
    appName: null,
    customFlags: null,
    globalTimer: null,
    context: '',
    identityCallInFlight: false,
    initialIdentifyRequest: null,
    logLevel: null,
    Config: {},
    migratingToIDSyncCookies: false,
    nonCurrentUserMPIDs: {},
    identifyCalled: false,
    isLoggedIn: false,
    integrationAttributes: {},
    integrationDelays: {},
    requireDelay: true,
    featureFlags: {
        batching: false
    },
    isLocalStorageAvailable: null,
    bridgeVersion: null
};

},{}],15:[function(require,module,exports){
var Helpers = require('./helpers'),
    Messages = require('./constants').Messages;

var androidBridgeNameBase = 'mParticleAndroid';
var iosBridgeNameBase = 'mParticle';

function isBridgeV2Available(bridgeName) {
    if (!bridgeName) {
        return false;
    }
    var androidBridgeName = androidBridgeNameBase + '_' + bridgeName + '_v2';
    var iosBridgeName = iosBridgeNameBase + '_' + bridgeName + '_v2';

    // iOS
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hasOwnProperty(iosBridgeName)) {
        return true;
    }
    // android
    if (window.hasOwnProperty(androidBridgeName)) {
        return true;
    }
    return false;
}

function isWebviewEnabled(requiredWebviewBridgeName, minWebviewBridgeVersion) {
    if (mParticle.webviewEnabled) {
        if (minWebviewBridgeVersion < 2) {
            return isBridgeV1Available();
        }
        if (minWebviewBridgeVersion === 2) {
            return isBridgeV2Available(requiredWebviewBridgeName);
        }
    } else if (minWebviewBridgeVersion === 1) {
        return isBridgeV1Available();
    }
    return false;
}

function isBridgeV1Available() {
    if (mParticle.useNativeSdk || window.mParticleAndroid
        || window.mParticle.isIOS) {
        return true;
    }

    return false;
}

function sendToNative(path, value) {
    if (mParticle.minWebviewBridgeVersion < 2) {
        sendViaBridgeV1(path, value);
    } else {
        sendViaBridgeV2(path, value);
    }
}

function sendViaBridgeV1(path, value) {
    if (window.mParticleAndroid && window.mParticleAndroid.hasOwnProperty(path)) {
        Helpers.logDebug(Messages.InformationMessages.SendAndroid + path);
        window.mParticleAndroid[path](value);
    }
    else if (window.mParticle.isIOS) {
        Helpers.logDebug(Messages.InformationMessages.SendIOS + path);
        var iframe = document.createElement('IFRAME');
        iframe.setAttribute('src', 'mp-sdk://' + path + '/' + encodeURIComponent(value));
        document.documentElement.appendChild(iframe);
        iframe.parentNode.removeChild(iframe);
        iframe = null;
    }
}

function sendViaBridgeV2(path, value) {
    var androidBridgeName = androidBridgeNameBase + '_' + mParticle.requiredWebviewBridgeName + '_v2';
    var iosBridgeName = iosBridgeNameBase + '_' + mParticle.requiredWebviewBridgeName + '_v2';
    var androidBridge = window[androidBridgeName],
        iOSBridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[iosBridgeName] ? window.webkit.messageHandlers[iosBridgeName] : null;
    if (androidBridge && androidBridge.hasOwnProperty(path)) {
        Helpers.logDebug(Messages.InformationMessages.SendAndroid + path);
        androidBridge[path](value);
    }
    else if (iOSBridge) {
        Helpers.logDebug(Messages.InformationMessages.SendIOS + path);
        iOSBridge.postMessage(JSON.stringify({path:path, value: value ? JSON.parse(value) : null}));
    }
}

module.exports = {
    isWebviewEnabled: isWebviewEnabled,
    isBridgeV2Available:isBridgeV2Available,
    sendToNative: sendToNative,
    sendViaBridgeV1: sendViaBridgeV1,
    sendViaBridgeV2: sendViaBridgeV2
};

},{"./constants":3,"./helpers":9}],16:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    Base64 = require('./polyfill').Base64,
    Messages = Constants.Messages,
    MP = require('./mp'),
    Base64CookieKeys = Constants.Base64CookieKeys,
    SDKv2NonMPIDCookieKeys = Constants.SDKv2NonMPIDCookieKeys,
    Consent = require('./consent'),
    Config = MP.Config;

function useLocalStorage() {
    return (!mParticle.useCookieStorage && MP.isLocalStorageAvailable);
}

function initializeStorage() {
    try {
        var storage,
            localStorageData = this.getLocalStorage(),
            cookies = this.getCookie(),
            allData;

        // Determine if there is any data in cookies or localStorage to figure out if it is the first time the browser is loading mParticle
        if (!localStorageData && !cookies) {
            MP.isFirstRun = true;
            MP.mpid = 0;
        } else {
            MP.isFirstRun = false;
        }

        if (!MP.isLocalStorageAvailable) {
            mParticle.useCookieStorage = true;
        }

        if (MP.isLocalStorageAvailable) {
            storage = window.localStorage;
            if (mParticle.useCookieStorage) {
                // For migrating from localStorage to cookies -- If an instance switches from localStorage to cookies, then
                // no mParticle cookie exists yet and there is localStorage. Get the localStorage, set them to cookies, then delete the localStorage item.
                if (localStorageData) {
                    if (cookies) {
                        allData = Helpers.extend(false, localStorageData, cookies);
                    } else {
                        allData = localStorageData;
                    }
                    storage.removeItem(MP.Config.LocalStorageNameV4);
                } else if (cookies) {
                    allData = cookies;
                }
                this.storeDataInMemory(allData);
            }
            else {
                // For migrating from cookie to localStorage -- If an instance is newly switching from cookies to localStorage, then
                // no mParticle localStorage exists yet and there are cookies. Get the cookies, set them to localStorage, then delete the cookies.
                if (cookies) {
                    if (localStorageData) {
                        allData = Helpers.extend(false, localStorageData, cookies);
                    } else {
                        allData = cookies;
                    }
                    this.storeDataInMemory(allData);
                    this.expireCookies(MP.Config.CookieNameV4);
                } else {
                    this.storeDataInMemory(localStorageData);
                }
            }
        } else {
            this.storeDataInMemory(cookies);
        }

        try {
            if (MP.isLocalStorageAvailable) {
                var encodedProducts = localStorage.getItem(MP.Config.LocalStorageProductsV4);

                if (encodedProducts) {
                    var decodedProducts = JSON.parse(Base64.decode(encodedProducts));
                }
                if (MP.mpid) {
                    storeProductsInMemory(decodedProducts, MP.mpid);
                }
            }
        } catch (e) {
            if (MP.isLocalStorageAvailable) {
                localStorage.removeItem(Config.LocalStorageProductsV4);
            }
            MP.cartProducts = [];
            Helpers.logDebug('Error loading products in initialization: ' + e);
        }


        for (var key in allData) {
            if (allData.hasOwnProperty(key)) {
                if (!SDKv2NonMPIDCookieKeys[key]) {
                    MP.nonCurrentUserMPIDs[key] = allData[key];
                }
            }
        }

        this.update();
    } catch (e) {
        if (useLocalStorage() && MP.isLocalStorageAvailable) {
            localStorage.removeItem(Config.LocalStorageNameV4);
        } else {
            expireCookies(Config.CookieNameV4);
        }
        Helpers.logDebug('Error initializing storage: ' + e);
    }
}

function update() {
    if (!MP.webviewBridgeEnabled) {
        if (mParticle.useCookieStorage) {
            this.setCookie();
        }

        this.setLocalStorage();
    }
}

function storeProductsInMemory(products, mpid) {
    if (products) {
        try {
            MP.cartProducts = products[mpid] && products[mpid].cp ? products[mpid].cp : [];
        }
        catch(e) {
            Helpers.logDebug(Messages.ErrorMessages.CookieParseError);
        }
    }
}

function storeDataInMemory(obj, currentMPID) {
    try {
        if (!obj) {
            Helpers.logDebug(Messages.InformationMessages.CookieNotFound);
            MP.clientId = MP.clientId || Helpers.generateUniqueId();
            MP.deviceId = MP.deviceId || Helpers.generateUniqueId();
            MP.userAttributes = {};
            MP.userIdentities = {};
            MP.cookieSyncDates = {};
            MP.consentState = null;
        } else {
            // Set MPID first, then change object to match MPID data
            if (currentMPID) {
                MP.mpid = currentMPID;
            } else {
                MP.mpid = obj.cu || 0;
            }

            obj.gs = obj.gs || {};

            MP.sessionId = obj.gs.sid || MP.sessionId;
            MP.isEnabled = (typeof obj.gs.ie !== 'undefined') ? obj.gs.ie : MP.isEnabled;
            MP.sessionAttributes = obj.gs.sa || MP.sessionAttributes;
            MP.serverSettings = obj.gs.ss || MP.serverSettings;
            MP.devToken = MP.devToken || obj.gs.dt;
            MP.appVersion = MP.appVersion || obj.gs.av;
            MP.clientId = obj.gs.cgid || MP.clientId || Helpers.generateUniqueId();
            MP.deviceId = obj.gs.das || MP.deviceId || Helpers.generateUniqueId();
            MP.integrationAttributes = obj.gs.ia || {};
            MP.context = obj.gs.c || MP.context;
            MP.currentSessionMPIDs = obj.gs.csm || MP.currentSessionMPIDs;

            MP.isLoggedIn = obj.l === true;

            if (obj.gs.les) {
                MP.dateLastEventSent = new Date(obj.gs.les);
            }

            if (obj.gs.ssd) {
                MP.sessionStartDate = new Date(obj.gs.ssd);
            } else {
                MP.sessionStartDate = new Date();
            }

            if (currentMPID) {
                obj = obj[currentMPID];
            } else {
                obj = obj[obj.cu];
            }

            MP.userAttributes = obj.ua || MP.userAttributes;
            MP.userIdentities = obj.ui || MP.userIdentities;
            MP.consentState = obj.con ? Consent.Serialization.fromMinifiedJsonObject(obj.con) : null;

            if (obj.csd) {
                MP.cookieSyncDates = obj.csd;
            }
        }
    }
    catch (e) {
        Helpers.logDebug(Messages.ErrorMessages.CookieParseError);
    }
}

function determineLocalStorageAvailability(storage) {
    var result;

    if (mParticle._forceNoLocalStorage) {
        storage = undefined;
    }

    try {
        storage.setItem('mparticle', 'test');
        result = storage.getItem('mparticle') === 'test';
        storage.removeItem('mparticle');

        if (result && storage) {
            return true;
        } else {
            return false;
        }
    }
    catch (e) {
        return false;
    }
}

function convertInMemoryDataForCookies() {
    var mpidData = {
        ua: MP.userAttributes,
        ui: MP.userIdentities,
        csd: MP.cookieSyncDates,
        con: MP.consentState ? Consent.Serialization.toMinifiedJsonObject(MP.consentState) : null
    };

    return mpidData;
}

function convertProductsForLocalStorage() {
    var inMemoryDataForLocalStorage = {
        cp: MP.cartProducts ? MP.cartProducts.length <= mParticle.maxProducts ? MP.cartProducts : MP.cartProducts.slice(0, mParticle.maxProducts) : []
    };

    return inMemoryDataForLocalStorage;
}

function getUserProductsFromLS(mpid) {
    if (!MP.isLocalStorageAvailable) {
        return [];
    }

    var decodedProducts,
        userProducts,
        parsedProducts,
        encodedProducts = localStorage.getItem(MP.Config.LocalStorageProductsV4);
    if (encodedProducts) {
        decodedProducts = Base64.decode(encodedProducts);
    }
    // if there is an MPID, we are retrieving the user's products, which is an array
    if (mpid) {
        try {
            if (decodedProducts) {
                parsedProducts = JSON.parse(decodedProducts);
            }
            if (decodedProducts && parsedProducts[mpid] && parsedProducts[mpid].cp && Array.isArray(parsedProducts[mpid].cp)) {
                userProducts = parsedProducts[mpid].cp;
            } else {
                userProducts = [];
            }
            return userProducts;
        } catch (e) {
            return [];
        }
    } else {
        return [];
    }
}

function getAllUserProductsFromLS() {
    var decodedProducts,
        encodedProducts = localStorage.getItem(MP.Config.LocalStorageProductsV4),
        parsedDecodedProducts;
    if (encodedProducts) {
        decodedProducts = Base64.decode(encodedProducts);
    }
    // returns an object with keys of MPID and values of array of products
    try {
        parsedDecodedProducts = JSON.parse(decodedProducts);
    } catch (e) {
        parsedDecodedProducts = {};
    }

    return parsedDecodedProducts;
}

function setLocalStorage() {
    if (!MP.isLocalStorageAvailable) {
        return;
    }

    var key = MP.Config.LocalStorageNameV4,
        allLocalStorageProducts = getAllUserProductsFromLS(),
        currentUserProducts = this.convertProductsForLocalStorage(),
        localStorageData = this.getLocalStorage() || {},
        currentMPIDData;

    if (MP.mpid) {
        allLocalStorageProducts = allLocalStorageProducts || {};
        allLocalStorageProducts[MP.mpid] = currentUserProducts;
        try {
            window.localStorage.setItem(encodeURIComponent(MP.Config.LocalStorageProductsV4), Base64.encode(JSON.stringify(allLocalStorageProducts)));
        }
        catch (e) {
            Helpers.logDebug('Error with setting products on localStorage.');
        }
    }

    if (!mParticle.useCookieStorage) {
        currentMPIDData = this.convertInMemoryDataForCookies();
        localStorageData.gs = localStorageData.gs || {};

        localStorageData.l = MP.isLoggedIn ? 1 : 0;

        if (MP.sessionId) {
            localStorageData.gs.csm = MP.currentSessionMPIDs;
        }

        localStorageData.gs.ie = MP.isEnabled;

        if (MP.mpid) {
            localStorageData[MP.mpid] = currentMPIDData;
            localStorageData.cu = MP.mpid;
        }

        if (Object.keys(MP.nonCurrentUserMPIDs).length) {
            localStorageData = Helpers.extend({}, localStorageData, MP.nonCurrentUserMPIDs);
            MP.nonCurrentUserMPIDs = {};
        }

        localStorageData = this.setGlobalStorageAttributes(localStorageData);

        try {
            window.localStorage.setItem(encodeURIComponent(key), encodeCookies(JSON.stringify(localStorageData)));
        }
        catch (e) {
            Helpers.logDebug('Error with setting localStorage item.');
        }
    }
}

function setGlobalStorageAttributes(data) {
    data.gs.sid = MP.sessionId;
    data.gs.ie = MP.isEnabled;
    data.gs.sa = MP.sessionAttributes;
    data.gs.ss = MP.serverSettings;
    data.gs.dt = MP.devToken;
    data.gs.les = MP.dateLastEventSent ? MP.dateLastEventSent.getTime() : null;
    data.gs.av = MP.appVersion;
    data.gs.cgid = MP.clientId;
    data.gs.das = MP.deviceId;
    data.gs.c = MP.context;
    data.gs.ssd = MP.sessionStartDate ? MP.sessionStartDate.getTime() : null;
    data.gs.ia = MP.integrationAttributes;

    return data;
}

function getLocalStorage() {
    if (!MP.isLocalStorageAvailable) {
        return null;
    }

    var key = MP.Config.LocalStorageNameV4,
        localStorageData = decodeCookies(window.localStorage.getItem(key)),
        obj = {},
        j;
    if (localStorageData) {
        localStorageData = JSON.parse(localStorageData);
        for (j in localStorageData) {
            if (localStorageData.hasOwnProperty(j)) {
                obj[j] = localStorageData[j];
            }
        }
    }

    if (Object.keys(obj).length) {
        return obj;
    }

    return null;
}

function removeLocalStorage(localStorageName) {
    localStorage.removeItem(localStorageName);
}

function retrieveDeviceId() {
    if (MP.deviceId) {
        return MP.deviceId;
    } else {
        return this.parseDeviceId(MP.serverSettings);
    }
}

function parseDeviceId(serverSettings) {
    try {
        var paramsObj = {},
            parts;

        if (serverSettings && serverSettings.uid && serverSettings.uid.Value) {
            serverSettings.uid.Value.split('&').forEach(function(param) {
                parts = param.split('=');
                paramsObj[parts[0]] = parts[1];
            });

            if (paramsObj['g']) {
                return paramsObj['g'];
            }
        }

        return Helpers.generateUniqueId();
    }
    catch (e) {
        return Helpers.generateUniqueId();
    }
}

function expireCookies(cookieName) {
    var date = new Date(),
        expires,
        domain,
        cookieDomain;

    cookieDomain = getCookieDomain();

    if (cookieDomain === '') {
        domain = '';
    } else {
        domain = ';domain=' + cookieDomain;
    }

    date.setTime(date.getTime() - (24 * 60 * 60 * 1000));
    expires = '; expires=' + date.toUTCString();
    document.cookie = cookieName + '=' + '' + expires + '; path=/' + domain;
}

function getCookie() {
    var cookies = window.document.cookie.split('; '),
        key = MP.Config.CookieNameV4,
        i,
        l,
        parts,
        name,
        cookie,
        result = key ? undefined : {};

    Helpers.logDebug(Messages.InformationMessages.CookieSearch);

    for (i = 0, l = cookies.length; i < l; i++) {
        parts = cookies[i].split('=');
        name = Helpers.decoded(parts.shift());
        cookie = Helpers.decoded(parts.join('='));

        if (key && key === name) {
            result = Helpers.converted(cookie);
            break;
        }

        if (!key) {
            result[name] = Helpers.converted(cookie);
        }
    }

    if (result) {
        Helpers.logDebug(Messages.InformationMessages.CookieFound);
        return JSON.parse(decodeCookies(result));
    } else {
        return null;
    }
}

function setCookie() {
    var date = new Date(),
        key = MP.Config.CookieNameV4,
        currentMPIDData = this.convertInMemoryDataForCookies(),
        expires = new Date(date.getTime() +
            (MP.Config.CookieExpiration * 24 * 60 * 60 * 1000)).toGMTString(),
        cookieDomain,
        domain,
        cookies = this.getCookie() || {},
        encodedCookiesWithExpirationAndPath;

    cookieDomain = getCookieDomain();

    if (cookieDomain === '') {
        domain = '';
    } else {
        domain = ';domain=' + cookieDomain;
    }

    cookies.gs = cookies.gs || {};

    if (MP.sessionId) {
        cookies.gs.csm = MP.currentSessionMPIDs;
    }

    if (MP.mpid) {
        cookies[MP.mpid] = currentMPIDData;
        cookies.cu = MP.mpid;
    }

    cookies.l = MP.isLoggedIn ? 1 : 0;

    cookies = this.setGlobalStorageAttributes(cookies);

    if (Object.keys(MP.nonCurrentUserMPIDs).length) {
        cookies = Helpers.extend({}, cookies, MP.nonCurrentUserMPIDs);
        MP.nonCurrentUserMPIDs = {};
    }

    encodedCookiesWithExpirationAndPath = reduceAndEncodeCookies(cookies, expires, domain);

    Helpers.logDebug(Messages.InformationMessages.CookieSet);

    window.document.cookie =
        encodeURIComponent(key) + '=' + encodedCookiesWithExpirationAndPath;
}

/*  This function determines if a cookie is greater than the configured maxCookieSize.
        - If it is, we remove an MPID and its associated UI/UA/CSD from the cookie.
        - Once removed, check size, and repeat.
        - Never remove the currentUser's MPID from the cookie.

    MPID removal priority:
    1. If there are no currentSessionMPIDs, remove a random MPID from the the cookie.
    2. If there are currentSessionMPIDs:
        a. Remove at random MPIDs on the cookie that are not part of the currentSessionMPIDs
        b. Then remove MPIDs based on order in currentSessionMPIDs array, which
        stores MPIDs based on earliest login.
*/
function reduceAndEncodeCookies(cookies, expires, domain) {
    var encodedCookiesWithExpirationAndPath,
        currentSessionMPIDs = cookies.gs.csm ? cookies.gs.csm : [];
    // Comment 1 above
    if (!currentSessionMPIDs.length) {
        for (var key in cookies) {
            if (cookies.hasOwnProperty(key)) {
                encodedCookiesWithExpirationAndPath = createFullEncodedCookie(cookies, expires, domain);
                if (encodedCookiesWithExpirationAndPath.length > mParticle.maxCookieSize) {
                    if (!SDKv2NonMPIDCookieKeys[key] && key !== cookies.cu) {
                        delete cookies[key];
                    }
                }
            }
        }
    } else {
        // Comment 2 above - First create an object of all MPIDs on the cookie
        var MPIDsOnCookie = {};
        for (var potentialMPID in cookies) {
            if (cookies.hasOwnProperty(potentialMPID)) {
                if (!SDKv2NonMPIDCookieKeys[potentialMPID] && potentialMPID !==cookies.cu) {
                    MPIDsOnCookie[potentialMPID] = 1;
                }
            }
        }
        // Comment 2a above
        if (Object.keys(MPIDsOnCookie).length) {
            for (var mpid in MPIDsOnCookie) {
                encodedCookiesWithExpirationAndPath = createFullEncodedCookie(cookies, expires, domain);
                if (encodedCookiesWithExpirationAndPath.length > mParticle.maxCookieSize) {
                    if (MPIDsOnCookie.hasOwnProperty(mpid)) {
                        if (currentSessionMPIDs.indexOf(mpid) === -1) {
                            delete cookies[mpid];
                        }
                    }
                }
            }
        }
        // Comment 2b above
        for (var i = 0; i < currentSessionMPIDs.length; i++) {
            encodedCookiesWithExpirationAndPath = createFullEncodedCookie(cookies, expires, domain);
            if (encodedCookiesWithExpirationAndPath.length > mParticle.maxCookieSize) {
                var MPIDtoRemove = currentSessionMPIDs[i];
                if (cookies[MPIDtoRemove]) {
                    Helpers.logDebug('Size of new encoded cookie is larger than maxCookieSize setting of ' + mParticle.maxCookieSize + '. Removing from cookie the earliest logged in MPID containing: ' + JSON.stringify(cookies[MPIDtoRemove], 0, 2));
                    delete cookies[MPIDtoRemove];
                } else {
                    Helpers.logDebug('Unable to save MPID data to cookies because the resulting encoded cookie is larger than the maxCookieSize setting of ' + mParticle.maxCookieSize + '. We recommend using a maxCookieSize of 1500.');
                }
            } else {
                break;
            }
        }
    }

    return encodedCookiesWithExpirationAndPath;
}

function createFullEncodedCookie(cookies, expires, domain) {
    return encodeCookies(JSON.stringify(cookies)) + ';expires=' + expires +';path=/' + domain;
}

function findPrevCookiesBasedOnUI(identityApiData) {
    var cookies = this.getCookie() || this.getLocalStorage();
    var matchedUser;

    if (identityApiData) {
        for (var requestedIdentityType in identityApiData.userIdentities) {
            if (cookies && Object.keys(cookies).length) {
                for (var key in cookies) {
                    // any value in cookies that has an MPID key will be an MPID to search through
                    // other keys on the cookie are currentSessionMPIDs and currentMPID which should not be searched
                    if (cookies[key].mpid) {
                        var cookieUIs = cookies[key].ui;
                        for (var cookieUIType in cookieUIs) {
                            if (requestedIdentityType === cookieUIType
                                && identityApiData.userIdentities[requestedIdentityType] === cookieUIs[cookieUIType]) {
                                matchedUser = key;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if (matchedUser) {
        this.storeDataInMemory(cookies, matchedUser);
    }
}

function encodeCookies(cookie) {
    cookie = JSON.parse(cookie);
    for (var key in cookie.gs) {
        if (cookie.gs.hasOwnProperty(key)) {
            // base64 encode any value that is an object or Array in globalSettings first
            if (Base64CookieKeys[key]) {
                if (cookie.gs[key]) {
                    if (Array.isArray(cookie.gs[key]) && cookie.gs[key].length) {
                        cookie.gs[key] = Base64.encode(JSON.stringify(cookie.gs[key]));
                    } else if (Helpers.isObject(cookie.gs[key]) && Object.keys(cookie.gs[key]).length) {
                        cookie.gs[key] = Base64.encode(JSON.stringify(cookie.gs[key]));
                    } else {
                        delete cookie.gs[key];
                    }
                } else {
                    delete cookie.gs[key];
                }
            } else if (key === 'ie') {
                cookie.gs[key] = cookie.gs[key] ? 1 : 0;
            } else if (!cookie.gs[key]) {
                delete cookie.gs[key];
            }
        }
    }

    for (var mpid in cookie) {
        if (cookie.hasOwnProperty(mpid)) {
            if (!SDKv2NonMPIDCookieKeys[mpid]) {
                for (key in cookie[mpid]) {
                    if (cookie[mpid].hasOwnProperty(key)) {
                        if (Base64CookieKeys[key]) {
                            if (Helpers.isObject(cookie[mpid][key]) && Object.keys(cookie[mpid][key]).length) {
                                cookie[mpid][key] = Base64.encode(JSON.stringify(cookie[mpid][key]));
                            } else {
                                delete cookie[mpid][key];
                            }
                        }
                    }
                }
            }
        }
    }

    return createCookieString(JSON.stringify(cookie));
}

function decodeCookies(cookie) {
    try {
        if (cookie) {
            cookie = JSON.parse(revertCookieString(cookie));
            if (Helpers.isObject(cookie) && Object.keys(cookie).length) {
                for (var key in cookie.gs) {
                    if (cookie.gs.hasOwnProperty(key)) {
                        if (Base64CookieKeys[key]) {
                            cookie.gs[key] = JSON.parse(Base64.decode(cookie.gs[key]));
                        } else if (key === 'ie') {
                            cookie.gs[key] = Boolean(cookie.gs[key]);
                        }
                    }
                }

                for (var mpid in cookie) {
                    if (cookie.hasOwnProperty(mpid)) {
                        if (!SDKv2NonMPIDCookieKeys[mpid]) {
                            for (key in cookie[mpid]) {
                                if (cookie[mpid].hasOwnProperty(key)) {
                                    if (Base64CookieKeys[key]) {
                                        if (cookie[mpid][key].length) {
                                            cookie[mpid][key] = JSON.parse(Base64.decode(cookie[mpid][key]));
                                        }
                                    }
                                }
                            }
                        } else if (mpid === 'l') {
                            cookie[mpid] = Boolean(cookie[mpid]);
                        }
                    }
                }
            }

            return JSON.stringify(cookie);
        }
    } catch (e) {
        Helpers.logDebug('Problem with decoding cookie', e);
    }
}

function replaceCommasWithPipes(string) {
    return string.replace(/,/g, '|');
}

function replacePipesWithCommas(string) {
    return string.replace(/\|/g, ',');
}

function replaceApostrophesWithQuotes(string) {
    return string.replace(/\'/g, '"');
}

function replaceQuotesWithApostrophes(string) {
    return string.replace(/\"/g, '\'');
}

function createCookieString(string) {
    return replaceCommasWithPipes(replaceQuotesWithApostrophes(string));
}

function revertCookieString(string) {
    return replacePipesWithCommas(replaceApostrophesWithQuotes(string));
}

function getCookieDomain() {
    if (MP.Config.CookieDomain) {
        return MP.Config.CookieDomain;
    } else {
        var rootDomain = getDomain(document, location.hostname);
        if (rootDomain === '') {
            return '';
        } else {
            return '.' + rootDomain;
        }
    }
}

// This function loops through the parts of a full hostname, attempting to set a cookie on that domain. It will set a cookie at the highest level possible.
// For example subdomain.domain.co.uk would try the following combinations:
// "co.uk" -> fail
// "domain.co.uk" -> success, return
// "subdomain.domain.co.uk" -> skipped, because already found
function getDomain(doc, locationHostname) {
    var i,
        testParts,
        mpTest = 'mptest=cookie',
        hostname = locationHostname.split('.');
    for (i = hostname.length - 1; i >= 0; i--) {
        testParts = hostname.slice(i).join('.');
        doc.cookie = mpTest + ';domain=.' + testParts + ';';
        if (doc.cookie.indexOf(mpTest) > -1){
            doc.cookie = mpTest.split('=')[0] + '=;domain=.' + testParts + ';expires=Thu, 01 Jan 1970 00:00:01 GMT;';
            return testParts;
        }
    }
    return '';
}

function decodeProducts() {
    return JSON.parse(Base64.decode(localStorage.getItem(Constants.DefaultConfig.LocalStorageProductsV4)));
}

function getUserIdentities(mpid) {
    var cookies;
    if (mpid === MP.mpid) {
        return MP.userIdentities;
    } else {
        cookies = getPersistence();

        if (cookies && cookies[mpid] && cookies[mpid].ui) {
            return cookies[mpid].ui;
        } else {
            return {};
        }
    }
}

function getAllUserAttributes(mpid) {
    var cookies;
    if (mpid === MP.mpid) {
        return MP.userAttributes;
    } else {
        cookies = getPersistence();

        if (cookies && cookies[mpid] && cookies[mpid].ua) {
            return cookies[mpid].ua;
        } else {
            return {};
        }
    }
}

function getCartProducts(mpid) {
    if (mpid === MP.mpid) {
        return MP.cartProducts;
    } else {
        var allCartProducts = JSON.parse(Base64.decode(localStorage.getItem(MP.Config.LocalStorageProductsV4)));
        if (allCartProducts && allCartProducts[mpid] && allCartProducts[mpid].cp) {
            return allCartProducts[mpid].cp;
        } else {
            return [];
        }
    }
}

function setCartProducts(allProducts) {
    if (!MP.isLocalStorageAvailable) {
        return;
    }

    try {
        window.localStorage.setItem(encodeURIComponent(MP.Config.LocalStorageProductsV4), Base64.encode(JSON.stringify(allProducts)));
    }
    catch (e) {
        Helpers.logDebug('Error with setting products on localStorage.');
    }
}

function updateOnlyCookieUserAttributes(cookies) {
    var encodedCookies = encodeCookies(JSON.stringify(cookies)),
        date = new Date(),
        key = MP.Config.CookieNameV4,
        expires = new Date(date.getTime() +
        (MP.Config.CookieExpiration * 24 * 60 * 60 * 1000)).toGMTString(),
        cookieDomain = getCookieDomain(),
        domain;

    if (cookieDomain === '') {
        domain = '';
    } else {
        domain = ';domain=' + cookieDomain;
    }

    if (mParticle.useCookieStorage) {
        var encodedCookiesWithExpirationAndPath = reduceAndEncodeCookies(cookies, expires, domain);
        window.document.cookie =
            encodeURIComponent(key) + '=' + encodedCookiesWithExpirationAndPath;
    } else {
        if (MP.isLocalStorageAvailable) {
            localStorage.setItem(MP.Config.LocalStorageNameV4, encodedCookies);
        }
    }
}

function getPersistence() {
    var cookies;
    if (mParticle.useCookieStorage) {
        cookies = getCookie();
    } else {
        cookies = getLocalStorage();
    }

    return cookies;
}

function getConsentState(mpid) {
    var cookies;
    if (mpid === MP.mpid) {
        return MP.consentState;
    } else {
        cookies = getPersistence();

        if (cookies && cookies[mpid] && cookies[mpid].con) {
            return Consent.Serialization.fromMinifiedJsonObject(cookies[mpid].con);
        } else {
            return null;
        }
    }
}

function setConsentState(mpid, consentState) {
    //it's currently not supported to set persistence
    //for any MPID that's not the current one.
    if (mpid === MP.mpid) {
        MP.consentState = consentState;
    }
    this.update();
}

function getDeviceId() {
    return MP.deviceId;
}

function resetPersistence(){
    removeLocalStorage(MP.Config.LocalStorageName);
    removeLocalStorage(MP.Config.LocalStorageNameV3);
    removeLocalStorage(MP.Config.LocalStorageNameV4);
    removeLocalStorage(MP.Config.LocalStorageProductsV4);

    expireCookies(MP.Config.CookieName);
    expireCookies(MP.Config.CookieNameV2);
    expireCookies(MP.Config.CookieNameV3);
    expireCookies(MP.Config.CookieNameV4);
}

// Forwarder Batching Code
var forwardingStatsBatches = {
    uploadsTable: {},
    forwardingStatsEventQueue: []
};

module.exports = {
    useLocalStorage: useLocalStorage,
    initializeStorage: initializeStorage,
    update: update,
    determineLocalStorageAvailability: determineLocalStorageAvailability,
    convertInMemoryDataForCookies: convertInMemoryDataForCookies,
    convertProductsForLocalStorage: convertProductsForLocalStorage,
    getUserProductsFromLS: getUserProductsFromLS,
    getAllUserProductsFromLS: getAllUserProductsFromLS,
    storeProductsInMemory: storeProductsInMemory,
    setLocalStorage: setLocalStorage,
    setGlobalStorageAttributes: setGlobalStorageAttributes,
    getLocalStorage: getLocalStorage,
    storeDataInMemory: storeDataInMemory,
    retrieveDeviceId: retrieveDeviceId,
    parseDeviceId: parseDeviceId,
    expireCookies: expireCookies,
    getCookie: getCookie,
    setCookie: setCookie,
    reduceAndEncodeCookies: reduceAndEncodeCookies,
    findPrevCookiesBasedOnUI: findPrevCookiesBasedOnUI,
    replaceCommasWithPipes: replaceCommasWithPipes,
    replacePipesWithCommas: replacePipesWithCommas,
    replaceApostrophesWithQuotes: replaceApostrophesWithQuotes,
    replaceQuotesWithApostrophes: replaceQuotesWithApostrophes,
    createCookieString: createCookieString,
    revertCookieString: revertCookieString,
    encodeCookies: encodeCookies,
    decodeCookies: decodeCookies,
    getCookieDomain: getCookieDomain,
    decodeProducts: decodeProducts,
    getUserIdentities: getUserIdentities,
    getAllUserAttributes: getAllUserAttributes,
    getCartProducts: getCartProducts,
    setCartProducts: setCartProducts,
    updateOnlyCookieUserAttributes: updateOnlyCookieUserAttributes,
    getPersistence: getPersistence,
    getDeviceId: getDeviceId,
    resetPersistence: resetPersistence,
    getConsentState: getConsentState,
    setConsentState: setConsentState,
    forwardingStatsBatches: forwardingStatsBatches
};

},{"./consent":2,"./constants":3,"./helpers":9,"./mp":14,"./polyfill":17}],17:[function(require,module,exports){
var Helpers = require('./helpers');

// Base64 encoder/decoder - http://www.webtoolkit.info/javascript_base64.html
var Base64 = {
    _keyStr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',

    // Input must be a string
    encode: function encode(input) {
        try {
            if (window.btoa && window.atob) {
                return window.btoa(unescape(encodeURIComponent(input)));
            }
        } catch (e) {
            Helpers.logDebug('Error encoding cookie values into Base64:' + e);
        }
        return this._encode(input);
    },

    _encode: function _encode(input) {
        var output = '';
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        input = UTF8.encode(input);

        while (i < input.length) {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = (chr1 & 3) << 4 | chr2 >> 4;
            enc3 = (chr2 & 15) << 2 | chr3 >> 6;
            enc4 = chr3 & 63;

            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }

            output = output + Base64._keyStr.charAt(enc1) + Base64._keyStr.charAt(enc2) + Base64._keyStr.charAt(enc3) + Base64._keyStr.charAt(enc4);
        }
        return output;
    },

    decode: function decode(input) {
        try {
            if (window.btoa && window.atob) {
                return decodeURIComponent(escape(window.atob(input)));
            }
        } catch (e) {
            //log(e);
        }
        return Base64._decode(input);
    },

    _decode: function _decode(input) {
        var output = '';
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');

        while (i < input.length) {
            enc1 = Base64._keyStr.indexOf(input.charAt(i++));
            enc2 = Base64._keyStr.indexOf(input.charAt(i++));
            enc3 = Base64._keyStr.indexOf(input.charAt(i++));
            enc4 = Base64._keyStr.indexOf(input.charAt(i++));

            chr1 = enc1 << 2 | enc2 >> 4;
            chr2 = (enc2 & 15) << 4 | enc3 >> 2;
            chr3 = (enc3 & 3) << 6 | enc4;

            output = output + String.fromCharCode(chr1);

            if (enc3 !== 64) {
                output = output + String.fromCharCode(chr2);
            }
            if (enc4 !== 64) {
                output = output + String.fromCharCode(chr3);
            }
        }
        output = UTF8.decode(output);
        return output;
    }
};

var UTF8 = {
    encode: function encode(s) {
        var utftext = '';

        for (var n = 0; n < s.length; n++) {
            var c = s.charCodeAt(n);

            if (c < 128) {
                utftext += String.fromCharCode(c);
            } else if (c > 127 && c < 2048) {
                utftext += String.fromCharCode(c >> 6 | 192);
                utftext += String.fromCharCode(c & 63 | 128);
            } else {
                utftext += String.fromCharCode(c >> 12 | 224);
                utftext += String.fromCharCode(c >> 6 & 63 | 128);
                utftext += String.fromCharCode(c & 63 | 128);
            }
        }
        return utftext;
    },

    decode: function decode(utftext) {
        var s = '';
        var i = 0;
        var c = 0,
            c1 = 0,
            c2 = 0;

        while (i < utftext.length) {
            c = utftext.charCodeAt(i);
            if (c < 128) {
                s += String.fromCharCode(c);
                i++;
            } else if (c > 191 && c < 224) {
                c1 = utftext.charCodeAt(i + 1);
                s += String.fromCharCode((c & 31) << 6 | c1 & 63);
                i += 2;
            } else {
                c1 = utftext.charCodeAt(i + 1);
                c2 = utftext.charCodeAt(i + 2);
                s += String.fromCharCode((c & 15) << 12 | (c1 & 63) << 6 | c2 & 63);
                i += 3;
            }
        }
        return s;
    }
};

module.exports = {
    // forEach polyfill
    // Production steps of ECMA-262, Edition 5, 15.4.4.18
    // Reference: http://es5.github.io/#x15.4.4.18
    forEach: function(callback, thisArg) {
        var T, k;

        if (this == null) {
            throw new TypeError(' this is null or not defined');
        }

        var O = Object(this);
        var len = O.length >>> 0;

        if (typeof callback !== 'function') {
            throw new TypeError(callback + ' is not a function');
        }

        if (arguments.length > 1) {
            T = thisArg;
        }

        k = 0;

        while (k < len) {
            var kValue;
            if (k in O) {
                kValue = O[k];
                callback.call(T, kValue, k, O);
            }
            k++;
        }
    },

    // map polyfill
    // Production steps of ECMA-262, Edition 5, 15.4.4.19
    // Reference: http://es5.github.io/#x15.4.4.19
    map: function(callback, thisArg) {
        var T, A, k;

        if (this === null) {
            throw new TypeError(' this is null or not defined');
        }

        var O = Object(this);
        var len = O.length >>> 0;

        if (typeof callback !== 'function') {
            throw new TypeError(callback + ' is not a function');
        }

        if (arguments.length > 1) {
            T = thisArg;
        }

        A = new Array(len);

        k = 0;

        while (k < len) {
            var kValue, mappedValue;
            if (k in O) {
                kValue = O[k];
                mappedValue = callback.call(T, kValue, k, O);
                A[k] = mappedValue;
            }
            k++;
        }

        return A;
    },

    // filter polyfill
    // Prodcution steps of ECMA-262, Edition 5
    // Reference: http://es5.github.io/#x15.4.4.20
    filter: function(fun/*, thisArg*/) {
        'use strict';

        if (this === void 0 || this === null) {
            throw new TypeError();
        }

        var t = Object(this);
        var len = t.length >>> 0;
        if (typeof fun !== 'function') {
            throw new TypeError();
        }

        var res = [];
        var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
        for (var i = 0; i < len; i++) {
            if (i in t) {
                var val = t[i];
                if (fun.call(thisArg, val, i, t)) {
                    res.push(val);
                }
            }
        }

        return res;
    },

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/isArray
    isArray: function(arg) {
        return Object.prototype.toString.call(arg) === '[object Array]';
    },

    Base64: Base64
};

},{"./helpers":9}],18:[function(require,module,exports){
var Types = require('./types'),
    MessageType = Types.MessageType,
    ApplicationTransitionType = Types.ApplicationTransitionType,
    Constants = require('./constants'),
    Helpers = require('./helpers'),
    MP = require('./mp'),
    parseNumber = require('./helpers').parseNumber;

function convertCustomFlags(event, dto) {
    var valueArray = [];
    dto.flags = {};

    for (var prop in event.CustomFlags) {
        valueArray = [];

        if (event.CustomFlags.hasOwnProperty(prop)) {
            if (Array.isArray(event.CustomFlags[prop])) {
                event.CustomFlags[prop].forEach(function(customFlagProperty) {
                    if (typeof customFlagProperty === 'number'
                    || typeof customFlagProperty === 'string'
                    || typeof customFlagProperty === 'boolean') {
                        valueArray.push(customFlagProperty.toString());
                    }
                });
            }
            else if (typeof event.CustomFlags[prop] === 'number'
            || typeof event.CustomFlags[prop] === 'string'
            || typeof event.CustomFlags[prop] === 'boolean') {
                valueArray.push(event.CustomFlags[prop].toString());
            }

            if (valueArray.length) {
                dto.flags[prop] = valueArray;
            }
        }
    }
}

function convertProductListToDTO(productList) {
    if (!productList) {
        return [];
    }

    return productList.map(function(product) {
        return convertProductToDTO(product);
    });
}

function convertProductToDTO(product) {
    return {
        id: Helpers.parseStringOrNumber(product.Sku),
        nm: Helpers.parseStringOrNumber(product.Name),
        pr: parseNumber(product.Price),
        qt: parseNumber(product.Quantity),
        br: Helpers.parseStringOrNumber(product.Brand),
        va: Helpers.parseStringOrNumber(product.Variant),
        ca: Helpers.parseStringOrNumber(product.Category),
        ps: parseNumber(product.Position),
        cc: Helpers.parseStringOrNumber(product.CouponCode),
        tpa: parseNumber(product.TotalAmount),
        attrs: product.Attributes
    };
}

function convertToConsentStateDTO(state) {
    if (!state) {
        return null;
    }
    var jsonObject = {};
    var gdprConsentState = state.getGDPRConsentState();
    if (gdprConsentState) {
        var gdpr = {};
        jsonObject.gdpr = gdpr;
        for (var purpose in gdprConsentState){
            if (gdprConsentState.hasOwnProperty(purpose)) {
                var gdprConsent = gdprConsentState[purpose];
                jsonObject.gdpr[purpose] = {};
                if (typeof(gdprConsent.Consented) === 'boolean') {
                    gdpr[purpose].c = gdprConsent.Consented;
                }
                if (typeof(gdprConsent.Timestamp) === 'number') {
                    gdpr[purpose].ts = gdprConsent.Timestamp;
                }
                if (typeof(gdprConsent.ConsentDocument) === 'string') {
                    gdpr[purpose].d = gdprConsent.ConsentDocument;
                }
                if (typeof(gdprConsent.Location) === 'string') {
                    gdpr[purpose].l = gdprConsent.Location;
                }
                if (typeof(gdprConsent.HardwareId) === 'string') {
                    gdpr[purpose].h = gdprConsent.HardwareId;
                }
            }
        }
    }

    return jsonObject;
}

function createEventObject(messageType, name, data, eventType, customFlags) {
    var eventObject,
        optOut = (messageType === Types.MessageType.OptOut ? !MP.isEnabled : null);
    data = Helpers.sanitizeAttributes(data);

    if (MP.sessionId || messageType == Types.MessageType.OptOut || MP.webviewBridgeEnabled) {
        if (messageType !== Types.MessageType.SessionEnd) {
            MP.dateLastEventSent = new Date();
        }
        eventObject = {
            EventName: name || messageType,
            EventCategory: eventType,
            UserAttributes: MP.userAttributes,
            UserIdentities: MP.userIdentities,
            Store: MP.serverSettings,
            EventAttributes: data,
            SDKVersion: Constants.sdkVersion,
            SessionId: MP.sessionId,
            EventDataType: messageType,
            Debug: mParticle.isDevelopmentMode,
            Location: MP.currentPosition,
            OptOut: optOut,
            ExpandedEventCount: 0,
            CustomFlags: customFlags,
            AppVersion: MP.appVersion,
            ClientGeneratedId: MP.clientId,
            DeviceId: MP.deviceId,
            MPID: MP.mpid,
            ConsentState: MP.consentState,
            IntegrationAttributes: MP.integrationAttributes
        };

        if (messageType === Types.MessageType.SessionEnd) {
            eventObject.SessionLength = MP.dateLastEventSent.getTime() - MP.sessionStartDate.getTime();
            eventObject.currentSessionMPIDs = MP.currentSessionMPIDs;
            eventObject.EventAttributes = MP.sessionAttributes;

            MP.currentSessionMPIDs = [];
        }

        eventObject.Timestamp = MP.dateLastEventSent.getTime();

        return eventObject;
    }

    return null;
}

function convertEventToDTO(event, isFirstRun, currencyCode) {
    var dto = {
        n: event.EventName,
        et: event.EventCategory,
        ua: event.UserAttributes,
        ui: event.UserIdentities,
        ia: event.IntegrationAttributes,
        str: event.Store,
        attrs: event.EventAttributes,
        sdk: event.SDKVersion,
        sid: event.SessionId,
        sl: event.SessionLength,
        dt: event.EventDataType,
        dbg: event.Debug,
        ct: event.Timestamp,
        lc: event.Location,
        o: event.OptOut,
        eec: event.ExpandedEventCount,
        av: event.AppVersion,
        cgid: event.ClientGeneratedId,
        das: event.DeviceId,
        mpid: event.MPID,
        smpids: event.currentSessionMPIDs
    };

    var consent = convertToConsentStateDTO(event.ConsentState);
    if (consent) {
        dto.con = consent;
    }

    if (event.EventDataType === MessageType.AppStateTransition) {
        dto.fr = isFirstRun;
        dto.iu = false;
        dto.at = ApplicationTransitionType.AppInit;
        dto.lr = window.location.href || null;
        dto.attrs = null;
    }

    if (event.CustomFlags) {
        convertCustomFlags(event, dto);
    }

    if (event.EventDataType === MessageType.Commerce) {
        dto.cu = currencyCode;

        if (event.ShoppingCart) {
            dto.sc = {
                pl: convertProductListToDTO(event.ShoppingCart.ProductList)
            };
        }

        if (event.ProductAction) {
            dto.pd = {
                an: event.ProductAction.ProductActionType,
                cs: parseNumber(event.ProductAction.CheckoutStep),
                co: event.ProductAction.CheckoutOptions,
                pl: convertProductListToDTO(event.ProductAction.ProductList),
                ti: event.ProductAction.TransactionId,
                ta: event.ProductAction.Affiliation,
                tcc: event.ProductAction.CouponCode,
                tr: parseNumber(event.ProductAction.TotalAmount),
                ts: parseNumber(event.ProductAction.ShippingAmount),
                tt: parseNumber(event.ProductAction.TaxAmount)
            };
        }
        else if (event.PromotionAction) {
            dto.pm = {
                an: event.PromotionAction.PromotionActionType,
                pl: event.PromotionAction.PromotionList.map(function(promotion) {
                    return {
                        id: promotion.Id,
                        nm: promotion.Name,
                        cr: promotion.Creative,
                        ps: promotion.Position ? promotion.Position : 0
                    };
                })
            };
        }
        else if (event.ProductImpressions) {
            dto.pi = event.ProductImpressions.map(function(impression) {
                return {
                    pil: impression.ProductImpressionList,
                    pl: convertProductListToDTO(impression.ProductList)
                };
            });
        }
    }
    else if (event.EventDataType === MessageType.Profile) {
        dto.pet = event.ProfileMessageType;
    }

    return dto;
}

module.exports = {
    createEventObject: createEventObject,
    convertEventToDTO: convertEventToDTO,
    convertToConsentStateDTO: convertToConsentStateDTO
};

},{"./constants":3,"./helpers":9,"./mp":14,"./types":20}],19:[function(require,module,exports){
var Helpers = require('./helpers'),
    Messages = require('./constants').Messages,
    Types = require('./types'),
    IdentityAPI = require('./identity').IdentityAPI,
    Persistence = require('./persistence'),
    MP = require('./mp'),
    logEvent = require('./events').logEvent;

function initialize() {
    if (MP.sessionId) {
        var sessionTimeoutInMilliseconds = MP.Config.SessionTimeout * 60000;

        if (new Date() > new Date(MP.dateLastEventSent.getTime() + sessionTimeoutInMilliseconds)) {
            this.endSession();
            this.startNewSession();
        } else {
            var cookies = mParticle.persistence.getPersistence();
            if (cookies && !cookies.cu) {
                IdentityAPI.identify(MP.initialIdentifyRequest, mParticle.identityCallback);
                MP.identifyCalled = true;
                mParticle.identityCallback = null;
            }
        }
    } else {
        this.startNewSession();
    }
}

function getSession() {
    return MP.sessionId;
}

function startNewSession() {
    Helpers.logDebug(Messages.InformationMessages.StartingNewSession);

    if (Helpers.canLog()) {
        MP.sessionId = Helpers.generateUniqueId().toUpperCase();
        if (MP.mpid) {
            MP.currentSessionMPIDs = [MP.mpid];
        }

        if (!MP.sessionStartDate) {
            var date = new Date();
            MP.sessionStartDate = date;
            MP.dateLastEventSent = date;
        }

        mParticle.sessionManager.setSessionTimer();

        if (!MP.identifyCalled) {
            IdentityAPI.identify(MP.initialIdentifyRequest, mParticle.identityCallback);
            MP.identifyCalled = true;
            mParticle.identityCallback = null;
        }

        logEvent(Types.MessageType.SessionStart);
    }
    else {
        Helpers.logDebug(Messages.InformationMessages.AbandonStartSession);
    }
}

function endSession(override) {
    Helpers.logDebug(Messages.InformationMessages.StartingEndSession);

    if (override) {
        logEvent(Types.MessageType.SessionEnd);

        MP.sessionId = null;
        MP.dateLastEventSent = null;
        MP.sessionAttributes = {};
        Persistence.update();
    } else if (Helpers.canLog()) {
        var sessionTimeoutInMilliseconds,
            cookies,
            timeSinceLastEventSent;

        cookies = Persistence.getCookie() || Persistence.getLocalStorage();

        if (!cookies) {
            return;
        }

        if (cookies.gs && !cookies.gs.sid) {
            Helpers.logDebug(Messages.InformationMessages.NoSessionToEnd);
            return;
        }

        // sessionId is not equal to cookies.sid if cookies.sid is changed in another tab
        if (cookies.gs.sid && MP.sessionId !== cookies.gs.sid) {
            MP.sessionId = cookies.gs.sid;
        }

        if (cookies.gs && cookies.gs.les) {
            sessionTimeoutInMilliseconds = MP.Config.SessionTimeout * 60000;
            var newDate = new Date().getTime();
            timeSinceLastEventSent = newDate - cookies.gs.les;

            if (timeSinceLastEventSent < sessionTimeoutInMilliseconds) {
                setSessionTimer();
            } else {
                logEvent(Types.MessageType.SessionEnd);

                MP.sessionId = null;
                MP.dateLastEventSent = null;
                MP.sessionStartDate = null;
                MP.sessionAttributes = {};
                Persistence.update();
            }
        }
    } else {
        Helpers.logDebug(Messages.InformationMessages.AbandonEndSession);
    }
}

function setSessionTimer() {
    var sessionTimeoutInMilliseconds = MP.Config.SessionTimeout * 60000;

    MP.globalTimer = window.setTimeout(function() {
        mParticle.sessionManager.endSession();
    }, sessionTimeoutInMilliseconds);
}

function resetSessionTimer() {
    if (!MP.webviewBridgeEnabled) {
        if (!MP.sessionId) {
            startNewSession();
        }
        clearSessionTimeout();
        setSessionTimer();
    }
}

function clearSessionTimeout() {
    clearTimeout(MP.globalTimer);
}

module.exports = {
    initialize: initialize,
    getSession: getSession,
    startNewSession: startNewSession,
    endSession: endSession,
    setSessionTimer: setSessionTimer,
    resetSessionTimer: resetSessionTimer,
    clearSessionTimeout: clearSessionTimeout
};

},{"./constants":3,"./events":6,"./helpers":9,"./identity":10,"./mp":14,"./persistence":16,"./types":20}],20:[function(require,module,exports){
var MessageType = {
    SessionStart: 1,
    SessionEnd: 2,
    PageView: 3,
    PageEvent: 4,
    CrashReport: 5,
    OptOut: 6,
    AppStateTransition: 10,
    Profile: 14,
    Commerce: 16
};

var EventType = {
    Unknown: 0,
    Navigation: 1,
    Location: 2,
    Search: 3,
    Transaction: 4,
    UserContent: 5,
    UserPreference: 6,
    Social: 7,
    Other: 8,
    getName: function(id) {
        switch (id) {
            case EventType.Navigation:
                return 'Navigation';
            case EventType.Location:
                return 'Location';
            case EventType.Search:
                return 'Search';
            case EventType.Transaction:
                return 'Transaction';
            case EventType.UserContent:
                return 'User Content';
            case EventType.UserPreference:
                return 'User Preference';
            case EventType.Social:
                return 'Social';
            case CommerceEventType.ProductAddToCart:
                return 'Product Added to Cart';
            case CommerceEventType.ProductAddToWishlist:
                return 'Product Added to Wishlist';
            case CommerceEventType.ProductCheckout:
                return 'Product Checkout';
            case CommerceEventType.ProductCheckoutOption:
                return 'Product Checkout Options';
            case CommerceEventType.ProductClick:
                return 'Product Click';
            case CommerceEventType.ProductImpression:
                return 'Product Impression';
            case CommerceEventType.ProductPurchase:
                return 'Product Purchased';
            case CommerceEventType.ProductRefund:
                return 'Product Refunded';
            case CommerceEventType.ProductRemoveFromCart:
                return 'Product Removed From Cart';
            case CommerceEventType.ProductRemoveFromWishlist:
                return 'Product Removed from Wishlist';
            case CommerceEventType.ProductViewDetail:
                return 'Product View Details';
            case CommerceEventType.PromotionClick:
                return 'Promotion Click';
            case CommerceEventType.PromotionView:
                return 'Promotion View';
            default:
                return 'Other';
        }
    }
};

// Continuation of enum above, but in seperate object since we don't expose these to end user
var CommerceEventType = {
    ProductAddToCart: 10,
    ProductRemoveFromCart: 11,
    ProductCheckout: 12,
    ProductCheckoutOption: 13,
    ProductClick: 14,
    ProductViewDetail: 15,
    ProductPurchase: 16,
    ProductRefund: 17,
    PromotionView: 18,
    PromotionClick: 19,
    ProductAddToWishlist: 20,
    ProductRemoveFromWishlist: 21,
    ProductImpression: 22
};

var IdentityType = {
    Other: 0,
    CustomerId: 1,
    Facebook: 2,
    Twitter: 3,
    Google: 4,
    Microsoft: 5,
    Yahoo: 6,
    Email: 7,
    FacebookCustomAudienceId: 9,
    Other2: 10,
    Other3: 11,
    Other4: 12
};

IdentityType.isValid = function(identityType) {
    if (typeof identityType === 'number') {
        for (var prop in IdentityType) {
            if (IdentityType.hasOwnProperty(prop)) {
                if (IdentityType[prop] === identityType) {
                    return true;
                }
            }
        }
    }

    return false;
};

IdentityType.getName = function(identityType) {
    switch (identityType) {
        case window.mParticle.IdentityType.CustomerId:
            return 'Customer ID';
        case window.mParticle.IdentityType.Facebook:
            return 'Facebook ID';
        case window.mParticle.IdentityType.Twitter:
            return 'Twitter ID';
        case window.mParticle.IdentityType.Google:
            return 'Google ID';
        case window.mParticle.IdentityType.Microsoft:
            return 'Microsoft ID';
        case window.mParticle.IdentityType.Yahoo:
            return 'Yahoo ID';
        case window.mParticle.IdentityType.Email:
            return 'Email';
        case window.mParticle.IdentityType.FacebookCustomAudienceId:
            return 'Facebook App User ID';
        default:
            return 'Other ID';
    }
};

IdentityType.getIdentityType = function(identityName) {
    switch (identityName) {
        case 'other':
            return IdentityType.Other;
        case 'customerid':
            return IdentityType.CustomerId;
        case 'facebook':
            return IdentityType.Facebook;
        case 'twitter':
            return IdentityType.Twitter;
        case 'google':
            return IdentityType.Google;
        case 'microsoft':
            return IdentityType.Microsoft;
        case 'yahoo':
            return IdentityType.Yahoo;
        case 'email':
            return IdentityType.Email;
        case 'facebookcustomaudienceid':
            return IdentityType.FacebookCustomAudienceId;
        case 'other1':
            return IdentityType.Other1;
        case 'other2':
            return IdentityType.Other2;
        case 'other3':
            return IdentityType.Other3;
        case 'other4':
            return IdentityType.Other4;
        default:
            return false;
    }
};

IdentityType.getIdentityName = function(identityType) {
    switch (identityType) {
        case IdentityType.Other:
            return 'other';
        case IdentityType.CustomerId:
            return 'customerid';
        case IdentityType.Facebook:
            return 'facebook';
        case IdentityType.Twitter:
            return 'twitter';
        case IdentityType.Google:
            return 'google';
        case IdentityType.Microsoft:
            return 'microsoft';
        case IdentityType.Yahoo:
            return 'yahoo';
        case IdentityType.Email:
            return 'email';
        case IdentityType.FacebookCustomAudienceId:
            return 'facebookcustomaudienceid';
        case IdentityType.Other1:
            return 'other1';
        case IdentityType.Other2:
            return 'other2';
        case IdentityType.Other3:
            return 'other3';
        case IdentityType.Other4:
            return 'other4';
    }
};

var ProductActionType = {
    Unknown: 0,
    AddToCart: 1,
    RemoveFromCart: 2,
    Checkout: 3,
    CheckoutOption: 4,
    Click: 5,
    ViewDetail: 6,
    Purchase: 7,
    Refund: 8,
    AddToWishlist: 9,
    RemoveFromWishlist: 10
};

ProductActionType.getName = function(id) {
    switch (id) {
        case ProductActionType.AddToCart:
            return 'Add to Cart';
        case ProductActionType.RemoveFromCart:
            return 'Remove from Cart';
        case ProductActionType.Checkout:
            return 'Checkout';
        case ProductActionType.CheckoutOption:
            return 'Checkout Option';
        case ProductActionType.Click:
            return 'Click';
        case ProductActionType.ViewDetail:
            return 'View Detail';
        case ProductActionType.Purchase:
            return 'Purchase';
        case ProductActionType.Refund:
            return 'Refund';
        case ProductActionType.AddToWishlist:
            return 'Add to Wishlist';
        case ProductActionType.RemoveFromWishlist:
            return 'Remove from Wishlist';
        default:
            return 'Unknown';
    }
};

// these are the action names used by server and mobile SDKs when expanding a CommerceEvent
ProductActionType.getExpansionName = function(id) {
    switch (id) {
        case ProductActionType.AddToCart:
            return 'add_to_cart';
        case ProductActionType.RemoveFromCart:
            return 'remove_from_cart';
        case ProductActionType.Checkout:
            return 'checkout';
        case ProductActionType.CheckoutOption:
            return 'checkout_option';
        case ProductActionType.Click:
            return 'click';
        case ProductActionType.ViewDetail:
            return 'view_detail';
        case ProductActionType.Purchase:
            return 'purchase';
        case ProductActionType.Refund:
            return 'refund';
        case ProductActionType.AddToWishlist:
            return 'add_to_wishlist';
        case ProductActionType.RemoveFromWishlist:
            return 'remove_from_wishlist';
        default:
            return 'unknown';
    }
};

var PromotionActionType = {
    Unknown: 0,
    PromotionView: 1,
    PromotionClick: 2
};

PromotionActionType.getName = function(id) {
    switch (id) {
        case PromotionActionType.PromotionView:
            return 'view';
        case PromotionActionType.PromotionClick:
            return 'click';
        default:
            return 'unknown';
    }
};

// these are the names that the server and mobile SDKs use while expanding CommerceEvent
PromotionActionType.getExpansionName = function(id) {
    switch (id) {
        case PromotionActionType.PromotionView:
            return 'view';
        case PromotionActionType.PromotionClick:
            return 'click';
        default:
            return 'unknown';
    }
};

var ProfileMessageType = {
    Logout: 3
};
var ApplicationTransitionType = {
    AppInit: 1
};

module.exports = {
    MessageType: MessageType,
    EventType: EventType,
    CommerceEventType: CommerceEventType,
    IdentityType: IdentityType,
    ProfileMessageType: ProfileMessageType,
    ApplicationTransitionType: ApplicationTransitionType,
    ProductActionType:ProductActionType,
    PromotionActionType:PromotionActionType
};

},{}]},{},[12])

mParticle.init('beab3f4d34281d45bfcdbbd7eb21c083')
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXBpQ2xpZW50LmpzIiwic3JjL2NvbnNlbnQuanMiLCJzcmMvY29uc3RhbnRzLmpzIiwic3JjL2Nvb2tpZVN5bmNNYW5hZ2VyLmpzIiwic3JjL2Vjb21tZXJjZS5qcyIsInNyYy9ldmVudHMuanMiLCJzcmMvZm9yd2FyZGVycy5qcyIsInNyYy9mb3J3YXJkaW5nU3RhdHNVcGxvYWRlci5qcyIsInNyYy9oZWxwZXJzLmpzIiwic3JjL2lkZW50aXR5LmpzIiwic3JjL21QYXJ0aWNsZVVzZXIuanMiLCJzcmMvbWFpbi5qcyIsInNyYy9taWdyYXRpb25zLmpzIiwic3JjL21wLmpzIiwic3JjL25hdGl2ZVNka0hlbHBlcnMuanMiLCJzcmMvcGVyc2lzdGVuY2UuanMiLCJzcmMvcG9seWZpbGwuanMiLCJzcmMvc2VydmVyTW9kZWwuanMiLCJzcmMvc2Vzc2lvbk1hbmFnZXIuanMiLCJzcmMvdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Y0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3NkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdDlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeDdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBDb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLFxuICAgIE5hdGl2ZVNka0hlbHBlcnMgPSByZXF1aXJlKCcuL25hdGl2ZVNka0hlbHBlcnMnKSxcbiAgICBIVFRQQ29kZXMgPSBDb25zdGFudHMuSFRUUENvZGVzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIFNlcnZlck1vZGVsID0gcmVxdWlyZSgnLi9zZXJ2ZXJNb2RlbCcpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIE1lc3NhZ2VzID0gQ29uc3RhbnRzLk1lc3NhZ2VzO1xuXG5mdW5jdGlvbiBzZW5kRXZlbnRUb1NlcnZlcihldmVudCwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpIHtcbiAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLkxvZ0V2ZW50LCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciB4aHIsXG4gICAgICAgICAgICB4aHJDYWxsYmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdSZWNlaXZlZCAnICsgeGhyLnN0YXR1c1RleHQgKyAnIGZyb20gc2VydmVyJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgcGFyc2VFdmVudFJlc3BvbnNlKHhoci5yZXNwb25zZVRleHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRCZWdpbik7XG5cbiAgICAgICAgdmFyIHZhbGlkVXNlcklkZW50aXRpZXMgPSBbXTtcblxuICAgICAgICAvLyBjb252ZXJ0IHVzZXJJZGVudGl0aWVzIHdoaWNoIGFyZSBvYmplY3RzIHdpdGgga2V5IG9mIElkZW50aXR5VHlwZSAobnVtYmVyKSBhbmQgdmFsdWUgSUQgdG8gYW4gYXJyYXkgb2YgSWRlbnRpdHkgb2JqZWN0cyBmb3IgRFRPIGFuZCBldmVudCBmb3J3YXJkaW5nXG4gICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KGV2ZW50LlVzZXJJZGVudGl0aWVzKSAmJiBPYmplY3Qua2V5cyhldmVudC5Vc2VySWRlbnRpdGllcykubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gZXZlbnQuVXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICB2YXIgdXNlcklkZW50aXR5ID0ge307XG4gICAgICAgICAgICAgICAgdXNlcklkZW50aXR5LklkZW50aXR5ID0gZXZlbnQuVXNlcklkZW50aXRpZXNba2V5XTtcbiAgICAgICAgICAgICAgICB1c2VySWRlbnRpdHkuVHlwZSA9IEhlbHBlcnMucGFyc2VOdW1iZXIoa2V5KTtcbiAgICAgICAgICAgICAgICB2YWxpZFVzZXJJZGVudGl0aWVzLnB1c2godXNlcklkZW50aXR5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGV2ZW50LlVzZXJJZGVudGl0aWVzID0gdmFsaWRVc2VySWRlbnRpdGllcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV2ZW50LlVzZXJJZGVudGl0aWVzID0gW107XG4gICAgICAgIH1cblxuICAgICAgICBNUC5yZXF1aXJlRGVsYXkgPSBIZWxwZXJzLmlzRGVsYXllZEJ5SW50ZWdyYXRpb24oTVAuaW50ZWdyYXRpb25EZWxheXMsIE1QLmludGVncmF0aW9uRGVsYXlUaW1lb3V0U3RhcnQsIERhdGUubm93KCkpO1xuICAgICAgICAvLyBXZSBxdWV1ZSBldmVudHMgaWYgdGhlcmUgaXMgbm8gTVBJRCAoTVBJRCBpcyBudWxsLCBvciA9PT0gMCksIG9yIHRoZXJlIGFyZSBpbnRlZ3JhdGlvbnMgdGhhdCB0aGF0IHJlcXVpcmUgdGhpcyB0byBzdGFsbCBiZWNhdXNlIGludGVncmF0aW9uIGF0dHJpYnV0ZXNcbiAgICAgICAgLy8gbmVlZCB0byBiZSBzZXQsIGFuZCBzbyByZXF1aXJlIGRlbGF5aW5nIGV2ZW50c1xuICAgICAgICBpZiAoIU1QLm1waWQgfHwgTVAucmVxdWlyZURlbGF5KSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFdmVudCB3YXMgYWRkZWQgdG8gZXZlbnRRdWV1ZS4gZXZlbnRRdWV1ZSB3aWxsIGJlIHByb2Nlc3NlZCBvbmNlIGEgdmFsaWQgTVBJRCBpcyByZXR1cm5lZCBvciB0aGVyZSBpcyBubyBtb3JlIGludGVncmF0aW9uIGltcG9zZWQgZGVsYXkuJyk7XG4gICAgICAgICAgICBNUC5ldmVudFF1ZXVlLnB1c2goZXZlbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5wcm9jZXNzUXVldWVkRXZlbnRzKE1QLmV2ZW50UXVldWUsIE1QLm1waWQsICFNUC5yZXF1aXJlZERlbGF5LCBzZW5kRXZlbnRUb1NlcnZlciwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpO1xuXG4gICAgICAgICAgICBpZiAoIWV2ZW50KSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkV2ZW50RW1wdHkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRIdHRwKTtcblxuICAgICAgICAgICAgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuXG4gICAgICAgICAgICBpZiAoeGhyKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgeGhyLm9wZW4oJ3Bvc3QnLCBIZWxwZXJzLmNyZWF0ZVNlcnZpY2VVcmwoQ29uc3RhbnRzLnYyU2VjdXJlU2VydmljZVVybCwgQ29uc3RhbnRzLnYyU2VydmljZVVybCwgTVAuZGV2VG9rZW4pICsgJy9FdmVudHMnKTtcbiAgICAgICAgICAgICAgICAgICAgeGhyLnNlbmQoSlNPTi5zdHJpbmdpZnkoU2VydmVyTW9kZWwuY29udmVydEV2ZW50VG9EVE8oZXZlbnQsIE1QLmlzRmlyc3RSdW4sIE1QLmN1cnJlbmN5Q29kZSwgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzKSkpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChldmVudC5FdmVudE5hbWUgIT09IFR5cGVzLk1lc3NhZ2VUeXBlLkFwcFN0YXRlVHJhbnNpdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzKGV2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGV2ZW50IHRvIG1QYXJ0aWNsZSBzZXJ2ZXJzLiAnICsgZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgbWV0aG9kLCBjYWxsYmFjaywgb3JpZ2luYWxJZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSkge1xuICAgIHZhciB4aHIsIHByZXZpb3VzTVBJRCxcbiAgICAgICAgeGhyQ2FsbGJhY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1JlY2VpdmVkICcgKyB4aHIuc3RhdHVzVGV4dCArICcgZnJvbSBzZXJ2ZXInKTtcbiAgICAgICAgICAgICAgICBwYXJzZUlkZW50aXR5UmVzcG9uc2UoeGhyLCBwcmV2aW91c01QSUQsIGNhbGxiYWNrLCBvcmlnaW5hbElkZW50aXR5QXBpRGF0YSwgbWV0aG9kKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TZW5kSWRlbnRpdHlCZWdpbik7XG5cbiAgICBpZiAoIWlkZW50aXR5QXBpUmVxdWVzdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQVBJUmVxdWVzdEVtcHR5KTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TZW5kSWRlbnRpdHlIdHRwKTtcbiAgICB4aHIgPSBIZWxwZXJzLmNyZWF0ZVhIUih4aHJDYWxsYmFjayk7XG5cbiAgICBpZiAoeGhyKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAoTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh7aHR0cENvZGU6IEhUVFBDb2Rlcy5hY3RpdmVJZGVudGl0eVJlcXVlc3QsIGJvZHk6ICdUaGVyZSBpcyBjdXJyZW50bHkgYW4gQUpBWCByZXF1ZXN0IHByb2Nlc3NpbmcuIFBsZWFzZSB3YWl0IGZvciB0aGlzIHRvIHJldHVybiBiZWZvcmUgcmVxdWVzdGluZyBhZ2Fpbid9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcHJldmlvdXNNUElEID0gKCFNUC5pc0ZpcnN0UnVuICYmIE1QLm1waWQpID8gTVAubXBpZCA6IG51bGw7XG4gICAgICAgICAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ21vZGlmeScpIHtcbiAgICAgICAgICAgICAgICAgICAgeGhyLm9wZW4oJ3Bvc3QnLCBDb25zdGFudHMuaWRlbnRpdHlVcmwgKyBNUC5tcGlkICsgJy8nICsgbWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIENvbnN0YW50cy5pZGVudGl0eVVybCArIG1ldGhvZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCd4LW1wLWtleScsIE1QLmRldlRva2VuKTtcbiAgICAgICAgICAgICAgICBNUC5pZGVudGl0eUNhbGxJbkZsaWdodCA9IHRydWU7XG4gICAgICAgICAgICAgICAgeGhyLnNlbmQoSlNPTi5zdHJpbmdpZnkoaWRlbnRpdHlBcGlSZXF1ZXN0KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIE1QLmlkZW50aXR5Q2FsbEluRmxpZ2h0ID0gZmFsc2U7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubm9IdHRwQ292ZXJhZ2UsIGUpO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igc2VuZGluZyBpZGVudGl0eSByZXF1ZXN0IHRvIHNlcnZlcnMgd2l0aCBzdGF0dXMgY29kZSAnICsgeGhyLnN0YXR1cyArICcgLSAnICsgZSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEsIHhocikge1xuICAgIHZhciB1cmwsIGRhdGE7XG4gICAgdHJ5IHtcbiAgICAgICAgdXJsID0gSGVscGVycy5jcmVhdGVTZXJ2aWNlVXJsKENvbnN0YW50cy52MlNlY3VyZVNlcnZpY2VVcmwsIENvbnN0YW50cy52MlNlcnZpY2VVcmwsIE1QLmRldlRva2VuKTtcbiAgICAgICAgZGF0YSA9IHtcbiAgICAgICAgICAgIHV1aWQ6IEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpLFxuICAgICAgICAgICAgZGF0YTogZm9yd2FyZGluZ1N0YXRzRGF0YVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICh4aHIpIHtcbiAgICAgICAgICAgIHhoci5vcGVuKCdwb3N0JywgdXJsICsgJy9Gb3J3YXJkaW5nJyk7XG4gICAgICAgICAgICB4aHIuc2VuZChKU09OLnN0cmluZ2lmeShkYXRhKSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igc2VuZGluZyBmb3J3YXJkaW5nIHN0YXRzIHRvIG1QYXJ0aWNsZSBzZXJ2ZXJzLicpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VuZFNpbmdsZUZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEpIHtcbiAgICB2YXIgdXJsLCBkYXRhO1xuICAgIHRyeSB7XG4gICAgICAgIHZhciB4aHJDYWxsYmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgICAgICAgaWYgKHhoci5zdGF0dXMgPT09IDIwMikge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgc2VudCAgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIHhociA9IEhlbHBlcnMuY3JlYXRlWEhSKHhockNhbGxiYWNrKTtcbiAgICAgICAgdXJsID0gSGVscGVycy5jcmVhdGVTZXJ2aWNlVXJsKENvbnN0YW50cy52MVNlY3VyZVNlcnZpY2VVcmwsIENvbnN0YW50cy52MVNlcnZpY2VVcmwsIE1QLmRldlRva2VuKTtcbiAgICAgICAgZGF0YSA9IGZvcndhcmRpbmdTdGF0c0RhdGE7XG5cbiAgICAgICAgaWYgKHhocikge1xuICAgICAgICAgICAgeGhyLm9wZW4oJ3Bvc3QnLCB1cmwgKyAnL0ZvcndhcmRpbmcnKTtcbiAgICAgICAgICAgIHhoci5zZW5kKEpTT04uc3RyaW5naWZ5KGRhdGEpKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGZvcndhcmRpbmcgc3RhdHMgdG8gbVBhcnRpY2xlIHNlcnZlcnMuJyk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBzZW5kRXZlbnRUb1NlcnZlcjogc2VuZEV2ZW50VG9TZXJ2ZXIsXG4gICAgc2VuZElkZW50aXR5UmVxdWVzdDogc2VuZElkZW50aXR5UmVxdWVzdCxcbiAgICBzZW5kQmF0Y2hGb3J3YXJkaW5nU3RhdHNUb1NlcnZlcjogc2VuZEJhdGNoRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXIsXG4gICAgc2VuZFNpbmdsZUZvcndhcmRpbmdTdGF0c1RvU2VydmVyOiBzZW5kU2luZ2xlRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXJcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xuXG5mdW5jdGlvbiBjcmVhdGVHRFBSQ29uc2VudChjb25zZW50ZWQsIHRpbWVzdGFtcCwgY29uc2VudERvY3VtZW50LCBsb2NhdGlvbiwgaGFyZHdhcmVJZCkge1xuICAgIGlmICh0eXBlb2YoY29uc2VudGVkKSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0NvbnNlbnRlZCBib29sZWFuIGlzIHJlcXVpcmVkIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmICh0aW1lc3RhbXAgJiYgaXNOYU4odGltZXN0YW1wKSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaW1lc3RhbXAgbXVzdCBiZSBhIHZhbGlkIG51bWJlciB3aGVuIGNvbnN0cnVjdGluZyBhIEdEUFIgQ29uc2VudCBvYmplY3QuJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoY29uc2VudERvY3VtZW50ICYmICF0eXBlb2YoY29uc2VudERvY3VtZW50KSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRG9jdW1lbnQgbXVzdCBiZSBhIHZhbGlkIHN0cmluZyB3aGVuIGNvbnN0cnVjdGluZyBhIEdEUFIgQ29uc2VudCBvYmplY3QuJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAobG9jYXRpb24gJiYgIXR5cGVvZihsb2NhdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0xvY2F0aW9uIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgd2hlbiBjb25zdHJ1Y3RpbmcgYSBHRFBSIENvbnNlbnQgb2JqZWN0LicpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGhhcmR3YXJlSWQgJiYgIXR5cGVvZihoYXJkd2FyZUlkKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnSGFyZHdhcmUgSUQgbXVzdCBiZSBhIHZhbGlkIHN0cmluZyB3aGVuIGNvbnN0cnVjdGluZyBhIEdEUFIgQ29uc2VudCBvYmplY3QuJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBDb25zZW50ZWQ6IGNvbnNlbnRlZCxcbiAgICAgICAgVGltZXN0YW1wOiB0aW1lc3RhbXAgfHwgRGF0ZS5ub3coKSxcbiAgICAgICAgQ29uc2VudERvY3VtZW50OiBjb25zZW50RG9jdW1lbnQsXG4gICAgICAgIExvY2F0aW9uOiBsb2NhdGlvbixcbiAgICAgICAgSGFyZHdhcmVJZDogaGFyZHdhcmVJZFxuICAgIH07XG59XG5cbnZhciBDb25zZW50U2VyaWFsaXphdGlvbiA9IHtcbiAgICB0b01pbmlmaWVkSnNvbk9iamVjdDogZnVuY3Rpb24oc3RhdGUpIHtcbiAgICAgICAgdmFyIGpzb25PYmplY3QgPSB7fTtcbiAgICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgICAgICB2YXIgZ2RwckNvbnNlbnRTdGF0ZSA9IHN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKTtcbiAgICAgICAgICAgIGlmIChnZHByQ29uc2VudFN0YXRlKSB7XG4gICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByID0ge307XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgcHVycG9zZSBpbiBnZHByQ29uc2VudFN0YXRlKXtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBnZHByQ29uc2VudCA9IGdkcHJDb25zZW50U3RhdGVbcHVycG9zZV07XG4gICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0gPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuQ29uc2VudGVkKSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLmMgPSBnZHByQ29uc2VudC5Db25zZW50ZWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LlRpbWVzdGFtcCkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLnRzID0gZ2RwckNvbnNlbnQuVGltZXN0YW1wO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Db25zZW50RG9jdW1lbnQpID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGpzb25PYmplY3QuZ2RwcltwdXJwb3NlXS5kID0gZ2RwckNvbnNlbnQuQ29uc2VudERvY3VtZW50O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Mb2NhdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLmwgPSBnZHByQ29uc2VudC5Mb2NhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuSGFyZHdhcmVJZCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLmggPSBnZHByQ29uc2VudC5IYXJkd2FyZUlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBqc29uT2JqZWN0O1xuICAgIH0sXG5cbiAgICBmcm9tTWluaWZpZWRKc29uT2JqZWN0OiBmdW5jdGlvbihqc29uKSB7XG4gICAgICAgIHZhciBzdGF0ZSA9IGNyZWF0ZUNvbnNlbnRTdGF0ZSgpO1xuICAgICAgICBpZiAoanNvbi5nZHByKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGpzb24uZ2Rwcil7XG4gICAgICAgICAgICAgICAgaWYgKGpzb24uZ2Rwci5oYXNPd25Qcm9wZXJ0eShwdXJwb3NlKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZ2RwckNvbnNlbnQgPSBjcmVhdGVHRFBSQ29uc2VudChqc29uLmdkcHJbcHVycG9zZV0uYyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb24uZ2RwcltwdXJwb3NlXS50cyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb24uZ2RwcltwdXJwb3NlXS5kLFxuICAgICAgICAgICAgICAgICAgICAgICAganNvbi5nZHByW3B1cnBvc2VdLmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBqc29uLmdkcHJbcHVycG9zZV0uaCk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLmFkZEdEUFJDb25zZW50U3RhdGUocHVycG9zZSwgZ2RwckNvbnNlbnQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gY3JlYXRlQ29uc2VudFN0YXRlKGNvbnNlbnRTdGF0ZSkge1xuICAgIHZhciBnZHByID0ge307XG5cbiAgICBpZiAoY29uc2VudFN0YXRlKSB7XG4gICAgICAgIHNldEdEUFJDb25zZW50U3RhdGUoY29uc2VudFN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2Fub25pY2FsaXplRm9yRGVkdXBsaWNhdGlvbihwdXJwb3NlKSB7XG4gICAgICAgIGlmICh0eXBlb2YocHVycG9zZSkgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdHJpbW1lZFB1cnBvc2UgPSBwdXJwb3NlLnRyaW0oKTtcbiAgICAgICAgaWYgKCF0cmltbWVkUHVycG9zZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cmltbWVkUHVycG9zZS50b0xvd2VyQ2FzZSgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldEdEUFJDb25zZW50U3RhdGUoZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICBpZiAoIWdkcHJDb25zZW50U3RhdGUpIHtcbiAgICAgICAgICAgIGdkcHIgPSB7fTtcbiAgICAgICAgfSBlbHNlIGlmIChIZWxwZXJzLmlzT2JqZWN0KGdkcHJDb25zZW50U3RhdGUpKSB7XG4gICAgICAgICAgICBnZHByID0ge307XG4gICAgICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGdkcHJDb25zZW50U3RhdGUpe1xuICAgICAgICAgICAgICAgIGlmIChnZHByQ29uc2VudFN0YXRlLmhhc093blByb3BlcnR5KHB1cnBvc2UpKSB7XG4gICAgICAgICAgICAgICAgICAgIGFkZEdEUFJDb25zZW50U3RhdGUocHVycG9zZSwgZ2RwckNvbnNlbnRTdGF0ZVtwdXJwb3NlXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFkZEdEUFJDb25zZW50U3RhdGUocHVycG9zZSwgZ2RwckNvbnNlbnQpIHtcbiAgICAgICAgdmFyIG5vcm1hbGl6ZWRQdXJwb3NlID0gY2Fub25pY2FsaXplRm9yRGVkdXBsaWNhdGlvbihwdXJwb3NlKTtcbiAgICAgICAgaWYgKCFub3JtYWxpemVkUHVycG9zZSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnYWRkR0RQUkNvbnNlbnRTdGF0ZSgpIGludm9rZWQgd2l0aCBiYWQgcHVycG9zZS4gUHVycG9zZSBtdXN0IGJlIGEgc3RyaW5nLicpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFIZWxwZXJzLmlzT2JqZWN0KGdkcHJDb25zZW50KSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnYWRkR0RQUkNvbnNlbnRTdGF0ZSgpIGludm9rZWQgd2l0aCBiYWQgb3IgZW1wdHkgR0RQUiBjb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIHZhciBnZHByQ29uc2VudENvcHkgPSBjcmVhdGVHRFBSQ29uc2VudChnZHByQ29uc2VudC5Db25zZW50ZWQsIFxuICAgICAgICAgICAgICAgIGdkcHJDb25zZW50LlRpbWVzdGFtcCxcbiAgICAgICAgICAgICAgICBnZHByQ29uc2VudC5Db25zZW50RG9jdW1lbnQsXG4gICAgICAgICAgICAgICAgZ2RwckNvbnNlbnQuTG9jYXRpb24sXG4gICAgICAgICAgICAgICAgZ2RwckNvbnNlbnQuSGFyZHdhcmVJZCk7XG4gICAgICAgIGlmIChnZHByQ29uc2VudENvcHkpIHtcbiAgICAgICAgICAgIGdkcHJbbm9ybWFsaXplZFB1cnBvc2VdID0gZ2RwckNvbnNlbnRDb3B5O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbW92ZUdEUFJDb25zZW50U3RhdGUocHVycG9zZSkge1xuICAgICAgICB2YXIgbm9ybWFsaXplZFB1cnBvc2UgPSBjYW5vbmljYWxpemVGb3JEZWR1cGxpY2F0aW9uKHB1cnBvc2UpO1xuICAgICAgICBpZiAoIW5vcm1hbGl6ZWRQdXJwb3NlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgICAgICBkZWxldGUgZ2Rwcltub3JtYWxpemVkUHVycG9zZV07XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGdldEdEUFJDb25zZW50U3RhdGUoKSB7XG4gICAgICAgIHJldHVybiBIZWxwZXJzLmV4dGVuZCh7fSwgZ2Rwcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgc2V0R0RQUkNvbnNlbnRTdGF0ZTogc2V0R0RQUkNvbnNlbnRTdGF0ZSxcbiAgICAgICAgYWRkR0RQUkNvbnNlbnRTdGF0ZTogYWRkR0RQUkNvbnNlbnRTdGF0ZSxcbiAgICAgICAgZ2V0R0RQUkNvbnNlbnRTdGF0ZTogZ2V0R0RQUkNvbnNlbnRTdGF0ZSxcbiAgICAgICAgcmVtb3ZlR0RQUkNvbnNlbnRTdGF0ZTogcmVtb3ZlR0RQUkNvbnNlbnRTdGF0ZVxuICAgIH07XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgY3JlYXRlR0RQUkNvbnNlbnQ6IGNyZWF0ZUdEUFJDb25zZW50LFxuICAgIFNlcmlhbGl6YXRpb246IENvbnNlbnRTZXJpYWxpemF0aW9uLFxuICAgIGNyZWF0ZUNvbnNlbnRTdGF0ZTogY3JlYXRlQ29uc2VudFN0YXRlXG59O1xuIiwidmFyIHYxU2VydmljZVVybCA9ICdqc3Nkay5tcGFydGljbGUuY29tL3YxL0pTLycsXG4gICAgdjFTZWN1cmVTZXJ2aWNlVXJsID0gJ2pzc2Rrcy5tcGFydGljbGUuY29tL3YxL0pTLycsXG4gICAgdjJTZXJ2aWNlVXJsID0gJ2pzc2RrLm1wYXJ0aWNsZS5jb20vdjIvSlMvJyxcbiAgICB2MlNlY3VyZVNlcnZpY2VVcmwgPSAnanNzZGtzLm1wYXJ0aWNsZS5jb20vdjIvSlMvJyxcbiAgICBpZGVudGl0eVVybCA9ICdodHRwczovL2lkZW50aXR5Lm1wYXJ0aWNsZS5jb20vdjEvJywgLy9wcm9kXG4gICAgc2RrVmVyc2lvbiA9ICcyLjguNCcsXG4gICAgc2RrVmVuZG9yID0gJ21wYXJ0aWNsZScsXG4gICAgcGxhdGZvcm0gPSAnd2ViJyxcbiAgICBNZXNzYWdlcyA9IHtcbiAgICAgICAgRXJyb3JNZXNzYWdlczoge1xuICAgICAgICAgICAgTm9Ub2tlbjogJ0EgdG9rZW4gbXVzdCBiZSBzcGVjaWZpZWQuJyxcbiAgICAgICAgICAgIEV2ZW50TmFtZUludmFsaWRUeXBlOiAnRXZlbnQgbmFtZSBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIHZhbHVlLicsXG4gICAgICAgICAgICBFdmVudERhdGFJbnZhbGlkVHlwZTogJ0V2ZW50IGRhdGEgbXVzdCBiZSBhIHZhbGlkIG9iamVjdCBoYXNoLicsXG4gICAgICAgICAgICBMb2dnaW5nRGlzYWJsZWQ6ICdFdmVudCBsb2dnaW5nIGlzIGN1cnJlbnRseSBkaXNhYmxlZC4nLFxuICAgICAgICAgICAgQ29va2llUGFyc2VFcnJvcjogJ0NvdWxkIG5vdCBwYXJzZSBjb29raWUnLFxuICAgICAgICAgICAgRXZlbnRFbXB0eTogJ0V2ZW50IG9iamVjdCBpcyBudWxsIG9yIHVuZGVmaW5lZCwgY2FuY2VsbGluZyBzZW5kJyxcbiAgICAgICAgICAgIEFQSVJlcXVlc3RFbXB0eTogJ0FQSVJlcXVlc3QgaXMgbnVsbCBvciB1bmRlZmluZWQsIGNhbmNlbGxpbmcgc2VuZCcsXG4gICAgICAgICAgICBOb0V2ZW50VHlwZTogJ0V2ZW50IHR5cGUgbXVzdCBiZSBzcGVjaWZpZWQuJyxcbiAgICAgICAgICAgIFRyYW5zYWN0aW9uSWRSZXF1aXJlZDogJ1RyYW5zYWN0aW9uIElEIGlzIHJlcXVpcmVkJyxcbiAgICAgICAgICAgIFRyYW5zYWN0aW9uUmVxdWlyZWQ6ICdBIHRyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0IGlzIHJlcXVpcmVkJyxcbiAgICAgICAgICAgIFByb21vdGlvbklkUmVxdWlyZWQ6ICdQcm9tb3Rpb24gSUQgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgQmFkQXR0cmlidXRlOiAnQXR0cmlidXRlIHZhbHVlIGNhbm5vdCBiZSBvYmplY3Qgb3IgYXJyYXknLFxuICAgICAgICAgICAgQmFkS2V5OiAnS2V5IHZhbHVlIGNhbm5vdCBiZSBvYmplY3Qgb3IgYXJyYXknLFxuICAgICAgICAgICAgQmFkTG9nUHVyY2hhc2U6ICdUcmFuc2FjdGlvbiBhdHRyaWJ1dGVzIGFuZCBhIHByb2R1Y3QgYXJlIGJvdGggcmVxdWlyZWQgdG8gbG9nIGEgcHVyY2hhc2UsIGh0dHBzOi8vZG9jcy5tcGFydGljbGUuY29tLz9qYXZhc2NyaXB0I21lYXN1cmluZy10cmFuc2FjdGlvbnMnXG4gICAgICAgIH0sXG4gICAgICAgIEluZm9ybWF0aW9uTWVzc2FnZXM6IHtcbiAgICAgICAgICAgIENvb2tpZVNlYXJjaDogJ1NlYXJjaGluZyBmb3IgY29va2llJyxcbiAgICAgICAgICAgIENvb2tpZUZvdW5kOiAnQ29va2llIGZvdW5kLCBwYXJzaW5nIHZhbHVlcycsXG4gICAgICAgICAgICBDb29raWVOb3RGb3VuZDogJ0Nvb2tpZXMgbm90IGZvdW5kJyxcbiAgICAgICAgICAgIENvb2tpZVNldDogJ1NldHRpbmcgY29va2llJyxcbiAgICAgICAgICAgIENvb2tpZVN5bmM6ICdQZXJmb3JtaW5nIGNvb2tpZSBzeW5jJyxcbiAgICAgICAgICAgIFNlbmRCZWdpbjogJ1N0YXJ0aW5nIHRvIHNlbmQgZXZlbnQnLFxuICAgICAgICAgICAgU2VuZElkZW50aXR5QmVnaW46ICdTdGFydGluZyB0byBzZW5kIGV2ZW50IHRvIGlkZW50aXR5IHNlcnZlcicsXG4gICAgICAgICAgICBTZW5kV2luZG93c1Bob25lOiAnU2VuZGluZyBldmVudCB0byBXaW5kb3dzIFBob25lIGNvbnRhaW5lcicsXG4gICAgICAgICAgICBTZW5kSU9TOiAnQ2FsbGluZyBpT1MgcGF0aDogJyxcbiAgICAgICAgICAgIFNlbmRBbmRyb2lkOiAnQ2FsbGluZyBBbmRyb2lkIEpTIGludGVyZmFjZSBtZXRob2Q6ICcsXG4gICAgICAgICAgICBTZW5kSHR0cDogJ1NlbmRpbmcgZXZlbnQgdG8gbVBhcnRpY2xlIEhUVFAgc2VydmljZScsXG4gICAgICAgICAgICBTZW5kSWRlbnRpdHlIdHRwOiAnU2VuZGluZyBldmVudCB0byBtUGFydGljbGUgSFRUUCBzZXJ2aWNlJyxcbiAgICAgICAgICAgIFN0YXJ0aW5nTmV3U2Vzc2lvbjogJ1N0YXJ0aW5nIG5ldyBTZXNzaW9uJyxcbiAgICAgICAgICAgIFN0YXJ0aW5nTG9nRXZlbnQ6ICdTdGFydGluZyB0byBsb2cgZXZlbnQnLFxuICAgICAgICAgICAgU3RhcnRpbmdMb2dPcHRPdXQ6ICdTdGFydGluZyB0byBsb2cgdXNlciBvcHQgaW4vb3V0JyxcbiAgICAgICAgICAgIFN0YXJ0aW5nRW5kU2Vzc2lvbjogJ1N0YXJ0aW5nIHRvIGVuZCBzZXNzaW9uJyxcbiAgICAgICAgICAgIFN0YXJ0aW5nSW5pdGlhbGl6YXRpb246ICdTdGFydGluZyB0byBpbml0aWFsaXplJyxcbiAgICAgICAgICAgIFN0YXJ0aW5nTG9nQ29tbWVyY2VFdmVudDogJ1N0YXJ0aW5nIHRvIGxvZyBjb21tZXJjZSBldmVudCcsXG4gICAgICAgICAgICBMb2FkaW5nQ29uZmlnOiAnTG9hZGluZyBjb25maWd1cmF0aW9uIG9wdGlvbnMnLFxuICAgICAgICAgICAgQWJhbmRvbkxvZ0V2ZW50OiAnQ2Fubm90IGxvZyBldmVudCwgbG9nZ2luZyBkaXNhYmxlZCBvciBkZXZlbG9wZXIgdG9rZW4gbm90IHNldCcsXG4gICAgICAgICAgICBBYmFuZG9uU3RhcnRTZXNzaW9uOiAnQ2Fubm90IHN0YXJ0IHNlc3Npb24sIGxvZ2dpbmcgZGlzYWJsZWQgb3IgZGV2ZWxvcGVyIHRva2VuIG5vdCBzZXQnLFxuICAgICAgICAgICAgQWJhbmRvbkVuZFNlc3Npb246ICdDYW5ub3QgZW5kIHNlc3Npb24sIGxvZ2dpbmcgZGlzYWJsZWQgb3IgZGV2ZWxvcGVyIHRva2VuIG5vdCBzZXQnLFxuICAgICAgICAgICAgTm9TZXNzaW9uVG9FbmQ6ICdDYW5ub3QgZW5kIHNlc3Npb24sIG5vIGFjdGl2ZSBzZXNzaW9uIGZvdW5kJ1xuICAgICAgICB9LFxuICAgICAgICBWYWxpZGF0aW9uTWVzc2FnZXM6IHtcbiAgICAgICAgICAgIE1vZGlmeUlkZW50aXR5UmVxdWVzdFVzZXJJZGVudGl0aWVzUHJlc2VudDogJ2lkZW50aXR5UmVxdWVzdHMgdG8gbW9kaWZ5IHJlcXVpcmUgdXNlcklkZW50aXRpZXMgdG8gYmUgcHJlc2VudC4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2FpbicsXG4gICAgICAgICAgICBJZGVudGl0eVJlcXVlc2V0SW52YWxpZEtleTogJ1RoZXJlIGlzIGFuIGludmFsaWQga2V5IG9uIHlvdXIgaWRlbnRpdHlSZXF1ZXN0IG9iamVjdC4gSXQgY2FuIG9ubHkgY29udGFpbiBhIGB1c2VySWRlbnRpdGllc2Agb2JqZWN0IGFuZCBhIGBvblVzZXJBbGlhc2AgZnVuY3Rpb24uIFJlcXVlc3Qgbm90IHNlbnQgdG8gc2VydmVyLiBQbGVhc2UgZml4IGFuZCB0cnkgYWdhaW4uJyxcbiAgICAgICAgICAgIE9uVXNlckFsaWFzVHlwZTogJ1RoZSBvblVzZXJBbGlhcyB2YWx1ZSBtdXN0IGJlIGEgZnVuY3Rpb24uIFRoZSBvblVzZXJBbGlhcyBwcm92aWRlZCBpcyBvZiB0eXBlJyxcbiAgICAgICAgICAgIFVzZXJJZGVudGl0aWVzOiAnVGhlIHVzZXJJZGVudGl0aWVzIGtleSBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGtleXMgb2YgaWRlbnRpdHlUeXBlcyBhbmQgdmFsdWVzIG9mIHN0cmluZ3MuIFJlcXVlc3Qgbm90IHNlbnQgdG8gc2VydmVyLiBQbGVhc2UgZml4IGFuZCB0cnkgYWdhaW4uJyxcbiAgICAgICAgICAgIFVzZXJJZGVudGl0aWVzSW52YWxpZEtleTogJ1RoZXJlIGlzIGFuIGludmFsaWQgaWRlbnRpdHkga2V5IG9uIHlvdXIgYHVzZXJJZGVudGl0aWVzYCBvYmplY3Qgd2l0aGluIHRoZSBpZGVudGl0eVJlcXVlc3QuIFJlcXVlc3Qgbm90IHNlbnQgdG8gc2VydmVyLiBQbGVhc2UgZml4IGFuZCB0cnkgYWdhaW4uJyxcbiAgICAgICAgICAgIFVzZXJJZGVudGl0aWVzSW52YWxpZFZhbHVlczogJ0FsbCB1c2VyIGlkZW50aXR5IHZhbHVlcyBtdXN0IGJlIHN0cmluZ3Mgb3IgbnVsbC4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nXG5cbiAgICAgICAgfVxuICAgIH0sXG4gICAgTmF0aXZlU2RrUGF0aHMgPSB7XG4gICAgICAgIExvZ0V2ZW50OiAnbG9nRXZlbnQnLFxuICAgICAgICBTZXRVc2VyVGFnOiAnc2V0VXNlclRhZycsXG4gICAgICAgIFJlbW92ZVVzZXJUYWc6ICdyZW1vdmVVc2VyVGFnJyxcbiAgICAgICAgU2V0VXNlckF0dHJpYnV0ZTogJ3NldFVzZXJBdHRyaWJ1dGUnLFxuICAgICAgICBSZW1vdmVVc2VyQXR0cmlidXRlOiAncmVtb3ZlVXNlckF0dHJpYnV0ZScsXG4gICAgICAgIFNldFNlc3Npb25BdHRyaWJ1dGU6ICdzZXRTZXNzaW9uQXR0cmlidXRlJyxcbiAgICAgICAgQWRkVG9DYXJ0OiAnYWRkVG9DYXJ0JyxcbiAgICAgICAgUmVtb3ZlRnJvbUNhcnQ6ICdyZW1vdmVGcm9tQ2FydCcsXG4gICAgICAgIENsZWFyQ2FydDogJ2NsZWFyQ2FydCcsXG4gICAgICAgIExvZ091dDogJ2xvZ091dCcsXG4gICAgICAgIFNldFVzZXJBdHRyaWJ1dGVMaXN0OiAnc2V0VXNlckF0dHJpYnV0ZUxpc3QnLFxuICAgICAgICBSZW1vdmVBbGxVc2VyQXR0cmlidXRlczogJ3JlbW92ZUFsbFVzZXJBdHRyaWJ1dGVzJyxcbiAgICAgICAgR2V0VXNlckF0dHJpYnV0ZXNMaXN0czogJ2dldFVzZXJBdHRyaWJ1dGVzTGlzdHMnLFxuICAgICAgICBHZXRBbGxVc2VyQXR0cmlidXRlczogJ2dldEFsbFVzZXJBdHRyaWJ1dGVzJyxcbiAgICAgICAgSWRlbnRpZnk6ICdpZGVudGlmeScsXG4gICAgICAgIExvZ291dDogJ2xvZ291dCcsXG4gICAgICAgIExvZ2luOiAnbG9naW4nLFxuICAgICAgICBNb2RpZnk6ICdtb2RpZnknXG4gICAgfSxcbiAgICBEZWZhdWx0Q29uZmlnID0ge1xuICAgICAgICBMb2NhbFN0b3JhZ2VOYW1lOiAnbXBydGNsLWFwaScsICAgICAgICAgICAgIC8vIE5hbWUgb2YgdGhlIG1QIGxvY2Fsc3RvcmFnZSwgaGFkIGNwIGFuZCBwYiBldmVuIGlmIGNvb2tpZXMgd2VyZSB1c2VkLCBza2lwcGVkIHYyXG4gICAgICAgIExvY2FsU3RvcmFnZU5hbWVWMzogJ21wcnRjbC12MycsICAgICAgICAgICAgLy8gdjMgTmFtZSBvZiB0aGUgbVAgbG9jYWxzdG9yYWdlLCBmaW5hbCB2ZXJzaW9uIG9uIFNES3YxXG4gICAgICAgIExvY2FsU3RvcmFnZU5hbWVWNDogJ21wcnRjbC12NCcsICAgICAgICAgICAgLy8gdjQgTmFtZSBvZiB0aGUgbVAgbG9jYWxzdG9yYWdlLCBDdXJyZW50IFZlcnNpb25cbiAgICAgICAgTG9jYWxTdG9yYWdlUHJvZHVjdHNWNDogJ21wcnRjbC1wcm9kdjQnLCAgICAvLyBUaGUgbmFtZSBmb3IgbVAgbG9jYWxzdG9yYWdlIHRoYXQgY29udGFpbnMgcHJvZHVjdHMgZm9yIGNhcnRQcm9kdWNzIGFuZCBwcm9kdWN0QmFnc1xuICAgICAgICBDb29raWVOYW1lOiAnbXBydGNsLWFwaScsICAgICAgICAgICAgICAgICAgIC8vIHYxIE5hbWUgb2YgdGhlIGNvb2tpZSBzdG9yZWQgb24gdGhlIHVzZXIncyBtYWNoaW5lXG4gICAgICAgIENvb2tpZU5hbWVWMjogJ21wcnRjbC12MicsICAgICAgICAgICAgICAgICAgLy8gdjIgTmFtZSBvZiB0aGUgY29va2llIHN0b3JlZCBvbiB0aGUgdXNlcidzIG1hY2hpbmUuIFJlbW92ZWQga2V5cyB3aXRoIG5vIHZhbHVlcywgbW92ZWQgY2FydFByb2R1Y3RzIGFuZCBwcm9kdWN0QmFncyB0byBsb2NhbFN0b3JhZ2UuXG4gICAgICAgIENvb2tpZU5hbWVWMzogJ21wcnRjbC12MycsICAgICAgICAgICAgICAgICAgLy8gdjMgTmFtZSBvZiB0aGUgY29va2llIHN0b3JlZCBvbiB0aGUgdXNlcidzIG1hY2hpbmUuIEJhc2U2NCBlbmNvZGVkIGtleXMgaW4gQmFzZTY0Q29va2llS2V5cyBvYmplY3QsIGZpbmFsIHZlcnNpb24gb24gU0RLdjFcbiAgICAgICAgQ29va2llTmFtZVY0OiAnbXBydGNsLXY0JywgICAgICAgICAgICAgICAgICAvLyB2NCBOYW1lIG9mIHRoZSBjb29raWUgc3RvcmVkIG9uIHRoZSB1c2VyJ3MgbWFjaGluZS4gQmFzZTY0IGVuY29kZWQga2V5cyBpbiBCYXNlNjRDb29raWVLZXlzIG9iamVjdCwgY3VycmVudCB2ZXJzaW9uIG9uIFNESyB2MlxuICAgICAgICBDb29raWVEb21haW46IG51bGwsIFx0XHRcdCAgICAgICAgICAgIC8vIElmIG51bGwsIGRlZmF1bHRzIHRvIGN1cnJlbnQgbG9jYXRpb24uaG9zdFxuICAgICAgICBEZWJ1ZzogZmFsc2UsXHRcdFx0XHRcdCAgICAgICAgICAgIC8vIElmIHRydWUsIHdpbGwgcHJpbnQgZGVidWcgbWVzc2FnZXMgdG8gYnJvd3NlciBjb25zb2xlXG4gICAgICAgIENvb2tpZUV4cGlyYXRpb246IDM2NSxcdFx0XHQgICAgICAgICAgICAvLyBDb29raWUgZXhwaXJhdGlvbiB0aW1lIGluIGRheXNcbiAgICAgICAgTG9nTGV2ZWw6IG51bGwsXHRcdFx0XHRcdCAgICAgICAgICAgIC8vIFdoYXQgbG9nZ2luZyB3aWxsIGJlIHByb3ZpZGVkIGluIHRoZSBjb25zb2xlXG4gICAgICAgIEluY2x1ZGVSZWZlcnJlcjogdHJ1ZSxcdFx0XHQgICAgICAgICAgICAvLyBJbmNsdWRlIHVzZXIncyByZWZlcnJlclxuICAgICAgICBJbmNsdWRlR29vZ2xlQWR3b3JkczogdHJ1ZSxcdFx0ICAgICAgICAgICAgLy8gSW5jbHVkZSB1dG1fc291cmNlIGFuZCB1dG1fcHJvcGVydGllc1xuICAgICAgICBUaW1lb3V0OiAzMDAsXHRcdFx0XHRcdCAgICAgICAgICAgIC8vIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzIGZvciBsb2dnaW5nIGZ1bmN0aW9uc1xuICAgICAgICBTZXNzaW9uVGltZW91dDogMzAsXHRcdFx0XHQgICAgICAgICAgICAvLyBTZXNzaW9uIHRpbWVvdXQgaW4gbWludXRlc1xuICAgICAgICBTYW5kYm94OiBmYWxzZSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEV2ZW50cyBhcmUgbWFya2VkIGFzIGRlYnVnIGFuZCBvbmx5IGZvcndhcmRlZCB0byBkZWJ1ZyBmb3J3YXJkZXJzLFxuICAgICAgICBWZXJzaW9uOiBudWxsLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSB2ZXJzaW9uIG9mIHRoaXMgd2Vic2l0ZS9hcHBcbiAgICAgICAgTWF4UHJvZHVjdHM6IDIwLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBOdW1iZXIgb2YgcHJvZHVjdHMgcGVyc2lzdGVkIGluIGNhcnRQcm9kdWN0cyBhbmQgcHJvZHVjdEJhZ3NcbiAgICAgICAgRm9yd2FyZGVyU3RhdHNUaW1lb3V0OiA1MDAwLCAgICAgICAgICAgICAgICAvLyBNaWxsaXNlY29uZHMgZm9yIGZvcndhcmRlclN0YXRzIHRpbWVvdXRcbiAgICAgICAgSW50ZWdyYXRpb25EZWxheVRpbWVvdXQ6IDUwMDAsICAgICAgICAgICAgICAvLyBNaWxsaXNlY29uZHMgZm9yIGZvcmNpbmcgdGhlIGludGVncmF0aW9uIGRlbGF5IHRvIHVuLXN1c3BlbmQgZXZlbnQgcXVldWVpbmcgZHVlIHRvIGludGVncmF0aW9uIHBhcnRuZXIgZXJyb3JzXG4gICAgICAgIE1heENvb2tpZVNpemU6IDMwMDAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTnVtYmVyIG9mIGJ5dGVzIGZvciBjb29raWUgc2l6ZSB0byBub3QgZXhjZWVkXG4gICAgfSxcbiAgICBCYXNlNjRDb29raWVLZXlzID0ge1xuICAgICAgICBjc206IDEsXG4gICAgICAgIHNhOiAxLFxuICAgICAgICBzczogMSxcbiAgICAgICAgdWE6IDEsXG4gICAgICAgIHVpOiAxLFxuICAgICAgICBjc2Q6IDEsXG4gICAgICAgIGlhOiAxLFxuICAgICAgICBjb246IDFcbiAgICB9LFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXMgPSB7XG4gICAgICAgIGdzOiAxLFxuICAgICAgICBjdTogMSxcbiAgICAgICAgbDogMSxcbiAgICAgICAgZ2xvYmFsU2V0dGluZ3M6IDEsXG4gICAgICAgIGN1cnJlbnRVc2VyTVBJRDogMVxuICAgIH0sXG4gICAgSFRUUENvZGVzID0ge1xuICAgICAgICBub0h0dHBDb3ZlcmFnZTogLTEsXG4gICAgICAgIGFjdGl2ZUlkZW50aXR5UmVxdWVzdDogLTIsXG4gICAgICAgIGFjdGl2ZVNlc3Npb246IC0zLFxuICAgICAgICB2YWxpZGF0aW9uSXNzdWU6IC00LFxuICAgICAgICBuYXRpdmVJZGVudGl0eVJlcXVlc3Q6IC01LFxuICAgICAgICBsb2dnaW5nRGlzYWJsZWRPck1pc3NpbmdBUElLZXk6IC02LFxuICAgICAgICB0b29NYW55UmVxdWVzdHM6IDQyOVxuICAgIH0sXG4gICAgRmVhdHVyZXMgPSB7XG4gICAgICAgIEJhdGNoaW5nOiAnYmF0Y2hpbmcnXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgdjFTZXJ2aWNlVXJsOiB2MVNlcnZpY2VVcmwsXG4gICAgdjFTZWN1cmVTZXJ2aWNlVXJsOiB2MVNlY3VyZVNlcnZpY2VVcmwsXG4gICAgdjJTZXJ2aWNlVXJsOiB2MlNlcnZpY2VVcmwsXG4gICAgdjJTZWN1cmVTZXJ2aWNlVXJsOiB2MlNlY3VyZVNlcnZpY2VVcmwsXG4gICAgaWRlbnRpdHlVcmw6IGlkZW50aXR5VXJsLFxuICAgIHNka1ZlcnNpb246IHNka1ZlcnNpb24sXG4gICAgc2RrVmVuZG9yOiBzZGtWZW5kb3IsXG4gICAgcGxhdGZvcm06IHBsYXRmb3JtLFxuICAgIE1lc3NhZ2VzOiBNZXNzYWdlcyxcbiAgICBOYXRpdmVTZGtQYXRoczogTmF0aXZlU2RrUGF0aHMsXG4gICAgRGVmYXVsdENvbmZpZzogRGVmYXVsdENvbmZpZyxcbiAgICBCYXNlNjRDb29raWVLZXlzOkJhc2U2NENvb2tpZUtleXMsXG4gICAgSFRUUENvZGVzOiBIVFRQQ29kZXMsXG4gICAgRmVhdHVyZXM6IEZlYXR1cmVzLFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXM6IFNES3YyTm9uTVBJRENvb2tpZUtleXNcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyk7XG5cbnZhciBjb29raWVTeW5jTWFuYWdlciA9IHtcbiAgICBhdHRlbXB0Q29va2llU3luYzogZnVuY3Rpb24ocHJldmlvdXNNUElELCBtcGlkKSB7XG4gICAgICAgIHZhciBwaXhlbENvbmZpZywgbGFzdFN5bmNEYXRlRm9yTW9kdWxlLCB1cmwsIHJlZGlyZWN0LCB1cmxXaXRoUmVkaXJlY3Q7XG4gICAgICAgIGlmIChtcGlkICYmICFNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgTVAucGl4ZWxDb25maWd1cmF0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKHBpeGVsU2V0dGluZ3MpIHtcbiAgICAgICAgICAgICAgICBwaXhlbENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgbW9kdWxlSWQ6IHBpeGVsU2V0dGluZ3MubW9kdWxlSWQsXG4gICAgICAgICAgICAgICAgICAgIGZyZXF1ZW5jeUNhcDogcGl4ZWxTZXR0aW5ncy5mcmVxdWVuY3lDYXAsXG4gICAgICAgICAgICAgICAgICAgIHBpeGVsVXJsOiBjb29raWVTeW5jTWFuYWdlci5yZXBsYWNlQW1wKHBpeGVsU2V0dGluZ3MucGl4ZWxVcmwpLFxuICAgICAgICAgICAgICAgICAgICByZWRpcmVjdFVybDogcGl4ZWxTZXR0aW5ncy5yZWRpcmVjdFVybCA/IGNvb2tpZVN5bmNNYW5hZ2VyLnJlcGxhY2VBbXAocGl4ZWxTZXR0aW5ncy5yZWRpcmVjdFVybCkgOiBudWxsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIHVybCA9IGNvb2tpZVN5bmNNYW5hZ2VyLnJlcGxhY2VNUElEKHBpeGVsQ29uZmlnLnBpeGVsVXJsLCBtcGlkKTtcbiAgICAgICAgICAgICAgICByZWRpcmVjdCA9IHBpeGVsQ29uZmlnLnJlZGlyZWN0VXJsID8gY29va2llU3luY01hbmFnZXIucmVwbGFjZU1QSUQocGl4ZWxDb25maWcucmVkaXJlY3RVcmwsIG1waWQpIDogJyc7XG4gICAgICAgICAgICAgICAgdXJsV2l0aFJlZGlyZWN0ID0gdXJsICsgZW5jb2RlVVJJQ29tcG9uZW50KHJlZGlyZWN0KTtcblxuICAgICAgICAgICAgICAgIGlmIChwcmV2aW91c01QSUQgJiYgcHJldmlvdXNNUElEICE9PSBtcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyLnBlcmZvcm1Db29raWVTeW5jKHVybFdpdGhSZWRpcmVjdCwgcGl4ZWxDb25maWcubW9kdWxlSWQpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbGFzdFN5bmNEYXRlRm9yTW9kdWxlID0gTVAuY29va2llU3luY0RhdGVzWyhwaXhlbENvbmZpZy5tb2R1bGVJZCkudG9TdHJpbmcoKV0gPyBNUC5jb29raWVTeW5jRGF0ZXNbKHBpeGVsQ29uZmlnLm1vZHVsZUlkKS50b1N0cmluZygpXSA6IG51bGw7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGxhc3RTeW5jRGF0ZUZvck1vZHVsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgdG8gc2VlIGlmIHdlIG5lZWQgdG8gcmVmcmVzaCBjb29raWVTeW5jXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoKG5ldyBEYXRlKCkpLmdldFRpbWUoKSA+IChuZXcgRGF0ZShsYXN0U3luY0RhdGVGb3JNb2R1bGUpLmdldFRpbWUoKSArIChwaXhlbENvbmZpZy5mcmVxdWVuY3lDYXAgKiA2MCAqIDEwMDAgKiA2MCAqIDI0KSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVTeW5jTWFuYWdlci5wZXJmb3JtQ29va2llU3luYyh1cmxXaXRoUmVkaXJlY3QsIHBpeGVsQ29uZmlnLm1vZHVsZUlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyLnBlcmZvcm1Db29raWVTeW5jKHVybFdpdGhSZWRpcmVjdCwgcGl4ZWxDb25maWcubW9kdWxlSWQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgcGVyZm9ybUNvb2tpZVN5bmM6IGZ1bmN0aW9uKHVybCwgbW9kdWxlSWQpIHtcbiAgICAgICAgdmFyIGltZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2ltZycpO1xuXG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Db29raWVTeW5jKTtcblxuICAgICAgICBpbWcuc3JjID0gdXJsO1xuICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXNbbW9kdWxlSWQudG9TdHJpbmcoKV0gPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xuICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICB9LFxuXG4gICAgcmVwbGFjZU1QSUQ6IGZ1bmN0aW9uKHN0cmluZywgbXBpZCkge1xuICAgICAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoJyUlbXBpZCUlJywgbXBpZCk7XG4gICAgfSxcblxuICAgIHJlcGxhY2VBbXA6IGZ1bmN0aW9uKHN0cmluZykge1xuICAgICAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoLyZhbXA7L2csICcmJyk7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBjb29raWVTeW5jTWFuYWdlcjtcbiIsInZhciBUeXBlcyA9IHJlcXVpcmUoJy4vdHlwZXMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgVmFsaWRhdG9ycyA9IEhlbHBlcnMuVmFsaWRhdG9ycyxcbiAgICBNZXNzYWdlcyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJykuTWVzc2FnZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgU2VydmVyTW9kZWwgPSByZXF1aXJlKCcuL3NlcnZlck1vZGVsJyk7XG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0QWN0aW9uKSB7XG4gICAgcHJvZHVjdEFjdGlvbi5UcmFuc2FjdGlvbklkID0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzLklkO1xuICAgIHByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb24gPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuQWZmaWxpYXRpb247XG4gICAgcHJvZHVjdEFjdGlvbi5Db3Vwb25Db2RlID0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzLkNvdXBvbkNvZGU7XG4gICAgcHJvZHVjdEFjdGlvbi5Ub3RhbEFtb3VudCA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5SZXZlbnVlO1xuICAgIHByb2R1Y3RBY3Rpb24uU2hpcHBpbmdBbW91bnQgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuU2hpcHBpbmc7XG4gICAgcHJvZHVjdEFjdGlvbi5UYXhBbW91bnQgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuVGF4O1xufVxuXG5mdW5jdGlvbiBnZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKHByb2R1Y3RBY3Rpb25UeXBlKSB7XG4gICAgc3dpdGNoIChwcm9kdWN0QWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnQWRkVG9DYXJ0JztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5BZGRUb1dpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdBZGRUb1dpc2hsaXN0JztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dDpcbiAgICAgICAgICAgIHJldHVybiAnQ2hlY2tvdXQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0T3B0aW9uOlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dE9wdGlvbic7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ0NsaWNrJztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZTpcbiAgICAgICAgICAgIHJldHVybiAnUHVyY2hhc2UnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZDpcbiAgICAgICAgICAgIHJldHVybiAnUmVmdW5kJztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlRnJvbUNhcnQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlRnJvbVdpc2hsaXN0JztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5WaWV3RGV0YWlsOlxuICAgICAgICAgICAgcmV0dXJuICdWaWV3RGV0YWlsJztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5Vbmtub3duOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICdVbmtub3duJztcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldFByb21vdGlvbkFjdGlvbkV2ZW50TmFtZShwcm9tb3Rpb25BY3Rpb25UeXBlKSB7XG4gICAgc3dpdGNoIChwcm9tb3Rpb25BY3Rpb25UeXBlKSB7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnUHJvbW90aW9uQ2xpY2snO1xuICAgICAgICBjYXNlIFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uVmlldzpcbiAgICAgICAgICAgIHJldHVybiAnUHJvbW90aW9uVmlldyc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ1Vua25vd24nO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RBY3Rpb25Ub0V2ZW50VHlwZShwcm9kdWN0QWN0aW9uVHlwZSkge1xuICAgIHN3aXRjaCAocHJvZHVjdEFjdGlvblR5cGUpIHtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5BZGRUb0NhcnQ6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEFkZFRvQ2FydDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5BZGRUb1dpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RBZGRUb1dpc2hsaXN0O1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dE9wdGlvbjpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2hlY2tvdXRPcHRpb247XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENsaWNrO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RQdXJjaGFzZTtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZWZ1bmQ6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlZnVuZDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVtb3ZlRnJvbUNhcnQ7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbVdpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZW1vdmVGcm9tV2lzaGxpc3Q7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuVW5rbm93bjpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5FdmVudFR5cGUuVW5rbm93bjtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5WaWV3RGV0YWlsOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RWaWV3RGV0YWlsO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ291bGQgbm90IGNvbnZlcnQgcHJvZHVjdCBhY3Rpb24gdHlwZSAnICsgcHJvZHVjdEFjdGlvblR5cGUgKyAnIHRvIGV2ZW50IHR5cGUnKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFByb21vdGlvbkFjdGlvblRvRXZlbnRUeXBlKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICBzd2l0Y2ggKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb21vdGlvbkNsaWNrO1xuICAgICAgICBjYXNlIFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uVmlldzpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9tb3Rpb25WaWV3O1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ291bGQgbm90IGNvbnZlcnQgcHJvbW90aW9uIGFjdGlvbiB0eXBlICcgKyBwcm9tb3Rpb25BY3Rpb25UeXBlICsgJyB0byBldmVudCB0eXBlJyk7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlRXhwYW5kZWRFY29tbWVyY2VOYW1lKGV2ZW50TmFtZSwgcGx1c09uZSkge1xuICAgIHJldHVybiAnZUNvbW1lcmNlIC0gJyArIGV2ZW50TmFtZSArICcgLSAnICsgKHBsdXNPbmUgPyAnVG90YWwnIDogJ0l0ZW0nKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3QpIHtcbiAgICBpZiAocHJvZHVjdC5Db3Vwb25Db2RlKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0NvdXBvbiBDb2RlJ10gPSBwcm9kdWN0LkNvdXBvbkNvZGU7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LkJyYW5kKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0JyYW5kJ10gPSBwcm9kdWN0LkJyYW5kO1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5DYXRlZ29yeSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydDYXRlZ29yeSddID0gcHJvZHVjdC5DYXRlZ29yeTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuTmFtZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydOYW1lJ10gPSBwcm9kdWN0Lk5hbWU7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LlNrdSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydJZCddID0gcHJvZHVjdC5Ta3U7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LlByaWNlKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0l0ZW0gUHJpY2UnXSA9IHByb2R1Y3QuUHJpY2U7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LlF1YW50aXR5KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1F1YW50aXR5J10gPSBwcm9kdWN0LlF1YW50aXR5O1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5Qb3NpdGlvbikge1xuICAgICAgICBhdHRyaWJ1dGVzWydQb3NpdGlvbiddID0gcHJvZHVjdC5Qb3NpdGlvbjtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuVmFyaWFudCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydWYXJpYW50J10gPSBwcm9kdWN0LlZhcmlhbnQ7XG4gICAgfVxuICAgIGF0dHJpYnV0ZXNbJ1RvdGFsIFByb2R1Y3QgQW1vdW50J10gPSBwcm9kdWN0LlRvdGFsQW1vdW50IHx8IDA7XG5cbn1cblxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uSWQoYXR0cmlidXRlcywgcHJvZHVjdEFjdGlvbikge1xuICAgIGlmIChwcm9kdWN0QWN0aW9uLlRyYW5zYWN0aW9uSWQpIHtcbiAgICAgICAgYXR0cmlidXRlc1snVHJhbnNhY3Rpb24gSWQnXSA9IHByb2R1Y3RBY3Rpb24uVHJhbnNhY3Rpb25JZDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RBY3Rpb25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3RBY3Rpb24pIHtcbiAgICBleHRyYWN0VHJhbnNhY3Rpb25JZChhdHRyaWJ1dGVzLCBwcm9kdWN0QWN0aW9uKTtcblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLkFmZmlsaWF0aW9uKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0FmZmlsaWF0aW9uJ10gPSBwcm9kdWN0QWN0aW9uLkFmZmlsaWF0aW9uO1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLkNvdXBvbkNvZGUpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ291cG9uIENvZGUnXSA9IHByb2R1Y3RBY3Rpb24uQ291cG9uQ29kZTtcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5Ub3RhbEFtb3VudCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydUb3RhbCBBbW91bnQnXSA9IHByb2R1Y3RBY3Rpb24uVG90YWxBbW91bnQ7XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uU2hpcHBpbmdBbW91bnQpIHtcbiAgICAgICAgYXR0cmlidXRlc1snU2hpcHBpbmcgQW1vdW50J10gPSBwcm9kdWN0QWN0aW9uLlNoaXBwaW5nQW1vdW50O1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLlRheEFtb3VudCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydUYXggQW1vdW50J10gPSBwcm9kdWN0QWN0aW9uLlRheEFtb3VudDtcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5DaGVja291dE9wdGlvbnMpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ2hlY2tvdXQgT3B0aW9ucyddID0gcHJvZHVjdEFjdGlvbi5DaGVja291dE9wdGlvbnM7XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uQ2hlY2tvdXRTdGVwKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0NoZWNrb3V0IFN0ZXAnXSA9IHByb2R1Y3RBY3Rpb24uQ2hlY2tvdXRTdGVwO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZXh0cmFjdFByb21vdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvbW90aW9uKSB7XG4gICAgaWYgKHByb21vdGlvbi5JZCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydJZCddID0gcHJvbW90aW9uLklkO1xuICAgIH1cblxuICAgIGlmIChwcm9tb3Rpb24uQ3JlYXRpdmUpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ3JlYXRpdmUnXSA9IHByb21vdGlvbi5DcmVhdGl2ZTtcbiAgICB9XG5cbiAgICBpZiAocHJvbW90aW9uLk5hbWUpIHtcbiAgICAgICAgYXR0cmlidXRlc1snTmFtZSddID0gcHJvbW90aW9uLk5hbWU7XG4gICAgfVxuXG4gICAgaWYgKHByb21vdGlvbi5Qb3NpdGlvbikge1xuICAgICAgICBhdHRyaWJ1dGVzWydQb3NpdGlvbiddID0gcHJvbW90aW9uLlBvc2l0aW9uO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYnVpbGRQcm9kdWN0TGlzdChldmVudCwgcHJvZHVjdCkge1xuICAgIGlmIChwcm9kdWN0KSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHByb2R1Y3QpKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJvZHVjdDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbcHJvZHVjdF07XG4gICAgfVxuXG4gICAgcmV0dXJuIGV2ZW50LlNob3BwaW5nQ2FydC5Qcm9kdWN0TGlzdDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHJvZHVjdChuYW1lLFxuICAgIHNrdSxcbiAgICBwcmljZSxcbiAgICBxdWFudGl0eSxcbiAgICB2YXJpYW50LFxuICAgIGNhdGVnb3J5LFxuICAgIGJyYW5kLFxuICAgIHBvc2l0aW9uLFxuICAgIGNvdXBvbkNvZGUsXG4gICAgYXR0cmlidXRlcykge1xuXG4gICAgYXR0cmlidXRlcyA9IEhlbHBlcnMuc2FuaXRpemVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpO1xuXG4gICAgaWYgKHR5cGVvZiBuYW1lICE9PSAnc3RyaW5nJykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdOYW1lIGlzIHJlcXVpcmVkIHdoZW4gY3JlYXRpbmcgYSBwcm9kdWN0Jyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKHNrdSkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnU0tVIGlzIHJlcXVpcmVkIHdoZW4gY3JlYXRpbmcgYSBwcm9kdWN0LCBhbmQgbXVzdCBiZSBhIHN0cmluZyBvciBhIG51bWJlcicpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIVZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcihwcmljZSkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUHJpY2UgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhIHByb2R1Y3QsIGFuZCBtdXN0IGJlIGEgc3RyaW5nIG9yIGEgbnVtYmVyJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghcXVhbnRpdHkpIHtcbiAgICAgICAgcXVhbnRpdHkgPSAxO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIE5hbWU6IG5hbWUsXG4gICAgICAgIFNrdTogc2t1LFxuICAgICAgICBQcmljZTogcHJpY2UsXG4gICAgICAgIFF1YW50aXR5OiBxdWFudGl0eSxcbiAgICAgICAgQnJhbmQ6IGJyYW5kLFxuICAgICAgICBWYXJpYW50OiB2YXJpYW50LFxuICAgICAgICBDYXRlZ29yeTogY2F0ZWdvcnksXG4gICAgICAgIFBvc2l0aW9uOiBwb3NpdGlvbixcbiAgICAgICAgQ291cG9uQ29kZTogY291cG9uQ29kZSxcbiAgICAgICAgVG90YWxBbW91bnQ6IHF1YW50aXR5ICogcHJpY2UsXG4gICAgICAgIEF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXNcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9tb3Rpb24oaWQsIGNyZWF0aXZlLCBuYW1lLCBwb3NpdGlvbikge1xuICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKGlkKSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuUHJvbW90aW9uSWRSZXF1aXJlZCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIElkOiBpZCxcbiAgICAgICAgQ3JlYXRpdmU6IGNyZWF0aXZlLFxuICAgICAgICBOYW1lOiBuYW1lLFxuICAgICAgICBQb3NpdGlvbjogcG9zaXRpb25cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVJbXByZXNzaW9uKG5hbWUsIHByb2R1Y3QpIHtcbiAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ05hbWUgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhbiBpbXByZXNzaW9uLicpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIXByb2R1Y3QpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUHJvZHVjdCBpcyByZXF1aXJlZCB3aGVuIGNyZWF0aW5nIGFuIGltcHJlc3Npb24uJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIE5hbWU6IG5hbWUsXG4gICAgICAgIFByb2R1Y3Q6IHByb2R1Y3RcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXMoaWQsXG4gICAgYWZmaWxpYXRpb24sXG4gICAgY291cG9uQ29kZSxcbiAgICByZXZlbnVlLFxuICAgIHNoaXBwaW5nLFxuICAgIHRheCkge1xuXG4gICAgaWYgKCFWYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoaWQpKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5UcmFuc2FjdGlvbklkUmVxdWlyZWQpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBJZDogaWQsXG4gICAgICAgIEFmZmlsaWF0aW9uOiBhZmZpbGlhdGlvbixcbiAgICAgICAgQ291cG9uQ29kZTogY291cG9uQ29kZSxcbiAgICAgICAgUmV2ZW51ZTogcmV2ZW51ZSxcbiAgICAgICAgU2hpcHBpbmc6IHNoaXBwaW5nLFxuICAgICAgICBUYXg6IHRheFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFByb2R1Y3RJbXByZXNzaW9uKGNvbW1lcmNlRXZlbnQpIHtcbiAgICB2YXIgYXBwRXZlbnRzID0gW107XG4gICAgaWYgKCFjb21tZXJjZUV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucykge1xuICAgICAgICByZXR1cm4gYXBwRXZlbnRzO1xuICAgIH1cbiAgICBjb21tZXJjZUV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3RJbXByZXNzaW9uKSB7XG4gICAgICAgIGlmIChwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0TGlzdCkge1xuICAgICAgICAgICAgcHJvZHVjdEltcHJlc3Npb24uUHJvZHVjdExpc3QuZm9yRWFjaChmdW5jdGlvbihwcm9kdWN0KSB7XG4gICAgICAgICAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBIZWxwZXJzLmV4dGVuZChmYWxzZSwge30sIGNvbW1lcmNlRXZlbnQuRXZlbnRBdHRyaWJ1dGVzKTtcbiAgICAgICAgICAgICAgICBpZiAocHJvZHVjdC5BdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGF0dHJpYnV0ZSBpbiBwcm9kdWN0LkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlXSA9IHByb2R1Y3QuQXR0cmlidXRlc1thdHRyaWJ1dGVdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGV4dHJhY3RQcm9kdWN0QXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9kdWN0KTtcbiAgICAgICAgICAgICAgICBpZiAocHJvZHVjdEltcHJlc3Npb24uUHJvZHVjdEltcHJlc3Npb25MaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNbJ1Byb2R1Y3QgSW1wcmVzc2lvbiBMaXN0J10gPSBwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0SW1wcmVzc2lvbkxpc3Q7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBhcHBFdmVudCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGdlbmVyYXRlRXhwYW5kZWRFY29tbWVyY2VOYW1lKCdJbXByZXNzaW9uJyksXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgVHlwZXMuRXZlbnRUeXBlLlRyYW5zYWN0aW9uXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgYXBwRXZlbnRzLnB1c2goYXBwRXZlbnQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBFdmVudHM7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZENvbW1lcmNlRXZlbnQoZXZlbnQpIHtcbiAgICBpZiAoIWV2ZW50KSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gZXhwYW5kUHJvZHVjdEFjdGlvbihldmVudClcbiAgICAgICAgLmNvbmNhdChleHBhbmRQcm9tb3Rpb25BY3Rpb24oZXZlbnQpKVxuICAgICAgICAuY29uY2F0KGV4cGFuZFByb2R1Y3RJbXByZXNzaW9uKGV2ZW50KSk7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFByb21vdGlvbkFjdGlvbihjb21tZXJjZUV2ZW50KSB7XG4gICAgdmFyIGFwcEV2ZW50cyA9IFtdO1xuICAgIGlmICghY29tbWVyY2VFdmVudC5Qcm9tb3Rpb25BY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIGFwcEV2ZW50cztcbiAgICB9XG4gICAgdmFyIHByb21vdGlvbnMgPSBjb21tZXJjZUV2ZW50LlByb21vdGlvbkFjdGlvbi5Qcm9tb3Rpb25MaXN0O1xuICAgIHByb21vdGlvbnMuZm9yRWFjaChmdW5jdGlvbihwcm9tb3Rpb24pIHtcbiAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBIZWxwZXJzLmV4dGVuZChmYWxzZSwge30sIGNvbW1lcmNlRXZlbnQuRXZlbnRBdHRyaWJ1dGVzKTtcbiAgICAgICAgZXh0cmFjdFByb21vdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvbW90aW9uKTtcblxuICAgICAgICB2YXIgYXBwRXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lKGNvbW1lcmNlRXZlbnQuUHJvbW90aW9uQWN0aW9uLlByb21vdGlvbkFjdGlvblR5cGUpKSxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5UcmFuc2FjdGlvblxuICAgICAgICAgICAgKTtcbiAgICAgICAgYXBwRXZlbnRzLnB1c2goYXBwRXZlbnQpO1xuICAgIH0pO1xuICAgIHJldHVybiBhcHBFdmVudHM7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFByb2R1Y3RBY3Rpb24oY29tbWVyY2VFdmVudCkge1xuICAgIHZhciBhcHBFdmVudHMgPSBbXTtcbiAgICBpZiAoIWNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbikge1xuICAgICAgICByZXR1cm4gYXBwRXZlbnRzO1xuICAgIH1cbiAgICB2YXIgc2hvdWxkRXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMgPSBmYWxzZTtcbiAgICBpZiAoY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RBY3Rpb25UeXBlID09PSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZSB8fFxuICAgICAgICBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUgPT09IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZCkge1xuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCB7fSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMpO1xuICAgICAgICBhdHRyaWJ1dGVzWydQcm9kdWN0IENvdW50J10gPSBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3QgPyBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3QubGVuZ3RoIDogMDtcbiAgICAgICAgZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uKTtcbiAgICAgICAgaWYgKGNvbW1lcmNlRXZlbnQuQ3VycmVuY3lDb2RlKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzWydDdXJyZW5jeSBDb2RlJ10gPSBjb21tZXJjZUV2ZW50LkN1cnJlbmN5Q29kZTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGx1c09uZUV2ZW50ID0gU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QoVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50LFxuICAgICAgICAgICAgZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuZ2V0RXhwYW5zaW9uTmFtZShjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUpLCB0cnVlKSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBUeXBlcy5FdmVudFR5cGUuVHJhbnNhY3Rpb25cbiAgICAgICAgKTtcbiAgICAgICAgYXBwRXZlbnRzLnB1c2gocGx1c09uZUV2ZW50KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHNob3VsZEV4dHJhY3RBY3Rpb25BdHRyaWJ1dGVzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgcHJvZHVjdHMgPSBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3Q7XG5cbiAgICBpZiAoIXByb2R1Y3RzKSB7XG4gICAgICAgIHJldHVybiBhcHBFdmVudHM7XG4gICAgfVxuXG4gICAgcHJvZHVjdHMuZm9yRWFjaChmdW5jdGlvbihwcm9kdWN0KSB7XG4gICAgICAgIHZhciBhdHRyaWJ1dGVzID0gSGVscGVycy5leHRlbmQoZmFsc2UsIGNvbW1lcmNlRXZlbnQuRXZlbnRBdHRyaWJ1dGVzLCBwcm9kdWN0LkF0dHJpYnV0ZXMpO1xuICAgICAgICBpZiAoc2hvdWxkRXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGV4dHJhY3RBY3Rpb25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbik7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBleHRyYWN0VHJhbnNhY3Rpb25JZChhdHRyaWJ1dGVzLCBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24pO1xuICAgICAgICB9XG4gICAgICAgIGV4dHJhY3RQcm9kdWN0QXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9kdWN0KTtcblxuICAgICAgICB2YXIgcHJvZHVjdEV2ZW50ID0gU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QoVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50LFxuICAgICAgICAgICAgZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuZ2V0RXhwYW5zaW9uTmFtZShjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUpKSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBUeXBlcy5FdmVudFR5cGUuVHJhbnNhY3Rpb25cbiAgICAgICAgKTtcbiAgICAgICAgYXBwRXZlbnRzLnB1c2gocHJvZHVjdEV2ZW50KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBFdmVudHM7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3QoY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgYmFzZUV2ZW50O1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTG9nQ29tbWVyY2VFdmVudCk7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBiYXNlRXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5Db21tZXJjZSk7XG4gICAgICAgIGJhc2VFdmVudC5FdmVudE5hbWUgPSAnZUNvbW1lcmNlIC0gJztcbiAgICAgICAgYmFzZUV2ZW50LkN1cnJlbmN5Q29kZSA9IE1QLmN1cnJlbmN5Q29kZTtcbiAgICAgICAgYmFzZUV2ZW50LlNob3BwaW5nQ2FydCA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RMaXN0OiBNUC5jYXJ0UHJvZHVjdHNcbiAgICAgICAgfTtcbiAgICAgICAgYmFzZUV2ZW50LkN1c3RvbUZsYWdzID0gY3VzdG9tRmxhZ3M7XG5cbiAgICAgICAgcmV0dXJuIGJhc2VFdmVudDtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uOiBjb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uLFxuICAgIGdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWU6IGdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUsXG4gICAgZ2V0UHJvbW90aW9uQWN0aW9uRXZlbnROYW1lOiBnZXRQcm9tb3Rpb25BY3Rpb25FdmVudE5hbWUsXG4gICAgY29udmVydFByb2R1Y3RBY3Rpb25Ub0V2ZW50VHlwZTogY29udmVydFByb2R1Y3RBY3Rpb25Ub0V2ZW50VHlwZSxcbiAgICBjb252ZXJ0UHJvbW90aW9uQWN0aW9uVG9FdmVudFR5cGU6IGNvbnZlcnRQcm9tb3Rpb25BY3Rpb25Ub0V2ZW50VHlwZSxcbiAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZTogZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUsXG4gICAgZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzOiBleHRyYWN0UHJvZHVjdEF0dHJpYnV0ZXMsXG4gICAgZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXM6IGV4dHJhY3RBY3Rpb25BdHRyaWJ1dGVzLFxuICAgIGV4dHJhY3RQcm9tb3Rpb25BdHRyaWJ1dGVzOiBleHRyYWN0UHJvbW90aW9uQXR0cmlidXRlcyxcbiAgICBleHRyYWN0VHJhbnNhY3Rpb25JZDogZXh0cmFjdFRyYW5zYWN0aW9uSWQsXG4gICAgYnVpbGRQcm9kdWN0TGlzdDogYnVpbGRQcm9kdWN0TGlzdCxcbiAgICBjcmVhdGVQcm9kdWN0OiBjcmVhdGVQcm9kdWN0LFxuICAgIGNyZWF0ZVByb21vdGlvbjogY3JlYXRlUHJvbW90aW9uLFxuICAgIGNyZWF0ZUltcHJlc3Npb246IGNyZWF0ZUltcHJlc3Npb24sXG4gICAgY3JlYXRlVHJhbnNhY3Rpb25BdHRyaWJ1dGVzOiBjcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXMsXG4gICAgZXhwYW5kQ29tbWVyY2VFdmVudDogZXhwYW5kQ29tbWVyY2VFdmVudCxcbiAgICBjcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0OiBjcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0XG59O1xuIiwidmFyIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIEVjb21tZXJjZSA9IHJlcXVpcmUoJy4vZWNvbW1lcmNlJyksXG4gICAgU2VydmVyTW9kZWwgPSByZXF1aXJlKCcuL3NlcnZlck1vZGVsJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgc2VuZEV2ZW50VG9TZXJ2ZXIgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLnNlbmRFdmVudFRvU2VydmVyLFxuICAgIHNlbmRFdmVudFRvRm9yd2FyZGVycyA9IHJlcXVpcmUoJy4vZm9yd2FyZGVycycpLnNlbmRFdmVudFRvRm9yd2FyZGVycztcblxuZnVuY3Rpb24gbG9nRXZlbnQodHlwZSwgbmFtZSwgZGF0YSwgY2F0ZWdvcnksIGNmbGFncykge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0xvZ0V2ZW50ICsgJzogJyArIG5hbWUpO1xuXG4gICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgc3RhcnROZXdTZXNzaW9uSWZOZWVkZWQoKTtcblxuICAgICAgICBpZiAoZGF0YSkge1xuICAgICAgICAgICAgZGF0YSA9IEhlbHBlcnMuc2FuaXRpemVBdHRyaWJ1dGVzKGRhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VuZEV2ZW50VG9TZXJ2ZXIoU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QodHlwZSwgbmFtZSwgZGF0YSwgY2F0ZWdvcnksIGNmbGFncyksIHNlbmRFdmVudFRvRm9yd2FyZGVycywgcGFyc2VFdmVudFJlc3BvbnNlKTtcbiAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvbkxvZ0V2ZW50KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXZlbnRSZXNwb25zZShyZXNwb25zZVRleHQpIHtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKSxcbiAgICAgICAgc2V0dGluZ3MsXG4gICAgICAgIHByb3AsXG4gICAgICAgIGZ1bGxQcm9wO1xuXG4gICAgaWYgKCFyZXNwb25zZVRleHQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1BhcnNpbmcgcmVzcG9uc2UgZnJvbSBzZXJ2ZXInKTtcbiAgICAgICAgc2V0dGluZ3MgPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCk7XG5cbiAgICAgICAgaWYgKHNldHRpbmdzICYmIHNldHRpbmdzLlN0b3JlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQYXJzZWQgc3RvcmUgZnJvbSByZXNwb25zZSwgdXBkYXRpbmcgbG9jYWwgc2V0dGluZ3MnKTtcblxuICAgICAgICAgICAgaWYgKCFNUC5zZXJ2ZXJTZXR0aW5ncykge1xuICAgICAgICAgICAgICAgIE1QLnNlcnZlclNldHRpbmdzID0ge307XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAocHJvcCBpbiBzZXR0aW5ncy5TdG9yZSkge1xuICAgICAgICAgICAgICAgIGlmICghc2V0dGluZ3MuU3RvcmUuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZnVsbFByb3AgPSBzZXR0aW5ncy5TdG9yZVtwcm9wXTtcblxuICAgICAgICAgICAgICAgIGlmICghZnVsbFByb3AuVmFsdWUgfHwgbmV3IERhdGUoZnVsbFByb3AuRXhwaXJlcykgPCBub3cpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhpcyBzZXR0aW5nIHNob3VsZCBiZSBkZWxldGVkIGZyb20gdGhlIGxvY2FsIHN0b3JlIGlmIGl0IGV4aXN0c1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChNUC5zZXJ2ZXJTZXR0aW5ncy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIE1QLnNlcnZlclNldHRpbmdzW3Byb3BdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIGlzIGEgdmFsaWQgc2V0dGluZ1xuICAgICAgICAgICAgICAgICAgICBNUC5zZXJ2ZXJTZXR0aW5nc1twcm9wXSA9IGZ1bGxQcm9wO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgcGFyc2luZyBKU09OIHJlc3BvbnNlIGZyb20gc2VydmVyOiAnICsgZS5uYW1lKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN0YXJ0VHJhY2tpbmcoKSB7XG4gICAgaWYgKCFNUC5pc1RyYWNraW5nKSB7XG4gICAgICAgIGlmICgnZ2VvbG9jYXRpb24nIGluIG5hdmlnYXRvcikge1xuICAgICAgICAgICAgTVAud2F0Y2hQb3NpdGlvbklkID0gbmF2aWdhdG9yLmdlb2xvY2F0aW9uLndhdGNoUG9zaXRpb24oZnVuY3Rpb24ocG9zaXRpb24pIHtcbiAgICAgICAgICAgICAgICBNUC5jdXJyZW50UG9zaXRpb24gPSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdDogcG9zaXRpb24uY29vcmRzLmxhdGl0dWRlLFxuICAgICAgICAgICAgICAgICAgICBsbmc6IHBvc2l0aW9uLmNvb3Jkcy5sb25naXR1ZGVcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIE1QLmlzVHJhY2tpbmcgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdG9wVHJhY2tpbmcoKSB7XG4gICAgaWYgKE1QLmlzVHJhY2tpbmcpIHtcbiAgICAgICAgbmF2aWdhdG9yLmdlb2xvY2F0aW9uLmNsZWFyV2F0Y2goTVAud2F0Y2hQb3NpdGlvbklkKTtcbiAgICAgICAgTVAuY3VycmVudFBvc2l0aW9uID0gbnVsbDtcbiAgICAgICAgTVAuaXNUcmFja2luZyA9IGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nT3B0T3V0KCkge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0xvZ09wdE91dCk7XG5cbiAgICBzZW5kRXZlbnRUb1NlcnZlcihTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5PcHRPdXQsIG51bGwsIG51bGwsIFR5cGVzLkV2ZW50VHlwZS5PdGhlciksIHNlbmRFdmVudFRvRm9yd2FyZGVycywgcGFyc2VFdmVudFJlc3BvbnNlKTtcbn1cblxuZnVuY3Rpb24gbG9nQVNUKCkge1xuICAgIGxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLkFwcFN0YXRlVHJhbnNpdGlvbik7XG59XG5cbmZ1bmN0aW9uIGxvZ0NoZWNrb3V0RXZlbnQoc3RlcCwgb3B0aW9ucywgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgdmFyIGV2ZW50ID0gRWNvbW1lcmNlLmNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3QoY3VzdG9tRmxhZ3MpO1xuXG4gICAgaWYgKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LkV2ZW50TmFtZSArPSBFY29tbWVyY2UuZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dCk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2hlY2tvdXQ7XG4gICAgICAgIGV2ZW50LlByb2R1Y3RBY3Rpb24gPSB7XG4gICAgICAgICAgICBQcm9kdWN0QWN0aW9uVHlwZTogVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQsXG4gICAgICAgICAgICBDaGVja291dFN0ZXA6IHN0ZXAsXG4gICAgICAgICAgICBDaGVja291dE9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgICAgICBQcm9kdWN0TGlzdDogZXZlbnQuU2hvcHBpbmdDYXJ0LlByb2R1Y3RMaXN0XG4gICAgICAgIH07XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUHJvZHVjdEFjdGlvbkV2ZW50KHByb2R1Y3RBY3Rpb25UeXBlLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IEVjb21tZXJjZS5jb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlKHByb2R1Y3RBY3Rpb25UeXBlKTtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKHByb2R1Y3RBY3Rpb25UeXBlKTtcbiAgICAgICAgZXZlbnQuUHJvZHVjdEFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBwcm9kdWN0QWN0aW9uVHlwZSxcbiAgICAgICAgICAgIFByb2R1Y3RMaXN0OiBBcnJheS5pc0FycmF5KHByb2R1Y3QpID8gcHJvZHVjdCA6IFtwcm9kdWN0XVxuICAgICAgICB9O1xuXG4gICAgICAgIGxvZ0NvbW1lcmNlRXZlbnQoZXZlbnQsIGF0dHJzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxvZ1B1cmNoYXNlRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlKTtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RQdXJjaGFzZTtcbiAgICAgICAgZXZlbnQuUHJvZHVjdEFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZVxuICAgICAgICB9O1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RMaXN0ID0gRWNvbW1lcmNlLmJ1aWxkUHJvZHVjdExpc3QoZXZlbnQsIHByb2R1Y3QpO1xuXG4gICAgICAgIEVjb21tZXJjZS5jb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uKHRyYW5zYWN0aW9uQXR0cmlidXRlcywgZXZlbnQuUHJvZHVjdEFjdGlvbik7XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUmVmdW5kRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICBpZiAoIXRyYW5zYWN0aW9uQXR0cmlidXRlcykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuVHJhbnNhY3Rpb25SZXF1aXJlZCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZCk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVmdW5kO1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uID0ge1xuICAgICAgICAgICAgUHJvZHVjdEFjdGlvblR5cGU6IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZFxuICAgICAgICB9O1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RMaXN0ID0gRWNvbW1lcmNlLmJ1aWxkUHJvZHVjdExpc3QoZXZlbnQsIHByb2R1Y3QpO1xuXG4gICAgICAgIEVjb21tZXJjZS5jb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uKHRyYW5zYWN0aW9uQXR0cmlidXRlcywgZXZlbnQuUHJvZHVjdEFjdGlvbik7XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUHJvbW90aW9uRXZlbnQocHJvbW90aW9uVHlwZSwgcHJvbW90aW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9tb3Rpb25BY3Rpb25FdmVudE5hbWUocHJvbW90aW9uVHlwZSk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBFY29tbWVyY2UuY29udmVydFByb21vdGlvbkFjdGlvblRvRXZlbnRUeXBlKHByb21vdGlvblR5cGUpO1xuICAgICAgICBldmVudC5Qcm9tb3Rpb25BY3Rpb24gPSB7XG4gICAgICAgICAgICBQcm9tb3Rpb25BY3Rpb25UeXBlOiBwcm9tb3Rpb25UeXBlLFxuICAgICAgICAgICAgUHJvbW90aW9uTGlzdDogW3Byb21vdGlvbl1cbiAgICAgICAgfTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dJbXByZXNzaW9uRXZlbnQoaW1wcmVzc2lvbiwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgdmFyIGV2ZW50ID0gRWNvbW1lcmNlLmNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3QoY3VzdG9tRmxhZ3MpO1xuXG4gICAgaWYgKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LkV2ZW50TmFtZSArPSAnSW1wcmVzc2lvbic7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0SW1wcmVzc2lvbjtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGltcHJlc3Npb24pKSB7XG4gICAgICAgICAgICBpbXByZXNzaW9uID0gW2ltcHJlc3Npb25dO1xuICAgICAgICB9XG5cbiAgICAgICAgZXZlbnQuUHJvZHVjdEltcHJlc3Npb25zID0gW107XG5cbiAgICAgICAgaW1wcmVzc2lvbi5mb3JFYWNoKGZ1bmN0aW9uKGltcHJlc3Npb24pIHtcbiAgICAgICAgICAgIGV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICBQcm9kdWN0SW1wcmVzc2lvbkxpc3Q6IGltcHJlc3Npb24uTmFtZSxcbiAgICAgICAgICAgICAgICBQcm9kdWN0TGlzdDogQXJyYXkuaXNBcnJheShpbXByZXNzaW9uLlByb2R1Y3QpID8gaW1wcmVzc2lvbi5Qcm9kdWN0IDogW2ltcHJlc3Npb24uUHJvZHVjdF1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5cbmZ1bmN0aW9uIGxvZ0NvbW1lcmNlRXZlbnQoY29tbWVyY2VFdmVudCwgYXR0cnMpIHtcbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50KTtcblxuICAgIGF0dHJzID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cnMpO1xuXG4gICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgc3RhcnROZXdTZXNzaW9uSWZOZWVkZWQoKTtcbiAgICAgICAgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICAvLyBEb24ndCBzZW5kIHNob3BwaW5nIGNhcnQgdG8gcGFyZW50IHNka3NcbiAgICAgICAgICAgIGNvbW1lcmNlRXZlbnQuU2hvcHBpbmdDYXJ0ID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXR0cnMpIHtcbiAgICAgICAgICAgIGNvbW1lcmNlRXZlbnQuRXZlbnRBdHRyaWJ1dGVzID0gYXR0cnM7XG4gICAgICAgIH1cblxuICAgICAgICBzZW5kRXZlbnRUb1NlcnZlcihjb21tZXJjZUV2ZW50LCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSk7XG4gICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGRFdmVudEhhbmRsZXIoZG9tRXZlbnQsIHNlbGVjdG9yLCBldmVudE5hbWUsIGRhdGEsIGV2ZW50VHlwZSkge1xuICAgIHZhciBlbGVtZW50cyA9IFtdLFxuICAgICAgICBoYW5kbGVyID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgdmFyIHRpbWVvdXRIYW5kbGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQuaHJlZikge1xuICAgICAgICAgICAgICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9IGVsZW1lbnQuaHJlZjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZWxlbWVudC5zdWJtaXQpIHtcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudC5zdWJtaXQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdET00gZXZlbnQgdHJpZ2dlcmVkLCBoYW5kbGluZyBldmVudCcpO1xuXG4gICAgICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICAgICAgdHlwZW9mIGV2ZW50TmFtZSA9PT0gJ2Z1bmN0aW9uJyA/IGV2ZW50TmFtZShlbGVtZW50KSA6IGV2ZW50TmFtZSxcbiAgICAgICAgICAgICAgICB0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJyA/IGRhdGEoZWxlbWVudCkgOiBkYXRhLFxuICAgICAgICAgICAgICAgIGV2ZW50VHlwZSB8fCBUeXBlcy5FdmVudFR5cGUuT3RoZXIpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBIYW5kbGUgbWlkZGxlLWNsaWNrcyBhbmQgc3BlY2lhbCBrZXlzIChjdHJsLCBhbHQsIGV0YylcbiAgICAgICAgICAgIGlmICgoZWxlbWVudC5ocmVmICYmIGVsZW1lbnQudGFyZ2V0ICE9PSAnX2JsYW5rJykgfHwgZWxlbWVudC5zdWJtaXQpIHtcbiAgICAgICAgICAgICAgICAvLyBHaXZlIHhtbGh0dHByZXF1ZXN0IGVub3VnaCB0aW1lIHRvIGV4ZWN1dGUgYmVmb3JlIG5hdmlnYXRpbmcgYSBsaW5rIG9yIHN1Ym1pdHRpbmcgZm9ybVxuXG4gICAgICAgICAgICAgICAgaWYgKGUucHJldmVudERlZmF1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZS5yZXR1cm5WYWx1ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQodGltZW91dEhhbmRsZXIsIE1QLkNvbmZpZy5UaW1lb3V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZWxlbWVudCxcbiAgICAgICAgaTtcblxuICAgIGlmICghc2VsZWN0b3IpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ2FuXFwndCBiaW5kIGV2ZW50LCBzZWxlY3RvciBpcyByZXF1aXJlZCcpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGEgY3NzIHNlbGVjdG9yIHN0cmluZyBvciBhIGRvbSBlbGVtZW50XG4gICAgaWYgKHR5cGVvZiBzZWxlY3RvciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZWxlbWVudHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcbiAgICB9XG4gICAgZWxzZSBpZiAoc2VsZWN0b3Iubm9kZVR5cGUpIHtcbiAgICAgICAgZWxlbWVudHMgPSBbc2VsZWN0b3JdO1xuICAgIH1cblxuICAgIGlmIChlbGVtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRm91bmQgJyArXG4gICAgICAgICAgICBlbGVtZW50cy5sZW5ndGggK1xuICAgICAgICAgICAgJyBlbGVtZW50JyArXG4gICAgICAgICAgICAoZWxlbWVudHMubGVuZ3RoID4gMSA/ICdzJyA6ICcnKSArXG4gICAgICAgICAgICAnLCBhdHRhY2hpbmcgZXZlbnQgaGFuZGxlcnMnKTtcblxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGVsZW1lbnQgPSBlbGVtZW50c1tpXTtcblxuICAgICAgICAgICAgaWYgKGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcikge1xuICAgICAgICAgICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihkb21FdmVudCwgaGFuZGxlciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZWxlbWVudC5hdHRhY2hFdmVudCkge1xuICAgICAgICAgICAgICAgIGVsZW1lbnQuYXR0YWNoRXZlbnQoJ29uJyArIGRvbUV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGVsZW1lbnRbJ29uJyArIGRvbUV2ZW50XSA9IGhhbmRsZXI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ05vIGVsZW1lbnRzIGZvdW5kJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZCgpIHtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgaWYgKCFNUC5zZXNzaW9uSWQgJiYgY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuc2lkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gY29va2llcy5zaWQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nRXZlbnQ6IGxvZ0V2ZW50LFxuICAgIHN0YXJ0VHJhY2tpbmc6IHN0YXJ0VHJhY2tpbmcsXG4gICAgc3RvcFRyYWNraW5nOiBzdG9wVHJhY2tpbmcsXG4gICAgbG9nQ2hlY2tvdXRFdmVudDogbG9nQ2hlY2tvdXRFdmVudCxcbiAgICBsb2dQcm9kdWN0QWN0aW9uRXZlbnQ6IGxvZ1Byb2R1Y3RBY3Rpb25FdmVudCxcbiAgICBsb2dQdXJjaGFzZUV2ZW50OiBsb2dQdXJjaGFzZUV2ZW50LFxuICAgIGxvZ1JlZnVuZEV2ZW50OiBsb2dSZWZ1bmRFdmVudCxcbiAgICBsb2dQcm9tb3Rpb25FdmVudDogbG9nUHJvbW90aW9uRXZlbnQsXG4gICAgbG9nSW1wcmVzc2lvbkV2ZW50OiBsb2dJbXByZXNzaW9uRXZlbnQsXG4gICAgbG9nT3B0T3V0OiBsb2dPcHRPdXQsXG4gICAgbG9nQVNUOiBsb2dBU1QsXG4gICAgcGFyc2VFdmVudFJlc3BvbnNlOiBwYXJzZUV2ZW50UmVzcG9uc2UsXG4gICAgbG9nQ29tbWVyY2VFdmVudDogbG9nQ29tbWVyY2VFdmVudCxcbiAgICBhZGRFdmVudEhhbmRsZXI6IGFkZEV2ZW50SGFuZGxlcixcbiAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZDogc3RhcnROZXdTZXNzaW9uSWZOZWVkZWRcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgTVBhcnRpY2xlVXNlciA9IHJlcXVpcmUoJy4vbVBhcnRpY2xlVXNlcicpLFxuICAgIEFwaUNsaWVudCA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50JyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyk7XG5cbmZ1bmN0aW9uIGluaXRGb3J3YXJkZXJzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgdmFyIHVzZXIgPSBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKTtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkICYmIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzKSB7XG4gICAgICAgIC8vIFNvbWUganMgbGlicmFyaWVzIHJlcXVpcmUgdGhhdCB0aGV5IGJlIGxvYWRlZCBmaXJzdCwgb3IgbGFzdCwgZXRjXG4gICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzLnNvcnQoZnVuY3Rpb24oeCwgeSkge1xuICAgICAgICAgICAgeC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlID0geC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlIHx8IDA7XG4gICAgICAgICAgICB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgPSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgfHwgMDtcbiAgICAgICAgICAgIHJldHVybiAtMSAqICh4LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgLSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzID0gTVAuY29uZmlndXJlZEZvcndhcmRlcnMuZmlsdGVyKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKCFpc0VuYWJsZWRGb3JVc2VyQ29uc2VudChmb3J3YXJkZXIuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXMsIHVzZXIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlcyhmb3J3YXJkZXIuZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlLCB1c2VyKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghaXNFbmFibGVkRm9yVW5rbm93blVzZXIoZm9yd2FyZGVyLmV4Y2x1ZGVBbm9ueW1vdXNVc2VyLCB1c2VyKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGZpbHRlcmVkVXNlcklkZW50aXRpZXMgPSBIZWxwZXJzLmZpbHRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzLCBmb3J3YXJkZXIudXNlcklkZW50aXR5RmlsdGVycyk7XG4gICAgICAgICAgICB2YXIgZmlsdGVyZWRVc2VyQXR0cmlidXRlcyA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXMoTVAudXNlckF0dHJpYnV0ZXMsIGZvcndhcmRlci51c2VyQXR0cmlidXRlRmlsdGVycyk7XG5cbiAgICAgICAgICAgIGlmICghZm9yd2FyZGVyLmluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLmluaXQoZm9yd2FyZGVyLnNldHRpbmdzLFxuICAgICAgICAgICAgICAgICAgICBwcmVwYXJlRm9yd2FyZGluZ1N0YXRzLFxuICAgICAgICAgICAgICAgICAgICBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VyQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllcyxcbiAgICAgICAgICAgICAgICAgICAgTVAuYXBwVmVyc2lvbixcbiAgICAgICAgICAgICAgICAgICAgTVAuYXBwTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgTVAuY3VzdG9tRmxhZ3MsXG4gICAgICAgICAgICAgICAgICAgIE1QLmNsaWVudElkKTtcbiAgICAgICAgICAgICAgICBmb3J3YXJkZXIuaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBpc0VuYWJsZWRGb3JVc2VyQ29uc2VudChjb25zZW50UnVsZXMsIHVzZXIpIHtcbiAgICBpZiAoIWNvbnNlbnRSdWxlc1xuICAgICAgICB8fCAhY29uc2VudFJ1bGVzLnZhbHVlc1xuICAgICAgICB8fCAhY29uc2VudFJ1bGVzLnZhbHVlcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGlmICghdXNlcikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHZhciBwdXJwb3NlSGFzaGVzID0ge307XG4gICAgdmFyIEdEUFJDb25zZW50SGFzaFByZWZpeCA9ICcxJztcbiAgICB2YXIgY29uc2VudFN0YXRlID0gdXNlci5nZXRDb25zZW50U3RhdGUoKTtcbiAgICBpZiAoY29uc2VudFN0YXRlKSB7XG4gICAgICAgIHZhciBnZHByQ29uc2VudFN0YXRlID0gY29uc2VudFN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKTtcbiAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4gZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICAgICAgICAgIGlmIChnZHByQ29uc2VudFN0YXRlLmhhc093blByb3BlcnR5KHB1cnBvc2UpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwdXJwb3NlSGFzaCA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKEdEUFJDb25zZW50SGFzaFByZWZpeCArIHB1cnBvc2UpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgIHB1cnBvc2VIYXNoZXNbcHVycG9zZUhhc2hdID0gZ2RwckNvbnNlbnRTdGF0ZVtwdXJwb3NlXS5Db25zZW50ZWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHZhciBpc01hdGNoID0gZmFsc2U7XG4gICAgY29uc2VudFJ1bGVzLnZhbHVlcy5mb3JFYWNoKGZ1bmN0aW9uKGNvbnNlbnRSdWxlKSB7XG4gICAgICAgIGlmICghaXNNYXRjaCkge1xuICAgICAgICAgICAgdmFyIHB1cnBvc2VIYXNoID0gY29uc2VudFJ1bGUuY29uc2VudFB1cnBvc2U7XG4gICAgICAgICAgICB2YXIgaGFzQ29uc2VudGVkID0gY29uc2VudFJ1bGUuaGFzQ29uc2VudGVkO1xuICAgICAgICAgICAgaWYgKHB1cnBvc2VIYXNoZXMuaGFzT3duUHJvcGVydHkocHVycG9zZUhhc2gpXG4gICAgICAgICAgICAgICAgJiYgcHVycG9zZUhhc2hlc1twdXJwb3NlSGFzaF0gPT09IGhhc0NvbnNlbnRlZCkge1xuICAgICAgICAgICAgICAgIGlzTWF0Y2ggPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29uc2VudFJ1bGVzLmluY2x1ZGVPbk1hdGNoID09PSBpc01hdGNoO1xufVxuXG5mdW5jdGlvbiBpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlcyhmaWx0ZXJPYmplY3QsIHVzZXIpIHtcbiAgICBpZiAoIWZpbHRlck9iamVjdCB8fFxuICAgICAgICAhSGVscGVycy5pc09iamVjdChmaWx0ZXJPYmplY3QpIHx8XG4gICAgICAgICFPYmplY3Qua2V5cyhmaWx0ZXJPYmplY3QpLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgYXR0ckhhc2gsXG4gICAgICAgIHZhbHVlSGFzaCxcbiAgICAgICAgdXNlckF0dHJpYnV0ZXM7XG5cbiAgICBpZiAoIXVzZXIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdXNlci5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuICAgIH1cblxuICAgIHZhciBpc01hdGNoID0gZmFsc2U7XG5cbiAgICB0cnkge1xuICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMgJiYgSGVscGVycy5pc09iamVjdCh1c2VyQXR0cmlidXRlcykgJiYgT2JqZWN0LmtleXModXNlckF0dHJpYnV0ZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgZm9yICh2YXIgYXR0ck5hbWUgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoYXR0ck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJIYXNoID0gSGVscGVycy5nZW5lcmF0ZUhhc2goYXR0ck5hbWUpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlSGFzaCA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKHVzZXJBdHRyaWJ1dGVzW2F0dHJOYW1lXSkudG9TdHJpbmcoKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoKGF0dHJIYXNoID09PSBmaWx0ZXJPYmplY3QudXNlckF0dHJpYnV0ZU5hbWUpICYmICh2YWx1ZUhhc2ggPT09IGZpbHRlck9iamVjdC51c2VyQXR0cmlidXRlVmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpc01hdGNoID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZpbHRlck9iamVjdCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbHRlck9iamVjdC5pbmNsdWRlT25NYXRjaCA9PT0gaXNNYXRjaDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBpbiBhbnkgZXJyb3Igc2NlbmFyaW8sIGVyciBvbiBzaWRlIG9mIHJldHVybmluZyB0cnVlIGFuZCBmb3J3YXJkaW5nIGV2ZW50XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gaXNFbmFibGVkRm9yVW5rbm93blVzZXIoZXhjbHVkZUFub255bW91c1VzZXJCb29sZWFuLCB1c2VyKSB7XG4gICAgaWYgKCF1c2VyIHx8ICF1c2VyLmlzTG9nZ2VkSW4oKSkge1xuICAgICAgICBpZiAoZXhjbHVkZUFub255bW91c1VzZXJCb29sZWFuKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGFwcGx5VG9Gb3J3YXJkZXJzKGZ1bmN0aW9uTmFtZSwgZnVuY3Rpb25BcmdzKSB7XG4gICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnMubGVuZ3RoKSB7XG4gICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgICAgIHZhciBmb3J3YXJkZXJGdW5jdGlvbiA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdO1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlckZ1bmN0aW9uKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdKGZ1bmN0aW9uQXJncyk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRFdmVudFRvRm9yd2FyZGVycyhldmVudCkge1xuICAgIHZhciBjbG9uZWRFdmVudCxcbiAgICAgICAgaGFzaGVkRXZlbnROYW1lLFxuICAgICAgICBoYXNoZWRFdmVudFR5cGUsXG4gICAgICAgIGZpbHRlclVzZXJJZGVudGl0aWVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5Vc2VySWRlbnRpdGllcyAmJiBldmVudC5Vc2VySWRlbnRpdGllcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBldmVudC5Vc2VySWRlbnRpdGllcy5mb3JFYWNoKGZ1bmN0aW9uKHVzZXJJZGVudGl0eSwgaSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5pbkFycmF5KGZpbHRlckxpc3QsIHVzZXJJZGVudGl0eS5UeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMuc3BsaWNlKGksIDEpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpLS07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBmaWx0ZXJBdHRyaWJ1dGVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIHZhciBoYXNoO1xuXG4gICAgICAgICAgICBpZiAoIWZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAodmFyIGF0dHJOYW1lIGluIGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmIChldmVudC5FdmVudEF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoYXR0ck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGhhc2ggPSBIZWxwZXJzLmdlbmVyYXRlSGFzaChldmVudC5FdmVudENhdGVnb3J5ICsgZXZlbnQuRXZlbnROYW1lICsgYXR0ck5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmluQXJyYXkoZmlsdGVyTGlzdCwgaGFzaCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBldmVudC5FdmVudEF0dHJpYnV0ZXNbYXR0ck5hbWVdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbkZpbHRlcmVkTGlzdCA9IGZ1bmN0aW9uKGZpbHRlckxpc3QsIGhhc2gpIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJMaXN0ICYmIGZpbHRlckxpc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaW5BcnJheShmaWx0ZXJMaXN0LCBoYXNoKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSxcbiAgICAgICAgZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMgPSBbXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldyxcbiAgICAgICAgICAgIFR5cGVzLk1lc3NhZ2VUeXBlLkNvbW1lcmNlXG4gICAgICAgIF07XG5cbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkICYmIE1QLmFjdGl2ZUZvcndhcmRlcnMpIHtcbiAgICAgICAgaGFzaGVkRXZlbnROYW1lID0gSGVscGVycy5nZW5lcmF0ZUhhc2goZXZlbnQuRXZlbnRDYXRlZ29yeSArIGV2ZW50LkV2ZW50TmFtZSk7XG4gICAgICAgIGhhc2hlZEV2ZW50VHlwZSA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGV2ZW50LkV2ZW50Q2F0ZWdvcnkpO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgYXR0cmlidXRlIGZvcndhcmRpbmcgcnVsZS4gVGhpcyBydWxlIGFsbG93cyB1c2VycyB0byBvbmx5IGZvcndhcmQgYW4gZXZlbnQgaWYgYVxuICAgICAgICAgICAgLy8gc3BlY2lmaWMgYXR0cmlidXRlIGV4aXN0cyBhbmQgaGFzIGEgc3BlY2lmaWMgdmFsdWUuIEFsdGVybmF0aXZlbHksIHRoZXkgY2FuIHNwZWNpZnlcbiAgICAgICAgICAgIC8vIHRoYXQgYW4gZXZlbnQgbm90IGJlIGZvcndhcmRlZCBpZiB0aGUgc3BlY2lmaWVkIGF0dHJpYnV0ZSBuYW1lIGFuZCB2YWx1ZSBleGlzdHMuXG4gICAgICAgICAgICAvLyBUaGUgdHdvIGNhc2VzIGFyZSBjb250cm9sbGVkIGJ5IHRoZSBcImluY2x1ZGVPbk1hdGNoXCIgYm9vbGVhbiB2YWx1ZS5cbiAgICAgICAgICAgIC8vIFN1cHBvcnRlZCBtZXNzYWdlIHR5cGVzIGZvciBhdHRyaWJ1dGUgZm9yd2FyZGluZyBydWxlcyBhcmUgZGVmaW5lZCBpbiB0aGUgZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMgYXJyYXlcblxuICAgICAgICAgICAgaWYgKGZvcndhcmRpbmdSdWxlTWVzc2FnZVR5cGVzLmluZGV4T2YoZXZlbnQuRXZlbnREYXRhVHlwZSkgPiAtMVxuICAgICAgICAgICAgICAgICYmIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZVxuICAgICAgICAgICAgICAgICYmIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZU5hbWVcbiAgICAgICAgICAgICAgICAmJiBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWUuZXZlbnRBdHRyaWJ1dGVWYWx1ZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIGZvdW5kUHJvcCA9IG51bGw7XG5cbiAgICAgICAgICAgICAgICAvLyBBdHRlbXB0IHRvIGZpbmQgdGhlIGF0dHJpYnV0ZSBpbiB0aGUgY29sbGVjdGlvbiBvZiBldmVudCBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZSA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKHByb3ApLnRvU3RyaW5nKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChoYXNoZWRFdmVudEF0dHJpYnV0ZU5hbWUgPT09IE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3VuZFByb3AgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGV2ZW50LkV2ZW50QXR0cmlidXRlc1twcm9wXSkudG9TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGlzTWF0Y2ggPSBmb3VuZFByb3AgIT09IG51bGwgJiYgZm91bmRQcm9wLnZhbHVlID09PSBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWUuZXZlbnRBdHRyaWJ1dGVWYWx1ZTtcblxuICAgICAgICAgICAgICAgIHZhciBzaG91bGRJbmNsdWRlID0gTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlLmluY2x1ZGVPbk1hdGNoID09PSB0cnVlID8gaXNNYXRjaCA6ICFpc01hdGNoO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzaG91bGRJbmNsdWRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2xvbmUgdGhlIGV2ZW50IG9iamVjdCwgYXMgd2UgY291bGQgYmUgc2VuZGluZyBkaWZmZXJlbnQgYXR0cmlidXRlcyB0byBlYWNoIGZvcndhcmRlclxuICAgICAgICAgICAgY2xvbmVkRXZlbnQgPSB7fTtcbiAgICAgICAgICAgIGNsb25lZEV2ZW50ID0gSGVscGVycy5leHRlbmQodHJ1ZSwgY2xvbmVkRXZlbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIC8vIENoZWNrIGV2ZW50IGZpbHRlcmluZyBydWxlc1xuICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudFxuICAgICAgICAgICAgICAgICYmIChpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmV2ZW50TmFtZUZpbHRlcnMsIGhhc2hlZEV2ZW50TmFtZSlcbiAgICAgICAgICAgICAgICAgICAgfHwgaW5GaWx0ZXJlZExpc3QoTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5ldmVudFR5cGVGaWx0ZXJzLCBoYXNoZWRFdmVudFR5cGUpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuQ29tbWVyY2UgJiYgaW5GaWx0ZXJlZExpc3QoTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5ldmVudFR5cGVGaWx0ZXJzLCBoYXNoZWRFdmVudFR5cGUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldyAmJiBpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLnNjcmVlbk5hbWVGaWx0ZXJzLCBoYXNoZWRFdmVudE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGF0dHJpYnV0ZSBmaWx0ZXJpbmcgcnVsZXNcbiAgICAgICAgICAgIGlmIChjbG9uZWRFdmVudC5FdmVudEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uYXR0cmlidXRlRmlsdGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VWaWV3KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0ucGFnZVZpZXdBdHRyaWJ1dGVGaWx0ZXJzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIHVzZXIgaWRlbnRpdHkgZmlsdGVyaW5nIHJ1bGVzXG4gICAgICAgICAgICBmaWx0ZXJVc2VySWRlbnRpdGllcyhjbG9uZWRFdmVudCwgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS51c2VySWRlbnRpdHlGaWx0ZXJzKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgdXNlciBhdHRyaWJ1dGUgZmlsdGVyaW5nIHJ1bGVzXG4gICAgICAgICAgICBjbG9uZWRFdmVudC5Vc2VyQXR0cmlidXRlcyA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQuVXNlckF0dHJpYnV0ZXMsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0udXNlckF0dHJpYnV0ZUZpbHRlcnMpO1xuXG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTZW5kaW5nIG1lc3NhZ2UgdG8gZm9yd2FyZGVyOiAnICsgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5uYW1lKTtcblxuICAgICAgICAgICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0ucHJvY2Vzcykge1xuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLnByb2Nlc3MoY2xvbmVkRXZlbnQpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzKGtleSwgdmFsdWUpIHtcbiAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VyQXR0cmlidXRlICYmXG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzICYmXG4gICAgICAgICAgICAgICAgIUhlbHBlcnMuaW5BcnJheShmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMsIEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGtleSkpKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLnNldFVzZXJBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICB2YXIgZmlsdGVyZWRVc2VySWRlbnRpdGllcyA9IEhlbHBlcnMuZmlsdGVyVXNlcklkZW50aXRpZXModXNlcklkZW50aXRpZXMsIGZvcndhcmRlci51c2VySWRlbnRpdHlGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VySWRlbnRpdHkpIHtcbiAgICAgICAgICAgIGZpbHRlcmVkVXNlcklkZW50aXRpZXMuZm9yRWFjaChmdW5jdGlvbihpZGVudGl0eSkge1xuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBmb3J3YXJkZXIuc2V0VXNlcklkZW50aXR5KGlkZW50aXR5LklkZW50aXR5LCBpZGVudGl0eS5UeXBlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBzZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkKHVzZXIpIHtcbiAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgIHZhciBmaWx0ZXJlZFVzZXIgPSBNUGFydGljbGVVc2VyLmdldEZpbHRlcmVkTXBhcnRpY2xlVXNlcih1c2VyLmdldE1QSUQoKSwgZm9yd2FyZGVyKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5vblVzZXJJZGVudGlmaWVkKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLm9uVXNlcklkZW50aWZpZWQoZmlsdGVyZWRVc2VyKTtcbiAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gc2V0Rm9yd2FyZGVyT25JZGVudGl0eUNvbXBsZXRlKHVzZXIsIGlkZW50aXR5TWV0aG9kKSB7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgdmFyIGZpbHRlcmVkVXNlciA9IE1QYXJ0aWNsZVVzZXIuZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyKHVzZXIuZ2V0TVBJRCgpLCBmb3J3YXJkZXIpO1xuICAgICAgICBpZiAoaWRlbnRpdHlNZXRob2QgPT09ICdpZGVudGlmeScpIHtcbiAgICAgICAgICAgIGlmIChmb3J3YXJkZXIub25JZGVudGlmeUNvbXBsZXRlKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gZm9yd2FyZGVyLm9uSWRlbnRpZnlDb21wbGV0ZShmaWx0ZXJlZFVzZXIpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpZGVudGl0eU1ldGhvZCA9PT0gJ2xvZ2luJykge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5vbkxvZ2luQ29tcGxldGUpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBmb3J3YXJkZXIub25Mb2dpbkNvbXBsZXRlKGZpbHRlcmVkVXNlcik7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGlkZW50aXR5TWV0aG9kID09PSAnbG9nb3V0Jykge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5vbkxvZ291dENvbXBsZXRlKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gZm9yd2FyZGVyLm9uTG9nb3V0Q29tcGxldGUoZmlsdGVyZWRVc2VyKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaWRlbnRpdHlNZXRob2QgPT09ICdtb2RpZnknKSB7XG4gICAgICAgICAgICBpZiAoZm9yd2FyZGVyLm9uTW9kaWZ5Q29tcGxldGUpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBmb3J3YXJkZXIub25Nb2RpZnlDb21wbGV0ZShmaWx0ZXJlZFVzZXIpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBwcmVwYXJlRm9yd2FyZGluZ1N0YXRzKGZvcndhcmRlciwgZXZlbnQpIHtcbiAgICB2YXIgZm9yd2FyZGluZ1N0YXRzRGF0YSxcbiAgICAgICAgcXVldWUgPSBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCk7XG5cbiAgICBpZiAoZm9yd2FyZGVyICYmIGZvcndhcmRlci5pc1Zpc2libGUpIHtcbiAgICAgICAgZm9yd2FyZGluZ1N0YXRzRGF0YSA9IHtcbiAgICAgICAgICAgIG1pZDogZm9yd2FyZGVyLmlkLFxuICAgICAgICAgICAgZXNpZDogZm9yd2FyZGVyLmV2ZW50U3Vic2NyaXB0aW9uSWQsXG4gICAgICAgICAgICBuOiBldmVudC5FdmVudE5hbWUsXG4gICAgICAgICAgICBhdHRyczogZXZlbnQuRXZlbnRBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgc2RrOiBldmVudC5TREtWZXJzaW9uLFxuICAgICAgICAgICAgZHQ6IGV2ZW50LkV2ZW50RGF0YVR5cGUsXG4gICAgICAgICAgICBldDogZXZlbnQuRXZlbnRDYXRlZ29yeSxcbiAgICAgICAgICAgIGRiZzogZXZlbnQuRGVidWcsXG4gICAgICAgICAgICBjdDogZXZlbnQuVGltZXN0YW1wLFxuICAgICAgICAgICAgZWVjOiBldmVudC5FeHBhbmRlZEV2ZW50Q291bnRcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoSGVscGVycy5oYXNGZWF0dXJlRmxhZyhDb25zdGFudHMuRmVhdHVyZXMuQmF0Y2hpbmcpKSB7XG4gICAgICAgICAgICBxdWV1ZS5wdXNoKGZvcndhcmRpbmdTdGF0c0RhdGEpO1xuICAgICAgICAgICAgc2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZShxdWV1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBBcGlDbGllbnQuc2VuZFNpbmdsZUZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCkge1xuICAgIHJldHVybiBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLmZvcndhcmRpbmdTdGF0c0V2ZW50UXVldWU7XG59XG5cbmZ1bmN0aW9uIHNldEZvcndhcmRlclN0YXRzUXVldWUocXVldWUpIHtcbiAgICBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLmZvcndhcmRpbmdTdGF0c0V2ZW50UXVldWUgPSBxdWV1ZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaW5pdEZvcndhcmRlcnM6IGluaXRGb3J3YXJkZXJzLFxuICAgIGFwcGx5VG9Gb3J3YXJkZXJzOiBhcHBseVRvRm9yd2FyZGVycyxcbiAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnM6IHNlbmRFdmVudFRvRm9yd2FyZGVycyxcbiAgICBjYWxsU2V0VXNlckF0dHJpYnV0ZU9uRm9yd2FyZGVyczogY2FsbFNldFVzZXJBdHRyaWJ1dGVPbkZvcndhcmRlcnMsXG4gICAgc2V0Rm9yd2FyZGVyVXNlcklkZW50aXRpZXM6IHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzLFxuICAgIHNldEZvcndhcmRlck9uVXNlcklkZW50aWZpZWQ6IHNldEZvcndhcmRlck9uVXNlcklkZW50aWZpZWQsXG4gICAgc2V0Rm9yd2FyZGVyT25JZGVudGl0eUNvbXBsZXRlOiBzZXRGb3J3YXJkZXJPbklkZW50aXR5Q29tcGxldGUsXG4gICAgcHJlcGFyZUZvcndhcmRpbmdTdGF0czogcHJlcGFyZUZvcndhcmRpbmdTdGF0cyxcbiAgICBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlOiBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlLFxuICAgIHNldEZvcndhcmRlclN0YXRzUXVldWU6IHNldEZvcndhcmRlclN0YXRzUXVldWUsXG4gICAgaXNFbmFibGVkRm9yVXNlckNvbnNlbnQ6IGlzRW5hYmxlZEZvclVzZXJDb25zZW50LFxuICAgIGlzRW5hYmxlZEZvclVzZXJBdHRyaWJ1dGVzOiBpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlc1xufTtcbiIsInZhciBBcGlDbGllbnQgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBGb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyk7XG5cbmZ1bmN0aW9uIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXIoKSB7XG4gICAgbVBhcnRpY2xlLl9mb3J3YXJkaW5nU3RhdHNUaW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBwcmVwYXJlQW5kU2VuZEZvcndhcmRpbmdTdGF0c0JhdGNoKCk7XG4gICAgfSwgTVAuQ29uZmlnLkZvcndhcmRlclN0YXRzVGltZW91dCk7XG59XG5cbmZ1bmN0aW9uIHByZXBhcmVBbmRTZW5kRm9yd2FyZGluZ1N0YXRzQmF0Y2goKSB7XG4gICAgdmFyIGZvcndhcmRlclF1ZXVlID0gRm9yd2FyZGVycy5nZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCksXG4gICAgICAgIHVwbG9hZHNUYWJsZSA9IFBlcnNpc3RlbmNlLmZvcndhcmRpbmdTdGF0c0JhdGNoZXMudXBsb2Fkc1RhYmxlLFxuICAgICAgICBub3cgPSBEYXRlLm5vdygpO1xuXG4gICAgaWYgKGZvcndhcmRlclF1ZXVlLmxlbmd0aCkge1xuICAgICAgICB1cGxvYWRzVGFibGVbbm93XSA9IHt1cGxvYWRpbmc6IGZhbHNlLCBkYXRhOiBmb3J3YXJkZXJRdWV1ZX07XG4gICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZShbXSk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgZGF0ZSBpbiB1cGxvYWRzVGFibGUpIHtcbiAgICAgICAgKGZ1bmN0aW9uKGRhdGUpIHtcbiAgICAgICAgICAgIGlmICh1cGxvYWRzVGFibGUuaGFzT3duUHJvcGVydHkoZGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAwIHx8IHhoci5zdGF0dXMgPT09IDIwMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgc2VudCAgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgdXBsb2Fkc1RhYmxlW2RhdGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoeGhyLnN0YXR1cy50b1N0cmluZygpWzBdID09PSAnNCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHhoci5zdGF0dXMgIT09IDQyOSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVwbG9hZHNUYWJsZVtkYXRlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZm9yd2FyZGluZ1N0YXRzRGF0YSA9IHVwbG9hZHNUYWJsZVtkYXRlXS5kYXRhO1xuICAgICAgICAgICAgICAgICAgICB1cGxvYWRzVGFibGVbZGF0ZV0udXBsb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgQXBpQ2xpZW50LnNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEsIHhocik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KShkYXRlKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXI6IHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXJcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBwbHVzZXMgPSAvXFwrL2csXG4gICAgc2VydmljZVNjaGVtZSA9IHdpbmRvdy5tUGFydGljbGUgJiYgd2luZG93Lm1QYXJ0aWNsZS5mb3JjZUh0dHBzID8gJ2h0dHBzOi8vJyA6IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCArICcvLyc7XG5cbmZ1bmN0aW9uIGxvZ0RlYnVnKG1zZykge1xuICAgIGlmIChNUC5sb2dMZXZlbCA9PT0gJ3ZlcmJvc2UnICYmIHdpbmRvdy5jb25zb2xlICYmIHdpbmRvdy5jb25zb2xlLmxvZykge1xuICAgICAgICB3aW5kb3cuY29uc29sZS5sb2cobXNnKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNhbkxvZygpIHtcbiAgICBpZiAoTVAuaXNFbmFibGVkICYmIChNUC5kZXZUb2tlbiB8fCBNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiByZXR1cm5Db252ZXJ0ZWRCb29sZWFuKGRhdGEpIHtcbiAgICBpZiAoZGF0YSA9PT0gJ2ZhbHNlJyB8fCBkYXRhID09PSAnMCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGRhdGEpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gaGFzRmVhdHVyZUZsYWcoZmVhdHVyZSkge1xuICAgIHJldHVybiBNUC5mZWF0dXJlRmxhZ3NbZmVhdHVyZV07XG59XG5cbmZ1bmN0aW9uIGludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBjb2RlLCBib2R5LCBtUGFydGljbGVVc2VyKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICBodHRwQ29kZTogY29kZSxcbiAgICAgICAgICAgICAgICBib2R5OiBib2R5LFxuICAgICAgICAgICAgICAgIGdldFVzZXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobVBhcnRpY2xlVXNlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1QYXJ0aWNsZVVzZXI7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nRGVidWcoJ1RoZXJlIHdhcyBhbiBlcnJvciB3aXRoIHlvdXIgY2FsbGJhY2s6ICcgKyBlKTtcbiAgICB9XG59XG5cbi8vIFN0YW5kYWxvbmUgdmVyc2lvbiBvZiBqUXVlcnkuZXh0ZW5kLCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9kYW5zZG9tL2V4dGVuZFxuZnVuY3Rpb24gZXh0ZW5kKCkge1xuICAgIHZhciBvcHRpb25zLCBuYW1lLCBzcmMsIGNvcHksIGNvcHlJc0FycmF5LCBjbG9uZSxcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzBdIHx8IHt9LFxuICAgICAgICBpID0gMSxcbiAgICAgICAgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aCxcbiAgICAgICAgZGVlcCA9IGZhbHNlLFxuICAgICAgICAvLyBoZWxwZXIgd2hpY2ggcmVwbGljYXRlcyB0aGUganF1ZXJ5IGludGVybmFsIGZ1bmN0aW9uc1xuICAgICAgICBvYmplY3RIZWxwZXIgPSB7XG4gICAgICAgICAgICBoYXNPd246IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksXG4gICAgICAgICAgICBjbGFzczJ0eXBlOiB7fSxcbiAgICAgICAgICAgIHR5cGU6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIHJldHVybiBvYmogPT0gbnVsbCA/XG4gICAgICAgICAgICAgICAgICAgIFN0cmluZyhvYmopIDpcbiAgICAgICAgICAgICAgICAgICAgb2JqZWN0SGVscGVyLmNsYXNzMnR5cGVbT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaildIHx8ICdvYmplY3QnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzUGxhaW5PYmplY3Q6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIGlmICghb2JqIHx8IG9iamVjdEhlbHBlci50eXBlKG9iaikgIT09ICdvYmplY3QnIHx8IG9iai5ub2RlVHlwZSB8fCBvYmplY3RIZWxwZXIuaXNXaW5kb3cob2JqKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5jb25zdHJ1Y3RvciAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgIW9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosICdjb25zdHJ1Y3RvcicpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAhb2JqZWN0SGVscGVyLmhhc093bi5jYWxsKG9iai5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsICdpc1Byb3RvdHlwZU9mJykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBrZXk7XG4gICAgICAgICAgICAgICAgZm9yIChrZXkgaW4gb2JqKSB7IH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1lbXB0eVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGtleSA9PT0gdW5kZWZpbmVkIHx8IG9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosIGtleSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNBcnJheTogQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2FycmF5JztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0Z1bmN0aW9uOiBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2Z1bmN0aW9uJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc1dpbmRvdzogZnVuY3Rpb24ob2JqKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG9iaiAhPSBudWxsICYmIG9iaiA9PSBvYmoud2luZG93O1xuICAgICAgICAgICAgfVxuICAgICAgICB9OyAgLy8gZW5kIG9mIG9iamVjdEhlbHBlclxuXG4gICAgLy8gSGFuZGxlIGEgZGVlcCBjb3B5IHNpdHVhdGlvblxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZGVlcCA9IHRhcmdldDtcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzFdIHx8IHt9O1xuICAgICAgICAvLyBza2lwIHRoZSBib29sZWFuIGFuZCB0aGUgdGFyZ2V0XG4gICAgICAgIGkgPSAyO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBjYXNlIHdoZW4gdGFyZ2V0IGlzIGEgc3RyaW5nIG9yIHNvbWV0aGluZyAocG9zc2libGUgaW4gZGVlcCBjb3B5KVxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnb2JqZWN0JyAmJiAhb2JqZWN0SGVscGVyLmlzRnVuY3Rpb24odGFyZ2V0KSkge1xuICAgICAgICB0YXJnZXQgPSB7fTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzZWNvbmQgYXJndW1lbnQgaXMgdXNlZCB0aGVuIHRoaXMgY2FuIGV4dGVuZCBhbiBvYmplY3QgdGhhdCBpcyB1c2luZyB0aGlzIG1ldGhvZFxuICAgIGlmIChsZW5ndGggPT09IGkpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGhpcztcbiAgICAgICAgLS1pO1xuICAgIH1cblxuICAgIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgLy8gT25seSBkZWFsIHdpdGggbm9uLW51bGwvdW5kZWZpbmVkIHZhbHVlc1xuICAgICAgICBpZiAoKG9wdGlvbnMgPSBhcmd1bWVudHNbaV0pICE9IG51bGwpIHtcbiAgICAgICAgICAgIC8vIEV4dGVuZCB0aGUgYmFzZSBvYmplY3RcbiAgICAgICAgICAgIGZvciAobmFtZSBpbiBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgc3JjID0gdGFyZ2V0W25hbWVdO1xuICAgICAgICAgICAgICAgIGNvcHkgPSBvcHRpb25zW25hbWVdO1xuXG4gICAgICAgICAgICAgICAgLy8gUHJldmVudCBuZXZlci1lbmRpbmcgbG9vcFxuICAgICAgICAgICAgICAgIGlmICh0YXJnZXQgPT09IGNvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gUmVjdXJzZSBpZiB3ZSdyZSBtZXJnaW5nIHBsYWluIG9iamVjdHMgb3IgYXJyYXlzXG4gICAgICAgICAgICAgICAgaWYgKGRlZXAgJiYgY29weSAmJiAob2JqZWN0SGVscGVyLmlzUGxhaW5PYmplY3QoY29weSkgfHwgKGNvcHlJc0FycmF5ID0gb2JqZWN0SGVscGVyLmlzQXJyYXkoY29weSkpKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29weUlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvcHlJc0FycmF5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbG9uZSA9IHNyYyAmJiBvYmplY3RIZWxwZXIuaXNBcnJheShzcmMpID8gc3JjIDogW107XG5cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb25lID0gc3JjICYmIG9iamVjdEhlbHBlci5pc1BsYWluT2JqZWN0KHNyYykgPyBzcmMgOiB7fTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIE5ldmVyIG1vdmUgb3JpZ2luYWwgb2JqZWN0cywgY2xvbmUgdGhlbVxuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBleHRlbmQoZGVlcCwgY2xvbmUsIGNvcHkpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIERvbid0IGJyaW5nIGluIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvcHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBjb3B5O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJldHVybiB0aGUgbW9kaWZpZWQgb2JqZWN0XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgICB2YXIgb2JqVHlwZSA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG5cbiAgICByZXR1cm4gb2JqVHlwZSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbiAgICAgICAgfHwgb2JqVHlwZSA9PT0gJ1tvYmplY3QgRXJyb3JdJztcbn1cblxuZnVuY3Rpb24gaW5BcnJheShpdGVtcywgbmFtZSkge1xuICAgIHZhciBpID0gMDtcblxuICAgIGlmIChBcnJheS5wcm90b3R5cGUuaW5kZXhPZikge1xuICAgICAgICByZXR1cm4gaXRlbXMuaW5kZXhPZihuYW1lLCAwKSA+PSAwO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZm9yICh2YXIgbiA9IGl0ZW1zLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgICAgICAgaWYgKGkgaW4gaXRlbXMgJiYgaXRlbXNbaV0gPT09IG5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU2VydmljZVVybChzZWN1cmVTZXJ2aWNlVXJsLCBzZXJ2aWNlVXJsLCBkZXZUb2tlbikge1xuICAgIGlmIChtUGFydGljbGUuZm9yY2VIdHRwcykge1xuICAgICAgICByZXR1cm4gJ2h0dHBzOi8vJyArIHNlY3VyZVNlcnZpY2VVcmwgKyBkZXZUb2tlbjtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc2VydmljZVNjaGVtZSArICgod2luZG93LmxvY2F0aW9uLnByb3RvY29sID09PSAnaHR0cHM6JykgPyBzZWN1cmVTZXJ2aWNlVXJsIDogc2VydmljZVVybCkgKyBkZXZUb2tlbjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVhIUihjYikge1xuICAgIHZhciB4aHI7XG5cbiAgICB0cnkge1xuICAgICAgICB4aHIgPSBuZXcgd2luZG93LlhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIGxvZ0RlYnVnKCdFcnJvciBjcmVhdGluZyBYTUxIdHRwUmVxdWVzdCBvYmplY3QuJyk7XG4gICAgfVxuXG4gICAgaWYgKHhociAmJiBjYiAmJiAnd2l0aENyZWRlbnRpYWxzJyBpbiB4aHIpIHtcbiAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGNiO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygd2luZG93LlhEb21haW5SZXF1ZXN0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBsb2dEZWJ1ZygnQ3JlYXRpbmcgWERvbWFpblJlcXVlc3Qgb2JqZWN0Jyk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHhociA9IG5ldyB3aW5kb3cuWERvbWFpblJlcXVlc3QoKTtcbiAgICAgICAgICAgIHhoci5vbmxvYWQgPSBjYjtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9nRGVidWcoJ0Vycm9yIGNyZWF0aW5nIFhEb21haW5SZXF1ZXN0IG9iamVjdCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHhocjtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVSYW5kb21WYWx1ZShhKSB7XG4gICAgdmFyIHJhbmRvbVZhbHVlO1xuICAgIGlmICh3aW5kb3cuY3J5cHRvICYmIHdpbmRvdy5jcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKSB7XG4gICAgICAgIHJhbmRvbVZhbHVlID0gd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMSkpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVuZGVmXG4gICAgfVxuICAgIGlmIChyYW5kb21WYWx1ZSkge1xuICAgICAgICByZXR1cm4gKGEgXiByYW5kb21WYWx1ZVswXSAlIDE2ID4+IGEvNCkudG9TdHJpbmcoMTYpO1xuICAgIH1cblxuICAgIHJldHVybiAoYSBeIE1hdGgucmFuZG9tKCkgKiAxNiA+PiBhLzQpLnRvU3RyaW5nKDE2KTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVVbmlxdWVJZChhKSB7XG4gICAgLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuICAgIC8vIEFkZGVkIHN1cHBvcnQgZm9yIGNyeXB0byBmb3IgYmV0dGVyIHJhbmRvbVxuXG4gICAgcmV0dXJuIGEgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaWYgdGhlIHBsYWNlaG9sZGVyIHdhcyBwYXNzZWQsIHJldHVyblxuICAgICAgICAgICAgPyBnZW5lcmF0ZVJhbmRvbVZhbHVlKGEpICAgIC8vIGEgcmFuZG9tIG51bWJlclxuICAgICAgICAgICAgOiAoICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG9yIG90aGVyd2lzZSBhIGNvbmNhdGVuYXRlZCBzdHJpbmc6XG4gICAgICAgICAgICBbMWU3XSArICAgICAgICAgICAgICAgICAgICAgLy8gMTAwMDAwMDAgK1xuICAgICAgICAgICAgLTFlMyArICAgICAgICAgICAgICAgICAgICAgIC8vIC0xMDAwICtcbiAgICAgICAgICAgIC00ZTMgKyAgICAgICAgICAgICAgICAgICAgICAvLyAtNDAwMCArXG4gICAgICAgICAgICAtOGUzICsgICAgICAgICAgICAgICAgICAgICAgLy8gLTgwMDAwMDAwICtcbiAgICAgICAgICAgIC0xZTExICAgICAgICAgICAgICAgICAgICAgICAvLyAtMTAwMDAwMDAwMDAwLFxuICAgICAgICAgICAgKS5yZXBsYWNlKCAgICAgICAgICAgICAgICAgIC8vIHJlcGxhY2luZ1xuICAgICAgICAgICAgICAgIC9bMDE4XS9nLCAgICAgICAgICAgICAgIC8vIHplcm9lcywgb25lcywgYW5kIGVpZ2h0cyB3aXRoXG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVVbmlxdWVJZCAgICAgICAgLy8gcmFuZG9tIGhleCBkaWdpdHNcbiAgICAgICAgICAgICk7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzT2JqZWN0LCBmaWx0ZXJMaXN0KSB7XG4gICAgdmFyIGZpbHRlcmVkVXNlcklkZW50aXRpZXMgPSBbXTtcblxuICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdCAmJiBPYmplY3Qua2V5cyh1c2VySWRlbnRpdGllc09iamVjdCkubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIHVzZXJJZGVudGl0eU5hbWUgaW4gdXNlcklkZW50aXRpZXNPYmplY3QpIHtcbiAgICAgICAgICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdC5oYXNPd25Qcm9wZXJ0eSh1c2VySWRlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWRlbnRpdHlUeXBlID0gVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZSh1c2VySWRlbnRpdHlOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAoIWluQXJyYXkoZmlsdGVyTGlzdCwgdXNlcklkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlkZW50aXR5ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgVHlwZTogdXNlcklkZW50aXR5VHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIElkZW50aXR5OiB1c2VySWRlbnRpdGllc09iamVjdFt1c2VySWRlbnRpdHlOYW1lXVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlcklkZW50aXR5VHlwZSA9PT0gbVBhcnRpY2xlLklkZW50aXR5VHlwZS5DdXN0b21lcklkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzLnVuc2hpZnQoaWRlbnRpdHkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllcy5wdXNoKGlkZW50aXR5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnModXNlcklkZW50aXRpZXNPYmplY3QsIGZpbHRlckxpc3QpIHtcbiAgICB2YXIgZmlsdGVyZWRVc2VySWRlbnRpdGllcyA9IHt9O1xuXG4gICAgaWYgKHVzZXJJZGVudGl0aWVzT2JqZWN0ICYmIE9iamVjdC5rZXlzKHVzZXJJZGVudGl0aWVzT2JqZWN0KS5sZW5ndGgpIHtcbiAgICAgICAgZm9yICh2YXIgdXNlcklkZW50aXR5TmFtZSBpbiB1c2VySWRlbnRpdGllc09iamVjdCkge1xuICAgICAgICAgICAgaWYgKHVzZXJJZGVudGl0aWVzT2JqZWN0Lmhhc093blByb3BlcnR5KHVzZXJJZGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFyIHVzZXJJZGVudGl0eVR5cGUgPSBUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKHVzZXJJZGVudGl0eU5hbWUpO1xuICAgICAgICAgICAgICAgIGlmICghaW5BcnJheShmaWx0ZXJMaXN0LCB1c2VySWRlbnRpdHlUeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzW3VzZXJJZGVudGl0eU5hbWVdID0gdXNlcklkZW50aXRpZXNPYmplY3RbdXNlcklkZW50aXR5TmFtZV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbHRlcmVkVXNlcklkZW50aXRpZXM7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclVzZXJBdHRyaWJ1dGVzKHVzZXJBdHRyaWJ1dGVzLCBmaWx0ZXJMaXN0KSB7XG4gICAgdmFyIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXMgPSB7fTtcblxuICAgIGlmICh1c2VyQXR0cmlidXRlcyAmJiBPYmplY3Qua2V5cyh1c2VyQXR0cmlidXRlcykubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIHVzZXJBdHRyaWJ1dGUgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eSh1c2VyQXR0cmlidXRlKSkge1xuICAgICAgICAgICAgICAgIHZhciBoYXNoZWRVc2VyQXR0cmlidXRlID0gZ2VuZXJhdGVIYXNoKHVzZXJBdHRyaWJ1dGUpO1xuICAgICAgICAgICAgICAgIGlmICghaW5BcnJheShmaWx0ZXJMaXN0LCBoYXNoZWRVc2VyQXR0cmlidXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJBdHRyaWJ1dGVzW3VzZXJBdHRyaWJ1dGVdID0gdXNlckF0dHJpYnV0ZXNbdXNlckF0dHJpYnV0ZV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXM7XG59XG5cbmZ1bmN0aW9uIGZpbmRLZXlJbk9iamVjdChvYmosIGtleSkge1xuICAgIGlmIChrZXkgJiYgb2JqKSB7XG4gICAgICAgIGZvciAodmFyIHByb3AgaW4gb2JqKSB7XG4gICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KHByb3ApICYmIHByb3AudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBkZWNvZGVkKHMpIHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHMucmVwbGFjZShwbHVzZXMsICcgJykpO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0ZWQocykge1xuICAgIGlmIChzLmluZGV4T2YoJ1wiJykgPT09IDApIHtcbiAgICAgICAgcyA9IHMuc2xpY2UoMSwgLTEpLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKS5yZXBsYWNlKC9cXFxcXFxcXC9nLCAnXFxcXCcpO1xuICAgIH1cblxuICAgIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBpc0V2ZW50VHlwZSh0eXBlKSB7XG4gICAgZm9yICh2YXIgcHJvcCBpbiBUeXBlcy5FdmVudFR5cGUpIHtcbiAgICAgICAgaWYgKFR5cGVzLkV2ZW50VHlwZS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgaWYgKFR5cGVzLkV2ZW50VHlwZVtwcm9wXSA9PT0gdHlwZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gcGFyc2VOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAoaXNOYU4odmFsdWUpIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICAgIHZhciBmbG9hdFZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKGZsb2F0VmFsdWUpID8gMCA6IGZsb2F0VmFsdWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU3RyaW5nT3JOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAoVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZW5lcmF0ZUhhc2gobmFtZSkge1xuICAgIHZhciBoYXNoID0gMCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGNoYXJhY3RlcjtcblxuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgfHwgbmFtZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBuYW1lID0gbmFtZS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7XG5cbiAgICBpZiAoQXJyYXkucHJvdG90eXBlLnJlZHVjZSkge1xuICAgICAgICByZXR1cm4gbmFtZS5zcGxpdCgnJykucmVkdWNlKGZ1bmN0aW9uKGEsIGIpIHsgYSA9ICgoYSA8PCA1KSAtIGEpICsgYi5jaGFyQ29kZUF0KDApOyByZXR1cm4gYSAmIGE7IH0sIDApO1xuICAgIH1cblxuICAgIGlmIChuYW1lLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gaGFzaDtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbmFtZS5sZW5ndGg7IGkrKykge1xuICAgICAgICBjaGFyYWN0ZXIgPSBuYW1lLmNoYXJDb2RlQXQoaSk7XG4gICAgICAgIGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIGNoYXJhY3RlcjtcbiAgICAgICAgaGFzaCA9IGhhc2ggJiBoYXNoO1xuICAgIH1cblxuICAgIHJldHVybiBoYXNoO1xufVxuXG5mdW5jdGlvbiBzYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cnMpIHtcbiAgICBpZiAoIWF0dHJzIHx8ICFpc09iamVjdChhdHRycykpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgdmFyIHNhbml0aXplZEF0dHJzID0ge307XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIGF0dHJzKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IGF0dHJpYnV0ZSB2YWx1ZXMgYXJlIG5vdCBvYmplY3RzIG9yIGFycmF5cywgd2hpY2ggYXJlIG5vdCB2YWxpZFxuICAgICAgICBpZiAoYXR0cnMuaGFzT3duUHJvcGVydHkocHJvcCkgJiYgVmFsaWRhdG9ycy5pc1ZhbGlkQXR0cmlidXRlVmFsdWUoYXR0cnNbcHJvcF0pKSB7XG4gICAgICAgICAgICBzYW5pdGl6ZWRBdHRyc1twcm9wXSA9IGF0dHJzW3Byb3BdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nRGVidWcoJ1RoZSBhdHRyaWJ1dGUga2V5IG9mICcgKyBwcm9wICsgJyBtdXN0IGJlIGEgc3RyaW5nLCBudW1iZXIsIGJvb2xlYW4sIG9yIG51bGwuJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2FuaXRpemVkQXR0cnM7XG59XG5cbmZ1bmN0aW9uIG1lcmdlQ29uZmlnKGNvbmZpZykge1xuICAgIGxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuTG9hZGluZ0NvbmZpZyk7XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIENvbnN0YW50cy5EZWZhdWx0Q29uZmlnKSB7XG4gICAgICAgIGlmIChDb25zdGFudHMuRGVmYXVsdENvbmZpZy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgTVAuQ29uZmlnW3Byb3BdID0gQ29uc3RhbnRzLkRlZmF1bHRDb25maWdbcHJvcF07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICBNUC5Db25maWdbcHJvcF0gPSBjb25maWdbcHJvcF07XG4gICAgICAgIH1cbiAgICB9XG59XG5cbnZhciBWYWxpZGF0b3JzID0ge1xuICAgIGlzVmFsaWRBdHRyaWJ1dGVWYWx1ZTogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWlzT2JqZWN0KHZhbHVlKSAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG4gICAgfSxcblxuICAgIC8vIE5laXRoZXIgbnVsbCBub3IgdW5kZWZpbmVkIGNhbiBiZSBhIHZhbGlkIEtleVxuICAgIGlzVmFsaWRLZXlWYWx1ZTogZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGtleSAmJiAhaXNPYmplY3Qoa2V5KSAmJiAhQXJyYXkuaXNBcnJheShrZXkpKTtcbiAgICB9LFxuXG4gICAgaXNTdHJpbmdPck51bWJlcjogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpO1xuICAgIH0sXG5cbiAgICBpc0Z1bmN0aW9uOiBmdW5jdGlvbihmbikge1xuICAgICAgICByZXR1cm4gdHlwZW9mIGZuID09PSAnZnVuY3Rpb24nO1xuICAgIH0sXG5cbiAgICB2YWxpZGF0ZUlkZW50aXRpZXM6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgbWV0aG9kKSB7XG4gICAgICAgIHZhciB2YWxpZElkZW50aXR5UmVxdWVzdEtleXMgPSB7XG4gICAgICAgICAgICB1c2VySWRlbnRpdGllczogMSxcbiAgICAgICAgICAgIG9uVXNlckFsaWFzOiAxLFxuICAgICAgICAgICAgY29weVVzZXJBdHRyaWJ1dGVzOiAxXG4gICAgICAgIH07XG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEpIHtcbiAgICAgICAgICAgIGlmIChtZXRob2QgPT09ICdtb2RpZnknKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlzT2JqZWN0KGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykgJiYgIU9iamVjdC5rZXlzKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykubGVuZ3RoIHx8ICFpc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Nb2RpZnlJZGVudGl0eVJlcXVlc3RVc2VySWRlbnRpdGllc1ByZXNlbnRcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdmFsaWRJZGVudGl0eVJlcXVlc3RLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLklkZW50aXR5UmVxdWVzZXRJbnZhbGlkS2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChrZXkgPT09ICdvblVzZXJBbGlhcycgJiYgIVZhbGlkYXRvcnMuaXNGdW5jdGlvbihpZGVudGl0eUFwaURhdGFba2V5XSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLk9uVXNlckFsaWFzVHlwZSArIHR5cGVvZiBpZGVudGl0eUFwaURhdGFba2V5XVxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzIGNhbid0IGJlIHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAvLyBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgY2FuIGJlIG51bGwsIGJ1dCBpZiBpdCBpc24ndCBudWxsIG9yIHVuZGVmaW5lZCAoYWJvdmUgY29uZGl0aW9uYWwpLCBpdCBtdXN0IGJlIGFuIG9iamVjdFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzICE9PSBudWxsICYmICFpc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Vc2VySWRlbnRpdGllc1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSAmJiBPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpZGVudGl0eVR5cGUgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzLmhhc093blByb3BlcnR5KGlkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShpZGVudGl0eVR5cGUpID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNJbnZhbGlkS2V5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghKHR5cGVvZiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNbaWRlbnRpdHlUeXBlXSA9PT0gJ3N0cmluZycgfHwgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzW2lkZW50aXR5VHlwZV0gPT09IG51bGwpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Vc2VySWRlbnRpdGllc0ludmFsaWRWYWx1ZXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuZnVuY3Rpb24gaXNEZWxheWVkQnlJbnRlZ3JhdGlvbihkZWxheWVkSW50ZWdyYXRpb25zLCB0aW1lb3V0U3RhcnQsIG5vdykge1xuICAgIGlmIChub3cgLSB0aW1lb3V0U3RhcnQgPiBtUGFydGljbGUuaW50ZWdyYXRpb25EZWxheVRpbWVvdXQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBmb3IgKHZhciBpbnRlZ3JhdGlvbiBpbiBkZWxheWVkSW50ZWdyYXRpb25zKSB7XG4gICAgICAgIGlmIChkZWxheWVkSW50ZWdyYXRpb25zW2ludGVncmF0aW9uXSA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIGV2ZW50cyBleGlzdCBpbiB0aGUgZXZlbnRRdWV1ZSBiZWNhdXNlIHRoZXkgd2VyZSB0cmlnZ2VyZWQgd2hlbiB0aGUgaWRlbnRpdHlBUEkgcmVxdWVzdCB3YXMgaW4gZmxpZ2h0XG4vLyBvbmNlIEFQSSByZXF1ZXN0IHJldHVybnMgYW5kIHRoZXJlIGlzIGFuIE1QSUQsIGV2ZW50UXVldWUgaXRlbXMgYXJlIHJlYXNzaWduZWQgd2l0aCB0aGUgcmV0dXJuZWQgTVBJRCBhbmQgZmx1c2hlZFxuZnVuY3Rpb24gcHJvY2Vzc1F1ZXVlZEV2ZW50cyhldmVudFF1ZXVlLCBtcGlkLCByZXF1aXJlRGVsYXksIHNlbmRFdmVudFRvU2VydmVyLCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSkge1xuICAgIGlmIChldmVudFF1ZXVlLmxlbmd0aCAmJiBtcGlkICYmIHJlcXVpcmVEZWxheSkge1xuICAgICAgICB2YXIgbG9jYWxRdWV1ZUNvcHkgPSBldmVudFF1ZXVlO1xuICAgICAgICBNUC5ldmVudFF1ZXVlID0gW107XG4gICAgICAgIGxvY2FsUXVldWVDb3B5LmZvckVhY2goZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50Lk1QSUQgPSBtcGlkO1xuICAgICAgICAgICAgc2VuZEV2ZW50VG9TZXJ2ZXIoZXZlbnQsIHNlbmRFdmVudFRvRm9yd2FyZGVycywgcGFyc2VFdmVudFJlc3BvbnNlKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBsb2dEZWJ1ZzogbG9nRGVidWcsXG4gICAgY2FuTG9nOiBjYW5Mb2csXG4gICAgZXh0ZW5kOiBleHRlbmQsXG4gICAgaXNPYmplY3Q6IGlzT2JqZWN0LFxuICAgIGluQXJyYXk6IGluQXJyYXksXG4gICAgY3JlYXRlU2VydmljZVVybDogY3JlYXRlU2VydmljZVVybCxcbiAgICBjcmVhdGVYSFI6IGNyZWF0ZVhIUixcbiAgICBnZW5lcmF0ZVVuaXF1ZUlkOiBnZW5lcmF0ZVVuaXF1ZUlkLFxuICAgIGZpbHRlclVzZXJJZGVudGl0aWVzOiBmaWx0ZXJVc2VySWRlbnRpdGllcyxcbiAgICBmaWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnM6IGZpbHRlclVzZXJJZGVudGl0aWVzRm9yRm9yd2FyZGVycyxcbiAgICBmaWx0ZXJVc2VyQXR0cmlidXRlczogZmlsdGVyVXNlckF0dHJpYnV0ZXMsXG4gICAgZmluZEtleUluT2JqZWN0OiBmaW5kS2V5SW5PYmplY3QsXG4gICAgZGVjb2RlZDogZGVjb2RlZCxcbiAgICBjb252ZXJ0ZWQ6IGNvbnZlcnRlZCxcbiAgICBpc0V2ZW50VHlwZTogaXNFdmVudFR5cGUsXG4gICAgcGFyc2VOdW1iZXI6IHBhcnNlTnVtYmVyLFxuICAgIHBhcnNlU3RyaW5nT3JOdW1iZXI6IHBhcnNlU3RyaW5nT3JOdW1iZXIsXG4gICAgZ2VuZXJhdGVIYXNoOiBnZW5lcmF0ZUhhc2gsXG4gICAgc2FuaXRpemVBdHRyaWJ1dGVzOiBzYW5pdGl6ZUF0dHJpYnV0ZXMsXG4gICAgbWVyZ2VDb25maWc6IG1lcmdlQ29uZmlnLFxuICAgIHJldHVybkNvbnZlcnRlZEJvb2xlYW46IHJldHVybkNvbnZlcnRlZEJvb2xlYW4sXG4gICAgaW52b2tlQ2FsbGJhY2s6IGludm9rZUNhbGxiYWNrLFxuICAgIGhhc0ZlYXR1cmVGbGFnOiBoYXNGZWF0dXJlRmxhZyxcbiAgICBpc0RlbGF5ZWRCeUludGVncmF0aW9uOiBpc0RlbGF5ZWRCeUludGVncmF0aW9uLFxuICAgIHByb2Nlc3NRdWV1ZWRFdmVudHM6IHByb2Nlc3NRdWV1ZWRFdmVudHMsXG4gICAgVmFsaWRhdG9yczogVmFsaWRhdG9yc1xufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBTZXJ2ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2VydmVyTW9kZWwnKSxcbiAgICBGb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgTmF0aXZlU2RrSGVscGVycyA9IHJlcXVpcmUoJy4vbmF0aXZlU2RrSGVscGVycycpLFxuICAgIFZhbGlkYXRvcnMgPSBIZWxwZXJzLlZhbGlkYXRvcnMsXG4gICAgc2VuZElkZW50aXR5UmVxdWVzdCA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50Jykuc2VuZElkZW50aXR5UmVxdWVzdCxcbiAgICBDb29raWVTeW5jTWFuYWdlciA9IHJlcXVpcmUoJy4vY29va2llU3luY01hbmFnZXInKSxcbiAgICBzZW5kRXZlbnRUb1NlcnZlciA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50Jykuc2VuZEV2ZW50VG9TZXJ2ZXIsXG4gICAgSFRUUENvZGVzID0gQ29uc3RhbnRzLkhUVFBDb2RlcyxcbiAgICBFdmVudHMgPSByZXF1aXJlKCcuL2V2ZW50cycpLFxuICAgIHNlbmRFdmVudFRvRm9yd2FyZGVycyA9IHJlcXVpcmUoJy4vZm9yd2FyZGVycycpLnNlbmRFdmVudFRvRm9yd2FyZGVycztcblxudmFyIElkZW50aXR5ID0ge1xuICAgIGNoZWNrSWRlbnRpdHlTd2FwOiBmdW5jdGlvbihwcmV2aW91c01QSUQsIGN1cnJlbnRNUElEKSB7XG4gICAgICAgIGlmIChwcmV2aW91c01QSUQgJiYgY3VycmVudE1QSUQgJiYgcHJldmlvdXNNUElEICE9PSBjdXJyZW50TVBJRCkge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS51c2VMb2NhbFN0b3JhZ2UoKSA/IFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZSgpIDogUGVyc2lzdGVuY2UuZ2V0Q29va2llKCk7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBjdXJyZW50TVBJRCk7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbnZhciBJZGVudGl0eVJlcXVlc3QgPSB7XG4gICAgY3JlYXRlS25vd25JZGVudGl0aWVzOiBmdW5jdGlvbihpZGVudGl0eUFwaURhdGEsIGRldmljZUlkKSB7XG4gICAgICAgIHZhciBpZGVudGl0aWVzUmVzdWx0ID0ge307XG5cbiAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YSAmJiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgJiYgSGVscGVycy5pc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBpZGVudGl0eSBpbiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZGVudGl0aWVzUmVzdWx0W2lkZW50aXR5XSA9IGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllc1tpZGVudGl0eV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWRlbnRpdGllc1Jlc3VsdC5kZXZpY2VfYXBwbGljYXRpb25fc3RhbXAgPSBkZXZpY2VJZDtcblxuICAgICAgICByZXR1cm4gaWRlbnRpdGllc1Jlc3VsdDtcbiAgICB9LFxuXG4gICAgcHJlUHJvY2Vzc0lkZW50aXR5UmVxdWVzdDogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaywgbWV0aG9kKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0xvZ0V2ZW50ICsgJzogJyArIG1ldGhvZCk7XG5cbiAgICAgICAgdmFyIGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdCA9IFZhbGlkYXRvcnMudmFsaWRhdGVJZGVudGl0aWVzKGlkZW50aXR5QXBpRGF0YSwgbWV0aG9kKTtcblxuICAgICAgICBpZiAoIWlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRVJST1I6ICcgKyBpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQuZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgZXJyb3I6IGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC5lcnJvclxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjYWxsYmFjayAmJiAhVmFsaWRhdG9ycy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkge1xuICAgICAgICAgICAgdmFyIGVycm9yID0gJ1RoZSBvcHRpb25hbCBjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24uIFlvdSB0cmllZCBlbnRlcmluZyBhKG4pICcgKyB0eXBlb2YgY2FsbGJhY2s7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvclxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQud2FybmluZykge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnV0FSTklORzonICsgaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0Lndhcm5pbmcpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB2YWxpZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlcnJvcjogaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0Lndhcm5pbmdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsaWQ6IHRydWVcbiAgICAgICAgfTtcbiAgICB9LFxuXG4gICAgY3JlYXRlSWRlbnRpdHlSZXF1ZXN0OiBmdW5jdGlvbihpZGVudGl0eUFwaURhdGEsIHBsYXRmb3JtLCBzZGtWZW5kb3IsIHNka1ZlcnNpb24sIGRldmljZUlkLCBjb250ZXh0LCBtcGlkKSB7XG4gICAgICAgIHZhciBBUElSZXF1ZXN0ID0ge1xuICAgICAgICAgICAgY2xpZW50X3Nkazoge1xuICAgICAgICAgICAgICAgIHBsYXRmb3JtOiBwbGF0Zm9ybSxcbiAgICAgICAgICAgICAgICBzZGtfdmVuZG9yOiBzZGtWZW5kb3IsXG4gICAgICAgICAgICAgICAgc2RrX3ZlcnNpb246IHNka1ZlcnNpb25cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb250ZXh0OiBjb250ZXh0LFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IG1QYXJ0aWNsZS5pc0RldmVsb3BtZW50TW9kZSA/ICdkZXZlbG9wbWVudCcgOiAncHJvZHVjdGlvbicsXG4gICAgICAgICAgICByZXF1ZXN0X2lkOiBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKSxcbiAgICAgICAgICAgIHJlcXVlc3RfdGltZXN0YW1wX21zOiBuZXcgRGF0ZSgpLmdldFRpbWUoKSxcbiAgICAgICAgICAgIHByZXZpb3VzX21waWQ6IG1waWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGtub3duX2lkZW50aXRpZXM6IHRoaXMuY3JlYXRlS25vd25JZGVudGl0aWVzKGlkZW50aXR5QXBpRGF0YSwgZGV2aWNlSWQpXG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIEFQSVJlcXVlc3Q7XG4gICAgfSxcblxuICAgIGNyZWF0ZU1vZGlmeUlkZW50aXR5UmVxdWVzdDogZnVuY3Rpb24oY3VycmVudFVzZXJJZGVudGl0aWVzLCBuZXdVc2VySWRlbnRpdGllcywgcGxhdGZvcm0sIHNka1ZlbmRvciwgc2RrVmVyc2lvbiwgY29udGV4dCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY2xpZW50X3Nkazoge1xuICAgICAgICAgICAgICAgIHBsYXRmb3JtOiBwbGF0Zm9ybSxcbiAgICAgICAgICAgICAgICBzZGtfdmVuZG9yOiBzZGtWZW5kb3IsXG4gICAgICAgICAgICAgICAgc2RrX3ZlcnNpb246IHNka1ZlcnNpb25cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb250ZXh0OiBjb250ZXh0LFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IG1QYXJ0aWNsZS5pc0RldmVsb3BtZW50TW9kZSA/ICdkZXZlbG9wbWVudCcgOiAncHJvZHVjdGlvbicsXG4gICAgICAgICAgICByZXF1ZXN0X2lkOiBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKSxcbiAgICAgICAgICAgIHJlcXVlc3RfdGltZXN0YW1wX21zOiBuZXcgRGF0ZSgpLmdldFRpbWUoKSxcbiAgICAgICAgICAgIGlkZW50aXR5X2NoYW5nZXM6IHRoaXMuY3JlYXRlSWRlbnRpdHlDaGFuZ2VzKGN1cnJlbnRVc2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMpXG4gICAgICAgIH07XG4gICAgfSxcblxuICAgIGNyZWF0ZUlkZW50aXR5Q2hhbmdlczogZnVuY3Rpb24ocHJldmlvdXNJZGVudGl0aWVzLCBuZXdJZGVudGl0aWVzKSB7XG4gICAgICAgIHZhciBpZGVudGl0eUNoYW5nZXMgPSBbXTtcbiAgICAgICAgdmFyIGtleTtcbiAgICAgICAgaWYgKG5ld0lkZW50aXRpZXMgJiYgSGVscGVycy5pc09iamVjdChuZXdJZGVudGl0aWVzKSAmJiBwcmV2aW91c0lkZW50aXRpZXMgJiYgSGVscGVycy5pc09iamVjdChwcmV2aW91c0lkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICBmb3IgKGtleSBpbiBuZXdJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWRlbnRpdHlDaGFuZ2VzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBvbGRfdmFsdWU6IHByZXZpb3VzSWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKGtleSldIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIG5ld192YWx1ZTogbmV3SWRlbnRpdGllc1trZXldLFxuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eV90eXBlOiBrZXlcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpZGVudGl0eUNoYW5nZXM7XG4gICAgfSxcblxuICAgIG1vZGlmeVVzZXJJZGVudGl0aWVzOiBmdW5jdGlvbihwcmV2aW91c1VzZXJJZGVudGl0aWVzLCBuZXdVc2VySWRlbnRpdGllcykge1xuICAgICAgICB2YXIgbW9kaWZpZWRVc2VySWRlbnRpdGllcyA9IHt9O1xuXG4gICAgICAgIGZvciAodmFyIGtleSBpbiBuZXdVc2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgbW9kaWZpZWRVc2VySWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKGtleSldID0gbmV3VXNlcklkZW50aXRpZXNba2V5XTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoa2V5IGluIHByZXZpb3VzVXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgIGlmICghbW9kaWZpZWRVc2VySWRlbnRpdGllc1trZXldKSB7XG4gICAgICAgICAgICAgICAgbW9kaWZpZWRVc2VySWRlbnRpdGllc1trZXldID0gcHJldmlvdXNVc2VySWRlbnRpdGllc1trZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG1vZGlmaWVkVXNlcklkZW50aXRpZXM7XG4gICAgfSxcblxuICAgIGNvbnZlcnRUb05hdGl2ZTogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgICAgIHZhciBuYXRpdmVJZGVudGl0eVJlcXVlc3QgPSBbXTtcbiAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YSAmJiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgbmF0aXZlSWRlbnRpdHlSZXF1ZXN0LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgVHlwZTogVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShrZXkpLFxuICAgICAgICAgICAgICAgICAgICAgICAgSWRlbnRpdHk6IGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllc1trZXldXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBVc2VySWRlbnRpdGllczogbmF0aXZlSWRlbnRpdHlSZXF1ZXN0XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxufTtcbi8qKlxuKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlLklkZW50aXR5IG9iamVjdC5cbiogRXhhbXBsZTogbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkuXG4qIEBjbGFzcyBtUGFydGljbGUuSWRlbnRpdHlcbiovXG52YXIgSWRlbnRpdHlBUEkgPSB7XG4gICAgSFRUUENvZGVzOiBIVFRQQ29kZXMsXG4gICAgLyoqXG4gICAgKiBJbml0aWF0ZSBhIGxvZ291dCByZXF1ZXN0IHRvIHRoZSBtUGFydGljbGUgc2VydmVyXG4gICAgKiBAbWV0aG9kIGlkZW50aWZ5XG4gICAgKiBAcGFyYW0ge09iamVjdH0gaWRlbnRpdHlBcGlEYXRhIFRoZSBpZGVudGl0eUFwaURhdGEgb2JqZWN0IGFzIGluZGljYXRlZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvUkVBRE1FLm1kIzEtY3VzdG9taXplLXRoZS1zZGspXG4gICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIEEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiB0aGUgaWRlbnRpZnkgcmVxdWVzdCBjb21wbGV0ZXNcbiAgICAqL1xuICAgIGlkZW50aWZ5OiBmdW5jdGlvbihpZGVudGl0eUFwaURhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBwcmVQcm9jZXNzUmVzdWx0ID0gSWRlbnRpdHlSZXF1ZXN0LnByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaywgJ2lkZW50aWZ5Jyk7XG5cbiAgICAgICAgaWYgKHByZVByb2Nlc3NSZXN1bHQudmFsaWQpIHtcbiAgICAgICAgICAgIHZhciBpZGVudGl0eUFwaVJlcXVlc3QgPSBJZGVudGl0eVJlcXVlc3QuY3JlYXRlSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgQ29uc3RhbnRzLnBsYXRmb3JtLCBDb25zdGFudHMuc2RrVmVuZG9yLCBDb25zdGFudHMuc2RrVmVyc2lvbiwgTVAuZGV2aWNlSWQsIE1QLmNvbnRleHQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuSWRlbnRpZnksIEpTT04uc3RyaW5naWZ5KElkZW50aXR5UmVxdWVzdC5jb252ZXJ0VG9OYXRpdmUoaWRlbnRpdHlBcGlEYXRhKSkpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubmF0aXZlSWRlbnRpdHlSZXF1ZXN0LCAnSWRlbnRpZnkgcmVxdWVzdCBzZW50IHRvIG5hdGl2ZSBzZGsnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgJ2lkZW50aWZ5JywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBsb2dvdXQgcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBsb2dvdXRcbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBpZGVudGl0eUFwaURhdGEgVGhlIGlkZW50aXR5QXBpRGF0YSBvYmplY3QgYXMgaW5kaWNhdGVkIFtoZXJlXShodHRwczovL2dpdGh1Yi5jb20vbVBhcnRpY2xlL21wYXJ0aWNsZS1zZGstamF2YXNjcmlwdC9ibG9iL21hc3Rlci12Mi9SRUFETUUubWQjMS1jdXN0b21pemUtdGhlLXNkaylcbiAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gQSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGlzIGNhbGxlZCB3aGVuIHRoZSBsb2dvdXQgcmVxdWVzdCBjb21wbGV0ZXNcbiAgICAqL1xuICAgIGxvZ291dDogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcHJlUHJvY2Vzc1Jlc3VsdCA9IElkZW50aXR5UmVxdWVzdC5wcmVQcm9jZXNzSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssICdsb2dvdXQnKTtcblxuICAgICAgICBpZiAocHJlUHJvY2Vzc1Jlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgdmFyIGV2dCxcbiAgICAgICAgICAgICAgICBpZGVudGl0eUFwaVJlcXVlc3QgPSBJZGVudGl0eVJlcXVlc3QuY3JlYXRlSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgQ29uc3RhbnRzLnBsYXRmb3JtLCBDb25zdGFudHMuc2RrVmVuZG9yLCBDb25zdGFudHMuc2RrVmVyc2lvbiwgTVAuZGV2aWNlSWQsIE1QLmNvbnRleHQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTG9nb3V0LCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ0xvZ291dCByZXF1ZXN0IHNlbnQgdG8gbmF0aXZlIHNkaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbmRJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlSZXF1ZXN0LCAnbG9nb3V0JywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICAgICAgZXZ0ID0gU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QoVHlwZXMuTWVzc2FnZVR5cGUuUHJvZmlsZSk7XG4gICAgICAgICAgICAgICAgICAgIGV2dC5Qcm9maWxlTWVzc2FnZVR5cGUgPSBUeXBlcy5Qcm9maWxlTWVzc2FnZVR5cGUuTG9nb3V0O1xuICAgICAgICAgICAgICAgICAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZm9yd2FyZGVyLmxvZ091dCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3J3YXJkZXIubG9nT3V0KGV2dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBsb2dpbiByZXF1ZXN0IHRvIHRoZSBtUGFydGljbGUgc2VydmVyXG4gICAgKiBAbWV0aG9kIGxvZ2luXG4gICAgKiBAcGFyYW0ge09iamVjdH0gaWRlbnRpdHlBcGlEYXRhIFRoZSBpZGVudGl0eUFwaURhdGEgb2JqZWN0IGFzIGluZGljYXRlZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvUkVBRE1FLm1kIzEtY3VzdG9taXplLXRoZS1zZGspXG4gICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIEEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiB0aGUgbG9naW4gcmVxdWVzdCBjb21wbGV0ZXNcbiAgICAqL1xuICAgIGxvZ2luOiBmdW5jdGlvbihpZGVudGl0eUFwaURhdGEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBwcmVQcm9jZXNzUmVzdWx0ID0gSWRlbnRpdHlSZXF1ZXN0LnByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaywgJ2xvZ2luJyk7XG5cbiAgICAgICAgaWYgKHByZVByb2Nlc3NSZXN1bHQudmFsaWQpIHtcbiAgICAgICAgICAgIHZhciBpZGVudGl0eUFwaVJlcXVlc3QgPSBJZGVudGl0eVJlcXVlc3QuY3JlYXRlSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgQ29uc3RhbnRzLnBsYXRmb3JtLCBDb25zdGFudHMuc2RrVmVuZG9yLCBDb25zdGFudHMuc2RrVmVyc2lvbiwgTVAuZGV2aWNlSWQsIE1QLmNvbnRleHQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTG9naW4sIEpTT04uc3RyaW5naWZ5KElkZW50aXR5UmVxdWVzdC5jb252ZXJ0VG9OYXRpdmUoaWRlbnRpdHlBcGlEYXRhKSkpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubmF0aXZlSWRlbnRpdHlSZXF1ZXN0LCAnTG9naW4gcmVxdWVzdCBzZW50IHRvIG5hdGl2ZSBzZGsnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgJ2xvZ2luJywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBtb2RpZnkgcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBtb2RpZnlcbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBpZGVudGl0eUFwaURhdGEgVGhlIGlkZW50aXR5QXBpRGF0YSBvYmplY3QgYXMgaW5kaWNhdGVkIFtoZXJlXShodHRwczovL2dpdGh1Yi5jb20vbVBhcnRpY2xlL21wYXJ0aWNsZS1zZGstamF2YXNjcmlwdC9ibG9iL21hc3Rlci12Mi9SRUFETUUubWQjMS1jdXN0b21pemUtdGhlLXNkaylcbiAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gQSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGlzIGNhbGxlZCB3aGVuIHRoZSBtb2RpZnkgcmVxdWVzdCBjb21wbGV0ZXNcbiAgICAqL1xuICAgIG1vZGlmeTogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgbmV3VXNlcklkZW50aXRpZXMgPSAoaWRlbnRpdHlBcGlEYXRhICYmIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykgPyBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgOiB7fTtcbiAgICAgICAgdmFyIHByZVByb2Nlc3NSZXN1bHQgPSBJZGVudGl0eVJlcXVlc3QucHJlUHJvY2Vzc0lkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIGNhbGxiYWNrLCAnbW9kaWZ5Jyk7XG4gICAgICAgIGlmIChwcmVQcm9jZXNzUmVzdWx0LnZhbGlkKSB7XG4gICAgICAgICAgICB2YXIgaWRlbnRpdHlBcGlSZXF1ZXN0ID0gSWRlbnRpdHlSZXF1ZXN0LmNyZWF0ZU1vZGlmeUlkZW50aXR5UmVxdWVzdChNUC51c2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMsIENvbnN0YW50cy5wbGF0Zm9ybSwgQ29uc3RhbnRzLnNka1ZlbmRvciwgQ29uc3RhbnRzLnNka1ZlcnNpb24sIE1QLmNvbnRleHQpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTW9kaWZ5LCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ01vZGlmeSByZXF1ZXN0IHNlbnQgdG8gbmF0aXZlIHNkaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbmRJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlSZXF1ZXN0LCAnbW9kaWZ5JywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogUmV0dXJucyBhIHVzZXIgb2JqZWN0IHdpdGggbWV0aG9kcyB0byBpbnRlcmFjdCB3aXRoIHRoZSBjdXJyZW50IHVzZXJcbiAgICAqIEBtZXRob2QgZ2V0Q3VycmVudFVzZXJcbiAgICAqIEByZXR1cm4ge09iamVjdH0gdGhlIGN1cnJlbnQgdXNlciBvYmplY3RcbiAgICAqL1xuICAgIGdldEN1cnJlbnRVc2VyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG1waWQgPSBNUC5tcGlkO1xuICAgICAgICBpZiAobXBpZCkge1xuICAgICAgICAgICAgbXBpZCA9IE1QLm1waWQuc2xpY2UoKTtcbiAgICAgICAgICAgIHJldHVybiBtUGFydGljbGVVc2VyKG1waWQsIE1QLmlzTG9nZ2VkSW4pO1xuICAgICAgICB9IGVsc2UgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgKiBSZXR1cm5zIGEgdGhlIHVzZXIgb2JqZWN0IGFzc29jaWF0ZWQgd2l0aCB0aGUgbXBpZCBwYXJhbWV0ZXIgb3IgJ251bGwnIGlmIG5vIHN1Y2hcbiAgICAqIHVzZXIgZXhpc3RzXG4gICAgKiBAbWV0aG9kIGdldFVzZXJcbiAgICAqIEBwYXJhbSB7U3RyaW5nfSBtcGlkIG9mIHRoZSBkZXNpcmVkIHVzZXJcbiAgICAqIEByZXR1cm4ge09iamVjdH0gdGhlIHVzZXIgZm9yICBtcGlkXG4gICAgKi9cbiAgICBnZXRVc2VyOiBmdW5jdGlvbihtcGlkKSB7XG4gICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcbiAgICAgICAgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgIGlmIChjb29raWVzW21waWRdICYmICFDb25zdGFudHMuU0RLdjJOb25NUElEQ29va2llS2V5cy5oYXNPd25Qcm9wZXJ0eShtcGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBtUGFydGljbGVVc2VyKG1waWQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICogUmV0dXJucyBhbGwgdXNlcnMsIGluY2x1ZGluZyB0aGUgY3VycmVudCB1c2VyIGFuZCBhbGwgcHJldmlvdXMgdXNlcnMgdGhhdCBhcmUgc3RvcmVkIG9uIHRoZSBkZXZpY2UuXG4gICAgKiBAbWV0aG9kIGdldFVzZXJzXG4gICAgKiBAcmV0dXJuIHtBcnJheX0gYXJyYXkgb2YgdXNlcnNcbiAgICAqL1xuICAgIGdldFVzZXJzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRQZXJzaXN0ZW5jZSgpO1xuICAgICAgICB2YXIgdXNlcnMgPSBbXTtcbiAgICAgICAgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFDb25zdGFudHMuU0RLdjJOb25NUElEQ29va2llS2V5cy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJzLnB1c2gobVBhcnRpY2xlVXNlcihrZXkpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVzZXJzO1xuICAgIH1cbn07XG5cbi8qKlxuKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkgb2JqZWN0LlxuKiBFeGFtcGxlOiBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRBbGxVc2VyQXR0cmlidXRlcygpXG4qIEBjbGFzcyBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKVxuKi9cbmZ1bmN0aW9uIG1QYXJ0aWNsZVVzZXIobXBpZCwgaXNMb2dnZWRJbikge1xuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCB1c2VyIGlkZW50aXRpZXMgZm9yIGN1cnJlbnQgdXNlclxuICAgICAgICAqIEBtZXRob2QgZ2V0VXNlcklkZW50aXRpZXNcbiAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IGFuIG9iamVjdCB3aXRoIHVzZXJJZGVudGl0aWVzIGFzIGl0cyBrZXlcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0VXNlcklkZW50aXRpZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRVc2VySWRlbnRpdGllcyA9IHt9O1xuXG4gICAgICAgICAgICB2YXIgaWRlbnRpdGllcyA9IFBlcnNpc3RlbmNlLmdldFVzZXJJZGVudGl0aWVzKG1waWQpO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBpZGVudGl0eVR5cGUgaW4gaWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgIGlmIChpZGVudGl0aWVzLmhhc093blByb3BlcnR5KGlkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFVzZXJJZGVudGl0aWVzW1R5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eU5hbWUoSGVscGVycy5wYXJzZU51bWJlcihpZGVudGl0eVR5cGUpKV0gPSBpZGVudGl0aWVzW2lkZW50aXR5VHlwZV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0aWVzOiBjdXJyZW50VXNlcklkZW50aXRpZXNcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCB0aGUgTVBJRCBvZiB0aGUgY3VycmVudCB1c2VyXG4gICAgICAgICogQG1ldGhvZCBnZXRNUElEXG4gICAgICAgICogQHJldHVybiB7U3RyaW5nfSB0aGUgY3VycmVudCB1c2VyIE1QSUQgYXMgYSBzdHJpbmdcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0TVBJRDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbXBpZDtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyBhIHVzZXIgdGFnXG4gICAgICAgICogQG1ldGhvZCBzZXRVc2VyVGFnXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHRhZ05hbWVcbiAgICAgICAgKi9cbiAgICAgICAgc2V0VXNlclRhZzogZnVuY3Rpb24odGFnTmFtZSkge1xuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZSh0YWdOYW1lKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRLZXkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5zZXRVc2VyQXR0cmlidXRlKHRhZ05hbWUsIG51bGwpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZW1vdmVzIGEgdXNlciB0YWdcbiAgICAgICAgKiBAbWV0aG9kIHJlbW92ZVVzZXJUYWdcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gdGFnTmFtZVxuICAgICAgICAqL1xuICAgICAgICByZW1vdmVVc2VyVGFnOiBmdW5jdGlvbih0YWdOYW1lKSB7XG4gICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEtleVZhbHVlKHRhZ05hbWUpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZEtleSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLnJlbW92ZVVzZXJBdHRyaWJ1dGUodGFnTmFtZSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSB1c2VyIGF0dHJpYnV0ZVxuICAgICAgICAqIEBtZXRob2Qgc2V0VXNlckF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWVcbiAgICAgICAgKi9cbiAgICAgICAgc2V0VXNlckF0dHJpYnV0ZTogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMsXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXM7XG5cbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkQXR0cmlidXRlVmFsdWUodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRBdHRyaWJ1dGUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRLZXkpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuU2V0VXNlckF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6IGtleSwgdmFsdWU6IHZhbHVlIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgZXhpc3RpbmdQcm9wID0gSGVscGVycy5maW5kS2V5SW5PYmplY3QodXNlckF0dHJpYnV0ZXMsIGtleSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nUHJvcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVzZXJBdHRyaWJ1dGVzW2V4aXN0aW5nUHJvcF07XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVzICYmIGNvb2tpZXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyhtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRVc2VySWRlbnRpdGllcygpKTtcbiAgICAgICAgICAgICAgICAgICAgRm9yd2FyZGVycy5jYWxsU2V0VXNlckF0dHJpYnV0ZU9uRm9yd2FyZGVycyhrZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldCBtdWx0aXBsZSB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIHNldFVzZXJBdHRyaWJ1dGVzXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IHVzZXIgYXR0cmlidXRlIG9iamVjdCB3aXRoIGtleXMgb2YgdGhlIGF0dHJpYnV0ZSB0eXBlLCBhbmQgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB2YWx1ZVxuICAgICAgICAqL1xuICAgICAgICBzZXRVc2VyQXR0cmlidXRlczogZnVuY3Rpb24odXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QodXNlckF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0VXNlckF0dHJpYnV0ZShrZXksIHVzZXJBdHRyaWJ1dGVzW2tleV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmRlYnVnKCdNdXN0IHBhc3MgYW4gb2JqZWN0IGludG8gc2V0VXNlckF0dHJpYnV0ZXMuIFlvdSBwYXNzZWQgYSAnICsgdHlwZW9mIHVzZXJBdHRyaWJ1dGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhIHNwZWNpZmljIHVzZXIgYXR0cmlidXRlXG4gICAgICAgICogQG1ldGhvZCByZW1vdmVVc2VyQXR0cmlidXRlXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAgICAqL1xuICAgICAgICByZW1vdmVVc2VyQXR0cmlidXRlOiBmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzLCB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEtleVZhbHVlKGtleSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5SZW1vdmVVc2VyQXR0cmlidXRlLCBKU09OLnN0cmluZ2lmeSh7IGtleToga2V5LCB2YWx1ZTogbnVsbCB9KSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRQZXJzaXN0ZW5jZSgpO1xuXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG5cbiAgICAgICAgICAgICAgICB2YXIgZXhpc3RpbmdQcm9wID0gSGVscGVycy5maW5kS2V5SW5PYmplY3QodXNlckF0dHJpYnV0ZXMsIGtleSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdQcm9wKSB7XG4gICAgICAgICAgICAgICAgICAgIGtleSA9IGV4aXN0aW5nUHJvcDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBkZWxldGUgdXNlckF0dHJpYnV0ZXNba2V5XTtcblxuICAgICAgICAgICAgICAgIGlmIChjb29raWVzICYmIGNvb2tpZXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llc1ttcGlkXS51YSA9IHVzZXJBdHRyaWJ1dGVzO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGVPbmx5Q29va2llVXNlckF0dHJpYnV0ZXMoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuaW5pdEZvcndhcmRlcnMobVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkuZ2V0VXNlcklkZW50aXRpZXMoKSk7XG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5hcHBseVRvRm9yd2FyZGVycygncmVtb3ZlVXNlckF0dHJpYnV0ZScsIGtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSBsaXN0IG9mIHVzZXIgYXR0cmlidXRlc1xuICAgICAgICAqIEBtZXRob2Qgc2V0VXNlckF0dHJpYnV0ZUxpc3RcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gICAgICAgICogQHBhcmFtIHtBcnJheX0gdmFsdWUgYW4gYXJyYXkgb2YgdmFsdWVzXG4gICAgICAgICovXG4gICAgICAgIHNldFVzZXJBdHRyaWJ1dGVMaXN0OiBmdW5jdGlvbihrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICB2YXIgY29va2llcywgdXNlckF0dHJpYnV0ZXM7XG5cbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEtleVZhbHVlKGtleSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgdmFsdWUgeW91IHBhc3NlZCBpbiB0byBzZXRVc2VyQXR0cmlidXRlTGlzdCBtdXN0IGJlIGFuIGFycmF5LiBZb3UgcGFzc2VkIGluIGEgJyArIHR5cGVvZiB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgYXJyYXlDb3B5ID0gdmFsdWUuc2xpY2UoKTtcblxuICAgICAgICAgICAgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLlNldFVzZXJBdHRyaWJ1dGVMaXN0LCBKU09OLnN0cmluZ2lmeSh7IGtleToga2V5LCB2YWx1ZTogYXJyYXlDb3B5IH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcblxuICAgICAgICAgICAgICAgIHZhciBleGlzdGluZ1Byb3AgPSBIZWxwZXJzLmZpbmRLZXlJbk9iamVjdCh1c2VyQXR0cmlidXRlcywga2V5KTtcblxuICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1Byb3ApIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVzZXJBdHRyaWJ1dGVzW2V4aXN0aW5nUHJvcF07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNba2V5XSA9IGFycmF5Q29weTtcbiAgICAgICAgICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzKGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldFVzZXJJZGVudGl0aWVzKCkpO1xuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuY2FsbFNldFVzZXJBdHRyaWJ1dGVPbkZvcndhcmRlcnMoa2V5LCBhcnJheUNvcHkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZW1vdmVzIGFsbCB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIHJlbW92ZUFsbFVzZXJBdHRyaWJ1dGVzXG4gICAgICAgICovXG4gICAgICAgIHJlbW92ZUFsbFVzZXJBdHRyaWJ1dGVzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzLCB1c2VyQXR0cmlidXRlcztcblxuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5SZW1vdmVBbGxVc2VyQXR0cmlidXRlcyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRQZXJzaXN0ZW5jZSgpO1xuXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG5cbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldFVzZXJJZGVudGl0aWVzKCkpO1xuICAgICAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmFwcGx5VG9Gb3J3YXJkZXJzKCdyZW1vdmVVc2VyQXR0cmlidXRlJywgcHJvcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzKGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgYWxsIHVzZXIgYXR0cmlidXRlIGtleXMgdGhhdCBoYXZlIHZhbHVlcyB0aGF0IGFyZSBhcnJheXNcbiAgICAgICAgKiBAbWV0aG9kIGdldFVzZXJBdHRyaWJ1dGVzTGlzdHNcbiAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IGFuIG9iamVjdCBvZiBvbmx5IGtleXMgd2l0aCBhcnJheSB2YWx1ZXMuIEV4YW1wbGU6IHsgYXR0cjE6IFsxLCAyLCAzXSwgYXR0cjI6IFsnYScsICdiJywgJ2MnXSB9XG4gICAgICAgICovXG4gICAgICAgIGdldFVzZXJBdHRyaWJ1dGVzTGlzdHM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHMgPSB7fTtcblxuICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoa2V5KSAmJiBBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW2tleV0pKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHNba2V5XSA9IHVzZXJBdHRyaWJ1dGVzW2tleV0uc2xpY2UoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB1c2VyQXR0cmlidXRlc0xpc3RzO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZXR1cm5zIGFsbCB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIGdldEFsbFVzZXJBdHRyaWJ1dGVzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgb2YgYWxsIHVzZXIgYXR0cmlidXRlcy4gRXhhbXBsZTogeyBhdHRyMTogJ3ZhbHVlMScsIGF0dHIyOiBbJ2EnLCAnYicsICdjJ10gfVxuICAgICAgICAqL1xuICAgICAgICBnZXRBbGxVc2VyQXR0cmlidXRlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXNDb3B5ID0ge307XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXMgPSBQZXJzaXN0ZW5jZS5nZXRBbGxVc2VyQXR0cmlidXRlcyhtcGlkKTtcblxuICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW3Byb3BdKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzQ29weVtwcm9wXSA9IHVzZXJBdHRyaWJ1dGVzW3Byb3BdLnNsaWNlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHlbcHJvcF0gPSB1c2VyQXR0cmlidXRlc1twcm9wXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHVzZXJBdHRyaWJ1dGVzQ29weTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgY2FydCBvYmplY3QgZm9yIHRoZSBjdXJyZW50IHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIGdldENhcnRcbiAgICAgICAgKiBAcmV0dXJuIGEgY2FydCBvYmplY3RcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q2FydDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlckNhcnQobXBpZCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgQ29uc2VudCBTdGF0ZSBzdG9yZWQgbG9jYWxseSBmb3IgdGhpcyB1c2VyLlxuICAgICAgICAqIEBtZXRob2QgZ2V0Q29uc2VudFN0YXRlXG4gICAgICAgICogQHJldHVybiBhIENvbnNlbnRTdGF0ZSBvYmplY3RcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q29uc2VudFN0YXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBQZXJzaXN0ZW5jZS5nZXRDb25zZW50U3RhdGUobXBpZCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgdGhlIENvbnNlbnQgU3RhdGUgc3RvcmVkIGxvY2FsbHkgZm9yIHRoaXMgdXNlci5cbiAgICAgICAgKiBAbWV0aG9kIHNldENvbnNlbnRTdGF0ZVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBjb25zZW50IHN0YXRlXG4gICAgICAgICovXG4gICAgICAgIHNldENvbnNlbnRTdGF0ZTogZnVuY3Rpb24oc3RhdGUpIHtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnNldENvbnNlbnRTdGF0ZShtcGlkLCBzdGF0ZSk7XG4gICAgICAgICAgICBpZiAoTVAubXBpZCA9PT0gdGhpcy5nZXRNUElEKCkpIHtcbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKHRoaXMuZ2V0VXNlcklkZW50aXRpZXMoKS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGlzTG9nZ2VkSW46IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIGlzTG9nZ2VkSW47XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKSBvYmplY3QuXG4qIEV4YW1wbGU6IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKS5hZGQoLi4uKTtcbiogQGNsYXNzIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKVxuKi9cbmZ1bmN0aW9uIG1QYXJ0aWNsZVVzZXJDYXJ0KG1waWQpe1xuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAqIEFkZHMgYSBjYXJ0IHByb2R1Y3QgdG8gdGhlIHVzZXIgY2FydFxuICAgICAgICAqIEBtZXRob2QgYWRkXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3RcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtsb2dFdmVudF0gYSBib29sZWFuIHRvIGxvZyBhZGRpbmcgb2YgdGhlIGNhcnQgb2JqZWN0LiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICovXG4gICAgICAgIGFkZDogZnVuY3Rpb24ocHJvZHVjdCwgbG9nRXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBhbGxQcm9kdWN0cyxcbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMsXG4gICAgICAgICAgICAgICAgYXJyYXlDb3B5O1xuXG4gICAgICAgICAgICBhcnJheUNvcHkgPSBBcnJheS5pc0FycmF5KHByb2R1Y3QpID8gcHJvZHVjdC5zbGljZSgpIDogW3Byb2R1Y3RdO1xuICAgICAgICAgICAgYXJyYXlDb3B5LmZvckVhY2goZnVuY3Rpb24ocHJvZHVjdCkge1xuICAgICAgICAgICAgICAgIHByb2R1Y3QuQXR0cmlidXRlcyA9IEhlbHBlcnMuc2FuaXRpemVBdHRyaWJ1dGVzKHByb2R1Y3QuQXR0cmlidXRlcyk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLkFkZFRvQ2FydCwgSlNPTi5zdHJpbmdpZnkoYXJyYXlDb3B5KSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG5cblxuICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmdldFVzZXJQcm9kdWN0c0Zyb21MUyhtcGlkKTtcblxuICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IHVzZXJQcm9kdWN0cy5jb25jYXQoYXJyYXlDb3B5KTtcblxuICAgICAgICAgICAgICAgIGlmIChsb2dFdmVudCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICBFdmVudHMubG9nUHJvZHVjdEFjdGlvbkV2ZW50KFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydCwgYXJyYXlDb3B5KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgcHJvZHVjdHNGb3JNZW1vcnkgPSB7fTtcbiAgICAgICAgICAgICAgICBwcm9kdWN0c0Zvck1lbW9yeVttcGlkXSA9IHtjcDogdXNlclByb2R1Y3RzfTtcbiAgICAgICAgICAgICAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZVByb2R1Y3RzSW5NZW1vcnkocHJvZHVjdHNGb3JNZW1vcnksIG1waWQpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh1c2VyUHJvZHVjdHMubGVuZ3RoID4gbVBhcnRpY2xlLm1heFByb2R1Y3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RoZSBjYXJ0IGNvbnRhaW5zICcgKyB1c2VyUHJvZHVjdHMubGVuZ3RoICsgJyBpdGVtcy4gT25seSBtUGFydGljbGUubWF4UHJvZHVjdHMgPSAnICsgbVBhcnRpY2xlLm1heFByb2R1Y3RzICsgJyBjYW4gY3VycmVudGx5IGJlIHNhdmVkIGluIGNvb2tpZXMuJyk7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IHVzZXJQcm9kdWN0cy5zbGljZSgwLCBtUGFydGljbGUubWF4UHJvZHVjdHMpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzID0gUGVyc2lzdGVuY2UuZ2V0QWxsVXNlclByb2R1Y3RzRnJvbUxTKCk7XG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHNbbXBpZF0uY3AgPSB1c2VyUHJvZHVjdHM7XG5cbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zZXRDYXJ0UHJvZHVjdHMoYWxsUHJvZHVjdHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZW1vdmVzIGEgY2FydCBwcm9kdWN0IGZyb20gdGhlIGN1cnJlbnQgdXNlciBjYXJ0XG4gICAgICAgICogQG1ldGhvZCByZW1vdmVcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCB0aGUgcHJvZHVjdFxuICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2xvZ0V2ZW50XSBhIGJvb2xlYW4gdG8gbG9nIGFkZGluZyBvZiB0aGUgY2FydCBvYmplY3QuIElmIGJsYW5rLCBubyBsb2dnaW5nIG9jY3Vycy5cbiAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlOiBmdW5jdGlvbihwcm9kdWN0LCBsb2dFdmVudCkge1xuICAgICAgICAgICAgdmFyIGFsbFByb2R1Y3RzLFxuICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyxcbiAgICAgICAgICAgICAgICBjYXJ0SW5kZXggPSAtMSxcbiAgICAgICAgICAgICAgICBjYXJ0SXRlbSA9IG51bGw7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5SZW1vdmVGcm9tQ2FydCwgSlNPTi5zdHJpbmdpZnkocHJvZHVjdCkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmdldFVzZXJQcm9kdWN0c0Zyb21MUyhtcGlkKTtcblxuICAgICAgICAgICAgICAgIGlmICh1c2VyUHJvZHVjdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzLmZvckVhY2goZnVuY3Rpb24oY2FydFByb2R1Y3QsIGkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjYXJ0UHJvZHVjdC5Ta3UgPT09IHByb2R1Y3QuU2t1KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FydEluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXJ0SXRlbSA9IGNhcnRQcm9kdWN0O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY2FydEluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cy5zcGxpY2UoY2FydEluZGV4LCAxKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGxvZ0V2ZW50ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydCwgY2FydEl0ZW0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIHByb2R1Y3RzRm9yTWVtb3J5ID0ge307XG4gICAgICAgICAgICAgICAgcHJvZHVjdHNGb3JNZW1vcnlbbXBpZF0gPSB7Y3A6IHVzZXJQcm9kdWN0c307XG4gICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVQcm9kdWN0c0luTWVtb3J5KHByb2R1Y3RzRm9yTWVtb3J5LCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBhbGxQcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmdldEFsbFVzZXJQcm9kdWN0c0Zyb21MUygpO1xuXG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHNbbXBpZF0uY3AgPSB1c2VyUHJvZHVjdHM7XG5cbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zZXRDYXJ0UHJvZHVjdHMoYWxsUHJvZHVjdHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBDbGVhcnMgdGhlIHVzZXIncyBjYXJ0XG4gICAgICAgICogQG1ldGhvZCBjbGVhclxuICAgICAgICAqL1xuICAgICAgICBjbGVhcjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgYWxsUHJvZHVjdHM7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5DbGVhckNhcnQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBhbGxQcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmdldEFsbFVzZXJQcm9kdWN0c0Zyb21MUygpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFsbFByb2R1Y3RzICYmIGFsbFByb2R1Y3RzW21waWRdICYmIGFsbFByb2R1Y3RzW21waWRdLmNwKSB7XG4gICAgICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzW21waWRdLmNwID0gW107XG5cbiAgICAgICAgICAgICAgICAgICAgYWxsUHJvZHVjdHNbbXBpZF0uY3AgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlUHJvZHVjdHNJbk1lbW9yeShhbGxQcm9kdWN0cywgbXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zZXRDYXJ0UHJvZHVjdHMoYWxsUHJvZHVjdHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyBhbGwgY2FydCBwcm9kdWN0c1xuICAgICAgICAqIEBtZXRob2QgZ2V0Q2FydFByb2R1Y3RzXG4gICAgICAgICogQHJldHVybiB7QXJyYXl9IGFycmF5IG9mIGNhcnQgcHJvZHVjdHNcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q2FydFByb2R1Y3RzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBQZXJzaXN0ZW5jZS5nZXRDYXJ0UHJvZHVjdHMobXBpZCk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZUlkZW50aXR5UmVzcG9uc2UoeGhyLCBwcmV2aW91c01QSUQsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIG1ldGhvZCkge1xuICAgIHZhciBwcmV2VXNlcixcbiAgICAgICAgbmV3VXNlcixcbiAgICAgICAgaWRlbnRpdHlBcGlSZXN1bHQsXG4gICAgICAgIGluZGV4T2ZNUElEO1xuXG4gICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgcHJldlVzZXIgPSBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKTtcbiAgICB9XG5cbiAgICBNUC5pZGVudGl0eUNhbGxJbkZsaWdodCA9IGZhbHNlO1xuICAgIHRyeSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1BhcnNpbmcgaWRlbnRpdHkgcmVzcG9uc2UgZnJvbSBzZXJ2ZXInKTtcbiAgICAgICAgaWYgKHhoci5yZXNwb25zZVRleHQpIHtcbiAgICAgICAgICAgIGlkZW50aXR5QXBpUmVzdWx0ID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2VUZXh0KTtcbiAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaVJlc3VsdC5oYXNPd25Qcm9wZXJ0eSgnaXNfbG9nZ2VkX2luJykpIHtcbiAgICAgICAgICAgICAgICBNUC5pc0xvZ2dlZEluID0gaWRlbnRpdHlBcGlSZXN1bHQuaXNfbG9nZ2VkX2luO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICh4aHIuc3RhdHVzID09PSAyMDApIHtcbiAgICAgICAgICAgIGlmIChtZXRob2QgPT09ICdtb2RpZnknKSB7XG4gICAgICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBJZGVudGl0eVJlcXVlc3QubW9kaWZ5VXNlcklkZW50aXRpZXMoTVAudXNlcklkZW50aXRpZXMsIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlkZW50aXR5QXBpUmVzdWx0ID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2VUZXh0KTtcblxuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1N1Y2Nlc3NmdWxseSBwYXJzZWQgSWRlbnRpdHkgUmVzcG9uc2UnKTtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlSZXN1bHQubXBpZCAmJiBpZGVudGl0eUFwaVJlc3VsdC5tcGlkICE9PSBNUC5tcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLm1waWQgPSBpZGVudGl0eUFwaVJlc3VsdC5tcGlkO1xuXG4gICAgICAgICAgICAgICAgICAgIGNoZWNrQ29va2llRm9yTVBJRChNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpbmRleE9mTVBJRCA9IE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMuaW5kZXhPZihNUC5tcGlkKTtcblxuICAgICAgICAgICAgICAgIGlmIChNUC5zZXNzaW9uSWQgJiYgTVAubXBpZCAmJiBwcmV2aW91c01QSUQgIT09IE1QLm1waWQgJiYgaW5kZXhPZk1QSUQgPCAwKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMucHVzaChNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gbmVlZCB0byB1cGRhdGUgY3VycmVudFNlc3Npb25NUElEcyBpbiBtZW1vcnkgYmVmb3JlIGNoZWNraW5nSWRlbnRpdHlTd2FwIG90aGVyd2lzZSBwcmV2aW91cyBvYmouY3VycmVudFNlc3Npb25NUElEcyBpcyB1c2VkIGluIGNoZWNrSWRlbnRpdHlTd2FwJ3MgUGVyc2lzdGVuY2UudXBkYXRlKClcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4T2ZNUElEID4gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcyA9IChNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnNsaWNlKDAsIGluZGV4T2ZNUElEKSkuY29uY2F0KE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMuc2xpY2UoaW5kZXhPZk1QSUQgKyAxLCBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLmxlbmd0aCkpO1xuICAgICAgICAgICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnB1c2goTVAubXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIENvb2tpZVN5bmNNYW5hZ2VyLmF0dGVtcHRDb29raWVTeW5jKHByZXZpb3VzTVBJRCwgTVAubXBpZCk7XG5cbiAgICAgICAgICAgICAgICBJZGVudGl0eS5jaGVja0lkZW50aXR5U3dhcChwcmV2aW91c01QSUQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICAgICAgSGVscGVycy5wcm9jZXNzUXVldWVkRXZlbnRzKE1QLmV2ZW50UXVldWUsIE1QLm1waWQsICFNUC5yZXF1aXJlRGVsYXksIHNlbmRFdmVudFRvU2VydmVyLCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIEV2ZW50cy5wYXJzZUV2ZW50UmVzcG9uc2UpO1xuXG4gICAgICAgICAgICAgICAgLy9pZiB0aGVyZSBpcyBhbnkgcHJldmlvdXMgbWlncmF0aW9uIGRhdGFcbiAgICAgICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoTVAubWlncmF0aW9uRGF0YSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0gTVAubWlncmF0aW9uRGF0YS51c2VySWRlbnRpdGllcyB8fCB7fTtcbiAgICAgICAgICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSBNUC5taWdyYXRpb25EYXRhLnVzZXJBdHRyaWJ1dGVzIHx8IHt9O1xuICAgICAgICAgICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSBNUC5taWdyYXRpb25EYXRhLmNvb2tpZVN5bmNEYXRlcyB8fCB7fTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhICYmIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyAmJiBPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBJZGVudGl0eVJlcXVlc3QubW9kaWZ5VXNlcklkZW50aXRpZXMoTVAudXNlcklkZW50aXRpZXMsIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UuZmluZFByZXZDb29raWVzQmFzZWRPblVJKGlkZW50aXR5QXBpRGF0YSk7XG5cbiAgICAgICAgICAgICAgICBNUC5jb250ZXh0ID0gaWRlbnRpdHlBcGlSZXN1bHQuY29udGV4dCB8fCBNUC5jb250ZXh0O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBuZXdVc2VyID0gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG5cbiAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLm9uVXNlckFsaWFzICYmIEhlbHBlcnMuVmFsaWRhdG9ycy5pc0Z1bmN0aW9uKGlkZW50aXR5QXBpRGF0YS5vblVzZXJBbGlhcykpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eUFwaURhdGEub25Vc2VyQWxpYXMocHJldlVzZXIsIG5ld1VzZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGVyZSB3YXMgYW4gZXJyb3Igd2l0aCB5b3VyIG9uVXNlckFsaWFzIGZ1bmN0aW9uIC0gJyArIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgICAgIGlmIChuZXdVc2VyKSB7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbmV3VXNlci5nZXRNUElEKCkpO1xuICAgICAgICAgICAgICAgIGlmICghcHJldlVzZXIgfHwgbmV3VXNlci5nZXRNUElEKCkgIT09IHByZXZVc2VyLmdldE1QSUQoKSB8fCBwcmV2VXNlci5pc0xvZ2dlZEluKCkgIT09IG5ld1VzZXIuaXNMb2dnZWRJbigpKSB7XG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuaW5pdEZvcndhcmRlcnMobmV3VXNlci5nZXRVc2VySWRlbnRpdGllcygpLnVzZXJJZGVudGl0aWVzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5zZXRGb3J3YXJkZXJVc2VySWRlbnRpdGllcyhuZXdVc2VyLmdldFVzZXJJZGVudGl0aWVzKCkudXNlcklkZW50aXRpZXMpO1xuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyT25JZGVudGl0eUNvbXBsZXRlKG5ld1VzZXIsIG1ldGhvZCk7XG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5zZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkKG5ld1VzZXIsIG1ldGhvZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIHhoci5zdGF0dXMsIGlkZW50aXR5QXBpUmVzdWx0IHx8IG51bGwsIG5ld1VzZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpUmVzdWx0ICYmIGlkZW50aXR5QXBpUmVzdWx0LmVycm9ycyAmJiBpZGVudGl0eUFwaVJlc3VsdC5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUmVjZWl2ZWQgSFRUUCByZXNwb25zZSBjb2RlIG9mICcgKyB4aHIuc3RhdHVzICsgJyAtICcgKyBpZGVudGl0eUFwaVJlc3VsdC5lcnJvcnNbMF0ubWVzc2FnZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCB4aHIuc3RhdHVzLCBpZGVudGl0eUFwaVJlc3VsdCB8fCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBwYXJzaW5nIEpTT04gcmVzcG9uc2UgZnJvbSBJZGVudGl0eSBzZXJ2ZXI6ICcgKyBlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNoZWNrQ29va2llRm9yTVBJRChjdXJyZW50TVBJRCkge1xuICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgaWYgKGNvb2tpZXMgJiYgIWNvb2tpZXNbY3VycmVudE1QSURdKSB7XG4gICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KG51bGwsIGN1cnJlbnRNUElEKTtcbiAgICAgICAgTVAuY2FydFByb2R1Y3RzID0gW107XG4gICAgfSBlbHNlIGlmIChjb29raWVzKSB7XG4gICAgICAgIHZhciBwcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmRlY29kZVByb2R1Y3RzKCk7XG4gICAgICAgIGlmIChwcm9kdWN0cyAmJiBwcm9kdWN0c1tjdXJyZW50TVBJRF0pIHtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IHByb2R1Y3RzW2N1cnJlbnRNUElEXS5jcDtcbiAgICAgICAgfVxuICAgICAgICBNUC51c2VySWRlbnRpdGllcyA9IGNvb2tpZXNbY3VycmVudE1QSURdLnVpIHx8IHt9O1xuICAgICAgICBNUC51c2VyQXR0cmlidXRlcyA9IGNvb2tpZXNbY3VycmVudE1QSURdLnVhIHx8IHt9O1xuICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSBjb29raWVzW2N1cnJlbnRNUElEXS5jc2QgfHwge307XG4gICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IGNvb2tpZXNbY3VycmVudE1QSURdLmNvbjtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIElkZW50aXR5QVBJOiBJZGVudGl0eUFQSSxcbiAgICBJZGVudGl0eTogSWRlbnRpdHksXG4gICAgSWRlbnRpdHlSZXF1ZXN0OiBJZGVudGl0eVJlcXVlc3QsXG4gICAgbVBhcnRpY2xlVXNlcjogbVBhcnRpY2xlVXNlcixcbiAgICBtUGFydGljbGVVc2VyQ2FydDogbVBhcnRpY2xlVXNlckNhcnRcbn07XG4iLCJ2YXIgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xuXG5mdW5jdGlvbiBnZXRGaWx0ZXJlZE1wYXJ0aWNsZVVzZXIobXBpZCwgZm9yd2FyZGVyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZ2V0VXNlcklkZW50aXRpZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRVc2VySWRlbnRpdGllcyA9IHt9O1xuICAgICAgICAgICAgdmFyIGlkZW50aXRpZXMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VySWRlbnRpdGllcyhtcGlkKTtcblxuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHlUeXBlIGluIGlkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRVc2VySWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lKEhlbHBlcnMucGFyc2VOdW1iZXIoaWRlbnRpdHlUeXBlKSldID0gaWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudFVzZXJJZGVudGl0aWVzID0gSGVscGVycy5maWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnMoY3VycmVudFVzZXJJZGVudGl0aWVzLCBmb3J3YXJkZXIudXNlcklkZW50aXR5RmlsdGVycyk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdXNlcklkZW50aXRpZXM6IGN1cnJlbnRVc2VySWRlbnRpdGllc1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0TVBJRDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbXBpZDtcbiAgICAgICAgfSxcbiAgICAgICAgZ2V0VXNlckF0dHJpYnV0ZXNMaXN0czogZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNMaXN0cyA9IHt9O1xuXG4gICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShrZXkpICYmIEFycmF5LmlzQXJyYXkodXNlckF0dHJpYnV0ZXNba2V5XSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNMaXN0c1trZXldID0gdXNlckF0dHJpYnV0ZXNba2V5XS5zbGljZSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNMaXN0cyA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXModXNlckF0dHJpYnV0ZXNMaXN0cywgZm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzKTtcblxuICAgICAgICAgICAgcmV0dXJuIHVzZXJBdHRyaWJ1dGVzTGlzdHM7XG4gICAgICAgIH0sXG4gICAgICAgIGdldEFsbFVzZXJBdHRyaWJ1dGVzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciB1c2VyQXR0cmlidXRlc0NvcHkgPSB7fTtcbiAgICAgICAgICAgIHZhciB1c2VyQXR0cmlidXRlcyA9IFBlcnNpc3RlbmNlLmdldEFsbFVzZXJBdHRyaWJ1dGVzKG1waWQpO1xuXG4gICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodXNlckF0dHJpYnV0ZXNbcHJvcF0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNDb3B5W3Byb3BdID0gdXNlckF0dHJpYnV0ZXNbcHJvcF0uc2xpY2UoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzQ29weVtwcm9wXSA9IHVzZXJBdHRyaWJ1dGVzW3Byb3BdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHkgPSBIZWxwZXJzLmZpbHRlclVzZXJBdHRyaWJ1dGVzKHVzZXJBdHRyaWJ1dGVzQ29weSwgZm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzKTtcblxuICAgICAgICAgICAgcmV0dXJuIHVzZXJBdHRyaWJ1dGVzQ29weTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGdldEZpbHRlcmVkTXBhcnRpY2xlVXNlcjogZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyXG59O1xuIiwiLy9cbi8vICBDb3B5cmlnaHQgMjAxNyBtUGFydGljbGUsIEluYy5cbi8vXG4vLyAgTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbi8vICB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4vLyAgWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4vL1xuLy8gICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbi8vXG4vLyAgVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuLy8gIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbi8vICBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbi8vICBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4vLyAgbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4vL1xuLy8gIFVzZXMgcG9ydGlvbnMgb2YgY29kZSBmcm9tIGpRdWVyeVxuLy8gIGpRdWVyeSB2MS4xMC4yIHwgKGMpIDIwMDUsIDIwMTMgalF1ZXJ5IEZvdW5kYXRpb24sIEluYy4gfCBqcXVlcnkub3JnL2xpY2Vuc2VcblxudmFyIFBvbHlmaWxsID0gcmVxdWlyZSgnLi9wb2x5ZmlsbCcpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIE5hdGl2ZVNka0hlbHBlcnMgPSByZXF1aXJlKCcuL25hdGl2ZVNka0hlbHBlcnMnKSxcbiAgICBDb29raWVTeW5jTWFuYWdlciA9IHJlcXVpcmUoJy4vY29va2llU3luY01hbmFnZXInKSxcbiAgICBTZXNzaW9uTWFuYWdlciA9IHJlcXVpcmUoJy4vc2Vzc2lvbk1hbmFnZXInKSxcbiAgICBFY29tbWVyY2UgPSByZXF1aXJlKCcuL2Vjb21tZXJjZScpLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIGdldERldmljZUlkID0gUGVyc2lzdGVuY2UuZ2V0RGV2aWNlSWQsXG4gICAgRXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBWYWxpZGF0b3JzID0gSGVscGVycy5WYWxpZGF0b3JzLFxuICAgIE1pZ3JhdGlvbnMgPSByZXF1aXJlKCcuL21pZ3JhdGlvbnMnKSxcbiAgICBGb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJyksXG4gICAgRm9yd2FyZGluZ1N0YXRzVXBsb2FkZXIgPSByZXF1aXJlKCcuL2ZvcndhcmRpbmdTdGF0c1VwbG9hZGVyJyksXG4gICAgSWRlbnRpdHlSZXF1ZXN0ID0gcmVxdWlyZSgnLi9pZGVudGl0eScpLklkZW50aXR5UmVxdWVzdCxcbiAgICBJZGVudGl0eSA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5JZGVudGl0eSxcbiAgICBJZGVudGl0eUFQSSA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5JZGVudGl0eUFQSSxcbiAgICBIVFRQQ29kZXMgPSBJZGVudGl0eUFQSS5IVFRQQ29kZXMsXG4gICAgbVBhcnRpY2xlVXNlckNhcnQgPSByZXF1aXJlKCcuL2lkZW50aXR5JykubVBhcnRpY2xlVXNlckNhcnQsXG4gICAgbVBhcnRpY2xlVXNlciA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5tUGFydGljbGVVc2VyLFxuICAgIENvbnNlbnQgPSByZXF1aXJlKCcuL2NvbnNlbnQnKTtcblxuKGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghQXJyYXkucHJvdG90eXBlLmZvckVhY2gpIHtcbiAgICAgICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2ggPSBQb2x5ZmlsbC5mb3JFYWNoO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkucHJvdG90eXBlLm1hcCkge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUubWFwID0gUG9seWZpbGwubWFwO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkucHJvdG90eXBlLmZpbHRlcikge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUuZmlsdGVyID0gUG9seWZpbGwuZmlsdGVyO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheSkge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUuaXNBcnJheSA9IFBvbHlmaWxsLmlzQXJyYXk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlIG9iamVjdC5cbiAgICAqIEV4YW1wbGU6IG1QYXJ0aWNsZS5lbmRTZXNzaW9uKClcbiAgICAqXG4gICAgKiBAY2xhc3MgbVBhcnRpY2xlXG4gICAgKi9cblxuICAgIHZhciBtUGFydGljbGUgPSB7XG4gICAgICAgIHVzZU5hdGl2ZVNkazogd2luZG93Lm1QYXJ0aWNsZSAmJiB3aW5kb3cubVBhcnRpY2xlLnVzZU5hdGl2ZVNkayA/IHdpbmRvdy5tUGFydGljbGUudXNlTmF0aXZlU2RrIDogZmFsc2UsXG4gICAgICAgIGlzSU9TOiB3aW5kb3cubVBhcnRpY2xlICYmIHdpbmRvdy5tUGFydGljbGUuaXNJT1MgPyB3aW5kb3cubVBhcnRpY2xlLmlzSU9TIDogZmFsc2UsXG4gICAgICAgIGlzRGV2ZWxvcG1lbnRNb2RlOiBmYWxzZSxcbiAgICAgICAgdXNlQ29va2llU3RvcmFnZTogZmFsc2UsXG4gICAgICAgIG1heFByb2R1Y3RzOiBDb25zdGFudHMuRGVmYXVsdENvbmZpZy5NYXhQcm9kdWN0cyxcbiAgICAgICAgbWF4Q29va2llU2l6ZTogQ29uc3RhbnRzLkRlZmF1bHRDb25maWcuTWF4Q29va2llU2l6ZSxcbiAgICAgICAgaW50ZWdyYXRpb25EZWxheVRpbWVvdXQ6IENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLkludGVncmF0aW9uRGVsYXlUaW1lb3V0LFxuICAgICAgICBpZGVudGlmeVJlcXVlc3Q6IHt9LFxuICAgICAgICBnZXREZXZpY2VJZDogZ2V0RGV2aWNlSWQsXG4gICAgICAgIGdlbmVyYXRlSGFzaDogSGVscGVycy5nZW5lcmF0ZUhhc2gsXG4gICAgICAgIHNlc3Npb25NYW5hZ2VyOiBTZXNzaW9uTWFuYWdlcixcbiAgICAgICAgY29va2llU3luY01hbmFnZXI6IENvb2tpZVN5bmNNYW5hZ2VyLFxuICAgICAgICBwZXJzaXN0ZW5jZTogUGVyc2lzdGVuY2UsXG4gICAgICAgIG1pZ3JhdGlvbnM6IE1pZ3JhdGlvbnMsXG4gICAgICAgIElkZW50aXR5OiBJZGVudGl0eUFQSSxcbiAgICAgICAgVmFsaWRhdG9yczogVmFsaWRhdG9ycyxcbiAgICAgICAgX0lkZW50aXR5OiBJZGVudGl0eSxcbiAgICAgICAgX0lkZW50aXR5UmVxdWVzdDogSWRlbnRpdHlSZXF1ZXN0LFxuICAgICAgICBJZGVudGl0eVR5cGU6IFR5cGVzLklkZW50aXR5VHlwZSxcbiAgICAgICAgRXZlbnRUeXBlOiBUeXBlcy5FdmVudFR5cGUsXG4gICAgICAgIENvbW1lcmNlRXZlbnRUeXBlOiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZSxcbiAgICAgICAgUHJvbW90aW9uVHlwZTogVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZSxcbiAgICAgICAgUHJvZHVjdEFjdGlvblR5cGU6IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLFxuICAgICAgICAvKipcbiAgICAgICAgKiBJbml0aWFsaXplcyB0aGUgbVBhcnRpY2xlIFNES1xuICAgICAgICAqXG4gICAgICAgICogQG1ldGhvZCBpbml0XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGFwaUtleSB5b3VyIG1QYXJ0aWNsZSBhc3NpZ25lZCBBUEkga2V5XG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXSBhbiBvcHRpb25zIG9iamVjdCBmb3IgYWRkaXRpb25hbCBjb25maWd1cmF0aW9uXG4gICAgICAgICovXG4gICAgICAgIGluaXQ6IGZ1bmN0aW9uKGFwaUtleSkge1xuICAgICAgICAgICAgTVAud2Vidmlld0JyaWRnZUVuYWJsZWQgPSBOYXRpdmVTZGtIZWxwZXJzLmlzV2Vidmlld0VuYWJsZWQobVBhcnRpY2xlLnJlcXVpcmVkV2Vidmlld0JyaWRnZU5hbWUsIG1QYXJ0aWNsZS5taW5XZWJ2aWV3QnJpZGdlVmVyc2lvbik7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5TZXRTZXNzaW9uQXR0cmlidXRlLCBKU09OLnN0cmluZ2lmeSh7IGtleTogJyRzcmNfZW52JywgdmFsdWU6ICd3ZWJ2aWV3JyB9KSk7XG4gICAgICAgICAgICAgICAgaWYgKGFwaUtleSkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuU2V0U2Vzc2lvbkF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6ICckc3JjX2tleScsIHZhbHVlOiBhcGlLZXl9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgY29uZmlnLCBjdXJyZW50VXNlcjtcblxuICAgICAgICAgICAgICAgIE1QLmludGVncmF0aW9uRGVsYXlUaW1lb3V0U3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgICAgIE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QgPSBtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0O1xuICAgICAgICAgICAgICAgIE1QLmRldlRva2VuID0gYXBpS2V5IHx8IG51bGw7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nSW5pdGlhbGl6YXRpb24pO1xuICAgICAgICAgICAgICAgIC8vY2hlY2sgdG8gc2VlIGlmIGxvY2FsU3RvcmFnZSBpcyBhdmFpbGFibGUgZm9yIG1pZ3JhdGluZyBwdXJwb3Nlc1xuICAgICAgICAgICAgICAgIE1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlID0gUGVyc2lzdGVuY2UuZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KHdpbmRvdy5sb2NhbFN0b3JhZ2UpO1xuXG4gICAgICAgICAgICAgICAgLy8gU2V0IGNvbmZpZ3VyYXRpb24gdG8gZGVmYXVsdCBzZXR0aW5nc1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoe30pO1xuXG4gICAgICAgICAgICAgICAgLy8gTWlncmF0ZSBhbnkgY29va2llcyBmcm9tIHByZXZpb3VzIHZlcnNpb25zIHRvIGN1cnJlbnQgY29va2llIHZlcnNpb25cbiAgICAgICAgICAgICAgICBNaWdyYXRpb25zLm1pZ3JhdGUoKTtcblxuICAgICAgICAgICAgICAgIC8vIExvYWQgYW55IHNldHRpbmdzL2lkZW50aXRpZXMvYXR0cmlidXRlcyBmcm9tIGNvb2tpZSBvciBsb2NhbFN0b3JhZ2VcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5pbml0aWFsaXplU3RvcmFnZSgpO1xuXG4gICAgICAgICAgICAgICAgLy8gSWYgbm8gaWRlbnRpdHkgaXMgcGFzc2VkIGluLCB3ZSBzZXQgdGhlIHVzZXIgaWRlbnRpdGllcyB0byB3aGF0IGlzIGN1cnJlbnRseSBpbiBjb29raWVzIGZvciB0aGUgaWRlbnRpZnkgcmVxdWVzdFxuICAgICAgICAgICAgICAgIGlmICgoSGVscGVycy5pc09iamVjdChtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KSAmJiBPYmplY3Qua2V5cyhtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KS5sZW5ndGggPT09IDApIHx8ICFtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0ID0ge307XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGlkZW50aXR5VHlwZSBpbiBNUC51c2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1QLnVzZXJJZGVudGl0aWVzLmhhc093blByb3BlcnR5KGlkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0W1R5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eU5hbWUoSGVscGVycy5wYXJzZU51bWJlcihpZGVudGl0eVR5cGUpKV0gPSBNUC51c2VySWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0aWVzOiBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IG1QYXJ0aWNsZS5pZGVudGlmeVJlcXVlc3Q7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gSWYgbWlncmF0aW5nIGZyb20gcHJlLUlEU3luYyB0byBJRFN5bmMsIGEgc2Vzc2lvbklEIHdpbGwgZXhpc3QgYW5kIGFuIGlkZW50aWZ5IHJlcXVlc3Qgd2lsbCBub3QgaGF2ZSBiZWVuIGZpcmVkLCBzbyB3ZSBuZWVkIHRoaXMgY2hlY2tcbiAgICAgICAgICAgICAgICBpZiAoTVAubWlncmF0aW5nVG9JRFN5bmNDb29raWVzKSB7XG4gICAgICAgICAgICAgICAgICAgIElkZW50aXR5QVBJLmlkZW50aWZ5KE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QsIG1QYXJ0aWNsZS5pZGVudGlmeVJlcXVlc3QpO1xuICAgICAgICAgICAgICAgICAgICBNUC5taWdyYXRpbmdUb0lEU3luY0Nvb2tpZXMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjdXJyZW50VXNlciA9IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpO1xuICAgICAgICAgICAgICAgIC8vIENhbGwgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgd2hlbiBpZGVudGlmeSB3YXMgbm90IGNhbGxlZCBkdWUgdG8gYSByZWxvYWQgb3IgYSBzZXNzaW9uSWQgYWxyZWFkeSBleGlzdGluZ1xuICAgICAgICAgICAgICAgIGlmICghTVAuaWRlbnRpZnlDYWxsZWQgJiYgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgJiYgTVAubXBpZCAmJiBjdXJyZW50VXNlcikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayh7XG4gICAgICAgICAgICAgICAgICAgICAgICBodHRwQ29kZTogSFRUUENvZGVzLmFjdGl2ZVNlc3Npb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBnZXRVc2VyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlcihNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbXBpZDogTVAubXBpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc19sb2dnZWRfaW46IE1QLmlzTG9nZ2VkSW4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlZF9pZGVudGl0aWVzOiBjdXJyZW50VXNlciA/IGN1cnJlbnRVc2VyLmdldFVzZXJJZGVudGl0aWVzKCkudXNlcklkZW50aXRpZXMgOiB7fSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0OiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzX2VwaGVtZXJhbDogZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyhNUC5pbml0aWFsSWRlbnRpZnlSZXF1ZXN0LnVzZXJJZGVudGl0aWVzKTtcbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5oYXNGZWF0dXJlRmxhZyhDb25zdGFudHMuRmVhdHVyZXMuQmF0Y2hpbmcpKSB7XG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRpbmdTdGF0c1VwbG9hZGVyLnN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXIoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYXJndW1lbnRzICYmIGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxICYmIHR5cGVvZiBhcmd1bWVudHNbMV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWcgPSBhcmd1bWVudHNbMV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5tZXJnZUNvbmZpZyhjb25maWcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLmluaXRpYWxpemUoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nQVNUKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhbGwgYW55IGZ1bmN0aW9ucyB0aGF0IGFyZSB3YWl0aW5nIGZvciB0aGUgbGlicmFyeSB0byBiZSBpbml0aWFsaXplZFxuICAgICAgICAgICAgaWYgKE1QLnJlYWR5UXVldWUgJiYgTVAucmVhZHlRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBNUC5yZWFkeVF1ZXVlLmZvckVhY2goZnVuY3Rpb24ocmVhZHlRdWV1ZUl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihyZWFkeVF1ZXVlSXRlbSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYWR5UXVldWVJdGVtKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShyZWFkeVF1ZXVlSXRlbSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NQcmVsb2FkZWRJdGVtKHJlYWR5UXVldWVJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgTVAucmVhZHlRdWV1ZSA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgTVAuaXNJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIENvbXBsZXRlbHkgcmVzZXRzIHRoZSBzdGF0ZSBvZiB0aGUgU0RLLiBtUGFydGljbGUuaW5pdChhcGlLZXkpIHdpbGwgbmVlZCB0byBiZSBjYWxsZWQgYWdhaW4uXG4gICAgICAgICogQG1ldGhvZCByZXNldFxuICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0ga2VlcFBlcnNpc3RlbmNlIGlmIHBhc3NlZCBhcyB0cnVlLCB0aGlzIG1ldGhvZCB3aWxsIG9ubHkgcmVzZXQgdGhlIGluLW1lbW9yeSBTREsgc3RhdGUuXG4gICAgICAgICovXG4gICAgICAgIHJlc2V0OiBmdW5jdGlvbihrZWVwUGVyc2lzdGVuY2UpIHtcbiAgICAgICAgICAgIE1QLnNlc3Npb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSB0cnVlO1xuICAgICAgICAgICAgTVAuaXNGaXJzdFJ1biA9IG51bGw7XG4gICAgICAgICAgICBFdmVudHMuc3RvcFRyYWNraW5nKCk7XG4gICAgICAgICAgICBNUC5kZXZUb2tlbiA9IG51bGw7XG4gICAgICAgICAgICBNUC5zZXNzaW9uSWQgPSBudWxsO1xuICAgICAgICAgICAgTVAuYXBwTmFtZSA9IG51bGw7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gbnVsbDtcbiAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSBbXSxcbiAgICAgICAgICAgIE1QLmV2ZW50UXVldWUgPSBbXTtcbiAgICAgICAgICAgIE1QLmNvbnRleHQgPSBudWxsO1xuICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0ge307XG4gICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMgPSBbXTtcbiAgICAgICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzID0gW107XG4gICAgICAgICAgICBNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnMgPSBbXTtcbiAgICAgICAgICAgIE1QLnBpeGVsQ29uZmlndXJhdGlvbnMgPSBbXTtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IFtdO1xuICAgICAgICAgICAgTVAuc2VydmVyU2V0dGluZ3MgPSBudWxsO1xuICAgICAgICAgICAgTVAubXBpZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5jdXN0b21GbGFncyA9IG51bGw7XG4gICAgICAgICAgICBNUC5jdXJyZW5jeUNvZGU7XG4gICAgICAgICAgICBNUC5jbGllbnRJZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5kZXZpY2VJZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IG51bGw7XG4gICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbnVsbDtcbiAgICAgICAgICAgIE1QLndhdGNoUG9zaXRpb25JZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5yZWFkeVF1ZXVlID0gW107XG4gICAgICAgICAgICBNUC5taWdyYXRpb25EYXRhID0ge307XG4gICAgICAgICAgICBNUC5pZGVudGl0eUNhbGxJbkZsaWdodCA9IGZhbHNlO1xuICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IG51bGw7XG4gICAgICAgICAgICBNUC5pc0luaXRpYWxpemVkID0gZmFsc2U7XG4gICAgICAgICAgICBNUC5pZGVudGlmeUNhbGxlZCA9IGZhbHNlO1xuICAgICAgICAgICAgTVAuY29uc2VudFN0YXRlID0gbnVsbDtcbiAgICAgICAgICAgIE1QLmZlYXR1cmVGbGFncyA9IHt9O1xuICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkRlbGF5cyA9IHt9O1xuICAgICAgICAgICAgTVAucmVxdWlyZURlbGF5ID0gdHJ1ZTtcbiAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoe30pO1xuICAgICAgICAgICAgaWYgKCFrZWVwUGVyc2lzdGVuY2UpIHtcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5yZXNldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayA9IG51bGw7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLnVwbG9hZHNUYWJsZSA9IHt9O1xuICAgICAgICAgICAgUGVyc2lzdGVuY2UuZm9yd2FyZGluZ1N0YXRzQmF0Y2hlcy5mb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlID0gW107XG4gICAgICAgIH0sXG4gICAgICAgIHJlYWR5OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgICBpZiAoTVAuaXNJbml0aWFsaXplZCAmJiB0eXBlb2YgZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIE1QLnJlYWR5UXVldWUucHVzaChmKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqIEBtZXRob2QgZ2V0VmVyc2lvblxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBnZXRWZXJzaW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBDb25zdGFudHMuc2RrVmVyc2lvbjtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmVyc2lvbiB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBWZXJzaW9uOiBmdW5jdGlvbih2ZXJzaW9uKSB7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gdmVyc2lvbjtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXRzIHRoZSBhcHAgbmFtZVxuICAgICAgICAqIEBtZXRob2QgZ2V0QXBwTmFtZVxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gQXBwIG5hbWVcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0QXBwTmFtZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuYXBwTmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIG5hbWVcbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcE5hbWVcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBBcHAgTmFtZVxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBOYW1lOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgICAgICBNUC5hcHBOYW1lID0gbmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIGdldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcmV0dXJuIHtTdHJpbmd9IEFwcCB2ZXJzaW9uXG4gICAgICAgICovXG4gICAgICAgIGdldEFwcFZlcnNpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIE1QLmFwcFZlcnNpb247XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0b3BzIHRyYWNraW5nIHRoZSBsb2NhdGlvbiBvZiB0aGUgdXNlclxuICAgICAgICAqIEBtZXRob2Qgc3RvcFRyYWNraW5nTG9jYXRpb25cbiAgICAgICAgKi9cbiAgICAgICAgc3RvcFRyYWNraW5nTG9jYXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuc3RvcFRyYWNraW5nKCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0YXJ0cyB0cmFja2luZyB0aGUgbG9jYXRpb24gb2YgdGhlIHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIHN0YXJ0VHJhY2tpbmdMb2NhdGlvblxuICAgICAgICAqL1xuICAgICAgICBzdGFydFRyYWNraW5nTG9jYXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuc3RhcnRUcmFja2luZygpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIHRoZSBwb3NpdGlvbiBvZiB0aGUgdXNlclxuICAgICAgICAqIEBtZXRob2Qgc2V0UG9zaXRpb25cbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gbGF0dGl0dWRlIGxhdHRpdHVkZSBkaWdpdFxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgbG9uZ2l0dWRlIGRpZ2l0XG4gICAgICAgICovXG4gICAgICAgIHNldFBvc2l0aW9uOiBmdW5jdGlvbihsYXQsIGxuZykge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxhdCA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGxuZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICBNUC5jdXJyZW50UG9zaXRpb24gPSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdDogbGF0LFxuICAgICAgICAgICAgICAgICAgICBsbmc6IGxuZ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQb3NpdGlvbiBsYXRpdHVkZSBhbmQvb3IgbG9uZ2l0dWRlIG11c3QgYm90aCBiZSBvZiB0eXBlIG51bWJlcicpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTdGFydHMgYSBuZXcgc2Vzc2lvblxuICAgICAgICAqIEBtZXRob2Qgc3RhcnROZXdTZXNzaW9uXG4gICAgICAgICovXG4gICAgICAgIHN0YXJ0TmV3U2Vzc2lvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBTZXNzaW9uTWFuYWdlci5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogRW5kcyB0aGUgY3VycmVudCBzZXNzaW9uXG4gICAgICAgICogQG1ldGhvZCBlbmRTZXNzaW9uXG4gICAgICAgICovXG4gICAgICAgIGVuZFNlc3Npb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy8gU2VuZHMgdHJ1ZSBhcyBhbiBvdmVyIHJpZGUgdnMgd2hlbiBlbmRTZXNzaW9uIGlzIGNhbGxlZCBmcm9tIHRoZSBzZXRJbnRlcnZhbFxuICAgICAgICAgICAgU2Vzc2lvbk1hbmFnZXIuZW5kU2Vzc2lvbih0cnVlKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogTG9ncyBhbiBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzXG4gICAgICAgICogQG1ldGhvZCBsb2dFdmVudFxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudE5hbWUgVGhlIG5hbWUgb2YgdGhlIGV2ZW50XG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFtldmVudFR5cGVdIFRoZSBldmVudFR5cGUgYXMgc2VlbiBbaGVyZV0oaHR0cDovL2RvY3MubXBhcnRpY2xlLmNvbS9kZXZlbG9wZXJzL3Nkay9qYXZhc2NyaXB0L2V2ZW50LXRyYWNraW5nI2V2ZW50LXR5cGUpXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtldmVudEluZm9dIEF0dHJpYnV0ZXMgZm9yIHRoZSBldmVudFxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEFkZGl0aW9uYWwgY3VzdG9tRmxhZ3NcbiAgICAgICAgKi9cbiAgICAgICAgbG9nRXZlbnQ6IGZ1bmN0aW9uKGV2ZW50TmFtZSwgZXZlbnRUeXBlLCBldmVudEluZm8sIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgKGV2ZW50TmFtZSkgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkV2ZW50TmFtZUludmFsaWRUeXBlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZXZlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgZXZlbnRUeXBlID0gVHlwZXMuRXZlbnRUeXBlLlVua25vd247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghSGVscGVycy5pc0V2ZW50VHlwZShldmVudFR5cGUpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnSW52YWxpZCBldmVudCB0eXBlOiAnICsgZXZlbnRUeXBlICsgJywgbXVzdCBiZSBvbmUgb2Y6IFxcbicgKyBKU09OLnN0cmluZ2lmeShUeXBlcy5FdmVudFR5cGUpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5Mb2dnaW5nRGlzYWJsZWQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgRXZlbnRzLmxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudCwgZXZlbnROYW1lLCBldmVudEluZm8sIGV2ZW50VHlwZSwgY3VzdG9tRmxhZ3MpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBVc2VkIHRvIGxvZyBjdXN0b20gZXJyb3JzXG4gICAgICAgICpcbiAgICAgICAgKiBAbWV0aG9kIGxvZ0Vycm9yXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmcgb3IgT2JqZWN0fSBlcnJvciBUaGUgbmFtZSBvZiB0aGUgZXJyb3IgKHN0cmluZyksIG9yIGFuIG9iamVjdCBmb3JtZWQgYXMgZm9sbG93cyB7bmFtZTogJ2V4YW1wbGVOYW1lJywgbWVzc2FnZTogJ2V4YW1wbGVNZXNzYWdlJywgc3RhY2s6ICdleGFtcGxlU3RhY2snfVxuICAgICAgICAqL1xuICAgICAgICBsb2dFcnJvcjogZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgaWYgKCFlcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBlcnJvciA9IHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBFdmVudHMubG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuQ3Jhc2hSZXBvcnQsXG4gICAgICAgICAgICAgICAgZXJyb3IubmFtZSA/IGVycm9yLm5hbWUgOiAnRXJyb3InLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbTogZXJyb3IubWVzc2FnZSA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcixcbiAgICAgICAgICAgICAgICAgICAgczogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgdDogZXJyb3Iuc3RhY2tcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5PdGhlcik7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYGNsaWNrYCBldmVudHNcbiAgICAgICAgKiBAbWV0aG9kIGxvZ0xpbmtcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gc2VsZWN0b3IgVGhlIHNlbGVjdG9yIHRvIGFkZCBhICdjbGljaycgZXZlbnQgdG8gKGV4LiAjcHVyY2hhc2UtZXZlbnQpXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtldmVudE5hbWVdIFRoZSBuYW1lIG9mIHRoZSBldmVudFxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbZXZlbnRUeXBlXSBUaGUgZXZlbnRUeXBlIGFzIHNlZW4gW2hlcmVdKGh0dHA6Ly9kb2NzLm1wYXJ0aWNsZS5jb20vZGV2ZWxvcGVycy9zZGsvamF2YXNjcmlwdC9ldmVudC10cmFja2luZyNldmVudC10eXBlKVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbZXZlbnRJbmZvXSBBdHRyaWJ1dGVzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKi9cbiAgICAgICAgbG9nTGluazogZnVuY3Rpb24oc2VsZWN0b3IsIGV2ZW50TmFtZSwgZXZlbnRUeXBlLCBldmVudEluZm8pIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgRXZlbnRzLmFkZEV2ZW50SGFuZGxlcignY2xpY2snLCBzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudEluZm8sIGV2ZW50VHlwZSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYHN1Ym1pdGAgZXZlbnRzXG4gICAgICAgICogQG1ldGhvZCBsb2dGb3JtXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHNlbGVjdG9yIFRoZSBzZWxlY3RvciB0byBhZGQgdGhlIGV2ZW50IGhhbmRsZXIgdG8gKGV4LiAjc2VhcmNoLWV2ZW50KVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbZXZlbnROYW1lXSBUaGUgbmFtZSBvZiB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW2V2ZW50VHlwZV0gVGhlIGV2ZW50VHlwZSBhcyBzZWVuIFtoZXJlXShodHRwOi8vZG9jcy5tcGFydGljbGUuY29tL2RldmVsb3BlcnMvc2RrL2phdmFzY3JpcHQvZXZlbnQtdHJhY2tpbmcjZXZlbnQtdHlwZSlcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2V2ZW50SW5mb10gQXR0cmlidXRlcyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICovXG4gICAgICAgIGxvZ0Zvcm06IGZ1bmN0aW9uKHNlbGVjdG9yLCBldmVudE5hbWUsIGV2ZW50VHlwZSwgZXZlbnRJbmZvKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIEV2ZW50cy5hZGRFdmVudEhhbmRsZXIoJ3N1Ym1pdCcsIHNlbGVjdG9yLCBldmVudE5hbWUsIGV2ZW50SW5mbywgZXZlbnRUeXBlKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogTG9ncyBhIHBhZ2Ugdmlld1xuICAgICAgICAqIEBtZXRob2QgbG9nUGFnZVZpZXdcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnROYW1lIFRoZSBuYW1lIG9mIHRoZSBldmVudC4gRGVmYXVsdHMgdG8gJ1BhZ2VWaWV3Jy5cbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBBdHRyaWJ1dGVzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAqL1xuICAgICAgICBsb2dQYWdlVmlldzogZnVuY3Rpb24oZXZlbnROYW1lLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKGV2ZW50TmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnROYW1lID0gJ1BhZ2VWaWV3JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFhdHRycykge1xuICAgICAgICAgICAgICAgICAgICBhdHRycyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RuYW1lOiB3aW5kb3cubG9jYXRpb24uaG9zdG5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogd2luZG93LmRvY3VtZW50LnRpdGxlXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFIZWxwZXJzLmlzT2JqZWN0KGF0dHJzKSl7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RoZSBhdHRyaWJ1dGVzIGFyZ3VtZW50IG11c3QgYmUgYW4gb2JqZWN0LiBBICcgKyB0eXBlb2YgYXR0cnMgKyAnIHdhcyBlbnRlcmVkLiBQbGVhc2UgY29ycmVjdCBhbmQgcmV0cnkuJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGN1c3RvbUZsYWdzICYmICFIZWxwZXJzLmlzT2JqZWN0KGN1c3RvbUZsYWdzKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgY3VzdG9tRmxhZ3MgYXJndW1lbnQgbXVzdCBiZSBhbiBvYmplY3QuIEEgJyArIHR5cGVvZiBjdXN0b21GbGFncyArICcgd2FzIGVudGVyZWQuIFBsZWFzZSBjb3JyZWN0IGFuZCByZXRyeS4nKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgRXZlbnRzLmxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VWaWV3LCBldmVudE5hbWUsIGF0dHJzLCBUeXBlcy5FdmVudFR5cGUuVW5rbm93biwgY3VzdG9tRmxhZ3MpO1xuICAgICAgICB9LFxuICAgICAgICBDb25zZW50OiB7XG4gICAgICAgICAgICBjcmVhdGVHRFBSQ29uc2VudDogQ29uc2VudC5jcmVhdGVHRFBSQ29uc2VudCxcbiAgICAgICAgICAgIGNyZWF0ZUNvbnNlbnRTdGF0ZTogQ29uc2VudC5jcmVhdGVDb25zZW50U3RhdGVcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5lQ29tbWVyY2Ugb2JqZWN0LlxuICAgICAgICAqIEV4YW1wbGU6IG1QYXJ0aWNsZS5lQ29tbWVyY2UuY3JlYXRlSW1wcmVzaW9uKC4uLilcbiAgICAgICAgKiBAY2xhc3MgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAqL1xuICAgICAgICBlQ29tbWVyY2U6IHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlLmVDb21tZXJjZS5DYXJ0IG9iamVjdC5cbiAgICAgICAgICAgICogRXhhbXBsZTogbVBhcnRpY2xlLmVDb21tZXJjZS5DYXJ0LmFkZCguLi4pXG4gICAgICAgICAgICAqIEBjbGFzcyBtUGFydGljbGUuZUNvbW1lcmNlLkNhcnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBDYXJ0OiB7XG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgKiBBZGRzIGEgcHJvZHVjdCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQG1ldGhvZCBhZGRcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IFRoZSBwcm9kdWN0IHlvdSB3YW50IHRvIGFkZCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRCb29sZWFuXSBPcHRpb24gdG8gbG9nIHRoZSBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzLiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBhZGQ6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGVVc2VyQ2FydChNUC5tcGlkKS5hZGQocHJvZHVjdCwgbG9nRXZlbnRCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICogUmVtb3ZlcyBhIHByb2R1Y3QgZnJvbSB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQG1ldGhvZCByZW1vdmVcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IFRoZSBwcm9kdWN0IHlvdSB3YW50IHRvIGFkZCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRCb29sZWFuXSBPcHRpb24gdG8gbG9nIHRoZSBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzLiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICByZW1vdmU6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGVVc2VyQ2FydChNUC5tcGlkKS5yZW1vdmUocHJvZHVjdCwgbG9nRXZlbnRCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICogQ2xlYXJzIHRoZSBjYXJ0XG4gICAgICAgICAgICAgICAgKiBAbWV0aG9kIGNsZWFyXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBjbGVhcjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZVVzZXJDYXJ0KE1QLm1waWQpLmNsZWFyKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBTZXRzIHRoZSBjdXJyZW5jeSBjb2RlXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIHNldEN1cnJlbmN5Q29kZVxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gY29kZSBUaGUgY3VycmVuY3kgY29kZVxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHNldEN1cnJlbmN5Q29kZTogZnVuY3Rpb24oY29kZSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY29kZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ29kZSBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgTVAuY3VycmVuY3lDb2RlID0gY29kZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb2R1Y3RcbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgY3JlYXRlUHJvZHVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBwcm9kdWN0IG5hbWVcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHNrdSBwcm9kdWN0IHNrdVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gcHJpY2UgcHJvZHVjdCBwcmljZVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3F1YW50aXR5XSBwcm9kdWN0IHF1YW50aXR5LiBJZiBibGFuaywgZGVmYXVsdHMgdG8gMS5cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFt2YXJpYW50XSBwcm9kdWN0IHZhcmlhbnRcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjYXRlZ29yeV0gcHJvZHVjdCBjYXRlZ29yeVxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2JyYW5kXSBwcm9kdWN0IGJyYW5kXG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbcG9zaXRpb25dIHByb2R1Y3QgcG9zaXRpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjb3Vwb25dIHByb2R1Y3QgY291cG9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cmlidXRlc10gcHJvZHVjdCBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlUHJvZHVjdDogZnVuY3Rpb24obmFtZSwgc2t1LCBwcmljZSwgcXVhbnRpdHksIHZhcmlhbnQsIGNhdGVnb3J5LCBicmFuZCwgcG9zaXRpb24sIGNvdXBvbiwgYXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuY3JlYXRlUHJvZHVjdChuYW1lLCBza3UsIHByaWNlLCBxdWFudGl0eSwgdmFyaWFudCwgY2F0ZWdvcnksIGJyYW5kLCBwb3NpdGlvbiwgY291cG9uLCBhdHRyaWJ1dGVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb21vdGlvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBjcmVhdGVQcm9tb3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGlkIGEgdW5pcXVlIHByb21vdGlvbiBpZFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2NyZWF0aXZlXSBwcm9tb3Rpb24gY3JlYXRpdmVcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtuYW1lXSBwcm9tb3Rpb24gbmFtZVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3Bvc2l0aW9uXSBwcm9tb3Rpb24gcG9zaXRpb25cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBjcmVhdGVQcm9tb3Rpb246IGZ1bmN0aW9uKGlkLCBjcmVhdGl2ZSwgbmFtZSwgcG9zaXRpb24pIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZVByb21vdGlvbihpZCwgY3JlYXRpdmUsIG5hbWUsIHBvc2l0aW9uKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb2R1Y3QgaW1wcmVzc2lvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBjcmVhdGVJbXByZXNzaW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIGltcHJlc3Npb24gbmFtZVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCB0aGUgcHJvZHVjdCBmb3Igd2hpY2ggYW4gaW1wcmVzc2lvbiBpcyBiZWluZyBjcmVhdGVkXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlSW1wcmVzc2lvbjogZnVuY3Rpb24obmFtZSwgcHJvZHVjdCkge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuY3JlYXRlSW1wcmVzc2lvbihuYW1lLCBwcm9kdWN0KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHRyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0IHRvIGJlIHVzZWQgd2l0aCBhIGNoZWNrb3V0XG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlc1xuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZyBvciBOdW1iZXJ9IGlkIGEgdW5pcXVlIHRyYW5zYWN0aW9uIGlkXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbYWZmaWxpYXRpb25dIGFmZmlsbGlhdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2NvdXBvbkNvZGVdIHRoZSBjb3Vwb24gY29kZSBmb3Igd2hpY2ggeW91IGFyZSBjcmVhdGluZyB0cmFuc2FjdGlvbiBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbcmV2ZW51ZV0gdG90YWwgcmV2ZW51ZSBmb3IgdGhlIHByb2R1Y3QgYmVpbmcgcHVyY2hhc2VkXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbc2hpcHBpbmddIHRoZSBzaGlwcGluZyBtZXRob2RcbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFt0YXhdIHRoZSB0YXggYW1vdW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlVHJhbnNhY3Rpb25BdHRyaWJ1dGVzOiBmdW5jdGlvbihpZCwgYWZmaWxpYXRpb24sIGNvdXBvbkNvZGUsIHJldmVudWUsIHNoaXBwaW5nLCB0YXgpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyhpZCwgYWZmaWxpYXRpb24sIGNvdXBvbkNvZGUsIHJldmVudWUsIHNoaXBwaW5nLCB0YXgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgY2hlY2tvdXQgYWN0aW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ0NoZWNrb3V0XG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBzdGVwIGNoZWNrb3V0IHN0ZXAgbnVtYmVyXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBhdHRyc1xuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ0NoZWNrb3V0OiBmdW5jdGlvbihzdGVwLCBvcHRpb25zLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nQ2hlY2tvdXRFdmVudChzdGVwLCBvcHRpb25zLCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgcHJvZHVjdCBhY3Rpb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nUHJvZHVjdEFjdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gcHJvZHVjdEFjdGlvblR5cGUgcHJvZHVjdCBhY3Rpb24gdHlwZSBhcyBmb3VuZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvc3JjL3R5cGVzLmpzI0wyMDYtTDIxOClcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3QgZm9yIHdoaWNoIHlvdSBhcmUgY3JlYXRpbmcgdGhlIHByb2R1Y3QgYWN0aW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cnNdIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcHJvZHVjdCBhY3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBsb2dQcm9kdWN0QWN0aW9uOiBmdW5jdGlvbihwcm9kdWN0QWN0aW9uVHlwZSwgcHJvZHVjdCwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChwcm9kdWN0QWN0aW9uVHlwZSwgcHJvZHVjdCwgYXR0cnMsIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHByb2R1Y3QgcHVyY2hhc2VcbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nUHVyY2hhc2VcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHRyYW5zYWN0aW9uQXR0cmlidXRlcyB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMgb2JqZWN0XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHRoZSBwcm9kdWN0IGJlaW5nIHB1cmNoYXNlZFxuICAgICAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtjbGVhckNhcnRdIGJvb2xlYW4gdG8gY2xlYXIgdGhlIGNhcnQgYWZ0ZXIgbG9nZ2luZyBvciBub3QuIERlZmF1bHRzIHRvIGZhbHNlXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cnNdIG90aGVyIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcHJvZHVjdCBwdXJjaGFzZVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ1B1cmNoYXNlOiBmdW5jdGlvbih0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGNsZWFyQ2FydCwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0cmFuc2FjdGlvbkF0dHJpYnV0ZXMgfHwgIXByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZExvZ1B1cmNoYXNlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nUHVyY2hhc2VFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncyk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY2xlYXJDYXJ0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydC5jbGVhcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHByb2R1Y3QgcHJvbW90aW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1Byb21vdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gdHlwZSB0aGUgcHJvbW90aW9uIHR5cGUgYXMgZm91bmQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL3NyYy90eXBlcy5qcyNMMjc1LUwyNzkpXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9tb3Rpb24gcHJvbW90aW9uIG9iamVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBib29sZWFuIHRvIGNsZWFyIHRoZSBjYXJ0IGFmdGVyIGxvZ2dpbmcgb3Igbm90XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEN1c3RvbSBmbGFncyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgbG9nUHJvbW90aW9uOiBmdW5jdGlvbih0eXBlLCBwcm9tb3Rpb24sIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dQcm9tb3Rpb25FdmVudCh0eXBlLCBwcm9tb3Rpb24sIGF0dHJzLCBjdXN0b21GbGFncyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIExvZ3MgYSBwcm9kdWN0IGltcHJlc3Npb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nSW1wcmVzc2lvblxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gaW1wcmVzc2lvbiBwcm9kdWN0IGltcHJlc3Npb24gb2JqZWN0XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBhdHRycyBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIGltcHJlc3Npb24gbG9nXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEN1c3RvbSBmbGFncyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgbG9nSW1wcmVzc2lvbjogZnVuY3Rpb24oaW1wcmVzc2lvbiwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ0ltcHJlc3Npb25FdmVudChpbXByZXNzaW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgcmVmdW5kXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1JlZnVuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzIHRyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcmVmdW5kXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHByb2R1Y3QgYmVpbmcgcmVmdW5kZWRcbiAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbY2xlYXJDYXJ0XSBib29sZWFuIHRvIGNsZWFyIHRoZSBjYXJ0IGFmdGVyIHJlZnVuZCBpcyBsb2dnZWQuIERlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIHJlZnVuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ1JlZnVuZDogZnVuY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBjbGVhckNhcnQsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dSZWZ1bmRFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncyk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY2xlYXJDYXJ0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydC5jbGVhcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleHBhbmRDb21tZXJjZUV2ZW50OiBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuZXhwYW5kQ29tbWVyY2VFdmVudChldmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSBzZXNzaW9uIGF0dHJpYnV0ZVxuICAgICAgICAqIEBmb3IgbVBhcnRpY2xlXG4gICAgICAgICogQG1ldGhvZCBzZXRTZXNzaW9uQXR0cmlidXRlXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBrZXkgZm9yIHNlc3Npb24gYXR0cmlidXRlXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmcgb3IgTnVtYmVyfSB2YWx1ZSB2YWx1ZSBmb3Igc2Vzc2lvbiBhdHRyaWJ1dGVcbiAgICAgICAgKi9cbiAgICAgICAgc2V0U2Vzc2lvbkF0dHJpYnV0ZTogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAvLyBMb2dzIHRvIGNvb2tpZVxuICAgICAgICAgICAgLy8gQW5kIGxvZ3MgdG8gaW4tbWVtb3J5IG9iamVjdFxuICAgICAgICAgICAgLy8gRXhhbXBsZTogbVBhcnRpY2xlLnNldFNlc3Npb25BdHRyaWJ1dGUoJ2xvY2F0aW9uJywgJzMzNDMxJyk7XG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkQXR0cmlidXRlVmFsdWUodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRBdHRyaWJ1dGUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRLZXkpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5TZXRTZXNzaW9uQXR0cmlidXRlLCBKU09OLnN0cmluZ2lmeSh7IGtleToga2V5LCB2YWx1ZTogdmFsdWUgfSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBleGlzdGluZ1Byb3AgPSBIZWxwZXJzLmZpbmRLZXlJbk9iamVjdChNUC5zZXNzaW9uQXR0cmlidXRlcywga2V5KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdQcm9wKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXkgPSBleGlzdGluZ1Byb3A7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuXG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuYXBwbHlUb0ZvcndhcmRlcnMoJ3NldFNlc3Npb25BdHRyaWJ1dGUnLCBba2V5LCB2YWx1ZV0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0IG9wdCBvdXQgb2YgbG9nZ2luZ1xuICAgICAgICAqIEBmb3IgbVBhcnRpY2xlXG4gICAgICAgICogQG1ldGhvZCBzZXRPcHRPdXRcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IGlzT3B0aW5nT3V0IGJvb2xlYW4gdG8gb3B0IG91dCBvciBub3QuIFdoZW4gc2V0IHRvIHRydWUsIG9wdCBvdXQgb2YgbG9nZ2luZy5cbiAgICAgICAgKi9cbiAgICAgICAgc2V0T3B0T3V0OiBmdW5jdGlvbihpc09wdGluZ091dCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSAhaXNPcHRpbmdPdXQ7XG5cbiAgICAgICAgICAgIEV2ZW50cy5sb2dPcHRPdXQoKTtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuXG4gICAgICAgICAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3J3YXJkZXIuc2V0T3B0T3V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLnNldE9wdE91dChpc09wdGluZ091dCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0IG9yIHJlbW92ZSB0aGUgaW50ZWdyYXRpb24gYXR0cmlidXRlcyBmb3IgYSBnaXZlbiBpbnRlZ3JhdGlvbiBJRC5cbiAgICAgICAgKiBJbnRlZ3JhdGlvbiBhdHRyaWJ1dGVzIGFyZSBrZXlzIGFuZCB2YWx1ZXMgc3BlY2lmaWMgdG8gYSBnaXZlbiBpbnRlZ3JhdGlvbi4gRm9yIGV4YW1wbGUsXG4gICAgICAgICogbWFueSBpbnRlZ3JhdGlvbnMgaGF2ZSB0aGVpciBvd24gaW50ZXJuYWwgdXNlci9kZXZpY2UgSUQuIG1QYXJ0aWNsZSB3aWxsIHN0b3JlIGludGVncmF0aW9uIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBmb3IgYSBnaXZlbiBkZXZpY2UsIGFuZCB3aWxsIGJlIGFibGUgdG8gdXNlIHRoZXNlIHZhbHVlcyBmb3Igc2VydmVyLXRvLXNlcnZlciBjb21tdW5pY2F0aW9uIHRvIHNlcnZpY2VzLlxuICAgICAgICAqIFRoaXMgaXMgb2Z0ZW4gdXNlZnVsIHdoZW4gdXNlZCBpbiBjb21iaW5hdGlvbiB3aXRoIGEgc2VydmVyLXRvLXNlcnZlciBmZWVkLCBhbGxvd2luZyB0aGUgZmVlZCB0byBiZSBlbnJpY2hlZFxuICAgICAgICAqIHdpdGggdGhlIG5lY2Vzc2FyeSBpbnRlZ3JhdGlvbiBhdHRyaWJ1dGVzIHRvIGJlIHByb3Blcmx5IGZvcndhcmRlZCB0byB0aGUgZ2l2ZW4gaW50ZWdyYXRpb24uXG4gICAgICAgICogQGZvciBtUGFydGljbGVcbiAgICAgICAgKiBAbWV0aG9kIHNldEludGVncmF0aW9uQXR0cmlidXRlXG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IGludGVncmF0aW9uSWQgbVBhcnRpY2xlIGludGVncmF0aW9uIElEXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IGF0dHJzIGEgbWFwIG9mIGF0dHJpYnV0ZXMgdGhhdCB3aWxsIHJlcGxhY2UgYW55IGN1cnJlbnQgYXR0cmlidXRlcy4gVGhlIGtleXMgYXJlIHByZWRlZmluZWQgYnkgbVBhcnRpY2xlLlxuICAgICAgICAqIFBsZWFzZSBjb25zdWx0IHdpdGggdGhlIG1QYXJ0aWNsZSBkb2NzIG9yIHlvdXIgc29sdXRpb25zIGNvbnN1bHRhbnQgZm9yIHRoZSBjb3JyZWN0IHZhbHVlLiBZb3UgbWF5XG4gICAgICAgICogYWxzbyBwYXNzIGEgbnVsbCBvciBlbXB0eSBtYXAgaGVyZSB0byByZW1vdmUgYWxsIG9mIHRoZSBhdHRyaWJ1dGVzLlxuICAgICAgICAqL1xuICAgICAgICBzZXRJbnRlZ3JhdGlvbkF0dHJpYnV0ZTogZnVuY3Rpb24oaW50ZWdyYXRpb25JZCwgYXR0cnMpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgaW50ZWdyYXRpb25JZCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdpbnRlZ3JhdGlvbklkIG11c3QgYmUgYSBudW1iZXInKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYXR0cnMgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNbaW50ZWdyYXRpb25JZF0gPSB7fTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoSGVscGVycy5pc09iamVjdChhdHRycykpIHtcbiAgICAgICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoYXR0cnMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNbaW50ZWdyYXRpb25JZF0gPSB7fTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gYXR0cnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2Yga2V5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgYXR0cnNba2V5XSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdW2tleV0gPSBhdHRyc1trZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdID0ge307XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNbaW50ZWdyYXRpb25JZF1ba2V5XSA9IGF0dHJzW2tleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdWYWx1ZXMgZm9yIGludGVncmF0aW9uIGF0dHJpYnV0ZXMgbXVzdCBiZSBzdHJpbmdzLiBZb3UgZW50ZXJlZCBhICcgKyB0eXBlb2YgYXR0cnNba2V5XSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnS2V5cyBtdXN0IGJlIHN0cmluZ3MsIHlvdSBlbnRlcmVkIGEgJyArIHR5cGVvZiBrZXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdBdHRycyBtdXN0IGJlIGFuIG9iamVjdCB3aXRoIGtleXMgYW5kIHZhbHVlcy4gWW91IGVudGVyZWQgYSAnICsgdHlwZW9mIGF0dHJzKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0IGludGVncmF0aW9uIGF0dHJpYnV0ZXMgZm9yIGEgZ2l2ZW4gaW50ZWdyYXRpb24gSUQuXG4gICAgICAgICogQG1ldGhvZCBnZXRJbnRlZ3JhdGlvbkF0dHJpYnV0ZXNcbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gaW50ZWdyYXRpb25JZCBtUGFydGljbGUgaW50ZWdyYXRpb24gSURcbiAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IGFuIG9iamVjdCBtYXAgb2YgdGhlIGludGVncmF0aW9uSWQncyBhdHRyaWJ1dGVzXG4gICAgICAgICovXG4gICAgICAgIGdldEludGVncmF0aW9uQXR0cmlidXRlczogZnVuY3Rpb24oaW50ZWdyYXRpb25JZCkge1xuICAgICAgICAgICAgaWYgKE1QLmludGVncmF0aW9uQXR0cmlidXRlc1tpbnRlZ3JhdGlvbklkXSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNbaW50ZWdyYXRpb25JZF07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYWRkRm9yd2FyZGVyOiBmdW5jdGlvbihmb3J3YXJkZXJQcm9jZXNzb3IpIHtcbiAgICAgICAgICAgIE1QLmZvcndhcmRlckNvbnN0cnVjdG9ycy5wdXNoKGZvcndhcmRlclByb2Nlc3Nvcik7XG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpZ3VyZUZvcndhcmRlcjogZnVuY3Rpb24oY29uZmlndXJhdGlvbikge1xuICAgICAgICAgICAgdmFyIG5ld0ZvcndhcmRlciA9IG51bGwsXG4gICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlndXJhdGlvbjtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgTVAuZm9yd2FyZGVyQ29uc3RydWN0b3JzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKE1QLmZvcndhcmRlckNvbnN0cnVjdG9yc1tpXS5uYW1lID09PSBjb25maWcubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmlzRGVidWcgPT09IG1QYXJ0aWNsZS5pc0RldmVsb3BtZW50TW9kZSB8fCBjb25maWcuaXNTYW5kYm94ID09PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlciA9IG5ldyBNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnNbaV0uY29uc3RydWN0b3IoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlkID0gY29uZmlnLm1vZHVsZUlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlzU2FuZGJveCA9IGNvbmZpZy5pc0RlYnVnIHx8IGNvbmZpZy5pc1NhbmRib3g7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuaGFzU2FuZGJveCA9IGNvbmZpZy5oYXNEZWJ1Z1N0cmluZyA9PT0gJ3RydWUnO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlzVmlzaWJsZSA9IGNvbmZpZy5pc1Zpc2libGU7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuc2V0dGluZ3MgPSBjb25maWcuc2V0dGluZ3M7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5ldmVudE5hbWVGaWx0ZXJzID0gY29uZmlnLmV2ZW50TmFtZUZpbHRlcnM7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZXZlbnRUeXBlRmlsdGVycyA9IGNvbmZpZy5ldmVudFR5cGVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmF0dHJpYnV0ZUZpbHRlcnMgPSBjb25maWcuYXR0cmlidXRlRmlsdGVycztcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnNjcmVlbk5hbWVGaWx0ZXJzID0gY29uZmlnLnNjcmVlbk5hbWVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnNjcmVlbk5hbWVGaWx0ZXJzID0gY29uZmlnLnNjcmVlbk5hbWVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnBhZ2VWaWV3QXR0cmlidXRlRmlsdGVycyA9IGNvbmZpZy5wYWdlVmlld0F0dHJpYnV0ZUZpbHRlcnM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci51c2VySWRlbnRpdHlGaWx0ZXJzID0gY29uZmlnLnVzZXJJZGVudGl0eUZpbHRlcnM7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMgPSBjb25maWcudXNlckF0dHJpYnV0ZUZpbHRlcnM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlID0gY29uZmlnLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlID0gY29uZmlnLmZpbHRlcmluZ1VzZXJBdHRyaWJ1dGVWYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5ldmVudFN1YnNjcmlwdGlvbklkID0gY29uZmlnLmV2ZW50U3Vic2NyaXB0aW9uSWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXMgPSBjb25maWcuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXM7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZXhjbHVkZUFub255bW91c1VzZXIgPSBjb25maWcuZXhjbHVkZUFub255bW91c1VzZXI7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzLnB1c2gobmV3Rm9yd2FyZGVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBjb25maWd1cmVQaXhlbDogZnVuY3Rpb24oc2V0dGluZ3MpIHtcbiAgICAgICAgICAgIGlmIChzZXR0aW5ncy5pc0RlYnVnID09PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgfHwgc2V0dGluZ3MuaXNQcm9kdWN0aW9uICE9PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUpIHtcbiAgICAgICAgICAgICAgICBNUC5waXhlbENvbmZpZ3VyYXRpb25zLnB1c2goc2V0dGluZ3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBfZ2V0QWN0aXZlRm9yd2FyZGVyczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuYWN0aXZlRm9yd2FyZGVycztcbiAgICAgICAgfSxcbiAgICAgICAgX2dldEludGVncmF0aW9uRGVsYXlzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBNUC5pbnRlZ3JhdGlvbkRlbGF5cztcbiAgICAgICAgfSxcbiAgICAgICAgX2NvbmZpZ3VyZUZlYXR1cmVzOiBmdW5jdGlvbihmZWF0dXJlRmxhZ3MpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBmZWF0dXJlRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZUZsYWdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuZmVhdHVyZUZsYWdzW2tleV0gPSBmZWF0dXJlRmxhZ3Nba2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIF9zZXRJbnRlZ3JhdGlvbkRlbGF5OiBmdW5jdGlvbihtb2R1bGUsIGJvb2xlYW4pIHtcbiAgICAgICAgICAgIE1QLmludGVncmF0aW9uRGVsYXlzW21vZHVsZV0gPSBib29sZWFuO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHByb2Nlc3NQcmVsb2FkZWRJdGVtKHJlYWR5UXVldWVJdGVtKSB7XG4gICAgICAgIHZhciBjdXJyZW50VXNlcixcbiAgICAgICAgICAgIGFyZ3MgPSByZWFkeVF1ZXVlSXRlbSxcbiAgICAgICAgICAgIG1ldGhvZCA9IGFyZ3Muc3BsaWNlKDAsIDEpWzBdO1xuICAgICAgICBpZiAobVBhcnRpY2xlW2FyZ3NbMF1dKSB7XG4gICAgICAgICAgICBtUGFydGljbGVbbWV0aG9kXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBtZXRob2RBcnJheSA9IG1ldGhvZC5zcGxpdCgnLicpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB2YXIgY29tcHV0ZWRNUEZ1bmN0aW9uID0gbVBhcnRpY2xlO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbWV0aG9kQXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRNZXRob2QgPSBtZXRob2RBcnJheVtpXTtcbiAgICAgICAgICAgICAgICAgICAgY29tcHV0ZWRNUEZ1bmN0aW9uID0gY29tcHV0ZWRNUEZ1bmN0aW9uW2N1cnJlbnRNZXRob2RdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb21wdXRlZE1QRnVuY3Rpb24uYXBwbHkoY3VycmVudFVzZXIsIGFyZ3MpO1xuICAgICAgICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVW5hYmxlIHRvIGNvbXB1dGUgcHJvcGVyIG1QYXJ0aWNsZSBmdW5jdGlvbiAnICsgZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZWFkIGV4aXN0aW5nIGNvbmZpZ3VyYXRpb24gaWYgcHJlc2VudFxuICAgIGlmICh3aW5kb3cubVBhcnRpY2xlICYmIHdpbmRvdy5tUGFydGljbGUuY29uZmlnKSB7XG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5zZXJ2aWNlVXJsKSB7XG4gICAgICAgICAgICBDb25zdGFudHMuc2VydmljZVVybCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnNlcnZpY2VVcmw7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuc2VjdXJlU2VydmljZVVybCkge1xuICAgICAgICAgICAgQ29uc3RhbnRzLnNlY3VyZVNlcnZpY2VVcmwgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5zZWN1cmVTZXJ2aWNlVXJsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgZm9yIGFueSBmdW5jdGlvbnMgcXVldWVkXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5ycSkge1xuICAgICAgICAgICAgTVAucmVhZHlRdWV1ZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnJxO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmxvZ0xldmVsKSB7XG4gICAgICAgICAgICBNUC5sb2dMZXZlbCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmxvZ0xldmVsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdpc0RldmVsb3BtZW50TW9kZScpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgPSBIZWxwZXJzLnJldHVybkNvbnZlcnRlZEJvb2xlYW4od2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaXNEZXZlbG9wbWVudE1vZGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCd1c2VOYXRpdmVTZGsnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnVzZU5hdGl2ZVNkayA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnVzZU5hdGl2ZVNkaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgndXNlQ29va2llU3RvcmFnZScpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnVzZUNvb2tpZVN0b3JhZ2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ21heFByb2R1Y3RzJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLm1heFByb2R1Y3RzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdtYXhDb29raWVTaXplJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5tYXhDb29raWVTaXplID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcubWF4Q29va2llU2l6ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnYXBwTmFtZScpKSB7XG4gICAgICAgICAgICBNUC5hcHBOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuYXBwTmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnaW50ZWdyYXRpb25EZWxheVRpbWVvdXQnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLmludGVncmF0aW9uRGVsYXlUaW1lb3V0ID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaW50ZWdyYXRpb25EZWxheVRpbWVvdXQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2lkZW50aWZ5UmVxdWVzdCcpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0ID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaWRlbnRpZnlSZXF1ZXN0O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdpZGVudGl0eUNhbGxiYWNrJykpIHtcbiAgICAgICAgICAgIHZhciBjYWxsYmFjayA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmlkZW50aXR5Q2FsbGJhY2s7XG4gICAgICAgICAgICBpZiAoVmFsaWRhdG9ycy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5pZGVudGl0eUNhbGxiYWNrID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaWRlbnRpdHlDYWxsYmFjaztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVGhlIG9wdGlvbmFsIGNhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbi4gWW91IHRyaWVkIGVudGVyaW5nIGEobikgJyArIHR5cGVvZiBjYWxsYmFjaywgJyAuIENhbGxiYWNrIG5vdCBzZXQuIFBsZWFzZSBzZXQgeW91ciBjYWxsYmFjayBhZ2Fpbi4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnYXBwVmVyc2lvbicpKSB7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuYXBwVmVyc2lvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnc2Vzc2lvblRpbWVvdXQnKSkge1xuICAgICAgICAgICAgTVAuQ29uZmlnLlNlc3Npb25UaW1lb3V0ID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuc2Vzc2lvblRpbWVvdXQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2ZvcmNlSHR0cHMnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLmZvcmNlSHR0cHMgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5mb3JjZUh0dHBzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbVBhcnRpY2xlLmZvcmNlSHR0cHMgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU29tZSBmb3J3YXJkZXJzIHJlcXVpcmUgY3VzdG9tIGZsYWdzIG9uIGluaXRpYWxpemF0aW9uLCBzbyBhbGxvdyB0aGVtIHRvIGJlIHNldCB1c2luZyBjb25maWcgb2JqZWN0XG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnY3VzdG9tRmxhZ3MnKSkge1xuICAgICAgICAgICAgTVAuY3VzdG9tRmxhZ3MgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5jdXN0b21GbGFncztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnd29ya3NwYWNlVG9rZW4nKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLndvcmtzcGFjZVRva2VuID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcud29ya3NwYWNlVG9rZW47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ3dlYnZpZXdFbmFibGVkJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS53ZWJ2aWV3RW5hYmxlZCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLndlYnZpZXdFbmFibGVkO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdyZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcucmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcud29ya3NwYWNlVG9rZW47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ21pbldlYnZpZXdCcmlkZ2VWZXJzaW9uJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5taW5XZWJ2aWV3QnJpZGdlVmVyc2lvbiA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLm1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdpbmRvdy5tUGFydGljbGUgPSBtUGFydGljbGU7XG59KSh3aW5kb3cpO1xuIiwidmFyIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIENvbmZpZyA9IE1QLkNvbmZpZyxcbiAgICBTREt2Mk5vbk1QSURDb29raWVLZXlzID0gQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMsXG4gICAgQmFzZTY0ID0gcmVxdWlyZSgnLi9wb2x5ZmlsbCcpLkJhc2U2NCxcbiAgICBDb29raWVzR2xvYmFsU2V0dGluZ3NLZXlzID0ge1xuICAgICAgICBjdXJyZW50U2Vzc2lvbk1QSURzOiAxLFxuICAgICAgICBjc206IDEsXG4gICAgICAgIHNpZDogMSxcbiAgICAgICAgaXNFbmFibGVkOiAxLFxuICAgICAgICBpZTogMSxcbiAgICAgICAgc2E6IDEsXG4gICAgICAgIHNzOiAxLFxuICAgICAgICBkdDogMSxcbiAgICAgICAgbGVzOiAxLFxuICAgICAgICBhdjogMSxcbiAgICAgICAgY2dpZDogMSxcbiAgICAgICAgZGFzOiAxLFxuICAgICAgICBjOiAxXG4gICAgfSxcbiAgICBNUElES2V5cyA9IHtcbiAgICAgICAgdWk6IDEsXG4gICAgICAgIHVhOiAxLFxuICAgICAgICBjc2Q6IDFcbiAgICB9O1xuXG4vLyAgaWYgdGhlcmUgaXMgYSBjb29raWUgb3IgbG9jYWxTdG9yYWdlOlxuLy8gIDEuIGRldGVybWluZSB3aGljaCB2ZXJzaW9uIGl0IGlzICgnbXBydGNsLWFwaScsICdtcHJ0Y2wtdjInLCAnbXBydGNsLXYzJywgJ21wcnRjbC12NCcpXG4vLyAgMi4gcmV0dXJuIGlmICdtcHJ0Y2wtdjQnLCBvdGhlcndpc2UgbWlncmF0ZSB0byBtcHJ0Y2x2NCBzY2hlbWFcbiAvLyAzLiBpZiAnbXBydGNsLWFwaScsIGNvdWxkIGJlIEpTU0RLdjIgb3IgSlNTREt2MS4gSlNTREt2MiBjb29raWUgaGFzIGEgJ2dsb2JhbFNldHRpbmdzJyBrZXkgb24gaXRcbmZ1bmN0aW9uIG1pZ3JhdGUoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgbWlncmF0ZUNvb2tpZXMoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIFBlcnNpc3RlbmNlLmV4cGlyZUNvb2tpZXMoQ29uZmlnLkNvb2tpZU5hbWVWMyk7XG4gICAgICAgIFBlcnNpc3RlbmNlLmV4cGlyZUNvb2tpZXMoQ29uZmlnLkNvb2tpZU5hbWVWNCk7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIG1pZ3JhdGluZyBjb29raWU6ICcgKyBlKTtcbiAgICB9XG5cbiAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG1pZ3JhdGVMb2NhbFN0b3JhZ2UoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWMyk7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShDb25maWcuTG9jYWxTdG9yYWdlTmFtZVY0KTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIG1pZ3JhdGluZyBsb2NhbFN0b3JhZ2U6ICcgKyBlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gbWlncmF0ZUNvb2tpZXMoKSB7XG4gICAgdmFyIGNvb2tpZXMgPSB3aW5kb3cuZG9jdW1lbnQuY29va2llLnNwbGl0KCc7ICcpLFxuICAgICAgICBmb3VuZENvb2tpZSxcbiAgICAgICAgaSxcbiAgICAgICAgbCxcbiAgICAgICAgcGFydHMsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvb2tpZTtcblxuICAgIEhlbHBlcnMubG9nRGVidWcoQ29uc3RhbnRzLk1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llU2VhcmNoKTtcblxuICAgIGZvciAoaSA9IDAsIGwgPSBjb29raWVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcbiAgICAgICAgbmFtZSA9IEhlbHBlcnMuZGVjb2RlZChwYXJ0cy5zaGlmdCgpKTtcbiAgICAgICAgY29va2llID0gSGVscGVycy5kZWNvZGVkKHBhcnRzLmpvaW4oJz0nKSksXG4gICAgICAgIGZvdW5kQ29va2llO1xuXG4gICAgICAgIC8vbW9zdCByZWNlbnQgdmVyc2lvbiBuZWVkcyBubyBtaWdyYXRpb25cbiAgICAgICAgaWYgKG5hbWUgPT09IENvbmZpZy5Db29raWVOYW1lVjQpIHtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBtaWdyYXRpb24gcGF0aCBmb3IgU0RLdjFDb29raWVzVjMsIGRvZXNuJ3QgbmVlZCB0byBiZSBlbmNvZGVkXG4gICAgICAgIH0gZWxzZSBpZiAobmFtZSA9PT0gQ29uZmlnLkNvb2tpZU5hbWVWMykge1xuICAgICAgICAgICAgZm91bmRDb29raWUgPSBjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0KGNvb2tpZSk7XG4gICAgICAgICAgICBmaW5pc2hDb29raWVNaWdyYXRpb24oZm91bmRDb29raWUsIENvbmZpZy5Db29raWVOYW1lVjMpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIG1pZ3JhdGlvbiBwYXRoIGZvciBTREt2MUNvb2tpZXNWMiwgbmVlZHMgdG8gYmUgZW5jb2RlZFxuICAgICAgICB9IGVsc2UgaWYgKG5hbWUgPT09IENvbmZpZy5Db29raWVOYW1lVjIpIHtcbiAgICAgICAgICAgIGZvdW5kQ29va2llID0gY29udmVydFNES3YxQ29va2llc1YyVG9TREt2MkNvb2tpZXNWNChIZWxwZXJzLmNvbnZlcnRlZChjb29raWUpKTtcbiAgICAgICAgICAgIGZpbmlzaENvb2tpZU1pZ3JhdGlvbihQZXJzaXN0ZW5jZS5lbmNvZGVDb29raWVzKGZvdW5kQ29va2llKSwgQ29uZmlnLkNvb2tpZU5hbWVWMik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgLy8gbWlncmF0aW9uIHBhdGggZm9yIHYxLCBuZWVkcyB0byBiZSBlbmNvZGVkXG4gICAgICAgIH0gZWxzZSBpZiAobmFtZSA9PT0gQ29uZmlnLkNvb2tpZU5hbWUpIHtcbiAgICAgICAgICAgIGZvdW5kQ29va2llID0gSGVscGVycy5jb252ZXJ0ZWQoY29va2llKTtcbiAgICAgICAgICAgIGlmIChKU09OLnBhcnNlKGZvdW5kQ29va2llKS5nbG9iYWxTZXR0aW5ncykge1xuICAgICAgICAgICAgICAgIC8vIENvb2tpZVYxIGZyb20gU0RLdjJcbiAgICAgICAgICAgICAgICBmb3VuZENvb2tpZSA9IGNvbnZlcnRTREt2MkNvb2tpZXNWMVRvU0RLdjJEZWNvZGVkQ29va2llc1Y0KGZvdW5kQ29va2llKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gQ29va2llVjEgZnJvbSBTREt2MVxuICAgICAgICAgICAgICAgIGZvdW5kQ29va2llID0gY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNChmb3VuZENvb2tpZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmaW5pc2hDb29raWVNaWdyYXRpb24oUGVyc2lzdGVuY2UuZW5jb2RlQ29va2llcyhmb3VuZENvb2tpZSksIENvbmZpZy5Db29raWVOYW1lKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmaW5pc2hDb29raWVNaWdyYXRpb24oY29va2llLCBjb29raWVOYW1lKSB7XG4gICAgdmFyIGRhdGUgPSBuZXcgRGF0ZSgpLFxuICAgICAgICBjb29raWVEb21haW4gPSBQZXJzaXN0ZW5jZS5nZXRDb29raWVEb21haW4oKSxcbiAgICAgICAgZXhwaXJlcyxcbiAgICAgICAgZG9tYWluO1xuXG4gICAgZXhwaXJlcyA9IG5ldyBEYXRlKGRhdGUuZ2V0VGltZSgpICtcbiAgICAoQ29uZmlnLkNvb2tpZUV4cGlyYXRpb24gKiAyNCAqIDYwICogNjAgKiAxMDAwKSkudG9HTVRTdHJpbmcoKTtcblxuICAgIGlmIChjb29raWVEb21haW4gPT09ICcnKSB7XG4gICAgICAgIGRvbWFpbiA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGRvbWFpbiA9ICc7ZG9tYWluPScgKyBjb29raWVEb21haW47XG4gICAgfVxuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhDb25zdGFudHMuTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Db29raWVTZXQpO1xuXG4gICAgd2luZG93LmRvY3VtZW50LmNvb2tpZSA9XG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KENvbmZpZy5Db29raWVOYW1lVjQpICsgJz0nICsgY29va2llICtcbiAgICAnO2V4cGlyZXM9JyArIGV4cGlyZXMgK1xuICAgICc7cGF0aD0vJyArIGRvbWFpbjtcblxuICAgIFBlcnNpc3RlbmNlLmV4cGlyZUNvb2tpZXMoY29va2llTmFtZSk7XG4gICAgTVAubWlncmF0aW5nVG9JRFN5bmNDb29raWVzID0gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMSkge1xuICAgIHZhciBwYXJzZWRDb29raWVzVjQgPSBKU09OLnBhcnNlKHJlc3RydWN0dXJlVG9WNENvb2tpZShkZWNvZGVVUklDb21wb25lbnQoU0RLdjFDb29raWVzVjEpKSksXG4gICAgICAgIHBhcnNlZFNES3YxQ29va2llc1YxID0gSlNPTi5wYXJzZShkZWNvZGVVUklDb21wb25lbnQoU0RLdjFDb29raWVzVjEpKTtcblxuICAgIC8vIFVJIHdhcyBzdG9yZWQgYXMgYW4gYXJyYXkgcHJldmlvdXNseSwgd2UgbmVlZCB0byBjb252ZXJ0IHRvIGFuIG9iamVjdFxuICAgIHBhcnNlZENvb2tpZXNWNCA9IGNvbnZlcnRVSUZyb21BcnJheVRvT2JqZWN0KHBhcnNlZENvb2tpZXNWNCk7XG5cbiAgICBpZiAocGFyc2VkU0RLdjFDb29raWVzVjEubXBpZCkge1xuICAgICAgICBwYXJzZWRDb29raWVzVjQuZ3MuY3NtLnB1c2gocGFyc2VkU0RLdjFDb29raWVzVjEubXBpZCk7XG4gICAgICAgIG1pZ3JhdGVQcm9kdWN0c0Zyb21TREt2MVRvU0RLdjJDb29raWVzVjQocGFyc2VkU0RLdjFDb29raWVzVjEsIHBhcnNlZFNES3YxQ29va2llc1YxLm1waWQpO1xuICAgIH1cblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXJzZWRDb29raWVzVjQpO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U0RLdjFDb29raWVzVjJUb1NES3YyQ29va2llc1Y0KFNES3YxQ29va2llc1YyKSB7XG4gICAgLy8gc3RydWN0dXJlIG9mIFNES3YxQ29va2llc1YyIGlzIGlkZW50aXRhbCB0byBTREt2MUNvb2tpZXNWMVxuICAgIHJldHVybiBjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0KFNES3YxQ29va2llc1YyKTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YxQ29va2llc1YzVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMykge1xuICAgIFNES3YxQ29va2llc1YzID0gUGVyc2lzdGVuY2UucmVwbGFjZVBpcGVzV2l0aENvbW1hcyhQZXJzaXN0ZW5jZS5yZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzKFNES3YxQ29va2llc1YzKSk7XG4gICAgdmFyIHBhcnNlZFNES3YxQ29va2llc1YzID0gSlNPTi5wYXJzZShTREt2MUNvb2tpZXNWMyk7XG4gICAgdmFyIHBhcnNlZENvb2tpZXNWNCA9IEpTT04ucGFyc2UocmVzdHJ1Y3R1cmVUb1Y0Q29va2llKFNES3YxQ29va2llc1YzKSk7XG5cbiAgICBpZiAocGFyc2VkU0RLdjFDb29raWVzVjMubXBpZCkge1xuICAgICAgICBwYXJzZWRDb29raWVzVjQuZ3MuY3NtLnB1c2gocGFyc2VkU0RLdjFDb29raWVzVjMubXBpZCk7XG4gICAgICAgIC8vIGFsbCBvdGhlciB2YWx1ZXMgYXJlIGFscmVhZHkgZW5jb2RlZCwgc28gd2UgaGF2ZSB0byBlbmNvZGUgYW55IG5ldyB2YWx1ZXNcbiAgICAgICAgcGFyc2VkQ29va2llc1Y0LmdzLmNzbSA9IEJhc2U2NC5lbmNvZGUoSlNPTi5zdHJpbmdpZnkocGFyc2VkQ29va2llc1Y0LmdzLmNzbSkpO1xuICAgICAgICBtaWdyYXRlUHJvZHVjdHNGcm9tU0RLdjFUb1NES3YyQ29va2llc1Y0KHBhcnNlZFNES3YxQ29va2llc1YzLCBwYXJzZWRTREt2MUNvb2tpZXNWMy5tcGlkKTtcbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGFyc2VkQ29va2llc1Y0KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQoU0RLdjJDb29raWVzVjEpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgY29va2llc1Y0ID0geyBnczoge319LFxuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHMgPSB7fTtcblxuICAgICAgICBTREt2MkNvb2tpZXNWMSA9IEpTT04ucGFyc2UoU0RLdjJDb29raWVzVjEpO1xuICAgICAgICBjb29raWVzVjQgPSBzZXRHbG9iYWxTZXR0aW5ncyhjb29raWVzVjQsIFNES3YyQ29va2llc1YxKTtcblxuICAgICAgICAvLyBzZXQgZWFjaCBNUElEJ3MgcmVzcGVjdGl2ZSBwZXJzaXN0ZW5jZVxuICAgICAgICBmb3IgKHZhciBtcGlkIGluIFNES3YyQ29va2llc1YxKSB7XG4gICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICBjb29raWVzVjRbbXBpZF0gPSB7fTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtcGlkS2V5IGluIFNES3YyQ29va2llc1YxW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChTREt2MkNvb2tpZXNWMVttcGlkXS5oYXNPd25Qcm9wZXJ0eShtcGlkS2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1QSURLZXlzW21waWRLZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0pICYmIE9iamVjdC5rZXlzKFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG1waWRLZXkgPT09ICd1aScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFttcGlkXS51aSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgdHlwZU5hbWUgaW4gU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0uaGFzT3duUHJvcGVydHkodHlwZU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFttcGlkXS51aVtUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKHR5cGVOYW1lKV0gPSBTREt2MkNvb2tpZXNWMVttcGlkXVttcGlkS2V5XVt0eXBlTmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0W21waWRdW21waWRLZXldID0gU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2VQcm9kdWN0c1ttcGlkXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgY3A6IFNES3YyQ29va2llc1YxW21waWRdLmNwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0LCBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGxvY2FsU3RvcmFnZVByb2R1Y3RzKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFNES3YyQ29va2llc1YxLmN1cnJlbnRVc2VyTVBJRCkge1xuICAgICAgICAgICAgY29va2llc1Y0LmN1ID0gU0RLdjJDb29raWVzVjEuY3VycmVudFVzZXJNUElEO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGNvb2tpZXNWNCk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0ZhaWxlZCB0byBjb252ZXJ0IGNvb2tpZXMgZnJvbSBTREt2MiBjb29raWVzIHYxIHRvIFNES3YyIGNvb2tpZXMgdjQnKTtcbiAgICB9XG59XG5cbi8vIG1pZ3JhdGUgZnJvbSBvYmplY3QgY29udGFpbmluZyBnbG9iYWxTZXR0aW5ncyB0byBncyB0byByZWR1Y2UgY29va2llIHNpemVcbmZ1bmN0aW9uIHNldEdsb2JhbFNldHRpbmdzKGNvb2tpZXMsIFNES3YyQ29va2llc1YxKSB7XG4gICAgaWYgKFNES3YyQ29va2llc1YxICYmIFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzKSB7XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5ncykge1xuICAgICAgICAgICAgaWYgKFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSAnY3VycmVudFNlc3Npb25NUElEcycpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llcy5ncy5jc20gPSBTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5nc1trZXldO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSAnaXNFbmFibGVkJykge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzLmdzLmllID0gU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3Nba2V5XTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzLmdzW2tleV0gPSBTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5nc1trZXldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb29raWVzO1xufVxuXG5mdW5jdGlvbiByZXN0cnVjdHVyZVRvVjRDb29raWUoY29va2llcykge1xuICAgIHRyeSB7XG4gICAgICAgIHZhciBjb29raWVzVjRTY2hlbWEgPSB7IGdzOiB7Y3NtOiBbXX0gfTtcbiAgICAgICAgY29va2llcyA9IEpTT04ucGFyc2UoY29va2llcyk7XG5cbiAgICAgICAgZm9yICh2YXIga2V5IGluIGNvb2tpZXMpIHtcbiAgICAgICAgICAgIGlmIChjb29raWVzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoQ29va2llc0dsb2JhbFNldHRpbmdzS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChrZXkgPT09ICdpc0VuYWJsZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRTY2hlbWEuZ3MuaWUgPSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRTY2hlbWEuZ3Nba2V5XSA9IGNvb2tpZXNba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSAnbXBpZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0U2NoZW1hLmN1ID0gY29va2llc1trZXldO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY29va2llcy5tcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFNjaGVtYVtjb29raWVzLm1waWRdID0gY29va2llc1Y0U2NoZW1hW2Nvb2tpZXMubXBpZF0gfHwge307XG4gICAgICAgICAgICAgICAgICAgIGlmIChNUElES2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRTY2hlbWFbY29va2llcy5tcGlkXVtrZXldID0gY29va2llc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb29raWVzVjRTY2hlbWEpO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdGYWlsZWQgdG8gcmVzdHJ1Y3R1cmUgcHJldmlvdXMgY29va2llIGludG8gbW9zdCBjdXJyZW50IGNvb2tpZSBzY2hlbWEnKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIG1pZ3JhdGVQcm9kdWN0c0Zyb21TREt2MVRvU0RLdjJDb29raWVzVjQoY29va2llcywgbXBpZCkge1xuICAgIGlmICghTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBsb2NhbFN0b3JhZ2VQcm9kdWN0cyA9IHt9O1xuICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdID0ge307XG4gICAgaWYgKGNvb2tpZXMuY3ApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdLmNwID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGNvb2tpZXMuY3ApKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0uY3AgPSBjb29raWVzLmNwO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdLmNwKSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0uY3AgPSBbXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0LCBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGxvY2FsU3RvcmFnZVByb2R1Y3RzKSkpO1xufVxuXG5mdW5jdGlvbiBtaWdyYXRlTG9jYWxTdG9yYWdlKCkge1xuICAgIHZhciBjdXJyZW50VmVyc2lvbkxTTmFtZSA9IENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQsXG4gICAgICAgIGNvb2tpZXMsXG4gICAgICAgIHYxTFNOYW1lID0gQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWUsXG4gICAgICAgIHYzTFNOYW1lID0gQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWMyxcbiAgICAgICAgY3VycmVudFZlcnNpb25MU0RhdGEgPSB3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0oY3VycmVudFZlcnNpb25MU05hbWUpLFxuICAgICAgICB2MUxTRGF0YSxcbiAgICAgICAgdjNMU0RhdGEsXG4gICAgICAgIHYzTFNEYXRhU3RyaW5nQ29weTtcblxuICAgIGlmICghY3VycmVudFZlcnNpb25MU0RhdGEpIHtcbiAgICAgICAgdjNMU0RhdGEgPSB3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0odjNMU05hbWUpO1xuICAgICAgICBpZiAodjNMU0RhdGEpIHtcbiAgICAgICAgICAgIE1QLm1pZ3JhdGluZ1RvSURTeW5jQ29va2llcyA9IHRydWU7XG4gICAgICAgICAgICB2M0xTRGF0YVN0cmluZ0NvcHkgPSB2M0xTRGF0YS5zbGljZSgpO1xuICAgICAgICAgICAgdjNMU0RhdGEgPSBKU09OLnBhcnNlKFBlcnNpc3RlbmNlLnJlcGxhY2VQaXBlc1dpdGhDb21tYXMoUGVyc2lzdGVuY2UucmVwbGFjZUFwb3N0cm9waGVzV2l0aFF1b3Rlcyh2M0xTRGF0YSkpKTtcbiAgICAgICAgICAgIC8vIGxvY2FsU3RvcmFnZSBtYXkgY29udGFpbiBvbmx5IHByb2R1Y3RzLCBvciB0aGUgZnVsbCBwZXJzaXN0ZW5jZVxuICAgICAgICAgICAgLy8gd2hlbiB0aGVyZSBpcyBhbiBNUElEIG9uIHRoZSBjb29raWUsIGl0IGlzIHRoZSBmdWxsIHBlcnNpc3RlbmNlXG4gICAgICAgICAgICBpZiAodjNMU0RhdGEubXBpZCkge1xuICAgICAgICAgICAgICAgIHYzTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0KHYzTFNEYXRhU3RyaW5nQ29weSkpO1xuICAgICAgICAgICAgICAgIGZpbmlzaExTTWlncmF0aW9uKEpTT04uc3RyaW5naWZ5KHYzTFNEYXRhKSwgdjNMU05hbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIC8vIGlmIG5vIE1QSUQsIGl0IGlzIG9ubHkgdGhlIHByb2R1Y3RzXG4gICAgICAgICAgICB9IGVsc2UgaWYgKCh2M0xTRGF0YS5jcCB8fCB2M0xTRGF0YS5wYikgJiYgIXYzTFNEYXRhLm1waWQpIHtcbiAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCk7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNCh2M0xTRGF0YSwgY29va2llcy5jdSk7XG4gICAgICAgICAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjMpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWMyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2MUxTRGF0YSA9IEpTT04ucGFyc2UoZGVjb2RlVVJJQ29tcG9uZW50KHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSh2MUxTTmFtZSkpKTtcbiAgICAgICAgICAgIGlmICh2MUxTRGF0YSkge1xuICAgICAgICAgICAgICAgIE1QLm1pZ3JhdGluZ1RvSURTeW5jQ29va2llcyA9IHRydWU7XG4gICAgICAgICAgICAgICAgLy8gU0RLdjJcbiAgICAgICAgICAgICAgICBpZiAodjFMU0RhdGEuZ2xvYmFsU2V0dGluZ3MgfHwgdjFMU0RhdGEuY3VycmVudFVzZXJNUElEKSB7XG4gICAgICAgICAgICAgICAgICAgIHYxTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjJDb29raWVzVjFUb1NES3YyRGVjb2RlZENvb2tpZXNWNChKU09OLnN0cmluZ2lmeSh2MUxTRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gU0RLdjFcbiAgICAgICAgICAgICAgICAgICAgLy8gb25seSBwcm9kdWN0cywgbm90IGZ1bGwgcGVyc2lzdGVuY2VcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCh2MUxTRGF0YS5jcCB8fCB2MUxTRGF0YS5wYikgJiYgIXYxTFNEYXRhLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNCh2MUxTRGF0YSwgY29va2llcy5jdSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0odjFMU05hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKHYxTFNOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHYxTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0KEpTT04uc3RyaW5naWZ5KHYxTFNEYXRhKSkpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KHYxTFNEYXRhKSAmJiBPYmplY3Qua2V5cyh2MUxTRGF0YSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIHYxTFNEYXRhID0gUGVyc2lzdGVuY2UuZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeSh2MUxTRGF0YSkpO1xuICAgICAgICAgICAgICAgICAgICBmaW5pc2hMU01pZ3JhdGlvbih2MUxTRGF0YSwgdjFMU05hbWUpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmluaXNoTFNNaWdyYXRpb24oZGF0YSwgbHNOYW1lKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oZW5jb2RlVVJJQ29tcG9uZW50KENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQpLCBkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igd2l0aCBzZXR0aW5nIGxvY2FsU3RvcmFnZSBpdGVtLicpO1xuICAgICAgICB9XG4gICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShlbmNvZGVVUklDb21wb25lbnQobHNOYW1lKSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0VUlGcm9tQXJyYXlUb09iamVjdChjb29raWUpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoY29va2llICYmIEhlbHBlcnMuaXNPYmplY3QoY29va2llKSkge1xuICAgICAgICAgICAgZm9yICh2YXIgbXBpZCBpbiBjb29raWUpIHtcbiAgICAgICAgICAgICAgICBpZiAoY29va2llLmhhc093blByb3BlcnR5KG1waWQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghU0RLdjJOb25NUElEQ29va2llS2V5c1ttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZVttcGlkXS51aSAmJiBBcnJheS5pc0FycmF5KGNvb2tpZVttcGlkXS51aSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVbbXBpZF0udWkgPSBjb29raWVbbXBpZF0udWkucmVkdWNlKGZ1bmN0aW9uKGFjY3VtLCBpZGVudGl0eSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHkuVHlwZSAmJiBIZWxwZXJzLlZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcihpZGVudGl0eS5JZGVudGl0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjY3VtW2lkZW50aXR5LlR5cGVdID0gaWRlbnRpdHkuSWRlbnRpdHk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFjY3VtO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIHt9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjb29raWU7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0FuIGVycm9yIG9jdXJyZWQgd2hlbiBjb252ZXJ0aW5nIHRoZSB1c2VyIGlkZW50aXRpZXMgYXJyYXkgdG8gYW4gb2JqZWN0JywgZSk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBtaWdyYXRlOiBtaWdyYXRlLFxuICAgIGNvbnZlcnRVSUZyb21BcnJheVRvT2JqZWN0OiBjb252ZXJ0VUlGcm9tQXJyYXlUb09iamVjdCxcbiAgICBjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0OiBjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0LFxuICAgIGNvbnZlcnRTREt2MUNvb2tpZXNWMlRvU0RLdjJDb29raWVzVjQ6IGNvbnZlcnRTREt2MUNvb2tpZXNWMlRvU0RLdjJDb29raWVzVjQsXG4gICAgY29udmVydFNES3YxQ29va2llc1YzVG9TREt2MkNvb2tpZXNWNDogY29udmVydFNES3YxQ29va2llc1YzVG9TREt2MkNvb2tpZXNWNCxcbiAgICBjb252ZXJ0U0RLdjJDb29raWVzVjFUb1NES3YyRGVjb2RlZENvb2tpZXNWNDogY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjRcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBpc0VuYWJsZWQ6IHRydWUsXG4gICAgc2Vzc2lvbkF0dHJpYnV0ZXM6IHt9LFxuICAgIGN1cnJlbnRTZXNzaW9uTVBJRHM6IFtdLFxuICAgIHVzZXJBdHRyaWJ1dGVzOiB7fSxcbiAgICB1c2VySWRlbnRpdGllczoge30sXG4gICAgY29uc2VudFN0YXRlOiBudWxsLFxuICAgIGZvcndhcmRlckNvbnN0cnVjdG9yczogW10sXG4gICAgYWN0aXZlRm9yd2FyZGVyczogW10sXG4gICAgY29uZmlndXJlZEZvcndhcmRlcnM6IFtdLFxuICAgIHNlc3Npb25JZDogbnVsbCxcbiAgICBpc0ZpcnN0UnVuOiBudWxsLFxuICAgIGNsaWVudElkOiBudWxsLFxuICAgIGRldmljZUlkOiBudWxsLFxuICAgIG1waWQ6IG51bGwsXG4gICAgZGV2VG9rZW46IG51bGwsXG4gICAgbWlncmF0aW9uRGF0YToge30sXG4gICAgcGl4ZWxDb25maWd1cmF0aW9uczogW10sXG4gICAgc2VydmVyU2V0dGluZ3M6IHt9LFxuICAgIGRhdGVMYXN0RXZlbnRTZW50OiBudWxsLFxuICAgIHNlc3Npb25TdGFydERhdGU6IG51bGwsXG4gICAgY29va2llU3luY0RhdGVzOiB7fSxcbiAgICBjdXJyZW50UG9zaXRpb246IG51bGwsXG4gICAgaXNUcmFja2luZzogZmFsc2UsXG4gICAgd2F0Y2hQb3NpdGlvbklkOiBudWxsLFxuICAgIHJlYWR5UXVldWU6IFtdLFxuICAgIGlzSW5pdGlhbGl6ZWQ6IGZhbHNlLFxuICAgIGNhcnRQcm9kdWN0czogW10sXG4gICAgZXZlbnRRdWV1ZTogW10sXG4gICAgY3VycmVuY3lDb2RlOiBudWxsLFxuICAgIGFwcFZlcnNpb246IG51bGwsXG4gICAgYXBwTmFtZTogbnVsbCxcbiAgICBjdXN0b21GbGFnczogbnVsbCxcbiAgICBnbG9iYWxUaW1lcjogbnVsbCxcbiAgICBjb250ZXh0OiAnJyxcbiAgICBpZGVudGl0eUNhbGxJbkZsaWdodDogZmFsc2UsXG4gICAgaW5pdGlhbElkZW50aWZ5UmVxdWVzdDogbnVsbCxcbiAgICBsb2dMZXZlbDogbnVsbCxcbiAgICBDb25maWc6IHt9LFxuICAgIG1pZ3JhdGluZ1RvSURTeW5jQ29va2llczogZmFsc2UsXG4gICAgbm9uQ3VycmVudFVzZXJNUElEczoge30sXG4gICAgaWRlbnRpZnlDYWxsZWQ6IGZhbHNlLFxuICAgIGlzTG9nZ2VkSW46IGZhbHNlLFxuICAgIGludGVncmF0aW9uQXR0cmlidXRlczoge30sXG4gICAgaW50ZWdyYXRpb25EZWxheXM6IHt9LFxuICAgIHJlcXVpcmVEZWxheTogdHJ1ZSxcbiAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgYmF0Y2hpbmc6IGZhbHNlXG4gICAgfSxcbiAgICBpc0xvY2FsU3RvcmFnZUF2YWlsYWJsZTogbnVsbCxcbiAgICBicmlkZ2VWZXJzaW9uOiBudWxsXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBNZXNzYWdlcyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJykuTWVzc2FnZXM7XG5cbnZhciBhbmRyb2lkQnJpZGdlTmFtZUJhc2UgPSAnbVBhcnRpY2xlQW5kcm9pZCc7XG52YXIgaW9zQnJpZGdlTmFtZUJhc2UgPSAnbVBhcnRpY2xlJztcblxuZnVuY3Rpb24gaXNCcmlkZ2VWMkF2YWlsYWJsZShicmlkZ2VOYW1lKSB7XG4gICAgaWYgKCFicmlkZ2VOYW1lKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdmFyIGFuZHJvaWRCcmlkZ2VOYW1lID0gYW5kcm9pZEJyaWRnZU5hbWVCYXNlICsgJ18nICsgYnJpZGdlTmFtZSArICdfdjInO1xuICAgIHZhciBpb3NCcmlkZ2VOYW1lID0gaW9zQnJpZGdlTmFtZUJhc2UgKyAnXycgKyBicmlkZ2VOYW1lICsgJ192Mic7XG5cbiAgICAvLyBpT1NcbiAgICBpZiAod2luZG93LndlYmtpdCAmJiB3aW5kb3cud2Via2l0Lm1lc3NhZ2VIYW5kbGVycyAmJiB3aW5kb3cud2Via2l0Lm1lc3NhZ2VIYW5kbGVycy5oYXNPd25Qcm9wZXJ0eShpb3NCcmlkZ2VOYW1lKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gYW5kcm9pZFxuICAgIGlmICh3aW5kb3cuaGFzT3duUHJvcGVydHkoYW5kcm9pZEJyaWRnZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGlzV2Vidmlld0VuYWJsZWQocmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZSwgbWluV2Vidmlld0JyaWRnZVZlcnNpb24pIHtcbiAgICBpZiAobVBhcnRpY2xlLndlYnZpZXdFbmFibGVkKSB7XG4gICAgICAgIGlmIChtaW5XZWJ2aWV3QnJpZGdlVmVyc2lvbiA8IDIpIHtcbiAgICAgICAgICAgIHJldHVybiBpc0JyaWRnZVYxQXZhaWxhYmxlKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uID09PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4gaXNCcmlkZ2VWMkF2YWlsYWJsZShyZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSBpZiAobWluV2Vidmlld0JyaWRnZVZlcnNpb24gPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIGlzQnJpZGdlVjFBdmFpbGFibGUoKTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBpc0JyaWRnZVYxQXZhaWxhYmxlKCkge1xuICAgIGlmIChtUGFydGljbGUudXNlTmF0aXZlU2RrIHx8IHdpbmRvdy5tUGFydGljbGVBbmRyb2lkXG4gICAgICAgIHx8IHdpbmRvdy5tUGFydGljbGUuaXNJT1MpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZW5kVG9OYXRpdmUocGF0aCwgdmFsdWUpIHtcbiAgICBpZiAobVBhcnRpY2xlLm1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uIDwgMikge1xuICAgICAgICBzZW5kVmlhQnJpZGdlVjEocGF0aCwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbmRWaWFCcmlkZ2VWMihwYXRoLCB2YWx1ZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZW5kVmlhQnJpZGdlVjEocGF0aCwgdmFsdWUpIHtcbiAgICBpZiAod2luZG93Lm1QYXJ0aWNsZUFuZHJvaWQgJiYgd2luZG93Lm1QYXJ0aWNsZUFuZHJvaWQuaGFzT3duUHJvcGVydHkocGF0aCkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRBbmRyb2lkICsgcGF0aCk7XG4gICAgICAgIHdpbmRvdy5tUGFydGljbGVBbmRyb2lkW3BhdGhdKHZhbHVlKTtcbiAgICB9XG4gICAgZWxzZSBpZiAod2luZG93Lm1QYXJ0aWNsZS5pc0lPUykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZElPUyArIHBhdGgpO1xuICAgICAgICB2YXIgaWZyYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnSUZSQU1FJyk7XG4gICAgICAgIGlmcmFtZS5zZXRBdHRyaWJ1dGUoJ3NyYycsICdtcC1zZGs6Ly8nICsgcGF0aCArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpO1xuICAgICAgICBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuYXBwZW5kQ2hpbGQoaWZyYW1lKTtcbiAgICAgICAgaWZyYW1lLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoaWZyYW1lKTtcbiAgICAgICAgaWZyYW1lID0gbnVsbDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRWaWFCcmlkZ2VWMihwYXRoLCB2YWx1ZSkge1xuICAgIHZhciBhbmRyb2lkQnJpZGdlTmFtZSA9IGFuZHJvaWRCcmlkZ2VOYW1lQmFzZSArICdfJyArIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lICsgJ192Mic7XG4gICAgdmFyIGlvc0JyaWRnZU5hbWUgPSBpb3NCcmlkZ2VOYW1lQmFzZSArICdfJyArIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lICsgJ192Mic7XG4gICAgdmFyIGFuZHJvaWRCcmlkZ2UgPSB3aW5kb3dbYW5kcm9pZEJyaWRnZU5hbWVdLFxuICAgICAgICBpT1NCcmlkZ2UgPSB3aW5kb3cud2Via2l0ICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzW2lvc0JyaWRnZU5hbWVdID8gd2luZG93LndlYmtpdC5tZXNzYWdlSGFuZGxlcnNbaW9zQnJpZGdlTmFtZV0gOiBudWxsO1xuICAgIGlmIChhbmRyb2lkQnJpZGdlICYmIGFuZHJvaWRCcmlkZ2UuaGFzT3duUHJvcGVydHkocGF0aCkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRBbmRyb2lkICsgcGF0aCk7XG4gICAgICAgIGFuZHJvaWRCcmlkZ2VbcGF0aF0odmFsdWUpO1xuICAgIH1cbiAgICBlbHNlIGlmIChpT1NCcmlkZ2UpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRJT1MgKyBwYXRoKTtcbiAgICAgICAgaU9TQnJpZGdlLnBvc3RNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHtwYXRoOnBhdGgsIHZhbHVlOiB2YWx1ZSA/IEpTT04ucGFyc2UodmFsdWUpIDogbnVsbH0pKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGlzV2Vidmlld0VuYWJsZWQ6IGlzV2Vidmlld0VuYWJsZWQsXG4gICAgaXNCcmlkZ2VWMkF2YWlsYWJsZTppc0JyaWRnZVYyQXZhaWxhYmxlLFxuICAgIHNlbmRUb05hdGl2ZTogc2VuZFRvTmF0aXZlLFxuICAgIHNlbmRWaWFCcmlkZ2VWMTogc2VuZFZpYUJyaWRnZVYxLFxuICAgIHNlbmRWaWFCcmlkZ2VWMjogc2VuZFZpYUJyaWRnZVYyXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBDb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLFxuICAgIEJhc2U2NCA9IHJlcXVpcmUoJy4vcG9seWZpbGwnKS5CYXNlNjQsXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgQmFzZTY0Q29va2llS2V5cyA9IENvbnN0YW50cy5CYXNlNjRDb29raWVLZXlzLFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXMgPSBDb25zdGFudHMuU0RLdjJOb25NUElEQ29va2llS2V5cyxcbiAgICBDb25zZW50ID0gcmVxdWlyZSgnLi9jb25zZW50JyksXG4gICAgQ29uZmlnID0gTVAuQ29uZmlnO1xuXG5mdW5jdGlvbiB1c2VMb2NhbFN0b3JhZ2UoKSB7XG4gICAgcmV0dXJuICghbVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UgJiYgTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpO1xufVxuXG5mdW5jdGlvbiBpbml0aWFsaXplU3RvcmFnZSgpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgc3RvcmFnZSxcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSB0aGlzLmdldExvY2FsU3RvcmFnZSgpLFxuICAgICAgICAgICAgY29va2llcyA9IHRoaXMuZ2V0Q29va2llKCksXG4gICAgICAgICAgICBhbGxEYXRhO1xuXG4gICAgICAgIC8vIERldGVybWluZSBpZiB0aGVyZSBpcyBhbnkgZGF0YSBpbiBjb29raWVzIG9yIGxvY2FsU3RvcmFnZSB0byBmaWd1cmUgb3V0IGlmIGl0IGlzIHRoZSBmaXJzdCB0aW1lIHRoZSBicm93c2VyIGlzIGxvYWRpbmcgbVBhcnRpY2xlXG4gICAgICAgIGlmICghbG9jYWxTdG9yYWdlRGF0YSAmJiAhY29va2llcykge1xuICAgICAgICAgICAgTVAuaXNGaXJzdFJ1biA9IHRydWU7XG4gICAgICAgICAgICBNUC5tcGlkID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIE1QLmlzRmlyc3RSdW4gPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS51c2VDb29raWVTdG9yYWdlID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgc3RvcmFnZSA9IHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG4gICAgICAgICAgICBpZiAobVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UpIHtcbiAgICAgICAgICAgICAgICAvLyBGb3IgbWlncmF0aW5nIGZyb20gbG9jYWxTdG9yYWdlIHRvIGNvb2tpZXMgLS0gSWYgYW4gaW5zdGFuY2Ugc3dpdGNoZXMgZnJvbSBsb2NhbFN0b3JhZ2UgdG8gY29va2llcywgdGhlblxuICAgICAgICAgICAgICAgIC8vIG5vIG1QYXJ0aWNsZSBjb29raWUgZXhpc3RzIHlldCBhbmQgdGhlcmUgaXMgbG9jYWxTdG9yYWdlLiBHZXQgdGhlIGxvY2FsU3RvcmFnZSwgc2V0IHRoZW0gdG8gY29va2llcywgdGhlbiBkZWxldGUgdGhlIGxvY2FsU3RvcmFnZSBpdGVtLlxuICAgICAgICAgICAgICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gSGVscGVycy5leHRlbmQoZmFsc2UsIGxvY2FsU3RvcmFnZURhdGEsIGNvb2tpZXMpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IGxvY2FsU3RvcmFnZURhdGE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RvcmFnZS5yZW1vdmVJdGVtKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY29va2llcykge1xuICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gY29va2llcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShhbGxEYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIEZvciBtaWdyYXRpbmcgZnJvbSBjb29raWUgdG8gbG9jYWxTdG9yYWdlIC0tIElmIGFuIGluc3RhbmNlIGlzIG5ld2x5IHN3aXRjaGluZyBmcm9tIGNvb2tpZXMgdG8gbG9jYWxTdG9yYWdlLCB0aGVuXG4gICAgICAgICAgICAgICAgLy8gbm8gbVBhcnRpY2xlIGxvY2FsU3RvcmFnZSBleGlzdHMgeWV0IGFuZCB0aGVyZSBhcmUgY29va2llcy4gR2V0IHRoZSBjb29raWVzLCBzZXQgdGhlbSB0byBsb2NhbFN0b3JhZ2UsIHRoZW4gZGVsZXRlIHRoZSBjb29raWVzLlxuICAgICAgICAgICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gSGVscGVycy5leHRlbmQoZmFsc2UsIGxvY2FsU3RvcmFnZURhdGEsIGNvb2tpZXMpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IGNvb2tpZXM7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShhbGxEYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHBpcmVDb29raWVzKE1QLkNvbmZpZy5Db29raWVOYW1lVjQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkobG9jYWxTdG9yYWdlRGF0YSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgICAgICB2YXIgZW5jb2RlZFByb2R1Y3RzID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oTVAuQ29uZmlnLkxvY2FsU3RvcmFnZVByb2R1Y3RzVjQpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGVuY29kZWRQcm9kdWN0cykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVjb2RlZFByb2R1Y3RzID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGVuY29kZWRQcm9kdWN0cykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBzdG9yZVByb2R1Y3RzSW5NZW1vcnkoZGVjb2RlZFByb2R1Y3RzLCBNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IFtdO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgbG9hZGluZyBwcm9kdWN0cyBpbiBpbml0aWFsaXphdGlvbjogJyArIGUpO1xuICAgICAgICB9XG5cblxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gYWxsRGF0YSkge1xuICAgICAgICAgICAgaWYgKGFsbERhdGEuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgIGlmICghU0RLdjJOb25NUElEQ29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLm5vbkN1cnJlbnRVc2VyTVBJRHNba2V5XSA9IGFsbERhdGFba2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVwZGF0ZSgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKHVzZUxvY2FsU3RvcmFnZSgpICYmIE1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShDb25maWcuTG9jYWxTdG9yYWdlTmFtZVY0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV4cGlyZUNvb2tpZXMoQ29uZmlnLkNvb2tpZU5hbWVWNCk7XG4gICAgICAgIH1cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgaW5pdGlhbGl6aW5nIHN0b3JhZ2U6ICcgKyBlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZSgpIHtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICAgICAgdGhpcy5zZXRDb29raWUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdG9yZVByb2R1Y3RzSW5NZW1vcnkocHJvZHVjdHMsIG1waWQpIHtcbiAgICBpZiAocHJvZHVjdHMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IHByb2R1Y3RzW21waWRdICYmIHByb2R1Y3RzW21waWRdLmNwID8gcHJvZHVjdHNbbXBpZF0uY3AgOiBbXTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQ29va2llUGFyc2VFcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN0b3JlRGF0YUluTWVtb3J5KG9iaiwgY3VycmVudE1QSUQpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoIW9iaikge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZU5vdEZvdW5kKTtcbiAgICAgICAgICAgIE1QLmNsaWVudElkID0gTVAuY2xpZW50SWQgfHwgSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgICAgICAgICBNUC5kZXZpY2VJZCA9IE1QLmRldmljZUlkIHx8IEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0ge307XG4gICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBTZXQgTVBJRCBmaXJzdCwgdGhlbiBjaGFuZ2Ugb2JqZWN0IHRvIG1hdGNoIE1QSUQgZGF0YVxuICAgICAgICAgICAgaWYgKGN1cnJlbnRNUElEKSB7XG4gICAgICAgICAgICAgICAgTVAubXBpZCA9IGN1cnJlbnRNUElEO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBNUC5tcGlkID0gb2JqLmN1IHx8IDA7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9iai5ncyA9IG9iai5ncyB8fCB7fTtcblxuICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gb2JqLmdzLnNpZCB8fCBNUC5zZXNzaW9uSWQ7XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSAodHlwZW9mIG9iai5ncy5pZSAhPT0gJ3VuZGVmaW5lZCcpID8gb2JqLmdzLmllIDogTVAuaXNFbmFibGVkO1xuICAgICAgICAgICAgTVAuc2Vzc2lvbkF0dHJpYnV0ZXMgPSBvYmouZ3Muc2EgfHwgTVAuc2Vzc2lvbkF0dHJpYnV0ZXM7XG4gICAgICAgICAgICBNUC5zZXJ2ZXJTZXR0aW5ncyA9IG9iai5ncy5zcyB8fCBNUC5zZXJ2ZXJTZXR0aW5ncztcbiAgICAgICAgICAgIE1QLmRldlRva2VuID0gTVAuZGV2VG9rZW4gfHwgb2JqLmdzLmR0O1xuICAgICAgICAgICAgTVAuYXBwVmVyc2lvbiA9IE1QLmFwcFZlcnNpb24gfHwgb2JqLmdzLmF2O1xuICAgICAgICAgICAgTVAuY2xpZW50SWQgPSBvYmouZ3MuY2dpZCB8fCBNUC5jbGllbnRJZCB8fCBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICAgICAgICAgIE1QLmRldmljZUlkID0gb2JqLmdzLmRhcyB8fCBNUC5kZXZpY2VJZCB8fCBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICAgICAgICAgIE1QLmludGVncmF0aW9uQXR0cmlidXRlcyA9IG9iai5ncy5pYSB8fCB7fTtcbiAgICAgICAgICAgIE1QLmNvbnRleHQgPSBvYmouZ3MuYyB8fCBNUC5jb250ZXh0O1xuICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcyA9IG9iai5ncy5jc20gfHwgTVAuY3VycmVudFNlc3Npb25NUElEcztcblxuICAgICAgICAgICAgTVAuaXNMb2dnZWRJbiA9IG9iai5sID09PSB0cnVlO1xuXG4gICAgICAgICAgICBpZiAob2JqLmdzLmxlcykge1xuICAgICAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbmV3IERhdGUob2JqLmdzLmxlcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChvYmouZ3Muc3NkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvblN0YXJ0RGF0ZSA9IG5ldyBEYXRlKG9iai5ncy5zc2QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGN1cnJlbnRNUElEKSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW2N1cnJlbnRNUElEXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW29iai5jdV07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE1QLnVzZXJBdHRyaWJ1dGVzID0gb2JqLnVhIHx8IE1QLnVzZXJBdHRyaWJ1dGVzO1xuICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBvYmoudWkgfHwgTVAudXNlcklkZW50aXRpZXM7XG4gICAgICAgICAgICBNUC5jb25zZW50U3RhdGUgPSBvYmouY29uID8gQ29uc2VudC5TZXJpYWxpemF0aW9uLmZyb21NaW5pZmllZEpzb25PYmplY3Qob2JqLmNvbikgOiBudWxsO1xuXG4gICAgICAgICAgICBpZiAob2JqLmNzZCkge1xuICAgICAgICAgICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlcyA9IG9iai5jc2Q7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkNvb2tpZVBhcnNlRXJyb3IpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KHN0b3JhZ2UpIHtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgaWYgKG1QYXJ0aWNsZS5fZm9yY2VOb0xvY2FsU3RvcmFnZSkge1xuICAgICAgICBzdG9yYWdlID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIHN0b3JhZ2Uuc2V0SXRlbSgnbXBhcnRpY2xlJywgJ3Rlc3QnKTtcbiAgICAgICAgcmVzdWx0ID0gc3RvcmFnZS5nZXRJdGVtKCdtcGFydGljbGUnKSA9PT0gJ3Rlc3QnO1xuICAgICAgICBzdG9yYWdlLnJlbW92ZUl0ZW0oJ21wYXJ0aWNsZScpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgJiYgc3RvcmFnZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydEluTWVtb3J5RGF0YUZvckNvb2tpZXMoKSB7XG4gICAgdmFyIG1waWREYXRhID0ge1xuICAgICAgICB1YTogTVAudXNlckF0dHJpYnV0ZXMsXG4gICAgICAgIHVpOiBNUC51c2VySWRlbnRpdGllcyxcbiAgICAgICAgY3NkOiBNUC5jb29raWVTeW5jRGF0ZXMsXG4gICAgICAgIGNvbjogTVAuY29uc2VudFN0YXRlID8gQ29uc2VudC5TZXJpYWxpemF0aW9uLnRvTWluaWZpZWRKc29uT2JqZWN0KE1QLmNvbnNlbnRTdGF0ZSkgOiBudWxsXG4gICAgfTtcblxuICAgIHJldHVybiBtcGlkRGF0YTtcbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RzRm9yTG9jYWxTdG9yYWdlKCkge1xuICAgIHZhciBpbk1lbW9yeURhdGFGb3JMb2NhbFN0b3JhZ2UgPSB7XG4gICAgICAgIGNwOiBNUC5jYXJ0UHJvZHVjdHMgPyBNUC5jYXJ0UHJvZHVjdHMubGVuZ3RoIDw9IG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyA/IE1QLmNhcnRQcm9kdWN0cyA6IE1QLmNhcnRQcm9kdWN0cy5zbGljZSgwLCBtUGFydGljbGUubWF4UHJvZHVjdHMpIDogW11cbiAgICB9O1xuXG4gICAgcmV0dXJuIGluTWVtb3J5RGF0YUZvckxvY2FsU3RvcmFnZTtcbn1cblxuZnVuY3Rpb24gZ2V0VXNlclByb2R1Y3RzRnJvbUxTKG1waWQpIHtcbiAgICBpZiAoIU1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICB2YXIgZGVjb2RlZFByb2R1Y3RzLFxuICAgICAgICB1c2VyUHJvZHVjdHMsXG4gICAgICAgIHBhcnNlZFByb2R1Y3RzLFxuICAgICAgICBlbmNvZGVkUHJvZHVjdHMgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShNUC5Db25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCk7XG4gICAgaWYgKGVuY29kZWRQcm9kdWN0cykge1xuICAgICAgICBkZWNvZGVkUHJvZHVjdHMgPSBCYXNlNjQuZGVjb2RlKGVuY29kZWRQcm9kdWN0cyk7XG4gICAgfVxuICAgIC8vIGlmIHRoZXJlIGlzIGFuIE1QSUQsIHdlIGFyZSByZXRyaWV2aW5nIHRoZSB1c2VyJ3MgcHJvZHVjdHMsIHdoaWNoIGlzIGFuIGFycmF5XG4gICAgaWYgKG1waWQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChkZWNvZGVkUHJvZHVjdHMpIHtcbiAgICAgICAgICAgICAgICBwYXJzZWRQcm9kdWN0cyA9IEpTT04ucGFyc2UoZGVjb2RlZFByb2R1Y3RzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZWNvZGVkUHJvZHVjdHMgJiYgcGFyc2VkUHJvZHVjdHNbbXBpZF0gJiYgcGFyc2VkUHJvZHVjdHNbbXBpZF0uY3AgJiYgQXJyYXkuaXNBcnJheShwYXJzZWRQcm9kdWN0c1ttcGlkXS5jcCkpIHtcbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSBwYXJzZWRQcm9kdWN0c1ttcGlkXS5jcDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzID0gW107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdXNlclByb2R1Y3RzO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRBbGxVc2VyUHJvZHVjdHNGcm9tTFMoKSB7XG4gICAgdmFyIGRlY29kZWRQcm9kdWN0cyxcbiAgICAgICAgZW5jb2RlZFByb2R1Y3RzID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oTVAuQ29uZmlnLkxvY2FsU3RvcmFnZVByb2R1Y3RzVjQpLFxuICAgICAgICBwYXJzZWREZWNvZGVkUHJvZHVjdHM7XG4gICAgaWYgKGVuY29kZWRQcm9kdWN0cykge1xuICAgICAgICBkZWNvZGVkUHJvZHVjdHMgPSBCYXNlNjQuZGVjb2RlKGVuY29kZWRQcm9kdWN0cyk7XG4gICAgfVxuICAgIC8vIHJldHVybnMgYW4gb2JqZWN0IHdpdGgga2V5cyBvZiBNUElEIGFuZCB2YWx1ZXMgb2YgYXJyYXkgb2YgcHJvZHVjdHNcbiAgICB0cnkge1xuICAgICAgICBwYXJzZWREZWNvZGVkUHJvZHVjdHMgPSBKU09OLnBhcnNlKGRlY29kZWRQcm9kdWN0cyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBwYXJzZWREZWNvZGVkUHJvZHVjdHMgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkRGVjb2RlZFByb2R1Y3RzO1xufVxuXG5mdW5jdGlvbiBzZXRMb2NhbFN0b3JhZ2UoKSB7XG4gICAgaWYgKCFNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleSA9IE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQsXG4gICAgICAgIGFsbExvY2FsU3RvcmFnZVByb2R1Y3RzID0gZ2V0QWxsVXNlclByb2R1Y3RzRnJvbUxTKCksXG4gICAgICAgIGN1cnJlbnRVc2VyUHJvZHVjdHMgPSB0aGlzLmNvbnZlcnRQcm9kdWN0c0ZvckxvY2FsU3RvcmFnZSgpLFxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gdGhpcy5nZXRMb2NhbFN0b3JhZ2UoKSB8fCB7fSxcbiAgICAgICAgY3VycmVudE1QSUREYXRhO1xuXG4gICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgYWxsTG9jYWxTdG9yYWdlUHJvZHVjdHMgPSBhbGxMb2NhbFN0b3JhZ2VQcm9kdWN0cyB8fCB7fTtcbiAgICAgICAgYWxsTG9jYWxTdG9yYWdlUHJvZHVjdHNbTVAubXBpZF0gPSBjdXJyZW50VXNlclByb2R1Y3RzO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChNUC5Db25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCksIEJhc2U2NC5lbmNvZGUoSlNPTi5zdHJpbmdpZnkoYWxsTG9jYWxTdG9yYWdlUHJvZHVjdHMpKSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHdpdGggc2V0dGluZyBwcm9kdWN0cyBvbiBsb2NhbFN0b3JhZ2UuJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1QYXJ0aWNsZS51c2VDb29raWVTdG9yYWdlKSB7XG4gICAgICAgIGN1cnJlbnRNUElERGF0YSA9IHRoaXMuY29udmVydEluTWVtb3J5RGF0YUZvckNvb2tpZXMoKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YS5ncyA9IGxvY2FsU3RvcmFnZURhdGEuZ3MgfHwge307XG5cbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YS5sID0gTVAuaXNMb2dnZWRJbiA/IDEgOiAwO1xuXG4gICAgICAgIGlmIChNUC5zZXNzaW9uSWQpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZURhdGEuZ3MuY3NtID0gTVAuY3VycmVudFNlc3Npb25NUElEcztcbiAgICAgICAgfVxuXG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEuZ3MuaWUgPSBNUC5pc0VuYWJsZWQ7XG5cbiAgICAgICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZURhdGFbTVAubXBpZF0gPSBjdXJyZW50TVBJRERhdGE7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmN1ID0gTVAubXBpZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhNUC5ub25DdXJyZW50VXNlck1QSURzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSBIZWxwZXJzLmV4dGVuZCh7fSwgbG9jYWxTdG9yYWdlRGF0YSwgTVAubm9uQ3VycmVudFVzZXJNUElEcyk7XG4gICAgICAgICAgICBNUC5ub25DdXJyZW50VXNlck1QSURzID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gdGhpcy5zZXRHbG9iYWxTdG9yYWdlQXR0cmlidXRlcyhsb2NhbFN0b3JhZ2VEYXRhKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChrZXkpLCBlbmNvZGVDb29raWVzKEpTT04uc3RyaW5naWZ5KGxvY2FsU3RvcmFnZURhdGEpKSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHdpdGggc2V0dGluZyBsb2NhbFN0b3JhZ2UgaXRlbS4nKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXMoZGF0YSkge1xuICAgIGRhdGEuZ3Muc2lkID0gTVAuc2Vzc2lvbklkO1xuICAgIGRhdGEuZ3MuaWUgPSBNUC5pc0VuYWJsZWQ7XG4gICAgZGF0YS5ncy5zYSA9IE1QLnNlc3Npb25BdHRyaWJ1dGVzO1xuICAgIGRhdGEuZ3Muc3MgPSBNUC5zZXJ2ZXJTZXR0aW5ncztcbiAgICBkYXRhLmdzLmR0ID0gTVAuZGV2VG9rZW47XG4gICAgZGF0YS5ncy5sZXMgPSBNUC5kYXRlTGFzdEV2ZW50U2VudCA/IE1QLmRhdGVMYXN0RXZlbnRTZW50LmdldFRpbWUoKSA6IG51bGw7XG4gICAgZGF0YS5ncy5hdiA9IE1QLmFwcFZlcnNpb247XG4gICAgZGF0YS5ncy5jZ2lkID0gTVAuY2xpZW50SWQ7XG4gICAgZGF0YS5ncy5kYXMgPSBNUC5kZXZpY2VJZDtcbiAgICBkYXRhLmdzLmMgPSBNUC5jb250ZXh0O1xuICAgIGRhdGEuZ3Muc3NkID0gTVAuc2Vzc2lvblN0YXJ0RGF0ZSA/IE1QLnNlc3Npb25TdGFydERhdGUuZ2V0VGltZSgpIDogbnVsbDtcbiAgICBkYXRhLmdzLmlhID0gTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzO1xuXG4gICAgcmV0dXJuIGRhdGE7XG59XG5cbmZ1bmN0aW9uIGdldExvY2FsU3RvcmFnZSgpIHtcbiAgICBpZiAoIU1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBrZXkgPSBNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZVY0LFxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gZGVjb2RlQ29va2llcyh3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSksXG4gICAgICAgIG9iaiA9IHt9LFxuICAgICAgICBqO1xuICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZURhdGEpO1xuICAgICAgICBmb3IgKGogaW4gbG9jYWxTdG9yYWdlRGF0YSkge1xuICAgICAgICAgICAgaWYgKGxvY2FsU3RvcmFnZURhdGEuaGFzT3duUHJvcGVydHkoaikpIHtcbiAgICAgICAgICAgICAgICBvYmpbal0gPSBsb2NhbFN0b3JhZ2VEYXRhW2pdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKG9iaikubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUxvY2FsU3RvcmFnZShsb2NhbFN0b3JhZ2VOYW1lKSB7XG4gICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0obG9jYWxTdG9yYWdlTmFtZSk7XG59XG5cbmZ1bmN0aW9uIHJldHJpZXZlRGV2aWNlSWQoKSB7XG4gICAgaWYgKE1QLmRldmljZUlkKSB7XG4gICAgICAgIHJldHVybiBNUC5kZXZpY2VJZDtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdGhpcy5wYXJzZURldmljZUlkKE1QLnNlcnZlclNldHRpbmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRGV2aWNlSWQoc2VydmVyU2V0dGluZ3MpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgcGFyYW1zT2JqID0ge30sXG4gICAgICAgICAgICBwYXJ0cztcblxuICAgICAgICBpZiAoc2VydmVyU2V0dGluZ3MgJiYgc2VydmVyU2V0dGluZ3MudWlkICYmIHNlcnZlclNldHRpbmdzLnVpZC5WYWx1ZSkge1xuICAgICAgICAgICAgc2VydmVyU2V0dGluZ3MudWlkLlZhbHVlLnNwbGl0KCcmJykuZm9yRWFjaChmdW5jdGlvbihwYXJhbSkge1xuICAgICAgICAgICAgICAgIHBhcnRzID0gcGFyYW0uc3BsaXQoJz0nKTtcbiAgICAgICAgICAgICAgICBwYXJhbXNPYmpbcGFydHNbMF1dID0gcGFydHNbMV07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKHBhcmFtc09ialsnZyddKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcmFtc09ialsnZyddO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICByZXR1cm4gSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBleHBpcmVDb29raWVzKGNvb2tpZU5hbWUpIHtcbiAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKCksXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICAgIGRvbWFpbixcbiAgICAgICAgY29va2llRG9tYWluO1xuXG4gICAgY29va2llRG9tYWluID0gZ2V0Q29va2llRG9tYWluKCk7XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIGRhdGUuc2V0VGltZShkYXRlLmdldFRpbWUoKSAtICgyNCAqIDYwICogNjAgKiAxMDAwKSk7XG4gICAgZXhwaXJlcyA9ICc7IGV4cGlyZXM9JyArIGRhdGUudG9VVENTdHJpbmcoKTtcbiAgICBkb2N1bWVudC5jb29raWUgPSBjb29raWVOYW1lICsgJz0nICsgJycgKyBleHBpcmVzICsgJzsgcGF0aD0vJyArIGRvbWFpbjtcbn1cblxuZnVuY3Rpb24gZ2V0Q29va2llKCkge1xuICAgIHZhciBjb29raWVzID0gd2luZG93LmRvY3VtZW50LmNvb2tpZS5zcGxpdCgnOyAnKSxcbiAgICAgICAga2V5ID0gTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCxcbiAgICAgICAgaSxcbiAgICAgICAgbCxcbiAgICAgICAgcGFydHMsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvb2tpZSxcbiAgICAgICAgcmVzdWx0ID0ga2V5ID8gdW5kZWZpbmVkIDoge307XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llU2VhcmNoKTtcblxuICAgIGZvciAoaSA9IDAsIGwgPSBjb29raWVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcbiAgICAgICAgbmFtZSA9IEhlbHBlcnMuZGVjb2RlZChwYXJ0cy5zaGlmdCgpKTtcbiAgICAgICAgY29va2llID0gSGVscGVycy5kZWNvZGVkKHBhcnRzLmpvaW4oJz0nKSk7XG5cbiAgICAgICAgaWYgKGtleSAmJiBrZXkgPT09IG5hbWUpIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IEhlbHBlcnMuY29udmVydGVkKGNvb2tpZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICgha2V5KSB7XG4gICAgICAgICAgICByZXN1bHRbbmFtZV0gPSBIZWxwZXJzLmNvbnZlcnRlZChjb29raWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llRm91bmQpO1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShkZWNvZGVDb29raWVzKHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0Q29va2llKCkge1xuICAgIHZhciBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAga2V5ID0gTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCxcbiAgICAgICAgY3VycmVudE1QSUREYXRhID0gdGhpcy5jb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llcygpLFxuICAgICAgICBleHBpcmVzID0gbmV3IERhdGUoZGF0ZS5nZXRUaW1lKCkgK1xuICAgICAgICAgICAgKE1QLkNvbmZpZy5Db29raWVFeHBpcmF0aW9uICogMjQgKiA2MCAqIDYwICogMTAwMCkpLnRvR01UU3RyaW5nKCksXG4gICAgICAgIGNvb2tpZURvbWFpbixcbiAgICAgICAgZG9tYWluLFxuICAgICAgICBjb29raWVzID0gdGhpcy5nZXRDb29raWUoKSB8fCB7fSxcbiAgICAgICAgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG5cbiAgICBjb29raWVEb21haW4gPSBnZXRDb29raWVEb21haW4oKTtcblxuICAgIGlmIChjb29raWVEb21haW4gPT09ICcnKSB7XG4gICAgICAgIGRvbWFpbiA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGRvbWFpbiA9ICc7ZG9tYWluPScgKyBjb29raWVEb21haW47XG4gICAgfVxuXG4gICAgY29va2llcy5ncyA9IGNvb2tpZXMuZ3MgfHwge307XG5cbiAgICBpZiAoTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgIGNvb2tpZXMuZ3MuY3NtID0gTVAuY3VycmVudFNlc3Npb25NUElEcztcbiAgICB9XG5cbiAgICBpZiAoTVAubXBpZCkge1xuICAgICAgICBjb29raWVzW01QLm1waWRdID0gY3VycmVudE1QSUREYXRhO1xuICAgICAgICBjb29raWVzLmN1ID0gTVAubXBpZDtcbiAgICB9XG5cbiAgICBjb29raWVzLmwgPSBNUC5pc0xvZ2dlZEluID8gMSA6IDA7XG5cbiAgICBjb29raWVzID0gdGhpcy5zZXRHbG9iYWxTdG9yYWdlQXR0cmlidXRlcyhjb29raWVzKTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhNUC5ub25DdXJyZW50VXNlck1QSURzKS5sZW5ndGgpIHtcbiAgICAgICAgY29va2llcyA9IEhlbHBlcnMuZXh0ZW5kKHt9LCBjb29raWVzLCBNUC5ub25DdXJyZW50VXNlck1QSURzKTtcbiAgICAgICAgTVAubm9uQ3VycmVudFVzZXJNUElEcyA9IHt9O1xuICAgIH1cblxuICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gcmVkdWNlQW5kRW5jb2RlQ29va2llcyhjb29raWVzLCBleHBpcmVzLCBkb21haW4pO1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVNldCk7XG5cbiAgICB3aW5kb3cuZG9jdW1lbnQuY29va2llID1cbiAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgKyAnPScgKyBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aDtcbn1cblxuLyogIFRoaXMgZnVuY3Rpb24gZGV0ZXJtaW5lcyBpZiBhIGNvb2tpZSBpcyBncmVhdGVyIHRoYW4gdGhlIGNvbmZpZ3VyZWQgbWF4Q29va2llU2l6ZS5cbiAgICAgICAgLSBJZiBpdCBpcywgd2UgcmVtb3ZlIGFuIE1QSUQgYW5kIGl0cyBhc3NvY2lhdGVkIFVJL1VBL0NTRCBmcm9tIHRoZSBjb29raWUuXG4gICAgICAgIC0gT25jZSByZW1vdmVkLCBjaGVjayBzaXplLCBhbmQgcmVwZWF0LlxuICAgICAgICAtIE5ldmVyIHJlbW92ZSB0aGUgY3VycmVudFVzZXIncyBNUElEIGZyb20gdGhlIGNvb2tpZS5cblxuICAgIE1QSUQgcmVtb3ZhbCBwcmlvcml0eTpcbiAgICAxLiBJZiB0aGVyZSBhcmUgbm8gY3VycmVudFNlc3Npb25NUElEcywgcmVtb3ZlIGEgcmFuZG9tIE1QSUQgZnJvbSB0aGUgdGhlIGNvb2tpZS5cbiAgICAyLiBJZiB0aGVyZSBhcmUgY3VycmVudFNlc3Npb25NUElEczpcbiAgICAgICAgYS4gUmVtb3ZlIGF0IHJhbmRvbSBNUElEcyBvbiB0aGUgY29va2llIHRoYXQgYXJlIG5vdCBwYXJ0IG9mIHRoZSBjdXJyZW50U2Vzc2lvbk1QSURzXG4gICAgICAgIGIuIFRoZW4gcmVtb3ZlIE1QSURzIGJhc2VkIG9uIG9yZGVyIGluIGN1cnJlbnRTZXNzaW9uTVBJRHMgYXJyYXksIHdoaWNoXG4gICAgICAgIHN0b3JlcyBNUElEcyBiYXNlZCBvbiBlYXJsaWVzdCBsb2dpbi5cbiovXG5mdW5jdGlvbiByZWR1Y2VBbmRFbmNvZGVDb29raWVzKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbikge1xuICAgIHZhciBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aCxcbiAgICAgICAgY3VycmVudFNlc3Npb25NUElEcyA9IGNvb2tpZXMuZ3MuY3NtID8gY29va2llcy5ncy5jc20gOiBbXTtcbiAgICAvLyBDb21tZW50IDEgYWJvdmVcbiAgICBpZiAoIWN1cnJlbnRTZXNzaW9uTVBJRHMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBjb29raWVzKSB7XG4gICAgICAgICAgICBpZiAoY29va2llcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGggPSBjcmVhdGVGdWxsRW5jb2RlZENvb2tpZShjb29raWVzLCBleHBpcmVzLCBkb21haW4pO1xuICAgICAgICAgICAgICAgIGlmIChlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aC5sZW5ndGggPiBtUGFydGljbGUubWF4Q29va2llU2l6ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNba2V5XSAmJiBrZXkgIT09IGNvb2tpZXMuY3UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDb21tZW50IDIgYWJvdmUgLSBGaXJzdCBjcmVhdGUgYW4gb2JqZWN0IG9mIGFsbCBNUElEcyBvbiB0aGUgY29va2llXG4gICAgICAgIHZhciBNUElEc09uQ29va2llID0ge307XG4gICAgICAgIGZvciAodmFyIHBvdGVudGlhbE1QSUQgaW4gY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuaGFzT3duUHJvcGVydHkocG90ZW50aWFsTVBJRCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbcG90ZW50aWFsTVBJRF0gJiYgcG90ZW50aWFsTVBJRCAhPT1jb29raWVzLmN1KSB7XG4gICAgICAgICAgICAgICAgICAgIE1QSURzT25Db29raWVbcG90ZW50aWFsTVBJRF0gPSAxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBDb21tZW50IDJhIGFib3ZlXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhNUElEc09uQ29va2llKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAodmFyIG1waWQgaW4gTVBJRHNPbkNvb2tpZSkge1xuICAgICAgICAgICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gY3JlYXRlRnVsbEVuY29kZWRDb29raWUoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcbiAgICAgICAgICAgICAgICBpZiAoZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGgubGVuZ3RoID4gbVBhcnRpY2xlLm1heENvb2tpZVNpemUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QSURzT25Db29raWUuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50U2Vzc2lvbk1QSURzLmluZGV4T2YobXBpZCkgPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZXNbbXBpZF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ29tbWVudCAyYiBhYm92ZVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGN1cnJlbnRTZXNzaW9uTVBJRHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gY3JlYXRlRnVsbEVuY29kZWRDb29raWUoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcbiAgICAgICAgICAgIGlmIChlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aC5sZW5ndGggPiBtUGFydGljbGUubWF4Q29va2llU2l6ZSkge1xuICAgICAgICAgICAgICAgIHZhciBNUElEdG9SZW1vdmUgPSBjdXJyZW50U2Vzc2lvbk1QSURzW2ldO1xuICAgICAgICAgICAgICAgIGlmIChjb29raWVzW01QSUR0b1JlbW92ZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnU2l6ZSBvZiBuZXcgZW5jb2RlZCBjb29raWUgaXMgbGFyZ2VyIHRoYW4gbWF4Q29va2llU2l6ZSBzZXR0aW5nIG9mICcgKyBtUGFydGljbGUubWF4Q29va2llU2l6ZSArICcuIFJlbW92aW5nIGZyb20gY29va2llIHRoZSBlYXJsaWVzdCBsb2dnZWQgaW4gTVBJRCBjb250YWluaW5nOiAnICsgSlNPTi5zdHJpbmdpZnkoY29va2llc1tNUElEdG9SZW1vdmVdLCAwLCAyKSk7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWVzW01QSUR0b1JlbW92ZV07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVW5hYmxlIHRvIHNhdmUgTVBJRCBkYXRhIHRvIGNvb2tpZXMgYmVjYXVzZSB0aGUgcmVzdWx0aW5nIGVuY29kZWQgY29va2llIGlzIGxhcmdlciB0aGFuIHRoZSBtYXhDb29raWVTaXplIHNldHRpbmcgb2YgJyArIG1QYXJ0aWNsZS5tYXhDb29raWVTaXplICsgJy4gV2UgcmVjb21tZW5kIHVzaW5nIGEgbWF4Q29va2llU2l6ZSBvZiAxNTAwLicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUZ1bGxFbmNvZGVkQ29va2llKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbikge1xuICAgIHJldHVybiBlbmNvZGVDb29raWVzKEpTT04uc3RyaW5naWZ5KGNvb2tpZXMpKSArICc7ZXhwaXJlcz0nICsgZXhwaXJlcyArJztwYXRoPS8nICsgZG9tYWluO1xufVxuXG5mdW5jdGlvbiBmaW5kUHJldkNvb2tpZXNCYXNlZE9uVUkoaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgdmFyIGNvb2tpZXMgPSB0aGlzLmdldENvb2tpZSgpIHx8IHRoaXMuZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgdmFyIG1hdGNoZWRVc2VyO1xuXG4gICAgaWYgKGlkZW50aXR5QXBpRGF0YSkge1xuICAgICAgICBmb3IgKHZhciByZXF1ZXN0ZWRJZGVudGl0eVR5cGUgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoY29va2llcyAmJiBPYmplY3Qua2V5cyhjb29raWVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llcykge1xuICAgICAgICAgICAgICAgICAgICAvLyBhbnkgdmFsdWUgaW4gY29va2llcyB0aGF0IGhhcyBhbiBNUElEIGtleSB3aWxsIGJlIGFuIE1QSUQgdG8gc2VhcmNoIHRocm91Z2hcbiAgICAgICAgICAgICAgICAgICAgLy8gb3RoZXIga2V5cyBvbiB0aGUgY29va2llIGFyZSBjdXJyZW50U2Vzc2lvbk1QSURzIGFuZCBjdXJyZW50TVBJRCB3aGljaCBzaG91bGQgbm90IGJlIHNlYXJjaGVkXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVzW2tleV0ubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGNvb2tpZVVJcyA9IGNvb2tpZXNba2V5XS51aTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGNvb2tpZVVJVHlwZSBpbiBjb29raWVVSXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdGVkSWRlbnRpdHlUeXBlID09PSBjb29raWVVSVR5cGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzW3JlcXVlc3RlZElkZW50aXR5VHlwZV0gPT09IGNvb2tpZVVJc1tjb29raWVVSVR5cGVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZWRVc2VyID0ga2V5O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobWF0Y2hlZFVzZXIpIHtcbiAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtYXRjaGVkVXNlcik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbmNvZGVDb29raWVzKGNvb2tpZSkge1xuICAgIGNvb2tpZSA9IEpTT04ucGFyc2UoY29va2llKTtcbiAgICBmb3IgKHZhciBrZXkgaW4gY29va2llLmdzKSB7XG4gICAgICAgIGlmIChjb29raWUuZ3MuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgLy8gYmFzZTY0IGVuY29kZSBhbnkgdmFsdWUgdGhhdCBpcyBhbiBvYmplY3Qgb3IgQXJyYXkgaW4gZ2xvYmFsU2V0dGluZ3MgZmlyc3RcbiAgICAgICAgICAgIGlmIChCYXNlNjRDb29raWVLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICBpZiAoY29va2llLmdzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29va2llLmdzW2tleV0pICYmIGNvb2tpZS5nc1trZXldLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llLmdzW2tleV0gPSBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGNvb2tpZS5nc1trZXldKSk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoSGVscGVycy5pc09iamVjdChjb29raWUuZ3Nba2V5XSkgJiYgT2JqZWN0LmtleXMoY29va2llLmdzW2tleV0pLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llLmdzW2tleV0gPSBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGNvb2tpZS5nc1trZXldKSk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29va2llLmdzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29va2llLmdzW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09ICdpZScpIHtcbiAgICAgICAgICAgICAgICBjb29raWUuZ3Nba2V5XSA9IGNvb2tpZS5nc1trZXldID8gMSA6IDA7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCFjb29raWUuZ3Nba2V5XSkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWUuZ3Nba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZvciAodmFyIG1waWQgaW4gY29va2llKSB7XG4gICAgICAgIGlmIChjb29raWUuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgIGlmICghU0RLdjJOb25NUElEQ29va2llS2V5c1ttcGlkXSkge1xuICAgICAgICAgICAgICAgIGZvciAoa2V5IGluIGNvb2tpZVttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llW21waWRdLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChCYXNlNjRDb29raWVLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5pc09iamVjdChjb29raWVbbXBpZF1ba2V5XSkgJiYgT2JqZWN0LmtleXMoY29va2llW21waWRdW2tleV0pLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVbbXBpZF1ba2V5XSA9IEJhc2U2NC5lbmNvZGUoSlNPTi5zdHJpbmdpZnkoY29va2llW21waWRdW2tleV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29va2llW21waWRdW2tleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNyZWF0ZUNvb2tpZVN0cmluZyhKU09OLnN0cmluZ2lmeShjb29raWUpKTtcbn1cblxuZnVuY3Rpb24gZGVjb2RlQ29va2llcyhjb29raWUpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoY29va2llKSB7XG4gICAgICAgICAgICBjb29raWUgPSBKU09OLnBhcnNlKHJldmVydENvb2tpZVN0cmluZyhjb29raWUpKTtcbiAgICAgICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KGNvb2tpZSkgJiYgT2JqZWN0LmtleXMoY29va2llKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llLmdzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb29raWUuZ3MuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEJhc2U2NENvb2tpZUtleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGNvb2tpZS5nc1trZXldKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGtleSA9PT0gJ2llJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gQm9vbGVhbihjb29raWUuZ3Nba2V5XSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtcGlkIGluIGNvb2tpZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llLmhhc093blByb3BlcnR5KG1waWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGtleSBpbiBjb29raWVbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZVttcGlkXS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoQmFzZTY0Q29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZVttcGlkXVtrZXldLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVbbXBpZF1ba2V5XSA9IEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZShjb29raWVbbXBpZF1ba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobXBpZCA9PT0gJ2wnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdID0gQm9vbGVhbihjb29raWVbbXBpZF0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoY29va2llKTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUHJvYmxlbSB3aXRoIGRlY29kaW5nIGNvb2tpZScsIGUpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVwbGFjZUNvbW1hc1dpdGhQaXBlcyhzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoLywvZywgJ3wnKTtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZVBpcGVzV2l0aENvbW1hcyhzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1xcfC9nLCAnLCcpO1xufVxuXG5mdW5jdGlvbiByZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzKHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvXFwnL2csICdcIicpO1xufVxuXG5mdW5jdGlvbiByZXBsYWNlUXVvdGVzV2l0aEFwb3N0cm9waGVzKHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvXFxcIi9nLCAnXFwnJyk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvb2tpZVN0cmluZyhzdHJpbmcpIHtcbiAgICByZXR1cm4gcmVwbGFjZUNvbW1hc1dpdGhQaXBlcyhyZXBsYWNlUXVvdGVzV2l0aEFwb3N0cm9waGVzKHN0cmluZykpO1xufVxuXG5mdW5jdGlvbiByZXZlcnRDb29raWVTdHJpbmcoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHJlcGxhY2VQaXBlc1dpdGhDb21tYXMocmVwbGFjZUFwb3N0cm9waGVzV2l0aFF1b3RlcyhzdHJpbmcpKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q29va2llRG9tYWluKCkge1xuICAgIGlmIChNUC5Db25maWcuQ29va2llRG9tYWluKSB7XG4gICAgICAgIHJldHVybiBNUC5Db25maWcuQ29va2llRG9tYWluO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciByb290RG9tYWluID0gZ2V0RG9tYWluKGRvY3VtZW50LCBsb2NhdGlvbi5ob3N0bmFtZSk7XG4gICAgICAgIGlmIChyb290RG9tYWluID09PSAnJykge1xuICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuICcuJyArIHJvb3REb21haW47XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8vIFRoaXMgZnVuY3Rpb24gbG9vcHMgdGhyb3VnaCB0aGUgcGFydHMgb2YgYSBmdWxsIGhvc3RuYW1lLCBhdHRlbXB0aW5nIHRvIHNldCBhIGNvb2tpZSBvbiB0aGF0IGRvbWFpbi4gSXQgd2lsbCBzZXQgYSBjb29raWUgYXQgdGhlIGhpZ2hlc3QgbGV2ZWwgcG9zc2libGUuXG4vLyBGb3IgZXhhbXBsZSBzdWJkb21haW4uZG9tYWluLmNvLnVrIHdvdWxkIHRyeSB0aGUgZm9sbG93aW5nIGNvbWJpbmF0aW9uczpcbi8vIFwiY28udWtcIiAtPiBmYWlsXG4vLyBcImRvbWFpbi5jby51a1wiIC0+IHN1Y2Nlc3MsIHJldHVyblxuLy8gXCJzdWJkb21haW4uZG9tYWluLmNvLnVrXCIgLT4gc2tpcHBlZCwgYmVjYXVzZSBhbHJlYWR5IGZvdW5kXG5mdW5jdGlvbiBnZXREb21haW4oZG9jLCBsb2NhdGlvbkhvc3RuYW1lKSB7XG4gICAgdmFyIGksXG4gICAgICAgIHRlc3RQYXJ0cyxcbiAgICAgICAgbXBUZXN0ID0gJ21wdGVzdD1jb29raWUnLFxuICAgICAgICBob3N0bmFtZSA9IGxvY2F0aW9uSG9zdG5hbWUuc3BsaXQoJy4nKTtcbiAgICBmb3IgKGkgPSBob3N0bmFtZS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICB0ZXN0UGFydHMgPSBob3N0bmFtZS5zbGljZShpKS5qb2luKCcuJyk7XG4gICAgICAgIGRvYy5jb29raWUgPSBtcFRlc3QgKyAnO2RvbWFpbj0uJyArIHRlc3RQYXJ0cyArICc7JztcbiAgICAgICAgaWYgKGRvYy5jb29raWUuaW5kZXhPZihtcFRlc3QpID4gLTEpe1xuICAgICAgICAgICAgZG9jLmNvb2tpZSA9IG1wVGVzdC5zcGxpdCgnPScpWzBdICsgJz07ZG9tYWluPS4nICsgdGVzdFBhcnRzICsgJztleHBpcmVzPVRodSwgMDEgSmFuIDE5NzAgMDA6MDA6MDEgR01UOyc7XG4gICAgICAgICAgICByZXR1cm4gdGVzdFBhcnRzO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiAnJztcbn1cblxuZnVuY3Rpb24gZGVjb2RlUHJvZHVjdHMoKSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShDb25zdGFudHMuRGVmYXVsdENvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KSkpO1xufVxuXG5mdW5jdGlvbiBnZXRVc2VySWRlbnRpdGllcyhtcGlkKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgcmV0dXJuIE1QLnVzZXJJZGVudGl0aWVzO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvb2tpZXMgPSBnZXRQZXJzaXN0ZW5jZSgpO1xuXG4gICAgICAgIGlmIChjb29raWVzICYmIGNvb2tpZXNbbXBpZF0gJiYgY29va2llc1ttcGlkXS51aSkge1xuICAgICAgICAgICAgcmV0dXJuIGNvb2tpZXNbbXBpZF0udWk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4ge307XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEFsbFVzZXJBdHRyaWJ1dGVzKG1waWQpIHtcbiAgICB2YXIgY29va2llcztcbiAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICByZXR1cm4gTVAudXNlckF0dHJpYnV0ZXM7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29va2llcyA9IGdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSAmJiBjb29raWVzW21waWRdLnVhKSB7XG4gICAgICAgICAgICByZXR1cm4gY29va2llc1ttcGlkXS51YTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0Q2FydFByb2R1Y3RzKG1waWQpIHtcbiAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICByZXR1cm4gTVAuY2FydFByb2R1Y3RzO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBhbGxDYXJ0UHJvZHVjdHMgPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUobG9jYWxTdG9yYWdlLmdldEl0ZW0oTVAuQ29uZmlnLkxvY2FsU3RvcmFnZVByb2R1Y3RzVjQpKSk7XG4gICAgICAgIGlmIChhbGxDYXJ0UHJvZHVjdHMgJiYgYWxsQ2FydFByb2R1Y3RzW21waWRdICYmIGFsbENhcnRQcm9kdWN0c1ttcGlkXS5jcCkge1xuICAgICAgICAgICAgcmV0dXJuIGFsbENhcnRQcm9kdWN0c1ttcGlkXS5jcDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0Q2FydFByb2R1Y3RzKGFsbFByb2R1Y3RzKSB7XG4gICAgaWYgKCFNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChNUC5Db25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCksIEJhc2U2NC5lbmNvZGUoSlNPTi5zdHJpbmdpZnkoYWxsUHJvZHVjdHMpKSk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHdpdGggc2V0dGluZyBwcm9kdWN0cyBvbiBsb2NhbFN0b3JhZ2UuJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiB1cGRhdGVPbmx5Q29va2llVXNlckF0dHJpYnV0ZXMoY29va2llcykge1xuICAgIHZhciBlbmNvZGVkQ29va2llcyA9IGVuY29kZUNvb2tpZXMoSlNPTi5zdHJpbmdpZnkoY29va2llcykpLFxuICAgICAgICBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAga2V5ID0gTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCxcbiAgICAgICAgZXhwaXJlcyA9IG5ldyBEYXRlKGRhdGUuZ2V0VGltZSgpICtcbiAgICAgICAgKE1QLkNvbmZpZy5Db29raWVFeHBpcmF0aW9uICogMjQgKiA2MCAqIDYwICogMTAwMCkpLnRvR01UU3RyaW5nKCksXG4gICAgICAgIGNvb2tpZURvbWFpbiA9IGdldENvb2tpZURvbWFpbigpLFxuICAgICAgICBkb21haW47XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICB2YXIgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGggPSByZWR1Y2VBbmRFbmNvZGVDb29raWVzKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbik7XG4gICAgICAgIHdpbmRvdy5kb2N1bWVudC5jb29raWUgPVxuICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgKyAnPScgKyBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aDtcbiAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQsIGVuY29kZWRDb29raWVzKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0UGVyc2lzdGVuY2UoKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1QYXJ0aWNsZS51c2VDb29raWVTdG9yYWdlKSB7XG4gICAgICAgIGNvb2tpZXMgPSBnZXRDb29raWUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb29raWVzID0gZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvb2tpZXM7XG59XG5cbmZ1bmN0aW9uIGdldENvbnNlbnRTdGF0ZShtcGlkKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgcmV0dXJuIE1QLmNvbnNlbnRTdGF0ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb29raWVzID0gZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdICYmIGNvb2tpZXNbbXBpZF0uY29uKSB7XG4gICAgICAgICAgICByZXR1cm4gQ29uc2VudC5TZXJpYWxpemF0aW9uLmZyb21NaW5pZmllZEpzb25PYmplY3QoY29va2llc1ttcGlkXS5jb24pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldENvbnNlbnRTdGF0ZShtcGlkLCBjb25zZW50U3RhdGUpIHtcbiAgICAvL2l0J3MgY3VycmVudGx5IG5vdCBzdXBwb3J0ZWQgdG8gc2V0IHBlcnNpc3RlbmNlXG4gICAgLy9mb3IgYW55IE1QSUQgdGhhdCdzIG5vdCB0aGUgY3VycmVudCBvbmUuXG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgTVAuY29uc2VudFN0YXRlID0gY29uc2VudFN0YXRlO1xuICAgIH1cbiAgICB0aGlzLnVwZGF0ZSgpO1xufVxuXG5mdW5jdGlvbiBnZXREZXZpY2VJZCgpIHtcbiAgICByZXR1cm4gTVAuZGV2aWNlSWQ7XG59XG5cbmZ1bmN0aW9uIHJlc2V0UGVyc2lzdGVuY2UoKXtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWUpO1xuICAgIHJlbW92ZUxvY2FsU3RvcmFnZShNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZVYzKTtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWNCk7XG4gICAgcmVtb3ZlTG9jYWxTdG9yYWdlKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KTtcblxuICAgIGV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWUpO1xuICAgIGV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWVWMik7XG4gICAgZXhwaXJlQ29va2llcyhNUC5Db25maWcuQ29va2llTmFtZVYzKTtcbiAgICBleHBpcmVDb29raWVzKE1QLkNvbmZpZy5Db29raWVOYW1lVjQpO1xufVxuXG4vLyBGb3J3YXJkZXIgQmF0Y2hpbmcgQ29kZVxudmFyIGZvcndhcmRpbmdTdGF0c0JhdGNoZXMgPSB7XG4gICAgdXBsb2Fkc1RhYmxlOiB7fSxcbiAgICBmb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlOiBbXVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgdXNlTG9jYWxTdG9yYWdlOiB1c2VMb2NhbFN0b3JhZ2UsXG4gICAgaW5pdGlhbGl6ZVN0b3JhZ2U6IGluaXRpYWxpemVTdG9yYWdlLFxuICAgIHVwZGF0ZTogdXBkYXRlLFxuICAgIGRldGVybWluZUxvY2FsU3RvcmFnZUF2YWlsYWJpbGl0eTogZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5LFxuICAgIGNvbnZlcnRJbk1lbW9yeURhdGFGb3JDb29raWVzOiBjb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llcyxcbiAgICBjb252ZXJ0UHJvZHVjdHNGb3JMb2NhbFN0b3JhZ2U6IGNvbnZlcnRQcm9kdWN0c0ZvckxvY2FsU3RvcmFnZSxcbiAgICBnZXRVc2VyUHJvZHVjdHNGcm9tTFM6IGdldFVzZXJQcm9kdWN0c0Zyb21MUyxcbiAgICBnZXRBbGxVc2VyUHJvZHVjdHNGcm9tTFM6IGdldEFsbFVzZXJQcm9kdWN0c0Zyb21MUyxcbiAgICBzdG9yZVByb2R1Y3RzSW5NZW1vcnk6IHN0b3JlUHJvZHVjdHNJbk1lbW9yeSxcbiAgICBzZXRMb2NhbFN0b3JhZ2U6IHNldExvY2FsU3RvcmFnZSxcbiAgICBzZXRHbG9iYWxTdG9yYWdlQXR0cmlidXRlczogc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXMsXG4gICAgZ2V0TG9jYWxTdG9yYWdlOiBnZXRMb2NhbFN0b3JhZ2UsXG4gICAgc3RvcmVEYXRhSW5NZW1vcnk6IHN0b3JlRGF0YUluTWVtb3J5LFxuICAgIHJldHJpZXZlRGV2aWNlSWQ6IHJldHJpZXZlRGV2aWNlSWQsXG4gICAgcGFyc2VEZXZpY2VJZDogcGFyc2VEZXZpY2VJZCxcbiAgICBleHBpcmVDb29raWVzOiBleHBpcmVDb29raWVzLFxuICAgIGdldENvb2tpZTogZ2V0Q29va2llLFxuICAgIHNldENvb2tpZTogc2V0Q29va2llLFxuICAgIHJlZHVjZUFuZEVuY29kZUNvb2tpZXM6IHJlZHVjZUFuZEVuY29kZUNvb2tpZXMsXG4gICAgZmluZFByZXZDb29raWVzQmFzZWRPblVJOiBmaW5kUHJldkNvb2tpZXNCYXNlZE9uVUksXG4gICAgcmVwbGFjZUNvbW1hc1dpdGhQaXBlczogcmVwbGFjZUNvbW1hc1dpdGhQaXBlcyxcbiAgICByZXBsYWNlUGlwZXNXaXRoQ29tbWFzOiByZXBsYWNlUGlwZXNXaXRoQ29tbWFzLFxuICAgIHJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXM6IHJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXMsXG4gICAgcmVwbGFjZVF1b3Rlc1dpdGhBcG9zdHJvcGhlczogcmVwbGFjZVF1b3Rlc1dpdGhBcG9zdHJvcGhlcyxcbiAgICBjcmVhdGVDb29raWVTdHJpbmc6IGNyZWF0ZUNvb2tpZVN0cmluZyxcbiAgICByZXZlcnRDb29raWVTdHJpbmc6IHJldmVydENvb2tpZVN0cmluZyxcbiAgICBlbmNvZGVDb29raWVzOiBlbmNvZGVDb29raWVzLFxuICAgIGRlY29kZUNvb2tpZXM6IGRlY29kZUNvb2tpZXMsXG4gICAgZ2V0Q29va2llRG9tYWluOiBnZXRDb29raWVEb21haW4sXG4gICAgZGVjb2RlUHJvZHVjdHM6IGRlY29kZVByb2R1Y3RzLFxuICAgIGdldFVzZXJJZGVudGl0aWVzOiBnZXRVc2VySWRlbnRpdGllcyxcbiAgICBnZXRBbGxVc2VyQXR0cmlidXRlczogZ2V0QWxsVXNlckF0dHJpYnV0ZXMsXG4gICAgZ2V0Q2FydFByb2R1Y3RzOiBnZXRDYXJ0UHJvZHVjdHMsXG4gICAgc2V0Q2FydFByb2R1Y3RzOiBzZXRDYXJ0UHJvZHVjdHMsXG4gICAgdXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzOiB1cGRhdGVPbmx5Q29va2llVXNlckF0dHJpYnV0ZXMsXG4gICAgZ2V0UGVyc2lzdGVuY2U6IGdldFBlcnNpc3RlbmNlLFxuICAgIGdldERldmljZUlkOiBnZXREZXZpY2VJZCxcbiAgICByZXNldFBlcnNpc3RlbmNlOiByZXNldFBlcnNpc3RlbmNlLFxuICAgIGdldENvbnNlbnRTdGF0ZTogZ2V0Q29uc2VudFN0YXRlLFxuICAgIHNldENvbnNlbnRTdGF0ZTogc2V0Q29uc2VudFN0YXRlLFxuICAgIGZvcndhcmRpbmdTdGF0c0JhdGNoZXM6IGZvcndhcmRpbmdTdGF0c0JhdGNoZXNcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpO1xuXG4vLyBCYXNlNjQgZW5jb2Rlci9kZWNvZGVyIC0gaHR0cDovL3d3dy53ZWJ0b29sa2l0LmluZm8vamF2YXNjcmlwdF9iYXNlNjQuaHRtbFxudmFyIEJhc2U2NCA9IHtcbiAgICBfa2V5U3RyOiAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLz0nLFxuXG4gICAgLy8gSW5wdXQgbXVzdCBiZSBhIHN0cmluZ1xuICAgIGVuY29kZTogZnVuY3Rpb24gZW5jb2RlKGlucHV0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAod2luZG93LmJ0b2EgJiYgd2luZG93LmF0b2IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gd2luZG93LmJ0b2EodW5lc2NhcGUoZW5jb2RlVVJJQ29tcG9uZW50KGlucHV0KSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBlbmNvZGluZyBjb29raWUgdmFsdWVzIGludG8gQmFzZTY0OicgKyBlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZW5jb2RlKGlucHV0KTtcbiAgICB9LFxuXG4gICAgX2VuY29kZTogZnVuY3Rpb24gX2VuY29kZShpbnB1dCkge1xuICAgICAgICB2YXIgb3V0cHV0ID0gJyc7XG4gICAgICAgIHZhciBjaHIxLCBjaHIyLCBjaHIzLCBlbmMxLCBlbmMyLCBlbmMzLCBlbmM0O1xuICAgICAgICB2YXIgaSA9IDA7XG5cbiAgICAgICAgaW5wdXQgPSBVVEY4LmVuY29kZShpbnB1dCk7XG5cbiAgICAgICAgd2hpbGUgKGkgPCBpbnB1dC5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNocjEgPSBpbnB1dC5jaGFyQ29kZUF0KGkrKyk7XG4gICAgICAgICAgICBjaHIyID0gaW5wdXQuY2hhckNvZGVBdChpKyspO1xuICAgICAgICAgICAgY2hyMyA9IGlucHV0LmNoYXJDb2RlQXQoaSsrKTtcblxuICAgICAgICAgICAgZW5jMSA9IGNocjEgPj4gMjtcbiAgICAgICAgICAgIGVuYzIgPSAoY2hyMSAmIDMpIDw8IDQgfCBjaHIyID4+IDQ7XG4gICAgICAgICAgICBlbmMzID0gKGNocjIgJiAxNSkgPDwgMiB8IGNocjMgPj4gNjtcbiAgICAgICAgICAgIGVuYzQgPSBjaHIzICYgNjM7XG5cbiAgICAgICAgICAgIGlmIChpc05hTihjaHIyKSkge1xuICAgICAgICAgICAgICAgIGVuYzMgPSBlbmM0ID0gNjQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGlzTmFOKGNocjMpKSB7XG4gICAgICAgICAgICAgICAgZW5jNCA9IDY0O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvdXRwdXQgPSBvdXRwdXQgKyBCYXNlNjQuX2tleVN0ci5jaGFyQXQoZW5jMSkgKyBCYXNlNjQuX2tleVN0ci5jaGFyQXQoZW5jMikgKyBCYXNlNjQuX2tleVN0ci5jaGFyQXQoZW5jMykgKyBCYXNlNjQuX2tleVN0ci5jaGFyQXQoZW5jNCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG91dHB1dDtcbiAgICB9LFxuXG4gICAgZGVjb2RlOiBmdW5jdGlvbiBkZWNvZGUoaW5wdXQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh3aW5kb3cuYnRvYSAmJiB3aW5kb3cuYXRvYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoZXNjYXBlKHdpbmRvdy5hdG9iKGlucHV0KSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAvL2xvZyhlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gQmFzZTY0Ll9kZWNvZGUoaW5wdXQpO1xuICAgIH0sXG5cbiAgICBfZGVjb2RlOiBmdW5jdGlvbiBfZGVjb2RlKGlucHV0KSB7XG4gICAgICAgIHZhciBvdXRwdXQgPSAnJztcbiAgICAgICAgdmFyIGNocjEsIGNocjIsIGNocjM7XG4gICAgICAgIHZhciBlbmMxLCBlbmMyLCBlbmMzLCBlbmM0O1xuICAgICAgICB2YXIgaSA9IDA7XG5cbiAgICAgICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKC9bXkEtWmEtejAtOVxcK1xcL1xcPV0vZywgJycpO1xuXG4gICAgICAgIHdoaWxlIChpIDwgaW5wdXQubGVuZ3RoKSB7XG4gICAgICAgICAgICBlbmMxID0gQmFzZTY0Ll9rZXlTdHIuaW5kZXhPZihpbnB1dC5jaGFyQXQoaSsrKSk7XG4gICAgICAgICAgICBlbmMyID0gQmFzZTY0Ll9rZXlTdHIuaW5kZXhPZihpbnB1dC5jaGFyQXQoaSsrKSk7XG4gICAgICAgICAgICBlbmMzID0gQmFzZTY0Ll9rZXlTdHIuaW5kZXhPZihpbnB1dC5jaGFyQXQoaSsrKSk7XG4gICAgICAgICAgICBlbmM0ID0gQmFzZTY0Ll9rZXlTdHIuaW5kZXhPZihpbnB1dC5jaGFyQXQoaSsrKSk7XG5cbiAgICAgICAgICAgIGNocjEgPSBlbmMxIDw8IDIgfCBlbmMyID4+IDQ7XG4gICAgICAgICAgICBjaHIyID0gKGVuYzIgJiAxNSkgPDwgNCB8IGVuYzMgPj4gMjtcbiAgICAgICAgICAgIGNocjMgPSAoZW5jMyAmIDMpIDw8IDYgfCBlbmM0O1xuXG4gICAgICAgICAgICBvdXRwdXQgPSBvdXRwdXQgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGNocjEpO1xuXG4gICAgICAgICAgICBpZiAoZW5jMyAhPT0gNjQpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXQgPSBvdXRwdXQgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGNocjIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGVuYzQgIT09IDY0KSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgU3RyaW5nLmZyb21DaGFyQ29kZShjaHIzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQgPSBVVEY4LmRlY29kZShvdXRwdXQpO1xuICAgICAgICByZXR1cm4gb3V0cHV0O1xuICAgIH1cbn07XG5cbnZhciBVVEY4ID0ge1xuICAgIGVuY29kZTogZnVuY3Rpb24gZW5jb2RlKHMpIHtcbiAgICAgICAgdmFyIHV0ZnRleHQgPSAnJztcblxuICAgICAgICBmb3IgKHZhciBuID0gMDsgbiA8IHMubGVuZ3RoOyBuKyspIHtcbiAgICAgICAgICAgIHZhciBjID0gcy5jaGFyQ29kZUF0KG4pO1xuXG4gICAgICAgICAgICBpZiAoYyA8IDEyOCkge1xuICAgICAgICAgICAgICAgIHV0ZnRleHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYyA+IDEyNyAmJiBjIDwgMjA0OCkge1xuICAgICAgICAgICAgICAgIHV0ZnRleHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjID4+IDYgfCAxOTIpO1xuICAgICAgICAgICAgICAgIHV0ZnRleHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjICYgNjMgfCAxMjgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyA+PiAxMiB8IDIyNCk7XG4gICAgICAgICAgICAgICAgdXRmdGV4dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMgPj4gNiAmIDYzIHwgMTI4KTtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyAmIDYzIHwgMTI4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXRmdGV4dDtcbiAgICB9LFxuXG4gICAgZGVjb2RlOiBmdW5jdGlvbiBkZWNvZGUodXRmdGV4dCkge1xuICAgICAgICB2YXIgcyA9ICcnO1xuICAgICAgICB2YXIgaSA9IDA7XG4gICAgICAgIHZhciBjID0gMCxcbiAgICAgICAgICAgIGMxID0gMCxcbiAgICAgICAgICAgIGMyID0gMDtcblxuICAgICAgICB3aGlsZSAoaSA8IHV0ZnRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgICBjID0gdXRmdGV4dC5jaGFyQ29kZUF0KGkpO1xuICAgICAgICAgICAgaWYgKGMgPCAxMjgpIHtcbiAgICAgICAgICAgICAgICBzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyk7XG4gICAgICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjID4gMTkxICYmIGMgPCAyMjQpIHtcbiAgICAgICAgICAgICAgICBjMSA9IHV0ZnRleHQuY2hhckNvZGVBdChpICsgMSk7XG4gICAgICAgICAgICAgICAgcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKChjICYgMzEpIDw8IDYgfCBjMSAmIDYzKTtcbiAgICAgICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGMxID0gdXRmdGV4dC5jaGFyQ29kZUF0KGkgKyAxKTtcbiAgICAgICAgICAgICAgICBjMiA9IHV0ZnRleHQuY2hhckNvZGVBdChpICsgMik7XG4gICAgICAgICAgICAgICAgcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKChjICYgMTUpIDw8IDEyIHwgKGMxICYgNjMpIDw8IDYgfCBjMiAmIDYzKTtcbiAgICAgICAgICAgICAgICBpICs9IDM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHM7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgLy8gZm9yRWFjaCBwb2x5ZmlsbFxuICAgIC8vIFByb2R1Y3Rpb24gc3RlcHMgb2YgRUNNQS0yNjIsIEVkaXRpb24gNSwgMTUuNC40LjE4XG4gICAgLy8gUmVmZXJlbmNlOiBodHRwOi8vZXM1LmdpdGh1Yi5pby8jeDE1LjQuNC4xOFxuICAgIGZvckVhY2g6IGZ1bmN0aW9uKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgICAgIHZhciBULCBrO1xuXG4gICAgICAgIGlmICh0aGlzID09IG51bGwpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJyB0aGlzIGlzIG51bGwgb3Igbm90IGRlZmluZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBPID0gT2JqZWN0KHRoaXMpO1xuICAgICAgICB2YXIgbGVuID0gTy5sZW5ndGggPj4+IDA7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihjYWxsYmFjayArICcgaXMgbm90IGEgZnVuY3Rpb24nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgVCA9IHRoaXNBcmc7XG4gICAgICAgIH1cblxuICAgICAgICBrID0gMDtcblxuICAgICAgICB3aGlsZSAoayA8IGxlbikge1xuICAgICAgICAgICAgdmFyIGtWYWx1ZTtcbiAgICAgICAgICAgIGlmIChrIGluIE8pIHtcbiAgICAgICAgICAgICAgICBrVmFsdWUgPSBPW2tdO1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrLmNhbGwoVCwga1ZhbHVlLCBrLCBPKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGsrKztcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvLyBtYXAgcG9seWZpbGxcbiAgICAvLyBQcm9kdWN0aW9uIHN0ZXBzIG9mIEVDTUEtMjYyLCBFZGl0aW9uIDUsIDE1LjQuNC4xOVxuICAgIC8vIFJlZmVyZW5jZTogaHR0cDovL2VzNS5naXRodWIuaW8vI3gxNS40LjQuMTlcbiAgICBtYXA6IGZ1bmN0aW9uKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgICAgIHZhciBULCBBLCBrO1xuXG4gICAgICAgIGlmICh0aGlzID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCcgdGhpcyBpcyBudWxsIG9yIG5vdCBkZWZpbmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgTyA9IE9iamVjdCh0aGlzKTtcbiAgICAgICAgdmFyIGxlbiA9IE8ubGVuZ3RoID4+PiAwO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoY2FsbGJhY2sgKyAnIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIFQgPSB0aGlzQXJnO1xuICAgICAgICB9XG5cbiAgICAgICAgQSA9IG5ldyBBcnJheShsZW4pO1xuXG4gICAgICAgIGsgPSAwO1xuXG4gICAgICAgIHdoaWxlIChrIDwgbGVuKSB7XG4gICAgICAgICAgICB2YXIga1ZhbHVlLCBtYXBwZWRWYWx1ZTtcbiAgICAgICAgICAgIGlmIChrIGluIE8pIHtcbiAgICAgICAgICAgICAgICBrVmFsdWUgPSBPW2tdO1xuICAgICAgICAgICAgICAgIG1hcHBlZFZhbHVlID0gY2FsbGJhY2suY2FsbChULCBrVmFsdWUsIGssIE8pO1xuICAgICAgICAgICAgICAgIEFba10gPSBtYXBwZWRWYWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGsrKztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBBO1xuICAgIH0sXG5cbiAgICAvLyBmaWx0ZXIgcG9seWZpbGxcbiAgICAvLyBQcm9kY3V0aW9uIHN0ZXBzIG9mIEVDTUEtMjYyLCBFZGl0aW9uIDVcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHA6Ly9lczUuZ2l0aHViLmlvLyN4MTUuNC40LjIwXG4gICAgZmlsdGVyOiBmdW5jdGlvbihmdW4vKiwgdGhpc0FyZyovKSB7XG4gICAgICAgICd1c2Ugc3RyaWN0JztcblxuICAgICAgICBpZiAodGhpcyA9PT0gdm9pZCAwIHx8IHRoaXMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB0ID0gT2JqZWN0KHRoaXMpO1xuICAgICAgICB2YXIgbGVuID0gdC5sZW5ndGggPj4+IDA7XG4gICAgICAgIGlmICh0eXBlb2YgZnVuICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVzID0gW107XG4gICAgICAgIHZhciB0aGlzQXJnID0gYXJndW1lbnRzLmxlbmd0aCA+PSAyID8gYXJndW1lbnRzWzFdIDogdm9pZCAwO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoaSBpbiB0KSB7XG4gICAgICAgICAgICAgICAgdmFyIHZhbCA9IHRbaV07XG4gICAgICAgICAgICAgICAgaWYgKGZ1bi5jYWxsKHRoaXNBcmcsIHZhbCwgaSwgdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzLnB1c2godmFsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH0sXG5cbiAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9BcnJheS9pc0FycmF5XG4gICAgaXNBcnJheTogZnVuY3Rpb24oYXJnKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYXJnKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbiAgICB9LFxuXG4gICAgQmFzZTY0OiBCYXNlNjRcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgTWVzc2FnZVR5cGUgPSBUeXBlcy5NZXNzYWdlVHlwZSxcbiAgICBBcHBsaWNhdGlvblRyYW5zaXRpb25UeXBlID0gVHlwZXMuQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZSxcbiAgICBDb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBwYXJzZU51bWJlciA9IHJlcXVpcmUoJy4vaGVscGVycycpLnBhcnNlTnVtYmVyO1xuXG5mdW5jdGlvbiBjb252ZXJ0Q3VzdG9tRmxhZ3MoZXZlbnQsIGR0bykge1xuICAgIHZhciB2YWx1ZUFycmF5ID0gW107XG4gICAgZHRvLmZsYWdzID0ge307XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIGV2ZW50LkN1c3RvbUZsYWdzKSB7XG4gICAgICAgIHZhbHVlQXJyYXkgPSBbXTtcblxuICAgICAgICBpZiAoZXZlbnQuQ3VzdG9tRmxhZ3MuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGV2ZW50LkN1c3RvbUZsYWdzW3Byb3BdKSkge1xuICAgICAgICAgICAgICAgIGV2ZW50LkN1c3RvbUZsYWdzW3Byb3BdLmZvckVhY2goZnVuY3Rpb24oY3VzdG9tRmxhZ1Byb3BlcnR5KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3VzdG9tRmxhZ1Byb3BlcnR5ID09PSAnbnVtYmVyJ1xuICAgICAgICAgICAgICAgICAgICB8fCB0eXBlb2YgY3VzdG9tRmxhZ1Byb3BlcnR5ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICAgICAgICB8fCB0eXBlb2YgY3VzdG9tRmxhZ1Byb3BlcnR5ID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlQXJyYXkucHVzaChjdXN0b21GbGFnUHJvcGVydHkudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiBldmVudC5DdXN0b21GbGFnc1twcm9wXSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgIHx8IHR5cGVvZiBldmVudC5DdXN0b21GbGFnc1twcm9wXSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgIHx8IHR5cGVvZiBldmVudC5DdXN0b21GbGFnc1twcm9wXSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgdmFsdWVBcnJheS5wdXNoKGV2ZW50LkN1c3RvbUZsYWdzW3Byb3BdLnRvU3RyaW5nKCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAodmFsdWVBcnJheS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBkdG8uZmxhZ3NbcHJvcF0gPSB2YWx1ZUFycmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UHJvZHVjdExpc3RUb0RUTyhwcm9kdWN0TGlzdCkge1xuICAgIGlmICghcHJvZHVjdExpc3QpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHJldHVybiBwcm9kdWN0TGlzdC5tYXAoZnVuY3Rpb24ocHJvZHVjdCkge1xuICAgICAgICByZXR1cm4gY29udmVydFByb2R1Y3RUb0RUTyhwcm9kdWN0KTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RUb0RUTyhwcm9kdWN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IEhlbHBlcnMucGFyc2VTdHJpbmdPck51bWJlcihwcm9kdWN0LlNrdSksXG4gICAgICAgIG5tOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5OYW1lKSxcbiAgICAgICAgcHI6IHBhcnNlTnVtYmVyKHByb2R1Y3QuUHJpY2UpLFxuICAgICAgICBxdDogcGFyc2VOdW1iZXIocHJvZHVjdC5RdWFudGl0eSksXG4gICAgICAgIGJyOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5CcmFuZCksXG4gICAgICAgIHZhOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5WYXJpYW50KSxcbiAgICAgICAgY2E6IEhlbHBlcnMucGFyc2VTdHJpbmdPck51bWJlcihwcm9kdWN0LkNhdGVnb3J5KSxcbiAgICAgICAgcHM6IHBhcnNlTnVtYmVyKHByb2R1Y3QuUG9zaXRpb24pLFxuICAgICAgICBjYzogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuQ291cG9uQ29kZSksXG4gICAgICAgIHRwYTogcGFyc2VOdW1iZXIocHJvZHVjdC5Ub3RhbEFtb3VudCksXG4gICAgICAgIGF0dHJzOiBwcm9kdWN0LkF0dHJpYnV0ZXNcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0VG9Db25zZW50U3RhdGVEVE8oc3RhdGUpIHtcbiAgICBpZiAoIXN0YXRlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICB2YXIganNvbk9iamVjdCA9IHt9O1xuICAgIHZhciBnZHByQ29uc2VudFN0YXRlID0gc3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpO1xuICAgIGlmIChnZHByQ29uc2VudFN0YXRlKSB7XG4gICAgICAgIHZhciBnZHByID0ge307XG4gICAgICAgIGpzb25PYmplY3QuZ2RwciA9IGdkcHI7XG4gICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4gZ2RwckNvbnNlbnRTdGF0ZSl7XG4gICAgICAgICAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZS5oYXNPd25Qcm9wZXJ0eShwdXJwb3NlKSkge1xuICAgICAgICAgICAgICAgIHZhciBnZHByQ29uc2VudCA9IGdkcHJDb25zZW50U3RhdGVbcHVycG9zZV07XG4gICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdID0ge307XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Db25zZW50ZWQpID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICAgICAgZ2RwcltwdXJwb3NlXS5jID0gZ2RwckNvbnNlbnQuQ29uc2VudGVkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LlRpbWVzdGFtcCkgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0udHMgPSBnZHByQ29uc2VudC5UaW1lc3RhbXA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuQ29uc2VudERvY3VtZW50KSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgZ2RwcltwdXJwb3NlXS5kID0gZ2RwckNvbnNlbnQuQ29uc2VudERvY3VtZW50O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkxvY2F0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgZ2RwcltwdXJwb3NlXS5sID0gZ2RwckNvbnNlbnQuTG9jYXRpb247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuSGFyZHdhcmVJZCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0uaCA9IGdkcHJDb25zZW50LkhhcmR3YXJlSWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGpzb25PYmplY3Q7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50T2JqZWN0KG1lc3NhZ2VUeXBlLCBuYW1lLCBkYXRhLCBldmVudFR5cGUsIGN1c3RvbUZsYWdzKSB7XG4gICAgdmFyIGV2ZW50T2JqZWN0LFxuICAgICAgICBvcHRPdXQgPSAobWVzc2FnZVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLk9wdE91dCA/ICFNUC5pc0VuYWJsZWQgOiBudWxsKTtcbiAgICBkYXRhID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoZGF0YSk7XG5cbiAgICBpZiAoTVAuc2Vzc2lvbklkIHx8IG1lc3NhZ2VUeXBlID09IFR5cGVzLk1lc3NhZ2VUeXBlLk9wdE91dCB8fCBNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICBpZiAobWVzc2FnZVR5cGUgIT09IFR5cGVzLk1lc3NhZ2VUeXBlLlNlc3Npb25FbmQpIHtcbiAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbmV3IERhdGUoKTtcbiAgICAgICAgfVxuICAgICAgICBldmVudE9iamVjdCA9IHtcbiAgICAgICAgICAgIEV2ZW50TmFtZTogbmFtZSB8fCBtZXNzYWdlVHlwZSxcbiAgICAgICAgICAgIEV2ZW50Q2F0ZWdvcnk6IGV2ZW50VHlwZSxcbiAgICAgICAgICAgIFVzZXJBdHRyaWJ1dGVzOiBNUC51c2VyQXR0cmlidXRlcyxcbiAgICAgICAgICAgIFVzZXJJZGVudGl0aWVzOiBNUC51c2VySWRlbnRpdGllcyxcbiAgICAgICAgICAgIFN0b3JlOiBNUC5zZXJ2ZXJTZXR0aW5ncyxcbiAgICAgICAgICAgIEV2ZW50QXR0cmlidXRlczogZGF0YSxcbiAgICAgICAgICAgIFNES1ZlcnNpb246IENvbnN0YW50cy5zZGtWZXJzaW9uLFxuICAgICAgICAgICAgU2Vzc2lvbklkOiBNUC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBFdmVudERhdGFUeXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgICAgICAgIERlYnVnOiBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUsXG4gICAgICAgICAgICBMb2NhdGlvbjogTVAuY3VycmVudFBvc2l0aW9uLFxuICAgICAgICAgICAgT3B0T3V0OiBvcHRPdXQsXG4gICAgICAgICAgICBFeHBhbmRlZEV2ZW50Q291bnQ6IDAsXG4gICAgICAgICAgICBDdXN0b21GbGFnczogY3VzdG9tRmxhZ3MsXG4gICAgICAgICAgICBBcHBWZXJzaW9uOiBNUC5hcHBWZXJzaW9uLFxuICAgICAgICAgICAgQ2xpZW50R2VuZXJhdGVkSWQ6IE1QLmNsaWVudElkLFxuICAgICAgICAgICAgRGV2aWNlSWQ6IE1QLmRldmljZUlkLFxuICAgICAgICAgICAgTVBJRDogTVAubXBpZCxcbiAgICAgICAgICAgIENvbnNlbnRTdGF0ZTogTVAuY29uc2VudFN0YXRlLFxuICAgICAgICAgICAgSW50ZWdyYXRpb25BdHRyaWJ1dGVzOiBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAobWVzc2FnZVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlNlc3Npb25FbmQpIHtcbiAgICAgICAgICAgIGV2ZW50T2JqZWN0LlNlc3Npb25MZW5ndGggPSBNUC5kYXRlTGFzdEV2ZW50U2VudC5nZXRUaW1lKCkgLSBNUC5zZXNzaW9uU3RhcnREYXRlLmdldFRpbWUoKTtcbiAgICAgICAgICAgIGV2ZW50T2JqZWN0LmN1cnJlbnRTZXNzaW9uTVBJRHMgPSBNUC5jdXJyZW50U2Vzc2lvbk1QSURzO1xuICAgICAgICAgICAgZXZlbnRPYmplY3QuRXZlbnRBdHRyaWJ1dGVzID0gTVAuc2Vzc2lvbkF0dHJpYnV0ZXM7XG5cbiAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGV2ZW50T2JqZWN0LlRpbWVzdGFtcCA9IE1QLmRhdGVMYXN0RXZlbnRTZW50LmdldFRpbWUoKTtcblxuICAgICAgICByZXR1cm4gZXZlbnRPYmplY3Q7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRFdmVudFRvRFRPKGV2ZW50LCBpc0ZpcnN0UnVuLCBjdXJyZW5jeUNvZGUpIHtcbiAgICB2YXIgZHRvID0ge1xuICAgICAgICBuOiBldmVudC5FdmVudE5hbWUsXG4gICAgICAgIGV0OiBldmVudC5FdmVudENhdGVnb3J5LFxuICAgICAgICB1YTogZXZlbnQuVXNlckF0dHJpYnV0ZXMsXG4gICAgICAgIHVpOiBldmVudC5Vc2VySWRlbnRpdGllcyxcbiAgICAgICAgaWE6IGV2ZW50LkludGVncmF0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgc3RyOiBldmVudC5TdG9yZSxcbiAgICAgICAgYXR0cnM6IGV2ZW50LkV2ZW50QXR0cmlidXRlcyxcbiAgICAgICAgc2RrOiBldmVudC5TREtWZXJzaW9uLFxuICAgICAgICBzaWQ6IGV2ZW50LlNlc3Npb25JZCxcbiAgICAgICAgc2w6IGV2ZW50LlNlc3Npb25MZW5ndGgsXG4gICAgICAgIGR0OiBldmVudC5FdmVudERhdGFUeXBlLFxuICAgICAgICBkYmc6IGV2ZW50LkRlYnVnLFxuICAgICAgICBjdDogZXZlbnQuVGltZXN0YW1wLFxuICAgICAgICBsYzogZXZlbnQuTG9jYXRpb24sXG4gICAgICAgIG86IGV2ZW50Lk9wdE91dCxcbiAgICAgICAgZWVjOiBldmVudC5FeHBhbmRlZEV2ZW50Q291bnQsXG4gICAgICAgIGF2OiBldmVudC5BcHBWZXJzaW9uLFxuICAgICAgICBjZ2lkOiBldmVudC5DbGllbnRHZW5lcmF0ZWRJZCxcbiAgICAgICAgZGFzOiBldmVudC5EZXZpY2VJZCxcbiAgICAgICAgbXBpZDogZXZlbnQuTVBJRCxcbiAgICAgICAgc21waWRzOiBldmVudC5jdXJyZW50U2Vzc2lvbk1QSURzXG4gICAgfTtcblxuICAgIHZhciBjb25zZW50ID0gY29udmVydFRvQ29uc2VudFN0YXRlRFRPKGV2ZW50LkNvbnNlbnRTdGF0ZSk7XG4gICAgaWYgKGNvbnNlbnQpIHtcbiAgICAgICAgZHRvLmNvbiA9IGNvbnNlbnQ7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IE1lc3NhZ2VUeXBlLkFwcFN0YXRlVHJhbnNpdGlvbikge1xuICAgICAgICBkdG8uZnIgPSBpc0ZpcnN0UnVuO1xuICAgICAgICBkdG8uaXUgPSBmYWxzZTtcbiAgICAgICAgZHRvLmF0ID0gQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZS5BcHBJbml0O1xuICAgICAgICBkdG8ubHIgPSB3aW5kb3cubG9jYXRpb24uaHJlZiB8fCBudWxsO1xuICAgICAgICBkdG8uYXR0cnMgPSBudWxsO1xuICAgIH1cblxuICAgIGlmIChldmVudC5DdXN0b21GbGFncykge1xuICAgICAgICBjb252ZXJ0Q3VzdG9tRmxhZ3MoZXZlbnQsIGR0byk7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IE1lc3NhZ2VUeXBlLkNvbW1lcmNlKSB7XG4gICAgICAgIGR0by5jdSA9IGN1cnJlbmN5Q29kZTtcblxuICAgICAgICBpZiAoZXZlbnQuU2hvcHBpbmdDYXJ0KSB7XG4gICAgICAgICAgICBkdG8uc2MgPSB7XG4gICAgICAgICAgICAgICAgcGw6IGNvbnZlcnRQcm9kdWN0TGlzdFRvRFRPKGV2ZW50LlNob3BwaW5nQ2FydC5Qcm9kdWN0TGlzdClcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZXZlbnQuUHJvZHVjdEFjdGlvbikge1xuICAgICAgICAgICAgZHRvLnBkID0ge1xuICAgICAgICAgICAgICAgIGFuOiBldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RBY3Rpb25UeXBlLFxuICAgICAgICAgICAgICAgIGNzOiBwYXJzZU51bWJlcihldmVudC5Qcm9kdWN0QWN0aW9uLkNoZWNrb3V0U3RlcCksXG4gICAgICAgICAgICAgICAgY286IGV2ZW50LlByb2R1Y3RBY3Rpb24uQ2hlY2tvdXRPcHRpb25zLFxuICAgICAgICAgICAgICAgIHBsOiBjb252ZXJ0UHJvZHVjdExpc3RUb0RUTyhldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RMaXN0KSxcbiAgICAgICAgICAgICAgICB0aTogZXZlbnQuUHJvZHVjdEFjdGlvbi5UcmFuc2FjdGlvbklkLFxuICAgICAgICAgICAgICAgIHRhOiBldmVudC5Qcm9kdWN0QWN0aW9uLkFmZmlsaWF0aW9uLFxuICAgICAgICAgICAgICAgIHRjYzogZXZlbnQuUHJvZHVjdEFjdGlvbi5Db3Vwb25Db2RlLFxuICAgICAgICAgICAgICAgIHRyOiBwYXJzZU51bWJlcihldmVudC5Qcm9kdWN0QWN0aW9uLlRvdGFsQW1vdW50KSxcbiAgICAgICAgICAgICAgICB0czogcGFyc2VOdW1iZXIoZXZlbnQuUHJvZHVjdEFjdGlvbi5TaGlwcGluZ0Ftb3VudCksXG4gICAgICAgICAgICAgICAgdHQ6IHBhcnNlTnVtYmVyKGV2ZW50LlByb2R1Y3RBY3Rpb24uVGF4QW1vdW50KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChldmVudC5Qcm9tb3Rpb25BY3Rpb24pIHtcbiAgICAgICAgICAgIGR0by5wbSA9IHtcbiAgICAgICAgICAgICAgICBhbjogZXZlbnQuUHJvbW90aW9uQWN0aW9uLlByb21vdGlvbkFjdGlvblR5cGUsXG4gICAgICAgICAgICAgICAgcGw6IGV2ZW50LlByb21vdGlvbkFjdGlvbi5Qcm9tb3Rpb25MaXN0Lm1hcChmdW5jdGlvbihwcm9tb3Rpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiBwcm9tb3Rpb24uSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBubTogcHJvbW90aW9uLk5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjcjogcHJvbW90aW9uLkNyZWF0aXZlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHM6IHByb21vdGlvbi5Qb3NpdGlvbiA/IHByb21vdGlvbi5Qb3NpdGlvbiA6IDBcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChldmVudC5Qcm9kdWN0SW1wcmVzc2lvbnMpIHtcbiAgICAgICAgICAgIGR0by5waSA9IGV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucy5tYXAoZnVuY3Rpb24oaW1wcmVzc2lvbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHBpbDogaW1wcmVzc2lvbi5Qcm9kdWN0SW1wcmVzc2lvbkxpc3QsXG4gICAgICAgICAgICAgICAgICAgIHBsOiBjb252ZXJ0UHJvZHVjdExpc3RUb0RUTyhpbXByZXNzaW9uLlByb2R1Y3RMaXN0KVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBNZXNzYWdlVHlwZS5Qcm9maWxlKSB7XG4gICAgICAgIGR0by5wZXQgPSBldmVudC5Qcm9maWxlTWVzc2FnZVR5cGU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGR0bztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgY3JlYXRlRXZlbnRPYmplY3Q6IGNyZWF0ZUV2ZW50T2JqZWN0LFxuICAgIGNvbnZlcnRFdmVudFRvRFRPOiBjb252ZXJ0RXZlbnRUb0RUTyxcbiAgICBjb252ZXJ0VG9Db25zZW50U3RhdGVEVE86IGNvbnZlcnRUb0NvbnNlbnRTdGF0ZURUT1xufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgTWVzc2FnZXMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLk1lc3NhZ2VzLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIElkZW50aXR5QVBJID0gcmVxdWlyZSgnLi9pZGVudGl0eScpLklkZW50aXR5QVBJLFxuICAgIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIGxvZ0V2ZW50ID0gcmVxdWlyZSgnLi9ldmVudHMnKS5sb2dFdmVudDtcblxuZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgIHZhciBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzID0gTVAuQ29uZmlnLlNlc3Npb25UaW1lb3V0ICogNjAwMDA7XG5cbiAgICAgICAgaWYgKG5ldyBEYXRlKCkgPiBuZXcgRGF0ZShNUC5kYXRlTGFzdEV2ZW50U2VudC5nZXRUaW1lKCkgKyBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzKSkge1xuICAgICAgICAgICAgdGhpcy5lbmRTZXNzaW9uKCk7XG4gICAgICAgICAgICB0aGlzLnN0YXJ0TmV3U2Vzc2lvbigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMgPSBtUGFydGljbGUucGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcbiAgICAgICAgICAgIGlmIChjb29raWVzICYmICFjb29raWVzLmN1KSB7XG4gICAgICAgICAgICAgICAgSWRlbnRpdHlBUEkuaWRlbnRpZnkoTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCwgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2spO1xuICAgICAgICAgICAgICAgIE1QLmlkZW50aWZ5Q2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnN0YXJ0TmV3U2Vzc2lvbigpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0U2Vzc2lvbigpIHtcbiAgICByZXR1cm4gTVAuc2Vzc2lvbklkO1xufVxuXG5mdW5jdGlvbiBzdGFydE5ld1Nlc3Npb24oKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTmV3U2Vzc2lvbik7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBNUC5zZXNzaW9uSWQgPSBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBpZiAoTVAubXBpZCkge1xuICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcyA9IFtNUC5tcGlkXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghTVAuc2Vzc2lvblN0YXJ0RGF0ZSkge1xuICAgICAgICAgICAgdmFyIGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgICAgTVAuc2Vzc2lvblN0YXJ0RGF0ZSA9IGRhdGU7XG4gICAgICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IGRhdGU7XG4gICAgICAgIH1cblxuICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIuc2V0U2Vzc2lvblRpbWVyKCk7XG5cbiAgICAgICAgaWYgKCFNUC5pZGVudGlmeUNhbGxlZCkge1xuICAgICAgICAgICAgSWRlbnRpdHlBUEkuaWRlbnRpZnkoTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCwgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2spO1xuICAgICAgICAgICAgTVAuaWRlbnRpZnlDYWxsZWQgPSB0cnVlO1xuICAgICAgICAgICAgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgbG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuU2Vzc2lvblN0YXJ0KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uU3RhcnRTZXNzaW9uKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGVuZFNlc3Npb24ob3ZlcnJpZGUpIHtcbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdFbmRTZXNzaW9uKTtcblxuICAgIGlmIChvdmVycmlkZSkge1xuICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKTtcblxuICAgICAgICBNUC5zZXNzaW9uSWQgPSBudWxsO1xuICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IG51bGw7XG4gICAgICAgIE1QLnNlc3Npb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgIH0gZWxzZSBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICB2YXIgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcyxcbiAgICAgICAgICAgIGNvb2tpZXMsXG4gICAgICAgICAgICB0aW1lU2luY2VMYXN0RXZlbnRTZW50O1xuXG4gICAgICAgIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRDb29raWUoKSB8fCBQZXJzaXN0ZW5jZS5nZXRMb2NhbFN0b3JhZ2UoKTtcblxuICAgICAgICBpZiAoIWNvb2tpZXMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb29raWVzLmdzICYmICFjb29raWVzLmdzLnNpZCkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLk5vU2Vzc2lvblRvRW5kKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHNlc3Npb25JZCBpcyBub3QgZXF1YWwgdG8gY29va2llcy5zaWQgaWYgY29va2llcy5zaWQgaXMgY2hhbmdlZCBpbiBhbm90aGVyIHRhYlxuICAgICAgICBpZiAoY29va2llcy5ncy5zaWQgJiYgTVAuc2Vzc2lvbklkICE9PSBjb29raWVzLmdzLnNpZCkge1xuICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gY29va2llcy5ncy5zaWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29va2llcy5ncyAmJiBjb29raWVzLmdzLmxlcykge1xuICAgICAgICAgICAgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcyA9IE1QLkNvbmZpZy5TZXNzaW9uVGltZW91dCAqIDYwMDAwO1xuICAgICAgICAgICAgdmFyIG5ld0RhdGUgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgICAgICAgIHRpbWVTaW5jZUxhc3RFdmVudFNlbnQgPSBuZXdEYXRlIC0gY29va2llcy5ncy5sZXM7XG5cbiAgICAgICAgICAgIGlmICh0aW1lU2luY2VMYXN0RXZlbnRTZW50IDwgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcykge1xuICAgICAgICAgICAgICAgIHNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKTtcblxuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25JZCA9IG51bGw7XG4gICAgICAgICAgICAgICAgTVAuZGF0ZUxhc3RFdmVudFNlbnQgPSBudWxsO1xuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25TdGFydERhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvbkVuZFNlc3Npb24pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0U2Vzc2lvblRpbWVyKCkge1xuICAgIHZhciBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzID0gTVAuQ29uZmlnLlNlc3Npb25UaW1lb3V0ICogNjAwMDA7XG5cbiAgICBNUC5nbG9iYWxUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIuZW5kU2Vzc2lvbigpO1xuICAgIH0sIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMpO1xufVxuXG5mdW5jdGlvbiByZXNldFNlc3Npb25UaW1lcigpIHtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgIGlmICghTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICBzdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgfVxuICAgICAgICBjbGVhclNlc3Npb25UaW1lb3V0KCk7XG4gICAgICAgIHNldFNlc3Npb25UaW1lcigpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY2xlYXJTZXNzaW9uVGltZW91dCgpIHtcbiAgICBjbGVhclRpbWVvdXQoTVAuZ2xvYmFsVGltZXIpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBpbml0aWFsaXplOiBpbml0aWFsaXplLFxuICAgIGdldFNlc3Npb246IGdldFNlc3Npb24sXG4gICAgc3RhcnROZXdTZXNzaW9uOiBzdGFydE5ld1Nlc3Npb24sXG4gICAgZW5kU2Vzc2lvbjogZW5kU2Vzc2lvbixcbiAgICBzZXRTZXNzaW9uVGltZXI6IHNldFNlc3Npb25UaW1lcixcbiAgICByZXNldFNlc3Npb25UaW1lcjogcmVzZXRTZXNzaW9uVGltZXIsXG4gICAgY2xlYXJTZXNzaW9uVGltZW91dDogY2xlYXJTZXNzaW9uVGltZW91dFxufTtcbiIsInZhciBNZXNzYWdlVHlwZSA9IHtcbiAgICBTZXNzaW9uU3RhcnQ6IDEsXG4gICAgU2Vzc2lvbkVuZDogMixcbiAgICBQYWdlVmlldzogMyxcbiAgICBQYWdlRXZlbnQ6IDQsXG4gICAgQ3Jhc2hSZXBvcnQ6IDUsXG4gICAgT3B0T3V0OiA2LFxuICAgIEFwcFN0YXRlVHJhbnNpdGlvbjogMTAsXG4gICAgUHJvZmlsZTogMTQsXG4gICAgQ29tbWVyY2U6IDE2XG59O1xuXG52YXIgRXZlbnRUeXBlID0ge1xuICAgIFVua25vd246IDAsXG4gICAgTmF2aWdhdGlvbjogMSxcbiAgICBMb2NhdGlvbjogMixcbiAgICBTZWFyY2g6IDMsXG4gICAgVHJhbnNhY3Rpb246IDQsXG4gICAgVXNlckNvbnRlbnQ6IDUsXG4gICAgVXNlclByZWZlcmVuY2U6IDYsXG4gICAgU29jaWFsOiA3LFxuICAgIE90aGVyOiA4LFxuICAgIGdldE5hbWU6IGZ1bmN0aW9uKGlkKSB7XG4gICAgICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLk5hdmlnYXRpb246XG4gICAgICAgICAgICAgICAgcmV0dXJuICdOYXZpZ2F0aW9uJztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLkxvY2F0aW9uOlxuICAgICAgICAgICAgICAgIHJldHVybiAnTG9jYXRpb24nO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuU2VhcmNoOlxuICAgICAgICAgICAgICAgIHJldHVybiAnU2VhcmNoJztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLlRyYW5zYWN0aW9uOlxuICAgICAgICAgICAgICAgIHJldHVybiAnVHJhbnNhY3Rpb24nO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuVXNlckNvbnRlbnQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdVc2VyIENvbnRlbnQnO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuVXNlclByZWZlcmVuY2U6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdVc2VyIFByZWZlcmVuY2UnO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuU29jaWFsOlxuICAgICAgICAgICAgICAgIHJldHVybiAnU29jaWFsJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEFkZFRvQ2FydDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgQWRkZWQgdG8gQ2FydCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RBZGRUb1dpc2hsaXN0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBBZGRlZCB0byBXaXNobGlzdCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgQ2hlY2tvdXQnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IENoZWNrb3V0IE9wdGlvbnMnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2xpY2s6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IENsaWNrJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEltcHJlc3Npb246XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IEltcHJlc3Npb24nO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UHVyY2hhc2U6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IFB1cmNoYXNlZCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZWZ1bmQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IFJlZnVuZGVkJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBSZW1vdmVkIEZyb20gQ2FydCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZW1vdmVGcm9tV2lzaGxpc3Q6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IFJlbW92ZWQgZnJvbSBXaXNobGlzdCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RWaWV3RGV0YWlsOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBWaWV3IERldGFpbHMnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9tb3Rpb25DbGljazpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb21vdGlvbiBDbGljayc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb21vdGlvblZpZXc6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb24gVmlldyc7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnT3RoZXInO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLy8gQ29udGludWF0aW9uIG9mIGVudW0gYWJvdmUsIGJ1dCBpbiBzZXBlcmF0ZSBvYmplY3Qgc2luY2Ugd2UgZG9uJ3QgZXhwb3NlIHRoZXNlIHRvIGVuZCB1c2VyXG52YXIgQ29tbWVyY2VFdmVudFR5cGUgPSB7XG4gICAgUHJvZHVjdEFkZFRvQ2FydDogMTAsXG4gICAgUHJvZHVjdFJlbW92ZUZyb21DYXJ0OiAxMSxcbiAgICBQcm9kdWN0Q2hlY2tvdXQ6IDEyLFxuICAgIFByb2R1Y3RDaGVja291dE9wdGlvbjogMTMsXG4gICAgUHJvZHVjdENsaWNrOiAxNCxcbiAgICBQcm9kdWN0Vmlld0RldGFpbDogMTUsXG4gICAgUHJvZHVjdFB1cmNoYXNlOiAxNixcbiAgICBQcm9kdWN0UmVmdW5kOiAxNyxcbiAgICBQcm9tb3Rpb25WaWV3OiAxOCxcbiAgICBQcm9tb3Rpb25DbGljazogMTksXG4gICAgUHJvZHVjdEFkZFRvV2lzaGxpc3Q6IDIwLFxuICAgIFByb2R1Y3RSZW1vdmVGcm9tV2lzaGxpc3Q6IDIxLFxuICAgIFByb2R1Y3RJbXByZXNzaW9uOiAyMlxufTtcblxudmFyIElkZW50aXR5VHlwZSA9IHtcbiAgICBPdGhlcjogMCxcbiAgICBDdXN0b21lcklkOiAxLFxuICAgIEZhY2Vib29rOiAyLFxuICAgIFR3aXR0ZXI6IDMsXG4gICAgR29vZ2xlOiA0LFxuICAgIE1pY3Jvc29mdDogNSxcbiAgICBZYWhvbzogNixcbiAgICBFbWFpbDogNyxcbiAgICBGYWNlYm9va0N1c3RvbUF1ZGllbmNlSWQ6IDksXG4gICAgT3RoZXIyOiAxMCxcbiAgICBPdGhlcjM6IDExLFxuICAgIE90aGVyNDogMTJcbn07XG5cbklkZW50aXR5VHlwZS5pc1ZhbGlkID0gZnVuY3Rpb24oaWRlbnRpdHlUeXBlKSB7XG4gICAgaWYgKHR5cGVvZiBpZGVudGl0eVR5cGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgIGZvciAodmFyIHByb3AgaW4gSWRlbnRpdHlUeXBlKSB7XG4gICAgICAgICAgICBpZiAoSWRlbnRpdHlUeXBlLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgaWYgKElkZW50aXR5VHlwZVtwcm9wXSA9PT0gaWRlbnRpdHlUeXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn07XG5cbklkZW50aXR5VHlwZS5nZXROYW1lID0gZnVuY3Rpb24oaWRlbnRpdHlUeXBlKSB7XG4gICAgc3dpdGNoIChpZGVudGl0eVR5cGUpIHtcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5DdXN0b21lcklkOlxuICAgICAgICAgICAgcmV0dXJuICdDdXN0b21lciBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuRmFjZWJvb2s6XG4gICAgICAgICAgICByZXR1cm4gJ0ZhY2Vib29rIElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5Ud2l0dGVyOlxuICAgICAgICAgICAgcmV0dXJuICdUd2l0dGVyIElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5Hb29nbGU6XG4gICAgICAgICAgICByZXR1cm4gJ0dvb2dsZSBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuTWljcm9zb2Z0OlxuICAgICAgICAgICAgcmV0dXJuICdNaWNyb3NvZnQgSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLllhaG9vOlxuICAgICAgICAgICAgcmV0dXJuICdZYWhvbyBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuRW1haWw6XG4gICAgICAgICAgICByZXR1cm4gJ0VtYWlsJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5GYWNlYm9va0N1c3RvbUF1ZGllbmNlSWQ6XG4gICAgICAgICAgICByZXR1cm4gJ0ZhY2Vib29rIEFwcCBVc2VyIElEJztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnT3RoZXIgSUQnO1xuICAgIH1cbn07XG5cbklkZW50aXR5VHlwZS5nZXRJZGVudGl0eVR5cGUgPSBmdW5jdGlvbihpZGVudGl0eU5hbWUpIHtcbiAgICBzd2l0Y2ggKGlkZW50aXR5TmFtZSkge1xuICAgICAgICBjYXNlICdvdGhlcic6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk90aGVyO1xuICAgICAgICBjYXNlICdjdXN0b21lcmlkJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuQ3VzdG9tZXJJZDtcbiAgICAgICAgY2FzZSAnZmFjZWJvb2snOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5GYWNlYm9vaztcbiAgICAgICAgY2FzZSAndHdpdHRlcic6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLlR3aXR0ZXI7XG4gICAgICAgIGNhc2UgJ2dvb2dsZSc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLkdvb2dsZTtcbiAgICAgICAgY2FzZSAnbWljcm9zb2Z0JzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuTWljcm9zb2Z0O1xuICAgICAgICBjYXNlICd5YWhvbyc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLllhaG9vO1xuICAgICAgICBjYXNlICdlbWFpbCc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLkVtYWlsO1xuICAgICAgICBjYXNlICdmYWNlYm9va2N1c3RvbWF1ZGllbmNlaWQnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5GYWNlYm9va0N1c3RvbUF1ZGllbmNlSWQ7XG4gICAgICAgIGNhc2UgJ290aGVyMSc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk90aGVyMTtcbiAgICAgICAgY2FzZSAnb3RoZXIyJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuT3RoZXIyO1xuICAgICAgICBjYXNlICdvdGhlcjMnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5PdGhlcjM7XG4gICAgICAgIGNhc2UgJ290aGVyNCc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk90aGVyNDtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG59O1xuXG5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lID0gZnVuY3Rpb24oaWRlbnRpdHlUeXBlKSB7XG4gICAgc3dpdGNoIChpZGVudGl0eVR5cGUpIHtcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuT3RoZXI6XG4gICAgICAgICAgICByZXR1cm4gJ290aGVyJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuQ3VzdG9tZXJJZDpcbiAgICAgICAgICAgIHJldHVybiAnY3VzdG9tZXJpZCc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLkZhY2Vib29rOlxuICAgICAgICAgICAgcmV0dXJuICdmYWNlYm9vayc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLlR3aXR0ZXI6XG4gICAgICAgICAgICByZXR1cm4gJ3R3aXR0ZXInO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5Hb29nbGU6XG4gICAgICAgICAgICByZXR1cm4gJ2dvb2dsZSc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk1pY3Jvc29mdDpcbiAgICAgICAgICAgIHJldHVybiAnbWljcm9zb2Z0JztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuWWFob286XG4gICAgICAgICAgICByZXR1cm4gJ3lhaG9vJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuRW1haWw6XG4gICAgICAgICAgICByZXR1cm4gJ2VtYWlsJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuRmFjZWJvb2tDdXN0b21BdWRpZW5jZUlkOlxuICAgICAgICAgICAgcmV0dXJuICdmYWNlYm9va2N1c3RvbWF1ZGllbmNlaWQnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5PdGhlcjE6XG4gICAgICAgICAgICByZXR1cm4gJ290aGVyMSc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk90aGVyMjpcbiAgICAgICAgICAgIHJldHVybiAnb3RoZXIyJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuT3RoZXIzOlxuICAgICAgICAgICAgcmV0dXJuICdvdGhlcjMnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5PdGhlcjQ6XG4gICAgICAgICAgICByZXR1cm4gJ290aGVyNCc7XG4gICAgfVxufTtcblxudmFyIFByb2R1Y3RBY3Rpb25UeXBlID0ge1xuICAgIFVua25vd246IDAsXG4gICAgQWRkVG9DYXJ0OiAxLFxuICAgIFJlbW92ZUZyb21DYXJ0OiAyLFxuICAgIENoZWNrb3V0OiAzLFxuICAgIENoZWNrb3V0T3B0aW9uOiA0LFxuICAgIENsaWNrOiA1LFxuICAgIFZpZXdEZXRhaWw6IDYsXG4gICAgUHVyY2hhc2U6IDcsXG4gICAgUmVmdW5kOiA4LFxuICAgIEFkZFRvV2lzaGxpc3Q6IDksXG4gICAgUmVtb3ZlRnJvbVdpc2hsaXN0OiAxMFxufTtcblxuUHJvZHVjdEFjdGlvblR5cGUuZ2V0TmFtZSA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgc3dpdGNoIChpZCkge1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnQWRkIHRvIENhcnQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmUgZnJvbSBDYXJ0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dDpcbiAgICAgICAgICAgIHJldHVybiAnQ2hlY2tvdXQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0T3B0aW9uOlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dCBPcHRpb24nO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuICdDbGljayc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuVmlld0RldGFpbDpcbiAgICAgICAgICAgIHJldHVybiAnVmlldyBEZXRhaWwnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlOlxuICAgICAgICAgICAgcmV0dXJuICdQdXJjaGFzZSc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kOlxuICAgICAgICAgICAgcmV0dXJuICdSZWZ1bmQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ0FkZCB0byBXaXNobGlzdCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbVdpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmUgZnJvbSBXaXNobGlzdCc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ1Vua25vd24nO1xuICAgIH1cbn07XG5cbi8vIHRoZXNlIGFyZSB0aGUgYWN0aW9uIG5hbWVzIHVzZWQgYnkgc2VydmVyIGFuZCBtb2JpbGUgU0RLcyB3aGVuIGV4cGFuZGluZyBhIENvbW1lcmNlRXZlbnRcblByb2R1Y3RBY3Rpb25UeXBlLmdldEV4cGFuc2lvbk5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5BZGRUb0NhcnQ6XG4gICAgICAgICAgICByZXR1cm4gJ2FkZF90b19jYXJ0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAncmVtb3ZlX2Zyb21fY2FydCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQ6XG4gICAgICAgICAgICByZXR1cm4gJ2NoZWNrb3V0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dE9wdGlvbjpcbiAgICAgICAgICAgIHJldHVybiAnY2hlY2tvdXRfb3B0aW9uJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnY2xpY2snO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gJ3ZpZXdfZGV0YWlsJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZTpcbiAgICAgICAgICAgIHJldHVybiAncHVyY2hhc2UnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZDpcbiAgICAgICAgICAgIHJldHVybiAncmVmdW5kJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5BZGRUb1dpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdhZGRfdG9fd2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAncmVtb3ZlX2Zyb21fd2lzaGxpc3QnO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICB9XG59O1xuXG52YXIgUHJvbW90aW9uQWN0aW9uVHlwZSA9IHtcbiAgICBVbmtub3duOiAwLFxuICAgIFByb21vdGlvblZpZXc6IDEsXG4gICAgUHJvbW90aW9uQ2xpY2s6IDJcbn07XG5cblByb21vdGlvbkFjdGlvblR5cGUuZ2V0TmFtZSA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgc3dpdGNoIChpZCkge1xuICAgICAgICBjYXNlIFByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uVmlldzpcbiAgICAgICAgICAgIHJldHVybiAndmlldyc7XG4gICAgICAgIGNhc2UgUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnY2xpY2snO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICB9XG59O1xuXG4vLyB0aGVzZSBhcmUgdGhlIG5hbWVzIHRoYXQgdGhlIHNlcnZlciBhbmQgbW9iaWxlIFNES3MgdXNlIHdoaWxlIGV4cGFuZGluZyBDb21tZXJjZUV2ZW50XG5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldEV4cGFuc2lvbk5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvblZpZXc6XG4gICAgICAgICAgICByZXR1cm4gJ3ZpZXcnO1xuICAgICAgICBjYXNlIFByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ2NsaWNrJztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgfVxufTtcblxudmFyIFByb2ZpbGVNZXNzYWdlVHlwZSA9IHtcbiAgICBMb2dvdXQ6IDNcbn07XG52YXIgQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZSA9IHtcbiAgICBBcHBJbml0OiAxXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBNZXNzYWdlVHlwZTogTWVzc2FnZVR5cGUsXG4gICAgRXZlbnRUeXBlOiBFdmVudFR5cGUsXG4gICAgQ29tbWVyY2VFdmVudFR5cGU6IENvbW1lcmNlRXZlbnRUeXBlLFxuICAgIElkZW50aXR5VHlwZTogSWRlbnRpdHlUeXBlLFxuICAgIFByb2ZpbGVNZXNzYWdlVHlwZTogUHJvZmlsZU1lc3NhZ2VUeXBlLFxuICAgIEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGU6IEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUsXG4gICAgUHJvZHVjdEFjdGlvblR5cGU6UHJvZHVjdEFjdGlvblR5cGUsXG4gICAgUHJvbW90aW9uQWN0aW9uVHlwZTpQcm9tb3Rpb25BY3Rpb25UeXBlXG59O1xuIl19
