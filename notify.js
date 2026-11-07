/* Отправка писем (SMTP) и SMS (Eskiz.uz) без внешних пакетов */
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const https = require('https');
const http = require('http');

const storage = require('./storage');
storage.ensureRuntimeData();
const CFG_FILE = storage.NOTIFY_FILE;
const OUTBOX = storage.OUTBOX_FILE;

const DEFAULTS = {
  email: {
    enabled: false,
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
  },
  sms: {
    enabled: false,
    provider: 'eskiz',
    email: '',
    password: '',
    from: '4546',
    token: '',
    tokenExpires: 0,
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
  },
};

function loadCfg() {
  try {
    if (fs.existsSync(CFG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
      return {
        email: Object.assign({}, DEFAULTS.email, raw.email || {}),
        sms: Object.assign({}, DEFAULTS.sms, raw.sms || {}),
        telegram: Object.assign({}, DEFAULTS.telegram, raw.telegram || {}),
      };
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function saveCfg(cfg) {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  const clean = {
    email: {
      enabled: !!cfg.email.enabled,
      host: String(cfg.email.host || '').trim(),
      port: Math.max(1, Math.min(65535, +cfg.email.port || 465)),
      secure: cfg.email.secure !== false,
      user: String(cfg.email.user || '').trim(),
      pass: String(cfg.email.pass || ''),
      from: String(cfg.email.from || cfg.email.user || '').trim(),
    },
    sms: {
      enabled: !!cfg.sms.enabled,
      provider: 'eskiz',
      email: String(cfg.sms.email || '').trim(),
      password: String(cfg.sms.password || ''),
      from: String(cfg.sms.from || '4546').trim(),
      token: String(cfg.sms.token || ''),
      tokenExpires: +cfg.sms.tokenExpires || 0,
    },
    telegram: {
      enabled: !!cfg.telegram.enabled,
      botToken: String(cfg.telegram.botToken || '').trim(),
      chatId: String(cfg.telegram.chatId || '').trim(),
    },
  };
  fs.writeFileSync(CFG_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function publicCfg(cfg) {
  const c = cfg || loadCfg();
  return {
    email: {
      enabled: !!c.email.enabled,
      host: c.email.host,
      port: c.email.port,
      secure: c.email.secure,
      user: c.email.user,
      from: c.email.from,
      hasPass: !!c.email.pass,
    },
    sms: {
      enabled: !!c.sms.enabled,
      provider: c.sms.provider,
      email: c.sms.email,
      from: c.sms.from,
      hasPass: !!c.sms.password,
    },
    telegram: {
      enabled: !!c.telegram.enabled,
      botToken: c.telegram.botToken ? '••••' + c.telegram.botToken.slice(-6) : '',
      chatId: c.telegram.chatId,
      hasToken: !!c.telegram.botToken,
    },
  };
}

function pushOutbox(entry) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(OUTBOX, 'utf8')); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  list.unshift(Object.assign({ id: Date.now().toString(36), at: Date.now() }, entry));
  fs.writeFileSync(OUTBOX, JSON.stringify(list.slice(0, 200), null, 2));
}

function readOutbox(limit) {
  try {
    const list = JSON.parse(fs.readFileSync(OUTBOX, 'utf8'));
    return Array.isArray(list) ? list.slice(0, limit || 40) : [];
  } catch (_) { return []; }
}

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

function encodeSubject(s) {
  return '=?UTF-8?B?' + b64(s) + '?=';
}

function buildMime({ from, to, subject, text, html }) {
  const boundary = 'ns_' + Date.now().toString(36);
  const lines = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + encodeSubject(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text || ''),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html || ('<pre>' + String(text || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</pre>')),
    '--' + boundary + '--',
    '',
  ];
  return lines.join('\r\n');
}

function smtpDialog(socket, steps) {
  let buf = '';
  let i = 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SMTP timeout')), 25000);
    const fail = (e) => { clearTimeout(timer); try { socket.destroy(); } catch (_) {} reject(e); };
    const advance = () => {
      if (i >= steps.length) { clearTimeout(timer); resolve(); return; }
      const step = steps[i];
      if (step.send != null) socket.write(step.send);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      while (true) {
        const idx = buf.indexOf('\r\n');
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = parseInt(line.slice(0, 3), 10);
        const step = steps[i];
        if (!step) return fail(new Error('SMTP unexpected: ' + line));
        const expect = step.expect || 250;
        const ok = Array.isArray(expect) ? expect.includes(code) : code === expect;
        if (!ok) return fail(new Error('SMTP ' + line));
        i += 1;
        if (i >= steps.length) { clearTimeout(timer); resolve(); return; }
        advance();
      }
    });
    socket.on('error', fail);
  });
}

async function sendSmtp(cfg, { to, subject, text, html }) {
  const email = cfg.email;
  if (!email.enabled) throw new Error('Почта выключена в настройках');
  if (!email.host || !email.user || !email.pass) throw new Error('Заполните SMTP: хост, логин и пароль');
  const from = email.from || email.user;
  const mime = buildMime({ from, to, subject, text, html });
  const port = email.port || 465;
  const secure = email.secure !== false || port === 465;

  const connect = () => new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host: email.host, port, servername: email.host, rejectUnauthorized: false }, () => resolve(sock))
      : net.connect({ host: email.host, port }, () => resolve(sock));
    sock.on('error', reject);
  });

  const socket = await connect();
  const userB64 = b64(email.user);
  const passB64 = b64(email.pass);
  const steps = [
    { expect: 220 },
    { send: 'EHLO nargizka.local\r\n', expect: 250 },
    { send: 'AUTH LOGIN\r\n', expect: 334 },
    { send: userB64 + '\r\n', expect: 334 },
    { send: passB64 + '\r\n', expect: 235 },
    { send: 'MAIL FROM:<' + email.user + '>\r\n', expect: 250 },
    { send: 'RCPT TO:<' + to + '>\r\n', expect: 250 },
    { send: 'DATA\r\n', expect: 354 },
    { send: mime.replace(/^\./gm, '..') + '\r\n.\r\n', expect: 250 },
    { send: 'QUIT\r\n', expect: 221 },
  ];
  try {
    await smtpDialog(socket, steps);
  } finally {
    try { socket.end(); } catch (_) {}
  }
}

