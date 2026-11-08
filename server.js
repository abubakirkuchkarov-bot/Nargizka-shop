// Сервер Nargizka Shop без внешних зависимостей: node server.js
// Витрина — http://localhost:3000, админ-панель — http://localhost:3000/admin/
// Данные: Turso (libSQL) в продакшене, локальный SQLite-файл при разработке — см. db/store.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NS = require('./js/store.js');
const Notify = require('./notify');
const Store = require('./db/store');

const ROOT = __dirname;
const PORT = +process.env.PORT || 3000;
const ON_VERCEL = Store.ON_VERCEL;
const IS_PROD = Store.IS_PROD;
// На Vercel «/» попадает в serverless; HTML/CSS лежат в data/www (includeFiles data/**)
const STATIC_ROOT = (() => {
  const bundled = path.join(ROOT, 'data', 'www');
  try {
    if (fs.existsSync(path.join(bundled, 'index.html'))) return bundled;
  } catch (_) {}
  const pub = path.join(ROOT, 'public');
  try {
    if (fs.existsSync(path.join(pub, 'index.html'))) return pub;
  } catch (_) {}
  return ROOT;
})();
const LEGACY_UPLOADS = path.join(ROOT, 'uploads');
// Vercel не принимает тело запроса больше 4,5 МБ; фото сжимаются в админке до ~1–2 МБ
const MAX_BODY = 4.4 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const SESSION_TTL = 2 * 86400000;
const MIN_PASSWORD = 8;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const DELIVERY = { courier: 'Курьер', express: 'Экспресс', pickup: 'Самовывоз' };

/* ---------- данные текущего запроса ----------
 * Бизнес-функции ниже работают с переменными db/auth как раньше.
 * Внутри одного процесса запросы к данным выполняются по очереди (mutex),
 * между процессами согласованность обеспечивает транзакция базы.
 */
let db;
let rev = 0;
let auth = null;
let current = null;
function persist() { /* изменения записывает db/store.js после обработчика */ }
// название магазина для писем и SMS (обновляется при каждой загрузке настроек)
let BRAND = NS.defaultBrand();
function bind(state) {
  current = state;
  db = NS.migrate(state.db);
  if (state.parts.has('settings')) BRAND = db.settings.brand;
  state.db = db;
  NS.db = db;
  rev = state.rev;
  auth = state.auth || null;
}
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}
const ALL_PARTS = ['products', 'settings', 'orders', 'finance', 'subscribers', 'auth', 'moves'];

async function readData(parts, fn) {
  await ensureReady();
  return exclusive(async () => {
    const state = await Store.read(parts);
    bind(state);
    return fn(state);
  });
}
async function writeData(parts, fn) {
  await ensureReady();
  return exclusive(async () => {
    const { state, result } = await Store.write(parts, async (st) => {
      bind(st);
      const r = await fn(st);
      st.auth = auth;
      return r;
    });
    if (result && typeof result === 'object' && 'rev' in result) result.rev = state.rev;
    return result;
  });
}

/* Пустая база: локально заполняем из data/db.json, в продакшене — ждём ручного переноса (scripts/migrate-to-turso.js). */
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const st = await Store.read([]);
      if (st.initialized) return;
      if (Store.storageKind() !== 'local') throw fail(503, 'Магазин готовится к запуску. Загляните чуть позже.');
      const file = path.join(ROOT, 'data', 'db.json');
      const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : JSON.stringify(NS.seedDB());
      try {
        await Store.importSnapshot(await Store.getClient(), src, { sourceName: 'local data/db.json' });
      } catch (e) {
        if (e.code !== 'ALREADY_INITIALIZED') throw e;
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* ---------- пароль и сессии ---------- */
const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function makeAuth(pw, isDefault, prev) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(pw, salt), isDefault: !!isDefault, epoch: ((prev && prev.epoch) || 0) + 1, changedAt: Date.now() };
}
function setPassword(pw, isDefault) {
  auth = makeAuth(pw, isDefault, auth);
}

/* SESSION_SECRET обязателен в продакшене; локально — случайный на время работы процесса */
const LOCAL_SECRET = crypto.randomBytes(32).toString('hex');
function sessionSecret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length >= 32) return s;
  if (IS_PROD) throw fail(503, 'Вход в админ-панель отключён: не задан SESSION_SECRET (не короче 32 символов)');
  return LOCAL_SECRET;
}
/* Пароль администратора: из базы; при первом запуске — из ADMIN_PASSWORD. В продакшене пароля «admin» нет. */
function ensureAuth() {
  if (auth && auth.hash) return false;
  const envPw = process.env.ADMIN_PASSWORD || '';
  if (envPw) {
    if (IS_PROD && envPw.length < 10) throw fail(503, 'ADMIN_PASSWORD слишком короткий (нужно не меньше 10 символов)');
    setPassword(envPw, false);
    return true;
  }
  if (IS_PROD) throw fail(503, 'Вход в админ-панель отключён: не задан ADMIN_PASSWORD');
  setPassword('admin', true);
  return true;
}

function passwordOk(pw) {
  const a = Buffer.from(hashPassword(pw, auth.salt), 'hex');
  const b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const b64u = (s) => Buffer.from(s).toString('base64url');
function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}
function issueSession() {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_TTL, ep: auth.epoch || 0, n: crypto.randomBytes(6).toString('hex') }));
  return 'v2.' + payload + '.' + sign(payload);
}
/* Проверка токена; epoch меняется при смене пароля — старые сессии перестают действовать */
function verifySession(req) {
  const m = /^Bearer v2\.([\w-]+)\.([\w-]+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  let expect;
  try { expect = sign(m[1]); } catch (_) { return null; }
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!p || !(+p.exp > Date.now())) return null;
  return p;
}
function isAdminFor(req, state) {
  const p = verifySession(req);
  if (!p) return false;
  const a = state.auth;
  return !!(a && a.hash && (a.epoch || 0) === p.ep);
}

function clientIp(req) {
  const h = req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '';
  return String(h).split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
async function limit(key, max, windowMs, message) {
  const r = await Store.hit(key, windowMs);
  if (r.count > max) {
    const e = fail(429, message || 'Слишком много запросов. Попробуйте позже.');
    e.retryAfter = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
    throw e;
  }
}

/* ---------- утилиты ---------- */
function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(+v || 0)));

