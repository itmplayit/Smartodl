"""Render the certificate PDF with each integrity band and measure the band strip."""
import json, subprocess, sys, os
from PIL import Image
import fitz

def build(tone, score, out):
    js = f"""
const {{ buildCertificatePdf }} = require('/home/user/Smartodl/backend/services/certificatePdf.service');
const tpl = require('/home/user/Smartodl/backend/services/certificateTemplates.service');
const theme = tpl.buildTheme({{ id: 1, cert_type: 'course', headline: 'Certificate of Completion',
  recipient_line: 'Awarded to', seal_text: 'VERIFIED', label: 'Course Completion', logo_path: null,
  color_bg_from: '#0f172a', color_bg_to: '#0b1020', color_accent: '#fbbf24', color_accent_2: '#fde68a',
  color_accent_3: '#f59e0b', color_seal_from: '#fbbf24', color_seal_to: '#b45309', color_seal_border: '#fde68a' }});
buildCertificatePdf({{
  cert: {{ student_name: 'Integrity Check', display_title: 'Demo Course', certificate_no: 'SOD-CRS-TEST',
    issued_at: new Date().toISOString(), grade: 'A', score_percent: 88, cert_type: 'course', instructor_name: 'Test' }},
  theme, subject: 'has completed the course', meta: [{{ label: 'Grade', value: 'A' }}],
  integrity: {json.dumps({'label': 'Yellow' if tone=='yellow' else 'Red', 'tone': tone, 'score': score, 'available': True})},
  verifyUrl: 'https://example.test/cert/token', siteName: 'SmartODL', tagline: 'Learn. Practice. Compete.'
}}).then(b => {{ require('fs').writeFileSync('{out}', b); process.exit(0); }});
"""
    open('/tmp/_build_pdf.js', 'w').write(js)
    r = subprocess.run(['node', '/tmp/_build_pdf.js'], cwd='/home/user/Smartodl/backend',
                       env={**os.environ}, capture_output=True, text=True)
    if r.returncode: print(r.stderr[:600]); sys.exit(1)

CASES = [('yellow', 65), ('red', 30), ('green', 95)]
for tone, score in CASES:
    out = f'/tmp/integrity-{tone}.pdf'
    build(tone, score, out)
    doc = fitz.open(out)
    pix = doc[0].get_pixmap(dpi=110)
    png = f'/tmp/integrity-{tone}.png'
    pix.save(png)
    img = Image.open(png).convert('RGB')
    w, h = img.size
    # the band strip sits right of the meta row; scan the right third, middle rows
    tints = {}
    for y in range(int(h*0.55), int(h*0.80)):
        for x in range(int(w*0.62), int(w*0.95), 3):
            r, g, b = img.getpixel((x, y))
            if max(r, g, b) > 90 and max(r, g, b) - min(r, g, b) > 30:
                tints[(r//24*24, g//24*24, b//24*24)] = tints.get((r//24*24, g//24*24, b//24*24), 0) + 1
    top = sorted(tints.items(), key=lambda kv: -kv[1])[:3]
    print(f'{tone:6} pdf={os.path.getsize(out)}B png={w}x{h} coloured_pixels={sum(tints.values())} top={top}')
    print(f'       -> {png}')
