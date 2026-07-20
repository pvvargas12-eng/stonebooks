// =============================================================================
// FieldApp.jsx — STONEBOOKS FIELD · the phone-first surface (/field)
// =============================================================================
// FIELD-3 shell (2026-07-18): flat clean tab bar (no raised center), the owner
// suite, PINs at the person picker, and web-push plumbing.
//   Crew:  Today / Tasks / Jobs / Find        (camera lives on Today + Tasks)
//   Owner: Today / Orders / Schedule / Tasks / Menu
// One sign-in, per-phone person pick (employees roster; is_owner resolves the
// build; a person with a PIN set must type it). Tab screens stay mounted
// (hidden) through job drills. Every mutation commits fast with an 8s undo.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { getSession, onAuthStateChange, signInWithPassword, signOut } from '../lib/auth'
import { getMyPartnerContext } from '../lib/vendorsData'
import { listShopTasks } from '../lib/stonebooksData'
import { loadEmployees } from '../lib/employees'
import { registerSW, loadUnreadCount } from '../lib/push'
import { useUndoToast, FIELD_CSS } from './fieldUndo'
import { getFieldWho, setFieldWho, clearFieldWho, pickerCandidates } from './fieldIdentity'
import UndoToast from './UndoToast'
import TodayScreen from './TodayScreen'
import TasksScreen from './TasksScreen'
import WorkHubScreen from './WorkHubScreen'
import FindScreen from './FindScreen'
import MenuScreen from './MenuScreen'
import ScheduleScreen from './ScheduleScreen'
import NotificationsScreen from './NotificationsScreen'
import PermissionSheet, { shouldOfferPush } from './PermissionSheet'
import JobDetailScreen from './JobDetailScreen'
import CompleteScreen from './CompleteScreen'
import { NewTaskSheet, CaptureSheet } from './fieldSheets'
import { todayISO } from './fieldShared'

// ── Login (phone-styled, same staff accounts) ────────────────────────────────
function FieldLogin() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    const res = await signInWithPassword(email.trim(), pw)
    setBusy(false)
    if (!res.ok) setErr(res.error || 'Sign-in failed.')
  }
  return (
    <div className="fl-login">
      <div className="fl-login-brand">STONEBOOKS <em>FIELD</em></div>
      <div className="fl-login-sub">Shevchenko Monuments · crew sign-in</div>
      <form onSubmit={submit} className="fl-login-form">
        <input type="email" inputMode="email" autoComplete="username" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Password"
          value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="fl-login-err">{err}</div>}
        <button type="submit" disabled={busy || !email.trim() || !pw}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ── Who picker — once per phone; PIN when the person has one ─────────────────
