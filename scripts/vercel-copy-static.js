/** Копирует витрину и админку в public/ для статической раздачи на Vercel. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');

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

fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });

for (const name of ['index.html', 'admin', 'css', 'js', 'assets', 'uploads']) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) continue;
  cp(src, path.join(pub, name));
}

console.log('vercel-copy-static: public/ ready');
