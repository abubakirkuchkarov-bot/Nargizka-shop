// Сервер Nargizka Shop без внешних зависимостей: node server.js
// Витрина — http://localhost:3000, админ-панель — http://localhost:3000/admin/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NS = require('./js/store.js');
const Notify = require('./notify');

const storage = require('./storage');
const paths = storage.ensureRuntimeData();
const ROOT = paths.ROOT;
const PORT = +process.env.PORT || 3000;
const DATA_DIR = paths.DATA_DIR;
const DB_FILE = paths.DB_FILE;
const AUTH_FILE = paths.AUTH_FILE;
const UPLOADS = paths.UPLOADS;
const ON_VERCEL = paths.ON_VERCEL;
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
const MAX_BODY = 25 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const SESSION_TTL = 7 * 86400000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const DELIVERY = { courier: 'Курьер', express: 'Экспресс', pickup: 'Самовывоз' };

/* ---------- данные ---------- */
let db;
let rev = Date.now();

function persist() {
  rev++;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

function setDB(next) {
  db = NS.migrate(next);
  NS.db = db;
}

(function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      setDB(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
      return;
    } catch (e) {
      const broken = DB_FILE.replace('.json', `.broken-${Date.now()}.json`);
      fs.renameSync(DB_FILE, broken);
      console.error('Файл данных повреждён, сохранён как', broken);
    }
  }
  setDB(NS.seedDB());
  persist();
})();

/* ---------- пароль и сессии ---------- */
const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
let auth = null;
try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch (e) { auth = null; }
function setPassword(pw, isDefault) {
  const salt = crypto.randomBytes(16).toString('hex');
  auth = { salt, hash: hashPassword(pw, salt), isDefault: !!isDefault };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth));
}
if (!auth || !auth.hash) setPassword(process.env.ADMIN_PASSWORD || 'admin', !process.env.ADMIN_PASSWORD);

const attempts = new Map();
const SESSION_SECRET = process.env.SESSION_SECRET || auth.salt || crypto.randomBytes(16).toString('hex');