function WhoPicker({ onPick }) {
  const people = pickerCandidates()
  const [pinFor, setPinFor] = useState(null)   // candidate awaiting PIN
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)

  const tryPick = (p) => {
    if (p.pin) { setPinFor(p); setPin(''); setWrong(false) }
    else onPick(p.name)
  }
  const submitPin = () => {
    if (!pinFor) return
    if (pin === String(pinFor.pin)) { onPick(pinFor.name) }
    else { setWrong(true); setPin('') }
  }

  if (pinFor) {
    return (
      <div className="fl-login">
        <div className="fl-login-brand">STONEBOOKS <em>FIELD</em></div>
        <div className="fl-login-sub">Enter {pinFor.name}&#8217;s PIN</div>
        <div className="fl-pin-row">
          <input className="fl-pin-input" type="password" inputMode="numeric" autoFocus
            maxLength={4} value={pin} placeholder="&#8226;&#8226;&#8226;&#8226;"
            onChange={e => { setWrong(false); const v = e.target.value.replace(/\D/g, ''); setPin(v); }}
            onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) submitPin() }} />
        </div>
        {wrong && <div className="fl-login-err" style={{ marginTop: 10 }}>Wrong PIN — try again.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="fl-btn-ghost" style={{ flex: 1 }}
            onClick={() => setPinFor(null)}>Back</button>
          <button type="button" className="fl-btn-gold" style={{ flex: 1, opacity: pin.length === 4 ? 1 : 0.5 }}
            onClick={submitPin} disabled={pin.length !== 4}>Open</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fl-login">
      <div className="fl-login-brand">STONEBOOKS <em>FIELD</em></div>
      <div className="fl-login-sub">Who is holding this phone?</div>
      <div className="fl-who-list">
        {people.map(p => (
          <button key={p.name} type="button" className="fl-who-row" onClick={() => tryPick(p)}>
            <span className="fl-who-avatar">{p.name.slice(0, 2).toUpperCase()}</span>
            <span className="fl-who-main">
              <span className="fl-who-name">{p.name}</span>
              <span className="fl-who-dept">{p.isOwner ? 'Owner' : (p.department || 'Crew')}{p.pin ? ' · PIN' : ''}</span>
            </span>
            <span className="fl-chev">&#8250;</span>
          </button>
        ))}
      </div>
      <div className="fl-who-note">This sticks on this phone. Every status tap and task will carry your name. Set PINs in Settings, Staff on the desktop.</div>
    </div>
  )
}

const G = (paths, size = 22, sw = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
)
const GLYPH = {
  today: G('<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5 L11 13 C13 11 11 9 13 7 L17.5 6.5"/>'),
  tasks: G('<path d="M4 6 l2 2 l3.5-3.5"/><path d="M4 15 l2 2 l3.5-3.5"/><line x1="13" y1="7" x2="20" y2="7"/><line x1="13" y1="16" x2="20" y2="16"/>'),
  jobs: G('<path d="M13.5 4.5 l6 6 -2.5 2.5 -6-6z"/><path d="M12.5 9.5 L4 18 l2 2 8.5-8.5"/><path d="M15 3 l6 6"/>'),
  orders: G('<path d="M6 3 h8 l4 4 v14 h-12 z"/><path d="M14 3 v4 h4"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>'),
  find: G('<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>'),
  schedule: G('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 h18 M8 3 v4 M16 3 v4"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>'),
  menu: G('<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/>'),
  bell: G('<path d="M6 10 a6 6 0 0 1 12 0 c0 5 2 6 2 6 H4 c0 0 2-1 2-6"/><path d="M10 19.5 a2.2 2.2 0 0 0 4 0"/>', 20),
}

