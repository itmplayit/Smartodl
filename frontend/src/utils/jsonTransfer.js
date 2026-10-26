const MAX_JSON_BYTES = 4 * 1024 * 1024;

export const safeJsonFilename = (value, fallback = 'smartodl-export') => {
  const clean = String(value || fallback)
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
};

export function downloadJson(payload, filename) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile(file, expectedKind = null) {
  if (!file) throw new Error('Choose a JSON file first');
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') throw new Error('Only .json files are supported');
  if (file.size > MAX_JSON_BYTES) throw new Error('JSON package is too large (maximum 4 MB)');
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (_) { throw new Error('The selected file is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON package must contain an object');

  const pack = parsed.package && typeof parsed.package === 'object' && !Array.isArray(parsed.package)
    ? parsed.package
    : parsed;
  if (expectedKind && pack.kind !== expectedKind) {
    if (pack.kind === 'coding-problems' && expectedKind === 'quizzes') {
      throw new Error('This file contains Coding Problems, not quizzes. Import it from Coding Arena → Problem Management or Test Case Workbench.');
    }
    if (pack.kind === 'quizzes' && expectedKind === 'coding-problems') {
      throw new Error('This file contains Quizzes, not standalone coding problems. Import it from Quiz Management or Live Hosting.');
    }
    throw new Error(`Unsupported JSON package type${pack.kind ? `: ${pack.kind}` : ''}`);
  }
  return parsed;
}

export function transferCount(payload) {
  const pack = payload?.package && typeof payload.package === 'object' ? payload.package : payload;
  return Array.isArray(pack?.items) ? pack.items.length : 0;
}
