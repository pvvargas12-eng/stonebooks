// =============================================================================
// 📚 Stonebooks — Jobs Department View
// =============================================================================
// Orchestrates the department-aware Jobs surface:
//   • Role selector at top-right (Admin · Design · Sales · Production ·
//     Installation · Owner). Persisted per-user via workspaceState.
//   • A row of bucket cards for the selected department
//   • A column of queue sections below, each anchored to one bucket
//   • Sales is the only stub left — its work lives in the Orders tab.
//   • Owner has TWO modes (toggled at the top of the Owner content area):
//      – Overview (default): a curated ten-card grid — the things that can
//        hold up a job at this shop. Clicking a card switches role to the
//        owning department and scroll-targets the matching queue. The
//        Estimates card routes to the Orders tab instead.
//      – All departments: the full stack of every department's buckets +
//        queues, with a jump strip + per-department eyebrows. The legacy
//        view kept one click away for the days the owner wants the long
//        scroll.
//
// Data layer: every bucket is built by stonebooksData helpers from a single
// jobs-fetch on mount. Orders are also fetched on mount so the Estimates
// overview card has its count without a second round-trip.
// =============================================================================

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  getJobs,
  listAllOrders,
  listAllBulkOrders,
  markBulkOrderReceived,
  DEPARTMENTS,
  bucketsForDepartment,
  getOwnerOverviewBuckets,
  getAllAmberTasks,
  getAllOverdueTasks,
  worstUrgency,
  URGENCY,
} from './lib/stonebooksData'
import OwnerAttentionListView from './components/OwnerAttentionListView'
import SalesView from './components/SalesView'
import AddPromiseModal from './components/AddPromiseModal'
import {
  getSelectedRole,
  setSelectedRole,
  getOwnerViewMode,
  setOwnerViewMode,
} from './lib/workspaceState'
import JobsBucketCard from './components/JobsBucketCard'
import JobsQueueSection from './components/JobsQueueSection'
import RoleSelector from './components/RoleSelector'

