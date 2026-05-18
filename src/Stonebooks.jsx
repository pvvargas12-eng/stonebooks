// =============================================================================
// 📚 Stonebooks — Staff app shell
// =============================================================================
// Top-level Stonebooks component. Owns:
//   - Auth gate (shows login when not signed in)
//   - Theme + design-token injection
//   - Sidebar navigation with profile photo + display name
//   - Tab routing (Today / Customers / Orders / Calendar / Reports / Settings)
//   - Sales Mode launch (lives inside Stonebooks)
// =============================================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getUser, signInWithPassword, signInWithMagicLink, signOut,
  onAuthStateChange, updatePassword,
} from './lib/auth'
import { buildThemeCSS, loadTheme, saveTheme } from './lib/stonebooksTheme'
import { getUserSettings, upsertUserSettings, uploadProfilePhoto, fmtUSD } from './lib/stonebooksData'
import SalesMode from './SalesMode'
import CustomersTab from './CustomersTab'
import OrdersTab from './OrdersTab'
import JobsTab from './JobsTab'
import CalendarTab from './CalendarTab'
import ReportsTab from './ReportsTab'

// =============================================================================
// LOGO COMPONENTS
// =============================================================================

function StonebooksWordmark({ size = 20, color = 'currentColor' }) {
  // Lowercase wordmark — geometric sans, tight tracking. Matches the
  // brand image: stonebooks rendered as live text in Inter (system fallback
  // to other geometric sans). Tight letter-spacing matches the logo's feel.
  return (
    <span style={{
      fontFamily: 'var(--sb-font-sans)',
      fontSize: size,
      fontWeight: 500,
      letterSpacing: '-0.035em',
      color,
      lineHeight: 1,
      userSelect: 'none',
      display: 'inline-block',
    }}>stonebooks</span>
  )
}

function StonebooksMark({ size = 32, dark = true }) {
  // The S3 mark — used as favicon, app icon, avatar fallback
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: size * 0.18,
      background: dark ? '#0f1419' : '#fff',
      color: dark ? '#fff' : '#0f1419',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--sb-font-mono)',
      fontSize: size * 0.45,
      fontWeight: 500,
      letterSpacing: '-0.04em',
      userSelect: 'none',
    }}>S3</div>
  )
}

// =============================================================================
// LOGIN SCREEN
// =============================================================================

function LoginScreen() {
  const [mode, setMode] = useState('password') // 'password' | 'magic'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [magicSent, setMagicSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) { setErr('Email required'); return }
    setBusy(true); setErr(null)

    if (mode === 'password') {
      if (!password) { setErr('Password required'); setBusy(false); return }
      const r = await signInWithPassword(email, password)
      if (!r.ok) setErr(r.error)
      // On success, onAuthStateChange fires and the parent re-renders
    } else {
      const r = await signInWithMagicLink(email)
      if (!r.ok) setErr(r.error)
      else setMagicSent(true)
    }
    setBusy(false)
  }

  if (magicSent) {
    return (
      <div className="sb-login-root">
        <div className="sb-login-card">
          <div className="sb-login-mark"><StonebooksWordmark size={28} /></div>
          <div className="sb-login-title">Check your email</div>
          <div className="sb-login-sub">
            A sign-in link is on its way to <strong>{email}</strong>.
            Click it to continue.
          </div>
          <button
            type="button"
            className="sb-link"
            onClick={() => { setMagicSent(false); setMode('password') }}
          >Use a password instead</button>
        </div>
      </div>
    )
  }

  return (
    <div className="sb-login-root">
      <form className="sb-login-card" onSubmit={handleSubmit}>
        <div className="sb-login-mark"><StonebooksWordmark size={28} /></div>
        <div className="sb-login-title">Sign in</div>

        <label className="sb-label">Email</label>
        <input
          type="email"
          className="sb-input"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoFocus
          autoComplete="email"
          placeholder="you@shop.com"
          disabled={busy}
        />

        {mode === 'password' && (
          <>
            <label className="sb-label">Password</label>
            <input
              type="password"
              className="sb-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </>
        )}

        {err && <div className="sb-login-err">{err}</div>}

        <button type="submit" className="sb-btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : (mode === 'password' ? 'Sign in' : 'Send magic link')}
        </button>

        <button
          type="button"
          className="sb-link sb-login-toggle"
          onClick={() => { setMode(mode === 'password' ? 'magic' : 'password'); setErr(null) }}
        >
          {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
        </button>
      </form>
    </div>
  )
}

// =============================================================================
// MAIN SHELL
// =============================================================================

const NAV_PRIMARY = [
  { key: 'today',     label: 'Today' },
  { key: 'customers', label: 'Customers' },
  { key: 'orders',    label: 'Orders' },
  { key: 'jobs',      label: 'Jobs' },
  { key: 'calendar',  label: 'Calendar' },
  { key: 'reports',   label: 'Reports' },
]

const NAV_SECONDARY = [
  { key: 'sales',    label: '+ New sale' },
  { key: 'catalog',  label: 'Catalog' },
  { key: 'settings', label: 'Settings' },
]

