/*
A non-ecommerce event has the following schema:

{
    DeviceId: "a80eea1c-57f5-4f84-815e-06fe971b6ef2",
    EventAttributes: {test: "Error", t: 'stack trace in string form'},
    EventName: "Error",
    MPID: "123123123123",
    UserAttributes: {userAttr1: 'value1', userAttr2: 'value2'},
    UserIdentities: [{Identity: 'email@gmail.com', Type: 7}]
    User Identity Types can be found here:
}

*/

var eventHandler = {
    logEvent: function(event) {
        if (event.EventAttributes) {
            Leanplum.track(event.EventName, event.EventAttributes);
        }
        else {
            Leanplum.track(event.EventName);
        }
    },
    logError: function(event) {
        // The schema for a logError event is the same, but noteworthy differences are as follows:
        // {
        //     EventAttributes: {m: 'passed name of error passed into MP', s: "Error", t: 'stack trace in string form if applicable'},
        //     EventName: "Error"
        // }
    },
    logPagView: function(event) {
        if (event.EventAttributes) {
            Leanplum.advanceTo(event.EventName, event.EventAttributes);
        }
        else {
            Leanplum.advanceTo(event.EventName);
        }
    }
};

module.exports = eventHandler;