export default function JobsDepartmentView({ userId, onOpenJob, onSwitchTab, onOpenOrder }) {
  const [role, setRole] = useState(() => getSelectedRole(userId))
  const [ownerMode, setOwnerMode] = useState(() => getOwnerViewMode(userId))
  const [jobs, setJobs] = useState(null)
  const [orders, setOrders] = useState(null)
  const [bulkOrders, setBulkOrders] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  // When an Overview card click drives a role switch, this captures the
  // bucket code the new role's DepartmentBuckets should scroll to once it
  // mounts. The consumer clears it on consumption so subsequent re-renders
  // don't fight the user's scroll.
  const [pendingBucketScroll, setPendingBucketScroll] = useState(null)

  // Promise quick-add target — set when an operator clicks the 🤡 hover
  // affordance on a queue row. AddPromiseModal opens pre-filled with that
  // job. Reload after save so any new badge surfaces on next render.
  const [promiseTarget, setPromiseTarget] = useState(null)
  const handlePromiseClick = useCallback((row) => {
    const jobId = row?.job?.id
    if (!jobId) return
    const label = row?.order?.primary_lastname
      || row?.customer?.last_name
      || row?.customer?.lastName
      || 'this job'
    setPromiseTarget({ jobId, label })
  }, [])

  // One parallel fetch on mount — jobs for every department's buckets,
  // orders for the Estimates Overview card, bulk_orders for the Admin
  // "Open bulk orders" bucket + the projection engine (stone milestones
  // linked to a bulk_order use the supplier's quoted lead time instead of
  // the generic 30-day default).
  const loadJobs = useCallback(async () => {
    setLoadErr(null)
    try {
      const [jobData, orderData, bulkData] = await Promise.all([
        getJobs({ includeClosed: false }),
        listAllOrders({ limit: 500 }),
        listAllBulkOrders(),
      ])
      setJobs(jobData || [])
      setOrders(orderData || [])
      setBulkOrders(bulkData || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load operations data')
      setJobs([])
      setOrders([])
      setBulkOrders([])
    }
  }, [])
  useEffect(() => { loadJobs() }, [loadJobs])

  // Cascade-on-receive — the BulkOrderRow's "Mark received" button calls
  // through here so we can reload after the cascade completes. Returns the
  // helper's { ok, error } so the row can surface the error inline.
  const handleMarkBulkReceived = useCallback(async (bulkOrderId) => {
    const res = await markBulkOrderReceived(bulkOrderId, { actorUserId: userId })
    if (res.ok) loadJobs()
    return res
  }, [userId, loadJobs])

  const handleRoleChange = (next) => {
    setRole(next)
    setSelectedRole(userId, next)
  }

  const handleOwnerModeChange = (next) => {
    setOwnerMode(next)
    setOwnerViewMode(userId, next)
  }

  // Dispatch for an Overview card click. The Estimates card routes to the
  // Orders tab (no role change); every other card switches role to the
  // owning department and captures a pending bucket-scroll target.
  const handleOverviewCardClick = (bucket) => {
    if (!bucket?.route) return
    if (bucket.route.type === 'tab' && bucket.route.tab && onSwitchTab) {
      onSwitchTab(bucket.route.tab)
      return
    }
    if (bucket.route.type === 'role' && bucket.route.role) {
      handleRoleChange(bucket.route.role)
      setPendingBucketScroll(bucket.route.bucketCode || null)
    }
  }

  const consumePendingScroll = useCallback(() => {
    setPendingBucketScroll(null)
  }, [])

  return (
    <div className="sb-jobs-dept">
      <RoleSelector active={role} onChange={handleRoleChange} />

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>
          {loadErr}
        </div>
      )}

      {jobs === null && !loadErr && (
        <div className="sb-empty">Loading…</div>
      )}

      {jobs !== null && !loadErr && (
        role === 'owner'
          ? (
            <OwnerView
              jobs={jobs}
              orders={orders || []}
              bulkOrders={bulkOrders || []}
              mode={ownerMode}
              onModeChange={handleOwnerModeChange}
              onOpenJob={onOpenJob}
              onOverviewCardClick={handleOverviewCardClick}
              onReload={loadJobs}
              onMarkBulkReceived={handleMarkBulkReceived}
            />
          )
          : (
            <DepartmentBody
              role={role}
              jobs={jobs}
              orders={orders || []}
              bulkOrders={bulkOrders || []}
              onOpenJob={onOpenJob}
              onOpenOrder={onOpenOrder}
              onSwitchTab={onSwitchTab}
              onReload={loadJobs}
              onMarkBulkReceived={handleMarkBulkReceived}
              initialScrollBucket={pendingBucketScroll}
              onConsumeInitialScroll={consumePendingScroll}
              onPromiseClick={handlePromiseClick}
            />
          )
      )}

      <AddPromiseModal
        open={!!promiseTarget}
        jobId={promiseTarget?.jobId || null}
        jobLabel={promiseTarget?.label || null}
        onClose={() => setPromiseTarget(null)}
        onSaved={() => { setPromiseTarget(null); loadJobs() }}
      />
    </div>
  )
}

// =============================================================================
// DEPARTMENT BODY — non-Owner roles
// =============================================================================

function DepartmentBody({ role, jobs, orders, bulkOrders, onOpenJob, onOpenOrder, onSwitchTab, onReload, onMarkBulkReceived, initialScrollBucket, onConsumeInitialScroll, onPromiseClick }) {
  const dept = DEPARTMENTS.find(d => d.code === role)
  if (!dept) return null

  // Sales is metric-shaped, not queue-shaped — render the dedicated
  // SalesView instead of the generic DepartmentBuckets. The stub fallback
  // below remains for any future stub department (none today).
  if (role === 'sales') {
    return (
      <SalesView
        orders={orders}
        onSwitchTab={onSwitchTab}
        onOpenOrder={onOpenOrder}
      />
    )
  }
  if (dept.stub) {
    return <DepartmentStub label={dept.label} />
  }
  return (
    <DepartmentBuckets
      dept={dept}
      jobs={jobs}
      bulkOrders={bulkOrders}
      onOpenJob={onOpenJob}
      onReload={onReload}
      onMarkBulkReceived={onMarkBulkReceived}
      initialScrollBucket={initialScrollBucket}
      onConsumeInitialScroll={onConsumeInitialScroll}
      onPromiseClick={onPromiseClick}
    />
  )
}

