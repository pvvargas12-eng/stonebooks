// FieldErrorBoundary — a render crash on the phone used to be a white screen,
// and an installed PWA has no reload button (FIELD-POLISH 2026-11-11). This
// shows what broke and a Reload button. A failed lazy-chunk import (the app
// was left open across a deploy and the old file names are gone) reloads by
// itself, once.
import { Component } from 'react'

const CHUNK_RE = /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i
const RELOAD_KEY = 'sb_field_autoreload_at'

export default class FieldErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.warn('[field] render crash:', error)
    if (!CHUNK_RE.test(String(error?.message || ''))) return
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last < 30000) return   // already tried: show the screen
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch { /* storage blocked: still reload once */ }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    const msg = String(this.state.error?.message || this.state.error || 'Unknown error')
    return (
      <div style={{ minHeight: '100dvh', background: '#F5F3EE', color: '#16150F', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 22px', fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.16em' }}>STONEBOOKS <span style={{ color: '#9A7209' }}>FIELD</span></div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 18 }}>Something broke on this screen</div>
        <div style={{ fontSize: 13.5, color: '#6B6456', marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>Nothing you saved was lost. Reload to get back in.</div>
        <button type="button" onClick={() => window.location.reload()}
          style={{ marginTop: 20, minHeight: 52, padding: '0 28px', borderRadius: 14, border: 'none', background: '#0F1419', color: '#E8E2D4', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, letterSpacing: '0.04em', cursor: 'pointer' }}>
          RELOAD
        </button>
        <div style={{ fontSize: 11, color: '#8A7F6C', marginTop: 18, maxWidth: 420, overflowWrap: 'anywhere' }}>{msg.slice(0, 240)}</div>
      </div>
    )
  }
}
