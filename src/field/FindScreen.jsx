// =============================================================================
// FindScreen — look anything up (orders search, plus yard inventory)
// =============================================================================
// FIELD-2: three builds off one file.
//   mode 'orders' — owner Orders tab: straight orders search, money shown.
//   mode 'search' — owner Find tab: Search | Inventory seg, money shown.
//   mode 'all'    — crew Find tab:  same seg, money hidden (LEAD pill stays).
// =============================================================================
import { useState } from 'react'
import OrdersScreen from './OrdersScreen'
import InventoryScreen from './InventoryScreen'

export default function FindScreen({ who, undo, onOpenJob, mode }) {
  const [seg, setSeg] = useState('search')

  if (mode === 'orders') {
    return <OrdersScreen onOpenJob={(ids) => onOpenJob(ids, 'orders')} showMoney={true} />
  }

  const showMoney = mode !== 'all'
  return (
    <div>
      <div className="fl-seg">
        <button type="button" className={seg === 'search' ? 'on' : ''}
          onClick={() => setSeg('search')}>Search</button>
        <button type="button" className={seg === 'inventory' ? 'on' : ''}
          onClick={() => setSeg('inventory')}>Inventory</button>
      </div>
      {seg === 'search' && (
        <OrdersScreen onOpenJob={(ids) => onOpenJob(ids, 'find')} showMoney={showMoney} />
      )}
      {seg === 'inventory' && <InventoryScreen undo={undo} />}
    </div>
  )
}
