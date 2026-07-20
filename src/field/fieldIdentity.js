// =============================================================================
// fieldIdentity.js — who is holding this phone, and which build do they get
// =============================================================================
// FIELD-2: the /field app is role-aware. After the shared staff sign-in, each
// phone picks its person once (persisted). The person's employees.is_owner flag
// decides the build: owner sees money surfaces, crew never fetches them into
// the render tree. Reuses the desktop's sb_active_staff identity key so every
// actor stamp app-wide (tasks, ladders, completions) names the real person.
// =============================================================================
import { getActiveStaffUser, setActiveStaffUser } from '../lib/stonebooksData'
import { getActiveEmployees, getEmployeeRows } from '../lib/employees'

// The resolved identity — or null when unpicked. FIELD-7 additions: empId
// (writes back tab prefs to the person's row), fieldKey (their private link,
// shown in the phone Settings), fieldTabs (their chosen bottom bar; null =
// role default, resolved in fieldTabs.js).
export function getFieldWho() {
  const name = getActiveStaffUser()
  if (!name) return null
  const rows = getEmployeeRows() || []
  const row = rows.find(r => r.name === name)
  // Unknown name (renamed/removed employee) is as stale as a deactivated one —
  // force a re-pick from the live roster rather than guessing crew/no-dept.
  if (!row || row.is_active === false) return null
  return {
    name,
    department: row.department || null,
    isOwner: !!row.is_owner,
    empId: row.id,
    fieldKey: row.field_key || null,
    fieldTabs: Array.isArray(row.field_tabs) ? row.field_tabs : null,
  }
}

export function setFieldWho(name) {
  setActiveStaffUser(name)
}

export function clearFieldWho() {
  setActiveStaffUser(null)
}

export function pickerCandidates() {
  return (getActiveEmployees() || []).map(e => ({
    name: e.name,
    department: e.department || null,
    isOwner: !!e.is_owner,
    pin: e.pin || null,   // FIELD-3: 4-digit picker gate (deterrent, not crypto)
  }))
}
