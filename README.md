# presto-client-node

Distributed query engine "Presto" 's client library for node.js.

```js
var presto = require('presto-client');
var client = new presto.Client({user: 'myname'});

client.execute({
  query:   'SELECT count(*) as cnt FROM tblname WHERE ...',
  catalog: 'hive',
  schema:  'default',
  source:  'nodejs-client',
  state:   function(error, query_id, stats){ console.log({message:"status changed", id:query_id, stats:stats}); },
  columns: function(error, data){ console.log({resultColumns: data}); },
  data:    function(error, data, columns, stats){ console.log(data); },
  success: function(error, stats){},
  error:   function(error){}
});
```

## Installation

```shell
npm install -g presto-client
```

Or add `presto-client` to your own `package.json`, and do `npm install`.

## API

### new Client(opts)

Instanciate client object and set default configurations.

* opts [object]
  * host [string]
    * Presto coordinator hostname or address (default: localhost)
  * ssl [object]
    * Setting a Hash object enables SSL and verify server certificate with options (default: `null`):
      * `ca`: An authority certificate or array of authority certificates to check the remote host against
      * `cert`: Public x509 certificate to use (default : `null`)
      * `ciphers` : Default cipher suite to use. (default: https://nodejs.org/api/tls.html#tls_modifying_the_default_tls_cipher_suite)
      * `key`: Private key to use for SSL (default: `null`)
      * `passphrase`:  A string of passphrase for the private key or pfx (default: `null`)
      * `pfx`: Certificate, Private key and CA certificates to use for SSL. (default: `null`).
      * `rejectUnauthorized`: If not `false` the server will reject any connection which is not authorized with the list of supplied CAs. This option only has an effect if requestCert is `true` (default: `true`)
      * `secureProtocol`: Optional SSL method to use. The possible values are listed as SSL_METHODS, use the function names as strings. For example, "SSLv3_method" to force SSL version 3 (default: `SSLv23_method`)
      * `servername`: Server name for the SNI (Server Name Indication) TLS extension
  * port [integer]
    * Presto coordinator port (default: 8080)
  * user [string]
    * Username of query (default: process user name)
  * source [string]
    * Source of query (default: nodejs-client)
  * basic_auth [object]
    * Pass in a user and password to enable Authorization Basic headers on all requests.
    * basic_auth: {user: "user", password: "password"} (default:null)
  * custom_auth [string]
    * Sets HTTP `Authorization` header with the provided string.
    * Throws exception if `basic_auth` is also given at the same time
  * catalog [string]
    * Default catalog name
  * schema [string]
    * Default schema name
  * checkInterval [integer]
    * Interval milliseconds of each RPC to check query status (default: 800ms)
  * enableVerboseStateCallback [boolean]
    * Enable more verbose callback for Presto query states (default: false)
    * When set to `true`, this flag modifies the condition of the state change callback to return data every `checkInterval`(default: 800ms). Modify `checkInterval` if you wish to change the frequency.
    * Otherwise (`false`), the state change callback will only be called upon a change in state.
    * The purpose of this variable is to enable verbose update capability in state callbacks. This is such that "percentage complete" and "processed rows" may be extracted despite the state still remaining in a particular state eg. "RUNNING".
  * jsonParser [object]
    * Custom json parser if required (default: `JSON`)
  * engine [string]
    * Change headers set. Added for compatibility with Trino.
    * Available options: presto, trino (default: presto)

return value: client instance object

### execute(opts)

This is an API to execute queries. (Using "/v1/statement" HTTP RPC.)

Execute query on Presto cluster, and fetch results.

Attributes of opts [object] are:

* query [string]
* catalog [string]
* schema [string]
* timezone [string :optional]
* user [string :optional]
* prepares [array(string) :optional]
  * The array of prepared statements, without `PREPARE query0 FROM` prefix.
  * Prepared queries can be referred as `queryN`(N: index) like `query0`, `query1` in the query specified as `query`. Example:
    ```javascript
    client.execute({ query: 'EXECUTE query0 USING 2', prepares: ['SELECT 2 + ?'], /* ... */ });
    ```
* info [boolean :optional]
  * fetch query info (execution statistics) for success callback, or not (default false)
* headers [object :optional]
  * additional headers to be included in the request, check the full list for [Trino](https://trino.io/docs/current/develop/client-protocol.html#client-request-headers) and [Presto](https://prestodb.io/docs/current/develop/client-protocol.html#client-request-headers) engines
* cancel [function() :optional]
  * client stops fetch of query results if this callback returns `true`
* state [function(error, query_id, stats) :optional]
  * called when query stats changed
    * `stats.state`: QUEUED, PLANNING, STARTING, RUNNING, FINISHED, or CANCELED, FAILED
  * query_id
    * id string like `20140214_083451_00012_9w6p5`
  * stats
    * object which contains running query status
* columns [function(error, data) :optional]
  * called once when columns and its types are found in results
  * data
    * array of field info
    * `[ { name: "username", type: "varchar" }, { name: "cnt", type: "bigint" } ]`
* data [function(error, data, columns, stats) :optional]
  * called per fetch of query results (may be called 2 or more)
  * data
    * array of array of each column
    * `[ [ "tagomoris", 1013 ], [ "dain", 2056 ], ... ]`
  * columns (optional)
    * same as data of `columns` callback
  * stats (optional)
    * runtime statistics object of query
* success [function(error, stats, info) :optional]
  * called once when all results are fetched (default: value of `callback`)
* error [function(error) :optional]
  * callback for errors of query execution (default: value of `callback`)
* callback [function(error, stats) :optional]
  * callback for query completion (both of success and fail)
  * one of `callback` or `success` must be specified

Callbacks order (success query) is: columns -> data (-> data xN) -> success (or callback)

### query(query_id, callback)

Get query current status. (Same with 'Raw' of Presto Web in browser.)

* query_id [string]
* callback [function(error, data)]

### kill(query_id, callback)

Stop query immediately.

* query_id [string]
* callback [function(error) :optional]

### nodes(opts, callback)

Get node list of presto cluster and return it.

* opts [object :optional]
  * specify null, undefined or `{}` (currently)
* callback [function(error,data)]
  * error
  * data
    * array of node objects

## BIGINT value handling

Javascript standard `JSON` module cannot handle BIGINT values correctly by precision problems.

```js
JSON.parse('{"bigint":1139779449103133602}').bigint //=> 1139779449103133600
```

If your query puts numeric values in its results and precision is important for that query, you can swap JSON parser with any modules which has `parse` method.

```js
var JSONbig = require('json-bigint');
JSONbig.parse('{"bigint":1139779449103133602}').bigint.toString() //=> "1139779449103133602"
// set client option
var client = new presto.Client({
  // ...
  jsonParser: JSONbig,
  // ...
});
```

## Development

When working on this library, you can use the included docker-compose.yml file to spin up a Presto and Trino DBs, which can be done with:

```
docker compose up
```

Once you see the following messages, you'll be able connect to Presto at `http://localhost:18080` and Trino at `http://localhost:18081`, without username/password:

```
presto-client-node-trino-1   | 2023-06-02T08:12:37.760Z	INFO	main	io.trino.server.Server	======== SERVER STARTED ========
presto-client-node-presto-1  | 2023-06-02T08:13:29.760Z	INFO	main	com.facebook.presto.server.PrestoServer	======== SERVER STARTED ========
```

After making a change, you can run the available test suite by doing:

```
npm run test
```

## Versions

* 0.13.0:
  * add "headers" option on execute() to specify any request headers
* 0.12.2:
  * fix the bug of the "prepares" option
* 0.12.1:
  * add "user" option on execute() to override the user specified per client
* 0.12.0:
  * add X-Trino-Prepared-Statement to support SQL placeholder
  * catch Invalid URL errors
* 0.11.2:
  * fix pregression for basic_auth feature
* 0.11.1:
  * fix a critical bug around the code for authorization
* 0.11.0:
  * add "custom_auth" option to specify `Authorization` header value directly ([for Kerberos, OpenID Connect, etc](https://github.com/tagomoris/presto-client-node/issues/47))
* 0.10.0:
  * add "engine" option to execute queries on Trino
* 0.9.0:
  * make "catalog" and "schema" options optional (need to specify those in queries if omitted)
* 0.8.1:
  * fix to specify default ports of http/https if nextUri doesn't have ports
* 0.8.0:
  * fix the bug about SSL/TLS handling if redirections are required
* 0.7.0:
  * support the change of prestodb 0.226 (compatible with others)
* 0.6.0:
  * add X-Presto-Source if "source" specified
* 0.5.0:
  * remove support for execute(arg, callback) using `/v1/execute`
* 0.4.0:
  * add a parameter to call status callback in verbose
* 0.3.0:
  * add Basic Authentication support
* 0.2.0:
  * add HTTPS support
* 0.1.3:
  * add X-Presto-Time-Zone if "timezone" specified
* 0.1.2:
  * add X-Presto-Session if "session" specified
* 0.1.1:
  * fix bug not to handle HTTP level errors correctly
* 0.1.0:
  * add option to pass customized json parser to handle BIGINT values
  * add check for required callbacks of query execution
* 0.0.6:
  * add API to get/delete queries
  * add callback `state` on query execution
* 0.0.5:
  * fix to do error check on query execution
* 0.0.4:
  * send cancel request of canceled query actually
* 0.0.3:
  * simple and immediate query execution support
* 0.0.2: maintenance release
  * add User-Agent header with version
* 0.0.1: initial release

## Todo

* node: "failed" node list support
* patches welcome!

## Author & License

* tagomoris
* License:
  * MIT (see LICENSE)
