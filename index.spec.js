var { beforeAll, describe, expect, test } = require('@jest/globals');
var { GenericContainer, Wait } = require('testcontainers');
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

describe.each([
  ['presto', 'ahanaio/prestodb-sandbox:0.281'],
  ['trino', 'trinodb/trino:418'],
])('%s', function(engine, image){
  var container;
  var client;
  beforeAll(function(done){
    new GenericContainer(image)
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forLogMessage('SERVER STARTED'))
      .start().then(function(c){
        container = c;
        client = new Client({
          host: container.getHost(),
          port: container.getMappedPort(8080),
          catalog: 'tpch',
          schema: 'tiny',
          engine,
        });
        done();
      });
  }, 60000);

  afterAll(function(){
    if (container) {
      container.stop()
    }
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
  });

  test('query with error', function(done){
    expect.assertions(2);
    client.execute({
      query: 'SELECT * FROM non_existent_table',
      callback: function(error){
        expect(error).not.toBeNull();
        var tableName = engine === 'presto' ? 'tpch.tiny.non_existent_table' : "'tpch.tiny.non_existent_table'";
        expect(error.message).toEqual('line 1:15: Table ' + tableName + ' does not exist');
        done();
      },
    });
  });
});
