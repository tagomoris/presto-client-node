const { URL } = require('url') ;

var adapterFor = (function() {
    var adapters = {
        'http:': require('http'),
        'https:': require('https'),
    };

    return function(protocol) {
        return adapters[protocol];
    };
}());

var PrestoHeaders = require('./headers').Headers;
var TrinoHeaders = require('./headers').TrinoHeaders;

var QUERY_STATE_CHECK_INTERVAL = 800; // 800ms

exports.version = 'unknown';

var Client = exports.Client = function(args){
    if (!args)
        args = {};

    switch (args.engine) {
        case 'trino':
            this.headers = TrinoHeaders;
            break;
        case 'presto':
        default:
            this.headers = PrestoHeaders;
            break;
    }

    // exports.version set in index.js of project root
    this.userAgent = 'presto-client-node ' + exports.version;

    this.host = args.host || 'localhost';
    this.port = args.port || 8080;
    this.user = args.user || process.env.USER;
    this.basic_auth = args.basic_auth || null;
    this.custom_auth = args.custom_auth;
    this.protocol = 'http:';

    this.catalog = args.catalog;
    this.schema = args.schema;
    
    this.source = args.source || 'nodejs-client';

    this.checkInterval = args.checkInterval || QUERY_STATE_CHECK_INTERVAL;
    this.enableVerboseStateCallback = args.enableVerboseStateCallback || false;
    this.jsonParser = args.jsonParser || JSON;

    if (args.ssl) {
        this.protocol = 'https:';
        this.ssl = args.ssl;
    }
};

Client.prototype.request = function(opts, callback) {
    var client = this;
    var adapter = adapterFor(client.protocol);
    var contentBody = null;

    if (opts instanceof Object) {
        opts.host = client.host;
        opts.port = client.port;
        if (! opts.headers)
            opts.headers = {};
    } else {
        // "opts" argument should be an URL, probably nextUri
        var href = new URL(opts);
        opts = {
            method: 'GET',
            host: href.hostname,
            port: href.port || (href.protocol === 'https:' ? '443' : '80'),
            path: href.pathname + href.search,
            headers: {},
        };
    }
    opts.protocol = client.protocol;

    opts = Object.assign({}, opts, client.ssl);

    if (client.user)
        opts.headers[client.headers.USER] = client.user;

    if (client.source)
        opts.headers[client.headers.SOURCE] = client.source;

    opts.headers[client.headers.USER_AGENT] = this.userAgent;

    /**
     * Apply an Authorization header if the user
     * has specified a client.basic_auth object.
     * client.basic_auth = { user: "<user>", password : "<password>"}
     */
    if (client.basic_auth)
        opts.headers[client.headers.AUTHORIZATION] = 'Basic ' + new Buffer(client.basic_auth.user + ":" + client.basic_auth.password).toString("base64");

    /**
     * Override Authorization header with custom_auth if given
     */
    if (client.custom_auth)
        opts.headers[client.headers.AUTHORIZATION] = client.custom_auth;

    if (opts.body)
        contentBody = opts.body;

    opts.agent = new adapter.Agent(opts); // Otherwise SSL params are ignored.

    var parser = this.jsonParser;

    var req = adapter.request(opts, function(res){
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

Client.prototype.execute = function(opts) {
    this.statementResource(opts);
};

Client.prototype.statementResource = function(opts) {
    var client = this;
    var columns = null;

    if ((opts.schema || this.schema) && !(opts.catalog || this.catalog)) {
        throw {message: "Catalog not specified; catalog is required if schema is specified"}
    }
    if (!opts.success && !opts.callback)
        throw {message: "callback function 'success' (or 'callback') not specified"};

    var header = {};
    if (opts.catalog || this.catalog) {
        header[client.headers.CATALOG] = opts.catalog || this.catalog;
    }
    if (opts.schema || this.schema) {
        header[client.headers.SCHEMA] = opts.schema || this.schema;
    }

    if (opts.session)
        header[client.headers.SESSION] = opts.session;
    if (opts.timezone)
        header[client.headers.TIME_ZONE] = opts.timezone;


    var fetch_info = opts.info || false;

    var cancel_checker = opts.cancel;
    var state_callback = opts.state;
    var columns_callback = opts.columns;
    var data_callback = opts.data;
    var success_callback = opts.success || opts.callback;
    var error_callback = opts.error || opts.callback;

    var enable_verbose_state_callback = this.enableVerboseStateCallback || false;

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
                  "processedBytes": 0,
                  "processedRows": 0,
                  "wallTimeMillis": 0,
                  "cpuTimeMillis": 0,
                  "userTimeMillis": 0,
                  "state": "QUEUED",
                  "scheduled": false,
                  "nodes": 0,
                  "totalSplits": 0,
                  "queuedSplits": 0,
                  "runningSplits": 0,
                  "completedSplits": 0,
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
                                 "processedBytes": 83103149,
                                 "processedRows": 2532704,
                                 "wallTimeMillis": 20502,
                                 "cpuTimeMillis": 3431,
                                 "userTimeMillis": 3210,
                                 "stageId": "1",
                                 "state": "FINISHED",
                                 "done": true,
                                 "nodes": 3,
                                 "totalSplits": 420,
                                 "queuedSplits": 0,
                                 "runningSplits": 0,
                                 "completedSplits": 420
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
                if (error || response.error) {
                    error_callback(error || response.error);
                    return;
                }

                if (state_callback && (last_state !== response.stats.state || enable_verbose_state_callback)) {
                    state_callback(null, response.id, response.stats);
                    last_state = response.stats.state;
                }

                if (columns_callback && response.columns && !columns) {
                    columns = response.columns;
                    columns_callback(null, columns);
                }

                var fetchNextWithTimeout = function(uri, checkInterval) {
                    setTimeout(function(){ fetch_next(uri); }, checkInterval);
                };

                /* presto-main/src/main/java/com/facebook/presto/execution/QueryState.java
                 * QUEUED, PLANNING, STARTING, RUNNING, FINISHED, CANCELED, FAILED
                 */
                if (response.stats.state === 'QUEUED'
                    || response.stats.state === 'PLANNING'
                    || response.stats.state === 'STARTING'
                    || response.stats.state === 'RUNNING' && !response.data) {
                    fetchNextWithTimeout(response.nextUri, client.checkInterval);
                    return;
                }

                if (data_callback && response.data) {
                    data_callback(null, response.data, response.columns, response.stats);
                }

                if (response.nextUri) {
                    fetchNextWithTimeout(response.nextUri, client.checkInterval);
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
