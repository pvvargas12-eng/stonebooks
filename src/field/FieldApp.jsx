// =============================================================================
// FieldApp.jsx — STONEBOOKS FIELD · the phone-first crew surface (/field)
// =============================================================================
// FIELD-2 shell (2026-07-18): role-aware rebuild to the approved prototype,
// nav reshaped same-day per Paul. One sign-in, then a per-phone person pick
// (employees roster); the person's is_owner flag resolves the build. Tabs —
// crew: Today / Tasks / [camera] / Jobs / Find (raised capture button);
// owner: Today / Tasks / Jobs / Sales / Find / More — six plain slots, no
// center CTA (new tasks come from the Tasks screen / Today's My-tasks card).
// SALES mirrors the desktop Sales tab (Orders | Leads | All); MORE opens
// every remaining Stonebooks section as a /?tab= desktop deep link. Shares
// the Supabase client + stonebooksData helpers with the desktop and NOTHING
// else; the previous screens (Installs, Production, Orders, Job detail,
// Complete, Inventory) all survive underneath the new chrome.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { getSession, onAuthStateChange, signInWithPassword, signOut } from '../lib/auth'
import { getMyPartnerContext } from '../lib/vendorsData'
import { listShopTasks } from '../lib/stonebooksData'
import { loadEmployees } from '../lib/employees'
import { useUndoToast, FIELD_CSS } from './fieldUndo'
import { getFieldWho, setFieldWho, clearFieldWho, pickerCandidates } from './fieldIdentity'
import { getPushState, disablePush, syncPushOnLaunch } from './fieldPush'
import { loadUnreadCount } from '../lib/notificationsFeed'
import UndoToast from './UndoToast'
import TodayScreen from './TodayScreen'
import TasksScreen from './TasksScreen'
import WorkHubScreen from './WorkHubScreen'
import FindScreen from './FindScreen'
import SalesScreen from './SalesScreen'
import MoreScreen from './MoreScreen'
import NotificationsScreen from './NotificationsScreen'
import PermissionSheet from './PermissionSheet'
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
// The PIN is a picker gate (deterrent, not crypto): it closes the
// "worker taps Paul" hole until real per-person logins land.
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
            onChange={e => { setWrong(false); setPin(e.target.value.replace(/\D/g, '')) }}
            onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) submitPin() }} />
        </div>
        {wrong && <div className="fl-login-err" style={{ marginTop: 10 }}>Wrong PIN — try again.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="fl-btn fl-btn-ghost" style={{ flex: 1 }}
            onClick={() => setPinFor(null)}>Back</button>
          <button type="button" className="fl-btn fl-btn-gold" style={{ flex: 1, opacity: pin.length === 4 ? 1 : 0.5 }}
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
            <span className="fl-chev">›</span>
          </button>
        ))}
      </div>
      <div className="fl-who-note">This sticks on this phone. Every status tap and task will carry your name. Set PINs in Settings, Staff on the desktop.</div>
    </div>
  )
}

// ── Notifications row in the header menu — the settings surface for push ────
// Turning ON routes through the PermissionSheet (the proper ask, mock preview
// and all); turning OFF is a plain toggle.
function NotifMenuRow({ onAskPush }) {
  const [st, setSt] = useState(null)   // null loading | fieldPush state
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    getPushState().then(r => { if (!cancelled) setSt(r.state) })
    return () => { cancelled = true }
  }, [])
  const toggle = async () => {
    if (busy || st === null) return
    if (st === 'on') {
      setBusy(true)
      await disablePush()
      setSt('off')
      setBusy(false)
      return
    }
    onAskPush()
  }
  if (st === 'unsupported') return null
  if (st === 'needs-install') {
    return <div className="fl-menu-note">For notifications, add the app to your Home Screen first (Share → Add to Home Screen).</div>
  }
  if (st === 'denied') {
    return <div className="fl-menu-note">Notifications are blocked for this app — allow them in the phone&#8217;s Settings.</div>
  }
  return (
    <button type="button" disabled={busy || st === null} onClick={toggle}>
      {st === null ? 'Notifications…' : st === 'on' ? 'Notifications: on' : 'Turn on notifications'}
    </button>
  )
}

const GLYPH = {
  today: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.5 17.5 L11 13 C13 11 11 9 13 7 L17.5 6.5" /></svg>,
  tasks: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6 l2 2 l3.5-3.5" /><path d="M4 15 l2 2 l3.5-3.5" /><line x1="13" y1="7" x2="20" y2="7" /><line x1="13" y1="16" x2="20" y2="16" /></svg>,
  jobs: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 4.5 l6 6 -2.5 2.5 -6-6z" /><path d="M12.5 9.5 L4 18 l2 2 8.5-8.5" /><path d="M15 3 l6 6" /></svg>,
  sales: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3 h8 l4 4 v14 h-12 z" /><path d="M14 3 v4 h4" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" /></svg>,
  more: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>,
  find: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>,
  cam: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8 h3 l2-2.5 h6 L17 8 h3 v11 H4 z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 10 a6 6 0 0 1 12 0 c0 5 2 6 2 6 H4 c0 0 2-1 2-6" /><path d="M10 19.5 a2.2 2.2 0 0 0 4 0" /></svg>,
}

