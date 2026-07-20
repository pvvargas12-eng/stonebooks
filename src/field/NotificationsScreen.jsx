// =============================================================================
// NotificationsScreen — the bell feed (FIELD-3 push slice)
// =============================================================================
// Last 30 days of this person's notifications, grouped TODAY / YESTERDAY /
// older. Unread rows carry the gold dot; a tap marks read (optimistic) and
// routes by the deep_link convention ('/task/{id}' -> task detail,
// '/order/{orderId}' -> job drill). Mark-all-read is optimistic + undoable.
// When push permission is off on this phone, a banner offers the ask via the
// shell's PermissionSheet (onAskPermission).
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { listNotifications, markRead, markAllRead, getPushState } from '../lib/push'
import { todayISO } from './fieldShared'

const MONO = '"JetBrains Mono", Consolas, monospace'

// 'h:mmam' — deterministic from the stored timestamp (memo-only).
function timeOf(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  let h = d.getHours()
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${ap}`
}

const kindLabel = (kind) => String(kind || 'note').replace(/_/g, ' ').toUpperCase()

export default function NotificationsScreen({ who, undo, onOpenJob, onOpenTask, onBack, onAskPermission }) {
  const [rows, setRows] = useState(null)          // null = loading
  const [err, setErr] = useState(null)
  const [pushState, setPushState] = useState('granted')   // banner hidden until checked
  const [today, setToday] = useState(() => todayISO())    // re-stamped on fetch

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await listNotifications(who.name)
        if (cancelled) return
        setRows(list || [])
        setToday(todayISO())
        setPushState(getPushState())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load notifications.')
      }
    })()
    return () => { cancelled = true }
  }, [who.name])

  // Group by LOCAL calendar day (created_at is a timestamptz — slicing the UTC
  // string would shove evening rows onto the wrong day).
  const groups = useMemo(() => {
    if (!rows) return []
    const pad = (n) => String(n).padStart(2, '0')
    const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const base = new Date(today + 'T00:00:00')
    const yd = new Date(base); yd.setDate(yd.getDate() - 1)
    const ydKey = isNaN(yd.getTime()) ? '' : keyOf(yd)
    const out = []
    const idx = new Map()
    for (const n of rows) {
      const d = new Date(n.created_at)
      const bad = isNaN(d.getTime())
      const key = bad ? 'unknown' : keyOf(d)
      let g = idx.get(key)
      if (!g) {
        const label = key === today ? 'Today'
          : key === ydKey ? 'Yesterday'
          : bad ? 'Earlier'
          : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
        g = { key, label, items: [] }
        idx.set(key, g)
        out.push(g)
      }
      g.items.push({ n, time: timeOf(n.created_at) })
    }
    return out
  }, [rows, today])

  const unreadCount = useMemo(() => (rows || []).filter(r => !r.read_at).length, [rows])

  const patchRow = useCallback((id, patch) => {
    setRows(list => (list || []).map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  // Tap: optimistic read + route by deep_link. The read write is quiet on
  // failure (we're usually navigating away) — it just reverts the dot.
  const openItem = useCallback((n) => {
    if (!n.read_at) {
      patchRow(n.id, { read_at: new Date().toISOString() })
      markRead(n.id).then(res => {
        if (!res?.ok) patchRow(n.id, { read_at: null })
      }).catch(() => patchRow(n.id, { read_at: null }))
    }
    const dl = String(n.deep_link || '')
    let m
    if ((m = dl.match(/^\/task\/(.+)$/))) {
      if (onOpenTask) onOpenTask(m[1])
    } else if ((m = dl.match(/^\/order\/(.+)$/))) {
      if (onOpenJob) onOpenJob({ orderId: m[1], jobId: null }, 'today')
    }
    // no deep link -> the tap just marked it read
  }, [patchRow, onOpenTask, onOpenJob])

  const markAll = useCallback(async () => {
    const unread = (rows || []).filter(r => !r.read_at)
    if (!unread.length) return
    const ids = unread.map(r => r.id)
    const stamp = new Date().toISOString()
    setRows(list => (list || []).map(r => (r.read_at ? r : { ...r, read_at: stamp })))
    const res = await markAllRead(who.name)
    if (!res.ok) {
      setRows(list => (list || []).map(r => (ids.includes(r.id) ? { ...r, read_at: null } : r)))
      undo.showError('Could not mark them read — try again.')
      return
    }
    undo.show(`${ids.length} marked read`, async () => {
      const { error } = await supabase.from('notifications').update({ read_at: null }).in('id', ids)
      if (error) { undo.showError('Could not undo — try again.'); return }
      setRows(list => (list || []).map(r => (ids.includes(r.id) ? { ...r, read_at: null } : r)))
    })
  }, [rows, who.name, undo])

  const showBanner = pushState !== 'granted' && pushState !== 'unsupported'

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Today
        </button>
      )}

      {err ? (
        <div className="fl-empty">{err}</div>
      ) : rows === null ? (
        <div className="fl-empty">Loading notifications…</div>
      ) : (
        <>
          <div className="fl-sect" style={{ margin: '2px 2px 12px' }}>
            <div className="fl-sect-h" style={{ fontSize: 26 }}>Notifications</div>
            <div className="fl-sect-spacer" />
            {unreadCount > 0 && (
              <button type="button" className="fl-sect-see" onClick={markAll}>Mark all read</button>
            )}
          </div>

          {showBanner && (
            <div style={{ background: '#FDF6E8', border: '1px solid #EAD9AE', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#6B5A23', lineHeight: 1.45 }}>
                {pushState === 'not-installed'
                  ? 'Add this app to your Home Screen to get notifications on this phone.'
                  : 'Notifications are off on this phone — nothing reaches your lock screen.'}
              </div>
              {onAskPermission && pushState !== 'not-installed' && (
                <button type="button" className="fl-verb" onClick={onAskPermission}>Turn on</button>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="fl-empty-serif">Nothing new.</div>
          ) : (
            groups.map(g => (
              <div key={g.key}>
                <div className="fl-daylabel">{g.label}</div>
                <div className="fl-row" style={{ cursor: 'default', padding: '2px 14px' }}>
                  {g.items.map(({ n, time }) => {
                    const unread = !n.read_at
                    return (
                      <button key={n.id} type="button" className="fl-rowline" onClick={() => openItem(n)}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: unread ? '#9A7209' : 'transparent', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: unread ? 800 : 600, color: '#16150F', lineHeight: 1.3 }}>
                            {n.title}
                          </div>
                          {n.body && (
                            <div style={{ fontSize: 13, color: '#55503F', marginTop: 2, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {n.body}
                            </div>
                          )}
                          <div style={{ fontFamily: MONO, fontSize: 10.5, color: '#8A7F6C', marginTop: 3 }}>
                            {kindLabel(n.kind)} &#183; {time}
                          </div>
                        </div>
                        {n.deep_link && <span className="fl-chev">&#8250;</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
