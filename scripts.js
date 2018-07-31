/* eslint-disable no-undef */
var initialIdentity = { userIdentities: {}};
var userIdentitiesInput = initialIdentity;
var userIdentitiesForApiRequest;
var apiRequest;
var apiRequestCopy;

var callback = function(resp) {
    console.log('resp');
    console.log('resp');
    console.log('resp');
    console.log(resp);
};

mParticle.config.identityCallback = callback;
$('.build').click(function() {
    var email = $('#email').val();
    var customerId = $('#customerId').val();
    var other = $('#userIdentityType').val();
    var functionText = $('#function').val();

    var function1 = new Function('oldUser', 'newUser', functionText);

    if (functionText) {
        userIdentitiesInput.onUserAlias = function1;
    }
    if (email) {
        userIdentitiesInput.userIdentities.email = email;
    } else {
        delete userIdentitiesInput.userIdentities.email;
    }
    if (customerId) {
        userIdentitiesInput.userIdentities.customerid = customerId;
    } else {
        delete userIdentitiesInput.userIdentities.customerid;
    }
    if (other) {
        userIdentitiesInput.userIdentities[other] = $('#userIdentityValue').val();
    } else {
        delete userIdentitiesInput.userIdentities[other];
    }

    userIdentitiesForApiRequest = userIdentitiesInput || {};
    userIdentitiesInput = initialIdentity;
    apiRequest = {
        apiKey: 'beab3f4d34281d45bfcdbbd7eb21c083',
        initialIdentity: userIdentitiesForApiRequest
    };

    apiRequestCopy = apiRequest;
    apiRequest = {};

    showUserIdentity();
    setTimeout(function() {
        refreshCartProductDisplay();
    }, 500);
});

$('.addProductToCart').click(function() {
    var name = $('#productName').val();
    var sku = $('#productSKU').val();
    var price = $('#productPrice').val();

    mParticle.eCommerce.Cart.add(mParticle.eCommerce.createProduct(name, sku, price));
    refreshCartProductDisplay();
});

$('.logEvent').click(function() {
    mParticle.logEvent('Test Event');
});

function showUserIdentity() {
    $('.apiRequestData').html(JSON.stringify(apiRequestCopy, undefined, 2));
}

$('.setUserAttribute').click(function() {
    var userAttributeKey = $('#userAttributeKey').val();
    var userAttributeValue = $('#userAttributeValue').val();

    mParticle.Identity.getCurrentUser().setUserAttribute(userAttributeKey, userAttributeValue);
    refresh();
});

$('.clearIdentities').click(function() {
    for (key in userIdentitiesInput.userIdentities) {
        delete userIdentitiesInput.userIdentities[key];
    }
});

$('.logout').click(function(){
    window.console.log('Attempt to log logout');
    mParticle.Identity.logout(userIdentitiesForApiRequest, callback);
    refresh();
});

$('.login').click(function(){
    window.console.log('Attempt to log login');
    mParticle.Identity.login(userIdentitiesForApiRequest, callback);
    refresh();
});

$('.modify').click(function(){
    window.console.log('Attempt to log modify');
    mParticle.Identity.modify(userIdentitiesForApiRequest, refresh);
});

$('.init').click(function(){
    window.console.log('Attempt to log modify');
    mParticle.init(apiKey);
    refresh();
});

$('.logPageView').click(function(){
    window.console.log('Attempt to log page view');
    mParticle.logPageView();
});

refresh();
refreshCartProductDisplay();
function refresh() {
    // setTimeout(function() {
    //     var data = mParticle.persistence.getCookie() || mParticle.persistence.getLocalStorage();
    //     var currentSessionMPIDs;
    //     var currentUserMPID;
    //     if (data.gs) {
    //         currentSessionMPIDs = data.gs.csm;
    //         currentUserMPID = data.cu;
    //     } else if (data.globalSettings) {
    //         currentSessionMPIDs = data.globalSettings.currentSessionMPIDs;
    //         currentUserMPID = data.currentUserMPID;
    //     }
    //     currentSessionMPIDsHTML = '';
    //     if (currentSessionMPIDs) {
    //         currentSessionMPIDs.forEach(function(mpid) {
    //             window.console.log('mpid', mpid);
    //             currentSessionMPIDsHTML += ('<li>' + mpid + '</li>');
    //         });
    //     }
    //     $('.currentSessionMPIDs').html(currentSessionMPIDsHTML);
    //     $('.currentUserMPID').html(currentUserMPID);
    //
    //     $('.cookies').html(JSON.stringify(data, undefined, 2));
    // }, 400);
}


function refreshCartProductDisplay() {
    // var products = JSON.parse(atob(localStorage.getItem('mprtcl-prodv4')));
    // $('.cartProducts').html(JSON.stringify(products, undefined, 2));
}
