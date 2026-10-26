import { Link } from 'react-router-dom';

const styles = `
  .ec-landing-banner { position: relative; min-height: var(--banner-height,clamp(290px,32vw,500px)); overflow: hidden; isolation: isolate; background: #002f49; }
  .ec-landing-banner__image { position: absolute; z-index: -2; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .ec-landing-banner::after { content: ""; position: absolute; z-index: -1; inset: 0; background: linear-gradient(90deg,var(--banner-overlay-start,rgba(0,24,39,.94)) 0%,var(--banner-overlay-mid,rgba(0,39,59,.82)) 38%,rgba(0,46,67,.28) 67%,rgba(0,24,39,.1) 100%); }
  .ec-landing-banner__inner { width: min(var(--landing-max-width,1180px),calc(100% - 40px)); min-height: inherit; display: flex; align-items: center; margin: auto; padding: 42px 0; }
  .ec-landing-banner__content { width: min(610px,58%); color: #fff; animation: ecBannerIn .55s ease-out both; }
  .ec-landing-banner.align-center .ec-landing-banner__content { width:min(760px,90%);margin:auto;text-align:center}.ec-landing-banner.align-center .ec-landing-banner__kicker{justify-content:center}.ec-landing-banner.align-center p{margin-inline:auto}.ec-landing-banner.align-center .ec-landing-banner__cta{margin-inline:auto}
  .ec-landing-banner.align-right .ec-landing-banner__content{margin-left:auto;text-align:right}.ec-landing-banner.align-right .ec-landing-banner__kicker{justify-content:flex-end}.ec-landing-banner.align-right p{margin-left:auto}.ec-landing-banner.align-right .ec-landing-banner__cta{margin-left:auto}
  .ec-landing-banner__kicker { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--accent,#ffd15a); font-size: .7rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
  .ec-landing-banner__kicker::before { content: ""; width: 28px; height: 2px; background: currentColor; }
  .ec-landing-banner h2 { max-width: 680px; margin: 0; color: #fff; font-size: clamp(2rem,4.2vw,4rem); line-height: 1.02; letter-spacing: -.045em; text-wrap: balance; }
  .ec-landing-banner p { max-width: 570px; margin: 17px 0 0; color: #d5e8ef; font-size: clamp(.9rem,1.25vw,1.05rem); line-height: 1.65; }
  .ec-landing-banner__cta { min-height: 46px; width: max-content; display: flex; align-items: center; gap: 10px; margin-top: 25px; padding: 0 17px; border-radius: calc(var(--landing-radius,8px) * .65); color: #152d36; background: var(--accent,#ffd15a); box-shadow: 0 10px 24px rgba(0,0,0,.2); font-size: .82rem; font-weight: 900; text-decoration: none; transition: transform .18s ease,filter .18s ease; }
  .ec-landing-banner__cta:hover { color: #152d36; filter:brightness(1.08); transform: translateY(-2px); text-decoration: none; }.ec-landing-banner__cta:focus-visible{outline:3px solid #fff;outline-offset:3px}.ec-landing-banner__cta span{transition:transform .18s ease}.ec-landing-banner__cta:hover span{transform:translateX(3px)}
  .ec-landing-banner.layout-content_card .ec-landing-banner__content{padding:30px;background:rgba(0,30,46,.78);border:1px solid rgba(255,255,255,.22);border-radius:var(--landing-radius,8px);box-shadow:0 18px 45px rgba(0,0,0,.25);backdrop-filter:blur(9px)}
  .ec-landing-banner.layout-content_card::after{background:linear-gradient(90deg,rgba(0,24,39,.55),rgba(0,39,59,.2))}
  .ec-landing-banner.layout-minimal .ec-landing-banner__inner{align-items:flex-end}.ec-landing-banner.layout-minimal .ec-landing-banner__content{width:min(760px,75%);padding:24px 0}.ec-landing-banner.layout-minimal::after{background:linear-gradient(0deg,rgba(0,24,39,.92),rgba(0,24,39,.08) 75%)}.ec-landing-banner.layout-minimal h2{font-size:clamp(1.9rem,3.5vw,3.25rem)}
  @keyframes ecBannerIn { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:none } }
  @media(max-width:700px){.ec-landing-banner{min-height:max(410px,var(--banner-height-mobile,410px))}.ec-landing-banner__image{object-position:64% center}.ec-landing-banner::after{background:linear-gradient(90deg,rgba(0,24,39,.96),rgba(0,39,59,.78) 74%,rgba(0,28,44,.48))}.ec-landing-banner__inner{width:min(100% - 30px,var(--landing-max-width,1180px));padding:34px 0;align-items:flex-end}.ec-landing-banner__content{width:100%!important;text-align:left!important;margin:0!important}.ec-landing-banner__kicker{justify-content:flex-start!important}.ec-landing-banner h2{max-width:520px;font-size:clamp(2rem,10vw,3rem)}.ec-landing-banner p{max-width:520px;margin-left:0!important}.ec-landing-banner__cta{margin-left:0!important;margin-right:0!important}}
  @media(prefers-reduced-motion:reduce){.ec-landing-banner__content{animation:none}.ec-landing-banner__cta,.ec-landing-banner__cta span{transition:none}}
`;

const bannerHeight = { compact: '300px', medium: 'clamp(290px,32vw,500px)', tall: 'clamp(390px,45vw,650px)' };

export default function LandingBanner({ block, settings = {}, enabled = true }) {
  const content = block?.content || {
    eyebrow: 'Featured at SmartODL', title: settings.landing_banner_title, subtitle: settings.landing_banner_subtitle,
    image: settings.landing_banner_image, imageAlt: '', primaryButton: { label: settings.landing_banner_cta_label, link: settings.landing_banner_cta_link },
  };
  const style = block?.style || {};
  const image = String(content.image || '').trim();
  if (!enabled || !image) return null;
  const title = String(content.title || '').trim();
  const subtitle = String(content.subtitle || '').trim();
  const eyebrow = String(content.eyebrow || '').trim();
  const label = String(content.primaryButton?.label || '').trim();
  const target = String(content.primaryButton?.link || '').trim();
  const external = /^https?:\/\//i.test(target);
  const internal = /^\/(?!\/)/.test(target);
  const cta = label && (external || internal) && (external
    ? <a className="ec-landing-banner__cta" href={target} target="_blank" rel="noreferrer">{label}<span aria-hidden="true">→</span></a>
    : <Link className="ec-landing-banner__cta" to={target}>{label}<span aria-hidden="true">→</span></Link>);
  const opacity = Math.max(0, Math.min(95, Number(style.overlay ?? 78))) / 100;

  return (
    <>
      <style>{styles}</style>
      <section className={`ec-landing-banner align-${style.alignment || 'left'} layout-${style.layout || 'cinematic'}`} aria-label={eyebrow || 'Featured learning opportunity'} style={{ '--banner-height': bannerHeight[style.height] || bannerHeight.medium, '--banner-overlay-start': `rgba(0,24,39,${Math.min(.98, opacity + .16)})`, '--banner-overlay-mid': `rgba(0,39,59,${opacity})` }}>
        <img className="ec-landing-banner__image" src={image} alt={String(content.imageAlt || '')} fetchpriority="high" />
        <div className="ec-landing-banner__inner"><div className="ec-landing-banner__content">
          {eyebrow && <span className="ec-landing-banner__kicker">{eyebrow}</span>}
          {title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}{cta}
        </div></div>
      </section>
    </>
  );
}
