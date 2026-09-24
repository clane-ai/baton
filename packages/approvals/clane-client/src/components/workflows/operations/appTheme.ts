import type { CSSProperties } from 'react';

/**
 * The Workflow screens compose from the shared design-system components,
 * whose tokens (`.cl-ds`, src/ds/tokens.css) carry their own type, accent,
 * surfaces and radii. The app around them (src/styles/tokens.css) is set in
 * Figtree with its own accent and surfaces. Mapping the design-system tokens
 * onto the app's here makes every shared component in the section, and the
 * inbox panel on Home, read as the same product as the shell, in both themes,
 * without touching the components. Status colours (done, running, failed,
 * needs you) stay the design system's.
 *
 * Tokens the two sets share by name (--font-mono, --text-faint) are left
 * alone: a custom property cannot refer to itself.
 */
export const APP_THEME = {
  // Type: the app's face for body and headings.
  '--font-body': 'var(--font-sans)',
  '--font-display': 'var(--font-heading)',
  // One accent: the app's, for the primary action, selection and links.
  '--blue-500': 'var(--accent)',
  '--blue-tint': 'var(--accent-wash)',
  '--blue-tint-border': 'var(--accent-hair)',
  '--blue-selected-border': 'var(--accent-hair)',
  '--cta': 'var(--accent)',
  '--cta-text': 'var(--ink-0)',
  '--link': 'var(--accent)',
  // Text, surfaces and borders: the app's.
  '--ink': 'var(--text)',
  '--text-primary': 'var(--text)',
  '--text-secondary': 'var(--text-mute)',
  '--text-tertiary': 'var(--text-dim)',
  '--surface-card': 'var(--ink-1)',
  '--bg-app': 'var(--ink-0)',
  '--bg-page': 'var(--ink-0)',
  '--border-app': 'var(--hair)',
  '--border-default': 'var(--hair)',
  '--border-subtle': 'var(--hair-soft)',
  // Radii: the app's scale.
  '--radius-sm': 'var(--r-sm)',
  '--radius-input': 'var(--r-sm)',
  '--radius-btn': 'var(--r-md)',
  '--radius-btn-lg': 'var(--r-md)',
  '--radius-panel': 'var(--r-md)',
  '--radius-card': 'var(--r-md)',
  '--radius-card-lg': 'var(--r-lg)',
} as CSSProperties;
