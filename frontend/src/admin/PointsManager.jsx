import { useEffect, useState } from 'react';
import { pointsApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Avatar, Empty, Loader, Modal, Pagination, StatCard, Tabs } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

/* Labels for the breakdown rows — order matters, it is the reading order of
   "where did these points come from". */
const PART_LABELS = [
  ['coding', '💻 Coding submissions'],
  ['quiz', '🧠 Quiz marks'],
  ['perfect_quiz', '🎯 Perfect quiz bonus'],
  ['courses', '📘 Courses completed'],
  ['achievements', '🏅 Achievement rewards'],
  ['manual', '✋ Manual adjustments'],
];

const TABS = [
  { value: 'students', label: '👥 Students' },
  { value: 'rules', label: '⚙️ Earning rules' },
  { value: 'audit', label: '📜 Audit trail' },
];

export default function PointsManager() {
  const toast = useToast();
  const [tab, setTab] = useState('students');

  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [rules, setRules] = useState(null);
  const [ruleForm, setRuleForm] = useState({});
  const [savingRules, setSavingRules] = useState(false);

  const [audit, setAudit] = useState(null);
  const [auditMeta, setAuditMeta] = useState(null);
  const [auditPage, setAuditPage] = useState(1);

  const [detail, setDetail] = useState(null);     // selected user's breakdown
  const [detailBusy, setDetailBusy] = useState(false);
  const [form, setForm] = useState({ mode: 'delta', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);

  /* ------------------------------------------------------------- loaders */

  const loadOverview = () => pointsApi.overview()
    .then(({ data }) => setOverview(data.data))
    .catch((e) => toast.error(e.message));

  const loadUsers = async (p = page, term = search) => {
    setRows(null);
    try {
      const { data } = await pointsApi.users({ page: p, limit: 20, search: term || undefined });
      setRows(data.data); setMeta(data.meta);
    } catch (e) { toast.error(e.message); setRows([]); }
  };

  const loadRules = async () => {
    try {
      const { data } = await pointsApi.rules();
      setRules(data.data.rules);
      setRuleForm(Object.fromEntries(data.data.rules.map((r) => [r.key, r.value])));
    } catch (e) { toast.error(e.message); }
  };

  const loadAudit = async (p = auditPage) => {
    setAudit(null);
    try {
      const { data } = await pointsApi.adjustments({ page: p, limit: 25 });
      setAudit(data.data); setAuditMeta(data.meta);
    } catch (e) { toast.error(e.message); setAudit([]); }
  };

  useEffect(() => { loadOverview(); loadUsers(1); loadRules(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (tab === 'audit') loadAudit(1); /* eslint-disable-next-line */ }, [tab]);

  /* ------------------------------------------------------------- actions */

  const openUser = async (id) => {
    setDetailBusy(true);
    setForm({ mode: 'delta', amount: '', reason: '' });
    try {
      const { data } = await pointsApi.user(id);
      setDetail(data.data);
    } catch (e) { toast.error(e.message); } finally { setDetailBusy(false); }
  };

  const refreshDetail = async (id) => {
    const { data } = await pointsApi.user(id);
    setDetail(data.data);
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount)) { toast.error('Enter a number'); return; }
    if (!form.reason.trim()) { toast.error('A reason is required — it goes into the audit trail'); return; }
    setBusy(true);
    try {
      const { data } = await pointsApi.adjust(detail.user.id, {
        mode: form.mode, amount, reason: form.reason.trim(),
      });
      toast.success(`${data.data.delta > 0 ? '+' : ''}${data.data.delta} points — new total ${fmtNum(data.data.points)}`);
      setForm({ mode: 'delta', amount: '', reason: '' });
      await refreshDetail(detail.user.id);
      loadUsers(); loadOverview();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const revoke = async (adjustmentId) => {
    if (!window.confirm('Revoke this adjustment? The points are removed and the user is recalculated.')) return;
    setBusy(true);
    try {
      await pointsApi.revoke(adjustmentId);
      toast.success('Adjustment revoked');
      if (detail) await refreshDetail(detail.user.id);
      loadUsers(); loadOverview();
      if (tab === 'audit') loadAudit(auditPage);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const recalcOne = async (id) => {
    setBusy(true);
    try {
      const { data } = await pointsApi.recalcUser(id);
      toast.success(`Recalculated — ${fmtNum(data.data.points)} points`);
      if (detail) await refreshDetail(id);
      loadUsers(); loadOverview();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const recalcAll = async () => {
    if (!window.confirm('Recalculate points for every student from scratch? Manual adjustments are preserved.')) return;
    setBusy(true);
    try {
      const { data } = await pointsApi.recalcAll();
      toast.success(`${data.data.recalculated} student(s) recalculated`);
      loadUsers(); loadOverview();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const saveRules = async (e) => {
    e.preventDefault();
    setSavingRules(true);
    try {
      const payload = Object.fromEntries(Object.entries(ruleForm).map(([k, v]) => [k, Number(v)]));
      const { data } = await pointsApi.saveRules(payload);
      toast.success(`Rules saved — ${data.data.recalculated} student(s) recalculated`);
      loadRules(); loadUsers(); loadOverview();
    } catch (e) { toast.error(e.message); } finally { setSavingRules(false); }
  };

  const resetRules = () => {
    if (!rules) return;
    setRuleForm(Object.fromEntries(rules.map((r) => [r.key, r.default])));
    toast.info('Defaults filled in — press Save to apply');
  };

  /* ---------------------------------------------------------------- view */

  const o = overview;
  const drift = detail && detail.stored_points !== detail.breakdown.points;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <span className="eyebrow">Engagement</span>
          <h1>Points Management</h1>
          <p className="muted small">
            Set how points are earned, award or deduct them by hand, and see exactly where every
            student&rsquo;s total came from.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { loadOverview(); loadUsers(); }} disabled={busy}>🔄 Refresh</button>
          <button className="btn btn-primary" onClick={recalcAll} disabled={busy}>♻ Recalculate everyone</button>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="users" label="Students" value={o ? fmtNum(o.students) : '—'} hint="With a points record" />
        <StatCard icon="sparkle" label="Points in circulation" value={o ? fmtNum(o.total_points) : '—'} hint={o ? `avg ${fmtNum(o.avg_points)} each` : ''} />
        <StatCard icon="trophy" label="Highest total" value={o ? fmtNum(o.top_points) : '—'} hint={o && o.top && o.top[0] ? o.top[0].full_name : ''} />
        <StatCard icon="sliders" label="Manual adjustments" value={o ? fmtNum(o.adjustments) : '—'}
          hint={o ? `+${fmtNum(o.manual_awarded)} awarded · −${fmtNum(o.manual_deducted)} deducted` : ''} />
      </div>

      <div className="mt">
        <Tabs tabs={TABS} active={tab} onChange={setTab} label="Points sections" />
      </div>

      {/* ------------------------------------------------------- students */}
      {tab === 'students' && (
        <div className="card mt">
          <form
            className="row wrap mb-s"
            style={{ gap: 8 }}
            onSubmit={(e) => { e.preventDefault(); setPage(1); loadUsers(1, search); }}
          >
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Search name, email or college…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-ghost" type="submit">🔍 Search</button>
            {search && (
              <button className="btn btn-ghost" type="button" onClick={() => { setSearch(''); setPage(1); loadUsers(1, ''); }}>
                ✕ Clear
              </button>
            )}
          </form>

          {!rows && <Loader label="Loading students…" />}
          {rows && rows.length === 0 && <Empty title="No students found" hint="Try a different search term." />}
          {rows && rows.length > 0 && (
            <>
              <div className="table-wrap" tabIndex={0}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th><th>College</th><th>Points</th><th>Manual</th>
                      <th>Solved</th><th>Quizzes</th><th>Courses</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                            <Avatar user={u} size={28} />
                            <div>
                              <strong>{u.full_name}</strong>
                              <div className="tiny muted">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="small">{u.college || <span className="tiny muted">—</span>}</td>
                        <td><strong>{fmtNum(u.points)}</strong></td>
                        <td>
                          {Number(u.manual_points) === 0
                            ? <span className="tiny muted">—</span>
                            : (
                              <span className={`badge ${Number(u.manual_points) > 0 ? 'green' : 'red'}`}>
                                {Number(u.manual_points) > 0 ? '+' : ''}{fmtNum(u.manual_points)}
                              </span>
                            )}
                        </td>
                        <td>{u.problems_solved}</td>
                        <td>{u.quizzes_completed}</td>
                        <td>{u.courses_completed}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" onClick={() => openUser(u.id)} disabled={detailBusy}>
                            ⚖ Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={meta} onPage={(p) => { setPage(p); loadUsers(p, search); }} />
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- rules */}
      {tab === 'rules' && (
        <div className="card mt">
          {!rules && <Loader label="Loading rules…" />}
          {rules && (
            <form onSubmit={saveRules}>
              <div className="soft small mb">
                ⚠️ Changing a rule re-scores <strong>every student</strong> immediately. Manual
                adjustments are kept — only the earned portion is recomputed.
              </div>
              <div className="grid g2">
                {rules.map((r) => (
                  <label key={r.key} className="field">
                    <span>{r.label}</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      value={ruleForm[r.key] ?? ''}
                      onChange={(e) => setRuleForm({ ...ruleForm, [r.key]: e.target.value })}
                    />
                    <span className="tiny muted">{r.hint} (default {r.default})</span>
                  </label>
                ))}
              </div>
              <div className="row mt" style={{ gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={savingRules}>
                  {savingRules ? '⏳ Saving & recalculating…' : '💾 Save rules'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={resetRules} disabled={savingRules}>
                  ↩ Fill in defaults
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- audit */}
      {tab === 'audit' && (
        <div className="card mt">
          <div className="between mb-s">
            <h3>Every manual adjustment</h3>
            {auditMeta && <span className="tag">{fmtNum(auditMeta.total)} total</span>}
          </div>
          {!audit && <Loader label="Loading audit trail…" />}
          {audit && audit.length === 0 && (
            <Empty title="No manual adjustments yet" hint="Awards and deductions you make will be listed here." />
          )}
          {audit && audit.length > 0 && (
            <>
              <div className="table-wrap" tabIndex={0}>
                <table className="table">
                  <thead><tr><th>When</th><th>Student</th><th>Change</th><th>Reason</th><th>By</th><th></th></tr></thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td className="small" title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</td>
                        <td>
                          <strong>{a.full_name}</strong>
                          <div className="tiny muted">{a.email}</div>
                        </td>
                        <td>
                          <span className={`badge ${a.delta > 0 ? 'green' : 'red'}`}>
                            {a.delta > 0 ? '+' : ''}{fmtNum(a.delta)}
                          </span>
                        </td>
                        <td className="small">{a.reason}</td>
                        <td className="small">{a.actor || <span className="tiny muted">system</span>}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" onClick={() => revoke(a.id)} disabled={busy}>↩ Revoke</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={auditMeta} onPage={(p) => { setAuditPage(p); loadAudit(p); }} />
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------- per-user modal */}
      <Modal
        open={!!detail}
        title={detail ? `⚖ ${detail.user.full_name}` : ''}
        onClose={() => setDetail(null)}
        wide
      >
        {detail && (
          <>
            <p className="small muted">{detail.user.email}{detail.user.college ? ` • ${detail.user.college}` : ''}</p>

            <div className="row wrap mb" style={{ gap: 10, alignItems: 'baseline' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{fmtNum(detail.breakdown.points)}</div>
              <span className="muted small">points</span>
              {drift && (
                <span className="badge amber" title={`Stored value is ${fmtNum(detail.stored_points)}`}>
                  ⚠ stored total is stale — press Recalculate
                </span>
              )}
            </div>

            <h4 className="mb-s">Where the points come from</h4>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {PART_LABELS.map(([key, label]) => (
                    <tr key={key}>
                      <td className="small">{label}</td>
                      <td style={{ textAlign: 'right', width: 110 }}>
                        <strong>{detail.breakdown.parts[key] > 0 ? '+' : ''}{fmtNum(detail.breakdown.parts[key])}</strong>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtNum(detail.breakdown.points)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="tiny muted mt-s">
              {detail.breakdown.counts.coding_score} coding score · {detail.breakdown.counts.quiz_score} quiz marks ·
              {' '}{detail.breakdown.counts.perfect_quizzes} perfect paper(s) · {detail.breakdown.counts.courses_completed} course(s) completed
            </p>

            <h4 className="mt mb-s">Award or deduct</h4>
            <form onSubmit={submitAdjust}>
              <div className="row wrap" style={{ gap: 8 }}>
                <select
                  className="input"
                  style={{ maxWidth: 170 }}
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                >
                  <option value="delta">➕ Award (add)</option>
                  <option value="deduct">➖ Deduct</option>
                  <option value="set">🎯 Set total to</option>
                </select>
                <input
                  className="input"
                  style={{ maxWidth: 130 }}
                  type="number"
                  placeholder="Points"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 220 }}
                  placeholder="Reason (required — shown in the audit trail)"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
                <button className="btn btn-primary" type="submit" disabled={busy}>Apply</button>
              </div>
              <p className="tiny muted mt-s">
                Adjustments live in their own ledger, so they survive every recalculation.
                {form.mode === 'set' && ' “Set total” works out the difference for you.'}
              </p>
            </form>

            <h4 className="mt mb-s">Adjustment history</h4>
            {detail.history.length === 0 && <p className="small muted">No manual changes yet.</p>}
            {detail.history.length > 0 && (
              <div className="table-wrap" tabIndex={0} style={{ maxHeight: 240 }}>
                <table className="table">
                  <thead><tr><th>When</th><th>Change</th><th>Reason</th><th>By</th><th></th></tr></thead>
                  <tbody>
                    {detail.history.map((h) => (
                      <tr key={h.id}>
                        <td className="small">{timeAgo(h.created_at)}</td>
                        <td>
                          <span className={`badge ${h.delta > 0 ? 'green' : 'red'}`}>
                            {h.delta > 0 ? '+' : ''}{fmtNum(h.delta)}
                          </span>
                        </td>
                        <td className="small">{h.reason}</td>
                        <td className="small">{h.actor || <span className="tiny muted">system</span>}</td>
                        <td><button className="btn btn-sm btn-ghost" onClick={() => revoke(h.id)} disabled={busy}>↩</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => recalcOne(detail.user.id)} disabled={busy}>♻ Recalculate</button>
              <button className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
