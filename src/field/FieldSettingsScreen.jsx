// =============================================================================
// FieldSettingsScreen — the phone's own settings (FIELD-7)
// =============================================================================
// Paul: "I need a Settings in More — right now it's only the desktop
// settings." Native, phone-sized: who this phone is, their private link,
// notifications, and the bottom-tab editor (saved to the person's employees
// row, so their bar follows their link to any phone). Heavy administration
// stays on the desktop.
import { useState } from 'react'
import { updateEmployee, loadEmployees } from '../lib/employees'
import { signOut } from '../lib/auth'
import { clearFieldWho } from './fieldIdentity'
import { fieldLinkFor } from './fieldLink'
import { editableTabsFor, resolveTabs, defaultTabsFor, MAX_BAR_TABS } from './fieldTabs'

export default function FieldSettingsScreen({ who, undo, onBack, onOpenPrefs, onSwitchPerson, onTabsSaved }) {
  const [copied, setCopied] = useState(false)
  // The editor's working set = the person's current middle tabs.
  const [picked, setPicked] = useState(() => resolveTabs(who).filter(k => k !== 'today' && k !== 'more'))
  const [savedNote, setSavedNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const maxMid = MAX_BAR_TABS - 2
  const choices = editableTabsFor(who)
  const isDefault = JSON.stringify(resolveTabs(who)) === JSON.stringify(defaultTabsFor(who)) && !who.fieldTabs

  const toggle = (key) => {
    setSavedNote(false)
    setPicked(list => list.includes(key)
      ? list.filter(k => k !== key)
      : (list.length >= maxMid ? list : [...list, key]))
  }

  const saveTabs = async () => {
    if (busy || picked.length === 0) return
    setBusy(true)
    const res = await updateEmployee(who.empId, { fieldTabs: picked })
    if (res?.ok) {
      await loadEmployees().catch(() => {})
      setSavedNote(true)
      onTabsSaved?.()
    } else {
      undo.showError(res?.error || 'Could not save the tabs.')
    }
    setBusy(false)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fieldLinkFor(who.fieldKey))
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { undo.showError('Could not copy the link.') }
  }

  return (
    <div>
      <button type="button" className="fl-rowline" onClick={onBack}
        style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
        &#8249; More
      </button>
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Settings</div>
        <div className="fl-greet-sub">This phone, your tabs, your alerts</div>
      </div>

      {/* ── This phone ── */}
      <div className="fl-sect"><span className="fl-sect-h">This phone</span></div>
      <div className="fl-row" style={{ cursor: 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="fl-who-avatar">{who.name.slice(0, 2).toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: '#16150F' }}>{who.name}</div>
            <div style={{ fontSize: 12.5, color: '#8A7F6C' }}>
              {who.isOwner ? 'Owner build' : (who.department ? `${who.department} crew` : 'Crew build')}
            </div>
          </div>
          <button type="button" className="fl-verb" onClick={onSwitchPerson}>SWITCH</button>
        </div>
        {who.fieldKey && (
          <button type="button" className="fl-btn-ghost" style={{ marginTop: 12, minHeight: 46 }} onClick={copyLink}>
            {copied ? 'Copied' : 'Copy my field link'}
          </button>
        )}
      </div>

      {/* ── Notifications ── */}
      <div className="fl-sect"><span className="fl-sect-h">Notifications</span></div>
      <button type="button" className="fl-row fl-row-flex" onClick={onOpenPrefs}>
        <div className="fl-row-main">
          <div className="fl-fam" style={{ fontSize: 15 }}>What this phone gets</div>
          <div className="fl-cem">Tasks, replies, digest{who.isOwner ? ', money, proofs' : ''}</div>
        </div>
        <span className="fl-chev">&#8250;</span>
      </button>

      {/* ── Bottom tabs ── */}
      <div className="fl-sect">
        <span className="fl-sect-h">My bottom tabs</span>
        <span className="fl-sect-pill">{picked.length}/{maxMid}</span>
      </div>
      <div className="fl-row" style={{ cursor: 'default' }}>
        <div style={{ fontSize: 12.5, color: '#8A7F6C', lineHeight: 1.5, marginBottom: 6 }}>
          Today and More are always there. Pick up to {maxMid} for the middle —
          everything else stays one tap away in More.{isDefault ? ' You are on your role default.' : ''}
        </div>
        {choices.map(t => {
          const on = picked.includes(t.key)
          return (
            <button key={t.key} type="button" className="fl-rowline" style={{ minHeight: 50 }}
              onClick={() => toggle(t.key)}>
              <span style={{ flex: 1, textAlign: 'left', fontSize: 14.5, fontWeight: 800, color: '#16150F' }}>
                {t.label.charAt(0) + t.label.slice(1).toLowerCase()}
                {t.key === 'production' && <span style={{ fontWeight: 600, color: '#8A7F6C' }}> — the production floor</span>}
              </span>
              <span className={`fl-toggle${on ? ' on' : ''}`} aria-hidden="true"><i /></span>
            </button>
          )
        })}
        <button type="button" className="fl-btn-gold" style={{ marginTop: 12, minHeight: 50, opacity: picked.length ? 1 : 0.5 }}
          disabled={busy || picked.length === 0} onClick={saveTabs}>
          {busy ? 'Saving…' : savedNote ? 'Saved — your bar is updated' : 'Save my tabs'}
        </button>
      </div>

      {/* ── Sign out ── */}
      <button type="button" className="fl-btn-ghost" style={{ marginTop: 18 }}
        onClick={() => { clearFieldWho(); signOut() }}>
        Sign out of this phone
      </button>
    </div>
  )
}
