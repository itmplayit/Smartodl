/**
 * On-demand object detector for live proctoring (phone / book / laptop in the
 * webcam frame).
 *
 * WHY IT IS LOADED LIKE THIS — please read before "simplifying" it.
 *
 * 1. NOT an npm dependency. Adding @tensorflow/tfjs to package.json would mean
 *    anyone who unzips the project has to remember to run `npm install` again,
 *    and the whole frontend would fail to build if they forgot. The scripts are
 *    fetched at runtime instead, so an install that never switches this feature
 *    on is byte-for-byte unaffected.
 *
 * 2. From a CDN by default, NOT from this server. The model is ~18 MB. A live
 *    quiz with 30 students would otherwise push ~540 MB out through the
 *    operator's own home connection in the first minute of the exam — which is
 *    exactly how you lose an exam. jsDelivr serves it from an edge instead, and
 *    the browser caches it, so it is a one-time cost per device.
 *    Self-hosting is still supported: drop the same files under
 *    /vendor/objdet/ and they win (see LOCAL_BASE below).
 *
 * 3. It must NEVER block an exam. Every failure path — offline, blocked CDN,
 *    old browser, out of memory, slow link — resolves to "detector unavailable"
 *    and the quiz carries on with the other proctoring checks. A student must
 *    not be punished because a model did not download.
 */

const CDN_TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const CDN_COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
// Subresource Integrity for the two pinned CDN builds above. These scripts run
// in the exam origin, so a compromised CDN must not be able to swap them — a
// hash mismatch makes the browser refuse to execute the file.
const CDN_INTEGRITY = {
  [CDN_TFJS]: 'sha384-vE8hbVJ4lezako5rlvE7bY0BVzWlFhZncPlckrqNwcUQpVtgbENTgZ8TBbnPjZre',
  [CDN_COCO]: 'sha384-7qLdgfEQyO9ZQi9ArRHigK+IBto4XPk468jAqc+fnsXaZIcMAhQeLwzggRK7aESl',
};
// If an operator vendors the files locally these are used instead — useful for
// a genuinely air-gapped lab. Checked with a HEAD first so a 404 costs nothing.
const LOCAL_BASE = '/vendor/objdet';

const LOAD_TIMEOUT_MS = 90000;   // generous: first load on a slow link
// Measured, not guessed. On a realistic "person at a desk, phone in hand"
// frame the model scores the phone at only 15% full-frame; tiling the frame
// lifts the same phone to 51%. 0.40 is where a tiled true positive lands
// comfortably while random furniture still stays out. These events are
// advisory by default (see proctoring.service.js), so recall matters more
// than precision here.
// For the record, the 4x larger mobilenet_v2 base measured WORSE on the same
// scenes (17% vs 51% tiled), which is why the lite base is shipped.
const MIN_SCORE = 0.40;

/**
 * Crops fed to the detector in addition to the whole frame, as fractions of
 * the frame. A phone occupying 3% of a 640x480 frame is a handful of pixels
 * after the model's internal 300x300 resize — invisible. Re-running on a crop
 * makes the same phone proportionally large, which is the only thing that
 * moved the numbers (15% -> 51%).
 * Deliberately only four: each one is a full inference.
 */
const TILES = [
  [0, 0, 0.5, 1],      // left half
  [0.5, 0, 0.5, 1],    // right half
  [0, 0.5, 1, 0.5],    // lower half — phone held in the lap/below the desk
  [0.25, 0.25, 0.5, 0.5], // centre
];
const TILE_PX = 300;   // the model's native input size

/** COCO classes worth flagging, mapped to the event the proctor records. */
const WATCHED = {
  'cell phone': 'phone_detected',
  book: 'book_detected',
  laptop: 'device_detected',
  tv: 'device_detected',
  remote: 'device_detected',
  keyboard: 'device_detected',
};

let statePromise = null;   // single in-flight load shared by every caller
let loadState = 'idle';    // idle | loading | ready | failed  (for the UI)
let failedAt = 0;          // when the last full load failure happened
const FAILURE_RETRY_MS = 120000; // retry a failed load at most once per 2 min

/** What the detector is doing right now — the student/admin UI shows this. */
export const detectorState = () => loadState;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-objdet="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script failed')));
      return undefined;
    }
    const el = document.createElement('script');
    el.src = src; el.async = true; el.dataset.objdet = src;
    if (CDN_INTEGRITY[src]) { el.integrity = CDN_INTEGRITY[src]; el.crossOrigin = 'anonymous'; }
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); });
    el.addEventListener('error', () => reject(new Error(`cannot load ${src}`)));
    document.head.appendChild(el);
    return undefined;
  });
}

