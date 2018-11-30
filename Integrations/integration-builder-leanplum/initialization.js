function completeLeanPlumInitialization(userAttributes, userIdentities, forwarderSettings) {
    setLeanPlumEnvironment(forwarderSettings);
    initializeUserId(userAttributes, userIdentities, forwarderSettings);
}

function setLeanPlumEnvironment(forwarderSettings) {
    if (window.mParticle.isSandbox) {
        Leanplum.setAppIdForDevelopmentMode(forwarderSettings.appId, forwarderSettings.clientKey);
    }
    else {
        Leanplum.setAppIdForProductionMode(forwarderSettings.appId, forwarderSettings.clientKey);
    }
}

function initializeUserId(userAttributes, userIdentities, forwarderSettings) {
    var user,
        userId = null;

    // if Identity object exists on mParticle, it is on V2 of SDK and we prioritize MPID
    if (window.mParticle && window.mParticle.Identity) {
        if (forwarderSettings.userIdField === 'mpid') {
            user = window.mParticle.Identity.getCurrentUser();
            if (user) {
                userId = user.getMPID();
                Leanplum.start(userId);
                return;
            }
        }
    }

    if (userIdentities.length) {
        if (forwarderSettings.userIdField === 'customerId') {
            userId = userIdentities.filter(function(identity) {
                return (identity.Type === window.mParticle.IdentityType.CustomerId);
            })[0];
        }
        else if (forwarderSettings.userIdField === 'email') {
            userId = userIdentities.filter(function(identity) {
                return (identity.Type === window.mParticle.IdentityType.Email);
            })[0];
        }

        if (userId && userId.Identity && Object.keys(userAttributes).length) {
            Leanplum.start(userId.Identity, userAttributes);
        }
        else if (userId && userId.Identity) {
            Leanplum.start(userId.Identity);
        }
        return;
    }

    Leanplum.start();
}

var initialization = {
    name: 'Leanplum',
    initForwarder: function(forwarderSettings, testMode, userAttributes, userIdentities, processEvent, eventQueue) {
        if (!testMode) {
            var leanplumScript = document.createElement('script');
            leanplumScript.type = 'text/javascript';
            leanplumScript.async = true;
            leanplumScript.src = 'https://www.leanplum.com/static/leanplum.js';
            (document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(leanplumScript);
            leanplumScript.onload = function() {
                var successCallback = function(success) {
                    if (!success) {
                        return 'Failed to initialize: ' + name;
                    }
                    if (Leanplum && eventQueue.length > 0) {
                        // Process any events that may have been queued up while forwarder was being initialized.
                        for (var i = 0; i < eventQueue.length; i++) {
                            processEvent(eventQueue[i]);
                        }

                        eventQueue = [];
                    }
                };
                Leanplum.addStartResponseHandler(successCallback);
                completeLeanPlumInitialization(userAttributes, userIdentities, forwarderSettings);
            };
        }
        else {
            completeLeanPlumInitialization(userAttributes, userIdentities, forwarderSettings);
        }

        return 'Leanplum successfully loaded';
    }
};

module.exports = initialization;