function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(fail(413, 'Слишком большой запрос')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(fail(400, 'Некорректный запрос')); }
    });
    req.on('error', reject);
  });
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};
function send(res, status, data, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS, extra || {}));
  res.end(JSON.stringify(data));
}

function publicPromo(c) {
  return { code: c.code, type: c.type, value: c.value, minSum: c.minSum, active: true };
}
function publicDB() {
  const settings = Object.assign({}, db.settings);
  const welcome = NS.findPromo(settings.welcomeCode);
  settings.promoCodes = welcome ? [publicPromo(welcome)] : [];
  // закупочная цена и служебные поля — только для админки
  const products = db.products.filter((p) => p.visible).map((p) => {
    const x = Object.assign({}, p);
    delete x.cost;
    return x;
  });
  return { rev, db: { version: db.version, products, settings, orders: [], subscribers: [] } };
}
function adminDB() {
  return { rev, db, defaultPassword: !!(auth && auth.isDefault) };
}

function activeSizes() {
  const list = db && db.settings && Array.isArray(db.settings.sizes) ? db.settings.sizes : null;
  return (list && list.length ? list : NS.DEFAULT_SIZES).map((x) => String(x).trim()).filter(Boolean);
}
function sanitizeImage(src) {
  const s = str(src, 2000);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : null;
}
const colorName = (c) => str(c, 40).replace(/\|/g, '/');
function sanitizeVstock(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  Object.keys(v).slice(0, 2000).forEach((k) => {
    const [c, sz] = NS.splitKey(String(k));
    const size = str(sz, 16);
    if (!size) return;
    out[NS.vkey(colorName(c), size)] = int(v[k], 0, 100000);
  });
  return out;
}
function sanitizeProduct(p) {
  const colors = (Array.isArray(p.colors) ? p.colors : []).map(colorName).filter(Boolean).slice(0, 40);
  // старый формат (остаток только по размерам) переводится в варианты
  const tmp = NS.normalizeStock({ colors, vstock: p.vstock ? sanitizeVstock(p.vstock) : null, stock: p.stock || {} }, activeSizes());
  const out = {
    id: str(p.id, 40) || NS.newId('p'),
    sku: str(p.sku, 40),
    name: str(p.name, 200),
    brand: str(p.brand, 80),
    category: str(p.category, 40),
    price: int(p.price, 0, 1e12),
    cost: int(p.cost, 0, 1e12),
    discount: int(p.discount, 0, 90),
    colors,
    vstock: tmp.vstock,
    variant: int(p.variant, 0, 3),
    fabric: str(p.fabric, 60),
    description: str(p.description, 4000),
    images: (Array.isArray(p.images) ? p.images : []).map(sanitizeImage).filter(Boolean).slice(0, 30),
    isNew: !!p.isNew,
    isHit: !!p.isHit,
    visible: !!p.visible,
    sold: int(p.sold, 0, 1e9),
    rating: Math.min(5, Math.max(0, +p.rating || 5)),
    reviews: int(p.reviews, 0, 1e9),
    createdAt: +p.createdAt || Date.now(),
  };
  return NS.normalizeStock(out, activeSizes());
}

/* ---------- склад: каждое изменение остатка проходит здесь и пишется в журнал ---------- */
const MOVE_TYPES = {
  sale: 'Продажа', cancel: 'Отмена заказа', return: 'Возврат', receipt: 'Поступление',
  writeoff: 'Списание', adjust: 'Корректировка', initial: 'Начальный остаток', restock: 'Повторное списание',
};
function variantKey(p, color) {
  return (p.colors || []).length ? color : '';
}
function changeStock(p, color, size, delta, type, reason, ref, unitCost) {
  delta = Math.round(+delta || 0);
  if (!delta) return;
  const key = NS.vkey(variantKey(p, color), size);
  const cur = +(p.vstock || {})[key] || 0;
  const next = cur + delta;
  if (next < 0) throw fail(409, `${p.name} (${[variantKey(p, color), size].filter(Boolean).join(', ')}): в наличии только ${cur} шт.`);
  if (!p.vstock) p.vstock = {};
  p.vstock[key] = next;
  NS.normalizeStock(p, activeSizes());
  const m = {
    at: Date.now(), productId: p.id, productName: p.name, variant: key, delta, qtyAfter: next,
    type, reason: str(reason, 300), ref: str(ref, 60), unitCost: unitCost == null ? null : Math.round(+unitCost || 0),
  };
  current.extra.push({
    sql: 'INSERT INTO stock_moves(at, product_id, product_name, variant, delta, qty_after, type, reason, ref, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?)',
    args: [m.at, m.productId, m.productName, m.variant, m.delta, m.qtyAfter, m.type, m.reason, m.ref, m.unitCost],
  });
  if (Array.isArray(db.stockMoves)) db.stockMoves.unshift(m);
}
/**
 * Заказ держит товар (stockOut = true) или вернул его на склад (false).
 * Переход выполняется только при смене состояния — повторный вызов ничего не делает,
 * поэтому двойное списание или двойной возврат невозможны.
 */
function applyOrderStock(o, out, nextStatus) {
  if (!!o.stockOut === !!out) return;
  const type = out ? (o.stockOut === false && o.status && NS.STOCK_FREE_STATUSES.includes(o.status) ? 'restock' : 'sale')
    : (nextStatus === 'Возврат' ? 'return' : 'cancel');
  const reason = MOVE_TYPES[type] + ' · заказ ' + o.id;
  o.items.forEach((it) => {
    const p = db.products.find((x) => x.id === it.id);
    if (!p) return; // товар удалён из каталога — его копия в архиве
    changeStock(p, it.color, it.size, out ? -it.qty : it.qty, type, reason, o.id, it.cost);
    p.sold = Math.max(0, (p.sold || 0) + (out ? it.qty : -it.qty));
  });
  o.stockOut = !!out;
}
function historyPush(o, text) {
  if (!Array.isArray(o.history)) o.history = [];
  o.history.push({ at: Date.now(), text: str(text, 200) });
  if (o.history.length > 50) o.history = o.history.slice(-50);
}

