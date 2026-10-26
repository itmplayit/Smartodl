'use strict';
const { q, q1, exec, tx } = require('../config/db');
const { ApiError } = require('../utils/helpers');

const ALLOWED_TYPES = new Set([
  'banner', 'hero', 'technology', 'quick_services', 'programmes', 'updates', 'stats',
  'schools', 'competition', 'problems', 'student_services', 'cta', 'content',
  'feature_grid', 'image_text',
]);

const DEFAULT_DOCUMENT = {
  schemaVersion: 1,
  theme: {
    primaryColor: '#01507c', accentColor: '#f5a800', pageBackground: '#f5f8fa', pageBackgroundDark: '#071722',
    maxWidth: 1280, cornerRadius: 8, motion: true,
  },
  sections: [
    { id: 'landing-banner', type: 'banner', name: 'Featured banner', enabled: true, style: { background: 'dark', padding: 'none', height: 'medium', alignment: 'left', overlay: 78 }, content: { eyebrow: 'Featured at SmartODL', title: 'Learn with direction. Build with confidence.', subtitle: 'Guided courses, coding practice and live assessments in one connected learning environment.', image: '/banners/smartodl-default-banner.jpg', imageAlt: '', primaryButton: { label: 'Explore courses', link: '/courses' } } },
    { id: 'main-hero', type: 'hero', name: 'Main hero', enabled: true, style: { background: 'brand', padding: 'spacious', alignment: 'left' }, content: { eyebrow: 'College-level learning and coding platform', title: 'Build skills. Solve problems.', accentTitle: 'Shape your future.', description: 'Structured courses, live assessments, competitive programming and an online judge—everything you need to learn with purpose.', primaryButton: { label: 'Explore courses', link: '/courses' }, secondaryButton: { label: 'Open coding arena', link: '/coding' }, trustPoints: ['Guided learning paths', 'Multi-language judge', 'Live quizzes & contests'], showCodePreview: true } },
    { id: 'technology-marquee', type: 'technology', name: 'Technology marquee', enabled: true, style: { background: 'brand', padding: 'none' }, content: { ariaLabel: 'Explore programming technologies', technologies: [
      { name: 'Python', mark: 'Py', color: '#3776ab' }, { name: 'JavaScript', mark: 'JS', color: '#f7df1e' }, { name: 'TypeScript', mark: 'TS', color: '#3178c6' }, { name: 'React', mark: 'Re', color: '#087ea4' }, { name: 'Next.js', mark: 'N', color: '#111827' }, { name: 'HTML', mark: 'H5', color: '#e34f26' }, { name: 'CSS', mark: 'C3', color: '#1572b6' }, { name: 'Java', mark: 'J', color: '#d93636' }, { name: 'C++', mark: 'C+', color: '#00599c' }, { name: 'SQL', mark: 'SQL', color: '#336791' }, { name: 'C', mark: 'C', color: '#546e7a' }, { name: 'C#', mark: 'C#', color: '#512bd4' },
    ] } },
    { id: 'quick-services', type: 'quick_services', name: 'Quick access cards', enabled: true, style: { background: 'default', padding: 'none', columns: 4 }, content: { items: [
      { title: 'Online Learning', icon: 'video', links: [{ label: 'My learning dashboard', link: '/student' }, { label: 'Continue a course', link: '/student/courses' }, { label: 'Virtual classes', link: '/quizzes?type=live' }] },
      { title: 'Browse Courses', icon: 'book', links: [{ label: 'Web development', link: '/courses' }, { label: 'Programming languages', link: '/courses' }, { label: 'Data structures & algorithms', link: '/courses' }] },
      { title: 'Assessments & Quizzes', icon: 'quiz', links: [{ label: 'Upcoming quizzes', link: '/quizzes' }, { label: 'Join a live quiz', link: '/quizzes?type=live' }, { label: 'View my results', link: '/student/results' }] },
      { title: 'Coding Arena', icon: 'code', links: [{ label: 'Solve coding problems', link: '/coding' }, { label: 'Join contests', link: '/contests' }, { label: 'View leaderboard', link: '/leaderboard' }] },
    ] } },
    { id: 'programmes', type: 'programmes', name: 'Programme finder & courses', enabled: true, style: { background: 'default', padding: 'normal', columns: 3 }, content: { eyebrow: 'Programme finder', title: 'Find the right learning path', description: 'Search by subject or technology and discover a course designed around your goal.', searchLabel: 'What do you want to learn?', searchPlaceholder: 'Python, React, SQL, data structures…', searchButton: 'Find programmes', listEyebrow: 'Popular programmes', listTitle: 'Start with a learner-favourite course', listLinkLabel: 'Browse all programmes', listLink: '/courses', itemLimit: 6 } },
    { id: 'updates', type: 'updates', name: 'Updates & welcome', enabled: true, style: { background: 'soft', padding: 'normal', columns: 2 }, content: { eyebrow: 'Stay informed', title: 'Latest updates from SmartODL', description: 'Academic, assessment and competition updates in one clear place.', panelTitle: 'Announcements', panelLinkLabel: 'View all', panelLink: '/quizzes', welcomeEyebrow: 'Welcome to SmartODL', welcomeTitle: 'Learning and practice, connected.', welcomeDescription: 'Learn concepts through structured modules, apply them in quizzes and coding problems, and understand your progress through meaningful results.', welcomeLinkLabel: 'Know more about SmartODL', welcomeLink: '/about' } },
    { id: 'platform-stats', type: 'stats', name: 'Platform statistics', enabled: true, style: { background: 'dark', padding: 'compact', columns: 5 }, content: { items: [{ label: 'Programmes', source: 'total_courses', icon: 'book' }, { label: 'Active learners', source: 'total_students', icon: 'users' }, { label: 'Coding problems', source: 'total_problems', icon: 'code' }, { label: 'Contest events', source: 'total_contests', icon: 'trophy' }, { label: 'Submissions', source: 'total_submissions', icon: 'rocket' }] } },
    { id: 'learning-schools', type: 'schools', name: 'Learning schools', enabled: true, style: { background: 'default', padding: 'normal', columns: 4 }, content: { eyebrow: 'Explore by subject', title: 'Learning schools', description: 'Move from core concepts to practical projects and assessments.', itemLinkLabel: 'View programmes', items: [
      { title: 'Web Development', description: 'HTML, CSS, JavaScript, React and project-based frontend learning.', icon: 'laptop', link: '/courses?category=web' },
      { title: 'Data Structures & Algorithms', description: 'Build problem-solving ability through structured concepts and practice.', icon: 'chart', link: '/courses?category=dsa' },
      { title: 'Programming Languages', description: 'Learn C, C++, Java, Python and JavaScript with executable examples.', icon: 'code', link: '/courses?category=programming' },
      { title: 'Database Systems', description: 'Master SQL, relational design and practical data management skills.', icon: 'database', link: '/courses?category=database' },
    ] } },
    { id: 'competition', type: 'competition', name: 'Practice & compete', enabled: true, style: { background: 'soft', padding: 'normal', columns: 2 }, content: { eyebrow: 'Practice and compete', title: 'Live opportunities to test your skills', listTitle: 'Upcoming contests', listLinkLabel: 'All contests', listLink: '/contests', problemEyebrow: 'Problem of the day', problemDescription: 'Build a consistent practice habit with one focused challenge.', problemButton: 'Solve today', emptyTitle: 'Daily coding practice', emptyDescription: 'Open the arena and choose a problem matched to your current level.', emptyButton: 'Open coding arena' } },
    { id: 'popular-problems', type: 'problems', name: 'Popular coding challenges', enabled: true, style: { background: 'default', padding: 'normal' }, content: { eyebrow: 'Coding arena', title: 'Popular coding challenges', linkLabel: 'Open the arena', link: '/coding', itemLimit: 6 } },
    { id: 'student-services', type: 'student_services', name: 'Student services', enabled: true, style: { background: 'default', padding: 'normal', columns: 6 }, content: { eyebrow: 'Quick access', title: 'Student services', description: 'Frequently used academic services available from one place.', items: [{ label: 'My Courses', icon: 'book', link: '/student/courses' }, { label: 'Academic Calendar', icon: 'calendar', link: '/contests' }, { label: 'Study Notes', icon: 'file', link: '/notes' }, { label: 'Results', icon: 'report', link: '/student/results' }, { label: 'Certificates', icon: 'certificate', link: '/student/certificates' }, { label: 'Help & Support', icon: 'help', link: '/contact' }] } },
    { id: 'final-cta', type: 'cta', name: 'Final call to action', enabled: true, style: { background: 'brand', padding: 'compact', alignment: 'left' }, content: { title: 'Ready to begin your learning journey?', description: 'Create your account and start with a guided course or coding problem.', guestButton: 'Create account', guestLink: '/register', userButton: 'Go to dashboard' } },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const cleanString = (value, max = 5000) => String(value == null ? '' : value).slice(0, max);

function sanitizeValue(value, depth = 0) {
  if (depth > 7) return null;
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 60).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return;
      out[key] = sanitizeValue(item, depth + 1);
    });
    return out;
  }
  return null;
}