/**
 * Does a REAL asset live here?
 *
 * A 200 is not enough: an SPA server (Vite in dev, and most static hosts in
 * production) answers unknown paths with index.html rather than a 404, so a
 * missing vendor file looks present and the browser is then handed HTML to
 * execute as JavaScript. The content type is what actually settles it.
 */
async function assetExists(url, expect) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
    if (!r.ok) return false;
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) return false;      // SPA fallback
    return expect ? type.includes(expect) : true;
  } catch (_) { return false; }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

/**
 * Resolve to a detector, or to null when it cannot be had. Never rejects —
 * callers are exam code and must not have to care.
 */
export function getDetector() {
  if (statePromise && loadState === 'failed' && Date.now() - failedAt > FAILURE_RETRY_MS) {
    // A failure used to be cached for the whole exam: one network blip in
    // minute 1 disabled detection in minute 40 too, long after the link
    // recovered. Clear the cached failure after a cooldown so the next
    // sample retries the load; samples inside the cooldown still
    // short-circuit instantly and never re-download anything.
    statePromise = null;
    loadState = 'idle';
  }
  if (statePromise) return statePromise;
  loadState = 'loading';
  statePromise = (async () => {
    const localScriptsReady = await Promise.all([
      assetExists(`${LOCAL_BASE}/tf.min.js`, 'javascript'),
      assetExists(`${LOCAL_BASE}/coco-ssd.min.js`, 'javascript'),
    ]).then(([tf, coco]) => tf && coco);

    // Treat TFJS + COCO-SSD as one atomic bundle. The old code selected the
    // whole local path when only tf.min.js existed, so a partial vendor copy
    // permanently disabled detection instead of falling back to the pinned,
    // SRI-protected CDN pair. A corrupt local model gets the same fallback.
    const attempts = [];
    if (localScriptsReady) {
      attempts.push({
        local: true,
        tfUrl: `${LOCAL_BASE}/tf.min.js`,
        cocoUrl: `${LOCAL_BASE}/coco-ssd.min.js`,
      });
    }
    attempts.push({ local: false, tfUrl: CDN_TFJS, cocoUrl: CDN_COCO });

    for (const attempt of attempts) {
      try {
        await withTimeout(loadScript(attempt.tfUrl), LOAD_TIMEOUT_MS, 'tfjs');
        await withTimeout(loadScript(attempt.cocoUrl), LOAD_TIMEOUT_MS, 'coco-ssd');
        if (!window.cocoSsd || !window.tf) throw new Error('globals missing after load');

        const opts = { base: 'lite_mobilenet_v2' };
        if (attempt.local && await assetExists(`${LOCAL_BASE}/model.json`, 'json')) {
          opts.modelUrl = `${LOCAL_BASE}/model.json`;
        }
        const model = await withTimeout(window.cocoSsd.load(opts), LOAD_TIMEOUT_MS, 'model');
        loadState = 'ready';
        return model;
      } catch (_) {
        // Try the next complete bundle. Failure is cached only after every
        // source has failed, so one broken local copy cannot poison the CDN.
      }
    }

    loadState = 'failed';
    failedAt = Date.now();
    // Remember the failure (see FAILURE_RETRY_MS) so later samples
    // short-circuit instead of re-downloading 18 MB on a connection that
    // already proved it cannot — but only for the cooldown, not forever.
    return null;
  })();
  return statePromise;
}

/**
 * Detect watched objects in a video element.
 * Returns [] when the detector is unavailable or nothing was seen, and
 * `null` ONLY when the detector could not be loaded at all — the caller uses
 * that to emit `object_check_unavailable` exactly once.
 */
let tileCanvas = null;

/** Run the model over one crop of the source, upscaled to its native size. */
async function detectTile(model, src, box, w, h) {
  if (!tileCanvas) tileCanvas = document.createElement('canvas');
  tileCanvas.width = TILE_PX; tileCanvas.height = TILE_PX;
  const ctx = tileCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, box[0] * w, box[1] * h, box[2] * w, box[3] * h, 0, 0, TILE_PX, TILE_PX);
  return model.detect(tileCanvas, 6, MIN_SCORE);
}

let tileCursor = 0;

