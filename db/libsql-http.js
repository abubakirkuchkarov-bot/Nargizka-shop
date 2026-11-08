/**
 * Минимальный клиент Turso / libSQL по HTTP (протокол Hrana v2, /v2/pipeline) без npm-зависимостей.
 * Поддерживает: обычные запросы, пакеты и интерактивные транзакции (через baton).
 * Секреты (токен) никогда не пишутся в логи и тексты ошибок.
 */
'use strict';

function toHttpUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('TURSO_DATABASE_URL не задан');
  if (/^libsql:\/\//i.test(u)) return 'https://' + u.slice('libsql://'.length);
  if (/^wss?:\/\//i.test(u)) return u.replace(/^ws/i, 'http');
  if (/^https?:\/\//i.test(u)) return u;
  throw new Error('TURSO_DATABASE_URL: неизвестный формат адреса');
}

function encodeArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Number.isSafeInteger(v)) return { type: 'integer', value: String(v) };
    return { type: 'float', value: v };
  }
  return { type: 'text', value: String(v) };
}

function decodeValue(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') {
    const n = Number(v.value);
    return Number.isSafeInteger(n) ? n : v.value;
  }
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'text') return v.value;
  if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
  return null;
}

function normStmt(s) {
  if (typeof s === 'string') return { sql: s, args: [] };
  return { sql: s.sql, args: s.args || [] };
}

function decodeResult(r) {
  const cols = (r.cols || []).map((c) => c.name);
  const rows = (r.rows || []).map((row) => {
    const o = {};
    row.forEach((v, i) => { o[cols[i]] = decodeValue(v); });
    return o;
  });
  return { columns: cols, rows, rowsAffected: r.affected_row_count || 0, lastInsertRowid: r.last_insert_rowid };
}

class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'DB_ERROR';
    this.isDbError = true;
  }
}

function createClient({ url, authToken, fetchImpl, timeoutMs }) {
  const base = toHttpUrl(url);
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('fetch недоступен: нужен Node.js 18+');
  const tmo = timeoutMs || 15000;

  async function pipeline(stream, requests) {
    const target = (stream.baseUrl || base) + '/v2/pipeline';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), tmo);
    let res;
    try {
      res = await doFetch(target, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authToken ? { Authorization: 'Bearer ' + authToken } : {}),
        body: JSON.stringify({ baton: stream.baton || null, requests }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new DbError('База данных недоступна (' + (e.name === 'AbortError' ? 'таймаут' : 'сеть') + ')', 'DB_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = JSON.parse(text); if (j && (j.error || j.message)) msg += ': ' + String(j.error || j.message).slice(0, 200); } catch (_) {}
      if (res.status === 401 || res.status === 403) throw new DbError('Нет доступа к базе (проверьте TURSO_AUTH_TOKEN)', 'DB_AUTH');
      throw new DbError('Ошибка базы данных: ' + msg, 'DB_HTTP');
    }
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new DbError('Некорректный ответ базы данных', 'DB_PROTOCOL'); }
    stream.baton = body.baton || null;
    if (body.base_url) stream.baseUrl = String(body.base_url).replace(/\/+$/, '');
    return body.results || [];
  }

  function unwrap(results, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = results[i];
      if (!r || r.type !== 'ok') {
        const err = (r && r.error) || {};
        throw new DbError(String(err.message || 'Ошибка запроса').slice(0, 300), err.code || 'SQL_ERROR');
      }
      out.push(decodeResult(r.response.result || {}));
    }
    return out;
  }

  const execReq = (s) => ({ type: 'execute', stmt: { sql: s.sql, args: s.args.map(encodeArg), want_rows: true } });

  /** Выполнить несколько запросов в режиме autocommit (каждый — отдельно). Ошибка любого — исключение. */
  async function run(stmts) {
    const list = stmts.map(normStmt);
    const stream = {};
    const results = await pipeline(stream, list.map(execReq).concat([{ type: 'close' }]));
    return unwrap(results, list.length);
  }

  /** Интерактивная транзакция: BEGIN IMMEDIATE удерживает блокировку записи до commit/rollback. */
  async function begin(firstStmts) {
    const stream = {};
    const list = [{ sql: 'BEGIN IMMEDIATE', args: [] }].concat((firstStmts || []).map(normStmt));
    let results;
    try {
      results = await pipeline(stream, list.map(execReq));
      results = unwrap(results, list.length).slice(1);
    } catch (e) {
      if (stream.baton) await pipeline(stream, [{ type: 'execute', stmt: { sql: 'ROLLBACK', args: [] } }, { type: 'close' }]).catch(() => {});
      throw e;
    }
    let done = false;
    return {
      first: results,
      async run(stmts) {
        if (done) throw new DbError('Транзакция уже завершена', 'TX_DONE');
        const l = stmts.map(normStmt);
        if (!l.length) return [];
        return unwrap(await pipeline(stream, l.map(execReq)), l.length);
      },
      async commit() {
        if (done) return;
        done = true;
        const r = await pipeline(stream, [{ type: 'execute', stmt: { sql: 'COMMIT', args: [] } }, { type: 'close' }]);
        unwrap(r, 1);
      },
      async rollback() {
        if (done) return;
        done = true;
        try { await pipeline(stream, [{ type: 'execute', stmt: { sql: 'ROLLBACK', args: [] } }, { type: 'close' }]); } catch (_) {}
      },
    };
  }

  return { kind: 'turso', run, begin };
}

module.exports = { createClient, toHttpUrl, DbError };
