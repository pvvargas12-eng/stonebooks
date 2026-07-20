// =============================================================================
// employees.js — settings-managed staff roster (Task Command Center part 1)
// =============================================================================
// ONE table (public.employees) is the source of truth for who works here.
// The app has two legacy hardcoded rosters that dozens of pickers and actor
// stamps read synchronously:
//   • STAFF_NAMES  (stonebooksData.js) — the "I am" picker + actor stamps
//   • TEAM_ROSTER  (team.js)           — promise-by / batch-assignee pickers
// Rather than rewrite every consumer, applyEmployeesToRosters() overlays the
// fetched active names INTO both arrays in place at boot — the exact pattern
// applyStoneColorsToCatalog uses for GRANITE_COLORS.
//
// Soft-delete only: deactivated employees leave every picker but old text
// stamps ("done by Bill") still render fine — they're just strings.
//
// LOAD ORDER: loadEmployees() runs at app boot alongside loadSalesOptions()
// (after auth — the table is RLS-locked, a pre-auth fetch returns 0 rows
// silently and must never blank the rosters).
// =============================================================================

import { supabase } from './supabase'
import { STAFF_NAMES } from './stonebooksData'
import { TEAM_ROSTER } from './team'

// Departments are a fixed operational vocabulary (they mirror the Jobs tabs),
// not a settings list. Used for employee grouping AND as task assignees.
export const DEPARTMENTS = ['Admin', 'Design', 'Sales', 'Production', 'Installation']

let _rows = null          // session cache: all rows, active + inactive
let _loadPromise = null

function overlay(arr, names) {
  arr.length = 0
  arr.push(...names)
}

// Merge active employee names into both legacy rosters in place.
// Zero rows means the fetch didn't really see the table (pre-auth RLS, wiped
// seed) — NEVER interpret it as "everyone quit"; keep the hardcoded lists.
export function applyEmployeesToRosters(rows) {
  const active = (rows || []).filter(r => r.is_active)
  if (active.length === 0) return
  const names = active
    .slice()
    .sort((a, z) => (a.sort_order ?? 0) - (z.sort_order ?? 0) || a.name.localeCompare(z.name))
    .map(r => r.name)
  overlay(STAFF_NAMES, names)
  overlay(TEAM_ROSTER, names)
}

export async function fetchEmployees({ force = false } = {}) {
  if (!force && _rows) return _rows
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  if (data && data.length > 0) _rows = data
  return data || []
}

// Fetch + apply, once per session (concurrent callers share the promise).
// Failure falls back to the hardcoded rosters so pickers never go empty.
export function loadEmployees({ force = false } = {}) {
  if (_loadPromise && !force) return _loadPromise
  _loadPromise = fetchEmployees({ force })
    .then(rows => {
      if (!rows || rows.length === 0) {
        console.warn('loadEmployees: 0 rows — keeping hardcoded rosters')
        _loadPromise = null
        return null
      }
      applyEmployeesToRosters(rows)
      return rows
    })
    .catch(err => {
      console.error('loadEmployees:', err?.message || err)
      _loadPromise = null
      return null
    })
  return _loadPromise
}

// Synchronous accessors for components that render before/without the fetch.
// Fall back to the (possibly already-overlaid) STAFF_NAMES roster.
export function getEmployeeRows() {
  return _rows || STAFF_NAMES.map(name => ({ id: name, name, department: null, is_active: true }))
}
export function getActiveEmployees() {
  return getEmployeeRows().filter(r => r.is_active)
}

// ── Settings-tab CRUD ────────────────────────────────────────────────────────

async function afterWrite() {
  const rows = await fetchEmployees({ force: true })
  applyEmployeesToRosters(rows)
  return rows
}

export async function listEmployees() {
  return fetchEmployees({ force: true })
}

export async function addEmployee({ name, department = null }) {
  const n = (name || '').trim()
  if (!n) return { ok: false, error: 'Type a name.' }
  const maxSort = Math.max(0, ...getEmployeeRows().map(r => r.sort_order ?? 0))
  const { data, error } = await supabase
    .from('employees')
    .insert({ name: n, department: department || null, sort_order: maxSort + 10 })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return { ok: false, error: `${n} is already on the roster (check the inactive list).` }
    return { ok: false, error: error.message }
  }
  await afterWrite()
  return { ok: true, employee: data }
}

export async function updateEmployee(id, patch) {
  const allowed = { updated_at: new Date().toISOString() }
  if ('name' in patch) {
    const n = (patch.name || '').trim()
    if (!n) return { ok: false, error: 'Name cannot be empty.' }
    allowed.name = n
  }
  if ('department' in patch) allowed.department = patch.department || null
  if ('isActive' in patch) allowed.is_active = !!patch.isActive
  if ('sortOrder' in patch) allowed.sort_order = patch.sortOrder
  if ('isOwner' in patch) allowed.is_owner = !!patch.isOwner   // FIELD-2: owner build flag
  if ('pin' in patch) {                                        // FIELD-3: picker PIN (4 digits or clear)
    const p = String(patch.pin || '').replace(/\D/g, '')
    if (p && p.length !== 4) return { ok: false, error: 'PIN must be exactly 4 digits.' }
    allowed.pin = p || null
  }
  if ('fieldKey' in patch) {                                   // FIELD-6: private /field link token (or revoke)
    const k = patch.fieldKey == null ? null : String(patch.fieldKey).trim()
    if (k && k.length < 20) return { ok: false, error: 'Field key too short.' }
    allowed.field_key = k || null
  }
  const { error } = await supabase.from('employees').update(allowed).eq('id', id)
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That name is already on the roster.' }
    return { ok: false, error: error.message }
  }
  await afterWrite()
  return { ok: true }
}
