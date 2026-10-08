// =============================================================================
// floorLines.js — assembly lines on the production floor (LINES-1, 2026-10-08)
// =============================================================================
// Paul: "build assembly line lists with 15 to 20 stones... start building
// future assembly lines so we can plan ahead... when one assembly line is
// completely brought up the next one autofills as on deck." Round 2: a line
// COMPLETES when every stone is BLASTED; 18 is a SOFT cap (warn, never
// block); lines run in order, keep ~3 ahead, up to 6 is fine.
//
// The truth is two tables: floor_lines (number, capacity, started_at,
// completed_at) + floor_line_items (one row per DIE, position). Status is
// DERIVED, never stamped by a click:
//   complete — completed_at set (reconcile stamps it when every stone is at
//              ready_to_set, i.e. blasted and off the board)
//   active   — started_at set, not complete (more than one can run when Paul
//              starts the next line early)
//   on_deck  — the lowest-numbered unstarted line
//   planning — the rest, in number order
// Starting a line puts its stones ON the board at Ready to Bring Up, so the
// board's first column shows exactly the running line(s). reconcileFloorLines
// runs on every board load: completes finished lines, auto-starts the on-deck
// line when nothing is running, and attaches any stray on-floor die (e.g. one
// the Sales status sync brought up) to the active line.
// =============================================================================
import { supabase } from './supabase'
import { setComponentOnFloor, getCurrentStaffName } from './stonebooksData'
import { phaseIndex } from './jobComponents'

export const DEFAULT_LINE_CAPACITY = 18

const LINE_SELECT = `id, number, label, track, week_start, capacity, started_at, completed_at, notes, created_by, created_at,
  items:floor_line_items(id, component_id, job_id, order_id, position, added_at,
    component:job_components(id, current_phase, on_floor, track, component_type, job_id, order_id))`

const BLASTED_IDX = phaseIndex('new_stone', 'ready_to_set')

// A stone is "out" (blasted) when its component reached ready_to_set — or the
// component is gone (job closed / reconciled away), which can't hold a line open.
export const itemIsBlasted = (it) => !it.component || phaseIndex('new_stone', it.component.current_phase) >= BLASTED_IDX
// Up = physically on the line (brought_to_line or further, still on the board).
export const itemIsUp = (it) => !!it.component && it.component.on_floor && phaseIndex('new_stone', it.component.current_phase) >= phaseIndex('new_stone', 'brought_to_line')

// Tile tone for the strip — mirrors the board's columns (Paul round 2: "it's
// just a visual of what's below").
export function itemTone(it) {
  const c = it.component
  if (!c) return 'out'
  if (!c.on_floor) return phaseIndex('new_stone', c.current_phase) >= BLASTED_IDX ? 'out' : 'ready'
  switch (c.current_phase) {
    case 'brought_to_line': case 'cut': return 'up'
    case 'stencil_cut': return 'cut'
    case 'stencil_stuck': case 'blast': case 'quality_check': return 'blast'
    case 'ready_to_set': return 'out'
    default: return 'ready'
  }
}

const sortItems = (items) => [...(items || [])].sort((a, b) => (a.position - b.position) || String(a.added_at || '').localeCompare(String(b.added_at || '')))

// Attach derived status + counts to raw rows. `lines` must be number-sorted.
export function decorateLines(rows) {
  const lines = (rows || []).map(l => ({ ...l, items: sortItems(l.items) })).sort((a, b) => a.number - b.number)
  let onDeckSeen = false
  return lines.map(l => {
    let status
    if (l.completed_at) status = 'complete'
    else if (l.started_at) status = 'active'
    else if (!onDeckSeen) { status = 'on_deck'; onDeckSeen = true }
    else status = 'planning'
    const total = l.items.length
    const blasted = l.items.filter(itemIsBlasted).length
    const up = l.items.filter(it => itemIsUp(it) && !itemIsBlasted(it)).length
    const cut = l.items.filter(it => itemTone(it) === 'cut').length
    const blastQ = l.items.filter(it => itemTone(it) === 'blast').length
    const waiting = total - blasted - up
    return { ...l, status, counts: { total, blasted, up, cut, blastQ, waiting }, overCap: total > (l.capacity || DEFAULT_LINE_CAPACITY) }
  })
}

export async function listFloorLines({ track = 'new_stone' } = {}) {
  const { data, error } = await supabase.from('floor_lines').select(LINE_SELECT).eq('track', track).order('number')
  if (error) { console.warn('[lines] list:', error.message); return [] }
  return decorateLines(data)
}

