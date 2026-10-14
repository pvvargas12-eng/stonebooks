// =============================================================================
// floorPrintSheet — print the production floor + print each line
// =============================================================================
// Paul (2026-10-14, floor screenshot): "I must be able to print this, and I
// want to be able to print each line with the die size." Same ink rules as
// the week sheet (lib/weekPrintSheet.js): black on white, blockers are the
// only red, each with a tick box. The die size printed is the CONTRACT's
// die line (components carry it read-time since SIZE-TRUTH-2, 2026-10-08).
// =============================================================================
import { fmtUSD } from './stonebooksData'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = (d = new Date()) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const CSS = (orientation) => `
  @page { size: letter ${orientation}; margin: 0.4in 0.45in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; font: 11px/1.3 "Segoe UI", Arial, Helvetica, sans-serif; }
  .sheet { display: flex; flex-direction: column; gap: 10px; padding: 0.35in 0.4in; }
  .sheet + .sheet { page-break-before: always; }
  @media print { .sheet { padding: 0; } .noprint { display: none !important; } }
  .noprint { display: flex; gap: 10px; align-items: center; background: #f3f3f0; border: 1px solid #ccc; padding: 8px 12px; font-size: 12px; margin: 0.3in 0.4in 0; }
  .noprint button { font: 600 12px inherit; padding: 6px 14px; cursor: pointer; }
  .hd { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 7px; }
  .hd h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: .01em; }
  .hd .sub { font-family: Consolas, "Courier New", monospace; font-size: 10.5px; color: #555; margin-top: 3px; }
  .hd .counts { text-align: right; font-family: Consolas, "Courier New", monospace; font-size: 10.5px; line-height: 1.5; color: #555; white-space: nowrap; }
  .hd .counts b { color: #111; font-weight: 600; }
  .r { color: #C8102E; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mono { font-family: Consolas, "Courier New", monospace; }
  /* columns (the floor) */
  .grid { display: grid; gap: 0; border: 1px solid #111; }
  .col { border-right: 1px solid #bbb; min-width: 0; display: flex; flex-direction: column; }
  .col:last-child { border-right: 0; }
  .col-h { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 7px; border-bottom: 1px solid #111; font-weight: 700; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; }
  .col-h .n { font-family: Consolas, "Courier New", monospace; font-weight: 600; }
  .empty { padding: 12px 7px; color: #666; font-style: italic; }
  .card { padding: 5px 7px 6px; border-bottom: 1px dotted #bbb; break-inside: avoid; min-width: 0; }
  .card:last-child { border-bottom: 0; }
  .fam { font-weight: 700; font-size: 11.5px; overflow-wrap: anywhere; }
  .fam .tag { font-family: Consolas, "Courier New", monospace; font-weight: 600; font-size: 8.5px; letter-spacing: .05em; color: #555; margin-left: 5px; vertical-align: 1px; border: 1px solid #bbb; padding: 0 3px; }
  .size { font-family: Consolas, "Courier New", monospace; font-size: 10px; color: #111; overflow-wrap: anywhere; margin-top: 1px; }
  .meta { font-family: Consolas, "Courier New", monospace; font-size: 9px; color: #555; overflow-wrap: anywhere; }
  .blk { margin-top: 2px; display: flex; flex-direction: column; gap: 1px; }
  .blk .b { color: #C8102E; font-weight: 700; font-size: 10px; letter-spacing: .02em; display: flex; align-items: center; gap: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .blk .b::before { content: ""; width: 9px; height: 9px; border: 1.5px solid #C8102E; display: inline-block; flex: none; }
  .note { font-size: 9.5px; font-style: italic; margin-top: 1px; overflow-wrap: anywhere; }
  /* table (a line) */
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { text-align: left; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #444; border-bottom: 1.5px solid #111; padding: 4px 6px; }
  td { border-bottom: 1px solid #ddd; padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; }
  tr { break-inside: avoid; }
  td.n { font-family: Consolas, "Courier New", monospace; color: #666; width: 22px; }
  td.f { font-weight: 700; font-size: 11.5px; }
  td.s { font-family: Consolas, "Courier New", monospace; }
  td.chk { width: 26px; text-align: center; }
  td.chk i { width: 12px; height: 12px; border: 1.5px solid #111; display: inline-block; }
  .ft { display: flex; justify-content: space-between; gap: 16px; font-family: Consolas, "Courier New", monospace; font-size: 9px; color: #555; border-top: 1px solid #bbb; padding-top: 5px; flex-wrap: wrap; }
  .ft .key { display: flex; gap: 14px; flex-wrap: wrap; }
  .ft .key span { display: inline-flex; align-items: center; gap: 4px; }
  .ft .sq { width: 9px; height: 9px; display: inline-block; border: 1.5px solid #C8102E; }
  .ft .sq2 { width: 9px; height: 9px; display: inline-block; border: 1.5px solid #111; }
  /* the floor list (portrait): two sections, line order */
  .sec { break-inside: auto; }
  .sec-h { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0 3px; margin-top: 4px; font-weight: 700; font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; border-bottom: 2px solid #111; }
  .sec-h small { font-weight: 400; font-size: 9.5px; letter-spacing: .02em; text-transform: none; color: #555; margin-left: 6px; }
  .sec-h .n { font-family: Consolas, "Courier New", monospace; font-weight: 600; }
  .sec td.o, .sec td.c { font-family: Consolas, "Courier New", monospace; font-size: 10px; color: #444; }
  .sec td.o, .sec td.n { white-space: nowrap; }
  .sec td.s { font-size: 10.5px; white-space: nowrap; }
  .sec td.f { white-space: nowrap; }
  .sec td.bl { min-width: 0; }
  .sec td.bl .b { color: #C8102E; font-weight: 700; font-size: 10px; letter-spacing: .02em; display: flex; align-items: center; gap: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sec td.bl .b::before { content: ""; width: 9px; height: 9px; border: 1.5px solid #C8102E; display: inline-block; flex: none; }
  .sec td.bl .note { display: block; }
  .sec td.empty { padding: 10px 6px; color: #666; font-style: italic; border-bottom: 0; }
  .sec.aware .sec-h { border-bottom-color: #777; color: #444; }
  .sec.aware td { color: #555; border-bottom-color: #e4e4e4; }
  .sec.aware td.f { color: #333; }
  .sec.aware td.bl .b { color: #C8102E; }
`

