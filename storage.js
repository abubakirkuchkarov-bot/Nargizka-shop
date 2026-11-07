/**
 * Пути данных для локального Node и Vercel.
 * На Vercel файловая система приложения read-only → рабочий каталог /tmp
 * (данные живут до холодного старта; для постоянного хранения нужна внешняя БД).
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ON_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const BUNDLE_DATA = path.join(ROOT, 'data');
const DATA_DIR = ON_VERCEL ? path.join('/tmp', 'nargizka-data') : BUNDLE_DATA;
const UPLOADS = ON_VERCEL ? path.join('/tmp', 'nargizka-uploads') : path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const NOTIFY_FILE = path.join(DATA_DIR, 'notify.json');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.json');

function copyIfMissing(src, dest) {
  if (fs.existsSync(dest) || !fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function ensureRuntimeData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
  copyIfMissing(path.join(BUNDLE_DATA, 'db.json'), DB_FILE);
  // auth/notify не копируем с диска репозитория: секреты только через env / runtime
  return {
    ROOT,
    ON_VERCEL,
    DATA_DIR,
    UPLOADS,
    DB_FILE,
    AUTH_FILE,
    NOTIFY_FILE,
    OUTBOX_FILE,
  };
}

module.exports = {
  ROOT,
  ON_VERCEL,
  BUNDLE_DATA,
  DATA_DIR,
  UPLOADS,
  DB_FILE,
  AUTH_FILE,
  NOTIFY_FILE,
  OUTBOX_FILE,
  ensureRuntimeData,
};
