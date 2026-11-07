/* Nargizka Shop - motion layer: GSAP + ScrollTrigger + SplitText + Lenis */
(function () {
  'use strict';

  const html = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('#app');
  const header = $('#header');
  const preloader = $('#preloader');

  /* ---------- header: transparent over the hero, hides while scrolling down ---------- */
  let lastY = window.scrollY;
  function syncHeader() {
    const y = window.scrollY;
    const home = document.body.dataset.page === 'home';
    header.classList.toggle('is-top', y < 24);
    if (home && y > window.innerHeight * 0.7 && y > lastY + 2 && !document.body.classList.contains('lock')) header.classList.add('is-hidden');
    else if (!home || y < lastY - 2 || y < 200) header.classList.remove('is-hidden');
    lastY = y;
  }
  window.addEventListener('scroll', syncHeader, { passive: true });
  document.addEventListener('ns:render', syncHeader);
  syncHeader();

  const gsap = window.gsap;
  if (!gsap || !window.ScrollTrigger || html.classList.contains('reduced')) {
    if (preloader) preloader.remove();
    html.classList.remove('motion');
    return;
  }
  const ST = window.ScrollTrigger;
  const Split = window.SplitText;
  gsap.registerPlugin(ST);
  if (Split) gsap.registerPlugin(Split);
  html.classList.add('gsap-on');

  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const EASE = 'expo.out';

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (window.Lenis) {
    ['#cartDrawer', '#mobileMenu', '#modal', '#search'].forEach((s) => { const el = $(s); if (el) el.setAttribute('data-lenis-prevent', ''); });
    lenis = new window.Lenis({
      lerp: 0.085,
      prevent: (node) => !!(node.closest && node.closest('.drawer, .modal, .search, .filters, .gallery__thumbs')),
    });
    lenis.on('scroll', ST.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    new MutationObserver(() => (document.body.classList.contains('lock') ? lenis.stop() : lenis.start()))
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- intro ---------- */
  const introDone = new Promise((resolve) => {
    if (!preloader || html.classList.contains('no-intro')) {
      if (preloader) preloader.remove();
      resolve();
      return;
    }
    preloader.style.animation = 'none';
    if (lenis) lenis.stop();
    const word = $('.preloader__word', preloader);
    word.innerHTML = word.textContent.split('').map((c) => `<span>${c}</span>`).join('');
    const count = $('.preloader__count', preloader);
    const n = { v: 0 };
    gsap.timeline({
      defaults: { ease: EASE },
      onComplete: () => { preloader.remove(); if (lenis && !document.body.classList.contains('lock')) lenis.start(); },
    })
      .from('.preloader__logo', { scale: 0.55, rotate: -120, autoAlpha: 0, duration: 1.5 })
      .from($$('span', word), { yPercent: 115, duration: 1.1, stagger: 0.055 }, 0.2)
      .from('.preloader__sub', { autoAlpha: 0, letterSpacing: '1.1em', duration: 1.4 }, 0.5)
      .to('.preloader__line i', { scaleX: 1, duration: 1.7, ease: 'power2.inOut' }, 0.25)
      .to(n, { v: 100, duration: 1.7, ease: 'power2.inOut', onUpdate: () => { count.textContent = Math.round(n.v); } }, 0.25)
      .to('.preloader__inner', { yPercent: -40, autoAlpha: 0, duration: 0.7, ease: 'power3.in' }, 2.05)
      .to(count, { autoAlpha: 0, duration: 0.4 }, 2.05)
      .to(preloader, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.15, ease: 'expo.inOut' }, 2.4)
      .add(resolve, 2.65);
  });

  /* ---------- per-page choreography ---------- */
  const line = document.createElement('div');
  line.className = 'route-line';
  document.body.appendChild(line);

  let ctx = null;
  let mm = null;
  let gen = 0;

  function pageIn() {
    gsap.fromTo(line, { scaleX: 0, autoAlpha: 1 }, {
      scaleX: 1, duration: 0.7, ease: 'power3.inOut',
      onComplete: () => gsap.to(line, { autoAlpha: 0, duration: 0.4 }),
    });
    gsap.fromTo(app, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, clearProps: 'transform,opacity,visibility' });
  }

  const fontsReady = document.fonts && document.fonts.status !== 'loaded' ? document.fonts.ready : Promise.resolve();

  function afterFonts(el, run) {
    if (!document.fonts || document.fonts.status === 'loaded') return run();
    gsap.set(el, { autoAlpha: 0 });
    const g = gen;
    fontsReady.then(() => {
      if (g !== gen || !el.isConnected) return;
      gsap.set(el, { autoAlpha: 1 });
      ctx.add(run);
      ST.refresh();
    });
  }

  function splitLines(el, vars) {
    if (!Split) return;
    afterFonts(el, () => Split.create(el, {
      type: 'lines', mask: 'lines', linesClass: 'ln', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, Object.assign({ yPercent: 112, duration: 1.3, ease: EASE, stagger: 0.1 }, vars)),
    }));
  }

  function hero() {
    const el = $('.hero', app);
    if (!el) return;
    const tl = gsap.timeline({ paused: true, defaults: { ease: EASE } });
    tl.set('.hero__kicker, .hero__title, .hero__ctas', { autoAlpha: 1 }, 0)
      .fromTo('.hero__kicker span', { yPercent: 120 }, { yPercent: 0, duration: 1.2 }, 0.1)
      .fromTo('.hero__line > span', { yPercent: 118, rotate: 2.5 }, { yPercent: 0, rotate: 0, duration: 1.6, stagger: 0.13 }, 0.15)
      .fromTo('.hero__sub', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 1.3 }, 0.55)
      .fromTo('.hero__ctas > *', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 1.3, stagger: 0.09 }, 0.65)
      .fromTo('.hero__frame', { autoAlpha: 1, clipPath: 'inset(100% 0% 0% 0%)', y: 80 },
        { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 1.7, ease: 'expo.inOut', stagger: 0.14, clearProps: 'clipPath' }, 0)
      .fromTo('.hero__frame img', { scale: 1.5 }, { scale: 1.12, duration: 2.2, stagger: 0.14 }, 0.1)
      .fromTo('.hero__scroll', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 }, 1.3);
    introDone.then(() => tl.play());

    const sc = { trigger: el, start: 'top top', end: 'bottom top', scrub: true };
    gsap.to('.hero__copy', { yPercent: 28, autoAlpha: 0.15, ease: 'none', scrollTrigger: sc });
    $$('.hero__frame', el).forEach((f, i) => gsap.to(f, { yPercent: [-14, -30, -8][i] || -12, ease: 'none', scrollTrigger: sc }));
    gsap.to('.hero__glow', { yPercent: 40, ease: 'none', scrollTrigger: sc });

    if (fine) {
      const imgs = $$('.hero__frame img', el).map((img, i) => ({
        x: gsap.quickTo(img, 'x', { duration: 1.4, ease: 'power3' }),
        y: gsap.quickTo(img, 'y', { duration: 1.4, ease: 'power3' }),
        d: [16, 28, 20][i] || 18,
      }));
      const glow = $('.hero__glow', el);
      const gx = gsap.quickTo(glow, 'x', { duration: 2, ease: 'power3' });
      const gy = gsap.quickTo(glow, 'y', { duration: 2, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        imgs.forEach((o) => { o.x(-nx * o.d); o.y(-ny * o.d); });
        gx(nx * 160); gy(ny * 120);
      });
    }
  }

  function marquee() {
    const track = $('.marquee__track', app);
    if (!track) return;
    track.style.animation = 'none';
    const loop = gsap.fromTo(track, { xPercent: 0 }, { xPercent: -50, duration: 42, ease: 'none', repeat: -1 });
    loop.totalTime(42 * 400);
    const skew = gsap.quickTo(track, 'skewX', { duration: 0.7, ease: 'power3' });
    let rest;
    ST.create({
      trigger: '.marquee', start: 'top bottom', end: 'bottom top',
      onUpdate: (self) => {
        const v = self.getVelocity();
        const dir = self.direction;
        gsap.to(loop, {
          timeScale: dir * gsap.utils.clamp(1, 6, Math.abs(v) / 260), duration: 0.25, overwrite: true,
          onComplete: () => gsap.to(loop, { timeScale: dir, duration: 1.4, overwrite: true }),
        });
        skew(gsap.utils.clamp(-7, 7, v / -380));
        clearTimeout(rest);
        rest = setTimeout(() => skew(0), 140);
      },
    });
  }

  function manifesto() {
    const text = $('.manifesto__text', app);
    if (text && Split) {
      afterFonts(text, () => {
        const s = Split.create(text, { type: 'words' });
        gsap.fromTo(s.words, { opacity: 0.12 }, {
          opacity: 1, stagger: 0.1, ease: 'none',
          scrollTrigger: { trigger: text, start: 'top 82%', end: 'bottom 45%', scrub: true },
        });
      });
    }
    $$('[data-count]', app).forEach((b) => {
      const o = { v: 0 };
      b.textContent = '0';
      gsap.to(o, {
        v: +b.dataset.count, duration: 2.2, ease: 'power2.out',
        scrollTrigger: { trigger: b, start: 'top 90%', once: true },
        onUpdate: () => { b.textContent = Math.round(o.v); },
      });
    });
    gsap.from($$('.stats > div', app), {
      autoAlpha: 0, y: 40, duration: 1.2, ease: EASE, stagger: 0.1,
      scrollTrigger: { trigger: '.stats', start: 'top 90%' },
    });
  }

  function collections() {
    const sec = $('.collections', app);
    if (!sec) return;
    const track = $('.collections__track', sec);
    const viewport = $('.collections__viewport', sec);
    mm = gsap.matchMedia();
    mm.add('(min-width: 901px)', () => {
      const dist = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
      const tween = gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: { trigger: sec, start: 'center center', end: () => '+=' + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1 },
      });
      $$('.coll', track).forEach((c) => {
        gsap.fromTo($('.coll__media img', c), { xPercent: -7 }, {
          xPercent: 7, ease: 'none',
          scrollTrigger: { trigger: c, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
        });
      });
    });
    gsap.from($$('.coll', track), {
      autoAlpha: 0, y: 80, duration: 1.4, ease: EASE, stagger: 0.08,
      scrollTrigger: { trigger: viewport, start: 'top 85%' },
    });
  }

  function editorial() {
    $$('.split', app).forEach((sp) => {
      gsap.fromTo($$('.split__frame', sp), { clipPath: 'inset(0% 0% 100% 0%)' }, {
        clipPath: 'inset(0% 0% 0% 0%)', duration: 1.6, ease: 'expo.inOut', stagger: 0.15,
        scrollTrigger: { trigger: sp, start: 'top 75%' },
      });
      gsap.fromTo($$('.split__frame img', sp), { yPercent: -6 }, {
        yPercent: 6, ease: 'none', scrollTrigger: { trigger: sp, start: 'top bottom', end: 'bottom top', scrub: true },
      });
      gsap.from($$('.split__text > :not(h2)', sp), {
        autoAlpha: 0, y: 30, duration: 1.2, ease: EASE, stagger: 0.1,
        scrollTrigger: { trigger: sp, start: 'top 70%' },
      });
    });
    const flash = $('.flash__inner', app);
    if (flash) gsap.from(flash.children, { autoAlpha: 0, y: 24, duration: 1.1, ease: EASE, stagger: 0.1, scrollTrigger: { trigger: flash, start: 'top 92%' } });
    const perks = $$('.perk', app);
    if (perks.length) gsap.from(perks, { autoAlpha: 0, y: 30, duration: 1.1, ease: EASE, stagger: 0.09, scrollTrigger: { trigger: perks[0], start: 'top 92%' } });
    const news = $('.newsletter', app);
    if (news) gsap.from($$('.newsletter > :not(h2)', app), { autoAlpha: 0, y: 24, duration: 1.1, ease: EASE, stagger: 0.08, scrollTrigger: { trigger: news, start: 'top 80%' } });
  }

  function common() {
    $$('.section__title, .split__text h2, .newsletter h2', app).forEach((el) => {
      splitLines(el, { scrollTrigger: { trigger: el, start: 'top 90%' } });
    });
    $$('.page-title', app).forEach((el) => splitLines(el, { delay: 0.1 }));
    $$('.section__kicker', app).forEach((k) => {
      gsap.from(k, { autoAlpha: 0, x: -24, duration: 1.1, ease: EASE, scrollTrigger: { trigger: k, start: 'top 92%' } });
    });
  }

  function product() {
    const main = $('.gallery__main', app);
    if (!main) return;
    gsap.fromTo(main, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.inOut', clearProps: 'clipPath' });
    gsap.fromTo($('img', main), { scale: 1.3 }, { scale: 1, duration: 1.8, ease: EASE, clearProps: 'transform' });
    gsap.from($$('.gallery__thumbs button', app), { autoAlpha: 0, y: 20, duration: 0.9, ease: EASE, stagger: 0.06, delay: 0.35 });
    gsap.from($$('.info > *', app), { autoAlpha: 0, y: 26, duration: 1, ease: EASE, stagger: 0.05, delay: 0.15 });
  }

  function cards() {
    const fresh = $$('.card:not([data-m])', app);
    if (!fresh.length || !ctx) return false;
    fresh.forEach((c) => { c.dataset.m = '1'; });
    ctx.add(() => {
      gsap.set(fresh, { autoAlpha: 0, y: 56 });
      ST.batch(fresh, {
        start: 'top 94%', once: true,
        onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: 1.15, ease: EASE, stagger: 0.08, overwrite: true }),
      });
    });
    return true;
  }

  function setupPage(d) {
    if (mm) { mm.revert(); mm = null; }
    if (ctx) ctx.revert();
    if (!d.initial && !d.keepScroll) pageIn();
    gen++;
    ctx = gsap.context(() => {
      if (d.page === 'home') { hero(); marquee(); manifesto(); collections(); }
      if (d.page === 'product') product();
      editorial();
      common();
    }, app);
    cards();
    requestAnimationFrame(() => ST.refresh());
  }

  let firstRender = !app.children.length;
  document.addEventListener('ns:render', (e) => {
    if (lenis && !e.detail.keepScroll) lenis.scrollTo(0, { immediate: true, force: true });
    setupPage(firstRender ? Object.assign({}, e.detail, { initial: true }) : e.detail);
    firstRender = false;
  });
  if (!firstRender) setupPage({ page: document.body.dataset.page || 'home', keepScroll: true, initial: true });

  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (cards()) ST.refresh();
    });
  }).observe(app, { childList: true, subtree: true });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ST.refresh());
  window.addEventListener('load', () => ST.refresh());

  gsap.from('.footer__grid > div', {
    autoAlpha: 0, y: 34, duration: 1.2, ease: EASE, stagger: 0.1,
    scrollTrigger: { trigger: '.footer', start: 'top 92%', once: true },
  });

  /* ---------- magnetic buttons ---------- */
  if (fine) {
    const MAG = '.btn:not(.btn--block), .icon-btn, .rail-nav button, .wish-btn';
    let held = null;
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest ? e.target.closest(MAG) : null;
      if (el !== held) {
        if (held) gsap.to(held, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.35)' });
        held = el;
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const k = el.classList.contains('btn') ? 0.26 : 0.38;
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * k, y: (e.clientY - r.top - r.height / 2) * k, duration: 0.6, ease: 'power3.out' });
    }, { passive: true });
  }

  /* ---------- cursor ---------- */
  if (fine) {
    const cur = document.createElement('div');
    cur.className = 'cursor is-hidden';
    cur.innerHTML = '<div class="cursor__ring"><span class="cursor__label"></span></div>';
    document.body.appendChild(cur);
    html.classList.add('has-cursor');
    const label = $('.cursor__label', cur);
    const xTo = gsap.quickTo(cur, 'x', { duration: 0.45, ease: 'power3' });
    const yTo = gsap.quickTo(cur, 'y', { duration: 0.45, ease: 'power3' });
    document.addEventListener('pointermove', (e) => {
      xTo(e.clientX); yTo(e.clientY);
      cur.classList.remove('is-hidden');
      const t = e.target.closest ? e.target : null;
      const media = t && t.closest('[data-cursor]');
      const link = !media && t && t.closest('a, button, select, label, summary, [role="button"]');
      cur.classList.toggle('is-media', !!media);
      cur.classList.toggle('is-link', !!link);
      if (media && label.textContent !== media.dataset.cursor) label.textContent = media.dataset.cursor;
    }, { passive: true });
    document.addEventListener('pointerdown', () => cur.classList.add('is-down'));
    document.addEventListener('pointerup', () => cur.classList.remove('is-down'));
    html.addEventListener('mouseleave', () => cur.classList.add('is-hidden'));
  }

  /* ---------- fly to cart ---------- */
  document.addEventListener('ns:added', (e) => {
    const card = e.detail.el.closest('.card');
    const img = card && $('.card__img', card);
    const target = $('#cartBtn');
    if (!img || !target) return;
    const wasHidden = header.classList.contains('is-hidden');
    header.classList.remove('is-hidden');
    const a = img.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const by = b.top + (wasHidden ? header.offsetHeight : 0);
    const fly = img.cloneNode();
    fly.className = 'fly';
    Object.assign(fly.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
    document.body.appendChild(fly);
    gsap.timeline({ onComplete: () => fly.remove() })
      .to(fly, {
        x: b.left + b.width / 2 - (a.left + a.width / 2), y: by + b.height / 2 - (a.top + a.height / 2),
        scale: 0.08, rotate: 10, borderRadius: '50%', duration: 0.95, ease: 'power3.inOut',
      })
      .to(fly, { autoAlpha: 0, duration: 0.2 }, '-=0.15')
      .fromTo(target, { scale: 1 }, { scale: 1.28, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' }, '-=0.1');
  });
})();
