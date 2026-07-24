// =============================================================================
// SandblastScreen — trade blasting queue on the phone (FIELD-JOBS-1)
// =============================================================================
// Paul 2026-07-24: "in stonebooks field my jobs tab... i want sandblasting
// section." Phone twin of the desktop Jobs › Sandblasting board: every
// vendor_items row with work_type 'blasting', grouped by partner, stepping the
// SAME ladder (lib/blastLadder) through updateVendorItem — Vendors, the trade
// portal, and both boards read one truth. ADVANCE commits instantly with the
// field's 8s undo (inverse step); deep edits stay at the desk.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { listVendorItems, updateVendorItem } from '../lib/vendorsData'
import { BLAST_ACTIVE, BLAST_NEXT, BLAST_PREV, BLAST_TONE, blastLabel } from '../lib/blastLadder'

export default function SandblastScreen({ who, undo }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const all = await listVendorItems()
      setItems((all || []).filter(i => i.work_type === 'blasting'))
      setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the blast queue.') }
  }, [])
  useEffect(() => { load() }, [load])

  const active = useMemo(() => (items || []).filter(i => BLAST_ACTIVE.includes(i.status)), [items])

  const groups = useMemo(() => {
    const byPartner = new Map()
    for (const i of active) {
      const key = i.request?.partner?.company_name || 'No partner on file'
      if (!byPartner.has(key)) byPartner.set(key, [])
      byPartner.get(key).push(i)
    }
    return [...byPartner.entries()].sort((a, z) => a[0].localeCompare(z[0]))
  }, [active])

  // Step the ladder; undo steps it straight back (append-only vendor events on
  // both writes — the trail stays honest).
  const step = async (item, dir) => {
    const to = dir === 'next' ? BLAST_NEXT[item.status] : BLAST_PREV[item.status]
    if (!to || busyId) return
    const from = item.status
    setBusyId(item.id)
    const r = await updateVendorItem(item.id, { status: to }, { actor: who?.name || null })
    setBusyId(null)
    if (!r.ok) { undo?.showError(r.error || 'That move failed.'); return }
    setItems(list => (list || []).map(x => (x.id === item.id ? { ...x, status: to } : x)))
    undo?.show(`${blastLabel(to)} — ${item.deceased_family_name || item.vendor_reference || 'stone'}`, async () => {
      await updateVendorItem(item.id, { status: from }, { actor: who?.name || null })
      setItems(list => (list || []).map(x => (x.id === item.id ? { ...x, status: from } : x)))
    })
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (items === null) return <div className="fl-empty">Loading the blast queue…</div>

  return (
    <div>
      <div className="fl-sect">
        <span className="fl-sect-h">Sandblasting</span>
        <span className="fl-sect-pill">{active.length}</span>
      </div>
      {active.length === 0 && (
        <div className="fl-empty">Nothing in the blast room — partner requests land here when submitted.</div>
      )}
      {groups.map(([partner, rows]) => (
        <div key={partner}>
          <div className="fl-daylabel"><b>{partner}</b> · {rows.length}</div>
          {rows.map(i => {
            const fam = i.deceased_family_name || i.request?.family_name || i.vendor_reference || 'Stone'
            const spec = [i.stone_size && `Stone ${i.stone_size}`, i.base_size && `Base ${i.base_size}`, i.color]
              .filter(Boolean).join(' · ')
            return (
              <div key={i.id} className="fl-row fl-row-flex" style={{ cursor: 'default' }}>
                <div className="fl-row-main">
                  <div className="fl-fam">{String(fam).toUpperCase()}</div>
                  <div className="fl-spec">{spec || i.item_notes || '—'}</div>
                  <div className="fl-chips" style={{ marginTop: 6 }}>
                    <span className="fl-chip" style={{ color: BLAST_TONE[i.status], borderColor: BLAST_TONE[i.status] }}>
                      {blastLabel(i.status).toUpperCase()}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0 }}>
                  {BLAST_NEXT[i.status] && (
                    <button type="button" className="fl-verb" disabled={busyId === i.id}
                      style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                      onClick={() => step(i, 'next')}>
                      {i.status === 'ready_for_pickup' ? 'PICKED UP' : 'ADVANCE'}
                    </button>
                  )}
                  {BLAST_PREV[i.status] && (
                    <button type="button" className="fl-verb" disabled={busyId === i.id}
                      onClick={() => step(i, 'prev')}>
                      BACK
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
