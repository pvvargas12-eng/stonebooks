// =============================================================================
// 📚 Stonebooks — useWorkpieces hook (W-2)
// =============================================================================
// React state mirror over the localStorage workpiece registry. Owns the
// list of open workpieces and the currently-focused key. Components consume
// via this hook; persistence is automatic.
//
// Public API:
//   { workpieces, focusedKey, activate(spec), close(spec), focus(key|null) }
//
// `spec` shape: { type, id, label?, sublabel? }
//   type: 'job' | 'customer' | 'order'
//
// The hook deliberately does NOT route navigation — it owns *state*, not
// *behavior*. The shell (Stonebooks.jsx) decides what activating a
// workpiece means in terms of selectedJobId / selectedCustomerId / tab.
// That separation lets the registry evolve without re-wiring the shell.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  getWorkpieces,
  getStoredFocusedKey,
  activateWorkpiece as activateWp,
  closeWorkpiece as closeWp,
  setFocusedKey as persistFocusedKey,
  workpieceKey,
} from './workspaceState'

export { workpieceKey } from './workspaceState'

export function useWorkpieces(userId) {
  const [workpieces, setWorkpieces] = useState(() => getWorkpieces(userId))
  const [focusedKey, setFocusedKey] = useState(() => getStoredFocusedKey(userId))

  // Re-hydrate when the operator identity changes (sign-in / sign-out).
  useEffect(() => {
    setWorkpieces(getWorkpieces(userId))
    setFocusedKey(getStoredFocusedKey(userId))
  }, [userId])

  const activate = useCallback((spec) => {
    const next = activateWp(userId, spec)
    setWorkpieces(next)
    setFocusedKey(workpieceKey(spec))
  }, [userId])

  const close = useCallback((spec) => {
    const { workpieces: next, focusedKey: nextKey } = closeWp(userId, spec)
    setWorkpieces(next)
    setFocusedKey(nextKey)
  }, [userId])

  // Set or clear focus without touching the list. Used when the operator
  // navigates away from any workpiece (e.g. clicks Today in the sidebar).
  const focus = useCallback((key) => {
    persistFocusedKey(userId, key || null)
    setFocusedKey(key || null)
  }, [userId])

  return { workpieces, focusedKey, activate, close, focus }
}
