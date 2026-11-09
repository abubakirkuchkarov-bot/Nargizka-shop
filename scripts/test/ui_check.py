"""Браузерная проверка витрины и админки (компьютер и телефон).
python3 scripts/test/ui_check.py <base_url> <admin_password> <out_dir>
"""
import sys, os, json
from playwright.sync_api import sync_playwright

BASE, PW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
results = []


def ok(name, cond, info=''):
    results.append((bool(cond), name, info))
    print(('  ✓ ' if cond else '  ✗ ') + name + ('' if cond else '  ' + str(info)[:300]))


def run(p, label, ctx_args):
    print('\n#', label)
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(**ctx_args)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # внешние CDN (шрифты, GSAP) в тестовой среде недоступны — блокируем, чтобы не ждать
    page.route('**/*', lambda r: r.abort() if not r.request.url.startswith(BASE) else r.continue_())
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{label}-home.png', full_page=False)
    body = page.inner_text('body')
    ok('главная загрузилась', 'Nargizka' in page.title())
    ok('нет искажённых букв «ѝ»', 'ѝ' not in body)
    page.goto(BASE + '/#/catalog', wait_until='domcontentloaded')
    page.wait_for_timeout(1200)
    cards = page.locator('.card').count()
    ok('каталог показывает товары', cards >= 12, cards)
    page.screenshot(path=f'{OUT}/{label}-catalog.png')
    # горизонтальная прокрутка на телефоне — частая ошибка вёрстки
    sw = page.evaluate('document.documentElement.scrollWidth')
    vw = page.evaluate('window.innerWidth')
    ok('нет горизонтальной прокрутки (%s/%s)' % (sw, vw), sw <= vw + 1, (sw, vw))

    # карточка товара → размер → в корзину
    db = page.evaluate("fetch('/api/db').then(r=>r.json())")
    prod = next(x for x in db['db']['products'] if any(v >= 2 for v in x['stock'].values()))
    page.goto(BASE + '/#/product/' + prod['id'], wait_until='domcontentloaded')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{OUT}/{label}-product.png')
    page.locator('[data-size-pick]:not([disabled])').first.click()
    page.locator('#addBtn').click()
    page.wait_for_timeout(600)
    cart = page.evaluate("localStorage.getItem('ns_cart')")
    ok('товар добавлен в корзину', cart and prod['id'] in cart, cart)
    page.screenshot(path=f'{OUT}/{label}-cart.png')

    # оформление заказа
    page.goto(BASE + '/#/checkout', wait_until='domcontentloaded')
    page.wait_for_timeout(1000)
    form_text = page.inner_text('body')
    ok('форма заказа без искажений («Имя и фамилия», «Адрес»)', 'Имя и фамилия' in form_text and 'Адрес' in form_text)
    page.fill('input[name=name]', 'Тестовая Покупательница UI')
    page.fill('input[name=phone]', '+998 97 765 43 21')
    if page.locator('input[name=city]').count() and page.locator('input[name=city]').is_visible():
        page.fill('input[name=city]', 'Ташкент')
        page.fill('input[name=address]', 'Мирабад, 7')
    pay = page.locator('input[name=payment]')
    if pay.count():
        pay.first.check(force=True)
    page.screenshot(path=f'{OUT}/{label}-checkout.png', full_page=True)
    with page.expect_response(lambda r: '/api/orders' in r.url, timeout=15000) as resp:
        page.locator('button[type=submit]', has_text='Подтвердить').click()
    r = resp.value
    ok('заказ оформлен через интерфейс', r.status == 200, r.status)
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/{label}-done.png')

    # админка
    page.goto(BASE + '/admin/', wait_until='domcontentloaded')
    page.wait_for_timeout(800)
    page.fill('input[name=password]', PW)
    page.keyboard.press('Enter')
    page.wait_for_timeout(1800)
    page.screenshot(path=f'{OUT}/{label}-admin.png')
    ok('вход в админку', page.locator('input[name=password]').count() == 0 or not page.locator('input[name=password]').first.is_visible())
    admin_text = page.inner_text('body')
    ok('админка: дашборд показывает данные', any(w in admin_text for w in ['Заказ', 'заказ']))
    for view in ['orders', 'products', 'finance', 'catalog', 'settings']:
        page.evaluate("v => { location.hash = '#/' + v }", view)
        page.wait_for_timeout(900)
        page.screenshot(path=f'{OUT}/{label}-admin-{view}.png')
    sw = page.evaluate('document.documentElement.scrollWidth')
    vw = page.evaluate('window.innerWidth')
    ok('админка без горизонтальной прокрутки (%s/%s)' % (sw, vw), sw <= vw + 1, (sw, vw))
    ok('нет ошибок JavaScript', not [e for e in errors if 'gsap' not in e.lower() and 'lenis' not in e.lower()], errors[:5])
    browser.close()


with sync_playwright() as p:
    run(p, 'desktop', dict(viewport={'width': 1440, 'height': 900}))
    run(p, 'mobile', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                          user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))

bad = [r for r in results if not r[0]]
print('\nИтог UI: %d пройдено, %d с ошибками' % (len(results) - len(bad), len(bad)))
sys.exit(1 if bad else 0)
