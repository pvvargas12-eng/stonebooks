// =============================================================================
// Stonebooks — DieOverrideField (shared)
// =============================================================================
// The die-description override, surfaced from the DIE section (NOT the base
// section) so it's available for ANY die-bearing shape — regardless of whether a
// base is included or the shape "can have a base." (Previously it lived inside
// BaseSection's base-gated block, so on a custom no-base order it was hidden and
// the typed override never reached buildLineItems.)
//
// Writes order.baseConfig.dieTextOverride — the SAME key buildLineItems reads
// (SalesMode buildLineItems: label = dieTextOverride.trim() || dieSpec). Display
// only: it changes the die LINE LABEL, never the price. Not shown for bronze
// markers (those have their own bronze description override).
// =============================================================================

export default function DieOverrideField({ value, onChange }) {
  return (
    <label className="dof">
      <span className="dof-lab">Die description override <em>display only — replaces the die line text</em></span>
      <textarea
        className="dof-ta"
        rows={2}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="Optional — leave blank to auto-build the die line."
      />
      <style>{`
        .dof { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #6a6a62; margin-top: 10px; }
        .dof-lab em { font-style: normal; color: #9a8f78; font-size: 11px; margin-left: 4px; }
        .dof-ta { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 6px; background: #fff; color: #2a2a2a; box-sizing: border-box; width: 100%; resize: vertical; }
      `}</style>
    </label>
  )
}
