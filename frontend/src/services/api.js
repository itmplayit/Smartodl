/**
 * Axios API client.
 *  - attaches the JWT access token to every request
 *  - transparently refreshes the session on 401 and retries once
 *  - normalises backend errors into readable messages
 */
import axios from 'axios';

/**
 * Storage that never throws.
 *  - normal browsers  → window.localStorage
 *  - sandboxed iframes / private mode (localStorage throws a SecurityError)
 *    → in-memory fallback, so the UI still boots instead of showing a blank page
 */
export const safeStorage = (() => {
  try {
    const probe = '__smartodl_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (_) {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
    };
  }
})();

const TOKEN_KEY = 'smartodl.access_token';
const REFRESH_KEY = 'smartodl.refresh_token';
const USER_KEY = 'smartodl.user';

/**
 * Token storage (security):
 *  - Access token lives in MEMORY only. It used to sit in localStorage next
 *    to the 30-day refresh token, so a single XSS meant a month-long account
 *    takeover. The refresh token now travels exclusively in the server's
 *    httpOnly cookie (path /api/auth), which JavaScript cannot read.
 *  - On reload, AuthContext restores the session through silentRefresh().
 *  - Legacy localStorage tokens from older builds are migrated once by
 *    silentRefresh() (sent in the refresh body, rotated into the cookie)
 *    and then deleted.
 */
let memoryAccessToken = null;

const clearLegacyTokens = () => {
  safeStorage.removeItem(TOKEN_KEY);
  safeStorage.removeItem(REFRESH_KEY);
};

export const tokens = {
  access: () => memoryAccessToken,
  save({ access_token } = {}) {
    if (access_token) memoryAccessToken = access_token;
    clearLegacyTokens();
  },
  clear() {
    memoryAccessToken = null;
    clearLegacyTokens();
    safeStorage.removeItem(USER_KEY);
  },
};

let refreshPromise = null;

/** Exchange the httpOnly refresh cookie (or a legacy stored token, once) for a fresh access token. */
export function silentRefresh() {
  // One rotation only, no matter how many callers race it (AuthContext plus
  // every request that just received a 401). Parallel refresh POSTs carry
  // the same cookie and the second response can revoke the first one's token.
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const legacy = safeStorage.getItem(REFRESH_KEY);
    const { data } = await axios.post(
      '/api/auth/refresh',
      legacy ? { refresh_token: legacy } : {},
      { withCredentials: true, timeout: 20000 },
    );
    tokens.save({ access_token: data.data.access_token });
    cachedUser.save(data.data.user);
    return data.data;
  })();
  refreshPromise = refreshPromise.finally(() => {
    clearLegacyTokens();
    refreshPromise = null;
  });
  return refreshPromise;
}

