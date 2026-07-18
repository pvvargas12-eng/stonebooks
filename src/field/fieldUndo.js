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
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap');
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
  .fl-c-bad { background: rgba(179,38,30,0.10); color: #B3261E; }
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
  .fl-btn.fl-btn-gold { background: #9A7209; color: #fff; border: none; }
  .fl-btn-green { background: #1D9E75; }
  .fl-btn.fl-btn-ghost { background: #fff; color: #55503F; border: 1px solid #DAD3C2; }

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
    z-index: 70; width: min(92vw, 480px); background: #0F1419; color: #E8E2D4;
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

  /* ── FIELD-2 shell additions (role-aware redesign, 2026-07-18) ── */
  .fl-serif { font-family: Fraunces, Georgia, "Times New Roman", serif; }
  .fl-greet { font-family: Fraunces, Georgia, serif; font-size: 29px; font-weight: 600; color: #16150F; letter-spacing: 0.1px; }
  .fl-greet-sub { font-size: 13.5px; color: #6B6456; margin-top: 3px; }
  .fl-sect { display: flex; align-items: baseline; gap: 8px; margin: 20px 2px 9px; }
  .fl-sect-h { font-family: Fraunces, Georgia, serif; font-size: 20px; font-weight: 600; color: #16150F; }
  .fl-sect-pill { font-family: "JetBrains Mono", Consolas, monospace; font-size: 11.5px; background: #EEEAE0; color: #6B6456; border-radius: 999px; padding: 2px 8px; }
  .fl-sect-spacer { flex: 1; }
  .fl-sect-see { background: none; border: none; font-family: inherit; font-size: 13.5px; font-weight: 700; color: #9A7209; cursor: pointer; padding: 4px 2px; }
  .fl-empty-serif { font-family: Fraunces, Georgia, serif; font-size: 18px; font-style: italic; color: #6B6256; text-align: center; padding: 34px 10px; }

  .fl-who-chip { display: flex; align-items: center; gap: 7px; background: none; border: 1px solid #3A3527; color: #E8E2D4; font: inherit; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 4px 12px 4px 4px; cursor: pointer; }
  .fl-who-chip-avatar { width: 24px; height: 24px; border-radius: 50%; background: #9A7209; color: #0F1419; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
  .fl-menu { position: absolute; right: 14px; top: calc(100% - 4px); background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; box-shadow: 0 12px 32px rgba(15,20,25,0.22); padding: 6px; z-index: 40; min-width: 190px; }
  .fl-menu-role { font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #8A7F6C; padding: 8px 12px 6px; }
  .fl-menu button { display: block; width: 100%; text-align: left; background: none; border: none; font-family: inherit; font-size: 14.5px; font-weight: 600; color: #16150F; padding: 12px; border-radius: 9px; cursor: pointer; min-height: 44px; }
  .fl-menu button:active { background: #F5F3EE; }
  .fl-menu-note { font-size: 12px; color: #6B6456; padding: 10px 12px; max-width: 230px; line-height: 1.45; }

  /* Push enable card (Today) */
  .fl-push-card { background: #0F1419; border-radius: 14px; padding: 14px; margin-top: 14px; }
  .fl-push-title { font-family: Fraunces, Georgia, serif; font-size: 17px; font-weight: 600; color: #F2EDE2; }
  .fl-push-body { font-size: 12.5px; color: #B9B29E; line-height: 1.5; margin-top: 4px; }
  .fl-push-err { font-size: 12px; color: #E58B84; margin-top: 8px; }
  .fl-push-row { display: flex; gap: 8px; margin-top: 12px; }
  .fl-push-row .fl-btn { margin-bottom: 0; flex: 1; padding: 12px; }
  .fl-push-row .fl-btn.fl-btn-ghost { background: transparent; color: #B9B29E; border-color: rgba(226,220,206,0.25); }

  .fl-who-list { display: flex; flex-direction: column; gap: 8px; }
  .fl-who-row { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; padding: 11px 14px; font-family: inherit; cursor: pointer; min-height: 60px; text-align: left; }
  .fl-who-avatar { width: 38px; height: 38px; border-radius: 50%; background: #0F1419; color: #E8E2D4; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; flex-shrink: 0; }
  .fl-who-main { flex: 1; display: flex; flex-direction: column; }
  .fl-who-name { font-size: 16px; font-weight: 700; color: #16150F; }
  .fl-who-dept { font-size: 12px; color: #8A7F6C; margin-top: 1px; }
  .fl-who-note { font-size: 12px; color: #8A7F6C; text-align: center; margin-top: 16px; line-height: 1.5; }

  .fl-cta-slot { flex: 0 0 72px; position: relative; }
  .fl-cta { position: absolute; left: 50%; top: -24px; transform: translateX(-50%); width: 58px; height: 58px; border-radius: 50%; background: #9A7209; border: 4px solid #0F1419; color: #0F1419; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 10px rgba(15,20,25,0.35); }
  .fl-cta:active { transform: translateX(-50%) scale(0.94); }
  .fl-nav-glyph { position: relative; }
  .fl-badge { position: absolute; top: -5px; right: -10px; min-width: 16px; height: 16px; border-radius: 8px; background: #B3261E; color: #fff; font-size: 9.5px; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 4px; font-family: "JetBrains Mono", Consolas, monospace; }

  .fl-seg { display: flex; background: #EAE5D9; border-radius: 11px; padding: 2px; margin-bottom: 12px; }
  .fl-seg button { flex: 1; border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 700; color: #6B6456; padding: 10px 0; border-radius: 9px; cursor: pointer; }
  .fl-seg button.on { background: #fff; color: #16150F; box-shadow: 0 1px 3px rgba(15,20,25,0.12); }

  .fl-check { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #DAD3C2; background: none; flex-shrink: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; padding: 0; }
  .fl-check.done { background: #14775A; border-color: #14775A; }
  .fl-task-done { text-decoration: line-through; color: #8A7F6C !important; }
  .fl-rowline { display: flex; align-items: center; gap: 11px; min-height: 54px; padding: 9px 2px; border-bottom: 1px solid #EEE9DD; cursor: pointer; width: 100%; background: none; border-left: none; border-right: none; border-top: none; font-family: inherit; text-align: left; }
  .fl-rowline:last-child { border-bottom: none; }

  .fl-needs { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #E2DCCE; border-left: 3px solid #B3261E; border-radius: 14px; padding: 12px 14px; margin-bottom: 9px; }
  .fl-needs.warn { border-left-color: #8A5A12; }
  .fl-needs-text { flex: 1; font-size: 14.5px; font-weight: 600; color: #16150F; line-height: 1.4; }
  .fl-verb { border: 1px solid #DAD3C2; background: #FBFAF6; color: #16150F; font-family: inherit; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 9px; padding: 0 13px; height: 44px; cursor: pointer; flex-shrink: 0; }

  .fl-dots { display: flex; gap: 6px; align-items: center; }
  .fl-dots i { width: 11px; height: 11px; border-radius: 50%; border: 2px solid #DAD3C2; }
  .fl-dots i.done { background: #14775A; border-color: #14775A; }
  .fl-dots i.cur { background: #9A7209; border-color: #9A7209; animation: fl-pulse 1.2s ease-in-out infinite; }
  @keyframes fl-pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .fl-dots i.cur { animation: none; } }
  .fl-runprog { display: flex; gap: 3px; height: 6px; margin: 10px 0; }
  .fl-runprog i { flex: 1; border-radius: 3px; background: #E2DCCE; }
  .fl-runprog i.done { background: #14775A; }
  .fl-runprog i.cur { background: #9A7209; }

  .fl-btn-dark { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; background: #0F1419; color: #E8E2D4; border: none; border-radius: 12px; font-family: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; width: 100%; }
  .fl-btn-ghost { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; background: #FBFAF6; color: #16150F; border: 1px solid #DAD3C2; border-radius: 12px; font-family: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; width: 100%; }
  .fl-btn-gold { display: flex; align-items: center; justify-content: center; min-height: 52px; background: #9A7209; color: #fff; border: none; border-radius: 12px; font-family: inherit; font-size: 14.5px; font-weight: 800; cursor: pointer; width: 100%; }
  .fl-btn-dashed { border-style: dashed; color: #6B6456; }

  .fl-sheet-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.4); z-index: 60; }
  .fl-sheet { position: fixed; left: 0; right: 0; bottom: 0; max-width: 640px; margin: 0 auto; background: #fff; border-radius: 20px 20px 0 0; z-index: 61; padding: 8px 18px calc(24px + env(safe-area-inset-bottom)); max-height: 86dvh; overflow-y: auto; }
  .fl-sheet-grab { width: 36px; height: 5px; border-radius: 3px; background: #DAD3C2; margin: 4px auto 14px; }
  .fl-sheet-title { font-family: Fraunces, Georgia, serif; font-size: 22px; font-weight: 600; color: #16150F; margin-bottom: 12px; }
  .fl-input { font-family: inherit; font-size: 16px; padding: 13px 14px; border: 1px solid #DAD3C2; border-radius: 12px; background: #fff; width: 100%; box-sizing: border-box; }
  .fl-label { font-size: 12.5px; font-weight: 700; color: #6B6456; margin: 14px 0 7px; }
  .fl-chip-btn { border: 1px solid #DAD3C2; background: #fff; color: #6B6456; font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 999px; padding: 10px 15px; cursor: pointer; min-height: 42px; }
  .fl-chip-btn.on { background: #0F1419; color: #E8E2D4; border-color: #0F1419; }

  .fl-tilegrid { display: grid; grid-template-columns: 1fr; gap: 9px; }
  .fl-tile { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; padding: 13px 15px; min-height: 72px; cursor: pointer; font-family: inherit; text-align: left; width: 100%; }
  .fl-tile-main { flex: 1; min-width: 0; }
  .fl-tile-name { font-size: 16px; font-weight: 800; color: #16150F; }
  .fl-tile-sub { font-size: 12.5px; color: #6B6456; margin-top: 2px; }
  .fl-tile-count { font-family: Fraunces, Georgia, serif; font-size: 23px; font-weight: 700; color: #16150F; }

  .fl-thread { background: #fff; border: 1px solid #E2DCCE; border-radius: 14px; padding: 4px 14px; margin-bottom: 10px; }
  .fl-reply-meta { font-size: 11.5px; color: #8A7F6C; }
  .fl-reply-body { font-size: 14px; color: #16150F; margin-top: 2px; line-height: 1.45; }
  .fl-attach-grid { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .fl-attach-grid img { width: 74px; height: 74px; object-fit: cover; border-radius: 10px; border: 1px solid #E2DCCE; }
`
