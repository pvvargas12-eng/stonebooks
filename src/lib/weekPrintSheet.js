// =============================================================================
// weekPrintSheet — the one-page printed week (INSTALL-PLANNER-5, 2026-10-12)
// =============================================================================
// Paul: "print the 5 day planner — CLEAN, same basic information, no color
// except blockers in RED so it's bold and clear. Two copies, office and shop,
// updated by hand as blockers clear." Then: "build the same thing in the
// Scheduler so I see all the production, install, inscriptions getting done
// in a week."
//
// One builder, two callers: the Install/Inscription Planner prints its track's
// week; the Scheduler prints every run of the week (setting, inscription,
// blasting, foundations, …). Black ink on letter landscape; the ONLY color is
// the blocker red, each blocker with a tick box. Demo approved 2026-10-12
// (artifact 52ag6qswq2Wfinxyk9HGVk) — keep the sheet to that shape.
// =============================================================================
import { installGates, rowBalanceDue, fmtUSD, BATCH_KINDS } from './stonebooksData'
import { composeGraveLocation } from './monumentCatalog'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const TAG = { new_stone: 'NS', bronze: 'BR', inscription: 'INSC', mausoleum_door: 'DOOR', cleaning_repair: 'REPAIR' }
const msOf = (job, key) => (job?.milestones || []).find(m => m.milestone_key === key) || null
const stencilCut = (job) => { const m = msOf(job, 'stencil_cut'); return !!m && (m.status === 'done' || m.status === 'not_needed') }

export const familyOfJob = (job) => job?.order?.primary_lastname || job?.customer?.last_name
  || [job?.customer?.first_name, job?.customer?.last_name].filter(Boolean).join(' ') || '—'

export const fmtDayLong = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const fmtDayWeek = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()

// The facts one stop prints — family, tag, order #, grave, blockers (RED),
// reminders (plain), ready. Blockers depend on what the run is: setting /
// delivery = the four install gates, inscription = paid + permit + stencil
// cut, blasting = stencil cut, everything else = money + permit only.
export function stopFacts(job, kind, reminders = []) {
  const o = job?.order || {}
  const g = installGates(o, job)
  const bal = rowBalanceDue(o)
  const blockers = []
  if (g.paid === false && bal > 0) blockers.push(`OWES ${fmtUSD(bal)}`)
  const isSet = kind === 'setting' || kind === 'delivery'
  if (isSet && g.fdn === false) blockers.push('FDN NOT IN')
  if (g.permit === false && kind !== 'blasting' && kind !== 'acid_wash' && kind !== 'repair') blockers.push('PERMIT NOT APPROVED')
  if (isSet && g.blasted === false) blockers.push(job?.job_type === 'bronze' ? 'NOT ARRIVED' : 'NOT BLASTED')
  if ((kind === 'inscription' || kind === 'blasting') && !stencilCut(job)) blockers.push('STENCIL NOT CUT')
  const mb = o.manual_blocker
  if (mb?.kind === 'hold') blockers.push(`HOLD${mb.reason ? ` — ${mb.reason}` : ''}`)
  const notes = []
  if (isSet && g.fdnCode === 'drop_off') notes.push('drop off')
  return {
    family: familyOfJob(job),
    tag: TAG[job?.job_type] || '',
    orderNo: o.order_number || '',
    location: composeGraveLocation(o) || '',
    notes,
    blockers,
    reminders: (reminders || []).map(r => r.text).filter(Boolean),
    ready: blockers.length === 0,
    owed: g.paid === false ? Math.max(0, bal) : 0,
  }
}

export const kindLabel = (code) => BATCH_KINDS.find(k => k.code === code)?.label || code || 'Run'

