/**
 * Хранилище Nargizka Shop поверх libSQL (Turso в продакшене, node:sqlite локально).
 *
 * Модель: каждый запрос загружает нужные «части» данных в привычный объект db
 * (тот же формат, что был в data/db.json), бизнес-логика server.js работает с ним как раньше,
 * а затем в той же транзакции записываются только изменённые строки.
 * Записи идут под BEGIN IMMEDIATE — два одновременных заказа не продадут один и тот же остаток.
 * Ничего не удаляется бесследно: удалённые строки копируются в deleted_rows.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const NS = require('../js/store.js');
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS products (
     id TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, sku TEXT, name TEXT, category TEXT,
     visible INTEGER NOT NULL DEFAULT 1, price INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  // остаток по варианту «Цвет|Размер» — единственный источник правды по складу
  `CREATE TABLE IF NOT EXISTS product_variants (
     product_id TEXT NOT NULL, variant TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty >= 0),
     PRIMARY KEY (product_id, variant))`,
  // журнал движений склада: каждое изменение остатка — одна строка, ничего не стирается
  `CREATE TABLE IF NOT EXISTS stock_moves (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, product_id TEXT NOT NULL, product_name TEXT,
     variant TEXT NOT NULL, delta INTEGER NOT NULL, qty_after INTEGER NOT NULL, type TEXT NOT NULL,
     reason TEXT, ref TEXT, unit_cost INTEGER)`,
  `CREATE INDEX IF NOT EXISTS stock_moves_at ON stock_moves(at DESC)`,
  `CREATE INDEX IF NOT EXISTS stock_moves_ref ON stock_moves(ref)`,
  `CREATE TABLE IF NOT EXISTS orders (
     id TEXT PRIMARY KEY, date INTEGER NOT NULL, status TEXT NOT NULL, channel TEXT, total INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS orders_date ON orders(date DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_entries (
     id TEXT PRIMARY KEY, date INTEGER NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS images (name TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, data_b64 TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS deleted_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, row_id TEXT, data TEXT, reason TEXT, deleted_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quarantine (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, row_id TEXT, data TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, reason TEXT, sha256 TEXT, data TEXT NOT NULL)`,
];

/* ---------- клиент ---------- */
const IS_PROD = process.env.VERCEL_ENV === 'production' || (!process.env.VERCEL && process.env.NODE_ENV === 'production');
const ON_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    const { createClient } = require('./libsql-http');
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (IS_PROD) {
    const e = new Error('База данных не настроена (TURSO_DATABASE_URL)');
    e.status = 503;
    throw e;
  }
  const { createLocalClient } = require('./sqlite-local');
  const file = process.env.LOCAL_DB_FILE
    || (ON_VERCEL ? '/tmp/nargizka-preview.sqlite' : path.join(__dirname, '..', 'data', 'local.sqlite'));
  return createLocalClient(file);
}

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const c = makeClient();
      await ensureSchema(c);
      return c;
    })().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}
function storageKind() {
  return process.env.TURSO_DATABASE_URL ? 'turso' : IS_PROD ? 'none' : 'local';
}

async function ensureSchema(c) {
  await c.run(SCHEMA.concat([
    { sql: `INSERT OR IGNORE INTO meta(key, value) VALUES ('rev', ?)`, args: [String(Date.now())] },
    { sql: `INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)`, args: [String(SCHEMA_VERSION)] },
  ]));
}

/* ---------- чтение ---------- */
const PARTS = {
  meta: [`SELECT key, value FROM meta`],
  products: [`SELECT id, sort, data FROM products ORDER BY sort, id`, `SELECT product_id, variant, qty FROM product_variants`],
  moves: [`SELECT id, at, product_id, product_name, variant, delta, qty_after, type, reason, ref, unit_cost FROM stock_moves ORDER BY id DESC LIMIT 1000`],
  settings: [`SELECT value FROM kv WHERE key = 'settings'`],
  orders: [`SELECT id, data FROM orders ORDER BY date DESC, id DESC`],
  finance: [`SELECT id, data FROM finance_entries ORDER BY date DESC, id`, `SELECT value FROM kv WHERE key = 'finance_opening'`],
  subscribers: [`SELECT email FROM subscribers ORDER BY sort, created_at`],
  auth: [`SELECT value FROM kv WHERE key = 'auth'`],
  notify: [`SELECT value FROM kv WHERE key = 'notify'`],
  outbox: [`SELECT data FROM outbox ORDER BY id DESC LIMIT 40`],
};

