var http = require('http');

var Headers = require('./headers').Headers;

var QUERY_STATE_CHECK_INTERVAL = 800; // 800ms

exports.version = 'unknown';

var Client = exports.Client = function(args){
  if (!args)
    args = {};
  // exports.version set in index.js of project root
  this.userAgent = 'presto-client-node ' + exports.version;

  this.host = args.host || 'localhost';
  this.port = args.port || 8080;
  this.user = args.user || process.env.USER;

  this.catalog = args.catalog;
  this.schema = args.schema;

  this.checkInterval = args.checkInterval || QUERY_STATE_CHECK_INTERVAL;

  this.jsonParser = args.jsonParser || JSON;
};

Client.prototype.request = function(opts, callback) {
  var client = this;

  var contentBody = null;
  if (opts instanceof Object) {
    opts.host = client.host;
    opts.port = client.port;

    if (! opts.headers)
      opts.headers = {};

    if (client.user)
      opts.headers[Headers.USER] = client.user;

    opts.headers[Headers.USER_AGENT] = this.userAgent;

    if (opts.body)
      contentBody = opts.body;
  }

  var parser = this.jsonParser;

  var req = http.request(opts, function(res){
    var response_code = res.statusCode;
    var response_data = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk){
      response_data += chunk;
    });
    res.on('end', function(){
      var data = response_data;
      if (response_code < 300 && (data[0] === '{' || data[0] === '[')) {
        try { data = parser.parse(data); }
        catch (x) {
          /* ignore json parse error (and don't parse) for non-json content body */
        }
      }
      callback(null, response_code, data);
    });
  });

  req.on('error', function(e){
    callback(e);
  });

  if (contentBody)
    req.write(contentBody);

  req.end();
};

Client.prototype.nodes = function(opts, callback) { // TODO: "failed" nodes not supported yet
  if (! callback) {
    callback = opts;
    opts = {};
  }

  this.request({ method: 'GET', path: '/v1/node' }, function(error, code, data){
    if (error || code !== 200) {
      var message = "node list api returns error" + (data && data.length > 0 ? ":" + data : "");
      callback({message: message, error: error, code: code});
      return;
    }
    callback(null, data);
  });
};

Client.prototype.query = function(query_id, callback) {
  this.request({ method: 'GET', path: '/v1/query/' + query_id }, function(error, code, data){
    if (error || code !== 200) {
      var message = "query info api returns error" + (data && data.length > 0 ? ":" + data : "");
      callback({message: message, error: error, code: code});
      return;
    }
    callback(null, data);
  });
};

Client.prototype.kill = function(query_id, callback) {
  this.request({ method: 'DELETE', path: '/v1/query/' + query_id }, function(error, code, data){
    if (error || code !== 204) {
      var message = "query kill api returns error" + (data && data.length > 0 ? ":" + data : "");
      callback({message: message, error: error, code: code});
      return;
    }
    if (callback)
      callback(null);
  });
};

Client.prototype.execute = function(opts, callback) {
  if (callback)
    this.executeResource(opts, callback);
  else
    this.statementResource(opts);
};

Client.prototype.executeResource = function(opts, callback) {
  var client = this;

  var query = null;
  if (opts instanceof Object) {
    query = opts.query;
  } else { // opts is query string itself
    query = opts;
    opts = {};
  }

  if (!opts.catalog && !this.catalog)
    throw {message: "catalog not specified"};
  if (!opts.schema && !this.schema)
    throw {message: "schema not specified"};

  var header = {};
  header[Headers.CATALOG] = opts.catalog || this.catalog;
  header[Headers.SCHEMA] = opts.schema || this.schema;

  var req = { method: 'POST', path: '/v1/execute', headers: header, body: query };
  client.request(req, function(err, code, content){
    if (err || code !== 200) {
      var message = "execution error" + (content && content.length > 0 ? ":" + content : "");
      callback({message:message, error: err, code: code});
      return;
    }
    // content: {"columns":[{"name":"Schema","type":"varchar"}],"data":[["default"],["information_schema"],["sys"]]}
    callback(null, content.data, content.columns);
  });
};

