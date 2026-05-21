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
  deriveProductionQueueRows,
  deriveWaitingOnCustomerQueueRows,
  jobStatusInfo,
  fmtDate,
  isLateAgainstExpectedResolution,
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

// Static section metadata for the Production queue. Five operational stages:
// stencil prep is distinct from carving (different workflow lane); "ready for
// carving" surfaces jobs queued for the line but not yet started; "in
// production" surfaces active carving + completion-marking; the handoff
// section surfaces production→install drift without rendering install rows.
const PRODUCTION_SECTIONS = [
  { code: 'stencil_prep_needed',       label: 'Stencil prep needed' },
  { code: 'ready_for_carving',         label: 'Ready for carving' },
  { code: 'in_production',             label: 'In production' },
  { code: 'complete_awaiting_install', label: 'Complete / awaiting install' },
  { code: 'blocked',                   label: 'Blocked' },
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
  const productionRows = useMemo(
    () => deriveProductionQueueRows(jobs || []),
    [jobs],
  )
  const waitingRows = useMemo(
    () => deriveWaitingOnCustomerQueueRows(jobs || []),
    [jobs],
  )

  const counts = {
    layouts: layoutsRows.length,
    stones: stonesRows.length,
    production: productionRows.length,
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

      {jobs !== null && !loadErr && activeQueue === 'production' && (
        <ProductionQueue rows={productionRows} onOpenJob={onOpenJob} />
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
    { code: 'production',          label: 'Production' },
    { code: 'waiting_on_customer', label: 'Waiting on customer' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 32,
        marginBottom: 40,
        flexWrap: 'wrap',
        borderBottom: '0.5px solid var(--sb-border)',
        paddingBottom: 4,
      }}
    >
      {tabs.map(t => {
        const isActive = t.code === active
        const count = counts[t.code] ?? 0
        return (
          <button
            key={t.code}
            type="button"
            onClick={() => onSelect?.(t.code)}
            style={{
              padding: '8px 0',
              marginBottom: -1,                          /* aligns underline with parent border */
              background: 'transparent',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--sb-accent)'
                : '2px solid transparent',
              color: isActive ? 'var(--sb-text)' : 'var(--sb-text-muted)',
              fontSize: 15,
              fontWeight: isActive ? 500 : 400,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 8,
              font: 'inherit',
              transition: 'color 0.15s',
            }}
          >
            <span>{t.label}</span>
            <span style={{
              fontSize: 13,
              color: 'var(--sb-text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {count}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {LAYOUTS_SECTIONS.map(section => {
        const sectionRows = bySection.get(section.code) || []
        return (
          <div key={section.code}>
            <div
              className="sb-section-label"
              style={{ margin: '32px 0 12px', display: 'flex', alignItems: 'baseline', gap: 12 }}
            >
              {section.label}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--sb-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {sectionRows.length}
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
                  gap: 0,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {STONES_SECTIONS.map(section => {
        const sectionRows = bySection.get(section.code) || []
        return (
          <div key={section.code}>
            <div
              className="sb-section-label"
              style={{ margin: '32px 0 12px', display: 'flex', alignItems: 'baseline', gap: 12 }}
            >
              {section.label}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--sb-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {sectionRows.length}
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
                  gap: 0,
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
// PRODUCTION QUEUE — per-milestone rows grouped by operational stage
// =============================================================================
// Scope: production-group milestones only (stencil prep + carving). Install
// execution (ready_to_install, installed) lives in a future Install queue —
// structurally excluded here because the data layer's deriveProductionQueueRows
// filters strictly on m.group === 'production'. The "Complete / awaiting
// install" section surfaces production→install handoff drift via the universal
// handoff_pending state without rendering install rows.

function ProductionQueue({ rows, onOpenJob }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="sb-empty">
        No open production work. Either every stone has cleared the production
        line, or no jobs have reached the stencil-prep step yet.
      </div>
    )
  }

  const bySection = new Map(PRODUCTION_SECTIONS.map(s => [s.code, []]))
  for (const row of rows) {
    if (bySection.has(row.section)) bySection.get(row.section).push(row)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {PRODUCTION_SECTIONS.map(section => {
        const sectionRows = bySection.get(section.code) || []
        return (
          <div key={section.code}>
            <div
              className="sb-section-label"
              style={{ margin: '32px 0 12px', display: 'flex', alignItems: 'baseline', gap: 12 }}
            >
              {section.label}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--sb-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {sectionRows.length}
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
                  gap: 0,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
  const waitingPill = row.waitingStatus ? jobStatusInfo(row.waitingStatus) : null

  // Build secondary metadata as middle-dot-separated parts.
  // Operational Truth Substrate — when the row's milestone carries an
  // `expected_resolution_at` and/or `external_party_ref`, the clause is
  // appended inline (no new container, no chip; see UI-polish guardrail).
  // The internal `due` clause is suppressed when an expectation clause is
  // present — the external promise-back date is the more honest reading and
  // surfacing both turns the sentence into a tuple.
  const expectClause = expectationClause(row)
  const secondaryParts = []
  secondaryParts.push(row.milestone.label)
  if (row.cemetery?.name) secondaryParts.push(row.cemetery.name)
  if (row.dueDate && !expectClause) secondaryParts.push(`due ${fmtDate(row.dueDate)}`)
  if (expectClause) secondaryParts.push(expectClause)
  if (row.blockerKeys?.length > 0) {
    secondaryParts.push(`blocked by ${row.blockerKeys.join(', ')}`)
  }
  if (waitingPill) secondaryParts.push(`Job: ${waitingPill.label}`)

  return (
    <button
      type="button"
      onClick={() => onOpenJob?.(row.job.id)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        borderBottom: '0.5px solid var(--sb-border)',
        padding: '20px 4px',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-surface-muted)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Primary line: customer name + order# on left, aging + overdue on right */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flex: 1,
          minWidth: 0,
        }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--sb-text)', letterSpacing: '-0.005em' }}>
            {handle}
          </span>
          {orderNum && (
            <span style={{
              fontSize: 13,
              fontFamily: 'var(--sb-font-mono)',
              color: 'var(--sb-text-muted)',
            }}>
              #{orderNum}
            </span>
          )}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          fontSize: 13,
          fontFamily: 'var(--sb-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--sb-text-muted)',
          whiteSpace: 'nowrap',
        }}>
          {row.agingDays != null && (
            <span>{formatDays(row.agingDays)} idle</span>
          )}
          {row.overdue && (
            <span style={{ color: 'var(--sb-red, #b54040)' }}>
              ⚠ {row.overdueDays}d overdue
            </span>
          )}
        </div>
      </div>

      {/* Secondary line: milestone label + supporting metadata, middle-dot separated */}
      <div style={{
        marginTop: 8,
        fontSize: 15,
        color: 'var(--sb-text-secondary)',
        lineHeight: 1.5,
      }}>
        {secondaryParts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span style={{ margin: '0 8px', color: 'var(--sb-text-muted)' }}>·</span>}
            {part}
          </span>
        ))}
      </div>
    </button>
  )
}

function WaitingJobRow({ row, onOpenJob }) {
  const order = row.order
  const handle = order?.primary_lastname || `${row.customer?.last_name || ''}`.trim() || '—'
  const orderNum = order?.order_number || ''
  const awaiting = row.awaitingMilestone

  // Tier the badge: 0-6d nothing, 7-13d soft amber, 14+ red+escalate
  const days = row.daysWaiting ?? 0
  let tierBadge = null
  if (days >= 14) {
    tierBadge = { color: 'var(--sb-red, #b54040)', label: `⚠ ${days}d waiting — escalate?` }
  } else if (days >= 7) {
    tierBadge = { color: 'var(--sb-gold, #b8842a)', label: `⚠ ${days}d waiting` }
  }

  return (
    <button
      type="button"
      onClick={() => onOpenJob?.(row.job.id)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        borderBottom: '0.5px solid var(--sb-border)',
        padding: '20px 4px',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-surface-muted)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Primary line: customer + waiting duration on right */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--sb-text)', letterSpacing: '-0.005em' }}>
            {handle}
          </span>
          {orderNum && (
            <span style={{
              fontSize: 13,
              fontFamily: 'var(--sb-font-mono)',
              color: 'var(--sb-text-muted)',
            }}>
              #{orderNum}
            </span>
          )}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          fontSize: 13,
          fontFamily: 'var(--sb-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          color: tierBadge?.color || 'var(--sb-text-muted)',
          whiteSpace: 'nowrap',
        }}>
          {tierBadge ? tierBadge.label : `Waiting ${formatDays(days)}`}
        </div>
      </div>

      {/* Secondary line: what we're awaiting + cemetery.
          Operational Truth Substrate — when the awaiting milestone carries
          an external_party_ref or expected_resolution_at, those facts append
          inline ("expected back Tuesday from Coldspring"). No chrome added;
          the sentence simply gains specificity when the data is present. */}
      <div style={{
        marginTop: 8,
        fontSize: 15,
        color: 'var(--sb-text-secondary)',
        lineHeight: 1.5,
      }}>
        {awaiting ? (
          <>
            Awaiting: {awaiting.label}
            {row.awaitingDays != null && ` · ${formatDays(row.awaitingDays)} ago`}
            {(() => {
              const c = expectationClause({
                expectedResolutionAt: awaiting.expected_resolution_at || null,
                externalPartyRef:     awaiting.external_party_ref     || null,
                lateAgainstExpectation: isLateAgainstExpectedResolution(awaiting),
              })
              return c ? <> · {c}</> : null
            })()}
          </>
        ) : (
          <>Awaiting: see job for details</>
        )}
        {row.cemetery?.name && (
          <>
            <span style={{ margin: '0 8px', color: 'var(--sb-text-muted)' }}>·</span>
            {row.cemetery.name}
          </>
        )}
      </div>
    </button>
  )
}

// =============================================================================
// SHARED HELPERS
// =============================================================================
// Visual rebalance 2026-05-21: TeamPill and AgingBadge components removed.
// Team is no longer surfaced as a pill chip (operational ownership will be
// surfaced through other means in a future commit). Aging is rendered inline
// on each row's primary line as mono text — no badge component needed.

function formatDays(days) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d`
}

// Composes a single inline clause naming the external party's promise-back
// status. Returns null when no structured fields are present — caller skips
// the clause in that case. Honors the UI-polish guardrail: this is a sentence
// fragment that joins the existing middle-dot-separated row parts; never a
// container, never a chip.
//
// Inputs come from the queue row payload (see deriveStonesQueueRows in
// stonebooksData.js) or from a milestone directly (WaitingJobRow path).
function expectationClause({ expectedResolutionAt, externalPartyRef, lateAgainstExpectation }) {
  const party = externalPartyRef?.trim() || null
  const late  = lateAgainstExpectation && lateAgainstExpectation.daysLate > 0
    ? lateAgainstExpectation.daysLate
    : null

  if (late != null) {
    return party
      ? `${party} ${late}d past quoted date`
      : `${late}d past expected`
  }
  if (expectedResolutionAt) {
    const when = formatExpectedShort(expectedResolutionAt)
    return party
      ? `expected back ${when} from ${party}`
      : `expected back ${when}`
  }
  if (party) return `awaiting ${party}`
  return null
}

// Calm time anchor for the expectation clause. Within the next 7 days
// → today / tomorrow / weekday name; beyond → "Jun 14" form. Same intent as
// the formatExpected helper in todaySignals.js — duplicated intentionally
// so QueuesView doesn't take a cross-module dependency for one string.
function formatExpectedShort(iso) {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const delta = Math.floor((d - t) / 86400000)
  if (delta === 0) return 'today'
  if (delta === 1) return 'tomorrow'
  if (delta >= 2 && delta <= 7) {
    return d.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
