/* Nargizka Shop — общий слой данных: витрина, админ-панель и сервер (Node) */
(function (root) {
  'use strict';

  const IS_NODE = typeof module !== 'undefined' && !!module.exports;

  const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const FABRICS = ['Шёлк', 'Атлас', 'Шифон', 'Креп', 'Бархат', 'Кружево', 'Лён', 'Вискоза', 'Органза', 'Сатин'];
  const SILHOUETTES = ['А-силуэт миди', 'Русалка', 'Коктейльное с рукавами-фонариками', 'Макси с длинным рукавом'];
  const ORDER_STATUSES = ['Новый', 'Подтверждён', 'Отправлен', 'Доставлен', 'Отменён', 'Возврат'];
  // в этих статусах товар возвращён на склад (заказ не держит остаток)
  const STOCK_FREE_STATUSES = ['Отменён', 'Возврат'];
  // статьи расходов, которые являются закупкой товара (не расход для прибыли — себестоимость считается при продаже)
  const PURCHASE_CATEGORY = 'Закупка товара';
  // поступления, которые не являются доходом: вложения владельца и возвраты от поставщика
  const CAPITAL_CATEGORIES = ['Вложение', 'Возврат от поставщика'];
  const PAYMENTS = {
    card: { name: 'Банковская карта', note: 'Uzcard, Humo, Visa, Mastercard' },
    click: { name: 'Click', note: 'Оплата через приложение Click' },
    payme: { name: 'Payme', note: 'Оплата через приложение Payme' },
    cash: { name: 'При получении', note: 'Наличными или картой курьеру' },
  };

  const DEFAULT_CATEGORIES = [
    { id: 'evening', name: 'Вечерние', variant: 1 },
    { id: 'cocktail', name: 'Коктейльные', variant: 2 },
    { id: 'wedding', name: 'Свадебные', variant: 1 },
    { id: 'maxi', name: 'Макси', variant: 3 },
    { id: 'midi', name: 'Миди', variant: 0 },
    { id: 'summer', name: 'Летние', variant: 0 },
    { id: 'office', name: 'Офисные', variant: 3 },
    { id: 'mini', name: 'Мини', variant: 2 },
  ];

  const DEFAULT_COLORS = {
    'Чёрный': '#1c1b1d',
    'Белый': '#f4f0e8',
    'Бордо': '#6d1a2b',
    'Изумрудный': '#0f5c4a',
    'Пудровый': '#e6c2bd',
    'Небесный': '#9cc3e0',
    'Золотой': '#c9a24a',
    'Алый': '#b3141f',
    'Лаванда': '#b9a7d6',
    'Беж': '#d8c3a5',
    'Оливковый': '#6b7044',
    'Сапфир': '#1f3a7a',
    'Фуксия': '#c2276f',
    'Шоколад': '#4a2c22',
  };

  const NAMES = [
    'Аврора', 'Шахерезада', 'Миледи', 'Венеция', 'Жасмин', 'Сапфира', 'Лаура', 'Беатрис',
    'Амели', 'Камилла', 'Изабелла', 'Сафие', 'Лейла', 'Мадина', 'Диана', 'Виктория',
    'Ривьера', 'Монако', 'Санторини', 'Милан', 'Флоренция', 'Марракеш', 'Самарканд', 'Алия',
    'Эсмеральда', 'Жозефина', 'Офелия', 'Луиза', 'Кармен', 'Адель', 'Шанталь', 'Элоиза',
    'Валенсия', 'Портофино', 'Капри', 'Сорренто', 'Ницца', 'Бордо', 'Прованс', 'Женева',
    'Нур', 'Гулнора', 'Бухара', 'Зарина', 'Карина', 'Регина', 'Стелла', 'Грация',
    'Мираж', 'Орхидея', 'Пион', 'Магнолия',
  ];

  const DESCRIPTIONS = {
    evening: 'Вечернее платье для торжественных выходов. Струящийся крой, выверенная посадка по фигуре и благородный блеск ткани создают образ, который запоминают.',
    cocktail: 'Коктейльное платье для вечеринок и ужинов. Лёгкий объём юбки и акцент на талии делают силуэт женственным и игривым.',
    wedding: 'Платье из свадебной линии Nargizka Bridal. Ручная отделка, мягкий корсет и шлейф, который красиво ложится в каждом кадре.',
    maxi: 'Платье в пол, которое одинаково уместно на прогулке и на ужине. Длинные рукава и разрез добавляют элегантности.',
    midi: 'Универсальная длина миди и А-силуэт — платье на каждый день, которое легко стилизовать каблуками или кедами.',
    summer: 'Лёгкое летнее платье из дышащей ткани. Не мнётся в чемодане и идеально подходит для отпуска.',
    office: 'Строгое и женственное офисное платье. Точный крой, комфортная посадка и ткань, которая держит форму весь день.',
    mini: 'Мини-платье с объёмными рукавами — эффектный акцент для вечеринки или свидания.',
  };

  /* ---------- утилиты ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shade(hex, amt) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* Векторная иллюстрация платья — показывается, пока у товара нет настоящих фото */
  function dressSVG(hex, variant) {
    const bg1 = shade(hex, 0.9), bg2 = shade(hex, 0.74);
    const dark = shade(hex, -0.38), light = shade(hex, 0.28);
    const fold = `stroke="${dark}" stroke-opacity=".28" stroke-width="3" fill="none" stroke-linecap="round"`;
    const shapes = [
      `<path d="M276 128 L283 202 M324 128 L317 202" stroke="${dark}" stroke-width="5"/>
       <path d="M280 200 Q300 216 320 200 L336 330 Q300 344 264 330 Z" fill="url(#f)"/>
       <path d="M264 328 Q300 344 336 328 L432 650 Q300 692 168 650 Z" fill="url(#f)"/>
       <path d="M262 326 Q300 342 338 326" stroke="${dark}" stroke-width="7" fill="none"/>
       <path d="M300 348 L296 672 M284 344 L232 656 M316 344 L368 656 M272 342 L196 640 M328 342 L404 640" ${fold}/>`,
      `<path d="M240 192 Q300 218 360 192 L342 332 Q300 346 258 332 Z" fill="url(#f)"/>
       <path d="M258 330 Q300 346 342 330 Q356 450 336 562 L452 742 Q300 776 148 742 L264 562 Q244 450 258 330 Z" fill="url(#f)"/>
       <path d="M240 192 Q300 218 360 192" stroke="${light}" stroke-width="4" fill="none"/>
       <path d="M300 350 L300 560 M300 572 L300 758 M284 580 L220 748 M316 580 L380 748" ${fold}/>`,
      `<ellipse cx="248" cy="196" rx="30" ry="24" fill="url(#f)"/>
       <ellipse cx="352" cy="196" rx="30" ry="24" fill="url(#f)"/>
       <path d="M262 176 Q300 202 338 176 L332 322 Q300 334 268 322 Z" fill="url(#f)"/>
       <path d="M268 320 Q300 334 332 320 L414 504 Q300 536 186 504 Z" fill="url(#f)"/>
       <path d="M266 320 Q300 336 334 320" stroke="${dark}" stroke-width="6" fill="none"/>
       <path d="M300 340 L300 516 M282 338 L238 508 M318 338 L362 508" ${fold}/>`,
      `<path d="M266 172 L222 332 L240 338 L272 216 Z M334 172 L378 332 L360 338 L328 216 Z" fill="url(#f)"/>
       <path d="M264 170 Q300 192 336 170 L340 322 Q300 334 260 322 Z" fill="url(#f)"/>
       <path d="M260 320 Q300 334 340 320 L384 744 Q300 760 216 744 Z" fill="url(#f)"/>
       <path d="M330 520 L348 746" stroke="${dark}" stroke-width="3"/>
       <path d="M300 340 L300 750 M282 340 L262 748" ${fold}/>`,
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
      <defs>
        <radialGradient id="bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
        <linearGradient id="f" x1="0" x2="1">
          <stop offset="0" stop-color="${dark}"/><stop offset=".3" stop-color="${hex}"/>
          <stop offset=".5" stop-color="${light}"/><stop offset=".7" stop-color="${hex}"/><stop offset="1" stop-color="${dark}"/>
        </linearGradient>
      </defs>
      <rect width="600" height="800" fill="url(#bg)"/>
      <ellipse cx="300" cy="770" rx="190" ry="14" fill="#000" opacity=".08"/>
      ${shapes[(+variant || 0) % shapes.length]}
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* Бренд магазина: всё, что меняется при передаче платформы другому магазину */
  function defaultBrand() {
    return {
      name: 'Nargizka Shop',
      short: 'Nargizka',
      tagline: 'женские платья премиум-класса',
      logoUrl: '',
      accent: '',
      dark: '',
      city: 'Ташкент',
      facebook: '',
      tiktok: '',
      youtube: '',
      whatsapp: '',
      workHours: '',
      mapUrl: '',
    };
  }

  /* ---------- остатки по вариантам «цвет|размер» ---------- */
  const vkey = (color, size) => String(color == null ? '' : color) + '|' + String(size == null ? '' : size);
  function splitKey(k) {
    const i = String(k).lastIndexOf('|');
    return i < 0 ? ['', String(k)] : [k.slice(0, i), k.slice(i + 1)];
  }
  /**
   * p.vstock — единственный источник правды по остаткам: { "Цвет|Размер": шт }.
   * p.stock — производное: сумма по размерам (только по цветам, которые есть у товара).
   * Старые данные (остаток только по размеру) переносятся на первый цвет товара.
   */
  function normalizeStock(p, sizes) {
    const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : [''];
    let v = p.vstock && typeof p.vstock === 'object' && !Array.isArray(p.vstock) ? p.vstock : null;
    if (!v) {
      v = {};
      Object.keys(p.stock || {}).forEach((sz) => { v[vkey(colors[0], sz)] = p.stock[sz]; });
    }
    const clean = {};
    Object.keys(v).forEach((k) => {
      if (String(k).indexOf('|') < 0) return;
      clean[k] = Math.max(0, Math.round(+v[k] || 0));
    });
    p.vstock = clean;
    const st = {};
    (sizes || []).forEach((sz) => { st[sz] = 0; });
    Object.keys(clean).forEach((k) => {
      const [c, sz] = splitKey(k);
      if (!colors.includes(c)) return;
      st[sz] = (st[sz] || 0) + clean[k];
    });
    p.stock = st;
    return p;
  }

  /* ---------- демо-данные (цены в сумах) ---------- */
  function defaultSettings() {
    return {
      currency: 'сум',
      usdRate: 12700,
      defaultCurrency: 'UZS',
      freeShippingFrom: 2000000,
      shippingCost: 40000,
      expressCost: 80000,
      pickupEnabled: true,
      returnDays: 3,
      payments: { card: true, click: true, payme: true, cash: true },
      announcements: [
        'Бесплатная доставка по Ташкенту от 2 000 000 сум',
        'Скидка 10% на первый заказ — промокод WELCOME10',
        'Примерка перед покупкой и возврат в течение 3 дней',
      ],
      hero: {
        kicker: 'Новая коллекция · Осень 2026',
        title: 'Платья, в которых\nвас запомнят',
        subtitle: 'Платья от коктейльных до свадебных. Сшито для женщин, которые выбирают лучшее.',
      },
      flash: {
        active: true,
        title: 'Grand Sale',
        percent: 30,
        endsAt: Date.now() + 3 * 86400000 + 5 * 3600000,
        categories: ['evening', 'cocktail'],
      },
      promoCodes: [
        { code: 'WELCOME10', type: 'percent', value: 10, minSum: 0, active: true, expiresAt: 0, limit: 0, used: 0 },
        { code: 'NARGIZKA20', type: 'percent', value: 20, minSum: 3000000, active: true, expiresAt: 0, limit: 0, used: 0 },
        { code: 'GIFT200K', type: 'fixed', value: 200000, minSum: 2000000, active: true, expiresAt: 0, limit: 100, used: 0 },
        { code: 'VIP30', type: 'percent', value: 30, minSum: 8000000, active: false, expiresAt: 0, limit: 0, used: 0 },
      ],
      welcomeCode: 'WELCOME10',
      autoDiscounts: [
        { from: 5000000, percent: 5 },
        { from: 10000000, percent: 10 },
      ],
      categories: DEFAULT_CATEGORIES.map((c) => Object.assign({}, c)),
      colors: Object.assign({}, DEFAULT_COLORS),
      sizes: DEFAULT_SIZES.slice(),
      brand: defaultBrand(),
      contacts: {
        phone: '+998 (90) 777-77-77',
        email: 'hello@nargizka.uz',
        address: 'Ташкент, ул. Амира Темура, 15 — флагманский бутик',
        instagram: '@nargizka.shop',
        telegram: '@nargizka_shop',
      },
    };
  }

  function seedProducts(settings) {
    const r = rng(2026);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const shuffle = (a) => a.map((v) => [r(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const colorNames = Object.keys(settings.colors);
    const cats = settings.categories;
    const basePrice = { evening: 2900000, wedding: 6500000, cocktail: 1500000, maxi: 1800000, midi: 1200000, summer: 750000, office: 1050000, mini: 900000 };

    return NAMES.map((name, i) => {
      const cat = cats[i % cats.length];
      const colors = cat.id === 'wedding'
        ? ['Белый', 'Пудровый', 'Беж'].slice(0, 1 + Math.floor(r() * 3))
        : shuffle(colorNames).slice(0, 2 + Math.floor(r() * 3));
      const stock = {};
      DEFAULT_SIZES.forEach((s) => { stock[s] = r() < 0.12 ? 0 : Math.floor(r() * 14) + 1; });
      if (i % 9 === 4) DEFAULT_SIZES.forEach((s) => { stock[s] = Math.min(stock[s], 1); });
      const price = Math.round(((basePrice[cat.id] || 1000000) * (0.75 + r() * 0.7)) / 10000) * 10000;
      const vstock = {};
      Object.keys(stock).forEach((sz) => {
        let left = stock[sz];
        colors.forEach((c, k) => {
          const q = k === colors.length - 1 ? left : Math.floor(left / (colors.length - k));
          vstock[c + '|' + sz] = q;
          left -= q;
        });
      });
      return {
        id: 'p' + (1001 + i),
        sku: 'NS-' + (1001 + i),
        name: 'Платье «' + name + '»',
        category: cat.id,
        price,
        cost: Math.round((price * 0.45) / 10000) * 10000,
        brand: 'Nargizka',
        discount: r() < 0.38 ? pick([10, 15, 20, 25, 30, 40, 50]) : 0,
        colors,
        vstock,
        stock,
        variant: cat.id === 'evening' ? (i % 2 ? 1 : 3) : cat.variant,
        fabric: pick(FABRICS),
        description: DESCRIPTIONS[cat.id] || '',
        images: [],
        isNew: i >= NAMES.length - 12,
        isHit: r() < 0.22,
        visible: true,
        sold: Math.floor(r() * 420),
        rating: Math.round((4.3 + r() * 0.7) * 10) / 10,
        reviews: Math.floor(r() * 180) + 3,
        createdAt: Date.now() - (NAMES.length - i) * 86400000,
      };
    });
  }

  function seedOrders(products) {
    const r = rng(77);
    const clients = ['Дилноза С.', 'Мадина К.', 'Шахноза Т.', 'Нилуфар Р.', 'Сабина М.', 'Камола А.', 'Малика Б.', 'Гулнора Н.', 'Севара Е.', 'Зарина Ж.', 'Лола О.', 'Феруза Д.'];
    const cities = ['Ташкент', 'Самарканд', 'Бухара', 'Наманган', 'Андижан'];
    const pays = ['Click', 'Payme', 'Банковская карта', 'При получении'];
    return clients.map((name, i) => {
      const items = [];
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const p = products[Math.floor(r() * products.length)];
        const price = Math.round((p.price * (1 - p.discount / 100)) / 1000) * 1000;
        items.push({ id: p.id, name: p.name, color: p.colors[0], size: DEFAULT_SIZES[1 + Math.floor(r() * 3)], qty: 1, price });
      }
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
      const shipping = subtotal >= 2000000 ? 0 : 40000;
      return {
        id: 'NS-' + (240100 + i * 7),
        date: Date.now() - Math.floor(r() * 14) * 86400000 - Math.floor(r() * 80000000),
        customer: { name, phone: '+998 (9' + Math.floor(r() * 10) + ') ' + (100 + i * 37) + '-' + (10 + i) + '-' + (20 + i), email: '', city: cities[i % cities.length], address: 'ул. Навои, ' + (10 + i), comment: '' },
        delivery: 'Курьер',
        payment: pays[i % pays.length],
        items, subtotal, autoDiscount: 0, promo: '', promoDiscount: 0, shipping, total: subtotal + shipping,
        status: ORDER_STATUSES[i < 3 ? 0 : i < 6 ? 1 : i < 8 ? 2 : i < 11 ? 3 : 4],
      };
    }).sort((a, b) => b.date - a.date);
  }

  function seedDB() {
    const settings = defaultSettings();
    const products = seedProducts(settings);
    return { version: 2, products, orders: seedOrders(products), subscribers: [], settings, finance: { openingBalance: 0, entries: [] } };
  }

  /* дополняет данные старых версий новыми полями */
  function migrate(db) {
    const def = defaultSettings();
    db.products = Array.isArray(db.products) ? db.products : [];
    db.orders = Array.isArray(db.orders) ? db.orders : [];
    db.subscribers = Array.isArray(db.subscribers) ? db.subscribers : [];
    if (!db.finance || typeof db.finance !== 'object') db.finance = { openingBalance: 0, entries: [] };
    db.finance.openingBalance = Math.max(0, Math.round(+db.finance.openingBalance || 0));
    db.finance.entries = Array.isArray(db.finance.entries) ? db.finance.entries : [];
    const s = db.settings = Object.assign({}, def, db.settings || {});
    s.hero = Object.assign({}, def.hero, s.hero);
    s.flash = Object.assign({}, def.flash, s.flash);
    s.contacts = Object.assign({}, def.contacts, s.contacts);
    s.payments = Object.assign({}, def.payments, s.payments);
    if (!Array.isArray(s.categories) || !s.categories.length) s.categories = def.categories;
    if (!s.colors || !Object.keys(s.colors).length) s.colors = def.colors;
    if (!Array.isArray(s.sizes) || !s.sizes.length) s.sizes = def.sizes.slice();
    else s.sizes = s.sizes.map((x) => String(x).trim()).filter(Boolean).slice(0, 24);
    s.promoCodes = (s.promoCodes || []).map((c) => Object.assign(
      { type: 'percent', value: +c.percent || 0, minSum: 0, active: true, expiresAt: 0, limit: 0, used: 0 }, c,
    )).map((c) => { delete c.percent; return c; });
    s.brand = Object.assign({}, defaultBrand(), s.brand || {});
    delete s.adminPassword;
    db.products.forEach((p) => {
      p.cost = Math.max(0, Math.round(+p.cost || 0));
      p.brand = p.brand == null ? '' : String(p.brand);
      if (!Array.isArray(p.colors)) p.colors = [];
      normalizeStock(p, s.sizes);
    });
    db.orders.forEach((o) => {
      // старые заказы: оплата по статусу, склад списан, если заказ не отменён
      if (typeof o.paid !== 'boolean') {
        o.paid = o.channel === 'store' || ['Подтверждён', 'Отправлен', 'Доставлен'].includes(o.status);
        o.paidAt = o.paid ? (+o.paidAt || +o.date || 0) : 0;
      }
      if (typeof o.stockOut !== 'boolean') o.stockOut = !STOCK_FREE_STATUSES.includes(o.status);
      if (typeof o.refunded !== 'boolean') o.refunded = false;
      (o.items || []).forEach((it) => { if (it.cost == null) it.cost = null; });
    });
    if (!Array.isArray(db.stockMoves)) db.stockMoves = [];
    db.version = 3;
    return db;
  }

  /* ---------- публичный API ---------- */
  const NS = {
    DEFAULT_SIZES, FABRICS, SILHOUETTES, ORDER_STATUSES, PAYMENTS, STOCK_FREE_STATUSES, PURCHASE_CATEGORY, CAPITAL_CATEGORIES,
    vkey, splitKey, normalizeStock, defaultBrand,
    DEFAULT_CATEGORIES, DEFAULT_COLORS,
    db: null,
    rev: 0,
    cur: 'UZS',
    token: null,
    dressSVG, shade, seedDB, migrate, defaultSettings,

    get CATEGORIES() { return (this.db && this.db.settings.categories) || DEFAULT_CATEGORIES; },
    get COLORS() { return (this.db && this.db.settings.colors) || DEFAULT_COLORS; },
    get SIZES() { return (this.db && this.db.settings.sizes) || DEFAULT_SIZES; },
    get settings() { return this.db.settings; },

    products() { return this.db.products; },
    visibleProducts() { return this.db.products.filter((p) => p.visible); },
    product(id) { return this.db.products.find((p) => p.id === id); },
    catName(id) { const c = this.CATEGORIES.find((x) => x.id === id); return c ? c.name : id; },
    colorHex(name) { return this.COLORS[name] || '#999999'; },
    totalStock(p) { return Object.values(p.stock || {}).reduce((s, n) => s + (+n || 0), 0); },
    /* остаток конкретного варианта; товар без цветов хранит остаток под цветом '' */
    variantStock(p, color, size) {
      const v = p.vstock || {};
      if (!(p.colors || []).length) return +v[vkey('', size)] || 0;
      return +v[vkey(color, size)] || 0;
    },
    colorStock(p, color) {
      return Object.keys(p.vstock || {}).reduce((a, k) => a + (splitKey(k)[0] === color ? +p.vstock[k] || 0 : 0), 0);
    },
    /* первый цвет, в котором есть этот размер */
    colorWithSize(p, size) {
      return (p.colors || []).find((c) => this.variantStock(p, c, size) > 0) || (p.colors || [])[0] || '';
    },
    brand() { return (this.db && this.db.settings && this.db.settings.brand) || defaultBrand(); },

    /**
     * Управленческий отчёт за период [from, to].
     * Выручка — по дате оплаты (кассовый метод): неоплаченные заказы в выручку не входят.
     * Возврат/отмена оплаченного заказа уменьшает выручку и себестоимость в день возврата.
     * Закупка товара — движение денег, но не расход для прибыли: себестоимость учитывается при продаже.
     * Не заменяет бухгалтерскую и налоговую отчётность.
     */
    financeReport(db, from, to) {
      const inRange = (t) => +t >= from && +t <= to;
      const orderCost = (o) => (o.items || []).reduce((a, it) => a + (+it.cost || 0) * (+it.qty || 0), 0);
      const r = {
        revenue: 0, refunds: 0, netRevenue: 0, cogs: 0, cogsReturned: 0, netCogs: 0, gross: 0,
        operating: 0, purchases: 0, otherIncome: 0, capitalIn: 0, net: 0, discounts: 0, promoDiscounts: 0, shipping: 0,
        paidOrders: 0, refundedOrders: 0, itemsSold: 0, missingCost: 0,
        cashIn: 0, cashOut: 0, cashNet: 0,
        unpaidCount: 0, unpaidSum: 0, newCount: 0, ordersCreated: 0,
        byPayment: {}, byDay: {}, byCategory: {}, byChannel: {},
      };
      (db.orders || []).forEach((o) => {
        if (inRange(o.date) && !STOCK_FREE_STATUSES.includes(o.status)) r.ordersCreated++;
        if (o.status === 'Новый') r.newCount++;
        if (!o.paid && !STOCK_FREE_STATUSES.includes(o.status)) { r.unpaidCount++; r.unpaidSum += +o.total || 0; }
        if (o.paid && inRange(o.paidAt || o.date)) {
          const cost = orderCost(o);
          r.revenue += +o.total || 0;
          r.cogs += cost;
          r.paidOrders++;
          r.discounts += +o.autoDiscount || 0;
          r.promoDiscounts += +o.promoDiscount || 0;
          r.shipping += +o.shipping || 0;
          (o.items || []).forEach((it) => { r.itemsSold += +it.qty || 0; if (!(+it.cost > 0)) r.missingCost += +it.qty || 0; });
          const pay = o.payment || 'Не указано';
          r.byPayment[pay] = (r.byPayment[pay] || 0) + (+o.total || 0);
          const ch = o.channel === 'store' ? 'Магазин' : o.channel === 'phone' ? 'По телефону' : 'Сайт';
          r.byChannel[ch] = (r.byChannel[ch] || 0) + (+o.total || 0);
          const d = new Date(o.paidAt || o.date); d.setHours(0, 0, 0, 0);
          const k = d.getTime();
          const x = r.byDay[k] || (r.byDay[k] = { t: k, revenue: 0, cogs: 0, orders: 0, items: 0, refunds: 0 });
          x.revenue += +o.total || 0; x.cogs += cost; x.orders++;
          x.items += (o.items || []).reduce((a, it) => a + (+it.qty || 0), 0);
        }
        if (o.paid && o.refunded && inRange(o.refundedAt)) {
          r.refunds += +o.total || 0;
          r.cogsReturned += orderCost(o);
          r.refundedOrders++;
          const d = new Date(o.refundedAt); d.setHours(0, 0, 0, 0);
          const k = d.getTime();
          const x = r.byDay[k] || (r.byDay[k] = { t: k, revenue: 0, cogs: 0, orders: 0, items: 0, refunds: 0 });
          x.refunds += +o.total || 0; x.cogs -= orderCost(o);
        }
      });
      ((db.finance && db.finance.entries) || []).forEach((e) => {
        if (!inRange(e.date)) return;
        const amt = +e.amount || 0;
        if (e.type === 'in') {
          if (CAPITAL_CATEGORIES.includes(e.category)) r.capitalIn += amt; else r.otherIncome += amt;
          return;
        }
        if (e.category === PURCHASE_CATEGORY) r.purchases += amt; else r.operating += amt;
        r.byCategory[e.category] = (r.byCategory[e.category] || 0) + amt;
      });
      r.netRevenue = r.revenue - r.refunds;
      r.netCogs = r.cogs - r.cogsReturned;
      r.gross = r.netRevenue - r.netCogs;
      r.net = r.gross - r.operating + r.otherIncome;
      r.cashIn = r.revenue + r.otherIncome + r.capitalIn;
      r.cashOut = r.refunds + r.operating + r.purchases;
      r.cashNet = r.cashIn - r.cashOut;
      r.margin = r.netRevenue ? Math.round((r.gross / r.netRevenue) * 100) : 0;
      return r;
    },
    /* деньги в кассе на момент ts: стартовый остаток + все движения до ts */
    cashAt(db, ts) {
      const f = this.financeReport(db, -Infinity, ts);
      return Math.round(+((db.finance && db.finance.openingBalance) || 0) + f.cashNet);
    },

    flashActive() {
      const f = this.db.settings.flash;
      return !!(f && f.active && f.endsAt > Date.now() && f.percent > 0);
    },
    inFlash(p) {
      const f = this.db.settings.flash;
      return this.flashActive() && (!f.categories.length || f.categories.includes(p.category));
    },
    discountOf(p) {
      let d = +p.discount || 0;
      if (this.inFlash(p)) d = Math.max(d, +this.db.settings.flash.percent);
      return Math.min(d, 90);
    },
    finalPrice(p) {
      const d = this.discountOf(p);
      return d ? Math.round((p.price * (1 - d / 100)) / 1000) * 1000 : +p.price;
    },
    image(p, colorIdx) {
      if (p.images && p.images.length) return p.images[(colorIdx || 0) % p.images.length];
      const color = p.colors[(colorIdx || 0) % p.colors.length] || 'Чёрный';
      return dressSVG(this.colorHex(color), p.variant || 0);
    },
    gallery(p) {
      if (p.images && p.images.length) return p.images.slice();
      return p.colors.map((c) => dressSVG(this.colorHex(c), p.variant || 0));
    },

    /* ---------- валюта: цены хранятся в сумах, доллары считаются по курсу ---------- */
    usdRate() { return Math.max(1, +this.db.settings.usdRate || 12700); },
    money(n, cur) {
      if ((cur || this.cur) === 'USD') {
        const v = (+n || 0) / this.usdRate();
        return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v >= 10 ? 0 : 2 });
      }
      return Math.round(+n || 0).toLocaleString('ru-RU') + ' сум';
    },
    altMoney(n) { return this.money(n, this.cur === 'USD' ? 'UZS' : 'USD'); },
    curLabel() { return this.cur === 'USD' ? '$' : 'сум'; },
    toCur(n) { return this.cur === 'USD' ? n / this.usdRate() : n; },
    fromCur(v) { return this.cur === 'USD' ? v * this.usdRate() : v; },

    /* ---------- промокоды и итог заказа ---------- */
    promoLabel(c) { return c.type === 'fixed' ? '−' + this.money(c.value) : '−' + c.value + '%'; },
    promoUsable(c) {
      return !!c && c.active && (!c.expiresAt || c.expiresAt > Date.now()) && (!c.limit || (c.used || 0) < c.limit);
    },
    findPromo(code) {
      if (!code || !this.db.settings.promoCodes) return null;
      const c = this.db.settings.promoCodes.find((x) => x.code.toUpperCase() === String(code).trim().toUpperCase());
      return this.promoUsable(c) ? c : null;
    },
    /* lines: [{ p, qty }] */
    quote(lines, promo, delivery) {
      const s = this.db.settings;
      const subtotal = lines.reduce((a, l) => a + this.finalPrice(l.p) * l.qty, 0);
      const original = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
      const tiers = (s.autoDiscounts || []).filter((t) => +t.from > 0 && +t.percent > 0).sort((a, b) => a.from - b.from);
      const tier = tiers.filter((t) => subtotal >= t.from).pop() || null;
      const nextTier = tiers.find((t) => subtotal < t.from) || null;
      const autoDiscount = tier ? Math.round((subtotal * tier.percent) / 100) : 0;
      const base = subtotal - autoDiscount;
      let promoDiscount = 0, promoError = '';
      if (promo) {
        if (promo.minSum && subtotal < promo.minSum) promoError = `Промокод ${promo.code} действует от ${this.money(promo.minSum)}`;
        else promoDiscount = promo.type === 'fixed' ? Math.min(+promo.value || 0, base) : Math.round((base * (+promo.value || 0)) / 100);
      }
      const after = base - promoDiscount;
      const free = +s.freeShippingFrom || 0;
      let shipping = free && after >= free ? 0 : +s.shippingCost || 0;
      if (delivery === 'express') shipping = +s.expressCost || 0;
      if (delivery === 'pickup') shipping = 0;
      return {
        lines, subtotal, original, saleSaving: original - subtotal,
        tier, nextTier, toNext: nextTier ? nextTier.from - subtotal : 0, autoDiscount,
        code: promo && !promoError ? promo : null, promoDiscount, promoError,
        shipping, total: after + shipping, toFree: free ? Math.max(0, free - after) : 0,
      };
    },
    newId(prefix) {
      return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1000);
    },

    /* ---------- обмен с сервером (браузер) ---------- */
    api(path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = 'Bearer ' + this.token;
      return fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})).then((data) => {
          if (!r.ok) {
            const err = new Error(data.error || 'Сервер недоступен');
            err.status = r.status;
            throw err;
          }
          return data;
        }));
    },
    apply(d) {
      this.db = migrate(d.db);
      this.rev = d.rev;
    },
    load() {
      return this.api('/api/db').then((d) => { this.apply(d); return this.db; });
    },
    loadAdmin() {
      return this.api('/api/admin/db').then((d) => { this.apply(d); this.snapshot(); return this.db; });
    },
    snapshot() {
      this._snap = new Map(this.db.products.map((p) => [p.id, JSON.stringify(p)]));
      this._settings = JSON.stringify(this.db.settings);
    },
    /* отправляет на сервер только изменённые товары и настройки */
    save() {
      const upserts = [];
      const seen = new Set();
      this.db.products.forEach((p, i) => {
        seen.add(p.id);
        const json = JSON.stringify(p);
        const old = this._snap.get(p.id);
        if (old !== json) upserts.push({ p, base: old ? JSON.parse(old) : null, index: i, reason: (this.stockReasons || {})[p.id] || '' });
      });
      const deletes = [...this._snap.keys()].filter((id) => !seen.has(id));
      const settings = JSON.stringify(this.db.settings) !== this._settings ? this.db.settings : null;
      this.stockReasons = {};
      if (!upserts.length && !deletes.length && !settings) return Promise.resolve(true);
      return this.api('/api/admin/save', { upserts, deletes, settings }).then((d) => {
        this.apply(d);
        this.snapshot();
        return true;
      });
    },
    watch(cb, ms) {
      return setInterval(() => {
        this.api('/api/rev').then((r) => { if (r.rev !== this.rev) cb(); }).catch(() => {});
      }, ms);
    },
  };

  if (IS_NODE) module.exports = NS;
  else root.NS = NS;
})(typeof window !== 'undefined' ? window : globalThis);
