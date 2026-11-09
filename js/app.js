/* Nargizka Shop — витрина */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const t = (k, v) => I18N.t(k, v);
  const catName = (id) => I18N.cat(id);
  function applyStaticI18n() {
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.title = t('meta.title');
    const meta = document.querySelector('meta[name=description]');
    if (meta) meta.setAttribute('content', t('meta.desc'));
    const ph = $('#searchInput');
    if (ph) ph.placeholder = t('search.ph');
  }

  const LS = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  };

  let cart = LS.get('ns_cart', []);
  let wish = LS.get('ns_wish', []);
  let recent = LS.get('ns_recent', []);
  let promo = LS.get('ns_promo', '');
  let promoObj = LS.get('ns_promo_obj', null);
  let catState = null;
  let refreshCheckout = null;

  const ICONS = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9-9.2C1.7 7.3 4 4 7.4 4c2 0 3.4 1.1 4.6 2.6C13.2 5.1 14.6 4 16.6 4 20 4 22.3 7.3 21 10.8 19 15.6 12 20 12 20z"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    ret: '<svg viewBox="0 0 24 24"><path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M8 5L4 9l4 4"/></svg>',
    gem: '<svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M9 3l3 18 3-18"/></svg>',
    hanger: '<svg viewBox="0 0 24 24"><path d="M12 7a2 2 0 1 1 2-2c0 1.2-2 1.6-2 3v1l9 6.5a1 1 0 0 1-.6 1.8H3.6a1 1 0 0 1-.6-1.8L12 9"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  };

  /* ---------- общие ---------- */
  function toast(html, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    el.innerHTML = html;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = '.3s'; el.style.opacity = '0'; }, 3200);
    setTimeout(() => el.remove(), 3600);
  }
  function bump(sel) {
    const el = $(sel);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function paymentList() {
    const on = NS.settings.payments || {};
    return Object.keys(NS.PAYMENTS).filter((k) => on[k]);
  }
  function returnText() {
    const n = +NS.settings.returnDays || 0;
    if (I18N.lang === 'uz') return `${n} kun`;
    return `${n} ${plural(n, 'дня', 'дней', 'дней')}`;
  }
  /* тексты главного баннера: из админки (Скидки и акции → Главный баннер) для русской версии */
  function heroText() {
    const h = (NS.settings && NS.settings.hero) || {};
    if (I18N.lang === 'ru' && (h.title || h.subtitle || h.kicker)) {
      const lines = String(h.title || '').split('\n').map((x) => x.trim()).filter(Boolean);
      return { kicker: h.kicker || '', t1: lines[0] || '', t2: lines.slice(1).join(' '), sub: h.subtitle || '' };
    }
    return { kicker: t('hero.kicker'), t1: t('hero.title1'), t2: t('hero.title2'), sub: t('hero.sub') };
  }
  function stars(r) {
    const full = Math.round(r);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }
  function timerHTML(end, small) {
    return `<div class="timer ${small ? 'timer--small' : ''}" data-timer="${end}">
      ${[t('timer.d'), t('timer.h'), t('timer.m'), t('timer.s')].map((u) => `<div class="timer__cell"><b>00</b><span>${u}</span></div>`).join('')}
    </div>`;
  }
  function tickTimers() {
    $$('[data-timer]').forEach((t) => {
      let left = Math.max(0, +t.dataset.timer - Date.now());
      const parts = [86400000, 3600000, 60000, 1000].map((ms) => { const v = Math.floor(left / ms); left -= v * ms; return v; });
      $$('b', t).forEach((b, i) => { b.textContent = String(parts[i]).padStart(2, '0'); });
    });
  }
  setInterval(tickTimers, 1000);

  /* ---------- корзина и избранное ---------- */
  function cartLines() {
    return cart.map((l) => ({ ...l, p: NS.product(l.id) })).filter((l) => l.p && l.p.visible);
  }
  function cartCount() { return cartLines().reduce((s, l) => s + l.qty, 0); }

  function totals(delivery) {
    const valid = promo && promoObj && promoObj.code === promo ? promoObj : null;
    const t = NS.quote(cartLines(), valid, delivery);
    if (promo && !valid) t.promoError = 'Промокод не найден или больше не действует';
    return t;
  }
  function clearPromo() {
    promo = ''; promoObj = null;
    LS.set('ns_promo', ''); LS.set('ns_promo_obj', null);
  }

  function refreshPage() {
    if (!refreshCheckout) return;
    if (cartLines().length) refreshCheckout(); else route(true);
  }

  function saveCart() {
    LS.set('ns_cart', cart);
    updateCounts();
    renderCart();
    refreshPage();
  }

  function addToCart(id, color, size, qty) {
    qty = qty || 1;
    const p = NS.product(id);
    if (!p) return false;
    const avail = NS.variantStock(p, color, size);
    const key = id + '|' + color + '|' + size;
    const line = cart.find((l) => l.key === key);
    const inCart = line ? line.qty : 0;
    if (inCart + qty > avail) {
      toast(avail ? `В наличии только ${avail} шт. (${[color, size].filter(Boolean).join(', ')})` : 'Этого размера в выбранном цвете сейчас нет', 'error');
      return false;
    }
    if (line) line.qty += qty; else cart.push({ key, id, color, size, qty });
    saveCart();
    bump('#cartCount');
    toast(`<img src="${NS.image(p, Math.max(0, p.colors.indexOf(color)))}" alt=""><div>${esc(p.name)} · ${size}<br>добавлено в корзину <a href="#" data-open-cart>Открыть</a></div>`);
    return true;
  }

  function applyPromo(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) return;
    NS.api('/api/promo', { code }).then((r) => {
      promo = r.promo.code; promoObj = r.promo;
      LS.set('ns_promo', promo); LS.set('ns_promo_obj', promoObj);
      renderCart();
      refreshPage();
      const t = totals();
      if (t.code) toast(`Промокод ${esc(t.code.code)} применён: ${NS.promoLabel(t.code)}`);
      else if (t.promoError) toast(esc(t.promoError), 'error');
    }).catch((e) => toast(esc(e.message), 'error'));
  }

  function toggleWish(id) {
    const on = !wish.includes(id);
    wish = on ? [id, ...wish] : wish.filter((x) => x !== id);
    LS.set('ns_wish', wish);
    updateCounts();
    bump('#wishCount');
    $$(`[data-wish="${id}"]`).forEach((b) => b.classList.toggle('is-wished', on));
    toast(on ? 'Добавлено в избранное <a href="#/wishlist">Смотреть</a>' : 'Удалено из избранного');
    if (location.hash.startsWith('#/wishlist')) renderWishlist();
  }

  function updateCounts() {
    $('#cartCount').textContent = cartCount() || '';
    $('#wishCount').textContent = wish.filter((id) => NS.product(id)).length || '';
  }

  function renderCart() {
    const tot = totals();
    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!tot.lines.length) {
      body.innerHTML = `<div class="empty"><h3>${t('cart.empty')}</h3><p>${t('cart.emptyHint')}</p>
        <a href="#/catalog" class="btn btn--dark" data-close>${t('cart.toCatalog')}</a></div>`;
      foot.innerHTML = '';
      return;
    }
    const freeFrom = NS.settings.freeShippingFrom;
    const pct = freeFrom > 0 ? Math.min(100, ((freeFrom - tot.toFree) / freeFrom) * 100) : 100;
    body.innerHTML = `
      <div class="ship-bar">${tot.toFree > 0
        ? `До бесплатной доставки осталось <b>${NS.money(tot.toFree)}</b>`
        : '<b>Поздравляем!</b> Доставка будет бесплатной'}
        <div class="ship-bar__track"><i style="width:${pct}%"></i></div>
      </div>
      ${tot.nextTier ? `<div class="tier-hint">Добавьте товаров ещё на <b>${NS.money(tot.toNext)}</b> — получите скидку <b>−${tot.nextTier.percent}%</b> на весь заказ</div>` : ''}
      ${tot.tier ? `<div class="tier-hint tier-hint--on">Ваша скидка от суммы заказа: <b>−${tot.tier.percent}%</b></div>` : ''}
      ${tot.lines.map(lineItemHTML).join('')}`;
    foot.innerHTML = `
      ${promoBlockHTML(tot)}
      ${totalsHTML(tot, 'Итого')}
      <div class="foot-actions">
        <a href="#/checkout" class="btn btn--dark btn--block" data-close>${t('cart.checkout')}</a>
        <button class="btn btn--outline btn--block" data-close>${t('cart.continue')}</button>
      </div>`;
  }

  function totalsHTML(t, label) {
    return `<div class="totals">
      <div><span>Товары</span><span>${NS.money(t.original)}</span></div>
      ${t.saleSaving ? `<div class="is-discount"><span>Скидка на товары</span><span>−${NS.money(t.saleSaving)}</span></div>` : ''}
      ${t.autoDiscount ? `<div class="is-discount"><span>Скидка от суммы заказа −${t.tier.percent}%</span><span>−${NS.money(t.autoDiscount)}</span></div>` : ''}
      ${t.promoDiscount ? `<div class="is-discount"><span>Промокод ${esc(t.code.code)}</span><span>−${NS.money(t.promoDiscount)}</span></div>` : ''}
      <div><span>Доставка</span><span>${t.shipping ? NS.money(t.shipping) : 'Бесплатно'}</span></div>
      <div class="total"><span>${label}</span><span>${NS.money(t.total)}</span></div>
    </div>`;
  }

  function lineItemHTML(l) {
    const p = l.p, d = NS.discountOf(p);
    return `<div class="line-item">
      <a href="#/product/${p.id}" data-close><img src="${NS.image(p, Math.max(0, p.colors.indexOf(l.color)))}" alt=""></a>
      <div>
        <div class="line-item__top">
          <a href="#/product/${p.id}" class="line-item__name" data-close>${esc(p.name)}</a>
          <button class="remove" data-remove="${esc(l.key)}">Удалить</button>
        </div>
        <div class="line-item__meta">${esc(l.color)} · Размер ${l.size}</div>
        <div class="line-item__bottom">
          <div class="qty qty--sm">
            <button data-line="${esc(l.key)}" data-step="-1" aria-label="Меньше">−</button>
            <input value="${l.qty}" readonly aria-label="Количество">
            <button data-line="${esc(l.key)}" data-step="1" aria-label="Больше">+</button>
          </div>
          <div class="price">
            <span class="price__now ${d ? 'is-sale' : ''}">${NS.money(NS.finalPrice(p) * l.qty)}</span>
            ${d ? `<s>${NS.money(p.price * l.qty)}</s>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }

  function promoBlockHTML(t) {
    if (t.code) {
      return `<div class="promo-applied"><span>Промокод <b>${esc(t.code.code)}</b> применён: ${NS.promoLabel(t.code)}</span>
        <button type="button" class="remove" data-promo-remove>Убрать</button></div>`;
    }
    return `<div class="promo-form">
        <input class="input" data-promo-input placeholder="Промокод" value="${esc(promo)}" aria-label="Промокод">
        <button class="btn btn--outline" type="button" data-promo-apply>Применить</button>
      </div>
      ${t.promoError ? `<p class="save-note" style="margin:-6px 0 12px">${esc(t.promoError)}</p>` : ''}`;
  }

  /* ---------- панели ---------- */
  function openPanel(el) {
    closeAll();
    el.classList.add('is-open');
    $('#overlay').classList.add('is-on');
    document.body.classList.add('lock');
  }
  function closeAll() {
    $$('.drawer.is-open, .modal.is-open, .search.is-open, .filters.is-open').forEach((el) => el.classList.remove('is-open'));
    $('#overlay').classList.remove('is-on');
    document.body.classList.remove('lock');
  }
  function openModal(html) {
    $('#modalContent').innerHTML = html;
    openPanel($('#modal'));
  }

  /* ---------- карточка товара ---------- */
  function priceHTML(p) {
    const d = NS.discountOf(p);
    return d
      ? `<div class="price"><span class="price__now is-sale">${NS.money(NS.finalPrice(p))}</span><s>${NS.money(p.price)}</s><span class="price__off">−${d}%</span></div>`
      : `<div class="price"><span class="price__now">${NS.money(p.price)}</span></div>`;
  }

  function card(p) {
    const d = NS.discountOf(p);
    const stock = NS.totalStock(p);
    const flash = NS.inFlash(p) && +NS.settings.flash.percent >= (+p.discount || 0);
    const badges = [];
    if (!stock) badges.push(`<span class="badge badge--out">${t('card.out')}</span>`);
    if (d) badges.push(`<span class="badge ${flash ? 'badge--flash' : 'badge--sale'}">−${d}%${flash ? ' · Sale' : ''}</span>`);
    if (p.isNew) badges.push(`<span class="badge">${t('card.new')}</span>`);
    if (p.isHit) badges.push(`<span class="badge badge--hit">${t('card.hit')}</span>`);
    const hasAlt = p.colors.length > 1 || (p.images || []).length > 1;
    return `<article class="card fade-in">
      <div class="card__top">
        <a href="#/product/${p.id}" class="card__media" data-cursor="${t('card.view')}">
          <img class="card__img" src="${NS.image(p, 0)}" alt="${esc(p.name)}" loading="lazy">
          ${hasAlt ? `<img class="card__img card__img--alt" src="${NS.image(p, 1)}" alt="" loading="lazy">` : ''}
          <div class="badges">${badges.join('')}</div>
        </a>
        <button class="card__wish ${wish.includes(p.id) ? 'is-wished' : ''}" data-wish="${p.id}" aria-label="${t('card.wish')}">${ICONS.heart}</button>
        ${stock ? `<div class="card__quick"><p>${t('card.quick')}</p><div class="card__sizes">
          ${NS.SIZES.filter((s) => s in p.stock).map((s) => `<button data-quick="${p.id}" data-size="${s}" ${+p.stock[s] ? '' : 'disabled'}>${s}</button>`).join('')}
        </div></div>` : ''}
      </div>
      <div class="card__body">
        <div class="swatches">${p.colors.map((c) => `<span class="swatch" style="background:${NS.colorHex(c)}" title="${esc(c)}"></span>`).join('')}</div>
        <a href="#/product/${p.id}" class="card__title">${esc(p.name)}</a>
        <div class="card__cat">${catName(p.category)} · ${esc(p.fabric)}</div>
        ${priceHTML(p)}
      </div>
    </article>`;
  }

  function railSection(kicker, title, id, list, link, paper) {
    return `<section class="section ${paper ? 'section--paper' : ''}"><div class="container">
      <div class="section__head">
        <div><div class="section__kicker">${kicker}</div><h2 class="section__title">${title}</h2></div>
        <div class="rail-nav">
          ${link ? `<a href="${link}" class="btn btn--outline" style="height:44px">${t('btn.seeAll')}</a>` : ''}
          <button data-rail="${id}" data-dir="-1" aria-label="Назад">${ICONS.left}</button>
          <button data-rail="${id}" data-dir="1" aria-label="Вперёд">${ICONS.right}</button>
        </div>
      </div>
      <div class="rail" id="${id}">${list.map(card).join('')}</div>
    </div></section>`;
  }

  /* ---------- главная ---------- */
  function renderHome() {
    const s = NS.settings;
    const all = NS.visibleProducts();
    const pickCat = (c) => all.find((p) => p.category === c) || all[0];
    const heroImgs = [pickCat('cocktail'), pickCat('evening'), pickCat('maxi')].filter(Boolean).map((p, i) => NS.image(p, i));
    const sale = all.filter((p) => NS.discountOf(p) > 0 && NS.totalStock(p)).sort((a, b) => NS.discountOf(b) - NS.discountOf(a)).slice(0, 12);
    const news = all.filter((p) => p.isNew).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    const hits = all.slice().sort((a, b) => b.sold - a.sold).slice(0, 12);
    const bridal = all.filter((p) => p.category === 'wedding').slice(0, 2);
    const maxSale = sale.length ? NS.discountOf(sale[0]) : 0;
    const welcome = NS.findPromo(s.welcomeCode);
    const f = s.flash;

    app.innerHTML = `
      <section class="hero">
        <div class="hero__glow"></div>
        <div class="grain"></div>
        <div class="container hero__inner">
          <div class="hero__copy">
            <div class="hero__kicker"><span>${esc(heroText().kicker)}</span></div>
            <h1 class="hero__title"><span class="hero__line"><span>${esc(heroText().t1)}</span></span>${heroText().t2 ? `<span class="hero__line"><span>${esc(heroText().t2)}</span></span>` : ''}</h1>
            <p class="hero__sub">${esc(heroText().sub)}</p>
            <div class="hero__ctas">
              <a href="#/catalog?sort=new" class="btn btn--light">${t('btn.viewCollection')}</a>
              ${maxSale ? `<a href="#/catalog?sale=1" class="btn btn--gold">${t('btn.saleTo', { n: maxSale })}</a>` : ''}
            </div>
          </div>
          <div class="hero__art">${heroImgs.map((src) => `<div class="hero__frame"><img src="${src}" alt=""></div>`).join('')}</div>
        </div>
        <div class="hero__scroll"><span>Scroll</span><i></i></div>
      </section>

      ${NS.flashActive() ? `
      <section class="flash">
        <div class="container flash__inner">
          <div>
            <div class="flash__title">${esc(f.title)}: <b>−${f.percent}%</b></div>
            <div class="flash__sub">${f.categories.length ? t('flash.onCats') + ' ' + f.categories.map((c) => catName(c)).join(', ') : t('flash.onAll')} · ${t('flash.until')}</div>
          </div>
          ${timerHTML(f.endsAt)}
          <a href="#/catalog?sale=1" class="btn btn--light">${t('btn.buyNow')}</a>
        </div>
      </section>` : ''}

      <div class="marquee" aria-hidden="true"><div class="marquee__track">
        ${[0, 1].map(() => `<div class="marquee__group">${[NS.brand().short, 'Maison de Robes', 'Haute Couture', 'Evening', 'Bridal', 'Cocktail'].map((w) => `<span>${w}</span><i>✦</i>`).join('')}</div>`).join('')}
      </div></div>

      <section class="manifesto"><div class="container manifesto__inner">
        <div class="section__kicker">${t('home.manifestoKicker')}</div>
        <p class="manifesto__text">${t('home.manifesto')}</p>
        <div class="stats">
          ${all.length ? `<div><b data-count="${all.length}">${all.length}</b><span>${t('home.statModels')}</span></div>` : ''}
          <div><b data-count="${NS.CATEGORIES.length}">${NS.CATEGORIES.length}</b><span>${t('home.statCats')}</span></div>
          <div><b data-count="${Object.keys(NS.COLORS).length}">${Object.keys(NS.COLORS).length}</b><span>${t('home.statColors')}</span></div>
          <div><b data-count="${+s.returnDays}">${+s.returnDays}</b><span>${t('home.statDays')}</span></div>
        </div>
      </div></section>

      <section class="collections" ${all.length ? '' : 'hidden'}>
        <div class="container section__head">
          <div><div class="section__kicker">${t('home.collections')}</div><h2 class="section__title">${t('home.chooseLook')}</h2></div>
          <a href="#/catalog" class="btn btn--outline" style="height:44px">${t('btn.allDresses')}</a>
        </div>
        <div class="collections__viewport"><div class="collections__track">
          ${NS.CATEGORIES.map((c) => all.filter((p) => p.category === c.id)).filter((l) => l.length).map((list, i) => {
            const c = NS.CATEGORIES.find((x) => x.id === list[0].category);
            return `<a href="#/catalog?cat=${c.id}" class="coll" data-cursor="${t('card.view')}">
              <div class="coll__media"><img src="${NS.image(list[0], 0)}" alt="${catName(c.id)}" loading="lazy"></div>
              <div class="coll__meta"><span class="coll__num">${String(i + 1).padStart(2, '0')}</span><b>${catName(c.id)}</b><span>${list.length} ${I18N.modelWord(list.length)}</span></div>
            </a>`;
          }).join('')}
        </div></div>
      </section>

      ${sale.length ? railSection(t('home.special'), t('home.weekSale'), 'railSale', sale, '#/catalog?sale=1', true) : ''}

      ${bridal.length ? `
      <section class="section"><div class="container">
        <div class="split">
          <a href="#/catalog?cat=wedding" class="split__media" data-cursor="Bridal">${bridal.map((p) => `<div class="split__frame"><img src="${NS.image(p, 0)}" alt=""></div>`).join('')}</a>
          <div class="split__text">
            <div class="section__kicker">${t('home.bridalKicker')}</div>
            <h2>${t('home.bridalTitle')}</h2>
            <p>${t('home.bridalText')}</p>
            <a href="#/catalog?cat=wedding" class="btn btn--gold">${t('btn.openCollection')}</a>
          </div>
        </div>
      </div></section>` : ''}

      ${news.length ? `
      <section class="section section--paper"><div class="container">
        <div class="section__head">
          <div><div class="section__kicker">${t('home.justIn')}</div><h2 class="section__title">${t('home.seasonNew')}</h2></div>
          <a href="#/catalog?sort=new" class="btn btn--outline" style="height:44px">${t('btn.allNew')}</a>
        </div>
        <div class="grid">${news.map(card).join('')}</div>
      </div></section>` : ''}

      ${hits.length ? railSection(t('home.buyersChoice'), t('home.bestsellers'), 'railHits', hits, '#/catalog?sort=popular') : ''}

      <section class="section section--tight section--paper"><div class="container perks">
        <div class="perk">${ICONS.truck}<div><b>${t('home.perkShip')}</b><span>${t('home.perkShipSub', { sum: NS.money(s.freeShippingFrom) })}</span></div></div>
        <div class="perk">${ICONS.hanger}<div><b>${t('home.perkFit')}</b><span>${t('home.perkFitSub')}</span></div></div>
        <div class="perk">${ICONS.ret}<div><b>${t('home.perkRet', { days: returnText() })}</b><span>${t('home.perkRetSub')}</span></div></div>
        <div class="perk">${ICONS.gem}<div><b>${t('home.perkQual')}</b><span>${t('home.perkQualSub')}</span></div></div>
      </div></section>

      <section class="newsletter">
        <div class="section__kicker">${t('home.club')}</div>
        <h2>${welcome ? NS.promoLabel(welcome) + ' на первый заказ' : 'Будьте в курсе новинок'}</h2>
        <p>${t('home.clubText')}</p>
        <form class="inline-form" data-subscribe>
          <input class="input" type="email" name="email" required placeholder="${t('home.emailPh')}" aria-label="E-mail">
          <button class="btn btn--dark" type="submit">${t('btn.subscribe')}</button>
        </form>
      </section>`;
    tickTimers();
  }

  /* ---------- каталог ---------- */
  function catalogTitle(st) {
    if (st.q) return t('catalog.search', { q: esc(st.q) });
    if (st.sale) return t('catalog.sale');
    if (st.cats.length === 1) return catName(st.cats[0]) + ' ' + t('catalog.dresses');
    if (st.sort === 'new') return t('catalog.new');
    return t('catalog.title');
  }

  // простое «стемминг»-сравнение: «вечернее» найдёт «Вечерние»
  function matchesQuery(p, q) {
    const hay = [p.name, catName(p.category), p.fabric, p.colors.join(' '), p.sku, p.description].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w.length > 5 ? w.slice(0, w.length - 2) : w));
  }

  function filterProducts(st) {
    const list = NS.visibleProducts().filter((p) => {
      if (st.cats.length && !st.cats.includes(p.category)) return false;
      if (st.sale && !NS.discountOf(p)) return false;
      if (st.sizes.length && !st.sizes.some((s) => +p.stock[s] > 0)) return false;
      if (st.colors.length && !st.colors.some((c) => p.colors.includes(c))) return false;
      if (st.inStock && !NS.totalStock(p)) return false;
      const fp = NS.toCur(NS.finalPrice(p));
      if (st.min !== '' && fp < +st.min) return false;
      if (st.max !== '' && fp > +st.max) return false;
      if (st.q && !matchesQuery(p, st.q)) return false;
      return true;
    });
    const sorters = {
      popular: (a, b) => b.sold - a.sold,
      new: (a, b) => b.createdAt - a.createdAt,
      priceAsc: (a, b) => NS.finalPrice(a) - NS.finalPrice(b),
      priceDesc: (a, b) => NS.finalPrice(b) - NS.finalPrice(a),
      discount: (a, b) => NS.discountOf(b) - NS.discountOf(a),
      rating: (a, b) => b.rating - a.rating,
    };
    return list.sort(sorters[st.sort] || sorters.popular);
  }

  function renderCatalog(q) {
    catState = {
      cats: q.get('cat') ? q.get('cat').split(',') : [],
      sale: q.get('sale') === '1',
      q: q.get('q') || '',
      sort: q.get('sort') || 'popular',
      sizes: [], colors: [], min: '', max: '', inStock: false, limit: 12,
    };
    app.innerHTML = '<div class="container" id="catalogRoot"></div>';
    renderCatalogBody();
  }

  function renderCatalogBody() {
    const st = catState;
    const all = NS.visibleProducts();
    const list = filterProducts(st);
    const shown = list.slice(0, st.limit);
    const usedColors = Object.keys(NS.COLORS).filter((c) => all.some((p) => p.colors.includes(c)));
    const scrollY = window.scrollY;

    $('#catalogRoot').innerHTML = `
      <div class="page-head">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/catalog">${t('crumbs.catalog')}</a>${st.cats.length === 1 ? ' / ' + catName(st.cats[0]) : ''}</div>
        <h1 class="page-title">${catalogTitle(st)}<sup>${list.length}</sup></h1>
        <div class="chips">
          <button class="chip ${!st.cats.length && !st.sale ? 'is-on' : ''}" data-f="allcats">${t('catalog.chipAll')}</button>
          <button class="chip chip--sale ${st.sale ? 'is-on' : ''}" data-f="sale">${t('catalog.chipSale')}</button>
          ${NS.CATEGORIES.map((c) => `<button class="chip ${st.cats.includes(c.id) ? 'is-on' : ''}" data-f="cat" data-v="${c.id}">${c.name}</button>`).join('')}
        </div>
      </div>
      <div class="catalog">
        <aside class="filters" id="filters">
          <div class="filter">
            <label class="toggle-row">${t('catalog.saleOnly')}
              <span class="switch"><input type="checkbox" data-f="sale" ${st.sale ? 'checked' : ''}><span></span></span></label>
          </div>
          <div class="filter">
            <label class="toggle-row">${t('catalog.inStock')}
              <span class="switch"><input type="checkbox" data-f="instock" ${st.inStock ? 'checked' : ''}><span></span></span></label>
          </div>
          <div class="filter"><h4>Категория</h4>
            ${NS.CATEGORIES.map((c) => `<label class="check"><input type="checkbox" data-f="cat" data-v="${c.id}" ${st.cats.includes(c.id) ? 'checked' : ''}>${c.name}<small>${all.filter((p) => p.category === c.id).length}</small></label>`).join('')}
          </div>
          <div class="filter"><h4>${t('catalog.size')}</h4>
            <div class="size-grid">${NS.SIZES.map((s) => `<button class="size-btn ${st.sizes.includes(s) ? 'is-on' : ''}" data-f="size" data-v="${s}">${s}</button>`).join('')}</div>
          </div>
          <div class="filter"><h4>${t('catalog.color')}</h4>
            <div class="color-grid">${usedColors.map((c) => `<button class="color-dot ${st.colors.includes(c) ? 'is-on' : ''}" style="background:${NS.colorHex(c)}" title="${c}" aria-label="${c}" data-f="color" data-v="${c}"></button>`).join('')}</div>
          </div>
          <div class="filter"><h4>Цена, ${NS.curLabel()}</h4>
            <div class="range-row">
              <input class="input" type="number" min="0" placeholder="от" value="${st.min}" data-f="min">
              <span>—</span>
              <input class="input" type="number" min="0" placeholder="до" value="${st.max}" data-f="max">
            </div>
          </div>
          <div class="filter" style="border:0"><button class="btn btn--outline btn--block" data-f="reset" style="height:44px">${t('btn.reset')}</button></div>
        </aside>

        <div>
          <div class="toolbar">
            <button class="btn btn--outline filters-btn" style="height:40px;padding:0 18px" data-f="open">${ICONS.filter} ${t('btn.filters')}</button>
            <span class="muted">${list.length} ${I18N.modelWord(list.length)}</span>
            <select class="select" data-f="sort" aria-label="Сортировка">
              ${[['popular', t('catalog.sortPopular')], ['new', t('catalog.sortNew')], ['discount', 'Sale %'], ['priceAsc', t('catalog.sortPriceAsc')], ['priceDesc', t('catalog.sortPriceDesc')], ['rating', '★']]
                .map(([v, label]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
          ${shown.length
            ? `<div class="grid">${shown.map(card).join('')}</div>`
            : NS.visibleProducts().length
              ? `<div class="empty"><h3>${t('catalog.empty')}</h3><p>${t('catalog.emptyHint')}</p><button class="btn btn--dark" data-f="reset">${t('btn.reset')}</button></div>`
              : `<div class="empty"><h3>${t('catalog.soon')}</h3><p>${t('catalog.soonHint')}</p><a class="btn btn--dark" href="#/">${t('crumbs.home')}</a></div>`}
          ${list.length > shown.length ? `
            <div class="more">
              <p>${t('catalog.shown', { n: shown.length, total: list.length })}</p>
              <div class="progress-line"><i style="width:${(shown.length / list.length) * 100}%"></i></div>
              <button class="btn btn--outline" data-f="more">${t('btn.more')}</button>
            </div>` : ''}
        </div>
      </div>`;
    window.scrollTo(0, scrollY);
  }

  function onCatalogFilter(el) {
    const st = catState, f = el.dataset.f, v = el.dataset.v;
    const toggle = (arr, x) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
    switch (f) {
      case 'allcats': st.cats = []; st.sale = false; break;
      case 'sale': st.sale = !st.sale; break;
      case 'instock': st.inStock = !st.inStock; break;
      case 'cat': st.cats = toggle(st.cats, v); break;
      case 'size': st.sizes = toggle(st.sizes, v); break;
      case 'color': st.colors = toggle(st.colors, v); break;
      case 'min': st.min = el.value; break;
      case 'max': st.max = el.value; break;
      case 'sort': st.sort = el.value; break;
      case 'more': st.limit += 12; break;
      case 'reset': Object.assign(st, { cats: [], sale: false, q: '', sizes: [], colors: [], min: '', max: '', inStock: false }); break;
      case 'open': openPanel($('#filters')); return;
      default: return;
    }
    if (f !== 'more') st.limit = 12;
    const keepOpen = $('#filters').classList.contains('is-open');
    renderCatalogBody();
    if (keepOpen) $('#filters').classList.add('is-open');
  }

  /* ---------- страница товара ---------- */
  function renderProduct(id) {
    const p = NS.product(id);
    if (!p || !p.visible) return renderNotFound();
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 12);
    LS.set('ns_recent', recent);

    const s = NS.settings;
    const gallery = NS.gallery(p);
    const d = NS.discountOf(p);
    const sizes = NS.SIZES.filter((sz) => sz in p.stock);
    const related = NS.visibleProducts().filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
    const recentList = recent.filter((x) => x !== id).map((x) => NS.product(x)).filter((x) => x && x.visible).slice(0, 8);
    const inStock = NS.totalStock(p) > 0;
    // первый цвет, у которого есть остаток
    const firstColor = Math.max(0, p.colors.findIndex((c) => NS.colorStock(p, c) > 0));
    const state = { color: firstColor, size: null, qty: 1 };
    const curColor = () => p.colors[state.color] || '';
    const vs = (sz) => NS.variantStock(p, curColor(), sz);

    app.innerHTML = `
      <div class="container">
        <div class="page-head" style="padding-bottom:0">
          <div class="crumbs"><a href="#/">Главная</a> / <a href="#/catalog">${t('crumbs.catalog')}</a> / <a href="#/catalog?cat=${p.category}">${catName(p.category)}</a> / ${esc(p.name)}</div>
        </div>
        <div class="pdp">
          <div class="gallery">
            <div class="gallery__thumbs">${gallery.map((src, i) => `<button data-thumb="${i}" class="${i === 0 ? 'is-on' : ''}"><img src="${src}" alt=""></button>`).join('')}</div>
            <div class="gallery__main" id="mainImg"><img src="${gallery[0]}" alt="${esc(p.name)}"></div>
          </div>

          <div class="info">
            <div class="info__cat">${catName(p.category)} · ${esc(p.sku)}</div>
            <h1>${esc(p.name)}</h1>
            <div class="rating"><span class="stars">${stars(p.rating)}</span> ${p.rating} · ${p.reviews} ${plural(p.reviews, 'отзыв', 'отзыва', 'отзывов')}</div>
            ${priceHTML(p)}
            <div class="alt-price">≈ ${NS.altMoney(NS.finalPrice(p))}${NS.cur === 'UZS' ? ` по курсу ${NS.money(NS.usdRate(), 'UZS')} за $1` : ''}</div>
            ${d ? `<div class="save-note">Вы экономите ${NS.money(p.price - NS.finalPrice(p))}</div>` : ''}
            ${NS.inFlash(p) ? `<div class="flash-box"><span><b>${esc(s.flash.title)}</b> — цена действует ещё</span>${timerHTML(s.flash.endsAt, true)}</div>` : ''}
            ${p.sold > 50 ? `<div class="sold-note">Купили ${p.sold} раз</div>` : ''}

            <div class="opt">
              <div class="opt__head"><span>Цвет: <b id="colorName">${esc(p.colors[firstColor] || '')}</b></span></div>
              <div class="color-grid">${p.colors.map((c, i) => `<button class="swatch-lg ${i === firstColor ? 'is-on' : ''} ${NS.colorStock(p, c) ? '' : 'is-out'}" data-color="${i}" style="background:${NS.colorHex(c)}" title="${esc(c)}${NS.colorStock(p, c) ? '' : ' — нет в наличии'}" aria-label="${esc(c)}"></button>`).join('')}</div>
            </div>

            <div class="opt">
              <div class="opt__head"><span>Размер: <b id="sizeName">не выбран</b></span><button class="link-btn" data-modal="sizes">Таблица размеров</button></div>
              <div class="sizes-row" id="sizesRow">${sizes.map((sz) => `<button class="size-btn" data-size-pick="${sz}" ${vs(sz) ? '' : 'disabled'}>${sz}</button>`).join('')}</div>
              <div class="stock-note" id="stockNote"></div>
            </div>

            <div class="buy-row">
              <div class="qty">
                <button data-pqty="-1" aria-label="Меньше">−</button>
                <input id="pQty" value="1" readonly aria-label="Количество">
                <button data-pqty="1" aria-label="Больше">+</button>
              </div>
              <button class="btn btn--dark" id="addBtn" ${inStock ? '' : 'disabled'}>${inStock ? 'Добавить в корзину' : 'Нет в наличии'}</button>
              <button class="wish-btn ${wish.includes(p.id) ? 'is-wished' : ''}" data-wish="${p.id}" aria-label="${t('card.wish')}">${ICONS.heart}</button>
            </div>

            <div class="pdp-perks">
              <div>${ICONS.truck}<span>Бесплатная доставка от ${NS.money(s.freeShippingFrom)}, по городу — 1–2 дня</span></div>
              <div>${ICONS.hanger}<span>Примерка перед оплатой — курьер подождёт 15 минут</span></div>
              <div>${ICONS.ret}<span>Возврат в течение ${returnText()}</span></div>
            </div>

            <details class="acc" open><summary>Описание</summary><div class="acc__body">${esc(p.description)}</div></details>
            <details class="acc"><summary>Состав и уход</summary><div class="acc__body"><ul>
              <li>Основная ткань: ${esc(p.fabric)}</li><li>Подкладка: вискоза 100%</li>
              <li>Деликатная химчистка или ручная стирка при 30 °C</li><li>Гладить с изнанки через ткань</li></ul></div></details>
            <details class="acc"><summary>Доставка и оплата</summary><div class="acc__body">
              Курьерская доставка — ${NS.money(s.shippingCost)}, бесплатно от ${NS.money(s.freeShippingFrom)}. Экспресс за 3 часа — ${NS.money(s.expressCost)}.${s.pickupEnabled ? ' Самовывоз из бутика — бесплатно.' : ''}
              Оплата: ${paymentList().map((k) => NS.PAYMENTS[k].name).join(', ')}. Возврат в течение ${returnText()}.</div></details>
          </div>
        </div>
      </div>

      ${related.length ? `<section class="section section--paper"><div class="container">
        <div class="section__head"><div><div class="section__kicker">Дополните образ</div><h2 class="section__title">Похожие модели</h2></div></div>
        <div class="grid">${related.map(card).join('')}</div></div></section>` : ''}
      ${recentList.length ? railSection('История', 'Вы недавно смотрели', 'railRecent', recentList) : ''}`;

    const setMain = (i) => {
      $('#mainImg img').src = gallery[i];
      $$('[data-thumb]').forEach((b) => b.classList.toggle('is-on', +b.dataset.thumb === i));
    };
    const updateStock = () => {
      const note = $('#stockNote');
      const n = vs(state.size);
      note.className = 'stock-note ' + (n <= 3 ? 'stock-note--low' : 'stock-note--ok');
      note.textContent = n <= 3 ? `Осталось всего ${n} шт. — успейте заказать` : 'В наличии';
      if (state.qty > n) { state.qty = n; $('#pQty').value = n; }
    };

    app.onclick = (e) => {
      const t = e.target.closest('[data-thumb],[data-color],[data-size-pick],[data-pqty],#addBtn,#mainImg');
      if (!t) return;
      if (t.dataset.thumb != null) setMain(+t.dataset.thumb);
      else if (t.dataset.color != null) {
        state.color = +t.dataset.color;
        $$('[data-color]').forEach((b) => b.classList.toggle('is-on', b === t));
        $('#colorName').textContent = p.colors[state.color];
        setMain(Math.min(state.color, gallery.length - 1));
        // размеры зависят от цвета: недоступные гасим, выбранный сбрасываем, если его нет в этом цвете
        $$('[data-size-pick]').forEach((b) => { b.disabled = !vs(b.dataset.sizePick); });
        if (state.size && !vs(state.size)) {
          state.size = null;
          $$('[data-size-pick]').forEach((b) => b.classList.remove('is-on'));
          $('#sizeName').textContent = 'не выбран';
          $('#stockNote').textContent = '';
        } else if (state.size) updateStock();
      } else if (t.dataset.sizePick) {
        state.size = t.dataset.sizePick;
        $$('[data-size-pick]').forEach((b) => b.classList.toggle('is-on', b === t));
        $('#sizeName').textContent = state.size;
        updateStock();
      } else if (t.dataset.pqty) {
        const max = state.size ? vs(state.size) : 10;
        state.qty = Math.min(Math.max(1, state.qty + +t.dataset.pqty), Math.max(1, max));
        $('#pQty').value = state.qty;
      } else if (t.id === 'addBtn') {
        if (!state.size) {
          toast('Пожалуйста, выберите размер', 'error');
          $('#sizesRow').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300 });
          return;
        }
        if (addToCart(p.id, p.colors[state.color], state.size, state.qty)) openPanel($('#cartDrawer'));
      } else if (t.id === 'mainImg') {
        t.classList.toggle('is-zoom');
      }
    };
    $('#mainImg').onmousemove = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      $('#mainImg img').style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    };
    tickTimers();
  }

  /* ---------- избранное ---------- */
  function renderWishlist() {
    const list = wish.map((id) => NS.product(id)).filter((p) => p && p.visible);
    app.innerHTML = `<div class="container" style="padding-bottom:80px">
      <div class="page-head"><div class="crumbs"><a href="#/">Главная</a> / Избранное</div>
        <h1 class="page-title">Избранное<sup>${list.length}</sup></h1></div>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
        : '<div class="empty"><h3>Здесь пока пусто</h3><p>Нажимайте ♡ на понравившихся платьях, чтобы сохранить их.</p><a class="btn btn--dark" href="#/catalog">В каталог</a></div>'}
    </div>`;
  }

  /* ---------- оформление заказа ---------- */
  function renderCheckout() {
    if (!cartLines().length) {
      app.innerHTML = `<div class="container"><div class="empty"><h3>${t('cart.empty')}</h3><p>${t('cart.emptyHint')}</p><a class="btn btn--dark" href="#/catalog">${t('cart.toCatalog')}</a></div></div>`;
      return;
    }
    const s = NS.settings;
    const draft = LS.get('ns_checkout', {});
    app.innerHTML = `<div class="container">
      <div class="page-head"><div class="crumbs"><a href="#/">Главная</a> / Оформление заказа</div><h1 class="page-title">Оформление заказа</h1></div>
      <form class="checkout" id="coForm" novalidate>
        <div>
          <div class="co-block"><h3><i>1</i>Контактные данные</h3>
            <div class="form-grid">
              <div class="field"><label>Имя и фамилия *</label><input class="input" name="name" value="${esc(draft.name)}" autocomplete="name"><div class="err">Укажите имя</div></div>
              <div class="field"><label>Телефон *</label><input class="input" name="phone" value="${esc(draft.phone)}" placeholder="+998 (__) ___-__-__" autocomplete="tel"><div class="err">Введите корректный номер</div></div>
              <div class="field full"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(draft.email)}" autocomplete="email"><div class="err">Некорректный e-mail</div></div>
            </div>
          </div>
          <div class="co-block"><h3><i>2</i>Доставка</h3>
            <label class="radio-card"><input type="radio" name="delivery" value="courier" checked><div>Курьер<small>1–2 дня, примерка перед оплатой</small></div><b>${NS.money(s.shippingCost)} / бесплатно от ${NS.money(s.freeShippingFrom)}</b></label>
            <label class="radio-card"><input type="radio" name="delivery" value="express"><div>Экспресс за 3 часа<small>По городу, в день заказа</small></div><b>${NS.money(s.expressCost)}</b></label>
            ${s.pickupEnabled ? `<label class="radio-card"><input type="radio" name="delivery" value="pickup"><div>Самовывоз из бутика<small>${esc(s.contacts.address)}</small></div><b>Бесплатно</b></label>` : ''}
            <div class="form-grid" id="addrFields" style="margin-top:8px">
              <div class="field"><label>Город *</label><input class="input" name="city" value="${esc(draft.city)}"><div class="err">Укажите город</div></div>
              <div class="field"><label>Адрес *</label><input class="input" name="address" value="${esc(draft.address)}" placeholder="Улица, дом, квартира"><div class="err">Укажите адрес</div></div>
            </div>
            <div class="field" style="margin-top:14px"><label>Комментарий к заказу</label><textarea class="input" name="comment" rows="3">${esc(draft.comment)}</textarea></div>
          </div>
          <div class="co-block"><h3><i>3</i>Оплата</h3>
            ${paymentList().map((k, i) => `<label class="radio-card"><input type="radio" name="payment" value="${k}" ${i === 0 ? 'checked' : ''}><div>${NS.PAYMENTS[k].name}<small>${NS.PAYMENTS[k].note}</small></div></label>`).join('')}
          </div>
        </div>
        <aside class="summary" id="coSummary"></aside>
      </form>
    </div>`;

    const form = $('#coForm');
    const delivery = () => form.elements.delivery.value;
    const renderSummary = () => {
      const t = totals(delivery());
      $('#coSummary').innerHTML = `<h3>Ваш заказ</h3>
        ${t.lines.map((l) => `<div class="line-item"><img src="${NS.image(l.p, Math.max(0, l.p.colors.indexOf(l.color)))}" alt="">
          <div><div class="line-item__name">${esc(l.p.name)}</div><div class="line-item__meta">${esc(l.color)} · ${l.size} · ${l.qty} шт.</div>
          ${NS.discountOf(l.p) ? `<div class="price"><span class="price__now is-sale">${NS.money(NS.finalPrice(l.p) * l.qty)}</span><s>${NS.money(l.p.price * l.qty)}</s></div>` : `<div class="price"><span class="price__now">${NS.money(l.p.price * l.qty)}</span></div>`}</div></div>`).join('')}
        <div style="margin-top:16px">${promoBlockHTML(t)}</div>
        ${totalsHTML(t, 'К оплате')}
        <button class="btn btn--dark btn--block" type="submit" style="margin-top:18px">Подтвердить заказ</button>
        <div class="secure">${ICONS.lock} Данные защищены. Оплата после подтверждения менеджером.</div>`;
    };
    renderSummary();
    refreshCheckout = renderSummary;

    form.addEventListener('change', (e) => {
      if (e.target.name === 'delivery') {
        $('#addrFields').style.display = delivery() === 'pickup' ? 'none' : '';
        renderSummary();
      }
    });
    form.addEventListener('input', () => {
      const d = {};
      ['name', 'phone', 'email', 'city', 'address', 'comment'].forEach((k) => { d[k] = form.elements[k].value; });
      LS.set('ns_checkout', d);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      placeOrder(form);
    });
  }

  function placeOrder(form) {
    const els = form.elements;
    const v = (k) => els[k].value.trim();
    const pickup = els.delivery.value === 'pickup';
    const checks = {
      name: v('name').length >= 2,
      phone: v('phone').replace(/\D/g, '').length >= 9,
      email: !v('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email')),
      city: pickup || v('city').length >= 2,
      address: pickup || v('address').length >= 4,
    };
    let firstBad = null;
    Object.entries(checks).forEach(([k, ok]) => {
      els[k].classList.toggle('is-invalid', !ok);
      if (!ok && !firstBad) firstBad = els[k];
    });
    if (firstBad) { firstBad.focus(); toast(t('checkout.errRequired'), 'error'); return; }

    const tot = totals(els.delivery.value);
    for (const l of tot.lines) {
      if (NS.variantStock(l.p, l.color, l.size) < l.qty) {
        toast(`${esc(l.p.name)} (${l.size}): ${t('checkout.errStock')} (${NS.variantStock(l.p, l.color, l.size)})`, 'error');
        return;
      }
    }
    if (!els.payment || !els.payment.value) { toast(t('checkout.pay'), 'error'); return; }
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    NS.api('/api/orders', {
      customer: { name: v('name'), phone: v('phone'), email: v('email'), city: v('city'), address: v('address'), comment: v('comment') },
      delivery: els.delivery.value,
      payment: els.payment.value,
      items: tot.lines.map((l) => ({ id: l.p.id, color: l.color, size: l.size, qty: l.qty })),
      promo: tot.code ? tot.code.code : '',
    }).then((r) => {
      const mine = LS.get('ns_orders', []).filter((o) => o.id !== r.order.id);
      LS.set('ns_orders', [r.order, ...mine].slice(0, 20));
      cart = [];
      clearPromo();
      refreshCheckout = null;
      localStorage.removeItem('ns_checkout');
      saveCart();
      location.hash = '#/success/' + r.order.id;
      NS.load().catch(() => {});
    }).catch((e) => {
      if (btn) btn.disabled = false;
      toast(esc(e.message), 'error');
    });
  }

  function renderSuccess(id) {
    const o = LS.get('ns_orders', []).find((x) => x.id === id) || null;
    app.innerHTML = `<div class="container"><div class="success fade-in">
      <div class="success__icon">${ICONS.check}</div>
      <h1>${t('success.title')}</h1>
      <p>${t('success.text')}</p>
      ${o ? `<div class="co-block">
        <div><b>${t('success.number')}:</b> ${esc(o.id)}</div>
        <div class="totals" style="margin-top:14px">${o.items.map((it) => `<div><span>${esc(it.name)} · ${esc(it.color)} · ${it.size} × ${it.qty}</span><span>${NS.money(it.price * it.qty)}</span></div>`).join('')}</div>
        <div class="totals" style="margin-top:10px">
          <div><span>${t('cart.shipping')}</span><span>${o.shipping ? NS.money(o.shipping) : t('cart.free')}</span></div>
          <div class="total"><span>${t('cart.total')}</span><span>${NS.money(o.total)}</span></div>
        </div>
      </div>` : ''}
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px">
        <a class="btn btn--dark" href="#/">${t('crumbs.home')}</a>
        <a class="btn btn--outline" href="#/catalog">${t('nav.all')}</a>
      </div>
    </div></div>`;
  }

  function renderNotFound() {
    app.innerHTML = `<div class="container"><div class="empty"><h3>404</h3><p>${t('catalog.empty')}</p><a class="btn btn--dark" href="#/">${t('crumbs.home')}</a></div></div>`;
  }

  const MODALS = {
    sizes() {
      return `<h2>${t('modal.sizesTitle')}</h2>
        <table class="table"><thead><tr><th>EU</th><th>RU</th><th>Грудь</th><th>Талия</th><th>Бёдра</th></tr></thead>
        <tbody>
          <tr><td>XS</td><td>40</td><td>80–84</td><td>60–64</td><td>86–90</td></tr>
          <tr><td>S</td><td>42</td><td>84–88</td><td>64–68</td><td>90–94</td></tr>
          <tr><td>M</td><td>44</td><td>88–92</td><td>68–72</td><td>94–98</td></tr>
          <tr><td>L</td><td>46</td><td>92–96</td><td>72–76</td><td>98–102</td></tr>
          <tr><td>XL</td><td>48</td><td>96–100</td><td>76–80</td><td>102–106</td></tr>
          <tr><td>XXL</td><td>50</td><td>100–104</td><td>80–84</td><td>106–110</td></tr>
        </tbody></table>`;
    },
    delivery() {
      const s = NS.settings;
      return `<h2>${t('modal.deliveryTitle')}</h2>
        <p>${t('modal.deliveryText1', { ship: NS.money(s.shippingCost), free: NS.money(s.freeShippingFrom) })}</p>
        <p style="margin-top:10px">${t('modal.deliveryText2', { express: NS.money(s.expressCost) })}</p>
        <p style="margin-top:10px">${t('modal.deliveryText3', { days: returnText() })}</p>`;
    },
  };

  function showWelcome() {
    if (LS.get('ns_welcome', false)) return;
    const code = NS.settings.welcomeCode || 'WELCOME10';
    const p = NS.visibleProducts()[0];
    setTimeout(() => {
      if (LS.get('ns_welcome', false)) return;
      openModal(`<div class="welcome">
        <img src="${p ? NS.image(p, 0) : ''}" alt="">
        <div class="welcome__text">
          <div class="section__kicker">${t('welcome.title')}</div>
          <div class="big">−10%</div>
          <p>${t('welcome.off')}</p>
          <div class="code-pill">${esc(code)}</div>
          <button class="btn btn--dark" data-apply-promo="${esc(code)}">${t('btn.toCart')}</button>
        </div>
      </div>`);
      LS.set('ns_welcome', true);
    }, 9000);
  }

  function renderSearch(q) {
    const box = $('#searchResults');
    q = (q || '').trim();
    if (!q) { box.innerHTML = ''; return; }
    const list = NS.visibleProducts().filter((p) => matchesQuery(p, q)).slice(0, 6);
    box.innerHTML = list.length
      ? list.map((p) => `<a class="mini-card" href="#/product/${p.id}"><img src="${NS.image(p, 0)}" alt=""><div>${esc(p.name)}</div>${priceHTML(p)}</a>`).join('') +
        `<div class="search__hint"><a href="#/catalog?q=${encodeURIComponent(q)}">${t('search.showAll')}</a></div>`
      : `<div class="search__hint">${t('search.empty')}</div>`;
  }

  let announceTimer;
  /* название, логотип и цвета магазина из настроек (Админ → Настройки → Бренд) */
  function applyBrand() {
    const b = NS.brand();
    I18N.setBrand(b);
    const short = String(b.short || b.name);
    const rest = String(b.name).toLowerCase().startsWith(short.toLowerCase()) ? String(b.name).slice(short.length).trim() : '';
    $$('.brand').forEach((el) => {
      el.setAttribute('aria-label', b.name);
      const img = el.querySelector('.brand__logo');
      if (img) img.src = b.logoUrl || 'assets/logo.svg';
      const word = el.querySelector('.brand__word');
      if (word) word.innerHTML = esc(short.toUpperCase()) + (rest ? `<small>${esc(rest.toUpperCase())}</small>` : '');
    });
    const copy = $('#brandCopy');
    if (copy) copy.textContent = b.name;
    const root = document.documentElement.style;
    if (b.accent) { root.setProperty('--gold', b.accent); root.setProperty('--gold-2', NS.shade(b.accent, 0.25)); } else { root.removeProperty('--gold'); root.removeProperty('--gold-2'); }
    if (b.dark) root.setProperty('--ink', b.dark); else root.removeProperty('--ink');
  }

  function renderChrome() {
    const s = NS.settings;
    const items = (s.announcements || []).filter(Boolean);
    $('#announce').innerHTML = items.map((txt, i) => `<div class="announce__item ${i === 0 ? 'is-on' : ''}">${esc(txt)}</div>`).join('');
    $('#announce').style.display = items.length ? '' : 'none';
    clearInterval(announceTimer);
    if (items.length > 1) {
      let i = 0;
      announceTimer = setInterval(() => {
        const els = $$('.announce__item');
        if (!els.length) return;
        const prev = els[i];
        prev.classList.replace('is-on', 'is-out');
        setTimeout(() => prev.classList.remove('is-out'), 650);
        i = (i + 1) % els.length;
        els[i].classList.add('is-on');
      }, 4200);
    }

    const all = NS.visibleProducts();
    $('#mega').innerHTML = `<div class="container mega__inner">
      <div class="mega__list"><h5>${t('nav.categories')}</h5>
        <a href="#/catalog">${t('nav.all')}</a>
        ${NS.CATEGORIES.map((c) => `<a href="#/catalog?cat=${c.id}">${catName(c.id)}</a>`).join('')}
        <a href="#/catalog?sale=1" style="color:var(--sale)">${t('nav.sale')}</a>
      </div>
      <div><h5>${t('nav.popular')}</h5><div class="mega__tiles">
        ${['evening', 'cocktail', 'wedding', 'summer'].map((id) => {
          const p = all.find((x) => x.category === id);
          return p ? `<a href="#/catalog?cat=${id}" class="mega__tile"><img src="${NS.image(p, 0)}" alt=""><span>${catName(id)}</span></a>` : '';
        }).join('')}
      </div></div>
    </div>`;

    $('#mobileNav').innerHTML = `
      <a href="#/catalog?sort=new">${t('nav.new')} <span>›</span></a>
      <a href="#/catalog?sale=1" style="color:var(--sale)">${t('nav.sale')} <span>›</span></a>
      <a href="#/catalog">${t('nav.all')} <span>›</span></a>
      <h5>${t('nav.categories')}</h5>
      ${NS.CATEGORIES.map((c) => `<a href="#/catalog?cat=${c.id}">${catName(c.id)} <span>›</span></a>`).join('')}
      <h5>${t('nav.account')}</h5>
      <a href="#/wishlist">${t('nav.wish')} <span>›</span></a>`;

    applyBrand();
    $('#footerCats').innerHTML = NS.CATEGORIES.slice(0, 6).map((c) => `<a href="#/catalog?cat=${c.id}">${catName(c.id)}</a>`).join('');
    $('#footerContacts').innerHTML = `<a href="tel:${esc(s.contacts.phone.replace(/[^\d+]/g, ''))}">${esc(s.contacts.phone)}</a>
      <a href="mailto:${esc(s.contacts.email)}">${esc(s.contacts.email)}</a>
      <a>${esc(s.contacts.address)}</a><a>Instagram: ${esc(s.contacts.instagram)}</a>
      ${s.contacts.telegram ? `<a href="https://t.me/${esc(s.contacts.telegram.replace(/^@/, ''))}" target="_blank" rel="noopener">Telegram: ${esc(s.contacts.telegram)}</a>` : ''}
      ${(() => {
        const b = NS.brand();
        const links = [];
        if (b.whatsapp) links.push(`<a href="https://wa.me/${esc(b.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp: ${esc(b.whatsapp)}</a>`);
        [['facebook', 'Facebook'], ['tiktok', 'TikTok'], ['youtube', 'YouTube']].forEach(([k, label]) => {
          if (b[k]) links.push(`<a href="${esc(b[k])}" target="_blank" rel="noopener">${label}</a>`);
        });
        if (b.mapUrl) links.push(`<a href="${esc(b.mapUrl)}" target="_blank" rel="noopener">Как нас найти</a>`);
        if (b.workHours) links.push(`<a>${esc(b.workHours)}</a>`);
        return links.join('');
      })()}`;
    $('#year').textContent = new Date().getFullYear();
    $('#curBtn').innerHTML = ['UZS', 'USD'].map((c) => `<b class="${NS.cur === c ? 'is-on' : ''}">${c === 'UZS' ? 'СУМ' : 'USD'}</b>`).join('<i>/</i>');
    $('#curBtn').title = `1 $ = ${NS.money(NS.usdRate(), 'UZS')}`;
    const langBtn = $('#langBtn');
    if (langBtn) langBtn.innerHTML = ['ru', 'uz'].map((l) => `<b class="${I18N.lang === l ? 'is-on' : ''}">${t('lang.' + l)}</b>`).join('<i>/</i>');
    applyStaticI18n();
  }

  function route(keepScroll) {
    const raw = location.hash.slice(1) || '/';
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = new URLSearchParams(qs || '');
    const y = window.scrollY;
    closeAll();
    app.onclick = null;
    refreshCheckout = null;
    catState = null;
    switch (parts[0]) {
      case undefined: renderHome(); break;
      case 'catalog': renderCatalog(q); break;
      case 'product': renderProduct(parts[1]); break;
      case 'wishlist': renderWishlist(); break;
      case 'checkout': renderCheckout(); break;
      case 'success': renderSuccess(parts[1]); break;
      default: renderNotFound();
    }
    $$('.nav [data-nav]').forEach((a) => {
      const n = a.dataset.nav;
      const on = (n === 'sale' && q.get('sale') === '1') || (n === 'new' && q.get('sort') === 'new') ||
        (n === 'wedding' && q.get('cat') === 'wedding') || (n === 'catalog' && parts[0] === 'catalog' && !q.toString());
      a.classList.toggle('is-active', on);
    });
    window.scrollTo(0, keepScroll ? y : 0);
    document.body.dataset.page = parts[0] || 'home';
    document.dispatchEvent(new CustomEvent('ns:render', { detail: { page: document.body.dataset.page, keepScroll: !!keepScroll } }));
  }

  document.addEventListener('click', (e) => {
    const el = (s) => e.target.closest(s);
    let x;
    if ((x = el('[data-wish]'))) { e.preventDefault(); toggleWish(x.dataset.wish); return; }
    if ((x = el('[data-quick]'))) {
      e.preventDefault();
      const p = NS.product(x.dataset.quick);
      if (p && addToCart(p.id, NS.colorWithSize(p, x.dataset.size), x.dataset.size)) document.dispatchEvent(new CustomEvent('ns:added', { detail: { el: x } }));
      return;
    }
    if ((x = el('[data-open-cart]'))) { e.preventDefault(); openPanel($('#cartDrawer')); return; }
    if ((x = el('[data-modal]'))) { e.preventDefault(); openModal(MODALS[x.dataset.modal]()); return; }
    if ((x = el('[data-apply-promo]'))) { closeAll(); applyPromo(x.dataset.applyPromo); return; }
    if ((x = el('[data-promo-apply]'))) { applyPromo(x.parentElement.querySelector('[data-promo-input]').value); return; }
    if ((x = el('[data-promo-remove]'))) { clearPromo(); renderCart(); refreshPage(); return; }
    if ((x = el('[data-remove]'))) { cart = cart.filter((l) => l.key !== x.dataset.remove); saveCart(); return; }
    if ((x = el('[data-line]'))) {
      const line = cart.find((l) => l.key === x.dataset.line);
      const p = line && NS.product(line.id);
      if (!line || !p) return;
      const next = line.qty + +x.dataset.step;
      if (next > NS.variantStock(p, line.color, line.size)) { toast(`${t('checkout.errStock')}: ${NS.variantStock(p, line.color, line.size)}`, 'error'); return; }
      if (next < 1) cart = cart.filter((l) => l !== line); else line.qty = next;
      saveCart();
      return;
    }
    if ((x = el('[data-rail]'))) {
      const rail = document.getElementById(x.dataset.rail);
      rail.scrollBy({ left: rail.clientWidth * 0.8 * +x.dataset.dir, behavior: 'smooth' });
      return;
    }
    if ((x = el('#catalogRoot [data-f]')) && catState) {
      if (x.tagName === 'SELECT' || (x.tagName === 'INPUT' && x.type === 'number')) return;
      onCatalogFilter(x);
      return;
    }
    if (el('[data-close]') || el('#overlay')) { closeAll(); return; }
  });

  document.addEventListener('change', (e) => {
    const x = e.target.closest('#catalogRoot [data-f]');
    if (x && catState) onCatalogFilter(x);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    if (e.key === 'Enter' && e.target.matches('[data-promo-input]')) {
      e.preventDefault();
      applyPromo(e.target.value);
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-subscribe]');
    if (!form) return;
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) return;
    NS.api('/api/subscribe', { email }).then((r) => {
      const code = (r && r.code) || NS.settings.welcomeCode || 'WELCOME10';
      if (code) applyPromo(code);
      if (r && r.mailed) toast(t('toast.subMailOk', { code: code || '' }));
      else toast(t('toast.subOk'));
      if (r && r.mailError) console.warn('mail', r.mailError);
      form.reset();
    }).catch((err) => toast(esc(err.message), 'error'));
  });

  $('#cartBtn').onclick = () => openPanel($('#cartDrawer'));
  $('#burgerBtn').onclick = () => openPanel($('#mobileMenu'));
  $('#searchBtn').onclick = () => {
    closeAll();
    $('#search').classList.add('is-open');
    setTimeout(() => $('#searchInput').focus(), 200);
  };
  $('#searchClose').onclick = closeAll;
  $('#searchInput').addEventListener('input', (e) => renderSearch(e.target.value));
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = '#/catalog?q=' + encodeURIComponent(e.target.value.trim());
  });

  $('#langBtn').onclick = () => { I18N.setLang(I18N.lang === 'ru' ? 'uz' : 'ru'); };
  document.addEventListener('ns:lang', () => { renderChrome(); route(true); renderCart(); updateCounts(); });
  $('#curBtn').onclick = () => {
    NS.cur = NS.cur === 'USD' ? 'UZS' : 'USD';
    LS.set('ns_cur', NS.cur);
    if (catState) { catState.min = ''; catState.max = ''; }
    renderChrome(); route(true); renderCart();
  };

  window.addEventListener('hashchange', () => route(false));

  function boot(attempt) {
    NS.load().then(() => {
      NS.cur = LS.get('ns_cur', NS.settings.defaultCurrency || 'UZS') === 'USD' ? 'USD' : 'UZS';
      cart = cart.filter((l) => NS.product(l.id));
      renderChrome();
      route(false);
      try { renderCart(); } catch (err) { console.error('renderCart', err); }
      updateCounts();
      showWelcome();
      if (!NS._watching) {
        NS._watching = true;
        NS.watch(() => NS.load().then(() => {
          renderChrome();
          try { renderCart(); } catch (err) { console.error('renderCart', err); }
          updateCounts();
          if (!document.querySelector('.drawer.is-open, .modal.is-open, .search.is-open, .filters.is-open') && !refreshCheckout) route(true);
        }).catch(() => {}), 20000);
      }
    }).catch((err) => {
      console.error('boot', err);
      if ((attempt || 0) < 8) return setTimeout(() => boot((attempt || 0) + 1), 700);
      if (NS.db) {
        try { renderChrome(); route(false); updateCounts(); } catch (_) {}
        return;
      }
      app.innerHTML = '<div class="container"><div class="empty"><h3>' +
        (I18N.lang === 'uz' ? "Do'kon vaqtincha ishlamayapti" : 'Магазин временно недоступен') +
        '</h3><p>' +
        (I18N.lang === 'uz' ? "Server bilan bog'lanib bo'lmadi. Sahifani yangilang." : 'Не удалось связаться с сервером. Обновите страницу.') +
        '</p></div></div>';
    });
  }
  boot(0);
})();