export default function FieldApp() {
  const [authed, setAuthed] = useState(undefined)
  const [staffOk, setStaffOk] = useState(undefined)
  const [rosterReady, setRosterReady] = useState(false)
  const [who, setWho] = useState(null)
  const [tab, setTab] = useState('today')
  const [drill, setDrill] = useState(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [taskFocus, setTaskFocus] = useState(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [taskRev, setTaskRev] = useState(0)
  const [captureFile, setCaptureFile] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [dueBadge, setDueBadge] = useState(0)
  const [unread, setUnread] = useState(0)
  const permOffered = useRef(false)
  const fileRef = useRef(null)
  const undo = useUndoToast()

  useEffect(() => {
    let cancelled = false
    registerSW()
    getSession().then(s => { if (!cancelled) setAuthed(!!s) })
    const unsub = onAuthStateChange(u => setAuthed(!!u))
    return () => { cancelled = true; unsub() }
  }, [])

  useEffect(() => {
    if (!authed) { setStaffOk(undefined); return }
    let cancelled = false
    getMyPartnerContext()
      .then(ctx => { if (!cancelled) setStaffOk(ctx === null) })
      .catch(() => { if (!cancelled) setStaffOk(true) })
    return () => { cancelled = true }
  }, [authed])

  useEffect(() => {
    if (staffOk === false) window.location.replace('/trade')
  }, [staffOk])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    loadEmployees().catch(() => {}).then(() => {
      if (cancelled) return
      setRosterReady(true)
      setWho(getFieldWho())
    })
    return () => { cancelled = true }
  }, [authed])

  // Offer the notification permission sheet once per session, once identity is set.
  useEffect(() => {
    if (!who || permOffered.current) return
    permOffered.current = true
    try { if (shouldOfferPush(who)) setPermOpen(true) } catch { /* feature-detect noop */ }
  }, [who])

  // Tasks badge + bell unread. Refreshes on tab change and task writes.
  useEffect(() => {
    if (!who) return
    let cancelled = false
    listShopTasks().then(rows => {
      if (cancelled) return
      const today = todayISO()
      const mine = (rows || []).filter(t =>
        t.status !== 'done' &&
        ((t.assignee_kind === 'person' && t.assignee === who.name) ||
         (t.assignee_kind === 'department' && who.department && t.assignee === who.department)))
      setDueBadge(mine.filter(t => t.due_date && t.due_date <= today &&
        !(t.snoozed_until && String(t.snoozed_until).slice(0, 10) > today)).length)
    })
    loadUnreadCount(who.name).then(n => { if (!cancelled) setUnread(n || 0) }).catch(() => {})
    return () => { cancelled = true }
  }, [who, tab, drill, taskRev, notifOpen])

  const openJob = useCallback((ids, from) => { setNotifOpen(false); setDrill({ view: 'detail', ...ids, from: from || tab }) }, [tab])
  const openComplete = useCallback((ids) => setDrill(d => ({ ...(d || {}), ...ids, view: 'complete' })), [])
  const closeDrill = useCallback(() => setDrill(d => (d?.view === 'complete' ? { ...d, view: 'detail' } : null)), [])
  const goTab = (k) => { setDrill(null); setMenuOpen(false); setNotifOpen(false); setTab(k) }
  const openTask = useCallback((taskId) => { setDrill(null); setNotifOpen(false); setTaskFocus(taskId); setTab('tasks') }, [])

  const onCapturePick = (e) => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (f) setCaptureFile(f)
  }

  if (authed === undefined || (authed && staffOk === undefined)) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><div className="fl-loading">Loading…</div></div>
  }
  if (!authed) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><FieldLogin /></div>
  }
  if (staffOk === false) return null
  if (!rosterReady) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><div className="fl-loading">Loading the roster…</div></div>
  }
  if (!who) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style>
      <WhoPicker onPick={(name) => {
        setFieldWho(name); setWho(getFieldWho())
        setTab('today'); setDrill(null); setNotifOpen(false)
      }} />
    </div>
  }

  const isOwner = who.isOwner
  const TAB_DEFS = isOwner
    ? [['today', 'TODAY'], ['orders', 'ORDERS'], ['schedule', 'SCHEDULE'], ['tasks', 'TASKS'], ['menu', 'MENU']]
    : [['today', 'TODAY'], ['tasks', 'TASKS'], ['jobs', 'JOBS'], ['find', 'FIND']]

  return (
    <div className="fl-shell">
      <style>{FIELD_CSS}</style>
      <header className="fl-head">
        <div className="fl-head-row">
          <div className="fl-brand">STONEBOOKS <em>FIELD</em></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" aria-label="Notifications"
              style={{ position: 'relative', background: 'none', border: 'none', color: '#E8E2D4', cursor: 'pointer', padding: 6 }}
              onClick={() => { setDrill(null); setNotifOpen(v => !v) }}>
              {GLYPH.bell}
              {unread > 0 && (
                <span style={{ position: 'absolute', top: 0, right: 0, minWidth: 15, height: 15, borderRadius: 8, background: '#9A7209', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', fontFamily: '"JetBrains Mono", Consolas, monospace' }}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            <button type="button" className="fl-who-chip" onClick={() => setMenuOpen(m => !m)}>
              <span className="fl-who-chip-avatar">{who.name.slice(0, 2).toUpperCase()}</span>
              {who.name}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="fl-menu">
            <div className="fl-menu-role">{isOwner ? 'Owner build' : (who.department ? `${who.department} crew` : 'Crew build')}</div>
            <button type="button" onClick={() => { setMenuOpen(false); setPermOpen(true) }}>Notifications</button>
            <button type="button" onClick={() => { setMenuOpen(false); clearFieldWho(); setWho(null) }}>Switch person</button>
            <button type="button" onClick={() => { clearFieldWho(); signOut() }}>Sign out</button>
          </div>
        )}
      </header>

      <main className="fl-body">
        {notifOpen && !drill && (
          <NotificationsScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask}
            onBack={() => setNotifOpen(false)} onAskPermission={() => setPermOpen(true)} />
        )}
        {drill?.view === 'detail' && (
          <JobDetailScreen jobId={drill.jobId} orderId={drill.orderId}
            onBack={closeDrill} onComplete={openComplete} undo={undo} showMoney={isOwner}
            who={who} onTaskChanged={() => setTaskRev(r => r + 1)} />
        )}
        {drill?.view === 'complete' && (
          <CompleteScreen jobId={drill.jobId} orderId={drill.orderId} onBack={closeDrill} />
        )}
        <div style={{ display: (drill || notifOpen) ? 'none' : undefined }}>
          {tab === 'today' && (
            <TodayScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask}
              onOpenTab={goTab} onNewTask={() => setNewTaskOpen(true)} refreshKey={taskRev}
              onCapture={!isOwner ? () => fileRef.current?.click() : null} />
          )}
          {tab === 'tasks' && (
            <TasksScreen who={who} undo={undo} onOpenJob={openJob}
              focusTaskId={taskFocus} onFocusConsumed={() => setTaskFocus(null)}
              onNewTask={() => setNewTaskOpen(true)} refreshKey={taskRev} />
          )}
          {tab === 'jobs' && !isOwner && (
            <WorkHubScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask} />
          )}
          {tab === 'orders' && isOwner && (
            <FindScreen who={who} undo={undo} onOpenJob={openJob} mode="orders" showStatus />
          )}
          {tab === 'schedule' && isOwner && (
            <ScheduleScreen who={who} undo={undo} onOpenJob={openJob} />
          )}
          {tab === 'menu' && isOwner && (
            <MenuScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask} />
          )}
          {tab === 'find' && !isOwner && (
            <FindScreen who={who} undo={undo} onOpenJob={openJob} mode="all" />
          )}
        </div>
      </main>

      <UndoToast toast={undo.toast}
        onUndo={async () => { const u = undo.toast?.undo; undo.clear(); if (u) await u() }}
        onDismiss={undo.clear} />

      {newTaskOpen && (
        <NewTaskSheet who={who} undo={undo} onClose={() => setNewTaskOpen(false)}
          onChanged={() => setTaskRev(r => r + 1)} />
      )}
      {captureFile && (
        <CaptureSheet who={who} undo={undo} file={captureFile} onClose={() => setCaptureFile(null)}
          onChanged={() => setTaskRev(r => r + 1)} />
      )}
      {permOpen && (
        <PermissionSheet who={who} onClose={() => setPermOpen(false)} onGranted={() => setPermOpen(false)} />
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={onCapturePick} />

      <nav className="fl-nav">
        {TAB_DEFS.map(([key, label]) => {
          const on = !notifOpen && ((!drill && tab === key) || (drill && drill.from === key))
          return (
            <button key={key} type="button" className={on ? 'on' : ''} onClick={() => goTab(key)}>
              <span className="fl-nav-glyph">
                {GLYPH[key]}
                {key === 'tasks' && dueBadge > 0 && <span className="fl-badge">{dueBadge > 9 ? '9+' : dueBadge}</span>}
              </span>
              {label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
