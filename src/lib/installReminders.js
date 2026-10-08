// =============================================================================
// installReminders.js — custom reminders on a stone or a cemetery
// =============================================================================
// Paul 2026-10-08: "Need Base Insc", "all St Gertrude bases need an insc" —
// "not just a blocker but a reminder, so it's good to keep on." A reminder
// hangs on a JOB (this stone) or a CEMETERY (every stone set there). It never
// gates; it's an amber chip the office and the crew read until it's ticked
// done. Table: install_reminders (20261008_install_reminders.sql).
// =============================================================================
import { supabase } from './supabase'
import { getCurrentStaffName } from './stonebooksData'

const COLS = 'id, job_id, cemetery_id, text, created_by, created_at, done_at, done_by'

// Open reminders for a set of jobs + the cemeteries they sit in.
// Returns { byJob: Map(job_id → [r]), byCemetery: Map(cemetery_id → [r]) }.
export async function listInstallReminders({ jobIds = [], cemeteryIds = [], includeDone = false } = {}) {
  const byJob = new Map(), byCemetery = new Map()
  const jobs = [...new Set(jobIds.filter(Boolean))]
  const cems = [...new Set(cemeteryIds.filter(Boolean))]
  const q = async (col, ids) => {
    const out = []
    for (let i = 0; i < ids.length; i += 150) {
      let s = supabase.from('install_reminders').select(COLS).in(col, ids.slice(i, i + 150)).order('created_at', { ascending: true })
      if (!includeDone) s = s.is('done_at', null)
      const { data, error } = await s
      if (error) { console.warn('[reminders] list:', error.message); continue }
      out.push(...(data || []))
    }
    return out
  }
  if (jobs.length) for (const r of await q('job_id', jobs)) { if (!byJob.has(r.job_id)) byJob.set(r.job_id, []); byJob.get(r.job_id).push(r) }
  if (cems.length) for (const r of await q('cemetery_id', cems)) { if (!byCemetery.has(r.cemetery_id)) byCemetery.set(r.cemetery_id, []); byCemetery.get(r.cemetery_id).push(r) }
  return { byJob, byCemetery }
}

// Every open reminder that applies to this job: its own + its cemetery's.
export function remindersFor(job, { byJob, byCemetery }) {
  const own = byJob.get(job?.id) || []
  const cemId = job?.cemetery?.id || job?.order?.cemetery?.id || job?.order?.cemetery_id || null
  const cem = cemId ? (byCemetery.get(cemId) || []) : []
  return [...own, ...cem]
}

export async function addInstallReminder({ jobId = null, cemeteryId = null, text }) {
  const t = String(text || '').trim()
  if (!t) return { ok: false, error: 'Type the reminder.' }
  if (!jobId && !cemeteryId) return { ok: false, error: 'Pick a stone or a cemetery.' }
  const created_by = await getCurrentStaffName().catch(() => null)
  const { data, error } = await supabase.from('install_reminders')
    .insert({ job_id: jobId || null, cemetery_id: jobId ? null : cemeteryId, text: t, created_by })
    .select(COLS).single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, reminder: data }
}

export async function doneInstallReminder(id, done = true) {
  const done_by = done ? await getCurrentStaffName().catch(() => null) : null
  const { error } = await supabase.from('install_reminders')
    .update({ done_at: done ? new Date().toISOString() : null, done_by }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteInstallReminder(id) {
  const { error } = await supabase.from('install_reminders').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
