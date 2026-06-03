// =============================================================================
// Stonebooks — Operations (consolidated operational command center)
// =============================================================================
// ONE top-level tab that hosts the two operational surfaces behind an internal
// section switcher: [ Workflow | Permits ]. Each section is the existing,
// unmodified component re-parented here — QueuesTab (workflow queues dashboard)
// and PermitHub (permit command center). This collapses the old three-tab
// sprawl (Workflow Hubs + Permit Hub + duplicate queues inside Jobs) into a
// single Operations surface. No queue/permit logic lives here; this is a shell.
// =============================================================================

import { useState } from 'react'
import QueuesTab from './QueuesTab'
import PermitHub from './PermitHub'

const SECTIONS = [
  { code: 'workflow', label: 'Workflow' },
  { code: 'permits',  label: 'Permits' },
]

export default function OperationsTab({
  initialSection = 'workflow',
  onOpenQueue,
  onEditOrder,
  onOpenJob,
  onOpenCustomer,
}) {
  const [section, setSection] = useState(
    SECTIONS.some(s => s.code === initialSection) ? initialSection : 'workflow',
  )

  return (
    <div className="sb-ops-tab">
      <style>{OPS_CSS}</style>
      <div className="sb-ops-switcher" role="tablist" aria-label="Operations section">
        {SECTIONS.map(s => {
          const active = s.code === section
          return (
            <button
              key={s.code}
              type="button"
              role="tab"
              aria-selected={active}
              className={`sb-ops-chip${active ? ' sb-ops-chip-active' : ''}`}
              onClick={() => setSection(s.code)}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {section === 'workflow'
        ? <QueuesTab onOpenQueue={onOpenQueue} />
        : <PermitHub
            onOpenQueue={onOpenQueue}
            onEditOrder={onEditOrder}
            onOpenJob={onOpenJob}
            onOpenCustomer={onOpenCustomer}
          />}
    </div>
  )
}

const OPS_CSS = `
  .sb-ops-switcher {
    display: flex;
    gap: 8px;
    padding: 16px 32px 0;
    max-width: 1320px;
    margin: 0 auto;
  }
  .sb-ops-chip {
    font: inherit;
    font-family: var(--font-d, 'Playfair Display'), Georgia, serif;
    font-size: 14px;
    font-weight: 600;
    color: #6b6b66;
    background: #fff;
    border: 0.5px solid #e4e2dd;
    border-radius: 999px;
    padding: 7px 18px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .sb-ops-chip:hover { border-color: #9A7209; color: #1e2d3d; }
  .sb-ops-chip-active {
    color: #fff;
    background: #1e2d3d;
    border-color: #1e2d3d;
  }
`
