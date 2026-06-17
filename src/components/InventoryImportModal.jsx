// =============================================================================
// InventoryImportModal — preview-FIRST Excel importer for the Yard (Phase 2).
// =============================================================================
// Flow: upload .xlsx → parse (all 6 sheets) → PREVIEW (grouped by sheet + location,
// counts + flags) → operator clicks Import → bulk insert → results. NOTHING writes
// to inventory_stock until the explicit Import click. Re-runnable (upload again).
// =============================================================================

import { useState, useMemo } from 'react'
import { parseInventoryWorkbook, FLAG_LABELS } from '../lib/inventoryImport'
import { bulkInsertInventory } from '../lib/stonebooksData'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

export default function InventoryImportModal({ onClose, onImported }) {
  const [stage, setStage] = useState('upload') // upload | parsing | preview | importing | done | error
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)
  const [fileName, setFileName] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [skipFlagged, setSkipFlagged] = useState(false)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setStage('parsing'); setErr(null)
    try {
      const buf = await file.arrayBuffer()
      const r = await parseInventoryWorkbook(buf)
      setParsed(r)
      setStage('preview')
    } catch (ex) {
      setErr(String(ex?.message || ex)); setStage('error')
    }
  }

  const toImport = useMemo(() => {
    if (!parsed) return []
    return skipFlagged ? parsed.allItems.filter(i => !i._flags?.length) : parsed.allItems
  }, [parsed, skipFlagged])

  const doImport = async () => {
    if (!toImport.length) return
    setStage('importing'); setErr(null)
    const r = await bulkInsertInventory(toImport)
    if (!r.ok) { setErr(`${r.error} (${r.inserted} inserted before the error)`); setStage('error'); return }
    setResult({ inserted: r.inserted, skipped: skipFlagged ? (parsed.summary.flaggedCount) : 0, sheetsSkipped: parsed.summary.skippedSheets })
    setStage('done')
    onImported?.()
  }

  const s = parsed?.summary

  return (
    <div className="inv-modal-overlay" onClick={onClose}>
      <style>{IMP_CSS}</style>
      <div className="inv-modal" onClick={e => e.stopPropagation()}>
        <div className="inv-modal-head">
          <div>
            <div className="inv-modal-eyebrow">Inventory · Import</div>
            <h2 className="inv-modal-title">Import from Excel</h2>
          </div>
          <button type="button" className="inv-modal-x" onClick={onClose}>×</button>
        </div>

        <div className="inv-modal-body">
          {stage === 'upload' && (
            <div className="inv-up">
              <p className="inv-up-lede">
                Upload Leo’s Inventory workbook (.xlsx). Every sheet is parsed and you’ll see a
                full <strong>preview before anything is saved</strong> — nothing writes until you click Import.
              </p>
              <label className="inv-up-drop">
                <input type="file" accept=".xlsx,.xls" onChange={onFile} />
                <span className="inv-up-drop-main">Choose spreadsheet…</span>
                <span className="inv-up-drop-sub">.xlsx — 6 sheets (Base Stones, Stones slant, Bronze Stone, Courtyard, Customer, Base Customer)</span>
              </label>
            </div>
          )}

          {stage === 'parsing' && <div className="inv-center">Reading <strong>{fileName}</strong> …</div>}

          {stage === 'error' && (
            <div className="inv-center">
              <div className="inv-err-big">Couldn’t {result ? 'import' : 'read'} the file.</div>
              <div className="inv-err-detail">{err}</div>
              <button type="button" className="sb-btn-secondary" onClick={() => setStage('upload')}>Try another file</button>
            </div>
          )}

          {stage === 'preview' && parsed && (
            <>
              <div className="inv-summary">
                <Stat n={s.totalStones} label="stones" />
                <Stat n={s.locationCount} label="locations" />
                <Stat n={s.rowCount} label="rows" />
                <Stat n={s.flaggedCount} label="flagged" tone={s.flaggedCount ? 'warn' : 'ok'} />
                <Stat n={s.skippedSheets} label="sheets skipped" tone={s.skippedSheets ? 'warn' : 'ok'} />
                <div className="inv-summary-file">from {fileName}</div>
              </div>

              {/* PROMINENT per-sheet breakdown — exactly which sheets parse vs drop. */}
              <div className="inv-breakdown">
                <div className="inv-breakdown-title">Per-sheet breakdown <span className="inv-breakdown-hint">(also dumped to the browser console — F12)</span></div>
                <table className="inv-bd-table">
                  <thead>
                    <tr><th>Sheet</th><th>Family</th><th>Kind</th><th>Header row</th><th>Columns mapped</th><th className="inv-num">Raw</th><th className="inv-num">Parsed</th><th className="inv-num">Collapsed</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {parsed.sheets.map(sh => (
                      <tr key={sh.sheetName} className={sh.skipped ? 'inv-bd-skip' : ''}>
                        <td className="inv-bd-name">{sh.sheetName}</td>
                        <td className="inv-mono">{sh.family === 'B' ? 'B · per-row' : sh.family === 'A' ? 'A · carry-down' : '—'}</td>
                        <td>{sh.kind === 'customer' ? 'Allocated' : 'Stock'}</td>
                        <td className="inv-num">{sh.diag?.headerRow != null ? sh.diag.headerRow + 1 : '—'}</td>
                        <td className="inv-mono">{(sh.diag?.cols || []).join(', ') || '—'}</td>
                        <td className="inv-num">{sh.diag?.rawRowCount ?? 0}</td>
                        <td className="inv-num">{sh.diag?.rowsYielded ?? 0}</td>
                        <td className="inv-num">{sh.items?.length ?? 0}</td>
                        <td className={sh.skipped ? 'inv-bd-skipcell' : ''}>{sh.skipped ? `SKIPPED — ${sh.reason}` : 'ok'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="inv-prev-controls">
                <label className="inv-check"><input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Show only flagged</label>
                <label className="inv-check"><input type="checkbox" checked={skipFlagged} onChange={e => setSkipFlagged(e.target.checked)} /> Skip flagged rows on import</label>
              </div>

              <div className="inv-prev-scroll">
                {parsed.sheets.map(sheet => (
                  <SheetPreview key={sheet.sheetName} sheet={sheet} onlyFlagged={onlyFlagged} />
                ))}
              </div>
            </>
          )}

          {stage === 'importing' && <div className="inv-center">Importing {toImport.length} rows…</div>}

          {stage === 'done' && result && (
            <div className="inv-center">
              <div className="inv-done-big">✓ Imported {result.inserted} rows</div>
              <div className="inv-done-detail">
                {result.skipped > 0 && <div>{result.skipped} flagged rows skipped (your choice).</div>}
                {result.sheetsSkipped > 0 && <div>{result.sheetsSkipped} sheet(s) had no recognizable columns and were skipped.</div>}
                <div>They’re in the Yard now.</div>
              </div>
              <button type="button" className="sb-btn-primary" onClick={onClose}>Done</button>
            </div>
          )}
        </div>

        {stage === 'preview' && parsed && (
          <div className="inv-modal-foot">
            <button type="button" className="sb-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="sb-btn-primary" onClick={doImport} disabled={!toImport.length}>
              Import {toImport.length} row{toImport.length === 1 ? '' : 's'}
              {skipFlagged && s.flaggedCount ? ` (skipping ${s.flaggedCount} flagged)` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label, tone }) {
  return (
    <div className={`inv-stat ${tone === 'warn' ? 'inv-stat-warn' : ''}`}>
      <div className="inv-stat-n">{n}</div>
      <div className="inv-stat-l">{label}</div>
    </div>
  )
}

function SheetPreview({ sheet, onlyFlagged }) {
  const items = onlyFlagged ? sheet.items.filter(i => i._flags?.length) : sheet.items
  // Group items by location (preserving first-seen order).
  const groups = []
  const byLoc = new Map()
  for (const it of items) {
    const loc = it.location || '(no location)'
    if (!byLoc.has(loc)) { byLoc.set(loc, []); groups.push(loc) }
    byLoc.get(loc).push(it)
  }
  const sheetStones = sheet.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)

  return (
    <div className="inv-sheet">
      <div className="inv-sheet-head">
        <span className="inv-sheet-name">{sheet.sheetName}</span>
        <span className={`inv-kind inv-kind-${sheet.kind}`}>{sheet.kind === 'customer' ? 'Allocated' : 'Stock'}</span>
        {sheet.skipped
          ? <span className="inv-sheet-skip">SKIPPED — {sheet.reason}</span>
          : <span className="inv-sheet-count">{sheet.items.length} rows · {sheetStones} stones</span>}
      </div>
      <div className="inv-sheet-diag">
        {sheet.diag?.headerRow != null
          ? <>header @ row {sheet.diag.headerRow + 1} · columns: {(sheet.diag.cols || []).join(', ') || '—'} · {sheet.diag.rawRowCount} raw rows → {sheet.diag.rowsYielded} parsed{sheet.diag.rowsAfterCollapse != null ? ` → ${sheet.diag.rowsAfterCollapse} after collapse` : ''}</>
          : <>⚠ no header detected · {sheet.diag?.rawRowCount ?? 0} raw rows scanned</>}
      </div>
      {!sheet.skipped && items.length > 0 && (
        <table className="inv-prev-table">
          <thead>
            <tr><th>Type</th><th>Color</th><th>Size</th><th>Top</th><th>Sides</th><th>Back</th><th className="inv-num">Qty</th>{sheet.kind === 'customer' && <th>Assigned to</th>}<th>Flags</th></tr>
          </thead>
          <tbody>
            {groups.map(loc => (
              <FragmentRows key={loc} loc={loc} rows={byLoc.get(loc)} isCustomer={sheet.kind === 'customer'} />
            ))}
          </tbody>
        </table>
      )}
      {!sheet.skipped && items.length === 0 && <div className="inv-sheet-empty">No rows{onlyFlagged ? ' flagged' : ''}.</div>}
    </div>
  )
}

function FragmentRows({ loc, rows, isCustomer }) {
  const cols = isCustomer ? 9 : 8
  return (
    <>
      <tr className="inv-loc-row"><td colSpan={cols}>📍 {loc}</td></tr>
      {rows.map((it, i) => (
        <tr key={i} className={it._flags?.length ? 'inv-flagged' : ''}>
          <td>{titleCase(it.item_type)}</td>
          <td>{it.color || '—'}</td>
          <td className="inv-mono">{it.size || '—'}</td>
          <td>{it.top || '—'}</td>
          <td>{it.sides || '—'}</td>
          <td>{it.back || '—'}</td>
          <td className="inv-num">{it.quantity}</td>
          {isCustomer && <td>{it.assigned_to || '—'}</td>}
          <td>{(it._flags || []).map(f => <span key={f} className="inv-flag">{FLAG_LABELS[f] || f}</span>)}</td>
        </tr>
      ))}
    </>
  )
}

const IMP_CSS = `
  .inv-modal-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(20,18,14,0.45);
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .inv-modal { background: var(--sb-surface, #fff); width: min(1100px, 96vw); max-height: 92vh; border-radius: 16px;
    display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
  .inv-modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .inv-modal-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .inv-modal-title { margin: 3px 0 0; font-size: 20px; font-weight: 600; color: var(--sb-text, #2a2a2a); font-family: var(--font-d, 'Playfair Display'), Georgia, serif; }
  .inv-modal-x { background: none; border: none; font-size: 26px; line-height: 1; color: #9a9389; cursor: pointer; padding: 0 4px; }
  .inv-modal-x:hover { color: #2a2a2a; }
  .inv-modal-body { padding: 18px 22px; overflow-y: auto; flex: 1 1 auto; }
  .inv-modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); }

  .inv-up { max-width: 640px; margin: 8px auto; text-align: center; }
  .inv-up-lede { font-size: 14px; color: var(--sb-text-muted, #6b6256); line-height: 1.6; margin-bottom: 18px; }
  .inv-up-drop { display: flex; flex-direction: column; gap: 6px; align-items: center; padding: 34px; border: 2px dashed var(--sb-border, #d8d2c4); border-radius: 14px; cursor: pointer; }
  .inv-up-drop:hover { border-color: #9A7209; background: #fbf6ec; }
  .inv-up-drop input { display: none; }
  .inv-up-drop-main { font-size: 16px; font-weight: 600; color: #9A7209; }
  .inv-up-drop-sub { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }

  .inv-center { text-align: center; padding: 40px 12px; color: var(--sb-text, #2a2a2a); font-size: 15px; }
  .inv-err-big { font-size: 16px; font-weight: 600; color: #b3261e; margin-bottom: 8px; }
  .inv-err-detail { font-size: 13px; color: var(--sb-text-muted, #8a7f6c); margin-bottom: 18px; word-break: break-word; }
  .inv-done-big { font-size: 20px; font-weight: 700; color: #1f7a3d; margin-bottom: 10px; }
  .inv-done-detail { font-size: 13.5px; color: var(--sb-text-muted, #6b6256); line-height: 1.7; margin-bottom: 20px; }

  .inv-summary { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 4px 2px 14px; }
  .inv-stat { text-align: center; }
  .inv-stat-n { font-size: 24px; font-weight: 700; color: var(--sb-text, #2a2a2a); font-variant-numeric: tabular-nums; }
  .inv-stat-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); }
  .inv-stat-warn .inv-stat-n { color: #9A7209; }
  .inv-summary-file { margin-left: auto; font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }

  .inv-breakdown { margin: 4px 0 16px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 10px; overflow: hidden; }
  .inv-breakdown-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b5d3a; background: #f4efe4; padding: 8px 12px; }
  .inv-breakdown-hint { font-weight: 500; text-transform: none; letter-spacing: 0; color: #9a8f78; }
  .inv-bd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .inv-bd-table th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted, #8a7f6c); padding: 7px 12px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .inv-bd-table td { padding: 7px 12px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); color: var(--sb-text, #2a2a2a); }
  .inv-bd-table tr:last-child td { border-bottom: 0; }
  .inv-bd-name { font-weight: 700; }
  .inv-bd-skip td { background: #fdeced; }
  .inv-bd-skipcell { color: #b3261e; font-weight: 600; }

  .inv-prev-controls { display: flex; gap: 18px; padding: 10px 0 14px; border-top: 1px solid var(--sb-border-soft, #f0ece2); }
  .inv-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sb-text, #2a2a2a); cursor: pointer; }

  .inv-prev-scroll { /* sits inside the scrolling body */ }
  .inv-sheet { margin-bottom: 22px; }
  .inv-sheet-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .inv-sheet-name { font-size: 14px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .inv-kind { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; }
  .inv-kind-stock { background: #e7f3ea; color: #1f7a3d; }
  .inv-kind-customer { background: #fbeede; color: #9A7209; }
  .inv-sheet-count { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }
  .inv-sheet-skip { font-size: 12px; color: #b3261e; font-weight: 600; }
  .inv-sheet-diag { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 10.5px; color: #a59a86; margin-bottom: 6px; }
  .inv-sheet-empty { font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); padding: 4px 2px; }

  .inv-prev-table { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 8px; overflow: hidden; }
  .inv-prev-table th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted, #8a7f6c); padding: 7px 10px; background: var(--sb-surface-muted, #faf8f3); border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .inv-prev-table td { padding: 6px 10px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); color: var(--sb-text, #2a2a2a); }
  .inv-loc-row td { background: #f4efe4; font-weight: 700; color: #6b5d3a; font-size: 12px; }
  .inv-flagged td { background: #fdf6ec; }
  .inv-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; }
  .inv-num { text-align: right; font-variant-numeric: tabular-nums; }
  .inv-flag { display: inline-block; background: #fbe4c4; color: #8a5a00; font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; margin-right: 4px; white-space: nowrap; }
`
