var express = require('express');
var app = express();

app.use(express.static(__dirname));
module.exports = app;
var server = app.listen(8081, function() {
  console.log('express server listening on port ' + server.address().port);

});
