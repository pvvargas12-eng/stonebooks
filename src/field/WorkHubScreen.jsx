// =============================================================================
// WorkHubScreen — crew Jobs tab: queues built and RUN from the phone
// =============================================================================
// FIELD-JOBS-1 (Paul, 2026-07-24): the hub's sections are his work lists —
// Installations (set list), Foundations (dig list, buildable, base L×W +
// section on every row), Inscriptions,
// Check jobs. Production opens the REAL floor (ProductionFloorScreen — the
// hand-picked component queues, contracted work only); the old "every active
// stone" finder with its All default and LEAD rows is deleted. Leads belong in
// Check jobs and nowhere else on this tab.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { getInstallList, getFoundationList, listCheckJobTasks } from '../lib/stonebooksData'
import { todayISO } from './fieldShared'
import InstallListScreen from './InstallListScreen'
import ProductionFloorScreen from './ProductionFloorScreen'
import FoundationsScreen from './FoundationsScreen'
import InscriptionsScreen from './InscriptionsScreen'

// Deterministic chip text from an ISO date (local-midnight parse, no shift).
function dueChipLabel(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return `DUE ${iso}`
  return 'DUE ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
}

export default function WorkHubScreen({ who, undo, onOpenJob, onOpenTask, onComplete }) {
  const [sub, setSub] = useState('hub')   // 'hub' | 'installs' | 'foundations' | 'inscriptions' | 'check' | 'production'
  const [counts, setCounts] = useState({ installs: null, foundations: null, check: null })
  const [checkTasks, setCheckTasks] = useState(null)

  // One fetch pass for the tile counts; each independent-failure-safe so one
  // broken query never takes the other tiles down.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [setList, fdnList, checks] = await Promise.all([
        getInstallList().catch(() => null),
        getFoundationList().catch(() => null),
        listCheckJobTasks().catch(() => null),
      ])
      if (cancelled) return
      setCounts({
        installs: setList ? setList.length : null,
        foundations: fdnList ? fdnList.length : null,
        check: checks ? checks.filter(t => t.status !== 'done').length : null,
      })
      setCheckTasks(checks || [])
    })()
    return () => { cancelled = true }
  }, [])

  const today = useMemo(() => todayISO(), [])

  const back = (
    <button type="button" className="fl-rowline" onClick={() => setSub('hub')}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Work</span>
    </button>
  )

  if (sub === 'installs') {
    return (
      <div>
        {back}
        <InstallListScreen onOpenJob={onOpenJob} onComplete={onComplete} />
      </div>
    )
  }

  if (sub === 'foundations') {
    return (
      <div>
        {back}
        <FoundationsScreen onOpenJob={(ids) => onOpenJob(ids, 'jobs')} />
      </div>
    )
  }

  if (sub === 'inscriptions') {
    return (
      <div>
        {back}
        <InscriptionsScreen onOpenJob={(ids) => onOpenJob(ids, 'jobs')} />
      </div>
    )
  }

  if (sub === 'production') {
    return (
      <div>
        {back}
        <ProductionFloorScreen who={who} undo={undo} onOpenJob={(ids) => onOpenJob(ids, 'jobs')} />
      </div>
    )
  }

  if (sub === 'check') {
    return (
      <div>
        {back}
        <div className="fl-sect">
          <span className="fl-sect-h">Check jobs</span>
          {counts.check != null && <span className="fl-sect-pill">{counts.check}</span>}
        </div>
        {checkTasks === null && <div className="fl-empty">Loading check jobs…</div>}
        {checkTasks !== null && checkTasks.length === 0 && (
          <div className="fl-empty">No check jobs on the board.</div>
        )}
        {(checkTasks || []).map(t => {
          const done = t.status === 'done'
          const overdue = !done && t.due_date && t.due_date < today
          return (
            <button key={t.id} type="button" className="fl-row" onClick={() => onOpenTask(t.id)}>
              <div className={`fl-fam${done ? ' fl-task-done' : ''}`} style={{ fontSize: 14.5 }}>
                {t.title || 'Check job'}
              </div>
              {t.details?.cemeteryName && <div className="fl-cem">{t.details.cemeteryName}</div>}
              <div className="fl-chips">
                {done && <span className="fl-chip fl-c-good">DONE</span>}
                {!done && t.due_date && (
                  <span className={`fl-chip ${overdue ? 'fl-c-bad' : t.due_date === today ? 'fl-c-warn' : 'fl-c-neutral'}`}>
                    {dueChipLabel(t.due_date)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  // ── The hub ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Work</div>
        <div className="fl-greet-sub">Your lists — built here, run here</div>
      </div>
      <div className="fl-tilegrid">
        <button type="button" className="fl-tile" onClick={() => setSub('installs')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Installations</div>
            <div className="fl-tile-sub">The set list</div>
          </div>
          <div className="fl-tile-count">{counts.installs == null ? '…' : counts.installs}</div>
        </button>
        <button type="button" className="fl-tile" onClick={() => setSub('foundations')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Foundations</div>
            <div className="fl-tile-sub">The dig list</div>
          </div>
          <div className="fl-tile-count">{counts.foundations == null ? '…' : counts.foundations}</div>
        </button>
        <button type="button" className="fl-tile" onClick={() => setSub('inscriptions')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Inscriptions</div>
            <div className="fl-tile-sub">Cemetery lettering</div>
          </div>
          <div className="fl-tile-count">&#8250;</div>
        </button>
        <button type="button" className="fl-tile" onClick={() => setSub('check')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Check jobs</div>
            <div className="fl-tile-sub">Site inspections</div>
          </div>
          <div className="fl-tile-count">{counts.check == null ? '…' : counts.check}</div>
        </button>
        <button type="button" className="fl-tile" onClick={() => setSub('production')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Production</div>
            <div className="fl-tile-sub">The floor — your queues</div>
          </div>
          <div className="fl-tile-count">&#8250;</div>
        </button>
      </div>
    </div>
  )
}
