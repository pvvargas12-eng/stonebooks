// =============================================================================
// 📚 Stonebooks — Generic Hub Home (Production + Installation)
// =============================================================================
// Same studio-style two-column surface as DesignHubHome (queue list left,
// detail packet right, filter chips on top, "Open packet →" CTA) — reused
// verbatim for the Production and Installation hubs so all three feel identical.
// Reuses the .sb-dh-* styles injected by DesignHubHome (always imported by
// JobsDepartmentView); only the per-hub status/prose/blocking content differs,
// supplied via the `config` prop.
//
// Both configs read the SHARED set-gate (isReadyToSet / setBlockReason) so the
// blockers stay consistent with the Orders table + Scheduler blocked panel.
// =============================================================================

import { useState, useMemo } from 'react'
import { fmtUSD, fmtDate } from './lib/stonebooksData'
import { FilterChip } from './lib/crmComponents.jsx'

const shortDate = (iso) => fmtDate(iso)
function humanizePlotType(code) {
  if (!code) return ''
  return String(code).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function jobTypeLabel(jt) {
  if (jt === 'new_stone')       return 'New stone'
  if (jt === 'mausoleum_door')  return 'Crypt door'
  if (jt === 'cleaning_repair') return 'Cleaning / Repair'
  if (jt === 'inscription')     return 'Inscription'
  return humanizePlotType(jt)
}

const _order = (item) => item?.order || item?.job?.order || null

// =============================================================================
// MAIN
// =============================================================================
export default function HubHome({ hubData, onOpenJob, config }) {
  const items = useMemo(() => hubData?.items || [], [hubData])
  const [selectedId, setSelectedId] = useState(() => items[0]?.job?.id || null)
  const [activeFilters, setActiveFilters] = useState(() => new Set())

  const filteredItems = useMemo(() => {
    if (activeFilters.size === 0) return items
    return items.filter(it => {
      for (const code of activeFilters) {
        const chip = config.chips.find(c => c.code === code)
        if (chip && chip.match(it)) return true
      }
      return false
    })
  }, [items, activeFilters, config])

  const chipCounts = useMemo(() => {
    const c = {}
    for (const chip of config.chips) c[chip.code] = items.filter(chip.match).length
    return c
  }, [items, config])

  const visibleIds = useMemo(() => new Set(filteredItems.map(it => it.job?.id).filter(Boolean)), [filteredItems])
  const effectiveSelectedId = selectedId && visibleIds.has(selectedId) ? selectedId : (filteredItems[0]?.job?.id || null)
  const selectedItem = filteredItems.find(it => it.job?.id === effectiveSelectedId) || null

  const toggleFilter = (code) => {
    const next = new Set(activeFilters)
    if (next.has(code)) next.delete(code); else next.add(code)
    setActiveFilters(next)
  }

  const subline = items.length === 0
    ? config.emptyText
    : `${items.length} ${items.length === 1 ? 'job' : 'jobs'} in ${config.key} · ${items.filter(it => it.urgent).length} need attention`

  return (
    <div className="sb-dh-page">
      <header className="sb-dh-head">
        <div className="sb-dh-title">{config.title}</div>
        <div className="sb-dh-subline">{subline}</div>
      </header>

      <div className="sb-dh-chip-row">
        {config.chips.map(chip => (
          <FilterChip key={chip.code} active={activeFilters.has(chip.code)} onClick={() => toggleFilter(chip.code)} count={chipCounts[chip.code] || 0}>
            {chip.label}
          </FilterChip>
        ))}
      </div>

      <div className="sb-dh-split">
        <div className="sb-dh-queue">
          <div className="sb-dh-queue-eyebrow">{config.key === 'production' ? 'Shop queue' : 'Install queue'}</div>
          {filteredItems.length === 0 ? (
            <div className="sb-dh-queue-empty">{items.length === 0 ? config.emptyText : 'No items match these filters.'}</div>
          ) : (
            <div className="sb-dh-queue-list">
              {filteredItems.map(it => (
                <QueueCard key={it.job?.id} item={it} config={config}
                  selected={it.job?.id === effectiveSelectedId} onSelect={() => setSelectedId(it.job?.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="sb-dh-preview-wrap">
          {selectedItem
            ? <PreviewPane item={selectedItem} config={config} onOpenPacket={() => onOpenJob?.(selectedItem.job.id, config.openTab)} />
            : <div className="sb-dh-preview-empty">Select a job from the queue to preview.</div>}
        </div>
      </div>
    </div>
  )
}

function QueueCard({ item, config, selected, onSelect }) {
  const job = item.job
  const order = _order(item)
  const familyName = order?.primary_lastname || order?.customer?.last_name || null
  const deceasedFirst = Array.isArray(order?.deceased) && order.deceased.length > 0
    ? [order.deceased[0].firstName, order.deceased[0].lastName].filter(Boolean).join(' ')
    : null
  const status = config.statusFor(item)
  const orderNum = order?.order_number || (job.id ? job.id.slice(0, 8) : '—')
  const ageDays = item.pressure?.ageDays || 0
  return (
    <button type="button" onClick={onSelect} className={`sb-dh-card${selected ? ' sb-dh-card-selected' : ''}`} aria-pressed={selected}>
      <div className="sb-dh-card-family">{familyName ? familyName.toUpperCase() : '— FAMILY —'}</div>
      <div className="sb-dh-card-deceased">{deceasedFirst || jobTypeLabel(job.job_type)}</div>
      <div className="sb-dh-card-foot">
        <span className={`sb-dh-card-pill sb-dh-card-pill-${status.tone}`}>{status.label}</span>
        <span className="sb-dh-card-foot-spacer" />
        <span className="sb-dh-card-meta sb-crm-tabular">{ageDays}d · {orderNum}</span>
      </div>
    </button>
  )
}

function PreviewPane({ item, config, onOpenPacket }) {
  const job = item.job
  const order = _order(item)
  const cemetery = job.cemetery || order?.cemetery || null
  const familyName = order?.primary_lastname || order?.customer?.last_name || null
  const deceasedName = Array.isArray(order?.deceased) && order.deceased.length > 0
    ? [order.deceased[0].firstName, order.deceased[0].lastName].filter(Boolean).join(' ')
    : null
  const status = config.statusFor(item)
  const ageDays = item.pressure?.ageDays || 0
  const blocking = config.blockingFor(item)

  return (
    <div className="sb-dh-preview" role="button" tabIndex={-1} onClick={onOpenPacket} aria-label="Open full job packet">
      <header className="sb-dh-preview-head">
        <div>
          <h2 className="sb-dh-preview-family">{familyName || <span className="sb-dh-preview-missing">— family —</span>}</h2>
          {deceasedName && <div className="sb-dh-preview-deceased">{deceasedName}</div>}
        </div>
        <span className={`sb-dh-preview-pill sb-dh-preview-pill-${status.tone}`}>{status.label}</span>
      </header>

      <div className="sb-dh-preview-meta">
        {cemetery?.name && <span>{cemetery.name}</span>}
        {order?.order_number && (<><span className="sb-dh-preview-sep">·</span><span className="sb-crm-mono">{order.order_number}</span></>)}
        {job.job_type && (<><span className="sb-dh-preview-sep">·</span><span>{jobTypeLabel(job.job_type)}</span></>)}
      </div>

      <div className="sb-dh-preview-section">
        <div className="sb-dh-preview-section-eyebrow">Status</div>
        <div className="sb-dh-preview-status-prose">{status.prose} · {ageDays}d in flight</div>
        {(order?.cemetery_deadline || order?.rush_order) && (
          <div className="sb-dh-preview-pressure">
            {order.rush_order && <span className="sb-dh-preview-rush">RUSH</span>}
            {order.cemetery_deadline && <span className="sb-dh-preview-deadline">Cemetery deadline <strong className="sb-crm-tabular">{shortDate(order.cemetery_deadline)}</strong></span>}
          </div>
        )}
      </div>

      <div className="sb-dh-preview-section">
        <div className="sb-dh-preview-section-eyebrow">
          Blocking {blocking.length > 0 && <span className="sb-dh-preview-missing-count">· {blocking.length}</span>}
        </div>
        {blocking.length === 0 ? (
          <div className="sb-dh-preview-clear"><span className="sb-dh-preview-clear-glyph" aria-hidden="true">✓</span>Nothing blocking</div>
        ) : (
          <ul className="sb-dh-preview-missing-list">
            {blocking.slice(0, 4).map(m => (
              <li key={m.key} className="sb-dh-preview-missing-item">
                <span className="sb-dh-preview-missing-glyph" aria-hidden="true">↳</span><span>{m.label}</span>
              </li>
            ))}
            {blocking.length > 4 && <li className="sb-dh-preview-missing-more">+{blocking.length - 4} more — see full packet</li>}
          </ul>
        )}
      </div>

      {order?.contract_total != null && (
        <div className="sb-dh-preview-section">
          <div className="sb-dh-preview-section-eyebrow">Financial</div>
          <div className="sb-dh-preview-financial">{fmtUSD(Number(order.contract_total))} total</div>
        </div>
      )}

      <button type="button" className="sb-dh-preview-cta" onClick={onOpenPacket}>Open packet →</button>
    </div>
  )
}
