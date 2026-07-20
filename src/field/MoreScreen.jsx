// =============================================================================
// MoreScreen — everything that isn't in YOUR bottom bar (FIELD-7)
// =============================================================================
// Three layers, role-aware:
//   1. YOUR OVERFLOW — core tabs this person left out of their bar (Floor,
//      Find, Sales…) surface as the first tiles, so customizing the bar never
//      loses a surface. Both builds.
//   2. ON THIS PHONE — native phone-fit screens. Settings + Catalog for
//      everyone; the money/owner suite (Money, Approvals, Leads, Customers,
//      Permits, Vendors, Cemetery orders, New lead intake) for owners only.
//   3. FULL DESKTOP — /?tab= deep links into the desktop app. Owner only.
// A tap keeps the tab mounted (sub state) so job drills round-trip back here.
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
import FieldSettingsScreen from './FieldSettingsScreen'
import ProductionFloorScreen from './ProductionFloorScreen'
import FindScreen from './FindScreen'
import SalesScreen from './SalesScreen'
import TasksScreen from './TasksScreen'
import WorkHubScreen from './WorkHubScreen'
import { overflowTabsFor } from './fieldTabs'

const I = (paths) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
)

const TAB_TILE_META = {
  tasks:      { ds: 'Your task list',                ic: '<path d="M4 6 l2 2 l3.5-3.5"/><path d="M4 15 l2 2 l3.5-3.5"/><line x1="13" y1="7" x2="20" y2="7"/><line x1="13" y1="16" x2="20" y2="16"/>' },
  production: { ds: 'The production floor',          ic: '<path d="M8 4 h8 l1.5 6 H6.5 z"/><rect x="4.5" y="10" width="15" height="5" rx="1"/><rect x="2.5" y="15" width="19" height="5" rx="1"/>' },
  jobs:       { ds: 'Installs, digs, check jobs',    ic: '<path d="M13.5 4.5 l6 6 -2.5 2.5 -6-6z"/><path d="M12.5 9.5 L4 18 l2 2 8.5-8.5"/><path d="M15 3 l6 6"/>' },
  sales:      { ds: 'Orders, leads, everything',     ic: '<path d="M6 3 h8 l4 4 v14 h-12 z"/><path d="M14 3 v4 h4"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>' },
  find:       { ds: 'Search + yard inventory',       ic: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>' },
}

// Native phone-fit screens. owner:true = money/CRM surfaces, never for crew.
const NATIVE = [
  { key: 'settings',  nm: 'Settings',        ds: 'Tabs, alerts, your link',        owner: false, ic: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8 v3 M12 18.2 v3 M2.8 12 h3 M18.2 12 h3 M5.5 5.5 l2.1 2.1 M16.4 16.4 l2.1 2.1 M18.5 5.5 l-2.1 2.1 M7.6 16.4 l-2.1 2.1"/>' },
  { key: 'catalog',   nm: 'Catalog',         ds: 'Search designs by shape or name', owner: false, ic: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17 l5-5 4 4 3-3 6 6"/>' },
  { key: 'intake',    nm: 'New lead',        ds: 'Hand the phone to the customer', owner: true,  ic: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20 a5.5 5.5 0 0 1 11 0"/><line x1="18" y1="7" x2="18" y2="13"/><line x1="15" y1="10" x2="21" y2="10"/>' },
  { key: 'money',     nm: 'Money',           ds: 'Collected, owed, past 60',       owner: true,  ic: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5.5 H9.5 a3 3 0 0 0 0 6 h5 a3 3 0 0 1 0 6 H7"/>' },
  { key: 'schedule',  nm: 'Schedule',        ds: 'Runs by day, bump a run',        owner: true,  ic: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 h18 M8 3 v4 M16 3 v4"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>' },
  { key: 'approvals', nm: 'Approvals',       ds: 'Proofs out, nudge them',         owner: true,  ic: '<path d="M6 3 h8 l4 4 v14 h-12 z"/><path d="M14 3 v4 h4"/><path d="M9 14 l2 2 4-4.5"/>' },
  { key: 'customers', nm: 'Customers',       ds: 'Find anyone, call them',         owner: true,  ic: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20 a5.5 5.5 0 0 1 11 0"/><path d="M16 4.5 a3.5 3.5 0 0 1 0 7"/><path d="M15.5 14.5 a5.5 5.5 0 0 1 5 5.5"/>' },
  { key: 'leads',     nm: 'Leads',           ds: 'The chase list',                 owner: true,  ic: '<path d="M3 5 h18 l-7 8 v6 l-4 -2 v-4 z"/>' },
  { key: 'permits',   nm: 'Permits',         ds: 'What is not filed yet',          owner: true,  ic: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 l2.5 2.5 4.5-5"/>' },
  { key: 'vendors',   nm: 'Vendor work',     ds: 'Partners in and out',            owner: true,  ic: '<path d="M4 8 h16 v12 h-16z"/><path d="M8 8 V6 a4 4 0 0 1 8 0 v2"/>' },
  { key: 'cemorders', nm: 'Cemetery orders', ds: 'Door work',                      owner: true,  ic: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 21 v-5 h6 v5"/><path d="M9 7 h6 M9 11 h6"/>' },
]

const SCREENS = {
  money: MoneyScreen, schedule: ScheduleScreen, approvals: ApprovalsScreen,
  customers: CustomersScreen, leads: LeadsScreen, permits: PermitsScreen,
  vendors: VendorsScreen, cemorders: CemOrdersScreen, catalog: CatalogScreen,
}

// Everything else rides the desktop, full-fat. Owner only.
const DESKTOP = [
  ['payments',        'Payments',        'Money in, day by day'],
  ['cemetery-orders', 'Cemetery Orders', 'The full door board'],
  ['scheduler',       'Scheduler',       'Build the week'],
  ['calendar',        'Calendar',        'Runs + deadlines'],
  ['email',           'Email',           'The shop inbox'],
  ['profit',          'Profit',          'Job costs + margin'],
  ['reports',         'Reports',         'Numbers on demand'],
  ['reconcile',       'Reconcile',       'Deposits vs the books'],
  ['fixlog',          'Fix Log',         'What got fixed, when'],
  ['sales',           '+ New sale',      'The full sales wizard'],
  ['settings',        'Settings (desktop)', 'Staff, pricing, options'],
]

export default function MoreScreen({ who, undo, onOpenJob, onOpenTask, onAskPush, onOpenPrefs, onSwitchPerson, onTabsSaved }) {
  const [sub, setSub] = useState(null)
  const isOwner = !!who?.isOwner
  const overflow = overflowTabsFor(who)
  const back = () => setSub(null)

  // The intake takes the WHOLE screen (a customer is holding the device).
  if (sub === 'intake') {
    return <IntakeScreen who={who} onClose={back}
      onOpenLead={(orderId) => onOpenJob({ orderId, jobId: null }, 'more')} />
  }
  if (sub === 'settings') {
    return <FieldSettingsScreen who={who} undo={undo} onBack={back}
      onOpenPrefs={onOpenPrefs} onSwitchPerson={onSwitchPerson} onTabsSaved={onTabsSaved} />
  }
  // Overflow core tabs — full screens with a back row home to More.
  if (sub === 'tab:production') {
    return <ProductionFloorScreen who={who} undo={undo} onOpenJob={(ids) => onOpenJob(ids, 'more')} onBack={back} />
  }
  if (sub === 'tab:find') {
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={back}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
        <FindScreen who={who} undo={undo} onOpenJob={(ids) => onOpenJob(ids, 'more')} mode={isOwner ? 'search' : 'all'} />
      </div>
    )
  }
  if (sub === 'tab:sales' && isOwner) {
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={back}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
        <SalesScreen onOpenJob={(ids) => onOpenJob(ids, 'more')} who={who} undo={undo} />
      </div>
    )
  }
  if (sub === 'tab:tasks') {
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={back}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
        <TasksScreen who={who} undo={undo} onOpenJob={(ids) => onOpenJob(ids, 'more')} />
      </div>
    )
  }
  if (sub === 'tab:jobs') {
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={back}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
        <WorkHubScreen who={who} undo={undo} onOpenJob={(ids) => onOpenJob(ids, 'more')} onOpenTask={onOpenTask} />
      </div>
    )
  }

  const Screen = sub ? SCREENS[sub] : null
  if (Screen) {
    return <Screen who={who} undo={undo} onOpenJob={onOpenJob} onOpenTask={onOpenTask} onBack={back} />
  }

  const tiles = NATIVE.filter(t => isOwner || !t.owner)

  return (
    <div>
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>More</div>
        <div className="fl-greet-sub">
          {isOwner ? 'Everything else in Stonebooks' : 'Your other tools'}
        </div>
      </div>

      {overflow.length > 0 && (
        <>
          <div className="fl-daylabel" style={{ marginTop: 4 }}>Not in your bar</div>
          <div className="fl-menu-grid" style={{ marginBottom: 6 }}>
            {overflow.map(t => (
              <button key={t.key} type="button" className="fl-menu-tile" onClick={() => setSub(`tab:${t.key}`)}>
                <span className="ic">{I(TAB_TILE_META[t.key]?.ic || '')}</span>
                <span className="nm">{t.label.charAt(0) + t.label.slice(1).toLowerCase()}</span>
                <span className="ds">{TAB_TILE_META[t.key]?.ds || ''}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="fl-daylabel" style={{ marginTop: overflow.length ? 12 : 4 }}>On this phone</div>
      <div className="fl-menu-grid">
        {tiles.map(t => (
          <button key={t.key} type="button" className="fl-menu-tile" onClick={() => setSub(t.key)}>
            <span className="ic">{I(t.ic)}</span>
            <span className="nm">{t.nm}</span>
            <span className="ds">{t.ds}</span>
          </button>
        ))}
      </div>

      {isOwner && (
        <>
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
        </>
      )}
    </div>
  )
}
