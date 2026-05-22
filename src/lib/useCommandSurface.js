// =============================================================================
// 📚 Stonebooks — useCommandSurface hook (W-1)
// =============================================================================
// Open/close state + global keyboard triggers for the Command Surface
// overlay. Extracted into its own module so the React component file
// (CommandSurface.jsx) only exports a component — React Fast Refresh
// requires that for HMR to work cleanly.
//
//   ⌘K / Ctrl+K  — always toggles (works inside or outside text fields)
//   "/"          — opens only when the operator isn't typing into an input
//
// The hook is a thin owner of one boolean + three callbacks. The component
// receives `isOpen` + `onClose` as props; the parent (Stonebooks.jsx) owns
// the state via this hook.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'

export function useCommandSurface() {
  const [isOpen, setOpen] = useState(false)
  const open   = useCallback(() => setOpen(true), [])
  const close  = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen(v => !v), [])

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      const isTextField = tag === 'input' || tag === 'textarea' || tag === 'select'
                       || e.target?.isContentEditable

      // ⌘K / Ctrl+K — toggles unconditionally
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
        return
      }
      // "/" — opens only when not in a text field (so it doesn't hijack
      // regular text entry inside search inputs / textareas)
      if (e.key === '/' && !isTextField) {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, toggle])

  return { isOpen, open, close, toggle }
}
