var Headers = exports.Headers = {};
var TrinoHeaders = exports.TrinoHeaders = {};

// All values in this array are prefixed with X-Presto-/X-Trino-,
// with the key being the value uppercased and dashes replaced
// with underscores, e.g. `Max-Size` becomes
// `{ MAX_SIZE: 'X-Presto-Max-Size' }` on Headers object.
const commonSuffix = [
  'User',
  'Source',
  'Catalog',
  'Schema',
  'Time-Zone',
  'Current-State',
  'Max-Wait',
  'Max-Size',
  'Page-Sequence-Id',
  'Session',
  'Prepared-Statement',
];
const legacySuffix = {
  'PREPARE': 'Prepared-Statement',
};
const common = [
  'User-Agent',
  'Authorization',
];

const transformToHeaderKeyName = (key) => {
  return key.replace('-', '_').toUpperCase();
}
commonSuffix.forEach((header) => {
  Headers[transformToHeaderKeyName(header)] = `X-Presto-${header}`;
  TrinoHeaders[transformToHeaderKeyName(header)] = `X-Trino-${header}`;
});
Object.entries(legacySuffix).forEach(([key, value]) => {
  Headers[key] = `X-Presto-${value}`;
  TrinoHeaders[key] = `X-Trino-${value}`;
});
common.forEach((header) => {
  Headers[transformToHeaderKeyName(header)] = header;
  TrinoHeaders[transformToHeaderKeyName(header)] = header;
});