export const activeLines = (lines) => lines.filter(l => l.status === 'active')
export const onDeckLine = (lines) => lines.find(l => l.status === 'on_deck') || null
export const lineLabel = (l) => l?.label || (l ? `Line ${l.number}` : '')

export async function createFloorLine({ label = null, weekStart = null, capacity = DEFAULT_LINE_CAPACITY, track = 'new_stone' } = {}) {
  const { data: last } = await supabase.from('floor_lines').select('number').eq('track', track).order('number', { ascending: false }).limit(1)
  const number = ((last && last[0]?.number) || 0) + 1
  const by = await getCurrentStaffName().catch(() => null)
  const { data, error } = await supabase.from('floor_lines')
    .insert({ number, label: label || `Line ${number}`, week_start: weekStart || null, capacity: capacity || DEFAULT_LINE_CAPACITY, track, created_by: by })
    .select('id, number, label').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, line: data }
}

export async function updateFloorLine(id, patch = {}) {
  const row = {}
  if ('label' in patch) row.label = patch.label || null
  if ('weekStart' in patch) row.week_start = patch.weekStart || null
  if ('capacity' in patch) row.capacity = Math.max(1, Number(patch.capacity) || DEFAULT_LINE_CAPACITY)
  if ('notes' in patch) row.notes = patch.notes || null
  if (!Object.keys(row).length) return { ok: true }
  const { error } = await supabase.from('floor_lines').update(row).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Only an EMPTY unstarted line can be deleted — stones never vanish with a line.
export async function deleteFloorLine(id) {
  const { count } = await supabase.from('floor_line_items').select('id', { count: 'exact', head: true }).eq('line_id', id)
  if (count) return { ok: false, error: 'Move its stones to another line first.' }
  const { error } = await supabase.from('floor_lines').delete().eq('id', id).is('started_at', null)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Append stones (components) to a line. A stone already on another line is
// MOVED (component_id is unique). If the target line is RUNNING, the stone
// goes on the board at Ready to Bring Up right away.
export async function addStonesToLine(lineId, comps = [], { by = null } = {}) {
  if (!lineId || !comps.length) return { ok: true, added: 0 }
  const { data: line } = await supabase.from('floor_lines').select('id, started_at, completed_at').eq('id', lineId).single()
  if (!line) return { ok: false, error: 'Line not found' }
  const { data: last } = await supabase.from('floor_line_items').select('position').eq('line_id', lineId).order('position', { ascending: false }).limit(1)
  let pos = ((last && last[0]?.position) || 0)
  const actor = by || await getCurrentStaffName().catch(() => null)
  let added = 0
  for (const c of comps) {
    pos++
    const row = { line_id: lineId, component_id: c.id, job_id: c.job_id || null, order_id: c.order_id || null, position: pos, added_by: actor }
    const { error } = await supabase.from('floor_line_items').upsert(row, { onConflict: 'component_id' })
    if (error) { console.warn('[lines] add:', error.message); continue }
    added++
    if (line.started_at && !line.completed_at && !c.on_floor) {
      await setComponentOnFloor(c.id, true, { actor, phase: 'ready_to_bring_up', source: 'line' })
    }
  }
  return { ok: true, added }
}

export async function removeLineItem(itemId) {
  const { error } = await supabase.from('floor_line_items').delete().eq('id', itemId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function moveLineItem(itemId, toLineId) {
  const { data: it } = await supabase.from('floor_line_items').select('id, component_id, job_id, order_id').eq('id', itemId).single()
  if (!it) return { ok: false, error: 'Stone not found' }
  const { data: comp } = await supabase.from('job_components').select('id, job_id, order_id, on_floor').eq('id', it.component_id).single()
  await supabase.from('floor_line_items').delete().eq('id', itemId)
  return addStonesToLine(toLineId, [comp || { id: it.component_id, job_id: it.job_id, order_id: it.order_id }])
}

export async function reorderLineItems(lineId, orderedItemIds = []) {
  let pos = 0
  for (const id of orderedItemIds) {
    pos++
    const { error } = await supabase.from('floor_line_items').update({ position: pos }).eq('id', id).eq('line_id', lineId)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}

// START a line: it's running now — every stone not yet on the board lands at
// Ready to Bring Up (the board's first column IS the running line). Used by
// the auto-advance AND Paul's "Start early".
export async function startFloorLine(lineId, { by = null } = {}) {
  const actor = by || await getCurrentStaffName().catch(() => null)
  const { data: line, error } = await supabase.from('floor_lines').select(LINE_SELECT).eq('id', lineId).single()
  if (error || !line) return { ok: false, error: error?.message || 'Line not found' }
  if (!line.started_at) {
    const { error: e2 } = await supabase.from('floor_lines').update({ started_at: new Date().toISOString() }).eq('id', lineId)
    if (e2) return { ok: false, error: e2.message }
  }
  for (const it of sortItems(line.items)) {
    const c = it.component
    if (!c || c.on_floor || phaseIndex('new_stone', c.current_phase) >= BLASTED_IDX) continue
    await setComponentOnFloor(c.id, true, { actor, phase: 'ready_to_bring_up', source: 'line' })
  }
  return { ok: true }
}

// Mark a running line complete by hand (normally reconcile does this the
// moment the last stone is blasted; this is the override for a line Paul
// wants to close out with stragglers moved elsewhere).
export async function completeFloorLine(lineId) {
  const { error } = await supabase.from('floor_lines').update({ completed_at: new Date().toISOString() }).eq('id', lineId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// The reconcile — runs on every board/planner load (cheap: two small reads):
//   1. a running line whose stones are ALL blasted → completed_at
//   2. nothing running + an unstarted line exists → start the lowest number
//   3. on-floor new-stone dies on NO line → attach to the active line (or a
//      fresh line when none is running) so "everything on the floor is on a
//      line" always holds
// Returns the decorated lines after the pass. `floorComps` is optional — the
// board passes its already-fetched getProductionComponents() result.
export async function reconcileFloorLines({ track = 'new_stone', floorComps = null } = {}) {
  let lines = await listFloorLines({ track })
  let changed = false

  // 1. complete finished lines
  for (const l of lines) {
    if (l.status !== 'active' || !l.items.length) continue
    if (l.items.every(itemIsBlasted)) {
      const r = await completeFloorLine(l.id)
      if (r.ok) changed = true
    }
  }
  if (changed) { lines = await listFloorLines({ track }); changed = false }

  // 2. auto-start the on-deck line when nothing is running
  if (!activeLines(lines).length) {
    const next = onDeckLine(lines)
    if (next) { const r = await startFloorLine(next.id, { by: 'auto' }); if (r.ok) changed = true }
  }
  if (changed) { lines = await listFloorLines({ track }); changed = false }

  // 3. strays: on-floor dies with no line → the active line
  let comps = floorComps
  if (!comps) {
    const { data } = await supabase.from('job_components').select('id, job_id, order_id, track, component_type, on_floor, current_phase')
      .eq('track', track).eq('on_floor', true).neq('component_type', 'base')
    comps = data || []
  }
  const onLine = new Set(lines.flatMap(l => l.items.map(it => it.component_id)))
  const strays = comps.filter(c => c.track === track && c.on_floor && c.component_type !== 'base'
    && phaseIndex(track, c.current_phase) < BLASTED_IDX && !onLine.has(c.id))
  if (strays.length) {
    let target = activeLines(lines)[0] || null
    if (!target) {
      const r = await createFloorLine({ track })
      if (r.ok) {
        await supabase.from('floor_lines').update({ started_at: new Date().toISOString() }).eq('id', r.line.id)
        target = r.line
      }
    }
    if (target) { await addStonesToLine(target.id, strays, { by: 'auto' }); changed = true }
  }
  if (changed) lines = await listFloorLines({ track })
  return lines
}

// ── Reports: how many lines a week / year, time to complete ─────────────────
// Completed lines by period (completed_at), days started→completed, stones
// per line. Paul: "in reports i want how many lines a week we are doing..
// time to complete lines how many a year".
export async function getLineStats() {
  const lines = await listFloorLines()
  const done = lines.filter(l => l.completed_at && l.started_at)
  const days = (l) => Math.max(0, (new Date(l.completed_at) - new Date(l.started_at)) / 86400000)
  const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null
  return {
    lines,
    completed: done.map(l => ({ id: l.id, number: l.number, label: lineLabel(l), started_at: l.started_at, completed_at: l.completed_at, days: days(l), stones: l.counts.total })),
    avgDays: avg(done.map(days)),
    avgStones: avg(done.map(l => l.counts.total)),
    running: activeLines(lines).map(l => ({ id: l.id, number: l.number, label: lineLabel(l), started_at: l.started_at, counts: l.counts })),
    planned: lines.filter(l => l.status === 'on_deck' || l.status === 'planning').length,
  }
}