Client.prototype.statementResource = function(opts) {
  var client = this;
  var columns = null;

  if (!opts.catalog && !this.catalog)
    throw {message: "catalog not specified"};
  if (!opts.schema && !this.schema)
    throw {message: "schema not specified"};
  if (!opts.success && !opts.callback)
    throw {message: "callback function 'success' (or 'callback') not specified"};

  var header = {};
  header[Headers.CATALOG] = opts.catalog || this.catalog;
  header[Headers.SCHEMA] = opts.schema || this.schema;

  var fetch_info = opts.info || false;

  var cancel_checker = opts.cancel;
  var state_callback = opts.state;
  var columns_callback = opts.columns;
  var data_callback = opts.data;
  var success_callback = opts.success || opts.callback;
  var error_callback = opts.error || opts.callback;

  var req = { method: 'POST', path: '/v1/statement', headers: header, body: opts.query };
  client.request(req, function(err, code, data){
    if (err || code !== 200 || (data && data.error)) {
      if (error_callback) {
        var message = "execution error" + (data && data.length > 0 ? ":" + data : "");
        if (data && data.error && data.error.message)
          message = data.error.message;
        error_callback({message:message, error: (err || data.error), code: code});
      }
      return;
    }
    /*
    var data = {
      "stats": {
        "processedBytes": 0, "processedRows": 0,
        "wallTimeMillis": 0, "cpuTimeMillis": 0, "userTimeMillis": 0,
        "state": "QUEUED",
        "scheduled": false,
        "nodes": 0,
        "totalSplits": 0, "queuedSplits": 0, "runningSplits": 0, "completedSplits": 0,
      },
      "nextUri": "http://localhost:8080/v1/statement/20140120_032523_00000_32v8g/1",
      "infoUri": "http://localhost:8080/v1/query/20140120_032523_00000_32v8g",
      "id": "20140120_032523_00000_32v8g"
    };
     */
    if (!data.id || !data.nextUri || !data.infoUri) {
      var error_message = null;
      if (!data.id)
        error_message = "query id missing in response for POST /v1/statement";
      else if (!data.nextUri)
        error_message = "nextUri missing in response for POST /v1/statement";
      else if (!data.infoUri)
        error_message = "infoUri missing in response for POST /v1/statement";
      error_callback({message: error_message, data: data});
      return;
    }
    var last_state = null;
    var firstNextUri = data.nextUri; // TODO: check the cases without nextUri for /statement ?
    var fetch_next = function(next_uri){
      /*
       * 1st time
{
 "stats": {
   "rootStage": {
     "subStages": [
       {
         "subStages": [],
         "processedBytes": 83103149, "processedRows": 2532704,
         "wallTimeMillis": 20502, "cpuTimeMillis": 3431, "userTimeMillis": 3210,
         "stageId": "1", "state": "FINISHED", "done": true,
         "nodes": 3,
         "totalSplits": 420, "queuedSplits": 0, "runningSplits": 0, "completedSplits": 420
       }
     ],
     // same as substage
   },
   // same as substage
   "state": "RUNNING",
 },
 "data": [ [ 1266352 ] ],
 "columns": [ { "type": "bigint", "name": "cnt" } ],
 "nextUri": "http://localhost:8080/v1/statement/20140120_032523_00000_32v8g/2",
 "partialCancelUri": "http://10.0.0.0:8080/v1/stage/20140120_032523_00000_32v8g.0",
 "infoUri": "http://localhost:8080/v1/query/20140120_032523_00000_32v8g",
 "id": "20140120_032523_00000_32v8g"
}
       */
      /*
       * 2nd time
{
 "stats": {
   // ....
   "state": "FINISHED",
 },
 "columns": [ { "type": "bigint", "name": "cnt" } ],
 "infoUri": "http://localhost:8080/v1/query/20140120_032523_00000_32v8g",
 "id": "20140120_032523_00000_32v8g"
}
       */
      if (cancel_checker && cancel_checker()) {
        client.request({ method: 'DELETE', path: next_uri }, function(error, code, data){
          if (error || code !== 204) {
            error_callback({message: "query fetch canceled, but Presto query cancel may fail", error: error, code: code});
          } else {
            error_callback({message: "query fetch canceled by operation"});
          }
        });
        return;
      }
      client.request(next_uri, function(error, code, response){
        if (response.error) {
          error_callback(response.error);
          return;
        }

        if (state_callback && last_state !== response.stats.state) {
          state_callback(null, response.id, response.stats);
          last_state = response.stats.state;
        }

        if (columns_callback && response.columns && !columns) {
          columns = response.columns;
          columns_callback(null, columns);
        }

        /* presto-main/src/main/java/com/facebook/presto/execution/QueryState.java
         * QUEUED, PLANNING, STARTING, RUNNING, FINISHED, CANCELED, FAILED
         */
        if (response.stats.state === 'QUEUED'
          || response.stats.state === 'PLANNING'
          || response.stats.state === 'STARTING'
          || response.stats.state === 'RUNNING' && !response.data) {
          var next = response.nextUri;
          setTimeout(function(){ fetch_next(next); }, client.checkInterval);
          return;
        }

        if (data_callback && response.data) {
          data_callback(null, response.data, response.columns, response.stats);
        }

        if (response.nextUri) {
          var next = response.nextUri;
          setTimeout(function(){ fetch_next(next); }, client.checkInterval);
          return;
        }

        var finishedStats = response.stats;

        if (fetch_info && response.infoUri) {
          client.request(response.infoUri, function(error, code, response){
            success_callback(null, finishedStats, response);
          });
        }
        else {
          success_callback(null, finishedStats);
        }
      });
    };
    fetch_next(firstNextUri);
  });
};
