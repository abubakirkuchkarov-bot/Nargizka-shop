/**
 * Локальная база для разработки (без Turso): встроенный node:sqlite (Node.js 22.13+ / 24).
 * Тот же интерфейс, что у db/libsql-http.js: run(stmts), begin(stmts).
 */
'use strict';
const fs = require('fs');
const path = require('path');

function createLocalClient(file) {
  let DatabaseSync;
  try {
    const orig = process.emitWarning;
    process.emitWarning = () => {};
    try { ({ DatabaseSync } = require('node:sqlite')); } finally { process.emitWarning = orig; }
  } catch (e) {
    throw new Error('Для локальной базы нужен Node.js 22.13+ (node:sqlite). Либо задайте TURSO_DATABASE_URL.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');

  const norm = (s) => (typeof s === 'string' ? { sql: s, args: [] } : { sql: s.sql, args: s.args || [] });
  const conv = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);
  function exec1(s) {
    const st = db.prepare(s.sql);
    const args = s.args.map(conv);
    if (st.columns && st.columns().length) {
      const rows = st.all(...args);
      return { columns: st.columns().map((c) => c.name), rows, rowsAffected: 0 };
    }
    const r = st.run(...args);
    return { columns: [], rows: [], rowsAffected: Number(r.changes || 0), lastInsertRowid: Number(r.lastInsertRowid || 0) };
  }
  // один процесс — транзакции выполняются по очереди
  let chain = Promise.resolve();
  async function run(stmts) { return stmts.map(norm).map(exec1); }
  async function begin(first) {
    let release;
    const prev = chain;
    chain = new Promise((r) => { release = r; });
    await prev;
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) { release(); throw e; }
    let done = false;
    let results;
    try { results = (first || []).map(norm).map(exec1); } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} release(); throw e; }
    return {
      first: results,
      async run(stmts) { return stmts.map(norm).map(exec1); },
      async commit() { if (done) return; done = true; try { db.exec('COMMIT'); } finally { release(); } },
      async rollback() { if (done) return; done = true; try { db.exec('ROLLBACK'); } catch (_) {} release(); },
    };
  }
  return { kind: 'local', run, begin, close: () => db.close() };
}

module.exports = { createLocalClient };
