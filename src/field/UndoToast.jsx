// Field Mode undo toast — 8 seconds with a visible countdown, one at a time.
export default function UndoToast({ toast, onUndo, onDismiss }) {
  if (!toast) return null
  return (
    <div className={`fl-toast${toast.error ? ' fl-toast-err' : ''}`}>
      <span className="fl-toast-label">{toast.label}</span>
      {toast.undo && (
        <button type="button" className="fl-toast-undo" onClick={onUndo}>UNDO</button>
      )}
      <button type="button" className="fl-toast-x" onClick={onDismiss} aria-label="Dismiss">×</button>
      {!toast.error && <div className="fl-toast-bar" />}
    </div>
  )
}