// Bucket codes that gain multi-select checkboxes on their rows. Limited to
// Admin's two supplier-bound queues — stones and photos can group into one
// PO each. Adding a new selectable queue means registering its code here AND
// in SELECTABLE_BUCKET_KINDS inside JobsQueueSection.
const SELECTABLE_BUCKET_CODES = new Set(['stones_to_order', 'photos_to_request'])

// Render: bucket-card grid + queue sections. Each card focus-scrolls its
// queue section into view (smooth scroll, scroll-margin-top on the section).
// When `initialScrollBucket` is set (e.g. from an Owner Overview card click
// that switched to this role), the matching section is scrolled into view on
// mount and the pending target is cleared via onConsumeInitialScroll so
// future re-renders don't fight the user's scroll.
function DepartmentBuckets({ dept, jobs, bulkOrders, onOpenJob, onReload, onMarkBulkReceived, initialScrollBucket, onConsumeInitialScroll, onPromiseClick }) {
  const buckets = useMemo(
    () => bucketsForDepartment(dept.code, jobs, { bulkOrders }) || [],
    [dept.code, jobs, bulkOrders],
  )

  // One ref per bucket section so the bucket card can focus-scroll its queue
  // into view. Refs are stable per (dept, bucket.code) — re-render of buckets
  // re-maps but the underlying Section component keeps its ref.
  const sectionRefs = useRef({})
  const scrollToBucket = (bucket) => {
    const node = sectionRefs.current[bucket.code]
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Honour an externally-set scroll target once after buckets render. The
  // 50ms timeout lets the Section refs populate before we ask the DOM to
  // scroll. Bucket codes that don't exist in this dept are no-ops — we still
  // consume the pending target so it doesn't linger.
  useEffect(() => {
    if (!initialScrollBucket) return
    const t = setTimeout(() => {
      const node = sectionRefs.current[initialScrollBucket]
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      onConsumeInitialScroll?.()
    }, 50)
    return () => clearTimeout(t)
  }, [initialScrollBucket, onConsumeInitialScroll])

  return (
    <div className="sb-dept-body">
      <div className="sb-dept-bucket-grid">
        {buckets.map(b => (
          <JobsBucketCard key={b.code} bucket={b} onClick={scrollToBucket} />
        ))}
      </div>

      <div className="sb-dept-queues">
        {buckets.map(b => (
          <JobsQueueSection
            key={b.code}
            ref={el => { sectionRefs.current[b.code] = el }}
            bucket={b}
            bulkOrders={bulkOrders}
            selectable={SELECTABLE_BUCKET_CODES.has(b.code)}
            onOpenRow={(row) => onOpenJob?.(row.job.id)}
            onReload={onReload}
            onMarkBulkReceived={onMarkBulkReceived}
            onPromiseClick={onPromiseClick}
          />
        ))}
      </div>
    </div>
  )
}

// Stub panel — Sales is the only remaining stub. Admin / Design / Production /
// Installation are wired. The Sales copy is intentionally honest: most sales
// work happens in the Orders tab before a job ever exists, so job-stage
// buckets for Sales would feel forced. The role selector still shows Sales so
// the surface is consistent across departments and so the gap is visible.
function DepartmentStub({ label }) {
  if (label === 'Sales') {
    return (
      <div className="sb-dept-stub">
        <div className="sb-dept-stub-eyebrow">{label}</div>
        <div className="sb-dept-stub-body">
          Sales work lives in the Orders tab.
        </div>
      </div>
    )
  }
  return (
    <div className="sb-dept-stub">
      <div className="sb-dept-stub-eyebrow">{label}</div>
      <div className="sb-dept-stub-body">
        Coming soon. The {label.toLowerCase()} department's bucket grid and
        queues will land in a follow-up pass.
      </div>
    </div>
  )
}

// =============================================================================
// OWNER VIEW — Overview (default) vs All departments
// =============================================================================
// Two modes for the Owner role:
//   • Overview — a curated ten-card grid built by getOwnerOverviewBuckets.
//     The operator's morning scan. Click a card → switch role + scroll to
//     that department's bucket (or, for Estimates, jump to the Orders tab).
//   • All departments — the legacy stacked view. Jump strip on top, every
//     department's bucket grid + queues below, eyebrows with urgency dots
//     and "N in flight" counts so the long scroll stays surveyable.
//
// The mode toggle persists via workspaceState.ownerViewMode. The toggle is
// only rendered when role === 'owner'.

// Worst-urgency dot color used in the Owner jump strip and per-department
// eyebrows. Mirrors the JobsBucketCard / JobsQueueSection palette so the
// operator's eye learns one color vocabulary across the page.
const URGENCY_DOT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-border)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

