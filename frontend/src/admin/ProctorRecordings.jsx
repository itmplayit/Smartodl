import { useEffect, useRef, useState } from 'react';
import { quizApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Loader, Empty } from '../components/ui';

const bytes = (value) => {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export default function ProctorRecordings() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [players, setPlayers] = useState({});
  const playersRef = useRef(players);
  playersRef.current = players;

  const load = async () => {
    try {
      const { data } = await quizApi.adminProctorRecordings();
      setRows(data.data || []);
    } catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); return () => Object.values(playersRef.current).forEach((url) => URL.revokeObjectURL(url)); /* eslint-disable-next-line */ }, []);

  const play = async (file) => {
    setBusy(String(file.id));
    try {
      const { data } = await quizApi.adminProctorRecordingFile(file.id);
      const url = URL.createObjectURL(data);
      setPlayers((previous) => {
        if (previous[file.id]) URL.revokeObjectURL(previous[file.id]);
        return { ...previous, [file.id]: url };
      });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Permanently delete all camera and screen files for ${row.student_name} — ${row.quiz_title}? This cannot be undone.`)) return;
    setBusy(row.session_id);
    try {
      await quizApi.deleteAdminProctorRecording(row.session_id);
      setPlayers((previous) => {
        const next = { ...previous };
        row.files.forEach((file) => { if (next[file.id]) URL.revokeObjectURL(next[file.id]); delete next[file.id]; });
        return next;
      });
      toast.success('Recording files deleted');
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  if (!rows) return <Loader label="Loading private recordings…" />;
  return (
    <div className="container section">
      <div className="section-head between wrap">
        <div><span className="eyebrow">Admin only</span><h2>⏺️ Proctor Recordings</h2>
          <p className="muted small">Private app-server files. Only administrators can play or permanently delete them. Students must have explicitly consented before any chunks are uploaded.</p></div>
        <button className="btn" type="button" onClick={load}>↻ Refresh</button>
      </div>
      {rows.length === 0 ? <Empty title="No saved recordings" hint="Completed or interrupted recordings with uploaded video appear here." /> : (
        <div className="grid" style={{ gap: 14 }}>
          {rows.map((row) => (
            <section className="card" key={row.session_id}>
              <div className="between wrap" style={{ gap: 10 }}>
                <div><h3 style={{ margin: 0 }}>{row.student_name || `Student ${row.user_id}`}</h3>
                  <div className="tiny muted">{row.quiz_title} · attempt #{row.attempt_id} · {row.status} · {bytes(row.total_bytes)}</div>
                  <div className="tiny muted">Started {row.started_at ? new Date(row.started_at).toLocaleString() : '—'} · ended {row.ended_at ? new Date(row.ended_at).toLocaleString() : '—'}</div>
                </div>
                <button className="btn btn-sm" type="button" disabled={busy === row.session_id} onClick={() => remove(row)}>🗑 Delete all</button>
              </div>
              <div className="grid mt" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {row.files.map((file) => (
                  <div className="panel" key={file.id}>
                    <div className="between"><strong>{file.feed === 'camera' ? '🎥 Webcam' : '🖥️ Screen'}</strong><span className="tiny muted">{bytes(file.byte_size)}</span></div>
                    {players[file.id] ? <video controls playsInline preload="metadata" src={players[file.id]} style={{ width: '100%', marginTop: 8, borderRadius: 8, background: '#000' }} /> : (
                      <button className="btn btn-sm mt" type="button" disabled={busy === String(file.id)} onClick={() => play(file)}>{busy === String(file.id) ? 'Loading…' : '▶ Load & play'}</button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
