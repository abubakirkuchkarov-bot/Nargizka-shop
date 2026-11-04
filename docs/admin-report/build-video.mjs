import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FF = process.env.FFMPEG || 'ffmpeg';
const FONT = 'C\\\\:/Windows/Fonts/segoeui.ttf';
const OUT = path.join(__dirname, 'nargizka-admin-report.mp4');
const TMP = path.join(__dirname, '_clips');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const slides = [
  {
    type: 'title',
    file: 't00.mp4',
    dur: 5,
    title: 'Nargizka Shop',
    sub: 'Видео-отчёт: как работает админка',
    note: 'Полный обзор разделов · ноябрь 2026',
  },
  {
    type: 'shot',
    img: 'admin-01-dashboard.png',
    file: 'c01.mp4',
    dur: 7,
    title: '1. Обзор',
    caption: 'Выручка, заказы, средний чек, касса и график продаж за 14 дней. Красный бейдж на «Заказы» — новые заявки.',
  },
  {
    type: 'shot',
    img: 'admin-02-products.png',
    file: 'c02.mp4',
    dur: 6,
    title: '2. Товары',
    caption: 'Каталог: цены и скидки правятся прямо в таблице. Поиск, фильтры, «+ Добавить товар» — фото, цвета, размеры, остатки.',
  },
  {
    type: 'shot',
    img: 'admin-03-orders.png',
    file: 'c03.mp4',
    dur: 6,
    title: '3. Заказы',
    caption: 'Фильтр по статусу: Новый → Подтверждён → Отправлен → Доставлен. Статус меняется в списке. Экспорт в Excel.',
  },
  {
    type: 'shot',
    img: 'admin-04-finance.png',
    file: 'c04.mp4',
    dur: 8,
    title: '4. Финансы — касса',
    caption: 'Было → Пришло → Ушло → Сейчас в кассе. Период кнопками. «+ Деньги ушли» — аренда, закупка, зарплата.',
  },
  {
    type: 'shot',
    img: 'admin-05-finance-sales.png',
    file: 'c05.mp4',
    dur: 7,
    title: '5. Финансы — продажи',
    caption: 'Вкладка «Продажи по дням»: ежедневный отчёт, способы оплаты, статусы. Новые заказы не в кассе, пока не подтверждены.',
  },
  {
    type: 'shot',
    img: 'admin-06-marketing.png',
    file: 'c06.mp4',
    dur: 6,
    title: '6. Скидки и акции',
    caption: 'Акция с таймером, скидка от суммы заказа, массовая скидка по категории, баннер и бегущая строка на сайте.',
  },
  {
    type: 'shot',
    img: 'admin-07-promos.png',
    file: 'c07.mp4',
    dur: 6,
    title: '7. Промокоды',
    caption: 'Коды процентные или фиксированные. Приветственный код после подписки. Список подписчиков можно скачать.',
  },
  {
    type: 'shot',
    img: 'admin-08-catalog.png',
    file: 'c08.mp4',
    dur: 5,
    title: '8. Категории, цвета, размеры',
    caption: 'Справочники витрины. Удалить можно только пустую категорию / цвет / размер без остатков.',
  },
  {
    type: 'shot',
    img: 'admin-09-settings.png',
    file: 'c09.mp4',
    dur: 6,
    title: '9. Настройки магазина',
    caption: 'Курс доллара, доставка (бесплатно от 2 млн), способы оплаты, контакты бутика. Смените пароль admin!',
  },
  {
    type: 'shot',
    img: 'admin-10-settings-notify.png',
    file: 'c10.mp4',
    dur: 8,
    title: '10. Почта, SMS и Telegram',
    caption: 'SMTP — письма клиентам. Eskiz — SMS. Telegram-бот — уведомления вам о заказах. Есть кнопки «Тест».',
  },
  {
    type: 'title',
    file: 't99.mp4',
    dur: 5,
    title: 'Готово к работе',
    sub: 'Админка: /admin  ·  Пароль по умолчанию: admin',
    note: 'Смените пароль · подключите почту и Telegram в Настройках',
  },
];

function escDraw(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, ' pct');
}

function run(args) {
  const r = spawnSync(FF, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.slice(0, 4).join(' '));
}

function titleClip(s) {
  const out = path.join(TMP, s.file);
  const vf = [
    `drawtext=fontfile=${FONT}:text='${escDraw(s.title)}':fontsize=64:fontcolor=0xF1E6C8:x=(w-text_w)/2:y=h*0.38`,
    `drawtext=fontfile=${FONT}:text='${escDraw(s.sub)}':fontsize=32:fontcolor=0xD6C9A6:x=(w-text_w)/2:y=h*0.52`,
    `drawtext=fontfile=${FONT}:text='${escDraw(s.note)}':fontsize=22:fontcolor=0x8A8276:x=(w-text_w)/2:y=h*0.62`,
  ].join(',');
  run([
    '-y', '-f', 'lavfi', '-i', `color=c=0x191714:s=1920x1080:d=${s.dur}`,
    '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out,
  ]);
}

function shotClip(s) {
  const out = path.join(TMP, s.file);
  const img = path.join(__dirname, s.img);
  const cap = String(s.caption || '');
  const mid = Math.min(90, Math.floor(cap.length / 2));
  let split = cap.lastIndexOf(' ', mid);
  if (split < 20) split = cap.indexOf(' ', mid);
  if (split < 0) split = cap.length;
  const line1 = escDraw(cap.slice(0, split).trim());
  const line2 = escDraw(cap.slice(split).trim());
  const bar = [
    `scale=1920:900:force_original_aspect_ratio=decrease`,
    `pad=1920:900:(ow-iw)/2:(oh-ih)/2:color=0xF4EFE6`,
    `pad=1920:1080:0:0:color=0x191714`,
    `drawtext=fontfile=${FONT}:text='${escDraw(s.title)}':fontsize=30:fontcolor=0xF1E6C8:x=48:y=930`,
    `drawtext=fontfile=${FONT}:text='${line1}':fontsize=20:fontcolor=0xD6C9A6:x=48:y=980`,
    `drawtext=fontfile=${FONT}:text='${line2}':fontsize=20:fontcolor=0xD6C9A6:x=48:y=1015`,
  ].join(',');
  run([
    '-y', '-loop', '1', '-t', String(s.dur), '-i', img,
    '-vf', bar, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out,
  ]);
}

for (const s of slides) {
  console.log('→', s.file, s.title);
  if (s.type === 'title') titleClip(s);
  else shotClip(s);
}

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, slides.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', OUT]);

const scriptMd = path.join(__dirname, 'SCRIPT.md');
fs.writeFileSync(scriptMd, `# Видео-отчёт админки Nargizka Shop

Файл: \`nargizka-admin-report.mp4\`

## Текст по кадрам

${slides.map((s, i) => `### ${i}. ${s.title}\n${s.caption || s.sub + '\\n' + s.note}\n`).join('\n')}
`, 'utf8');

console.log('DONE', OUT);
