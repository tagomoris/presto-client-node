const { URL } = require('url') ;
const http = require('follow-redirects/http');
const https = require('follow-redirects/https');

var adapters = {
    'http:': http,
    'https:': https,
};

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

    // HTTP Authorization header
    if (args.custom_auth && args.basic_auth)
        throw new Error('Please do not specify basic_auth and custom_auth at the same time.');

    if (args.custom_auth) {
        this.authorization = args.custom_auth;
    } else if (args.basic_auth) {
        this.authorization = 'Basic ' + new Buffer(args.basic_auth.user + ':' + args.basic_auth.password).toString('base64');
    }

    this.protocol = 'http:';

    this.catalog = args.catalog;
    this.schema = args.schema;

    this.source = args.source || 'nodejs-client';

    this.checkInterval = args.checkInterval || QUERY_STATE_CHECK_INTERVAL;
    this.enableVerboseStateCallback = args.enableVerboseStateCallback || false;
    this.jsonParser = args.jsonParser || JSON;

    this.timeout = typeof args.timeout !== 'undefined' ? args.timeout : 60;

    if (args.ssl) {
        this.protocol = 'https:';
        this.ssl = args.ssl;
    }
};

Client.prototype.request = function(opts, callback) {
    var client = this;
    var contentBody = null;

    if (opts instanceof Object) {
        opts.host = client.host;
        opts.port = client.port;
        opts.protocol = client.protocol;
        if (! opts.user)
            opts.user = client.user
        if (! opts.headers)
            opts.headers = {};
    } else {
        try {
            // "opts" argument should be an URL, probably nextUri
            var href = new URL(opts);
            opts = {
                method: 'GET',
                host: href.hostname,
                port: href.port || (href.protocol === 'https:' ? '443' : '80'),
                path: href.pathname + href.search,
                headers: {},
                protocol: href.protocol,
            };
        } catch (error) {
            return callback(error);
        }
    }
    var adapter = adapters[opts.protocol];

    if (opts.user)
        opts.headers[client.headers.USER] = opts.user;

    if (client.source)
        opts.headers[client.headers.SOURCE] = client.source;

    opts.headers[client.headers.USER_AGENT] = this.userAgent;

    if (client.authorization)
        opts.headers[client.headers.AUTHORIZATION] = this.authorization;

    if (opts.body)
        contentBody = opts.body;

    // `agents` is a custom property that follow-redirects supports, where
    // it's similar to setting `agent`, but allows for setting it per protocol,
    // so that if we redirect from http -> https (or vice versa) we use the right
    // agent, instead of trying to reuse http.Agent for https (or vice versa) which
    // will error.
    opts.agents = {
        http: new http.Agent({ keepAlive: false }),
        https: new https.Agent({ ...client.ssl, keepAlive: false }),
    };

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
            var error = null;
            // A DELETE request to cancel a query should return 204 No Content, while
            // all other API requests should return 200 OK with a JSON body.
            if (opts.method === 'DELETE' && response_code === 204) {
                data = null;
            }
            else if (response_code === 200) {
                try {
                    if (data[0] !== '{' && data[0] !== '[') {
                        throw new Error();
                    }
                    data = parser.parse(data);
                } catch (_) {
                    /* ignore actual error, and give a generic message */
                    error = new Error("execution error:could not parse response");
                }
            }
            else
            {
                error = new Error("execution error:" + (data ? data : "invalid response code (" + response_code + ")"));
            }
            callback(error, response_code, data);
        });
    });

    req.on('error', function(e){
        callback(e);
    });

    if (contentBody)
        req.write(contentBody);

    req.end();

    return req;
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
        if (!callback) {
            return;
        }
        var ret = null;
        if (error) {
            var message = "query kill api returns error" + (data && data.length > 0 ? ":" + data : "");
            ret = {message: message, error: error, code: code};
        }
        callback(ret);
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
    if (!opts.error && !opts.callback)
        throw {message: "callback function 'error' (or 'callback') not specified"};

    var header = Object.assign({}, opts.headers);
    if (opts.catalog || this.catalog) {
        header[client.headers.CATALOG] = opts.catalog || this.catalog;
    }
    if (opts.schema || this.schema) {
        header[client.headers.SCHEMA] = opts.schema || this.schema;
    }
    if (opts.prepares) {
        header[client.headers.PREPARED_STATEMENT] = opts.prepares.map((s, index) => 'query' + index + '=' + encodeURIComponent(s)).join(',');
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
    var retry_callback = opts.retry;
    var success_callback = opts.success || opts.callback;
    var error_callback = opts.error || opts.callback;
    var timeout_value = typeof opts.timeout !== 'undefined' ? opts.timeout : this.timeout;

    var enable_verbose_state_callback = this.enableVerboseStateCallback || false;
    var current_req = null;
    var last_state = null;
    var query_id = null;
    var timed_out = false;

    var timeout = !timeout_value ? null : setTimeout(() => {
        timed_out = true;
        if (query_id) {
            client.kill(query_id, function() {
                // don't worry if this fails
            });
        }
        if (current_req) {
            current_req.destroy();
        }
        error_callback({message: "execution error:query timed out"});
    }, timeout_value * 1000);

    var clear_timeout = function(){
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = null;
    }

    /*
    * 1st call:
        {
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
        * 2+ time
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
        * final state
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

    var first_request = true;
    var fetch = function(uri_obj){
        // we have already timed out and shown an error, so abort out
        if (timed_out) {
            return;
        }
        if (!first_request && cancel_checker && cancel_checker()) {
            clear_timeout();
            client.request({ method: 'DELETE', path: uri_obj }, function(error, code, data){
                if (error) {
                    error_callback({message: "query fetch canceled, but Presto query cancel may fail", error: error, code: code});
                } else {
                    error_callback({message: "query fetch canceled by operation"});
                }
            });
            return;
        }
        current_req = client.request(uri_obj, function(error, code, response){
            // same as above, we have already timed out and shown an error, so abort out
            if (timed_out) {
                return;
            }
            if ([502, 503, 504].includes(code)) {
                setTimeout(function(){
                    fetch(uri_obj);
                }, Math.floor(Math.random() * 51) + 50); // random in 50-100ms
                if (retry_callback) {
                    retry_callback();
                }
                return;
            }

            if (error || (response && response.error)) {
                clear_timeout();
                if (first_request) {
                    var message = "execution error" + (response && response.length > 0 ? ":" + response : "");
                    if (response && response.error && response.error.message)
                        message = response.error.message;
                    error_callback({message, error: (error || response.error), code});
                } else {
                    error_callback(error || response.error);
                }
                return;
            }

            if (first_request && (!response.id || !response.nextUri || !response.infoUri)) {
                clear_timeout();
                var error_message = null;
                if (!response.id)
                    error_message = "query id missing in response for POST /v1/statement";
                else if (!response.nextUri)
                    error_message = "nextUri missing in response for POST /v1/statement";
                else if (!response.infoUri)
                    error_message = "infoUri missing in response for POST /v1/statement";
                error_callback({message: error_message, data: response});
                return;
            }

            first_request = false;
            query_id = response.id || query_id;

            if (state_callback && (last_state !== response.stats.state || enable_verbose_state_callback)) {
                state_callback(null, response.id, response.stats);
                last_state = response.stats.state;
            }

            if (columns_callback && response.columns && !columns) {
                columns = response.columns;
                columns_callback(null, columns);
            }

            var fetchNextWithTimeout = function(uri, checkInterval) {
                setTimeout(function(){ fetch(uri); }, checkInterval);
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

            clear_timeout();

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
    fetch({ method: 'POST', path: '/v1/statement', headers: header, body: opts.query, user: opts.user });
};