function passwordOk(pw) {
  const a = Buffer.from(hashPassword(pw, auth.salt), 'hex');
  const b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function issueSession() {
  const exp = String(Date.now() + SESSION_TTL);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(exp).digest('hex');
  return exp + '.' + sig;
}
function isAdmin(req) {
  const m = /^Bearer ([\da-f]+\.[\da-f]+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(exp).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expect, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  } catch (_) { return false; }
  return +exp > Date.now();
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
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function publicPromo(c) {
  return { code: c.code, type: c.type, value: c.value, minSum: c.minSum, active: true };
}
function publicDB() {
  const settings = Object.assign({}, db.settings);
  const welcome = NS.findPromo(settings.welcomeCode);
  settings.promoCodes = welcome ? [publicPromo(welcome)] : [];
  return { rev, db: { version: db.version, products: db.products.filter((p) => p.visible), settings, orders: [], subscribers: [] } };
}
function adminDB() {
  return { rev, db, defaultPassword: !!auth.isDefault };
}

function activeSizes() {
  const list = db && db.settings && Array.isArray(db.settings.sizes) ? db.settings.sizes : null;
  return (list && list.length ? list : NS.DEFAULT_SIZES).map((x) => String(x).trim()).filter(Boolean);
}
function sanitizeImage(src) {
  const s = str(src, 2000);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : null;
}
function sanitizeProduct(p) {
  const stock = {};
  activeSizes().forEach((s) => { stock[s] = int(p.stock && p.stock[s], 0, 100000); });
  if (p.stock && typeof p.stock === 'object') {
    Object.keys(p.stock).forEach((k) => {
      const key = str(k, 16);
      if (key && !(key in stock)) stock[key] = int(p.stock[k], 0, 100000);
    });
  }
  return {
    id: str(p.id, 40) || NS.newId('p'),
    sku: str(p.sku, 40),
    name: str(p.name, 200),
    category: str(p.category, 40),
    price: int(p.price, 0, 1e12),
    discount: int(p.discount, 0, 90),
    colors: (Array.isArray(p.colors) ? p.colors : []).map((c) => str(c, 40)).filter(Boolean).slice(0, 40),
    stock,
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
}

function moveStock(order, sign) {
  order.items.forEach((it) => {
    const p = db.products.find((x) => x.id === it.id);
    if (!p) return;
    p.stock[it.size] = Math.max(0, (+p.stock[it.size] || 0) + sign * it.qty);
    p.sold = Math.max(0, (p.sold || 0) - sign * it.qty);
  });
}

/* ---------- заказ с витрины: цены и остатки проверяются на сервере ---------- */

function moneyUz(n) {
  return new Intl.NumberFormat('ru-RU').format(+n || 0) + ' сум';
}
async function sendWelcomeMail(email, code) {
  const subject = 'Nargizka Shop — ваш промокод';
  const text = code
    ? ('Спасибо за подписку!\n\nВаш промокод на первый заказ: ' + code + '\n\nПримените его в корзине на сайте.\n\n— Nargizka Shop')
    : ('Спасибо за подписку на новости Nargizka Shop!\n\n— Nargizka Shop');
  const html = '<div style="font-family:Georgia,serif;line-height:1.5;color:#111">'
    + '<h2 style="font-weight:400">Nargizka Shop</h2>'
    + '<p>Спасибо за подписку!</p>'
    + (code ? ('<p>Ваш промокод на первый заказ:</p><p style="font-size:28px;letter-spacing:.12em"><b>' + code + '</b></p><p>Примените его в корзине на сайте.</p>') : '')
    + '<p style="color:#706a62">— Nargizka Shop</p></div>';
  await Notify.sendEmail(email, subject, text, html);
}
async function sendOrderMail(order) {
  if (!order.customer || !order.customer.email) return;
  const items = (order.items || []).map((i) => i.name + ' (' + i.color + ', ' + i.size + ') ×' + i.qty).join('\n');
  const text = 'Заказ ' + order.id + ' принят.\n\n'
    + items + '\n\nИтого: ' + moneyUz(order.total)
    + '\nДоставка: ' + (order.delivery || '')
    + '\nОплата: ' + (order.payment || '')
    + '\n\nМы свяжемся с вами для подтверждения.\n— Nargizka Shop';
  const html = '<div style="font-family:Georgia,serif;line-height:1.5"><h2 style="font-weight:400">Заказ ' + order.id + '</h2>'
    + '<p>Спасибо! Заказ принят.</p><pre style="font-family:inherit">' + items.replace(/</g, '') + '</pre>'
    + '<p><b>Итого: ' + moneyUz(order.total) + '</b></p>'
    + '<p>Доставка: ' + (order.delivery || '') + '<br>Оплата: ' + (order.payment || '') + '</p>'
    + '<p style="color:#706a62">Мы свяжемся с вами для подтверждения.</p></div>';
  await Notify.sendEmail(order.customer.email, 'Nargizka Shop — заказ ' + order.id, text, html);
}
async function sendOrderSms(order) {
  if (!order.customer || !order.customer.phone) return;
  const text = 'Nargizka: zakaz ' + order.id + ' qabul qilindi. Jami: ' + Math.round(order.total) + " so'm. Tez orada bog'lanamiz.";
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
    const color = p.colors.includes(it.color) ? it.color : p.colors[0];
    const k = p.id + '|' + it.size;
    need[k] = (need[k] || 0) + it.qty;
    if (need[k] > (+p.stock[it.size] || 0)) throw fail(409, `${p.name} (${it.size}): в наличии только ${+p.stock[it.size] || 0} шт.`);
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
    items: lines.map((l) => ({ id: l.p.id, name: l.p.name, color: l.color, size: l.size, qty: l.qty, price: NS.finalPrice(l.p) })),
    subtotal: t.subtotal,
    autoDiscount: t.autoDiscount,
    promo: t.code ? t.code.code : '',
    promoDiscount: t.promoDiscount,
    shipping: t.shipping,
    total: t.total,
    status: 'Новый',
  };
  moveStock(order, -1);
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

function adminSave(b) {
  (Array.isArray(b.upserts) ? b.upserts : []).forEach((u) => {
    if (!u || !u.p) return;
    const next = sanitizeProduct(u.p);
    const idx = db.products.findIndex((x) => x.id === next.id);
    if (idx < 0) {
      db.products.splice(int(u.index, 0, db.products.length), 0, next);
      return;
    }
    const old = db.products[idx];
    // остатки меняются и заказами; если администратор их не трогал — оставляем серверные
    if (u.base && JSON.stringify(u.base.stock) === JSON.stringify(u.p.stock)) next.stock = old.stock;
    next.sold = old.sold;
    db.products[idx] = next;
  });
  const del = new Set(Array.isArray(b.deletes) ? b.deletes : []);
  if (del.size) db.products = db.products.filter((p) => !del.has(p.id));
  if (b.settings && typeof b.settings === 'object') {
    const used = {};
    db.settings.promoCodes.forEach((c) => { used[c.code] = c.used || 0; });
    const next = NS.migrate({ settings: b.settings }).settings;
    next.promoCodes.forEach((c) => { c.used = used[c.code] || 0; });
    next.usdRate = Math.max(1, +next.usdRate || 12700);
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
  const was = o.status === 'Отменён';
  const now = status === 'Отменён';
  if (was !== now) moveStock(o, now ? 1 : -1);
  o.status = status;
  persist();
}

/** Продажа с витрины магазина: сразу списывает склад и попадает в кассу как доставленный заказ */
function createStoreSale(b) {
  const itemsIn = Array.isArray(b.items) ? b.items : [];
  if (!itemsIn.length) throw fail(400, 'Добавьте хотя бы один товар');
  const lines = [];
  const need = {};
  itemsIn.slice(0, 40).forEach((it) => {
    const p = db.products.find((x) => x.id === str(it.id, 40));
    if (!p) throw fail(404, 'Товар не найден');
    const size = str(it.size, 16);
    const qty = int(it.qty, 1, 100);
    if (!size) throw fail(400, 'Укажите размер');
    if (!(size in (p.stock || {})) && !activeSizes().includes(size)) throw fail(400, 'Некорректный размер: ' + size);
    const color = p.colors && p.colors.includes(str(it.color, 40)) ? str(it.color, 40) : (p.colors && p.colors[0]) || '';
    const price = Math.max(0, Math.round(+it.price || NS.finalPrice(p)));
    const k = p.id + '|' + size;
    need[k] = (need[k] || 0) + qty;
    if (need[k] > (+p.stock[size] || 0)) throw fail(409, p.name + ' (' + size + '): на складе только ' + (+p.stock[size] || 0) + ' шт.');
    lines.push({ p, size, qty, color, price });
  });
  const payName = str(b.payment, 60) || 'Наличные в магазине';
  const note = str(b.note, 300);
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  let id;
  do { id = 'MS-' + crypto.randomInt(100000, 999999); } while (db.orders.some((o) => o.id === id));
  const order = {
    id,
    date: +b.date || Date.now(),
    channel: 'store',
    customer: {
      name: str(b.customerName, 80) || 'Покупатель в магазине',
      phone: str(b.customerPhone, 40) || '—',
      email: '',
      city: 'Ташкент',
      address: 'Магазин (витрина)',
      comment: note,
    },
    delivery: 'Магазин (витрина)',
    payment: payName,
    items: lines.map((l) => ({ id: l.p.id, name: l.p.name, color: l.color, size: l.size, qty: l.qty, price: l.price })),
    subtotal: total,
    autoDiscount: 0,
    promo: '',
    promoDiscount: 0,
    shipping: 0,
    total,
    status: 'Доставлен',
  };
  moveStock(order, -1);
  db.orders.unshift(order);
  persist();
  return order;
}

/** Приход / списание склада без онлайн-заказа */
function applyStockMove(b) {
  const mode = b.mode === 'out' ? 'out' : 'in';
  const p = db.products.find((x) => x.id === str(b.productId, 40));
  if (!p) throw fail(404, 'Товар не найден');
  if (!p.stock) p.stock = {};
  const size = str(b.size, 16);
  const qty = int(b.qty, 1, 100000);
  if (!size) throw fail(400, 'Укажите размер');
  if (mode === 'out' && qty > (+p.stock[size] || 0)) {
    throw fail(409, 'Нельзя списать больше, чем есть: ' + (+p.stock[size] || 0) + ' шт.');
  }
  p.stock[size] = Math.max(0, (+p.stock[size] || 0) + (mode === 'in' ? qty : -qty));
  const cost = Math.max(0, Math.round(+b.cost || 0));
  if (mode === 'in' && cost > 0) {
    if (!db.finance) db.finance = { openingBalance: 0, entries: [] };
    db.finance.entries.unshift({
      id: NS.newId('f'),
      date: Date.now(),
      type: 'out',
      category: 'Закупка товара',
      amount: cost,
      note: 'Приход на склад: ' + p.name + ' · ' + size + ' ×' + qty + (b.note ? ' · ' + str(b.note, 200) : ''),
      createdAt: Date.now(),
    });
  }
  if (mode === 'out' && b.writeoffExpense && cost > 0) {
    if (!db.finance) db.finance = { openingBalance: 0, entries: [] };
    db.finance.entries.unshift({
      id: NS.newId('f'),
      date: Date.now(),
      type: 'out',
      category: 'Прочее',
      amount: cost,
      note: 'Списание со склада: ' + p.name + ' · ' + size + ' ×' + qty + (b.note ? ' · ' + str(b.note, 200) : ''),
      createdAt: Date.now(),
    });
  }
  persist();
  return { product: p, mode, size, qty };
}

function saveUpload(data) {
  const m = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(data || ''));
  if (!m) throw fail(400, 'Не удалось принять фото. Загрузите изображение ещё раз.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE) throw fail(413, 'Фото больше 10 МБ');
  const extMap = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'png', 'svg+xml': 'png', heic: 'jpg', heif: 'jpg', avif: 'jpg' };
  const ext = extMap[m[1].toLowerCase()] || 'jpg';
  const name = Date.now().toString(36) + crypto.randomBytes(5).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/uploads/' + name;
}

/* ---------- API ---------- */
async function api(req, res, route) {
  const ip = req.socket.remoteAddress || '';
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (req.method === 'GET' && route === '/api/db') return send(res, 200, publicDB());
  if (req.method === 'GET' && route === '/api/rev') return send(res, 200, { rev });
  if (req.method === 'GET' && route === '/api/health') {
    let listing = [];
    try { listing = fs.readdirSync(ROOT); } catch (e) { listing = ['err:' + e.message]; }
    return send(res, 200, {
      root: ROOT,
      cwd: process.cwd(),
      onVercel: ON_VERCEL,
      hasIndex: fs.existsSync(path.join(ROOT, 'index.html')),
      hasAdmin: fs.existsSync(path.join(ROOT, 'admin', 'index.html')),
      listing: listing.slice(0, 50),
    });
  }

  if (req.method === 'POST' && route === '/api/promo') {
    const c = NS.findPromo(body.code);
    if (!c) throw fail(404, 'Промокод не найден или больше не действует');
    return send(res, 200, { promo: publicPromo(c) });
  }
  if (req.method === 'POST' && route === '/api/orders') return send(res, 200, { order: createOrder(body) });
  if (req.method === 'POST' && route === '/api/subscribe') {
    const email = str(body.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Некорректный e-mail');
    if (!db.subscribers.includes(email)) { db.subscribers.push(email); persist(); }
    const welcome = NS.findPromo(db.settings.welcomeCode);
    const code = welcome ? welcome.code : '';
    let mailed = false;
    let mailError = '';
    const st = Notify.status();
    if (st.emailReady) {
      try {
        await sendWelcomeMail(email, code);
        mailed = true;
      } catch (e) {
        mailError = e.message || 'Не удалось отправить письмо';
        console.error('welcome mail', mailError);
      }
    } else {
      mailError = 'Почта не настроена: Админ → Настройки → Почта и SMS';
    }
    Notify.notifyAdmin('Новая подписка: ' + email + (code ? (' · промокод ' + code) : '')).catch(() => {});
    return send(res, 200, { ok: true, code, mailed, mailError });
  }

  if (req.method === 'POST' && route === '/api/admin/login') {
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw fail(429, 'Слишком много попыток. Подождите 5 минут.');
    if (!passwordOk(body.password || '')) {
      a.n++;
      if (a.n >= 8) { a.n = 0; a.until = Date.now() + 5 * 60000; }
      attempts.set(ip, a);
      await new Promise((r) => setTimeout(r, 500));
      throw fail(401, 'Неверный пароль');
    }
    attempts.delete(ip);
    return send(res, 200, { token: issueSession() });
  }

  if (!route.startsWith('/api/admin/')) throw fail(404, 'Не найдено');
  if (!isAdmin(req)) throw fail(401, 'Требуется вход в админ-панель');

  switch (req.method + ' ' + route) {
    case 'GET /api/admin/db': return send(res, 200, Object.assign(adminDB(), { notify: Notify.status() }));
    case 'GET /api/admin/notify': return send(res, 200, { notify: Notify.status(), outbox: Notify.readOutbox(40) });
    case 'POST /api/admin/notify': {
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
      const saved = Notify.saveCfg({
        email: Object.assign({}, cur.email, next.email || {}),
        sms: Object.assign({}, cur.sms, next.sms || {}),
        telegram: Object.assign({}, cur.telegram, next.telegram || {}),
      });
      return send(res, 200, { notify: Notify.status(), outbox: Notify.readOutbox(40) });
    }
    case 'POST /api/admin/notify-test': {
      const kind = str(body.kind, 20);
      const to = str(body.to, 120);
      if (kind === 'email') {
        if (!to) throw fail(400, 'Укажите e-mail для теста');
        await Notify.sendEmail(to, 'Nargizka Shop — тест', 'Тестовое письмо от Nargizka Shop. Если вы его видите — SMTP настроен верно.');
        return send(res, 200, { ok: true, outbox: Notify.readOutbox(40) });
      }
      if (kind === 'sms') {
        if (!to) throw fail(400, 'Укажите телефон для теста');
        await Notify.sendSmsSafe(to, 'Nargizka Shop: test SMS OK');
        return send(res, 200, { ok: true, outbox: Notify.readOutbox(40) });
      }
      if (kind === 'telegram') {
        await Notify.notifyAdmin('Nargizka Shop: тест Telegram OK');
        return send(res, 200, { ok: true, outbox: Notify.readOutbox(40) });
      }
      throw fail(400, 'kind: email | sms | telegram');
    }
    case 'POST /api/admin/save': adminSave(body); return send(res, 200, adminDB());
    case 'POST /api/admin/order': setOrderStatus(body.id, body.status); return send(res, 200, adminDB());
    case 'POST /api/admin/finance':
      applyFinance(body);
      return send(res, 200, adminDB());
    case 'POST /api/admin/store-sale':
      return send(res, 200, Object.assign(adminDB(), { order: createStoreSale(body) }));
    case 'POST /api/admin/stock-move':
      return send(res, 200, Object.assign(adminDB(), { move: applyStockMove(body) }));
    case 'POST /api/admin/order-delete':
      db.orders = db.orders.filter((o) => o.id !== body.id);
      persist();
      return send(res, 200, adminDB());
    case 'POST /api/admin/upload': return send(res, 200, { url: saveUpload(body.data) });
    case 'POST /api/admin/password':
      if (String(body.password || '').length < 6) throw fail(400, 'Пароль должен быть не короче 6 символов');
      setPassword(body.password, false);
      return send(res, 200, { ok: true });
    case 'POST /api/admin/reset':
      setDB(NS.seedDB());
      persist();
      return send(res, 200, adminDB());
    case 'POST /api/admin/import': {
      const d = body.db;
      if (!d || !Array.isArray(d.products) || !d.settings) throw fail(400, 'Файл не похож на резервную копию Nargizka Shop');
      d.products = d.products.map(sanitizeProduct);
      setDB(d);
      persist();
      return send(res, 200, adminDB());
    }
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
  if (parts[0] === 'data' || parts.some((p) => p.startsWith('.') || p.startsWith('_')) || /\.(tmp|md)$/i.test(urlPath) || urlPath === '/server.js') {
    res.writeHead(404); return res.end();
  }
  // Нельзя path.join(ROOT, '/...') — на POSIX второй абсолютный сегмент сбрасывает ROOT
  const rel = urlPath.replace(/^\/+/, '');
  const base = parts[0] === 'uploads' ? ROOT : STATIC_ROOT;
  let file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  if (!rel || urlPath.endsWith('/')) file = path.join(file, 'index.html');
  // uploads на Vercel лежат в /tmp
  if (parts[0] === 'uploads') {
    file = path.normalize(path.join(UPLOADS, parts.slice(1).join(path.sep)));
    if (!file.startsWith(UPLOADS)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = parts[0] === 'uploads' ? 'public, max-age=31536000, immutable' : 'no-cache';
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
    return decodeURIComponent(viaQuery.split('?')[0] || '/');
  }
  return decodeURIComponent(parsed.pathname || '/');
}

function requestListener(req, res) {
  const urlPath = resolveUrlPath(req);
  if (!urlPath) { res.writeHead(400); return res.end(); }
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    api(req, res, urlPath === '/api' ? '/api/' : urlPath).catch((e) => {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервера' });
    });
    return;
  }
  serveStatic(req, res, urlPath);
}

if (require.main === module && !ON_VERCEL) {
  http.createServer(requestListener).listen(PORT, () => {
    console.log('Nargizka Shop:  http://localhost:' + PORT);
    console.log('Админ-панель:   http://localhost:' + PORT + '/admin/' + (auth.isDefault ? '  (пароль по умолчанию: admin — смените его в настройках)' : ''));
  });
}

module.exports = requestListener;
