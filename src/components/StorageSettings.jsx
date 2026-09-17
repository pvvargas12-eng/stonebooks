// =============================================================================
// StorageSettings — Settings › Storage (STORAGE-1, 2026-09-17)
// =============================================================================
// Paul: "in settings I need to add a storage bar and see where the most
// storage is being used." One stacked bar (database + every file bucket),
// then the breakdown ranked biggest-first, then the email-retention panel.
// Data: the storage_usage_report() SQL function (SECURITY DEFINER, staff-
// gated) — the client can't read pg_* / storage.objects directly.
// The 6-month email sweep itself lives in /api/email/sync.
// =============================================================================
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

function fmtBytes(n) {
  const v = Number(n) || 0
  if (v >= GB) return `${(v / GB).toFixed(2)} GB`
  if (v >= MB) return `${(v / MB).toFixed(1)} MB`
  return `${Math.round(v / 1024)} KB`
}

const BUCKET_LABELS = {
  'orders-attachments-public': 'Order files, photos & permits',
  'orders-attachments-private': 'Signed contracts & approvals',
  'orders-attachments': 'Sales signatures (legacy)',
  'vendor-files': 'Vendor / dealer files',
  'signatures': 'Contract signatures',
  'proof-signatures': 'Layout approval signatures',
  'receipts': 'Receipts',
  'cemetery_packets': 'Cemetery packets',
  'profile-photos': 'Staff photos',
  'sales-options': 'Sales options swatches',
  'monument-images': 'Catalog images',
}

const SEG_COLORS = ['#B3261E', '#C9A468', '#4C7DB8', '#1D9E75', '#8a5a12', '#7a6bb8', '#6a6a66']

