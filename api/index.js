// Vercel serverless entry: весь трафик → requestListener из server.js
const path = require('path');
const fs = require('fs');

// Явно удерживаем корневые файлы в бандле функции (NFT + includeFiles)
const root = path.join(__dirname, '..');
[
  'index.html',
  'data/db.json',
  'admin/index.html',
  'admin/admin.js',
  'css/style.css',
  'css/admin.css',
  'js/app.js',
  'js/store.js',
  'js/i18n.js',
  'js/motion.js',
  'server.js',
  'storage.js',
  'notify.js',
].forEach((rel) => {
  try { fs.accessSync(path.join(root, rel)); } catch (_) {}
});

module.exports = require('../server.js');
