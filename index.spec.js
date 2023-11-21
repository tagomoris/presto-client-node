// Before running the tests, make sure to start the docker containers

var { beforeAll, beforeEach, afterAll, describe, expect, test } = require('@jest/globals');
var http = require('http');
var Client = require('./index').Client;

test('cannot use basic and custom auth', function(){
  expect(function(){
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

describe('execute errors', function(){
  const client = new Client();

  test('error if do not define success or callback', function(){
    expect(function() {
      client.execute({
        query: 'SELECT 1',
        error: () => {},
      });
    }).toThrow(new Error("callback function 'success' (or 'callback') not specified"));
  });

  test('error if do not define error or callback', function(){
    expect(function() {
      client.execute({
        query: 'SELECT 1',
        success: () => {},
      })
    }).toThrow(new Error("callback function 'error' (or 'callback') not specified"));
  });

  test('error if schema provided and not catalog', function() {
    expect(function() {
      client.execute({
        query: 'SELECT 1',
        schema: 'test',
        callback: () => {},
      });
    }).toThrow(new Error('Catalog not specified; catalog is required if schema is specified'))
  })
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

  test('query with no text', function(done){
    expect.assertions(1);
    client.execute({
      query: '',
      callback: function(error){
        expect(error).toEqual({
          code: 400,
          error: new Error('execution error:SQL statement is empty'),
          message: "execution error:SQL statement is empty",
        });
        done();
      },
    });
  });
});

describe('when server returns non-200 response', function(){
  describe('the client should retry for 50x code', function(){
    describe.each([502, 503, 504])('the client retries for %i code', function(statusCode){
      var responses = {
        '/v1/statement': {
            "stats": {
                "state": "QUEUED",
            },
            "nextUri": "http://localhost:8111/v1/statement/20140120_032523_00000_32v8g/1",
            "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
            "id": "20140120_032523_00000_32v8g",
        },
        '/v1/statement/20140120_032523_00000_32v8g/1': {
          "stats": {
              "state": "FINISHED",
          },
          "columns": [ { "type": "integer", "name": "col" } ],
          "data": [ [ 1 ] ],
          "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
          "id": "20140120_032523_00000_32v8g"
        }
      };

      var server;
      var count;

      beforeAll(function(done) {
        server = http.createServer(function(req, res){
          if (count % 2 === 0) {
            res.statusCode = statusCode;
          } else {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify(responses[req.url]));
          }
          count++;
          res.end();
        });
        server.listen(8111, function(){
          done();
        });
      });

      beforeEach(function(){
        count = 0;
      });

      afterAll(function(done){
        server.close(function(){
          done();
        });
      });

      test('the client returns success', function(done){
        expect.assertions(7);
        var client = new Client({
          host: 'localhost',
          port: 8111,
        });
        client.execute({
          query: 'SELECT 1 AS col',
          data: function(error, data, columns){
            expect(error).toBeNull();
            expect(data).toEqual([[1]]);
            expect(columns).toHaveLength(1);
            expect(columns[0]).toEqual(expect.objectContaining({ name: 'col', type: 'integer' }));
          },
          retry: function(){
            // this should be called twice
            expect(true).toBe(true);
          },
          callback: function(error){
            expect(error).toBeNull();
            done();
          },
        });
      });
    });
  });

  describe.each([404, 500])('the client fails for %i code', function(statusCode){
    describe.each([0, 1])('the client fails after %i requests', function(failAfter){
      var responses = {
        '/v1/statement': {
            "stats": {
                "state": "QUEUED",
            },
            "nextUri": "http://localhost:8111/v1/statement/20140120_032523_00000_32v8g/1",
            "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
            "id": "20140120_032523_00000_32v8g",
        },
        '/v1/statement/20140120_032523_00000_32v8g/1': {
          "stats": {
              "state": "FINISHED",
          },
          "columns": [ { "type": "integer", "name": "col" } ],
          "data": [ [ 1 ] ],
          "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
          "id": "20140120_032523_00000_32v8g"
        }
      };

      var server;
      var count;

      beforeAll(function(done) {
        server = http.createServer(function(req, res){
          if (count === failAfter) {
            res.statusCode = statusCode;
          } else {
            count++;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify(responses[req.url]));
          }
          res.end();
        });
        server.listen(8111, function(){
          done();
        });
      });

      beforeEach(function(){
        count = 0;
      });

      afterAll(function(done){
        server.close(function(){
          done();
        });
      });

      test('the client returns error', function(done){
        expect.assertions(1);
        var client = new Client({
          host: 'localhost',
          port: 8111,
        });
        client.execute({
          query: 'SELECT 1 AS col',
          data: function(){
            done('should not have data');
          },
          callback: function(error){
            const errorObj = new Error('execution error:invalid response code (' + statusCode + ')');
            expect(error).toEqual(failAfter === 0 ? {
              "code": statusCode,
              "error": errorObj,
              "message": "execution error",
            } : errorObj);
            done();
          },
        });
      });
    });
  });
});

describe('when server returns invalid json with 200 code', function(){
  beforeAll(function(done) {
    server = http.createServer(function(req, res){
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.write('this is invalid{json}');
      res.end();
    });
    server.listen(8111, function(){
      done();
    });
  });

  afterAll(function(done){
    server.close(function(){
      done();
    });
  });
  test('client returns error', function(done){
    expect.assertions(1);
    var client = new Client({
      host: 'localhost',
      port: 8111,
    });
    client.execute({
      query: 'SELECT 1',
      data: function(){
        done('no data should have been returned');
      },
      error: function(error){
        expect(error).toEqual({
          code: 200,
          error: new Error("execution error:could not parse response"),
          message: "execution error:this is invalid{json}"
        });
        done();
      },
      success: function(){
        done('success should not have been called');
      },
    });
  });
});

describe('when timeout is set', function(){
  var server;

  beforeAll(function(done) {
    server = http.createServer(function(req, res){
      res.statusCode = 502;
      res.end();
    });
    server.listen(8111, function(){
      done();
    });
  });

  afterAll(function(done){
    server.close(function(){
      done();
    });
  });

  test('the query times out', function(done) {
    expect.assertions(1);
    var client = new Client({
      host: 'localhost',
      port: 8111,
      timeout: 2,
    });
    client.execute({
      query: 'SELECT 1 AS col',
      timeout: 1,
      data: function(){
        done('no data should be returned');
      },
      error: function(error){
        expect(error).toEqual({"message": "execution error:query timed out"});
        done();
      },
      success: function(){
        done('success should not have been called');
      },
    });
  });
});

describe('redirect tests', function(){
  var responses = {
    '/v1/statement': {
        "stats": {
            "state": "QUEUED",
        },
        "nextUri": "http://localhost:8111/redirect",
        "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
        "id": "20140120_032523_00000_32v8g",
    },
    '/v1/statement/20140120_032523_00000_32v8g/1': {
      "stats": {
          "state": "FINISHED",
      },
      "columns": [ { "type": "integer", "name": "col" } ],
      "data": [ [ 1 ] ],
      "infoUri": "http://localhost:8111/v1/query/20140120_032523_00000_32v8g",
      "id": "20140120_032523_00000_32v8g"
    }
  };

  var server;

  beforeAll(function(done) {
    server = http.createServer(function(req, res){
      if (responses[req.url]) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify(responses[req.url]));
      } else if (req.url === '/redirect') {
        res.statusCode = 301;
        res.setHeader('Location', 'http://localhost:8111/v1/statement/20140120_032523_00000_32v8g/1');
      } else {
        res.statusCode = 404;
      }
      res.end();
    });
    server.listen(8111, function(){
      done();
    });
  });

  afterAll(function(done){
    server.close(function(){
      done();
    });
  });

  test('the client follows redirects', function(done) {
    expect.assertions(1);
    var client = new Client({
      host: 'localhost',
      port: 8111,
    });
    client.execute({
      query: 'SELECT 1',
      timeout: 1,
      data: function(_, data){
        expect(data).toEqual([[1]]);
      },
      error: function(error){
        done(error);
      },
      success: function(){
        done();
      },
    });
  });
});
