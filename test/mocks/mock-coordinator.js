var express = require('express');
var data = require('./mock-data');
var app = express();


app.get('/', function (req, res) {
    res.send('OK')
});

app.get('/v1/node', function (req, res) {
    res.send(data.getNode)
});

app.get('/v1/query/20170115_002017_00002_e5y5i', function (req, res) {
    res.send(data.getQuery)
});

app.get('/v1/query/20170115_002017_00002_e5y5j', function (req, res) {
    res.sendStatus(410)
});

app.listen(3000, function () {
    console.log('Mock Presto Coordinator Running on Port 8080.')
});