// =============================================================================
// 📚 Stonebooks — Jobs tab (read-only, Sprint J1-P1 commit 3)
// =============================================================================
// Operational view of every signed order. One row per job. Click a row to
// open a read-only detail panel showing all milestones and the event log.
//
// This commit is READ-ONLY. No status changes, no notes, no overrides — those
// come in commit 4. The empty state offers a "Create test job from order"
// picker so you can see real data before commit 6 wires up the wizard handoff.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase'
import {
  getJobs, getJob, getJobEvents,
  createJobFromOrder,
  JOB_OVERALL_STATUSES, JOB_TEAMS,
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
          onReload={triggerReload}
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
// EMPTY STATE — with throwaway "Create test job" picker (removed in commit 6)
// =============================================================================

function EmptyState({ hasFilters, onReload }) {
  const [signedOrders, setSignedOrders] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadSignedOrders = async () => {
    setSignedOrders(null)
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, primary_lastname, service_types, signed_at, customer:customers(first_name, last_name)')
      .not('signed_at', 'is', null)
      .in('status', SOLD_STATUSES)
      .order('signed_at', { ascending: false })
      .limit(50)
    if (error) {
      setMsg({ type: 'err', text: error.message })
      setSignedOrders([])
      return
    }
    // Filter out orders that already have a job
    const orderIds = (data || []).map(o => o.id)
    if (orderIds.length === 0) { setSignedOrders([]); return }
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('order_id')
      .in('order_id', orderIds)
    const taken = new Set((existingJobs || []).map(j => j.order_id))
    setSignedOrders((data || []).filter(o => !taken.has(o.id)))
  }

  const handleOpenPicker = () => {
    setPickerOpen(true)
    setMsg(null)
    loadSignedOrders()
  }

  const handleCreate = async (orderId) => {
    setCreating(true); setMsg(null)
    const r = await createJobFromOrder(orderId)
    setCreating(false)
    if (!r.ok) {
      setMsg({ type: 'err', text: r.error })
      return
    }
    setMsg({
      type: 'ok',
      text: r.alreadyExisted
        ? 'A job already existed for that order — loaded it.'
        : 'Job created.',
    })
    onReload()
    setPickerOpen(false)
  }

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
      <p style={{ marginBottom: 12 }}>
        Jobs appear here once signed orders flow through the operations pipeline.
        The full wizard handoff lands in a later commit — until then, you can
        create test jobs from existing signed orders to preview the workflow.
      </p>

      {!pickerOpen ? (
        <button type="button" className="sb-btn-secondary" onClick={handleOpenPicker}>
          Create test job from order
        </button>
      ) : (
        <div style={{
          marginTop: 16,
          padding: 16,
          background: 'var(--sb-bg)',
          border: '0.5px solid var(--sb-border)',
          borderRadius: 'var(--sb-r-md)',
        }}>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--sb-text-muted)' }}>
            Pick a signed order to instantiate as a job. Orders that already have a job are excluded.
          </div>

          {signedOrders === null ? (
            <div style={{ fontSize: 12, color: 'var(--sb-text-muted)' }}>Loading orders…</div>
          ) : signedOrders.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--sb-text-muted)' }}>
              No signed orders are available. Either none exist yet, or all of them already have a job.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
              {signedOrders.map(o => (
                <button
                  key={o.id}
                  type="button"
                  disabled={creating}
                  onClick={() => handleCreate(o.id)}
                  style={{
                    background: 'var(--sb-surface)',
                    border: '0.5px solid var(--sb-border)',
                    borderRadius: 'var(--sb-r-sm)',
                    padding: '8px 12px',
                    textAlign: 'left',
                    cursor: creating ? 'not-allowed' : 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                    opacity: creating ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {o.order_number || '(no #)'} — {o.primary_lastname || customerName(o.customer)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', marginTop: 2, fontFamily: 'var(--sb-font-mono)' }}>
                    {(o.service_types || []).join(', ')} · signed {fmtRelative(o.signed_at)}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="sb-link" onClick={() => setPickerOpen(false)}>Cancel</button>
          </div>

          {msg && <div className={`sb-msg sb-msg-${msg.type}`} style={{ marginTop: 8 }}>{msg.text}</div>}
        </div>
      )}
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

      {/* Milestones by group */}
      <div className="sb-section-label">Milestones</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orderedGroups.map(g => (
          <MilestoneGroupCard
            key={g}
            group={g}
            milestones={byGroup.get(g)}
            allMilestones={job.milestones}
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

      <div className="sb-helper" style={{ marginTop: 24 }}>
        Read-only view. Editing milestones, adding notes, and overrides arrive in the next commit.
      </div>
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

function MilestoneGroupCard({ group, milestones, allMilestones }) {
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
            <MilestoneRow key={m.id} milestone={m} allMilestones={allMilestones} />
          ))}
        </div>
      )}
    </div>
  )
}

function MilestoneRow({ milestone, allMilestones }) {
  const statusInfo = milestoneStatusInfo(milestone.status)
  const team = milestone.team ? teamInfo(milestone.team) : null

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

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr 110px 90px 90px',
      gap: 12,
      padding: '8px 18px',
      alignItems: 'center',
      fontSize: 12,
      opacity: isLocked ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="sb-status-pill" style={{ '--pill-color': statusInfo.color }}>
          {statusInfo.label}
        </span>
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
      </div>

      <div>
        {team && (
          <span className="sb-status-pill" style={{ '--pill-color': team.color }}>
            {team.label}
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
        {milestone.due_date ? fmtDate(milestone.due_date) : '—'}
      </div>

      <div style={{ fontSize: 11, color: 'var(--sb-text-muted)', fontFamily: 'var(--sb-font-mono)' }}>
        {milestone.status_date ? fmtDate(milestone.status_date) : '—'}
      </div>
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
`

// Inject styles once when the module loads (similar to how Stonebooks.jsx
// injects shellStyles). Idempotent: only adds the <style> tag if missing.
if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