function loadStatements(parts) {
  const list = ['meta'].concat(parts.filter((p) => p !== 'meta'));
  const stmts = [];
  const map = [];
  list.forEach((p) => PARTS[p].forEach((sql, i) => { stmts.push(sql); map.push([p, i]); }));
  return { list, stmts, map };
}

const parseJson = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };

function buildState(list, map, results) {
  const by = {};
  map.forEach(([p, i], k) => { (by[p] = by[p] || [])[i] = results[k].rows; });
  const meta = {};
  by.meta[0].forEach((r) => { meta[r.key] = r.value; });
  const db = { version: 2, products: [], orders: [], subscribers: [], settings: {}, finance: { openingBalance: 0, entries: [] } };
  const snap = {};
  if (by.products) {
    const stock = {};
    by.products[1].forEach((r) => { (stock[r.product_id] = stock[r.product_id] || {})[r.variant] = Number(r.qty) || 0; });
    db.products = by.products[0].map((r) => {
      const p = parseJson(r.data, {});
      p.id = r.id;
      p.vstock = stock[r.id] || {};
      delete p.stock;
      return p;
    });
    snap.products = new Map(db.products.map((p, i) => [p.id, productSnap(p, i)]));
  }
  if (by.settings) {
    db.settings = parseJson(by.settings[0][0] && by.settings[0][0].value, {});
    snap.settings = JSON.stringify(db.settings);
  }
  if (by.orders) {
    db.orders = by.orders[0].map((r) => parseJson(r.data, null)).filter(Boolean);
    snap.orders = new Map(db.orders.map((o) => [o.id, JSON.stringify(o)]));
  }
  if (by.finance) {
    db.finance.entries = by.finance[0].map((r) => parseJson(r.data, null)).filter(Boolean);
    db.finance.openingBalance = Number(parseJson(by.finance[1][0] && by.finance[1][0].value, 0)) || 0;
    snap.finance = new Map(db.finance.entries.map((e) => [e.id, JSON.stringify(e)]));
    snap.financeOpening = db.finance.openingBalance;
  }
  if (by.moves) {
    db.stockMoves = by.moves[0].map((r) => ({
      id: r.id, at: r.at, productId: r.product_id, productName: r.product_name, variant: r.variant,
      delta: r.delta, qtyAfter: r.qty_after, type: r.type, reason: r.reason || '', ref: r.ref || '', unitCost: r.unit_cost,
    }));
  }
  if (by.subscribers) {
    db.subscribers = by.subscribers[0].map((r) => r.email);
    snap.subscribers = new Set(db.subscribers);
  }
  const state = {
    parts: new Set(list),
    rev: Number(meta.rev) || 0,
    meta,
    initialized: !!meta.initialized_at,
    db,
    auth: by.auth ? parseJson(by.auth[0][0] && by.auth[0][0].value, null) : undefined,
    notify: by.notify ? parseJson(by.notify[0][0] && by.notify[0][0].value, null) : undefined,
    outbox: by.outbox ? by.outbox[0].map((r) => parseJson(r.data, null)).filter(Boolean) : [],
    pendingOutbox: [],
    extra: [], // дополнительные SQL-операции в той же транзакции
    snap,
  };
  snap.auth = JSON.stringify(state.auth || null);
  snap.notify = JSON.stringify(state.notify || null);
  return state;
}

function productSnap(p, i) {
  const data = Object.assign({}, p);
  delete data.stock;
  delete data.vstock;
  return { sort: i, data: JSON.stringify(data), stock: JSON.stringify(p.vstock || {}) };
}

