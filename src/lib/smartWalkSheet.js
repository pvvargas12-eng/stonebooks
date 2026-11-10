// =============================================================================
// smartWalkSheet — the printable YARD WALK built from Smart Matches
// (SMART-WALK, Paul 2026-11-09: "build a list for smart matches and then go
// out and confirm those are actual, true and available … print the list, I
// would see the order name and the stock number to look for").
// =============================================================================
// buildSmartWalkHtml(items, { printedBy }) → a letter-portrait HTML page.
// items = [{ family, orderNumber, kind, needSpec, tag, where, yardSpec, strength, otherTags }]
// Ink doctrine: black and white, hairlines, tick boxes — no fills.
// =============================================================================

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function buildSmartWalkHtml(items, { printedBy = null } = {}) {
  const list = Array.isArray(items) ? items : []
  const now = new Date()
  const stamp = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const rows = list.map((it, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td class="fam"><b>${esc(it.family)}</b>${it.orderNumber ? `<div class="sub">${esc(it.orderNumber)} · ${esc(it.kind)}</div>` : `<div class="sub">${esc(it.kind)}</div>`}</td>
      <td class="need">${esc(it.needSpec)}</td>
      <td class="tag">${it.tag ? `<b class="big">#${esc(it.tag)}</b>` : '<span class="dim">no number</span>'}${it.otherTags?.length ? `<div class="sub">also ${it.otherTags.map(t => '#' + esc(t)).join(', ')}</div>` : ''}</td>
      <td class="where">${esc(it.where || '')}${it.yardSpec ? `<div class="sub">${esc(it.yardSpec)}</div>` : ''}${it.strength === 'near' ? '<div class="sub near">NEAR — check the size</div>' : ''}</td>
      <td class="box"><span class="tick"></span></td>
      <td class="box"><span class="tick"></span></td>
      <td class="notes"></td>
    </tr>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Yard walk — Smart Matches</title>
<style>
  @page { size: letter portrait; margin: 0.5in 0.5in 0.55in; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.3 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 15pt; margin: 0; letter-spacing: .04em; }
  .meta { font-size: 9pt; color: #555; text-align: right; line-height: 1.5; }
  .how { font-size: 9pt; color: #444; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: #666; border-bottom: 1.5px solid #111; padding: 0 5px 5px; font-weight: 700; }
  td { padding: 7px 5px; border-bottom: .5px solid #cfcfcf; vertical-align: top; font-size: 10pt; overflow-wrap: anywhere; }
  tr { break-inside: avoid; }
  .n { width: 22px; color: #777; }
  .fam { width: 17%; }
  .need { width: 23%; }
  .tag { width: 13%; }
  .where { width: 20%; }
  .box { width: 46px; text-align: center; }
  .notes { }
  .sub { font-size: 8.5pt; color: #555; margin-top: 2px; }
  .near { color: #111; font-weight: 700; }
  .dim { color: #888; font-style: italic; }
  .big { font-family: Consolas, "Courier New", monospace; font-size: 13pt; }
  .tick { display: inline-block; width: 14px; height: 14px; border: 1.2px solid #111; border-radius: 2px; vertical-align: middle; }
  footer { margin-top: 14px; font-size: 8.5pt; color: #555; display: flex; justify-content: space-between; }
</style></head><body>
<header>
  <div><h1>YARD WALK — SMART MATCHES</h1><div class="how">Find each painted number, check it is the right stone and still free, tick FOUND, tick OK to allocate. Back at the desk, press Allocate on the ones that checked out.</div></div>
  <div class="meta">${esc(stamp)} · ${esc(time)}<br>${list.length} stone${list.length === 1 ? '' : 's'} to check${printedBy ? `<br>printed by ${esc(printedBy)}` : ''}</div>
</header>
<table>
  <thead><tr><th class="n">#</th><th>Order</th><th>Needs (contract)</th><th>Stock #</th><th>Where · yard spec</th><th class="box">Found</th><th class="box">OK</th><th>Notes</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="dim">Nothing on the list.</td></tr>'}</tbody>
</table>
<footer><span>Shevchenko Monuments · Stonebooks</span><span>Stock # = the number painted on the stone. NEAR = the yard piece differs by one dimension.</span></footer>
<script>window.addEventListener('load', function(){ setTimeout(function(){ try { window.print() } catch (e) {} }, 300) })</script>
</body></html>`
}