export default function Stonebooks() {
  const [user, setUser] = useState(undefined)  // undefined = loading; null = signed out; object = signed in
  const [theme, setTheme] = useState(loadTheme())
  const [tab, setTab] = useState('today')
  const [salesOpen, setSalesOpen] = useState(false)
  const [salesOrderId, setSalesOrderId] = useState(null)   // when set, open Sales Mode with that order pre-loaded
  const [profile, setProfile] = useState(null)  // user_settings row
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)  // for customer drill-in across tabs

  // Open Sales Mode — either fresh (no id) or with a specific order
  const openSales = (orderId = null) => {
    setSalesOrderId(orderId)
    setSalesOpen(true)
  }
  const closeSales = () => {
    setSalesOpen(false)
    setSalesOrderId(null)
  }

  const reloadProfile = async () => {
    if (!user?.id) return
    const s = await getUserSettings(user.id)
    setProfile(s)
  }

  // Subscribe to auth state on mount
  useEffect(() => {
    let unsub = null
    getUser().then(u => setUser(u))
    unsub = onAuthStateChange((u) => setUser(u))
    return () => { if (unsub) unsub() }
  }, [])

  // Load profile when user lands
  useEffect(() => {
    if (user?.id) reloadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Persist theme on change
  useEffect(() => { saveTheme(theme) }, [theme])

  // Cross-tab navigation events from quick actions, etc.
  useEffect(() => {
    const handler = (e) => setTab(e.detail)
    window.addEventListener('sb:nav', handler)
    return () => window.removeEventListener('sb:nav', handler)
  }, [])

  // Build CSS once per theme
  const themeCSS = useMemo(() => buildThemeCSS(theme), [theme])

  // Loading state
  if (user === undefined) {
    return (
      <>
        <style>{themeCSS}</style>
        <style>{shellStyles}</style>
        <div className="sb-loading">Loading…</div>
      </>
    )
  }

  // Not signed in → login
  if (user === null) {
    return (
      <>
        <style>{themeCSS}</style>
        <style>{shellStyles}</style>
        <LoginScreen />
      </>
    )
  }

  // Sales Mode opens as a full-screen overlay
  if (salesOpen) {
    return <SalesMode onClose={closeSales} initialOrderId={salesOrderId} />
  }

  const handleNav = (key) => {
    if (key === 'sales') {
      setSalesOpen(true)
      return
    }
    setTab(key)
  }

  return (
    <>
      <style>{themeCSS}</style>
      <style>{shellStyles}</style>

      <div className="sb-root">
        <aside className="sb-sidebar">
          <div className="sb-sidebar-brand">
            <StonebooksWordmark size={18} color="var(--sb-text-on-dark)" />
          </div>

          <nav className="sb-nav">
            <div className="sb-nav-section-label">Workspace</div>
            {NAV_PRIMARY.map(item => (
              <button
                key={item.key}
                type="button"
                className={`sb-nav-item ${tab === item.key ? 'on' : ''}`}
                onClick={() => handleNav(item.key)}
              >{item.label}</button>
            ))}

            <div className="sb-nav-section-label" style={{ marginTop: 16 }}>Tools</div>
            {NAV_SECONDARY.map(item => (
              <button
                key={item.key}
                type="button"
                className={`sb-nav-item ${tab === item.key ? 'on' : ''} ${item.key === 'sales' ? 'sb-nav-item-action' : ''}`}
                onClick={() => handleNav(item.key)}
              >{item.label}</button>
            ))}
          </nav>

          <div className="sb-sidebar-foot">
            <button type="button" className="sb-user-row" onClick={() => setTab('settings')}>
              {profile?.profile_photo_url ? (
                <img src={profile.profile_photo_url} className="sb-user-photo" alt="" />
              ) : (
                <div className="sb-user-avatar">
                  {(profile?.display_name || user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="sb-user-info">
                <div className="sb-user-name">{profile?.display_name || user.email}</div>
                <div className="sb-user-shop">Shevchenko Monuments</div>
              </div>
            </button>
          </div>
        </aside>

        <main className="sb-main">
          {tab === 'today'     && <TodayTab user={user} profile={profile} onOpenSales={() => openSales()} onOpenOrder={openSales} onOpenCustomer={(id) => { setSelectedCustomerId(id); setTab('customers') }} />}
{tab === 'customers' && <CustomersTab selectedId={selectedCustomerId} setSelectedId={setSelectedCustomerId} onOpenOrder={openSales} />}
{tab === 'orders'    && <OrdersTab onOpenSales={() => openSales()} onOpenOrder={openSales} onOpenCustomer={(id) => { setSelectedCustomerId(id); setTab('customers') }} />}
{tab === 'jobs'      && <JobsTab onOpenOrder={openSales} onOpenCustomer={(id) => { setSelectedCustomerId(id); setTab('customers') }} />}
{tab === 'calendar'  && <CalendarTab onOpenOrder={openSales} />}
{tab === 'reports'   && <ReportsTab />}
          {tab === 'catalog'   && <PlaceholderTab title="Catalog" lines={[
            'Coming next: design library management — upload new monuments, edit metadata, organize by category.',
            'For now, the catalog browses on the customer-facing site.',
          ]} />}
          {tab === 'settings'  && <SettingsTab user={user} profile={profile} theme={theme} setTheme={setTheme} onProfileChange={reloadProfile} />}
        </main>
      </div>
    </>
  )
}

// =============================================================================
// TODAY TAB
// =============================================================================

function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenCustomer }) {
  const [stats, setStats] = useState(null)
  const [actionItems, setActionItems] = useState(null)
  const today = useMemo(() => {
    const d = new Date()
    const day = d.toLocaleDateString('en-US', { weekday: 'long' })
    const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return { day, date }
  }, [])

  // Load summary stats + action items
  useEffect(() => {
    let cancelled = false
    import('./lib/stonebooksData').then(async (m) => {
      const [orders, items] = await Promise.all([
        m.listAllOrders({ limit: 500 }),
        m.getActionItems(),
      ])
      if (cancelled) return
      const ACTIVE = ['draft','scoping','quoted','contracted','in_production','installed']
      const SOLD   = ['contracted','in_production','installed','paid_in_full','closed']
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)

      let active = 0, pipeline = 0, mtd = 0, mtdCount = 0
      let sold = 0, cancelled_count = 0
      for (const o of orders) {
        const total = computeTotal(o)
        if (ACTIVE.includes(o.status)) { active++; pipeline += total }
        if (SOLD.includes(o.status)) {
          sold++
          if (new Date(o.created_at) >= monthStart) { mtd += total; mtdCount++ }
        }
        if (o.status === 'cancelled') cancelled_count++
      }
      const attempted = sold + cancelled_count
      const winRate = attempted > 0 ? Math.round((sold / attempted) * 100) : null

      setStats({ active, pipeline, mtd, mtdCount, winRate })
      setActionItems(items)
    })
    return () => { cancelled = true }
  }, [])

  const greeting = profile?.display_name ? profile.display_name.split(' ')[0] : 'there'

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">{today.day} · {today.date}</div>
        <h1 className="sb-page-title">Today</h1>
      </div>

      <div className="sb-metric-grid">
        <MetricCard label="Active orders" value={stats ? stats.active : '—'} sub={stats ? `${fmtUSD(stats.pipeline)} in pipeline` : ''} />
        <MetricCard label="Month-to-date" value={stats ? fmtUSD(stats.mtd) : '—'} sub={stats ? `${stats.mtdCount} sold` : ''} />
        <MetricCard label="Win rate" value={stats?.winRate != null ? `${stats.winRate}%` : '—'} sub="cancelled vs sold" />
        <MetricCard label="Action items" value={actionItems ? actionItems.length : '—'} sub={actionItems && actionItems.length > 0 ? `${actionItems.filter(i => i.severity === 'red').length} urgent` : 'all caught up'} />
      </div>

      <div className="sb-section-label">Quick actions</div>
      <div className="sb-quick-actions">
        <button type="button" className="sb-quick-action" onClick={onOpenSales}>
          <div className="sb-quick-action-title">+ New sale</div>
          <div className="sb-quick-action-sub">Walk a customer through the wizard</div>
        </button>
        <button type="button" className="sb-quick-action" onClick={() => window.dispatchEvent(new CustomEvent('sb:nav', { detail: 'customers' }))}>
          <div className="sb-quick-action-title">Customers</div>
          <div className="sb-quick-action-sub">Search by name, phone, email</div>
        </button>
        <button type="button" className="sb-quick-action" onClick={() => window.dispatchEvent(new CustomEvent('sb:nav', { detail: 'reports' }))}>
          <div className="sb-quick-action-title">Reports</div>
          <div className="sb-quick-action-sub">Sales analytics, win rate, by rep</div>
        </button>
      </div>

      <div className="sb-section-label">Action items</div>
      {actionItems === null ? (
        <div className="sb-empty">Loading…</div>
      ) : actionItems.length === 0 ? (
        <div className="sb-empty">Nothing needs attention right now. As orders age past target dates or quotes go stale, items will surface here.</div>
      ) : (
        <div className="sb-action-list">
          {actionItems.map((item, idx) => (
            <button
              key={`${item.order.id}-${item.kind}-${idx}`}
              type="button"
              className={`sb-action-item sb-action-${item.severity}`}
              onClick={() => onOpenOrder(item.order.id)}
            >
              <span className="sb-action-icon">{item.icon}</span>
              <div className="sb-action-body">
                <div className="sb-action-label">{item.label}</div>
                <div className="sb-action-meta">{item.meta}</div>
              </div>
              <span className="sb-action-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Inline total computation — duplicated tiny version of stonebooksData rowGrandTotal
// to avoid import cycle issues in TodayTab
function computeTotal(o) {
  if (!o) return 0
  const pricing = o.pricing || {}
  const overrides = pricing.overrides || {}
  const addOns = o.add_ons || []
  let subtotalDisc = 0, subtotalPermit = 0
  if (overrides['base-stone'] != null) subtotalDisc += Number(overrides['base-stone']) || 0
  for (const [code, val] of Object.entries(overrides)) {
    if (code === 'base-stone' || typeof val !== 'number') continue
    if (code === 'addon-permit') subtotalPermit += val
    else                          subtotalDisc += val
  }
  for (const a of addOns) {
    if (a.freeWithStone) continue
    const amt = (Number(a.price) || 0) * (Number(a.qty) || 1)
    if (a.code === 'permit') subtotalPermit += amt
    else                     subtotalDisc += amt
  }
  for (const c of (pricing.customLineItems || [])) subtotalDisc += Number(c.amount) || 0
  const discountPct = Number(pricing.discountPct) || 0
  const discountAmt = subtotalDisc * (discountPct / 100)
  const taxBase = (subtotalDisc - discountAmt) + subtotalPermit
  const tax = pricing.applyTax ? taxBase * 0.06625 : 0
  const cc = pricing.applyCCSurcharge ? (taxBase + tax) * 0.03 : 0
  return Math.round(taxBase + tax + cc)
}

// =============================================================================
// SETTINGS TAB
// =============================================================================

function SettingsTab({ user, profile, theme, setTheme, onProfileChange }) {
  const [section, setSection] = useState('profile')

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Settings</div>
        <h1 className="sb-page-title">Preferences</h1>
      </div>

      <div className="sb-settings-grid">
        <nav className="sb-settings-nav">
          {[
            { k: 'profile',    l: 'Profile' },
            { k: 'appearance', l: 'Appearance' },
            { k: 'account',    l: 'Account' },
            { k: 'shop',       l: 'Shop info' },
            { k: 'staff',      l: 'Staff' },
            { k: 'about',      l: 'About' },
          ].map(s => (
            <button
              key={s.k}
              type="button"
              className={`sb-settings-tab ${section === s.k ? 'on' : ''}`}
              onClick={() => setSection(s.k)}
            >{s.l}</button>
          ))}
        </nav>

        <div className="sb-settings-body">
          {section === 'profile'    && <ProfileSettings user={user} profile={profile} onProfileChange={onProfileChange} />}
          {section === 'appearance' && <AppearanceSettings theme={theme} setTheme={setTheme} />}
          {section === 'account'    && <AccountSettings user={user} />}
          {section === 'shop'       && <ShopSettings />}
          {section === 'staff'      && <StaffSettings />}
          {section === 'about'      && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function ProfileSettings({ user, profile, onProfileChange }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoErr, setPhotoErr] = useState(null)

  // Sync when profile loads
  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name)
  }, [profile?.display_name])

  const saveName = async () => {
    setBusy(true); setMsg(null)
    const r = await upsertUserSettings(user.id, { display_name: displayName.trim() })
    setBusy(false)
    if (!r.ok) setMsg({ type: 'err', text: r.error })
    else { setMsg({ type: 'ok', text: 'Saved' }); onProfileChange?.() }
  }

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoErr('Please pick an image file (PNG, JPG, etc.)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoErr('Image must be under 5 MB')
      return
    }
    setPhotoBusy(true); setPhotoErr(null)
    const up = await uploadProfilePhoto(user.id, file)
    if (!up.ok) {
      setPhotoBusy(false)
      setPhotoErr(up.error)
      return
    }
    const r = await upsertUserSettings(user.id, { profile_photo_url: up.url })
    setPhotoBusy(false)
    if (!r.ok) setPhotoErr(r.error)
    else onProfileChange?.()
  }

  const removePhoto = async () => {
    if (!confirm('Remove your profile photo?')) return
    setPhotoBusy(true); setPhotoErr(null)
    const r = await upsertUserSettings(user.id, { profile_photo_url: null })
    setPhotoBusy(false)
    if (!r.ok) setPhotoErr(r.error)
    else onProfileChange?.()
  }

  return (
    <>
      <SettingsRow label="Display name" hint="Shown in the sidebar and across Stonebooks instead of your email.">
        <div className="sb-form-stack">
          <input
            type="text"
            className="sb-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Paul Vargas"
            disabled={busy}
          />
          <button type="button" className="sb-btn-primary" onClick={saveName} disabled={busy || !displayName.trim()}>
            {busy ? 'Saving…' : 'Save name'}
          </button>
          {msg && <div className={`sb-msg sb-msg-${msg.type}`}>{msg.text}</div>}
        </div>
      </SettingsRow>

      <SettingsRow label="Profile photo" hint="Replaces the initials avatar in the sidebar. Square images work best.">
        <div className="sb-photo-row">
          {profile?.profile_photo_url ? (
            <img src={profile.profile_photo_url} className="sb-photo-preview" alt="Your profile photo" />
          ) : (
            <div className="sb-photo-empty">{(displayName || user.email || '?')[0].toUpperCase()}</div>
          )}
          <div className="sb-photo-actions">
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChosen} />
            <button type="button" className="sb-btn-secondary" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
              {photoBusy ? 'Uploading…' : (profile?.profile_photo_url ? 'Replace photo' : 'Upload photo')}
            </button>
            {profile?.profile_photo_url && (
              <button type="button" className="sb-link sb-link-danger" onClick={removePhoto} disabled={photoBusy}>Remove</button>
            )}
            {photoErr && <div className="sb-msg sb-msg-err">{photoErr}</div>}
          </div>
        </div>
      </SettingsRow>
    </>
  )
}

function AppearanceSettings({ theme, setTheme }) {
  return (
    <>
      <SettingsRow
        label="Theme"
        hint="Light is calmer for daytime; dark reduces glare in low light."
      >
        <div className="sb-segmented">
          <button type="button" className={`sb-seg ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>Light</button>
          <button type="button" className={`sb-seg ${theme === 'dark'  ? 'on' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </SettingsRow>

      <SettingsRow
        label="Density"
        hint="Coming soon — control padding for compact vs. comfortable layouts."
      >
        <div className="sb-segmented" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          <button type="button" className="sb-seg on">Comfortable</button>
          <button type="button" className="sb-seg">Compact</button>
        </div>
      </SettingsRow>
    </>
  )
}

function AccountSettings({ user }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const changePassword = async () => {
    setMsg(null)
    if (newPassword.length < 8) { setMsg({ type: 'err', text: 'Password must be at least 8 characters' }); return }
    if (newPassword !== confirmPassword) { setMsg({ type: 'err', text: 'Passwords do not match' }); return }
    setBusy(true)
    const r = await updatePassword(newPassword)
    setBusy(false)
    if (r.ok) {
      setMsg({ type: 'ok', text: 'Password updated' })
      setNewPassword(''); setConfirmPassword('')
    } else {
      setMsg({ type: 'err', text: r.error })
    }
  }

  const handleSignOut = async () => {
    if (!confirm('Sign out of Stonebooks?')) return
    await signOut()
  }

  return (
    <>
      <SettingsRow label="Email">
        <div className="sb-readonly">{user.email}</div>
      </SettingsRow>

      <SettingsRow label="Change password">
        <div className="sb-form-stack">
          <input
            type="password"
            className="sb-input"
            placeholder="New password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={busy}
          />
          <input
            type="password"
            className="sb-input"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="sb-btn-primary" onClick={changePassword} disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
          {msg && <div className={`sb-msg sb-msg-${msg.type}`}>{msg.text}</div>}
        </div>
      </SettingsRow>

      <SettingsRow label="Sign out">
        <button type="button" className="sb-btn-secondary" onClick={handleSignOut}>Sign out</button>
      </SettingsRow>
    </>
  )
}

function ShopSettings() {
  return (
    <>
      <SettingsRow label="Shop name"><div className="sb-readonly">Shevchenko Monuments</div></SettingsRow>
      <SettingsRow label="Address"><div className="sb-readonly">329 S Florida Grove Rd, Perth Amboy, NJ 08861</div></SettingsRow>
      <SettingsRow label="Phone"><div className="sb-readonly">732-442-1286</div></SettingsRow>
      <SettingsRow label="Tax rate"><div className="sb-readonly">NJ 6.625%</div></SettingsRow>
      <div className="sb-helper">Editable shop info coming next — for now these are hardcoded.</div>
    </>
  )
}

function StaffSettings() {
  return (
    <>
      <div className="sb-helper">Staff management coming next. For now, contact your administrator (Pauly) to add or remove staff accounts.</div>
    </>
  )
}

function AboutSettings() {
  return (
    <>
      <SettingsRow label="Version"><div className="sb-readonly">Stonebooks 0.1 (foundation)</div></SettingsRow>
      <SettingsRow label="Build"><div className="sb-readonly sb-mono">stonebooks-shell-2026.05</div></SettingsRow>
      <div className="sb-helper">Built for Shevchenko Monuments, est. 1919.</div>
    </>
  )
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================

function MetricCard({ label, value, sub }) {
  return (
    <div className="sb-metric">
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value}</div>
      {sub && <div className="sb-metric-sub">{sub}</div>}
    </div>
  )
}

function PlaceholderTab({ title, lines = [] }) {
  return (
    <div className="sb-page">
      <div className="sb-page-head">
        <h1 className="sb-page-title">{title}</h1>
      </div>
      <div className="sb-empty">
        {lines.map((l, i) => <p key={i} style={{ marginBottom: 8 }}>{l}</p>)}
      </div>
    </div>
  )
}

function SettingsRow({ label, hint, children }) {
  return (
    <div className="sb-settings-row">
      <div className="sb-settings-row-label">
        <div className="sb-settings-row-name">{label}</div>
        {hint && <div className="sb-settings-row-hint">{hint}</div>}
      </div>
      <div className="sb-settings-row-control">{children}</div>
    </div>
  )
}

// =============================================================================
// STYLES — single string injected once
// =============================================================================

const shellStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  .sb-root {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
    background: var(--sb-bg);
    color: var(--sb-text);
    font-family: var(--sb-font-sans);
    font-size: 13px;
    line-height: 1.5;
  }

  .sb-loading {
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: var(--sb-bg);
    color: var(--sb-text-muted);
    font-family: var(--sb-font-sans);
    font-size: 13px;
  }

  /* SIDEBAR */
  .sb-sidebar {
    background: var(--sb-sidebar);
    color: var(--sb-text-on-dark);
    display: flex; flex-direction: column;
    padding: 16px 12px;
    border-right: 0.5px solid var(--sb-border);
  }
  .sb-sidebar-brand {
    padding: 8px 8px 20px;
    border-bottom: 0.5px solid rgba(255,255,255,0.06);
    margin-bottom: 16px;
  }
  .sb-nav { flex: 1; display: flex; flex-direction: column; }
  .sb-nav-section-label {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sb-text-on-dark-muted);
    padding: 0 8px;
    margin-bottom: 6px;
  }
  .sb-nav-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--sb-text-on-dark-muted);
    font: inherit;
    padding: 7px 10px;
    border-radius: var(--sb-r-md);
    cursor: pointer;
    margin-bottom: 1px;
    transition: background 0.1s, color 0.1s;
  }
  .sb-nav-item:hover { background: rgba(255,255,255,0.06); color: var(--sb-text-on-dark); }
  .sb-nav-item.on    { background: rgba(255,255,255,0.10); color: var(--sb-text-on-dark); font-weight: 500; }
  .sb-nav-item-action {
    color: var(--sb-text-on-dark);
    font-weight: 500;
  }
  .sb-sidebar-foot {
    border-top: 0.5px solid rgba(255,255,255,0.06);
    padding-top: 12px;
  }
  .sb-user-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px;
    border-radius: var(--sb-r-md);
    cursor: pointer;
  }
  .sb-user-row:hover { background: rgba(255,255,255,0.06); }
  .sb-user-avatar {
    width: 28px; height: 28px;
    border-radius: var(--sb-r-md);
    background: rgba(255,255,255,0.10);
    color: var(--sb-text-on-dark);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--sb-font-mono);
    font-size: 12px;
    font-weight: 500;
  }
  .sb-user-info { flex: 1; min-width: 0; }
  .sb-user-email {
    font-size: 12px; color: var(--sb-text-on-dark);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sb-user-shop {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    color: var(--sb-text-on-dark-muted);
    letter-spacing: 0.02em;
  }

  /* MAIN */
  .sb-main {
    overflow-y: auto;
    padding: 32px 40px;
  }
  .sb-page { max-width: 920px; }
  .sb-page-head { margin-bottom: 24px; }
  .sb-page-eyebrow {
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
  }
  .sb-page-title {
    font-size: 24px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--sb-text);
    margin: 0;
  }
  .sb-section-label {
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin: 24px 0 8px;
  }

  .sb-empty {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 24px;
    color: var(--sb-text-secondary);
    line-height: 1.6;
  }

  /* METRICS */
  .sb-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  }
  .sb-metric {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 14px 16px;
  }
  .sb-metric-label {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 6px;
  }
  .sb-metric-value {
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--sb-text);
    font-family: var(--sb-font-mono);
  }
  .sb-metric-sub {
    margin-top: 4px;
    font-size: 11px;
    color: var(--sb-text-muted);
  }

  /* QUICK ACTIONS */
  .sb-quick-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .sb-quick-action {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 14px 16px;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .sb-quick-action:hover { border-color: var(--sb-border-hover); }
  .sb-quick-action-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
    margin-bottom: 2px;
  }
  .sb-quick-action-sub {
    font-size: 12px;
    color: var(--sb-text-muted);
  }

  /* LOGIN */
  .sb-login-root {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sb-bg);
    padding: 24px;
  }
  .sb-login-card {
    width: 100%;
    max-width: 360px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-lg);
    padding: 32px;
    display: flex;
    flex-direction: column;
  }
  .sb-login-mark { margin-bottom: 28px; padding-bottom: 4px; }
  .sb-login-title {
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--sb-text);
    margin-bottom: 20px;
  }
  .sb-login-sub {
    font-size: 13px;
    color: var(--sb-text-secondary);
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .sb-login-err {
    background: var(--sb-red-bg);
    color: var(--sb-red);
    border-radius: var(--sb-r-md);
    padding: 8px 12px;
    font-size: 12px;
    margin-bottom: 12px;
  }
  .sb-login-toggle {
    margin-top: 12px;
    text-align: center;
  }

  /* FORM PRIMITIVES */
  .sb-label {
    font-size: 11px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
    margin-top: 8px;
  }
  .sb-input {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 9px 12px;
    font: inherit;
    color: var(--sb-text);
    margin-bottom: 8px;
    outline: none;
    transition: border-color 0.1s, box-shadow 0.1s;
  }
  .sb-input:focus {
    border-color: var(--sb-border-focus);
    box-shadow: 0 0 0 3px var(--sb-accent-bg);
  }
  .sb-input:disabled { opacity: 0.6; cursor: not-allowed; }

  .sb-btn-primary {
    background: var(--sb-text);
    color: var(--sb-bg);
    border: none;
    border-radius: var(--sb-r-md);
    padding: 9px 14px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    margin-top: 12px;
    transition: opacity 0.1s;
  }
  .sb-btn-primary:hover { opacity: 0.9; }
  .sb-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .sb-btn-secondary {
    background: var(--sb-surface);
    color: var(--sb-text);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 9px 14px;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .sb-btn-secondary:hover { border-color: var(--sb-border-hover); }

  .sb-link {
    background: none; border: none;
    color: var(--sb-accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  .sb-link:hover { color: var(--sb-accent-hover); text-decoration: underline; }

  .sb-readonly {
    color: var(--sb-text-secondary);
    font-size: 13px;
  }
  .sb-mono { font-family: var(--sb-font-mono); }

  .sb-helper {
    font-size: 12px;
    color: var(--sb-text-muted);
    line-height: 1.6;
    margin-top: 12px;
  }

  .sb-msg {
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--sb-r-sm);
    margin-top: 4px;
  }
  .sb-msg-ok  { background: var(--sb-green-bg); color: var(--sb-green); }
  .sb-msg-err { background: var(--sb-red-bg);   color: var(--sb-red); }

  .sb-form-stack {
    display: flex; flex-direction: column;
    width: 100%; max-width: 280px;
  }

  /* SETTINGS */
  .sb-settings-grid {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 32px;
    align-items: flex-start;
  }
  .sb-settings-nav {
    display: flex; flex-direction: column;
    gap: 1px;
  }
  .sb-settings-tab {
    background: transparent;
    border: none;
    padding: 7px 10px;
    text-align: left;
    color: var(--sb-text-secondary);
    border-radius: var(--sb-r-md);
    font: inherit;
    cursor: pointer;
  }
  .sb-settings-tab:hover { background: var(--sb-surface-muted); }
  .sb-settings-tab.on {
    background: var(--sb-surface-muted);
    color: var(--sb-text);
    font-weight: 500;
  }
  .sb-settings-body {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 8px 24px;
  }
  .sb-settings-row {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 24px;
    padding: 16px 0;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-settings-row:last-child { border-bottom: none; }
  .sb-settings-row-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-settings-row-hint {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
    line-height: 1.5;
  }
  .sb-settings-row-control {
    min-width: 0;
  }

  /* SEGMENTED */
  .sb-segmented {
    display: inline-flex;
    background: var(--sb-surface-muted);
    border-radius: var(--sb-r-md);
    padding: 2px;
  }
  .sb-seg {
    background: transparent;
    border: none;
    padding: 5px 12px;
    font: inherit;
    font-size: 12px;
    color: var(--sb-text-secondary);
    border-radius: var(--sb-r-sm);
    cursor: pointer;
  }
  .sb-seg.on {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }

  /* ── FULL-WIDTH PAGES ─────────────────────────────────────────── */
  .sb-page-wide { max-width: none; }

  /* User row in sidebar */
  .sb-user-row { background: transparent; border: none; font: inherit; color: inherit; width: 100%; text-align: left; }
  .sb-user-photo {
    width: 32px; height: 32px;
    border-radius: var(--sb-r-md);
    object-fit: cover;
    flex-shrink: 0;
  }
  .sb-user-name {
    font-size: 12px;
    color: var(--sb-text-on-dark);
    font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ── COMMON UTILITY CLASSES ──────────────────────────────────────── */
  .sb-muted { color: var(--sb-text-muted); }
  .sb-num { text-align: right; }
  .sb-prewrap { white-space: pre-wrap; }
  .sb-link-danger { color: var(--sb-red); }
  .sb-link-danger:hover { color: var(--sb-red); opacity: 0.8; }
  .sb-card {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 16px 18px;
    margin-bottom: 8px;
  }
  .sb-meta-label {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
  }

  /* ── CUSTOMERS TAB ─────────────────────────────────────────────── */
  .sb-cust-toolbar {
    display: flex; gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .sb-cust-search { flex: 1; min-width: 240px; margin-bottom: 0; }
  .sb-cust-sort { width: 200px; margin-bottom: 0; }
  .sb-cust-meta {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-bottom: 12px;
  }

  .sb-cust-table {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    overflow: hidden;
  }
  .sb-cust-row {
    display: grid;
    grid-template-columns: 2fr 1.5fr 1fr 80px 130px 130px;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 0.5px solid var(--sb-border);
    background: transparent;
    border-left: none; border-right: none; border-top: none;
    font: inherit; color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    align-items: center;
  }
  .sb-cust-row:hover { background: var(--sb-surface-muted); }
  .sb-cust-row:last-child { border-bottom: none; }
  .sb-cust-row-head {
    background: var(--sb-bg);
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    cursor: default;
  }
  .sb-cust-row-head:hover { background: var(--sb-bg); }

  .sb-orders-row {
    grid-template-columns: 90px 1.5fr 1.5fr 100px 110px 110px 130px 80px;
  }

  .sb-cust-name-cell {
    display: flex; align-items: center; gap: 10px;
  }
  .sb-cust-avatar {
    width: 32px; height: 32px;
    border-radius: var(--sb-r-md);
    background: var(--sb-surface-muted);
    color: var(--sb-text-secondary);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--sb-font-mono);
    font-size: 11px;
    font-weight: 500;
    flex-shrink: 0;
  }
  .sb-cust-avatar-lg {
    width: 56px; height: 56px;
    font-size: 18px;
    border-radius: var(--sb-r-lg);
  }
  .sb-cust-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-cust-active-tag {
    font-size: 10px;
    color: var(--sb-amber);
    background: var(--sb-amber-bg);
    padding: 1px 6px;
    border-radius: var(--sb-r-sm);
    display: inline-block;
    margin-top: 2px;
    font-family: var(--sb-font-mono);
  }
  .sb-cust-contact {
    font-size: 12px;
    color: var(--sb-text);
    line-height: 1.4;
  }
  .sb-cust-location {
    font-size: 12px;
    color: var(--sb-text-secondary);
  }

  /* CUSTOMER DETAIL */
  .sb-cust-detail-head {
    display: flex; align-items: center; gap: 16px;
    margin-bottom: 8px;
  }
  .sb-cust-detail-meta {
    display: flex; flex-wrap: wrap; gap: 16px;
    margin-top: 6px;
    font-size: 13px;
    color: var(--sb-text-secondary);
  }

  /* ORDER LIST IN DETAIL VIEW */
  .sb-order-list {
    display: flex; flex-direction: column; gap: 8px;
  }
  .sb-order-card {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 12px 16px;
  }
  .sb-order-card-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .sb-order-num {
    font-family: var(--sb-font-mono);
    font-size: 13px;
    font-weight: 500;
  }
  .sb-order-meta {
    display: flex; gap: 12px;
    font-size: 11px;
    color: var(--sb-text-secondary);
    margin-top: 2px;
  }
  .sb-order-card-body {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
    padding-top: 10px;
    border-top: 0.5px solid var(--sb-border);
  }

  /* STATUS PILL */
  .sb-status-pill {
    display: inline-block;
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: var(--sb-r-sm);
    font-weight: 500;
    color: var(--pill-color, var(--sb-text));
    background: color-mix(in srgb, var(--pill-color, #888) 12%, transparent);
    border: 0.5px solid color-mix(in srgb, var(--pill-color, #888) 30%, transparent);
  }

  /* PILL ROW (filter pills) */
  .sb-pill-row {
    display: flex; gap: 4px; flex-wrap: wrap;
    padding: 12px 0;
    align-items: center;
  }
  .sb-pill {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-secondary);
    font: inherit;
    font-size: 12px;
    padding: 5px 12px;
    border-radius: var(--sb-r-sm);
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .sb-pill:hover { border-color: var(--sb-border-hover); color: var(--sb-text); }
  .sb-pill.on {
    background: var(--sb-text);
    color: var(--sb-bg);
    border-color: var(--sb-text);
    font-weight: 500;
  }
  .sb-pill-dot {
    width: 6px; height: 6px;
    border-radius: var(--sb-r-full);
    background: var(--pill-dot, currentColor);
    display: inline-block;
  }
  .sb-pill-count {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    background: var(--sb-surface-muted);
    padding: 1px 5px;
    border-radius: var(--sb-r-full);
    color: var(--sb-text-muted);
  }
  .sb-pill-divider {
    width: 1px; height: 16px;
    background: var(--sb-border);
    margin: 0 4px;
  }

  /* ── ADD CUSTOMER FORM ─────────────────────────────────────────── */
  .sb-add-form {
    margin: 12px 0;
    padding: 20px 24px;
  }
  .sb-form-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 12px;
  }
  .sb-field { display: flex; flex-direction: column; }
  .sb-field-wide { grid-column: span 4; }
  .sb-field .sb-input { margin-bottom: 0; }
  .sb-field .sb-label { margin-top: 0; margin-bottom: 4px; }
  .sb-form-actions {
    display: flex; gap: 8px; margin-top: 16px;
  }

  /* ── CALENDAR TAB ──────────────────────────────────────────────── */
  .sb-cal-head { display: flex; justify-content: space-between; align-items: flex-start; }
  .sb-cal-nav { display: flex; gap: 6px; align-items: center; padding-top: 24px; }

  .sb-cal-wrap {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
    margin-top: 16px;
  }
  .sb-cal-months {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 1100px) {
    .sb-cal-wrap { grid-template-columns: 1fr; }
    .sb-cal-months { grid-template-columns: 1fr; }
  }
  .sb-cal-month {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 16px;
  }
  .sb-cal-month-head {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 12px;
    color: var(--sb-text);
  }
  .sb-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .sb-cal-dow {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    color: var(--sb-text-muted);
    text-align: center;
    padding: 4px 0;
  }
  .sb-cal-cell {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm);
    padding: 6px 6px 4px;
    min-height: 56px;
    cursor: pointer;
    font: inherit;
    color: var(--sb-text);
    text-align: left;
    display: flex; flex-direction: column;
    transition: background 0.1s, border-color 0.1s;
  }
  .sb-cal-cell:hover {
    background: var(--sb-surface-muted);
    border-color: var(--sb-border-hover);
  }
  .sb-cal-blank {
    background: transparent; border-color: transparent;
    cursor: default;
    pointer-events: none;
  }
  .sb-cal-cell.today {
    border-color: var(--sb-accent);
    background: var(--sb-accent-bg);
  }
  .sb-cal-cell.sel {
    background: var(--sb-text);
    color: var(--sb-bg);
    border-color: var(--sb-text);
  }
  .sb-cal-cell.sel .sb-cal-day { color: var(--sb-bg); }
  .sb-cal-cell.overdue { background: var(--sb-red-bg); border-color: var(--sb-red); }
  .sb-cal-day {
    font-size: 12px;
    font-family: var(--sb-font-mono);
    font-weight: 500;
  }
  .sb-cal-dots {
    display: flex; gap: 2px; flex-wrap: wrap;
    margin-top: auto;
    align-items: center;
  }
  .sb-cal-dot {
    width: 6px; height: 6px; border-radius: var(--sb-r-full);
  }
  .sb-cal-more {
    font-size: 9px;
    font-family: var(--sb-font-mono);
    color: inherit;
    opacity: 0.7;
    margin-left: 2px;
  }
  .sb-cal-side {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 16px 18px;
    align-self: flex-start;
    position: sticky;
    top: 24px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
  }
  .sb-cal-item {
    background: var(--sb-bg);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm);
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .sb-cal-item-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 6px;
  }
  .sb-cal-item-body { font-size: 12px; line-height: 1.6; }
  .sb-cal-kind {
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-text-muted);
    margin-top: 4px;
  }

  /* ── REPORTS TAB ───────────────────────────────────────────────── */
  .sb-chart-card {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 16px 18px;
    margin-bottom: 16px;
  }
  .sb-chart-head { margin-bottom: 12px; }
  .sb-chart-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-chart-sub {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
  }
  .sb-chart-body { width: 100%; }
  .sb-chart-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 980px) {
    .sb-chart-row { grid-template-columns: 1fr; }
  }

  /* Metric accent variants */
  .sb-metric-amber { background: var(--sb-amber-bg); }
  .sb-metric-amber .sb-metric-value { color: var(--sb-amber); }
  .sb-metric-red   { background: var(--sb-red-bg); }
  .sb-metric-red   .sb-metric-value { color: var(--sb-red); }
  .sb-metric-green { background: var(--sb-green-bg); }
  .sb-metric-green .sb-metric-value { color: var(--sb-green); }

  /* ── PROFILE PHOTO ─────────────────────────────────────────────── */
  .sb-photo-row {
    display: flex; align-items: center; gap: 16px;
  }
  .sb-photo-preview {
    width: 80px; height: 80px;
    border-radius: var(--sb-r-md);
    object-fit: cover;
    border: 0.5px solid var(--sb-border);
  }
  .sb-photo-empty {
    width: 80px; height: 80px;
    border-radius: var(--sb-r-md);
    background: var(--sb-surface-muted);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--sb-font-mono);
    font-size: 28px;
    font-weight: 500;
    color: var(--sb-text-secondary);
  }
  .sb-photo-actions {
    display: flex; flex-direction: column; gap: 8px;
  }

  /* ── SPRINT 3n additions ──────────────────────────────────────── */
  .sb-order-card-clickable {
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.1s, background 0.1s;
  }
  .sb-order-card-clickable:hover {
    border-color: var(--sb-border-hover);
    background: var(--sb-surface-muted);
  }
  .sb-cal-item-clickable {
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.1s, background 0.1s;
  }
  .sb-cal-item-clickable:hover {
    border-color: var(--sb-border-hover);
    background: var(--sb-surface-muted);
  }
  .sb-cust-name-link {
    text-decoration: underline;
    text-decoration-color: var(--sb-border);
    text-underline-offset: 2px;
  }
  .sb-cust-name-link:hover { text-decoration-color: var(--sb-text); }
  .sb-archived-tag {
    display: inline-block;
    font-size: 10px;
    font-family: var(--sb-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--sb-r-sm);
    background: var(--sb-surface-muted);
    color: var(--sb-text-muted);
    margin-left: 12px;
    vertical-align: middle;
    font-weight: 500;
  }
  .sb-cust-detail-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
  }

  /* ── ACTION ITEMS (Today) ──────────────────────────────────────── */
    display: flex; flex-direction: column; gap: 4px;
  }
  .sb-action-item {
    display: grid;
    grid-template-columns: 28px 1fr 20px;
    align-items: center;
    gap: 12px;
    width: 100%;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-md);
    padding: 10px 14px;
    text-align: left;
    font: inherit; color: inherit;
    cursor: pointer;
    transition: border-color 0.1s, background 0.1s;
  }
  .sb-action-item:hover {
    border-color: var(--sb-border-hover);
    background: var(--sb-surface-muted);
  }
  .sb-action-icon {
    width: 24px; height: 24px;
    border-radius: var(--sb-r-sm);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--sb-font-mono);
    font-size: 11px;
    font-weight: 700;
  }
  .sb-action-red .sb-action-icon { background: var(--sb-red-bg); color: var(--sb-red); }
  .sb-action-amber .sb-action-icon { background: var(--sb-amber-bg); color: var(--sb-amber); }
  .sb-action-muted .sb-action-icon { background: var(--sb-surface-muted); color: var(--sb-text-muted); }
  .sb-action-label {
    font-size: 13px;
    color: var(--sb-text);
    font-weight: 500;
  }
  .sb-action-meta {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
    font-family: var(--sb-font-mono);
  }
  .sb-action-arrow {
    color: var(--sb-text-muted);
    font-size: 14px;
  }

  /* RESPONSIVE */
  @media (max-width: 720px) {
    .sb-root { grid-template-columns: 1fr; }
    .sb-sidebar { display: none; }
    .sb-main { padding: 20px 16px; }
    .sb-settings-grid { grid-template-columns: 1fr; gap: 16px; }
    .sb-settings-row { grid-template-columns: 1fr; gap: 8px; }
    .sb-cust-row { grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
    .sb-cust-row-head { display: none; }
    .sb-orders-row { grid-template-columns: 1fr 1fr; }
    .sb-form-grid { grid-template-columns: 1fr 1fr; }
    .sb-field-wide { grid-column: span 2; }
  }
`
