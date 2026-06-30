// =============================================================================
// 📚 Stonebooks — Jobs operational hubs (JOBS-OPERATIONAL-HUBS Phase 1A)
// =============================================================================
// Four operational hubs share the Jobs surface:
//
//   • Admin Hub        — intake, permits, payments, cemetery + family follow-ups
//   • Design Hub       — layouts, proofs, inscriptions, bronze, photo, etching
//   • Production Hub   — stone, cutting, blasting, washing, foundation pours
//   • Installation Hub — foundations to set, stones ready, scheduled trips, doors
//
// The page lays out four large HubCards across the top — each shows the hub's
// in-flight count and an urgency dot. Click one to drill into its actionable
// list. Below the strip lives a chip row of hub-aware filters (each hub
// publishes its own set in HUB_DEFS.filterChips). Below that is the
// family-first JobRow table — the same row vocabulary the flat "Jobs — All"
// list uses, just scoped to whichever hub is selected.
//
// Sales Hub and Owner aggregator are Phase 1B follow-up. The pre-Phase-1A
// orphan code that powered those surfaces (RoleSelector with 6 roles,
// JobsBucketCard grid, JobsQueueSection stack, OwnerAttentionListView,
// OwnerStack, OwnerOverview, SalesView) is intact as separate component
// files under src/components/ — Phase 1B will rewrite this container to
// import them again when Sales and Owner hubs land.
//
// This file replaces the pre-Phase-1A 882-line department aggregator. The
// substrate it delegates to (DEPARTMENTS, bucketsForDepartment, ROLE_GROUP_MAP,
// roleForMilestone) is still live in stonebooksData.js and used by Today /
// Scheduler / Reports.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getJobs,
  listAllOrders,
  HUB_DEFS,
  getHubWorkItems,
  getCurrentProofsByJob,
  getOrdersWithCurrentProof,
} from './lib/stonebooksData'
import {
  getSelectedHub, setSelectedHub,
} from './lib/workspaceState'
import { FilterChip } from './lib/crmComponents.jsx'
import { JobRow } from './lib/jobsRow'
import { enrichJob, ROW_GRID } from './lib/jobsRowHelpers'
// JOBS-OPERATIONAL-HUBS Phase 2A.2 — Design hub branches to a dedicated
// studio-style Surface 1 (Studio Queue + Selected Job Preview). Other hubs
// keep their list-view body unchanged.
import DesignHubHome from './DesignHubHome'
import HubHome from './HubHome'
import { HUB_HOME_CONFIGS } from './lib/hubConfigs'
// The Workflow queues + Permit hub used to be separate top-level tabs. They
// now live INSIDE the Jobs hub strip as two "section" hubs, reusing the
// existing components unchanged (no separate Operations / Permit / Workflow
// tabs anywhere).
import QueuesTab from './QueuesTab'
import PermitHub from './PermitHub'
import QuoteHub from './QuoteHub'

// Hub render order — Admin → Design → Production → Installation. Mirrors the
// workflow from office through shop to field. Owner aggregator + Sales sit
// in Phase 1B; their slots aren't shown here.
const HUB_ORDER = ['admin', 'design', 'production', 'installation']

// Section hubs — not job-milestone work-item hubs. They re-parent a whole
// existing surface (Workflow queues dashboard / Permit command center) as a
// hub body. They carry no getHubWorkItems count; their cards show a label +
// description and open the full section below the strip.
const SECTION_HUBS = [
  { code: 'workflow', label: 'Workflow', description: 'Production queues — designs, stones, foundations, installs' },
  { code: 'permits',  label: 'Permits',  description: 'Permit filing + what’s blocking install' },
  { code: 'quote',    label: 'Quote Hub', description: 'Owner approval — review + adjust quotes before they go out' },
]
const SECTION_CODES = SECTION_HUBS.map(s => s.code)
const ALL_HUB_CODES = [...HUB_ORDER, ...SECTION_CODES]

// Sort options. Hub items arrive pre-sorted by getHubWorkItems
// (urgent-first → recency → family name). The other sort options re-sort
// the already-filtered list.
const SORT_OPTIONS = [
  { code: 'actionPriority', label: 'Sort: Action priority' },
  { code: 'lastActivity',   label: 'Sort: Recent activity' },
  { code: 'familyName',     label: 'Sort: Family name A→Z' },
]

