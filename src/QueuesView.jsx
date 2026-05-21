// =============================================================================
// Stonebooks — Queues view (Sprint J1-P1 follow-up, Commit 2)
// =============================================================================
// Operational queues — filtered milestone lenses across all active jobs.
// Presentation-only: every queue row's membership, section assignment, and
// sort comes from deriveLayoutsQueueRows / deriveWaitingOnCustomerQueueRows
// in stonebooksData.js. This file contains NO milestone_key pattern matching
// and NO classification logic. If you find yourself reaching for
// milestone.milestone_key here, stop — add an abstraction-layer helper instead.
//
// Mounted by JobsTab when viewMode === 'queues'. Right-side row affordance
// area is reserved for future comms-draft buttons (Gmail-aware follow-up).
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getJobs,
  deriveLayoutsQueueRows,
  deriveStonesQueueRows,
  deriveWaitingOnCustomerQueueRows,
  teamInfo,
  jobStatusInfo,
  fmtDate,
} from './lib/stonebooksData'

// Static section metadata for the Layouts queue. Section codes come from the
// data layer (deriveLayoutsQueueRows assigns row.section); this map provides
// the human label and order.
const LAYOUTS_SECTIONS = [
  { code: 'needs_drawing',    label: 'Needs layout drawing' },
  { code: 'awaiting_approval', label: 'Awaiting customer approval' },
  { code: 'ready_to_advance', label: 'Approved, ready to advance' },
  { code: 'blocked',          label: 'Blocked' },
]