function httpJson(url, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: (opts && opts.method) || 'GET',
      headers: Object.assign(
        { Accept: 'application/json' },
        data ? { 'Content-Type': (opts && opts.contentType) || 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        (opts && opts.headers) || {}
      ),
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(raw || '{}'); } catch (_) { json = { raw }; }
        if (res.statusCode >= 400) {
          const err = new Error((json.message || json.error || raw || 'HTTP ' + res.statusCode).toString());
          err.status = res.statusCode;
          return reject(err);
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function eskizToken(cfg) {
  const sms = cfg.sms;
  if (sms.token && sms.tokenExpires > Date.now() + 60000) return sms.token;
  if (!sms.email || !sms.password) throw new Error('Укажите email и пароль Eskiz.uz');
  const form = 'email=' + encodeURIComponent(sms.email) + '&password=' + encodeURIComponent(sms.password);
  const r = await httpJson('https://notify.eskiz.uz/api/auth/login', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
  }, form);
  const token = r.data && r.data.token;
  if (!token) throw new Error('Eskiz: не удалось получить токен');
  sms.token = token;
  sms.tokenExpires = Date.now() + 25 * 86400000;
  saveCfg(cfg);
  return token;
}

function normPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 9) return '998' + d;
  if (d.length === 12 && d.startsWith('998')) return d;
  if (d.length === 11 && d.startsWith('8')) return '998' + d.slice(1);
  return d;
}

async function sendSms(cfg, { phone, text }) {
  if (!cfg.sms.enabled) throw new Error('SMS выключены в настройках');
  const to = normPhone(phone);
  if (to.length < 12) throw new Error('Некорректный номер для SMS');
  const token = await eskizToken(cfg);
  const form = 'mobile_phone=' + encodeURIComponent(to)
    + '&message=' + encodeURIComponent(text)
    + '&from=' + encodeURIComponent(cfg.sms.from || '4546');
  await httpJson('https://notify.eskiz.uz/api/message/sms/send', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Bearer ' + token },
  }, form);
}

async function sendTelegram(cfg, text) {
  if (!cfg.telegram.enabled) throw new Error('Telegram выключен');
  if (!cfg.telegram.botToken || !cfg.telegram.chatId) throw new Error('Укажите bot token и chat id');
  await httpJson('https://api.telegram.org/bot' + cfg.telegram.botToken + '/sendMessage', {
    method: 'POST',
  }, { chat_id: cfg.telegram.chatId, text: String(text).slice(0, 4000) });
}

async function sendEmail(to, subject, text, html) {
  const cfg = loadCfg();
  try {
    await sendSmtp(cfg, { to, subject, text, html });
    pushOutbox({ channel: 'email', to, subject, status: 'sent', text: text.slice(0, 500) });
    return { ok: true };
  } catch (e) {
    pushOutbox({ channel: 'email', to, subject, status: 'error', error: e.message, text: text.slice(0, 500) });
    throw e;
  }
}

async function sendSmsSafe(phone, text) {
  const cfg = loadCfg();
  try {
    await sendSms(cfg, { phone, text });
    pushOutbox({ channel: 'sms', to: normPhone(phone), status: 'sent', text: text.slice(0, 500) });
    return { ok: true };
  } catch (e) {
    pushOutbox({ channel: 'sms', to: normPhone(phone), status: 'error', error: e.message, text: text.slice(0, 500) });
    throw e;
  }
}

async function notifyAdmin(text) {
  const cfg = loadCfg();
  const jobs = [];
  if (cfg.telegram.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    jobs.push(sendTelegram(cfg, text).then(() => pushOutbox({ channel: 'telegram', to: cfg.telegram.chatId, status: 'sent', text: text.slice(0, 500) }))
      .catch((e) => pushOutbox({ channel: 'telegram', to: cfg.telegram.chatId, status: 'error', error: e.message, text: text.slice(0, 500) })));
  }
  if (cfg.email.enabled && cfg.email.user) {
    const shop = cfg.email.from || cfg.email.user;
    jobs.push(sendEmail(shop, 'Nargizka Shop — уведомление', text).catch(() => {}));
  }
  await Promise.all(jobs);
}

function status() {
  const c = loadCfg();
  return {
    emailReady: !!(c.email.enabled && c.email.host && c.email.user && c.email.pass),
    smsReady: !!(c.sms.enabled && c.sms.email && c.sms.password),
    telegramReady: !!(c.telegram.enabled && c.telegram.botToken && c.telegram.chatId),
    public: publicCfg(c),
  };
}

module.exports = {
  loadCfg, saveCfg, publicCfg, readOutbox, status,
  sendEmail, sendSmsSafe, notifyAdmin, normPhone,
};
