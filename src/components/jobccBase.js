// =============================================================================
// jobccBase.js — shared .jobcc-* command-center base CSS
// =============================================================================
// The dark command-center shell (container, header, KPI cards, panels, buttons).
// JobsCommandCenter (the Dashboard tab) carries its own full copy inline; this is
// the SAME base for the surfaces that render on their own tab (ProductionBoard,
// InstallBoard) where the Dashboard's <style> isn't mounted. CSS is global, so a
// surface includes this once: <style>{JOBCC_BASE_CSS}{LOCAL_CSS}</style>.
// =============================================================================
export const JOBCC_BASE_CSS = `
  .jobcc { background: #0E1116; border-radius: 16px; padding: 22px 24px 26px; color: #e6e9ef;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .jobcc * { box-sizing: border-box; }
  .jobcc-cmd { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
  .jobcc-title { font-size: 22px; font-weight: 700; color: #f4f6fa; margin: 0; letter-spacing: -0.01em; }
  .jobcc-purpose { font-size: 13px; color: #8b95a5; margin-top: 4px; max-width: 620px; }
  .jobcc-cmd-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .jobcc-actions { display: flex; gap: 8px; }
  .jobcc-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .jobcc-btn:hover:not(:disabled) { background: #232c38; border-color: #3a4452; }
  .jobcc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .jobcc-err { background: #1c1416; border: 1px solid #5c2a2a; color: #f87171; padding: 10px 12px; border-radius: 9px; margin-bottom: 14px; }

  .jobcc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .jobcc-kpi { text-align: left; font: inherit; cursor: pointer; background: #11151c; border: 1px solid #20262f; border-left-width: 3px; border-radius: 11px; padding: 13px 15px; transition: background .12s, border-color .12s; }
  .jobcc-kpi:hover { background: #151b24; }
  .jobcc-kpi-on { background: #1a2230; border-color: #3a4452; box-shadow: inset 0 0 0 1px #3a4452; }
  .jobcc-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b95a5; }
  .jobcc-kpi-value { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 30px; font-weight: 700; line-height: 1.1; margin: 4px 0 3px; color: #f4f6fa; }
  .jobcc-kpi-sub { font-size: 11.5px; color: #6f7a8a; }
  .jobcc-kpi-green  { border-left-color: #34d399; }
  .jobcc-kpi-amber  { border-left-color: #fbbf24; }
  .jobcc-kpi-red    { border-left-color: #f87171; }
  .jobcc-kpi-purple { border-left-color: #a78bfa; }

  .jobcc-panel { background: #11151c; border: 1px solid #20262f; border-radius: 12px; padding: 15px 17px; margin-bottom: 16px; }
  .jobcc-panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .jobcc-panel-title { font-size: 13px; font-weight: 700; color: #f4f6fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .jobcc-panel-count { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #1a212b; color: #c7cedb; }
  .jobcc-empty { color: #6f7a8a; font-size: 13px; padding: 10px 2px; }
  .jobcc-empty-ok { color: #34d399; }
`
