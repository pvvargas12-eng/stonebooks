// =============================================================================
// FoundationFormModal — the Foundation E-Form, desktop (FDN-EFORM, 2026-09-17)
// =============================================================================
// Paul's paper FOUNDATION sheet as a modal off the dig list. Text fields
// prefill from the order (permit autofill resolvers); the circled picks —
// grave config, cremains/full body, veteran temp marker, stone type — are the
// operator's and gate the Save button (foundationFormComplete). Saved data
// lands in foundation_forms keyed by job; the dig-list chips + the field app
// read the same row.
// =============================================================================
import { useState, useMemo } from 'react'
import { saveFoundationForm } from '../lib/stonebooksData'
import {
  FDN_TEXT_FIELDS, FDN_PICK_FIELDS, FDN_REQUIRED_PICKS,
  prefillFoundationForm, foundationFormComplete,
} from '../lib/foundationForm'
import { rowToOrder } from '../SalesMode'

export default function FoundationFormModal({ job, existing, onSaved, onClose }) {
  const initial = useMemo(() => {
    if (existing?.data && Object.keys(existing.data).length) return existing.data
    try {
      const mapped = rowToOrder(job.order, job.customer || job.order?.customer, job.cemetery || job.order?.cemetery)
      return prefillFoundationForm(mapped)
    } catch { return prefillFoundationForm(null) }
  }, [job, existing])

  const [data, setData] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setData(d => ({ ...d, [k]: v }))
  const complete = foundationFormComplete(data)

  const save = async () => {
    if (!complete || busy) return
    setBusy(true); setErr(null)
    const r = await saveFoundationForm(job.id, job.order?.id || job.order_id || null, data)
    setBusy(false)
    if (!r.ok) { setErr(r.error || 'Save failed'); return }
    onSaved?.(job.id, data)
  }

  return (
    <div className="fdnform-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{CSS}</style>
      <div className="fdnform" role="dialog" aria-label="Foundation E-Form">
        <div className="fdnform-head">
          <div>
            <div className="fdnform-eyebrow">FOUNDATION E-FORM</div>
            <div className="fdnform-title">
              {job.order?.primary_lastname || '—'}
              <span className="fdnform-num">{job.order?.order_number || ''}</span>
            </div>
            {existing?.completed_at && (
              <div className="fdnform-stamp">
                Filed {new Date(existing.completed_at).toLocaleDateString()} by {existing.completed_by || '—'}
              </div>
            )}
          </div>
          <button type="button" className="fdnform-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <div className="fdnform-err">{err}</div>}

        <div className="fdnform-grid">
          {FDN_TEXT_FIELDS.map(f => (
            <label key={f.key} className="fdnform-field">
              <span className="fdnform-label">{f.label}</span>
              <input
                className="fdnform-input" type="text"
                value={data[f.key] || ''}
                onChange={e => set(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>

        {FDN_PICK_FIELDS.map(f => (
          <div key={f.key} className="fdnform-pickrow">
            <span className={`fdnform-label${FDN_REQUIRED_PICKS.includes(f.key) && !data[f.key] ? ' need' : ''}`}>
              {f.label}{FDN_REQUIRED_PICKS.includes(f.key) ? ' *' : ''}
            </span>
            <div className="fdnform-picks">
              {f.options.map(([code, label]) => (
                <button key={code} type="button"
                  className={`fdnform-pick${data[f.key] === code ? ' on' : ''}`}
                  onClick={() => set(f.key, data[f.key] === code ? '' : code)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {data.must_have_map === 'Y' && (
          <label className="fdnform-field" style={{ marginTop: 8 }}>
            <span className="fdnform-label">Map note</span>
            <input className="fdnform-input" type="text" value={data.map_note || ''}
              placeholder="Where the map is / what it must show"
              onChange={e => set('map_note', e.target.value)} />
          </label>
        )}

        <div className="fdnform-actions">
          <div className="fdnform-hint">
            {complete ? 'All required picks made.' : 'Make the * picks — no foundation gets done without this form.'}
          </div>
          <button type="button" className="fdnform-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="fdnform-btn save" onClick={save} disabled={busy || !complete}>
            {busy ? 'Saving…' : 'Save E-Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .fdnform-scrim { position: fixed; inset: 0; background: rgba(10,12,16,0.62); z-index: 1000;
    display: flex; align-items: flex-start; justify-content: center; padding: 5vh 16px 16px; overflow-y: auto; }
  .fdnform { background: #11151c; border: 1px solid #2a313c; border-radius: 14px; color: #e6e9ef;
    width: 100%; max-width: 680px; padding: 20px 22px 18px;
    font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif; }
  .fdnform-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
  .fdnform-eyebrow { font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; color: #e7c86a; }
  .fdnform-title { font-size: 19px; font-weight: 700; color: #f4f6fa; margin-top: 2px; }
  .fdnform-num { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #6f7a8a; margin-left: 10px; }
  .fdnform-stamp { font-size: 11.5px; color: #34d399; margin-top: 3px; }
  .fdnform-x { font: inherit; font-size: 22px; line-height: 1; background: none; border: none; color: #8b95a5; cursor: pointer; padding: 2px 6px; }
  .fdnform-x:hover { color: #f4f6fa; }
  .fdnform-err { background: #1c1416; border: 1px solid #5c2a2a; color: #f87171; padding: 9px 12px; border-radius: 9px; margin-bottom: 12px; font-size: 13px; }

  .fdnform-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-bottom: 14px; }
  .fdnform-field { display: flex; flex-direction: column; gap: 4px; }
  .fdnform-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8b95a5; }
  .fdnform-label.need { color: #fbbf24; }
  .fdnform-input { font: inherit; font-size: 13.5px; padding: 8px 10px; border-radius: 8px;
    border: 1px solid #2a313c; background: #0E1116; color: #e6e9ef; width: 100%; }
  .fdnform-input:focus { outline: none; border-color: #6b5310; }

  .fdnform-pickrow { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-top: 1px solid #1c222b; flex-wrap: wrap; }
  .fdnform-pickrow .fdnform-label { min-width: 170px; }
  .fdnform-picks { display: flex; gap: 6px; flex-wrap: wrap; }
  .fdnform-pick { font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 999px;
    border: 1px solid #2a313c; background: #151a22; color: #8b95a5; cursor: pointer; white-space: nowrap; }
  .fdnform-pick:hover { border-color: #3a4452; color: #e6e9ef; }
  .fdnform-pick.on { background: #2a2210; border-color: #8a6c15; color: #e7c86a; font-weight: 700; }

  .fdnform-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  .fdnform-hint { font-size: 12px; color: #8b95a5; margin-right: auto; }
  .fdnform-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 9px;
    border: 1px solid #2a313c; background: #1a212b; color: #e6e9ef; cursor: pointer; }
  .fdnform-btn:disabled { opacity: 0.5; cursor: default; }
  .fdnform-btn.ghost { background: transparent; color: #8b95a5; }
  .fdnform-btn.save { border-color: #6b5310; background: #2a2210; color: #e7c86a; }
  .fdnform-btn.save:not(:disabled):hover { background: #362c14; border-color: #8a6c15; }

  @media (max-width: 640px) {
    .fdnform-grid { grid-template-columns: 1fr; }
    .fdnform-pickrow .fdnform-label { min-width: 0; width: 100%; }
  }
`
