# presto-client-node

Distributed query engine "Presto" 's client library for node.js.

```js
var Client = require('presto-client').Client;
var client = new Client();

client.execute({
  query:   'SELECT count(*) as cnt FROM tblname WHERE ...',
  catalog: 'hive',
  schema:  'default',
  columns: function(error, data){ console.log({resultColumns: data}); },
  data:    function(error, data, columns, stats){ cosole.log(data); },
  success: function(error, stats){},
  error:   function(error){}
});
```

## Installation

```
npm install -g presto-client
```

Or write package name in your own `packagen.json`, and do `npm install`.

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

return value: client instance object

### execute(opts)

Execute query on Presto cluster, and fetch results.

* opts [object]
 * query [string]
   * presto query
 * catalog [string]
   * catalog string (default: instance default catalog)
 * schema [string]
   * schema string (default: intance default schema)
 * info [boolean] (optional)
   * fetch query info (execution statistics) for success callback, or not (default false)
 * cancel [function()] (optional)
   * client stops fetch of query results if this callback returns `true`
 * columns [function(error, data)] (optional)
   * called once when columns and its types are found in results
   * data
     * array of field info
     * `[ { name: "username", type: "varchar" }, { name: "cnt", type: "bigint" } ]`
 * data [function(error, data, columns, stats)] (optional)
   * called per fetch of query results (may be called 2 or more)
   * data
     * array of array of each column
     * `[ [ "tagomoris", 1013 ], [ "dain", 2056 ], ... ]`
   * columns (optional)
     * same as data of `columns` callback
   * stats (optional)
     * runtime statistics object of query
 * success [function(error, stats, info)] (optional)
   * called once when all results are fetched (default: value of `callback`)
 * error [function(error)] (optional)
   * callback for errors of query execution (default: value of `callback`)
 * callback [function(error, stats)] (optional)
   * callback for query completion (both of success and fail)
   * one of this option or `success` must be specified

Callbacks order (success query) is: columns -> data (-> data xN) -> success (or callback)

### nodes(opts, callback)

Get node list of presto cluster and return it.

* opts [object] (optional)
  * specify null, undefined or `{}` (currently)
* callback [function(error,data)]
  * error
  * data
    * array of node objects

## Versions

* 0.0.1: initial release

## Todo

* node: "failed" node list support
* patches welcome!

## Author & License

* tagomoris
* License:
  * MIT (see LICENSE)
