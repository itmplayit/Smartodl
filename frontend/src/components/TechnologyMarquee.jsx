import { Link } from 'react-router-dom';

const TECHNOLOGIES = [
  { name: 'Python', mark: 'Py', color: '#3776ab' },
  { name: 'JavaScript', mark: 'JS', color: '#f7df1e', ink: '#18212b' },
  { name: 'TypeScript', mark: 'TS', color: '#3178c6' },
  { name: 'React', mark: 'Re', color: '#087ea4' },
  { name: 'Next.js', mark: 'N', color: '#111827' },
  { name: 'HTML', mark: 'H5', color: '#e34f26' },
  { name: 'CSS', mark: 'C3', color: '#1572b6' },
  { name: 'Java', mark: 'J', color: '#d93636' },
  { name: 'C++', mark: 'C+', color: '#00599c' },
  { name: 'SQL', mark: 'SQL', color: '#336791' },
  { name: 'C', mark: 'C', color: '#546e7a' },
  { name: 'C#', mark: 'C#', color: '#512bd4' },
  { name: 'PHP', mark: 'PHP', color: '#6667a8' },
  { name: 'Dart', mark: 'D', color: '#0175c2' },
  { name: 'Golang', mark: 'GO', color: '#00add8', ink: '#073642' },
  { name: 'Rust', mark: 'Rs', color: '#b7410e' },
  { name: 'Kotlin', mark: 'Kt', color: '#7f52ff' },
  { name: 'Git', mark: 'G', color: '#f05032' },
  { name: 'Docker', mark: 'Dk', color: '#1676d2' },
  { name: 'AI Prompts', mark: 'AI', color: '#7c3aed' },
];

const readableInk = (color) => {
  const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!match) return '#fff';
  const channels = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4));
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000' : '#fff';
};

