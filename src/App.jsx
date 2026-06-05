import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { getSession, onAuthStateChange, signInWithPassword } from './lib/auth'
import SalesMode from './SalesMode'
import Stonebooks from './Stonebooks'
import CatalogTab from './CatalogTab'

// ── BUILD MODE ROUTING ───────────────────────────────────────────
// Two deployments from one repo:
//   VITE_APP_MODE=customer   → public catalog + sales portal (default)
//   VITE_APP_MODE=stonebooks → staff-only Stonebooks app (login required)
// Set the env var per Vercel project to ship the right bundle.
const APP_MODE = import.meta.env.VITE_APP_MODE || 'customer'

// ── DESIGN TOKENS ────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Lato:wght@300;400;700;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --cream: #faf8f4;
    --cream-dark: #f0ede6;
    --cream-mid: #e8e4dc;
    --navy: #1e2d3d;
    --navy-mid: #2c3e50;
    --text: #2a2a2a;
    --text-mid: #555;
    --text-light: #888;
    --border: #e0dbd2;
    --border-dark: #cdc8be;
    --accent: #8c6d3f;
    --accent-light: #b8935a;
    --accent-pale: #f5ede0;
    --white: #fff;
    --green: #2d6a4f;
    --green-pale: #e8f5ee;
    --green-border: #7ac4a0;
    --gold: #c9a84c;
    --shadow: 0 2px 12px rgba(30,45,61,0.08);
    --shadow-md: 0 4px 24px rgba(30,45,61,0.12);
    --radius: 8px;
    --font-d: 'Playfair Display', Georgia, serif;
    --font-b: 'Lato', sans-serif;
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--cream);
    color: var(--text);
    font-family: var(--font-b);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  button { cursor: pointer; font-family: var(--font-b); }
  input, select, textarea { font-family: var(--font-b); }

  /* HEADER */
  .header {
    background: var(--white);
    border-bottom: 1px solid var(--border);
    padding: 0 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 66px;
    position: sticky;
    top: 0;
    z-index: 300;
    gap: 12px;
    box-shadow: var(--shadow);
  }
  .logo { font-family: var(--font-d); font-size: 22px; font-weight: 700; color: var(--navy); cursor: pointer; letter-spacing: -0.5px; }
  .logo span { color: var(--accent); }
  .header-search {
    display: flex;
    align-items: center;
    background: var(--cream);
    border: 1.5px solid var(--border-dark);
    border-radius: 6px;
    padding: 0 12px;
    gap: 8px;
    height: 38px;
    flex: 1;
    max-width: 400px;
    transition: border-color 0.2s;
  }
  .header-search:focus-within { border-color: var(--navy); background: var(--white); }
  .header-search input { background: none; border: none; outline: none; color: var(--text); font-size: 13px; width: 100%; }
  .header-search input::placeholder { color: var(--text-light); }
  .header-btns { display: flex; gap: 6px; flex-shrink: 0; }

  /* BUTTONS */
  .btn {
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    padding: 8px 16px;
    border: none;
  }
  .btn-outline { background: none; border: 1.5px solid var(--navy); color: var(--navy); }
  .btn-outline:hover { background: var(--navy); color: var(--white); }
  .btn-navy { background: var(--navy); border: 1.5px solid var(--navy); color: var(--white); }
  .btn-navy:hover { background: var(--navy-mid); }
  .btn-gold { background: var(--gold); color: #1a1a1a; border: none; }
  .btn-gold:hover { background: #e2c97e; }
  .btn-green { background: var(--green); color: #fff; border: none; }
  .btn-sm { padding: 6px 12px; font-size: 10px; }

  /* NAV TABS */
  .nav-tabs {
    background: var(--white);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 22px;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 2px;
  }
  .nav-tabs::-webkit-scrollbar { display: none; }
  .nav-tab {
    padding: 13px 14px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-light);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    white-space: nowrap;
    background: none;
    border-left: none;
    border-right: none;
    border-top: none;
  }
  .nav-tab:hover { color: var(--navy); }
  .nav-tab.active { color: var(--navy); border-bottom-color: var(--accent); }

  /* FILTER BAR */
  .filter-bar {
    background: var(--cream-dark);
    border-bottom: 1px solid var(--border);
    padding: 8px 22px;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .filter-bar::-webkit-scrollbar { display: none; }
  .filter-label { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); flex-shrink: 0; }
  .chip {
    background: var(--white);
    border: 1px solid var(--border-dark);
    color: var(--text-mid);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .chip:hover { border-color: var(--navy); color: var(--navy); }
  .chip.active { background: var(--navy); border-color: var(--navy); color: var(--white); }

  /* PHOTO GRID */
  .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .photo-card {
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s;
    box-shadow: var(--shadow);
  }
  .photo-card:hover { border-color: var(--navy); box-shadow: var(--shadow-md); transform: translateY(-2px); }
  .photo-thumb {
    width: 100%;
    aspect-ratio: 4/3;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }
  .photo-thumb img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
  .photo-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    background: var(--navy);
    color: var(--white);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
  }
  .fav-btn {
    position: absolute;
    top: 7px;
    left: 7px;
    background: rgba(255,255,255,0.9);
    border: none;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.2s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    color: #999;
  }
  .fav-btn:hover { background: #fff; transform: scale(1.15); }
  .fav-btn.saved { color: #c0392b; }
  .photo-info { padding: 10px 12px 12px; }
  .photo-id { font-size: 10px; color: var(--accent); letter-spacing: 2px; font-weight: 700; margin-bottom: 2px; }
  .photo-ln { font-family: var(--font-d); font-size: 15px; font-weight: 600; color: var(--navy); line-height: 1.1; margin-bottom: 2px; }
  .photo-nm { font-size: 11px; color: var(--text-mid); line-height: 1.3; margin-bottom: 6px; }
  .photo-tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .tag { background: var(--cream-dark); color: var(--text-mid); font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 700; }
  .tag-carve { background: #e8f0e4; color: #3a5c2e; }
  .tag-color { background: #e4ecf5; color: #1e3a5c; }

  /* GALLERY HEADER */
  .gallery-header {
    background: var(--white);
    border-bottom: 1px solid var(--border);
    padding: 16px 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
  }
  .gallery-title { font-family: var(--font-d); font-size: 20px; color: var(--navy); font-weight: 400; }
  .gallery-count { font-size: 12px; color: var(--text-light); margin-top: 2px; }
  .sort-select {
    background: var(--cream);
    border: 1px solid var(--border-dark);
    color: var(--text);
    padding: 7px 11px;
    border-radius: 5px;
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }

  /* PAGINATION */
  .pagination { display: flex; justify-content: center; align-items: center; gap: 5px; padding: 24px 0; flex-wrap: wrap; }
  .page-btn {
    background: var(--white);
    border: 1px solid var(--border-dark);
    color: var(--text-mid);
    padding: 7px 13px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 700;
    transition: all 0.2s;
  }
  .page-btn:hover { border-color: var(--navy); color: var(--navy); }
  .page-btn.active { background: var(--navy); border-color: var(--navy); color: #fff; }
  .page-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  /* MODAL */
  .overlay {
    display: flex;
    position: fixed;
    inset: 0;
    background: rgba(20,30,40,0.8);
    z-index: 500;
    align-items: center;
    justify-content: center;
    padding: 18px;
    backdrop-filter: blur(3px);
  }
  .modal {
    background: var(--white);
    border-radius: 10px;
    max-width: 640px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-md);
  }
  .modal-head {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    position: sticky;
    top: 0;
    background: var(--white);
    z-index: 2;
  }
  .modal-id { font-size: 10px; color: var(--accent); letter-spacing: 2px; font-weight: 700; margin-bottom: 2px; }
  .modal-ln { font-family: var(--font-d); font-size: 22px; color: var(--navy); font-weight: 600; line-height: 1.1; margin-bottom: 2px; }
  .modal-sub { font-size: 12px; color: var(--text-mid); }
  .modal-close { background: none; border: none; color: var(--text-light); font-size: 26px; line-height: 1; padding: 0 3px; }
  .modal-close:hover { color: var(--navy); }
  .modal-body { padding: 18px 20px; }
  .modal-img { width: 100%; aspect-ratio: 4/3; background: #fff; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; overflow: hidden; border: 1px solid var(--border); }
  .modal-img img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
  .modal-desc { font-size: 13px; color: var(--text-mid); line-height: 1.7; margin-bottom: 16px; font-weight: 300; }
  .modal-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 16px; margin-bottom: 16px; padding: 13px; background: var(--cream); border-radius: var(--radius); }
  .meta-lbl { font-size: 9px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #8c7a66; margin-bottom: 2px; }
  .meta-val { font-family: var(--font-d); font-size: 13px; color: var(--navy); }
  .modal-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 16px; }
  .modal-tag { background: var(--cream-dark); border: 1px solid var(--border-dark); color: var(--text-mid); font-size: 11px; padding: 3px 9px; border-radius: 20px; font-weight: 700; }
  .modal-actions { display: flex; gap: 7px; flex-wrap: wrap; }

  /* SECTION */
  .section { max-width: 1280px; margin: 0 auto; padding: 28px 22px; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; gap: 10px; }
  .section-title { font-family: var(--font-d); font-size: 22px; font-weight: 400; color: var(--navy); }
  .see-all { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); background: none; border: none; }
  .see-all:hover { color: var(--navy); }

  /* HERO */
  .hero { background: linear-gradient(160deg, var(--navy) 0%, var(--navy-mid) 100%); padding: 44px 24px 38px; text-align: center; }
  .hero-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 12px; }
  .hero h1 { font-family: var(--font-d); font-size: clamp(22px,5vw,42px); font-weight: 400; line-height: 1.15; color: var(--white); margin-bottom: 9px; }
  .hero h1 em { font-style: italic; color: #d4b483; }
  .hero-sub { font-size: 13px; color: rgba(255,255,255,0.55); max-width: 460px; margin: 0 auto 26px; line-height: 1.7; font-weight: 300; }
  .hero-stats { display: flex; justify-content: center; gap: 38px; flex-wrap: wrap; }
  .hero-stat-num { font-family: var(--font-d); font-size: 28px; font-weight: 500; color: #d4b483; line-height: 1; }
  .hero-stat-label { font-size: 10px; color: rgba(255,255,255,0.4); letter-spacing: 2px; text-transform: uppercase; margin-top: 3px; }

  /* CAT GRID */
  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 9px; }
  .cat-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 11px 13px; cursor: pointer; transition: all 0.2s; text-align: center; box-shadow: var(--shadow); }
  .cat-card:hover { border-color: var(--navy); box-shadow: var(--shadow-md); transform: translateY(-2px); }
  .cat-icon { font-size: 22px; margin-bottom: 7px; display: block; }
  .cat-name { font-family: var(--font-d); font-size: 13px; font-weight: 500; color: var(--navy); margin-bottom: 2px; line-height: 1.2; }
  .cat-sub { font-size: 10px; color: var(--text-light); }

  /* SALES BANNER */
  .sales-banner { background: var(--navy); border-radius: var(--radius); padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; box-shadow: var(--shadow-md); }
  .sales-banner-title { font-family: var(--font-d); font-size: 18px; color: var(--white); font-weight: 400; margin-bottom: 3px; }
  .sales-banner-sub { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.5; }

  /* LOADING */
  .loading { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-light); font-size: 14px; gap: 10px; }
  .spinner { width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--navy); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* TOAST */
  .toast { position: fixed; bottom: 18px; right: 18px; background: var(--green); color: #fff; padding: 10px 16px; border-radius: 5px; font-size: 13px; font-weight: 700; z-index: 9999; box-shadow: var(--shadow-md); animation: slideUp 0.3s ease; }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  /* FAVORITES PANEL */
  .fav-panel { position: fixed; right: 0; top: 66px; width: 300px; height: calc(100vh - 66px); background: var(--white); border-left: 1px solid var(--border); box-shadow: -4px 0 20px rgba(0,0,0,0.1); z-index: 250; overflow-y: auto; display: flex; flex-direction: column; }
  .fav-panel-head { background: var(--navy); padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .fav-panel-head h3 { font-family: var(--font-d); font-size: 15px; color: #fff; font-weight: 400; }
  .fav-close { background: none; border: none; color: rgba(255,255,255,0.6); font-size: 22px; line-height: 1; }
  .fav-close:hover { color: #fff; }
  .fav-body { padding: 14px; flex: 1; }
  .fav-item { display: flex; gap: 9px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid var(--border); }
  .fav-item:last-child { border-bottom: none; }
  .fav-thumb { width: 56px; height: 42px; border-radius: 3px; overflow: hidden; flex-shrink: 0; background: #fff; border: 1px solid var(--border); }
  .fav-thumb img { width: 100%; height: 100%; object-fit: contain; }
  .fav-ln { font-family: var(--font-d); font-size: 12px; color: var(--navy); font-weight: 600; }
  .fav-footer { padding: 12px 14px; border-top: 1px solid var(--border); flex-shrink: 0; display: flex; flex-direction: column; gap: 5px; }
  .fav-toggle { position: fixed; right: 0; top: 50%; transform: translateY(-50%); background: var(--navy); color: #fff; border: none; border-radius: 7px 0 0 7px; padding: 12px 9px; z-index: 249; font-size: 16px; box-shadow: -2px 0 8px rgba(0,0,0,0.12); display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .fav-badge { background: var(--gold); color: #1a1a1a; border-radius: 50%; width: 17px; height: 17px; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .no-saved { text-align: center; padding: 30px 14px; color: var(--text-light); font-size: 12px; line-height: 1.6; }

  @media (max-width: 700px) {
    .header { padding: 0 12px; height: 58px; }
    .header-search { max-width: none; }
    .photo-grid { grid-template-columns: repeat(2, 1fr); }
    .cat-grid { grid-template-columns: repeat(3, 1fr); }
    .modal-meta { grid-template-columns: 1fr; }
    .fav-panel { width: 260px; }
    .hero { padding: 28px 14px 24px; }
    .hero-stats { gap: 22px; }
  }
`

const PER_PAGE = 48

const EXCLUDES = {
  'slant':          ['double-slant','upright-single','upright-double','flat','custom-shape'],
  'double-slant':   ['slant','upright-single','upright-double','flat','custom-shape'],
  'upright-single': ['slant','double-slant','upright-double','flat','custom-shape'],
  'upright-double': ['slant','double-slant','upright-single','flat','custom-shape'],
  'flat':           ['slant','double-slant','upright-single','upright-double','custom-shape'],
  'custom-shape':   ['slant','double-slant','upright-single','upright-double','flat'],
}

const CATEGORIES = [
  { id: 'slant', label: 'Slants', icon: '🪨', sub: 'Single slants' },
  { id: 'double-slant', label: 'Double Slants', icon: '🪨', sub: 'Companion slants' },
  { id: 'upright-single', label: 'Single Upright', icon: '🗿', sub: 'Individual' },
  { id: 'upright-double', label: 'Double Upright', icon: '⬛', sub: 'Companion' },
  { id: 'flat', label: 'Flat Markers', icon: '▬', sub: 'Flush & bevel' },
  { id: 'custom-shape', label: 'Custom Shapes', icon: '💎', sub: 'Heart, book, cross' },
  { id: 'hand-sculpted', label: 'Hand Sculpted', icon: '✋', sub: 'Finest craft' },
  { id: 'religious', label: 'Religious', icon: '✝', sub: 'Cross, angels' },
  { id: 'jewish', label: 'Jewish', icon: '✡', sub: 'Star of David' },
  { id: 'veteran', label: 'Veteran', icon: '🎖', sub: 'Military' },
  { id: 'floral', label: 'Floral', icon: '🌹', sub: 'Flowers & nature' },
  { id: 'scenic', label: 'Scenic', icon: '🌅', sub: 'Landscapes' },
]

const FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'gray', label: 'Gray' },
  { id: 'jet-black', label: 'Jet Black' },
  { id: 'bahama-blue', label: 'Bahama Blue' },
  { id: 'red', label: 'Red' },
  { id: 'pink', label: 'Pink' },
  { id: 'brown', label: 'Brown' },
  { id: 'flat-carve', label: 'Flat Carve' },
  { id: 'shape-carve', label: 'Shape Carved' },
  { id: 'hand-sculpted', label: 'Hand Sculpted' },
  { id: 'skin-frosted', label: 'Skin Frosted' },
  { id: 'laser', label: 'Laser Etched' },
  { id: 'religious', label: 'Religious' },
  { id: 'jewish', label: 'Jewish' },
  { id: 'christian', label: 'Christian' },
  { id: 'double', label: 'Companion' },
  { id: 'floral', label: 'Floral' },
  { id: 'scenic', label: 'Scenic' },
  { id: 'veteran', label: 'Veteran' },
  { id: 'simple', label: 'Simple' },
]

// ── IMAGE URL REWRITING ──────────────────────────────────────────
// Google Drive thumbnail URLs default to sz=w800. The photo grid only renders
// at ~200px wide, so we rewrite to sz=w400 — that's a ~4x file-size reduction
// and dramatically speeds up the initial catalog load. Modal/detail views keep
// the larger size for clarity. Falls through unchanged for non-Drive URLs.
const thumbUrl = (url) => {
  if (!url) return url
  if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w400')
  return url
}
const fullUrl = (url) => {
  if (!url) return url
  if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w1200')
  return url
}

// ── MAIN APP ─────────────────────────────────────────────────────
// The /catalog route (or ?catalog=1) renders the catalog as its OWN isolated
// link — no CRM sidebar, tabs, or links to Orders / Payments / Profit. It opens
// in a new browser tab from the CRM so the CRM stays in its own tab and the
// catalog tab can be handed to a customer. Still behind staff auth.
const isCatalogRoute = () => {
  if (typeof window === 'undefined') return false
  if (window.location.pathname.replace(/\/+$/, '') === '/catalog') return true
  return new URLSearchParams(window.location.search).get('catalog') === '1'
}

export default function App() {
  if (isCatalogRoute()) {
    return <CatalogStandalone />
  }
  // ── If this is a staff build, render Stonebooks instead ──
  if (APP_MODE === 'stonebooks') {
    return <Stonebooks />
  }
  return <CustomerApp />
}

// Standalone catalog: staff sign-in gate, then the gallery/detail with NO CRM
// chrome. "Start an order from this" opens the sales wizard as a full-screen
// overlay (seeded with the design) and returns here on close. There is no
// visible path into the CRM from this route.
function CatalogStandalone() {
  const [authed, setAuthed] = useState(undefined)
  const [seed, setSeed] = useState(null)
  useEffect(() => {
    let cancelled = false
    getSession().then((s) => { if (!cancelled) setAuthed(!!s) })
    const unsub = onAuthStateChange((u) => setAuthed(!!u))
    return () => { cancelled = true; unsub() }
  }, [])

  if (authed === undefined) {
    return (<><style>{css}</style><div className="loading" style={{ minHeight: '100vh' }}><div className="spinner" />Loading…</div></>)
  }
  if (!authed) return <CatalogLoginGate />
  if (seed) return <SalesMode onClose={() => setSeed(null)} seedDesign={seed} />
  return (
    <div style={{ minHeight: '100vh', background: '#fbfaf7' }}>
      <div style={{ borderBottom: '1px solid #ece8e0', background: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, color: '#1e2330' }}>
          Shevchenko <span style={{ color: '#9A7209' }}>Monuments</span>
        </span>
        <span style={{ fontSize: 11, color: '#9a948a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Catalog</span>
      </div>
      <CatalogTab onStartOrder={setSeed} />
    </div>
  )
}

// ── PRIVATE-APP LOGIN GATE ───────────────────────────────────────
// The catalog is no longer public. An unauthenticated visitor gets a branded
// staff sign-in instead of an empty page. On success, CustomerApp's auth
// listener flips `authed` and the catalog renders.
const gateInput = {
  width: '100%', padding: '11px 13px', marginBottom: 10, fontSize: 14,
  border: '1px solid var(--border-dark)', borderRadius: 6, outline: 'none',
  background: 'var(--cream)', color: 'var(--text)',
}
function CatalogLoginGate() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const r = await signInWithPassword(email, password)
    setBusy(false)
    if (!r.ok) setErr(r.error)
    // On success the auth listener in CustomerApp flips `authed` → catalog shows.
  }
  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 20 }}>
        <form onSubmit={submit} style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, padding: '34px 30px', width: '100%', maxWidth: 380, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: 24, color: 'var(--navy)', marginBottom: 4 }}>Shevchenko <span style={{ color: 'var(--accent)' }}>Monuments</span></div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 22 }}>Staff sign-in required.</div>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoFocus autoComplete="username" style={gateInput} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" style={gateInput} />
          {err && <div style={{ color: '#b54040', fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <button type="submit" className="btn btn-navy" disabled={busy} style={{ width: '100%', padding: '12px', fontSize: 13 }}>{busy ? 'Signing in…' : 'Sign In'}</button>
        </form>
      </div>
    </>
  )
}

function CustomerApp() {
  const [monuments, setMonuments] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('home')
  const [galleryPage, setGalleryPage] = useState(1)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortBy, setSortBy] = useState('default')
  const [galleryTitle, setGalleryTitle] = useState('All Designs')
  const [modal, setModal] = useState(null)
  const [favorites, setFavorites] = useState([])
  const [favOpen, setFavOpen] = useState(false)
  const [toast, setToast] = useState(null)
  // The catalog is private (anon has zero DB access). undefined = checking auth,
  // false = signed out → login gate, true = signed in → catalog.
  const [authed, setAuthed] = useState(undefined)

  // Resolve the session and subscribe to auth changes. Signing in flips `authed`
  // → the catalog renders and its data load fires.
  useEffect(() => {
    let cancelled = false
    getSession().then(s => { if (!cancelled) setAuthed(!!s) })
    const unsub = onAuthStateChange((u) => setAuthed(!!u))
    return () => { cancelled = true; unsub() }
  }, [])

  // Load all monuments from Supabase — only once signed in (anon reads nothing).
  useEffect(() => {
    if (authed !== true) return
    let cancelled = false
    async function load() {
      setLoading(true)
      let all = []
      let from = 0
      const batchSize = 1000
      while (true) {
        const { data, error } = await supabase
          .from('monuments')
          .select('*')
          .range(from, from + batchSize - 1)
        if (error || !data || data.length === 0) break
        all = [...all, ...data]
        if (data.length < batchSize) break
        from += batchSize
      }
      if (cancelled) return
      setMonuments(all)
      setFiltered(all)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [authed])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const isFav = (id) => favorites.some(f => f.id === id)

  const toggleFav = (e, m) => {
    e.stopPropagation()
    if (isFav(m.id)) {
      setFavorites(prev => prev.filter(f => f.id !== m.id))
      showToast('Removed from saved')
    } else {
      setFavorites(prev => [...prev, m])
      showToast('♥ Design saved')
    }
  }

  const applyFilter = useCallback((cat, monData) => {
    const data = monData || monuments
    if (cat === 'all') return data
    const excluded = EXCLUDES[cat] || []
    if (excluded.length) {
      return data.filter(m => m.cats && m.cats.includes(cat) && !excluded.some(e => m.cats.includes(e)))
    }
    return data.filter(m => m.cats && m.cats.includes(cat))
  }, [monuments])

  const applySort = useCallback((data, sort) => {
    const d = [...data]
    if (sort === 'lastname') d.sort((a, b) => (a.lastname || 'zzz').localeCompare(b.lastname || 'zzz'))
    if (sort === 'type') d.sort((a, b) => (a.carve_type || '').localeCompare(b.carve_type || ''))
    if (sort === 'color') d.sort((a, b) => (a.granite_color || '').localeCompare(b.granite_color || ''))
    return d
  }, [])

  const handleSearch = (val) => {
    setSearch(val)
    if (!val.trim()) {
      setFiltered(monuments)
      setGalleryPage(1)
      return
    }
    const q = val.toLowerCase()
    const results = monuments.filter(m =>
      (m.lastname && m.lastname.toLowerCase().includes(q)) ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      (m.granite_color && m.granite_color.toLowerCase().includes(q)) ||
      (m.carve_type && m.carve_type.toLowerCase().includes(q)) ||
      (m.tags && m.tags.some(t => t.toLowerCase().includes(q))) ||
      (m.cats && m.cats.some(c => c.toLowerCase().includes(q)))
    )
    setFiltered(results)
    setGalleryTitle('Search Results')
    setGalleryPage(1)
    setPage('gallery')
  }

  const filterByCat = (cat, data) => {
    if (cat === 'all') return data
    const excluded = EXCLUDES[cat] || []
    if (excluded.length) {
      return data.filter(m => m.cats && m.cats.includes(cat) && !excluded.some(e => m.cats.includes(e)))
    }
    return data.filter(m => m.cats && m.cats.includes(cat))
  }

  const goToCategory = (cat) => {
    const results = cat === 'all' ? monuments : filterByCat(cat, monuments)
    setFiltered(results)
    setActiveFilter(cat)
    setGalleryTitle(FILTER_CHIPS.find(c => c.id === cat)?.label || CATEGORIES.find(c => c.id === cat)?.label || 'Designs')
    setGalleryPage(1)
    setPage('gallery')
  }

  const handleSort = (sort) => {
    setSortBy(sort)
    setFiltered(prev => applySort(prev, sort))
  }

  // Paginated data
  const sortedFiltered = applySort(filtered, sortBy)
  const totalPages = Math.ceil(sortedFiltered.length / PER_PAGE)
  const pageData = sortedFiltered.slice((galleryPage - 1) * PER_PAGE, galleryPage * PER_PAGE)

  const openModal = (m) => setModal(m)
  const closeModal = () => setModal(null)

  // Keyboard close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const showSimilar = () => {
    if (!modal) return
    const keys = modal.similarity_keys || modal.cats || []
    const similar = monuments.filter(m => m.id !== modal.id && (m.similarity_keys || m.cats || []).some(c => keys.includes(c)))
    setFiltered(similar)
    setGalleryTitle('Similar to ' + (modal.lastname || modal.id))
    setGalleryPage(1)
    closeModal()
    setPage('gallery')
  }

  const renderCard = (m) => (
    <div key={m.id} className="photo-card" onClick={() => openModal(m)}>
      <div className="photo-thumb">
        {m.img
          ? <img src={thumbUrl(m.img)} alt={m.lastname || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          : <span style={{ fontSize: 30, opacity: 0.2 }}>🪨</span>
        }
        {m.badge && <div className="photo-badge">{m.badge}</div>}
        <button
          className={`fav-btn${isFav(m.id) ? ' saved' : ''}`}
          onClick={(e) => toggleFav(e, m)}
          title="Save design"
        >
          {isFav(m.id) ? '♥' : '♡'}
        </button>
      </div>
      <div className="photo-info">
        <div className="photo-id">{m.id}</div>
        {m.lastname && <div className="photo-ln">{m.lastname}</div>}
        <div className="photo-nm">{(m.name || '').substring(0, 55)}{m.name && m.name.length > 55 ? '…' : ''}</div>
        <div className="photo-tags">
          {m.carve_type && <span className="tag tag-carve">{m.carve_type}</span>}
          {m.granite_color && <span className="tag tag-color">{m.granite_color}</span>}
        </div>
      </div>
    </div>
  )

  const renderPagination = () => {
    if (totalPages <= 1) return null
    const range = []
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - galleryPage) <= 2) range.push(i)
      else if (range[range.length - 1] !== '...') range.push('...')
    }
    return (
      <div className="pagination">
        <button className="page-btn" disabled={galleryPage === 1} onClick={() => { setGalleryPage(p => p - 1); window.scrollTo(0, 0) }}>← Prev</button>
        {range.map((r, i) =>
          r === '...'
            ? <span key={i} style={{ padding: '0 4px', color: 'var(--text-light)' }}>…</span>
            : <button key={r} className={`page-btn${galleryPage === r ? ' active' : ''}`} onClick={() => { setGalleryPage(r); window.scrollTo(0, 0) }}>{r}</button>
        )}
        <button className="page-btn" disabled={galleryPage === totalPages} onClick={() => { setGalleryPage(p => p + 1); window.scrollTo(0, 0) }}>Next →</button>
      </div>
    )
  }

  const showGalleryAll = () => {
    setFiltered(monuments)
    setActiveFilter('all')
    setGalleryTitle('All Designs')
    setGalleryPage(1)
    setPage('gallery')
  }

  // Private app: resolve auth before showing anything.
  if (authed === undefined) {
    return (
      <>
        <style>{css}</style>
        <div className="loading" style={{ minHeight: '100vh' }}><div className="spinner" />Loading…</div>
      </>
    )
  }
  // Unauthenticated visitor → staff sign-in, not an empty catalog.
  if (!authed) {
    return <CatalogLoginGate />
  }

  return (
    <>
      <style>{css}</style>

      {/* HEADER */}
      <header className="header">
        <div className="logo" onClick={() => setPage('home')}>
          Shevchenko <span>Monuments</span>
        </div>
        <div className="header-search">
          <span style={{ color: 'var(--text-light)' }}>⌖</span>
          <input
            type="text"
            placeholder="Search by last name, style, color…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => { setSearch(''); setFiltered(monuments); setPage('gallery'); setGalleryTitle('All Designs') }} style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 16, padding: 0 }}>✕</button>
          )}
        </div>
        <div className="header-btns">
          <button className="btn btn-outline btn-sm" onClick={showGalleryAll}>All Designs</button>
          <button className="btn btn-gold btn-sm" onClick={() => setPage('sales')}>▶ Sales Mode</button>
        </div>
      </header>

      {/* NAV TABS */}
      <nav className="nav-tabs">
        {[
          { id: 'home', label: 'Home' },
          { id: 'gallery-all', label: 'All Designs' },
          { id: 'slant', label: 'Slants' },
          { id: 'double-slant', label: 'Double Slants' },
          { id: 'upright-double', label: 'Double Upright' },
          { id: 'upright-single', label: 'Single Upright' },
          { id: 'flat', label: 'Flat Markers' },
          { id: 'custom-shape', label: 'Custom Shape' },
          { id: 'info-colors', label: 'Stone Colors' },
          { id: 'info-services', label: 'Services' },
          { id: 'contract', label: '📄 Contract' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`nav-tab${page === tab.id || (tab.id === 'gallery-all' && page === 'gallery' && activeFilter === 'all') ? ' active' : ''}`}
            onClick={() => {
              if (tab.id === 'home') setPage('home')
              else if (tab.id === 'gallery-all') showGalleryAll()
              else if (['slant', 'double-slant', 'upright-double', 'upright-single', 'flat', 'custom-shape'].includes(tab.id)) goToCategory(tab.id)
              else setPage(tab.id)
            }}
          >{tab.label}</button>
        ))}
      </nav>

      {/* FILTER BAR — only on gallery/home */}
      {(page === 'gallery' || page === 'home') && (
        <div className="filter-bar">
          <span className="filter-label">Filter:</span>
          {FILTER_CHIPS.map(chip => (
            <div
              key={chip.id}
              className={`chip${activeFilter === chip.id ? ' active' : ''}`}
              onClick={() => {
                setActiveFilter(chip.id)
                const results = chip.id === 'all' ? monuments : filterByCat(chip.id, monuments)
                setFiltered(results)
                setGalleryTitle(chip.id === 'all' ? 'All Designs' : chip.label)
                setGalleryPage(1)
                if (page === 'home') setPage('gallery')
              }}
            >
              {chip.label}{chip.id === 'all' ? ` (${monuments.length})` : ''}
            </div>
          ))}
        </div>
      )}

      {/* HOME PAGE */}
      {page === 'home' && (
        <div>
          <div className="hero">
            <div className="hero-eyebrow">★ Design Catalog · Est. 1919 · Perth Amboy, NJ</div>
            <h1>Find the <em>Perfect Memorial</em><br />for Every Family</h1>
            <p className="hero-sub">Search by family name, browse by style, or let Sales Mode guide you with personalized recommendations.</p>
            <div className="hero-stats">
              <div className="hero-stat">
                <div className="hero-stat-num">{monuments.length}</div>
                <div className="hero-stat-label">Designs</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-num">{monuments.length}</div>
                <div className="hero-stat-label">Real Photos</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-num">5</div>
                <div className="hero-stat-label">Carving Types</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-num">7+</div>
                <div className="hero-stat-label">Granite Colors</div>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="sales-banner">
              <div>
                <div className="sales-banner-title">Guided Sales Mode</div>
                <div className="sales-banner-sub">3 quick questions — instantly see the best matching designs for your customer.</div>
              </div>
              <button className="btn btn-gold" style={{ padding: '11px 22px' }} onClick={() => setPage('sales')}>▶ Launch Sales Mode</button>
            </div>

            <div className="section-head">
              <div className="section-title">Browse by Category</div>
              <button className="see-all" onClick={showGalleryAll}>View All →</button>
            </div>
            <div className="cat-grid">
              {CATEGORIES.map(cat => (
                <div key={cat.id} className="cat-card" onClick={() => goToCategory(cat.id)}>
                  <span className="cat-icon">{cat.icon}</span>
                  <div className="cat-name">{cat.label}</div>
                  <div className="cat-sub">{cat.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Featured */}
          {!loading && (
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="section-head">
                <div className="section-title">Featured Designs</div>
                <button className="see-all" onClick={showGalleryAll}>View All →</button>
              </div>
              <div className="photo-grid">
                {monuments.filter(m => m.badge).slice(0, 8).map(renderCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GALLERY PAGE */}
      {page === 'gallery' && (
        <div>
          <div className="gallery-header">
            <div>
              <div className="gallery-title">{galleryTitle}</div>
              <div className="gallery-count">{filtered.length} design{filtered.length !== 1 ? 's' : ''}</div>
            </div>
            <select className="sort-select" value={sortBy} onChange={e => handleSort(e.target.value)}>
              <option value="default">Sort: Default</option>
              <option value="lastname">Last Name A–Z</option>
              <option value="type">By Type</option>
              <option value="color">By Color</option>
            </select>
          </div>
          <div className="section">
            {loading
              ? <div className="loading"><div className="spinner" />Loading designs…</div>
              : filtered.length === 0
                ? <div className="loading">No designs found</div>
                : <div className="photo-grid">{pageData.map(renderCard)}</div>
            }
            {renderPagination()}
          </div>
        </div>
      )}

      {/* SALES MODE — full-screen wizard from SalesMode.jsx */}
      {page === 'sales' && <SalesMode onClose={() => setPage('home')} />}

      {/* CONTRACT - placeholder */}
      {page === 'contract' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 66px)' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-light)' }}>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 28, color: 'var(--navy)', marginBottom: 12 }}>Contract Generator</div>
            <div style={{ marginBottom: 24 }}>Coming in next build</div>
            <button className="btn btn-navy" onClick={() => setPage('home')}>← Back to Catalog</button>
          </div>
        </div>
      )}

      {/* STONE COLORS - placeholder */}
      {page === 'info-colors' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 66px)' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-light)' }}>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 28, color: 'var(--navy)', marginBottom: 12 }}>Stone Colors</div>
            <div style={{ marginBottom: 24 }}>Coming in next build</div>
            <button className="btn btn-navy" onClick={() => setPage('home')}>← Back</button>
          </div>
        </div>
      )}

      {/* SERVICES - placeholder */}
      {page === 'info-services' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 66px)' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-light)' }}>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 28, color: 'var(--navy)', marginBottom: 12 }}>Our Services</div>
            <div style={{ marginBottom: 24 }}>Coming in next build</div>
            <button className="btn btn-navy" onClick={() => setPage('home')}>← Back</button>
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-id">{modal.id}</div>
                <div className="modal-ln">{modal.lastname || modal.name}</div>
                {modal.lastname && <div className="modal-sub">{modal.name}</div>}
              </div>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="modal-img">
                {modal.img
                  ? <img src={fullUrl(modal.img)} alt={modal.lastname || ''} decoding="async" referrerPolicy="no-referrer" />
                  : <span style={{ fontSize: 60, opacity: 0.2 }}>🪨</span>
                }
              </div>
              {modal.description && <div className="modal-desc">{modal.description}</div>}
              {modal.meta && Object.keys(modal.meta).length > 0 && (
                <div className="modal-meta">
                  {Object.entries(modal.meta).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <div className="meta-lbl">{k}</div>
                      <div className="meta-val">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-tags">
                {modal.carve_type && <span className="modal-tag">{modal.carve_type}</span>}
                {modal.granite_color && <span className="modal-tag">{modal.granite_color}</span>}
                {(modal.tags || []).map(t => <span key={t} className="modal-tag">{t}</span>)}
              </div>
              <div className="modal-actions">
                <button className="btn btn-outline btn-sm" onClick={showSimilar}>Show Similar</button>
                <button
                  className={`btn btn-sm${isFav(modal.id) ? ' btn-green' : ''}`}
                  style={!isFav(modal.id) ? { background: 'var(--green-pale)', color: 'var(--green)', border: '1px solid var(--green-border)' } : {}}
                  onClick={(e) => toggleFav(e, modal)}
                >
                  {isFav(modal.id) ? '♥ Saved' : '♡ Save Design'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={closeModal}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FAVORITES PANEL */}
      {favOpen && (
        <div className="fav-panel">
          <div className="fav-panel-head">
            <h3>♥ Saved Designs</h3>
            <button className="fav-close" onClick={() => setFavOpen(false)}>×</button>
          </div>
          <div className="fav-body">
            {favorites.length === 0
              ? <div className="no-saved"><div style={{ fontSize: 28, opacity: 0.3, marginBottom: 7 }}>♡</div>No saved designs yet.<br />Tap ♡ on any card to save.</div>
              : favorites.map(f => (
                <div key={f.id} className="fav-item">
                  <div className="fav-thumb">{f.img && <img src={thumbUrl(f.img)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fav-ln">{f.lastname || f.name || f.id}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-light)' }}>{(f.name || '').substring(0, 44)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 1 }}>{f.carve_type} {f.carve_type && f.granite_color ? '·' : ''} {f.granite_color}</div>
                  </div>
                  <button onClick={(e) => toggleFav(e, f)} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: 18, padding: '2px 4px' }}>×</button>
                </div>
              ))
            }
          </div>
          <div className="fav-footer">
            <button className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={() => { setFavOpen(false); setPage('contract') }}>📄 Create Contract</button>
            <button className="btn btn-sm" style={{ width: '100%', background: 'var(--cream)', border: '1px solid var(--border)', color: 'var(--text-mid)' }} onClick={() => setFavorites([])}>Clear All</button>
          </div>
        </div>
      )}

      {/* FAV TOGGLE BUTTON */}
      <button className="fav-toggle" onClick={() => setFavOpen(o => !o)} title="Saved Designs">
        ♥
        {favorites.length > 0 && <div className="fav-badge">{favorites.length}</div>}
      </button>

      {/* TOAST */}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
