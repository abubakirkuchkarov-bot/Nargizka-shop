#!/usr/bin/env node
/**
 * Резервная копия базы (Turso или локальной) в JSON того же формата, что «Скачать резервную копию» в админке.
 *   node scripts/db-export.js [файл]      — по умолчанию backups/export-<дата>.json
 * Нужны TURSO_DATABASE_URL и TURSO_AUTH_TOKEN (vercel env pull .env.production.local). Ничего не меняет в базе.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['.env.production.local', '.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  break;
}
(async () => {
  const Store = require('../db/store');
  const st = await Store.read(['products', 'settings', 'orders', 'finance', 'subscribers']);
  const out = process.argv[2] || path.join(ROOT, 'backups', 'export-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(st.db, null, 2);
  fs.writeFileSync(out, json);
  console.log('Сохранено:', path.relative(process.cwd(), out));
  console.log('Товары', st.db.products.length, '· заказы', st.db.orders.length, '· подписчики', st.db.subscribers.length, '· sha256', Store.sha256(json).slice(0, 16));
})().catch((e) => { console.error('Ошибка:', e.message); process.exitCode = 1; });
