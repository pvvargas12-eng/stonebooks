// =============================================================================
// Settings → Staff — the employees roster (Task Command Center part 1)
// =============================================================================
// CRUD over public.employees. Every name here feeds the "I am" picker, every
// task/promise/batch assignee dropdown, and the actor stamp on every write
// (the lib overlays STAFF_NAMES + TEAM_ROSTER in place after each change).
//
//  • Add employee: name + optional department
//  • Inline rename (old records keep the stamped text they were written with)
//  • Department select (Admin / Design / Sales / Production / Installation)
//  • Remove = deactivate (soft delete — NEVER hard-delete: old stamps must
//    keep resolving). Reactivate lives in a collapsed "Inactive" section.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { listEmployees, addEmployee, updateEmployee, DEPARTMENTS } from '../lib/employees'

export default function StaffSettings({ canEdit = false }) {
  const [rows, setRows] = useState(null)      // null = loading
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDept, setNewDept] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listEmployees())
    } catch (e) {
      setError(e?.message || String(e))
      setRows([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  const run = async (fn, note) => {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setError(r.error); return false }
    await load()
    if (note) flash(note)
    return true
  }

  const onAdd = async () => {
    const name = newName.trim()
    if (!name) return
    const ok = await run(() => addEmployee({ name, department: newDept || null }), `${name} added`)
    if (ok) { setNewName(''); setNewDept('') }
  }

  const active = (rows || []).filter(r => r.is_active)
  const inactive = (rows || []).filter(r => !r.is_active)

  if (rows === null) return <div className="sb-helper">Loading roster…</div>

  return (
    <div className="sb-emp-wrap">
      <div className="sb-helper">
        These names feed the "I am" picker, every task and assignee dropdown, and the
        stamp on every payment, note, and status change.
      </div>

      {msg && <div className="sb-msg sb-msg-ok">{msg}</div>}
      {error && <div className="sb-msg sb-msg-err">{error}</div>}

      <div className="sb-emp-list">
        {active.map(r => (
          <EmployeeRow key={r.id} row={r} canEdit={canEdit} busy={busy} run={run} />
        ))}
        {active.length === 0 && <div className="sb-helper">No active employees — add one below.</div>}
      </div>

      {canEdit && (
        <div className="sb-emp-add">
          <input
            type="text"
            className="sb-input"
            placeholder="Employee name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAdd() }}
            disabled={busy}
          />
          <select className="sb-input sb-emp-dept" value={newDept} onChange={e => setNewDept(e.target.value)} disabled={busy}>
            <option value="">No department</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="button" className="sb-btn-primary" onClick={onAdd} disabled={busy || !newName.trim()}>
            Add employee
          </button>
        </div>
      )}
      {!canEdit && (
        <div className="sb-helper">The roster is owner-managed. Ask the owner to add or remove people.</div>
      )}

      {inactive.length > 0 && (
        <div className="sb-emp-inactive">
          <button type="button" className="sb-link" onClick={() => setShowInactive(v => !v)}>
            {showInactive ? 'Hide' : 'Show'} inactive ({inactive.length})
          </button>
          {showInactive && inactive.map(r => (
            <div key={r.id} className="sb-emp-row sb-emp-row-off">
              <span className="sb-emp-name-off">{r.name}</span>
              <span className="sb-emp-dept-tag">{r.department || ''}</span>
              {canEdit && (
                <button type="button" className="sb-link" disabled={busy}
                  onClick={() => run(() => updateEmployee(r.id, { isActive: true }), `${r.name} reactivated`)}>
                  Reactivate
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{CSS}</style>
    </div>
  )
}

function EmployeeRow({ row, canEdit, busy, run }) {
  const [name, setName] = useState(row.name)
  useEffect(() => { setName(row.name) }, [row.name])

  const commitName = () => {
    const n = name.trim()
    if (!n || n === row.name) { setName(row.name); return }
    run(() => updateEmployee(row.id, { name: n }), 'Renamed')
  }

  if (!canEdit) {
    return (
      <div className="sb-emp-row">
        <span className="sb-emp-name-ro">{row.name}</span>
        <span className="sb-emp-dept-tag">{row.department || 'No department'}</span>
      </div>
    )
  }

  return (
    <div className="sb-emp-row">
      <input
        type="text"
        className="sb-input sb-emp-name"
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        disabled={busy}
      />
      <select
        className="sb-input sb-emp-dept"
        value={row.department || ''}
        onChange={e => run(() => updateEmployee(row.id, { department: e.target.value || null }))}
        disabled={busy}
      >
        <option value="">No department</option>
        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      {/* FIELD-2: which build the phone app gives this person */}
      <label className="sb-emp-owner" title="Owner build shows money on the phone app; crew build never does.">
        <input
          type="checkbox"
          checked={!!row.is_owner}
          disabled={busy}
          onChange={e => run(
            () => updateEmployee(row.id, { isOwner: e.target.checked }),
            `${row.name} ${e.target.checked ? 'now gets the owner phone app' : 'now gets the crew phone app'}`
          )}
        />
        Owner app
      </label>
      <button
        type="button"
        className="sb-link sb-link-danger"
        disabled={busy}
        onClick={() => {
          if (!confirm(`Remove ${row.name} from the roster? Their name stays on everything they already did.`)) return
          run(() => updateEmployee(row.id, { isActive: false }), `${row.name} removed`)
        }}
      >
        Remove
      </button>
    </div>
  )
}

const CSS = `
.sb-emp-wrap { display: flex; flex-direction: column; gap: 12px; }
.sb-emp-list { display: flex; flex-direction: column; gap: 6px; }
.sb-emp-row { display: flex; align-items: center; gap: 10px; }
.sb-emp-row-off { opacity: 0.7; padding: 4px 0; }
.sb-emp-name { flex: 1; max-width: 220px; }
.sb-emp-name-ro { flex: 1; max-width: 220px; font-weight: 500; }
.sb-emp-name-off { flex: 1; max-width: 220px; text-decoration: line-through; }
.sb-emp-dept { width: 170px; }
.sb-emp-owner { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: 0.9; white-space: nowrap; cursor: pointer; }
.sb-emp-dept-tag { width: 170px; opacity: 0.75; font-size: 13px; }
.sb-emp-add { display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(128,128,128,0.25); }
.sb-emp-add .sb-input { max-width: 220px; }
.sb-emp-inactive { padding-top: 4px; display: flex; flex-direction: column; gap: 4px; }
`
