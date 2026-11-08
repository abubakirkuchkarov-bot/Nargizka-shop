/**
 * Эмулятор Turso для тестов: HTTP /v2/pipeline (Hrana) поверх node:sqlite.
 * Каждый baton — отдельное соединение, поэтому BEGIN IMMEDIATE реально блокирует конкурентов.
 * Запуск: node scripts/test/hrana-mock.js <file.sqlite> <port> <token>
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
process.emitWarning = () => {};
const { DatabaseSync } = require('node:sqlite');

const [file, port, token] = process.argv.slice(2);
const streams = new Map();
const open = () => { const d = new DatabaseSync(file); d.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;'); return d; };

const dec = (a) => {
  if (!a || a.type === 'null') return null;
  if (a.type === 'integer') return BigInt(a.value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(a.value) : BigInt(a.value);
  if (a.type === 'float') return a.value;
  if (a.type === 'text') return a.value;
  if (a.type === 'blob') return Buffer.from(a.base64, 'base64');
  throw new Error('bad arg');
};
const enc = (v) => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
};

function execute(conn, stmt) {
  const st = conn.prepare(stmt.sql);
  const args = (stmt.args || []).map(dec);
  const cols = st.columns ? st.columns() : [];
  if (cols.length) {
    st.setReturnArrays && st.setReturnArrays(true);
    const rows = st.all(...args).map((r) => (Array.isArray(r) ? r : cols.map((c) => r[c.name])));
    return { cols: cols.map((c) => ({ name: c.name, decltype: null })), rows: rows.map((r) => r.map(enc)), affected_row_count: 0, last_insert_rowid: null };
  }
  const r = st.run(...args);
  return { cols: [], rows: [], affected_row_count: Number(r.changes), last_insert_rowid: String(r.lastInsertRowid) };
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); return res.end('{"error":"Unauthorized"}'); }
    if (req.method !== 'POST' || !/\/v[23]\/pipeline$/.test(req.url)) { res.writeHead(404); return res.end(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) { res.writeHead(400); return res.end(); }
    let s;
    if (body.baton) {
      s = streams.get(body.baton);
      if (!s) { res.writeHead(400); return res.end('{"error":"invalid baton"}'); }
      streams.delete(body.baton);
    } else s = { conn: open() };
    const results = [];
    let closed = false;
    for (const r of body.requests || []) {
      if (r.type === 'close') { closed = true; results.push({ type: 'ok', response: { type: 'close' } }); continue; }
      if (r.type !== 'execute') { results.push({ type: 'error', error: { message: 'unsupported ' + r.type } }); continue; }
      try { results.push({ type: 'ok', response: { type: 'execute', result: execute(s.conn, r.stmt) } }); }
      catch (e) { results.push({ type: 'error', error: { message: e.message, code: e.code || 'SQLITE_ERROR' } }); }
    }
    let baton = null;
    if (closed) { try { if (s.conn.isTransaction) s.conn.exec('ROLLBACK'); } catch (_) {} s.conn.close(); }
    else { baton = crypto.randomBytes(8).toString('hex'); streams.set(baton, s); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ baton, base_url: null, results }));
  });
}).listen(+port, () => console.log('hrana mock on', port));
