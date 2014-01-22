var fs = require('fs');

var lib = require('./lib/presto-client');
lib.version = JSON.parse(fs.readFileSync(__dirname + '/package.json')).version;

exports.Client = lib.Client;
