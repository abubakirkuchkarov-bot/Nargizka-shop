/**
 * Урок админки: мягкий естественный голос (Edge TTS · SvetlanaNeural).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = __dirname;
const FF = process.env.FFMPEG
  || 'C:/Users/user/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe';
const FP = FF.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
const WORK = path.join(os.tmpdir(), 'nargizka-lesson');
const OUT_FINAL = path.join(SRC, 'nargizka-admin-lesson.mp4');
const AUDIO = path.join(WORK, 'audio');
const CLIPS = path.join(WORK, 'clips');
const TXT = path.join(WORK, 'txt');
const VOICE = 'ru-RU-SvetlanaNeural';
const PROSODY = { rate: '0.92', pitch: '-2Hz', volume: 'soft' };

const lessons = [
  {
    id: '00', img: null, title: 'Вступление',
    text: `Здравствуйте. Давайте спокойно разберём панель управления магазином Наргизка Шоп.
Админка — это ваш личный кабинет. Сюда заходят только сотрудники. Откройте в браузере адрес слэш admin.
Пароль по умолчанию — admin. Пожалуйста, смените его в настройках — так будет безопаснее.
Слева вы видите меню разделов, справа — рабочую область. Язык можно переключить на русский или узбекский.
Сейчас я мягко пройду по каждому пункту: что здесь важно, и как этим пользоваться.`,
  },
  {
    id: '01', img: 'admin-01-dashboard.png', title: '1. Обзор',
    text: `Начнём с раздела «Обзор». Это главная страница — здесь сразу видно, как дела у магазина.
«Выручка» показывает, сколько денег принесли заказы. Отменённые сюда не входят.
«Заказы» — сколько заказов всего, и сколько новых ещё ждут вашего внимания.
«Средний чек» — средняя сумма одного заказа. Удобно понимать, на какую сумму обычно покупают.
«Товары» — сколько позиций на сайте и сколько штук лежит на складе.
«Со скидкой» — сколько платьев сейчас продаётся со скидкой.
«Заканчиваются» — если остаток три штуки или меньше. Если здесь не ноль, лучше вовремя пополнить склад.
«Курс доллара» нужен, чтобы сайт мог показывать цены в долларах. Его меняют в настройках.
«Касса» — сколько денег сейчас по учёту. Ссылка «учёт и отчёты» ведёт в финансы.
Ниже — график продаж за четырнадцать дней и последние заказы.
Хорошая привычка: каждое утро начинать с Обзора. Сначала новые заказы, потом склад.`,
  },
  {
    id: '02', img: 'admin-02-products.png', title: '2. Товары',
    text: `Раздел «Товары» — это весь каталог платьев.
Сверху есть поиск по названию или артикулу, фильтр по категории и сортировка.
Цену и скидку можно аккуратно поправить прямо в таблице — это быстро.
Чтобы добавить новое платье, нажмите «Добавить товар».
Заполните название, описание, категорию, цвета, размеры и количество на складе.
Фото можно загрузить обычным файлом — система примет.
Галочка видимости решает, увидит ли покупатель товар на сайте.
Если модель похожа на уже существующую, её можно продублировать — так экономится время.
Перед акцией загляните в остатки. Если размер закончился, клиент, к сожалению, купить не сможет.`,
  },
  {
    id: '03', img: 'admin-03-orders.png', title: '3. Заказы',
    text: `Раздел «Заказы» — самая важная ежедневная работа.
Красный значок в меню показывает, сколько заказов со статусом «Новый».
Сверху удобные фильтры: Все, Новый, Подтверждён, Отправлен, Доставлен, Отменён.
Как обычно работать: клиент оформил заказ — статус «Новый». Позвоните или напишите, уточните размер и доставку.
Если всё согласовано — поставьте «Подтверждён». Тогда заказ может учитываться в кассе.
Когда отдали курьеру — «Отправлен». Когда клиент получил — «Доставлен».
Если клиент отказался — «Отменён». Такие заказы в выручку и кассу не входят.
Поиск работает по номеру, имени и телефону.
«Подробнее» открывает состав заказа, адрес и способ оплаты.
«Экспорт в Excel» скачивает таблицу — удобно для отчёта или бухгалтера.`,
  },
  {
    id: '04', img: 'admin-04-finance.png', title: '4. Финансы: касса',
    text: `Раздел «Финансы» сделан простым языком — здесь учёт денег магазина.
Сначала выберите период: сегодня, семь дней, этот месяц, квартал, год или всё время.
Даты можно задать и вручную — с какой по какую.
Сверху идёт понятная цепочка.
«Было в кассе» — сколько денег на начало периода.
Плюс «Пришло» — продажи и другие поступления.
Минус «Ушло» — расходы: аренда, закупка, зарплата, реклама.
Равно «Сейчас в кассе» — сколько должно остаться.
Кнопка «Деньги пришли» — если деньги пришли не с сайта: например вложение или возврат от поставщика.
Кнопка «Деньги ушли» — пожалуйста, записывайте расходы. Без этого касса будет казаться больше, чем есть.
«Стартовые деньги» — остаток до начала учёта. Если магазин уже работал, впишите реальную сумму один раз.
И ещё важная галочка: в кассу идут только подтверждённые, отправленные и доставленные заказы. Новые пока не считаются деньгами в кассе — так спокойнее и честнее.`,
  },
  {
    id: '05', img: 'admin-05-finance-sales.png', title: '5. Финансы: отчёты',
    text: `В финансах есть четыре вкладки — давайте коротко по каждой.
«Касса» — движение денег по дням и общая сводка.
«Продажи по дням» — ежедневный отчёт: дата, число заказов, товары, выручка и средний чек.
Справа видно, как платили клиенты: Click, Payme, карта или при получении.
И разбивка по статусам заказа.
«Расходы» — куда ушли деньги по статьям, с процентами.
«Журнал» — полный список операций с остатком после каждой записи. Ручные записи можно изменить или удалить.
Excel или CSV — спокойная выгрузка для бухгалтерии.
Формула простая: продажи плюс ручные приходы минус расходы — это изменение кассы.
Если цифры не сходятся, проверьте расходы и заказы, которые ещё не подтверждены.`,
  },
  {
    id: '06', img: 'admin-06-marketing.png', title: '6. Скидки и акции',
    text: `Раздел «Скидки и акции» управляет тем, что видит покупатель на сайте.
Акция с таймером: включите, задайте название, процент и дату окончания. Можно выбрать категории — например только вечерние и коктейльные.
На сайте появится аккуратный обратный отсчёт.
Скидка от суммы заказа: например от пяти миллионов — пять процентов. В корзине клиент увидит мягкую подсказку добавить ещё.
Массовая скидка позволяет повесить процент на всю категорию одним кликом — и так же снять.
Изменение цен поднимает или снижает базовые цены категории сразу.
Главный баннер и бегущая строка — тексты на главной странице.
Важно помнить порядок: сначала скидка товара или акции, потом от суммы заказа, потом промокод.`,
  },
  {
    id: '07', img: 'admin-07-promos.png', title: '7. Промокоды',
    text: `Раздел «Промокоды» — отдельные коды для клиентов.
Тип скидки: процент от суммы или фиксированная сумма в сумах.
Можно указать минимальную сумму заказа, срок действия и лимит использований.
В таблице видно, сколько раз код уже применили.
Приветственный промокод показывают новым посетителям и выдают после подписки на рассылку.
Список подписчиков можно скачать — это ваша база электронных адресов.
Совет по-доброму: не ставьте слишком большой процент без минимума заказа, чтобы не съедать маржу.`,
  },
  {
    id: '08', img: 'admin-08-catalog.png', title: '8. Категории и размеры',
    text: `Здесь собраны справочники витрины.
Категории — вечерние, свадебные, макси и другие. Названия видны в меню сайта. Удалить можно только пустую категорию без товаров.
Цвета — название и оттенок. Их выбирают в карточке товара.
Размеры — икс эс, эс, эм и свои, например сорок второй.
Если переименовать размер, остатки перенесутся. Удалять размер с остатками нельзя — сначала аккуратно обнулите склад.
Меняйте справочники внимательно: от них зависит весь каталог.`,
  },
  {
    id: '09', img: 'admin-09-settings.png', title: '9. Настройки',
    text: `Раздел «Настройки» — правила магазина.
Цены хранятся в сумах. Курс доллара нужен, чтобы покупатель мог смотреть цены в долларах.
Доставка: стоимость курьера, порог бесплатной доставки — у вас от двух миллионов сум — экспресс и срок возврата.
Способы оплаты: карта, Click, Payme, при получении. Отметьте только те, которыми реально пользуетесь.
Контакты: телефон, почта, адрес бутика, Инстаграм и Телеграм — они показываются на сайте.
Ниже можно сменить пароль администратора. Лучше сделать это сегодня.
Есть и резервная копия: скачайте файл, если хотите сохранить товары и заказы. Фото лежат отдельно в папке uploads.`,
  },
  {
    id: '10', img: 'admin-10-settings-notify.png', title: '10. Почта и Telegram',
    text: `В настройках есть блок «Почта и SMS» — это связь с клиентами и с вами.
Электронная почта через SMTP: Mail точка ru, Yandex или Gmail. Включите тумблер и аккуратно заполните хост, порт, логин, пароль и поле «от кого».
После сохранения нажмите «Тест письма». Если статус «готова» — приветственные письма после подписки начнут уходить.
SMS через Eskiz — по желанию, для Узбекистана.
Telegram: создайте бота у BotFather, вставьте токен и свой Chat ID, включите тумблер. Тест пришлёт вам сообщение.
Так вы не пропустите новый заказ, даже если не смотрите админку.
Если статус красный «не настроена» — пока ничего не отправляется. Заполните поля и проверьте тестом.`,
  },
  {
    id: '99', img: null, title: 'Итог урока',
    text: `Давайте мягко подведём итог. Ежедневный порядок может быть таким.
Первое: Обзор — посмотрите новые заказы и остатки.
Второе: Заказы — подтвердите и ведите статусы.
Третье: Финансы — запишите расходы, посмотрите кассу и продажи по дням.
Четвёртое: Товары и акции — держите каталог и цены актуальными.
Пятое: Настройки — пароль, доставка, почта и Telegram.
Админка сделана так, чтобы ей было удобно пользоваться без сложных бухгалтерских терминов.
Если что-то непонятно — откройте финансы и прочитайте короткую подсказку внизу страницы.
Спасибо, что слушали. Желаю спокойной работы и удачных продаж магазину Наргизка Шоп.`,
  },
];

function writeTxt(name, text) {
  fs.writeFileSync(path.join(TXT, name), text, 'utf8');
}

function run(bin, args) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
    cwd: WORK,
  });
  if (r.status !== 0) {
    throw new Error(`${path.basename(bin)} exit ${r.status}: ${(r.stderr || '').slice(-900)}`);
  }
  return r;
}

function durationSec(file) {
  const r = spawnSync(FP, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8', windowsHide: true });
  const n = parseFloat(String(r.stdout || '').trim());
  if (!(n > 0.2)) throw new Error('bad duration ' + file + ' => ' + r.stdout);
  return n;
}

function chunkText(text, maxLen = 180) {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
  const parts = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).trim().length > maxLen && buf) {
      parts.push(buf.trim());
      buf = s;
    } else buf = (buf + ' ' + s).trim();
  }
  if (buf) parts.push(buf);
  return parts;
}

async function makeTts() {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 25000, synthesisTimeoutMs: 90000 });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  return tts;
}

async function edgeToMp3(text, destMp3) {
  const dir = path.join(AUDIO, '_e_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const tts = await makeTts();
    await tts.toFile(dir, text, PROSODY);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('audio.'));
    if (!files.length) throw new Error('empty audio');
    // validate size
    const src = path.join(dir, files[0]);
    if (fs.statSync(src).size < 800) throw new Error('tiny audio');
    run(FF, ['-y', '-i', path.relative(WORK, src).replace(/\\/g, '/'), '-ar', '24000', '-ac', '1', '-b:a', '64k', path.relative(WORK, destMp3).replace(/\\/g, '/')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sapiToMp3(text, destMp3) {
  const wav = destMp3.replace(/\.mp3$/i, '.wav');
  const ps1 = destMp3.replace(/\.mp3$/i, '.ps1');
  const body = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
try{$s.SelectVoice('Microsoft Irina Desktop')}catch{}
$s.Rate=-3
$s.Volume=90
$s.SetOutputToWaveFile(${JSON.stringify(wav)})
$s.Speak([string]${JSON.stringify(text)})
$s.Dispose()
`;
  fs.writeFileSync(ps1, '\uFEFF' + body, 'utf8');
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.relative(WORK, ps1)]);
  run(FF, ['-y', '-i', path.relative(WORK, wav).replace(/\\/g, '/'), '-ar', '24000', '-ac', '1', '-b:a', '64k', path.relative(WORK, destMp3).replace(/\\/g, '/')]);
}

async function synthLesson(id, text) {
  const chunks = chunkText(text, 170);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = path.join(AUDIO, `${id}_${i}.mp3`);
    let ok = false;
    for (let a = 1; a <= 4 && !ok; a++) {
      try {
        process.stdout.write(`  ${i + 1}/${chunks.length} попытка ${a}… `);
        await edgeToMp3(chunks[i], part);
        console.log('ok');
        ok = true;
      } catch (e) {
        console.log('нет (' + e.message.slice(0, 60) + ')');
        await new Promise((r) => setTimeout(r, 700 * a));
      }
    }
    if (!ok) {
      console.log('  → мягкий запасной Irina');
      sapiToMp3(chunks[i], part);
    }
    parts.push(part);
  }
  const list = path.join(AUDIO, id + '_list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  const out = path.join(AUDIO, id + '.mp3');
  run(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', path.relative(WORK, list).replace(/\\/g, '/'), '-c', 'copy', path.relative(WORK, out).replace(/\\/g, '/')]);
  return out;
}

function stillFromFilters(pngRel, vf, size) {
  run(FF, ['-y', '-f', 'lavfi', '-i', `color=c=0x191714:s=${size}:d=0.04`, '-vf', vf, '-frames:v', '1', pngRel]);
}

function loopStill(pngRel, outRel, dur) {
  run(FF, [
    '-y', '-loop', '1', '-i', pngRel, '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast', '-r', '15', '-an', outRel,
  ]);
}

function titleClip(outRel, dur, title, subtitle) {
  writeTxt('title1.txt', title);
  writeTxt('title2.txt', subtitle);
  const png = outRel.replace(/\.mp4$/i, '.png');
  const vf = [
    `drawtext=fontfile=arial.ttf:textfile=txt/title1.txt:fontsize=48:fontcolor=0xF1E6C8:x=(w-text_w)/2:y=h*0.40`,
    `drawtext=fontfile=arial.ttf:textfile=txt/title2.txt:fontsize=24:fontcolor=0xD6C9A6:x=(w-text_w)/2:y=h*0.52`,
  ].join(',');
  stillFromFilters(png, vf, '1280x720');
  loopStill(png, outRel, dur);
}

function shotClip(outRel, imgRel, dur, title) {
  writeTxt('shot.txt', title);
  const png = outRel.replace(/\.mp4$/i, '.png');
  const vf = [
    `scale=1280:640:force_original_aspect_ratio=decrease`,
    `pad=1280:640:(ow-iw)/2:(oh-ih)/2:color=0xF4EFE6`,
    `pad=1280:720:0:0:color=0x191714`,
    `drawtext=fontfile=arial.ttf:textfile=txt/shot.txt:fontsize=26:fontcolor=0xF1E6C8:x=32:y=660`,
  ].join(',');
  run(FF, ['-y', '-i', imgRel, '-vf', vf, '-frames:v', '1', png]);
  loopStill(png, outRel, dur);
}

function mux(video, audio, out) {
  run(FF, ['-y', '-i', video, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-shortest', out]);
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(AUDIO, { recursive: true });
  fs.mkdirSync(CLIPS, { recursive: true });
  fs.mkdirSync(TXT, { recursive: true });
  fs.copyFileSync('C:/Windows/Fonts/arial.ttf', path.join(WORK, 'arial.ttf'));
  for (const L of lessons) {
    if (L.img) fs.copyFileSync(path.join(SRC, L.img), path.join(WORK, L.img));
  }

  console.log('Голос:', VOICE, '· мягко, вежливо, чуть медленнее');
  // warm-up
  try {
    const warm = path.join(AUDIO, 'warm.mp3');
    await edgeToMp3('Здравствуйте.', warm);
    console.log('связь с голосом ок');
  } catch (e) {
    console.warn('прогрев не удался, продолжаем с повторами:', e.message);
  }

  const built = [];
  for (const L of lessons) {
    console.log('\n===', L.title, '===');
    const mp3 = await synthLesson(L.id, L.text);
    const dur = durationSec(mp3) + 0.8;
    console.log('аудио', Math.round(dur), 'сек');
    const vSilent = path.join('clips', L.id + '-v.mp4');
    const vOut = path.join('clips', L.id + '.mp4');
    if (L.img) shotClip(vSilent, L.img, dur, L.title);
    else titleClip(vSilent, dur, L.title, 'Nargizka Shop - мягкий урок');
    mux(vSilent, path.join('audio', L.id + '.mp3'), vOut);
    built.push(path.join(WORK, vOut));
    console.log('клип готов');
  }

  const list = path.join(CLIPS, 'list.txt');
  fs.writeFileSync(list, built.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const outTmp = path.join(WORK, 'lesson.mp4');
  run(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', 'clips/list.txt', '-c', 'copy', 'lesson.mp4']);
  fs.copyFileSync(outTmp, OUT_FINAL);

  fs.writeFileSync(
    path.join(SRC, 'LESSON-SCRIPT.md'),
    '# Урок админки Nargizka Shop\n\n'
      + `Файл: nargizka-admin-lesson.mp4\nГолос: ${VOICE} (мягкий, вежливый)\n\n`
      + lessons.map((L) => `## ${L.title}\n\n${L.text}\n`).join('\n'),
    'utf8',
  );
  console.log('\nDONE', OUT_FINAL, ((fs.statSync(OUT_FINAL).size / 1024 / 1024).toFixed(2) + ' МБ'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
