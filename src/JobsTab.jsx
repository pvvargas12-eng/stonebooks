// =============================================================================
// 📚 Stonebooks — Jobs tab (Sprint J1-P1 commit 4: editable)
// =============================================================================
// Operational view of every signed order. One row per job. Click a row to
// open the detail panel; edit milestones, set job-level status, log notes,
// override readiness gates with a logged reason.
//
// The empty state still offers a "Create test job from order" picker; the
// wizard handoff replaces that in commit 6.
//
// Data-layer contracts (commit 2) own readiness gating, override events,
// not_needed cascades, and event log writes. This file is UI only — every
// write goes through stonebooksData.js helpers, and every successful write
// triggers a server refetch (no optimistic state).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase'
import {
  getJobs, getJob, getJobEvents,
  createJobFromOrder,
  updateMilestone, updateMilestoneWithOverride,
  setJobOverallStatus, setNextAction, addJobNote,
  JOB_OVERALL_STATUSES, JOB_MILESTONE_STATUSES, JOB_TEAMS,
  jobStatusInfo, milestoneStatusInfo, teamInfo,
  summarizeMilestonesByGroup, suggestNextActionableMilestone, daysSinceUpdate,
  customerName, fmtDate, fmtRelative, fmtUSD,
  rowGrandTotal, rowTotalPaid,
  SOLD_STATUSES,
} from './lib/stonebooksData'

// ── Milestone group ordering for the table summary columns ───────────────────
const GROUP_ORDER = [
  'intake',
  'design',
  'permit',
  'stone',
  'photo',
  'etching',
  'production',
  'foundation',
  'install',
  'closeout',
]
const GROUP_LABEL = {
  intake:     'Intake',
  design:     'Design',
  permit:     'Permit',
  stone:      'Stone',
  photo:      'Photo',
  etching:    'Etching',
  production: 'Production',
  foundation: 'Foundation',
  install:    'Install',
  closeout:   'Closeout',
}

// =============================================================================
// MAIN
// =============================================================================

