/* Nargizka Shop — панель управления (данные хранятся на сервере) */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  const t = (k, v) => I18N.t(k, v);
  function applyStaticI18n() {
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
    document.title = 'Nargizka Shop — ' + t('admin.login');
    const paint = (btn) => {
      if (!btn) return;
      btn.innerHTML = ['ru', 'uz'].map((l) => `<b class="${I18N.lang === l ? 'is-on' : ''}">${t('lang.' + l)}</b>`).join('<i>/</i>');
    };
    paint($('#langBtn'));
    paint($('#langBtnLogin'));
  }
  const money = (n) => NS.money(n, 'UZS');
  const usd = (n) => NS.money(n, 'USD');
  const TOKEN_KEY = 'ns_admin_token';

  function titles() {
    return {
      dashboard: t('admin.dashboard'), products: t('admin.products'), orders: t('admin.orders'),
      finance: t('admin.finance'), marketing: t('admin.marketing'), promos: t('admin.promos'), catalog: t('admin.catalog'),
      settings: t('admin.settings'),
    };
  }
  const ui = {
    products: { q: '', cat: '', filter: 'all', sort: 'new', sel: new Set(), tab: 'list', mq: '', mtype: '' },
    orders: { q: '', status: '', pay: '' },
    finance: { from: '', to: '', kind: 'all', q: '', paidOnly: true, preset: 'month', tab: 'overview', _keepFocus: false },
  };
  let finSearchTimer = null;
  let current = 'dashboard';
  let draft = null;
  let defaultPassword = false;

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };

  /* ---------- общие ---------- */
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    el.innerHTML = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = '.3s'; el.style.opacity = '0'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }
  function onError(e) {
    if (e && e.status === 401) { logout(true); return; }
    toast(esc((e && e.message) || t('admin.error')), 'error');
  }
  function afterServer(d) {
    if (d && d.db) { NS.apply(d); NS.snapshot(); }
    if (d && 'defaultPassword' in d) defaultPassword = !!d.defaultPassword;
    updateBadge();
    updateWarn();
  }

  // Все изменения уходят на сервер по очереди, чтобы не перезаписать друг друга.
  let queue = Promise.resolve();
  function save(msg, redraw) {
    queue = queue.then(() => NS.save()
      .then(() => {
        if (msg) toast(msg);
        updateBadge();
        (redraw || render)();
        return true;
      })
      .catch((e) => {
        onError(e);
        return NS.loadAdmin().then(afterServer).then(() => { render(); return false; }).catch(() => false);
      }));
    return queue;
  }
  function call(path, body, msg) {
    return NS.api(path, body).then((d) => { afterServer(d); if (msg) toast(msg); return d; }).catch((e) => { onError(e); throw e; });
  }

  function openModal(html) {
    $('#modalContent').innerHTML = html;
    $('#modal').classList.add('is-open');
    document.body.classList.add('lock');
  }
  function closeModal() {
    $('#modal').classList.remove('is-open');
    $('#overlay').classList.remove('is-on');
    $('#side').classList.remove('is-open');
    document.body.classList.remove('lock');
    draft = null;
  }
  function fmtDate(ts, withTime) {
    const d = new Date(ts);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('ru-RU', opts);
  }
  function toLocalInput(ts) {
    const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function toDateInput(ts) {
    return ts ? toLocalInput(ts).slice(0, 10) : '';
  }
  function timerHTML(end) {
    return `<div class="timer" data-timer="${end}">${['дн', 'ч', 'мин', 'сек'].map((u) => `<div class="timer__cell"><b>00</b><span>${u}</span></div>`).join('')}</div>`;
  }
  function tickTimers() {
    $$('[data-timer]').forEach((t) => {
      let left = Math.max(0, +t.dataset.timer - Date.now());
      const parts = [86400000, 3600000, 60000, 1000].map((ms) => { const v = Math.floor(left / ms); left -= v * ms; return v; });
      $$('b', t).forEach((b, i) => { b.textContent = String(parts[i]).padStart(2, '0'); });
    });
  }
  setInterval(tickTimers, 1000);
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function updateBadge() {
    const n = NS.db ? NS.db.orders.filter((o) => o.status === 'Новый').length : 0;
    $('#newOrders').textContent = n || '';
  }
  function updateWarn() {
    const bar = $('#warnBar');
    bar.hidden = !defaultPassword;
    bar.innerHTML = defaultPassword ? 'Установлен пароль по умолчанию. <button class="link-btn" data-go="settings">Смените его в настройках →</button>' : '';
  }
  const roundPrice = (n) => Math.max(1000, Math.round(n / 1000) * 1000);
  const promoStatus = (c) => {
    if (!c.active) return ['Выключен', ''];
    if (c.expiresAt && c.expiresAt <= Date.now()) return ['Истёк', 'stock-zero'];
    if (c.limit && (c.used || 0) >= c.limit) return ['Лимит исчерпан', 'stock-zero'];
    return ['Действует', 'tag-ok'];
  };

  /* ---------- вход ---------- */
  function onLangClick() {
    I18N.setLang(I18N.lang === 'ru' ? 'uz' : 'ru');
    applyStaticI18n();
    if (!$('#admin').hidden) render();
  }
  const langBtn = $('#langBtn');
  const langBtnLogin = $('#langBtnLogin');
  if (langBtn) langBtn.onclick = onLangClick;
  if (langBtnLogin) langBtnLogin.onclick = onLangClick;
  applyStaticI18n();

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    NS.token = null;
    NS.api('/api/admin/login', { password: form.password.value })
      .then((r) => {
        NS.token = r.token;
        localStorage.setItem(TOKEN_KEY, r.token);
        form.reset();
        return NS.api('/api/admin/db');
      })
      .then((d) => { NS.apply(d); NS.snapshot(); afterServer(d); showAdmin(); })
      .catch((err) => {
        toast(esc(err.message || 'Неверный пароль'), 'error');
        form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
      })
      .finally(() => { btn.disabled = false; });
  });
  function logout(expired) {
    if (!expired && NS.token) NS.api('/api/admin/logout', {}).catch(() => {});
    NS.token = null;
    localStorage.removeItem(TOKEN_KEY);
    $('#admin').hidden = true;
    $('#login').hidden = false;
    $('#login').style.display = '';
    closeModal();
    if (expired) toast('Сессия истекла — войдите снова', 'error');
  }
  $('#logoutBtn').onclick = () => logout(false);

  function showAdmin() {
    $('#login').hidden = true;
    $('#login').style.display = 'none';
    $('#admin').hidden = false;
    applyAdminBrand();
    go(location.hash.slice(2) || 'dashboard');
  }

  function go(v) {
    current = titles()[v] ? v : 'dashboard';
    if (location.hash !== '#/' + current) history.replaceState(null, '', '#/' + current);
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    applyStaticI18n();
    if ($('#admin').hidden) return;
    $$('#sideNav [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === current));
    $('#viewTitle').textContent = titles()[current];
    $('#topbarActions').innerHTML = '';
    VIEWS[current]();
    updateBadge();
    updateWarn();
    tickTimers();
  }

  /* ---------- обзор ---------- */
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* название магазина в админке */
  function applyAdminBrand() {
    const b = NS.brand();
    if (window.I18N) I18N.setBrand(b);
    document.title = b.name + ' — панель управления';
    const side = $('.side__brand span, .sidebar__brand span');
    if (side) side.innerHTML = esc(String(b.short).toUpperCase()) + '<small>ADMIN</small>';
    $$('.side__brand img, .sidebar__brand img, .login__logo').forEach((img) => { img.src = b.logoUrl || '/assets/logo.svg'; img.alt = b.name; });
  }

  function viewDashboard() {
    const orders = NS.db.orders;
    const prods = NS.products();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const today = NS.financeReport(NS.db, dayStart, Date.now() + 60000);
    const month = NS.financeReport(NS.db, monthStart, Date.now() + 60000);
    const fresh = orders.filter((o) => o.status === 'Новый');
    const unpaid = orders.filter((o) => !o.paid && !NS.STOCK_FREE_STATUSES.includes(o.status));
    const low = prods.filter((p) => NS.totalStock(p) <= 3).sort((a, b) => NS.totalStock(a) - NS.totalStock(b));
    const units = prods.reduce((a, p) => a + NS.totalStock(p), 0);
    const stockValue = prods.reduce((a, p) => a + NS.totalStock(p) * (+p.cost || 0), 0);
    const noCost = prods.filter((p) => !(+p.cost > 0)).length;
    const noPhoto = prods.filter((p) => !(p.images || []).length).length;
    const top = prods.filter((p) => p.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 6);

    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push({ t: d.getTime(), sum: 0, n: 0 });
    }
    orders.forEach((o) => {
      if (!o.paid) return;
      const d = new Date(o.paidAt || o.date); d.setHours(0, 0, 0, 0);
      const x = days.find((k) => k.t === d.getTime());
      if (x) { x.sum += o.refunded ? 0 : o.total; x.n++; }
    });
    const max = Math.max(1, ...days.map((x) => x.sum));
    const W = 700, H = 220, bw = W / days.length;

    $('#topbarActions').innerHTML = `<button class="btn btn--dark" data-new>${t('admin.addProduct')}</button>`;

    const todo = [];
    if (!prods.length) todo.push(`<li><b>Добавьте первый товар</b> — фото, цена, цвета и остатки. <button class="link-btn" data-new>Добавить →</button></li>`);
    if (fresh.length) todo.push(`<li><b>${fresh.length} новых заказов</b> — позвоните клиентам и подтвердите. <button class="link-btn" data-go="orders">Открыть →</button></li>`);
    if (unpaid.length) todo.push(`<li><b>${unpaid.length} заказов не оплачено</b> на ${money(unpaid.reduce((a, o) => a + o.total, 0))}. <button class="link-btn" data-go="orders">Посмотреть →</button></li>`);
    if (low.length && prods.length) todo.push(`<li><b>${low.length} товаров заканчиваются</b> (осталось 3 шт. или меньше). <button class="link-btn" data-go="products">Пополнить →</button></li>`);
    if (noCost && prods.length) todo.push(`<li>У <b>${noCost} товаров</b> нет закупочной цены — прибыль считается неточно.</li>`);
    if (noPhoto && prods.length) todo.push(`<li>У <b>${noPhoto} товаров</b> нет фото — на сайте показан рисунок-заглушка.</li>`);

    view.innerHTML = `
      <div class="quick-actions">
        <button type="button" data-new><b>+ Новый товар</b><small>фото, цена, остатки</small></button>
        <button type="button" data-stock-in><b>Поступление</b><small>пришла новая партия</small></button>
        <button type="button" data-store-sale><b>Продажа / заказ</b><small>в магазине или по телефону</small></button>
        <button type="button" data-go="orders"><b>Заказы${fresh.length ? ' · ' + fresh.length + ' новых' : ''}</b><small>подтвердить, отметить оплату</small></button>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Что сделать сейчас</h2></div>
        ${todo.length ? `<ul class="todo-list" style="margin:0;padding-left:18px;line-height:1.9">${todo.join('')}</ul>` : '<p class="muted" style="margin:0">Всё в порядке: новых заказов нет, неоплаченных нет, остатки в норме.</p>'}
      </div>

      <div class="kpis">
        <div class="kpi kpi--gold"><span>Сегодня</span><b>${money(today.netRevenue)}</b><small>выручка · ${today.paidOrders} ${plural(today.paidOrders, 'оплата', 'оплаты', 'оплат')} · прибыль ${money(today.gross)}</small></div>
        <div class="kpi"><span>Этот месяц</span><b>${money(month.netRevenue)}</b><small>валовая прибыль ${money(month.gross)}</small></div>
        <div class="kpi"><span>Чистая прибыль за месяц</span><b class="${month.net >= 0 ? 'money-in' : 'money-out'}">${month.net < 0 ? '−' : ''}${money(Math.abs(month.net))}</b><small>после расходов <button class="link-btn" data-go="finance">отчёт →</button></small></div>
        <div class="kpi"><span>Не оплачено</span><b>${money(unpaid.reduce((a, o) => a + o.total, 0))}</b><small>${unpaid.length} заказов</small></div>
        <div class="kpi"><span>Склад</span><b>${units} шт.</b><small>${prods.length} товаров · по закупке ${money(stockValue)}</small></div>
        <div class="kpi kpi--gold"><span>Касса</span><b>${money(cashOnHand())}</b><small><button class="link-btn" data-go="finance" style="color:#ead7a6">учёт и отчёты →</button></small></div>
      </div>

      <div class="panels">
        <div>
          <div class="panel">
            <div class="panel__head"><h2>Оплаченные продажи за 14 дней</h2><span class="muted">${money(days.reduce((a, d) => a + d.sum, 0))}</span></div>
            ${days.some((d) => d.sum) ? `<svg class="chart" viewBox="0 0 ${W} ${H}">
              <defs><linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6b25e"/><stop offset="1" stop-color="#8a6a1f"/></linearGradient></defs>
              ${days.map((d, i) => {
                const h = Math.max(2, (d.sum / max) * (H - 40));
                const date = new Date(d.t);
                return `<rect x="${i * bw + 7}" y="${H - 22 - h}" width="${bw - 14}" height="${h}" rx="4" fill="url(#bar)"><title>${date.toLocaleDateString('ru-RU')}: ${money(d.sum)} (${d.n} зак.)</title></rect>
                  <text x="${i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}</text>`;
              }).join('')}
            </svg>` : '<p class="muted">Оплаченных продаж за последние 14 дней пока нет.</p>'}
          </div>
          <div class="panel">
            <div class="panel__head"><h2>Последние заказы</h2><button class="link-btn" data-go="orders">Все заказы →</button></div>
            ${ordersTableHTML(orders.slice(0, 6), true)}
          </div>
        </div>
        <div>
          <div class="panel">
            <div class="panel__head"><h2>Нужно пополнить</h2></div>
            ${low.length ? `<table class="atable"><tbody>
              ${low.slice(0, 8).map((p) => `<tr><td class="name">${esc(p.name)}<div class="sub">${esc(p.sku)}</div></td><td class="num ${NS.totalStock(p) ? 'stock-low' : 'stock-zero'}">${NS.totalStock(p)} шт.</td><td><button class="link-btn" data-stock-for="${p.id}">Поступление</button></td></tr>`).join('')}
            </tbody></table>` : `<p class="muted">${prods.length ? 'Все товары в достаточном количестве.' : 'Товаров пока нет.'}</p>`}
          </div>
          <div class="panel">
            <div class="panel__head"><h2>Бестселлеры</h2></div>
            ${top.length ? `<table class="atable"><tbody>
              ${top.map((p) => `<tr><td><img class="thumb" src="${esc(NS.image(p, 0))}" alt=""></td><td class="name">${esc(p.name)}<div class="sub">${esc(NS.catName(p.category))}</div></td><td class="num">${p.sold} шт.</td></tr>`).join('')}
            </tbody></table>` : '<p class="muted">Появятся после первых продаж.</p>'}
          </div>
        </div>
      </div>`;
  }

  /* ---------- товары ---------- */
  function viewProducts() {
    const st = ui.products;
    const prods = NS.products();
    const visible = prods.filter((p) => p.visible).length;
    const units = prods.reduce((a, p) => a + NS.totalStock(p), 0);
    const low = prods.filter((p) => { const s = NS.totalStock(p); return s > 0 && s <= 3; }).length;
    const out = prods.filter((p) => NS.totalStock(p) === 0).length;
    const sold = prods.reduce((a, p) => a + (+p.sold || 0), 0);
    const storeSales = (NS.db.orders || []).filter((o) => o.channel === 'store' && o.status !== 'Отменён');
    const storeSum = storeSales.reduce((a, o) => a + (+o.total || 0), 0);
    const onlineSales = (NS.db.orders || []).filter((o) => o.channel !== 'store' && o.status !== 'Отменён');
    const onlineSum = onlineSales.reduce((a, o) => a + (+o.total || 0), 0);

    const filters = [
      ['all', 'Все'],
      ['sale', 'Со скидкой'],
      ['low', 'Мало на складе'],
      ['out', 'Нет в наличии'],
      ['hidden', 'Скрытые'],
      ['new', 'Новинки'],
      ['hit', 'Хиты'],
      ['nophoto', 'Без фото'],
    ];
    const sorts = [
      ['new', 'Сначала новые'],
      ['name', 'По названию'],
      ['priceAsc', 'Цена ↑'],
      ['priceDesc', 'Цена ↓'],
      ['stock', 'Остаток ↑'],
      ['sold', 'Продажи ↓'],
    ];

    $('#topbarActions').innerHTML = `
      <button class="btn btn--outline" data-stock-in>Поступление / списание</button>
      <button class="btn btn--outline" data-store-sale>Продажа / заказ вручную</button>
      <button class="btn btn--dark" data-new>+ Добавить товар</button>`;

    view.innerHTML = `
      <div class="prod-hero">
        <div>
          <h2 class="prod-hero__title">Товары и склад</h2>
          <p class="prod-hero__text">Каталог сайта и витрины магазина в одном месте. Продали с полки или приняли заказ по телефону — нажмите <b>Продажа / заказ вручную</b>: товар спишется со склада, деньги попадут в отчёты.</p>
        </div>
      </div>

      <div class="prod-summary">
        <div class="kpi"><span>В каталоге</span><b>${prods.length}</b><small>${visible} на сайте</small></div>
        <div class="kpi"><span>На складе</span><b>${units} шт.</b><small>${low ? low + ' заканчиваются' : 'остатки в норме'} · ${out} без остатка</small></div>
        <div class="kpi"><span>Продано всего</span><b>${sold} шт.</b><small>по всем каналам</small></div>
        <div class="kpi kpi--gold"><span>Магазин</span><b>${money(storeSum)}</b><small>${storeSales.length} продаж с витрины</small></div>
        <div class="kpi"><span>Сайт</span><b>${money(onlineSum)}</b><small>${onlineSales.length} заказов онлайн</small></div>
      </div>

      <div class="fin-tabs" style="margin-bottom:14px">
        <button type="button" class="fin-tab ${st.tab !== 'moves' ? 'is-on' : ''}" data-ptab="list">Товары</button>
        <button type="button" class="fin-tab ${st.tab === 'moves' ? 'is-on' : ''}" data-ptab="moves">Журнал склада</button>
      </div>
      ${st.tab === 'moves' ? movesHTML() : `
      ${!prods.length ? `<div class="empty-state"><h3>Каталог пока пуст</h3><p>Добавьте первый товар: фото, цену, цвета и остатки по размерам.</p><button class="btn btn--dark" data-new>+ Добавить товар</button></div>` : ''}
      <div class="prod-card" ${prods.length ? '' : 'hidden'}>
        <div class="prod-card__label">Поиск и фильтры</div>
        <div class="prod-filters">
          <label class="prod-field prod-field--grow"><span>Поиск</span>
            <input class="input" type="search" id="prodSearch" placeholder="Название, артикул или бренд…" value="${esc(st.q)}" data-pf="q">
          </label>
          <label class="prod-field"><span>Категория</span>
            <select class="select" data-pf="cat"><option value="">Все категории</option>${NS.CATEGORIES.map((c) => `<option value="${esc(c.id)}" ${st.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          </label>
          <label class="prod-field"><span>Сортировка</span>
            <select class="select" data-pf="sort">${sorts.map(([v, t]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
        </div>
        <div class="prod-chips" role="group">
          ${filters.map(([v, label]) => `<button type="button" class="prod-chip ${st.filter === v ? 'is-on' : ''}" data-pfilter="${v}">${label}</button>`).join('')}
        </div>
      </div>

      <div id="pTable" ${prods.length ? '' : 'hidden'}></div>
      <p class="prod-help">Сайт и магазин делят один склад. Заказ на сайте сразу резервирует товар (цвет и размер). Отмена или возврат возвращают товар на склад — ровно один раз. Каждое изменение остатка видно во вкладке «Журнал склада».</p>`}`;
    renderProductsTable();
    const search = $('#prodSearch');
    if (search && st._keepFocus) {
      search.focus();
      try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
      st._keepFocus = false;
    }
  }

  function filteredProducts() {
    const st = ui.products;
    const q = st.q.trim().toLowerCase();
    const list = NS.products().filter((p) => {
      if (q && !(p.name + ' ' + p.sku + ' ' + (p.brand || '')).toLowerCase().includes(q)) return false;
      if (st.cat && p.category !== st.cat) return false;
      const stock = NS.totalStock(p);
      switch (st.filter) {
        case 'sale': return NS.discountOf(p) > 0;
        case 'nosale': return !NS.discountOf(p);
        case 'nophoto': return !(p.images || []).length;
        case 'low': return stock > 0 && stock <= 3;
        case 'out': return stock === 0;
        case 'hidden': return !p.visible;
        case 'new': return p.isNew;
        case 'hit': return p.isHit;
        default: return true;
      }
    });
    const sorters = {
      new: (a, b) => b.createdAt - a.createdAt,
      name: (a, b) => a.name.localeCompare(b.name, 'ru'),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      stock: (a, b) => NS.totalStock(a) - NS.totalStock(b),
      sold: (a, b) => b.sold - a.sold,
    };
    return list.sort(sorters[st.sort] || sorters.new);
  }

  function renderProductsTable() {
    const st = ui.products;
    if (!$('#pTable')) return;
    const list = filteredProducts();
    const ids = new Set(NS.products().map((p) => p.id));
    st.sel.forEach((id) => { if (!ids.has(id)) st.sel.delete(id); });
    const allSel = list.length && list.every((p) => st.sel.has(p.id));

    $('#pTable').innerHTML = `
      ${st.sel.size ? `<div class="bulk">
        <b>Выбрано: ${st.sel.size}</b>
        <span style="margin-left:8px">Скидка</span><input class="input" type="number" min="0" max="90" id="bulkPct" placeholder="%">
        <button class="btn btn--gold" data-bulk="discount">Применить скидку</button>
        <button class="btn btn--outline" data-bulk="nodiscount">Снять скидку</button>
        <span style="margin-left:8px">Цена ±</span><input class="input" type="number" min="-90" max="500" id="bulkPrice" placeholder="%">
        <button class="btn btn--outline" data-bulk="price">Изменить цену</button>
        <button class="btn btn--outline" data-bulk="show">Показать</button>
        <button class="btn btn--outline" data-bulk="hide">Скрыть</button>
        <button class="btn btn--outline" data-bulk="new">«Новинка»</button>
        <button class="btn btn--outline" data-bulk="hit">«Хит»</button>
        <button class="btn btn--sale" data-bulk="delete">Удалить</button>
        <button class="link-btn" data-bulk="clear" style="color:#fff;margin-left:auto">Снять выделение</button>
      </div>` : ''}
      <div class="table-wrap"><table class="atable">
        <thead><tr>
          <th><input type="checkbox" data-selall ${allSel ? 'checked' : ''} aria-label="Выбрать все"></th>
          <th></th><th>Товар</th><th>Категория</th><th>Цена</th><th>Скидка</th><th>Итого</th><th>Склад</th><th>Продано</th><th>Сайт</th><th></th>
        </tr></thead>
        <tbody>
          ${list.length ? list.map((p) => {
            const stock = NS.totalStock(p);
            const d = NS.discountOf(p);
            const flashOver = NS.inFlash(p) && d > (+p.discount || 0);
            const photos = (p.images || []).length;
            const sizes = NS.SIZES.filter((sz) => +(p.stock && p.stock[sz]) > 0).map((sz) => sz + ':' + p.stock[sz]).join(' · ');
            const vtitle = Object.keys(p.vstock || {}).filter((k) => +p.vstock[k] > 0).map((k) => k.replace('|', ' ') + ': ' + p.vstock[k]).join('\n');
            return `<tr class="${p.visible ? '' : 'is-hidden'}">
              <td><input type="checkbox" data-sel="${p.id}" ${st.sel.has(p.id) ? 'checked' : ''}></td>
              <td><img class="thumb" src="${esc(NS.image(p, 0))}" alt=""></td>
              <td class="name">${esc(p.name)}<div class="sub">${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''} · ${photos ? photos + ' фото' : 'без фото'}${p.isNew ? ' · Новинка' : ''}${p.isHit ? ' · Хит' : ''}</div></td>
              <td>${esc(NS.catName(p.category))}</td>
              <td class="num"><input class="mini-input mini-input--price" type="number" min="1000" step="1000" value="${p.price}" data-price="${p.id}" aria-label="Цена, сум"><div class="sub">${p.cost ? 'закупка ' + money(p.cost) : '<span style="color:var(--sale)">нет закупочной цены</span>'}</div></td>
              <td><input class="mini-input" type="number" min="0" max="90" value="${+p.discount || 0}" data-disc="${p.id}" aria-label="Скидка, %"> %</td>
              <td class="num ${d ? 'tag-sale' : ''}">${money(NS.finalPrice(p))}<div class="sub">≈ ${usd(NS.finalPrice(p))}${flashOver ? ` · акция −${d}%` : ''}</div></td>
              <td class="num ${stock === 0 ? 'stock-zero' : stock <= 3 ? 'stock-low' : ''}" title="${esc(vtitle || sizes)}">${stock}<div class="sub">${sizes || '—'}</div></td>
              <td class="num">${p.sold}</td>
              <td><label class="switch"><input type="checkbox" data-vis="${p.id}" ${p.visible ? 'checked' : ''}><span></span></label></td>
              <td><div class="row-actions">
                <button type="button" class="btn-sale-mini" data-quick-sale="${p.id}" title="Продать в магазине">Витрина</button>
                <button data-edit="${p.id}" title="Редактировать">${ICONS.edit}</button>
                <a href="/#/product/${p.id}" target="_blank" rel="noopener" title="Открыть на сайте" class="row-actions-link"><button tabindex="-1">${ICONS.ext}</button></a>
                <button data-dup="${p.id}" title="Дублировать">${ICONS.copy}</button>
                <button data-moves="${p.id}" title="Движения склада">${ICONS.eye}</button>
                <button data-del="${p.id}" title="Удалить">${ICONS.trash}</button>
              </div></td>
            </tr>`;
          }).join('') : '<tr><td colspan="11" class="empty-row">Товары не найдены</td></tr>'}
        </tbody>
      </table></div>
      <p class="muted" style="margin-top:12px;font-size:13px">Показано ${list.length} из ${NS.products().length}. Цену и скидку меняйте в таблице — сохраняется сразу. Кнопка «Витрина» — быстрая продажа с полки.</p>`;
  }


  function movesHTML() {
    const st = ui.products;
    const moves = NS.db.stockMoves || [];
    const types = { sale: 'Продажа', cancel: 'Отмена заказа', return: 'Возврат', receipt: 'Поступление', writeoff: 'Списание', adjust: 'Корректировка', initial: 'Начальный остаток', restock: 'Повторное списание' };
    const q = (st.mq || '').trim().toLowerCase();
    const list = moves.filter((m) => (!st.mtype || m.type === st.mtype)
      && (!q || [m.productName, m.variant, m.reason, m.ref].join(' ').toLowerCase().includes(q)));
    return `<div class="prod-card"><div class="prod-filters">
        <label class="prod-field prod-field--grow"><span>Поиск</span><input class="input" type="search" id="movesSearch" placeholder="Товар, причина, номер заказа…" value="${esc(st.mq)}" data-mq></label>
        <label class="prod-field"><span>Тип</span><select class="select" data-mtype><option value="">Все</option>${Object.keys(types).map((k) => `<option value="${k}" ${st.mtype === k ? 'selected' : ''}>${types[k]}</option>`).join('')}</select></label>
      </div></div>
      <div class="panel" style="padding:8px">
      ${list.length ? `<div class="table-wrap" style="border:0"><table class="atable">
        <thead><tr><th>Когда</th><th>Товар</th><th>Цвет · размер</th><th>Изменение</th><th>Стало</th><th>Тип</th><th>Причина</th></tr></thead>
        <tbody>${list.slice(0, 300).map((m) => {
          const [c, sz] = NS.splitKey(m.variant);
          return `<tr><td>${fmtDate(m.at, true)}</td><td class="name">${esc(m.productName || m.productId)}</td><td>${esc([c, sz].filter(Boolean).join(' · '))}</td>
          <td class="num ${m.delta > 0 ? 'mv-in' : 'mv-out'}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td class="num">${m.qtyAfter}</td>
          <td>${esc(types[m.type] || m.type)}</td><td class="name">${esc(m.reason || '')}${m.ref ? ` <button class="link-btn" data-order="${esc(m.ref)}">${esc(m.ref)}</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="muted" style="font-size:12.5px;margin:8px">Показано ${Math.min(300, list.length)} из ${list.length}. Журнал не редактируется — ошибки исправляются новой корректировкой.</p>` : '<p class="muted" style="padding:16px">Движений склада пока нет. Они появятся после поступления, продажи или корректировки.</p>'}
      </div>`;
  }

  /* Продажа в магазине или заказ по телефону: несколько товаров, цвет, размер, оплата и статус */
  function openStoreSaleForm(prefillId) {
    const products = NS.products().filter((p) => NS.totalStock(p) > 0);
    if (!products.length) return toast('Нет товаров с остатком — сначала сделайте поступление на склад', 'error');
    const pre = prefillId ? NS.product(prefillId) : null;
    const first = pre && NS.totalStock(pre) > 0 ? pre : products[0];
    const optsFor = (p) => {
      const out = [];
      (p.colors.length ? p.colors : ['']).forEach((c) => NS.SIZES.forEach((sz) => {
        const n = NS.variantStock(p, c, sz);
        if (n > 0) out.push(`<option value="${esc(NS.vkey(c, sz))}">${esc([c, sz].filter(Boolean).join(' · '))} — ${n} шт.</option>`);
      }));
      return out.join('');
    };
    const lineHTML = (p) => `<div class="sale-line">
        <div class="field"><label>Товар</label><select class="input" data-sl="product">${products.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.sku)}</option>`).join('')}</select></div>
        <div class="field"><label>Цвет · размер</label><select class="input" data-sl="variant">${optsFor(p)}</select></div>
        <div class="field"><label>Цена, сум</label><input class="input" type="number" min="0" step="1000" data-sl="price" value="${NS.finalPrice(p)}"></div>
        <div class="field"><label>Кол-во</label><input class="input" type="number" min="1" data-sl="qty" value="1"></div>
        <div class="field"><label>Сумма</label><input class="input" data-sl="sum" value="${money(NS.finalPrice(p))}" readonly tabindex="-1"></div>
        <button type="button" class="icon-btn" data-sl-del title="Убрать строку">${ICONS.trash}</button>
      </div>`;
    openModal(`<h2>Продажа или заказ вручную</h2>
      <p class="hint" style="margin-top:-6px">Для продажи с полки магазина или заказа, принятого по телефону. Товар списывается со склада сразу, деньги попадают в отчёты, когда заказ отмечен оплаченным.</p>
      <form id="storeSaleForm" class="form-grid">
        <div class="field full"><label>Что оформляем</label>
          <div class="fin-seg" role="group">
            <button type="button" class="fin-seg__btn is-on" data-channel="store">Продажа в магазине</button>
            <button type="button" class="fin-seg__btn" data-channel="phone">Заказ по телефону</button>
          </div>
        </div>
        <div class="full sale-lines" id="saleLines">${lineHTML(first)}</div>
        <div class="full"><button type="button" class="btn btn--outline" data-sl-add style="height:40px">+ Ещё товар</button></div>
        <div class="field"><label>Скидка на весь заказ, сум</label><input class="input" type="number" min="0" step="1000" name="discount" value="0"></div>
        <div class="field" data-phone-only hidden><label>Доставка, сум</label><input class="input" type="number" min="0" step="1000" name="shipping" value="0"></div>
        <div class="field"><label>Способ оплаты</label>
          <select class="input" name="payment">
            <option>Наличные в магазине</option><option>Карта в магазине</option><option>Click</option><option>Payme</option><option>Перевод</option><option>При получении</option>
          </select>
        </div>
        <label class="toggle-row">Оплачено<span class="switch"><input type="checkbox" name="paid" checked><span></span></span></label>
        <div class="field" data-phone-only hidden><label>Статус</label><select class="input" name="status">${NS.ORDER_STATUSES.filter((x) => !NS.STOCK_FREE_STATUSES.includes(x)).map((x) => `<option ${x === 'Подтверждён' ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label>Имя клиента</label><input class="input" name="customerName" placeholder="необязательно в магазине"></div>
        <div class="field"><label>Телефон</label><input class="input" name="customerPhone" placeholder="+998 …"></div>
        <div class="field full" data-phone-only hidden><label>Адрес доставки</label><input class="input" name="address"></div>
        <div class="field full"><label>Комментарий</label><input class="input" name="note" placeholder="Например: примерка, подарочная упаковка"></div>
        <div class="full" id="saleTotal" style="font-size:16px"></div>
        <div class="full form-actions">
          <button type="button" class="btn btn--outline" data-close>Отмена</button>
          <button type="submit" class="btn btn--dark">Оформить и списать со склада</button>
        </div>
      </form>`);
    const form = $('#storeSaleForm');
    form.dataset.channel = 'store';
    const recalc = () => {
      let sum = 0;
      $$('.sale-line', form).forEach((row) => {
        const v = Math.max(0, +$('[data-sl="price"]', row).value || 0) * Math.max(1, +$('[data-sl="qty"]', row).value || 1);
        $('[data-sl="sum"]', row).value = money(v);
        sum += v;
      });
      const total = Math.max(0, sum - (+form.discount.value || 0)) + (form.dataset.channel === 'phone' ? +form.shipping.value || 0 : 0);
      $('#saleTotal').innerHTML = `Итого к оплате: <b>${money(total)}</b>`;
    };
    form.addEventListener('input', recalc);
    form.addEventListener('change', (e) => {
      if (e.target.dataset.sl === 'product') {
        const row = e.target.closest('.sale-line');
        const p = NS.product(e.target.value);
        $('[data-sl="variant"]', row).innerHTML = optsFor(p) || '<option value="">Нет остатка</option>';
        $('[data-sl="price"]', row).value = NS.finalPrice(p);
      }
      recalc();
    });
    form.addEventListener('click', (e) => {
      const ch = e.target.closest('[data-channel]');
      if (ch) {
        form.dataset.channel = ch.dataset.channel;
        $$('[data-channel]', form).forEach((b) => b.classList.toggle('is-on', b === ch));
        $$('[data-phone-only]', form).forEach((x) => { x.hidden = ch.dataset.channel !== 'phone'; });
        form.paid.checked = ch.dataset.channel === 'store';
        form.payment.value = ch.dataset.channel === 'store' ? 'Наличные в магазине' : 'При получении';
        recalc();
      }
      if (e.target.closest('[data-sl-add]')) { $('#saleLines').insertAdjacentHTML('beforeend', lineHTML(products[0])); recalc(); }
      const del = e.target.closest('[data-sl-del]');
      if (del && $$('.sale-line', form).length > 1) { del.closest('.sale-line').remove(); recalc(); }
    });
    recalc();
  }


  /* Поступление, списание или точный пересчёт по всем цветам и размерам одного товара */
  function openStockInForm(prefillId, mode) {
    const products = NS.products();
    if (!products.length) return toast('Сначала добавьте товар', 'error');
    let p = (prefillId && NS.product(prefillId)) || products[0];
    mode = mode || 'in';
    const titles = { in: 'Поступление товара', out: 'Списание', set: 'Пересчёт остатка' };
    const hints = {
      in: 'Новая партия пришла на склад. Впишите, сколько штук каждого цвета и размера пришло.',
      out: 'Брак, утеря, порча или подарок. Впишите, сколько штук убрать. Причина обязательна.',
      set: 'Пересчитали товар на складе? Впишите фактическое количество — система сама посчитает разницу. Причина обязательна.',
    };
    const grid = () => {
      const rows = p.colors.length ? p.colors : [''];
      return `<div class="table-wrap vgrid-wrap"><table class="vgrid"><thead><tr><th>Цвет</th>${NS.SIZES.map((sz) => `<th>${esc(sz)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((c) => `<tr><td class="vgrid__color">${c ? `<i style="background:${NS.colorHex(c)}"></i>${esc(c)}` : 'Без цвета'}</td>
          ${NS.SIZES.map((sz) => { const n = NS.variantStock(p, c, sz); return `<td><input type="number" min="0" inputmode="numeric" data-mv="${esc(NS.vkey(c, sz))}" placeholder="${mode === 'set' ? n : '0'}" ${mode === 'set' ? `value="${n}"` : ''}><div class="sub">сейчас ${n}</div></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    openModal(`<h2 id="mvTitle">${titles[mode]}</h2>
      <form id="stockMoveForm" class="form-grid">
        <div class="field full"><div class="fin-seg" role="group">
          ${Object.keys(titles).map((k) => `<button type="button" class="fin-seg__btn ${k === mode ? 'is-on' : ''}" data-mvmode="${k}">${{ in: 'Поступление', out: 'Списание', set: 'Пересчёт' }[k]}</button>`).join('')}
        </div><p class="hint" id="mvHint" style="margin:8px 0 0">${hints[mode]}</p></div>
        <div class="field full"><label>Товар</label>
          <select class="input" name="productId">${products.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} · ${esc(x.sku)} · сейчас ${NS.totalStock(x)} шт.</option>`).join('')}</select>
        </div>
        <div class="full" id="mvGrid">${grid()}</div>
        <div class="field" data-in-only ${mode === 'in' ? '' : 'hidden'}><label>Закупочная цена за 1 шт., сум</label><input class="input" type="number" min="0" step="1000" name="unitCost" value="${+p.cost || ''}" placeholder="0"></div>
        <label class="toggle-row" data-in-only ${mode === 'in' ? '' : 'hidden'}>Записать оплату поставщику в расходы<span class="switch"><input type="checkbox" name="recordExpense" checked><span></span></span></label>
        <div class="field full"><label id="mvReasonLabel">${mode === 'in' ? 'Комментарий (поставщик, накладная)' : 'Причина *'}</label><input class="input" name="reason" placeholder="${mode === 'in' ? 'Например: поставщик Ali, накладная 15' : 'Например: брак, пересчёт склада'}"></div>
        <div class="full" id="mvTotal"></div>
        <div class="full form-actions">
          <button type="button" class="btn btn--outline" data-close>Отмена</button>
          <button type="submit" class="btn btn--dark">Записать</button>
        </div>
      </form>`);
    const form = $('#stockMoveForm');
    form.dataset.mode = mode;
    const recalc = () => {
      let qty = 0;
      $$('[data-mv]', form).forEach((i) => {
        const v = Math.max(0, Math.round(+i.value || 0));
        if (form.dataset.mode === 'set') { if (i.value !== '') { const [c, sz] = NS.splitKey(i.dataset.mv); qty += Math.abs(v - NS.variantStock(p, c, sz)); } } else qty += v;
      });
      const cost = +form.unitCost.value || 0;
      $('#mvTotal').innerHTML = form.dataset.mode === 'in'
        ? `Пришло: <b>${qty} шт.</b>${cost ? ` · сумма закупки <b>${money(qty * cost)}</b>` : ''}`
        : form.dataset.mode === 'out' ? `Списать: <b>${qty} шт.</b>` : `Изменится: <b>${qty} шт.</b>`;
    };
    form.addEventListener('input', recalc);
    form.addEventListener('change', (e) => {
      if (e.target.name === 'productId') { p = NS.product(e.target.value); $('#mvGrid').innerHTML = grid(); form.unitCost.value = +p.cost || ''; }
      recalc();
    });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mvmode]');
      if (!b) return;
      mode = b.dataset.mvmode;
      form.dataset.mode = mode;
      $$('[data-mvmode]', form).forEach((x) => x.classList.toggle('is-on', x === b));
      $('#mvTitle').textContent = titles[mode];
      $('#mvHint').textContent = hints[mode];
      $$('[data-in-only]', form).forEach((x) => { x.hidden = mode !== 'in'; });
      $('#mvReasonLabel').textContent = mode === 'in' ? 'Комментарий (поставщик, накладная)' : 'Причина *';
      $('#mvGrid').innerHTML = grid();
      recalc();
    });
    recalc();
  }


  function bulk(action) {
    const st = ui.products;
    const sel = NS.products().filter((p) => st.sel.has(p.id));
    if (!sel.length) return;
    const redraw = renderProductsTable;
    if (action === 'clear') { st.sel.clear(); return renderProductsTable(); }
    if (action === 'discount') {
      const v = Math.round(+$('#bulkPct').value);
      if (!(v > 0 && v <= 90)) return toast('Укажите скидку от 1 до 90%', 'error');
      sel.forEach((p) => { p.discount = v; });
      save(`Скидка −${v}% применена к ${sel.length} товарам`, redraw);
    } else if (action === 'nodiscount') {
      sel.forEach((p) => { p.discount = 0; });
      save('Скидки сняты', redraw);
    } else if (action === 'price') {
      const v = +$('#bulkPrice').value;
      if (!v || v <= -90 || v > 500) return toast('Укажите изменение цены в %: например 10 или −15', 'error');
      if (!confirm(`${v > 0 ? 'Поднять' : 'Снизить'} цену ${sel.length} товаров на ${Math.abs(v)}%?`)) return;
      sel.forEach((p) => { p.price = roundPrice(p.price * (1 + v / 100)); });
      save(`Цены изменены на ${v > 0 ? '+' : ''}${v}%`, redraw);
    } else if (action === 'show' || action === 'hide') {
      sel.forEach((p) => { p.visible = action === 'show'; });
      save(action === 'show' ? 'Товары опубликованы' : 'Товары скрыты с сайта', redraw);
    } else if (action === 'new' || action === 'hit') {
      sel.forEach((p) => { p[action === 'new' ? 'isNew' : 'isHit'] = true; });
      save(action === 'new' ? 'Отмечено как новинки' : 'Отмечено как хиты', redraw);
    } else if (action === 'delete') {
      if (!confirm(`Удалить ${sel.length} товаров безвозвратно?`)) return;
      NS.db.products = NS.products().filter((p) => !st.sel.has(p.id));
      st.sel.clear();
      save('Товары удалены', redraw);
    }
  }

  /* ---------- форма товара ---------- */
  function previewCard(p) {
    const d = NS.discountOf(p);
    return `<article class="card">
      <div class="card__top"><div class="card__media">
        <img class="card__img" src="${esc(NS.image(p, 0))}" alt="">
        <div class="badges">${d ? `<span class="badge badge--sale">−${d}%</span>` : ''}${p.isNew ? '<span class="badge">Новинка</span>' : ''}${p.isHit ? '<span class="badge badge--hit">Хит продаж</span>' : ''}</div>
      </div></div>
      <div class="card__body">
        <div class="swatches">${p.colors.map((c) => `<span class="swatch" style="background:${NS.colorHex(c)}"></span>`).join('')}</div>
        <div class="card__title">${esc(p.name || 'Название товара')}</div>
        <div class="card__cat">${esc(NS.catName(p.category))} · ${esc(p.fabric)}</div>
        <div class="price">${d ? `<span class="price__now is-sale">${money(NS.finalPrice(p))}</span><s>${money(p.price)}</s>` : `<span class="price__now">${money(p.price)}</span>`}</div>
        <div class="sub" style="margin-top:4px">≈ ${usd(NS.finalPrice(p))}</div>
      </div>
    </article>`;
  }

  function openProductForm(id, duplicate) {
    const src = id ? NS.product(id) : null;
    if (id && !src) return;
    const nextNum = NS.products().reduce((m, p) => Math.max(m, parseInt(String(p.sku).replace(/\D/g, ''), 10) || 0), 1000) + 1;
    if (src) {
      draft = JSON.parse(JSON.stringify(src));
      if (duplicate) {
        Object.assign(draft, { id: NS.newId('p'), sku: 'NS-' + nextNum, name: draft.name + ' (копия)', sold: 0, reviews: 0, createdAt: Date.now(), vstock: {} });
      }
    } else {
      const firstCat = NS.CATEGORIES[0] ? NS.CATEGORIES[0].id : 'evening';
      const firstColor = Object.keys(NS.COLORS)[0] || 'Чёрный';
      draft = {
        id: NS.newId('p'), sku: 'NS-' + nextNum, name: '', brand: (NS.brand().short || ''), category: firstCat, price: 0, cost: 0, discount: 0,
        colors: [firstColor], vstock: {}, stock: {}, variant: 1, fabric: '',
        description: '', images: [], isNew: true, isHit: false, visible: true, sold: 0, rating: 5, reviews: 0, createdAt: Date.now(),
      };
    }
    const isEdit = !!src && !duplicate;
    if (!draft.vstock) draft.vstock = {};
    draft.images = draft.images || [];
    const origV = JSON.stringify(draft.vstock);
    const p = draft;
    let uploading = 0;

    openModal(`<h2>${isEdit ? 'Редактирование товара' : 'Новый товар'}</h2>
      <form id="pForm" class="pform" novalidate>
        <div>
          <h3>Фотографии</h3>
          <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Загрузите реальные фото платья. Первое фото — главное в каталоге. Порядок меняется стрелками. Любой формат и размер (JPG, PNG, WEBP, HEIC, GIF и др.) — фото автоматически приводятся к удобному виду.</p>
          <div class="img-list" id="imgList"></div>
          <label class="upload" id="uploadBox">Загрузить фото любого формата и размера (можно несколько)<input type="file" accept="image/*,.heic,.heif,.avif,.bmp,.tif,.tiff" multiple id="imgFile"></label>
          <div class="img-add">
            <input class="input" id="imgUrl" placeholder="или ссылка на фото (https://…)">
            <button type="button" class="btn btn--outline" data-img-add>Добавить</button>
          </div>

          <h3>Основное</h3>
          <div class="form-grid">
            <div class="field full"><label>Название *</label><input class="input" name="title" value="${esc(p.name)}" placeholder="Платье «…»" required></div>
            <div class="field"><label>Артикул *</label><input class="input" name="sku" value="${esc(p.sku)}"></div>
            <div class="field"><label>Бренд</label><input class="input" name="brand" value="${esc(p.brand || '')}" list="brands" placeholder="Например: ${esc(NS.brand().short)}"><datalist id="brands">${[...new Set(NS.products().map((x) => x.brand).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
            <div class="field"><label>Категория</label><select class="input" name="category">${NS.CATEGORIES.map((c) => `<option value="${esc(c.id)}" ${p.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Ткань</label><input class="input" name="fabric" value="${esc(p.fabric)}" list="fabrics"><datalist id="fabrics">${NS.FABRICS.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></div>
            <div class="field"><label>Силуэт (иллюстрация, если нет фото)</label><select class="input" name="variant">${NS.SILHOUETTES.map((s, i) => `<option value="${i}" ${+p.variant === i ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="field full"><label>Описание</label><textarea class="input" name="description" rows="3">${esc(p.description)}</textarea></div>
          </div>

          <h3>Цена и скидка</h3>
          <div class="form-grid">
            <div class="field"><label>Закупочная цена за 1 шт., сум</label><input class="input" type="number" min="0" step="1000" name="cost" value="${+p.cost || 0}"><small class="muted">Видите только вы. Нужна для расчёта прибыли.</small></div>
            <div class="field"><label>Цена продажи, сум *</label><input class="input" type="number" min="0" step="1000" name="price" value="${p.price}"></div>
            <div class="field"><label>или цена в $ (пересчитается в сумы)</label><input class="input" type="number" min="0" step="1" name="priceUsd" value="${Math.round(p.price / NS.usdRate())}"></div>
            <div class="field"><label>Скидка, %</label><input class="input" type="number" min="0" max="90" name="discount" value="${+p.discount || 0}"></div>
          </div>
          <div class="calc" id="calc"></div>

          <h3>Цвета</h3>
          <div class="color-picks">${Object.keys(NS.COLORS).map((c) => `<label class="color-pick"><input type="checkbox" name="colors" value="${esc(c)}" ${p.colors.includes(c) ? 'checked' : ''}><i style="background:${NS.COLORS[c]}"></i>${esc(c)}</label>`).join('')}</div>

          <h3>Остатки по цвету и размеру</h3>
          <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Сколько штук каждого цвета и размера лежит на складе. Пустая клетка = 0. Новые поступления удобнее вносить кнопкой «Поступление».</p>
          <div id="vGrid"></div>
          ${isEdit ? `<div class="field" id="reasonBox" hidden style="margin-top:10px"><label>Причина изменения остатка *</label><input class="input" name="reason" placeholder="Например: пересчёт склада, найден брак, ошибка ввода"></div>` : ''}

          <h3>Отметки</h3>
          <div class="flags">
            <label><input type="checkbox" name="visible" ${p.visible ? 'checked' : ''}> Показывать на сайте</label>
            <label><input type="checkbox" name="isNew" ${p.isNew ? 'checked' : ''}> Новинка</label>
            <label><input type="checkbox" name="isHit" ${p.isHit ? 'checked' : ''}> Хит продаж</label>
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn--outline" data-close>Отмена</button>
            <button type="submit" class="btn btn--dark">${isEdit ? 'Сохранить изменения' : 'Создать товар'}</button>
          </div>
        </div>
        <aside class="preview"><h3>Предпросмотр на сайте</h3><div id="pPreview"></div></aside>
      </form>`);

    const form = $('#pForm');
    const sync = () => {
      const f = form.elements;
      p.name = f.title.value.trim();
      p.sku = f.sku.value.trim();
      p.brand = f.brand.value.trim();
      p.cost = Math.max(0, Math.round(+f.cost.value || 0));
      p.category = f.category.value;
      p.fabric = f.fabric.value.trim();
      p.variant = +f.variant.value;
      p.description = f.description.value.trim();
      p.price = Math.max(0, Math.round(+f.price.value || 0));
      p.discount = Math.min(90, Math.max(0, Math.round(+f.discount.value || 0)));
      p.colors = $$('input[name="colors"]:checked', form).map((i) => i.value);
      $$('[data-v]', form).forEach((inp) => { p.vstock[inp.dataset.v] = Math.max(0, Math.round(+inp.value || 0)); });
      $$('#vGrid tbody tr', form).forEach((tr) => {
        const cell = tr.querySelector('td:last-child b');
        if (cell) cell.textContent = $$('[data-v]', tr).reduce((a, i) => a + Math.max(0, Math.round(+i.value || 0)), 0);
      });
      NS.normalizeStock(p, NS.SIZES);
      const rb = $('#reasonBox');
      if (rb) rb.hidden = JSON.stringify(p.vstock) === origV;
      p.visible = f.visible.checked;
      p.isNew = f.isNew.checked;
      p.isHit = f.isHit.checked;
      const shown = p.colors.length ? p : Object.assign({}, p, { colors: [Object.keys(NS.COLORS)[0]] });
      $('#pPreview').innerHTML = previewCard(shown);
      const d = NS.discountOf(shown);
      const fp = NS.finalPrice(shown);
      const marginTxt = p.cost > 0 && fp > 0 ? ` Прибыль с 1 шт.: <b class="${fp - p.cost >= 0 ? 'money-in' : 'money-out'}">${money(fp - p.cost)}</b> (${Math.round(((fp - p.cost) / fp) * 100)}%).` : (p.cost ? '' : ' Укажите закупочную цену, чтобы видеть прибыль.');
      $('#calc').innerHTML = (d
        ? `Цена на сайте: <b>${money(fp)}</b> (≈ ${usd(fp)}) вместо ${money(p.price)} — −${d}%${NS.inFlash(shown) && d > p.discount ? ', действует общая акция' : ''}. Остаток: ${NS.totalStock(p)} шт.`
        : `Цена на сайте: <b>${money(p.price)}</b> (≈ ${usd(p.price)}). Остаток: ${NS.totalStock(p)} шт.`) + marginTxt;
    };
    // таблица остатков: строки — выбранные цвета, столбцы — размеры
    const renderGrid = () => {
      const colors = $$('input[name="colors"]:checked', form).map((i) => i.value);
      const rows = colors.length ? colors : [''];
      const hidden = Object.keys(p.vstock).filter((k) => +p.vstock[k] > 0 && !rows.includes(NS.splitKey(k)[0]));
      $('#vGrid').innerHTML = `<div class="table-wrap vgrid-wrap"><table class="vgrid">
        <thead><tr><th>Цвет</th>${NS.SIZES.map((sz) => `<th>${esc(sz)}</th>`).join('')}<th>Всего</th></tr></thead>
        <tbody>${rows.map((c) => `<tr><td class="vgrid__color">${c ? `<i style="background:${NS.colorHex(c)}"></i>${esc(c)}` : 'Без цвета'}</td>
          ${NS.SIZES.map((sz) => { const k = NS.vkey(c, sz); return `<td><input type="number" min="0" inputmode="numeric" data-v="${esc(k)}" value="${+p.vstock[k] || ''}" placeholder="0" aria-label="${esc(c + ' ' + sz)}"></td>`; }).join('')}
          <td class="num"><b>${NS.SIZES.reduce((a, sz) => a + (+p.vstock[NS.vkey(c, sz)] || 0), 0)}</b></td></tr>`).join('')}</tbody>
      </table></div>
      ${hidden.length ? `<p class="hint" style="color:var(--sale)">У снятых цветов остался товар: ${hidden.map((k) => esc(k.replace('|', ' ')) + ' — ' + p.vstock[k] + ' шт.').join(', ')}. Он не продаётся, пока цвет выключен.</p>` : ''}`;
    };
    renderGrid();
    form.addEventListener('change', (e) => { if (e.target.name === 'colors') { renderGrid(); sync(); } });

    const renderImgs = () => {
      $('#imgList').innerHTML = p.images.map((src, i) => `<div class="img-item">
          <img src="${esc(src)}" alt="">
          ${i === 0 ? '<span class="img-main">Главное</span>' : ''}
          <button type="button" class="img-del" data-img-del="${i}" aria-label="Удалить">×</button>
          <div class="img-move">
            <button type="button" data-img-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Левее">‹</button>
            <button type="button" data-img-move="${i}" data-dir="1" ${i === p.images.length - 1 ? 'disabled' : ''} aria-label="Правее">›</button>
          </div>
        </div>`).join('') + (uploading ? `<div class="img-item img-item--loading"><span>Загрузка… ${uploading}</span></div>` : '');
      sync();
    };
    renderImgs();

    form.addEventListener('input', (e) => {
      if (e.target.name === 'priceUsd') form.elements.price.value = roundPrice((+e.target.value || 0) * NS.usdRate());
      if (e.target.name === 'price') form.elements.priceUsd.value = Math.round((+e.target.value || 0) / NS.usdRate());
      sync();
    });
    form.addEventListener('change', sync);
    form.addEventListener('click', (e) => {
      const del = e.target.closest('[data-img-del]');
      if (del) { p.images.splice(+del.dataset.imgDel, 1); renderImgs(); return; }
      const mv = e.target.closest('[data-img-move]');
      if (mv) {
        const i = +mv.dataset.imgMove, j = i + +mv.dataset.dir;
        if (j >= 0 && j < p.images.length) { [p.images[i], p.images[j]] = [p.images[j], p.images[i]]; renderImgs(); }
        return;
      }
      if (e.target.closest('[data-img-add]')) {
        const url = $('#imgUrl').value.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return toast('Вставьте корректную ссылку на изображение (https://…)', 'error');
        p.images.push(url);
        $('#imgUrl').value = '';
        renderImgs();
      }
    });
    $('#imgFile').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      uploading += files.length;
      renderImgs();
      for (const file of files) {
        try {
          const data = await resizeImage(file, 2000);
          const r = await NS.api('/api/admin/upload', { data });
          if (draft === p) p.images.push(r.url);
        } catch (err) {
          if (err && err.status === 401) return onError(err);
          toast('Не удалось загрузить ' + esc(file.name) + (err && err.message ? ': ' + esc(err.message) : ''), 'error');
        }
        uploading--;
        if (draft === p) renderImgs();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sync();
      if (uploading) return toast('Дождитесь окончания загрузки фото', 'error');
      if (p.name.length < 2) return toast('Укажите название товара', 'error');
      if (!p.sku) return toast('Укажите артикул', 'error');
      if (NS.products().some((x) => x.sku === p.sku && x.id !== p.id)) return toast('Такой артикул уже есть', 'error');
      if (!(p.price > 0)) return toast('Укажите цену больше нуля', 'error');
      if (!p.colors.length) return toast('Выберите хотя бы один цвет', 'error');
      const idx = NS.products().findIndex((x) => x.id === p.id);
      if (idx >= 0 && JSON.stringify(p.vstock) !== origV) {
        const reason = (form.elements.reason && form.elements.reason.value.trim()) || '';
        if (reason.length < 3) { toast('Остаток изменён — укажите причину (её увидите в журнале склада)', 'error'); form.elements.reason && form.elements.reason.focus(); return; }
        NS.stockReasons = Object.assign(NS.stockReasons || {}, { [p.id]: reason });
      }
      if (p.cost > 0 && NS.finalPrice(p) < p.cost && !confirm('Цена продажи ниже закупочной — товар будет продаваться в убыток. Сохранить?')) return;
      if (idx >= 0) NS.db.products[idx] = p; else NS.db.products.unshift(p);
      const name = p.name;
      closeModal();
      save(`«${esc(name)}» ${idx >= 0 ? 'сохранён' : 'добавлен в каталог'}`);
    });
  }

  function resizeImage(file, max) {
    const toJpeg = (w, h, paint) => {
      const k = Math.min(1, max / Math.max(w, h, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      paint(ctx, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.86);
    };
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Не удалось прочитать изображение. Попробуйте другой файл или сохраните как JPG/PNG.'));
      const viaBitmap = async () => {
        if (typeof createImageBitmap !== 'function') return null;
        try {
          const bmp = await createImageBitmap(file);
          const data = toJpeg(bmp.width, bmp.height, (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h));
          if (bmp.close) bmp.close();
          return data;
        } catch (_) { return null; }
      };
      const viaUrl = () => new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const data = toJpeg(img.naturalWidth || img.width, img.naturalHeight || img.height, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
            URL.revokeObjectURL(url);
            res(data);
          } catch (e) { URL.revokeObjectURL(url); rej(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('format')); };
        img.src = url;
      });
      const viaReader = () => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onerror = rej;
        reader.onload = () => {
          const img = new Image();
          img.onerror = rej;
          img.onload = () => {
            try {
              res(toJpeg(img.width, img.height, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h)));
            } catch (e) { rej(e); }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      (async () => {
        try {
          if (!file || !file.size) return fail();
          if (file.size > 40 * 1024 * 1024) return reject(new Error('Файл больше 40 МБ'));
          let data = await viaBitmap();
          if (!data) {
            try { data = await viaUrl(); } catch (_) { data = await viaReader(); }
          }
          resolve(data);
        } catch (e) { fail(); }
      })();
    });
  }

  /* ---------- заказы ---------- */

  const payPill = (o) => NS.STOCK_FREE_STATUSES.includes(o.status)
    ? (o.refunded ? '<span class="pill pill--unpaid">деньги возвращены</span>' : '')
    : (o.paid ? '<span class="pill pill--paid">оплачен</span>' : '<span class="pill pill--unpaid">не оплачен</span>');
  const channelName = (o) => (o.channel === 'store' ? 'Магазин' : o.channel === 'phone' ? 'По телефону' : 'Сайт');
  function ordersTableHTML(list, compact) {
    if (!list.length) return '<p class="muted" style="padding:12px">Заказов пока нет. Они появятся здесь, как только покупатель оформит заказ на сайте или вы создадите его вручную.</p>';
    return `<div class="table-wrap" style="border:0"><table class="atable">
      <thead><tr><th>№</th><th>Дата</th><th>Клиент</th>${compact ? '' : '<th>Откуда</th><th>Доставка</th><th>Оплата</th>'}<th>Сумма</th><th>Статус</th><th></th></tr></thead>
      <tbody>${list.map((o) => `<tr>
        <td><b>${esc(o.id)}</b></td>
        <td>${fmtDate(o.date, true)}</td>
        <td class="name">${esc(o.customer.name)}<div class="sub">${esc(o.customer.phone)}</div></td>
        ${compact ? '' : `<td>${channelName(o)}</td><td>${esc(o.delivery)}${o.customer.city ? '<div class="sub">' + esc(o.customer.city) + '</div>' : ''}</td><td>${esc(o.payment)}<div>${payPill(o)}</div></td>`}
        <td class="num"><b>${money(o.total)}</b><div class="sub">${o.items.reduce((a, i) => a + i.qty, 0)} шт.${o.promo ? ' · ' + esc(o.promo) : ''}</div>${compact ? `<div>${payPill(o)}</div>` : ''}</td>
        <td>${compact ? `<span class="pill pill--${esc(o.status)}">${esc(o.status)}</span>` : `<select class="select" data-status="${esc(o.id)}" aria-label="Статус заказа">${NS.ORDER_STATUSES.map((s) => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td>
        <td><div class="row-actions"><button data-order="${esc(o.id)}" title="Подробнее">${ICONS.eye}</button></div></td>
      </tr>`).join('')}</tbody></table></div>`;
  }


  function viewOrders() {
    const st = ui.orders;
    const all = NS.db.orders;
    $('#topbarActions').innerHTML = `<button class="btn btn--outline" data-export-orders>${t('admin.exportOrders')}</button>
      <button class="btn btn--dark" data-store-sale>+ Заказ вручную</button>`;
    const counts = {};
    all.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    const unpaid = all.filter((o) => !o.paid && !NS.STOCK_FREE_STATUSES.includes(o.status));
    view.innerHTML = `
      <div class="chips" style="margin:0 0 10px">
        <button class="chip ${!st.status ? 'is-on' : ''}" data-ostatus="">Все · ${all.length}</button>
        ${NS.ORDER_STATUSES.map((s) => `<button class="chip ${st.status === s ? 'is-on' : ''}" data-ostatus="${s}">${s} · ${counts[s] || 0}</button>`).join('')}
      </div>
      <div class="chips" style="margin:0 0 16px">
        <button class="chip ${!st.pay ? 'is-on' : ''}" data-opay="">Любая оплата</button>
        <button class="chip ${st.pay === 'unpaid' ? 'is-on' : ''}" data-opay="unpaid">Не оплачены · ${unpaid.length}</button>
        <button class="chip ${st.pay === 'paid' ? 'is-on' : ''}" data-opay="paid">Оплачены</button>
      </div>
      <div class="toolbar-a"><input class="input" type="search" placeholder="Поиск: номер, имя, телефон" value="${esc(st.q)}" data-oq></div>
      <div class="panel" style="padding:8px 8px 4px" id="oTable"></div>
      <p class="prod-help">Как работать: новый заказ → позвоните клиенту → «Подтверждён» → «Отправлен» → «Доставлен». Деньги получили — нажмите «Отметить оплату» в карточке заказа. Отмена или возврат сами вернут товар на склад.</p>`;
    renderOrdersTable();
  }

  function renderOrdersTable() {
    const st = ui.orders;
    if (!$('#oTable')) return;
    const q = st.q.trim().toLowerCase();
    const list = NS.db.orders.filter((o) => (!st.status || o.status === st.status) &&
      (!st.pay || (st.pay === 'paid' ? o.paid && !o.refunded : !o.paid && !NS.STOCK_FREE_STATUSES.includes(o.status))) &&
      (!q || [o.id, o.customer.name, o.customer.phone, o.customer.city].join(' ').toLowerCase().includes(q)));
    $('#oTable').innerHTML = ordersTableHTML(list, false);
  }


  function setOrderStatus(id, status) {
    const o = NS.db.orders.find((x) => x.id === id);
    if (!o || o.status === status) return Promise.resolve(true);
    const wasFree = NS.STOCK_FREE_STATUSES.includes(o.status), nowFree = NS.STOCK_FREE_STATUSES.includes(status);
    if (nowFree && !wasFree) {
      const msg = (status === 'Возврат' ? 'Оформить возврат' : 'Отменить заказ') + ` ${o.id}?\n\nТовар вернётся на склад.`
        + (o.paid ? `\nОплата ${money(o.total)} будет учтена как возвращённая покупателю.` : '');
      if (!confirm(msg)) return Promise.resolve(false);
    }
    if (wasFree && !nowFree && !confirm(`Вернуть заказ ${o.id} в работу? Товар снова будет списан со склада.`)) return Promise.resolve(false);
    return call('/api/admin/order', { id, status },
      `Заказ ${esc(id)}: «${esc(status)}»${wasFree !== nowFree ? (nowFree ? ' — товар возвращён на склад' : ' — товар снова списан') : ''}`)
      .then(() => true)
      .catch(() => false);
  }


  function openOrder(id) {
    const o = NS.db.orders.find((x) => x.id === id);
    if (!o) return toast('Заказ не найден — возможно, он удалён', 'error');
    const cost = o.items.reduce((a, it) => a + (+it.cost || 0) * it.qty, 0);
    const noCost = o.items.some((it) => !(+it.cost > 0));
    const free = NS.STOCK_FREE_STATUSES.includes(o.status);
    openModal(`<div class="order-head">
        <div><h2 style="margin:0">Заказ ${esc(o.id)}</h2><div class="muted">${fmtDate(o.date, true)} · ${channelName(o)}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><span class="pill pill--${esc(o.status)}">${esc(o.status)}</span>${payPill(o)}</div>
      </div>
      <div class="order-grid">
        <div><b>Клиент</b>${esc(o.customer.name)}<br><a href="tel:${esc(o.customer.phone.replace(/[^\d+]/g, ''))}">${esc(o.customer.phone)}</a>${o.customer.email ? '<br>' + esc(o.customer.email) : ''}</div>
        <div><b>Доставка и оплата</b>${esc(o.delivery)}${o.customer.city ? ', ' + esc(o.customer.city) : ''}<br>${esc(o.customer.address)}<br>Оплата: ${esc(o.payment)}${o.paid && o.paidAt ? '<br>Оплачено ' + fmtDate(o.paidAt, true) : ''}${o.refunded ? '<br>Деньги возвращены ' + fmtDate(o.refundedAt, true) : ''}</div>
        ${o.customer.comment ? `<div style="grid-column:1/-1"><b>Комментарий</b>${esc(o.customer.comment)}</div>` : ''}
      </div>
      <table class="atable"><thead><tr><th>Товар</th><th>Цвет</th><th>Размер</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>
        ${o.items.map((it) => `<tr><td class="name">${esc(it.name)}${it.sku ? `<div class="sub">${esc(it.sku)}</div>` : ''}</td><td>${esc(it.color || '—')}</td><td>${esc(it.size)}</td><td>${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.price * it.qty)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totals" style="max-width:380px;margin:18px 0 0 auto">
        <div><span>Товары</span><span>${money(o.subtotal)}</span></div>
        ${o.autoDiscount ? `<div class="is-discount"><span>Скидка от суммы</span><span>−${money(o.autoDiscount)}</span></div>` : ''}
        ${o.promoDiscount ? `<div class="is-discount"><span>${o.promo ? 'Промокод ' + esc(o.promo) : 'Скидка'}</span><span>−${money(o.promoDiscount)}</span></div>` : ''}
        <div><span>Доставка</span><span>${o.shipping ? money(o.shipping) : 'Бесплатно'}</span></div>
        <div class="total"><span>Итого</span><span>${money(o.total)}</span></div>
        <div><span class="muted">Себестоимость товаров</span><span class="muted">${noCost ? 'не у всех товаров указана закупка' : money(cost)}</span></div>
        ${!noCost ? `<div><span class="muted">Валовая прибыль</span><span class="${o.total - cost >= 0 ? 'money-in' : 'money-out'}">${money(o.total - cost)}</span></div>` : ''}
      </div>
      ${(o.history || []).length ? `<details style="margin-top:14px"><summary class="muted">История заказа</summary><ul class="muted" style="font-size:13px">${o.history.slice().reverse().map((h) => `<li>${fmtDate(h.at, true)} — ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
      <div class="form-actions" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${free ? '' : (o.paid
            ? `<button class="btn btn--outline" data-order-paid="${esc(o.id)}" data-v="0">Снять оплату</button>`
            : `<button class="btn btn--gold" data-order-paid="${esc(o.id)}" data-v="1">Отметить оплату · ${money(o.total)}</button>`)}
          <button class="btn btn--outline" data-order-del="${esc(o.id)}" style="color:var(--sale)">Удалить</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${NS.ORDER_STATUSES.filter((s) => s !== o.status).map((s) => `<button class="btn ${NS.STOCK_FREE_STATUSES.includes(s) ? 'btn--outline' : 'btn--dark'}" data-order-status="${esc(o.id)}" data-v="${s}">${s === 'Возврат' ? 'Оформить возврат' : s}</button>`).join('')}
        </div>
      </div>`);
  }

  // защита от CSV-инъекций: значение, начинающееся с = + - @, Excel выполнил бы как формулу
  function csvSafe(c) {
    const v = String(c == null ? '' : c);
    return typeof c !== 'number' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }

  function exportOrdersCSV() {
    const rows = [['Номер', 'Дата', 'Статус', 'Оплачен', 'Клиент', 'Телефон', 'E-mail', 'Город', 'Адрес', 'Доставка', 'Оплата', 'Товары', 'Сумма товаров', 'Скидка от суммы', 'Промокод', 'Скидка по промокоду', 'Доставка, сум', 'Итого, сум']];
    NS.db.orders.forEach((o) => rows.push([
      o.id, fmtDate(o.date, true), o.status, o.refunded ? 'возвращён' : o.paid ? 'да' : 'нет', o.customer.name, o.customer.phone, o.customer.email, o.customer.city, o.customer.address,
      o.delivery, o.payment, o.items.map((i) => `${i.name} (${i.color}, ${i.size}) x${i.qty}`).join('; '),
      o.subtotal, o.autoDiscount || 0, o.promo, o.promoDiscount, o.shipping, o.total,
    ]));
    const csv = rows.map((r) => r.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download('nargizka-orders.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  }

  /* ---------- скидки и акции ---------- */
  function viewMarketing() {
    const s = NS.settings;
    const f = s.flash;
    const expired = f.active && f.endsAt <= Date.now();
    const catOptions = `<option value="">Весь каталог</option>${NS.CATEGORIES.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}`;

    view.innerHTML = `<div class="mk-grid">
      <div>
        <div class="panel">
          <div class="panel__head"><h2>Акция с таймером</h2></div>
          <p class="hint">Общая скидка на выбранные категории с обратным отсчётом на главной и в карточках. Если у товара своя скидка больше — действует большая.</p>
          <div class="status-line"><span class="dot ${NS.flashActive() ? 'dot--on' : ''}"></span>${NS.flashActive() ? 'Акция идёт сейчас' : expired ? 'Время акции истекло — продлите дату окончания' : 'Акция выключена'}</div>
          <form id="flashForm">
            <label class="toggle-row" style="margin-bottom:14px">Включить акцию<span class="switch"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}><span></span></span></label>
            <div class="form-grid">
              <div class="field"><label>Название акции</label><input class="input" name="title" value="${esc(f.title)}"></div>
              <div class="field"><label>Скидка, %</label><input class="input" type="number" min="1" max="90" name="percent" value="${f.percent}"></div>
              <div class="field full"><label>Окончание акции</label><input class="input" type="datetime-local" name="endsAt" value="${toLocalInput(f.endsAt)}"></div>
            </div>
            <div class="chips" style="margin:10px 0 16px">
              <button type="button" class="chip" data-extend="1">+1 день</button>
              <button type="button" class="chip" data-extend="3">+3 дня</button>
              <button type="button" class="chip" data-extend="7">+7 дней</button>
            </div>
            <div class="field"><label>Категории (ничего не выбрано — весь каталог)</label>
              <div class="color-picks">${NS.CATEGORIES.map((c) => `<label class="color-pick" style="padding-left:12px"><input type="checkbox" name="cats" value="${esc(c.id)}" ${f.categories.includes(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>
            </div>
            <div class="flash-preview" id="flashPreview"></div>
            <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить акцию</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Скидка от суммы заказа</h2></div>
          <p class="hint">Автоматическая скидка на весь заказ, когда сумма в корзине достигает порога. В корзине покупатель видит подсказку «добавьте ещё на … — получите скидку».</p>
          <form id="tiersForm">
            <div id="tierRows">${(s.autoDiscounts || []).map(tierRow).join('')}</div>
            <div class="form-actions" style="justify-content:space-between">
              <button type="button" class="btn btn--outline" data-tier-add>+ Добавить порог</button>
              <button class="btn btn--dark" type="submit">Сохранить</button>
            </div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Массовая скидка</h2></div>
          <p class="hint">Постоянная скидка на все товары категории. Её можно снять в один клик.</p>
          <form class="inline" id="massForm">
            <div class="field"><label>Категория</label><select class="input" name="cat">${catOptions}</select></div>
            <div class="field" style="max-width:120px"><label>Скидка, %</label><input class="input" type="number" min="1" max="90" name="pct" value="20"></div>
            <button class="btn btn--gold" type="submit">Применить</button>
            <button class="btn btn--outline" type="button" data-mass-clear>Снять</button>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Изменение цен</h2></div>
          <p class="hint">Поднять или снизить базовые цены сразу у всей категории. Цены округляются до 1 000 сум.</p>
          <form class="inline" id="priceForm">
            <div class="field"><label>Категория</label><select class="input" name="cat">${catOptions}</select></div>
            <div class="field" style="max-width:140px"><label>Изменение, %</label><input class="input" type="number" min="-90" max="500" name="pct" value="10"></div>
            <button class="btn btn--dark" type="submit">Изменить цены</button>
          </form>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel__head"><h2>Главный баннер</h2></div>
          <form id="heroForm" class="form-grid">
            <div class="field full"><label>Надпись над заголовком</label><input class="input" name="kicker" value="${esc(s.hero.kicker)}"></div>
            <div class="field full"><label>Заголовок (Enter — перенос строки)</label><textarea class="input" name="title" rows="2">${esc(s.hero.title)}</textarea></div>
            <div class="field full"><label>Подзаголовок</label><textarea class="input" name="subtitle" rows="2">${esc(s.hero.subtitle)}</textarea></div>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Бегущая строка</h2></div>
          <p class="hint">Сообщения над шапкой сайта, по одному на строку. Сменяют друг друга каждые 4 секунды.</p>
          <form id="annForm">
            <textarea class="input" name="lines" rows="5">${esc(s.announcements.join('\n'))}</textarea>
            <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Подсказки</h2></div>
          <ul class="hint" style="padding-left:18px;line-height:1.7">
            <li>Скидки складываются так: сначала скидка товара или акции, затем скидка от суммы заказа, затем промокод.</li>
            <li>Промокоды с датой окончания и лимитом — в разделе <button class="link-btn" data-go="promos">«Промокоды»</button>.</li>
            <li>Стоимость доставки, способы оплаты и срок возврата — в <button class="link-btn" data-go="settings">«Настройках»</button>.</li>
          </ul>
        </div>
      </div>
    </div>`;
    renderFlashPreview();
  }

  function tierRow(t) {
    return `<div class="tier-row">
      <div class="field"><label>Сумма заказа от, сум</label><input class="input" type="number" min="0" step="1000" name="tierFrom" value="${t ? t.from : ''}"></div>
      <div class="field" style="max-width:120px"><label>Скидка, %</label><input class="input" type="number" min="1" max="50" name="tierPct" value="${t ? t.percent : ''}"></div>
      <button type="button" class="icon-btn" data-tier-del aria-label="Удалить">${ICONS.trash}</button>
    </div>`;
  }

  function readFlashForm() {
    const f = $('#flashForm').elements;
    return {
      active: f.active.checked,
      title: f.title.value.trim() || 'Sale',
      percent: Math.min(90, Math.max(1, Math.round(+f.percent.value || 0))),
      endsAt: new Date(f.endsAt.value).getTime() || Date.now(),
      categories: $$('#flashForm input[name="cats"]:checked').map((i) => i.value),
    };
  }
  function renderFlashPreview() {
    if (!$('#flashForm')) return;
    const f = readFlashForm();
    $('#flashPreview').innerHTML = `<div><div class="flash__title">${esc(f.title)}: <b>−${f.percent}%</b></div>
      <div class="flash__sub">${f.categories.length ? f.categories.map((c) => esc(NS.catName(c))).join(', ') : 'Весь ассортимент'}</div></div>${timerHTML(f.endsAt)}`;
    $('#flashPreview').style.opacity = f.active ? 1 : 0.45;
    tickTimers();
  }

  /* ---------- промокоды ---------- */
  function viewPromos() {
    const s = NS.settings;
    view.innerHTML = `
      <div class="panel">
        <div class="panel__head"><h2>Все промокоды</h2><span class="muted">${s.promoCodes.length}</span></div>
        <div class="table-wrap" style="border:0"><table class="atable">
          <thead><tr><th>Код</th><th>Скидка</th><th>Заказ от</th><th>Действует до</th><th>Использован</th><th>Статус</th><th>Вкл.</th><th></th></tr></thead>
          <tbody>${s.promoCodes.map((c, i) => {
            const [label, cls] = promoStatus(c);
            return `<tr>
              <td><b>${esc(c.code)}</b>${s.welcomeCode === c.code ? '<div class="sub">приветственный</div>' : ''}</td>
              <td>${c.type === 'fixed' ? '−' + money(c.value) : '−' + c.value + '%'}</td>
              <td class="num">${c.minSum ? money(c.minSum) : '—'}</td>
              <td>${c.expiresAt ? fmtDate(c.expiresAt) : 'бессрочно'}</td>
              <td>${c.used || 0}${c.limit ? ' из ' + c.limit : ''}</td>
              <td class="${cls}">${label}</td>
              <td><label class="switch"><input type="checkbox" data-promo-toggle="${i}" ${c.active ? 'checked' : ''}><span></span></label></td>
              <td><div class="row-actions">
                <button data-promo-edit="${i}" title="Изменить">${ICONS.edit}</button>
                <button data-promo-del="${i}" title="Удалить">${ICONS.trash}</button>
              </div></td>
            </tr>`;
          }).join('') || '<tr><td colspan="8" class="empty-row">Промокодов нет</td></tr>'}</tbody>
        </table></div>
      </div>

      <div class="mk-grid">
        <div class="panel">
          <div class="panel__head"><h2 id="promoFormTitle">Новый промокод</h2></div>
          <form id="promoForm" class="form-grid">
            <input type="hidden" name="idx" value="">
            <div class="field"><label>Код</label><input class="input" name="code" placeholder="SPRING15" style="text-transform:uppercase"></div>
            <div class="field"><label>Тип скидки</label><select class="input" name="type"><option value="percent">Процент от суммы</option><option value="fixed">Фиксированная сумма, сум</option></select></div>
            <div class="field"><label>Размер скидки</label><input class="input" type="number" min="1" name="value" value="15"></div>
            <div class="field"><label>Минимальная сумма заказа, сум</label><input class="input" type="number" min="0" step="1000" name="min" value="0"></div>
            <div class="field"><label>Действует до (пусто — бессрочно)</label><input class="input" type="date" name="expires"></div>
            <div class="field"><label>Лимит использований (0 — без лимита)</label><input class="input" type="number" min="0" name="limit" value="0"></div>
            <div class="full form-actions" style="margin-top:0">
              <button type="button" class="btn btn--outline" data-promo-reset>Очистить</button>
              <button class="btn btn--dark" type="submit">Сохранить промокод</button>
            </div>
          </form>
        </div>

        <div>
          <div class="panel">
            <div class="panel__head"><h2>Приветственный промокод</h2></div>
            <p class="hint">Показывается новым посетителям во всплывающем окне, в блоке «Клуб Nargizka» и выдаётся после подписки на рассылку.</p>
            <form id="welcomeForm" class="inline">
              <div class="field"><label>Промокод</label><select class="input" name="code">
                <option value="">— не показывать —</option>
                ${s.promoCodes.map((c) => `<option ${s.welcomeCode === c.code ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}
              </select></div>
              <button class="btn btn--dark" type="submit">Сохранить</button>
            </form>
          </div>
          <div class="panel">
            <div class="panel__head"><h2>Подписчики рассылки</h2><span class="muted">${NS.db.subscribers.length}</span></div>
            ${NS.db.subscribers.length ? `<p style="font-size:13px;word-break:break-all">${NS.db.subscribers.slice(-10).map(esc).join(', ')}</p>
              <div class="form-actions"><button class="btn btn--outline" data-export-subs>Скачать список</button></div>` : '<p class="muted">Пока никто не подписался.</p>'}
          </div>
        </div>
      </div>`;
  }

  function fillPromoForm(i) {
    const c = NS.settings.promoCodes[i];
    const f = $('#promoForm').elements;
    if (!c) return;
    f.idx.value = i;
    f.code.value = c.code;
    f.type.value = c.type;
    f.value.value = c.value;
    f.min.value = c.minSum || 0;
    f.expires.value = toDateInput(c.expiresAt);
    f.limit.value = c.limit || 0;
    $('#promoFormTitle').textContent = 'Изменить ' + c.code;
    $('#promoForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }


  /* ---------- финансы: приход / расход / остаток ---------- */
  const FIN_OUT_CATS = ['Закупка товара', 'Аренда', 'Зарплата', 'Реклама', 'Логистика', 'Упаковка', 'Налоги', 'Коммунальные', 'Прочее'];
  const FIN_IN_CATS = ['Прочий приход', 'Возврат от поставщика', 'Вложение', 'Прочее'];

  function ymdLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function financeRange() {
    const st = ui.finance;
    const now = new Date();
    let from = st.from ? new Date(st.from + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
    let to = st.to ? new Date(st.to + 'T23:59:59.999') : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    if (!st.from) st.from = ymdLocal(from);
    if (!st.to) st.to = ymdLocal(to);
    return { from: from.getTime(), to: to.getTime() };
  }

  function financeEnsure() {
    if (!NS.db.finance) NS.db.finance = { openingBalance: 0, entries: [] };
    if (!Array.isArray(NS.db.finance.entries)) NS.db.finance.entries = [];
    return NS.db.finance;
  }

  function financePaidStatuses() {
    return ['Подтверждён', 'Отправлен', 'Доставлен'];
  }

  function financeTotals(rows) {
    const income = rows.filter((r) => r.type === 'in').reduce((a, r) => a + r.amount, 0);
    const expense = rows.filter((r) => r.type === 'out').reduce((a, r) => a + r.amount, 0);
    return { income, expense, net: income - expense };
  }

  /** Остаток на начало периода: opening + все операции до from */

  /** Деньги в кассе на начало периода: стартовые деньги + все движения до from */
  function financeOpeningAt(fromTs) {
    return NS.cashAt(NS.db, fromTs - 1);
  }



  /* Движение денег: оплаты заказов (по дате оплаты), возвраты покупателям, ручные приходы и расходы */
  function rowsInRange(from, to) {
    const fin = financeEnsure();
    const rows = [];
    const inR = (t) => t >= from && t <= to;
    NS.db.orders.forEach((o) => {
      const who = ((o.customer && o.customer.name) || '');
      if (o.paid && inR(o.paidAt || o.date)) {
        rows.push({
          key: 'o-' + o.id, date: o.paidAt || o.date, type: 'in', category: o.channel === 'store' ? 'Продажа в магазине' : 'Оплата заказа',
          amount: +o.total || 0, note: o.id + ' · ' + who + ' · ' + o.payment, source: 'order', orderId: o.id, status: o.status, channel: o.channel || 'online',
        });
      }
      if (o.paid && o.refunded && inR(o.refundedAt)) {
        rows.push({
          key: 'r-' + o.id, date: o.refundedAt, type: 'out', category: 'Возврат денег покупателю',
          amount: +o.total || 0, note: o.id + ' · ' + who + ' · ' + o.status, source: 'refund', orderId: o.id,
        });
      }
    });
    fin.entries.forEach((e) => {
      if (!inR(e.date)) return;
      rows.push({
        key: e.id, date: e.date, type: e.type === 'in' ? 'in' : 'out',
        category: e.category, amount: +e.amount || 0, note: e.note || '',
        source: 'manual', id: e.id,
      });
    });
    rows.sort((x, y) => y.date - x.date);
    return rows;
  }

  function applyFinanceFilters(rows) {
    const st = ui.finance;
    let list = rows;
    if (st.kind === 'in') list = list.filter((r) => r.type === 'in');
    else if (st.kind === 'out') list = list.filter((r) => r.type === 'out');
    const q = (st.q || '').trim().toLowerCase();
    if (q) list = list.filter((r) => [r.category, r.note, r.orderId || ''].join(' ').toLowerCase().includes(q));
    return list;
  }

  function buildFinanceRows() {
    const { from, to } = financeRange();
    return applyFinanceFilters(rowsInRange(from, to));
  }


  function pendingOrders() {
    return NS.db.orders.filter((o) => !o.paid && !NS.STOCK_FREE_STATUSES.includes(o.status));
  }

  function setFinancePreset(key) {
    const now = new Date();
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let from, to;
    if (key === 'today') { from = startOf(now); to = new Date(from); to.setHours(23, 59, 59, 999); }
    else if (key === 'week') { from = startOf(now); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to = new Date(from); to.setDate(to.getDate() + 6); to.setHours(23, 59, 59, 999); }
    else if (key === '7') { to = new Date(now); to.setHours(23, 59, 59, 999); from = startOf(now); from.setDate(from.getDate() - 6); }
    else if (key === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); }
    else if (key === 'quarter') {
      const q = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), q, 1);
      to = new Date(now.getFullYear(), q + 3, 0, 23, 59, 59, 999);
    } else if (key === 'year') {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else {
      const dates = NS.db.orders.map((o) => o.date).concat((financeEnsure().entries || []).map((e) => e.date));
      from = dates.length ? new Date(Math.min.apply(null, dates)) : startOf(now);
      from.setHours(0, 0, 0, 0);
      to = new Date(now); to.setHours(23, 59, 59, 999);
    }
    ui.finance.from = ymdLocal(from);
    ui.finance.to = ymdLocal(to);
    ui.finance.preset = key;
    viewFinance();
  }

  function pctDelta(cur, prev) {
    if (!prev) return cur ? '+100%' : '0%';
    const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
    return (p > 0 ? '+' : '') + p + '%';
  }

  function cashOnHand() {
    financeEnsure();
    const r = financeRange();
    return financeOpeningAt(r.from) + financeTotals(rowsInRange(r.from, r.to)).net;
  }

  function viewFinance() {
    financeEnsure();
    if (!ui.finance.tab) ui.finance.tab = 'overview';
    if (!ui.finance.from || !ui.finance.to) {
      setFinancePreset(ui.finance.preset || 'month');
      return;
    }
    const st = ui.finance;
    const range = financeRange();
    const raw = rowsInRange(range.from, range.to);
    const rows = applyFinanceFilters(raw);
    const tsum = financeTotals(raw);
    const opening = financeOpeningAt(range.from);
    const closing = opening + tsum.net;
    const span = Math.max(1, range.to - range.from);
    const prevRaw = rowsInRange(range.from - span, range.from - 1);
    const prev = financeTotals(prevRaw);
    const rep = NS.financeReport(NS.db, range.from, range.to);
    const prevRep = NS.financeReport(NS.db, range.from - span, range.from - 1);
    const salesRows = raw.filter((r) => r.source === 'order');
    const sales = rep.revenue;
    const otherIn = rep.otherIncome;
    const byCatOut = {};
    raw.filter((r) => r.type === 'out').forEach((r) => { byCatOut[r.category] = (byCatOut[r.category] || 0) + r.amount; });
    const catList = Object.entries(byCatOut).sort((x, y) => y[1] - x[1]);
    const maxCat = Math.max(1, ...catList.map((x) => x[1]));
    const pending = pendingOrders();
    const pendingSum = pending.reduce((acc, o) => acc + (+o.total || 0), 0);
    const daysCount = Math.max(1, Math.round(span / 86400000));
    const avgDay = Math.round(rep.netRevenue / daysCount);
    const daily = Object.values(rep.byDay).map((x) => ({ t: x.t, sum: x.revenue - x.refunds, n: x.orders, items: x.items, gross: x.revenue - x.refunds - x.cogs, refunds: x.refunds })).sort((x, y) => y.t - x.t);
    const payList = Object.entries(rep.byPayment).sort((x, y) => y[1] - x[1]);
    const statusList = Object.entries(rep.byChannel).sort((x, y) => y[1] - x[1]);

    const buckets = [];
    const cursor = new Date(range.from); cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(range.to); endDay.setHours(0, 0, 0, 0);
    while (cursor <= endDay && buckets.length < 93) {
      buckets.push({ t: cursor.getTime(), inn: 0, out: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    raw.forEach((r) => {
      const d = new Date(r.date); d.setHours(0, 0, 0, 0);
      const b = buckets.find((k) => k.t === d.getTime());
      if (!b) return;
      if (r.type === 'in') b.inn += r.amount; else b.out += r.amount;
    });
    const maxBar = Math.max(1, ...buckets.map((b) => Math.max(b.inn, b.out)));
    const W = 720, H = 170, bw = buckets.length ? W / buckets.length : W;

    let run = closing;
    const journal = rows.map((r) => {
      const row = Object.assign({ balance: run }, r);
      run += r.type === 'in' ? -r.amount : r.amount;
      return row;
    });

    const periodLabel = fmtDate(range.from) + ' — ' + fmtDate(range.to);
    const presets = [
      ['today', 'Сегодня'],
      ['week', 'Эта неделя'],
      ['7', '7 дней'],
      ['month', 'Этот месяц'],
      ['quarter', 'Квартал'],
      ['year', 'Год'],
      ['all', 'Всё время'],
    ];
    const tabs = [
      ['overview', 'Касса'],
      ['profit', 'Прибыль'],
      ['sales', 'Продажи по дням'],
      ['expenses', 'Расходы'],
      ['journal', 'Журнал'],
    ];

    $('#topbarActions').innerHTML = `
      <button class="btn btn--outline" data-fin-export>Excel / CSV</button>
      <button class="btn btn--outline" data-fin-add="in">+ Деньги пришли</button>
      <button class="btn btn--dark" data-fin-add="out">+ Деньги ушли</button>`;

    view.innerHTML = `
      <div class="fin-hero">
        <div>
          <h2 class="fin-hero__title">Финансовый учёт</h2>
          <p class="fin-hero__text">Сколько пришло от продаж, сколько потратили и сколько осталось в кассе. Сейчас: <b>${esc(periodLabel)}</b></p>
        </div>
        <button type="button" class="btn btn--outline" data-fin-opening>Стартовые деньги: ${money(financeEnsure().openingBalance || 0)}</button>
      </div>

      <div class="fin-card">
        <div class="fin-card__label">Период</div>
        <div class="fin-presets">
          ${presets.map(([k, label]) => `<button type="button" class="fin-preset ${st.preset === k ? 'is-on' : ''}" data-fin-preset="${k}">${label}</button>`).join('')}
        </div>
        <div class="fin-filters">
          <label class="fin-field"><span>С даты</span><input class="input" type="date" data-fin="from" value="${esc(st.from)}"></label>
          <label class="fin-field"><span>По дату</span><input class="input" type="date" data-fin="to" value="${esc(st.to)}"></label>
          <div class="fin-field">
            <span>Что показать</span>
            <div class="fin-seg" role="group">
              <button type="button" class="fin-seg__btn ${st.kind === 'all' ? 'is-on' : ''}" data-fin-kind="all">Всё</button>
              <button type="button" class="fin-seg__btn ${st.kind === 'in' ? 'is-on' : ''}" data-fin-kind="in">Приход</button>
              <button type="button" class="fin-seg__btn ${st.kind === 'out' ? 'is-on' : ''}" data-fin-kind="out">Расход</button>
            </div>
          </div>
          <label class="fin-field fin-field--grow"><span>Поиск</span>
            <input class="input" type="search" id="finSearch" placeholder="Номер заказа, статья, клиент…" value="${esc(st.q)}" data-fin="q">
          </label>
        </div>
        <p class="hint" style="margin:10px 0 0">Продажа попадает в выручку в день оплаты. Неоплаченные заказы показаны отдельно и в выручку не входят.</p>
      </div>

      <div class="fin-flow">
        <div><span>Было в кассе</span><b>${money(opening)}</b><small>на начало периода</small></div>
        <i aria-hidden="true">+</i>
        <div class="is-in"><span>Пришло денег</span><b>+${money(tsum.income)}</b><small>${pctDelta(tsum.income, prev.income)} к прошлому периоду</small></div>
        <i aria-hidden="true">−</i>
        <div class="is-out"><span>Ушло денег</span><b>−${money(tsum.expense)}</b><small>${pctDelta(tsum.expense, prev.expense)} к прошлому периоду</small></div>
        <i aria-hidden="true">=</i>
        <div class="is-end"><span>Сейчас в кассе</span><b>${money(closing)}</b><small>${tsum.net >= 0 ? 'плюс' : 'минус'} ${money(Math.abs(tsum.net))} за период</small></div>
      </div>

      <div class="fin-summary">
        <div class="kpi"><span>Выручка</span><b>${money(rep.netRevenue)}</b><small>${rep.paidOrders} ${plural(rep.paidOrders, 'оплаченный заказ', 'оплаченных заказа', 'оплаченных заказов')}${rep.refunds ? ' · возвраты −' + money(rep.refunds) : ''} · ${pctDelta(rep.netRevenue, prevRep.netRevenue)}</small></div>
        <div class="kpi"><span>Валовая прибыль</span><b class="${rep.gross >= 0 ? 'money-in' : 'money-out'}">${money(rep.gross)}</b><small>выручка − себестоимость · маржа ${rep.margin}%</small></div>
        <div class="kpi kpi--gold"><span>Чистая прибыль</span><b>${rep.net >= 0 ? '' : '−'}${money(Math.abs(rep.net))}</b><small>после расходов ${money(rep.operating)}</small></div>
        <div class="kpi"><span>Не оплачено</span><b>${money(pendingSum)}</b><small>${pending.length ? pending.length + ' заказов ждут оплаты' : 'все заказы оплачены'}</small></div>
      </div>
      ${rep.missingCost ? `<div class="note-warn">У ${rep.missingCost} проданных шт. не была указана закупочная цена — прибыль по ним завышена. Укажите закупку в карточке товара: новые продажи посчитаются верно.</div>` : ''}

      <div class="fin-tabs">
        ${tabs.map(([k, label]) => `<button type="button" class="fin-tab ${st.tab === k ? 'is-on' : ''}" data-fin-tab="${k}">${label}</button>`).join('')}
      </div>
      <div id="finTabBody">${financeTabHTML(st.tab, {
        buckets, maxBar, W, H, bw, journal, catList, maxCat, tsum, opening, closing, sales, otherIn,
        daily, payList, statusList, pending, pendingSum, salesRows, rep,
      })}</div>
      <p class="fin-help">1) Выберите период. 2) «Касса» — сколько денег пришло и ушло. 3) «Прибыль» — сколько вы заработали: выручка минус себестоимость и расходы. 4) «+ Деньги ушли» — аренда, зарплата, реклама; оплата поставщику записывается автоматически при поступлении товара. Это управленческий учёт магазина — он не заменяет бухгалтерскую и налоговую отчётность.</p>`;

    const search = $('#finSearch');
    if (search && st._keepFocus) {
      search.focus();
      try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
      st._keepFocus = false;
    }
  }

  function financeTabHTML(tab, d) {
    if (tab === 'profit') {
      const r = d.rep;
      const row = (label, v, cls, hint) => `<tr class="${cls || ''}"><td>${label}${hint ? `<div class="sub">${hint}</div>` : ''}</td><td class="num">${v < 0 ? '−' : ''}${money(Math.abs(v))}</td></tr>`;
      return `<div class="panels"><div class="panel">
          <div class="panel__head"><h2>Отчёт о прибыли</h2><span class="muted">за выбранный период</span></div>
          <table class="atable pl-table"><tbody>
            ${row('Выручка (оплаченные заказы)', r.revenue, '', r.paidOrders + ' ' + plural(r.paidOrders, 'заказ', 'заказа', 'заказов') + ', ' + r.itemsSold + ' шт.')}
            ${r.refunds ? row('Возвраты покупателям', -r.refunds, '', r.refundedOrders + ' ' + plural(r.refundedOrders, 'заказ', 'заказа', 'заказов')) : ''}
            ${row('Чистая выручка', r.netRevenue, 'is-total')}
            ${row('Себестоимость проданного', -r.netCogs, '', 'по закупочной цене на момент продажи')}
            ${row('Валовая прибыль', r.gross, 'is-total', 'маржа ' + r.margin + '%')}
            ${row('Расходы магазина', -r.operating, '', 'аренда, зарплата, реклама и т. п. — без закупки товара')}
            ${r.otherIncome ? row('Прочие поступления', r.otherIncome) : ''}
            ${row('Чистая прибыль', r.net, 'is-total')}
          </tbody></table>
          <p class="hint" style="margin-top:12px">Оплата поставщику (${money(r.purchases)} за период) — это вложение в товар, а не расход: в прибыли она учитывается через себестоимость, когда товар продан.</p>
        </div><div>
          <div class="panel">
            <div class="panel__head"><h2>Скидки</h2></div>
            <table class="atable"><tbody>
              <tr><td>Скидки от суммы заказа</td><td class="num">${money(r.discounts)}</td></tr>
              <tr><td>Промокоды и ручные скидки</td><td class="num">${money(r.promoDiscounts)}</td></tr>
              <tr><td>Доставка, оплаченная покупателями</td><td class="num">${money(r.shipping)}</td></tr>
            </tbody></table>
          </div>
          <div class="panel">
            <div class="panel__head"><h2>Ждут оплаты</h2><span class="muted">${money(d.pendingSum)}</span></div>
            ${d.pending.length ? `<table class="atable"><tbody>${d.pending.slice(0, 10).map((o) => `<tr><td class="name">${esc(o.id)}<div class="sub">${esc(o.customer && o.customer.name)} · ${esc(o.status)}</div></td><td class="num">${money(o.total)}</td><td><button class="link-btn" data-order="${esc(o.id)}">открыть</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Неоплаченных заказов нет.</p>'}
          </div>
        </div></div>`;
    }
    if (tab === 'sales') {
      return `<div class="panels"><div>
          <div class="panel">
            <div class="panel__head"><h2>Ежедневный отчёт по продажам</h2><span class="muted">${d.daily.length} дн.</span></div>
            ${d.daily.length ? `<div class="table-wrap"><table class="atable">
              <thead><tr><th>Дата</th><th>Заказов</th><th>Товаров</th><th>Выручка</th><th>Валовая прибыль</th><th>Средний чек</th></tr></thead>
              <tbody>${d.daily.map((x) => `<tr>
                <td>${new Date(x.t).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'long' })}</td>
                <td class="num">${x.n}</td>
                <td class="num">${x.items}</td>
                <td class="num money-in"><b>${money(x.sum)}</b>${x.refunds ? `<div class="sub">возвраты −${money(x.refunds)}</div>` : ''}</td>
                <td class="num">${money(x.gross)}</td>
                <td class="num">${money(x.n ? x.sum / x.n : 0)}</td>
              </tr>`).join('')}
              <tr><td><b>Итого</b></td><td class="num"><b>${d.rep.paidOrders}</b></td><td class="num"><b>${d.daily.reduce((acc, x) => acc + x.items, 0)}</b></td><td class="num money-in"><b>${money(d.rep.netRevenue)}</b></td><td class="num"><b>${money(d.rep.gross)}</b></td><td class="num"><b>${money(d.rep.paidOrders ? d.rep.revenue / d.rep.paidOrders : 0)}</b></td></tr>
            </tbody></table></div>` : '<p class="muted">В этом периоде продаж нет.</p>'}
          </div>
        </div><div>
          <div class="panel">
            <div class="panel__head"><h2>Как платили</h2></div>
            ${d.payList.length ? `<table class="atable"><tbody>${d.payList.map(([name, sum]) => `<tr><td class="name">${esc(name)}</td><td class="num">${money(sum)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Нет данных.</p>'}
          </div>
          <div class="panel">
            <div class="panel__head"><h2>Откуда продажи</h2></div>
            ${d.statusList.length ? `<table class="atable"><tbody>${d.statusList.map(([name, sum]) => `<tr><td class="name">${esc(name)}</td><td class="num">${money(sum)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Нет данных.</p>'}
          </div>
          ${d.pending.length ? `<div class="panel">
            <div class="panel__head"><h2>Новые — ещё не подтверждены</h2><span class="muted">${money(d.pendingSum)}</span></div>
            <table class="atable"><tbody>${d.pending.slice(0, 10).map((o) => `<tr>
              <td class="name">${esc(o.id)}<div class="sub">${esc(o.customer && o.customer.name)}</div></td>
              <td class="num">${money(o.total)}</td>
              <td><button class="link-btn" data-order="${esc(o.id)}">открыть</button></td>
            </tr>`).join('')}</tbody></table>
          </div>` : ''}
        </div></div>`;
    }
    if (tab === 'expenses') {
      return `<div class="panels">
        <div class="panel">
          <div class="panel__head"><h2>Куда ушли деньги</h2>
            <button class="btn btn--dark" data-fin-add="out" style="height:40px">+ Добавить расход</button>
          </div>
          ${d.catList.length ? `<table class="atable"><tbody>
            ${d.catList.map(([name, sum]) => `<tr>
              <td class="name">${esc(name)}<div class="fin-bar"><i style="width:${Math.round(sum / d.maxCat * 100)}%"></i></div></td>
              <td class="num money-out"><b>−${money(sum)}</b></td>
              <td class="num muted">${d.tsum.expense ? Math.round(sum / d.tsum.expense * 100) : 0}%</td>
            </tr>`).join('')}
            <tr><td><b>Все расходы</b></td><td class="num money-out"><b>−${money(d.tsum.expense)}</b></td><td></td></tr>
          </tbody></table>` : '<p class="muted">Расходов пока нет. Нажмите «+ Деньги ушли», чтобы записать аренду, закупку или зарплату.</p>'}
        </div>
        <div class="panel">
          <div class="panel__head"><h2>Подсказка</h2></div>
          <p class="hint" style="margin:0">Сюда пишите всё, что платите сами: ткань, аренда, зарплата, реклама, доставка на склад, упаковка, налоги. Тогда сумма «Сейчас в кассе» будет настоящей.</p>
        </div>
      </div>`;
    }
    if (tab === 'journal') {
      return `<div class="panel">
        <div class="panel__head"><h2>Журнал операций</h2><span class="muted">${d.journal.length} записей</span></div>
        ${d.journal.length ? `<div class="table-wrap"><table class="atable">
          <thead><tr><th>Дата</th><th>Что</th><th>Сумма</th><th>Остаток после</th><th>Комментарий</th><th></th></tr></thead>
          <tbody>${d.journal.map((r) => `<tr class="fin-row-${r.type}">
            <td>${fmtDate(r.date, true)}</td>
            <td>${esc(r.category)}<div class="sub">${r.type === 'in' ? 'приход' : 'расход'}${r.source === 'order' ? ' · заказ' : ''}</div></td>
            <td class="num">${r.type === 'in' ? '+' : '−'}${money(r.amount)}</td>
            <td class="num">${money(r.balance)}</td>
            <td class="name">${esc(r.note)}${r.orderId ? ` <button class="link-btn" data-order="${esc(r.orderId)}">заказ</button>` : ''}</td>
            <td>${r.source === 'manual' ? `<button class="icon-btn" data-fin-edit="${esc(r.id)}" title="Изменить">${ICONS.edit}</button><button class="icon-btn" data-fin-del="${esc(r.id)}" title="Удалить">${ICONS.trash}</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">Записей нет. Измените период или добавьте операцию.</p>'}
      </div>`;
    }
    return `<div class="panel">
        <div class="panel__head"><h2>Движение денег по дням</h2><span class="muted">золото — пришло, красный — ушло</span></div>
        ${d.buckets.length ? `<svg class="chart fin-chart" viewBox="0 0 ${d.W} ${d.H}">
          ${d.buckets.map((b, i) => {
            const hi = Math.max(1, (b.inn / d.maxBar) * (d.H - 28));
            const ho = Math.max(b.out ? 1 : 0, (b.out / d.maxBar) * (d.H - 28));
            const x = i * d.bw;
            const dt = new Date(b.t);
            const label = d.buckets.length <= 16 || i % Math.ceil(d.buckets.length / 12) === 0;
            return `<rect x="${x + 2}" y="${d.H - 18 - hi}" width="${Math.max(2, d.bw * 0.42)}" height="${hi}" rx="2" fill="#b8913f"><title>${dt.toLocaleDateString('ru-RU')}: пришло ${money(b.inn)}</title></rect>
              <rect x="${x + d.bw * 0.48}" y="${d.H - 18 - ho}" width="${Math.max(2, d.bw * 0.42)}" height="${ho}" rx="2" fill="#b3141f"><title>ушло ${money(b.out)}</title></rect>
              ${label ? `<text x="${x + d.bw / 2}" y="${d.H - 4}" text-anchor="middle">${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}</text>` : ''}`;
          }).join('')}
        </svg>` : '<p class="muted">Нет данных за период.</p>'}
      </div>
      <div class="panels">
        <div class="panel">
          <div class="panel__head"><h2>Сводка</h2></div>
          <table class="atable"><tbody>
            <tr><td>Оплаты заказов</td><td class="num money-in">+${money(d.sales)}</td></tr>
            <tr><td>Другие поступления</td><td class="num money-in">+${money(d.otherIn)}</td></tr>
            <tr><td><b>Всего пришло</b></td><td class="num"><b>+${money(d.tsum.income)}</b></td></tr>
            ${d.catList.slice(0, 6).map(([name, sum]) => `<tr><td>${esc(name)}</td><td class="num money-out">−${money(sum)}</td></tr>`).join('')}
            <tr><td><b>Всего ушло</b></td><td class="num money-out"><b>−${money(d.tsum.expense)}</b></td></tr>
            <tr><td><b>Результат</b></td><td class="num"><b class="${d.tsum.net >= 0 ? 'money-in' : 'money-out'}">${d.tsum.net >= 0 ? '+' : '−'}${money(Math.abs(d.tsum.net))}</b></td></tr>
            <tr><td>Было в кассе</td><td class="num">${money(d.opening)}</td></tr>
            <tr><td><b>Сейчас в кассе</b></td><td class="num"><b>${money(d.closing)}</b></td></tr>
          </tbody></table>
        </div>
        <div class="panel">
          <div class="panel__head"><h2>Последние операции</h2><button type="button" class="link-btn" data-fin-tab="journal">весь журнал →</button></div>
          ${d.journal.length ? `<table class="atable"><tbody>
            ${d.journal.slice(0, 8).map((r) => `<tr>
              <td>${fmtDate(r.date)}</td>
              <td class="name">${esc(r.category)}</td>
              <td class="num ${r.type === 'in' ? 'money-in' : 'money-out'}">${r.type === 'in' ? '+' : '−'}${money(r.amount)}</td>
            </tr>`).join('')}
          </tbody></table>` : '<p class="muted">Операций пока нет.</p>'}
        </div>
      </div>`;
  }


  function exportFinanceCsv() {
    const rows = buildFinanceRows();
    const lines = [['Дата', 'Тип', 'Статья', 'Сумма', 'Комментарий']];
    rows.slice().reverse().forEach((r) => {
      lines.push([
        new Date(r.date).toLocaleString('ru-RU'),
        r.type === 'in' ? 'Приход' : 'Расход',
        r.category,
        String(r.type === 'in' ? r.amount : -r.amount),
        r.note,
      ]);
    });
    const csv = '\ufeff' + lines.map((row) => row.map((c) => '"' + csvSafe(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    download('nargizka-finance.csv', csv, 'text/csv;charset=utf-8');
  }

  function openFinanceForm(type, entry) {
    const isIn = (entry ? entry.type : type) === 'in';
    const cats = isIn ? FIN_IN_CATS : FIN_OUT_CATS;
    const dateVal = entry ? ymdLocal(new Date(entry.date)) : ymdLocal(new Date());
    const cat = entry ? entry.category : cats[0];
    const options = cats.includes(cat) ? cats : [cat].concat(cats);
    openModal(`<h2>${entry ? 'Изменить запись' : (isIn ? 'Деньги пришли в кассу' : 'Деньги ушли из кассы')}</h2>
      <p class="hint" style="margin-top:-6px">${isIn ? 'Вложение владельца, возврат от поставщика или прочий приход — не оплата заказа. Вложения и возвраты от поставщика не считаются прибылью.' : 'Аренда, зарплата, реклама и всё, что вы платите сами. Оплату поставщику за товар удобнее записывать через «Поступление» на складе — тогда себестоимость посчитается сама.'}</p>
      <form id="finEntryForm" class="form-grid" data-fin-type="${isIn ? 'in' : 'out'}" data-fin-id="${entry ? esc(entry.id) : ''}">
        <div class="field"><label>Дата</label><input class="input" type="date" name="date" value="${dateVal}" required></div>
        <div class="field"><label>Сумма, сум</label><input class="input" type="number" min="1" step="1000" name="amount" required value="${entry ? entry.amount : ''}" placeholder="500000"></div>
        <div class="field full"><label>На что / откуда</label><select class="input" name="category">${options.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field full"><label>Комментарий</label><input class="input" name="note" value="${entry ? esc(entry.note) : ''}" placeholder="Например: закупка шёлка / аренда за март"></div>
        <div class="full form-actions">
          <button type="button" class="btn btn--outline" data-close>Отмена</button>
          <button type="submit" class="btn btn--dark">${isIn ? 'Записать приход' : 'Записать расход'}</button>
        </div>
      </form>`);
  }

  /* ---------- категории и цвета ---------- */
  function viewCatalog() {
    const s = NS.settings;
    const count = (fn) => NS.products().filter(fn).length;
    view.innerHTML = `<div class="mk-grid">
      <div class="panel">
        <div class="panel__head"><h2>Категории</h2><span class="muted">${s.categories.length}</span></div>
        <p class="hint">Названия видны в меню, фильтрах и на главной. Удалить можно только пустую категорию.</p>
        <form id="catsForm">
          ${s.categories.map((c, i) => `<div class="tier-row">
            <div class="field"><label>Название</label><input class="input" name="catName" data-i="${i}" value="${esc(c.name)}"></div>
            <div class="field" style="max-width:110px"><label>Товаров</label><div class="muted" style="padding:12px 0">${count((p) => p.category === c.id)}</div></div>
            <button type="button" class="icon-btn" data-cat-del="${i}" aria-label="Удалить">${ICONS.trash}</button>
          </div>`).join('')}
          <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить названия</button></div>
        </form>
        <form id="catAddForm" class="inline" style="margin-top:12px">
          <div class="field"><label>Новая категория</label><input class="input" name="name" placeholder="Например: Вязаные"></div>
          <button class="btn btn--outline" type="submit">Добавить</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Цвета</h2><span class="muted">${Object.keys(s.colors).length}</span></div>
        <p class="hint">Можно менять название и оттенок. Удалить — только цвет без товаров.</p>
        <form id="colorsForm">
          <div class="color-edit">${Object.keys(s.colors).map((name) => `<div class="color-edit__row">
            <input type="color" value="${esc(s.colors[name])}" data-color-hex="${esc(name)}" aria-label="оттенок">
            <input class="input" data-color-name="${esc(name)}" value="${esc(name)}" placeholder="Название">
            <small class="muted">${count((p) => p.colors.includes(name))} тов.</small>
            <button type="button" class="icon-btn" data-color-del="${esc(name)}" aria-label="Удалить">${ICONS.trash}</button>
          </div>`).join('')}</div>
          <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить цвета</button></div>
        </form>
        <form id="colorAddForm" class="inline" style="margin-top:12px">
          <div class="field"><label>Новый цвет</label><input class="input" name="name" placeholder="Например: Фисташковый"></div>
          <div class="field" style="max-width:80px"><label>Оттенок</label><input class="input" type="color" name="hex" value="#c9a96e" style="padding:4px;height:44px"></div>
          <button class="btn btn--outline" type="submit">Добавить</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Размеры</h2><span class="muted">${(s.sizes || []).length}</span></div>
        <p class="hint">Размеры видны на витрине и в остатках товара. Переименование переносит остатки. Удалить можно размер без остатков.</p>
        <form id="sizesForm">
          <div class="size-edit">${(s.sizes || []).map((sz, i) => `<div class="size-edit__row">
            <input class="input" name="sizeName" data-i="${i}" value="${esc(sz)}" placeholder="XS">
            <small class="muted">${count((p) => +(p.stock && p.stock[sz]) > 0)} тов.</small>
            <button type="button" class="icon-btn" data-size-del="${i}" aria-label="Удалить">${ICONS.trash}</button>
          </div>`).join('')}</div>
          <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить размеры</button></div>
        </form>
        <form id="sizeAddForm" class="inline" style="margin-top:12px">
          <div class="field"><label>Новый размер</label><input class="input" name="name" placeholder="Например: 42 или XXXL"></div>
          <button class="btn btn--outline" type="submit">Добавить</button>
        </form>
      </div>
    </div>`;
  }

  /* ---------- настройки ---------- */
  function viewSettings() {
    const s = NS.settings;
    const pay = s.payments || {};
    view.innerHTML = `<div class="mk-grid">
      <div>
        <div class="panel">
          <div class="panel__head"><h2>Валюта и курс</h2></div>
          <p class="hint">Все цены хранятся в сумах. Покупатель может переключить отображение на доллары — сумма пересчитывается по этому курсу.</p>
          <form id="currencyForm" class="form-grid">
            <div class="field"><label>Курс: 1 $ = … сум</label><input class="input" type="number" min="1" step="1" name="rate" value="${s.usdRate}"></div>
            <div class="field"><label>Валюта по умолчанию на сайте</label><select class="input" name="def">
              <option value="UZS" ${s.defaultCurrency !== 'USD' ? 'selected' : ''}>Сум (UZS)</option>
              <option value="USD" ${s.defaultCurrency === 'USD' ? 'selected' : ''}>Доллар (USD)</option>
            </select></div>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Доставка и возврат</h2></div>
          <p class="hint">Порог бесплатной доставки мотивирует добавить ещё товар — в корзине показывается шкала «осталось до бесплатной доставки».</p>
          <form id="shipForm" class="form-grid">
            <div class="field"><label>Курьер, сум</label><input class="input" type="number" min="0" step="1000" name="cost" value="${s.shippingCost}"></div>
            <div class="field"><label>Бесплатно от, сум (0 — никогда)</label><input class="input" type="number" min="0" step="1000" name="free" value="${s.freeShippingFrom}"></div>
            <div class="field"><label>Экспресс за 3 часа, сум</label><input class="input" type="number" min="0" step="1000" name="express" value="${s.expressCost}"></div>
            <div class="field"><label>Срок возврата, дней</label><input class="input" type="number" min="0" max="60" name="returnDays" value="${s.returnDays}"></div>
            <label class="toggle-row full">Самовывоз из бутика<span class="switch"><input type="checkbox" name="pickup" ${s.pickupEnabled ? 'checked' : ''}><span></span></span></label>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Способы оплаты</h2></div>
          <p class="hint">Отмеченные способы покупатель видит при оформлении заказа. Онлайн-оплата пока подтверждается менеджером по телефону.</p>
          <form id="payForm">
            ${Object.keys(NS.PAYMENTS).map((k) => `<label class="toggle-row" style="margin-bottom:10px">${esc(NS.PAYMENTS[k].name)} <small class="muted" style="margin-left:6px">${esc(NS.PAYMENTS[k].note)}</small><span class="switch"><input type="checkbox" name="${k}" ${pay[k] ? 'checked' : ''}><span></span></span></label>`).join('')}
            <div class="form-actions"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel__head"><h2>Контакты магазина</h2></div>
          <form id="contactsForm" class="form-grid">
            <div class="field"><label>Телефон</label><input class="input" name="phone" value="${esc(s.contacts.phone)}"></div>
            <div class="field"><label>E-mail</label><input class="input" name="email" value="${esc(s.contacts.email)}"></div>
            <div class="field full"><label>Адрес бутика</label><input class="input" name="address" value="${esc(s.contacts.address)}"></div>
            <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(s.contacts.instagram)}"></div>
            <div class="field"><label>Telegram</label><input class="input" name="telegram" value="${esc(s.contacts.telegram || '')}"></div>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сохранить</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Почта и SMS</h2></div>
          <p class="hint">Раньше подписка только сохраняла e-mail — письма не уходили. Укажите SMTP (Mail.ru / Yandex / Gmail) и при необходимости Eskiz.uz для SMS.</p>
          <div id="notifyStatus" class="hint" style="margin-bottom:12px"></div>
          <form id="notifyForm" class="form-grid">
            <label class="toggle-row full">Включить e-mail (SMTP)<span class="switch"><input type="checkbox" name="emailOn"><span></span></span></label>
            <div class="field"><label>SMTP хост</label><input class="input" name="host" placeholder="smtp.mail.ru"></div>
            <div class="field"><label>Порт</label><input class="input" type="number" name="port" value="465"></div>
            <div class="field"><label>Логин (e-mail)</label><input class="input" name="user" placeholder="shop@mail.ru" autocomplete="off"></div>
            <div class="field"><label>Пароль / пароль приложения</label><input class="input" type="password" name="pass" placeholder="••••••••" autocomplete="new-password"></div>
            <div class="field full"><label>От кого (From)</label><input class="input" name="from" placeholder="Nargizka Shop &lt;shop@mail.ru&gt;"></div>
            <label class="toggle-row full">Включить SMS (Eskiz.uz)<span class="switch"><input type="checkbox" name="smsOn"><span></span></span></label>
            <div class="field"><label>Eskiz e-mail</label><input class="input" name="smsEmail" autocomplete="off"></div>
            <div class="field"><label>Eskiz пароль</label><input class="input" type="password" name="smsPass" autocomplete="new-password"></div>
            <div class="field"><label>SMS from (имя отправителя)</label><input class="input" name="smsFrom" placeholder="4546"></div>
            <label class="toggle-row full">Telegram-уведомления админу<span class="switch"><input type="checkbox" name="tgOn"><span></span></span></label>
            <div class="field"><label>Bot token</label><input class="input" name="tgToken" placeholder="123:ABC…" autocomplete="off"></div>
            <div class="field"><label>Chat ID</label><input class="input" name="tgChat" placeholder="123456789"></div>
            <div class="full form-actions" style="margin-top:0;display:flex;flex-wrap:wrap;gap:8px">
              <button class="btn btn--dark" type="submit">Сохранить</button>
              <button class="btn btn--outline" type="button" data-notify-test="email">Тест письма</button>
              <button class="btn btn--outline" type="button" data-notify-test="sms">Тест SMS</button>
              <button class="btn btn--outline" type="button" data-notify-test="telegram">Тест Telegram</button>
            </div>
          </form>
          <div id="outboxBox" style="margin-top:16px"></div>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Пароль администратора</h2></div>
          <form id="passForm" class="form-grid">
            <div class="field"><label>Новый пароль (от 8 символов)</label><input class="input" type="password" name="p1" autocomplete="new-password"></div>
            <div class="field"><label>Повторите пароль</label><input class="input" type="password" name="p2" autocomplete="new-password"></div>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сменить пароль</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Бренд магазина</h2></div>
          <p class="hint">Название, логотип и цвета на сайте, в письмах и SMS. Меняются без программиста — пригодится, если платформа будет работать для другого магазина.</p>
          <form id="brandForm" class="form-grid">
            <div class="field"><label>Полное название</label><input class="input" name="name" value="${esc(NS.brand().name)}" maxlength="80"></div>
            <div class="field"><label>Короткое название (в логотипе)</label><input class="input" name="short" value="${esc(NS.brand().short)}" maxlength="40"></div>
            <div class="field full"><label>Слоган</label><input class="input" name="tagline" value="${esc(NS.brand().tagline)}" maxlength="160"></div>
            <div class="field full"><label>Логотип</label>
              <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
                <img id="brandLogoPreview" src="${esc(NS.brand().logoUrl || '/assets/logo.svg')}" alt="" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff">
                <label class="btn btn--outline" style="height:42px;cursor:pointer">Загрузить логотип<input type="file" accept="image/*" id="brandLogoFile" hidden></label>
                <button type="button" class="link-btn" data-logo-reset>Стандартный</button>
                <input type="hidden" name="logoUrl" value="${esc(NS.brand().logoUrl || '')}">
              </div>
            </div>
            <div class="field"><label>Акцентный цвет</label><div style="display:flex;gap:8px;align-items:center"><input type="color" name="accent" value="${esc(NS.brand().accent || '#b8913f')}" style="width:52px;height:40px;padding:2px"><label class="muted" style="font-size:13px"><input type="checkbox" name="accentDefault" ${NS.brand().accent ? '' : 'checked'}> стандартный</label></div></div>
            <div class="field"><label>Основной тёмный цвет</label><div style="display:flex;gap:8px;align-items:center"><input type="color" name="dark" value="${esc(NS.brand().dark || '#111111')}" style="width:52px;height:40px;padding:2px"><label class="muted" style="font-size:13px"><input type="checkbox" name="darkDefault" ${NS.brand().dark ? '' : 'checked'}> стандартный</label></div></div>
            <div class="field"><label>Город</label><input class="input" name="city" value="${esc(NS.brand().city)}"></div>
            <div class="field"><label>Часы работы</label><input class="input" name="workHours" value="${esc(NS.brand().workHours)}" placeholder="Ежедневно 10:00–21:00"></div>
            <div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" value="${esc(NS.brand().whatsapp)}" placeholder="+998 …"></div>
            <div class="field"><label>Facebook (ссылка)</label><input class="input" name="facebook" value="${esc(NS.brand().facebook)}" placeholder="https://facebook.com/…"></div>
            <div class="field"><label>TikTok (ссылка)</label><input class="input" name="tiktok" value="${esc(NS.brand().tiktok)}" placeholder="https://tiktok.com/@…"></div>
            <div class="field"><label>YouTube (ссылка)</label><input class="input" name="youtube" value="${esc(NS.brand().youtube)}" placeholder="https://youtube.com/…"></div>
            <div class="field full"><label>Ссылка на карту</label><input class="input" name="mapUrl" value="${esc(NS.brand().mapUrl)}" placeholder="https://yandex.uz/maps/…"></div>
            <div class="full form-actions" style="margin-top:0"><button class="btn btn--dark" type="submit">Сохранить бренд</button></div>
          </form>
        </div>

        <div class="panel">
          <div class="panel__head"><h2>Данные магазина</h2></div>
          <p class="hint">Скачивайте резервную копию хотя бы раз в неделю и храните её в надёжном месте (в ней есть телефоны и адреса покупателей). Фото хранятся в базе отдельно и в файл не входят. «Загрузить копию» заменяет текущие данные — перед этим сервер сам сохраняет снимок.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn--dark" data-export-db style="height:44px">Скачать резервную копию</button>
            <label class="btn btn--outline" style="height:44px;cursor:pointer">Загрузить копию<input type="file" accept="application/json" id="importDb" hidden></label>
          </div>
        </div>
      </div>
    </div>`;
    loadNotifyPanel();
  }

  let notifyCache = null;
  function fillNotifyForm(data) {
    notifyCache = data;
    const n = (data && data.notify && data.notify.public) || {};
    const f = $('#notifyForm');
    if (!f) return;
    const e = n.email || {}, sm = n.sms || {}, tg = n.telegram || {};
    f.emailOn.checked = !!e.enabled;
    f.host.value = e.host || 'smtp.mail.ru';
    f.port.value = e.port || 465;
    f.user.value = e.user || '';
    f.pass.value = '';
    f.pass.placeholder = e.hasPass ? '•••••••• (сохранён)' : 'пароль';
    f.from.value = e.from || '';
    f.smsOn.checked = !!sm.enabled;
    f.smsEmail.value = sm.email || '';
    f.smsPass.value = '';
    f.smsPass.placeholder = sm.hasPass ? '•••••••• (сохранён)' : 'пароль Eskiz';
    f.smsFrom.value = sm.from || '4546';
    f.tgOn.checked = !!tg.enabled;
    f.tgToken.value = '';
    f.tgToken.placeholder = tg.hasToken ? '•••• (сохранён)' : 'bot token';
    f.tgChat.value = tg.chatId || '';
    const st = data.notify || {};
    const status = $('#notifyStatus');
    if (status) {
      status.innerHTML = 'Статус: почта ' + (st.emailReady ? '<b style="color:var(--ok)">готова</b>' : '<b style="color:var(--sale)">не настроена</b>')
        + ' · SMS ' + (st.smsReady ? '<b style="color:var(--ok)">готовы</b>' : '<b style="color:var(--sale)">не настроены</b>')
        + ' · Telegram ' + (st.telegramReady ? '<b style="color:var(--ok)">готов</b>' : '<b style="color:var(--sale)">выкл</b>');
    }
    const box = $('#outboxBox');
    if (box) {
      const list = data.outbox || [];
      box.innerHTML = '<h3 style="margin:0 0 8px;font-size:15px">Журнал отправки</h3>' + (list.length
        ? '<div class="table-wrap"><table class="atable"><thead><tr><th>Время</th><th>Канал</th><th>Кому</th><th>Статус</th><th>Детали</th></tr></thead><tbody>'
          + list.slice(0, 15).map((x) => '<tr><td>' + esc(new Date(x.at).toLocaleString()) + '</td><td>' + esc(x.channel) + '</td><td>' + esc(x.to || '') + '</td><td>' + esc(x.status) + '</td><td class="sub">' + esc(x.error || x.subject || x.text || '') + '</td></tr>').join('')
          + '</tbody></table></div>'
        : '<p class="muted">Пока ничего не отправляли.</p>');
    }
  }
  function loadNotifyPanel() {
    return NS.api('/api/admin/notify').then(fillNotifyForm).catch(() => {});
  }

  const VIEWS = { dashboard: viewDashboard, products: viewProducts, orders: viewOrders, finance: viewFinance, marketing: viewMarketing, promos: viewPromos, catalog: viewCatalog, settings: viewSettings };

  /* ---------- события ---------- */
  document.addEventListener('click', (e) => {
    const el = (s) => e.target.closest(s);
    let x;
    if ((x = el('#sideNav [data-view]'))) { closeModal(); go(x.dataset.view); return; }
    if ((x = el('[data-new]'))) { if (current !== 'products') go('products'); openProductForm(null); return; }
    if (el('[data-store-sale]')) { openStoreSaleForm(); return; }
    if (el('[data-stock-in]')) { openStockInForm(); return; }
    if ((x = el('[data-quick-sale]'))) { openStoreSaleForm(x.dataset.quickSale); return; }
    if ((x = el('[data-stock-for]'))) { closeModal(); openStockInForm(x.dataset.stockFor, x.dataset.mode || 'in'); return; }
    if (el('[data-logo-reset]')) { const f = $('#brandForm'); f.logoUrl.value = ''; $('#brandLogoPreview').src = '/assets/logo.svg'; return; }
    if ((x = el('[data-ptab]'))) { ui.products.tab = x.dataset.ptab; viewProducts(); return; }
    if ((x = el('[data-moves]'))) { const p = NS.product(x.dataset.moves); ui.products.tab = 'moves'; ui.products.mq = p ? p.name : ''; ui.products.mtype = ''; viewProducts(); return; }
    if ((x = el('[data-order-paid]'))) {
      const id = x.dataset.orderPaid;
      const paid = x.dataset.v === '1';
      if (!paid && !confirm('Снять отметку об оплате? Сумма уйдёт из выручки. Делайте это только для исправления ошибки.')) return;
      call('/api/admin/order-paid', { id, paid }, paid ? `Заказ ${esc(id)} отмечен оплаченным` : `Оплата заказа ${esc(id)} снята`)
        .then(() => { openOrder(id); render(); }).catch(() => {});
      return;
    }
    if ((x = el('[data-opay]'))) { ui.orders.pay = x.dataset.opay; viewOrders(); return; }
    if ((x = el('[data-pfilter]'))) {
      ui.products.filter = x.dataset.pfilter || 'all';
      if (current === 'products') viewProducts();
      return;
    }
    if ((x = el('[data-go]'))) { closeModal(); go(x.dataset.go); return; }
    if ((x = el('[data-edit]'))) { openProductForm(x.dataset.edit); return; }
    if ((x = el('[data-dup]'))) { openProductForm(x.dataset.dup, true); return; }
    if ((x = el('[data-del]'))) {
      const p = NS.product(x.dataset.del);
      if (p && confirm(`Удалить «${p.name}» из каталога?${NS.totalStock(p) ? `\nНа складе ещё ${NS.totalStock(p)} шт.` : ''}\nКопия товара сохранится в архиве базы, но на сайте и в админке его не будет.`)) {
        NS.db.products = NS.products().filter((q) => q.id !== p.id);
        save('Товар удалён', renderProductsTable);
      }
      return;
    }
    if ((x = el('[data-bulk]'))) { bulk(x.dataset.bulk); return; }
    if ((x = el('[data-order]'))) { openOrder(x.dataset.order); return; }
    if ((x = el('[data-order-status]'))) {
      const id = x.dataset.orderStatus;
      setOrderStatus(id, x.dataset.v).then((ok) => { if (ok) { openOrder(id); render(); } });
      return;
    }
    if ((x = el('[data-order-del]'))) {
      const od = NS.db.orders.find((o) => o.id === x.dataset.orderDel);
      if (!confirm(`Удалить заказ ${x.dataset.orderDel}?\n\nИспользуйте только для ошибочных или тестовых заказов. Для отказа клиента выберите «Отменён».${od && od.stockOut ? '\nТовар вернётся на склад.' : ''}${od && od.paid ? '\nЗаказ оплачен — его сумма уйдёт из отчётов.' : ''}\nКопия заказа сохранится в архиве базы.`)) return;
      call('/api/admin/order-delete', { id: x.dataset.orderDel }, 'Заказ удалён').then(() => { closeModal(); render(); }).catch(() => {});
      return;
    }
    if ((x = el('[data-ostatus]'))) { ui.orders.status = x.dataset.ostatus; viewOrders(); return; }
    if (el('[data-export-orders]')) { exportOrdersCSV(); return; }
    if (el('[data-export-subs]')) { download('nargizka-subscribers.csv', '\ufeffemail\r\n' + NS.db.subscribers.join('\r\n'), 'text/csv;charset=utf-8'); return; }
    if ((x = el('[data-extend]'))) {
      const input = $('#flashForm').elements.endsAt;
      const base = Math.max(Date.now(), new Date(input.value).getTime() || 0);
      input.value = toLocalInput(base + +x.dataset.extend * 86400000);
      renderFlashPreview();
      return;
    }
    if (el('[data-mass-clear]')) {
      const cat = $('#massForm').elements.cat.value;
      const list = NS.products().filter((p) => !cat || p.category === cat);
      if (!confirm(`Снять скидки с ${list.length} товаров?`)) return;
      list.forEach((p) => { p.discount = 0; });
      save(`Скидки сняты с ${list.length} товаров`);
      return;
    }
    if (el('[data-tier-add]')) { $('#tierRows').insertAdjacentHTML('beforeend', tierRow(null)); return; }
    if ((x = el('[data-tier-del]'))) { x.closest('.tier-row').remove(); return; }
    if ((x = el('[data-promo-edit]'))) { fillPromoForm(+x.dataset.promoEdit); return; }
    if (el('[data-promo-reset]')) { $('#promoForm').reset(); $('#promoForm').elements.idx.value = ''; $('#promoFormTitle').textContent = 'Новый промокод'; return; }
    if ((x = el('[data-promo-del]'))) {
      const s = NS.settings;
      const c = s.promoCodes[+x.dataset.promoDel];
      if (c && confirm(`Удалить промокод ${c.code}?`)) {
        s.promoCodes.splice(+x.dataset.promoDel, 1);
        if (s.welcomeCode === c.code) s.welcomeCode = '';
        save('Промокод удалён');
      }
      return;
    }
    if ((x = el('[data-cat-del]'))) {
      const s = NS.settings;
      const c = s.categories[+x.dataset.catDel];
      if (!c) return;
      const n = NS.products().filter((p) => p.category === c.id).length;
      if (n) return toast(`В категории «${esc(c.name)}» ${n} товаров — сначала перенесите их в другую`, 'error');
      if (s.categories.length <= 1) return toast('Должна остаться хотя бы одна категория', 'error');
      if (!confirm(`Удалить категорию «${c.name}»?`)) return;
      s.categories.splice(+x.dataset.catDel, 1);
      s.flash.categories = s.flash.categories.filter((id) => id !== c.id);
      save('Категория удалена');
      return;
    }
    if ((x = el('[data-color-del]'))) {
      const name = x.dataset.colorDel;
      const n = NS.products().filter((p) => p.colors.includes(name)).length;
      if (n) return toast(`Цвет «${esc(name)}» используется в ${n} товарах`, 'error');
      if (Object.keys(NS.settings.colors).length <= 1) return toast('Должен остаться хотя бы один цвет', 'error');
      if (!confirm(`Удалить цвет «${name}»?`)) return;
      delete NS.settings.colors[name];
      save('Цвет удалён');
      return;
    }
    if ((x = el('[data-size-del]'))) {
      const sset = NS.settings;
      const i = +x.dataset.sizeDel;
      const sz = (sset.sizes || [])[i];
      if (!sz) return;
      const n = NS.products().filter((p) => +(p.stock && p.stock[sz]) > 0).length;
      if (n) return toast('Размер «' + esc(sz) + '» есть в остатках у ' + n + ' товаров — сначала обнулите', 'error');
      if ((sset.sizes || []).length <= 1) return toast('Должен остаться хотя бы один размер', 'error');
      if (!confirm('Удалить размер «' + sz + '»?')) return;
      sset.sizes.splice(i, 1);
      NS.products().forEach((p) => { Object.keys(p.vstock || {}).forEach((k) => { if (NS.splitKey(k)[1] === sz) delete p.vstock[k]; }); if (p.stock) delete p.stock[sz]; });
      save('Размер удалён');
      return;
    }
    if ((x = el('[data-fin-preset]'))) { setFinancePreset(x.dataset.finPreset); return; }
    if ((x = el('[data-fin-tab]'))) {
      ui.finance.tab = x.dataset.finTab || 'overview';
      if (current === 'finance') viewFinance();
      return;
    }
    if ((x = el('[data-fin-kind]'))) {
      ui.finance.kind = x.dataset.finKind || 'all';
      if (current === 'finance') viewFinance();
      return;
    }
    if (el('[data-fin-export]')) { exportFinanceCsv(); return; }
    if ((x = el('[data-fin-edit]'))) {
      const e = (financeEnsure().entries || []).find((i) => i.id === x.dataset.finEdit);
      if (e) openFinanceForm(e.type, e);
      return;
    }
    if ((x = el('[data-fin-add]'))) { openFinanceForm(x.dataset.finAdd); return; }
    if ((x = el('[data-fin-del]'))) {
      if (!confirm('Удалить операцию?')) return;
      call('/api/admin/finance', { deleteId: x.dataset.finDel }, 'Операция удалена').then(() => viewFinance()).catch(() => {});
      return;
    }
    if (el('[data-fin-opening]')) {
      const fin = financeEnsure();
      const v = prompt('Стартовый капитал / остаток до учёта заказов, сум', String(fin.openingBalance || 0));
      if (v == null) return;
      const n = Math.max(0, Math.round(+String(v).replace(/\s/g, '') || 0));
      call('/api/admin/finance', { openingBalance: n }, 'Стартовый остаток сохранён').then(() => viewFinance()).catch(() => {});
      return;
    }
    if ((x = el('[data-notify-test]'))) {
      const kind = x.dataset.notifyTest;
      let to = '';
      if (kind === 'email') to = prompt('Куда отправить тестовое письмо?', ($('#notifyForm') && $('#notifyForm').user.value) || '') || '';
      if (kind === 'sms') to = prompt('Номер для тестового SMS (+998…)', '') || '';
      if (!to && kind !== 'telegram') return;
      NS.api('/api/admin/notify-test', { kind, to }).then((d) => {
        fillNotifyForm(Object.assign({}, notifyCache || {}, d, { notify: (notifyCache && notifyCache.notify) || d.notify, outbox: d.outbox }));
        loadNotifyPanel();
        toast(kind === 'email' ? 'Тестовое письмо отправлено' : kind === 'sms' ? 'Тестовое SMS отправлено' : 'Тест Telegram отправлен');
      }).catch((e) => toast(esc(e.message), 'error'));
      return;
    }
    if (el('[data-export-db]')) { download('nargizka-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(NS.db, null, 2), 'application/json'); return; }
    if (el('[data-reset-db]')) {
      if (!confirm('Все товары, заказы и настройки будут заменены демо-данными. Загруженные фото останутся в папке uploads. Продолжить?')) return;
      call('/api/admin/reset', {}, 'Демо-данные восстановлены').then(render).catch(() => {});
      return;
    }
    if (el('#sideToggle')) { $('#side').classList.toggle('is-open'); $('#overlay').classList.toggle('is-on'); return; }
    if (el('[data-close]') || e.target.id === 'modal' || e.target.id === 'overlay') closeModal();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-fin]')) {
      const key = t.dataset.fin;
      if (key === 'q') return;
      if (key === 'paidOnly') ui.finance.paidOnly = t.checked;
      else ui.finance[key] = t.type === 'checkbox' ? t.checked : t.value;
      if (key === 'from' || key === 'to') ui.finance.preset = '';
      if (current === 'finance') viewFinance();
      return;
    }
    if (t.matches('[data-sel]')) {
      const sel = ui.products.sel;
      if (t.checked) sel.add(t.dataset.sel); else sel.delete(t.dataset.sel);
      renderProductsTable();
    } else if (t.matches('[data-selall]')) {
      filteredProducts().forEach((p) => (t.checked ? ui.products.sel.add(p.id) : ui.products.sel.delete(p.id)));
      renderProductsTable();
    } else if (t.matches('[data-disc]')) {
      const p = NS.product(t.dataset.disc);
      if (!p) return;
      p.discount = Math.min(90, Math.max(0, Math.round(+t.value || 0)));
      save(p.discount ? `${esc(p.name)}: скидка −${p.discount}%` : `${esc(p.name)}: скидка снята`, renderProductsTable);
    } else if (t.matches('[data-price]')) {
      const p = NS.product(t.dataset.price);
      if (!p) return;
      const v = Math.round(+t.value || 0);
      if (!(v > 0)) { t.value = p.price; return toast('Цена должна быть больше нуля', 'error'); }
      p.price = v;
      save(`${esc(p.name)}: цена ${money(v)}`, renderProductsTable);
    } else if (t.matches('[data-vis]')) {
      const p = NS.product(t.dataset.vis);
      if (!p) return;
      p.visible = t.checked;
      save(p.visible ? 'Товар опубликован на сайте' : 'Товар скрыт с сайта', renderProductsTable);
    } else if (t.id === 'brandLogoFile' && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      resizeImage(file, 600).then((data) => NS.api('/api/admin/upload', { data })).then((r) => {
        const f = $('#brandForm');
        f.logoUrl.value = r.url;
        $('#brandLogoPreview').src = r.url;
        toast('Логотип загружен — нажмите «Сохранить бренд»');
      }).catch((err) => toast('Не удалось загрузить логотип: ' + esc(err.message || ''), 'error'));
    } else if (t.matches('[data-mtype]')) {
      ui.products.mtype = t.value; viewProducts();
    } else if (t.matches('[data-pf]') && t.tagName === 'SELECT') {
      ui.products[t.dataset.pf] = t.value;
      renderProductsTable();
    } else if (t.matches('[data-status]')) {
      const prev = (NS.db.orders.find((o) => o.id === t.dataset.status) || {}).status;
      setOrderStatus(t.dataset.status, t.value).then((ok) => { if (ok === false) t.value = prev; renderOrdersTable(); });
    } else if (t.matches('[data-promo-toggle]')) {
      const c = NS.settings.promoCodes[+t.dataset.promoToggle];
      c.active = t.checked;
      save(`Промокод ${esc(c.code)} ${c.active ? 'включён' : 'выключен'}`);
    } else if (t.id === 'importDb' && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.products) || !data.settings) throw new Error('bad');
          if (!confirm(`Загрузить копию: ${data.products.length} товаров, ${(data.orders || []).length} заказов? Текущие данные будут заменены.`)) return;
          call('/api/admin/import', { db: data }, 'Резервная копия загружена').then(render).catch(() => {});
        } catch (err) { toast('Файл не похож на резервную копию Nargizka Shop', 'error'); }
      };
      reader.readAsText(t.files[0]);
      t.value = '';
    }
    if (t.closest('#flashForm')) renderFlashPreview();
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('[data-fin="q"]')) {
      ui.finance.q = e.target.value;
      clearTimeout(finSearchTimer);
      finSearchTimer = setTimeout(() => {
        ui.finance._keepFocus = true;
        if (current === 'finance') viewFinance();
      }, 280);
      return;
    }
    const t = e.target;
    if (t.matches('input[data-pf="q"]')) { ui.products.q = t.value; renderProductsTable(); }
    else if (t.matches('[data-mq]')) {
      ui.products.mq = t.value;
      clearTimeout(finSearchTimer);
      finSearchTimer = setTimeout(() => { viewProducts(); const i = $('#movesSearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300);
    }
    else if (t.matches('[data-oq]')) { ui.orders.q = t.value; renderOrdersTable(); }
    else if (t.closest('#flashForm')) renderFlashPreview();
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.id === 'loginForm' || form.id === 'pForm') return;
    e.preventDefault();
    const f = form.elements;
    const s = NS.settings;
    const byCat = (cat) => NS.products().filter((p) => !cat || p.category === cat);
    switch (form.id) {
      case 'flashForm': {
        const data = readFlashForm();
        if (data.active && data.endsAt <= Date.now()) return toast('Дата окончания акции уже прошла', 'error');
        s.flash = data;
        save(data.active ? `Акция «${esc(data.title)}» −${data.percent}% запущена` : 'Акция выключена');
        break;
      }
      case 'tiersForm': {
        const rows = $$('.tier-row', form).map((r) => ({ from: Math.round(+r.querySelector('[name="tierFrom"]').value || 0), percent: Math.round(+r.querySelector('[name="tierPct"]').value || 0) }));
        if (rows.some((r) => !(r.from > 0) || !(r.percent > 0 && r.percent <= 50))) return toast('Заполните сумму и скидку (1–50%) в каждой строке', 'error');
        s.autoDiscounts = rows.sort((a, b) => a.from - b.from);
        save(rows.length ? 'Скидки от суммы заказа сохранены' : 'Скидки от суммы отключены');
        break;
      }
      case 'massForm': {
        const pct = Math.round(+f.pct.value);
        if (!(pct > 0 && pct <= 90)) return toast('Скидка должна быть от 1 до 90%', 'error');
        const list = byCat(f.cat.value);
        list.forEach((p) => { p.discount = pct; });
        save(`Скидка −${pct}% применена к ${list.length} товарам`);
        break;
      }
      case 'priceForm': {
        const pct = +f.pct.value;
        if (!pct || pct <= -90 || pct > 500) return toast('Укажите изменение в %: например 10 или −15', 'error');
        const list = byCat(f.cat.value);
        if (!confirm(`${pct > 0 ? 'Поднять' : 'Снизить'} цены ${list.length} товаров на ${Math.abs(pct)}%?`)) return;
        list.forEach((p) => { p.price = roundPrice(p.price * (1 + pct / 100)); });
        save(`Цены ${list.length} товаров изменены на ${pct > 0 ? '+' : ''}${pct}%`);
        break;
      }
      case 'annForm': {
        s.announcements = f.lines.value.split('\n').map((l) => l.trim()).filter(Boolean);
        save('Бегущая строка обновлена');
        break;
      }
      case 'heroForm': {
        s.hero = { kicker: f.kicker.value.trim(), title: f.title.value.trim(), subtitle: f.subtitle.value.trim() };
        save('Баннер обновлён');
        break;
      }
      case 'promoForm': {
        const idx = f.idx.value === '' ? -1 : +f.idx.value;
        const code = f.code.value.trim().toUpperCase().replace(/\s+/g, '');
        const type = f.type.value === 'fixed' ? 'fixed' : 'percent';
        const value = Math.round(+f.value.value);
        if (!/^[A-Z0-9А-ЯЁ_-]{3,20}$/.test(code)) return toast('Код: 3–20 символов, буквы и цифры', 'error');
        if (type === 'percent' && !(value > 0 && value <= 90)) return toast('Скидка в процентах — от 1 до 90', 'error');
        if (type === 'fixed' && !(value >= 1000)) return toast('Фиксированная скидка — от 1 000 сум', 'error');
        if (s.promoCodes.some((c, i) => c.code === code && i !== idx)) return toast('Такой промокод уже существует', 'error');
        const expires = f.expires.value ? new Date(f.expires.value + 'T23:59:59').getTime() : 0;
        if (expires && expires < Date.now()) return toast('Дата окончания уже прошла', 'error');
        const prev = idx >= 0 ? s.promoCodes[idx] : null;
        const next = {
          code, type, value, minSum: Math.max(0, Math.round(+f.min.value || 0)),
          active: prev ? prev.active : true, expiresAt: expires, limit: Math.max(0, Math.round(+f.limit.value || 0)), used: prev ? prev.used || 0 : 0,
        };
        if (prev) {
          if (s.welcomeCode === prev.code) s.welcomeCode = code;
          s.promoCodes[idx] = next;
        } else s.promoCodes.push(next);
        save(`Промокод ${esc(code)} ${prev ? 'обновлён' : 'создан'}`);
        break;
      }
      case 'welcomeForm': {
        s.welcomeCode = f.code.value;
        save(s.welcomeCode ? `Приветственный промокод: ${esc(s.welcomeCode)}` : 'Приветственный промокод отключён');
        break;
      }
      case 'catsForm': {
        const names = $$('[name="catName"]', form).map((i) => i.value.trim());
        if (names.some((n) => n.length < 2)) return toast('Название категории — от 2 символов', 'error');
        names.forEach((n, i) => { s.categories[i].name = n; });
        save('Категории сохранены');
        break;
      }
      case 'catAddForm': {
        const name = f.name.value.trim();
        if (name.length < 2) return toast('Введите название категории', 'error');
        if (s.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('Такая категория уже есть', 'error');
        s.categories.push({ id: 'c' + Date.now().toString(36), name });
        save(`Категория «${esc(name)}» добавлена`);
        break;
      }
      case 'colorsForm': {
        const rows = $('.color-edit__row', form);
        const next = {};
        const renames = [];
        for (const row of rows) {
          const old = row.querySelector('[data-color-hex]').dataset.colorHex;
          const hex = row.querySelector('[data-color-hex]').value;
          const name = (row.querySelector('[data-color-name]') || {}).value;
          const nm = String(name || '').trim();
          if (nm.length < 2) return toast('Название цвета — от 2 символов', 'error');
          if (Object.keys(next).some((k) => k.toLowerCase() === nm.toLowerCase())) return toast('Два цвета с одинаковым названием', 'error');
          next[nm] = hex;
          if (nm !== old) renames.push([old, nm]);
        }
        if (!Object.keys(next).length) return toast('Должен остаться хотя бы один цвет', 'error');
        renames.forEach(([old, nm]) => {
          NS.products().forEach((p) => {
            p.colors = (p.colors || []).map((c) => (c === old ? nm : c));
          });
        });
        s.colors = next;
        save('Цвета сохранены');
        break;
      }
      case 'colorAddForm': {
        const name = f.name.value.trim();
        if (name.length < 2) return toast('Введите название цвета', 'error');
        if (Object.keys(s.colors).some((c) => c.toLowerCase() === name.toLowerCase())) return toast('Такой цвет уже есть', 'error');
        s.colors[name] = f.hex.value;
        save(`Цвет «${esc(name)}» добавлен`);
        break;
      }
      case 'sizesForm': {
        const inputs = $$('[name="sizeName"]', form);
        const names = inputs.map((i) => i.value.trim());
        if (names.some((n) => !n || n.length > 12)) return toast('Размер: 1–12 символов', 'error');
        const lower = names.map((n) => n.toLowerCase());
        if (new Set(lower).size !== lower.length) return toast('Размеры не должны повторяться', 'error');
        const oldSizes = (s.sizes || []).slice();
        names.forEach((n, i) => {
          const old = oldSizes[i];
          if (old && old !== n) {
            NS.products().forEach((p) => {
              if (!p.stock) p.stock = {};
              if (old in p.stock) {
                p.stock[n] = p.stock[old];
                delete p.stock[old];
              }
            });
          }
        });
        s.sizes = names;
        save('Размеры сохранены');
        break;
      }
      case 'sizeAddForm': {
        const name = f.name.value.trim();
        if (!name || name.length > 12) return toast('Введите размер (до 12 символов)', 'error');
        if (!s.sizes) s.sizes = [];
        if (s.sizes.some((x) => x.toLowerCase() === name.toLowerCase())) return toast('Такой размер уже есть', 'error');
        s.sizes.push(name);
        NS.products().forEach((p) => { if (!p.stock) p.stock = {}; if (!(name in p.stock)) p.stock[name] = 0; });
        save('Размер «' + esc(name) + '» добавлен');
        break;
      }
      case 'currencyForm': {
        const rate = Math.round(+f.rate.value);
        if (!(rate > 0)) return toast('Укажите курс больше нуля', 'error');
        s.usdRate = rate;
        s.defaultCurrency = f.def.value === 'USD' ? 'USD' : 'UZS';
        save(`Курс сохранён: 1 $ = ${money(rate)}`);
        break;
      }
      case 'shipForm': {
        s.shippingCost = Math.max(0, Math.round(+f.cost.value || 0));
        s.freeShippingFrom = Math.max(0, Math.round(+f.free.value || 0));
        s.expressCost = Math.max(0, Math.round(+f.express.value || 0));
        s.returnDays = Math.min(60, Math.max(0, Math.round(+f.returnDays.value || 0)));
        s.pickupEnabled = f.pickup.checked;
        save('Условия доставки и возврата сохранены');
        break;
      }
      case 'payForm': {
        const next = {};
        Object.keys(NS.PAYMENTS).forEach((k) => { next[k] = f[k].checked; });
        if (!Object.values(next).some(Boolean)) return toast('Оставьте хотя бы один способ оплаты', 'error');
        s.payments = next;
        save('Способы оплаты сохранены');
        break;
      }
      case 'brandForm': {
        s.brand = Object.assign({}, NS.brand(), {
          name: f.name.value.trim() || 'Магазин',
          short: f.short.value.trim() || f.name.value.trim(),
          tagline: f.tagline.value.trim(),
          logoUrl: f.logoUrl.value.trim(),
          accent: f.accentDefault.checked ? '' : f.accent.value,
          dark: f.darkDefault.checked ? '' : f.dark.value,
          city: f.city.value.trim(),
          workHours: f.workHours.value.trim(),
          whatsapp: f.whatsapp.value.trim(),
          facebook: f.facebook.value.trim(),
          tiktok: f.tiktok.value.trim(),
          youtube: f.youtube.value.trim(),
          mapUrl: f.mapUrl.value.trim(),
        });
        save('Бренд сохранён — сайт обновится у покупателей автоматически').then(applyAdminBrand);
        break;
      }
      case 'contactsForm': {
        ['phone', 'email', 'address', 'instagram', 'telegram'].forEach((k) => { s.contacts[k] = f[k].value.trim(); });
        save('Контакты сохранены');
        break;
      }
      case 'storeSaleForm': {
        const items = [];
        for (const row of $$('.sale-line', form)) {
          const id = $('[data-sl="product"]', row).value;
          const v = $('[data-sl="variant"]', row).value;
          if (!id || !v) return toast('Выберите товар, цвет и размер в каждой строке', 'error');
          const [color, size] = NS.splitKey(v);
          const price = Math.max(0, Math.round(+$('[data-sl="price"]', row).value || 0));
          if (!(price > 0)) return toast('Укажите цену в каждой строке', 'error');
          items.push({ id, color, size, qty: Math.max(1, Math.round(+$('[data-sl="qty"]', row).value || 1)), price });
        }
        const channel = form.dataset.channel || 'store';
        if (channel === 'phone' && f.customerPhone.value.replace(/\D/g, '').length < 9) return toast('Для заказа по телефону укажите номер клиента', 'error');
        call('/api/admin/store-sale', {
          items, channel,
          payment: f.payment.value,
          paid: f.paid.checked,
          status: channel === 'phone' ? f.status.value : undefined,
          discount: Math.max(0, Math.round(+f.discount.value || 0)),
          shipping: channel === 'phone' ? Math.max(0, Math.round(+f.shipping.value || 0)) : 0,
          customerName: f.customerName.value.trim(),
          customerPhone: f.customerPhone.value.trim(),
          address: f.address.value.trim(),
          note: f.note.value.trim(),
        }, channel === 'store' ? 'Продажа записана, товар списан со склада' : 'Заказ создан, товар зарезервирован')
          .then(() => { closeModal(); render(); })
          .catch(() => {});
        break;
      }
      case 'stockMoveForm': {
        const mode = form.dataset.mode || 'in';
        const productId = f.productId.value;
        const lines = $$('[data-mv]', form).filter((i) => i.value !== '').map((i) => {
          const [color, size] = NS.splitKey(i.dataset.mv);
          return { productId, color, size, qty: Math.max(0, Math.round(+i.value || 0)) };
        }).filter((l) => mode === 'set' ? NS.variantStock(NS.product(productId), l.color, l.size) !== l.qty : l.qty > 0);
        if (!lines.length) return toast(mode === 'set' ? 'Остатки не изменились' : 'Впишите количество хотя бы для одного размера', 'error');
        const reason = f.reason.value.trim();
        if (mode !== 'in' && reason.length < 3) { f.reason.focus(); return toast('Укажите причину — она сохранится в журнале склада', 'error'); }
        const qty = lines.reduce((a, l) => a + l.qty, 0);
        if (mode === 'out' && !confirm(`Списать ${qty} шт. со склада? Причина: ${reason}`)) return;
        const unitCost = mode === 'in' ? Math.max(0, Math.round(+f.unitCost.value || 0)) : null;
        call('/api/admin/stock-move', {
          mode, lines, reason, unitCost,
          recordExpense: mode === 'in' ? f.recordExpense.checked : false,
        }, mode === 'in' ? `Поступление записано: +${qty} шт.${unitCost && f.recordExpense.checked ? ', оплата поставщику — в расходах' : ''}` : mode === 'out' ? `Списано ${qty} шт.` : 'Остатки пересчитаны')
          .then(() => { closeModal(); render(); })
          .catch(() => {});
        break;
      }
      case 'finEntryForm': {
        const type = form.dataset.finType === 'in' ? 'in' : 'out';
        const f = form.elements;
        const amount = Math.round(+f.amount.value || 0);
        if (!(amount > 0)) return toast('Укажите сумму больше нуля', 'error');
        const dateStr = f.date.value;
        const date = dateStr ? new Date(dateStr + 'T12:00:00').getTime() : Date.now();
        const entry = {
          id: form.dataset.finId || NS.newId('f'),
          date,
          type,
          category: f.category.value,
          amount,
          note: f.note.value.trim(),
          createdAt: Date.now(),
        };
        call('/api/admin/finance', { entry }, (type === 'in' ? 'Приход' : 'Расход') + ' добавлен')
          .then(() => { closeModal(); viewFinance(); })
          .catch(() => {});
        break;
      }
      case 'notifyForm': {
        const f = form.elements;
        const payload = {
          email: {
            enabled: f.emailOn.checked,
            host: f.host.value.trim(),
            port: +f.port.value || 465,
            secure: true,
            user: f.user.value.trim(),
            pass: f.pass.value || '********',
            from: f.from.value.trim(),
          },
          sms: {
            enabled: f.smsOn.checked,
            email: f.smsEmail.value.trim(),
            password: f.smsPass.value || '********',
            from: f.smsFrom.value.trim() || '4546',
          },
          telegram: {
            enabled: f.tgOn.checked,
            botToken: f.tgToken.value.trim() || (notifyCache && notifyCache.notify && notifyCache.notify.public.telegram.hasToken ? '••••keep' : ''),
            chatId: f.tgChat.value.trim(),
          },
        };
        NS.api('/api/admin/notify', { notify: payload }).then((d) => {
          fillNotifyForm(d);
          toast('Настройки почты и SMS сохранены');
        }).catch((e) => toast(esc(e.message), 'error'));
        break;
      }
      case 'passForm': {
        if (f.p1.value.length < 8) return toast('Пароль должен быть не короче 8 символов', 'error');
        if (f.p1.value !== f.p2.value) return toast('Пароли не совпадают', 'error');
        NS.api('/api/admin/password', { password: f.p1.value })
          .then((r) => {
            // после смены пароля старые сессии закрываются — сохраняем новый токен
            if (r && r.token) { NS.token = r.token; localStorage.setItem(TOKEN_KEY, r.token); }
            defaultPassword = false; updateWarn(); form.reset(); toast('Пароль изменён');
          })
          .catch(onError);
        break;
      }
      default:
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', () => { if (!$('#admin').hidden) go(location.hash.slice(2)); });

  // Новые заказы с сайта подтягиваются автоматически.
  NS.watch(() => {
    if ($('#admin').hidden || draft || !NS.token) return;
    const before = NS.db.orders.length;
    NS.loadAdmin().then((db) => {
      if (db.orders.length > before) toast(`Новый заказ: ${esc(db.orders[0].id)}`);
      if (!draft) render();
    }).catch((err) => { if (err.status === 401) logout(true); });
  }, 15000);

  NS.token = localStorage.getItem(TOKEN_KEY);
  if (NS.token) {
    NS.api('/api/admin/db')
      .then((d) => { NS.apply(d); NS.snapshot(); afterServer(d); showAdmin(); })
      .catch(() => { NS.token = null; localStorage.removeItem(TOKEN_KEY); });
  }
})();
