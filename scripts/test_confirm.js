/* eslint-disable @typescript-eslint/no-require-imports */
// This is a small Node-only test script which intentionally uses `require`.
const http = require('http');
const url = 'http://localhost:3001/role/auth/confirm?token_hash=abc&type=signup';
const req = http.request(url, { method: 'GET' }, (res) => {
  console.log('STATUS', res.statusCode);
  console.log('LOCATION', res.headers.location || 'none');
  res.on('data', () => {});
  res.on('end', () => process.exit(0));
});
req.on('error', (e) => { console.error('ERROR', e); process.exit(1); });
req.end();
