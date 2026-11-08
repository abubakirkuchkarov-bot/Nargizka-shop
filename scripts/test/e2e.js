/**
 * Сквозные тесты Nargizka Shop в режиме «как в продакшене»:
 * эмулятор Turso + 2 экземпляра сервера (VERCEL_ENV=production) на одной базе.
 * Запуск: node scripts/test/e2e.js
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-e2e-'));
const MOCK = 18787;
const A = 18801;
const B = 18802;
const C = 18803; // без SESSION_SECRET
const TOKEN = 'e2e-token';
const ADMIN_PW = 'Very-Strong-Pass-2026';
const procs = [];
let passed = 0;
let failed = 0;

const baseEnv = Object.assign({}, process.env, {
  TURSO_DATABASE_URL: 'http://127.0.0.1:' + MOCK, TURSO_AUTH_TOKEN: TOKEN,
  VERCEL: '1', VERCEL_ENV: 'production', ADMIN_PASSWORD: ADMIN_PW, SESSION_SECRET: 'x'.repeat(48),
});
function start(args, env, marker) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const on = (d) => { out += d; if (out.includes(marker)) resolve(p); };
    p.stdout.on('data', on);
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => reject(new Error('exited ' + c + ': ' + out)));
  });
}
async function req(port, method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch('http://127.0.0.1:' + port + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text, headers: r.headers };
}
function check(name, cond, info) {
  if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗', name, info !== undefined ? JSON.stringify(info).slice(0, 300) : ''); }
}
const orderBody = (items, extra) => Object.assign({
  customer: { name: 'Покупатель Е2Е', phone: '+998 91 123 45 67', email: '', city: 'Ташкент', address: 'Чиланзар, 1' },
  delivery: 'courier', payment: 'cash', items,
}, extra || {});

async function main() {
  await start(['scripts/test/hrana-mock.js', path.join(tmp, 'db.sqlite'), String(MOCK), TOKEN], process.env, 'hrana mock');

  console.log('\n# До переноса данных');
  const pre = await start(['scripts/test/serve.js', String(A)], baseEnv, 'listening');
  let r = await req(A, 'GET', '/api/db');
  check('витрина отвечает 503 «готовится к запуску», а не демо-данными', r.status === 503 && /готовится/.test(r.json.error), r);
  pre.kill(); procs.splice(procs.indexOf(pre), 1);
  await new Promise((res) => setTimeout(res, 300));

  console.log('\n# Перенос');
  execFileSync(process.execPath, ['scripts/migrate-to-turso.js', '--apply'], { cwd: ROOT, env: baseEnv, stdio: 'pipe' });
  check('миграция выполнена', true);

  await start(['scripts/test/serve.js', String(A)], baseEnv, 'listening');
  await start(['scripts/test/serve.js', String(B)], baseEnv, 'listening');
  await start(['scripts/test/serve.js', String(C)], Object.assign({}, baseEnv, { SESSION_SECRET: '' }), 'listening');

  console.log('\n# Витрина');
  r = await req(A, 'GET', '/');
  check('главная страница отдаётся', r.status === 200 && /Nargizka/.test(r.text));
  check('заголовки безопасности', r.headers.get('x-content-type-options') === 'nosniff');
  r = await req(A, 'GET', '/admin/');
  check('админка отдаётся', r.status === 200 && /admin/i.test(r.text));
  r = await req(A, 'GET', '/api/db');
  const products = r.json.db.products;
  check('52 товара на витрине', products.length === 52, products.length);
  check('заказы и подписчики не утекают в публичный API', r.json.db.orders.length === 0 && r.json.db.subscribers.length === 0);
  check('в публичных настройках только приветственный промокод', (r.json.db.settings.promoCodes || []).length <= 1);
  const health = await req(A, 'GET', '/api/health');
  check('/api/health без путей и секретов', health.status === 200 && !/root|cwd|listing|token/i.test(health.text), health.json);

  const settings = r.json.db.settings;
  const payKey = Object.keys(settings.payments).find((k) => settings.payments[k]);
  const p = products.find((x) => Object.values(x.stock).some((q) => q >= 3));
  const size = Object.keys(p.stock).find((s) => p.stock[s] >= 3);
  const before = p.stock[size];

  console.log('\n# Корзина и заказ');
  r = await req(A, 'POST', '/api/promo', { code: 'НЕТ-ТАКОГО' });
  check('неизвестный промокод → 404', r.status === 404);
  r = await req(A, 'POST', '/api/orders', orderBody([{ id: p.id, color: p.colors[0], size, qty: 1, price: 1 }], { payment: payKey }));
  check('заказ оформлен', r.status === 200 && /^NS-\d{6}$/.test(r.json.order.id), r.json);
  const order1 = r.json.order;
  check('цена берётся с сервера, а не из корзины', order1.items[0].price > 1, order1.items[0]);
  r = await req(B, 'GET', '/api/db');
  const p2 = r.json.db.products.find((x) => x.id === p.id);
  check('остаток уменьшился и виден другому экземпляру', p2.stock[size] === before - 1, [before, p2.stock[size]]);
  r = await req(A, 'POST', '/api/orders', orderBody([{ id: p.id, color: p.colors[0], size, qty: 999 }], { payment: payKey }));
  check('нельзя заказать больше, чем есть', r.status === 409 || r.status === 400, r.json);
  r = await req(A, 'POST', '/api/orders', orderBody([{ id: p.id, color: p.colors[0], size, qty: 1 }], { payment: payKey, customer: { name: 'A', phone: '1' } }));
  check('проверка имени/телефона', r.status === 400);

  console.log('\n# Админка: вход и безопасность');
  r = await req(A, 'GET', '/api/admin/db');
  check('без входа → 401', r.status === 401);
  r = await req(A, 'POST', '/api/admin/login', { password: 'admin' });
  check('пароль «admin» в продакшене не работает', r.status === 401);
  r = await req(C, 'POST', '/api/admin/login', { password: ADMIN_PW });
  check('без SESSION_SECRET вход отключён (503)', r.status === 503 && /SESSION_SECRET/.test(r.json.error), r.json);
  r = await req(A, 'POST', '/api/admin/login', { password: ADMIN_PW });
  check('вход по ADMIN_PASSWORD', r.status === 200 && r.json.token, r.json);
  let token = r.json.token;
  r = await req(B, 'GET', '/api/admin/db', null, token);
  check('сессия работает на другом экземпляре (общий SESSION_SECRET)', r.status === 200);
  check('admin db: тестовые заказы не импортированы как реальные', r.json.db.orders.length === 1 && r.json.db.orders[0].id === order1.id, r.json.db.orders.map((o) => o.id));
  check('ответ админки не содержит хеш пароля', !/"hash"|"salt"/.test(r.text));
  const forged = token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  r = await req(A, 'GET', '/api/admin/db', null, forged);
  check('подделанный токен → 401', r.status === 401);
  for (const u of ['/data/db.json', '/server.js', '/db/store.js', '/scripts/migrate-to-turso.js', '/.env', '/package.json', '/data/local.sqlite']) {
    r = await req(A, 'GET', u);
    check('закрыт ' + u, r.status === 404 || r.status === 403, r.status);
  }

  console.log('\n# Админка: склад, продажи, финансы, заказы');
  const admin = (port, url, body) => req(port, 'POST', url, body, token);
  r = await admin(A, '/api/admin/stock-move', { mode: 'in', productId: p.id, size, qty: 5, cost: 100000, note: 'e2e' });
  check('приход на склад', r.status === 200 && r.json.db.products.find((x) => x.id === p.id).stock[size] === before - 1 + 5);
  check('закупка попала в финансы', r.json.db.finance.entries.some((e) => /e2e/.test(e.note)));
  r = await admin(B, '/api/admin/store-sale', { items: [{ id: p.id, size, qty: 2 }], payment: 'Наличные в магазине' });
  check('продажа в магазине', r.status === 200 && /^MS-/.test(r.json.order.id));
  check('склад после продажи', r.json.db.products.find((x) => x.id === p.id).stock[size] === before - 1 + 5 - 2);
  r = await admin(A, '/api/admin/order', { id: order1.id, status: 'Отменён' });
  check('отмена заказа возвращает товар', r.status === 200 && r.json.db.products.find((x) => x.id === p.id).stock[size] === before + 3);
  r = await admin(A, '/api/admin/finance', { entry: { type: 'in', amount: 500000, category: 'Прочий приход', note: 'e2e-in' } });
  check('приход в кассу', r.status === 200 && r.json.db.finance.entries.some((e) => e.note === 'e2e-in'));
  r = await admin(A, '/api/admin/finance', { openingBalance: 1000000 });
  check('стартовый остаток', r.json.db.finance.openingBalance === 1000000);

  console.log('\n# Админка: товары и фото');
  const db0 = (await req(A, 'GET', '/api/admin/db', null, token)).json.db;
  const prod = JSON.parse(JSON.stringify(db0.products[0]));
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
  r = await admin(A, '/api/admin/upload', { data: 'data:image/jpeg;base64,' + jpeg.toString('base64') });
  check('фото загружено в базу', r.status === 200 && /^\/uploads\/[\w]+\.jpg$/.test(r.json.url), r.json);
  const url = r.json.url;
  r = await req(B, 'GET', url);
  check('фото отдаётся другим экземпляром (постоянное хранение)', r.status === 200 && r.headers.get('content-type') === 'image/jpeg');
  check('фото кэшируется CDN', /immutable/.test(r.headers.get('cache-control') || ''));
  r = await admin(A, '/api/admin/upload', { data: 'data:image/jpeg;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') });
  check('не-картинка под видом JPEG отклоняется', r.status === 400);
  prod.images = [url];
  prod.price = prod.price + 10000;
  const base = JSON.parse(JSON.stringify(db0.products[0]));
  r = await admin(B, '/api/admin/save', { upserts: [{ p: prod, base, index: 0 }], deletes: [], settings: null });
  check('товар сохранён с фото', r.status === 200 && r.json.db.products[0].images[0] === url);
  const newP = Object.assign({}, prod, { id: 'pe2e', sku: 'E2E-1', name: 'Платье «Тест Е2Е»', stock: { S: 1 } });
  r = await admin(A, '/api/admin/save', { upserts: [{ p: newP, base: null, index: 0 }], deletes: [], settings: null });
  check('новый товар добавлен', r.json.db.products.some((x) => x.id === 'pe2e'));
  r = await admin(A, '/api/admin/save', { upserts: [], deletes: ['pe2e'], settings: null });
  check('товар удалён из каталога', !r.json.db.products.some((x) => x.id === 'pe2e'));

  console.log('\n# Одновременные заказы (гонка за последний товар)');
  const last = (await req(A, 'GET', '/api/db')).json.db.products.find((x) => x.id !== p.id && Object.values(x.stock).some((q) => q >= 1));
  const lsize = Object.keys(last.stock).find((s) => last.stock[s] >= 1);
  await admin(A, '/api/admin/stock-move', { mode: 'out', productId: last.id, size: lsize, qty: last.stock[lsize] - 3 > 0 ? last.stock[lsize] - 3 : 0 }).catch(() => {});
  const have = (await req(A, 'GET', '/api/db')).json.db.products.find((x) => x.id === last.id).stock[lsize];
  const tries = await Promise.all(Array.from({ length: 10 }, (_, i) => req(i % 2 ? A : B, 'POST', '/api/orders',
    orderBody([{ id: last.id, color: last.colors[0], size: lsize, qty: 1 }], { payment: payKey, customer: { name: 'Гонка ' + i, phone: '+998 93 555 00 ' + (10 + i), city: 'Ташкент', address: 'Юнусабад, 5' } }))));
  const ok = tries.filter((t) => t.status === 200).length;
  const after = (await req(A, 'GET', '/api/db')).json.db.products.find((x) => x.id === last.id).stock[lsize];
  check('продано ровно столько, сколько было (' + have + ')', ok === have && after === 0, { ok, have, after, codes: tries.map((t) => t.status) });

  console.log('\n# Удаление заказа, смена пароля, сброс');
  const any = (await req(A, 'GET', '/api/admin/db', null, token)).json.db.orders[0];
  r = await admin(A, '/api/admin/order-delete', { id: any.id });
  check('заказ удалён из списка', r.status === 200 && !r.json.db.orders.some((o) => o.id === any.id));
  r = await admin(A, '/api/admin/reset', {});
  check('сброс к демо-данным запрещён в продакшене', r.status === 403);
  r = await admin(A, '/api/admin/password', { password: 'short' });
  check('короткий пароль отклонён', r.status === 400);
  r = await admin(A, '/api/admin/password', { password: 'New-Strong-Pass-777' });
  check('пароль изменён, выдан новый токен', r.status === 200 && r.json.token);
  const oldToken = token;
  token = r.json.token;
  r = await req(B, 'GET', '/api/admin/db', null, oldToken);
  check('старые сессии закрыты после смены пароля', r.status === 401, [r.status, r.json && r.json.error]);
  r = await req(B, 'GET', '/api/admin/db', null, token);
  check('новая сессия работает', r.status === 200);
  r = await req(A, 'POST', '/api/admin/login', { password: ADMIN_PW });
  check('старый пароль больше не подходит (env не перезаписывает)', r.status === 401);
  r = await req(B, 'GET', '/api/admin/health', null, token);
  check('сводка админа: удалённое сохранено в архиве, данные целы', r.status === 200 && r.json.summary.products === 52, r.json);


  console.log('\n# Уведомления, подписка, импорт');
  r = await admin(A, '/api/admin/notify', { notify: { email: { enabled: true, host: 'smtp.example.uz', port: 465, user: 'shop@example.uz', pass: 'SMTP-SECRET-123' }, telegram: { enabled: true, botToken: '123456:TG-SECRET-TOKEN', chatId: '42' } } });
  check('настройки почты сохранены', r.status === 200 && r.json.notify.public.email.hasPass === true, r.json);
  r = await req(B, 'GET', '/api/admin/notify', null, token);
  check('настройки видны на другом экземпляре', r.status === 200 && r.json.notify.public.email.host === 'smtp.example.uz');
  check('пароль SMTP и токен Telegram не отдаются в браузер', !/SMTP-SECRET|TG-SECRET/.test(r.text));
  r = await req(A, 'GET', '/api/admin/db', null, token);
  check('…и в /api/admin/db тоже', !/SMTP-SECRET|TG-SECRET/.test(r.text));
  r = await req(A, 'POST', '/api/subscribe', { email: 'real.buyer@mail.uz' });
  check('подписка принимается', r.status === 200 && r.json.ok);
  r = await req(A, 'GET', '/api/admin/db', null, token);
  check('подписчик сохранён', r.json.db.subscribers.includes('real.buyer@mail.uz'));
  const backup = r.json.db;
  r = await admin(B, '/api/admin/import', { db: backup });
  check('импорт резервной копии', r.status === 200 && r.json.db.products.length === backup.products.length);

  console.log('\n# Защита от перебора');
  let codes = [];
  for (let i = 0; i < 9; i++) codes.push((await req(A, 'POST', '/api/admin/login', { password: 'wrong' + i })).status);
  check('после 8 неудачных попыток — блокировка (429)', codes.includes(429), codes);

  // архив удалённого
  const sqlite = require('node:sqlite');
  const d = new sqlite.DatabaseSync(path.join(tmp, 'db.sqlite'));
  const arch = d.prepare("SELECT tbl, COUNT(*) n FROM deleted_rows GROUP BY tbl").all();
  check('удалённые товар и заказ лежат в deleted_rows', arch.some((x) => x.tbl === 'orders') && arch.some((x) => x.tbl === 'products'), arch);
  const q = d.prepare('SELECT COUNT(*) n FROM quarantine').get();
  check('тестовые заказы сохранены в карантине', q.n === 18, q);
}

main().catch((e) => { failed++; console.error(e); }).finally(() => {
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' с ошибками');
  process.exit(failed ? 1 : 0);
});
