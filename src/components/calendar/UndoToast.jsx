// =============================================================================
// 📚 Stonebooks — Undo toast
// =============================================================================
// Minimal in-component toast for the drag-to-schedule flow. Renders a line, an
// optional Undo action, and a shrinking progress bar that visually counts down
// the auto-dismiss window. CalendarTab owns the timer + "only the most recent
// toast" behavior and remounts this (via key) per toast so the bar restarts.
// `error` switches to a red treatment for failed saves. No toast library.
// =============================================================================

export default function UndoToast({
  text,
  error = false,
  canUndo = false,
  durationMs = 8000,
  onUndo,
  onClose,
}) {
  return (
    <div className={`sb-toast ${error ? 'sb-toast-error' : ''}`} role="status" aria-live="polite">
      <span className="sb-toast-text">{text}</span>
      {canUndo && (
        <button type="button" className="sb-toast-undo" onClick={onUndo}>
          Undo
        </button>
      )}
      <button
        type="button"
        className="sb-toast-close"
        onClick={onClose}
        aria-label="Dismiss"
      >
        ✕
      </button>
      <div
        className="sb-toast-progress"
        style={{ animationDuration: `${durationMs}ms` }}
        aria-hidden="true"
      />
    </div>
  )
}

const localStyles = `
  .sb-toast {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 1100;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    max-width: min(92vw, 560px);
    padding: 12px 14px 14px 18px;
    background: var(--sb-text, #0F1419);
    color: #fff;
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 12px 32px rgba(15, 20, 25, 0.32);
    font-size: 13px;
    overflow: hidden;
  }
  .sb-toast-error {
    background: var(--sb-red, #b54040);
  }
  .sb-toast-text {
    line-height: 1.4;
  }
  .sb-toast-undo {
    background: transparent;
    border: 0.5px solid rgba(255, 255, 255, 0.4);
    color: var(--sb-accent, #d6a85a);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-toast-undo:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .sb-toast-close {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
  }
  .sb-toast-close:hover {
    color: #fff;
  }
  /* Countdown bar — shrinks 100% → 0% over the auto-dismiss window. The
     animation runs once on mount; CalendarTab remounts the toast per message
     (keyed by id), so each toast gets a fresh countdown. */
  .sb-toast-progress {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    transform-origin: left center;
    background: rgba(255, 255, 255, 0.55);
    animation-name: sb-toast-countdown;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
    animation-iteration-count: 1;
  }
  @keyframes sb-toast-countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-toast-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-toast-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
