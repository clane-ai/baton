// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Logo.jsx (2026-09-24) so specs run against the real markup.
import React, { useEffect } from 'react';

// Clane node mark — flat (no gloss), theme-aware hub, optional pulse. The pulse
// is a *state*, not a default: pass active while an agent is working and the
// coloured nodes breathe and ripple; otherwise it sits still. Colours are the
// tuned Spectrum set — orange (top) / magenta (middle) / teal (bottom) held at
// one saturation + lightness, neutral slate links, and a hub that is navy on
// light grounds and near-white on dark.
const LOGO_CSS = `
.cl-logo { --cl-hub: #14233d; display: inline-block; line-height: 0; overflow: visible; }
html[data-mode="dark"] .cl-logo, html[data-theme="dark"] .cl-logo { --cl-hub: #eef2f8; }
.cl-logo .cl-node { transform-box: fill-box; transform-origin: center; }
.cl-logo .cl-halo { transform-box: fill-box; transform-origin: center; opacity: 0; }
.cl-logo.is-active .cl-node { animation: cl-breathe 2.6s ease-in-out infinite; }
.cl-logo.is-active .cl-halo { animation: cl-ripple 2.6s ease-out infinite; }
.cl-logo .cl-d1 { animation-delay: 0s; }
.cl-logo .cl-d2 { animation-delay: .8s; }
.cl-logo .cl-d3 { animation-delay: 1.6s; }
.cl-logo .cl-dh { animation-delay: .4s; }
@keyframes cl-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes cl-ripple { 0% { transform: scale(1); opacity: .55; } 72% { opacity: 0; } 100% { transform: scale(2.3); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .cl-logo.is-active .cl-node, .cl-logo.is-active .cl-halo { animation: none; }
  .cl-logo .cl-halo { opacity: 0; }
}
`;

let injected = false;
function useLogoStyles() {
  useEffect(() => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const el = document.createElement('style');
    el.setAttribute('data-cl-logo', '');
    el.textContent = LOGO_CSS;
    document.head.appendChild(el);
  }, []);
}

export function Logo({ size = 28, active = false, title = 'Clane', style }) {
  useLogoStyles();
  return (
    <svg
      className={active ? 'cl-logo is-active' : 'cl-logo'}
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={title}
      style={style}
    >
      <g stroke="#7c88a8" strokeWidth="48" strokeLinecap="round">
        <line x1="602" y1="460" x2="416" y2="258" />
        <line x1="602" y1="460" x2="352" y2="573" />
        <line x1="602" y1="460" x2="490" y2="733" />
      </g>
      <circle className="cl-halo cl-d3" cx="490" cy="733" r="70" fill="#14b8a6" />
      <circle className="cl-halo cl-d2" cx="352" cy="573" r="63" fill="#e5399a" />
      <circle className="cl-halo cl-d1" cx="416" cy="258" r="70" fill="#f97316" />
      <circle className="cl-node cl-d3" cx="490" cy="733" r="70" fill="#14b8a6" />
      <circle className="cl-node cl-d2" cx="352" cy="573" r="63" fill="#e5399a" />
      <circle className="cl-node cl-d1" cx="416" cy="258" r="70" fill="#f97316" />
      <circle className="cl-node cl-dh" cx="602" cy="460" r="93" fill="var(--cl-hub)" />
    </svg>
  );
}
