// =============================================================================
// MenuScreen — FIELD-3: the everything button, phone-sized
// =============================================================================
// Owner tab root. A grid to every other area of Stonebooks, each opening a
// phone-fit screen in place (internal sub state; the shell keeps this tab
// mounted through job drills so the spot survives the round trip). Crew reach
// a trimmed version through Find only when routed here explicitly — the tile
// list is role-aware and money tiles never render for crew.
// =============================================================================
import { useState } from 'react'
import MoneyScreen from './MoneyScreen'
import LeadsScreen from './LeadsScreen'
import CustomersScreen from './CustomersScreen'
import ApprovalsScreen from './ApprovalsScreen'
import CemOrdersScreen from './CemOrdersScreen'
import PermitsScreen from './PermitsScreen'
import VendorsScreen from './VendorsScreen'
import FoundationsScreen from './FoundationsScreen'
import InstallsScreen from './InstallsScreen'
import ProductionScreen from './ProductionScreen'
import InventoryScreen from './InventoryScreen'

const I = (paths) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
)

const TILES = [
  { key: 'money',       nm: 'Money',           ds: 'Collected, owed, past 60', owner: true,  ic: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5.5 H9.5 a3 3 0 0 0 0 6 h5 a3 3 0 0 1 0 6 H7"/>' },
  { key: 'leads',       nm: 'Leads',           ds: 'The chase list',           owner: true,  ic: '<path d="M3 5 h18 l-7 8 v6 l-4 -2 v-4 z"/>' },
  { key: 'customers',   nm: 'Customers',       ds: 'Find anyone, call them',   owner: true,  ic: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20 a5.5 5.5 0 0 1 11 0"/><path d="M16 4.5 a3.5 3.5 0 0 1 0 7"/><path d="M15.5 14.5 a5.5 5.5 0 0 1 5 5.5"/>' },
  { key: 'approvals',   nm: 'Approvals',       ds: 'Proofs out, nudge them',   owner: true,  ic: '<path d="M6 3 h8 l4 4 v14 h-12 z"/><path d="M14 3 v4 h4"/><path d="M9 14 l2 2 4-4.5"/>' },
  { key: 'installs',    nm: 'Installations',   ds: 'Next 14 days',             owner: false, ic: '<rect x="2.5" y="7" width="13" height="10" rx="1.5"/><path d="M15.5 10 h3.5 l2.5 3.5 v3.5 h-6"/><circle cx="7" cy="19" r="1.8"/><circle cx="17.5" cy="19" r="1.8"/>' },
  { key: 'production',  nm: 'Production',      ds: 'Every active stone',       owner: false, ic: '<path d="M13.5 4.5 l6 6 -2.5 2.5 -6-6z"/><path d="M12.5 9.5 L4 18 l2 2 8.5-8.5"/><path d="M15 3 l6 6"/>' },
  { key: 'foundations', nm: 'Foundations',     ds: 'The dig list',             owner: false, ic: '<path d="M3 21 h18"/><path d="M5 21 v-6 h14 v6"/><path d="M8 15 V9 l4-4 4 4 v6"/>' },
  { key: 'inventory',   nm: 'Inventory',       ds: 'Yard stock',               owner: false, ic: '<path d="M21 8 l-9-5 -9 5 v8 l9 5 9-5z"/><path d="M3 8 l9 5 9-5 M12 13 v8"/>' },
  { key: 'cemorders',   nm: 'Cemetery orders', ds: 'Door work',                owner: true,  ic: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 21 v-5 h6 v5"/><path d="M9 7 h6 M9 11 h6"/>' },
  { key: 'permits',     nm: 'Permits',         ds: 'What is not filed yet',    owner: true,  ic: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 l2.5 2.5 4.5-5"/>' },
  { key: 'vendors',     nm: 'Vendor work',     ds: 'Partners in and out',      owner: true,  ic: '<path d="M4 8 h16 v12 h-16z"/><path d="M8 8 V6 a4 4 0 0 1 8 0 v2"/>' },
]

const SCREENS = {
  money: MoneyScreen, leads: LeadsScreen, customers: CustomersScreen,
  approvals: ApprovalsScreen, cemorders: CemOrdersScreen, permits: PermitsScreen,
  vendors: VendorsScreen,
}

export default function MenuScreen({ who, undo, onOpenJob, onOpenTask }) {
  const [sub, setSub] = useState(null)
  const isOwner = !!who?.isOwner
  const tiles = TILES.filter(t => isOwner || !t.owner)

  if (sub) {
    const back = () => setSub(null)
    const Screen = SCREENS[sub]
    if (Screen) {
      return <Screen who={who} undo={undo} onOpenJob={onOpenJob} onOpenTask={onOpenTask} onBack={back} />
    }
    // Queue screens reused from the crew build — wrapped with a back row.
    return (
      <div>
        <button type="button" className="fl-rowline" onClick={back}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
        {sub === 'installs' && <InstallsScreen onOpenJob={(ids) => onOpenJob(ids, 'menu')} />}
        {sub === 'production' && <ProductionScreen onOpenJob={(ids) => onOpenJob(ids, 'menu')} undo={undo} />}
        {sub === 'foundations' && <FoundationsScreen onOpenJob={(ids) => onOpenJob(ids, 'menu')} />}
        {sub === 'inventory' && <InventoryScreen undo={undo} />}
      </div>
    )
  }

  return (
    <div>
      <div className="fl-greet" style={{ fontSize: 29 }}>Menu</div>
      <div className="fl-greet-sub" style={{ marginBottom: 14 }}>
        {isOwner ? 'Everything else in Stonebooks' : 'More tools'}
      </div>
      <div className="fl-menu-grid">
        {tiles.map(t => (
          <button key={t.key} type="button" className="fl-menu-tile" onClick={() => setSub(t.key)}>
            <span className="ic">{I(t.ic)}</span>
            <span className="nm">{t.nm}</span>
            <span className="ds">{t.ds}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: '#8A7F6C', textAlign: 'center', marginTop: 16 }}>
        Heavy editing — the sale wizard, email, batch building — stays on the desktop.
      </div>
    </div>
  )
}