/* ---------- запись изменений ---------- */
function diffStatements(state) {
  const now = Date.now();
  const out = [];
  const { db, snap, parts } = state;
  const archive = (tbl, id, data, reason) => out.push({
    sql: `INSERT INTO deleted_rows(tbl, row_id, data, reason, deleted_at) VALUES (?, ?, ?, ?, ?)`,
    args: [tbl, id, data, reason || 'deleted', now],
  });
  const kv = (key, value) => out.push({
    sql: `INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, now],
  });

  if (parts.has('products')) {
    const seen = new Set();
    db.products.forEach((p, i) => {
      seen.add(p.id);
      const cur = productSnap(p, i);
      const old = snap.products.get(p.id);
      if (!old || old.data !== cur.data || old.sort !== cur.sort) {
        out.push({
          sql: `INSERT INTO products(id, sort, sku, name, category, visible, price, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET sort=excluded.sort, sku=excluded.sku, name=excluded.name, category=excluded.category,
                visible=excluded.visible, price=excluded.price, data=excluded.data, updated_at=excluded.updated_at`,
          args: [p.id, i, p.sku || '', p.name || '', p.category || '', p.visible ? 1 : 0, Math.round(+p.price || 0), cur.data, now],
        });
      }
      if (!old || old.stock !== cur.stock) {
        const oldStock = old ? JSON.parse(old.stock) : {};
        const st = p.vstock || {};
        Object.keys(st).forEach((variant) => {
          const q = Math.max(0, Math.round(+st[variant] || 0));
          if (oldStock[variant] !== q) {
            out.push({
              sql: `INSERT INTO product_variants(product_id, variant, qty) VALUES (?,?,?) ON CONFLICT(product_id, variant) DO UPDATE SET qty = excluded.qty`,
              args: [p.id, String(variant), q],
            });
          }
        });
        Object.keys(oldStock).filter((k) => !(k in st)).forEach((variant) => {
          out.push({ sql: `DELETE FROM product_variants WHERE product_id = ? AND variant = ?`, args: [p.id, variant] });
        });
      }
    });
    for (const [id, old] of snap.products) {
      if (seen.has(id)) continue;
      const full = Object.assign(JSON.parse(old.data), { vstock: JSON.parse(old.stock) });
      archive('products', id, JSON.stringify(full));
      out.push({ sql: `DELETE FROM product_variants WHERE product_id = ?`, args: [id] });
      out.push({ sql: `DELETE FROM products WHERE id = ?`, args: [id] });
    }
  }
  if (parts.has('settings')) {
    const s = JSON.stringify(db.settings);
    if (s !== snap.settings) kv('settings', s);
  }
  if (parts.has('orders') || state.newOrders) {
    const seen = new Set();
    db.orders.forEach((o) => {
      seen.add(o.id);
      const cur = JSON.stringify(o);
      const old = snap.orders ? snap.orders.get(o.id) : undefined;
      if (old === cur) return;
      const args = [o.id, +o.date || now, String(o.status || ''), o.channel || 'online', Math.round(+o.total || 0), cur, now];
      if (old === undefined) {
        // новый заказ: обычный INSERT — при совпадении номера транзакция откатится и повторится
        out.push({ sql: `INSERT INTO orders(id, date, status, channel, total, data, updated_at) VALUES (?,?,?,?,?,?,?)`, args });
      } else {
        out.push({ sql: `UPDATE orders SET date=?, status=?, channel=?, total=?, data=?, updated_at=? WHERE id=?`, args: args.slice(1).concat([o.id]) });
      }
    });
    if (snap.orders) {
      for (const [id, old] of snap.orders) {
        if (seen.has(id)) continue;
        archive('orders', id, old);
        out.push({ sql: `DELETE FROM orders WHERE id = ?`, args: [id] });
      }
    }
  }
  if (parts.has('finance')) {
    const seen = new Set();
    db.finance.entries.forEach((e) => {
      seen.add(e.id);
      const cur = JSON.stringify(e);
      if (snap.finance.get(e.id) === cur) return;
      out.push({
        sql: `INSERT INTO finance_entries(id, date, type, amount, data) VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET date=excluded.date, type=excluded.type, amount=excluded.amount, data=excluded.data`,
        args: [e.id, +e.date || now, e.type === 'in' ? 'in' : 'out', Math.round(+e.amount || 0), cur],
      });
    });
    for (const [id, old] of snap.finance) {
      if (seen.has(id)) continue;
      archive('finance_entries', id, old);
      out.push({ sql: `DELETE FROM finance_entries WHERE id = ?`, args: [id] });
    }
    if ((+db.finance.openingBalance || 0) !== snap.financeOpening) kv('finance_opening', JSON.stringify(Math.round(+db.finance.openingBalance || 0)));
  }
  if (parts.has('subscribers')) {
    db.subscribers.forEach((email, i) => {
      if (!snap.subscribers.has(email)) {
        out.push({ sql: `INSERT OR IGNORE INTO subscribers(email, created_at, sort) VALUES (?,?,?)`, args: [email, now, i] });
      }
    });
    const cur = new Set(db.subscribers);
    for (const email of snap.subscribers) {
      if (cur.has(email)) continue;
      archive('subscribers', email, JSON.stringify({ email }));
      out.push({ sql: `DELETE FROM subscribers WHERE email = ?`, args: [email] });
    }
  }
  if (parts.has('auth') && JSON.stringify(state.auth || null) !== snap.auth && state.auth) kv('auth', JSON.stringify(state.auth));
  if (parts.has('notify') && JSON.stringify(state.notify || null) !== snap.notify && state.notify) kv('notify', JSON.stringify(state.notify));
  state.pendingOutbox.forEach((e) => out.push({ sql: `INSERT INTO outbox(at, data) VALUES (?, ?)`, args: [e.at || now, JSON.stringify(e)] }));
  state.extra.forEach((s) => out.push(s));
  return out;
}

/* ---------- транзакции ---------- */
const isBusy = (e) => /busy|locked|SQLITE_BUSY|UNIQUE constraint failed: orders\.id/i.test(String(e && e.message));

/** Только чтение: один запрос к базе. */
async function read(parts) {
  const c = await getClient();
  const { list, stmts, map } = loadStatements(parts);
  const results = await c.run(stmts);
  return buildState(list, map, results);
}

/**
 * Чтение + изменение + запись в одной транзакции.
 * fn(state) может менять state.db / state.auth / state.notify; вернуть результат.
 */
async function write(parts, fn) {
  const c = await getClient();
  const { list, stmts, map } = loadStatements(parts);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    let tx;
    try {
      tx = await c.begin(stmts);
    } catch (e) {
      lastErr = e;
      if (isBusy(e)) { await sleep(60 * (attempt + 1)); continue; }
      throw e;
    }
    try {
      const state = buildState(list, map, tx.first);
      const result = await fn(state);
      const changes = diffStatements(state);
      if (changes.length) {
        changes.push({ sql: `UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev'`, args: [] });
        await tx.run(changes);
        await tx.commit();
        state.rev += 1;
      } else {
        await tx.rollback();
      }
      return { state, result };
    } catch (e) {
      await tx.rollback();
      lastErr = e;
      if (isBusy(e) && !e.status) { await sleep(60 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Счётчик попыток (вход, заказы, подписка). Возвращает { count, resetAt }. */
async function hit(key, windowMs) {
  const c = await getClient();
  const now = Date.now();
  const [r] = await c.run([{
    sql: `INSERT INTO rate_limits(key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at < ? THEN excluded.reset_at ELSE rate_limits.reset_at END
          RETURNING count, reset_at`,
    args: [key, now + windowMs, now, now],
  }]);
  const row = r.rows[0] || { count: 1, reset_at: now + windowMs };
  return { count: Number(row.count), resetAt: Number(row.reset_at) };
}
async function clearHit(key) {
  const c = await getClient();
  await c.run([{ sql: `DELETE FROM rate_limits WHERE key = ?`, args: [key] }]);
}

/* ---------- фото ---------- */
async function putImage(name, mime, buf) {
  const c = await getClient();
  await c.run([{
    sql: `INSERT INTO images(name, mime, size, data_b64, created_at) VALUES (?,?,?,?,?)`,
    args: [name, mime, buf.length, buf.toString('base64'), Date.now()],
  }]);
}
async function getImage(name) {
  const c = await getClient();
  const [r] = await c.run([{ sql: `SELECT mime, data_b64 FROM images WHERE name = ?`, args: [name] }]);
  const row = r.rows[0];
  return row ? { mime: row.mime, data: Buffer.from(row.data_b64, 'base64') } : null;
}

async function appendOutbox(entries) {
  if (!entries.length) return;
  const c = await getClient();
  await c.run(entries.map((e) => ({ sql: `INSERT INTO outbox(at, data) VALUES (?, ?)`, args: [e.at || Date.now(), JSON.stringify(e)] })));
}
async function saveKv(key, value) {
  const c = await getClient();
  await c.run([{
    sql: `INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(value), Date.now()],
  }]);
}

/* ---------- первичный перенос данных и резервные копии ---------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Снимок всех данных (для резервной копии перед опасными операциями). */
function snapshotStatement(state, reason) {
  const data = JSON.stringify(state.db);
  return { sql: `INSERT INTO backups(created_at, reason, sha256, data) VALUES (?,?,?,?)`, args: [Date.now(), reason, sha256(data), data] };
}

/**
 * Заполняет пустую базу из снимка db.json.
 * opts.quarantineOrders / opts.quarantineSubscribers — что НЕ показывать как реальные данные
 * (они сохраняются в таблице quarantine, ничего не теряется).
 */
async function importSnapshot(c, source, opts) {
  const o = opts || {};
  const raw = typeof source === 'string' ? source : JSON.stringify(source);
  const snapshot = NS.migrate(JSON.parse(raw));
  // «чистый запуск»: переносятся только настройки; товары, заказы, финансы и подписчики уходят в архив
  if (o.clean) {
    o.quarantineOrders = [];
    o.quarantineSubscribers = [];
    o.archiveAll = { products: snapshot.products, orders: snapshot.orders, subscribers: snapshot.subscribers, finance: snapshot.finance };
    snapshot.products = [];
    snapshot.orders = [];
    snapshot.subscribers = [];
    snapshot.finance = { openingBalance: 0, entries: [] };
  }
  const qOrders = new Map((o.quarantineOrders || []).map((x) => [x.id, x.reason]));
  const qSubs = new Map((o.quarantineSubscribers || []).map((x) => [x.email, x.reason]));
  await ensureSchema(c);
  const tx = await c.begin([`SELECT value FROM meta WHERE key = 'initialized_at'`, `SELECT COUNT(*) AS n FROM products`, `SELECT COUNT(*) AS n FROM orders`]);
  try {
    if (tx.first[0].rows.length || tx.first[1].rows[0].n > 0 || tx.first[2].rows[0].n > 0) {
      const e = new Error('База уже содержит данные — перенос остановлен, ничего не изменено.');
      e.code = 'ALREADY_INITIALIZED';
      throw e;
    }
    const now = Date.now();
    const st = [];
    // резервная копия — исходный файл байт в байт, даже если перед переносом настройки были поправлены
    const original = typeof o.originalRaw === 'string' ? o.originalRaw : raw;
    st.push({ sql: `INSERT INTO backups(created_at, reason, sha256, data) VALUES (?,?,?,?)`, args: [now, 'source-before-migration' + (o.sourceName ? ': ' + o.sourceName : ''), sha256(original), original] });
    if (o.archiveAll) {
      Object.keys(o.archiveAll).forEach((kind) => {
        st.push({ sql: `INSERT INTO quarantine(kind, row_id, data, reason, created_at) VALUES (?, NULL, ?, ?, ?)`, args: ['all-' + kind, JSON.stringify(o.archiveAll[kind]), 'чистый запуск: архив исходных данных', now] });
      });
    }
    (snapshot.products || []).forEach((p, i) => {
      const data = Object.assign({}, p);
      delete data.stock;
      delete data.vstock;
      st.push({
        sql: `INSERT INTO products(id, sort, sku, name, category, visible, price, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [p.id, i, p.sku || '', p.name || '', p.category || '', p.visible ? 1 : 0, Math.round(+p.price || 0), JSON.stringify(data), now],
      });
      Object.keys(p.vstock || {}).forEach((variant) => {
        st.push({ sql: `INSERT INTO product_variants(product_id, variant, qty) VALUES (?,?,?)`, args: [p.id, variant, Math.max(0, Math.round(+p.vstock[variant] || 0))] });
      });
    });
    (snapshot.orders || []).forEach((ord) => {
      if (qOrders.has(ord.id)) {
        st.push({ sql: `INSERT INTO quarantine(kind, row_id, data, reason, created_at) VALUES ('order', ?, ?, ?, ?)`, args: [ord.id, JSON.stringify(ord), qOrders.get(ord.id), now] });
        return;
      }
      st.push({
        sql: `INSERT INTO orders(id, date, status, channel, total, data, updated_at) VALUES (?,?,?,?,?,?,?)`,
        args: [ord.id, +ord.date || now, String(ord.status || ''), ord.channel || 'online', Math.round(+ord.total || 0), JSON.stringify(ord), now],
      });
    });
    (snapshot.subscribers || []).forEach((email, i) => {
      if (qSubs.has(email)) {
        st.push({ sql: `INSERT INTO quarantine(kind, row_id, data, reason, created_at) VALUES ('subscriber', ?, ?, ?, ?)`, args: [email, JSON.stringify({ email }), qSubs.get(email), now] });
        return;
      }
      st.push({ sql: `INSERT OR IGNORE INTO subscribers(email, created_at, sort) VALUES (?,?,?)`, args: [email, now, i] });
    });
    const fin = snapshot.finance || { openingBalance: 0, entries: [] };
    (fin.entries || []).forEach((e) => {
      st.push({ sql: `INSERT INTO finance_entries(id, date, type, amount, data) VALUES (?,?,?,?,?)`, args: [e.id, +e.date || now, e.type === 'in' ? 'in' : 'out', Math.round(+e.amount || 0), JSON.stringify(e)] });
    });
    const kvPut = (k, v) => st.push({ sql: `INSERT INTO kv(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, args: [k, v, now] });
    kvPut('settings', JSON.stringify(snapshot.settings || {}));
    kvPut('finance_opening', JSON.stringify(Math.round(+fin.openingBalance || 0)));
    st.push({ sql: `INSERT INTO meta(key, value) VALUES ('initialized_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [String(now)] });
    st.push({ sql: `INSERT INTO meta(key, value) VALUES ('source_sha256', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [sha256(typeof o.originalRaw === 'string' ? o.originalRaw : raw)] });
    st.push({ sql: `UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev'`, args: [] });
    // пакетами, чтобы не упереться в размер одного HTTP-запроса
    for (let i = 0; i < st.length; i += 200) await tx.run(st.slice(i, i + 200));
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/** Сводка для сверки после переноса. */
async function summary(c) {
  const r = await c.run([
    `SELECT COUNT(*) AS n FROM products`,
    `SELECT COALESCE(SUM(qty),0) AS n FROM product_variants`,
    `SELECT COUNT(*) AS n FROM orders`,
    `SELECT COUNT(*) AS n FROM quarantine`,
    `SELECT COUNT(*) AS n FROM subscribers`,
    `SELECT COUNT(*) AS n FROM finance_entries`,
    `SELECT COUNT(*) AS n FROM images`,
    `SELECT COUNT(*) AS n FROM backups`,
    `SELECT key, value FROM meta`,
    `SELECT COUNT(*) AS n FROM stock_moves`,
  ]);
  const n = (i) => Number(r[i].rows[0].n);
  const meta = {};
  r[8].rows.forEach((x) => { meta[x.key] = x.value; });
  return { products: n(0), stockUnits: n(1), orders: n(2), quarantined: n(3), subscribers: n(4), financeEntries: n(5), images: n(6), backups: n(7), stockMoves: n(9), initializedAt: meta.initialized_at || null, schemaVersion: meta.schema_version };
}

module.exports = {
  IS_PROD, ON_VERCEL, SCHEMA_VERSION,
  getClient, storageKind, ensureSchema, read, write, hit, clearHit,
  putImage, getImage, appendOutbox, saveKv, importSnapshot, summary, snapshotStatement, sha256,
};
