// =============================================================================
// 📚 Stonebooks — Role Selector (shared)
// =============================================================================
// Top-right segmented selector. Shared by the Jobs department view and the
// Today operational page so a single switch updates both surfaces. Not auth —
// anyone can switch. Persistence is the caller's responsibility (via
// workspaceState.setSelectedRole on change).
//
// Visual posture: borderless chips, weight-500 active, subtle hover. Same calm
// vocabulary the workspace strip uses.
// =============================================================================

// Kept module-local — react-refresh requires component files to export only
// components. If another module ever needs this list (e.g. a route guard or a
// theming helper), move it into stonebooksData.js where roles already live.
const ROLES = [
  { code: 'admin',        label: 'Admin' },
  { code: 'design',       label: 'Design' },
  { code: 'sales',        label: 'Sales' },
  { code: 'production',   label: 'Production' },
  { code: 'installation', label: 'Installation' },
  { code: 'owner',        label: 'Owner' },
]

export default function RoleSelector({ active, onChange, roles = ROLES, ariaLabel = 'Department view' }) {
  return (
    <div className="sb-role-selector" role="tablist" aria-label={ariaLabel}>
      {roles.map(r => {
        const isActive = r.code === active
        return (
          <button
            key={r.code}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`sb-role-chip ${isActive ? 'sb-role-chip-active' : ''}`}
            onClick={() => onChange(r.code)}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================
// Lifted verbatim from JobsDepartmentView so the same selector pattern lives
// in one place. The style block is keyed by `sb-role-selector-styles` —
// JobsDepartmentView's old inline style tag was `sb-jobs-dept-view-styles`
// and continues to ship its own scoped rules for the rest of the page.

const localStyles = `
  .sb-role-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
    margin-bottom: 32px;
    padding: 4px 0;
  }
  .sb-role-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 14px;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-role-chip:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-role-chip-active {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
    font-weight: 500;
  }
  .sb-role-chip:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }

  @media (max-width: 720px) {
    .sb-role-selector {
      justify-content: flex-start;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-role-selector-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-role-selector-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
