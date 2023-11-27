var Headers = exports.Headers = {};
var TrinoHeaders = exports.TrinoHeaders = {};

// All values in this array are prefixed with X-Presto-/X-Trino-,
// with the key being the value uppercased and dashes replaced
// with underscores, e.g. `Max-Size` becomes
// `{ MAX_SIZE: 'X-Presto-Max-Size' }` on Headers object.
const commonPrefix = [
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
const legacyPrefix = {
  'PREPARE': 'Prepared-Statement',
};
const common = [
  'User-Agent',
  'Authorization',
];

const transform = (key) => {
  return key.replace('-', '_').toUpperCase();
}
commonPrefix.forEach((header) => {
  Headers[transform(header)] = `X-Presto-${header}`;
  TrinoHeaders[transform(header)] = `X-Trino-${header}`;
});
Object.entries(legacyPrefix).forEach(([key, value]) => {
  Headers[key] = `X-Presto-${value}`;
  TrinoHeaders[key] = `X-Trino-${value}`;
});
common.forEach((header) => {
  Headers[transform(header)] = header;
  TrinoHeaders[transform(header)] = header;
});
