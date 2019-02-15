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
    sdkVersion = '2.8.7',
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
        CurrentStorageName: 'mprtcl-v4',
        CurrentStorageProductsName: 'mprtcl-prodv4',
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

function startTracking(callback) {
    if (!MP.isTracking) {
        if ('geolocation' in navigator) {
            MP.watchPositionId = navigator.geolocation.watchPosition(successTracking, errorTracking);
        }
    } else {
        var position = {
            coords: {
                latitude: MP.currentPosition.lat,
                longitude: MP.currentPosition.lng
            }
        };
        triggerCallback(callback, position);
    }

    function successTracking(position) {
        MP.currentPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        triggerCallback(callback, position);
        // prevents callback from being fired multiple times
        callback = null;

        MP.isTracking = true;
    }

    function errorTracking() {
        triggerCallback(callback);
        // prevents callback from being fired multiple times
        callback = null;
        MP.isTracking = false;
    }

    function triggerCallback(callback, position) {
        if (callback) {
            try {
                if (position) {
                    callback(position);
                } else {
                    callback();
                }
            } catch (e) {
                Helpers.logDebug('Error invoking the callback passed to startTrackingLocation.');
                Helpers.logDebug(e);
            }
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

function createMainStorageName(workspaceToken) {
    if (workspaceToken) {
        return Constants.DefaultConfig.CurrentStorageName + '_' + workspaceToken;
    } else {
        return Constants.DefaultConfig.CurrentStorageName;
    }
}

function createProductStorageName(workspaceToken) {
    if (workspaceToken) {
        return Constants.DefaultConfig.CurrentStorageProductsName + '_' + workspaceToken;
    } else {
        return Constants.DefaultConfig.CurrentStorageProductsName;
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
    createMainStorageName: createMainStorageName,
    createProductStorageName: createProductStorageName,
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

                MP.storageName = Helpers.createMainStorageName(mParticle.workspaceToken);
                MP.prodStorageName = Helpers.createProductStorageName(mParticle.workspaceToken);

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
        * @param {Function} [callback] A callback function that is called when the location is either allowed or rejected by the user. A position object of schema {coords: {latitude: number, longitude: number}} is passed to the callback
        */
        startTrackingLocation: function(callback) {
            if (!Validators.isFunction(callback)) {
                Helpers.logDebug('Warning: Location tracking is triggered, but not including a callback into the `startTrackingLocation` may result in events logged too quickly and not being associated with a location.');
            }

            mParticle.sessionManager.resetSessionTimer();
            Events.startTracking(callback);
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
        if (name === MP.storageName) {
            return;
        }
        if (name === Config.CookieNameV4) {
            // adds cookies to new namespace, removes previous cookie
            finishCookieMigration(cookie, Config.CookieNameV4);
            migrateProductsToNameSpace();
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
    encodeURIComponent(MP.storageName) + '=' + cookie +
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
            localStorage.setItem(MP.prodStorageName, Base64.encode(JSON.stringify(localStorageProducts)));
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

function migrateProductsToNameSpace() {
    var lsProdV4Name = Constants.DefaultConfig.LocalStorageProductsV4;
    var products = localStorage.getItem(Constants.DefaultConfig.LocalStorageProductsV4);
    localStorage.setItem(MP.prodStorageName, products);
    localStorage.removeItem(lsProdV4Name);

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

    localStorage.setItem(MP.prodStorageName, Base64.encode(JSON.stringify(localStorageProducts)));
}

function migrateLocalStorage() {
    var cookies,
        v1LSName = Config.LocalStorageName,
        v3LSName = Config.LocalStorageNameV3,
        v4LSName = Config.LocalStorageNameV4,
        currentVersionLSData = window.localStorage.getItem(MP.storageName),
        v4LSData,
        v1LSData,
        v3LSData,
        v3LSDataStringCopy;

    if (currentVersionLSData) {
        return;
    }

    v4LSData = window.localStorage.getItem(v4LSName);
    if (v4LSData) {
        finishLSMigration(v4LSData, v4LSName);
        migrateProductsToNameSpace();
        return;
    }

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
    }

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

    function finishLSMigration(data, lsName) {
        try {
            window.localStorage.setItem(encodeURIComponent(MP.storageName), data);
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
    storageName: null,
    prodStorageName: null
};

},{}],15:[function(require,module,exports){
var Helpers = require('./helpers'),
    Messages = require('./constants').Messages,
    MP = require('./mp');

var androidBridgeNameBase = 'mParticleAndroid';
var iosBridgeNameBase = 'mParticle';

function isBridgeV2Available(bridgeName) {
    if (!bridgeName) {
        return false;
    }
    var androidBridgeName = androidBridgeNameBase + '_' + bridgeName + '_v2';
    var iosBridgeName = iosBridgeNameBase + '_' + bridgeName + '_v2';

    // iOS v2 bridge
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hasOwnProperty(iosBridgeName)) {
        return true;
    }
    // other iOS v2 bridge
    if (window.mParticle.uiwebviewBridgeName === iosBridgeName) {
        return true;
    }
    // android
    if (window.hasOwnProperty(androidBridgeName)) {
        return true;
    }
    return false;
}

function isWebviewEnabled(requiredWebviewBridgeName, minWebviewBridgeVersion) {
    MP.bridgeV2Available = isBridgeV2Available(requiredWebviewBridgeName);
    MP.bridgeV1Available = isBridgeV1Available();

    if (minWebviewBridgeVersion === 2) {
        return MP.bridgeV2Available;
    }

    // iOS BridgeV1 can be available via mParticle.isIOS, but return false if uiwebviewBridgeName doesn't match requiredWebviewBridgeName
    if (window.mParticle.uiwebviewBridgeName && window.mParticle.uiwebviewBridgeName !== (iosBridgeNameBase + '_' + requiredWebviewBridgeName + '_v2')) {
        return false;
    }

    if (minWebviewBridgeVersion < 2) {
        // ios
        return MP.bridgeV2Available || MP.bridgeV1Available;
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
    if (MP.bridgeV2Available && mParticle.minWebviewBridgeVersion === 2) {
        sendViaBridgeV2(path, value, mParticle.requiredWebviewBridgeName);
        return;
    }
    if (MP.bridgeV2Available && mParticle.minWebviewBridgeVersion < 2) {
        sendViaBridgeV2(path, value, mParticle.requiredWebviewBridgeName);
        return;
    }
    if (MP.bridgeV1Available && mParticle.minWebviewBridgeVersion < 2) {
        sendViaBridgeV1(path, value);
        return;
    }
}

function sendViaBridgeV1(path, value) {
    if (window.mParticleAndroid && window.mParticleAndroid.hasOwnProperty(path)) {
        Helpers.logDebug(Messages.InformationMessages.SendAndroid + path);
        window.mParticleAndroid[path](value);
    }
    else if (window.mParticle.isIOS) {
        Helpers.logDebug(Messages.InformationMessages.SendIOS + path);
        sendViaIframeToIOS(path, value);
    }
}

function sendViaIframeToIOS(path, value) {
    var iframe = document.createElement('IFRAME');
    iframe.setAttribute('src', 'mp-sdk://' + path + '/' + encodeURIComponent(value));
    document.documentElement.appendChild(iframe);
    iframe.parentNode.removeChild(iframe);
    iframe = null;
}

function sendViaBridgeV2(path, value, requiredWebviewBridgeName) {
    if (!requiredWebviewBridgeName) {
        return;
    }

    var androidBridgeName = androidBridgeNameBase + '_' + requiredWebviewBridgeName + '_v2',
        androidBridge = window[androidBridgeName],
        iosBridgeName = iosBridgeNameBase + '_' + requiredWebviewBridgeName + '_v2',
        iOSBridgeMessageHandler,
        iOSBridgeNonMessageHandler;

    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[iosBridgeName]) {
        iOSBridgeMessageHandler = window.webkit.messageHandlers[iosBridgeName];
    }

    if (window.mParticle.uiwebviewBridgeName === iosBridgeName) {
        iOSBridgeNonMessageHandler = window.mParticle[iosBridgeName];
    }

    if (androidBridge && androidBridge.hasOwnProperty(path)) {
        Helpers.logDebug(Messages.InformationMessages.SendAndroid + path);
        androidBridge[path](value);
        return;
    } else if (iOSBridgeMessageHandler) {
        Helpers.logDebug(Messages.InformationMessages.SendIOS + path);
        iOSBridgeMessageHandler.postMessage(JSON.stringify({path:path, value: value ? JSON.parse(value) : null}));
    } else if (iOSBridgeNonMessageHandler) {
        Helpers.logDebug(Messages.InformationMessages.SendIOS + path);
        sendViaIframeToIOS(path, value);
    }
}

module.exports = {
    isWebviewEnabled: isWebviewEnabled,
    isBridgeV2Available:isBridgeV2Available,
    sendToNative: sendToNative,
    sendViaBridgeV1: sendViaBridgeV1,
    sendViaBridgeV2: sendViaBridgeV2
};

},{"./constants":3,"./helpers":9,"./mp":14}],16:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    Base64 = require('./polyfill').Base64,
    Messages = Constants.Messages,
    MP = require('./mp'),
    Base64CookieKeys = Constants.Base64CookieKeys,
    SDKv2NonMPIDCookieKeys = Constants.SDKv2NonMPIDCookieKeys,
    Consent = require('./consent');

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
                    storage.removeItem(MP.storageName);
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
                    this.expireCookies(MP.storageName);
                } else {
                    this.storeDataInMemory(localStorageData);
                }
            }
        } else {
            this.storeDataInMemory(cookies);
        }

        try {
            if (MP.isLocalStorageAvailable) {
                var encodedProducts = localStorage.getItem(MP.prodStorageName);

                if (encodedProducts) {
                    var decodedProducts = JSON.parse(Base64.decode(encodedProducts));
                }
                if (MP.mpid) {
                    storeProductsInMemory(decodedProducts, MP.mpid);
                }
            }
        } catch (e) {
            if (MP.isLocalStorageAvailable) {
                localStorage.removeItem(MP.prodStorageName);
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
            localStorage.removeItem(MP.storageName);
        } else {
            expireCookies(MP.storageName);
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
        encodedProducts = localStorage.getItem(MP.prodStorageName);
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
        encodedProducts = localStorage.getItem(MP.prodStorageName),
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

    var key = MP.storageName,
        allLocalStorageProducts = getAllUserProductsFromLS(),
        currentUserProducts = this.convertProductsForLocalStorage(),
        localStorageData = this.getLocalStorage() || {},
        currentMPIDData;

    if (MP.mpid) {
        allLocalStorageProducts = allLocalStorageProducts || {};
        allLocalStorageProducts[MP.mpid] = currentUserProducts;
        try {
            window.localStorage.setItem(encodeURIComponent(MP.prodStorageName), Base64.encode(JSON.stringify(allLocalStorageProducts)));
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

    var key = MP.storageName,
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
        key = MP.storageName,
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
        key = MP.storageName,
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
    return JSON.parse(Base64.decode(localStorage.getItem(MP.prodStorageName)));
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
        var allCartProducts = JSON.parse(Base64.decode(localStorage.getItem(MP.prodStorageName)));
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
        window.localStorage.setItem(encodeURIComponent(MP.prodStorageName), Base64.encode(JSON.stringify(allProducts)));
    }
    catch (e) {
        Helpers.logDebug('Error with setting products on localStorage.');
    }
}

function updateOnlyCookieUserAttributes(cookies) {
    var encodedCookies = encodeCookies(JSON.stringify(cookies)),
        date = new Date(),
        key = MP.storageName,
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
            localStorage.setItem(MP.storageName, encodedCookies);
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

function resetPersistence() {
    removeLocalStorage(MP.Config.LocalStorageName);
    removeLocalStorage(MP.Config.LocalStorageNameV3);
    removeLocalStorage(MP.Config.LocalStorageNameV4);
    removeLocalStorage(MP.prodStorageName);
    removeLocalStorage(MP.Config.LocalStorageProductsV4);

    expireCookies(MP.Config.CookieName);
    expireCookies(MP.Config.CookieNameV2);
    expireCookies(MP.Config.CookieNameV3);
    expireCookies(MP.Config.CookieNameV4);
    if (mParticle._isTestEnv) {
        removeLocalStorage(Helpers.createMainStorageName(mParticle.workspaceToken));
        expireCookies(Helpers.createMainStorageName(mParticle.workspaceToken));
        removeLocalStorage(Helpers.createProductStorageName(mParticle.workspaceToken));
    }
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXBpQ2xpZW50LmpzIiwic3JjL2NvbnNlbnQuanMiLCJzcmMvY29uc3RhbnRzLmpzIiwic3JjL2Nvb2tpZVN5bmNNYW5hZ2VyLmpzIiwic3JjL2Vjb21tZXJjZS5qcyIsInNyYy9ldmVudHMuanMiLCJzcmMvZm9yd2FyZGVycy5qcyIsInNyYy9mb3J3YXJkaW5nU3RhdHNVcGxvYWRlci5qcyIsInNyYy9oZWxwZXJzLmpzIiwic3JjL2lkZW50aXR5LmpzIiwic3JjL21QYXJ0aWNsZVVzZXIuanMiLCJzcmMvbWFpbi5qcyIsInNyYy9taWdyYXRpb25zLmpzIiwic3JjL21wLmpzIiwic3JjL25hdGl2ZVNka0hlbHBlcnMuanMiLCJzcmMvcGVyc2lzdGVuY2UuanMiLCJzcmMvcG9seWZpbGwuanMiLCJzcmMvc2VydmVyTW9kZWwuanMiLCJzcmMvc2Vzc2lvbk1hbmFnZXIuanMiLCJzcmMvdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdmNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25ZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0YkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdGtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNzZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25FQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2phQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3N0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgTmF0aXZlU2RrSGVscGVycyA9IHJlcXVpcmUoJy4vbmF0aXZlU2RrSGVscGVycycpLFxuICAgIEhUVFBDb2RlcyA9IENvbnN0YW50cy5IVFRQQ29kZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgU2VydmVyTW9kZWwgPSByZXF1aXJlKCcuL3NlcnZlck1vZGVsJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXM7XG5cbmZ1bmN0aW9uIHNlbmRFdmVudFRvU2VydmVyKGV2ZW50LCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSkge1xuICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTG9nRXZlbnQsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHhocixcbiAgICAgICAgICAgIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1JlY2VpdmVkICcgKyB4aHIuc3RhdHVzVGV4dCArICcgZnJvbSBzZXJ2ZXInKTtcblxuICAgICAgICAgICAgICAgICAgICBwYXJzZUV2ZW50UmVzcG9uc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZEJlZ2luKTtcblxuICAgICAgICB2YXIgdmFsaWRVc2VySWRlbnRpdGllcyA9IFtdO1xuXG4gICAgICAgIC8vIGNvbnZlcnQgdXNlcklkZW50aXRpZXMgd2hpY2ggYXJlIG9iamVjdHMgd2l0aCBrZXkgb2YgSWRlbnRpdHlUeXBlIChudW1iZXIpIGFuZCB2YWx1ZSBJRCB0byBhbiBhcnJheSBvZiBJZGVudGl0eSBvYmplY3RzIGZvciBEVE8gYW5kIGV2ZW50IGZvcndhcmRpbmdcbiAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoZXZlbnQuVXNlcklkZW50aXRpZXMpICYmIE9iamVjdC5rZXlzKGV2ZW50LlVzZXJJZGVudGl0aWVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBldmVudC5Vc2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWRlbnRpdHkgPSB7fTtcbiAgICAgICAgICAgICAgICB1c2VySWRlbnRpdHkuSWRlbnRpdHkgPSBldmVudC5Vc2VySWRlbnRpdGllc1trZXldO1xuICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0eS5UeXBlID0gSGVscGVycy5wYXJzZU51bWJlcihrZXkpO1xuICAgICAgICAgICAgICAgIHZhbGlkVXNlcklkZW50aXRpZXMucHVzaCh1c2VySWRlbnRpdHkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMgPSB2YWxpZFVzZXJJZGVudGl0aWVzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIE1QLnJlcXVpcmVEZWxheSA9IEhlbHBlcnMuaXNEZWxheWVkQnlJbnRlZ3JhdGlvbihNUC5pbnRlZ3JhdGlvbkRlbGF5cywgTVAuaW50ZWdyYXRpb25EZWxheVRpbWVvdXRTdGFydCwgRGF0ZS5ub3coKSk7XG4gICAgICAgIC8vIFdlIHF1ZXVlIGV2ZW50cyBpZiB0aGVyZSBpcyBubyBNUElEIChNUElEIGlzIG51bGwsIG9yID09PSAwKSwgb3IgdGhlcmUgYXJlIGludGVncmF0aW9ucyB0aGF0IHRoYXQgcmVxdWlyZSB0aGlzIHRvIHN0YWxsIGJlY2F1c2UgaW50ZWdyYXRpb24gYXR0cmlidXRlc1xuICAgICAgICAvLyBuZWVkIHRvIGJlIHNldCwgYW5kIHNvIHJlcXVpcmUgZGVsYXlpbmcgZXZlbnRzXG4gICAgICAgIGlmICghTVAubXBpZCB8fCBNUC5yZXF1aXJlRGVsYXkpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0V2ZW50IHdhcyBhZGRlZCB0byBldmVudFF1ZXVlLiBldmVudFF1ZXVlIHdpbGwgYmUgcHJvY2Vzc2VkIG9uY2UgYSB2YWxpZCBNUElEIGlzIHJldHVybmVkIG9yIHRoZXJlIGlzIG5vIG1vcmUgaW50ZWdyYXRpb24gaW1wb3NlZCBkZWxheS4nKTtcbiAgICAgICAgICAgIE1QLmV2ZW50UXVldWUucHVzaChldmVudCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLnByb2Nlc3NRdWV1ZWRFdmVudHMoTVAuZXZlbnRRdWV1ZSwgTVAubXBpZCwgIU1QLnJlcXVpcmVkRGVsYXksIHNlbmRFdmVudFRvU2VydmVyLCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSk7XG5cbiAgICAgICAgICAgIGlmICghZXZlbnQpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuRXZlbnRFbXB0eSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZEh0dHApO1xuXG4gICAgICAgICAgICB4aHIgPSBIZWxwZXJzLmNyZWF0ZVhIUih4aHJDYWxsYmFjayk7XG5cbiAgICAgICAgICAgIGlmICh4aHIpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIEhlbHBlcnMuY3JlYXRlU2VydmljZVVybChDb25zdGFudHMudjJTZWN1cmVTZXJ2aWNlVXJsLCBDb25zdGFudHMudjJTZXJ2aWNlVXJsLCBNUC5kZXZUb2tlbikgKyAnL0V2ZW50cycpO1xuICAgICAgICAgICAgICAgICAgICB4aHIuc2VuZChKU09OLnN0cmluZ2lmeShTZXJ2ZXJNb2RlbC5jb252ZXJ0RXZlbnRUb0RUTyhldmVudCwgTVAuaXNGaXJzdFJ1biwgTVAuY3VycmVuY3lDb2RlLCBNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXMpKSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50TmFtZSAhPT0gVHlwZXMuTWVzc2FnZVR5cGUuQXBwU3RhdGVUcmFuc2l0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnMoZXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHNlbmRpbmcgZXZlbnQgdG8gbVBhcnRpY2xlIHNlcnZlcnMuICcgKyBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlSZXF1ZXN0LCBtZXRob2QsIGNhbGxiYWNrLCBvcmlnaW5hbElkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKSB7XG4gICAgdmFyIHhociwgcHJldmlvdXNNUElELFxuICAgICAgICB4aHJDYWxsYmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUmVjZWl2ZWQgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgIHBhcnNlSWRlbnRpdHlSZXNwb25zZSh4aHIsIHByZXZpb3VzTVBJRCwgY2FsbGJhY2ssIG9yaWdpbmFsSWRlbnRpdHlBcGlEYXRhLCBtZXRob2QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRJZGVudGl0eUJlZ2luKTtcblxuICAgIGlmICghaWRlbnRpdHlBcGlSZXF1ZXN0KSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5BUElSZXF1ZXN0RW1wdHkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRJZGVudGl0eUh0dHApO1xuICAgIHhociA9IEhlbHBlcnMuY3JlYXRlWEhSKHhockNhbGxiYWNrKTtcblxuICAgIGlmICh4aHIpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChNUC5pZGVudGl0eUNhbGxJbkZsaWdodCkge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHtodHRwQ29kZTogSFRUUENvZGVzLmFjdGl2ZUlkZW50aXR5UmVxdWVzdCwgYm9keTogJ1RoZXJlIGlzIGN1cnJlbnRseSBhbiBBSkFYIHJlcXVlc3QgcHJvY2Vzc2luZy4gUGxlYXNlIHdhaXQgZm9yIHRoaXMgdG8gcmV0dXJuIGJlZm9yZSByZXF1ZXN0aW5nIGFnYWluJ30pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBwcmV2aW91c01QSUQgPSAoIU1QLmlzRmlyc3RSdW4gJiYgTVAubXBpZCkgPyBNUC5tcGlkIDogbnVsbDtcbiAgICAgICAgICAgICAgICBpZiAobWV0aG9kID09PSAnbW9kaWZ5Jykge1xuICAgICAgICAgICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIENvbnN0YW50cy5pZGVudGl0eVVybCArIE1QLm1waWQgKyAnLycgKyBtZXRob2QpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHhoci5vcGVuKCdwb3N0JywgQ29uc3RhbnRzLmlkZW50aXR5VXJsICsgbWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ3gtbXAta2V5JywgTVAuZGV2VG9rZW4pO1xuICAgICAgICAgICAgICAgIE1QLmlkZW50aXR5Q2FsbEluRmxpZ2h0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB4aHIuc2VuZChKU09OLnN0cmluZ2lmeShpZGVudGl0eUFwaVJlcXVlc3QpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQgPSBmYWxzZTtcbiAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy5ub0h0dHBDb3ZlcmFnZSwgZSk7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGlkZW50aXR5IHJlcXVlc3QgdG8gc2VydmVycyB3aXRoIHN0YXR1cyBjb2RlICcgKyB4aHIuc3RhdHVzICsgJyAtICcgKyBlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VuZEJhdGNoRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXIoZm9yd2FyZGluZ1N0YXRzRGF0YSwgeGhyKSB7XG4gICAgdmFyIHVybCwgZGF0YTtcbiAgICB0cnkge1xuICAgICAgICB1cmwgPSBIZWxwZXJzLmNyZWF0ZVNlcnZpY2VVcmwoQ29uc3RhbnRzLnYyU2VjdXJlU2VydmljZVVybCwgQ29uc3RhbnRzLnYyU2VydmljZVVybCwgTVAuZGV2VG9rZW4pO1xuICAgICAgICBkYXRhID0ge1xuICAgICAgICAgICAgdXVpZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICBkYXRhOiBmb3J3YXJkaW5nU3RhdHNEYXRhXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHhocikge1xuICAgICAgICAgICAgeGhyLm9wZW4oJ3Bvc3QnLCB1cmwgKyAnL0ZvcndhcmRpbmcnKTtcbiAgICAgICAgICAgIHhoci5zZW5kKEpTT04uc3RyaW5naWZ5KGRhdGEpKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGZvcndhcmRpbmcgc3RhdHMgdG8gbVBhcnRpY2xlIHNlcnZlcnMuJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZW5kU2luZ2xlRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXIoZm9yd2FyZGluZ1N0YXRzRGF0YSkge1xuICAgIHZhciB1cmwsIGRhdGE7XG4gICAgdHJ5IHtcbiAgICAgICAgdmFyIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAyKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1N1Y2Nlc3NmdWxseSBzZW50ICAnICsgeGhyLnN0YXR1c1RleHQgKyAnIGZyb20gc2VydmVyJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICB2YXIgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuICAgICAgICB1cmwgPSBIZWxwZXJzLmNyZWF0ZVNlcnZpY2VVcmwoQ29uc3RhbnRzLnYxU2VjdXJlU2VydmljZVVybCwgQ29uc3RhbnRzLnYxU2VydmljZVVybCwgTVAuZGV2VG9rZW4pO1xuICAgICAgICBkYXRhID0gZm9yd2FyZGluZ1N0YXRzRGF0YTtcblxuICAgICAgICBpZiAoeGhyKSB7XG4gICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIHVybCArICcvRm9yd2FyZGluZycpO1xuICAgICAgICAgICAgeGhyLnNlbmQoSlNPTi5zdHJpbmdpZnkoZGF0YSkpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHNlbmRpbmcgZm9yd2FyZGluZyBzdGF0cyB0byBtUGFydGljbGUgc2VydmVycy4nKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHNlbmRFdmVudFRvU2VydmVyOiBzZW5kRXZlbnRUb1NlcnZlcixcbiAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0OiBzZW5kSWRlbnRpdHlSZXF1ZXN0LFxuICAgIHNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyOiBzZW5kQmF0Y2hGb3J3YXJkaW5nU3RhdHNUb1NlcnZlcixcbiAgICBzZW5kU2luZ2xlRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXI6IHNlbmRTaW5nbGVGb3J3YXJkaW5nU3RhdHNUb1NlcnZlclxufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZUdEUFJDb25zZW50KGNvbnNlbnRlZCwgdGltZXN0YW1wLCBjb25zZW50RG9jdW1lbnQsIGxvY2F0aW9uLCBoYXJkd2FyZUlkKSB7XG4gICAgaWYgKHR5cGVvZihjb25zZW50ZWQpICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ29uc2VudGVkIGJvb2xlYW4gaXMgcmVxdWlyZWQgd2hlbiBjb25zdHJ1Y3RpbmcgYSBHRFBSIENvbnNlbnQgb2JqZWN0LicpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRpbWVzdGFtcCAmJiBpc05hTih0aW1lc3RhbXApKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RpbWVzdGFtcCBtdXN0IGJlIGEgdmFsaWQgbnVtYmVyIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChjb25zZW50RG9jdW1lbnQgJiYgIXR5cGVvZihjb25zZW50RG9jdW1lbnQpID09PSAnc3RyaW5nJykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdEb2N1bWVudCBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChsb2NhdGlvbiAmJiAhdHlwZW9mKGxvY2F0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnTG9jYXRpb24gbXVzdCBiZSBhIHZhbGlkIHN0cmluZyB3aGVuIGNvbnN0cnVjdGluZyBhIEdEUFIgQ29uc2VudCBvYmplY3QuJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoaGFyZHdhcmVJZCAmJiAhdHlwZW9mKGhhcmR3YXJlSWQpID09PSAnc3RyaW5nJykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdIYXJkd2FyZSBJRCBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIENvbnNlbnRlZDogY29uc2VudGVkLFxuICAgICAgICBUaW1lc3RhbXA6IHRpbWVzdGFtcCB8fCBEYXRlLm5vdygpLFxuICAgICAgICBDb25zZW50RG9jdW1lbnQ6IGNvbnNlbnREb2N1bWVudCxcbiAgICAgICAgTG9jYXRpb246IGxvY2F0aW9uLFxuICAgICAgICBIYXJkd2FyZUlkOiBoYXJkd2FyZUlkXG4gICAgfTtcbn1cblxudmFyIENvbnNlbnRTZXJpYWxpemF0aW9uID0ge1xuICAgIHRvTWluaWZpZWRKc29uT2JqZWN0OiBmdW5jdGlvbihzdGF0ZSkge1xuICAgICAgICB2YXIganNvbk9iamVjdCA9IHt9O1xuICAgICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgICAgIHZhciBnZHByQ29uc2VudFN0YXRlID0gc3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpO1xuICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUpIHtcbiAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHIgPSB7fTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGdkcHJDb25zZW50U3RhdGUpe1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZS5oYXNPd25Qcm9wZXJ0eShwdXJwb3NlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGdkcHJDb25zZW50ID0gZ2RwckNvbnNlbnRTdGF0ZVtwdXJwb3NlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb25PYmplY3QuZ2RwcltwdXJwb3NlXSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Db25zZW50ZWQpID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0uYyA9IGdkcHJDb25zZW50LkNvbnNlbnRlZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuVGltZXN0YW1wKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0udHMgPSBnZHByQ29uc2VudC5UaW1lc3RhbXA7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLmQgPSBnZHByQ29uc2VudC5Db25zZW50RG9jdW1lbnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkxvY2F0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0ubCA9IGdkcHJDb25zZW50LkxvY2F0aW9uO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5IYXJkd2FyZUlkKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0uaCA9IGdkcHJDb25zZW50LkhhcmR3YXJlSWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGpzb25PYmplY3Q7XG4gICAgfSxcblxuICAgIGZyb21NaW5pZmllZEpzb25PYmplY3Q6IGZ1bmN0aW9uKGpzb24pIHtcbiAgICAgICAgdmFyIHN0YXRlID0gY3JlYXRlQ29uc2VudFN0YXRlKCk7XG4gICAgICAgIGlmIChqc29uLmdkcHIpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4ganNvbi5nZHByKXtcbiAgICAgICAgICAgICAgICBpZiAoanNvbi5nZHByLmhhc093blByb3BlcnR5KHB1cnBvc2UpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnZHByQ29uc2VudCA9IGNyZWF0ZUdEUFJDb25zZW50KGpzb24uZ2RwcltwdXJwb3NlXS5jLFxuICAgICAgICAgICAgICAgICAgICAgICAganNvbi5nZHByW3B1cnBvc2VdLnRzLFxuICAgICAgICAgICAgICAgICAgICAgICAganNvbi5nZHByW3B1cnBvc2VdLmQsXG4gICAgICAgICAgICAgICAgICAgICAgICBqc29uLmdkcHJbcHVycG9zZV0ubCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb24uZ2RwcltwdXJwb3NlXS5oKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVDb25zZW50U3RhdGUoY29uc2VudFN0YXRlKSB7XG4gICAgdmFyIGdkcHIgPSB7fTtcblxuICAgIGlmIChjb25zZW50U3RhdGUpIHtcbiAgICAgICAgc2V0R0RQUkNvbnNlbnRTdGF0ZShjb25zZW50U3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYW5vbmljYWxpemVGb3JEZWR1cGxpY2F0aW9uKHB1cnBvc2UpIHtcbiAgICAgICAgaWYgKHR5cGVvZihwdXJwb3NlKSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHZhciB0cmltbWVkUHVycG9zZSA9IHB1cnBvc2UudHJpbSgpO1xuICAgICAgICBpZiAoIXRyaW1tZWRQdXJwb3NlLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRyaW1tZWRQdXJwb3NlLnRvTG93ZXJDYXNlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0R0RQUkNvbnNlbnRTdGF0ZShnZHByQ29uc2VudFN0YXRlKSB7XG4gICAgICAgIGlmICghZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICAgICAgZ2RwciA9IHt9O1xuICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuaXNPYmplY3QoZ2RwckNvbnNlbnRTdGF0ZSkpIHtcbiAgICAgICAgICAgIGdkcHIgPSB7fTtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4gZ2RwckNvbnNlbnRTdGF0ZSl7XG4gICAgICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudFN0YXRlW3B1cnBvc2VdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudCkge1xuICAgICAgICB2YXIgbm9ybWFsaXplZFB1cnBvc2UgPSBjYW5vbmljYWxpemVGb3JEZWR1cGxpY2F0aW9uKHB1cnBvc2UpO1xuICAgICAgICBpZiAoIW5vcm1hbGl6ZWRQdXJwb3NlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdhZGRHRFBSQ29uc2VudFN0YXRlKCkgaW52b2tlZCB3aXRoIGJhZCBwdXJwb3NlLiBQdXJwb3NlIG11c3QgYmUgYSBzdHJpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUhlbHBlcnMuaXNPYmplY3QoZ2RwckNvbnNlbnQpKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdhZGRHRFBSQ29uc2VudFN0YXRlKCkgaW52b2tlZCB3aXRoIGJhZCBvciBlbXB0eSBHRFBSIGNvbnNlbnQgb2JqZWN0LicpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGdkcHJDb25zZW50Q29weSA9IGNyZWF0ZUdEUFJDb25zZW50KGdkcHJDb25zZW50LkNvbnNlbnRlZCwgXG4gICAgICAgICAgICAgICAgZ2RwckNvbnNlbnQuVGltZXN0YW1wLFxuICAgICAgICAgICAgICAgIGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCxcbiAgICAgICAgICAgICAgICBnZHByQ29uc2VudC5Mb2NhdGlvbixcbiAgICAgICAgICAgICAgICBnZHByQ29uc2VudC5IYXJkd2FyZUlkKTtcbiAgICAgICAgaWYgKGdkcHJDb25zZW50Q29weSkge1xuICAgICAgICAgICAgZ2Rwcltub3JtYWxpemVkUHVycG9zZV0gPSBnZHByQ29uc2VudENvcHk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVtb3ZlR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlKSB7XG4gICAgICAgIHZhciBub3JtYWxpemVkUHVycG9zZSA9IGNhbm9uaWNhbGl6ZUZvckRlZHVwbGljYXRpb24ocHVycG9zZSk7XG4gICAgICAgIGlmICghbm9ybWFsaXplZFB1cnBvc2UpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZSBnZHByW25vcm1hbGl6ZWRQdXJwb3NlXTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIEhlbHBlcnMuZXh0ZW5kKHt9LCBnZHByKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzZXRHRFBSQ29uc2VudFN0YXRlOiBzZXRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICBhZGRHRFBSQ29uc2VudFN0YXRlOiBhZGRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICBnZXRHRFBSQ29uc2VudFN0YXRlOiBnZXRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICByZW1vdmVHRFBSQ29uc2VudFN0YXRlOiByZW1vdmVHRFBSQ29uc2VudFN0YXRlXG4gICAgfTtcbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjcmVhdGVHRFBSQ29uc2VudDogY3JlYXRlR0RQUkNvbnNlbnQsXG4gICAgU2VyaWFsaXphdGlvbjogQ29uc2VudFNlcmlhbGl6YXRpb24sXG4gICAgY3JlYXRlQ29uc2VudFN0YXRlOiBjcmVhdGVDb25zZW50U3RhdGVcbn07XG4iLCJ2YXIgdjFTZXJ2aWNlVXJsID0gJ2pzc2RrLm1wYXJ0aWNsZS5jb20vdjEvSlMvJyxcbiAgICB2MVNlY3VyZVNlcnZpY2VVcmwgPSAnanNzZGtzLm1wYXJ0aWNsZS5jb20vdjEvSlMvJyxcbiAgICB2MlNlcnZpY2VVcmwgPSAnanNzZGsubXBhcnRpY2xlLmNvbS92Mi9KUy8nLFxuICAgIHYyU2VjdXJlU2VydmljZVVybCA9ICdqc3Nka3MubXBhcnRpY2xlLmNvbS92Mi9KUy8nLFxuICAgIGlkZW50aXR5VXJsID0gJ2h0dHBzOi8vaWRlbnRpdHkubXBhcnRpY2xlLmNvbS92MS8nLCAvL3Byb2RcbiAgICBzZGtWZXJzaW9uID0gJzIuOC43JyxcbiAgICBzZGtWZW5kb3IgPSAnbXBhcnRpY2xlJyxcbiAgICBwbGF0Zm9ybSA9ICd3ZWInLFxuICAgIE1lc3NhZ2VzID0ge1xuICAgICAgICBFcnJvck1lc3NhZ2VzOiB7XG4gICAgICAgICAgICBOb1Rva2VuOiAnQSB0b2tlbiBtdXN0IGJlIHNwZWNpZmllZC4nLFxuICAgICAgICAgICAgRXZlbnROYW1lSW52YWxpZFR5cGU6ICdFdmVudCBuYW1lIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgdmFsdWUuJyxcbiAgICAgICAgICAgIEV2ZW50RGF0YUludmFsaWRUeXBlOiAnRXZlbnQgZGF0YSBtdXN0IGJlIGEgdmFsaWQgb2JqZWN0IGhhc2guJyxcbiAgICAgICAgICAgIExvZ2dpbmdEaXNhYmxlZDogJ0V2ZW50IGxvZ2dpbmcgaXMgY3VycmVudGx5IGRpc2FibGVkLicsXG4gICAgICAgICAgICBDb29raWVQYXJzZUVycm9yOiAnQ291bGQgbm90IHBhcnNlIGNvb2tpZScsXG4gICAgICAgICAgICBFdmVudEVtcHR5OiAnRXZlbnQgb2JqZWN0IGlzIG51bGwgb3IgdW5kZWZpbmVkLCBjYW5jZWxsaW5nIHNlbmQnLFxuICAgICAgICAgICAgQVBJUmVxdWVzdEVtcHR5OiAnQVBJUmVxdWVzdCBpcyBudWxsIG9yIHVuZGVmaW5lZCwgY2FuY2VsbGluZyBzZW5kJyxcbiAgICAgICAgICAgIE5vRXZlbnRUeXBlOiAnRXZlbnQgdHlwZSBtdXN0IGJlIHNwZWNpZmllZC4nLFxuICAgICAgICAgICAgVHJhbnNhY3Rpb25JZFJlcXVpcmVkOiAnVHJhbnNhY3Rpb24gSUQgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgVHJhbnNhY3Rpb25SZXF1aXJlZDogJ0EgdHJhbnNhY3Rpb24gYXR0cmlidXRlcyBvYmplY3QgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgUHJvbW90aW9uSWRSZXF1aXJlZDogJ1Byb21vdGlvbiBJRCBpcyByZXF1aXJlZCcsXG4gICAgICAgICAgICBCYWRBdHRyaWJ1dGU6ICdBdHRyaWJ1dGUgdmFsdWUgY2Fubm90IGJlIG9iamVjdCBvciBhcnJheScsXG4gICAgICAgICAgICBCYWRLZXk6ICdLZXkgdmFsdWUgY2Fubm90IGJlIG9iamVjdCBvciBhcnJheScsXG4gICAgICAgICAgICBCYWRMb2dQdXJjaGFzZTogJ1RyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgYW5kIGEgcHJvZHVjdCBhcmUgYm90aCByZXF1aXJlZCB0byBsb2cgYSBwdXJjaGFzZSwgaHR0cHM6Ly9kb2NzLm1wYXJ0aWNsZS5jb20vP2phdmFzY3JpcHQjbWVhc3VyaW5nLXRyYW5zYWN0aW9ucydcbiAgICAgICAgfSxcbiAgICAgICAgSW5mb3JtYXRpb25NZXNzYWdlczoge1xuICAgICAgICAgICAgQ29va2llU2VhcmNoOiAnU2VhcmNoaW5nIGZvciBjb29raWUnLFxuICAgICAgICAgICAgQ29va2llRm91bmQ6ICdDb29raWUgZm91bmQsIHBhcnNpbmcgdmFsdWVzJyxcbiAgICAgICAgICAgIENvb2tpZU5vdEZvdW5kOiAnQ29va2llcyBub3QgZm91bmQnLFxuICAgICAgICAgICAgQ29va2llU2V0OiAnU2V0dGluZyBjb29raWUnLFxuICAgICAgICAgICAgQ29va2llU3luYzogJ1BlcmZvcm1pbmcgY29va2llIHN5bmMnLFxuICAgICAgICAgICAgU2VuZEJlZ2luOiAnU3RhcnRpbmcgdG8gc2VuZCBldmVudCcsXG4gICAgICAgICAgICBTZW5kSWRlbnRpdHlCZWdpbjogJ1N0YXJ0aW5nIHRvIHNlbmQgZXZlbnQgdG8gaWRlbnRpdHkgc2VydmVyJyxcbiAgICAgICAgICAgIFNlbmRXaW5kb3dzUGhvbmU6ICdTZW5kaW5nIGV2ZW50IHRvIFdpbmRvd3MgUGhvbmUgY29udGFpbmVyJyxcbiAgICAgICAgICAgIFNlbmRJT1M6ICdDYWxsaW5nIGlPUyBwYXRoOiAnLFxuICAgICAgICAgICAgU2VuZEFuZHJvaWQ6ICdDYWxsaW5nIEFuZHJvaWQgSlMgaW50ZXJmYWNlIG1ldGhvZDogJyxcbiAgICAgICAgICAgIFNlbmRIdHRwOiAnU2VuZGluZyBldmVudCB0byBtUGFydGljbGUgSFRUUCBzZXJ2aWNlJyxcbiAgICAgICAgICAgIFNlbmRJZGVudGl0eUh0dHA6ICdTZW5kaW5nIGV2ZW50IHRvIG1QYXJ0aWNsZSBIVFRQIHNlcnZpY2UnLFxuICAgICAgICAgICAgU3RhcnRpbmdOZXdTZXNzaW9uOiAnU3RhcnRpbmcgbmV3IFNlc3Npb24nLFxuICAgICAgICAgICAgU3RhcnRpbmdMb2dFdmVudDogJ1N0YXJ0aW5nIHRvIGxvZyBldmVudCcsXG4gICAgICAgICAgICBTdGFydGluZ0xvZ09wdE91dDogJ1N0YXJ0aW5nIHRvIGxvZyB1c2VyIG9wdCBpbi9vdXQnLFxuICAgICAgICAgICAgU3RhcnRpbmdFbmRTZXNzaW9uOiAnU3RhcnRpbmcgdG8gZW5kIHNlc3Npb24nLFxuICAgICAgICAgICAgU3RhcnRpbmdJbml0aWFsaXphdGlvbjogJ1N0YXJ0aW5nIHRvIGluaXRpYWxpemUnLFxuICAgICAgICAgICAgU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50OiAnU3RhcnRpbmcgdG8gbG9nIGNvbW1lcmNlIGV2ZW50JyxcbiAgICAgICAgICAgIExvYWRpbmdDb25maWc6ICdMb2FkaW5nIGNvbmZpZ3VyYXRpb24gb3B0aW9ucycsXG4gICAgICAgICAgICBBYmFuZG9uTG9nRXZlbnQ6ICdDYW5ub3QgbG9nIGV2ZW50LCBsb2dnaW5nIGRpc2FibGVkIG9yIGRldmVsb3BlciB0b2tlbiBub3Qgc2V0JyxcbiAgICAgICAgICAgIEFiYW5kb25TdGFydFNlc3Npb246ICdDYW5ub3Qgc3RhcnQgc2Vzc2lvbiwgbG9nZ2luZyBkaXNhYmxlZCBvciBkZXZlbG9wZXIgdG9rZW4gbm90IHNldCcsXG4gICAgICAgICAgICBBYmFuZG9uRW5kU2Vzc2lvbjogJ0Nhbm5vdCBlbmQgc2Vzc2lvbiwgbG9nZ2luZyBkaXNhYmxlZCBvciBkZXZlbG9wZXIgdG9rZW4gbm90IHNldCcsXG4gICAgICAgICAgICBOb1Nlc3Npb25Ub0VuZDogJ0Nhbm5vdCBlbmQgc2Vzc2lvbiwgbm8gYWN0aXZlIHNlc3Npb24gZm91bmQnXG4gICAgICAgIH0sXG4gICAgICAgIFZhbGlkYXRpb25NZXNzYWdlczoge1xuICAgICAgICAgICAgTW9kaWZ5SWRlbnRpdHlSZXF1ZXN0VXNlcklkZW50aXRpZXNQcmVzZW50OiAnaWRlbnRpdHlSZXF1ZXN0cyB0byBtb2RpZnkgcmVxdWlyZSB1c2VySWRlbnRpdGllcyB0byBiZSBwcmVzZW50LiBSZXF1ZXN0IG5vdCBzZW50IHRvIHNlcnZlci4gUGxlYXNlIGZpeCBhbmQgdHJ5IGFnYWluJyxcbiAgICAgICAgICAgIElkZW50aXR5UmVxdWVzZXRJbnZhbGlkS2V5OiAnVGhlcmUgaXMgYW4gaW52YWxpZCBrZXkgb24geW91ciBpZGVudGl0eVJlcXVlc3Qgb2JqZWN0LiBJdCBjYW4gb25seSBjb250YWluIGEgYHVzZXJJZGVudGl0aWVzYCBvYmplY3QgYW5kIGEgYG9uVXNlckFsaWFzYCBmdW5jdGlvbi4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgT25Vc2VyQWxpYXNUeXBlOiAnVGhlIG9uVXNlckFsaWFzIHZhbHVlIG11c3QgYmUgYSBmdW5jdGlvbi4gVGhlIG9uVXNlckFsaWFzIHByb3ZpZGVkIGlzIG9mIHR5cGUnLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXM6ICdUaGUgdXNlcklkZW50aXRpZXMga2V5IG11c3QgYmUgYW4gb2JqZWN0IHdpdGgga2V5cyBvZiBpZGVudGl0eVR5cGVzIGFuZCB2YWx1ZXMgb2Ygc3RyaW5ncy4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXNJbnZhbGlkS2V5OiAnVGhlcmUgaXMgYW4gaW52YWxpZCBpZGVudGl0eSBrZXkgb24geW91ciBgdXNlcklkZW50aXRpZXNgIG9iamVjdCB3aXRoaW4gdGhlIGlkZW50aXR5UmVxdWVzdC4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXNJbnZhbGlkVmFsdWVzOiAnQWxsIHVzZXIgaWRlbnRpdHkgdmFsdWVzIG11c3QgYmUgc3RyaW5ncyBvciBudWxsLiBSZXF1ZXN0IG5vdCBzZW50IHRvIHNlcnZlci4gUGxlYXNlIGZpeCBhbmQgdHJ5IGFnYWluLidcblxuICAgICAgICB9XG4gICAgfSxcbiAgICBOYXRpdmVTZGtQYXRocyA9IHtcbiAgICAgICAgTG9nRXZlbnQ6ICdsb2dFdmVudCcsXG4gICAgICAgIFNldFVzZXJUYWc6ICdzZXRVc2VyVGFnJyxcbiAgICAgICAgUmVtb3ZlVXNlclRhZzogJ3JlbW92ZVVzZXJUYWcnLFxuICAgICAgICBTZXRVc2VyQXR0cmlidXRlOiAnc2V0VXNlckF0dHJpYnV0ZScsXG4gICAgICAgIFJlbW92ZVVzZXJBdHRyaWJ1dGU6ICdyZW1vdmVVc2VyQXR0cmlidXRlJyxcbiAgICAgICAgU2V0U2Vzc2lvbkF0dHJpYnV0ZTogJ3NldFNlc3Npb25BdHRyaWJ1dGUnLFxuICAgICAgICBBZGRUb0NhcnQ6ICdhZGRUb0NhcnQnLFxuICAgICAgICBSZW1vdmVGcm9tQ2FydDogJ3JlbW92ZUZyb21DYXJ0JyxcbiAgICAgICAgQ2xlYXJDYXJ0OiAnY2xlYXJDYXJ0JyxcbiAgICAgICAgTG9nT3V0OiAnbG9nT3V0JyxcbiAgICAgICAgU2V0VXNlckF0dHJpYnV0ZUxpc3Q6ICdzZXRVc2VyQXR0cmlidXRlTGlzdCcsXG4gICAgICAgIFJlbW92ZUFsbFVzZXJBdHRyaWJ1dGVzOiAncmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICBHZXRVc2VyQXR0cmlidXRlc0xpc3RzOiAnZ2V0VXNlckF0dHJpYnV0ZXNMaXN0cycsXG4gICAgICAgIEdldEFsbFVzZXJBdHRyaWJ1dGVzOiAnZ2V0QWxsVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICBJZGVudGlmeTogJ2lkZW50aWZ5JyxcbiAgICAgICAgTG9nb3V0OiAnbG9nb3V0JyxcbiAgICAgICAgTG9naW46ICdsb2dpbicsXG4gICAgICAgIE1vZGlmeTogJ21vZGlmeSdcbiAgICB9LFxuICAgIERlZmF1bHRDb25maWcgPSB7XG4gICAgICAgIExvY2FsU3RvcmFnZU5hbWU6ICdtcHJ0Y2wtYXBpJywgICAgICAgICAgICAgLy8gTmFtZSBvZiB0aGUgbVAgbG9jYWxzdG9yYWdlLCBoYWQgY3AgYW5kIHBiIGV2ZW4gaWYgY29va2llcyB3ZXJlIHVzZWQsIHNraXBwZWQgdjJcbiAgICAgICAgTG9jYWxTdG9yYWdlTmFtZVYzOiAnbXBydGNsLXYzJywgICAgICAgICAgICAvLyB2MyBOYW1lIG9mIHRoZSBtUCBsb2NhbHN0b3JhZ2UsIGZpbmFsIHZlcnNpb24gb24gU0RLdjFcbiAgICAgICAgTG9jYWxTdG9yYWdlTmFtZVY0OiAnbXBydGNsLXY0JywgICAgICAgICAgICAvLyB2NCBOYW1lIG9mIHRoZSBtUCBsb2NhbHN0b3JhZ2UsIEN1cnJlbnQgVmVyc2lvblxuICAgICAgICBMb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0OiAnbXBydGNsLXByb2R2NCcsICAgIC8vIFRoZSBuYW1lIGZvciBtUCBsb2NhbHN0b3JhZ2UgdGhhdCBjb250YWlucyBwcm9kdWN0cyBmb3IgY2FydFByb2R1Y3MgYW5kIHByb2R1Y3RCYWdzXG4gICAgICAgIENvb2tpZU5hbWU6ICdtcHJ0Y2wtYXBpJywgICAgICAgICAgICAgICAgICAgLy8gdjEgTmFtZSBvZiB0aGUgY29va2llIHN0b3JlZCBvbiB0aGUgdXNlcidzIG1hY2hpbmVcbiAgICAgICAgQ29va2llTmFtZVYyOiAnbXBydGNsLXYyJywgICAgICAgICAgICAgICAgICAvLyB2MiBOYW1lIG9mIHRoZSBjb29raWUgc3RvcmVkIG9uIHRoZSB1c2VyJ3MgbWFjaGluZS4gUmVtb3ZlZCBrZXlzIHdpdGggbm8gdmFsdWVzLCBtb3ZlZCBjYXJ0UHJvZHVjdHMgYW5kIHByb2R1Y3RCYWdzIHRvIGxvY2FsU3RvcmFnZS5cbiAgICAgICAgQ29va2llTmFtZVYzOiAnbXBydGNsLXYzJywgICAgICAgICAgICAgICAgICAvLyB2MyBOYW1lIG9mIHRoZSBjb29raWUgc3RvcmVkIG9uIHRoZSB1c2VyJ3MgbWFjaGluZS4gQmFzZTY0IGVuY29kZWQga2V5cyBpbiBCYXNlNjRDb29raWVLZXlzIG9iamVjdCwgZmluYWwgdmVyc2lvbiBvbiBTREt2MVxuICAgICAgICBDb29raWVOYW1lVjQ6ICdtcHJ0Y2wtdjQnLCAgICAgICAgICAgICAgICAgIC8vIHY0IE5hbWUgb2YgdGhlIGNvb2tpZSBzdG9yZWQgb24gdGhlIHVzZXIncyBtYWNoaW5lLiBCYXNlNjQgZW5jb2RlZCBrZXlzIGluIEJhc2U2NENvb2tpZUtleXMgb2JqZWN0LCBjdXJyZW50IHZlcnNpb24gb24gU0RLIHYyXG4gICAgICAgIEN1cnJlbnRTdG9yYWdlTmFtZTogJ21wcnRjbC12NCcsXG4gICAgICAgIEN1cnJlbnRTdG9yYWdlUHJvZHVjdHNOYW1lOiAnbXBydGNsLXByb2R2NCcsXG4gICAgICAgIENvb2tpZURvbWFpbjogbnVsbCwgXHRcdFx0ICAgICAgICAgICAgLy8gSWYgbnVsbCwgZGVmYXVsdHMgdG8gY3VycmVudCBsb2NhdGlvbi5ob3N0XG4gICAgICAgIERlYnVnOiBmYWxzZSxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gSWYgdHJ1ZSwgd2lsbCBwcmludCBkZWJ1ZyBtZXNzYWdlcyB0byBicm93c2VyIGNvbnNvbGVcbiAgICAgICAgQ29va2llRXhwaXJhdGlvbjogMzY1LFx0XHRcdCAgICAgICAgICAgIC8vIENvb2tpZSBleHBpcmF0aW9uIHRpbWUgaW4gZGF5c1xuICAgICAgICBMb2dMZXZlbDogbnVsbCxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gV2hhdCBsb2dnaW5nIHdpbGwgYmUgcHJvdmlkZWQgaW4gdGhlIGNvbnNvbGVcbiAgICAgICAgSW5jbHVkZVJlZmVycmVyOiB0cnVlLFx0XHRcdCAgICAgICAgICAgIC8vIEluY2x1ZGUgdXNlcidzIHJlZmVycmVyXG4gICAgICAgIEluY2x1ZGVHb29nbGVBZHdvcmRzOiB0cnVlLFx0XHQgICAgICAgICAgICAvLyBJbmNsdWRlIHV0bV9zb3VyY2UgYW5kIHV0bV9wcm9wZXJ0aWVzXG4gICAgICAgIFRpbWVvdXQ6IDMwMCxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gVGltZW91dCBpbiBtaWxsaXNlY29uZHMgZm9yIGxvZ2dpbmcgZnVuY3Rpb25zXG4gICAgICAgIFNlc3Npb25UaW1lb3V0OiAzMCxcdFx0XHRcdCAgICAgICAgICAgIC8vIFNlc3Npb24gdGltZW91dCBpbiBtaW51dGVzXG4gICAgICAgIFNhbmRib3g6IGZhbHNlLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXZlbnRzIGFyZSBtYXJrZWQgYXMgZGVidWcgYW5kIG9ubHkgZm9yd2FyZGVkIHRvIGRlYnVnIGZvcndhcmRlcnMsXG4gICAgICAgIFZlcnNpb246IG51bGwsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIHZlcnNpb24gb2YgdGhpcyB3ZWJzaXRlL2FwcFxuICAgICAgICBNYXhQcm9kdWN0czogMjAsICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE51bWJlciBvZiBwcm9kdWN0cyBwZXJzaXN0ZWQgaW4gY2FydFByb2R1Y3RzIGFuZCBwcm9kdWN0QmFnc1xuICAgICAgICBGb3J3YXJkZXJTdGF0c1RpbWVvdXQ6IDUwMDAsICAgICAgICAgICAgICAgIC8vIE1pbGxpc2Vjb25kcyBmb3IgZm9yd2FyZGVyU3RhdHMgdGltZW91dFxuICAgICAgICBJbnRlZ3JhdGlvbkRlbGF5VGltZW91dDogNTAwMCwgICAgICAgICAgICAgIC8vIE1pbGxpc2Vjb25kcyBmb3IgZm9yY2luZyB0aGUgaW50ZWdyYXRpb24gZGVsYXkgdG8gdW4tc3VzcGVuZCBldmVudCBxdWV1ZWluZyBkdWUgdG8gaW50ZWdyYXRpb24gcGFydG5lciBlcnJvcnNcbiAgICAgICAgTWF4Q29va2llU2l6ZTogMzAwMCAgICAgICAgICAgICAgICAgICAgICAgICAvLyBOdW1iZXIgb2YgYnl0ZXMgZm9yIGNvb2tpZSBzaXplIHRvIG5vdCBleGNlZWRcbiAgICB9LFxuICAgIEJhc2U2NENvb2tpZUtleXMgPSB7XG4gICAgICAgIGNzbTogMSxcbiAgICAgICAgc2E6IDEsXG4gICAgICAgIHNzOiAxLFxuICAgICAgICB1YTogMSxcbiAgICAgICAgdWk6IDEsXG4gICAgICAgIGNzZDogMSxcbiAgICAgICAgaWE6IDEsXG4gICAgICAgIGNvbjogMVxuICAgIH0sXG4gICAgU0RLdjJOb25NUElEQ29va2llS2V5cyA9IHtcbiAgICAgICAgZ3M6IDEsXG4gICAgICAgIGN1OiAxLFxuICAgICAgICBsOiAxLFxuICAgICAgICBnbG9iYWxTZXR0aW5nczogMSxcbiAgICAgICAgY3VycmVudFVzZXJNUElEOiAxXG4gICAgfSxcbiAgICBIVFRQQ29kZXMgPSB7XG4gICAgICAgIG5vSHR0cENvdmVyYWdlOiAtMSxcbiAgICAgICAgYWN0aXZlSWRlbnRpdHlSZXF1ZXN0OiAtMixcbiAgICAgICAgYWN0aXZlU2Vzc2lvbjogLTMsXG4gICAgICAgIHZhbGlkYXRpb25Jc3N1ZTogLTQsXG4gICAgICAgIG5hdGl2ZUlkZW50aXR5UmVxdWVzdDogLTUsXG4gICAgICAgIGxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleTogLTYsXG4gICAgICAgIHRvb01hbnlSZXF1ZXN0czogNDI5XG4gICAgfSxcbiAgICBGZWF0dXJlcyA9IHtcbiAgICAgICAgQmF0Y2hpbmc6ICdiYXRjaGluZydcbiAgICB9O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICB2MVNlcnZpY2VVcmw6IHYxU2VydmljZVVybCxcbiAgICB2MVNlY3VyZVNlcnZpY2VVcmw6IHYxU2VjdXJlU2VydmljZVVybCxcbiAgICB2MlNlcnZpY2VVcmw6IHYyU2VydmljZVVybCxcbiAgICB2MlNlY3VyZVNlcnZpY2VVcmw6IHYyU2VjdXJlU2VydmljZVVybCxcbiAgICBpZGVudGl0eVVybDogaWRlbnRpdHlVcmwsXG4gICAgc2RrVmVyc2lvbjogc2RrVmVyc2lvbixcbiAgICBzZGtWZW5kb3I6IHNka1ZlbmRvcixcbiAgICBwbGF0Zm9ybTogcGxhdGZvcm0sXG4gICAgTWVzc2FnZXM6IE1lc3NhZ2VzLFxuICAgIE5hdGl2ZVNka1BhdGhzOiBOYXRpdmVTZGtQYXRocyxcbiAgICBEZWZhdWx0Q29uZmlnOiBEZWZhdWx0Q29uZmlnLFxuICAgIEJhc2U2NENvb2tpZUtleXM6QmFzZTY0Q29va2llS2V5cyxcbiAgICBIVFRQQ29kZXM6IEhUVFBDb2RlcyxcbiAgICBGZWF0dXJlczogRmVhdHVyZXMsXG4gICAgU0RLdjJOb25NUElEQ29va2llS2V5czogU0RLdjJOb25NUElEQ29va2llS2V5c1xufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKTtcblxudmFyIGNvb2tpZVN5bmNNYW5hZ2VyID0ge1xuICAgIGF0dGVtcHRDb29raWVTeW5jOiBmdW5jdGlvbihwcmV2aW91c01QSUQsIG1waWQpIHtcbiAgICAgICAgdmFyIHBpeGVsQ29uZmlnLCBsYXN0U3luY0RhdGVGb3JNb2R1bGUsIHVybCwgcmVkaXJlY3QsIHVybFdpdGhSZWRpcmVjdDtcbiAgICAgICAgaWYgKG1waWQgJiYgIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICBNUC5waXhlbENvbmZpZ3VyYXRpb25zLmZvckVhY2goZnVuY3Rpb24ocGl4ZWxTZXR0aW5ncykge1xuICAgICAgICAgICAgICAgIHBpeGVsQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICBtb2R1bGVJZDogcGl4ZWxTZXR0aW5ncy5tb2R1bGVJZCxcbiAgICAgICAgICAgICAgICAgICAgZnJlcXVlbmN5Q2FwOiBwaXhlbFNldHRpbmdzLmZyZXF1ZW5jeUNhcCxcbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxVcmw6IGNvb2tpZVN5bmNNYW5hZ2VyLnJlcGxhY2VBbXAocGl4ZWxTZXR0aW5ncy5waXhlbFVybCksXG4gICAgICAgICAgICAgICAgICAgIHJlZGlyZWN0VXJsOiBwaXhlbFNldHRpbmdzLnJlZGlyZWN0VXJsID8gY29va2llU3luY01hbmFnZXIucmVwbGFjZUFtcChwaXhlbFNldHRpbmdzLnJlZGlyZWN0VXJsKSA6IG51bGxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgdXJsID0gY29va2llU3luY01hbmFnZXIucmVwbGFjZU1QSUQocGl4ZWxDb25maWcucGl4ZWxVcmwsIG1waWQpO1xuICAgICAgICAgICAgICAgIHJlZGlyZWN0ID0gcGl4ZWxDb25maWcucmVkaXJlY3RVcmwgPyBjb29raWVTeW5jTWFuYWdlci5yZXBsYWNlTVBJRChwaXhlbENvbmZpZy5yZWRpcmVjdFVybCwgbXBpZCkgOiAnJztcbiAgICAgICAgICAgICAgICB1cmxXaXRoUmVkaXJlY3QgPSB1cmwgKyBlbmNvZGVVUklDb21wb25lbnQocmVkaXJlY3QpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHByZXZpb3VzTVBJRCAmJiBwcmV2aW91c01QSUQgIT09IG1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llU3luY01hbmFnZXIucGVyZm9ybUNvb2tpZVN5bmModXJsV2l0aFJlZGlyZWN0LCBwaXhlbENvbmZpZy5tb2R1bGVJZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBsYXN0U3luY0RhdGVGb3JNb2R1bGUgPSBNUC5jb29raWVTeW5jRGF0ZXNbKHBpeGVsQ29uZmlnLm1vZHVsZUlkKS50b1N0cmluZygpXSA/IE1QLmNvb2tpZVN5bmNEYXRlc1socGl4ZWxDb25maWcubW9kdWxlSWQpLnRvU3RyaW5nKCldIDogbnVsbDtcblxuICAgICAgICAgICAgICAgICAgICBpZiAobGFzdFN5bmNEYXRlRm9yTW9kdWxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayB0byBzZWUgaWYgd2UgbmVlZCB0byByZWZyZXNoIGNvb2tpZVN5bmNcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgobmV3IERhdGUoKSkuZ2V0VGltZSgpID4gKG5ldyBEYXRlKGxhc3RTeW5jRGF0ZUZvck1vZHVsZSkuZ2V0VGltZSgpICsgKHBpeGVsQ29uZmlnLmZyZXF1ZW5jeUNhcCAqIDYwICogMTAwMCAqIDYwICogMjQpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyLnBlcmZvcm1Db29raWVTeW5jKHVybFdpdGhSZWRpcmVjdCwgcGl4ZWxDb25maWcubW9kdWxlSWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llU3luY01hbmFnZXIucGVyZm9ybUNvb2tpZVN5bmModXJsV2l0aFJlZGlyZWN0LCBwaXhlbENvbmZpZy5tb2R1bGVJZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBwZXJmb3JtQ29va2llU3luYzogZnVuY3Rpb24odXJsLCBtb2R1bGVJZCkge1xuICAgICAgICB2YXIgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7XG5cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVN5bmMpO1xuXG4gICAgICAgIGltZy5zcmMgPSB1cmw7XG4gICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlc1ttb2R1bGVJZC50b1N0cmluZygpXSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XG4gICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgIH0sXG5cbiAgICByZXBsYWNlTVBJRDogZnVuY3Rpb24oc3RyaW5nLCBtcGlkKSB7XG4gICAgICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgnJSVtcGlkJSUnLCBtcGlkKTtcbiAgICB9LFxuXG4gICAgcmVwbGFjZUFtcDogZnVuY3Rpb24oc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvJmFtcDsvZywgJyYnKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvb2tpZVN5bmNNYW5hZ2VyO1xuIiwidmFyIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBWYWxpZGF0b3JzID0gSGVscGVycy5WYWxpZGF0b3JzLFxuICAgIE1lc3NhZ2VzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKS5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBTZXJ2ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2VydmVyTW9kZWwnKTtcblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9uQXR0cmlidXRlc1RvUHJvZHVjdEFjdGlvbih0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3RBY3Rpb24pIHtcbiAgICBwcm9kdWN0QWN0aW9uLlRyYW5zYWN0aW9uSWQgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuSWQ7XG4gICAgcHJvZHVjdEFjdGlvbi5BZmZpbGlhdGlvbiA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5BZmZpbGlhdGlvbjtcbiAgICBwcm9kdWN0QWN0aW9uLkNvdXBvbkNvZGUgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuQ291cG9uQ29kZTtcbiAgICBwcm9kdWN0QWN0aW9uLlRvdGFsQW1vdW50ID0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzLlJldmVudWU7XG4gICAgcHJvZHVjdEFjdGlvbi5TaGlwcGluZ0Ftb3VudCA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5TaGlwcGluZztcbiAgICBwcm9kdWN0QWN0aW9uLlRheEFtb3VudCA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5UYXg7XG59XG5cbmZ1bmN0aW9uIGdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUocHJvZHVjdEFjdGlvblR5cGUpIHtcbiAgICBzd2l0Y2ggKHByb2R1Y3RBY3Rpb25UeXBlKSB7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdBZGRUb0NhcnQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ0FkZFRvV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dCc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICByZXR1cm4gJ0NoZWNrb3V0T3B0aW9uJztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnQ2xpY2snO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlOlxuICAgICAgICAgICAgcmV0dXJuICdQdXJjaGFzZSc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kOlxuICAgICAgICAgICAgcmV0dXJuICdSZWZ1bmQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmVGcm9tQ2FydCc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbVdpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmVGcm9tV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gJ1ZpZXdEZXRhaWwnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlVua25vd246XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ1Vua25vd24nO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0UHJvbW90aW9uQWN0aW9uRXZlbnROYW1lKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICBzd2l0Y2ggKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb25DbGljayc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb25WaWV3JztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlKHByb2R1Y3RBY3Rpb25UeXBlKSB7XG4gICAgc3dpdGNoIChwcm9kdWN0QWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydDpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0QWRkVG9DYXJ0O1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEFkZFRvV2lzaGxpc3Q7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQ6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENoZWNrb3V0O1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0T3B0aW9uOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dE9wdGlvbjtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2xpY2s7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUHVyY2hhc2U6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFB1cmNoYXNlO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZDpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVmdW5kO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZW1vdmVGcm9tQ2FydDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlbW92ZUZyb21XaXNobGlzdDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5Vbmtub3duOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkV2ZW50VHlwZS5Vbmtub3duO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFZpZXdEZXRhaWw7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdDb3VsZCBub3QgY29udmVydCBwcm9kdWN0IGFjdGlvbiB0eXBlICcgKyBwcm9kdWN0QWN0aW9uVHlwZSArICcgdG8gZXZlbnQgdHlwZScpO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UHJvbW90aW9uQWN0aW9uVG9FdmVudFR5cGUocHJvbW90aW9uQWN0aW9uVHlwZSkge1xuICAgIHN3aXRjaCAocHJvbW90aW9uQWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvbW90aW9uQ2xpY2s7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb21vdGlvblZpZXc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdDb3VsZCBub3QgY29udmVydCBwcm9tb3Rpb24gYWN0aW9uIHR5cGUgJyArIHByb21vdGlvbkFjdGlvblR5cGUgKyAnIHRvIGV2ZW50IHR5cGUnKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoZXZlbnROYW1lLCBwbHVzT25lKSB7XG4gICAgcmV0dXJuICdlQ29tbWVyY2UgLSAnICsgZXZlbnROYW1lICsgJyAtICcgKyAocGx1c09uZSA/ICdUb3RhbCcgOiAnSXRlbScpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0UHJvZHVjdEF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvZHVjdCkge1xuICAgIGlmIChwcm9kdWN0LkNvdXBvbkNvZGUpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ291cG9uIENvZGUnXSA9IHByb2R1Y3QuQ291cG9uQ29kZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuQnJhbmQpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQnJhbmQnXSA9IHByb2R1Y3QuQnJhbmQ7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LkNhdGVnb3J5KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0NhdGVnb3J5J10gPSBwcm9kdWN0LkNhdGVnb3J5O1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5OYW1lKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ05hbWUnXSA9IHByb2R1Y3QuTmFtZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuU2t1KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0lkJ10gPSBwcm9kdWN0LlNrdTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuUHJpY2UpIHtcbiAgICAgICAgYXR0cmlidXRlc1snSXRlbSBQcmljZSddID0gcHJvZHVjdC5QcmljZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuUXVhbnRpdHkpIHtcbiAgICAgICAgYXR0cmlidXRlc1snUXVhbnRpdHknXSA9IHByb2R1Y3QuUXVhbnRpdHk7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LlBvc2l0aW9uKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Bvc2l0aW9uJ10gPSBwcm9kdWN0LlBvc2l0aW9uO1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5WYXJpYW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1ZhcmlhbnQnXSA9IHByb2R1Y3QuVmFyaWFudDtcbiAgICB9XG4gICAgYXR0cmlidXRlc1snVG90YWwgUHJvZHVjdCBBbW91bnQnXSA9IHByb2R1Y3QuVG90YWxBbW91bnQgfHwgMDtcblxufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25JZChhdHRyaWJ1dGVzLCBwcm9kdWN0QWN0aW9uKSB7XG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uVHJhbnNhY3Rpb25JZCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydUcmFuc2FjdGlvbiBJZCddID0gcHJvZHVjdEFjdGlvbi5UcmFuc2FjdGlvbklkO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvZHVjdEFjdGlvbikge1xuICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkKGF0dHJpYnV0ZXMsIHByb2R1Y3RBY3Rpb24pO1xuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb24pIHtcbiAgICAgICAgYXR0cmlidXRlc1snQWZmaWxpYXRpb24nXSA9IHByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb247XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uQ291cG9uQ29kZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydDb3Vwb24gQ29kZSddID0gcHJvZHVjdEFjdGlvbi5Db3Vwb25Db2RlO1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLlRvdGFsQW1vdW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1RvdGFsIEFtb3VudCddID0gcHJvZHVjdEFjdGlvbi5Ub3RhbEFtb3VudDtcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5TaGlwcGluZ0Ftb3VudCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydTaGlwcGluZyBBbW91bnQnXSA9IHByb2R1Y3RBY3Rpb24uU2hpcHBpbmdBbW91bnQ7XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uVGF4QW1vdW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1RheCBBbW91bnQnXSA9IHByb2R1Y3RBY3Rpb24uVGF4QW1vdW50O1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLkNoZWNrb3V0T3B0aW9ucykge1xuICAgICAgICBhdHRyaWJ1dGVzWydDaGVja291dCBPcHRpb25zJ10gPSBwcm9kdWN0QWN0aW9uLkNoZWNrb3V0T3B0aW9ucztcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5DaGVja291dFN0ZXApIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ2hlY2tvdXQgU3RlcCddID0gcHJvZHVjdEFjdGlvbi5DaGVja291dFN0ZXA7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBleHRyYWN0UHJvbW90aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9tb3Rpb24pIHtcbiAgICBpZiAocHJvbW90aW9uLklkKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0lkJ10gPSBwcm9tb3Rpb24uSWQ7XG4gICAgfVxuXG4gICAgaWYgKHByb21vdGlvbi5DcmVhdGl2ZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydDcmVhdGl2ZSddID0gcHJvbW90aW9uLkNyZWF0aXZlO1xuICAgIH1cblxuICAgIGlmIChwcm9tb3Rpb24uTmFtZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydOYW1lJ10gPSBwcm9tb3Rpb24uTmFtZTtcbiAgICB9XG5cbiAgICBpZiAocHJvbW90aW9uLlBvc2l0aW9uKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Bvc2l0aW9uJ10gPSBwcm9tb3Rpb24uUG9zaXRpb247XG4gICAgfVxufVxuXG5mdW5jdGlvbiBidWlsZFByb2R1Y3RMaXN0KGV2ZW50LCBwcm9kdWN0KSB7XG4gICAgaWYgKHByb2R1Y3QpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJvZHVjdCkpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm9kdWN0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFtwcm9kdWN0XTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXZlbnQuU2hvcHBpbmdDYXJ0LlByb2R1Y3RMaXN0O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9kdWN0KG5hbWUsXG4gICAgc2t1LFxuICAgIHByaWNlLFxuICAgIHF1YW50aXR5LFxuICAgIHZhcmlhbnQsXG4gICAgY2F0ZWdvcnksXG4gICAgYnJhbmQsXG4gICAgcG9zaXRpb24sXG4gICAgY291cG9uQ29kZSxcbiAgICBhdHRyaWJ1dGVzKSB7XG5cbiAgICBhdHRyaWJ1dGVzID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcyk7XG5cbiAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ05hbWUgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhIHByb2R1Y3QnKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFWYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoc2t1KSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTS1UgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhIHByb2R1Y3QsIGFuZCBtdXN0IGJlIGEgc3RyaW5nIG9yIGEgbnVtYmVyJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKHByaWNlKSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQcmljZSBpcyByZXF1aXJlZCB3aGVuIGNyZWF0aW5nIGEgcHJvZHVjdCwgYW5kIG11c3QgYmUgYSBzdHJpbmcgb3IgYSBudW1iZXInKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFxdWFudGl0eSkge1xuICAgICAgICBxdWFudGl0eSA9IDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgTmFtZTogbmFtZSxcbiAgICAgICAgU2t1OiBza3UsXG4gICAgICAgIFByaWNlOiBwcmljZSxcbiAgICAgICAgUXVhbnRpdHk6IHF1YW50aXR5LFxuICAgICAgICBCcmFuZDogYnJhbmQsXG4gICAgICAgIFZhcmlhbnQ6IHZhcmlhbnQsXG4gICAgICAgIENhdGVnb3J5OiBjYXRlZ29yeSxcbiAgICAgICAgUG9zaXRpb246IHBvc2l0aW9uLFxuICAgICAgICBDb3Vwb25Db2RlOiBjb3Vwb25Db2RlLFxuICAgICAgICBUb3RhbEFtb3VudDogcXVhbnRpdHkgKiBwcmljZSxcbiAgICAgICAgQXR0cmlidXRlczogYXR0cmlidXRlc1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb21vdGlvbihpZCwgY3JlYXRpdmUsIG5hbWUsIHBvc2l0aW9uKSB7XG4gICAgaWYgKCFWYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoaWQpKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5Qcm9tb3Rpb25JZFJlcXVpcmVkKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgSWQ6IGlkLFxuICAgICAgICBDcmVhdGl2ZTogY3JlYXRpdmUsXG4gICAgICAgIE5hbWU6IG5hbWUsXG4gICAgICAgIFBvc2l0aW9uOiBwb3NpdGlvblxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUltcHJlc3Npb24obmFtZSwgcHJvZHVjdCkge1xuICAgIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnTmFtZSBpcyByZXF1aXJlZCB3aGVuIGNyZWF0aW5nIGFuIGltcHJlc3Npb24uJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghcHJvZHVjdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQcm9kdWN0IGlzIHJlcXVpcmVkIHdoZW4gY3JlYXRpbmcgYW4gaW1wcmVzc2lvbi4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgTmFtZTogbmFtZSxcbiAgICAgICAgUHJvZHVjdDogcHJvZHVjdFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyhpZCxcbiAgICBhZmZpbGlhdGlvbixcbiAgICBjb3Vwb25Db2RlLFxuICAgIHJldmVudWUsXG4gICAgc2hpcHBpbmcsXG4gICAgdGF4KSB7XG5cbiAgICBpZiAoIVZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcihpZCkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLlRyYW5zYWN0aW9uSWRSZXF1aXJlZCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIElkOiBpZCxcbiAgICAgICAgQWZmaWxpYXRpb246IGFmZmlsaWF0aW9uLFxuICAgICAgICBDb3Vwb25Db2RlOiBjb3Vwb25Db2RlLFxuICAgICAgICBSZXZlbnVlOiByZXZlbnVlLFxuICAgICAgICBTaGlwcGluZzogc2hpcHBpbmcsXG4gICAgICAgIFRheDogdGF4XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvZHVjdEltcHJlc3Npb24oY29tbWVyY2VFdmVudCkge1xuICAgIHZhciBhcHBFdmVudHMgPSBbXTtcbiAgICBpZiAoIWNvbW1lcmNlRXZlbnQuUHJvZHVjdEltcHJlc3Npb25zKSB7XG4gICAgICAgIHJldHVybiBhcHBFdmVudHM7XG4gICAgfVxuICAgIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEltcHJlc3Npb25zLmZvckVhY2goZnVuY3Rpb24ocHJvZHVjdEltcHJlc3Npb24pIHtcbiAgICAgICAgaWYgKHByb2R1Y3RJbXByZXNzaW9uLlByb2R1Y3RMaXN0KSB7XG4gICAgICAgICAgICBwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0TGlzdC5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICB2YXIgYXR0cmlidXRlcyA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCB7fSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgICAgIGlmIChwcm9kdWN0LkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgYXR0cmlidXRlIGluIHByb2R1Y3QuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVdID0gcHJvZHVjdC5BdHRyaWJ1dGVzW2F0dHJpYnV0ZV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3QpO1xuICAgICAgICAgICAgICAgIGlmIChwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0SW1wcmVzc2lvbkxpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1snUHJvZHVjdCBJbXByZXNzaW9uIExpc3QnXSA9IHByb2R1Y3RJbXByZXNzaW9uLlByb2R1Y3RJbXByZXNzaW9uTGlzdDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmFyIGFwcEV2ZW50ID0gU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QoVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoJ0ltcHJlc3Npb24nKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBUeXBlcy5FdmVudFR5cGUuVHJhbnNhY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBhcHBFdmVudHMucHVzaChhcHBFdmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gZXhwYW5kQ29tbWVyY2VFdmVudChldmVudCkge1xuICAgIGlmICghZXZlbnQpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiBleHBhbmRQcm9kdWN0QWN0aW9uKGV2ZW50KVxuICAgICAgICAuY29uY2F0KGV4cGFuZFByb21vdGlvbkFjdGlvbihldmVudCkpXG4gICAgICAgIC5jb25jYXQoZXhwYW5kUHJvZHVjdEltcHJlc3Npb24oZXZlbnQpKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvbW90aW9uQWN0aW9uKGNvbW1lcmNlRXZlbnQpIHtcbiAgICB2YXIgYXBwRXZlbnRzID0gW107XG4gICAgaWYgKCFjb21tZXJjZUV2ZW50LlByb21vdGlvbkFjdGlvbikge1xuICAgICAgICByZXR1cm4gYXBwRXZlbnRzO1xuICAgIH1cbiAgICB2YXIgcHJvbW90aW9ucyA9IGNvbW1lcmNlRXZlbnQuUHJvbW90aW9uQWN0aW9uLlByb21vdGlvbkxpc3Q7XG4gICAgcHJvbW90aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKHByb21vdGlvbikge1xuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCB7fSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMpO1xuICAgICAgICBleHRyYWN0UHJvbW90aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9tb3Rpb24pO1xuXG4gICAgICAgIHZhciBhcHBFdmVudCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudCxcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldEV4cGFuc2lvbk5hbWUoY29tbWVyY2VFdmVudC5Qcm9tb3Rpb25BY3Rpb24uUHJvbW90aW9uQWN0aW9uVHlwZSkpLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgVHlwZXMuRXZlbnRUeXBlLlRyYW5zYWN0aW9uXG4gICAgICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChhcHBFdmVudCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvZHVjdEFjdGlvbihjb21tZXJjZUV2ZW50KSB7XG4gICAgdmFyIGFwcEV2ZW50cyA9IFtdO1xuICAgIGlmICghY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uKSB7XG4gICAgICAgIHJldHVybiBhcHBFdmVudHM7XG4gICAgfVxuICAgIHZhciBzaG91bGRFeHRyYWN0QWN0aW9uQXR0cmlidXRlcyA9IGZhbHNlO1xuICAgIGlmIChjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUgPT09IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlIHx8XG4gICAgICAgIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSA9PT0gVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kKSB7XG4gICAgICAgIHZhciBhdHRyaWJ1dGVzID0gSGVscGVycy5leHRlbmQoZmFsc2UsIHt9LCBjb21tZXJjZUV2ZW50LkV2ZW50QXR0cmlidXRlcyk7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Byb2R1Y3QgQ291bnQnXSA9IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdCA/IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdC5sZW5ndGggOiAwO1xuICAgICAgICBleHRyYWN0QWN0aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24pO1xuICAgICAgICBpZiAoY29tbWVyY2VFdmVudC5DdXJyZW5jeUNvZGUpIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbJ0N1cnJlbmN5IENvZGUnXSA9IGNvbW1lcmNlRXZlbnQuQ3VycmVuY3lDb2RlO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwbHVzT25lRXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lKGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSksIHRydWUpLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5UcmFuc2FjdGlvblxuICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChwbHVzT25lRXZlbnQpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgc2hvdWxkRXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMgPSB0cnVlO1xuICAgIH1cblxuICAgIHZhciBwcm9kdWN0cyA9IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdDtcblxuICAgIGlmICghcHJvZHVjdHMpIHtcbiAgICAgICAgcmV0dXJuIGFwcEV2ZW50cztcbiAgICB9XG5cbiAgICBwcm9kdWN0cy5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBIZWxwZXJzLmV4dGVuZChmYWxzZSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMsIHByb2R1Y3QuQXR0cmlidXRlcyk7XG4gICAgICAgIGlmIChzaG91bGRFeHRyYWN0QWN0aW9uQXR0cmlidXRlcykge1xuICAgICAgICAgICAgZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkKGF0dHJpYnV0ZXMsIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbik7XG4gICAgICAgIH1cbiAgICAgICAgZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3QpO1xuXG4gICAgICAgIHZhciBwcm9kdWN0RXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lKGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSkpLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5UcmFuc2FjdGlvblxuICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChwcm9kdWN0RXZlbnQpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncykge1xuICAgIHZhciBiYXNlRXZlbnQ7XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50KTtcblxuICAgIGlmIChIZWxwZXJzLmNhbkxvZygpKSB7XG4gICAgICAgIGJhc2VFdmVudCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLkNvbW1lcmNlKTtcbiAgICAgICAgYmFzZUV2ZW50LkV2ZW50TmFtZSA9ICdlQ29tbWVyY2UgLSAnO1xuICAgICAgICBiYXNlRXZlbnQuQ3VycmVuY3lDb2RlID0gTVAuY3VycmVuY3lDb2RlO1xuICAgICAgICBiYXNlRXZlbnQuU2hvcHBpbmdDYXJ0ID0ge1xuICAgICAgICAgICAgUHJvZHVjdExpc3Q6IE1QLmNhcnRQcm9kdWN0c1xuICAgICAgICB9O1xuICAgICAgICBiYXNlRXZlbnQuQ3VzdG9tRmxhZ3MgPSBjdXN0b21GbGFncztcblxuICAgICAgICByZXR1cm4gYmFzZUV2ZW50O1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb246IGNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb24sXG4gICAgZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZTogZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZSxcbiAgICBnZXRQcm9tb3Rpb25BY3Rpb25FdmVudE5hbWU6IGdldFByb21vdGlvbkFjdGlvbkV2ZW50TmFtZSxcbiAgICBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlOiBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlLFxuICAgIGNvbnZlcnRQcm9tb3Rpb25BY3Rpb25Ub0V2ZW50VHlwZTogY29udmVydFByb21vdGlvbkFjdGlvblRvRXZlbnRUeXBlLFxuICAgIGdlbmVyYXRlRXhwYW5kZWRFY29tbWVyY2VOYW1lOiBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZSxcbiAgICBleHRyYWN0UHJvZHVjdEF0dHJpYnV0ZXM6IGV4dHJhY3RQcm9kdWN0QXR0cmlidXRlcyxcbiAgICBleHRyYWN0QWN0aW9uQXR0cmlidXRlczogZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMsXG4gICAgZXh0cmFjdFByb21vdGlvbkF0dHJpYnV0ZXM6IGV4dHJhY3RQcm9tb3Rpb25BdHRyaWJ1dGVzLFxuICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkOiBleHRyYWN0VHJhbnNhY3Rpb25JZCxcbiAgICBidWlsZFByb2R1Y3RMaXN0OiBidWlsZFByb2R1Y3RMaXN0LFxuICAgIGNyZWF0ZVByb2R1Y3Q6IGNyZWF0ZVByb2R1Y3QsXG4gICAgY3JlYXRlUHJvbW90aW9uOiBjcmVhdGVQcm9tb3Rpb24sXG4gICAgY3JlYXRlSW1wcmVzc2lvbjogY3JlYXRlSW1wcmVzc2lvbixcbiAgICBjcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXM6IGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyxcbiAgICBleHBhbmRDb21tZXJjZUV2ZW50OiBleHBhbmRDb21tZXJjZUV2ZW50LFxuICAgIGNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3Q6IGNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3Rcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgRWNvbW1lcmNlID0gcmVxdWlyZSgnLi9lY29tbWVyY2UnKSxcbiAgICBTZXJ2ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2VydmVyTW9kZWwnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBzZW5kRXZlbnRUb1NlcnZlciA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50Jykuc2VuZEV2ZW50VG9TZXJ2ZXIsXG4gICAgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJykuc2VuZEV2ZW50VG9Gb3J3YXJkZXJzO1xuXG5mdW5jdGlvbiBsb2dFdmVudCh0eXBlLCBuYW1lLCBkYXRhLCBjYXRlZ29yeSwgY2ZsYWdzKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTG9nRXZlbnQgKyAnOiAnICsgbmFtZSk7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZCgpO1xuXG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBkYXRhID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoZGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBzZW5kRXZlbnRUb1NlcnZlcihTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdCh0eXBlLCBuYW1lLCBkYXRhLCBjYXRlZ29yeSwgY2ZsYWdzKSwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpO1xuICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VFdmVudFJlc3BvbnNlKHJlc3BvbnNlVGV4dCkge1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpLFxuICAgICAgICBzZXR0aW5ncyxcbiAgICAgICAgcHJvcCxcbiAgICAgICAgZnVsbFByb3A7XG5cbiAgICBpZiAoIXJlc3BvbnNlVGV4dCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUGFyc2luZyByZXNwb25zZSBmcm9tIHNlcnZlcicpO1xuICAgICAgICBzZXR0aW5ncyA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KTtcblxuICAgICAgICBpZiAoc2V0dGluZ3MgJiYgc2V0dGluZ3MuU3RvcmUpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1BhcnNlZCBzdG9yZSBmcm9tIHJlc3BvbnNlLCB1cGRhdGluZyBsb2NhbCBzZXR0aW5ncycpO1xuXG4gICAgICAgICAgICBpZiAoIU1QLnNlcnZlclNldHRpbmdzKSB7XG4gICAgICAgICAgICAgICAgTVAuc2VydmVyU2V0dGluZ3MgPSB7fTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yIChwcm9wIGluIHNldHRpbmdzLlN0b3JlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzZXR0aW5ncy5TdG9yZS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBmdWxsUHJvcCA9IHNldHRpbmdzLlN0b3JlW3Byb3BdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFmdWxsUHJvcC5WYWx1ZSB8fCBuZXcgRGF0ZShmdWxsUHJvcC5FeHBpcmVzKSA8IG5vdykge1xuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIHNldHRpbmcgc2hvdWxkIGJlIGRlbGV0ZWQgZnJvbSB0aGUgbG9jYWwgc3RvcmUgaWYgaXQgZXhpc3RzXG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QLnNlcnZlclNldHRpbmdzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgTVAuc2VydmVyU2V0dGluZ3NbcHJvcF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSB2YWxpZCBzZXR0aW5nXG4gICAgICAgICAgICAgICAgICAgIE1QLnNlcnZlclNldHRpbmdzW3Byb3BdID0gZnVsbFByb3A7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBwYXJzaW5nIEpTT04gcmVzcG9uc2UgZnJvbSBzZXJ2ZXI6ICcgKyBlLm5hbWUpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3RhcnRUcmFja2luZyhjYWxsYmFjaykge1xuICAgIGlmICghTVAuaXNUcmFja2luZykge1xuICAgICAgICBpZiAoJ2dlb2xvY2F0aW9uJyBpbiBuYXZpZ2F0b3IpIHtcbiAgICAgICAgICAgIE1QLndhdGNoUG9zaXRpb25JZCA9IG5hdmlnYXRvci5nZW9sb2NhdGlvbi53YXRjaFBvc2l0aW9uKHN1Y2Nlc3NUcmFja2luZywgZXJyb3JUcmFja2luZyk7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgcG9zaXRpb24gPSB7XG4gICAgICAgICAgICBjb29yZHM6IHtcbiAgICAgICAgICAgICAgICBsYXRpdHVkZTogTVAuY3VycmVudFBvc2l0aW9uLmxhdCxcbiAgICAgICAgICAgICAgICBsb25naXR1ZGU6IE1QLmN1cnJlbnRQb3NpdGlvbi5sbmdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdHJpZ2dlckNhbGxiYWNrKGNhbGxiYWNrLCBwb3NpdGlvbik7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3VjY2Vzc1RyYWNraW5nKHBvc2l0aW9uKSB7XG4gICAgICAgIE1QLmN1cnJlbnRQb3NpdGlvbiA9IHtcbiAgICAgICAgICAgIGxhdDogcG9zaXRpb24uY29vcmRzLmxhdGl0dWRlLFxuICAgICAgICAgICAgbG5nOiBwb3NpdGlvbi5jb29yZHMubG9uZ2l0dWRlXG4gICAgICAgIH07XG5cbiAgICAgICAgdHJpZ2dlckNhbGxiYWNrKGNhbGxiYWNrLCBwb3NpdGlvbik7XG4gICAgICAgIC8vIHByZXZlbnRzIGNhbGxiYWNrIGZyb20gYmVpbmcgZmlyZWQgbXVsdGlwbGUgdGltZXNcbiAgICAgICAgY2FsbGJhY2sgPSBudWxsO1xuXG4gICAgICAgIE1QLmlzVHJhY2tpbmcgPSB0cnVlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVycm9yVHJhY2tpbmcoKSB7XG4gICAgICAgIHRyaWdnZXJDYWxsYmFjayhjYWxsYmFjayk7XG4gICAgICAgIC8vIHByZXZlbnRzIGNhbGxiYWNrIGZyb20gYmVpbmcgZmlyZWQgbXVsdGlwbGUgdGltZXNcbiAgICAgICAgY2FsbGJhY2sgPSBudWxsO1xuICAgICAgICBNUC5pc1RyYWNraW5nID0gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdHJpZ2dlckNhbGxiYWNrKGNhbGxiYWNrLCBwb3NpdGlvbikge1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKHBvc2l0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKHBvc2l0aW9uKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBpbnZva2luZyB0aGUgY2FsbGJhY2sgcGFzc2VkIHRvIHN0YXJ0VHJhY2tpbmdMb2NhdGlvbi4nKTtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdG9wVHJhY2tpbmcoKSB7XG4gICAgaWYgKE1QLmlzVHJhY2tpbmcpIHtcbiAgICAgICAgbmF2aWdhdG9yLmdlb2xvY2F0aW9uLmNsZWFyV2F0Y2goTVAud2F0Y2hQb3NpdGlvbklkKTtcbiAgICAgICAgTVAuY3VycmVudFBvc2l0aW9uID0gbnVsbDtcbiAgICAgICAgTVAuaXNUcmFja2luZyA9IGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nT3B0T3V0KCkge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0xvZ09wdE91dCk7XG5cbiAgICBzZW5kRXZlbnRUb1NlcnZlcihTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5PcHRPdXQsIG51bGwsIG51bGwsIFR5cGVzLkV2ZW50VHlwZS5PdGhlciksIHNlbmRFdmVudFRvRm9yd2FyZGVycywgcGFyc2VFdmVudFJlc3BvbnNlKTtcbn1cblxuZnVuY3Rpb24gbG9nQVNUKCkge1xuICAgIGxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLkFwcFN0YXRlVHJhbnNpdGlvbik7XG59XG5cbmZ1bmN0aW9uIGxvZ0NoZWNrb3V0RXZlbnQoc3RlcCwgb3B0aW9ucywgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgdmFyIGV2ZW50ID0gRWNvbW1lcmNlLmNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3QoY3VzdG9tRmxhZ3MpO1xuXG4gICAgaWYgKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LkV2ZW50TmFtZSArPSBFY29tbWVyY2UuZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dCk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2hlY2tvdXQ7XG4gICAgICAgIGV2ZW50LlByb2R1Y3RBY3Rpb24gPSB7XG4gICAgICAgICAgICBQcm9kdWN0QWN0aW9uVHlwZTogVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQsXG4gICAgICAgICAgICBDaGVja291dFN0ZXA6IHN0ZXAsXG4gICAgICAgICAgICBDaGVja291dE9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgICAgICBQcm9kdWN0TGlzdDogZXZlbnQuU2hvcHBpbmdDYXJ0LlByb2R1Y3RMaXN0XG4gICAgICAgIH07XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUHJvZHVjdEFjdGlvbkV2ZW50KHByb2R1Y3RBY3Rpb25UeXBlLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IEVjb21tZXJjZS5jb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlKHByb2R1Y3RBY3Rpb25UeXBlKTtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKHByb2R1Y3RBY3Rpb25UeXBlKTtcbiAgICAgICAgZXZlbnQuUHJvZHVjdEFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBwcm9kdWN0QWN0aW9uVHlwZSxcbiAgICAgICAgICAgIFByb2R1Y3RMaXN0OiBBcnJheS5pc0FycmF5KHByb2R1Y3QpID8gcHJvZHVjdCA6IFtwcm9kdWN0XVxuICAgICAgICB9O1xuXG4gICAgICAgIGxvZ0NvbW1lcmNlRXZlbnQoZXZlbnQsIGF0dHJzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxvZ1B1cmNoYXNlRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlKTtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RQdXJjaGFzZTtcbiAgICAgICAgZXZlbnQuUHJvZHVjdEFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZVxuICAgICAgICB9O1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RMaXN0ID0gRWNvbW1lcmNlLmJ1aWxkUHJvZHVjdExpc3QoZXZlbnQsIHByb2R1Y3QpO1xuXG4gICAgICAgIEVjb21tZXJjZS5jb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uKHRyYW5zYWN0aW9uQXR0cmlidXRlcywgZXZlbnQuUHJvZHVjdEFjdGlvbik7XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUmVmdW5kRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICBpZiAoIXRyYW5zYWN0aW9uQXR0cmlidXRlcykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuVHJhbnNhY3Rpb25SZXF1aXJlZCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZCk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVmdW5kO1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uID0ge1xuICAgICAgICAgICAgUHJvZHVjdEFjdGlvblR5cGU6IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZFxuICAgICAgICB9O1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uLlByb2R1Y3RMaXN0ID0gRWNvbW1lcmNlLmJ1aWxkUHJvZHVjdExpc3QoZXZlbnQsIHByb2R1Y3QpO1xuXG4gICAgICAgIEVjb21tZXJjZS5jb252ZXJ0VHJhbnNhY3Rpb25BdHRyaWJ1dGVzVG9Qcm9kdWN0QWN0aW9uKHRyYW5zYWN0aW9uQXR0cmlidXRlcywgZXZlbnQuUHJvZHVjdEFjdGlvbik7XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUHJvbW90aW9uRXZlbnQocHJvbW90aW9uVHlwZSwgcHJvbW90aW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9tb3Rpb25BY3Rpb25FdmVudE5hbWUocHJvbW90aW9uVHlwZSk7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBFY29tbWVyY2UuY29udmVydFByb21vdGlvbkFjdGlvblRvRXZlbnRUeXBlKHByb21vdGlvblR5cGUpO1xuICAgICAgICBldmVudC5Qcm9tb3Rpb25BY3Rpb24gPSB7XG4gICAgICAgICAgICBQcm9tb3Rpb25BY3Rpb25UeXBlOiBwcm9tb3Rpb25UeXBlLFxuICAgICAgICAgICAgUHJvbW90aW9uTGlzdDogW3Byb21vdGlvbl1cbiAgICAgICAgfTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dJbXByZXNzaW9uRXZlbnQoaW1wcmVzc2lvbiwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgdmFyIGV2ZW50ID0gRWNvbW1lcmNlLmNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3QoY3VzdG9tRmxhZ3MpO1xuXG4gICAgaWYgKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LkV2ZW50TmFtZSArPSAnSW1wcmVzc2lvbic7XG4gICAgICAgIGV2ZW50LkV2ZW50Q2F0ZWdvcnkgPSBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0SW1wcmVzc2lvbjtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGltcHJlc3Npb24pKSB7XG4gICAgICAgICAgICBpbXByZXNzaW9uID0gW2ltcHJlc3Npb25dO1xuICAgICAgICB9XG5cbiAgICAgICAgZXZlbnQuUHJvZHVjdEltcHJlc3Npb25zID0gW107XG5cbiAgICAgICAgaW1wcmVzc2lvbi5mb3JFYWNoKGZ1bmN0aW9uKGltcHJlc3Npb24pIHtcbiAgICAgICAgICAgIGV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICBQcm9kdWN0SW1wcmVzc2lvbkxpc3Q6IGltcHJlc3Npb24uTmFtZSxcbiAgICAgICAgICAgICAgICBQcm9kdWN0TGlzdDogQXJyYXkuaXNBcnJheShpbXByZXNzaW9uLlByb2R1Y3QpID8gaW1wcmVzc2lvbi5Qcm9kdWN0IDogW2ltcHJlc3Npb24uUHJvZHVjdF1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5cbmZ1bmN0aW9uIGxvZ0NvbW1lcmNlRXZlbnQoY29tbWVyY2VFdmVudCwgYXR0cnMpIHtcbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50KTtcblxuICAgIGF0dHJzID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cnMpO1xuXG4gICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgc3RhcnROZXdTZXNzaW9uSWZOZWVkZWQoKTtcbiAgICAgICAgaWYgKE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgICAgICAvLyBEb24ndCBzZW5kIHNob3BwaW5nIGNhcnQgdG8gcGFyZW50IHNka3NcbiAgICAgICAgICAgIGNvbW1lcmNlRXZlbnQuU2hvcHBpbmdDYXJ0ID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXR0cnMpIHtcbiAgICAgICAgICAgIGNvbW1lcmNlRXZlbnQuRXZlbnRBdHRyaWJ1dGVzID0gYXR0cnM7XG4gICAgICAgIH1cblxuICAgICAgICBzZW5kRXZlbnRUb1NlcnZlcihjb21tZXJjZUV2ZW50LCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSk7XG4gICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhZGRFdmVudEhhbmRsZXIoZG9tRXZlbnQsIHNlbGVjdG9yLCBldmVudE5hbWUsIGRhdGEsIGV2ZW50VHlwZSkge1xuICAgIHZhciBlbGVtZW50cyA9IFtdLFxuICAgICAgICBoYW5kbGVyID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgdmFyIHRpbWVvdXRIYW5kbGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQuaHJlZikge1xuICAgICAgICAgICAgICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9IGVsZW1lbnQuaHJlZjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZWxlbWVudC5zdWJtaXQpIHtcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudC5zdWJtaXQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdET00gZXZlbnQgdHJpZ2dlcmVkLCBoYW5kbGluZyBldmVudCcpO1xuXG4gICAgICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICAgICAgdHlwZW9mIGV2ZW50TmFtZSA9PT0gJ2Z1bmN0aW9uJyA/IGV2ZW50TmFtZShlbGVtZW50KSA6IGV2ZW50TmFtZSxcbiAgICAgICAgICAgICAgICB0eXBlb2YgZGF0YSA9PT0gJ2Z1bmN0aW9uJyA/IGRhdGEoZWxlbWVudCkgOiBkYXRhLFxuICAgICAgICAgICAgICAgIGV2ZW50VHlwZSB8fCBUeXBlcy5FdmVudFR5cGUuT3RoZXIpO1xuXG4gICAgICAgICAgICAvLyBUT0RPOiBIYW5kbGUgbWlkZGxlLWNsaWNrcyBhbmQgc3BlY2lhbCBrZXlzIChjdHJsLCBhbHQsIGV0YylcbiAgICAgICAgICAgIGlmICgoZWxlbWVudC5ocmVmICYmIGVsZW1lbnQudGFyZ2V0ICE9PSAnX2JsYW5rJykgfHwgZWxlbWVudC5zdWJtaXQpIHtcbiAgICAgICAgICAgICAgICAvLyBHaXZlIHhtbGh0dHByZXF1ZXN0IGVub3VnaCB0aW1lIHRvIGV4ZWN1dGUgYmVmb3JlIG5hdmlnYXRpbmcgYSBsaW5rIG9yIHN1Ym1pdHRpbmcgZm9ybVxuXG4gICAgICAgICAgICAgICAgaWYgKGUucHJldmVudERlZmF1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZS5yZXR1cm5WYWx1ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQodGltZW91dEhhbmRsZXIsIE1QLkNvbmZpZy5UaW1lb3V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZWxlbWVudCxcbiAgICAgICAgaTtcblxuICAgIGlmICghc2VsZWN0b3IpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ2FuXFwndCBiaW5kIGV2ZW50LCBzZWxlY3RvciBpcyByZXF1aXJlZCcpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGEgY3NzIHNlbGVjdG9yIHN0cmluZyBvciBhIGRvbSBlbGVtZW50XG4gICAgaWYgKHR5cGVvZiBzZWxlY3RvciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZWxlbWVudHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcbiAgICB9XG4gICAgZWxzZSBpZiAoc2VsZWN0b3Iubm9kZVR5cGUpIHtcbiAgICAgICAgZWxlbWVudHMgPSBbc2VsZWN0b3JdO1xuICAgIH1cblxuICAgIGlmIChlbGVtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRm91bmQgJyArXG4gICAgICAgICAgICBlbGVtZW50cy5sZW5ndGggK1xuICAgICAgICAgICAgJyBlbGVtZW50JyArXG4gICAgICAgICAgICAoZWxlbWVudHMubGVuZ3RoID4gMSA/ICdzJyA6ICcnKSArXG4gICAgICAgICAgICAnLCBhdHRhY2hpbmcgZXZlbnQgaGFuZGxlcnMnKTtcblxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGVsZW1lbnQgPSBlbGVtZW50c1tpXTtcblxuICAgICAgICAgICAgaWYgKGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcikge1xuICAgICAgICAgICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihkb21FdmVudCwgaGFuZGxlciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZWxlbWVudC5hdHRhY2hFdmVudCkge1xuICAgICAgICAgICAgICAgIGVsZW1lbnQuYXR0YWNoRXZlbnQoJ29uJyArIGRvbUV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGVsZW1lbnRbJ29uJyArIGRvbUV2ZW50XSA9IGhhbmRsZXI7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ05vIGVsZW1lbnRzIGZvdW5kJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZCgpIHtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgaWYgKCFNUC5zZXNzaW9uSWQgJiYgY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuc2lkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gY29va2llcy5zaWQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nRXZlbnQ6IGxvZ0V2ZW50LFxuICAgIHN0YXJ0VHJhY2tpbmc6IHN0YXJ0VHJhY2tpbmcsXG4gICAgc3RvcFRyYWNraW5nOiBzdG9wVHJhY2tpbmcsXG4gICAgbG9nQ2hlY2tvdXRFdmVudDogbG9nQ2hlY2tvdXRFdmVudCxcbiAgICBsb2dQcm9kdWN0QWN0aW9uRXZlbnQ6IGxvZ1Byb2R1Y3RBY3Rpb25FdmVudCxcbiAgICBsb2dQdXJjaGFzZUV2ZW50OiBsb2dQdXJjaGFzZUV2ZW50LFxuICAgIGxvZ1JlZnVuZEV2ZW50OiBsb2dSZWZ1bmRFdmVudCxcbiAgICBsb2dQcm9tb3Rpb25FdmVudDogbG9nUHJvbW90aW9uRXZlbnQsXG4gICAgbG9nSW1wcmVzc2lvbkV2ZW50OiBsb2dJbXByZXNzaW9uRXZlbnQsXG4gICAgbG9nT3B0T3V0OiBsb2dPcHRPdXQsXG4gICAgbG9nQVNUOiBsb2dBU1QsXG4gICAgcGFyc2VFdmVudFJlc3BvbnNlOiBwYXJzZUV2ZW50UmVzcG9uc2UsXG4gICAgbG9nQ29tbWVyY2VFdmVudDogbG9nQ29tbWVyY2VFdmVudCxcbiAgICBhZGRFdmVudEhhbmRsZXI6IGFkZEV2ZW50SGFuZGxlcixcbiAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZDogc3RhcnROZXdTZXNzaW9uSWZOZWVkZWRcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgTVBhcnRpY2xlVXNlciA9IHJlcXVpcmUoJy4vbVBhcnRpY2xlVXNlcicpLFxuICAgIEFwaUNsaWVudCA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50JyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyk7XG5cbmZ1bmN0aW9uIGluaXRGb3J3YXJkZXJzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgdmFyIHVzZXIgPSBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKTtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkICYmIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzKSB7XG4gICAgICAgIC8vIFNvbWUganMgbGlicmFyaWVzIHJlcXVpcmUgdGhhdCB0aGV5IGJlIGxvYWRlZCBmaXJzdCwgb3IgbGFzdCwgZXRjXG4gICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzLnNvcnQoZnVuY3Rpb24oeCwgeSkge1xuICAgICAgICAgICAgeC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlID0geC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlIHx8IDA7XG4gICAgICAgICAgICB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgPSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgfHwgMDtcbiAgICAgICAgICAgIHJldHVybiAtMSAqICh4LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgLSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzID0gTVAuY29uZmlndXJlZEZvcndhcmRlcnMuZmlsdGVyKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKCFpc0VuYWJsZWRGb3JVc2VyQ29uc2VudChmb3J3YXJkZXIuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXMsIHVzZXIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlcyhmb3J3YXJkZXIuZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlLCB1c2VyKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghaXNFbmFibGVkRm9yVW5rbm93blVzZXIoZm9yd2FyZGVyLmV4Y2x1ZGVBbm9ueW1vdXNVc2VyLCB1c2VyKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGZpbHRlcmVkVXNlcklkZW50aXRpZXMgPSBIZWxwZXJzLmZpbHRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzLCBmb3J3YXJkZXIudXNlcklkZW50aXR5RmlsdGVycyk7XG4gICAgICAgICAgICB2YXIgZmlsdGVyZWRVc2VyQXR0cmlidXRlcyA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXMoTVAudXNlckF0dHJpYnV0ZXMsIGZvcndhcmRlci51c2VyQXR0cmlidXRlRmlsdGVycyk7XG5cbiAgICAgICAgICAgIGlmICghZm9yd2FyZGVyLmluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLmluaXQoZm9yd2FyZGVyLnNldHRpbmdzLFxuICAgICAgICAgICAgICAgICAgICBwcmVwYXJlRm9yd2FyZGluZ1N0YXRzLFxuICAgICAgICAgICAgICAgICAgICBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VyQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllcyxcbiAgICAgICAgICAgICAgICAgICAgTVAuYXBwVmVyc2lvbixcbiAgICAgICAgICAgICAgICAgICAgTVAuYXBwTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgTVAuY3VzdG9tRmxhZ3MsXG4gICAgICAgICAgICAgICAgICAgIE1QLmNsaWVudElkKTtcbiAgICAgICAgICAgICAgICBmb3J3YXJkZXIuaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBpc0VuYWJsZWRGb3JVc2VyQ29uc2VudChjb25zZW50UnVsZXMsIHVzZXIpIHtcbiAgICBpZiAoIWNvbnNlbnRSdWxlc1xuICAgICAgICB8fCAhY29uc2VudFJ1bGVzLnZhbHVlc1xuICAgICAgICB8fCAhY29uc2VudFJ1bGVzLnZhbHVlcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGlmICghdXNlcikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHZhciBwdXJwb3NlSGFzaGVzID0ge307XG4gICAgdmFyIEdEUFJDb25zZW50SGFzaFByZWZpeCA9ICcxJztcbiAgICB2YXIgY29uc2VudFN0YXRlID0gdXNlci5nZXRDb25zZW50U3RhdGUoKTtcbiAgICBpZiAoY29uc2VudFN0YXRlKSB7XG4gICAgICAgIHZhciBnZHByQ29uc2VudFN0YXRlID0gY29uc2VudFN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKTtcbiAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4gZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICAgICAgICAgIGlmIChnZHByQ29uc2VudFN0YXRlLmhhc093blByb3BlcnR5KHB1cnBvc2UpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBwdXJwb3NlSGFzaCA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKEdEUFJDb25zZW50SGFzaFByZWZpeCArIHB1cnBvc2UpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgIHB1cnBvc2VIYXNoZXNbcHVycG9zZUhhc2hdID0gZ2RwckNvbnNlbnRTdGF0ZVtwdXJwb3NlXS5Db25zZW50ZWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHZhciBpc01hdGNoID0gZmFsc2U7XG4gICAgY29uc2VudFJ1bGVzLnZhbHVlcy5mb3JFYWNoKGZ1bmN0aW9uKGNvbnNlbnRSdWxlKSB7XG4gICAgICAgIGlmICghaXNNYXRjaCkge1xuICAgICAgICAgICAgdmFyIHB1cnBvc2VIYXNoID0gY29uc2VudFJ1bGUuY29uc2VudFB1cnBvc2U7XG4gICAgICAgICAgICB2YXIgaGFzQ29uc2VudGVkID0gY29uc2VudFJ1bGUuaGFzQ29uc2VudGVkO1xuICAgICAgICAgICAgaWYgKHB1cnBvc2VIYXNoZXMuaGFzT3duUHJvcGVydHkocHVycG9zZUhhc2gpXG4gICAgICAgICAgICAgICAgJiYgcHVycG9zZUhhc2hlc1twdXJwb3NlSGFzaF0gPT09IGhhc0NvbnNlbnRlZCkge1xuICAgICAgICAgICAgICAgIGlzTWF0Y2ggPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29uc2VudFJ1bGVzLmluY2x1ZGVPbk1hdGNoID09PSBpc01hdGNoO1xufVxuXG5mdW5jdGlvbiBpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlcyhmaWx0ZXJPYmplY3QsIHVzZXIpIHtcbiAgICBpZiAoIWZpbHRlck9iamVjdCB8fFxuICAgICAgICAhSGVscGVycy5pc09iamVjdChmaWx0ZXJPYmplY3QpIHx8XG4gICAgICAgICFPYmplY3Qua2V5cyhmaWx0ZXJPYmplY3QpLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgYXR0ckhhc2gsXG4gICAgICAgIHZhbHVlSGFzaCxcbiAgICAgICAgdXNlckF0dHJpYnV0ZXM7XG5cbiAgICBpZiAoIXVzZXIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdXNlci5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuICAgIH1cblxuICAgIHZhciBpc01hdGNoID0gZmFsc2U7XG5cbiAgICB0cnkge1xuICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMgJiYgSGVscGVycy5pc09iamVjdCh1c2VyQXR0cmlidXRlcykgJiYgT2JqZWN0LmtleXModXNlckF0dHJpYnV0ZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgZm9yICh2YXIgYXR0ck5hbWUgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoYXR0ck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJIYXNoID0gSGVscGVycy5nZW5lcmF0ZUhhc2goYXR0ck5hbWUpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlSGFzaCA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKHVzZXJBdHRyaWJ1dGVzW2F0dHJOYW1lXSkudG9TdHJpbmcoKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoKGF0dHJIYXNoID09PSBmaWx0ZXJPYmplY3QudXNlckF0dHJpYnV0ZU5hbWUpICYmICh2YWx1ZUhhc2ggPT09IGZpbHRlck9iamVjdC51c2VyQXR0cmlidXRlVmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpc01hdGNoID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZpbHRlck9iamVjdCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbHRlck9iamVjdC5pbmNsdWRlT25NYXRjaCA9PT0gaXNNYXRjaDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBpbiBhbnkgZXJyb3Igc2NlbmFyaW8sIGVyciBvbiBzaWRlIG9mIHJldHVybmluZyB0cnVlIGFuZCBmb3J3YXJkaW5nIGV2ZW50XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gaXNFbmFibGVkRm9yVW5rbm93blVzZXIoZXhjbHVkZUFub255bW91c1VzZXJCb29sZWFuLCB1c2VyKSB7XG4gICAgaWYgKCF1c2VyIHx8ICF1c2VyLmlzTG9nZ2VkSW4oKSkge1xuICAgICAgICBpZiAoZXhjbHVkZUFub255bW91c1VzZXJCb29sZWFuKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGFwcGx5VG9Gb3J3YXJkZXJzKGZ1bmN0aW9uTmFtZSwgZnVuY3Rpb25BcmdzKSB7XG4gICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnMubGVuZ3RoKSB7XG4gICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgICAgIHZhciBmb3J3YXJkZXJGdW5jdGlvbiA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdO1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlckZ1bmN0aW9uKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdKGZ1bmN0aW9uQXJncyk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRFdmVudFRvRm9yd2FyZGVycyhldmVudCkge1xuICAgIHZhciBjbG9uZWRFdmVudCxcbiAgICAgICAgaGFzaGVkRXZlbnROYW1lLFxuICAgICAgICBoYXNoZWRFdmVudFR5cGUsXG4gICAgICAgIGZpbHRlclVzZXJJZGVudGl0aWVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5Vc2VySWRlbnRpdGllcyAmJiBldmVudC5Vc2VySWRlbnRpdGllcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBldmVudC5Vc2VySWRlbnRpdGllcy5mb3JFYWNoKGZ1bmN0aW9uKHVzZXJJZGVudGl0eSwgaSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5pbkFycmF5KGZpbHRlckxpc3QsIHVzZXJJZGVudGl0eS5UeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMuc3BsaWNlKGksIDEpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpLS07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBmaWx0ZXJBdHRyaWJ1dGVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIHZhciBoYXNoO1xuXG4gICAgICAgICAgICBpZiAoIWZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAodmFyIGF0dHJOYW1lIGluIGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmIChldmVudC5FdmVudEF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoYXR0ck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGhhc2ggPSBIZWxwZXJzLmdlbmVyYXRlSGFzaChldmVudC5FdmVudENhdGVnb3J5ICsgZXZlbnQuRXZlbnROYW1lICsgYXR0ck5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmluQXJyYXkoZmlsdGVyTGlzdCwgaGFzaCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBldmVudC5FdmVudEF0dHJpYnV0ZXNbYXR0ck5hbWVdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbkZpbHRlcmVkTGlzdCA9IGZ1bmN0aW9uKGZpbHRlckxpc3QsIGhhc2gpIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJMaXN0ICYmIGZpbHRlckxpc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaW5BcnJheShmaWx0ZXJMaXN0LCBoYXNoKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSxcbiAgICAgICAgZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMgPSBbXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldyxcbiAgICAgICAgICAgIFR5cGVzLk1lc3NhZ2VUeXBlLkNvbW1lcmNlXG4gICAgICAgIF07XG5cbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkICYmIE1QLmFjdGl2ZUZvcndhcmRlcnMpIHtcbiAgICAgICAgaGFzaGVkRXZlbnROYW1lID0gSGVscGVycy5nZW5lcmF0ZUhhc2goZXZlbnQuRXZlbnRDYXRlZ29yeSArIGV2ZW50LkV2ZW50TmFtZSk7XG4gICAgICAgIGhhc2hlZEV2ZW50VHlwZSA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGV2ZW50LkV2ZW50Q2F0ZWdvcnkpO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgLy8gQ2hlY2sgYXR0cmlidXRlIGZvcndhcmRpbmcgcnVsZS4gVGhpcyBydWxlIGFsbG93cyB1c2VycyB0byBvbmx5IGZvcndhcmQgYW4gZXZlbnQgaWYgYVxuICAgICAgICAgICAgLy8gc3BlY2lmaWMgYXR0cmlidXRlIGV4aXN0cyBhbmQgaGFzIGEgc3BlY2lmaWMgdmFsdWUuIEFsdGVybmF0aXZlbHksIHRoZXkgY2FuIHNwZWNpZnlcbiAgICAgICAgICAgIC8vIHRoYXQgYW4gZXZlbnQgbm90IGJlIGZvcndhcmRlZCBpZiB0aGUgc3BlY2lmaWVkIGF0dHJpYnV0ZSBuYW1lIGFuZCB2YWx1ZSBleGlzdHMuXG4gICAgICAgICAgICAvLyBUaGUgdHdvIGNhc2VzIGFyZSBjb250cm9sbGVkIGJ5IHRoZSBcImluY2x1ZGVPbk1hdGNoXCIgYm9vbGVhbiB2YWx1ZS5cbiAgICAgICAgICAgIC8vIFN1cHBvcnRlZCBtZXNzYWdlIHR5cGVzIGZvciBhdHRyaWJ1dGUgZm9yd2FyZGluZyBydWxlcyBhcmUgZGVmaW5lZCBpbiB0aGUgZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMgYXJyYXlcblxuICAgICAgICAgICAgaWYgKGZvcndhcmRpbmdSdWxlTWVzc2FnZVR5cGVzLmluZGV4T2YoZXZlbnQuRXZlbnREYXRhVHlwZSkgPiAtMVxuICAgICAgICAgICAgICAgICYmIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZVxuICAgICAgICAgICAgICAgICYmIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZU5hbWVcbiAgICAgICAgICAgICAgICAmJiBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWUuZXZlbnRBdHRyaWJ1dGVWYWx1ZSkge1xuXG4gICAgICAgICAgICAgICAgdmFyIGZvdW5kUHJvcCA9IG51bGw7XG5cbiAgICAgICAgICAgICAgICAvLyBBdHRlbXB0IHRvIGZpbmQgdGhlIGF0dHJpYnV0ZSBpbiB0aGUgY29sbGVjdGlvbiBvZiBldmVudCBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZSA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKHByb3ApLnRvU3RyaW5nKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChoYXNoZWRFdmVudEF0dHJpYnV0ZU5hbWUgPT09IE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3VuZFByb3AgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGV2ZW50LkV2ZW50QXR0cmlidXRlc1twcm9wXSkudG9TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGlzTWF0Y2ggPSBmb3VuZFByb3AgIT09IG51bGwgJiYgZm91bmRQcm9wLnZhbHVlID09PSBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWUuZXZlbnRBdHRyaWJ1dGVWYWx1ZTtcblxuICAgICAgICAgICAgICAgIHZhciBzaG91bGRJbmNsdWRlID0gTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlLmluY2x1ZGVPbk1hdGNoID09PSB0cnVlID8gaXNNYXRjaCA6ICFpc01hdGNoO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzaG91bGRJbmNsdWRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2xvbmUgdGhlIGV2ZW50IG9iamVjdCwgYXMgd2UgY291bGQgYmUgc2VuZGluZyBkaWZmZXJlbnQgYXR0cmlidXRlcyB0byBlYWNoIGZvcndhcmRlclxuICAgICAgICAgICAgY2xvbmVkRXZlbnQgPSB7fTtcbiAgICAgICAgICAgIGNsb25lZEV2ZW50ID0gSGVscGVycy5leHRlbmQodHJ1ZSwgY2xvbmVkRXZlbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIC8vIENoZWNrIGV2ZW50IGZpbHRlcmluZyBydWxlc1xuICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudFxuICAgICAgICAgICAgICAgICYmIChpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmV2ZW50TmFtZUZpbHRlcnMsIGhhc2hlZEV2ZW50TmFtZSlcbiAgICAgICAgICAgICAgICAgICAgfHwgaW5GaWx0ZXJlZExpc3QoTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5ldmVudFR5cGVGaWx0ZXJzLCBoYXNoZWRFdmVudFR5cGUpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuQ29tbWVyY2UgJiYgaW5GaWx0ZXJlZExpc3QoTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5ldmVudFR5cGVGaWx0ZXJzLCBoYXNoZWRFdmVudFR5cGUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldyAmJiBpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLnNjcmVlbk5hbWVGaWx0ZXJzLCBoYXNoZWRFdmVudE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGF0dHJpYnV0ZSBmaWx0ZXJpbmcgcnVsZXNcbiAgICAgICAgICAgIGlmIChjbG9uZWRFdmVudC5FdmVudEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uYXR0cmlidXRlRmlsdGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VWaWV3KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0ucGFnZVZpZXdBdHRyaWJ1dGVGaWx0ZXJzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIHVzZXIgaWRlbnRpdHkgZmlsdGVyaW5nIHJ1bGVzXG4gICAgICAgICAgICBmaWx0ZXJVc2VySWRlbnRpdGllcyhjbG9uZWRFdmVudCwgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS51c2VySWRlbnRpdHlGaWx0ZXJzKTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgdXNlciBhdHRyaWJ1dGUgZmlsdGVyaW5nIHJ1bGVzXG4gICAgICAgICAgICBjbG9uZWRFdmVudC5Vc2VyQXR0cmlidXRlcyA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXMoY2xvbmVkRXZlbnQuVXNlckF0dHJpYnV0ZXMsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0udXNlckF0dHJpYnV0ZUZpbHRlcnMpO1xuXG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTZW5kaW5nIG1lc3NhZ2UgdG8gZm9yd2FyZGVyOiAnICsgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5uYW1lKTtcblxuICAgICAgICAgICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0ucHJvY2Vzcykge1xuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLnByb2Nlc3MoY2xvbmVkRXZlbnQpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzKGtleSwgdmFsdWUpIHtcbiAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VyQXR0cmlidXRlICYmXG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzICYmXG4gICAgICAgICAgICAgICAgIUhlbHBlcnMuaW5BcnJheShmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMsIEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGtleSkpKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLnNldFVzZXJBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICB2YXIgZmlsdGVyZWRVc2VySWRlbnRpdGllcyA9IEhlbHBlcnMuZmlsdGVyVXNlcklkZW50aXRpZXModXNlcklkZW50aXRpZXMsIGZvcndhcmRlci51c2VySWRlbnRpdHlGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VySWRlbnRpdHkpIHtcbiAgICAgICAgICAgIGZpbHRlcmVkVXNlcklkZW50aXRpZXMuZm9yRWFjaChmdW5jdGlvbihpZGVudGl0eSkge1xuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBmb3J3YXJkZXIuc2V0VXNlcklkZW50aXR5KGlkZW50aXR5LklkZW50aXR5LCBpZGVudGl0eS5UeXBlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBzZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkKHVzZXIpIHtcbiAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgIHZhciBmaWx0ZXJlZFVzZXIgPSBNUGFydGljbGVVc2VyLmdldEZpbHRlcmVkTXBhcnRpY2xlVXNlcih1c2VyLmdldE1QSUQoKSwgZm9yd2FyZGVyKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5vblVzZXJJZGVudGlmaWVkKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLm9uVXNlcklkZW50aWZpZWQoZmlsdGVyZWRVc2VyKTtcbiAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gc2V0Rm9yd2FyZGVyT25JZGVudGl0eUNvbXBsZXRlKHVzZXIsIGlkZW50aXR5TWV0aG9kKSB7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgdmFyIGZpbHRlcmVkVXNlciA9IE1QYXJ0aWNsZVVzZXIuZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyKHVzZXIuZ2V0TVBJRCgpLCBmb3J3YXJkZXIpO1xuICAgICAgICBpZiAoaWRlbnRpdHlNZXRob2QgPT09ICdpZGVudGlmeScpIHtcbiAgICAgICAgICAgIGlmIChmb3J3YXJkZXIub25JZGVudGlmeUNvbXBsZXRlKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gZm9yd2FyZGVyLm9uSWRlbnRpZnlDb21wbGV0ZShmaWx0ZXJlZFVzZXIpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpZGVudGl0eU1ldGhvZCA9PT0gJ2xvZ2luJykge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5vbkxvZ2luQ29tcGxldGUpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBmb3J3YXJkZXIub25Mb2dpbkNvbXBsZXRlKGZpbHRlcmVkVXNlcik7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGlkZW50aXR5TWV0aG9kID09PSAnbG9nb3V0Jykge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5vbkxvZ291dENvbXBsZXRlKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gZm9yd2FyZGVyLm9uTG9nb3V0Q29tcGxldGUoZmlsdGVyZWRVc2VyKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaWRlbnRpdHlNZXRob2QgPT09ICdtb2RpZnknKSB7XG4gICAgICAgICAgICBpZiAoZm9yd2FyZGVyLm9uTW9kaWZ5Q29tcGxldGUpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBmb3J3YXJkZXIub25Nb2RpZnlDb21wbGV0ZShmaWx0ZXJlZFVzZXIpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBwcmVwYXJlRm9yd2FyZGluZ1N0YXRzKGZvcndhcmRlciwgZXZlbnQpIHtcbiAgICB2YXIgZm9yd2FyZGluZ1N0YXRzRGF0YSxcbiAgICAgICAgcXVldWUgPSBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCk7XG5cbiAgICBpZiAoZm9yd2FyZGVyICYmIGZvcndhcmRlci5pc1Zpc2libGUpIHtcbiAgICAgICAgZm9yd2FyZGluZ1N0YXRzRGF0YSA9IHtcbiAgICAgICAgICAgIG1pZDogZm9yd2FyZGVyLmlkLFxuICAgICAgICAgICAgZXNpZDogZm9yd2FyZGVyLmV2ZW50U3Vic2NyaXB0aW9uSWQsXG4gICAgICAgICAgICBuOiBldmVudC5FdmVudE5hbWUsXG4gICAgICAgICAgICBhdHRyczogZXZlbnQuRXZlbnRBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgc2RrOiBldmVudC5TREtWZXJzaW9uLFxuICAgICAgICAgICAgZHQ6IGV2ZW50LkV2ZW50RGF0YVR5cGUsXG4gICAgICAgICAgICBldDogZXZlbnQuRXZlbnRDYXRlZ29yeSxcbiAgICAgICAgICAgIGRiZzogZXZlbnQuRGVidWcsXG4gICAgICAgICAgICBjdDogZXZlbnQuVGltZXN0YW1wLFxuICAgICAgICAgICAgZWVjOiBldmVudC5FeHBhbmRlZEV2ZW50Q291bnRcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoSGVscGVycy5oYXNGZWF0dXJlRmxhZyhDb25zdGFudHMuRmVhdHVyZXMuQmF0Y2hpbmcpKSB7XG4gICAgICAgICAgICBxdWV1ZS5wdXNoKGZvcndhcmRpbmdTdGF0c0RhdGEpO1xuICAgICAgICAgICAgc2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZShxdWV1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBBcGlDbGllbnQuc2VuZFNpbmdsZUZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCkge1xuICAgIHJldHVybiBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLmZvcndhcmRpbmdTdGF0c0V2ZW50UXVldWU7XG59XG5cbmZ1bmN0aW9uIHNldEZvcndhcmRlclN0YXRzUXVldWUocXVldWUpIHtcbiAgICBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLmZvcndhcmRpbmdTdGF0c0V2ZW50UXVldWUgPSBxdWV1ZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaW5pdEZvcndhcmRlcnM6IGluaXRGb3J3YXJkZXJzLFxuICAgIGFwcGx5VG9Gb3J3YXJkZXJzOiBhcHBseVRvRm9yd2FyZGVycyxcbiAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnM6IHNlbmRFdmVudFRvRm9yd2FyZGVycyxcbiAgICBjYWxsU2V0VXNlckF0dHJpYnV0ZU9uRm9yd2FyZGVyczogY2FsbFNldFVzZXJBdHRyaWJ1dGVPbkZvcndhcmRlcnMsXG4gICAgc2V0Rm9yd2FyZGVyVXNlcklkZW50aXRpZXM6IHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzLFxuICAgIHNldEZvcndhcmRlck9uVXNlcklkZW50aWZpZWQ6IHNldEZvcndhcmRlck9uVXNlcklkZW50aWZpZWQsXG4gICAgc2V0Rm9yd2FyZGVyT25JZGVudGl0eUNvbXBsZXRlOiBzZXRGb3J3YXJkZXJPbklkZW50aXR5Q29tcGxldGUsXG4gICAgcHJlcGFyZUZvcndhcmRpbmdTdGF0czogcHJlcGFyZUZvcndhcmRpbmdTdGF0cyxcbiAgICBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlOiBnZXRGb3J3YXJkZXJTdGF0c1F1ZXVlLFxuICAgIHNldEZvcndhcmRlclN0YXRzUXVldWU6IHNldEZvcndhcmRlclN0YXRzUXVldWUsXG4gICAgaXNFbmFibGVkRm9yVXNlckNvbnNlbnQ6IGlzRW5hYmxlZEZvclVzZXJDb25zZW50LFxuICAgIGlzRW5hYmxlZEZvclVzZXJBdHRyaWJ1dGVzOiBpc0VuYWJsZWRGb3JVc2VyQXR0cmlidXRlc1xufTtcbiIsInZhciBBcGlDbGllbnQgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBGb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyk7XG5cbmZ1bmN0aW9uIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXIoKSB7XG4gICAgbVBhcnRpY2xlLl9mb3J3YXJkaW5nU3RhdHNUaW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBwcmVwYXJlQW5kU2VuZEZvcndhcmRpbmdTdGF0c0JhdGNoKCk7XG4gICAgfSwgTVAuQ29uZmlnLkZvcndhcmRlclN0YXRzVGltZW91dCk7XG59XG5cbmZ1bmN0aW9uIHByZXBhcmVBbmRTZW5kRm9yd2FyZGluZ1N0YXRzQmF0Y2goKSB7XG4gICAgdmFyIGZvcndhcmRlclF1ZXVlID0gRm9yd2FyZGVycy5nZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCksXG4gICAgICAgIHVwbG9hZHNUYWJsZSA9IFBlcnNpc3RlbmNlLmZvcndhcmRpbmdTdGF0c0JhdGNoZXMudXBsb2Fkc1RhYmxlLFxuICAgICAgICBub3cgPSBEYXRlLm5vdygpO1xuXG4gICAgaWYgKGZvcndhcmRlclF1ZXVlLmxlbmd0aCkge1xuICAgICAgICB1cGxvYWRzVGFibGVbbm93XSA9IHt1cGxvYWRpbmc6IGZhbHNlLCBkYXRhOiBmb3J3YXJkZXJRdWV1ZX07XG4gICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZShbXSk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgZGF0ZSBpbiB1cGxvYWRzVGFibGUpIHtcbiAgICAgICAgKGZ1bmN0aW9uKGRhdGUpIHtcbiAgICAgICAgICAgIGlmICh1cGxvYWRzVGFibGUuaGFzT3duUHJvcGVydHkoZGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAwIHx8IHhoci5zdGF0dXMgPT09IDIwMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgc2VudCAgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgdXBsb2Fkc1RhYmxlW2RhdGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoeGhyLnN0YXR1cy50b1N0cmluZygpWzBdID09PSAnNCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHhoci5zdGF0dXMgIT09IDQyOSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVwbG9hZHNUYWJsZVtkYXRlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZm9yd2FyZGluZ1N0YXRzRGF0YSA9IHVwbG9hZHNUYWJsZVtkYXRlXS5kYXRhO1xuICAgICAgICAgICAgICAgICAgICB1cGxvYWRzVGFibGVbZGF0ZV0udXBsb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgQXBpQ2xpZW50LnNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEsIHhocik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KShkYXRlKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXI6IHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXJcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBwbHVzZXMgPSAvXFwrL2csXG4gICAgc2VydmljZVNjaGVtZSA9IHdpbmRvdy5tUGFydGljbGUgJiYgd2luZG93Lm1QYXJ0aWNsZS5mb3JjZUh0dHBzID8gJ2h0dHBzOi8vJyA6IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCArICcvLyc7XG5cbmZ1bmN0aW9uIGxvZ0RlYnVnKG1zZykge1xuICAgIGlmIChNUC5sb2dMZXZlbCA9PT0gJ3ZlcmJvc2UnICYmIHdpbmRvdy5jb25zb2xlICYmIHdpbmRvdy5jb25zb2xlLmxvZykge1xuICAgICAgICB3aW5kb3cuY29uc29sZS5sb2cobXNnKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNhbkxvZygpIHtcbiAgICBpZiAoTVAuaXNFbmFibGVkICYmIChNUC5kZXZUb2tlbiB8fCBNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiByZXR1cm5Db252ZXJ0ZWRCb29sZWFuKGRhdGEpIHtcbiAgICBpZiAoZGF0YSA9PT0gJ2ZhbHNlJyB8fCBkYXRhID09PSAnMCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGRhdGEpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gaGFzRmVhdHVyZUZsYWcoZmVhdHVyZSkge1xuICAgIHJldHVybiBNUC5mZWF0dXJlRmxhZ3NbZmVhdHVyZV07XG59XG5cbmZ1bmN0aW9uIGludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBjb2RlLCBib2R5LCBtUGFydGljbGVVc2VyKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICBodHRwQ29kZTogY29kZSxcbiAgICAgICAgICAgICAgICBib2R5OiBib2R5LFxuICAgICAgICAgICAgICAgIGdldFVzZXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAobVBhcnRpY2xlVXNlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1QYXJ0aWNsZVVzZXI7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nRGVidWcoJ1RoZXJlIHdhcyBhbiBlcnJvciB3aXRoIHlvdXIgY2FsbGJhY2s6ICcgKyBlKTtcbiAgICB9XG59XG5cbi8vIFN0YW5kYWxvbmUgdmVyc2lvbiBvZiBqUXVlcnkuZXh0ZW5kLCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9kYW5zZG9tL2V4dGVuZFxuZnVuY3Rpb24gZXh0ZW5kKCkge1xuICAgIHZhciBvcHRpb25zLCBuYW1lLCBzcmMsIGNvcHksIGNvcHlJc0FycmF5LCBjbG9uZSxcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzBdIHx8IHt9LFxuICAgICAgICBpID0gMSxcbiAgICAgICAgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aCxcbiAgICAgICAgZGVlcCA9IGZhbHNlLFxuICAgICAgICAvLyBoZWxwZXIgd2hpY2ggcmVwbGljYXRlcyB0aGUganF1ZXJ5IGludGVybmFsIGZ1bmN0aW9uc1xuICAgICAgICBvYmplY3RIZWxwZXIgPSB7XG4gICAgICAgICAgICBoYXNPd246IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksXG4gICAgICAgICAgICBjbGFzczJ0eXBlOiB7fSxcbiAgICAgICAgICAgIHR5cGU6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIHJldHVybiBvYmogPT0gbnVsbCA/XG4gICAgICAgICAgICAgICAgICAgIFN0cmluZyhvYmopIDpcbiAgICAgICAgICAgICAgICAgICAgb2JqZWN0SGVscGVyLmNsYXNzMnR5cGVbT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaildIHx8ICdvYmplY3QnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzUGxhaW5PYmplY3Q6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIGlmICghb2JqIHx8IG9iamVjdEhlbHBlci50eXBlKG9iaikgIT09ICdvYmplY3QnIHx8IG9iai5ub2RlVHlwZSB8fCBvYmplY3RIZWxwZXIuaXNXaW5kb3cob2JqKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5jb25zdHJ1Y3RvciAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgIW9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosICdjb25zdHJ1Y3RvcicpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAhb2JqZWN0SGVscGVyLmhhc093bi5jYWxsKG9iai5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsICdpc1Byb3RvdHlwZU9mJykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBrZXk7XG4gICAgICAgICAgICAgICAgZm9yIChrZXkgaW4gb2JqKSB7IH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1lbXB0eVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGtleSA9PT0gdW5kZWZpbmVkIHx8IG9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosIGtleSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNBcnJheTogQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2FycmF5JztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0Z1bmN0aW9uOiBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2Z1bmN0aW9uJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc1dpbmRvdzogZnVuY3Rpb24ob2JqKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG9iaiAhPSBudWxsICYmIG9iaiA9PSBvYmoud2luZG93O1xuICAgICAgICAgICAgfVxuICAgICAgICB9OyAgLy8gZW5kIG9mIG9iamVjdEhlbHBlclxuXG4gICAgLy8gSGFuZGxlIGEgZGVlcCBjb3B5IHNpdHVhdGlvblxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZGVlcCA9IHRhcmdldDtcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzFdIHx8IHt9O1xuICAgICAgICAvLyBza2lwIHRoZSBib29sZWFuIGFuZCB0aGUgdGFyZ2V0XG4gICAgICAgIGkgPSAyO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBjYXNlIHdoZW4gdGFyZ2V0IGlzIGEgc3RyaW5nIG9yIHNvbWV0aGluZyAocG9zc2libGUgaW4gZGVlcCBjb3B5KVxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnb2JqZWN0JyAmJiAhb2JqZWN0SGVscGVyLmlzRnVuY3Rpb24odGFyZ2V0KSkge1xuICAgICAgICB0YXJnZXQgPSB7fTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzZWNvbmQgYXJndW1lbnQgaXMgdXNlZCB0aGVuIHRoaXMgY2FuIGV4dGVuZCBhbiBvYmplY3QgdGhhdCBpcyB1c2luZyB0aGlzIG1ldGhvZFxuICAgIGlmIChsZW5ndGggPT09IGkpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGhpcztcbiAgICAgICAgLS1pO1xuICAgIH1cblxuICAgIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgLy8gT25seSBkZWFsIHdpdGggbm9uLW51bGwvdW5kZWZpbmVkIHZhbHVlc1xuICAgICAgICBpZiAoKG9wdGlvbnMgPSBhcmd1bWVudHNbaV0pICE9IG51bGwpIHtcbiAgICAgICAgICAgIC8vIEV4dGVuZCB0aGUgYmFzZSBvYmplY3RcbiAgICAgICAgICAgIGZvciAobmFtZSBpbiBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgc3JjID0gdGFyZ2V0W25hbWVdO1xuICAgICAgICAgICAgICAgIGNvcHkgPSBvcHRpb25zW25hbWVdO1xuXG4gICAgICAgICAgICAgICAgLy8gUHJldmVudCBuZXZlci1lbmRpbmcgbG9vcFxuICAgICAgICAgICAgICAgIGlmICh0YXJnZXQgPT09IGNvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gUmVjdXJzZSBpZiB3ZSdyZSBtZXJnaW5nIHBsYWluIG9iamVjdHMgb3IgYXJyYXlzXG4gICAgICAgICAgICAgICAgaWYgKGRlZXAgJiYgY29weSAmJiAob2JqZWN0SGVscGVyLmlzUGxhaW5PYmplY3QoY29weSkgfHwgKGNvcHlJc0FycmF5ID0gb2JqZWN0SGVscGVyLmlzQXJyYXkoY29weSkpKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29weUlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvcHlJc0FycmF5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbG9uZSA9IHNyYyAmJiBvYmplY3RIZWxwZXIuaXNBcnJheShzcmMpID8gc3JjIDogW107XG5cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb25lID0gc3JjICYmIG9iamVjdEhlbHBlci5pc1BsYWluT2JqZWN0KHNyYykgPyBzcmMgOiB7fTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIE5ldmVyIG1vdmUgb3JpZ2luYWwgb2JqZWN0cywgY2xvbmUgdGhlbVxuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBleHRlbmQoZGVlcCwgY2xvbmUsIGNvcHkpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIERvbid0IGJyaW5nIGluIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvcHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBjb3B5O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJldHVybiB0aGUgbW9kaWZpZWQgb2JqZWN0XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgICB2YXIgb2JqVHlwZSA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG5cbiAgICByZXR1cm4gb2JqVHlwZSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbiAgICAgICAgfHwgb2JqVHlwZSA9PT0gJ1tvYmplY3QgRXJyb3JdJztcbn1cblxuZnVuY3Rpb24gaW5BcnJheShpdGVtcywgbmFtZSkge1xuICAgIHZhciBpID0gMDtcblxuICAgIGlmIChBcnJheS5wcm90b3R5cGUuaW5kZXhPZikge1xuICAgICAgICByZXR1cm4gaXRlbXMuaW5kZXhPZihuYW1lLCAwKSA+PSAwO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZm9yICh2YXIgbiA9IGl0ZW1zLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgICAgICAgaWYgKGkgaW4gaXRlbXMgJiYgaXRlbXNbaV0gPT09IG5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU2VydmljZVVybChzZWN1cmVTZXJ2aWNlVXJsLCBzZXJ2aWNlVXJsLCBkZXZUb2tlbikge1xuICAgIGlmIChtUGFydGljbGUuZm9yY2VIdHRwcykge1xuICAgICAgICByZXR1cm4gJ2h0dHBzOi8vJyArIHNlY3VyZVNlcnZpY2VVcmwgKyBkZXZUb2tlbjtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc2VydmljZVNjaGVtZSArICgod2luZG93LmxvY2F0aW9uLnByb3RvY29sID09PSAnaHR0cHM6JykgPyBzZWN1cmVTZXJ2aWNlVXJsIDogc2VydmljZVVybCkgKyBkZXZUb2tlbjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVhIUihjYikge1xuICAgIHZhciB4aHI7XG5cbiAgICB0cnkge1xuICAgICAgICB4aHIgPSBuZXcgd2luZG93LlhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIGxvZ0RlYnVnKCdFcnJvciBjcmVhdGluZyBYTUxIdHRwUmVxdWVzdCBvYmplY3QuJyk7XG4gICAgfVxuXG4gICAgaWYgKHhociAmJiBjYiAmJiAnd2l0aENyZWRlbnRpYWxzJyBpbiB4aHIpIHtcbiAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGNiO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygd2luZG93LlhEb21haW5SZXF1ZXN0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBsb2dEZWJ1ZygnQ3JlYXRpbmcgWERvbWFpblJlcXVlc3Qgb2JqZWN0Jyk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHhociA9IG5ldyB3aW5kb3cuWERvbWFpblJlcXVlc3QoKTtcbiAgICAgICAgICAgIHhoci5vbmxvYWQgPSBjYjtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9nRGVidWcoJ0Vycm9yIGNyZWF0aW5nIFhEb21haW5SZXF1ZXN0IG9iamVjdCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHhocjtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVSYW5kb21WYWx1ZShhKSB7XG4gICAgdmFyIHJhbmRvbVZhbHVlO1xuICAgIGlmICh3aW5kb3cuY3J5cHRvICYmIHdpbmRvdy5jcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKSB7XG4gICAgICAgIHJhbmRvbVZhbHVlID0gd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMSkpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVuZGVmXG4gICAgfVxuICAgIGlmIChyYW5kb21WYWx1ZSkge1xuICAgICAgICByZXR1cm4gKGEgXiByYW5kb21WYWx1ZVswXSAlIDE2ID4+IGEvNCkudG9TdHJpbmcoMTYpO1xuICAgIH1cblxuICAgIHJldHVybiAoYSBeIE1hdGgucmFuZG9tKCkgKiAxNiA+PiBhLzQpLnRvU3RyaW5nKDE2KTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVVbmlxdWVJZChhKSB7XG4gICAgLy8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuICAgIC8vIEFkZGVkIHN1cHBvcnQgZm9yIGNyeXB0byBmb3IgYmV0dGVyIHJhbmRvbVxuXG4gICAgcmV0dXJuIGEgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaWYgdGhlIHBsYWNlaG9sZGVyIHdhcyBwYXNzZWQsIHJldHVyblxuICAgICAgICAgICAgPyBnZW5lcmF0ZVJhbmRvbVZhbHVlKGEpICAgIC8vIGEgcmFuZG9tIG51bWJlclxuICAgICAgICAgICAgOiAoICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG9yIG90aGVyd2lzZSBhIGNvbmNhdGVuYXRlZCBzdHJpbmc6XG4gICAgICAgICAgICBbMWU3XSArICAgICAgICAgICAgICAgICAgICAgLy8gMTAwMDAwMDAgK1xuICAgICAgICAgICAgLTFlMyArICAgICAgICAgICAgICAgICAgICAgIC8vIC0xMDAwICtcbiAgICAgICAgICAgIC00ZTMgKyAgICAgICAgICAgICAgICAgICAgICAvLyAtNDAwMCArXG4gICAgICAgICAgICAtOGUzICsgICAgICAgICAgICAgICAgICAgICAgLy8gLTgwMDAwMDAwICtcbiAgICAgICAgICAgIC0xZTExICAgICAgICAgICAgICAgICAgICAgICAvLyAtMTAwMDAwMDAwMDAwLFxuICAgICAgICAgICAgKS5yZXBsYWNlKCAgICAgICAgICAgICAgICAgIC8vIHJlcGxhY2luZ1xuICAgICAgICAgICAgICAgIC9bMDE4XS9nLCAgICAgICAgICAgICAgIC8vIHplcm9lcywgb25lcywgYW5kIGVpZ2h0cyB3aXRoXG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVVbmlxdWVJZCAgICAgICAgLy8gcmFuZG9tIGhleCBkaWdpdHNcbiAgICAgICAgICAgICk7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzT2JqZWN0LCBmaWx0ZXJMaXN0KSB7XG4gICAgdmFyIGZpbHRlcmVkVXNlcklkZW50aXRpZXMgPSBbXTtcblxuICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdCAmJiBPYmplY3Qua2V5cyh1c2VySWRlbnRpdGllc09iamVjdCkubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIHVzZXJJZGVudGl0eU5hbWUgaW4gdXNlcklkZW50aXRpZXNPYmplY3QpIHtcbiAgICAgICAgICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdC5oYXNPd25Qcm9wZXJ0eSh1c2VySWRlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWRlbnRpdHlUeXBlID0gVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZSh1c2VySWRlbnRpdHlOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAoIWluQXJyYXkoZmlsdGVyTGlzdCwgdXNlcklkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlkZW50aXR5ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgVHlwZTogdXNlcklkZW50aXR5VHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIElkZW50aXR5OiB1c2VySWRlbnRpdGllc09iamVjdFt1c2VySWRlbnRpdHlOYW1lXVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlcklkZW50aXR5VHlwZSA9PT0gbVBhcnRpY2xlLklkZW50aXR5VHlwZS5DdXN0b21lcklkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzLnVuc2hpZnQoaWRlbnRpdHkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllcy5wdXNoKGlkZW50aXR5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnModXNlcklkZW50aXRpZXNPYmplY3QsIGZpbHRlckxpc3QpIHtcbiAgICB2YXIgZmlsdGVyZWRVc2VySWRlbnRpdGllcyA9IHt9O1xuXG4gICAgaWYgKHVzZXJJZGVudGl0aWVzT2JqZWN0ICYmIE9iamVjdC5rZXlzKHVzZXJJZGVudGl0aWVzT2JqZWN0KS5sZW5ndGgpIHtcbiAgICAgICAgZm9yICh2YXIgdXNlcklkZW50aXR5TmFtZSBpbiB1c2VySWRlbnRpdGllc09iamVjdCkge1xuICAgICAgICAgICAgaWYgKHVzZXJJZGVudGl0aWVzT2JqZWN0Lmhhc093blByb3BlcnR5KHVzZXJJZGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgdmFyIHVzZXJJZGVudGl0eVR5cGUgPSBUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKHVzZXJJZGVudGl0eU5hbWUpO1xuICAgICAgICAgICAgICAgIGlmICghaW5BcnJheShmaWx0ZXJMaXN0LCB1c2VySWRlbnRpdHlUeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzW3VzZXJJZGVudGl0eU5hbWVdID0gdXNlcklkZW50aXRpZXNPYmplY3RbdXNlcklkZW50aXR5TmFtZV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbHRlcmVkVXNlcklkZW50aXRpZXM7XG59XG5cbmZ1bmN0aW9uIGZpbHRlclVzZXJBdHRyaWJ1dGVzKHVzZXJBdHRyaWJ1dGVzLCBmaWx0ZXJMaXN0KSB7XG4gICAgdmFyIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXMgPSB7fTtcblxuICAgIGlmICh1c2VyQXR0cmlidXRlcyAmJiBPYmplY3Qua2V5cyh1c2VyQXR0cmlidXRlcykubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIHVzZXJBdHRyaWJ1dGUgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eSh1c2VyQXR0cmlidXRlKSkge1xuICAgICAgICAgICAgICAgIHZhciBoYXNoZWRVc2VyQXR0cmlidXRlID0gZ2VuZXJhdGVIYXNoKHVzZXJBdHRyaWJ1dGUpO1xuICAgICAgICAgICAgICAgIGlmICghaW5BcnJheShmaWx0ZXJMaXN0LCBoYXNoZWRVc2VyQXR0cmlidXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJlZFVzZXJBdHRyaWJ1dGVzW3VzZXJBdHRyaWJ1dGVdID0gdXNlckF0dHJpYnV0ZXNbdXNlckF0dHJpYnV0ZV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXM7XG59XG5cbmZ1bmN0aW9uIGZpbmRLZXlJbk9iamVjdChvYmosIGtleSkge1xuICAgIGlmIChrZXkgJiYgb2JqKSB7XG4gICAgICAgIGZvciAodmFyIHByb3AgaW4gb2JqKSB7XG4gICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KHByb3ApICYmIHByb3AudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBkZWNvZGVkKHMpIHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHMucmVwbGFjZShwbHVzZXMsICcgJykpO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0ZWQocykge1xuICAgIGlmIChzLmluZGV4T2YoJ1wiJykgPT09IDApIHtcbiAgICAgICAgcyA9IHMuc2xpY2UoMSwgLTEpLnJlcGxhY2UoL1xcXFxcIi9nLCAnXCInKS5yZXBsYWNlKC9cXFxcXFxcXC9nLCAnXFxcXCcpO1xuICAgIH1cblxuICAgIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBpc0V2ZW50VHlwZSh0eXBlKSB7XG4gICAgZm9yICh2YXIgcHJvcCBpbiBUeXBlcy5FdmVudFR5cGUpIHtcbiAgICAgICAgaWYgKFR5cGVzLkV2ZW50VHlwZS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgaWYgKFR5cGVzLkV2ZW50VHlwZVtwcm9wXSA9PT0gdHlwZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gcGFyc2VOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAoaXNOYU4odmFsdWUpIHx8ICFpc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICAgIHZhciBmbG9hdFZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKGZsb2F0VmFsdWUpID8gMCA6IGZsb2F0VmFsdWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU3RyaW5nT3JOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAoVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZW5lcmF0ZUhhc2gobmFtZSkge1xuICAgIHZhciBoYXNoID0gMCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGNoYXJhY3RlcjtcblxuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgfHwgbmFtZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBuYW1lID0gbmFtZS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7XG5cbiAgICBpZiAoQXJyYXkucHJvdG90eXBlLnJlZHVjZSkge1xuICAgICAgICByZXR1cm4gbmFtZS5zcGxpdCgnJykucmVkdWNlKGZ1bmN0aW9uKGEsIGIpIHsgYSA9ICgoYSA8PCA1KSAtIGEpICsgYi5jaGFyQ29kZUF0KDApOyByZXR1cm4gYSAmIGE7IH0sIDApO1xuICAgIH1cblxuICAgIGlmIChuYW1lLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gaGFzaDtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbmFtZS5sZW5ndGg7IGkrKykge1xuICAgICAgICBjaGFyYWN0ZXIgPSBuYW1lLmNoYXJDb2RlQXQoaSk7XG4gICAgICAgIGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIGNoYXJhY3RlcjtcbiAgICAgICAgaGFzaCA9IGhhc2ggJiBoYXNoO1xuICAgIH1cblxuICAgIHJldHVybiBoYXNoO1xufVxuXG5mdW5jdGlvbiBzYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cnMpIHtcbiAgICBpZiAoIWF0dHJzIHx8ICFpc09iamVjdChhdHRycykpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgdmFyIHNhbml0aXplZEF0dHJzID0ge307XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIGF0dHJzKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IGF0dHJpYnV0ZSB2YWx1ZXMgYXJlIG5vdCBvYmplY3RzIG9yIGFycmF5cywgd2hpY2ggYXJlIG5vdCB2YWxpZFxuICAgICAgICBpZiAoYXR0cnMuaGFzT3duUHJvcGVydHkocHJvcCkgJiYgVmFsaWRhdG9ycy5pc1ZhbGlkQXR0cmlidXRlVmFsdWUoYXR0cnNbcHJvcF0pKSB7XG4gICAgICAgICAgICBzYW5pdGl6ZWRBdHRyc1twcm9wXSA9IGF0dHJzW3Byb3BdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nRGVidWcoJ1RoZSBhdHRyaWJ1dGUga2V5IG9mICcgKyBwcm9wICsgJyBtdXN0IGJlIGEgc3RyaW5nLCBudW1iZXIsIGJvb2xlYW4sIG9yIG51bGwuJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2FuaXRpemVkQXR0cnM7XG59XG5cbmZ1bmN0aW9uIG1lcmdlQ29uZmlnKGNvbmZpZykge1xuICAgIGxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuTG9hZGluZ0NvbmZpZyk7XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIENvbnN0YW50cy5EZWZhdWx0Q29uZmlnKSB7XG4gICAgICAgIGlmIChDb25zdGFudHMuRGVmYXVsdENvbmZpZy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgTVAuQ29uZmlnW3Byb3BdID0gQ29uc3RhbnRzLkRlZmF1bHRDb25maWdbcHJvcF07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICBNUC5Db25maWdbcHJvcF0gPSBjb25maWdbcHJvcF07XG4gICAgICAgIH1cbiAgICB9XG59XG5cbnZhciBWYWxpZGF0b3JzID0ge1xuICAgIGlzVmFsaWRBdHRyaWJ1dGVWYWx1ZTogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWlzT2JqZWN0KHZhbHVlKSAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG4gICAgfSxcblxuICAgIC8vIE5laXRoZXIgbnVsbCBub3IgdW5kZWZpbmVkIGNhbiBiZSBhIHZhbGlkIEtleVxuICAgIGlzVmFsaWRLZXlWYWx1ZTogZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGtleSAmJiAhaXNPYmplY3Qoa2V5KSAmJiAhQXJyYXkuaXNBcnJheShrZXkpKTtcbiAgICB9LFxuXG4gICAgaXNTdHJpbmdPck51bWJlcjogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpO1xuICAgIH0sXG5cbiAgICBpc0Z1bmN0aW9uOiBmdW5jdGlvbihmbikge1xuICAgICAgICByZXR1cm4gdHlwZW9mIGZuID09PSAnZnVuY3Rpb24nO1xuICAgIH0sXG5cbiAgICB2YWxpZGF0ZUlkZW50aXRpZXM6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgbWV0aG9kKSB7XG4gICAgICAgIHZhciB2YWxpZElkZW50aXR5UmVxdWVzdEtleXMgPSB7XG4gICAgICAgICAgICB1c2VySWRlbnRpdGllczogMSxcbiAgICAgICAgICAgIG9uVXNlckFsaWFzOiAxLFxuICAgICAgICAgICAgY29weVVzZXJBdHRyaWJ1dGVzOiAxXG4gICAgICAgIH07XG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEpIHtcbiAgICAgICAgICAgIGlmIChtZXRob2QgPT09ICdtb2RpZnknKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlzT2JqZWN0KGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykgJiYgIU9iamVjdC5rZXlzKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykubGVuZ3RoIHx8ICFpc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Nb2RpZnlJZGVudGl0eVJlcXVlc3RVc2VySWRlbnRpdGllc1ByZXNlbnRcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdmFsaWRJZGVudGl0eVJlcXVlc3RLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLklkZW50aXR5UmVxdWVzZXRJbnZhbGlkS2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChrZXkgPT09ICdvblVzZXJBbGlhcycgJiYgIVZhbGlkYXRvcnMuaXNGdW5jdGlvbihpZGVudGl0eUFwaURhdGFba2V5XSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLk9uVXNlckFsaWFzVHlwZSArIHR5cGVvZiBpZGVudGl0eUFwaURhdGFba2V5XVxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzIGNhbid0IGJlIHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAvLyBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgY2FuIGJlIG51bGwsIGJ1dCBpZiBpdCBpc24ndCBudWxsIG9yIHVuZGVmaW5lZCAoYWJvdmUgY29uZGl0aW9uYWwpLCBpdCBtdXN0IGJlIGFuIG9iamVjdFxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzICE9PSBudWxsICYmICFpc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Vc2VySWRlbnRpdGllc1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSAmJiBPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpZGVudGl0eVR5cGUgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzLmhhc093blByb3BlcnR5KGlkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShpZGVudGl0eVR5cGUpID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNJbnZhbGlkS2V5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghKHR5cGVvZiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNbaWRlbnRpdHlUeXBlXSA9PT0gJ3N0cmluZycgfHwgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzW2lkZW50aXR5VHlwZV0gPT09IG51bGwpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5Vc2VySWRlbnRpdGllc0ludmFsaWRWYWx1ZXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuZnVuY3Rpb24gaXNEZWxheWVkQnlJbnRlZ3JhdGlvbihkZWxheWVkSW50ZWdyYXRpb25zLCB0aW1lb3V0U3RhcnQsIG5vdykge1xuICAgIGlmIChub3cgLSB0aW1lb3V0U3RhcnQgPiBtUGFydGljbGUuaW50ZWdyYXRpb25EZWxheVRpbWVvdXQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBmb3IgKHZhciBpbnRlZ3JhdGlvbiBpbiBkZWxheWVkSW50ZWdyYXRpb25zKSB7XG4gICAgICAgIGlmIChkZWxheWVkSW50ZWdyYXRpb25zW2ludGVncmF0aW9uXSA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIGV2ZW50cyBleGlzdCBpbiB0aGUgZXZlbnRRdWV1ZSBiZWNhdXNlIHRoZXkgd2VyZSB0cmlnZ2VyZWQgd2hlbiB0aGUgaWRlbnRpdHlBUEkgcmVxdWVzdCB3YXMgaW4gZmxpZ2h0XG4vLyBvbmNlIEFQSSByZXF1ZXN0IHJldHVybnMgYW5kIHRoZXJlIGlzIGFuIE1QSUQsIGV2ZW50UXVldWUgaXRlbXMgYXJlIHJlYXNzaWduZWQgd2l0aCB0aGUgcmV0dXJuZWQgTVBJRCBhbmQgZmx1c2hlZFxuZnVuY3Rpb24gcHJvY2Vzc1F1ZXVlZEV2ZW50cyhldmVudFF1ZXVlLCBtcGlkLCByZXF1aXJlRGVsYXksIHNlbmRFdmVudFRvU2VydmVyLCBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsIHBhcnNlRXZlbnRSZXNwb25zZSkge1xuICAgIGlmIChldmVudFF1ZXVlLmxlbmd0aCAmJiBtcGlkICYmIHJlcXVpcmVEZWxheSkge1xuICAgICAgICB2YXIgbG9jYWxRdWV1ZUNvcHkgPSBldmVudFF1ZXVlO1xuICAgICAgICBNUC5ldmVudFF1ZXVlID0gW107XG4gICAgICAgIGxvY2FsUXVldWVDb3B5LmZvckVhY2goZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50Lk1QSUQgPSBtcGlkO1xuICAgICAgICAgICAgc2VuZEV2ZW50VG9TZXJ2ZXIoZXZlbnQsIHNlbmRFdmVudFRvRm9yd2FyZGVycywgcGFyc2VFdmVudFJlc3BvbnNlKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVNYWluU3RvcmFnZU5hbWUod29ya3NwYWNlVG9rZW4pIHtcbiAgICBpZiAod29ya3NwYWNlVG9rZW4pIHtcbiAgICAgICAgcmV0dXJuIENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLkN1cnJlbnRTdG9yYWdlTmFtZSArICdfJyArIHdvcmtzcGFjZVRva2VuO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBDb25zdGFudHMuRGVmYXVsdENvbmZpZy5DdXJyZW50U3RvcmFnZU5hbWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9kdWN0U3RvcmFnZU5hbWUod29ya3NwYWNlVG9rZW4pIHtcbiAgICBpZiAod29ya3NwYWNlVG9rZW4pIHtcbiAgICAgICAgcmV0dXJuIENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLkN1cnJlbnRTdG9yYWdlUHJvZHVjdHNOYW1lICsgJ18nICsgd29ya3NwYWNlVG9rZW47XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLkN1cnJlbnRTdG9yYWdlUHJvZHVjdHNOYW1lO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nRGVidWc6IGxvZ0RlYnVnLFxuICAgIGNhbkxvZzogY2FuTG9nLFxuICAgIGV4dGVuZDogZXh0ZW5kLFxuICAgIGlzT2JqZWN0OiBpc09iamVjdCxcbiAgICBpbkFycmF5OiBpbkFycmF5LFxuICAgIGNyZWF0ZVNlcnZpY2VVcmw6IGNyZWF0ZVNlcnZpY2VVcmwsXG4gICAgY3JlYXRlWEhSOiBjcmVhdGVYSFIsXG4gICAgZ2VuZXJhdGVVbmlxdWVJZDogZ2VuZXJhdGVVbmlxdWVJZCxcbiAgICBmaWx0ZXJVc2VySWRlbnRpdGllczogZmlsdGVyVXNlcklkZW50aXRpZXMsXG4gICAgZmlsdGVyVXNlcklkZW50aXRpZXNGb3JGb3J3YXJkZXJzOiBmaWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnMsXG4gICAgZmlsdGVyVXNlckF0dHJpYnV0ZXM6IGZpbHRlclVzZXJBdHRyaWJ1dGVzLFxuICAgIGZpbmRLZXlJbk9iamVjdDogZmluZEtleUluT2JqZWN0LFxuICAgIGRlY29kZWQ6IGRlY29kZWQsXG4gICAgY29udmVydGVkOiBjb252ZXJ0ZWQsXG4gICAgaXNFdmVudFR5cGU6IGlzRXZlbnRUeXBlLFxuICAgIHBhcnNlTnVtYmVyOiBwYXJzZU51bWJlcixcbiAgICBwYXJzZVN0cmluZ09yTnVtYmVyOiBwYXJzZVN0cmluZ09yTnVtYmVyLFxuICAgIGdlbmVyYXRlSGFzaDogZ2VuZXJhdGVIYXNoLFxuICAgIHNhbml0aXplQXR0cmlidXRlczogc2FuaXRpemVBdHRyaWJ1dGVzLFxuICAgIG1lcmdlQ29uZmlnOiBtZXJnZUNvbmZpZyxcbiAgICByZXR1cm5Db252ZXJ0ZWRCb29sZWFuOiByZXR1cm5Db252ZXJ0ZWRCb29sZWFuLFxuICAgIGludm9rZUNhbGxiYWNrOiBpbnZva2VDYWxsYmFjayxcbiAgICBoYXNGZWF0dXJlRmxhZzogaGFzRmVhdHVyZUZsYWcsXG4gICAgaXNEZWxheWVkQnlJbnRlZ3JhdGlvbjogaXNEZWxheWVkQnlJbnRlZ3JhdGlvbixcbiAgICBwcm9jZXNzUXVldWVkRXZlbnRzOiBwcm9jZXNzUXVldWVkRXZlbnRzLFxuICAgIGNyZWF0ZU1haW5TdG9yYWdlTmFtZTogY3JlYXRlTWFpblN0b3JhZ2VOYW1lLFxuICAgIGNyZWF0ZVByb2R1Y3RTdG9yYWdlTmFtZTogY3JlYXRlUHJvZHVjdFN0b3JhZ2VOYW1lLFxuICAgIFZhbGlkYXRvcnM6IFZhbGlkYXRvcnNcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgU2VydmVyTW9kZWwgPSByZXF1aXJlKCcuL3NlcnZlck1vZGVsJyksXG4gICAgRm9yd2FyZGVycyA9IHJlcXVpcmUoJy4vZm9yd2FyZGVycycpLFxuICAgIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIE1lc3NhZ2VzID0gQ29uc3RhbnRzLk1lc3NhZ2VzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIE5hdGl2ZVNka0hlbHBlcnMgPSByZXF1aXJlKCcuL25hdGl2ZVNka0hlbHBlcnMnKSxcbiAgICBWYWxpZGF0b3JzID0gSGVscGVycy5WYWxpZGF0b3JzLFxuICAgIHNlbmRJZGVudGl0eVJlcXVlc3QgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLnNlbmRJZGVudGl0eVJlcXVlc3QsXG4gICAgQ29va2llU3luY01hbmFnZXIgPSByZXF1aXJlKCcuL2Nvb2tpZVN5bmNNYW5hZ2VyJyksXG4gICAgc2VuZEV2ZW50VG9TZXJ2ZXIgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLnNlbmRFdmVudFRvU2VydmVyLFxuICAgIEhUVFBDb2RlcyA9IENvbnN0YW50cy5IVFRQQ29kZXMsXG4gICAgRXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKSxcbiAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnMgPSByZXF1aXJlKCcuL2ZvcndhcmRlcnMnKS5zZW5kRXZlbnRUb0ZvcndhcmRlcnM7XG5cbnZhciBJZGVudGl0eSA9IHtcbiAgICBjaGVja0lkZW50aXR5U3dhcDogZnVuY3Rpb24ocHJldmlvdXNNUElELCBjdXJyZW50TVBJRCkge1xuICAgICAgICBpZiAocHJldmlvdXNNUElEICYmIGN1cnJlbnRNUElEICYmIHByZXZpb3VzTVBJRCAhPT0gY3VycmVudE1QSUQpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UudXNlTG9jYWxTdG9yYWdlKCkgPyBQZXJzaXN0ZW5jZS5nZXRMb2NhbFN0b3JhZ2UoKSA6IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpO1xuICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgY3VycmVudE1QSUQpO1xuICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG52YXIgSWRlbnRpdHlSZXF1ZXN0ID0ge1xuICAgIGNyZWF0ZUtub3duSWRlbnRpdGllczogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBkZXZpY2VJZCkge1xuICAgICAgICB2YXIgaWRlbnRpdGllc1Jlc3VsdCA9IHt9O1xuXG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHkgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWRlbnRpdGllc1Jlc3VsdFtpZGVudGl0eV0gPSBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNbaWRlbnRpdHldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlkZW50aXRpZXNSZXN1bHQuZGV2aWNlX2FwcGxpY2F0aW9uX3N0YW1wID0gZGV2aWNlSWQ7XG5cbiAgICAgICAgcmV0dXJuIGlkZW50aXRpZXNSZXN1bHQ7XG4gICAgfSxcblxuICAgIHByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3Q6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssIG1ldGhvZCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dFdmVudCArICc6ICcgKyBtZXRob2QpO1xuXG4gICAgICAgIHZhciBpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQgPSBWYWxpZGF0b3JzLnZhbGlkYXRlSWRlbnRpdGllcyhpZGVudGl0eUFwaURhdGEsIG1ldGhvZCk7XG5cbiAgICAgICAgaWYgKCFpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQudmFsaWQpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0VSUk9SOiAnICsgaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGVycm9yOiBpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQuZXJyb3JcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2FsbGJhY2sgJiYgIVZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgIHZhciBlcnJvciA9ICdUaGUgb3B0aW9uYWwgY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uLiBZb3UgdHJpZWQgZW50ZXJpbmcgYShuKSAnICsgdHlwZW9mIGNhbGxiYWNrO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhlcnJvcik7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3JcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0Lndhcm5pbmcpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1dBUk5JTkc6JyArIGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC53YXJuaW5nKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdmFsaWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgZXJyb3I6IGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC53YXJuaW5nXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgIH07XG4gICAgfSxcblxuICAgIGNyZWF0ZUlkZW50aXR5UmVxdWVzdDogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBwbGF0Zm9ybSwgc2RrVmVuZG9yLCBzZGtWZXJzaW9uLCBkZXZpY2VJZCwgY29udGV4dCwgbXBpZCkge1xuICAgICAgICB2YXIgQVBJUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGNsaWVudF9zZGs6IHtcbiAgICAgICAgICAgICAgICBwbGF0Zm9ybTogcGxhdGZvcm0sXG4gICAgICAgICAgICAgICAgc2RrX3ZlbmRvcjogc2RrVmVuZG9yLFxuICAgICAgICAgICAgICAgIHNka192ZXJzaW9uOiBzZGtWZXJzaW9uXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgPyAnZGV2ZWxvcG1lbnQnIDogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICAgICAgcmVxdWVzdF9pZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICByZXF1ZXN0X3RpbWVzdGFtcF9tczogbmV3IERhdGUoKS5nZXRUaW1lKCksXG4gICAgICAgICAgICBwcmV2aW91c19tcGlkOiBtcGlkIHx8IG51bGwsXG4gICAgICAgICAgICBrbm93bl9pZGVudGl0aWVzOiB0aGlzLmNyZWF0ZUtub3duSWRlbnRpdGllcyhpZGVudGl0eUFwaURhdGEsIGRldmljZUlkKVxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBBUElSZXF1ZXN0O1xuICAgIH0sXG5cbiAgICBjcmVhdGVNb2RpZnlJZGVudGl0eVJlcXVlc3Q6IGZ1bmN0aW9uKGN1cnJlbnRVc2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMsIHBsYXRmb3JtLCBzZGtWZW5kb3IsIHNka1ZlcnNpb24sIGNvbnRleHQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNsaWVudF9zZGs6IHtcbiAgICAgICAgICAgICAgICBwbGF0Zm9ybTogcGxhdGZvcm0sXG4gICAgICAgICAgICAgICAgc2RrX3ZlbmRvcjogc2RrVmVuZG9yLFxuICAgICAgICAgICAgICAgIHNka192ZXJzaW9uOiBzZGtWZXJzaW9uXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgPyAnZGV2ZWxvcG1lbnQnIDogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICAgICAgcmVxdWVzdF9pZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICByZXF1ZXN0X3RpbWVzdGFtcF9tczogbmV3IERhdGUoKS5nZXRUaW1lKCksXG4gICAgICAgICAgICBpZGVudGl0eV9jaGFuZ2VzOiB0aGlzLmNyZWF0ZUlkZW50aXR5Q2hhbmdlcyhjdXJyZW50VXNlcklkZW50aXRpZXMsIG5ld1VzZXJJZGVudGl0aWVzKVxuICAgICAgICB9O1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZGVudGl0eUNoYW5nZXM6IGZ1bmN0aW9uKHByZXZpb3VzSWRlbnRpdGllcywgbmV3SWRlbnRpdGllcykge1xuICAgICAgICB2YXIgaWRlbnRpdHlDaGFuZ2VzID0gW107XG4gICAgICAgIHZhciBrZXk7XG4gICAgICAgIGlmIChuZXdJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QobmV3SWRlbnRpdGllcykgJiYgcHJldmlvdXNJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QocHJldmlvdXNJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgZm9yIChrZXkgaW4gbmV3SWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgIGlkZW50aXR5Q2hhbmdlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgb2xkX3ZhbHVlOiBwcmV2aW91c0lkZW50aXRpZXNbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShrZXkpXSB8fCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBuZXdfdmFsdWU6IG5ld0lkZW50aXRpZXNba2V5XSxcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlfdHlwZToga2V5XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWRlbnRpdHlDaGFuZ2VzO1xuICAgIH0sXG5cbiAgICBtb2RpZnlVc2VySWRlbnRpdGllczogZnVuY3Rpb24ocHJldmlvdXNVc2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgdmFyIG1vZGlmaWVkVXNlcklkZW50aXRpZXMgPSB7fTtcblxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gbmV3VXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgIG1vZGlmaWVkVXNlcklkZW50aXRpZXNbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShrZXkpXSA9IG5ld1VzZXJJZGVudGl0aWVzW2tleV07XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGtleSBpbiBwcmV2aW91c1VzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGlmaWVkVXNlcklkZW50aXRpZXNba2V5XSkge1xuICAgICAgICAgICAgICAgIG1vZGlmaWVkVXNlcklkZW50aXRpZXNba2V5XSA9IHByZXZpb3VzVXNlcklkZW50aXRpZXNba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtb2RpZmllZFVzZXJJZGVudGl0aWVzO1xuICAgIH0sXG5cbiAgICBjb252ZXJ0VG9OYXRpdmU6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSkge1xuICAgICAgICB2YXIgbmF0aXZlSWRlbnRpdHlSZXF1ZXN0ID0gW107XG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIG5hdGl2ZUlkZW50aXR5UmVxdWVzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFR5cGU6IFR5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eVR5cGUoa2V5KSxcbiAgICAgICAgICAgICAgICAgICAgICAgIElkZW50aXR5OiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNba2V5XVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgVXNlcklkZW50aXRpZXM6IG5hdGl2ZUlkZW50aXR5UmVxdWVzdFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbn07XG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eSBvYmplY3QuXG4qIEV4YW1wbGU6IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLlxuKiBAY2xhc3MgbVBhcnRpY2xlLklkZW50aXR5XG4qL1xudmFyIElkZW50aXR5QVBJID0ge1xuICAgIEhUVFBDb2RlczogSFRUUENvZGVzLFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBsb2dvdXQgcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBpZGVudGlmeVxuICAgICogQHBhcmFtIHtPYmplY3R9IGlkZW50aXR5QXBpRGF0YSBUaGUgaWRlbnRpdHlBcGlEYXRhIG9iamVjdCBhcyBpbmRpY2F0ZWQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL1JFQURNRS5tZCMxLWN1c3RvbWl6ZS10aGUtc2RrKVxuICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBBIGNhbGxiYWNrIGZ1bmN0aW9uIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGlkZW50aWZ5IHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBpZGVudGlmeTogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcHJlUHJvY2Vzc1Jlc3VsdCA9IElkZW50aXR5UmVxdWVzdC5wcmVQcm9jZXNzSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssICdpZGVudGlmeScpO1xuXG4gICAgICAgIGlmIChwcmVQcm9jZXNzUmVzdWx0LnZhbGlkKSB7XG4gICAgICAgICAgICB2YXIgaWRlbnRpdHlBcGlSZXF1ZXN0ID0gSWRlbnRpdHlSZXF1ZXN0LmNyZWF0ZUlkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIENvbnN0YW50cy5wbGF0Zm9ybSwgQ29uc3RhbnRzLnNka1ZlbmRvciwgQ29uc3RhbnRzLnNka1ZlcnNpb24sIE1QLmRldmljZUlkLCBNUC5jb250ZXh0LCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLklkZW50aWZ5LCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ0lkZW50aWZ5IHJlcXVlc3Qgc2VudCB0byBuYXRpdmUgc2RrJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc2VuZElkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaVJlcXVlc3QsICdpZGVudGlmeScsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLmxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleSwgTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLnZhbGlkYXRpb25Jc3N1ZSwgcHJlUHJvY2Vzc1Jlc3VsdC5lcnJvcik7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHByZVByb2Nlc3NSZXN1bHQpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICAvKipcbiAgICAqIEluaXRpYXRlIGEgbG9nb3V0IHJlcXVlc3QgdG8gdGhlIG1QYXJ0aWNsZSBzZXJ2ZXJcbiAgICAqIEBtZXRob2QgbG9nb3V0XG4gICAgKiBAcGFyYW0ge09iamVjdH0gaWRlbnRpdHlBcGlEYXRhIFRoZSBpZGVudGl0eUFwaURhdGEgb2JqZWN0IGFzIGluZGljYXRlZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvUkVBRE1FLm1kIzEtY3VzdG9taXplLXRoZS1zZGspXG4gICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIEEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiB0aGUgbG9nb3V0IHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBsb2dvdXQ6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHByZVByb2Nlc3NSZXN1bHQgPSBJZGVudGl0eVJlcXVlc3QucHJlUHJvY2Vzc0lkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIGNhbGxiYWNrLCAnbG9nb3V0Jyk7XG5cbiAgICAgICAgaWYgKHByZVByb2Nlc3NSZXN1bHQudmFsaWQpIHtcbiAgICAgICAgICAgIHZhciBldnQsXG4gICAgICAgICAgICAgICAgaWRlbnRpdHlBcGlSZXF1ZXN0ID0gSWRlbnRpdHlSZXF1ZXN0LmNyZWF0ZUlkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIENvbnN0YW50cy5wbGF0Zm9ybSwgQ29uc3RhbnRzLnNka1ZlbmRvciwgQ29uc3RhbnRzLnNka1ZlcnNpb24sIE1QLmRldmljZUlkLCBNUC5jb250ZXh0LCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLkxvZ291dCwgSlNPTi5zdHJpbmdpZnkoSWRlbnRpdHlSZXF1ZXN0LmNvbnZlcnRUb05hdGl2ZShpZGVudGl0eUFwaURhdGEpKSk7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy5uYXRpdmVJZGVudGl0eVJlcXVlc3QsICdMb2dvdXQgcmVxdWVzdCBzZW50IHRvIG5hdGl2ZSBzZGsnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgJ2xvZ291dCcsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgICAgIGV2dCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLlByb2ZpbGUpO1xuICAgICAgICAgICAgICAgICAgICBldnQuUHJvZmlsZU1lc3NhZ2VUeXBlID0gVHlwZXMuUHJvZmlsZU1lc3NhZ2VUeXBlLkxvZ291dDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZvcndhcmRlci5sb2dPdXQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yd2FyZGVyLmxvZ091dChldnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLmxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleSwgTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLnZhbGlkYXRpb25Jc3N1ZSwgcHJlUHJvY2Vzc1Jlc3VsdC5lcnJvcik7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHByZVByb2Nlc3NSZXN1bHQpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICAvKipcbiAgICAqIEluaXRpYXRlIGEgbG9naW4gcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBsb2dpblxuICAgICogQHBhcmFtIHtPYmplY3R9IGlkZW50aXR5QXBpRGF0YSBUaGUgaWRlbnRpdHlBcGlEYXRhIG9iamVjdCBhcyBpbmRpY2F0ZWQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL1JFQURNRS5tZCMxLWN1c3RvbWl6ZS10aGUtc2RrKVxuICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBBIGNhbGxiYWNrIGZ1bmN0aW9uIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGxvZ2luIHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBsb2dpbjogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcHJlUHJvY2Vzc1Jlc3VsdCA9IElkZW50aXR5UmVxdWVzdC5wcmVQcm9jZXNzSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssICdsb2dpbicpO1xuXG4gICAgICAgIGlmIChwcmVQcm9jZXNzUmVzdWx0LnZhbGlkKSB7XG4gICAgICAgICAgICB2YXIgaWRlbnRpdHlBcGlSZXF1ZXN0ID0gSWRlbnRpdHlSZXF1ZXN0LmNyZWF0ZUlkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIENvbnN0YW50cy5wbGF0Zm9ybSwgQ29uc3RhbnRzLnNka1ZlbmRvciwgQ29uc3RhbnRzLnNka1ZlcnNpb24sIE1QLmRldmljZUlkLCBNUC5jb250ZXh0LCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLkxvZ2luLCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ0xvZ2luIHJlcXVlc3Qgc2VudCB0byBuYXRpdmUgc2RrJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc2VuZElkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaVJlcXVlc3QsICdsb2dpbicsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLmxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleSwgTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLnZhbGlkYXRpb25Jc3N1ZSwgcHJlUHJvY2Vzc1Jlc3VsdC5lcnJvcik7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHByZVByb2Nlc3NSZXN1bHQpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICAvKipcbiAgICAqIEluaXRpYXRlIGEgbW9kaWZ5IHJlcXVlc3QgdG8gdGhlIG1QYXJ0aWNsZSBzZXJ2ZXJcbiAgICAqIEBtZXRob2QgbW9kaWZ5XG4gICAgKiBAcGFyYW0ge09iamVjdH0gaWRlbnRpdHlBcGlEYXRhIFRoZSBpZGVudGl0eUFwaURhdGEgb2JqZWN0IGFzIGluZGljYXRlZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvUkVBRE1FLm1kIzEtY3VzdG9taXplLXRoZS1zZGspXG4gICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIEEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiB0aGUgbW9kaWZ5IHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBtb2RpZnk6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG5ld1VzZXJJZGVudGl0aWVzID0gKGlkZW50aXR5QXBpRGF0YSAmJiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpID8gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzIDoge307XG4gICAgICAgIHZhciBwcmVQcm9jZXNzUmVzdWx0ID0gSWRlbnRpdHlSZXF1ZXN0LnByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaywgJ21vZGlmeScpO1xuICAgICAgICBpZiAocHJlUHJvY2Vzc1Jlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgdmFyIGlkZW50aXR5QXBpUmVxdWVzdCA9IElkZW50aXR5UmVxdWVzdC5jcmVhdGVNb2RpZnlJZGVudGl0eVJlcXVlc3QoTVAudXNlcklkZW50aXRpZXMsIG5ld1VzZXJJZGVudGl0aWVzLCBDb25zdGFudHMucGxhdGZvcm0sIENvbnN0YW50cy5zZGtWZW5kb3IsIENvbnN0YW50cy5zZGtWZXJzaW9uLCBNUC5jb250ZXh0KTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLk1vZGlmeSwgSlNPTi5zdHJpbmdpZnkoSWRlbnRpdHlSZXF1ZXN0LmNvbnZlcnRUb05hdGl2ZShpZGVudGl0eUFwaURhdGEpKSk7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy5uYXRpdmVJZGVudGl0eVJlcXVlc3QsICdNb2RpZnkgcmVxdWVzdCBzZW50IHRvIG5hdGl2ZSBzZGsnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgJ21vZGlmeScsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLmxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleSwgTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLnZhbGlkYXRpb25Jc3N1ZSwgcHJlUHJvY2Vzc1Jlc3VsdC5lcnJvcik7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHByZVByb2Nlc3NSZXN1bHQpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICAvKipcbiAgICAqIFJldHVybnMgYSB1c2VyIG9iamVjdCB3aXRoIG1ldGhvZHMgdG8gaW50ZXJhY3Qgd2l0aCB0aGUgY3VycmVudCB1c2VyXG4gICAgKiBAbWV0aG9kIGdldEN1cnJlbnRVc2VyXG4gICAgKiBAcmV0dXJuIHtPYmplY3R9IHRoZSBjdXJyZW50IHVzZXIgb2JqZWN0XG4gICAgKi9cbiAgICBnZXRDdXJyZW50VXNlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBtcGlkID0gTVAubXBpZDtcbiAgICAgICAgaWYgKG1waWQpIHtcbiAgICAgICAgICAgIG1waWQgPSBNUC5tcGlkLnNsaWNlKCk7XG4gICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlcihtcGlkLCBNUC5pc0xvZ2dlZEluKTtcbiAgICAgICAgfSBlbHNlIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgcmV0dXJuIG1QYXJ0aWNsZVVzZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICogUmV0dXJucyBhIHRoZSB1c2VyIG9iamVjdCBhc3NvY2lhdGVkIHdpdGggdGhlIG1waWQgcGFyYW1ldGVyIG9yICdudWxsJyBpZiBubyBzdWNoXG4gICAgKiB1c2VyIGV4aXN0c1xuICAgICogQG1ldGhvZCBnZXRVc2VyXG4gICAgKiBAcGFyYW0ge1N0cmluZ30gbXBpZCBvZiB0aGUgZGVzaXJlZCB1c2VyXG4gICAgKiBAcmV0dXJuIHtPYmplY3R9IHRoZSB1c2VyIGZvciAgbXBpZFxuICAgICovXG4gICAgZ2V0VXNlcjogZnVuY3Rpb24obXBpZCkge1xuICAgICAgICB2YXIgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICBpZiAoY29va2llc1ttcGlkXSAmJiAhQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlcihtcGlkKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAqIFJldHVybnMgYWxsIHVzZXJzLCBpbmNsdWRpbmcgdGhlIGN1cnJlbnQgdXNlciBhbmQgYWxsIHByZXZpb3VzIHVzZXJzIHRoYXQgYXJlIHN0b3JlZCBvbiB0aGUgZGV2aWNlLlxuICAgICogQG1ldGhvZCBnZXRVc2Vyc1xuICAgICogQHJldHVybiB7QXJyYXl9IGFycmF5IG9mIHVzZXJzXG4gICAgKi9cbiAgICBnZXRVc2VyczogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcbiAgICAgICAgdmFyIHVzZXJzID0gW107XG4gICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llcykge1xuICAgICAgICAgICAgICAgIGlmICghQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICB1c2Vycy5wdXNoKG1QYXJ0aWNsZVVzZXIoa2V5KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1c2VycztcbiAgICB9XG59O1xuXG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpIG9iamVjdC5cbiogRXhhbXBsZTogbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKVxuKiBAY2xhc3MgbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKClcbiovXG5mdW5jdGlvbiBtUGFydGljbGVVc2VyKG1waWQsIGlzTG9nZ2VkSW4pIHtcbiAgICByZXR1cm4ge1xuICAgICAgICAvKipcbiAgICAgICAgKiBHZXQgdXNlciBpZGVudGl0aWVzIGZvciBjdXJyZW50IHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIGdldFVzZXJJZGVudGl0aWVzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgd2l0aCB1c2VySWRlbnRpdGllcyBhcyBpdHMga2V5XG4gICAgICAgICovXG4gICAgICAgIGdldFVzZXJJZGVudGl0aWVzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50VXNlcklkZW50aXRpZXMgPSB7fTtcblxuICAgICAgICAgICAgdmFyIGlkZW50aXRpZXMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VySWRlbnRpdGllcyhtcGlkKTtcblxuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHlUeXBlIGluIGlkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRVc2VySWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lKEhlbHBlcnMucGFyc2VOdW1iZXIoaWRlbnRpdHlUeXBlKSldID0gaWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB1c2VySWRlbnRpdGllczogY3VycmVudFVzZXJJZGVudGl0aWVzXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXQgdGhlIE1QSUQgb2YgdGhlIGN1cnJlbnQgdXNlclxuICAgICAgICAqIEBtZXRob2QgZ2V0TVBJRFxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gdGhlIGN1cnJlbnQgdXNlciBNUElEIGFzIGEgc3RyaW5nXG4gICAgICAgICovXG4gICAgICAgIGdldE1QSUQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIG1waWQ7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSB1c2VyIHRhZ1xuICAgICAgICAqIEBtZXRob2Qgc2V0VXNlclRhZ1xuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSB0YWdOYW1lXG4gICAgICAgICovXG4gICAgICAgIHNldFVzZXJUYWc6IGZ1bmN0aW9uKHRhZ05hbWUpIHtcbiAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUodGFnTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuc2V0VXNlckF0dHJpYnV0ZSh0YWdOYW1lLCBudWxsKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhIHVzZXIgdGFnXG4gICAgICAgICogQG1ldGhvZCByZW1vdmVVc2VyVGFnXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHRhZ05hbWVcbiAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlVXNlclRhZzogZnVuY3Rpb24odGFnTmFtZSkge1xuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZSh0YWdOYW1lKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRLZXkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5yZW1vdmVVc2VyQXR0cmlidXRlKHRhZ05hbWUpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIGEgdXNlciBhdHRyaWJ1dGVcbiAgICAgICAgKiBAbWV0aG9kIHNldFVzZXJBdHRyaWJ1dGVcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gICAgICAgICovXG4gICAgICAgIHNldFVzZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzLFxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkQXR0cmlidXRlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLlNldFVzZXJBdHRyaWJ1dGUsIEpTT04uc3RyaW5naWZ5KHsga2V5OiBrZXksIHZhbHVlOiB2YWx1ZSB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGV4aXN0aW5nUHJvcCA9IEhlbHBlcnMuZmluZEtleUluT2JqZWN0KHVzZXJBdHRyaWJ1dGVzLCBrZXkpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1Byb3ApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSB1c2VyQXR0cmlidXRlc1tleGlzdGluZ1Byb3BdO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzW21waWRdLnVhID0gdXNlckF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGVPbmx5Q29va2llVXNlckF0dHJpYnV0ZXMoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuaW5pdEZvcndhcmRlcnMobVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkuZ2V0VXNlcklkZW50aXRpZXMoKSk7XG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuY2FsbFNldFVzZXJBdHRyaWJ1dGVPbkZvcndhcmRlcnMoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXQgbXVsdGlwbGUgdXNlciBhdHRyaWJ1dGVzXG4gICAgICAgICogQG1ldGhvZCBzZXRVc2VyQXR0cmlidXRlc1xuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSB1c2VyIGF0dHJpYnV0ZSBvYmplY3Qgd2l0aCBrZXlzIG9mIHRoZSBhdHRyaWJ1dGUgdHlwZSwgYW5kIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdmFsdWVcbiAgICAgICAgKi9cbiAgICAgICAgc2V0VXNlckF0dHJpYnV0ZXM6IGZ1bmN0aW9uKHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KHVzZXJBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmNhbkxvZygpKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFVzZXJBdHRyaWJ1dGUoa2V5LCB1c2VyQXR0cmlidXRlc1trZXldKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5kZWJ1ZygnTXVzdCBwYXNzIGFuIG9iamVjdCBpbnRvIHNldFVzZXJBdHRyaWJ1dGVzLiBZb3UgcGFzc2VkIGEgJyArIHR5cGVvZiB1c2VyQXR0cmlidXRlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJlbW92ZXMgYSBzcGVjaWZpYyB1c2VyIGF0dHJpYnV0ZVxuICAgICAgICAqIEBtZXRob2QgcmVtb3ZlVXNlckF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcbiAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlVXNlckF0dHJpYnV0ZTogZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgICAgICB2YXIgY29va2llcywgdXNlckF0dHJpYnV0ZXM7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZShrZXkpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZEtleSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuUmVtb3ZlVXNlckF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6IGtleSwgdmFsdWU6IG51bGwgfSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdGhpcy5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuXG4gICAgICAgICAgICAgICAgdmFyIGV4aXN0aW5nUHJvcCA9IEhlbHBlcnMuZmluZEtleUluT2JqZWN0KHVzZXJBdHRyaWJ1dGVzLCBrZXkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nUHJvcCkge1xuICAgICAgICAgICAgICAgICAgICBrZXkgPSBleGlzdGluZ1Byb3A7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZGVsZXRlIHVzZXJBdHRyaWJ1dGVzW2tleV07XG5cbiAgICAgICAgICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzKGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldFVzZXJJZGVudGl0aWVzKCkpO1xuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuYXBwbHlUb0ZvcndhcmRlcnMoJ3JlbW92ZVVzZXJBdHRyaWJ1dGUnLCBrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIGEgbGlzdCBvZiB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIHNldFVzZXJBdHRyaWJ1dGVMaXN0XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAgICAqIEBwYXJhbSB7QXJyYXl9IHZhbHVlIGFuIGFycmF5IG9mIHZhbHVlc1xuICAgICAgICAqL1xuICAgICAgICBzZXRVc2VyQXR0cmlidXRlTGlzdDogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMsIHVzZXJBdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZShrZXkpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZEtleSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVGhlIHZhbHVlIHlvdSBwYXNzZWQgaW4gdG8gc2V0VXNlckF0dHJpYnV0ZUxpc3QgbXVzdCBiZSBhbiBhcnJheS4gWW91IHBhc3NlZCBpbiBhICcgKyB0eXBlb2YgdmFsdWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGFycmF5Q29weSA9IHZhbHVlLnNsaWNlKCk7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5TZXRVc2VyQXR0cmlidXRlTGlzdCwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6IGtleSwgdmFsdWU6IGFycmF5Q29weSB9KSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRQZXJzaXN0ZW5jZSgpO1xuXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG5cbiAgICAgICAgICAgICAgICB2YXIgZXhpc3RpbmdQcm9wID0gSGVscGVycy5maW5kS2V5SW5PYmplY3QodXNlckF0dHJpYnV0ZXMsIGtleSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdQcm9wKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSB1c2VyQXR0cmlidXRlc1tleGlzdGluZ1Byb3BdO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzW2tleV0gPSBhcnJheUNvcHk7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzW21waWRdLnVhID0gdXNlckF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyhtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRVc2VySWRlbnRpdGllcygpKTtcbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzKGtleSwgYXJyYXlDb3B5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhbGwgdXNlciBhdHRyaWJ1dGVzXG4gICAgICAgICogQG1ldGhvZCByZW1vdmVBbGxVc2VyQXR0cmlidXRlc1xuICAgICAgICAqL1xuICAgICAgICByZW1vdmVBbGxVc2VyQXR0cmlidXRlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgY29va2llcywgdXNlckF0dHJpYnV0ZXM7XG5cbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuUmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdGhpcy5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuXG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyhtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRVc2VySWRlbnRpdGllcygpKTtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRm9yd2FyZGVycy5hcHBseVRvRm9yd2FyZGVycygncmVtb3ZlVXNlckF0dHJpYnV0ZScsIHByb3ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzW21waWRdLnVhID0ge307XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZXR1cm5zIGFsbCB1c2VyIGF0dHJpYnV0ZSBrZXlzIHRoYXQgaGF2ZSB2YWx1ZXMgdGhhdCBhcmUgYXJyYXlzXG4gICAgICAgICogQG1ldGhvZCBnZXRVc2VyQXR0cmlidXRlc0xpc3RzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgb2Ygb25seSBrZXlzIHdpdGggYXJyYXkgdmFsdWVzLiBFeGFtcGxlOiB7IGF0dHIxOiBbMSwgMiwgM10sIGF0dHIyOiBbJ2EnLCAnYicsICdjJ10gfVxuICAgICAgICAqL1xuICAgICAgICBnZXRVc2VyQXR0cmlidXRlc0xpc3RzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciB1c2VyQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0xpc3RzID0ge307XG5cbiAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdGhpcy5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KGtleSkgJiYgQXJyYXkuaXNBcnJheSh1c2VyQXR0cmlidXRlc1trZXldKSkge1xuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0xpc3RzW2tleV0gPSB1c2VyQXR0cmlidXRlc1trZXldLnNsaWNlKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdXNlckF0dHJpYnV0ZXNMaXN0cztcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyBhbGwgdXNlciBhdHRyaWJ1dGVzXG4gICAgICAgICogQG1ldGhvZCBnZXRBbGxVc2VyQXR0cmlidXRlc1xuICAgICAgICAqIEByZXR1cm4ge09iamVjdH0gYW4gb2JqZWN0IG9mIGFsbCB1c2VyIGF0dHJpYnV0ZXMuIEV4YW1wbGU6IHsgYXR0cjE6ICd2YWx1ZTEnLCBhdHRyMjogWydhJywgJ2InLCAnYyddIH1cbiAgICAgICAgKi9cbiAgICAgICAgZ2V0QWxsVXNlckF0dHJpYnV0ZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzQ29weSA9IHt9O1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzID0gUGVyc2lzdGVuY2UuZ2V0QWxsVXNlckF0dHJpYnV0ZXMobXBpZCk7XG5cbiAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh1c2VyQXR0cmlidXRlc1twcm9wXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHlbcHJvcF0gPSB1c2VyQXR0cmlidXRlc1twcm9wXS5zbGljZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNDb3B5W3Byb3BdID0gdXNlckF0dHJpYnV0ZXNbcHJvcF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB1c2VyQXR0cmlidXRlc0NvcHk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgdGhlIGNhcnQgb2JqZWN0IGZvciB0aGUgY3VycmVudCB1c2VyXG4gICAgICAgICogQG1ldGhvZCBnZXRDYXJ0XG4gICAgICAgICogQHJldHVybiBhIGNhcnQgb2JqZWN0XG4gICAgICAgICovXG4gICAgICAgIGdldENhcnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIG1QYXJ0aWNsZVVzZXJDYXJ0KG1waWQpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgdGhlIENvbnNlbnQgU3RhdGUgc3RvcmVkIGxvY2FsbHkgZm9yIHRoaXMgdXNlci5cbiAgICAgICAgKiBAbWV0aG9kIGdldENvbnNlbnRTdGF0ZVxuICAgICAgICAqIEByZXR1cm4gYSBDb25zZW50U3RhdGUgb2JqZWN0XG4gICAgICAgICovXG4gICAgICAgIGdldENvbnNlbnRTdGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gUGVyc2lzdGVuY2UuZ2V0Q29uc2VudFN0YXRlKG1waWQpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIHRoZSBDb25zZW50IFN0YXRlIHN0b3JlZCBsb2NhbGx5IGZvciB0aGlzIHVzZXIuXG4gICAgICAgICogQG1ldGhvZCBzZXRDb25zZW50U3RhdGVcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gY29uc2VudCBzdGF0ZVxuICAgICAgICAqL1xuICAgICAgICBzZXRDb25zZW50U3RhdGU6IGZ1bmN0aW9uKHN0YXRlKSB7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS5zZXRDb25zZW50U3RhdGUobXBpZCwgc3RhdGUpO1xuICAgICAgICAgICAgaWYgKE1QLm1waWQgPT09IHRoaXMuZ2V0TVBJRCgpKSB7XG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyh0aGlzLmdldFVzZXJJZGVudGl0aWVzKCkudXNlcklkZW50aXRpZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpc0xvZ2dlZEluOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBpc0xvZ2dlZEluO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuLyoqXG4qIEludm9rZSB0aGVzZSBtZXRob2RzIG9uIHRoZSBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRDYXJ0KCkgb2JqZWN0LlxuKiBFeGFtcGxlOiBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRDYXJ0KCkuYWRkKC4uLik7XG4qIEBjbGFzcyBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRDYXJ0KClcbiovXG5mdW5jdGlvbiBtUGFydGljbGVVc2VyQ2FydChtcGlkKXtcbiAgICByZXR1cm4ge1xuICAgICAgICAvKipcbiAgICAgICAgKiBBZGRzIGEgY2FydCBwcm9kdWN0IHRvIHRoZSB1c2VyIGNhcnRcbiAgICAgICAgKiBAbWV0aG9kIGFkZFxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHRoZSBwcm9kdWN0XG4gICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRdIGEgYm9vbGVhbiB0byBsb2cgYWRkaW5nIG9mIHRoZSBjYXJ0IG9iamVjdC4gSWYgYmxhbmssIG5vIGxvZ2dpbmcgb2NjdXJzLlxuICAgICAgICAqL1xuICAgICAgICBhZGQ6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50KSB7XG4gICAgICAgICAgICB2YXIgYWxsUHJvZHVjdHMsXG4gICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzLFxuICAgICAgICAgICAgICAgIGFycmF5Q29weTtcblxuICAgICAgICAgICAgYXJyYXlDb3B5ID0gQXJyYXkuaXNBcnJheShwcm9kdWN0KSA/IHByb2R1Y3Quc2xpY2UoKSA6IFtwcm9kdWN0XTtcbiAgICAgICAgICAgIGFycmF5Q29weS5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICBwcm9kdWN0LkF0dHJpYnV0ZXMgPSBIZWxwZXJzLnNhbml0aXplQXR0cmlidXRlcyhwcm9kdWN0LkF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIE5hdGl2ZVNka0hlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5BZGRUb0NhcnQsIEpTT04uc3RyaW5naWZ5KGFycmF5Q29weSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuXG5cbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VyUHJvZHVjdHNGcm9tTFMobXBpZCk7XG5cbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSB1c2VyUHJvZHVjdHMuY29uY2F0KGFycmF5Q29weSk7XG5cbiAgICAgICAgICAgICAgICBpZiAobG9nRXZlbnQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5BZGRUb0NhcnQsIGFycmF5Q29weSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIHByb2R1Y3RzRm9yTWVtb3J5ID0ge307XG4gICAgICAgICAgICAgICAgcHJvZHVjdHNGb3JNZW1vcnlbbXBpZF0gPSB7Y3A6IHVzZXJQcm9kdWN0c307XG4gICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVQcm9kdWN0c0luTWVtb3J5KHByb2R1Y3RzRm9yTWVtb3J5LCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodXNlclByb2R1Y3RzLmxlbmd0aCA+IG1QYXJ0aWNsZS5tYXhQcm9kdWN0cykge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgY2FydCBjb250YWlucyAnICsgdXNlclByb2R1Y3RzLmxlbmd0aCArICcgaXRlbXMuIE9ubHkgbVBhcnRpY2xlLm1heFByb2R1Y3RzID0gJyArIG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyArICcgY2FuIGN1cnJlbnRseSBiZSBzYXZlZCBpbiBjb29raWVzLicpO1xuICAgICAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSB1c2VyUHJvZHVjdHMuc2xpY2UoMCwgbVBhcnRpY2xlLm1heFByb2R1Y3RzKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBhbGxQcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmdldEFsbFVzZXJQcm9kdWN0c0Zyb21MUygpO1xuICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzW21waWRdLmNwID0gdXNlclByb2R1Y3RzO1xuXG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc2V0Q2FydFByb2R1Y3RzKGFsbFByb2R1Y3RzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhIGNhcnQgcHJvZHVjdCBmcm9tIHRoZSBjdXJyZW50IHVzZXIgY2FydFxuICAgICAgICAqIEBtZXRob2QgcmVtb3ZlXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3RcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtsb2dFdmVudF0gYSBib29sZWFuIHRvIGxvZyBhZGRpbmcgb2YgdGhlIGNhcnQgb2JqZWN0LiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICovXG4gICAgICAgIHJlbW92ZTogZnVuY3Rpb24ocHJvZHVjdCwgbG9nRXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBhbGxQcm9kdWN0cyxcbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMsXG4gICAgICAgICAgICAgICAgY2FydEluZGV4ID0gLTEsXG4gICAgICAgICAgICAgICAgY2FydEl0ZW0gPSBudWxsO1xuXG4gICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuUmVtb3ZlRnJvbUNhcnQsIEpTT04uc3RyaW5naWZ5KHByb2R1Y3QpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG5cbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VyUHJvZHVjdHNGcm9tTFMobXBpZCk7XG5cbiAgICAgICAgICAgICAgICBpZiAodXNlclByb2R1Y3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cy5mb3JFYWNoKGZ1bmN0aW9uKGNhcnRQcm9kdWN0LCBpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2FydFByb2R1Y3QuU2t1ID09PSBwcm9kdWN0LlNrdSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhcnRJbmRleCA9IGk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FydEl0ZW0gPSBjYXJ0UHJvZHVjdDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNhcnRJbmRleCA+IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMuc3BsaWNlKGNhcnRJbmRleCwgMSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChsb2dFdmVudCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dQcm9kdWN0QWN0aW9uRXZlbnQoVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbUNhcnQsIGNhcnRJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBwcm9kdWN0c0Zvck1lbW9yeSA9IHt9O1xuICAgICAgICAgICAgICAgIHByb2R1Y3RzRm9yTWVtb3J5W21waWRdID0ge2NwOiB1c2VyUHJvZHVjdHN9O1xuICAgICAgICAgICAgICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlUHJvZHVjdHNJbk1lbW9yeShwcm9kdWN0c0Zvck1lbW9yeSwgbXBpZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHMgPSBQZXJzaXN0ZW5jZS5nZXRBbGxVc2VyUHJvZHVjdHNGcm9tTFMoKTtcblxuICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzW21waWRdLmNwID0gdXNlclByb2R1Y3RzO1xuXG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc2V0Q2FydFByb2R1Y3RzKGFsbFByb2R1Y3RzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogQ2xlYXJzIHRoZSB1c2VyJ3MgY2FydFxuICAgICAgICAqIEBtZXRob2QgY2xlYXJcbiAgICAgICAgKi9cbiAgICAgICAgY2xlYXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGFsbFByb2R1Y3RzO1xuXG4gICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuQ2xlYXJDYXJ0KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHMgPSBQZXJzaXN0ZW5jZS5nZXRBbGxVc2VyUHJvZHVjdHNGcm9tTFMoKTtcblxuICAgICAgICAgICAgICAgIGlmIChhbGxQcm9kdWN0cyAmJiBhbGxQcm9kdWN0c1ttcGlkXSAmJiBhbGxQcm9kdWN0c1ttcGlkXS5jcCkge1xuICAgICAgICAgICAgICAgICAgICBhbGxQcm9kdWN0c1ttcGlkXS5jcCA9IFtdO1xuXG4gICAgICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzW21waWRdLmNwID0gW107XG4gICAgICAgICAgICAgICAgICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZVByb2R1Y3RzSW5NZW1vcnkoYWxsUHJvZHVjdHMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc2V0Q2FydFByb2R1Y3RzKGFsbFByb2R1Y3RzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgYWxsIGNhcnQgcHJvZHVjdHNcbiAgICAgICAgKiBAbWV0aG9kIGdldENhcnRQcm9kdWN0c1xuICAgICAgICAqIEByZXR1cm4ge0FycmF5fSBhcnJheSBvZiBjYXJ0IHByb2R1Y3RzXG4gICAgICAgICovXG4gICAgICAgIGdldENhcnRQcm9kdWN0czogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gUGVyc2lzdGVuY2UuZ2V0Q2FydFByb2R1Y3RzKG1waWQpO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VJZGVudGl0eVJlc3BvbnNlKHhociwgcHJldmlvdXNNUElELCBjYWxsYmFjaywgaWRlbnRpdHlBcGlEYXRhLCBtZXRob2QpIHtcbiAgICB2YXIgcHJldlVzZXIsXG4gICAgICAgIG5ld1VzZXIsXG4gICAgICAgIGlkZW50aXR5QXBpUmVzdWx0LFxuICAgICAgICBpbmRleE9mTVBJRDtcblxuICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgIHByZXZVc2VyID0gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG4gICAgfVxuXG4gICAgTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQgPSBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQYXJzaW5nIGlkZW50aXR5IHJlc3BvbnNlIGZyb20gc2VydmVyJyk7XG4gICAgICAgIGlmICh4aHIucmVzcG9uc2VUZXh0KSB7XG4gICAgICAgICAgICBpZGVudGl0eUFwaVJlc3VsdCA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlSZXN1bHQuaGFzT3duUHJvcGVydHkoJ2lzX2xvZ2dlZF9pbicpKSB7XG4gICAgICAgICAgICAgICAgTVAuaXNMb2dnZWRJbiA9IGlkZW50aXR5QXBpUmVzdWx0LmlzX2xvZ2dlZF9pbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAwKSB7XG4gICAgICAgICAgICBpZiAobWV0aG9kID09PSAnbW9kaWZ5Jykge1xuICAgICAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0gSWRlbnRpdHlSZXF1ZXN0Lm1vZGlmeVVzZXJJZGVudGl0aWVzKE1QLnVzZXJJZGVudGl0aWVzLCBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpO1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZGVudGl0eUFwaVJlc3VsdCA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG5cbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgcGFyc2VkIElkZW50aXR5IFJlc3BvbnNlJyk7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpUmVzdWx0Lm1waWQgJiYgaWRlbnRpdHlBcGlSZXN1bHQubXBpZCAhPT0gTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5tcGlkID0gaWRlbnRpdHlBcGlSZXN1bHQubXBpZDtcblxuICAgICAgICAgICAgICAgICAgICBjaGVja0Nvb2tpZUZvck1QSUQoTVAubXBpZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaW5kZXhPZk1QSUQgPSBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLmluZGV4T2YoTVAubXBpZCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoTVAuc2Vzc2lvbklkICYmIE1QLm1waWQgJiYgcHJldmlvdXNNUElEICE9PSBNUC5tcGlkICYmIGluZGV4T2ZNUElEIDwgMCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnB1c2goTVAubXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIC8vIG5lZWQgdG8gdXBkYXRlIGN1cnJlbnRTZXNzaW9uTVBJRHMgaW4gbWVtb3J5IGJlZm9yZSBjaGVja2luZ0lkZW50aXR5U3dhcCBvdGhlcndpc2UgcHJldmlvdXMgb2JqLmN1cnJlbnRTZXNzaW9uTVBJRHMgaXMgdXNlZCBpbiBjaGVja0lkZW50aXR5U3dhcCdzIFBlcnNpc3RlbmNlLnVwZGF0ZSgpXG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChpbmRleE9mTVBJRCA+IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSAoTVAuY3VycmVudFNlc3Npb25NUElEcy5zbGljZSgwLCBpbmRleE9mTVBJRCkpLmNvbmNhdChNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnNsaWNlKGluZGV4T2ZNUElEICsgMSwgTVAuY3VycmVudFNlc3Npb25NUElEcy5sZW5ndGgpKTtcbiAgICAgICAgICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcy5wdXNoKE1QLm1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBDb29raWVTeW5jTWFuYWdlci5hdHRlbXB0Q29va2llU3luYyhwcmV2aW91c01QSUQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICAgICAgSWRlbnRpdHkuY2hlY2tJZGVudGl0eVN3YXAocHJldmlvdXNNUElELCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgICAgIEhlbHBlcnMucHJvY2Vzc1F1ZXVlZEV2ZW50cyhNUC5ldmVudFF1ZXVlLCBNUC5tcGlkLCAhTVAucmVxdWlyZURlbGF5LCBzZW5kRXZlbnRUb1NlcnZlciwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBFdmVudHMucGFyc2VFdmVudFJlc3BvbnNlKTtcblxuICAgICAgICAgICAgICAgIC8vaWYgdGhlcmUgaXMgYW55IHByZXZpb3VzIG1pZ3JhdGlvbiBkYXRhXG4gICAgICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKE1QLm1pZ3JhdGlvbkRhdGEpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBNUC51c2VySWRlbnRpdGllcyA9IE1QLm1pZ3JhdGlvbkRhdGEudXNlcklkZW50aXRpZXMgfHwge307XG4gICAgICAgICAgICAgICAgICAgIE1QLnVzZXJBdHRyaWJ1dGVzID0gTVAubWlncmF0aW9uRGF0YS51c2VyQXR0cmlidXRlcyB8fCB7fTtcbiAgICAgICAgICAgICAgICAgICAgTVAuY29va2llU3luY0RhdGVzID0gTVAubWlncmF0aW9uRGF0YS5jb29raWVTeW5jRGF0ZXMgfHwge307XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YSAmJiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMgJiYgT2JqZWN0LmtleXMoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0gSWRlbnRpdHlSZXF1ZXN0Lm1vZGlmeVVzZXJJZGVudGl0aWVzKE1QLnVzZXJJZGVudGl0aWVzLCBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLmZpbmRQcmV2Q29va2llc0Jhc2VkT25VSShpZGVudGl0eUFwaURhdGEpO1xuXG4gICAgICAgICAgICAgICAgTVAuY29udGV4dCA9IGlkZW50aXR5QXBpUmVzdWx0LmNvbnRleHQgfHwgTVAuY29udGV4dDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbmV3VXNlciA9IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpO1xuXG4gICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhICYmIGlkZW50aXR5QXBpRGF0YS5vblVzZXJBbGlhcyAmJiBIZWxwZXJzLlZhbGlkYXRvcnMuaXNGdW5jdGlvbihpZGVudGl0eUFwaURhdGEub25Vc2VyQWxpYXMpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlBcGlEYXRhLm9uVXNlckFsaWFzKHByZXZVc2VyLCBuZXdVc2VyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVGhlcmUgd2FzIGFuIGVycm9yIHdpdGggeW91ciBvblVzZXJBbGlhcyBmdW5jdGlvbiAtICcgKyBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpIHx8IFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZSgpO1xuXG4gICAgICAgICAgICBpZiAobmV3VXNlcikge1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMsIG5ld1VzZXIuZ2V0TVBJRCgpKTtcbiAgICAgICAgICAgICAgICBpZiAoIXByZXZVc2VyIHx8IG5ld1VzZXIuZ2V0TVBJRCgpICE9PSBwcmV2VXNlci5nZXRNUElEKCkgfHwgcHJldlVzZXIuaXNMb2dnZWRJbigpICE9PSBuZXdVc2VyLmlzTG9nZ2VkSW4oKSkge1xuICAgICAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKG5ld1VzZXIuZ2V0VXNlcklkZW50aXRpZXMoKS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyVXNlcklkZW50aXRpZXMobmV3VXNlci5nZXRVc2VySWRlbnRpdGllcygpLnVzZXJJZGVudGl0aWVzKTtcbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLnNldEZvcndhcmRlck9uSWRlbnRpdHlDb21wbGV0ZShuZXdVc2VyLCBtZXRob2QpO1xuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyT25Vc2VySWRlbnRpZmllZChuZXdVc2VyLCBtZXRob2QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCB4aHIuc3RhdHVzLCBpZGVudGl0eUFwaVJlc3VsdCB8fCBudWxsLCBuZXdVc2VyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaVJlc3VsdCAmJiBpZGVudGl0eUFwaVJlc3VsdC5lcnJvcnMgJiYgaWRlbnRpdHlBcGlSZXN1bHQuZXJyb3JzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1JlY2VpdmVkIEhUVFAgcmVzcG9uc2UgY29kZSBvZiAnICsgeGhyLnN0YXR1cyArICcgLSAnICsgaWRlbnRpdHlBcGlSZXN1bHQuZXJyb3JzWzBdLm1lc3NhZ2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgeGhyLnN0YXR1cywgaWRlbnRpdHlBcGlSZXN1bHQgfHwgbnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgcGFyc2luZyBKU09OIHJlc3BvbnNlIGZyb20gSWRlbnRpdHkgc2VydmVyOiAnICsgZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjaGVja0Nvb2tpZUZvck1QSUQoY3VycmVudE1QSUQpIHtcbiAgICB2YXIgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpIHx8IFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZSgpO1xuICAgIGlmIChjb29raWVzICYmICFjb29raWVzW2N1cnJlbnRNUElEXSkge1xuICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShudWxsLCBjdXJyZW50TVBJRCk7XG4gICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IFtdO1xuICAgIH0gZWxzZSBpZiAoY29va2llcykge1xuICAgICAgICB2YXIgcHJvZHVjdHMgPSBQZXJzaXN0ZW5jZS5kZWNvZGVQcm9kdWN0cygpO1xuICAgICAgICBpZiAocHJvZHVjdHMgJiYgcHJvZHVjdHNbY3VycmVudE1QSURdKSB7XG4gICAgICAgICAgICBNUC5jYXJ0UHJvZHVjdHMgPSBwcm9kdWN0c1tjdXJyZW50TVBJRF0uY3A7XG4gICAgICAgIH1cbiAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBjb29raWVzW2N1cnJlbnRNUElEXS51aSB8fCB7fTtcbiAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSBjb29raWVzW2N1cnJlbnRNUElEXS51YSB8fCB7fTtcbiAgICAgICAgTVAuY29va2llU3luY0RhdGVzID0gY29va2llc1tjdXJyZW50TVBJRF0uY3NkIHx8IHt9O1xuICAgICAgICBNUC5jb25zZW50U3RhdGUgPSBjb29raWVzW2N1cnJlbnRNUElEXS5jb247XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBJZGVudGl0eUFQSTogSWRlbnRpdHlBUEksXG4gICAgSWRlbnRpdHk6IElkZW50aXR5LFxuICAgIElkZW50aXR5UmVxdWVzdDogSWRlbnRpdHlSZXF1ZXN0LFxuICAgIG1QYXJ0aWNsZVVzZXI6IG1QYXJ0aWNsZVVzZXIsXG4gICAgbVBhcnRpY2xlVXNlckNhcnQ6IG1QYXJ0aWNsZVVzZXJDYXJ0XG59O1xuIiwidmFyIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKTtcblxuZnVuY3Rpb24gZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyKG1waWQsIGZvcndhcmRlcikge1xuICAgIHJldHVybiB7XG4gICAgICAgIGdldFVzZXJJZGVudGl0aWVzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50VXNlcklkZW50aXRpZXMgPSB7fTtcbiAgICAgICAgICAgIHZhciBpZGVudGl0aWVzID0gUGVyc2lzdGVuY2UuZ2V0VXNlcklkZW50aXRpZXMobXBpZCk7XG5cbiAgICAgICAgICAgIGZvciAodmFyIGlkZW50aXR5VHlwZSBpbiBpZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXRpZXMuaGFzT3duUHJvcGVydHkoaWRlbnRpdHlUeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICBjdXJyZW50VXNlcklkZW50aXRpZXNbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5TmFtZShIZWxwZXJzLnBhcnNlTnVtYmVyKGlkZW50aXR5VHlwZSkpXSA9IGlkZW50aXRpZXNbaWRlbnRpdHlUeXBlXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGN1cnJlbnRVc2VySWRlbnRpdGllcyA9IEhlbHBlcnMuZmlsdGVyVXNlcklkZW50aXRpZXNGb3JGb3J3YXJkZXJzKGN1cnJlbnRVc2VySWRlbnRpdGllcywgZm9yd2FyZGVyLnVzZXJJZGVudGl0eUZpbHRlcnMpO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0aWVzOiBjdXJyZW50VXNlcklkZW50aXRpZXNcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG4gICAgICAgIGdldE1QSUQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIG1waWQ7XG4gICAgICAgIH0sXG4gICAgICAgIGdldFVzZXJBdHRyaWJ1dGVzTGlzdHM6IGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHMgPSB7fTtcblxuICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoa2V5KSAmJiBBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW2tleV0pKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHNba2V5XSA9IHVzZXJBdHRyaWJ1dGVzW2tleV0uc2xpY2UoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHMgPSBIZWxwZXJzLmZpbHRlclVzZXJBdHRyaWJ1dGVzKHVzZXJBdHRyaWJ1dGVzTGlzdHMsIGZvcndhcmRlci51c2VyQXR0cmlidXRlRmlsdGVycyk7XG5cbiAgICAgICAgICAgIHJldHVybiB1c2VyQXR0cmlidXRlc0xpc3RzO1xuICAgICAgICB9LFxuICAgICAgICBnZXRBbGxVc2VyQXR0cmlidXRlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXNDb3B5ID0ge307XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXMgPSBQZXJzaXN0ZW5jZS5nZXRBbGxVc2VyQXR0cmlidXRlcyhtcGlkKTtcblxuICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW3Byb3BdKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzQ29weVtwcm9wXSA9IHVzZXJBdHRyaWJ1dGVzW3Byb3BdLnNsaWNlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHlbcHJvcF0gPSB1c2VyQXR0cmlidXRlc1twcm9wXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNDb3B5ID0gSGVscGVycy5maWx0ZXJVc2VyQXR0cmlidXRlcyh1c2VyQXR0cmlidXRlc0NvcHksIGZvcndhcmRlci51c2VyQXR0cmlidXRlRmlsdGVycyk7XG5cbiAgICAgICAgICAgIHJldHVybiB1c2VyQXR0cmlidXRlc0NvcHk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBnZXRGaWx0ZXJlZE1wYXJ0aWNsZVVzZXI6IGdldEZpbHRlcmVkTXBhcnRpY2xlVXNlclxufTtcbiIsIi8vXG4vLyAgQ29weXJpZ2h0IDIwMTcgbVBhcnRpY2xlLCBJbmMuXG4vL1xuLy8gIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4vLyAgeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuLy8gIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuLy9cbi8vICAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4vL1xuLy8gIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbi8vICBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4vLyAgV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4vLyAgU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuLy8gIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuLy9cbi8vICBVc2VzIHBvcnRpb25zIG9mIGNvZGUgZnJvbSBqUXVlcnlcbi8vICBqUXVlcnkgdjEuMTAuMiB8IChjKSAyMDA1LCAyMDEzIGpRdWVyeSBGb3VuZGF0aW9uLCBJbmMuIHwganF1ZXJ5Lm9yZy9saWNlbnNlXG5cbnZhciBQb2x5ZmlsbCA9IHJlcXVpcmUoJy4vcG9seWZpbGwnKSxcbiAgICBUeXBlcyA9IHJlcXVpcmUoJy4vdHlwZXMnKSxcbiAgICBDb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBOYXRpdmVTZGtIZWxwZXJzID0gcmVxdWlyZSgnLi9uYXRpdmVTZGtIZWxwZXJzJyksXG4gICAgQ29va2llU3luY01hbmFnZXIgPSByZXF1aXJlKCcuL2Nvb2tpZVN5bmNNYW5hZ2VyJyksXG4gICAgU2Vzc2lvbk1hbmFnZXIgPSByZXF1aXJlKCcuL3Nlc3Npb25NYW5hZ2VyJyksXG4gICAgRWNvbW1lcmNlID0gcmVxdWlyZSgnLi9lY29tbWVyY2UnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBnZXREZXZpY2VJZCA9IFBlcnNpc3RlbmNlLmdldERldmljZUlkLFxuICAgIEV2ZW50cyA9IHJlcXVpcmUoJy4vZXZlbnRzJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgVmFsaWRhdG9ycyA9IEhlbHBlcnMuVmFsaWRhdG9ycyxcbiAgICBNaWdyYXRpb25zID0gcmVxdWlyZSgnLi9taWdyYXRpb25zJyksXG4gICAgRm9yd2FyZGVycyA9IHJlcXVpcmUoJy4vZm9yd2FyZGVycycpLFxuICAgIEZvcndhcmRpbmdTdGF0c1VwbG9hZGVyID0gcmVxdWlyZSgnLi9mb3J3YXJkaW5nU3RhdHNVcGxvYWRlcicpLFxuICAgIElkZW50aXR5UmVxdWVzdCA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5JZGVudGl0eVJlcXVlc3QsXG4gICAgSWRlbnRpdHkgPSByZXF1aXJlKCcuL2lkZW50aXR5JykuSWRlbnRpdHksXG4gICAgSWRlbnRpdHlBUEkgPSByZXF1aXJlKCcuL2lkZW50aXR5JykuSWRlbnRpdHlBUEksXG4gICAgSFRUUENvZGVzID0gSWRlbnRpdHlBUEkuSFRUUENvZGVzLFxuICAgIG1QYXJ0aWNsZVVzZXJDYXJ0ID0gcmVxdWlyZSgnLi9pZGVudGl0eScpLm1QYXJ0aWNsZVVzZXJDYXJ0LFxuICAgIG1QYXJ0aWNsZVVzZXIgPSByZXF1aXJlKCcuL2lkZW50aXR5JykubVBhcnRpY2xlVXNlcixcbiAgICBDb25zZW50ID0gcmVxdWlyZSgnLi9jb25zZW50Jyk7XG5cbihmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoIUFycmF5LnByb3RvdHlwZS5mb3JFYWNoKSB7XG4gICAgICAgIEFycmF5LnByb3RvdHlwZS5mb3JFYWNoID0gUG9seWZpbGwuZm9yRWFjaDtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LnByb3RvdHlwZS5tYXApIHtcbiAgICAgICAgQXJyYXkucHJvdG90eXBlLm1hcCA9IFBvbHlmaWxsLm1hcDtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LnByb3RvdHlwZS5maWx0ZXIpIHtcbiAgICAgICAgQXJyYXkucHJvdG90eXBlLmZpbHRlciA9IFBvbHlmaWxsLmZpbHRlcjtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkpIHtcbiAgICAgICAgQXJyYXkucHJvdG90eXBlLmlzQXJyYXkgPSBQb2x5ZmlsbC5pc0FycmF5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZSBvYmplY3QuXG4gICAgKiBFeGFtcGxlOiBtUGFydGljbGUuZW5kU2Vzc2lvbigpXG4gICAgKlxuICAgICogQGNsYXNzIG1QYXJ0aWNsZVxuICAgICovXG5cbiAgICB2YXIgbVBhcnRpY2xlID0ge1xuICAgICAgICB1c2VOYXRpdmVTZGs6IHdpbmRvdy5tUGFydGljbGUgJiYgd2luZG93Lm1QYXJ0aWNsZS51c2VOYXRpdmVTZGsgPyB3aW5kb3cubVBhcnRpY2xlLnVzZU5hdGl2ZVNkayA6IGZhbHNlLFxuICAgICAgICBpc0lPUzogd2luZG93Lm1QYXJ0aWNsZSAmJiB3aW5kb3cubVBhcnRpY2xlLmlzSU9TID8gd2luZG93Lm1QYXJ0aWNsZS5pc0lPUyA6IGZhbHNlLFxuICAgICAgICBpc0RldmVsb3BtZW50TW9kZTogZmFsc2UsXG4gICAgICAgIHVzZUNvb2tpZVN0b3JhZ2U6IGZhbHNlLFxuICAgICAgICBtYXhQcm9kdWN0czogQ29uc3RhbnRzLkRlZmF1bHRDb25maWcuTWF4UHJvZHVjdHMsXG4gICAgICAgIG1heENvb2tpZVNpemU6IENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLk1heENvb2tpZVNpemUsXG4gICAgICAgIGludGVncmF0aW9uRGVsYXlUaW1lb3V0OiBDb25zdGFudHMuRGVmYXVsdENvbmZpZy5JbnRlZ3JhdGlvbkRlbGF5VGltZW91dCxcbiAgICAgICAgaWRlbnRpZnlSZXF1ZXN0OiB7fSxcbiAgICAgICAgZ2V0RGV2aWNlSWQ6IGdldERldmljZUlkLFxuICAgICAgICBnZW5lcmF0ZUhhc2g6IEhlbHBlcnMuZ2VuZXJhdGVIYXNoLFxuICAgICAgICBzZXNzaW9uTWFuYWdlcjogU2Vzc2lvbk1hbmFnZXIsXG4gICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyOiBDb29raWVTeW5jTWFuYWdlcixcbiAgICAgICAgcGVyc2lzdGVuY2U6IFBlcnNpc3RlbmNlLFxuICAgICAgICBtaWdyYXRpb25zOiBNaWdyYXRpb25zLFxuICAgICAgICBJZGVudGl0eTogSWRlbnRpdHlBUEksXG4gICAgICAgIFZhbGlkYXRvcnM6IFZhbGlkYXRvcnMsXG4gICAgICAgIF9JZGVudGl0eTogSWRlbnRpdHksXG4gICAgICAgIF9JZGVudGl0eVJlcXVlc3Q6IElkZW50aXR5UmVxdWVzdCxcbiAgICAgICAgSWRlbnRpdHlUeXBlOiBUeXBlcy5JZGVudGl0eVR5cGUsXG4gICAgICAgIEV2ZW50VHlwZTogVHlwZXMuRXZlbnRUeXBlLFxuICAgICAgICBDb21tZXJjZUV2ZW50VHlwZTogVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUsXG4gICAgICAgIFByb21vdGlvblR5cGU6IFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUsXG4gICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZSxcbiAgICAgICAgLyoqXG4gICAgICAgICogSW5pdGlhbGl6ZXMgdGhlIG1QYXJ0aWNsZSBTREtcbiAgICAgICAgKlxuICAgICAgICAqIEBtZXRob2QgaW5pdFxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBhcGlLZXkgeW91ciBtUGFydGljbGUgYXNzaWduZWQgQVBJIGtleVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gYW4gb3B0aW9ucyBvYmplY3QgZm9yIGFkZGl0aW9uYWwgY29uZmlndXJhdGlvblxuICAgICAgICAqL1xuICAgICAgICBpbml0OiBmdW5jdGlvbihhcGlLZXkpIHtcbiAgICAgICAgICAgIE1QLndlYnZpZXdCcmlkZ2VFbmFibGVkID0gTmF0aXZlU2RrSGVscGVycy5pc1dlYnZpZXdFbmFibGVkKG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lLCBtUGFydGljbGUubWluV2Vidmlld0JyaWRnZVZlcnNpb24pO1xuXG4gICAgICAgICAgICBpZiAoTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuU2V0U2Vzc2lvbkF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6ICckc3JjX2VudicsIHZhbHVlOiAnd2VidmlldycgfSkpO1xuICAgICAgICAgICAgICAgIGlmIChhcGlLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgTmF0aXZlU2RrSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLlNldFNlc3Npb25BdHRyaWJ1dGUsIEpTT04uc3RyaW5naWZ5KHsga2V5OiAnJHNyY19rZXknLCB2YWx1ZTogYXBpS2V5fSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvbmZpZywgY3VycmVudFVzZXI7XG5cbiAgICAgICAgICAgICAgICBNUC5zdG9yYWdlTmFtZSA9IEhlbHBlcnMuY3JlYXRlTWFpblN0b3JhZ2VOYW1lKG1QYXJ0aWNsZS53b3Jrc3BhY2VUb2tlbik7XG4gICAgICAgICAgICAgICAgTVAucHJvZFN0b3JhZ2VOYW1lID0gSGVscGVycy5jcmVhdGVQcm9kdWN0U3RvcmFnZU5hbWUobVBhcnRpY2xlLndvcmtzcGFjZVRva2VuKTtcblxuICAgICAgICAgICAgICAgIE1QLmludGVncmF0aW9uRGVsYXlUaW1lb3V0U3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgICAgICAgICAgIE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QgPSBtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0O1xuICAgICAgICAgICAgICAgIE1QLmRldlRva2VuID0gYXBpS2V5IHx8IG51bGw7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nSW5pdGlhbGl6YXRpb24pO1xuICAgICAgICAgICAgICAgIC8vY2hlY2sgdG8gc2VlIGlmIGxvY2FsU3RvcmFnZSBpcyBhdmFpbGFibGUgZm9yIG1pZ3JhdGluZyBwdXJwb3Nlc1xuICAgICAgICAgICAgICAgIE1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlID0gUGVyc2lzdGVuY2UuZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KHdpbmRvdy5sb2NhbFN0b3JhZ2UpO1xuXG4gICAgICAgICAgICAgICAgLy8gU2V0IGNvbmZpZ3VyYXRpb24gdG8gZGVmYXVsdCBzZXR0aW5nc1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoe30pO1xuXG4gICAgICAgICAgICAgICAgLy8gTWlncmF0ZSBhbnkgY29va2llcyBmcm9tIHByZXZpb3VzIHZlcnNpb25zIHRvIGN1cnJlbnQgY29va2llIHZlcnNpb25cbiAgICAgICAgICAgICAgICBNaWdyYXRpb25zLm1pZ3JhdGUoKTtcblxuICAgICAgICAgICAgICAgIC8vIExvYWQgYW55IHNldHRpbmdzL2lkZW50aXRpZXMvYXR0cmlidXRlcyBmcm9tIGNvb2tpZSBvciBsb2NhbFN0b3JhZ2VcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5pbml0aWFsaXplU3RvcmFnZSgpO1xuXG4gICAgICAgICAgICAgICAgLy8gSWYgbm8gaWRlbnRpdHkgaXMgcGFzc2VkIGluLCB3ZSBzZXQgdGhlIHVzZXIgaWRlbnRpdGllcyB0byB3aGF0IGlzIGN1cnJlbnRseSBpbiBjb29raWVzIGZvciB0aGUgaWRlbnRpZnkgcmVxdWVzdFxuICAgICAgICAgICAgICAgIGlmICgoSGVscGVycy5pc09iamVjdChtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KSAmJiBPYmplY3Qua2V5cyhtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KS5sZW5ndGggPT09IDApIHx8ICFtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0ID0ge307XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGlkZW50aXR5VHlwZSBpbiBNUC51c2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1QLnVzZXJJZGVudGl0aWVzLmhhc093blByb3BlcnR5KGlkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0W1R5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eU5hbWUoSGVscGVycy5wYXJzZU51bWJlcihpZGVudGl0eVR5cGUpKV0gPSBNUC51c2VySWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0aWVzOiBtb2RpZmllZFVJZm9ySWRlbnRpdHlSZXF1ZXN0XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IG1QYXJ0aWNsZS5pZGVudGlmeVJlcXVlc3Q7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gSWYgbWlncmF0aW5nIGZyb20gcHJlLUlEU3luYyB0byBJRFN5bmMsIGEgc2Vzc2lvbklEIHdpbGwgZXhpc3QgYW5kIGFuIGlkZW50aWZ5IHJlcXVlc3Qgd2lsbCBub3QgaGF2ZSBiZWVuIGZpcmVkLCBzbyB3ZSBuZWVkIHRoaXMgY2hlY2tcbiAgICAgICAgICAgICAgICBpZiAoTVAubWlncmF0aW5nVG9JRFN5bmNDb29raWVzKSB7XG4gICAgICAgICAgICAgICAgICAgIElkZW50aXR5QVBJLmlkZW50aWZ5KE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QsIG1QYXJ0aWNsZS5pZGVudGlmeVJlcXVlc3QpO1xuICAgICAgICAgICAgICAgICAgICBNUC5taWdyYXRpbmdUb0lEU3luY0Nvb2tpZXMgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjdXJyZW50VXNlciA9IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpO1xuICAgICAgICAgICAgICAgIC8vIENhbGwgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgd2hlbiBpZGVudGlmeSB3YXMgbm90IGNhbGxlZCBkdWUgdG8gYSByZWxvYWQgb3IgYSBzZXNzaW9uSWQgYWxyZWFkeSBleGlzdGluZ1xuICAgICAgICAgICAgICAgIGlmICghTVAuaWRlbnRpZnlDYWxsZWQgJiYgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgJiYgTVAubXBpZCAmJiBjdXJyZW50VXNlcikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayh7XG4gICAgICAgICAgICAgICAgICAgICAgICBodHRwQ29kZTogSFRUUENvZGVzLmFjdGl2ZVNlc3Npb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBnZXRVc2VyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlcihNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbXBpZDogTVAubXBpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc19sb2dnZWRfaW46IE1QLmlzTG9nZ2VkSW4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlZF9pZGVudGl0aWVzOiBjdXJyZW50VXNlciA/IGN1cnJlbnRVc2VyLmdldFVzZXJJZGVudGl0aWVzKCkudXNlcklkZW50aXRpZXMgOiB7fSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0OiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzX2VwaGVtZXJhbDogZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5pbml0Rm9yd2FyZGVycyhNUC5pbml0aWFsSWRlbnRpZnlSZXF1ZXN0LnVzZXJJZGVudGl0aWVzKTtcbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5oYXNGZWF0dXJlRmxhZyhDb25zdGFudHMuRmVhdHVyZXMuQmF0Y2hpbmcpKSB7XG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRpbmdTdGF0c1VwbG9hZGVyLnN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXIoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoYXJndW1lbnRzICYmIGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxICYmIHR5cGVvZiBhcmd1bWVudHNbMV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWcgPSBhcmd1bWVudHNbMV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5tZXJnZUNvbmZpZyhjb25maWcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLmluaXRpYWxpemUoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nQVNUKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhbGwgYW55IGZ1bmN0aW9ucyB0aGF0IGFyZSB3YWl0aW5nIGZvciB0aGUgbGlicmFyeSB0byBiZSBpbml0aWFsaXplZFxuICAgICAgICAgICAgaWYgKE1QLnJlYWR5UXVldWUgJiYgTVAucmVhZHlRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBNUC5yZWFkeVF1ZXVlLmZvckVhY2goZnVuY3Rpb24ocmVhZHlRdWV1ZUl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihyZWFkeVF1ZXVlSXRlbSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYWR5UXVldWVJdGVtKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShyZWFkeVF1ZXVlSXRlbSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NQcmVsb2FkZWRJdGVtKHJlYWR5UXVldWVJdGVtKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgTVAucmVhZHlRdWV1ZSA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgTVAuaXNJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIENvbXBsZXRlbHkgcmVzZXRzIHRoZSBzdGF0ZSBvZiB0aGUgU0RLLiBtUGFydGljbGUuaW5pdChhcGlLZXkpIHdpbGwgbmVlZCB0byBiZSBjYWxsZWQgYWdhaW4uXG4gICAgICAgICogQG1ldGhvZCByZXNldFxuICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0ga2VlcFBlcnNpc3RlbmNlIGlmIHBhc3NlZCBhcyB0cnVlLCB0aGlzIG1ldGhvZCB3aWxsIG9ubHkgcmVzZXQgdGhlIGluLW1lbW9yeSBTREsgc3RhdGUuXG4gICAgICAgICovXG4gICAgICAgIHJlc2V0OiBmdW5jdGlvbihrZWVwUGVyc2lzdGVuY2UpIHtcbiAgICAgICAgICAgIE1QLnNlc3Npb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSB0cnVlO1xuICAgICAgICAgICAgTVAuaXNGaXJzdFJ1biA9IG51bGw7XG4gICAgICAgICAgICBFdmVudHMuc3RvcFRyYWNraW5nKCk7XG4gICAgICAgICAgICBNUC5kZXZUb2tlbiA9IG51bGw7XG4gICAgICAgICAgICBNUC5zZXNzaW9uSWQgPSBudWxsO1xuICAgICAgICAgICAgTVAuYXBwTmFtZSA9IG51bGw7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gbnVsbDtcbiAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSBbXSxcbiAgICAgICAgICAgIE1QLmV2ZW50UXVldWUgPSBbXTtcbiAgICAgICAgICAgIE1QLmNvbnRleHQgPSBudWxsO1xuICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0ge307XG4gICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMgPSBbXTtcbiAgICAgICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzID0gW107XG4gICAgICAgICAgICBNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnMgPSBbXTtcbiAgICAgICAgICAgIE1QLnBpeGVsQ29uZmlndXJhdGlvbnMgPSBbXTtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IFtdO1xuICAgICAgICAgICAgTVAuc2VydmVyU2V0dGluZ3MgPSBudWxsO1xuICAgICAgICAgICAgTVAubXBpZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5jdXN0b21GbGFncyA9IG51bGw7XG4gICAgICAgICAgICBNUC5jdXJyZW5jeUNvZGU7XG4gICAgICAgICAgICBNUC5jbGllbnRJZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5kZXZpY2VJZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IG51bGw7XG4gICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbnVsbDtcbiAgICAgICAgICAgIE1QLndhdGNoUG9zaXRpb25JZCA9IG51bGw7XG4gICAgICAgICAgICBNUC5yZWFkeVF1ZXVlID0gW107XG4gICAgICAgICAgICBNUC5taWdyYXRpb25EYXRhID0ge307XG4gICAgICAgICAgICBNUC5pZGVudGl0eUNhbGxJbkZsaWdodCA9IGZhbHNlO1xuICAgICAgICAgICAgTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdCA9IG51bGw7XG4gICAgICAgICAgICBNUC5pc0luaXRpYWxpemVkID0gZmFsc2U7XG4gICAgICAgICAgICBNUC5pZGVudGlmeUNhbGxlZCA9IGZhbHNlO1xuICAgICAgICAgICAgTVAuY29uc2VudFN0YXRlID0gbnVsbDtcbiAgICAgICAgICAgIE1QLmZlYXR1cmVGbGFncyA9IHt9O1xuICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkRlbGF5cyA9IHt9O1xuICAgICAgICAgICAgTVAucmVxdWlyZURlbGF5ID0gdHJ1ZTtcbiAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoe30pO1xuICAgICAgICAgICAgaWYgKCFrZWVwUGVyc2lzdGVuY2UpIHtcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5yZXNldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayA9IG51bGw7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLnVwbG9hZHNUYWJsZSA9IHt9O1xuICAgICAgICAgICAgUGVyc2lzdGVuY2UuZm9yd2FyZGluZ1N0YXRzQmF0Y2hlcy5mb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlID0gW107XG4gICAgICAgIH0sXG4gICAgICAgIHJlYWR5OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgICBpZiAoTVAuaXNJbml0aWFsaXplZCAmJiB0eXBlb2YgZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIE1QLnJlYWR5UXVldWUucHVzaChmKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqIEBtZXRob2QgZ2V0VmVyc2lvblxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBnZXRWZXJzaW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBDb25zdGFudHMuc2RrVmVyc2lvbjtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmVyc2lvbiB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBWZXJzaW9uOiBmdW5jdGlvbih2ZXJzaW9uKSB7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gdmVyc2lvbjtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXRzIHRoZSBhcHAgbmFtZVxuICAgICAgICAqIEBtZXRob2QgZ2V0QXBwTmFtZVxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gQXBwIG5hbWVcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0QXBwTmFtZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuYXBwTmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIG5hbWVcbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcE5hbWVcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBBcHAgTmFtZVxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBOYW1lOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgICAgICBNUC5hcHBOYW1lID0gbmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIGdldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcmV0dXJuIHtTdHJpbmd9IEFwcCB2ZXJzaW9uXG4gICAgICAgICovXG4gICAgICAgIGdldEFwcFZlcnNpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIE1QLmFwcFZlcnNpb247XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0b3BzIHRyYWNraW5nIHRoZSBsb2NhdGlvbiBvZiB0aGUgdXNlclxuICAgICAgICAqIEBtZXRob2Qgc3RvcFRyYWNraW5nTG9jYXRpb25cbiAgICAgICAgKi9cbiAgICAgICAgc3RvcFRyYWNraW5nTG9jYXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuc3RvcFRyYWNraW5nKCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0YXJ0cyB0cmFja2luZyB0aGUgbG9jYXRpb24gb2YgdGhlIHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIHN0YXJ0VHJhY2tpbmdMb2NhdGlvblxuICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gQSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGlzIGNhbGxlZCB3aGVuIHRoZSBsb2NhdGlvbiBpcyBlaXRoZXIgYWxsb3dlZCBvciByZWplY3RlZCBieSB0aGUgdXNlci4gQSBwb3NpdGlvbiBvYmplY3Qgb2Ygc2NoZW1hIHtjb29yZHM6IHtsYXRpdHVkZTogbnVtYmVyLCBsb25naXR1ZGU6IG51bWJlcn19IGlzIHBhc3NlZCB0byB0aGUgY2FsbGJhY2tcbiAgICAgICAgKi9cbiAgICAgICAgc3RhcnRUcmFja2luZ0xvY2F0aW9uOiBmdW5jdGlvbihjYWxsYmFjaykge1xuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnV2FybmluZzogTG9jYXRpb24gdHJhY2tpbmcgaXMgdHJpZ2dlcmVkLCBidXQgbm90IGluY2x1ZGluZyBhIGNhbGxiYWNrIGludG8gdGhlIGBzdGFydFRyYWNraW5nTG9jYXRpb25gIG1heSByZXN1bHQgaW4gZXZlbnRzIGxvZ2dlZCB0b28gcXVpY2tseSBhbmQgbm90IGJlaW5nIGFzc29jaWF0ZWQgd2l0aCBhIGxvY2F0aW9uLicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIEV2ZW50cy5zdGFydFRyYWNraW5nKGNhbGxiYWNrKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgcG9zaXRpb24gb2YgdGhlIHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIHNldFBvc2l0aW9uXG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IGxhdHRpdHVkZSBsYXR0aXR1ZGUgZGlnaXRcbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gbG9uZ2l0dWRlIGxvbmdpdHVkZSBkaWdpdFxuICAgICAgICAqL1xuICAgICAgICBzZXRQb3NpdGlvbjogZnVuY3Rpb24obGF0LCBsbmcpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBsYXQgPT09ICdudW1iZXInICYmIHR5cGVvZiBsbmcgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgTVAuY3VycmVudFBvc2l0aW9uID0ge1xuICAgICAgICAgICAgICAgICAgICBsYXQ6IGxhdCxcbiAgICAgICAgICAgICAgICAgICAgbG5nOiBsbmdcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUG9zaXRpb24gbGF0aXR1ZGUgYW5kL29yIGxvbmdpdHVkZSBtdXN0IGJvdGggYmUgb2YgdHlwZSBudW1iZXInKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU3RhcnRzIGEgbmV3IHNlc3Npb25cbiAgICAgICAgKiBAbWV0aG9kIHN0YXJ0TmV3U2Vzc2lvblxuICAgICAgICAqL1xuICAgICAgICBzdGFydE5ld1Nlc3Npb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgU2Vzc2lvbk1hbmFnZXIuc3RhcnROZXdTZXNzaW9uKCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIEVuZHMgdGhlIGN1cnJlbnQgc2Vzc2lvblxuICAgICAgICAqIEBtZXRob2QgZW5kU2Vzc2lvblxuICAgICAgICAqL1xuICAgICAgICBlbmRTZXNzaW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIC8vIFNlbmRzIHRydWUgYXMgYW4gb3ZlciByaWRlIHZzIHdoZW4gZW5kU2Vzc2lvbiBpcyBjYWxsZWQgZnJvbSB0aGUgc2V0SW50ZXJ2YWxcbiAgICAgICAgICAgIFNlc3Npb25NYW5hZ2VyLmVuZFNlc3Npb24odHJ1ZSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYW4gZXZlbnQgdG8gbVBhcnRpY2xlJ3Mgc2VydmVyc1xuICAgICAgICAqIEBtZXRob2QgbG9nRXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnROYW1lIFRoZSBuYW1lIG9mIHRoZSBldmVudFxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbZXZlbnRUeXBlXSBUaGUgZXZlbnRUeXBlIGFzIHNlZW4gW2hlcmVdKGh0dHA6Ly9kb2NzLm1wYXJ0aWNsZS5jb20vZGV2ZWxvcGVycy9zZGsvamF2YXNjcmlwdC9ldmVudC10cmFja2luZyNldmVudC10eXBlKVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbZXZlbnRJbmZvXSBBdHRyaWJ1dGVzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBBZGRpdGlvbmFsIGN1c3RvbUZsYWdzXG4gICAgICAgICovXG4gICAgICAgIGxvZ0V2ZW50OiBmdW5jdGlvbihldmVudE5hbWUsIGV2ZW50VHlwZSwgZXZlbnRJbmZvLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIChldmVudE5hbWUpICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5FdmVudE5hbWVJbnZhbGlkVHlwZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWV2ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGV2ZW50VHlwZSA9IFR5cGVzLkV2ZW50VHlwZS5Vbmtub3duO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIUhlbHBlcnMuaXNFdmVudFR5cGUoZXZlbnRUeXBlKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0ludmFsaWQgZXZlbnQgdHlwZTogJyArIGV2ZW50VHlwZSArICcsIG11c3QgYmUgb25lIG9mOiBcXG4nICsgSlNPTi5zdHJpbmdpZnkoVHlwZXMuRXZlbnRUeXBlKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIUhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuTG9nZ2luZ0Rpc2FibGVkKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEV2ZW50cy5sb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsIGV2ZW50TmFtZSwgZXZlbnRJbmZvLCBldmVudFR5cGUsIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogVXNlZCB0byBsb2cgY3VzdG9tIGVycm9yc1xuICAgICAgICAqXG4gICAgICAgICogQG1ldGhvZCBsb2dFcnJvclxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nIG9yIE9iamVjdH0gZXJyb3IgVGhlIG5hbWUgb2YgdGhlIGVycm9yIChzdHJpbmcpLCBvciBhbiBvYmplY3QgZm9ybWVkIGFzIGZvbGxvd3Mge25hbWU6ICdleGFtcGxlTmFtZScsIG1lc3NhZ2U6ICdleGFtcGxlTWVzc2FnZScsIHN0YWNrOiAnZXhhbXBsZVN0YWNrJ31cbiAgICAgICAgKi9cbiAgICAgICAgbG9nRXJyb3I6IGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIGlmICghZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgZXJyb3IgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgZXJyb3IgPSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgRXZlbnRzLmxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLkNyYXNoUmVwb3J0LFxuICAgICAgICAgICAgICAgIGVycm9yLm5hbWUgPyBlcnJvci5uYW1lIDogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG06IGVycm9yLm1lc3NhZ2UgPyBlcnJvci5tZXNzYWdlIDogZXJyb3IsXG4gICAgICAgICAgICAgICAgICAgIHM6ICdFcnJvcicsXG4gICAgICAgICAgICAgICAgICAgIHQ6IGVycm9yLnN0YWNrXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBUeXBlcy5FdmVudFR5cGUuT3RoZXIpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBMb2dzIGBjbGlja2AgZXZlbnRzXG4gICAgICAgICogQG1ldGhvZCBsb2dMaW5rXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHNlbGVjdG9yIFRoZSBzZWxlY3RvciB0byBhZGQgYSAnY2xpY2snIGV2ZW50IHRvIChleC4gI3B1cmNoYXNlLWV2ZW50KVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbZXZlbnROYW1lXSBUaGUgbmFtZSBvZiB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW2V2ZW50VHlwZV0gVGhlIGV2ZW50VHlwZSBhcyBzZWVuIFtoZXJlXShodHRwOi8vZG9jcy5tcGFydGljbGUuY29tL2RldmVsb3BlcnMvc2RrL2phdmFzY3JpcHQvZXZlbnQtdHJhY2tpbmcjZXZlbnQtdHlwZSlcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2V2ZW50SW5mb10gQXR0cmlidXRlcyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICovXG4gICAgICAgIGxvZ0xpbms6IGZ1bmN0aW9uKHNlbGVjdG9yLCBldmVudE5hbWUsIGV2ZW50VHlwZSwgZXZlbnRJbmZvKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIEV2ZW50cy5hZGRFdmVudEhhbmRsZXIoJ2NsaWNrJywgc2VsZWN0b3IsIGV2ZW50TmFtZSwgZXZlbnRJbmZvLCBldmVudFR5cGUpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBMb2dzIGBzdWJtaXRgIGV2ZW50c1xuICAgICAgICAqIEBtZXRob2QgbG9nRm9ybVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBzZWxlY3RvciBUaGUgc2VsZWN0b3IgdG8gYWRkIHRoZSBldmVudCBoYW5kbGVyIHRvIChleC4gI3NlYXJjaC1ldmVudClcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2V2ZW50TmFtZV0gVGhlIG5hbWUgb2YgdGhlIGV2ZW50XG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFtldmVudFR5cGVdIFRoZSBldmVudFR5cGUgYXMgc2VlbiBbaGVyZV0oaHR0cDovL2RvY3MubXBhcnRpY2xlLmNvbS9kZXZlbG9wZXJzL3Nkay9qYXZhc2NyaXB0L2V2ZW50LXRyYWNraW5nI2V2ZW50LXR5cGUpXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtldmVudEluZm9dIEF0dHJpYnV0ZXMgZm9yIHRoZSBldmVudFxuICAgICAgICAqL1xuICAgICAgICBsb2dGb3JtOiBmdW5jdGlvbihzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudFR5cGUsIGV2ZW50SW5mbykge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuYWRkRXZlbnRIYW5kbGVyKCdzdWJtaXQnLCBzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudEluZm8sIGV2ZW50VHlwZSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYSBwYWdlIHZpZXdcbiAgICAgICAgKiBAbWV0aG9kIGxvZ1BhZ2VWaWV3XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50TmFtZSBUaGUgbmFtZSBvZiB0aGUgZXZlbnQuIERlZmF1bHRzIHRvICdQYWdlVmlldycuXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFthdHRyc10gQXR0cmlidXRlcyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKi9cbiAgICAgICAgbG9nUGFnZVZpZXc6IGZ1bmN0aW9uKGV2ZW50TmFtZSwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcihldmVudE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGV2ZW50TmFtZSA9ICdQYWdlVmlldyc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghYXR0cnMpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cnMgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBob3N0bmFtZTogd2luZG93LmxvY2F0aW9uLmhvc3RuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IHdpbmRvdy5kb2N1bWVudC50aXRsZVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmICghSGVscGVycy5pc09iamVjdChhdHRycykpe1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgYXR0cmlidXRlcyBhcmd1bWVudCBtdXN0IGJlIGFuIG9iamVjdC4gQSAnICsgdHlwZW9mIGF0dHJzICsgJyB3YXMgZW50ZXJlZC4gUGxlYXNlIGNvcnJlY3QgYW5kIHJldHJ5LicpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChjdXN0b21GbGFncyAmJiAhSGVscGVycy5pc09iamVjdChjdXN0b21GbGFncykpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVGhlIGN1c3RvbUZsYWdzIGFyZ3VtZW50IG11c3QgYmUgYW4gb2JqZWN0LiBBICcgKyB0eXBlb2YgY3VzdG9tRmxhZ3MgKyAnIHdhcyBlbnRlcmVkLiBQbGVhc2UgY29ycmVjdCBhbmQgcmV0cnkuJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEV2ZW50cy5sb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldywgZXZlbnROYW1lLCBhdHRycywgVHlwZXMuRXZlbnRUeXBlLlVua25vd24sIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgfSxcbiAgICAgICAgQ29uc2VudDoge1xuICAgICAgICAgICAgY3JlYXRlR0RQUkNvbnNlbnQ6IENvbnNlbnQuY3JlYXRlR0RQUkNvbnNlbnQsXG4gICAgICAgICAgICBjcmVhdGVDb25zZW50U3RhdGU6IENvbnNlbnQuY3JlYXRlQ29uc2VudFN0YXRlXG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIEludm9rZSB0aGVzZSBtZXRob2RzIG9uIHRoZSBtUGFydGljbGUuZUNvbW1lcmNlIG9iamVjdC5cbiAgICAgICAgKiBFeGFtcGxlOiBtUGFydGljbGUuZUNvbW1lcmNlLmNyZWF0ZUltcHJlc2lvbiguLi4pXG4gICAgICAgICogQGNsYXNzIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgKi9cbiAgICAgICAgZUNvbW1lcmNlOiB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydCBvYmplY3QuXG4gICAgICAgICAgICAqIEV4YW1wbGU6IG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydC5hZGQoLi4uKVxuICAgICAgICAgICAgKiBAY2xhc3MgbVBhcnRpY2xlLmVDb21tZXJjZS5DYXJ0XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgQ2FydDoge1xuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICogQWRkcyBhIHByb2R1Y3QgdG8gdGhlIGNhcnRcbiAgICAgICAgICAgICAgICAqIEBtZXRob2QgYWRkXG4gICAgICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCBUaGUgcHJvZHVjdCB5b3Ugd2FudCB0byBhZGQgdG8gdGhlIGNhcnRcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2xvZ0V2ZW50Qm9vbGVhbl0gT3B0aW9uIHRvIGxvZyB0aGUgZXZlbnQgdG8gbVBhcnRpY2xlJ3Mgc2VydmVycy4gSWYgYmxhbmssIG5vIGxvZ2dpbmcgb2NjdXJzLlxuICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgYWRkOiBmdW5jdGlvbihwcm9kdWN0LCBsb2dFdmVudEJvb2xlYW4pIHtcbiAgICAgICAgICAgICAgICAgICAgbVBhcnRpY2xlVXNlckNhcnQoTVAubXBpZCkuYWRkKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbik7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAqIFJlbW92ZXMgYSBwcm9kdWN0IGZyb20gdGhlIGNhcnRcbiAgICAgICAgICAgICAgICAqIEBtZXRob2QgcmVtb3ZlXG4gICAgICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCBUaGUgcHJvZHVjdCB5b3Ugd2FudCB0byBhZGQgdG8gdGhlIGNhcnRcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2xvZ0V2ZW50Qm9vbGVhbl0gT3B0aW9uIHRvIGxvZyB0aGUgZXZlbnQgdG8gbVBhcnRpY2xlJ3Mgc2VydmVycy4gSWYgYmxhbmssIG5vIGxvZ2dpbmcgb2NjdXJzLlxuICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgcmVtb3ZlOiBmdW5jdGlvbihwcm9kdWN0LCBsb2dFdmVudEJvb2xlYW4pIHtcbiAgICAgICAgICAgICAgICAgICAgbVBhcnRpY2xlVXNlckNhcnQoTVAubXBpZCkucmVtb3ZlKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbik7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAqIENsZWFycyB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQG1ldGhvZCBjbGVhclxuICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgY2xlYXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGVVc2VyQ2FydChNUC5tcGlkKS5jbGVhcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogU2V0cyB0aGUgY3VycmVuY3kgY29kZVxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBzZXRDdXJyZW5jeUNvZGVcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGNvZGUgVGhlIGN1cnJlbmN5IGNvZGVcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBzZXRDdXJyZW5jeUNvZGU6IGZ1bmN0aW9uKGNvZGUpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGNvZGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0NvZGUgbXVzdCBiZSBhIHN0cmluZycpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIE1QLmN1cnJlbmN5Q29kZSA9IGNvZGU7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIENyZWF0ZXMgYSBwcm9kdWN0XG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGNyZWF0ZVByb2R1Y3RcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgcHJvZHVjdCBuYW1lXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBza3UgcHJvZHVjdCBza3VcbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IHByaWNlIHByb2R1Y3QgcHJpY2VcbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFtxdWFudGl0eV0gcHJvZHVjdCBxdWFudGl0eS4gSWYgYmxhbmssIGRlZmF1bHRzIHRvIDEuXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbdmFyaWFudF0gcHJvZHVjdCB2YXJpYW50XG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbY2F0ZWdvcnldIHByb2R1Y3QgY2F0ZWdvcnlcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFticmFuZF0gcHJvZHVjdCBicmFuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3Bvc2l0aW9uXSBwcm9kdWN0IHBvc2l0aW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbY291cG9uXSBwcm9kdWN0IGNvdXBvblxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJpYnV0ZXNdIHByb2R1Y3QgYXR0cmlidXRlc1xuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNyZWF0ZVByb2R1Y3Q6IGZ1bmN0aW9uKG5hbWUsIHNrdSwgcHJpY2UsIHF1YW50aXR5LCB2YXJpYW50LCBjYXRlZ29yeSwgYnJhbmQsIHBvc2l0aW9uLCBjb3Vwb24sIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZVByb2R1Y3QobmFtZSwgc2t1LCBwcmljZSwgcXVhbnRpdHksIHZhcmlhbnQsIGNhdGVnb3J5LCBicmFuZCwgcG9zaXRpb24sIGNvdXBvbiwgYXR0cmlidXRlcyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIENyZWF0ZXMgYSBwcm9tb3Rpb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgY3JlYXRlUHJvbW90aW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBhIHVuaXF1ZSBwcm9tb3Rpb24gaWRcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjcmVhdGl2ZV0gcHJvbW90aW9uIGNyZWF0aXZlXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbbmFtZV0gcHJvbW90aW9uIG5hbWVcbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFtwb3NpdGlvbl0gcHJvbW90aW9uIHBvc2l0aW9uXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlUHJvbW90aW9uOiBmdW5jdGlvbihpZCwgY3JlYXRpdmUsIG5hbWUsIHBvc2l0aW9uKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIEVjb21tZXJjZS5jcmVhdGVQcm9tb3Rpb24oaWQsIGNyZWF0aXZlLCBuYW1lLCBwb3NpdGlvbik7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIENyZWF0ZXMgYSBwcm9kdWN0IGltcHJlc3Npb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgY3JlYXRlSW1wcmVzc2lvblxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBpbXByZXNzaW9uIG5hbWVcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3QgZm9yIHdoaWNoIGFuIGltcHJlc3Npb24gaXMgYmVpbmcgY3JlYXRlZFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNyZWF0ZUltcHJlc3Npb246IGZ1bmN0aW9uKG5hbWUsIHByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZUltcHJlc3Npb24obmFtZSwgcHJvZHVjdCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIENyZWF0ZXMgYSB0cmFuc2FjdGlvbiBhdHRyaWJ1dGVzIG9iamVjdCB0byBiZSB1c2VkIHdpdGggYSBjaGVja291dFxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBjcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXNcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmcgb3IgTnVtYmVyfSBpZCBhIHVuaXF1ZSB0cmFuc2FjdGlvbiBpZFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2FmZmlsaWF0aW9uXSBhZmZpbGxpYXRpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjb3Vwb25Db2RlXSB0aGUgY291cG9uIGNvZGUgZm9yIHdoaWNoIHlvdSBhcmUgY3JlYXRpbmcgdHJhbnNhY3Rpb24gYXR0cmlidXRlc1xuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3JldmVudWVdIHRvdGFsIHJldmVudWUgZm9yIHRoZSBwcm9kdWN0IGJlaW5nIHB1cmNoYXNlZFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW3NoaXBwaW5nXSB0aGUgc2hpcHBpbmcgbWV0aG9kXG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbdGF4XSB0aGUgdGF4IGFtb3VudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlczogZnVuY3Rpb24oaWQsIGFmZmlsaWF0aW9uLCBjb3Vwb25Db2RlLCByZXZlbnVlLCBzaGlwcGluZywgdGF4KSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIEVjb21tZXJjZS5jcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXMoaWQsIGFmZmlsaWF0aW9uLCBjb3Vwb25Db2RlLCByZXZlbnVlLCBzaGlwcGluZywgdGF4KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIGNoZWNrb3V0IGFjdGlvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBsb2dDaGVja291dFxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gc3RlcCBjaGVja291dCBzdGVwIG51bWJlclxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYXR0cnNcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBsb2dDaGVja291dDogZnVuY3Rpb24oc3RlcCwgb3B0aW9ucywgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ0NoZWNrb3V0RXZlbnQoc3RlcCwgb3B0aW9ucywgYXR0cnMsIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHByb2R1Y3QgYWN0aW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1Byb2R1Y3RBY3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IHByb2R1Y3RBY3Rpb25UeXBlIHByb2R1Y3QgYWN0aW9uIHR5cGUgYXMgZm91bmQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL3NyYy90eXBlcy5qcyNMMjA2LUwyMTgpXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHRoZSBwcm9kdWN0IGZvciB3aGljaCB5b3UgYXJlIGNyZWF0aW5nIHRoZSBwcm9kdWN0IGFjdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIHByb2R1Y3QgYWN0aW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEN1c3RvbSBmbGFncyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgbG9nUHJvZHVjdEFjdGlvbjogZnVuY3Rpb24ocHJvZHVjdEFjdGlvblR5cGUsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dQcm9kdWN0QWN0aW9uRXZlbnQocHJvZHVjdEFjdGlvblR5cGUsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIExvZ3MgYSBwcm9kdWN0IHB1cmNoYXNlXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1B1cmNoYXNlXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMgdHJhbnNhY3Rpb25BdHRyaWJ1dGVzIG9iamVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCB0aGUgcHJvZHVjdCBiZWluZyBwdXJjaGFzZWRcbiAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbY2xlYXJDYXJ0XSBib29sZWFuIHRvIGNsZWFyIHRoZSBjYXJ0IGFmdGVyIGxvZ2dpbmcgb3Igbm90LiBEZWZhdWx0cyB0byBmYWxzZVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBvdGhlciBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIHByb2R1Y3QgcHVyY2hhc2VcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBsb2dQdXJjaGFzZTogZnVuY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBjbGVhckNhcnQsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIGlmICghdHJhbnNhY3Rpb25BdHRyaWJ1dGVzIHx8ICFwcm9kdWN0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRMb2dQdXJjaGFzZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1B1cmNoYXNlRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGNsZWFyQ2FydCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGUuZUNvbW1lcmNlLkNhcnQuY2xlYXIoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIExvZ3MgYSBwcm9kdWN0IHByb21vdGlvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBsb2dQcm9tb3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IHR5cGUgdGhlIHByb21vdGlvbiB0eXBlIGFzIGZvdW5kIFtoZXJlXShodHRwczovL2dpdGh1Yi5jb20vbVBhcnRpY2xlL21wYXJ0aWNsZS1zZGstamF2YXNjcmlwdC9ibG9iL21hc3Rlci12Mi9zcmMvdHlwZXMuanMjTDI3NS1MMjc5KVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvbW90aW9uIHByb21vdGlvbiBvYmplY3RcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFthdHRyc10gYm9vbGVhbiB0byBjbGVhciB0aGUgY2FydCBhZnRlciBsb2dnaW5nIG9yIG5vdFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ1Byb21vdGlvbjogZnVuY3Rpb24odHlwZSwgcHJvbW90aW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nUHJvbW90aW9uRXZlbnQodHlwZSwgcHJvbW90aW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgcHJvZHVjdCBpbXByZXNzaW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ0ltcHJlc3Npb25cbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGltcHJlc3Npb24gcHJvZHVjdCBpbXByZXNzaW9uIG9iamVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYXR0cnMgYXR0cmlidXRlcyByZWxhdGVkIHRvIHRoZSBpbXByZXNzaW9uIGxvZ1xuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ0ltcHJlc3Npb246IGZ1bmN0aW9uKGltcHJlc3Npb24sIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dJbXByZXNzaW9uRXZlbnQoaW1wcmVzc2lvbiwgYXR0cnMsIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHJlZnVuZFxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBsb2dSZWZ1bmRcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHRyYW5zYWN0aW9uQXR0cmlidXRlcyB0cmFuc2FjdGlvbiBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIHJlZnVuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCBwcm9kdWN0IGJlaW5nIHJlZnVuZGVkXG4gICAgICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2NsZWFyQ2FydF0gYm9vbGVhbiB0byBjbGVhciB0aGUgY2FydCBhZnRlciByZWZ1bmQgaXMgbG9nZ2VkLiBEZWZhdWx0cyB0byBmYWxzZS5cbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFthdHRyc10gYXR0cmlidXRlcyByZWxhdGVkIHRvIHRoZSByZWZ1bmRcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBsb2dSZWZ1bmQ6IGZ1bmN0aW9uKHRyYW5zYWN0aW9uQXR0cmlidXRlcywgcHJvZHVjdCwgY2xlYXJDYXJ0LCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nUmVmdW5kRXZlbnQodHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGNsZWFyQ2FydCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGUuZUNvbW1lcmNlLkNhcnQuY2xlYXIoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhwYW5kQ29tbWVyY2VFdmVudDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmV4cGFuZENvbW1lcmNlRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIGEgc2Vzc2lvbiBhdHRyaWJ1dGVcbiAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZVxuICAgICAgICAqIEBtZXRob2Qgc2V0U2Vzc2lvbkF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkga2V5IGZvciBzZXNzaW9uIGF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nIG9yIE51bWJlcn0gdmFsdWUgdmFsdWUgZm9yIHNlc3Npb24gYXR0cmlidXRlXG4gICAgICAgICovXG4gICAgICAgIHNldFNlc3Npb25BdHRyaWJ1dGU6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgLy8gTG9ncyB0byBjb29raWVcbiAgICAgICAgICAgIC8vIEFuZCBsb2dzIHRvIGluLW1lbW9yeSBvYmplY3RcbiAgICAgICAgICAgIC8vIEV4YW1wbGU6IG1QYXJ0aWNsZS5zZXRTZXNzaW9uQXR0cmlidXRlKCdsb2NhdGlvbicsICczMzQzMScpO1xuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkQXR0cmlidXRlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICBOYXRpdmVTZGtIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuU2V0U2Vzc2lvbkF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6IGtleSwgdmFsdWU6IHZhbHVlIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZXhpc3RpbmdQcm9wID0gSGVscGVycy5maW5kS2V5SW5PYmplY3QoTVAuc2Vzc2lvbkF0dHJpYnV0ZXMsIGtleSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nUHJvcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAga2V5ID0gZXhpc3RpbmdQcm9wO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgTVAuc2Vzc2lvbkF0dHJpYnV0ZXNba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcblxuICAgICAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmFwcGx5VG9Gb3J3YXJkZXJzKCdzZXRTZXNzaW9uQXR0cmlidXRlJywgW2tleSwgdmFsdWVdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldCBvcHQgb3V0IG9mIGxvZ2dpbmdcbiAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZVxuICAgICAgICAqIEBtZXRob2Qgc2V0T3B0T3V0XG4gICAgICAgICogQHBhcmFtIHtCb29sZWFufSBpc09wdGluZ091dCBib29sZWFuIHRvIG9wdCBvdXQgb3Igbm90LiBXaGVuIHNldCB0byB0cnVlLCBvcHQgb3V0IG9mIGxvZ2dpbmcuXG4gICAgICAgICovXG4gICAgICAgIHNldE9wdE91dDogZnVuY3Rpb24oaXNPcHRpbmdPdXQpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgTVAuaXNFbmFibGVkID0gIWlzT3B0aW5nT3V0O1xuXG4gICAgICAgICAgICBFdmVudHMubG9nT3B0T3V0KCk7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcblxuICAgICAgICAgICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZm9yd2FyZGVyLnNldE9wdE91dCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGZvcndhcmRlci5zZXRPcHRPdXQoaXNPcHRpbmdPdXQpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldCBvciByZW1vdmUgdGhlIGludGVncmF0aW9uIGF0dHJpYnV0ZXMgZm9yIGEgZ2l2ZW4gaW50ZWdyYXRpb24gSUQuXG4gICAgICAgICogSW50ZWdyYXRpb24gYXR0cmlidXRlcyBhcmUga2V5cyBhbmQgdmFsdWVzIHNwZWNpZmljIHRvIGEgZ2l2ZW4gaW50ZWdyYXRpb24uIEZvciBleGFtcGxlLFxuICAgICAgICAqIG1hbnkgaW50ZWdyYXRpb25zIGhhdmUgdGhlaXIgb3duIGludGVybmFsIHVzZXIvZGV2aWNlIElELiBtUGFydGljbGUgd2lsbCBzdG9yZSBpbnRlZ3JhdGlvbiBhdHRyaWJ1dGVzXG4gICAgICAgICogZm9yIGEgZ2l2ZW4gZGV2aWNlLCBhbmQgd2lsbCBiZSBhYmxlIHRvIHVzZSB0aGVzZSB2YWx1ZXMgZm9yIHNlcnZlci10by1zZXJ2ZXIgY29tbXVuaWNhdGlvbiB0byBzZXJ2aWNlcy5cbiAgICAgICAgKiBUaGlzIGlzIG9mdGVuIHVzZWZ1bCB3aGVuIHVzZWQgaW4gY29tYmluYXRpb24gd2l0aCBhIHNlcnZlci10by1zZXJ2ZXIgZmVlZCwgYWxsb3dpbmcgdGhlIGZlZWQgdG8gYmUgZW5yaWNoZWRcbiAgICAgICAgKiB3aXRoIHRoZSBuZWNlc3NhcnkgaW50ZWdyYXRpb24gYXR0cmlidXRlcyB0byBiZSBwcm9wZXJseSBmb3J3YXJkZWQgdG8gdGhlIGdpdmVuIGludGVncmF0aW9uLlxuICAgICAgICAqIEBmb3IgbVBhcnRpY2xlXG4gICAgICAgICogQG1ldGhvZCBzZXRJbnRlZ3JhdGlvbkF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBpbnRlZ3JhdGlvbklkIG1QYXJ0aWNsZSBpbnRlZ3JhdGlvbiBJRFxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBhdHRycyBhIG1hcCBvZiBhdHRyaWJ1dGVzIHRoYXQgd2lsbCByZXBsYWNlIGFueSBjdXJyZW50IGF0dHJpYnV0ZXMuIFRoZSBrZXlzIGFyZSBwcmVkZWZpbmVkIGJ5IG1QYXJ0aWNsZS5cbiAgICAgICAgKiBQbGVhc2UgY29uc3VsdCB3aXRoIHRoZSBtUGFydGljbGUgZG9jcyBvciB5b3VyIHNvbHV0aW9ucyBjb25zdWx0YW50IGZvciB0aGUgY29ycmVjdCB2YWx1ZS4gWW91IG1heVxuICAgICAgICAqIGFsc28gcGFzcyBhIG51bGwgb3IgZW1wdHkgbWFwIGhlcmUgdG8gcmVtb3ZlIGFsbCBvZiB0aGUgYXR0cmlidXRlcy5cbiAgICAgICAgKi9cbiAgICAgICAgc2V0SW50ZWdyYXRpb25BdHRyaWJ1dGU6IGZ1bmN0aW9uKGludGVncmF0aW9uSWQsIGF0dHJzKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGludGVncmF0aW9uSWQgIT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnaW50ZWdyYXRpb25JZCBtdXN0IGJlIGEgbnVtYmVyJyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGF0dHJzID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdID0ge307XG4gICAgICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuaXNPYmplY3QoYXR0cnMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGF0dHJzKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdID0ge307XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGF0dHJzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGtleSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGF0dHJzW2tleV0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KE1QLmludGVncmF0aW9uQXR0cmlidXRlc1tpbnRlZ3JhdGlvbklkXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1QLmludGVncmF0aW9uQXR0cmlidXRlc1tpbnRlZ3JhdGlvbklkXVtrZXldID0gYXR0cnNba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1QLmludGVncmF0aW9uQXR0cmlidXRlc1tpbnRlZ3JhdGlvbklkXSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdW2tleV0gPSBhdHRyc1trZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVmFsdWVzIGZvciBpbnRlZ3JhdGlvbiBhdHRyaWJ1dGVzIG11c3QgYmUgc3RyaW5ncy4gWW91IGVudGVyZWQgYSAnICsgdHlwZW9mIGF0dHJzW2tleV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0tleXMgbXVzdCBiZSBzdHJpbmdzLCB5b3UgZW50ZXJlZCBhICcgKyB0eXBlb2Yga2V5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQXR0cnMgbXVzdCBiZSBhbiBvYmplY3Qgd2l0aCBrZXlzIGFuZCB2YWx1ZXMuIFlvdSBlbnRlcmVkIGEgJyArIHR5cGVvZiBhdHRycyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCBpbnRlZ3JhdGlvbiBhdHRyaWJ1dGVzIGZvciBhIGdpdmVuIGludGVncmF0aW9uIElELlxuICAgICAgICAqIEBtZXRob2QgZ2V0SW50ZWdyYXRpb25BdHRyaWJ1dGVzXG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IGludGVncmF0aW9uSWQgbVBhcnRpY2xlIGludGVncmF0aW9uIElEXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3QgbWFwIG9mIHRoZSBpbnRlZ3JhdGlvbklkJ3MgYXR0cmlidXRlc1xuICAgICAgICAqL1xuICAgICAgICBnZXRJbnRlZ3JhdGlvbkF0dHJpYnV0ZXM6IGZ1bmN0aW9uKGludGVncmF0aW9uSWQpIHtcbiAgICAgICAgICAgIGlmIChNUC5pbnRlZ3JhdGlvbkF0dHJpYnV0ZXNbaW50ZWdyYXRpb25JZF0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzW2ludGVncmF0aW9uSWRdO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge307XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGFkZEZvcndhcmRlcjogZnVuY3Rpb24oZm9yd2FyZGVyUHJvY2Vzc29yKSB7XG4gICAgICAgICAgICBNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnMucHVzaChmb3J3YXJkZXJQcm9jZXNzb3IpO1xuICAgICAgICB9LFxuICAgICAgICBjb25maWd1cmVGb3J3YXJkZXI6IGZ1bmN0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgICAgIHZhciBuZXdGb3J3YXJkZXIgPSBudWxsLFxuICAgICAgICAgICAgICAgIGNvbmZpZyA9IGNvbmZpZ3VyYXRpb247XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IE1QLmZvcndhcmRlckNvbnN0cnVjdG9ycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnNbaV0ubmFtZSA9PT0gY29uZmlnLm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5pc0RlYnVnID09PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgfHwgY29uZmlnLmlzU2FuZGJveCA9PT0gbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIgPSBuZXcgTVAuZm9yd2FyZGVyQ29uc3RydWN0b3JzW2ldLmNvbnN0cnVjdG9yKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5pZCA9IGNvbmZpZy5tb2R1bGVJZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5pc1NhbmRib3ggPSBjb25maWcuaXNEZWJ1ZyB8fCBjb25maWcuaXNTYW5kYm94O1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmhhc1NhbmRib3ggPSBjb25maWcuaGFzRGVidWdTdHJpbmcgPT09ICd0cnVlJztcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5pc1Zpc2libGUgPSBjb25maWcuaXNWaXNpYmxlO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnNldHRpbmdzID0gY29uZmlnLnNldHRpbmdzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZXZlbnROYW1lRmlsdGVycyA9IGNvbmZpZy5ldmVudE5hbWVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmV2ZW50VHlwZUZpbHRlcnMgPSBjb25maWcuZXZlbnRUeXBlRmlsdGVycztcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5hdHRyaWJ1dGVGaWx0ZXJzID0gY29uZmlnLmF0dHJpYnV0ZUZpbHRlcnM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5zY3JlZW5OYW1lRmlsdGVycyA9IGNvbmZpZy5zY3JlZW5OYW1lRmlsdGVycztcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5zY3JlZW5OYW1lRmlsdGVycyA9IGNvbmZpZy5zY3JlZW5OYW1lRmlsdGVycztcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5wYWdlVmlld0F0dHJpYnV0ZUZpbHRlcnMgPSBjb25maWcucGFnZVZpZXdBdHRyaWJ1dGVGaWx0ZXJzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIudXNlcklkZW50aXR5RmlsdGVycyA9IGNvbmZpZy51c2VySWRlbnRpdHlGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzID0gY29uZmlnLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZSA9IGNvbmZpZy5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmZpbHRlcmluZ1VzZXJBdHRyaWJ1dGVWYWx1ZSA9IGNvbmZpZy5maWx0ZXJpbmdVc2VyQXR0cmlidXRlVmFsdWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZXZlbnRTdWJzY3JpcHRpb25JZCA9IGNvbmZpZy5ldmVudFN1YnNjcmlwdGlvbklkO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmZpbHRlcmluZ0NvbnNlbnRSdWxlVmFsdWVzID0gY29uZmlnLmZpbHRlcmluZ0NvbnNlbnRSdWxlVmFsdWVzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmV4Y2x1ZGVBbm9ueW1vdXNVc2VyID0gY29uZmlnLmV4Y2x1ZGVBbm9ueW1vdXNVc2VyO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBNUC5jb25maWd1cmVkRm9yd2FyZGVycy5wdXNoKG5ld0ZvcndhcmRlcik7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgY29uZmlndXJlUGl4ZWw6IGZ1bmN0aW9uKHNldHRpbmdzKSB7XG4gICAgICAgICAgICBpZiAoc2V0dGluZ3MuaXNEZWJ1ZyA9PT0gbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlIHx8IHNldHRpbmdzLmlzUHJvZHVjdGlvbiAhPT0gbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlKSB7XG4gICAgICAgICAgICAgICAgTVAucGl4ZWxDb25maWd1cmF0aW9ucy5wdXNoKHNldHRpbmdzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgX2dldEFjdGl2ZUZvcndhcmRlcnM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIE1QLmFjdGl2ZUZvcndhcmRlcnM7XG4gICAgICAgIH0sXG4gICAgICAgIF9nZXRJbnRlZ3JhdGlvbkRlbGF5czogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuaW50ZWdyYXRpb25EZWxheXM7XG4gICAgICAgIH0sXG4gICAgICAgIF9jb25maWd1cmVGZWF0dXJlczogZnVuY3Rpb24oZmVhdHVyZUZsYWdzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gZmVhdHVyZUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZlYXR1cmVGbGFncy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLmZlYXR1cmVGbGFnc1trZXldID0gZmVhdHVyZUZsYWdzW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBfc2V0SW50ZWdyYXRpb25EZWxheTogZnVuY3Rpb24obW9kdWxlLCBib29sZWFuKSB7XG4gICAgICAgICAgICBNUC5pbnRlZ3JhdGlvbkRlbGF5c1ttb2R1bGVdID0gYm9vbGVhbjtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzUHJlbG9hZGVkSXRlbShyZWFkeVF1ZXVlSXRlbSkge1xuICAgICAgICB2YXIgY3VycmVudFVzZXIsXG4gICAgICAgICAgICBhcmdzID0gcmVhZHlRdWV1ZUl0ZW0sXG4gICAgICAgICAgICBtZXRob2QgPSBhcmdzLnNwbGljZSgwLCAxKVswXTtcbiAgICAgICAgaWYgKG1QYXJ0aWNsZVthcmdzWzBdXSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlW21ldGhvZF0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kQXJyYXkgPSBtZXRob2Quc3BsaXQoJy4nKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvbXB1dGVkTVBGdW5jdGlvbiA9IG1QYXJ0aWNsZTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1ldGhvZEFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjdXJyZW50TWV0aG9kID0gbWV0aG9kQXJyYXlbaV07XG4gICAgICAgICAgICAgICAgICAgIGNvbXB1dGVkTVBGdW5jdGlvbiA9IGNvbXB1dGVkTVBGdW5jdGlvbltjdXJyZW50TWV0aG9kXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29tcHV0ZWRNUEZ1bmN0aW9uLmFwcGx5KGN1cnJlbnRVc2VyLCBhcmdzKTtcbiAgICAgICAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1VuYWJsZSB0byBjb21wdXRlIHByb3BlciBtUGFydGljbGUgZnVuY3Rpb24gJyArIGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVhZCBleGlzdGluZyBjb25maWd1cmF0aW9uIGlmIHByZXNlbnRcbiAgICBpZiAod2luZG93Lm1QYXJ0aWNsZSAmJiB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZykge1xuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuc2VydmljZVVybCkge1xuICAgICAgICAgICAgQ29uc3RhbnRzLnNlcnZpY2VVcmwgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5zZXJ2aWNlVXJsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnNlY3VyZVNlcnZpY2VVcmwpIHtcbiAgICAgICAgICAgIENvbnN0YW50cy5zZWN1cmVTZXJ2aWNlVXJsID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuc2VjdXJlU2VydmljZVVybDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGZvciBhbnkgZnVuY3Rpb25zIHF1ZXVlZFxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcucnEpIHtcbiAgICAgICAgICAgIE1QLnJlYWR5UXVldWUgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5ycTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5sb2dMZXZlbCkge1xuICAgICAgICAgICAgTVAubG9nTGV2ZWwgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5sb2dMZXZlbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnaXNEZXZlbG9wbWVudE1vZGUnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlID0gSGVscGVycy5yZXR1cm5Db252ZXJ0ZWRCb29sZWFuKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmlzRGV2ZWxvcG1lbnRNb2RlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgndXNlTmF0aXZlU2RrJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS51c2VOYXRpdmVTZGsgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy51c2VOYXRpdmVTZGs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ3VzZUNvb2tpZVN0b3JhZ2UnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy51c2VDb29raWVTdG9yYWdlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdtYXhQcm9kdWN0cycpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUubWF4UHJvZHVjdHMgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5tYXhQcm9kdWN0cztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnbWF4Q29va2llU2l6ZScpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUubWF4Q29va2llU2l6ZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLm1heENvb2tpZVNpemU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2FwcE5hbWUnKSkge1xuICAgICAgICAgICAgTVAuYXBwTmFtZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmFwcE5hbWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2ludGVncmF0aW9uRGVsYXlUaW1lb3V0JykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5pbnRlZ3JhdGlvbkRlbGF5VGltZW91dCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmludGVncmF0aW9uRGVsYXlUaW1lb3V0O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdpZGVudGlmeVJlcXVlc3QnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLmlkZW50aWZ5UmVxdWVzdCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmlkZW50aWZ5UmVxdWVzdDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnaWRlbnRpdHlDYWxsYmFjaycpKSB7XG4gICAgICAgICAgICB2YXIgY2FsbGJhY2sgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5pZGVudGl0eUNhbGxiYWNrO1xuICAgICAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmlkZW50aXR5Q2FsbGJhY2s7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RoZSBvcHRpb25hbCBjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24uIFlvdSB0cmllZCBlbnRlcmluZyBhKG4pICcgKyB0eXBlb2YgY2FsbGJhY2ssICcgLiBDYWxsYmFjayBub3Qgc2V0LiBQbGVhc2Ugc2V0IHlvdXIgY2FsbGJhY2sgYWdhaW4uJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2FwcFZlcnNpb24nKSkge1xuICAgICAgICAgICAgTVAuYXBwVmVyc2lvbiA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmFwcFZlcnNpb247XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ3Nlc3Npb25UaW1lb3V0JykpIHtcbiAgICAgICAgICAgIE1QLkNvbmZpZy5TZXNzaW9uVGltZW91dCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnNlc3Npb25UaW1lb3V0O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdmb3JjZUh0dHBzJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5mb3JjZUh0dHBzID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuZm9yY2VIdHRwcztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5mb3JjZUh0dHBzID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvbWUgZm9yd2FyZGVycyByZXF1aXJlIGN1c3RvbSBmbGFncyBvbiBpbml0aWFsaXphdGlvbiwgc28gYWxsb3cgdGhlbSB0byBiZSBzZXQgdXNpbmcgY29uZmlnIG9iamVjdFxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2N1c3RvbUZsYWdzJykpIHtcbiAgICAgICAgICAgIE1QLmN1c3RvbUZsYWdzID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuY3VzdG9tRmxhZ3M7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ3dvcmtzcGFjZVRva2VuJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS53b3Jrc3BhY2VUb2tlbiA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLndvcmtzcGFjZVRva2VuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdyZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcucmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcud29ya3NwYWNlVG9rZW47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ21pbldlYnZpZXdCcmlkZ2VWZXJzaW9uJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5taW5XZWJ2aWV3QnJpZGdlVmVyc2lvbiA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLm1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd2luZG93Lm1QYXJ0aWNsZSA9IG1QYXJ0aWNsZTtcbn0pKHdpbmRvdyk7XG4iLCJ2YXIgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBUeXBlcyA9IHJlcXVpcmUoJy4vdHlwZXMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgQ29uZmlnID0gTVAuQ29uZmlnLFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXMgPSBDb25zdGFudHMuU0RLdjJOb25NUElEQ29va2llS2V5cyxcbiAgICBCYXNlNjQgPSByZXF1aXJlKCcuL3BvbHlmaWxsJykuQmFzZTY0LFxuICAgIENvb2tpZXNHbG9iYWxTZXR0aW5nc0tleXMgPSB7XG4gICAgICAgIGN1cnJlbnRTZXNzaW9uTVBJRHM6IDEsXG4gICAgICAgIGNzbTogMSxcbiAgICAgICAgc2lkOiAxLFxuICAgICAgICBpc0VuYWJsZWQ6IDEsXG4gICAgICAgIGllOiAxLFxuICAgICAgICBzYTogMSxcbiAgICAgICAgc3M6IDEsXG4gICAgICAgIGR0OiAxLFxuICAgICAgICBsZXM6IDEsXG4gICAgICAgIGF2OiAxLFxuICAgICAgICBjZ2lkOiAxLFxuICAgICAgICBkYXM6IDEsXG4gICAgICAgIGM6IDFcbiAgICB9LFxuICAgIE1QSURLZXlzID0ge1xuICAgICAgICB1aTogMSxcbiAgICAgICAgdWE6IDEsXG4gICAgICAgIGNzZDogMVxuICAgIH07XG5cbi8vICBpZiB0aGVyZSBpcyBhIGNvb2tpZSBvciBsb2NhbFN0b3JhZ2U6XG4vLyAgMS4gZGV0ZXJtaW5lIHdoaWNoIHZlcnNpb24gaXQgaXMgKCdtcHJ0Y2wtYXBpJywgJ21wcnRjbC12MicsICdtcHJ0Y2wtdjMnLCAnbXBydGNsLXY0Jylcbi8vICAyLiByZXR1cm4gaWYgJ21wcnRjbC12NCcsIG90aGVyd2lzZSBtaWdyYXRlIHRvIG1wcnRjbHY0IHNjaGVtYVxuIC8vIDMuIGlmICdtcHJ0Y2wtYXBpJywgY291bGQgYmUgSlNTREt2MiBvciBKU1NES3YxLiBKU1NES3YyIGNvb2tpZSBoYXMgYSAnZ2xvYmFsU2V0dGluZ3MnIGtleSBvbiBpdFxuZnVuY3Rpb24gbWlncmF0ZSgpIHtcbiAgICB0cnkge1xuICAgICAgICBtaWdyYXRlQ29va2llcygpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgUGVyc2lzdGVuY2UuZXhwaXJlQ29va2llcyhDb25maWcuQ29va2llTmFtZVYzKTtcbiAgICAgICAgUGVyc2lzdGVuY2UuZXhwaXJlQ29va2llcyhDb25maWcuQ29va2llTmFtZVY0KTtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgbWlncmF0aW5nIGNvb2tpZTogJyArIGUpO1xuICAgIH1cblxuICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbWlncmF0ZUxvY2FsU3RvcmFnZSgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShDb25maWcuTG9jYWxTdG9yYWdlTmFtZVYzKTtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQpO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgbWlncmF0aW5nIGxvY2FsU3RvcmFnZTogJyArIGUpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBtaWdyYXRlQ29va2llcygpIHtcbiAgICB2YXIgY29va2llcyA9IHdpbmRvdy5kb2N1bWVudC5jb29raWUuc3BsaXQoJzsgJyksXG4gICAgICAgIGZvdW5kQ29va2llLFxuICAgICAgICBpLFxuICAgICAgICBsLFxuICAgICAgICBwYXJ0cyxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY29va2llO1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhDb25zdGFudHMuTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Db29raWVTZWFyY2gpO1xuXG4gICAgZm9yIChpID0gMCwgbCA9IGNvb2tpZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHBhcnRzID0gY29va2llc1tpXS5zcGxpdCgnPScpO1xuICAgICAgICBuYW1lID0gSGVscGVycy5kZWNvZGVkKHBhcnRzLnNoaWZ0KCkpO1xuICAgICAgICBjb29raWUgPSBIZWxwZXJzLmRlY29kZWQocGFydHMuam9pbignPScpKSxcbiAgICAgICAgZm91bmRDb29raWU7XG5cbiAgICAgICAgLy9tb3N0IHJlY2VudCB2ZXJzaW9uIG5lZWRzIG5vIG1pZ3JhdGlvblxuICAgICAgICBpZiAobmFtZSA9PT0gTVAuc3RvcmFnZU5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAobmFtZSA9PT0gQ29uZmlnLkNvb2tpZU5hbWVWNCkge1xuICAgICAgICAgICAgLy8gYWRkcyBjb29raWVzIHRvIG5ldyBuYW1lc3BhY2UsIHJlbW92ZXMgcHJldmlvdXMgY29va2llXG4gICAgICAgICAgICBmaW5pc2hDb29raWVNaWdyYXRpb24oY29va2llLCBDb25maWcuQ29va2llTmFtZVY0KTtcbiAgICAgICAgICAgIG1pZ3JhdGVQcm9kdWN0c1RvTmFtZVNwYWNlKCk7XG4gICAgICAgIC8vIG1pZ3JhdGlvbiBwYXRoIGZvciBTREt2MUNvb2tpZXNWMywgZG9lc24ndCBuZWVkIHRvIGJlIGVuY29kZWRcbiAgICAgICAgfSBlbHNlIGlmIChuYW1lID09PSBDb25maWcuQ29va2llTmFtZVYzKSB7XG4gICAgICAgICAgICBmb3VuZENvb2tpZSA9IGNvbnZlcnRTREt2MUNvb2tpZXNWM1RvU0RLdjJDb29raWVzVjQoY29va2llKTtcbiAgICAgICAgICAgIGZpbmlzaENvb2tpZU1pZ3JhdGlvbihmb3VuZENvb2tpZSwgQ29uZmlnLkNvb2tpZU5hbWVWMyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgLy8gbWlncmF0aW9uIHBhdGggZm9yIFNES3YxQ29va2llc1YyLCBuZWVkcyB0byBiZSBlbmNvZGVkXG4gICAgICAgIH0gZWxzZSBpZiAobmFtZSA9PT0gQ29uZmlnLkNvb2tpZU5hbWVWMikge1xuICAgICAgICAgICAgZm91bmRDb29raWUgPSBjb252ZXJ0U0RLdjFDb29raWVzVjJUb1NES3YyQ29va2llc1Y0KEhlbHBlcnMuY29udmVydGVkKGNvb2tpZSkpO1xuICAgICAgICAgICAgZmluaXNoQ29va2llTWlncmF0aW9uKFBlcnNpc3RlbmNlLmVuY29kZUNvb2tpZXMoZm91bmRDb29raWUpLCBDb25maWcuQ29va2llTmFtZVYyKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBtaWdyYXRpb24gcGF0aCBmb3IgdjEsIG5lZWRzIHRvIGJlIGVuY29kZWRcbiAgICAgICAgfSBlbHNlIGlmIChuYW1lID09PSBDb25maWcuQ29va2llTmFtZSkge1xuICAgICAgICAgICAgZm91bmRDb29raWUgPSBIZWxwZXJzLmNvbnZlcnRlZChjb29raWUpO1xuICAgICAgICAgICAgaWYgKEpTT04ucGFyc2UoZm91bmRDb29raWUpLmdsb2JhbFNldHRpbmdzKSB7XG4gICAgICAgICAgICAgICAgLy8gQ29va2llVjEgZnJvbSBTREt2MlxuICAgICAgICAgICAgICAgIGZvdW5kQ29va2llID0gY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQoZm91bmRDb29raWUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBDb29raWVWMSBmcm9tIFNES3YxXG4gICAgICAgICAgICAgICAgZm91bmRDb29raWUgPSBjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0KGZvdW5kQ29va2llKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZpbmlzaENvb2tpZU1pZ3JhdGlvbihQZXJzaXN0ZW5jZS5lbmNvZGVDb29raWVzKGZvdW5kQ29va2llKSwgQ29uZmlnLkNvb2tpZU5hbWUpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZpbmlzaENvb2tpZU1pZ3JhdGlvbihjb29raWUsIGNvb2tpZU5hbWUpIHtcbiAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKCksXG4gICAgICAgIGNvb2tpZURvbWFpbiA9IFBlcnNpc3RlbmNlLmdldENvb2tpZURvbWFpbigpLFxuICAgICAgICBleHBpcmVzLFxuICAgICAgICBkb21haW47XG5cbiAgICBleHBpcmVzID0gbmV3IERhdGUoZGF0ZS5nZXRUaW1lKCkgK1xuICAgIChDb25maWcuQ29va2llRXhwaXJhdGlvbiAqIDI0ICogNjAgKiA2MCAqIDEwMDApKS50b0dNVFN0cmluZygpO1xuXG4gICAgaWYgKGNvb2tpZURvbWFpbiA9PT0gJycpIHtcbiAgICAgICAgZG9tYWluID0gJyc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgZG9tYWluID0gJztkb21haW49JyArIGNvb2tpZURvbWFpbjtcbiAgICB9XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKENvbnN0YW50cy5NZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVNldCk7XG5cbiAgICB3aW5kb3cuZG9jdW1lbnQuY29va2llID1cbiAgICBlbmNvZGVVUklDb21wb25lbnQoTVAuc3RvcmFnZU5hbWUpICsgJz0nICsgY29va2llICtcbiAgICAnO2V4cGlyZXM9JyArIGV4cGlyZXMgK1xuICAgICc7cGF0aD0vJyArIGRvbWFpbjtcblxuICAgIFBlcnNpc3RlbmNlLmV4cGlyZUNvb2tpZXMoY29va2llTmFtZSk7XG4gICAgTVAubWlncmF0aW5nVG9JRFN5bmNDb29raWVzID0gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMSkge1xuICAgIHZhciBwYXJzZWRDb29raWVzVjQgPSBKU09OLnBhcnNlKHJlc3RydWN0dXJlVG9WNENvb2tpZShkZWNvZGVVUklDb21wb25lbnQoU0RLdjFDb29raWVzVjEpKSksXG4gICAgICAgIHBhcnNlZFNES3YxQ29va2llc1YxID0gSlNPTi5wYXJzZShkZWNvZGVVUklDb21wb25lbnQoU0RLdjFDb29raWVzVjEpKTtcblxuICAgIC8vIFVJIHdhcyBzdG9yZWQgYXMgYW4gYXJyYXkgcHJldmlvdXNseSwgd2UgbmVlZCB0byBjb252ZXJ0IHRvIGFuIG9iamVjdFxuICAgIHBhcnNlZENvb2tpZXNWNCA9IGNvbnZlcnRVSUZyb21BcnJheVRvT2JqZWN0KHBhcnNlZENvb2tpZXNWNCk7XG5cbiAgICBpZiAocGFyc2VkU0RLdjFDb29raWVzVjEubXBpZCkge1xuICAgICAgICBwYXJzZWRDb29raWVzVjQuZ3MuY3NtLnB1c2gocGFyc2VkU0RLdjFDb29raWVzVjEubXBpZCk7XG4gICAgICAgIG1pZ3JhdGVQcm9kdWN0c0Zyb21TREt2MVRvU0RLdjJDb29raWVzVjQocGFyc2VkU0RLdjFDb29raWVzVjEsIHBhcnNlZFNES3YxQ29va2llc1YxLm1waWQpO1xuICAgIH1cblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShwYXJzZWRDb29raWVzVjQpO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0U0RLdjFDb29raWVzVjJUb1NES3YyQ29va2llc1Y0KFNES3YxQ29va2llc1YyKSB7XG4gICAgLy8gc3RydWN0dXJlIG9mIFNES3YxQ29va2llc1YyIGlzIGlkZW50aXRhbCB0byBTREt2MUNvb2tpZXNWMVxuICAgIHJldHVybiBjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0KFNES3YxQ29va2llc1YyKTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YxQ29va2llc1YzVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMykge1xuICAgIFNES3YxQ29va2llc1YzID0gUGVyc2lzdGVuY2UucmVwbGFjZVBpcGVzV2l0aENvbW1hcyhQZXJzaXN0ZW5jZS5yZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzKFNES3YxQ29va2llc1YzKSk7XG4gICAgdmFyIHBhcnNlZFNES3YxQ29va2llc1YzID0gSlNPTi5wYXJzZShTREt2MUNvb2tpZXNWMyk7XG4gICAgdmFyIHBhcnNlZENvb2tpZXNWNCA9IEpTT04ucGFyc2UocmVzdHJ1Y3R1cmVUb1Y0Q29va2llKFNES3YxQ29va2llc1YzKSk7XG5cbiAgICBpZiAocGFyc2VkU0RLdjFDb29raWVzVjMubXBpZCkge1xuICAgICAgICBwYXJzZWRDb29raWVzVjQuZ3MuY3NtLnB1c2gocGFyc2VkU0RLdjFDb29raWVzVjMubXBpZCk7XG4gICAgICAgIC8vIGFsbCBvdGhlciB2YWx1ZXMgYXJlIGFscmVhZHkgZW5jb2RlZCwgc28gd2UgaGF2ZSB0byBlbmNvZGUgYW55IG5ldyB2YWx1ZXNcbiAgICAgICAgcGFyc2VkQ29va2llc1Y0LmdzLmNzbSA9IEJhc2U2NC5lbmNvZGUoSlNPTi5zdHJpbmdpZnkocGFyc2VkQ29va2llc1Y0LmdzLmNzbSkpO1xuICAgICAgICBtaWdyYXRlUHJvZHVjdHNGcm9tU0RLdjFUb1NES3YyQ29va2llc1Y0KHBhcnNlZFNES3YxQ29va2llc1YzLCBwYXJzZWRTREt2MUNvb2tpZXNWMy5tcGlkKTtcbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGFyc2VkQ29va2llc1Y0KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQoU0RLdjJDb29raWVzVjEpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgY29va2llc1Y0ID0geyBnczoge319LFxuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHMgPSB7fTtcblxuICAgICAgICBTREt2MkNvb2tpZXNWMSA9IEpTT04ucGFyc2UoU0RLdjJDb29raWVzVjEpO1xuICAgICAgICBjb29raWVzVjQgPSBzZXRHbG9iYWxTZXR0aW5ncyhjb29raWVzVjQsIFNES3YyQ29va2llc1YxKTtcblxuICAgICAgICAvLyBzZXQgZWFjaCBNUElEJ3MgcmVzcGVjdGl2ZSBwZXJzaXN0ZW5jZVxuICAgICAgICBmb3IgKHZhciBtcGlkIGluIFNES3YyQ29va2llc1YxKSB7XG4gICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICBjb29raWVzVjRbbXBpZF0gPSB7fTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtcGlkS2V5IGluIFNES3YyQ29va2llc1YxW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChTREt2MkNvb2tpZXNWMVttcGlkXS5oYXNPd25Qcm9wZXJ0eShtcGlkS2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1QSURLZXlzW21waWRLZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0pICYmIE9iamVjdC5rZXlzKFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG1waWRLZXkgPT09ICd1aScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFttcGlkXS51aSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgdHlwZU5hbWUgaW4gU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV0uaGFzT3duUHJvcGVydHkodHlwZU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFttcGlkXS51aVtUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlKHR5cGVOYW1lKV0gPSBTREt2MkNvb2tpZXNWMVttcGlkXVttcGlkS2V5XVt0eXBlTmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0W21waWRdW21waWRLZXldID0gU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2VQcm9kdWN0c1ttcGlkXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgY3A6IFNES3YyQ29va2llc1YxW21waWRdLmNwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKE1QLnByb2RTdG9yYWdlTmFtZSwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VQcm9kdWN0cykpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChTREt2MkNvb2tpZXNWMS5jdXJyZW50VXNlck1QSUQpIHtcbiAgICAgICAgICAgIGNvb2tpZXNWNC5jdSA9IFNES3YyQ29va2llc1YxLmN1cnJlbnRVc2VyTVBJRDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb29raWVzVjQpO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdGYWlsZWQgdG8gY29udmVydCBjb29raWVzIGZyb20gU0RLdjIgY29va2llcyB2MSB0byBTREt2MiBjb29raWVzIHY0Jyk7XG4gICAgfVxufVxuXG4vLyBtaWdyYXRlIGZyb20gb2JqZWN0IGNvbnRhaW5pbmcgZ2xvYmFsU2V0dGluZ3MgdG8gZ3MgdG8gcmVkdWNlIGNvb2tpZSBzaXplXG5mdW5jdGlvbiBzZXRHbG9iYWxTZXR0aW5ncyhjb29raWVzLCBTREt2MkNvb2tpZXNWMSkge1xuICAgIGlmIChTREt2MkNvb2tpZXNWMSAmJiBTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5ncykge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3MpIHtcbiAgICAgICAgICAgIGlmIChTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5ncy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gJ2N1cnJlbnRTZXNzaW9uTVBJRHMnKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXMuZ3MuY3NtID0gU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3Nba2V5XTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGtleSA9PT0gJ2lzRW5hYmxlZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llcy5ncy5pZSA9IFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzW2tleV07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llcy5nc1trZXldID0gU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3Nba2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY29va2llcztcbn1cblxuZnVuY3Rpb24gcmVzdHJ1Y3R1cmVUb1Y0Q29va2llKGNvb2tpZXMpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgY29va2llc1Y0U2NoZW1hID0geyBnczoge2NzbTogW119IH07XG4gICAgICAgIGNvb2tpZXMgPSBKU09OLnBhcnNlKGNvb2tpZXMpO1xuXG4gICAgICAgIGZvciAodmFyIGtleSBpbiBjb29raWVzKSB7XG4gICAgICAgICAgICBpZiAoY29va2llcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgaWYgKENvb2tpZXNHbG9iYWxTZXR0aW5nc0tleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSAnaXNFbmFibGVkJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0U2NoZW1hLmdzLmllID0gY29va2llc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0U2NoZW1hLmdzW2tleV0gPSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGtleSA9PT0gJ21waWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFNjaGVtYS5jdSA9IGNvb2tpZXNba2V5XTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvb2tpZXMubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRTY2hlbWFbY29va2llcy5tcGlkXSA9IGNvb2tpZXNWNFNjaGVtYVtjb29raWVzLm1waWRdIHx8IHt9O1xuICAgICAgICAgICAgICAgICAgICBpZiAoTVBJREtleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0U2NoZW1hW2Nvb2tpZXMubXBpZF1ba2V5XSA9IGNvb2tpZXNba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoY29va2llc1Y0U2NoZW1hKTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRmFpbGVkIHRvIHJlc3RydWN0dXJlIHByZXZpb3VzIGNvb2tpZSBpbnRvIG1vc3QgY3VycmVudCBjb29raWUgc2NoZW1hJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBtaWdyYXRlUHJvZHVjdHNUb05hbWVTcGFjZSgpIHtcbiAgICB2YXIgbHNQcm9kVjROYW1lID0gQ29uc3RhbnRzLkRlZmF1bHRDb25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNDtcbiAgICB2YXIgcHJvZHVjdHMgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShDb25zdGFudHMuRGVmYXVsdENvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KTtcbiAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShNUC5wcm9kU3RvcmFnZU5hbWUsIHByb2R1Y3RzKTtcbiAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShsc1Byb2RWNE5hbWUpO1xuXG59XG5cbmZ1bmN0aW9uIG1pZ3JhdGVQcm9kdWN0c0Zyb21TREt2MVRvU0RLdjJDb29raWVzVjQoY29va2llcywgbXBpZCkge1xuICAgIGlmICghTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBsb2NhbFN0b3JhZ2VQcm9kdWN0cyA9IHt9O1xuICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdID0ge307XG4gICAgaWYgKGNvb2tpZXMuY3ApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdLmNwID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGNvb2tpZXMuY3ApKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0uY3AgPSBjb29raWVzLmNwO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGxvY2FsU3RvcmFnZVByb2R1Y3RzW21waWRdLmNwKSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0uY3AgPSBbXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKE1QLnByb2RTdG9yYWdlTmFtZSwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VQcm9kdWN0cykpKTtcbn1cblxuZnVuY3Rpb24gbWlncmF0ZUxvY2FsU3RvcmFnZSgpIHtcbiAgICB2YXIgY29va2llcyxcbiAgICAgICAgdjFMU05hbWUgPSBDb25maWcuTG9jYWxTdG9yYWdlTmFtZSxcbiAgICAgICAgdjNMU05hbWUgPSBDb25maWcuTG9jYWxTdG9yYWdlTmFtZVYzLFxuICAgICAgICB2NExTTmFtZSA9IENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQsXG4gICAgICAgIGN1cnJlbnRWZXJzaW9uTFNEYXRhID0gd2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKE1QLnN0b3JhZ2VOYW1lKSxcbiAgICAgICAgdjRMU0RhdGEsXG4gICAgICAgIHYxTFNEYXRhLFxuICAgICAgICB2M0xTRGF0YSxcbiAgICAgICAgdjNMU0RhdGFTdHJpbmdDb3B5O1xuXG4gICAgaWYgKGN1cnJlbnRWZXJzaW9uTFNEYXRhKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2NExTRGF0YSA9IHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSh2NExTTmFtZSk7XG4gICAgaWYgKHY0TFNEYXRhKSB7XG4gICAgICAgIGZpbmlzaExTTWlncmF0aW9uKHY0TFNEYXRhLCB2NExTTmFtZSk7XG4gICAgICAgIG1pZ3JhdGVQcm9kdWN0c1RvTmFtZVNwYWNlKCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2M0xTRGF0YSA9IHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSh2M0xTTmFtZSk7XG4gICAgaWYgKHYzTFNEYXRhKSB7XG4gICAgICAgIE1QLm1pZ3JhdGluZ1RvSURTeW5jQ29va2llcyA9IHRydWU7XG4gICAgICAgIHYzTFNEYXRhU3RyaW5nQ29weSA9IHYzTFNEYXRhLnNsaWNlKCk7XG4gICAgICAgIHYzTFNEYXRhID0gSlNPTi5wYXJzZShQZXJzaXN0ZW5jZS5yZXBsYWNlUGlwZXNXaXRoQ29tbWFzKFBlcnNpc3RlbmNlLnJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXModjNMU0RhdGEpKSk7XG4gICAgICAgIC8vIGxvY2FsU3RvcmFnZSBtYXkgY29udGFpbiBvbmx5IHByb2R1Y3RzLCBvciB0aGUgZnVsbCBwZXJzaXN0ZW5jZVxuICAgICAgICAvLyB3aGVuIHRoZXJlIGlzIGFuIE1QSUQgb24gdGhlIGNvb2tpZSwgaXQgaXMgdGhlIGZ1bGwgcGVyc2lzdGVuY2VcbiAgICAgICAgaWYgKHYzTFNEYXRhLm1waWQpIHtcbiAgICAgICAgICAgIHYzTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0KHYzTFNEYXRhU3RyaW5nQ29weSkpO1xuICAgICAgICAgICAgZmluaXNoTFNNaWdyYXRpb24oSlNPTi5zdHJpbmdpZnkodjNMU0RhdGEpLCB2M0xTTmFtZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIC8vIGlmIG5vIE1QSUQsIGl0IGlzIG9ubHkgdGhlIHByb2R1Y3RzXG4gICAgICAgIH0gZWxzZSBpZiAoKHYzTFNEYXRhLmNwIHx8IHYzTFNEYXRhLnBiKSAmJiAhdjNMU0RhdGEubXBpZCkge1xuICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpO1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICBtaWdyYXRlUHJvZHVjdHNGcm9tU0RLdjFUb1NES3YyQ29va2llc1Y0KHYzTFNEYXRhLCBjb29raWVzLmN1KTtcbiAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShDb25maWcuTG9jYWxTdG9yYWdlTmFtZVYzKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjMpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHYxTFNEYXRhID0gSlNPTi5wYXJzZShkZWNvZGVVUklDb21wb25lbnQod2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKHYxTFNOYW1lKSkpO1xuICAgIGlmICh2MUxTRGF0YSkge1xuICAgICAgICBNUC5taWdyYXRpbmdUb0lEU3luY0Nvb2tpZXMgPSB0cnVlO1xuICAgICAgICAvLyBTREt2MlxuICAgICAgICBpZiAodjFMU0RhdGEuZ2xvYmFsU2V0dGluZ3MgfHwgdjFMU0RhdGEuY3VycmVudFVzZXJNUElEKSB7XG4gICAgICAgICAgICB2MUxTRGF0YSA9IEpTT04ucGFyc2UoY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQoSlNPTi5zdHJpbmdpZnkodjFMU0RhdGEpKSk7XG4gICAgICAgICAgICAvLyBTREt2MVxuICAgICAgICAgICAgLy8gb25seSBwcm9kdWN0cywgbm90IGZ1bGwgcGVyc2lzdGVuY2VcbiAgICAgICAgfSBlbHNlIGlmICgodjFMU0RhdGEuY3AgfHwgdjFMU0RhdGEucGIpICYmICF2MUxTRGF0YS5tcGlkKSB7XG4gICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCk7XG4gICAgICAgICAgICBpZiAoY29va2llcykge1xuICAgICAgICAgICAgICAgIG1pZ3JhdGVQcm9kdWN0c0Zyb21TREt2MVRvU0RLdjJDb29raWVzVjQodjFMU0RhdGEsIGNvb2tpZXMuY3UpO1xuICAgICAgICAgICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSh2MUxTTmFtZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0odjFMU05hbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHYxTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjFDb29raWVzVjFUb1NES3YyQ29va2llc1Y0KEpTT04uc3RyaW5naWZ5KHYxTFNEYXRhKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QodjFMU0RhdGEpICYmIE9iamVjdC5rZXlzKHYxTFNEYXRhKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHYxTFNEYXRhID0gUGVyc2lzdGVuY2UuZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeSh2MUxTRGF0YSkpO1xuICAgICAgICAgICAgZmluaXNoTFNNaWdyYXRpb24odjFMU0RhdGEsIHYxTFNOYW1lKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbmlzaExTTWlncmF0aW9uKGRhdGEsIGxzTmFtZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChNUC5zdG9yYWdlTmFtZSksIGRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciB3aXRoIHNldHRpbmcgbG9jYWxTdG9yYWdlIGl0ZW0uJyk7XG4gICAgICAgIH1cbiAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKGVuY29kZVVSSUNvbXBvbmVudChsc05hbWUpKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRVSUZyb21BcnJheVRvT2JqZWN0KGNvb2tpZSkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmIChjb29raWUgJiYgSGVscGVycy5pc09iamVjdChjb29raWUpKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBtcGlkIGluIGNvb2tpZSkge1xuICAgICAgICAgICAgICAgIGlmIChjb29raWUuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llW21waWRdLnVpICYmIEFycmF5LmlzQXJyYXkoY29va2llW21waWRdLnVpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZVttcGlkXS51aSA9IGNvb2tpZVttcGlkXS51aS5yZWR1Y2UoZnVuY3Rpb24oYWNjdW0sIGlkZW50aXR5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZGVudGl0eS5UeXBlICYmIEhlbHBlcnMuVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKGlkZW50aXR5LklkZW50aXR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjdW1baWRlbnRpdHkuVHlwZV0gPSBpZGVudGl0eS5JZGVudGl0eTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYWNjdW07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwge30pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNvb2tpZTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQW4gZXJyb3Igb2N1cnJlZCB3aGVuIGNvbnZlcnRpbmcgdGhlIHVzZXIgaWRlbnRpdGllcyBhcnJheSB0byBhbiBvYmplY3QnLCBlKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIG1pZ3JhdGU6IG1pZ3JhdGUsXG4gICAgY29udmVydFVJRnJvbUFycmF5VG9PYmplY3Q6IGNvbnZlcnRVSUZyb21BcnJheVRvT2JqZWN0LFxuICAgIGNvbnZlcnRTREt2MUNvb2tpZXNWMVRvU0RLdjJDb29raWVzVjQ6IGNvbnZlcnRTREt2MUNvb2tpZXNWMVRvU0RLdjJDb29raWVzVjQsXG4gICAgY29udmVydFNES3YxQ29va2llc1YyVG9TREt2MkNvb2tpZXNWNDogY29udmVydFNES3YxQ29va2llc1YyVG9TREt2MkNvb2tpZXNWNCxcbiAgICBjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0OiBjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0LFxuICAgIGNvbnZlcnRTREt2MkNvb2tpZXNWMVRvU0RLdjJEZWNvZGVkQ29va2llc1Y0OiBjb252ZXJ0U0RLdjJDb29raWVzVjFUb1NES3YyRGVjb2RlZENvb2tpZXNWNFxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGlzRW5hYmxlZDogdHJ1ZSxcbiAgICBzZXNzaW9uQXR0cmlidXRlczoge30sXG4gICAgY3VycmVudFNlc3Npb25NUElEczogW10sXG4gICAgdXNlckF0dHJpYnV0ZXM6IHt9LFxuICAgIHVzZXJJZGVudGl0aWVzOiB7fSxcbiAgICBjb25zZW50U3RhdGU6IG51bGwsXG4gICAgZm9yd2FyZGVyQ29uc3RydWN0b3JzOiBbXSxcbiAgICBhY3RpdmVGb3J3YXJkZXJzOiBbXSxcbiAgICBjb25maWd1cmVkRm9yd2FyZGVyczogW10sXG4gICAgc2Vzc2lvbklkOiBudWxsLFxuICAgIGlzRmlyc3RSdW46IG51bGwsXG4gICAgY2xpZW50SWQ6IG51bGwsXG4gICAgZGV2aWNlSWQ6IG51bGwsXG4gICAgbXBpZDogbnVsbCxcbiAgICBkZXZUb2tlbjogbnVsbCxcbiAgICBtaWdyYXRpb25EYXRhOiB7fSxcbiAgICBwaXhlbENvbmZpZ3VyYXRpb25zOiBbXSxcbiAgICBzZXJ2ZXJTZXR0aW5nczoge30sXG4gICAgZGF0ZUxhc3RFdmVudFNlbnQ6IG51bGwsXG4gICAgc2Vzc2lvblN0YXJ0RGF0ZTogbnVsbCxcbiAgICBjb29raWVTeW5jRGF0ZXM6IHt9LFxuICAgIGN1cnJlbnRQb3NpdGlvbjogbnVsbCxcbiAgICBpc1RyYWNraW5nOiBmYWxzZSxcbiAgICB3YXRjaFBvc2l0aW9uSWQ6IG51bGwsXG4gICAgcmVhZHlRdWV1ZTogW10sXG4gICAgaXNJbml0aWFsaXplZDogZmFsc2UsXG4gICAgY2FydFByb2R1Y3RzOiBbXSxcbiAgICBldmVudFF1ZXVlOiBbXSxcbiAgICBjdXJyZW5jeUNvZGU6IG51bGwsXG4gICAgYXBwVmVyc2lvbjogbnVsbCxcbiAgICBhcHBOYW1lOiBudWxsLFxuICAgIGN1c3RvbUZsYWdzOiBudWxsLFxuICAgIGdsb2JhbFRpbWVyOiBudWxsLFxuICAgIGNvbnRleHQ6ICcnLFxuICAgIGlkZW50aXR5Q2FsbEluRmxpZ2h0OiBmYWxzZSxcbiAgICBpbml0aWFsSWRlbnRpZnlSZXF1ZXN0OiBudWxsLFxuICAgIGxvZ0xldmVsOiBudWxsLFxuICAgIENvbmZpZzoge30sXG4gICAgbWlncmF0aW5nVG9JRFN5bmNDb29raWVzOiBmYWxzZSxcbiAgICBub25DdXJyZW50VXNlck1QSURzOiB7fSxcbiAgICBpZGVudGlmeUNhbGxlZDogZmFsc2UsXG4gICAgaXNMb2dnZWRJbjogZmFsc2UsXG4gICAgaW50ZWdyYXRpb25BdHRyaWJ1dGVzOiB7fSxcbiAgICBpbnRlZ3JhdGlvbkRlbGF5czoge30sXG4gICAgcmVxdWlyZURlbGF5OiB0cnVlLFxuICAgIGZlYXR1cmVGbGFnczoge1xuICAgICAgICBiYXRjaGluZzogZmFsc2VcbiAgICB9LFxuICAgIGlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlOiBudWxsLFxuICAgIHN0b3JhZ2VOYW1lOiBudWxsLFxuICAgIHByb2RTdG9yYWdlTmFtZTogbnVsbFxufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgTWVzc2FnZXMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLk1lc3NhZ2VzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpO1xuXG52YXIgYW5kcm9pZEJyaWRnZU5hbWVCYXNlID0gJ21QYXJ0aWNsZUFuZHJvaWQnO1xudmFyIGlvc0JyaWRnZU5hbWVCYXNlID0gJ21QYXJ0aWNsZSc7XG5cbmZ1bmN0aW9uIGlzQnJpZGdlVjJBdmFpbGFibGUoYnJpZGdlTmFtZSkge1xuICAgIGlmICghYnJpZGdlTmFtZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHZhciBhbmRyb2lkQnJpZGdlTmFtZSA9IGFuZHJvaWRCcmlkZ2VOYW1lQmFzZSArICdfJyArIGJyaWRnZU5hbWUgKyAnX3YyJztcbiAgICB2YXIgaW9zQnJpZGdlTmFtZSA9IGlvc0JyaWRnZU5hbWVCYXNlICsgJ18nICsgYnJpZGdlTmFtZSArICdfdjInO1xuXG4gICAgLy8gaU9TIHYyIGJyaWRnZVxuICAgIGlmICh3aW5kb3cud2Via2l0ICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzLmhhc093blByb3BlcnR5KGlvc0JyaWRnZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICAvLyBvdGhlciBpT1MgdjIgYnJpZGdlXG4gICAgaWYgKHdpbmRvdy5tUGFydGljbGUudWl3ZWJ2aWV3QnJpZGdlTmFtZSA9PT0gaW9zQnJpZGdlTmFtZSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gYW5kcm9pZFxuICAgIGlmICh3aW5kb3cuaGFzT3duUHJvcGVydHkoYW5kcm9pZEJyaWRnZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGlzV2Vidmlld0VuYWJsZWQocmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZSwgbWluV2Vidmlld0JyaWRnZVZlcnNpb24pIHtcbiAgICBNUC5icmlkZ2VWMkF2YWlsYWJsZSA9IGlzQnJpZGdlVjJBdmFpbGFibGUocmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZSk7XG4gICAgTVAuYnJpZGdlVjFBdmFpbGFibGUgPSBpc0JyaWRnZVYxQXZhaWxhYmxlKCk7XG5cbiAgICBpZiAobWluV2Vidmlld0JyaWRnZVZlcnNpb24gPT09IDIpIHtcbiAgICAgICAgcmV0dXJuIE1QLmJyaWRnZVYyQXZhaWxhYmxlO1xuICAgIH1cblxuICAgIC8vIGlPUyBCcmlkZ2VWMSBjYW4gYmUgYXZhaWxhYmxlIHZpYSBtUGFydGljbGUuaXNJT1MsIGJ1dCByZXR1cm4gZmFsc2UgaWYgdWl3ZWJ2aWV3QnJpZGdlTmFtZSBkb2Vzbid0IG1hdGNoIHJlcXVpcmVkV2Vidmlld0JyaWRnZU5hbWVcbiAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS51aXdlYnZpZXdCcmlkZ2VOYW1lICYmIHdpbmRvdy5tUGFydGljbGUudWl3ZWJ2aWV3QnJpZGdlTmFtZSAhPT0gKGlvc0JyaWRnZU5hbWVCYXNlICsgJ18nICsgcmVxdWlyZWRXZWJ2aWV3QnJpZGdlTmFtZSArICdfdjInKSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYgKG1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uIDwgMikge1xuICAgICAgICAvLyBpb3NcbiAgICAgICAgcmV0dXJuIE1QLmJyaWRnZVYyQXZhaWxhYmxlIHx8IE1QLmJyaWRnZVYxQXZhaWxhYmxlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gaXNCcmlkZ2VWMUF2YWlsYWJsZSgpIHtcbiAgICBpZiAobVBhcnRpY2xlLnVzZU5hdGl2ZVNkayB8fCB3aW5kb3cubVBhcnRpY2xlQW5kcm9pZFxuICAgICAgICB8fCB3aW5kb3cubVBhcnRpY2xlLmlzSU9TKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc2VuZFRvTmF0aXZlKHBhdGgsIHZhbHVlKSB7XG4gICAgaWYgKE1QLmJyaWRnZVYyQXZhaWxhYmxlICYmIG1QYXJ0aWNsZS5taW5XZWJ2aWV3QnJpZGdlVmVyc2lvbiA9PT0gMikge1xuICAgICAgICBzZW5kVmlhQnJpZGdlVjIocGF0aCwgdmFsdWUsIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTVAuYnJpZGdlVjJBdmFpbGFibGUgJiYgbVBhcnRpY2xlLm1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uIDwgMikge1xuICAgICAgICBzZW5kVmlhQnJpZGdlVjIocGF0aCwgdmFsdWUsIG1QYXJ0aWNsZS5yZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTVAuYnJpZGdlVjFBdmFpbGFibGUgJiYgbVBhcnRpY2xlLm1pbldlYnZpZXdCcmlkZ2VWZXJzaW9uIDwgMikge1xuICAgICAgICBzZW5kVmlhQnJpZGdlVjEocGF0aCwgdmFsdWUpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZW5kVmlhQnJpZGdlVjEocGF0aCwgdmFsdWUpIHtcbiAgICBpZiAod2luZG93Lm1QYXJ0aWNsZUFuZHJvaWQgJiYgd2luZG93Lm1QYXJ0aWNsZUFuZHJvaWQuaGFzT3duUHJvcGVydHkocGF0aCkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRBbmRyb2lkICsgcGF0aCk7XG4gICAgICAgIHdpbmRvdy5tUGFydGljbGVBbmRyb2lkW3BhdGhdKHZhbHVlKTtcbiAgICB9XG4gICAgZWxzZSBpZiAod2luZG93Lm1QYXJ0aWNsZS5pc0lPUykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZElPUyArIHBhdGgpO1xuICAgICAgICBzZW5kVmlhSWZyYW1lVG9JT1MocGF0aCwgdmFsdWUpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VuZFZpYUlmcmFtZVRvSU9TKHBhdGgsIHZhbHVlKSB7XG4gICAgdmFyIGlmcmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ0lGUkFNRScpO1xuICAgIGlmcmFtZS5zZXRBdHRyaWJ1dGUoJ3NyYycsICdtcC1zZGs6Ly8nICsgcGF0aCArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpO1xuICAgIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5hcHBlbmRDaGlsZChpZnJhbWUpO1xuICAgIGlmcmFtZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGlmcmFtZSk7XG4gICAgaWZyYW1lID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gc2VuZFZpYUJyaWRnZVYyKHBhdGgsIHZhbHVlLCByZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lKSB7XG4gICAgaWYgKCFyZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgYW5kcm9pZEJyaWRnZU5hbWUgPSBhbmRyb2lkQnJpZGdlTmFtZUJhc2UgKyAnXycgKyByZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lICsgJ192MicsXG4gICAgICAgIGFuZHJvaWRCcmlkZ2UgPSB3aW5kb3dbYW5kcm9pZEJyaWRnZU5hbWVdLFxuICAgICAgICBpb3NCcmlkZ2VOYW1lID0gaW9zQnJpZGdlTmFtZUJhc2UgKyAnXycgKyByZXF1aXJlZFdlYnZpZXdCcmlkZ2VOYW1lICsgJ192MicsXG4gICAgICAgIGlPU0JyaWRnZU1lc3NhZ2VIYW5kbGVyLFxuICAgICAgICBpT1NCcmlkZ2VOb25NZXNzYWdlSGFuZGxlcjtcblxuICAgIGlmICh3aW5kb3cud2Via2l0ICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzICYmIHdpbmRvdy53ZWJraXQubWVzc2FnZUhhbmRsZXJzW2lvc0JyaWRnZU5hbWVdKSB7XG4gICAgICAgIGlPU0JyaWRnZU1lc3NhZ2VIYW5kbGVyID0gd2luZG93LndlYmtpdC5tZXNzYWdlSGFuZGxlcnNbaW9zQnJpZGdlTmFtZV07XG4gICAgfVxuXG4gICAgaWYgKHdpbmRvdy5tUGFydGljbGUudWl3ZWJ2aWV3QnJpZGdlTmFtZSA9PT0gaW9zQnJpZGdlTmFtZSkge1xuICAgICAgICBpT1NCcmlkZ2VOb25NZXNzYWdlSGFuZGxlciA9IHdpbmRvdy5tUGFydGljbGVbaW9zQnJpZGdlTmFtZV07XG4gICAgfVxuXG4gICAgaWYgKGFuZHJvaWRCcmlkZ2UgJiYgYW5kcm9pZEJyaWRnZS5oYXNPd25Qcm9wZXJ0eShwYXRoKSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZEFuZHJvaWQgKyBwYXRoKTtcbiAgICAgICAgYW5kcm9pZEJyaWRnZVtwYXRoXSh2YWx1ZSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9IGVsc2UgaWYgKGlPU0JyaWRnZU1lc3NhZ2VIYW5kbGVyKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TZW5kSU9TICsgcGF0aCk7XG4gICAgICAgIGlPU0JyaWRnZU1lc3NhZ2VIYW5kbGVyLnBvc3RNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHtwYXRoOnBhdGgsIHZhbHVlOiB2YWx1ZSA/IEpTT04ucGFyc2UodmFsdWUpIDogbnVsbH0pKTtcbiAgICB9IGVsc2UgaWYgKGlPU0JyaWRnZU5vbk1lc3NhZ2VIYW5kbGVyKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TZW5kSU9TICsgcGF0aCk7XG4gICAgICAgIHNlbmRWaWFJZnJhbWVUb0lPUyhwYXRoLCB2YWx1ZSk7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBpc1dlYnZpZXdFbmFibGVkOiBpc1dlYnZpZXdFbmFibGVkLFxuICAgIGlzQnJpZGdlVjJBdmFpbGFibGU6aXNCcmlkZ2VWMkF2YWlsYWJsZSxcbiAgICBzZW5kVG9OYXRpdmU6IHNlbmRUb05hdGl2ZSxcbiAgICBzZW5kVmlhQnJpZGdlVjE6IHNlbmRWaWFCcmlkZ2VWMSxcbiAgICBzZW5kVmlhQnJpZGdlVjI6IHNlbmRWaWFCcmlkZ2VWMlxufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBCYXNlNjQgPSByZXF1aXJlKCcuL3BvbHlmaWxsJykuQmFzZTY0LFxuICAgIE1lc3NhZ2VzID0gQ29uc3RhbnRzLk1lc3NhZ2VzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIEJhc2U2NENvb2tpZUtleXMgPSBDb25zdGFudHMuQmFzZTY0Q29va2llS2V5cyxcbiAgICBTREt2Mk5vbk1QSURDb29raWVLZXlzID0gQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMsXG4gICAgQ29uc2VudCA9IHJlcXVpcmUoJy4vY29uc2VudCcpO1xuXG5mdW5jdGlvbiB1c2VMb2NhbFN0b3JhZ2UoKSB7XG4gICAgcmV0dXJuICghbVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UgJiYgTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpO1xufVxuXG5mdW5jdGlvbiBpbml0aWFsaXplU3RvcmFnZSgpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgc3RvcmFnZSxcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSB0aGlzLmdldExvY2FsU3RvcmFnZSgpLFxuICAgICAgICAgICAgY29va2llcyA9IHRoaXMuZ2V0Q29va2llKCksXG4gICAgICAgICAgICBhbGxEYXRhO1xuXG4gICAgICAgIC8vIERldGVybWluZSBpZiB0aGVyZSBpcyBhbnkgZGF0YSBpbiBjb29raWVzIG9yIGxvY2FsU3RvcmFnZSB0byBmaWd1cmUgb3V0IGlmIGl0IGlzIHRoZSBmaXJzdCB0aW1lIHRoZSBicm93c2VyIGlzIGxvYWRpbmcgbVBhcnRpY2xlXG4gICAgICAgIGlmICghbG9jYWxTdG9yYWdlRGF0YSAmJiAhY29va2llcykge1xuICAgICAgICAgICAgTVAuaXNGaXJzdFJ1biA9IHRydWU7XG4gICAgICAgICAgICBNUC5tcGlkID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIE1QLmlzRmlyc3RSdW4gPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS51c2VDb29raWVTdG9yYWdlID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgc3RvcmFnZSA9IHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG4gICAgICAgICAgICBpZiAobVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UpIHtcbiAgICAgICAgICAgICAgICAvLyBGb3IgbWlncmF0aW5nIGZyb20gbG9jYWxTdG9yYWdlIHRvIGNvb2tpZXMgLS0gSWYgYW4gaW5zdGFuY2Ugc3dpdGNoZXMgZnJvbSBsb2NhbFN0b3JhZ2UgdG8gY29va2llcywgdGhlblxuICAgICAgICAgICAgICAgIC8vIG5vIG1QYXJ0aWNsZSBjb29raWUgZXhpc3RzIHlldCBhbmQgdGhlcmUgaXMgbG9jYWxTdG9yYWdlLiBHZXQgdGhlIGxvY2FsU3RvcmFnZSwgc2V0IHRoZW0gdG8gY29va2llcywgdGhlbiBkZWxldGUgdGhlIGxvY2FsU3RvcmFnZSBpdGVtLlxuICAgICAgICAgICAgICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gSGVscGVycy5leHRlbmQoZmFsc2UsIGxvY2FsU3RvcmFnZURhdGEsIGNvb2tpZXMpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IGxvY2FsU3RvcmFnZURhdGE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3RvcmFnZS5yZW1vdmVJdGVtKE1QLnN0b3JhZ2VOYW1lKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IGNvb2tpZXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkoYWxsRGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBGb3IgbWlncmF0aW5nIGZyb20gY29va2llIHRvIGxvY2FsU3RvcmFnZSAtLSBJZiBhbiBpbnN0YW5jZSBpcyBuZXdseSBzd2l0Y2hpbmcgZnJvbSBjb29raWVzIHRvIGxvY2FsU3RvcmFnZSwgdGhlblxuICAgICAgICAgICAgICAgIC8vIG5vIG1QYXJ0aWNsZSBsb2NhbFN0b3JhZ2UgZXhpc3RzIHlldCBhbmQgdGhlcmUgYXJlIGNvb2tpZXMuIEdldCB0aGUgY29va2llcywgc2V0IHRoZW0gdG8gbG9jYWxTdG9yYWdlLCB0aGVuIGRlbGV0ZSB0aGUgY29va2llcy5cbiAgICAgICAgICAgICAgICBpZiAoY29va2llcykge1xuICAgICAgICAgICAgICAgICAgICBpZiAobG9jYWxTdG9yYWdlRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCBsb2NhbFN0b3JhZ2VEYXRhLCBjb29raWVzKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsbERhdGEgPSBjb29raWVzO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkoYWxsRGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXhwaXJlQ29va2llcyhNUC5zdG9yYWdlTmFtZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShsb2NhbFN0b3JhZ2VEYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgICAgIHZhciBlbmNvZGVkUHJvZHVjdHMgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShNUC5wcm9kU3RvcmFnZU5hbWUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGVuY29kZWRQcm9kdWN0cykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVjb2RlZFByb2R1Y3RzID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGVuY29kZWRQcm9kdWN0cykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBzdG9yZVByb2R1Y3RzSW5NZW1vcnkoZGVjb2RlZFByb2R1Y3RzLCBNUC5tcGlkKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmIChNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKE1QLnByb2RTdG9yYWdlTmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBNUC5jYXJ0UHJvZHVjdHMgPSBbXTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIGxvYWRpbmcgcHJvZHVjdHMgaW4gaW5pdGlhbGl6YXRpb246ICcgKyBlKTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgZm9yICh2YXIga2V5IGluIGFsbERhdGEpIHtcbiAgICAgICAgICAgIGlmIChhbGxEYXRhLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICBNUC5ub25DdXJyZW50VXNlck1QSURzW2tleV0gPSBhbGxEYXRhW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy51cGRhdGUoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmICh1c2VMb2NhbFN0b3JhZ2UoKSAmJiBNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oTVAuc3RvcmFnZU5hbWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXhwaXJlQ29va2llcyhNUC5zdG9yYWdlTmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgaW5pdGlhbGl6aW5nIHN0b3JhZ2U6ICcgKyBlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZSgpIHtcbiAgICBpZiAoIU1QLndlYnZpZXdCcmlkZ2VFbmFibGVkKSB7XG4gICAgICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICAgICAgdGhpcy5zZXRDb29raWUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdG9yZVByb2R1Y3RzSW5NZW1vcnkocHJvZHVjdHMsIG1waWQpIHtcbiAgICBpZiAocHJvZHVjdHMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IHByb2R1Y3RzW21waWRdICYmIHByb2R1Y3RzW21waWRdLmNwID8gcHJvZHVjdHNbbXBpZF0uY3AgOiBbXTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQ29va2llUGFyc2VFcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN0b3JlRGF0YUluTWVtb3J5KG9iaiwgY3VycmVudE1QSUQpIHtcbiAgICB0cnkge1xuICAgICAgICBpZiAoIW9iaikge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZU5vdEZvdW5kKTtcbiAgICAgICAgICAgIE1QLmNsaWVudElkID0gTVAuY2xpZW50SWQgfHwgSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgICAgICAgICBNUC5kZXZpY2VJZCA9IE1QLmRldmljZUlkIHx8IEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0ge307XG4gICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBTZXQgTVBJRCBmaXJzdCwgdGhlbiBjaGFuZ2Ugb2JqZWN0IHRvIG1hdGNoIE1QSUQgZGF0YVxuICAgICAgICAgICAgaWYgKGN1cnJlbnRNUElEKSB7XG4gICAgICAgICAgICAgICAgTVAubXBpZCA9IGN1cnJlbnRNUElEO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBNUC5tcGlkID0gb2JqLmN1IHx8IDA7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9iai5ncyA9IG9iai5ncyB8fCB7fTtcblxuICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gb2JqLmdzLnNpZCB8fCBNUC5zZXNzaW9uSWQ7XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSAodHlwZW9mIG9iai5ncy5pZSAhPT0gJ3VuZGVmaW5lZCcpID8gb2JqLmdzLmllIDogTVAuaXNFbmFibGVkO1xuICAgICAgICAgICAgTVAuc2Vzc2lvbkF0dHJpYnV0ZXMgPSBvYmouZ3Muc2EgfHwgTVAuc2Vzc2lvbkF0dHJpYnV0ZXM7XG4gICAgICAgICAgICBNUC5zZXJ2ZXJTZXR0aW5ncyA9IG9iai5ncy5zcyB8fCBNUC5zZXJ2ZXJTZXR0aW5ncztcbiAgICAgICAgICAgIE1QLmRldlRva2VuID0gTVAuZGV2VG9rZW4gfHwgb2JqLmdzLmR0O1xuICAgICAgICAgICAgTVAuYXBwVmVyc2lvbiA9IE1QLmFwcFZlcnNpb24gfHwgb2JqLmdzLmF2O1xuICAgICAgICAgICAgTVAuY2xpZW50SWQgPSBvYmouZ3MuY2dpZCB8fCBNUC5jbGllbnRJZCB8fCBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICAgICAgICAgIE1QLmRldmljZUlkID0gb2JqLmdzLmRhcyB8fCBNUC5kZXZpY2VJZCB8fCBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICAgICAgICAgIE1QLmludGVncmF0aW9uQXR0cmlidXRlcyA9IG9iai5ncy5pYSB8fCB7fTtcbiAgICAgICAgICAgIE1QLmNvbnRleHQgPSBvYmouZ3MuYyB8fCBNUC5jb250ZXh0O1xuICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcyA9IG9iai5ncy5jc20gfHwgTVAuY3VycmVudFNlc3Npb25NUElEcztcblxuICAgICAgICAgICAgTVAuaXNMb2dnZWRJbiA9IG9iai5sID09PSB0cnVlO1xuXG4gICAgICAgICAgICBpZiAob2JqLmdzLmxlcykge1xuICAgICAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbmV3IERhdGUob2JqLmdzLmxlcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChvYmouZ3Muc3NkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvblN0YXJ0RGF0ZSA9IG5ldyBEYXRlKG9iai5ncy5zc2QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGN1cnJlbnRNUElEKSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW2N1cnJlbnRNUElEXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW29iai5jdV07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE1QLnVzZXJBdHRyaWJ1dGVzID0gb2JqLnVhIHx8IE1QLnVzZXJBdHRyaWJ1dGVzO1xuICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBvYmoudWkgfHwgTVAudXNlcklkZW50aXRpZXM7XG4gICAgICAgICAgICBNUC5jb25zZW50U3RhdGUgPSBvYmouY29uID8gQ29uc2VudC5TZXJpYWxpemF0aW9uLmZyb21NaW5pZmllZEpzb25PYmplY3Qob2JqLmNvbikgOiBudWxsO1xuXG4gICAgICAgICAgICBpZiAob2JqLmNzZCkge1xuICAgICAgICAgICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlcyA9IG9iai5jc2Q7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkNvb2tpZVBhcnNlRXJyb3IpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KHN0b3JhZ2UpIHtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgaWYgKG1QYXJ0aWNsZS5fZm9yY2VOb0xvY2FsU3RvcmFnZSkge1xuICAgICAgICBzdG9yYWdlID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIHN0b3JhZ2Uuc2V0SXRlbSgnbXBhcnRpY2xlJywgJ3Rlc3QnKTtcbiAgICAgICAgcmVzdWx0ID0gc3RvcmFnZS5nZXRJdGVtKCdtcGFydGljbGUnKSA9PT0gJ3Rlc3QnO1xuICAgICAgICBzdG9yYWdlLnJlbW92ZUl0ZW0oJ21wYXJ0aWNsZScpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgJiYgc3RvcmFnZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydEluTWVtb3J5RGF0YUZvckNvb2tpZXMoKSB7XG4gICAgdmFyIG1waWREYXRhID0ge1xuICAgICAgICB1YTogTVAudXNlckF0dHJpYnV0ZXMsXG4gICAgICAgIHVpOiBNUC51c2VySWRlbnRpdGllcyxcbiAgICAgICAgY3NkOiBNUC5jb29raWVTeW5jRGF0ZXMsXG4gICAgICAgIGNvbjogTVAuY29uc2VudFN0YXRlID8gQ29uc2VudC5TZXJpYWxpemF0aW9uLnRvTWluaWZpZWRKc29uT2JqZWN0KE1QLmNvbnNlbnRTdGF0ZSkgOiBudWxsXG4gICAgfTtcblxuICAgIHJldHVybiBtcGlkRGF0YTtcbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RzRm9yTG9jYWxTdG9yYWdlKCkge1xuICAgIHZhciBpbk1lbW9yeURhdGFGb3JMb2NhbFN0b3JhZ2UgPSB7XG4gICAgICAgIGNwOiBNUC5jYXJ0UHJvZHVjdHMgPyBNUC5jYXJ0UHJvZHVjdHMubGVuZ3RoIDw9IG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyA/IE1QLmNhcnRQcm9kdWN0cyA6IE1QLmNhcnRQcm9kdWN0cy5zbGljZSgwLCBtUGFydGljbGUubWF4UHJvZHVjdHMpIDogW11cbiAgICB9O1xuXG4gICAgcmV0dXJuIGluTWVtb3J5RGF0YUZvckxvY2FsU3RvcmFnZTtcbn1cblxuZnVuY3Rpb24gZ2V0VXNlclByb2R1Y3RzRnJvbUxTKG1waWQpIHtcbiAgICBpZiAoIU1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICB2YXIgZGVjb2RlZFByb2R1Y3RzLFxuICAgICAgICB1c2VyUHJvZHVjdHMsXG4gICAgICAgIHBhcnNlZFByb2R1Y3RzLFxuICAgICAgICBlbmNvZGVkUHJvZHVjdHMgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShNUC5wcm9kU3RvcmFnZU5hbWUpO1xuICAgIGlmIChlbmNvZGVkUHJvZHVjdHMpIHtcbiAgICAgICAgZGVjb2RlZFByb2R1Y3RzID0gQmFzZTY0LmRlY29kZShlbmNvZGVkUHJvZHVjdHMpO1xuICAgIH1cbiAgICAvLyBpZiB0aGVyZSBpcyBhbiBNUElELCB3ZSBhcmUgcmV0cmlldmluZyB0aGUgdXNlcidzIHByb2R1Y3RzLCB3aGljaCBpcyBhbiBhcnJheVxuICAgIGlmIChtcGlkKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAoZGVjb2RlZFByb2R1Y3RzKSB7XG4gICAgICAgICAgICAgICAgcGFyc2VkUHJvZHVjdHMgPSBKU09OLnBhcnNlKGRlY29kZWRQcm9kdWN0cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGVjb2RlZFByb2R1Y3RzICYmIHBhcnNlZFByb2R1Y3RzW21waWRdICYmIHBhcnNlZFByb2R1Y3RzW21waWRdLmNwICYmIEFycmF5LmlzQXJyYXkocGFyc2VkUHJvZHVjdHNbbXBpZF0uY3ApKSB7XG4gICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzID0gcGFyc2VkUHJvZHVjdHNbbXBpZF0uY3A7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHVzZXJQcm9kdWN0cztcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0QWxsVXNlclByb2R1Y3RzRnJvbUxTKCkge1xuICAgIHZhciBkZWNvZGVkUHJvZHVjdHMsXG4gICAgICAgIGVuY29kZWRQcm9kdWN0cyA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKE1QLnByb2RTdG9yYWdlTmFtZSksXG4gICAgICAgIHBhcnNlZERlY29kZWRQcm9kdWN0cztcbiAgICBpZiAoZW5jb2RlZFByb2R1Y3RzKSB7XG4gICAgICAgIGRlY29kZWRQcm9kdWN0cyA9IEJhc2U2NC5kZWNvZGUoZW5jb2RlZFByb2R1Y3RzKTtcbiAgICB9XG4gICAgLy8gcmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXlzIG9mIE1QSUQgYW5kIHZhbHVlcyBvZiBhcnJheSBvZiBwcm9kdWN0c1xuICAgIHRyeSB7XG4gICAgICAgIHBhcnNlZERlY29kZWRQcm9kdWN0cyA9IEpTT04ucGFyc2UoZGVjb2RlZFByb2R1Y3RzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHBhcnNlZERlY29kZWRQcm9kdWN0cyA9IHt9O1xuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWREZWNvZGVkUHJvZHVjdHM7XG59XG5cbmZ1bmN0aW9uIHNldExvY2FsU3RvcmFnZSgpIHtcbiAgICBpZiAoIU1QLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIga2V5ID0gTVAuc3RvcmFnZU5hbWUsXG4gICAgICAgIGFsbExvY2FsU3RvcmFnZVByb2R1Y3RzID0gZ2V0QWxsVXNlclByb2R1Y3RzRnJvbUxTKCksXG4gICAgICAgIGN1cnJlbnRVc2VyUHJvZHVjdHMgPSB0aGlzLmNvbnZlcnRQcm9kdWN0c0ZvckxvY2FsU3RvcmFnZSgpLFxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gdGhpcy5nZXRMb2NhbFN0b3JhZ2UoKSB8fCB7fSxcbiAgICAgICAgY3VycmVudE1QSUREYXRhO1xuXG4gICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgYWxsTG9jYWxTdG9yYWdlUHJvZHVjdHMgPSBhbGxMb2NhbFN0b3JhZ2VQcm9kdWN0cyB8fCB7fTtcbiAgICAgICAgYWxsTG9jYWxTdG9yYWdlUHJvZHVjdHNbTVAubXBpZF0gPSBjdXJyZW50VXNlclByb2R1Y3RzO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChNUC5wcm9kU3RvcmFnZU5hbWUpLCBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGFsbExvY2FsU3RvcmFnZVByb2R1Y3RzKSkpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciB3aXRoIHNldHRpbmcgcHJvZHVjdHMgb24gbG9jYWxTdG9yYWdlLicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICBjdXJyZW50TVBJRERhdGEgPSB0aGlzLmNvbnZlcnRJbk1lbW9yeURhdGFGb3JDb29raWVzKCk7XG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEuZ3MgPSBsb2NhbFN0b3JhZ2VEYXRhLmdzIHx8IHt9O1xuXG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEubCA9IE1QLmlzTG9nZ2VkSW4gPyAxIDogMDtcblxuICAgICAgICBpZiAoTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmdzLmNzbSA9IE1QLmN1cnJlbnRTZXNzaW9uTVBJRHM7XG4gICAgICAgIH1cblxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmdzLmllID0gTVAuaXNFbmFibGVkO1xuXG4gICAgICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhW01QLm1waWRdID0gY3VycmVudE1QSUREYXRhO1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlRGF0YS5jdSA9IE1QLm1waWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoT2JqZWN0LmtleXMoTVAubm9uQ3VycmVudFVzZXJNUElEcykubGVuZ3RoKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gSGVscGVycy5leHRlbmQoe30sIGxvY2FsU3RvcmFnZURhdGEsIE1QLm5vbkN1cnJlbnRVc2VyTVBJRHMpO1xuICAgICAgICAgICAgTVAubm9uQ3VycmVudFVzZXJNUElEcyA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YSA9IHRoaXMuc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXMobG9jYWxTdG9yYWdlRGF0YSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbShlbmNvZGVVUklDb21wb25lbnQoa2V5KSwgZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VEYXRhKSkpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciB3aXRoIHNldHRpbmcgbG9jYWxTdG9yYWdlIGl0ZW0uJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldEdsb2JhbFN0b3JhZ2VBdHRyaWJ1dGVzKGRhdGEpIHtcbiAgICBkYXRhLmdzLnNpZCA9IE1QLnNlc3Npb25JZDtcbiAgICBkYXRhLmdzLmllID0gTVAuaXNFbmFibGVkO1xuICAgIGRhdGEuZ3Muc2EgPSBNUC5zZXNzaW9uQXR0cmlidXRlcztcbiAgICBkYXRhLmdzLnNzID0gTVAuc2VydmVyU2V0dGluZ3M7XG4gICAgZGF0YS5ncy5kdCA9IE1QLmRldlRva2VuO1xuICAgIGRhdGEuZ3MubGVzID0gTVAuZGF0ZUxhc3RFdmVudFNlbnQgPyBNUC5kYXRlTGFzdEV2ZW50U2VudC5nZXRUaW1lKCkgOiBudWxsO1xuICAgIGRhdGEuZ3MuYXYgPSBNUC5hcHBWZXJzaW9uO1xuICAgIGRhdGEuZ3MuY2dpZCA9IE1QLmNsaWVudElkO1xuICAgIGRhdGEuZ3MuZGFzID0gTVAuZGV2aWNlSWQ7XG4gICAgZGF0YS5ncy5jID0gTVAuY29udGV4dDtcbiAgICBkYXRhLmdzLnNzZCA9IE1QLnNlc3Npb25TdGFydERhdGUgPyBNUC5zZXNzaW9uU3RhcnREYXRlLmdldFRpbWUoKSA6IG51bGw7XG4gICAgZGF0YS5ncy5pYSA9IE1QLmludGVncmF0aW9uQXR0cmlidXRlcztcblxuICAgIHJldHVybiBkYXRhO1xufVxuXG5mdW5jdGlvbiBnZXRMb2NhbFN0b3JhZ2UoKSB7XG4gICAgaWYgKCFNUC5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIga2V5ID0gTVAuc3RvcmFnZU5hbWUsXG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSBkZWNvZGVDb29raWVzKHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpKSxcbiAgICAgICAgb2JqID0ge30sXG4gICAgICAgIGo7XG4gICAgaWYgKGxvY2FsU3RvcmFnZURhdGEpIHtcbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YSA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlRGF0YSk7XG4gICAgICAgIGZvciAoaiBpbiBsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgICAgICBpZiAobG9jYWxTdG9yYWdlRGF0YS5oYXNPd25Qcm9wZXJ0eShqKSkge1xuICAgICAgICAgICAgICAgIG9ialtqXSA9IGxvY2FsU3RvcmFnZURhdGFbal07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMob2JqKS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlTG9jYWxTdG9yYWdlKGxvY2FsU3RvcmFnZU5hbWUpIHtcbiAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShsb2NhbFN0b3JhZ2VOYW1lKTtcbn1cblxuZnVuY3Rpb24gcmV0cmlldmVEZXZpY2VJZCgpIHtcbiAgICBpZiAoTVAuZGV2aWNlSWQpIHtcbiAgICAgICAgcmV0dXJuIE1QLmRldmljZUlkO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhcnNlRGV2aWNlSWQoTVAuc2VydmVyU2V0dGluZ3MpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VEZXZpY2VJZChzZXJ2ZXJTZXR0aW5ncykge1xuICAgIHRyeSB7XG4gICAgICAgIHZhciBwYXJhbXNPYmogPSB7fSxcbiAgICAgICAgICAgIHBhcnRzO1xuXG4gICAgICAgIGlmIChzZXJ2ZXJTZXR0aW5ncyAmJiBzZXJ2ZXJTZXR0aW5ncy51aWQgJiYgc2VydmVyU2V0dGluZ3MudWlkLlZhbHVlKSB7XG4gICAgICAgICAgICBzZXJ2ZXJTZXR0aW5ncy51aWQuVmFsdWUuc3BsaXQoJyYnKS5mb3JFYWNoKGZ1bmN0aW9uKHBhcmFtKSB7XG4gICAgICAgICAgICAgICAgcGFydHMgPSBwYXJhbS5zcGxpdCgnPScpO1xuICAgICAgICAgICAgICAgIHBhcmFtc09ialtwYXJ0c1swXV0gPSBwYXJ0c1sxXTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAocGFyYW1zT2JqWydnJ10pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcGFyYW1zT2JqWydnJ107XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGV4cGlyZUNvb2tpZXMoY29va2llTmFtZSkge1xuICAgIHZhciBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAgZXhwaXJlcyxcbiAgICAgICAgZG9tYWluLFxuICAgICAgICBjb29raWVEb21haW47XG5cbiAgICBjb29raWVEb21haW4gPSBnZXRDb29raWVEb21haW4oKTtcblxuICAgIGlmIChjb29raWVEb21haW4gPT09ICcnKSB7XG4gICAgICAgIGRvbWFpbiA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGRvbWFpbiA9ICc7ZG9tYWluPScgKyBjb29raWVEb21haW47XG4gICAgfVxuXG4gICAgZGF0ZS5zZXRUaW1lKGRhdGUuZ2V0VGltZSgpIC0gKDI0ICogNjAgKiA2MCAqIDEwMDApKTtcbiAgICBleHBpcmVzID0gJzsgZXhwaXJlcz0nICsgZGF0ZS50b1VUQ1N0cmluZygpO1xuICAgIGRvY3VtZW50LmNvb2tpZSA9IGNvb2tpZU5hbWUgKyAnPScgKyAnJyArIGV4cGlyZXMgKyAnOyBwYXRoPS8nICsgZG9tYWluO1xufVxuXG5mdW5jdGlvbiBnZXRDb29raWUoKSB7XG4gICAgdmFyIGNvb2tpZXMgPSB3aW5kb3cuZG9jdW1lbnQuY29va2llLnNwbGl0KCc7ICcpLFxuICAgICAgICBrZXkgPSBNUC5zdG9yYWdlTmFtZSxcbiAgICAgICAgaSxcbiAgICAgICAgbCxcbiAgICAgICAgcGFydHMsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvb2tpZSxcbiAgICAgICAgcmVzdWx0ID0ga2V5ID8gdW5kZWZpbmVkIDoge307XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llU2VhcmNoKTtcblxuICAgIGZvciAoaSA9IDAsIGwgPSBjb29raWVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcbiAgICAgICAgbmFtZSA9IEhlbHBlcnMuZGVjb2RlZChwYXJ0cy5zaGlmdCgpKTtcbiAgICAgICAgY29va2llID0gSGVscGVycy5kZWNvZGVkKHBhcnRzLmpvaW4oJz0nKSk7XG5cbiAgICAgICAgaWYgKGtleSAmJiBrZXkgPT09IG5hbWUpIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IEhlbHBlcnMuY29udmVydGVkKGNvb2tpZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICgha2V5KSB7XG4gICAgICAgICAgICByZXN1bHRbbmFtZV0gPSBIZWxwZXJzLmNvbnZlcnRlZChjb29raWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llRm91bmQpO1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShkZWNvZGVDb29raWVzKHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0Q29va2llKCkge1xuICAgIHZhciBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAga2V5ID0gTVAuc3RvcmFnZU5hbWUsXG4gICAgICAgIGN1cnJlbnRNUElERGF0YSA9IHRoaXMuY29udmVydEluTWVtb3J5RGF0YUZvckNvb2tpZXMoKSxcbiAgICAgICAgZXhwaXJlcyA9IG5ldyBEYXRlKGRhdGUuZ2V0VGltZSgpICtcbiAgICAgICAgICAgIChNUC5Db25maWcuQ29va2llRXhwaXJhdGlvbiAqIDI0ICogNjAgKiA2MCAqIDEwMDApKS50b0dNVFN0cmluZygpLFxuICAgICAgICBjb29raWVEb21haW4sXG4gICAgICAgIGRvbWFpbixcbiAgICAgICAgY29va2llcyA9IHRoaXMuZ2V0Q29va2llKCkgfHwge30sXG4gICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoO1xuXG4gICAgY29va2llRG9tYWluID0gZ2V0Q29va2llRG9tYWluKCk7XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIGNvb2tpZXMuZ3MgPSBjb29raWVzLmdzIHx8IHt9O1xuXG4gICAgaWYgKE1QLnNlc3Npb25JZCkge1xuICAgICAgICBjb29raWVzLmdzLmNzbSA9IE1QLmN1cnJlbnRTZXNzaW9uTVBJRHM7XG4gICAgfVxuXG4gICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgY29va2llc1tNUC5tcGlkXSA9IGN1cnJlbnRNUElERGF0YTtcbiAgICAgICAgY29va2llcy5jdSA9IE1QLm1waWQ7XG4gICAgfVxuXG4gICAgY29va2llcy5sID0gTVAuaXNMb2dnZWRJbiA/IDEgOiAwO1xuXG4gICAgY29va2llcyA9IHRoaXMuc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXMoY29va2llcyk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoTVAubm9uQ3VycmVudFVzZXJNUElEcykubGVuZ3RoKSB7XG4gICAgICAgIGNvb2tpZXMgPSBIZWxwZXJzLmV4dGVuZCh7fSwgY29va2llcywgTVAubm9uQ3VycmVudFVzZXJNUElEcyk7XG4gICAgICAgIE1QLm5vbkN1cnJlbnRVc2VyTVBJRHMgPSB7fTtcbiAgICB9XG5cbiAgICBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aCA9IHJlZHVjZUFuZEVuY29kZUNvb2tpZXMoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcblxuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Db29raWVTZXQpO1xuXG4gICAgd2luZG93LmRvY3VtZW50LmNvb2tpZSA9XG4gICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nICsgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG59XG5cbi8qICBUaGlzIGZ1bmN0aW9uIGRldGVybWluZXMgaWYgYSBjb29raWUgaXMgZ3JlYXRlciB0aGFuIHRoZSBjb25maWd1cmVkIG1heENvb2tpZVNpemUuXG4gICAgICAgIC0gSWYgaXQgaXMsIHdlIHJlbW92ZSBhbiBNUElEIGFuZCBpdHMgYXNzb2NpYXRlZCBVSS9VQS9DU0QgZnJvbSB0aGUgY29va2llLlxuICAgICAgICAtIE9uY2UgcmVtb3ZlZCwgY2hlY2sgc2l6ZSwgYW5kIHJlcGVhdC5cbiAgICAgICAgLSBOZXZlciByZW1vdmUgdGhlIGN1cnJlbnRVc2VyJ3MgTVBJRCBmcm9tIHRoZSBjb29raWUuXG5cbiAgICBNUElEIHJlbW92YWwgcHJpb3JpdHk6XG4gICAgMS4gSWYgdGhlcmUgYXJlIG5vIGN1cnJlbnRTZXNzaW9uTVBJRHMsIHJlbW92ZSBhIHJhbmRvbSBNUElEIGZyb20gdGhlIHRoZSBjb29raWUuXG4gICAgMi4gSWYgdGhlcmUgYXJlIGN1cnJlbnRTZXNzaW9uTVBJRHM6XG4gICAgICAgIGEuIFJlbW92ZSBhdCByYW5kb20gTVBJRHMgb24gdGhlIGNvb2tpZSB0aGF0IGFyZSBub3QgcGFydCBvZiB0aGUgY3VycmVudFNlc3Npb25NUElEc1xuICAgICAgICBiLiBUaGVuIHJlbW92ZSBNUElEcyBiYXNlZCBvbiBvcmRlciBpbiBjdXJyZW50U2Vzc2lvbk1QSURzIGFycmF5LCB3aGljaFxuICAgICAgICBzdG9yZXMgTVBJRHMgYmFzZWQgb24gZWFybGllc3QgbG9naW4uXG4qL1xuZnVuY3Rpb24gcmVkdWNlQW5kRW5jb2RlQ29va2llcyhjb29raWVzLCBleHBpcmVzLCBkb21haW4pIHtcbiAgICB2YXIgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGgsXG4gICAgICAgIGN1cnJlbnRTZXNzaW9uTVBJRHMgPSBjb29raWVzLmdzLmNzbSA/IGNvb2tpZXMuZ3MuY3NtIDogW107XG4gICAgLy8gQ29tbWVudCAxIGFib3ZlXG4gICAgaWYgKCFjdXJyZW50U2Vzc2lvbk1QSURzLmxlbmd0aCkge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gY3JlYXRlRnVsbEVuY29kZWRDb29raWUoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcbiAgICAgICAgICAgICAgICBpZiAoZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGgubGVuZ3RoID4gbVBhcnRpY2xlLm1heENvb2tpZVNpemUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW2tleV0gJiYga2V5ICE9PSBjb29raWVzLmN1KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29va2llc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ29tbWVudCAyIGFib3ZlIC0gRmlyc3QgY3JlYXRlIGFuIG9iamVjdCBvZiBhbGwgTVBJRHMgb24gdGhlIGNvb2tpZVxuICAgICAgICB2YXIgTVBJRHNPbkNvb2tpZSA9IHt9O1xuICAgICAgICBmb3IgKHZhciBwb3RlbnRpYWxNUElEIGluIGNvb2tpZXMpIHtcbiAgICAgICAgICAgIGlmIChjb29raWVzLmhhc093blByb3BlcnR5KHBvdGVudGlhbE1QSUQpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW3BvdGVudGlhbE1QSURdICYmIHBvdGVudGlhbE1QSUQgIT09Y29va2llcy5jdSkge1xuICAgICAgICAgICAgICAgICAgICBNUElEc09uQ29va2llW3BvdGVudGlhbE1QSURdID0gMTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ29tbWVudCAyYSBhYm92ZVxuICAgICAgICBpZiAoT2JqZWN0LmtleXMoTVBJRHNPbkNvb2tpZSkubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBtcGlkIGluIE1QSURzT25Db29raWUpIHtcbiAgICAgICAgICAgICAgICBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aCA9IGNyZWF0ZUZ1bGxFbmNvZGVkQ29va2llKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbik7XG4gICAgICAgICAgICAgICAgaWYgKGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoLmxlbmd0aCA+IG1QYXJ0aWNsZS5tYXhDb29raWVTaXplKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChNUElEc09uQ29va2llLmhhc093blByb3BlcnR5KG1waWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudFNlc3Npb25NUElEcy5pbmRleE9mKG1waWQpID09PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWVzW21waWRdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIENvbW1lbnQgMmIgYWJvdmVcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjdXJyZW50U2Vzc2lvbk1QSURzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aCA9IGNyZWF0ZUZ1bGxFbmNvZGVkQ29va2llKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbik7XG4gICAgICAgICAgICBpZiAoZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGgubGVuZ3RoID4gbVBhcnRpY2xlLm1heENvb2tpZVNpemUpIHtcbiAgICAgICAgICAgICAgICB2YXIgTVBJRHRvUmVtb3ZlID0gY3VycmVudFNlc3Npb25NUElEc1tpXTtcbiAgICAgICAgICAgICAgICBpZiAoY29va2llc1tNUElEdG9SZW1vdmVdKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1NpemUgb2YgbmV3IGVuY29kZWQgY29va2llIGlzIGxhcmdlciB0aGFuIG1heENvb2tpZVNpemUgc2V0dGluZyBvZiAnICsgbVBhcnRpY2xlLm1heENvb2tpZVNpemUgKyAnLiBSZW1vdmluZyBmcm9tIGNvb2tpZSB0aGUgZWFybGllc3QgbG9nZ2VkIGluIE1QSUQgY29udGFpbmluZzogJyArIEpTT04uc3RyaW5naWZ5KGNvb2tpZXNbTVBJRHRvUmVtb3ZlXSwgMCwgMikpO1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29va2llc1tNUElEdG9SZW1vdmVdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1VuYWJsZSB0byBzYXZlIE1QSUQgZGF0YSB0byBjb29raWVzIGJlY2F1c2UgdGhlIHJlc3VsdGluZyBlbmNvZGVkIGNvb2tpZSBpcyBsYXJnZXIgdGhhbiB0aGUgbWF4Q29va2llU2l6ZSBzZXR0aW5nIG9mICcgKyBtUGFydGljbGUubWF4Q29va2llU2l6ZSArICcuIFdlIHJlY29tbWVuZCB1c2luZyBhIG1heENvb2tpZVNpemUgb2YgMTUwMC4nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVGdWxsRW5jb2RlZENvb2tpZShjb29raWVzLCBleHBpcmVzLCBkb21haW4pIHtcbiAgICByZXR1cm4gZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeShjb29raWVzKSkgKyAnO2V4cGlyZXM9JyArIGV4cGlyZXMgKyc7cGF0aD0vJyArIGRvbWFpbjtcbn1cblxuZnVuY3Rpb24gZmluZFByZXZDb29raWVzQmFzZWRPblVJKGlkZW50aXR5QXBpRGF0YSkge1xuICAgIHZhciBjb29raWVzID0gdGhpcy5nZXRDb29raWUoKSB8fCB0aGlzLmdldExvY2FsU3RvcmFnZSgpO1xuICAgIHZhciBtYXRjaGVkVXNlcjtcblxuICAgIGlmIChpZGVudGl0eUFwaURhdGEpIHtcbiAgICAgICAgZm9yICh2YXIgcmVxdWVzdGVkSWRlbnRpdHlUeXBlIGluIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMgJiYgT2JqZWN0LmtleXMoY29va2llcykubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gYW55IHZhbHVlIGluIGNvb2tpZXMgdGhhdCBoYXMgYW4gTVBJRCBrZXkgd2lsbCBiZSBhbiBNUElEIHRvIHNlYXJjaCB0aHJvdWdoXG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyIGtleXMgb24gdGhlIGNvb2tpZSBhcmUgY3VycmVudFNlc3Npb25NUElEcyBhbmQgY3VycmVudE1QSUQgd2hpY2ggc2hvdWxkIG5vdCBiZSBzZWFyY2hlZFxuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llc1trZXldLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBjb29raWVVSXMgPSBjb29raWVzW2tleV0udWk7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBjb29raWVVSVR5cGUgaW4gY29va2llVUlzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RlZElkZW50aXR5VHlwZSA9PT0gY29va2llVUlUeXBlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllc1tyZXF1ZXN0ZWRJZGVudGl0eVR5cGVdID09PSBjb29raWVVSXNbY29va2llVUlUeXBlXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVkVXNlciA9IGtleTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1hdGNoZWRVc2VyKSB7XG4gICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbWF0Y2hlZFVzZXIpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW5jb2RlQ29va2llcyhjb29raWUpIHtcbiAgICBjb29raWUgPSBKU09OLnBhcnNlKGNvb2tpZSk7XG4gICAgZm9yICh2YXIga2V5IGluIGNvb2tpZS5ncykge1xuICAgICAgICBpZiAoY29va2llLmdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIC8vIGJhc2U2NCBlbmNvZGUgYW55IHZhbHVlIHRoYXQgaXMgYW4gb2JqZWN0IG9yIEFycmF5IGluIGdsb2JhbFNldHRpbmdzIGZpcnN0XG4gICAgICAgICAgICBpZiAoQmFzZTY0Q29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZS5nc1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvb2tpZS5nc1trZXldKSAmJiBjb29raWUuZ3Nba2V5XS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuaXNPYmplY3QoY29va2llLmdzW2tleV0pICYmIE9iamVjdC5rZXlzKGNvb2tpZS5nc1trZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZS5nc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZS5nc1trZXldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSAnaWUnKSB7XG4gICAgICAgICAgICAgICAgY29va2llLmdzW2tleV0gPSBjb29raWUuZ3Nba2V5XSA/IDEgOiAwO1xuICAgICAgICAgICAgfSBlbHNlIGlmICghY29va2llLmdzW2tleV0pIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgY29va2llLmdzW2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKHZhciBtcGlkIGluIGNvb2tpZSkge1xuICAgICAgICBpZiAoY29va2llLmhhc093blByb3BlcnR5KG1waWQpKSB7XG4gICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGtleSBpbiBjb29raWVbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZVttcGlkXS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoQmFzZTY0Q29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoY29va2llW21waWRdW2tleV0pICYmIE9iamVjdC5rZXlzKGNvb2tpZVttcGlkXVtrZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdW2tleV0gPSBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGNvb2tpZVttcGlkXVtrZXldKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZVttcGlkXVtrZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVDb29raWVTdHJpbmcoSlNPTi5zdHJpbmdpZnkoY29va2llKSk7XG59XG5cbmZ1bmN0aW9uIGRlY29kZUNvb2tpZXMoY29va2llKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKGNvb2tpZSkge1xuICAgICAgICAgICAgY29va2llID0gSlNPTi5wYXJzZShyZXZlcnRDb29raWVTdHJpbmcoY29va2llKSk7XG4gICAgICAgICAgICBpZiAoSGVscGVycy5pc09iamVjdChjb29raWUpICYmIE9iamVjdC5rZXlzKGNvb2tpZSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGNvb2tpZS5ncykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llLmdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChCYXNlNjRDb29raWVLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWUuZ3Nba2V5XSA9IEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09ICdpZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWUuZ3Nba2V5XSA9IEJvb2xlYW4oY29va2llLmdzW2tleV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgbXBpZCBpbiBjb29raWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZS5oYXNPd25Qcm9wZXJ0eShtcGlkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChrZXkgaW4gY29va2llW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVbbXBpZF0uaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEJhc2U2NENvb2tpZUtleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVbbXBpZF1ba2V5XS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdW2tleV0gPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUoY29va2llW21waWRdW2tleV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1waWQgPT09ICdsJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZVttcGlkXSA9IEJvb2xlYW4oY29va2llW21waWRdKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGNvb2tpZSk7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1Byb2JsZW0gd2l0aCBkZWNvZGluZyBjb29raWUnLCBlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VDb21tYXNXaXRoUGlwZXMoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC8sL2csICd8Jyk7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VQaXBlc1dpdGhDb21tYXMoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC9cXHwvZywgJywnKTtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZUFwb3N0cm9waGVzV2l0aFF1b3RlcyhzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1xcJy9nLCAnXCInKTtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZVF1b3Rlc1dpdGhBcG9zdHJvcGhlcyhzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1xcXCIvZywgJ1xcJycpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVDb29raWVTdHJpbmcoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHJlcGxhY2VDb21tYXNXaXRoUGlwZXMocmVwbGFjZVF1b3Rlc1dpdGhBcG9zdHJvcGhlcyhzdHJpbmcpKTtcbn1cblxuZnVuY3Rpb24gcmV2ZXJ0Q29va2llU3RyaW5nKHN0cmluZykge1xuICAgIHJldHVybiByZXBsYWNlUGlwZXNXaXRoQ29tbWFzKHJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXMoc3RyaW5nKSk7XG59XG5cbmZ1bmN0aW9uIGdldENvb2tpZURvbWFpbigpIHtcbiAgICBpZiAoTVAuQ29uZmlnLkNvb2tpZURvbWFpbikge1xuICAgICAgICByZXR1cm4gTVAuQ29uZmlnLkNvb2tpZURvbWFpbjtcbiAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgcm9vdERvbWFpbiA9IGdldERvbWFpbihkb2N1bWVudCwgbG9jYXRpb24uaG9zdG5hbWUpO1xuICAgICAgICBpZiAocm9vdERvbWFpbiA9PT0gJycpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiAnLicgKyByb290RG9tYWluO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBUaGlzIGZ1bmN0aW9uIGxvb3BzIHRocm91Z2ggdGhlIHBhcnRzIG9mIGEgZnVsbCBob3N0bmFtZSwgYXR0ZW1wdGluZyB0byBzZXQgYSBjb29raWUgb24gdGhhdCBkb21haW4uIEl0IHdpbGwgc2V0IGEgY29va2llIGF0IHRoZSBoaWdoZXN0IGxldmVsIHBvc3NpYmxlLlxuLy8gRm9yIGV4YW1wbGUgc3ViZG9tYWluLmRvbWFpbi5jby51ayB3b3VsZCB0cnkgdGhlIGZvbGxvd2luZyBjb21iaW5hdGlvbnM6XG4vLyBcImNvLnVrXCIgLT4gZmFpbFxuLy8gXCJkb21haW4uY28udWtcIiAtPiBzdWNjZXNzLCByZXR1cm5cbi8vIFwic3ViZG9tYWluLmRvbWFpbi5jby51a1wiIC0+IHNraXBwZWQsIGJlY2F1c2UgYWxyZWFkeSBmb3VuZFxuZnVuY3Rpb24gZ2V0RG9tYWluKGRvYywgbG9jYXRpb25Ib3N0bmFtZSkge1xuICAgIHZhciBpLFxuICAgICAgICB0ZXN0UGFydHMsXG4gICAgICAgIG1wVGVzdCA9ICdtcHRlc3Q9Y29va2llJyxcbiAgICAgICAgaG9zdG5hbWUgPSBsb2NhdGlvbkhvc3RuYW1lLnNwbGl0KCcuJyk7XG4gICAgZm9yIChpID0gaG9zdG5hbWUubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgdGVzdFBhcnRzID0gaG9zdG5hbWUuc2xpY2UoaSkuam9pbignLicpO1xuICAgICAgICBkb2MuY29va2llID0gbXBUZXN0ICsgJztkb21haW49LicgKyB0ZXN0UGFydHMgKyAnOyc7XG4gICAgICAgIGlmIChkb2MuY29va2llLmluZGV4T2YobXBUZXN0KSA+IC0xKXtcbiAgICAgICAgICAgIGRvYy5jb29raWUgPSBtcFRlc3Quc3BsaXQoJz0nKVswXSArICc9O2RvbWFpbj0uJyArIHRlc3RQYXJ0cyArICc7ZXhwaXJlcz1UaHUsIDAxIEphbiAxOTcwIDAwOjAwOjAxIEdNVDsnO1xuICAgICAgICAgICAgcmV0dXJuIHRlc3RQYXJ0cztcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gJyc7XG59XG5cbmZ1bmN0aW9uIGRlY29kZVByb2R1Y3RzKCkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUobG9jYWxTdG9yYWdlLmdldEl0ZW0oTVAucHJvZFN0b3JhZ2VOYW1lKSkpO1xufVxuXG5mdW5jdGlvbiBnZXRVc2VySWRlbnRpdGllcyhtcGlkKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgcmV0dXJuIE1QLnVzZXJJZGVudGl0aWVzO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvb2tpZXMgPSBnZXRQZXJzaXN0ZW5jZSgpO1xuXG4gICAgICAgIGlmIChjb29raWVzICYmIGNvb2tpZXNbbXBpZF0gJiYgY29va2llc1ttcGlkXS51aSkge1xuICAgICAgICAgICAgcmV0dXJuIGNvb2tpZXNbbXBpZF0udWk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4ge307XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEFsbFVzZXJBdHRyaWJ1dGVzKG1waWQpIHtcbiAgICB2YXIgY29va2llcztcbiAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICByZXR1cm4gTVAudXNlckF0dHJpYnV0ZXM7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29va2llcyA9IGdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSAmJiBjb29raWVzW21waWRdLnVhKSB7XG4gICAgICAgICAgICByZXR1cm4gY29va2llc1ttcGlkXS51YTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0Q2FydFByb2R1Y3RzKG1waWQpIHtcbiAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICByZXR1cm4gTVAuY2FydFByb2R1Y3RzO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBhbGxDYXJ0UHJvZHVjdHMgPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUobG9jYWxTdG9yYWdlLmdldEl0ZW0oTVAucHJvZFN0b3JhZ2VOYW1lKSkpO1xuICAgICAgICBpZiAoYWxsQ2FydFByb2R1Y3RzICYmIGFsbENhcnRQcm9kdWN0c1ttcGlkXSAmJiBhbGxDYXJ0UHJvZHVjdHNbbXBpZF0uY3ApIHtcbiAgICAgICAgICAgIHJldHVybiBhbGxDYXJ0UHJvZHVjdHNbbXBpZF0uY3A7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldENhcnRQcm9kdWN0cyhhbGxQcm9kdWN0cykge1xuICAgIGlmICghTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbShlbmNvZGVVUklDb21wb25lbnQoTVAucHJvZFN0b3JhZ2VOYW1lKSwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShhbGxQcm9kdWN0cykpKTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igd2l0aCBzZXR0aW5nIHByb2R1Y3RzIG9uIGxvY2FsU3RvcmFnZS4nKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzKSB7XG4gICAgdmFyIGVuY29kZWRDb29raWVzID0gZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeShjb29raWVzKSksXG4gICAgICAgIGRhdGUgPSBuZXcgRGF0ZSgpLFxuICAgICAgICBrZXkgPSBNUC5zdG9yYWdlTmFtZSxcbiAgICAgICAgZXhwaXJlcyA9IG5ldyBEYXRlKGRhdGUuZ2V0VGltZSgpICtcbiAgICAgICAgKE1QLkNvbmZpZy5Db29raWVFeHBpcmF0aW9uICogMjQgKiA2MCAqIDYwICogMTAwMCkpLnRvR01UU3RyaW5nKCksXG4gICAgICAgIGNvb2tpZURvbWFpbiA9IGdldENvb2tpZURvbWFpbigpLFxuICAgICAgICBkb21haW47XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICB2YXIgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGggPSByZWR1Y2VBbmRFbmNvZGVDb29raWVzKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbik7XG4gICAgICAgIHdpbmRvdy5kb2N1bWVudC5jb29raWUgPVxuICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgKyAnPScgKyBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aDtcbiAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoTVAuaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGUpIHtcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKE1QLnN0b3JhZ2VOYW1lLCBlbmNvZGVkQ29va2llcyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldFBlcnNpc3RlbmNlKCkge1xuICAgIHZhciBjb29raWVzO1xuICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICBjb29raWVzID0gZ2V0Q29va2llKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29va2llcyA9IGdldExvY2FsU3RvcmFnZSgpO1xuICAgIH1cblxuICAgIHJldHVybiBjb29raWVzO1xufVxuXG5mdW5jdGlvbiBnZXRDb25zZW50U3RhdGUobXBpZCkge1xuICAgIHZhciBjb29raWVzO1xuICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgIHJldHVybiBNUC5jb25zZW50U3RhdGU7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29va2llcyA9IGdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSAmJiBjb29raWVzW21waWRdLmNvbikge1xuICAgICAgICAgICAgcmV0dXJuIENvbnNlbnQuU2VyaWFsaXphdGlvbi5mcm9tTWluaWZpZWRKc29uT2JqZWN0KGNvb2tpZXNbbXBpZF0uY29uKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZXRDb25zZW50U3RhdGUobXBpZCwgY29uc2VudFN0YXRlKSB7XG4gICAgLy9pdCdzIGN1cnJlbnRseSBub3Qgc3VwcG9ydGVkIHRvIHNldCBwZXJzaXN0ZW5jZVxuICAgIC8vZm9yIGFueSBNUElEIHRoYXQncyBub3QgdGhlIGN1cnJlbnQgb25lLlxuICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IGNvbnNlbnRTdGF0ZTtcbiAgICB9XG4gICAgdGhpcy51cGRhdGUoKTtcbn1cblxuZnVuY3Rpb24gZ2V0RGV2aWNlSWQoKSB7XG4gICAgcmV0dXJuIE1QLmRldmljZUlkO1xufVxuXG5mdW5jdGlvbiByZXNldFBlcnNpc3RlbmNlKCkge1xuICAgIHJlbW92ZUxvY2FsU3RvcmFnZShNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZSk7XG4gICAgcmVtb3ZlTG9jYWxTdG9yYWdlKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjMpO1xuICAgIHJlbW92ZUxvY2FsU3RvcmFnZShNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZVY0KTtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAucHJvZFN0b3JhZ2VOYW1lKTtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAuQ29uZmlnLkxvY2FsU3RvcmFnZVByb2R1Y3RzVjQpO1xuXG4gICAgZXhwaXJlQ29va2llcyhNUC5Db25maWcuQ29va2llTmFtZSk7XG4gICAgZXhwaXJlQ29va2llcyhNUC5Db25maWcuQ29va2llTmFtZVYyKTtcbiAgICBleHBpcmVDb29raWVzKE1QLkNvbmZpZy5Db29raWVOYW1lVjMpO1xuICAgIGV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCk7XG4gICAgaWYgKG1QYXJ0aWNsZS5faXNUZXN0RW52KSB7XG4gICAgICAgIHJlbW92ZUxvY2FsU3RvcmFnZShIZWxwZXJzLmNyZWF0ZU1haW5TdG9yYWdlTmFtZShtUGFydGljbGUud29ya3NwYWNlVG9rZW4pKTtcbiAgICAgICAgZXhwaXJlQ29va2llcyhIZWxwZXJzLmNyZWF0ZU1haW5TdG9yYWdlTmFtZShtUGFydGljbGUud29ya3NwYWNlVG9rZW4pKTtcbiAgICAgICAgcmVtb3ZlTG9jYWxTdG9yYWdlKEhlbHBlcnMuY3JlYXRlUHJvZHVjdFN0b3JhZ2VOYW1lKG1QYXJ0aWNsZS53b3Jrc3BhY2VUb2tlbikpO1xuICAgIH1cbn1cblxuLy8gRm9yd2FyZGVyIEJhdGNoaW5nIENvZGVcbnZhciBmb3J3YXJkaW5nU3RhdHNCYXRjaGVzID0ge1xuICAgIHVwbG9hZHNUYWJsZToge30sXG4gICAgZm9yd2FyZGluZ1N0YXRzRXZlbnRRdWV1ZTogW11cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHVzZUxvY2FsU3RvcmFnZTogdXNlTG9jYWxTdG9yYWdlLFxuICAgIGluaXRpYWxpemVTdG9yYWdlOiBpbml0aWFsaXplU3RvcmFnZSxcbiAgICB1cGRhdGU6IHVwZGF0ZSxcbiAgICBkZXRlcm1pbmVMb2NhbFN0b3JhZ2VBdmFpbGFiaWxpdHk6IGRldGVybWluZUxvY2FsU3RvcmFnZUF2YWlsYWJpbGl0eSxcbiAgICBjb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llczogY29udmVydEluTWVtb3J5RGF0YUZvckNvb2tpZXMsXG4gICAgY29udmVydFByb2R1Y3RzRm9yTG9jYWxTdG9yYWdlOiBjb252ZXJ0UHJvZHVjdHNGb3JMb2NhbFN0b3JhZ2UsXG4gICAgZ2V0VXNlclByb2R1Y3RzRnJvbUxTOiBnZXRVc2VyUHJvZHVjdHNGcm9tTFMsXG4gICAgZ2V0QWxsVXNlclByb2R1Y3RzRnJvbUxTOiBnZXRBbGxVc2VyUHJvZHVjdHNGcm9tTFMsXG4gICAgc3RvcmVQcm9kdWN0c0luTWVtb3J5OiBzdG9yZVByb2R1Y3RzSW5NZW1vcnksXG4gICAgc2V0TG9jYWxTdG9yYWdlOiBzZXRMb2NhbFN0b3JhZ2UsXG4gICAgc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXM6IHNldEdsb2JhbFN0b3JhZ2VBdHRyaWJ1dGVzLFxuICAgIGdldExvY2FsU3RvcmFnZTogZ2V0TG9jYWxTdG9yYWdlLFxuICAgIHN0b3JlRGF0YUluTWVtb3J5OiBzdG9yZURhdGFJbk1lbW9yeSxcbiAgICByZXRyaWV2ZURldmljZUlkOiByZXRyaWV2ZURldmljZUlkLFxuICAgIHBhcnNlRGV2aWNlSWQ6IHBhcnNlRGV2aWNlSWQsXG4gICAgZXhwaXJlQ29va2llczogZXhwaXJlQ29va2llcyxcbiAgICBnZXRDb29raWU6IGdldENvb2tpZSxcbiAgICBzZXRDb29raWU6IHNldENvb2tpZSxcbiAgICByZWR1Y2VBbmRFbmNvZGVDb29raWVzOiByZWR1Y2VBbmRFbmNvZGVDb29raWVzLFxuICAgIGZpbmRQcmV2Q29va2llc0Jhc2VkT25VSTogZmluZFByZXZDb29raWVzQmFzZWRPblVJLFxuICAgIHJlcGxhY2VDb21tYXNXaXRoUGlwZXM6IHJlcGxhY2VDb21tYXNXaXRoUGlwZXMsXG4gICAgcmVwbGFjZVBpcGVzV2l0aENvbW1hczogcmVwbGFjZVBpcGVzV2l0aENvbW1hcyxcbiAgICByZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzOiByZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzLFxuICAgIHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXM6IHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXMsXG4gICAgY3JlYXRlQ29va2llU3RyaW5nOiBjcmVhdGVDb29raWVTdHJpbmcsXG4gICAgcmV2ZXJ0Q29va2llU3RyaW5nOiByZXZlcnRDb29raWVTdHJpbmcsXG4gICAgZW5jb2RlQ29va2llczogZW5jb2RlQ29va2llcyxcbiAgICBkZWNvZGVDb29raWVzOiBkZWNvZGVDb29raWVzLFxuICAgIGdldENvb2tpZURvbWFpbjogZ2V0Q29va2llRG9tYWluLFxuICAgIGRlY29kZVByb2R1Y3RzOiBkZWNvZGVQcm9kdWN0cyxcbiAgICBnZXRVc2VySWRlbnRpdGllczogZ2V0VXNlcklkZW50aXRpZXMsXG4gICAgZ2V0QWxsVXNlckF0dHJpYnV0ZXM6IGdldEFsbFVzZXJBdHRyaWJ1dGVzLFxuICAgIGdldENhcnRQcm9kdWN0czogZ2V0Q2FydFByb2R1Y3RzLFxuICAgIHNldENhcnRQcm9kdWN0czogc2V0Q2FydFByb2R1Y3RzLFxuICAgIHVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlczogdXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzLFxuICAgIGdldFBlcnNpc3RlbmNlOiBnZXRQZXJzaXN0ZW5jZSxcbiAgICBnZXREZXZpY2VJZDogZ2V0RGV2aWNlSWQsXG4gICAgcmVzZXRQZXJzaXN0ZW5jZTogcmVzZXRQZXJzaXN0ZW5jZSxcbiAgICBnZXRDb25zZW50U3RhdGU6IGdldENvbnNlbnRTdGF0ZSxcbiAgICBzZXRDb25zZW50U3RhdGU6IHNldENvbnNlbnRTdGF0ZSxcbiAgICBmb3J3YXJkaW5nU3RhdHNCYXRjaGVzOiBmb3J3YXJkaW5nU3RhdHNCYXRjaGVzXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKTtcblxuLy8gQmFzZTY0IGVuY29kZXIvZGVjb2RlciAtIGh0dHA6Ly93d3cud2VidG9vbGtpdC5pbmZvL2phdmFzY3JpcHRfYmFzZTY0Lmh0bWxcbnZhciBCYXNlNjQgPSB7XG4gICAgX2tleVN0cjogJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky89JyxcblxuICAgIC8vIElucHV0IG11c3QgYmUgYSBzdHJpbmdcbiAgICBlbmNvZGU6IGZ1bmN0aW9uIGVuY29kZShpbnB1dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHdpbmRvdy5idG9hICYmIHdpbmRvdy5hdG9iKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHdpbmRvdy5idG9hKHVuZXNjYXBlKGVuY29kZVVSSUNvbXBvbmVudChpbnB1dCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgZW5jb2RpbmcgY29va2llIHZhbHVlcyBpbnRvIEJhc2U2NDonICsgZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VuY29kZShpbnB1dCk7XG4gICAgfSxcblxuICAgIF9lbmNvZGU6IGZ1bmN0aW9uIF9lbmNvZGUoaW5wdXQpIHtcbiAgICAgICAgdmFyIG91dHB1dCA9ICcnO1xuICAgICAgICB2YXIgY2hyMSwgY2hyMiwgY2hyMywgZW5jMSwgZW5jMiwgZW5jMywgZW5jNDtcbiAgICAgICAgdmFyIGkgPSAwO1xuXG4gICAgICAgIGlucHV0ID0gVVRGOC5lbmNvZGUoaW5wdXQpO1xuXG4gICAgICAgIHdoaWxlIChpIDwgaW5wdXQubGVuZ3RoKSB7XG4gICAgICAgICAgICBjaHIxID0gaW5wdXQuY2hhckNvZGVBdChpKyspO1xuICAgICAgICAgICAgY2hyMiA9IGlucHV0LmNoYXJDb2RlQXQoaSsrKTtcbiAgICAgICAgICAgIGNocjMgPSBpbnB1dC5jaGFyQ29kZUF0KGkrKyk7XG5cbiAgICAgICAgICAgIGVuYzEgPSBjaHIxID4+IDI7XG4gICAgICAgICAgICBlbmMyID0gKGNocjEgJiAzKSA8PCA0IHwgY2hyMiA+PiA0O1xuICAgICAgICAgICAgZW5jMyA9IChjaHIyICYgMTUpIDw8IDIgfCBjaHIzID4+IDY7XG4gICAgICAgICAgICBlbmM0ID0gY2hyMyAmIDYzO1xuXG4gICAgICAgICAgICBpZiAoaXNOYU4oY2hyMikpIHtcbiAgICAgICAgICAgICAgICBlbmMzID0gZW5jNCA9IDY0O1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc05hTihjaHIzKSkge1xuICAgICAgICAgICAgICAgIGVuYzQgPSA2NDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzEpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzIpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzMpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvdXRwdXQ7XG4gICAgfSxcblxuICAgIGRlY29kZTogZnVuY3Rpb24gZGVjb2RlKGlucHV0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAod2luZG93LmJ0b2EgJiYgd2luZG93LmF0b2IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGVzY2FwZSh3aW5kb3cuYXRvYihpbnB1dCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgLy9sb2coZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIEJhc2U2NC5fZGVjb2RlKGlucHV0KTtcbiAgICB9LFxuXG4gICAgX2RlY29kZTogZnVuY3Rpb24gX2RlY29kZShpbnB1dCkge1xuICAgICAgICB2YXIgb3V0cHV0ID0gJyc7XG4gICAgICAgIHZhciBjaHIxLCBjaHIyLCBjaHIzO1xuICAgICAgICB2YXIgZW5jMSwgZW5jMiwgZW5jMywgZW5jNDtcbiAgICAgICAgdmFyIGkgPSAwO1xuXG4gICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZSgvW15BLVphLXowLTlcXCtcXC9cXD1dL2csICcnKTtcblxuICAgICAgICB3aGlsZSAoaSA8IGlucHV0Lmxlbmd0aCkge1xuICAgICAgICAgICAgZW5jMSA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jMiA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jMyA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jNCA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuXG4gICAgICAgICAgICBjaHIxID0gZW5jMSA8PCAyIHwgZW5jMiA+PiA0O1xuICAgICAgICAgICAgY2hyMiA9IChlbmMyICYgMTUpIDw8IDQgfCBlbmMzID4+IDI7XG4gICAgICAgICAgICBjaHIzID0gKGVuYzMgJiAzKSA8PCA2IHwgZW5jNDtcblxuICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgU3RyaW5nLmZyb21DaGFyQ29kZShjaHIxKTtcblxuICAgICAgICAgICAgaWYgKGVuYzMgIT09IDY0KSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgU3RyaW5nLmZyb21DaGFyQ29kZShjaHIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChlbmM0ICE9PSA2NCkge1xuICAgICAgICAgICAgICAgIG91dHB1dCA9IG91dHB1dCArIFN0cmluZy5mcm9tQ2hhckNvZGUoY2hyMyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgb3V0cHV0ID0gVVRGOC5kZWNvZGUob3V0cHV0KTtcbiAgICAgICAgcmV0dXJuIG91dHB1dDtcbiAgICB9XG59O1xuXG52YXIgVVRGOCA9IHtcbiAgICBlbmNvZGU6IGZ1bmN0aW9uIGVuY29kZShzKSB7XG4gICAgICAgIHZhciB1dGZ0ZXh0ID0gJyc7XG5cbiAgICAgICAgZm9yICh2YXIgbiA9IDA7IG4gPCBzLmxlbmd0aDsgbisrKSB7XG4gICAgICAgICAgICB2YXIgYyA9IHMuY2hhckNvZGVBdChuKTtcblxuICAgICAgICAgICAgaWYgKGMgPCAxMjgpIHtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGMgPiAxMjcgJiYgYyA8IDIwNDgpIHtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyA+PiA2IHwgMTkyKTtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyAmIDYzIHwgMTI4KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdXRmdGV4dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMgPj4gMTIgfCAyMjQpO1xuICAgICAgICAgICAgICAgIHV0ZnRleHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjID4+IDYgJiA2MyB8IDEyOCk7XG4gICAgICAgICAgICAgICAgdXRmdGV4dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMgJiA2MyB8IDEyOCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHV0ZnRleHQ7XG4gICAgfSxcblxuICAgIGRlY29kZTogZnVuY3Rpb24gZGVjb2RlKHV0ZnRleHQpIHtcbiAgICAgICAgdmFyIHMgPSAnJztcbiAgICAgICAgdmFyIGkgPSAwO1xuICAgICAgICB2YXIgYyA9IDAsXG4gICAgICAgICAgICBjMSA9IDAsXG4gICAgICAgICAgICBjMiA9IDA7XG5cbiAgICAgICAgd2hpbGUgKGkgPCB1dGZ0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgICAgYyA9IHV0ZnRleHQuY2hhckNvZGVBdChpKTtcbiAgICAgICAgICAgIGlmIChjIDwgMTI4KSB7XG4gICAgICAgICAgICAgICAgcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMpO1xuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYyA+IDE5MSAmJiBjIDwgMjI0KSB7XG4gICAgICAgICAgICAgICAgYzEgPSB1dGZ0ZXh0LmNoYXJDb2RlQXQoaSArIDEpO1xuICAgICAgICAgICAgICAgIHMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoYyAmIDMxKSA8PCA2IHwgYzEgJiA2Myk7XG4gICAgICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjMSA9IHV0ZnRleHQuY2hhckNvZGVBdChpICsgMSk7XG4gICAgICAgICAgICAgICAgYzIgPSB1dGZ0ZXh0LmNoYXJDb2RlQXQoaSArIDIpO1xuICAgICAgICAgICAgICAgIHMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoYyAmIDE1KSA8PCAxMiB8IChjMSAmIDYzKSA8PCA2IHwgYzIgJiA2Myk7XG4gICAgICAgICAgICAgICAgaSArPSAzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIC8vIGZvckVhY2ggcG9seWZpbGxcbiAgICAvLyBQcm9kdWN0aW9uIHN0ZXBzIG9mIEVDTUEtMjYyLCBFZGl0aW9uIDUsIDE1LjQuNC4xOFxuICAgIC8vIFJlZmVyZW5jZTogaHR0cDovL2VzNS5naXRodWIuaW8vI3gxNS40LjQuMThcbiAgICBmb3JFYWNoOiBmdW5jdGlvbihjYWxsYmFjaywgdGhpc0FyZykge1xuICAgICAgICB2YXIgVCwgaztcblxuICAgICAgICBpZiAodGhpcyA9PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCcgdGhpcyBpcyBudWxsIG9yIG5vdCBkZWZpbmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgTyA9IE9iamVjdCh0aGlzKTtcbiAgICAgICAgdmFyIGxlbiA9IE8ubGVuZ3RoID4+PiAwO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoY2FsbGJhY2sgKyAnIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIFQgPSB0aGlzQXJnO1xuICAgICAgICB9XG5cbiAgICAgICAgayA9IDA7XG5cbiAgICAgICAgd2hpbGUgKGsgPCBsZW4pIHtcbiAgICAgICAgICAgIHZhciBrVmFsdWU7XG4gICAgICAgICAgICBpZiAoayBpbiBPKSB7XG4gICAgICAgICAgICAgICAga1ZhbHVlID0gT1trXTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjay5jYWxsKFQsIGtWYWx1ZSwgaywgTyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrKys7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gbWFwIHBvbHlmaWxsXG4gICAgLy8gUHJvZHVjdGlvbiBzdGVwcyBvZiBFQ01BLTI2MiwgRWRpdGlvbiA1LCAxNS40LjQuMTlcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHA6Ly9lczUuZ2l0aHViLmlvLyN4MTUuNC40LjE5XG4gICAgbWFwOiBmdW5jdGlvbihjYWxsYmFjaywgdGhpc0FyZykge1xuICAgICAgICB2YXIgVCwgQSwgaztcblxuICAgICAgICBpZiAodGhpcyA9PT0gbnVsbCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignIHRoaXMgaXMgbnVsbCBvciBub3QgZGVmaW5lZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIE8gPSBPYmplY3QodGhpcyk7XG4gICAgICAgIHZhciBsZW4gPSBPLmxlbmd0aCA+Pj4gMDtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGNhbGxiYWNrICsgJyBpcyBub3QgYSBmdW5jdGlvbicpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICBUID0gdGhpc0FyZztcbiAgICAgICAgfVxuXG4gICAgICAgIEEgPSBuZXcgQXJyYXkobGVuKTtcblxuICAgICAgICBrID0gMDtcblxuICAgICAgICB3aGlsZSAoayA8IGxlbikge1xuICAgICAgICAgICAgdmFyIGtWYWx1ZSwgbWFwcGVkVmFsdWU7XG4gICAgICAgICAgICBpZiAoayBpbiBPKSB7XG4gICAgICAgICAgICAgICAga1ZhbHVlID0gT1trXTtcbiAgICAgICAgICAgICAgICBtYXBwZWRWYWx1ZSA9IGNhbGxiYWNrLmNhbGwoVCwga1ZhbHVlLCBrLCBPKTtcbiAgICAgICAgICAgICAgICBBW2tdID0gbWFwcGVkVmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrKys7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQTtcbiAgICB9LFxuXG4gICAgLy8gZmlsdGVyIHBvbHlmaWxsXG4gICAgLy8gUHJvZGN1dGlvbiBzdGVwcyBvZiBFQ01BLTI2MiwgRWRpdGlvbiA1XG4gICAgLy8gUmVmZXJlbmNlOiBodHRwOi8vZXM1LmdpdGh1Yi5pby8jeDE1LjQuNC4yMFxuICAgIGZpbHRlcjogZnVuY3Rpb24oZnVuLyosIHRoaXNBcmcqLykge1xuICAgICAgICAndXNlIHN0cmljdCc7XG5cbiAgICAgICAgaWYgKHRoaXMgPT09IHZvaWQgMCB8fCB0aGlzID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdCA9IE9iamVjdCh0aGlzKTtcbiAgICAgICAgdmFyIGxlbiA9IHQubGVuZ3RoID4+PiAwO1xuICAgICAgICBpZiAodHlwZW9mIGZ1biAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJlcyA9IFtdO1xuICAgICAgICB2YXIgdGhpc0FyZyA9IGFyZ3VtZW50cy5sZW5ndGggPj0gMiA/IGFyZ3VtZW50c1sxXSA6IHZvaWQgMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgaWYgKGkgaW4gdCkge1xuICAgICAgICAgICAgICAgIHZhciB2YWwgPSB0W2ldO1xuICAgICAgICAgICAgICAgIGlmIChmdW4uY2FsbCh0aGlzQXJnLCB2YWwsIGksIHQpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5wdXNoKHZhbCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9LFxuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvQXJyYXkvaXNBcnJheVxuICAgIGlzQXJyYXk6IGZ1bmN0aW9uKGFyZykge1xuICAgICAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gICAgfSxcblxuICAgIEJhc2U2NDogQmFzZTY0XG59O1xuIiwidmFyIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIE1lc3NhZ2VUeXBlID0gVHlwZXMuTWVzc2FnZVR5cGUsXG4gICAgQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZSA9IFR5cGVzLkFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUsXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgcGFyc2VOdW1iZXIgPSByZXF1aXJlKCcuL2hlbHBlcnMnKS5wYXJzZU51bWJlcjtcblxuZnVuY3Rpb24gY29udmVydEN1c3RvbUZsYWdzKGV2ZW50LCBkdG8pIHtcbiAgICB2YXIgdmFsdWVBcnJheSA9IFtdO1xuICAgIGR0by5mbGFncyA9IHt9O1xuXG4gICAgZm9yICh2YXIgcHJvcCBpbiBldmVudC5DdXN0b21GbGFncykge1xuICAgICAgICB2YWx1ZUFycmF5ID0gW107XG5cbiAgICAgICAgaWYgKGV2ZW50LkN1c3RvbUZsYWdzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShldmVudC5DdXN0b21GbGFnc1twcm9wXSkpIHtcbiAgICAgICAgICAgICAgICBldmVudC5DdXN0b21GbGFnc1twcm9wXS5mb3JFYWNoKGZ1bmN0aW9uKGN1c3RvbUZsYWdQcm9wZXJ0eSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICAgICAgICAgfHwgdHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICAgICAgfHwgdHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUFycmF5LnB1c2goY3VzdG9tRmxhZ1Byb3BlcnR5LnRvU3RyaW5nKCkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdudW1iZXInXG4gICAgICAgICAgICB8fCB0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdzdHJpbmcnXG4gICAgICAgICAgICB8fCB0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgIHZhbHVlQXJyYXkucHVzaChldmVudC5DdXN0b21GbGFnc1twcm9wXS50b1N0cmluZygpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlQXJyYXkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZHRvLmZsYWdzW3Byb3BdID0gdmFsdWVBcnJheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RMaXN0VG9EVE8ocHJvZHVjdExpc3QpIHtcbiAgICBpZiAoIXByb2R1Y3RMaXN0KSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjdExpc3QubWFwKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgcmV0dXJuIGNvbnZlcnRQcm9kdWN0VG9EVE8ocHJvZHVjdCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQcm9kdWN0VG9EVE8ocHJvZHVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIGlkOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5Ta3UpLFxuICAgICAgICBubTogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuTmFtZSksXG4gICAgICAgIHByOiBwYXJzZU51bWJlcihwcm9kdWN0LlByaWNlKSxcbiAgICAgICAgcXQ6IHBhcnNlTnVtYmVyKHByb2R1Y3QuUXVhbnRpdHkpLFxuICAgICAgICBicjogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuQnJhbmQpLFxuICAgICAgICB2YTogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuVmFyaWFudCksXG4gICAgICAgIGNhOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5DYXRlZ29yeSksXG4gICAgICAgIHBzOiBwYXJzZU51bWJlcihwcm9kdWN0LlBvc2l0aW9uKSxcbiAgICAgICAgY2M6IEhlbHBlcnMucGFyc2VTdHJpbmdPck51bWJlcihwcm9kdWN0LkNvdXBvbkNvZGUpLFxuICAgICAgICB0cGE6IHBhcnNlTnVtYmVyKHByb2R1Y3QuVG90YWxBbW91bnQpLFxuICAgICAgICBhdHRyczogcHJvZHVjdC5BdHRyaWJ1dGVzXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY29udmVydFRvQ29uc2VudFN0YXRlRFRPKHN0YXRlKSB7XG4gICAgaWYgKCFzdGF0ZSkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgdmFyIGpzb25PYmplY3QgPSB7fTtcbiAgICB2YXIgZ2RwckNvbnNlbnRTdGF0ZSA9IHN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKTtcbiAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICB2YXIgZ2RwciA9IHt9O1xuICAgICAgICBqc29uT2JqZWN0LmdkcHIgPSBnZHByO1xuICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGdkcHJDb25zZW50U3RhdGUpe1xuICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgZ2RwckNvbnNlbnQgPSBnZHByQ29uc2VudFN0YXRlW3B1cnBvc2VdO1xuICAgICAgICAgICAgICAgIGpzb25PYmplY3QuZ2RwcltwdXJwb3NlXSA9IHt9O1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuQ29uc2VudGVkKSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0uYyA9IGdkcHJDb25zZW50LkNvbnNlbnRlZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5UaW1lc3RhbXApID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgICAgICAgICBnZHByW3B1cnBvc2VdLnRzID0gZ2RwckNvbnNlbnQuVGltZXN0YW1wO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0uZCA9IGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Mb2NhdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0ubCA9IGdkcHJDb25zZW50LkxvY2F0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkhhcmR3YXJlSWQpID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICBnZHByW3B1cnBvc2VdLmggPSBnZHByQ29uc2VudC5IYXJkd2FyZUlkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBqc29uT2JqZWN0O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudE9iamVjdChtZXNzYWdlVHlwZSwgbmFtZSwgZGF0YSwgZXZlbnRUeXBlLCBjdXN0b21GbGFncykge1xuICAgIHZhciBldmVudE9iamVjdCxcbiAgICAgICAgb3B0T3V0ID0gKG1lc3NhZ2VUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5PcHRPdXQgPyAhTVAuaXNFbmFibGVkIDogbnVsbCk7XG4gICAgZGF0YSA9IEhlbHBlcnMuc2FuaXRpemVBdHRyaWJ1dGVzKGRhdGEpO1xuXG4gICAgaWYgKE1QLnNlc3Npb25JZCB8fCBtZXNzYWdlVHlwZSA9PSBUeXBlcy5NZXNzYWdlVHlwZS5PcHRPdXQgfHwgTVAud2Vidmlld0JyaWRnZUVuYWJsZWQpIHtcbiAgICAgICAgaWYgKG1lc3NhZ2VUeXBlICE9PSBUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKSB7XG4gICAgICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IG5ldyBEYXRlKCk7XG4gICAgICAgIH1cbiAgICAgICAgZXZlbnRPYmplY3QgPSB7XG4gICAgICAgICAgICBFdmVudE5hbWU6IG5hbWUgfHwgbWVzc2FnZVR5cGUsXG4gICAgICAgICAgICBFdmVudENhdGVnb3J5OiBldmVudFR5cGUsXG4gICAgICAgICAgICBVc2VyQXR0cmlidXRlczogTVAudXNlckF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBVc2VySWRlbnRpdGllczogTVAudXNlcklkZW50aXRpZXMsXG4gICAgICAgICAgICBTdG9yZTogTVAuc2VydmVyU2V0dGluZ3MsXG4gICAgICAgICAgICBFdmVudEF0dHJpYnV0ZXM6IGRhdGEsXG4gICAgICAgICAgICBTREtWZXJzaW9uOiBDb25zdGFudHMuc2RrVmVyc2lvbixcbiAgICAgICAgICAgIFNlc3Npb25JZDogTVAuc2Vzc2lvbklkLFxuICAgICAgICAgICAgRXZlbnREYXRhVHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAgICAgICBEZWJ1ZzogbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlLFxuICAgICAgICAgICAgTG9jYXRpb246IE1QLmN1cnJlbnRQb3NpdGlvbixcbiAgICAgICAgICAgIE9wdE91dDogb3B0T3V0LFxuICAgICAgICAgICAgRXhwYW5kZWRFdmVudENvdW50OiAwLFxuICAgICAgICAgICAgQ3VzdG9tRmxhZ3M6IGN1c3RvbUZsYWdzLFxuICAgICAgICAgICAgQXBwVmVyc2lvbjogTVAuYXBwVmVyc2lvbixcbiAgICAgICAgICAgIENsaWVudEdlbmVyYXRlZElkOiBNUC5jbGllbnRJZCxcbiAgICAgICAgICAgIERldmljZUlkOiBNUC5kZXZpY2VJZCxcbiAgICAgICAgICAgIE1QSUQ6IE1QLm1waWQsXG4gICAgICAgICAgICBDb25zZW50U3RhdGU6IE1QLmNvbnNlbnRTdGF0ZSxcbiAgICAgICAgICAgIEludGVncmF0aW9uQXR0cmlidXRlczogTVAuaW50ZWdyYXRpb25BdHRyaWJ1dGVzXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKG1lc3NhZ2VUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKSB7XG4gICAgICAgICAgICBldmVudE9iamVjdC5TZXNzaW9uTGVuZ3RoID0gTVAuZGF0ZUxhc3RFdmVudFNlbnQuZ2V0VGltZSgpIC0gTVAuc2Vzc2lvblN0YXJ0RGF0ZS5nZXRUaW1lKCk7XG4gICAgICAgICAgICBldmVudE9iamVjdC5jdXJyZW50U2Vzc2lvbk1QSURzID0gTVAuY3VycmVudFNlc3Npb25NUElEcztcbiAgICAgICAgICAgIGV2ZW50T2JqZWN0LkV2ZW50QXR0cmlidXRlcyA9IE1QLnNlc3Npb25BdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzID0gW107XG4gICAgICAgIH1cblxuICAgICAgICBldmVudE9iamVjdC5UaW1lc3RhbXAgPSBNUC5kYXRlTGFzdEV2ZW50U2VudC5nZXRUaW1lKCk7XG5cbiAgICAgICAgcmV0dXJuIGV2ZW50T2JqZWN0O1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0RXZlbnRUb0RUTyhldmVudCwgaXNGaXJzdFJ1biwgY3VycmVuY3lDb2RlKSB7XG4gICAgdmFyIGR0byA9IHtcbiAgICAgICAgbjogZXZlbnQuRXZlbnROYW1lLFxuICAgICAgICBldDogZXZlbnQuRXZlbnRDYXRlZ29yeSxcbiAgICAgICAgdWE6IGV2ZW50LlVzZXJBdHRyaWJ1dGVzLFxuICAgICAgICB1aTogZXZlbnQuVXNlcklkZW50aXRpZXMsXG4gICAgICAgIGlhOiBldmVudC5JbnRlZ3JhdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgIHN0cjogZXZlbnQuU3RvcmUsXG4gICAgICAgIGF0dHJzOiBldmVudC5FdmVudEF0dHJpYnV0ZXMsXG4gICAgICAgIHNkazogZXZlbnQuU0RLVmVyc2lvbixcbiAgICAgICAgc2lkOiBldmVudC5TZXNzaW9uSWQsXG4gICAgICAgIHNsOiBldmVudC5TZXNzaW9uTGVuZ3RoLFxuICAgICAgICBkdDogZXZlbnQuRXZlbnREYXRhVHlwZSxcbiAgICAgICAgZGJnOiBldmVudC5EZWJ1ZyxcbiAgICAgICAgY3Q6IGV2ZW50LlRpbWVzdGFtcCxcbiAgICAgICAgbGM6IGV2ZW50LkxvY2F0aW9uLFxuICAgICAgICBvOiBldmVudC5PcHRPdXQsXG4gICAgICAgIGVlYzogZXZlbnQuRXhwYW5kZWRFdmVudENvdW50LFxuICAgICAgICBhdjogZXZlbnQuQXBwVmVyc2lvbixcbiAgICAgICAgY2dpZDogZXZlbnQuQ2xpZW50R2VuZXJhdGVkSWQsXG4gICAgICAgIGRhczogZXZlbnQuRGV2aWNlSWQsXG4gICAgICAgIG1waWQ6IGV2ZW50Lk1QSUQsXG4gICAgICAgIHNtcGlkczogZXZlbnQuY3VycmVudFNlc3Npb25NUElEc1xuICAgIH07XG5cbiAgICB2YXIgY29uc2VudCA9IGNvbnZlcnRUb0NvbnNlbnRTdGF0ZURUTyhldmVudC5Db25zZW50U3RhdGUpO1xuICAgIGlmIChjb25zZW50KSB7XG4gICAgICAgIGR0by5jb24gPSBjb25zZW50O1xuICAgIH1cblxuICAgIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBNZXNzYWdlVHlwZS5BcHBTdGF0ZVRyYW5zaXRpb24pIHtcbiAgICAgICAgZHRvLmZyID0gaXNGaXJzdFJ1bjtcbiAgICAgICAgZHRvLml1ID0gZmFsc2U7XG4gICAgICAgIGR0by5hdCA9IEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUuQXBwSW5pdDtcbiAgICAgICAgZHRvLmxyID0gd2luZG93LmxvY2F0aW9uLmhyZWYgfHwgbnVsbDtcbiAgICAgICAgZHRvLmF0dHJzID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuQ3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgY29udmVydEN1c3RvbUZsYWdzKGV2ZW50LCBkdG8pO1xuICAgIH1cblxuICAgIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBNZXNzYWdlVHlwZS5Db21tZXJjZSkge1xuICAgICAgICBkdG8uY3UgPSBjdXJyZW5jeUNvZGU7XG5cbiAgICAgICAgaWYgKGV2ZW50LlNob3BwaW5nQ2FydCkge1xuICAgICAgICAgICAgZHRvLnNjID0ge1xuICAgICAgICAgICAgICAgIHBsOiBjb252ZXJ0UHJvZHVjdExpc3RUb0RUTyhldmVudC5TaG9wcGluZ0NhcnQuUHJvZHVjdExpc3QpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV2ZW50LlByb2R1Y3RBY3Rpb24pIHtcbiAgICAgICAgICAgIGR0by5wZCA9IHtcbiAgICAgICAgICAgICAgICBhbjogZXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSxcbiAgICAgICAgICAgICAgICBjczogcGFyc2VOdW1iZXIoZXZlbnQuUHJvZHVjdEFjdGlvbi5DaGVja291dFN0ZXApLFxuICAgICAgICAgICAgICAgIGNvOiBldmVudC5Qcm9kdWN0QWN0aW9uLkNoZWNrb3V0T3B0aW9ucyxcbiAgICAgICAgICAgICAgICBwbDogY29udmVydFByb2R1Y3RMaXN0VG9EVE8oZXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdCksXG4gICAgICAgICAgICAgICAgdGk6IGV2ZW50LlByb2R1Y3RBY3Rpb24uVHJhbnNhY3Rpb25JZCxcbiAgICAgICAgICAgICAgICB0YTogZXZlbnQuUHJvZHVjdEFjdGlvbi5BZmZpbGlhdGlvbixcbiAgICAgICAgICAgICAgICB0Y2M6IGV2ZW50LlByb2R1Y3RBY3Rpb24uQ291cG9uQ29kZSxcbiAgICAgICAgICAgICAgICB0cjogcGFyc2VOdW1iZXIoZXZlbnQuUHJvZHVjdEFjdGlvbi5Ub3RhbEFtb3VudCksXG4gICAgICAgICAgICAgICAgdHM6IHBhcnNlTnVtYmVyKGV2ZW50LlByb2R1Y3RBY3Rpb24uU2hpcHBpbmdBbW91bnQpLFxuICAgICAgICAgICAgICAgIHR0OiBwYXJzZU51bWJlcihldmVudC5Qcm9kdWN0QWN0aW9uLlRheEFtb3VudClcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoZXZlbnQuUHJvbW90aW9uQWN0aW9uKSB7XG4gICAgICAgICAgICBkdG8ucG0gPSB7XG4gICAgICAgICAgICAgICAgYW46IGV2ZW50LlByb21vdGlvbkFjdGlvbi5Qcm9tb3Rpb25BY3Rpb25UeXBlLFxuICAgICAgICAgICAgICAgIHBsOiBldmVudC5Qcm9tb3Rpb25BY3Rpb24uUHJvbW90aW9uTGlzdC5tYXAoZnVuY3Rpb24ocHJvbW90aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogcHJvbW90aW9uLklkLFxuICAgICAgICAgICAgICAgICAgICAgICAgbm06IHByb21vdGlvbi5OYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgY3I6IHByb21vdGlvbi5DcmVhdGl2ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBzOiBwcm9tb3Rpb24uUG9zaXRpb24gPyBwcm9tb3Rpb24uUG9zaXRpb24gOiAwXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoZXZlbnQuUHJvZHVjdEltcHJlc3Npb25zKSB7XG4gICAgICAgICAgICBkdG8ucGkgPSBldmVudC5Qcm9kdWN0SW1wcmVzc2lvbnMubWFwKGZ1bmN0aW9uKGltcHJlc3Npb24pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBwaWw6IGltcHJlc3Npb24uUHJvZHVjdEltcHJlc3Npb25MaXN0LFxuICAgICAgICAgICAgICAgICAgICBwbDogY29udmVydFByb2R1Y3RMaXN0VG9EVE8oaW1wcmVzc2lvbi5Qcm9kdWN0TGlzdClcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gTWVzc2FnZVR5cGUuUHJvZmlsZSkge1xuICAgICAgICBkdG8ucGV0ID0gZXZlbnQuUHJvZmlsZU1lc3NhZ2VUeXBlO1xuICAgIH1cblxuICAgIHJldHVybiBkdG87XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNyZWF0ZUV2ZW50T2JqZWN0OiBjcmVhdGVFdmVudE9iamVjdCxcbiAgICBjb252ZXJ0RXZlbnRUb0RUTzogY29udmVydEV2ZW50VG9EVE8sXG4gICAgY29udmVydFRvQ29uc2VudFN0YXRlRFRPOiBjb252ZXJ0VG9Db25zZW50U3RhdGVEVE9cbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIE1lc3NhZ2VzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKS5NZXNzYWdlcyxcbiAgICBUeXBlcyA9IHJlcXVpcmUoJy4vdHlwZXMnKSxcbiAgICBJZGVudGl0eUFQSSA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5JZGVudGl0eUFQSSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBsb2dFdmVudCA9IHJlcXVpcmUoJy4vZXZlbnRzJykubG9nRXZlbnQ7XG5cbmZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKE1QLnNlc3Npb25JZCkge1xuICAgICAgICB2YXIgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcyA9IE1QLkNvbmZpZy5TZXNzaW9uVGltZW91dCAqIDYwMDAwO1xuXG4gICAgICAgIGlmIChuZXcgRGF0ZSgpID4gbmV3IERhdGUoTVAuZGF0ZUxhc3RFdmVudFNlbnQuZ2V0VGltZSgpICsgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcykpIHtcbiAgICAgICAgICAgIHRoaXMuZW5kU2Vzc2lvbigpO1xuICAgICAgICAgICAgdGhpcy5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzID0gbVBhcnRpY2xlLnBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgICAgICBpZiAoY29va2llcyAmJiAhY29va2llcy5jdSkge1xuICAgICAgICAgICAgICAgIElkZW50aXR5QVBJLmlkZW50aWZ5KE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QsIG1QYXJ0aWNsZS5pZGVudGl0eUNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICBNUC5pZGVudGlmeUNhbGxlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldFNlc3Npb24oKSB7XG4gICAgcmV0dXJuIE1QLnNlc3Npb25JZDtcbn1cblxuZnVuY3Rpb24gc3RhcnROZXdTZXNzaW9uKCkge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ05ld1Nlc3Npb24pO1xuXG4gICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgTVAuc2Vzc2lvbklkID0gSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCkudG9VcHBlckNhc2UoKTtcbiAgICAgICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSBbTVAubXBpZF07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIU1QLnNlc3Npb25TdGFydERhdGUpIHtcbiAgICAgICAgICAgIHZhciBkYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIE1QLnNlc3Npb25TdGFydERhdGUgPSBkYXRlO1xuICAgICAgICAgICAgTVAuZGF0ZUxhc3RFdmVudFNlbnQgPSBkYXRlO1xuICAgICAgICB9XG5cbiAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgIGlmICghTVAuaWRlbnRpZnlDYWxsZWQpIHtcbiAgICAgICAgICAgIElkZW50aXR5QVBJLmlkZW50aWZ5KE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QsIG1QYXJ0aWNsZS5pZGVudGl0eUNhbGxiYWNrKTtcbiAgICAgICAgICAgIE1QLmlkZW50aWZ5Q2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5pZGVudGl0eUNhbGxiYWNrID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlNlc3Npb25TdGFydCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvblN0YXJ0U2Vzc2lvbik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBlbmRTZXNzaW9uKG92ZXJyaWRlKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nRW5kU2Vzc2lvbik7XG5cbiAgICBpZiAob3ZlcnJpZGUpIHtcbiAgICAgICAgbG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuU2Vzc2lvbkVuZCk7XG5cbiAgICAgICAgTVAuc2Vzc2lvbklkID0gbnVsbDtcbiAgICAgICAgTVAuZGF0ZUxhc3RFdmVudFNlbnQgPSBudWxsO1xuICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlcyA9IHt9O1xuICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICB9IGVsc2UgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgdmFyIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMsXG4gICAgICAgICAgICBjb29raWVzLFxuICAgICAgICAgICAgdGltZVNpbmNlTGFzdEV2ZW50U2VudDtcblxuICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgaWYgKCFjb29raWVzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29va2llcy5ncyAmJiAhY29va2llcy5ncy5zaWQpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Ob1Nlc3Npb25Ub0VuZCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBzZXNzaW9uSWQgaXMgbm90IGVxdWFsIHRvIGNvb2tpZXMuc2lkIGlmIGNvb2tpZXMuc2lkIGlzIGNoYW5nZWQgaW4gYW5vdGhlciB0YWJcbiAgICAgICAgaWYgKGNvb2tpZXMuZ3Muc2lkICYmIE1QLnNlc3Npb25JZCAhPT0gY29va2llcy5ncy5zaWQpIHtcbiAgICAgICAgICAgIE1QLnNlc3Npb25JZCA9IGNvb2tpZXMuZ3Muc2lkO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvb2tpZXMuZ3MgJiYgY29va2llcy5ncy5sZXMpIHtcbiAgICAgICAgICAgIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMgPSBNUC5Db25maWcuU2Vzc2lvblRpbWVvdXQgKiA2MDAwMDtcbiAgICAgICAgICAgIHZhciBuZXdEYXRlID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gICAgICAgICAgICB0aW1lU2luY2VMYXN0RXZlbnRTZW50ID0gbmV3RGF0ZSAtIGNvb2tpZXMuZ3MubGVzO1xuXG4gICAgICAgICAgICBpZiAodGltZVNpbmNlTGFzdEV2ZW50U2VudCA8IHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMpIHtcbiAgICAgICAgICAgICAgICBzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuU2Vzc2lvbkVuZCk7XG5cbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uSWQgPSBudWxsO1xuICAgICAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbnVsbDtcbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbnVsbDtcbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlcyA9IHt9O1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25FbmRTZXNzaW9uKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldFNlc3Npb25UaW1lcigpIHtcbiAgICB2YXIgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcyA9IE1QLkNvbmZpZy5TZXNzaW9uVGltZW91dCAqIDYwMDAwO1xuXG4gICAgTVAuZ2xvYmFsVGltZXIgPSB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLmVuZFNlc3Npb24oKTtcbiAgICB9LCBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzKTtcbn1cblxuZnVuY3Rpb24gcmVzZXRTZXNzaW9uVGltZXIoKSB7XG4gICAgaWYgKCFNUC53ZWJ2aWV3QnJpZGdlRW5hYmxlZCkge1xuICAgICAgICBpZiAoIU1QLnNlc3Npb25JZCkge1xuICAgICAgICAgICAgc3RhcnROZXdTZXNzaW9uKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2xlYXJTZXNzaW9uVGltZW91dCgpO1xuICAgICAgICBzZXRTZXNzaW9uVGltZXIoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNsZWFyU2Vzc2lvblRpbWVvdXQoKSB7XG4gICAgY2xlYXJUaW1lb3V0KE1QLmdsb2JhbFRpbWVyKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaW5pdGlhbGl6ZTogaW5pdGlhbGl6ZSxcbiAgICBnZXRTZXNzaW9uOiBnZXRTZXNzaW9uLFxuICAgIHN0YXJ0TmV3U2Vzc2lvbjogc3RhcnROZXdTZXNzaW9uLFxuICAgIGVuZFNlc3Npb246IGVuZFNlc3Npb24sXG4gICAgc2V0U2Vzc2lvblRpbWVyOiBzZXRTZXNzaW9uVGltZXIsXG4gICAgcmVzZXRTZXNzaW9uVGltZXI6IHJlc2V0U2Vzc2lvblRpbWVyLFxuICAgIGNsZWFyU2Vzc2lvblRpbWVvdXQ6IGNsZWFyU2Vzc2lvblRpbWVvdXRcbn07XG4iLCJ2YXIgTWVzc2FnZVR5cGUgPSB7XG4gICAgU2Vzc2lvblN0YXJ0OiAxLFxuICAgIFNlc3Npb25FbmQ6IDIsXG4gICAgUGFnZVZpZXc6IDMsXG4gICAgUGFnZUV2ZW50OiA0LFxuICAgIENyYXNoUmVwb3J0OiA1LFxuICAgIE9wdE91dDogNixcbiAgICBBcHBTdGF0ZVRyYW5zaXRpb246IDEwLFxuICAgIFByb2ZpbGU6IDE0LFxuICAgIENvbW1lcmNlOiAxNlxufTtcblxudmFyIEV2ZW50VHlwZSA9IHtcbiAgICBVbmtub3duOiAwLFxuICAgIE5hdmlnYXRpb246IDEsXG4gICAgTG9jYXRpb246IDIsXG4gICAgU2VhcmNoOiAzLFxuICAgIFRyYW5zYWN0aW9uOiA0LFxuICAgIFVzZXJDb250ZW50OiA1LFxuICAgIFVzZXJQcmVmZXJlbmNlOiA2LFxuICAgIFNvY2lhbDogNyxcbiAgICBPdGhlcjogOCxcbiAgICBnZXROYW1lOiBmdW5jdGlvbihpZCkge1xuICAgICAgICBzd2l0Y2ggKGlkKSB7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5OYXZpZ2F0aW9uOlxuICAgICAgICAgICAgICAgIHJldHVybiAnTmF2aWdhdGlvbic7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5Mb2NhdGlvbjpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ0xvY2F0aW9uJztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLlNlYXJjaDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1NlYXJjaCc7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5UcmFuc2FjdGlvbjpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1RyYW5zYWN0aW9uJztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLlVzZXJDb250ZW50OlxuICAgICAgICAgICAgICAgIHJldHVybiAnVXNlciBDb250ZW50JztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLlVzZXJQcmVmZXJlbmNlOlxuICAgICAgICAgICAgICAgIHJldHVybiAnVXNlciBQcmVmZXJlbmNlJztcbiAgICAgICAgICAgIGNhc2UgRXZlbnRUeXBlLlNvY2lhbDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1NvY2lhbCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RBZGRUb0NhcnQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IEFkZGVkIHRvIENhcnQnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0QWRkVG9XaXNobGlzdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgQWRkZWQgdG8gV2lzaGxpc3QnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2hlY2tvdXQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IENoZWNrb3V0JztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENoZWNrb3V0T3B0aW9uOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBDaGVja291dCBPcHRpb25zJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENsaWNrOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBDbGljayc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RJbXByZXNzaW9uOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBJbXByZXNzaW9uJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFB1cmNoYXNlOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBQdXJjaGFzZWQnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVmdW5kOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBSZWZ1bmRlZCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgUmVtb3ZlZCBGcm9tIENhcnQnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVtb3ZlRnJvbVdpc2hsaXN0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBSZW1vdmVkIGZyb20gV2lzaGxpc3QnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Vmlld0RldGFpbDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgVmlldyBEZXRhaWxzJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb24gQ2xpY2snO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvbW90aW9uIFZpZXcnO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ090aGVyJztcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbi8vIENvbnRpbnVhdGlvbiBvZiBlbnVtIGFib3ZlLCBidXQgaW4gc2VwZXJhdGUgb2JqZWN0IHNpbmNlIHdlIGRvbid0IGV4cG9zZSB0aGVzZSB0byBlbmQgdXNlclxudmFyIENvbW1lcmNlRXZlbnRUeXBlID0ge1xuICAgIFByb2R1Y3RBZGRUb0NhcnQ6IDEwLFxuICAgIFByb2R1Y3RSZW1vdmVGcm9tQ2FydDogMTEsXG4gICAgUHJvZHVjdENoZWNrb3V0OiAxMixcbiAgICBQcm9kdWN0Q2hlY2tvdXRPcHRpb246IDEzLFxuICAgIFByb2R1Y3RDbGljazogMTQsXG4gICAgUHJvZHVjdFZpZXdEZXRhaWw6IDE1LFxuICAgIFByb2R1Y3RQdXJjaGFzZTogMTYsXG4gICAgUHJvZHVjdFJlZnVuZDogMTcsXG4gICAgUHJvbW90aW9uVmlldzogMTgsXG4gICAgUHJvbW90aW9uQ2xpY2s6IDE5LFxuICAgIFByb2R1Y3RBZGRUb1dpc2hsaXN0OiAyMCxcbiAgICBQcm9kdWN0UmVtb3ZlRnJvbVdpc2hsaXN0OiAyMSxcbiAgICBQcm9kdWN0SW1wcmVzc2lvbjogMjJcbn07XG5cbnZhciBJZGVudGl0eVR5cGUgPSB7XG4gICAgT3RoZXI6IDAsXG4gICAgQ3VzdG9tZXJJZDogMSxcbiAgICBGYWNlYm9vazogMixcbiAgICBUd2l0dGVyOiAzLFxuICAgIEdvb2dsZTogNCxcbiAgICBNaWNyb3NvZnQ6IDUsXG4gICAgWWFob286IDYsXG4gICAgRW1haWw6IDcsXG4gICAgRmFjZWJvb2tDdXN0b21BdWRpZW5jZUlkOiA5LFxuICAgIE90aGVyMjogMTAsXG4gICAgT3RoZXIzOiAxMSxcbiAgICBPdGhlcjQ6IDEyXG59O1xuXG5JZGVudGl0eVR5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKGlkZW50aXR5VHlwZSkge1xuICAgIGlmICh0eXBlb2YgaWRlbnRpdHlUeXBlID09PSAnbnVtYmVyJykge1xuICAgICAgICBmb3IgKHZhciBwcm9wIGluIElkZW50aXR5VHlwZSkge1xuICAgICAgICAgICAgaWYgKElkZW50aXR5VHlwZS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgIGlmIChJZGVudGl0eVR5cGVbcHJvcF0gPT09IGlkZW50aXR5VHlwZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59O1xuXG5JZGVudGl0eVR5cGUuZ2V0TmFtZSA9IGZ1bmN0aW9uKGlkZW50aXR5VHlwZSkge1xuICAgIHN3aXRjaCAoaWRlbnRpdHlUeXBlKSB7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuQ3VzdG9tZXJJZDpcbiAgICAgICAgICAgIHJldHVybiAnQ3VzdG9tZXIgSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLkZhY2Vib29rOlxuICAgICAgICAgICAgcmV0dXJuICdGYWNlYm9vayBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuVHdpdHRlcjpcbiAgICAgICAgICAgIHJldHVybiAnVHdpdHRlciBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuR29vZ2xlOlxuICAgICAgICAgICAgcmV0dXJuICdHb29nbGUgSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLk1pY3Jvc29mdDpcbiAgICAgICAgICAgIHJldHVybiAnTWljcm9zb2Z0IElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5ZYWhvbzpcbiAgICAgICAgICAgIHJldHVybiAnWWFob28gSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLkVtYWlsOlxuICAgICAgICAgICAgcmV0dXJuICdFbWFpbCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuRmFjZWJvb2tDdXN0b21BdWRpZW5jZUlkOlxuICAgICAgICAgICAgcmV0dXJuICdGYWNlYm9vayBBcHAgVXNlciBJRCc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ090aGVyIElEJztcbiAgICB9XG59O1xuXG5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlUeXBlID0gZnVuY3Rpb24oaWRlbnRpdHlOYW1lKSB7XG4gICAgc3dpdGNoIChpZGVudGl0eU5hbWUpIHtcbiAgICAgICAgY2FzZSAnb3RoZXInOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5PdGhlcjtcbiAgICAgICAgY2FzZSAnY3VzdG9tZXJpZCc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLkN1c3RvbWVySWQ7XG4gICAgICAgIGNhc2UgJ2ZhY2Vib29rJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuRmFjZWJvb2s7XG4gICAgICAgIGNhc2UgJ3R3aXR0ZXInOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5Ud2l0dGVyO1xuICAgICAgICBjYXNlICdnb29nbGUnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5Hb29nbGU7XG4gICAgICAgIGNhc2UgJ21pY3Jvc29mdCc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk1pY3Jvc29mdDtcbiAgICAgICAgY2FzZSAneWFob28nOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5ZYWhvbztcbiAgICAgICAgY2FzZSAnZW1haWwnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5FbWFpbDtcbiAgICAgICAgY2FzZSAnZmFjZWJvb2tjdXN0b21hdWRpZW5jZWlkJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuRmFjZWJvb2tDdXN0b21BdWRpZW5jZUlkO1xuICAgICAgICBjYXNlICdvdGhlcjEnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5PdGhlcjE7XG4gICAgICAgIGNhc2UgJ290aGVyMic6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk90aGVyMjtcbiAgICAgICAgY2FzZSAnb3RoZXIzJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuT3RoZXIzO1xuICAgICAgICBjYXNlICdvdGhlcjQnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5PdGhlcjQ7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufTtcblxuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5TmFtZSA9IGZ1bmN0aW9uKGlkZW50aXR5VHlwZSkge1xuICAgIHN3aXRjaCAoaWRlbnRpdHlUeXBlKSB7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk90aGVyOlxuICAgICAgICAgICAgcmV0dXJuICdvdGhlcic7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLkN1c3RvbWVySWQ6XG4gICAgICAgICAgICByZXR1cm4gJ2N1c3RvbWVyaWQnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5GYWNlYm9vazpcbiAgICAgICAgICAgIHJldHVybiAnZmFjZWJvb2snO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5Ud2l0dGVyOlxuICAgICAgICAgICAgcmV0dXJuICd0d2l0dGVyJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuR29vZ2xlOlxuICAgICAgICAgICAgcmV0dXJuICdnb29nbGUnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5NaWNyb3NvZnQ6XG4gICAgICAgICAgICByZXR1cm4gJ21pY3Jvc29mdCc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLllhaG9vOlxuICAgICAgICAgICAgcmV0dXJuICd5YWhvbyc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLkVtYWlsOlxuICAgICAgICAgICAgcmV0dXJuICdlbWFpbCc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLkZhY2Vib29rQ3VzdG9tQXVkaWVuY2VJZDpcbiAgICAgICAgICAgIHJldHVybiAnZmFjZWJvb2tjdXN0b21hdWRpZW5jZWlkJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuT3RoZXIxOlxuICAgICAgICAgICAgcmV0dXJuICdvdGhlcjEnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5PdGhlcjI6XG4gICAgICAgICAgICByZXR1cm4gJ290aGVyMic7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk90aGVyMzpcbiAgICAgICAgICAgIHJldHVybiAnb3RoZXIzJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuT3RoZXI0OlxuICAgICAgICAgICAgcmV0dXJuICdvdGhlcjQnO1xuICAgIH1cbn07XG5cbnZhciBQcm9kdWN0QWN0aW9uVHlwZSA9IHtcbiAgICBVbmtub3duOiAwLFxuICAgIEFkZFRvQ2FydDogMSxcbiAgICBSZW1vdmVGcm9tQ2FydDogMixcbiAgICBDaGVja291dDogMyxcbiAgICBDaGVja291dE9wdGlvbjogNCxcbiAgICBDbGljazogNSxcbiAgICBWaWV3RGV0YWlsOiA2LFxuICAgIFB1cmNoYXNlOiA3LFxuICAgIFJlZnVuZDogOCxcbiAgICBBZGRUb1dpc2hsaXN0OiA5LFxuICAgIFJlbW92ZUZyb21XaXNobGlzdDogMTBcbn07XG5cblByb2R1Y3RBY3Rpb25UeXBlLmdldE5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5BZGRUb0NhcnQ6XG4gICAgICAgICAgICByZXR1cm4gJ0FkZCB0byBDYXJ0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlIGZyb20gQ2FydCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQ6XG4gICAgICAgICAgICByZXR1cm4gJ0NoZWNrb3V0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dE9wdGlvbjpcbiAgICAgICAgICAgIHJldHVybiAnQ2hlY2tvdXQgT3B0aW9uJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnQ2xpY2snO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gJ1ZpZXcgRGV0YWlsJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5QdXJjaGFzZTpcbiAgICAgICAgICAgIHJldHVybiAnUHVyY2hhc2UnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZDpcbiAgICAgICAgICAgIHJldHVybiAnUmVmdW5kJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5BZGRUb1dpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdBZGQgdG8gV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlIGZyb20gV2lzaGxpc3QnO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICdVbmtub3duJztcbiAgICB9XG59O1xuXG4vLyB0aGVzZSBhcmUgdGhlIGFjdGlvbiBuYW1lcyB1c2VkIGJ5IHNlcnZlciBhbmQgbW9iaWxlIFNES3Mgd2hlbiBleHBhbmRpbmcgYSBDb21tZXJjZUV2ZW50XG5Qcm9kdWN0QWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lID0gZnVuY3Rpb24oaWQpIHtcbiAgICBzd2l0Y2ggKGlkKSB7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdhZGRfdG9fY2FydCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbUNhcnQ6XG4gICAgICAgICAgICByZXR1cm4gJ3JlbW92ZV9mcm9tX2NhcnQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuICdjaGVja291dCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICByZXR1cm4gJ2NoZWNrb3V0X29wdGlvbic7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ2NsaWNrJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5WaWV3RGV0YWlsOlxuICAgICAgICAgICAgcmV0dXJuICd2aWV3X2RldGFpbCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUHVyY2hhc2U6XG4gICAgICAgICAgICByZXR1cm4gJ3B1cmNoYXNlJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZWZ1bmQ6XG4gICAgICAgICAgICByZXR1cm4gJ3JlZnVuZCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAnYWRkX3RvX3dpc2hsaXN0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ3JlbW92ZV9mcm9tX3dpc2hsaXN0JztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgfVxufTtcblxudmFyIFByb21vdGlvbkFjdGlvblR5cGUgPSB7XG4gICAgVW5rbm93bjogMCxcbiAgICBQcm9tb3Rpb25WaWV3OiAxLFxuICAgIFByb21vdGlvbkNsaWNrOiAyXG59O1xuXG5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldE5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvblZpZXc6XG4gICAgICAgICAgICByZXR1cm4gJ3ZpZXcnO1xuICAgICAgICBjYXNlIFByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ2NsaWNrJztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgfVxufTtcblxuLy8gdGhlc2UgYXJlIHRoZSBuYW1lcyB0aGF0IHRoZSBzZXJ2ZXIgYW5kIG1vYmlsZSBTREtzIHVzZSB3aGlsZSBleHBhbmRpbmcgQ29tbWVyY2VFdmVudFxuUHJvbW90aW9uQWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lID0gZnVuY3Rpb24oaWQpIHtcbiAgICBzd2l0Y2ggKGlkKSB7XG4gICAgICAgIGNhc2UgUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgcmV0dXJuICd2aWV3JztcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuICdjbGljayc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgIH1cbn07XG5cbnZhciBQcm9maWxlTWVzc2FnZVR5cGUgPSB7XG4gICAgTG9nb3V0OiAzXG59O1xudmFyIEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUgPSB7XG4gICAgQXBwSW5pdDogMVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgTWVzc2FnZVR5cGU6IE1lc3NhZ2VUeXBlLFxuICAgIEV2ZW50VHlwZTogRXZlbnRUeXBlLFxuICAgIENvbW1lcmNlRXZlbnRUeXBlOiBDb21tZXJjZUV2ZW50VHlwZSxcbiAgICBJZGVudGl0eVR5cGU6IElkZW50aXR5VHlwZSxcbiAgICBQcm9maWxlTWVzc2FnZVR5cGU6IFByb2ZpbGVNZXNzYWdlVHlwZSxcbiAgICBBcHBsaWNhdGlvblRyYW5zaXRpb25UeXBlOiBBcHBsaWNhdGlvblRyYW5zaXRpb25UeXBlLFxuICAgIFByb2R1Y3RBY3Rpb25UeXBlOlByb2R1Y3RBY3Rpb25UeXBlLFxuICAgIFByb21vdGlvbkFjdGlvblR5cGU6UHJvbW90aW9uQWN0aW9uVHlwZVxufTtcbiJdfQ==
