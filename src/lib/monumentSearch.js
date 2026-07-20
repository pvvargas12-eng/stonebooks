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