/* ---------- заказ с витрины: цены и остатки проверяются на сервере ---------- */

function moneyUz(n) {
  return new Intl.NumberFormat('ru-RU').format(+n || 0) + ' сум';
}
async function sendWelcomeMail(email, code) {
  const subject = BRAND.name + ' — ваш промокод';
  const text = code
    ? ('Спасибо за подписку!\n\nВаш промокод на первый заказ: ' + code + '\n\nПримените его в корзине на сайте.\n\n— ' + BRAND.name)
    : ('Спасибо за подписку на новости ' + BRAND.name + '!\n\n— ' + BRAND.name);
  const html = '<div style="font-family:Georgia,serif;line-height:1.5;color:#111">'
    + '<h2 style="font-weight:400">' + BRAND.name + '</h2>'
    + '<p>Спасибо за подписку!</p>'
    + (code ? ('<p>Ваш промокод на первый заказ:</p><p style="font-size:28px;letter-spacing:.12em"><b>' + code + '</b></p><p>Примените его в корзине на сайте.</p>') : '')
    + '<p style="color:#706a62">— ' + BRAND.name + '</p></div>';
  await Notify.sendEmail(email, subject, text, html);
}
async function sendOrderMail(order) {
  if (!order.customer || !order.customer.email) return;
  const items = (order.items || []).map((i) => i.name + ' (' + i.color + ', ' + i.size + ') ×' + i.qty).join('\n');
  const text = 'Заказ ' + order.id + ' принят.\n\n'
    + items + '\n\nИтого: ' + moneyUz(order.total)
    + '\nДоставка: ' + (order.delivery || '')
    + '\nОплата: ' + (order.payment || '')
    + '\n\nМы свяжемся с вами для подтверждения.\n— ' + BRAND.name;
  const html = '<div style="font-family:Georgia,serif;line-height:1.5"><h2 style="font-weight:400">Заказ ' + order.id + '</h2>'
    + '<p>Спасибо! Заказ принят.</p><pre style="font-family:inherit">' + items.replace(/</g, '') + '</pre>'
    + '<p><b>Итого: ' + moneyUz(order.total) + '</b></p>'
    + '<p>Доставка: ' + (order.delivery || '') + '<br>Оплата: ' + (order.payment || '') + '</p>'
    + '<p style="color:#706a62">Мы свяжемся с вами для подтверждения.</p></div>';
  await Notify.sendEmail(order.customer.email, BRAND.name + ' — заказ ' + order.id, text, html);
}
async function sendOrderSms(order) {
  if (!order.customer || !order.customer.phone) return;
  const text = BRAND.short + ': zakaz ' + order.id + ' qabul qilindi. Jami: ' + Math.round(order.total) + " so'm. Tez orada bog'lanamiz.";
  await Notify.sendSmsSafe(order.customer.phone, text);
}

function createOrder(b) {
  const s = db.settings;
  const c = b.customer || {};
  const delivery = DELIVERY[b.delivery] ? b.delivery : 'courier';
  const customer = {
    name: str(c.name, 80), phone: str(c.phone, 40), email: str(c.email, 120),
    city: delivery === 'pickup' ? '' : str(c.city, 80),
    address: delivery === 'pickup' ? 'Самовывоз' : str(c.address, 300),
    comment: str(c.comment, 1000),
  };
  if (delivery === 'pickup' && !s.pickupEnabled) throw fail(400, 'Самовывоз сейчас недоступен');
  if (customer.name.length < 2) throw fail(400, 'Укажите имя');
  if (customer.phone.replace(/\D/g, '').length < 9) throw fail(400, 'Укажите корректный номер телефона');
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw fail(400, 'Некорректный e-mail');
  if (delivery !== 'pickup' && (customer.city.length < 2 || customer.address.length < 4)) throw fail(400, 'Укажите город и адрес доставки');
  const payKey = NS.PAYMENTS[b.payment] && s.payments[b.payment] ? b.payment : null;
  if (!payKey) throw fail(400, 'Выберите способ оплаты');

  const merged = new Map();
  (Array.isArray(b.items) ? b.items : []).slice(0, 60).forEach((it) => {
    const key = [it.id, it.color, it.size].join('|');
    const prev = merged.get(key);
    merged.set(key, { id: str(it.id, 40), color: str(it.color, 40), size: str(it.size, 16), qty: int(it.qty, 1, 50) + (prev ? prev.qty : 0) });
  });
  const lines = [];
  const need = {};
  for (const it of merged.values()) {
    const p = db.products.find((x) => x.id === it.id && x.visible);
    if (!p) throw fail(409, 'Один из товаров снят с продажи. Обновите корзину.');
    if (!activeSizes().includes(it.size) && !(it.size in (p.stock || {}))) throw fail(400, 'Некорректный размер');
    if (p.colors.length && !p.colors.includes(it.color)) throw fail(409, `${p.name}: цвет «${it.color}» больше недоступен. Обновите корзину.`);
    const color = p.colors.length ? it.color : '';
    const k = NS.vkey(color, it.size);
    const have = NS.variantStock(p, color, it.size);
    need[p.id + '#' + k] = (need[p.id + '#' + k] || 0) + it.qty;
    if (need[p.id + '#' + k] > have) throw fail(409, `${p.name} (${[color, it.size].filter(Boolean).join(', ')}): в наличии только ${have} шт.`);
    lines.push({ p, qty: it.qty, color, size: it.size });
  }
  if (!lines.length) throw fail(400, 'Корзина пуста');

  let promo = null;
  if (b.promo) {
    promo = NS.findPromo(b.promo);
    if (!promo) throw fail(409, 'Промокод больше не действует. Уберите его и оформите заказ снова.');
  }
  const t = NS.quote(lines, promo, delivery);
  if (t.promoError) throw fail(409, t.promoError);

  let id;
  do { id = 'NS-' + crypto.randomInt(100000, 999999); } while (db.orders.some((o) => o.id === id));
  const order = {
    id, date: Date.now(), customer,
    delivery: DELIVERY[delivery],
    payment: NS.PAYMENTS[payKey].name,
    items: lines.map((l) => ({ id: l.p.id, name: l.p.name, sku: l.p.sku, color: l.color, size: l.size, qty: l.qty, price: NS.finalPrice(l.p), cost: +l.p.cost || 0 })),
    subtotal: t.subtotal,
    autoDiscount: t.autoDiscount,
    promo: t.code ? t.code.code : '',
    promoDiscount: t.promoDiscount,
    shipping: t.shipping,
    total: t.total,
    status: 'Новый',
    channel: 'online',
    paid: false,
    paidAt: 0,
    refunded: false,
    stockOut: false,
  };
  applyOrderStock(order, true);
  historyPush(order, 'Заказ оформлен на сайте');
  if (promo) promo.used = (promo.used || 0) + 1;
  db.orders.unshift(order);
  persist();
  return order;
}

