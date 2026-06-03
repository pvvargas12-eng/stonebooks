// =============================================================================
// 📚 Stonebooks — JobRow component
// =============================================================================
// The family-first operational row rendered by JobsListView (flat list) and
// by JobsDepartmentView (per-hub list). Constants, enrichment, and stage
// derivation live in ./jobsRowHelpers.js — this file is component-only so
// React Fast Refresh stays happy (react-refresh/only-export-components).
//
// CSS classes (.sb-crm-row, .sb-crm-primary, .sb-crm-call-dot, etc.) are
// defined globally by src/lib/crmTheme.js; no styles ship from this file.
// =============================================================================

import { fmtUSD, fmtRelative, designStatusLabel, stoneStatusLabel, fdnStatusLabel } from './stonebooksData'
import { paymentTone, paymentLabel } from './crmTheme'
import { Pill, ProgressMicroBar } from './crmComponents.jsx'
import { ROW_GRID, mapStageToTone, jobTypeLabel } from './jobsRowHelpers'

export function JobRow({ job: j, onOpen }) {
  const p = j._pressure
  const stageTone = mapStageToTone(j._stage.group)
  const pTone = paymentTone(p.paymentState)
  const pLabel = paymentLabel(p.paymentState)
  const balance = j._balance
  const blocker = p.blocker
  const blockerSev = blocker?.severity || 'green'

  return (
    <button
      type="button"
      className="sb-crm-row"
      style={{ gridTemplateColumns: ROW_GRID }}
      onClick={() => onOpen?.(j.id)}
    >
      {/* FAMILY / STONE — when no deceased on the order, fall back to the
          job-type label ('Inscription' / 'Cleaning/Repair' / 'New stone' /
          'Crypt door'). Drops the prior "Stone TBD" because most jobs
          aren't stone-shaped — calling an inscription "Stone TBD" misreads
          as missing data when the work is actually well-defined. */}
      <div>
        <div className="sb-crm-primary">{j._familyName}</div>
        <div className="sb-crm-secondary">
          {j._deceasedLabel || jobTypeLabel(j.job_type, j._order?.service_types)}
        </div>
      </div>

      {/* ORDER + job type — order_number is the verbal reference Paul uses;
          job_type rides underneath as context. The 8-char UUID slice stays
          in the search haystack for internal debugging only. */}
      <div>
        <div className="sb-crm-mono sb-crm-tabular" style={{ fontSize: 13, color: 'inherit' }}>
          {j._order?.order_number || <span className="sb-crm-muted">—</span>}
        </div>
        <div className="sb-crm-secondary">{jobTypeLabel(j.job_type, j._order?.service_types)}</div>
      </div>

      {/* CEMETERY + rep */}
      <div>
        <div style={{ fontSize: 13, color: 'inherit' }}>
          {j._order?.cemetery?.name || <span className="sb-crm-muted">—</span>}
        </div>
        {j._order?.sales_rep && <div className="sb-crm-secondary">{j._order.sales_rep}</div>}
      </div>

      {/* STAGE — coarse bucket pill (color tone) + fine milestone-group
          eyebrow underneath. Hidden when fine and coarse labels match. */}
      <div>
        <Pill severity={stageTone}>{j._stage.bucketLabel}</Pill>
        {j._stage.fineLabel !== j._stage.bucketLabel && (
          <div className="sb-crm-secondary">{j._stage.fineLabel}</div>
        )}
        {/* Shared status dimensions (same source as the Orders table). Only the
            new-stone production trio is meaningful here; hidden otherwise. */}
        {j.job_type === 'new_stone' && j._hasOrder && (
          <div className="sb-crm-secondary" style={{ marginTop: 3, fontSize: 11 }}>
            {designStatusLabel(j._design)} · {stoneStatusLabel(j._stone)} · {fdnStatusLabel(j._fdn)}
          </div>
        )}
      </div>

      {/* PAYMENT — pill + micro-bar + balance due */}
      <div>
        {pLabel ? (
          <>
            <Pill severity={pTone}>{pLabel}</Pill>
            {j._total > 0 && (
              <ProgressMicroBar fillRatio={j._fillRatio} tone={pTone === 'red' ? 'red' : pTone === 'amber' ? 'amber' : 'green'} />
            )}
            {balance > 0 && (
              <div className="sb-crm-secondary sb-crm-tabular">{fmtUSD(balance)} due</div>
            )}
          </>
        ) : (
          // No order — typically a crypt-door job linked via cemetery_order_id
          // (computeOrderPressure currently doesn't cover that path).
          <span className="sb-crm-muted">—</span>
        )}
      </div>

      {/* BLOCKER — no "On track" pill; absence is the signal. Render NOTHING
          when blocker is null so Customers / Orders / Jobs all match. */}
      <div>
        {/* Set-gate block (shared with Orders chip + Scheduler panel) takes
            precedence — it's the most actionable "ready to set, blocked" signal. */}
        {j._setBlock ? (
          <Pill severity="red">{j._setBlock}</Pill>
        ) : blocker && (
          <Pill severity={blockerSev}>
            {p.needsCall && <span className="sb-crm-call-dot" />}
            {blocker.label}
          </Pill>
        )}
      </div>

      {/* AGE — "since signed / unsigned" eyebrow */}
      <div className="num">
        <span className="sb-crm-num">{p.ageDays || 0}d</span>
        <div className="sb-crm-secondary" style={{ textAlign: 'right' }}>
          {j._order?.signed_at ? 'since signed' : 'unsigned'}
        </div>
      </div>

      {/* UPDATED */}
      <div className="num">
        <span className="sb-crm-muted sb-crm-tabular">{j.last_update_at ? fmtRelative(j.last_update_at) : '—'}</span>
      </div>
    </button>
  )
}
