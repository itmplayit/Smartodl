import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loader, Modal, Pagination } from './ui';
import { useToast } from '../context/ToastContext';
import { statusLabel } from '../utils/format';

/**
 * Generic admin CRUD screen.
 * Everything the admin panel needs — a searchable, paginated table with a
 * create/edit modal — driven by a small declarative config.
 *
 * Props:
 *   list, create, update, remove : API functions
 *   columns  : [{ key, label, render?(row), className? }]
 *   fields   : [{ name, label, type, options?, required?, help?, full?, default? }]
 *   defaults : initial values for the create form
 *   filters  : [{ name, label, options }]
 *   transformIn(row) : map an API row into form values (edit mode)
 *   transformOut(values): map form values into the API payload
 */
export default function Crud({
  title, eyebrow, subtitle, list, create, update, remove,
  columns = [], fields = [], defaults = {}, filters = [],
  transformIn, transformOut, canWrite = true, emptyHint, rowActions, onLoaded, pageSize = 10,
  extraToolbar,
}) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState(() => Object.fromEntries(filters.map((f) => [f.name, ''])));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [confirmRow, setConfirmRow] = useState(null);

  const params = useMemo(() => {
    const p = { page, limit: pageSize };
    if (search) p.search = search;
    Object.entries(filterValues).forEach(([k, v]) => { if (v !== '') p[k] = v; });
    return p;
  }, [page, pageSize, search, filterValues]);

  const load = async () => {
    setError('');
    try {
      const { data } = await list(params);
      setRows(data.data);
      setMeta(data.meta);
      onLoaded && onLoaded(data.data);
    } catch (e) { setError(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(params)]);

  const openCreate = () => {
    setEditing(null);
    setValues({ ...defaults });
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    const base = transformIn ? transformIn(row) : row;
    setValues({ ...defaults, ...base });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = transformOut ? transformOut(values, editing) : values;
      if (editing) await update(editing.id, payload);
      else await create(payload);
      toast.success(editing ? 'Changes saved' : 'Created successfully');
      setOpen(false);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const doRemove = async () => {
    if (!confirmRow) return;
    try {
      await remove(confirmRow.id);
      toast.success('Deleted');
      setConfirmRow(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const set = (name) => (e) => {
    const target = e.target;
    const value = target.type === 'checkbox' ? (target.checked ? 1 : 0) : target.value;
    setValues((v) => ({ ...v, [name]: value }));
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 style={{ marginBottom: 2 }}>{title}</h2>
          {subtitle && <p className="muted small" style={{ marginBottom: 0 }}>{subtitle}</p>}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {extraToolbar}
          {canWrite && create && <button className="btn btn-primary" onClick={openCreate}>➕ New</button>}
        </div>
      </div>

      <div className="card mb">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>Search
            <input className="input" value={search} placeholder="Type to filter…"
              onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          </label>
          {filters.map((f) => (
            <label className="field" key={f.name} style={{ minWidth: 170 }}>
              {f.label}
              <select className="select" value={filterValues[f.name]}
                onChange={(e) => { setPage(1); setFilterValues((v) => ({ ...v, [f.name]: e.target.value })); }}>
                <option value="">All</option>
                {(f.options || []).map((o) => (
                  <option key={o.value !== undefined ? o.value : o} value={o.value !== undefined ? o.value : o}>
                    {o.label !== undefined ? o.label : statusLabel(o)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!rows && !error && <Loader label="Loading…" />}
      {rows && rows.length === 0 && <Empty title="Nothing here yet" hint={emptyHint || 'Use the New button to add the first record.'} />}

      {rows && rows.length > 0 && (
        <>
          <div className="table-wrap scroll-x">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                  <th style={{ width: 170 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.className || ''}>
                        {c.render ? c.render(row) : (row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? <span className="muted">—</span> : String(row[c.key]))}
                      </td>
                    ))}
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {rowActions && rowActions(row, load)}
                        {canWrite && update && <button className="btn btn-sm btn-ghost" onClick={() => openEdit(row)}>✏️ Edit</button>}
                        {canWrite && remove && <button className="btn btn-sm btn-ghost" onClick={() => setConfirmRow(row)}>🗑</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={meta} onPage={setPage} />
        </>
      )}

      <Modal open={open} title={editing ? `Edit #${editing.id}` : `New ${title.replace(/s$/, '').toLowerCase()}`} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            {fields.map((f) => (
              <label className={`field ${f.full ? 'full' : ''}`} key={f.name}>
                {f.label}{f.required ? ' *' : ''}
                {f.type === 'textarea' ? (
                  <textarea className="textarea" rows={f.rows || 4} value={values[f.name] ?? ''} onChange={set(f.name)}
                    placeholder={f.placeholder} required={f.required} />
                ) : f.type === 'select' ? (
                  <select className="select" value={values[f.name] ?? ''} onChange={set(f.name)} required={f.required}>
                    <option value="">— choose —</option>
                    {(f.options || []).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : f.type === 'checkbox' ? (
                  <span className="row" style={{ gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={Number(values[f.name] || 0) === 1} onChange={set(f.name)} />
                    <span className="small muted">{f.help || 'Enabled'}</span>
                  </span>
                ) : f.type === 'file' ? (
                  <input className="input" type="file" accept={f.accept} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.files[0] }))} />
                ) : (
                  <input className="input" type={f.type || 'text'} value={values[f.name] ?? ''} onChange={set(f.name)}
                    placeholder={f.placeholder} required={f.required} min={f.min} max={f.max} step={f.step} />
                )}
                {f.help && f.type !== 'checkbox' && <span className="tiny muted">{f.help}</span>}
              </label>
            ))}
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!confirmRow} title="Confirm delete" onClose={() => setConfirmRow(null)}>
        <p className="small">Delete <strong>#{confirmRow && confirmRow.id}</strong> permanently? Related records may also be removed.</p>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setConfirmRow(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={doRemove}>Delete</button>
        </div>
      </Modal>
    </div>
  );
}