/* ---------- сохранение из админки ---------- */

function sanitizeFinanceEntry(e) {
  const type = e && e.type === 'in' ? 'in' : 'out';
  return {
    id: str(e && e.id, 40) || NS.newId('f'),
    date: +e.date || Date.now(),
    type,
    category: str(e && e.category, 60) || (type === 'in' ? 'Прочий приход' : 'Прочее'),
    amount: int(e && e.amount, 1, 1e12),
    note: str(e && e.note, 500),
    createdAt: +e.createdAt || Date.now(),
  };
}
function applyFinance(body) {
  if (!db.finance) db.finance = { openingBalance: 0, entries: [] };
  if (body.openingBalance != null) db.finance.openingBalance = Math.max(0, Math.round(+body.openingBalance || 0));
  if (body.entry) {
    const next = sanitizeFinanceEntry(body.entry);
    const idx = db.finance.entries.findIndex((x) => x.id === next.id);
    if (idx >= 0) db.finance.entries[idx] = next;
    else db.finance.entries.unshift(next);
  }
  if (body.deleteId) {
    db.finance.entries = db.finance.entries.filter((x) => x.id !== body.deleteId);
  }
  persist();
}

function sanitizeBrand(b) {
  const d = NS.defaultBrand();
  const x = Object.assign({}, d, b || {});
  const out = {};
  Object.keys(d).forEach((k) => { out[k] = str(x[k], k === 'tagline' ? 160 : 300).replace(/[<>]/g, ''); });
  out.name = out.name || d.name;
  out.short = out.short || out.name;
  out.logoUrl = sanitizeImage(out.logoUrl) || (/^\/uploads\/[\w.-]+$/.test(out.logoUrl) ? out.logoUrl : '');
  ['accent', 'dark'].forEach((k) => { if (!/^#[0-9a-f]{6}$/i.test(out[k])) out[k] = ''; });
  ['mapUrl', 'facebook', 'tiktok', 'youtube'].forEach((k) => { if (out[k] && !/^https:\/\/\S+$/i.test(out[k])) out[k] = ''; });
  return out;
}

function adminSave(b) {
  (Array.isArray(b.upserts) ? b.upserts : []).forEach((u) => {
    if (!u || !u.p) return;
    const next = sanitizeProduct(u.p);
    const idx = db.products.findIndex((x) => x.id === next.id);
    const target = next.vstock;
    if (idx < 0) {
      // новый товар: начальный остаток проходит через журнал склада
      next.vstock = {};
      NS.normalizeStock(next, activeSizes());
      next.sold = 0;
      db.products.splice(int(u.index, 0, db.products.length), 0, next);
      Object.keys(target).forEach((k) => {
        const [c, sz] = NS.splitKey(k);
        if (target[k] > 0) changeStock(next, c, sz, target[k], 'initial', 'Начальный остаток при создании товара', '', next.cost || null);
      });
      return;
    }
    const old = db.products[idx];
    next.sold = old.sold;
    // остатки меняются и заказами; если администратор их не трогал — оставляем серверные
    const baseV = u.base ? JSON.stringify(sanitizeProduct(u.base).vstock) : null;
    next.vstock = Object.assign({}, old.vstock);
    NS.normalizeStock(next, activeSizes());
    db.products[idx] = next;
    if (baseV !== JSON.stringify(target)) {
      const reason = str(u.reason, 300) || 'Правка остатка в карточке товара';
      new Set(Object.keys(target).concat(Object.keys(old.vstock || {}))).forEach((k) => {
        if (!(k in target)) return;
        const [c, sz] = NS.splitKey(k);
        const delta = (target[k] || 0) - (+next.vstock[k] || 0);
        if (delta) changeStock(next, c, sz, delta, 'adjust', reason, '', null);
      });
    }
  });
  const del = new Set(Array.isArray(b.deletes) ? b.deletes : []);
  if (del.size) db.products = db.products.filter((p) => !del.has(p.id));
  if (b.settings && typeof b.settings === 'object') {
    const used = {};
    db.settings.promoCodes.forEach((c) => { used[c.code] = c.used || 0; });
    const next = NS.migrate({ settings: b.settings }).settings;
    next.promoCodes.forEach((c) => { c.used = used[c.code] || 0; });
    next.usdRate = Math.max(1, +next.usdRate || 12700);
    next.brand = sanitizeBrand(next.brand);
    next.returnDays = int(next.returnDays, 0, 365);
    db.settings = next;
  }
  NS.db = db;
  persist();
}

function setOrderStatus(id, status) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw fail(404, 'Заказ не найден');
  if (!NS.ORDER_STATUSES.includes(status)) throw fail(400, 'Неизвестный статус');
  if (o.status === status) return o;
  const holds = !NS.STOCK_FREE_STATUSES.includes(status);
  applyOrderStock(o, holds, status);
  // отмена или возврат оплаченного заказа = деньги возвращены покупателю
  if (!holds && o.paid && !o.refunded) { o.refunded = true; o.refundedAt = Date.now(); }
  if (holds && o.refunded) { o.refunded = false; o.refundedAt = 0; }
  historyPush(o, 'Статус: ' + o.status + ' → ' + status);
  o.status = status;
  return o;
}
function setOrderPaid(id, paid) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw fail(404, 'Заказ не найден');
  paid = !!paid;
  if (o.paid === paid) return o;
  if (paid && NS.STOCK_FREE_STATUSES.includes(o.status)) throw fail(409, 'Заказ отменён или возвращён — сначала верните ему рабочий статус');
  o.paid = paid;
  o.paidAt = paid ? Date.now() : 0;
  if (!paid) { o.refunded = false; o.refundedAt = 0; }
  historyPush(o, paid ? 'Отмечен как оплаченный' : 'Оплата снята (исправление)');
  return o;
}

/** Продажа с витрины магазина: сразу списывает склад и попадает в кассу как доставленный заказ */
/** Продажа в магазине или заказ по телефону, оформленный администратором */
function createStoreSale(b) {
  const itemsIn = Array.isArray(b.items) ? b.items : [];
  if (!itemsIn.length) throw fail(400, 'Добавьте хотя бы один товар');
  const lines = [];
  itemsIn.slice(0, 40).forEach((it) => {
    const p = db.products.find((x) => x.id === str(it.id, 40));
    if (!p) throw fail(404, 'Товар не найден');
    const size = str(it.size, 16);
    const qty = int(it.qty, 1, 100);
    if (!size) throw fail(400, 'Укажите размер');
    if (!(size in (p.stock || {})) && !activeSizes().includes(size)) throw fail(400, 'Некорректный размер: ' + size);
    let color = colorName(it.color);
    if (p.colors.length && !p.colors.includes(color)) color = NS.colorWithSize(p, size);
    if (!p.colors.length) color = '';
    const price = Math.max(0, Math.round(it.price != null && it.price !== '' ? +it.price : NS.finalPrice(p)));
    lines.push({ p, size, qty, color, price });
  });
  const channel = b.channel === 'phone' ? 'phone' : 'store';
  const status = NS.ORDER_STATUSES.includes(b.status) && !NS.STOCK_FREE_STATUSES.includes(b.status) ? b.status : (channel === 'store' ? 'Доставлен' : 'Подтверждён');
  const paid = b.paid === undefined ? channel === 'store' : !!b.paid;
  const payName = str(b.payment, 60) || (channel === 'store' ? 'Наличные в магазине' : 'При получении');
  const note = str(b.note, 300);
  const discount = int(b.discount, 0, 1e12);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const shipping = channel === 'phone' ? int(b.shipping, 0, 1e9) : 0;
  const total = Math.max(0, subtotal - discount) + shipping;
  let id;
  do { id = (channel === 'store' ? 'MS-' : 'TL-') + crypto.randomInt(100000, 999999); } while (db.orders.some((o) => o.id === id));
  const date = +b.date && +b.date <= Date.now() + 60000 ? +b.date : Date.now();
  const order = {
    id,
    date,
    channel,
    customer: {
      name: str(b.customerName, 80) || (channel === 'store' ? 'Покупатель в магазине' : 'Покупатель'),
      phone: str(b.customerPhone, 40) || '—',
      email: '',
      city: str(b.city, 80) || (channel === 'store' ? (db.settings.brand && db.settings.brand.city) || '' : ''),
      address: channel === 'store' ? 'Магазин' : str(b.address, 300),
      comment: note,
    },
    delivery: channel === 'store' ? 'Магазин' : 'Курьер',
    payment: payName,
    items: lines.map((l) => ({ id: l.p.id, name: l.p.name, sku: l.p.sku, color: l.color, size: l.size, qty: l.qty, price: l.price, cost: +l.p.cost || 0 })),
    subtotal,
    autoDiscount: 0,
    promo: '',
    promoDiscount: discount,
    shipping,
    total,
    status,
    paid,
    paidAt: paid ? date : 0,
    refunded: false,
    stockOut: false,
  };
  applyOrderStock(order, true);
  historyPush(order, channel === 'store' ? 'Продажа в магазине' : 'Заказ оформлен администратором');
  db.orders.unshift(order);
  return order;
}

/** Приход / списание склада без онлайн-заказа */
/**
 * Поступление / списание / корректировка склада.
 * b.mode: 'in' (поступление, qty > 0), 'out' (списание), 'set' (установить точный остаток).
 * b.lines: [{ productId, color, size, qty }] — несколько вариантов за одну операцию, всё или ничего.
 * Старый формат (productId, size, qty, cost) тоже принимается.
 */
function applyStockMove(b) {
  const mode = ['in', 'out', 'set'].includes(b.mode) ? b.mode : 'in';
  const reason = str(b.reason || b.note, 300);
  if (mode !== 'in' && reason.length < 3) throw fail(400, 'Укажите причину списания или корректировки');
  let lines = Array.isArray(b.lines) ? b.lines : [{ productId: b.productId, color: b.color, size: b.size, qty: b.qty }];
  lines = lines.slice(0, 500).map((l) => ({ productId: str(l.productId || b.productId, 40), color: colorName(l.color), size: str(l.size, 16), qty: int(l.qty, 0, 100000) }))
    .filter((l) => l.size && (mode === 'set' || l.qty > 0));
  if (!lines.length) throw fail(400, 'Укажите количество хотя бы для одного размера');
  let unitCost = b.unitCost != null && b.unitCost !== '' ? int(b.unitCost, 0, 1e12) : null;
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  if (unitCost == null && +b.cost > 0 && totalQty > 0) unitCost = Math.round(+b.cost / totalQty); // старый формат: сумма закупки
  const type = mode === 'in' ? 'receipt' : mode === 'out' ? 'writeoff' : 'adjust';
  const touched = new Map();
  let moved = 0;
  lines.forEach((l) => {
    const p = db.products.find((x) => x.id === l.productId);
    if (!p) throw fail(404, 'Товар не найден');
    if (p.colors.length && !p.colors.includes(l.color)) l.color = p.colors[0];
    const cur = NS.variantStock(p, variantKey(p, l.color), l.size);
    const delta = mode === 'in' ? l.qty : mode === 'out' ? -l.qty : l.qty - cur;
    changeStock(p, l.color, l.size, delta, type, reason || MOVE_TYPES[type], str(b.ref, 60), mode === 'in' ? unitCost : null);
    moved += Math.abs(delta);
    touched.set(p.id, p);
  });
  if (mode === 'in' && unitCost > 0 && b.updateCost !== false) touched.forEach((p) => { p.cost = unitCost; });
  const sum = mode === 'in' && unitCost > 0 ? unitCost * totalQty : 0;
  if (sum > 0 && b.recordExpense !== false) {
    if (!db.finance) db.finance = { openingBalance: 0, entries: [] };
    const names = [...touched.values()].map((p) => p.name).join(', ');
    db.finance.entries.unshift({
      id: NS.newId('f'), date: Date.now(), type: 'out', category: NS.PURCHASE_CATEGORY, amount: sum,
      note: 'Поступление: ' + names + ' · ' + totalQty + ' шт. × ' + unitCost + (reason ? ' · ' + reason : ''), createdAt: Date.now(),
    });
  }
  if (mode === 'out' && b.writeoffExpense && +b.cost > 0) {
    if (!db.finance) db.finance = { openingBalance: 0, entries: [] };
    db.finance.entries.unshift({
      id: NS.newId('f'), date: Date.now(), type: 'out', category: 'Списание товара', amount: Math.round(+b.cost),
      note: 'Списание: ' + reason, createdAt: Date.now(),
    });
  }
  return { mode, moved, products: [...touched.keys()] };
}


/* ---------- фото: хранятся в базе (таблица images), отдаются через CDN с долгим кэшем ---------- */
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return { ext: 'gif', mime: 'image/gif' };
  return null;
}
async function saveUpload(data) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(String(data || ''));
  if (!m) throw fail(400, 'Не удалось принять фото. Загрузите изображение ещё раз.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE) throw fail(413, 'Фото больше 3 МБ после сжатия. Попробуйте другое фото.');
  const kind = detectImage(buf);
  if (!kind) throw fail(400, 'Поддерживаются только JPG, PNG, WebP и GIF');
  const name = Date.now().toString(36) + crypto.randomBytes(8).toString('hex') + '.' + kind.ext;
  await Store.putImage(name, kind.mime, buf);
  return '/uploads/' + name;
}
async function serveUpload(res, name) {
  if (!/^[\w-]+\.(jpg|jpeg|png|webp|gif)$/i.test(name)) { res.writeHead(404); return res.end(); }
  let img = null;
  try { img = await Store.getImage(name); } catch (e) { console.error('image read failed:', e.message); }
  if (!img) {
    const file = path.join(LEGACY_UPLOADS, name);
    if (!ON_VERCEL && fs.existsSync(file)) img = { mime: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', data: fs.readFileSync(file) };
  }
  if (!img) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS)); return res.end('Не найдено'); }
  res.writeHead(200, Object.assign({
    'Content-Type': img.mime,
    'Content-Length': img.data.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'CDN-Cache-Control': 'public, max-age=31536000, immutable',
  }, SECURITY_HEADERS));
  res.end(img.data);
}

