import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { pagesApi } from '../services/api';

/** Help centre: searchable, category-grouped accordion backed by `site_pages`. */
export default function Faq() {
  const [page, setPage] = useState(null);
  const [state, setState] = useState('loading');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState({});   // `${ci}-${qi}` -> bool

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await pagesApi.get('faq');
        if (alive) { setPage(data.data); setState('ready'); }
      } catch (_) {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, []);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = page?.body || [];
    if (!needle) return all;
    return all
      .map((c) => ({ ...c, items: c.items.filter((it) => `${it.q} ${it.a}`.toLowerCase().includes(needle)) }))
      .filter((c) => c.items.length);
  }, [page, needle]);

  const hits = groups.reduce((n, c) => n + c.items.length, 0);
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  if (state === 'loading') {
    return (
      <div className="container section legal-page">
        <div style={{ height: 28, width: 280, borderRadius: 8, background: 'var(--border)', marginBottom: 14 }} />
        <div style={{ height: 14, width: '55%', borderRadius: 6, background: 'var(--border)', opacity: 0.6 }} />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="container section legal-page">
        <header className="professional-page-head">
          <span className="eyebrow">Unavailable</span>
          <h1>We could not load the help centre</h1>
          <p className="muted">Please try again in a moment, or use the contact page to reach us directly.</p>
        </header>
        <Link className="btn btn-primary" to="/contact">Contact support</Link>
      </div>
    );
  }

  return (
    <div className="container section legal-page">
      <header className="professional-page-head">
        {page.eyebrow && <span className="eyebrow">{page.eyebrow}</span>}
        <h1>{page.title}</h1>
        {page.summary && <p className="muted">{page.summary}</p>}
      </header>

      <div className="faq-search">
        <label className="sr-only" htmlFor="faq-q">Search the help centre</label>
        <input
          id="faq-q" className="input" type="search" placeholder="Search questions and answers…"
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        {needle && (
          <span className="small muted" role="status">
            {hits === 0 ? 'No matches' : `${hits} matching ${hits === 1 ? 'answer' : 'answers'}`}
          </span>
        )}
      </div>

      {!needle && (
        <nav className="faq-jump" aria-label="FAQ categories">
          {page.body.map((c, i) => <a key={c.category} href={`#c-${i + 1}`}>{c.category}</a>)}
        </nav>
      )}

      {hits === 0 && needle ? (
        <div className="card faq-empty">
          <h2>Nothing matched “{query.trim()}”</h2>
          <p className="muted">Try a shorter phrase, or reach us from the contact page and we will answer directly.</p>
          <Link className="btn btn-primary" to="/contact">Contact support</Link>
        </div>
      ) : groups.map((cat, ci) => (
        <section className="faq-group" id={`c-${ci + 1}`} key={cat.category}>
          <h2 className="faq-group-title">{cat.category}</h2>
          <div className="faq-list">
            {cat.items.map((it, qi) => {
              const key = `${cat.category}-${qi}`;
              const isOpen = !!open[key] || !!needle;
              return (
                <div className={`faq-item${isOpen ? ' is-open' : ''}`} key={key}>
                  <h3>
                    <button
                      type="button" className="faq-q" aria-expanded={isOpen}
                      aria-controls={`a-${ci}-${qi}`} onClick={() => toggle(key)}
                    >
                      <span>{it.q}</span>
                      <span className="faq-chevron" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                    </button>
                  </h3>
                  {isOpen && <div className="faq-a" id={`a-${ci}-${qi}`}><p>{it.a}</p></div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="card faq-cta">
        <h2>Still stuck?</h2>
        <p className="muted">If your question is not answered here, send us the details and we will get back to you.</p>
        <div className="faq-cta-links">
          <Link className="btn btn-primary" to="/contact">Contact support</Link>
          <Link className="btn btn-ghost" to="/terms">Terms of use</Link>
          <Link className="btn btn-ghost" to="/privacy">Privacy policy</Link>
          <Link className="btn btn-ghost" to="/refund">Refunds</Link>
        </div>
      </div>
    </div>
  );
}
