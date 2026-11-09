#!/usr/bin/env node
/**
 * Перенос данных Nargizka Shop из db.json в Turso.
 *
 *   node scripts/migrate-to-turso.js                      — ПРОВЕРКА (ничего не пишет): отчёт и резервная копия
 *   node scripts/migrate-to-turso.js --clean              — ПРОВЕРКА «чистого запуска»: только настройки, без товаров/заказов/финансов
 *   node scripts/migrate-to-turso.js --clean --apply      — чистый запуск: всё остальное уходит в архив (таблица quarantine)
 *   node scripts/migrate-to-turso.js --apply              — перенос всех данных в пустую базу Turso
 *   node scripts/migrate-to-turso.js --verify             — сверка базы с файлом
 *
 * Параметры:
 *   --source <файл>        исходный JSON (по умолчанию data/db.json; лучше — свежая выгрузка из админки)
 *   --keep-order <ID,...>  считать эти заказы реальными, даже если похожи на тестовые
 *   --test-order <ID,...>  дополнительно отправить эти заказы в карантин
 *   --restore-test-stock   вернуть на склад товары из тестовых заказов (кроме отменённых и демо)
 *
 * Тестовые заказы и подписчики НЕ удаляются: они сохраняются в таблице quarantine.
 * Перенос выполняется одной транзакцией и только в пустую базу — повторный запуск ничего не испортит.
 * Нужны переменные окружения TURSO_DATABASE_URL и TURSO_AUTH_TOKEN (например: vercel env pull .env.production.local).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const list = (n) => opt(n, '').split(',').map((s) => s.trim()).filter(Boolean);

loadEnvFile(opt('--env', ''));

const SOURCE = path.resolve(opt('--source', path.join(ROOT, 'data', 'db.json')));
const APPLY = flag('--apply');
const VERIFY = flag('--verify');
const CLEAN = flag('--clean');

const SEED_NAMES = new Set(['Дилноза С.', 'Мадина К.', 'Шахноза Т.', 'Нилуфар Р.', 'Сабина М.', 'Камола А.', 'Малика Б.', 'Гулнора Н.', 'Севара Е.', 'Зарина Ж.', 'Лола О.', 'Феруза Д.']);

function loadEnvFile(file) {
  const candidates = file ? [file] : ['.env.production.local', '.env.local', '.env'];
  for (const f of candidates) {
    const p = path.resolve(ROOT, f);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || process.env[m[1]]) return;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
    console.log('Переменные окружения прочитаны из', f, '(значения не выводятся)');
    return;
  }
}

/** Признаки тестового заказа. Возвращает причину или ''. */
function testReason(o) {
  const c = o.customer || {};
  const digits = String(c.phone || '').replace(/\D/g, '');
  const text = [c.name, c.comment, c.address, c.email].join(' ').toLowerCase();
  if (/^NS-2401\d\d$/.test(o.id) && SEED_NAMES.has(c.name)) return 'демо-заказ из начальных данных';
  if (/(^|\W)(тест|test|vercel-fix|проверка)/i.test(text)) return 'в имени/комментарии «тест»';
  if (/@example\./i.test(c.email || '')) return 'адрес @example';
  if (/^99890000\d{4}$/.test(digits) || /^0+$/.test(digits.slice(-7))) return 'номер-заглушка +998 90 000 …';
  return '';
}

