// =============================================================================
// TaskStreakFun — the tasking easter egg's visible half (Paul, 2026-07-21)
// =============================================================================
// Mounted ONCE at the App root so every surface gets it (desktop shell and
// /field alike — the events only ever fire from addShopTask, so public routes
// simply never render anything). Listens for 'sb-task-streak' from
// lib/taskStreak.js:
//   kind 'caption' (tasks 3-4) → quiet toast. Desktop: bottom-right card with
//     the gold rail + crown. Field: dark capsule above the tab bar, riding the
//     undo capsule's grammar (parked HIGHER than the undo spot so a live undo
//     is never covered — undo always wins).
//   kind 'photo' (task 5+) → one of Paul's posters, centered, random per fire.
//     Tap anywhere dismisses; auto-dismisses on its own. Never blocks input
//     behind it for more than the moment — it's a wink, not a wall.
// No emojis anywhere; the humor is in the words (shop doctrine).
// =============================================================================
import { useEffect, useRef, useState } from 'react'

const CAPTION_MS = 5200
const PHOTO_MS = 8000

const isFieldHere = () =>
  typeof window !== 'undefined' && /^\/field(\/|$)/.test(window.location.pathname)

export default function TaskStreakFun() {
  const [caption, setCaption] = useState(null)   // { text, count, seq }
  const [photo, setPhoto] = useState(null)       // { src, count, seq }
  const seqRef = useRef(0)
  const capTimer = useRef(null)
  const photoTimer = useRef(null)
  const field = isFieldHere()

  useEffect(() => {
    const onStreak = (e) => {
      const d = e?.detail
      if (!d) return
      const seq = ++seqRef.current
      if (d.kind === 'photo' && d.src) {
        setCaption(null)
        setPhoto({ src: d.src, count: d.count, seq })
        if (photoTimer.current) clearTimeout(photoTimer.current)
        photoTimer.current = setTimeout(() => setPhoto(null), PHOTO_MS)
      } else if (d.kind === 'caption' && d.text) {
        setCaption({ text: d.text, count: d.count, seq })
        if (capTimer.current) clearTimeout(capTimer.current)
        capTimer.current = setTimeout(() => setCaption(null), CAPTION_MS)
      }
    }
    window.addEventListener('sb-task-streak', onStreak)
    return () => {
      window.removeEventListener('sb-task-streak', onStreak)
      if (capTimer.current) clearTimeout(capTimer.current)
      if (photoTimer.current) clearTimeout(photoTimer.current)
    }
  }, [])

  return (
    <>
      {caption && (field ? (
        <div key={caption.seq} className="sbtsk-capsule" role="status">
          <div className="sbtsk-capsule-text">{caption.text}</div>
          <div className="sbtsk-capsule-track"><div className="sbtsk-capsule-drain" /></div>
        </div>
      ) : (
        <div key={caption.seq} className="sbtsk-toast" role="status">
          <div className="sbtsk-toast-top">
            <svg className="sbtsk-crown" viewBox="0 0 24 14" aria-hidden="true">
              <path d="M2 12 L2 4 L7 8 L12 1 L17 8 L22 4 L22 12 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <span className="sbtsk-eyebrow">Task master</span>
          </div>
          <div className="sbtsk-caption">{caption.text}</div>
          <div className="sbtsk-sub">{caption.count} tasks assigned this sitting</div>
        </div>
      ))}

      {photo && (
        <div key={photo.seq} className="sbtsk-photo-scrim" onClick={() => setPhoto(null)} role="status">
          <div className="sbtsk-photo-frame">
            <img className="sbtsk-photo-img" src={photo.src} alt="Task streak poster" />
            <div className="sbtsk-photo-line">{photo.count} tasks this sitting. Tap to carry on.</div>
          </div>
        </div>
      )}
    </>
  )
}

const localStyles = `
  .sbtsk-toast {
    position: fixed; right: 18px; bottom: 18px; z-index: 9500;
    max-width: 340px; background: #fff;
    border: 0.5px solid #DCD7CB; border-left: 3px solid #9A7209;
    border-radius: 0 8px 8px 0; padding: 10px 14px 9px;
    box-shadow: 0 8px 28px rgba(15,20,25,0.16);
    animation: sbtsk-in 0.28s ease;
  }
  .sbtsk-toast-top { display: flex; align-items: center; gap: 6px; }
  .sbtsk-crown { width: 16px; height: 10px; color: #9A7209; }
  .sbtsk-eyebrow {
    font-size: 10px; font-weight: 600; letter-spacing: 0.09em;
    text-transform: uppercase; color: #888780;
  }
  .sbtsk-caption {
    margin-top: 3px; font-family: Georgia, 'Times New Roman', serif;
    font-style: italic; font-size: 15.5px; color: #2C2C2A; line-height: 1.35;
  }
  .sbtsk-sub { margin-top: 3px; font-size: 11px; color: #888780; }

  .sbtsk-capsule {
    position: fixed; left: 50%; transform: translate(-50%, 0);
    bottom: calc(152px + env(safe-area-inset-bottom));
    z-index: 55; width: min(420px, calc(100vw - 28px));
    background: #0F1419; border-radius: 12px; padding: 10px 14px 8px;
    box-shadow: 0 10px 30px rgba(15,20,25,0.35);
    animation: sbtsk-capsule-in 0.28s ease;
  }
  .sbtsk-capsule-text {
    font-family: Fraunces, Georgia, serif; font-size: 14px; color: #E8C15A;
    line-height: 1.3;
  }
  .sbtsk-capsule-track {
    height: 2px; background: #2A3038; border-radius: 2px; margin-top: 8px;
    overflow: hidden;
  }
  .sbtsk-capsule-drain {
    height: 100%; background: #9A7209; border-radius: 2px;
    animation: sbtsk-drain ${CAPTION_MS}ms linear forwards;
  }

  .sbtsk-photo-scrim {
    position: fixed; inset: 0; z-index: 9600;
    background: rgba(15, 20, 25, 0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 22px; cursor: pointer;
    animation: sbtsk-fade 0.22s ease;
  }
  .sbtsk-photo-frame { max-width: min(560px, 94vw); text-align: center; }
  .sbtsk-photo-img {
    max-width: 100%; max-height: 74vh; object-fit: contain;
    border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,0.45);
    display: block; margin: 0 auto;
    animation: sbtsk-pop 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .sbtsk-photo-line {
    margin-top: 12px; font-size: 12.5px; letter-spacing: 0.02em;
    color: rgba(255,255,255,0.85);
  }

  @keyframes sbtsk-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes sbtsk-capsule-in { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes sbtsk-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sbtsk-pop { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes sbtsk-drain { from { width: 100%; } to { width: 0%; } }
`

if (typeof document !== 'undefined' && !document.getElementById('sbtsk-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sbtsk-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
