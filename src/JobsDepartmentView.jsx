// =============================================================================
// 📚 Stonebooks — Jobs Department View
// =============================================================================
// Orchestrates the department-aware Jobs surface:
//   • Role selector at top-right (Admin · Design · Sales · Production ·
//     Installation · Owner). Persisted per-user via workspaceState.
//   • A row of bucket cards for the selected department
//   • A column of queue sections below, each anchored to one bucket
//   • Sales is the only stub left — its work mostly lives in the Orders tab.
//   • Owner view stacks all five departments — Admin, Design, Production, and
//     Installation render real bucket grids + queue sections; Sales renders an
//     honest stub. A small jump-link strip at the top of Owner view lets the
//     operator skip to a department; each department block carries a total
//     work-in-flight count + a worst-urgency dot in its eyebrow.
//
// Data layer: every bucket is built by stonebooksData.bucketsForDepartment()
// from a single jobs-fetch on mount. No per-bucket queries. The same row
// click handler from JobsTab is threaded through to open a JobDetail drill.
// =============================================================================

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  getJobs,
  DEPARTMENTS,
  bucketsForDepartment,
  worstUrgency,
  URGENCY,
} from './lib/stonebooksData'
import {
  getSelectedRole,
  setSelectedRole,
} from './lib/workspaceState'
import JobsBucketCard from './components/JobsBucketCard'
import JobsQueueSection from './components/JobsQueueSection'
import RoleSelector from './components/RoleSelector'

export default function JobsDepartmentView({ userId, onOpenJob }) {
  const [role, setRole] = useState(() => getSelectedRole(userId))
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

  const handleRoleChange = (next) => {
    setRole(next)
    setSelectedRole(userId, next)
  }

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
          ? <OwnerStack jobs={jobs} onOpenJob={onOpenJob} />
          : <DepartmentBody role={role} jobs={jobs} onOpenJob={onOpenJob} />
      )}
    </div>
  )
}

// =============================================================================
// DEPARTMENT BODY — non-Owner roles
// =============================================================================

function DepartmentBody({ role, jobs, onOpenJob }) {
  const dept = DEPARTMENTS.find(d => d.code === role)
  if (!dept) return null
  if (dept.stub) {
    return <DepartmentStub label={dept.label} />
  }
  return <DepartmentBuckets dept={dept} jobs={jobs} onOpenJob={onOpenJob} />
}

// Render: bucket-card grid + queue sections. Each card focus-scrolls its
// queue section into view (smooth scroll, scroll-margin-top on the section).
function DepartmentBuckets({ dept, jobs, onOpenJob }) {
  const buckets = useMemo(
    () => bucketsForDepartment(dept.code, jobs) || [],
    [dept.code, jobs],
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
            onOpenRow={(row) => onOpenJob?.(row.job.id)}
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
          Sales work mostly lives in the Orders tab — estimates, quotes,
          follow-ups. Sales doesn't have job-stage buckets yet. We'll wire
          this up after the Orders vs Jobs model is settled.
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
// OWNER VIEW
// =============================================================================
// Stacks all five departments in a single scrollable page. Each department
// gets a header eyebrow, its bucket grid, and its queue sections. Four of
// the five departments (Admin, Design, Production, Installation) are real;
// Sales remains a stub with an honest one-liner explaining that its work
// mostly lives in the Orders tab. Stub blocks render only the header + the
// one-liner — no bucket grid for stubs, keeping the page from feeling padded
// with empty surfaces.

// Worst-urgency dot color used in both the Owner jump strip and each
// department's eyebrow. Mirrors the JobsBucketCard / JobsQueueSection palette
// so the operator's eye learns one color vocabulary across the page.
const URGENCY_DOT_COLOR = {
  [URGENCY.NEUTRAL]: 'var(--sb-border)',
  [URGENCY.AMBER]:   'var(--sb-amber, #b8842a)',
  [URGENCY.RED]:     'var(--sb-red, #b54040)',
}

// Compute the per-department summary used by the jump strip and the eyebrows.
// Returns [{ dept, anchorId, totalCount, urgency }] in DEPARTMENTS order so
// stub departments slot into the strip at their natural position.
function _ownerDeptSummaries(jobs) {
  return DEPARTMENTS.map(dept => {
    const anchorId = `dept-${dept.code}`
    if (dept.stub) {
      return { dept, anchorId, totalCount: null, urgency: URGENCY.NEUTRAL }
    }
    const buckets = bucketsForDepartment(dept.code, jobs) || []
    const totalCount = buckets.reduce((sum, b) => sum + (b.count || 0), 0)
    const allRows = buckets.flatMap(b => b.rows || [])
    return { dept, anchorId, totalCount, urgency: worstUrgency(allRows) }
  })
}

function OwnerStack({ jobs, onOpenJob }) {
  const summaries = useMemo(() => _ownerDeptSummaries(jobs), [jobs])

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
          onOpenJob={onOpenJob}
        />
      ))}
    </div>
  )
}

function OwnerDepartmentBlock({ dept, anchorId, totalCount, urgency, jobs, onOpenJob }) {
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
            ? 'Sales work mostly lives in the Orders tab — job-stage buckets will come once the Orders vs Jobs model is settled.'
            : `Coming soon — queues for ${dept.label.toLowerCase()} will land in a follow-up pass.`}
        </div>
      ) : (
        <DepartmentBuckets dept={dept} jobs={jobs} onOpenJob={onOpenJob} />
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
