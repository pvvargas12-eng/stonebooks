// =============================================================================
// SalesScreen — owner SALES tab: the desktop Sales views on the phone
// =============================================================================
// Mirrors the desktop Sales tab's view switcher exactly (Paul: "get rid of
// orders, make it sales, options like in Stonebooks"): Orders | Leads | All.
// Orders = contracted with real money down (isOrderRow, same rule as the
// desktop); Leads = the rest of the active pipeline; All = everything ever,
// closed + archived included. FIELD-3 graft: every row carries the STATUS
// sheet (design / stone / foundation / blocker) — the office master overrides,
// one tap from the truck.
// =============================================================================
import { useState } from 'react'
import OrdersScreen from './OrdersScreen'

const VIEWS = [['orders', 'Orders'], ['leads', 'Leads'], ['all', 'All']]

export default function SalesScreen({ onOpenJob, who, undo }) {
  const [view, setView] = useState('orders')
  return (
    <div>
      <div className="fl-seg">
        {VIEWS.map(([code, label]) => (
          <button key={code} type="button" className={view === code ? 'on' : ''}
            onClick={() => setView(code)}>{label}</button>
        ))}
      </div>
      <OrdersScreen onOpenJob={(ids) => onOpenJob(ids, 'sales')} showMoney={true} view={view}
        showStatus={true} who={who} undo={undo} />
    </div>
  )
}