const wrap = (title, orientation, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(orientation)}</style></head><body>
<div class="noprint"><button type="button" onclick="window.print()">Print</button><span>Letter, ${orientation}. Blockers print in red. Close this tab when done.</span></div>
${body}
<script>window.addEventListener('load', function () { setTimeout(function () { try { window.print() } catch (e) {} }, 250) })</script>
</body></html>`

const footer = (right) => `<div class="ft"><div class="key"><span><i class="sq"></i><span class="r">RED</span> = blocker, tick when cleared</span><span>Die size = the contract's die line</span></div><div>${esc(right)}</div></div>`

// A piece as it prints — the same facts the floor card shows.
export function pieceFacts(c, { lineTag = null } = {}) {
  const o = c?.order || {}
  const blockers = []
  if (c?.qc_issue) blockers.push(`HELD — ${c.qc_issue}`)
  if (c?.blocker && !c?.qc_issue) blockers.push(String(c.blocker).toUpperCase())
  if (o.status && !['paid_in_full', 'closed'].includes(o.status)) blockers.push('NOT PAID IN FULL')
  const ps = o.permit_status
  const notes = []
  if (ps && !['approved', 'not_required', 'unknown'].includes(ps)) {
    if (['submitted', 'pending'].includes(ps)) notes.push(`Permit ${ps}`)
    else blockers.push('PERMIT NOT APPROVED')
  }
  if (c?.notes) notes.push(c.notes)
  return {
    family: c?.order?.primary_lastname || c?.order?.customer?.last_name || c?.vendor_request?.family_name || c?.cemetery_order?.cemetery_name || '—',
    size: c?.size || '',
    orderNo: o.order_number || c?.cemetery_order?.order_number || '',
    cemetery: o.cemetery?.name || c?.cemetery_order?.cemetery_name || '',
    due: o.target_completion_date || null,
    lineTag, blockers, notes,
  }
}