function main() {
  if (!fs.existsSync(SOURCE)) throw new Error('Файл не найден: ' + SOURCE);
  const raw = fs.readFileSync(SOURCE, 'utf8');
  const data = JSON.parse(raw);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  if (!Array.isArray(data.products) || !data.settings) throw new Error('Файл не похож на данные Nargizka Shop');

  // 1. резервная копия исходника — всегда
  const bdir = path.join(ROOT, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bfile = path.join(bdir, 'db-before-turso-' + stamp + '-' + sha.slice(0, 8) + '.json');
  fs.writeFileSync(bfile, raw);
  console.log('\nРезервная копия:', path.relative(ROOT, bfile), '\nSHA-256:', sha);

  // 2. анализ
  const keep = new Set(list('--keep-order'));
  const forceTest = new Set(list('--test-order'));
  const orders = data.orders || [];
  const quarantineOrders = [];
  const realOrders = [];
  orders.forEach((o) => {
    let reason = keep.has(o.id) ? '' : (forceTest.has(o.id) ? 'отмечен вручную' : testReason(o));
    if (reason) quarantineOrders.push({ id: o.id, reason, order: o }); else realOrders.push(o);
  });
  const quarantineSubscribers = (data.subscribers || []).filter((e) => /@example\./i.test(e)).map((email) => ({ email, reason: 'адрес @example' }));
  const stockUnits = data.products.reduce((s, p) => s + Object.values(p.stock || {}).reduce((a, b) => a + (+b || 0), 0), 0);

  // остатки, которые «съели» тестовые заказы (демо-заказы склад не списывали)
  const restore = {};
  quarantineOrders.forEach(({ order, reason }) => {
    if (order.status === 'Отменён' || reason === 'демо-заказ из начальных данных') return;
    (order.items || []).forEach((it) => { const k = it.id + '|' + it.size; restore[k] = (restore[k] || 0) + (+it.qty || 0); });
  });

  if (CLEAN) {
    console.log('\n=== ЧИСТЫЙ ЗАПУСК ===');
    console.log('Переносятся только настройки: категории, цвета, размеры, доставка, оплата, контакты, бренд, промокоды.');
    console.log('В архив (таблица quarantine, ничего не удаляется):');
    console.log('   товары:', data.products.length, '· единиц на складе:', stockUnits);
    console.log('   заказы:', orders.length, '· подписчики:', (data.subscribers || []).length, '· финансовые записи:', ((data.finance && data.finance.entries) || []).length);
    console.log('Демо-акция «' + ((data.settings.flash || {}).title || '') + '» будет выключена, счётчики использования промокодов обнулены.');
    console.log('Текст главной страницы «Более N моделей» будет заменён нейтральным (на пустом каталоге он неверен):');
    console.log('   «' + String(((data.settings.hero || {}).subtitle) || '').slice(0, 120) + '»');
    return { raw, data, sha, quarantineOrders: [], quarantineSubscribers: [], restore: {}, stockUnits: 0, realOrders: [] };
  }
  console.log('\n=== Что будет перенесено ===');
  console.log('Товары:            ', data.products.length, '(видимых:', data.products.filter((p) => p.visible).length + ')');
  console.log('Единиц на складе:  ', stockUnits);
  console.log('Фото у товаров:    ', data.products.reduce((s, p) => s + (p.images || []).length, 0));
  console.log('Заказы реальные:   ', realOrders.length);
  realOrders.forEach((o) => console.log('   ✓', o.id, new Date(o.date).toISOString().slice(0, 10), o.status, o.total));
  console.log('Заказы в карантин: ', quarantineOrders.length, '(сохраняются в таблице quarantine, на сайте не видны)');
  quarantineOrders.forEach((q) => console.log('   ⚠', q.id, new Date(q.order.date).toISOString().slice(0, 10), q.order.status, q.order.total, '—', q.reason));
  console.log('Подписчики:        ', (data.subscribers || []).length - quarantineSubscribers.length, 'реальных,', quarantineSubscribers.length, 'тестовых');
  console.log('Финансы (записей): ', ((data.finance && data.finance.entries) || []).length, ', стартовый остаток', (data.finance && data.finance.openingBalance) || 0);
  if (Object.keys(restore).length) {
    console.log('\nТестовые заказы списали со склада:', Object.entries(restore).map(([k, v]) => k + ' ×' + v).join(', '));
    console.log(flag('--restore-test-stock') ? '→ будут возвращены на склад (--restore-test-stock)' : '→ остатки НЕ меняются. Чтобы вернуть, добавьте --restore-test-stock');
  }
  return { raw, data, sha, quarantineOrders, quarantineSubscribers, restore, stockUnits, realOrders };
}

async function run() {
  const plan = main();
  if (!APPLY && !VERIFY) {
    console.log('\nЭто была ПРОВЕРКА — в базу ничего не записано. Для переноса: --apply');
    return;
  }
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Не заданы TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
  const Store = require('../db/store');
  const c = await Store.getClient();
  if (APPLY) {
    let source = plan.data;
    if (flag('--restore-test-stock') && Object.keys(plan.restore).length) {
      source = JSON.parse(plan.raw);
      source.products.forEach((p) => Object.keys(p.stock || {}).forEach((size) => {
        const add = plan.restore[p.id + '|' + size];
        if (add) p.stock[size] = (+p.stock[size] || 0) + add;
      }));
    }
    console.log('\nПеренос в Turso…');
    if (CLEAN) {
      const src = JSON.parse(plan.raw);
      if (src.settings && src.settings.flash) src.settings.flash.active = false;
      (src.settings && src.settings.promoCodes || []).forEach((p) => { p.used = 0; });
      // «Более 50 моделей» на пустом каталоге — неправда; нейтральный текст, меняется в Админ → Маркетинг
      if (src.settings && src.settings.hero && /Более\s+\d+\s+моделей/i.test(src.settings.hero.subtitle || '')) {
        src.settings.hero.subtitle = 'Платья от коктейльных до свадебных. Сшито для женщин, которые выбирают лучшее.';
      }
      await Store.importSnapshot(c, JSON.stringify(src), { clean: true, originalRaw: plan.raw, sourceName: path.basename(SOURCE) + ' sha256:' + plan.sha.slice(0, 12) + ' (чистый запуск)' });
      console.log('Готово.');
    } else
    await Store.importSnapshot(c, flag('--restore-test-stock') ? JSON.stringify(source) : plan.raw, {
      sourceName: path.basename(SOURCE) + ' sha256:' + plan.sha.slice(0, 12),
      quarantineOrders: plan.quarantineOrders.map((q) => ({ id: q.id, reason: q.reason })),
      quarantineSubscribers: plan.quarantineSubscribers,
    });
    if (!CLEAN) console.log('Готово.');
  }
  const s = await Store.summary(c);
  console.log('\n=== Сверка базы ===');
  console.log(JSON.stringify(s, null, 2));
  const expectStock = plan.stockUnits + (flag('--restore-test-stock') ? Object.values(plan.restore).reduce((a, b) => a + b, 0) : 0);
  const checks = CLEAN ? [
    ['товары', s.products, 0],
    ['заказы', s.orders, 0],
    ['архив исходных данных', s.quarantined, 4],
  ] : [
    ['товары', s.products, plan.data.products.length],
    ['заказы', s.orders, plan.realOrders.length],
    ['карантин', s.quarantined, plan.quarantineOrders.length + plan.quarantineSubscribers.length],
  ];
  if (APPLY && !CLEAN) checks.push(['остатки', s.stockUnits, expectStock]);
  let ok = true;
  checks.forEach(([n, got, exp]) => { const good = got === exp; ok = ok && good; console.log((good ? '✓ ' : '✗ ') + n + ': ' + got + (good ? '' : ' (ожидалось ' + exp + ')')); });
  if (!ok) process.exitCode = 2;
}

run().catch((e) => { console.error('\nОшибка:', e.message); process.exitCode = 1; });
