// =============================================================================
// weekPlanning — put a job on a day (and take it off) — ONE write path
// =============================================================================
// The desktop Install Planner / Inscription Scheduler and the phone's
// SCHEDULE tab (FIELD-SCHEDULE, 2026-10-12) build the same week: the week list
// is week_plan_items (lane 'set' / 'inscription'), the days are Scheduler
// work_batches of the track's kind, one trip per cemetery per day, and
// placing a job stamps its completion milestone in_progress with that date.
// Paul: "same truth as desktop as always" — so both screens call these.
// =============================================================================
import {
  createBatch, addJobsToBatch, removeJobFromBatch, updateMilestoneWithOverride,
  logOrderActivity, getCurrentStaffName, installGates,
} from './stonebooksData'

const msBy = (job) => new Map((job?.milestones || []).map(m => [m.milestone_key, m]))
const stencilCutDone = (job) => { const m = msBy(job).get('stencil_cut'); return !!m && (m.status === 'done' || m.status === 'not_needed') }

export const TRACKS = {
  set: {
    key: 'set', lane: 'set', batchKind: 'setting', title: 'Install Planner', activityField: 'Install',
    thing: 'stone', things: 'stones', verb: 'install', notDone: 'not installed',
    milestoneKeys: ['installed', 'door_installed', 'work_completed'], scheduledKey: null,
  },
  inscription: {
    key: 'inscription', lane: 'inscription', batchKind: 'inscription', title: 'Inscription Scheduler', activityField: 'Inscription',
    thing: 'inscription', things: 'inscriptions', verb: 'inscription', notDone: 'not completed',
    // `inscription_completed` is the job milestone; `inscription_complete` is the FLOOR phase.
    milestoneKeys: ['inscription_completed', 'work_completed'], scheduledKey: 'field_work_scheduled',
  },
}

export const trackMilestone = (job, track) => { const by = msBy(job); for (const k of track.milestoneKeys) { const m = by.get(k); if (m) return m } return null }
export const jobDoneForTrack = (job, track) => !!job && (trackMilestone(job, track)?.status === 'done' || ['closed', 'cancelled'].includes(job.overall_status))
export const cemIdOf = (job) => job?.cemetery?.id || job?.order?.cemetery?.id || job?.order?.cemetery_id || null
export const cemNameOf = (job) => job?.order?.cemetery?.name || job?.cemetery?.name || ''
export const familyOf = (job) => job?.order?.primary_lastname || job?.customer?.last_name
  || [job?.customer?.first_name, job?.customer?.last_name].filter(Boolean).join(' ') || '—'

// The track's gates — what READY means on each screen.
export function trackGates(job, track) {
  const g = installGates(job?.order || {}, job)
  if (track.key === 'inscription') return { paid: g.paid, permit: g.permit, cut: stencilCutDone(job) }
  return g
}
export function trackReady(job, track) {
  const g = trackGates(job, track)
  if (track.key === 'inscription') return g.paid !== false && g.permit !== false && g.cut !== false
  return g.paid !== false && g.fdn !== false && g.permit !== false && g.blasted !== false
}

const fmtDay = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Put `job` on `iso`: leave its current trip, leave any stale past-week trip,
// join (or create) that day's trip for its cemetery, stamp the milestone.
// `batches` = this week's batches of the track's kind; `pastBatches` = older
// ones (a rolled-over job may still sit on one — placing clears it).
export async function placeJobOnDay({ track, job, iso, batches, pastBatches = [], todayIso, source }) {
  if (!job) return { ok: false, error: 'Job not loaded' }
  if (todayIso && iso < todayIso) return { ok: false, error: `${fmtDay(iso)} has already passed — pick today or later.` }
  const cemId = cemIdOf(job)
  if (!cemId) return { ok: false, error: `${familyOf(job)} has no cemetery linked — link one on the order first.` }
  const prev = batches.find(b => (b.batch_jobs || []).some(l => l.job_id === job.id))
  if (prev) { const r = await removeJobFromBatch(prev.id, job.id); if (!r.ok) return r }
  for (const b of pastBatches) {
    if ((b.batch_jobs || []).some(l => l.job_id === job.id && !l.completed_at)) await removeJobFromBatch(b.id, job.id).catch(() => {})
  }
  const existing = batches.find(b => b.scheduled_date === iso && b.destination_cemetery_id === cemId && b.id !== prev?.id)
  const r = existing
    ? await addJobsToBatch(existing.id, [{ job_id: job.id }])
    : await createBatch({ kind: track.batchKind, scheduled_date: iso, title: cemNameOf(job) || familyOf(job), destination_cemetery_id: cemId, job_ids: [job.id] })
  if (!r.ok) return r
  const ms = trackMilestone(job, track)
  const note = `Scheduled from the ${source || track.title}`
  if (ms) await updateMilestoneWithOverride(job.id, ms.milestone_key, { status: 'in_progress', dueDate: iso }, note).catch(() => {})
  if (track.scheduledKey && msBy(job).has(track.scheduledKey)) await updateMilestoneWithOverride(job.id, track.scheduledKey, { status: 'done', dueDate: iso }, note).catch(() => {})
  const actor = await getCurrentStaffName().catch(() => null)
  if (job.order?.id) logOrderActivity(job.order.id, { type: 'change', field: track.activityField, newValue: 'Scheduled', note: `${track.activityField} planned for ${iso} (${source || track.title})`, actor }).catch(() => {})
  return { ok: true }
}

// Take `job` off its day: leave the trip, reset the in-flight milestone.
export async function unplaceJob({ track, job, batches, source }) {
  if (!job) return { ok: false, error: 'Job not loaded' }
  const b = batches.find(x => (x.batch_jobs || []).some(l => l.job_id === job.id))
  if (b) { const r = await removeJobFromBatch(b.id, job.id); if (!r.ok) return r }
  const ms = trackMilestone(job, track)
  const note = `Unscheduled from the ${source || track.title}`
  if (ms && ms.status === 'in_progress') await updateMilestoneWithOverride(job.id, ms.milestone_key, { status: 'not_started', dueDate: null }, note).catch(() => {})
  if (track.scheduledKey && msBy(job).get(track.scheduledKey)?.status === 'done') await updateMilestoneWithOverride(job.id, track.scheduledKey, { status: 'not_started', dueDate: null }, note).catch(() => {})
  return { ok: true }
}