// =============================================================================
// MAIN
// =============================================================================

export default function JobsDepartmentView({
  userId,
  onOpenJob,
  // Forwarded for forward compatibility — Phase 1B Owner Hub will need
  // tab + order/customer drill-throughs.
  onSwitchTab,      // eslint-disable-line no-unused-vars
  onOpenOrder,      // eslint-disable-line no-unused-vars
  onOpenOrderDetail, // ITEM 5 — closeout tasks open OrderDetail (photos + AI draft)
  onOpenCustomer,
  // For the Workflow + Permits section hubs (reused QueuesTab / PermitHub):
  // open the Orders list pre-filtered to a queue / open the order form.
  onOpenQueue,
  onEditOrder,
  // Slot for the parent JobsTab's Hubs/All view toggle so it sits in the
  // page header alongside the search box rather than floating elsewhere.
  headerSlot = null,
  // PART 1 restructure — when the parent Jobs tab-row drives the hub, it passes
  // forcedHub and hides this view's own HubSelectorStrip (the tab row replaces
  // it). All existing per-hub bodies render unchanged — nothing is lost.
  forcedHub = null,
  hideStrip = false,
}) {
  // When the parent tab-row drives selection, `hub` is simply forcedHub (no
  // local state to sync). Otherwise it's internal, switched via the strip.
  const [internalHub, setHub] = useState(() => getSelectedHub(userId))
  const hub = forcedHub || internalHub
  const [jobs, setJobs] = useState(null)
  const [orders, setOrders] = useState(null)             // consumed by the Quote Hub section
  // The CURRENT proof_versions row per job (Map job_id → {sent_at, approved_at}) —
  // the real source of truth behind the Design hub's four-state machine.
  const [currentProofsByJob, setCurrentProofsByJob] = useState(() => new Map())
  // Order ids (leads) that already have a CURRENT order-scoped layout — drives the
  // Estimate-layouts tab's "has a layout" indicator.
  const [currentProofOrderIds, setCurrentProofOrderIds] = useState(() => new Set())
  const [loadErr, setLoadErr] = useState(null)
  const [loading, setLoading] = useState(true)

  // Hub-local filters. Cleared on hub switch — chips from one hub don't
  // apply in another (each hub publishes its own filterChips set).
  const [hubFilters, setHubFilters] = useState(new Set())
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('actionPriority')

  // Load. Pulls jobs + orders in parallel. Orders are forward-loaded for
  // Phase 1B Sales Hub (which needs orders, not jobs, for its lead pipeline).
  // Today they're only consumed if the operator opens the Phase 1B surface.
  const loadJobs = useCallback(async () => {
    setLoadErr(null)
    setLoading(true)
    try {
      const [jobData, orderData, proofMap, proofOrderIds] = await Promise.all([
        getJobs({ includeClosed: false, limit: 1000 }),
        listAllOrders({ limit: 500 }),
        getCurrentProofsByJob(),
        getOrdersWithCurrentProof(),
      ])
      setCurrentProofsByJob(proofMap)
      setCurrentProofOrderIds(proofOrderIds)
      // Match JOBS-RESKIN-PASS guard: getJobs({includeClosed:false}) excludes
      // only overall_status='closed'; 'cancelled' jobs leak in unless we
      // filter them. Cancelled is operationally a dead state, not an active
      // one — keep them out of the hub view too.
      const filtered = (jobData || []).filter(j => j.overall_status !== 'cancelled')
      setJobs(filtered)
      setOrders(orderData || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load hub data')
      setJobs([])
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { loadJobs() }, [loadJobs])

  // All four hubs computed every render — counts drive the HubCards, items
  // drive whichever hub is active. Each getHubWorkItems run is O(N jobs ×
  // M milestones) due to the per-job pressure compute; ~50-100 jobs means
  // a single-digit-ms recompute per load. useMemo gates re-runs to job changes.
  const hubData = useMemo(() => {
    if (!jobs) return null
    return {
      admin:        getHubWorkItems('admin',        jobs),
      design:       getHubWorkItems('design',       jobs),
      production:   getHubWorkItems('production',   jobs),
      installation: getHubWorkItems('installation', jobs),
    }
  }, [jobs])

  const currentDef  = HUB_DEFS[hub]
  const currentData = hubData?.[hub] || null

  // Hub switching — persists selection so the operator's last hub re-opens
  // on next visit. Also clears chip filters + urgent toggle so a stale
  // Admin filter doesn't carry into Production.
  const handleHubChange = (next) => {
    if (!ALL_HUB_CODES.includes(next)) return
    setHub(next)
    setSelectedHub(userId, next)
    setHubFilters(new Set())
    setUrgentOnly(false)
  }

  // Apply hub-local filters → search → optional re-sort, then enrich for
  // JobRow. enrichJob runs computeOrderPressure again on each visible job
  // (cheap; the hub-level pressure that getHubWorkItems computed lives on
  // the hub item, not the underlying job). Phase 1B optimisation: thread
  // pressure through so this second pass is a no-op.
  const visibleRows = useMemo(() => {
    if (!currentData) return []
    let list = currentData.items
    if (urgentOnly) list = list.filter(it => it.urgent)
    if (hubFilters.size > 0) {
      list = list.filter(it => {
        for (const code of hubFilters) {
          const chip = currentDef.filterChips.find(c => c.code === code)
          if (chip && chip.match(it)) return true
        }
        return false
      })
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(it => {
        const hay = [
          it.order?.primary_lastname,
          it.order?.customer?.first_name,
          it.order?.customer?.last_name,
          it.order?.order_number,
          it.order?.cemetery?.name,
          it.order?.sales_rep,
          it.job?.id?.slice(0, 8),
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }
    // Default action-priority comes pre-sorted from getHubWorkItems. Only
    // re-sort when the operator picks a different ordering.
    if (sortKey === 'lastActivity') {
      list = [...list].sort((a, b) => {
        const aT = a.job.last_update_at ? new Date(a.job.last_update_at).getTime() : 0
        const bT = b.job.last_update_at ? new Date(b.job.last_update_at).getTime() : 0
        return bT - aT
      })
    } else if (sortKey === 'familyName') {
      list = [...list].sort((a, b) => {
        const aN = a.order?.primary_lastname || ''
        const bN = b.order?.primary_lastname || ''
        return aN.localeCompare(bN)
      })
    }
    return list.map(it => enrichJob(it.job))
  }, [currentData, currentDef, urgentOnly, hubFilters, search, sortKey])

  // Hub-card count strip. Renders even while jobs are loading so the
  // structure is visible (counts come in as 0 until data lands, then fill).
  const isDesignHub = hub === 'design'
  const isSectionHub = SECTION_CODES.includes(hub)
  // Studio hubs render their own two-column surface (title + chips + queue +
  // preview) and suppress the generic Jobs header count / search / banner.
  const isStudioHub = isDesignHub || hub === 'production' || hub === 'installation'

  const headerCount = (loading || !currentDef)
    ? '—'
    : currentData
      ? `${visibleRows.length} of ${currentData.counts.total} in ${currentDef.label}`
      : `0 in ${currentDef.label}`

  return (
    <div className="sb-crm-page">
      <div className="sb-crm-container">
        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Jobs</h1>
            {/* Design hub renders its own count + status prose in the
                DESIGN HUB sub-line below, so we suppress the generic
                "N of M in Design" line when the design hub is active. */}
            {!isStudioHub && !isSectionHub && (
              <div className="sb-crm-head-count">
                {headerCount}
                {!loading && currentData?.counts?.urgent > 0 && (
                  <> · <strong>{currentData.counts.urgent}</strong> need{currentData.counts.urgent === 1 ? 's' : ''} attention</>
                )}
              </div>
            )}
            {isSectionHub && (
              <div className="sb-crm-head-count">
                {SECTION_HUBS.find(s => s.code === hub)?.description}
              </div>
            )}
          </div>
          <div className="sb-crm-head-actions">
            {/* Search + sort apply to the list views (Admin/Production/
                Installation). Design hub uses its own filter chips inside
                DesignHubHome — hide the generic search/sort here. */}
            {!isStudioHub && !isSectionHub && (
              <>
                <input
                  type="search"
                  className="sb-crm-search"
                  placeholder="Search family, deceased, order #, cemetery…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <select
                  className="sb-crm-sort"
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value)}
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </select>
              </>
            )}
            {headerSlot}
          </div>
        </header>

        {loadErr && <div className="sb-crm-error">{loadErr}</div>}

        {/* List-view-only banner — design hub is two-column and reads fine
            at narrower widths. */}
        {!isDesignHub && !isSectionHub && (
          <div className="sb-crm-min-width-banner">
            Best viewed on desktop — the row layout is dense. Phone view falls back to a single-column stack.
          </div>
        )}

        {/* Hub selector — 4 cards across the top. Hidden when the parent Jobs
            tab-row drives hub selection (hideStrip). */}
        {!hideStrip && (
          <HubSelectorStrip
            hubData={hubData}
            selectedHub={hub}
            onSelect={handleHubChange}
            loading={loading}
          />
        )}
      </div>

      {/* BRANCH — Workflow + Permits section hubs re-parent a whole existing
          surface; Design hub gets the studio surface; other hubs keep the
          list-view body. */}
      {hub === 'quote' ? (
        <div className="sb-crm-container">
          <QuoteHub orders={orders || []} jobs={jobs || []} onReload={loadJobs} onEditOrder={onEditOrder} />
        </div>
      ) : hub === 'workflow' ? (
        <QueuesTab onOpenQueue={onOpenQueue} />
      ) : hub === 'permits' ? (
        <PermitHub
          onOpenQueue={onOpenQueue}
          onEditOrder={onEditOrder}
          onOpenJob={onOpenJob}
          onOpenCustomer={onOpenCustomer}
        />
      ) : isStudioHub ? (
        loading ? (
          <div className="sb-crm-container">
            <div className="sb-crm-empty">Loading hub work…</div>
          </div>
        ) : isDesignHub ? (
          <DesignHubHome
            jobs={jobs || []}
            orders={orders || []}
            currentProofsByJob={currentProofsByJob}
            currentProofOrderIds={currentProofOrderIds}
            onOpenJob={onOpenJob}
            onOpenOrder={onOpenOrderDetail}
            onReload={loadJobs}
          />
        ) : (
          <HubHome hubData={currentData} onOpenJob={onOpenJob} config={HUB_HOME_CONFIGS[hub]} />
        )
      ) : (
        <div className="sb-crm-container">
          {/* Hub-aware filter chips */}
          <HubFilterChips
            def={currentDef}
            hubFilters={hubFilters}
            setHubFilters={setHubFilters}
            urgentOnly={urgentOnly}
            setUrgentOnly={setUrgentOnly}
            urgentCount={currentData?.counts?.urgent || 0}
          />

          {/* Body */}
          <div className="sb-crm-card sb-crm-table">
            <div className="sb-crm-row sb-crm-row-head" style={{ gridTemplateColumns: ROW_GRID }}>
              <div>Family / Stone</div>
              <div>Order</div>
              <div>Cemetery</div>
              <div>Stage</div>
              <div>Payment</div>
              <div>Blocker</div>
              <div className="num">Age</div>
              <div className="num">Updated</div>
            </div>

            {loading ? (
              <div className="sb-crm-empty">Loading hub work…</div>
            ) : !currentData || currentData.items.length === 0 ? (
              <EmptyHub def={currentDef} />
            ) : visibleRows.length === 0 ? (
              <div className="sb-crm-empty">
                No items match these filters in {currentDef.label}.
                <div>
                  <button
                    type="button"
                    onClick={() => { setHubFilters(new Set()); setUrgentOnly(false); setSearch('') }}
                  >Reset filters</button>
                </div>
              </div>
            ) : (
              visibleRows.map(j => (
                <JobRow
                  key={j.id}
                  job={j}
                  onOpen={(id) => {
                    // ITEM 5 — a closeout task lands on the order's closeout
                    // surface (OrderDetail: completion photos + AI closeout
                    // draft), not the job detail. Everything else opens the job.
                    if (j._pressure?.blocker?.kind === 'closeout_pending' && j.order?.id && onOpenOrderDetail) {
                      onOpenOrderDetail(j.order.id)
                    } else {
                      onOpenJob(id)
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// HUB SELECTOR STRIP — 4 large hub cards across the top
// =============================================================================

function HubSelectorStrip({ hubData, selectedHub, onSelect, loading }) {
  return (
    <div className="sb-hub-strip" role="tablist" aria-label="Operational hubs">
      {HUB_ORDER.map(code => {
        const def = HUB_DEFS[code]
        const data = hubData?.[code] || null
        return (
          <HubCard
            key={code}
            code={code}
            def={def}
            data={data}
            active={code === selectedHub}
            loading={loading}
            onClick={() => onSelect(code)}
          />
        )
      })}
      {SECTION_HUBS.map(def => (
        <HubCard
          key={def.code}
          code={def.code}
          def={def}
          isSection
          active={def.code === selectedHub}
          loading={loading}
          onClick={() => onSelect(def.code)}
        />
      ))}
    </div>
  )
}

function HubCard({ code, def, data, active, loading, onClick, isSection = false }) {
  // Section hubs (Workflow / Permits) re-parent a whole surface and carry no
  // work-item count — render label + description + an "Open" affordance.
  if (isSection) {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={`sb-hub-card sb-hub-card-section ${active ? 'sb-hub-card-active' : ''}`}
        onClick={onClick}
      >
        <div className="sb-hub-card-head">
          <span className="sb-hub-card-dot sb-hub-card-dot-section" aria-hidden="true" />
          <span className="sb-hub-card-label">{def.label}</span>
        </div>
        <div className="sb-hub-card-section-open">Open →</div>
        <div className="sb-hub-card-desc">{def.description}</div>
      </button>
    )
  }
  const urgent = data?.counts?.urgent ?? 0
  const total  = data?.counts?.total ?? 0
  // Dot color earns urgency: red for any urgent, amber for in-flight without
  // urgent items, neutral when the hub is empty.
  const dotState =
    loading ? 'loading' :
    urgent > 0 ? 'urgent' :
    total > 0  ? 'flight' :
                 'quiet'
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`sb-hub-card ${active ? 'sb-hub-card-active' : ''}`}
      onClick={onClick}
    >
      <div className="sb-hub-card-head">
        <span className={`sb-hub-card-dot sb-hub-card-dot-${dotState}`} aria-hidden="true" />
        <span className="sb-hub-card-label">{def.label}</span>
      </div>
      <div className="sb-hub-card-count">
        {loading ? '—' : total}
      </div>
      <div className="sb-hub-card-meta">
        {/* "needs attention" is the consistent vocabulary across this surface
            (matches the chip label + JOBS-RESKIN-PASS naming). The count
            includes both red and amber severity items — anything where the
            blocker says "act today." */}
        {loading ? 'loading…'
          : urgent > 0 ? `${urgent} need${urgent === 1 ? 's' : ''} attention`
          : total === 0 ? 'all clear'
          : 'in flight'}
      </div>
      <div className="sb-hub-card-desc">{def.description}</div>
    </button>
  )
}

// =============================================================================
// FILTER CHIPS
// =============================================================================

function HubFilterChips({ def, hubFilters, setHubFilters, urgentOnly, setUrgentOnly, urgentCount }) {
  const toggle = (code) => {
    const next = new Set(hubFilters)
    if (next.has(code)) next.delete(code); else next.add(code)
    setHubFilters(next)
  }
  // "Needs attention" matches the JOBS-RESKIN-PASS flat list's chip label —
  // CRM Practicality review pointed out "Urgent only" reads as red-only,
  // but the underlying severity test catches red AND amber. "Needs attention"
  // is the established vocabulary for "act on this today."
  return (
    <div className="sb-crm-chip-row">
      <div className="sb-crm-chip-group">
        <FilterChip
          active={urgentOnly}
          onClick={() => setUrgentOnly(v => !v)}
          count={urgentCount}
        >
          Needs attention
        </FilterChip>
      </div>
      <div className="sb-crm-chip-group">
        <span className="sb-crm-chip-group-label">In {def.label}</span>
        {def.filterChips.map(chip => (
          <FilterChip
            key={chip.code}
            active={hubFilters.has(chip.code)}
            onClick={() => toggle(chip.code)}
          >
            {chip.label}
          </FilterChip>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// EMPTY HUB STATE
// =============================================================================

function EmptyHub({ def }) {
  return (
    <div className="sb-hub-empty">
      <div className="sb-hub-empty-glyph" aria-hidden="true">✓</div>
      <div className="sb-hub-empty-text">{def.emptyMessage}</div>
    </div>
  )
}

// =============================================================================
// STYLES — injected once on first mount
// =============================================================================
// Hub strip + cards + empty state. The .sb-crm-* classes used by header,
// table, and chips come from src/lib/crmTheme.js (shared with Customers /
// Orders / flat Jobs). This block only adds the hub-specific primitives.

const localStyles = `
  /* ── HUB STRIP ─────────────────────────────────────────────────────────
     Four cards in an auto-fit grid. At desktop widths they sit side-by-side
     (1fr each); at tablet they wrap 2×2; at phone they stack. */
  .sb-hub-strip {
    display: grid;
    /* auto-fit: as many ≥180px cards per row as fit, reflowing by width (was a
       fixed 6-up). The narrow-width media steps below stay as explicit fallbacks. */
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 0 32px 24px 32px;
  }
  @media (max-width: 1200px) {
    .sb-hub-strip {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 980px) {
    .sb-hub-strip {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 560px) {
    .sb-hub-strip {
      grid-template-columns: 1fr;
    }
  }

  /* ── HUB CARD ──────────────────────────────────────────────────────────
     Calm by default — surface card with hairline border. Active card gets
     a stronger left rule + slightly darker surface so the operator's eye
     locks onto which hub is open. No emoji, no icons; an urgency dot
     does the chrome. */
  .sb-hub-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    width: 100%;
    min-height: 132px;
    padding: 18px 20px 16px 20px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s, border-color 0.12s, transform 0.12s;
  }
  .sb-hub-card:hover {
    background: var(--sb-surface-muted);
  }
  .sb-hub-card:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.18));
  }
  .sb-hub-card-active {
    background: var(--sb-surface-muted);
    border-left-color: var(--sb-accent, #b8842a);
  }

  /* Card head: dot + label, one baseline. The label is uppercase + tight
     letter-spacing — same vocabulary the JobsBucketCard uses, so operators
     who know the legacy view feel at home. */
  .sb-hub-card-head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .sb-hub-card-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--sb-border);
  }
  .sb-hub-card-dot-urgent { background: var(--sb-red, #b54040); }
  .sb-hub-card-dot-flight { background: var(--sb-amber, #b8842a); }
  .sb-hub-card-dot-quiet  { background: var(--sb-border); }
  .sb-hub-card-dot-loading {
    background: transparent;
    border: 1px solid var(--sb-border);
  }
  /* Section hub (Workflow / Permits) — a hollow bronze dot marks it as a
     "opens a surface" card rather than a counted work-item hub. */
  .sb-hub-card-dot-section {
    background: transparent;
    border: 1.5px solid var(--sb-accent, #b8842a);
  }
  .sb-hub-card-section-open {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-accent, #b8842a);
    margin-bottom: 10px;
  }
  .sb-hub-card-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    line-height: 1.2;
  }

  /* Count — the load-bearing number. Tabular numerals + slight negative
     letter-spacing so 8 vs 80 vs 800 all sit visually balanced. */
  .sb-hub-card-count {
    font-size: 34px;
    font-weight: 500;
    line-height: 1;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }

  /* Meta line — "N urgent" / "in flight" / "all clear". Subtle, but the
     "urgent" variant gets the red ink so the eye catches it without a
     second look at the dot. */
  .sb-hub-card-meta {
    font-size: 12px;
    font-weight: 400;
    color: var(--sb-text-muted);
    margin-bottom: 10px;
    font-variant-numeric: tabular-nums;
  }
  .sb-hub-card-dot-urgent + .sb-hub-card-label,
  .sb-hub-card:has(.sb-hub-card-dot-urgent) .sb-hub-card-meta {
    color: var(--sb-red, #b54040);
  }

  /* Description — one sentence telling Paul "what this hub holds." Hidden
     on small screens where vertical real estate matters more. */
  .sb-hub-card-desc {
    font-size: 12px;
    color: var(--sb-text-muted);
    line-height: 1.4;
    margin-top: auto;
  }
  @media (max-width: 560px) {
    .sb-hub-card-desc { display: none; }
    .sb-hub-card { min-height: 102px; }
  }

  /* ── EMPTY HUB ────────────────────────────────────────────────────────
     When a hub has zero items, the table card replaces its row stack with
     a calm empty state. The "✓" glyph is intentionally quiet — empty hub
     should feel like rest, not blank-canvas-with-something-missing. */
  .sb-hub-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
  }
  .sb-hub-empty-glyph {
    font-size: 32px;
    color: var(--sb-text-muted);
    margin-bottom: 16px;
    line-height: 1;
  }
  .sb-hub-empty-text {
    font-size: 14px;
    color: var(--sb-text-secondary);
    max-width: 360px;
    line-height: 1.55;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-hubs-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-hubs-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
