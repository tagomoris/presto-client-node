// Before running the tests, make sure to start the docker containers

var { describe, expect, test } = require('@jest/globals');
var os = require('os');
var Client = require('./index').Client;

test('cannot use basic and custom auth', function(){
  expect(function() {
    new Client({
      host: 'localhost',
      port: 8080,
      basic_auth: {
        username: 'test',
        password: 'test',
      },
      custom_auth: 'Token abc',
    });
  }).toThrow(new Error('Please do not specify basic_auth and custom_auth at the same time.'));
});

describe.each([['presto'], ['trino']])('%s', function(engine){
  const client = new Client({
    host: 'localhost',
    port: engine === 'presto' ? 18080 : 18081,
    catalog: 'tpch',
    schema: 'tiny',
    engine,
  });

  test('simple query', function(done){
    expect.assertions(5);
    client.execute({
      query: 'SELECT 1 AS col',
      data: function(error, data, columns){
        expect(error).toBeNull();
        expect(data).toEqual([[1]]);
        expect(columns).toHaveLength(1);
        expect(columns[0]).toEqual(expect.objectContaining({ name: 'col', type: 'integer' }));
      },
      callback: function(error){
        expect(error).toBeNull();
        done();
      },
    });
  }, 10000);

  test('query with error', function(done){
    expect.assertions(2);
    client.execute({
      query: 'SELECT * FROM non_existent_table',
      callback: function(error){
        expect(error).not.toBeNull();
        var expectation = (engine === 'presto') ? 'Table tpch.tiny.non_existent_table does not exist' : "line 1:15: Table 'tpch.tiny.non_existent_table' does not exist";
        expect(error.message).toEqual(expectation);
        done();
      },
    });
  });
});
