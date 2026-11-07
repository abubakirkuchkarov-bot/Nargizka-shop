/** Копирует витрину в data/www (попадает в serverless через includeFiles data/**) и в public/. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function cp(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === '.gitkeep') continue;
      cp(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function syncTo(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['index.html', 'admin', 'css', 'js', 'assets']) {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) continue;
    cp(src, path.join(dest, name));
  }
}

syncTo(path.join(root, 'data', 'www'));
syncTo(path.join(root, 'public'));
console.log('vercel-copy-static: data/www + public ready');
