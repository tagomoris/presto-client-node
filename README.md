# presto-client-node

Distributed query engine "Presto" 's client library for node.js.

```js
var presto = require('presto-client');
var client = new presto.Client({user: 'myname', catalog: 'hive', schema: 'default'});
 
client.execute('show schemas', function(error, data, columns){
  console.log({databases: data});
});
```

For queries with long process time and heavy output:
```js
var presto = require('presto-client');
var client = new presto.Client({user: 'myname'});
 
client.execute({
  query:   'SELECT count(*) as cnt FROM tblname WHERE ...',
  catalog: 'hive',
  schema:  'default',
  state:   function(error, query_id, stats){ console.log({message:"status changed", id:query_id, stats:stats}); },
  columns: function(error, data){ console.log({resultColumns: data}); },
  data:    function(error, data, columns, stats){ console.log(data); },
  success: function(error, stats){},
  error:   function(error){}
});
```

## Installation

```
npm install -g presto-client
```

Or add `presto-client` to your own `packagen.json`, and do `npm install`.

## API

### new Client(opts)

Instanciate client object and set default configurations.

* opts [object]
  * host [string]
    * presto coordinator hostname or address (default: localhost)
  * port [integer]
    * presto coordinator port (default: 8080)
  * user [string]
    * username of query (default: process user name)
  * catalog [string]
    * default catalog name
  * schema [string]
    * default schema name
  * checkInterval [integer]
    * interval milliseconds of each RPC to check query status (default: 800ms)
  * jsonParser [object]
    * custom json parser if required (default: `JSON`)

return value: client instance object

### execute(arg, callback)

If 2nd argument `callback` specified, this api will be selected.

This is an API to execute queries that returns result immediately, like `show schemas`, `show tables` and others. (Using "/v1/execute" HTTP RPC.)

Execute query on Presto cluster, and fetch results.

* arg [Object or string]
 * arg [String]: query string executed
   * `catalog` and `schema` must be specified in `new Client()` for this argument type
 * arg [Object]
   * query [string]
   * catalog [string]
     * catalog string (default: instance default catalog)
   * schema [string]
     * schema string (default: intance default schema)
* callback [function(error, data, columns)]
 * called once when query finished
 * data
   * array of arrays of each field values
   * `[ [ 'field1Value', 'field2Value', 3 ], [ 'field1Value', 'field2Value', 6 ], ... ]`
 * columns
   * array of field names and types
   * `[ { name: 'timestamp', type: 'varchar' }, { name: 'username', type: 'varchar' }, { name: 'cnt', type: 'bigint' } ] `

### execute(opts)

This is an API to execute queries that really read large amount of data. (Using "/v1/statement" HTTP RPC.)

Execute query on Presto cluster, and fetch results.

Attributes of opts [object] are:
* query [string]
* catalog [string]
* schema [string]
* info [boolean :optional]
  * fetch query info (execution statistics) for success callback, or not (default false)
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

## Versions

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
