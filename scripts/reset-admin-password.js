#!/usr/bin/env node
/**
 * Сброс пароля администратора, если он забыт. Все открытые сессии закрываются.
 *   node scripts/reset-admin-password.js            — пароль спросит в терминале (не попадает в историю команд)
 * Нужны TURSO_DATABASE_URL и TURSO_AUTH_TOKEN (vercel env pull .env.production.local).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

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

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function (s) { if (!rl.stdoutMuted || s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const pw = await ask('Новый пароль (не короче 10 символов): ');
  if (pw.length < 10) throw new Error('Слишком короткий пароль');
  const pw2 = await ask('Повторите пароль: ');
  if (pw !== pw2) throw new Error('Пароли не совпадают');
  const Store = require('../db/store');
  const c = await Store.getClient();
  const [r] = await c.run([`SELECT value FROM kv WHERE key = 'auth'`]);
  const prev = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
  const salt = crypto.randomBytes(16).toString('hex');
  const auth = { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex'), isDefault: false, epoch: (prev.epoch || 0) + 1, changedAt: Date.now() };
  await Store.saveKv('auth', auth);
  console.log('Пароль изменён. Все прежние сессии закрыты.');
})().catch((e) => { console.error('Ошибка:', e.message); process.exitCode = 1; });