// Static section metadata for the Stones queue. Section codes come from the
// data layer (deriveStonesQueueRows assigns row.section); this map provides
// the human label and order. The "Received / awaiting production" section
// surfaces stone_received-done rows whose downstream production milestone
// hasn't moved — handoff drift, not the production work itself.
const STONES_SECTIONS = [
  { code: 'to_order',                     label: 'To order' },
  { code: 'ordered_awaiting_supplier',    label: 'Ordered, awaiting supplier' },
  { code: 'received_awaiting_production', label: 'Received / awaiting production' },
  { code: 'blocked',                      label: 'Blocked' },
]

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export default function QueuesView({ activeQueue, onSelectQueue, onOpenJob }) {
  const [jobs, setJobs] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  const loadJobs = useCallback(async () => {
    setLoadErr(null)
    try {
      const data = await getJobs({ includeClosed: false })
      setJobs(data || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load jobs')
      setJobs([])
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  const layoutsRows = useMemo(
    () => deriveLayoutsQueueRows(jobs || []),
    [jobs],
  )
  const stonesRows = useMemo(
    () => deriveStonesQueueRows(jobs || []),
    [jobs],
  )
  const waitingRows = useMemo(
    () => deriveWaitingOnCustomerQueueRows(jobs || []),
    [jobs],
  )

  const counts = {
    layouts: layoutsRows.length,
    stones: stonesRows.length,
    waiting_on_customer: waitingRows.length,
  }

  return (
    <div>
      <QueuePicker
        active={activeQueue}
        counts={counts}
        onSelect={onSelectQueue}
      />

      {jobs === null && (
        <div className="sb-empty">Loading queues…</div>
      )}

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>
          {loadErr}
        </div>
      )}

      {jobs !== null && !loadErr && activeQueue === 'layouts' && (
        <LayoutsQueue rows={layoutsRows} onOpenJob={onOpenJob} />
      )}

      {jobs !== null && !loadErr && activeQueue === 'stones' && (
        <StonesQueue rows={stonesRows} onOpenJob={onOpenJob} />
      )}

      {jobs !== null && !loadErr && activeQueue === 'waiting_on_customer' && (
        <WaitingOnCustomerQueue rows={waitingRows} onOpenJob={onOpenJob} />
      )}
    </div>
  )
}

// =============================================================================
// QUEUE PICKER — segmented tab strip with live count badges
// =============================================================================

function QueuePicker({ active, counts, onSelect }) {
  const tabs = [
    { code: 'layouts',             label: 'Layouts' },
    { code: 'stones',              label: 'Stones' },
    { code: 'waiting_on_customer', label: 'Waiting on customer' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      {tabs.map(t => {
        const isActive = t.code === active
        return (
          <button
            key={t.code}
            type="button"
            onClick={() => onSelect?.(t.code)}
            style={{
              padding: '8px 14px',
              border: '0.5px solid var(--sb-border)',
              borderRadius: 'var(--sb-r-sm)',
              background: isActive ? 'var(--sb-surface-elevated, #f5ede0)' : 'transparent',
              color: isActive ? 'var(--sb-text)' : 'var(--sb-text-secondary)',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              font: 'inherit',
            }}
          >
            <span>{t.label}</span>
            <span
              style={{
                fontFamily: 'var(--sb-font-mono)',
                fontSize: 11,
                color: 'var(--sb-text-muted)',
              }}
            >
              ({counts[t.code] ?? 0})
            </span>
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// LAYOUTS QUEUE — per-milestone rows grouped by operational section
// =============================================================================

function LayoutsQueue({ rows, onOpenJob }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="sb-empty">
        No open layouts. Either everything's drawn and approved, or no jobs are
        currently in the design phase.
      </div>
    )
  }

  // Group rows by section. deriveLayoutsQueueRows has already sorted them, so
  // we preserve the order while bucketing.
  const bySection = new Map(LAYOUTS_SECTIONS.map(s => [s.code, []]))
  for (const row of rows) {
    if (bySection.has(row.section)) bySection.get(row.section).push(row)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {LAYOUTS_SECTIONS.map(section => {
        const sectionRows = bySection.get(section.code) || []
        return (
          <div key={section.code}>
            <div
              className="sb-section-label"
              style={{ margin: 0, marginBottom: 6 }}
            >
              {section.label}
              <span
                style={{
                  marginLeft: 8,
                  fontFamily: 'var(--sb-font-mono)',
                  fontSize: 11,
                  color: 'var(--sb-text-muted)',
                }}
              >
                ({sectionRows.length})
              </span>
            </div>
            {sectionRows.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--sb-text-muted)',
                  fontStyle: 'italic',
                  padding: '6px 0',
                }}
              >
                —
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {sectionRows.map(row => (
                  <MilestoneQueueRow
                    key={`${row.job.id}::${row.milestone.milestone_key}`}
                    row={row}
                    onOpenJob={onOpenJob}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// STONES QUEUE — per-milestone rows grouped by operational section
// =============================================================================
// Scope: stone-group milestones only (supplier ordering + receiving). Downstream
// production work (stencil_*, production_*, ready_to_install, installed) lives
// in a future Production queue — structurally excluded here because the data
// layer's deriveStonesQueueRows filters strictly on m.group === 'stone'.

function StonesQueue({ rows, onOpenJob }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="sb-empty">
        No open stone work. Either every stone is received and production has
        picked it up, or no jobs have reached the stone-order step yet.
      </div>
    )
  }

  const bySection = new Map(STONES_SECTIONS.map(s => [s.code, []]))
  for (const row of rows) {
    if (bySection.has(row.section)) bySection.get(row.section).push(row)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {STONES_SECTIONS.map(section => {
        const sectionRows = bySection.get(section.code) || []
        return (
          <div key={section.code}>
            <div
              className="sb-section-label"
              style={{ margin: 0, marginBottom: 6 }}
            >
              {section.label}
              <span
                style={{
                  marginLeft: 8,
                  fontFamily: 'var(--sb-font-mono)',
                  fontSize: 11,
                  color: 'var(--sb-text-muted)',
                }}
              >
                ({sectionRows.length})
              </span>
            </div>
            {sectionRows.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--sb-text-muted)',
                  fontStyle: 'italic',
                  padding: '6px 0',
                }}
              >
                —
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {sectionRows.map(row => (
                  <MilestoneQueueRow
                    key={`${row.job.id}::${row.milestone.milestone_key}`}
                    row={row}
                    onOpenJob={onOpenJob}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// WAITING-ON-CUSTOMER QUEUE — per-job flat list, sorted by days waiting
// =============================================================================

function WaitingOnCustomerQueue({ rows, onOpenJob }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="sb-empty">
        Nobody waiting on customer response. All customer-facing work is either
        still in progress internally, completed, or in another waiting state.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(row => (
        <WaitingJobRow
          key={row.job.id}
          row={row}
          onOpenJob={onOpenJob}
        />
      ))}
    </div>
  )
}

// =============================================================================
// ROW COMPONENTS
// =============================================================================

function MilestoneQueueRow({ row, onOpenJob }) {
  const order = row.order
  const handle = order?.primary_lastname || row.customer
    ? (order?.primary_lastname || `${row.customer?.last_name || ''}`).trim() || '—'
    : '—'
  const orderNum = order?.order_number || ''
  const team = row.team ? teamInfo(row.team) : null
  const waitingPill = row.waitingStatus ? jobStatusInfo(row.waitingStatus) : null

  const hasSecondary =
    row.cemetery?.name ||
    row.dueDate ||
    row.blockerKeys?.length > 0 ||
    waitingPill

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 14px',
        border: '0.5px solid var(--sb-border)',
        borderRadius: 'var(--sb-r-sm)',
        background: 'var(--sb-surface)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 280px', minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, color: 'var(--sb-text)' }}>{handle}</span>
          {orderNum && (
            <span
              className="sb-mono"
              style={{ fontSize: 11, color: 'var(--sb-text-muted)' }}
            >
              #{orderNum}
            </span>
          )}
          <span style={{ fontSize: 13, color: 'var(--sb-text)' }}>
            {row.milestone.label}
          </span>
          {team && <TeamPill team={team} />}
        </div>
        {hasSecondary && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: 'var(--sb-text-muted)',
              fontFamily: 'var(--sb-font-mono)',
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            {row.cemetery?.name && <span>{row.cemetery.name}</span>}
            {row.dueDate && <span>due {fmtDate(row.dueDate)}</span>}
            {row.blockerKeys?.length > 0 && (
              <span style={{ color: 'var(--sb-text-secondary)' }}>
                blocked by {row.blockerKeys.join(', ')}
              </span>
            )}
            {waitingPill && (
              <span style={{ color: waitingPill.color }}>
                Job: {waitingPill.label}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
          minWidth: 110,
        }}
      >
        <AgingBadge days={row.agingDays} variant="idle" />
        {row.overdue && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--sb-font-mono)',
              color: 'var(--sb-red, #b54040)',
            }}
          >
            ⚠ {row.overdueDays}d overdue
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className="sb-btn-secondary"
          onClick={() => onOpenJob?.(row.job.id)}
          style={{ fontSize: 12 }}
        >
          Open job →
        </button>
      </div>
    </div>
  )
}

function WaitingJobRow({ row, onOpenJob }) {
  const order = row.order
  const handle = order?.primary_lastname || `${row.customer?.last_name || ''}`.trim() || '—'
  const orderNum = order?.order_number || ''
  const awaiting = row.awaitingMilestone
  const team = row.awaitingTeam ? teamInfo(row.awaitingTeam) : null

  // Tier the badge: 0-6d nothing, 7-13d soft amber, 14+ red+escalate
  const days = row.daysWaiting ?? 0
  let tierBadge = null
  if (days >= 14) {
    tierBadge = { color: 'var(--sb-red, #b54040)', label: `⚠ ${days}d waiting — escalate?` }
  } else if (days >= 7) {
    tierBadge = { color: 'var(--sb-gold, #b8842a)', label: `⚠ ${days}d waiting` }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 14px',
        border: '0.5px solid var(--sb-border)',
        borderRadius: 'var(--sb-r-sm)',
        background: 'var(--sb-surface)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 280px', minWidth: 240 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, color: 'var(--sb-text)' }}>{handle}</span>
          {orderNum && (
            <span
              className="sb-mono"
              style={{ fontSize: 11, color: 'var(--sb-text-muted)' }}
            >
              #{orderNum}
            </span>
          )}
          <span style={{ fontSize: 13, color: 'var(--sb-text)' }}>
            Waiting {formatDays(days)}
          </span>
          {team && <TeamPill team={team} />}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--sb-text-muted)',
            fontFamily: 'var(--sb-font-mono)',
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {awaiting ? (
            <span>
              Awaiting: {awaiting.label}
              {row.awaitingDays != null && ` · ${formatDays(row.awaitingDays)} ago`}
            </span>
          ) : (
            <span>Awaiting: see job for details</span>
          )}
          {row.cemetery?.name && <span>{row.cemetery.name}</span>}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
          minWidth: 110,
        }}
      >
        {tierBadge && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--sb-font-mono)',
              color: tierBadge.color,
            }}
          >
            {tierBadge.label}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className="sb-btn-secondary"
          onClick={() => onOpenJob?.(row.job.id)}
          style={{ fontSize: 12 }}
        >
          Open job →
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// SHARED ROW BITS
// =============================================================================

// Subtle uppercase team chip — operational ownership at a glance.
function TeamPill({ team }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--sb-font-mono)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: team.color || 'var(--sb-text-muted)',
        border: `0.5px solid ${team.color || 'var(--sb-border)'}`,
        borderRadius: 'var(--sb-r-sm)',
        padding: '1px 6px',
        background: 'transparent',
      }}
    >
      {team.label}
    </span>
  )
}

// Subtle right-aligned aging badge. variant === 'idle' → "Nd idle" / "Today".
function AgingBadge({ days, variant }) {
  if (days == null) return null
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--sb-font-mono)',
        color: 'var(--sb-text-muted)',
      }}
    >
      {formatDays(days)}{variant === 'idle' ? ' idle' : ''}
    </span>
  )
}

function formatDays(days) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d`
}
