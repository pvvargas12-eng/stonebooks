// =============================================================================
// fieldUndo.js — the undo-toast hook + the Field Mode stylesheet
// =============================================================================
// Plain module (no components) so FieldApp.jsx stays fast-refresh clean.
// Every mutating action in Field Mode hands the toast an { label, undo } pair;
// 8 seconds with a visible countdown, one toast at a time.
// =============================================================================
import { useState, useEffect, useRef, useCallback } from 'react'

export function useUndoToast() {
  const [toast, setToast] = useState(null)   // { label, undo, error }
  const timer = useRef(null)
  const show = useCallback((label, undo) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ label, undo })
    timer.current = setTimeout(() => setToast(null), 8000)
  }, [])
  const showError = useCallback((label) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ label, error: true })
    timer.current = setTimeout(() => setToast(null), 8000)
  }, [])
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setToast(null)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { toast, show, showError, clear }
}
// ── Field design system — the mockup's language, product-grade ──────────────
export const FIELD_CSS = `
  .fl-shell {
    min-height: 100dvh; background: #F5F3EE; display: flex; flex-direction: column;
    font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; color: #16150F;
    max-width: 640px; margin: 0 auto;
  }
  .fl-loading { padding: 80px 20px; text-align: center; color: #8A8267; font-size: 14px; }

  /* Header */
  .fl-head {
    background: #0F1419; color: #E8E2D4; padding: calc(14px + env(safe-area-inset-top)) 18px 12px;
    position: sticky; top: 0; z-index: 30;
  }
  .fl-head-row { display: flex; align-items: center; justify-content: space-between; }
  .fl-brand { font-size: 13px; font-weight: 800; letter-spacing: 0.16em; }
  .fl-brand em { color: #9A7209; font-style: normal; }
  .fl-signout {
    background: none; border: 1px solid #3A3527; color: #B9AE94; font: inherit;
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; border-radius: 999px;
    padding: 4px 10px; cursor: pointer;
  }
  .fl-sub { font-size: 11px; color: #8F8770; margin-top: 3px; }

  /* Body + nav */
  .fl-body { flex: 1; padding: 14px 14px calc(92px + env(safe-area-inset-bottom)); }
  .fl-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;
    max-width: 640px; margin: 0 auto;
    background: #0F1419; display: flex; padding: 8px 10px calc(10px + env(safe-area-inset-bottom)); gap: 4px;
  }
  .fl-nav button {
    flex: 1; background: none; border: none; cursor: pointer; padding: 8px 2px 6px;
    border-radius: 12px; font-family: inherit;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; color: #7E765F;
  }
  .fl-nav button .fl-nav-glyph { display: block; margin: 0 auto 3px; line-height: 0; }
  .fl-nav button.on { color: #9A7209; background: rgba(154,114,9,0.12); }

  /* Login */
  .fl-login { padding: 90px 26px 40px; }
  .fl-login-brand { font-size: 19px; font-weight: 800; letter-spacing: 0.16em; color: #16150F; }
  .fl-login-brand em { color: #9A7209; font-style: normal; }
  .fl-login-sub { font-size: 12.5px; color: #8A8267; margin: 4px 0 28px; }
  .fl-login-form { display: flex; flex-direction: column; gap: 10px; }
  .fl-login-form input {
    font: inherit; font-size: 16px; padding: 13px 14px; border: 1px solid #DAD3C2;
    border-radius: 12px; background: #fff;
  }
  .fl-login-form button {
    font: inherit; font-size: 15px; font-weight: 800; padding: 14px; margin-top: 6px;
    background: #0F1419; color: #fff; border: none; border-radius: 12px; cursor: pointer;
  }
  .fl-login-form button:disabled { opacity: 0.5; }
  .fl-login-err { font-size: 12.5px; color: #B3261E; }

  /* Shared list primitives */
  .fl-daylabel {
    font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    color: #8A8267; margin: 14px 4px 8px;
  }
  .fl-daylabel:first-child { margin-top: 2px; }
  .fl-daylabel b { color: #16150F; }
  .fl-row {
    width: 100%; text-align: left; font-family: inherit; cursor: pointer; display: block;
    background: #fff; border: 1px solid #E2DCCE; border-radius: 14px;
    padding: 12px 14px; margin-bottom: 9px;
  }
  .fl-row-flex { display: flex; align-items: center; gap: 11px; }
  .fl-row-main { flex: 1; min-width: 0; }
  .fl-fam { font-size: 16.5px; font-weight: 800; color: #16150F; }
  .fl-spec {
    font-size: 11px; color: #7C7562; margin-top: 3px;
    font-family: "JetBrains Mono", Consolas, monospace;
  }
  .fl-cem { font-size: 12.5px; color: #55503F; margin-top: 3px; font-weight: 600; }
  .fl-chev { color: #B9B29E; font-size: 18px; flex-shrink: 0; }
  .fl-rowtop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .fl-chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
  .fl-chip { font-size: 9.5px; font-weight: 800; letter-spacing: 0.07em; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .fl-c-good { background: rgba(29,158,117,0.13); color: #14775A; }
  .fl-c-warn { background: rgba(184,132,42,0.16); color: #8A5A12; }
  .fl-c-info { background: rgba(29,111,168,0.12); color: #185F8F; }
  .fl-c-neutral { background: #EEEAE0; color: #6B6456; }
  .fl-c-lead { background: #B3261E; color: #fff; }
  .fl-kind { font-size: 9.5px; font-weight: 800; letter-spacing: 0.09em; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
  .fl-k-set { background: rgba(29,158,117,0.12); color: #14775A; }
  .fl-k-del { background: rgba(29,111,168,0.11); color: #185F8F; }
  .fl-k-fdn { background: rgba(184,132,42,0.14); color: #8A5A12; }
  .fl-dirlink { margin-left: auto; font-size: 11px; font-weight: 700; color: #7A5B07; text-decoration: none; }
  .fl-empty { text-align: center; color: #8A8267; font-size: 13px; padding: 40px 16px; }

  /* Filter chips */
  .fl-filters { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; margin: 0 -2px 4px; -webkit-overflow-scrolling: touch; }
  .fl-fchip {
    flex-shrink: 0; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
    border: 1px solid #DAD3C2; background: #fff; color: #6B6456; border-radius: 999px; padding: 7px 13px;
  }
  .fl-fchip.on { background: #0F1419; color: #E8E2D4; border-color: #0F1419; }

  /* Search */
  .fl-search {
    width: 100%; font: inherit; font-size: 16px; background: #fff; border: 1px solid #DAD3C2;
    border-radius: 12px; padding: 11px 14px; margin-bottom: 12px; color: #16150F;
  }
  .fl-search::placeholder { color: #8A8267; }

  /* Detail */
  .fl-back {
    display: flex; align-items: center; gap: 8px; background: none; border: none; cursor: pointer;
    font-family: inherit; font-size: 12.5px; font-weight: 700; color: #6B6456; padding: 2px 2px 10px;
  }
  .fl-detfam { font-size: 22px; font-weight: 800; color: #16150F; }
  .fl-detsub { font-size: 12px; color: #6B6456; margin: 2px 0 12px; }
  .fl-detsub .mono { font-family: "JetBrains Mono", Consolas, monospace; }
  .fl-card { background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; padding: 13px 14px; margin-bottom: 10px; }
  .fl-eyebrow {
    font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    color: #9A8A5E; margin-bottom: 8px;
  }
  .fl-specgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 14px; }
  .fl-speclab { font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; color: #A39A82; text-transform: uppercase; }
  .fl-specval { font-size: 13px; font-weight: 700; color: #16150F; font-family: "JetBrains Mono", Consolas, monospace; margin-top: 1px; }
  .fl-specval.sans { font-family: inherit; }
  .fl-statusrow { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #F0ECE2; }
  .fl-statusrow:last-child { border-bottom: none; padding-bottom: 0; }
  .fl-statusrow .lab { font-size: 12px; font-weight: 700; color: #55503F; }

  .fl-lead-banner {
    background: #FDECEA; border: 1.5px solid #B3261E; border-left-width: 5px;
    border-radius: 10px; padding: 9px 12px; margin-bottom: 11px;
  }
  .fl-lead-banner b { display: block; font-size: 12px; letter-spacing: 0.05em; color: #B3261E; font-weight: 800; }
  .fl-lead-banner span { font-size: 11px; color: #7A2A25; }

  /* Ladder */
  .fl-ladder { display: flex; flex-direction: column; gap: 7px; }
  .fl-ladder button {
    font-family: inherit; text-align: left; cursor: pointer;
    border: 1px solid #DAD3C2; background: #FBFAF6; border-radius: 10px;
    padding: 12px; font-size: 12.5px; font-weight: 700; color: #6B6456;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .fl-ladder button:disabled { cursor: default; }
  .fl-ladder button.done { background: rgba(29,158,117,0.08); border-color: rgba(29,158,117,0.35); color: #14775A; }
  .fl-ladder button.next { background: #0F1419; border-color: #0F1419; color: #fff; }
  .fl-ladder .tick { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; flex-shrink: 0; }
  .fl-ladder button.next .tick { color: #9A7209; }

  /* Big action buttons */
  .fl-btn {
    display: block; width: 100%; text-align: center; cursor: pointer; font-family: inherit;
    background: #0F1419; color: #fff; border: none; border-radius: 12px;
    padding: 14px; font-size: 14px; font-weight: 800; letter-spacing: 0.02em; margin-bottom: 10px;
  }
  .fl-btn:disabled { opacity: 0.4; cursor: default; }
  .fl-btn-gold { background: #9A7209; }
  .fl-btn-green { background: #1D9E75; }
  .fl-btn-ghost { background: #fff; color: #55503F; border: 1px solid #DAD3C2; }

  /* Layout image */
  .fl-layout-wrap { border-radius: 9px; overflow: hidden; cursor: zoom-in; background: #EEEAE0; }
  .fl-layout-wrap img { width: 100%; display: block; }
  .fl-layout-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .fl-layout-meta span { font-size: 11px; color: #6B6456; font-weight: 600; }
  .fl-layout-meta .zoom { font-weight: 700; color: #7A5B07; }
  .fl-zoom-overlay {
    position: fixed; inset: 0; z-index: 60; background: rgba(10,10,8,0.94);
    display: flex; align-items: center; justify-content: center; padding: 14px;
  }
  .fl-zoom-overlay img { max-width: 100%; max-height: 92dvh; object-fit: contain; }
  .fl-zoom-close {
    position: absolute; top: calc(12px + env(safe-area-inset-top)); right: 14px;
    background: rgba(255,255,255,0.12); color: #fff; border: none; border-radius: 999px;
    width: 38px; height: 38px; font-size: 20px; cursor: pointer;
  }

  /* Photos */
  .fl-photo-strip { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
  .fl-photo-thumb { width: 74px; height: 74px; border-radius: 9px; object-fit: cover; border: 1px solid #D6D0C2; }
  .fl-photo-empty {
    border: 1.5px dashed #C9C1AD; border-radius: 10px; padding: 18px 12px; text-align: center;
    font-size: 12px; color: #8A8267; margin-bottom: 10px;
  }

  /* Forms */
  .fl-input, .fl-textarea, .fl-select {
    width: 100%; font: inherit; font-size: 16px; background: #fff; border: 1px solid #DAD3C2;
    border-radius: 10px; padding: 11px 12px; color: #16150F; margin-bottom: 8px;
  }
  .fl-textarea { min-height: 68px; resize: vertical; }
  .fl-lab { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #A39A82; margin: 4px 0 4px; }
  .fl-qtyrow { display: flex; align-items: center; gap: 10px; }
  .fl-qtybtn {
    width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; border: 1px solid #DAD3C2;
    background: #fff; font-size: 22px; font-weight: 700; color: #16150F; cursor: pointer;
  }
  .fl-qtyval { flex: 1; text-align: center; font-size: 22px; font-weight: 800; font-family: "JetBrains Mono", Consolas, monospace; }

  /* Inventory */
  .fl-inv-qty { font-size: 17px; font-weight: 800; font-family: "JetBrains Mono", Consolas, monospace; color: #16150F; text-align: right; }
  .fl-inv-qty small { display: block; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: #A39A82; }
  .fl-inv-low { color: #B3261E; }
  .fl-eventrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #F0ECE2; }
  .fl-eventrow:last-child { border-bottom: none; }
  .fl-event-main { flex: 1; min-width: 0; font-size: 12px; color: #55503F; }
  .fl-event-main b { color: #16150F; }
  .fl-event-when { font-size: 10.5px; color: #A39A82; }
  .fl-event-undo {
    background: none; border: 1px solid #DAD3C2; border-radius: 999px; cursor: pointer;
    font-family: inherit; font-size: 10px; font-weight: 800; color: #7A5B07; padding: 4px 10px;
  }
  .fl-event-undone { text-decoration: line-through; opacity: 0.55; }

  /* Toast */
  .fl-toast {
    position: fixed; bottom: calc(96px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
    z-index: 50; width: min(92vw, 480px); background: #0F1419; color: #E8E2D4;
    border-radius: 14px; padding: 13px 14px; display: flex; align-items: center; gap: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35); overflow: hidden;
  }
  .fl-toast-err { background: #B3261E; color: #fff; }
  .fl-toast-label { flex: 1; font-size: 13px; font-weight: 600; }
  .fl-toast-undo {
    background: #9A7209; color: #fff; border: none; border-radius: 9px; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 800; letter-spacing: 0.05em; padding: 8px 14px;
  }
  .fl-toast-x { background: none; border: none; color: inherit; font-size: 18px; cursor: pointer; padding: 0 2px; opacity: 0.7; }
  .fl-toast-bar {
    position: absolute; left: 0; bottom: 0; height: 3px; background: #9A7209;
    animation: fl-countdown 8s linear forwards;
  }
  @keyframes fl-countdown { from { width: 100%; } to { width: 0%; } }
  @media (prefers-reduced-motion: reduce) { .fl-toast-bar { animation: none; width: 100%; } }
`
