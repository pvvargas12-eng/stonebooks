// =============================================================================
// WorkHubScreen — crew Jobs tab: queues built at the desk, run from the field
// =============================================================================
// FIELD-2: one hub with internal sub-navigation ('hub' | 'installs' |
// 'production' | 'foundations' | 'check'). The tiles carry live open counts
// (one Promise.all on mount, each count independent-failure-safe); the sub
// screens are the existing Installs / Production surfaces plus the new phone
// dig list (FoundationsScreen) and an inline check-job list.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { getBatches, getFoundationList, listCheckJobTasks } from '../lib/stonebooksData'
import { todayISO, isoPlusDays } from './fieldShared'
import InstallsScreen from './InstallsScreen'
import ProductionScreen from './ProductionScreen'
import FoundationsScreen from './FoundationsScreen'

// Deterministic chip text from an ISO date (local-midnight parse, no shift).
function dueChipLabel(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return `DUE ${iso}`
  return 'DUE ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
}

export default function WorkHubScreen({ who, undo, onOpenJob, onOpenTask }) {
  const [sub, setSub] = useState('hub')   // 'hub' | 'installs' | 'production' | 'foundations' | 'check'
  const [counts, setCounts] = useState({ installs: null, foundations: null, check: null })
  const [checkTasks, setCheckTasks] = useState(null)

  // One fetch pass for all three counts. The helpers already swallow their own
  // query errors (returning []), and the .catch(() => null) keeps any one
  // failure from taking the other tiles down with it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [batches, fdnList, checks] = await Promise.all([
        getBatches({ from: todayISO(), to: isoPlusDays(13) }).catch(() => null),
        getFoundationList().catch(() => null),
        listCheckJobTasks().catch(() => null),
      ])
      if (cancelled) return
      let installs = null
      if (batches) {
        installs = 0
        for (const b of batches) {
          if (!b || b.status === 'cancelled') continue
          installs += (b.batch_jobs || []).filter(s => s && !s.completed_at).length
        }
      }
      setCounts({
        installs,
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
        <InstallsScreen onOpenJob={(ids) => onOpenJob(ids, 'jobs')} />
      </div>
    )
  }

  if (sub === 'production') {
    return (
      <div>
        {back}
        <ProductionScreen onOpenJob={(ids) => onOpenJob(ids, 'jobs')} undo={undo} />
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
        <div className="fl-greet-sub">Queues built at the desk, run from the field</div>
      </div>
      <div className="fl-tilegrid">
        <button type="button" className="fl-tile" onClick={() => setSub('installs')}>
          <div className="fl-tile-main">
            <div className="fl-tile-name">Installations</div>
            <div className="fl-tile-sub">Next 14 days</div>
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
            <div className="fl-tile-sub">Every active stone</div>
          </div>
          <div className="fl-tile-count">&#8250;</div>
        </button>
      </div>
    </div>
  )
}
