(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    HTTPCodes = Constants.HTTPCodes,
    MP = require('./mp'),
    ServerModel = require('./serverModel'),
    Types = require('./types'),
    Messages = Constants.Messages;

function sendEventToServer(event, sendEventToForwarders, parseEventResponse) {
    if (Helpers.shouldUseNativeSdk()) {
        Helpers.sendToNative(Constants.NativeSdkPaths.LogEvent, JSON.stringify(event));
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

        // When there is no MPID (MPID is null, or === 0), we queue events until we have a valid MPID
        if (!MP.mpid) {
            Helpers.logDebug('Event was added to eventQueue. eventQueue will be processed once a valid MPID is returned');
            MP.eventQueue.push(event);
        } else {
            if (!event) {
                Helpers.logDebug(Messages.ErrorMessages.EventEmpty);
                return;
            }

            Helpers.logDebug(Messages.InformationMessages.SendHttp);

            xhr = Helpers.createXHR(xhrCallback);

            if (xhr) {
                try {
                    xhr.open('post', Helpers.createServiceUrl(Constants.v2SecureServiceUrl, Constants.v2ServiceUrl, MP.devToken) + '/Events');
                    xhr.send(JSON.stringify(ServerModel.convertEventToDTO(event, MP.isFirstRun, MP.currencyCode)));

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

},{"./constants":3,"./helpers":9,"./mp":14,"./serverModel":17,"./types":19}],2:[function(require,module,exports){
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
    sdkVersion = '2.6.3',
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
        MaxCookieSize: 3000                         // Number of bytes for cookie size to not exceed
    },
    Base64CookieKeys = {
        csm: 1,
        sa: 1,
        ss: 1,
        ua: 1,
        ui: 1,
        csd: 1,
        con: 1
    },
    SDKv2NonMPIDCookieKeys = {
        gs: 1,
        cu: 1,
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
        if (mpid && !Helpers.shouldUseNativeSdk()) {
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

},{"./constants":3,"./helpers":9,"./mp":14,"./persistence":15}],5:[function(require,module,exports){
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

},{"./constants":3,"./helpers":9,"./mp":14,"./serverModel":17,"./types":19}],6:[function(require,module,exports){
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
        if (Helpers.shouldUseNativeSdk()) {
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
    if (!Helpers.shouldUseNativeSdk()) {
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

},{"./apiClient":1,"./constants":3,"./ecommerce":5,"./forwarders":7,"./helpers":9,"./mp":14,"./persistence":15,"./serverModel":17,"./types":19}],7:[function(require,module,exports){
var Helpers = require('./helpers'),
    Types = require('./types'),
    Constants = require('./constants'),
    MParticleUser = require('./mParticleUser'),
    ApiClient = require('./apiClient'),
    Persistence = require('./persistence'),
    MP = require('./mp');

function initForwarders(userIdentities) {
    if (!Helpers.shouldUseNativeSdk() && MP.configuredForwarders) {
        // Some js libraries require that they be loaded first, or last, etc
        MP.configuredForwarders.sort(function(x, y) {
            x.settings.PriorityValue = x.settings.PriorityValue || 0;
            y.settings.PriorityValue = y.settings.PriorityValue || 0;
            return -1 * (x.settings.PriorityValue - y.settings.PriorityValue);
        });

        MP.activeForwarders = MP.configuredForwarders.filter(function(forwarder) {
            if (!isEnabledForUserConsent(forwarder.filteringConsentRuleValues, mParticle.Identity.getCurrentUser())) {
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
        filterUserAttributeValues = function(event, filterObject) {
            var attrHash,
                valueHash,
                match = false;

            try {
                if (event.UserAttributes && Helpers.isObject(event.UserAttributes) && Object.keys(event.UserAttributes).length) {
                    if (filterObject && Helpers.isObject(filterObject) && Object.keys(filterObject).length) {
                        for (var attrName in event.UserAttributes) {
                            if (event.UserAttributes.hasOwnProperty(attrName)) {
                                attrHash = Helpers.generateHash(attrName).toString();
                                valueHash = Helpers.generateHash(event.UserAttributes[attrName]).toString();

                                if ((attrHash === filterObject.userAttributeName) && (valueHash === filterObject.userAttributeValue)) {
                                    match = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (match) {
                    if (filterObject.includeOnMatch) {
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    if (filterObject.includeOnMatch) {
                        return false;
                    } else {
                        return true;
                    }
                }
            } catch (e) {
                // in any error scenario, err on side of returning true and forwarding event
                return true;
            }
        },
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

    if (!Helpers.shouldUseNativeSdk() && MP.activeForwarders) {
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

            // Check user attribute value filtering rules
            if (MP.activeForwarders[i].filteringUserAttributeValue && Object.keys(MP.activeForwarders[i].filteringUserAttributeValue).length) {
                if (!filterUserAttributeValues(clonedEvent, MP.activeForwarders[i].filteringUserAttributeValue)) {
                    continue;
                }
            }

            Helpers.logDebug('Sending message to forwarder: ' + MP.activeForwarders[i].name);
            var result = MP.activeForwarders[i].process(clonedEvent);

            if (result) {
                Helpers.logDebug(result);
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
    prepareForwardingStats: prepareForwardingStats,
    getForwarderStatsQueue: getForwarderStatsQueue,
    setForwarderStatsQueue: setForwarderStatsQueue,
    isEnabledForUserConsent: isEnabledForUserConsent
};

},{"./apiClient":1,"./constants":3,"./helpers":9,"./mParticleUser":11,"./mp":14,"./persistence":15,"./types":19}],8:[function(require,module,exports){
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

},{"./apiClient":1,"./forwarders":7,"./helpers":9,"./mp":14,"./persistence":15}],9:[function(require,module,exports){
var Types = require('./types'),
    Constants = require('./constants'),
    Messages = Constants.Messages,
    MP = require('./mp'),
    pluses = /\+/g,
    serviceScheme = window.mParticle && window.mParticle.forceHttps ? 'https://' : window.location.protocol + '//';

function logDebug(msg) {
    if (MP.Config.LogLevel === 'verbose' && window.console && window.console.log) {
        window.console.log(msg);
    }
}

function canLog() {
    if (MP.isEnabled && (MP.devToken || shouldUseNativeSdk())) {
        return true;
    }

    return false;
}

function hasFeatureFlag(feature) {
    return MP.featureFlags[feature];
}

function invokeCallback(callback, code, body) {
    try {
        if (Validators.isFunction(callback)) {
            callback({
                httpCode: code,
                body: body
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

function sendToNative(path, value) {
    if (window.mParticleAndroid && window.mParticleAndroid.hasOwnProperty(path)) {
        logDebug(Messages.InformationMessages.SendAndroid + path);
        window.mParticleAndroid[path](value);
    }
    else if (window.mParticle.isIOS) {
        logDebug(Messages.InformationMessages.SendIOS + path);
        var iframe = document.createElement('IFRAME');
        iframe.setAttribute('src', 'mp-sdk://' + path + '/' + encodeURIComponent(value));
        document.documentElement.appendChild(iframe);
        iframe.parentNode.removeChild(iframe);
        iframe = null;
    }
}

function createServiceUrl(secureServiceUrl, serviceUrl, devToken) {
    if (mParticle.forceHttps) {
        return 'https://' + secureServiceUrl + devToken;
    } else {
        return serviceScheme + ((window.location.protocol === 'https:') ? secureServiceUrl : serviceUrl) + devToken;
    }
}

function shouldUseNativeSdk() {
    if (mParticle.useNativeSdk || window.mParticleAndroid
        || window.mParticle.isIOS) {
        return true;
    }

    return false;
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
    if (window.crypto && window.crypto.getRandomValues) {
        return (a ^ window.crypto.getRandomValues(new Uint8Array(1))[0] % 16 >> a/4).toString(16); // eslint-disable-line no-undef
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

    if (!name) {
        return null;
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

module.exports = {
    logDebug: logDebug,
    canLog: canLog,
    extend: extend,
    isObject: isObject,
    inArray: inArray,
    shouldUseNativeSdk: shouldUseNativeSdk,
    sendToNative: sendToNative,
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
    invokeCallback: invokeCallback,
    hasFeatureFlag: hasFeatureFlag,
    Validators: Validators
};

},{"./constants":3,"./mp":14,"./types":19}],10:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    ServerModel = require('./serverModel'),
    Forwarders = require('./forwarders'),
    Persistence = require('./persistence'),
    Types = require('./types'),
    Messages = Constants.Messages,
    MP = require('./mp'),
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
                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.Identify, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
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
                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.Logout, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
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
                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.Login, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
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
                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.Modify, JSON.stringify(IdentityRequest.convertToNative(identityApiData)));
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
            return mParticleUser(mpid);
        } else if (Helpers.shouldUseNativeSdk()) {
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
        if (cookies[mpid] && !Constants.SDKv2NonMPIDCookieKeys.hasOwnProperty(mpid)) {
            return mParticleUser(mpid);
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
        for (var key in cookies) {
            if (!Constants.SDKv2NonMPIDCookieKeys.hasOwnProperty(key)) {
                users.push(mParticleUser(key));
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
function mParticleUser(mpid) {
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
                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.SetUserAttribute, JSON.stringify({ key: key, value: value }));
                } else {
                    cookies = Persistence.getPersistence();

                    userAttributes = this.getAllUserAttributes();

                    var existingProp = Helpers.findKeyInObject(userAttributes, key);

                    if (existingProp) {
                        delete userAttributes[existingProp];
                    }

                    userAttributes[key] = value;
                    cookies[mpid].ua = userAttributes;
                    Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                    Persistence.storeDataInMemory(cookies, mpid);

                    Forwarders.callSetUserAttributeOnForwarders(key, value);
                }
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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.RemoveUserAttribute, JSON.stringify({ key: key, value: null }));
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                var existingProp = Helpers.findKeyInObject(userAttributes, key);

                if (existingProp) {
                    key = existingProp;
                }

                delete userAttributes[key];

                cookies[mpid].ua = userAttributes;
                Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                Persistence.storeDataInMemory(cookies, mpid);

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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.SetUserAttributeList, JSON.stringify({ key: key, value: arrayCopy }));
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                var existingProp = Helpers.findKeyInObject(userAttributes, key);

                if (existingProp) {
                    delete userAttributes[existingProp];
                }

                userAttributes[key] = arrayCopy;
                cookies[mpid].ua = userAttributes;
                Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                Persistence.storeDataInMemory(cookies, mpid);

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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.RemoveAllUserAttributes);
            } else {
                cookies = Persistence.getPersistence();

                userAttributes = this.getAllUserAttributes();

                if (userAttributes) {
                    for (var prop in userAttributes) {
                        if (userAttributes.hasOwnProperty(prop)) {
                            Forwarders.applyToForwarders('removeUserAttribute', prop);
                        }
                    }
                }

                cookies[mpid].ua = {};
                Persistence.updateOnlyCookieUserAttributes(cookies, mpid);
                Persistence.storeDataInMemory(cookies, mpid);
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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.AddToCart, JSON.stringify(arrayCopy));
            } else {
                mParticle.sessionManager.resetSessionTimer();

                product.Attributes = Helpers.sanitizeAttributes(product.Attributes);
                arrayCopy = Array.isArray(product) ? product.slice() : [product];


                allProducts = JSON.parse(Persistence.getLocalStorageProducts());

                if (allProducts && !allProducts[mpid]) {
                    allProducts[mpid] = {};
                }

                if (allProducts[mpid].cp) {
                    userProducts = allProducts[mpid].cp;
                } else {
                    userProducts = [];
                }

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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.RemoveFromCart, JSON.stringify(cartItem));
            } else {
                mParticle.sessionManager.resetSessionTimer();

                allProducts = JSON.parse(Persistence.getLocalStorageProducts());

                if (allProducts && allProducts[mpid].cp) {
                    userProducts = allProducts[mpid].cp;
                } else {
                    userProducts = [];
                }

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

            if (Helpers.shouldUseNativeSdk()) {
                Helpers.sendToNative(Constants.NativeSdkPaths.ClearCart);
            } else {
                mParticle.sessionManager.resetSessionTimer();
                allProducts = JSON.parse(Persistence.getLocalStorageProducts());

                if (allProducts && allProducts[mpid].cp) {
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

                // events exist in the eventQueue because they were triggered when the identityAPI request was in flight
                // once API request returns and there is an MPID, eventQueue items are reassigned with the returned MPID and flushed
                if (MP.eventQueue.length && MP.mpid) {
                    MP.eventQueue.forEach(function(event) {
                        event.MPID = MP.mpid;
                        sendEventToServer(event, sendEventToForwarders, Events.parseEventResponse);
                    });
                    MP.eventQueue = [];
                }

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
                if (!prevUser || newUser.getMPID() !== prevUser.getMPID()) {
                    Forwarders.initForwarders(newUser.getUserIdentities().userIdentities);
                }
                Forwarders.setForwarderUserIdentities(newUser.getUserIdentities().userIdentities);
                Forwarders.setForwarderOnUserIdentified(newUser);
            }
        }

        if (callback) {
            Helpers.invokeCallback(callback, xhr.status, identityApiResult || null);
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
    mParticleUserCart: mParticleUserCart
};

},{"./apiClient":1,"./constants":3,"./cookieSyncManager":4,"./events":6,"./forwarders":7,"./helpers":9,"./mp":14,"./persistence":15,"./serverModel":17,"./types":19}],11:[function(require,module,exports){
var Persistence = require('./persistence'),
    Types = require('./types'),
    Helpers = require('./helpers');

function getFilteredMparticleUser(mpid, forwarder) {
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

            currentUserIdentities = Helpers.filterUserIdentitiesForForwarders(currentUserIdentities, forwarder.userIdentityFilters);

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
        * Returns all user attribute keys that have values that are arrays
        * @method getUserAttributesLists
        * @return {Object} an object of only keys with array values. Example: { attr1: [1, 2, 3], attr2: ['a', 'b', 'c'] }
        */
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

            userAttributesCopy = Helpers.filterUserAttributes(userAttributesCopy, forwarder.userAttributeFilters);

            return userAttributesCopy;
        }
    };
}

module.exports = {
    getFilteredMparticleUser: getFilteredMparticleUser
};

},{"./helpers":9,"./persistence":15,"./types":19}],12:[function(require,module,exports){
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
            if (!Helpers.shouldUseNativeSdk()) {
                var config;

                MP.initialIdentifyRequest = mParticle.identifyRequest;
                MP.devToken = apiKey || null;
                Helpers.logDebug(Messages.InformationMessages.StartingInitialization);

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

                // Call mParticle.identityCallback when identify was not called due to a reload or a sessionId already existing
                if (!MP.identifyCalled && mParticle.identityCallback && MP.mpid && mParticle.Identity.getCurrentUser()) {
                    mParticle.identityCallback({
                        httpCode: HTTPCodes.activeSession,
                        body: {
                            mpid: MP.mpid,
                            matched_identities: mParticle.Identity.getCurrentUser() ? mParticle.Identity.getCurrentUser().getUserIdentities().userIdentities : {},
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
        * @method mParticle.setSessionAttribute
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

                if (Helpers.shouldUseNativeSdk()) {
                    Helpers.sendToNative(Constants.NativeSdkPaths.SetSessionAttribute, JSON.stringify({ key: key, value: value }));
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
        _configureFeatures: function(featureFlags) {
            for (var key in featureFlags) {
                if (featureFlags.hasOwnProperty(key)) {
                    MP.featureFlags[key] = featureFlags[key];
                }
            }
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

        if (window.mParticle.config.hasOwnProperty('isDevelopmentMode')) {
            mParticle.isDevelopmentMode = window.mParticle.config.isDevelopmentMode;
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
    }
    window.mParticle = mParticle;
})(window);

},{"./consent":2,"./constants":3,"./cookieSyncManager":4,"./ecommerce":5,"./events":6,"./forwarders":7,"./forwardingStatsUploader":8,"./helpers":9,"./identity":10,"./migrations":13,"./mp":14,"./persistence":15,"./polyfill":16,"./sessionManager":18,"./types":19}],13:[function(require,module,exports){
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
    migrateCookies();
    migrateLocalStorage();
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

        localStorage.setItem(Config.LocalStorageProductsV4, Base64.encode(JSON.stringify(localStorageProducts)));

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
    var localStorageProducts = {};
    localStorageProducts[mpid] = {};
    if (cookies.cp) {
        try {
            localStorageProducts[mpid].cp = JSON.parse(Base64.decode(cookies.cp));
        }
        catch (e) {
            localStorageProducts[mpid].cp = cookies.cp;
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
            if ((v3LSData.cp || v3LSData.pb) && v3LSData.mpid) {
                v3LSData = JSON.parse(convertSDKv1CookiesV3ToSDKv2CookiesV4(v3LSDataStringCopy));
                finishLSMigration(JSON.stringify(v3LSData), v3LSName);
                return;
            // if no MPID, it is only the products
            } else if ((v3LSData.cp || v3LSData.pb) && !v3LSData.mpid) {
                cookies = Persistence.getCookie();
                migrateProductsFromSDKv1ToSDKv2CookiesV4(v3LSData, cookies.cu);
                localStorage.removeItem(Config.LocalStorageNameV3);
                return;
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
                    migrateProductsFromSDKv1ToSDKv2CookiesV4(v1LSData, cookies.cu);
                    window.localStorage.removeItem(v1LSName);
                    return;
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

},{"./constants":3,"./helpers":9,"./mp":14,"./persistence":15,"./polyfill":16,"./types":19}],14:[function(require,module,exports){
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
    Config: {},
    migratingToIDSyncCookies: false,
    nonCurrentUserMPIDs: {},
    identifyCalled: false,
    featureFlags: {
        batching: false
    }
};

},{}],15:[function(require,module,exports){
var Helpers = require('./helpers'),
    Constants = require('./constants'),
    Base64 = require('./polyfill').Base64,
    Messages = Constants.Messages,
    MP = require('./mp'),
    Base64CookieKeys = Constants.Base64CookieKeys,
    SDKv2NonMPIDCookieKeys = Constants.SDKv2NonMPIDCookieKeys,
    Consent = require('./consent');

function useLocalStorage() {
    return (!mParticle.useCookieStorage && determineLocalStorageAvailability());
}

function initializeStorage() {
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

    // Check to see if localStorage is available and if not, always use cookies
    this.isLocalStorageAvailable = this.determineLocalStorageAvailability();

    if (!this.isLocalStorageAvailable) {
        mParticle.useCookieStorage = true;
    }
    if (this.isLocalStorageAvailable) {
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

    var encodedProducts = localStorage.getItem(MP.Config.LocalStorageProductsV4);

    if (encodedProducts) {
        var decodedProducts = JSON.parse(Base64.decode(encodedProducts));
    }

    if (MP.mpid) {
        storeProductsInMemory(decodedProducts, MP.mpid);
    }

    for (var key in allData) {
        if (allData.hasOwnProperty(key)) {
            if (!SDKv2NonMPIDCookieKeys[key]) {
                MP.nonCurrentUserMPIDs[key] = allData[key];
            }
        }
    }

    this.update();
}

function update() {
    if (!Helpers.shouldUseNativeSdk()) {
        if (mParticle.useCookieStorage) {
            this.setCookie();
        }

        this.setLocalStorage();
    }
}

function storeProductsInMemory(products, mpid) {
    try {
        MP.cartProducts = products[mpid] && products[mpid].cp ? products[mpid].cp : [];
    }
    catch(e) {
        Helpers.logDebug(Messages.ErrorMessages.CookieParseError);
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
            MP.context = obj.gs.c || MP.context;
            MP.currentSessionMPIDs = obj.gs.csm || MP.currentSessionMPIDs;

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

function determineLocalStorageAvailability() {
    var storage, result;

    try {
        (storage = window.localStorage).setItem('mparticle', 'test');
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

function getLocalStorageProducts() {
    var products = localStorage.getItem(MP.Config.LocalStorageProductsV4);
    if (products) {
        return Base64.decode(products);
    }
    return products;
}

function setLocalStorage() {
    var key = MP.Config.LocalStorageNameV4,
        localStorageProducts = getLocalStorageProducts(),
        currentUserProducts = this.convertProductsForLocalStorage(),
        localStorageData = this.getLocalStorage() || {},
        currentMPIDData;

    if (MP.mpid) {
        localStorageProducts = localStorageProducts ? JSON.parse(localStorageProducts) : {};
        localStorageProducts[MP.mpid] = currentUserProducts;
        try {
            window.localStorage.setItem(encodeURIComponent(MP.Config.LocalStorageProductsV4), Base64.encode(JSON.stringify(localStorageProducts)));
        }
        catch (e) {
            Helpers.logDebug('Error with setting products on localStorage.');
        }
    }

    if (!mParticle.useCookieStorage) {
        currentMPIDData = this.convertInMemoryDataForCookies();
        localStorageData.gs = localStorageData.gs || {};

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

    return data;
}

function getLocalStorage() {
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
            if (Object.keys(cookies).length) {
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
        localStorage.setItem(MP.Config.LocalStorageNameV4, encodedCookies);
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
    isLocalStorageAvailable: null,
    initializeStorage: initializeStorage,
    update: update,
    determineLocalStorageAvailability: determineLocalStorageAvailability,
    convertInMemoryDataForCookies: convertInMemoryDataForCookies,
    convertProductsForLocalStorage: convertProductsForLocalStorage,
    getLocalStorageProducts: getLocalStorageProducts,
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

},{"./consent":2,"./constants":3,"./helpers":9,"./mp":14,"./polyfill":16}],16:[function(require,module,exports){
var Helpers = require('./helpers');

// Base64 encoder/decoder - http://www.webtoolkit.info/javascript_base64.html
var Base64 = {
    _keyStr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',

    // Input must be a string
    encode: function encode(input) {
        try {
            if (window.btoa && window.atob) {
                return window.btoa(input);
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

        input = this.encode(input);

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

},{"./helpers":9}],17:[function(require,module,exports){
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

    if (MP.sessionId || messageType == Types.MessageType.OptOut || Helpers.shouldUseNativeSdk()) {
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
            ConsentState: MP.consentState
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

},{"./constants":3,"./helpers":9,"./mp":14,"./types":19}],18:[function(require,module,exports){
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
        IdentityAPI.identify(MP.initialIdentifyRequest, mParticle.identityCallback);
        MP.identifyCalled = true;
        MP.sessionId = Helpers.generateUniqueId();
        if (MP.mpid) {
            MP.currentSessionMPIDs = [MP.mpid];
        }

        if (!MP.sessionStartDate) {
            var date = new Date();
            MP.sessionStartDate = date;
            MP.dateLastEventSent = date;
        }

        mParticle.sessionManager.setSessionTimer();

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

        if (!cookies.gs.sid) {
            Helpers.logDebug(Messages.InformationMessages.NoSessionToEnd);
            return;
        }

        // sessionId is not equal to cookies.sid if cookies.sid is changed in another tab
        if (cookies.gs.sid && MP.sessionId !== cookies.gs.sid) {
            MP.sessionId = cookies.gs.sid;
        }

        if (cookies && cookies.gs && cookies.gs.les) {
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
    if (!Helpers.shouldUseNativeSdk()) {
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

},{"./constants":3,"./events":6,"./helpers":9,"./identity":10,"./mp":14,"./persistence":15,"./types":19}],19:[function(require,module,exports){
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
            return 'AddToCart';
        case ProductActionType.RemoveFromCart:
            return 'RemoveFromCart';
        case ProductActionType.Checkout:
            return 'Checkout';
        case ProductActionType.CheckoutOption:
            return 'CheckoutOption';
        case ProductActionType.Click:
            return 'Click';
        case ProductActionType.ViewDetail:
            return 'ViewDetail';
        case ProductActionType.Purchase:
            return 'Purchase';
        case ProductActionType.Refund:
            return 'Refund';
        case ProductActionType.AddToWishlist:
            return 'AddToWishlist';
        case ProductActionType.RemoveFromWishlist:
            return 'RemoveFromWishlist';
        default:
            return 'Unknown';
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
            return 'Promotion View';
        case PromotionActionType.PromotionClick:
            return 'Promotion Click';
        default:
            return 'Unknown';
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
            return 'Unknown';
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXBpQ2xpZW50LmpzIiwic3JjL2NvbnNlbnQuanMiLCJzcmMvY29uc3RhbnRzLmpzIiwic3JjL2Nvb2tpZVN5bmNNYW5hZ2VyLmpzIiwic3JjL2Vjb21tZXJjZS5qcyIsInNyYy9ldmVudHMuanMiLCJzcmMvZm9yd2FyZGVycy5qcyIsInNyYy9mb3J3YXJkaW5nU3RhdHNVcGxvYWRlci5qcyIsInNyYy9oZWxwZXJzLmpzIiwic3JjL2lkZW50aXR5LmpzIiwic3JjL21QYXJ0aWNsZVVzZXIuanMiLCJzcmMvbWFpbi5qcyIsInNyYy9taWdyYXRpb25zLmpzIiwic3JjL21wLmpzIiwic3JjL3BlcnNpc3RlbmNlLmpzIiwic3JjL3BvbHlmaWxsLmpzIiwic3JjL3NlcnZlck1vZGVsLmpzIiwic3JjL3Nlc3Npb25NYW5hZ2VyLmpzIiwic3JjL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Y0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2oyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoMkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIVFRQQ29kZXMgPSBDb25zdGFudHMuSFRUUENvZGVzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIFNlcnZlck1vZGVsID0gcmVxdWlyZSgnLi9zZXJ2ZXJNb2RlbCcpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIE1lc3NhZ2VzID0gQ29uc3RhbnRzLk1lc3NhZ2VzO1xuXG5mdW5jdGlvbiBzZW5kRXZlbnRUb1NlcnZlcihldmVudCwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpIHtcbiAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTG9nRXZlbnQsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHhocixcbiAgICAgICAgICAgIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1JlY2VpdmVkICcgKyB4aHIuc3RhdHVzVGV4dCArICcgZnJvbSBzZXJ2ZXInKTtcblxuICAgICAgICAgICAgICAgICAgICBwYXJzZUV2ZW50UmVzcG9uc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZEJlZ2luKTtcblxuICAgICAgICB2YXIgdmFsaWRVc2VySWRlbnRpdGllcyA9IFtdO1xuXG4gICAgICAgIC8vIGNvbnZlcnQgdXNlcklkZW50aXRpZXMgd2hpY2ggYXJlIG9iamVjdHMgd2l0aCBrZXkgb2YgSWRlbnRpdHlUeXBlIChudW1iZXIpIGFuZCB2YWx1ZSBJRCB0byBhbiBhcnJheSBvZiBJZGVudGl0eSBvYmplY3RzIGZvciBEVE8gYW5kIGV2ZW50IGZvcndhcmRpbmdcbiAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoZXZlbnQuVXNlcklkZW50aXRpZXMpICYmIE9iamVjdC5rZXlzKGV2ZW50LlVzZXJJZGVudGl0aWVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBldmVudC5Vc2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWRlbnRpdHkgPSB7fTtcbiAgICAgICAgICAgICAgICB1c2VySWRlbnRpdHkuSWRlbnRpdHkgPSBldmVudC5Vc2VySWRlbnRpdGllc1trZXldO1xuICAgICAgICAgICAgICAgIHVzZXJJZGVudGl0eS5UeXBlID0gSGVscGVycy5wYXJzZU51bWJlcihrZXkpO1xuICAgICAgICAgICAgICAgIHZhbGlkVXNlcklkZW50aXRpZXMucHVzaCh1c2VySWRlbnRpdHkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMgPSB2YWxpZFVzZXJJZGVudGl0aWVzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdoZW4gdGhlcmUgaXMgbm8gTVBJRCAoTVBJRCBpcyBudWxsLCBvciA9PT0gMCksIHdlIHF1ZXVlIGV2ZW50cyB1bnRpbCB3ZSBoYXZlIGEgdmFsaWQgTVBJRFxuICAgICAgICBpZiAoIU1QLm1waWQpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0V2ZW50IHdhcyBhZGRlZCB0byBldmVudFF1ZXVlLiBldmVudFF1ZXVlIHdpbGwgYmUgcHJvY2Vzc2VkIG9uY2UgYSB2YWxpZCBNUElEIGlzIHJldHVybmVkJyk7XG4gICAgICAgICAgICBNUC5ldmVudFF1ZXVlLnB1c2goZXZlbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKCFldmVudCkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5FdmVudEVtcHR5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TZW5kSHR0cCk7XG5cbiAgICAgICAgICAgIHhociA9IEhlbHBlcnMuY3JlYXRlWEhSKHhockNhbGxiYWNrKTtcblxuICAgICAgICAgICAgaWYgKHhocikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHhoci5vcGVuKCdwb3N0JywgSGVscGVycy5jcmVhdGVTZXJ2aWNlVXJsKENvbnN0YW50cy52MlNlY3VyZVNlcnZpY2VVcmwsIENvbnN0YW50cy52MlNlcnZpY2VVcmwsIE1QLmRldlRva2VuKSArICcvRXZlbnRzJyk7XG4gICAgICAgICAgICAgICAgICAgIHhoci5zZW5kKEpTT04uc3RyaW5naWZ5KFNlcnZlck1vZGVsLmNvbnZlcnRFdmVudFRvRFRPKGV2ZW50LCBNUC5pc0ZpcnN0UnVuLCBNUC5jdXJyZW5jeUNvZGUpKSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV2ZW50LkV2ZW50TmFtZSAhPT0gVHlwZXMuTWVzc2FnZVR5cGUuQXBwU3RhdGVUcmFuc2l0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnMoZXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHNlbmRpbmcgZXZlbnQgdG8gbVBhcnRpY2xlIHNlcnZlcnMuICcgKyBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlSZXF1ZXN0LCBtZXRob2QsIGNhbGxiYWNrLCBvcmlnaW5hbElkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKSB7XG4gICAgdmFyIHhociwgcHJldmlvdXNNUElELFxuICAgICAgICB4aHJDYWxsYmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUmVjZWl2ZWQgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgIHBhcnNlSWRlbnRpdHlSZXNwb25zZSh4aHIsIHByZXZpb3VzTVBJRCwgY2FsbGJhY2ssIG9yaWdpbmFsSWRlbnRpdHlBcGlEYXRhLCBtZXRob2QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRJZGVudGl0eUJlZ2luKTtcblxuICAgIGlmICghaWRlbnRpdHlBcGlSZXF1ZXN0KSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5BUElSZXF1ZXN0RW1wdHkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlNlbmRJZGVudGl0eUh0dHApO1xuICAgIHhociA9IEhlbHBlcnMuY3JlYXRlWEhSKHhockNhbGxiYWNrKTtcblxuICAgIGlmICh4aHIpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChNUC5pZGVudGl0eUNhbGxJbkZsaWdodCkge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHtodHRwQ29kZTogSFRUUENvZGVzLmFjdGl2ZUlkZW50aXR5UmVxdWVzdCwgYm9keTogJ1RoZXJlIGlzIGN1cnJlbnRseSBhbiBBSkFYIHJlcXVlc3QgcHJvY2Vzc2luZy4gUGxlYXNlIHdhaXQgZm9yIHRoaXMgdG8gcmV0dXJuIGJlZm9yZSByZXF1ZXN0aW5nIGFnYWluJ30pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBwcmV2aW91c01QSUQgPSAoIU1QLmlzRmlyc3RSdW4gJiYgTVAubXBpZCkgPyBNUC5tcGlkIDogbnVsbDtcbiAgICAgICAgICAgICAgICBpZiAobWV0aG9kID09PSAnbW9kaWZ5Jykge1xuICAgICAgICAgICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIENvbnN0YW50cy5pZGVudGl0eVVybCArIE1QLm1waWQgKyAnLycgKyBtZXRob2QpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHhoci5vcGVuKCdwb3N0JywgQ29uc3RhbnRzLmlkZW50aXR5VXJsICsgbWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ3gtbXAta2V5JywgTVAuZGV2VG9rZW4pO1xuICAgICAgICAgICAgICAgIE1QLmlkZW50aXR5Q2FsbEluRmxpZ2h0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB4aHIuc2VuZChKU09OLnN0cmluZ2lmeShpZGVudGl0eUFwaVJlcXVlc3QpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQgPSBmYWxzZTtcbiAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy5ub0h0dHBDb3ZlcmFnZSwgZSk7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGlkZW50aXR5IHJlcXVlc3QgdG8gc2VydmVycyB3aXRoIHN0YXR1cyBjb2RlICcgKyB4aHIuc3RhdHVzICsgJyAtICcgKyBlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VuZEJhdGNoRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXIoZm9yd2FyZGluZ1N0YXRzRGF0YSwgeGhyKSB7XG4gICAgdmFyIHVybCwgZGF0YTtcbiAgICB0cnkge1xuICAgICAgICB1cmwgPSBIZWxwZXJzLmNyZWF0ZVNlcnZpY2VVcmwoQ29uc3RhbnRzLnYyU2VjdXJlU2VydmljZVVybCwgQ29uc3RhbnRzLnYyU2VydmljZVVybCwgTVAuZGV2VG9rZW4pO1xuICAgICAgICBkYXRhID0ge1xuICAgICAgICAgICAgdXVpZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICBkYXRhOiBmb3J3YXJkaW5nU3RhdHNEYXRhXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHhocikge1xuICAgICAgICAgICAgeGhyLm9wZW4oJ3Bvc3QnLCB1cmwgKyAnL0ZvcndhcmRpbmcnKTtcbiAgICAgICAgICAgIHhoci5zZW5kKEpTT04uc3RyaW5naWZ5KGRhdGEpKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBzZW5kaW5nIGZvcndhcmRpbmcgc3RhdHMgdG8gbVBhcnRpY2xlIHNlcnZlcnMuJyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZW5kU2luZ2xlRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXIoZm9yd2FyZGluZ1N0YXRzRGF0YSkge1xuICAgIHZhciB1cmwsIGRhdGE7XG4gICAgdHJ5IHtcbiAgICAgICAgdmFyIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAyKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1N1Y2Nlc3NmdWxseSBzZW50ICAnICsgeGhyLnN0YXR1c1RleHQgKyAnIGZyb20gc2VydmVyJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICB2YXIgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuICAgICAgICB1cmwgPSBIZWxwZXJzLmNyZWF0ZVNlcnZpY2VVcmwoQ29uc3RhbnRzLnYxU2VjdXJlU2VydmljZVVybCwgQ29uc3RhbnRzLnYxU2VydmljZVVybCwgTVAuZGV2VG9rZW4pO1xuICAgICAgICBkYXRhID0gZm9yd2FyZGluZ1N0YXRzRGF0YTtcblxuICAgICAgICBpZiAoeGhyKSB7XG4gICAgICAgICAgICB4aHIub3BlbigncG9zdCcsIHVybCArICcvRm9yd2FyZGluZycpO1xuICAgICAgICAgICAgeGhyLnNlbmQoSlNPTi5zdHJpbmdpZnkoZGF0YSkpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHNlbmRpbmcgZm9yd2FyZGluZyBzdGF0cyB0byBtUGFydGljbGUgc2VydmVycy4nKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHNlbmRFdmVudFRvU2VydmVyOiBzZW5kRXZlbnRUb1NlcnZlcixcbiAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0OiBzZW5kSWRlbnRpdHlSZXF1ZXN0LFxuICAgIHNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyOiBzZW5kQmF0Y2hGb3J3YXJkaW5nU3RhdHNUb1NlcnZlcixcbiAgICBzZW5kU2luZ2xlRm9yd2FyZGluZ1N0YXRzVG9TZXJ2ZXI6IHNlbmRTaW5nbGVGb3J3YXJkaW5nU3RhdHNUb1NlcnZlclxufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZUdEUFJDb25zZW50KGNvbnNlbnRlZCwgdGltZXN0YW1wLCBjb25zZW50RG9jdW1lbnQsIGxvY2F0aW9uLCBoYXJkd2FyZUlkKSB7XG4gICAgaWYgKHR5cGVvZihjb25zZW50ZWQpICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ29uc2VudGVkIGJvb2xlYW4gaXMgcmVxdWlyZWQgd2hlbiBjb25zdHJ1Y3RpbmcgYSBHRFBSIENvbnNlbnQgb2JqZWN0LicpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRpbWVzdGFtcCAmJiBpc05hTih0aW1lc3RhbXApKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RpbWVzdGFtcCBtdXN0IGJlIGEgdmFsaWQgbnVtYmVyIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChjb25zZW50RG9jdW1lbnQgJiYgIXR5cGVvZihjb25zZW50RG9jdW1lbnQpID09PSAnc3RyaW5nJykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdEb2N1bWVudCBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChsb2NhdGlvbiAmJiAhdHlwZW9mKGxvY2F0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnTG9jYXRpb24gbXVzdCBiZSBhIHZhbGlkIHN0cmluZyB3aGVuIGNvbnN0cnVjdGluZyBhIEdEUFIgQ29uc2VudCBvYmplY3QuJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoaGFyZHdhcmVJZCAmJiAhdHlwZW9mKGhhcmR3YXJlSWQpID09PSAnc3RyaW5nJykge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdIYXJkd2FyZSBJRCBtdXN0IGJlIGEgdmFsaWQgc3RyaW5nIHdoZW4gY29uc3RydWN0aW5nIGEgR0RQUiBDb25zZW50IG9iamVjdC4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIENvbnNlbnRlZDogY29uc2VudGVkLFxuICAgICAgICBUaW1lc3RhbXA6IHRpbWVzdGFtcCB8fCBEYXRlLm5vdygpLFxuICAgICAgICBDb25zZW50RG9jdW1lbnQ6IGNvbnNlbnREb2N1bWVudCxcbiAgICAgICAgTG9jYXRpb246IGxvY2F0aW9uLFxuICAgICAgICBIYXJkd2FyZUlkOiBoYXJkd2FyZUlkXG4gICAgfTtcbn1cblxudmFyIENvbnNlbnRTZXJpYWxpemF0aW9uID0ge1xuICAgIHRvTWluaWZpZWRKc29uT2JqZWN0OiBmdW5jdGlvbihzdGF0ZSkge1xuICAgICAgICB2YXIganNvbk9iamVjdCA9IHt9O1xuICAgICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgICAgIHZhciBnZHByQ29uc2VudFN0YXRlID0gc3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpO1xuICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUpIHtcbiAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHIgPSB7fTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGdkcHJDb25zZW50U3RhdGUpe1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZS5oYXNPd25Qcm9wZXJ0eShwdXJwb3NlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGdkcHJDb25zZW50ID0gZ2RwckNvbnNlbnRTdGF0ZVtwdXJwb3NlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb25PYmplY3QuZ2RwcltwdXJwb3NlXSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Db25zZW50ZWQpID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0uYyA9IGdkcHJDb25zZW50LkNvbnNlbnRlZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuVGltZXN0YW1wKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0udHMgPSBnZHByQ29uc2VudC5UaW1lc3RhbXA7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbk9iamVjdC5nZHByW3B1cnBvc2VdLmQgPSBnZHByQ29uc2VudC5Db25zZW50RG9jdW1lbnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkxvY2F0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0ubCA9IGdkcHJDb25zZW50LkxvY2F0aW9uO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5IYXJkd2FyZUlkKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uT2JqZWN0LmdkcHJbcHVycG9zZV0uaCA9IGdkcHJDb25zZW50LkhhcmR3YXJlSWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGpzb25PYmplY3Q7XG4gICAgfSxcblxuICAgIGZyb21NaW5pZmllZEpzb25PYmplY3Q6IGZ1bmN0aW9uKGpzb24pIHtcbiAgICAgICAgdmFyIHN0YXRlID0gY3JlYXRlQ29uc2VudFN0YXRlKCk7XG4gICAgICAgIGlmIChqc29uLmdkcHIpIHtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4ganNvbi5nZHByKXtcbiAgICAgICAgICAgICAgICBpZiAoanNvbi5nZHByLmhhc093blByb3BlcnR5KHB1cnBvc2UpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBnZHByQ29uc2VudCA9IGNyZWF0ZUdEUFJDb25zZW50KGpzb24uZ2RwcltwdXJwb3NlXS5jLFxuICAgICAgICAgICAgICAgICAgICAgICAganNvbi5nZHByW3B1cnBvc2VdLnRzLFxuICAgICAgICAgICAgICAgICAgICAgICAganNvbi5nZHByW3B1cnBvc2VdLmQsXG4gICAgICAgICAgICAgICAgICAgICAgICBqc29uLmdkcHJbcHVycG9zZV0ubCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGpzb24uZ2RwcltwdXJwb3NlXS5oKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUuYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVDb25zZW50U3RhdGUoY29uc2VudFN0YXRlKSB7XG4gICAgdmFyIGdkcHIgPSB7fTtcblxuICAgIGlmIChjb25zZW50U3RhdGUpIHtcbiAgICAgICAgc2V0R0RQUkNvbnNlbnRTdGF0ZShjb25zZW50U3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYW5vbmljYWxpemVGb3JEZWR1cGxpY2F0aW9uKHB1cnBvc2UpIHtcbiAgICAgICAgaWYgKHR5cGVvZihwdXJwb3NlKSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHZhciB0cmltbWVkUHVycG9zZSA9IHB1cnBvc2UudHJpbSgpO1xuICAgICAgICBpZiAoIXRyaW1tZWRQdXJwb3NlLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRyaW1tZWRQdXJwb3NlLnRvTG93ZXJDYXNlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0R0RQUkNvbnNlbnRTdGF0ZShnZHByQ29uc2VudFN0YXRlKSB7XG4gICAgICAgIGlmICghZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICAgICAgZ2RwciA9IHt9O1xuICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuaXNPYmplY3QoZ2RwckNvbnNlbnRTdGF0ZSkpIHtcbiAgICAgICAgICAgIGdkcHIgPSB7fTtcbiAgICAgICAgICAgIGZvciAodmFyIHB1cnBvc2UgaW4gZ2RwckNvbnNlbnRTdGF0ZSl7XG4gICAgICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudFN0YXRlW3B1cnBvc2VdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWRkR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlLCBnZHByQ29uc2VudCkge1xuICAgICAgICB2YXIgbm9ybWFsaXplZFB1cnBvc2UgPSBjYW5vbmljYWxpemVGb3JEZWR1cGxpY2F0aW9uKHB1cnBvc2UpO1xuICAgICAgICBpZiAoIW5vcm1hbGl6ZWRQdXJwb3NlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdhZGRHRFBSQ29uc2VudFN0YXRlKCkgaW52b2tlZCB3aXRoIGJhZCBwdXJwb3NlLiBQdXJwb3NlIG11c3QgYmUgYSBzdHJpbmcuJyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUhlbHBlcnMuaXNPYmplY3QoZ2RwckNvbnNlbnQpKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdhZGRHRFBSQ29uc2VudFN0YXRlKCkgaW52b2tlZCB3aXRoIGJhZCBvciBlbXB0eSBHRFBSIGNvbnNlbnQgb2JqZWN0LicpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGdkcHJDb25zZW50Q29weSA9IGNyZWF0ZUdEUFJDb25zZW50KGdkcHJDb25zZW50LkNvbnNlbnRlZCwgXG4gICAgICAgICAgICAgICAgZ2RwckNvbnNlbnQuVGltZXN0YW1wLFxuICAgICAgICAgICAgICAgIGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCxcbiAgICAgICAgICAgICAgICBnZHByQ29uc2VudC5Mb2NhdGlvbixcbiAgICAgICAgICAgICAgICBnZHByQ29uc2VudC5IYXJkd2FyZUlkKTtcbiAgICAgICAgaWYgKGdkcHJDb25zZW50Q29weSkge1xuICAgICAgICAgICAgZ2Rwcltub3JtYWxpemVkUHVycG9zZV0gPSBnZHByQ29uc2VudENvcHk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVtb3ZlR0RQUkNvbnNlbnRTdGF0ZShwdXJwb3NlKSB7XG4gICAgICAgIHZhciBub3JtYWxpemVkUHVycG9zZSA9IGNhbm9uaWNhbGl6ZUZvckRlZHVwbGljYXRpb24ocHVycG9zZSk7XG4gICAgICAgIGlmICghbm9ybWFsaXplZFB1cnBvc2UpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZSBnZHByW25vcm1hbGl6ZWRQdXJwb3NlXTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpIHtcbiAgICAgICAgcmV0dXJuIEhlbHBlcnMuZXh0ZW5kKHt9LCBnZHByKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzZXRHRFBSQ29uc2VudFN0YXRlOiBzZXRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICBhZGRHRFBSQ29uc2VudFN0YXRlOiBhZGRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICBnZXRHRFBSQ29uc2VudFN0YXRlOiBnZXRHRFBSQ29uc2VudFN0YXRlLFxuICAgICAgICByZW1vdmVHRFBSQ29uc2VudFN0YXRlOiByZW1vdmVHRFBSQ29uc2VudFN0YXRlXG4gICAgfTtcbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjcmVhdGVHRFBSQ29uc2VudDogY3JlYXRlR0RQUkNvbnNlbnQsXG4gICAgU2VyaWFsaXphdGlvbjogQ29uc2VudFNlcmlhbGl6YXRpb24sXG4gICAgY3JlYXRlQ29uc2VudFN0YXRlOiBjcmVhdGVDb25zZW50U3RhdGVcbn07XG4iLCJ2YXIgdjFTZXJ2aWNlVXJsID0gJ2pzc2RrLm1wYXJ0aWNsZS5jb20vdjEvSlMvJyxcbiAgICB2MVNlY3VyZVNlcnZpY2VVcmwgPSAnanNzZGtzLm1wYXJ0aWNsZS5jb20vdjEvSlMvJyxcbiAgICB2MlNlcnZpY2VVcmwgPSAnanNzZGsubXBhcnRpY2xlLmNvbS92Mi9KUy8nLFxuICAgIHYyU2VjdXJlU2VydmljZVVybCA9ICdqc3Nka3MubXBhcnRpY2xlLmNvbS92Mi9KUy8nLFxuICAgIGlkZW50aXR5VXJsID0gJ2h0dHBzOi8vaWRlbnRpdHkubXBhcnRpY2xlLmNvbS92MS8nLCAvL3Byb2RcbiAgICBzZGtWZXJzaW9uID0gJzIuNi4zJyxcbiAgICBzZGtWZW5kb3IgPSAnbXBhcnRpY2xlJyxcbiAgICBwbGF0Zm9ybSA9ICd3ZWInLFxuICAgIE1lc3NhZ2VzID0ge1xuICAgICAgICBFcnJvck1lc3NhZ2VzOiB7XG4gICAgICAgICAgICBOb1Rva2VuOiAnQSB0b2tlbiBtdXN0IGJlIHNwZWNpZmllZC4nLFxuICAgICAgICAgICAgRXZlbnROYW1lSW52YWxpZFR5cGU6ICdFdmVudCBuYW1lIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgdmFsdWUuJyxcbiAgICAgICAgICAgIEV2ZW50RGF0YUludmFsaWRUeXBlOiAnRXZlbnQgZGF0YSBtdXN0IGJlIGEgdmFsaWQgb2JqZWN0IGhhc2guJyxcbiAgICAgICAgICAgIExvZ2dpbmdEaXNhYmxlZDogJ0V2ZW50IGxvZ2dpbmcgaXMgY3VycmVudGx5IGRpc2FibGVkLicsXG4gICAgICAgICAgICBDb29raWVQYXJzZUVycm9yOiAnQ291bGQgbm90IHBhcnNlIGNvb2tpZScsXG4gICAgICAgICAgICBFdmVudEVtcHR5OiAnRXZlbnQgb2JqZWN0IGlzIG51bGwgb3IgdW5kZWZpbmVkLCBjYW5jZWxsaW5nIHNlbmQnLFxuICAgICAgICAgICAgQVBJUmVxdWVzdEVtcHR5OiAnQVBJUmVxdWVzdCBpcyBudWxsIG9yIHVuZGVmaW5lZCwgY2FuY2VsbGluZyBzZW5kJyxcbiAgICAgICAgICAgIE5vRXZlbnRUeXBlOiAnRXZlbnQgdHlwZSBtdXN0IGJlIHNwZWNpZmllZC4nLFxuICAgICAgICAgICAgVHJhbnNhY3Rpb25JZFJlcXVpcmVkOiAnVHJhbnNhY3Rpb24gSUQgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgVHJhbnNhY3Rpb25SZXF1aXJlZDogJ0EgdHJhbnNhY3Rpb24gYXR0cmlidXRlcyBvYmplY3QgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgUHJvbW90aW9uSWRSZXF1aXJlZDogJ1Byb21vdGlvbiBJRCBpcyByZXF1aXJlZCcsXG4gICAgICAgICAgICBCYWRBdHRyaWJ1dGU6ICdBdHRyaWJ1dGUgdmFsdWUgY2Fubm90IGJlIG9iamVjdCBvciBhcnJheScsXG4gICAgICAgICAgICBCYWRLZXk6ICdLZXkgdmFsdWUgY2Fubm90IGJlIG9iamVjdCBvciBhcnJheScsXG4gICAgICAgICAgICBCYWRMb2dQdXJjaGFzZTogJ1RyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgYW5kIGEgcHJvZHVjdCBhcmUgYm90aCByZXF1aXJlZCB0byBsb2cgYSBwdXJjaGFzZSwgaHR0cHM6Ly9kb2NzLm1wYXJ0aWNsZS5jb20vP2phdmFzY3JpcHQjbWVhc3VyaW5nLXRyYW5zYWN0aW9ucydcbiAgICAgICAgfSxcbiAgICAgICAgSW5mb3JtYXRpb25NZXNzYWdlczoge1xuICAgICAgICAgICAgQ29va2llU2VhcmNoOiAnU2VhcmNoaW5nIGZvciBjb29raWUnLFxuICAgICAgICAgICAgQ29va2llRm91bmQ6ICdDb29raWUgZm91bmQsIHBhcnNpbmcgdmFsdWVzJyxcbiAgICAgICAgICAgIENvb2tpZU5vdEZvdW5kOiAnQ29va2llcyBub3QgZm91bmQnLFxuICAgICAgICAgICAgQ29va2llU2V0OiAnU2V0dGluZyBjb29raWUnLFxuICAgICAgICAgICAgQ29va2llU3luYzogJ1BlcmZvcm1pbmcgY29va2llIHN5bmMnLFxuICAgICAgICAgICAgU2VuZEJlZ2luOiAnU3RhcnRpbmcgdG8gc2VuZCBldmVudCcsXG4gICAgICAgICAgICBTZW5kSWRlbnRpdHlCZWdpbjogJ1N0YXJ0aW5nIHRvIHNlbmQgZXZlbnQgdG8gaWRlbnRpdHkgc2VydmVyJyxcbiAgICAgICAgICAgIFNlbmRXaW5kb3dzUGhvbmU6ICdTZW5kaW5nIGV2ZW50IHRvIFdpbmRvd3MgUGhvbmUgY29udGFpbmVyJyxcbiAgICAgICAgICAgIFNlbmRJT1M6ICdDYWxsaW5nIGlPUyBwYXRoOiAnLFxuICAgICAgICAgICAgU2VuZEFuZHJvaWQ6ICdDYWxsaW5nIEFuZHJvaWQgSlMgaW50ZXJmYWNlIG1ldGhvZDogJyxcbiAgICAgICAgICAgIFNlbmRIdHRwOiAnU2VuZGluZyBldmVudCB0byBtUGFydGljbGUgSFRUUCBzZXJ2aWNlJyxcbiAgICAgICAgICAgIFNlbmRJZGVudGl0eUh0dHA6ICdTZW5kaW5nIGV2ZW50IHRvIG1QYXJ0aWNsZSBIVFRQIHNlcnZpY2UnLFxuICAgICAgICAgICAgU3RhcnRpbmdOZXdTZXNzaW9uOiAnU3RhcnRpbmcgbmV3IFNlc3Npb24nLFxuICAgICAgICAgICAgU3RhcnRpbmdMb2dFdmVudDogJ1N0YXJ0aW5nIHRvIGxvZyBldmVudCcsXG4gICAgICAgICAgICBTdGFydGluZ0xvZ09wdE91dDogJ1N0YXJ0aW5nIHRvIGxvZyB1c2VyIG9wdCBpbi9vdXQnLFxuICAgICAgICAgICAgU3RhcnRpbmdFbmRTZXNzaW9uOiAnU3RhcnRpbmcgdG8gZW5kIHNlc3Npb24nLFxuICAgICAgICAgICAgU3RhcnRpbmdJbml0aWFsaXphdGlvbjogJ1N0YXJ0aW5nIHRvIGluaXRpYWxpemUnLFxuICAgICAgICAgICAgU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50OiAnU3RhcnRpbmcgdG8gbG9nIGNvbW1lcmNlIGV2ZW50JyxcbiAgICAgICAgICAgIExvYWRpbmdDb25maWc6ICdMb2FkaW5nIGNvbmZpZ3VyYXRpb24gb3B0aW9ucycsXG4gICAgICAgICAgICBBYmFuZG9uTG9nRXZlbnQ6ICdDYW5ub3QgbG9nIGV2ZW50LCBsb2dnaW5nIGRpc2FibGVkIG9yIGRldmVsb3BlciB0b2tlbiBub3Qgc2V0JyxcbiAgICAgICAgICAgIEFiYW5kb25TdGFydFNlc3Npb246ICdDYW5ub3Qgc3RhcnQgc2Vzc2lvbiwgbG9nZ2luZyBkaXNhYmxlZCBvciBkZXZlbG9wZXIgdG9rZW4gbm90IHNldCcsXG4gICAgICAgICAgICBBYmFuZG9uRW5kU2Vzc2lvbjogJ0Nhbm5vdCBlbmQgc2Vzc2lvbiwgbG9nZ2luZyBkaXNhYmxlZCBvciBkZXZlbG9wZXIgdG9rZW4gbm90IHNldCcsXG4gICAgICAgICAgICBOb1Nlc3Npb25Ub0VuZDogJ0Nhbm5vdCBlbmQgc2Vzc2lvbiwgbm8gYWN0aXZlIHNlc3Npb24gZm91bmQnXG4gICAgICAgIH0sXG4gICAgICAgIFZhbGlkYXRpb25NZXNzYWdlczoge1xuICAgICAgICAgICAgTW9kaWZ5SWRlbnRpdHlSZXF1ZXN0VXNlcklkZW50aXRpZXNQcmVzZW50OiAnaWRlbnRpdHlSZXF1ZXN0cyB0byBtb2RpZnkgcmVxdWlyZSB1c2VySWRlbnRpdGllcyB0byBiZSBwcmVzZW50LiBSZXF1ZXN0IG5vdCBzZW50IHRvIHNlcnZlci4gUGxlYXNlIGZpeCBhbmQgdHJ5IGFnYWluJyxcbiAgICAgICAgICAgIElkZW50aXR5UmVxdWVzZXRJbnZhbGlkS2V5OiAnVGhlcmUgaXMgYW4gaW52YWxpZCBrZXkgb24geW91ciBpZGVudGl0eVJlcXVlc3Qgb2JqZWN0LiBJdCBjYW4gb25seSBjb250YWluIGEgYHVzZXJJZGVudGl0aWVzYCBvYmplY3QgYW5kIGEgYG9uVXNlckFsaWFzYCBmdW5jdGlvbi4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgT25Vc2VyQWxpYXNUeXBlOiAnVGhlIG9uVXNlckFsaWFzIHZhbHVlIG11c3QgYmUgYSBmdW5jdGlvbi4gVGhlIG9uVXNlckFsaWFzIHByb3ZpZGVkIGlzIG9mIHR5cGUnLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXM6ICdUaGUgdXNlcklkZW50aXRpZXMga2V5IG11c3QgYmUgYW4gb2JqZWN0IHdpdGgga2V5cyBvZiBpZGVudGl0eVR5cGVzIGFuZCB2YWx1ZXMgb2Ygc3RyaW5ncy4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXNJbnZhbGlkS2V5OiAnVGhlcmUgaXMgYW4gaW52YWxpZCBpZGVudGl0eSBrZXkgb24geW91ciBgdXNlcklkZW50aXRpZXNgIG9iamVjdCB3aXRoaW4gdGhlIGlkZW50aXR5UmVxdWVzdC4gUmVxdWVzdCBub3Qgc2VudCB0byBzZXJ2ZXIuIFBsZWFzZSBmaXggYW5kIHRyeSBhZ2Fpbi4nLFxuICAgICAgICAgICAgVXNlcklkZW50aXRpZXNJbnZhbGlkVmFsdWVzOiAnQWxsIHVzZXIgaWRlbnRpdHkgdmFsdWVzIG11c3QgYmUgc3RyaW5ncyBvciBudWxsLiBSZXF1ZXN0IG5vdCBzZW50IHRvIHNlcnZlci4gUGxlYXNlIGZpeCBhbmQgdHJ5IGFnYWluLidcblxuICAgICAgICB9XG4gICAgfSxcbiAgICBOYXRpdmVTZGtQYXRocyA9IHtcbiAgICAgICAgTG9nRXZlbnQ6ICdsb2dFdmVudCcsXG4gICAgICAgIFNldFVzZXJUYWc6ICdzZXRVc2VyVGFnJyxcbiAgICAgICAgUmVtb3ZlVXNlclRhZzogJ3JlbW92ZVVzZXJUYWcnLFxuICAgICAgICBTZXRVc2VyQXR0cmlidXRlOiAnc2V0VXNlckF0dHJpYnV0ZScsXG4gICAgICAgIFJlbW92ZVVzZXJBdHRyaWJ1dGU6ICdyZW1vdmVVc2VyQXR0cmlidXRlJyxcbiAgICAgICAgU2V0U2Vzc2lvbkF0dHJpYnV0ZTogJ3NldFNlc3Npb25BdHRyaWJ1dGUnLFxuICAgICAgICBBZGRUb0NhcnQ6ICdhZGRUb0NhcnQnLFxuICAgICAgICBSZW1vdmVGcm9tQ2FydDogJ3JlbW92ZUZyb21DYXJ0JyxcbiAgICAgICAgQ2xlYXJDYXJ0OiAnY2xlYXJDYXJ0JyxcbiAgICAgICAgTG9nT3V0OiAnbG9nT3V0JyxcbiAgICAgICAgU2V0VXNlckF0dHJpYnV0ZUxpc3Q6ICdzZXRVc2VyQXR0cmlidXRlTGlzdCcsXG4gICAgICAgIFJlbW92ZUFsbFVzZXJBdHRyaWJ1dGVzOiAncmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICBHZXRVc2VyQXR0cmlidXRlc0xpc3RzOiAnZ2V0VXNlckF0dHJpYnV0ZXNMaXN0cycsXG4gICAgICAgIEdldEFsbFVzZXJBdHRyaWJ1dGVzOiAnZ2V0QWxsVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICBJZGVudGlmeTogJ2lkZW50aWZ5JyxcbiAgICAgICAgTG9nb3V0OiAnbG9nb3V0JyxcbiAgICAgICAgTG9naW46ICdsb2dpbicsXG4gICAgICAgIE1vZGlmeTogJ21vZGlmeSdcbiAgICB9LFxuICAgIERlZmF1bHRDb25maWcgPSB7XG4gICAgICAgIExvY2FsU3RvcmFnZU5hbWU6ICdtcHJ0Y2wtYXBpJywgICAgICAgICAgICAgLy8gTmFtZSBvZiB0aGUgbVAgbG9jYWxzdG9yYWdlLCBoYWQgY3AgYW5kIHBiIGV2ZW4gaWYgY29va2llcyB3ZXJlIHVzZWQsIHNraXBwZWQgdjJcbiAgICAgICAgTG9jYWxTdG9yYWdlTmFtZVYzOiAnbXBydGNsLXYzJywgICAgICAgICAgICAvLyB2MyBOYW1lIG9mIHRoZSBtUCBsb2NhbHN0b3JhZ2UsIGZpbmFsIHZlcnNpb24gb24gU0RLdjFcbiAgICAgICAgTG9jYWxTdG9yYWdlTmFtZVY0OiAnbXBydGNsLXY0JywgICAgICAgICAgICAvLyB2NCBOYW1lIG9mIHRoZSBtUCBsb2NhbHN0b3JhZ2UsIEN1cnJlbnQgVmVyc2lvblxuICAgICAgICBMb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0OiAnbXBydGNsLXByb2R2NCcsICAgIC8vIFRoZSBuYW1lIGZvciBtUCBsb2NhbHN0b3JhZ2UgdGhhdCBjb250YWlucyBwcm9kdWN0cyBmb3IgY2FydFByb2R1Y3MgYW5kIHByb2R1Y3RCYWdzXG4gICAgICAgIENvb2tpZU5hbWU6ICdtcHJ0Y2wtYXBpJywgICAgICAgICAgICAgICAgICAgLy8gdjEgTmFtZSBvZiB0aGUgY29va2llIHN0b3JlZCBvbiB0aGUgdXNlcidzIG1hY2hpbmVcbiAgICAgICAgQ29va2llTmFtZVYyOiAnbXBydGNsLXYyJywgICAgICAgICAgICAgICAgICAvLyB2MiBOYW1lIG9mIHRoZSBjb29raWUgc3RvcmVkIG9uIHRoZSB1c2VyJ3MgbWFjaGluZS4gUmVtb3ZlZCBrZXlzIHdpdGggbm8gdmFsdWVzLCBtb3ZlZCBjYXJ0UHJvZHVjdHMgYW5kIHByb2R1Y3RCYWdzIHRvIGxvY2FsU3RvcmFnZS5cbiAgICAgICAgQ29va2llTmFtZVYzOiAnbXBydGNsLXYzJywgICAgICAgICAgICAgICAgICAvLyB2MyBOYW1lIG9mIHRoZSBjb29raWUgc3RvcmVkIG9uIHRoZSB1c2VyJ3MgbWFjaGluZS4gQmFzZTY0IGVuY29kZWQga2V5cyBpbiBCYXNlNjRDb29raWVLZXlzIG9iamVjdCwgZmluYWwgdmVyc2lvbiBvbiBTREt2MVxuICAgICAgICBDb29raWVOYW1lVjQ6ICdtcHJ0Y2wtdjQnLCAgICAgICAgICAgICAgICAgIC8vIHY0IE5hbWUgb2YgdGhlIGNvb2tpZSBzdG9yZWQgb24gdGhlIHVzZXIncyBtYWNoaW5lLiBCYXNlNjQgZW5jb2RlZCBrZXlzIGluIEJhc2U2NENvb2tpZUtleXMgb2JqZWN0LCBjdXJyZW50IHZlcnNpb24gb24gU0RLIHYyXG4gICAgICAgIENvb2tpZURvbWFpbjogbnVsbCwgXHRcdFx0ICAgICAgICAgICAgLy8gSWYgbnVsbCwgZGVmYXVsdHMgdG8gY3VycmVudCBsb2NhdGlvbi5ob3N0XG4gICAgICAgIERlYnVnOiBmYWxzZSxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gSWYgdHJ1ZSwgd2lsbCBwcmludCBkZWJ1ZyBtZXNzYWdlcyB0byBicm93c2VyIGNvbnNvbGVcbiAgICAgICAgQ29va2llRXhwaXJhdGlvbjogMzY1LFx0XHRcdCAgICAgICAgICAgIC8vIENvb2tpZSBleHBpcmF0aW9uIHRpbWUgaW4gZGF5c1xuICAgICAgICBMb2dMZXZlbDogbnVsbCxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gV2hhdCBsb2dnaW5nIHdpbGwgYmUgcHJvdmlkZWQgaW4gdGhlIGNvbnNvbGVcbiAgICAgICAgSW5jbHVkZVJlZmVycmVyOiB0cnVlLFx0XHRcdCAgICAgICAgICAgIC8vIEluY2x1ZGUgdXNlcidzIHJlZmVycmVyXG4gICAgICAgIEluY2x1ZGVHb29nbGVBZHdvcmRzOiB0cnVlLFx0XHQgICAgICAgICAgICAvLyBJbmNsdWRlIHV0bV9zb3VyY2UgYW5kIHV0bV9wcm9wZXJ0aWVzXG4gICAgICAgIFRpbWVvdXQ6IDMwMCxcdFx0XHRcdFx0ICAgICAgICAgICAgLy8gVGltZW91dCBpbiBtaWxsaXNlY29uZHMgZm9yIGxvZ2dpbmcgZnVuY3Rpb25zXG4gICAgICAgIFNlc3Npb25UaW1lb3V0OiAzMCxcdFx0XHRcdCAgICAgICAgICAgIC8vIFNlc3Npb24gdGltZW91dCBpbiBtaW51dGVzXG4gICAgICAgIFNhbmRib3g6IGZhbHNlLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXZlbnRzIGFyZSBtYXJrZWQgYXMgZGVidWcgYW5kIG9ubHkgZm9yd2FyZGVkIHRvIGRlYnVnIGZvcndhcmRlcnMsXG4gICAgICAgIFZlcnNpb246IG51bGwsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIHZlcnNpb24gb2YgdGhpcyB3ZWJzaXRlL2FwcFxuICAgICAgICBNYXhQcm9kdWN0czogMjAsICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE51bWJlciBvZiBwcm9kdWN0cyBwZXJzaXN0ZWQgaW4gY2FydFByb2R1Y3RzIGFuZCBwcm9kdWN0QmFnc1xuICAgICAgICBGb3J3YXJkZXJTdGF0c1RpbWVvdXQ6IDUwMDAsICAgICAgICAgICAgICAgIC8vIE1pbGxpc2Vjb25kcyBmb3IgZm9yd2FyZGVyU3RhdHMgdGltZW91dFxuICAgICAgICBNYXhDb29raWVTaXplOiAzMDAwICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE51bWJlciBvZiBieXRlcyBmb3IgY29va2llIHNpemUgdG8gbm90IGV4Y2VlZFxuICAgIH0sXG4gICAgQmFzZTY0Q29va2llS2V5cyA9IHtcbiAgICAgICAgY3NtOiAxLFxuICAgICAgICBzYTogMSxcbiAgICAgICAgc3M6IDEsXG4gICAgICAgIHVhOiAxLFxuICAgICAgICB1aTogMSxcbiAgICAgICAgY3NkOiAxLFxuICAgICAgICBjb246IDFcbiAgICB9LFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXMgPSB7XG4gICAgICAgIGdzOiAxLFxuICAgICAgICBjdTogMSxcbiAgICAgICAgZ2xvYmFsU2V0dGluZ3M6IDEsXG4gICAgICAgIGN1cnJlbnRVc2VyTVBJRDogMVxuICAgIH0sXG4gICAgSFRUUENvZGVzID0ge1xuICAgICAgICBub0h0dHBDb3ZlcmFnZTogLTEsXG4gICAgICAgIGFjdGl2ZUlkZW50aXR5UmVxdWVzdDogLTIsXG4gICAgICAgIGFjdGl2ZVNlc3Npb246IC0zLFxuICAgICAgICB2YWxpZGF0aW9uSXNzdWU6IC00LFxuICAgICAgICBuYXRpdmVJZGVudGl0eVJlcXVlc3Q6IC01LFxuICAgICAgICBsb2dnaW5nRGlzYWJsZWRPck1pc3NpbmdBUElLZXk6IC02LFxuICAgICAgICB0b29NYW55UmVxdWVzdHM6IDQyOVxuICAgIH0sXG4gICAgRmVhdHVyZXMgPSB7XG4gICAgICAgIEJhdGNoaW5nOiAnYmF0Y2hpbmcnXG4gICAgfTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgdjFTZXJ2aWNlVXJsOiB2MVNlcnZpY2VVcmwsXG4gICAgdjFTZWN1cmVTZXJ2aWNlVXJsOiB2MVNlY3VyZVNlcnZpY2VVcmwsXG4gICAgdjJTZXJ2aWNlVXJsOiB2MlNlcnZpY2VVcmwsXG4gICAgdjJTZWN1cmVTZXJ2aWNlVXJsOiB2MlNlY3VyZVNlcnZpY2VVcmwsXG4gICAgaWRlbnRpdHlVcmw6IGlkZW50aXR5VXJsLFxuICAgIHNka1ZlcnNpb246IHNka1ZlcnNpb24sXG4gICAgc2RrVmVuZG9yOiBzZGtWZW5kb3IsXG4gICAgcGxhdGZvcm06IHBsYXRmb3JtLFxuICAgIE1lc3NhZ2VzOiBNZXNzYWdlcyxcbiAgICBOYXRpdmVTZGtQYXRoczogTmF0aXZlU2RrUGF0aHMsXG4gICAgRGVmYXVsdENvbmZpZzogRGVmYXVsdENvbmZpZyxcbiAgICBCYXNlNjRDb29raWVLZXlzOkJhc2U2NENvb2tpZUtleXMsXG4gICAgSFRUUENvZGVzOiBIVFRQQ29kZXMsXG4gICAgRmVhdHVyZXM6IEZlYXR1cmVzLFxuICAgIFNES3YyTm9uTVBJRENvb2tpZUtleXM6IFNES3YyTm9uTVBJRENvb2tpZUtleXNcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyk7XG5cbnZhciBjb29raWVTeW5jTWFuYWdlciA9IHtcbiAgICBhdHRlbXB0Q29va2llU3luYzogZnVuY3Rpb24ocHJldmlvdXNNUElELCBtcGlkKSB7XG4gICAgICAgIHZhciBwaXhlbENvbmZpZywgbGFzdFN5bmNEYXRlRm9yTW9kdWxlLCB1cmwsIHJlZGlyZWN0LCB1cmxXaXRoUmVkaXJlY3Q7XG4gICAgICAgIGlmIChtcGlkICYmICFIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgICAgICBNUC5waXhlbENvbmZpZ3VyYXRpb25zLmZvckVhY2goZnVuY3Rpb24ocGl4ZWxTZXR0aW5ncykge1xuICAgICAgICAgICAgICAgIHBpeGVsQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICBtb2R1bGVJZDogcGl4ZWxTZXR0aW5ncy5tb2R1bGVJZCxcbiAgICAgICAgICAgICAgICAgICAgZnJlcXVlbmN5Q2FwOiBwaXhlbFNldHRpbmdzLmZyZXF1ZW5jeUNhcCxcbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxVcmw6IGNvb2tpZVN5bmNNYW5hZ2VyLnJlcGxhY2VBbXAocGl4ZWxTZXR0aW5ncy5waXhlbFVybCksXG4gICAgICAgICAgICAgICAgICAgIHJlZGlyZWN0VXJsOiBwaXhlbFNldHRpbmdzLnJlZGlyZWN0VXJsID8gY29va2llU3luY01hbmFnZXIucmVwbGFjZUFtcChwaXhlbFNldHRpbmdzLnJlZGlyZWN0VXJsKSA6IG51bGxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgdXJsID0gY29va2llU3luY01hbmFnZXIucmVwbGFjZU1QSUQocGl4ZWxDb25maWcucGl4ZWxVcmwsIG1waWQpO1xuICAgICAgICAgICAgICAgIHJlZGlyZWN0ID0gcGl4ZWxDb25maWcucmVkaXJlY3RVcmwgPyBjb29raWVTeW5jTWFuYWdlci5yZXBsYWNlTVBJRChwaXhlbENvbmZpZy5yZWRpcmVjdFVybCwgbXBpZCkgOiAnJztcbiAgICAgICAgICAgICAgICB1cmxXaXRoUmVkaXJlY3QgPSB1cmwgKyBlbmNvZGVVUklDb21wb25lbnQocmVkaXJlY3QpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHByZXZpb3VzTVBJRCAmJiBwcmV2aW91c01QSUQgIT09IG1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llU3luY01hbmFnZXIucGVyZm9ybUNvb2tpZVN5bmModXJsV2l0aFJlZGlyZWN0LCBwaXhlbENvbmZpZy5tb2R1bGVJZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBsYXN0U3luY0RhdGVGb3JNb2R1bGUgPSBNUC5jb29raWVTeW5jRGF0ZXNbKHBpeGVsQ29uZmlnLm1vZHVsZUlkKS50b1N0cmluZygpXSA/IE1QLmNvb2tpZVN5bmNEYXRlc1socGl4ZWxDb25maWcubW9kdWxlSWQpLnRvU3RyaW5nKCldIDogbnVsbDtcblxuICAgICAgICAgICAgICAgICAgICBpZiAobGFzdFN5bmNEYXRlRm9yTW9kdWxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayB0byBzZWUgaWYgd2UgbmVlZCB0byByZWZyZXNoIGNvb2tpZVN5bmNcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgobmV3IERhdGUoKSkuZ2V0VGltZSgpID4gKG5ldyBEYXRlKGxhc3RTeW5jRGF0ZUZvck1vZHVsZSkuZ2V0VGltZSgpICsgKHBpeGVsQ29uZmlnLmZyZXF1ZW5jeUNhcCAqIDYwICogMTAwMCAqIDYwICogMjQpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyLnBlcmZvcm1Db29raWVTeW5jKHVybFdpdGhSZWRpcmVjdCwgcGl4ZWxDb25maWcubW9kdWxlSWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29va2llU3luY01hbmFnZXIucGVyZm9ybUNvb2tpZVN5bmModXJsV2l0aFJlZGlyZWN0LCBwaXhlbENvbmZpZy5tb2R1bGVJZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBwZXJmb3JtQ29va2llU3luYzogZnVuY3Rpb24odXJsLCBtb2R1bGVJZCkge1xuICAgICAgICB2YXIgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7XG5cbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVN5bmMpO1xuXG4gICAgICAgIGltZy5zcmMgPSB1cmw7XG4gICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlc1ttb2R1bGVJZC50b1N0cmluZygpXSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XG4gICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgIH0sXG5cbiAgICByZXBsYWNlTVBJRDogZnVuY3Rpb24oc3RyaW5nLCBtcGlkKSB7XG4gICAgICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgnJSVtcGlkJSUnLCBtcGlkKTtcbiAgICB9LFxuXG4gICAgcmVwbGFjZUFtcDogZnVuY3Rpb24oc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvJmFtcDsvZywgJyYnKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvb2tpZVN5bmNNYW5hZ2VyO1xuIiwidmFyIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBWYWxpZGF0b3JzID0gSGVscGVycy5WYWxpZGF0b3JzLFxuICAgIE1lc3NhZ2VzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKS5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBTZXJ2ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2VydmVyTW9kZWwnKTtcblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9uQXR0cmlidXRlc1RvUHJvZHVjdEFjdGlvbih0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3RBY3Rpb24pIHtcbiAgICBwcm9kdWN0QWN0aW9uLlRyYW5zYWN0aW9uSWQgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuSWQ7XG4gICAgcHJvZHVjdEFjdGlvbi5BZmZpbGlhdGlvbiA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5BZmZpbGlhdGlvbjtcbiAgICBwcm9kdWN0QWN0aW9uLkNvdXBvbkNvZGUgPSB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMuQ291cG9uQ29kZTtcbiAgICBwcm9kdWN0QWN0aW9uLlRvdGFsQW1vdW50ID0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzLlJldmVudWU7XG4gICAgcHJvZHVjdEFjdGlvbi5TaGlwcGluZ0Ftb3VudCA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5TaGlwcGluZztcbiAgICBwcm9kdWN0QWN0aW9uLlRheEFtb3VudCA9IHRyYW5zYWN0aW9uQXR0cmlidXRlcy5UYXg7XG59XG5cbmZ1bmN0aW9uIGdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUocHJvZHVjdEFjdGlvblR5cGUpIHtcbiAgICBzd2l0Y2ggKHByb2R1Y3RBY3Rpb25UeXBlKSB7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdBZGRUb0NhcnQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ0FkZFRvV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dCc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICByZXR1cm4gJ0NoZWNrb3V0T3B0aW9uJztcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnQ2xpY2snO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlOlxuICAgICAgICAgICAgcmV0dXJuICdQdXJjaGFzZSc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kOlxuICAgICAgICAgICAgcmV0dXJuICdSZWZ1bmQnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmVGcm9tQ2FydCc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbVdpc2hsaXN0OlxuICAgICAgICAgICAgcmV0dXJuICdSZW1vdmVGcm9tV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gJ1ZpZXdEZXRhaWwnO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlVua25vd246XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gJ1Vua25vd24nO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0UHJvbW90aW9uQWN0aW9uRXZlbnROYW1lKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICBzd2l0Y2ggKHByb21vdGlvbkFjdGlvblR5cGUpIHtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb25DbGljayc7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb25WaWV3JztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlKHByb2R1Y3RBY3Rpb25UeXBlKSB7XG4gICAgc3dpdGNoIChwcm9kdWN0QWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydDpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0QWRkVG9DYXJ0O1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEFkZFRvV2lzaGxpc3Q7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXQ6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENoZWNrb3V0O1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0T3B0aW9uOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dE9wdGlvbjtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0Q2xpY2s7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUHVyY2hhc2U6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFB1cmNoYXNlO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlZnVuZDpcbiAgICAgICAgICAgIHJldHVybiBUeXBlcy5Db21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVmdW5kO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZW1vdmVGcm9tQ2FydDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlbW92ZUZyb21XaXNobGlzdDtcbiAgICAgICAgY2FzZSBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5Vbmtub3duOlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkV2ZW50VHlwZS5Vbmtub3duO1xuICAgICAgICBjYXNlIFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFZpZXdEZXRhaWw7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdDb3VsZCBub3QgY29udmVydCBwcm9kdWN0IGFjdGlvbiB0eXBlICcgKyBwcm9kdWN0QWN0aW9uVHlwZSArICcgdG8gZXZlbnQgdHlwZScpO1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjb252ZXJ0UHJvbW90aW9uQWN0aW9uVG9FdmVudFR5cGUocHJvbW90aW9uQWN0aW9uVHlwZSkge1xuICAgIHN3aXRjaCAocHJvbW90aW9uQWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvbW90aW9uQ2xpY2s7XG4gICAgICAgIGNhc2UgVHlwZXMuUHJvbW90aW9uQWN0aW9uVHlwZS5Qcm9tb3Rpb25WaWV3OlxuICAgICAgICAgICAgcmV0dXJuIFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb21vdGlvblZpZXc7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdDb3VsZCBub3QgY29udmVydCBwcm9tb3Rpb24gYWN0aW9uIHR5cGUgJyArIHByb21vdGlvbkFjdGlvblR5cGUgKyAnIHRvIGV2ZW50IHR5cGUnKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoZXZlbnROYW1lLCBwbHVzT25lKSB7XG4gICAgcmV0dXJuICdlQ29tbWVyY2UgLSAnICsgZXZlbnROYW1lICsgJyAtICcgKyAocGx1c09uZSA/ICdUb3RhbCcgOiAnSXRlbScpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0UHJvZHVjdEF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvZHVjdCkge1xuICAgIGlmIChwcm9kdWN0LkNvdXBvbkNvZGUpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ291cG9uIENvZGUnXSA9IHByb2R1Y3QuQ291cG9uQ29kZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuQnJhbmQpIHtcbiAgICAgICAgYXR0cmlidXRlc1snQnJhbmQnXSA9IHByb2R1Y3QuQnJhbmQ7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LkNhdGVnb3J5KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0NhdGVnb3J5J10gPSBwcm9kdWN0LkNhdGVnb3J5O1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5OYW1lKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ05hbWUnXSA9IHByb2R1Y3QuTmFtZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuU2t1KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0lkJ10gPSBwcm9kdWN0LlNrdTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuUHJpY2UpIHtcbiAgICAgICAgYXR0cmlidXRlc1snSXRlbSBQcmljZSddID0gcHJvZHVjdC5QcmljZTtcbiAgICB9XG4gICAgaWYgKHByb2R1Y3QuUXVhbnRpdHkpIHtcbiAgICAgICAgYXR0cmlidXRlc1snUXVhbnRpdHknXSA9IHByb2R1Y3QuUXVhbnRpdHk7XG4gICAgfVxuICAgIGlmIChwcm9kdWN0LlBvc2l0aW9uKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Bvc2l0aW9uJ10gPSBwcm9kdWN0LlBvc2l0aW9uO1xuICAgIH1cbiAgICBpZiAocHJvZHVjdC5WYXJpYW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1ZhcmlhbnQnXSA9IHByb2R1Y3QuVmFyaWFudDtcbiAgICB9XG4gICAgYXR0cmlidXRlc1snVG90YWwgUHJvZHVjdCBBbW91bnQnXSA9IHByb2R1Y3QuVG90YWxBbW91bnQgfHwgMDtcblxufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25JZChhdHRyaWJ1dGVzLCBwcm9kdWN0QWN0aW9uKSB7XG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uVHJhbnNhY3Rpb25JZCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydUcmFuc2FjdGlvbiBJZCddID0gcHJvZHVjdEFjdGlvbi5UcmFuc2FjdGlvbklkO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgcHJvZHVjdEFjdGlvbikge1xuICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkKGF0dHJpYnV0ZXMsIHByb2R1Y3RBY3Rpb24pO1xuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb24pIHtcbiAgICAgICAgYXR0cmlidXRlc1snQWZmaWxpYXRpb24nXSA9IHByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb247XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uQ291cG9uQ29kZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydDb3Vwb24gQ29kZSddID0gcHJvZHVjdEFjdGlvbi5Db3Vwb25Db2RlO1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLlRvdGFsQW1vdW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1RvdGFsIEFtb3VudCddID0gcHJvZHVjdEFjdGlvbi5Ub3RhbEFtb3VudDtcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5TaGlwcGluZ0Ftb3VudCkge1xuICAgICAgICBhdHRyaWJ1dGVzWydTaGlwcGluZyBBbW91bnQnXSA9IHByb2R1Y3RBY3Rpb24uU2hpcHBpbmdBbW91bnQ7XG4gICAgfVxuXG4gICAgaWYgKHByb2R1Y3RBY3Rpb24uVGF4QW1vdW50KSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1RheCBBbW91bnQnXSA9IHByb2R1Y3RBY3Rpb24uVGF4QW1vdW50O1xuICAgIH1cblxuICAgIGlmIChwcm9kdWN0QWN0aW9uLkNoZWNrb3V0T3B0aW9ucykge1xuICAgICAgICBhdHRyaWJ1dGVzWydDaGVja291dCBPcHRpb25zJ10gPSBwcm9kdWN0QWN0aW9uLkNoZWNrb3V0T3B0aW9ucztcbiAgICB9XG5cbiAgICBpZiAocHJvZHVjdEFjdGlvbi5DaGVja291dFN0ZXApIHtcbiAgICAgICAgYXR0cmlidXRlc1snQ2hlY2tvdXQgU3RlcCddID0gcHJvZHVjdEFjdGlvbi5DaGVja291dFN0ZXA7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBleHRyYWN0UHJvbW90aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9tb3Rpb24pIHtcbiAgICBpZiAocHJvbW90aW9uLklkKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ0lkJ10gPSBwcm9tb3Rpb24uSWQ7XG4gICAgfVxuXG4gICAgaWYgKHByb21vdGlvbi5DcmVhdGl2ZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydDcmVhdGl2ZSddID0gcHJvbW90aW9uLkNyZWF0aXZlO1xuICAgIH1cblxuICAgIGlmIChwcm9tb3Rpb24uTmFtZSkge1xuICAgICAgICBhdHRyaWJ1dGVzWydOYW1lJ10gPSBwcm9tb3Rpb24uTmFtZTtcbiAgICB9XG5cbiAgICBpZiAocHJvbW90aW9uLlBvc2l0aW9uKSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Bvc2l0aW9uJ10gPSBwcm9tb3Rpb24uUG9zaXRpb247XG4gICAgfVxufVxuXG5mdW5jdGlvbiBidWlsZFByb2R1Y3RMaXN0KGV2ZW50LCBwcm9kdWN0KSB7XG4gICAgaWYgKHByb2R1Y3QpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJvZHVjdCkpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm9kdWN0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFtwcm9kdWN0XTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXZlbnQuU2hvcHBpbmdDYXJ0LlByb2R1Y3RMaXN0O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcm9kdWN0KG5hbWUsXG4gICAgc2t1LFxuICAgIHByaWNlLFxuICAgIHF1YW50aXR5LFxuICAgIHZhcmlhbnQsXG4gICAgY2F0ZWdvcnksXG4gICAgYnJhbmQsXG4gICAgcG9zaXRpb24sXG4gICAgY291cG9uQ29kZSxcbiAgICBhdHRyaWJ1dGVzKSB7XG5cbiAgICBhdHRyaWJ1dGVzID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcyk7XG5cbiAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ05hbWUgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhIHByb2R1Y3QnKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFWYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoc2t1KSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTS1UgaXMgcmVxdWlyZWQgd2hlbiBjcmVhdGluZyBhIHByb2R1Y3QsIGFuZCBtdXN0IGJlIGEgc3RyaW5nIG9yIGEgbnVtYmVyJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKHByaWNlKSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQcmljZSBpcyByZXF1aXJlZCB3aGVuIGNyZWF0aW5nIGEgcHJvZHVjdCwgYW5kIG11c3QgYmUgYSBzdHJpbmcgb3IgYSBudW1iZXInKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFxdWFudGl0eSkge1xuICAgICAgICBxdWFudGl0eSA9IDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgTmFtZTogbmFtZSxcbiAgICAgICAgU2t1OiBza3UsXG4gICAgICAgIFByaWNlOiBwcmljZSxcbiAgICAgICAgUXVhbnRpdHk6IHF1YW50aXR5LFxuICAgICAgICBCcmFuZDogYnJhbmQsXG4gICAgICAgIFZhcmlhbnQ6IHZhcmlhbnQsXG4gICAgICAgIENhdGVnb3J5OiBjYXRlZ29yeSxcbiAgICAgICAgUG9zaXRpb246IHBvc2l0aW9uLFxuICAgICAgICBDb3Vwb25Db2RlOiBjb3Vwb25Db2RlLFxuICAgICAgICBUb3RhbEFtb3VudDogcXVhbnRpdHkgKiBwcmljZSxcbiAgICAgICAgQXR0cmlidXRlczogYXR0cmlidXRlc1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb21vdGlvbihpZCwgY3JlYXRpdmUsIG5hbWUsIHBvc2l0aW9uKSB7XG4gICAgaWYgKCFWYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoaWQpKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5Qcm9tb3Rpb25JZFJlcXVpcmVkKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgSWQ6IGlkLFxuICAgICAgICBDcmVhdGl2ZTogY3JlYXRpdmUsXG4gICAgICAgIE5hbWU6IG5hbWUsXG4gICAgICAgIFBvc2l0aW9uOiBwb3NpdGlvblxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUltcHJlc3Npb24obmFtZSwgcHJvZHVjdCkge1xuICAgIGlmICh0eXBlb2YgbmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnTmFtZSBpcyByZXF1aXJlZCB3aGVuIGNyZWF0aW5nIGFuIGltcHJlc3Npb24uJyk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghcHJvZHVjdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQcm9kdWN0IGlzIHJlcXVpcmVkIHdoZW4gY3JlYXRpbmcgYW4gaW1wcmVzc2lvbi4nKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgTmFtZTogbmFtZSxcbiAgICAgICAgUHJvZHVjdDogcHJvZHVjdFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyhpZCxcbiAgICBhZmZpbGlhdGlvbixcbiAgICBjb3Vwb25Db2RlLFxuICAgIHJldmVudWUsXG4gICAgc2hpcHBpbmcsXG4gICAgdGF4KSB7XG5cbiAgICBpZiAoIVZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcihpZCkpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLlRyYW5zYWN0aW9uSWRSZXF1aXJlZCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIElkOiBpZCxcbiAgICAgICAgQWZmaWxpYXRpb246IGFmZmlsaWF0aW9uLFxuICAgICAgICBDb3Vwb25Db2RlOiBjb3Vwb25Db2RlLFxuICAgICAgICBSZXZlbnVlOiByZXZlbnVlLFxuICAgICAgICBTaGlwcGluZzogc2hpcHBpbmcsXG4gICAgICAgIFRheDogdGF4XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvZHVjdEltcHJlc3Npb24oY29tbWVyY2VFdmVudCkge1xuICAgIHZhciBhcHBFdmVudHMgPSBbXTtcbiAgICBpZiAoIWNvbW1lcmNlRXZlbnQuUHJvZHVjdEltcHJlc3Npb25zKSB7XG4gICAgICAgIHJldHVybiBhcHBFdmVudHM7XG4gICAgfVxuICAgIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEltcHJlc3Npb25zLmZvckVhY2goZnVuY3Rpb24ocHJvZHVjdEltcHJlc3Npb24pIHtcbiAgICAgICAgaWYgKHByb2R1Y3RJbXByZXNzaW9uLlByb2R1Y3RMaXN0KSB7XG4gICAgICAgICAgICBwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0TGlzdC5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICB2YXIgYXR0cmlidXRlcyA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCB7fSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgICAgIGlmIChwcm9kdWN0LkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgYXR0cmlidXRlIGluIHByb2R1Y3QuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVdID0gcHJvZHVjdC5BdHRyaWJ1dGVzW2F0dHJpYnV0ZV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3QpO1xuICAgICAgICAgICAgICAgIGlmIChwcm9kdWN0SW1wcmVzc2lvbi5Qcm9kdWN0SW1wcmVzc2lvbkxpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1snUHJvZHVjdCBJbXByZXNzaW9uIExpc3QnXSA9IHByb2R1Y3RJbXByZXNzaW9uLlByb2R1Y3RJbXByZXNzaW9uTGlzdDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmFyIGFwcEV2ZW50ID0gU2VydmVyTW9kZWwuY3JlYXRlRXZlbnRPYmplY3QoVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgZ2VuZXJhdGVFeHBhbmRlZEVjb21tZXJjZU5hbWUoJ0ltcHJlc3Npb24nKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBUeXBlcy5FdmVudFR5cGUuVHJhbnNhY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBhcHBFdmVudHMucHVzaChhcHBFdmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gZXhwYW5kQ29tbWVyY2VFdmVudChldmVudCkge1xuICAgIGlmICghZXZlbnQpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiBleHBhbmRQcm9kdWN0QWN0aW9uKGV2ZW50KVxuICAgICAgICAuY29uY2F0KGV4cGFuZFByb21vdGlvbkFjdGlvbihldmVudCkpXG4gICAgICAgIC5jb25jYXQoZXhwYW5kUHJvZHVjdEltcHJlc3Npb24oZXZlbnQpKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvbW90aW9uQWN0aW9uKGNvbW1lcmNlRXZlbnQpIHtcbiAgICB2YXIgYXBwRXZlbnRzID0gW107XG4gICAgaWYgKCFjb21tZXJjZUV2ZW50LlByb21vdGlvbkFjdGlvbikge1xuICAgICAgICByZXR1cm4gYXBwRXZlbnRzO1xuICAgIH1cbiAgICB2YXIgcHJvbW90aW9ucyA9IGNvbW1lcmNlRXZlbnQuUHJvbW90aW9uQWN0aW9uLlByb21vdGlvbkxpc3Q7XG4gICAgcHJvbW90aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKHByb21vdGlvbikge1xuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCB7fSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMpO1xuICAgICAgICBleHRyYWN0UHJvbW90aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBwcm9tb3Rpb24pO1xuXG4gICAgICAgIHZhciBhcHBFdmVudCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudCxcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldEV4cGFuc2lvbk5hbWUoY29tbWVyY2VFdmVudC5Qcm9tb3Rpb25BY3Rpb24uUHJvbW90aW9uQWN0aW9uVHlwZSkpLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgVHlwZXMuRXZlbnRUeXBlLlRyYW5zYWN0aW9uXG4gICAgICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChhcHBFdmVudCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gZXhwYW5kUHJvZHVjdEFjdGlvbihjb21tZXJjZUV2ZW50KSB7XG4gICAgdmFyIGFwcEV2ZW50cyA9IFtdO1xuICAgIGlmICghY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uKSB7XG4gICAgICAgIHJldHVybiBhcHBFdmVudHM7XG4gICAgfVxuICAgIHZhciBzaG91bGRFeHRyYWN0QWN0aW9uQXR0cmlidXRlcyA9IGZhbHNlO1xuICAgIGlmIChjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUgPT09IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlIHx8XG4gICAgICAgIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSA9PT0gVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kKSB7XG4gICAgICAgIHZhciBhdHRyaWJ1dGVzID0gSGVscGVycy5leHRlbmQoZmFsc2UsIHt9LCBjb21tZXJjZUV2ZW50LkV2ZW50QXR0cmlidXRlcyk7XG4gICAgICAgIGF0dHJpYnV0ZXNbJ1Byb2R1Y3QgQ291bnQnXSA9IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdCA/IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdC5sZW5ndGggOiAwO1xuICAgICAgICBleHRyYWN0QWN0aW9uQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBjb21tZXJjZUV2ZW50LlByb2R1Y3RBY3Rpb24pO1xuICAgICAgICBpZiAoY29tbWVyY2VFdmVudC5DdXJyZW5jeUNvZGUpIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbJ0N1cnJlbmN5IENvZGUnXSA9IGNvbW1lcmNlRXZlbnQuQ3VycmVuY3lDb2RlO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwbHVzT25lRXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lKGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSksIHRydWUpLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5UcmFuc2FjdGlvblxuICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChwbHVzT25lRXZlbnQpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgc2hvdWxkRXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMgPSB0cnVlO1xuICAgIH1cblxuICAgIHZhciBwcm9kdWN0cyA9IGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0TGlzdDtcblxuICAgIGlmICghcHJvZHVjdHMpIHtcbiAgICAgICAgcmV0dXJuIGFwcEV2ZW50cztcbiAgICB9XG5cbiAgICBwcm9kdWN0cy5mb3JFYWNoKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBIZWxwZXJzLmV4dGVuZChmYWxzZSwgY29tbWVyY2VFdmVudC5FdmVudEF0dHJpYnV0ZXMsIHByb2R1Y3QuQXR0cmlidXRlcyk7XG4gICAgICAgIGlmIChzaG91bGRFeHRyYWN0QWN0aW9uQXR0cmlidXRlcykge1xuICAgICAgICAgICAgZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMoYXR0cmlidXRlcywgY29tbWVyY2VFdmVudC5Qcm9kdWN0QWN0aW9uKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkKGF0dHJpYnV0ZXMsIGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbik7XG4gICAgICAgIH1cbiAgICAgICAgZXh0cmFjdFByb2R1Y3RBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIHByb2R1Y3QpO1xuXG4gICAgICAgIHZhciBwcm9kdWN0RXZlbnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZShUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5nZXRFeHBhbnNpb25OYW1lKGNvbW1lcmNlRXZlbnQuUHJvZHVjdEFjdGlvbi5Qcm9kdWN0QWN0aW9uVHlwZSkpLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5UcmFuc2FjdGlvblxuICAgICAgICApO1xuICAgICAgICBhcHBFdmVudHMucHVzaChwcm9kdWN0RXZlbnQpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcEV2ZW50cztcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncykge1xuICAgIHZhciBiYXNlRXZlbnQ7XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dDb21tZXJjZUV2ZW50KTtcblxuICAgIGlmIChIZWxwZXJzLmNhbkxvZygpKSB7XG4gICAgICAgIGJhc2VFdmVudCA9IFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLkNvbW1lcmNlKTtcbiAgICAgICAgYmFzZUV2ZW50LkV2ZW50TmFtZSA9ICdlQ29tbWVyY2UgLSAnO1xuICAgICAgICBiYXNlRXZlbnQuQ3VycmVuY3lDb2RlID0gTVAuY3VycmVuY3lDb2RlO1xuICAgICAgICBiYXNlRXZlbnQuU2hvcHBpbmdDYXJ0ID0ge1xuICAgICAgICAgICAgUHJvZHVjdExpc3Q6IE1QLmNhcnRQcm9kdWN0c1xuICAgICAgICB9O1xuICAgICAgICBiYXNlRXZlbnQuQ3VzdG9tRmxhZ3MgPSBjdXN0b21GbGFncztcblxuICAgICAgICByZXR1cm4gYmFzZUV2ZW50O1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb246IGNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb24sXG4gICAgZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZTogZ2V0UHJvZHVjdEFjdGlvbkV2ZW50TmFtZSxcbiAgICBnZXRQcm9tb3Rpb25BY3Rpb25FdmVudE5hbWU6IGdldFByb21vdGlvbkFjdGlvbkV2ZW50TmFtZSxcbiAgICBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlOiBjb252ZXJ0UHJvZHVjdEFjdGlvblRvRXZlbnRUeXBlLFxuICAgIGNvbnZlcnRQcm9tb3Rpb25BY3Rpb25Ub0V2ZW50VHlwZTogY29udmVydFByb21vdGlvbkFjdGlvblRvRXZlbnRUeXBlLFxuICAgIGdlbmVyYXRlRXhwYW5kZWRFY29tbWVyY2VOYW1lOiBnZW5lcmF0ZUV4cGFuZGVkRWNvbW1lcmNlTmFtZSxcbiAgICBleHRyYWN0UHJvZHVjdEF0dHJpYnV0ZXM6IGV4dHJhY3RQcm9kdWN0QXR0cmlidXRlcyxcbiAgICBleHRyYWN0QWN0aW9uQXR0cmlidXRlczogZXh0cmFjdEFjdGlvbkF0dHJpYnV0ZXMsXG4gICAgZXh0cmFjdFByb21vdGlvbkF0dHJpYnV0ZXM6IGV4dHJhY3RQcm9tb3Rpb25BdHRyaWJ1dGVzLFxuICAgIGV4dHJhY3RUcmFuc2FjdGlvbklkOiBleHRyYWN0VHJhbnNhY3Rpb25JZCxcbiAgICBidWlsZFByb2R1Y3RMaXN0OiBidWlsZFByb2R1Y3RMaXN0LFxuICAgIGNyZWF0ZVByb2R1Y3Q6IGNyZWF0ZVByb2R1Y3QsXG4gICAgY3JlYXRlUHJvbW90aW9uOiBjcmVhdGVQcm9tb3Rpb24sXG4gICAgY3JlYXRlSW1wcmVzc2lvbjogY3JlYXRlSW1wcmVzc2lvbixcbiAgICBjcmVhdGVUcmFuc2FjdGlvbkF0dHJpYnV0ZXM6IGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyxcbiAgICBleHBhbmRDb21tZXJjZUV2ZW50OiBleHBhbmRDb21tZXJjZUV2ZW50LFxuICAgIGNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3Q6IGNyZWF0ZUNvbW1lcmNlRXZlbnRPYmplY3Rcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgRWNvbW1lcmNlID0gcmVxdWlyZSgnLi9lY29tbWVyY2UnKSxcbiAgICBTZXJ2ZXJNb2RlbCA9IHJlcXVpcmUoJy4vc2VydmVyTW9kZWwnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBzZW5kRXZlbnRUb1NlcnZlciA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50Jykuc2VuZEV2ZW50VG9TZXJ2ZXIsXG4gICAgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJykuc2VuZEV2ZW50VG9Gb3J3YXJkZXJzO1xuXG5mdW5jdGlvbiBsb2dFdmVudCh0eXBlLCBuYW1lLCBkYXRhLCBjYXRlZ29yeSwgY2ZsYWdzKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTG9nRXZlbnQgKyAnOiAnICsgbmFtZSk7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZCgpO1xuXG4gICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICBkYXRhID0gSGVscGVycy5zYW5pdGl6ZUF0dHJpYnV0ZXMoZGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBzZW5kRXZlbnRUb1NlcnZlcihTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdCh0eXBlLCBuYW1lLCBkYXRhLCBjYXRlZ29yeSwgY2ZsYWdzKSwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpO1xuICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VFdmVudFJlc3BvbnNlKHJlc3BvbnNlVGV4dCkge1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpLFxuICAgICAgICBzZXR0aW5ncyxcbiAgICAgICAgcHJvcCxcbiAgICAgICAgZnVsbFByb3A7XG5cbiAgICBpZiAoIXJlc3BvbnNlVGV4dCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUGFyc2luZyByZXNwb25zZSBmcm9tIHNlcnZlcicpO1xuICAgICAgICBzZXR0aW5ncyA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KTtcblxuICAgICAgICBpZiAoc2V0dGluZ3MgJiYgc2V0dGluZ3MuU3RvcmUpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1BhcnNlZCBzdG9yZSBmcm9tIHJlc3BvbnNlLCB1cGRhdGluZyBsb2NhbCBzZXR0aW5ncycpO1xuXG4gICAgICAgICAgICBpZiAoIU1QLnNlcnZlclNldHRpbmdzKSB7XG4gICAgICAgICAgICAgICAgTVAuc2VydmVyU2V0dGluZ3MgPSB7fTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yIChwcm9wIGluIHNldHRpbmdzLlN0b3JlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzZXR0aW5ncy5TdG9yZS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBmdWxsUHJvcCA9IHNldHRpbmdzLlN0b3JlW3Byb3BdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFmdWxsUHJvcC5WYWx1ZSB8fCBuZXcgRGF0ZShmdWxsUHJvcC5FeHBpcmVzKSA8IG5vdykge1xuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIHNldHRpbmcgc2hvdWxkIGJlIGRlbGV0ZWQgZnJvbSB0aGUgbG9jYWwgc3RvcmUgaWYgaXQgZXhpc3RzXG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QLnNlcnZlclNldHRpbmdzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgTVAuc2VydmVyU2V0dGluZ3NbcHJvcF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSB2YWxpZCBzZXR0aW5nXG4gICAgICAgICAgICAgICAgICAgIE1QLnNlcnZlclNldHRpbmdzW3Byb3BdID0gZnVsbFByb3A7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBwYXJzaW5nIEpTT04gcmVzcG9uc2UgZnJvbSBzZXJ2ZXI6ICcgKyBlLm5hbWUpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3RhcnRUcmFja2luZygpIHtcbiAgICBpZiAoIU1QLmlzVHJhY2tpbmcpIHtcbiAgICAgICAgaWYgKCdnZW9sb2NhdGlvbicgaW4gbmF2aWdhdG9yKSB7XG4gICAgICAgICAgICBNUC53YXRjaFBvc2l0aW9uSWQgPSBuYXZpZ2F0b3IuZ2VvbG9jYXRpb24ud2F0Y2hQb3NpdGlvbihmdW5jdGlvbihwb3NpdGlvbikge1xuICAgICAgICAgICAgICAgIE1QLmN1cnJlbnRQb3NpdGlvbiA9IHtcbiAgICAgICAgICAgICAgICAgICAgbGF0OiBwb3NpdGlvbi5jb29yZHMubGF0aXR1ZGUsXG4gICAgICAgICAgICAgICAgICAgIGxuZzogcG9zaXRpb24uY29vcmRzLmxvbmdpdHVkZVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgTVAuaXNUcmFja2luZyA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHN0b3BUcmFja2luZygpIHtcbiAgICBpZiAoTVAuaXNUcmFja2luZykge1xuICAgICAgICBuYXZpZ2F0b3IuZ2VvbG9jYXRpb24uY2xlYXJXYXRjaChNUC53YXRjaFBvc2l0aW9uSWQpO1xuICAgICAgICBNUC5jdXJyZW50UG9zaXRpb24gPSBudWxsO1xuICAgICAgICBNUC5pc1RyYWNraW5nID0gZmFsc2U7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dPcHRPdXQoKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTG9nT3B0T3V0KTtcblxuICAgIHNlbmRFdmVudFRvU2VydmVyKFNlcnZlck1vZGVsLmNyZWF0ZUV2ZW50T2JqZWN0KFR5cGVzLk1lc3NhZ2VUeXBlLk9wdE91dCwgbnVsbCwgbnVsbCwgVHlwZXMuRXZlbnRUeXBlLk90aGVyKSwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpO1xufVxuXG5mdW5jdGlvbiBsb2dBU1QoKSB7XG4gICAgbG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuQXBwU3RhdGVUcmFuc2l0aW9uKTtcbn1cblxuZnVuY3Rpb24gbG9nQ2hlY2tvdXRFdmVudChzdGVwLCBvcHRpb25zLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9IEVjb21tZXJjZS5nZXRQcm9kdWN0QWN0aW9uRXZlbnROYW1lKFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0KTtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dDtcbiAgICAgICAgZXZlbnQuUHJvZHVjdEFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5DaGVja291dCxcbiAgICAgICAgICAgIENoZWNrb3V0U3RlcDogc3RlcCxcbiAgICAgICAgICAgIENoZWNrb3V0T3B0aW9uczogb3B0aW9ucyxcbiAgICAgICAgICAgIFByb2R1Y3RMaXN0OiBldmVudC5TaG9wcGluZ0NhcnQuUHJvZHVjdExpc3RcbiAgICAgICAgfTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dQcm9kdWN0QWN0aW9uRXZlbnQocHJvZHVjdEFjdGlvblR5cGUsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgIHZhciBldmVudCA9IEVjb21tZXJjZS5jcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0KGN1c3RvbUZsYWdzKTtcblxuICAgIGlmIChldmVudCkge1xuICAgICAgICBldmVudC5FdmVudENhdGVnb3J5ID0gRWNvbW1lcmNlLmNvbnZlcnRQcm9kdWN0QWN0aW9uVG9FdmVudFR5cGUocHJvZHVjdEFjdGlvblR5cGUpO1xuICAgICAgICBldmVudC5FdmVudE5hbWUgKz0gRWNvbW1lcmNlLmdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUocHJvZHVjdEFjdGlvblR5cGUpO1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uID0ge1xuICAgICAgICAgICAgUHJvZHVjdEFjdGlvblR5cGU6IHByb2R1Y3RBY3Rpb25UeXBlLFxuICAgICAgICAgICAgUHJvZHVjdExpc3Q6IEFycmF5LmlzQXJyYXkocHJvZHVjdCkgPyBwcm9kdWN0IDogW3Byb2R1Y3RdXG4gICAgICAgIH07XG5cbiAgICAgICAgbG9nQ29tbWVyY2VFdmVudChldmVudCwgYXR0cnMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9nUHVyY2hhc2VFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgIHZhciBldmVudCA9IEVjb21tZXJjZS5jcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0KGN1c3RvbUZsYWdzKTtcblxuICAgIGlmIChldmVudCkge1xuICAgICAgICBldmVudC5FdmVudE5hbWUgKz0gRWNvbW1lcmNlLmdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUoVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUHVyY2hhc2UpO1xuICAgICAgICBldmVudC5FdmVudENhdGVnb3J5ID0gVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFB1cmNoYXNlO1xuICAgICAgICBldmVudC5Qcm9kdWN0QWN0aW9uID0ge1xuICAgICAgICAgICAgUHJvZHVjdEFjdGlvblR5cGU6IFR5cGVzLlByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlXG4gICAgICAgIH07XG4gICAgICAgIGV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3QgPSBFY29tbWVyY2UuYnVpbGRQcm9kdWN0TGlzdChldmVudCwgcHJvZHVjdCk7XG5cbiAgICAgICAgRWNvbW1lcmNlLmNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBldmVudC5Qcm9kdWN0QWN0aW9uKTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dSZWZ1bmRFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgIGlmICghdHJhbnNhY3Rpb25BdHRyaWJ1dGVzKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5UcmFuc2FjdGlvblJlcXVpcmVkKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBldmVudCA9IEVjb21tZXJjZS5jcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0KGN1c3RvbUZsYWdzKTtcblxuICAgIGlmIChldmVudCkge1xuICAgICAgICBldmVudC5FdmVudE5hbWUgKz0gRWNvbW1lcmNlLmdldFByb2R1Y3RBY3Rpb25FdmVudE5hbWUoVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kKTtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RSZWZ1bmQ7XG4gICAgICAgIGV2ZW50LlByb2R1Y3RBY3Rpb24gPSB7XG4gICAgICAgICAgICBQcm9kdWN0QWN0aW9uVHlwZTogVHlwZXMuUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kXG4gICAgICAgIH07XG4gICAgICAgIGV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3QgPSBFY29tbWVyY2UuYnVpbGRQcm9kdWN0TGlzdChldmVudCwgcHJvZHVjdCk7XG5cbiAgICAgICAgRWNvbW1lcmNlLmNvbnZlcnRUcmFuc2FjdGlvbkF0dHJpYnV0ZXNUb1Byb2R1Y3RBY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBldmVudC5Qcm9kdWN0QWN0aW9uKTtcblxuICAgICAgICBsb2dDb21tZXJjZUV2ZW50KGV2ZW50LCBhdHRycyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsb2dQcm9tb3Rpb25FdmVudChwcm9tb3Rpb25UeXBlLCBwcm9tb3Rpb24sIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgIHZhciBldmVudCA9IEVjb21tZXJjZS5jcmVhdGVDb21tZXJjZUV2ZW50T2JqZWN0KGN1c3RvbUZsYWdzKTtcblxuICAgIGlmIChldmVudCkge1xuICAgICAgICBldmVudC5FdmVudE5hbWUgKz0gRWNvbW1lcmNlLmdldFByb21vdGlvbkFjdGlvbkV2ZW50TmFtZShwcm9tb3Rpb25UeXBlKTtcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IEVjb21tZXJjZS5jb252ZXJ0UHJvbW90aW9uQWN0aW9uVG9FdmVudFR5cGUocHJvbW90aW9uVHlwZSk7XG4gICAgICAgIGV2ZW50LlByb21vdGlvbkFjdGlvbiA9IHtcbiAgICAgICAgICAgIFByb21vdGlvbkFjdGlvblR5cGU6IHByb21vdGlvblR5cGUsXG4gICAgICAgICAgICBQcm9tb3Rpb25MaXN0OiBbcHJvbW90aW9uXVxuICAgICAgICB9O1xuXG4gICAgICAgIGxvZ0NvbW1lcmNlRXZlbnQoZXZlbnQsIGF0dHJzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxvZ0ltcHJlc3Npb25FdmVudChpbXByZXNzaW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnQgPSBFY29tbWVyY2UuY3JlYXRlQ29tbWVyY2VFdmVudE9iamVjdChjdXN0b21GbGFncyk7XG5cbiAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuRXZlbnROYW1lICs9ICdJbXByZXNzaW9uJztcbiAgICAgICAgZXZlbnQuRXZlbnRDYXRlZ29yeSA9IFR5cGVzLkNvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RJbXByZXNzaW9uO1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoaW1wcmVzc2lvbikpIHtcbiAgICAgICAgICAgIGltcHJlc3Npb24gPSBbaW1wcmVzc2lvbl07XG4gICAgICAgIH1cblxuICAgICAgICBldmVudC5Qcm9kdWN0SW1wcmVzc2lvbnMgPSBbXTtcblxuICAgICAgICBpbXByZXNzaW9uLmZvckVhY2goZnVuY3Rpb24oaW1wcmVzc2lvbikge1xuICAgICAgICAgICAgZXZlbnQuUHJvZHVjdEltcHJlc3Npb25zLnB1c2goe1xuICAgICAgICAgICAgICAgIFByb2R1Y3RJbXByZXNzaW9uTGlzdDogaW1wcmVzc2lvbi5OYW1lLFxuICAgICAgICAgICAgICAgIFByb2R1Y3RMaXN0OiBBcnJheS5pc0FycmF5KGltcHJlc3Npb24uUHJvZHVjdCkgPyBpbXByZXNzaW9uLlByb2R1Y3QgOiBbaW1wcmVzc2lvbi5Qcm9kdWN0XVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxvZ0NvbW1lcmNlRXZlbnQoZXZlbnQsIGF0dHJzKTtcbiAgICB9XG59XG5cblxuZnVuY3Rpb24gbG9nQ29tbWVyY2VFdmVudChjb21tZXJjZUV2ZW50LCBhdHRycykge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0xvZ0NvbW1lcmNlRXZlbnQpO1xuXG4gICAgYXR0cnMgPSBIZWxwZXJzLnNhbml0aXplQXR0cmlidXRlcyhhdHRycyk7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZCgpO1xuICAgICAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgLy8gRG9uJ3Qgc2VuZCBzaG9wcGluZyBjYXJ0IHRvIHBhcmVudCBzZGtzXG4gICAgICAgICAgICBjb21tZXJjZUV2ZW50LlNob3BwaW5nQ2FydCA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGF0dHJzKSB7XG4gICAgICAgICAgICBjb21tZXJjZUV2ZW50LkV2ZW50QXR0cmlidXRlcyA9IGF0dHJzO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VuZEV2ZW50VG9TZXJ2ZXIoY29tbWVyY2VFdmVudCwgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzLCBwYXJzZUV2ZW50UmVzcG9uc2UpO1xuICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkRXZlbnRIYW5kbGVyKGRvbUV2ZW50LCBzZWxlY3RvciwgZXZlbnROYW1lLCBkYXRhLCBldmVudFR5cGUpIHtcbiAgICB2YXIgZWxlbWVudHMgPSBbXSxcbiAgICAgICAgaGFuZGxlciA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIHZhciB0aW1lb3V0SGFuZGxlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGlmIChlbGVtZW50LmhyZWYpIHtcbiAgICAgICAgICAgICAgICAgICAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSBlbGVtZW50LmhyZWY7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGVsZW1lbnQuc3VibWl0KSB7XG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnQuc3VibWl0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRE9NIGV2ZW50IHRyaWdnZXJlZCwgaGFuZGxpbmcgZXZlbnQnKTtcblxuICAgICAgICAgICAgbG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50LFxuICAgICAgICAgICAgICAgIHR5cGVvZiBldmVudE5hbWUgPT09ICdmdW5jdGlvbicgPyBldmVudE5hbWUoZWxlbWVudCkgOiBldmVudE5hbWUsXG4gICAgICAgICAgICAgICAgdHlwZW9mIGRhdGEgPT09ICdmdW5jdGlvbicgPyBkYXRhKGVsZW1lbnQpIDogZGF0YSxcbiAgICAgICAgICAgICAgICBldmVudFR5cGUgfHwgVHlwZXMuRXZlbnRUeXBlLk90aGVyKTtcblxuICAgICAgICAgICAgLy8gVE9ETzogSGFuZGxlIG1pZGRsZS1jbGlja3MgYW5kIHNwZWNpYWwga2V5cyAoY3RybCwgYWx0LCBldGMpXG4gICAgICAgICAgICBpZiAoKGVsZW1lbnQuaHJlZiAmJiBlbGVtZW50LnRhcmdldCAhPT0gJ19ibGFuaycpIHx8IGVsZW1lbnQuc3VibWl0KSB7XG4gICAgICAgICAgICAgICAgLy8gR2l2ZSB4bWxodHRwcmVxdWVzdCBlbm91Z2ggdGltZSB0byBleGVjdXRlIGJlZm9yZSBuYXZpZ2F0aW5nIGEgbGluayBvciBzdWJtaXR0aW5nIGZvcm1cblxuICAgICAgICAgICAgICAgIGlmIChlLnByZXZlbnREZWZhdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGUucmV0dXJuVmFsdWUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KHRpbWVvdXRIYW5kbGVyLCBNUC5Db25maWcuVGltZW91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVsZW1lbnQsXG4gICAgICAgIGk7XG5cbiAgICBpZiAoIXNlbGVjdG9yKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0NhblxcJ3QgYmluZCBldmVudCwgc2VsZWN0b3IgaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhIGNzcyBzZWxlY3RvciBzdHJpbmcgb3IgYSBkb20gZWxlbWVudFxuICAgIGlmICh0eXBlb2Ygc2VsZWN0b3IgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGVsZW1lbnRzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7XG4gICAgfVxuICAgIGVsc2UgaWYgKHNlbGVjdG9yLm5vZGVUeXBlKSB7XG4gICAgICAgIGVsZW1lbnRzID0gW3NlbGVjdG9yXTtcbiAgICB9XG5cbiAgICBpZiAoZWxlbWVudHMubGVuZ3RoKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0ZvdW5kICcgK1xuICAgICAgICAgICAgZWxlbWVudHMubGVuZ3RoICtcbiAgICAgICAgICAgICcgZWxlbWVudCcgK1xuICAgICAgICAgICAgKGVsZW1lbnRzLmxlbmd0aCA+IDEgPyAncycgOiAnJykgK1xuICAgICAgICAgICAgJywgYXR0YWNoaW5nIGV2ZW50IGhhbmRsZXJzJyk7XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGVsZW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBlbGVtZW50ID0gZWxlbWVudHNbaV07XG5cbiAgICAgICAgICAgIGlmIChlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIpIHtcbiAgICAgICAgICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZG9tRXZlbnQsIGhhbmRsZXIsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGVsZW1lbnQuYXR0YWNoRXZlbnQpIHtcbiAgICAgICAgICAgICAgICBlbGVtZW50LmF0dGFjaEV2ZW50KCdvbicgKyBkb21FdmVudCwgaGFuZGxlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBlbGVtZW50WydvbicgKyBkb21FdmVudF0gPSBoYW5kbGVyO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdObyBlbGVtZW50cyBmb3VuZCcpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3RhcnROZXdTZXNzaW9uSWZOZWVkZWQoKSB7XG4gICAgaWYgKCFIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgaWYgKCFNUC5zZXNzaW9uSWQgJiYgY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuc2lkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gY29va2llcy5zaWQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nRXZlbnQ6IGxvZ0V2ZW50LFxuICAgIHN0YXJ0VHJhY2tpbmc6IHN0YXJ0VHJhY2tpbmcsXG4gICAgc3RvcFRyYWNraW5nOiBzdG9wVHJhY2tpbmcsXG4gICAgbG9nQ2hlY2tvdXRFdmVudDogbG9nQ2hlY2tvdXRFdmVudCxcbiAgICBsb2dQcm9kdWN0QWN0aW9uRXZlbnQ6IGxvZ1Byb2R1Y3RBY3Rpb25FdmVudCxcbiAgICBsb2dQdXJjaGFzZUV2ZW50OiBsb2dQdXJjaGFzZUV2ZW50LFxuICAgIGxvZ1JlZnVuZEV2ZW50OiBsb2dSZWZ1bmRFdmVudCxcbiAgICBsb2dQcm9tb3Rpb25FdmVudDogbG9nUHJvbW90aW9uRXZlbnQsXG4gICAgbG9nSW1wcmVzc2lvbkV2ZW50OiBsb2dJbXByZXNzaW9uRXZlbnQsXG4gICAgbG9nT3B0T3V0OiBsb2dPcHRPdXQsXG4gICAgbG9nQVNUOiBsb2dBU1QsXG4gICAgcGFyc2VFdmVudFJlc3BvbnNlOiBwYXJzZUV2ZW50UmVzcG9uc2UsXG4gICAgbG9nQ29tbWVyY2VFdmVudDogbG9nQ29tbWVyY2VFdmVudCxcbiAgICBhZGRFdmVudEhhbmRsZXI6IGFkZEV2ZW50SGFuZGxlcixcbiAgICBzdGFydE5ld1Nlc3Npb25JZk5lZWRlZDogc3RhcnROZXdTZXNzaW9uSWZOZWVkZWRcbn07XG4iLCJ2YXIgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgTVBhcnRpY2xlVXNlciA9IHJlcXVpcmUoJy4vbVBhcnRpY2xlVXNlcicpLFxuICAgIEFwaUNsaWVudCA9IHJlcXVpcmUoJy4vYXBpQ2xpZW50JyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyk7XG5cbmZ1bmN0aW9uIGluaXRGb3J3YXJkZXJzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgaWYgKCFIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpICYmIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzKSB7XG4gICAgICAgIC8vIFNvbWUganMgbGlicmFyaWVzIHJlcXVpcmUgdGhhdCB0aGV5IGJlIGxvYWRlZCBmaXJzdCwgb3IgbGFzdCwgZXRjXG4gICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzLnNvcnQoZnVuY3Rpb24oeCwgeSkge1xuICAgICAgICAgICAgeC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlID0geC5zZXR0aW5ncy5Qcmlvcml0eVZhbHVlIHx8IDA7XG4gICAgICAgICAgICB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgPSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgfHwgMDtcbiAgICAgICAgICAgIHJldHVybiAtMSAqICh4LnNldHRpbmdzLlByaW9yaXR5VmFsdWUgLSB5LnNldHRpbmdzLlByaW9yaXR5VmFsdWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzID0gTVAuY29uZmlndXJlZEZvcndhcmRlcnMuZmlsdGVyKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKCFpc0VuYWJsZWRGb3JVc2VyQ29uc2VudChmb3J3YXJkZXIuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXMsIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzID0gSGVscGVycy5maWx0ZXJVc2VySWRlbnRpdGllcyh1c2VySWRlbnRpdGllcywgZm9yd2FyZGVyLnVzZXJJZGVudGl0eUZpbHRlcnMpO1xuICAgICAgICAgICAgdmFyIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXMgPSBIZWxwZXJzLmZpbHRlclVzZXJBdHRyaWJ1dGVzKE1QLnVzZXJBdHRyaWJ1dGVzLCBmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMpO1xuXG4gICAgICAgICAgICBpZiAoIWZvcndhcmRlci5pbml0aWFsaXplZCkge1xuICAgICAgICAgICAgICAgIGZvcndhcmRlci5pbml0KGZvcndhcmRlci5zZXR0aW5ncyxcbiAgICAgICAgICAgICAgICAgICAgcHJlcGFyZUZvcndhcmRpbmdTdGF0cyxcbiAgICAgICAgICAgICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcmVkVXNlckF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcmVkVXNlcklkZW50aXRpZXMsXG4gICAgICAgICAgICAgICAgICAgIE1QLmFwcFZlcnNpb24sXG4gICAgICAgICAgICAgICAgICAgIE1QLmFwcE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIE1QLmN1c3RvbUZsYWdzLFxuICAgICAgICAgICAgICAgICAgICBNUC5jbGllbnRJZCk7XG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLmluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGlzRW5hYmxlZEZvclVzZXJDb25zZW50KGNvbnNlbnRSdWxlcywgdXNlcikge1xuICAgIGlmICghY29uc2VudFJ1bGVzXG4gICAgICAgIHx8ICFjb25zZW50UnVsZXMudmFsdWVzXG4gICAgICAgIHx8ICFjb25zZW50UnVsZXMudmFsdWVzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdmFyIHB1cnBvc2VIYXNoZXMgPSB7fTtcbiAgICB2YXIgR0RQUkNvbnNlbnRIYXNoUHJlZml4ID0gJzEnO1xuICAgIHZhciBjb25zZW50U3RhdGUgPSB1c2VyLmdldENvbnNlbnRTdGF0ZSgpO1xuICAgIGlmIChjb25zZW50U3RhdGUpIHtcbiAgICAgICAgdmFyIGdkcHJDb25zZW50U3RhdGUgPSBjb25zZW50U3RhdGUuZ2V0R0RQUkNvbnNlbnRTdGF0ZSgpO1xuICAgICAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICAgICAgZm9yICh2YXIgcHVycG9zZSBpbiBnZHByQ29uc2VudFN0YXRlKSB7XG4gICAgICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHB1cnBvc2VIYXNoID0gSGVscGVycy5nZW5lcmF0ZUhhc2goR0RQUkNvbnNlbnRIYXNoUHJlZml4ICsgcHVycG9zZSkudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgcHVycG9zZUhhc2hlc1twdXJwb3NlSGFzaF0gPSBnZHByQ29uc2VudFN0YXRlW3B1cnBvc2VdLkNvbnNlbnRlZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgdmFyIGlzTWF0Y2ggPSBmYWxzZTtcbiAgICBjb25zZW50UnVsZXMudmFsdWVzLmZvckVhY2goZnVuY3Rpb24oY29uc2VudFJ1bGUpIHtcbiAgICAgICAgaWYgKCFpc01hdGNoKSB7XG4gICAgICAgICAgICB2YXIgcHVycG9zZUhhc2ggPSBjb25zZW50UnVsZS5jb25zZW50UHVycG9zZTtcbiAgICAgICAgICAgIHZhciBoYXNDb25zZW50ZWQgPSBjb25zZW50UnVsZS5oYXNDb25zZW50ZWQ7XG4gICAgICAgICAgICBpZiAocHVycG9zZUhhc2hlcy5oYXNPd25Qcm9wZXJ0eShwdXJwb3NlSGFzaClcbiAgICAgICAgICAgICAgICAmJiBwdXJwb3NlSGFzaGVzW3B1cnBvc2VIYXNoXSA9PT0gaGFzQ29uc2VudGVkKSB7XG4gICAgICAgICAgICAgICAgaXNNYXRjaCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb25zZW50UnVsZXMuaW5jbHVkZU9uTWF0Y2ggPT09IGlzTWF0Y2g7XG59XG5cbmZ1bmN0aW9uIGFwcGx5VG9Gb3J3YXJkZXJzKGZ1bmN0aW9uTmFtZSwgZnVuY3Rpb25BcmdzKSB7XG4gICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnMubGVuZ3RoKSB7XG4gICAgICAgIE1QLmFjdGl2ZUZvcndhcmRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgICAgIHZhciBmb3J3YXJkZXJGdW5jdGlvbiA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdO1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlckZ1bmN0aW9uKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGZvcndhcmRlcltmdW5jdGlvbk5hbWVdKGZ1bmN0aW9uQXJncyk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNlbmRFdmVudFRvRm9yd2FyZGVycyhldmVudCkge1xuICAgIHZhciBjbG9uZWRFdmVudCxcbiAgICAgICAgaGFzaGVkRXZlbnROYW1lLFxuICAgICAgICBoYXNoZWRFdmVudFR5cGUsXG4gICAgICAgIGZpbHRlclVzZXJBdHRyaWJ1dGVWYWx1ZXMgPSBmdW5jdGlvbihldmVudCwgZmlsdGVyT2JqZWN0KSB7XG4gICAgICAgICAgICB2YXIgYXR0ckhhc2gsXG4gICAgICAgICAgICAgICAgdmFsdWVIYXNoLFxuICAgICAgICAgICAgICAgIG1hdGNoID0gZmFsc2U7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKGV2ZW50LlVzZXJBdHRyaWJ1dGVzICYmIEhlbHBlcnMuaXNPYmplY3QoZXZlbnQuVXNlckF0dHJpYnV0ZXMpICYmIE9iamVjdC5rZXlzKGV2ZW50LlVzZXJBdHRyaWJ1dGVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpbHRlck9iamVjdCAmJiBIZWxwZXJzLmlzT2JqZWN0KGZpbHRlck9iamVjdCkgJiYgT2JqZWN0LmtleXMoZmlsdGVyT2JqZWN0KS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGF0dHJOYW1lIGluIGV2ZW50LlVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV2ZW50LlVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KGF0dHJOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdHRySGFzaCA9IEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGF0dHJOYW1lKS50b1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUhhc2ggPSBIZWxwZXJzLmdlbmVyYXRlSGFzaChldmVudC5Vc2VyQXR0cmlidXRlc1thdHRyTmFtZV0pLnRvU3RyaW5nKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKChhdHRySGFzaCA9PT0gZmlsdGVyT2JqZWN0LnVzZXJBdHRyaWJ1dGVOYW1lKSAmJiAodmFsdWVIYXNoID09PSBmaWx0ZXJPYmplY3QudXNlckF0dHJpYnV0ZVZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2ggPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZpbHRlck9iamVjdC5pbmNsdWRlT25NYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZmlsdGVyT2JqZWN0LmluY2x1ZGVPbk1hdGNoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAvLyBpbiBhbnkgZXJyb3Igc2NlbmFyaW8sIGVyciBvbiBzaWRlIG9mIHJldHVybmluZyB0cnVlIGFuZCBmb3J3YXJkaW5nIGV2ZW50XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGZpbHRlclVzZXJJZGVudGl0aWVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5Vc2VySWRlbnRpdGllcyAmJiBldmVudC5Vc2VySWRlbnRpdGllcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBldmVudC5Vc2VySWRlbnRpdGllcy5mb3JFYWNoKGZ1bmN0aW9uKHVzZXJJZGVudGl0eSwgaSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5pbkFycmF5KGZpbHRlckxpc3QsIHVzZXJJZGVudGl0eS5UeXBlKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQuVXNlcklkZW50aXRpZXMuc3BsaWNlKGksIDEpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpLS07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBmaWx0ZXJBdHRyaWJ1dGVzID0gZnVuY3Rpb24oZXZlbnQsIGZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgIHZhciBoYXNoO1xuXG4gICAgICAgICAgICBpZiAoIWZpbHRlckxpc3QpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAodmFyIGF0dHJOYW1lIGluIGV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmIChldmVudC5FdmVudEF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoYXR0ck5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGhhc2ggPSBIZWxwZXJzLmdlbmVyYXRlSGFzaChldmVudC5FdmVudENhdGVnb3J5ICsgZXZlbnQuRXZlbnROYW1lICsgYXR0ck5hbWUpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmluQXJyYXkoZmlsdGVyTGlzdCwgaGFzaCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBldmVudC5FdmVudEF0dHJpYnV0ZXNbYXR0ck5hbWVdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbkZpbHRlcmVkTGlzdCA9IGZ1bmN0aW9uKGZpbHRlckxpc3QsIGhhc2gpIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJMaXN0ICYmIGZpbHRlckxpc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaW5BcnJheShmaWx0ZXJMaXN0LCBoYXNoKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSxcbiAgICAgICAgZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMgPSBbXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQsXG4gICAgICAgICAgICBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlVmlldyxcbiAgICAgICAgICAgIFR5cGVzLk1lc3NhZ2VUeXBlLkNvbW1lcmNlXG4gICAgICAgIF07XG5cbiAgICBpZiAoIUhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkgJiYgTVAuYWN0aXZlRm9yd2FyZGVycykge1xuICAgICAgICBoYXNoZWRFdmVudE5hbWUgPSBIZWxwZXJzLmdlbmVyYXRlSGFzaChldmVudC5FdmVudENhdGVnb3J5ICsgZXZlbnQuRXZlbnROYW1lKTtcbiAgICAgICAgaGFzaGVkRXZlbnRUeXBlID0gSGVscGVycy5nZW5lcmF0ZUhhc2goZXZlbnQuRXZlbnRDYXRlZ29yeSk7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBNUC5hY3RpdmVGb3J3YXJkZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBhdHRyaWJ1dGUgZm9yd2FyZGluZyBydWxlLiBUaGlzIHJ1bGUgYWxsb3dzIHVzZXJzIHRvIG9ubHkgZm9yd2FyZCBhbiBldmVudCBpZiBhXG4gICAgICAgICAgICAvLyBzcGVjaWZpYyBhdHRyaWJ1dGUgZXhpc3RzIGFuZCBoYXMgYSBzcGVjaWZpYyB2YWx1ZS4gQWx0ZXJuYXRpdmVseSwgdGhleSBjYW4gc3BlY2lmeVxuICAgICAgICAgICAgLy8gdGhhdCBhbiBldmVudCBub3QgYmUgZm9yd2FyZGVkIGlmIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlIG5hbWUgYW5kIHZhbHVlIGV4aXN0cy5cbiAgICAgICAgICAgIC8vIFRoZSB0d28gY2FzZXMgYXJlIGNvbnRyb2xsZWQgYnkgdGhlIFwiaW5jbHVkZU9uTWF0Y2hcIiBib29sZWFuIHZhbHVlLlxuICAgICAgICAgICAgLy8gU3VwcG9ydGVkIG1lc3NhZ2UgdHlwZXMgZm9yIGF0dHJpYnV0ZSBmb3J3YXJkaW5nIHJ1bGVzIGFyZSBkZWZpbmVkIGluIHRoZSBmb3J3YXJkaW5nUnVsZU1lc3NhZ2VUeXBlcyBhcnJheVxuXG4gICAgICAgICAgICBpZiAoZm9yd2FyZGluZ1J1bGVNZXNzYWdlVHlwZXMuaW5kZXhPZihldmVudC5FdmVudERhdGFUeXBlKSA+IC0xXG4gICAgICAgICAgICAgICAgJiYgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlXG4gICAgICAgICAgICAgICAgJiYgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlLmV2ZW50QXR0cmlidXRlTmFtZVxuICAgICAgICAgICAgICAgICYmIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZVZhbHVlKSB7XG5cbiAgICAgICAgICAgICAgICB2YXIgZm91bmRQcm9wID0gbnVsbDtcblxuICAgICAgICAgICAgICAgIC8vIEF0dGVtcHQgdG8gZmluZCB0aGUgYXR0cmlidXRlIGluIHRoZSBjb2xsZWN0aW9uIG9mIGV2ZW50IGF0dHJpYnV0ZXNcbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQuRXZlbnRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gZXZlbnQuRXZlbnRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgaGFzaGVkRXZlbnRBdHRyaWJ1dGVOYW1lO1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFzaGVkRXZlbnRBdHRyaWJ1dGVOYW1lID0gSGVscGVycy5nZW5lcmF0ZUhhc2gocHJvcCkudG9TdHJpbmcoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGhhc2hlZEV2ZW50QXR0cmlidXRlTmFtZSA9PT0gTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlLmV2ZW50QXR0cmlidXRlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kUHJvcCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogaGFzaGVkRXZlbnRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogSGVscGVycy5nZW5lcmF0ZUhhc2goZXZlbnQuRXZlbnRBdHRyaWJ1dGVzW3Byb3BdKS50b1N0cmluZygpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgaXNNYXRjaCA9IGZvdW5kUHJvcCAhPT0gbnVsbCAmJiBmb3VuZFByb3AudmFsdWUgPT09IE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nRXZlbnRBdHRyaWJ1dGVWYWx1ZS5ldmVudEF0dHJpYnV0ZVZhbHVlO1xuXG4gICAgICAgICAgICAgICAgdmFyIHNob3VsZEluY2x1ZGUgPSBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWUuaW5jbHVkZU9uTWF0Y2ggPT09IHRydWUgPyBpc01hdGNoIDogIWlzTWF0Y2g7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXNob3VsZEluY2x1ZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDbG9uZSB0aGUgZXZlbnQgb2JqZWN0LCBhcyB3ZSBjb3VsZCBiZSBzZW5kaW5nIGRpZmZlcmVudCBhdHRyaWJ1dGVzIHRvIGVhY2ggZm9yd2FyZGVyXG4gICAgICAgICAgICBjbG9uZWRFdmVudCA9IHt9O1xuICAgICAgICAgICAgY2xvbmVkRXZlbnQgPSBIZWxwZXJzLmV4dGVuZCh0cnVlLCBjbG9uZWRFdmVudCwgZXZlbnQpO1xuICAgICAgICAgICAgLy8gQ2hlY2sgZXZlbnQgZmlsdGVyaW5nIHJ1bGVzXG4gICAgICAgICAgICBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuUGFnZUV2ZW50XG4gICAgICAgICAgICAgICAgJiYgKGluRmlsdGVyZWRMaXN0KE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZXZlbnROYW1lRmlsdGVycywgaGFzaGVkRXZlbnROYW1lKVxuICAgICAgICAgICAgICAgICAgICB8fCBpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmV2ZW50VHlwZUZpbHRlcnMsIGhhc2hlZEV2ZW50VHlwZSkpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5Db21tZXJjZSAmJiBpbkZpbHRlcmVkTGlzdChNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLmV2ZW50VHlwZUZpbHRlcnMsIGhhc2hlZEV2ZW50VHlwZSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VWaWV3ICYmIGluRmlsdGVyZWRMaXN0KE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uc2NyZWVuTmFtZUZpbHRlcnMsIGhhc2hlZEV2ZW50TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgYXR0cmlidXRlIGZpbHRlcmluZyBydWxlc1xuICAgICAgICAgICAgaWYgKGNsb25lZEV2ZW50LkV2ZW50QXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmIChldmVudC5FdmVudERhdGFUeXBlID09PSBUeXBlcy5NZXNzYWdlVHlwZS5QYWdlRXZlbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyQXR0cmlidXRlcyhjbG9uZWRFdmVudCwgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5hdHRyaWJ1dGVGaWx0ZXJzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuUGFnZVZpZXcpIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyQXR0cmlidXRlcyhjbG9uZWRFdmVudCwgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS5wYWdlVmlld0F0dHJpYnV0ZUZpbHRlcnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgdXNlciBpZGVudGl0eSBmaWx0ZXJpbmcgcnVsZXNcbiAgICAgICAgICAgIGZpbHRlclVzZXJJZGVudGl0aWVzKGNsb25lZEV2ZW50LCBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLnVzZXJJZGVudGl0eUZpbHRlcnMpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayB1c2VyIGF0dHJpYnV0ZSBmaWx0ZXJpbmcgcnVsZXNcbiAgICAgICAgICAgIGNsb25lZEV2ZW50LlVzZXJBdHRyaWJ1dGVzID0gSGVscGVycy5maWx0ZXJVc2VyQXR0cmlidXRlcyhjbG9uZWRFdmVudC5Vc2VyQXR0cmlidXRlcywgTVAuYWN0aXZlRm9yd2FyZGVyc1tpXS51c2VyQXR0cmlidXRlRmlsdGVycyk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIHVzZXIgYXR0cmlidXRlIHZhbHVlIGZpbHRlcmluZyBydWxlc1xuICAgICAgICAgICAgaWYgKE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlICYmIE9iamVjdC5rZXlzKE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWZpbHRlclVzZXJBdHRyaWJ1dGVWYWx1ZXMoY2xvbmVkRXZlbnQsIE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0uZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1NlbmRpbmcgbWVzc2FnZSB0byBmb3J3YXJkZXI6ICcgKyBNUC5hY3RpdmVGb3J3YXJkZXJzW2ldLm5hbWUpO1xuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IE1QLmFjdGl2ZUZvcndhcmRlcnNbaV0ucHJvY2VzcyhjbG9uZWRFdmVudCk7XG5cbiAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzKGtleSwgdmFsdWUpIHtcbiAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VyQXR0cmlidXRlICYmXG4gICAgICAgICAgICAgICAgZm9yd2FyZGVyLnVzZXJBdHRyaWJ1dGVGaWx0ZXJzICYmXG4gICAgICAgICAgICAgICAgIUhlbHBlcnMuaW5BcnJheShmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMsIEhlbHBlcnMuZ2VuZXJhdGVIYXNoKGtleSkpKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLnNldFVzZXJBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzKHVzZXJJZGVudGl0aWVzKSB7XG4gICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICB2YXIgZmlsdGVyZWRVc2VySWRlbnRpdGllcyA9IEhlbHBlcnMuZmlsdGVyVXNlcklkZW50aXRpZXModXNlcklkZW50aXRpZXMsIGZvcndhcmRlci51c2VySWRlbnRpdHlGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5zZXRVc2VySWRlbnRpdHkpIHtcbiAgICAgICAgICAgIGZpbHRlcmVkVXNlcklkZW50aXRpZXMuZm9yRWFjaChmdW5jdGlvbihpZGVudGl0eSkge1xuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSBmb3J3YXJkZXIuc2V0VXNlcklkZW50aXR5KGlkZW50aXR5LklkZW50aXR5LCBpZGVudGl0eS5UeXBlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBzZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkKHVzZXIpIHtcbiAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgIHZhciBmaWx0ZXJlZFVzZXIgPSBNUGFydGljbGVVc2VyLmdldEZpbHRlcmVkTXBhcnRpY2xlVXNlcih1c2VyLmdldE1QSUQoKSwgZm9yd2FyZGVyKTtcbiAgICAgICAgaWYgKGZvcndhcmRlci5vblVzZXJJZGVudGlmaWVkKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLm9uVXNlcklkZW50aWZpZWQoZmlsdGVyZWRVc2VyKTtcbiAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcHJlcGFyZUZvcndhcmRpbmdTdGF0cyhmb3J3YXJkZXIsIGV2ZW50KSB7XG4gICAgdmFyIGZvcndhcmRpbmdTdGF0c0RhdGEsXG4gICAgICAgIHF1ZXVlID0gZ2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZSgpO1xuXG4gICAgaWYgKGZvcndhcmRlciAmJiBmb3J3YXJkZXIuaXNWaXNpYmxlKSB7XG4gICAgICAgIGZvcndhcmRpbmdTdGF0c0RhdGEgPSB7XG4gICAgICAgICAgICBtaWQ6IGZvcndhcmRlci5pZCxcbiAgICAgICAgICAgIGVzaWQ6IGZvcndhcmRlci5ldmVudFN1YnNjcmlwdGlvbklkLFxuICAgICAgICAgICAgbjogZXZlbnQuRXZlbnROYW1lLFxuICAgICAgICAgICAgYXR0cnM6IGV2ZW50LkV2ZW50QXR0cmlidXRlcyxcbiAgICAgICAgICAgIHNkazogZXZlbnQuU0RLVmVyc2lvbixcbiAgICAgICAgICAgIGR0OiBldmVudC5FdmVudERhdGFUeXBlLFxuICAgICAgICAgICAgZXQ6IGV2ZW50LkV2ZW50Q2F0ZWdvcnksXG4gICAgICAgICAgICBkYmc6IGV2ZW50LkRlYnVnLFxuICAgICAgICAgICAgY3Q6IGV2ZW50LlRpbWVzdGFtcCxcbiAgICAgICAgICAgIGVlYzogZXZlbnQuRXhwYW5kZWRFdmVudENvdW50XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKEhlbHBlcnMuaGFzRmVhdHVyZUZsYWcoQ29uc3RhbnRzLkZlYXR1cmVzLkJhdGNoaW5nKSkge1xuICAgICAgICAgICAgcXVldWUucHVzaChmb3J3YXJkaW5nU3RhdHNEYXRhKTtcbiAgICAgICAgICAgIHNldEZvcndhcmRlclN0YXRzUXVldWUocXVldWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgQXBpQ2xpZW50LnNlbmRTaW5nbGVGb3J3YXJkaW5nU3RhdHNUb1NlcnZlcihmb3J3YXJkaW5nU3RhdHNEYXRhKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZSgpIHtcbiAgICByZXR1cm4gUGVyc2lzdGVuY2UuZm9yd2FyZGluZ1N0YXRzQmF0Y2hlcy5mb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlO1xufVxuXG5mdW5jdGlvbiBzZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKHF1ZXVlKSB7XG4gICAgUGVyc2lzdGVuY2UuZm9yd2FyZGluZ1N0YXRzQmF0Y2hlcy5mb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlID0gcXVldWU7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGluaXRGb3J3YXJkZXJzOiBpbml0Rm9yd2FyZGVycyxcbiAgICBhcHBseVRvRm9yd2FyZGVyczogYXBwbHlUb0ZvcndhcmRlcnMsXG4gICAgc2VuZEV2ZW50VG9Gb3J3YXJkZXJzOiBzZW5kRXZlbnRUb0ZvcndhcmRlcnMsXG4gICAgY2FsbFNldFVzZXJBdHRyaWJ1dGVPbkZvcndhcmRlcnM6IGNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzLFxuICAgIHNldEZvcndhcmRlclVzZXJJZGVudGl0aWVzOiBzZXRGb3J3YXJkZXJVc2VySWRlbnRpdGllcyxcbiAgICBzZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkOiBzZXRGb3J3YXJkZXJPblVzZXJJZGVudGlmaWVkLFxuICAgIHByZXBhcmVGb3J3YXJkaW5nU3RhdHM6IHByZXBhcmVGb3J3YXJkaW5nU3RhdHMsXG4gICAgZ2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZTogZ2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZSxcbiAgICBzZXRGb3J3YXJkZXJTdGF0c1F1ZXVlOiBzZXRGb3J3YXJkZXJTdGF0c1F1ZXVlLFxuICAgIGlzRW5hYmxlZEZvclVzZXJDb25zZW50OiBpc0VuYWJsZWRGb3JVc2VyQ29uc2VudFxufTtcbiIsInZhciBBcGlDbGllbnQgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBGb3J3YXJkZXJzID0gcmVxdWlyZSgnLi9mb3J3YXJkZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyk7XG5cbmZ1bmN0aW9uIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXIoKSB7XG4gICAgbVBhcnRpY2xlLl9mb3J3YXJkaW5nU3RhdHNUaW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBwcmVwYXJlQW5kU2VuZEZvcndhcmRpbmdTdGF0c0JhdGNoKCk7XG4gICAgfSwgTVAuQ29uZmlnLkZvcndhcmRlclN0YXRzVGltZW91dCk7XG59XG5cbmZ1bmN0aW9uIHByZXBhcmVBbmRTZW5kRm9yd2FyZGluZ1N0YXRzQmF0Y2goKSB7XG4gICAgdmFyIGZvcndhcmRlclF1ZXVlID0gRm9yd2FyZGVycy5nZXRGb3J3YXJkZXJTdGF0c1F1ZXVlKCksXG4gICAgICAgIHVwbG9hZHNUYWJsZSA9IFBlcnNpc3RlbmNlLmZvcndhcmRpbmdTdGF0c0JhdGNoZXMudXBsb2Fkc1RhYmxlLFxuICAgICAgICBub3cgPSBEYXRlLm5vdygpO1xuXG4gICAgaWYgKGZvcndhcmRlclF1ZXVlLmxlbmd0aCkge1xuICAgICAgICB1cGxvYWRzVGFibGVbbm93XSA9IHt1cGxvYWRpbmc6IGZhbHNlLCBkYXRhOiBmb3J3YXJkZXJRdWV1ZX07XG4gICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyU3RhdHNRdWV1ZShbXSk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgZGF0ZSBpbiB1cGxvYWRzVGFibGUpIHtcbiAgICAgICAgKGZ1bmN0aW9uKGRhdGUpIHtcbiAgICAgICAgICAgIGlmICh1cGxvYWRzVGFibGUuaGFzT3duUHJvcGVydHkoZGF0ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAodXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHhockNhbGxiYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAwIHx8IHhoci5zdGF0dXMgPT09IDIwMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgc2VudCAgJyArIHhoci5zdGF0dXNUZXh0ICsgJyBmcm9tIHNlcnZlcicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgdXBsb2Fkc1RhYmxlW2RhdGVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoeGhyLnN0YXR1cy50b1N0cmluZygpWzBdID09PSAnNCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHhoci5zdGF0dXMgIT09IDQyOSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVwbG9hZHNUYWJsZVtkYXRlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2Fkc1RhYmxlW2RhdGVdLnVwbG9hZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgeGhyID0gSGVscGVycy5jcmVhdGVYSFIoeGhyQ2FsbGJhY2spO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZm9yd2FyZGluZ1N0YXRzRGF0YSA9IHVwbG9hZHNUYWJsZVtkYXRlXS5kYXRhO1xuICAgICAgICAgICAgICAgICAgICB1cGxvYWRzVGFibGVbZGF0ZV0udXBsb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgQXBpQ2xpZW50LnNlbmRCYXRjaEZvcndhcmRpbmdTdGF0c1RvU2VydmVyKGZvcndhcmRpbmdTdGF0c0RhdGEsIHhocik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KShkYXRlKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXI6IHN0YXJ0Rm9yd2FyZGluZ1N0YXRzVGltZXJcbn07XG4iLCJ2YXIgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBwbHVzZXMgPSAvXFwrL2csXG4gICAgc2VydmljZVNjaGVtZSA9IHdpbmRvdy5tUGFydGljbGUgJiYgd2luZG93Lm1QYXJ0aWNsZS5mb3JjZUh0dHBzID8gJ2h0dHBzOi8vJyA6IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCArICcvLyc7XG5cbmZ1bmN0aW9uIGxvZ0RlYnVnKG1zZykge1xuICAgIGlmIChNUC5Db25maWcuTG9nTGV2ZWwgPT09ICd2ZXJib3NlJyAmJiB3aW5kb3cuY29uc29sZSAmJiB3aW5kb3cuY29uc29sZS5sb2cpIHtcbiAgICAgICAgd2luZG93LmNvbnNvbGUubG9nKG1zZyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjYW5Mb2coKSB7XG4gICAgaWYgKE1QLmlzRW5hYmxlZCAmJiAoTVAuZGV2VG9rZW4gfHwgc2hvdWxkVXNlTmF0aXZlU2RrKCkpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gaGFzRmVhdHVyZUZsYWcoZmVhdHVyZSkge1xuICAgIHJldHVybiBNUC5mZWF0dXJlRmxhZ3NbZmVhdHVyZV07XG59XG5cbmZ1bmN0aW9uIGludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBjb2RlLCBib2R5KSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKFZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICBodHRwQ29kZTogY29kZSxcbiAgICAgICAgICAgICAgICBib2R5OiBib2R5XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nRGVidWcoJ1RoZXJlIHdhcyBhbiBlcnJvciB3aXRoIHlvdXIgY2FsbGJhY2s6ICcgKyBlKTtcbiAgICB9XG59XG5cbi8vIFN0YW5kYWxvbmUgdmVyc2lvbiBvZiBqUXVlcnkuZXh0ZW5kLCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9kYW5zZG9tL2V4dGVuZFxuZnVuY3Rpb24gZXh0ZW5kKCkge1xuICAgIHZhciBvcHRpb25zLCBuYW1lLCBzcmMsIGNvcHksIGNvcHlJc0FycmF5LCBjbG9uZSxcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzBdIHx8IHt9LFxuICAgICAgICBpID0gMSxcbiAgICAgICAgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aCxcbiAgICAgICAgZGVlcCA9IGZhbHNlLFxuICAgICAgICAvLyBoZWxwZXIgd2hpY2ggcmVwbGljYXRlcyB0aGUganF1ZXJ5IGludGVybmFsIGZ1bmN0aW9uc1xuICAgICAgICBvYmplY3RIZWxwZXIgPSB7XG4gICAgICAgICAgICBoYXNPd246IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksXG4gICAgICAgICAgICBjbGFzczJ0eXBlOiB7fSxcbiAgICAgICAgICAgIHR5cGU6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIHJldHVybiBvYmogPT0gbnVsbCA/XG4gICAgICAgICAgICAgICAgICAgIFN0cmluZyhvYmopIDpcbiAgICAgICAgICAgICAgICAgICAgb2JqZWN0SGVscGVyLmNsYXNzMnR5cGVbT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaildIHx8ICdvYmplY3QnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzUGxhaW5PYmplY3Q6IGZ1bmN0aW9uKG9iaikge1xuICAgICAgICAgICAgICAgIGlmICghb2JqIHx8IG9iamVjdEhlbHBlci50eXBlKG9iaikgIT09ICdvYmplY3QnIHx8IG9iai5ub2RlVHlwZSB8fCBvYmplY3RIZWxwZXIuaXNXaW5kb3cob2JqKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5jb25zdHJ1Y3RvciAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgIW9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosICdjb25zdHJ1Y3RvcicpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAhb2JqZWN0SGVscGVyLmhhc093bi5jYWxsKG9iai5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsICdpc1Byb3RvdHlwZU9mJykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHZhciBrZXk7XG4gICAgICAgICAgICAgICAgZm9yIChrZXkgaW4gb2JqKSB7IH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1lbXB0eVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGtleSA9PT0gdW5kZWZpbmVkIHx8IG9iamVjdEhlbHBlci5oYXNPd24uY2FsbChvYmosIGtleSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNBcnJheTogQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2FycmF5JztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc0Z1bmN0aW9uOiBmdW5jdGlvbihvYmopIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0SGVscGVyLnR5cGUob2JqKSA9PT0gJ2Z1bmN0aW9uJztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBpc1dpbmRvdzogZnVuY3Rpb24ob2JqKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG9iaiAhPSBudWxsICYmIG9iaiA9PSBvYmoud2luZG93O1xuICAgICAgICAgICAgfVxuICAgICAgICB9OyAgLy8gZW5kIG9mIG9iamVjdEhlbHBlclxuXG4gICAgLy8gSGFuZGxlIGEgZGVlcCBjb3B5IHNpdHVhdGlvblxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZGVlcCA9IHRhcmdldDtcbiAgICAgICAgdGFyZ2V0ID0gYXJndW1lbnRzWzFdIHx8IHt9O1xuICAgICAgICAvLyBza2lwIHRoZSBib29sZWFuIGFuZCB0aGUgdGFyZ2V0XG4gICAgICAgIGkgPSAyO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBjYXNlIHdoZW4gdGFyZ2V0IGlzIGEgc3RyaW5nIG9yIHNvbWV0aGluZyAocG9zc2libGUgaW4gZGVlcCBjb3B5KVxuICAgIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSAnb2JqZWN0JyAmJiAhb2JqZWN0SGVscGVyLmlzRnVuY3Rpb24odGFyZ2V0KSkge1xuICAgICAgICB0YXJnZXQgPSB7fTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzZWNvbmQgYXJndW1lbnQgaXMgdXNlZCB0aGVuIHRoaXMgY2FuIGV4dGVuZCBhbiBvYmplY3QgdGhhdCBpcyB1c2luZyB0aGlzIG1ldGhvZFxuICAgIGlmIChsZW5ndGggPT09IGkpIHtcbiAgICAgICAgdGFyZ2V0ID0gdGhpcztcbiAgICAgICAgLS1pO1xuICAgIH1cblxuICAgIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgLy8gT25seSBkZWFsIHdpdGggbm9uLW51bGwvdW5kZWZpbmVkIHZhbHVlc1xuICAgICAgICBpZiAoKG9wdGlvbnMgPSBhcmd1bWVudHNbaV0pICE9IG51bGwpIHtcbiAgICAgICAgICAgIC8vIEV4dGVuZCB0aGUgYmFzZSBvYmplY3RcbiAgICAgICAgICAgIGZvciAobmFtZSBpbiBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgc3JjID0gdGFyZ2V0W25hbWVdO1xuICAgICAgICAgICAgICAgIGNvcHkgPSBvcHRpb25zW25hbWVdO1xuXG4gICAgICAgICAgICAgICAgLy8gUHJldmVudCBuZXZlci1lbmRpbmcgbG9vcFxuICAgICAgICAgICAgICAgIGlmICh0YXJnZXQgPT09IGNvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gUmVjdXJzZSBpZiB3ZSdyZSBtZXJnaW5nIHBsYWluIG9iamVjdHMgb3IgYXJyYXlzXG4gICAgICAgICAgICAgICAgaWYgKGRlZXAgJiYgY29weSAmJiAob2JqZWN0SGVscGVyLmlzUGxhaW5PYmplY3QoY29weSkgfHwgKGNvcHlJc0FycmF5ID0gb2JqZWN0SGVscGVyLmlzQXJyYXkoY29weSkpKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29weUlzQXJyYXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvcHlJc0FycmF5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbG9uZSA9IHNyYyAmJiBvYmplY3RIZWxwZXIuaXNBcnJheShzcmMpID8gc3JjIDogW107XG5cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsb25lID0gc3JjICYmIG9iamVjdEhlbHBlci5pc1BsYWluT2JqZWN0KHNyYykgPyBzcmMgOiB7fTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIE5ldmVyIG1vdmUgb3JpZ2luYWwgb2JqZWN0cywgY2xvbmUgdGhlbVxuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBleHRlbmQoZGVlcCwgY2xvbmUsIGNvcHkpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIERvbid0IGJyaW5nIGluIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvcHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBjb3B5O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJldHVybiB0aGUgbW9kaWZpZWQgb2JqZWN0XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgICB2YXIgb2JqVHlwZSA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG5cbiAgICByZXR1cm4gb2JqVHlwZSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbiAgICAgICAgfHwgb2JqVHlwZSA9PT0gJ1tvYmplY3QgRXJyb3JdJztcbn1cblxuZnVuY3Rpb24gaW5BcnJheShpdGVtcywgbmFtZSkge1xuICAgIHZhciBpID0gMDtcblxuICAgIGlmIChBcnJheS5wcm90b3R5cGUuaW5kZXhPZikge1xuICAgICAgICByZXR1cm4gaXRlbXMuaW5kZXhPZihuYW1lLCAwKSA+PSAwO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgZm9yICh2YXIgbiA9IGl0ZW1zLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgICAgICAgaWYgKGkgaW4gaXRlbXMgJiYgaXRlbXNbaV0gPT09IG5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VuZFRvTmF0aXZlKHBhdGgsIHZhbHVlKSB7XG4gICAgaWYgKHdpbmRvdy5tUGFydGljbGVBbmRyb2lkICYmIHdpbmRvdy5tUGFydGljbGVBbmRyb2lkLmhhc093blByb3BlcnR5KHBhdGgpKSB7XG4gICAgICAgIGxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZEFuZHJvaWQgKyBwYXRoKTtcbiAgICAgICAgd2luZG93Lm1QYXJ0aWNsZUFuZHJvaWRbcGF0aF0odmFsdWUpO1xuICAgIH1cbiAgICBlbHNlIGlmICh3aW5kb3cubVBhcnRpY2xlLmlzSU9TKSB7XG4gICAgICAgIGxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU2VuZElPUyArIHBhdGgpO1xuICAgICAgICB2YXIgaWZyYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnSUZSQU1FJyk7XG4gICAgICAgIGlmcmFtZS5zZXRBdHRyaWJ1dGUoJ3NyYycsICdtcC1zZGs6Ly8nICsgcGF0aCArICcvJyArIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkpO1xuICAgICAgICBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuYXBwZW5kQ2hpbGQoaWZyYW1lKTtcbiAgICAgICAgaWZyYW1lLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoaWZyYW1lKTtcbiAgICAgICAgaWZyYW1lID0gbnVsbDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNlcnZpY2VVcmwoc2VjdXJlU2VydmljZVVybCwgc2VydmljZVVybCwgZGV2VG9rZW4pIHtcbiAgICBpZiAobVBhcnRpY2xlLmZvcmNlSHR0cHMpIHtcbiAgICAgICAgcmV0dXJuICdodHRwczovLycgKyBzZWN1cmVTZXJ2aWNlVXJsICsgZGV2VG9rZW47XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHNlcnZpY2VTY2hlbWUgKyAoKHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCA9PT0gJ2h0dHBzOicpID8gc2VjdXJlU2VydmljZVVybCA6IHNlcnZpY2VVcmwpICsgZGV2VG9rZW47XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzaG91bGRVc2VOYXRpdmVTZGsoKSB7XG4gICAgaWYgKG1QYXJ0aWNsZS51c2VOYXRpdmVTZGsgfHwgd2luZG93Lm1QYXJ0aWNsZUFuZHJvaWRcbiAgICAgICAgfHwgd2luZG93Lm1QYXJ0aWNsZS5pc0lPUykge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVhIUihjYikge1xuICAgIHZhciB4aHI7XG5cbiAgICB0cnkge1xuICAgICAgICB4aHIgPSBuZXcgd2luZG93LlhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIGxvZ0RlYnVnKCdFcnJvciBjcmVhdGluZyBYTUxIdHRwUmVxdWVzdCBvYmplY3QuJyk7XG4gICAgfVxuXG4gICAgaWYgKHhociAmJiBjYiAmJiAnd2l0aENyZWRlbnRpYWxzJyBpbiB4aHIpIHtcbiAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGNiO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygd2luZG93LlhEb21haW5SZXF1ZXN0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBsb2dEZWJ1ZygnQ3JlYXRpbmcgWERvbWFpblJlcXVlc3Qgb2JqZWN0Jyk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHhociA9IG5ldyB3aW5kb3cuWERvbWFpblJlcXVlc3QoKTtcbiAgICAgICAgICAgIHhoci5vbmxvYWQgPSBjYjtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgbG9nRGVidWcoJ0Vycm9yIGNyZWF0aW5nIFhEb21haW5SZXF1ZXN0IG9iamVjdCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHhocjtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVSYW5kb21WYWx1ZShhKSB7XG4gICAgaWYgKHdpbmRvdy5jcnlwdG8gJiYgd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXMpIHtcbiAgICAgICAgcmV0dXJuIChhIF4gd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMSkpWzBdICUgMTYgPj4gYS80KS50b1N0cmluZygxNik7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW5kZWZcbiAgICB9XG5cbiAgICByZXR1cm4gKGEgXiBNYXRoLnJhbmRvbSgpICogMTYgPj4gYS80KS50b1N0cmluZygxNik7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlVW5pcXVlSWQoYSkge1xuICAgIC8vIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL2plZC85ODI4ODNcbiAgICAvLyBBZGRlZCBzdXBwb3J0IGZvciBjcnlwdG8gZm9yIGJldHRlciByYW5kb21cblxuICAgIHJldHVybiBhICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGlmIHRoZSBwbGFjZWhvbGRlciB3YXMgcGFzc2VkLCByZXR1cm5cbiAgICAgICAgICAgID8gZ2VuZXJhdGVSYW5kb21WYWx1ZShhKSAgICAvLyBhIHJhbmRvbSBudW1iZXJcbiAgICAgICAgICAgIDogKCAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvciBvdGhlcndpc2UgYSBjb25jYXRlbmF0ZWQgc3RyaW5nOlxuICAgICAgICAgICAgWzFlN10gKyAgICAgICAgICAgICAgICAgICAgIC8vIDEwMDAwMDAwICtcbiAgICAgICAgICAgIC0xZTMgKyAgICAgICAgICAgICAgICAgICAgICAvLyAtMTAwMCArXG4gICAgICAgICAgICAtNGUzICsgICAgICAgICAgICAgICAgICAgICAgLy8gLTQwMDAgK1xuICAgICAgICAgICAgLThlMyArICAgICAgICAgICAgICAgICAgICAgIC8vIC04MDAwMDAwMCArXG4gICAgICAgICAgICAtMWUxMSAgICAgICAgICAgICAgICAgICAgICAgLy8gLTEwMDAwMDAwMDAwMCxcbiAgICAgICAgICAgICkucmVwbGFjZSggICAgICAgICAgICAgICAgICAvLyByZXBsYWNpbmdcbiAgICAgICAgICAgICAgICAvWzAxOF0vZywgICAgICAgICAgICAgICAvLyB6ZXJvZXMsIG9uZXMsIGFuZCBlaWdodHMgd2l0aFxuICAgICAgICAgICAgICAgIGdlbmVyYXRlVW5pcXVlSWQgICAgICAgIC8vIHJhbmRvbSBoZXggZGlnaXRzXG4gICAgICAgICAgICApO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJVc2VySWRlbnRpdGllcyh1c2VySWRlbnRpdGllc09iamVjdCwgZmlsdGVyTGlzdCkge1xuICAgIHZhciBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzID0gW107XG5cbiAgICBpZiAodXNlcklkZW50aXRpZXNPYmplY3QgJiYgT2JqZWN0LmtleXModXNlcklkZW50aXRpZXNPYmplY3QpLmxlbmd0aCkge1xuICAgICAgICBmb3IgKHZhciB1c2VySWRlbnRpdHlOYW1lIGluIHVzZXJJZGVudGl0aWVzT2JqZWN0KSB7XG4gICAgICAgICAgICBpZiAodXNlcklkZW50aXRpZXNPYmplY3QuaGFzT3duUHJvcGVydHkodXNlcklkZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgdXNlcklkZW50aXR5VHlwZSA9IFR5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eVR5cGUodXNlcklkZW50aXR5TmFtZSk7XG4gICAgICAgICAgICAgICAgaWYgKCFpbkFycmF5KGZpbHRlckxpc3QsIHVzZXJJZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpZGVudGl0eSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFR5cGU6IHVzZXJJZGVudGl0eVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBJZGVudGl0eTogdXNlcklkZW50aXRpZXNPYmplY3RbdXNlcklkZW50aXR5TmFtZV1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZXJJZGVudGl0eVR5cGUgPT09IG1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuQ3VzdG9tZXJJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllcy51bnNoaWZ0KGlkZW50aXR5KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbHRlcmVkVXNlcklkZW50aXRpZXMucHVzaChpZGVudGl0eSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsdGVyZWRVc2VySWRlbnRpdGllcztcbn1cblxuZnVuY3Rpb24gZmlsdGVyVXNlcklkZW50aXRpZXNGb3JGb3J3YXJkZXJzKHVzZXJJZGVudGl0aWVzT2JqZWN0LCBmaWx0ZXJMaXN0KSB7XG4gICAgdmFyIGZpbHRlcmVkVXNlcklkZW50aXRpZXMgPSB7fTtcblxuICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdCAmJiBPYmplY3Qua2V5cyh1c2VySWRlbnRpdGllc09iamVjdCkubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIHVzZXJJZGVudGl0eU5hbWUgaW4gdXNlcklkZW50aXRpZXNPYmplY3QpIHtcbiAgICAgICAgICAgIGlmICh1c2VySWRlbnRpdGllc09iamVjdC5oYXNPd25Qcm9wZXJ0eSh1c2VySWRlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWRlbnRpdHlUeXBlID0gVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZSh1c2VySWRlbnRpdHlOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAoIWluQXJyYXkoZmlsdGVyTGlzdCwgdXNlcklkZW50aXR5VHlwZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VySWRlbnRpdGllc1t1c2VySWRlbnRpdHlOYW1lXSA9IHVzZXJJZGVudGl0aWVzT2JqZWN0W3VzZXJJZGVudGl0eU5hbWVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWx0ZXJlZFVzZXJJZGVudGl0aWVzO1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJVc2VyQXR0cmlidXRlcyh1c2VyQXR0cmlidXRlcywgZmlsdGVyTGlzdCkge1xuICAgIHZhciBmaWx0ZXJlZFVzZXJBdHRyaWJ1dGVzID0ge307XG5cbiAgICBpZiAodXNlckF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXModXNlckF0dHJpYnV0ZXMpLmxlbmd0aCkge1xuICAgICAgICBmb3IgKHZhciB1c2VyQXR0cmlidXRlIGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkodXNlckF0dHJpYnV0ZSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgaGFzaGVkVXNlckF0dHJpYnV0ZSA9IGdlbmVyYXRlSGFzaCh1c2VyQXR0cmlidXRlKTtcbiAgICAgICAgICAgICAgICBpZiAoIWluQXJyYXkoZmlsdGVyTGlzdCwgaGFzaGVkVXNlckF0dHJpYnV0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyZWRVc2VyQXR0cmlidXRlc1t1c2VyQXR0cmlidXRlXSA9IHVzZXJBdHRyaWJ1dGVzW3VzZXJBdHRyaWJ1dGVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWx0ZXJlZFVzZXJBdHRyaWJ1dGVzO1xufVxuXG5mdW5jdGlvbiBmaW5kS2V5SW5PYmplY3Qob2JqLCBrZXkpIHtcbiAgICBpZiAoa2V5ICYmIG9iaikge1xuICAgICAgICBmb3IgKHZhciBwcm9wIGluIG9iaikge1xuICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShwcm9wKSAmJiBwcm9wLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb3A7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gZGVjb2RlZChzKSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzLnJlcGxhY2UocGx1c2VzLCAnICcpKTtcbn1cblxuZnVuY3Rpb24gY29udmVydGVkKHMpIHtcbiAgICBpZiAocy5pbmRleE9mKCdcIicpID09PSAwKSB7XG4gICAgICAgIHMgPSBzLnNsaWNlKDEsIC0xKS5yZXBsYWNlKC9cXFxcXCIvZywgJ1wiJykucmVwbGFjZSgvXFxcXFxcXFwvZywgJ1xcXFwnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gaXNFdmVudFR5cGUodHlwZSkge1xuICAgIGZvciAodmFyIHByb3AgaW4gVHlwZXMuRXZlbnRUeXBlKSB7XG4gICAgICAgIGlmIChUeXBlcy5FdmVudFR5cGUuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgIGlmIChUeXBlcy5FdmVudFR5cGVbcHJvcF0gPT09IHR5cGUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHBhcnNlTnVtYmVyKHZhbHVlKSB7XG4gICAgaWYgKGlzTmFOKHZhbHVlKSB8fCAhaXNGaW5pdGUodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cbiAgICB2YXIgZmxvYXRWYWx1ZSA9IHBhcnNlRmxvYXQodmFsdWUpO1xuICAgIHJldHVybiBpc05hTihmbG9hdFZhbHVlKSA/IDAgOiBmbG9hdFZhbHVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVN0cmluZ09yTnVtYmVyKHZhbHVlKSB7XG4gICAgaWYgKFZhbGlkYXRvcnMuaXNTdHJpbmdPck51bWJlcih2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVIYXNoKG5hbWUpIHtcbiAgICB2YXIgaGFzaCA9IDAsXG4gICAgICAgIGkgPSAwLFxuICAgICAgICBjaGFyYWN0ZXI7XG5cbiAgICBpZiAoIW5hbWUpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgbmFtZSA9IG5hbWUudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgaWYgKEFycmF5LnByb3RvdHlwZS5yZWR1Y2UpIHtcbiAgICAgICAgcmV0dXJuIG5hbWUuc3BsaXQoJycpLnJlZHVjZShmdW5jdGlvbihhLCBiKSB7IGEgPSAoKGEgPDwgNSkgLSBhKSArIGIuY2hhckNvZGVBdCgwKTsgcmV0dXJuIGEgJiBhOyB9LCAwKTtcbiAgICB9XG5cbiAgICBpZiAobmFtZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGhhc2g7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMDsgaSA8IG5hbWUubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY2hhcmFjdGVyID0gbmFtZS5jaGFyQ29kZUF0KGkpO1xuICAgICAgICBoYXNoID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgKyBjaGFyYWN0ZXI7XG4gICAgICAgIGhhc2ggPSBoYXNoICYgaGFzaDtcbiAgICB9XG5cbiAgICByZXR1cm4gaGFzaDtcbn1cblxuZnVuY3Rpb24gc2FuaXRpemVBdHRyaWJ1dGVzKGF0dHJzKSB7XG4gICAgaWYgKCFhdHRycyB8fCAhaXNPYmplY3QoYXR0cnMpKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHZhciBzYW5pdGl6ZWRBdHRycyA9IHt9O1xuXG4gICAgZm9yICh2YXIgcHJvcCBpbiBhdHRycykge1xuICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCBhdHRyaWJ1dGUgdmFsdWVzIGFyZSBub3Qgb2JqZWN0cyBvciBhcnJheXMsIHdoaWNoIGFyZSBub3QgdmFsaWRcbiAgICAgICAgaWYgKGF0dHJzLmhhc093blByb3BlcnR5KHByb3ApICYmIFZhbGlkYXRvcnMuaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKGF0dHJzW3Byb3BdKSkge1xuICAgICAgICAgICAgc2FuaXRpemVkQXR0cnNbcHJvcF0gPSBhdHRyc1twcm9wXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvZ0RlYnVnKCdUaGUgYXR0cmlidXRlIGtleSBvZiAnICsgcHJvcCArICcgbXVzdCBiZSBhIHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBvciBudWxsLicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNhbml0aXplZEF0dHJzO1xufVxuXG5mdW5jdGlvbiBtZXJnZUNvbmZpZyhjb25maWcpIHtcbiAgICBsb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkxvYWRpbmdDb25maWcpO1xuXG4gICAgZm9yICh2YXIgcHJvcCBpbiBDb25zdGFudHMuRGVmYXVsdENvbmZpZykge1xuICAgICAgICBpZiAoQ29uc3RhbnRzLkRlZmF1bHRDb25maWcuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgIE1QLkNvbmZpZ1twcm9wXSA9IENvbnN0YW50cy5EZWZhdWx0Q29uZmlnW3Byb3BdO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgTVAuQ29uZmlnW3Byb3BdID0gY29uZmlnW3Byb3BdO1xuICAgICAgICB9XG4gICAgfVxufVxuXG52YXIgVmFsaWRhdG9ycyA9IHtcbiAgICBpc1ZhbGlkQXR0cmlidXRlVmFsdWU6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmICFpc09iamVjdCh2YWx1ZSkgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpO1xuICAgIH0sXG5cbiAgICAvLyBOZWl0aGVyIG51bGwgbm9yIHVuZGVmaW5lZCBjYW4gYmUgYSB2YWxpZCBLZXlcbiAgICBpc1ZhbGlkS2V5VmFsdWU6IGZ1bmN0aW9uKGtleSkge1xuICAgICAgICByZXR1cm4gQm9vbGVhbihrZXkgJiYgIWlzT2JqZWN0KGtleSkgJiYgIUFycmF5LmlzQXJyYXkoa2V5KSk7XG4gICAgfSxcblxuICAgIGlzU3RyaW5nT3JOdW1iZXI6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyB8fCB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKTtcbiAgICB9LFxuXG4gICAgaXNGdW5jdGlvbjogZnVuY3Rpb24oZm4pIHtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiBmbiA9PT0gJ2Z1bmN0aW9uJztcbiAgICB9LFxuXG4gICAgdmFsaWRhdGVJZGVudGl0aWVzOiBmdW5jdGlvbihpZGVudGl0eUFwaURhdGEsIG1ldGhvZCkge1xuICAgICAgICB2YXIgdmFsaWRJZGVudGl0eVJlcXVlc3RLZXlzID0ge1xuICAgICAgICAgICAgdXNlcklkZW50aXRpZXM6IDEsXG4gICAgICAgICAgICBvblVzZXJBbGlhczogMSxcbiAgICAgICAgICAgIGNvcHlVc2VyQXR0cmlidXRlczogMVxuICAgICAgICB9O1xuICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgICAgICAgICBpZiAobWV0aG9kID09PSAnbW9kaWZ5Jykge1xuICAgICAgICAgICAgICAgIGlmIChpc09iamVjdChpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpICYmICFPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpLmxlbmd0aCB8fCAhaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuTW9kaWZ5SWRlbnRpdHlSZXF1ZXN0VXNlcklkZW50aXRpZXNQcmVzZW50XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGlkZW50aXR5QXBpRGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXZhbGlkSWRlbnRpdHlSZXF1ZXN0S2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5JZGVudGl0eVJlcXVlc2V0SW52YWxpZEtleVxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSAnb25Vc2VyQWxpYXMnICYmICFWYWxpZGF0b3JzLmlzRnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhW2tleV0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogQ29uc3RhbnRzLk1lc3NhZ2VzLlZhbGlkYXRpb25NZXNzYWdlcy5PblVzZXJBbGlhc1R5cGUgKyB0eXBlb2YgaWRlbnRpdHlBcGlEYXRhW2tleV1cbiAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoaWRlbnRpdHlBcGlEYXRhKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB2YWxpZDogdHJ1ZVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyBjYW4ndCBiZSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLlVzZXJJZGVudGl0aWVzXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgLy8gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzIGNhbiBiZSBudWxsLCBidXQgaWYgaXQgaXNuJ3QgbnVsbCBvciB1bmRlZmluZWQgKGFib3ZlIGNvbmRpdGlvbmFsKSwgaXQgbXVzdCBiZSBhbiBvYmplY3RcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyAhPT0gbnVsbCAmJiAhaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGlzT2JqZWN0KGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykgJiYgT2JqZWN0LmtleXMoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHlUeXBlIGluIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFR5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eVR5cGUoaWRlbnRpdHlUeXBlKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBDb25zdGFudHMuTWVzc2FnZXMuVmFsaWRhdGlvbk1lc3NhZ2VzLlVzZXJJZGVudGl0aWVzSW52YWxpZEtleVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoISh0eXBlb2YgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzW2lkZW50aXR5VHlwZV0gPT09ICdzdHJpbmcnIHx8IGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllc1tpZGVudGl0eVR5cGVdID09PSBudWxsKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IENvbnN0YW50cy5NZXNzYWdlcy5WYWxpZGF0aW9uTWVzc2FnZXMuVXNlcklkZW50aXRpZXNJbnZhbGlkVmFsdWVzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB2YWxpZDogdHJ1ZVxuICAgICAgICB9O1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGxvZ0RlYnVnOiBsb2dEZWJ1ZyxcbiAgICBjYW5Mb2c6IGNhbkxvZyxcbiAgICBleHRlbmQ6IGV4dGVuZCxcbiAgICBpc09iamVjdDogaXNPYmplY3QsXG4gICAgaW5BcnJheTogaW5BcnJheSxcbiAgICBzaG91bGRVc2VOYXRpdmVTZGs6IHNob3VsZFVzZU5hdGl2ZVNkayxcbiAgICBzZW5kVG9OYXRpdmU6IHNlbmRUb05hdGl2ZSxcbiAgICBjcmVhdGVTZXJ2aWNlVXJsOiBjcmVhdGVTZXJ2aWNlVXJsLFxuICAgIGNyZWF0ZVhIUjogY3JlYXRlWEhSLFxuICAgIGdlbmVyYXRlVW5pcXVlSWQ6IGdlbmVyYXRlVW5pcXVlSWQsXG4gICAgZmlsdGVyVXNlcklkZW50aXRpZXM6IGZpbHRlclVzZXJJZGVudGl0aWVzLFxuICAgIGZpbHRlclVzZXJJZGVudGl0aWVzRm9yRm9yd2FyZGVyczogZmlsdGVyVXNlcklkZW50aXRpZXNGb3JGb3J3YXJkZXJzLFxuICAgIGZpbHRlclVzZXJBdHRyaWJ1dGVzOiBmaWx0ZXJVc2VyQXR0cmlidXRlcyxcbiAgICBmaW5kS2V5SW5PYmplY3Q6IGZpbmRLZXlJbk9iamVjdCxcbiAgICBkZWNvZGVkOiBkZWNvZGVkLFxuICAgIGNvbnZlcnRlZDogY29udmVydGVkLFxuICAgIGlzRXZlbnRUeXBlOiBpc0V2ZW50VHlwZSxcbiAgICBwYXJzZU51bWJlcjogcGFyc2VOdW1iZXIsXG4gICAgcGFyc2VTdHJpbmdPck51bWJlcjogcGFyc2VTdHJpbmdPck51bWJlcixcbiAgICBnZW5lcmF0ZUhhc2g6IGdlbmVyYXRlSGFzaCxcbiAgICBzYW5pdGl6ZUF0dHJpYnV0ZXM6IHNhbml0aXplQXR0cmlidXRlcyxcbiAgICBtZXJnZUNvbmZpZzogbWVyZ2VDb25maWcsXG4gICAgaW52b2tlQ2FsbGJhY2s6IGludm9rZUNhbGxiYWNrLFxuICAgIGhhc0ZlYXR1cmVGbGFnOiBoYXNGZWF0dXJlRmxhZyxcbiAgICBWYWxpZGF0b3JzOiBWYWxpZGF0b3JzXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBDb25zdGFudHMgPSByZXF1aXJlKCcuL2NvbnN0YW50cycpLFxuICAgIFNlcnZlck1vZGVsID0gcmVxdWlyZSgnLi9zZXJ2ZXJNb2RlbCcpLFxuICAgIEZvcndhcmRlcnMgPSByZXF1aXJlKCcuL2ZvcndhcmRlcnMnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBUeXBlcyA9IHJlcXVpcmUoJy4vdHlwZXMnKSxcbiAgICBNZXNzYWdlcyA9IENvbnN0YW50cy5NZXNzYWdlcyxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBWYWxpZGF0b3JzID0gSGVscGVycy5WYWxpZGF0b3JzLFxuICAgIHNlbmRJZGVudGl0eVJlcXVlc3QgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLnNlbmRJZGVudGl0eVJlcXVlc3QsXG4gICAgQ29va2llU3luY01hbmFnZXIgPSByZXF1aXJlKCcuL2Nvb2tpZVN5bmNNYW5hZ2VyJyksXG4gICAgc2VuZEV2ZW50VG9TZXJ2ZXIgPSByZXF1aXJlKCcuL2FwaUNsaWVudCcpLnNlbmRFdmVudFRvU2VydmVyLFxuICAgIEhUVFBDb2RlcyA9IENvbnN0YW50cy5IVFRQQ29kZXMsXG4gICAgRXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKSxcbiAgICBzZW5kRXZlbnRUb0ZvcndhcmRlcnMgPSByZXF1aXJlKCcuL2ZvcndhcmRlcnMnKS5zZW5kRXZlbnRUb0ZvcndhcmRlcnM7XG5cbnZhciBJZGVudGl0eSA9IHtcbiAgICBjaGVja0lkZW50aXR5U3dhcDogZnVuY3Rpb24ocHJldmlvdXNNUElELCBjdXJyZW50TVBJRCkge1xuICAgICAgICBpZiAocHJldmlvdXNNUElEICYmIGN1cnJlbnRNUElEICYmIHByZXZpb3VzTVBJRCAhPT0gY3VycmVudE1QSUQpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UudXNlTG9jYWxTdG9yYWdlKCkgPyBQZXJzaXN0ZW5jZS5nZXRMb2NhbFN0b3JhZ2UoKSA6IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpO1xuICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgY3VycmVudE1QSUQpO1xuICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG52YXIgSWRlbnRpdHlSZXF1ZXN0ID0ge1xuICAgIGNyZWF0ZUtub3duSWRlbnRpdGllczogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBkZXZpY2VJZCkge1xuICAgICAgICB2YXIgaWRlbnRpdGllc1Jlc3VsdCA9IHt9O1xuXG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QoaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHkgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWRlbnRpdGllc1Jlc3VsdFtpZGVudGl0eV0gPSBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNbaWRlbnRpdHldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlkZW50aXRpZXNSZXN1bHQuZGV2aWNlX2FwcGxpY2F0aW9uX3N0YW1wID0gZGV2aWNlSWQ7XG5cbiAgICAgICAgcmV0dXJuIGlkZW50aXRpZXNSZXN1bHQ7XG4gICAgfSxcblxuICAgIHByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3Q6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssIG1ldGhvZCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuU3RhcnRpbmdMb2dFdmVudCArICc6ICcgKyBtZXRob2QpO1xuXG4gICAgICAgIHZhciBpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQgPSBWYWxpZGF0b3JzLnZhbGlkYXRlSWRlbnRpdGllcyhpZGVudGl0eUFwaURhdGEsIG1ldGhvZCk7XG5cbiAgICAgICAgaWYgKCFpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQudmFsaWQpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0VSUk9SOiAnICsgaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdmFsaWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGVycm9yOiBpZGVudGl0eVZhbGlkYXRpb25SZXN1bHQuZXJyb3JcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2FsbGJhY2sgJiYgIVZhbGlkYXRvcnMuaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgIHZhciBlcnJvciA9ICdUaGUgb3B0aW9uYWwgY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uLiBZb3UgdHJpZWQgZW50ZXJpbmcgYShuKSAnICsgdHlwZW9mIGNhbGxiYWNrO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhlcnJvcik7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHZhbGlkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3JcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaWRlbnRpdHlWYWxpZGF0aW9uUmVzdWx0Lndhcm5pbmcpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1dBUk5JTkc6JyArIGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC53YXJuaW5nKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdmFsaWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgZXJyb3I6IGlkZW50aXR5VmFsaWRhdGlvblJlc3VsdC53YXJuaW5nXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbGlkOiB0cnVlXG4gICAgICAgIH07XG4gICAgfSxcblxuICAgIGNyZWF0ZUlkZW50aXR5UmVxdWVzdDogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBwbGF0Zm9ybSwgc2RrVmVuZG9yLCBzZGtWZXJzaW9uLCBkZXZpY2VJZCwgY29udGV4dCwgbXBpZCkge1xuICAgICAgICB2YXIgQVBJUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIGNsaWVudF9zZGs6IHtcbiAgICAgICAgICAgICAgICBwbGF0Zm9ybTogcGxhdGZvcm0sXG4gICAgICAgICAgICAgICAgc2RrX3ZlbmRvcjogc2RrVmVuZG9yLFxuICAgICAgICAgICAgICAgIHNka192ZXJzaW9uOiBzZGtWZXJzaW9uXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgPyAnZGV2ZWxvcG1lbnQnIDogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICAgICAgcmVxdWVzdF9pZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICByZXF1ZXN0X3RpbWVzdGFtcF9tczogbmV3IERhdGUoKS5nZXRUaW1lKCksXG4gICAgICAgICAgICBwcmV2aW91c19tcGlkOiBtcGlkIHx8IG51bGwsXG4gICAgICAgICAgICBrbm93bl9pZGVudGl0aWVzOiB0aGlzLmNyZWF0ZUtub3duSWRlbnRpdGllcyhpZGVudGl0eUFwaURhdGEsIGRldmljZUlkKVxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBBUElSZXF1ZXN0O1xuICAgIH0sXG5cbiAgICBjcmVhdGVNb2RpZnlJZGVudGl0eVJlcXVlc3Q6IGZ1bmN0aW9uKGN1cnJlbnRVc2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMsIHBsYXRmb3JtLCBzZGtWZW5kb3IsIHNka1ZlcnNpb24sIGNvbnRleHQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNsaWVudF9zZGs6IHtcbiAgICAgICAgICAgICAgICBwbGF0Zm9ybTogcGxhdGZvcm0sXG4gICAgICAgICAgICAgICAgc2RrX3ZlbmRvcjogc2RrVmVuZG9yLFxuICAgICAgICAgICAgICAgIHNka192ZXJzaW9uOiBzZGtWZXJzaW9uXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgPyAnZGV2ZWxvcG1lbnQnIDogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICAgICAgcmVxdWVzdF9pZDogSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCksXG4gICAgICAgICAgICByZXF1ZXN0X3RpbWVzdGFtcF9tczogbmV3IERhdGUoKS5nZXRUaW1lKCksXG4gICAgICAgICAgICBpZGVudGl0eV9jaGFuZ2VzOiB0aGlzLmNyZWF0ZUlkZW50aXR5Q2hhbmdlcyhjdXJyZW50VXNlcklkZW50aXRpZXMsIG5ld1VzZXJJZGVudGl0aWVzKVxuICAgICAgICB9O1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZGVudGl0eUNoYW5nZXM6IGZ1bmN0aW9uKHByZXZpb3VzSWRlbnRpdGllcywgbmV3SWRlbnRpdGllcykge1xuICAgICAgICB2YXIgaWRlbnRpdHlDaGFuZ2VzID0gW107XG4gICAgICAgIHZhciBrZXk7XG4gICAgICAgIGlmIChuZXdJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QobmV3SWRlbnRpdGllcykgJiYgcHJldmlvdXNJZGVudGl0aWVzICYmIEhlbHBlcnMuaXNPYmplY3QocHJldmlvdXNJZGVudGl0aWVzKSkge1xuICAgICAgICAgICAgZm9yIChrZXkgaW4gbmV3SWRlbnRpdGllcykge1xuICAgICAgICAgICAgICAgIGlkZW50aXR5Q2hhbmdlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgb2xkX3ZhbHVlOiBwcmV2aW91c0lkZW50aXRpZXNbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShrZXkpXSB8fCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBuZXdfdmFsdWU6IG5ld0lkZW50aXRpZXNba2V5XSxcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlfdHlwZToga2V5XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaWRlbnRpdHlDaGFuZ2VzO1xuICAgIH0sXG5cbiAgICBtb2RpZnlVc2VySWRlbnRpdGllczogZnVuY3Rpb24ocHJldmlvdXNVc2VySWRlbnRpdGllcywgbmV3VXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgdmFyIG1vZGlmaWVkVXNlcklkZW50aXRpZXMgPSB7fTtcblxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gbmV3VXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgIG1vZGlmaWVkVXNlcklkZW50aXRpZXNbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZShrZXkpXSA9IG5ld1VzZXJJZGVudGl0aWVzW2tleV07XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGtleSBpbiBwcmV2aW91c1VzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoIW1vZGlmaWVkVXNlcklkZW50aXRpZXNba2V5XSkge1xuICAgICAgICAgICAgICAgIG1vZGlmaWVkVXNlcklkZW50aXRpZXNba2V5XSA9IHByZXZpb3VzVXNlcklkZW50aXRpZXNba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtb2RpZmllZFVzZXJJZGVudGl0aWVzO1xuICAgIH0sXG5cbiAgICBjb252ZXJ0VG9OYXRpdmU6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSkge1xuICAgICAgICB2YXIgbmF0aXZlSWRlbnRpdHlSZXF1ZXN0ID0gW107XG4gICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIG5hdGl2ZUlkZW50aXR5UmVxdWVzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFR5cGU6IFR5cGVzLklkZW50aXR5VHlwZS5nZXRJZGVudGl0eVR5cGUoa2V5KSxcbiAgICAgICAgICAgICAgICAgICAgICAgIElkZW50aXR5OiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXNba2V5XVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgVXNlcklkZW50aXRpZXM6IG5hdGl2ZUlkZW50aXR5UmVxdWVzdFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbn07XG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eSBvYmplY3QuXG4qIEV4YW1wbGU6IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLlxuKiBAY2xhc3MgbVBhcnRpY2xlLklkZW50aXR5XG4qL1xudmFyIElkZW50aXR5QVBJID0ge1xuICAgIEhUVFBDb2RlczogSFRUUENvZGVzLFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBsb2dvdXQgcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBpZGVudGlmeVxuICAgICogQHBhcmFtIHtPYmplY3R9IGlkZW50aXR5QXBpRGF0YSBUaGUgaWRlbnRpdHlBcGlEYXRhIG9iamVjdCBhcyBpbmRpY2F0ZWQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL1JFQURNRS5tZCMxLWN1c3RvbWl6ZS10aGUtc2RrKVxuICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBBIGNhbGxiYWNrIGZ1bmN0aW9uIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGlkZW50aWZ5IHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBpZGVudGlmeTogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcHJlUHJvY2Vzc1Jlc3VsdCA9IElkZW50aXR5UmVxdWVzdC5wcmVQcm9jZXNzSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssICdpZGVudGlmeScpO1xuXG4gICAgICAgIGlmIChwcmVQcm9jZXNzUmVzdWx0LnZhbGlkKSB7XG4gICAgICAgICAgICB2YXIgaWRlbnRpdHlBcGlSZXF1ZXN0ID0gSWRlbnRpdHlSZXF1ZXN0LmNyZWF0ZUlkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIENvbnN0YW50cy5wbGF0Zm9ybSwgQ29uc3RhbnRzLnNka1ZlbmRvciwgQ29uc3RhbnRzLnNka1ZlcnNpb24sIE1QLmRldmljZUlkLCBNUC5jb250ZXh0LCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuSWRlbnRpZnksIEpTT04uc3RyaW5naWZ5KElkZW50aXR5UmVxdWVzdC5jb252ZXJ0VG9OYXRpdmUoaWRlbnRpdHlBcGlEYXRhKSkpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubmF0aXZlSWRlbnRpdHlSZXF1ZXN0LCAnSWRlbnRpZnkgcmVxdWVzdCBzZW50IHRvIG5hdGl2ZSBzZGsnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzZW5kSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpUmVxdWVzdCwgJ2lkZW50aWZ5JywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogSW5pdGlhdGUgYSBsb2dvdXQgcmVxdWVzdCB0byB0aGUgbVBhcnRpY2xlIHNlcnZlclxuICAgICogQG1ldGhvZCBsb2dvdXRcbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBpZGVudGl0eUFwaURhdGEgVGhlIGlkZW50aXR5QXBpRGF0YSBvYmplY3QgYXMgaW5kaWNhdGVkIFtoZXJlXShodHRwczovL2dpdGh1Yi5jb20vbVBhcnRpY2xlL21wYXJ0aWNsZS1zZGstamF2YXNjcmlwdC9ibG9iL21hc3Rlci12Mi9SRUFETUUubWQjMS1jdXN0b21pemUtdGhlLXNkaylcbiAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gQSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGlzIGNhbGxlZCB3aGVuIHRoZSBsb2dvdXQgcmVxdWVzdCBjb21wbGV0ZXNcbiAgICAqL1xuICAgIGxvZ291dDogZnVuY3Rpb24oaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcHJlUHJvY2Vzc1Jlc3VsdCA9IElkZW50aXR5UmVxdWVzdC5wcmVQcm9jZXNzSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2ssICdsb2dvdXQnKTtcblxuICAgICAgICBpZiAocHJlUHJvY2Vzc1Jlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgdmFyIGV2dCxcbiAgICAgICAgICAgICAgICBpZGVudGl0eUFwaVJlcXVlc3QgPSBJZGVudGl0eVJlcXVlc3QuY3JlYXRlSWRlbnRpdHlSZXF1ZXN0KGlkZW50aXR5QXBpRGF0YSwgQ29uc3RhbnRzLnBsYXRmb3JtLCBDb25zdGFudHMuc2RrVmVuZG9yLCBDb25zdGFudHMuc2RrVmVyc2lvbiwgTVAuZGV2aWNlSWQsIE1QLmNvbnRleHQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5Mb2dvdXQsIEpTT04uc3RyaW5naWZ5KElkZW50aXR5UmVxdWVzdC5jb252ZXJ0VG9OYXRpdmUoaWRlbnRpdHlBcGlEYXRhKSkpO1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubmF0aXZlSWRlbnRpdHlSZXF1ZXN0LCAnTG9nb3V0IHJlcXVlc3Qgc2VudCB0byBuYXRpdmUgc2RrJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc2VuZElkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaVJlcXVlc3QsICdsb2dvdXQnLCBjYWxsYmFjaywgaWRlbnRpdHlBcGlEYXRhLCBwYXJzZUlkZW50aXR5UmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgICAgICBldnQgPSBTZXJ2ZXJNb2RlbC5jcmVhdGVFdmVudE9iamVjdChUeXBlcy5NZXNzYWdlVHlwZS5Qcm9maWxlKTtcbiAgICAgICAgICAgICAgICAgICAgZXZ0LlByb2ZpbGVNZXNzYWdlVHlwZSA9IFR5cGVzLlByb2ZpbGVNZXNzYWdlVHlwZS5Mb2dvdXQ7XG4gICAgICAgICAgICAgICAgICAgIGlmIChNUC5hY3RpdmVGb3J3YXJkZXJzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgTVAuYWN0aXZlRm9yd2FyZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcndhcmRlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmb3J3YXJkZXIubG9nT3V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvcndhcmRlci5sb2dPdXQoZXZ0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy5sb2dnaW5nRGlzYWJsZWRPck1pc3NpbmdBUElLZXksIE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvbkxvZ0V2ZW50KTtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvbkxvZ0V2ZW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIEhUVFBDb2Rlcy52YWxpZGF0aW9uSXNzdWUsIHByZVByb2Nlc3NSZXN1bHQuZXJyb3IpO1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhwcmVQcm9jZXNzUmVzdWx0KTtcbiAgICAgICAgfVxuICAgIH0sXG4gICAgLyoqXG4gICAgKiBJbml0aWF0ZSBhIGxvZ2luIHJlcXVlc3QgdG8gdGhlIG1QYXJ0aWNsZSBzZXJ2ZXJcbiAgICAqIEBtZXRob2QgbG9naW5cbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBpZGVudGl0eUFwaURhdGEgVGhlIGlkZW50aXR5QXBpRGF0YSBvYmplY3QgYXMgaW5kaWNhdGVkIFtoZXJlXShodHRwczovL2dpdGh1Yi5jb20vbVBhcnRpY2xlL21wYXJ0aWNsZS1zZGstamF2YXNjcmlwdC9ibG9iL21hc3Rlci12Mi9SRUFETUUubWQjMS1jdXN0b21pemUtdGhlLXNkaylcbiAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gQSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGlzIGNhbGxlZCB3aGVuIHRoZSBsb2dpbiByZXF1ZXN0IGNvbXBsZXRlc1xuICAgICovXG4gICAgbG9naW46IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHByZVByb2Nlc3NSZXN1bHQgPSBJZGVudGl0eVJlcXVlc3QucHJlUHJvY2Vzc0lkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaURhdGEsIGNhbGxiYWNrLCAnbG9naW4nKTtcblxuICAgICAgICBpZiAocHJlUHJvY2Vzc1Jlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgdmFyIGlkZW50aXR5QXBpUmVxdWVzdCA9IElkZW50aXR5UmVxdWVzdC5jcmVhdGVJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlEYXRhLCBDb25zdGFudHMucGxhdGZvcm0sIENvbnN0YW50cy5zZGtWZW5kb3IsIENvbnN0YW50cy5zZGtWZXJzaW9uLCBNUC5kZXZpY2VJZCwgTVAuY29udGV4dCwgTVAubXBpZCk7XG5cbiAgICAgICAgICAgIGlmIChIZWxwZXJzLmNhbkxvZygpKSB7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLkxvZ2luLCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ0xvZ2luIHJlcXVlc3Qgc2VudCB0byBuYXRpdmUgc2RrJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc2VuZElkZW50aXR5UmVxdWVzdChpZGVudGl0eUFwaVJlcXVlc3QsICdsb2dpbicsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIHBhcnNlSWRlbnRpdHlSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLmxvZ2dpbmdEaXNhYmxlZE9yTWlzc2luZ0FQSUtleSwgTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5BYmFuZG9uTG9nRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLnZhbGlkYXRpb25Jc3N1ZSwgcHJlUHJvY2Vzc1Jlc3VsdC5lcnJvcik7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHByZVByb2Nlc3NSZXN1bHQpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICAvKipcbiAgICAqIEluaXRpYXRlIGEgbW9kaWZ5IHJlcXVlc3QgdG8gdGhlIG1QYXJ0aWNsZSBzZXJ2ZXJcbiAgICAqIEBtZXRob2QgbW9kaWZ5XG4gICAgKiBAcGFyYW0ge09iamVjdH0gaWRlbnRpdHlBcGlEYXRhIFRoZSBpZGVudGl0eUFwaURhdGEgb2JqZWN0IGFzIGluZGljYXRlZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvUkVBRE1FLm1kIzEtY3VzdG9taXplLXRoZS1zZGspXG4gICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIEEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdCBpcyBjYWxsZWQgd2hlbiB0aGUgbW9kaWZ5IHJlcXVlc3QgY29tcGxldGVzXG4gICAgKi9cbiAgICBtb2RpZnk6IGZ1bmN0aW9uKGlkZW50aXR5QXBpRGF0YSwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG5ld1VzZXJJZGVudGl0aWVzID0gKGlkZW50aXR5QXBpRGF0YSAmJiBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpID8gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzIDoge307XG4gICAgICAgIHZhciBwcmVQcm9jZXNzUmVzdWx0ID0gSWRlbnRpdHlSZXF1ZXN0LnByZVByb2Nlc3NJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlEYXRhLCBjYWxsYmFjaywgJ21vZGlmeScpO1xuICAgICAgICBpZiAocHJlUHJvY2Vzc1Jlc3VsdC52YWxpZCkge1xuICAgICAgICAgICAgdmFyIGlkZW50aXR5QXBpUmVxdWVzdCA9IElkZW50aXR5UmVxdWVzdC5jcmVhdGVNb2RpZnlJZGVudGl0eVJlcXVlc3QoTVAudXNlcklkZW50aXRpZXMsIG5ld1VzZXJJZGVudGl0aWVzLCBDb25zdGFudHMucGxhdGZvcm0sIENvbnN0YW50cy5zZGtWZW5kb3IsIENvbnN0YW50cy5zZGtWZXJzaW9uLCBNUC5jb250ZXh0KTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuTW9kaWZ5LCBKU09OLnN0cmluZ2lmeShJZGVudGl0eVJlcXVlc3QuY29udmVydFRvTmF0aXZlKGlkZW50aXR5QXBpRGF0YSkpKTtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5pbnZva2VDYWxsYmFjayhjYWxsYmFjaywgSFRUUENvZGVzLm5hdGl2ZUlkZW50aXR5UmVxdWVzdCwgJ01vZGlmeSByZXF1ZXN0IHNlbnQgdG8gbmF0aXZlIHNkaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbmRJZGVudGl0eVJlcXVlc3QoaWRlbnRpdHlBcGlSZXF1ZXN0LCAnbW9kaWZ5JywgY2FsbGJhY2ssIGlkZW50aXR5QXBpRGF0YSwgcGFyc2VJZGVudGl0eVJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMubG9nZ2luZ0Rpc2FibGVkT3JNaXNzaW5nQVBJS2V5LCBNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25Mb2dFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCBIVFRQQ29kZXMudmFsaWRhdGlvbklzc3VlLCBwcmVQcm9jZXNzUmVzdWx0LmVycm9yKTtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcocHJlUHJvY2Vzc1Jlc3VsdCk7XG4gICAgICAgIH1cbiAgICB9LFxuICAgIC8qKlxuICAgICogUmV0dXJucyBhIHVzZXIgb2JqZWN0IHdpdGggbWV0aG9kcyB0byBpbnRlcmFjdCB3aXRoIHRoZSBjdXJyZW50IHVzZXJcbiAgICAqIEBtZXRob2QgZ2V0Q3VycmVudFVzZXJcbiAgICAqIEByZXR1cm4ge09iamVjdH0gdGhlIGN1cnJlbnQgdXNlciBvYmplY3RcbiAgICAqL1xuICAgIGdldEN1cnJlbnRVc2VyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG1waWQgPSBNUC5tcGlkO1xuICAgICAgICBpZiAobXBpZCkge1xuICAgICAgICAgICAgbXBpZCA9IE1QLm1waWQuc2xpY2UoKTtcbiAgICAgICAgICAgIHJldHVybiBtUGFydGljbGVVc2VyKG1waWQpO1xuICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgICAgIHJldHVybiBtUGFydGljbGVVc2VyKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAqIFJldHVybnMgYSB0aGUgdXNlciBvYmplY3QgYXNzb2NpYXRlZCB3aXRoIHRoZSBtcGlkIHBhcmFtZXRlciBvciAnbnVsbCcgaWYgbm8gc3VjaFxuICAgICogdXNlciBleGlzdHNcbiAgICAqIEBtZXRob2QgZ2V0VXNlclxuICAgICogQHBhcmFtIHtTdHJpbmd9IG1waWQgb2YgdGhlIGRlc2lyZWQgdXNlclxuICAgICogQHJldHVybiB7T2JqZWN0fSB0aGUgdXNlciBmb3IgIG1waWRcbiAgICAqL1xuICAgIGdldFVzZXI6IGZ1bmN0aW9uKG1waWQpIHtcbiAgICAgICAgdmFyIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRQZXJzaXN0ZW5jZSgpO1xuICAgICAgICBpZiAoY29va2llc1ttcGlkXSAmJiAhQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgIHJldHVybiBtUGFydGljbGVVc2VyKG1waWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgKiBSZXR1cm5zIGFsbCB1c2VycywgaW5jbHVkaW5nIHRoZSBjdXJyZW50IHVzZXIgYW5kIGFsbCBwcmV2aW91cyB1c2VycyB0aGF0IGFyZSBzdG9yZWQgb24gdGhlIGRldmljZS5cbiAgICAqIEBtZXRob2QgZ2V0VXNlcnNcbiAgICAqIEByZXR1cm4ge0FycmF5fSBhcnJheSBvZiB1c2Vyc1xuICAgICovXG4gICAgZ2V0VXNlcnM6IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgIHZhciB1c2VycyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llcykge1xuICAgICAgICAgICAgaWYgKCFDb25zdGFudHMuU0RLdjJOb25NUElEQ29va2llS2V5cy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgdXNlcnMucHVzaChtUGFydGljbGVVc2VyKGtleSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1c2VycztcbiAgICB9XG59O1xuXG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpIG9iamVjdC5cbiogRXhhbXBsZTogbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKVxuKiBAY2xhc3MgbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKClcbiovXG5mdW5jdGlvbiBtUGFydGljbGVVc2VyKG1waWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICAvKipcbiAgICAgICAgKiBHZXQgdXNlciBpZGVudGl0aWVzIGZvciBjdXJyZW50IHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIGdldFVzZXJJZGVudGl0aWVzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgd2l0aCB1c2VySWRlbnRpdGllcyBhcyBpdHMga2V5XG4gICAgICAgICovXG4gICAgICAgIGdldFVzZXJJZGVudGl0aWVzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50VXNlcklkZW50aXRpZXMgPSB7fTtcblxuICAgICAgICAgICAgdmFyIGlkZW50aXRpZXMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VySWRlbnRpdGllcyhtcGlkKTtcblxuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHlUeXBlIGluIGlkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRVc2VySWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lKEhlbHBlcnMucGFyc2VOdW1iZXIoaWRlbnRpdHlUeXBlKSldID0gaWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB1c2VySWRlbnRpdGllczogY3VycmVudFVzZXJJZGVudGl0aWVzXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXQgdGhlIE1QSUQgb2YgdGhlIGN1cnJlbnQgdXNlclxuICAgICAgICAqIEBtZXRob2QgZ2V0TVBJRFxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gdGhlIGN1cnJlbnQgdXNlciBNUElEIGFzIGEgc3RyaW5nXG4gICAgICAgICovXG4gICAgICAgIGdldE1QSUQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIG1waWQ7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSB1c2VyIHRhZ1xuICAgICAgICAqIEBtZXRob2Qgc2V0VXNlclRhZ1xuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSB0YWdOYW1lXG4gICAgICAgICovXG4gICAgICAgIHNldFVzZXJUYWc6IGZ1bmN0aW9uKHRhZ05hbWUpIHtcbiAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUodGFnTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuc2V0VXNlckF0dHJpYnV0ZSh0YWdOYW1lLCBudWxsKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhIHVzZXIgdGFnXG4gICAgICAgICogQG1ldGhvZCByZW1vdmVVc2VyVGFnXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHRhZ05hbWVcbiAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlVXNlclRhZzogZnVuY3Rpb24odGFnTmFtZSkge1xuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZSh0YWdOYW1lKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5CYWRLZXkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5yZW1vdmVVc2VyQXR0cmlidXRlKHRhZ05hbWUpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIGEgdXNlciBhdHRyaWJ1dGVcbiAgICAgICAgKiBAbWV0aG9kIHNldFVzZXJBdHRyaWJ1dGVcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gICAgICAgICovXG4gICAgICAgIHNldFVzZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzLFxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkQXR0cmlidXRlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuU2V0VXNlckF0dHJpYnV0ZSwgSlNPTi5zdHJpbmdpZnkoeyBrZXk6IGtleSwgdmFsdWU6IHZhbHVlIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcblxuICAgICAgICAgICAgICAgICAgICB2YXIgZXhpc3RpbmdQcm9wID0gSGVscGVycy5maW5kS2V5SW5PYmplY3QodXNlckF0dHJpYnV0ZXMsIGtleSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nUHJvcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVzZXJBdHRyaWJ1dGVzW2V4aXN0aW5nUHJvcF07XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzKGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcblxuICAgICAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmNhbGxTZXRVc2VyQXR0cmlidXRlT25Gb3J3YXJkZXJzKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlcyBhIHNwZWNpZmljIHVzZXIgYXR0cmlidXRlXG4gICAgICAgICogQG1ldGhvZCByZW1vdmVVc2VyQXR0cmlidXRlXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAgICAqL1xuICAgICAgICByZW1vdmVVc2VyQXR0cmlidXRlOiBmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVzLCB1c2VyQXR0cmlidXRlcztcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEtleVZhbHVlKGtleSkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLlJlbW92ZVVzZXJBdHRyaWJ1dGUsIEpTT04uc3RyaW5naWZ5KHsga2V5OiBrZXksIHZhbHVlOiBudWxsIH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcblxuICAgICAgICAgICAgICAgIHZhciBleGlzdGluZ1Byb3AgPSBIZWxwZXJzLmZpbmRLZXlJbk9iamVjdCh1c2VyQXR0cmlidXRlcywga2V5KTtcblxuICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1Byb3ApIHtcbiAgICAgICAgICAgICAgICAgICAga2V5ID0gZXhpc3RpbmdQcm9wO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGRlbGV0ZSB1c2VyQXR0cmlidXRlc1trZXldO1xuXG4gICAgICAgICAgICAgICAgY29va2llc1ttcGlkXS51YSA9IHVzZXJBdHRyaWJ1dGVzO1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzLCBtcGlkKTtcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zdG9yZURhdGFJbk1lbW9yeShjb29raWVzLCBtcGlkKTtcblxuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuYXBwbHlUb0ZvcndhcmRlcnMoJ3JlbW92ZVVzZXJBdHRyaWJ1dGUnLCBrZXkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIGEgbGlzdCBvZiB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIHNldFVzZXJBdHRyaWJ1dGVMaXN0XG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAgICAqIEBwYXJhbSB7QXJyYXl9IHZhbHVlIGFuIGFycmF5IG9mIHZhbHVlc1xuICAgICAgICAqL1xuICAgICAgICBzZXRVc2VyQXR0cmlidXRlTGlzdDogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMsIHVzZXJBdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKCFWYWxpZGF0b3JzLmlzVmFsaWRLZXlWYWx1ZShrZXkpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZEtleSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVGhlIHZhbHVlIHlvdSBwYXNzZWQgaW4gdG8gc2V0VXNlckF0dHJpYnV0ZUxpc3QgbXVzdCBiZSBhbiBhcnJheS4gWW91IHBhc3NlZCBpbiBhICcgKyB0eXBlb2YgdmFsdWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGFycmF5Q29weSA9IHZhbHVlLnNsaWNlKCk7XG5cbiAgICAgICAgICAgIGlmIChIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5zZW5kVG9OYXRpdmUoQ29uc3RhbnRzLk5hdGl2ZVNka1BhdGhzLlNldFVzZXJBdHRyaWJ1dGVMaXN0LCBKU09OLnN0cmluZ2lmeSh7IGtleToga2V5LCB2YWx1ZTogYXJyYXlDb3B5IH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlcyA9IHRoaXMuZ2V0QWxsVXNlckF0dHJpYnV0ZXMoKTtcblxuICAgICAgICAgICAgICAgIHZhciBleGlzdGluZ1Byb3AgPSBIZWxwZXJzLmZpbmRLZXlJbk9iamVjdCh1c2VyQXR0cmlidXRlcywga2V5KTtcblxuICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1Byb3ApIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVzZXJBdHRyaWJ1dGVzW2V4aXN0aW5nUHJvcF07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNba2V5XSA9IGFycmF5Q29weTtcbiAgICAgICAgICAgICAgICBjb29raWVzW21waWRdLnVhID0gdXNlckF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzKGNvb2tpZXMsIG1waWQpO1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMsIG1waWQpO1xuXG4gICAgICAgICAgICAgICAgRm9yd2FyZGVycy5jYWxsU2V0VXNlckF0dHJpYnV0ZU9uRm9yd2FyZGVycyhrZXksIGFycmF5Q29weSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJlbW92ZXMgYWxsIHVzZXIgYXR0cmlidXRlc1xuICAgICAgICAqIEBtZXRob2QgcmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXNcbiAgICAgICAgKi9cbiAgICAgICAgcmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGNvb2tpZXMsIHVzZXJBdHRyaWJ1dGVzO1xuXG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuUmVtb3ZlQWxsVXNlckF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdGhpcy5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuYXBwbHlUb0ZvcndhcmRlcnMoJ3JlbW92ZVVzZXJBdHRyaWJ1dGUnLCBwcm9wKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvb2tpZXNbbXBpZF0udWEgPSB7fTtcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGVPbmx5Q29va2llVXNlckF0dHJpYnV0ZXMoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbXBpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgYWxsIHVzZXIgYXR0cmlidXRlIGtleXMgdGhhdCBoYXZlIHZhbHVlcyB0aGF0IGFyZSBhcnJheXNcbiAgICAgICAgKiBAbWV0aG9kIGdldFVzZXJBdHRyaWJ1dGVzTGlzdHNcbiAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IGFuIG9iamVjdCBvZiBvbmx5IGtleXMgd2l0aCBhcnJheSB2YWx1ZXMuIEV4YW1wbGU6IHsgYXR0cjE6IFsxLCAyLCAzXSwgYXR0cjI6IFsnYScsICdiJywgJ2MnXSB9XG4gICAgICAgICovXG4gICAgICAgIGdldFVzZXJBdHRyaWJ1dGVzTGlzdHM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHMgPSB7fTtcblxuICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXMgPSB0aGlzLmdldEFsbFVzZXJBdHRyaWJ1dGVzKCk7XG4gICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkoa2V5KSAmJiBBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW2tleV0pKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzTGlzdHNba2V5XSA9IHVzZXJBdHRyaWJ1dGVzW2tleV0uc2xpY2UoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB1c2VyQXR0cmlidXRlc0xpc3RzO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZXR1cm5zIGFsbCB1c2VyIGF0dHJpYnV0ZXNcbiAgICAgICAgKiBAbWV0aG9kIGdldEFsbFVzZXJBdHRyaWJ1dGVzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgb2YgYWxsIHVzZXIgYXR0cmlidXRlcy4gRXhhbXBsZTogeyBhdHRyMTogJ3ZhbHVlMScsIGF0dHIyOiBbJ2EnLCAnYicsICdjJ10gfVxuICAgICAgICAqL1xuICAgICAgICBnZXRBbGxVc2VyQXR0cmlidXRlczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXNDb3B5ID0ge307XG4gICAgICAgICAgICB2YXIgdXNlckF0dHJpYnV0ZXMgPSBQZXJzaXN0ZW5jZS5nZXRBbGxVc2VyQXR0cmlidXRlcyhtcGlkKTtcblxuICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgcHJvcCBpbiB1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlckF0dHJpYnV0ZXMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHVzZXJBdHRyaWJ1dGVzW3Byb3BdKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzQ29weVtwcm9wXSA9IHVzZXJBdHRyaWJ1dGVzW3Byb3BdLnNsaWNlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHlbcHJvcF0gPSB1c2VyQXR0cmlidXRlc1twcm9wXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHVzZXJBdHRyaWJ1dGVzQ29weTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgY2FydCBvYmplY3QgZm9yIHRoZSBjdXJyZW50IHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIGdldENhcnRcbiAgICAgICAgKiBAcmV0dXJuIGEgY2FydCBvYmplY3RcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q2FydDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbVBhcnRpY2xlVXNlckNhcnQobXBpZCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgQ29uc2VudCBTdGF0ZSBzdG9yZWQgbG9jYWxseSBmb3IgdGhpcyB1c2VyLlxuICAgICAgICAqIEBtZXRob2QgZ2V0Q29uc2VudFN0YXRlXG4gICAgICAgICogQHJldHVybiBhIENvbnNlbnRTdGF0ZSBvYmplY3RcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q29uc2VudFN0YXRlOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBQZXJzaXN0ZW5jZS5nZXRDb25zZW50U3RhdGUobXBpZCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgdGhlIENvbnNlbnQgU3RhdGUgc3RvcmVkIGxvY2FsbHkgZm9yIHRoaXMgdXNlci5cbiAgICAgICAgKiBAbWV0aG9kIHNldENvbnNlbnRTdGF0ZVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBjb25zZW50IHN0YXRlXG4gICAgICAgICovXG4gICAgICAgIHNldENvbnNlbnRTdGF0ZTogZnVuY3Rpb24oc3RhdGUpIHtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnNldENvbnNlbnRTdGF0ZShtcGlkLCBzdGF0ZSk7XG4gICAgICAgICAgICBpZiAoTVAubXBpZCA9PT0gdGhpcy5nZXRNUElEKCkpIHtcbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKHRoaXMuZ2V0VXNlcklkZW50aXRpZXMoKS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG4vKipcbiogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKSBvYmplY3QuXG4qIEV4YW1wbGU6IG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKS5hZGQoLi4uKTtcbiogQGNsYXNzIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpLmdldENhcnQoKVxuKi9cbmZ1bmN0aW9uIG1QYXJ0aWNsZVVzZXJDYXJ0KG1waWQpe1xuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAqIEFkZHMgYSBjYXJ0IHByb2R1Y3QgdG8gdGhlIHVzZXIgY2FydFxuICAgICAgICAqIEBtZXRob2QgYWRkXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3RcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtsb2dFdmVudF0gYSBib29sZWFuIHRvIGxvZyBhZGRpbmcgb2YgdGhlIGNhcnQgb2JqZWN0LiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICovXG4gICAgICAgIGFkZDogZnVuY3Rpb24ocHJvZHVjdCwgbG9nRXZlbnQpIHtcbiAgICAgICAgICAgIHZhciBhbGxQcm9kdWN0cyxcbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMsXG4gICAgICAgICAgICAgICAgYXJyYXlDb3B5O1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5BZGRUb0NhcnQsIEpTT04uc3RyaW5naWZ5KGFycmF5Q29weSkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICAgICAgICAgIHByb2R1Y3QuQXR0cmlidXRlcyA9IEhlbHBlcnMuc2FuaXRpemVBdHRyaWJ1dGVzKHByb2R1Y3QuQXR0cmlidXRlcyk7XG4gICAgICAgICAgICAgICAgYXJyYXlDb3B5ID0gQXJyYXkuaXNBcnJheShwcm9kdWN0KSA/IHByb2R1Y3Quc2xpY2UoKSA6IFtwcm9kdWN0XTtcblxuXG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHMgPSBKU09OLnBhcnNlKFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZVByb2R1Y3RzKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFsbFByb2R1Y3RzICYmICFhbGxQcm9kdWN0c1ttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICBhbGxQcm9kdWN0c1ttcGlkXSA9IHt9O1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChhbGxQcm9kdWN0c1ttcGlkXS5jcCkge1xuICAgICAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSBhbGxQcm9kdWN0c1ttcGlkXS5jcDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSBbXTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSB1c2VyUHJvZHVjdHMuY29uY2F0KGFycmF5Q29weSk7XG5cbiAgICAgICAgICAgICAgICBpZiAobG9nRXZlbnQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5BZGRUb0NhcnQsIGFycmF5Q29weSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIHByb2R1Y3RzRm9yTWVtb3J5ID0ge307XG4gICAgICAgICAgICAgICAgcHJvZHVjdHNGb3JNZW1vcnlbbXBpZF0gPSB7Y3A6IHVzZXJQcm9kdWN0c307XG4gICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVQcm9kdWN0c0luTWVtb3J5KHByb2R1Y3RzRm9yTWVtb3J5LCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodXNlclByb2R1Y3RzLmxlbmd0aCA+IG1QYXJ0aWNsZS5tYXhQcm9kdWN0cykge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgY2FydCBjb250YWlucyAnICsgdXNlclByb2R1Y3RzLmxlbmd0aCArICcgaXRlbXMuIE9ubHkgbVBhcnRpY2xlLm1heFByb2R1Y3RzID0gJyArIG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyArICcgY2FuIGN1cnJlbnRseSBiZSBzYXZlZCBpbiBjb29raWVzLicpO1xuICAgICAgICAgICAgICAgICAgICB1c2VyUHJvZHVjdHMgPSB1c2VyUHJvZHVjdHMuc2xpY2UoMCwgbVBhcnRpY2xlLm1heFByb2R1Y3RzKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBhbGxQcm9kdWN0c1ttcGlkXS5jcCA9IHVzZXJQcm9kdWN0cztcblxuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnNldENhcnRQcm9kdWN0cyhhbGxQcm9kdWN0cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJlbW92ZXMgYSBjYXJ0IHByb2R1Y3QgZnJvbSB0aGUgY3VycmVudCB1c2VyIGNhcnRcbiAgICAgICAgKiBAbWV0aG9kIHJlbW92ZVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHRoZSBwcm9kdWN0XG4gICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRdIGEgYm9vbGVhbiB0byBsb2cgYWRkaW5nIG9mIHRoZSBjYXJ0IG9iamVjdC4gSWYgYmxhbmssIG5vIGxvZ2dpbmcgb2NjdXJzLlxuICAgICAgICAqL1xuICAgICAgICByZW1vdmU6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50KSB7XG4gICAgICAgICAgICB2YXIgYWxsUHJvZHVjdHMsXG4gICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzLFxuICAgICAgICAgICAgICAgIGNhcnRJbmRleCA9IC0xLFxuICAgICAgICAgICAgICAgIGNhcnRJdGVtID0gbnVsbDtcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuUmVtb3ZlRnJvbUNhcnQsIEpTT04uc3RyaW5naWZ5KGNhcnRJdGVtKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHMgPSBKU09OLnBhcnNlKFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZVByb2R1Y3RzKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFsbFByb2R1Y3RzICYmIGFsbFByb2R1Y3RzW21waWRdLmNwKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IGFsbFByb2R1Y3RzW21waWRdLmNwO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cyA9IFtdO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh1c2VyUHJvZHVjdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlclByb2R1Y3RzLmZvckVhY2goZnVuY3Rpb24oY2FydFByb2R1Y3QsIGkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjYXJ0UHJvZHVjdC5Ta3UgPT09IHByb2R1Y3QuU2t1KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FydEluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXJ0SXRlbSA9IGNhcnRQcm9kdWN0O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY2FydEluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJQcm9kdWN0cy5zcGxpY2UoY2FydEluZGV4LCAxKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGxvZ0V2ZW50ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydCwgY2FydEl0ZW0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIHByb2R1Y3RzRm9yTWVtb3J5ID0ge307XG4gICAgICAgICAgICAgICAgcHJvZHVjdHNGb3JNZW1vcnlbbXBpZF0gPSB7Y3A6IHVzZXJQcm9kdWN0c307XG4gICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVQcm9kdWN0c0luTWVtb3J5KHByb2R1Y3RzRm9yTWVtb3J5LCBtcGlkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBhbGxQcm9kdWN0c1ttcGlkXS5jcCA9IHVzZXJQcm9kdWN0cztcblxuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnNldENhcnRQcm9kdWN0cyhhbGxQcm9kdWN0cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIENsZWFycyB0aGUgdXNlcidzIGNhcnRcbiAgICAgICAgKiBAbWV0aG9kIGNsZWFyXG4gICAgICAgICovXG4gICAgICAgIGNsZWFyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBhbGxQcm9kdWN0cztcblxuICAgICAgICAgICAgaWYgKEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLnNlbmRUb05hdGl2ZShDb25zdGFudHMuTmF0aXZlU2RrUGF0aHMuQ2xlYXJDYXJ0KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgYWxsUHJvZHVjdHMgPSBKU09OLnBhcnNlKFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZVByb2R1Y3RzKCkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGFsbFByb2R1Y3RzICYmIGFsbFByb2R1Y3RzW21waWRdLmNwKSB7XG4gICAgICAgICAgICAgICAgICAgIGFsbFByb2R1Y3RzW21waWRdLmNwID0gW107XG5cbiAgICAgICAgICAgICAgICAgICAgYWxsUHJvZHVjdHNbbXBpZF0uY3AgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlUHJvZHVjdHNJbk1lbW9yeShhbGxQcm9kdWN0cywgbXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5zZXRDYXJ0UHJvZHVjdHMoYWxsUHJvZHVjdHMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyBhbGwgY2FydCBwcm9kdWN0c1xuICAgICAgICAqIEBtZXRob2QgZ2V0Q2FydFByb2R1Y3RzXG4gICAgICAgICogQHJldHVybiB7QXJyYXl9IGFycmF5IG9mIGNhcnQgcHJvZHVjdHNcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0Q2FydFByb2R1Y3RzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBQZXJzaXN0ZW5jZS5nZXRDYXJ0UHJvZHVjdHMobXBpZCk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZUlkZW50aXR5UmVzcG9uc2UoeGhyLCBwcmV2aW91c01QSUQsIGNhbGxiYWNrLCBpZGVudGl0eUFwaURhdGEsIG1ldGhvZCkge1xuICAgIHZhciBwcmV2VXNlcixcbiAgICAgICAgbmV3VXNlcixcbiAgICAgICAgaWRlbnRpdHlBcGlSZXN1bHQsXG4gICAgICAgIGluZGV4T2ZNUElEO1xuICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgIHByZXZVc2VyID0gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG4gICAgfVxuXG4gICAgTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQgPSBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQYXJzaW5nIGlkZW50aXR5IHJlc3BvbnNlIGZyb20gc2VydmVyJyk7XG4gICAgICAgIGlmICh4aHIucmVzcG9uc2VUZXh0KSB7XG4gICAgICAgICAgICBpZGVudGl0eUFwaVJlc3VsdCA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoeGhyLnN0YXR1cyA9PT0gMjAwKSB7XG4gICAgICAgICAgICBpZiAobWV0aG9kID09PSAnbW9kaWZ5Jykge1xuICAgICAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0gSWRlbnRpdHlSZXF1ZXN0Lm1vZGlmeVVzZXJJZGVudGl0aWVzKE1QLnVzZXJJZGVudGl0aWVzLCBpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpO1xuICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZGVudGl0eUFwaVJlc3VsdCA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCk7XG5cbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdTdWNjZXNzZnVsbHkgcGFyc2VkIElkZW50aXR5IFJlc3BvbnNlJyk7XG4gICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpUmVzdWx0Lm1waWQgJiYgaWRlbnRpdHlBcGlSZXN1bHQubXBpZCAhPT0gTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5tcGlkID0gaWRlbnRpdHlBcGlSZXN1bHQubXBpZDtcblxuICAgICAgICAgICAgICAgICAgICBjaGVja0Nvb2tpZUZvck1QSUQoTVAubXBpZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaW5kZXhPZk1QSUQgPSBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLmluZGV4T2YoTVAubXBpZCk7XG5cbiAgICAgICAgICAgICAgICBpZiAoTVAuc2Vzc2lvbklkICYmIE1QLm1waWQgJiYgcHJldmlvdXNNUElEICE9PSBNUC5tcGlkICYmIGluZGV4T2ZNUElEIDwgMCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnB1c2goTVAubXBpZCk7XG4gICAgICAgICAgICAgICAgICAgIC8vIG5lZWQgdG8gdXBkYXRlIGN1cnJlbnRTZXNzaW9uTVBJRHMgaW4gbWVtb3J5IGJlZm9yZSBjaGVja2luZ0lkZW50aXR5U3dhcCBvdGhlcndpc2UgcHJldmlvdXMgb2JqLmN1cnJlbnRTZXNzaW9uTVBJRHMgaXMgdXNlZCBpbiBjaGVja0lkZW50aXR5U3dhcCdzIFBlcnNpc3RlbmNlLnVwZGF0ZSgpXG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChpbmRleE9mTVBJRCA+IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLmN1cnJlbnRTZXNzaW9uTVBJRHMgPSAoTVAuY3VycmVudFNlc3Npb25NUElEcy5zbGljZSgwLCBpbmRleE9mTVBJRCkpLmNvbmNhdChNUC5jdXJyZW50U2Vzc2lvbk1QSURzLnNsaWNlKGluZGV4T2ZNUElEICsgMSwgTVAuY3VycmVudFNlc3Npb25NUElEcy5sZW5ndGgpKTtcbiAgICAgICAgICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcy5wdXNoKE1QLm1waWQpO1xuICAgICAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS51cGRhdGUoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBDb29raWVTeW5jTWFuYWdlci5hdHRlbXB0Q29va2llU3luYyhwcmV2aW91c01QSUQsIE1QLm1waWQpO1xuXG4gICAgICAgICAgICAgICAgSWRlbnRpdHkuY2hlY2tJZGVudGl0eVN3YXAocHJldmlvdXNNUElELCBNUC5tcGlkKTtcblxuICAgICAgICAgICAgICAgIC8vIGV2ZW50cyBleGlzdCBpbiB0aGUgZXZlbnRRdWV1ZSBiZWNhdXNlIHRoZXkgd2VyZSB0cmlnZ2VyZWQgd2hlbiB0aGUgaWRlbnRpdHlBUEkgcmVxdWVzdCB3YXMgaW4gZmxpZ2h0XG4gICAgICAgICAgICAgICAgLy8gb25jZSBBUEkgcmVxdWVzdCByZXR1cm5zIGFuZCB0aGVyZSBpcyBhbiBNUElELCBldmVudFF1ZXVlIGl0ZW1zIGFyZSByZWFzc2lnbmVkIHdpdGggdGhlIHJldHVybmVkIE1QSUQgYW5kIGZsdXNoZWRcbiAgICAgICAgICAgICAgICBpZiAoTVAuZXZlbnRRdWV1ZS5sZW5ndGggJiYgTVAubXBpZCkge1xuICAgICAgICAgICAgICAgICAgICBNUC5ldmVudFF1ZXVlLmZvckVhY2goZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50Lk1QSUQgPSBNUC5tcGlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VuZEV2ZW50VG9TZXJ2ZXIoZXZlbnQsIHNlbmRFdmVudFRvRm9yd2FyZGVycywgRXZlbnRzLnBhcnNlRXZlbnRSZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBNUC5ldmVudFF1ZXVlID0gW107XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9pZiB0aGVyZSBpcyBhbnkgcHJldmlvdXMgbWlncmF0aW9uIGRhdGFcbiAgICAgICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoTVAubWlncmF0aW9uRGF0YSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLnVzZXJJZGVudGl0aWVzID0gTVAubWlncmF0aW9uRGF0YS51c2VySWRlbnRpdGllcyB8fCB7fTtcbiAgICAgICAgICAgICAgICAgICAgTVAudXNlckF0dHJpYnV0ZXMgPSBNUC5taWdyYXRpb25EYXRhLnVzZXJBdHRyaWJ1dGVzIHx8IHt9O1xuICAgICAgICAgICAgICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSBNUC5taWdyYXRpb25EYXRhLmNvb2tpZVN5bmNEYXRlcyB8fCB7fTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdHlBcGlEYXRhICYmIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyAmJiBPYmplY3Qua2V5cyhpZGVudGl0eUFwaURhdGEudXNlcklkZW50aXRpZXMpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBJZGVudGl0eVJlcXVlc3QubW9kaWZ5VXNlcklkZW50aXRpZXMoTVAudXNlcklkZW50aXRpZXMsIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UuZmluZFByZXZDb29raWVzQmFzZWRPblVJKGlkZW50aXR5QXBpRGF0YSk7XG5cbiAgICAgICAgICAgICAgICBNUC5jb250ZXh0ID0gaWRlbnRpdHlBcGlSZXN1bHQuY29udGV4dCB8fCBNUC5jb250ZXh0O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBuZXdVc2VyID0gbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCk7XG5cbiAgICAgICAgICAgIGlmIChpZGVudGl0eUFwaURhdGEgJiYgaWRlbnRpdHlBcGlEYXRhLm9uVXNlckFsaWFzICYmIEhlbHBlcnMuVmFsaWRhdG9ycy5pc0Z1bmN0aW9uKGlkZW50aXR5QXBpRGF0YS5vblVzZXJBbGlhcykpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eUFwaURhdGEub25Vc2VyQWxpYXMocHJldlVzZXIsIG5ld1VzZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGVyZSB3YXMgYW4gZXJyb3Igd2l0aCB5b3VyIG9uVXNlckFsaWFzIGZ1bmN0aW9uIC0gJyArIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG5cbiAgICAgICAgICAgIGlmIChuZXdVc2VyKSB7XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2Uuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbmV3VXNlci5nZXRNUElEKCkpO1xuICAgICAgICAgICAgICAgIGlmICghcHJldlVzZXIgfHwgbmV3VXNlci5nZXRNUElEKCkgIT09IHByZXZVc2VyLmdldE1QSUQoKSkge1xuICAgICAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLmluaXRGb3J3YXJkZXJzKG5ld1VzZXIuZ2V0VXNlcklkZW50aXRpZXMoKS51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuc2V0Rm9yd2FyZGVyVXNlcklkZW50aXRpZXMobmV3VXNlci5nZXRVc2VySWRlbnRpdGllcygpLnVzZXJJZGVudGl0aWVzKTtcbiAgICAgICAgICAgICAgICBGb3J3YXJkZXJzLnNldEZvcndhcmRlck9uVXNlcklkZW50aWZpZWQobmV3VXNlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIEhlbHBlcnMuaW52b2tlQ2FsbGJhY2soY2FsbGJhY2ssIHhoci5zdGF0dXMsIGlkZW50aXR5QXBpUmVzdWx0IHx8IG51bGwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKGlkZW50aXR5QXBpUmVzdWx0ICYmIGlkZW50aXR5QXBpUmVzdWx0LmVycm9ycyAmJiBpZGVudGl0eUFwaVJlc3VsdC5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnUmVjZWl2ZWQgSFRUUCByZXNwb25zZSBjb2RlIG9mICcgKyB4aHIuc3RhdHVzICsgJyAtICcgKyBpZGVudGl0eUFwaVJlc3VsdC5lcnJvcnNbMF0ubWVzc2FnZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmludm9rZUNhbGxiYWNrKGNhbGxiYWNrLCB4aHIuc3RhdHVzLCBpZGVudGl0eUFwaVJlc3VsdCB8fCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciBwYXJzaW5nIEpTT04gcmVzcG9uc2UgZnJvbSBJZGVudGl0eSBzZXJ2ZXI6ICcgKyBlKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNoZWNrQ29va2llRm9yTVBJRChjdXJyZW50TVBJRCkge1xuICAgIHZhciBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCkgfHwgUGVyc2lzdGVuY2UuZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgaWYgKGNvb2tpZXMgJiYgIWNvb2tpZXNbY3VycmVudE1QSURdKSB7XG4gICAgICAgIFBlcnNpc3RlbmNlLnN0b3JlRGF0YUluTWVtb3J5KG51bGwsIGN1cnJlbnRNUElEKTtcbiAgICAgICAgTVAuY2FydFByb2R1Y3RzID0gW107XG4gICAgfSBlbHNlIGlmIChjb29raWVzKSB7XG4gICAgICAgIHZhciBwcm9kdWN0cyA9IFBlcnNpc3RlbmNlLmRlY29kZVByb2R1Y3RzKCk7XG4gICAgICAgIGlmIChwcm9kdWN0cyAmJiBwcm9kdWN0c1tjdXJyZW50TVBJRF0pIHtcbiAgICAgICAgICAgIE1QLmNhcnRQcm9kdWN0cyA9IHByb2R1Y3RzW2N1cnJlbnRNUElEXS5jcDtcbiAgICAgICAgfVxuICAgICAgICBNUC51c2VySWRlbnRpdGllcyA9IGNvb2tpZXNbY3VycmVudE1QSURdLnVpIHx8IHt9O1xuICAgICAgICBNUC51c2VyQXR0cmlidXRlcyA9IGNvb2tpZXNbY3VycmVudE1QSURdLnVhIHx8IHt9O1xuICAgICAgICBNUC5jb29raWVTeW5jRGF0ZXMgPSBjb29raWVzW2N1cnJlbnRNUElEXS5jc2QgfHwge307XG4gICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IGNvb2tpZXNbY3VycmVudE1QSURdLmNvbjtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIElkZW50aXR5QVBJOiBJZGVudGl0eUFQSSxcbiAgICBJZGVudGl0eTogSWRlbnRpdHksXG4gICAgSWRlbnRpdHlSZXF1ZXN0OiBJZGVudGl0eVJlcXVlc3QsXG4gICAgbVBhcnRpY2xlVXNlckNhcnQ6IG1QYXJ0aWNsZVVzZXJDYXJ0XG59O1xuIiwidmFyIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKTtcblxuZnVuY3Rpb24gZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyKG1waWQsIGZvcndhcmRlcikge1xuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCB1c2VyIGlkZW50aXRpZXMgZm9yIGN1cnJlbnQgdXNlclxuICAgICAgICAqIEBtZXRob2QgZ2V0VXNlcklkZW50aXRpZXNcbiAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9IGFuIG9iamVjdCB3aXRoIHVzZXJJZGVudGl0aWVzIGFzIGl0cyBrZXlcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0VXNlcklkZW50aXRpZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRVc2VySWRlbnRpdGllcyA9IHt9O1xuICAgICAgICAgICAgdmFyIGlkZW50aXRpZXMgPSBQZXJzaXN0ZW5jZS5nZXRVc2VySWRlbnRpdGllcyhtcGlkKTtcblxuICAgICAgICAgICAgZm9yICh2YXIgaWRlbnRpdHlUeXBlIGluIGlkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRVc2VySWRlbnRpdGllc1tUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lKEhlbHBlcnMucGFyc2VOdW1iZXIoaWRlbnRpdHlUeXBlKSldID0gaWRlbnRpdGllc1tpZGVudGl0eVR5cGVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudFVzZXJJZGVudGl0aWVzID0gSGVscGVycy5maWx0ZXJVc2VySWRlbnRpdGllc0ZvckZvcndhcmRlcnMoY3VycmVudFVzZXJJZGVudGl0aWVzLCBmb3J3YXJkZXIudXNlcklkZW50aXR5RmlsdGVycyk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdXNlcklkZW50aXRpZXM6IGN1cnJlbnRVc2VySWRlbnRpdGllc1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0IHRoZSBNUElEIG9mIHRoZSBjdXJyZW50IHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIGdldE1QSURcbiAgICAgICAgKiBAcmV0dXJuIHtTdHJpbmd9IHRoZSBjdXJyZW50IHVzZXIgTVBJRCBhcyBhIHN0cmluZ1xuICAgICAgICAqL1xuICAgICAgICBnZXRNUElEOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBtcGlkO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBSZXR1cm5zIGFsbCB1c2VyIGF0dHJpYnV0ZSBrZXlzIHRoYXQgaGF2ZSB2YWx1ZXMgdGhhdCBhcmUgYXJyYXlzXG4gICAgICAgICogQG1ldGhvZCBnZXRVc2VyQXR0cmlidXRlc0xpc3RzXG4gICAgICAgICogQHJldHVybiB7T2JqZWN0fSBhbiBvYmplY3Qgb2Ygb25seSBrZXlzIHdpdGggYXJyYXkgdmFsdWVzLiBFeGFtcGxlOiB7IGF0dHIxOiBbMSwgMiwgM10sIGF0dHIyOiBbJ2EnLCAnYicsICdjJ10gfVxuICAgICAgICAqL1xuICAgICAgICBnZXRVc2VyQXR0cmlidXRlc0xpc3RzOiBmdW5jdGlvbihmb3J3YXJkZXIpIHtcbiAgICAgICAgICAgIHZhciB1c2VyQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0xpc3RzID0ge307XG5cbiAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzID0gdGhpcy5nZXRBbGxVc2VyQXR0cmlidXRlcygpO1xuICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIHVzZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KGtleSkgJiYgQXJyYXkuaXNBcnJheSh1c2VyQXR0cmlidXRlc1trZXldKSkge1xuICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0xpc3RzW2tleV0gPSB1c2VyQXR0cmlidXRlc1trZXldLnNsaWNlKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB1c2VyQXR0cmlidXRlc0xpc3RzID0gSGVscGVycy5maWx0ZXJVc2VyQXR0cmlidXRlcyh1c2VyQXR0cmlidXRlc0xpc3RzLCBmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMpO1xuXG4gICAgICAgICAgICByZXR1cm4gdXNlckF0dHJpYnV0ZXNMaXN0cztcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyBhbGwgdXNlciBhdHRyaWJ1dGVzXG4gICAgICAgICogQG1ldGhvZCBnZXRBbGxVc2VyQXR0cmlidXRlc1xuICAgICAgICAqIEByZXR1cm4ge09iamVjdH0gYW4gb2JqZWN0IG9mIGFsbCB1c2VyIGF0dHJpYnV0ZXMuIEV4YW1wbGU6IHsgYXR0cjE6ICd2YWx1ZTEnLCBhdHRyMjogWydhJywgJ2InLCAnYyddIH1cbiAgICAgICAgKi9cbiAgICAgICAgZ2V0QWxsVXNlckF0dHJpYnV0ZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzQ29weSA9IHt9O1xuICAgICAgICAgICAgdmFyIHVzZXJBdHRyaWJ1dGVzID0gUGVyc2lzdGVuY2UuZ2V0QWxsVXNlckF0dHJpYnV0ZXMobXBpZCk7XG5cbiAgICAgICAgICAgIGlmICh1c2VyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHByb3AgaW4gdXNlckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh1c2VyQXR0cmlidXRlc1twcm9wXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyQXR0cmlidXRlc0NvcHlbcHJvcF0gPSB1c2VyQXR0cmlidXRlc1twcm9wXS5zbGljZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlckF0dHJpYnV0ZXNDb3B5W3Byb3BdID0gdXNlckF0dHJpYnV0ZXNbcHJvcF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHVzZXJBdHRyaWJ1dGVzQ29weSA9IEhlbHBlcnMuZmlsdGVyVXNlckF0dHJpYnV0ZXModXNlckF0dHJpYnV0ZXNDb3B5LCBmb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMpO1xuXG4gICAgICAgICAgICByZXR1cm4gdXNlckF0dHJpYnV0ZXNDb3B5O1xuICAgICAgICB9XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgZ2V0RmlsdGVyZWRNcGFydGljbGVVc2VyOiBnZXRGaWx0ZXJlZE1wYXJ0aWNsZVVzZXJcbn07XG4iLCIvL1xuLy8gIENvcHlyaWdodCAyMDE3IG1QYXJ0aWNsZSwgSW5jLlxuLy9cbi8vICBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuLy8gIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbi8vICBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbi8vXG4vLyAgICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuLy9cbi8vICBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4vLyAgZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuLy8gIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuLy8gIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbi8vICBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbi8vXG4vLyAgVXNlcyBwb3J0aW9ucyBvZiBjb2RlIGZyb20galF1ZXJ5XG4vLyAgalF1ZXJ5IHYxLjEwLjIgfCAoYykgMjAwNSwgMjAxMyBqUXVlcnkgRm91bmRhdGlvbiwgSW5jLiB8IGpxdWVyeS5vcmcvbGljZW5zZVxuXG52YXIgUG9seWZpbGwgPSByZXF1aXJlKCcuL3BvbHlmaWxsJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29va2llU3luY01hbmFnZXIgPSByZXF1aXJlKCcuL2Nvb2tpZVN5bmNNYW5hZ2VyJyksXG4gICAgU2Vzc2lvbk1hbmFnZXIgPSByZXF1aXJlKCcuL3Nlc3Npb25NYW5hZ2VyJyksXG4gICAgRWNvbW1lcmNlID0gcmVxdWlyZSgnLi9lY29tbWVyY2UnKSxcbiAgICBNUCA9IHJlcXVpcmUoJy4vbXAnKSxcbiAgICBQZXJzaXN0ZW5jZSA9IHJlcXVpcmUoJy4vcGVyc2lzdGVuY2UnKSxcbiAgICBnZXREZXZpY2VJZCA9IFBlcnNpc3RlbmNlLmdldERldmljZUlkLFxuICAgIEV2ZW50cyA9IHJlcXVpcmUoJy4vZXZlbnRzJyksXG4gICAgTWVzc2FnZXMgPSBDb25zdGFudHMuTWVzc2FnZXMsXG4gICAgVmFsaWRhdG9ycyA9IEhlbHBlcnMuVmFsaWRhdG9ycyxcbiAgICBNaWdyYXRpb25zID0gcmVxdWlyZSgnLi9taWdyYXRpb25zJyksXG4gICAgRm9yd2FyZGVycyA9IHJlcXVpcmUoJy4vZm9yd2FyZGVycycpLFxuICAgIEZvcndhcmRpbmdTdGF0c1VwbG9hZGVyID0gcmVxdWlyZSgnLi9mb3J3YXJkaW5nU3RhdHNVcGxvYWRlcicpLFxuICAgIElkZW50aXR5UmVxdWVzdCA9IHJlcXVpcmUoJy4vaWRlbnRpdHknKS5JZGVudGl0eVJlcXVlc3QsXG4gICAgSWRlbnRpdHkgPSByZXF1aXJlKCcuL2lkZW50aXR5JykuSWRlbnRpdHksXG4gICAgSWRlbnRpdHlBUEkgPSByZXF1aXJlKCcuL2lkZW50aXR5JykuSWRlbnRpdHlBUEksXG4gICAgSFRUUENvZGVzID0gSWRlbnRpdHlBUEkuSFRUUENvZGVzLFxuICAgIG1QYXJ0aWNsZVVzZXJDYXJ0ID0gcmVxdWlyZSgnLi9pZGVudGl0eScpLm1QYXJ0aWNsZVVzZXJDYXJ0LFxuICAgIENvbnNlbnQgPSByZXF1aXJlKCcuL2NvbnNlbnQnKTtcblxuKGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghQXJyYXkucHJvdG90eXBlLmZvckVhY2gpIHtcbiAgICAgICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2ggPSBQb2x5ZmlsbC5mb3JFYWNoO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkucHJvdG90eXBlLm1hcCkge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUubWFwID0gUG9seWZpbGwubWFwO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkucHJvdG90eXBlLmZpbHRlcikge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUuZmlsdGVyID0gUG9seWZpbGwuZmlsdGVyO1xuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheSkge1xuICAgICAgICBBcnJheS5wcm90b3R5cGUuaXNBcnJheSA9IFBvbHlmaWxsLmlzQXJyYXk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlIG9iamVjdC5cbiAgICAqIEV4YW1wbGU6IG1QYXJ0aWNsZS5lbmRTZXNzaW9uKClcbiAgICAqXG4gICAgKiBAY2xhc3MgbVBhcnRpY2xlXG4gICAgKi9cblxuICAgIHZhciBtUGFydGljbGUgPSB7XG4gICAgICAgIHVzZU5hdGl2ZVNkazogd2luZG93Lm1QYXJ0aWNsZSAmJiB3aW5kb3cubVBhcnRpY2xlLnVzZU5hdGl2ZVNkayA/IHdpbmRvdy5tUGFydGljbGUudXNlTmF0aXZlU2RrIDogZmFsc2UsXG4gICAgICAgIGlzSU9TOiB3aW5kb3cubVBhcnRpY2xlICYmIHdpbmRvdy5tUGFydGljbGUuaXNJT1MgPyB3aW5kb3cubVBhcnRpY2xlLmlzSU9TIDogZmFsc2UsXG4gICAgICAgIGlzRGV2ZWxvcG1lbnRNb2RlOiBmYWxzZSxcbiAgICAgICAgdXNlQ29va2llU3RvcmFnZTogZmFsc2UsXG4gICAgICAgIG1heFByb2R1Y3RzOiBDb25zdGFudHMuRGVmYXVsdENvbmZpZy5NYXhQcm9kdWN0cyxcbiAgICAgICAgbWF4Q29va2llU2l6ZTogQ29uc3RhbnRzLkRlZmF1bHRDb25maWcuTWF4Q29va2llU2l6ZSxcbiAgICAgICAgaWRlbnRpZnlSZXF1ZXN0OiB7fSxcbiAgICAgICAgZ2V0RGV2aWNlSWQ6IGdldERldmljZUlkLFxuICAgICAgICBnZW5lcmF0ZUhhc2g6IEhlbHBlcnMuZ2VuZXJhdGVIYXNoLFxuICAgICAgICBzZXNzaW9uTWFuYWdlcjogU2Vzc2lvbk1hbmFnZXIsXG4gICAgICAgIGNvb2tpZVN5bmNNYW5hZ2VyOiBDb29raWVTeW5jTWFuYWdlcixcbiAgICAgICAgcGVyc2lzdGVuY2U6IFBlcnNpc3RlbmNlLFxuICAgICAgICBtaWdyYXRpb25zOiBNaWdyYXRpb25zLFxuICAgICAgICBJZGVudGl0eTogSWRlbnRpdHlBUEksXG4gICAgICAgIFZhbGlkYXRvcnM6IFZhbGlkYXRvcnMsXG4gICAgICAgIF9JZGVudGl0eTogSWRlbnRpdHksXG4gICAgICAgIF9JZGVudGl0eVJlcXVlc3Q6IElkZW50aXR5UmVxdWVzdCxcbiAgICAgICAgSWRlbnRpdHlUeXBlOiBUeXBlcy5JZGVudGl0eVR5cGUsXG4gICAgICAgIEV2ZW50VHlwZTogVHlwZXMuRXZlbnRUeXBlLFxuICAgICAgICBDb21tZXJjZUV2ZW50VHlwZTogVHlwZXMuQ29tbWVyY2VFdmVudFR5cGUsXG4gICAgICAgIFByb21vdGlvblR5cGU6IFR5cGVzLlByb21vdGlvbkFjdGlvblR5cGUsXG4gICAgICAgIFByb2R1Y3RBY3Rpb25UeXBlOiBUeXBlcy5Qcm9kdWN0QWN0aW9uVHlwZSxcbiAgICAgICAgLyoqXG4gICAgICAgICogSW5pdGlhbGl6ZXMgdGhlIG1QYXJ0aWNsZSBTREtcbiAgICAgICAgKlxuICAgICAgICAqIEBtZXRob2QgaW5pdFxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBhcGlLZXkgeW91ciBtUGFydGljbGUgYXNzaWduZWQgQVBJIGtleVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gYW4gb3B0aW9ucyBvYmplY3QgZm9yIGFkZGl0aW9uYWwgY29uZmlndXJhdGlvblxuICAgICAgICAqL1xuICAgICAgICBpbml0OiBmdW5jdGlvbihhcGlLZXkpIHtcbiAgICAgICAgICAgIGlmICghSGVscGVycy5zaG91bGRVc2VOYXRpdmVTZGsoKSkge1xuICAgICAgICAgICAgICAgIHZhciBjb25maWc7XG5cbiAgICAgICAgICAgICAgICBNUC5pbml0aWFsSWRlbnRpZnlSZXF1ZXN0ID0gbVBhcnRpY2xlLmlkZW50aWZ5UmVxdWVzdDtcbiAgICAgICAgICAgICAgICBNUC5kZXZUb2tlbiA9IGFwaUtleSB8fCBudWxsO1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0luaXRpYWxpemF0aW9uKTtcblxuICAgICAgICAgICAgICAgIC8vIFNldCBjb25maWd1cmF0aW9uIHRvIGRlZmF1bHQgc2V0dGluZ3NcbiAgICAgICAgICAgICAgICBIZWxwZXJzLm1lcmdlQ29uZmlnKHt9KTtcblxuICAgICAgICAgICAgICAgIC8vIE1pZ3JhdGUgYW55IGNvb2tpZXMgZnJvbSBwcmV2aW91cyB2ZXJzaW9ucyB0byBjdXJyZW50IGNvb2tpZSB2ZXJzaW9uXG4gICAgICAgICAgICAgICAgTWlncmF0aW9ucy5taWdyYXRlKCk7XG5cbiAgICAgICAgICAgICAgICAvLyBMb2FkIGFueSBzZXR0aW5ncy9pZGVudGl0aWVzL2F0dHJpYnV0ZXMgZnJvbSBjb29raWUgb3IgbG9jYWxTdG9yYWdlXG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UuaW5pdGlhbGl6ZVN0b3JhZ2UoKTtcblxuICAgICAgICAgICAgICAgIC8vIElmIG5vIGlkZW50aXR5IGlzIHBhc3NlZCBpbiwgd2Ugc2V0IHRoZSB1c2VyIGlkZW50aXRpZXMgdG8gd2hhdCBpcyBjdXJyZW50bHkgaW4gY29va2llcyBmb3IgdGhlIGlkZW50aWZ5IHJlcXVlc3RcbiAgICAgICAgICAgICAgICBpZiAoKEhlbHBlcnMuaXNPYmplY3QobVBhcnRpY2xlLmlkZW50aWZ5UmVxdWVzdCkgJiYgT2JqZWN0LmtleXMobVBhcnRpY2xlLmlkZW50aWZ5UmVxdWVzdCkubGVuZ3RoID09PSAwKSB8fCAhbVBhcnRpY2xlLmlkZW50aWZ5UmVxdWVzdCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgbW9kaWZpZWRVSWZvcklkZW50aXR5UmVxdWVzdCA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpZGVudGl0eVR5cGUgaW4gTVAudXNlcklkZW50aXRpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChNUC51c2VySWRlbnRpdGllcy5oYXNPd25Qcm9wZXJ0eShpZGVudGl0eVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kaWZpZWRVSWZvcklkZW50aXR5UmVxdWVzdFtUeXBlcy5JZGVudGl0eVR5cGUuZ2V0SWRlbnRpdHlOYW1lKEhlbHBlcnMucGFyc2VOdW1iZXIoaWRlbnRpdHlUeXBlKSldID0gTVAudXNlcklkZW50aXRpZXNbaWRlbnRpdHlUeXBlXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VySWRlbnRpdGllczogbW9kaWZpZWRVSWZvcklkZW50aXR5UmVxdWVzdFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QgPSBtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0O1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIElmIG1pZ3JhdGluZyBmcm9tIHByZS1JRFN5bmMgdG8gSURTeW5jLCBhIHNlc3Npb25JRCB3aWxsIGV4aXN0IGFuZCBhbiBpZGVudGlmeSByZXF1ZXN0IHdpbGwgbm90IGhhdmUgYmVlbiBmaXJlZCwgc28gd2UgbmVlZCB0aGlzIGNoZWNrXG4gICAgICAgICAgICAgICAgaWYgKE1QLm1pZ3JhdGluZ1RvSURTeW5jQ29va2llcykge1xuICAgICAgICAgICAgICAgICAgICBJZGVudGl0eUFQSS5pZGVudGlmeShNUC5pbml0aWFsSWRlbnRpZnlSZXF1ZXN0LCBtUGFydGljbGUuaWRlbnRpZnlSZXF1ZXN0KTtcbiAgICAgICAgICAgICAgICAgICAgTVAubWlncmF0aW5nVG9JRFN5bmNDb29raWVzID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gQ2FsbCBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayB3aGVuIGlkZW50aWZ5IHdhcyBub3QgY2FsbGVkIGR1ZSB0byBhIHJlbG9hZCBvciBhIHNlc3Npb25JZCBhbHJlYWR5IGV4aXN0aW5nXG4gICAgICAgICAgICAgICAgaWYgKCFNUC5pZGVudGlmeUNhbGxlZCAmJiBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayAmJiBNUC5tcGlkICYmIG1QYXJ0aWNsZS5JZGVudGl0eS5nZXRDdXJyZW50VXNlcigpKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5pZGVudGl0eUNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGh0dHBDb2RlOiBIVFRQQ29kZXMuYWN0aXZlU2Vzc2lvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtcGlkOiBNUC5tcGlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZWRfaWRlbnRpdGllczogbVBhcnRpY2xlLklkZW50aXR5LmdldEN1cnJlbnRVc2VyKCkgPyBtUGFydGljbGUuSWRlbnRpdHkuZ2V0Q3VycmVudFVzZXIoKS5nZXRVc2VySWRlbnRpdGllcygpLnVzZXJJZGVudGl0aWVzIDoge30sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGV4dDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpc19lcGhlbWVyYWw6IGZhbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuaW5pdEZvcndhcmRlcnMoTVAuaW5pdGlhbElkZW50aWZ5UmVxdWVzdC51c2VySWRlbnRpdGllcyk7XG4gICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaGFzRmVhdHVyZUZsYWcoQ29uc3RhbnRzLkZlYXR1cmVzLkJhdGNoaW5nKSkge1xuICAgICAgICAgICAgICAgICAgICBGb3J3YXJkaW5nU3RhdHNVcGxvYWRlci5zdGFydEZvcndhcmRpbmdTdGF0c1RpbWVyKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGFyZ3VtZW50cyAmJiBhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSAmJiB0eXBlb2YgYXJndW1lbnRzWzFdID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gYXJndW1lbnRzWzFdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoY29uZmlnKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5pbml0aWFsaXplKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ0FTVCgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYWxsIGFueSBmdW5jdGlvbnMgdGhhdCBhcmUgd2FpdGluZyBmb3IgdGhlIGxpYnJhcnkgdG8gYmUgaW5pdGlhbGl6ZWRcbiAgICAgICAgICAgIGlmIChNUC5yZWFkeVF1ZXVlICYmIE1QLnJlYWR5UXVldWUubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgTVAucmVhZHlRdWV1ZS5mb3JFYWNoKGZ1bmN0aW9uKHJlYWR5UXVldWVJdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChWYWxpZGF0b3JzLmlzRnVuY3Rpb24ocmVhZHlRdWV1ZUl0ZW0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWFkeVF1ZXVlSXRlbSgpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkocmVhZHlRdWV1ZUl0ZW0pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzUHJlbG9hZGVkSXRlbShyZWFkeVF1ZXVlSXRlbSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIE1QLnJlYWR5UXVldWUgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIE1QLmlzSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBDb21wbGV0ZWx5IHJlc2V0cyB0aGUgc3RhdGUgb2YgdGhlIFNESy4gbVBhcnRpY2xlLmluaXQoYXBpS2V5KSB3aWxsIG5lZWQgdG8gYmUgY2FsbGVkIGFnYWluLlxuICAgICAgICAqIEBtZXRob2QgcmVzZXRcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IGtlZXBQZXJzaXN0ZW5jZSBpZiBwYXNzZWQgYXMgdHJ1ZSwgdGhpcyBtZXRob2Qgd2lsbCBvbmx5IHJlc2V0IHRoZSBpbi1tZW1vcnkgU0RLIHN0YXRlLlxuICAgICAgICAqL1xuICAgICAgICByZXNldDogZnVuY3Rpb24oa2VlcFBlcnNpc3RlbmNlKSB7XG4gICAgICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlcyA9IHt9O1xuICAgICAgICAgICAgTVAuaXNFbmFibGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIE1QLmlzRmlyc3RSdW4gPSBudWxsO1xuICAgICAgICAgICAgRXZlbnRzLnN0b3BUcmFja2luZygpO1xuICAgICAgICAgICAgTVAuZGV2VG9rZW4gPSBudWxsO1xuICAgICAgICAgICAgTVAuc2Vzc2lvbklkID0gbnVsbDtcbiAgICAgICAgICAgIE1QLmFwcE5hbWUgPSBudWxsO1xuICAgICAgICAgICAgTVAuYXBwVmVyc2lvbiA9IG51bGw7XG4gICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzID0gW10sXG4gICAgICAgICAgICBNUC5ldmVudFF1ZXVlID0gW107XG4gICAgICAgICAgICBNUC5jb250ZXh0ID0gbnVsbDtcbiAgICAgICAgICAgIE1QLnVzZXJBdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICBNUC51c2VySWRlbnRpdGllcyA9IHt9O1xuICAgICAgICAgICAgTVAuY29va2llU3luY0RhdGVzID0ge307XG4gICAgICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzID0gW107XG4gICAgICAgICAgICBNUC5jb25maWd1cmVkRm9yd2FyZGVycyA9IFtdO1xuICAgICAgICAgICAgTVAuZm9yd2FyZGVyQ29uc3RydWN0b3JzID0gW107XG4gICAgICAgICAgICBNUC5waXhlbENvbmZpZ3VyYXRpb25zID0gW107XG4gICAgICAgICAgICBNUC5jYXJ0UHJvZHVjdHMgPSBbXTtcbiAgICAgICAgICAgIE1QLnNlcnZlclNldHRpbmdzID0gbnVsbDtcbiAgICAgICAgICAgIE1QLm1waWQgPSBudWxsO1xuICAgICAgICAgICAgTVAuY3VzdG9tRmxhZ3MgPSBudWxsO1xuICAgICAgICAgICAgTVAuY3VycmVuY3lDb2RlO1xuICAgICAgICAgICAgTVAuY2xpZW50SWQgPSBudWxsO1xuICAgICAgICAgICAgTVAuZGV2aWNlSWQgPSBudWxsO1xuICAgICAgICAgICAgTVAuZGF0ZUxhc3RFdmVudFNlbnQgPSBudWxsO1xuICAgICAgICAgICAgTVAuc2Vzc2lvblN0YXJ0RGF0ZSA9IG51bGw7XG4gICAgICAgICAgICBNUC53YXRjaFBvc2l0aW9uSWQgPSBudWxsO1xuICAgICAgICAgICAgTVAucmVhZHlRdWV1ZSA9IFtdO1xuICAgICAgICAgICAgTVAubWlncmF0aW9uRGF0YSA9IHt9O1xuICAgICAgICAgICAgTVAuaWRlbnRpdHlDYWxsSW5GbGlnaHQgPSBmYWxzZTtcbiAgICAgICAgICAgIE1QLmluaXRpYWxJZGVudGlmeVJlcXVlc3QgPSBudWxsO1xuICAgICAgICAgICAgTVAuaXNJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgICAgICAgICAgTVAuaWRlbnRpZnlDYWxsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIE1QLmNvbnNlbnRTdGF0ZSA9IG51bGw7XG4gICAgICAgICAgICBNUC5mZWF0dXJlRmxhZ3MgPSB7fTtcbiAgICAgICAgICAgIEhlbHBlcnMubWVyZ2VDb25maWcoe30pO1xuICAgICAgICAgICAgaWYgKCFrZWVwUGVyc2lzdGVuY2UpIHtcbiAgICAgICAgICAgICAgICBQZXJzaXN0ZW5jZS5yZXNldFBlcnNpc3RlbmNlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayA9IG51bGw7XG4gICAgICAgICAgICBQZXJzaXN0ZW5jZS5mb3J3YXJkaW5nU3RhdHNCYXRjaGVzLnVwbG9hZHNUYWJsZSA9IHt9O1xuICAgICAgICAgICAgUGVyc2lzdGVuY2UuZm9yd2FyZGluZ1N0YXRzQmF0Y2hlcy5mb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlID0gW107XG4gICAgICAgIH0sXG4gICAgICAgIHJlYWR5OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgICBpZiAoTVAuaXNJbml0aWFsaXplZCAmJiB0eXBlb2YgZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIE1QLnJlYWR5UXVldWUucHVzaChmKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqIEBtZXRob2QgZ2V0VmVyc2lvblxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gbVBhcnRpY2xlIFNESyB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBnZXRWZXJzaW9uOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBDb25zdGFudHMuc2RrVmVyc2lvbjtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmVyc2lvbiB2ZXJzaW9uIG51bWJlclxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBWZXJzaW9uOiBmdW5jdGlvbih2ZXJzaW9uKSB7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gdmVyc2lvbjtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXRzIHRoZSBhcHAgbmFtZVxuICAgICAgICAqIEBtZXRob2QgZ2V0QXBwTmFtZVxuICAgICAgICAqIEByZXR1cm4ge1N0cmluZ30gQXBwIG5hbWVcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0QXBwTmFtZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuYXBwTmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0cyB0aGUgYXBwIG5hbWVcbiAgICAgICAgKiBAbWV0aG9kIHNldEFwcE5hbWVcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBBcHAgTmFtZVxuICAgICAgICAqL1xuICAgICAgICBzZXRBcHBOYW1lOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgICAgICBNUC5hcHBOYW1lID0gbmFtZTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0cyB0aGUgYXBwIHZlcnNpb25cbiAgICAgICAgKiBAbWV0aG9kIGdldEFwcFZlcnNpb25cbiAgICAgICAgKiBAcmV0dXJuIHtTdHJpbmd9IEFwcCB2ZXJzaW9uXG4gICAgICAgICovXG4gICAgICAgIGdldEFwcFZlcnNpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIE1QLmFwcFZlcnNpb247XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0b3BzIHRyYWNraW5nIHRoZSBsb2NhdGlvbiBvZiB0aGUgdXNlclxuICAgICAgICAqIEBtZXRob2Qgc3RvcFRyYWNraW5nTG9jYXRpb25cbiAgICAgICAgKi9cbiAgICAgICAgc3RvcFRyYWNraW5nTG9jYXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuc3RvcFRyYWNraW5nKCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFN0YXJ0cyB0cmFja2luZyB0aGUgbG9jYXRpb24gb2YgdGhlIHVzZXJcbiAgICAgICAgKiBAbWV0aG9kIHN0YXJ0VHJhY2tpbmdMb2NhdGlvblxuICAgICAgICAqL1xuICAgICAgICBzdGFydFRyYWNraW5nTG9jYXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBFdmVudHMuc3RhcnRUcmFja2luZygpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTZXRzIHRoZSBwb3NpdGlvbiBvZiB0aGUgdXNlclxuICAgICAgICAqIEBtZXRob2Qgc2V0UG9zaXRpb25cbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gbGF0dGl0dWRlIGxhdHRpdHVkZSBkaWdpdFxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgbG9uZ2l0dWRlIGRpZ2l0XG4gICAgICAgICovXG4gICAgICAgIHNldFBvc2l0aW9uOiBmdW5jdGlvbihsYXQsIGxuZykge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxhdCA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGxuZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICBNUC5jdXJyZW50UG9zaXRpb24gPSB7XG4gICAgICAgICAgICAgICAgICAgIGxhdDogbGF0LFxuICAgICAgICAgICAgICAgICAgICBsbmc6IGxuZ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQb3NpdGlvbiBsYXRpdHVkZSBhbmQvb3IgbG9uZ2l0dWRlIG11c3QgYm90aCBiZSBvZiB0eXBlIG51bWJlcicpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBTdGFydHMgYSBuZXcgc2Vzc2lvblxuICAgICAgICAqIEBtZXRob2Qgc3RhcnROZXdTZXNzaW9uXG4gICAgICAgICovXG4gICAgICAgIHN0YXJ0TmV3U2Vzc2lvbjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBTZXNzaW9uTWFuYWdlci5zdGFydE5ld1Nlc3Npb24oKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogRW5kcyB0aGUgY3VycmVudCBzZXNzaW9uXG4gICAgICAgICogQG1ldGhvZCBlbmRTZXNzaW9uXG4gICAgICAgICovXG4gICAgICAgIGVuZFNlc3Npb246IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy8gU2VuZHMgdHJ1ZSBhcyBhbiBvdmVyIHJpZGUgdnMgd2hlbiBlbmRTZXNzaW9uIGlzIGNhbGxlZCBmcm9tIHRoZSBzZXRJbnRlcnZhbFxuICAgICAgICAgICAgU2Vzc2lvbk1hbmFnZXIuZW5kU2Vzc2lvbih0cnVlKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogTG9ncyBhbiBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzXG4gICAgICAgICogQG1ldGhvZCBsb2dFdmVudFxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudE5hbWUgVGhlIG5hbWUgb2YgdGhlIGV2ZW50XG4gICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFtldmVudFR5cGVdIFRoZSBldmVudFR5cGUgYXMgc2VlbiBbaGVyZV0oaHR0cDovL2RvY3MubXBhcnRpY2xlLmNvbS9kZXZlbG9wZXJzL3Nkay9qYXZhc2NyaXB0L2V2ZW50LXRyYWNraW5nI2V2ZW50LXR5cGUpXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtldmVudEluZm9dIEF0dHJpYnV0ZXMgZm9yIHRoZSBldmVudFxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEFkZGl0aW9uYWwgY3VzdG9tRmxhZ3NcbiAgICAgICAgKi9cbiAgICAgICAgbG9nRXZlbnQ6IGZ1bmN0aW9uKGV2ZW50TmFtZSwgZXZlbnRUeXBlLCBldmVudEluZm8sIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgKGV2ZW50TmFtZSkgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkV2ZW50TmFtZUludmFsaWRUeXBlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZXZlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgZXZlbnRUeXBlID0gVHlwZXMuRXZlbnRUeXBlLlVua25vd247XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghSGVscGVycy5pc0V2ZW50VHlwZShldmVudFR5cGUpKSB7XG4gICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnSW52YWxpZCBldmVudCB0eXBlOiAnICsgZXZlbnRUeXBlICsgJywgbXVzdCBiZSBvbmUgb2Y6IFxcbicgKyBKU09OLnN0cmluZ2lmeShUeXBlcy5FdmVudFR5cGUpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuRXJyb3JNZXNzYWdlcy5Mb2dnaW5nRGlzYWJsZWQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgRXZlbnRzLmxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VFdmVudCwgZXZlbnROYW1lLCBldmVudEluZm8sIGV2ZW50VHlwZSwgY3VzdG9tRmxhZ3MpO1xuICAgICAgICB9LFxuICAgICAgICAvKipcbiAgICAgICAgKiBVc2VkIHRvIGxvZyBjdXN0b20gZXJyb3JzXG4gICAgICAgICpcbiAgICAgICAgKiBAbWV0aG9kIGxvZ0Vycm9yXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmcgb3IgT2JqZWN0fSBlcnJvciBUaGUgbmFtZSBvZiB0aGUgZXJyb3IgKHN0cmluZyksIG9yIGFuIG9iamVjdCBmb3JtZWQgYXMgZm9sbG93cyB7bmFtZTogJ2V4YW1wbGVOYW1lJywgbWVzc2FnZTogJ2V4YW1wbGVNZXNzYWdlJywgc3RhY2s6ICdleGFtcGxlU3RhY2snfVxuICAgICAgICAqL1xuICAgICAgICBsb2dFcnJvcjogZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgaWYgKCFlcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBlcnJvciA9IHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3JcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBFdmVudHMubG9nRXZlbnQoVHlwZXMuTWVzc2FnZVR5cGUuQ3Jhc2hSZXBvcnQsXG4gICAgICAgICAgICAgICAgZXJyb3IubmFtZSA/IGVycm9yLm5hbWUgOiAnRXJyb3InLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbTogZXJyb3IubWVzc2FnZSA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcixcbiAgICAgICAgICAgICAgICAgICAgczogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgdDogZXJyb3Iuc3RhY2tcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFR5cGVzLkV2ZW50VHlwZS5PdGhlcik7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYGNsaWNrYCBldmVudHNcbiAgICAgICAgKiBAbWV0aG9kIGxvZ0xpbmtcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gc2VsZWN0b3IgVGhlIHNlbGVjdG9yIHRvIGFkZCBhICdjbGljaycgZXZlbnQgdG8gKGV4LiAjcHVyY2hhc2UtZXZlbnQpXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtldmVudE5hbWVdIFRoZSBuYW1lIG9mIHRoZSBldmVudFxuICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbZXZlbnRUeXBlXSBUaGUgZXZlbnRUeXBlIGFzIHNlZW4gW2hlcmVdKGh0dHA6Ly9kb2NzLm1wYXJ0aWNsZS5jb20vZGV2ZWxvcGVycy9zZGsvamF2YXNjcmlwdC9ldmVudC10cmFja2luZyNldmVudC10eXBlKVxuICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbZXZlbnRJbmZvXSBBdHRyaWJ1dGVzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKi9cbiAgICAgICAgbG9nTGluazogZnVuY3Rpb24oc2VsZWN0b3IsIGV2ZW50TmFtZSwgZXZlbnRUeXBlLCBldmVudEluZm8pIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgRXZlbnRzLmFkZEV2ZW50SGFuZGxlcignY2xpY2snLCBzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudEluZm8sIGV2ZW50VHlwZSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIExvZ3MgYHN1Ym1pdGAgZXZlbnRzXG4gICAgICAgICogQG1ldGhvZCBsb2dGb3JtXG4gICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHNlbGVjdG9yIFRoZSBzZWxlY3RvciB0byBhZGQgdGhlIGV2ZW50IGhhbmRsZXIgdG8gKGV4LiAjc2VhcmNoLWV2ZW50KVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbZXZlbnROYW1lXSBUaGUgbmFtZSBvZiB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW2V2ZW50VHlwZV0gVGhlIGV2ZW50VHlwZSBhcyBzZWVuIFtoZXJlXShodHRwOi8vZG9jcy5tcGFydGljbGUuY29tL2RldmVsb3BlcnMvc2RrL2phdmFzY3JpcHQvZXZlbnQtdHJhY2tpbmcjZXZlbnQtdHlwZSlcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2V2ZW50SW5mb10gQXR0cmlidXRlcyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICovXG4gICAgICAgIGxvZ0Zvcm06IGZ1bmN0aW9uKHNlbGVjdG9yLCBldmVudE5hbWUsIGV2ZW50VHlwZSwgZXZlbnRJbmZvKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgIEV2ZW50cy5hZGRFdmVudEhhbmRsZXIoJ3N1Ym1pdCcsIHNlbGVjdG9yLCBldmVudE5hbWUsIGV2ZW50SW5mbywgZXZlbnRUeXBlKTtcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogTG9ncyBhIHBhZ2Ugdmlld1xuICAgICAgICAqIEBtZXRob2QgbG9nUGFnZVZpZXdcbiAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnROYW1lIFRoZSBuYW1lIG9mIHRoZSBldmVudC4gRGVmYXVsdHMgdG8gJ1BhZ2VWaWV3Jy5cbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBBdHRyaWJ1dGVzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAqL1xuICAgICAgICBsb2dQYWdlVmlldzogZnVuY3Rpb24oZXZlbnROYW1lLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuXG4gICAgICAgICAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1N0cmluZ09yTnVtYmVyKGV2ZW50TmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnROYW1lID0gJ1BhZ2VWaWV3JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFhdHRycykge1xuICAgICAgICAgICAgICAgICAgICBhdHRycyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhvc3RuYW1lOiB3aW5kb3cubG9jYXRpb24uaG9zdG5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogd2luZG93LmRvY3VtZW50LnRpdGxlXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFIZWxwZXJzLmlzT2JqZWN0KGF0dHJzKSl7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ1RoZSBhdHRyaWJ1dGVzIGFyZ3VtZW50IG11c3QgYmUgYW4gb2JqZWN0LiBBICcgKyB0eXBlb2YgYXR0cnMgKyAnIHdhcyBlbnRlcmVkLiBQbGVhc2UgY29ycmVjdCBhbmQgcmV0cnkuJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGN1c3RvbUZsYWdzICYmICFIZWxwZXJzLmlzT2JqZWN0KGN1c3RvbUZsYWdzKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgY3VzdG9tRmxhZ3MgYXJndW1lbnQgbXVzdCBiZSBhbiBvYmplY3QuIEEgJyArIHR5cGVvZiBjdXN0b21GbGFncyArICcgd2FzIGVudGVyZWQuIFBsZWFzZSBjb3JyZWN0IGFuZCByZXRyeS4nKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgRXZlbnRzLmxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlBhZ2VWaWV3LCBldmVudE5hbWUsIGF0dHJzLCBUeXBlcy5FdmVudFR5cGUuVW5rbm93biwgY3VzdG9tRmxhZ3MpO1xuICAgICAgICB9LFxuICAgICAgICBDb25zZW50OiB7XG4gICAgICAgICAgICBjcmVhdGVHRFBSQ29uc2VudDogQ29uc2VudC5jcmVhdGVHRFBSQ29uc2VudCxcbiAgICAgICAgICAgIGNyZWF0ZUNvbnNlbnRTdGF0ZTogQ29uc2VudC5jcmVhdGVDb25zZW50U3RhdGVcbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogSW52b2tlIHRoZXNlIG1ldGhvZHMgb24gdGhlIG1QYXJ0aWNsZS5lQ29tbWVyY2Ugb2JqZWN0LlxuICAgICAgICAqIEV4YW1wbGU6IG1QYXJ0aWNsZS5lQ29tbWVyY2UuY3JlYXRlSW1wcmVzaW9uKC4uLilcbiAgICAgICAgKiBAY2xhc3MgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAqL1xuICAgICAgICBlQ29tbWVyY2U6IHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBJbnZva2UgdGhlc2UgbWV0aG9kcyBvbiB0aGUgbVBhcnRpY2xlLmVDb21tZXJjZS5DYXJ0IG9iamVjdC5cbiAgICAgICAgICAgICogRXhhbXBsZTogbVBhcnRpY2xlLmVDb21tZXJjZS5DYXJ0LmFkZCguLi4pXG4gICAgICAgICAgICAqIEBjbGFzcyBtUGFydGljbGUuZUNvbW1lcmNlLkNhcnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBDYXJ0OiB7XG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgKiBBZGRzIGEgcHJvZHVjdCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQG1ldGhvZCBhZGRcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IFRoZSBwcm9kdWN0IHlvdSB3YW50IHRvIGFkZCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRCb29sZWFuXSBPcHRpb24gdG8gbG9nIHRoZSBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzLiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBhZGQ6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGVVc2VyQ2FydChNUC5tcGlkKS5hZGQocHJvZHVjdCwgbG9nRXZlbnRCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICogUmVtb3ZlcyBhIHByb2R1Y3QgZnJvbSB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQG1ldGhvZCByZW1vdmVcbiAgICAgICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IFRoZSBwcm9kdWN0IHlvdSB3YW50IHRvIGFkZCB0byB0aGUgY2FydFxuICAgICAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbbG9nRXZlbnRCb29sZWFuXSBPcHRpb24gdG8gbG9nIHRoZSBldmVudCB0byBtUGFydGljbGUncyBzZXJ2ZXJzLiBJZiBibGFuaywgbm8gbG9nZ2luZyBvY2N1cnMuXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICByZW1vdmU6IGZ1bmN0aW9uKHByb2R1Y3QsIGxvZ0V2ZW50Qm9vbGVhbikge1xuICAgICAgICAgICAgICAgICAgICBtUGFydGljbGVVc2VyQ2FydChNUC5tcGlkKS5yZW1vdmUocHJvZHVjdCwgbG9nRXZlbnRCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICogQ2xlYXJzIHRoZSBjYXJ0XG4gICAgICAgICAgICAgICAgKiBAbWV0aG9kIGNsZWFyXG4gICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBjbGVhcjogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZVVzZXJDYXJ0KE1QLm1waWQpLmNsZWFyKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBTZXRzIHRoZSBjdXJyZW5jeSBjb2RlXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIHNldEN1cnJlbmN5Q29kZVxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gY29kZSBUaGUgY3VycmVuY3kgY29kZVxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHNldEN1cnJlbmN5Q29kZTogZnVuY3Rpb24oY29kZSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY29kZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnQ29kZSBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgTVAuY3VycmVuY3lDb2RlID0gY29kZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb2R1Y3RcbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgY3JlYXRlUHJvZHVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBwcm9kdWN0IG5hbWVcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHNrdSBwcm9kdWN0IHNrdVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gcHJpY2UgcHJvZHVjdCBwcmljZVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3F1YW50aXR5XSBwcm9kdWN0IHF1YW50aXR5LiBJZiBibGFuaywgZGVmYXVsdHMgdG8gMS5cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFt2YXJpYW50XSBwcm9kdWN0IHZhcmlhbnRcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjYXRlZ29yeV0gcHJvZHVjdCBjYXRlZ29yeVxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2JyYW5kXSBwcm9kdWN0IGJyYW5kXG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbcG9zaXRpb25dIHByb2R1Y3QgcG9zaXRpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtjb3Vwb25dIHByb2R1Y3QgY291cG9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cmlidXRlc10gcHJvZHVjdCBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlUHJvZHVjdDogZnVuY3Rpb24obmFtZSwgc2t1LCBwcmljZSwgcXVhbnRpdHksIHZhcmlhbnQsIGNhdGVnb3J5LCBicmFuZCwgcG9zaXRpb24sIGNvdXBvbiwgYXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuY3JlYXRlUHJvZHVjdChuYW1lLCBza3UsIHByaWNlLCBxdWFudGl0eSwgdmFyaWFudCwgY2F0ZWdvcnksIGJyYW5kLCBwb3NpdGlvbiwgY291cG9uLCBhdHRyaWJ1dGVzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb21vdGlvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBjcmVhdGVQcm9tb3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGlkIGEgdW5pcXVlIHByb21vdGlvbiBpZFxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2NyZWF0aXZlXSBwcm9tb3Rpb24gY3JlYXRpdmVcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtuYW1lXSBwcm9tb3Rpb24gbmFtZVxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3Bvc2l0aW9uXSBwcm9tb3Rpb24gcG9zaXRpb25cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBjcmVhdGVQcm9tb3Rpb246IGZ1bmN0aW9uKGlkLCBjcmVhdGl2ZSwgbmFtZSwgcG9zaXRpb24pIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZVByb21vdGlvbihpZCwgY3JlYXRpdmUsIG5hbWUsIHBvc2l0aW9uKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHByb2R1Y3QgaW1wcmVzc2lvblxuICAgICAgICAgICAgKiBAZm9yIG1QYXJ0aWNsZS5lQ29tbWVyY2VcbiAgICAgICAgICAgICogQG1ldGhvZCBjcmVhdGVJbXByZXNzaW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIGltcHJlc3Npb24gbmFtZVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZHVjdCB0aGUgcHJvZHVjdCBmb3Igd2hpY2ggYW4gaW1wcmVzc2lvbiBpcyBiZWluZyBjcmVhdGVkXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlSW1wcmVzc2lvbjogZnVuY3Rpb24obmFtZSwgcHJvZHVjdCkge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuY3JlYXRlSW1wcmVzc2lvbihuYW1lLCBwcm9kdWN0KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogQ3JlYXRlcyBhIHRyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0IHRvIGJlIHVzZWQgd2l0aCBhIGNoZWNrb3V0XG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlc1xuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZyBvciBOdW1iZXJ9IGlkIGEgdW5pcXVlIHRyYW5zYWN0aW9uIGlkXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbYWZmaWxpYXRpb25dIGFmZmlsbGlhdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2NvdXBvbkNvZGVdIHRoZSBjb3Vwb24gY29kZSBmb3Igd2hpY2ggeW91IGFyZSBjcmVhdGluZyB0cmFuc2FjdGlvbiBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBbcmV2ZW51ZV0gdG90YWwgcmV2ZW51ZSBmb3IgdGhlIHByb2R1Y3QgYmVpbmcgcHVyY2hhc2VkXG4gICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbc2hpcHBpbmddIHRoZSBzaGlwcGluZyBtZXRob2RcbiAgICAgICAgICAgICogQHBhcmFtIHtOdW1iZXJ9IFt0YXhdIHRoZSB0YXggYW1vdW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgY3JlYXRlVHJhbnNhY3Rpb25BdHRyaWJ1dGVzOiBmdW5jdGlvbihpZCwgYWZmaWxpYXRpb24sIGNvdXBvbkNvZGUsIHJldmVudWUsIHNoaXBwaW5nLCB0YXgpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gRWNvbW1lcmNlLmNyZWF0ZVRyYW5zYWN0aW9uQXR0cmlidXRlcyhpZCwgYWZmaWxpYXRpb24sIGNvdXBvbkNvZGUsIHJldmVudWUsIHNoaXBwaW5nLCB0YXgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgY2hlY2tvdXQgYWN0aW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ0NoZWNrb3V0XG4gICAgICAgICAgICAqIEBwYXJhbSB7TnVtYmVyfSBzdGVwIGNoZWNrb3V0IHN0ZXAgbnVtYmVyXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBhdHRyc1xuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ0NoZWNrb3V0OiBmdW5jdGlvbihzdGVwLCBvcHRpb25zLCBhdHRycywgY3VzdG9tRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nQ2hlY2tvdXRFdmVudChzdGVwLCBvcHRpb25zLCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgcHJvZHVjdCBhY3Rpb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nUHJvZHVjdEFjdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gcHJvZHVjdEFjdGlvblR5cGUgcHJvZHVjdCBhY3Rpb24gdHlwZSBhcyBmb3VuZCBbaGVyZV0oaHR0cHM6Ly9naXRodWIuY29tL21QYXJ0aWNsZS9tcGFydGljbGUtc2RrLWphdmFzY3JpcHQvYmxvYi9tYXN0ZXItdjIvc3JjL3R5cGVzLmpzI0wyMDYtTDIxOClcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHByb2R1Y3QgdGhlIHByb2R1Y3QgZm9yIHdoaWNoIHlvdSBhcmUgY3JlYXRpbmcgdGhlIHByb2R1Y3QgYWN0aW9uXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cnNdIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcHJvZHVjdCBhY3Rpb25cbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IFtjdXN0b21GbGFnc10gQ3VzdG9tIGZsYWdzIGZvciB0aGUgZXZlbnRcbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBsb2dQcm9kdWN0QWN0aW9uOiBmdW5jdGlvbihwcm9kdWN0QWN0aW9uVHlwZSwgcHJvZHVjdCwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ1Byb2R1Y3RBY3Rpb25FdmVudChwcm9kdWN0QWN0aW9uVHlwZSwgcHJvZHVjdCwgYXR0cnMsIGN1c3RvbUZsYWdzKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHByb2R1Y3QgcHVyY2hhc2VcbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nUHVyY2hhc2VcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHRyYW5zYWN0aW9uQXR0cmlidXRlcyB0cmFuc2FjdGlvbkF0dHJpYnV0ZXMgb2JqZWN0XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHRoZSBwcm9kdWN0IGJlaW5nIHB1cmNoYXNlZFxuICAgICAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IFtjbGVhckNhcnRdIGJvb2xlYW4gdG8gY2xlYXIgdGhlIGNhcnQgYWZ0ZXIgbG9nZ2luZyBvciBub3QuIERlZmF1bHRzIHRvIGZhbHNlXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbYXR0cnNdIG90aGVyIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcHJvZHVjdCBwdXJjaGFzZVxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ1B1cmNoYXNlOiBmdW5jdGlvbih0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGNsZWFyQ2FydCwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0cmFuc2FjdGlvbkF0dHJpYnV0ZXMgfHwgIXByb2R1Y3QpIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkJhZExvZ1B1cmNoYXNlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIucmVzZXRTZXNzaW9uVGltZXIoKTtcbiAgICAgICAgICAgICAgICBFdmVudHMubG9nUHVyY2hhc2VFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncyk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY2xlYXJDYXJ0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydC5jbGVhcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICogTG9ncyBhIHByb2R1Y3QgcHJvbW90aW9uXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1Byb21vdGlvblxuICAgICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gdHlwZSB0aGUgcHJvbW90aW9uIHR5cGUgYXMgZm91bmQgW2hlcmVdKGh0dHBzOi8vZ2l0aHViLmNvbS9tUGFydGljbGUvbXBhcnRpY2xlLXNkay1qYXZhc2NyaXB0L2Jsb2IvbWFzdGVyLXYyL3NyYy90eXBlcy5qcyNMMjc1LUwyNzkpXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9tb3Rpb24gcHJvbW90aW9uIG9iamVjdFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBib29sZWFuIHRvIGNsZWFyIHRoZSBjYXJ0IGFmdGVyIGxvZ2dpbmcgb3Igbm90XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEN1c3RvbSBmbGFncyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgbG9nUHJvbW90aW9uOiBmdW5jdGlvbih0eXBlLCBwcm9tb3Rpb24sIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dQcm9tb3Rpb25FdmVudCh0eXBlLCBwcm9tb3Rpb24sIGF0dHJzLCBjdXN0b21GbGFncyk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAqIExvZ3MgYSBwcm9kdWN0IGltcHJlc3Npb25cbiAgICAgICAgICAgICogQGZvciBtUGFydGljbGUuZUNvbW1lcmNlXG4gICAgICAgICAgICAqIEBtZXRob2QgbG9nSW1wcmVzc2lvblxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gaW1wcmVzc2lvbiBwcm9kdWN0IGltcHJlc3Npb24gb2JqZWN0XG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBhdHRycyBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIGltcHJlc3Npb24gbG9nXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBbY3VzdG9tRmxhZ3NdIEN1c3RvbSBmbGFncyBmb3IgdGhlIGV2ZW50XG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgbG9nSW1wcmVzc2lvbjogZnVuY3Rpb24oaW1wcmVzc2lvbiwgYXR0cnMsIGN1c3RvbUZsYWdzKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICAgICAgRXZlbnRzLmxvZ0ltcHJlc3Npb25FdmVudChpbXByZXNzaW9uLCBhdHRycywgY3VzdG9tRmxhZ3MpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgKiBMb2dzIGEgcmVmdW5kXG4gICAgICAgICAgICAqIEBmb3IgbVBhcnRpY2xlLmVDb21tZXJjZVxuICAgICAgICAgICAgKiBAbWV0aG9kIGxvZ1JlZnVuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gdHJhbnNhY3Rpb25BdHRyaWJ1dGVzIHRyYW5zYWN0aW9uIGF0dHJpYnV0ZXMgcmVsYXRlZCB0byB0aGUgcmVmdW5kXG4gICAgICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwcm9kdWN0IHByb2R1Y3QgYmVpbmcgcmVmdW5kZWRcbiAgICAgICAgICAgICogQHBhcmFtIHtCb29sZWFufSBbY2xlYXJDYXJ0XSBib29sZWFuIHRvIGNsZWFyIHRoZSBjYXJ0IGFmdGVyIHJlZnVuZCBpcyBsb2dnZWQuIERlZmF1bHRzIHRvIGZhbHNlLlxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2F0dHJzXSBhdHRyaWJ1dGVzIHJlbGF0ZWQgdG8gdGhlIHJlZnVuZFxuICAgICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW2N1c3RvbUZsYWdzXSBDdXN0b20gZmxhZ3MgZm9yIHRoZSBldmVudFxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGxvZ1JlZnVuZDogZnVuY3Rpb24odHJhbnNhY3Rpb25BdHRyaWJ1dGVzLCBwcm9kdWN0LCBjbGVhckNhcnQsIGF0dHJzLCBjdXN0b21GbGFncykge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIEV2ZW50cy5sb2dSZWZ1bmRFdmVudCh0cmFuc2FjdGlvbkF0dHJpYnV0ZXMsIHByb2R1Y3QsIGF0dHJzLCBjdXN0b21GbGFncyk7XG5cbiAgICAgICAgICAgICAgICBpZiAoY2xlYXJDYXJ0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5lQ29tbWVyY2UuQ2FydC5jbGVhcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleHBhbmRDb21tZXJjZUV2ZW50OiBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgICAgIHJldHVybiBFY29tbWVyY2UuZXhwYW5kQ29tbWVyY2VFdmVudChldmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8qKlxuICAgICAgICAqIFNldHMgYSBzZXNzaW9uIGF0dHJpYnV0ZVxuICAgICAgICAqIEBmb3IgbVBhcnRpY2xlXG4gICAgICAgICogQG1ldGhvZCBtUGFydGljbGUuc2V0U2Vzc2lvbkF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkga2V5IGZvciBzZXNzaW9uIGF0dHJpYnV0ZVxuICAgICAgICAqIEBwYXJhbSB7U3RyaW5nIG9yIE51bWJlcn0gdmFsdWUgdmFsdWUgZm9yIHNlc3Npb24gYXR0cmlidXRlXG4gICAgICAgICovXG4gICAgICAgIHNldFNlc3Npb25BdHRyaWJ1dGU6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5yZXNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgLy8gTG9ncyB0byBjb29raWVcbiAgICAgICAgICAgIC8vIEFuZCBsb2dzIHRvIGluLW1lbW9yeSBvYmplY3RcbiAgICAgICAgICAgIC8vIEV4YW1wbGU6IG1QYXJ0aWNsZS5zZXRTZXNzaW9uQXR0cmlidXRlKCdsb2NhdGlvbicsICczMzQzMScpO1xuICAgICAgICAgICAgaWYgKEhlbHBlcnMuY2FuTG9nKCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVZhbGlkYXRvcnMuaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkQXR0cmlidXRlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghVmFsaWRhdG9ycy5pc1ZhbGlkS2V5VmFsdWUoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkVycm9yTWVzc2FnZXMuQmFkS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgICAgICAgICAgICAgIEhlbHBlcnMuc2VuZFRvTmF0aXZlKENvbnN0YW50cy5OYXRpdmVTZGtQYXRocy5TZXRTZXNzaW9uQXR0cmlidXRlLCBKU09OLnN0cmluZ2lmeSh7IGtleToga2V5LCB2YWx1ZTogdmFsdWUgfSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBleGlzdGluZ1Byb3AgPSBIZWxwZXJzLmZpbmRLZXlJbk9iamVjdChNUC5zZXNzaW9uQXR0cmlidXRlcywga2V5KTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdQcm9wKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXkgPSBleGlzdGluZ1Byb3A7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuXG4gICAgICAgICAgICAgICAgICAgIEZvcndhcmRlcnMuYXBwbHlUb0ZvcndhcmRlcnMoJ3NldFNlc3Npb25BdHRyaWJ1dGUnLCBba2V5LCB2YWx1ZV0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLyoqXG4gICAgICAgICogU2V0IG9wdCBvdXQgb2YgbG9nZ2luZ1xuICAgICAgICAqIEBmb3IgbVBhcnRpY2xlXG4gICAgICAgICogQG1ldGhvZCBzZXRPcHRPdXRcbiAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IGlzT3B0aW5nT3V0IGJvb2xlYW4gdG8gb3B0IG91dCBvciBub3QuIFdoZW4gc2V0IHRvIHRydWUsIG9wdCBvdXQgb2YgbG9nZ2luZy5cbiAgICAgICAgKi9cbiAgICAgICAgc2V0T3B0T3V0OiBmdW5jdGlvbihpc09wdGluZ091dCkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnNlc3Npb25NYW5hZ2VyLnJlc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgICAgICAgICBNUC5pc0VuYWJsZWQgPSAhaXNPcHRpbmdPdXQ7XG5cbiAgICAgICAgICAgIEV2ZW50cy5sb2dPcHRPdXQoKTtcbiAgICAgICAgICAgIFBlcnNpc3RlbmNlLnVwZGF0ZSgpO1xuXG4gICAgICAgICAgICBpZiAoTVAuYWN0aXZlRm9yd2FyZGVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBNUC5hY3RpdmVGb3J3YXJkZXJzLmZvckVhY2goZnVuY3Rpb24oZm9yd2FyZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3J3YXJkZXIuc2V0T3B0T3V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gZm9yd2FyZGVyLnNldE9wdE91dChpc09wdGluZ091dCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYWRkRm9yd2FyZGVyOiBmdW5jdGlvbihmb3J3YXJkZXJQcm9jZXNzb3IpIHtcbiAgICAgICAgICAgIE1QLmZvcndhcmRlckNvbnN0cnVjdG9ycy5wdXNoKGZvcndhcmRlclByb2Nlc3Nvcik7XG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpZ3VyZUZvcndhcmRlcjogZnVuY3Rpb24oY29uZmlndXJhdGlvbikge1xuICAgICAgICAgICAgdmFyIG5ld0ZvcndhcmRlciA9IG51bGwsXG4gICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlndXJhdGlvbjtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgTVAuZm9yd2FyZGVyQ29uc3RydWN0b3JzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKE1QLmZvcndhcmRlckNvbnN0cnVjdG9yc1tpXS5uYW1lID09PSBjb25maWcubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmlzRGVidWcgPT09IG1QYXJ0aWNsZS5pc0RldmVsb3BtZW50TW9kZSB8fCBjb25maWcuaXNTYW5kYm94ID09PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlciA9IG5ldyBNUC5mb3J3YXJkZXJDb25zdHJ1Y3RvcnNbaV0uY29uc3RydWN0b3IoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlkID0gY29uZmlnLm1vZHVsZUlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlzU2FuZGJveCA9IGNvbmZpZy5pc0RlYnVnIHx8IGNvbmZpZy5pc1NhbmRib3g7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuaGFzU2FuZGJveCA9IGNvbmZpZy5oYXNEZWJ1Z1N0cmluZyA9PT0gJ3RydWUnO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmlzVmlzaWJsZSA9IGNvbmZpZy5pc1Zpc2libGU7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuc2V0dGluZ3MgPSBjb25maWcuc2V0dGluZ3M7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5ldmVudE5hbWVGaWx0ZXJzID0gY29uZmlnLmV2ZW50TmFtZUZpbHRlcnM7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZXZlbnRUeXBlRmlsdGVycyA9IGNvbmZpZy5ldmVudFR5cGVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLmF0dHJpYnV0ZUZpbHRlcnMgPSBjb25maWcuYXR0cmlidXRlRmlsdGVycztcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnNjcmVlbk5hbWVGaWx0ZXJzID0gY29uZmlnLnNjcmVlbk5hbWVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnNjcmVlbk5hbWVGaWx0ZXJzID0gY29uZmlnLnNjcmVlbk5hbWVGaWx0ZXJzO1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3Rm9yd2FyZGVyLnBhZ2VWaWV3QXR0cmlidXRlRmlsdGVycyA9IGNvbmZpZy5wYWdlVmlld0F0dHJpYnV0ZUZpbHRlcnM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci51c2VySWRlbnRpdHlGaWx0ZXJzID0gY29uZmlnLnVzZXJJZGVudGl0eUZpbHRlcnM7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIudXNlckF0dHJpYnV0ZUZpbHRlcnMgPSBjb25maWcudXNlckF0dHJpYnV0ZUZpbHRlcnM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5maWx0ZXJpbmdFdmVudEF0dHJpYnV0ZVZhbHVlID0gY29uZmlnLmZpbHRlcmluZ0V2ZW50QXR0cmlidXRlVmFsdWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZmlsdGVyaW5nVXNlckF0dHJpYnV0ZVZhbHVlID0gY29uZmlnLmZpbHRlcmluZ1VzZXJBdHRyaWJ1dGVWYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ld0ZvcndhcmRlci5ldmVudFN1YnNjcmlwdGlvbklkID0gY29uZmlnLmV2ZW50U3Vic2NyaXB0aW9uSWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdGb3J3YXJkZXIuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXMgPSBjb25maWcuZmlsdGVyaW5nQ29uc2VudFJ1bGVWYWx1ZXM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIE1QLmNvbmZpZ3VyZWRGb3J3YXJkZXJzLnB1c2gobmV3Rm9yd2FyZGVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBjb25maWd1cmVQaXhlbDogZnVuY3Rpb24oc2V0dGluZ3MpIHtcbiAgICAgICAgICAgIGlmIChzZXR0aW5ncy5pc0RlYnVnID09PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUgfHwgc2V0dGluZ3MuaXNQcm9kdWN0aW9uICE9PSBtUGFydGljbGUuaXNEZXZlbG9wbWVudE1vZGUpIHtcbiAgICAgICAgICAgICAgICBNUC5waXhlbENvbmZpZ3VyYXRpb25zLnB1c2goc2V0dGluZ3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBfZ2V0QWN0aXZlRm9yd2FyZGVyczogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gTVAuYWN0aXZlRm9yd2FyZGVycztcbiAgICAgICAgfSxcbiAgICAgICAgX2NvbmZpZ3VyZUZlYXR1cmVzOiBmdW5jdGlvbihmZWF0dXJlRmxhZ3MpIHtcbiAgICAgICAgICAgIGZvciAodmFyIGtleSBpbiBmZWF0dXJlRmxhZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAoZmVhdHVyZUZsYWdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgTVAuZmVhdHVyZUZsYWdzW2tleV0gPSBmZWF0dXJlRmxhZ3Nba2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gcHJvY2Vzc1ByZWxvYWRlZEl0ZW0ocmVhZHlRdWV1ZUl0ZW0pIHtcbiAgICAgICAgdmFyIGN1cnJlbnRVc2VyLFxuICAgICAgICAgICAgYXJncyA9IHJlYWR5UXVldWVJdGVtLFxuICAgICAgICAgICAgbWV0aG9kID0gYXJncy5zcGxpY2UoMCwgMSlbMF07XG4gICAgICAgIGlmIChtUGFydGljbGVbYXJnc1swXV0pIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZVttZXRob2RdLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIG1ldGhvZEFycmF5ID0gbWV0aG9kLnNwbGl0KCcuJyk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHZhciBjb21wdXRlZE1QRnVuY3Rpb24gPSBtUGFydGljbGU7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtZXRob2RBcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICB2YXIgY3VycmVudE1ldGhvZCA9IG1ldGhvZEFycmF5W2ldO1xuICAgICAgICAgICAgICAgICAgICBjb21wdXRlZE1QRnVuY3Rpb24gPSBjb21wdXRlZE1QRnVuY3Rpb25bY3VycmVudE1ldGhvZF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbXB1dGVkTVBGdW5jdGlvbi5hcHBseShjdXJyZW50VXNlciwgYXJncyk7XG4gICAgICAgICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdVbmFibGUgdG8gY29tcHV0ZSBwcm9wZXIgbVBhcnRpY2xlIGZ1bmN0aW9uICcgKyBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJlYWQgZXhpc3RpbmcgY29uZmlndXJhdGlvbiBpZiBwcmVzZW50XG4gICAgaWYgKHdpbmRvdy5tUGFydGljbGUgJiYgd2luZG93Lm1QYXJ0aWNsZS5jb25maWcpIHtcbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnNlcnZpY2VVcmwpIHtcbiAgICAgICAgICAgIENvbnN0YW50cy5zZXJ2aWNlVXJsID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuc2VydmljZVVybDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5zZWN1cmVTZXJ2aWNlVXJsKSB7XG4gICAgICAgICAgICBDb25zdGFudHMuc2VjdXJlU2VydmljZVVybCA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnNlY3VyZVNlcnZpY2VVcmw7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBmb3IgYW55IGZ1bmN0aW9ucyBxdWV1ZWRcbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnJxKSB7XG4gICAgICAgICAgICBNUC5yZWFkeVF1ZXVlID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcucnE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2lzRGV2ZWxvcG1lbnRNb2RlJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5pc0RldmVsb3BtZW50TW9kZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmlzRGV2ZWxvcG1lbnRNb2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCd1c2VOYXRpdmVTZGsnKSkge1xuICAgICAgICAgICAgbVBhcnRpY2xlLnVzZU5hdGl2ZVNkayA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnVzZU5hdGl2ZVNkaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgndXNlQ29va2llU3RvcmFnZScpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLnVzZUNvb2tpZVN0b3JhZ2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ21heFByb2R1Y3RzJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5tYXhQcm9kdWN0cyA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLm1heFByb2R1Y3RzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdtYXhDb29raWVTaXplJykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5tYXhDb29raWVTaXplID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcubWF4Q29va2llU2l6ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnYXBwTmFtZScpKSB7XG4gICAgICAgICAgICBNUC5hcHBOYW1lID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuYXBwTmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnaWRlbnRpZnlSZXF1ZXN0JykpIHtcbiAgICAgICAgICAgIG1QYXJ0aWNsZS5pZGVudGlmeVJlcXVlc3QgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5pZGVudGlmeVJlcXVlc3Q7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaGFzT3duUHJvcGVydHkoJ2lkZW50aXR5Q2FsbGJhY2snKSkge1xuICAgICAgICAgICAgdmFyIGNhbGxiYWNrID0gd2luZG93Lm1QYXJ0aWNsZS5jb25maWcuaWRlbnRpdHlDYWxsYmFjaztcbiAgICAgICAgICAgIGlmIChWYWxpZGF0b3JzLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgbVBhcnRpY2xlLmlkZW50aXR5Q2FsbGJhY2sgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5pZGVudGl0eUNhbGxiYWNrO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdUaGUgb3B0aW9uYWwgY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uLiBZb3UgdHJpZWQgZW50ZXJpbmcgYShuKSAnICsgdHlwZW9mIGNhbGxiYWNrLCAnIC4gQ2FsbGJhY2sgbm90IHNldC4gUGxlYXNlIHNldCB5b3VyIGNhbGxiYWNrIGFnYWluLicpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdhcHBWZXJzaW9uJykpIHtcbiAgICAgICAgICAgIE1QLmFwcFZlcnNpb24gPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5hcHBWZXJzaW9uO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdzZXNzaW9uVGltZW91dCcpKSB7XG4gICAgICAgICAgICBNUC5Db25maWcuU2Vzc2lvblRpbWVvdXQgPSB3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5zZXNzaW9uVGltZW91dDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3aW5kb3cubVBhcnRpY2xlLmNvbmZpZy5oYXNPd25Qcm9wZXJ0eSgnZm9yY2VIdHRwcycpKSB7XG4gICAgICAgICAgICBtUGFydGljbGUuZm9yY2VIdHRwcyA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmZvcmNlSHR0cHM7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBtUGFydGljbGUuZm9yY2VIdHRwcyA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTb21lIGZvcndhcmRlcnMgcmVxdWlyZSBjdXN0b20gZmxhZ3Mgb24gaW5pdGlhbGl6YXRpb24sIHNvIGFsbG93IHRoZW0gdG8gYmUgc2V0IHVzaW5nIGNvbmZpZyBvYmplY3RcbiAgICAgICAgaWYgKHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmhhc093blByb3BlcnR5KCdjdXN0b21GbGFncycpKSB7XG4gICAgICAgICAgICBNUC5jdXN0b21GbGFncyA9IHdpbmRvdy5tUGFydGljbGUuY29uZmlnLmN1c3RvbUZsYWdzO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdpbmRvdy5tUGFydGljbGUgPSBtUGFydGljbGU7XG59KSh3aW5kb3cpO1xuIiwidmFyIFBlcnNpc3RlbmNlID0gcmVxdWlyZSgnLi9wZXJzaXN0ZW5jZScpLFxuICAgIENvbnN0YW50cyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJyksXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgSGVscGVycyA9IHJlcXVpcmUoJy4vaGVscGVycycpLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIENvbmZpZyA9IE1QLkNvbmZpZyxcbiAgICBTREt2Mk5vbk1QSURDb29raWVLZXlzID0gQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMsXG4gICAgQmFzZTY0ID0gcmVxdWlyZSgnLi9wb2x5ZmlsbCcpLkJhc2U2NCxcbiAgICBDb29raWVzR2xvYmFsU2V0dGluZ3NLZXlzID0ge1xuICAgICAgICBjdXJyZW50U2Vzc2lvbk1QSURzOiAxLFxuICAgICAgICBjc206IDEsXG4gICAgICAgIHNpZDogMSxcbiAgICAgICAgaXNFbmFibGVkOiAxLFxuICAgICAgICBpZTogMSxcbiAgICAgICAgc2E6IDEsXG4gICAgICAgIHNzOiAxLFxuICAgICAgICBkdDogMSxcbiAgICAgICAgbGVzOiAxLFxuICAgICAgICBhdjogMSxcbiAgICAgICAgY2dpZDogMSxcbiAgICAgICAgZGFzOiAxLFxuICAgICAgICBjOiAxXG4gICAgfSxcbiAgICBNUElES2V5cyA9IHtcbiAgICAgICAgdWk6IDEsXG4gICAgICAgIHVhOiAxLFxuICAgICAgICBjc2Q6IDFcbiAgICB9O1xuXG4vLyAgaWYgdGhlcmUgaXMgYSBjb29raWUgb3IgbG9jYWxTdG9yYWdlOlxuLy8gIDEuIGRldGVybWluZSB3aGljaCB2ZXJzaW9uIGl0IGlzICgnbXBydGNsLWFwaScsICdtcHJ0Y2wtdjInLCAnbXBydGNsLXYzJywgJ21wcnRjbC12NCcpXG4vLyAgMi4gcmV0dXJuIGlmICdtcHJ0Y2wtdjQnLCBvdGhlcndpc2UgbWlncmF0ZSB0byBtcHJ0Y2x2NCBzY2hlbWFcbiAvLyAzLiBpZiAnbXBydGNsLWFwaScsIGNvdWxkIGJlIEpTU0RLdjIgb3IgSlNTREt2MS4gSlNTREt2MiBjb29raWUgaGFzIGEgJ2dsb2JhbFNldHRpbmdzJyBrZXkgb24gaXRcbmZ1bmN0aW9uIG1pZ3JhdGUoKSB7XG4gICAgbWlncmF0ZUNvb2tpZXMoKTtcbiAgICBtaWdyYXRlTG9jYWxTdG9yYWdlKCk7XG59XG5cbmZ1bmN0aW9uIG1pZ3JhdGVDb29raWVzKCkge1xuICAgIHZhciBjb29raWVzID0gd2luZG93LmRvY3VtZW50LmNvb2tpZS5zcGxpdCgnOyAnKSxcbiAgICAgICAgZm91bmRDb29raWUsXG4gICAgICAgIGksXG4gICAgICAgIGwsXG4gICAgICAgIHBhcnRzLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjb29raWU7XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKENvbnN0YW50cy5NZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVNlYXJjaCk7XG5cbiAgICBmb3IgKGkgPSAwLCBsID0gY29va2llcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgcGFydHMgPSBjb29raWVzW2ldLnNwbGl0KCc9Jyk7XG4gICAgICAgIG5hbWUgPSBIZWxwZXJzLmRlY29kZWQocGFydHMuc2hpZnQoKSk7XG4gICAgICAgIGNvb2tpZSA9IEhlbHBlcnMuZGVjb2RlZChwYXJ0cy5qb2luKCc9JykpLFxuICAgICAgICBmb3VuZENvb2tpZTtcblxuICAgICAgICAvL21vc3QgcmVjZW50IHZlcnNpb24gbmVlZHMgbm8gbWlncmF0aW9uXG4gICAgICAgIGlmIChuYW1lID09PSBDb25maWcuQ29va2llTmFtZVY0KSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgLy8gbWlncmF0aW9uIHBhdGggZm9yIFNES3YxQ29va2llc1YzLCBkb2Vzbid0IG5lZWQgdG8gYmUgZW5jb2RlZFxuICAgICAgICB9IGVsc2UgaWYgKG5hbWUgPT09IENvbmZpZy5Db29raWVOYW1lVjMpIHtcbiAgICAgICAgICAgIGZvdW5kQ29va2llID0gY29udmVydFNES3YxQ29va2llc1YzVG9TREt2MkNvb2tpZXNWNChjb29raWUpO1xuICAgICAgICAgICAgZmluaXNoQ29va2llTWlncmF0aW9uKGZvdW5kQ29va2llLCBDb25maWcuQ29va2llTmFtZVYzKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBtaWdyYXRpb24gcGF0aCBmb3IgU0RLdjFDb29raWVzVjIsIG5lZWRzIHRvIGJlIGVuY29kZWRcbiAgICAgICAgfSBlbHNlIGlmIChuYW1lID09PSBDb25maWcuQ29va2llTmFtZVYyKSB7XG4gICAgICAgICAgICBmb3VuZENvb2tpZSA9IGNvbnZlcnRTREt2MUNvb2tpZXNWMlRvU0RLdjJDb29raWVzVjQoSGVscGVycy5jb252ZXJ0ZWQoY29va2llKSk7XG4gICAgICAgICAgICBmaW5pc2hDb29raWVNaWdyYXRpb24oUGVyc2lzdGVuY2UuZW5jb2RlQ29va2llcyhmb3VuZENvb2tpZSksIENvbmZpZy5Db29raWVOYW1lVjIpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIG1pZ3JhdGlvbiBwYXRoIGZvciB2MSwgbmVlZHMgdG8gYmUgZW5jb2RlZFxuICAgICAgICB9IGVsc2UgaWYgKG5hbWUgPT09IENvbmZpZy5Db29raWVOYW1lKSB7XG4gICAgICAgICAgICBmb3VuZENvb2tpZSA9IEhlbHBlcnMuY29udmVydGVkKGNvb2tpZSk7XG4gICAgICAgICAgICBpZiAoSlNPTi5wYXJzZShmb3VuZENvb2tpZSkuZ2xvYmFsU2V0dGluZ3MpIHtcbiAgICAgICAgICAgICAgICAvLyBDb29raWVWMSBmcm9tIFNES3YyXG4gICAgICAgICAgICAgICAgZm91bmRDb29raWUgPSBjb252ZXJ0U0RLdjJDb29raWVzVjFUb1NES3YyRGVjb2RlZENvb2tpZXNWNChmb3VuZENvb2tpZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIENvb2tpZVYxIGZyb20gU0RLdjFcbiAgICAgICAgICAgICAgICBmb3VuZENvb2tpZSA9IGNvbnZlcnRTREt2MUNvb2tpZXNWMVRvU0RLdjJDb29raWVzVjQoZm91bmRDb29raWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZmluaXNoQ29va2llTWlncmF0aW9uKFBlcnNpc3RlbmNlLmVuY29kZUNvb2tpZXMoZm91bmRDb29raWUpLCBDb25maWcuQ29va2llTmFtZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZmluaXNoQ29va2llTWlncmF0aW9uKGNvb2tpZSwgY29va2llTmFtZSkge1xuICAgIHZhciBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAgY29va2llRG9tYWluID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llRG9tYWluKCksXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICAgIGRvbWFpbjtcblxuICAgIGV4cGlyZXMgPSBuZXcgRGF0ZShkYXRlLmdldFRpbWUoKSArXG4gICAgKENvbmZpZy5Db29raWVFeHBpcmF0aW9uICogMjQgKiA2MCAqIDYwICogMTAwMCkpLnRvR01UU3RyaW5nKCk7XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIEhlbHBlcnMubG9nRGVidWcoQ29uc3RhbnRzLk1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llU2V0KTtcblxuICAgIHdpbmRvdy5kb2N1bWVudC5jb29raWUgPVxuICAgIGVuY29kZVVSSUNvbXBvbmVudChDb25maWcuQ29va2llTmFtZVY0KSArICc9JyArIGNvb2tpZSArXG4gICAgJztleHBpcmVzPScgKyBleHBpcmVzICtcbiAgICAnO3BhdGg9LycgKyBkb21haW47XG5cbiAgICBQZXJzaXN0ZW5jZS5leHBpcmVDb29raWVzKGNvb2tpZU5hbWUpO1xuICAgIE1QLm1pZ3JhdGluZ1RvSURTeW5jQ29va2llcyA9IHRydWU7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTREt2MUNvb2tpZXNWMVRvU0RLdjJDb29raWVzVjQoU0RLdjFDb29raWVzVjEpIHtcbiAgICB2YXIgcGFyc2VkQ29va2llc1Y0ID0gSlNPTi5wYXJzZShyZXN0cnVjdHVyZVRvVjRDb29raWUoZGVjb2RlVVJJQ29tcG9uZW50KFNES3YxQ29va2llc1YxKSkpLFxuICAgICAgICBwYXJzZWRTREt2MUNvb2tpZXNWMSA9IEpTT04ucGFyc2UoZGVjb2RlVVJJQ29tcG9uZW50KFNES3YxQ29va2llc1YxKSk7XG5cbiAgICAvLyBVSSB3YXMgc3RvcmVkIGFzIGFuIGFycmF5IHByZXZpb3VzbHksIHdlIG5lZWQgdG8gY29udmVydCB0byBhbiBvYmplY3RcbiAgICBwYXJzZWRDb29raWVzVjQgPSBjb252ZXJ0VUlGcm9tQXJyYXlUb09iamVjdChwYXJzZWRDb29raWVzVjQpO1xuXG4gICAgaWYgKHBhcnNlZFNES3YxQ29va2llc1YxLm1waWQpIHtcbiAgICAgICAgcGFyc2VkQ29va2llc1Y0LmdzLmNzbS5wdXNoKHBhcnNlZFNES3YxQ29va2llc1YxLm1waWQpO1xuICAgICAgICBtaWdyYXRlUHJvZHVjdHNGcm9tU0RLdjFUb1NES3YyQ29va2llc1Y0KHBhcnNlZFNES3YxQ29va2llc1YxLCBwYXJzZWRTREt2MUNvb2tpZXNWMS5tcGlkKTtcbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGFyc2VkQ29va2llc1Y0KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFNES3YxQ29va2llc1YyVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMikge1xuICAgIC8vIHN0cnVjdHVyZSBvZiBTREt2MUNvb2tpZXNWMiBpcyBpZGVudGl0YWwgdG8gU0RLdjFDb29raWVzVjFcbiAgICByZXR1cm4gY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNChTREt2MUNvb2tpZXNWMik7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTREt2MUNvb2tpZXNWM1RvU0RLdjJDb29raWVzVjQoU0RLdjFDb29raWVzVjMpIHtcbiAgICBTREt2MUNvb2tpZXNWMyA9IFBlcnNpc3RlbmNlLnJlcGxhY2VQaXBlc1dpdGhDb21tYXMoUGVyc2lzdGVuY2UucmVwbGFjZUFwb3N0cm9waGVzV2l0aFF1b3RlcyhTREt2MUNvb2tpZXNWMykpO1xuICAgIHZhciBwYXJzZWRTREt2MUNvb2tpZXNWMyA9IEpTT04ucGFyc2UoU0RLdjFDb29raWVzVjMpO1xuICAgIHZhciBwYXJzZWRDb29raWVzVjQgPSBKU09OLnBhcnNlKHJlc3RydWN0dXJlVG9WNENvb2tpZShTREt2MUNvb2tpZXNWMykpO1xuXG4gICAgaWYgKHBhcnNlZFNES3YxQ29va2llc1YzLm1waWQpIHtcbiAgICAgICAgcGFyc2VkQ29va2llc1Y0LmdzLmNzbS5wdXNoKHBhcnNlZFNES3YxQ29va2llc1YzLm1waWQpO1xuICAgICAgICAvLyBhbGwgb3RoZXIgdmFsdWVzIGFyZSBhbHJlYWR5IGVuY29kZWQsIHNvIHdlIGhhdmUgdG8gZW5jb2RlIGFueSBuZXcgdmFsdWVzXG4gICAgICAgIHBhcnNlZENvb2tpZXNWNC5ncy5jc20gPSBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KHBhcnNlZENvb2tpZXNWNC5ncy5jc20pKTtcbiAgICAgICAgbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNChwYXJzZWRTREt2MUNvb2tpZXNWMywgcGFyc2VkU0RLdjFDb29raWVzVjMubXBpZCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHBhcnNlZENvb2tpZXNWNCk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRTREt2MkNvb2tpZXNWMVRvU0RLdjJEZWNvZGVkQ29va2llc1Y0KFNES3YyQ29va2llc1YxKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgdmFyIGNvb2tpZXNWNCA9IHsgZ3M6IHt9fSxcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzID0ge307XG5cbiAgICAgICAgU0RLdjJDb29raWVzVjEgPSBKU09OLnBhcnNlKFNES3YyQ29va2llc1YxKTtcbiAgICAgICAgY29va2llc1Y0ID0gc2V0R2xvYmFsU2V0dGluZ3MoY29va2llc1Y0LCBTREt2MkNvb2tpZXNWMSk7XG5cbiAgICAgICAgLy8gc2V0IGVhY2ggTVBJRCdzIHJlc3BlY3RpdmUgcGVyc2lzdGVuY2VcbiAgICAgICAgZm9yICh2YXIgbXBpZCBpbiBTREt2MkNvb2tpZXNWMSkge1xuICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgY29va2llc1Y0W21waWRdID0ge307XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgbXBpZEtleSBpbiBTREt2MkNvb2tpZXNWMVttcGlkXSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoU0RLdjJDb29raWVzVjFbbXBpZF0uaGFzT3duUHJvcGVydHkobXBpZEtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChNUElES2V5c1ttcGlkS2V5XSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChIZWxwZXJzLmlzT2JqZWN0KFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldKSAmJiBPYmplY3Qua2V5cyhTREt2MkNvb2tpZXNWMVttcGlkXVttcGlkS2V5XSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtcGlkS2V5ID09PSAndWknKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRbbXBpZF0udWkgPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIHR5cGVOYW1lIGluIFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldLmhhc093blByb3BlcnR5KHR5cGVOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRbbXBpZF0udWlbVHlwZXMuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZSh0eXBlTmFtZSldID0gU0RLdjJDb29raWVzVjFbbXBpZF1bbXBpZEtleV1bdHlwZU5hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFttcGlkXVttcGlkS2V5XSA9IFNES3YyQ29va2llc1YxW21waWRdW21waWRLZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGNwOiBTREt2MkNvb2tpZXNWMVttcGlkXS5jcFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShDb25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VQcm9kdWN0cykpKTtcblxuICAgICAgICBpZiAoU0RLdjJDb29raWVzVjEuY3VycmVudFVzZXJNUElEKSB7XG4gICAgICAgICAgICBjb29raWVzVjQuY3UgPSBTREt2MkNvb2tpZXNWMS5jdXJyZW50VXNlck1QSUQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoY29va2llc1Y0KTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRmFpbGVkIHRvIGNvbnZlcnQgY29va2llcyBmcm9tIFNES3YyIGNvb2tpZXMgdjEgdG8gU0RLdjIgY29va2llcyB2NCcpO1xuICAgIH1cbn1cblxuLy8gbWlncmF0ZSBmcm9tIG9iamVjdCBjb250YWluaW5nIGdsb2JhbFNldHRpbmdzIHRvIGdzIHRvIHJlZHVjZSBjb29raWUgc2l6ZVxuZnVuY3Rpb24gc2V0R2xvYmFsU2V0dGluZ3MoY29va2llcywgU0RLdjJDb29raWVzVjEpIHtcbiAgICBpZiAoU0RLdjJDb29raWVzVjEgJiYgU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3MpIHtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzKSB7XG4gICAgICAgICAgICBpZiAoU0RLdjJDb29raWVzVjEuZ2xvYmFsU2V0dGluZ3MuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09ICdjdXJyZW50U2Vzc2lvbk1QSURzJykge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzLmdzLmNzbSA9IFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzW2tleV07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09ICdpc0VuYWJsZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXMuZ3MuaWUgPSBTREt2MkNvb2tpZXNWMS5nbG9iYWxTZXR0aW5nc1trZXldO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXMuZ3Nba2V5XSA9IFNES3YyQ29va2llc1YxLmdsb2JhbFNldHRpbmdzW2tleV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvb2tpZXM7XG59XG5cbmZ1bmN0aW9uIHJlc3RydWN0dXJlVG9WNENvb2tpZShjb29raWVzKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgdmFyIGNvb2tpZXNWNFNjaGVtYSA9IHsgZ3M6IHtjc206IFtdfSB9O1xuICAgICAgICBjb29raWVzID0gSlNPTi5wYXJzZShjb29raWVzKTtcblxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgIGlmIChDb29raWVzR2xvYmFsU2V0dGluZ3NLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gJ2lzRW5hYmxlZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFNjaGVtYS5ncy5pZSA9IGNvb2tpZXNba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFNjaGVtYS5nc1trZXldID0gY29va2llc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09ICdtcGlkJykge1xuICAgICAgICAgICAgICAgICAgICBjb29raWVzVjRTY2hlbWEuY3UgPSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjb29raWVzLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29va2llc1Y0U2NoZW1hW2Nvb2tpZXMubXBpZF0gPSBjb29raWVzVjRTY2hlbWFbY29va2llcy5tcGlkXSB8fCB7fTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QSURLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZXNWNFNjaGVtYVtjb29raWVzLm1waWRdW2tleV0gPSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGNvb2tpZXNWNFNjaGVtYSk7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0ZhaWxlZCB0byByZXN0cnVjdHVyZSBwcmV2aW91cyBjb29raWUgaW50byBtb3N0IGN1cnJlbnQgY29va2llIHNjaGVtYScpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNChjb29raWVzLCBtcGlkKSB7XG4gICAgdmFyIGxvY2FsU3RvcmFnZVByb2R1Y3RzID0ge307XG4gICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0gPSB7fTtcbiAgICBpZiAoY29va2llcy5jcCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHNbbXBpZF0uY3AgPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUoY29va2llcy5jcCkpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VQcm9kdWN0c1ttcGlkXS5jcCA9IGNvb2tpZXMuY3A7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShDb25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VQcm9kdWN0cykpKTtcbn1cblxuZnVuY3Rpb24gbWlncmF0ZUxvY2FsU3RvcmFnZSgpIHtcbiAgICB2YXIgY3VycmVudFZlcnNpb25MU05hbWUgPSBDb25maWcuTG9jYWxTdG9yYWdlTmFtZVY0LFxuICAgICAgICBjb29raWVzLFxuICAgICAgICB2MUxTTmFtZSA9IENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lLFxuICAgICAgICB2M0xTTmFtZSA9IENvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjMsXG4gICAgICAgIGN1cnJlbnRWZXJzaW9uTFNEYXRhID0gd2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKGN1cnJlbnRWZXJzaW9uTFNOYW1lKSxcbiAgICAgICAgdjFMU0RhdGEsXG4gICAgICAgIHYzTFNEYXRhLFxuICAgICAgICB2M0xTRGF0YVN0cmluZ0NvcHk7XG5cbiAgICBpZiAoIWN1cnJlbnRWZXJzaW9uTFNEYXRhKSB7XG4gICAgICAgIHYzTFNEYXRhID0gd2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKHYzTFNOYW1lKTtcbiAgICAgICAgaWYgKHYzTFNEYXRhKSB7XG4gICAgICAgICAgICBNUC5taWdyYXRpbmdUb0lEU3luY0Nvb2tpZXMgPSB0cnVlO1xuICAgICAgICAgICAgdjNMU0RhdGFTdHJpbmdDb3B5ID0gdjNMU0RhdGEuc2xpY2UoKTtcbiAgICAgICAgICAgIHYzTFNEYXRhID0gSlNPTi5wYXJzZShQZXJzaXN0ZW5jZS5yZXBsYWNlUGlwZXNXaXRoQ29tbWFzKFBlcnNpc3RlbmNlLnJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXModjNMU0RhdGEpKSk7XG4gICAgICAgICAgICAvLyBsb2NhbFN0b3JhZ2UgbWF5IGNvbnRhaW4gb25seSBwcm9kdWN0cywgb3IgdGhlIGZ1bGwgcGVyc2lzdGVuY2VcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlcmUgaXMgYW4gTVBJRCBvbiB0aGUgY29va2llLCBpdCBpcyB0aGUgZnVsbCBwZXJzaXN0ZW5jZVxuICAgICAgICAgICAgaWYgKCh2M0xTRGF0YS5jcCB8fCB2M0xTRGF0YS5wYikgJiYgdjNMU0RhdGEubXBpZCkge1xuICAgICAgICAgICAgICAgIHYzTFNEYXRhID0gSlNPTi5wYXJzZShjb252ZXJ0U0RLdjFDb29raWVzVjNUb1NES3YyQ29va2llc1Y0KHYzTFNEYXRhU3RyaW5nQ29weSkpO1xuICAgICAgICAgICAgICAgIGZpbmlzaExTTWlncmF0aW9uKEpTT04uc3RyaW5naWZ5KHYzTFNEYXRhKSwgdjNMU05hbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIC8vIGlmIG5vIE1QSUQsIGl0IGlzIG9ubHkgdGhlIHByb2R1Y3RzXG4gICAgICAgICAgICB9IGVsc2UgaWYgKCh2M0xTRGF0YS5jcCB8fCB2M0xTRGF0YS5wYikgJiYgIXYzTFNEYXRhLm1waWQpIHtcbiAgICAgICAgICAgICAgICBjb29raWVzID0gUGVyc2lzdGVuY2UuZ2V0Q29va2llKCk7XG4gICAgICAgICAgICAgICAgbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNCh2M0xTRGF0YSwgY29va2llcy5jdSk7XG4gICAgICAgICAgICAgICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWMyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdjFMU0RhdGEgPSBKU09OLnBhcnNlKGRlY29kZVVSSUNvbXBvbmVudCh3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0odjFMU05hbWUpKSk7XG4gICAgICAgICAgICBpZiAodjFMU0RhdGEpIHtcbiAgICAgICAgICAgICAgICBNUC5taWdyYXRpbmdUb0lEU3luY0Nvb2tpZXMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIC8vIFNES3YyXG4gICAgICAgICAgICAgICAgaWYgKHYxTFNEYXRhLmdsb2JhbFNldHRpbmdzIHx8IHYxTFNEYXRhLmN1cnJlbnRVc2VyTVBJRCkge1xuICAgICAgICAgICAgICAgICAgICB2MUxTRGF0YSA9IEpTT04ucGFyc2UoY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQoSlNPTi5zdHJpbmdpZnkodjFMU0RhdGEpKSk7XG4gICAgICAgICAgICAgICAgICAgIC8vIFNES3YxXG4gICAgICAgICAgICAgICAgICAgIC8vIG9ubHkgcHJvZHVjdHMsIG5vdCBmdWxsIHBlcnNpc3RlbmNlXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodjFMU0RhdGEuY3AgfHwgdjFMU0RhdGEucGIpICYmICF2MUxTRGF0YS5tcGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvb2tpZXMgPSBQZXJzaXN0ZW5jZS5nZXRDb29raWUoKTtcbiAgICAgICAgICAgICAgICAgICAgbWlncmF0ZVByb2R1Y3RzRnJvbVNES3YxVG9TREt2MkNvb2tpZXNWNCh2MUxTRGF0YSwgY29va2llcy5jdSk7XG4gICAgICAgICAgICAgICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSh2MUxTTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB2MUxTRGF0YSA9IEpTT04ucGFyc2UoY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNChKU09OLnN0cmluZ2lmeSh2MUxTRGF0YSkpKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoSGVscGVycy5pc09iamVjdCh2MUxTRGF0YSkgJiYgT2JqZWN0LmtleXModjFMU0RhdGEpLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICB2MUxTRGF0YSA9IFBlcnNpc3RlbmNlLmVuY29kZUNvb2tpZXMoSlNPTi5zdHJpbmdpZnkodjFMU0RhdGEpKTtcbiAgICAgICAgICAgICAgICAgICAgZmluaXNoTFNNaWdyYXRpb24odjFMU0RhdGEsIHYxTFNOYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbmlzaExTTWlncmF0aW9uKGRhdGEsIGxzTmFtZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGVuY29kZVVSSUNvbXBvbmVudChDb25maWcuTG9jYWxTdG9yYWdlTmFtZVY0KSwgZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoJ0Vycm9yIHdpdGggc2V0dGluZyBsb2NhbFN0b3JhZ2UgaXRlbS4nKTtcbiAgICAgICAgfVxuICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oZW5jb2RlVVJJQ29tcG9uZW50KGxzTmFtZSkpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFVJRnJvbUFycmF5VG9PYmplY3QoY29va2llKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKGNvb2tpZSAmJiBIZWxwZXJzLmlzT2JqZWN0KGNvb2tpZSkpIHtcbiAgICAgICAgICAgIGZvciAodmFyIG1waWQgaW4gY29va2llKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZS5oYXNPd25Qcm9wZXJ0eShtcGlkKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVbbXBpZF0udWkgJiYgQXJyYXkuaXNBcnJheShjb29raWVbbXBpZF0udWkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdLnVpID0gY29va2llW21waWRdLnVpLnJlZHVjZShmdW5jdGlvbihhY2N1bSwgaWRlbnRpdHkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkZW50aXR5LlR5cGUgJiYgSGVscGVycy5WYWxpZGF0b3JzLmlzU3RyaW5nT3JOdW1iZXIoaWRlbnRpdHkuSWRlbnRpdHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY2N1bVtpZGVudGl0eS5UeXBlXSA9IGlkZW50aXR5LklkZW50aXR5O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2N1bTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCB7fSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29va2llO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdBbiBlcnJvciBvY3VycmVkIHdoZW4gY29udmVydGluZyB0aGUgdXNlciBpZGVudGl0aWVzIGFycmF5IHRvIGFuIG9iamVjdCcsIGUpO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbWlncmF0ZTogbWlncmF0ZSxcbiAgICBjb252ZXJ0VUlGcm9tQXJyYXlUb09iamVjdDogY29udmVydFVJRnJvbUFycmF5VG9PYmplY3QsXG4gICAgY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNDogY29udmVydFNES3YxQ29va2llc1YxVG9TREt2MkNvb2tpZXNWNCxcbiAgICBjb252ZXJ0U0RLdjFDb29raWVzVjJUb1NES3YyQ29va2llc1Y0OiBjb252ZXJ0U0RLdjFDb29raWVzVjJUb1NES3YyQ29va2llc1Y0LFxuICAgIGNvbnZlcnRTREt2MUNvb2tpZXNWM1RvU0RLdjJDb29raWVzVjQ6IGNvbnZlcnRTREt2MUNvb2tpZXNWM1RvU0RLdjJDb29raWVzVjQsXG4gICAgY29udmVydFNES3YyQ29va2llc1YxVG9TREt2MkRlY29kZWRDb29raWVzVjQ6IGNvbnZlcnRTREt2MkNvb2tpZXNWMVRvU0RLdjJEZWNvZGVkQ29va2llc1Y0XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgaXNFbmFibGVkOiB0cnVlLFxuICAgIHNlc3Npb25BdHRyaWJ1dGVzOiB7fSxcbiAgICBjdXJyZW50U2Vzc2lvbk1QSURzOiBbXSxcbiAgICB1c2VyQXR0cmlidXRlczoge30sXG4gICAgdXNlcklkZW50aXRpZXM6IHt9LFxuICAgIGNvbnNlbnRTdGF0ZTogbnVsbCxcbiAgICBmb3J3YXJkZXJDb25zdHJ1Y3RvcnM6IFtdLFxuICAgIGFjdGl2ZUZvcndhcmRlcnM6IFtdLFxuICAgIGNvbmZpZ3VyZWRGb3J3YXJkZXJzOiBbXSxcbiAgICBzZXNzaW9uSWQ6IG51bGwsXG4gICAgaXNGaXJzdFJ1bjogbnVsbCxcbiAgICBjbGllbnRJZDogbnVsbCxcbiAgICBkZXZpY2VJZDogbnVsbCxcbiAgICBtcGlkOiBudWxsLFxuICAgIGRldlRva2VuOiBudWxsLFxuICAgIG1pZ3JhdGlvbkRhdGE6IHt9LFxuICAgIHBpeGVsQ29uZmlndXJhdGlvbnM6IFtdLFxuICAgIHNlcnZlclNldHRpbmdzOiB7fSxcbiAgICBkYXRlTGFzdEV2ZW50U2VudDogbnVsbCxcbiAgICBzZXNzaW9uU3RhcnREYXRlOiBudWxsLFxuICAgIGNvb2tpZVN5bmNEYXRlczoge30sXG4gICAgY3VycmVudFBvc2l0aW9uOiBudWxsLFxuICAgIGlzVHJhY2tpbmc6IGZhbHNlLFxuICAgIHdhdGNoUG9zaXRpb25JZDogbnVsbCxcbiAgICByZWFkeVF1ZXVlOiBbXSxcbiAgICBpc0luaXRpYWxpemVkOiBmYWxzZSxcbiAgICBjYXJ0UHJvZHVjdHM6IFtdLFxuICAgIGV2ZW50UXVldWU6IFtdLFxuICAgIGN1cnJlbmN5Q29kZTogbnVsbCxcbiAgICBhcHBWZXJzaW9uOiBudWxsLFxuICAgIGFwcE5hbWU6IG51bGwsXG4gICAgY3VzdG9tRmxhZ3M6IG51bGwsXG4gICAgZ2xvYmFsVGltZXI6IG51bGwsXG4gICAgY29udGV4dDogJycsXG4gICAgaWRlbnRpdHlDYWxsSW5GbGlnaHQ6IGZhbHNlLFxuICAgIGluaXRpYWxJZGVudGlmeVJlcXVlc3Q6IG51bGwsXG4gICAgQ29uZmlnOiB7fSxcbiAgICBtaWdyYXRpbmdUb0lEU3luY0Nvb2tpZXM6IGZhbHNlLFxuICAgIG5vbkN1cnJlbnRVc2VyTVBJRHM6IHt9LFxuICAgIGlkZW50aWZ5Q2FsbGVkOiBmYWxzZSxcbiAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgYmF0Y2hpbmc6IGZhbHNlXG4gICAgfVxufTtcbiIsInZhciBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBCYXNlNjQgPSByZXF1aXJlKCcuL3BvbHlmaWxsJykuQmFzZTY0LFxuICAgIE1lc3NhZ2VzID0gQ29uc3RhbnRzLk1lc3NhZ2VzLFxuICAgIE1QID0gcmVxdWlyZSgnLi9tcCcpLFxuICAgIEJhc2U2NENvb2tpZUtleXMgPSBDb25zdGFudHMuQmFzZTY0Q29va2llS2V5cyxcbiAgICBTREt2Mk5vbk1QSURDb29raWVLZXlzID0gQ29uc3RhbnRzLlNES3YyTm9uTVBJRENvb2tpZUtleXMsXG4gICAgQ29uc2VudCA9IHJlcXVpcmUoJy4vY29uc2VudCcpO1xuXG5mdW5jdGlvbiB1c2VMb2NhbFN0b3JhZ2UoKSB7XG4gICAgcmV0dXJuICghbVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UgJiYgZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KCkpO1xufVxuXG5mdW5jdGlvbiBpbml0aWFsaXplU3RvcmFnZSgpIHtcbiAgICB2YXIgc3RvcmFnZSxcbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YSA9IHRoaXMuZ2V0TG9jYWxTdG9yYWdlKCksXG4gICAgICAgIGNvb2tpZXMgPSB0aGlzLmdldENvb2tpZSgpLFxuICAgICAgICBhbGxEYXRhO1xuXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHRoZXJlIGlzIGFueSBkYXRhIGluIGNvb2tpZXMgb3IgbG9jYWxTdG9yYWdlIHRvIGZpZ3VyZSBvdXQgaWYgaXQgaXMgdGhlIGZpcnN0IHRpbWUgdGhlIGJyb3dzZXIgaXMgbG9hZGluZyBtUGFydGljbGVcbiAgICBpZiAoIWxvY2FsU3RvcmFnZURhdGEgJiYgIWNvb2tpZXMpIHtcbiAgICAgICAgTVAuaXNGaXJzdFJ1biA9IHRydWU7XG4gICAgICAgIE1QLm1waWQgPSAwO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIE1QLmlzRmlyc3RSdW4gPSBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayB0byBzZWUgaWYgbG9jYWxTdG9yYWdlIGlzIGF2YWlsYWJsZSBhbmQgaWYgbm90LCBhbHdheXMgdXNlIGNvb2tpZXNcbiAgICB0aGlzLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlID0gdGhpcy5kZXRlcm1pbmVMb2NhbFN0b3JhZ2VBdmFpbGFiaWxpdHkoKTtcblxuICAgIGlmICghdGhpcy5pc0xvY2FsU3RvcmFnZUF2YWlsYWJsZSkge1xuICAgICAgICBtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSA9IHRydWU7XG4gICAgfVxuICAgIGlmICh0aGlzLmlzTG9jYWxTdG9yYWdlQXZhaWxhYmxlKSB7XG4gICAgICAgIHN0b3JhZ2UgPSB3aW5kb3cubG9jYWxTdG9yYWdlO1xuICAgICAgICBpZiAobVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UpIHtcbiAgICAgICAgICAgIC8vIEZvciBtaWdyYXRpbmcgZnJvbSBsb2NhbFN0b3JhZ2UgdG8gY29va2llcyAtLSBJZiBhbiBpbnN0YW5jZSBzd2l0Y2hlcyBmcm9tIGxvY2FsU3RvcmFnZSB0byBjb29raWVzLCB0aGVuXG4gICAgICAgICAgICAvLyBubyBtUGFydGljbGUgY29va2llIGV4aXN0cyB5ZXQgYW5kIHRoZXJlIGlzIGxvY2FsU3RvcmFnZS4gR2V0IHRoZSBsb2NhbFN0b3JhZ2UsIHNldCB0aGVtIHRvIGNvb2tpZXMsIHRoZW4gZGVsZXRlIHRoZSBsb2NhbFN0b3JhZ2UgaXRlbS5cbiAgICAgICAgICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCBsb2NhbFN0b3JhZ2VEYXRhLCBjb29raWVzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gbG9jYWxTdG9yYWdlRGF0YTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc3RvcmFnZS5yZW1vdmVJdGVtKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VOYW1lVjQpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgYWxsRGF0YSA9IGNvb2tpZXM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnN0b3JlRGF0YUluTWVtb3J5KGFsbERhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gRm9yIG1pZ3JhdGluZyBmcm9tIGNvb2tpZSB0byBsb2NhbFN0b3JhZ2UgLS0gSWYgYW4gaW5zdGFuY2UgaXMgbmV3bHkgc3dpdGNoaW5nIGZyb20gY29va2llcyB0byBsb2NhbFN0b3JhZ2UsIHRoZW5cbiAgICAgICAgICAgIC8vIG5vIG1QYXJ0aWNsZSBsb2NhbFN0b3JhZ2UgZXhpc3RzIHlldCBhbmQgdGhlcmUgYXJlIGNvb2tpZXMuIEdldCB0aGUgY29va2llcywgc2V0IHRoZW0gdG8gbG9jYWxTdG9yYWdlLCB0aGVuIGRlbGV0ZSB0aGUgY29va2llcy5cbiAgICAgICAgICAgIGlmIChjb29raWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGxvY2FsU3RvcmFnZURhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgYWxsRGF0YSA9IEhlbHBlcnMuZXh0ZW5kKGZhbHNlLCBsb2NhbFN0b3JhZ2VEYXRhLCBjb29raWVzKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhbGxEYXRhID0gY29va2llcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5zdG9yZURhdGFJbk1lbW9yeShhbGxEYXRhKTtcbiAgICAgICAgICAgICAgICB0aGlzLmV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkobG9jYWxTdG9yYWdlRGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnN0b3JlRGF0YUluTWVtb3J5KGNvb2tpZXMpO1xuICAgIH1cblxuICAgIHZhciBlbmNvZGVkUHJvZHVjdHMgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShNUC5Db25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCk7XG5cbiAgICBpZiAoZW5jb2RlZFByb2R1Y3RzKSB7XG4gICAgICAgIHZhciBkZWNvZGVkUHJvZHVjdHMgPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUoZW5jb2RlZFByb2R1Y3RzKSk7XG4gICAgfVxuXG4gICAgaWYgKE1QLm1waWQpIHtcbiAgICAgICAgc3RvcmVQcm9kdWN0c0luTWVtb3J5KGRlY29kZWRQcm9kdWN0cywgTVAubXBpZCk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIga2V5IGluIGFsbERhdGEpIHtcbiAgICAgICAgaWYgKGFsbERhdGEuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICBNUC5ub25DdXJyZW50VXNlck1QSURzW2tleV0gPSBhbGxEYXRhW2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnVwZGF0ZSgpO1xufVxuXG5mdW5jdGlvbiB1cGRhdGUoKSB7XG4gICAgaWYgKCFIZWxwZXJzLnNob3VsZFVzZU5hdGl2ZVNkaygpKSB7XG4gICAgICAgIGlmIChtUGFydGljbGUudXNlQ29va2llU3RvcmFnZSkge1xuICAgICAgICAgICAgdGhpcy5zZXRDb29raWUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdG9yZVByb2R1Y3RzSW5NZW1vcnkocHJvZHVjdHMsIG1waWQpIHtcbiAgICB0cnkge1xuICAgICAgICBNUC5jYXJ0UHJvZHVjdHMgPSBwcm9kdWN0c1ttcGlkXSAmJiBwcm9kdWN0c1ttcGlkXS5jcCA/IHByb2R1Y3RzW21waWRdLmNwIDogW107XG4gICAgfVxuICAgIGNhdGNoKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkNvb2tpZVBhcnNlRXJyb3IpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc3RvcmVEYXRhSW5NZW1vcnkob2JqLCBjdXJyZW50TVBJRCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICghb2JqKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llTm90Rm91bmQpO1xuICAgICAgICAgICAgTVAuY2xpZW50SWQgPSBNUC5jbGllbnRJZCB8fCBIZWxwZXJzLmdlbmVyYXRlVW5pcXVlSWQoKTtcbiAgICAgICAgICAgIE1QLmRldmljZUlkID0gTVAuZGV2aWNlSWQgfHwgSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgICAgICAgICBNUC51c2VyQXR0cmlidXRlcyA9IHt9O1xuICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSB7fTtcbiAgICAgICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlcyA9IHt9O1xuICAgICAgICAgICAgTVAuY29uc2VudFN0YXRlID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFNldCBNUElEIGZpcnN0LCB0aGVuIGNoYW5nZSBvYmplY3QgdG8gbWF0Y2ggTVBJRCBkYXRhXG4gICAgICAgICAgICBpZiAoY3VycmVudE1QSUQpIHtcbiAgICAgICAgICAgICAgICBNUC5tcGlkID0gY3VycmVudE1QSUQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIE1QLm1waWQgPSBvYmouY3UgfHwgMDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb2JqLmdzID0gb2JqLmdzIHx8IHt9O1xuXG4gICAgICAgICAgICBNUC5zZXNzaW9uSWQgPSBvYmouZ3Muc2lkIHx8IE1QLnNlc3Npb25JZDtcbiAgICAgICAgICAgIE1QLmlzRW5hYmxlZCA9ICh0eXBlb2Ygb2JqLmdzLmllICE9PSAndW5kZWZpbmVkJykgPyBvYmouZ3MuaWUgOiBNUC5pc0VuYWJsZWQ7XG4gICAgICAgICAgICBNUC5zZXNzaW9uQXR0cmlidXRlcyA9IG9iai5ncy5zYSB8fCBNUC5zZXNzaW9uQXR0cmlidXRlcztcbiAgICAgICAgICAgIE1QLnNlcnZlclNldHRpbmdzID0gb2JqLmdzLnNzIHx8IE1QLnNlcnZlclNldHRpbmdzO1xuICAgICAgICAgICAgTVAuZGV2VG9rZW4gPSBNUC5kZXZUb2tlbiB8fCBvYmouZ3MuZHQ7XG4gICAgICAgICAgICBNUC5hcHBWZXJzaW9uID0gTVAuYXBwVmVyc2lvbiB8fCBvYmouZ3MuYXY7XG4gICAgICAgICAgICBNUC5jbGllbnRJZCA9IG9iai5ncy5jZ2lkIHx8IE1QLmNsaWVudElkIHx8IEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgICAgICAgICAgTVAuZGV2aWNlSWQgPSBvYmouZ3MuZGFzIHx8IE1QLmRldmljZUlkIHx8IEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgICAgICAgICAgTVAuY29udGV4dCA9IG9iai5ncy5jIHx8IE1QLmNvbnRleHQ7XG4gICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzID0gb2JqLmdzLmNzbSB8fCBNUC5jdXJyZW50U2Vzc2lvbk1QSURzO1xuXG4gICAgICAgICAgICBpZiAob2JqLmdzLmxlcykge1xuICAgICAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbmV3IERhdGUob2JqLmdzLmxlcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChvYmouZ3Muc3NkKSB7XG4gICAgICAgICAgICAgICAgTVAuc2Vzc2lvblN0YXJ0RGF0ZSA9IG5ldyBEYXRlKG9iai5ncy5zc2QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGN1cnJlbnRNUElEKSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW2N1cnJlbnRNUElEXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb2JqID0gb2JqW29iai5jdV07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE1QLnVzZXJBdHRyaWJ1dGVzID0gb2JqLnVhIHx8IE1QLnVzZXJBdHRyaWJ1dGVzO1xuICAgICAgICAgICAgTVAudXNlcklkZW50aXRpZXMgPSBvYmoudWkgfHwgTVAudXNlcklkZW50aXRpZXM7XG4gICAgICAgICAgICBNUC5jb25zZW50U3RhdGUgPSBvYmouY29uID8gQ29uc2VudC5TZXJpYWxpemF0aW9uLmZyb21NaW5pZmllZEpzb25PYmplY3Qob2JqLmNvbikgOiBudWxsO1xuXG4gICAgICAgICAgICBpZiAob2JqLmNzZCkge1xuICAgICAgICAgICAgICAgIE1QLmNvb2tpZVN5bmNEYXRlcyA9IG9iai5jc2Q7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5FcnJvck1lc3NhZ2VzLkNvb2tpZVBhcnNlRXJyb3IpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5KCkge1xuICAgIHZhciBzdG9yYWdlLCByZXN1bHQ7XG5cbiAgICB0cnkge1xuICAgICAgICAoc3RvcmFnZSA9IHdpbmRvdy5sb2NhbFN0b3JhZ2UpLnNldEl0ZW0oJ21wYXJ0aWNsZScsICd0ZXN0Jyk7XG4gICAgICAgIHJlc3VsdCA9IHN0b3JhZ2UuZ2V0SXRlbSgnbXBhcnRpY2xlJykgPT09ICd0ZXN0JztcbiAgICAgICAgc3RvcmFnZS5yZW1vdmVJdGVtKCdtcGFydGljbGUnKTtcblxuICAgICAgICBpZiAocmVzdWx0ICYmIHN0b3JhZ2UpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRJbk1lbW9yeURhdGFGb3JDb29raWVzKCkge1xuICAgIHZhciBtcGlkRGF0YSA9IHtcbiAgICAgICAgdWE6IE1QLnVzZXJBdHRyaWJ1dGVzLFxuICAgICAgICB1aTogTVAudXNlcklkZW50aXRpZXMsXG4gICAgICAgIGNzZDogTVAuY29va2llU3luY0RhdGVzLFxuICAgICAgICBjb246IE1QLmNvbnNlbnRTdGF0ZSA/IENvbnNlbnQuU2VyaWFsaXphdGlvbi50b01pbmlmaWVkSnNvbk9iamVjdChNUC5jb25zZW50U3RhdGUpIDogbnVsbFxuICAgIH07XG5cbiAgICByZXR1cm4gbXBpZERhdGE7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQcm9kdWN0c0ZvckxvY2FsU3RvcmFnZSgpIHtcbiAgICB2YXIgaW5NZW1vcnlEYXRhRm9yTG9jYWxTdG9yYWdlID0ge1xuICAgICAgICBjcDogTVAuY2FydFByb2R1Y3RzID8gTVAuY2FydFByb2R1Y3RzLmxlbmd0aCA8PSBtUGFydGljbGUubWF4UHJvZHVjdHMgPyBNUC5jYXJ0UHJvZHVjdHMgOiBNUC5jYXJ0UHJvZHVjdHMuc2xpY2UoMCwgbVBhcnRpY2xlLm1heFByb2R1Y3RzKSA6IFtdXG4gICAgfTtcblxuICAgIHJldHVybiBpbk1lbW9yeURhdGFGb3JMb2NhbFN0b3JhZ2U7XG59XG5cbmZ1bmN0aW9uIGdldExvY2FsU3RvcmFnZVByb2R1Y3RzKCkge1xuICAgIHZhciBwcm9kdWN0cyA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KTtcbiAgICBpZiAocHJvZHVjdHMpIHtcbiAgICAgICAgcmV0dXJuIEJhc2U2NC5kZWNvZGUocHJvZHVjdHMpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvZHVjdHM7XG59XG5cbmZ1bmN0aW9uIHNldExvY2FsU3RvcmFnZSgpIHtcbiAgICB2YXIga2V5ID0gTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWNCxcbiAgICAgICAgbG9jYWxTdG9yYWdlUHJvZHVjdHMgPSBnZXRMb2NhbFN0b3JhZ2VQcm9kdWN0cygpLFxuICAgICAgICBjdXJyZW50VXNlclByb2R1Y3RzID0gdGhpcy5jb252ZXJ0UHJvZHVjdHNGb3JMb2NhbFN0b3JhZ2UoKSxcbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YSA9IHRoaXMuZ2V0TG9jYWxTdG9yYWdlKCkgfHwge30sXG4gICAgICAgIGN1cnJlbnRNUElERGF0YTtcblxuICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgIGxvY2FsU3RvcmFnZVByb2R1Y3RzID0gbG9jYWxTdG9yYWdlUHJvZHVjdHMgPyBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZVByb2R1Y3RzKSA6IHt9O1xuICAgICAgICBsb2NhbFN0b3JhZ2VQcm9kdWN0c1tNUC5tcGlkXSA9IGN1cnJlbnRVc2VyUHJvZHVjdHM7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oZW5jb2RlVVJJQ29tcG9uZW50KE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KSwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VQcm9kdWN0cykpKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igd2l0aCBzZXR0aW5nIHByb2R1Y3RzIG9uIGxvY2FsU3RvcmFnZS4nKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmICghbVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UpIHtcbiAgICAgICAgY3VycmVudE1QSUREYXRhID0gdGhpcy5jb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llcygpO1xuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmdzID0gbG9jYWxTdG9yYWdlRGF0YS5ncyB8fCB7fTtcblxuICAgICAgICBpZiAoTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmdzLmNzbSA9IE1QLmN1cnJlbnRTZXNzaW9uTVBJRHM7XG4gICAgICAgIH1cblxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhLmdzLmllID0gTVAuaXNFbmFibGVkO1xuXG4gICAgICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhW01QLm1waWRdID0gY3VycmVudE1QSUREYXRhO1xuICAgICAgICAgICAgbG9jYWxTdG9yYWdlRGF0YS5jdSA9IE1QLm1waWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoT2JqZWN0LmtleXMoTVAubm9uQ3VycmVudFVzZXJNUElEcykubGVuZ3RoKSB7XG4gICAgICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gSGVscGVycy5leHRlbmQoe30sIGxvY2FsU3RvcmFnZURhdGEsIE1QLm5vbkN1cnJlbnRVc2VyTVBJRHMpO1xuICAgICAgICAgICAgTVAubm9uQ3VycmVudFVzZXJNUElEcyA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgbG9jYWxTdG9yYWdlRGF0YSA9IHRoaXMuc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXMobG9jYWxTdG9yYWdlRGF0YSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbShlbmNvZGVVUklDb21wb25lbnQoa2V5KSwgZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeShsb2NhbFN0b3JhZ2VEYXRhKSkpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdFcnJvciB3aXRoIHNldHRpbmcgbG9jYWxTdG9yYWdlIGl0ZW0uJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldEdsb2JhbFN0b3JhZ2VBdHRyaWJ1dGVzKGRhdGEpIHtcbiAgICBkYXRhLmdzLnNpZCA9IE1QLnNlc3Npb25JZDtcbiAgICBkYXRhLmdzLmllID0gTVAuaXNFbmFibGVkO1xuICAgIGRhdGEuZ3Muc2EgPSBNUC5zZXNzaW9uQXR0cmlidXRlcztcbiAgICBkYXRhLmdzLnNzID0gTVAuc2VydmVyU2V0dGluZ3M7XG4gICAgZGF0YS5ncy5kdCA9IE1QLmRldlRva2VuO1xuICAgIGRhdGEuZ3MubGVzID0gTVAuZGF0ZUxhc3RFdmVudFNlbnQgPyBNUC5kYXRlTGFzdEV2ZW50U2VudC5nZXRUaW1lKCkgOiBudWxsO1xuICAgIGRhdGEuZ3MuYXYgPSBNUC5hcHBWZXJzaW9uO1xuICAgIGRhdGEuZ3MuY2dpZCA9IE1QLmNsaWVudElkO1xuICAgIGRhdGEuZ3MuZGFzID0gTVAuZGV2aWNlSWQ7XG4gICAgZGF0YS5ncy5jID0gTVAuY29udGV4dDtcbiAgICBkYXRhLmdzLnNzZCA9IE1QLnNlc3Npb25TdGFydERhdGUgPyBNUC5zZXNzaW9uU3RhcnREYXRlLmdldFRpbWUoKSA6IG51bGw7XG5cbiAgICByZXR1cm4gZGF0YTtcbn1cblxuZnVuY3Rpb24gZ2V0TG9jYWxTdG9yYWdlKCkge1xuICAgIHZhciBrZXkgPSBNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZVY0LFxuICAgICAgICBsb2NhbFN0b3JhZ2VEYXRhID0gZGVjb2RlQ29va2llcyh3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0oa2V5KSksXG4gICAgICAgIG9iaiA9IHt9LFxuICAgICAgICBqO1xuICAgIGlmIChsb2NhbFN0b3JhZ2VEYXRhKSB7XG4gICAgICAgIGxvY2FsU3RvcmFnZURhdGEgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZURhdGEpO1xuICAgICAgICBmb3IgKGogaW4gbG9jYWxTdG9yYWdlRGF0YSkge1xuICAgICAgICAgICAgaWYgKGxvY2FsU3RvcmFnZURhdGEuaGFzT3duUHJvcGVydHkoaikpIHtcbiAgICAgICAgICAgICAgICBvYmpbal0gPSBsb2NhbFN0b3JhZ2VEYXRhW2pdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKG9iaikubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUxvY2FsU3RvcmFnZShsb2NhbFN0b3JhZ2VOYW1lKSB7XG4gICAgbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0obG9jYWxTdG9yYWdlTmFtZSk7XG59XG5cbmZ1bmN0aW9uIHJldHJpZXZlRGV2aWNlSWQoKSB7XG4gICAgaWYgKE1QLmRldmljZUlkKSB7XG4gICAgICAgIHJldHVybiBNUC5kZXZpY2VJZDtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdGhpcy5wYXJzZURldmljZUlkKE1QLnNlcnZlclNldHRpbmdzKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRGV2aWNlSWQoc2VydmVyU2V0dGluZ3MpIHtcbiAgICB0cnkge1xuICAgICAgICB2YXIgcGFyYW1zT2JqID0ge30sXG4gICAgICAgICAgICBwYXJ0cztcblxuICAgICAgICBpZiAoc2VydmVyU2V0dGluZ3MgJiYgc2VydmVyU2V0dGluZ3MudWlkICYmIHNlcnZlclNldHRpbmdzLnVpZC5WYWx1ZSkge1xuICAgICAgICAgICAgc2VydmVyU2V0dGluZ3MudWlkLlZhbHVlLnNwbGl0KCcmJykuZm9yRWFjaChmdW5jdGlvbihwYXJhbSkge1xuICAgICAgICAgICAgICAgIHBhcnRzID0gcGFyYW0uc3BsaXQoJz0nKTtcbiAgICAgICAgICAgICAgICBwYXJhbXNPYmpbcGFydHNbMF1dID0gcGFydHNbMV07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKHBhcmFtc09ialsnZyddKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcmFtc09ialsnZyddO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIEhlbHBlcnMuZ2VuZXJhdGVVbmlxdWVJZCgpO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICByZXR1cm4gSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBleHBpcmVDb29raWVzKGNvb2tpZU5hbWUpIHtcbiAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKCksXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICAgIGRvbWFpbixcbiAgICAgICAgY29va2llRG9tYWluO1xuXG4gICAgY29va2llRG9tYWluID0gZ2V0Q29va2llRG9tYWluKCk7XG5cbiAgICBpZiAoY29va2llRG9tYWluID09PSAnJykge1xuICAgICAgICBkb21haW4gPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgICBkb21haW4gPSAnO2RvbWFpbj0nICsgY29va2llRG9tYWluO1xuICAgIH1cblxuICAgIGRhdGUuc2V0VGltZShkYXRlLmdldFRpbWUoKSAtICgyNCAqIDYwICogNjAgKiAxMDAwKSk7XG4gICAgZXhwaXJlcyA9ICc7IGV4cGlyZXM9JyArIGRhdGUudG9VVENTdHJpbmcoKTtcbiAgICBkb2N1bWVudC5jb29raWUgPSBjb29raWVOYW1lICsgJz0nICsgJycgKyBleHBpcmVzICsgJzsgcGF0aD0vJyArIGRvbWFpbjtcbn1cblxuZnVuY3Rpb24gZ2V0Q29va2llKCkge1xuICAgIHZhciBjb29raWVzID0gd2luZG93LmRvY3VtZW50LmNvb2tpZS5zcGxpdCgnOyAnKSxcbiAgICAgICAga2V5ID0gTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCxcbiAgICAgICAgaSxcbiAgICAgICAgbCxcbiAgICAgICAgcGFydHMsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvb2tpZSxcbiAgICAgICAgcmVzdWx0ID0ga2V5ID8gdW5kZWZpbmVkIDoge307XG5cbiAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llU2VhcmNoKTtcblxuICAgIGZvciAoaSA9IDAsIGwgPSBjb29raWVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcbiAgICAgICAgbmFtZSA9IEhlbHBlcnMuZGVjb2RlZChwYXJ0cy5zaGlmdCgpKTtcbiAgICAgICAgY29va2llID0gSGVscGVycy5kZWNvZGVkKHBhcnRzLmpvaW4oJz0nKSk7XG5cbiAgICAgICAgaWYgKGtleSAmJiBrZXkgPT09IG5hbWUpIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IEhlbHBlcnMuY29udmVydGVkKGNvb2tpZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICgha2V5KSB7XG4gICAgICAgICAgICByZXN1bHRbbmFtZV0gPSBIZWxwZXJzLmNvbnZlcnRlZChjb29raWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQ29va2llRm91bmQpO1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShkZWNvZGVDb29raWVzKHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0Q29va2llKCkge1xuICAgIHZhciBkYXRlID0gbmV3IERhdGUoKSxcbiAgICAgICAga2V5ID0gTVAuQ29uZmlnLkNvb2tpZU5hbWVWNCxcbiAgICAgICAgY3VycmVudE1QSUREYXRhID0gdGhpcy5jb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llcygpLFxuICAgICAgICBleHBpcmVzID0gbmV3IERhdGUoZGF0ZS5nZXRUaW1lKCkgK1xuICAgICAgICAgICAgKE1QLkNvbmZpZy5Db29raWVFeHBpcmF0aW9uICogMjQgKiA2MCAqIDYwICogMTAwMCkpLnRvR01UU3RyaW5nKCksXG4gICAgICAgIGNvb2tpZURvbWFpbixcbiAgICAgICAgZG9tYWluLFxuICAgICAgICBjb29raWVzID0gdGhpcy5nZXRDb29raWUoKSB8fCB7fSxcbiAgICAgICAgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG5cbiAgICBjb29raWVEb21haW4gPSBnZXRDb29raWVEb21haW4oKTtcblxuICAgIGlmIChjb29raWVEb21haW4gPT09ICcnKSB7XG4gICAgICAgIGRvbWFpbiA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGRvbWFpbiA9ICc7ZG9tYWluPScgKyBjb29raWVEb21haW47XG4gICAgfVxuXG4gICAgY29va2llcy5ncyA9IGNvb2tpZXMuZ3MgfHwge307XG5cbiAgICBpZiAoTVAuc2Vzc2lvbklkKSB7XG4gICAgICAgIGNvb2tpZXMuZ3MuY3NtID0gTVAuY3VycmVudFNlc3Npb25NUElEcztcbiAgICB9XG5cbiAgICBpZiAoTVAubXBpZCkge1xuICAgICAgICBjb29raWVzW01QLm1waWRdID0gY3VycmVudE1QSUREYXRhO1xuICAgICAgICBjb29raWVzLmN1ID0gTVAubXBpZDtcbiAgICB9XG5cbiAgICBjb29raWVzID0gdGhpcy5zZXRHbG9iYWxTdG9yYWdlQXR0cmlidXRlcyhjb29raWVzKTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhNUC5ub25DdXJyZW50VXNlck1QSURzKS5sZW5ndGgpIHtcbiAgICAgICAgY29va2llcyA9IEhlbHBlcnMuZXh0ZW5kKHt9LCBjb29raWVzLCBNUC5ub25DdXJyZW50VXNlck1QSURzKTtcbiAgICAgICAgTVAubm9uQ3VycmVudFVzZXJNUElEcyA9IHt9O1xuICAgIH1cblxuICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gcmVkdWNlQW5kRW5jb2RlQ29va2llcyhjb29raWVzLCBleHBpcmVzLCBkb21haW4pO1xuXG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkNvb2tpZVNldCk7XG5cbiAgICB3aW5kb3cuZG9jdW1lbnQuY29va2llID1cbiAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgKyAnPScgKyBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aDtcbn1cblxuLyogIFRoaXMgZnVuY3Rpb24gZGV0ZXJtaW5lcyBpZiBhIGNvb2tpZSBpcyBncmVhdGVyIHRoYW4gdGhlIGNvbmZpZ3VyZWQgbWF4Q29va2llU2l6ZS5cbiAgICAgICAgLSBJZiBpdCBpcywgd2UgcmVtb3ZlIGFuIE1QSUQgYW5kIGl0cyBhc3NvY2lhdGVkIFVJL1VBL0NTRCBmcm9tIHRoZSBjb29raWUuXG4gICAgICAgIC0gT25jZSByZW1vdmVkLCBjaGVjayBzaXplLCBhbmQgcmVwZWF0LlxuICAgICAgICAtIE5ldmVyIHJlbW92ZSB0aGUgY3VycmVudFVzZXIncyBNUElEIGZyb20gdGhlIGNvb2tpZS5cblxuICAgIE1QSUQgcmVtb3ZhbCBwcmlvcml0eTpcbiAgICAxLiBJZiB0aGVyZSBhcmUgbm8gY3VycmVudFNlc3Npb25NUElEcywgcmVtb3ZlIGEgcmFuZG9tIE1QSUQgZnJvbSB0aGUgdGhlIGNvb2tpZS5cbiAgICAyLiBJZiB0aGVyZSBhcmUgY3VycmVudFNlc3Npb25NUElEczpcbiAgICAgICAgYS4gUmVtb3ZlIGF0IHJhbmRvbSBNUElEcyBvbiB0aGUgY29va2llIHRoYXQgYXJlIG5vdCBwYXJ0IG9mIHRoZSBjdXJyZW50U2Vzc2lvbk1QSURzXG4gICAgICAgIGIuIFRoZW4gcmVtb3ZlIE1QSURzIGJhc2VkIG9uIG9yZGVyIGluIGN1cnJlbnRTZXNzaW9uTVBJRHMgYXJyYXksIHdoaWNoXG4gICAgICAgIHN0b3JlcyBNUElEcyBiYXNlZCBvbiBlYXJsaWVzdCBsb2dpbi5cbiovXG5mdW5jdGlvbiByZWR1Y2VBbmRFbmNvZGVDb29raWVzKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbikge1xuICAgIHZhciBlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aCxcbiAgICAgICAgY3VycmVudFNlc3Npb25NUElEcyA9IGNvb2tpZXMuZ3MuY3NtID8gY29va2llcy5ncy5jc20gOiBbXTtcbiAgICAvLyBDb21tZW50IDEgYWJvdmVcbiAgICBpZiAoIWN1cnJlbnRTZXNzaW9uTVBJRHMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBjb29raWVzKSB7XG4gICAgICAgICAgICBpZiAoY29va2llcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGggPSBjcmVhdGVGdWxsRW5jb2RlZENvb2tpZShjb29raWVzLCBleHBpcmVzLCBkb21haW4pO1xuICAgICAgICAgICAgICAgIGlmIChlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aC5sZW5ndGggPiBtUGFydGljbGUubWF4Q29va2llU2l6ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNba2V5XSAmJiBrZXkgIT09IGNvb2tpZXMuY3UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWVzW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDb21tZW50IDIgYWJvdmUgLSBGaXJzdCBjcmVhdGUgYW4gb2JqZWN0IG9mIGFsbCBNUElEcyBvbiB0aGUgY29va2llXG4gICAgICAgIHZhciBNUElEc09uQ29va2llID0ge307XG4gICAgICAgIGZvciAodmFyIHBvdGVudGlhbE1QSUQgaW4gY29va2llcykge1xuICAgICAgICAgICAgaWYgKGNvb2tpZXMuaGFzT3duUHJvcGVydHkocG90ZW50aWFsTVBJRCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbcG90ZW50aWFsTVBJRF0gJiYgcG90ZW50aWFsTVBJRCAhPT1jb29raWVzLmN1KSB7XG4gICAgICAgICAgICAgICAgICAgIE1QSURzT25Db29raWVbcG90ZW50aWFsTVBJRF0gPSAxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBDb21tZW50IDJhIGFib3ZlXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhNUElEc09uQ29va2llKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAodmFyIG1waWQgaW4gTVBJRHNPbkNvb2tpZSkge1xuICAgICAgICAgICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gY3JlYXRlRnVsbEVuY29kZWRDb29raWUoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcbiAgICAgICAgICAgICAgICBpZiAoZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGgubGVuZ3RoID4gbVBhcnRpY2xlLm1heENvb2tpZVNpemUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKE1QSURzT25Db29raWUuaGFzT3duUHJvcGVydHkobXBpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50U2Vzc2lvbk1QSURzLmluZGV4T2YobXBpZCkgPT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZXNbbXBpZF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ29tbWVudCAyYiBhYm92ZVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGN1cnJlbnRTZXNzaW9uTVBJRHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gY3JlYXRlRnVsbEVuY29kZWRDb29raWUoY29va2llcywgZXhwaXJlcywgZG9tYWluKTtcbiAgICAgICAgICAgIGlmIChlbmNvZGVkQ29va2llc1dpdGhFeHBpcmF0aW9uQW5kUGF0aC5sZW5ndGggPiBtUGFydGljbGUubWF4Q29va2llU2l6ZSkge1xuICAgICAgICAgICAgICAgIHZhciBNUElEdG9SZW1vdmUgPSBjdXJyZW50U2Vzc2lvbk1QSURzW2ldO1xuICAgICAgICAgICAgICAgIGlmIChjb29raWVzW01QSUR0b1JlbW92ZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnU2l6ZSBvZiBuZXcgZW5jb2RlZCBjb29raWUgaXMgbGFyZ2VyIHRoYW4gbWF4Q29va2llU2l6ZSBzZXR0aW5nIG9mICcgKyBtUGFydGljbGUubWF4Q29va2llU2l6ZSArICcuIFJlbW92aW5nIGZyb20gY29va2llIHRoZSBlYXJsaWVzdCBsb2dnZWQgaW4gTVBJRCBjb250YWluaW5nOiAnICsgSlNPTi5zdHJpbmdpZnkoY29va2llc1tNUElEdG9SZW1vdmVdLCAwLCAyKSk7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBjb29raWVzW01QSUR0b1JlbW92ZV07XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnVW5hYmxlIHRvIHNhdmUgTVBJRCBkYXRhIHRvIGNvb2tpZXMgYmVjYXVzZSB0aGUgcmVzdWx0aW5nIGVuY29kZWQgY29va2llIGlzIGxhcmdlciB0aGFuIHRoZSBtYXhDb29raWVTaXplIHNldHRpbmcgb2YgJyArIG1QYXJ0aWNsZS5tYXhDb29raWVTaXplICsgJy4gV2UgcmVjb21tZW5kIHVzaW5nIGEgbWF4Q29va2llU2l6ZSBvZiAxNTAwLicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUZ1bGxFbmNvZGVkQ29va2llKGNvb2tpZXMsIGV4cGlyZXMsIGRvbWFpbikge1xuICAgIHJldHVybiBlbmNvZGVDb29raWVzKEpTT04uc3RyaW5naWZ5KGNvb2tpZXMpKSArICc7ZXhwaXJlcz0nICsgZXhwaXJlcyArJztwYXRoPS8nICsgZG9tYWluO1xufVxuXG5mdW5jdGlvbiBmaW5kUHJldkNvb2tpZXNCYXNlZE9uVUkoaWRlbnRpdHlBcGlEYXRhKSB7XG4gICAgdmFyIGNvb2tpZXMgPSB0aGlzLmdldENvb2tpZSgpIHx8IHRoaXMuZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgdmFyIG1hdGNoZWRVc2VyO1xuXG4gICAgaWYgKGlkZW50aXR5QXBpRGF0YSkge1xuICAgICAgICBmb3IgKHZhciByZXF1ZXN0ZWRJZGVudGl0eVR5cGUgaW4gaWRlbnRpdHlBcGlEYXRhLnVzZXJJZGVudGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoY29va2llcykubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGNvb2tpZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gYW55IHZhbHVlIGluIGNvb2tpZXMgdGhhdCBoYXMgYW4gTVBJRCBrZXkgd2lsbCBiZSBhbiBNUElEIHRvIHNlYXJjaCB0aHJvdWdoXG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyIGtleXMgb24gdGhlIGNvb2tpZSBhcmUgY3VycmVudFNlc3Npb25NUElEcyBhbmQgY3VycmVudE1QSUQgd2hpY2ggc2hvdWxkIG5vdCBiZSBzZWFyY2hlZFxuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llc1trZXldLm1waWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBjb29raWVVSXMgPSBjb29raWVzW2tleV0udWk7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBjb29raWVVSVR5cGUgaW4gY29va2llVUlzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RlZElkZW50aXR5VHlwZSA9PT0gY29va2llVUlUeXBlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICYmIGlkZW50aXR5QXBpRGF0YS51c2VySWRlbnRpdGllc1tyZXF1ZXN0ZWRJZGVudGl0eVR5cGVdID09PSBjb29raWVVSXNbY29va2llVUlUeXBlXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVkVXNlciA9IGtleTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1hdGNoZWRVc2VyKSB7XG4gICAgICAgIHRoaXMuc3RvcmVEYXRhSW5NZW1vcnkoY29va2llcywgbWF0Y2hlZFVzZXIpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW5jb2RlQ29va2llcyhjb29raWUpIHtcbiAgICBjb29raWUgPSBKU09OLnBhcnNlKGNvb2tpZSk7XG4gICAgZm9yICh2YXIga2V5IGluIGNvb2tpZS5ncykge1xuICAgICAgICBpZiAoY29va2llLmdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIC8vIGJhc2U2NCBlbmNvZGUgYW55IHZhbHVlIHRoYXQgaXMgYW4gb2JqZWN0IG9yIEFycmF5IGluIGdsb2JhbFNldHRpbmdzIGZpcnN0XG4gICAgICAgICAgICBpZiAoQmFzZTY0Q29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvb2tpZS5nc1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvb2tpZS5nc1trZXldKSAmJiBjb29raWUuZ3Nba2V5XS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKEhlbHBlcnMuaXNPYmplY3QoY29va2llLmdzW2tleV0pICYmIE9iamVjdC5rZXlzKGNvb2tpZS5nc1trZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvb2tpZS5nc1trZXldID0gQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZS5nc1trZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZS5nc1trZXldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSAnaWUnKSB7XG4gICAgICAgICAgICAgICAgY29va2llLmdzW2tleV0gPSBjb29raWUuZ3Nba2V5XSA/IDEgOiAwO1xuICAgICAgICAgICAgfSBlbHNlIGlmICghY29va2llLmdzW2tleV0pIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgY29va2llLmdzW2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKHZhciBtcGlkIGluIGNvb2tpZSkge1xuICAgICAgICBpZiAoY29va2llLmhhc093blByb3BlcnR5KG1waWQpKSB7XG4gICAgICAgICAgICBpZiAoIVNES3YyTm9uTVBJRENvb2tpZUtleXNbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGtleSBpbiBjb29raWVbbXBpZF0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZVttcGlkXS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoQmFzZTY0Q29va2llS2V5c1trZXldKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEhlbHBlcnMuaXNPYmplY3QoY29va2llW21waWRdW2tleV0pICYmIE9iamVjdC5rZXlzKGNvb2tpZVttcGlkXVtrZXldKS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdW2tleV0gPSBCYXNlNjQuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGNvb2tpZVttcGlkXVtrZXldKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGNvb2tpZVttcGlkXVtrZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVDb29raWVTdHJpbmcoSlNPTi5zdHJpbmdpZnkoY29va2llKSk7XG59XG5cbmZ1bmN0aW9uIGRlY29kZUNvb2tpZXMoY29va2llKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKGNvb2tpZSkge1xuICAgICAgICAgICAgY29va2llID0gSlNPTi5wYXJzZShyZXZlcnRDb29raWVTdHJpbmcoY29va2llKSk7XG4gICAgICAgICAgICBpZiAoSGVscGVycy5pc09iamVjdChjb29raWUpICYmIE9iamVjdC5rZXlzKGNvb2tpZSkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIga2V5IGluIGNvb2tpZS5ncykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29va2llLmdzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChCYXNlNjRDb29raWVLZXlzW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWUuZ3Nba2V5XSA9IEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZShjb29raWUuZ3Nba2V5XSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09ICdpZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb29raWUuZ3Nba2V5XSA9IEJvb2xlYW4oY29va2llLmdzW2tleV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgbXBpZCBpbiBjb29raWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvb2tpZS5oYXNPd25Qcm9wZXJ0eShtcGlkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFTREt2Mk5vbk1QSURDb29raWVLZXlzW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChrZXkgaW4gY29va2llW21waWRdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVbbXBpZF0uaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEJhc2U2NENvb2tpZUtleXNba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb29raWVbbXBpZF1ba2V5XS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29va2llW21waWRdW2tleV0gPSBKU09OLnBhcnNlKEJhc2U2NC5kZWNvZGUoY29va2llW21waWRdW2tleV0pKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb29raWUpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKCdQcm9ibGVtIHdpdGggZGVjb2RpbmcgY29va2llJywgZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZXBsYWNlQ29tbWFzV2l0aFBpcGVzKHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvLC9nLCAnfCcpO1xufVxuXG5mdW5jdGlvbiByZXBsYWNlUGlwZXNXaXRoQ29tbWFzKHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvXFx8L2csICcsJyk7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VBcG9zdHJvcGhlc1dpdGhRdW90ZXMoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC9cXCcvZywgJ1wiJyk7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXMoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC9cXFwiL2csICdcXCcnKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29va2llU3RyaW5nKHN0cmluZykge1xuICAgIHJldHVybiByZXBsYWNlQ29tbWFzV2l0aFBpcGVzKHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXMoc3RyaW5nKSk7XG59XG5cbmZ1bmN0aW9uIHJldmVydENvb2tpZVN0cmluZyhzdHJpbmcpIHtcbiAgICByZXR1cm4gcmVwbGFjZVBpcGVzV2l0aENvbW1hcyhyZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzKHN0cmluZykpO1xufVxuXG5mdW5jdGlvbiBnZXRDb29raWVEb21haW4oKSB7XG4gICAgaWYgKE1QLkNvbmZpZy5Db29raWVEb21haW4pIHtcbiAgICAgICAgcmV0dXJuIE1QLkNvbmZpZy5Db29raWVEb21haW47XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHJvb3REb21haW4gPSBnZXREb21haW4oZG9jdW1lbnQsIGxvY2F0aW9uLmhvc3RuYW1lKTtcbiAgICAgICAgaWYgKHJvb3REb21haW4gPT09ICcnKSB7XG4gICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gJy4nICsgcm9vdERvbWFpbjtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gVGhpcyBmdW5jdGlvbiBsb29wcyB0aHJvdWdoIHRoZSBwYXJ0cyBvZiBhIGZ1bGwgaG9zdG5hbWUsIGF0dGVtcHRpbmcgdG8gc2V0IGEgY29va2llIG9uIHRoYXQgZG9tYWluLiBJdCB3aWxsIHNldCBhIGNvb2tpZSBhdCB0aGUgaGlnaGVzdCBsZXZlbCBwb3NzaWJsZS5cbi8vIEZvciBleGFtcGxlIHN1YmRvbWFpbi5kb21haW4uY28udWsgd291bGQgdHJ5IHRoZSBmb2xsb3dpbmcgY29tYmluYXRpb25zOlxuLy8gXCJjby51a1wiIC0+IGZhaWxcbi8vIFwiZG9tYWluLmNvLnVrXCIgLT4gc3VjY2VzcywgcmV0dXJuXG4vLyBcInN1YmRvbWFpbi5kb21haW4uY28udWtcIiAtPiBza2lwcGVkLCBiZWNhdXNlIGFscmVhZHkgZm91bmRcbmZ1bmN0aW9uIGdldERvbWFpbihkb2MsIGxvY2F0aW9uSG9zdG5hbWUpIHtcbiAgICB2YXIgaSxcbiAgICAgICAgdGVzdFBhcnRzLFxuICAgICAgICBtcFRlc3QgPSAnbXB0ZXN0PWNvb2tpZScsXG4gICAgICAgIGhvc3RuYW1lID0gbG9jYXRpb25Ib3N0bmFtZS5zcGxpdCgnLicpO1xuICAgIGZvciAoaSA9IGhvc3RuYW1lLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgIHRlc3RQYXJ0cyA9IGhvc3RuYW1lLnNsaWNlKGkpLmpvaW4oJy4nKTtcbiAgICAgICAgZG9jLmNvb2tpZSA9IG1wVGVzdCArICc7ZG9tYWluPS4nICsgdGVzdFBhcnRzICsgJzsnO1xuICAgICAgICBpZiAoZG9jLmNvb2tpZS5pbmRleE9mKG1wVGVzdCkgPiAtMSl7XG4gICAgICAgICAgICBkb2MuY29va2llID0gbXBUZXN0LnNwbGl0KCc9JylbMF0gKyAnPTtkb21haW49LicgKyB0ZXN0UGFydHMgKyAnO2V4cGlyZXM9VGh1LCAwMSBKYW4gMTk3MCAwMDowMDowMSBHTVQ7JztcbiAgICAgICAgICAgIHJldHVybiB0ZXN0UGFydHM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuICcnO1xufVxuXG5mdW5jdGlvbiBkZWNvZGVQcm9kdWN0cygpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKENvbnN0YW50cy5EZWZhdWx0Q29uZmlnLkxvY2FsU3RvcmFnZVByb2R1Y3RzVjQpKSk7XG59XG5cbmZ1bmN0aW9uIGdldFVzZXJJZGVudGl0aWVzKG1waWQpIHtcbiAgICB2YXIgY29va2llcztcbiAgICBpZiAobXBpZCA9PT0gTVAubXBpZCkge1xuICAgICAgICByZXR1cm4gTVAudXNlcklkZW50aXRpZXM7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29va2llcyA9IGdldFBlcnNpc3RlbmNlKCk7XG5cbiAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llc1ttcGlkXSAmJiBjb29raWVzW21waWRdLnVpKSB7XG4gICAgICAgICAgICByZXR1cm4gY29va2llc1ttcGlkXS51aTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0QWxsVXNlckF0dHJpYnV0ZXMobXBpZCkge1xuICAgIHZhciBjb29raWVzO1xuICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgIHJldHVybiBNUC51c2VyQXR0cmlidXRlcztcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb29raWVzID0gZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdICYmIGNvb2tpZXNbbXBpZF0udWEpIHtcbiAgICAgICAgICAgIHJldHVybiBjb29raWVzW21waWRdLnVhO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRDYXJ0UHJvZHVjdHMobXBpZCkge1xuICAgIGlmIChtcGlkID09PSBNUC5tcGlkKSB7XG4gICAgICAgIHJldHVybiBNUC5jYXJ0UHJvZHVjdHM7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGFsbENhcnRQcm9kdWN0cyA9IEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShNUC5Db25maWcuTG9jYWxTdG9yYWdlUHJvZHVjdHNWNCkpKTtcbiAgICAgICAgaWYgKGFsbENhcnRQcm9kdWN0cyAmJiBhbGxDYXJ0UHJvZHVjdHNbbXBpZF0gJiYgYWxsQ2FydFByb2R1Y3RzW21waWRdLmNwKSB7XG4gICAgICAgICAgICByZXR1cm4gYWxsQ2FydFByb2R1Y3RzW21waWRdLmNwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZXRDYXJ0UHJvZHVjdHMoYWxsUHJvZHVjdHMpIHtcbiAgICB0cnkge1xuICAgICAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oZW5jb2RlVVJJQ29tcG9uZW50KE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KSwgQmFzZTY0LmVuY29kZShKU09OLnN0cmluZ2lmeShhbGxQcm9kdWN0cykpKTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3Igd2l0aCBzZXR0aW5nIHByb2R1Y3RzIG9uIGxvY2FsU3RvcmFnZS4nKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlcyhjb29raWVzKSB7XG4gICAgdmFyIGVuY29kZWRDb29raWVzID0gZW5jb2RlQ29va2llcyhKU09OLnN0cmluZ2lmeShjb29raWVzKSksXG4gICAgICAgIGRhdGUgPSBuZXcgRGF0ZSgpLFxuICAgICAgICBrZXkgPSBNUC5Db25maWcuQ29va2llTmFtZVY0LFxuICAgICAgICBleHBpcmVzID0gbmV3IERhdGUoZGF0ZS5nZXRUaW1lKCkgK1xuICAgICAgICAoTVAuQ29uZmlnLkNvb2tpZUV4cGlyYXRpb24gKiAyNCAqIDYwICogNjAgKiAxMDAwKSkudG9HTVRTdHJpbmcoKSxcbiAgICAgICAgY29va2llRG9tYWluID0gZ2V0Q29va2llRG9tYWluKCksXG4gICAgICAgIGRvbWFpbjtcblxuICAgIGlmIChjb29raWVEb21haW4gPT09ICcnKSB7XG4gICAgICAgIGRvbWFpbiA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGRvbWFpbiA9ICc7ZG9tYWluPScgKyBjb29raWVEb21haW47XG4gICAgfVxuXG5cbiAgICBpZiAobVBhcnRpY2xlLnVzZUNvb2tpZVN0b3JhZ2UpIHtcbiAgICAgICAgdmFyIGVuY29kZWRDb29raWVzV2l0aEV4cGlyYXRpb25BbmRQYXRoID0gcmVkdWNlQW5kRW5jb2RlQ29va2llcyhjb29raWVzLCBleHBpcmVzLCBkb21haW4pO1xuICAgICAgICB3aW5kb3cuZG9jdW1lbnQuY29va2llID1cbiAgICAgICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nICsgZW5jb2RlZENvb2tpZXNXaXRoRXhwaXJhdGlvbkFuZFBhdGg7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWNCwgZW5jb2RlZENvb2tpZXMpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0UGVyc2lzdGVuY2UoKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1QYXJ0aWNsZS51c2VDb29raWVTdG9yYWdlKSB7XG4gICAgICAgIGNvb2tpZXMgPSBnZXRDb29raWUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb29raWVzID0gZ2V0TG9jYWxTdG9yYWdlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvb2tpZXM7XG59XG5cbmZ1bmN0aW9uIGdldENvbnNlbnRTdGF0ZShtcGlkKSB7XG4gICAgdmFyIGNvb2tpZXM7XG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgcmV0dXJuIE1QLmNvbnNlbnRTdGF0ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb29raWVzID0gZ2V0UGVyc2lzdGVuY2UoKTtcblxuICAgICAgICBpZiAoY29va2llcyAmJiBjb29raWVzW21waWRdICYmIGNvb2tpZXNbbXBpZF0uY29uKSB7XG4gICAgICAgICAgICByZXR1cm4gQ29uc2VudC5TZXJpYWxpemF0aW9uLmZyb21NaW5pZmllZEpzb25PYmplY3QoY29va2llc1ttcGlkXS5jb24pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNldENvbnNlbnRTdGF0ZShtcGlkLCBjb25zZW50U3RhdGUpIHtcbiAgICAvL2l0J3MgY3VycmVudGx5IG5vdCBzdXBwb3J0ZWQgdG8gc2V0IHBlcnNpc3RlbmNlXG4gICAgLy9mb3IgYW55IE1QSUQgdGhhdCdzIG5vdCB0aGUgY3VycmVudCBvbmUuXG4gICAgaWYgKG1waWQgPT09IE1QLm1waWQpIHtcbiAgICAgICAgTVAuY29uc2VudFN0YXRlID0gY29uc2VudFN0YXRlO1xuICAgIH1cbiAgICB0aGlzLnVwZGF0ZSgpO1xufVxuXG5mdW5jdGlvbiBnZXREZXZpY2VJZCgpIHtcbiAgICByZXR1cm4gTVAuZGV2aWNlSWQ7XG59XG5cbmZ1bmN0aW9uIHJlc2V0UGVyc2lzdGVuY2UoKXtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWUpO1xuICAgIHJlbW92ZUxvY2FsU3RvcmFnZShNUC5Db25maWcuTG9jYWxTdG9yYWdlTmFtZVYzKTtcbiAgICByZW1vdmVMb2NhbFN0b3JhZ2UoTVAuQ29uZmlnLkxvY2FsU3RvcmFnZU5hbWVWNCk7XG4gICAgcmVtb3ZlTG9jYWxTdG9yYWdlKE1QLkNvbmZpZy5Mb2NhbFN0b3JhZ2VQcm9kdWN0c1Y0KTtcblxuICAgIGV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWUpO1xuICAgIGV4cGlyZUNvb2tpZXMoTVAuQ29uZmlnLkNvb2tpZU5hbWVWMik7XG4gICAgZXhwaXJlQ29va2llcyhNUC5Db25maWcuQ29va2llTmFtZVYzKTtcbiAgICBleHBpcmVDb29raWVzKE1QLkNvbmZpZy5Db29raWVOYW1lVjQpO1xufVxuXG4vLyBGb3J3YXJkZXIgQmF0Y2hpbmcgQ29kZVxudmFyIGZvcndhcmRpbmdTdGF0c0JhdGNoZXMgPSB7XG4gICAgdXBsb2Fkc1RhYmxlOiB7fSxcbiAgICBmb3J3YXJkaW5nU3RhdHNFdmVudFF1ZXVlOiBbXVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgdXNlTG9jYWxTdG9yYWdlOiB1c2VMb2NhbFN0b3JhZ2UsXG4gICAgaXNMb2NhbFN0b3JhZ2VBdmFpbGFibGU6IG51bGwsXG4gICAgaW5pdGlhbGl6ZVN0b3JhZ2U6IGluaXRpYWxpemVTdG9yYWdlLFxuICAgIHVwZGF0ZTogdXBkYXRlLFxuICAgIGRldGVybWluZUxvY2FsU3RvcmFnZUF2YWlsYWJpbGl0eTogZGV0ZXJtaW5lTG9jYWxTdG9yYWdlQXZhaWxhYmlsaXR5LFxuICAgIGNvbnZlcnRJbk1lbW9yeURhdGFGb3JDb29raWVzOiBjb252ZXJ0SW5NZW1vcnlEYXRhRm9yQ29va2llcyxcbiAgICBjb252ZXJ0UHJvZHVjdHNGb3JMb2NhbFN0b3JhZ2U6IGNvbnZlcnRQcm9kdWN0c0ZvckxvY2FsU3RvcmFnZSxcbiAgICBnZXRMb2NhbFN0b3JhZ2VQcm9kdWN0czogZ2V0TG9jYWxTdG9yYWdlUHJvZHVjdHMsXG4gICAgc3RvcmVQcm9kdWN0c0luTWVtb3J5OiBzdG9yZVByb2R1Y3RzSW5NZW1vcnksXG4gICAgc2V0TG9jYWxTdG9yYWdlOiBzZXRMb2NhbFN0b3JhZ2UsXG4gICAgc2V0R2xvYmFsU3RvcmFnZUF0dHJpYnV0ZXM6IHNldEdsb2JhbFN0b3JhZ2VBdHRyaWJ1dGVzLFxuICAgIGdldExvY2FsU3RvcmFnZTogZ2V0TG9jYWxTdG9yYWdlLFxuICAgIHN0b3JlRGF0YUluTWVtb3J5OiBzdG9yZURhdGFJbk1lbW9yeSxcbiAgICByZXRyaWV2ZURldmljZUlkOiByZXRyaWV2ZURldmljZUlkLFxuICAgIHBhcnNlRGV2aWNlSWQ6IHBhcnNlRGV2aWNlSWQsXG4gICAgZXhwaXJlQ29va2llczogZXhwaXJlQ29va2llcyxcbiAgICBnZXRDb29raWU6IGdldENvb2tpZSxcbiAgICBzZXRDb29raWU6IHNldENvb2tpZSxcbiAgICByZWR1Y2VBbmRFbmNvZGVDb29raWVzOiByZWR1Y2VBbmRFbmNvZGVDb29raWVzLFxuICAgIGZpbmRQcmV2Q29va2llc0Jhc2VkT25VSTogZmluZFByZXZDb29raWVzQmFzZWRPblVJLFxuICAgIHJlcGxhY2VDb21tYXNXaXRoUGlwZXM6IHJlcGxhY2VDb21tYXNXaXRoUGlwZXMsXG4gICAgcmVwbGFjZVBpcGVzV2l0aENvbW1hczogcmVwbGFjZVBpcGVzV2l0aENvbW1hcyxcbiAgICByZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzOiByZXBsYWNlQXBvc3Ryb3BoZXNXaXRoUXVvdGVzLFxuICAgIHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXM6IHJlcGxhY2VRdW90ZXNXaXRoQXBvc3Ryb3BoZXMsXG4gICAgY3JlYXRlQ29va2llU3RyaW5nOiBjcmVhdGVDb29raWVTdHJpbmcsXG4gICAgcmV2ZXJ0Q29va2llU3RyaW5nOiByZXZlcnRDb29raWVTdHJpbmcsXG4gICAgZW5jb2RlQ29va2llczogZW5jb2RlQ29va2llcyxcbiAgICBkZWNvZGVDb29raWVzOiBkZWNvZGVDb29raWVzLFxuICAgIGdldENvb2tpZURvbWFpbjogZ2V0Q29va2llRG9tYWluLFxuICAgIGRlY29kZVByb2R1Y3RzOiBkZWNvZGVQcm9kdWN0cyxcbiAgICBnZXRVc2VySWRlbnRpdGllczogZ2V0VXNlcklkZW50aXRpZXMsXG4gICAgZ2V0QWxsVXNlckF0dHJpYnV0ZXM6IGdldEFsbFVzZXJBdHRyaWJ1dGVzLFxuICAgIGdldENhcnRQcm9kdWN0czogZ2V0Q2FydFByb2R1Y3RzLFxuICAgIHNldENhcnRQcm9kdWN0czogc2V0Q2FydFByb2R1Y3RzLFxuICAgIHVwZGF0ZU9ubHlDb29raWVVc2VyQXR0cmlidXRlczogdXBkYXRlT25seUNvb2tpZVVzZXJBdHRyaWJ1dGVzLFxuICAgIGdldFBlcnNpc3RlbmNlOiBnZXRQZXJzaXN0ZW5jZSxcbiAgICBnZXREZXZpY2VJZDogZ2V0RGV2aWNlSWQsXG4gICAgcmVzZXRQZXJzaXN0ZW5jZTogcmVzZXRQZXJzaXN0ZW5jZSxcbiAgICBnZXRDb25zZW50U3RhdGU6IGdldENvbnNlbnRTdGF0ZSxcbiAgICBzZXRDb25zZW50U3RhdGU6IHNldENvbnNlbnRTdGF0ZSxcbiAgICBmb3J3YXJkaW5nU3RhdHNCYXRjaGVzOiBmb3J3YXJkaW5nU3RhdHNCYXRjaGVzXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKTtcblxuLy8gQmFzZTY0IGVuY29kZXIvZGVjb2RlciAtIGh0dHA6Ly93d3cud2VidG9vbGtpdC5pbmZvL2phdmFzY3JpcHRfYmFzZTY0Lmh0bWxcbnZhciBCYXNlNjQgPSB7XG4gICAgX2tleVN0cjogJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky89JyxcblxuICAgIC8vIElucHV0IG11c3QgYmUgYSBzdHJpbmdcbiAgICBlbmNvZGU6IGZ1bmN0aW9uIGVuY29kZShpbnB1dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHdpbmRvdy5idG9hICYmIHdpbmRvdy5hdG9iKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHdpbmRvdy5idG9hKGlucHV0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgSGVscGVycy5sb2dEZWJ1ZygnRXJyb3IgZW5jb2RpbmcgY29va2llIHZhbHVlcyBpbnRvIEJhc2U2NDonICsgZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2VuY29kZShpbnB1dCk7XG4gICAgfSxcblxuICAgIF9lbmNvZGU6IGZ1bmN0aW9uIF9lbmNvZGUoaW5wdXQpIHtcbiAgICAgICAgdmFyIG91dHB1dCA9ICcnO1xuICAgICAgICB2YXIgY2hyMSwgY2hyMiwgY2hyMywgZW5jMSwgZW5jMiwgZW5jMywgZW5jNDtcbiAgICAgICAgdmFyIGkgPSAwO1xuXG4gICAgICAgIGlucHV0ID0gdGhpcy5lbmNvZGUoaW5wdXQpO1xuXG4gICAgICAgIHdoaWxlIChpIDwgaW5wdXQubGVuZ3RoKSB7XG4gICAgICAgICAgICBjaHIxID0gaW5wdXQuY2hhckNvZGVBdChpKyspO1xuICAgICAgICAgICAgY2hyMiA9IGlucHV0LmNoYXJDb2RlQXQoaSsrKTtcbiAgICAgICAgICAgIGNocjMgPSBpbnB1dC5jaGFyQ29kZUF0KGkrKyk7XG5cbiAgICAgICAgICAgIGVuYzEgPSBjaHIxID4+IDI7XG4gICAgICAgICAgICBlbmMyID0gKGNocjEgJiAzKSA8PCA0IHwgY2hyMiA+PiA0O1xuICAgICAgICAgICAgZW5jMyA9IChjaHIyICYgMTUpIDw8IDIgfCBjaHIzID4+IDY7XG4gICAgICAgICAgICBlbmM0ID0gY2hyMyAmIDYzO1xuXG4gICAgICAgICAgICBpZiAoaXNOYU4oY2hyMikpIHtcbiAgICAgICAgICAgICAgICBlbmMzID0gZW5jNCA9IDY0O1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc05hTihjaHIzKSkge1xuICAgICAgICAgICAgICAgIGVuYzQgPSA2NDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzEpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzIpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzMpICsgQmFzZTY0Ll9rZXlTdHIuY2hhckF0KGVuYzQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvdXRwdXQ7XG4gICAgfSxcblxuICAgIGRlY29kZTogZnVuY3Rpb24gZGVjb2RlKGlucHV0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAod2luZG93LmJ0b2EgJiYgd2luZG93LmF0b2IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGVzY2FwZSh3aW5kb3cuYXRvYihpbnB1dCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgLy9sb2coZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIEJhc2U2NC5fZGVjb2RlKGlucHV0KTtcbiAgICB9LFxuXG4gICAgX2RlY29kZTogZnVuY3Rpb24gX2RlY29kZShpbnB1dCkge1xuICAgICAgICB2YXIgb3V0cHV0ID0gJyc7XG4gICAgICAgIHZhciBjaHIxLCBjaHIyLCBjaHIzO1xuICAgICAgICB2YXIgZW5jMSwgZW5jMiwgZW5jMywgZW5jNDtcbiAgICAgICAgdmFyIGkgPSAwO1xuXG4gICAgICAgIGlucHV0ID0gaW5wdXQucmVwbGFjZSgvW15BLVphLXowLTlcXCtcXC9cXD1dL2csICcnKTtcblxuICAgICAgICB3aGlsZSAoaSA8IGlucHV0Lmxlbmd0aCkge1xuICAgICAgICAgICAgZW5jMSA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jMiA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jMyA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuICAgICAgICAgICAgZW5jNCA9IEJhc2U2NC5fa2V5U3RyLmluZGV4T2YoaW5wdXQuY2hhckF0KGkrKykpO1xuXG4gICAgICAgICAgICBjaHIxID0gZW5jMSA8PCAyIHwgZW5jMiA+PiA0O1xuICAgICAgICAgICAgY2hyMiA9IChlbmMyICYgMTUpIDw8IDQgfCBlbmMzID4+IDI7XG4gICAgICAgICAgICBjaHIzID0gKGVuYzMgJiAzKSA8PCA2IHwgZW5jNDtcblxuICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgU3RyaW5nLmZyb21DaGFyQ29kZShjaHIxKTtcblxuICAgICAgICAgICAgaWYgKGVuYzMgIT09IDY0KSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gb3V0cHV0ICsgU3RyaW5nLmZyb21DaGFyQ29kZShjaHIyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChlbmM0ICE9PSA2NCkge1xuICAgICAgICAgICAgICAgIG91dHB1dCA9IG91dHB1dCArIFN0cmluZy5mcm9tQ2hhckNvZGUoY2hyMyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgb3V0cHV0ID0gVVRGOC5kZWNvZGUob3V0cHV0KTtcbiAgICAgICAgcmV0dXJuIG91dHB1dDtcbiAgICB9XG59O1xuXG52YXIgVVRGOCA9IHtcbiAgICBlbmNvZGU6IGZ1bmN0aW9uIGVuY29kZShzKSB7XG4gICAgICAgIHZhciB1dGZ0ZXh0ID0gJyc7XG5cbiAgICAgICAgZm9yICh2YXIgbiA9IDA7IG4gPCBzLmxlbmd0aDsgbisrKSB7XG4gICAgICAgICAgICB2YXIgYyA9IHMuY2hhckNvZGVBdChuKTtcblxuICAgICAgICAgICAgaWYgKGMgPCAxMjgpIHtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGMgPiAxMjcgJiYgYyA8IDIwNDgpIHtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyA+PiA2IHwgMTkyKTtcbiAgICAgICAgICAgICAgICB1dGZ0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYyAmIDYzIHwgMTI4KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdXRmdGV4dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMgPj4gMTIgfCAyMjQpO1xuICAgICAgICAgICAgICAgIHV0ZnRleHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjID4+IDYgJiA2MyB8IDEyOCk7XG4gICAgICAgICAgICAgICAgdXRmdGV4dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMgJiA2MyB8IDEyOCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHV0ZnRleHQ7XG4gICAgfSxcblxuICAgIGRlY29kZTogZnVuY3Rpb24gZGVjb2RlKHV0ZnRleHQpIHtcbiAgICAgICAgdmFyIHMgPSAnJztcbiAgICAgICAgdmFyIGkgPSAwO1xuICAgICAgICB2YXIgYyA9IDAsXG4gICAgICAgICAgICBjMSA9IDAsXG4gICAgICAgICAgICBjMiA9IDA7XG5cbiAgICAgICAgd2hpbGUgKGkgPCB1dGZ0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgICAgYyA9IHV0ZnRleHQuY2hhckNvZGVBdChpKTtcbiAgICAgICAgICAgIGlmIChjIDwgMTI4KSB7XG4gICAgICAgICAgICAgICAgcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGMpO1xuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYyA+IDE5MSAmJiBjIDwgMjI0KSB7XG4gICAgICAgICAgICAgICAgYzEgPSB1dGZ0ZXh0LmNoYXJDb2RlQXQoaSArIDEpO1xuICAgICAgICAgICAgICAgIHMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoYyAmIDMxKSA8PCA2IHwgYzEgJiA2Myk7XG4gICAgICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjMSA9IHV0ZnRleHQuY2hhckNvZGVBdChpICsgMSk7XG4gICAgICAgICAgICAgICAgYzIgPSB1dGZ0ZXh0LmNoYXJDb2RlQXQoaSArIDIpO1xuICAgICAgICAgICAgICAgIHMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSgoYyAmIDE1KSA8PCAxMiB8IChjMSAmIDYzKSA8PCA2IHwgYzIgJiA2Myk7XG4gICAgICAgICAgICAgICAgaSArPSAzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIC8vIGZvckVhY2ggcG9seWZpbGxcbiAgICAvLyBQcm9kdWN0aW9uIHN0ZXBzIG9mIEVDTUEtMjYyLCBFZGl0aW9uIDUsIDE1LjQuNC4xOFxuICAgIC8vIFJlZmVyZW5jZTogaHR0cDovL2VzNS5naXRodWIuaW8vI3gxNS40LjQuMThcbiAgICBmb3JFYWNoOiBmdW5jdGlvbihjYWxsYmFjaywgdGhpc0FyZykge1xuICAgICAgICB2YXIgVCwgaztcblxuICAgICAgICBpZiAodGhpcyA9PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCcgdGhpcyBpcyBudWxsIG9yIG5vdCBkZWZpbmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgTyA9IE9iamVjdCh0aGlzKTtcbiAgICAgICAgdmFyIGxlbiA9IE8ubGVuZ3RoID4+PiAwO1xuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoY2FsbGJhY2sgKyAnIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIFQgPSB0aGlzQXJnO1xuICAgICAgICB9XG5cbiAgICAgICAgayA9IDA7XG5cbiAgICAgICAgd2hpbGUgKGsgPCBsZW4pIHtcbiAgICAgICAgICAgIHZhciBrVmFsdWU7XG4gICAgICAgICAgICBpZiAoayBpbiBPKSB7XG4gICAgICAgICAgICAgICAga1ZhbHVlID0gT1trXTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjay5jYWxsKFQsIGtWYWx1ZSwgaywgTyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrKys7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gbWFwIHBvbHlmaWxsXG4gICAgLy8gUHJvZHVjdGlvbiBzdGVwcyBvZiBFQ01BLTI2MiwgRWRpdGlvbiA1LCAxNS40LjQuMTlcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHA6Ly9lczUuZ2l0aHViLmlvLyN4MTUuNC40LjE5XG4gICAgbWFwOiBmdW5jdGlvbihjYWxsYmFjaywgdGhpc0FyZykge1xuICAgICAgICB2YXIgVCwgQSwgaztcblxuICAgICAgICBpZiAodGhpcyA9PT0gbnVsbCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignIHRoaXMgaXMgbnVsbCBvciBub3QgZGVmaW5lZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIE8gPSBPYmplY3QodGhpcyk7XG4gICAgICAgIHZhciBsZW4gPSBPLmxlbmd0aCA+Pj4gMDtcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGNhbGxiYWNrICsgJyBpcyBub3QgYSBmdW5jdGlvbicpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICBUID0gdGhpc0FyZztcbiAgICAgICAgfVxuXG4gICAgICAgIEEgPSBuZXcgQXJyYXkobGVuKTtcblxuICAgICAgICBrID0gMDtcblxuICAgICAgICB3aGlsZSAoayA8IGxlbikge1xuICAgICAgICAgICAgdmFyIGtWYWx1ZSwgbWFwcGVkVmFsdWU7XG4gICAgICAgICAgICBpZiAoayBpbiBPKSB7XG4gICAgICAgICAgICAgICAga1ZhbHVlID0gT1trXTtcbiAgICAgICAgICAgICAgICBtYXBwZWRWYWx1ZSA9IGNhbGxiYWNrLmNhbGwoVCwga1ZhbHVlLCBrLCBPKTtcbiAgICAgICAgICAgICAgICBBW2tdID0gbWFwcGVkVmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrKys7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gQTtcbiAgICB9LFxuXG4gICAgLy8gZmlsdGVyIHBvbHlmaWxsXG4gICAgLy8gUHJvZGN1dGlvbiBzdGVwcyBvZiBFQ01BLTI2MiwgRWRpdGlvbiA1XG4gICAgLy8gUmVmZXJlbmNlOiBodHRwOi8vZXM1LmdpdGh1Yi5pby8jeDE1LjQuNC4yMFxuICAgIGZpbHRlcjogZnVuY3Rpb24oZnVuLyosIHRoaXNBcmcqLykge1xuICAgICAgICAndXNlIHN0cmljdCc7XG5cbiAgICAgICAgaWYgKHRoaXMgPT09IHZvaWQgMCB8fCB0aGlzID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdCA9IE9iamVjdCh0aGlzKTtcbiAgICAgICAgdmFyIGxlbiA9IHQubGVuZ3RoID4+PiAwO1xuICAgICAgICBpZiAodHlwZW9mIGZ1biAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJlcyA9IFtdO1xuICAgICAgICB2YXIgdGhpc0FyZyA9IGFyZ3VtZW50cy5sZW5ndGggPj0gMiA/IGFyZ3VtZW50c1sxXSA6IHZvaWQgMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgaWYgKGkgaW4gdCkge1xuICAgICAgICAgICAgICAgIHZhciB2YWwgPSB0W2ldO1xuICAgICAgICAgICAgICAgIGlmIChmdW4uY2FsbCh0aGlzQXJnLCB2YWwsIGksIHQpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5wdXNoKHZhbCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9LFxuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvQXJyYXkvaXNBcnJheVxuICAgIGlzQXJyYXk6IGZ1bmN0aW9uKGFyZykge1xuICAgICAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gICAgfSxcblxuICAgIEJhc2U2NDogQmFzZTY0XG59O1xuIiwidmFyIFR5cGVzID0gcmVxdWlyZSgnLi90eXBlcycpLFxuICAgIE1lc3NhZ2VUeXBlID0gVHlwZXMuTWVzc2FnZVR5cGUsXG4gICAgQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZSA9IFR5cGVzLkFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUsXG4gICAgQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9jb25zdGFudHMnKSxcbiAgICBIZWxwZXJzID0gcmVxdWlyZSgnLi9oZWxwZXJzJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgcGFyc2VOdW1iZXIgPSByZXF1aXJlKCcuL2hlbHBlcnMnKS5wYXJzZU51bWJlcjtcblxuZnVuY3Rpb24gY29udmVydEN1c3RvbUZsYWdzKGV2ZW50LCBkdG8pIHtcbiAgICB2YXIgdmFsdWVBcnJheSA9IFtdO1xuICAgIGR0by5mbGFncyA9IHt9O1xuXG4gICAgZm9yICh2YXIgcHJvcCBpbiBldmVudC5DdXN0b21GbGFncykge1xuICAgICAgICB2YWx1ZUFycmF5ID0gW107XG5cbiAgICAgICAgaWYgKGV2ZW50LkN1c3RvbUZsYWdzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShldmVudC5DdXN0b21GbGFnc1twcm9wXSkpIHtcbiAgICAgICAgICAgICAgICBldmVudC5DdXN0b21GbGFnc1twcm9wXS5mb3JFYWNoKGZ1bmN0aW9uKGN1c3RvbUZsYWdQcm9wZXJ0eSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICAgICAgICAgfHwgdHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICAgICAgfHwgdHlwZW9mIGN1c3RvbUZsYWdQcm9wZXJ0eSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUFycmF5LnB1c2goY3VzdG9tRmxhZ1Byb3BlcnR5LnRvU3RyaW5nKCkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICh0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdudW1iZXInXG4gICAgICAgICAgICB8fCB0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdzdHJpbmcnXG4gICAgICAgICAgICB8fCB0eXBlb2YgZXZlbnQuQ3VzdG9tRmxhZ3NbcHJvcF0gPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgIHZhbHVlQXJyYXkucHVzaChldmVudC5DdXN0b21GbGFnc1twcm9wXS50b1N0cmluZygpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHZhbHVlQXJyYXkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZHRvLmZsYWdzW3Byb3BdID0gdmFsdWVBcnJheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFByb2R1Y3RMaXN0VG9EVE8ocHJvZHVjdExpc3QpIHtcbiAgICBpZiAoIXByb2R1Y3RMaXN0KSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjdExpc3QubWFwKGZ1bmN0aW9uKHByb2R1Y3QpIHtcbiAgICAgICAgcmV0dXJuIGNvbnZlcnRQcm9kdWN0VG9EVE8ocHJvZHVjdCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQcm9kdWN0VG9EVE8ocHJvZHVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIGlkOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5Ta3UpLFxuICAgICAgICBubTogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuTmFtZSksXG4gICAgICAgIHByOiBwYXJzZU51bWJlcihwcm9kdWN0LlByaWNlKSxcbiAgICAgICAgcXQ6IHBhcnNlTnVtYmVyKHByb2R1Y3QuUXVhbnRpdHkpLFxuICAgICAgICBicjogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuQnJhbmQpLFxuICAgICAgICB2YTogSGVscGVycy5wYXJzZVN0cmluZ09yTnVtYmVyKHByb2R1Y3QuVmFyaWFudCksXG4gICAgICAgIGNhOiBIZWxwZXJzLnBhcnNlU3RyaW5nT3JOdW1iZXIocHJvZHVjdC5DYXRlZ29yeSksXG4gICAgICAgIHBzOiBwYXJzZU51bWJlcihwcm9kdWN0LlBvc2l0aW9uKSxcbiAgICAgICAgY2M6IEhlbHBlcnMucGFyc2VTdHJpbmdPck51bWJlcihwcm9kdWN0LkNvdXBvbkNvZGUpLFxuICAgICAgICB0cGE6IHBhcnNlTnVtYmVyKHByb2R1Y3QuVG90YWxBbW91bnQpLFxuICAgICAgICBhdHRyczogcHJvZHVjdC5BdHRyaWJ1dGVzXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY29udmVydFRvQ29uc2VudFN0YXRlRFRPKHN0YXRlKSB7XG4gICAgaWYgKCFzdGF0ZSkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgdmFyIGpzb25PYmplY3QgPSB7fTtcbiAgICB2YXIgZ2RwckNvbnNlbnRTdGF0ZSA9IHN0YXRlLmdldEdEUFJDb25zZW50U3RhdGUoKTtcbiAgICBpZiAoZ2RwckNvbnNlbnRTdGF0ZSkge1xuICAgICAgICB2YXIgZ2RwciA9IHt9O1xuICAgICAgICBqc29uT2JqZWN0LmdkcHIgPSBnZHByO1xuICAgICAgICBmb3IgKHZhciBwdXJwb3NlIGluIGdkcHJDb25zZW50U3RhdGUpe1xuICAgICAgICAgICAgaWYgKGdkcHJDb25zZW50U3RhdGUuaGFzT3duUHJvcGVydHkocHVycG9zZSkpIHtcbiAgICAgICAgICAgICAgICB2YXIgZ2RwckNvbnNlbnQgPSBnZHByQ29uc2VudFN0YXRlW3B1cnBvc2VdO1xuICAgICAgICAgICAgICAgIGpzb25PYmplY3QuZ2RwcltwdXJwb3NlXSA9IHt9O1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YoZ2RwckNvbnNlbnQuQ29uc2VudGVkKSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0uYyA9IGdkcHJDb25zZW50LkNvbnNlbnRlZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5UaW1lc3RhbXApID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgICAgICAgICBnZHByW3B1cnBvc2VdLnRzID0gZ2RwckNvbnNlbnQuVGltZXN0YW1wO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudCkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0uZCA9IGdkcHJDb25zZW50LkNvbnNlbnREb2N1bWVudDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZihnZHByQ29uc2VudC5Mb2NhdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGdkcHJbcHVycG9zZV0ubCA9IGdkcHJDb25zZW50LkxvY2F0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mKGdkcHJDb25zZW50LkhhcmR3YXJlSWQpID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICBnZHByW3B1cnBvc2VdLmggPSBnZHByQ29uc2VudC5IYXJkd2FyZUlkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4ganNvbk9iamVjdDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlRXZlbnRPYmplY3QobWVzc2FnZVR5cGUsIG5hbWUsIGRhdGEsIGV2ZW50VHlwZSwgY3VzdG9tRmxhZ3MpIHtcbiAgICB2YXIgZXZlbnRPYmplY3QsXG4gICAgICAgIG9wdE91dCA9IChtZXNzYWdlVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuT3B0T3V0ID8gIU1QLmlzRW5hYmxlZCA6IG51bGwpO1xuICAgIGRhdGEgPSBIZWxwZXJzLnNhbml0aXplQXR0cmlidXRlcyhkYXRhKTtcblxuICAgIGlmIChNUC5zZXNzaW9uSWQgfHwgbWVzc2FnZVR5cGUgPT0gVHlwZXMuTWVzc2FnZVR5cGUuT3B0T3V0IHx8IEhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgaWYgKG1lc3NhZ2VUeXBlICE9PSBUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKSB7XG4gICAgICAgICAgICBNUC5kYXRlTGFzdEV2ZW50U2VudCA9IG5ldyBEYXRlKCk7XG4gICAgICAgIH1cbiAgICAgICAgZXZlbnRPYmplY3QgPSB7XG4gICAgICAgICAgICBFdmVudE5hbWU6IG5hbWUgfHwgbWVzc2FnZVR5cGUsXG4gICAgICAgICAgICBFdmVudENhdGVnb3J5OiBldmVudFR5cGUsXG4gICAgICAgICAgICBVc2VyQXR0cmlidXRlczogTVAudXNlckF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBVc2VySWRlbnRpdGllczogTVAudXNlcklkZW50aXRpZXMsXG4gICAgICAgICAgICBTdG9yZTogTVAuc2VydmVyU2V0dGluZ3MsXG4gICAgICAgICAgICBFdmVudEF0dHJpYnV0ZXM6IGRhdGEsXG4gICAgICAgICAgICBTREtWZXJzaW9uOiBDb25zdGFudHMuc2RrVmVyc2lvbixcbiAgICAgICAgICAgIFNlc3Npb25JZDogTVAuc2Vzc2lvbklkLFxuICAgICAgICAgICAgRXZlbnREYXRhVHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAgICAgICBEZWJ1ZzogbVBhcnRpY2xlLmlzRGV2ZWxvcG1lbnRNb2RlLFxuICAgICAgICAgICAgTG9jYXRpb246IE1QLmN1cnJlbnRQb3NpdGlvbixcbiAgICAgICAgICAgIE9wdE91dDogb3B0T3V0LFxuICAgICAgICAgICAgRXhwYW5kZWRFdmVudENvdW50OiAwLFxuICAgICAgICAgICAgQ3VzdG9tRmxhZ3M6IGN1c3RvbUZsYWdzLFxuICAgICAgICAgICAgQXBwVmVyc2lvbjogTVAuYXBwVmVyc2lvbixcbiAgICAgICAgICAgIENsaWVudEdlbmVyYXRlZElkOiBNUC5jbGllbnRJZCxcbiAgICAgICAgICAgIERldmljZUlkOiBNUC5kZXZpY2VJZCxcbiAgICAgICAgICAgIE1QSUQ6IE1QLm1waWQsXG4gICAgICAgICAgICBDb25zZW50U3RhdGU6IE1QLmNvbnNlbnRTdGF0ZVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChtZXNzYWdlVHlwZSA9PT0gVHlwZXMuTWVzc2FnZVR5cGUuU2Vzc2lvbkVuZCkge1xuICAgICAgICAgICAgZXZlbnRPYmplY3QuU2Vzc2lvbkxlbmd0aCA9IE1QLmRhdGVMYXN0RXZlbnRTZW50LmdldFRpbWUoKSAtIE1QLnNlc3Npb25TdGFydERhdGUuZ2V0VGltZSgpO1xuICAgICAgICAgICAgZXZlbnRPYmplY3QuY3VycmVudFNlc3Npb25NUElEcyA9IE1QLmN1cnJlbnRTZXNzaW9uTVBJRHM7XG4gICAgICAgICAgICBldmVudE9iamVjdC5FdmVudEF0dHJpYnV0ZXMgPSBNUC5zZXNzaW9uQXR0cmlidXRlcztcblxuICAgICAgICAgICAgTVAuY3VycmVudFNlc3Npb25NUElEcyA9IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgZXZlbnRPYmplY3QuVGltZXN0YW1wID0gTVAuZGF0ZUxhc3RFdmVudFNlbnQuZ2V0VGltZSgpO1xuXG4gICAgICAgIHJldHVybiBldmVudE9iamVjdDtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29udmVydEV2ZW50VG9EVE8oZXZlbnQsIGlzRmlyc3RSdW4sIGN1cnJlbmN5Q29kZSkge1xuICAgIHZhciBkdG8gPSB7XG4gICAgICAgIG46IGV2ZW50LkV2ZW50TmFtZSxcbiAgICAgICAgZXQ6IGV2ZW50LkV2ZW50Q2F0ZWdvcnksXG4gICAgICAgIHVhOiBldmVudC5Vc2VyQXR0cmlidXRlcyxcbiAgICAgICAgdWk6IGV2ZW50LlVzZXJJZGVudGl0aWVzLFxuICAgICAgICBzdHI6IGV2ZW50LlN0b3JlLFxuICAgICAgICBhdHRyczogZXZlbnQuRXZlbnRBdHRyaWJ1dGVzLFxuICAgICAgICBzZGs6IGV2ZW50LlNES1ZlcnNpb24sXG4gICAgICAgIHNpZDogZXZlbnQuU2Vzc2lvbklkLFxuICAgICAgICBzbDogZXZlbnQuU2Vzc2lvbkxlbmd0aCxcbiAgICAgICAgZHQ6IGV2ZW50LkV2ZW50RGF0YVR5cGUsXG4gICAgICAgIGRiZzogZXZlbnQuRGVidWcsXG4gICAgICAgIGN0OiBldmVudC5UaW1lc3RhbXAsXG4gICAgICAgIGxjOiBldmVudC5Mb2NhdGlvbixcbiAgICAgICAgbzogZXZlbnQuT3B0T3V0LFxuICAgICAgICBlZWM6IGV2ZW50LkV4cGFuZGVkRXZlbnRDb3VudCxcbiAgICAgICAgYXY6IGV2ZW50LkFwcFZlcnNpb24sXG4gICAgICAgIGNnaWQ6IGV2ZW50LkNsaWVudEdlbmVyYXRlZElkLFxuICAgICAgICBkYXM6IGV2ZW50LkRldmljZUlkLFxuICAgICAgICBtcGlkOiBldmVudC5NUElELFxuICAgICAgICBzbXBpZHM6IGV2ZW50LmN1cnJlbnRTZXNzaW9uTVBJRHNcbiAgICB9O1xuXG4gICAgdmFyIGNvbnNlbnQgPSBjb252ZXJ0VG9Db25zZW50U3RhdGVEVE8oZXZlbnQuQ29uc2VudFN0YXRlKTtcbiAgICBpZiAoY29uc2VudCkge1xuICAgICAgICBkdG8uY29uID0gY29uc2VudDtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gTWVzc2FnZVR5cGUuQXBwU3RhdGVUcmFuc2l0aW9uKSB7XG4gICAgICAgIGR0by5mciA9IGlzRmlyc3RSdW47XG4gICAgICAgIGR0by5pdSA9IGZhbHNlO1xuICAgICAgICBkdG8uYXQgPSBBcHBsaWNhdGlvblRyYW5zaXRpb25UeXBlLkFwcEluaXQ7XG4gICAgICAgIGR0by5sciA9IHdpbmRvdy5sb2NhdGlvbi5ocmVmIHx8IG51bGw7XG4gICAgICAgIGR0by5hdHRycyA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LkN1c3RvbUZsYWdzKSB7XG4gICAgICAgIGNvbnZlcnRDdXN0b21GbGFncyhldmVudCwgZHRvKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuRXZlbnREYXRhVHlwZSA9PT0gTWVzc2FnZVR5cGUuQ29tbWVyY2UpIHtcbiAgICAgICAgZHRvLmN1ID0gY3VycmVuY3lDb2RlO1xuXG4gICAgICAgIGlmIChldmVudC5TaG9wcGluZ0NhcnQpIHtcbiAgICAgICAgICAgIGR0by5zYyA9IHtcbiAgICAgICAgICAgICAgICBwbDogY29udmVydFByb2R1Y3RMaXN0VG9EVE8oZXZlbnQuU2hvcHBpbmdDYXJ0LlByb2R1Y3RMaXN0KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChldmVudC5Qcm9kdWN0QWN0aW9uKSB7XG4gICAgICAgICAgICBkdG8ucGQgPSB7XG4gICAgICAgICAgICAgICAgYW46IGV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdEFjdGlvblR5cGUsXG4gICAgICAgICAgICAgICAgY3M6IHBhcnNlTnVtYmVyKGV2ZW50LlByb2R1Y3RBY3Rpb24uQ2hlY2tvdXRTdGVwKSxcbiAgICAgICAgICAgICAgICBjbzogZXZlbnQuUHJvZHVjdEFjdGlvbi5DaGVja291dE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgcGw6IGNvbnZlcnRQcm9kdWN0TGlzdFRvRFRPKGV2ZW50LlByb2R1Y3RBY3Rpb24uUHJvZHVjdExpc3QpLFxuICAgICAgICAgICAgICAgIHRpOiBldmVudC5Qcm9kdWN0QWN0aW9uLlRyYW5zYWN0aW9uSWQsXG4gICAgICAgICAgICAgICAgdGE6IGV2ZW50LlByb2R1Y3RBY3Rpb24uQWZmaWxpYXRpb24sXG4gICAgICAgICAgICAgICAgdGNjOiBldmVudC5Qcm9kdWN0QWN0aW9uLkNvdXBvbkNvZGUsXG4gICAgICAgICAgICAgICAgdHI6IHBhcnNlTnVtYmVyKGV2ZW50LlByb2R1Y3RBY3Rpb24uVG90YWxBbW91bnQpLFxuICAgICAgICAgICAgICAgIHRzOiBwYXJzZU51bWJlcihldmVudC5Qcm9kdWN0QWN0aW9uLlNoaXBwaW5nQW1vdW50KSxcbiAgICAgICAgICAgICAgICB0dDogcGFyc2VOdW1iZXIoZXZlbnQuUHJvZHVjdEFjdGlvbi5UYXhBbW91bnQpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGV2ZW50LlByb21vdGlvbkFjdGlvbikge1xuICAgICAgICAgICAgZHRvLnBtID0ge1xuICAgICAgICAgICAgICAgIGFuOiBldmVudC5Qcm9tb3Rpb25BY3Rpb24uUHJvbW90aW9uQWN0aW9uVHlwZSxcbiAgICAgICAgICAgICAgICBwbDogZXZlbnQuUHJvbW90aW9uQWN0aW9uLlByb21vdGlvbkxpc3QubWFwKGZ1bmN0aW9uKHByb21vdGlvbikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6IHByb21vdGlvbi5JZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5tOiBwcm9tb3Rpb24uTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyOiBwcm9tb3Rpb24uQ3JlYXRpdmUsXG4gICAgICAgICAgICAgICAgICAgICAgICBwczogcHJvbW90aW9uLlBvc2l0aW9uID8gcHJvbW90aW9uLlBvc2l0aW9uIDogMFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGV2ZW50LlByb2R1Y3RJbXByZXNzaW9ucykge1xuICAgICAgICAgICAgZHRvLnBpID0gZXZlbnQuUHJvZHVjdEltcHJlc3Npb25zLm1hcChmdW5jdGlvbihpbXByZXNzaW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgcGlsOiBpbXByZXNzaW9uLlByb2R1Y3RJbXByZXNzaW9uTGlzdCxcbiAgICAgICAgICAgICAgICAgICAgcGw6IGNvbnZlcnRQcm9kdWN0TGlzdFRvRFRPKGltcHJlc3Npb24uUHJvZHVjdExpc3QpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVsc2UgaWYgKGV2ZW50LkV2ZW50RGF0YVR5cGUgPT09IE1lc3NhZ2VUeXBlLlByb2ZpbGUpIHtcbiAgICAgICAgZHRvLnBldCA9IGV2ZW50LlByb2ZpbGVNZXNzYWdlVHlwZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZHRvO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBjcmVhdGVFdmVudE9iamVjdDogY3JlYXRlRXZlbnRPYmplY3QsXG4gICAgY29udmVydEV2ZW50VG9EVE86IGNvbnZlcnRFdmVudFRvRFRPLFxuICAgIGNvbnZlcnRUb0NvbnNlbnRTdGF0ZURUTzogY29udmVydFRvQ29uc2VudFN0YXRlRFRPXG59O1xuIiwidmFyIEhlbHBlcnMgPSByZXF1aXJlKCcuL2hlbHBlcnMnKSxcbiAgICBNZXNzYWdlcyA9IHJlcXVpcmUoJy4vY29uc3RhbnRzJykuTWVzc2FnZXMsXG4gICAgVHlwZXMgPSByZXF1aXJlKCcuL3R5cGVzJyksXG4gICAgSWRlbnRpdHlBUEkgPSByZXF1aXJlKCcuL2lkZW50aXR5JykuSWRlbnRpdHlBUEksXG4gICAgUGVyc2lzdGVuY2UgPSByZXF1aXJlKCcuL3BlcnNpc3RlbmNlJyksXG4gICAgTVAgPSByZXF1aXJlKCcuL21wJyksXG4gICAgbG9nRXZlbnQgPSByZXF1aXJlKCcuL2V2ZW50cycpLmxvZ0V2ZW50O1xuXG5mdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmIChNUC5zZXNzaW9uSWQpIHtcbiAgICAgICAgdmFyIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMgPSBNUC5Db25maWcuU2Vzc2lvblRpbWVvdXQgKiA2MDAwMDtcblxuICAgICAgICBpZiAobmV3IERhdGUoKSA+IG5ldyBEYXRlKE1QLmRhdGVMYXN0RXZlbnRTZW50LmdldFRpbWUoKSArIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMpKSB7XG4gICAgICAgICAgICB0aGlzLmVuZFNlc3Npb24oKTtcbiAgICAgICAgICAgIHRoaXMuc3RhcnROZXdTZXNzaW9uKCk7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnN0YXJ0TmV3U2Vzc2lvbigpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0U2Vzc2lvbigpIHtcbiAgICByZXR1cm4gTVAuc2Vzc2lvbklkO1xufVxuXG5mdW5jdGlvbiBzdGFydE5ld1Nlc3Npb24oKSB7XG4gICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLlN0YXJ0aW5nTmV3U2Vzc2lvbik7XG5cbiAgICBpZiAoSGVscGVycy5jYW5Mb2coKSkge1xuICAgICAgICBJZGVudGl0eUFQSS5pZGVudGlmeShNUC5pbml0aWFsSWRlbnRpZnlSZXF1ZXN0LCBtUGFydGljbGUuaWRlbnRpdHlDYWxsYmFjayk7XG4gICAgICAgIE1QLmlkZW50aWZ5Q2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgTVAuc2Vzc2lvbklkID0gSGVscGVycy5nZW5lcmF0ZVVuaXF1ZUlkKCk7XG4gICAgICAgIGlmIChNUC5tcGlkKSB7XG4gICAgICAgICAgICBNUC5jdXJyZW50U2Vzc2lvbk1QSURzID0gW01QLm1waWRdO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFNUC5zZXNzaW9uU3RhcnREYXRlKSB7XG4gICAgICAgICAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBNUC5zZXNzaW9uU3RhcnREYXRlID0gZGF0ZTtcbiAgICAgICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gZGF0ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIG1QYXJ0aWNsZS5zZXNzaW9uTWFuYWdlci5zZXRTZXNzaW9uVGltZXIoKTtcblxuICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uU3RhcnQpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgSGVscGVycy5sb2dEZWJ1ZyhNZXNzYWdlcy5JbmZvcm1hdGlvbk1lc3NhZ2VzLkFiYW5kb25TdGFydFNlc3Npb24pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW5kU2Vzc2lvbihvdmVycmlkZSkge1xuICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5TdGFydGluZ0VuZFNlc3Npb24pO1xuXG4gICAgaWYgKG92ZXJyaWRlKSB7XG4gICAgICAgIGxvZ0V2ZW50KFR5cGVzLk1lc3NhZ2VUeXBlLlNlc3Npb25FbmQpO1xuXG4gICAgICAgIE1QLnNlc3Npb25JZCA9IG51bGw7XG4gICAgICAgIE1QLmRhdGVMYXN0RXZlbnRTZW50ID0gbnVsbDtcbiAgICAgICAgTVAuc2Vzc2lvbkF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgfSBlbHNlIGlmIChIZWxwZXJzLmNhbkxvZygpKSB7XG4gICAgICAgIHZhciBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzLFxuICAgICAgICAgICAgY29va2llcyxcbiAgICAgICAgICAgIHRpbWVTaW5jZUxhc3RFdmVudFNlbnQ7XG5cbiAgICAgICAgY29va2llcyA9IFBlcnNpc3RlbmNlLmdldENvb2tpZSgpIHx8IFBlcnNpc3RlbmNlLmdldExvY2FsU3RvcmFnZSgpO1xuXG4gICAgICAgIGlmICghY29va2llcy5ncy5zaWQpIHtcbiAgICAgICAgICAgIEhlbHBlcnMubG9nRGVidWcoTWVzc2FnZXMuSW5mb3JtYXRpb25NZXNzYWdlcy5Ob1Nlc3Npb25Ub0VuZCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBzZXNzaW9uSWQgaXMgbm90IGVxdWFsIHRvIGNvb2tpZXMuc2lkIGlmIGNvb2tpZXMuc2lkIGlzIGNoYW5nZWQgaW4gYW5vdGhlciB0YWJcbiAgICAgICAgaWYgKGNvb2tpZXMuZ3Muc2lkICYmIE1QLnNlc3Npb25JZCAhPT0gY29va2llcy5ncy5zaWQpIHtcbiAgICAgICAgICAgIE1QLnNlc3Npb25JZCA9IGNvb2tpZXMuZ3Muc2lkO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvb2tpZXMgJiYgY29va2llcy5ncyAmJiBjb29raWVzLmdzLmxlcykge1xuICAgICAgICAgICAgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcyA9IE1QLkNvbmZpZy5TZXNzaW9uVGltZW91dCAqIDYwMDAwO1xuICAgICAgICAgICAgdmFyIG5ld0RhdGUgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgICAgICAgIHRpbWVTaW5jZUxhc3RFdmVudFNlbnQgPSBuZXdEYXRlIC0gY29va2llcy5ncy5sZXM7XG5cbiAgICAgICAgICAgIGlmICh0aW1lU2luY2VMYXN0RXZlbnRTZW50IDwgc2Vzc2lvblRpbWVvdXRJbk1pbGxpc2Vjb25kcykge1xuICAgICAgICAgICAgICAgIHNldFNlc3Npb25UaW1lcigpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBsb2dFdmVudChUeXBlcy5NZXNzYWdlVHlwZS5TZXNzaW9uRW5kKTtcblxuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25JZCA9IG51bGw7XG4gICAgICAgICAgICAgICAgTVAuZGF0ZUxhc3RFdmVudFNlbnQgPSBudWxsO1xuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25TdGFydERhdGUgPSBudWxsO1xuICAgICAgICAgICAgICAgIE1QLnNlc3Npb25BdHRyaWJ1dGVzID0ge307XG4gICAgICAgICAgICAgICAgUGVyc2lzdGVuY2UudXBkYXRlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBIZWxwZXJzLmxvZ0RlYnVnKE1lc3NhZ2VzLkluZm9ybWF0aW9uTWVzc2FnZXMuQWJhbmRvbkVuZFNlc3Npb24pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0U2Vzc2lvblRpbWVyKCkge1xuICAgIHZhciBzZXNzaW9uVGltZW91dEluTWlsbGlzZWNvbmRzID0gTVAuQ29uZmlnLlNlc3Npb25UaW1lb3V0ICogNjAwMDA7XG5cbiAgICBNUC5nbG9iYWxUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBtUGFydGljbGUuc2Vzc2lvbk1hbmFnZXIuZW5kU2Vzc2lvbigpO1xuICAgIH0sIHNlc3Npb25UaW1lb3V0SW5NaWxsaXNlY29uZHMpO1xufVxuXG5mdW5jdGlvbiByZXNldFNlc3Npb25UaW1lcigpIHtcbiAgICBpZiAoIUhlbHBlcnMuc2hvdWxkVXNlTmF0aXZlU2RrKCkpIHtcbiAgICAgICAgaWYgKCFNUC5zZXNzaW9uSWQpIHtcbiAgICAgICAgICAgIHN0YXJ0TmV3U2Vzc2lvbigpO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyU2Vzc2lvblRpbWVvdXQoKTtcbiAgICAgICAgc2V0U2Vzc2lvblRpbWVyKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjbGVhclNlc3Npb25UaW1lb3V0KCkge1xuICAgIGNsZWFyVGltZW91dChNUC5nbG9iYWxUaW1lcik7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGluaXRpYWxpemU6IGluaXRpYWxpemUsXG4gICAgZ2V0U2Vzc2lvbjogZ2V0U2Vzc2lvbixcbiAgICBzdGFydE5ld1Nlc3Npb246IHN0YXJ0TmV3U2Vzc2lvbixcbiAgICBlbmRTZXNzaW9uOiBlbmRTZXNzaW9uLFxuICAgIHNldFNlc3Npb25UaW1lcjogc2V0U2Vzc2lvblRpbWVyLFxuICAgIHJlc2V0U2Vzc2lvblRpbWVyOiByZXNldFNlc3Npb25UaW1lcixcbiAgICBjbGVhclNlc3Npb25UaW1lb3V0OiBjbGVhclNlc3Npb25UaW1lb3V0XG59O1xuIiwidmFyIE1lc3NhZ2VUeXBlID0ge1xuICAgIFNlc3Npb25TdGFydDogMSxcbiAgICBTZXNzaW9uRW5kOiAyLFxuICAgIFBhZ2VWaWV3OiAzLFxuICAgIFBhZ2VFdmVudDogNCxcbiAgICBDcmFzaFJlcG9ydDogNSxcbiAgICBPcHRPdXQ6IDYsXG4gICAgQXBwU3RhdGVUcmFuc2l0aW9uOiAxMCxcbiAgICBQcm9maWxlOiAxNCxcbiAgICBDb21tZXJjZTogMTZcbn07XG5cbnZhciBFdmVudFR5cGUgPSB7XG4gICAgVW5rbm93bjogMCxcbiAgICBOYXZpZ2F0aW9uOiAxLFxuICAgIExvY2F0aW9uOiAyLFxuICAgIFNlYXJjaDogMyxcbiAgICBUcmFuc2FjdGlvbjogNCxcbiAgICBVc2VyQ29udGVudDogNSxcbiAgICBVc2VyUHJlZmVyZW5jZTogNixcbiAgICBTb2NpYWw6IDcsXG4gICAgT3RoZXI6IDgsXG4gICAgZ2V0TmFtZTogZnVuY3Rpb24oaWQpIHtcbiAgICAgICAgc3dpdGNoIChpZCkge1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuTmF2aWdhdGlvbjpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ05hdmlnYXRpb24nO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuTG9jYXRpb246XG4gICAgICAgICAgICAgICAgcmV0dXJuICdMb2NhdGlvbic7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5TZWFyY2g6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdTZWFyY2gnO1xuICAgICAgICAgICAgY2FzZSBFdmVudFR5cGUuVHJhbnNhY3Rpb246XG4gICAgICAgICAgICAgICAgcmV0dXJuICdUcmFuc2FjdGlvbic7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5Vc2VyQ29udGVudDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1VzZXIgQ29udGVudCc7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5Vc2VyUHJlZmVyZW5jZTpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1VzZXIgUHJlZmVyZW5jZSc7XG4gICAgICAgICAgICBjYXNlIEV2ZW50VHlwZS5Tb2NpYWw6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdTb2NpYWwnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0QWRkVG9DYXJ0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBBZGRlZCB0byBDYXJ0JztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdEFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IEFkZGVkIHRvIFdpc2hsaXN0JztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdENoZWNrb3V0OlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvZHVjdCBDaGVja291dCc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDaGVja291dE9wdGlvbjpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgQ2hlY2tvdXQgT3B0aW9ucyc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RDbGljazpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgQ2xpY2snO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0SW1wcmVzc2lvbjpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgSW1wcmVzc2lvbic7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb2R1Y3RQdXJjaGFzZTpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgUHVyY2hhc2VkJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlZnVuZDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgUmVmdW5kZWQnO1xuICAgICAgICAgICAgY2FzZSBDb21tZXJjZUV2ZW50VHlwZS5Qcm9kdWN0UmVtb3ZlRnJvbUNhcnQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IFJlbW92ZWQgRnJvbSBDYXJ0JztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFJlbW92ZUZyb21XaXNobGlzdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb2R1Y3QgUmVtb3ZlZCBmcm9tIFdpc2hsaXN0JztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvZHVjdFZpZXdEZXRhaWw6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdQcm9kdWN0IFZpZXcgRGV0YWlscyc7XG4gICAgICAgICAgICBjYXNlIENvbW1lcmNlRXZlbnRUeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgICAgIHJldHVybiAnUHJvbW90aW9uIENsaWNrJztcbiAgICAgICAgICAgIGNhc2UgQ29tbWVyY2VFdmVudFR5cGUuUHJvbW90aW9uVmlldzpcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1Byb21vdGlvbiBWaWV3JztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuICdPdGhlcic7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vLyBDb250aW51YXRpb24gb2YgZW51bSBhYm92ZSwgYnV0IGluIHNlcGVyYXRlIG9iamVjdCBzaW5jZSB3ZSBkb24ndCBleHBvc2UgdGhlc2UgdG8gZW5kIHVzZXJcbnZhciBDb21tZXJjZUV2ZW50VHlwZSA9IHtcbiAgICBQcm9kdWN0QWRkVG9DYXJ0OiAxMCxcbiAgICBQcm9kdWN0UmVtb3ZlRnJvbUNhcnQ6IDExLFxuICAgIFByb2R1Y3RDaGVja291dDogMTIsXG4gICAgUHJvZHVjdENoZWNrb3V0T3B0aW9uOiAxMyxcbiAgICBQcm9kdWN0Q2xpY2s6IDE0LFxuICAgIFByb2R1Y3RWaWV3RGV0YWlsOiAxNSxcbiAgICBQcm9kdWN0UHVyY2hhc2U6IDE2LFxuICAgIFByb2R1Y3RSZWZ1bmQ6IDE3LFxuICAgIFByb21vdGlvblZpZXc6IDE4LFxuICAgIFByb21vdGlvbkNsaWNrOiAxOSxcbiAgICBQcm9kdWN0QWRkVG9XaXNobGlzdDogMjAsXG4gICAgUHJvZHVjdFJlbW92ZUZyb21XaXNobGlzdDogMjEsXG4gICAgUHJvZHVjdEltcHJlc3Npb246IDIyXG59O1xuXG52YXIgSWRlbnRpdHlUeXBlID0ge1xuICAgIE90aGVyOiAwLFxuICAgIEN1c3RvbWVySWQ6IDEsXG4gICAgRmFjZWJvb2s6IDIsXG4gICAgVHdpdHRlcjogMyxcbiAgICBHb29nbGU6IDQsXG4gICAgTWljcm9zb2Z0OiA1LFxuICAgIFlhaG9vOiA2LFxuICAgIEVtYWlsOiA3LFxuICAgIEZhY2Vib29rQ3VzdG9tQXVkaWVuY2VJZDogOSxcbiAgICBPdGhlcjI6IDEwLFxuICAgIE90aGVyMzogMTEsXG4gICAgT3RoZXI0OiAxMlxufTtcblxuSWRlbnRpdHlUeXBlLmlzVmFsaWQgPSBmdW5jdGlvbihpZGVudGl0eVR5cGUpIHtcbiAgICBpZiAodHlwZW9mIGlkZW50aXR5VHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBJZGVudGl0eVR5cGUpIHtcbiAgICAgICAgICAgIGlmIChJZGVudGl0eVR5cGUuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICAgICAgICAgICAgICBpZiAoSWRlbnRpdHlUeXBlW3Byb3BdID09PSBpZGVudGl0eVR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufTtcblxuSWRlbnRpdHlUeXBlLmdldE5hbWUgPSBmdW5jdGlvbihpZGVudGl0eVR5cGUpIHtcbiAgICBzd2l0Y2ggKGlkZW50aXR5VHlwZSkge1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLkN1c3RvbWVySWQ6XG4gICAgICAgICAgICByZXR1cm4gJ0N1c3RvbWVyIElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5GYWNlYm9vazpcbiAgICAgICAgICAgIHJldHVybiAnRmFjZWJvb2sgSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLlR3aXR0ZXI6XG4gICAgICAgICAgICByZXR1cm4gJ1R3aXR0ZXIgSUQnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLkdvb2dsZTpcbiAgICAgICAgICAgIHJldHVybiAnR29vZ2xlIElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5NaWNyb3NvZnQ6XG4gICAgICAgICAgICByZXR1cm4gJ01pY3Jvc29mdCBJRCc7XG4gICAgICAgIGNhc2Ugd2luZG93Lm1QYXJ0aWNsZS5JZGVudGl0eVR5cGUuWWFob286XG4gICAgICAgICAgICByZXR1cm4gJ1lhaG9vIElEJztcbiAgICAgICAgY2FzZSB3aW5kb3cubVBhcnRpY2xlLklkZW50aXR5VHlwZS5FbWFpbDpcbiAgICAgICAgICAgIHJldHVybiAnRW1haWwnO1xuICAgICAgICBjYXNlIHdpbmRvdy5tUGFydGljbGUuSWRlbnRpdHlUeXBlLkZhY2Vib29rQ3VzdG9tQXVkaWVuY2VJZDpcbiAgICAgICAgICAgIHJldHVybiAnRmFjZWJvb2sgQXBwIFVzZXIgSUQnO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICdPdGhlciBJRCc7XG4gICAgfVxufTtcblxuSWRlbnRpdHlUeXBlLmdldElkZW50aXR5VHlwZSA9IGZ1bmN0aW9uKGlkZW50aXR5TmFtZSkge1xuICAgIHN3aXRjaCAoaWRlbnRpdHlOYW1lKSB7XG4gICAgICAgIGNhc2UgJ290aGVyJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuT3RoZXI7XG4gICAgICAgIGNhc2UgJ2N1c3RvbWVyaWQnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5DdXN0b21lcklkO1xuICAgICAgICBjYXNlICdmYWNlYm9vayc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLkZhY2Vib29rO1xuICAgICAgICBjYXNlICd0d2l0dGVyJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuVHdpdHRlcjtcbiAgICAgICAgY2FzZSAnZ29vZ2xlJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuR29vZ2xlO1xuICAgICAgICBjYXNlICdtaWNyb3NvZnQnOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5NaWNyb3NvZnQ7XG4gICAgICAgIGNhc2UgJ3lhaG9vJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuWWFob287XG4gICAgICAgIGNhc2UgJ2VtYWlsJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuRW1haWw7XG4gICAgICAgIGNhc2UgJ2ZhY2Vib29rY3VzdG9tYXVkaWVuY2VpZCc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLkZhY2Vib29rQ3VzdG9tQXVkaWVuY2VJZDtcbiAgICAgICAgY2FzZSAnb3RoZXIxJzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuT3RoZXIxO1xuICAgICAgICBjYXNlICdvdGhlcjInOlxuICAgICAgICAgICAgcmV0dXJuIElkZW50aXR5VHlwZS5PdGhlcjI7XG4gICAgICAgIGNhc2UgJ290aGVyMyc6XG4gICAgICAgICAgICByZXR1cm4gSWRlbnRpdHlUeXBlLk90aGVyMztcbiAgICAgICAgY2FzZSAnb3RoZXI0JzpcbiAgICAgICAgICAgIHJldHVybiBJZGVudGl0eVR5cGUuT3RoZXI0O1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn07XG5cbklkZW50aXR5VHlwZS5nZXRJZGVudGl0eU5hbWUgPSBmdW5jdGlvbihpZGVudGl0eVR5cGUpIHtcbiAgICBzd2l0Y2ggKGlkZW50aXR5VHlwZSkge1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5PdGhlcjpcbiAgICAgICAgICAgIHJldHVybiAnb3RoZXInO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5DdXN0b21lcklkOlxuICAgICAgICAgICAgcmV0dXJuICdjdXN0b21lcmlkJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuRmFjZWJvb2s6XG4gICAgICAgICAgICByZXR1cm4gJ2ZhY2Vib29rJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuVHdpdHRlcjpcbiAgICAgICAgICAgIHJldHVybiAndHdpdHRlcic7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLkdvb2dsZTpcbiAgICAgICAgICAgIHJldHVybiAnZ29vZ2xlJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuTWljcm9zb2Z0OlxuICAgICAgICAgICAgcmV0dXJuICdtaWNyb3NvZnQnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5ZYWhvbzpcbiAgICAgICAgICAgIHJldHVybiAneWFob28nO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5FbWFpbDpcbiAgICAgICAgICAgIHJldHVybiAnZW1haWwnO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5GYWNlYm9va0N1c3RvbUF1ZGllbmNlSWQ6XG4gICAgICAgICAgICByZXR1cm4gJ2ZhY2Vib29rY3VzdG9tYXVkaWVuY2VpZCc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk90aGVyMTpcbiAgICAgICAgICAgIHJldHVybiAnb3RoZXIxJztcbiAgICAgICAgY2FzZSBJZGVudGl0eVR5cGUuT3RoZXIyOlxuICAgICAgICAgICAgcmV0dXJuICdvdGhlcjInO1xuICAgICAgICBjYXNlIElkZW50aXR5VHlwZS5PdGhlcjM6XG4gICAgICAgICAgICByZXR1cm4gJ290aGVyMyc7XG4gICAgICAgIGNhc2UgSWRlbnRpdHlUeXBlLk90aGVyNDpcbiAgICAgICAgICAgIHJldHVybiAnb3RoZXI0JztcbiAgICB9XG59O1xuXG52YXIgUHJvZHVjdEFjdGlvblR5cGUgPSB7XG4gICAgVW5rbm93bjogMCxcbiAgICBBZGRUb0NhcnQ6IDEsXG4gICAgUmVtb3ZlRnJvbUNhcnQ6IDIsXG4gICAgQ2hlY2tvdXQ6IDMsXG4gICAgQ2hlY2tvdXRPcHRpb246IDQsXG4gICAgQ2xpY2s6IDUsXG4gICAgVmlld0RldGFpbDogNixcbiAgICBQdXJjaGFzZTogNyxcbiAgICBSZWZ1bmQ6IDgsXG4gICAgQWRkVG9XaXNobGlzdDogOSxcbiAgICBSZW1vdmVGcm9tV2lzaGxpc3Q6IDEwXG59O1xuXG5Qcm9kdWN0QWN0aW9uVHlwZS5nZXROYW1lID0gZnVuY3Rpb24oaWQpIHtcbiAgICBzd2l0Y2ggKGlkKSB7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9DYXJ0OlxuICAgICAgICAgICAgcmV0dXJuICdBZGQgdG8gQ2FydCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUmVtb3ZlRnJvbUNhcnQ6XG4gICAgICAgICAgICByZXR1cm4gJ1JlbW92ZSBmcm9tIENhcnQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICByZXR1cm4gJ0NoZWNrb3V0IE9wdGlvbic7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ0NsaWNrJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5WaWV3RGV0YWlsOlxuICAgICAgICAgICAgcmV0dXJuICdWaWV3IERldGFpbCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUHVyY2hhc2U6XG4gICAgICAgICAgICByZXR1cm4gJ1B1cmNoYXNlJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZWZ1bmQ6XG4gICAgICAgICAgICByZXR1cm4gJ1JlZnVuZCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQWRkVG9XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAnQWRkIHRvIFdpc2hsaXN0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ1JlbW92ZSBmcm9tIFdpc2hsaXN0JztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XG4gICAgfVxufTtcblxuLy8gdGhlc2UgYXJlIHRoZSBhY3Rpb24gbmFtZXMgdXNlZCBieSBzZXJ2ZXIgYW5kIG1vYmlsZSBTREtzIHdoZW4gZXhwYW5kaW5nIGEgQ29tbWVyY2VFdmVudFxuUHJvZHVjdEFjdGlvblR5cGUuZ2V0RXhwYW5zaW9uTmFtZSA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgc3dpdGNoIChpZCkge1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnQWRkVG9DYXJ0JztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5SZW1vdmVGcm9tQ2FydDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlRnJvbUNhcnQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkNoZWNrb3V0OlxuICAgICAgICAgICAgcmV0dXJuICdDaGVja291dCc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuQ2hlY2tvdXRPcHRpb246XG4gICAgICAgICAgICByZXR1cm4gJ0NoZWNrb3V0T3B0aW9uJztcbiAgICAgICAgY2FzZSBQcm9kdWN0QWN0aW9uVHlwZS5DbGljazpcbiAgICAgICAgICAgIHJldHVybiAnQ2xpY2snO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlZpZXdEZXRhaWw6XG4gICAgICAgICAgICByZXR1cm4gJ1ZpZXdEZXRhaWwnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlB1cmNoYXNlOlxuICAgICAgICAgICAgcmV0dXJuICdQdXJjaGFzZSc7XG4gICAgICAgIGNhc2UgUHJvZHVjdEFjdGlvblR5cGUuUmVmdW5kOlxuICAgICAgICAgICAgcmV0dXJuICdSZWZ1bmQnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLkFkZFRvV2lzaGxpc3Q6XG4gICAgICAgICAgICByZXR1cm4gJ0FkZFRvV2lzaGxpc3QnO1xuICAgICAgICBjYXNlIFByb2R1Y3RBY3Rpb25UeXBlLlJlbW92ZUZyb21XaXNobGlzdDpcbiAgICAgICAgICAgIHJldHVybiAnUmVtb3ZlRnJvbVdpc2hsaXN0JztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XG4gICAgfVxufTtcblxudmFyIFByb21vdGlvbkFjdGlvblR5cGUgPSB7XG4gICAgVW5rbm93bjogMCxcbiAgICBQcm9tb3Rpb25WaWV3OiAxLFxuICAgIFByb21vdGlvbkNsaWNrOiAyXG59O1xuXG5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldE5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvblZpZXc6XG4gICAgICAgICAgICByZXR1cm4gJ1Byb21vdGlvbiBWaWV3JztcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvbkNsaWNrOlxuICAgICAgICAgICAgcmV0dXJuICdQcm9tb3Rpb24gQ2xpY2snO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuICdVbmtub3duJztcbiAgICB9XG59O1xuXG4vLyB0aGVzZSBhcmUgdGhlIG5hbWVzIHRoYXQgdGhlIHNlcnZlciBhbmQgbW9iaWxlIFNES3MgdXNlIHdoaWxlIGV4cGFuZGluZyBDb21tZXJjZUV2ZW50XG5Qcm9tb3Rpb25BY3Rpb25UeXBlLmdldEV4cGFuc2lvbk5hbWUgPSBmdW5jdGlvbihpZCkge1xuICAgIHN3aXRjaCAoaWQpIHtcbiAgICAgICAgY2FzZSBQcm9tb3Rpb25BY3Rpb25UeXBlLlByb21vdGlvblZpZXc6XG4gICAgICAgICAgICByZXR1cm4gJ3ZpZXcnO1xuICAgICAgICBjYXNlIFByb21vdGlvbkFjdGlvblR5cGUuUHJvbW90aW9uQ2xpY2s6XG4gICAgICAgICAgICByZXR1cm4gJ2NsaWNrJztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XG4gICAgfVxufTtcblxudmFyIFByb2ZpbGVNZXNzYWdlVHlwZSA9IHtcbiAgICBMb2dvdXQ6IDNcbn07XG52YXIgQXBwbGljYXRpb25UcmFuc2l0aW9uVHlwZSA9IHtcbiAgICBBcHBJbml0OiAxXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBNZXNzYWdlVHlwZTogTWVzc2FnZVR5cGUsXG4gICAgRXZlbnRUeXBlOiBFdmVudFR5cGUsXG4gICAgQ29tbWVyY2VFdmVudFR5cGU6IENvbW1lcmNlRXZlbnRUeXBlLFxuICAgIElkZW50aXR5VHlwZTogSWRlbnRpdHlUeXBlLFxuICAgIFByb2ZpbGVNZXNzYWdlVHlwZTogUHJvZmlsZU1lc3NhZ2VUeXBlLFxuICAgIEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGU6IEFwcGxpY2F0aW9uVHJhbnNpdGlvblR5cGUsXG4gICAgUHJvZHVjdEFjdGlvblR5cGU6UHJvZHVjdEFjdGlvblR5cGUsXG4gICAgUHJvbW90aW9uQWN0aW9uVHlwZTpQcm9tb3Rpb25BY3Rpb25UeXBlXG59O1xuIl19
