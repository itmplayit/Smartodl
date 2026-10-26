import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { pagesApi } from '../services/api';

/**
 * Renders any published information page (terms, privacy, refund, cookies …)
 * from `site_pages`. The slug comes from the route, so one component serves
 * every legal page and new pages an admin creates need no code change.
 */
export default function SitePage() {
  const { slug: param } = useParams();
  const { pathname } = useLocation();
  const slug = param || pathname.replace(/^\/+|\/+$/g, '');

  const [page, setPage] = useState(null);
  const [state, setState] = useState('loading');
  const [related, setRelated] = useState([]);

  useEffect(() => {
    let alive = true;
    setState('loading');
    (async () => {
      try {
        const [{ data }, list] = await Promise.all([
          pagesApi.get(slug),
          pagesApi.list().catch(() => ({ data: { data: [] } })),
        ]);
        if (!alive) return;
        setPage(data.data);
        setRelated((list.data?.data || []).filter((p) => p.slug !== slug && p.page_type === 'legal'));
        setState('ready');
      } catch (e) {
        if (alive) setState(e.response?.status === 404 ? 'missing' : 'error');
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  if (state === 'loading') {
    return (
      <div className="container section legal-page">
        <div className="skeleton-head" style={{ height: 28, width: 260, borderRadius: 8, background: 'var(--border)', marginBottom: 14 }} />
        <div style={{ height: 14, width: '60%', borderRadius: 6, background: 'var(--border)', opacity: 0.6 }} />
      </div>
    );
  }

  if (state !== 'ready') {
    return (
      <div className="container section legal-page">
        <header className="professional-page-head">
          <span className="eyebrow">{state === 'missing' ? 'Not published' : 'Unavailable'}</span>
          <h1>{state === 'missing' ? 'This page is not available' : 'We could not load this page'}</h1>
          <p className="muted">
            {state === 'missing'
              ? 'The page you asked for has not been published yet. It may be under review by the administrator.'
              : 'Something went wrong while loading this page. Please try again in a moment.'}
          </p>
        </header>
        <Link className="btn btn-primary" to="/">Back to home</Link>
      </div>
    );
  }

  const updated = page.updated_at
    ? new Date(page.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="container section legal-page">
      <header className="professional-page-head">
        {page.eyebrow && <span className="eyebrow">{page.eyebrow}</span>}
        <h1>{page.title}</h1>
        {page.summary && <p className="muted">{page.summary}</p>}
      </header>

      <ol className="legal-toc">
        {page.body.map((s, i) => (
          <li key={s.heading}><a href={`#s-${i + 1}`}>{s.heading}</a></li>
        ))}
      </ol>

      <div className="legal-sections">
        {page.body.map((s, i) => (
          <section className="card legal-section" id={`s-${i + 1}`} key={s.heading}>
            <h2><span className="legal-section-no">{i + 1}</span>{s.heading}</h2>
            <p>{s.text}</p>
          </section>
        ))}
      </div>

      {updated && <p className="small muted mt">Last updated: {updated}.</p>}

      {related.length > 0 && (
        <nav className="legal-related" aria-label="Other policies">
          <h2>Other policies</h2>
          <div className="legal-related-links">
            {related.map((p) => <Link key={p.slug} to={`/${p.slug}`}>{p.title}</Link>)}
          </div>
        </nav>
      )}
    </div>
  );
}
