// =============================================================================
// MoreScreen — every Stonebooks section, one tap from the phone
// =============================================================================
// Paul: "I want to be able to access all of my Stonebooks tabs on my phone."
// Two layers:
//   1. ON THIS PHONE — native, phone-fit owner screens (FIELD-3 suite):
//      Money / Schedule / Approvals / Customers / Leads / Permits / Vendors /
//      Cemetery orders. Instant, glove-sized, no desktop chrome.
//   2. FULL DESKTOP — every remaining section as a /?tab= desktop deep link in
//      a new browser context (the field app stays put; installed-PWA iOS shows
//      a Done button to come back). Sign-in may be asked there.
// A native tap keeps the shell's tab mounted (sub state), so the round trip
// through a job drill lands back exactly here.
// =============================================================================
import { useState } from 'react'
import MoneyScreen from './MoneyScreen'
import ScheduleScreen from './ScheduleScreen'
import ApprovalsScreen from './ApprovalsScreen'
import CustomersScreen from './CustomersScreen'
import LeadsScreen from './LeadsScreen'
import PermitsScreen from './PermitsScreen'
import VendorsScreen from './VendorsScreen'
import CemOrdersScreen from './CemOrdersScreen'
import CatalogScreen from './CatalogScreen'
import IntakeScreen from './IntakeScreen'

const I = (paths) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
)

// Native phone-fit screens — the daily owner reads.
const NATIVE = [
  { key: 'intake',    nm: 'New lead',        ds: 'Hand the phone to the customer', ic: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20 a5.5 5.5 0 0 1 11 0"/><line x1="18" y1="7" x2="18" y2="13"/><line x1="15" y1="10" x2="21" y2="10"/>' },
  { key: 'catalog',   nm: 'Catalog',         ds: 'Search designs by shape or name', ic: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17 l5-5 4 4 3-3 6 6"/>' },
  { key: 'money',     nm: 'Money',           ds: 'Collected, owed, past 60', ic: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5.5 H9.5 a3 3 0 0 0 0 6 h5 a3 3 0 0 1 0 6 H7"/>' },
  { key: 'schedule',  nm: 'Schedule',        ds: 'Runs by day, bump a run',  ic: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 h18 M8 3 v4 M16 3 v4"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>' },
  { key: 'approvals', nm: 'Approvals',       ds: 'Proofs out, nudge them',   ic: '<path d="M6 3 h8 l4 4 v14 h-12 z"/><path d="M14 3 v4 h4"/><path d="M9 14 l2 2 4-4.5"/>' },
  { key: 'customers', nm: 'Customers',       ds: 'Find anyone, call them',   ic: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20 a5.5 5.5 0 0 1 11 0"/><path d="M16 4.5 a3.5 3.5 0 0 1 0 7"/><path d="M15.5 14.5 a5.5 5.5 0 0 1 5 5.5"/>' },
  { key: 'leads',     nm: 'Leads',           ds: 'The chase list',           ic: '<path d="M3 5 h18 l-7 8 v6 l-4 -2 v-4 z"/>' },
  { key: 'permits',   nm: 'Permits',         ds: 'What is not filed yet',    ic: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 l2.5 2.5 4.5-5"/>' },
  { key: 'vendors',   nm: 'Vendor work',     ds: 'Partners in and out',      ic: '<path d="M4 8 h16 v12 h-16z"/><path d="M8 8 V6 a4 4 0 0 1 8 0 v2"/>' },
  { key: 'cemorders', nm: 'Cemetery orders', ds: 'Door work',                ic: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 21 v-5 h6 v5"/><path d="M9 7 h6 M9 11 h6"/>' },
]

const SCREENS = {
  money: MoneyScreen, schedule: ScheduleScreen, approvals: ApprovalsScreen,
  customers: CustomersScreen, leads: LeadsScreen, permits: PermitsScreen,
  vendors: VendorsScreen, cemorders: CemOrdersScreen, catalog: CatalogScreen,
}

// Everything else rides the desktop, full-fat.
const DESKTOP = [
  ['payments',        'Payments',        'Money in, day by day'],
  ['cemetery-orders', 'Cemetery Orders', 'The full door board'],
  ['scheduler',       'Scheduler',       'Build the week'],
  ['calendar',        'Calendar',        'Runs + deadlines'],
  ['email',           'Email',           'The shop inbox'],
  ['profit',          'Profit',          'Job costs + margin'],
  ['reports',         'Reports',         'Numbers on demand'],
  ['catalog',         'Catalog',         'Designs + monuments'],
  ['reconcile',       'Reconcile',       'Deposits vs the books'],
  ['fixlog',          'Fix Log',         'What got fixed, when'],
  ['sales',           '+ New sale',      'The full sales wizard'],
  ['settings',        'Settings',        'Staff, pricing, options'],
]

export default function MoreScreen({ who, undo, onOpenJob, onOpenTask }) {
  const [sub, setSub] = useState(null)

  // The intake takes the WHOLE screen (a customer is holding the device) —
  // rendered outside the tab chrome; staff exit/finish is gated inside it.
  if (sub === 'intake') {
    return <IntakeScreen who={who} onClose={() => setSub(null)}
      onOpenLead={(orderId) => onOpenJob({ orderId, jobId: null }, 'more')} />
  }

  const Screen = sub ? SCREENS[sub] : null
  if (Screen) {
    return <Screen who={who} undo={undo} onOpenJob={onOpenJob} onOpenTask={onOpenTask}
      onBack={() => setSub(null)} />
  }

  return (
    <div>
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>All of Stonebooks</div>
        <div className="fl-greet-sub">The daily reads live here, phone-sized. Everything else opens the desktop.</div>
      </div>

      <div className="fl-daylabel" style={{ marginTop: 4 }}>On this phone</div>
      <div className="fl-menu-grid">
        {NATIVE.map(t => (
          <button key={t.key} type="button" className="fl-menu-tile" onClick={() => setSub(t.key)}>
            <span className="ic">{I(t.ic)}</span>
            <span className="nm">{t.nm}</span>
            <span className="ds">{t.ds}</span>
          </button>
        ))}
      </div>

      <div className="fl-daylabel" style={{ marginTop: 18 }}>Full desktop</div>
      {DESKTOP.map(([key, name, sub2]) => (
        <button key={key} type="button" className="fl-row fl-row-flex"
          onClick={() => window.open(`/?tab=${key}`, '_blank', 'noopener')}>
          <div className="fl-row-main">
            <div className="fl-fam" style={{ fontSize: 15.5 }}>{name}</div>
            <div className="fl-cem">{sub2}</div>
          </div>
          <span className="fl-chev">&#8250;</span>
        </button>
      ))}
      <div style={{ fontSize: 11.5, color: '#8A7F6C', textAlign: 'center', margin: '14px 0 4px' }}>
        Desktop links open the full view in the browser — sign in if it asks.
      </div>
    </div>
  )
}
