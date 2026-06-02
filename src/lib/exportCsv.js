// =============================================================================
// exportCsv.js — minimal, dependency-free CSV builder + browser download
// =============================================================================
// toCSV(rows, columns) → RFC-4180-ish string (quotes fields containing
// comma/quote/newline, doubles embedded quotes). downloadCSV triggers a client
// download via a Blob — no server round-trip.
// =============================================================================

function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// columns: [{ key, label, get?(row) }]. `get` overrides row[key] when present.
export function toCSV(rows, columns) {
  const header = columns.map(c => csvCell(c.label ?? c.key)).join(',')
  const body = (rows || []).map(r =>
    columns.map(c => csvCell(c.get ? c.get(r) : r[c.key])).join(',')
  ).join('\r\n')
  return body ? `${header}\r\n${body}` : header
}

export function downloadCSV(filename, csvText) {
  // Prepend BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
