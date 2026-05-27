// =============================================================================
// 📚 Stonebooks — Promise day-state engine (pure, unit-testable)
// =============================================================================
// computePromiseDayState(day, promises, batches, batchJobs[, todayISO])
//
// Colors a calendar day by promise "temperature". This is a HISTORICAL
// PERFORMANCE RECORD, not just a live view: it reads BOTH open and resolved
// promises whose promised_date == this day, and derives state from `kept`:
//
//   • kept === true                       → green   (kept promise — PERMANENT)
//   • kept === false                      → missed  (broken promise — PERMANENT)
//   • kept == null & promised_date < today→ missed  (past-due, transitional —
//                                                     will be auto-marked false)
//   • kept == null & a batch is scheduled → amber   (protected / in progress)
//   • kept == null & no batch scheduled   → red     (unprotected)
//
// "A batch is scheduled" means the job sits in at least one batch with a
// non-null scheduled_date — TRAY (unscheduled) batches never count, so they
// can't make a day look protected.
//
// Day state = worst across that day's promises:  missed > red > amber > green.
// No promise on the day → state null (default styling).
//
// PURE: no imports, no Supabase. `batches` (with nested `batch_jobs` +
// `scheduled_date`) is the source of truth; the optional `batchJobs` arg is a
// fallback for batches that arrive without nested links.
// =============================================================================

const _RANK = { green: 1, amber: 2, red: 3, missed: 4 }

export function computePromiseDayState(day, promises, batches, batchJobs, todayISO) {
  const dayISO = _isoOf(day)
  if (!dayISO) return { state: null, perPromise: [], missed: [] }
  const today = todayISO || _todayISO()

  // Both open AND resolved promises on this day — the record persists.
  const dayPromises = (promises || []).filter(p =>
    p && String(p.promised_date || '').slice(0, 10) === dayISO
  )
  if (dayPromises.length === 0) return { state: null, perPromise: [], missed: [] }

  const scheduledByJob = _scheduledDatesByJob(batches, batchJobs)

  const perPromise = dayPromises.map(p => ({
    promiseId: p.id,
    jobId:     p.job_id,
    surname:   _surname(p),
    state:     _promiseState(p, dayISO, today, scheduledByJob),
  }))

  let worst = perPromise[0].state
  for (const pp of perPromise) {
    if (_RANK[pp.state] > _RANK[worst]) worst = pp.state
  }
  const missed = perPromise
    .filter(pp => pp.state === 'missed')
    .map(pp => ({ jobId: pp.jobId, surname: pp.surname }))

  return { state: worst, perPromise, missed }
}

// ── internals ────────────────────────────────────────────────────────────────

function _promiseState(p, dayISO, todayISO, scheduledByJob) {
  // Resolved promises are permanent marks, regardless of date.
  if (p.kept === true) return 'green'
  if (p.kept === false) return 'missed'
  // Open promise (kept IS NULL):
  if (dayISO < todayISO) return 'missed'            // past-due, not yet auto-resolved
  const scheduled = scheduledByJob.get(p.job_id) || []
  return scheduled.length > 0 ? 'amber' : 'red'     // protected (in progress) vs unprotected
}

// Map<jobId, ISO[]> of SCHEDULED batch dates the job appears in. Tray batches
// (scheduled_date null) are excluded — they must not make a day read protected.
function _scheduledDatesByJob(batches, batchJobs) {
  const idx = new Map()
  const add = (jid, sd) => {
    if (!idx.has(jid)) idx.set(jid, [])
    idx.get(jid).push(sd)
  }
  const seenBatchIds = new Set()
  for (const b of (batches || [])) {
    seenBatchIds.add(b.id)
    if (b.status === 'cancelled') continue          // cancelled — provides no protection
    if (!b.scheduled_date) continue                 // tray — skip
    const sd = String(b.scheduled_date).slice(0, 10)
    for (const l of (b.batch_jobs || [])) {
      if (l.job_id) add(l.job_id, sd)
    }
  }
  // Fallback: flat batchJobs rows whose batch wasn't represented above.
  if (Array.isArray(batchJobs)) {
    const dateByBatch = new Map((batches || []).map(b => [b.id, b.scheduled_date ? String(b.scheduled_date).slice(0, 10) : null]))
    for (const l of batchJobs) {
      if (!l.job_id || seenBatchIds.has(l.batch_id)) continue
      const sd = dateByBatch.get(l.batch_id)
      if (sd) add(l.job_id, sd)
    }
  }
  return idx
}

function _isoOf(day) {
  if (!day) return null
  if (typeof day === 'string') return day.slice(0, 10)
  if (day.iso) return String(day.iso).slice(0, 10)
  if (day.date instanceof Date) return _dateISO(day.date)
  if (day instanceof Date) return _dateISO(day)
  return null
}

function _dateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function _todayISO() {
  return _dateISO(new Date())
}

function _surname(p) {
  const o = p?.job?.order
  if (o?.primary_lastname) return o.primary_lastname
  const c = o?.customer
  if (c?.last_name) return c.last_name
  const n = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
  return n || '—'
}
