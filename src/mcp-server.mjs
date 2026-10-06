#!/usr/bin/env node
import { parseOptions } from './config.mjs';
import { openStore } from './store.mjs';
import { createProtocol } from './protocol.mjs';

let db;
try {
  const { dbPath, inputPath } = parseOptions();
  if (inputPath) throw new Error('INVALID_OPTIONS');
  db = openStore(dbPath, { readOnly: true });
} catch {
  process.stderr.write('STATE_STORE_UNAVAILABLE\n');
  process.exit(1);
}
const handle = createProtocol(db);
const maxBytes = 65536;
let pending = '';
let dropping = false;
const send = result => { if (result) process.stdout.write(JSON.stringify(result) + '\n'); };
const bad = code => send({ jsonrpc: '2.0', id: null, error: { code, message: code === -32700 ? 'PARSE_ERROR' : 'REQUEST_TOO_LARGE' } });
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  const fragments = chunk.split('\n');
  fragments.forEach((part, index) => {
    const end = index < fragments.length - 1;
    if (!dropping) {
      pending += part;
      if (Buffer.byteLength(pending, 'utf8') > maxBytes) { pending = ''; dropping = true; bad(-32600); }
    }
    if (end) {
      if (!dropping && pending.trim()) {
        let request;
        try { request = JSON.parse(pending); } catch { bad(-32700); }
        if (request !== undefined) send(handle(request));
      }
      pending = ''; dropping = false;
    }
  });
});
process.stdin.on('end', () => { if (pending.trim() && !dropping) bad(-32700); db.close(); });
process.stdin.on('error', () => { db.close(); process.exitCode = 1; });
