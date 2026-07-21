// =============================================================================
// PermitCanvas — the shared editing surface (PB-1)
// =============================================================================
// One page of a permit rendered at any width, with everything Paul asked to be
// able to touch: text boxes (drag anywhere, SE-corner resize, double-click to
// edit in place), the layout image (a crop FRAME — drag the picture inside it
// to pan, resize/move the frame itself), and dimension arrows (draggable
// endpoints, label at the midpoint). All geometry lives as fractions of the
// page, matching lib/permitBuilder's PDF math exactly.
//
// The canvas owns pointer mechanics + selection + inline text editing only;
// toolbars (font size, align, bind key, zoom, delete) live in the parent.
// Template mode renders field LABELS in the boxes (there's no text yet) and
// the dashed LAYOUT AREA slot; doc mode renders real values + the real image.
// =============================================================================
import { useEffect, useRef, useState } from 'react'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export default function PermitCanvas({
  page,                 // {url, w, h} — or {blank: true} for the back sheet
  boxes = [],           // effective boxes for THIS page
  selectedId = null,
  onSelect,             // (id | null)
  onBoxPatch,           // (id, {x?,y?,w?,h?,text?})
  dims = [],            // this page's dimension lines
  selectedDimId = null,
  onSelectDim,
  onDimPatch,           // (id, {x1?,y1?,x2?,y2?})
  layout = null,        // {src, iw, ih, frame:{x,y,w,h}, img:{scale,ox,oy}} when the frame is on this page
  layoutSelected = false,
  onSelectLayout,
  onLayoutPatch,        // ({frame} | {img})
  slot = null,          // template mode: {x,y,w,h} dashed layout area
  slotSelected = false,
  onSelectSlot,
  onSlotPatch,
  templateMode = false,
  labelFor,             // (box) => small key label shown in template mode
}) {
  const wrapRef = useRef(null)
  const [cw, setCw] = useState(800)
  const [editingId, setEditingId] = useState(null)
  const drag = useRef(null)

  const aspect = page?.blank ? (279.4 / 215.9) : ((page?.h || 2200) / (page?.w || 1700))

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 800))
    ro.observe(el)
    setCw(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  // ── Pointer engine ─────────────────────────────────────────────────────────
  // spec.onClickNoDrag fires on release if the pointer never really moved —
  // how checkmark spots toggle without fighting the drag (PB-3).
  const beginDrag = (e, spec) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = wrapRef.current.getBoundingClientRect()
    drag.current = { ...spec, rect, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 4) d.moved = true
      if (!d.moved) return
      const fx = (ev.clientX - d.sx) / d.rect.width
      const fy = (ev.clientY - d.sy) / d.rect.height
      applyDrag(d, fx, fy)
    }
    const up = () => {
      const d = drag.current
      if (d && !d.moved && d.onClickNoDrag) d.onClickNoDrag()
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Arrow-key nudge on the selected box (Shift = coarse) ──────────────────
  const handleKeyDown = (e) => {
    if (editingId) return
    if (!selectedId || !onBoxPatch) return
    const stepX = (e.shiftKey ? 10 : 1) / Math.max(cw, 1)
    const box = boxes.find(b => b.id === selectedId)
    if (!box) return
    const stepY = stepX * (cw / (wrapRef.current?.clientHeight || cw))
    let patch = null
    if (e.key === 'ArrowLeft')  patch = { x: clamp(box.x - stepX, 0, 1) }
    if (e.key === 'ArrowRight') patch = { x: clamp(box.x + stepX, 0, 1) }
    if (e.key === 'ArrowUp')    patch = { y: clamp(box.y - stepY, 0, 1) }
    if (e.key === 'ArrowDown')  patch = { y: clamp(box.y + stepY, 0, 1) }
    if (patch) { e.preventDefault(); onBoxPatch(selectedId, patch) }
  }

  const applyDrag = (d, fx, fy) => {
    if (d.kind === 'box-move') {
      onBoxPatch?.(d.id, { x: clamp(d.o.x + fx, 0, 0.98 - d.o.w * 0.5), y: clamp(d.o.y + fy, 0, 0.985) })
    } else if (d.kind === 'box-size') {
      onBoxPatch?.(d.id, { w: clamp(d.o.w + fx, 0.03, 1), h: clamp(d.o.h + fy, 0.008, 1) })
    } else if (d.kind === 'dim-p1') {
      onDimPatch?.(d.id, { x1: clamp(d.o.x1 + fx, 0, 1), y1: clamp(d.o.y1 + fy, 0, 1) })
    } else if (d.kind === 'dim-p2') {
      onDimPatch?.(d.id, { x2: clamp(d.o.x2 + fx, 0, 1), y2: clamp(d.o.y2 + fy, 0, 1) })
    } else if (d.kind === 'dim-move') {
      onDimPatch?.(d.id, {
        x1: clamp(d.o.x1 + fx, 0, 1), y1: clamp(d.o.y1 + fy, 0, 1),
        x2: clamp(d.o.x2 + fx, 0, 1), y2: clamp(d.o.y2 + fy, 0, 1),
      })
    } else if (d.kind === 'frame-move') {
      onLayoutPatch?.({ frame: { ...d.o, x: clamp(d.o.x + fx, 0, 1 - d.o.w), y: clamp(d.o.y + fy, 0, 1 - d.o.h) } })
    } else if (d.kind === 'frame-size') {
      onLayoutPatch?.({ frame: { ...d.o, w: clamp(d.o.w + fx, 0.06, 1 - d.o.x), h: clamp(d.o.h + fy, 0.04, 1 - d.o.y) } })
    } else if (d.kind === 'img-pan') {
      // ox/oy are fractions of the FRAME box; convert page-fraction deltas.
      const kx = 1 / (d.frameW || 1), ky = 1 / (d.frameH || 1)
      onLayoutPatch?.({ img: { ...d.o, ox: d.o.ox + fx * kx, oy: d.o.oy + fy * ky } })
    } else if (d.kind === 'slot-move') {
      onSlotPatch?.({ ...d.o, x: clamp(d.o.x + fx, 0, 1 - d.o.w), y: clamp(d.o.y + fy, 0, 1 - d.o.h) })
    } else if (d.kind === 'slot-size') {
      onSlotPatch?.({ ...d.o, w: clamp(d.o.w + fx, 0.06, 1 - d.o.x), h: clamp(d.o.h + fy, 0.04, 1 - d.o.y) })
    }
  }

  const deselectAll = () => { onSelect?.(null); onSelectDim?.(null); onSelectLayout?.(false); onSelectSlot?.(false); setEditingId(null) }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const pct = (f) => `${f * 100}%`

  return (
    <div
      ref={wrapRef}
      className="pmc-wrap"
      style={{ aspectRatio: `1 / ${aspect}` }}
      onPointerDown={deselectAll}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {page?.blank
        ? <div className="pmc-blank"><span>Back page</span></div>
        : page?.url && <img className="pmc-bg" src={page.url} alt="" draggable={false} />}

      {/* Layout crop frame */}
      {layout && layout.frame && (
        <div
          className={`pmc-frame ${layoutSelected ? 'on' : ''}`}
          style={{ left: pct(layout.frame.x), top: pct(layout.frame.y), width: pct(layout.frame.w), height: pct(layout.frame.h) }}
          onPointerDown={(e) => { e.stopPropagation(); onSelect?.(null); onSelectDim?.(null); onSelectSlot?.(false); onSelectLayout?.(true) }}
        >
          {layout.src && (
            <img
              className="pmc-frame-img"
              src={layout.src} alt="" draggable={false}
              style={{
                width: pct(layout.img?.scale ?? 1),
                left: pct(layout.img?.ox ?? 0),
                top: pct(layout.img?.oy ?? 0),
              }}
              onPointerDown={(e) => {
                if (!layoutSelected) return
                beginDrag(e, { kind: 'img-pan', o: { ...(layout.img || { scale: 1, ox: 0, oy: 0 }) }, frameW: layout.frame.w, frameH: layout.frame.h })
              }}
            />
          )}
          {layoutSelected && (
            <>
              <div className="pmc-chip pmc-chip-move" onPointerDown={(e) => beginDrag(e, { kind: 'frame-move', o: { ...layout.frame } })}>MOVE</div>
              <div className="pmc-handle" onPointerDown={(e) => beginDrag(e, { kind: 'frame-size', o: { ...layout.frame } })} />
            </>
          )}
        </div>
      )}

      {/* Template layout slot */}
      {slot && (
        <div
          className={`pmc-slot ${slotSelected ? 'on' : ''}`}
          style={{ left: pct(slot.x), top: pct(slot.y), width: pct(slot.w), height: pct(slot.h) }}
          onPointerDown={(e) => { e.stopPropagation(); onSelect?.(null); onSelectSlot?.(true); onSelectSlot && beginDrag(e, { kind: 'slot-move', o: { ...slot } }) }}
        >
          <span className="pmc-slot-label">LAYOUT AREA</span>
          {slotSelected && <div className="pmc-handle" onPointerDown={(e) => beginDrag(e, { kind: 'slot-size', o: { ...slot } })} />}
        </div>
      )}

      {/* Text, fixed-text, and checkmark boxes */}
      {boxes.filter(b => !b.hidden).map(b => {
        const selected = b.id === selectedId
        const editing = b.id === editingId
        const fontPx = Math.max(7, b.sizePct * cw)
        const isCheck = b.kind === 'check'
        const isFixed = b.kind === 'fixed'
        const canType = !templateMode || isFixed
        return (
          <div
            key={b.id}
            className={`pmc-box ${selected ? 'on' : ''} ${templateMode ? 'tpl' : ''} ${isCheck ? 'pmc-check' : ''} ${isCheck && !b.on ? 'off' : ''}`}
            style={{
              left: pct(b.x), top: pct(b.y), width: pct(b.w), minHeight: pct(b.h),
              fontSize: fontPx, textAlign: b.align, fontWeight: b.bold ? 600 : 400,
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelectDim?.(null); onSelectLayout?.(false); onSelectSlot?.(false)
              onSelect?.(b.id)
              if (!editing) beginDrag(e, {
                kind: 'box-move', id: b.id, o: { x: b.x, y: b.y, w: b.w, h: b.h },
                // A clean click (no drag) on a checkmark toggles it.
                onClickNoDrag: isCheck ? () => onBoxPatch?.(b.id, { on: !b.on }) : undefined,
              })
            }}
            onDoubleClick={(e) => { e.stopPropagation(); if (canType && !isCheck) { setEditingId(b.id); onSelect?.(b.id) } }}
          >
            {editing ? (
              <textarea
                className="pmc-edit"
                style={{ fontSize: fontPx, textAlign: b.align, fontWeight: b.bold ? 600 : 400 }}
                autoFocus
                value={b.text}
                onChange={(e) => onBoxPatch?.(b.id, { text: e.target.value })}
                onBlur={() => setEditingId(null)}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : isCheck ? (
              <span className="pmc-check-glyph" style={{ fontSize: Math.max(10, Math.min(b.w, b.h * (wrapRef.current?.clientHeight || cw) / cw) * cw * 0.9) }}>
                {b.mark === 'x' ? '×' : '✓'}
              </span>
            ) : templateMode && !isFixed ? (
              <span className="pmc-box-key">{labelFor ? labelFor(b) : b.id}</span>
            ) : (
              <span className="pmc-box-text">{isFixed && templateMode && !(b.text || '').trim() ? 'Fixed text — double-click to type' : b.text}</span>
            )}
            {selected && !editing && (
              <div className="pmc-handle" onPointerDown={(e) => beginDrag(e, { kind: 'box-size', id: b.id, o: { x: b.x, y: b.y, w: b.w, h: b.h } })} />
            )}
          </div>
        )
      })}

      {/* Dimension arrows — SVG overlay */}
      {dims.length > 0 && (
        <svg className="pmc-dims" viewBox={`0 0 1000 ${1000 * aspect}`} preserveAspectRatio="none">
          {dims.map(d => {
            const sel = d.id === selectedDimId
            const p = { x1: d.x1 * 1000, y1: d.y1 * 1000 * aspect, x2: d.x2 * 1000, y2: d.y2 * 1000 * aspect }
            const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2
            const ang = Math.atan2(p.y2 - p.y1, p.x2 - p.x1)
            const head = (x, y, a) => {
              const L = 14, W = 6
              const bx = x + L * Math.cos(a), by = y + L * Math.sin(a)
              const px = W * Math.cos(a + Math.PI / 2), py = W * Math.sin(a + Math.PI / 2)
              return `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`
            }
            return (
              <g key={d.id}
                onPointerDown={(e) => { e.stopPropagation(); onSelect?.(null); onSelectLayout?.(false); onSelectDim?.(d.id); beginDrag(e, { kind: 'dim-move', id: d.id, o: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 } }) }}
                style={{ cursor: 'move', pointerEvents: 'auto' }}
              >
                <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="transparent" strokeWidth="18" />
                <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={sel ? '#9A7209' : '#1c1c1c'} strokeWidth={sel ? 3 : 2.2} />
                <polygon points={head(p.x1, p.y1, ang)} fill={sel ? '#9A7209' : '#1c1c1c'} />
                <polygon points={head(p.x2, p.y2, ang + Math.PI)} fill={sel ? '#9A7209' : '#1c1c1c'} />
                {(d.label || '').trim() && (
                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 26, fontWeight: 600, fill: '#1c1c1c', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 8 }}>
                    {d.label}
                  </text>
                )}
                {sel && (
                  <>
                    <circle cx={p.x1} cy={p.y1} r="12" fill="#9A7209" stroke="#fff" strokeWidth="3"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, { kind: 'dim-p1', id: d.id, o: { x1: d.x1, y1: d.y1 } }) }} />
                    <circle cx={p.x2} cy={p.y2} r="12" fill="#9A7209" stroke="#fff" strokeWidth="3"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, { kind: 'dim-p2', id: d.id, o: { x2: d.x2, y2: d.y2 } }) }} />
                  </>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

const localStyles = `
  .pmc-wrap {
    position: relative; width: 100%; background: #fff;
    border: 0.5px solid var(--sb-border, #DCD7CB); border-radius: 4px;
    overflow: hidden; user-select: none; touch-action: none;
  }
  .pmc-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .pmc-blank {
    position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
    padding-top: 8px; color: #C9C3B4; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .pmc-box {
    position: absolute; cursor: move; line-height: 1.18; color: #14161a;
    border: 1px dashed transparent; padding: 0; white-space: pre-wrap; word-break: break-word;
  }
  .pmc-box:hover { border-color: rgba(154, 114, 9, 0.45); }
  .pmc-box.on { border-color: #9A7209; background: rgba(154, 114, 9, 0.05); }
  .pmc-box.tpl { background: rgba(83, 74, 183, 0.07); border-color: rgba(83, 74, 183, 0.4); }
  .pmc-box.tpl.on { border-color: #534AB7; background: rgba(83, 74, 183, 0.14); }
  .pmc-box-key { font-size: 10px; color: #534AB7; font-weight: 600; letter-spacing: 0.02em; }
  .pmc-box-text { display: block; }
  .pmc-check { display: flex; align-items: center; justify-content: flex-start; cursor: pointer; }
  .pmc-check-glyph { line-height: 1; font-weight: 700; color: #14161a; }
  .pmc-check.off .pmc-check-glyph { opacity: 0.18; }
  .pmc-check.off { border-style: dotted; border-color: rgba(154,114,9,0.5); }
  .pmc-wrap:focus { outline: 2px solid rgba(154,114,9,0.25); outline-offset: -2px; }
  .pmc-edit {
    position: absolute; inset: -1px; width: calc(100% + 2px); min-height: calc(100% + 2px);
    border: 1px solid #9A7209; background: #fff; resize: none; outline: none;
    font-family: inherit; line-height: 1.18; color: #14161a; padding: 0;
  }
  .pmc-handle {
    position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px;
    background: #9A7209; border: 2px solid #fff; border-radius: 3px; cursor: nwse-resize;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 3;
  }
  .pmc-chip {
    position: absolute; top: -22px; left: 0; font-size: 10px; font-weight: 700;
    letter-spacing: 0.06em; background: #9A7209; color: #fff; border-radius: 4px;
    padding: 2px 8px; cursor: move; z-index: 3;
  }
  .pmc-frame {
    position: absolute; overflow: hidden; border: 1.5px solid transparent; cursor: pointer;
    background: rgba(0,0,0,0.015);
  }
  .pmc-frame:hover { border-color: rgba(154, 114, 9, 0.4); }
  .pmc-frame.on { border-color: #9A7209; }
  .pmc-frame-img { position: absolute; max-width: none; cursor: grab; }
  .pmc-frame-img:active { cursor: grabbing; }
  .pmc-slot {
    position: absolute; border: 2px dashed #534AB7; background: rgba(83, 74, 183, 0.05);
    display: flex; align-items: center; justify-content: center; cursor: move;
  }
  .pmc-slot.on { background: rgba(83, 74, 183, 0.12); }
  .pmc-slot-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #534AB7; }
  .pmc-dims { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
`

if (typeof document !== 'undefined' && !document.getElementById('pmc-styles')) {
  const tag = document.createElement('style')
  tag.id = 'pmc-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