function sanitizeDocument(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.sections)) throw ApiError.badRequest('A landing page document with sections is required');
  if (input.sections.length > 40) throw ApiError.badRequest('A landing page can contain at most 40 sections');
  const theme = { ...clone(DEFAULT_DOCUMENT.theme), ...sanitizeValue(input.theme || {}) };
  const seen = new Set();
  const sections = input.sections.map((raw, index) => {
    const type = cleanString(raw.type, 40);
    if (!ALLOWED_TYPES.has(type)) throw ApiError.badRequest(`Unsupported landing section type: ${type}`);
    let id = cleanString(raw.id || `${type}-${index + 1}`, 80).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!id || seen.has(id)) id = `${type}-${Date.now()}-${index}`;
    seen.add(id);
    return { id, type, name: cleanString(raw.name || type, 120), enabled: raw.enabled !== false, style: sanitizeValue(raw.style || {}), content: sanitizeValue(raw.content || {}) };
  });
  const document = { schemaVersion: 1, theme, sections };
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 600 * 1024) throw ApiError.badRequest('Landing page document is too large');
  return document;
}

async function getRow() {
  const row = await q1('SELECT * FROM landing_page_builder WHERE id = 1');
  if (!row) throw new Error('Landing page configuration is missing; import the clean production schema');
  return row;
}