export default function JobsTab({ onOpenOrder, onOpenCustomer }) {
  const [jobs, setJobs] = useState(null) // null = loading, [] = empty
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [teamFilter, setTeamFilter] = useState(null)         // single team or null
  const [statusFilter, setStatusFilter] = useState(null)     // single status or null
  const [search, setSearch] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  // Load list
  useEffect(() => {
    let cancelled = false
    setJobs(null)
    const opts = {}
    if (teamFilter)   opts.teamFilter   = [teamFilter]
    if (statusFilter) opts.statusFilter = [statusFilter]
    getJobs(opts).then(rows => {
      if (cancelled) return
      setJobs(rows)
    })
    return () => { cancelled = true }
  }, [teamFilter, statusFilter, reloadCount])

  const triggerReload = () => setReloadCount(c => c + 1)

  // Client-side search filter
  const filteredJobs = useMemo(() => {
    if (!jobs) return null
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(j => {
      const fields = [
        j.order?.order_number,
        j.order?.primary_lastname,
        customerName(j.customer),
        j.cemetery?.name,
        j.next_action,
        (j.order?.service_types || []).join(' '),
      ].filter(Boolean).map(s => String(s).toLowerCase())
      return fields.some(f => f.includes(q))
    })
  }, [jobs, search])

  // Detail view
  if (selectedJobId) {
    return (
      <JobDetail
        jobId={selectedJobId}
        onBack={() => setSelectedJobId(null)}
        onOpenOrder={onOpenOrder}
        onOpenCustomer={onOpenCustomer}
      />
    )
  }

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Operations</div>
        <h1 className="sb-page-title">Jobs</h1>
      </div>

      {/* Backfill banner — surfaces signed orders that don't yet have jobs.
          Disappears automatically when count hits zero. */}
      <BackfillBanner reloadCount={reloadCount} onComplete={triggerReload} />

      {/* Filters */}
      <div className="sb-cust-toolbar">
        <input
          type="text"
          className="sb-input sb-cust-search"
          placeholder="Search by customer, order #, cemetery, next action…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="sb-pill-row">
        <button
          type="button"
          className={`sb-pill ${teamFilter === null ? 'on' : ''}`}
          onClick={() => setTeamFilter(null)}
        >All teams</button>
        <span className="sb-pill-divider" />
        {JOB_TEAMS.map(t => (
          <button
            key={t.code}
            type="button"
            className={`sb-pill ${teamFilter === t.code ? 'on' : ''}`}
            style={{ '--pill-dot': t.color }}
            onClick={() => setTeamFilter(teamFilter === t.code ? null : t.code)}
          >
            <span className="sb-pill-dot" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="sb-pill-row">
        <button
          type="button"
          className={`sb-pill ${statusFilter === null ? 'on' : ''}`}
          onClick={() => setStatusFilter(null)}
        >Any status</button>
        <span className="sb-pill-divider" />
        {JOB_OVERALL_STATUSES.filter(s => s.code !== 'closed').map(s => (
          <button
            key={s.code}
            type="button"
            className={`sb-pill ${statusFilter === s.code ? 'on' : ''}`}
            style={{ '--pill-dot': s.color }}
            onClick={() => setStatusFilter(statusFilter === s.code ? null : s.code)}
          >
            <span className="sb-pill-dot" />
            {s.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filteredJobs === null ? (
        <div className="sb-empty">Loading jobs…</div>
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          hasFilters={!!teamFilter || !!statusFilter || !!search.trim()}
        />
      ) : (
        <>
          <div className="sb-cust-meta">{filteredJobs.length} job{filteredJobs.length === 1 ? '' : 's'}</div>
          <JobsTable
            jobs={filteredJobs}
            onSelectJob={setSelectedJobId}
          />
        </>
      )}
    </div>
  )
}

// =============================================================================
// BACKFILL BANNER — surfaces signed orders that don't yet have jobs
// =============================================================================
// Commit 6 replaces the empty-state "Create test job from order" picker. New
// signings auto-create their jobs via the SalesMode hook; this banner is the
// discoverable recovery path for legacy signed orders that never had a job.
//
// Renders nothing when count is 0. Re-queries on every parent reload so the
// banner disappears as soon as backfill completes. Tags each created job
// with creation_source='backfill' in its job_created event.

function BackfillBanner({ reloadCount, onComplete }) {
  const [pending, setPending] = useState(null)   // null = loading, [] = empty
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total } during a run
  const [error, setError] = useState(null)

  const loadPending = useCallback(async () => {
    setError(null)
    const { data, error: e1 } = await supabase
      .from('orders')
      .select('id, order_number, primary_lastname, service_types, signed_at')
      .not('signed_at', 'is', null)
      .in('status', SOLD_STATUSES)
      .order('signed_at', { ascending: false })
      .limit(200)
    if (e1) { setError(e1.message); setPending([]); return }
    const orderIds = (data || []).map(o => o.id)
    if (orderIds.length === 0) { setPending([]); return }
    const { data: existingJobs, error: e2 } = await supabase
      .from('jobs')
      .select('order_id')
      .in('order_id', orderIds)
    if (e2) { setError(e2.message); setPending([]); return }
    const taken = new Set((existingJobs || []).map(j => j.order_id))
    setPending((data || []).filter(o => !taken.has(o.id)))
  }, [])

  useEffect(() => { loadPending() }, [loadPending, reloadCount])

  const handleBackfillAll = async () => {
    if (!pending || pending.length === 0) return
    setBusy(true); setError(null)
    setProgress({ done: 0, total: pending.length })
    const failures = []
    for (let i = 0; i < pending.length; i++) {
      const o = pending[i]
      const r = await createJobFromOrder(o.id, { source: 'backfill' })
      if (!r.ok) failures.push({ order: o, error: r.error })
      setProgress({ done: i + 1, total: pending.length })
    }
    setBusy(false)
    setProgress(null)
    if (failures.length > 0) {
      setError(`${failures.length} order${failures.length === 1 ? '' : 's'} failed: ${failures.slice(0, 3).map(f => `${f.order.order_number || f.order.id.slice(0,8)} (${f.error})`).join(', ')}${failures.length > 3 ? ' …' : ''}`)
    }
    onComplete?.()
    // loadPending will re-run via reloadCount dependency once parent calls triggerReload
  }

  if (pending === null) return null       // first-load silence
  if (pending.length === 0 && !error) return null // nothing to do, no errors to surface

  return (
    <div className="sb-existing-banner" style={{
      background: 'var(--sb-gold-pale, #f5ede0)',
      border: '0.5px solid var(--sb-gold-light, #b8935a)',
      borderRadius: 'var(--sb-r-sm)',
      padding: '12px 16px',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 13 }}>
        {pending.length > 0 ? (
          <>
            <strong>{pending.length} signed order{pending.length === 1 ? '' : 's'} without {pending.length === 1 ? 'a job' : 'jobs'}.</strong>{' '}
            Backfill creates one job per order using the same template logic as automatic creation on signing.
          </>
        ) : (
          <strong>Backfill check complete.</strong>
        )}
        {progress && (
          <span style={{ marginLeft: 8, fontFamily: 'var(--sb-font-mono)', fontSize: 12, color: 'var(--sb-text-muted)' }}>
            {progress.done} / {progress.total}
          </span>
        )}
        {error && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--sb-red, #b54040)' }}>
            {error}
          </div>
        )}
      </div>
      {pending.length > 0 && (
        <button
          type="button"
          className="sb-btn-secondary"
          onClick={handleBackfillAll}
          disabled={busy}
        >
          {busy ? 'Backfilling…' : `Backfill ${pending.length} order${pending.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ hasFilters }) {
  if (hasFilters) {
    return (
      <div className="sb-empty">
        No jobs match the current filters. Clear filters above to see all jobs.
      </div>
    )
  }
  return (
    <div className="sb-empty">
      <p style={{ marginBottom: 12, fontSize: 14, color: 'var(--sb-text)', fontWeight: 500 }}>
        No jobs yet.
      </p>
      <p>
        Jobs are created automatically when a contract is signed. If signed
        orders exist without jobs, a backfill banner will appear above.
      </p>
    </div>
  )
}

// =============================================================================
// TABLE
// =============================================================================

function JobsTable({ jobs, onSelectJob }) {
  return (
    <div className="sb-jobs-table">
      <div className="sb-jobs-row sb-jobs-row-head">
        <div>Customer</div>
        <div>Service</div>
        <div>Cemetery</div>
        <div>Status</div>
        <div>Progress</div>
        <div>Next action</div>
        <div className="sb-num">Updated</div>
      </div>
      {jobs.map(j => <JobRow key={j.id} job={j} onClick={() => onSelectJob(j.id)} />)}
    </div>
  )
}

function JobRow({ job, onClick }) {
  const customer = job.customer
  const cemetery = job.cemetery
  const order = job.order
  const statusInfo = jobStatusInfo(job.overall_status)
  const days = daysSinceUpdate(job)
  const suggested = job.next_action || suggestSuggestedActionLabel(job.milestones)

  const groupedSummary = useMemo(() => {
    const summary = summarizeMilestonesByGroup(job.milestones)
    const byKey = new Map(summary.map(s => [s.group, s]))
    return GROUP_ORDER
      .map(g => byKey.get(g))
      .filter(Boolean)
  }, [job.milestones])

  return (
    <button type="button" className="sb-jobs-row" onClick={onClick}>
      <div>
        <div className="sb-cust-name">
          {order?.primary_lastname || customerName(customer)}
        </div>
        {order?.order_number && (
          <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)', marginTop: 2 }}>
            {order.order_number}
          </div>
        )}
      </div>

      <div className="sb-cust-location">
        {(order?.service_types || []).join(', ') || '—'}
      </div>

      <div className="sb-cust-location">
        {cemetery?.name || '—'}
      </div>

      <div>
        <span className="sb-status-pill" style={{ '--pill-color': statusInfo.color }}>
          {statusInfo.label}
        </span>
      </div>

      <div className="sb-jobs-progress">
        {groupedSummary.map(s => (
          <GroupBadge key={s.group} summary={s} />
        ))}
      </div>

      <div className="sb-cust-location" style={{ fontSize: 12 }}>
        {suggested || <span className="sb-muted">—</span>}
      </div>

      <div className="sb-num" style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
        {days != null ? `${days}d ago` : '—'}
      </div>
    </button>
  )
}

function suggestSuggestedActionLabel(milestones) {
  const m = suggestNextActionableMilestone(milestones)
  if (!m) return null
  return m.label
}

function GroupBadge({ summary }) {
  const { group, total, done, notNeeded, inProgress, blocked, notStarted } = summary
  const effectiveTotal = total - notNeeded
  let color = 'var(--sb-text-muted)'
  let bg = 'var(--sb-surface-muted)'
  if (blocked > 0) {
    color = 'var(--sb-red)'
    bg = 'var(--sb-red-bg)'
  } else if (effectiveTotal === 0) {
    // entire group is not_needed for this job — show very muted
    color = 'var(--sb-text-muted)'
    bg = 'transparent'
  } else if (done === effectiveTotal) {
    color = 'var(--sb-green)'
    bg = 'var(--sb-green-bg)'
  } else if (inProgress > 0) {
    color = 'var(--sb-accent)'
    bg = 'var(--sb-accent-bg)'
  }
  const label = effectiveTotal === 0
    ? '—'
    : `${done}/${effectiveTotal}`
  return (
    <div
      className="sb-jobs-group-badge"
      title={`${GROUP_LABEL[group] || group}: ${done} done, ${inProgress} in progress, ${notStarted} not started${blocked ? `, ${blocked} blocked` : ''}${notNeeded ? `, ${notNeeded} not needed` : ''}`}
      style={{ '--badge-color': color, '--badge-bg': bg }}
    >
      <div className="sb-jobs-group-label">{(GROUP_LABEL[group] || group).slice(0, 4)}</div>
      <div className="sb-jobs-group-count">{label}</div>
    </div>
  )
}

// =============================================================================
// DETAIL — read-only in this commit
// =============================================================================

function JobDetail({ jobId, onBack, onOpenOrder, onOpenCustomer }) {
  const [job, setJob] = useState(null)
  const [events, setEvents] = useState(null)
  // Override-readiness modal state — set when the data layer rejects a status
  // change with requiresOverride. Confirm calls updateMilestoneWithOverride.
  const [overrideReq, setOverrideReq] = useState(null)

  const loadJob = useCallback(async () => {
    const [j, e] = await Promise.all([getJob(jobId), getJobEvents(jobId)])
    setJob(j)
    setEvents(e)
  }, [jobId])

  useEffect(() => {
    let cancelled = false
    Promise.all([getJob(jobId), getJobEvents(jobId)]).then(([j, e]) => {
      if (cancelled) return
      setJob(j)
      setEvents(e)
    })
    return () => { cancelled = true }
  }, [jobId])

  if (!job) return (
    <div className="sb-page sb-page-wide">
      <BackBar onBack={onBack} />
      <div className="sb-empty">Loading job…</div>
    </div>
  )

  const statusInfo = jobStatusInfo(job.overall_status)
  const order = job.order
  const customer = job.customer
  const cemetery = job.cemetery
  const days = daysSinceUpdate(job)
  const suggested = suggestNextActionableMilestone(job.milestones || [])

  // Milestone grouping
  const byGroup = useMemoGroupMilestones(job.milestones || [])
  const orderedGroups = GROUP_ORDER.filter(g => byGroup.has(g))

  const total = order ? rowGrandTotal(order) : 0
  const paid = order ? rowTotalPaid(order) : 0
  const balance = total - paid

  return (
    <div className="sb-page sb-page-wide">
      <BackBar onBack={onBack} />

      <div className="sb-page-head">
        <div className="sb-page-eyebrow">
          Job · {order?.order_number || job.id.slice(0, 8)}
        </div>
        <h1 className="sb-page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {order?.primary_lastname || customerName(customer)}
          <span className="sb-status-pill" style={{ '--pill-color': statusInfo.color }}>
            {statusInfo.label}
          </span>
        </h1>
        <div className="sb-cust-detail-meta">
          {(order?.service_types || []).length > 0 && (
            <div>
              <div className="sb-meta-label">Service</div>
              <div>{(order.service_types || []).join(', ')}</div>
            </div>
          )}
          {cemetery && (
            <div>
              <div className="sb-meta-label">Cemetery</div>
              <div>{cemetery.name || '—'}</div>
            </div>
          )}
          {order?.target_completion_date && (
            <div>
              <div className="sb-meta-label">Target date</div>
              <div>
                {fmtDate(order.target_completion_date)}
                {order.target_completion_end_date && ` – ${fmtDate(order.target_completion_end_date)}`}
              </div>
            </div>
          )}
          <div>
            <div className="sb-meta-label">Last update</div>
            <div>{days != null ? `${days}d ago` : '—'}</div>
          </div>
          <div>
            <div className="sb-meta-label">Job type</div>
            <div className="sb-mono" style={{ fontSize: 12 }}>{job.job_type}</div>
          </div>
        </div>
      </div>

      {/* Quick jump to the order in Sales Mode */}
      <div className="sb-cust-detail-actions" style={{ flexDirection: 'row', marginBottom: 16 }}>
        {order && (
          <button type="button" className="sb-btn-secondary" onClick={() => onOpenOrder?.(order.id)}>
            Open order in Sales Mode
          </button>
        )}
        {customer && (
          <button type="button" className="sb-btn-secondary" onClick={() => onOpenCustomer?.(customer.id)}>
            View customer
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="sb-metric-grid" style={{ marginBottom: 24 }}>
        <MetricMini label="Next action" value={job.next_action || suggested?.label || '—'} />
        <MetricMini label="Balance" value={balance > 0 ? fmtUSD(balance) : 'Paid'} accent={balance > 0 ? 'amber' : 'green'} />
        <MetricMini label="Milestones done" value={`${countDone(job.milestones)} / ${countEffective(job.milestones)}`} />
        <MetricMini label="Events logged" value={events ? events.length : '…'} />
      </div>

      {/* Job-level controls — overall status, next action, free-form note */}
      <JobControls job={job} suggested={suggested} onRefresh={loadJob} />

      {/* Milestones by group */}
      <div className="sb-section-label">Milestones</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orderedGroups.map(g => (
          <MilestoneGroupCard
            key={g}
            group={g}
            milestones={byGroup.get(g)}
            allMilestones={job.milestones}
            jobId={jobId}
            onRefresh={loadJob}
            onOverrideRequest={setOverrideReq}
          />
        ))}
      </div>

      {/* Event log */}
      <div className="sb-section-label" style={{ marginTop: 24 }}>Recent events</div>
      {events === null ? (
        <div className="sb-empty">Loading…</div>
      ) : events.length === 0 ? (
        <div className="sb-empty">No events recorded for this job yet.</div>
      ) : (
        <EventLog events={events} milestones={job.milestones} />
      )}

      {overrideReq && (
        <OverrideModal
          jobId={jobId}
          request={overrideReq}
          onClose={() => setOverrideReq(null)}
          onConfirmed={() => { setOverrideReq(null); loadJob() }}
        />
      )}
    </div>
  )
}

function BackBar({ onBack }) {
  return (
    <button type="button" className="sb-link" onClick={onBack} style={{ marginBottom: 12 }}>
      ← Back to jobs
    </button>
  )
}

function MetricMini({ label, value, accent }) {
  const cls = accent === 'amber' ? 'sb-metric sb-metric-amber'
            : accent === 'green' ? 'sb-metric sb-metric-green'
            : accent === 'red'   ? 'sb-metric sb-metric-red'
            : 'sb-metric'
  return (
    <div className={cls}>
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value" style={{ fontSize: 16, fontFamily: 'var(--sb-font-sans)' }}>{value}</div>
    </div>
  )
}

function useMemoGroupMilestones(milestones) {
  return useMemo(() => {
    const map = new Map()
    for (const m of milestones) {
      const g = m.group || 'other'
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(m)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    }
    return map
  }, [milestones])
}

function countDone(milestones) {
  return (milestones || []).filter(m => m.status === 'done').length
}
function countEffective(milestones) {
  return (milestones || []).filter(m => m.status !== 'not_needed').length
}

// =============================================================================
// MILESTONE GROUP CARD
// =============================================================================

function MilestoneGroupCard({ group, milestones, allMilestones, jobId, onRefresh, onOverrideRequest }) {
  const [open, setOpen] = useState(true)
  const summary = useMemo(() => {
    const total = milestones.length
    const done = milestones.filter(m => m.status === 'done').length
    const notNeeded = milestones.filter(m => m.status === 'not_needed').length
    const inProgress = milestones.filter(m => m.status === 'in_progress').length
    const blocked = milestones.filter(m => m.status === 'blocked').length
    return { total, done, notNeeded, inProgress, blocked, effective: total - notNeeded }
  }, [milestones])

  return (
    <div className="sb-card" style={{ padding: 0, marginBottom: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '12px 18px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--sb-font-mono)', color: 'var(--sb-text-muted)' }}>
            {open ? '▾' : '▸'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {GROUP_LABEL[group] || group}
          </span>
          <span style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
            {summary.effective === 0
              ? 'not needed'
              : `${summary.done} / ${summary.effective} done${summary.inProgress ? ` · ${summary.inProgress} in progress` : ''}${summary.blocked ? ` · ${summary.blocked} blocked` : ''}`
            }
          </span>
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '0.5px solid var(--sb-border)', padding: '8px 0' }}>
          {milestones.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              allMilestones={allMilestones}
              jobId={jobId}
              onRefresh={onRefresh}
              onOverrideRequest={onOverrideRequest}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MilestoneRow({ milestone, allMilestones, jobId, onRefresh, onOverrideRequest }) {
  const team = milestone.team ? teamInfo(milestone.team) : null
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Readiness check: are any required milestones not yet done?
  const blocking = useMemo(() => {
    if (!milestone.requires || milestone.requires.length === 0) return []
    const byKey = new Map(allMilestones.map(m => [m.milestone_key, m]))
    return milestone.requires.filter(k => {
      const dep = byKey.get(k)
      return dep && dep.status !== 'done' && dep.status !== 'not_needed'
    })
  }, [milestone, allMilestones])

  const isLocked = blocking.length > 0 && milestone.status !== 'done' && milestone.status !== 'not_needed'

  // Status change — advancing statuses go through the readiness gate; the
  // data layer rejects with requiresOverride:true if the milestone isn't ready,
  // and the UI opens the override modal in response.
  const handleStatusChange = async (newStatus) => {
    if (newStatus === milestone.status) return
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { status: newStatus })
    setBusy(false)
    if (res.ok) {
      onRefresh?.()
      return
    }
    if (res.requiresOverride) {
      onOverrideRequest?.({
        milestoneKey: milestone.milestone_key,
        milestoneLabel: milestone.label,
        patch: { status: newStatus },
        blockingKeys: res.blockingKeys || [],
      })
      return
    }
    setError(res.error || 'Update failed')
  }

  const handleDueDateChange = async (e) => {
    const v = e.target.value || null
    if (v === (milestone.due_date || null)) return
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { due_date: v })
    setBusy(false)
    if (res.ok) onRefresh?.()
    else setError(res.error || 'Update failed')
  }

  const handleNoteSave = async () => {
    const text = (noteDraft || '').trim()
    if (!text) { setNoteOpen(false); return }
    setBusy(true); setError(null)
    const res = await updateMilestone(jobId, milestone.milestone_key, { note: text })
    setBusy(false)
    if (res.ok) {
      setNoteDraft('')
      setNoteOpen(false)
      onRefresh?.()
    } else {
      setError(res.error || 'Update failed')
    }
  }

  return (
    <div className="sb-milestone-row" style={{ opacity: isLocked ? 0.7 : 1 }}>
      <div className="sb-milestone-row-main">
        <div>
          <select
            className="sb-status-select"
            value={milestone.status}
            onChange={e => handleStatusChange(e.target.value)}
            disabled={busy}
            style={{ '--pill-color': milestoneStatusInfo(milestone.status).color }}
          >
            {JOB_MILESTONE_STATUSES.map(s => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ color: 'var(--sb-text)', fontWeight: 500 }}>
            {milestone.label}
            {milestone.is_decision && (
              <span style={{ marginLeft: 8, fontSize: 10, fontFamily: 'var(--sb-font-mono)', color: 'var(--sb-text-muted)' }}>
                DECISION
              </span>
            )}
          </div>
          {isLocked && (
            <div style={{ fontSize: 10, color: 'var(--sb-text-muted)', marginTop: 2, fontFamily: 'var(--sb-font-mono)' }}>
              Waiting on: {blocking.join(', ')}
            </div>
          )}
          {milestone.note && (
            <div style={{ fontSize: 11, color: 'var(--sb-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
              {milestone.note}
            </div>
          )}
          <div style={{ marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="button"
              className="sb-link"
              style={{ fontSize: 11, padding: 0 }}
              onClick={() => { setNoteDraft(milestone.note || ''); setNoteOpen(o => !o) }}
            >
              {milestone.note ? 'Edit note' : '+ Add note'}
            </button>
            {error && (
              <span style={{ fontSize: 11, color: 'var(--sb-red)' }}>{error}</span>
            )}
          </div>
        </div>

        <div>
          {team && (
            <span className="sb-status-pill" style={{ '--pill-color': team.color }}>
              {team.label}
            </span>
          )}
        </div>

        <div>
          <input
            type="date"
            className="sb-date-input"
            value={milestone.due_date || ''}
            onChange={handleDueDateChange}
            disabled={busy}
          />
        </div>

        <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
          {milestone.status_date ? fmtDate(milestone.status_date) : '—'}
        </div>
      </div>

      {noteOpen && (
        <div className="sb-milestone-edit-row">
          <textarea
            className="sb-textarea"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Note for this milestone (logged as an event)"
            rows={2}
            disabled={busy}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="sb-btn-primary" onClick={handleNoteSave} disabled={busy}>
              Save note
            </button>
            <button type="button" className="sb-btn-secondary" onClick={() => { setNoteOpen(false); setNoteDraft('') }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// EVENT LOG
// =============================================================================

function EventLog({ events, milestones }) {
  const milestoneByKey = useMemo(() => {
    const m = new Map()
    for (const ms of (milestones || [])) m.set(ms.milestone_key, ms)
    return m
  }, [milestones])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.map(e => (
        <div key={e.id} className="sb-card" style={{ padding: '10px 14px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10,
                fontFamily: 'var(--sb-font-mono)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 'var(--sb-r-sm)',
                background: e.is_override ? 'var(--sb-red-bg)' : 'var(--sb-surface-muted)',
                color: e.is_override ? 'var(--sb-red)' : 'var(--sb-text-muted)',
                fontWeight: 500,
              }}>
                {e.is_override ? 'OVERRIDE' : eventTypeLabel(e.event_type)}
              </span>
              {e.milestone_key && (
                <span style={{ fontSize: 12, color: 'var(--sb-text)' }}>
                  {milestoneByKey.get(e.milestone_key)?.label || e.milestone_key}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
              {fmtRelative(e.created_at)}
            </span>
          </div>
          {renderEventBody(e)}
        </div>
      ))}
    </div>
  )
}

function eventTypeLabel(t) {
  const map = {
    job_created:              'Job created',
    job_closed:               'Job closed',
    job_status_changed:       'Status',
    milestone_status_changed: 'Status',
    milestone_note_added:     'Note',
    milestone_assigned:       'Assigned',
    milestone_due_date_set:   'Due date',
    next_action_set:          'Next action',
    cascade_applied:          'Cascade',
    override:                 'Override',
    note_added:               'Note',
  }
  return map[t] || t
}

function renderEventBody(e) {
  const payload = e.payload || {}
  const parts = []
  if (payload.from !== undefined && payload.to !== undefined) {
    parts.push(`${formatVal(payload.from)} → ${formatVal(payload.to)}`)
  }
  if (payload.affected_keys && Array.isArray(payload.affected_keys)) {
    parts.push(`${payload.affected_keys.length} dependent milestone${payload.affected_keys.length === 1 ? '' : 's'} marked not needed`)
  }
  if (payload.staff_review_required) {
    parts.push('Staff review required: OTHER service type used')
  }
  if (payload.milestone_count !== undefined) {
    parts.push(`${payload.milestone_count} milestone${payload.milestone_count === 1 ? '' : 's'} initialized`)
  }
  if (payload.creation_source) {
    const sourceLabel = payload.creation_source === 'wizard'   ? 'Auto-created on signing'
                      : payload.creation_source === 'backfill' ? 'Backfilled from legacy order'
                      : 'Manual'
    parts.push(sourceLabel)
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--sb-text-secondary)', lineHeight: 1.5 }}>
      {parts.length > 0 && <div className="sb-mono" style={{ fontSize: 11 }}>{parts.join(' · ')}</div>}
      {e.note && <div style={{ marginTop: 4 }}>{e.note}</div>}
      {e.override_reason && (
        <div style={{ marginTop: 4, color: 'var(--sb-red)', fontStyle: 'italic' }}>
          Override reason: {e.override_reason}
        </div>
      )}
    </div>
  )
}

function formatVal(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

// =============================================================================
// JOB-LEVEL CONTROLS
// =============================================================================
// Sits above the milestone list. Three independent panels — overall status
// (with optional note), next action (text + due date), free-form job note.
// All writes go through the data layer and trigger a refetch on success.

function JobControls({ job, suggested, onRefresh }) {
  const [statusDraft, setStatusDraft] = useState(job.overall_status || 'active')
  const [statusNote, setStatusNote] = useState('')
  const [busyStatus, setBusyStatus] = useState(false)
  const [statusErr, setStatusErr] = useState(null)

  // Pre-fill next-action text with the manual value if set, else the
  // suggested-next-actionable milestone label.
  const [actionText, setActionText] = useState(job.next_action || suggested?.label || '')
  const [actionDue, setActionDue] = useState(job.next_action_due || '')
  const [busyAction, setBusyAction] = useState(false)
  const [actionErr, setActionErr] = useState(null)

  const [noteDraft, setNoteDraft] = useState('')
  const [busyNote, setBusyNote] = useState(false)
  const [noteErr, setNoteErr] = useState(null)

  const saveStatus = async () => {
    if (statusDraft === job.overall_status && !statusNote.trim()) return
    setBusyStatus(true); setStatusErr(null)
    const res = await setJobOverallStatus(job.id, statusDraft, statusNote.trim() || null)
    setBusyStatus(false)
    if (res.ok) { setStatusNote(''); onRefresh?.() }
    else setStatusErr(res.error || 'Update failed')
  }

  const saveAction = async () => {
    setBusyAction(true); setActionErr(null)
    const res = await setNextAction(job.id, actionText.trim() || null, actionDue || null)
    setBusyAction(false)
    if (res.ok) onRefresh?.()
    else setActionErr(res.error || 'Update failed')
  }

  const saveNote = async () => {
    const text = noteDraft.trim()
    if (!text) return
    setBusyNote(true); setNoteErr(null)
    const res = await addJobNote(job.id, text)
    setBusyNote(false)
    if (res.ok) { setNoteDraft(''); onRefresh?.() }
    else setNoteErr(res.error || 'Update failed')
  }

  return (
    <div className="sb-card sb-job-controls" style={{ marginBottom: 24 }}>
      <div className="sb-section-label" style={{ margin: 0, marginBottom: 8 }}>Job controls</div>

      <div className="sb-job-controls-grid">
        {/* Overall status */}
        <div>
          <div className="sb-meta-label">Overall status</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <select
              value={statusDraft}
              onChange={e => setStatusDraft(e.target.value)}
              className="sb-status-select"
              disabled={busyStatus}
              style={{ '--pill-color': jobStatusInfo(statusDraft).color, minWidth: 180 }}
            >
              {JOB_OVERALL_STATUSES.map(s => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="sb-btn-primary"
              onClick={saveStatus}
              disabled={busyStatus || (statusDraft === job.overall_status && !statusNote.trim())}
            >Save</button>
          </div>
          <input
            type="text"
            className="sb-text-input"
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            placeholder="Optional note for this status change"
            disabled={busyStatus}
            style={{ marginTop: 6, width: '100%' }}
          />
          {statusErr && <div style={{ fontSize: 11, color: 'var(--sb-red)', marginTop: 4 }}>{statusErr}</div>}
        </div>

        {/* Next action */}
        <div>
          <div className="sb-meta-label">Next action</div>
          <input
            type="text"
            className="sb-text-input"
            value={actionText}
            onChange={e => setActionText(e.target.value)}
            placeholder={suggested?.label ? `Suggested: ${suggested.label}` : 'Describe the next action'}
            disabled={busyAction}
            style={{ marginTop: 4, width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <input
              type="date"
              className="sb-date-input"
              value={actionDue}
              onChange={e => setActionDue(e.target.value)}
              disabled={busyAction}
            />
            <button
              type="button"
              className="sb-btn-primary"
              onClick={saveAction}
              disabled={busyAction}
            >Save</button>
          </div>
          {actionErr && <div style={{ fontSize: 11, color: 'var(--sb-red)', marginTop: 4 }}>{actionErr}</div>}
        </div>

        {/* Free-form note */}
        <div>
          <div className="sb-meta-label">Add a note</div>
          <textarea
            className="sb-textarea"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Free-form note (logged as a job event)"
            rows={2}
            disabled={busyNote}
            style={{ marginTop: 4, width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              className="sb-btn-primary"
              onClick={saveNote}
              disabled={busyNote || !noteDraft.trim()}
            >Log note</button>
          </div>
          {noteErr && <div style={{ fontSize: 11, color: 'var(--sb-red)', marginTop: 4 }}>{noteErr}</div>}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// OVERRIDE MODAL
// =============================================================================
// Opens when a milestone status change is gated by unsatisfied requires[].
// Captures a free-text reason (required by data layer) and calls
// updateMilestoneWithOverride, which writes the override event.

function OverrideModal({ jobId, request, onClose, onConfirmed }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const confirm = async () => {
    const r = reason.trim()
    if (!r) { setError('Reason is required'); return }
    setBusy(true); setError(null)
    const res = await updateMilestoneWithOverride(
      jobId,
      request.milestoneKey,
      request.patch,
      r,
    )
    setBusy(false)
    if (res.ok) onConfirmed?.()
    else setError(res.error || 'Override failed')
  }

  return (
    <div className="sb-modal-backdrop" onClick={onClose}>
      <div className="sb-modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="sb-modal-title">Override readiness gate</div>
        <div className="sb-modal-body">
          <div style={{ marginBottom: 8 }}>
            <strong>{request.milestoneLabel}</strong> isn't ready yet.
          </div>
          <div style={{ fontSize: 12, color: 'var(--sb-text-muted)', marginBottom: 12, fontFamily: 'var(--sb-font-mono)' }}>
            Waiting on: {request.blockingKeys.join(', ')}
          </div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Why are you bypassing? (required — will be logged as an override event)
          </div>
          <textarea
            className="sb-textarea"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Customer urgency · supplier shipped early · scheduling pressure"
            disabled={busy}
            autoFocus
            style={{ width: '100%' }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--sb-red)', marginTop: 6 }}>{error}</div>}
        </div>
        <div className="sb-modal-actions">
          <button type="button" className="sb-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="sb-btn-primary" onClick={confirm} disabled={busy || !reason.trim()}>
            {busy ? 'Saving…' : 'Override and continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES — appended via a single <style> tag at component mount
// =============================================================================

const localStyles = `
  .sb-jobs-table {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    overflow: hidden;
  }
  .sb-jobs-row {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1.2fr 130px 2fr 1.5fr 80px;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 0.5px solid var(--sb-border);
    background: transparent;
    border-left: none; border-right: none; border-top: none;
    font: inherit; color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    align-items: center;
  }
  .sb-jobs-row:hover { background: var(--sb-surface-muted); }
  .sb-jobs-row:last-child { border-bottom: none; }
  .sb-jobs-row-head {
    background: var(--sb-bg);
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    cursor: default;
  }
  .sb-jobs-row-head:hover { background: var(--sb-bg); }

  .sb-jobs-progress {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sb-jobs-group-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3px 7px;
    border-radius: var(--sb-r-sm);
    background: var(--badge-bg, var(--sb-surface-muted));
    color: var(--badge-color, var(--sb-text-muted));
    min-width: 38px;
  }
  .sb-jobs-group-label {
    font-size: 9px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.75;
    line-height: 1;
  }
  .sb-jobs-group-count {
    font-size: 11px;
    font-family: var(--sb-font-mono);
    font-weight: 500;
    margin-top: 2px;
    line-height: 1;
  }

  @media (max-width: 1100px) {
    .sb-jobs-row { grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
    .sb-jobs-row-head { display: none; }
  }

  /* ── Commit 4 additions ────────────────────────────────────────────────── */

  .sb-milestone-row {
    padding: 8px 18px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-milestone-row:last-child { border-bottom: none; }
  .sb-milestone-row-main {
    display: grid;
    grid-template-columns: 150px 1fr 110px 140px 90px;
    gap: 12px;
    align-items: start;
    font-size: 12px;
  }

  .sb-status-select {
    font: inherit;
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 999px;
    border: 0.5px solid var(--pill-color, var(--sb-border));
    color: var(--pill-color, var(--sb-text));
    background: transparent;
    cursor: pointer;
    max-width: 100%;
  }
  .sb-status-select:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--sb-surface-muted);
  }
  .sb-status-select:disabled { opacity: 0.6; cursor: wait; }

  .sb-date-input {
    font: inherit;
    font-size: 11px;
    font-family: var(--sb-font-mono);
    padding: 4px 6px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 130px;
  }
  .sb-date-input:disabled { opacity: 0.6; cursor: wait; }

  .sb-text-input {
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-text-input:focus { outline: none; border-color: var(--sb-accent, var(--sb-text)); }
  .sb-text-input:disabled { opacity: 0.6; cursor: wait; }

  .sb-textarea {
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
    padding: 6px 8px;
    border-radius: var(--sb-r-sm);
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
    resize: vertical;
  }
  .sb-textarea:focus { outline: none; border-color: var(--sb-accent, var(--sb-text)); }
  .sb-textarea:disabled { opacity: 0.6; cursor: wait; }

  .sb-milestone-edit-row {
    margin-top: 8px;
    padding: 8px 18px 4px 18px;
    background: var(--sb-surface-muted);
    border-radius: var(--sb-r-sm);
  }

  .sb-job-controls {
    padding: 16px 18px;
  }
  .sb-job-controls-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 18px;
  }
  @media (max-width: 1000px) {
    .sb-job-controls-grid { grid-template-columns: 1fr; }
    .sb-milestone-row-main { grid-template-columns: 1fr; gap: 6px; }
  }

  .sb-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  .sb-modal-dialog {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    max-width: 520px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  }
  .sb-modal-title {
    padding: 14px 18px;
    border-bottom: 0.5px solid var(--sb-border);
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-modal-body { padding: 14px 18px; }
  .sb-modal-actions {
    padding: 12px 18px;
    border-top: 0.5px solid var(--sb-border);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
`

// Inject styles once when the module loads (similar to how Stonebooks.jsx
// injects shellStyles). Idempotent: only adds the <style> tag if missing.
if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
