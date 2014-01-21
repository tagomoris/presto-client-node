var http = require('http');

var Headers = require('./headers').Headers;

var QUERY_STATE_CHECK_INTERVAL = 800; // 800ms

var Client = exports.Client = function(args){
  if (!args)
    args = {};
  this.host = args.host || 'localhost';
  this.port = args.port || 8080;
  this.user = args.user;
  this.catalog = args.catalog;
  this.schema = args.schema;

  this.checkInterval = args.checkInterval || QUERY_STATE_CHECK_INTERVAL;
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

    if (opts.body)
      contentBody = opts.body;
  }

  var req = http.request(opts, function(res){
    var response_code = res.statusCode;
    var response_data = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk){
      response_data += chunk;
    });
    res.on('end', function(){
      var data = response_data;
      if (response_code < 300 && (response_data[0] === '{' || response_data === '[')) {
        try { data = JSON.parse(data); }
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
  this.request({ method: 'GET', path: '/v1/node' }, function(error, code, data){
    if (error || code !== 200) {
      var message = "node list api returns error" + (data && data.length > 0 ? ":" + data : "");
      callback({message: message, error: error, code: code});
      return;
    }
    callback(null, data);
  });
};

Client.prototype.execute = function(opts) {
  var client = this;
  var query_id = null;
  var schema = null;

  var header = {};

  if (opts.catalog || this.catalog)
    header[Headers.CATALOG] = opts.catalog || this.catalog;
  if (opts.schema || this.schema)
    header[Headers.SCHEMA] = opts.schema || this.schema;

  var cancel_checker = opts.cancel;
  var schema_callback = opts.schema;
  var data_callback = opts.data;
  var info_callback = opts.info;
  var success_callback = opts.success || opts.callback;
  var error_callback = opts.error || opts.callback;

  var req = { method: 'POST', path: '/v1/statement', headers: header, body: opts.query };
  client.request(req, function(err, code, data){
    if (err || code !== 200) {
      if (error_callback) {
        var message = "execution error" + (data && data.length > 0 ? ":" + data : "");
        error_callback({message:message, error: err, code: code});
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
 "columns": [
   {
     "type": "bigint",
     "name": "cnt"
   }
 ],
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
 "columns": [
   {
     "type": "bigint",
     "name": "cnt"
   }
 ],
 "infoUri": "http://localhost:8080/v1/query/20140120_032523_00000_32v8g",
 "id": "20140120_032523_00000_32v8g"
}
       */
      if (cancel_checker && cancel_checker()) {
        //TODO: Cancel query
        error_callback({message: "query fetch canceled by operation"});
        return;
      }
      client.request(next_uri, function(error, response){
        if (schema_callback && response.columns && !schema) {
          schema = response.columns;
          schema_callback(null, schema);
        }

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

        // end of fetch sequence
        var finishedStats = response.stats;

        if (info_callback && response.infoUri) {
          client.request(response.infoUri, function(error, response){
            info_callback(error, response);
            success_callback(null, finishedStats);
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

var execute_code_sample = function(){
  var Client = require('presto-client').Client;
  var client = new Client();
  var cancelFlag = false;

  client.execute({
    query: 'select ...',
    catalog: '',
    schema: '',
    /* data -> info -> success */
    cancel: function(){ return cancelFlag; },
    schema: function(error, schema){ console.log(schema); },
    data: function(error, data, columns, stats){ cosole.log(data); },
    info: function(error, info){}, /* if null -> not called */
    success: function(e,stats){},
    error: function(e){}
    /* or w/o success&error: */
    /* callback: function(e,stats){} */
  });
};
