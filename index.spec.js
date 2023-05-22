var { beforeAll, describe, expect, test } = require('@jest/globals');
var { GenericContainer, Wait } = require('testcontainers');
var Client = require('./index').Client;

describe.each([
  ['presto', 'ahanaio/prestodb-sandbox:0.281'],
  ['trino', 'trinodb/trino:418'],
])('%s', (engine, image) => {
  var container;
  beforeAll(async () => {
    container = await new GenericContainer(image)
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forLogMessage('SERVER STARTED'))
      .start();
  }, 60000);

  afterAll(() => {
    if (container) {
      container.stop()
    }
  });

  test('simple query', (done) => {
    expect.assertions(5);
    var client = new Client({
      host: container.getHost(),
      port: container.getMappedPort(8080),
      catalog: 'tpch',
      schema: 'tiny',
      engine,
    });
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
});