function OwnerView({ jobs, orders, bulkOrders, mode, onModeChange, onOpenJob, onOverviewCardClick, onReload, onMarkBulkReceived }) {
  // Transient navigation — when the operator clicks one of the Overview
  // summary cards, attentionMode flips to 'amber' or 'red' and the grid is
  // replaced by OwnerAttentionListView. This is NOT persisted in
  // workspaceState — it's an in-session drill, not a view preference.
  const [attentionMode, setAttentionMode] = useState(null)

  // Switching modes (Overview ↔ All departments) should clear any active
  // attention drill. Otherwise the user could toggle to All-departments,
  // back to Overview, and find themselves still inside an old list view.
  const handleModeChange = useCallback((next) => {
    setAttentionMode(null)
    onModeChange?.(next)
  }, [onModeChange])

  return (
    <div className="sb-dept-owner-wrap">
      <OwnerViewToggle mode={mode} onChange={handleModeChange} />
      {mode === 'overview'
        ? (
          <OwnerOverview
            jobs={jobs}
            orders={orders}
            bulkOrders={bulkOrders}
            attentionMode={attentionMode}
            onCardClick={onOverviewCardClick}
            onAttentionOpen={setAttentionMode}
            onAttentionBack={() => setAttentionMode(null)}
            onOpenJob={onOpenJob}
          />
        )
        : (
          <OwnerStack
            jobs={jobs}
            bulkOrders={bulkOrders}
            onOpenJob={onOpenJob}
            onReload={onReload}
            onMarkBulkReceived={onMarkBulkReceived}
          />
        )}
    </div>
  )
}

