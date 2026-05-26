// =============================================================================
// 📚 Stonebooks — Jobs Department View
// =============================================================================
// Orchestrates the department-aware Jobs surface:
//   • Role selector at top-right (Admin · Design · Sales · Production ·
//     Installation · Owner). Persisted per-user via workspaceState.
//   • A row of bucket cards for the selected department
//   • A column of queue sections below, each anchored to one bucket
//   • Stub panels for Admin / Design / Sales (single "Coming soon" message)
//   • Owner view stacks all five departments — Production and Installation
//     get real bucket grids + queue sections, the other three are stubs.
//
// Data layer: every bucket is built by stonebooksData.bucketsForDepartment()
// from a single jobs-fetch on mount. No per-bucket queries. The same row
// click handler from JobsTab is threaded through to open a JobDetail drill.
//
// The L2-followup spec deliberately defers role-driven Today views, one-tap
// status updates inside queue rows, and any data-model changes. Those land in
// follow-up passes.
// =============================================================================

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  getJobs,
  DEPARTMENTS,
  bucketsForDepartment,
} from './lib/stonebooksData'
import {
  getSelectedRole,
  setSelectedRole,
} from './lib/workspaceState'
import JobsBucketCard from './components/JobsBucketCard'
import JobsQueueSection from './components/JobsQueueSection'

const ROLES = [
  { code: 'admin',        label: 'Admin' },
  { code: 'design',       label: 'Design' },
  { code: 'sales',        label: 'Sales' },
  { code: 'production',   label: 'Production' },
  { code: 'installation', label: 'Installation' },
  { code: 'owner',        label: 'Owner' },
]

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
// ROLE SELECTOR
// =============================================================================
// Top-right segmented selector. Not auth — anyone can switch. Persists via
// workspaceState. Visual posture: borderless chips, weight-500 active, subtle
// hover; the same calm vocabulary the workspace strip uses.

function RoleSelector({ active, onChange }) {
  return (
    <div className="sb-role-selector" role="tablist" aria-label="Department view">
      {ROLES.map(r => {
        const isActive = r.code === active
        return (
          <button
            key={r.code}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`sb-role-chip ${isActive ? 'sb-role-chip-active' : ''}`}
            onClick={() => onChange(r.code)}
          >
            {r.label}
          </button>
        )
      })}
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

// Coming-soon stub for Admin / Design / Sales until their queues are built.
function DepartmentStub({ label }) {
  return (
    <div className="sb-dept-stub">
      <div className="sb-dept-stub-eyebrow">{label}</div>
      <div className="sb-dept-stub-body">
        Coming soon. The {label.toLowerCase()} department's bucket grid and
        queues will land in a follow-up pass. The page shape is reserved here
        so the role selector behaves consistently while the work is being done.
      </div>
    </div>
  )
}

// =============================================================================
// OWNER VIEW
// =============================================================================
// Stacks all five departments in a single scrollable page. Each department
// gets a header eyebrow, its bucket grid, and (for Production / Installation)
// its queue sections. Stub departments only show the header + a one-line
// "Coming soon" note — no bucket grid for stubs in Owner view, keeps the
// page from feeling padded with empty surfaces.

function OwnerStack({ jobs, onOpenJob }) {
  return (
    <div className="sb-dept-owner">
      {DEPARTMENTS.map(dept => (
        <OwnerDepartmentBlock
          key={dept.code}
          dept={dept}
          jobs={jobs}
          onOpenJob={onOpenJob}
        />
      ))}
    </div>
  )
}

function OwnerDepartmentBlock({ dept, jobs, onOpenJob }) {
  return (
    <section className="sb-dept-owner-block">
      <div className="sb-dept-owner-eyebrow">{dept.label}</div>
      {dept.stub ? (
        <div className="sb-dept-owner-stub">
          Coming soon — queues for {dept.label.toLowerCase()} will land in a
          follow-up pass.
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

  /* ── ROLE SELECTOR ─────────────────────────────────────────────────────── */

  .sb-role-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
    margin-bottom: 32px;
    padding: 4px 0;
  }
  .sb-role-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 14px;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-role-chip:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-role-chip-active {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
    font-weight: 500;
  }
  .sb-role-chip:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
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
  .sb-dept-owner-block {
    /* Anchors to allow eventual nav-from-roll-up if Owner ever needs it. */
  }
  .sb-dept-owner-eyebrow {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 18px;
    padding-bottom: 8px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-dept-owner-stub {
    font-size: 14px;
    color: var(--sb-text-muted);
    line-height: 1.55;
    max-width: 56ch;
    padding: 12px 0 0;
  }

  @media (max-width: 720px) {
    .sb-role-selector {
      justify-content: flex-start;
    }
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
