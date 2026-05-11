// =============================================================================
// 📚 Stonebooks — Calendar tab
// =============================================================================
// 2-month forward calendar showing every order with a target completion date
// or cemetery deadline. Color-coded by urgency.
//
// Click a date → side panel shows all orders for that day.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllOrders, statusInfo, customerName,
  fmtUSD, fmtDate, rowGrandTotal,
  ACTIVE_STATUSES,
} from './lib/stonebooksData'

export default function CalendarTab({ onOpenOrder }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(null)

  useEffect(() => {
    listAllOrders({ statuses: ACTIVE_STATUSES, limit: 500 }).then(rows => {
      setOrders(rows)
      setLoading(false)
    })
  }, [])

  // Build 2-month grid starting from current month
  const months = useMemo(() => {
    const a = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
    const b = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1)
    return [a, b]
  }, [anchorDate])

  // Map orders by their target_completion_date or cemetery_deadline
  const ordersByDate = useMemo(() => {
    const map = {}
    for (const o of orders) {
      const dates = [
        { iso: o.target_completion_date, kind: 'target' },
        { iso: o.cemetery_deadline,      kind: 'deadline' },
      ].filter(d => d.iso)
      for (const { iso, kind } of dates) {
        const key = iso.slice(0, 10)   // 'YYYY-MM-DD'
        if (!map[key]) map[key] = []
        map[key].push({ order: o, kind })
      }
    }
    return map
  }, [orders])

  const goPrev = () => setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const goNext = () => setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const goToday = () => { setAnchorDate(new Date()); setSelectedDate(null) }

  const selectedItems = selectedDate ? (ordersByDate[selectedDate] || []) : []

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head sb-cal-head">
        <div>
          <div className="sb-page-eyebrow">Workspace</div>
          <h1 className="sb-page-title">Calendar</h1>
        </div>
        <div className="sb-cal-nav">
          <button type="button" className="sb-btn-secondary" onClick={goPrev}>← Prev</button>
          <button type="button" className="sb-btn-secondary" onClick={goToday}>Today</button>
          <button type="button" className="sb-btn-secondary" onClick={goNext}>Next →</button>
        </div>
      </div>

      <div className="sb-helper">
        Showing target completion dates and cemetery deadlines for active orders.
        Click a day to see orders due that day.
      </div>

      {loading ? (
        <div className="sb-empty">Loading…</div>
      ) : (
        <div className="sb-cal-wrap">
          <div className="sb-cal-months">
            {months.map(m => (
              <CalendarMonth
                key={m.toISOString()}
                month={m}
                ordersByDate={ordersByDate}
                selectedDate={selectedDate}
                onPickDate={setSelectedDate}
              />
            ))}
          </div>

          <aside className="sb-cal-side">
            {selectedDate ? (
              <>
                <div className="sb-section-label" style={{ marginTop: 0 }}>{fmtDate(selectedDate, { long: true })}</div>
                {selectedItems.length === 0 ? (
                  <div className="sb-empty">No orders due this day.</div>
                ) : (
                  selectedItems.map(({ order, kind }) => {
                    const status = statusInfo(order.status)
                    return (
                      <button
                        key={order.id + kind}
                        type="button"
                        className="sb-cal-item sb-cal-item-clickable"
                        onClick={() => onOpenOrder?.(order.id)}
                      >
                        <div className="sb-cal-item-head">
                          <span className="sb-mono">#{order.order_number || 'DRAFT'}</span>
                          <span className="sb-status-pill" style={{ '--pill-color': status.color }}>{status.label}</span>
                        </div>
                        <div className="sb-cal-item-body">
                          <div>{customerName(order.customer)}</div>
                          <div className="sb-muted">{order.cemetery?.name || '—'}</div>
                          <div className="sb-cal-kind">
                            {kind === 'target' ? 'Target completion' : 'Cemetery deadline'}
                          </div>
                          <div className="sb-mono">{fmtUSD(rowGrandTotal(order))}</div>
                        </div>
                      </button>
                    )
                  })
                )}
              </>
            ) : (
              <div className="sb-empty">Click a day on the calendar to see orders.</div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function CalendarMonth({ month, ordersByDate, selectedDate, onPickDate }) {
  const year = month.getFullYear()
  const m    = month.getMonth()
  const firstDay = new Date(year, m, 1).getDay()    // 0 = Sun
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const today = new Date(); today.setHours(0,0,0,0)

  // Build cells: blank padding then days
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push({ blank: true, key: `pad-${i}` })
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ blank: false, day: d, iso, key: iso })
  }

  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="sb-cal-month">
      <div className="sb-cal-month-head">{monthLabel}</div>
      <div className="sb-cal-grid">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="sb-cal-dow">{d}</div>
        ))}
        {cells.map(c => {
          if (c.blank) return <div key={c.key} className="sb-cal-cell sb-cal-blank" />
          const items = ordersByDate[c.iso] || []
          const cellDate = new Date(year, m, c.day)
          const isPast = cellDate < today
          const isToday = cellDate.getTime() === today.getTime()
          const isSelected = selectedDate === c.iso
          const overdue = items.length > 0 && isPast && !isToday
          return (
            <button
              key={c.key}
              type="button"
              className={`sb-cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'sel' : ''} ${overdue ? 'overdue' : ''}`}
              onClick={() => onPickDate(c.iso)}
            >
              <div className="sb-cal-day">{c.day}</div>
              {items.length > 0 && (
                <div className="sb-cal-dots">
                  {items.slice(0, 3).map((it, i) => (
                    <span
                      key={i}
                      className="sb-cal-dot"
                      style={{ background: it.kind === 'deadline' ? '#b54040' : '#1d4ed8' }}
                    />
                  ))}
                  {items.length > 3 && <span className="sb-cal-more">+{items.length - 3}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