// Small segmented control above the Owner content. Two options; the active
// option gets the same surface-muted treatment as the role chip selector so
// both controls feel like they came out of the same toolbox.
function OwnerViewToggle({ mode, onChange }) {
  const OPTIONS = [
    { code: 'overview',    label: 'Overview' },
    { code: 'departments', label: 'All departments' },
  ]
  return (
    <div className="sb-owner-toggle" role="tablist" aria-label="Owner view mode">
      {OPTIONS.map(opt => {
        const active = opt.code === mode
        return (
          <button
            key={opt.code}
            type="button"
            role="tab"
            aria-selected={active}
            className={`sb-owner-toggle-chip ${active ? 'sb-owner-toggle-chip-active' : ''}`}
            onClick={() => onChange(opt.code)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Curated ten-card Overview, prefixed by two headline summary cards when
// the shop has work in amber or red urgency. The headline cards hide
// entirely when their count is zero — quiet days look quiet. Clicking a
// headline card opens an inline attention list (OwnerAttentionListView)
// that replaces the grid until the operator clicks back.
function OwnerOverview({
  jobs,
  orders,
  bulkOrders,
  attentionMode,
  onCardClick,
  onAttentionOpen,
  onAttentionBack,
  onOpenJob,
}) {
  const cards = useMemo(
    () => getOwnerOverviewBuckets(jobs, orders) || [],
    [jobs, orders],
  )

  // Walk the same per-department bucket derivers to count amber and red
  // tasks across the whole shop. Cheap enough — same data we already have
  // in memory. Deduped by milestone.id inside the helpers.
  const amberTasks = useMemo(
    () => getAllAmberTasks(jobs, bulkOrders),
    [jobs, bulkOrders],
  )
  const overdueTasks = useMemo(
    () => getAllOverdueTasks(jobs, bulkOrders),
    [jobs, bulkOrders],
  )

  // Attention list mode — replaces the entire grid until the operator
  // clicks back. Same Owner role, just a different body slot.
  if (attentionMode === 'amber' || attentionMode === 'red') {
    return (
      <div className="sb-owner-overview">
        <OwnerAttentionListView
          mode={attentionMode}
          rows={attentionMode === 'red' ? overdueTasks : amberTasks}
          bulkOrders={bulkOrders}
          onBack={onAttentionBack}
          onOpenRow={(row) => row?.job?.id && onOpenJob?.(row.job.id)}
        />
      </div>
    )
  }

  // Bucket shape for the two summary cards — same fields JobsBucketCard
  // expects so we can reuse the component with summaryStyle=true.
  const amberCard = amberTasks.length > 0 ? {
    code:   'attention_amber',
    label:  'Tasks needing attention',
    count:  amberTasks.length,
    urgency: URGENCY.AMBER,
    subline: `${amberTasks.length} ${amberTasks.length === 1 ? 'task is' : 'tasks are'} aging past threshold`,
  } : null
  const redCard = overdueTasks.length > 0 ? {
    code:   'attention_red',
    label:  'Tasks overdue',
    count:  overdueTasks.length,
    urgency: URGENCY.RED,
    subline: `${overdueTasks.length} past due — chase first`,
  } : null

  // The two summary cards live in their own grid above the curated ten so
  // the visual hierarchy reads "headline → curated" cleanly. If we put them
  // inline in the same auto-fit grid as the curated cards, the row count
  // mismatches at typical desktop widths and the summary cards end up
  // sharing a row with one or two curated cards — same row, different roles.
  // The separate top grid avoids that.
  const hasSummary = !!(amberCard || redCard)

  return (
    <div className="sb-owner-overview">
      {hasSummary && (
        <div className="sb-owner-summary-row">
          {redCard && (
            <JobsBucketCard
              key={redCard.code}
              bucket={redCard}
              summaryStyle
              onClick={() => onAttentionOpen?.('red')}
            />
          )}
          {amberCard && (
            <JobsBucketCard
              key={amberCard.code}
              bucket={amberCard}
              summaryStyle
              onClick={() => onAttentionOpen?.('amber')}
            />
          )}
        </div>
      )}
      <div className="sb-dept-bucket-grid">
        {cards.map(card => (
          <JobsBucketCard
            key={card.code}
            bucket={card}
            onClick={(b) => onCardClick?.(b)}
          />
        ))}
      </div>
    </div>
  )
}

// Compute the per-department summary used by the jump strip and the eyebrows.
// Returns [{ dept, anchorId, totalCount, urgency }] in DEPARTMENTS order so
// stub departments slot into the strip at their natural position.
function _ownerDeptSummaries(jobs, bulkOrders) {
  return DEPARTMENTS.map(dept => {
    const anchorId = `dept-${dept.code}`
    if (dept.stub) {
      return { dept, anchorId, totalCount: null, urgency: URGENCY.NEUTRAL }
    }
    const buckets = bucketsForDepartment(dept.code, jobs, { bulkOrders }) || []
    const totalCount = buckets.reduce((sum, b) => sum + (b.count || 0), 0)
    const allRows = buckets.flatMap(b => b.rows || [])
    return { dept, anchorId, totalCount, urgency: worstUrgency(allRows) }
  })
}

function OwnerStack({ jobs, bulkOrders, onOpenJob, onReload, onMarkBulkReceived }) {
  const summaries = useMemo(() => _ownerDeptSummaries(jobs, bulkOrders), [jobs, bulkOrders])

  // Smooth-scroll the corresponding department block into view. scroll-margin-
  // top on the block lets the dept eyebrow clear any sticky chrome above.
  const scrollToDept = (anchorId) => {
    const node = document.getElementById(anchorId)
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="sb-dept-owner">
      <nav className="sb-dept-owner-jumps" aria-label="Jump to department">
        {summaries.map(({ dept, anchorId, totalCount, urgency }) => (
          <button
            key={dept.code}
            type="button"
            className="sb-dept-owner-jump"
            onClick={() => scrollToDept(anchorId)}
          >
            <span
              className="sb-dept-owner-jump-dot"
              style={{ background: URGENCY_DOT_COLOR[urgency] }}
              aria-hidden="true"
            />
            <span className="sb-dept-owner-jump-label">{dept.label}</span>
            {totalCount != null && (
              <span className="sb-dept-owner-jump-count">{totalCount}</span>
            )}
          </button>
        ))}
      </nav>

      {summaries.map(({ dept, anchorId, totalCount, urgency }) => (
        <OwnerDepartmentBlock
          key={dept.code}
          dept={dept}
          anchorId={anchorId}
          totalCount={totalCount}
          urgency={urgency}
          jobs={jobs}
          bulkOrders={bulkOrders}
          onOpenJob={onOpenJob}
          onReload={onReload}
          onMarkBulkReceived={onMarkBulkReceived}
        />
      ))}
    </div>
  )
}

function OwnerDepartmentBlock({ dept, anchorId, totalCount, urgency, jobs, bulkOrders, onOpenJob, onReload, onMarkBulkReceived }) {
  return (
    <section className="sb-dept-owner-block" id={anchorId}>
      <header className="sb-dept-owner-eyebrow">
        <span
          className="sb-dept-owner-eyebrow-dot"
          style={{ background: URGENCY_DOT_COLOR[urgency] }}
          aria-hidden="true"
        />
        <span className="sb-dept-owner-eyebrow-label">{dept.label}</span>
        {totalCount != null && (
          <span className="sb-dept-owner-eyebrow-count">
            {totalCount === 0 ? 'nothing in flight' : `${totalCount} in flight`}
          </span>
        )}
      </header>
      {dept.stub ? (
        <div className="sb-dept-owner-stub">
          {dept.code === 'sales'
            ? 'Sales work lives in the Orders tab.'
            : `Coming soon — queues for ${dept.label.toLowerCase()} will land in a follow-up pass.`}
        </div>
      ) : (
        <DepartmentBuckets
          dept={dept}
          jobs={jobs}
          bulkOrders={bulkOrders}
          onOpenJob={onOpenJob}
          onReload={onReload}
          onMarkBulkReceived={onMarkBulkReceived}
        />
      )}
    </section>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  /* The department view drops out of the standard sb-page max-width so the
     bucket grid + queue table can breathe across the full screen. The hero
     header + role selector are sized via their own internal layout. */
  .sb-jobs-dept {
    width: 100%;
  }

  /* ── BUCKET GRID ───────────────────────────────────────────────────────── */
  /* Auto-fit so buckets reflow gracefully across widths; the min track keeps
     a card readable without crowding the count. Six cards across at desktop
     widths in a typical browser. */
  .sb-dept-bucket-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 40px;
  }

  /* ── QUEUE STACK ───────────────────────────────────────────────────────── */
  .sb-dept-queues {
    display: flex;
    flex-direction: column;
  }
  .sb-dept-body {
    margin-bottom: 16px;
  }

  /* ── STUB BLOCKS (single-department view) ──────────────────────────────── */
  .sb-dept-stub {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    padding: 40px 32px;
    max-width: 640px;
  }
  .sb-dept-stub-eyebrow {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 14px;
  }
  .sb-dept-stub-body {
    font-size: 15px;
    line-height: 1.55;
    color: var(--sb-text-secondary);
    max-width: 56ch;
  }

  /* ── OWNER WRAP + MODE TOGGLE ──────────────────────────────────────────── */
  /* The Owner wrap holds the mode toggle and whichever mode body is active
     (Overview grid or the full department stack). The toggle sits above
     both modes; consistent placement makes it discoverable. */
  .sb-dept-owner-wrap {
    width: 100%;
  }
  .sb-owner-toggle {
    display: inline-flex;
    gap: 4px;
    margin-bottom: 28px;
    padding: 4px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-owner-toggle-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-owner-toggle-chip:hover {
    color: var(--sb-text);
  }
  .sb-owner-toggle-chip-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15, 20, 25, 0.06);
  }
  .sb-owner-toggle-chip:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }

  /* Overview body — the two summary headline cards (when populated) sit
     in their own row above the curated ten-card grid. Two equal columns at
     desktop widths; a single column on phone. Cards keep their summaryStyle
     treatment (5px left border, 44px count) regardless of which container
     hosts them — the summary class doesn't depend on grid context. */
  .sb-owner-overview {
    margin-bottom: 16px;
  }
  .sb-owner-summary-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  @media (max-width: 720px) {
    .sb-owner-summary-row {
      grid-template-columns: 1fr;
    }
  }

  /* ── OWNER STACK ───────────────────────────────────────────────────────── */
  .sb-dept-owner {
    display: flex;
    flex-direction: column;
    gap: 64px;
  }

  /* Department jump strip — small horizontal nav at the top of the Owner
     view. Click a chip → smooth-scroll to that department block. Each chip
     shows a dot (worst urgency across that dept's buckets), the dept label,
     and the total count of work in flight. Stubs render without a count. */
  .sb-dept-owner-jumps {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0 18px;
    margin-bottom: -8px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-dept-owner-jump {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    padding: 6px 12px;
    border-radius: 999px;
    color: var(--sb-text);
    font: inherit;
    font-size: 13px;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-dept-owner-jump:hover {
    background: var(--sb-surface-muted);
  }
  .sb-dept-owner-jump:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }
  .sb-dept-owner-jump-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 999px;
  }
  .sb-dept-owner-jump-label {
    font-weight: 500;
  }
  .sb-dept-owner-jump-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .sb-dept-owner-block {
    scroll-margin-top: 16px;
  }
  /* Eyebrow — strong enough to break up a long Owner stack. Inline flex so
     the dot, label, and count sit on one baseline. Uppercase + letter-spacing
     gives the section a section-header presence; the hairline below seals it. */
  .sb-dept-owner-eyebrow {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 18px;
    padding-bottom: 8px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-dept-owner-eyebrow-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    align-self: center;
  }
  .sb-dept-owner-eyebrow-label {
    color: var(--sb-text);
  }
  .sb-dept-owner-eyebrow-count {
    color: var(--sb-text-muted);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .sb-dept-owner-stub {
    font-size: 14px;
    color: var(--sb-text-muted);
    line-height: 1.55;
    max-width: 56ch;
    padding: 12px 0 0;
  }

  @media (max-width: 720px) {
    .sb-dept-bucket-grid {
      grid-template-columns: 1fr 1fr;
    }
    .sb-dept-owner {
      gap: 48px;
    }
  }
  @media (max-width: 480px) {
    .sb-dept-bucket-grid {
      grid-template-columns: 1fr;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-dept-view-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-dept-view-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