// THE FLOOR — Paul's draft (2026-10-14, artifact 8KwZw5BpgJPTMqL1KW4yZT):
// ONE PORTRAIT LIST. The first board column (Ready to Bring Up) as line
// items in line order with an UP tick box, then the second column (Brought
// to Line) below it, greyed, for awareness. Stencil cut / blasting queue stay
// off the sheet ("if it's already up it's in the blasting queue"). Runs onto
// a second page when the line is long — rows are never cut.
// columns: [{ label, cards: [pieceFacts…] }] in board-phase order.
const posOf = (x) => { const m = /#(\d+)/.exec(x.lineTag || ''); return m ? Number(m[1]) : 9999 }
export function buildFloorPrintHtml({ trackLabel, columns, lineLine = null }) {
  const ready = columns[0] || { label: 'Ready to bring up', cards: [] }
  const up = columns[1] || null
  const sortLine = (cards) => cards.slice().sort((a, b) => posOf(a) - posOf(b) || String(a.family).localeCompare(String(b.family)))
  const readyRows = sortLine(ready.cards)
  const upRows = up ? sortLine(up.cards) : []
  const notPaid = [...readyRows, ...upRows].filter(x => x.blockers.some(b => b.startsWith('NOT PAID'))).length
  const blocked = [...readyRows, ...upRows].filter(x => x.blockers.length).length
  const row = (x, tick) => `<tr>
    <td class="n">${x.lineTag ? esc(String(x.lineTag).replace(/^L\d+\s*#/, '')) : ''}</td>
    <td class="f">${esc(x.family)}</td>
    <td class="s">${esc(x.size || '—')}</td>
    <td class="o">${esc(x.orderNo || '')}</td>
    <td class="c">${esc(x.cemetery || '')}</td>
    <td class="bl">${x.blockers.map(b => `<span class="b">${esc(b)}</span>`).join('')}${x.notes.map(n => `<span class="note">${esc(n)}</span>`).join('')}</td>
    <td class="chk">${tick ? '<i></i>' : ''}</td>
  </tr>`
  const section = (label, hint, rows, tick, tickHead) => `<div class="sec${tick ? '' : ' aware'}">
    <div class="sec-h"><span>${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ''}</span><span class="n">${rows.length}</span></div>
    <table>
      <thead><tr><th>#</th><th>Family</th><th>Die size (contract)</th><th>Order</th><th>Cemetery</th><th>Blockers</th><th>${tickHead}</th></tr></thead>
      <tbody>${rows.length ? rows.map(x => row(x, tick)).join('') : '<tr><td colspan="7" class="empty">Nothing here</td></tr>'}</tbody>
    </table>
  </div>`
  const body = `<div class="sheet">
  <div class="hd">
    <div><h1>PRODUCTION FLOOR${lineLine ? ` — ${esc(String(lineLine).toUpperCase())}` : ''}</h1><div class="sub">${esc(String(trackLabel).toUpperCase())} &nbsp;·&nbsp; Shevchenko Monuments &nbsp;·&nbsp; printed ${esc(when())}</div></div>
    <div class="counts"><b>${readyRows.length} to bring up</b>${up ? ` · ${upRows.length} on the line` : ''}<br>${notPaid ? `<span class="r">${notPaid} not paid in full</span>` : (blocked ? `<span class="r">${blocked} with a blocker</span>` : '<b>nothing blocked</b>')}</div>
  </div>
  ${section(ready.label, 'in line order', readyRows, true, 'Up')}
  ${up ? section(up.label, 'already up, for awareness', upRows, false, '') : ''}
  <div class="ft"><div class="key"><span><i class="sq"></i><span class="r">RED</span> = blocker</span><span><i class="sq2"></i> tick UP when the stone is brought to the line</span><span>Die size = the contract's die line</span></div><div>Stonebooks · Production floor</div></div>
</div>`
  return wrap(`Production floor — ${trackLabel}`, 'portrait', body)
}

// A decorated floor line (floorLines.decorateLines + attachLineMoney) → the
// sheet shape below. `compById` = the board's components (size = contract die
// line); `phaseLabel` names the column the stone sits in.
export function lineSheetFrom(line, compById, { phaseLabel = (p) => p } = {}) {
  const rows = (line.open || line.items || []).map((it, i) => {
    const full = compById.get(it.component_id) || it.component || null
    return { pos: i + 1, phase: full?.current_phase ? phaseLabel(full.current_phase) : '', ...pieceFacts(full || {}, {}) }
  })
  return {
    label: line.label || `Line ${line.number}`, status: line.status, weekStart: line.week_start || null,
    owed: line.owed || 0, contract: line.contract || 0, counts: line.counts || {}, rows,
  }
}

// THE LINES — one page per line, a table with the die size on every row.
// lines: [{ label, status, weekStart, owed, contract, counts, rows: [{ pos, phase, ...pieceFacts }] }]
export function buildLineSheetsHtml({ lines }) {
  const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const body = lines.map(l => {
    const c = l.counts || {}
    return `<div class="sheet">
  <div class="hd">
    <div><h1>${esc(String(l.label).toUpperCase())}${l.weekStart ? ` — WEEK OF ${esc(fmtDay(l.weekStart).toUpperCase())}` : ''}</h1>
      <div class="sub">${esc(String(l.status || '').replace('_', ' ').toUpperCase())} &nbsp;·&nbsp; Shevchenko Monuments &nbsp;·&nbsp; printed ${esc(when())}</div></div>
    <div class="counts"><b>${l.rows.length} on the line</b>${c.blasted ? ` · ${c.blasted} blasted out` : ''}<br>
      ${l.owed > 0 ? `<span class="r">${esc(fmtUSD(l.owed))} OWED</span>` : (l.contract > 0 ? '<b>paid in full</b>' : '')}${l.contract > 0 ? ` · contract ${esc(fmtUSD(l.contract))}` : ''}</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Family</th><th>Die size (contract)</th><th>Order</th><th>Cemetery</th><th>Due</th><th>Where</th><th>Blockers</th><th>Out</th></tr></thead>
    <tbody>
      ${l.rows.length === 0 ? '<tr><td colspan="9" class="empty">Nothing on this line.</td></tr>' : l.rows.map(x => `<tr>
        <td class="n">${x.pos}</td>
        <td class="f">${esc(x.family)}</td>
        <td class="s">${esc(x.size || '—')}</td>
        <td class="s">${esc(x.orderNo || '')}</td>
        <td>${esc(x.cemetery || '')}</td>
        <td class="s">${esc(x.due ? fmtDay(x.due) : '')}</td>
        <td>${esc(x.phase || '')}</td>
        <td>${x.blockers.length ? `<div class="blk">${x.blockers.map(b => `<span class="b">${esc(b)}</span>`).join('')}</div>` : ''}${x.notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}</td>
        <td class="chk"><i></i></td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${footer(`Stonebooks · ${l.label} · tick OUT when the stone is blasted`)}
</div>`
  }).join('')
  return wrap(lines.length === 1 ? lines[0].label : 'Production lines', 'portrait', body)
}