export const cachedUser = {
  get() { try { return JSON.parse(safeStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  save(user) { if (user) safeStorage.setItem(USER_KEY, JSON.stringify(user)); },
};

/**
 * Auth is header-based (Bearer JWT) — the app never needs cookies. Disabling the
 * cookie/XSRF lookup also keeps axios working inside sandboxed preview panes,
 * where merely reading `document.cookie` throws a SecurityError.
 */
axios.defaults.withXSRFToken = false;
axios.defaults.xsrfCookieName = null;
axios.defaults.xsrfHeaderName = null;

const DEFAULT_API_TIMEOUT_MS = 20000;

// A single 120-second timeout for every route made an ordinary hung request
// spin for two minutes — and GET retries could stretch that to six. Normal
// CRUD/list calls fail fast; only operations that are legitimately long
// (judging, AI, bulk import/recalculation, uploads/downloads) get more time.
const LONG_API_TIMEOUTS = [
  [/^\/?coding\/(?:run|submit)(?:[/?#]|$)/, 300000],
  [/^\/?quiz-attempts\/[^/]+\/(?:run-code|submit)(?:[/?#]|$)/, 300000],
  [/^\/?ai\/generate(?:[/?#]|$)/, 120000],
  [/^\/?(?:quizzes|coding\/problems)\/import(?:[/?#]|$)/, 120000],
  [/^\/?points\/(?:recalc|users\/[^/]+\/recalc)(?:[/?#]|$)/, 120000],
  [/^\/?leaderboard\/refresh(?:[/?#]|$)/, 120000],
  [/^\/?reports\/generate(?:[/?#]|$)/, 120000],
  [/^\/?plagiarism\/check\//, 120000],
  [/^\/?subscriptions\/(?:checkout|verify)(?:[/?#]|$)/, 45000],
  [/\/(?:export|results\.xlsx)(?:[/?#]|$)/, 120000],
];

function timeoutForRequest(config) {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) return 180000;
  if (config.responseType === 'blob') return 120000;
  const url = String(config.url || '');
  const match = LONG_API_TIMEOUTS.find(([pattern]) => pattern.test(url));
  return match ? match[1] : DEFAULT_API_TIMEOUT_MS;
}

const api = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_API_TIMEOUT_MS,
  withCredentials: true,
  withXSRFToken: false,
  xsrfCookieName: null,
  xsrfHeaderName: null,
  headers: { 'Content-Type': 'application/json' },
});

/** Some environments hand back objects (e.g. DOMException) whose `message` is read-only. */
const setErrorMessage = (error, message) => {
  try {
    error.message = message;
  } catch (_) {
    try {
      Object.defineProperty(error, 'message', { value: message, configurable: true });
    } catch (__) {
      /* nothing else we can do — the original error still rejects */
    }
  }
  return error;
};

/**
 * Transient-failure retry.
 * A dev-server restart, a deploy, a momentary database blip or a proxy hiccup all
 * surface as a network error or a 5xx. Read-only requests are retried up to twice
 * with a short backoff so an open page heals itself instead of showing a broken UI.
 * Mutations (POST/PUT/PATCH/DELETE) are never retried automatically.
 */
// Only gateway-level blips are retried. 500 (app bug) and 429 (server asking
// us to back off) must not be hammered with automatic retries.
const RETRY_STATUS = [502, 503, 504];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

api.interceptors.request.use((config) => {
  const token = tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Preserve an explicitly longer caller timeout, but never let the route's
  // required budget shrink back to the short CRUD default.
  config.timeout = Math.max(Number(config.timeout) || 0, timeoutForRequest(config));
  return config;
});

let refreshing = null;
let offline = false;

/* Loop breaker: if refreshes keep firing but requests keep failing (corrupted
   session state, clock skew, …), stop after 3 real refresh attempts in 10 s
   and force a clean re-login instead of an endless 401 → refresh storm. */
const refreshStamps = [];
const refreshAllowed = () => {
  const now = Date.now();
  while (refreshStamps.length && now - refreshStamps[0] > 10000) refreshStamps.shift();
  if (refreshStamps.length >= 3) return false;
  refreshStamps.push(now);
  return true;
};

/** Public health check used by the connection banner. */
export const pingServer = () => axios.get('/api/health', { timeout: 5000, __noRetry: true });

api.interceptors.response.use(
  (res) => {
    // a successful call after an outage clears the "reconnecting" banner
    if (offline) { offline = false; window.dispatchEvent(new CustomEvent('smartodl:online')); }
    return res;
  },
  async (error) => {
    const { response, config } = error;

    // ---- retry transient failures on idempotent requests -------------------
    if (config && (config.method || 'get').toLowerCase() === 'get') {
      const transient = !response || RETRY_STATUS.includes(response.status);
      const attempts = config.__attempts || 0;
      if (transient && attempts < 2 && !config.url.includes('/auth/login')) {
        config.__attempts = attempts + 1;
        await wait(300 * 2 ** attempts + Math.random() * 200);
        return api(config);
      }
      if (transient && attempts >= 2) {
        error.isOffline = true;
        setErrorMessage(error, 'Cannot reach the server — it may be starting up. Retrying automatically…');
        error.status = response ? response.status : 0;
        window.dispatchEvent(new CustomEvent('smartodl:offline'));
        return Promise.reject(error);
      }
    }
    // Silently refresh an expired access token once.
    // Only the auth calls that must never loop are excluded — /auth/me is NOT
    // excluded: a 401 there must trigger the same refresh+retry as everywhere
    // else, otherwise AuthContext treats it as "logged out" and wipes the
    // tokens that a concurrent refresh is about to replace (that race produced
    // an endless 401 → refresh → 401 storm).
    const noRefreshPaths = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot', '/auth/reset'];
    const refreshable = response && response.status === 401 && !config.__retried
      && !noRefreshPaths.some((p) => config.url.includes(p));
    if (refreshable) {
      config.__retried = true;
      try {
        if (!refreshing && !refreshAllowed()) {
          // too many failed refresh rounds in a row → session is unrecoverable
          tokens.clear();
          if (!location.pathname.startsWith('/login')) location.href = '/login?expired=1';
          return Promise.reject(error);
        }
        refreshing = refreshing || silentRefresh();
        const refreshed = await refreshing;
        refreshing = null;
        config.headers.Authorization = `Bearer ${refreshed.access_token}`;
        return api(config);
      } catch (refreshError) {
        refreshing = null;
        // Only a definite auth rejection ends the session. A network error,
        // timeout or 5xx during refresh must not erase a recoverable login.
        const refreshStatus = (refreshError && refreshError.response && refreshError.response.status)
          || (refreshError && refreshError.status) || 0;
        if (refreshStatus === 401 || refreshStatus === 403) {
          tokens.clear();
          if (!location.pathname.startsWith('/login')) location.href = '/login?expired=1';
        } else {
          error.isOffline = true;
        }
      }
    }
    // A 403 that names a permission means the server knows better than our cached
    // profile — ask AuthContext to re-read /auth/me, then let the caller show the error.
    if (response && response.status === 403 && /permission/i.test(String(response.data && response.data.error))) {
      window.dispatchEvent(new CustomEvent('smartodl:permissions-stale'));
    }
    // File downloads use responseType:'blob', so a failed one arrives with the
    // JSON error body wrapped in a Blob and every message collapses to a
    // useless "Something went wrong". Unwrap it before reading the error.
    if (response && typeof Blob !== 'undefined' && response.data instanceof Blob
        && /json/i.test(response.data.type || '')) {
      try { response.data = JSON.parse(await response.data.text()); } catch (_) { /* leave the blob alone */ }
    }
    const serverMessage = response && response.data && response.data.error;
    const staleTransferApi = response && response.status === 404 && serverMessage === 'Route not found'
      && config && /\/(import|export)(?:$|\?)/.test(String(config.url || ''));
    setErrorMessage(error, staleTransferApi
      ? 'The backend is running an older build. Close the SmartODL Backend API window, run Setup.bat, then retry the import.'
      : serverMessage || error.message || 'Something went wrong');
    // machine-readable details (e.g. PREMIUM_REQUIRED) ko UI tak pahunchao
    error.details = (response && response.data && response.data.details) || null;
    error.status = response ? response.status : 0;
    return Promise.reject(error);
  },
);

/* ------------------------------- endpoints ------------------------------- */
export const authApi = {
  register: (payload) => api.post('/auth/register', payload),
  login: (payload) => api.post('/auth/login', payload),
  logout: (payload) => api.post('/auth/logout', payload || {}),
  me: () => api.get('/auth/me'),
  providers: () => api.get('/auth/providers'),
  forgot: (email, extra) => api.post('/auth/forgot-password', { email, ...(extra || {}) }),
  reset: (payload) => api.post('/auth/reset-password', payload),
  changePassword: (payload) => api.post('/auth/change-password', payload),
};

export const sessionsApi = {
  list: () => api.get('/auth/sessions'),
  revoke: (id) => api.delete(`/auth/sessions/${id}`),
};

export const captchaApi = {
  config: () => api.get('/captcha/config'),
  challenge: () => api.get('/captcha/challenge'),
};

export const userApi = {
  me: () => api.get('/auth/me'),
  updateMe: (payload) => api.patch('/users/me', payload),
  uploadAvatar: (file) => {
    const fd = new FormData(); fd.append('avatar', file);
    return api.post('/users/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  list: (params) => api.get('/users', { params }),
  colleges: (params) => api.get('/admin/colleges', { params }),
  collegeMembers: (params) => api.get('/admin/colleges/members', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.patch(`/users/${id}`, payload),
  remove: (id) => api.delete(`/users/${id}`),
  permissions: (id) => api.get(`/users/${id}/permissions`),
  setPermissions: (id, permissions) => api.put(`/users/${id}/permissions`, { permissions }),
  myPermissions: () => api.get('/users/me/permissions'),
};

export const courseApi = {
  list: (params) => api.get('/courses', { params }),
  get: (id) => api.get(`/courses/${id}`),
  create: (payload) => api.post('/courses', payload),
  update: (id, payload) => api.put(`/courses/${id}`, payload),
  recommended: () => api.get('/courses/recommended'),
  analytics: (id) => api.get(`/courses/${id}/analytics`),
  analyticsXlsx: (id) => api.get(`/courses/${id}/analytics.xlsx`, { responseType: 'blob' }),
  remove: (id) => api.delete(`/courses/${id}`),
  uploadThumbnail: (id, file) => {
    const fd = new FormData(); fd.append('thumbnail', file);
    return api.post(`/courses/${id}/thumbnail`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  enroll: (id) => api.post(`/courses/${id}/enroll`),
  purchase: (id, gateway) => api.post(`/courses/${id}/purchase`, { gateway }),
  purchaseVerify: (id, body) => api.post(`/courses/${id}/purchase/verify`, body),
  enrollments: () => api.get('/enrollments/my'),
  courseEnrollments: (id) => api.get(`/courses/${id}/enrollments`),
  progress: (enrollmentId, lesson_id) => api.post(`/enrollments/${enrollmentId}/progress`, { lesson_id }),
  modules: (params) => api.get('/modules', { params }),
  createModule: (payload) => api.post('/modules', payload),
  updateModule: (id, payload) => api.put(`/modules/${id}`, payload),
  removeModule: (id) => api.delete(`/modules/${id}`),
  createLesson: (payload) => api.post('/lessons', payload),
  updateLesson: (id, payload) => api.put(`/lessons/${id}`, payload),
  removeLesson: (id) => api.delete(`/lessons/${id}`),
  lesson: (id) => api.get(`/lessons/${id}`),
  /* Lesson media (video + PDF). Uploads use XHR-style progress via onUploadProgress;
     playback URLs come from mediaInfo() with a short-lived ticket. */
  lessonMedia: (id) => api.get(`/lessons/${id}/media`),
  uploadVideo: (id, file, onProgress) => {
    const fd = new FormData();
    fd.append('video', file);
    return api.post(`/lessons/${id}/video`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // a 200 MB upload on a slow link must not hit the default timeout
      onUploadProgress: onProgress,
    });
  },
  uploadPdf: (id, file, onProgress) => {
    const fd = new FormData();
    fd.append('pdf', file);
    return api.post(`/lessons/${id}/pdf`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      onUploadProgress: onProgress,
    });
  },
  watchStatus: (id) => api.get(`/lessons/${id}/watch`),
  reportWatch: (id, payload) => api.post(`/lessons/${id}/watch`, payload),
  removeVideo: (id) => api.delete(`/lessons/${id}/video`),
  removePdf: (id) => api.delete(`/lessons/${id}/pdf`),
};

/* The lesson viewer reads media through these relative URLs so the browser's
   own <video>/<iframe> can stream them; they are same-origin (proxied /api). */
export const lessonApi = courseApi;

export const certApi = {
  mine: () => api.get('/certificates/mine'),
  verify: (token) => api.get(`/cert/${encodeURIComponent(token)}`),
  printUrl: (token) => `/api/cert/${encodeURIComponent(token)}/print`,
  // Server-rendered A4 PDF — same file on desktop and mobile (window.print()
  // reflows/crops on phones, which is why this exists).
  pdfUrl: (token) => `/api/cert/${encodeURIComponent(token)}/pdf`,
  verifyUrl: (token) => `/cert/${encodeURIComponent(token)}`,
};

export const paytmApi = {
  status: (orderId) => api.get(`/subscriptions/paytm/status/${orderId}`),
};

export const upiApi = {
  config: () => api.get('/subscriptions/upi/config'),
  checkout: (plan_id) => api.post('/subscriptions/upi/checkout', { plan_id }),
  checkoutCourse: (course_id) => api.post('/subscriptions/upi/checkout', { course_id }),
  submit: (orderId, body) => api.post(`/subscriptions/upi/${orderId}/submit`, body),
  mine: () => api.get('/subscriptions/upi/mine'),
  adminList: (params) => api.get('/admin/upi-payments', { params }),
  adminPreview: () => api.get('/admin/upi-payments/preview'),
  approve: (id, note) => api.post(`/admin/upi-payments/${id}/approve`, { note }),
  reject: (id, note) => api.post(`/admin/upi-payments/${id}/reject`, { note }),
};

export const pagesApi = {
  list: () => api.get('/pages'),
  get: (slug) => api.get(`/pages/${slug}`),
  adminList: () => api.get('/admin/pages'),
  adminCreate: (body) => api.post('/admin/pages', body),
  adminUpdate: (id, body) => api.put(`/admin/pages/${id}`, body),
  adminReset: (id) => api.post(`/admin/pages/${id}/reset`),
  adminRemove: (id) => api.delete(`/admin/pages/${id}`),
};

export const noteApi = {
  list: (params) => api.get('/notes', { params }),
  get: (id) => api.get(`/notes/${id}`),
  create: (formData) => api.post('/notes', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id, formData) => api.put(`/notes/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  remove: (id) => api.delete(`/notes/${id}`),
  download: (id) => api.get(`/notes/${id}/download`, { responseType: 'blob' }),
  downloadUrl: (id) => `/api/notes/${id}/download`,
};

export const quizApi = {
  list: (params) => api.get('/quizzes', { params }),
  get: (id) => api.get(`/quizzes/${id}`),
  create: (payload) => api.post('/quizzes', payload),
  update: (id, payload) => api.put(`/quizzes/${id}`, payload),
  remove: (id) => api.delete(`/quizzes/${id}`),
  exportAll: () => api.get('/quizzes/export'),
  exportOne: (id) => api.get(`/quizzes/${id}/export`),
  importJson: (payload) => api.post('/quizzes/import', payload),
  questions: (id) => api.get(`/quizzes/${id}/questions`),
  addQuestion: (id, payload) => api.post(`/quizzes/${id}/questions`, payload),
  updateQuestion: (qid, payload) => api.put(`/quiz-questions/${qid}`, payload),
  removeQuestion: (qid) => api.delete(`/quiz-questions/${qid}`),
  reorderQuestions: (items) => api.put('/quiz-questions/reorder', { items }),
  startLive: (id, payload) => api.post(`/quizzes/${id}/start-live`, payload || {}),
  liveStartAll: (id) => api.post(`/quizzes/${id}/live/start`),
  endLive: (id) => api.post(`/quizzes/${id}/end-live`),
  live: (id) => api.get(`/quizzes/${id}/live`),
  results: (id) => api.get(`/quizzes/${id}/results`),
  resultsExcel: (id) => api.get(`/quizzes/${id}/results.xlsx`, { responseType: 'blob' }),
  start: (id, unlockToken) => api.post(`/quizzes/${id}/attempts`, {}, unlockToken ? { headers: { 'x-quiz-unlock': unlockToken } } : {}),
  unlock: (id, password) => api.post(`/quizzes/${id}/unlock`, { password }),
  saveAnswer: (attemptId, payload) => api.put(`/quiz-attempts/${attemptId}/answer`, payload),
  runCode: (attemptId, payload) => api.post(`/quiz-attempts/${attemptId}/run-code`, payload),
  submit: (attemptId, payload) => api.post(`/quiz-attempts/${attemptId}/submit`, payload || {}),
  violation: (attemptId) => api.put(`/quiz-attempts/${attemptId}/violation`),
  ping: (attemptId, payload) => api.post(`/quiz-attempts/${attemptId}/ping`, payload || {}),
  myAttempts: () => api.get('/quiz-attempts/my'),
  attempt: (id) => api.get(`/quiz-attempts/${id}`),
  proctorFrames: (id, since = 0) => api.get(`/quizzes/${id}/proctor-frames`, { params: since ? { since } : {} }),
  proctorSignal: (attemptId, payload) => api.post(`/quiz-attempts/${attemptId}/proctor-signal`, payload),
  proctorIce: (attemptId) => api.get(`/quiz-attempts/${attemptId}/proctor-ice`),
  proctorAction: (attemptId, payload) => api.post(`/quiz-attempts/${attemptId}/proctor-action`, payload),
  proctorRecordingStatus: (attemptId) => api.get(`/quiz-attempts/${attemptId}/proctor-recording/status`),
  proctorRecordingConsent: (sessionId, accepted, mimeTypes) => api.post(`/proctor-recordings/${sessionId}/consent`, { accepted, mime_types: mimeTypes }),
  proctorRecordingChunk: (sessionId, feed, index, blob, mimeType) => api.post(`/proctor-recordings/${sessionId}/${feed}/chunks/${index}`, blob, { headers: { 'Content-Type': blob.type || mimeType }, timeout: 30000 }),
  proctorRecordingFinalize: (sessionId, payload) => api.post(`/proctor-recordings/${sessionId}/finalize`, payload),
  adminProctorRecordings: () => api.get('/admin/proctor-recordings'),
  adminIntegrityScores: (params) => api.get('/admin/integrity-scores', { params }),
  adminProctorRecordingFile: (id) => api.get(`/admin/proctor-recordings/files/${id}`, { responseType: 'blob' }),
  deleteAdminProctorRecording: (sessionId) => api.delete(`/admin/proctor-recordings/${sessionId}`),
  secondCameraSession: (attemptId, rotate = false) => api.post(`/quiz-attempts/${attemptId}/second-camera/session`, { rotate: !!rotate }),
  secondCameraStatus: (attemptId) => api.get(`/quiz-attempts/${attemptId}/second-camera/status`),
  secondCameraInfo: (token) => api.get(`/proctor/second-camera/${token}`),
  secondCameraFrame: (token, image) => api.post(`/proctor/second-camera/${token}`, { image }),
};

/* Points Management — admin-only control over the points economy. */
export const pointsApi = {
  overview: () => api.get('/points/overview'),
  rules: () => api.get('/points/rules'),
  saveRules: (rules) => api.put('/points/rules', { rules }),
  users: (params) => api.get('/points/users', { params }),
  user: (id) => api.get(`/points/users/${id}`),
  adjust: (id, payload) => api.post(`/points/users/${id}/adjust`, payload),
  recalcUser: (id) => api.post(`/points/users/${id}/recalc`),
  recalcAll: (scope) => api.post('/points/recalc', null, { params: scope ? { scope } : {} }),
  adjustments: (params) => api.get('/points/adjustments', { params }),
  revoke: (adjustmentId) => api.delete(`/points/adjustments/${adjustmentId}`),
};

export const codingApi = {
  languages: () => api.get('/coding/languages'),
  problems: (params) => api.get('/coding/problems', { params }),
  problem: (id, params) => api.get(`/coding/problems/${id}`, { params }),
  createProblem: (payload) => api.post('/coding/problems', payload),
  updateProblem: (id, payload) => api.put(`/coding/problems/${id}`, payload),
  removeProblem: (id) => api.delete(`/coding/problems/${id}`),
  exportProblems: () => api.get('/coding/problems/export'),
  exportProblem: (id) => api.get(`/coding/problems/${id}/export`),
  importProblems: (payload) => api.post('/coding/problems/import', payload),
  testCases: (problemId, includeHidden) => api.get(`/coding/test-cases/${problemId}`, { params: includeHidden ? { include_hidden: 1 } : {} }),
  addTestCase: (problemId, payload) => api.post(`/coding/test-cases/${problemId}`, payload),
  updateTestCase: (id, payload) => api.put(`/coding/test-cases/item/${id}`, payload),
  removeTestCase: (id) => api.delete(`/coding/test-cases/item/${id}`),
  run: (payload) => api.post('/coding/run', payload),
  submit: (payload) => api.post('/coding/submit', payload),
  mySubmissions: (params) => api.get('/coding/submissions/my', { params }),
  submissions: (params) => api.get('/coding/submissions', { params }),
  submission: (id) => api.get(`/coding/submissions/${id}`),
};

export const contestApi = {
  list: (params) => api.get('/contests', { params }),
  get: (id) => api.get(`/contests/${id}`),
  create: (payload) => api.post('/contests', payload),
  update: (id, payload) => api.put(`/contests/${id}`, payload),
  remove: (id) => api.delete(`/contests/${id}`),
  register: (id) => api.post(`/contests/${id}/register`),
  leaderboard: (id) => api.get(`/contests/${id}/leaderboard`),
};

/* --------------- community & engagement (Feature Pack v2) --------------- */
export const gamificationApi = {
  me: () => api.get('/gamification/me'),
  levels: () => api.get('/gamification/levels'),
};
export const communityApi = {
  problemOfDay: () => api.get('/coding/problem-of-day'),
  unlockHint: (problemId) => api.post(`/coding/problems/${problemId}/unlock-hint`, {}),
  reviews: (courseId) => api.get(`/courses/${courseId}/reviews`),
  saveReview: (courseId, payload) => api.post(`/courses/${courseId}/reviews`, payload),
  deleteReview: (id) => api.delete(`/reviews/${id}`),
  discussions: (parentType, parentId) => api.get('/discussions', { params: { parent_type: parentType, parent_id: parentId } }),
  createDiscussion: (payload) => api.post('/discussions', payload),
  replies: (id) => api.get(`/discussions/${id}`),
  addReply: (id, body) => api.post(`/discussions/${id}/replies`, { body }),
};

/** Subscriptions / premium plans */
export const billingApi = {
  plans: () => api.get('/plans'),
  my: () => api.get('/subscriptions/me'),
  checkout: (plan_id, gateway) => api.post('/subscriptions/checkout', { plan_id, gateway }),
  verify: (payload) => api.post('/subscriptions/verify', payload),
  adminPlans: () => api.get('/admin/plans'),
  createPlan: (payload) => api.post('/admin/plans', payload),
  updatePlan: (id, payload) => api.put(`/admin/plans/${id}`, payload),
  removePlan: (id) => api.delete(`/admin/plans/${id}`),
  adminSubs: (params) => api.get('/admin/subscriptions', { params }),
  grant: (payload) => api.post('/admin/subscriptions/grant', payload),
};

export const miscApi = {
  leaderboard: (params) => api.get('/leaderboard', { params }),
  refreshLeaderboard: () => api.post('/leaderboard/refresh'),
  achievements: () => api.get('/achievements'),
  createAchievement: (payload) => api.post('/achievements', payload),
  updateAchievement: (id, payload) => api.put(`/achievements/${id}`, payload),
  removeAchievement: (id) => api.delete(`/achievements/${id}`),
  awardAchievement: (id, user_id) => api.post(`/achievements/${id}/award`, { user_id }),
  notifications: (params) => api.get('/notifications/my', { params }),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  allNotifications: (params) => api.get('/notifications', { params }),
  broadcast: (payload) => api.post('/notifications/broadcast', payload),
  removeNotification: (id) => api.delete(`/notifications/${id}`),
  search: (params) => api.get('/search', { params }),
  suggestions: (q) => api.get('/search/suggestions', { params: { q } }),
  publicSettings: () => api.get('/settings/public'),
  publicLandingPage: () => api.get('/landing/page'),
  landingBuilder: () => api.get('/landing/builder'),
  saveLandingDraft: (document, base_version) => api.put('/landing/builder/draft', { document, base_version }),
  publishLandingDraft: (base_version) => api.post('/landing/builder/publish', { base_version }),
  revertLandingDraft: () => api.post('/landing/builder/revert'),
  landingRevisions: () => api.get('/landing/builder/revisions'),
  restoreLandingRevision: (id) => api.post(`/landing/builder/revisions/${id}/restore`),
  landingMedia: () => api.get('/landing/media'),
  uploadLandingMedia: (file, alt_text = '') => {
    const form = new FormData(); form.append('image', file); form.append('alt_text', alt_text);
    return api.post('/landing/media', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateLandingMedia: (id, alt_text) => api.put(`/landing/media/${id}`, { alt_text }),
  removeLandingMedia: (id) => api.delete(`/landing/media/${id}`),
  settings: () => api.get('/settings'),
  updateSettings: (settings) => api.put('/settings', { settings }),
  // Anti-cheat only — usable by developers holding `manage_anticheat`, while
  // the full /settings endpoint stays admin-only. Settings are PER DEVELOPER:
  // a developer's switches govern only their own quizzes/problems, layered
  // over the admin's platform defaults. `userId` (admins only) targets
  // another developer; opts.scope='global' (admins only) edits the defaults.
  antiCheat: (userId) => api.get('/settings/anti-cheat', { params: userId ? { user_id: userId } : {} }),
  updateAntiCheat: (settings, opts = {}) => api.put('/settings/anti-cheat', { settings, ...opts }),
  uploadLandingBanner: (file) => {
    const form = new FormData(); form.append('banner', file);
    return api.post('/settings/banner', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  removeLandingBanner: () => api.delete('/settings/banner'),
  publicStats: () => api.get('/stats/public'),
  categories: () => api.get('/categories'),
  createCategory: (payload) => api.post('/categories', payload),
  updateCategory: (id, payload) => api.put(`/categories/${id}`, payload),
  removeCategory: (id) => api.delete(`/categories/${id}`),
  reports: () => api.get('/reports'),
  generateReport: (report_type) => api.post('/reports/generate', { report_type }),
  adminDashboard: () => api.get('/dashboard'),
  studentDashboard: () => api.get('/dashboard/student'),
  developerDashboard: () => api.get('/dashboard/developer'),
};

export const health = () => api.get('/health');
export default api;
