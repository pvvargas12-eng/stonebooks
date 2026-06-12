// =============================================================================
// DrawSignature — self-contained signature component for the approval surface.
// =============================================================================
// Standalone (no SalesMode import) so the PUBLIC /approve page can use it lean.
// Draw on canvas (touch + mouse + stylus via Pointer Events) + typed full name +
// auto-stamped date. onChange({ image, typedName, date, ready }) fires on every
// change; `ready` is true when both a drawn signature and a typed name exist.
// Mobile-first. Self-contained CSS via an injected <style> block.
// =============================================================================

import { useRef, useState, useEffect, useCallback } from 'react'

const todayLocalISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function DrawSignature({ onChange, disabled }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const [hasInk, setHasInk] = useState(false)
  const [name, setName] = useState('')
  const [date] = useState(todayLocalISO)

  const emit = useCallback((image, typedName) => {
    onChange?.({ image, typedName, date, ready: !!image && !!(typedName || '').trim() })
  }, [onChange, date])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }, [])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const start = (e) => {
    if (disabled) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    last.current = pos(e)
  }
  const move = (e) => {
    if (!drawing.current || disabled) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.strokeStyle = '#1e2d3d'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
    if (!hasInk) setHasInk(true)
  }
  const end = (e) => {
    if (!drawing.current) return
    drawing.current = false
    try { canvasRef.current.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
    emit(canvasRef.current.toDataURL('image/png'), name)
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rect.width, rect.height)
    setHasInk(false)
    emit(null, name)
  }
  const onName = (e) => {
    setName(e.target.value)
    emit(hasInk ? canvasRef.current.toDataURL('image/png') : null, e.target.value)
  }

  return (
    <div className="dsig">
      <style>{CSS}</style>
      <label className="dsig-field">
        <span className="dsig-label">Full name</span>
        <input className="dsig-input" type="text" value={name} placeholder="Type your full name" onChange={onName} disabled={disabled} autoComplete="name" />
      </label>
      <div className="dsig-label" style={{ marginTop: 12 }}>Signature</div>
      <div className="dsig-pad">
        <canvas
          ref={canvasRef} className="dsig-canvas"
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
        />
        {!hasInk && <div className="dsig-hint">Sign with your finger, stylus, or mouse</div>}
      </div>
      <div className="dsig-row">
        <button type="button" className="dsig-clear" onClick={clear} disabled={disabled}>Clear</button>
        <span className="dsig-date">Date: {fmtDate(date)}</span>
      </div>
    </div>
  )
}

const CSS = `
.dsig { font-family: Inter, system-ui, -apple-system, sans-serif; }
.dsig-field { display: block; }
.dsig-label { font-size: 13px; font-weight: 600; color: #4a463f; margin-bottom: 5px; }
.dsig-input { width: 100%; box-sizing: border-box; border: 1px solid #cfc8ba; border-radius: 8px; padding: 12px 13px; font-size: 16px; font-family: inherit; }
.dsig-pad { position: relative; border: 1px dashed #b9b1a0; border-radius: 10px; background: #fff; height: 180px; touch-action: none; overflow: hidden; }
.dsig-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.dsig-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #b3ac9d; font-size: 14px; pointer-events: none; }
.dsig-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.dsig-clear { border: none; background: none; color: #9a7209; font-weight: 600; font-size: 14px; cursor: pointer; padding: 0; }
.dsig-date { font-size: 13px; color: #8a8472; }
`