export async function detectObjects(video) {
  const model = await getDetector();
  if (!model) return null;
  try {
    const w = video.videoWidth || video.width;
    const h = video.videoHeight || video.height;
    // Full frame + ONE tile per call, cycling through the tiles.
    // Running all five passes every sample pinned the main thread so hard
    // that the page stopped responding (a screenshot could not even complete
    // in 30 s) — on a student's laptop that is a frozen exam. Two inferences
    // per 2 s tick keeps the UI fluid and still covers every tile within
    // ~10 seconds, which is well inside the time a phone stays in view.
    const passes = [await model.detect(video, 6, MIN_SCORE)];
    if (w && h) {
      const box = TILES[tileCursor % TILES.length];
      tileCursor += 1;
      passes.push(await detectTile(model, video, box, w, h));
    }
    const out = new Map();
    passes.flat().forEach((p) => {
      const event = WATCHED[p.class];
      if (!event) return;
      const prev = out.get(event);
      if (!prev || p.score > prev.score) out.set(event, { score: p.score, cls: p.class });
    });
    return Array.from(out.entries()).map(([event, v]) => ({
      event, label: v.cls, score: Math.round(v.score * 100),
    }));
  } catch (_) {
    return [];   // a single bad frame is not a failure of the whole feature
  }
}

function boxIoU(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = (a.width * a.height) + (b.width * b.height) - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Person/body boxes for advanced proctoring.
 *
 * Full-frame only: tiled passes can report the same person more than once,
 * which is harmless for a phone flag but would turn one student into a false
 * "multiple people" event. Boxes are normalised to frame fractions so the
 * caller can make framing decisions without caring about camera resolution.
 * Returns null whenever no trustworthy answer exists — model failed to
 * load, the video has no dimensions yet, or inference itself threw. An
 * empty array means the detector RAN and saw nobody; conflating the two
 * charged students with "body missing" for our own inference errors.
 */
export async function detectPeople(video) {
  const model = await getDetector();
  if (!model) return null;
  try {
    const width = video.videoWidth || video.width || 0;
    const height = video.videoHeight || video.height || 0;
    if (!width || !height) return null;
    const predictions = await model.detect(video, 10, 0.45);
    const boxes = predictions
      .filter((p) => p.class === 'person' && Array.isArray(p.bbox) && p.bbox.length === 4)
      .map((p) => ({
        score: Math.round(Number(p.score || 0) * 100),
        bbox: {
          x: Math.max(0, Math.min(1, Number(p.bbox[0]) / width)),
          y: Math.max(0, Math.min(1, Number(p.bbox[1]) / height)),
          width: Math.max(0, Math.min(1, Number(p.bbox[2]) / width)),
          height: Math.max(0, Math.min(1, Number(p.bbox[3]) / height)),
        },
      }))
      .filter((p) => p.bbox.width > 0.02 && p.bbox.height > 0.02)
      .sort((a, b) => (b.bbox.width * b.bbox.height) - (a.bbox.width * a.bbox.height));

    const unique = [];
    boxes.forEach((candidate) => {
      if (!unique.some((kept) => boxIoU(candidate.bbox, kept.bbox) > 0.45)) unique.push(candidate);
    });
    return unique;
  } catch (_) {
    return null;   // inference failed — that is our problem, not an empty seat
  }
}

export const OBJECT_EVENTS = Array.from(new Set(Object.values(WATCHED)));

/**
 * Everything the model sees, not just the watched classes, with a low
 * threshold. Used by the admin self-test so an operator can hold a phone up
 * and see exactly what the detector makes of their lighting and camera —
 * "it didn't detect my phone" is impossible to debug without this.
 */
export async function debugDetect(video, minScore = 0.2) {
  const model = await getDetector();
  if (!model) return null;
  try {
    const w = video.videoWidth || video.width;
    const h = video.videoHeight || video.height;
    const passes = [await model.detect(video, 10, minScore)];
    if (w && h) {
      for (const box of TILES) {
        // eslint-disable-next-line no-await-in-loop
        passes.push(await detectTile(model, video, box, w, h));
      }
    }
    const raw = passes.flat();
    // Collapse to the best box per class. The model happily returns three
    // separate "person" boxes for one person, which is noise in the UI and
    // (because class is the natural React key) a duplicate-key warning.
    const best = new Map();
    raw.forEach((p) => {
      const prev = best.get(p.class);
      if (!prev || p.score > prev.score) best.set(p.class, p);
    });
    return Array.from(best.values())
      .map((p) => ({ cls: p.class, score: Math.round(p.score * 100), watched: !!WATCHED[p.class] }))
      .sort((a, b) => b.score - a.score);
  } catch (_) { return []; }
}
