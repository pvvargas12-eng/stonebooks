// =============================================================================
// 📚 Stonebooks — Today (role-aware operational home)
// =============================================================================
// The Today tab is the operational home page for whoever is looking at it.
// The role selector picks the lens (Admin / Design / Sales / Production /
// Installation / Owner); the morning sentence and the three sections below
// (Overdue / Due today / Aging this week) all filter to that lens.
//
// Role selection is shared with the Jobs tab via workspaceState — switching
// here switches Jobs too, and vice versa. Default 'owner' (sees everything).
//
// Data layer: deriveTodayForRole(jobs, role) in stonebooksData.js does all
// the classification work. This file is a thin shell.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getJobs,
  deriveTodayForRole,
  roleNoun,
  URGENCY,
  getAllOpenPromises,
  indexPromisesByJob,
} from './lib/stonebooksData'
import {
  getSelectedRole,
  setSelectedRole,
} from './lib/workspaceState'
import RoleSelector from './components/RoleSelector'
import TodaySection from './components/TodaySection'
import AddPromiseModal from './components/AddPromiseModal'

// eslint-disable-next-line no-unused-vars
export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenJob, onOpenCustomer }) {
  const userId = user?.id || null
  const [role, setRole] = useState(() => getSelectedRole(userId))
  const [jobs, setJobs] = useState(null)
  const [promises, setPromises] = useState([])
  const [loadErr, setLoadErr] = useState(null)

  // Today is live — no caching. One fetch per mount; parallel-load
  // promises so the 🤡 badge renders on first paint, no flash of un-
  // badged rows.
  const loadJobs = useCallback(async () => {
    setLoadErr(null)
    try {
      const [data, ps] = await Promise.all([
        getJobs({ includeClosed: false }),
        getAllOpenPromises({}),
      ])
      setJobs(data || [])
      setPromises(ps || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load jobs')
      setJobs([])
    }
  }, [])
  useEffect(() => { loadJobs() }, [loadJobs])

  const promisesByJob = useMemo(
    () => indexPromisesByJob(promises),
    [promises],
  )

  // Quick-add promise — row hover button opens the modal with the job
  // already pinned. Reload after save so the new badge appears.
  const [promiseTarget, setPromiseTarget] = useState(null)
  const handlePromiseClick = (row) => {
    setPromiseTarget({
      jobId: row?.job?.id || null,
      label: row?.surname || row?.order?.primary_lastname || 'this job',
    })
  }

  const handleRoleChange = (next) => {
    setRole(next)
    setSelectedRole(userId, next)
  }

  // Derive once per (role, jobs) change. classifyRowUrgency + sort cost on a
  // 500-job dataset are trivial, but the memo keeps re-renders from rebuilding
  // the rows on unrelated state changes.
  const today = useMemo(() => {
    if (!jobs) return null
    return deriveTodayForRole(jobs, role)
  }, [jobs, role])

  // Date eyebrow — small quiet line above the morning sentence. Locale-formatted
  // weekday + month/day so it reads as briefing prose, not a timestamp.
  const dateLine = useMemo(() => {
    const d = new Date()
    const day  = d.toLocaleDateString('en-US', { weekday: 'long' })
    const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return `${day} · ${date}`
  }, [])

  const handleOpenRow = (row) => {
    if (row?.job?.id && onOpenJob) onOpenJob(row.job.id)
  }

  return (
    <div className="sb-page-wide sb-today-page">
      <RoleSelector active={role} onChange={handleRoleChange} ariaLabel="Today view by role" />

      <header className="sb-today-head">
        <div className="sb-today-date">{dateLine}</div>
        <h1 className="sb-today-sentence">
          {today === null ? "Reading the day's signals…" : today.morningSentence}
        </h1>
      </header>

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>
          {loadErr}
        </div>
      )}

      {today !== null && !loadErr && (
        <>
          <TodaySection
            label="Overdue"
            rows={today.overdue}
            urgency={today.overdue.length > 0 ? URGENCY.RED : URGENCY.NEUTRAL}
            emptyText="Nothing overdue. Good."
            onOpenRow={handleOpenRow}
            promisesByJob={promisesByJob}
            onPromiseClick={handlePromiseClick}
          />

          <TodaySection
            label="Due today"
            rows={today.dueToday}
            urgency={URGENCY.NEUTRAL}
            emptyText={`Nothing due today for ${roleNoun(role)}.`}
            onOpenRow={handleOpenRow}
            promisesByJob={promisesByJob}
            onPromiseClick={handlePromiseClick}
          />

          {/* Aging hides entirely when empty — keeps quiet days quiet. */}
          <TodaySection
            label="Aging this week"
            rows={today.aging}
            urgency={today.aging.length > 0 ? URGENCY.AMBER : URGENCY.NEUTRAL}
            emptyText=""
            hideWhenEmpty
            onOpenRow={handleOpenRow}
            promisesByJob={promisesByJob}
            onPromiseClick={handlePromiseClick}
          />
        </>
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
// STYLES
// =============================================================================
// Briefing posture: small date eyebrow, generous morning sentence, then the
// sections. Page-wide so the section panels match the Jobs tab's full-width
// queue tables. Most of the row + section chrome lives in TodayRow / TodaySection.

const localStyles = `
  .sb-today-page {
    padding-bottom: 96px;
  }

  /* Morning sentence block — date eyebrow + composed prose sentence. The
     sentence is the page's H1 but styled as a sentence (weight 400), not a
     title. Reading measure capped so it reads as briefing, not as a banner. */
  .sb-today-head {
    margin-bottom: 56px;
  }
  .sb-today-date {
    font-size: 14px;
    color: var(--sb-text-muted);
    margin-bottom: 14px;
  }
  .sb-today-sentence {
    font-size: 32px;
    font-weight: 400;
    letter-spacing: -0.012em;
    line-height: 1.32;
    color: var(--sb-text);
    margin: 0;
    max-width: 52ch;
  }

  @media (max-width: 720px) {
    .sb-today-head {
      margin-bottom: 44px;
    }
  }
  @media (max-width: 600px) {
    .sb-today-sentence {
      font-size: 26px;
      line-height: 1.35;
    }
  }
`

// Style-tag id rev'd because the row/section markup is materially different
// from the v2 signal-list. The old `sb-today-v2-styles` and
// `sb-today-tab-styles` tags from earlier iterations stay scoped to their own
// rules and no longer match anything on this page.
if (typeof document !== 'undefined' && !document.getElementById('sb-today-page-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-page-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
