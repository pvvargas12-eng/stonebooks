// =============================================================================
// 📚 Stonebooks — Orders tab
// =============================================================================
// All orders across every status. Filterable, searchable.
// Click an order → opens Sales Mode for that order (TODO once threading is wired)
// For now, click → shows an inline detail panel.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllOrders, statusInfo, customerName,
  rowGrandTotal, rowTotalPaid, rowBalanceDue,
  fmtUSD, fmtDate, fmtRelative,
  ORDER_STATUSES, ACTIVE_STATUSES, SOLD_STATUSES,
} from './lib/stonebooksData'

export default function OrdersTab({ onOpenSales, onOpenOrder, onOpenCustomer }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active')      // 'active' | 'all' | <status code> | 'archived'
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    let statuses
    if (filter === 'active')        statuses = ACTIVE_STATUSES
    else if (filter === 'all')      statuses = ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => s.code)
    else if (filter === 'archived') statuses = ['archived']
    else                            statuses = [filter]
    listAllOrders({ statuses, limit: 500 }).then(rows => {
      if (cancelled) return
      setOrders(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter])

  const statusCount = (code) => orders.filter(o => o.status === code).length

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return orders
    return orders.filter(o => {
      const hay = [
        o.order_number,
        o.customer?.first_name, o.customer?.last_name,
        o.customer?.phone_primary, o.customer?.email,
        o.cemetery?.name, o.cemetery?.city,
        o.sales_rep,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }, [orders, search])

  // Totals visible on filter
  const totals = useMemo(() => {
    let pipeline = 0, sold = 0, paid = 0, balance = 0
    for (const o of filtered) {
      const total = rowGrandTotal(o)
      if (ACTIVE_STATUSES.includes(o.status)) pipeline += total
      if (SOLD_STATUSES.includes(o.status))   sold += total
      paid    += rowTotalPaid(o)
      balance += rowBalanceDue(o)
    }
    return { pipeline, sold, paid, balance }
  }, [filtered])

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Workspace</div>
        <h1 className="sb-page-title">Orders</h1>
      </div>

      {/* Top-level summary */}
      <div className="sb-metric-grid">
        <Metric label={filter === 'active' ? 'Pipeline (active)' : 'Pipeline value'} value={fmtUSD(totals.pipeline)} />
        <Metric label="Sold (in flight)" value={fmtUSD(totals.sold)} />
        <Metric label="Collected" value={fmtUSD(totals.paid)} />
        <Metric label="Balance due" value={fmtUSD(totals.balance)} accent={totals.balance > 0 ? 'amber' : null} />
      </div>

      <div className="sb-cust-toolbar" style={{ marginTop: 24 }}>
        <input
          type="search"
          className="sb-input sb-cust-search"
          placeholder="Search by name, order #, cemetery, rep…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button type="button" className="sb-btn-primary" onClick={onOpenSales}>+ New sale</button>
      </div>

      <div className="sb-pill-row">
        <Pill on={filter === 'active'}   onClick={() => setFilter('active')}>Active</Pill>
        <Pill on={filter === 'all'}      onClick={() => setFilter('all')}>All</Pill>
        <Pill on={filter === 'archived'} onClick={() => setFilter('archived')}>Archived</Pill>
        <span className="sb-pill-divider" />
        {ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => (
          <Pill
            key={s.code}
            on={filter === s.code}
            onClick={() => setFilter(s.code)}
            color={s.color}
          >
            {s.label} {filter !== s.code && statusCount(s.code) > 0 && (
              <span className="sb-pill-count">{statusCount(s.code)}</span>
            )}
          </Pill>
        ))}
      </div>

      {loading ? (
        <div className="sb-empty">Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div className="sb-empty">
          {search ? `No orders match "${search}".` : 'No orders in this status yet.'}
        </div>
      ) : (
        <div className="sb-cust-table">
          <div className="sb-cust-row sb-orders-row sb-cust-row-head">
            <div>Order</div>
            <div>Customer</div>
            <div>Cemetery</div>
            <div>Rep</div>
            <div className="sb-num">Total</div>
            <div className="sb-num">Balance</div>
            <div>Status</div>
            <div className="sb-num">Updated</div>
          </div>
          {filtered.map(o => {
            const status = statusInfo(o.status)
            const total = rowGrandTotal(o)
            const balance = rowBalanceDue(o)
            const handleCustomerClick = (e) => {
              e.stopPropagation()
              if (o.customer_id) onOpenCustomer?.(o.customer_id)
            }
            return (
              <button
                key={o.id}
                type="button"
                className="sb-cust-row sb-orders-row"
                onClick={() => onOpenOrder?.(o.id)}
              >
                <div className="sb-mono">#{o.order_number || 'DRAFT'}</div>
                <div className="sb-cust-name-link" onClick={handleCustomerClick}>
                  {customerName(o.customer)}
                </div>
                <div className="sb-muted">{o.cemetery?.name || '—'}</div>
                <div className="sb-muted">{o.sales_rep || '—'}</div>
                <div className="sb-num sb-mono">{total > 0 ? fmtUSD(total) : '—'}</div>
                <div className="sb-num sb-mono">{balance > 0 ? fmtUSD(balance) : <span className="sb-muted">—</span>}</div>
                <div><span className="sb-status-pill" style={{ '--pill-color': status.color }}>{status.label}</span></div>
                <div className="sb-num sb-muted">{fmtRelative(o.updated_at)}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, accent }) {
  return (
    <div className={`sb-metric ${accent ? `sb-metric-${accent}` : ''}`}>
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value}</div>
    </div>
  )
}

function Pill({ on, onClick, children, color }) {
  return (
    <button type="button" className={`sb-pill ${on ? 'on' : ''}`} onClick={onClick}
      style={color && !on ? { '--pill-dot': color } : {}}>
      {color && !on && <span className="sb-pill-dot" />}
      {children}
    </button>
  )
}
