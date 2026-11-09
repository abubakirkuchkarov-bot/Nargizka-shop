/**
 * Финальные испытания перед передачей клиенту: чистая база + реальные сценарии магазина.
 * Эмулятор Turso + 2 экземпляра сервера в режиме Production.
 * Запуск: node scripts/test/e2e-release.js
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NS = require('../../js/store.js');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-rel-'));
const MOCK = 19787, A = 19801, B = 19802;
const TOKEN = 'rel-token';
const PW = 'Release-Admin-Pass-2026';
const procs = [];
let passed = 0, failed = 0;
const env = Object.assign({}, process.env, {
  TURSO_DATABASE_URL: 'http://127.0.0.1:' + MOCK, TURSO_AUTH_TOKEN: TOKEN,
  VERCEL: '1', VERCEL_ENV: 'production', ADMIN_PASSWORD: PW, SESSION_SECRET: 'r'.repeat(48),
});

function start(args, e, marker) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes(marker)) resolve(p); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => reject(new Error('exited ' + c + ': ' + out)));
  });
}
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill(); procs.splice(procs.indexOf(p), 1); });
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
  if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗', name, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); }
}
const vs = (p, c, s) => +((p.vstock || {})[c + '|' + s] || 0);
const sumStock = (p) => Object.values(p.vstock || {}).reduce((a, b) => a + b, 0);

async function main() {
  await start(['scripts/test/hrana-mock.js', path.join(tmp, 'db.sqlite'), String(MOCK), TOKEN], process.env, 'hrana mock');

  console.log('\n# 0. Чистая рабочая база');
  const out = execFileSync(process.execPath, ['scripts/migrate-to-turso.js', '--clean', '--apply'], { cwd: ROOT, env, encoding: 'utf8' });
  check('чистый запуск выполнен, сверка пройдена', /✓ товары: 0/.test(out) && /✓ заказы: 0/.test(out) && !/✗/.test(out), out.slice(-400));
  await start(['scripts/test/serve.js', String(A)], env, 'listening');
  await start(['scripts/test/serve.js', String(B)], env, 'listening');
  let r = await req(A, 'GET', '/api/db');
  check('витрина: 0 товаров, демо-данных нет', r.status === 200 && r.json.db.products.length === 0);
  check('категории и бренд сохранены', r.json.db.settings.categories.length > 0 && r.json.db.settings.brand.name === 'Nargizka Shop');
  check('демо-акция выключена', r.json.db.settings.flash.active === false);
  r = await req(A, 'POST', '/api/admin/login', { password: 'admin' });
  check('пароль admin в Production не работает', r.status === 401);
  r = await req(A, 'POST', '/api/admin/login', { password: PW });
  const token = r.json && r.json.token;
  check('вход администратора', !!token);
  const admin = (port, url, body) => req(port, 'POST', url, body, token);
  r = await req(B, 'GET', '/api/admin/db', null, token);
  check('админка: пустые заказы, финансы, склад', r.json.db.orders.length === 0 && r.json.db.finance.entries.length === 0 && r.json.db.products.length === 0);

  console.log('\n# 1–3. Товар вручную: фото, цвета и размеры с разными остатками');
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
  const photos = [];
  for (let i = 0; i < 2; i++) {
    r = await admin(A, '/api/admin/upload', { data: 'data:image/jpeg;base64,' + jpeg.toString('base64') });
    photos.push(r.json && r.json.url);
  }
  check('загружено 2 фото', photos.every((u) => /^\/uploads\//.test(u || '')), photos);
  const prod = {
    id: 'pREL1', sku: 'REL-001', name: 'Платье «Релиз»', brand: 'Nargizka', category: 'evening',
    price: 2000000, cost: 800000, discount: 0, colors: ['Чёрный', 'Бордо'],
    vstock: { 'Чёрный|S': 3, 'Чёрный|M': 2, 'Бордо|M': 1 }, variant: 1, fabric: 'Шёлк', description: 'Тест', images: photos,
    isNew: true, isHit: false, visible: true, createdAt: Date.now(),
  };
  r = await admin(A, '/api/admin/save', { upserts: [{ p: prod, base: null, index: 0 }], deletes: [], settings: null });
  let P = r.json && r.json.db.products.find((x) => x.id === 'pREL1');
  check('товар создан с бренд/закупкой/вариантами', P && P.brand === 'Nargizka' && P.cost === 800000 && vs(P, 'Чёрный', 'S') === 3 && vs(P, 'Бордо', 'M') === 1 && sumStock(P) === 6, P);
  check('начальный остаток записан в журнал склада', r.json.db.stockMoves.filter((m) => m.type === 'initial').reduce((a, m) => a + m.delta, 0) === 6);
  r = await req(B, 'GET', photos[1]);
  check('фото отдаётся другим экземпляром', r.status === 200 && r.headers.get('content-type') === 'image/jpeg');

  console.log('\n# 4. Товар на витрине (публичный API)');
  r = await req(B, 'GET', '/api/db');
  const pub = r.json.db.products.find((x) => x.id === 'pREL1');
  check('товар виден, остатки по вариантам есть', pub && vs(pub, 'Бордо', 'M') === 1);
  check('закупочная цена НЕ видна покупателям', pub && !('cost' in pub) && !/800000/.test(JSON.stringify(pub)));

  console.log('\n# 5–7. Заказ: проверка наличия по цвету, появление в админке, списание');
  const pay = Object.keys(r.json.db.settings.payments).find((k) => r.json.db.settings.payments[k]);
  const order = (items, extra) => Object.assign({ customer: { name: 'Покупатель Релиз', phone: '+998 91 222 33 44', city: 'Ташкент', address: 'Юнусабад 1' }, delivery: 'courier', payment: pay, items }, extra || {});
  r = await req(A, 'POST', '/api/orders', order([{ id: 'pREL1', color: 'Бордо', size: 'S', qty: 1 }]));
  check('нельзя заказать вариант, которого нет (Бордо S = 0)', r.status === 409, r.json);
  r = await req(A, 'POST', '/api/orders', order([{ id: 'pREL1', color: 'Бордо', size: 'M', qty: 2 }]));
  check('нельзя заказать больше остатка варианта', r.status === 409, r.json);
  r = await req(A, 'POST', '/api/orders', order([{ id: 'pREL1', color: 'Чёрный', size: 'S', qty: 2 }]));
  check('заказ оформлен', r.status === 200, r.json);
  const o1 = r.json.order;
  check('ответ покупателю без закупочной цены', !('cost' in o1.items[0]) && !/800000/.test(JSON.stringify(o1)) && o1.paid === false);
  r = await req(B, 'GET', '/api/admin/db', null, token);
  let A_db = r.json.db;
  P = A_db.products.find((x) => x.id === 'pREL1');
  check('заказ появился в админке как «Новый», не оплачен', A_db.orders[0].id === o1.id && A_db.orders[0].status === 'Новый' && !A_db.orders[0].paid);
  check('в заказе (в админке) зафиксирована себестоимость', A_db.orders[0].items[0].cost === 800000);
  check('списан ровно вариант Чёрный S (3 → 1), остальные не тронуты', vs(P, 'Чёрный', 'S') === 1 && vs(P, 'Чёрный', 'M') === 2 && vs(P, 'Бордо', 'M') === 1, P.vstock);
  check('продажа записана в журнал склада', A_db.stockMoves.some((m) => m.type === 'sale' && m.ref === o1.id && m.delta === -2));

  console.log('\n# 8. Статусы и оплата');
  r = await admin(A, '/api/admin/order', { id: o1.id, status: 'Подтверждён' });
  r = await admin(B, '/api/admin/order', { id: o1.id, status: 'Отправлен' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('смена статуса не списывает повторно', vs(P, 'Чёрный', 'S') === 1);
  r = await admin(A, '/api/admin/order-paid', { id: o1.id, paid: true });
  check('заказ отмечен оплаченным', r.json.db.orders.find((o) => o.id === o1.id).paid === true);
  await admin(A, '/api/admin/order-paid', { id: o1.id, paid: true });
  r = await req(A, 'GET', '/api/admin/db', null, token);

  console.log('\n# 9. Финансовые отчёты');
  let rep = NS.financeReport(NS.migrate(r.json.db), 0, Date.now() + 60000);
  check('выручка = сумма оплаченного заказа (повторная отметка не удваивает)', rep.revenue === o1.total, rep.revenue);
  check('себестоимость = 2 × 800 000', rep.netCogs === 1600000, rep.netCogs);
  check('валовая прибыль = выручка − себестоимость (выручка ≠ прибыль)', rep.gross === o1.total - 1600000 && rep.gross !== rep.revenue);
  // поступление с закупочной ценой: деньги ушли, но прибыль не уменьшилась
  r = await admin(B, '/api/admin/stock-move', { mode: 'in', lines: [{ productId: 'pREL1', color: 'Бордо', size: 'L', qty: 4 }], unitCost: 750000, reason: 'Поставщик тест' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('поступление по варианту Бордо L +4', vs(P, 'Бордо', 'L') === 4);
  check('закупочная цена обновлена', P.cost === 750000);
  rep = NS.financeReport(NS.migrate(r.json.db), 0, Date.now() + 60000);
  check('закупка 3 000 000 — в движении денег, но не в прибыли', rep.purchases === 3000000 && rep.gross === o1.total - 1600000 && rep.net === rep.gross);
  r = await admin(A, '/api/admin/finance', { entry: { type: 'out', amount: 500000, category: 'Аренда', note: 'тест' } });
  r = await admin(A, '/api/admin/finance', { entry: { type: 'in', amount: 10000000, category: 'Вложение', note: 'тест' } });
  rep = NS.financeReport(NS.migrate(r.json.db), 0, Date.now() + 60000);
  check('аренда уменьшает чистую прибыль, вложение — не прибыль', rep.operating === 500000 && rep.net === rep.gross - 500000 && rep.capitalIn === 10000000, { net: rep.net, gross: rep.gross });
  check('касса = оплаты + вложение − закупка − аренда', rep.cashNet === o1.total + 10000000 - 3000000 - 500000);
  // неоплаченный заказ
  r = await req(B, 'POST', '/api/orders', order([{ id: 'pREL1', color: 'Бордо', size: 'M', qty: 1 }]));
  const o2 = r.json.order;
  r = await req(A, 'GET', '/api/admin/db', null, token);
  rep = NS.financeReport(NS.migrate(r.json.db), 0, Date.now() + 60000);
  check('неоплаченный заказ не в выручке, а в «Не оплачено»', rep.revenue === o1.total && rep.unpaidCount === 1 && rep.unpaidSum === o2.total);

  console.log('\n# 10. Отмена и возврат');
  r = await admin(A, '/api/admin/order', { id: o2.id, status: 'Отменён' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('отмена вернула Бордо M (0 → 1)', vs(P, 'Бордо', 'M') === 1);
  r = await admin(B, '/api/admin/order', { id: o2.id, status: 'Отменён' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('повторная отмена не возвращает второй раз', vs(P, 'Бордо', 'M') === 1);
  r = await admin(A, '/api/admin/order-paid', { id: o2.id, paid: true });
  check('отменённый заказ нельзя отметить оплаченным', r.status === 409);
  r = await admin(A, '/api/admin/order', { id: o1.id, status: 'Возврат' });
  const d10 = r.json.db;
  P = d10.products.find((x) => x.id === 'pREL1');
  check('возврат оплаченного: товар на складе (1 → 3)', vs(P, 'Чёрный', 'S') === 3);
  const o1r = d10.orders.find((o) => o.id === o1.id);
  check('возврат оплаченного: деньги отмечены возвращёнными', o1r.refunded === true && o1r.refundedAt > 0);
  rep = NS.financeReport(NS.migrate(d10), 0, Date.now() + 60000);
  check('после возврата чистая выручка и валовая прибыль = 0', rep.netRevenue === 0 && rep.gross === 0, { nr: rep.netRevenue, g: rep.gross });
  r = await admin(A, '/api/admin/order', { id: o1.id, status: 'Подтверждён' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('вернули заказ в работу — товар снова списан ровно один раз', vs(P, 'Чёрный', 'S') === 1 && r.json.db.orders.find((o) => o.id === o1.id).refunded === false);
  r = await admin(A, '/api/admin/order', { id: o1.id, status: 'Отменён' });

  console.log('\n# Склад: списание и корректировка с причиной');
  r = await admin(A, '/api/admin/stock-move', { mode: 'out', lines: [{ productId: 'pREL1', color: 'Бордо', size: 'L', qty: 1 }] });
  check('списание без причины отклонено', r.status === 400);
  r = await admin(A, '/api/admin/stock-move', { mode: 'out', lines: [{ productId: 'pREL1', color: 'Бордо', size: 'L', qty: 1 }], reason: 'Брак: пятно' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('списание с причиной', vs(P, 'Бордо', 'L') === 3 && r.json.db.stockMoves[0].reason === 'Брак: пятно');
  r = await admin(A, '/api/admin/stock-move', { mode: 'out', lines: [{ productId: 'pREL1', color: 'Бордо', size: 'L', qty: 99 }], reason: 'тест' });
  check('нельзя списать больше остатка', r.status === 409);
  r = await admin(B, '/api/admin/stock-move', { mode: 'set', lines: [{ productId: 'pREL1', color: 'Бордо', size: 'L', qty: 5 }], reason: 'Пересчёт склада' });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('пересчёт до точного количества (3 → 5)', vs(P, 'Бордо', 'L') === 5 && r.json.db.stockMoves[0].delta === 2);
  const base = JSON.parse(JSON.stringify(P));
  const edited = Object.assign({}, P, { vstock: Object.assign({}, P.vstock, { 'Чёрный|XL': 2 }) });
  r = await admin(A, '/api/admin/save', { upserts: [{ p: edited, base, index: 0, reason: 'Нашли на складе' }], deletes: [], settings: null });
  check('правка остатка в карточке пишется в журнал с причиной', r.json.db.stockMoves[0].type === 'adjust' && r.json.db.stockMoves[0].reason === 'Нашли на складе');
  const stale = Object.assign({}, base, { price: 2100000 });
  r = await admin(B, '/api/admin/save', { upserts: [{ p: stale, base, index: 0 }], deletes: [], settings: null });
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('сохранение цены из старой вкладки не затирает свежие остатки', P.price === 2100000 && vs(P, 'Чёрный', 'XL') === 2);

  console.log('\n# Заказы вручную: магазин и телефон');
  r = await admin(A, '/api/admin/store-sale', { items: [{ id: 'pREL1', color: 'Бордо', size: 'L', qty: 1, price: 1900000 }], payment: 'Наличные в магазине' });
  const ms = r.json.order;
  check('продажа в магазине: оплачена, доставлена, списана', ms && ms.paid && ms.status === 'Доставлен' && vs(r.json.db.products.find((x) => x.id === 'pREL1'), 'Бордо', 'L') === 4);
  r = await admin(B, '/api/admin/store-sale', { channel: 'phone', items: [{ id: 'pREL1', color: 'Чёрный', size: 'M', qty: 1 }], paid: false, status: 'Подтверждён', customerName: 'Клиент', customerPhone: '+998 90 111 22 33', address: 'Чиланзар', shipping: 30000, discount: 100000 });
  const tl = r.json.order;
  check('заказ по телефону: не оплачен, скидка и доставка учтены', tl && !tl.paid && tl.total === 2100000 - 100000 + 30000 && /^TL-/.test(tl.id), tl);
  r = await admin(A, '/api/admin/store-sale', { items: [{ id: 'pREL1', color: 'Бордо', size: 'M', qty: 5 }] });
  check('ручная продажа сверх остатка отклонена', r.status === 409);

  console.log('\n# Гонка за последнюю штуку (два сервера)');
  const before = vs((await req(A, 'GET', '/api/db')).json.db.products.find((x) => x.id === 'pREL1'), 'Бордо', 'M');
  const tries = await Promise.all(Array.from({ length: 8 }, (_, i) => req(i % 2 ? A : B, 'POST', '/api/orders',
    order([{ id: 'pREL1', color: 'Бордо', size: 'M', qty: 1 }], { customer: { name: 'Гонка ' + i, phone: '+998 93 555 00 ' + (10 + i), city: 'Ташкент', address: 'Юнусабад 5' } }))));
  const okN = tries.filter((t) => t.status === 200).length;
  const after = vs((await req(A, 'GET', '/api/db')).json.db.products.find((x) => x.id === 'pREL1'), 'Бордо', 'M');
  check(`продано ровно ${before} шт., остаток 0, без минуса`, okN === before && after === 0, { okN, before, after });

  console.log('\n# Бренд для другого магазина');
  r = await req(A, 'GET', '/api/admin/db', null, token);
  const settings = r.json.db.settings;
  settings.brand = Object.assign({}, settings.brand, { name: 'Lola <script>x</script> Boutique', short: 'Lola', accent: 'red;}', dark: '#222222', facebook: 'javascript:alert(1)', whatsapp: '+998 90 000 11 22' });
  r = await admin(A, '/api/admin/save', { upserts: [], deletes: [], settings });
  r = await req(B, 'GET', '/api/db');
  const b = r.json.db.settings.brand;
  check('бренд сохранён и виден на витрине', b.short === 'Lola' && b.dark === '#222222' && b.whatsapp);
  check('опасные значения бренда очищены', !/[<>]/.test(b.name) && b.accent === '' && b.facebook === '', b);

  console.log('\n# Безопасность API');
  const adminRoutes = ['GET /api/admin/db', 'GET /api/admin/health', 'GET /api/admin/notify', 'POST /api/admin/save', 'POST /api/admin/order', 'POST /api/admin/order-paid',
    'POST /api/admin/finance', 'POST /api/admin/store-sale', 'POST /api/admin/stock-move', 'POST /api/admin/order-delete', 'POST /api/admin/upload',
    'POST /api/admin/password', 'POST /api/admin/import', 'POST /api/admin/notify', 'POST /api/admin/notify-test', 'POST /api/admin/revoke-sessions', 'POST /api/admin/reset'];
  const codes = [];
  for (const rt of adminRoutes) {
    const [m, u] = rt.split(' ');
    codes.push((await req(A, m, u, m === 'POST' ? {} : null)).status);
  }
  check('все ' + adminRoutes.length + ' административных API без входа → 401', codes.every((c) => c === 401), codes);
  r = await req(A, 'GET', '/api/admin/db', null, token);
  check('секреты не уходят в браузер', !/"hash"|"salt"|TURSO|SESSION_SECRET/.test(r.text));

  console.log('\n# 11. Сохранность данных после перезапуска');
  const snapBefore = JSON.stringify((await req(A, 'GET', '/api/admin/db', null, token)).json.db.products.map((p) => [p.id, p.vstock, p.cost]));
  const ordersBefore = (await req(A, 'GET', '/api/admin/db', null, token)).json.db.orders.length;
  for (const p of procs.slice(1)) await stop(p);
  await start(['scripts/test/serve.js', String(A)], env, 'listening');
  r = await req(A, 'GET', '/api/admin/db', null, token);
  check('после перезапуска серверов товары, остатки и заказы на месте; сессия жива', r.status === 200
    && JSON.stringify(r.json.db.products.map((p) => [p.id, p.vstock, p.cost])) === snapBefore && r.json.db.orders.length === ordersBefore);
  r = await req(A, 'GET', photos[0]);
  check('фото на месте после перезапуска', r.status === 200);

  console.log('\n# 12. Удаление тестовых операций с архивом');
  r = await req(A, 'GET', '/api/admin/db', null, token);
  for (const o of r.json.db.orders) await admin(A, '/api/admin/order-delete', { id: o.id });
  r = await req(A, 'GET', '/api/admin/db', null, token);
  P = r.json.db.products.find((x) => x.id === 'pREL1');
  check('все тестовые заказы удалены из рабочего состояния', r.json.db.orders.length === 0);
  check('удаление заказов вернуло зарезервированный товар', sumStock(P) > 0);
  await admin(A, '/api/admin/save', { upserts: [], deletes: ['pREL1'], settings: null });
  for (const e of r.json.db.finance.entries) await admin(A, '/api/admin/finance', { deleteId: e.id });
  r = await req(A, 'GET', '/api/admin/db', null, token);
  check('рабочее состояние снова чистое (0 товаров, 0 заказов, 0 операций)', r.json.db.products.length === 0 && r.json.db.orders.length === 0 && r.json.db.finance.entries.length === 0);
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(path.join(tmp, 'db.sqlite'));
  const arch = d.prepare('SELECT tbl, COUNT(*) n FROM deleted_rows GROUP BY tbl').all();
  const moves = d.prepare('SELECT COUNT(*) n FROM stock_moves').get().n;
  check('архив проверок сохранён (заказы, товар, операции, журнал склада)', arch.some((x) => x.tbl === 'orders') && arch.some((x) => x.tbl === 'products') && arch.some((x) => x.tbl === 'finance_entries') && moves > 10, { arch, moves });
}

main().catch((e) => { failed++; console.error(e); }).finally(() => {
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' с ошибками');
  process.exit(failed ? 1 : 0);
});
