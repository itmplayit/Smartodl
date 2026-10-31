import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:5173'
PUBLIC = ['/', '/courses', '/courses/1', '/notes', '/quizzes', '/quizzes/1', '/interviews',
          '/coding', '/contests', '/leaderboard', '/about', '/pricing', '/contact',
          '/search?q=c', '/verify-certificate', '/faq', '/terms', '/privacy', '/refund',
          '/cookies', '/disclaimer', '/accessibility', '/code-of-conduct',
          '/login', '/register', '/forgot-password', '/reset-password', '/this-page-does-not-exist']
STUDENT = ['/student', '/student/courses', '/student/achievements', '/student/results',
           '/student/certificates', '/profile', '/settings', '/subscription']
ADMIN = ['/admin', '/admin/users', '/admin/students', '/admin/developers', '/admin/colleges',
         '/admin/plans', '/admin/courses', '/admin/courses/new', '/admin/courses/1',
         '/admin/courses/1/enrollments', '/admin/categories', '/admin/modules', '/admin/notes',
         '/admin/quizzes', '/admin/quizzes/1', '/admin/problems', '/admin/test-cases',
         '/admin/contests', '/admin/submissions', '/admin/plagiarism', '/admin/leaderboard',
         '/admin/points', '/admin/pages', '/admin/upi-payments', '/admin/achievements',
         '/admin/notifications', '/admin/reports', '/admin/landing-builder', '/admin/settings',
         '/admin/features', '/admin/integrity-scores', '/admin/proctor-recordings',
         '/admin/proctor-test', '/admin/certificates', '/admin/certificate-templates',
         '/admin/courses/1/enrollments']

IGNORE = ('favicon', 'chrome-extension', 'ResizeObserver', 'Download the React DevTools',
          'third-party cookie', 'preloaded using link preload')

async def login(pg, email):
    await pg.goto(BASE + '/login', wait_until='domcontentloaded'); await pg.wait_for_timeout(1200)
    await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', 'pass')
    await pg.click('form button.btn-primary'); await pg.wait_for_timeout(2500)

async def crawl(pg, paths, out):
    for path in paths:
        errors, bad = [], []
        def on_console(m):
            if m.type == 'error' and not any(i in m.text for i in IGNORE):
                errors.append(m.text[:220])
        def on_pageerror(e):
            errors.append('UNCAUGHT: ' + str(e)[:220])
        def on_resp(r):
            if r.status >= 400 and '/api/' in r.url and r.request.resource_type in ('xhr', 'fetch'):
                bad.append(f'{r.status} {r.request.method} {r.url.replace(BASE,"")}')
        pg.on('console', on_console); pg.on('pageerror', on_pageerror); pg.on('response', on_resp)
        try:
            await pg.goto(BASE + path, wait_until='domcontentloaded', timeout=25000)
            await pg.wait_for_timeout(2200)
            text = (await pg.inner_text('body'))[:400]
            title = await pg.title()
        except Exception as e:
            errors.append('NAV: ' + str(e)[:160]); text = ''; title = ''
        pg.remove_listener('console', on_console); pg.remove_listener('pageerror', on_pageerror); pg.remove_listener('response', on_resp)
        out.append({'path': path, 'title': title, 'errors': sorted(set(errors)),
                    'bad_requests': sorted(set(bad)), 'empty': len(text.strip()) < 40})

async def main():
    result = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # --- anonymous ---
        pg = await b.new_page(viewport={'width': 1366, 'height': 900})
        await pg.add_init_script("localStorage.setItem('smartodl-theme','dark')")
        anon = []
        await crawl(pg, PUBLIC, anon)
        result['anonymous'] = anon
        await pg.close()
        # --- student ---
        pg = await b.new_page(viewport={'width': 1366, 'height': 900})
        await pg.add_init_script("localStorage.setItem('smartodl-theme','dark')")
        await login(pg, 'stu@test.local')
        stu = []
        await crawl(pg, STUDENT, stu)
        result['student'] = stu
        await pg.close()
        # --- admin ---
        pg = await b.new_page(viewport={'width': 1366, 'height': 900})
        await pg.add_init_script("localStorage.setItem('smartodl-theme','dark')")
        await login(pg, 'owner@test.local')
        adm = []
        await crawl(pg, ADMIN, adm)
        result['admin'] = adm
        await b.close()
    json.dump(result, open('/home/user/audit/crawl.json', 'w'), indent=1)
    for role, rows in result.items():
        bad = [r for r in rows if r['errors'] or r['bad_requests'] or r['empty']]
        print(f'\n### {role}: {len(rows)} pages, {len(bad)} with problems')
        for r in bad:
            print(f"  {r['path']}{' [EMPTY]' if r['empty'] else ''}")
            for e in r['errors'][:3]: print(f'     js  : {e}')
            for q in r['bad_requests'][:4]: print(f'     http: {q}')
asyncio.run(main())