const parse = (value) => {
  try {
    const document = JSON.parse(value);
    return { ...document, theme: { ...clone(DEFAULT_DOCUMENT.theme), ...(document.theme || {}) } };
  } catch (_) { return clone(DEFAULT_DOCUMENT); }
};

async function getPublic() {
  const row = await getRow();
  return { document: parse(row.published_json), version: row.published_version, published_at: row.published_at };
}

async function getBuilder() {
  const row = await getRow();
  return { draft: parse(row.draft_json), published: parse(row.published_json), draft_version: row.draft_version, published_version: row.published_version, updated_at: row.updated_at, published_at: row.published_at };
}

async function saveDraft(document, userId, baseVersion) {
  const clean = sanitizeDocument(document);
  await getRow();
  const params = [JSON.stringify(clean), userId || null];
  let sql = 'UPDATE landing_page_builder SET draft_json=?, draft_version=draft_version+1, updated_by=? WHERE id=1';
  if (baseVersion != null) { sql += ' AND draft_version=?'; params.push(Number(baseVersion)); }
  const result = await exec(sql, params);
  if (!result.affectedRows) throw ApiError.conflict('This draft changed in another session. Reload before saving.');
  return getBuilder();
}

async function publish(userId, baseVersion) {
  await getRow();
  await tx(async (conn) => {
    const [rows] = await conn.execute('SELECT draft_json, draft_version, published_version FROM landing_page_builder WHERE id=1 FOR UPDATE');
    const row = rows[0];
    if (!row) throw new ApiError(404, 'Landing page document not found');
    if (baseVersion != null && Number(baseVersion) !== Number(row.draft_version)) throw ApiError.conflict('The draft changed before it could be published. Reload and try again.');
    const nextVersion = Number(row.published_version) + 1;
    await conn.execute('UPDATE landing_page_builder SET published_json=draft_json, published_version=?, published_by=?, published_at=CURRENT_TIMESTAMP WHERE id=1', [nextVersion, userId || null]);
    await conn.execute('INSERT INTO landing_page_revisions (version, document_json, published_by) VALUES (?,?,?)', [nextVersion, row.draft_json, userId || null]);
  });
  return getBuilder();
}

async function revertDraft(userId) {
  await exec('UPDATE landing_page_builder SET draft_json=published_json, draft_version=draft_version+1, updated_by=? WHERE id=1', [userId || null]);
  return getBuilder();
}

async function revisions() {
  return q('SELECT id, version, published_by, published_at FROM landing_page_revisions ORDER BY version DESC LIMIT 30');
}

async function restoreRevision(id, userId) {
  const revision = await q1('SELECT document_json FROM landing_page_revisions WHERE id=?', [id]);
  if (!revision) throw new ApiError(404, 'Landing page revision not found');
  await exec('UPDATE landing_page_builder SET draft_json=?, draft_version=draft_version+1, updated_by=? WHERE id=1', [revision.document_json, userId || null]);
  return getBuilder();
}

module.exports = { DEFAULT_DOCUMENT, sanitizeDocument, getPublic, getBuilder, saveDraft, publish, revertDraft, revisions, restoreRevision };
