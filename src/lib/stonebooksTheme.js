// =============================================================================
// Stonebooks — Theme system & design tokens
// =============================================================================
// One source of truth for colors, spacing, typography. Light + dark variants.
// Components read from CSS variables — never hardcoded hex.
// =============================================================================

export const STONEBOOKS_TOKENS = {
  // Spacing scale — 4px base
  space: {
    px:  '1px',
    0:   '0',
    1:   '4px',
    2:   '8px',
    3:   '12px',
    4:   '16px',
    5:   '20px',
    6:   '24px',
    8:   '32px',
    10:  '40px',
    12:  '48px',
    16:  '64px',
  },

  radius: {
    none: '0',
    sm:   '4px',
    md:   '6px',
    lg:   '8px',
    full: '999px',
  },

  // Typography stacks. `display` is the Quote Hub title face (Fraunces); `sans`
  // is the shared body face (Quote Hub body inherits the app sans).
  font: {
    sans: '"Inter", "Söhne", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    display: '"Fraunces", Georgia, serif',
    mono: '"JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
  },

  // Type scale — Migration Phase 1 (Design System foundation, 2026-05-21).
  // Whole scale lifted one step so primary body reads at 17px (load-bearing
  // operational read) and metadata floor moves off 12px (developer-tool feel).
  // Hero stays at 40 — already declarative. Working surfaces inherit the lift
  // automatically; no per-component bumps required for general improvement.
  fontSize: {
    xs:    '13px',  // metadata floor — mono IDs, timestamps, cemetery sub-text
    sm:    '14px',  // small labels, chip text (used sparingly)
    base:  '15px',  // secondary body — meta lines on rows, dates, captions
    md:    '17px',  // PRIMARY body — list rows, customer names, milestone labels
    lg:    '19px',  // medium emphasis — JobDetail field labels, balance numerals
    xl:    '22px',  // section emphasis — NRA badge, deceased name, page subheaders
    '2xl': '26px',  // intermediate emphasis (metric values, intermediate H2)
    '3xl': '32px',  // page titles (Today, Jobs, Orders, Customers)
    '4xl': '40px',  // hero text (home opening sentence, deceased name reveal)
  },
}

// Light theme — the default. Palette adopted verbatim from the Quote Hub screen
// (src/QuoteHub.jsx) so the whole app shares the Quote Hub look.
export const STONEBOOKS_LIGHT = {
  // Surfaces
  bg:           '#faf7f1',  // QH page background (warm cream)
  surface:      '#ffffff',  // QH card / panel
  surfaceMuted: '#fdf6e8',  // QH pending-line / muted cream
  sidebar:      '#2a2118',  // QH warm brownish-dark (its darkest value) — no navy

  // Borders
  border:       '#ece3d2',  // QH default border
  borderHover:  '#e4dcc8',  // QH input border (slightly darker)
  borderFocus:  '#9a7209',  // QH gold ring

  // Text
  textPrimary:   '#2a2118',  // QH primary/body
  textSecondary: '#6b6256',  // QH secondary
  textMuted:     '#8a7f6c',  // QH tertiary
  textOnDark:    '#faf7f1',  // QH cream — text on the warm-dark sidebar
  textOnDarkMuted: '#a89c86', // QH warm subtle — muted on-dark text/nav (warm contrast)

  // Accent — QH brand gold
  accent:       '#9a7209',
  accentHover:  '#876307',
  accentBg:     '#f5ede0',

  // Bronze — operational identity accent. Aligned to the QH brand gold so the
  // active-nav stripe / badges match the Quote Hub.
  bronze:       '#9a7209',

  // Status colors (QH greens/reds)
  statusRed:     '#b3261e',  statusRedBg:    '#fbeceb',
  statusGreen:   '#2d7a4f',  statusGreenBg:  '#e8f5ee',
  statusAmber:   '#b39a6a',  statusAmberBg:  '#fdf6e8',
  statusBlue:    '#9a7209',  statusBlueBg:   '#f5ede0',
}

// Dark theme — inverts surface relationship; same accents
export const STONEBOOKS_DARK = {
  bg:           '#0a0d12',
  surface:      '#13171f',
  surfaceMuted: '#1c2029',
  sidebar:      '#0a0d12',

  border:       '#2a2e38',
  borderHover:  '#3a3e48',
  borderFocus:  '#3b82f6',

  textPrimary:   '#fafafa',
  textSecondary: '#a3a3a0',
  textMuted:     '#6b6b67',
  textOnDark:    '#fafafa',
  textOnDarkMuted: '#9b9b97',

  accent:       '#3b82f6',
  accentHover:  '#60a5fa',
  accentBg:     '#1e293b',

  bronze:       '#c9a468',

  statusRed:     '#dc6262',  statusRedBg:    '#2d1414',
  statusGreen:   '#4ea874',  statusGreenBg:  '#0f2418',
  statusAmber:   '#d9a44e',  statusAmberBg:  '#2a1f0c',
  statusBlue:    '#3b82f6',  statusBlueBg:   '#1e293b',
}

// Build a single CSS string from tokens — injected once at the root
export function buildThemeCSS(theme = 'light') {
  const t = theme === 'dark' ? STONEBOOKS_DARK : STONEBOOKS_LIGHT
  const k = STONEBOOKS_TOKENS

  return `
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&display=swap');
    :root {
      --sb-bg:           ${t.bg};
      --sb-canvas:       ${t.bg};
      --sb-surface:      ${t.surface};
      --sb-surface-muted:${t.surfaceMuted};
      --sb-sidebar:      ${t.sidebar};
      --sb-border:       ${t.border};
      --sb-border-hover: ${t.borderHover};
      --sb-border-focus: ${t.borderFocus};
      --sb-text:         ${t.textPrimary};
      --sb-text-secondary:${t.textSecondary};
      --sb-text-muted:   ${t.textMuted};
      --sb-text-on-dark: ${t.textOnDark};
      --sb-text-on-dark-muted: ${t.textOnDarkMuted};
      --sb-accent:       ${t.accent};
      --sb-accent-hover: ${t.accentHover};
      --sb-accent-bg:    ${t.accentBg};
      --sb-bronze:       ${t.bronze};
      --sb-red:    ${t.statusRed};   --sb-red-bg:   ${t.statusRedBg};
      --sb-green:  ${t.statusGreen}; --sb-green-bg: ${t.statusGreenBg};
      --sb-amber:  ${t.statusAmber}; --sb-amber-bg: ${t.statusAmberBg};
      --sb-blue:   ${t.statusBlue};  --sb-blue-bg:  ${t.statusBlueBg};

      --sb-font-sans: ${k.font.sans};
      --sb-font-display: ${k.font.display};
      --sb-font-mono: ${k.font.mono};

      --sb-r-sm:   ${k.radius.sm};
      --sb-r-md:   ${k.radius.md};
      --sb-r-lg:   ${k.radius.lg};
      --sb-r-full: ${k.radius.full};
    }
    /* Quote Hub title face applied to page/section titles app-wide. */
    .sb-od-title, .sb-page-title, .sb-page-head h1, .sb-page-head h2,
    .qh-title, .qh-review-name, .sb-hero-title, .sb-tab-title { font-family: var(--sb-font-display); }
  `
}

// Persist theme preference to localStorage so reloads keep it
const THEME_KEY = 'stonebooks_theme'

export function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {}
  // Default to light per design brief — matches "calm, neutral"
  return 'light'
}

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme) } catch {}
}