export default function FieldApp() {
  const [authed, setAuthed] = useState(undefined)
  const [staffOk, setStaffOk] = useState(undefined)
  const [rosterReady, setRosterReady] = useState(false)
  const [who, setWho] = useState(null)
  const [tab, setTab] = useState('today')
  const [drill, setDrill] = useState(null)          // { view:'detail'|'complete', jobId, orderId, from }
  const [taskFocus, setTaskFocus] = useState(null)  // task id to open on the Tasks tab
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [taskRev, setTaskRev] = useState(0)         // bumps when a sheet writes a task
  const [captureFile, setCaptureFile] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dueBadge, setDueBadge] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)   // the bell feed overlay
  const [unread, setUnread] = useState(0)
  const [permOpen, setPermOpen] = useState(false)     // the PermissionSheet ask
  const [pushRev, setPushRev] = useState(0)           // bumps when the sheet closes
  const fileRef = useRef(null)
  const undo = useUndoToast()

  useEffect(() => {
    let cancelled = false
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

  // Roster before identity: is_owner + departments come off the employees rows.
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

  // Tab badge (my open tasks due today or overdue) + bell unread count.
  // Refreshes on tab change, task writes, and closing the bell.
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
      // Snoozed tasks are off the pressure read everywhere — badge included.
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

  // FIELD-PUSH upkeep, once identity resolves: refresh this phone's
  // subscription row (re-keys it when the phone switched person), clear the
  // home-screen badge, and honor a ?task= / ?order= deep link — a notification
  // tap that cold-started the app lands directly on that record.
  useEffect(() => {
    if (!who) return
    syncPushOnLaunch(who)
    const params = new URLSearchParams(window.location.search)
    const taskId = params.get('task')
    const orderId = params.get('order')
    if (taskId || orderId) {
      window.history.replaceState(null, '', window.location.pathname)
      if (taskId) openTask(taskId)
      else openJob({ orderId, jobId: null }, 'today')
    }
  }, [who, openTask, openJob])

  // A notification tap while the app is already open arrives as a message
  // from sw.js (focus + postMessage — no reload).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e) => {
      if (!e.data || e.data.type !== 'sb-field-open') return
      try {
        const u = new URL(e.data.url, window.location.origin)
        const taskId = u.searchParams.get('task')
        const orderId = u.searchParams.get('order')
        if (taskId) openTask(taskId)
        else if (orderId) openJob({ orderId, jobId: null }, 'today')
      } catch { /* bad url — ignore */ }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [openTask, openJob])

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
        // A new identity may be the other role — never strand nav state on a
        // tab the new build doesn't have.
        setTab('today'); setDrill(null)
      }} />
    </div>
  }

  const isOwner = who.isOwner
  // Owner bar (Paul's directives, in order): no raised center button; SALES
  // (the desktop Sales tab's Orders | Leads | All views) instead of ORDERS;
  // MORE = every remaining Stonebooks section. Crew keeps the approved five
  // with the raised camera capture.
  const TAB_DEFS = isOwner
    ? [['today', 'TODAY'], ['tasks', 'TASKS'], ['jobs', 'JOBS'], ['sales', 'SALES'], ['find', 'FIND'], ['more', 'MORE']]
    : [['today', 'TODAY'], ['tasks', 'TASKS'], ['CENTER'], ['jobs', 'JOBS'], ['find', 'FIND']]

  return (
    <div className="fl-shell">
      <style>{FIELD_CSS}</style>
      <header className="fl-head">
        <div className="fl-head-row">
          <div className="fl-brand">STONEBOOKS <em>FIELD</em></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="fl-bell" aria-label="Notifications"
              onClick={() => { setMenuOpen(false); setDrill(null); setNotifOpen(v => !v) }}>
              {GLYPH.bell}
              {unread > 0 && <span className="fl-bell-badge">{unread > 9 ? '9+' : unread}</span>}
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
            <NotifMenuRow onAskPush={() => { setMenuOpen(false); setPermOpen(true) }} />
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
        {/* Tab screens stay MOUNTED (hidden) during a drill or the bell so
            their internal state — WorkHub's open queue, an open task thread,
            scroll — survives the round trip and back. */}
        <div style={{ display: (drill || notifOpen) ? 'none' : undefined }}>
          {tab === 'today' && (
            <TodayScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask}
              onOpenTab={goTab} onNewTask={() => setNewTaskOpen(true)} refreshKey={taskRev}
              onAskPush={() => setPermOpen(true)} pushRev={pushRev} />
          )}
          {tab === 'tasks' && (
            <TasksScreen who={who} undo={undo} onOpenJob={openJob}
              focusTaskId={taskFocus} onFocusConsumed={() => setTaskFocus(null)}
              onNewTask={() => setNewTaskOpen(true)} refreshKey={taskRev} />
          )}
          {tab === 'jobs' && (
            <WorkHubScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask} />
          )}
          {tab === 'sales' && isOwner && (
            <SalesScreen onOpenJob={openJob} who={who} undo={undo} />
          )}
          {tab === 'more' && isOwner && (
            <MoreScreen who={who} undo={undo} onOpenJob={openJob} onOpenTask={openTask} />
          )}
          {tab === 'find' && (
            <FindScreen who={who} undo={undo} onOpenJob={openJob} mode={isOwner ? 'search' : 'all'} />
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
        <PermissionSheet who={who}
          onClose={() => { setPermOpen(false); setPushRev(r => r + 1) }}
          onGranted={() => { setPermOpen(false); setPushRev(r => r + 1) }} />
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={onCapturePick} />

      <nav className="fl-nav">
        {TAB_DEFS.map(t => {
          if (t[0] === 'CENTER') {
            return (
              <div key="center" className="fl-cta-slot">
                <button type="button" className="fl-cta" aria-label="Take a photo"
                  onClick={() => fileRef.current?.click()}>
                  {GLYPH.cam}
                </button>
              </div>
            )
          }
          const [key, label] = t
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