const styles = `
  .ec-techbar, .ec-techbar * { box-sizing: border-box; }
  .ec-techbar {
    position: relative;
    width: 100%;
    height: 84px;
    display: flex;
    align-items: center;
    overflow: hidden;
    isolation: isolate;
    background: linear-gradient(110deg, var(--techbar-start,#003654) 0%, var(--techbar-mid,#075b78) 52%, var(--techbar-end,#003e5d) 100%);
    border-top: 1px solid rgba(255,255,255,.16);
    border-bottom: 1px solid rgba(0,28,43,.34);
  }
  .ec-techbar::before, .ec-techbar::after {
    content: "";
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: 0;
    width: 76px;
    pointer-events: none;
  }
  .ec-techbar::before { left: 0; background: linear-gradient(90deg, #003b58 10%, transparent); }
  .ec-techbar::after { right: 0; background: linear-gradient(270deg, #003f5e 10%, transparent); }
  .ec-techbar__viewport {
    width: 100%;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 64px, #000 calc(100% - 64px), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 64px, #000 calc(100% - 64px), transparent);
  }
  .ec-techbar__rail {
    width: max-content;
    display: flex;
    align-items: center;
    gap: 14px;
    animation: ecTechnologyRail 88s linear infinite;
    will-change: transform;
  }
  .ec-techbar__group {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 14px;
    white-space: nowrap;
  }
  .ec-techbar__chip {
    height: 48px;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 10px;
    padding: 6px 15px 6px 7px;
    border: 1px solid rgba(213,229,237,.92);
    border-radius: 9px;
    color: #173443;
    background: rgba(255,255,255,.97);
    box-shadow: 0 5px 13px rgba(0,25,39,.18);
    font: inherit;
    font-size: .86rem;
    font-weight: 800;
    text-decoration: none;
    transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
  }
  .ec-techbar__chip:hover {
    color: #01507c;
    background: #fff;
    box-shadow: 0 8px 18px rgba(0,25,39,.25);
    transform: translateY(-2px);
    text-decoration: none;
  }
  .ec-techbar__chip:focus-visible {
    outline: 3px solid #ffd15a;
    outline-offset: 3px;
  }
  .ec-techbar__badge {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    flex: 0 0 34px;
    border-radius: 7px;
    color: var(--badge-ink, #fff);
    background: var(--badge-color);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.2);
    font-size: .67rem;
    font-weight: 900;
    letter-spacing: -.02em;
  }
  .ec-techbar:hover .ec-techbar__rail,
  .ec-techbar:focus-within .ec-techbar__rail { animation-play-state: paused; }
  @keyframes ecTechnologyRail {
    to { transform: translate3d(calc(-33.333333% - 4.667px), 0, 0); }
  }
  .ec-techbar.layout-static_grid { height:auto;min-height:84px;padding:14px 22px; }
  .ec-techbar.layout-static_grid::before,.ec-techbar.layout-static_grid::after{display:none}
  .ec-techbar.layout-static_grid .ec-techbar__viewport{overflow:visible;mask-image:none;-webkit-mask-image:none}
  .ec-techbar.layout-static_grid .ec-techbar__rail{width:100%;animation:none;transform:none}
  .ec-techbar.layout-static_grid .ec-techbar__group{width:100%;flex-wrap:wrap;justify-content:center;white-space:normal}
  .ec-techbar.layout-static_grid .ec-techbar__group[aria-hidden="true"]{display:none}
  .ec-techbar.layout-compact{height:60px}.ec-techbar.layout-compact .ec-techbar__chip{height:38px;padding:4px 11px 4px 5px;font-size:.76rem}.ec-techbar.layout-compact .ec-techbar__badge{width:28px;height:28px;flex-basis:28px;font-size:.58rem}.ec-techbar.layout-compact .ec-techbar__rail,.ec-techbar.layout-compact .ec-techbar__group{gap:9px}
  :root[data-theme="dark"] .ec-techbar {
    background: linear-gradient(110deg, #071c27, #0c3344 52%, #071f2b);
    border-color: #294652;
  }
  :root[data-theme="dark"] .ec-techbar::before { background: linear-gradient(90deg, #071f2b 10%, transparent); }
  :root[data-theme="dark"] .ec-techbar::after { background: linear-gradient(270deg, #082330 10%, transparent); }
  :root[data-theme="dark"] .ec-techbar__chip {
    color: #ecf6fa;
    background: #12303e;
    border-color: #3d5c69;
    box-shadow: 0 5px 13px rgba(0,0,0,.25);
  }
  :root[data-theme="dark"] .ec-techbar__chip:hover { color: #fff; background: #173b4a; }
  @media (max-width: 700px) {
    .ec-techbar { height: 68px; }
    .ec-techbar::before, .ec-techbar::after { width: 38px; }
    .ec-techbar__viewport {
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 34px, #000 calc(100% - 34px), transparent);
      mask-image: linear-gradient(90deg, transparent, #000 34px, #000 calc(100% - 34px), transparent);
    }
    .ec-techbar__rail, .ec-techbar__group { gap: 10px; }
    .ec-techbar__rail { animation-duration: 72s; }
    .ec-techbar__chip { height: 42px; gap: 8px; padding: 5px 12px 5px 6px; font-size: .8rem; }
    .ec-techbar__badge { width: 30px; height: 30px; flex-basis: 30px; font-size: .61rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ec-techbar__viewport { overflow-x: auto; -webkit-mask-image: none; mask-image: none; scrollbar-width: thin; }
    .ec-techbar__rail { animation: none !important; transform: none !important; }
    .ec-techbar__group[aria-hidden="true"] { display: none; }
    .ec-techbar::before, .ec-techbar::after { display: none; }
  }
`;

export default function TechnologyMarquee({ block }) {
  const technologies = Array.isArray(block?.content?.technologies) && block.content.technologies.length ? block.content.technologies : TECHNOLOGIES;
  const ariaLabel = block?.content?.ariaLabel || 'Explore programming technologies';
  return (
    <>
      <style>{styles}</style>
      <section className={`ec-techbar layout-${block?.style?.layout || 'marquee'}`} aria-label={ariaLabel} style={{ '--techbar-start': block?.style?.startColor, '--techbar-mid': block?.style?.middleColor, '--techbar-end': block?.style?.endColor }}>
        <div className="ec-techbar__viewport">
          <div className="ec-techbar__rail">
            {[0, 1, 2].map((copy) => (
              <div className="ec-techbar__group" aria-hidden={copy > 0 ? 'true' : undefined} key={copy}>
                {technologies.map((technology) => (
                  <Link
                    className="ec-techbar__chip"
                    to={`/search?q=${encodeURIComponent(technology.name)}`}
                    tabIndex={copy > 0 ? -1 : undefined}
                    key={`${copy}-${technology.name}`}
                  >
                    <span
                      className="ec-techbar__badge"
                      style={{ '--badge-color': technology.color, '--badge-ink': technology.ink || readableInk(technology.color) }}
                      aria-hidden="true"
                    >
                      {technology.mark}
                    </span>
                    <span>{technology.name}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
