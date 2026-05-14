// =============================================================================
// 📚 Stonebooks — Customers tab (Sprint 3n)
// =============================================================================
// - List, search, sort
// - Click row → drill-in detail view with full order history
// - Click an order in detail → opens Sales Mode for that order
// - Archive (soft) / Restore / Permanently delete from detail page
// - Archive filter pill at top
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllCustomers, listArchivedCustomers, listOrdersForCustomer,
  createCustomer, archiveCustomer, unarchiveCustomer, deleteCustomer,
  rowGrandTotal, rowTotalPaid, statusInfo,
  customerName, customerInitials, fmtUSD, fmtDate, fmtPhone, fmtRelative,
  ACTIVE_STATUSES, SOLD_STATUSES,
} from './lib/stonebooksData'
import { supabase } from './lib/supabase'

export default function CustomersTab({ selectedId, setSelectedId, onOpenOrder }) {
  const [customers, setCustomers] = useState([])
  const [allOrders, setAllOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('lastActivity')
  const [filter, setFilter] = useState('active')  // 'active' | 'archived'
  const [showAddForm, setShowAddForm] = useState(false)

  const reload = async () => {
    setLoading(true)
    const [cs, { data: os }] = await Promise.all([
      filter === 'archived' ? listArchivedCustomers() : listAllCustomers(),
      supabase.from('orders').select('id, customer_id, status, order_number, updated_at, created_at, deposit_amount, balance_amount, payments, pricing, add_ons, target_completion_date'),
    ])
    setCustomers(cs)
    setAllOrders(os || [])
    setLoading(false)
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [filter])

  const enriched = useMemo(() => {
    const byId = {}
    for (const c of customers) {
      byId[c.id] = {
        ...c,
        _ordersCount: 0,
        _activeCount: 0,
        _soldCount: 0,
        _lifetimeValue: 0,
        _totalCollected: 0,
        _lastActivity: null,
      }
    }
    for (const o of allOrders) {
      const r = byId[o.customer_id]
      if (!r) continue
      r._ordersCount++
      if (ACTIVE_STATUSES.includes(o.status)) r._activeCount++
      if (SOLD_STATUSES.includes(o.status)) {
        r._soldCount++
        r._lifetimeValue += rowGrandTotal(o)
      }
      r._totalCollected += rowTotalPaid(o)  // Sprint M2 Phase 3 — sums locked payments[] (helper), not raw legacy columns
      const upd = new Date(o.updated_at).getTime()
      if (!r._lastActivity || upd > r._lastActivity) r._lastActivity = upd
    }
    return Object.values(byId)
  }, [customers, allOrders])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let list = enriched
    if (needle) {
      list = list.filter(c => {
        const hay = [
          c.first_name, c.last_name, c.email, c.phone_primary, c.phone_secondary,
          c.city, c.state, c.zip, c.notes,
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
    }
    const sorters = {
      lastName:     (a, b) => (a.last_name || '').localeCompare(b.last_name || ''),
      firstName:    (a, b) => (a.first_name || '').localeCompare(b.first_name || ''),
      lifetimeValue:(a, b) => b._lifetimeValue - a._lifetimeValue,
      orders:       (a, b) => b._ordersCount - a._ordersCount,
      lastActivity: (a, b) => (b._lastActivity || 0) - (a._lastActivity || 0),
      city:         (a, b) => (a.city || '').localeCompare(b.city || ''),
    }
    return [...list].sort(sorters[sortKey] || sorters.lastActivity)
  }, [enriched, search, sortKey])

  if (selectedId) {
    const customer = customers.find(c => c.id === selectedId)
    return (
      <CustomerDetail
        customer={customer}
        onBack={() => { setSelectedId(null); reload() }}
        onArchived={() => { setSelectedId(null); reload() }}
        onDeleted={() => { setSelectedId(null); reload() }}
        onOpenOrder={onOpenOrder}
      />
    )
  }

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Workspace</div>
        <h1 className="sb-page-title">Customers</h1>
      </div>

      <div className="sb-cust-toolbar">
        <input
          type="search"
          className="sb-input sb-cust-search"
          placeholder="Search by name, phone, email, city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="sb-input sb-cust-sort"
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
        >
          <option value="lastActivity">Sort: Recent activity</option>
          <option value="lifetimeValue">Sort: Lifetime value</option>
          <option value="orders">Sort: Most orders</option>
          <option value="lastName">Sort: Last name A→Z</option>
          <option value="firstName">Sort: First name A→Z</option>
          <option value="city">Sort: City</option>
        </select>
        <button type="button" className="sb-btn-primary" onClick={() => setShowAddForm(true)}>
          + Add customer
        </button>
      </div>

      <div className="sb-pill-row">
        <button type="button" className={`sb-pill ${filter === 'active' ? 'on' : ''}`} onClick={() => setFilter('active')}>Active</button>
        <button type="button" className={`sb-pill ${filter === 'archived' ? 'on' : ''}`} onClick={() => setFilter('archived')}>📦 Archive</button>
      </div>

      <div className="sb-cust-meta">
        {loading
          ? 'Loading…'
          : `${filtered.length} ${filter === 'archived' ? 'archived ' : ''}customer${filtered.length === 1 ? '' : 's'} ${search ? `matching "${search}"` : ''}`
        }
      </div>

      {showAddForm && (
        <AddCustomerForm
          onCancel={() => setShowAddForm(false)}
          onCreated={() => { setShowAddForm(false); reload() }}
        />
      )}

      {loading ? (
        <div className="sb-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="sb-empty">
          {search
            ? `No ${filter === 'archived' ? 'archived ' : ''}customers match "${search}".`
            : filter === 'archived'
              ? `No archived customers.`
              : `No customers yet. Click "+ Add customer" to add your first.`}
        </div>
      ) : (
        <div className="sb-cust-table">
          <div className="sb-cust-row sb-cust-row-head">
            <div>Customer</div>
            <div>Contact</div>
            <div>Location</div>
            <div className="sb-num">Orders</div>
            <div className="sb-num">Lifetime value</div>
            <div className="sb-num">Last activity</div>
          </div>
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              className="sb-cust-row"
              onClick={() => setSelectedId(c.id)}
            >
              <div className="sb-cust-name-cell">
                <div className="sb-cust-avatar">{customerInitials(c)}</div>
                <div>
                  <div className="sb-cust-name">{customerName(c)}</div>
                  {c._activeCount > 0 && (
                    <div className="sb-cust-active-tag">{c._activeCount} active</div>
                  )}
                </div>
              </div>
              <div className="sb-cust-contact">
                {c.phone_primary && <div>{fmtPhone(c.phone_primary)}</div>}
                {c.email && <div className="sb-muted">{c.email}</div>}
                {!c.phone_primary && !c.email && <div className="sb-muted">—</div>}
              </div>
              <div className="sb-cust-location">
                {c.city ? `${c.city}${c.state ? ', ' + c.state : ''}` : <span className="sb-muted">—</span>}
              </div>
              <div className="sb-num sb-mono">{c._ordersCount}</div>
              <div className="sb-num sb-mono">{c._lifetimeValue > 0 ? fmtUSD(c._lifetimeValue) : <span className="sb-muted">—</span>}</div>
              <div className="sb-num sb-muted">{c._lastActivity ? fmtRelative(new Date(c._lastActivity).toISOString()) : '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CustomerDetail({ customer, onBack, onArchived, onDeleted, onOpenOrder }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!customer?.id) return
    listOrdersForCustomer(customer.id).then(o => {
      setOrders(o)
      setLoading(false)
    })
  }, [customer?.id])

  if (!customer) return (
    <div className="sb-page sb-page-wide">
      <div className="sb-empty">Customer not found.</div>
      <button type="button" className="sb-link" onClick={onBack}>← All customers</button>
    </div>
  )

  const isArchived = !!customer.archived
  const lifetimeValue = orders
    .filter(o => SOLD_STATUSES.includes(o.status))
    .reduce((s, o) => s + rowGrandTotal(o), 0)
  const totalCollected = orders.reduce((s, o) => s + rowTotalPaid(o), 0)
  const balanceDue = orders
    .filter(o => SOLD_STATUSES.includes(o.status))
    .reduce((s, o) => s + Math.max(0, rowGrandTotal(o) - rowTotalPaid(o)), 0)

  const doArchive = async () => {
    if (!confirm(`Archive ${customerName(customer)}? Their order history is preserved. They'll be hidden from the active customer list but accessible via the 📦 Archive filter.`)) return
    setBusy('archive'); setErr(null)
    const r = await archiveCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onArchived()
  }

  const doRestore = async () => {
    if (!confirm(`Restore ${customerName(customer)} to the active list?`)) return
    setBusy('restore'); setErr(null)
    const r = await unarchiveCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onArchived()
  }

  const doDelete = async () => {
    if (orders.length > 0) {
      alert(`Can't permanently delete — ${customerName(customer)} has ${orders.length} order${orders.length === 1 ? '' : 's'} attached. Archive instead to preserve the history.`)
      return
    }
    const ack = prompt(`PERMANENTLY DELETE ${customerName(customer)}? This cannot be undone. Type DELETE to confirm.`)
    if (ack !== 'DELETE') return
    setBusy('delete'); setErr(null)
    const r = await deleteCustomer(customer.id)
    setBusy(null)
    if (!r.ok) setErr(r.error)
    else onDeleted()
  }

  return (
    <div className="sb-page sb-page-wide">
      <button type="button" className="sb-link" onClick={onBack} style={{ marginBottom: 12 }}>← All customers</button>

      <div className="sb-cust-detail-head">
        <div className="sb-cust-avatar sb-cust-avatar-lg">{customerInitials(customer)}</div>
        <div style={{ flex: 1 }}>
          <h1 className="sb-page-title">
            {customerName(customer)}
            {isArchived && <span className="sb-archived-tag">Archived</span>}
          </h1>
          <div className="sb-cust-detail-meta">
            {customer.phone_primary && <span>📞 {fmtPhone(customer.phone_primary)}</span>}
            {customer.email && <span>✉ {customer.email}</span>}
            {(customer.city || customer.state) && <span>📍 {[customer.city, customer.state].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
        <div className="sb-cust-detail-actions">
          {!isArchived && (
            <button type="button" className="sb-btn-secondary" onClick={doArchive} disabled={busy !== null}>
              {busy === 'archive' ? 'Archiving…' : '📦 Archive'}
            </button>
          )}
          {isArchived && (
            <button type="button" className="sb-btn-secondary" onClick={doRestore} disabled={busy !== null}>
              {busy === 'restore' ? 'Restoring…' : '↩ Restore'}
            </button>
          )}
          <button
            type="button"
            className="sb-link sb-link-danger"
            onClick={doDelete}
            disabled={busy !== null}
            title={orders.length > 0 ? 'Customers with orders can only be archived.' : 'Permanently delete this customer'}
          >
            {busy === 'delete' ? 'Deleting…' : '🗑 Delete'}
          </button>
        </div>
      </div>

      {err && <div className="sb-msg sb-msg-err" style={{ marginTop: 8 }}>{err}</div>}

      <div className="sb-metric-grid" style={{ marginTop: 24 }}>
        <Metric label="Orders" value={orders.length} />
        <Metric label="Active" value={orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length} />
        <Metric label="Lifetime value" value={fmtUSD(lifetimeValue)} />
        <Metric label="Collected" value={fmtUSD(totalCollected)} />
        <Metric label="Balance due" value={fmtUSD(balanceDue)} accent={balanceDue > 0 ? 'amber' : null} />
      </div>

      <div className="sb-section-label">Address</div>
      <div className="sb-card">
        {customer.address_line1 ? (
          <>
            <div>{customer.address_line1}</div>
            {customer.address_line2 && <div>{customer.address_line2}</div>}
            <div>{[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}</div>
          </>
        ) : (
          <div className="sb-muted">No address on file</div>
        )}
      </div>

      {customer.notes && (
        <>
          <div className="sb-section-label">Notes</div>
          <div className="sb-card sb-prewrap">{customer.notes}</div>
        </>
      )}

      <div className="sb-section-label">Order history</div>
      {loading ? (
        <div className="sb-empty">Loading orders…</div>
      ) : orders.length === 0 ? (
        <div className="sb-empty">No orders yet.</div>
      ) : (
        <div className="sb-order-list">
          {orders.map(o => {
            const status = statusInfo(o.status)
            const total = rowGrandTotal(o)
            const paid = rowTotalPaid(o)
            return (
              <button
                key={o.id}
                type="button"
                className="sb-order-card sb-order-card-clickable"
                onClick={() => onOpenOrder?.(o.id)}
              >
                <div className="sb-order-card-head">
                  <div>
                    <div className="sb-order-num">#{o.order_number || 'DRAFT'}</div>
                    <div className="sb-order-meta">
                      {o.cemetery?.name && <span>{o.cemetery.name}</span>}
                      <span className="sb-muted">created {fmtDate(o.created_at)}</span>
                    </div>
                  </div>
                  <span className="sb-status-pill" style={{ '--pill-color': status.color }}>
                    {status.label}
                  </span>
                </div>
                <div className="sb-order-card-body">
                  <div>
                    <div className="sb-meta-label">Total</div>
                    <div className="sb-mono">{total > 0 ? fmtUSD(total) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Collected</div>
                    <div className="sb-mono">{paid > 0 ? fmtUSD(paid) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Balance</div>
                    <div className="sb-mono">{(total - paid > 0) ? fmtUSD(total - paid) : '—'}</div>
                  </div>
                  <div>
                    <div className="sb-meta-label">Target</div>
                    <div className="sb-mono">{o.target_completion_date ? fmtDate(o.target_completion_date) : '—'}</div>
                  </div>
                </div>
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

function AddCustomerForm({ onCancel, onCreated }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '',
    phonePrimary: '', email: '',
    addressLine1: '', city: '', state: 'NJ', zip: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.firstName && !form.lastName) { setErr('First or last name required'); return }
    setBusy(true); setErr(null)
    const r = await createCustomer(form)
    setBusy(false)
    if (!r.ok) setErr(r.error)
    else onCreated()
  }

  return (
    <form className="sb-card sb-add-form" onSubmit={submit}>
      <div className="sb-section-label" style={{ marginTop: 0 }}>Add customer</div>
      <div className="sb-form-grid">
        <Field label="First name"><input className="sb-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} autoFocus /></Field>
        <Field label="Last name"><input className="sb-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></Field>
        <Field label="Phone"><input className="sb-input" value={form.phonePrimary} onChange={e => set('phonePrimary', e.target.value)} placeholder="(732) 555-0123" /></Field>
        <Field label="Email"><input type="email" className="sb-input" value={form.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Address" wide><input className="sb-input" value={form.addressLine1} onChange={e => set('addressLine1', e.target.value)} /></Field>
        <Field label="City"><input className="sb-input" value={form.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="State"><input className="sb-input" value={form.state} onChange={e => set('state', e.target.value)} /></Field>
        <Field label="ZIP"><input className="sb-input" value={form.zip} onChange={e => set('zip', e.target.value)} /></Field>
        <Field label="Notes" wide><textarea className="sb-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      </div>
      {err && <div className="sb-msg sb-msg-err">{err}</div>}
      <div className="sb-form-actions">
        <button type="submit" className="sb-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create customer'}</button>
        <button type="button" className="sb-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

function Field({ label, wide, children }) {
  return (
    <div className={`sb-field ${wide ? 'sb-field-wide' : ''}`}>
      <label className="sb-label">{label}</label>
      {children}
    </div>
  )
}
