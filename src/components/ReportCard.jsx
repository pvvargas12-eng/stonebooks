// =============================================================================
// 📚 Stonebooks — ReportCard chassis
// =============================================================================
// Every report plugs into this: title + "why this matters", a red/yellow/green
// health dot, a menu (pin to Daily, move up/down, export CSV, hide), and the
// report body. A "not yet tracked" note replaces the body when a report can't
// be honestly computed from available data.
// =============================================================================

import { useState } from 'react'

const HEALTH = { red: '#b54040', yellow: '#b8842a', green: '#2d7a4f', neutral: '#b8b8b3' }

export default function ReportCard({
  def, result, pinned, hidden, deltaText,
  onTogglePin, onToggleHide, onMoveUp, onMoveDown, onExport,
  children,
}) {
  const [menu, setMenu] = useState(false)
  const health = result?.health || 'neutral'

  return (
    <div className={`rc ${hidden ? 'rc-hidden' : ''}`}>
      <div className="rc-head">
        <div className="rc-head-main">
          <span className="rc-dot" style={{ background: HEALTH[health] }} title={`Health: ${health}`} />
          <div>
            <div className="rc-title">{def.title}</div>
            <div className="rc-why">{def.why}</div>
          </div>
        </div>
        <div className="rc-head-actions">
          {deltaText && <span className="rc-delta" title="vs previous period">{deltaText}</span>}
          <div className="rc-menu-wrap">
            <button type="button" className="rc-menu-btn" onClick={() => setMenu(o => !o)} aria-label="Card options">⋯</button>
            {menu && (
              <>
                <div className="rc-menu-scrim" onClick={() => setMenu(false)} />
                <div className="rc-menu" role="menu">
                  <button type="button" onClick={() => { onTogglePin?.(); setMenu(false) }}>{pinned ? 'Unpin from Daily' : 'Pin to Daily'}</button>
                  <button type="button" onClick={() => { onMoveUp?.(); setMenu(false) }}>Move up</button>
                  <button type="button" onClick={() => { onMoveDown?.(); setMenu(false) }}>Move down</button>
                  <button type="button" onClick={() => { onExport?.(); setMenu(false) }} disabled={!result?.csv}>Export CSV</button>
                  <button type="button" className="rc-menu-danger" onClick={() => { onToggleHide?.(); setMenu(false) }}>{hidden ? 'Show' : 'Hide'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="rc-body">
        {result?.note ? <div className="rc-note">⚠ {result.note}</div> : children}
      </div>
    </div>
  )
}

export const REPORT_CSS = `
  .rc { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
  .rc-hidden { opacity: 0.55; }
  .rc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .rc-head-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
  .rc-dot { width: 11px; height: 11px; border-radius: 50%; margin-top: 4px; flex: 0 0 auto; }
  .rc-title { font-size: 15px; font-weight: 600; color: #1e2d3d; letter-spacing: -0.005em; }
  .rc-why { font-size: 12px; color: #8a8a85; margin-top: 2px; line-height: 1.4; }
  .rc-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .rc-delta { font-size: 12px; font-weight: 600; color: #6b6b66; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rc-menu-wrap { position: relative; }
  .rc-menu-btn { font: inherit; font-size: 18px; line-height: 1; color: #8a8a85; background: none; border: 0.5px solid transparent; border-radius: 6px; width: 28px; height: 26px; cursor: pointer; }
  .rc-menu-btn:hover { background: #f4f2ee; color: #1e2d3d; }
  .rc-menu-scrim { position: fixed; inset: 0; z-index: 30; }
  .rc-menu { position: absolute; top: 30px; right: 0; z-index: 31; background: #fff; border: 0.5px solid #e6e3dd; border-radius: 8px; box-shadow: 0 8px 28px rgba(15,20,25,0.16); min-width: 170px; padding: 4px; display: flex; flex-direction: column; }
  .rc-menu button { font: inherit; font-size: 13px; text-align: left; padding: 8px 12px; background: none; border: none; border-radius: 6px; cursor: pointer; color: #1e2d3d; }
  .rc-menu button:hover { background: #f4f2ee; }
  .rc-menu button:disabled { opacity: 0.4; cursor: not-allowed; }
  .rc-menu-danger { color: #b54040 !important; }
  .rc-body { min-height: 40px; }
  .rc-note { font-size: 13px; color: #6b5d2f; background: #fbf3dd; border: 0.5px solid #e8d9a8; border-radius: 8px; padding: 10px 12px; line-height: 1.45; }

  /* Shared report bodies */
  .rb-buckets { display: flex; flex-direction: column; gap: 8px; }
  .rb-bucket { display: grid; grid-template-columns: 96px 1fr 92px; gap: 10px; align-items: center; font: inherit; background: none; border: none; text-align: left; cursor: pointer; padding: 2px 0; }
  .rb-bucket:disabled { cursor: default; }
  .rb-bucket-label { font-size: 12px; color: #6b6b66; }
  .rb-bucket-track { height: 22px; background: #f1efeb; border-radius: 5px; overflow: hidden; }
  .rb-bucket-fill { height: 100%; border-radius: 5px; min-width: 2px; transition: width 0.2s; }
  .rb-bucket:hover .rb-bucket-fill { filter: brightness(0.94); }
  .rb-bucket-val { font-size: 13px; font-weight: 600; color: #1e2d3d; text-align: right; font-variant-numeric: tabular-nums; }
  .rb-bucket-count { font-size: 11px; color: #a0a09a; }
  .rb-total { display: flex; justify-content: space-between; font-size: 13px; color: #6b6b66; border-top: 0.5px solid #f1efeb; padding-top: 8px; margin-top: 4px; }
  .rb-total strong { color: #1e2d3d; }

  /* Stacked segment bar */
  .rb-stack { display: flex; height: 28px; border-radius: 6px; overflow: hidden; background: #f1efeb; }
  .rb-stack-seg { height: 100%; cursor: pointer; border: none; padding: 0; }
  .rb-stack-seg:hover { filter: brightness(0.92); }
  .rb-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; }
  .rb-legend-item { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #4a4a45; background: none; border: none; cursor: pointer; padding: 0; }
  .rb-legend-item:hover { color: #1e2d3d; }
  .rb-legend-dot { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
  .rb-legend-val { font-weight: 600; color: #1e2d3d; font-variant-numeric: tabular-nums; }
  .rb-empty { font-size: 13px; color: #a0a09a; padding: 8px 0; }

  /* Drill modal */
  .rb-drill-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .rb-drill { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,20,25,0.24); max-width: 640px; width: 100%; max-height: 86vh; display: flex; flex-direction: column; }
  .rb-drill-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 0.5px solid #e6e3dd; }
  .rb-drill-title { font-size: 16px; font-weight: 600; color: #1e2d3d; }
  .rb-drill-close { font: inherit; font-size: 14px; color: #6b6b66; background: none; border: none; cursor: pointer; }
  .rb-drill-list { overflow-y: auto; }
  .rb-drill-row { display: grid; grid-template-columns: 1.4fr 110px 120px 1fr; gap: 12px; align-items: center; width: 100%; text-align: left; font: inherit; padding: 11px 22px; background: none; border: none; border-bottom: 0.5px solid #f1efeb; cursor: pointer; }
  .rb-drill-row:hover { background: #faf8f3; }
  .rb-drill-name { font-weight: 600; color: #1e2d3d; }
  .rb-drill-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b66; }
  .rb-drill-amt { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: #1e2d3d; }
  .rb-drill-sub { font-size: 12px; color: #8a8a85; }
  .rb-drill-empty { padding: 28px 22px; text-align: center; color: #a0a09a; }
`
