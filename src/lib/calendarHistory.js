// =============================================================================
// calendarHistory — what actually happened on a day, for the Calendar's past
// days (CAL-DONE, Paul 2026-11-17: "for past days I want to see stones that
// were set and things carved or inscriptions, basically work done on previous
// days, number of sales per day as well").
// =============================================================================
// READ-ONLY. Same truths as Reports > Daily report (ShopPulse.buildEvents):
//   work  = a job milestone marked done, on its own status_date
//           installed / door_installed / work_completed  → Set (Bronze set, Door installed)
//           production_completed on a new-stone job      → Blasted
//           inscription_completed (work_completed as the fallback) on an inscription job → Carved
//   sales = orders by the day they were signed, cancelled out.
// Columns confirmed in information_schema 2026-11-17 (status_date is a date,
// signed_at a timestamptz). Any read error returns empty lists: the calendar
// must never blank because history could not load.
// =============================================================================
import { supabase } from './supabase'
import { properName } from './stonebooksData'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const KEYS = [...INSTALL_KEYS, 'production_completed', 'inscription_completed']
const pad2 = (n) => String(n).padStart(2, '0')
const localDay = (v) => { const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const shiftDay = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}` }
const famOf = (o) => properName(String(o?.primary_lastname || '').trim()
  || [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ')
  || o?.order_number || 'Order')

export const DONE_TYPES = {
  set:      { label: 'Set',            word: 'set' },
  bronze:   { label: 'Bronze set',     word: 'bronze set' },
  door:     { label: 'Door installed', word: 'door' },
  carved:   { label: 'Carved',         word: 'carved' },
  blasted:  { label: 'Blasted',        word: 'blasted' },
}

// → { work: [{ day, type, what, name, orderNo, orderId, jobId }], sales: [{ day, name, orderNo, orderId }] }
export async function getCalendarHistory({ from, to } = {}) {
  const out = { work: [], sales: [] }
  if (!from || !to) return out
  try {
    const [ms, sold] = await Promise.all([
      supabase.from('job_milestones')
        .select('milestone_key, status_date, job:jobs(id, job_type, order_id, cemetery_order_id)')
        .eq('status', 'done').in('milestone_key', KEYS)
        .gte('status_date', from).lte('status_date', to).limit(2000),
      // A day of slack either side: signed_at is a timestamp, bucketed below by
      // the LOCAL day it falls on.
      supabase.from('orders')
        .select('id, order_number, primary_lastname, signed_at, status, customer:customers(first_name, last_name)')
        .gte('signed_at', `${shiftDay(from, -1)}T00:00:00Z`).lte('signed_at', `${shiftDay(to, 1)}T23:59:59Z`)
        .neq('status', 'cancelled').or('archived.is.null,archived.eq.false').limit(2000),
    ])
    if (ms.error) console.warn('[cal] history milestones:', ms.error.message)
    if (sold.error) console.warn('[cal] history sales:', sold.error.message)

    for (const o of (sold.data || [])) {
      const day = localDay(o.signed_at)
      if (!day || day < from || day > to) continue
      out.sales.push({ day, name: famOf(o), orderNo: o.order_number || '', orderId: o.id })
    }

    // One row per job per kind of work (a job can carry two install keys done).
    const picked = new Map()
    for (const m of (ms.data || [])) {
      const j = m.job
      if (!j || !m.status_date) continue
      const day = String(m.status_date).slice(0, 10)
      let type = null
      if (j.job_type === 'inscription') {
        if (m.milestone_key === 'inscription_completed' || m.milestone_key === 'work_completed') type = 'carved'
      } else if (INSTALL_KEYS.includes(m.milestone_key)) {
        type = j.job_type === 'bronze' ? 'bronze' : j.job_type === 'mausoleum_door' ? 'door' : 'set'
      } else if (m.milestone_key === 'production_completed' && j.job_type === 'new_stone') {
        type = 'blasted'
      }
      if (!type) continue
      const k = `${j.id}|${type}`
      // inscription_completed beats the work_completed fallback; else the first date wins.
      const prev = picked.get(k)
      if (prev && !(type === 'carved' && m.milestone_key === 'inscription_completed')) continue
      picked.set(k, { day, type, jobId: j.id, orderId: j.order_id || null, door: !!j.cemetery_order_id })
    }
    const rows = [...picked.values()]
    const ids = [...new Set(rows.map(r => r.orderId).filter(Boolean))]
    const byId = new Map()
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase.from('orders')
        .select('id, order_number, primary_lastname, customer:customers(first_name, last_name)')
        .in('id', ids.slice(i, i + 150))
      if (error) { console.warn('[cal] history orders:', error.message); continue }
      for (const o of (data || [])) byId.set(o.id, o)
    }
    for (const r of rows) {
      const o = r.orderId ? byId.get(r.orderId) : null
      out.work.push({
        day: r.day, type: r.type, what: DONE_TYPES[r.type].label, jobId: r.jobId, orderId: r.orderId,
        name: o ? famOf(o) : (r.door ? 'Cemetery door' : 'Job'), orderNo: o?.order_number || '',
      })
    }
  } catch (e) {
    console.warn('[cal] history:', e?.message || e)
  }
  return out
}
