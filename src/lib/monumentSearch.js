// =============================================================================
// monumentSearch.js — what catalog search is allowed to match (Paul, 2026-07-20)
// =============================================================================
// "When I search 'heart', 'Forever In Our Hearts' shows up everywhere even
// though there's no heart in it. I always want to search by last name; I never
// want to search by epitaph or verse."
//
// The monuments data mixes DESIGN ELEMENTS ("Heart", "Interlocking Hearts",
// "Doves", "Sacred Heart of Jesus") and EPITAPH/VERSE phrases ("Forever In
// Our Hearts", "Beloved Dad", "Always And Forever") in the SAME tags array —
// and descriptions are marketing prose ("a clean, heartfelt design…"). Rather
// than hand-reviewing ~1,600 rows, search-time classification: a tag is
// VERSE-like when it carries sentiment/epitaph words; design-element tags are
// noun phrases and never do. Validated against the full live tag population
// (2026-07-20): scripture refs, military units, emblems ("Our Lady of
// Guadalupe", "Knights of Columbus", "Sacred Heart of Jesus") all correctly
// stay searchable; "Always In Our Hearts" / "Beloved …" / "65 Years of Love"
// are correctly treated as verse.
//
// Descriptions are NEVER searched. Lastname is ALWAYS searched. If a tag
// misclassifies, tune the token lists here — every catalog surface (Catalog
// tab, /field CatalogScreen, the sales wizard's Design step) imports this.

const VERSE_TOKENS = new RegExp(
  '\\b(' + [
    'forever', 'always', 'loving', 'loved?', 'memory', 'memories', 'beloved',
    'missed', 'forgotten', 'gone', 'cherish(?:ed)?', 'remember(?:ed)?',
    'remembrance', 'until', 'reunited', 'eternity', 'eternal', 'thoughts',
    'dearly', 'sadly', 'everything',
  ].join('|') + ')\\b', 'i')

const VERSE_PHRASES = new RegExp(
  '\\b(' + [
    'in our', 'in my', "in god'?s", 'in his', 'in her', 'in loving',
    'rest in', 'with the lord', 'of love', "you'?re my", 'well lived',
  ].join('|') + ')\\b', 'i')

export function isVerseTag(tag) {
  const t = String(tag || '')
  return VERSE_TOKENS.test(t) || VERSE_PHRASES.test(t)
}

// The searchable subset of a monument's tags — design elements only.
export function designTags(tags) {
  return (tags || []).filter(t => t && !isVerseTag(t))
}

// ── "All" must actually look like all (Paul, 2026-07-20) ─────────────────────
// The catalog's storage order is A-series-first, and the A-series photos are
// nearly all slant markers — so any capped "All" list (first 36/40 shown)
// reads as "it only searched slants". Round-robin across shapes so the first
// screenful is genuinely mixed, and when there's a search, families whose
// LASTNAME matches outrank element-only matches (lastname search is the
// primary use). Deterministic — no randomness (React render purity).

const SHAPE_ORDER = ['slant', 'double-slant', 'upright-single', 'upright-double', 'flat', 'custom-shape']

function shapeOf(m) {
  const cats = m?.cats || []
  for (const s of SHAPE_ORDER) if (cats.includes(s)) return s
  return 'other'
}

// Stable round-robin: one of each shape in turn until every bucket drains.
export function diversifyByShape(list) {
  const buckets = new Map()
  for (const m of (list || [])) {
    const s = shapeOf(m)
    if (!buckets.has(s)) buckets.set(s, [])
    buckets.get(s).push(m)
  }
  if (buckets.size <= 1) return [...(list || [])]
  const order = [...SHAPE_ORDER, 'other'].filter(s => buckets.has(s))
  const out = []
  let i = 0
  while (out.length < (list || []).length) {
    const b = buckets.get(order[i % order.length])
    if (b.length) out.push(b.shift())
    i++
  }
  return out
}

// Rank search hits (lastname prefix > lastname contains > element/other match),
// then shape-mix WITHIN each rank so no band is all slants. Empty needle =
// plain shape mix.
export function rankDiversify(list, needle) {
  const q = String(needle || '').trim().toLowerCase()
  if (!q) return diversifyByShape(list)
  const bands = [[], [], []]
  for (const m of (list || [])) {
    const ln = String(m.lastname || '').toLowerCase()
    bands[ln.startsWith(q) ? 0 : ln.includes(q) ? 1 : 2].push(m)
  }
  return bands.flatMap(diversifyByShape)
}
