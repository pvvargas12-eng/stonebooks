// =============================================================================
// 📚 Stonebooks — Design Packet (JOBS-OPERATIONAL-HUBS Phase 2A.2 studio rebuild)
// =============================================================================
// The designer's studio workspace for a single job. Consolidates every
// stone-design fact stored on the order substrate into a card-grid layout
// that reads like a design studio worksheet, not a CRM detail page.
//
// Information layer (preserved from Phase 2A.1):
//   • Label dictionaries map enum codes → human labels (granite/shape/top/sides/
//     polish/layout/date/style/base-sides/job-type)
//   • humanizeCode fallback for any unmapped code
//   • Helpers — inchesDisplay, dimensionLine, assembledTitle, fullLegalName,
//     dateRangeLine, Field, proof-summary computation
//   • Field renders muted "—" when missing (per spec — operators must see
//     what's blank as clearly as what's filled)
//   • Print stylesheet drops the chrome and reflows on one column for clean
//     handoff to the design team
//
// Layout layer (rebuilt for Phase 2A.2):
//   Top bar (back · tabs · print)
//     ↓
//   Hero card (premium — family name 36px, deceased + dates, status badge,
//     meta strip)
//     ↓
//   Row 1 (2-col): STONE SPECIFICATION (60%) + MISSING INFORMATION (40%)
//   Row 2 (1-col): PROOF TIMELINE — 5-node horizontal stepper
//   Row 3 (1-col): WHAT GOES ON THE STONE — the heart of the packet
//   Row 4 (2-col): REFERENCE & LAYOUT (60%) + CUSTOMER NOTES (40%)
//
// Self-contained chrome — when JobDetail's detailTab === 'design', the page-
// level BackBar / PromiseStrip / JobDetailHero are hidden and this packet
// renders its own top bar + hero. The tab-switcher lives in the top bar so
// the operator can flip back to the job view without losing context.
//
// Phase hooks (TODO markers inline throughout — visual slots reserved, no
// fake state, no buttons that do nothing without explicit "// TODO Phase X"
// comments adjacent):
//   • Phase 2B — file upload wiring (drop zone onClick + onDrop → Supabase
//     storage `orders-attachments/<order_id>/layouts/<version>.pdf`)
//   • Phase 2B — approved design thumbnail real image from latest version
//   • Phase 5  — "Draft approval email" button + composer modal
//   • Phase 5  — "Send to customer" button + email-send wiring
//   • Phase 5  — real revision history rendering from a version_uploads
//     table (NEW table — not yet built)
//   • Phase 5  — customer email composer modal
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import {
  fmtDate,
  uploadProofLayout,
  createProofVersion,
  getProofVersions,
  getCurrentStaffName,
} from './lib/stonebooksData'

// ============================================================================
// LABEL DICTIONARIES
// ============================================================================
// Slim code→label lookups for the few enums that don't read well humanized.
// Source of truth lives in SalesMode.jsx (GRANITE_COLORS, SHAPES, TOP_SHAPES,
// etc.); these mirror the canonical labels for the codes operators see most.
// Anything unmapped falls through to humanizeCode (slug → "Title Case").

const GRANITE_LABELS = {
  'medium-barre-grey':  'Barre Grey',
  'legacy-gray':        'Legacy Gray',
  'st-cloud-grey':      'St. Cloud Grey',
  'cloud-gray':         'Cloud Gray',
  'jet-black':          'Jet Black',
  'american-black':     'American Black',
  'flash-impala-black': 'Flash Impala Black',
  'bahama-blue':        'Bahama Blue',
  'mountain-rose':      'Mountain Rose',
  'colonial-rose':      'Colonial Rose',
  'salisbury-pink':     'Salisbury Pink',
  'india-red':          'India Red',
  'missouri-red':       'Missouri Red',
  'dakota-mahogany':    'Dakota Mahogany',
  'royal-mahogany':     'Royal Mahogany',
  'china-evergreen':    'China Evergreen',
  'cats-eye-brown':     "Cat's Eye Brown",
  'paradiso':           'Paradiso',
}

// Per-code approximate hex used by the (removed in 2A.3) stone silhouette
// + reserved for the future parametric-SVG sprint when a real shape
// preview lands. Family-level approximations from SalesMode's
// COLOR_FAMILY_HEX, with per-code variation so visually similar grays
// don't all read identical. The eslint-disable preserves the dictionary
// in code as future visual reference (see the StoneSilhouette removal
// comment below).
// eslint-disable-next-line no-unused-vars
const GRANITE_HEX = {
  'medium-barre-grey':  '#A0A09D',
  'legacy-gray':        '#969694',
  'st-cloud-grey':      '#8E918E',
  'cloud-gray':         '#A8A8A6',
  'jet-black':          '#1A1A1A',
  'american-black':     '#252525',
  'flash-impala-black': '#1F1F1F',
  'bahama-blue':        '#3A4D63',
  'mountain-rose':      '#C4A5A5',
  'colonial-rose':      '#B89696',
  'salisbury-pink':     '#D4AFAF',
  'india-red':          '#7A3A3A',
  'missouri-red':       '#8B3535',
  'dakota-mahogany':    '#5C2F23',
  'royal-mahogany':     '#3D1F1A',
  'china-evergreen':    '#2D3A2C',
  'cats-eye-brown':     '#6B554A',
  'paradiso':           '#5E4A3F',
}
// Fallback hex preserved for the future parametric-SVG sprint (see the
// 2A.3 silhouette removal comment below).
// eslint-disable-next-line no-unused-vars
const GRANITE_HEX_FALLBACK = '#9A9A98'

const SHAPE_LABELS = {
  grass:           'Grass Marker',
  hickey:          'Hickey',
  slant:           'Slant',
  'double-slant':  'Double Slant',
  die:             'Die',
  'double-die':    'Double Die',
  upright:         'Upright',
  civic:           'Civic Memorial',
  custom:          'Custom Shape',
}

const TOP_SHAPE_LABELS = {
  'classic-serp':    'Classic Serpentine',
  'flat-top':        'Flat Top',
  'roof-top':        'Roof Top',
  'oval-top':        'Oval Top',
  cathedral:         'Cathedral',
  gothic:            'Gothic',
  'cathedral-serp':  'Cathedral Serp',
}

const SIDES_LABELS = {
  brp:                   'BRP — all sides',
  'brp-vertical':        'BRP — vertical sides only',
  'all-polish-no-sides': 'All polish, no sides',
  'saw-back':            'Saw back',
  'rough-back':          'Rough back',
}

const POLISH_LABELS = {
  P2: 'P2 — Polished front + back',
  P3: 'P3 — Polished front, back, top',
  P5: 'P5 — Polished all sides except bottom',
}

const LAYOUT_LABELS = {
  centered_family_name: 'Centered Family Name',
  side_by_side:         'Side by side',
  stacked:              'Stacked',
  custom:               'Custom layout',
}

const DATE_FORMAT_LABELS = {
  month_day_year: 'Month Day, Year',
  abbreviated:    'Abbreviated',
  slash:          'Slash format',
  dot:            'Dot format',
  year_only:      'Year only',
  year_name_year: 'Year Name Year',
  custom:         'Custom format',
}

const STYLE_TREATMENT_LABELS = {
  plain:        'Plain text',
  scroll:       'Scroll',
  banner:       'Banner',
  skin_frosted: 'Skin frosted',
  panel:        'Panel',
  double_panel: 'Double panel',
  panel_chip:   'Panel with chip',
  old_english:  'Old English font',
  special_font: 'Special font',
  custom:       'Custom treatment',
}

const JOB_TYPE_LABELS = {
  new_stone:        'New stone',
  mausoleum_door:   'Crypt door',
  cleaning_repair:  'Cleaning / Repair',
  inscription:      'Inscription',
}

// Slug → "Title Case". Catch-all so an unknown code still produces a human-
// shaped label rather than the raw slug or "—".
function humanizeCode(code) {
  if (!code) return null
  return String(code)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || null
}

function labelFor(map, code, fallback = humanizeCode) {
  if (!code) return null
  if (map && map[code]) return map[code]
  return typeof fallback === 'function' ? fallback(code) : code
}

// ============================================================================
// HELPERS
// ============================================================================

// Inches → raw integer string. Phase 2A.3 (Paul's review against the Larsen
// approval-packet reference) replaced the prior "1' 6\"" architect notation
// with pure inches because the feet/inches notation was reading off-by-feet
// at a glance and didn't match the bottom-strip metadata format on the
// real customer-facing packet. The values stored in width_inches /
// depth_inches / thickness_inches / height_inches are already numeric
// inches per SalesMode rowFromOrder; no conversion needed.
function inchesDisplay(inches) {
  if (inches == null || inches === '') return null
  const n = Number(inches)
  if (!Number.isFinite(n)) return null
  return String(n)
}

// Multi-dimension joiner — "W × D × T × H" with raw inches per Phase 2A.3.
// Missing values render as "—" so the operator sees the shape of the gap
// rather than a collapsed line.
function dimensionLine(w, d, t, h) {
  const parts = [w, d, t, h].map(inchesDisplay)
  if (parts.every(p => p == null)) return null
  return parts.map(p => p ?? '—').join(' × ')
}