export default function StorageSettings() {
  const [report, setReport] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('storage_usage_report')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setErr(error.message)
        else setReport(data)
      })
    return () => { cancelled = true }
  }, [])

  if (err) return <div className="sb-storage"><style>{CSS}</style><div className="sb-storage-err">Could not read storage usage: {err}</div></div>
  if (!report) return <div className="sb-storage"><style>{CSS}</style><div className="sb-storage-muted">Measuring storage…</div></div>

  const dbBytes = Number(report.db_total_bytes) || 0
  const buckets = (report.buckets || []).filter(b => Number(b.bytes) > 0)
  const filesBytes = buckets.reduce((s, b) => s + (Number(b.bytes) || 0), 0)
  const total = dbBytes + filesBytes

  const tables = report.tables || []
  const messagesBytes = Number(tables.find(t => t.name === 'messages')?.bytes) || 0
  const dbOther = Math.max(0, dbBytes - messagesBytes)

  // The stacked bar: email (the known hog) / rest of the database / each bucket.
  const segments = [
    { label: 'Email (synced Gmail)', bytes: messagesBytes },
    { label: 'Database — everything else', bytes: dbOther },
    ...buckets.map(b => ({ label: BUCKET_LABELS[b.bucket] || b.bucket, bytes: Number(b.bytes) || 0, files: b.files })),
  ].filter(s => s.bytes > 0)

  const rows = [...segments].sort((a, z) => z.bytes - a.bytes)
  const maxRow = rows[0]?.bytes || 1

  const email = report.email || {}
  const oldest = email.oldest_sent ? new Date(email.oldest_sent).toLocaleDateString() : '—'

  return (
    <div className="sb-storage">
      <style>{CSS}</style>
      <h2 className="sb-storage-h">Storage</h2>
      <div className="sb-storage-total">
        <b>{fmtBytes(total)}</b> in use — {fmtBytes(dbBytes)} database + {fmtBytes(filesBytes)} files
      </div>

      <div className="sb-storage-bar" role="img" aria-label="Storage usage by area">
        {segments.map((s, i) => (
          <div key={s.label} className="sb-storage-seg"
            style={{ width: `${Math.max(0.75, (s.bytes / total) * 100)}%`, background: SEG_COLORS[i % SEG_COLORS.length] }}
            title={`${s.label} — ${fmtBytes(s.bytes)}`} />
        ))}
      </div>
      <div className="sb-storage-legend">
        {segments.map((s, i) => (
          <span key={s.label} className="sb-storage-key">
            <i style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />{s.label}
          </span>
        ))}
      </div>

      <h3 className="sb-storage-sub">Where it's used — biggest first</h3>
      <div className="sb-storage-rows">
        {rows.map(r => (
          <div key={r.label} className="sb-storage-row">
            <div className="sb-storage-row-top">
              <span className="sb-storage-row-label">{r.label}</span>
              <span className="sb-storage-row-bytes">{fmtBytes(r.bytes)}{r.files != null ? ` · ${r.files} files` : ''}</span>
            </div>
            <div className="sb-storage-minibar"><i style={{ width: `${(r.bytes / maxRow) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <h3 className="sb-storage-sub">Email retention — the visibility window</h3>
      <div className="sb-storage-panel">
        <p>
          {Number(email.count || 0).toLocaleString()} emails synced, back to <b>{oldest}</b>.
          The rule: mail <b>not linked to an order disappears from Stonebooks at 6 months</b>;
          <b> order-linked mail stays up to 2 years</b>. Hidden means hidden, not deleted —
          the record stays in the database and the original stays in Gmail.
          Separately, emails older than 6 months drop their heavy HTML weight
          (the app reads the plain text anyway; attachments always pull from Gmail on demand).
        </p>
        <div className="sb-storage-stats">
          <div><b>{Number(email.hidden || 0).toLocaleString()}</b><span>hidden (aged out)</span></div>
          <div><b>{Number(email.hideable || 0).toLocaleString()}</b><span>aging out next sweeps</span></div>
          <div><b>{Number(email.pruned || 0).toLocaleString()}</b><span>slimmed</span></div>
          <div><b>{Number(email.prunable || 0).toLocaleString()}</b><span>to slim</span></div>
        </div>
        {(Number(email.prunable || 0) > 0 || Number(email.hideable || 0) > 0) && (
          <p className="sb-storage-muted">
            Both sweeps run with the email sync (every few minutes) — a backlog clears
            on its own within hours.
          </p>
        )}
      </div>
    </div>
  )
}

const CSS = `
  .sb-storage { max-width: 720px; }
  .sb-storage-h { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
  .sb-storage-sub { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 26px 0 10px; color: var(--sb-text-muted, #6B6456); }
  .sb-storage-total { font-size: 14px; color: var(--sb-text-muted, #6B6456); margin-bottom: 14px; }
  .sb-storage-total b { color: var(--sb-text, #0F1419); font-size: 16px; }
  .sb-storage-bar { display: flex; height: 26px; border-radius: 8px; overflow: hidden; border: 0.5px solid var(--sb-border, #E2D8C6); }
  .sb-storage-seg { min-width: 3px; }
  .sb-storage-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
  .sb-storage-key { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sb-text-muted, #6B6456); }
  .sb-storage-key i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .sb-storage-rows { display: flex; flex-direction: column; gap: 10px; }
  .sb-storage-row-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
  .sb-storage-row-label { font-weight: 600; }
  .sb-storage-row-bytes { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 12px; color: var(--sb-text-muted, #6B6456); white-space: nowrap; }
  .sb-storage-minibar { height: 6px; border-radius: 4px; background: var(--sb-surface, #f0eee9); margin-top: 4px; overflow: hidden; }
  .sb-storage-minibar i { display: block; height: 100%; background: #C9A468; border-radius: 4px; min-width: 2px; }
  .sb-storage-panel { border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 12px; padding: 14px 16px; font-size: 13.5px; line-height: 1.6; }
  .sb-storage-panel p { margin: 0 0 10px; }
  .sb-storage-stats { display: flex; gap: 12px; margin: 4px 0 10px; }
  .sb-storage-stats > div { background: var(--sb-surface, #FBFAF7); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 10px; padding: 8px 16px; text-align: center; }
  .sb-storage-stats b { display: block; font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 18px; }
  .sb-storage-stats span { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #6B6456); }
  .sb-storage-muted { font-size: 12.5px; color: var(--sb-text-muted, #8a8a85); }
  .sb-storage-err { color: #B3261E; font-size: 13px; }
`
