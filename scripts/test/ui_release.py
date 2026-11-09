"""Проверка через интерфейс (как владелец магазина): чистая база → товар → заказ с телефона → оплата → отчёт → отмена.
python3 scripts/test/ui_release.py <base_url> <admin_password> <out_dir>
"""
import sys, os, json
from playwright.sync_api import sync_playwright
from PIL import Image

BASE, PW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
photo = os.path.join(OUT, 'dress.jpg')
img = Image.new('RGB', (900, 1200), (110, 20, 40))
for y in range(300, 1100):
    for x in range(300 + (y - 300) // 6 * 0, 600):
        pass
img.save(photo, quality=85)
results = []


def ok(name, cond, info=''):
    results.append((bool(cond), name))
    print(('  ✓ ' if cond else '  ✗ ') + name + ('' if cond else '  ' + str(info)[:300]))


def api(page, path, body=None, token=True):
    return page.evaluate("""async ([path, body, useTok]) => {
      const h = {'Content-Type': 'application/json'};
      const t = localStorage.getItem('ns_admin_token') || localStorage.getItem('nsAdminToken');
      if (useTok && NS && NS.token) h.Authorization = 'Bearer ' + NS.token;
      const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined});
      return r.json();
    }""", [path, body, token])


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    block = lambda r: r.abort() if not r.request.url.startswith(BASE) else r.continue_()

    # ---------- владелец за компьютером ----------
    print('\n# Админка на компьютере (чистая база)')
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.route('**/*', block)
    page.goto(BASE + '/admin/', wait_until='domcontentloaded')
    page.fill('input[name=password]', PW)
    page.keyboard.press('Enter')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/d-01-dashboard-empty.png')
    body = page.inner_text('body')
    ok('главный экран: подсказка «Добавьте первый товар»', 'Добавьте первый товар' in body)
    ok('главный экран без демо-данных (заказов нет)', 'Заказов пока нет' in body)

    page.evaluate("location.hash = '#/products'")
    page.wait_for_timeout(700)
    ok('раздел «Товары»: пустой каталог объяснён', 'Каталог пока пуст' in page.inner_text('body'))
    page.screenshot(path=f'{OUT}/d-02-products-empty.png')

    # новый товар через форму
    page.locator('#topbarActions [data-new]').click()
    page.wait_for_timeout(500)
    f = page.locator('#pForm')
    f.locator('input[name=title]').fill('Платье «Самарканд»')
    f.locator('input[name=brand]').fill('Nargizka')
    f.locator('input[name=cost]').fill('700000')
    f.locator('input[name=price]').fill('1900000')
    f.locator('input[name=price]').dispatch_event('input')
    f.locator('label.color-pick', has_text='Бордо').click()
    page.wait_for_timeout(300)
    rows = f.locator('#vGrid tbody tr')
    ok('таблица остатков: строка на каждый цвет', rows.count() == 2, rows.count())
    f.locator('[data-v="Бордо|M"]').fill('2')
    f.locator('[data-v="Бордо|L"]').fill('1')
    first_color = f.locator('#vGrid tbody tr').first.locator('td').first.inner_text().strip()
    f.locator('#vGrid tbody tr').first.locator('input').nth(1).fill('3')
    f.locator('#vGrid tbody tr').first.locator('input').nth(1).dispatch_event('input')
    page.set_input_files('#imgFile', photo)
    page.wait_for_timeout(2500)
    ok('фото загружено в карточку', page.locator('#imgList img').count() == 1)
    calc = page.inner_text('#calc')
    ok('подсказка о прибыли с 1 шт.', 'Прибыль с 1 шт.' in calc, calc)
    page.screenshot(path=f'{OUT}/d-03-product-form.png', full_page=True)
    f.locator('button[type=submit]').click()
    page.wait_for_timeout(1500)
    db = api(page, '/api/admin/db')['db']
    prod = next((x for x in db['products'] if x['name'] == 'Платье «Самарканд»'), None)
    ok('товар сохранён: 2 цвета, 6 шт., закупка 700 000', prod and len(prod['colors']) == 2 and sum(prod['vstock'].values()) == 6 and prod['cost'] == 700000, prod and prod['vstock'])
    ok('фото товара хранится постоянно (/uploads/…)', prod and prod['images'] and prod['images'][0].startswith('/uploads/'))
    page.screenshot(path=f'{OUT}/d-04-products-list.png')

    # поступление
    page.locator('#topbarActions [data-stock-in]').click()
    page.wait_for_timeout(500)
    page.locator('#stockMoveForm [data-mv="Бордо|S"]').fill('4')
    page.locator('#stockMoveForm input[name=unitCost]').fill('650000')
    page.locator('#stockMoveForm input[name=unitCost]').dispatch_event('input')
    page.screenshot(path=f'{OUT}/d-05-stock-in.png')
    page.locator('#stockMoveForm button[type=submit]').click()
    page.wait_for_timeout(1200)
    db = api(page, '/api/admin/db')['db']
    prod = next(x for x in db['products'] if x['name'] == 'Платье «Самарканд»')
    ok('поступление через форму: Бордо S = 4', prod['vstock'].get('Бордо|S') == 4)
    ok('оплата поставщику записана в финансы', any(e['category'] == 'Закупка товара' and e['amount'] == 2600000 for e in db['finance']['entries']))
    page.locator('[data-ptab=moves]').click()
    page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/d-06-stock-journal.png')
    ok('журнал склада показывает поступление', 'Поступление' in page.inner_text('#view') if page.locator('#view').count() else 'Поступление' in page.inner_text('body'))
    ctx_admin = ctx

    # ---------- покупатель с телефона ----------
    print('\n# Покупатель со смартфона')
    m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    mp = m.new_page()
    merr = []
    mp.on('pageerror', lambda e: merr.append(str(e)))
    mp.route('**/*', block)
    mp.goto(BASE + '/#/product/' + prod['id'], wait_until='domcontentloaded')
    mp.wait_for_timeout(1500)
    mp.screenshot(path=f'{OUT}/m-01-product.png')
    ok('карточка товара открылась на смартфоне', 'Самарканд' in mp.inner_text('body'))
    sw, vw = mp.evaluate('[document.documentElement.scrollWidth, innerWidth]')
    ok('нет горизонтальной прокрутки', sw <= vw + 1, (sw, vw))
    # выбираем Бордо: XL в нём нет
    bordo_idx = prod['colors'].index('Бордо')
    mp.locator(f'[data-color="{bordo_idx}"]').click()
    mp.wait_for_timeout(300)
    ok('для Бордо размер XS недоступен', mp.locator('[data-size-pick="XS"]').is_disabled())
    ok('для Бордо размер M доступен', not mp.locator('[data-size-pick="M"]').is_disabled())
    mp.locator('[data-size-pick="M"]').click()
    mp.locator('#addBtn').click()
    mp.wait_for_timeout(700)
    cart = json.loads(mp.evaluate("localStorage.getItem('ns_cart')") or '[]')
    ok('в корзине Бордо M', cart and cart[0]['color'] == 'Бордо' and cart[0]['size'] == 'M', cart)
    mp.goto(BASE + '/#/checkout', wait_until='domcontentloaded')
    mp.wait_for_timeout(1000)
    mp.fill('input[name=name]', 'Мадина Тестовая')
    mp.fill('input[name=phone]', '+998 97 111 22 33')
    if mp.locator('input[name=city]').is_visible():
        mp.fill('input[name=city]', 'Ташкент')
        mp.fill('input[name=address]', 'Мирабад, 7')
    pay = mp.locator('input[name=payment]')
    if pay.count():
        pay.first.check(force=True)
    mp.screenshot(path=f'{OUT}/m-02-checkout.png', full_page=True)
    with mp.expect_response(lambda r: '/api/orders' in r.url, timeout=15000) as resp:
        mp.locator('button[type=submit]', has_text='Подтвердить').click()
    ok('заказ оформлен со смартфона', resp.value.status == 200, resp.value.status)
    order_id = resp.value.json()['order']['id']
    mp.wait_for_timeout(1000)
    mp.screenshot(path=f'{OUT}/m-03-done.png')
    ok('нет ошибок JavaScript на витрине', not [e for e in merr if 'gsap' not in e.lower() and 'lenis' not in e.lower()], merr[:3])

    # ---------- владелец обрабатывает заказ ----------
    print('\n# Обработка заказа и отчёты')
    page.evaluate("location.hash = '#/orders'")
    page.wait_for_timeout(1500)
    page.evaluate("NS.loadAdmin().then(() => { location.hash = '#/dashboard'; location.hash = '#/orders'; })")
    page.wait_for_timeout(1500)
    ok('заказ появился в админке, «не оплачен»', order_id in page.inner_text('body') and 'не оплачен' in page.inner_text('body'))
    page.screenshot(path=f'{OUT}/d-07-orders.png')
    page.locator(f'[data-order="{order_id}"]').first.click()
    page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/d-08-order-modal.png')
    page.locator(f'[data-order-paid="{order_id}"]').click()
    page.wait_for_timeout(1200)
    db = api(page, '/api/admin/db')['db']
    o = next(x for x in db['orders'] if x['id'] == order_id)
    ok('статус оплаты изменён через карточку заказа', o['paid'] is True)
    prod = next(x for x in db['products'] if x['id'] == prod['id'])
    ok('остаток Бордо M списан (2 → 1)', prod['vstock'].get('Бордо|M') == 1)
    page.keyboard.press('Escape')
    page.evaluate("location.hash = '#/finance'")
    page.wait_for_timeout(900)
    page.locator('[data-fin-tab=profit]').click()
    page.wait_for_timeout(600)
    txt = page.inner_text('body').replace('\u00a0', ' ').replace('\u202f', ' ')
    fmt = lambda n: '{:,}'.format(n).replace(',', ' ')
    total = o['total']
    cogs = sum(i['cost'] * i['qty'] for i in o['items'])
    ok('отчёт о прибыли: выручка = сумма заказа с доставкой (%s)' % fmt(total), fmt(total) in txt, txt[:200])
    ok('отчёт: себестоимость %s и валовая прибыль %s' % (fmt(cogs), fmt(total - cogs)), fmt(cogs) in txt and fmt(total - cogs) in txt)
    ok('отчёт помечен как управленческий', 'не заменяет бухгалтерскую' in txt)
    page.screenshot(path=f'{OUT}/d-09-finance-profit.png', full_page=True)
    # отмена заказа
    page.evaluate("location.hash = '#/orders'")
    page.wait_for_timeout(700)
    page.locator(f'[data-order="{order_id}"]').first.click()
    page.wait_for_timeout(400)
    page.locator(f'[data-order-status="{order_id}"][data-v="Отменён"]').click()
    page.wait_for_timeout(1300)
    db = api(page, '/api/admin/db')['db']
    o = next(x for x in db['orders'] if x['id'] == order_id)
    prod = next(x for x in db['products'] if x['id'] == prod['id'])
    ok('отмена: товар вернулся (Бордо M = 2), деньги отмечены возвращёнными', prod['vstock'].get('Бордо|M') == 2 and o['refunded'] is True)
    page.evaluate("location.hash = '#/settings'")
    page.wait_for_timeout(700)
    ok('настройки: раздел «Бренд магазина»', 'Бренд магазина' in page.inner_text('body'))
    ok('кнопки «Сбросить к демо-данным» больше нет', 'Сбросить к демо' not in page.inner_text('body'))
    page.screenshot(path=f'{OUT}/d-10-settings.png', full_page=True)
    ok('нет ошибок JavaScript в админке', not errors, errors[:3])

    # ---------- админка на телефоне ----------
    print('\n# Админка на телефоне')
    ma = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ap = ma.new_page()
    aerr = []
    ap.on('pageerror', lambda e: aerr.append(str(e)))
    ap.route('**/*', block)
    ap.goto(BASE + '/admin/', wait_until='domcontentloaded')
    ap.fill('input[name=password]', PW)
    ap.keyboard.press('Enter')
    ap.wait_for_timeout(1500)
    for v in ['dashboard', 'products', 'orders', 'finance']:
        ap.evaluate(f"location.hash = '#/{v}'")
        ap.wait_for_timeout(800)
        ap.screenshot(path=f'{OUT}/ma-{v}.png')
        sw, vw = ap.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        ok(f'админка «{v}» на телефоне без горизонтальной прокрутки', sw <= vw + 1, (sw, vw))
    ap.evaluate("location.hash = '#/products'")
    ap.wait_for_timeout(500)
    ap.locator('#topbarActions [data-new]').click()
    ap.wait_for_timeout(600)
    ap.screenshot(path=f'{OUT}/ma-product-form.png', full_page=True)
    ok('нет ошибок JavaScript (админка на телефоне)', not aerr, aerr[:3])
    browser.close()

bad = [r for r in results if not r[0]]
print('\nИтог UI: %d пройдено, %d с ошибками' % (len(results) - len(bad), len(bad)))
sys.exit(1 if bad else 0)