function assembledTitle(person) {
  if (!person) return null
  if (person.title) return person.title
  const prefix = person.titlePrefix || ''
  const rels = Array.isArray(person.titleRelations) ? person.titleRelations : []
  if (rels.length === 0 && !prefix) return null
  const relPart = rels.length === 0
    ? ''
    : rels.length === 1
      ? rels[0]
      : rels.slice(0, -1).join(', ') + ' & ' + rels.slice(-1)
  return [prefix, relPart].filter(Boolean).join(' ').trim() || null
}

function fullLegalName(person) {
  if (!person) return null
  const parts = [
    person.firstName || person.first_name,
    person.middleName || person.middle_name,
    person.lastName  || person.last_name,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function dateRangeLine(person, { longForm = false } = {}) {
  if (!person) return null
  const dob = person.dateOfBirth || person.date_of_birth
  const dod = person.dateOfDeath || person.date_of_death
  if (!dob && !dod) return null
  const isPreNeed = !!(person.isPreNeed ?? person.is_pre_need)
  const fmt = (v) => fmtDate(v, longForm ? { long: true } : undefined)
  if (isPreNeed && dob && !dod) return `b. ${fmt(dob)} (pre-need)`
  return `${dob ? fmt(dob) : '—'} — ${dod ? fmt(dod) : '—'}`
}

// Title-with-name composer for the "What goes on the stone" per-person card.
// Returns e.g. "Beloved Father · Brian David Walker" — title then legal name.
function fullNameWithTitle(person) {
  const title = assembledTitle(person)
  const name = fullLegalName(person)
  if (!title && !name) return null
  if (!title) return name
  if (!name) return title
  return `${title} · ${name}`
}

// Symbols / elements joined for display in the WGOTS card. Combines element
// filters (Step 7 selection) + any symbol-typed add-ons. Each code is
// humanized through SYMBOL_LABELS if known, else humanizeCode.
const SYMBOL_LABELS = {
  cross:     'Cross',
  jesus:     'Jesus',
  angel:     'Angels',
  praying:   'Praying Hands',
  mary:      'Mary / Madonna',
  jewish:    'Star of David',
  menorah:   'Menorah',
  rose:      'Roses',
  flower:    'Flowers',
  heart:     'Hearts',
  dove:      'Doves',
  butterfly: 'Butterflies',
  tree:      'Tree of Life',
  scenic:    'Scenic',
  veteran:   'Veteran',
  pet:       'Pet / Paw',
  music:     'Music',
  sport:     'Sports',
}

function symbolsLine(order) {
  const filters = Array.isArray(order.element_filters) ? order.element_filters : []
  const addons  = Array.isArray(order.add_ons) ? order.add_ons : []
  const labels = []
  for (const code of filters) {
    if (!code) continue
    labels.push(SYMBOL_LABELS[code] || humanizeCode(code))
  }
  for (const a of addons) {
    if (!a) continue
    const c = a.code || a.kind
    if (!c) continue
    // Skip non-symbol add-ons (shape_carve, laser_etch are work-type, not symbol)
    if (c === 'shape_carve' || c === 'laser_etch' || c === 'hand_sculpt' ||
        c === 'bling' || c === 'vase') continue
    labels.push(humanizeCode(c))
  }
  return labels.length > 0 ? labels.join(' · ') : null
}

// Field component from Phase 2A.1 has been replaced by SpecRow (below)
// which fits the card-grid geometry. Missing-value sentinel logic preserved
// in SpecRow + .sb-design-field-missing CSS class.

// ============================================================================
// STONE SILHOUETTE — REMOVED in Phase 2A.3
// ============================================================================
// The colored-rectangle placeholder for the stone face was misleading: it
// suggested a real shape preview but rendered every stone as the same flat
// rectangle regardless of slant/serpentine/double/etc. Paul's review against
// the actual Larsen approval packet (which shows a true rendered stone with
// shape art + inscription positioned) made the placeholder read as
// worse-than-nothing. Removed entirely. GRANITE_HEX dictionary is retained
// near the top of this file for a future real parametric-SVG sprint; the
// removed component used it for fill color + ITU-R BT.601 luminance text-
// color flipping (see git history for the implementation).

// ============================================================================
// PROOF TIMELINE — 5-node horizontal stepper
// ============================================================================
// Reads job.milestones[] for proof_created / proof_sent / proof_approved
// (plus bronze variants). The "Revision" node is reserved for a future
// revision-detection pass — for Phase 2A.2 it renders as a not-yet node
// unless a revision_requested event is present in the events log (Phase 5).
// The "Final" node activates when proof_approved is done.

function ProofTimeline({ milestones }) {
  const byKey = new Map((milestones || []).map(m => [m.milestone_key, m]))
  const created  = byKey.get('proof_created')  || byKey.get('bronze_proof_created')
  const sent     = byKey.get('proof_sent')     || byKey.get('bronze_proof_sent')
  const approved = byKey.get('proof_approved') || byKey.get('bronze_proof_approved')

  // Each node: { label, done, active }. "active" = the node where work
  // currently lives (most-advanced not-done). Provides the bronze ring.
  const isDone = (m) => m && m.status === 'done'
  const nodes = [
    { key: 'needed',   label: 'Proof needed',  date: created?.status_date, done: !!created  && isDone(created) },
    { key: 'sent',     label: 'Sent',          date: sent?.status_date,    done: !!sent     && isDone(sent) },
    { key: 'approved', label: 'Approved',      date: approved?.status_date,done: !!approved && isDone(approved) },
    // TODO Phase 5: detect revision_requested events here and flip
    // `done` / `active` accordingly. For Phase 2A.2 this node is a
    // placeholder so the stepper feels complete; rendered muted until
    // wired.
    { key: 'revision', label: 'Revision',      date: null,                 done: false, placeholder: true },
    { key: 'final',    label: 'Final',         date: null,                 done: isDone(approved), placeholder: !isDone(approved) },
  ]
  // Active node = the FIRST not-done non-placeholder. Renders with a
  // bronze ring so the operator's eye lands on "this is where I am now."
  let activeIdx = -1
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].done && !nodes[i].placeholder) { activeIdx = i; break }
  }
  if (activeIdx === -1) {
    // Everything that can be done IS done — first placeholder becomes
    // the operator's next target (revision OR final).
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].done) { activeIdx = i; break }
    }
  }

  return (
    <div className="sb-design-proof-timeline">
      <div className="sb-design-proof-track">
        {nodes.map((n, i) => {
          const filled = n.done
          const active = i === activeIdx && !n.done
          const dim    = n.placeholder && !active && !n.done
          return (
            <div
              key={n.key}
              className={[
                'sb-design-proof-node',
                filled && 'sb-design-proof-node-done',
                active && 'sb-design-proof-node-active',
                dim    && 'sb-design-proof-node-dim',
              ].filter(Boolean).join(' ')}
            >
              <div className="sb-design-proof-dot" aria-hidden="true" />
              <div className="sb-design-proof-label">{n.label}</div>
              <div className="sb-design-proof-date">
                {n.date ? fmtDate(n.date) : (active ? 'next' : '')}
              </div>
            </div>
          )
        })}
        {/* Connector segments — bronze for completed transitions, muted
            gray for pending. Rendered as a separate row of N-1 line bars
            that align under the gaps between dots via CSS grid. */}
        <div className="sb-design-proof-lines" aria-hidden="true">
          {nodes.slice(0, -1).map((n, i) => {
            const filled = n.done && nodes[i + 1].done
            return <div key={i} className={`sb-design-proof-line${filled ? ' sb-design-proof-line-done' : ''}`} />
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MISSING INFORMATION DETECTOR
// ============================================================================
// Bronze ▲ alerts for design-blocking gaps. Honest checks against substrate
// — no fabricated "complete" states. Each item carries a short operator-
// readable label. Returns [] when nothing missing → renders the green ✓
// "All information complete" empty state.

function detectMissingInfo(job) {
  if (!job) return []
  const order = job.order || {}
  const cemetery = job.cemetery || null
  const milestones = Array.isArray(job.milestones) ? job.milestones : []
  const inscription = order.inscription || {}
  const deceased = Array.isArray(order.deceased) ? order.deceased : []
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
  const isDone = (k) => byKey.get(k)?.status === 'done'

  const missing = []

  // Stone size — missing when BOTH standard size and explicit width are absent.
  if (!order.standard_size_code && order.width_inches == null) {
    missing.push({ key: 'stone_size', label: 'Stone size not set' })
  }

  // Inscription verse / epitaph (skipped for cleaning_repair — no verse).
  if (job.job_type !== 'cleaning_repair' && !inscription.epitaph) {
    missing.push({ key: 'epitaph', label: 'Inscription verse not chosen' })
  }

  // Customer reference photo — for Phase 2A.2 we check the
  // inscription.preExistingPhotoUrl slot (the only photo path on the
  // current order substrate). Phase 2B will broaden this once
  // orders-attachments tagging lands.
  if (!inscription.preExistingPhotoUrl) {
    missing.push({ key: 'photo', label: 'Customer reference photo missing' })
  }

  // Cemetery rules — missing when neither the cemetery has notes on file
  // NOR a permit/cemetery-confirmed milestone is done.
  const cemeteryConfirmed = isDone('cemetery_confirmed') || isDone('permit_approved') || isDone('permit_filed')
  const cemeteryHasNotes = !!(cemetery && (cemetery.notes || cemetery.rules_notes))
  if (!cemeteryConfirmed && !cemeteryHasNotes) {
    missing.push({ key: 'cemetery_rules', label: 'Cemetery rules not confirmed' })
  }

  // Per-person dates — each non-pre-need person needs both DOB and DOD.
  // For pre-need persons, only DOB is required (DOD = unknown future).
  let datesMissing = false
  for (const d of deceased) {
    const preNeed = !!(d?.isPreNeed ?? d?.is_pre_need)
    const dob = d?.dateOfBirth || d?.date_of_birth
    const dod = d?.dateOfDeath || d?.date_of_death
    if (preNeed) {
      if (!dob) { datesMissing = true; break }
    } else {
      if (!dob || !dod) { datesMissing = true; break }
    }
  }
  if (deceased.length > 0 && datesMissing) {
    missing.push({ key: 'dates', label: 'Birth or death dates incomplete' })
  }

  // Customer approval — proof_approved must be done. This is the design
  // gate; not customer-blocking, but design-team-blocking when getting
  // ready for stencil cut.
  if (!isDone('proof_approved') && !isDone('bronze_proof_approved')) {
    missing.push({ key: 'approval', label: 'Customer approval not yet received' })
  }

  return missing
}

// ============================================================================
// PHASE 2A.3 HELPERS — catalog id cleaner, design thumb url, add-on display
// ============================================================================

// Mirrors SalesMode's cleanCatalogId (kept inline so DesignPacket has no
// import dependency on the 15k-line SalesMode file). Strips internal
// filename noise: "local_A0001.jpg_370245" → "A1".
function cleanCatalogId(rawId) {
  if (!rawId) return ''
  const m = String(rawId).match(/^local_([A-Z]+)(\d+)\.(?:jpg|jpeg|png|webp)/i)
  if (m) return m[1].toUpperCase() + parseInt(m[2], 10)
  const s = String(rawId)
  return s.length > 10 ? s.slice(0, 10) : s
}

// SalesMode's `thumb()` helper rewrites Google Drive image URLs to a
// reasonable display width. Otherwise passes the URL through.
function designThumb(url) {
  if (!url) return url
  if (typeof url === 'string' && url.includes('drive.google.com')) {
    return url.replace(/sz=w\d+/i, 'sz=w400')
  }
  return url
}

// Add-on display derivation — pulls the operational read out of an add_on
// item. SalesMode writes the size into the LABEL for photo/laser/vase/
// bling/etc. (e.g. "Porcelain Photo — Medium (3.54″ × 4.72″)", "Vase —
// 5 × 5 × 9"), so the label IS the spec line. Notes (operator's free
// text) ride underneath when present.
//
// Earlier 2A.3 draft added a bronze ▲ "size missing" inline marker, but
// all 4 reviewers (Monument Ops, UX Friction, CRM, Data Integrity) flagged
// it as either (a) false-positive prone on shape-carve / BLING / custom
// items whose labels legitimately lack digits, or (b) visually colliding
// with the Missing Information card's identical ▲. Dropped the marker —
// the label itself is the spec, missing size is visible from the label.
function addOnDisplay(item) {
  if (!item) return { label: '—', qty: 1, notes: null }
  const code = item.code || ''
  const label = item.label || humanizeCode(code) || 'Add-on'
  const notes = (item.notes || '').trim() || null
  const qty = Number(item.qty) || 1
  return { label, qty, notes }
}

// ============================================================================
// CARD WRAPPER
// ============================================================================
// Generic white card with uppercase 11px eyebrow + body. The whole packet
// is built from these — visual consistency with the rest of the studio.

function Card({ title, span = 1, children, className = '', titleRight = null }) {
  return (
    <section
      className={`sb-design-card sb-design-card-span-${span} ${className}`.trim()}
    >
      <header className="sb-design-card-head">
        <span className="sb-design-card-eyebrow">{title}</span>
        {titleRight && (
          <span className="sb-design-card-eyebrow-right">{titleRight}</span>
        )}
      </header>
      <div className="sb-design-card-body">
        {children}
      </div>
    </section>
  )
}

// =============================================================================
// MAIN
// =============================================================================

export default function DesignPacket({ job, onBack, tab = 'design', onChangeTab, onPrint }) {
  // ── Proof-version state (Stage 2 Commit 1 — upload-flow wiring) ───────────
  // Hooks run unconditionally before the !job early-return so render order is
  // stable. The version stack is loaded here (not part of getJob) and kept in
  // local state; a successful upload prepends the new current version.
  const jobId = job?.id || null
  const fileInputRef = useRef(null)
  const [versions, setVersions] = useState([])
  // Initialize loading from jobId presence so the effect never has to setState
  // synchronously in its body (avoids the React 19 set-state-in-effect lint).
  // JobDetail remounts per job (key={selectedJobId}), so the initializer runs
  // once per job and the effect fires once.
  const [versionsLoading, setVersionsLoading] = useState(!!jobId)
  // upload.status: 'idle' | 'uploading' | 'error' | 'success'
  const [upload, setUpload] = useState({ status: 'idle', error: null })

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    getProofVersions(jobId).then(rows => {
      if (cancelled) return
      setVersions(rows)
      setVersionsLoading(false)
    })
    return () => { cancelled = true }
  }, [jobId])

  if (!job) return null
  const order      = job.order      || {}
  const cemetery   = job.cemetery   || null
  const inscription = order.inscription || {}
  const baseConfig = order.base_config || {}
  const deceased   = Array.isArray(order.deceased)       ? order.deceased : []
  const milestones = Array.isArray(job.milestones)       ? job.milestones : []
  const serviceTypes = Array.isArray(order.service_types) ? order.service_types : []
  // Phase 2A.3 — add_ons surfaced as a dedicated sub-section in WGOTS card.
  // Symbol-only add-ons (anything element_filters-like) still flow through
  // symbolsLine; the WGOTS add-ons list is the operational spec view (size,
  // qty, notes per item) so the carver/designer can plan placement.
  const addOnsRaw = Array.isArray(order.add_ons) ? order.add_ons : []
  const addOnsForWgots = addOnsRaw.filter(a => a && (a.code || a.label))
  // Phase 2A.3 — designs[] + inscription.preExistingPhotoUrl are the
  // operational reference photo sources today. Phase 2B will add a
  // broader orders-attachments lookup; for now these two paths cover the
  // real signal without a new fetch.
  const designs = Array.isArray(order.designs) ? order.designs : []
  const referenceItems = (() => {
    const out = []
    for (let i = 0; i < designs.length; i++) {
      const d = designs[i] || {}
      const s = d.snapshot || {}
      out.push({
        kind: 'design',
        key: `design-${d.id || i}`,
        id: cleanCatalogId(s.id || d.id),
        label: s.lastname || s.name || cleanCatalogId(s.id || d.id) || 'Design selection',
        img: s.img ? designThumb(s.img) : null,
        role: i === 0 ? 'PRIMARY' : `Alt ${i}`,
        tags: [s.granite_color, s.carve_type].filter(Boolean),
      })
    }
    if (inscription.preExistingPhotoUrl) {
      out.push({
        kind: 'photo',
        key: 'existing-marker',
        label: 'Existing marker photo',
        img: inscription.preExistingPhotoUrl,
        role: null,
        tags: ['Customer-supplied'],
      })
    }
    return out
  })()

  // ── Identity ──────────────────────────────────────────────────────────────
  const familyName = order.primary_lastname || order.customer?.last_name || null
  const jobType = JOB_TYPE_LABELS[job.job_type] || humanizeCode(job.job_type) || 'Order'
  const cemeteryLocation = cemetery
    ? [cemetery.city, cemetery.county || cemetery.state].filter(Boolean).join(', ')
    : null

  // ── Proof state summary ──────────────────────────────────────────────────
  // Mirrors the Phase 2A.1.5 logic — surfaced in the Hero's right column
  // and reused for the timeline + missing-info logic.
  const proofSummary = (() => {
    const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
    const approved = byKey.get('proof_approved') || byKey.get('bronze_proof_approved')
    const sent     = byKey.get('proof_sent')     || byKey.get('bronze_proof_sent')
    const created  = byKey.get('proof_created')  || byKey.get('bronze_proof_created')
    if (approved?.status === 'done') {
      return { text: 'Approved', detail: approved.status_date ? fmtDate(approved.status_date) : null, tone: 'good' }
    }
    if (sent?.status === 'done' && approved && approved.status !== 'done') {
      return { text: 'Awaiting customer', detail: sent.status_date ? `sent ${fmtDate(sent.status_date)}` : null, tone: 'wait' }
    }
    if (created?.status === 'done' && sent && sent.status !== 'done') {
      return { text: 'Ready to send', detail: created.status_date ? `drafted ${fmtDate(created.status_date)}` : null, tone: 'ready' }
    }
    if (created && !isAdvanced(created)) {
      return { text: 'Layout needed', detail: null, tone: 'todo' }
    }
    return { text: 'Layout needed', detail: null, tone: 'todo' }
  })()

  // ── Stone spec card data ─────────────────────────────────────────────────
  const graniteLabel = labelFor(GRANITE_LABELS, order.granite_color)
  const shapeLabel   = labelFor(SHAPE_LABELS,   order.shape)
  const standardSizeLabel = order.standard_size_code ? humanizeCode(order.standard_size_code) : null
  const dimsLine = dimensionLine(order.width_inches, order.depth_inches, order.thickness_inches, order.height_inches)

  const baseSummary = !baseConfig.include
    ? 'Not included'
    : [
        baseConfig.sizeCode ? humanizeCode(baseConfig.sizeCode) : null,
        baseConfig.heightCode ? `${baseConfig.heightCode}″ tall` : null,
      ].filter(Boolean).join(' · ') || 'Included'

  // ── Missing-info detection ───────────────────────────────────────────────
  const missingItems = detectMissingInfo(job)

  // ── WGOTS — symbols / dates / plot ───────────────────────────────────────
  const symbolsValue = symbolsLine(order)

  // Plot location positional fields — same data the Hero meta strip uses
  // for address; surfaced as "may be engraved" content in WGOTS per
  // Phase 2A.3 Fix 6. Defensive .trim() per Data Integrity review —
  // legacy rows occasionally have leading/trailing whitespace from
  // bulk imports or paste-overs; a whitespace-only field would render
  // as "Section   " without it.
  const _plotPart = (raw, prefix) => {
    if (raw == null) return null
    const v = String(raw).trim()
    return v ? `${prefix} ${v}` : null
  }
  const plotPositional = [
    _plotPart(order.plot_section, 'Section'),
    _plotPart(order.plot_block,   'Block'),
    _plotPart(order.plot_lot,     'Lot'),
    _plotPart(order.plot_row,     'Row'),
    _plotPart(order.plot_space,   'Space'),
    _plotPart(order.plot_grave,   'Grave'),
    _plotPart(order.plot_level,   'Level'),
  ].filter(Boolean).join(' · ') || null

  // Phase 2A.3 Fix 1 — Font row removed. When inscription.customFont is
  // set and has a non-default description, prepend it to special
  // instructions as a leading note ("Font: ...") so the carver still
  // sees the directive but framed as an instruction, not as a
  // pseudo-form-field. inscription.customFont is the bool flag;
  // .customFontDescription is the free text.
  const fontInstructionPara = (() => {
    if (!inscription.customFont) return null
    const desc = (inscription.customFontDescription || '').trim()
    if (!desc) return 'Font: custom — see notes'
    return `Font: ${desc}`
  })()
  const specialInstructionParas = [
    fontInstructionPara,
    order.design_preferences,
    inscription.customNotes,
    order.matching_to_description,
    order.timeline_notes,
  ].filter(Boolean)
  const hasSpecialInstructions = specialInstructionParas.length > 0

  // ── Proof upload (Stage 2 Commit 1) ───────────────────────────────────────
  // The current version (is_current) renders inline; the rest are history.
  const currentVersion = versions.find(v => v.is_current) || versions[0] || null

  // Freeze the order's CURRENT design facts into a snapshot. Runs at upload
  // time (event handler — new Date() is lint-safe here, not in render). Inner
  // JSONB keys (deceased[].dateOfBirth, inscription.epitaph) are camelCase;
  // top-level columns (granite_color, primary_lastname) are snake_case.
  const buildMetadataSnapshot = () => {
    const personName = (d) =>
      [d.firstName, d.middleName, d.lastName].map(s => (s || '').trim()).filter(Boolean).join(' ')
    const people = deceased
      .filter(d => d && !d.isReserved && (d.firstName || d.lastName || d.inscriptionName))
      .map(d => ({
        name: d.inscriptionName || personName(d) || null,
        birth: d.dateOfBirth || null,
        death: d.dateOfDeath || null,
      }))
    return {
      order_number:      order.order_number || null,
      family_name:       familyName,
      deceased_names:    people.map(p => p.name).filter(Boolean),
      deceased:          people,
      inscription_epitaph: (inscription.epitaph || '').trim() || null,
      inscription_notes:   (inscription.customNotes || '').trim() || null,
      stone_color:       order.granite_color || null,
      stone_color_label: graniteLabel,
      stone_shape:       order.shape || null,
      stone_shape_label: shapeLabel,
      die_size:          dimsLine || null,
      base_size:         baseSummary || null,
      cemetery_name:     cemetery?.name || null,
      add_ons:           addOnsForWgots.map(a => {
        const { label, qty, notes } = addOnDisplay(a)
        return { label, qty, notes }
      }),
      snapshot_at:       new Date().toISOString(),
    }
  }

  const handleProofFile = async (file) => {
    if (!file || !jobId) return
    setUpload({ status: 'uploading', error: null })
    const up = await uploadProofLayout(jobId, file)
    if (!up.ok) { setUpload({ status: 'error', error: up.error }); return }
    const uploadedBy = await getCurrentStaffName()
    const { data, error } = await createProofVersion({
      jobId,
      layoutImageUrl: up.url,
      metadataSnapshot: buildMetadataSnapshot(),
      uploadedBy,
    })
    if (error) { setUpload({ status: 'error', error: error.message }); return }
    // Prepend the new current version; demote any prior current row locally to
    // mirror what create_proof_version did server-side.
    setVersions(prev => [data, ...prev.map(v => ({ ...v, is_current: false }))])
    setUpload({ status: 'success', error: null })
  }

  const onDropProof = (e) => {
    e.preventDefault()
    if (upload.status === 'uploading') return
    const file = e.dataTransfer?.files?.[0]
    if (file) handleProofFile(file)
  }

  const onPickProof = (e) => {
    const file = e.target.files?.[0]
    // Reset the input so re-selecting the same filename re-fires onChange.
    e.target.value = ''
    if (file) handleProofFile(file)
  }

  const uploading = upload.status === 'uploading'

  return (
    <div className="sb-design-packet-page">
      {/* ── TOP BAR ────────────────────────────────────────────────────── */}
      <div className="sb-design-topbar sb-print-hide">
        <button
          type="button"
          className="sb-design-topbar-back"
          onClick={onBack}
          aria-label="Back"
        >← Back to Design Hub</button>
        {onChangeTab && (
          <div className="sb-design-topbar-tabs">
            <button
              type="button"
              className={`sb-design-topbar-tab${tab === 'job' ? ' sb-design-topbar-tab-active' : ''}`}
              onClick={() => onChangeTab('job')}
              aria-pressed={tab === 'job'}
            >Job view</button>
            <button
              type="button"
              className={`sb-design-topbar-tab${tab === 'design' ? ' sb-design-topbar-tab-active' : ''}`}
              onClick={() => onChangeTab('design')}
              aria-pressed={tab === 'design'}
            >Design packet</button>
          </div>
        )}
        <button
          type="button"
          className="sb-design-topbar-print"
          onClick={() => (onPrint ? onPrint() : window.print())}
        >Print</button>
      </div>

      {/* ── HERO CARD ──────────────────────────────────────────────────── */}
      <section className="sb-design-hero-card">
        <div className="sb-design-hero-left">
          <h1 className="sb-design-hero-family">
            {familyName
              ? familyName.toUpperCase()
              : <span className="sb-design-field-missing">— family name —</span>}
          </h1>
          {deceased.length > 0 && (
            <div className="sb-design-hero-deceased">
              {deceased.map((d, i) => {
                const name = fullLegalName(d) || '—'
                const dates = dateRangeLine(d)
                return (
                  <span key={i}>
                    {name}
                    {dates && <span className="sb-design-hero-dates"> · {dates}</span>}
                    {i < deceased.length - 1 && <span className="sb-design-hero-sep"> · </span>}
                  </span>
                )
              })}
            </div>
          )}
          <div className="sb-design-hero-meta">
            <span className="sb-design-hero-meta-item sb-crm-mono">{order.order_number || '—'}</span>
            <span className="sb-design-hero-meta-sep">·</span>
            <span className="sb-design-hero-meta-item">{jobType}</span>
            <span className="sb-design-hero-meta-sep">·</span>
            <span className="sb-design-hero-meta-item">{cemetery?.name || '—'}</span>
            {order.plot_type && (
              <>
                <span className="sb-design-hero-meta-sep">·</span>
                <span className="sb-design-hero-meta-item">{humanizeCode(order.plot_type)}</span>
              </>
            )}
            {serviceTypes.length > 1 && (
              <>
                <span className="sb-design-hero-meta-sep">·</span>
                <span className="sb-design-hero-meta-item">
                  {serviceTypes.length} services
                </span>
              </>
            )}
            {cemeteryLocation && (
              <>
                <span className="sb-design-hero-meta-sep">·</span>
                <span className="sb-design-hero-meta-item">{cemeteryLocation}</span>
              </>
            )}
            {plotPositional && (
              <>
                <span className="sb-design-hero-meta-sep">·</span>
                <span className="sb-design-hero-meta-item sb-crm-mono">{plotPositional}</span>
              </>
            )}
          </div>
        </div>
        <div className="sb-design-hero-right">
          <div className={`sb-design-status-badge sb-design-status-badge-${proofSummary.tone}`}>
            {proofSummary.text}
          </div>
          {proofSummary.detail && (
            <div className="sb-design-status-detail sb-crm-tabular">{proofSummary.detail}</div>
          )}
          {order.rush_order && (
            <div className="sb-design-rush-tag">RUSH</div>
          )}
          {order.cemetery_deadline && (
            <div className="sb-design-deadline">
              Cemetery deadline <strong className="sb-crm-tabular">{fmtDate(order.cemetery_deadline)}</strong>
            </div>
          )}
        </div>
      </section>

      {/* ── ROW 1 — STONE SPEC + MISSING INFO ──────────────────────────── */}
      <div className="sb-design-row sb-design-row-2col-60-40">
        <Card title="Stone specification" span={60}>
          {/* Phase 2A.3 — silhouette placeholder removed (was misleading, see
              comment above the deleted StoneSilhouette component). Spec
              rows alone now carry the card. Granite name (not a colored
              swatch) and shape name are operationally the load-bearing
              spec; the real shape preview lands when the parametric SVG
              sprint ships.
              Phase 2A.3 polish — headline falls back to SHAPE label for
              custom-shape orders so the card identity holds even without
              a standard die. Monument Ops review flagged the empty-card-
              for-custom case. */}
          {(() => {
            const headlineLabel = standardSizeLabel ? 'DIE' : (shapeLabel || order.custom_shape ? 'SHAPE' : null)
            const headlineValue = standardSizeLabel
              || (shapeLabel || (order.custom_shape ? humanizeCode(order.custom_shape) : null))
            if (!headlineLabel || !headlineValue) return null
            return (
              <div className="sb-design-stone-headline">
                <span className="sb-design-stone-headline-label">{headlineLabel}</span>
                <span className="sb-design-stone-headline-value">{headlineValue}</span>
                {dimsLine && (
                  <span className="sb-design-stone-headline-dims sb-crm-mono">{dimsLine}</span>
                )}
              </div>
            )
          })()}
          <div className="sb-design-spec-rows">
            <SpecRow label="Shape" value={shapeLabel || (order.custom_shape ? humanizeCode(order.custom_shape) : null)} />
            <SpecRow label="Granite" value={graniteLabel} />
            <SpecRow label="Polish" value={labelFor(POLISH_LABELS, order.polish_level)} />
            <SpecRow label="Top shape" value={labelFor(TOP_SHAPE_LABELS, order.top_shape)} />
            <SpecRow label="Sides" value={labelFor(SIDES_LABELS, order.sides)} />
            <SpecRow label="Dimensions" value={dimsLine} mono />
            <SpecRow label="Base" value={baseSummary} />
            <SpecRow label="Plot type" value={order.plot_type ? humanizeCode(order.plot_type) : null} />
          </div>
        </Card>

        <Card title="Missing information" span={40}>
          {missingItems.length === 0 ? (
            <div className="sb-design-missing-clear">
              <span className="sb-design-missing-clear-glyph" aria-hidden="true">✓</span>
              <span className="sb-design-missing-clear-text">All information complete.</span>
            </div>
          ) : (
            <>
              <ul className="sb-design-missing-list">
                {missingItems.map(item => (
                  <li key={item.key} className="sb-design-missing-item">
                    <span className="sb-design-missing-glyph" aria-hidden="true">▲</span>
                    <span className="sb-design-missing-label">{item.label}</span>
                  </li>
                ))}
              </ul>
              <div className="sb-design-missing-footer">
                {missingItems.length === 1
                  ? '1 item blocking design'
                  : `${missingItems.length} items blocking design`}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── ROW 2 — PROOF TIMELINE ────────────────────────────────────── */}
      <div className="sb-design-row sb-design-row-1col">
        <Card title="Proof timeline">
          <ProofTimeline milestones={milestones} />
        </Card>
      </div>

      {/* ── ROW 3 — WHAT GOES ON THE STONE ────────────────────────────── */}
      <div className="sb-design-row sb-design-row-1col">
        <Card title="What goes on the stone">
          <div className="sb-design-wgots-family">
            <div className="sb-design-wgots-family-label">Family name as engraved</div>
            <div className="sb-design-wgots-family-value">
              {inscription.familyName
                ? inscription.familyName.toUpperCase()
                : familyName
                  ? <span className="sb-design-wgots-family-value-default">
                      {familyName.toUpperCase()}
                      <span className="sb-design-wgots-default-tag"> ↳ defaults to surname</span>
                    </span>
                  : <span className="sb-design-field-missing">—</span>}
            </div>
          </div>

          <div className="sb-design-wgots-people">
            {deceased.length === 0 ? (
              <div className="sb-design-empty">No deceased on file.</div>
            ) : (
              deceased.map((d, i) => {
                const name = fullNameWithTitle(d)
                const dates = dateRangeLine(d, { longForm: true })
                const isPreNeed = !!(d.isPreNeed ?? d.is_pre_need)
                const inscriptionName = d.inscriptionName
                const noteParts = [d.relationship, d.notes].filter(Boolean).join(' — ')
                return (
                  <div key={i} className="sb-design-person-card">
                    <div className="sb-design-person-head">
                      <span className="sb-design-person-name">
                        {name || <span className="sb-design-field-missing">—</span>}
                      </span>
                      {isPreNeed && (
                        <span className="sb-design-pre-need-tag">PRE-NEED</span>
                      )}
                    </div>
                    {dates && (
                      <div className="sb-design-person-dates">{dates}</div>
                    )}
                    {inscriptionName && inscriptionName !== fullLegalName(d) && (
                      <div className="sb-design-person-inscription-name">
                        Engraved as: <strong>{inscriptionName}</strong>
                      </div>
                    )}
                    {noteParts && (
                      <div className="sb-design-person-note">{noteParts}</div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="sb-design-wgots-rows">
            <SpecRow label="Epitaph" value={inscription.epitaph} valueClassName="sb-design-epitaph" />
            <SpecRow label="Layout style" value={labelFor(LAYOUT_LABELS, inscription.layoutStyle)} />
            {/* Phase 2A.3 — Font row removed. The customFont detail (if any)
                surfaces in Special Instructions instead so it reads as
                operator-content, not fabricated form structure. */}
            <SpecRow label="Date format" value={labelFor(DATE_FORMAT_LABELS, inscription.dateFormat)} />
            <SpecRow label="Style treatment" value={labelFor(STYLE_TREATMENT_LABELS, inscription.styleTreatment)} />
            <SpecRow label="Symbols" value={symbolsValue} />
          </div>

          {/* Phase 2A.3 Fix 6 — Plot Location as possible engraving content.
              Same plot data also renders in the Cemetery + Plot card as
              address; here it surfaces as content that often gets engraved
              on the stone (see "LOCATION" placeholder in the Larsen
              approval-packet reference).
              TODO: cemetery rules upload (Phase 5+) will determine whether
              this is required — flip hint copy to "Required by cemetery
              rules" when known. */}
          {plotPositional && (
            <div className="sb-design-wgots-plot">
              <div className="sb-design-wgots-plot-label">PLOT LOCATION <span className="sb-design-wgots-plot-label-aside">(may be engraved)</span></div>
              <div className="sb-design-wgots-plot-value sb-crm-mono">{plotPositional}</div>
              <div className="sb-design-wgots-plot-hint">
                <span className="sb-design-wgots-plot-glyph" aria-hidden="true">↳</span>
                May be engraved on stone depending on cemetery requirements
              </div>
            </div>
          )}

          {/* Phase 2A.3 Fix 5 — Add-ons rendered with size/spec from the
              add_on label (SalesMode writes Photo/Vase/Laser/BLING labels
              with size baked in via " — {label} ({dim})" pattern). Notes
              when present add the operator's free-text spec line. */}
          {addOnsForWgots.length > 0 && (
            <div className="sb-design-addons">
              <div className="sb-design-addons-eyebrow">Add-ons</div>
              <ul className="sb-design-addons-list">
                {addOnsForWgots.map((a, i) => {
                  const desc = addOnDisplay(a)
                  return (
                    <li key={a.code || i} className="sb-design-addon-row">
                      <div className="sb-design-addon-line">
                        <span className="sb-design-addon-label">{desc.label}</span>
                        {desc.qty > 1 && (
                          <span className="sb-design-addon-qty">× {desc.qty}</span>
                        )}
                      </div>
                      {desc.notes && (
                        <div className="sb-design-addon-notes">"{desc.notes}"</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {hasSpecialInstructions && (
            <div className="sb-design-special-instructions">
              <div className="sb-design-special-eyebrow">Special instructions</div>
              <div className="sb-design-special-block">
                {specialInstructionParas.map((text, i) => (
                  <p key={i} className="sb-design-special-para">{text}</p>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── ROW 4 — REFERENCE & LAYOUT + CUSTOMER NOTES ────────────────── */}
      <div className="sb-design-row sb-design-row-2col-60-40">
        <Card title="Reference & layout" span={60}>
          {/* Drop zone — visual reservation only. Click + drop do nothing
              in Phase 2A.2; upload wiring lands in Phase 2B. The title
              attribute + "Phase 2B" hint label make the deferred state
              honest so the operator never thinks an upload landed silently
              (UX Friction + CRM review 2026-05-29). */}
          {/* Stage 2 Commit 1 — live upload. Click or drop a JPG/PNG layout;
              it lands in orders-attachments-public and mints the next
              proof_versions row via create_proof_version. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            style={{ display: 'none' }}
            onChange={onPickProof}
          />
          <div
            className={`sb-design-dropzone${uploading ? ' sb-design-dropzone-busy' : ''}`}
            role="button"
            aria-label="Upload layout proof (JPG or PNG)"
            aria-disabled={uploading ? 'true' : 'false'}
            tabIndex={0}
            title="Click or drop a JPG/PNG layout to upload"
            onClick={() => { if (!uploading) fileInputRef.current?.click() }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
                e.preventDefault(); fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropProof}
          >
            <div className="sb-design-dropzone-icon" aria-hidden="true">{uploading ? '⏳' : '⤓'}</div>
            <div className="sb-design-dropzone-prompt">
              {uploading ? 'Uploading layout…' : 'Drop layout here or click to upload'}
            </div>
            <div className="sb-design-dropzone-types">JPG · PNG</div>
          </div>

          {/* Upload feedback — never leave the user guessing. */}
          {upload.status === 'error' && (
            <div className="sb-design-upload-msg sb-design-upload-msg-error" role="alert">
              Upload failed — {upload.error || 'unknown error'}. Try again.
            </div>
          )}
          {upload.status === 'success' && (
            <div className="sb-design-upload-msg sb-design-upload-msg-success">
              Layout uploaded — now showing as v{currentVersion?.version_number}.
            </div>
          )}

          {/* Current version — real image + version number. */}
          {versionsLoading ? (
            <div className="sb-design-no-upload">Loading versions…</div>
          ) : currentVersion ? (
            <div className="sb-design-approved-row">
              <div className="sb-design-approved-thumb">
                <img
                  src={currentVersion.layout_image_url}
                  alt={`Layout v${currentVersion.version_number}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="sb-design-approved-info">
                <div className="sb-design-approved-label">
                  Current layout · v{currentVersion.version_number}
                </div>
                <div className="sb-design-approved-meta">
                  {currentVersion.uploaded_by ? `Uploaded by ${currentVersion.uploaded_by}` : 'Uploaded'}
                  {currentVersion.uploaded_at ? ` · ${fmtDate(currentVersion.uploaded_at)}` : ''}
                </div>
              </div>
            </div>
          ) : (
            <div className="sb-design-no-upload">No layout uploaded yet</div>
          )}

          {/* Version history — real rows from proof_versions, newest first. */}
          <div className="sb-design-versions">
            <div className="sb-design-versions-eyebrow">Version history</div>
            {versions.length === 0 ? (
              <div className="sb-design-versions-empty">
                No versions yet — uploads will appear here.
              </div>
            ) : (
              <ul className="sb-design-versions-list">
                {versions.map(v => (
                  <li key={v.id} className="sb-design-version-row">
                    <a
                      href={v.layout_image_url}
                      target="_blank"
                      rel="noreferrer"
                      className="sb-design-version-num"
                    >
                      v{v.version_number}
                    </a>
                    {v.is_current && <span className="sb-design-version-current">Current</span>}
                    <span className="sb-design-version-meta">
                      {v.uploaded_by || 'Staff'}
                      {v.uploaded_at ? ` · ${fmtDate(v.uploaded_at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Reference photos — Phase 2A.3 Fix 4 wires REAL content from two
              sources already on the order substrate (no new fetch):
                (A) order.designs[] — catalog selections (primary + alts)
                    with snapshot.img (Google Drive thumb-rewritten URL)
                (B) inscription.preExistingPhotoUrl — Supabase Storage URL
                    for the "photo of existing marker to match" upload
              Phase 2B will broaden source (B) once orders-attachments
              tagging lands. Each item renders as a labeled thumbnail; if
              the snapshot lacks .img the role badge + cleaned ID still
              identifies the design selection. */}
          <div className="sb-design-refs">
            <div className="sb-design-refs-eyebrow">Reference photos</div>
            {referenceItems.length === 0 ? (
              <div className="sb-design-refs-empty">
                No design selections or reference photos yet.
              </div>
            ) : (
              <div className="sb-design-refs-strip">
                {referenceItems.map(item => (
                  <div key={item.key} className="sb-design-ref-tile">
                    <div className="sb-design-ref-thumb">
                      {item.img ? (
                        <img
                          src={item.img}
                          alt={item.label}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="sb-design-ref-thumb-glyph" aria-hidden="true">
                          {item.kind === 'design' ? '🪨' : '📷'}
                        </span>
                      )}
                      {item.role && (
                        <span className={`sb-design-ref-role sb-design-ref-role-${item.role === 'PRIMARY' ? 'primary' : 'alt'}`}>
                          {item.role}
                        </span>
                      )}
                    </div>
                    <div className="sb-design-ref-info">
                      <div className="sb-design-ref-label">{item.label}</div>
                      {item.id && item.id !== item.label && (
                        <div className="sb-design-ref-id sb-crm-mono">{item.id}</div>
                      )}
                      {item.tags && item.tags.length > 0 && (
                        <div className="sb-design-ref-tags">
                          {item.tags.map((t, i) => (
                            <span key={i} className="sb-design-ref-tag">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* TODO Phase 2B: broaden source (B) to all orders-attachments
                tagged 'reference' once the storage-tag system lands. */}
          </div>
          {/* TODO Phase 5: "Draft approval email" button — appears here once a
              layout has been uploaded. Pre-fills the family + order + approval
              link from the latest version. */}
        </Card>

        <Card title="Customer notes" span={40}>
          {(order.design_preferences || inscription.customNotes) ? (
            <div className="sb-design-quote">
              <div className="sb-design-quote-eyebrow">From intake</div>
              <div className="sb-design-quote-body">
                {order.design_preferences && <p>{order.design_preferences}</p>}
                {inscription.customNotes && <p>{inscription.customNotes}</p>}
              </div>
            </div>
          ) : (
            <div className="sb-design-empty">No customer notes captured at intake.</div>
          )}

          {(cemetery?.notes || cemetery?.rules_notes) && (
            <div className="sb-design-cemetery-rule">
              <div className="sb-design-cemetery-rule-eyebrow">Cemetery restriction</div>
              <div className="sb-design-cemetery-rule-body">
                {cemetery.notes || cemetery.rules_notes}
              </div>
            </div>
          )}

          {/* Customer approval status — REAL state from milestones. */}
          <div className="sb-design-approval-block">
            <div className="sb-design-approval-eyebrow">Customer approval</div>
            <div className={`sb-design-approval-state sb-design-approval-state-${proofSummary.tone}`}>
              {proofSummary.text}
              {proofSummary.detail && (
                <span className="sb-design-approval-detail"> · {proofSummary.detail}</span>
              )}
            </div>
          </div>
          {/* TODO Phase 5: "Send to customer" button — appears here once a
              layout has been uploaded and approval is not yet recorded. */}
          {/* TODO Phase 5: customer email composer modal — opens when either
              the "Draft approval email" or "Send to customer" button is
              clicked. Pre-fills family name, order number, and the latest
              version download link. */}
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// SpecRow — small label-value row used inside cards
// ============================================================================
function SpecRow({ label, value, mono = false, valueClassName = '' }) {
  const isMissing = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className="sb-design-spec-row">
      <div className="sb-design-spec-label">{label}</div>
      <div className={[
        'sb-design-spec-value',
        mono && 'sb-crm-mono sb-crm-tabular',
        isMissing && 'sb-design-field-missing',
        valueClassName,
      ].filter(Boolean).join(' ')}>
        {isMissing ? '—' : value}
      </div>
    </div>
  )
}

// Tiny helper — milestone is "advanced" if status is in_progress or done.
function isAdvanced(m) {
  return m && (m.status === 'in_progress' || m.status === 'done')
}

// =============================================================================
// STYLES
// =============================================================================
// Studio surface — cream canvas, white cards, bronze accents. All tokens
// pull from the existing crmTheme.js dictionary so the visual remains
// aligned with Today / Customers / Orders. Hex literals are used for the
// new bronze accent (#9A7209) + cream canvas (#F7F6F3) per Phase 2A.2 spec.

const localStyles = `
  /* ── PAGE FRAME ──────────────────────────────────────────────────────── */
  .sb-design-packet-page {
    width: 100%;
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px 64px;
    background: transparent;
  }

  /* ── TOP BAR ─────────────────────────────────────────────────────────── */
  .sb-design-topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 18px 0 24px;
    gap: 16px;
  }
  .sb-design-topbar-back {
    justify-self: start;
    background: transparent;
    border: none;
    font: inherit;
    font-size: 14px;
    color: var(--sb-text-muted);
    cursor: pointer;
    padding: 6px 2px;
    transition: color 0.12s;
  }
  .sb-design-topbar-back:hover {
    color: #9A7209;
  }
  .sb-design-topbar-tabs {
    justify-self: center;
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-design-topbar-tab {
    background: transparent;
    border: none;
    font: inherit;
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 6px 16px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-design-topbar-tab:hover {
    color: var(--sb-text);
  }
  .sb-design-topbar-tab-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15,20,25,0.06);
  }
  .sb-design-topbar-print {
    justify-self: end;
    background: transparent;
    border: none;
    font: inherit;
    font-size: 14px;
    color: var(--sb-text-muted);
    cursor: pointer;
    padding: 6px 2px;
    transition: color 0.12s;
  }
  .sb-design-topbar-print:hover {
    color: #9A7209;
  }

  /* ── HERO CARD ───────────────────────────────────────────────────────── */
  .sb-design-hero-card {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 32px;
    background: #fff;
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.06);
    margin-bottom: 20px;
  }
  .sb-design-hero-left { min-width: 0; }
  .sb-design-hero-family {
    margin: 0 0 12px;
    font-size: 36px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #111;
    line-height: 1.05;
    text-transform: uppercase;
  }
  .sb-design-hero-deceased {
    font-size: 18px;
    color: var(--sb-text-muted);
    margin-bottom: 14px;
    line-height: 1.4;
  }
  .sb-design-hero-dates {
    color: var(--sb-text-muted);
  }
  .sb-design-hero-sep {
    color: var(--sb-text-muted);
  }
  .sb-design-hero-meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: 8px;
    row-gap: 4px;
    font-size: 13px;
    color: var(--sb-text-muted);
  }
  .sb-design-hero-meta-item { white-space: nowrap; }
  .sb-design-hero-meta-sep { color: var(--sb-border); }
  .sb-design-hero-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    text-align: right;
  }
  .sb-design-status-badge {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--sb-surface-muted);
    color: var(--sb-text);
  }
  .sb-design-status-badge-good  { background: rgba(56,122,79,0.12);  color: #38704f; }
  .sb-design-status-badge-wait  { background: rgba(154,114, 9,0.12); color: #9A7209; }
  .sb-design-status-badge-ready { background: rgba(154,114, 9,0.12); color: #9A7209; }
  .sb-design-status-badge-todo  { background: var(--sb-surface-muted); color: var(--sb-text-muted); }
  .sb-design-status-detail {
    font-size: 13px;
    color: var(--sb-text-muted);
  }
  .sb-design-rush-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #fff;
    background: var(--sb-red, #b54040);
    padding: 3px 10px;
    border-radius: 3px;
  }
  .sb-design-deadline {
    font-size: 12px;
    color: var(--sb-text-muted);
  }
  .sb-design-deadline strong {
    color: var(--sb-text);
    font-weight: 500;
  }

  /* ── ROW + CARD LAYOUT ───────────────────────────────────────────────── */
  .sb-design-row {
    display: grid;
    gap: 16px;
    margin-bottom: 16px;
  }
  .sb-design-row-1col { grid-template-columns: 1fr; }
  .sb-design-row-2col-60-40 { grid-template-columns: 60fr 40fr; }
  @media (max-width: 960px) {
    .sb-design-row-2col-60-40 { grid-template-columns: 1fr; }
  }

  .sb-design-card {
    background: #fff;
    border-radius: 12px;
    padding: 28px;
    box-shadow: 0 1px 2px rgba(15,20,25,0.03), 0 4px 16px rgba(15,20,25,0.05);
  }
  .sb-design-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .sb-design-card-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #666;
  }
  .sb-design-card-eyebrow-right {
    font-size: 12px;
    color: var(--sb-text-muted);
  }

  /* ── STONE SPEC HEADLINE (Phase 2A.3 — replaces silhouette) ──────────────
     The silhouette was misleading; the architect-style headline + spec rows
     read as the actual operational spec. DIE label echoes the bottom-strip
     metadata format in the real Larsen approval packet. */
  .sb-design-stone-headline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 14px;
    padding: 10px 12px;
    background: var(--sb-surface-muted);
    border-left: 3px solid #9A7209;
    border-radius: 4px;
  }
  .sb-design-stone-headline-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2em;
    color: #9A7209;
    text-transform: uppercase;
  }
  .sb-design-stone-headline-value {
    font-size: 16px;
    font-weight: 600;
    color: #111;
  }
  .sb-design-stone-headline-dims {
    font-size: 13px;
    color: var(--sb-text-muted);
    margin-left: auto;
  }

  /* ── SPEC ROWS (used in stone-spec card + WGOTS card) ─────────────────── */
  .sb-design-spec-rows {
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-spec-row {
    display: grid;
    grid-template-columns: 130px 1fr;
    column-gap: 16px;
    padding: 10px 0;
    border-bottom: 0.5px solid #f1ede5;
  }
  .sb-design-spec-row:last-child { border-bottom: none; }
  .sb-design-spec-label {
    font-size: 13px;
    font-weight: 500;
    color: #666;
  }
  .sb-design-spec-value {
    font-size: 14px;
    font-weight: 500;
    color: #111;
    word-break: break-word;
  }

  /* ── MISSING-INFO CARD ──────────────────────────────────────────────── */
  .sb-design-missing-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sb-design-missing-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 0.5px solid #f1ede5;
  }
  .sb-design-missing-item:last-child { border-bottom: none; }
  .sb-design-missing-glyph {
    color: #9A7209;
    font-size: 10px;
    line-height: 1.7;
    padding-top: 2px;
  }
  .sb-design-missing-label {
    font-size: 14px;
    color: #111;
  }
  .sb-design-missing-footer {
    margin-top: 12px;
    font-size: 13px;
    color: var(--sb-text-muted);
  }
  .sb-design-missing-clear {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 0;
  }
  .sb-design-missing-clear-glyph {
    font-size: 22px;
    color: #38704f;
  }
  .sb-design-missing-clear-text {
    font-size: 14px;
    color: var(--sb-text);
  }

  /* ── PROOF TIMELINE ─────────────────────────────────────────────────── */
  .sb-design-proof-timeline { padding: 8px 8px 4px; }
  .sb-design-proof-track {
    position: relative;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: start;
  }
  .sb-design-proof-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    position: relative;
  }
  .sb-design-proof-dot {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1.5px solid var(--sb-border);
    background: #fff;
    z-index: 2;
  }
  .sb-design-proof-node-done .sb-design-proof-dot {
    background: #9A7209;
    border-color: #9A7209;
  }
  .sb-design-proof-node-active .sb-design-proof-dot {
    background: #fff;
    border-color: #9A7209;
    box-shadow: 0 0 0 4px rgba(154,114,9,0.18);
  }
  .sb-design-proof-node-dim .sb-design-proof-dot {
    opacity: 0.4;
  }
  .sb-design-proof-label {
    font-size: 11px;
    font-weight: 500;
    color: #111;
    letter-spacing: 0.02em;
  }
  .sb-design-proof-node-dim .sb-design-proof-label {
    color: var(--sb-text-muted);
  }
  .sb-design-proof-date {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-design-proof-node-active .sb-design-proof-date {
    color: #9A7209;
    font-weight: 500;
  }
  .sb-design-proof-lines {
    position: absolute;
    top: 6px;
    left: 0;
    right: 0;
    height: 2px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 0 10%;
    column-gap: 8px;
    pointer-events: none;
  }
  .sb-design-proof-line {
    height: 1px;
    background: var(--sb-border);
    align-self: center;
  }
  .sb-design-proof-line-done {
    background: #9A7209;
  }

  /* ── WGOTS — WHAT GOES ON THE STONE ──────────────────────────────────── */
  .sb-design-wgots-family {
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-design-wgots-family-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #666;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .sb-design-wgots-family-value {
    font-size: 24px;
    font-weight: 600;
    color: #111;
    letter-spacing: 0.04em;
  }
  .sb-design-wgots-family-value-default {
    color: var(--sb-text-muted);
  }
  .sb-design-wgots-default {
    color: var(--sb-text);
  }
  .sb-design-wgots-default-tag {
    color: var(--sb-text-muted);
    font-style: italic;
    font-size: 13px;
    font-weight: 400;
  }

  .sb-design-wgots-people {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 18px;
  }
  .sb-design-person-card {
    border: 0.5px solid var(--sb-border);
    border-radius: 8px;
    padding: 16px;
    background: #fafaf7;
  }
  .sb-design-person-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .sb-design-person-name {
    font-size: 18px;
    font-weight: 600;
    color: #111;
  }
  .sb-design-pre-need-tag {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #9A7209;
    border: 1px solid #9A7209;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .sb-design-person-dates {
    font-size: 15px;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
  }
  .sb-design-person-inscription-name {
    font-size: 13px;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
  }
  .sb-design-person-inscription-name strong {
    color: var(--sb-text);
    font-weight: 500;
  }
  .sb-design-person-note {
    font-size: 15px;
    font-style: italic;
    color: var(--sb-text-muted);
    line-height: 1.55;
  }

  .sb-design-wgots-rows {
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-epitaph {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 16px;
    font-style: italic;
    line-height: 1.5;
  }

  /* ── SPECIAL INSTRUCTIONS BLOCK ─────────────────────────────────────── */
  .sb-design-special-instructions {
    margin-top: 18px;
  }
  .sb-design-special-eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #666;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .sb-design-special-block {
    border-left: 3px solid #9A7209;
    padding: 12px 16px;
    background: rgba(154,114,9,0.04);
    border-radius: 0 6px 6px 0;
  }
  .sb-design-special-para {
    margin: 0 0 8px;
    font-size: 15px;
    color: #111;
    line-height: 1.55;
  }
  .sb-design-special-para:last-child { margin-bottom: 0; }

  /* ── REFERENCE & LAYOUT CARD ─────────────────────────────────────────── */
  .sb-design-dropzone {
    border: 2px dashed #9A7209;
    border-radius: 12px;
    background: rgba(154,114,9,0.03);
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    transition: background 0.12s;
    margin-bottom: 16px;
    min-height: 200px;
    justify-content: center;
  }
  .sb-design-dropzone:hover {
    background: rgba(154,114,9,0.06);
  }
  .sb-design-dropzone:focus-visible {
    outline: 2px solid #9A7209;
    outline-offset: 4px;
  }
  .sb-design-dropzone-icon {
    font-size: 28px;
    color: #9A7209;
  }
  .sb-design-dropzone-prompt {
    font-size: 14px;
    font-weight: 500;
    color: #111;
  }
  .sb-design-dropzone-types {
    font-size: 12px;
    color: var(--sb-text-muted);
    letter-spacing: 0.04em;
  }
  .sb-design-dropzone-phase {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: #9A7209;
    margin-top: 4px;
    text-transform: uppercase;
  }
  /* Subtle desaturation on the deferred drop zone so the operator's eye
     registers it as "reserved-for-later" without losing the visual
     anchor. cursor: default removes the pointer signal that would
     promise click-handling. */
  .sb-design-dropzone-pending {
    cursor: default;
    opacity: 0.95;
  }
  .sb-design-no-upload {
    font-size: 14px;
    color: var(--sb-text-muted);
    text-align: center;
    padding: 8px 0 16px;
  }
  .sb-design-approved-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 0 16px;
    border-bottom: 0.5px solid var(--sb-border);
    margin-bottom: 16px;
  }
  .sb-design-approved-thumb {
    width: 120px;
    height: 120px;
    border-radius: 8px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .sb-design-approved-thumb-glyph {
    font-size: 32px;
    opacity: 0.4;
  }
  .sb-design-approved-label {
    font-size: 14px;
    font-weight: 600;
    color: #111;
    margin-bottom: 4px;
  }
  .sb-design-approved-meta {
    font-size: 12px;
    color: var(--sb-text-muted);
  }
  .sb-design-versions {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-versions-eyebrow,
  .sb-design-refs-eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #666;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .sb-design-versions-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  /* Stage 2 Commit 1 — live upload states + real version rendering. */
  .sb-design-dropzone-busy {
    cursor: progress;
    opacity: 0.7;
    background: rgba(154,114,9,0.06);
  }
  .sb-design-approved-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }
  .sb-design-upload-msg {
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .sb-design-upload-msg-error {
    color: #b3261e;
    background: rgba(179,38,30,0.06);
    border: 0.5px solid rgba(179,38,30,0.3);
  }
  .sb-design-upload-msg-success {
    color: #1f7a3d;
    background: rgba(31,122,61,0.06);
    border: 0.5px solid rgba(31,122,61,0.3);
  }
  .sb-design-versions-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sb-design-version-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
  }
  .sb-design-version-num {
    font-weight: 600;
    color: #9A7209;
    text-decoration: none;
  }
  .sb-design-version-num:hover { text-decoration: underline; }
  .sb-design-version-current {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: #1f7a3d;
    background: rgba(31,122,61,0.08);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .sb-design-version-meta {
    color: var(--sb-text-muted);
    font-size: 12px;
  }
  .sb-design-refs {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-refs-strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
  .sb-design-refs-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
    padding: 8px 0;
  }
  .sb-design-ref-tile {
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .sb-design-ref-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    background: #f0ece4;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .sb-design-ref-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .sb-design-ref-thumb-glyph {
    font-size: 36px;
    opacity: 0.5;
  }
  .sb-design-ref-role {
    position: absolute;
    top: 6px;
    left: 6px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .sb-design-ref-role-primary {
    background: #9A7209;
    color: #fff;
  }
  .sb-design-ref-role-alt {
    background: rgba(15,20,25,0.7);
    color: #fff;
  }
  .sb-design-ref-info {
    padding: 8px 10px 10px;
  }
  .sb-design-ref-label {
    font-size: 13px;
    font-weight: 500;
    color: #111;
    line-height: 1.3;
    margin-bottom: 2px;
  }
  .sb-design-ref-id {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-bottom: 4px;
  }
  .sb-design-ref-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sb-design-ref-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-muted);
  }

  /* ── WGOTS PLOT LOCATION (Phase 2A.3 Fix 6) ──────────────────────────── */
  .sb-design-wgots-plot {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-wgots-plot-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 6px;
  }
  .sb-design-wgots-plot-label-aside {
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--sb-text-muted);
    text-transform: none;
  }
  .sb-design-wgots-plot-value {
    font-size: 15px;
    color: #111;
    line-height: 1.4;
    margin-bottom: 6px;
  }
  .sb-design-wgots-plot-hint {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
    line-height: 1.4;
  }
  .sb-design-wgots-plot-glyph {
    color: #9A7209;
    margin-right: 4px;
    font-style: normal;
  }

  /* ── WGOTS ADD-ONS (Phase 2A.3 Fix 5) ────────────────────────────────── */
  .sb-design-addons {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-addons-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 8px;
  }
  .sb-design-addons-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sb-design-addon-row {
    padding: 8px 0;
    border-bottom: 0.5px solid #f1ede5;
  }
  .sb-design-addon-row:last-child { border-bottom: none; }
  .sb-design-addon-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sb-design-addon-label {
    font-size: 14px;
    color: #111;
    font-weight: 500;
  }
  .sb-design-addon-qty {
    font-size: 13px;
    color: var(--sb-text-muted);
  }
  .sb-design-addon-notes {
    font-size: 13px;
    color: var(--sb-text-muted);
    font-style: italic;
    margin-top: 2px;
    line-height: 1.45;
  }

  /* ── CUSTOMER NOTES CARD ─────────────────────────────────────────────── */
  .sb-design-quote {
    margin-bottom: 18px;
  }
  .sb-design-quote-eyebrow,
  .sb-design-cemetery-rule-eyebrow,
  .sb-design-approval-eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #666;
    margin-bottom: 8px;
    font-weight: 500;
  }
  .sb-design-quote-body {
    border-left: 3px solid #9A7209;
    padding: 4px 16px;
  }
  .sb-design-quote-body p {
    margin: 0 0 8px;
    font-size: 15px;
    line-height: 1.55;
    color: #111;
  }
  .sb-design-quote-body p:last-child { margin-bottom: 0; }
  .sb-design-cemetery-rule {
    margin-bottom: 18px;
  }
  .sb-design-cemetery-rule-body {
    border-left: 3px solid #9A7209;
    padding: 4px 16px;
    font-size: 14px;
    color: #111;
    line-height: 1.55;
  }
  .sb-design-approval-block {
    padding-top: 14px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-design-approval-state {
    font-size: 14px;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--sb-surface-muted);
    color: var(--sb-text);
  }
  .sb-design-approval-state-good  { background: rgba(56,122,79,0.10); color: #38704f; }
  .sb-design-approval-state-wait  { background: rgba(154,114,9,0.10); color: #9A7209; }
  .sb-design-approval-state-ready { background: rgba(154,114,9,0.10); color: #9A7209; }
  .sb-design-approval-detail {
    color: var(--sb-text-muted);
    font-weight: 400;
  }

  /* ── COMMON ──────────────────────────────────────────────────────────── */
  .sb-design-field-missing {
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-design-empty {
    font-size: 14px;
    color: var(--sb-text-muted);
    font-style: italic;
    padding: 4px 0;
  }

  /* ── RESPONSIVE ──────────────────────────────────────────────────────── */
  @media (max-width: 720px) {
    .sb-design-packet-page { padding: 0 16px 48px; }
    .sb-design-hero-card {
      grid-template-columns: 1fr;
      gap: 16px;
      padding: 20px;
    }
    .sb-design-hero-right { align-items: flex-start; text-align: left; }
    .sb-design-hero-family { font-size: 28px; }
    .sb-design-card { padding: 20px; }
    .sb-design-proof-track {
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
    }
    .sb-design-proof-label { font-size: 10px; }
    .sb-design-spec-row {
      grid-template-columns: 1fr;
      row-gap: 2px;
    }
  }

  /* ── PRINT ───────────────────────────────────────────────────────────── */
  @media print {
    body { background: #fff; }
    .sb-job-promise-strip,
    .sb-job-hero,
    .sb-job-detail-tabs,
    .sb-print-hide {
      display: none !important;
    }
    .sb-design-packet-page {
      padding: 0;
      max-width: none;
    }
    .sb-design-card,
    .sb-design-hero-card {
      box-shadow: none;
      border: 0.5px solid #ddd;
      page-break-inside: avoid;
    }
    .sb-design-status-badge-good  { background: #eee; color: #000; }
    .sb-design-status-badge-wait  { background: #eee; color: #555; }
    .sb-design-status-badge-ready { background: #eee; color: #555; }
    .sb-design-status-badge-todo  { background: #f5f5f5; color: #555; }
    .sb-design-missing-glyph,
    .sb-design-proof-node-done .sb-design-proof-dot,
    .sb-design-proof-node-active .sb-design-proof-dot {
      color: #000;
      background: #000;
      border-color: #000;
    }
    .sb-design-rush-tag { background: #000; color: #fff; }
    .sb-design-special-block,
    .sb-design-quote-body,
    .sb-design-cemetery-rule-body {
      border-left-color: #000;
      background: transparent;
    }
    .sb-design-dropzone { border-color: #999; background: transparent; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-design-packet-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-design-packet-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