// days: [{ iso, trips: [{ name, kind, ampm, stops: [stopFacts…] }] }]
export function buildWeekPrintHtml({ title, subtitle, days, printedAt = new Date(), key = [] }) {
  const stops = days.flatMap(d => d.trips.flatMap(t => t.stops))
  const blocked = stops.filter(s => !s.ready).length
  const owed = stops.reduce((s, x) => s + (x.owed || 0), 0)
  const trips = days.reduce((s, d) => s + d.trips.length, 0)
  const cols = days.length
  const when = printedAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const dayHtml = days.map(d => `
    <div class="day">
      <div class="day-h"><span>${fmtDayWeek(d.iso)} <small>${fmtDayLong(d.iso)}</small></span><span class="n">${d.trips.reduce((s, t) => s + t.stops.length, 0)}</span></div>
      ${d.trips.length === 0 ? '<div class="empty">Nothing scheduled</div>' : d.trips.map(t => `
        <div class="cem">
          <div class="cem-h">${esc(t.name)}${t.kindTag ? ` <span class="kind">${esc(t.kindTag)}</span>` : ''}${t.ampm ? ` <span class="kind">${esc(String(t.ampm).toUpperCase())}</span>` : ''}</div>
          ${t.stops.map((s, i) => `
            <div class="stone"><span class="num">${i + 1}</span><div>
              <div class="fam">${esc(s.family)}${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}</div>
              ${(s.orderNo || s.location || s.notes.length) ? `<div class="meta">${esc([s.orderNo, s.location, ...s.notes].filter(Boolean).join(' · '))}</div>` : ''}
              ${s.blockers.length ? `<div class="blk">${s.blockers.map(b => `<span class="b">${esc(b)}</span>`).join('')}</div>` : ''}
              ${s.reminders.map(r => `<div class="rem">${esc(r)}</div>`).join('')}
              ${s.ready ? '<div class="ready">READY</div>' : ''}
            </div></div>`).join('')}
        </div>`).join('')}
    </div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: letter landscape; margin: 0.4in 0.45in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; font: 11px/1.3 "Segoe UI", Arial, Helvetica, sans-serif; }
  .sheet { display: flex; flex-direction: column; gap: 10px; min-height: 100vh; padding: 0.35in 0.4in; }
  @media print { .sheet { padding: 0; min-height: 0; } .noprint { display: none !important; } }
  .noprint { display: flex; gap: 10px; align-items: center; background: #f3f3f0; border: 1px solid #ccc; padding: 8px 12px; font-size: 12px; }
  .noprint button { font: 600 12px inherit; padding: 6px 14px; cursor: pointer; }
  .hd { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 7px; }
  .hd h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: .01em; }
  .hd .sub { font-family: Consolas, "Courier New", monospace; font-size: 10.5px; color: #555; margin-top: 3px; }
  .hd .counts { text-align: right; font-family: Consolas, "Courier New", monospace; font-size: 10.5px; line-height: 1.5; color: #555; white-space: nowrap; }
  .hd .counts b { color: #111; font-weight: 600; }
  .hd .counts .r { color: #C8102E; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); border: 1px solid #111; flex: 1; }
  .day { border-right: 1px solid #bbb; min-width: 0; display: flex; flex-direction: column; }
  .day:last-child { border-right: 0; }
  .day-h { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 7px; border-bottom: 1px solid #111; font-weight: 700; font-size: 11.5px; letter-spacing: .04em; }
  .day-h small { font-family: Consolas, "Courier New", monospace; font-weight: 400; color: #555; font-size: 10px; }
  .day-h .n { font-family: Consolas, "Courier New", monospace; font-weight: 600; font-size: 10.5px; }
  .empty { padding: 12px 7px; color: #666; font-style: italic; }
  .cem { padding: 5px 7px 6px; border-bottom: 1px solid #bbb; break-inside: avoid; }
  .cem:last-child { border-bottom: 0; }
  .cem-h { font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #444; margin-bottom: 3px; overflow-wrap: anywhere; }
  .cem-h .kind { font-weight: 600; color: #777; letter-spacing: .04em; border: 1px solid #bbb; padding: 0 4px; margin-left: 3px; }
  .stone { display: grid; grid-template-columns: 13px 1fr; column-gap: 5px; padding: 3px 0 4px; border-top: 1px dotted #ddd; min-width: 0; break-inside: avoid; }
  .stone:first-of-type { border-top: 0; }
  .stone .num { font-family: Consolas, "Courier New", monospace; font-size: 9.5px; color: #666; padding-top: 2px; }
  .stone .fam { font-weight: 700; font-size: 11.5px; overflow-wrap: anywhere; }
  .stone .fam .tag { font-family: Consolas, "Courier New", monospace; font-weight: 600; font-size: 8.5px; letter-spacing: .06em; color: #555; margin-left: 4px; vertical-align: 1px; }
  .stone .meta { font-family: Consolas, "Courier New", monospace; font-size: 9px; color: #555; overflow-wrap: anywhere; }
  .blk { margin-top: 2px; display: flex; flex-direction: column; gap: 1px; }
  .blk .b { color: #C8102E; font-weight: 700; font-size: 10px; letter-spacing: .02em; display: flex; align-items: center; gap: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .blk .b::before { content: ""; width: 9px; height: 9px; border: 1.5px solid #C8102E; display: inline-block; flex: none; }
  .rem { font-size: 9.5px; font-style: italic; margin-top: 1px; display: flex; align-items: center; gap: 4px; }
  .rem::before { content: ""; width: 9px; height: 9px; border: 1px solid #555; display: inline-block; flex: none; }
  .ready { font-family: Consolas, "Courier New", monospace; font-size: 9px; color: #666; letter-spacing: .05em; margin-top: 1px; }
  .ft { display: flex; justify-content: space-between; gap: 16px; font-family: Consolas, "Courier New", monospace; font-size: 9px; color: #555; border-top: 1px solid #bbb; padding-top: 5px; flex-wrap: wrap; }
  .ft .key { display: flex; gap: 14px; flex-wrap: wrap; }
  .ft .key span { display: inline-flex; align-items: center; gap: 4px; }
  .ft .sq { width: 9px; height: 9px; display: inline-block; border: 1.5px solid #C8102E; }
  .ft .sq2 { width: 9px; height: 9px; display: inline-block; border: 1px solid #555; }
  .ft .rd { color: #C8102E; font-weight: 700; }
</style></head><body>
<div class="sheet">
  <div class="noprint"><button type="button" onclick="window.print()">Print</button><span>Letter, landscape. Blockers print in red. Close this tab when done.</span></div>
  <div class="hd">
    <div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)} &nbsp;·&nbsp; Shevchenko Monuments &nbsp;·&nbsp; printed ${esc(when)}</div></div>
    <div class="counts"><b>${stops.length} stop${stops.length === 1 ? '' : 's'}</b> on ${cols} days · ${trips} trip${trips === 1 ? '' : 's'}<br>
      ${blocked ? `<span class="r">${blocked} blocked</span>` : '<b>0 blocked</b>'} · ${owed ? `<span class="r">${esc(fmtUSD(owed))} still owed</span>` : '<b>nothing owed</b>'}<br>
      ${stops.length - blocked} ready</div>
  </div>
  <div class="grid">${dayHtml}</div>
  <div class="ft">
    <div class="key">
      <span><i class="sq"></i><span class="rd">RED</span> = blocker, tick the box when it's cleared</span>
      <span><i class="sq2"></i> reminder (does not block)</span>
      <span>${esc(key.length ? key.join(' · ') : 'NS new stone · BR bronze · INSC inscription')}</span>
    </div>
    <div>Stonebooks · page 1 of 1</div>
  </div>
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { try { window.print() } catch (e) {} }, 250) })</script>
</body></html>`
}

// Open the sheet in its own tab and hand it to the printer. Must be called
// from a click (popup blockers). Returns false when the window was blocked.
// Same, but the sheet needs a fetch first (balances…). The tab is opened
// synchronously inside the click so pop-up blockers stay quiet, shows a
// placeholder, then the real sheet replaces it. Returns false only when
// the browser refused the window.
export function openPrintSheetAsync(build) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing the sheet</title></head><body style="font:14px Segoe UI,Arial,sans-serif;padding:24px;color:#444">Preparing the sheet…</body></html>')
  w.document.close()
  Promise.resolve().then(build).then((html) => {
    w.document.open(); w.document.write(html); w.document.close()
    try { w.focus() } catch { /* ignore */ }
  }).catch((e) => {
    w.document.open(); w.document.write('<!doctype html><html><body style="font:14px Segoe UI,Arial,sans-serif;padding:24px;color:#B00020">Could not build the sheet: ' + String(e?.message || e).replace(/[<>&]/g, '') + '</body></html>'); w.document.close()
  })
  return true
}

export function openPrintSheet(html) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  try { w.focus() } catch { /* ignore */ }
  return true
}
