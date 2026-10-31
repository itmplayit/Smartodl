import { useState } from 'react';

/**
 * Inline PDF reader for a lesson attachment.
 *
 * The browser's own PDF engine is used (`<iframe>`/`<object>`), so there is
 * nothing to bundle and no third-party viewer gets the file URL. Desktop
 * browsers render it inline; some mobile browsers cannot, so a clear
 * "open in new tab / download" path is always visible instead of a blank box.
 */
export function pdfSource(media, { download = false } = {}) {
  if (!media || !media.url) return null;
  const params = new URLSearchParams();
  if (media.ticket) params.set('ticket', media.ticket);
  if (download) params.set('download', '1');
  const query = params.toString();
  return query ? `${media.url}?${query}` : media.url;
}

export default function PdfViewer({ media, title, height = 620 }) {
  const [open, setOpen] = useState(true);
  if (!media || !media.url) return null;

  const inline = pdfSource(media);
  const download = pdfSource(media, { download: true });

  return (
    <section className="mb" aria-label="Lesson PDF">
      <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <strong className="small">📄 {media.name || title || 'Lesson notes'}</strong>
          <span className="tag">PDF</span>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide preview' : 'Show preview'}
          </button>
          <a className="btn btn-sm btn-ghost" href={inline} target="_blank" rel="noreferrer">Open in new tab</a>
          <a className="btn btn-sm btn-ghost" href={download}>Download</a>
        </div>
      </div>

      {open && (
        <div style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, overflow: 'hidden', background: '#f8fafc' }}>
          <iframe
            src={inline}
            title={media.name || title || 'Lesson PDF'}
            style={{ width: '100%', height, border: 0, display: 'block' }}
          />
          <p className="tiny muted" style={{ margin: 0, padding: '8px 10px', borderTop: '1px solid var(--line, #e5e7eb)' }}>
            Preview blank dikhe to browser PDF inline support nahi hai — “Open in new tab” use karein.
            File sirf enrolled learners ke liye hai; link 5 minute me expire hota hai.
          </p>
        </div>
      )}
    </section>
  );
}
