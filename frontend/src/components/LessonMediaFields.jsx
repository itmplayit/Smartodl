import { useState } from 'react';
import { lessonApi } from '../services/api';
import { useToast } from '../context/ToastContext';

/**
 * Upload / replace / remove a lesson's video and PDF.
 *
 * Used by both lesson editors (course form + modules manager). Uploads happen
 * after the lesson exists, because the file belongs to a lesson row: for a new
 * lesson the parent form creates it first, then renders these fields.
 */
export default function LessonMediaFields({ lessonId, video, pdf, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [videoFile, setVideoFile] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);

  if (!lessonId) {
    return (
      <div className="notice small" style={{ textAlign: 'left' }}>
        💡 Video/PDF upload lesson save hone ke baad available hota hai — pehle lesson create karein,
        phir wahi lesson edit karke file chunein.
      </div>
    );
  }

  const upload = async (kind) => {
    const file = kind === 'video' ? videoFile : pdfFile;
    if (!file) return;
    setBusy(kind);
    setProgress(0);
    try {
      const api = kind === 'video' ? lessonApi.uploadVideo : lessonApi.uploadPdf;
      const { data } = await api(lessonId, file, (event) => {
        if (event.total) setProgress(Math.round((event.loaded / event.total) * 100));
      });
      toast.success(`${kind === 'video' ? 'Video' : 'PDF'} upload ho gaya`);
      if (kind === 'video') setVideoFile(null); else setPdfFile(null);
      onChanged?.(data.data);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setBusy('');
      setProgress(0);
    }
  };

  const remove = async (kind) => {
    setBusy(`${kind}-remove`);
    try {
      const api = kind === 'video' ? lessonApi.removeVideo : lessonApi.removePdf;
      const { data } = await api(lessonId);
      toast.success(`${kind === 'video' ? 'Video' : 'PDF'} hata diya`);
      onChanged?.(data.data);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally { setBusy(''); }
  };

  const row = (kind, current, file, setFile, accept, hint) => (
    <div className="panel" style={{ padding: 12 }}>
      <div className="between wrap" style={{ gap: 8 }}>
        <div>
          <strong className="small">{kind === 'video' ? '🎬 Lesson video' : '📄 Lesson PDF'}</strong>
          <p className="tiny muted" style={{ margin: '2px 0 0' }}>
            {current ? `Current: ${current.name}` : hint}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {current && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => remove(kind)}>
              {busy === `${kind}-remove` ? 'Removing…' : 'Remove'}
            </button>
          )}
          <label className="btn btn-sm btn-ghost" style={{ margin: 0, cursor: 'pointer' }}>
            {current ? 'Replace' : 'Choose file'}
            <input
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!file || !!busy}
            onClick={() => upload(kind)}
          >
            {busy === kind ? `Uploading ${progress}%` : 'Upload'}
          </button>
        </div>
      </div>
      {file && <p className="tiny muted" style={{ margin: '6px 0 0' }}>Selected: {file.name} ({Math.round(file.size / (1024 * 1024) * 10) / 10} MB)</p>}
      {busy === kind && <div className="progress mt-s"><i style={{ width: `${progress}%` }} /></div>}
    </div>
  );

  return (
    <div className="stack mt-s" style={{ gap: 10 }}>
      {row('video', video, videoFile, setVideoFile, 'video/mp4,video/webm,video/ogg,video/x-m4v',
        'MP4, WebM ya OGV — browser me seek ke saath chalta hai.')}
      {row('pdf', pdf, pdfFile, setPdfFile, 'application/pdf',
        'Sirf PDF — lesson page par inline reader me khulega.')}
      <p className="tiny muted" style={{ margin: 0 }}>
        Uploaded files public URL se nahi khulte: har request par enrolment check hota hai.
      </p>
    </div>
  );
}
