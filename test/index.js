var assert = require('assert');
var mock_data = require('./mocks/mock-data');
var server = require('./mocks/mock-coordinator');

var presto = require('../index');
var client = new presto.Client({user: 'myname', port: 3000, catalog: 'hive', schema: 'default'});

describe('Requests', function() {
    describe('GET Nodes', function() {
        it('Should return presto cluster list.', function(done) {
            client.nodes({}, function(error,data) {
                assert.deepEqual(data,mock_data.getNode,'Get nodes did not return expected data.');
                done()
            })
        });
    });

    describe('GET Query', function() {
        it('Should return query status.', function(done) {
            client.query('20170115_002017_00002_e5y5i', function(error,data) {
                assert.deepEqual(data,mock_data.getQuery,'Get Query did not return expected data.');
                done()
            })
        });

        it('should throw error when server does not respond with 200.', function(done) {
            client.query('20170115_002017_00002_e5y5j', function(error,data) {
                assert.equal(error.code, 410)
                assert(error.message.indexOf('query info api returns error') === 0)
                done()
            })
        });


    });
});