/* ---------- уведомления после записи заказа (вне транзакции) ---------- */
function useNotify(state, c) {
  if (state.notify !== undefined) c.cfg = state.notify;
  if (state.outbox) c.outbox = state.outbox;
  return c;
}
async function flushNotify(c) {
  try {
    const pending = c.pending.splice(0);
    if (pending.length) await Store.appendOutbox(pending.slice().reverse());
    if (c.cfgDirty) { c.cfgDirty = false; await Store.saveKv('notify', c.cfg); }
  } catch (e) { console.error('notify flush failed:', e.message); }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function afterOrder(order) {
  const c = { cfg: null, outbox: [], pending: [], cfgDirty: false };
  await Notify.runWith(c, async () => {
    try {
      const st = await Store.read(['notify']);
      c.cfg = st.notify;
      const s = Notify.status();
      const jobs = [];
      const lines = order.items.map((i) => '• ' + i.name + ' (' + i.color + ', ' + i.size + ') ×' + i.qty).join('\n');
      if (s.telegramReady || s.emailReady) {
        jobs.push(Notify.notifyAdmin('Новый заказ ' + order.id + '\n' + order.customer.name + ', ' + order.customer.phone
          + '\n' + lines + '\nИтого: ' + moneyUz(order.total) + '\n' + order.delivery + ' · ' + order.payment).catch(() => {}));
      }
      if (s.emailReady && order.customer.email) jobs.push(sendOrderMail(order).catch(() => {}));
      if (s.smsReady && order.customer.phone) jobs.push(sendOrderSms(order).catch(() => {}));
      if (jobs.length) await withTimeout(Promise.all(jobs), 6000);
    } catch (e) {
      console.error('order notify failed:', e.message);
    }
    await flushNotify(c);
  });
}

/* ---------- API ---------- */
async function requireAdmin(req, state) {
  if (!isAdminFor(req, state)) throw fail(401, 'Требуется вход в админ-панель');
}
const ADMIN_ALL = ALL_PARTS.concat(['notify']);

async function api(req, res, route) {
  const ip = clientIp(req);
  const body = req.method === 'POST' ? await readBody(req) : {};
  const nctx = { cfg: null, outbox: [], pending: [], cfgDirty: false };

  if (req.method === 'GET' && route === '/api/rev') {
    await ensureReady();
    const st = await Store.read([]);
    return send(res, 200, { rev: st.rev });
  }
  if (req.method === 'GET' && route === '/api/health') {
    let dbOk = false;
    let initialized = false;
    try { const st = await Store.read([]); dbOk = true; initialized = st.initialized; } catch (_) {}
    return send(res, dbOk && initialized ? 200 : 503, { ok: dbOk && initialized, storage: Store.storageKind(), db: dbOk, initialized });
  }
  if (req.method === 'GET' && route === '/api/db') {
    return readData(['products', 'settings'], () => send(res, 200, publicDB()));
  }
  if (req.method === 'POST' && route === '/api/promo') {
    await limit('promo:' + ip, 30, 10 * 60000, 'Слишком много попыток ввода промокода. Подождите 10 минут.');
    return readData(['settings'], () => {
      const c = NS.findPromo(body.code);
      if (!c) throw fail(404, 'Промокод не найден или больше не действует');
      return send(res, 200, { promo: publicPromo(c) });
    });
  }
  if (req.method === 'POST' && route === '/api/orders') {
    await limit('order:' + ip, 12, 60 * 60000, 'Слишком много заказов с одного устройства. Позвоните нам, и мы оформим заказ.');
    const order = await writeData(['products', 'settings'], (state) => { state.newOrders = true; return createOrder(body); });
    await afterOrder(order);
    return send(res, 200, { order });
  }
  if (req.method === 'POST' && route === '/api/subscribe') {
    const email = str(body.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Некорректный e-mail');
    await limit('sub:' + ip, 6, 60 * 60000);
    const code = await writeData(['settings', 'subscribers'], () => {
      if (!db.subscribers.includes(email)) db.subscribers.push(email);
      const welcome = NS.findPromo(db.settings.welcomeCode);
      return welcome ? welcome.code : '';
    });
    let mailed = false;
    let mailError = '';
    await Notify.runWith(nctx, async () => {
      const st = await Store.read(['notify']);
      nctx.cfg = st.notify;
      if (Notify.status().emailReady) {
        try { await withTimeout(sendWelcomeMail(email, code), 8000); mailed = true; } catch (e) { mailError = 'Не удалось отправить письмо'; console.error('welcome mail', e.message); }
      } else {
        mailError = 'Почта не настроена: Админ → Настройки → Почта и SMS';
      }
      await withTimeout(Notify.notifyAdmin('Новая подписка: ' + email).catch(() => {}), 5000);
      await flushNotify(nctx);
    });
    return send(res, 200, { ok: true, code, mailed, mailError });
  }

  if (req.method === 'POST' && route === '/api/admin/login') {
    sessionSecret(); // в продакшене без SESSION_SECRET вход отключён
    await limit('login-all', 60, 15 * 60000, 'Вход временно ограничен. Подождите 15 минут.');
    await limit('login:' + ip, 8, 15 * 60000, 'Слишком много попыток. Подождите 15 минут.');
    const token = await writeData(['auth'], () => {
      ensureAuth();
      if (!passwordOk(body.password || '')) return null;
      return issueSession();
    });
    if (!token) {
      await new Promise((r) => setTimeout(r, 600));
      throw fail(401, 'Неверный пароль');
    }
    await Store.clearHit('login:' + ip).catch(() => {});
    return send(res, 200, { token });
  }

  if (!route.startsWith('/api/admin/')) throw fail(404, 'Не найдено');

  // ответ отправляется только после успешной записи (COMMIT)
  const reply = (out) => { if (out !== undefined) send(res, 200, out); return out; };
  const adminRead = async (parts, fn) => reply(await Notify.runWith(nctx, () => readData(parts.concat(['auth']), async (state) => {
    await requireAdmin(req, state);
    useNotify(state, nctx);
    return fn(state);
  })));
  const adminWrite = async (parts, fn) => reply(await Notify.runWith(nctx, () => writeData(parts.concat(['auth']), async (state) => {
    await requireAdmin(req, state);
    useNotify(state, nctx);
    return fn(state);
  })));

  switch (req.method + ' ' + route) {
    case 'GET /api/admin/db':
      return adminRead(ADMIN_ALL, () => (Object.assign(adminDB(), { notify: Notify.status() })));
    case 'GET /api/admin/health':
      return adminRead([], async () => {
        const s = await Store.summary(await Store.getClient());
        return ({ storage: Store.storageKind(), production: IS_PROD, sessionSecret: (process.env.SESSION_SECRET || '').length >= 32, summary: s });
      });
    case 'GET /api/admin/notify':
      return adminRead(['notify', 'outbox'], () => ({ notify: Notify.status(), outbox: Notify.readOutbox(40) }));
    case 'POST /api/admin/notify':
      return adminWrite(['notify', 'outbox'], (state) => {
        const cur = Notify.loadCfg();
        const next = body.notify || body;
        if (next.email) {
          if (next.email.pass === '' || next.email.pass == null) next.email.pass = cur.email.pass;
          if (next.email.pass === '********') next.email.pass = cur.email.pass;
        }
        if (next.sms) {
          if (next.sms.password === '' || next.sms.password == null) next.sms.password = cur.sms.password;
          if (next.sms.password === '********') next.sms.password = cur.sms.password;
          next.sms.token = cur.sms.token;
          next.sms.tokenExpires = cur.sms.tokenExpires;
        }
        if (next.telegram) {
          if (!next.telegram.botToken || next.telegram.botToken.indexOf('••••') === 0) next.telegram.botToken = cur.telegram.botToken;
        }
        state.notify = Notify.saveCfg({
          email: Object.assign({}, cur.email, next.email || {}),
          sms: Object.assign({}, cur.sms, next.sms || {}),
          telegram: Object.assign({}, cur.telegram, next.telegram || {}),
        });
        nctx.cfgDirty = false;
        return ({ notify: Notify.status(), outbox: Notify.readOutbox(40) });
      });
    case 'POST /api/admin/notify-test': {
      const kind = str(body.kind, 20);
      const to = str(body.to, 120);
      await adminRead(['notify', 'outbox'], () => {});
      await Notify.runWith(nctx, async () => {
        try {
          if (kind === 'email') {
            if (!to) throw fail(400, 'Укажите e-mail для теста');
            await Notify.sendEmail(to, BRAND.name + ' — тест', 'Тестовое письмо от ' + BRAND.name + '. Если вы его видите — SMTP настроен верно.');
          } else if (kind === 'sms') {
            if (!to) throw fail(400, 'Укажите телефон для теста');
            await Notify.sendSmsSafe(to, BRAND.name + ': test SMS OK');
          } else if (kind === 'telegram') {
            await Notify.notifyAdmin(BRAND.name + ': тест Telegram OK');
          } else throw fail(400, 'kind: email | sms | telegram');
        } finally {
          await flushNotify(nctx);
        }
      });
      return send(res, 200, { ok: true, outbox: Notify.runWith(nctx, () => Notify.readOutbox(40)) });
    }
    case 'POST /api/admin/save':
      return adminWrite(ADMIN_ALL, () => { adminSave(body); return (adminDB()); });
    case 'POST /api/admin/order':
      return adminWrite(ADMIN_ALL, () => { setOrderStatus(body.id, body.status); return (adminDB()); });
    case 'POST /api/admin/order-paid':
      return adminWrite(ADMIN_ALL, () => { setOrderPaid(body.id, body.paid); return (adminDB()); });
    case 'POST /api/admin/finance':
      return adminWrite(ADMIN_ALL, () => { applyFinance(body); return (adminDB()); });
    case 'POST /api/admin/store-sale':
      return adminWrite(ADMIN_ALL, () => (Object.assign(adminDB(), { order: createStoreSale(body) })));
    case 'POST /api/admin/stock-move':
      return adminWrite(ADMIN_ALL, () => (Object.assign(adminDB(), { move: applyStockMove(body) })));
    case 'POST /api/admin/order-delete':
      // заказ не стирается: копия остаётся в таблице deleted_rows
      return adminWrite(ADMIN_ALL, () => {
        const o = db.orders.find((x) => x.id === body.id);
        if (!o) throw fail(404, 'Заказ не найден');
        // удаляемый заказ, который держит товар, сначала возвращает его на склад
        applyOrderStock(o, false, 'Отменён');
        db.orders = db.orders.filter((x) => x.id !== body.id);
        current.db.orders = db.orders;
        return (adminDB());
      });
    case 'POST /api/admin/upload':
      await adminRead([], () => {});
      return send(res, 200, { url: await saveUpload(body.data) });
    case 'POST /api/admin/password':
      return adminWrite(['auth'], () => {
        if (String(body.password || '').length < MIN_PASSWORD) throw fail(400, 'Пароль должен быть не короче ' + MIN_PASSWORD + ' символов');
        setPassword(body.password, false);
        return ({ ok: true, token: issueSession() });
      });
    case 'POST /api/admin/reset':
      return adminWrite(ADMIN_ALL, (state) => {
        if (IS_PROD) throw fail(403, 'Сброс к демо-данным отключён в рабочем магазине — чтобы не потерять заказы.');
        state.extra.push(Store.snapshotStatement(state, 'before-reset'));
        const fresh = NS.seedDB();
        Object.assign(db, fresh);
        bind(Object.assign(state, { db }));
        return (adminDB());
      });
    case 'POST /api/admin/import':
      return adminWrite(ADMIN_ALL, (state) => {
        const d = body.db;
        if (!d || !Array.isArray(d.products) || !d.settings) throw fail(400, 'Файл не похож на резервную копию Nargizka Shop');
        state.extra.push(Store.snapshotStatement(state, 'before-import'));
        const next = NS.migrate(JSON.parse(JSON.stringify(d)));
        next.products = next.products.map(sanitizeProduct);
        ['products', 'orders', 'subscribers', 'settings', 'finance', 'version'].forEach((k) => { db[k] = next[k]; });
        bind(Object.assign(state, { db }));
        return (adminDB());
      });
    case 'POST /api/admin/revoke-sessions':
      // «выйти на всех устройствах»: все выданные токены перестают действовать, текущему выдаётся новый
      return adminWrite(['auth'], () => {
        auth = Object.assign({}, auth, { epoch: (auth.epoch || 0) + 1 });
        return ({ ok: true, token: issueSession() });
      });
    case 'POST /api/admin/logout':
      return send(res, 200, { ok: true });
    default: throw fail(404, 'Не найдено');
  }
}

/* ---------- статика ---------- */
function serveStatic(req, res, urlPath) {
  if (urlPath === '/admin' || urlPath === '/admin.html') {
    res.writeHead(301, { Location: '/admin/' });
    return res.end();
  }
  const parts = urlPath.split('/').filter(Boolean);
  if (parts[0] === 'uploads') return serveUpload(res, parts.slice(1).join('/'));
  if (['data', 'db', 'scripts', 'docs', 'node_modules', 'api'].includes(parts[0]) || parts.some((p) => p.startsWith('.') || p.startsWith('_'))
    || /\.(tmp|md|sqlite|sqlite-wal|sqlite-shm|bundle)$/i.test(urlPath) || /^\/(server|storage|notify)\.js$/.test(urlPath) || urlPath === '/package.json' || urlPath === '/vercel.json') {
    res.writeHead(404); return res.end();
  }
  // Нельзя path.join(ROOT, '/...') — на POSIX второй абсолютный сегмент сбрасывает ROOT
  const rel = urlPath.replace(/^\/+/, '');
  const base = STATIC_ROOT;
  let file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  if (!rel || urlPath.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({ 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SECURITY_HEADERS);
    res.writeHead(200, headers);
    res.end(data);
  });
}

function resolveUrlPath(req) {
  let parsed;
  try { parsed = new URL(req.url || '/', 'http://localhost'); } catch (e) { return null; }
  // Vercel rewrite → /api?__path=/original — иначе pathname становится /api и ломает маршруты
  const viaQuery = parsed.searchParams.get('__path');
  if (viaQuery) {
    const q = new URLSearchParams(parsed.search);
    q.delete('__path');
    const rest = q.toString();
    req.url = viaQuery + (rest ? '?' + rest : '');
    try { return decodeURIComponent(viaQuery.split('?')[0] || '/'); } catch (_) { return null; }
  }
  try { return decodeURIComponent(parsed.pathname || '/'); } catch (_) { return null; }
}

function handleError(res, e) {
  if (e && e.isDbError) {
    console.error('db error:', e.code, e.message);
    return send(res, 503, { error: 'База данных временно недоступна. Попробуйте через минуту.' });
  }
  if (!e.status) console.error(e);
  const extra = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined;
  return send(res, e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервера' }, extra);
}

function requestListener(req, res) {
  const urlPath = resolveUrlPath(req);
  if (!urlPath) { res.writeHead(400); return res.end(); }
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    api(req, res, urlPath === '/api' ? '/api/' : urlPath).catch((e) => {
      if (!res.headersSent) handleError(res, e);
    });
    return;
  }
  Promise.resolve(serveStatic(req, res, urlPath)).catch((e) => { if (!res.headersSent) handleError(res, e); });
}

if (require.main === module && !ON_VERCEL) {
  http.createServer(requestListener).listen(PORT, () => {
    console.log('Nargizka Shop:  http://localhost:' + PORT + '  (хранилище: ' + Store.storageKind() + ')');
    console.log('Админ-панель:   http://localhost:' + PORT + '/admin/' + (process.env.ADMIN_PASSWORD ? '' : '  (локально, пока пароль не сменён: admin)'));
  });
}

module.exports = requestListener;
