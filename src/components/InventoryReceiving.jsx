// =============================================================================
// InventoryReceiving — receive ordered Stone PRs into the yard (closes the loop).
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { listStonePRs, unreceivePR } from '../lib/stonebooksData'
import ReceivePRModal from './ReceivePRModal'

const DAY = 86400000
const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const itemCount = (pr) => (Array.isArray(pr.items) ? (pr.items[0]?.count ?? pr.items.length) : null)

export default function InventoryReceiving() {
  const [prs, setPrs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [receiveId, setReceiveId] = useState(null)
  const [banner, setBanner] = useState(null)
  const [today, setToday] = useState('')
  const [nowMs, setNowMs] = useState(0)

  const load = useCallback(async () => {
    setToday(todayISO())
    setNowMs(Date.now())
    const r = await listStonePRs()
    setLoadErr(r.ok ? null : r.error)
    setPrs(r.rows || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const overdue = [], expected = [], received = []
    const recvCutoff = (nowMs || 0) - 30 * DAY
    for (const pr of prs) {
      if (pr.received_at) {
        if (new Date(pr.received_at).getTime() >= recvCutoff) received.push(pr)
        continue
      }
      if (pr.status === 'draft') continue   // not ordered yet → not receivable
      if (pr.supplier_eta && today && pr.supplier_eta < today) overdue.push(pr)
      else expected.push(pr)
    }
    return { overdue, expected, received }
  }, [prs, today, nowMs])

  const unreceive = async (pr) => {
    if (!window.confirm(`Un-receive ${pr.po_number || 'this PR'}? Available stock it landed will be removed; anything already allocated is kept.`)) return
    const r = await unreceivePR(pr.id)
    if (!r.ok) { setBanner({ kind: 'err', text: `Couldn’t un-receive: ${r.error}` }); return }
    setBanner({ kind: 'ok', text: `Un-received. Removed ${r.removed} available stone row(s)${r.keptAllocated ? `; kept ${r.keptAllocated} already-allocated` : ''}.${r.warning ? ` ${r.warning}` : ''}` })
    load()
  }

  if (loading) return <div className="sb-empty">Loading receiving…</div>
  if (loadErr) return <div className="sb-empty">Receiving isn’t available yet.<br /><span className="irc-muted">Run the procurement + source-link migrations in Studio, then refresh.</span></div>

  const nothing = groups.overdue.length + groups.expected.length + groups.received.length === 0

  return (
    <div className="irc">
      <style>{IRC_CSS}</style>
      {banner && <div className={`irc-banner irc-banner-${banner.kind}`}>{banner.text}</div>}

      {nothing ? (
        <div className="sb-empty">No ordered purchase requests to receive.<br /><span className="irc-muted">Mark a PR “ordered” in Procurement, then it shows up here when it arrives.</span></div>
      ) : (
        <>
          <Group title="Overdue" tone="overdue" prs={groups.overdue} today={today} onReceive={setReceiveId} hint="past requested delivery" />
          <Group title="Expected" tone="expected" prs={groups.expected} today={today} onReceive={setReceiveId} />
          {groups.received.length > 0 && (
            <div className="irc-group">
              <div className="irc-group-head irc-group-received">Recently received <span className="irc-group-count">{groups.received.length}</span></div>
              <div className="irc-cards">
                {groups.received.map(pr => (
                  <div key={pr.id} className="irc-card irc-card-received">
                    <div className="irc-card-top"><span className="irc-prnum">{pr.po_number}</span><span className="irc-sup">{pr.supplier_name}</span></div>
                    <div className="irc-card-meta">Received {fmtDate(pr.received_at)} · {itemCount(pr) ?? '—'} lines</div>
                    <button type="button" className="irc-link irc-undo" onClick={() => unreceive(pr)}>Un-receive</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {receiveId && (
        <ReceivePRModal
          bulkOrderId={receiveId}
          onClose={() => setReceiveId(null)}
          onReceived={(r) => { setReceiveId(null); setBanner({ kind: 'ok', text: `Received ${r.landed} piece(s) into the yard${r.fully ? ' — PR fully received.' : ' — partial; PR stays open.'}` }); load() }}
        />
      )}
    </div>
  )
}

function Group({ title, tone, prs, today, onReceive, hint }) {
  if (!prs.length) return null
  return (
    <div className="irc-group">
      <div className={`irc-group-head irc-group-${tone}`}>{title} <span className="irc-group-count">{prs.length}</span>{hint && <span className="irc-group-hint">{hint}</span>}</div>
      <div className="irc-cards">
        {prs.map(pr => (
          <div key={pr.id} className={`irc-card irc-card-${tone}`}>
            <div className="irc-card-top"><span className="irc-prnum">{pr.po_number || '—'}</span><span className="irc-sup">{pr.supplier_name || '—'}</span></div>
            <div className="irc-card-meta">
              ETA {fmtDate(pr.supplier_eta)} · {itemCount(pr) ?? '—'} lines
              {pr.status === 'partial' && <span className="irc-partial">partial</span>}
            </div>
            <button type="button" className="sb-btn-primary irc-receive" onClick={() => onReceive(pr.id)}>Receive →</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const IRC_CSS = `
  .irc-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .irc-banner { padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 16px; }
  .irc-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .irc-banner-err { background: #fdeced; color: #b3261e; }
  .irc-group { margin-bottom: 22px; }
  .irc-group-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px; }
  .irc-group-overdue { color: #b3261e; }
  .irc-group-expected { color: #6d49b8; }
  .irc-group-received { color: #1f7a3d; }
  .irc-group-count { background: rgba(0,0,0,0.08); border-radius: 999px; padding: 0 8px; }
  .irc-group-hint { font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--sb-text-muted, #8a7f6c); }
  .irc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
  .irc-card { background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; padding: 14px 16px; border-left-width: 4px; }
  .irc-card-overdue { border-left-color: #d4534a; }
  .irc-card-expected { border-left-color: #8a5cc4; }
  .irc-card-received { border-left-color: #1f7a3d; }
  .irc-card-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .irc-prnum { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 13px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .irc-sup { font-size: 13px; font-weight: 600; color: #6b5d3a; }
  .irc-card-meta { font-size: 12.5px; color: var(--sb-text-muted, #6b6256); margin-bottom: 10px; }
  .irc-partial { margin-left: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; background: #fbeede; color: #9A7209; padding: 1px 7px; border-radius: 999px; }
  .irc-receive { padding: 6px 14px; font-size: 13px; }
  .irc-link { background: none; border: none; font: inherit; font-size: 12.5px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 0; }
  .irc-undo { color: #b3261e; }
`
