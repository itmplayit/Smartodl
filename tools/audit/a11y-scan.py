import asyncio, json
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:5173'
PAGES=['/','/courses','/courses/1','/quizzes','/coding','/leaderboard','/pricing','/help','/admin','/admin/certificates','/admin/certificate-templates','/student']
JS = r"""
() => {
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim();
  const noName = [...document.querySelectorAll('button, a, [role=button]')]
      .filter(el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && !name(el) && !el.querySelector('img[alt]:not([alt=""])'); })
      .map(el => el.outerHTML.slice(0, 90));
  const imgNoAlt = [...document.querySelectorAll('img:not([alt])')].map(i => i.src.slice(-50));
  const inputNoLabel = [...document.querySelectorAll('input:not([type=hidden]):not([aria-label]):not([placeholder]), select:not([aria-label]), textarea:not([aria-label])')]
      .filter(el => { const id = el.id; return !(id && document.querySelector(`label[for="${id}"]`)) && !el.closest('label') && !el.getAttribute('aria-labelledby'); })
      .map(el => el.outerHTML.slice(0, 80));
  const hSkips = (() => { const hs=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>+h.tagName[1]); let bad=0, prev=0;
    for (const l of hs) { if (prev && l > prev + 1) bad++; prev = l; } return bad; })();
  const noH1 = document.querySelectorAll('h1').length === 0;
  return { noName: noName.slice(0, 6), imgNoAlt: imgNoAlt.slice(0, 6), inputNoLabel: inputNoLabel.slice(0, 6),
           hSkips, noH1, links: [...document.querySelectorAll('a[href^="/"]')].map(a=>a.getAttribute('href')) };
}
"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1366,'height':900})
        await pg.goto(BASE+'/login', wait_until='domcontentloaded'); await pg.wait_for_timeout(1200)
        await pg.fill('input[type=email]','owner@test.local'); await pg.fill('input[type=password]','pass')
        await pg.click('form button.btn-primary'); await pg.wait_for_timeout(2500)
        allinks=set(); report={}
        for path in PAGES:
            await pg.goto(BASE+path, wait_until='domcontentloaded'); await pg.wait_for_timeout(2000)
            r = await pg.evaluate(JS); allinks.update(r.pop('links')); report[path]=r
        print('=== internal links found:', len(allinks))
        # dead-link check: HTTP status of each internal route (SPA returns 200 always, so check API 404s instead)
        bad = {k:v for k,v in report.items() if v['noName'] or v['imgNoAlt'] or v['inputNoLabel'] or v['hSkips'] or v['noH1']}
        for k,v in bad.items():
            print(f'\n{k}')
            for b_ in v['noName']: print('   button/link without name:', b_[:80])
            for i in v['imgNoAlt']: print('   img without alt:', i)
            for i in v['inputNoLabel']: print('   input without label:', i)
            if v['hSkips']: print('   heading level skips:', v['hSkips'])
            if v['noH1']: print('   no <h1> on page')
        json.dump(sorted(allinks), open('/home/user/audit/links.json','w'), indent=0)
        await b.close()
asyncio.run(main())
