// =============================================================================
// SalesMode.jsx — Sprint 1
// Shevchenko Monuments Sales Portal · Inline wizard
//
// Sprint 1 covers:
//   ① Service Type (multi-select with workflow branching)
//   ② Customer (search Supabase + create new)
//   ③ Cemetery + Plot (search + create + Google Maps pin)
//   ④ Memorial / Deceased (one or many; pre-need supported)
//   + Save & resume to Supabase
//   + Customer Mode / Staff Mode toggle
//   + Internal staff notes thread
//
// Sprint 2 will add: Shape → Color → Size → Design → Inscription → Live preview
// Sprint 3 will add: Add-ons → Pricing → Estimate → Contract → Signature
// Sprint 4 will add: Other service-type branches (FULL_INSC, ACID_WASH, etc.)
// =============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase'

// =============================================================================
// STATIC DATA
// =============================================================================

// ---- Service Types (multi-select; drives wizard branching) -----------------
const SERVICE_TYPES = [
  {
    code: 'NEW_STONE',
    label: 'New Stone',
    blurb: 'A new monument. Full design from shape and granite to inscription.',
    icon: '🪨',
    needsStoneConfig: true,
    needsExistingStone: false,
  },
  {
    code: 'BRONZE',
    label: 'Bronze',
    blurb: 'Bronze plaque. Often paired with a granite base or installed flush.',
    icon: '🟫',
    needsStoneConfig: true,
    needsExistingStone: false,
  },
  {
    code: 'INSCRIPTION',
    label: 'Inscription',
    blurb: 'Add an inscription to an existing stone — full, date, or year-only. Type confirmed later.',
    icon: '✒️',
    needsStoneConfig: false,
    needsExistingStone: true,
  },
  {
    code: 'ACID_WASH',
    label: 'Acid Wash',
    blurb: 'Clean and restore an existing stone. Stone type informs labor.',
    icon: '🧴',
    needsStoneConfig: false,
    needsExistingStone: true,
  },
  {
    code: 'REPAIR',
    label: 'Repair',
    blurb: 'Repair an existing stone. Custom-priced based on assessment.',
    icon: '🔧',
    needsStoneConfig: false,
    needsExistingStone: true,
  },
  {
    code: 'ADD_PHOTO',
    label: 'Add Photo',
    blurb: 'Add a porcelain or stainless photo to an existing stone.',
    icon: '🖼',
    needsStoneConfig: false,
    needsExistingStone: true,
  },
  {
    code: 'CIVIC_MEMORIAL',
    label: 'Civic Memorial',
    blurb: 'Municipality, veterans, or religious monument. Subtype confirmed later.',
    icon: '🏛',
    needsStoneConfig: true,
    needsExistingStone: false,
  },
  {
    code: 'MAUSOLEUM',
    label: 'Mausoleum',
    blurb: 'Mausoleum or large family memorial structure.',
    icon: '⛪',
    needsStoneConfig: true,
    needsExistingStone: false,
  },
  {
    code: 'OTHER',
    label: 'Other',
    blurb: 'Anything else — describe the job below.',
    icon: '✦',
    needsStoneConfig: false,
    needsExistingStone: false,
    requiresDescription: true,
  },
]

// ---- Plot types ------------------------------------------------------------
const PLOT_TYPES = [
  { code: 'single', label: 'Single',         blurb: 'One plot.' },
  { code: 'double', label: 'Double',         blurb: 'Two plots side by side.' },
  { code: 'sxs',    label: 'Side by Side',   blurb: 'Two caskets, side by side.' },
  { code: 'dd',     label: 'Double Deep',    blurb: 'Two caskets, stacked.' },
  { code: 'family', label: 'Family Plot',    blurb: 'Multi-grave family plot.' },
]

// ---- Family types (drives memorial layout & pricing in later sprints) ------
const FAMILY_TYPES = [
  { code: 'single',     label: 'Single',     blurb: 'One person memorialized.' },
  { code: 'companion',  label: 'Companion',  blurb: 'Spouses or partners on one stone.' },
  { code: 'family',     label: 'Family',     blurb: 'Multiple family members on one stone.' },
  { code: 'cremation',  label: 'Cremation',  blurb: 'Cremation memorial or urn marker.' },
  { code: 'infant',     label: 'Infant / Child', blurb: 'Memorial for a child or infant.' },
  { code: 'pet',        label: 'Pet',        blurb: 'Pet memorial.' },
  { code: 'civic',      label: 'Civic Memorial', blurb: 'Public or institutional monument.' },
  { code: 'bench',      label: 'Bench',      blurb: 'Bench-style memorial.' },
]

// ---- Title prefixes (English first, then Spanish) -------------------------
const TITLE_PREFIXES = [
  // English
  'Beloved', 'Loving', 'Cherished', 'Devoted',
  'Our', 'Our Loving', 'Our Beloved', 'Our Dear',
  'Forever', 'In Memory of', 'In Loving Memory of',
  // Spanish
  'Amado', 'Amada',
  'Querido', 'Querida',
  'Nuestro', 'Nuestra',
  'En Memoria de', 'En Amorosa Memoria de',
]

// ---- Title relations (English first, then Spanish) -----------------------
const TITLE_RELATIONS = [
  // English
  'Father', 'Mother', 'Husband', 'Wife',
  'Son', 'Daughter', 'Brother', 'Sister',
  'Grandfather', 'Grandmother',
  'Uncle', 'Aunt', 'Cousin', 'Nephew', 'Niece',
  'Friend', 'Hero', 'Angel',
  'Parents', 'Grandparents', 'Couple',
  // Spanish
  'Padre', 'Madre', 'Esposo', 'Esposa',
  'Hijo', 'Hija', 'Hermano', 'Hermana',
  'Abuelo', 'Abuela',
  'Tío', 'Tía', 'Primo', 'Prima', 'Sobrino', 'Sobrina',
  'Amigo', 'Amiga', 'Héroe', 'Ángel',
  'Padres', 'Abuelos',
]

// ---- Relationship-to-customer options --------------------------------------
const RELATIONSHIPS = [
  'Father', 'Mother', 'Spouse', 'Husband', 'Wife',
  'Son', 'Daughter', 'Brother', 'Sister',
  'Grandfather', 'Grandmother', 'Uncle', 'Aunt',
  'Friend', 'Self (pre-need)', 'Other',
]

// ---- Sales reps in user's specified frequency order ------------------------
const SALES_REPS = ['Lonnie', 'Cathy', 'Denise', 'Chelsea', 'Sabina', 'Alex', 'Paul', 'Stephen', 'Collin']

// "How did you hear about us?" — used on the Customer step. Add/remove
// freely; the codes are stored on the customer record so reporting can
// later answer "where do most leads come from?"
const REFERRAL_SOURCES = [
  { code: 'google',         label: 'Google search' },
  { code: 'friend',         label: 'Friend / family referral' },
  { code: 'returning',      label: 'Returning customer' },
  { code: 'funeral-home',   label: 'Funeral home referral' },
  { code: 'cemetery',       label: 'Cemetery referral' },
  { code: 'social-media',   label: 'Social media (Facebook, Instagram, etc.)' },
  { code: 'drive-by',       label: 'Saw the shop / drove by' },
  { code: 'church',         label: 'Church / religious community' },
  { code: 'newspaper',      label: 'Newspaper / print ad' },
  { code: 'yellow-pages',   label: 'Yellow pages / directory' },
  { code: 'other',          label: 'Other (describe below)' },
]

// Production timelines + rush fees per service type (Sprint 3i).
// Keyed by service code. `rushFee: null` means rush isn't offered for
// that service. `rushTime: null` for monuments means "case-by-case —
// rep enters target date manually".
const SERVICE_TIMELINES = {
  NEW_STONE:      { standardTime: '3–6 months',     rushTime: null,         rushFee: 500, label: 'Monument' },
  BRONZE:         { standardTime: '3–6 months',     rushTime: null,         rushFee: 500, label: 'Bronze' },
  CIVIC_MEMORIAL: { standardTime: '3–6 months',     rushTime: null,         rushFee: 500, label: 'Civic memorial' },
  MAUSOLEUM:      { standardTime: '6–9 months (large) / 3–6 months', rushTime: null, rushFee: null, label: 'Mausoleum', custom: true },
  INSCRIPTION:    { standardTime: '4–6 weeks',      rushTime: 'within 2 weeks', rushFee: 300, label: 'Inscription' },
  ACID_WASH:      { standardTime: '3 weeks',        rushTime: 'within 2 weeks', rushFee: 300, label: 'Acid wash' },
  REPAIR:         { standardTime: '4 weeks',        rushTime: 'within 2 weeks', rushFee: 300, label: 'Repair' },
  ADD_PHOTO:      { standardTime: '4–6 weeks',      rushTime: 'within 2 weeks', rushFee: 300, label: 'Add photo' },
  OTHER:          { standardTime: 'custom',         rushTime: null,         rushFee: null, label: 'Other', custom: true },
}

// Optional cancel-reason dropdown — used when an order is moved to "cancelled".
const CANCEL_REASONS = [
  { code: 'cemetery-direct',   label: 'Went with cemetery direct' },
  { code: 'competitor',        label: 'Went with another company' },
  { code: 'family-changed',    label: 'Family changed mind' },
  { code: 'price',             label: 'Price too high' },
  { code: 'unreachable',       label: 'Customer unreachable' },
  { code: 'duplicate',         label: 'Duplicate / created in error' },
  { code: 'other',             label: 'Other (see notes)' },
]


// ---- Format helper: feet-inches notation used throughout shape sizes ------
// 24 → "2-0", 18 → "1-6", 4 → "0-4"
function ftIn(inches) {
  if (inches == null) return ''
  const ft = Math.floor(inches / 12)
  const inch = inches % 12
  return `${ft}-${inch}`
}

// ---- Stone shapes (drives Step 5) — aligned with the Shevchenko pricing sheet
//
// Each shape carries:
//   - standardSizes: prefilled options ("2-0 × 1-0 × 1-6" etc.)
//   - canHaveBase: whether to offer a "+ add base" toggle
//   - requiresBase: whether a base is mandatory (dies always have one)
//   - baseSizes: standard base sizes (used when adding a base)
//   - baseHeights: 6/8/10/12″ options with upcharge per pricing sheet
//   - customShapes: list of common custom shapes (Custom Shape only)
//   - onlyForServices: filter — shape only appears for matching service codes
const SHAPES = [
  {
    code: 'grass',
    label: 'Grass Marker',
    blurb: 'Flush marker installed at grass level.',
    icon: '▬',
    standardSizes: [
      { code: '16x8x4',     w: 16, d: 8,  t: 4, label: '16″ × 8″ × 4″',         price: 799 },
      { code: '20x10x4',    w: 20, d: 10, t: 4, label: '20″ × 10″ × 4″',        price: 899 },
      { code: '24x12x4',    w: 24, d: 12, t: 4, label: '2-0 × 1-0 × 0-4',       price: 1100 },
      { code: '24x14x4',    w: 24, d: 14, t: 4, label: '2-0 × 1-2 × 0-4',       price: 1250 },
    ],
    canHaveBase: false,
  },
  {
    code: 'hickey',
    label: 'Hickey',
    blurb: 'Flat with beveled edge above grass level.',
    icon: '▭',
    standardSizes: [
      { code: 'hickey-2-0x1-0x0-6',  w: 24, d: 12, t: 6,  label: '2-0 × 1-0 × 0-6 w/2″ bevel',  price: 1395 },
      { code: 'hickey-2-0x1-0x0-8',  w: 24, d: 12, t: 8,  label: '2-0 × 1-0 × 0-8 w/2″ bevel',  price: 1695 },
      { code: 'hickey-2-0x1-0x1-0',  w: 24, d: 12, t: 12, label: '2-0 × 1-0 × 1-0 w/2″ bevel',  price: 1995 },
    ],
    canHaveBase: false,
  },
  {
    code: 'slant',
    label: 'Slant',
    blurb: 'Single slant marker.',
    icon: '🪨',
    standardSizes: [
      { code: 'slant-2-0',  w: 24, d: 12, t: 18, label: '2-0 × 1-0 × 1-6', price: 2495 },
      { code: 'slant-2-6',  w: 30, d: 12, t: 18, label: '2-6 × 1-0 × 1-6', price: 2995 },
      { code: 'slant-3-0',  w: 36, d: 12, t: 18, label: '3-0 × 1-0 × 1-6', price: 3695 },
      { code: 'slant-3-6',  w: 42, d: 12, t: 18, label: '3-6 × 1-0 × 1-6', price: 4295 },
    ],
    canHaveBase: true,
  },
  {
    code: 'double-slant',
    label: 'Double Slant',
    blurb: 'Companion slant marker.',
    icon: '🪨',
    standardSizes: [
      { code: 'dslant-4-0', w: 48, d: 12, t: 18, label: '4-0 × 1-0 × 1-6', price: 4995 },
      { code: 'dslant-4-6', w: 54, d: 12, t: 18, label: '4-6 × 1-0 × 1-6', price: 5495 },
      { code: 'dslant-5-0', w: 60, d: 12, t: 18, label: '5-0 × 1-0 × 1-6', price: 5995 },
      { code: 'dslant-6-0', w: 72, d: 14, t: 18, label: '6-0 × 1-2 × 1-6', price: 6995 },
    ],
    canHaveBase: true,
  },
  {
    code: 'die',
    label: 'Die (Single Upright)',
    blurb: 'Standing die — base required.',
    icon: '🗿',
    standardSizes: [
      { code: 'die-1-8',    w: 20, d: 8, t: 28, label: '1-8 × 2-4',  price: 2495 },
      { code: 'die-1-10',   w: 22, d: 8, t: 28, label: '1-10 × 2-4', price: 2795 },
      { code: 'die-2-0',    w: 24, d: 8, t: 28, label: '2-0 × 2-4',  price: 2995 },
      { code: 'die-2-4',    w: 28, d: 8, t: 28, label: '2-4 × 2-4',  price: 3495 },
      { code: 'die-2-8',    w: 32, d: 8, t: 28, label: '2-8 × 2-4',  price: 3995 },
      { code: 'die-3-0',    w: 36, d: 8, t: 28, label: '3-0 × 2-4',  price: 4575 },
      { code: 'die-3-6',    w: 42, d: 8, t: 28, label: '3-6 × 2-4',  price: 5150 },
    ],
    canHaveBase: true,
    requiresBase: true,
  },
  {
    code: 'double-die',
    label: 'Double Die (Companion Upright)',
    blurb: 'Companion standing die — wider base required.',
    icon: '⬛',
    standardSizes: [
      { code: 'ddie-3-6',   w: 42, d: 8, t: 28, label: '3-6 × 2-4', price: 5150 },
      { code: 'ddie-4-0',   w: 48, d: 8, t: 28, label: '4-0 × 2-4', price: 5750 },
      { code: 'ddie-4-6',   w: 54, d: 8, t: 28, label: '4-6 × 2-4', price: 6450 },
      { code: 'ddie-5-0',   w: 60, d: 8, t: 28, label: '5-0 × 2-4', price: 7150 },
      { code: 'ddie-6-0',   w: 72, d: 8, t: 28, label: '6-0 × 2-4', price: 8500 },
    ],
    canHaveBase: true,
    requiresBase: true,
  },
  {
    code: 'bronze',
    label: 'Bronze Plaque',
    blurb: 'Bronze marker — flat or on a granite base.',
    icon: '🟫',
    standardSizes: [
      { code: 'bronze-24x12',  w: 24, d: 12, t: 0, label: '24″ × 12″', price: 230 },
      { code: 'bronze-24x14',  w: 24, d: 14, t: 0, label: '24″ × 14″', price: 235 },
      { code: 'bronze-44x14',  w: 44, d: 14, t: 0, label: '44″ × 14″', price: 400 },
    ],
    canHaveBase: true,
  },
  {
    code: 'custom',
    label: 'Custom Shape',
    blurb: 'Heart, cross, teardrop, angel — describe below.',
    icon: '💎',
    standardSizes: [],
    canHaveBase: true,
    customShapes: [
      'Heart', 'Double Heart', 'Cross', 'Orthodox Cross', 'Celtic Cross',
      'Teardrop', 'Angel', 'Praying Hands', 'Book', 'Bench',
      'Tree of Life', 'Pillow', 'Star', 'Other (describe)',
    ],
  },
  {
    code: 'mausoleum',
    label: 'Mausoleum',
    blurb: 'Mausoleum or large structure — fully custom.',
    icon: '⛪',
    standardSizes: [],
    canHaveBase: false,
    onlyForServices: ['MAUSOLEUM'],
  },
  {
    code: 'civic',
    label: 'Civic / Memorial',
    blurb: 'Public, veterans, or religious monument.',
    icon: '🏛',
    standardSizes: [],
    canHaveBase: true,
    onlyForServices: ['CIVIC_MEMORIAL'],
  },
]

// ---- Top shapes (apply to slant/die/upright shapes) -----------------------
const TOP_SHAPES = [
  { code: 'classic-serp', label: 'Classic Serpentine', blurb: 'Gentle S-curve top.' },
  { code: 'flat-top',     label: 'Flat Top',           blurb: 'Straight horizontal top.' },
  { code: 'roof-top',     label: 'Roof Top',           blurb: 'Peaked roof shape.' },
  { code: 'oval-top',     label: 'Oval Top',           blurb: 'Rounded half-oval top.' },
  { code: 'cathedral',    label: 'Cathedral',          blurb: 'Tall pointed arch.' },
  { code: 'gothic',       label: 'Gothic',             blurb: 'Pointed gothic arch.' },
  { code: 'cathedral-serp', label: 'Cathedral Serp',   blurb: 'Cathedral with serpentine sides.' },
]

// ---- Sides (replaces "Finish" — applies to die/slant/double-die/double-slant/civic/custom)
// "Sides" = the surface treatment on the vertical sides of the stone
const SIDES_OPTIONS = [
  { code: 'brp',                   label: 'BRP',                   blurb: 'Balanced Rock Pitch on all sides.' },
  { code: 'brp-vertical',          label: 'BRP Vertical Sides',    blurb: 'BRP on the vertical sides only.' },
  { code: 'all-polish-no-sides',   label: 'All Polish No Sides',   blurb: 'Fully polished — no sides treatment.' },
  { code: 'saw-back',              label: 'Saw Back',              blurb: 'Sawn back surface (smooth, unpolished).' },
  { code: 'rough-back',            label: 'Rough Back',            blurb: 'Rough-quarry texture on the back.' },
]

// ---- Base sides (different option set than die sides)
const BASE_SIDES_OPTIONS = [
  { code: 'polish-top-brp',  label: 'Polish Top BRP',  blurb: 'Polished top with BRP sides.' },
  { code: 'all-polish',      label: 'All Polish',      blurb: 'Fully polished base.' },
  { code: 'brp-sawback',     label: 'BRP Sawback',     blurb: 'BRP sides with sawn back.' },
]

// Auto-default sides based on polish level for dies/slants
const POLISH_TO_SIDES_DEFAULT = {
  P2: 'brp',
  P3: 'brp-vertical',
  P5: 'all-polish-no-sides',
}

// ---- Polish levels --------------------------------------------------------
const POLISH_LEVELS = [
  { code: 'P2', label: 'P2 — Polished 2',  blurb: 'Front and back polished.' },
  { code: 'P3', label: 'P3 — Polished 3',  blurb: 'Front, back, and top polished.' },
  { code: 'P5', label: 'P5 — Polished 5',  blurb: 'All sides polished except the bottom.' },
]

// ---- Base sizes (used when adding a base to slant/die/etc.) --------------
const BASE_SIZES = [
  { code: 'base-2-6x1-2', w: 30, d: 14, label: '2-6 × 1-2 × 0-6', price: 772 },
  { code: 'base-3-0x1-2', w: 36, d: 14, label: '3-0 × 1-2 × 0-6', price: 927 },
  { code: 'base-3-6x1-2', w: 42, d: 14, label: '3-6 × 1-2 × 0-6', price: 1150 },
  { code: 'base-4-0x1-2', w: 48, d: 14, label: '4-0 × 1-2 × 0-6', price: 1272 },
  { code: 'base-2-0x1-0', w: 24, d: 12, label: '2-0 × 1-0 × 0-8 polished top', price: 300 },
  { code: 'base-2-4x1-0', w: 28, d: 12, label: '2-4 × 1-0 × 0-8 polished top', price: 350 },
  { code: 'base-2-6x1-0', w: 30, d: 12, label: '2-6 × 1-0 × 0-8 polished top', price: 375 },
  { code: 'base-2-8x1-0', w: 32, d: 12, label: '2-8 × 1-0 × 0-8 polished top', price: 400 },
  { code: 'base-3-6x1-0', w: 42, d: 12, label: '3-6 × 1-0 × 0-8 polished top', price: 525 },
  { code: 'base-4-0x1-0', w: 48, d: 12, label: '4-0 × 1-0 × 0-8 polished top', price: 600 },
]

// Base height options (per pricing sheet "DIE + BASE" line)
const BASE_HEIGHTS = [
  { code: 6,  label: '6″',  upcharge: 125 },
  { code: 8,  label: '8″',  upcharge: 150 },
  { code: 10, label: '10″', upcharge: 175 },
  { code: 12, label: '12″', upcharge: 200 },
]

// ---- Most-popular epitaphs (kept for the Inscription quick-pick dropdown) -
const POPULAR_EPITAPHS = [
  'Rest in Peace',
  'Forever in Our Hearts',
  'In Loving Memory',
  'Together Forever',
  'Until We Meet Again',
  'Love Never Fails',
  'Gone but Not Forgotten',
  'In God\'s Loving Care',
  'Beloved & Remembered',
  'Forever Loved',
  'Always in Our Hearts',
  'Now and Forever',
]

// ---- Full epitaph library (Sprint 2.5+) -----------------------------------
// Categorized — used in the "Browse library" picker on Inscription step.
// Items are either plain strings OR { text, label } objects. The label is
// shown in the picker (and searched against); the text is what drops into
// the textarea when picked. This lets us show "Hebrew — Transliteration
// (English meaning)" in the picker but engrave just the Hebrew.
const EPITAPH_LIBRARY = {
  'most-popular': {
    label: 'Most Popular',
    icon: '⭐',
    items: [
      'Rest in Peace',
      'Forever in Our Hearts',
      'In Loving Memory',
      'Together Forever',
      'Until We Meet Again',
      'Love Never Fails',
      'Gone but Not Forgotten',
      'In God\'s Loving Care',
      'Beloved & Remembered',
      'Forever Loved',
      'Always in Our Hearts',
      'Now and Forever',
      'To live in the hearts of those we love is never to die',
      'The song is ended, but the melody lingers on',
      'Too well loved to ever be forgotten',
      'At the going down of the sun, and in the morning we will remember them',
      'Loving memories last forever',
      'Not lost to memory, not lost to love, but gone to our Father\'s house above',
    ],
  },
  'scripture': {
    label: 'Scripture',
    icon: '📖',
    items: [
      'The Lord is my Shepherd, I shall not want. Psalm 23',
      'Though I walk through the valley of the shadow of death, I will fear no evil. Psalm 23',
      'For God so loved the world. John 3:16',
      'To live is Christ, to die is gain. Philippians 1:21',
      'O death, where is thy sting? 1 Corinthians 15:55',
      'I am the resurrection and the life. John 11:25',
      'Whosoever believeth in Him should not perish, but have eternal life. John 3:15',
      'He that believeth in the Son hath everlasting life. John 3:36',
      'Believe on Him to life everlasting. 1 Timothy 1:16',
      'He shall receive in the world to come eternal life. Mark 10:30',
      'The righteous shall go into life eternal. Matthew 25:46',
      'Blessed are the pure in heart, for they shall see God. Matthew 5:8',
      'Blessed are they that mourn: for they shall be comforted. Matthew 5:4',
      'He that endureth to the end shall be saved. Matthew 10:22',
      'Come unto me, all ye that labor and are heavy laden. Matthew 11:28',
      'Sleep on now, and take your rest. Matthew 26:45',
      'Well done, thou good and faithful servant. Matthew 25:21',
      'For of such is the Kingdom of Heaven. Matthew 19:14',
      'I am with you always, even to the end of the age. Matthew 28:20',
      'Let not your heart be troubled: ye believe in God, believe also in me. John 14:1',
      'Greater love than this no one has, that one lay down his life for his friends. John 15:13',
      'God is love; he that dwelleth in love dwelleth in God, and God in him. 1 John 4:13',
      'This is the promise: the life everlasting. 1 John 2:25',
      'I have fought a good fight, I have finished my course, I have kept the faith. 2 Timothy 4:7',
      'Be thou faithful unto death, and I will give thee a crown of life. Revelation 2:10',
      'All things work together for good to them that love God. Romans 8:28',
      'Not my will, but thine be done. Luke 22:42',
      'The Lord hath given him rest from all his enemies. 2 Samuel 7:1',
      'Thy remembrance shall endure into all generations. Psalm 102',
      'I thank my God upon every remembrance of you. Philippians 1:3',
      'Be still and know that I am God. Psalm 46:10',
      'Precious in the sight of the Lord is the death of His saints. Psalm 116:15',
      'The Lord bless thee and keep thee. Numbers 6:24',
      'Weeping may endure for a night, but joy cometh in the morning. Psalm 30:5',
      'The Lord giveth, and the Lord taketh away; blessed be the name of the Lord. Job 1:21',
      'Blessed is the man who maketh the Lord his trust. Psalm 40:4',
      'For with thee is the foundation of life: in thy light shall we see light. Psalm 36:9',
      'I rejoice in thy salvation. 1 Samuel 2:1',
      'Whither thou goest, I will go. Ruth 1:16',
      'Until the day break, and the shadows flee away. Song of Solomon 2:17',
      'Children are a heritage of the Lord. Psalm 127:3',
      'The Lord watch between me and thee, while we are absent, one from the other. Genesis 31:49',
    ],
  },
  'religious-catholic': {
    label: 'Religious — Catholic',
    icon: '✝',
    items: [
      'May Eternal Light Shine Upon Them',
      'May the Souls of the Faithful Departed Rest in Peace',
      'In the Hands of God',
      'May Perpetual Light Shine Upon Them',
      'Our Lady of Guadalupe, Pray for Us',
      'Sacred Heart of Jesus, Have Mercy',
      'Eternal Rest Grant Unto Them, O Lord',
      'Mother Mary, Pray for Us',
      'Into Thy Hands O Lord I Commend My Spirit',
      'Pray for the Repose of the Soul',
      'May the soul of the faithful departed through the mercy of God rest in peace',
    ],
  },
  'religious-christian': {
    label: 'Religious — Christian',
    icon: '✟',
    items: [
      'Asleep in Jesus',
      'Asleep in Christ Jesus',
      'With the Lord',
      'Safe in the Arms of Jesus',
      'Until the Day Breaks',
      'In Christ\'s Loving Care',
      'A Faithful Servant',
      'Promoted to Glory',
      'Forever with the Lord',
      'Saved by Grace',
      'He has Gone Home',
      'Beloved of the Lord',
      'Everlasting Life through Christ',
      'Home with God, which is far better',
    ],
  },
  'jewish': {
    label: 'Jewish',
    icon: '✡',
    items: [
      'May His Memory Be a Blessing',
      'May Her Memory Be a Blessing',
      'May Their Memory Be a Blessing',
      'Of Blessed Memory',
      'A Devoted Husband and Father',
      'A Devoted Wife and Mother',
      'Resting with the Patriarchs',
      'Beloved and Remembered Always',
      'Bound up in the Bond of Eternal Life',
      // Hebrew entries — picker shows Hebrew + transliteration + meaning,
      // but only the Hebrew text drops into the engraving textarea.
      { text: 'זכרונו לברכה', label: 'זכרונו לברכה — Zikhrono Livracha (May his memory be a blessing)' },
      { text: 'זכרונה לברכה', label: 'זכרונה לברכה — Zikhronah Livracha (May her memory be a blessing)' },
      { text: 'זכרונם לברכה', label: 'זכרונם לברכה — Zikhronam Livracha (May their memory be a blessing)' },
      { text: 'תנצב״ה',         label: 'תנצב״ה — May his/her soul be bound in the bond of eternal life' },
      { text: 'אשת חיל',        label: 'אשת חיל — Eshet Chayil (A Woman of Valor)' },
      { text: 'איש תם וישר',    label: 'איש תם וישר — A pure and upright man' },
    ],
  },
  'classic': {
    label: 'Classic / Literary',
    icon: '📜',
    items: [
      'Death is the golden key that opens the palace of Eternity. — Milton',
      'Earth hath no sorrow that heaven cannot heal. — Moore',
      'Heaven, the treasury of everlasting joy. — Shakespeare',
      'Sorrows are like tall angels with star-crowns in their hair. — Howell',
      'The kiss of the sun for pardon, the song of the birds for mirth, one\'s nearer God\'s heart in a garden, than anywhere else on earth. — D.F. Gurney',
      'In His will is our peace. — Dante',
      'Music, when soft voices die, vibrates in the memory. — Shelley',
      'Joy, joy, forever! My task is done — the gates are pass\'d and heaven is won. — Moore',
      'The heart of man is restless until it finds its rest in Thee. — St. Augustine',
      'God is, and all is well. — Whittier',
      'Life\'s a voyage that\'s homeward bound. — Melville',
      'In the night of death hope sees a star, and listening Love can hear the rustle of a wing. — Ingersoll',
      'There never was night that had no morn. — Craik',
      'Faith builds a bridge across the gulf of death. — Young',
      'Now twilight lets her curtain down and pins it with a star. — L.M. Child',
      'His daily prayer, far better understood in acts than words, was simply doing good. — Whittier',
      'Death is not a foe, but an inevitable adventure. — Sir Oliver Lodge',
      'What seems to us but dim funeral tapers may be heaven\'s distant lamps. — Longfellow',
      'Life is not measured by the number of breaths we take, but by the moments that take our breath away',
      'Tears are often the telescope by which men see far into heaven. — H.W. Beecher',
    ],
  },
  'for-her': {
    label: 'For Her — Mother/Wife/Sister',
    icon: '👩',
    items: [
      'To know even one life breathed easier because she lived is to know she truly succeeded',
      'She did more than exist; she lived. She did more than listen; she understood',
      'She concealed her tears but shared her smiles',
      'Her memory is enshrined in our hearts',
      'Her friendship was an inspiration, her love a blessing',
      'She walked in beauty',
      'She would rather give than receive',
      'Always loving, always loved',
      'To know her was to love her',
      'Her children arise up and call her blessed',
      'A mother is a mother still, the holiest thing alive',
      'Grace was in all her steps, heaven in her eye, in every gesture dignity and love',
      'She passed through glory\'s morning gate and walked in paradise',
      'God\'s greatest gift returned to God — my mother',
      'Sleep on, sweet mother, and take thy rest. God called thee home. He thought it best',
      'God took her home, it was his will, but in our hearts she liveth still',
      'She is resting peacefully with Jesus in that beautiful home above',
      'She never took no for an answer, but a kinder, gentler woman you will never meet',
      'When she had passed, it seemed like the ceasing of exquisite music',
    ],
  },
  'for-him': {
    label: 'For Him — Father/Husband/Brother',
    icon: '👨',
    items: [
      'If there is another world, he lives in bliss; if not another, he made the most of this',
      'He always stood for what was right and good and for this we shall forever cherish his memory',
      'What lies behind him and what lies before him are tiny matters compared to what lay within him',
      'He achieved success here because he lived well, laughed often, and loved much',
      'He left the world knowing he was loved. Nothing in life could be a more precious gift',
      'He never heard opportunity knock because he was too busy building doors',
      'His true wealth was in his generous heart, and what endless wealth he did have',
      'It is not length of life, but depth of life — he jumped into life and never touched bottom',
      'Only those who risk going too far will ever know how far they can go',
      'He always did the things he thought he couldn\'t do',
      'A faithful husband, devoted father, and steadfast friend',
      'His was a man\'s courage',
    ],
  },
  'children': {
    label: 'Children & Infants',
    icon: '👼',
    items: [
      'A Little Angel Now in Heaven',
      'Heaven\'s Newest Angel',
      'Forever Our Baby',
      'God\'s Little Lamb',
      'Loved Beyond Words, Missed Beyond Measure',
      'Too Loved to Ever Be Forgotten',
      'Tiny Hands Touched Our Hearts',
      'Precious Beyond Words',
      'Hush my dear, be still and slumber; jolly angels guard your bed',
      'Children bring their own love with them when they come',
      'No jewel is as perfect as the innocence of childhood',
      'Sleep, my little one, sleep',
      'Children are a heritage of the Lord. Psalm 127:3',
      'God\'s garden has need of little flowers',
      'So small, so sweet, so soon',
      'Lord, we give you our littlest angel',
      'Budded on earth to bloom in heaven',
      'For of such is the Kingdom of Heaven',
      'Awaiting the touch of a little hand, and the smile of a little face',
      'Children are the keys of paradise',
      'An angel visited the green earth, and took a flower away',
      'Born Sleeping',
      'Born into Heaven',
    ],
  },
  'spanish': {
    label: 'Spanish',
    icon: '🌹',
    items: [
      'Descansa en Paz',
      'Siempre en Nuestros Corazones',
      'En Memoria Eterna',
      'Hasta Que Nos Volvamos a Encontrar',
      'Querido Esposo y Padre',
      'Querida Esposa y Madre',
      'En las Manos de Dios',
      'Amada por Siempre',
      'El Señor es mi Pastor',
      'Tu Recuerdo Vive en Nosotros',
      'Que en Paz Descanse',
      'Madre Querida — Siempre Recordada',
      'Padre Querido — Siempre en Nuestros Corazones',
      'Eternamente Amado',
      'Vivirás Siempre en Nuestro Recuerdo',
    ],
  },
  'love-couple': {
    label: 'Love & Couple',
    icon: '❤',
    items: [
      'Together Forever',
      'United in Love and Death',
      'Loving Husband and Wife',
      'Side by Side in Eternity',
      'Their Love Lives On',
      'Love That Outlasts Time',
      'Forever Yours',
      'Two Hearts, One Love',
      'Bound by Love',
      'My wife, my friend, the mother dear in dreamless sleep reposes here',
      'I shall but love thee better after death',
      'God could not have made earthly ties so strong to break them in eternity',
    ],
  },
  'veterans': {
    label: 'Veterans',
    icon: '🎖',
    items: [
      'In Service to His Country',
      'Honored Veteran',
      'A Soldier\'s Final Salute',
      'Served with Honor',
      'For God and Country',
      'A Grateful Nation Remembers',
      'Duty, Honor, Country',
      'A True American Hero',
      'Rest with Your Brothers in Arms',
      'He served his country with pride and honor',
    ],
  },
}

// Carving reference photos — Supabase Storage URLs (key photos bucket).
// Held verbatim pre-encoded; do not re-encode at runtime.
const MARKETING_PHOTOS = {
  flat:     'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Flat%20Carving%20Key%20Photo.jpeg',
  shape:    'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Shape%20Carving%20Key%20Photo.jpeg',
  sculpted: 'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/hand%20sculpted%20key%20photo.jpg',
  laser:    'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/laser-etching-key%20photo.jpg',
  vase:     'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Vase%20Key%20Photo%20.jpg',
  bling:    'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/key%20bling%20photo%20.jpg',
}

// ---- Custom design example (LALIS stone) — embedded reference image -----
const CUSTOM_DESIGN_IMAGE = "data:image/jpeg;base64,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"
const CUSTOM_DESIGN_REFERENCE_IMAGE = "data:image/jpeg;base64,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"

// ---- Add-on categories (Sprint 3p — drives the 6-card add-ons grid) ------
// Cards 1-4 (Flat, Shape, Hand Sculpted, Laser Etching) toggle selection;
// any combination can coexist on one stone.
// Cards 5-6 (Vase, BLING) are coming-soon stubs — clicking opens a modal
// rather than toggling. Configurators ship in 3p.2 (BLING) and 3p.3 (Vase).
const CARVE_TYPES = [
  {
    code: 'flat',
    label: 'Flat Carve',
    blurb: 'Etched/engraved into the stone surface — design appears recessed. Included with stone (no extra charge).',
    freeWithStone: true,
  },
  {
    code: 'shape',
    label: 'Shape Carved',
    blurb: 'Sculpted in 3D relief — design has dimensional depth.',
    freeWithStone: false,
  },
  {
    code: 'sculpted',
    label: 'Hand Sculpted',
    blurb: 'Hand-carved sculptural element — fully custom, priced per project.',
    freeWithStone: false,
    customPrice: true,
  },
  {
    code: 'laser',
    label: 'Laser Etching',
    blurb: 'Photo-realistic laser-etched imagery on a polished panel.',
    freeWithStone: false,
  },
  {
    code: 'vase',
    label: 'Vase',
    blurb: 'Granite vase add-on — one or two, sized to the base. Fit-checked.',
    freeWithStone: false,
  },
  {
    code: 'bling',
    label: 'BLING',
    blurb: 'Decorative inlay accent — three sizes, 20 designs, 21-color picker.',
    freeWithStone: false,
  },
]

// Sprint 3j — Laser etching pricing
// Base rate: $695 / 144 sq in = $4.826 per sq in for a 12×12 small panel.
// Larger sizes get a per-sq-in discount (volume).
const LASER_BASE_PER_SQIN = 695 / 144   // ≈ 4.826
const LASER_SIZES = [
  {
    code: 'sm', label: 'Small', dim: '12″ × 12″', sqIn: 144, discount: 0,
    blurb: 'A focal-point image — portrait or single design element.',
    fixedPrice: 695,
  },
  {
    code: 'md', label: 'Medium', dim: '18″ × 18″', sqIn: 324, discount: 0.15,
    blurb: 'Portrait with surrounding scene/details. Roughly 2× a small.',
  },
  {
    code: 'lg', label: 'Large', dim: '24″ × 24″', sqIn: 576, discount: 0.25,
    blurb: 'Multi-element composition — figures + scenery side by side.',
  },
  {
    code: 'whole', label: 'Whole face', dim: 'full stone face', sqIn: null, discount: 0.30,
    blurb: 'Full coverage — names, dates, epitaph and imagery all etched. Replaces traditional carving.',
    computeFromStone: true,
  },
]

// Compute the laser etching price for a given size, taking the stone's face
// area into account for the "whole face" option.
function computeLaserPrice(sizeCode, stoneFaceSqIn) {
  const size = LASER_SIZES.find(s => s.code === sizeCode)
  if (!size) return 0
  if (size.fixedPrice) return size.fixedPrice
  const ratePerSqIn = LASER_BASE_PER_SQIN * (1 - size.discount)
  const sqIn = size.computeFromStone ? (stoneFaceSqIn || size.sqIn || 144) : size.sqIn
  return Math.round(sqIn * ratePerSqIn)
}

// Estimate a stone's "etchable face area" (sq in) for whole-face pricing
// + as a sanity cap. Approximations are fine — the salesperson can always
// override the final price.
function stoneFaceArea(order) {
  const shape = SHAPES.find(s => s.code === order.shape)
  if (!shape) return null
  const stdSize = order.standardSizeCode ? shape.standardSizes.find(s => s.code === order.standardSizeCode) : null
  const w = stdSize?.w ?? order.width
  const d = stdSize?.d ?? order.depth
  const t = stdSize?.t ?? order.thickness
  if (!w) return null
  // For shapes with vertical faces (slants/dies/civic/custom): w × t (front face)
  // For flat markers (grass/hickey/bronze): w × d (top surface)
  if (['slant','double-slant','die','double-die','civic','custom'].includes(order.shape)) {
    return t ? w * t : null
  }
  return d ? w * d : null
}

// ---- Sprint 3p.2 — BLING configurator data --------------------------------
// 3 sizes, 20 option designs, color upcharge that mirrors GRANITE_COLORS.premium.
const BLING_SIZES = [
  { code: 'small',  label: 'Small',  dim: '12″ × 12″', basePrice: 695 },
  { code: 'medium', label: 'Medium', dim: '18″ × 18″', basePrice: 745 },
  { code: 'large',  label: 'Large',  dim: '24″ × 24″', basePrice: 795 },
]

// Color upcharge = the granite color's `premium` (same schedule). Keep this
// derivation in one place so the BLING price never drifts from the granite
// premium schedule defined on GRANITE_COLORS.
const blingColorUpcharge = (colorCode) => {
  if (!colorCode) return 0
  const c = GRANITE_COLORS.find(x => x.code === colorCode)
  return c?.premium ?? 0
}
const computeBlingPrice = (sizeCode, colorCode) => {
  const s = BLING_SIZES.find(x => x.code === sizeCode)
  if (!s) return 0
  return Math.round(s.basePrice * (1 + blingColorUpcharge(colorCode)))
}

const BLING_BUCKET = 'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Bling%20Options/'
const BLING_EXAMPLES_BUCKET = 'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Bling%20Examples/'

const BLING_OPTIONS = [
  { code: 'basketball',      label: 'Basketball',           photo: BLING_BUCKET + 'Basketball-400x405.png' },
  { code: 'bible-book',      label: 'Bible / Book',         photo: BLING_BUCKET + 'Bible-Book-319x405.png' },
  { code: 'bird',            label: 'Bird',                 photo: BLING_BUCKET + 'Bird-411x405.png' },
  { code: 'blue-jay',        label: 'Blue Jay',             photo: BLING_BUCKET + 'Blue-Jay-350x250.png' },
  { code: 'butterfly',       label: 'Butterfly',            photo: BLING_BUCKET + 'Butterfly-540x400.png' },
  { code: 'cat',             label: 'Cat',                  photo: BLING_BUCKET + 'Cat-540x243.png' },
  { code: 'cross',           label: 'Cross',                photo: BLING_BUCKET + 'Cross-399x405.png' },
  { code: 'dove',            label: 'Dove',                 photo: BLING_BUCKET + 'Dove-383x405.png' },
  { code: 'fire-department', label: 'Fire Department',      photo: BLING_BUCKET + 'Fire-Department-402x405.png' },
  { code: 'football',        label: 'Football',             photo: BLING_BUCKET + 'Football-540x313.png' },
  { code: 'horse',           label: 'Horse',                photo: BLING_BUCKET + 'Horse-299x405.png' },
  { code: 'medical',         label: 'Medical',              photo: BLING_BUCKET + 'Medical-389x405.png' },
  { code: 'music',           label: 'Music',                photo: BLING_BUCKET + 'Music-422x405.png' },
  { code: 'roses',           label: 'Roses',                photo: BLING_BUCKET + 'Roses2-e1485975767337-272x405.png' },
  { code: 'teacher-1',       label: 'Teacher (Style 1)',    photo: BLING_BUCKET + 'Teacher1-419x405.png' },
  { code: 'teacher-2',       label: 'Teacher (Style 2)',    photo: BLING_BUCKET + 'Teacher2-286x405.png' },
  { code: 'teacher-3',       label: 'Teacher (Style 3)',    photo: BLING_BUCKET + 'Teacher3-298x405.png' },
  { code: 'teddy-bear-1',    label: 'Teddy Bear (Style 1)', photo: BLING_BUCKET + 'Teddy-Bear-363x405.png' },
  { code: 'teddy-bear-2',    label: 'Teddy Bear (Style 2)', photo: BLING_BUCKET + 'Teddy-Bear2-415x405.png' },
  { code: 'wedding-rings',   label: 'Wedding Rings',        photo: BLING_BUCKET + 'Wedding-Rings-410x405.png' },
]

// Installed-on-stone reference photos. Some BLING options have a matching
// example; others don't (per Option-2 design in 3p.2 spec).
const BLING_EXAMPLES = [
  { code: 'cross-bevel',           mapsTo: 'cross',         label: 'Cross — bevel install',   photo: BLING_EXAMPLES_BUCKET + 'Cross-Bevel-350x250.jpg' },
  { code: 'dove-bevel',            mapsTo: 'dove',          label: 'Dove — bevel install',    photo: BLING_EXAMPLES_BUCKET + 'Dove-Bevel-350x250.jpg' },
  { code: 'holy-bible-3',          mapsTo: 'bible-book',    label: 'Holy Bible',              photo: BLING_EXAMPLES_BUCKET + 'Holy-Bible3-350x250.jpg' },
  { code: 'horse-head',            mapsTo: 'horse',         label: 'Horse head',              photo: BLING_EXAMPLES_BUCKET + 'Horse-Head-350x250.jpg' },
  { code: 'large-roses',           mapsTo: 'roses',         label: 'Large roses — front',     photo: BLING_EXAMPLES_BUCKET + 'Large-Roses-full-front-350x250.jpg' },
  { code: 'medical-full',          mapsTo: 'medical',       label: 'Medical — full front',    photo: BLING_EXAMPLES_BUCKET + 'Medical-full-front-350x250.jpg' },
  { code: 'music-note',            mapsTo: 'music',         label: 'Music note',              photo: BLING_EXAMPLES_BUCKET + 'Music-Note-350x250.jpg' },
  { code: 'teacher',               mapsTo: 'teacher-1',     label: 'Teacher',                 photo: BLING_EXAMPLES_BUCKET + 'Teacher-350x250.jpg' },
  { code: 'teddy-bear',            mapsTo: 'teddy-bear-1',  label: 'Teddy bear',              photo: BLING_EXAMPLES_BUCKET + 'Teddy-Bear-350x250.jpg' },
  { code: 'teddy-bear-woodpecker', mapsTo: 'teddy-bear-1',  label: 'Teddy bear + woodpecker', photo: BLING_EXAMPLES_BUCKET + 'Teddy-Bear-and-Woodpecker-e1486044321873-350x250.jpg' },
  { code: 'wedding-rings',         mapsTo: 'wedding-rings', label: 'Wedding rings — front',   photo: BLING_EXAMPLES_BUCKET + 'Wedding-Rings-full-front-350x250.jpg' },
]
const blingExamplesFor = (optionCode) => BLING_EXAMPLES.filter(e => e.mapsTo === optionCode)

// ---- Sprint 3p.3 — Vase configurator data ---------------------------------
// 6 sizes × 18 shapes × 21 colors. Color upcharge mirrors GRANITE_COLORS.premium
// (same source of truth as BLING).
const VASE_SIZES = [
  { code: '4x4x10', label: '4 × 4 × 10', w: 4, d: 4, h: 10, volCi: 160, basePrice: 190 },
  { code: '5x4x9',  label: '5 × 4 × 9',  w: 5, d: 4, h: 9,  volCi: 180, basePrice: 205 },
  { code: '5x5x9',  label: '5 × 5 × 9',  w: 5, d: 5, h: 9,  volCi: 225, basePrice: 245 },
  { code: '6x6x10', label: '6 × 6 × 10', w: 6, d: 6, h: 10, volCi: 360, basePrice: 365 },
  { code: '8x6x10', label: '8 × 6 × 10', w: 8, d: 6, h: 10, volCi: 480, basePrice: 465 },
  { code: '8x8x12', label: '8 × 8 × 12', w: 8, d: 8, h: 12, volCi: 768, basePrice: 705 },
]

const VASE_BUCKET = 'https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/'

// 18 shape thumbnails. 6 "size-named" jpgs (kept first for visual grouping)
// + 12 "vase-shape" pngs. Generic Shape A-F + Shape 1-12 labels since the
// images don't carry human-friendly names.
const VASE_SHAPES = [
  { code: 'shape-a',       label: 'Shape A',  photo: VASE_BUCKET + '4-4-10-297x405.jpg' },
  { code: 'shape-b',       label: 'Shape B',  photo: VASE_BUCKET + '5-4-9-297x405.jpg' },
  { code: 'shape-c',       label: 'Shape C',  photo: VASE_BUCKET + '5-5-9-297x405.jpg' },
  { code: 'shape-d',       label: 'Shape D',  photo: VASE_BUCKET + '6-6-10-297x405.jpg' },
  { code: 'shape-e',       label: 'Shape E',  photo: VASE_BUCKET + '8-6-10-297x405.jpg' },
  { code: 'shape-f',       label: 'Shape F',  photo: VASE_BUCKET + '8-8-1-297x405.jpg' },
  { code: 'vase-shape-1',  label: 'Shape 1',  photo: VASE_BUCKET + 'vase-shape1-258x405.png' },
  { code: 'vase-shape-2',  label: 'Shape 2',  photo: VASE_BUCKET + 'vase-shape2-288x405.png' },
  { code: 'vase-shape-3',  label: 'Shape 3',  photo: VASE_BUCKET + 'vase-shape3-298x405.png' },
  { code: 'vase-shape-4',  label: 'Shape 4',  photo: VASE_BUCKET + 'vase-shape4-293x405.png' },
  { code: 'vase-shape-5',  label: 'Shape 5',  photo: VASE_BUCKET + 'vase-shape5-360x270.png' },
  { code: 'vase-shape-6',  label: 'Shape 6',  photo: VASE_BUCKET + 'vase-shape6-305x405.png' },
  { code: 'vase-shape-7',  label: 'Shape 7',  photo: VASE_BUCKET + 'vase-shape7-281x405.png' },
  { code: 'vase-shape-8',  label: 'Shape 8',  photo: VASE_BUCKET + 'vase-shape8-291x405.png' },
  { code: 'vase-shape-9',  label: 'Shape 9',  photo: VASE_BUCKET + 'vase-shape9-241x405.png' },
  { code: 'vase-shape-10', label: 'Shape 10', photo: VASE_BUCKET + 'vase-shape10-296x405.png' },
  { code: 'vase-shape-11', label: 'Shape 11', photo: VASE_BUCKET + 'vase-shape11-298x405.png' },
  { code: 'vase-shape-12', label: 'Shape 12', photo: VASE_BUCKET + 'vase-shape12-300x405.png' },
]

const vaseColorUpcharge = (colorCode) => {
  if (!colorCode) return 0
  const c = GRANITE_COLORS.find(x => x.code === colorCode)
  return c?.premium ?? 0
}
const computeVasePrice = (sizeCode, colorCode) => {
  const s = VASE_SIZES.find(x => x.code === sizeCode)
  if (!s) return 0
  return Math.round(s.basePrice * (1 + vaseColorUpcharge(colorCode)))
}

// ---- Vase fit verification math (locked, per CLAUDE.md) -------------------
// Symmetric 2-vase layout: [outer][vase][gap][die][gap][vase][outer]
// Floor = absolute minimum (1.5" per gap). Ideal = recommendation target
// (aims for 2" per gap). Depth: base_D ≥ vase_D + 2".
const dieWidthFromOrder = (order) => {
  const shape = SHAPES.find(s => s.code === order.shape)
  if (!shape) return null
  const stdSize = order.standardSizeCode
    ? shape.standardSizes?.find(s => s.code === order.standardSizeCode)
    : null
  const w = stdSize?.w ?? Number(order.width)
  return Number.isFinite(w) && w > 0 ? w : null
}
const baseWidthFromOrder = (order) => {
  if (!order.baseConfig?.include) return null
  if (order.baseConfig.sizeCode === 'custom') {
    const w = Number(order.baseConfig.width)
    return Number.isFinite(w) && w > 0 ? w : null
  }
  const bs = BASE_SIZES.find(b => b.code === order.baseConfig.sizeCode)
  return bs?.w ?? null
}
const baseDepthFromOrder = (order) => {
  if (!order.baseConfig?.include) return null
  if (order.baseConfig.sizeCode === 'custom') {
    const d = Number(order.baseConfig.depth)
    return Number.isFinite(d) && d > 0 ? d : null
  }
  const bs = BASE_SIZES.find(b => b.code === order.baseConfig.sizeCode)
  return bs?.d ?? null
}

// Recommended base width to fit n vases of width vaseW alongside the die.
const recommendedBaseWidth = (dieW, vaseW, n) => {
  if (!dieW) return null
  if (n <= 0) return Math.ceil(dieW + 12)
  if (n === 1) return Math.ceil(dieW + vaseW + 4)
  return Math.ceil(dieW + 2 * vaseW + 8)
}

// Per-size fit check at a given configuration (numVasesAfter = the count
// after adding this vase). Returns { status, requiredW, requiredD }.
const computeVaseFit = (vaseSize, order, numVasesAfter) => {
  const v = VASE_SIZES.find(s => s.code === vaseSize)
  if (!v) return { status: 'unknown' }
  const dieW = dieWidthFromOrder(order)
  const baseW = baseWidthFromOrder(order)
  const baseD = baseDepthFromOrder(order)
  if (!dieW || !baseW) {
    return { status: 'unknown', missingBase: !baseW, missingDie: !dieW }
  }
  const n = Math.max(1, numVasesAfter)
  const widthFloor = n === 1 ? dieW + v.w + 3 : dieW + 2 * v.w + 6
  const widthIdeal = n === 1 ? dieW + v.w + 4 : dieW + 2 * v.w + 8
  const depthFloor = v.d + 2
  const depthOk = baseD == null ? true : baseD >= depthFloor
  if (baseW < widthFloor || !depthOk) {
    return { status: 'red', floorMet: false, requiredW: widthFloor, requiredD: depthFloor, dieW, vaseW: v.w, vaseD: v.d, n }
  }
  if (baseW < widthIdeal) {
    return { status: 'yellow', floorMet: true, requiredW: widthIdeal, dieW, vaseW: v.w, vaseD: v.d, n }
  }
  return { status: 'green', floorMet: true, dieW, vaseW: v.w, vaseD: v.d, n }
}

// Recommended vase size given die width (independent of base fit).
const dieRecommendedVaseSize = (dieW) => {
  if (!dieW) return '5x5x9'
  if (dieW <= 36) return '4x4x10'
  if (dieW <= 48) return '5x5x9'
  if (dieW <= 60) return '6x6x10'
  return '8x8x12'
}

// ---- Shape-carved designs (only shown when Shape Carved is selected) ------
// Prices from the pricing sheet.
const SHAPE_CARVED_DESIGNS = [
  { code: 'rose-1',         label: 'Rose (1)',                  price: 525  },
  { code: 'rose-2',         label: 'Roses (pair, $495 each)',   price: 990  },
  { code: 'scallop-cross',  label: 'Scallop Cross',             price: 1345 },
  { code: 'leaves',         label: 'Leaves',                    price: 425  },
  { code: 'logo',           label: 'Logo / Custom Carving',     price: 1505 },
  { code: 'etched-12x12',   label: 'Etched 12x12',              price: 695  },
  { code: 'shape-custom',   label: 'Custom shape carving (set price)', price: 0, custom: true },
]
const SHAPE_CARVED_CODES = SHAPE_CARVED_DESIGNS.map(d => d.code)

// ---- Photo types & sizes (from photo chart on the wall) -------------------
const PHOTO_TYPES = [
  { code: 'porcelain', label: 'Porcelain Photo' },
  { code: 'stainless', label: 'Stainless Photo' },
]

const PHOTO_SIZES = [
  { code: 'xs',  label: 'X-Small', dim: '2.76″ × 3.54″', porcelain: 325, stainless: 397 },
  { code: 's',   label: 'Small',   dim: '3.15″ × 3.94″', porcelain: 350, stainless: 422 },
  { code: 'm',   label: 'Medium',  dim: '3.54″ × 4.72″', porcelain: 375, stainless: 447 },
  { code: 'l',   label: 'Large',   dim: '3.94″ × 5.12″', porcelain: 400, stainless: 472 },
  { code: 'xl',  label: 'X-Large', dim: '4.33″ × 5.91″', porcelain: 425, stainless: 497 },
]

// ---- Add-ons catalog (Sprint 3 — drives the Add-Ons step) -----------------
// Carvings + Photo are NOT in this catalog — they're rendered as custom
// sections in the AddOnsStep with their own picker UIs.
const ADD_ONS_CATALOG = [
  // Custom design — auto-added when customer picks "Custom Design" in the
  // Design step. Custom price (starts at $175); salesperson can adjust.
  { code: 'custom-design',  label: 'Custom Design Fee',         category: 'Custom design', price: 175, custom: true },

  // Vase entries are owned by the Sprint 3p.3 Vase configurator (sizes/shapes/
  // colors with fit verification). The old '24x14 M Unitized Vase Panel'
  // catalog row was retired in Sprint 3s. Existing saved orders that already
  // had 'unitized-vase' in their addOns still render fine — buildLineItems
  // falls back to the addon's own label when the catalog lookup misses.

  // Lettering (mainly for inscription services on existing stones)
  { code: 'lett-year',      label: 'Lettering: Year Only',       category: 'Lettering', price: 495 },
  { code: 'lett-mdy',       label: 'Lettering: Month/Day/Year',  category: 'Lettering', price: 550 },
  { code: 'lett-full',      label: 'Lettering: Full Inscription',category: 'Lettering', price: 695 },

  // Veteran setups
  { code: 'granite-vet-fdn',label: 'Granite VET + FDN + Set',    category: 'Veteran',  price: 995  },
  { code: 'granite-vet',    label: 'Granite VET + Set (no FDN)', category: 'Veteran',  price: 550  },
  { code: 'bronze-vet-fdn', label: 'Bronze VET Base + FDN + Set',category: 'Veteran',  price: 1895 },
  { code: 'bronze-vet',     label: 'Bronze VET Base (no FDN)',   category: 'Veteran',  price: 1125 },

  // Cemetery permit — always custom (varies per cemetery; some don't need one)
  // FUTURE: when cemetery_permit_default_fee data is gathered, auto-populate
  // the price based on the cemetery selected on this order. Stays custom for now.
  { code: 'permit',         label: 'Cemetery Permit',            category: 'Cemetery Fees', price: 0,  custom: true },

  // Delivery
  { code: 'delivery-local', label: 'Local Delivery',             category: 'Delivery', price: 0,  custom: true },
  { code: 'delivery-long',  label: 'Long-Distance Delivery',     category: 'Delivery', price: 0,  custom: true },
]

// ---- Pricing constants ----------------------------------------------------
const NJ_TAX_RATE     = 0.06625   // 6.625% NJ state sales tax
const CC_SURCHARGE    = 0.03      // 3% credit card surcharge (optional)
const FOUNDATION_RATE = {         // $ per square inch — per pricing sheet header:
  slant:        2.25,             //   "FDN: $2.85 Sq In / Slant: $2.25 / Grass: $2.00"
  'double-slant':2.25,            // Slants get the $2.25 rate
  grass:        2.00,             // Grass markers get the $2.00 rate
  hickey:       2.85,             // Everything else gets the default $2.85 FDN rate
  bronze:       2.85,
  die:          2.85,
  'double-die': 2.85,
  custom:       2.85,
  civic:        2.85,
  mausoleum:    0,                // mausoleums don't use this calc
}
const CUSTOM_FONT_FEE = 100       // applies on INSCRIPTION services only


// ---- Granite colors (must match files in public/granite/) ------------------
// Premiums from pricing sheet — applied as a multiplier on base later (Sprint 3).
const GRANITE_COLORS = [
  // Gray family
  { code: 'medium-barre-grey', label: 'Barre Grey',           origin: 'Vermont', file: 'medium-barre-grey.jpg', family: 'gray',     popular: true,  premium: 0    },
  { code: 'legacy-gray',       label: 'Legacy Gray',       origin: 'China',   file: 'legacy-gray.jpg',       family: 'gray',     popular: false, premium: 0    },
  { code: 'st-cloud-grey',     label: 'St. Cloud Grey',    origin: 'Minnesota', file: 'st-cloud-grey.jpg',   family: 'gray',     popular: false, premium: 0    },
  { code: 'cloud-gray',        label: 'Cloud Gray',        origin: 'Georgia, USA', file: 'cloud-gray.png',   family: 'gray',     popular: false, premium: 0    },

  // Black family
  { code: 'jet-black',         label: 'Jet Black',         origin: 'China',   file: 'jet-black.jpg',         family: 'black',    popular: true,  premium: 0.25 },
  { code: 'american-black',    label: 'American Black',    origin: 'Pennsylvania', file: 'american-black.jpg', family: 'black',  popular: false, premium: 0    },
  { code: 'flash-impala-black',label: 'Flash Impala Black',origin: 'S. Africa', file: 'flash-impala-black.jpg', family: 'black', popular: false, premium: 0   },

  // Blue family
  { code: 'bahama-blue',       label: 'Bahama Blue',       origin: 'India',   file: 'bahama-blue.jpg',       family: 'blue',     popular: true,  premium: 0.30 },

  // Pink family
  { code: 'mountain-rose',     label: 'Mountain Rose',     origin: 'Canada',  file: 'mountain-rose.jpg',     family: 'pink',     popular: true,  premium: 0.35 },
  { code: 'colonial-rose',     label: 'Colonial Rose',     origin: 'Canada',  file: 'colonial-rose.jpg',     family: 'pink',     popular: false, premium: 0    },
  { code: 'salisbury-pink',    label: 'Salisbury Pink',    origin: 'N. Carolina', file: 'salisbury-pink.jpg', family: 'pink',    popular: false, premium: 0    },

  // Red family
  { code: 'india-red',         label: 'India Red',         origin: 'India',   file: 'india-red.jpg',         family: 'red',      popular: true,  premium: 0.35 },
  { code: 'missouri-red',      label: 'Missouri Red',      origin: 'Missouri',file: 'missouri-red.jpg',      family: 'red',      popular: false, premium: 0    },

  // Mahogany family
  { code: 'dakota-mahogany',   label: 'Dakota Mahogany',   origin: 'S. Dakota', file: 'dakota-mahogany.jpg', family: 'mahogany', popular: false, premium: 0.35 },
  { code: 'royal-mahogany',    label: 'Royal Mahogany',    origin: 'S. Dakota', file: 'royal-mahogany.jpg',  family: 'mahogany', popular: false, premium: 0.35 },

  // Green family
  { code: 'china-evergreen',   label: 'China Evergreen',   origin: 'China',   file: 'china-evergreen.jpg',   family: 'green',    popular: false, premium: 0    },

  // Multi/Other family
  { code: 'cats-eye-brown',    label: 'Cat\'s Eye Brown',  origin: 'India',   file: 'cats-eye.jpg',          family: 'multi',    popular: true,  premium: 0.35 },
  { code: 'paradiso',          label: 'Paradiso',          origin: 'India',   file: 'paradiso.jpg',          family: 'multi',    popular: false, premium: 0    },
]

const COLOR_FAMILY_LABELS = {
  gray: 'Gray', black: 'Black', blue: 'Blue', pink: 'Pink', red: 'Red',
  mahogany: 'Mahogany', green: 'Green', multi: 'Multi / Other',
}

// CSS hex hint per color family — used to tint the live preview when no design
// is selected. Approximate; not a substitute for the actual photo swatch.
const COLOR_FAMILY_HEX = {
  gray: '#8e918e', black: '#1a1a1a', blue: '#3a4d63', pink: '#c4a5a5', red: '#7a3a3a',
  mahogany: '#3d1f1a', green: '#2d3a2c', multi: '#6b554a',
}

// ---- Symbols / elements (multi-select for design filtering, Step 7) -------
// Each entry has matchers — keywords we look for in monument cats/tags fields.
const SYMBOLS = [
  { code: 'cross',     label: 'Cross',          icon: '✝',  matchers: ['cross', 'christian', 'religious'] },
  { code: 'jesus',     label: 'Jesus',          icon: '🙏', matchers: ['jesus', 'christ', 'savior'] },
  { code: 'angel',     label: 'Angels',         icon: '👼', matchers: ['angel'] },
  { code: 'praying',   label: 'Praying Hands',  icon: '🤲', matchers: ['praying hands', 'praying'] },
  { code: 'mary',      label: 'Mary / Madonna', icon: '☧',  matchers: ['mary', 'madonna', 'virgin'] },
  { code: 'jewish',    label: 'Star of David',  icon: '✡',  matchers: ['jewish', 'star of david'] },
  { code: 'menorah',   label: 'Menorah',        icon: '🕎', matchers: ['menorah'] },
  { code: 'rose',      label: 'Roses',          icon: '🌹', matchers: ['rose', 'roses'] },
  { code: 'flower',    label: 'Flowers',        icon: '🌸', matchers: ['floral', 'flower', 'flowers', 'lily', 'lilies', 'tulip'] },
  { code: 'heart',     label: 'Hearts',         icon: '❤',  matchers: ['heart', 'hearts'] },
  { code: 'dove',      label: 'Doves',          icon: '🕊', matchers: ['dove'] },
  { code: 'butterfly', label: 'Butterflies',    icon: '🦋', matchers: ['butterfly', 'butterflies'] },
  { code: 'tree',      label: 'Tree of Life',   icon: '🌳', matchers: ['tree', 'tree of life', 'oak'] },
  { code: 'scenic',    label: 'Scenic',         icon: '🌅', matchers: ['scenic', 'landscape', 'sunset', 'mountain'] },
  { code: 'veteran',   label: 'Veteran',        icon: '🎖', matchers: ['veteran', 'military', 'flag', 'army', 'navy'] },
  { code: 'pet',       label: 'Pet / Paw',      icon: '🐾', matchers: ['paw', 'pet', 'dog', 'cat'] },
  { code: 'music',     label: 'Music',          icon: '🎵', matchers: ['music', 'musical', 'note'] },
  { code: 'sport',     label: 'Sports',         icon: '⚽', matchers: ['sport', 'baseball', 'football', 'fishing', 'hunting'] },
]

// ---- Order status workflow -------------------------------------------------
const ORDER_STATUSES = [
  { code: 'draft',         label: 'Draft',         color: 'gray',    blurb: 'Not yet finalized; staff still gathering info.' },
  { code: 'scoping',       label: 'Scoping',       color: 'amber',   blurb: 'Pricing or cemetery info pending.' },
  { code: 'quoted',        label: 'Quoted',        color: 'blue',    blurb: 'Estimate generated and shared with customer.' },
  { code: 'contracted',    label: 'Contracted',    color: 'green',   blurb: 'Contract signed; deposit received.' },
  { code: 'in_production', label: 'In Production', color: 'purple',  blurb: 'Work in progress at the shop.' },
  { code: 'installed',     label: 'Installed',     color: 'navy',    blurb: 'Memorial installed at cemetery.' },
  { code: 'paid_in_full',  label: 'Paid in Full',  color: 'teal',    blurb: 'Balance collected — order financially closed.' },
  { code: 'closed',        label: 'Closed',        color: 'slate',   blurb: 'Fully complete — installed, paid, archived.' },
  { code: 'cancelled',     label: 'Cancelled',     color: 'red',     blurb: 'Order cancelled.' },
  { code: 'archived',      label: 'Archived',      color: 'slate',   blurb: 'Hidden from active views — recoverable from Archive.' },
]
// Statuses still considered "in flight" (show on the recent-orders dashboard)
const ACTIVE_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed']
// Statuses considered "archive territory" — hidden by default, shown in Archive filter
const ARCHIVE_STATUSES = ['archived']
// Statuses where the order can be safely cancelled (any active status + paid_in_full + closed,
// since you might still want to mark an in-production order cancelled)
const CANCELLABLE_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed', 'paid_in_full', 'closed']

// =============================================================================
// INITIAL STATE FACTORY
// =============================================================================

function makeBlankDeceased(position = 0, isReserved = false) {
  return {
    firstName: '',
    middleName: '',
    lastName: '',
    titlePrefix: '',
    titleRelations: [],   // multi-select array — Father, Husband, Brother, etc.
    title: '',            // final assembled string ("Beloved Father, Husband, & Brother")
    isReserved,
    dateOfBirth: '',
    dateOfDeath: '',
    isPreNeed: false,
    relationship: '',
    notes: '',
    position,
  }
}

function makeBlankOrder() {
  return {
    // Identifiers
    id: null,
    orderNumber: null,
    status: 'draft',
    salesRep: '',

    // Service types & family
    serviceTypes: [],
    otherServiceDescription: '',
    familyType: '',

    // Customer (full embedded; saved to customers table on save)
    customer: {
      id: null,
      firstName: '',
      lastName: '',
      email: '',
      emailAlt: '',
      phonePrimary: '',
      phoneAlt: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: 'NJ',
      zip: '',
      referralSource: '',         // how-did-you-hear-about-us — code from REFERRAL_SOURCES
      referralSourceDetail: '',   // free-text when source = 'other' or 'friend' (who referred)
      notes: '',
    },

    // Cemetery + plot (cemetery saved to cemeteries table; plot fields on order)
    cemetery: {
      id: null,
      name: '',
      address: '',
      city: '',
      state: 'NJ',
      zip: '',
      contactPhone: '',
      contactEmail: '',
      website: '',
      notes: '',
    },
    plot: {
      type: '',          // single / double / sxs / dd / family
      section: '',
      block: '',
      lot: '',
      row: '',
      space: '',
      grave: '',
      level: '',
      other: '',
      lat: null,
      lng: null,
      pinNotes: '',
    },

    // Match-to (any vendor; photo + description)
    matchingToDescription: '',

    // Deceased (one or more)
    deceased: [makeBlankDeceased(0)],

    // Stone config (Sprint 2 / 2.1)
    shape: null,                // SHAPES[].code (grass / hickey / slant / die / etc.)
    standardSizeCode: null,     // e.g. "slant-2-6" — null means custom
    graniteColor: null,         // GRANITE_COLORS[].code
    width: null,                // inches
    depth: null,                // inches (front-to-back)
    thickness: null,            // inches (varies by shape)
    height: null,               // inches — used for upright/custom

    topShape: null,             // TOP_SHAPES[].code (classic-serp, flat-top, etc.)
    sides: null,                // SIDES_OPTIONS[].code — auto-set from polish, overridable
    polishLevel: null,          // POLISH_LEVELS[].code (P2/P3/P5)

    customShape: null,          // when shape='custom' — Heart / Cross / etc.
    customShapeDescription: '', // free-text describe

    // Base sub-config — applies to slants/dies/double-die/bronze
    baseConfig: {
      include: false,           // for shapes where base is optional
      sizeCode: null,           // BASE_SIZES[].code
      width: null,              // inches (custom override)
      depth: null,
      heightCode: null,         // BASE_HEIGHTS[].code (6/8/10/12)
      polishMargin2in: false,   // 2" polished margin add-on
      sides: null,              // BASE_SIDES_OPTIONS[].code
    },

    // Design pick (Sprint 2)
    // Sprint 3r.2 — multi-select designs (up to 6).
    // designs[0] is the PRIMARY (carver replicates this); designs[1..5] are
    // ALTERNATES (inspiration / reference only).
    designs: [],                // [{ id, snapshot }, ...] — see supabase/multi_design_migration.sql
    elementFilters: [],         // SYMBOLS[].code list, used during design browse
    designPreferences: '',      // free-text "describe what you want" notes
    useCustomDesign: false,     // Sprint 3c — true when "Custom Design" is picked

    // Inscription (Sprint 2)
    inscription: {
      type: null,               // 'full' | 'date' | 'year' — for inscription-only services
      epitaph: '',              // free-text scripture/saying
      customNotes: '',          // anything else for the engraver
      customFont: false,        // boolean — only chargeable on inscription services
      customFontDescription: '',
      preExistingPhotoUrl: '',  // photo of existing marker (Storage URL)
      preExistingPhotoPath: '', // storage path for delete on retry
    },

    // Add-ons (Sprint 3) — array of { code, qty, price, notes }
    addOns: [],

    // Pricing (Sprint 3) — overrides + tax/surcharge toggles
    pricing: {
      overrides: {},            // line-item code -> override amount (number)
      customLineItems: [],      // [{ id, label, amount }]
      applyTax: true,           // default on for NJ
      applyCCSurcharge: false,
      foundationCalc: true,     // include foundation auto-calculation
      foundationOverride: null, // manual override of the auto sq-in calculation
      discountPct: 0,           // 0-100; applied to subtotal excluding Cemetery Permit
      notes: '',
    },

    // Signatures + contract conversion (Sprint 3b)
    customerSignature: null,        // base64 data URL while drawing (pre-upload)
    repSignature: null,
    customerSignatureUrl: null,     // public URL after upload (persisted)
    customerSignaturePath: null,
    repSignatureUrl: null,
    repSignaturePath: null,
    signedAt: null,                 // ISO timestamp when conversion happened
    pricingLockedAt: null,          // ISO timestamp when pricing was locked

    // Sprint 3i — production timeline / rush
    rushOrder: false,
    rushFeesPerService: {},
    targetCompletionDate: null,
    targetCompletionEndDate: null,  // Sprint S1 — mausoleum range "latest" date; null for non-mausoleum
    cemeteryDeadline: null,
    timelineNotes: '',

    // Sprint 3i — deposit / payment tracking
    depositAmount: null,
    depositMethod: null,
    depositRef: null,
    depositReceivedAt: null,
    balanceAmount: null,
    balanceMethod: null,
    balanceRef: null,
    balanceReceivedAt: null,
    // Sprint M2 Phase 1 — multi-payment array. Phase 1: shadow column only —
    // the UI still reads/writes the legacy deposit_*/balance_* fields above;
    // payments[] is shadow-populated on read via synthesizePaymentsFromLegacy.
    payments: [],

    // Sprint 3i — soft cancel
    cancelledAt: null,
    cancelReason: null,
    cancelNotes: '',

    // Sprint 3i — multi-quote per customer
    parentQuoteId: null,

    // Sprint 3i — Mausoleum intake (only used when service includes MAUSOLEUM)
    mausoleumIntake: {
      capacity: '', footprint: '', colorPreference: '',
      style: '', roofStyle: '', features: [],
      vision: '', siteVisitNeeded: true, customQuotedPrice: null,
    },

    // Internal staff notes
    staffNotes: [],
  }
}

// =============================================================================
// DATABASE HELPERS
// =============================================================================

// Generate a new order number via the SQL function we created
async function generateOrderNumber() {
  const { data, error } = await supabase.rpc('next_order_number')
  if (error) {
    console.error('next_order_number error:', error)
    // Fallback: client-side timestamp (won't collide for ~milliseconds)
    return 'E-26-' + String(Date.now()).slice(-4)
  }
  return data
}

// Search customers by name or phone (case-insensitive starts-with on lastname,
// or contains on phone digits).
async function searchCustomers(query) {
  const q = query.trim()
  if (!q) return []
  const digits = q.replace(/\D/g, '')

  const filters = []
  if (q.length >= 2) {
    filters.push(`last_name.ilike.${q}%`)
    filters.push(`first_name.ilike.${q}%`)
  }
  if (digits.length >= 3) {
    filters.push(`phone_primary.ilike.%${digits}%`)
    filters.push(`phone_alt.ilike.%${digits}%`)
  }
  if (filters.length === 0) return []

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(filters.join(','))
    .order('last_name')
    .limit(8)
  if (error) { console.error('searchCustomers error:', error); return [] }
  return data || []
}

// Search cemeteries by name (starts-with, case-insensitive)
async function searchCemeteries(query) {
  const q = query.trim()
  if (!q || q.length < 1) return []
  const { data, error } = await supabase
    .from('cemeteries')
    .select('*')
    .ilike('name', `${q}%`)
    .order('name')
    .limit(8)
  if (error) { console.error('searchCemeteries error:', error); return [] }
  return data || []
}

// Upsert a customer; returns the row including id
async function upsertCustomer(customer) {
  if (customer.id) {
    const { data, error } = await supabase
      .from('customers')
      .update(customerToRow(customer))
      .eq('id', customer.id)
      .select()
      .single()
    if (error) { console.error('updateCustomer error:', error); return null }
    return data
  }
  const { data, error } = await supabase
    .from('customers')
    .insert(customerToRow(customer))
    .select()
    .single()
  if (error) { console.error('insertCustomer error:', error); return null }
  return data
}

// Upsert a cemetery; returns the row including id
async function upsertCemetery(cem) {
  if (cem.id) {
    const { data, error } = await supabase
      .from('cemeteries')
      .update(cemeteryToRow(cem))
      .eq('id', cem.id)
      .select()
      .single()
    if (error) { console.error('updateCemetery error:', error); return null }
    return data
  }
  const { data, error } = await supabase
    .from('cemeteries')
    .insert(cemeteryToRow(cem))
    .select()
    .single()
  if (error) { console.error('insertCemetery error:', error); return null }
  return data
}

// Save the order (creates if no id, updates if has id). Saves customer
// and cemetery records first to populate FKs.
async function saveOrder(order) {
  // Sanity: must have at least a service type or a name to save
  const hasSubstance =
    order.serviceTypes.length > 0 ||
    order.customer.firstName ||
    order.customer.lastName ||
    order.deceased.some(d => d.firstName || d.lastName)
  if (!hasSubstance) return { ok: false, reason: 'empty' }

  // Step 1: customer (only save if has any data)
  let customerId = order.customer.id
  if (order.customer.firstName || order.customer.lastName || order.customer.phonePrimary) {
    const saved = await upsertCustomer(order.customer)
    customerId = saved?.id || null
  }

  // Step 2: cemetery (only save if has a name)
  let cemeteryId = order.cemetery.id
  if (order.cemetery.name) {
    const saved = await upsertCemetery(order.cemetery)
    cemeteryId = saved?.id || null
  }

  // Step 3: order
  const orderRow = orderToRow({
    ...order,
    customer: { ...order.customer, id: customerId },
    cemetery: { ...order.cemetery, id: cemeteryId },
  })

  if (order.id) {
    const { data, error } = await supabase
      .from('orders')
      .update(orderRow)
      .eq('id', order.id)
      .select()
      .single()
    if (error) { console.error('updateOrder error:', error); return { ok: false, error } }
    return { ok: true, order: rowToOrder(data, order.customer, order.cemetery), customerId, cemeteryId }
  }

  // New order: generate number first
  const orderNumber = order.orderNumber || (await generateOrderNumber())
  const { data, error } = await supabase
    .from('orders')
    .insert({ ...orderRow, order_number: orderNumber })
    .select()
    .single()
  if (error) { console.error('insertOrder error:', error); return { ok: false, error } }
  return { ok: true, order: rowToOrder(data, order.customer, order.cemetery), customerId, cemeteryId }
}

// List recent draft orders for the resume screen (kept for back-compat)
async function listDraftOrders(limit = 6) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .in('status', ['draft', 'scoping'])
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) { console.error('listDraftOrders error:', error); return [] }
  return data || []
}

// Sprint 3i — list every order ever created for a given customer, newest first.
async function listOrdersForCustomer(customerId) {
  if (!customerId) return []
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false })
  if (error) { console.error('listOrdersForCustomer:', error); return [] }
  return data || []
}

// Sprint 3i — broad order listing for the dashboard view.
// Filters:
//   statuses: array of status codes (or null for all)
//   search:   free-text matched against order_number + customer first/last name
//   limit:    max rows
// Returns rows with customer + cemetery joined.
async function listOrders({ statuses, search, limit = 50 } = {}) {
  let q = supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (statuses && statuses.length > 0) q = q.in('status', statuses)

  const { data, error } = await q
  if (error) { console.error('listOrders error:', error); return [] }

  if (!search || !search.trim()) return data || []
  // Client-side search across the joined fields (Supabase's .or() with joins
  // is awkward; a few hundred rows is trivially fast in JS).
  const needle = search.trim().toLowerCase()
  return (data || []).filter(row => {
    const num    = (row.order_number || '').toLowerCase()
    const cust   = row.customer
    const first  = (cust?.first_name || '').toLowerCase()
    const last   = (cust?.last_name || '').toLowerCase()
    const email  = (cust?.email || '').toLowerCase()
    const phone  = (cust?.phone_primary || '').toLowerCase()
    return num.includes(needle) || first.includes(needle) || last.includes(needle)
        || email.includes(needle) || phone.includes(needle)
        || `${first} ${last}`.includes(needle)
  })
}

// Load a single order by id, with customer + cemetery joined
async function loadOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .eq('id', orderId)
    .single()
  if (error) { console.error('loadOrder error:', error); return null }
  return rowToOrder(data, data.customer, data.cemetery)
}

// Fetch the full monuments catalog for the Design step. We page through 1k at
// a time because Supabase caps at 1000 per request. The result is cached on
// the module (singleton) so reaching the Design step a second time is instant.
let _monumentsCache = null
async function fetchMonuments() {
  if (_monumentsCache) return _monumentsCache
  let all = []
  let from = 0
  const batchSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('monuments')
      .select('*')
      .range(from, from + batchSize - 1)
    if (error) { console.error('fetchMonuments error:', error); break }
    if (!data || data.length === 0) break
    all = [...all, ...data]
    if (data.length < batchSize) break
    from += batchSize
  }
  _monumentsCache = all
  return all
}

// Upload a file to Supabase Storage, return public URL + path
async function uploadAttachment(file, orderId) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const safeOrder = orderId || 'pending-' + Date.now()
  const path = `${safeOrder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('orders-attachments')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (upErr) { console.error('uploadAttachment error:', upErr); return null }
  const { data: urlData } = supabase.storage
    .from('orders-attachments')
    .getPublicUrl(path)
  return { url: urlData.publicUrl, path }
}

// Upload a base64 signature data URL as a PNG to storage. Returns { url, path }.
// `who` is 'customer' or 'rep'.
async function uploadSignature(dataUrl, who, orderId) {
  if (!dataUrl) throw new Error('No signature data to upload')
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const safeOrder = orderId || 'pending-' + Date.now()
  const path = `${safeOrder}/signatures/${who}-${Date.now()}.png`
  const { error: upErr } = await supabase.storage
    .from('orders-attachments')
    .upload(path, blob, { upsert: true, contentType: 'image/png' })
  if (upErr) { throw new Error('Signature upload failed: ' + upErr.message) }
  const { data: urlData } = supabase.storage
    .from('orders-attachments')
    .getPublicUrl(path)
  return { url: urlData.publicUrl, path }
}

// ---- Row conversion helpers (camelCase ↔ snake_case) ------------------------

function customerToRow(c) {
  return {
    first_name: c.firstName?.trim() || '',
    last_name: c.lastName?.trim() || '',
    email: c.email?.trim() || null,
    email_alt: c.emailAlt?.trim() || null,
    phone_primary: c.phonePrimary?.trim() || null,
    phone_alt: c.phoneAlt?.trim() || null,
    address_line1: c.addressLine1?.trim() || null,
    address_line2: c.addressLine2?.trim() || null,
    city: c.city?.trim() || null,
    state: c.state?.trim() || 'NJ',
    zip: c.zip?.trim() || null,
    referral_source: c.referralSource || null,
    referral_source_detail: c.referralSourceDetail?.trim() || null,
    notes: c.notes?.trim() || null,
  }
}

function cemeteryToRow(c) {
  return {
    name: c.name?.trim() || '',
    address: c.address?.trim() || null,
    city: c.city?.trim() || null,
    state: c.state?.trim() || 'NJ',
    zip: c.zip?.trim() || null,
    contact_phone: c.contactPhone?.trim() || null,
    contact_email: c.contactEmail?.trim() || null,
    website: c.website?.trim() || null,
    notes: c.notes?.trim() || null,
  }
}

function orderToRow(order) {
  // Sprint M2 Phase 2 — authority reversal: payments[] is authoritative, the
  // legacy deposit_*/balance_* columns are mirrored from the first two entries.
  // For payments.length 3+, only the first 2 are reflected in legacy columns;
  // consumers that need accurate totals must read from payments[] directly. The
  // stonebooksData.js helpers were patched in this same commit to sum payments[]
  // when present, closing the consumer-undercount window for the most-trafficked
  // surfaces.
  const payments = Array.isArray(order.payments) ? order.payments : []
  const p0 = payments[0] || null
  const p1 = payments[1] || null

  return {
    status: order.status,
    sales_rep: order.salesRep || null,
    customer_id: order.customer.id || null,
    cemetery_id: order.cemetery.id || null,
    service_types: order.serviceTypes || [],
    other_service_description: order.otherServiceDescription || null,
    family_type: order.familyType || null,

    plot_type: order.plot.type || null,
    plot_section: order.plot.section || null,
    plot_block: order.plot.block || null,
    plot_lot: order.plot.lot || null,
    plot_row: order.plot.row || null,
    plot_space: order.plot.space || null,
    plot_grave: order.plot.grave || null,
    plot_level: order.plot.level || null,
    plot_other: order.plot.other || null,
    plot_lat: order.plot.lat ?? null,
    plot_lng: order.plot.lng ?? null,
    plot_pin_notes: order.plot.pinNotes || null,

    matching_to_description: order.matchingToDescription || null,

    shape: order.shape || null,
    standard_size_code: order.standardSizeCode || null,
    granite_color: order.graniteColor || null,
    width_inches: order.width ?? null,
    depth_inches: order.depth ?? null,
    thickness_inches: order.thickness ?? null,
    height_inches: order.height ?? null,

    top_shape: order.topShape || null,
    sides: order.sides || null,
    polish_level: order.polishLevel || null,

    custom_shape: order.customShape || null,
    custom_shape_desc: order.customShapeDescription || null,
    base_config: order.baseConfig || {},

    // Sprint 3r.2 — designs[] is the source of truth; design_id/design_snapshot
    // mirror designs[0] for backward read-compatibility only.
    designs: order.designs || [],
    design_id: order.designs?.[0]?.id || null,
    design_snapshot: order.designs?.[0]?.snapshot || null,
    element_filters: order.elementFilters || [],
    design_preferences: order.designPreferences || null,
    use_custom_design: order.useCustomDesign || false,

    inscription: order.inscription || {},

    add_ons: order.addOns || [],
    pricing: order.pricing || {},

    // Signatures + contract conversion (Sprint 3b)
    customer_signature_url: order.customerSignatureUrl || null,
    customer_signature_path: order.customerSignaturePath || null,
    rep_signature_url: order.repSignatureUrl || null,
    rep_signature_path: order.repSignaturePath || null,
    signed_at: order.signedAt || null,
    pricing_locked_at: order.pricingLockedAt || null,

    // Sprint 3i — production / deposit / cancel / mausoleum / parent
    rush_order: order.rushOrder || false,
    rush_fees_per_service: order.rushFeesPerService || {},
    target_completion_date: order.targetCompletionDate || null,
    target_completion_end_date: order.targetCompletionEndDate || null,
    cemetery_deadline: order.cemeteryDeadline || null,
    timeline_notes: order.timelineNotes || null,
    // Sprint M2 Phase 2 — legacy columns derived FROM payments[] (see header
    // comment). payments[] is the source of truth; these are write-shadow.
    deposit_amount: p0 ? p0.amount : null,
    deposit_method: p0 ? p0.method : null,
    deposit_ref: p0 ? p0.ref : null,
    deposit_received_at: p0 ? p0.receivedAt : null,
    balance_amount: p1 ? p1.amount : null,
    balance_method: p1 ? p1.method : null,
    balance_ref: p1 ? p1.ref : null,
    balance_received_at: p1 ? p1.receivedAt : null,
    payments: payments,
    cancelled_at: order.cancelledAt || null,
    cancel_reason: order.cancelReason || null,
    cancel_notes: order.cancelNotes || null,
    parent_quote_id: order.parentQuoteId || null,
    mausoleum_intake: order.mausoleumIntake || null,

    deceased: order.deceased || [],
    staff_notes: order.staffNotes || [],
  }
}

// Sprint M2 Phase 2 — the single source of payment ids. crypto.randomUUID()
// is available in the Vite build environment and all evergreen browsers; if a
// future environment lacks it, this is the one place to patch.
function newPaymentId() {
  return crypto.randomUUID()
}

// Sprint M2 Phase 1 — synthesize a payments[] array from the legacy
// deposit_*/balance_* columns. Used as the read-fallback in rowToOrder when
// the new payments column is empty (i.e. every order that pre-dates the
// payments[] migration). Keyed off amount != null to match the UI's gating
// (PaymentTrackingSection shows a slot only when its amount is set). Null
// ref/receivedAt are preserved, not fabricated. Method defaults to 'check'
// defensively for legacy rows that somehow lack one.
function synthesizePaymentsFromLegacy(row) {
  const synthesized = []

  // Deposit entry — only synthesize if the amount is set.
  if (row.deposit_amount != null) {
    synthesized.push({
      id: `legacy-deposit-${row.id}`,
      amount: row.deposit_amount,
      method: row.deposit_method || 'check',
      ref: row.deposit_ref || null,
      receivedAt: row.deposit_received_at || null,
      createdAt: row.created_at || new Date(0).toISOString(),  // best-effort — order creation time
      createdBy: null,  // unknown for legacy data
      note: null,
      voided: false,
      voidedReason: null,
      voidedAt: null,
      voidedBy: null,
    })
  }

  // Balance entry — synthesize if the balance amount is set, regardless of
  // whether the deposit is set (handles the clearDeposit-then-balance-only
  // edge case).
  if (row.balance_amount != null) {
    synthesized.push({
      id: `legacy-balance-${row.id}`,
      amount: row.balance_amount,
      method: row.balance_method || 'check',
      ref: row.balance_ref || null,
      receivedAt: row.balance_received_at || null,
      createdAt: row.created_at || new Date(0).toISOString(),
      createdBy: null,
      note: null,
      voided: false,
      voidedReason: null,
      voidedAt: null,
      voidedBy: null,
    })
  }

  return synthesized
}

function rowToOrder(row, customerRow, cemeteryRow) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status || 'draft',
    salesRep: row.sales_rep || '',

    serviceTypes: row.service_types || [],
    otherServiceDescription: row.other_service_description || '',
    familyType: row.family_type || '',

    customer: customerRow ? rowToCustomer(customerRow) : makeBlankOrder().customer,
    cemetery: cemeteryRow ? rowToCemetery(cemeteryRow) : makeBlankOrder().cemetery,

    plot: {
      type: row.plot_type || '',
      section: row.plot_section || '',
      block: row.plot_block || '',
      lot: row.plot_lot || '',
      row: row.plot_row || '',
      space: row.plot_space || '',
      grave: row.plot_grave || '',
      level: row.plot_level || '',
      other: row.plot_other || '',
      lat: row.plot_lat,
      lng: row.plot_lng,
      pinNotes: row.plot_pin_notes || '',
    },

    matchingToDescription: row.matching_to_description || '',

    deceased: (row.deceased && row.deceased.length > 0)
      ? row.deceased
      : [makeBlankDeceased(0)],

    shape: row.shape || null,
    standardSizeCode: row.standard_size_code || null,
    graniteColor: row.granite_color || null,
    width: row.width_inches,
    depth: row.depth_inches,
    thickness: row.thickness_inches,
    height: row.height_inches,

    topShape: row.top_shape || null,
    sides: row.sides || null,
    polishLevel: row.polish_level || null,

    customShape: row.custom_shape || null,
    customShapeDescription: row.custom_shape_desc || '',
    baseConfig: row.base_config || {
      include: false, sizeCode: null, width: null, depth: null,
      heightCode: null, polishMargin2in: false, sides: null,
    },

    // Sprint 3r.2 — prefer the multi-design column; fall back to the legacy
    // single-design columns for orders saved before the migration ran.
    designs: Array.isArray(row.designs) && row.designs.length > 0
      ? row.designs
      : (row.design_id ? [{ id: row.design_id, snapshot: row.design_snapshot }] : []),
    elementFilters: row.element_filters || [],
    designPreferences: row.design_preferences || '',
    useCustomDesign: row.use_custom_design || false,

    inscription: row.inscription || {
      type: null, epitaph: '', customNotes: '', customFont: false,
      customFontDescription: '', preExistingPhotoUrl: '', preExistingPhotoPath: '',
    },

    addOns: row.add_ons || [],
    pricing: row.pricing || {
      overrides: {}, customLineItems: [], applyTax: true,
      applyCCSurcharge: false, foundationCalc: true, foundationOverride: null,
      discountPct: 0, notes: '',
    },

    // Signatures + contract conversion (Sprint 3b)
    customerSignature: null,           // ephemeral; load from URL instead
    repSignature: null,
    customerSignatureUrl: row.customer_signature_url || null,
    customerSignaturePath: row.customer_signature_path || null,
    repSignatureUrl: row.rep_signature_url || null,
    repSignaturePath: row.rep_signature_path || null,
    signedAt: row.signed_at || null,
    pricingLockedAt: row.pricing_locked_at || null,

    // Sprint 3i — production / deposit / cancel / mausoleum / parent
    rushOrder: row.rush_order || false,
    rushFeesPerService: row.rush_fees_per_service || {},
    targetCompletionDate: row.target_completion_date || null,
    targetCompletionEndDate: row.target_completion_end_date || null,
    cemeteryDeadline: row.cemetery_deadline || null,
    timelineNotes: row.timeline_notes || '',
    depositAmount: row.deposit_amount ?? null,
    depositMethod: row.deposit_method || null,
    depositRef: row.deposit_ref || null,
    depositReceivedAt: row.deposit_received_at || null,
    balanceAmount: row.balance_amount ?? null,
    balanceMethod: row.balance_method || null,
    balanceRef: row.balance_ref || null,
    balanceReceivedAt: row.balance_received_at || null,
    // Sprint M2 Phase 1 — read-fallback (matches the designs[] pattern): use
    // the payments column when populated, otherwise synthesize from the legacy
    // deposit_*/balance_* columns. The UI keeps reading the legacy fields above
    // in Phase 1; payments[] is a shadow until Phase 2.
    payments: Array.isArray(row.payments) && row.payments.length > 0
      ? row.payments
      : synthesizePaymentsFromLegacy(row),
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
    cancelNotes: row.cancel_notes || '',
    parentQuoteId: row.parent_quote_id || null,
    mausoleumIntake: row.mausoleum_intake || {
      capacity: '', footprint: '', colorPreference: '',
      style: '', roofStyle: '', features: [],
      vision: '', siteVisitNeeded: true, customQuotedPrice: null,
    },

    staffNotes: row.staff_notes || [],
  }
}

function rowToCustomer(row) {
  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email || '',
    emailAlt: row.email_alt || '',
    phonePrimary: row.phone_primary || '',
    phoneAlt: row.phone_alt || '',
    addressLine1: row.address_line1 || '',
    addressLine2: row.address_line2 || '',
    city: row.city || '',
    state: row.state || 'NJ',
    zip: row.zip || '',
    referralSource: row.referral_source || '',
    referralSourceDetail: row.referral_source_detail || '',
    notes: row.notes || '',
  }
}

function rowToCemetery(row) {
  return {
    id: row.id,
    name: row.name || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || 'NJ',
    zip: row.zip || '',
    contactPhone: row.contact_phone || '',
    contactEmail: row.contact_email || '',
    website: row.website || '',
    notes: row.notes || '',
  }
}

// =============================================================================
// SMALL UTILITIES
// =============================================================================

// Format a phone number for display: 7325551234 → (732) 555-1234
function formatPhone(s) {
  if (!s) return ''
  const d = String(s).replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return s
}

// Format a date in a friendly way
function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

// Time-since helper for activity indicators
function relativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return Math.round(sec / 60) + 'm ago'
  if (sec < 86400) return Math.round(sec / 3600) + 'h ago'
  if (sec < 86400 * 30) return Math.round(sec / 86400) + 'd ago'
  return formatDate(iso)
}

// Debounce hook
function useDebouncedValue(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// =============================================================================
// UI BUILDING BLOCKS
// =============================================================================

function Field({ label, children, required, hint, className = '', wide }) {
  return (
    <label className={`sm-field ${wide ? 'sm-field-wide' : ''} ${className}`}>
      <span className="sm-field-lab">
        {label}
        {required && <span className="sm-field-req">·</span>}
      </span>
      {children}
      {hint && <span className="sm-field-hint">{hint}</span>}
    </label>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', autoFocus, ...rest }) {
  return (
    <input
      className="sm-text-input"
      type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      {...rest}
    />
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      className="sm-textarea"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      dir="auto"
    />
  )
}

function SelectInput({ value, onChange, options, placeholder = '— select —' }) {
  return (
    <div className="sm-select-wrap">
      <select
        className="sm-select"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((opt, i) => (
          <option
            key={opt.value ?? opt ?? i}
            value={opt.value ?? opt}
            disabled={opt.disabled || false}
          >
            {opt.label ?? opt}
          </option>
        ))}
      </select>
      <span className="sm-select-chev">▾</span>
    </div>
  )
}

function ToggleChip({ on, onClick, children, disabled }) {
  return (
    <button
      type="button"
      className={`sm-chip ${on ? 'on' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="sm-chip-mark">{on ? '✓' : '+'}</span>
      <span className="sm-chip-label">{children}</span>
    </button>
  )
}

function CardOption({ on, onClick, title, blurb, icon, badge }) {
  return (
    <button type="button" className={`sm-card ${on ? 'on' : ''}`} onClick={onClick}>
      {badge && <span className="sm-card-badge">{badge}</span>}
      <div className="sm-card-icon">{icon}</div>
      <div className="sm-card-title">{title}</div>
      {blurb && <div className="sm-card-blurb">{blurb}</div>}
      {on && <div className="sm-card-check">✓</div>}
    </button>
  )
}

function Section({ title, eyebrow, children, right }) {
  return (
    <div className="sm-section">
      <div className="sm-section-head">
        <div>
          {eyebrow && <div className="sm-section-eyebrow">{eyebrow}</div>}
          {title && <div className="sm-section-title">{title}</div>}
        </div>
        {right}
      </div>
      <div className="sm-section-body">{children}</div>
    </div>
  )
}

function Divider() {
  return <div className="sm-divider" />
}

// =============================================================================
// SEARCH-WITH-DROPDOWN — used for customer & cemetery lookup
// =============================================================================

function SearchBox({
  query, onQueryChange,
  results, onPick,
  placeholder, renderResult,
  emptyHint = 'No matches yet — keep typing to search.',
  loading,
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className="sm-search" ref={wrapRef}>
      <input
        className="sm-text-input sm-search-input"
        type="text"
        value={query}
        onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      <span className="sm-search-icon">⌕</span>
      {open && query.trim().length >= 1 && (
        <div className="sm-search-pop">
          {loading && <div className="sm-search-row sm-search-loading">Searching…</div>}
          {!loading && results.length === 0 && <div className="sm-search-row sm-search-empty">{emptyHint}</div>}
          {!loading && results.map((r, i) => (
            <button
              key={r.id || i}
              type="button"
              className="sm-search-row sm-search-result"
              onClick={() => { onPick(r); setOpen(false) }}
            >
              {renderResult(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// STEP 1 — SERVICE TYPE (multi-select + family type + sales rep)
// =============================================================================

function ServiceTypeStep({ order, update, mode }) {
  const toggleService = (code) => {
    const has = order.serviceTypes.includes(code)
    update({
      serviceTypes: has
        ? order.serviceTypes.filter(c => c !== code)
        : [...order.serviceTypes, code],
    })
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step 1 of 4 · What are we doing?</div>
        <h1 className="sm-step-title">Service Type</h1>
        <p className="sm-step-lede">
          Pick everything that applies. A customer can want multiple at once
          (a new stone <em>and</em> a porcelain photo, for example).
        </p>
      </div>

      <Section title="Services" eyebrow="What's needed">
        <div className="sm-card-grid sm-card-grid-services">
          {SERVICE_TYPES.map(s => (
            <CardOption
              key={s.code}
              on={order.serviceTypes.includes(s.code)}
              onClick={() => toggleService(s.code)}
              title={s.label}
              blurb={s.blurb}
              icon={s.icon}
            />
          ))}
        </div>

        {order.serviceTypes.includes('OTHER') && (
          <div className="sm-other-box">
            <Field label="Briefly describe the job" wide required>
              <TextArea
                value={order.otherServiceDescription}
                onChange={v => update({ otherServiceDescription: v })}
                placeholder="e.g. Cleaning footstone, raising a sunken marker, paint a faded carving…"
                rows={3}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Memorial type" eyebrow="Who is this for">
        <div className="sm-chip-row">
          {FAMILY_TYPES.map(t => (
            <ToggleChip
              key={t.code}
              on={order.familyType === t.code}
              onClick={() => update({ familyType: order.familyType === t.code ? '' : t.code })}
            >
              {t.label}
            </ToggleChip>
          ))}
        </div>
        {order.familyType && (
          <div className="sm-helper">
            {FAMILY_TYPES.find(t => t.code === order.familyType)?.blurb}
          </div>
        )}
      </Section>

      {mode === 'staff' && (
        <Section title="Sales rep" eyebrow="Who's handling this">
          <div className="sm-chip-row">
            {SALES_REPS.map(rep => (
              <ToggleChip
                key={rep}
                on={order.salesRep === rep}
                onClick={() => update({ salesRep: order.salesRep === rep ? '' : rep })}
              >
                {rep}
              </ToggleChip>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// =============================================================================
// STEP 2 — CUSTOMER
// =============================================================================

function CustomerStep({ order, update }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debouncedQuery = useDebouncedValue(query, 300)
  const customer = order.customer

  // Run search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    searchCustomers(debouncedQuery).then(rows => {
      if (cancelled) return
      setResults(rows)
      setSearching(false)
    })
    return () => { cancelled = true }
  }, [debouncedQuery])

  const updateCustomer = (patch) => update({ customer: { ...customer, ...patch } })

  const pickExisting = (row) => {
    update({ customer: rowToCustomer(row) })
    setQuery('')
    setResults([])
  }

  const startNew = () => {
    update({ customer: { ...makeBlankOrder().customer } })
    setQuery('')
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step 2 of 4 · The family</div>
        <h1 className="sm-step-title">Customer</h1>
        <p className="sm-step-lede">
          The living family member ordering. Search by name or phone — if they
          already exist, click their record. Otherwise just fill in the form below.
        </p>
      </div>

      <Section title="Find existing" eyebrow="Search by name or phone">
        <SearchBox
          query={query}
          onQueryChange={setQuery}
          results={results}
          loading={searching}
          onPick={pickExisting}
          placeholder="Type a last name, first name, or phone…"
          emptyHint="No match — fill in the form below to create a new customer."
          renderResult={(r) => (
            <div>
              <div className="sm-result-line1">
                {r.last_name?.toUpperCase()}, {r.first_name}
              </div>
              <div className="sm-result-line2">
                {[formatPhone(r.phone_primary), r.email, [r.city, r.state].filter(Boolean).join(', ')]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        />
        {customer.id && (
          <div className="sm-existing-banner">
            <div>
              <strong>Linked to existing customer:</strong>{' '}
              {customer.lastName?.toUpperCase()}, {customer.firstName}
            </div>
            <button type="button" className="sm-link-btn" onClick={startNew}>
              Detach & start new
            </button>
          </div>
        )}
      </Section>

      <Section title="Customer details" eyebrow={customer.id ? 'Edit if needed' : 'Required'}>
        <div className="sm-grid-2">
          <Field label="First name" required>
            <TextInput
              value={customer.firstName}
              onChange={v => updateCustomer({ firstName: v })}
              placeholder="Jane"
            />
          </Field>
          <Field label="Last name" required>
            <TextInput
              value={customer.lastName}
              onChange={v => updateCustomer({ lastName: v })}
              placeholder="Smith"
            />
          </Field>
        </div>

        <div className="sm-grid-2">
          <Field label="Primary phone">
            <TextInput
              value={customer.phonePrimary}
              onChange={v => updateCustomer({ phonePrimary: v })}
              placeholder="(732) 555-1234"
            />
          </Field>
          <Field label="Alternate phone" hint="Optional">
            <TextInput
              value={customer.phoneAlt}
              onChange={v => updateCustomer({ phoneAlt: v })}
              placeholder="(732) 555-5678"
            />
          </Field>
        </div>

        <Field label="Email" wide>
          <TextInput
            type="email"
            value={customer.email}
            onChange={v => updateCustomer({ email: v })}
            placeholder="jane@example.com"
          />
        </Field>

        <Field label="Alternate email" wide hint="Optional — second contact email">
          <TextInput
            type="email"
            value={customer.emailAlt}
            onChange={v => updateCustomer({ emailAlt: v })}
            placeholder="spouse@example.com"
          />
        </Field>

        <Divider />

        <Field label="Street address" hint="Optional" wide>
          <TextInput
            value={customer.addressLine1}
            onChange={v => updateCustomer({ addressLine1: v })}
            placeholder="60 Leighton Ave"
          />
        </Field>
        <Field label="Address line 2" hint="Apt, suite, etc. — optional" wide>
          <TextInput
            value={customer.addressLine2}
            onChange={v => updateCustomer({ addressLine2: v })}
            placeholder="Apt 3B"
          />
        </Field>
        <div className="sm-grid-3">
          <Field label="City">
            <TextInput
              value={customer.city}
              onChange={v => updateCustomer({ city: v })}
              placeholder="Red Bank"
            />
          </Field>
          <Field label="State">
            <TextInput
              value={customer.state}
              onChange={v => updateCustomer({ state: v })}
              placeholder="NJ"
            />
          </Field>
          <Field label="ZIP">
            <TextInput
              value={customer.zip}
              onChange={v => updateCustomer({ zip: v })}
              placeholder="07701"
            />
          </Field>
        </div>

        <Field label="Customer notes" wide hint="Anything important about how to reach them">
          <TextArea
            value={customer.notes}
            onChange={v => updateCustomer({ notes: v })}
            placeholder="Best to call evenings, prefers email, etc."
            rows={2}
          />
        </Field>
      </Section>

      {/* How did you hear about us */}
      <Section title="How did you hear about us?" eyebrow="Helps with marketing — pick one">
        <div className="sm-referral-grid">
          {REFERRAL_SOURCES.map(s => (
            <button
              key={s.code}
              type="button"
              className={`sm-referral-chip ${customer.referralSource === s.code ? 'on' : ''}`}
              onClick={() => updateCustomer({ referralSource: customer.referralSource === s.code ? '' : s.code })}
            >
              {s.label}
            </button>
          ))}
        </div>
        {(customer.referralSource === 'other' ||
          customer.referralSource === 'friend' ||
          customer.referralSource === 'funeral-home' ||
          customer.referralSource === 'cemetery' ||
          customer.referralSource === 'church' ||
          customer.referralSource === 'returning') && (
          <Field
            label={
              customer.referralSource === 'other'         ? 'Tell us more'
              : customer.referralSource === 'friend'      ? "Who referred them? (optional)"
              : customer.referralSource === 'funeral-home'? 'Which funeral home? (optional)'
              : customer.referralSource === 'cemetery'    ? 'Which cemetery staff member? (optional)'
              : customer.referralSource === 'church'      ? 'Which church / parish? (optional)'
              : 'When did they last buy from us? (optional)'
            }
            wide
          >
            <TextInput
              value={customer.referralSourceDetail}
              onChange={v => updateCustomer({ referralSourceDetail: v })}
              placeholder="e.g. John Smith / O'Brien Funeral Home / 2018"
            />
          </Field>
        )}
      </Section>
    </div>
  )
}

// =============================================================================
// STEP 3 — CEMETERY + PLOT + GOOGLE MAPS PIN
// =============================================================================

function CemeteryStep({ order, update }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debouncedQuery = useDebouncedValue(query, 300)
  const cem = order.cemetery
  const plot = order.plot

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.trim().length < 1) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    searchCemeteries(debouncedQuery).then(rows => {
      if (cancelled) return
      setResults(rows)
      setSearching(false)
    })
    return () => { cancelled = true }
  }, [debouncedQuery])

  const updateCem  = (patch) => update({ cemetery: { ...cem, ...patch } })
  const updatePlot = (patch) => update({ plot: { ...plot, ...patch } })

  const pickExistingCem = (row) => {
    update({ cemetery: rowToCemetery(row) })
    setQuery('')
    setResults([])
  }

  const startNewCem = () => {
    update({ cemetery: { ...makeBlankOrder().cemetery } })
    setQuery('')
  }

  // Build a friendly Google Maps link based on what we know
  const mapsSearchUrl = useMemo(() => {
    if (plot.lat && plot.lng) {
      return `https://www.google.com/maps?q=${plot.lat},${plot.lng}`
    }
    const parts = [cem.name, cem.address, cem.city, cem.state, cem.zip].filter(Boolean).join(', ')
    if (!parts) return null
    return `https://www.google.com/maps/search/${encodeURIComponent(parts)}`
  }, [plot.lat, plot.lng, cem.name, cem.address, cem.city, cem.state, cem.zip])

  // Embed URL — works without API key for basic place embed
  const embedUrl = useMemo(() => {
    if (plot.lat && plot.lng) {
      return `https://maps.google.com/maps?q=${plot.lat},${plot.lng}&hl=en&z=18&output=embed`
    }
    const parts = [cem.name, cem.address, cem.city, cem.state, cem.zip].filter(Boolean).join(', ')
    if (!parts) return null
    return `https://maps.google.com/maps?q=${encodeURIComponent(parts)}&hl=en&z=16&output=embed`
  }, [plot.lat, plot.lng, cem.name, cem.address, cem.city, cem.state, cem.zip])

  // Parse "lat, lng" pasted from Google Maps "What's here?"
  const parseCoordPaste = (s) => {
    const m = String(s).trim().match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/)
    if (!m) return null
    const lat = parseFloat(m[1]), lng = parseFloat(m[2])
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    return { lat, lng }
  }

  const onCoordPaste = (s) => {
    const coords = parseCoordPaste(s)
    if (coords) updatePlot(coords)
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step 3 of 4 · Where it goes</div>
        <h1 className="sm-step-title">Cemetery &amp; Plot</h1>
        <p className="sm-step-lede">
          Search existing cemeteries first — the list grows as you book new ones.
          Plot details vary cemetery to cemetery; just fill what they give you.
        </p>
      </div>

      <Section title="Cemetery" eyebrow="Search or create">
        <SearchBox
          query={query}
          onQueryChange={setQuery}
          results={results}
          loading={searching}
          onPick={pickExistingCem}
          placeholder="Type cemetery name…"
          emptyHint="No match — fill in the form below to add this cemetery."
          renderResult={(r) => (
            <div>
              <div className="sm-result-line1">{r.name}</div>
              <div className="sm-result-line2">
                {[r.address, r.city, r.state].filter(Boolean).join(', ')}
                {r.contact_phone && ` · ${formatPhone(r.contact_phone)}`}
              </div>
            </div>
          )}
        />
        {cem.id && (
          <div className="sm-existing-banner">
            <div>
              <strong>Linked to existing:</strong> {cem.name}
              {cem.address && <span className="sm-existing-meta"> · {cem.address}, {cem.city}</span>}
            </div>
            <button type="button" className="sm-link-btn" onClick={startNewCem}>
              Detach & enter new
            </button>
          </div>
        )}

        <div className="sm-grid-2">
          <Field label="Cemetery name" required>
            <TextInput
              value={cem.name}
              onChange={v => updateCem({ name: v })}
              placeholder="Mount Lebanon Cemetery"
            />
          </Field>
          <Field label="Cemetery office phone">
            <TextInput
              value={cem.contactPhone}
              onChange={v => updateCem({ contactPhone: v })}
              placeholder="(732) 555-1234"
            />
          </Field>
        </div>
        <Field label="Street address" wide hint="Full street address — used for the map preview">
          <TextInput
            value={cem.address}
            onChange={v => updateCem({ address: v })}
            placeholder="703 Amboy Ave"
          />
        </Field>
        <div className="sm-grid-3">
          <Field label="City">
            <TextInput value={cem.city} onChange={v => updateCem({ city: v })} placeholder="Perth Amboy" />
          </Field>
          <Field label="State">
            <TextInput value={cem.state} onChange={v => updateCem({ state: v })} placeholder="NJ" />
          </Field>
          <Field label="ZIP">
            <TextInput value={cem.zip} onChange={v => updateCem({ zip: v })} placeholder="08861" />
          </Field>
        </div>
        <div className="sm-grid-2">
          <Field label="Office email" hint="Optional">
            <TextInput
              type="email"
              value={cem.contactEmail}
              onChange={v => updateCem({ contactEmail: v })}
              placeholder="office@cemetery.com"
            />
          </Field>
          <Field label="Website" hint="Optional">
            <TextInput
              value={cem.website}
              onChange={v => updateCem({ website: v })}
              placeholder="https://..."
            />
          </Field>
        </div>
        <Field label="Cemetery notes" wide hint="Rules, quirks, contact preferences">
          <TextArea
            value={cem.notes}
            onChange={v => updateCem({ notes: v })}
            placeholder="No upright over 36″, foundation required, deeds at office, etc."
            rows={2}
          />
        </Field>
      </Section>

      <Section title="Plot" eyebrow="Where in the cemetery">
        <Field label="Plot type" wide>
          <div className="sm-chip-row">
            {PLOT_TYPES.map(p => (
              <ToggleChip
                key={p.code}
                on={plot.type === p.code}
                onClick={() => updatePlot({ type: plot.type === p.code ? '' : p.code })}
              >
                {p.label}
              </ToggleChip>
            ))}
          </div>
          {plot.type && (
            <div className="sm-helper">{PLOT_TYPES.find(t => t.code === plot.type)?.blurb}</div>
          )}
        </Field>

        <div className="sm-helper sm-helper-strong">
          Cemeteries vary — fill in only the fields they give you.
        </div>

        <div className="sm-grid-3">
          <Field label="Section"><TextInput value={plot.section} onChange={v => updatePlot({ section: v })} /></Field>
          <Field label="Block">  <TextInput value={plot.block}   onChange={v => updatePlot({ block: v })} /></Field>
          <Field label="Lot">    <TextInput value={plot.lot}     onChange={v => updatePlot({ lot: v })} /></Field>
          <Field label="Row">    <TextInput value={plot.row}     onChange={v => updatePlot({ row: v })} /></Field>
          <Field label="Space">  <TextInput value={plot.space}   onChange={v => updatePlot({ space: v })} /></Field>
          <Field label="Grave">  <TextInput value={plot.grave}   onChange={v => updatePlot({ grave: v })} /></Field>
          <Field label="Level">  <TextInput value={plot.level}   onChange={v => updatePlot({ level: v })} /></Field>
        </div>
        <Field label="Other plot reference" wide hint="Anything cemetery-specific that doesn't fit above">
          <TextInput
            value={plot.other}
            onChange={v => updatePlot({ other: v })}
            placeholder="e.g. PT2 BLK 8 LOT MAP Level 106A"
          />
        </Field>
      </Section>

      <Section
        title="Map pin"
        eyebrow="Drop the exact location"
        right={
          mapsSearchUrl ? (
            <a href={mapsSearchUrl} target="_blank" rel="noreferrer" className="sm-link-btn">
              Open in Google Maps ↗
            </a>
          ) : null
        }
      >
        <div className="sm-map-help">
          <strong>How to drop a pin:</strong>{' '}
          Click "Open in Google Maps" → find the exact spot at the cemetery →
          right-click the spot → click the lat/lng numbers at the top to copy →
          paste them in the box below.
        </div>

        <Field label="Paste coordinates from Google Maps" wide>
          <TextInput
            value={(plot.lat != null && plot.lng != null) ? `${plot.lat}, ${plot.lng}` : ''}
            onChange={onCoordPaste}
            placeholder="e.g. 40.5089, -74.2728"
          />
        </Field>

        <div className="sm-grid-2">
          <Field label="Latitude" hint="Manual entry if needed">
            <TextInput
              value={plot.lat ?? ''}
              onChange={v => updatePlot({ lat: v === '' ? null : parseFloat(v) })}
              placeholder="40.5089"
            />
          </Field>
          <Field label="Longitude">
            <TextInput
              value={plot.lng ?? ''}
              onChange={v => updatePlot({ lng: v === '' ? null : parseFloat(v) })}
              placeholder="-74.2728"
            />
          </Field>
        </div>

        <Field label="Pin notes" wide hint="What to look for at the spot — landmarks, neighbors, etc.">
          <TextArea
            value={plot.pinNotes}
            onChange={v => updatePlot({ pinNotes: v })}
            placeholder="Next to the large maple tree, three rows in from the main path."
            rows={2}
          />
        </Field>

        {embedUrl && (
          <div className="sm-map-preview">
            <iframe
              src={embedUrl}
              title="Cemetery location preview"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        )}
      </Section>
    </div>
  )
}

// =============================================================================
// STEP 4 — DECEASED (one or more)
// =============================================================================

function DeceasedStep({ order, update }) {
  const dec = order.deceased

  const updateOne = (idx, patch) => {
    update({ deceased: dec.map((d, i) => i === idx ? { ...d, ...patch } : d) })
  }
  const addOne = () => {
    update({ deceased: [...dec, makeBlankDeceased(dec.length, false)] })
  }
  const addReserved = () => {
    update({ deceased: [...dec, makeBlankDeceased(dec.length, true)] })
  }
  const removeOne = (idx) => {
    if (dec.length <= 1) return
    update({ deceased: dec.filter((_, i) => i !== idx).map((d, i) => ({ ...d, position: i })) })
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step 4 of 4 · Whose memorial</div>
        <h1 className="sm-step-title">Memorial</h1>
        <p className="sm-step-lede">
          Whose name(s) go on the stone. One or more — companion stones can hold
          two, family stones can hold more. Mark "Pre-need" if the person is still living.
        </p>
      </div>

      {dec.map((d, idx) => (
        <DeceasedCard
          key={idx}
          idx={idx}
          d={d}
          onChange={patch => updateOne(idx, patch)}
          onRemove={dec.length > 1 ? () => removeOne(idx) : null}
          isOnly={dec.length === 1}
        />
      ))}

      <div className="sm-add-row">
        <button type="button" className="sm-add-btn" onClick={addOne}>
          + Add another person to this memorial
        </button>
        <button type="button" className="sm-add-btn sm-add-btn-secondary" onClick={addReserved}>
          + Reserve blank space (no details)
        </button>
      </div>

      {(order.serviceTypes.includes('NEW_STONE') || order.serviceTypes.includes('BRONZE')) && (
        <Section title="Matching to" eyebrow="Optional">
          <p className="sm-helper">
            If this stone needs to match an existing one (yours or another vendor's),
            describe it here. You can attach photos in a future step.
          </p>
          <Field label="Description" wide>
            <TextArea
              value={order.matchingToDescription}
              onChange={v => update({ matchingToDescription: v })}
              placeholder="e.g. Match the existing slant stone for father (Bahama Blue, hand-sculpted rose, same lettering style)."
              rows={3}
            />
          </Field>
        </Section>
      )}
    </div>
  )
}

function DeceasedCard({ idx, d, onChange, onRemove, isOnly }) {
  // Reserved-space card: minimal UI, no name/dates/title fields
  if (d.isReserved) {
    return (
      <div className="sm-deceased-card sm-deceased-card-reserved">
        <div className="sm-deceased-head">
          <div className="sm-deceased-num">
            <span className="sm-reserved-icon">⌬</span> Reserved Space
            <span className="sm-deceased-num-sub"> · for future inscription</span>
          </div>
          <div className="sm-deceased-actions">
            {onRemove && !isOnly && (
              <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={onRemove}>
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="sm-helper sm-helper-strong">
          This holds an empty spot on the stone — no name, dates, or title yet.
          You can add the details later when needed.
        </div>

        <Field label="Internal notes (optional)" wide hint="Just for staff — not on the stone">
          <TextArea
            value={d.notes}
            onChange={v => onChange({ notes: v })}
            rows={2}
            placeholder="e.g. Reserved for surviving spouse · plot held for daughter"
          />
        </Field>
      </div>
    )
  }

  // Build a natural-language join: "Father", "Father & Husband", "Father, Husband, & Brother"
  const joinRelations = (rels) => {
    const r = (rels || []).filter(Boolean)
    if (r.length === 0) return ''
    if (r.length === 1) return r[0]
    if (r.length === 2) return `${r[0]} & ${r[1]}`
    return `${r.slice(0, -1).join(', ')}, & ${r[r.length - 1]}`
  }

  // Update title field — auto-build "Prefix Relation" when picking from dropdowns,
  // but allow free-text override in the final field.
  const setPrefix = (v) => {
    const newTitle = [v, joinRelations(d.titleRelations)].filter(Boolean).join(' ')
    onChange({ titlePrefix: v, title: newTitle })
  }
  const toggleRelation = (rel) => {
    const cur = d.titleRelations || []
    const next = cur.includes(rel) ? cur.filter(r => r !== rel) : [...cur, rel]
    const newTitle = [d.titlePrefix, joinRelations(next)].filter(Boolean).join(' ')
    onChange({ titleRelations: next, title: newTitle })
  }

  return (
    <div className="sm-deceased-card">
      <div className="sm-deceased-head">
        <div className="sm-deceased-num">
          {idx === 0 ? 'Deceased Information' : `Person #${idx + 1}`}
        </div>
        <div className="sm-deceased-actions">
          <ToggleChip
            on={d.isPreNeed}
            onClick={() => onChange({ isPreNeed: !d.isPreNeed })}
          >
            Pre-need (still living)
          </ToggleChip>
          {onRemove && !isOnly && (
            <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="sm-grid-3">
        <Field label="First name" required>
          <TextInput value={d.firstName} onChange={v => onChange({ firstName: v })} placeholder="Vladimir" />
        </Field>
        <Field label="Middle">
          <TextInput value={d.middleName} onChange={v => onChange({ middleName: v })} />
        </Field>
        <Field label="Last name">
          <TextInput value={d.lastName} onChange={v => onChange({ lastName: v })} placeholder="Friedman" />
        </Field>
      </div>

      <div className="sm-title-builder">
        <div className="sm-title-builder-eyebrow">
          Title for the stone <span className="sm-title-builder-hint">(pick a prefix + one or more relations — they'll join naturally with commas)</span>
        </div>
        <Field label="Prefix" hint="English options first, Spanish at the bottom">
          <SelectInput
            value={d.titlePrefix}
            onChange={setPrefix}
            options={TITLE_PREFIXES.map(p => ({ value: p, label: p }))}
            placeholder="— pick a prefix —"
          />
        </Field>
        <Field label="Relations (multi-select)" wide hint="Click as many as apply — e.g. Father + Husband + Brother → 'Beloved Father, Husband, & Brother'">
          <div className="sm-rel-chips">
            {TITLE_RELATIONS.map(rel => (
              <button
                key={rel}
                type="button"
                className={`sm-chip-btn sm-chip-btn-small ${(d.titleRelations || []).includes(rel) ? 'on' : ''}`}
                onClick={() => toggleRelation(rel)}
              >
                {rel}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Final title (edit freely if needed)" wide hint="This is what goes on the stone">
          <TextInput
            value={d.title}
            onChange={v => onChange({ title: v })}
            placeholder="e.g. Beloved Father, Husband, & Brother"
          />
        </Field>
      </div>

      <Field label="Relationship to customer" wide>
        <SelectInput
          value={d.relationship}
          onChange={v => onChange({ relationship: v })}
          options={RELATIONSHIPS.map(r => ({ value: r, label: r }))}
          placeholder="— select —"
        />
      </Field>

      <div className="sm-grid-2">
        <Field label="Date of birth">
          <TextInput
            type="date"
            value={d.dateOfBirth}
            onChange={v => onChange({ dateOfBirth: v })}
          />
        </Field>
        {d.isPreNeed ? (
          <Field label="Date of death" hint="Pre-need — leave blank">
            <TextInput value="" onChange={() => {}} disabled placeholder="(pre-need)" />
          </Field>
        ) : (
          <Field label="Date of death">
            <TextInput
              type="date"
              value={d.dateOfDeath}
              onChange={v => onChange({ dateOfDeath: v })}
            />
          </Field>
        )}
      </div>

      <Field label="Notes about this person" wide hint="Anything that should be reflected in the memorial">
        <TextArea
          value={d.notes}
          onChange={v => onChange({ notes: v })}
          rows={2}
          placeholder="e.g. Veteran, served in Vietnam · loved gardening · spoke Russian primarily"
        />
      </Field>
    </div>
  )
}

// =============================================================================
// STEP 5 — SHAPE & SIZE
// =============================================================================

function ShapeStep({ order, update }) {
  // Filter shapes by service type — Mausoleum/Civic only show if user picked those
  const availableShapes = useMemo(() => {
    return SHAPES.filter(s => {
      if (!s.onlyForServices) return true
      return s.onlyForServices.some(svc => order.serviceTypes.includes(svc))
    })
  }, [order.serviceTypes])

  const shape = SHAPES.find(s => s.code === order.shape)

  // ---- Pick a shape category --------------------------------------------------
  const pickShape = (code) => {
    const s = SHAPES.find(x => x.code === code)
    if (!s) return
    // Reset size + base when changing shape category — different shapes have different sizes
    update({
      shape: code,
      standardSizeCode: null,
      width: null, depth: null, thickness: null,
      // Auto-include base when shape requires it (dies always need a base)
      baseConfig: {
        ...order.baseConfig,
        include: !!s.requiresBase,
      },
      // Reset custom shape selection unless we're now on custom
      customShape: code === 'custom' ? order.customShape : null,
    })
  }

  // ---- Pick a standard size --------------------------------------------------
  const pickStandardSize = (sizeCode) => {
    if (sizeCode === 'custom') {
      // Switch to custom — keep current dims but unset the standardSizeCode
      update({ standardSizeCode: null })
      return
    }
    const sz = shape.standardSizes.find(s => s.code === sizeCode)
    if (!sz) return
    update({
      standardSizeCode: sizeCode,
      width: sz.w, depth: sz.d, thickness: sz.t,
    })
  }

  const isCustomSize = !order.standardSizeCode && !!order.shape

  // ---- Update base config -----------------------------------------------------
  const updateBase = (patch) => update({ baseConfig: { ...order.baseConfig, ...patch } })

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Stone shape & size</div>
        <h1 className="sm-step-title">Shape &amp; Size</h1>
        <p className="sm-step-lede">
          Pick the shape category, then a standard size or "Custom." Sizes shown
          in feet-inches notation (2-0 means 2 feet 0 inches = 24″).
        </p>
      </div>

      {/* ---- 1. SHAPE CATEGORY ---------------------------------------------- */}
      <Section title="Shape category" eyebrow="What kind of stone">
        <div className="sm-card-grid sm-card-grid-shapes">
          {availableShapes.map(s => (
            <CardOption
              key={s.code}
              on={order.shape === s.code}
              onClick={() => pickShape(s.code)}
              title={s.label}
              blurb={s.blurb}
              icon={s.icon}
            />
          ))}
        </div>
      </Section>

      {/* ---- 2. STANDARD SIZE ----------------------------------------------- */}
      {shape && shape.standardSizes.length > 0 && (
        <Section title="Standard size" eyebrow={`${shape.label} sizes from the pricing sheet`}>
          <div className="sm-size-grid">
            {shape.standardSizes.map(sz => (
              <button
                key={sz.code}
                type="button"
                className={`sm-size-card ${order.standardSizeCode === sz.code ? 'on' : ''}`}
                onClick={() => pickStandardSize(sz.code)}
              >
                <div className="sm-size-label">{sz.label}</div>
                <div className="sm-size-meta">{sz.w}″ × {sz.d}″ × {sz.t}″</div>
              </button>
            ))}
            <button
              type="button"
              className={`sm-size-card sm-size-card-custom ${isCustomSize ? 'on' : ''}`}
              onClick={() => pickStandardSize('custom')}
            >
              <div className="sm-size-label">Custom…</div>
              <div className="sm-size-meta">Enter any size</div>
            </button>
          </div>

          {isCustomSize && (
            <div className="sm-grid-3" style={{ marginTop: 16 }}>
              <Field label="Width (inches)">
                <TextInput type="number" value={order.width ?? ''}
                  onChange={v => update({ width: v === '' ? null : Number(v) })}
                  placeholder="e.g. 36" />
              </Field>
              <Field label="Depth (front-to-back)">
                <TextInput type="number" value={order.depth ?? ''}
                  onChange={v => update({ depth: v === '' ? null : Number(v) })}
                  placeholder="e.g. 12" />
              </Field>
              <Field label={shape.code === 'die' || shape.code === 'double-die' ? 'Height (inches)' : 'Thickness (inches)'}>
                <TextInput type="number" value={order.thickness ?? ''}
                  onChange={v => update({ thickness: v === '' ? null : Number(v) })}
                  placeholder="e.g. 28" />
              </Field>
            </div>
          )}
        </Section>
      )}

      {/* For Mausoleum/Civic and Custom: dimensions are always entered freely */}
      {shape && shape.standardSizes.length === 0 && (
        <Section title="Dimensions" eyebrow="Custom — enter the size">
          <div className="sm-grid-3">
            <Field label="Width (inches)">
              <TextInput type="number" value={order.width ?? ''}
                onChange={v => update({ width: v === '' ? null : Number(v) })} />
            </Field>
            <Field label="Depth (inches)">
              <TextInput type="number" value={order.depth ?? ''}
                onChange={v => update({ depth: v === '' ? null : Number(v) })} />
            </Field>
            <Field label="Height (inches)">
              <TextInput type="number" value={order.thickness ?? ''}
                onChange={v => update({ thickness: v === '' ? null : Number(v) })} />
            </Field>
          </div>
        </Section>
      )}

      {/* ---- 3. CUSTOM SHAPE PICKER ------------------------------------------ */}
      {shape && shape.code === 'custom' && (
        <Section title="Custom shape" eyebrow="Pick the shape — or describe one">
          <div className="sm-custom-shape-grid">
            {shape.customShapes.map(cs => (
              <button
                key={cs}
                type="button"
                className={`sm-chip-btn ${order.customShape === cs ? 'on' : ''}`}
                onClick={() => update({ customShape: cs })}
              >
                {cs}
              </button>
            ))}
          </div>
          <Field label="Describe the shape (especially if 'Other')" wide hint="Drawings or photos can be added in the inscription step.">
            <TextArea
              value={order.customShapeDescription || ''}
              onChange={v => update({ customShapeDescription: v })}
              rows={2}
              placeholder="e.g. Heart with a cross cutout · Open book with two pages · Praying hands silhouette · Custom design (sketch attached)"
            />
          </Field>
        </Section>
      )}

      {/* ---- 4. TOP SHAPE (only for shapes with a top) ----------------------- */}
      {shape && ['slant', 'double-slant', 'die', 'double-die', 'civic', 'custom'].includes(shape.code) && (
        <Section title="Top shape" eyebrow="The profile of the top edge">
          <div className="sm-top-shape-grid">
            {TOP_SHAPES.map(t => (
              <button
                key={t.code}
                type="button"
                className={`sm-chip-btn sm-chip-btn-tall ${order.topShape === t.code ? 'on' : ''}`}
                onClick={() => update({ topShape: t.code })}
              >
                <div className="sm-chip-btn-label">{t.label}</div>
                <div className="sm-chip-btn-blurb">{t.blurb}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ---- 5. POLISH & SIDES (only for shapes with vertical sides) ------- */}
      {shape && ['slant', 'double-slant', 'die', 'double-die', 'civic', 'custom'].includes(shape.code) && (
        <Section title="Polish &amp; sides" eyebrow="Surface treatment">
          <div className="sm-grid-2">
            <Field label="Polish level" hint="Auto-fills the Sides field — change after if needed">
              <SelectInput
                value={order.polishLevel || ''}
                onChange={v => {
                  const updates = { polishLevel: v || null }
                  if (v && POLISH_TO_SIDES_DEFAULT[v]) {
                    updates.sides = POLISH_TO_SIDES_DEFAULT[v]
                  }
                  update(updates)
                }}
                placeholder="— pick a level —"
                options={POLISH_LEVELS.map(p => ({ value: p.code, label: p.label }))}
              />
            </Field>
            <Field label="Sides" hint="Auto-set from polish — override if needed">
              <SelectInput
                value={order.sides || ''}
                onChange={v => update({ sides: v || null })}
                placeholder="— pick sides —"
                options={SIDES_OPTIONS.map(s => ({ value: s.code, label: s.label }))}
              />
            </Field>
          </div>
          {order.sides && (
            <div className="sm-helper">
              <strong>{SIDES_OPTIONS.find(s => s.code === order.sides)?.label}:</strong>{' '}
              {SIDES_OPTIONS.find(s => s.code === order.sides)?.blurb}
            </div>
          )}
        </Section>
      )}

      {/* ---- 6. BASE (slants/dies/double-die/bronze) ------------------------- */}
      {shape && shape.canHaveBase && (
        <Section title="Base" eyebrow={shape.requiresBase ? 'Required for this shape' : 'Optional add-on'}>
          {!shape.requiresBase && (
            <ToggleChip
              on={order.baseConfig.include}
              onClick={() => updateBase({ include: !order.baseConfig.include })}
            >
              {order.baseConfig.include ? '✓ Add a base to this stone' : 'Add a base to this stone'}
            </ToggleChip>
          )}

          {(order.baseConfig.include || shape.requiresBase) && (
            <>
              <Field label="Base size" wide hint="Recommended sizes (3″/2″/1″ wider per side) appear first">
                <SelectInput
                  value={order.baseConfig.sizeCode || ''}
                  onChange={v => updateBase({ sizeCode: v || null })}
                  placeholder="— pick a base size —"
                  options={(() => {
                    // Determine the stone's width — from standardSize, then custom
                    const shapeRec = SHAPES.find(s => s.code === order.shape)
                    const stdSize = shapeRec && order.standardSizeCode
                      ? shapeRec.standardSizes.find(s => s.code === order.standardSizeCode)
                      : null
                    const stoneW = stdSize?.w ?? order.width ?? null

                    if (!stoneW) {
                      // No stone width yet — just show the catalog
                      return [
                        ...BASE_SIZES.map(b => ({ value: b.code, label: b.label })),
                        { value: 'custom', label: 'Custom base size…' },
                      ]
                    }

                    // Find the closest base for each target (3″, 2″, 1″ wider per side)
                    // by total added width: 6, 4, 2 inches
                    const targets = [
                      { add: 6, badge: '★ Recommended (3″ wider/side)' },
                      { add: 4, badge: '★ Recommended (2″ wider/side)' },
                      { add: 2, badge: '★ Recommended (1″ wider/side)' },
                    ]
                    const recCodes = new Set()
                    const recOptions = []
                    for (const t of targets) {
                      const targetW = stoneW + t.add
                      // Closest base by absolute width difference, ties broken by lower price
                      const candidates = [...BASE_SIZES]
                        .filter(b => !recCodes.has(b.code))
                        .sort((a, b) => {
                          const da = Math.abs(a.w - targetW)
                          const db = Math.abs(b.w - targetW)
                          if (da !== db) return da - db
                          return a.price - b.price
                        })
                      const best = candidates[0]
                      if (best && Math.abs(best.w - targetW) <= 4) {
                        recCodes.add(best.code)
                        recOptions.push({ value: best.code, label: `${t.badge} — ${best.label}` })
                      }
                    }
                    const restOptions = BASE_SIZES
                      .filter(b => !recCodes.has(b.code))
                      .map(b => ({ value: b.code, label: b.label }))

                    return [
                      ...recOptions,
                      ...(recOptions.length && restOptions.length ? [{ value: '', label: '────── all sizes ──────', disabled: true }] : []),
                      ...restOptions,
                      { value: 'custom', label: 'Custom base size…' },
                    ]
                  })()}
                />
              </Field>

              {order.baseConfig.sizeCode === 'custom' && (
                <div className="sm-grid-2">
                  <Field label="Base width (inches)">
                    <TextInput type="number" value={order.baseConfig.width ?? ''}
                      onChange={v => updateBase({ width: v === '' ? null : Number(v) })} />
                  </Field>
                  <Field label="Base depth (inches)">
                    <TextInput type="number" value={order.baseConfig.depth ?? ''}
                      onChange={v => updateBase({ depth: v === '' ? null : Number(v) })} />
                  </Field>
                </div>
              )}

              <Field label="Base height" hint="Per pricing sheet — adds to die+base upcharge">
                <div className="sm-base-height-grid">
                  {BASE_HEIGHTS.map(h => (
                    <button
                      key={h.code}
                      type="button"
                      className={`sm-chip-btn ${order.baseConfig.heightCode === h.code ? 'on' : ''}`}
                      onClick={() => updateBase({ heightCode: h.code })}
                    >
                      <div className="sm-chip-btn-label">{h.label}</div>
                      <div className="sm-chip-btn-blurb">+${h.upcharge}</div>
                    </button>
                  ))}
                </div>
              </Field>

              <ToggleChip
                on={order.baseConfig.polishMargin2in}
                onClick={() => updateBase({ polishMargin2in: !order.baseConfig.polishMargin2in })}
              >
                {order.baseConfig.polishMargin2in ? '✓ Add 2″ polished margin' : 'Add 2″ polished margin'}
              </ToggleChip>

              <Field label="Base sides" wide hint="Surface treatment for the base block">
                <SelectInput
                  value={order.baseConfig.sides || ''}
                  onChange={v => updateBase({ sides: v || null })}
                  placeholder="— pick base sides —"
                  options={BASE_SIDES_OPTIONS.map(s => ({ value: s.code, label: s.label }))}
                />
              </Field>
              {order.baseConfig.sides && (
                <div className="sm-helper">
                  <strong>{BASE_SIDES_OPTIONS.find(s => s.code === order.baseConfig.sides)?.label}:</strong>{' '}
                  {BASE_SIDES_OPTIONS.find(s => s.code === order.baseConfig.sides)?.blurb}
                </div>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  )
}

// =============================================================================
// STEP 6 — COLOR
// =============================================================================

function ColorStep({ order, update }) {
  const grouped = useMemo(() => {
    const out = {}
    for (const c of GRANITE_COLORS) {
      if (!out[c.family]) out[c.family] = []
      out[c.family].push(c)
    }
    return out
  }, [])

  const families = ['gray', 'black', 'blue', 'pink', 'red', 'mahogany', 'green', 'multi']

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Granite color</div>
        <h1 className="sm-step-title">Granite Color</h1>
        <p className="sm-step-lede">
          ⭐ marks our most popular options. Some colors carry a premium —
          we'll show that in pricing later.
        </p>
      </div>

      {families.map(fam => {
        const list = grouped[fam] || []
        if (list.length === 0) return null
        return (
          <Section key={fam} title={COLOR_FAMILY_LABELS[fam]} eyebrow={`${list.length} option${list.length > 1 ? 's' : ''}`}>
            <div className="sm-color-grid">
              {list.map(c => (
                <button
                  key={c.code}
                  type="button"
                  className={`sm-color-card ${order.graniteColor === c.code ? 'on' : ''}`}
                  onClick={() => update({ graniteColor: c.code })}
                >
                  <div className="sm-color-swatch">
                    <img src={`/granite/${c.file}`} alt={c.label} loading="lazy" />
                    {c.popular && <span className="sm-color-popular">⭐</span>}
                  </div>
                  <div className="sm-color-info">
                    <div className="sm-color-name">{c.label}</div>
                    <div className="sm-color-meta">
                      <span>{c.origin}</span>
                      {c.premium > 0 && <span className="sm-color-premium">+{Math.round(c.premium * 100)}%</span>}
                    </div>
                  </div>
                  {order.graniteColor === c.code && <div className="sm-color-check">✓</div>}
                </button>
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

// =============================================================================
// STEP 7 — DESIGN (catalog browser inside the wizard)
// =============================================================================

// Custom Design panel — appears at top of DesignStep. Shows two photos:
// the customer-supplied reference (e.g. their church) on the left, and the
// final hand-carved result on the right (the LALIS stone). Picking it
// auto-adds the Custom Design Fee to add-ons. Customer can still ALSO pick
// a catalog design as a style reference.
function CustomDesignPanel({ on, onToggle }) {
  return (
    <div className={`sm-custom-design ${on ? 'on' : ''}`}>
      <div className="sm-custom-design-photos">
        <figure className="sm-custom-design-photo">
          <img src={CUSTOM_DESIGN_REFERENCE_IMAGE} alt="Customer-supplied reference photo" />
          <figcaption>What the customer gave us</figcaption>
        </figure>
        <div className="sm-custom-design-arrow" aria-hidden="true">→</div>
        <figure className="sm-custom-design-photo">
          <img src={CUSTOM_DESIGN_IMAGE} alt="The final hand-carved monument" />
          <figcaption>Hand-carved final product</figcaption>
        </figure>
      </div>
      <div className="sm-custom-design-body">
        <div className="sm-custom-design-eyebrow">Custom Design</div>
        <h3 className="sm-custom-design-title">If you can dream it, we can create it</h3>
        <p className="sm-custom-design-blurb">
          Our skilled artisans hand-draw and sandblast custom designs tailored to
          your vision, ensuring a unique and personalized touch.
        </p>
        <div className="sm-custom-design-actions">
          <button
            type="button"
            className={`sm-btn ${on ? 'sm-btn-ghost' : 'sm-btn-navy'} sm-custom-design-btn`}
            onClick={onToggle}
          >
            {on ? '✓ Custom Design selected — click to remove' : '✏️ Pick Custom Design'}
          </button>
          <div className="sm-custom-design-price">
            {on
              ? 'Custom Design Fee added to add-ons (set the final price on Pricing)'
              : 'Starting at $175 — final price set per project'}
          </div>
        </div>
        {on && (
          <div className="sm-custom-design-note">
            You can still browse and pick a catalog design below as a reference
            (e.g., for a banner style or font you like).
          </div>
        )}
      </div>
    </div>
  )
}

// Sprint 3r — category tab definitions for the Design step.
// Filter tabs select monuments where m.cats includes the tab's code.
// The leading 'all' tab skips the cats filter (whole catalog).
// The trailing BLING tab is a configurator surface, not a catalog filter.
const DESIGN_CATEGORIES = [
  { code: 'all',             label: 'All',             kind: 'all' },
  { code: 'slant',           label: 'Slants' },
  { code: 'double-slant',    label: 'Double Slants' },
  { code: 'upright-single',  label: 'Uprights' },
  { code: 'upright-double',  label: 'Double Uprights' },
  { code: 'flat',            label: 'Flat Markers' },
  { code: 'custom-shape',    label: 'Custom Shape' },
  { code: 'bling',           label: 'BLING',           kind: 'configurator' },
]

function DesignStep({ order, update }) {
  const [allMonuments, setAllMonuments] = useState(null)
  const [loading, setLoading] = useState(true)
  // Sprint 3r.2 — 'All' is the default tab; staff can narrow with the strip.
  // No shape-based pre-selection — staff browse the full catalog first.
  const [activeCategory, setActiveCategory] = useState('all')
  // The color side of the old toggle was a real filter (matchesColorFamily),
  // so preserve it as an opt-in checkbox under the tabs. Default OFF — staff
  // see the full category instead of an invisibly-narrowed slice.
  const [matchColor, setMatchColor] = useState(false)
  const [searchText, setSearchText] = useState('')
  // Per-section "Show more" counts — keyed by section symbol code
  const [sectionLimits, setSectionLimits] = useState({})
  // Limit for the "All matches" section when no symbols are picked
  const [allLimit, setAllLimit] = useState(36)

  // Fetch catalog on mount
  useEffect(() => {
    let cancelled = false
    fetchMonuments().then(rows => {
      if (cancelled) return
      setAllMonuments(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const toggleSymbol = (code) => {
    const has = order.elementFilters.includes(code)
    update({
      elementFilters: has
        ? order.elementFilters.filter(c => c !== code)
        : [...order.elementFilters, code],
    })
  }

  // Sprint 3r — BlingConfigurator (reused from the Add-Ons step's CarvingsSection)
  // needs an updateAddOn callback. Same pattern as line 4399 in AddOnsStep —
  // picks land in order.addOns so they show up in the Add-Ons step automatically.
  const updateAddOn = (code, patch) => {
    update({
      addOns: order.addOns.map(a => a.code === code ? { ...a, ...patch } : a),
    })
  }

  const showMoreInSection = (code) => {
    setSectionLimits(prev => ({ ...prev, [code]: (prev[code] || 6) + 12 }))
  }

  // Build the structured-only haystack (NO description / verse text — that's
  // what was causing "Heart" to match "in our hearts" verses).
  const structuredHaystack = (m) => [
    ...(m.cats || []),
    ...(m.tags || []),
    m.lastname || '',
  ].join(' · ').toLowerCase()

  const matchesSymbol = (m, symCode) => {
    const sym = SYMBOLS.find(s => s.code === symCode)
    if (!sym) return false
    const haystack = structuredHaystack(m)
    return sym.matchers.some(kw => haystack.includes(kw.toLowerCase()))
  }

  // Sprint 3j — hide the ugly internal filename. Patterns like
  // "local_A0001.jpg_370245" become "A1"; "local_B0123.jpg_..." becomes "B123".
  const cleanCatalogId = (rawId) => {
    if (!rawId) return ''
    const m = String(rawId).match(/^local_([A-Z]+)(\d+)\.(?:jpg|jpeg|png|webp)/i)
    if (m) return m[1].toUpperCase() + parseInt(m[2], 10)
    // Fallback when the pattern doesn't match: shorten so it doesn't blow out the card
    const s = String(rawId)
    return s.length > 10 ? s.slice(0, 10) : s
  }

  // Free-text search — multi-keyword, OR semantics. Same fields as symbol
  // matching (no description), so verse text never leaks into results.
  const matchesQuery = (m, query) => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return true
    const haystack = structuredHaystack(m)
    return tokens.some(t => haystack.includes(t))
  }

  // Custom Design toggle — also auto-adds/removes the Custom Design Fee addon
  const toggleCustomDesign = () => {
    const next = !order.useCustomDesign
    if (next) {
      // Turn ON — set flag, add fee if not already present
      const hasAddon = order.addOns.some(a => a.code === 'custom-design')
      const newAddOns = hasAddon
        ? order.addOns
        : [...order.addOns, {
            code: 'custom-design',
            label: 'Custom Design Fee',
            price: 175,
            qty: 1,
            notes: '',
          }]
      update({ useCustomDesign: true, addOns: newAddOns })
    } else {
      // Turn OFF — clear flag, remove fee
      update({
        useCustomDesign: false,
        addOns: order.addOns.filter(a => a.code !== 'custom-design'),
      })
    }
  }

  const matchesColorFamily = (m, family) => {
    if (!m.granite_color) return false
    const gc = m.granite_color.toLowerCase()
    if (family === 'gray')     return gc.includes('gray') || gc.includes('grey')
    if (family === 'black')    return gc.includes('black')
    if (family === 'blue')     return gc.includes('blue')
    if (family === 'pink')     return gc.includes('pink') || gc.includes('rose')
    if (family === 'red')      return gc.includes('red')
    if (family === 'mahogany') return gc.includes('mahogany')
    if (family === 'green')    return gc.includes('green')
    if (family === 'multi')    return gc.includes('cat') || gc.includes('paradiso') || gc.includes('multi')
    return false
  }

  // Sprint 3r — the base list is filtered by the active category tab.
  // When the user picks element/symbol filters they're explicitly saying
  // "show me this symbol" — that intent overrides the category narrowing,
  // so symbols pull from the full catalog (across all shapes).
  // The "Also match granite color" checkbox layers on top when ON.
  const baseList = useMemo(() => {
    if (!allMonuments) return []
    let list = allMonuments
    const hasSymbolFilters = (order.elementFilters || []).length > 0 && !searchText.trim()
    // 'all' tab skips the cats filter entirely — return the full catalog.
    if (activeCategory !== 'all' && !hasSymbolFilters) {
      list = list.filter(m => m.cats?.includes(activeCategory))
    }
    if (matchColor && order.graniteColor) {
      const colorRec = GRANITE_COLORS.find(c => c.code === order.graniteColor)
      if (colorRec) list = list.filter(m => matchesColorFamily(m, colorRec.family))
    }
    if (searchText.trim()) {
      list = list.filter(m => matchesQuery(m, searchText))
    }
    return list
  }, [allMonuments, activeCategory, matchColor, order.graniteColor, searchText, order.elementFilters])

  // Precompute counts per category for the tab badges. Cheap — single pass
  // over the full catalog. The 'all' tab shows the total count; configurator-
  // style tabs (BLING) skip the catalog count and instead report how many
  // picks the customer has already added.
  const blingPickCount = (order.addOns || []).filter(a => a.code?.startsWith('bling-')).length
  const categoryCounts = useMemo(() => {
    if (!allMonuments) return {}
    const counts = { all: allMonuments.length }
    for (const cat of DESIGN_CATEGORIES) {
      if (cat.kind === 'configurator' || cat.kind === 'all') continue
      counts[cat.code] = 0
    }
    for (const m of allMonuments) {
      if (!m.cats) continue
      for (const cat of DESIGN_CATEGORIES) {
        if (cat.kind === 'configurator' || cat.kind === 'all') continue
        if (m.cats.includes(cat.code)) counts[cat.code]++
      }
    }
    return counts
  }, [allMonuments])

  // Group results — search and symbols are independent layers. When searching,
  // we collapse to one results section. Otherwise group by symbols if any are picked.
  const sections = useMemo(() => {
    if (searchText.trim()) {
      return [{ code: 'search', label: `Search: "${searchText.trim()}"`, icon: '🔎', list: baseList }]
    }
    if (!order.elementFilters || order.elementFilters.length === 0) {
      return [{ code: 'all', label: 'All matches', icon: '🪨', list: baseList }]
    }
    return order.elementFilters.map(symCode => {
      const sym = SYMBOLS.find(s => s.code === symCode)
      const list = baseList.filter(m => matchesSymbol(m, symCode))
      return { code: symCode, label: sym?.label || symCode, icon: sym?.icon || '·', list }
    })
  }, [baseList, order.elementFilters, searchText])

  // Sprint 3r.2 — multi-select with 6-cap. designs[0] is the PRIMARY.
  const DESIGNS_MAX = 6
  const [capNotice, setCapNotice] = useState(false)
  const capTimerRef = useRef(null)

  const designs = order.designs || []
  const designIndexById = useMemo(() => {
    const m = new Map()
    designs.forEach((d, i) => m.set(d.id, i))
    return m
  }, [designs])

  const togglePick = (m) => {
    const idx = designIndexById.get(m.id)
    if (idx != null) {
      // Already picked → remove. If primary is removed, designs[1] shifts to
      // become the new primary automatically (just a left-shift on the array).
      update({ designs: designs.filter((_, i) => i !== idx) })
      return
    }
    if (designs.length >= DESIGNS_MAX) {
      if (capTimerRef.current) clearTimeout(capTimerRef.current)
      setCapNotice(true)
      capTimerRef.current = setTimeout(() => setCapNotice(false), 3000)
      return
    }
    const snapshot = {
      id: m.id, lastname: m.lastname, name: m.name, img: m.img,
      carve_type: m.carve_type, granite_color: m.granite_color,
      cats: m.cats, tags: m.tags, description: m.description,
    }
    update({ designs: [...designs, { id: m.id, snapshot }] })
  }

  const removeDesign = (id) => update({ designs: designs.filter(d => d.id !== id) })
  const clearAllDesigns = () => update({ designs: [] })
  const makePrimary = (id) => {
    const idx = designs.findIndex(d => d.id === id)
    if (idx <= 0) return
    const next = [...designs]
    const [picked] = next.splice(idx, 1)
    next.unshift(picked)
    update({ designs: next })
  }

  const thumb = (url) => {
    if (!url) return url
    if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w400')
    return url
  }

  const renderCard = (m) => {
    const idx = designIndexById.get(m.id)
    const isPicked = idx != null
    const isPrimary = idx === 0
    return (
      <button
        key={m.id}
        type="button"
        className={`sm-design-card ${isPicked ? 'on' : ''} ${isPrimary ? 'primary' : ''}`}
        onClick={() => togglePick(m)}
      >
        {isPicked && (
          <div className={`sm-design-role-badge ${isPrimary ? 'primary' : 'alternate'}`}>
            {isPrimary ? 'PRIMARY' : `Alternate ${idx + 1}`}
          </div>
        )}
        <div className="sm-design-thumb">
          {m.img ? <img src={thumb(m.img)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                 : <span className="sm-design-no-img">🪨</span>}
        </div>
        <div className="sm-design-info">
          <div className="sm-design-id">{cleanCatalogId(m.id)}</div>
          {m.lastname && <div className="sm-design-name">{m.lastname}</div>}
          <div className="sm-design-tags">
            {m.carve_type && <span className="sm-modal-tag sm-modal-tag-carve">{m.carve_type}</span>}
            {m.granite_color && <span className="sm-modal-tag sm-modal-tag-color">{m.granite_color}</span>}
          </div>
        </div>
      </button>
    )
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Pick a design</div>
        <h1 className="sm-step-title">Design</h1>
        <p className="sm-step-lede">
          Browse {allMonuments?.length || '…'} designs. Describe what they want
          in your own words, then pick which symbols apply — each symbol gets
          its own row of examples.
        </p>
      </div>

      {/* ---- CUSTOM DESIGN panel ------------------------------------------- */}
      <CustomDesignPanel
        on={order.useCustomDesign}
        onToggle={toggleCustomDesign}
      />

      {/* ---- Selected designs (Sprint 3r.2 multi-select) -------------------- */}
      <Section
        title="Selected designs"
        eyebrow="Primary is the design the carver replicates. Alternates are inspiration only."
        right={designs.length > 0 ? (
          <button type="button" className="sm-link-btn" onClick={clearAllDesigns}>Clear all</button>
        ) : null}
      >
        {designs.length === 0 ? (
          <div className="sm-selected-empty">
            No designs selected yet. Tap up to {DESIGNS_MAX} designs below to pick a primary and alternates.
          </div>
        ) : (
          <>
            <div className="sm-selected-designs">
              {designs.map((d, i) => {
                const s = d.snapshot || {}
                const isPrimary = i === 0
                return (
                  <div
                    key={d.id}
                    className={`sm-selected-card ${isPrimary ? 'primary' : 'alternate'}`}
                  >
                    <div className={`sm-selected-role ${isPrimary ? 'primary' : 'alternate'}`}>
                      {isPrimary ? 'PRIMARY' : `Alternate ${i + 1}`}
                    </div>
                    <div className="sm-selected-thumb">
                      {s.img && <img src={thumb(s.img)} alt="" />}
                    </div>
                    <div className="sm-selected-info">
                      <div className="sm-selected-id">{cleanCatalogId(s.id || d.id)}</div>
                      <div className="sm-selected-name">{s.lastname || s.name}</div>
                      {s.granite_color && (
                        <div className="sm-selected-tags">
                          <span className="sm-modal-tag">{s.granite_color}</span>
                        </div>
                      )}
                    </div>
                    <div className="sm-selected-actions">
                      {!isPrimary && (
                        <button type="button" className="sm-link-btn" onClick={() => makePrimary(d.id)}>
                          Make primary
                        </button>
                      )}
                      <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={() => removeDesign(d.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sm-selected-footer">
              {designs.length === 1
                ? 'Primary only — pick more for alternates.'
                : `1 primary + ${designs.length - 1} alternate${designs.length - 1 === 1 ? '' : 's'}.`}
            </div>
          </>
        )}
        {capNotice && (
          <div className="sm-design-cap-notice" role="status">
            Maximum {DESIGNS_MAX} designs selected. Remove one to add another.
          </div>
        )}
      </Section>

      {/* ---- Free-text describe -------------------------------------------- */}
      <Section title="Describe what they want" eyebrow="In their own words">
        <p className="sm-helper">
          What's the customer asking for? Mood, religion, theme, anything specific
          to the deceased. We'll save this on the order and show it during pricing
          + on the contract.
        </p>
        <Field label="Description" wide>
          <TextArea
            value={order.designPreferences || ''}
            onChange={v => update({ designPreferences: v })}
            rows={3}
            placeholder="e.g. Religious Catholic stone with birds, a cross, and a rosary · Wants something simple and traditional · Loved fishing — would like a scenic lake with a pole · Spanish family, prefers Sagrado Corazón imagery"
          />
        </Field>
      </Section>

      {/* ---- Search bar (multi-keyword OR) --------------------------------- */}
      <Section title="Search the catalog" eyebrow="Type elements you want — multi-word works ('rose heart dove')">
        <div className="sm-design-search">
          <input
            type="text"
            className="sm-design-search-input"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="🔎 Search designs by element, lastname, or tag…"
          />
          {searchText && (
            <button
              type="button"
              className="sm-design-search-clear"
              onClick={() => setSearchText('')}
              aria-label="Clear search"
            >×</button>
          )}
        </div>
        <p className="sm-helper" style={{ marginTop: 8 }}>
          Type any combination of elements — "rose heart dove" returns designs
          tagged with any of those. Verse text is not searched.
        </p>
      </Section>

      {/* ---- Category tabs (Sprint 3r) ------------------------------------- */}
      <Section title="Browse by category" eyebrow="Tab matches the stone shape by default — switch any time">
        <div className="sm-design-tabs" role="tablist">
          {DESIGN_CATEGORIES.map(cat => {
            const isConfigurator = cat.kind === 'configurator'
            const count = isConfigurator
              ? (cat.code === 'bling' ? blingPickCount : 0)
              : (categoryCounts[cat.code] ?? 0)
            return (
              <button
                key={cat.code}
                type="button"
                role="tab"
                aria-selected={activeCategory === cat.code}
                className={`sm-design-tab ${activeCategory === cat.code ? 'on' : ''} ${isConfigurator ? 'configurator' : ''}`}
                onClick={() => setActiveCategory(cat.code)}
              >
                <span className="sm-design-tab-label">{cat.label}</span>
                {(count > 0 || !isConfigurator) && (
                  <span className="sm-design-tab-count">{count}</span>
                )}
              </button>
            )
          })}
        </div>
        {order.graniteColor && (
          <label className="sm-design-match-color">
            <input
              type="checkbox"
              checked={matchColor}
              onChange={e => setMatchColor(e.target.checked)}
            />
            <span>Also match my granite color ({order.graniteColor})</span>
          </label>
        )}
      </Section>

      {/* ---- Element filter chips ------------------------------------------ */}
      <Section title="Symbols & elements" eyebrow="Pick what they want — each gets its own row below">
        <div className="sm-symbol-grid">
          {SYMBOLS.map(s => (
            <button
              key={s.code}
              type="button"
              className={`sm-symbol-chip ${order.elementFilters.includes(s.code) ? 'on' : ''}`}
              onClick={() => toggleSymbol(s.code)}
            >
              <span className="sm-symbol-icon">{s.icon}</span>
              <span className="sm-symbol-label">{s.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* ---- BLING configurator surface (Sprint 3r) ------------------------ */}
      {activeCategory === 'bling' && (
        <BlingConfigurator order={order} update={update} updateAddOn={updateAddOn} />
      )}

      {/* ---- Sectioned results --------------------------------------------- */}
      {activeCategory !== 'bling' && loading && (
        <Section title="Catalog" eyebrow="Loading…">
          <div className="sm-design-loading">Loading designs from the catalog…</div>
        </Section>
      )}

      {activeCategory !== 'bling' && !loading && sections.map(section => {
        const isAllSection = section.code === 'all'
        const limit = isAllSection ? allLimit : (sectionLimits[section.code] || 6)
        const visible = section.list.slice(0, limit)
        const remaining = section.list.length - limit

        return (
          <Section
            key={section.code}
            title={`${section.icon} ${section.label}`}
            eyebrow={section.list.length === 0 ? 'No matches' : `${section.list.length} design${section.list.length === 1 ? '' : 's'}`}
          >
            {section.list.length === 0 ? (
              <div className="sm-design-empty-mini">
                No designs match. Try a different category tab{matchColor ? ', turn off "Also match my granite color",' : ''} or remove some symbols.
              </div>
            ) : (
              <>
                <div className="sm-design-grid">
                  {visible.map(renderCard)}
                </div>
                {remaining > 0 && (
                  <button
                    type="button"
                    className="sm-show-more-btn"
                    onClick={() => isAllSection ? setAllLimit(v => v + 36) : showMoreInSection(section.code)}
                  >
                    Show more {section.label.toLowerCase()} · {remaining} remaining
                  </button>
                )}
              </>
            )}
          </Section>
        )
      })}
    </div>
  )
}

// =============================================================================
// STEP 8 — INSCRIPTION (with branching for inscription-only services)
// =============================================================================

const INSCRIPTION_TYPES = [
  { code: 'full',  label: 'Full Inscription', blurb: 'Name, dates, and any titles or epitaph.' },
  { code: 'date',  label: 'Date Inscription', blurb: 'Add a date (month / day / year).' },
  { code: 'year',  label: 'Year Only',        blurb: 'Add the year of death.' },
]

function InscriptionStep({ order, update }) {
  const isInscriptionOnly = useMemo(() => {
    const inscrAndAddon = ['INSCRIPTION', 'ACID_WASH', 'REPAIR', 'ADD_PHOTO']
    return order.serviceTypes.length > 0
      && order.serviceTypes.every(c => inscrAndAddon.includes(c))
  }, [order.serviceTypes])

  const updateInsc = (patch) => update({ inscription: { ...order.inscription, ...patch } })

  // Photo upload for pre-existing marker
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const onUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const result = await uploadAttachment(file, order.id)
    setUploading(false)
    if (result) {
      updateInsc({ preExistingPhotoUrl: result.url, preExistingPhotoPath: result.path })
    } else {
      alert('Upload failed. Check the browser console for details.')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Inscription</div>
        <h1 className="sm-step-title">Inscription</h1>
        <p className="sm-step-lede">
          {isInscriptionOnly
            ? 'Inscription on an existing stone — quick job. Confirm the type and what goes on, snap a photo of the existing marker if you have one.'
            : 'What goes on the stone besides the name and dates already captured. Title is set per-person on the Memorial step.'}
        </p>
      </div>

      {/* Inscription-only-specific: type picker + photo upload */}
      {isInscriptionOnly && (
        <Section title="Inscription type" eyebrow="What kind of inscription">
          <div className="sm-card-grid sm-card-grid-services">
            {INSCRIPTION_TYPES.map(t => (
              <CardOption
                key={t.code}
                on={order.inscription.type === t.code}
                onClick={() => updateInsc({ type: t.code })}
                title={t.label}
                blurb={t.blurb}
                icon={t.code === 'full' ? '✒️' : t.code === 'date' ? '📅' : '🗓'}
              />
            ))}
          </div>
        </Section>
      )}

      {(isInscriptionOnly || order.serviceTypes.includes('ADD_PHOTO') || order.serviceTypes.includes('REPAIR') || order.serviceTypes.includes('ACID_WASH')) && (
        <Section title="Existing marker photo" eyebrow="Optional but very helpful">
          <p className="sm-helper">
            Upload a photo of the existing marker so the engraver can confirm
            spacing, font, and font size. Phone snapshots are fine.
          </p>
          {order.inscription.preExistingPhotoUrl ? (
            <div className="sm-photo-preview">
              <img src={order.inscription.preExistingPhotoUrl} alt="Existing marker" />
              <button
                type="button"
                className="sm-link-btn sm-link-btn-danger"
                onClick={() => updateInsc({ preExistingPhotoUrl: '', preExistingPhotoPath: '' })}
              >Replace photo</button>
            </div>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onUpload}
              />
              <button
                type="button"
                className="sm-add-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : '📷 Upload photo from this device'}
              </button>
            </>
          )}
        </Section>
      )}

      <Section title="Epitaph" eyebrow="Scripture, saying, or short verse">
        <Field label="Most Popular (quick pick)" hint="Click any to drop into the textbox below">
          <SelectInput
            value=""
            onChange={v => v && updateInsc({ epitaph: v })}
            placeholder="— pick a popular epitaph —"
            options={POPULAR_EPITAPHS.map(e => ({ value: e, label: e }))}
          />
        </Field>
        <EpitaphLibraryPicker
          onPick={v => updateInsc({ epitaph: v })}
          current={order.inscription.epitaph}
        />
        <Field label="Epitaph text" wide hint="Edit freely — picking from above pre-fills this">
          <TextArea
            value={order.inscription.epitaph}
            onChange={v => updateInsc({ epitaph: v })}
            rows={3}
            placeholder="e.g. Forever in our hearts · Until we meet again · El Señor es mi pastor"
          />
        </Field>
        <Field label="Custom notes for the engraver" wide hint="Optional">
          <TextArea
            value={order.inscription.customNotes}
            onChange={v => updateInsc({ customNotes: v })}
            rows={2}
            placeholder="e.g. Center the epitaph below the names · Lord's Prayer in Spanish · etch in script font"
          />
        </Field>
      </Section>

      {/* Custom font fee only applies to inscription services on existing stones —
          new stones and bronzes don't carry the custom-font surcharge. */}
      {order.serviceTypes.includes('INSCRIPTION') && (
        <Section title="Custom font" eyebrow="Inscription only — fonts we don't carry">
          <div className="sm-helper sm-helper-strong">
            For inscriptions on existing markers, a custom font that's not in
            our standard library adds <strong>$100</strong> to the order.
            (New stones and bronzes don't carry this fee.)
          </div>
          <ToggleChip
            on={order.inscription.customFont}
            onClick={() => updateInsc({ customFont: !order.inscription.customFont })}
          >
            Custom font requested (+$100)
          </ToggleChip>
          {order.inscription.customFont && (
            <Field label="Which font / what does it look like" wide>
              <TextArea
                value={order.inscription.customFontDescription}
                onChange={v => updateInsc({ customFontDescription: v })}
                rows={2}
                placeholder="e.g. Looks like Old English from a wedding invitation · matches the existing stone next to it · screenshot attached separately"
              />
            </Field>
          )}
        </Section>
      )}

      {/* Live preview — opt-in, only renders when we have enough info to be accurate */}
      {!isInscriptionOnly && (
        <Section title="Preview" eyebrow="Optional rough sketch">
          <PreviewPanel order={order} />
        </Section>
      )}

      {isInscriptionOnly && (
        <Section title="What's going on" eyebrow="Confirm the text">
          <div className="sm-helper">
            Confirm with the customer the exact text being added. They'll re-confirm
            on the contract before production starts.
          </div>
          <InscriptionTextSummary order={order} />
        </Section>
      )}
    </div>
  )
}

// Tiny summary of what's about to be added — used in the inscription-only flow
function InscriptionTextSummary({ order }) {
  const named = order.deceased.filter(d => !d.isReserved && d.firstName)
  return (
    <div className="sm-text-summary">
      {named.map((d, i) => (
        <div key={i} className="sm-text-summary-row">
          {d.title && <div className="sm-text-summary-title">{d.title}</div>}
          <div className="sm-text-summary-name">
            {[d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ')}
          </div>
          {(d.dateOfBirth || d.dateOfDeath) && (
            <div className="sm-text-summary-dates">
              {formatDate(d.dateOfBirth) || '?'} – {d.isPreNeed ? '(pre-need)' : (formatDate(d.dateOfDeath) || '?')}
            </div>
          )}
        </div>
      ))}
      {order.inscription.epitaph && (
        <div className="sm-text-summary-epitaph">"{order.inscription.epitaph}"</div>
      )}
    </div>
  )
}

// Live SVG preview of the stone with text rendered. Intentionally simple —
// flat-color granite background, clean serif type. Final layout is set in production.
// PreviewPanel — opt-in wrapper. The underlying LivePreview only renders if
// the customer has picked enough info to make the sketch accurate.
function PreviewPanel({ order }) {
  const [showPreview, setShowPreview] = useState(false)

  const shape = SHAPES.find(s => s.code === order.shape)
  const hasShape = !!shape
  const hasTopShape = !!order.topShape || ['grass', 'hickey', 'bronze', 'mausoleum'].includes(order.shape)
  const hasSize = order.width != null && order.depth != null
  const ready = hasShape && hasTopShape && hasSize

  if (!ready) {
    return (
      <div className="sm-preview-blocked">
        <div className="sm-preview-blocked-icon">📐</div>
        <div className="sm-preview-blocked-msg">
          Preview will appear once these are picked:
        </div>
        <ul className="sm-preview-blocked-list">
          {!hasShape && <li>Shape category</li>}
          {hasShape && !hasTopShape && <li>Top shape</li>}
          {!hasSize && <li>Standard size or custom dimensions</li>}
        </ul>
        <div className="sm-preview-blocked-hint">
          Go back to <strong>Step 5 — Shape & Size</strong> to fill these in.
        </div>
      </div>
    )
  }

  if (!showPreview) {
    return (
      <div className="sm-preview-optin">
        <p className="sm-helper">
          Rough sketch only — the actual carving, font, and exact spacing will
          differ. Useful for showing the customer the general shape and layout.
        </p>
        <button
          type="button"
          className="sm-add-btn"
          onClick={() => setShowPreview(true)}
        >
          Show preview
        </button>
      </div>
    )
  }

  return <LivePreview order={order} onHide={() => setShowPreview(false)} />
}

function LivePreview({ order, onHide }) {
  const shape = SHAPES.find(s => s.code === order.shape)
  const color = GRANITE_COLORS.find(c => c.code === order.graniteColor)
  const fillHex = color ? COLOR_FAMILY_HEX[color.family] : '#888'
  const topShape = order.topShape

  // Pull names + dates + title for first 2 deceased
  const named = order.deceased.filter(d => !d.isReserved && d.firstName)
  const a = named[0]
  const b = named[1]

  const W = 600, H = 360
  const groundY = 340
  let outline = null
  let textY = 150  // default text vertical anchor

  // Helper: build the top edge of an upright die given a top shape
  // Returns SVG path data starting from the top-left corner moving across the top
  const upTop = (xL, xR, yTop) => {
    const cx = (xL + xR) / 2
    if (topShape === 'flat-top')   return `L ${xR} ${yTop}`
    if (topShape === 'oval-top')   return `Q ${cx} ${yTop - 50} ${xR} ${yTop}`
    if (topShape === 'roof-top')   return `L ${cx} ${yTop - 40} L ${xR} ${yTop}`
    if (topShape === 'cathedral')  return `L ${cx} ${yTop - 70} L ${xR} ${yTop}`
    if (topShape === 'gothic')     return `Q ${xL + (xR - xL) * 0.25} ${yTop - 60} ${cx} ${yTop - 70} Q ${xR - (xR - xL) * 0.25} ${yTop - 60} ${xR} ${yTop}`
    if (topShape === 'classic-serp')   return `Q ${xL + (xR - xL) * 0.25} ${yTop - 30} ${cx} ${yTop - 30} Q ${xR - (xR - xL) * 0.25} ${yTop - 30} ${xR} ${yTop}`
    if (topShape === 'cathedral-serp') return `Q ${xL + (xR - xL) * 0.20} ${yTop - 40} ${cx} ${yTop - 60} Q ${xR - (xR - xL) * 0.20} ${yTop - 40} ${xR} ${yTop}`
    return `L ${xR} ${yTop}` // fallback flat
  }

  if (shape.code === 'grass' || shape.code === 'hickey' || shape.code === 'bronze') {
    // Lying flat — no base. Hickey gets a slight bevel hint via a thin top edge.
    const topY = shape.code === 'hickey' ? 250 : 270
    outline = <rect x="50" y={topY} width={W - 100} height={groundY - topY} rx="3" fill={fillHex} />
    textY = topY + (groundY - topY) / 2 - 8
  } else if (shape.code === 'slant' || shape.code === 'double-slant') {
    // Slanted block — NO base. Pauly was clear: slants don't have an automatic base.
    // The slant rises higher in front than back; back is taller (slant downward back-to-front)
    // We draw it sloping down toward the viewer: top-back is high, top-front is lower.
    const slantW = shape.code === 'double-slant' ? 520 : 420
    const xL = (W - slantW) / 2, xR = xL + slantW
    const topBackY = 140
    const topFrontY = 200
    outline = (
      <polygon
        points={`${xL},${groundY} ${xR},${groundY} ${xR},${topFrontY} ${xL},${topFrontY}`}
        fill={fillHex}
      />
    )
    // Add the slope as a subtle highlight on top
    outline = (
      <g>
        <polygon points={`${xL},${groundY} ${xR},${groundY} ${xR},${topFrontY} ${xL},${topFrontY}`} fill={fillHex} />
        <polygon points={`${xL},${topFrontY} ${xR},${topFrontY} ${xR - 30},${topBackY} ${xL + 30},${topBackY}`} fill={fillHex} opacity="0.85" />
      </g>
    )
    textY = topFrontY + 60
  } else if (shape.code === 'die' || shape.code === 'double-die' || shape.code === 'civic' || shape.code === 'custom') {
    // Standing die — with optional base
    const dieW = shape.code === 'double-die' ? 380 : 240
    const xL = (W - dieW) / 2, xR = xL + dieW
    const topY = 80
    const dieBottomY = order.baseConfig.include || shape.requiresBase ? groundY - 30 : groundY
    const topPath = upTop(xL, xR, topY)
    outline = (
      <g>
        <path d={`M ${xL} ${dieBottomY} L ${xL} ${topY} ${topPath} L ${xR} ${dieBottomY} Z`} fill={fillHex} />
        {(order.baseConfig.include || shape.requiresBase) && (
          <rect x={xL - 30} y={dieBottomY} width={dieW + 60} height={groundY - dieBottomY} fill={fillHex} opacity="0.9" />
        )}
      </g>
    )
    textY = topY + 60
  } else if (shape.code === 'mausoleum') {
    outline = (
      <g>
        <rect x="60" y="120" width={W - 120} height={groundY - 120} fill={fillHex} />
        <polygon points={`60,120 ${W / 2},60 ${W - 60},120`} fill={fillHex} />
      </g>
    )
    textY = 200
  }

  return (
    <div className="sm-live-preview">
      <div className="sm-live-preview-actions">
        <button type="button" className="sm-link-btn" onClick={onHide}>Hide preview</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Ground line */}
        <rect x="0" y={groundY} width={W} height={H - groundY} fill="#d8d4cc" />
        {outline}

        {/* Engraved text */}
        <g fill="rgba(255,255,255,0.92)" textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif">
          {a?.title && (
            <text x={W / 2} y={textY} fontSize="13" fontStyle="italic" opacity="0.85" letterSpacing="2">
              {a.title.toUpperCase()}
            </text>
          )}
          {a?.firstName && (
            <text x={W / 2} y={textY + (a?.title ? 32 : 0)} fontSize="28" fontWeight="500">
              {[a.firstName, a.lastName].filter(Boolean).join(' ').toUpperCase()}
            </text>
          )}
          {(a?.dateOfBirth || a?.dateOfDeath) && (
            <text x={W / 2} y={textY + (a?.title ? 54 : 24)} fontSize="12" opacity="0.85">
              {(a.dateOfBirth ? new Date(a.dateOfBirth).getFullYear() : '?')}
              {' – '}
              {a.isPreNeed ? '\u00A0\u00A0\u00A0' : (a.dateOfDeath ? new Date(a.dateOfDeath).getFullYear() : '?')}
            </text>
          )}
          {b?.firstName && (
            <text x={W / 2} y={textY + 90} fontSize="18" fontWeight="500">
              {[b.firstName, b.lastName].filter(Boolean).join(' ').toUpperCase()}
            </text>
          )}
          {b && (b?.dateOfBirth || b?.dateOfDeath) && (
            <text x={W / 2} y={textY + 108} fontSize="11" opacity="0.85">
              {(b.dateOfBirth ? new Date(b.dateOfBirth).getFullYear() : '?')}
              {' – '}
              {b.isPreNeed ? '\u00A0\u00A0\u00A0' : (b.dateOfDeath ? new Date(b.dateOfDeath).getFullYear() : '?')}
            </text>
          )}
          {order.inscription?.epitaph && (
            <text x={W / 2} y={textY + (b ? 132 : 76)} fontSize="10" fontStyle="italic" opacity="0.78">
              "{order.inscription.epitaph.length > 50 ? order.inscription.epitaph.slice(0, 47) + '…' : order.inscription.epitaph}"
            </text>
          )}
        </g>
      </svg>

      <div className="sm-live-preview-caption">
        {color && <span>{color.label} ({color.origin})</span>}
        {shape && <span>{shape.label}</span>}
        {topShape && <span>{TOP_SHAPES.find(t => t.code === topShape)?.label}</span>}
        {order.width != null && <span>{order.width}″ × {order.depth}″ × {order.thickness}″</span>}
      </div>
    </div>
  )
}

// =============================================================================
// EPITAPH LIBRARY PICKER (Sprint 2.5)
// =============================================================================

function EpitaphLibraryPicker({ onPick, current }) {
  const [open, setOpen] = useState(false)
  const [activeCat, setActiveCat] = useState('most-popular')
  const [search, setSearch] = useState('')

  // Normalize an item — strings become {text, label} where label === text
  const norm = (item) => typeof item === 'string'
    ? { text: item, label: item }
    : { text: item.text, label: item.label || item.text }

  // Search across all categories — gives a flat list of matches
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const out = []
    for (const [catCode, cat] of Object.entries(EPITAPH_LIBRARY)) {
      for (const item of cat.items) {
        const n = norm(item)
        if (n.label.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)) {
          out.push({ catLabel: cat.label, catCode, ...n })
        }
      }
    }
    return out
  }, [search])

  if (!open) {
    const totalItems = Object.values(EPITAPH_LIBRARY).reduce((n, c) => n + c.items.length, 0)
    return (
      <button type="button" className="sm-add-btn sm-epi-open-btn" onClick={() => setOpen(true)}>
        📖 Browse the full epitaph library ({totalItems} entries across {Object.keys(EPITAPH_LIBRARY).length} categories)
      </button>
    )
  }

  const cat = EPITAPH_LIBRARY[activeCat]

  return (
    <div className="sm-epi-library">
      <div className="sm-epi-library-head">
        <div className="sm-epi-library-title">Epitaph library</div>
        <button type="button" className="sm-link-btn" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="sm-epi-search-row">
        <TextInput
          value={search}
          onChange={setSearch}
          placeholder="Search across all categories…"
        />
      </div>

      {searchResults ? (
        <div className="sm-epi-search-results">
          {searchResults.length === 0 && (
            <div className="sm-epi-empty">No matches in any category.</div>
          )}
          {searchResults.map((r, i) => (
            <button
              key={i}
              type="button"
              className={`sm-epi-item ${current === r.text ? 'on' : ''}`}
              onClick={() => onPick(r.text)}
            >
              <span className="sm-epi-item-cat">{r.catLabel}</span>
              <span className="sm-epi-item-text" dir="auto">{r.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="sm-epi-cat-row">
            {Object.entries(EPITAPH_LIBRARY).map(([code, c]) => (
              <button
                key={code}
                type="button"
                className={`sm-epi-cat ${activeCat === code ? 'on' : ''}`}
                onClick={() => setActiveCat(code)}
              >
                <span>{c.icon}</span> {c.label} <span className="sm-epi-cat-count">{c.items.length}</span>
              </button>
            ))}
          </div>
          <div className="sm-epi-list">
            {cat.items.map((item, i) => {
              const n = norm(item)
              return (
                <button
                  key={i}
                  type="button"
                  className={`sm-epi-item ${current === n.text ? 'on' : ''}`}
                  onClick={() => onPick(n.text)}
                >
                  <span className="sm-epi-item-text" dir="auto">{n.label}</span>
                  {current === n.text && <span className="sm-epi-item-check">✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================================
// STEP 9 — ADD-ONS (Sprint 3)
// =============================================================================

function AddOnsStep({ order, update }) {
  // Generic catalog grouping (carvings + photo handled separately below).
  // Lettering is hidden for new-stone work — only chargeable on existing-stone
  // inscription jobs.
  const grouped = useMemo(() => {
    const out = {}
    const showLettering = order.serviceTypes.includes('INSCRIPTION')
    for (const a of ADD_ONS_CATALOG) {
      if (a.category === 'Lettering' && !showLettering) continue
      if (!out[a.category]) out[a.category] = []
      out[a.category].push(a)
    }
    return out
  }, [order.serviceTypes])

  // Veteran category is hidden by default (most orders don't need it).
  // Auto-expand if the draft already has any veteran addon.
  const VETERAN_CODES = ['granite-vet-fdn', 'granite-vet', 'bronze-vet-fdn', 'bronze-vet']
  const [showVeteran, setShowVeteran] = useState(
    () => order.addOns.some(a => VETERAN_CODES.includes(a.code))
  )

  const findOnOrder = (code) => order.addOns.find(a => a.code === code)

  const toggleAddOn = (cat) => {
    const existing = findOnOrder(cat.code)
    if (existing) {
      update({ addOns: order.addOns.filter(a => a.code !== cat.code) })
    } else {
      update({
        addOns: [...order.addOns, {
          code: cat.code,
          label: cat.label,
          qty: 1,
          price: cat.price,
          notes: '',
        }],
      })
    }
  }

  const updateAddOn = (code, patch) => {
    update({
      addOns: order.addOns.map(a => a.code === code ? { ...a, ...patch } : a),
    })
  }

  // Custom add-on flow
  const addCustom = () => {
    update({
      addOns: [...order.addOns, {
        code: `custom-${Date.now()}`,
        qty: 1,
        price: 0,
        label: '',
        notes: '',
        isFreeform: true,
      }],
    })
  }

  const totalAddOns = order.addOns.reduce((sum, a) => sum + (Number(a.price) || 0) * (a.qty || 1), 0)

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Add-ons</div>
        <h1 className="sm-step-title">Add-ons</h1>
        <p className="sm-step-lede">
          Carvings, photos, vase panels, permits, delivery — anything on top
          of the base stone. Default prices come from your pricing sheet but
          you can override any of them.
        </p>
      </div>

      {/* ---- CARVINGS — flat vs shape picker ----------------------------- */}
      <CarvingsSection order={order} update={update} updateAddOn={updateAddOn} />

      {/* ---- PHOTO — type + size grid from photo chart ------------------- */}
      <PhotoSection order={order} update={update} updateAddOn={updateAddOn} />

      {/* ---- Other categories (generic toggle list) --------------------- */}
      {Object.entries(grouped).map(([cat, items]) => {
        // Veteran is hidden behind a toggle — most orders aren't veteran markers
        if (cat === 'Veteran' && !showVeteran) {
          return (
            <button
              key={cat}
              type="button"
              className="sm-add-btn sm-veteran-toggle"
              onClick={() => setShowVeteran(true)}
            >
              🎖 Add veteran marker options <span className="sm-veteran-toggle-hint">(skip if not needed)</span>
            </button>
          )
        }
        return (
        <Section
          key={cat}
          title={cat}
          eyebrow={`${items.length} option${items.length === 1 ? '' : 's'}`}
          right={cat === 'Veteran' && (
            <button
              type="button"
              className="sm-link-btn"
              onClick={() => {
                // Hide and clear any picked veteran addons
                update({ addOns: order.addOns.filter(a => !VETERAN_CODES.includes(a.code)) })
                setShowVeteran(false)
              }}
            >
              Hide
            </button>
          )}
        >
          <div className="sm-addon-grid">
            {items.map(a => {
              const onOrder = findOnOrder(a.code)
              return (
                <div key={a.code} className={`sm-addon-row ${onOrder ? 'on' : ''}`}>
                  <button
                    type="button"
                    className="sm-addon-toggle"
                    onClick={() => toggleAddOn(a)}
                  >
                    <span className={`sm-addon-checkbox ${onOrder ? 'on' : ''}`}>
                      {onOrder ? '✓' : ''}
                    </span>
                    <span className="sm-addon-label">{a.label}</span>
                    <span className="sm-addon-default-price">
                      {a.custom ? 'custom' : '$' + a.price.toLocaleString()}
                    </span>
                  </button>
                  {onOrder && (
                    <div className="sm-addon-config">
                      <div className="sm-addon-config-grid">
                        <Field label="Qty">
                          <TextInput
                            type="number"
                            value={onOrder.qty}
                            onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })}
                          />
                        </Field>
                        <Field label="Price each">
                          <TextInput
                            type="number"
                            value={onOrder.price}
                            onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })}
                          />
                        </Field>
                        <Field label="Line total">
                          <TextInput
                            value={'$' + ((onOrder.price || 0) * (onOrder.qty || 1)).toLocaleString()}
                            onChange={() => {}}
                            disabled
                          />
                        </Field>
                      </div>
                      <Field label="Notes (optional)" wide>
                        <TextInput
                          value={onOrder.notes}
                          onChange={v => updateAddOn(a.code, { notes: v })}
                          placeholder="e.g. Place on the right · etched in white · etc."
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
        )
      })}

      {/* Custom add-ons (freeform) */}
      <Section title="Custom add-ons" eyebrow="Anything not in the catalog above">
        {order.addOns.filter(a => a.isFreeform).map((a, i) => (
          <div key={a.code} className="sm-addon-row on" style={{ marginBottom: 12 }}>
            <div className="sm-addon-config-grid">
              <Field label="Description">
                <TextInput
                  value={a.label || ''}
                  onChange={v => updateAddOn(a.code, { label: v })}
                  placeholder="e.g. Stained glass cutout"
                />
              </Field>
              <Field label="Qty">
                <TextInput
                  type="number"
                  value={a.qty}
                  onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })}
                />
              </Field>
              <Field label="Price each">
                <TextInput
                  type="number"
                  value={a.price}
                  onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })}
                />
              </Field>
            </div>
            <button
              type="button"
              className="sm-link-btn sm-link-btn-danger"
              onClick={() => update({ addOns: order.addOns.filter(x => x.code !== a.code) })}
              style={{ marginTop: 8 }}
            >
              Remove this custom add-on
            </button>
          </div>
        ))}
        <button type="button" className="sm-add-btn" onClick={addCustom}>
          + Add a custom item
        </button>
      </Section>

      {/* Running total summary */}
      {order.addOns.length > 0 && (
        <Section title="Add-ons subtotal" eyebrow={`${order.addOns.length} item${order.addOns.length === 1 ? '' : 's'}`}>
          <div className="sm-addon-summary">
            <div className="sm-addon-summary-label">Total of all add-ons</div>
            <div className="sm-addon-summary-amount">${totalAddOns.toLocaleString()}</div>
          </div>
        </Section>
      )}
    </div>
  )
}

// ----- Carvings sub-section: Sprint 3j multi-select -----
// Pick any combination of Flat / Shape / Hand-Sculpted / Laser Etching.
// Each toggles independently. When on, the type's config block appears below.
function CarvingsSection({ order, update, updateAddOn }) {
  // Coming-soon modal state — Vase/BLING cards open this instead of toggling.
  // TODO: extract a shared <Modal> component in a housekeeping sprint;
  // for now this inlines the sm-pdf-preview-overlay pattern.
  const [comingSoonType, setComingSoonType] = useState(null)

  // Picker-open state for the multi-item types. The card click flips
  // these to reveal the picker; the ✓ check on the card still derives from
  // shapeOn/laserOn/blingOn/vaseOn (= "user has actually picked something").
  const [shapeOpen, setShapeOpen] = useState(false)
  const [laserOpen, setLaserOpen] = useState(false)
  const [blingOpen, setBlingOpen] = useState(false)
  const [vaseOpen,  setVaseOpen]  = useState(false)

  // Detect what's on by checking add-ons
  const flatOn     = order.addOns.some(a => a.code === 'flat-carve')
  const shapeOn    = order.addOns.some(a => SHAPE_CARVED_CODES.includes(a.code))
  const sculptedOn = order.addOns.some(a => a.code === 'hand-sculpted')
  const laserOn    = order.addOns.some(a => a.code?.startsWith('laser-'))
  const blingOn    = order.addOns.some(a => a.code?.startsWith('bling-'))
  const vaseOn     = order.addOns.some(a => a.code?.startsWith('vase-'))

  const isOn = (code) =>
    code === 'flat'     ? flatOn
  : code === 'shape'    ? shapeOn
  : code === 'sculpted' ? sculptedOn
  : code === 'laser'    ? laserOn
  : code === 'bling'    ? blingOn
  : code === 'vase'     ? vaseOn
  : false

  // ---- Toggle handlers (per type) ------------------------------------------
  const toggleFlat = () => {
    if (flatOn) {
      update({ addOns: order.addOns.filter(a => a.code !== 'flat-carve') })
    } else {
      update({ addOns: [...order.addOns, {
        code: 'flat-carve', label: 'Flat Carve', price: 0, qty: 1, notes: '', freeWithStone: true,
      }]})
    }
  }
  const toggleShape = () => {
    if (shapeOpen || shapeOn) {
      // Close: hide the picker AND clear any picked designs (close-clears).
      setShapeOpen(false)
      if (shapeOn) {
        update({ addOns: order.addOns.filter(a => !SHAPE_CARVED_CODES.includes(a.code)) })
      }
    } else {
      setShapeOpen(true)
    }
  }
  const toggleSculpted = () => {
    if (sculptedOn) {
      update({ addOns: order.addOns.filter(a => a.code !== 'hand-sculpted') })
    } else {
      update({ addOns: [...order.addOns, {
        code: 'hand-sculpted', label: 'Hand Sculpted (custom)', price: 0, qty: 1, notes: '',
      }]})
    }
  }
  const toggleLaser = () => {
    if (laserOpen || laserOn) {
      // Close: hide the picker AND clear any picked sizes (close-clears).
      setLaserOpen(false)
      if (laserOn) {
        update({ addOns: order.addOns.filter(a => !a.code?.startsWith('laser-')) })
      }
    } else {
      setLaserOpen(true)
    }
  }
  const toggleBling = () => {
    if (blingOpen || blingOn) {
      // Close: hide the picker AND clear any picked BLINGs (close-clears).
      setBlingOpen(false)
      if (blingOn) {
        update({ addOns: order.addOns.filter(a => !a.code?.startsWith('bling-')) })
      }
    } else {
      setBlingOpen(true)
    }
  }
  const toggleVase = () => {
    if (vaseOpen || vaseOn) {
      // Close: hide the picker AND clear any picked vases (close-clears).
      setVaseOpen(false)
      if (vaseOn) {
        update({ addOns: order.addOns.filter(a => !a.code?.startsWith('vase-')) })
      }
    } else {
      setVaseOpen(true)
    }
  }
  const toggleByCode = (code) =>
    code === 'flat'     ? toggleFlat()
  : code === 'shape'    ? toggleShape()
  : code === 'sculpted' ? toggleSculpted()
  : code === 'laser'    ? toggleLaser()
  : code === 'bling'    ? toggleBling()
  : code === 'vase'     ? toggleVase()
  : null

  // ---- Shape-Carved design picker ------------------------------------------
  const toggleShapeDesign = (d) => {
    const existing = order.addOns.find(a => a.code === d.code)
    if (existing) {
      update({ addOns: order.addOns.filter(a => a.code !== d.code) })
    } else {
      update({ addOns: [...order.addOns, {
        code: d.code, label: d.label, qty: 1, price: d.price, notes: '',
      }]})
    }
  }
  const shapeDesignsOn = order.addOns.filter(a => SHAPE_CARVED_CODES.includes(a.code))

  // ---- Laser Etching --------------------------------------------------------
  const stoneSqIn = stoneFaceArea(order)
  const laserAddOns = order.addOns.filter(a => a.code?.startsWith('laser-'))
  const totalLaserSqIn = laserAddOns.reduce((sum, a) => {
    const sizeCode = a.code.slice('laser-'.length).split('-')[0]   // 'sm' from 'laser-sm-1'
    const size = LASER_SIZES.find(s => s.code === sizeCode)
    if (!size) return sum
    const sqIn = size.computeFromStone ? (stoneSqIn || 0) : (size.sqIn || 0)
    return sum + sqIn * (a.qty || 1)
  }, 0)
  const overLimit = stoneSqIn != null && totalLaserSqIn > stoneSqIn

  const addLaserSize = (sizeCode) => {
    const size = LASER_SIZES.find(s => s.code === sizeCode)
    if (!size) return
    // For "whole face" — only allow one
    if (size.computeFromStone) {
      const exists = order.addOns.some(a => a.code === `laser-${sizeCode}-1`)
      if (exists) return
    }
    // Find next index for stacking multiples (laser-sm-1, laser-sm-2, ...)
    let idx = 1
    while (order.addOns.some(a => a.code === `laser-${sizeCode}-${idx}`)) idx++
    const price = computeLaserPrice(sizeCode, stoneSqIn)
    update({ addOns: [...order.addOns, {
      code: `laser-${sizeCode}-${idx}`,
      label: `Laser Etching · ${size.label}${size.dim !== 'full stone face' ? ` (${size.dim})` : ' (whole face)'}`,
      qty: 1, price, notes: '',
    }]})
  }

  return (
    <>
    <Section
      title="Carvings"
      eyebrow="Pick any combination — Flat, Shape, Hand-Sculpted, Laser Etching"
    >
      {/* 6 type toggles — Vase + BLING route to the coming-soon modal */}
      <div className="sm-carve-types">
        {CARVE_TYPES.map(t => (
          <CarveTypeCard
            key={t.code}
            type={t}
            on={!t.comingSoon && isOn(t.code)}
            onClick={t.comingSoon ? () => setComingSoonType(t) : () => toggleByCode(t.code)}
          />
        ))}
      </div>

      {/* ---- Flat Carve config — included with stone, just notes ---- */}
      {flatOn && (() => {
        const a = order.addOns.find(x => x.code === 'flat-carve')
        if (!a) return null
        return (
          <div className="sm-carve-config">
            <div className="sm-carve-config-eyebrow">Flat Carve · included in base stone price</div>
            <Field label="What's being carved (notes for the engraver)" wide>
              <TextInput value={a.notes}
                onChange={v => updateAddOn('flat-carve', { notes: v })}
                placeholder="e.g. small cross above the name · 6″ rose on left side · scenic line drawing of the lake" />
            </Field>
          </div>
        )
      })()}

      {/* ---- Shape Carved design picker ---- */}
      {(shapeOn || shapeOpen) && (
        <div className="sm-carve-config">
          <div className="sm-carve-config-eyebrow">Shape Carved · pick one or more designs</div>
          <div className="sm-shape-design-grid">
            {SHAPE_CARVED_DESIGNS.filter(d => d.code !== 'etched-12x12').map(d => {
              const on = order.addOns.some(a => a.code === d.code)
              return (
                <button key={d.code} type="button"
                  className={`sm-shape-design-card ${on ? 'on' : ''}`}
                  onClick={() => toggleShapeDesign(d)}
                >
                  <span className={`sm-addon-checkbox ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                  <span className="sm-shape-design-label">{d.label}</span>
                  <span className="sm-shape-design-price">
                    {d.custom ? 'custom' : '$' + d.price.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
          {shapeDesignsOn.map(a => (
            <div key={a.code} className="sm-carve-design-config">
              <div className="sm-carve-design-config-label">{a.label}</div>
              <div className="sm-addon-config-grid">
                <Field label="Qty"><TextInput type="number" value={a.qty}
                  onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })} /></Field>
                <Field label="Price each"><TextInput type="number" value={a.price}
                  onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })} /></Field>
                <Field label="Total"><TextInput
                  value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                  onChange={() => {}} disabled /></Field>
              </div>
              <Field label="Notes" wide><TextInput value={a.notes}
                onChange={v => updateAddOn(a.code, { notes: v })}
                placeholder="e.g. center on the die · 4″ tall · in script style" /></Field>
            </div>
          ))}
        </div>
      )}

      {/* ---- Hand Sculpted ---- */}
      {sculptedOn && (() => {
        const a = order.addOns.find(x => x.code === 'hand-sculpted')
        if (!a) return null
        return (
          <div className="sm-carve-config">
            <div className="sm-carve-config-eyebrow">Hand Sculpted · custom-priced per project</div>
            <div className="sm-addon-config-grid">
              <Field label="Price">
                <TextInput type="number" value={a.price}
                  onChange={v => updateAddOn('hand-sculpted', { price: Number(v) || 0 })}
                  placeholder="set by quote" />
              </Field>
              <Field label="Qty">
                <TextInput type="number" value={a.qty}
                  onChange={v => updateAddOn('hand-sculpted', { qty: Math.max(1, Number(v) || 1) })} />
              </Field>
              <Field label="Total">
                <TextInput value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                  onChange={() => {}} disabled />
              </Field>
            </div>
            <Field label="Description (what's being sculpted)" wide>
              <TextInput value={a.notes}
                onChange={v => updateAddOn('hand-sculpted', { notes: v })}
                placeholder="e.g. cherub angel face on the cap · standing dove with outstretched wings · family crest in relief" />
            </Field>
          </div>
        )
      })()}

      {/* ---- Laser Etching ---- */}
      {(laserOn || laserOpen) && (
        <div className="sm-carve-config">
          <div className="sm-carve-config-eyebrow">
            Laser Etching · base ${LASER_BASE_PER_SQIN.toFixed(2)}/sq in for 12×12 · larger sizes get a discount
            {stoneSqIn != null && (
              <span className="sm-laser-cap">
                · stone face ≈ {stoneSqIn.toLocaleString()} sq in
                {overLimit && <span className="sm-laser-warn"> · ⚠ over face limit</span>}
              </span>
            )}
          </div>

          {/* Size picker grid — click to add. Multiple of each size allowed. */}
          <div className="sm-laser-grid">
            {LASER_SIZES.map(size => {
              const price = computeLaserPrice(size.code, stoneSqIn)
              const isWhole = size.computeFromStone
              const wholeOn = isWhole && order.addOns.some(a => a.code === `laser-${size.code}-1`)
              const rate = LASER_BASE_PER_SQIN * (1 - size.discount)
              const showPrice = !(isWhole && !stoneSqIn)
              return (
                <button key={size.code} type="button"
                  className={`sm-laser-size-card ${wholeOn ? 'on' : ''}`}
                  onClick={() => addLaserSize(size.code)}
                  disabled={wholeOn}
                >
                  <div className="sm-laser-size-name">{size.label}</div>
                  <div className="sm-laser-size-dim">{size.dim}</div>
                  <div className="sm-laser-size-blurb">{size.blurb}</div>
                  <div className="sm-laser-size-price">
                    {showPrice ? `$${price.toLocaleString()}` : '— pick a stone size first'}
                    {showPrice && (
                      <span className="sm-laser-size-disc">
                        {' (' + (size.discount > 0 ? `${Math.round(size.discount * 100)}% off · ` : '') + `$${rate.toFixed(2)}/sq in)`}
                      </span>
                    )}
                  </div>
                  {!wholeOn && <div className="sm-laser-size-add">+ Add</div>}
                  {wholeOn  && <div className="sm-laser-size-on">✓ Selected</div>}
                </button>
              )
            })}
          </div>

          {/* Each laser instance editable */}
          {laserAddOns.map(a => (
            <div key={a.code} className="sm-carve-design-config">
              <div className="sm-carve-design-config-label">
                {a.label}
                <button type="button" className="sm-link-btn sm-link-btn-danger"
                  onClick={() => update({ addOns: order.addOns.filter(x => x.code !== a.code) })}
                  style={{ float: 'right' }}>Remove</button>
              </div>
              <div className="sm-addon-config-grid">
                <Field label="Qty">
                  <TextInput type="number" value={a.qty}
                    onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })} />
                </Field>
                <Field label="Price each">
                  <TextInput type="number" value={a.price}
                    onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })} />
                </Field>
                <Field label="Total">
                  <TextInput value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                    onChange={() => {}} disabled />
                </Field>
              </div>
              <Field label="What's being etched" wide>
                <TextInput value={a.notes}
                  onChange={v => updateAddOn(a.code, { notes: v })}
                  placeholder="e.g. portrait of grandmother from the photo · landscape scene of the lake at sunset" />
              </Field>
            </div>
          ))}
        </div>
      )}

      {/* ---- BLING configurator (Sprint 3p.2) ---- */}
      {(blingOn || blingOpen) && (
        <BlingConfigurator order={order} update={update} updateAddOn={updateAddOn} />
      )}

      {/* ---- Vase configurator (Sprint 3p.3) ---- */}
      {(vaseOn || vaseOpen) && (
        <VaseConfigurator order={order} update={update} updateAddOn={updateAddOn} />
      )}
    </Section>

    {comingSoonType && (
      <div className="sm-pdf-preview-overlay" onClick={() => setComingSoonType(null)}>
        <div className="sm-coming-soon-modal" onClick={e => e.stopPropagation()}>
          <div className="sm-pdf-preview-head">
            <div className="sm-pdf-preview-title">{comingSoonType.label} — Coming Soon</div>
            <div className="sm-pdf-preview-actions">
              <button type="button" className="sm-link-btn" onClick={() => setComingSoonType(null)}>
                Close ×
              </button>
            </div>
          </div>
          <div className="sm-coming-soon-body">
            {comingSoonType.code === 'bling'
              ? 'BLING configurator ships in Sprint 3p.2 — three sizes with a 21-color picker.'
              : 'Vase configurator ships in Sprint 3p.3 — six sizes, 17 shapes, fit-checked against the base.'}
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// =============================================================================
// BLING CONFIGURATOR (Sprint 3p.2) — size → shape → color, multi-add
// =============================================================================
function BlingConfigurator({ order, update, updateAddOn }) {
  // The config currently being built. null = no active build; the size grid
  // just sits there waiting. Picking a size starts a fresh config.
  const [active, setActive] = useState(null)
  // Examples gallery modal: null | { mode: 'option' | 'all', optionCode?: string }
  const [examplesModal, setExamplesModal] = useState(null)
  // Enlarged example inside the gallery (null = grid view)
  const [enlarged, setEnlarged] = useState(null)
  // Whether the 21-color picker is currently expanded inline
  const [showColors, setShowColors] = useState(false)

  const picked = order.addOns.filter(a => a.code?.startsWith('bling-'))
  const stoneColorCode = order.graniteColor || null
  const stoneColor = stoneColorCode ? GRANITE_COLORS.find(c => c.code === stoneColorCode) : null

  const startConfig = (sizeCode) => {
    setActive({ size: sizeCode, shape: null, matchStone: true, color: null })
    setShowColors(false)
  }
  const pickShape = (optionCode) => {
    setActive(prev => prev ? { ...prev, shape: optionCode } : prev)
  }
  const setMatchStone = (val) => {
    setActive(prev => prev ? { ...prev, matchStone: val, color: val ? null : prev.color } : prev)
    if (val) setShowColors(false)
  }
  const pickColor = (code) => {
    setActive(prev => prev ? { ...prev, color: code, matchStone: false } : prev)
    setShowColors(false)
  }

  const activeColorCode = active && (active.matchStone ? stoneColorCode : active.color)
  const activePrice = active ? computeBlingPrice(active.size, activeColorCode) : 0
  const activeUpcharge = activeColorCode ? blingColorUpcharge(activeColorCode) : 0

  const commit = () => {
    if (!active || !active.shape) return
    // Same (size, shape) combo can be added multiple times; suffix with an idx
    // so each instance gets its own editable row (matches the Laser pattern).
    let idx = 1
    while (order.addOns.some(a => a.code === `bling-${active.size}-${active.shape}-${idx}`)) idx++
    const colorCodeFinal = active.matchStone ? stoneColorCode : active.color
    const colorRec = colorCodeFinal ? GRANITE_COLORS.find(c => c.code === colorCodeFinal) : null
    const option = BLING_OPTIONS.find(o => o.code === active.shape)
    const sizeRec = BLING_SIZES.find(s => s.code === active.size)
    const colorLabel = active.matchStone
      ? `match stone${colorRec ? ` (${colorRec.label})` : ''}`
      : (colorRec?.label ?? '—')
    update({ addOns: [...order.addOns, {
      code: `bling-${active.size}-${active.shape}-${idx}`,
      label: `BLING · ${sizeRec?.label ?? active.size} · ${option?.label ?? active.shape} (${colorLabel})`,
      qty: 1,
      price: activePrice,
      notes: '',
      blingSize: active.size,
      blingShape: active.shape,
      blingMatchStone: active.matchStone,
      blingColor: colorCodeFinal,
    }]})
    setActive(null)
    setShowColors(false)
  }

  const closeModal = () => { setExamplesModal(null); setEnlarged(null) }

  return (
    <div className="sm-carve-config sm-bling-config">
      <div className="sm-carve-config-eyebrow">BLING · pick size → shape → color, add multiple</div>

      {/* Step 1 — size picker (always visible) */}
      <div className="sm-bling-step-label">1 · Size</div>
      <div className="sm-bling-size-grid">
        {BLING_SIZES.map(s => {
          const on = active?.size === s.code
          return (
            <button key={s.code} type="button"
              className={`sm-bling-size-card ${on ? 'on' : ''}`}
              onClick={() => startConfig(s.code)}
            >
              <div className="sm-bling-size-name">{s.label}</div>
              <div className="sm-bling-size-dim">{s.dim}</div>
              <div className="sm-bling-size-price">${s.basePrice.toLocaleString()}</div>
              {!on && <div className="sm-bling-size-add">+ Start</div>}
              {on  && <div className="sm-bling-size-on">✓ Active</div>}
            </button>
          )
        })}
      </div>

      {/* Step 2 — shape picker (revealed once a size is being configured) */}
      {active && (
        <>
          <div className="sm-bling-step-row">
            <div className="sm-bling-step-label">2 · Shape</div>
            <button type="button" className="sm-link-btn"
              onClick={() => setExamplesModal({ mode: 'all' })}>
              See all installed examples →
            </button>
          </div>
          <div className="sm-bling-shape-grid">
            {BLING_OPTIONS.map(o => {
              const on = active.shape === o.code
              return (
                <button key={o.code} type="button"
                  className={`sm-bling-shape-card ${on ? 'on' : ''}`}
                  onClick={() => pickShape(o.code)}
                >
                  <div className="sm-bling-shape-thumb">
                    <img src={o.photo} alt={o.label} loading="lazy"
                      onError={ev => { ev.currentTarget.style.display = 'none' }} />
                  </div>
                  <div className="sm-bling-shape-label">{o.label}</div>
                  {on && <div className="sm-bling-shape-check">✓</div>}
                </button>
              )
            })}
          </div>

        </>
      )}

      {/* Step 3 — color picker (revealed once a shape is picked) */}
      {active && active.shape && (
        <>
          <div className="sm-bling-step-label">3 · Color</div>
          <div className="sm-bling-color-row">
            <label className="sm-bling-match-toggle">
              <input type="checkbox" checked={active.matchStone}
                onChange={ev => setMatchStone(ev.target.checked)} />
              <span>Match stone color</span>
              {active.matchStone && stoneColor && (
                <span className="sm-bling-stone-name"> · {stoneColor.label}</span>
              )}
              {active.matchStone && !stoneColor && (
                <span className="sm-bling-stone-empty"> · no stone color picked yet (base price)</span>
              )}
            </label>
            {!active.matchStone && active.color && (
              <div className="sm-bling-color-current">
                <strong>{GRANITE_COLORS.find(c => c.code === active.color)?.label ?? active.color}</strong>
                {activeUpcharge > 0 && (
                  <span className="sm-bling-color-upcharge"> · +{Math.round(activeUpcharge * 100)}%</span>
                )}
              </div>
            )}
            <button type="button" className="sm-link-btn"
              onClick={() => setShowColors(v => !v)}>
              {showColors ? 'Hide colors' : 'Change'}
            </button>
          </div>

          {showColors && (
            <div className="sm-bling-color-grid">
              {GRANITE_COLORS.map(c => (
                <button key={c.code} type="button"
                  className={`sm-bling-color-card ${active.color === c.code ? 'on' : ''}`}
                  onClick={() => pickColor(c.code)}>
                  <div className="sm-bling-color-swatch">
                    <img src={`/granite/${c.file}`} alt={c.label} loading="lazy" />
                  </div>
                  <div className="sm-bling-color-info">
                    <div className="sm-bling-color-name">{c.label}</div>
                    {c.premium > 0 && (
                      <div className="sm-bling-color-prem">+{Math.round(c.premium * 100)}%</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="sm-bling-add-row">
            <div className="sm-bling-add-price">
              <span className="sm-bling-add-eyebrow">This BLING:</span>
              <span className="sm-bling-add-amt">${activePrice.toLocaleString()}</span>
              {activeUpcharge > 0 && (
                <span className="sm-bling-add-upcharge"> · +{Math.round(activeUpcharge * 100)}% color</span>
              )}
            </div>
            <button type="button" className="sm-bling-add-btn"
              onClick={commit} disabled={!active.shape}>
              + Add this BLING to order
            </button>
            <button type="button" className="sm-link-btn"
              onClick={() => { setActive(null); setShowColors(false) }}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Per-instance editor rows for BLINGs already added.
          Mirrors the Laser Etching pattern: stacked layout (label row on top,
          controls grid below) so QTY / Price / Total never collide with the
          label text. Thumbnail is a small inline icon on the header row. */}
      {picked.length > 0 && (
        <div className="sm-bling-instances">
          <div className="sm-bling-step-label">Added to this order ({picked.length})</div>
          {picked.map(a => {
            const opt = BLING_OPTIONS.find(o => o.code === a.blingShape)
            const sz = BLING_SIZES.find(s => s.code === a.blingSize)
            const colorRec = a.blingColor ? GRANITE_COLORS.find(c => c.code === a.blingColor) : null
            return (
              <div key={a.code} className="sm-carve-design-config sm-bling-instance-row">
                <div className="sm-carve-design-config-label sm-bling-instance-header">
                  {opt && (
                    <span className="sm-bling-instance-thumb-inline">
                      <img src={opt.photo} alt={opt.label}
                        onError={ev => { ev.currentTarget.style.display = 'none' }} />
                    </span>
                  )}
                  <span className="sm-bling-instance-text">
                    <span className="sm-bling-instance-label-main">
                      {sz?.label ?? a.blingSize} · {opt?.label ?? a.blingShape}
                    </span>
                    <span className="sm-bling-instance-sub">
                      {a.blingMatchStone
                        ? `Match stone${colorRec ? ` (${colorRec.label})` : ''}`
                        : (colorRec?.label ?? '—')}
                    </span>
                  </span>
                  <button type="button" className="sm-link-btn sm-link-btn-danger"
                    onClick={() => update({ addOns: order.addOns.filter(x => x.code !== a.code) })}
                    style={{ marginLeft: 'auto' }}>
                    Remove
                  </button>
                </div>
                <div className="sm-addon-config-grid">
                  <Field label="Qty">
                    <TextInput type="number" value={a.qty}
                      onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })} />
                  </Field>
                  <Field label="Price each">
                    <TextInput type="number" value={a.price}
                      onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })} />
                  </Field>
                  <Field label="Total">
                    <TextInput value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                      onChange={() => {}} disabled />
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Examples gallery modal — reuses sm-pdf-preview-overlay shell */}
      {examplesModal && (() => {
        const list = examplesModal.mode === 'option'
          ? blingExamplesFor(examplesModal.optionCode)
          : BLING_EXAMPLES
        const optLabel = examplesModal.mode === 'option'
          ? (BLING_OPTIONS.find(o => o.code === examplesModal.optionCode)?.label ?? '')
          : null
        const headerLabel = examplesModal.mode === 'option'
          ? `${optLabel} — installed examples`
          : 'All installed BLING examples'
        return (
          <div className="sm-pdf-preview-overlay" onClick={closeModal}>
            <div className="sm-bling-examples-modal" onClick={ev => ev.stopPropagation()}>
              <div className="sm-pdf-preview-head">
                <div className="sm-pdf-preview-title">{headerLabel}</div>
                <div className="sm-pdf-preview-actions">
                  {enlarged && (
                    <button type="button" className="sm-link-btn" onClick={() => setEnlarged(null)}>
                      ← Back to grid
                    </button>
                  )}
                  <button type="button" className="sm-link-btn" onClick={closeModal}>
                    Close ×
                  </button>
                </div>
              </div>
              <div className="sm-bling-examples-body">
                {enlarged ? (
                  <div className="sm-bling-examples-enlarged">
                    <img src={enlarged.photo} alt={enlarged.label}
                      onError={ev => { ev.currentTarget.style.display = 'none' }} />
                    <div className="sm-bling-examples-caption">{enlarged.label}</div>
                  </div>
                ) : (
                  <div className="sm-bling-examples-grid">
                    {list.length === 0 && (
                      <div className="sm-bling-examples-empty">
                        No installed examples for this design yet.
                      </div>
                    )}
                    {list.map(ex => (
                      <button key={ex.code} type="button" className="sm-bling-examples-card"
                        onClick={() => setEnlarged(ex)}>
                        <div className="sm-bling-examples-thumb">
                          <img src={ex.photo} alt={ex.label}
                            onError={ev => { ev.currentTarget.style.display = 'none' }} />
                        </div>
                        <div className="sm-bling-examples-card-label">{ex.label}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// =============================================================================
// VASE CONFIGURATOR (Sprint 3p.3) — size → shape → color, fit-checked, multi-add
// =============================================================================
function VaseConfigurator({ order, update, updateAddOn }) {
  // Config currently being built. Active starts null — user picks a size to begin.
  const [active, setActive] = useState(null)
  // Inline 21-color picker visibility
  const [showColors, setShowColors] = useState(false)
  // Fit-warning modal payload (null = closed)
  const [fitWarning, setFitWarning] = useState(null)
  // Soft inline notice after "Adjust base" — tells user the required width
  const [adjustNotice, setAdjustNotice] = useState(null)

  const picked = order.addOns.filter(a => a.code?.startsWith('vase-'))
  const stoneColorCode = order.graniteColor || null
  const stoneColor = stoneColorCode ? GRANITE_COLORS.find(c => c.code === stoneColorCode) : null

  const dieW = dieWidthFromOrder(order)
  const baseW = baseWidthFromOrder(order)
  const baseD = baseDepthFromOrder(order)

  // The fit count to validate against = current vase count + 1 (the one being added).
  // Clamped to 2 for layout purposes (cemetery convention is 0/1/2 symmetric).
  const numVasesAfter = Math.min(2, picked.length + 1)

  // Die-driven pre-suggested size (used for the "Recommended" badge).
  const recommendedSizeCode = dieRecommendedVaseSize(dieW)

  // Live recommendation: largest vase among active + already-picked determines width math.
  const widestActiveVaseW = (() => {
    const fromPicked = picked
      .map(a => VASE_SIZES.find(s => s.code === a.vaseSize)?.w)
      .filter(Boolean)
    const fromActive = active?.size
      ? [VASE_SIZES.find(s => s.code === active.size)?.w].filter(Boolean)
      : []
    const all = [...fromPicked, ...fromActive]
    return all.length ? Math.max(...all) : null
  })()
  const liveRecommendedBaseW = widestActiveVaseW != null
    ? recommendedBaseWidth(dieW, widestActiveVaseW, numVasesAfter)
    : null
  const exceedsCurrentBase = liveRecommendedBaseW != null && baseW != null && liveRecommendedBaseW > baseW

  const startConfig = (sizeCode) => {
    setActive({ size: sizeCode, shape: null, matchStone: true, color: null })
    setShowColors(false)
    setAdjustNotice(null)
  }
  const pickShape = (shapeCode) => {
    setActive(prev => prev ? { ...prev, shape: shapeCode } : prev)
  }
  const setMatchStone = (val) => {
    setActive(prev => prev ? { ...prev, matchStone: val, color: val ? null : prev.color } : prev)
    if (val) setShowColors(false)
  }
  const pickColor = (code) => {
    setActive(prev => prev ? { ...prev, color: code, matchStone: false } : prev)
    setShowColors(false)
  }

  const activeColorCode = active && (active.matchStone ? stoneColorCode : active.color)
  const activePrice = active ? computeVasePrice(active.size, activeColorCode) : 0
  const activeUpcharge = activeColorCode ? vaseColorUpcharge(activeColorCode) : 0

  const commitVase = (overrideNote = false) => {
    if (!active || !active.shape) return
    let idx = 1
    while (order.addOns.some(a => a.code === `vase-${active.size}-${active.shape}-${idx}`)) idx++
    const colorCodeFinal = active.matchStone ? stoneColorCode : active.color
    const colorRec = colorCodeFinal ? GRANITE_COLORS.find(c => c.code === colorCodeFinal) : null
    const shape = VASE_SHAPES.find(s => s.code === active.shape)
    const sizeRec = VASE_SIZES.find(s => s.code === active.size)
    const colorLabel = active.matchStone
      ? `match stone${colorRec ? ` (${colorRec.label})` : ''}`
      : (colorRec?.label ?? '—')
    const newAddOn = {
      code: `vase-${active.size}-${active.shape}-${idx}`,
      label: `Vase · ${sizeRec?.label ?? active.size} · ${shape?.label ?? active.shape} (${colorLabel})`,
      qty: 1,
      price: activePrice,
      notes: '',
      vaseSize: active.size,
      vaseShape: active.shape,
      vaseMatchStone: active.matchStone,
      vaseColor: colorCodeFinal,
    }
    const patch = { addOns: [...order.addOns, newAddOn] }
    if (overrideNote) {
      const today = new Date().toISOString().slice(0, 10)
      const stamp = `[OVERRIDE: Vase base clearance below 1.5" minimum on ${today}]`
      patch.notes = order.notes ? `${stamp}\n${order.notes}` : stamp
    }
    update(patch)
    setActive(null)
    setShowColors(false)
    setFitWarning(null)
  }

  const handleAdd = () => {
    if (!active || !active.shape) return
    const fit = computeVaseFit(active.size, order, numVasesAfter)
    if (fit.status === 'red' && fit.floorMet === false) {
      const sizeLabel = VASE_SIZES.find(s => s.code === active.size)?.label ?? active.size
      setFitWarning({
        requiredW: fit.requiredW,
        requiredD: fit.requiredD,
        currentW: baseW,
        currentD: baseD,
        vaseSizeLabel: sizeLabel,
        n: fit.n,
        missingBase: fit.missingBase,
      })
      return
    }
    commitVase(false)
  }

  const handleAdjust = () => {
    if (fitWarning) {
      setAdjustNotice({ requiredW: fitWarning.requiredW, requiredD: fitWarning.requiredD })
    }
    setFitWarning(null)
  }
  const handleOverride = () => commitVase(true)
  const closeFitWarning = () => handleAdjust()  // backdrop / × == Adjust

  return (
    <div className="sm-carve-config sm-vase-config">
      <div className="sm-carve-config-eyebrow">
        Vase · pick size → shape → color, fit-checked against the base
      </div>

      {/* Live recommendation eyebrow */}
      <div className="sm-vase-rec-row">
        {dieW && (
          <span className="sm-vase-rec-text">
            Die width: <strong>{dieW}″</strong>
            {baseW != null
              ? <> · Current base width: <strong>{baseW}″</strong></>
              : <> · <em>no base added yet</em></>}
            {liveRecommendedBaseW != null && (
              <> · Recommended for {numVasesAfter}-vase layout: <strong>{liveRecommendedBaseW}″</strong></>
            )}
          </span>
        )}
        {!dieW && (
          <span className="sm-vase-rec-text sm-vase-rec-warn">
            Set the upright width on the Size step first so fit can be checked.
          </span>
        )}
      </div>

      {exceedsCurrentBase && !adjustNotice && (
        <div className="sm-vase-soft-notice">
          ⚠ Recommendation now requires a wider base ({liveRecommendedBaseW}″). Current base is {baseW}″.
        </div>
      )}
      {adjustNotice && (
        <div className="sm-vase-soft-notice sm-vase-soft-notice-strong">
          ⚠ Adjust the base width to at least <strong>{adjustNotice.requiredW}″</strong>
          {adjustNotice.requiredD && baseD != null && baseD < adjustNotice.requiredD && (
            <> and depth to at least <strong>{adjustNotice.requiredD}″</strong></>
          )}
          {' '}in the Size / Base step above, then return to add this vase.
          <button type="button" className="sm-link-btn" onClick={() => setAdjustNotice(null)}
            style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      )}

      {/* Step 1 — size picker */}
      <div className="sm-bling-step-label">1 · Size</div>
      <div className="sm-vase-size-grid">
        {VASE_SIZES.map(s => {
          const fit = computeVaseFit(s.code, order, numVasesAfter)
          const isRecommended = s.code === recommendedSizeCode
          const isActive = active?.size === s.code
          const disabled = fit.status === 'red' && fit.floorMet === false
          return (
            <button key={s.code} type="button"
              className={`sm-vase-size-card sm-fit-${fit.status} ${isActive ? 'on' : ''}`}
              onClick={() => !disabled && startConfig(s.code)}
              disabled={disabled}
            >
              {isRecommended && <div className="sm-vase-rec-badge">Recommended</div>}
              <div className="sm-vase-size-name">{s.label}</div>
              <div className="sm-vase-size-vol">{s.volCi} ci</div>
              <div className="sm-vase-size-price">${s.basePrice.toLocaleString()}</div>
              <div className="sm-vase-size-fit">
                {fit.status === 'green'   && <span className="sm-fit-ok">✓ Fits</span>}
                {fit.status === 'yellow'  && <span className="sm-fit-warn">⚠ Tight fit</span>}
                {fit.status === 'red'     && fit.floorMet === false && (
                  <span className="sm-fit-bad">
                    ✗ Won't fit · increase base to {fit.requiredW}″
                  </span>
                )}
                {fit.status === 'unknown' && (
                  <span className="sm-fit-unknown">
                    {fit.missingBase ? '— add a base first' : '— set die width first'}
                  </span>
                )}
              </div>
              {!isActive && fit.status !== 'red' && <div className="sm-vase-size-add">+ Start</div>}
              {isActive && <div className="sm-vase-size-on">✓ Active</div>}
            </button>
          )
        })}
      </div>

      {/* Step 2 — shape picker (revealed once a size is being configured) */}
      {active && (
        <>
          <div className="sm-bling-step-label">2 · Shape</div>
          <div className="sm-vase-shape-grid">
            {VASE_SHAPES.map(s => {
              const on = active.shape === s.code
              return (
                <button key={s.code} type="button"
                  className={`sm-vase-shape-card ${on ? 'on' : ''}`}
                  onClick={() => pickShape(s.code)}
                >
                  <div className="sm-vase-shape-thumb">
                    <img src={s.photo} alt={s.label} loading="lazy"
                      onError={ev => { ev.currentTarget.style.display = 'none' }} />
                  </div>
                  <div className="sm-vase-shape-label">{s.label}</div>
                  {on && <div className="sm-vase-shape-check">✓</div>}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Step 3 — color picker (revealed once a shape is picked) */}
      {active && active.shape && (
        <>
          <div className="sm-bling-step-label">3 · Color</div>
          <div className="sm-bling-color-row">
            <label className="sm-bling-match-toggle">
              <input type="checkbox" checked={active.matchStone}
                onChange={ev => setMatchStone(ev.target.checked)} />
              <span>Match stone color</span>
              {active.matchStone && stoneColor && (
                <span className="sm-bling-stone-name"> · {stoneColor.label}</span>
              )}
              {active.matchStone && !stoneColor && (
                <span className="sm-bling-stone-empty"> · no stone color picked yet (base price)</span>
              )}
            </label>
            {!active.matchStone && active.color && (
              <div className="sm-bling-color-current">
                <strong>{GRANITE_COLORS.find(c => c.code === active.color)?.label ?? active.color}</strong>
                {activeUpcharge > 0 && (
                  <span className="sm-bling-color-upcharge"> · +{Math.round(activeUpcharge * 100)}%</span>
                )}
              </div>
            )}
            <button type="button" className="sm-link-btn"
              onClick={() => setShowColors(v => !v)}>
              {showColors ? 'Hide colors' : 'Change'}
            </button>
          </div>

          {showColors && (
            <div className="sm-bling-color-grid">
              {GRANITE_COLORS.map(c => (
                <button key={c.code} type="button"
                  className={`sm-bling-color-card ${active.color === c.code ? 'on' : ''}`}
                  onClick={() => pickColor(c.code)}>
                  <div className="sm-bling-color-swatch">
                    <img src={`/granite/${c.file}`} alt={c.label} loading="lazy" />
                  </div>
                  <div className="sm-bling-color-info">
                    <div className="sm-bling-color-name">{c.label}</div>
                    {c.premium > 0 && (
                      <div className="sm-bling-color-prem">+{Math.round(c.premium * 100)}%</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="sm-bling-add-row">
            <div className="sm-bling-add-price">
              <span className="sm-bling-add-eyebrow">This vase:</span>
              <span className="sm-bling-add-amt">${activePrice.toLocaleString()}</span>
              {activeUpcharge > 0 && (
                <span className="sm-bling-add-upcharge"> · +{Math.round(activeUpcharge * 100)}% color</span>
              )}
            </div>
            <button type="button" className="sm-bling-add-btn"
              onClick={handleAdd} disabled={!active.shape}>
              + Add to Order
            </button>
            <button type="button" className="sm-link-btn"
              onClick={() => { setActive(null); setShowColors(false) }}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Per-instance editor rows — same fixed-layout pattern as BLING post-Pass-1 */}
      {picked.length > 0 && (
        <div className="sm-bling-instances">
          <div className="sm-bling-step-label">Added to this order ({picked.length})</div>
          {picked.map(a => {
            const shape = VASE_SHAPES.find(s => s.code === a.vaseShape)
            const sz = VASE_SIZES.find(s => s.code === a.vaseSize)
            const colorRec = a.vaseColor ? GRANITE_COLORS.find(c => c.code === a.vaseColor) : null
            return (
              <div key={a.code} className="sm-carve-design-config sm-bling-instance-row">
                <div className="sm-carve-design-config-label sm-bling-instance-header">
                  {shape && (
                    <span className="sm-bling-instance-thumb-inline">
                      <img src={shape.photo} alt={shape.label}
                        onError={ev => { ev.currentTarget.style.display = 'none' }} />
                    </span>
                  )}
                  <span className="sm-bling-instance-text">
                    <span className="sm-bling-instance-label-main">
                      Vase · {sz?.label ?? a.vaseSize} · {shape?.label ?? a.vaseShape}
                    </span>
                    <span className="sm-bling-instance-sub">
                      {a.vaseMatchStone
                        ? `Match stone${colorRec ? ` (${colorRec.label})` : ''}`
                        : (colorRec?.label ?? '—')}
                    </span>
                  </span>
                  <button type="button" className="sm-link-btn sm-link-btn-danger"
                    onClick={() => update({ addOns: order.addOns.filter(x => x.code !== a.code) })}
                    style={{ marginLeft: 'auto' }}>
                    Remove
                  </button>
                </div>
                <div className="sm-addon-config-grid">
                  <Field label="Qty">
                    <TextInput type="number" value={a.qty}
                      onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })} />
                  </Field>
                  <Field label="Price each">
                    <TextInput type="number" value={a.price}
                      onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })} />
                  </Field>
                  <Field label="Total">
                    <TextInput value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                      onChange={() => {}} disabled />
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Fit-warning modal — reuses sm-pdf-preview-overlay shell */}
      {fitWarning && (
        <div className="sm-pdf-preview-overlay" onClick={closeFitWarning}>
          <div className="sm-vase-fit-warning-modal" onClick={ev => ev.stopPropagation()}>
            <div className="sm-pdf-preview-head">
              <div className="sm-pdf-preview-title">Base too narrow for this vase configuration</div>
              <div className="sm-pdf-preview-actions">
                <button type="button" className="sm-link-btn" onClick={closeFitWarning}>
                  Close ×
                </button>
              </div>
            </div>
            <div className="sm-vase-fit-warning-body">
              <p>
                Current base width: <strong>{fitWarning.currentW != null ? `${fitWarning.currentW}″` : 'not set'}</strong>.
                {' '}Required: at least <strong>{fitWarning.requiredW}″</strong>
                {' '}for {fitWarning.n}× {fitWarning.vaseSizeLabel} vase{fitWarning.n > 1 ? 's' : ''}
                {' '}at the 1.5″ minimum clearance.
              </p>
              {fitWarning.requiredD && fitWarning.currentD != null && fitWarning.currentD < fitWarning.requiredD && (
                <p>
                  Base depth also too shallow: <strong>{fitWarning.currentD}″</strong> current,
                  {' '}<strong>{fitWarning.requiredD}″</strong> required.
                </p>
              )}
              <div className="sm-vase-fit-warning-actions">
                <button type="button" className="sm-bling-add-btn" onClick={handleAdjust}>
                  Adjust base
                </button>
                <button type="button" className="sm-vase-override-btn" onClick={handleOverride}>
                  Override (accept under-clearance)
                </button>
              </div>
              <p className="sm-vase-fit-warning-fine">
                Override prepends a timestamped note to order notes so the back office sees the exception.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// SVG placeholder illustrations — only used when the embedded photo fails to render
function FlatCarveSVG() {
  return (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#a8a39a" />
      <path d="M 60 20 L 60 60 M 50 30 L 70 30 M 50 40 L 70 40"
        stroke="#3a3530" strokeWidth="3" strokeLinecap="square" fill="none" />
      <path d="M 60 22 L 60 58 M 51 31 L 69 31"
        stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" fill="none" />
    </svg>
  )
}

function ShapeCarvedSVG() {
  return (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#a8a39a" />
      <path d="M 58 22 L 64 22 L 64 32 L 74 32 L 74 38 L 64 38 L 64 60 L 58 60 L 58 38 L 48 38 L 48 32 L 58 32 Z"
        fill="#5d564c" />
      <path d="M 58 22 L 64 22 L 64 32 L 74 32 L 74 38 L 64 38 L 64 60 L 58 60 L 58 38 L 48 38 L 48 32 L 58 32 Z"
        fill="#7d756a" transform="translate(-2, -2)" />
    </svg>
  )
}

// Single carve-type card. Tracks image-loaded state so we render either the
// photo (when it loads) or the SVG fallback (if it fails) — no overlap.
function CarveTypeCard({ type, on, onClick }) {
  const [imgState, setImgState] = useState('loading')  // 'loading' | 'loaded' | 'failed'

  // Photo source comes from MARKETING_PHOTOS, keyed by type.code. Falls back
  // to a per-type SVG if the Supabase URL fails to load.
  const imgSrc = MARKETING_PHOTOS[type.code] ?? null
  const fallback =
    type.code === 'flat'     ? <FlatCarveSVG />
  : type.code === 'shape'    ? <ShapeCarvedSVG />
  : type.code === 'sculpted' ? <HandSculptedSVG />
  : type.code === 'laser'    ? <LaserEtchSVG />
  : <GenericPlaceholderSVG />

  return (
    <button
      type="button"
      className={`sm-carve-card ${on ? 'on' : ''}`}
      onClick={onClick}
    >
      <div className="sm-carve-img">
        {imgSrc && imgState !== 'failed' && (
          <img
            src={imgSrc}
            alt={type.label}
            onLoad={() => setImgState('loaded')}
            onError={() => setImgState('failed')}
            style={{ display: imgState === 'loaded' ? 'block' : 'none' }}
          />
        )}
        {(!imgSrc || imgState !== 'loaded') && fallback}
      </div>
      <div className="sm-carve-card-body">
        <div className="sm-carve-label">{type.label}</div>
        <div className="sm-carve-blurb">{type.blurb}</div>
      </div>
      {type.comingSoon && <div className="sm-carve-coming-soon">Coming Soon</div>}
      {on && <div className="sm-carve-check">✓</div>}
    </button>
  )
}

// SVG fallbacks for the new types
function HandSculptedSVG() {
  return (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#a8a39a" />
      {/* Cherub-ish silhouette */}
      <ellipse cx="60" cy="38" rx="14" ry="16" fill="#5d564c" />
      <ellipse cx="60" cy="35" rx="12" ry="14" fill="#7d756a" />
      <path d="M 40 50 Q 30 38 35 28 Q 45 32 50 42 Z" fill="#5d564c" opacity="0.7" />
      <path d="M 80 50 Q 90 38 85 28 Q 75 32 70 42 Z" fill="#5d564c" opacity="0.7" />
    </svg>
  )
}
function LaserEtchSVG() {
  return (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#1a1a1a" />
      <rect x="35" y="20" width="50" height="40" rx="2" fill="#0a0a0a" stroke="#333" strokeWidth="0.5" />
      {/* Etched portrait suggestion — fine lines */}
      <ellipse cx="60" cy="35" rx="6" ry="8" fill="none" stroke="#ddd" strokeWidth="0.4" />
      <path d="M 50 50 Q 60 45 70 50 L 70 60 L 50 60 Z" fill="none" stroke="#ddd" strokeWidth="0.4" />
      <line x1="40" y1="65" x2="80" y2="65" stroke="#bbb" strokeWidth="0.3" />
      <line x1="40" y1="68" x2="80" y2="68" stroke="#bbb" strokeWidth="0.3" />
    </svg>
  )
}
// Generic gray placeholder — covers any type without a dedicated SVG fallback
// (currently vase + bling; renders only if the Supabase URL fails to load).
function GenericPlaceholderSVG() {
  return (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#a8a39a" />
      <rect x="42" y="26" width="36" height="28" rx="3" fill="#7d756a" />
      <circle cx="54" cy="38" r="4" fill="#a8a39a" />
      <path d="M 46 50 L 62 36 L 76 50 Z" fill="#a8a39a" />
    </svg>
  )
}

// ----- Photo sub-section: Type radio + size grid (from photo chart) ------
function PhotoSection({ order, update, updateAddOn }) {
  const [activeType, setActiveType] = useState('porcelain')

  // Existing photo addons on the order
  const photos = order.addOns.filter(a => a.code?.startsWith('photo-'))

  const addPhoto = (sizeCode) => {
    const sizeRec = PHOTO_SIZES.find(s => s.code === sizeCode)
    const price = activeType === 'porcelain' ? sizeRec.porcelain : sizeRec.stainless
    const code = `photo-${activeType}-${sizeCode}`
    const typeLabel = activeType === 'porcelain' ? 'Porcelain' : 'Stainless'
    const existing = order.addOns.find(a => a.code === code)
    if (existing) {
      // Increment qty
      update({ addOns: order.addOns.map(a => a.code === code ? { ...a, qty: a.qty + 1 } : a) })
    } else {
      update({
        addOns: [...order.addOns, {
          code,
          label: `${typeLabel} Photo — ${sizeRec.label} (${sizeRec.dim})`,
          qty: 1,
          price,
          notes: '',
        }],
      })
    }
  }

  const removePhoto = (code) => {
    update({ addOns: order.addOns.filter(a => a.code !== code) })
  }

  return (
    <Section
      title="Photo"
      eyebrow={photos.length === 0 ? 'Porcelain or stainless' : `${photos.length} photo${photos.length === 1 ? '' : 's'} added`}
    >
      {/* Type radio */}
      <div className="sm-photo-type-row">
        {PHOTO_TYPES.map(t => (
          <button
            key={t.code}
            type="button"
            className={`sm-toggle-btn ${activeType === t.code ? 'on' : ''}`}
            onClick={() => setActiveType(t.code)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sm-helper">
        Click a size to add a photo of that type. Click again (or change qty
        below) to add multiples.
      </div>

      {/* Size cards */}
      <div className="sm-photo-size-grid">
        {PHOTO_SIZES.map(s => {
          const price = activeType === 'porcelain' ? s.porcelain : s.stainless
          return (
            <button
              key={s.code}
              type="button"
              className="sm-photo-size-card"
              onClick={() => addPhoto(s.code)}
            >
              <div className="sm-photo-size-oval" />
              <div className="sm-photo-size-name">{s.label}</div>
              <div className="sm-photo-size-dim">{s.dim}</div>
              <div className="sm-photo-size-price">${price}</div>
            </button>
          )
        })}
      </div>

      {/* Existing photos config */}
      {photos.map(a => (
        <div key={a.code} className="sm-carve-design-config" style={{ marginTop: 12 }}>
          <div className="sm-carve-design-config-label">
            {a.label}
            <button type="button" className="sm-link-btn sm-link-btn-danger"
              onClick={() => removePhoto(a.code)} style={{ float: 'right' }}>Remove</button>
          </div>
          <div className="sm-addon-config-grid">
            <Field label="Qty">
              <TextInput type="number" value={a.qty}
                onChange={v => updateAddOn(a.code, { qty: Math.max(1, Number(v) || 1) })} />
            </Field>
            <Field label="Price each">
              <TextInput type="number" value={a.price}
                onChange={v => updateAddOn(a.code, { price: Number(v) || 0 })} />
            </Field>
            <Field label="Total">
              <TextInput value={'$' + ((a.price || 0) * (a.qty || 1)).toLocaleString()}
                onChange={() => {}} disabled />
            </Field>
          </div>
          <Field label="Notes (which person, where on the stone, etc.)" wide>
            <TextInput value={a.notes}
              onChange={v => updateAddOn(a.code, { notes: v })}
              placeholder="e.g. left side of double die · husband's side · color-corrected from family photo" />
          </Field>
          <CustomerPhotoUploader
            photo={a}
            orderId={order.id}
            onUpload={(url, path) => updateAddOn(a.code, { customerPhotoUrl: url, customerPhotoPath: path })}
            onClear={() => updateAddOn(a.code, { customerPhotoUrl: null, customerPhotoPath: null })}
          />
        </div>
      ))}
    </Section>
  )
}

// Tiny uploader for the customer-supplied photo that gets etched onto the stone
function CustomerPhotoUploader({ photo, orderId, onUpload, onClear }) {
  const [uploading, setUploading] = useState(false)
  const ref = useRef(null)

  const handle = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const r = await uploadAttachment(file, orderId)
    setUploading(false)
    if (r) onUpload(r.url, r.path)
    else alert('Upload failed. Check the browser console for details.')
    if (ref.current) ref.current.value = ''
  }

  if (photo.customerPhotoUrl) {
    return (
      <div className="sm-customer-photo-wrap">
        <div className="sm-customer-photo-eyebrow">Customer-supplied photo</div>
        <div className="sm-customer-photo-row">
          <img src={photo.customerPhotoUrl} alt="Customer photo" />
          <div className="sm-customer-photo-actions">
            <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={onClear}>
              Replace
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sm-customer-photo-wrap">
      <div className="sm-customer-photo-eyebrow">Customer-supplied photo</div>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={handle} />
      <button
        type="button"
        className="sm-add-btn"
        onClick={() => ref.current?.click()}
        disabled={uploading}
        style={{ width: '100%' }}
      >
        {uploading ? 'Uploading…' : '📎 Upload customer\'s photo for engraving'}
      </button>
    </div>
  )
}

// =============================================================================
// SPRINT 3a — ESTIMATE PDF GENERATION
// =============================================================================

// Company info — used as letterhead on every PDF
const COMPANY_INFO = {
  name: 'SHEVCHENKO MONUMENTS',
  legalName: 'Shevchenko Monuments LLC',
  address: '329 S Florida Grove Rd',
  city: 'Perth Amboy, NJ 08861',
  phone: '732-442-1286',
  established: 'Family-owned since 1919',
}

// Lazy-load jsPDF from CDN the first time we need it (no npm install required).
// Cached on window so subsequent calls are instant.
let _jsPDFPromise = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    script.async = true
    script.onload = () => {
      if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF)
      else reject(new Error('jsPDF loaded but global not found'))
    }
    script.onerror = () => {
      _jsPDFPromise = null
      reject(new Error('Failed to load jsPDF from CDN — check internet connection'))
    }
    document.head.appendChild(script)
  })
  return _jsPDFPromise
}

// Format currency consistently throughout the PDF
const fmtUSD = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Build the customer-name display for the PDF
function pdfCustomerLine(order) {
  const c = order.customer || {}
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  return name || '(Customer name not yet entered)'
}

// Build the deceased lines for the "In Memory Of" section
function pdfDeceasedLines(order) {
  const out = []
  if (order.deceased?.[0]?.titlePrefix && order.deceased?.[0]?.titleRelations?.length) {
    const prefix = TITLE_PREFIXES.find(p => p.code === order.deceased[0].titlePrefix)?.label || order.deceased[0].titlePrefix
    const relations = order.deceased[0].titleRelations
      .map(r => TITLE_RELATIONS.find(x => x.code === r)?.label || r)
    let relStr = ''
    if (relations.length === 1) relStr = relations[0]
    else if (relations.length === 2) relStr = relations.join(' & ')
    else relStr = relations.slice(0, -1).join(', ') + ', & ' + relations[relations.length - 1]
    out.push({ kind: 'title', text: `${prefix} ${relStr}` })
  }
  for (const d of order.deceased || []) {
    if (d.isReserved) {
      out.push({ kind: 'reserved', text: '— Reserved space —' })
      continue
    }
    const name = [d.firstName, d.middle, d.lastName].filter(Boolean).join(' ')
    const birth = d.birthYear || ''
    const death = d.deathYear || (d.birthYear ? '____' : '')
    const dates = (birth || death) ? `${birth}${birth || death ? ' – ' : ''}${death}` : ''
    out.push({ kind: 'person', name: name || '(name pending)', dates })
  }
  return out
}

// Sprint 3w — raw due-date calculation. Same per-service-type math as the
// Sprint 3u rules; returns a plain ISO date (YYYY-MM-DD, suitable for an
// <input type="date">) plus an isTBD flag for mausoleum / no-timeline orders.
// calculateDueDate wraps this and formats the result for display — single
// source of truth for the math.
function calculateDueDateRaw(order, anchorDate) {
  const anchor = anchorDate
    ? new Date(anchorDate)
    : (order.signedAt ? new Date(order.signedAt) : new Date())

  const serviceTypes = order.serviceTypes || []

  // Mausoleum has no fixed lead time — always defer to the office.
  if (serviceTypes.includes('MAUSOLEUM')) {
    return { isoDate: null, isTBD: true }
  }

  // Per-service lead time. null = no defined timeline for that service.
  const offsets = serviceTypes.map(svc => {
    if (svc === 'NEW_STONE') {
      // Barre Grey and Mountain Rose are Shevchenko's most reliable supply chains.
      // All other stones get the conservative 6-month buffer. Rule is a risk-buffer
      // based on supplier confidence, not granite family or geography. Updated 2026-05-14.
      const fast = order.graniteColor === 'medium-barre-grey' || order.graniteColor === 'mountain-rose'
      return { unit: 'months', value: fast ? 5 : 6 }
    }
    if (svc === 'BRONZE')      return { unit: 'months', value: 4 }
    if (svc === 'INSCRIPTION') return { unit: 'weeks',  value: 8 }
    if (svc === 'ACID_WASH')   return { unit: 'weeks',  value: 8 }
    if (svc === 'REPAIR')      return { unit: 'months', value: 3 }
    // CIVIC_MEMORIAL, ADD_PHOTO, OTHER — no defined timeline
    return null
  }).filter(Boolean)

  if (offsets.length === 0) {
    return { isoDate: null, isTBD: true }
  }

  // Mixed orders take the longest lead time. Compare in days
  // (months x 30.4 vs weeks x 7).
  const longest = offsets.reduce((max, cur) => {
    const maxDays = max.unit === 'months' ? max.value * 30.4 : max.value * 7
    const curDays = cur.unit === 'months' ? cur.value * 30.4 : cur.value * 7
    return curDays > maxDays ? cur : max
  })

  const due = new Date(anchor)
  if (longest.unit === 'months') due.setMonth(due.getMonth() + longest.value)
  else                          due.setDate(due.getDate() + longest.value * 7)

  // Build YYYY-MM-DD from LOCAL components — toISOString() would shift the day
  // in negative-UTC timezones.
  const pad = (n) => String(n).padStart(2, '0')
  const isoDate = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
  return { isoDate, isTBD: false }
}

// Sprint 3u — contract due-date calculation. Wraps calculateDueDateRaw (the
// single source of truth for the math) and formats the result for display.
// Return shape { dateText, months } is preserved for the contract PDF call
// site; `months` is no longer populated (it was never read downstream).
function calculateDueDate(order, anchorDate) {
  const { isoDate, isTBD } = calculateDueDateRaw(order, anchorDate)
  if (isTBD || !isoDate) {
    return { dateText: 'TBD — contact office', months: null }
  }
  // 'T00:00:00' forces local-midnight parsing so the date doesn't shift a day.
  const d = new Date(isoDate + 'T00:00:00')
  const dateText = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return { dateText, months: null }
}

// Sprint 3u Part D — shared page-break helper for the PDF generators. If
// `blockHeight` mm won't fit below the current y on this page, finalize the
// page (via the optional onBreak callback, e.g. addFooter) and start a fresh
// one. Returns the y to continue drawing at — unchanged if the block fits, or
// the top margin if it broke to a new page. Each major PDF block measures its
// full vertical footprint and calls this once, so a block never splits across
// a page boundary mid-render.
function ensureBlock(doc, y, blockHeight, { pageHeight, margin, footerReserve = 12, onBreak } = {}) {
  if (y + blockHeight > pageHeight - margin - footerReserve) {
    if (onBreak) onBreak()
    doc.addPage()
    return margin
  }
  return y
}

// Generate the estimate PDF for the given order. Async because we lazy-load jsPDF.
// Convert a URL (Supabase Storage) into a data URL for jsPDF.addImage
async function urlToDataURL(url) {
  try {
    const res = await fetch(url, { credentials: 'omit' })
    if (!res.ok) throw new Error('fetch failed: ' + res.status)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onloadend = () => resolve(r.result)
      r.onerror = () => reject(new Error('FileReader failed'))
      r.readAsDataURL(blob)
    })
  } catch (e) {
    console.warn('urlToDataURL failed:', e)
    return null
  }
}

// Generate the order PDF — works for both Estimate and Contract.
// mode 'estimate' or 'contract'. Contract embeds signature images and
// changes the badge/filename.
async function generateEstimatePDF(order, opts = {}) {
  const mode = opts.mode || (order.signedAt ? 'contract' : 'estimate')
  const isContract = mode === 'contract'
  let JsPDF
  try {
    JsPDF = await loadJsPDF()
  } catch (err) {
    alert(`Could not load PDF library: ${err.message}\n\nPlease check your internet connection and try again.`)
    return
  }

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })

  // jsPDF's default Helvetica is WinAnsi-encoded, which doesn't include
  // the Unicode prime/double-prime characters or some other glyphs we use
  // in the UI. Wrap doc.text to auto-replace them with ASCII equivalents.
  const cleanForPdf = (s) => {
    if (s == null) return ''
    return String(s)
      .replace(/″/g, '"')      // double prime → straight quote
      .replace(/′/g, "'")      // single prime → apostrophe
      .replace(/[“”]/g, '"')   // smart quotes → straight
      .replace(/[‘’]/g, "'")
      .replace(/…/g, '...')
  }
  const _origText = doc.text.bind(doc)
  doc.text = (text, ...rest) => {
    const cleaned = Array.isArray(text) ? text.map(cleanForPdf) : cleanForPdf(text)
    return _origText(cleaned, ...rest)
  }
  const _origSplit = doc.splitTextToSize.bind(doc)
  doc.splitTextToSize = (text, w) => _origSplit(cleanForPdf(text), w)

  // Letter size in mm: 215.9 × 279.4
  const W = 215.9
  const H = 279.4
  const M = 16     // margin
  const NAVY = [30, 45, 61]
  const GOLD = [140, 109, 63]
  const GREY = [110, 110, 110]
  const TEXT = [42, 42, 42]
  const LIGHT_RULE = [220, 220, 220]

  let y = M

  // Helper: ensure we have room for `need` mm of content; otherwise new page.
  // Sprint 3u Part D — thin binding of the shared ensureBlock helper, so every
  // page-break decision (legacy per-row calls and the new per-block height
  // reservations) runs through one place. footerReserve 12 matches the prior
  // threshold (H - M - 12).
  const ensure = (need) => {
    y = ensureBlock(doc, y, need, { pageHeight: H, margin: M, footerReserve: 12, onBreak: addFooter })
  }

  // Helper: section header (gold all-caps eyebrow + thin grey rule)
  const sectionHeader = (title) => {
    ensure(10)
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...GOLD)
    doc.text(title.toUpperCase(), M, y)
    y += 1.5
    doc.setDrawColor(...LIGHT_RULE)
    doc.setLineWidth(0.2)
    doc.line(M, y, W - M, y)
    y += 4
  }

  // Helper: labeled row
  const labelRow = (label, value, opts = {}) => {
    if (!value && !opts.alwaysShow) return
    ensure(5)
    const labelW = opts.labelW || 38
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(label, M, y)
    doc.setTextColor(...TEXT)
    const text = String(value || '—')
    // Word-wrap the value
    const lines = doc.splitTextToSize(text, W - M - M - labelW)
    doc.text(lines, M + labelW, y)
    y += 4 * lines.length + 1
  }

  // Helper: key-value pair (bold value)
  const kvRow = (label, value) => {
    if (!value) return
    ensure(5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...TEXT)
    const lines = doc.splitTextToSize(String(value), W - M - M - 38)
    doc.text(lines, M + 38, y)
    y += 4 * lines.length + 1
    doc.setFont('helvetica', 'normal')
  }

  // Footer at bottom of every page
  const addFooter = () => {
    const yF = H - 10
    doc.setDrawColor(...LIGHT_RULE)
    doc.setLineWidth(0.2)
    doc.line(M, yF - 3, W - M, yF - 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GREY)
    doc.text(`${COMPANY_INFO.legalName} · ${COMPANY_INFO.phone}`, M, yF)
    const pageStr = `Page ${doc.internal.getCurrentPageInfo().pageNumber}`
    doc.text(pageStr, W - M, yF, { align: 'right' })
    doc.text(isContract ? 'Signed contract — pricing locked' : 'This estimate is valid for 30 days', W / 2, yF, { align: 'center' })
  }

  // ============================ LETTERHEAD ===============================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...NAVY)
  doc.text(COMPANY_INFO.name, M, y + 6)

  // "ESTIMATE" or "CONTRACT" badge top-right
  doc.setFontSize(11)
  doc.setTextColor(...GOLD)
  doc.text(isContract ? 'CONTRACT' : 'ESTIMATE', W - M, y + 6, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...GREY)
  doc.text(`${COMPANY_INFO.address} · ${COMPANY_INFO.city}`, M, y + 4)
  y += 4
  doc.text(`${COMPANY_INFO.phone} · ${COMPANY_INFO.established}`, M, y + 4)
  y += 6

  // Gold rule
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.7)
  doc.line(M, y, W - M, y)
  y += 6

  // Order # and date row
  const dateStr = isContract && order.signedAt
    ? new Date(order.signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text(`${isContract ? 'Contract' : 'Estimate'} #${order.orderNumber || 'DRAFT'}`, M, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GREY)
  doc.text(isContract ? `Signed ${dateStr}` : dateStr, W - M, y, { align: 'right' })
  y += 6

  // ============================ DUE DATE ================================
  // Sprint 3u — contract only. Estimates skip this block entirely.
  if (isContract) {
    // Sprint 3w / S1 — prefer the stored dates (set / auto-populated on step
    // 10). Mausoleum orders with BOTH range dates set render an
    // "earliest – latest" range; other orders render a single date. Falls back
    // to calculateDueDate for legacy orders that pre-date Sprint 3w or that
    // have no stored date.
    const isMausoleum = (order.serviceTypes || []).includes('MAUSOLEUM')
    const hasRange = isMausoleum && order.targetCompletionDate && order.targetCompletionEndDate
    let due
    if (hasRange) {
      // 'T00:00:00' forces local-midnight parsing — without it, 'YYYY-MM-DD' is
      // read as UTC and shifts back a day in negative-UTC timezones.
      const start = new Date(order.targetCompletionDate + 'T00:00:00')
      const end = new Date(order.targetCompletionEndDate + 'T00:00:00')
      const fmt = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      due = { dateText: `${fmt(start)} – ${fmt(end)}`, months: null, isRange: true }
    } else if (order.targetCompletionDate) {
      const d = new Date(order.targetCompletionDate + 'T00:00:00')
      due = {
        dateText: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        months: null,
        isRange: false,
      }
    } else {
      due = calculateDueDate(order)
      due.isRange = false
    }
    // Sprint S1 — for a mausoleum range, the disclaimer says "within the
    // due-date window" instead of "on the due date"; the rest is identical.
    const deliveryDisclaimer = (due.isRange
      ? 'To be delivered within the due-date window or as near that time as existing circumstances of trade and freighting facilities will permit. '
      : 'To be delivered on the due date or as near that time as existing circumstances of trade and freighting facilities will permit. ')
      + 'All agreements made contingent upon strikes, fires, accidents or other causes beyond our control.'
    // Measure the disclaimer at its render font size (9pt) for an accurate line count.
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    const ddLines = doc.splitTextToSize(deliveryDisclaimer, W - M - M)
    // Sprint 3u Part D — reserve the whole due-date + disclaimer block.
    ensure(5 + (order.signedAt ? 0 : 4) + 4 * ddLines.length + 2)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text(`Estimated Due Date: ${due.dateText}`, M, y)
    y += 5

    // Unsigned preview — the date is provisional until signing locks the anchor.
    // Suppressed for mausoleum ranges: those are staff-entered, not calculated.
    if (!order.signedAt && !due.isRange) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...GREY)
      doc.text('Calculated from today. Final due date set at signing.', M, y)
      y += 4
    }

    // Delivery disclaimer — exact legal text, contract only (signed or unsigned).
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(ddLines, M, y)
    y += 4 * ddLines.length + 2
  }

  // ============================ CUSTOMER ================================
  sectionHeader('Prepared for')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...TEXT)
  doc.text(pdfCustomerLine(order), M, y)
  y += 5
  const c = order.customer || {}
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREY)
  const addrLines = []
  if (c.address) addrLines.push(c.address)
  const cityLine = [c.city, c.state, c.zip].filter(Boolean).join(', ')
  if (cityLine) addrLines.push(cityLine)
  if (c.phone) addrLines.push('Phone: ' + c.phone)
  if (c.email) addrLines.push('Email: ' + c.email)
  if (c.altEmail) addrLines.push('Alt email: ' + c.altEmail)
  for (const line of addrLines) {
    doc.text(line, M, y); y += 4
  }
  y += 2

  // ============================ CEMETERY ================================
  if (order.cemetery?.name) {
    sectionHeader('Cemetery')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...TEXT)
    doc.text(order.cemetery.name, M, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    if (order.cemetery.city || order.cemetery.state) {
      doc.text([order.cemetery.city, order.cemetery.state].filter(Boolean).join(', '), M, y)
      y += 4
    }
    const lot = []
    if (order.cemetery.section) lot.push(`Section ${order.cemetery.section}`)
    if (order.cemetery.lot) lot.push(`Lot ${order.cemetery.lot}`)
    if (order.cemetery.grave) lot.push(`Grave ${order.cemetery.grave}`)
    if (lot.length) { doc.text(lot.join(' · '), M, y); y += 4 }
    y += 2
  }

  // ============================ IN MEMORY OF ============================
  if (order.deceased?.length) {
    sectionHeader('In memory of')
    const lines = pdfDeceasedLines(order)
    for (const ln of lines) {
      ensure(6)
      if (ln.kind === 'title') {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(11)
        doc.setTextColor(...GOLD)
        doc.text(ln.text, M, y)
        y += 5
      } else if (ln.kind === 'reserved') {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(9.5)
        doc.setTextColor(...GREY)
        doc.text(ln.text, M + 4, y)
        y += 4.5
      } else {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(...TEXT)
        doc.text(ln.name, M + 4, y)
        if (ln.dates) {
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(...GREY)
          doc.text(ln.dates, W - M, y, { align: 'right' })
        }
        y += 5
      }
    }
    y += 2
  }

  // ============================ SERVICE ==================================
  if (order.serviceTypes?.length) {
    const labels = order.serviceTypes.map(c => SERVICE_TYPES.find(s => s.code === c)?.label).filter(Boolean)
    if (labels.length) {
      sectionHeader('Service')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...TEXT)
      doc.text(labels.join(' · '), M, y)
      y += 5
      if (order.otherServiceDescription) {
        doc.setFontSize(9)
        doc.setTextColor(...GREY)
        const wrapped = doc.splitTextToSize(order.otherServiceDescription, W - M - M)
        doc.text(wrapped, M, y); y += 4 * wrapped.length
      }
      y += 2
    }
  }

  // ============================ STONE SPECS =============================
  const shape = SHAPES.find(s => s.code === order.shape)
  if (shape) {
    // Sprint 3u Part D — reserve the whole stone-specs block (section header +
    // one row per populated spec field + trailing gap) so it never splits.
    const color = GRANITE_COLORS.find(g => g.code === order.graniteColor)
    const top = TOP_SHAPES.find(t => t.code === order.topShape)
    const polish = POLISH_LEVELS.find(p => p.code === order.polishLevel)
    const sides = SIDES_OPTIONS.find(s => s.code === order.sides)
    let specRows = 1  // Shape always renders
    if (color) specRows++
    if (top) specRows++
    if (polish) specRows++
    if (sides) specRows++
    if (order.baseConfig?.include) specRows++
    ensure(12 + specRows * 5 + 2)

    sectionHeader('Stone specifications')
    const stdSize = order.standardSizeCode ? shape.standardSizes.find(s => s.code === order.standardSizeCode) : null
    // The standardSize label IS the dimensions (e.g. "2-0 × 1-0 × 1-6"),
    // so use it directly. Custom dims fall back to the entered numbers.
    const sizeText = stdSize
      ? stdSize.label
      : [order.width, order.depth, order.thickness].filter(x => x != null).join(' × ') + '"'
    kvRow('Shape', sizeText ? `${shape.label} — ${sizeText}` : shape.label)

    if (color) kvRow('Granite color', `${color.label} (${color.origin})`)
    if (top) kvRow('Top shape', top.label)
    if (polish) kvRow('Polish level', polish.label)
    if (sides) kvRow('Sides', sides.label)

    if (order.baseConfig?.include) {
      const baseSize = BASE_SIZES.find(b => b.code === order.baseConfig.sizeCode)
      const baseHeight = BASE_HEIGHTS.find(h => h.code === order.baseConfig.heightCode)
      const baseSides = BASE_SIDES_OPTIONS.find(s => s.code === order.baseConfig.sides)
      // Only join size and height if both exist; same for the rest
      const sizeAndHeight = [baseSize?.label, baseHeight?.label].filter(Boolean).join(' × ')
      const baseDesc = [
        sizeAndHeight,
        baseSides?.label,
        order.baseConfig.polishMargin2in ? '2" polish margin' : '',
      ].filter(Boolean).join(' · ')
      if (baseDesc) kvRow('Base', baseDesc)
    }
    y += 2
  }

  // ============================ DESIGN ===================================
  // Sprint 3r.2 — contracts no longer render the design reference (per
  // user direction). Estimates still show the PRIMARY design only;
  // alternates are inspiration for the carver and don't appear in either PDF.
  const primaryDesign = order.designs?.[0]?.snapshot || null
  const primaryRef = primaryDesign?.lastname || primaryDesign?.id
  const showDesignBlock = !isContract && (primaryRef || order.elementFilters?.length || order.designPreferences)
  if (showDesignBlock) {
    sectionHeader('Design')
    if (order.elementFilters?.length) {
      const symLabels = order.elementFilters.map(c => SYMBOLS.find(s => s.code === c)?.label || c)
      kvRow('Symbols', symLabels.join(', '))
    }
    if (primaryRef) {
      kvRow('Design Reference (Primary)', `Catalog #${primaryRef}`)
    }
    if (order.designPreferences) {
      ensure(8)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...GREY)
      doc.text('Customer preferences:', M, y); y += 4
      const wrapped = doc.splitTextToSize(order.designPreferences, W - M - M)
      doc.setTextColor(...TEXT)
      doc.text(wrapped, M, y); y += 4 * wrapped.length
    }
    y += 2
  }

  // ============================ INSCRIPTION ==============================
  if (order.inscription?.epitaph || order.inscription?.customNotes || order.inscription?.type) {
    sectionHeader('Inscription')
    const inscType = INSCRIPTION_TYPES.find(t => t.code === order.inscription.type)
    if (inscType) kvRow('Type', inscType.label)
    if (order.inscription.customFont) {
      kvRow('Font', order.inscription.customFont + (order.inscription.customFontDescription ? ` — ${order.inscription.customFontDescription}` : ''))
    }
    if (order.inscription.epitaph) {
      ensure(10)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(11)
      doc.setTextColor(...NAVY)
      const wrapped = doc.splitTextToSize(`"${order.inscription.epitaph}"`, W - M - M - 4)
      doc.text(wrapped, M + 4, y); y += 5 * wrapped.length
    }
    if (order.inscription.customNotes) {
      ensure(6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...GREY)
      const wrapped = doc.splitTextToSize('Notes: ' + order.inscription.customNotes, W - M - M)
      doc.text(wrapped, M, y); y += 4 * wrapped.length
    }
    y += 2
  }

  // ============================ PRICING ==================================
  // Force a new page if we're more than halfway down — keep pricing together
  if (y > H * 0.6) {
    addFooter()
    doc.addPage()
    y = M
  }

  sectionHeader('Pricing')

  const lineItems = buildLineItems(order)
  // Apply overrides
  const itemsResolved = lineItems.map(it => {
    const ov = order.pricing?.overrides?.[it.code]
    return { ...it, amount: ov != null ? Number(ov) : it.amount }
  })
  // Custom items
  const customItems = order.pricing?.customLineItems || []

  // Sprint 3u — 4-column line items: Description | Color | Qty | Rate.
  // buildLineItems flattens to {code,label,amount} only, so Color and Qty are
  // cross-referenced back out of order.addOns here. base-stone/color-premium
  // take the order's granite color; addon rows take their own bling/vase color.
  const descX = M                 // 16   — Description left edge, wraps at 72mm
  const colorX = M + 74           // 90   — Color left edge, wraps at 36mm
  const qtyRightX = W - M - 28     // 171.9 — Qty, right-aligned
  const rateRightX = W - M        // 199.9 — Rate, right-aligned

  const addonByCode = {}
  for (const a of (order.addOns || [])) addonByCode[a.code] = a

  const lineItemColor = (code) => {
    if (code === 'base-stone' || code === 'color-premium') {
      return GRANITE_COLORS.find(c => c.code === order.graniteColor)?.label || ''
    }
    if (code?.startsWith('addon-')) {
      const a = addonByCode[code.slice(6)]
      const colorCode = a?.blingColor || a?.vaseColor
      return colorCode ? (GRANITE_COLORS.find(c => c.code === colorCode)?.label || '') : ''
    }
    return ''
  }
  const lineItemQty = (code) => {
    if (code?.startsWith('addon-')) return addonByCode[code.slice(6)]?.qty || 1
    return 1
  }

  // Header row
  // Sprint 3u Part D — reserve the whole line-items table (column header +
  // one row per item + footer slack) so the table header never orphans.
  const lineRowCount = itemsResolved.filter(it => it.amount != null).length
    + customItems.filter(it => it.label || it.amount).length
  ensure(lineRowCount * 5 + 12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GREY)
  doc.text('DESCRIPTION', descX, y)
  doc.text('COLOR', colorX, y)
  doc.text('QTY', qtyRightX, y, { align: 'right' })
  doc.text('RATE', rateRightX, y, { align: 'right' })
  y += 1.5
  doc.setDrawColor(...LIGHT_RULE)
  doc.setLineWidth(0.2)
  doc.line(M, y, W - M, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...TEXT)

  // Draw one 4-column row. Mutates y via closure.
  const renderLineRow = (label, amount, code) => {
    ensure(5)
    const qty = lineItemQty(code)
    const colorLabel = lineItemColor(code)
    // Strip the " x N" suffix buildLineItems bakes into addon labels — the Qty
    // column now carries that information.
    const desc = code?.startsWith('addon-') ? label.replace(/ × \d+$/, '') : label
    const descLines = doc.splitTextToSize(desc, 72)
    const colorLines = colorLabel ? doc.splitTextToSize(colorLabel, 36) : []
    doc.text(descLines, descX, y)
    if (colorLines.length) doc.text(colorLines, colorX, y)
    doc.text(String(qty), qtyRightX, y, { align: 'right' })
    if (isContract) {
      const rateText = qty > 1 ? `${fmtUSD(amount / qty)} each` : fmtUSD(amount)
      doc.text(rateText, rateRightX, y, { align: 'right' })
    } else {
      // Estimates hide per-item rate values so customers can shop around without
      // exposing per-item pricing to competitors. Final total stays visible.
      doc.text('—', rateRightX, y, { align: 'right' })
    }
    y += 4 * Math.max(descLines.length, colorLines.length, 1) + 0.5
  }

  let subtotalDisc = 0       // discount-eligible (everything except cemetery permit)
  let subtotalPermitPdf = 0  // cemetery permit only (passed through, no discount)
  for (const it of itemsResolved) {
    if (it.amount == null) continue
    renderLineRow(it.label, it.amount, it.code)
    if (it.code === 'addon-permit') subtotalPermitPdf += Number(it.amount) || 0
    else                            subtotalDisc      += Number(it.amount) || 0
  }
  for (const it of customItems) {
    if (!it.label && !it.amount) continue
    renderLineRow(it.label || '(custom item)', it.amount, it.code)
    subtotalDisc += Number(it.amount) || 0
  }
  const subtotalPdf = subtotalDisc + subtotalPermitPdf

  // Sprint 3u Part D — reserve the whole totals block (one row per populated
  // line + spacers/dividers) so it never splits across a page boundary.
  const discountPctPdf = Number(order.pricing?.discountPct) || 0
  let totalsRows = 2  // Subtotal + GRAND TOTAL always render
  if (discountPctPdf > 0) totalsRows += 2  // Discount + Subtotal-after-discount
  if (order.pricing?.applyTax) totalsRows += 1
  if (order.pricing?.applyCCSurcharge) totalsRows += 1
  ensure(totalsRows * 5 + 15)

  // Totals block
  y += 3
  doc.setDrawColor(...LIGHT_RULE)
  doc.line(W - M - 80, y, W - M, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text('Subtotal', W - M - 60, y)
  doc.text(fmtUSD(subtotalPdf), W - M, y, { align: 'right' })
  y += 5

  // Discount (applied to discountable portion only)
  const discountAmountPdf = subtotalDisc * (discountPctPdf / 100)
  let postDiscountTaxBase = subtotalPdf
  if (discountPctPdf > 0) {
    doc.setTextColor(...GOLD)
    doc.setFont('helvetica', 'bold')
    const lab = subtotalPermitPdf > 0
      ? `Discount (${discountPctPdf}% — permit excluded)`
      : `Discount (${discountPctPdf}%)`
    doc.text(lab, W - M - 60, y)
    doc.text('-' + fmtUSD(discountAmountPdf), W - M, y, { align: 'right' })
    y += 5
    doc.setFont('helvetica', 'normal')
    postDiscountTaxBase = subtotalPdf - discountAmountPdf

    doc.setTextColor(...TEXT)
    doc.text('Subtotal after discount', W - M - 60, y)
    doc.text(fmtUSD(postDiscountTaxBase), W - M, y, { align: 'right' })
    y += 5
  }

  let runningTotal = postDiscountTaxBase
  if (order.pricing?.applyTax) {
    const tax = postDiscountTaxBase * NJ_TAX_RATE
    runningTotal += tax
    doc.setTextColor(...GREY)
    doc.text('NJ Sales Tax (6.625%)', W - M - 60, y)
    doc.setTextColor(...TEXT)
    doc.text(fmtUSD(tax), W - M, y, { align: 'right' })
    y += 5
  }
  if (order.pricing?.applyCCSurcharge) {
    const cc = runningTotal * CC_SURCHARGE
    runningTotal += cc
    doc.setTextColor(...GREY)
    doc.text('CC Surcharge (3%)', W - M - 60, y)
    doc.setTextColor(...TEXT)
    doc.text(fmtUSD(cc), W - M, y, { align: 'right' })
    y += 5
  }

  // Grand total — emphasized
  y += 1
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.5)
  doc.line(W - M - 80, y, W - M, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...NAVY)
  doc.text('GRAND TOTAL', W - M - 60, y)
  doc.text(fmtUSD(runningTotal), W - M, y, { align: 'right' })
  y += 8

  // ============================ DEPOSIT BLOCK ============================
  // 50% deposit policy. On contract: "Due today". On estimate: "Required at signing".
  const deposit = runningTotal * 0.5
  const balance = runningTotal - deposit

  ensure(20)
  y += 2
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.4)
  // Sprint 3s.3 — deposit block label column widened from 60mm to 90mm so
  // 'Balance (at delivery / installation)' no longer overflows into the
  // right-aligned value. Gold divider widened to match the new label width.
  doc.line(W - M - 90, y, W - M, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...GOLD)
  doc.text(isContract ? 'DUE TODAY (50% DEPOSIT)' : 'DEPOSIT AT SIGNING (50%)', W - M - 90, y)
  doc.setTextColor(...NAVY)
  doc.text(fmtUSD(deposit), W - M, y, { align: 'right' })
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GREY)
  doc.text('Balance (at delivery / installation)', W - M - 90, y)
  doc.setTextColor(...TEXT)
  doc.text(fmtUSD(balance), W - M, y, { align: 'right' })
  y += 7

  // ============================ NOTES ====================================
  // Customer-facing notes from the pricing step (NOT the internal staff notes)
  // We show pricing.notes here only if it's marked customer-facing — for now
  // we keep it internal and don't emit it.

  // ============================ SIGN-OFF =================================
  // Sprint 3u Part C — contracts carry the full legal terms (5 paragraphs);
  // estimates keep the short "valid 30 days" notice. The whole sign-off block
  // (divider + terms + signature pair) is reserved together so the legal text
  // never splits mid-sentence and the signatures never orphan onto a page of
  // their own. (Part D converts this reservation to the shared ensureBlock.)
  const LEGAL_FS = 8        // pt — legal terms font size
  const LEGAL_LH = 3.5      // mm per line at 8pt
  const PARA_GAP = 3.5      // mm between paragraphs
  const SIGN_PAIR_H = 38    // mm — signature pair footprint

  const legalParagraphs = [
    'Client agrees to pay Shevchenko Monuments LLC a deposit equal to fifty percent (50%) of the total contract price. This deposit is non-refundable. The remaining balance is due in full prior to the commencement of any carving work. Carving work is defined as any operation that physically alters the granite, including sandblasting, hand-carving, laser etching, or shape carving. Materials for the memorial may be ordered prior to balance payment; in such cases, Shevchenko Monuments bears the material cost at the Client\'s risk should the contract be subsequently breached.',
    'Ownership of the described memorial shall remain with Shevchenko Monuments until payment is received in full. If payment is not made in accordance with this agreement — whether at delivery or thereafter — Shevchenko Monuments is authorized to enter the cemetery and remove the memorial without prior notice and without liability for emotional distress, consequential damages, or other claims. Client agrees that legal fees incurred by Shevchenko Monuments in any contested removal shall be the responsibility of the Client. If the memorial is removed for non-payment and Client subsequently requests reinstallation, a reset fee of five hundred dollars ($500) shall apply in addition to any unpaid balance.',
    'Any changes to the design, materials, or scope of work after this contract is signed require written agreement between Client and Shevchenko Monuments. Such changes may incur additional costs and may reset the production timeline.',
    'Client has fourteen (14) days from the date of delivery or installation to raise quality concerns in writing. After this fourteen-day window, the work shall be deemed accepted in full.',
    'This agreement is final and not subject to cancellation. Client grants permission for Shevchenko Monuments to use photographs of the completed memorial for display, portfolio, or advertising purposes.',
  ]

  // Measure the sign-off body so the whole block can be reserved at once.
  let legalSplit = null
  let estimateWrapped = null
  let signOffBodyH = 0
  if (isContract) {
    doc.setFontSize(LEGAL_FS)
    legalSplit = legalParagraphs.map(p => doc.splitTextToSize(p, W - M - M))
    signOffBodyH = legalSplit.reduce((sum, lines) => sum + lines.length * LEGAL_LH, 0)
      + PARA_GAP * (legalSplit.length - 1)
  } else {
    doc.setFontSize(9)
    const acceptText = 'This estimate is valid for 30 days from the date above. ' +
      'To accept and proceed with production, please sign below. A signed copy will become your contract.'
    estimateWrapped = doc.splitTextToSize(acceptText, W - M - M)
    signOffBodyH = 4 * estimateWrapped.length
  }

  // Reserve divider (6 + 5) + body + trailing gap (6) + signature pair together.
  ensure(6 + 5 + signOffBodyH + 6 + SIGN_PAIR_H)

  y += 6
  doc.setDrawColor(...LIGHT_RULE)
  doc.setLineWidth(0.2)
  doc.line(M, y, W - M, y)
  y += 5

  if (isContract) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(LEGAL_FS)
    doc.setTextColor(...TEXT)
    legalParagraphs.forEach((para, i) => {
      doc.text(para, M, y, { align: 'justify', maxWidth: W - M - M })
      y += legalSplit[i].length * LEGAL_LH + PARA_GAP
    })
    y += 6 - PARA_GAP
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(estimateWrapped, M, y)
    y += 4 * estimateWrapped.length + 6
  }

  // Two signature blocks side by side. In contract mode, embed the actual
  // signature PNGs above each line; in estimate mode, leave them blank.
  ensure(36)
  const colW = (W - M - M - 8) / 2
  const sigImgH = 18
  const lineY = y + sigImgH + 2

  // Pre-fetch signature images (only in contract mode)
  let custSigData = null
  let repSigData = null
  if (isContract) {
    if (order.customerSignatureUrl) custSigData = await urlToDataURL(order.customerSignatureUrl)
    if (order.repSignatureUrl)      repSigData  = await urlToDataURL(order.repSignatureUrl)
  }

  // Customer side
  if (custSigData) {
    try {
      doc.addImage(custSigData, 'PNG', M + 2, y, colW - 4, sigImgH)
    } catch (e) { console.warn('Customer signature embed failed:', e) }
  }
  doc.setDrawColor(...TEXT)
  doc.setLineWidth(0.4)
  doc.line(M, lineY, M + colW, lineY)
  doc.setFontSize(8)
  doc.setTextColor(...GREY)
  const custLabel = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim()
  doc.text(custLabel ? `Customer: ${custLabel}` : 'Customer signature', M, lineY + 4)
  if (isContract && order.signedAt) {
    doc.text(`Signed ${new Date(order.signedAt).toLocaleDateString('en-US')}`, W / 2 - 4 - 35, lineY + 4)
  } else {
    doc.text('Date: ____________________', W / 2 - 4 - 35, lineY + 4)
  }

  // Sales rep side
  if (repSigData) {
    try {
      doc.addImage(repSigData, 'PNG', M + colW + 10, y, colW - 4, sigImgH)
    } catch (e) { console.warn('Rep signature embed failed:', e) }
  }
  doc.line(M + colW + 8, lineY, W - M, lineY)
  doc.setFontSize(8)
  doc.setTextColor(...GREY)
  const repLabel = order.salesRep || ''
  doc.text(repLabel ? `Shevchenko Monuments — ${repLabel}` : 'Shevchenko Monuments representative', M + colW + 8, lineY + 4)
  if (isContract && order.signedAt) {
    doc.text(`Signed ${new Date(order.signedAt).toLocaleDateString('en-US')}`, W - M - 35, lineY + 4)
  } else {
    doc.text('Date: ____________________', W - M - 35, lineY + 4)
  }
  y = lineY + 8

  addFooter()

  // Build filename
  const last = (order.customer?.lastName || (isContract ? 'Contract' : 'Estimate')).replace(/[^a-z0-9]/gi, '_')
  const num = order.orderNumber || 'draft'
  const filename = `Shevchenko-${isContract ? 'Contract' : 'Estimate'}-${num}-${last}.pdf`

  // Sprint 3i — preview and email flows want the doc object without saving.
  // Default behavior remains "save to user's Downloads".
  if (opts.returnDoc) {
    return { doc, filename }
  }
  doc.save(filename)
  return { doc, filename }
}

// Thin wrapper for contract PDFs
async function generateContractPDF(order, opts = {}) {
  return generateEstimatePDF(order, { ...opts, mode: 'contract' })
}

// Sprint 3j — Receipt PDF. Sprint M2 Phase 2: takes a payment object from
// order.payments[] (was paymentType 'deposit'|'balance'). Renders that single
// payment's receipt; running totals sum the whole non-voided payments[] array.
async function generateReceiptPDF(order, payment, opts = {}) {
  let JsPDF
  try {
    JsPDF = await loadJsPDF()
  } catch (err) {
    alert(`Could not load PDF library: ${err.message}`)
    return
  }
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })

  const cleanForPdf = (s) => s == null ? '' : String(s)
    .replace(/″/g, '"').replace(/′/g, "'")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...')
  const _origText = doc.text.bind(doc)
  doc.text = (text, ...rest) => {
    const cleaned = Array.isArray(text) ? text.map(cleanForPdf) : cleanForPdf(text)
    return _origText(cleaned, ...rest)
  }

  const W = 215.9, H = 279.4, M = 16
  const NAVY = [30, 45, 61], GOLD = [140, 109, 63], GREY = [110, 110, 110]
  const TEXT = [42, 42, 42], LIGHT_RULE = [220, 220, 220]
  const fmtUSD = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Slice to the date part + force local-midnight parsing so YYYY-MM-DD values
  // (the new payment.receivedAt format) don't shift a day in negative-UTC zones.
  const fmtDate = (iso) => iso
    ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—'

  let y = M
  // Sprint 3u Part D — thin binding of the shared ensureBlock helper. The
  // receipt draws its footer once at the end (not per page), so no onBreak.
  const ensure = (need) => {
    y = ensureBlock(doc, y, need, { pageHeight: H, margin: M, footerReserve: 0 })
  }

  // Compute totals — same logic as PaymentTrackingSection / PdfDownloadButton
  const lineItems = buildLineItems(order)
  let subtotalDisc = 0, subtotalPermit = 0
  for (const it of lineItems) {
    if (it.amount == null) continue
    const ov = order.pricing?.overrides?.[it.code]
    const amt = ov != null ? Number(ov) : (it.amount || 0)
    if (it.code === 'addon-permit') subtotalPermit += amt
    else                            subtotalDisc   += amt
  }
  for (const c of (order.pricing?.customLineItems || [])) {
    subtotalDisc += Number(c.amount) || 0
  }
  const discountPct = Number(order.pricing?.discountPct) || 0
  const discountAmount = subtotalDisc * (discountPct / 100)
  const taxBase = (subtotalDisc - discountAmount) + subtotalPermit
  const tax = order.pricing?.applyTax ? taxBase * NJ_TAX_RATE : 0
  const cc  = order.pricing?.applyCCSurcharge ? (taxBase + tax) * CC_SURCHARGE : 0
  const grandTotal = taxBase + tax + cc

  // Sprint M2 Phase 2 — this-payment fields come from the passed payment
  // object; running totals sum the whole non-voided payments[] array (the
  // legacy deposit/balance slots are no longer authoritative).
  const paymentAmount = Number(payment?.amount) || 0
  const paymentMethod = payment?.method
  const paymentRef    = payment?.ref
  const paymentDate   = payment?.receivedAt
  const nonVoidedPayments = Array.isArray(order.payments)
    ? order.payments.filter(p => !p.voided)
    : []
  const totalPaidToDate = nonVoidedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const balanceRemaining = Math.max(0, grandTotal - totalPaidToDate)
  const isFullyPaid = balanceRemaining < 0.01

  // ============================ LETTERHEAD ===============================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...NAVY)
  doc.text(COMPANY_INFO.name, M, y + 6)

  doc.setFontSize(11)
  doc.setTextColor(...GOLD)
  doc.text('RECEIPT', W - M, y + 6, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...GREY)
  doc.text(`${COMPANY_INFO.address} · ${COMPANY_INFO.city}`, M, y + 4)
  y += 4
  doc.text(`${COMPANY_INFO.phone} · ${COMPANY_INFO.established}`, M, y + 4)
  y += 6

  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.7)
  doc.line(M, y, W - M, y)
  y += 6

  // ============================ HEADER ===================================
  // Sprint M2 Phase 2 — per-payment receipt number from a short id fragment so
  // two receipts for the same order don't collide. Phase 3 formalizes labeling.
  const receiptNo = `R-${order.orderNumber || 'DRAFT'}-${String(payment?.id || 'P').slice(-6)}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text(`Receipt #${receiptNo}`, M, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GREY)
  doc.text(`Issued ${fmtDate(paymentDate || new Date().toISOString())}`, W - M, y, { align: 'right' })
  y += 5

  doc.setFontSize(9)
  doc.text(`For Contract #${order.orderNumber || 'DRAFT'}${order.signedAt ? ` (signed ${fmtDate(order.signedAt)})` : ''}`, M, y)
  y += 8

  // ============================ CUSTOMER ================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text('Received from', M, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  const c = order.customer || {}
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim()
  doc.text(name || '—', M, y)
  y += 4
  if (c.addressLine1) { doc.setFontSize(9); doc.text(c.addressLine1, M, y); y += 4 }
  if (c.city || c.state || c.zip) {
    doc.setFontSize(9)
    doc.text([c.city, c.state, c.zip].filter(Boolean).join(', '), M, y); y += 4
  }
  if (c.phonePrimary) { doc.setFontSize(9); doc.setTextColor(...GREY); doc.text(c.phonePrimary, M, y); y += 4 }
  y += 4

  // ============================ PAYMENT BLOCK ===========================
  doc.setDrawColor(...LIGHT_RULE)
  doc.setLineWidth(0.3)
  doc.line(M, y, W - M, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...GOLD)
  // Sprint M2 Phase 2 — generic label; Phase 3 adds first/middle/final logic.
  doc.text('PAYMENT RECEIPT', M, y)
  y += 7

  // Payment details table
  const methodLabels = { check: 'Check', cash: 'Cash', card: 'Credit / Debit Card', other: 'Other' }
  const rows = [
    ['Amount paid', fmtUSD(paymentAmount)],
    ['Method', methodLabels[paymentMethod] || paymentMethod || '—'],
    ['Reference', paymentRef || '—'],
    ['Date received', fmtDate(paymentDate)],
  ]
  // Sprint 3u Part D — reserve the whole payment-details table at once.
  ensure(rows.length * 5 + 8)
  for (const [k, v] of rows) {
    ensure(6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...GREY)
    doc.text(k, M, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...TEXT)
    doc.text(String(v), M + 50, y)
    y += 5
  }
  y += 4

  // ============================ RUNNING TOTALS ==========================
  doc.setDrawColor(...LIGHT_RULE); doc.line(M, y, W - M, y); y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text('Running totals', M, y); y += 5

  const totRows = [
    ['Total contract amount', fmtUSD(grandTotal), false],
    ['Paid to date (incl. this payment)', fmtUSD(totalPaidToDate), false],
    [isFullyPaid ? 'Balance — PAID IN FULL' : 'Balance remaining',
     isFullyPaid ? fmtUSD(0) : fmtUSD(balanceRemaining), true],
  ]
  // Sprint 3u Part D — reserve the whole running-totals block at once.
  ensure(totRows.length * 6 + 8)
  for (const [k, v, big] of totRows) {
    ensure(6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(big ? 12 : 10)
    doc.setTextColor(...(big ? NAVY : GREY))
    doc.text(k, M, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(big ? (isFullyPaid ? [45, 138, 79] : NAVY) : TEXT))
    doc.text(String(v), W - M, y, { align: 'right' })
    y += big ? 7 : 5
  }
  y += 6

  // ============================ SIGNATURE / NOTES =======================
  ensure(20)
  doc.setDrawColor(...LIGHT_RULE); doc.line(M, y, W - M, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREY)
  const note = isFullyPaid
    ? 'Thank you for your business. This receipt confirms your contract is paid in full.'
    : `Thank you for your payment. Balance of ${fmtUSD(balanceRemaining)} is due ${order.targetCompletionDate ? `by ${fmtDate(order.targetCompletionDate)}` : 'at delivery / installation'}.`
  const wrapped = doc.splitTextToSize(note, W - M - M)
  doc.text(wrapped, M, y); y += 4 * wrapped.length + 8

  // Customer acknowledgment line
  ensure(20)
  const colW = (W - M - M - 8) / 2
  doc.setDrawColor(...TEXT); doc.setLineWidth(0.4)
  doc.line(M, y + 12, M + colW, y + 12)
  doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text('Customer acknowledgment', M, y + 16)
  doc.line(M + colW + 8, y + 12, W - M, y + 12)
  doc.text(`Received by — ${order.salesRep || 'Shevchenko Monuments'}`, M + colW + 8, y + 16)
  y += 22

  // Footer
  const yF = H - 10
  doc.setDrawColor(...LIGHT_RULE); doc.setLineWidth(0.2)
  doc.line(M, yF - 3, W - M, yF - 3)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY)
  doc.text(`${COMPANY_INFO.legalName} · ${COMPANY_INFO.phone}`, M, yF)
  doc.text(`Page 1`, W - M, yF, { align: 'right' })
  doc.text(`Receipt #${receiptNo}`, W / 2, yF, { align: 'center' })

  const last = (order.customer?.lastName || 'Receipt').replace(/[^a-z0-9]/gi, '_')
  const filename = `Shevchenko-Receipt-${receiptNo}-${last}.pdf`

  if (opts.returnDoc) return { doc, filename }
  doc.save(filename)
  return { doc, filename }
}

// =============================================================================
// PRICING STEP
// =============================================================================

// Sprint 3i — Production timeline / rush controls. Standard times come from
// SERVICE_TIMELINES; rush adds the appropriate fee per service.
function ProductionTimelineSection({ order, update, isLocked }) {
  const services = order.serviceTypes || []
  const timelines = services.map(c => ({ code: c, ...SERVICE_TIMELINES[c] })).filter(t => t.label)

  const rushableServices = timelines.filter(t => t.rushFee != null)
  const totalRushFee = rushableServices.reduce((s, t) => s + (t.rushFee || 0), 0)

  const setDate = (key, value) => update({ [key]: value || null })
  const setRush = (on) => { if (!isLocked) update({ rushOrder: on }) }

  // Sprint 3w — for the recalc button: hidden for TBD service mixes (mausoleum
  // / no defined timeline) since clicking would only clear the field.
  const dueRaw = calculateDueDateRaw(order)

  // Sprint 3w — auto-populate the target completion date on first visit to
  // step 10: only when it isn't set yet, the order isn't locked, and the
  // service mix has a defined timeline (not TBD). The null check makes this
  // fire at most once per order — once the date is written, the effect re-runs
  // but returns early. Mausoleum orders self-exclude here (calculateDueDateRaw
  // returns isTBD for them) — they're handled by the S1 range effect below.
  useEffect(() => {
    if (isLocked) return
    if (order.targetCompletionDate) return
    const { isoDate, isTBD } = calculateDueDateRaw(order)
    if (isTBD || !isoDate) return
    update({ targetCompletionDate: isoDate })
  }, [order.targetCompletionDate, isLocked])  // eslint-disable-line react-hooks/exhaustive-deps

  // Sprint S1 — mausoleum orders use a 6–8 month completion *range* instead of
  // a single date. targetCompletionDate is the earliest, targetCompletionEndDate
  // the latest.
  const isMausoleum = (order.serviceTypes || []).includes('MAUSOLEUM')

  // YYYY-MM-DD that's `months` after `anchor`, built from local date components
  // (no UTC drift) — same formatting approach as calculateDueDateRaw.
  const isoFromAnchorMonths = (anchor, months) => {
    const d = new Date(anchor)
    d.setMonth(d.getMonth() + months)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // The mausoleum range anchored on signedAt (or today if unsigned): 6 months
  // out for the earliest, 8 for the latest. Used by both the auto-populate
  // effect and the recalc button.
  const mausoleumRange = () => {
    const anchor = order.signedAt ? new Date(order.signedAt) : new Date()
    return {
      earliest: isoFromAnchorMonths(anchor, 6),
      latest: isoFromAnchorMonths(anchor, 8),
    }
  }

  // Sprint S1 — auto-populate the mausoleum range on first visit. Fires only
  // for mausoleum orders when BOTH range dates are empty and the order isn't
  // locked. The dual null-check means clearing ONE date won't re-fire it;
  // clearing BOTH re-fires — intentional "reset to auto" path.
  useEffect(() => {
    if (!isMausoleum || isLocked) return
    if (order.targetCompletionDate || order.targetCompletionEndDate) return
    const { earliest, latest } = mausoleumRange()
    update({ targetCompletionDate: earliest, targetCompletionEndDate: latest })
  }, [order.targetCompletionDate, order.targetCompletionEndDate, isLocked, isMausoleum])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section title="Production timeline" eyebrow="Standard timeframes & rush option">
      {timelines.length > 0 ? (
        <div className="sm-timeline-list">
          {timelines.map(t => (
            <div key={t.code} className="sm-timeline-row">
              <div className="sm-timeline-svc">{t.label}</div>
              <div className="sm-timeline-std">
                Standard: <strong>{t.standardTime}</strong>
                {t.rushFee != null && order.rushOrder && (
                  <>
                    <span className="sm-timeline-arrow">→</span>
                    <span className="sm-timeline-rush">Rush: {t.rushTime || 'custom — see target date'} (+${t.rushFee})</span>
                  </>
                )}
                {t.custom && <span className="sm-timeline-custom-note"> · case-by-case quote</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sm-helper">Pick a service type on the first step to see timelines.</div>
      )}

      {rushableServices.length > 0 && (
        <div className="sm-rush-toggle-wrap">
          <ToggleChip on={order.rushOrder} onClick={() => setRush(!order.rushOrder)}>
            {order.rushOrder
              ? `✓ Rush this order — +$${totalRushFee}${rushableServices.length > 1 ? ` total across ${rushableServices.length} services` : ''}`
              : `⚡ Rush this order — +$${totalRushFee}${rushableServices.length > 1 ? ` (${rushableServices.length} services)` : ''}`}
          </ToggleChip>
          <div className="sm-helper" style={{ marginTop: 6 }}>
            Rush fees are added as separate line items per service. For monuments,
            rush time is case-by-case — set the target completion date below.
          </div>
        </div>
      )}

      {/* Sprint 3x — Cemetery deadline input removed from the UI. The
          order.cemeteryDeadline field, its row mappings, and the DB column are
          preserved; legacy data stays intact and other surfaces still read it. */}
      {isMausoleum ? (
        // Sprint S1 — mausoleum orders get a 6–8 month completion *range*
        // (earliest + latest) instead of a single date. The recalc button sits
        // on the "latest" field and resets BOTH dates to the auto range.
        <div className="sm-grid-2" style={{ marginTop: 14 }}>
          <Field label="Target completion — earliest" hint="Start of the mausoleum completion window">
            <input
              type="date"
              className="sm-textinput"
              value={order.targetCompletionDate || ''}
              onChange={e => setDate('targetCompletionDate', e.target.value)}
              disabled={isLocked}
            />
          </Field>
          <Field label="Target completion — latest" hint="End of the window — what the contract promises by">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                className="sm-textinput"
                value={order.targetCompletionEndDate || ''}
                onChange={e => setDate('targetCompletionEndDate', e.target.value)}
                disabled={isLocked}
              />
              <button
                type="button"
                className="sm-pricing-reset"
                title="Recalculate range from rules (6–8 months)"
                onClick={() => {
                  const { earliest, latest } = mausoleumRange()
                  update({ targetCompletionDate: earliest, targetCompletionEndDate: latest })
                }}
                disabled={isLocked}
              >↻</button>
            </div>
          </Field>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <Field label="Target completion date" hint="Promised by — what to plan production around">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                className="sm-textinput"
                value={order.targetCompletionDate || ''}
                onChange={e => setDate('targetCompletionDate', e.target.value)}
                disabled={isLocked}
              />
              {!dueRaw.isTBD && (
                <button
                  type="button"
                  className="sm-pricing-reset"
                  title="Recalculate from rules"
                  onClick={() => {
                    const { isoDate, isTBD } = calculateDueDateRaw(order)
                    update({ targetCompletionDate: isTBD ? null : isoDate })
                  }}
                  disabled={isLocked}
                >↻</button>
              )}
            </div>
          </Field>
        </div>
      )}

      <Field label="Timeline notes (optional)" wide>
        <TextInput
          value={order.timelineNotes || ''}
          onChange={v => update({ timelineNotes: v })}
          placeholder="Stone in stock · permits already pulled · cemetery scheduled install · etc."
        />
      </Field>
    </Section>
  )
}

// Build the auto-calculated line items from the order state
function buildLineItems(order) {
  const items = []

  // Sprint 3i — Mausoleum custom price (when MAUSOLEUM is in services and a
  // quoted price is set). This is the only "stone" line for mausoleum-only
  // orders since they skip shape/color/foundation auto-pricing.
  if (order.serviceTypes?.includes('MAUSOLEUM')) {
    const mausPrice = Number(order.mausoleumIntake?.customQuotedPrice) || 0
    if (mausPrice > 0 || !order.serviceTypes.some(c => ['NEW_STONE','BRONZE','CIVIC_MEMORIAL'].includes(c))) {
      items.push({
        code: 'mausoleum-base',
        label: mausPrice > 0
          ? `Mausoleum (custom quote)`
          : 'Mausoleum (custom quote — set price on the Mausoleum step)',
        amount: mausPrice,
        editable: true,
      })
    }
  }

  const shape = SHAPES.find(s => s.code === order.shape)
  if (shape) {
    // Base stone — from standard size price, or 0 (custom) if no standard picked
    const stdSize = order.standardSizeCode ? shape.standardSizes.find(s => s.code === order.standardSizeCode) : null
    const basePrice = stdSize?.price ?? 0
    items.push({
      code: 'base-stone',
      label: stdSize ? `${shape.label} — ${stdSize.label}` : `${shape.label} (custom — set price)`,
      amount: basePrice,
      editable: true,
    })

    // Color premium (multiplier on base)
    const color = GRANITE_COLORS.find(c => c.code === order.graniteColor)
    if (color && color.premium > 0) {
      items.push({
        code: 'color-premium',
        label: `${color.label} premium (+${Math.round(color.premium * 100)}%)`,
        amount: Math.round(basePrice * color.premium),
        editable: true,
      })
    }

    // Base block (if included or required)
    if (order.baseConfig.include || shape.requiresBase) {
      const baseSize = BASE_SIZES.find(b => b.code === order.baseConfig.sizeCode)
      const baseBasePrice = baseSize?.price ?? 0
      items.push({
        code: 'base-block',
        label: baseSize ? `Base — ${baseSize.label}` : 'Base block (custom — set price)',
        amount: baseBasePrice,
        editable: true,
      })

      // Base height upcharge per pricing sheet (Die + Base 6/8/10/12 line)
      const heightOpt = BASE_HEIGHTS.find(h => h.code === order.baseConfig.heightCode)
      if (heightOpt && heightOpt.upcharge > 0) {
        items.push({
          code: 'base-height',
          label: `Base height upcharge (${heightOpt.label})`,
          amount: heightOpt.upcharge,
          editable: true,
        })
      }

      // 2" polished margin add-on
      if (order.baseConfig.polishMargin2in) {
        items.push({
          code: 'polish-margin',
          label: '2″ polished margin',
          amount: 70,  // approximate — overridable
          editable: true,
        })
      }
    }

    // Foundation calc — use the BASE's footprint when a base is on the order;
    // fall back to the stone/marker footprint when there's no base. This
    // matches the pricing sheet (the foundation goes under the base, so the
    // base is what determines the foundation size).
    if (order.pricing.foundationCalc) {
      let footW = null, footD = null, source = null
      const hasBase = order.baseConfig.include || shape.requiresBase
      if (hasBase) {
        if (order.baseConfig.sizeCode && order.baseConfig.sizeCode !== 'custom') {
          const baseSize = BASE_SIZES.find(b => b.code === order.baseConfig.sizeCode)
          footW = baseSize?.w; footD = baseSize?.d
          source = 'base'
        } else if (order.baseConfig.sizeCode === 'custom') {
          footW = order.baseConfig.width; footD = order.baseConfig.depth
          source = 'custom base'
        }
      }
      // Fall back to stone footprint if no base info available
      if (!footW || !footD) {
        footW = order.width; footD = order.depth
        source = 'marker'
      }
      if (footW && footD) {
        const sqIn = footW * footD
        const rate = FOUNDATION_RATE[order.shape] || 2.85
        const computed = order.pricing.foundationOverride ?? Math.round(sqIn * rate)
        items.push({
          code: 'foundation',
          label: `Foundation (${footW}″ × ${footD}″ ${source} = ${sqIn} sq in × $${rate.toFixed(2)})`,
          amount: computed,
          editable: true,
        })
      }
    }
  }

  // Add-ons (skip ones that are free/included in stone price, like flat carve)
  for (const a of order.addOns) {
    if (a.freeWithStone) continue
    const cat = ADD_ONS_CATALOG.find(c => c.code === a.code)
    const designLookup = SHAPE_CARVED_DESIGNS.find(d => d.code === a.code)
    const baseLabel = a.label || cat?.label || designLookup?.label || a.code
    items.push({
      code: `addon-${a.code}`,
      label: a.qty > 1 ? `${baseLabel} × ${a.qty}` : baseLabel,
      amount: (a.price || 0) * (a.qty || 1),
      editable: true,
    })
  }

  // Custom font fee (only on Inscription services)
  if (order.serviceTypes.includes('INSCRIPTION') && order.inscription.customFont) {
    items.push({
      code: 'custom-font',
      label: 'Custom font fee',
      amount: CUSTOM_FONT_FEE,
      editable: true,
    })
  }

  // Sprint 3i — Rush fees. When rushOrder is on, add the rush fee for each
  // service type on the order that has one defined. Multiple services stack.
  if (order.rushOrder) {
    for (const svcCode of order.serviceTypes || []) {
      const tl = SERVICE_TIMELINES[svcCode]
      if (!tl || !tl.rushFee) continue
      items.push({
        code: `rush-${svcCode}`,
        label: `Rush fee — ${tl.label} (${tl.rushTime || 'custom timeline'})`,
        amount: tl.rushFee,
        editable: true,
      })
    }
  }

  // Custom line items added by salesperson
  for (const c of (order.pricing.customLineItems || [])) {
    items.push({
      code: `custom-${c.id}`,
      label: c.label || '(custom)',
      amount: Number(c.amount) || 0,
      editable: false,         // edited inline below
      isCustom: true,
      raw: c,
    })
  }

  return items
}

function PricingStep({ order, update }) {
  const lineItems = useMemo(() => buildLineItems(order), [order])
  const isLocked = !!(order.signedAt || order.pricingLockedAt)

  // Gate all mutations through this — edits are silent no-ops when locked.
  // Visual feedback comes from the banner + CSS dimming.
  const updatePricing = (patch) => {
    if (isLocked) return
    update({ pricing: { ...order.pricing, ...patch } })
  }

  // Apply override if set, else use computed amount
  const effectiveAmount = (item) => {
    const ov = order.pricing.overrides?.[item.code]
    return ov != null ? Number(ov) : item.amount
  }

  const setOverride = (code, val) => {
    if (isLocked) return
    const next = { ...order.pricing.overrides }
    if (val === '' || val == null) delete next[code]
    else next[code] = Number(val)
    updatePricing({ overrides: next })
  }

  // Subtotal math, with discount support:
  //   - Cemetery Permit ALWAYS sits outside the discount-eligible subtotal
  //     (passed through at cost, never discounted)
  //   - Discount applies to the rest of the subtotal
  //   - Tax then applies to (discounted subtotal + permit)
  //   - CC surcharge applies on top
  const isPermitItem = (it) => it.code === 'addon-permit'

  const subtotalDiscountable = lineItems.reduce(
    (sum, it) => sum + (isPermitItem(it) ? 0 : (effectiveAmount(it) || 0)), 0)
  const subtotalPermit = lineItems.reduce(
    (sum, it) => sum + (isPermitItem(it) ? (effectiveAmount(it) || 0) : 0), 0)

  const discountPct = Number(order.pricing.discountPct) || 0    // 0-100
  const discountAmount = Math.round(subtotalDiscountable * (discountPct / 100) * 100) / 100
  const subtotalAfterDiscount = subtotalDiscountable - discountAmount
  const subtotal = subtotalDiscountable + subtotalPermit         // pre-discount total (kept for display compat)

  const taxBase = subtotalAfterDiscount + subtotalPermit
  const taxAmount = order.pricing.applyTax ? Math.round(taxBase * NJ_TAX_RATE * 100) / 100 : 0
  const ccAmount  = order.pricing.applyCCSurcharge ? Math.round((taxBase + taxAmount) * CC_SURCHARGE * 100) / 100 : 0
  const total = taxBase + taxAmount + ccAmount

  // Custom line items
  const addCustomLineItem = () => {
    if (isLocked) return
    const id = Date.now()
    updatePricing({
      customLineItems: [...(order.pricing.customLineItems || []), { id, label: '', amount: 0 }],
    })
  }
  const updateCustomLineItem = (id, patch) => {
    if (isLocked) return
    updatePricing({
      customLineItems: (order.pricing.customLineItems || []).map(c => c.id === id ? { ...c, ...patch } : c),
    })
  }
  const removeCustomLineItem = (id) => {
    if (isLocked) return
    updatePricing({
      customLineItems: (order.pricing.customLineItems || []).filter(c => c.id !== id),
    })
  }

  // Delete a line item by removing the underlying source data. Different line
  // codes map to different homes in the order:
  //   addon-XXX     → remove from order.addOns (where code === XXX)
  //   custom-N      → remove from order.pricing.customLineItems
  //   foundation    → set foundationCalc=false
  //   base-block    → unset baseConfig.include + sizeCode
  //   base-height   → unset baseConfig.heightCode
  //   polish-margin → set polishMargin2in=false
  //   color-premium → unset graniteColor (rare but lets them remove premium)
  //   custom-font   → set inscription.customFont=false
  //   base-stone    → can't be removed (would leave the order without a stone);
  //                   we fall through to override $0 instead of touching shape
  //   anything else → override the line to $0 as a last resort
  const removeLineItem = (item) => {
    if (isLocked) return
    if (!confirm(`Remove "${item.label}" from this order?`)) return
    const code = item.code

    if (code === 'base-stone') {
      // Can't remove the stone itself — set override to $0 so it shows zero.
      setOverride(code, 0)
      alert('The base stone can\'t be deleted from the order. The price has been set to $0 instead — change shape/size on the Shape step if needed.')
      return
    }
    if (code.startsWith('addon-')) {
      const addonCode = code.slice('addon-'.length)
      update({ addOns: order.addOns.filter(a => a.code !== addonCode) })
      // Also clear any override that targeted this line
      const next = { ...order.pricing.overrides }; delete next[code]
      updatePricing({ overrides: next })
      return
    }
    if (code.startsWith('custom-')) {
      const id = Number(code.slice('custom-'.length))
      removeCustomLineItem(id)
      return
    }
    if (code === 'foundation') {
      updatePricing({ foundationCalc: false })
      return
    }
    if (code === 'base-block' || code === 'base-height' || code === 'polish-margin') {
      const patch = { ...(order.baseConfig || {}) }
      if (code === 'base-block') { patch.include = false; patch.sizeCode = null }
      if (code === 'base-height') { patch.heightCode = null }
      if (code === 'polish-margin') { patch.polishMargin2in = false }
      update({ baseConfig: patch })
      return
    }
    if (code === 'color-premium') {
      // Premium is computed from graniteColor; only way to drop it is override → 0
      setOverride(code, 0)
      return
    }
    if (code === 'custom-font') {
      update({ inscription: { ...order.inscription, customFont: false } })
      return
    }
    if (code.startsWith('rush-')) {
      // Removing a single service's rush fee turns rush off entirely.
      // (If they only want some services rushed, they can override the others to $0.)
      update({ rushOrder: false })
      return
    }
    // Unknown — override to $0
    setOverride(code, 0)
  }

  return (
    <div className={`sm-step ${isLocked ? 'sm-locked' : ''}`}>
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Pricing</div>
        <h1 className="sm-step-title">Pricing</h1>
        <p className="sm-step-lede">
          Auto-calculated from your order. Override any line item if needed —
          your override is saved per order. Tax and CC surcharge toggle on/off.
        </p>
      </div>

      {isLocked && (
        <div className="sm-locked-banner">
          🔒 <strong>Pricing is locked</strong> — this order is a contract
          {order.signedAt && <> (signed {new Date(order.signedAt).toLocaleDateString()})</>}.
          To make changes, this order would need to be re-opened by an admin.
        </div>
      )}

      {/* Line items table */}
      <Section title="Line items" eyebrow="Override any amount that needs adjusting">
        <div className="sm-pricing-table">
          {lineItems.length === 0 && (
            <div className="sm-helper">No line items yet — pick a shape and size to populate.</div>
          )}
          {lineItems.map(item => {
            if (item.isCustom) {
              return (
                <div key={item.code} className="sm-pricing-row sm-pricing-row-custom">
                  <input
                    className="sm-pricing-label-input"
                    value={item.raw.label}
                    onChange={e => updateCustomLineItem(item.raw.id, { label: e.target.value })}
                    placeholder="Custom line item description"
                  />
                  <div className="sm-pricing-amount">
                    <span className="sm-pricing-dollar">$</span>
                    <input
                      className="sm-pricing-amount-input"
                      type="number"
                      value={item.raw.amount}
                      onChange={e => updateCustomLineItem(item.raw.id, { amount: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <button
                    type="button"
                    className="sm-pricing-remove"
                    onClick={() => removeCustomLineItem(item.raw.id)}
                  >×</button>
                </div>
              )
            }
            const ov = order.pricing.overrides?.[item.code]
            const eff = effectiveAmount(item)
            return (
              <div key={item.code} className="sm-pricing-row">
                <div className="sm-pricing-label">{item.label}</div>
                <div className="sm-pricing-amount">
                  <span className="sm-pricing-dollar">$</span>
                  <input
                    className="sm-pricing-amount-input"
                    type="number"
                    value={ov != null ? ov : item.amount}
                    onChange={e => setOverride(item.code, e.target.value)}
                  />
                  {ov != null && (
                    <button
                      type="button"
                      className="sm-pricing-reset"
                      onClick={() => setOverride(item.code, null)}
                      title="Reset to default"
                    >↺</button>
                  )}
                </div>
                {!isLocked && (
                  <button
                    type="button"
                    className="sm-pricing-remove"
                    onClick={() => removeLineItem(item)}
                    title="Remove this line item from the order"
                  >×</button>
                )}
              </div>
            )
          })}
        </div>

        <button type="button" className="sm-add-btn" onClick={addCustomLineItem} style={{ marginTop: 12 }}>
          + Add a custom line item
        </button>
      </Section>

      {/* Foundation toggle */}
      <Section title="Foundation" eyebrow="Auto-calculated from W × D × rate per sq in">
        <ToggleChip
          on={order.pricing.foundationCalc}
          onClick={() => updatePricing({ foundationCalc: !order.pricing.foundationCalc })}
        >
          {order.pricing.foundationCalc ? '✓ Include foundation' : 'Include foundation'}
        </ToggleChip>
        <div className="sm-helper">
          Calculated from the <strong>base footprint</strong> when there's a base —
          falls back to the marker footprint when there isn't.
          Rate by shape: Slants $2.25 · Grass $2.00 · everything else $2.85 (default FDN).
        </div>
      </Section>

      {/* Production timeline + rush */}
      <ProductionTimelineSection order={order} update={update} isLocked={isLocked} />

      {/* Discount — applied to subtotal excluding Cemetery Permit */}
      <Section title="Discount" eyebrow="Applied before tax & CC fees · excludes Cemetery Permit">
        <div className="sm-discount-row">
          {[0, 5, 10, 15, 20].map(pct => (
            <button
              key={pct}
              type="button"
              className={`sm-discount-chip ${(Number(order.pricing.discountPct) || 0) === pct ? 'on' : ''}`}
              onClick={() => updatePricing({ discountPct: pct })}
              disabled={isLocked}
            >
              {pct === 0 ? 'No discount' : `${pct}%`}
            </button>
          ))}
          <div className="sm-discount-custom">
            <span className="sm-discount-custom-lab">Custom</span>
            <input
              type="number"
              className="sm-discount-custom-input"
              min="0" max="100" step="0.5"
              value={order.pricing.discountPct || ''}
              onChange={e => {
                const v = e.target.value === '' ? 0 : Math.max(0, Math.min(100, Number(e.target.value)))
                updatePricing({ discountPct: v })
              }}
              disabled={isLocked}
              placeholder="0"
            />
            <span className="sm-discount-custom-pct">%</span>
          </div>
        </div>
        {discountPct > 0 && (
          <div className="sm-discount-summary">
            <span>−{discountPct}% off ${subtotalDiscountable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{subtotalPermit > 0 ? ' (permit excluded)' : ''}</span>
            <strong>−${discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        )}
      </Section>

      {/* Tax + CC toggles */}
      <Section title="Tax &amp; surcharge" eyebrow="Toggle to include">
        <div className="sm-tax-toggles">
          <ToggleChip
            on={order.pricing.applyTax}
            onClick={() => updatePricing({ applyTax: !order.pricing.applyTax })}
          >
            {order.pricing.applyTax ? '✓ NJ Sales Tax (6.625%)' : 'NJ Sales Tax (6.625%)'}
          </ToggleChip>
          <ToggleChip
            on={order.pricing.applyCCSurcharge}
            onClick={() => updatePricing({ applyCCSurcharge: !order.pricing.applyCCSurcharge })}
          >
            {order.pricing.applyCCSurcharge ? '✓ CC Surcharge (3%)' : 'CC Surcharge (3%)'}
          </ToggleChip>
        </div>
      </Section>

      {/* Totals */}
      <Section title="Totals" eyebrow="Final estimate">
        <div className="sm-totals">
          <div className="sm-totals-row">
            <span>Subtotal</span>
            <span>${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {discountPct > 0 && (
            <>
              <div className="sm-totals-row sm-totals-row-discount">
                <span>Discount ({discountPct}%{subtotalPermit > 0 ? ' — permit excluded' : ''})</span>
                <span>−${discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="sm-totals-row">
                <span>Subtotal after discount</span>
                <span>${taxBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </>
          )}
          {order.pricing.applyTax && (
            <div className="sm-totals-row">
              <span>NJ Sales Tax (6.625%)</span>
              <span>${taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
          {order.pricing.applyCCSurcharge && (
            <div className="sm-totals-row">
              <span>CC Surcharge (3%)</span>
              <span>${ccAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="sm-totals-row sm-totals-row-grand">
            <span>Total</span>
            <span>${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Deposit & balance — 50% required at signing per company policy */}
        <div className="sm-deposit-card">
          <div className="sm-deposit-card-row sm-deposit-card-due">
            <div className="sm-deposit-card-lab">
              <strong>Due today</strong>
              <span className="sm-deposit-card-sub">50% deposit at signing</span>
            </div>
            <div className="sm-deposit-card-amt">
              ${(total * 0.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="sm-deposit-card-row">
            <div className="sm-deposit-card-lab">
              Balance due
              <span className="sm-deposit-card-sub">Remaining 50% — at delivery / installation</span>
            </div>
            <div className="sm-deposit-card-amt sm-deposit-card-amt-bal">
              ${(total * 0.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </Section>

      {/* Notes */}
      <Section title="Pricing notes" eyebrow="Internal — won't show on the customer estimate">
        <Field label="Notes" wide>
          <TextArea
            value={order.pricing.notes}
            onChange={v => updatePricing({ notes: v })}
            rows={2}
            placeholder="Anything to flag for the office or for the customer's signature appointment"
          />
        </Field>
      </Section>

      {/* Estimate PDF download */}
      <Section title="Estimate PDF" eyebrow="Print or email to the customer">
        <PdfDownloadButton order={order} />
      </Section>
    </div>
  )
}

// Sprint 3i — PDF action toolbar: Preview / Download / Email.
// Preview opens a modal with the PDF rendered inline (jsPDF's blob URL).
// Download saves to disk. Email opens the rep's email client via mailto:
// after auto-downloading the PDF as an attachment-ready file.
function PdfDownloadButton({ order, label }) {
  const [busy, setBusy] = useState(null)  // 'preview' | 'download' | 'email' | null
  const [err, setErr] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewFilename, setPreviewFilename] = useState('')
  const isContract = !!order.signedAt

  const finalLabel = label || (isContract ? 'Contract PDF' : 'Estimate PDF')

  // Build the doc once, reuse for whatever action
  const buildDoc = async () => {
    const fn = isContract ? generateContractPDF : generateEstimatePDF
    const { doc, filename } = await fn(order, { returnDoc: true })
    return { doc, filename }
  }

  const handlePreview = async () => {
    setBusy('preview'); setErr(null)
    try {
      const { doc, filename } = await buildDoc()
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
      setPreviewFilename(filename)
    } catch (e) {
      setErr(e.message || 'Preview failed')
    } finally {
      setBusy(null)
    }
  }

  const handleDownload = async () => {
    setBusy('download'); setErr(null)
    try {
      const { doc, filename } = await buildDoc()
      doc.save(filename)
    } catch (e) {
      setErr(e.message || 'PDF generation failed')
    } finally {
      setBusy(null)
    }
  }

  const handleEmail = async () => {
    setBusy('email'); setErr(null)
    try {
      // Download the PDF first so the rep can attach it
      const { doc, filename } = await buildDoc()
      doc.save(filename)
      // Compose mailto: with subject + body pre-filled
      const to = order.customer?.email || ''
      const firstName = order.customer?.firstName || 'there'
      const orderNum = order.orderNumber || 'DRAFT'
      const repName = order.salesRep || 'the Shevchenko team'
      const subjectLabel = isContract ? 'contract' : 'estimate'
      const subject = `Your ${subjectLabel} from Shevchenko Monuments — ${orderNum}`
      const body = [
        `Hello ${firstName},`,
        '',
        `Thank you for visiting Shevchenko Monuments. Please find your ${subjectLabel} attached — file name: ${filename}`,
        '',
        `Don't hesitate to reach out with any questions.`,
        '',
        `— ${repName}`,
        `Shevchenko Monuments`,
        `732-442-1286`,
      ].join('\n')
      const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      window.location.href = url
    } catch (e) {
      setErr(e.message || 'Email step failed')
    } finally {
      setBusy(null)
    }
  }

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewFilename('')
  }

  return (
    <div>
      <div className="sm-pdf-actions">
        <button
          type="button"
          className="sm-btn sm-btn-ghost sm-pdf-btn"
          onClick={handlePreview}
          disabled={busy !== null}
          title="Open a preview before downloading"
        >
          {busy === 'preview' ? 'Building…' : '👁  Preview'}
        </button>
        <button
          type="button"
          className="sm-btn sm-btn-navy sm-pdf-btn"
          onClick={handleDownload}
          disabled={busy !== null}
        >
          {busy === 'download' ? 'Building…' : '📄 Download ' + finalLabel}
        </button>
        <button
          type="button"
          className="sm-btn sm-btn-ghost sm-pdf-btn"
          onClick={handleEmail}
          disabled={busy !== null}
          title="Download + open your email with the customer pre-filled"
        >
          {busy === 'email' ? 'Building…' : '✉️  Email to customer'}
        </button>
      </div>
      {err && <div className="sm-pdf-err">⚠ {err}</div>}
      <div className="sm-helper" style={{ marginTop: 8 }}>
        {isContract
          ? 'Signed contract with embedded signatures and locked pricing.'
          : 'Preview before downloading. Email opens your default email client with the customer\'s address and PDF filename pre-filled — attach the downloaded file before sending.'}
      </div>

      {previewUrl && (
        <div className="sm-pdf-preview-overlay" onClick={closePreview}>
          <div className="sm-pdf-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="sm-pdf-preview-head">
              <div className="sm-pdf-preview-title">{previewFilename}</div>
              <div className="sm-pdf-preview-actions">
                <button type="button" className="sm-link-btn" onClick={handleDownload}>
                  📄 Download
                </button>
                <button type="button" className="sm-link-btn" onClick={closePreview}>
                  Close ×
                </button>
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="sm-pdf-preview-frame"
              title="PDF preview"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// STAFF NOTES THREAD (Staff Mode only)
// =============================================================================

function StaffNotes({ notes, onAddNote, salesRep }) {
  const [draft, setDraft] = useState('')
  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAddNote({ at: new Date().toISOString(), by: salesRep || 'Staff', text })
    setDraft('')
  }
  return (
    <div className="sm-staff-notes">
      <div className="sm-staff-notes-head">
        <span className="sm-staff-notes-eyebrow">Internal staff notes</span>
        <span className="sm-staff-notes-tag">Staff only</span>
      </div>

      {notes.length === 0 && (
        <div className="sm-staff-notes-empty">
          No notes yet. Anything for the team — questions to ask, things to follow up on,
          handoffs between staff — goes here.
        </div>
      )}
      {notes.length > 0 && (
        <div className="sm-staff-notes-list">
          {notes.slice().reverse().map((n, i) => (
            <div key={i} className="sm-staff-note">
              <div className="sm-staff-note-meta">
                <strong>{n.by || 'Staff'}</strong>
                <span> · {relativeTime(n.at)}</span>
              </div>
              <div className="sm-staff-note-text">{n.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="sm-staff-notes-input">
        <textarea
          className="sm-textarea"
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
          }}
          placeholder="Add a note for the team — Cmd/Ctrl+Enter to post"
        />
        <button type="button" className="sm-btn sm-btn-navy" onClick={submit} disabled={!draft.trim()}>
          Post note
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// ORDERS DASHBOARD — entry screen with status filters + search
// =============================================================================

// Renders a single order row in the dashboard list
function DashboardOrderRow({ row, onPick, onNewQuote }) {
  const customer = row.customer
  const status = ORDER_STATUSES.find(s => s.code === row.status) || { label: row.status, color: 'gray' }

  const handleNewQuote = (e) => {
    e.stopPropagation()
    if (onNewQuote) onNewQuote(customer)
  }

  return (
    <div className="sm-resume-row-wrap">
      <button type="button" className="sm-resume-row" onClick={() => onPick(row.id)}>
        <div className="sm-resume-row-main">
          <div className="sm-resume-row-num">{row.order_number}</div>
          <div className="sm-resume-row-name">
            {customer
              ? `${customer.last_name?.toUpperCase() || ''}${customer.last_name && customer.first_name ? ', ' : ''}${customer.first_name || ''}`
              : 'No customer yet'}
          </div>
          <div className="sm-resume-row-meta">
            {row.cemetery?.name && <span>{row.cemetery.name}</span>}
            {row.service_types?.length > 0 && (
              <span>
                {row.service_types.map(c =>
                  SERVICE_TYPES.find(s => s.code === c)?.label
                ).filter(Boolean).join(', ')}
              </span>
            )}
            {row.sales_rep && <span>{row.sales_rep}</span>}
            <span>updated {relativeTime(row.updated_at)}</span>
          </div>
        </div>
        <div className="sm-resume-row-status" data-status={row.status}>
          {status.label}
        </div>
      </button>
      {customer && onNewQuote && (
        <button
          type="button"
          className="sm-resume-row-action"
          onClick={handleNewQuote}
          title={`New quote for ${customer.first_name} ${customer.last_name}`}
        >
          + New quote
        </button>
      )}
    </div>
  )
}

// Sprint 3h — full dashboard with status pills, search, and all orders.
function OrdersDashboard({ onPick, onStartNew, onNewQuote, onClose }) {
  // 'active' = anything in flight; 'all' = everything; or a single status code
  const [filter, setFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  // Refetch whenever filter changes (search filters client-side from the
  // already-loaded set so it's instant)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    let statuses
    if (filter === 'active')        statuses = ACTIVE_STATUSES
    else if (filter === 'all')      statuses = ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => s.code)
    else if (filter === 'archived') statuses = ['archived']
    else                            statuses = [filter]
    listOrders({ statuses, limit: 200 }).then(rows => {
      if (cancelled) return
      setOrders(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter])

  // Apply search client-side
  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders
    const needle = search.trim().toLowerCase()
    return orders.filter(row => {
      const num   = (row.order_number || '').toLowerCase()
      const cust  = row.customer
      const first = (cust?.first_name || '').toLowerCase()
      const last  = (cust?.last_name || '').toLowerCase()
      const email = (cust?.email || '').toLowerCase()
      const phone = (cust?.phone_primary || '').toLowerCase()
      return num.includes(needle) || first.includes(needle) || last.includes(needle)
          || email.includes(needle) || phone.includes(needle)
          || `${first} ${last}`.includes(needle)
    })
  }, [orders, search])

  // Status counts (for filter chip badges) — recompute against current orders.
  // For 'active' / 'all' chips we count differently than for individual statuses.
  const statusCount = (code) => orders.filter(r => r.status === code).length

  return (
    <div className="sm-resume">
      <div className="sm-resume-inner sm-dashboard-inner">
        <div className="sm-resume-head">
          <div className="sm-step-eyebrow">Sales Mode</div>
          <h1 className="sm-step-title">Where to?</h1>
          <p className="sm-step-lede">
            Pick up where you left off, start a new sale, or check in on
            production.
          </p>
        </div>

        <button type="button" className="sm-resume-newcard" onClick={onStartNew}>
          <div className="sm-resume-newcard-icon">＋</div>
          <div>
            <div className="sm-resume-newcard-title">Start a new sale</div>
            <div className="sm-resume-newcard-blurb">Begin a fresh customer profile.</div>
          </div>
        </button>

        {/* Search bar */}
        <div className="sm-dashboard-search">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔎 Search by order #, customer name, email, or phone…"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear">×</button>
          )}
        </div>

        {/* Status filter pills */}
        <div className="sm-dashboard-filters">
          <button
            type="button"
            className={`sm-dashboard-pill ${filter === 'active' ? 'on' : ''}`}
            onClick={() => setFilter('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`sm-dashboard-pill ${filter === 'all' ? 'on' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`sm-dashboard-pill ${filter === 'archived' ? 'on' : ''}`}
            onClick={() => setFilter('archived')}
            data-status="archived"
          >
            📦 Archive
          </button>
          <span className="sm-dashboard-divider">|</span>
          {ORDER_STATUSES.filter(s => s.code !== 'archived').map(s => (
            <button
              key={s.code}
              type="button"
              className={`sm-dashboard-pill ${filter === s.code ? 'on' : ''}`}
              data-status={s.code}
              onClick={() => setFilter(s.code)}
            >
              {s.label}
              {filter !== s.code && statusCount(s.code) > 0 && (
                <span className="sm-dashboard-pill-count">{statusCount(s.code)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Orders list */}
        {loading ? (
          <div className="sm-resume-empty">Loading…</div>
        ) : filteredOrders.length === 0 ? (
          <div className="sm-resume-empty">
            {search.trim()
              ? `No orders matching "${search.trim()}"`
              : filter === 'active'
                ? 'No active orders. Start a new sale above.'
                : 'No orders in this status yet.'}
          </div>
        ) : (
          <>
            <div className="sm-resume-divider">
              <span>{filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}</span>
            </div>
            <div className="sm-resume-list">
              {filteredOrders.map(row => (
                <DashboardOrderRow key={row.id} row={row} onPick={onPick} onNewQuote={onNewQuote} />
              ))}
            </div>
          </>
        )}

        <button type="button" className="sm-resume-back" onClick={onClose}>
          ← Back to catalog
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// SPRINT 3i — MAUSOLEUM INTAKE STEP
// =============================================================================

const MAUS_FEATURES = [
  { code: 'stained-glass',   label: 'Stained glass window' },
  { code: 'statuary-niche',  label: 'Statuary niche' },
  { code: 'vaulted-ceiling', label: 'Vaulted ceiling' },
  { code: 'bench-seat',      label: 'Bench seat / sitting area' },
  { code: 'gates',           label: 'Decorative gates' },
  { code: 'porch',           label: 'Covered porch' },
  { code: 'columns',         label: 'Columns / columned entry' },
  { code: 'roof-finial',     label: 'Decorative roof finial / cross' },
  { code: 'bronze-doors',    label: 'Bronze doors' },
  { code: 'engraved-lintel', label: 'Engraved name lintel' },
]

function MausoleumStep({ order, update }) {
  const intake = order.mausoleumIntake || {}
  const updateIntake = (patch) => update({ mausoleumIntake: { ...intake, ...patch } })

  const toggleFeature = (code) => {
    const has = (intake.features || []).includes(code)
    updateIntake({
      features: has
        ? intake.features.filter(c => c !== code)
        : [...(intake.features || []), code],
    })
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Mausoleum intake</div>
        <h1 className="sm-step-title">Mausoleum quote</h1>
        <p className="sm-step-lede">
          Mausoleums are quoted case-by-case. Capture the customer's vision
          here — capacity, color, style, features. Pricing happens in a
          follow-up after a site visit / detailed scoping.
        </p>
      </div>

      <Section title="Capacity & footprint" eyebrow="How big and for how many">
        <div className="sm-grid-2">
          <Field label="How many people?" hint="Crypts / interments">
            <SelectInput
              value={intake.capacity || ''}
              onChange={v => updateIntake({ capacity: v })}
              options={[
                { value: '1',  label: '1 person' },
                { value: '2',  label: '2 people (companion)' },
                { value: '4',  label: '4 people' },
                { value: '6',  label: '6 people' },
                { value: '8+', label: '8 or more (large family)' },
              ]}
              placeholder="— pick capacity —"
            />
          </Field>
          <Field label="Approximate footprint" hint="Lot size / dimensions">
            <TextInput
              value={intake.footprint || ''}
              onChange={v => updateIntake({ footprint: v })}
              placeholder="e.g. 8' x 12' / cemetery lot is 12' x 16'"
            />
          </Field>
        </div>
      </Section>

      <Section title="Style" eyebrow="Layout & access">
        <Field label="Walk-in or sealed?">
          <div className="sm-toggle-group">
            <button
              type="button"
              className={`sm-toggle-btn ${intake.style === 'walk-in' ? 'on' : ''}`}
              onClick={() => updateIntake({ style: 'walk-in' })}
            >Walk-in</button>
            <button
              type="button"
              className={`sm-toggle-btn ${intake.style === 'sealed-front' ? 'on' : ''}`}
              onClick={() => updateIntake({ style: 'sealed-front' })}
            >Sealed-front</button>
            <button
              type="button"
              className={`sm-toggle-btn ${intake.style === 'unknown' ? 'on' : ''}`}
              onClick={() => updateIntake({ style: 'unknown' })}
            >Not yet decided</button>
          </div>
        </Field>
        <Field label="Roof style">
          <SelectInput
            value={intake.roofStyle || ''}
            onChange={v => updateIntake({ roofStyle: v })}
            options={[
              { value: 'flat',     label: 'Flat' },
              { value: 'gabled',   label: 'Gabled (peaked)' },
              { value: 'vaulted',  label: 'Vaulted / domed' },
              { value: 'unknown',  label: 'Not yet decided' },
            ]}
            placeholder="— pick roof style —"
          />
        </Field>
      </Section>

      <Section title="Granite color" eyebrow="Customer's preference">
        <Field label="Color preference">
          <TextInput
            value={intake.colorPreference || ''}
            onChange={v => updateIntake({ colorPreference: v })}
            placeholder="e.g. Barre Grey · Jet Black with bronze trim · open to options"
          />
        </Field>
      </Section>

      <Section title="Features & details" eyebrow="Pick anything they're asking for">
        <div className="sm-referral-grid">
          {MAUS_FEATURES.map(f => (
            <button
              key={f.code}
              type="button"
              className={`sm-referral-chip ${(intake.features || []).includes(f.code) ? 'on' : ''}`}
              onClick={() => toggleFeature(f.code)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Customer's vision" eyebrow="In their own words">
        <Field label="Description" wide>
          <TextArea
            value={intake.vision || ''}
            onChange={v => updateIntake({ vision: v })}
            placeholder="What's the customer asking for? Family history, religious significance, aesthetic preferences, references to other mausoleums they've seen…"
            rows={4}
          />
        </Field>
      </Section>

      <Section title="Site visit & quote" eyebrow="Mausoleums require detailed scoping">
        <ToggleChip
          on={intake.siteVisitNeeded !== false}
          onClick={() => updateIntake({ siteVisitNeeded: !intake.siteVisitNeeded })}
        >
          {intake.siteVisitNeeded !== false
            ? '✓ Site visit required to finalize pricing'
            : 'Site visit not required (rare)'}
        </ToggleChip>
        <Field label="Custom quoted price (set after scoping)" wide hint="Leave blank until ready to give a real number">
          <TextInput
            type="number"
            value={intake.customQuotedPrice ?? ''}
            onChange={v => updateIntake({ customQuotedPrice: v === '' ? null : Number(v) })}
            placeholder="e.g. 85000"
          />
        </Field>
        <div className="sm-helper">
          The custom quoted price flows into Pricing as the base line item once set.
          Add-ons (carvings, photos, permits) can still be added on the Add-Ons step.
        </div>
      </Section>
    </div>
  )
}

// =============================================================================
// MAIN — SalesMode
// =============================================================================

// All step DEFINITIONS — buildSteps() picks which apply for a given order.
const STEP_DEFS = {
  'service-type': { label: 'Service',  Component: ServiceTypeStep,
    isComplete: o => o.serviceTypes.length > 0 && (!o.serviceTypes.includes('OTHER') || o.otherServiceDescription?.trim()) },
  'customer':     { label: 'Customer', Component: CustomerStep,
    isComplete: o => o.customer.firstName?.trim() && o.customer.lastName?.trim() },
  'cemetery':     { label: 'Cemetery', Component: CemeteryStep,
    isComplete: o => o.cemetery.name?.trim() },
  'deceased':     { label: 'Memorial', Component: DeceasedStep,
    isComplete: o => o.deceased.some(d => !d.isReserved && d.firstName?.trim()) },
  'shape':        { label: 'Shape',    Component: ShapeStep,
    isComplete: o => {
      if (!o.shape) return false
      // Must have either a standard size or all custom dims
      const hasSize = !!o.standardSizeCode || (o.width != null && o.depth != null)
      if (!hasSize) return false
      // Polish + sides required for shapes that have vertical sides
      const sidedShapes = ['slant', 'double-slant', 'die', 'double-die', 'civic', 'custom']
      if (sidedShapes.includes(o.shape) && (!o.polishLevel || !o.sides)) return false
      // Top shape required for shapes that have one
      const topShapeRequired = ['slant', 'double-slant', 'die', 'double-die', 'civic', 'custom'].includes(o.shape)
      if (topShapeRequired && !o.topShape) return false
      // Custom shape needs a pick or description
      if (o.shape === 'custom' && !o.customShape && !o.customShapeDescription) return false
      return true
    },
  },
  'color':        { label: 'Color',    Component: ColorStep,
    isComplete: o => !!o.graniteColor },
  'design':       { label: 'Design',   Component: DesignStep,
    // Design pick is encouraged but not strictly required to advance
    isComplete: () => true },
  'mausoleum':    { label: 'Mausoleum', Component: MausoleumStep,
    isComplete: () => true },     // intake — never blocks
  'inscription':  { label: 'Inscript.', Component: InscriptionStep,
    isComplete: o => {
      // For inscription-only flow, require type pick. Otherwise nothing required.
      const inscrAndAddon = ['INSCRIPTION', 'ACID_WASH', 'REPAIR', 'ADD_PHOTO']
      const isInscOnly = o.serviceTypes.length > 0 && o.serviceTypes.every(c => inscrAndAddon.includes(c))
      if (isInscOnly && o.serviceTypes.includes('INSCRIPTION') && !o.inscription?.type) return false
      return true
    },
  },
  'addons':       { label: 'Add-ons',  Component: AddOnsStep,
    isComplete: () => true },     // never blocks
  'pricing':      { label: 'Pricing',  Component: PricingStep,
    isComplete: () => true },     // never blocks (but always shows up)
  'sign':         { label: 'Sign',     Component: SignStep,
    isComplete: () => true },     // never blocks
  'continue':     { label: 'Saved',    Component: ContinueLater,
    isComplete: () => true },
}

// Dynamic step list based on which services are picked. We always show the
// first 4 (service / customer / cemetery / memorial) and the last (saved).
// Stone-config steps appear if any "needs new stone" service is picked.
// Inscription step appears for any new-stone service OR for inscription-only
// services (existing stone work).
function buildSteps(order) {
  const services = order.serviceTypes || []
  const STONE_SERVICES = ['NEW_STONE', 'BRONZE', 'CIVIC_MEMORIAL', 'MAUSOLEUM']
  const NON_MAUS_STONE = ['NEW_STONE', 'BRONZE', 'CIVIC_MEMORIAL']
  const INSCR_SERVICES = ['INSCRIPTION', 'ACID_WASH', 'REPAIR', 'ADD_PHOTO']
  const hasMausoleum = services.includes('MAUSOLEUM')
  const hasOtherStone = services.some(c => NON_MAUS_STONE.includes(c))
  const needsStone = services.some(c => STONE_SERVICES.includes(c))
  const needsInscr = needsStone || services.some(c => INSCR_SERVICES.includes(c))

  const keys = ['service-type', 'customer', 'cemetery', 'deceased']
  // Mausoleum intake comes before standard stone steps when relevant
  if (hasMausoleum) keys.push('mausoleum')
  if (hasOtherStone) keys.push('shape', 'color', 'design')
  if (needsInscr)  keys.push('inscription')
  // Add-ons + Pricing always appear once we have any service picked
  if (services.length > 0) keys.push('addons', 'pricing', 'sign')
  keys.push('continue')

  return keys.map(k => ({ key: k, ...STEP_DEFS[k] }))
}

export default function SalesMode({ onClose, initialOrderId = null }) {
  // Resume / load
  const [phase, setPhase] = useState('loading')   // loading | resume | wizard
  const [drafts, setDrafts] = useState([])

  // Order state
  const [order, setOrder] = useState(makeBlankOrder())
  const [stepIdx, setStepIdx] = useState(0)

  // UI state
  const [mode, setMode] = useState('staff')
  const [saveStatus, setSaveStatus] = useState('idle')   // idle | saving | saved | error
  const [showStaffNotes, setShowStaffNotes] = useState(false)
  const [toast, setToast] = useState(null)               // { msg, kind } | null

  // Sprint 3n: when launched with a specific order ID (from Stonebooks Orders tab),
  // skip the resume screen and load that order directly into the wizard.
  useEffect(() => {
    if (!initialOrderId) return
    let cancelled = false
    setPhase('loading')
    loadOrder(initialOrderId).then(loaded => {
      if (cancelled) return
      if (loaded) {
        setOrder(loaded)
        lastSavedJsonRef.current = JSON.stringify(loaded)
        setStepIdx(0)
      }
      setPhase('wizard')
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId])

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(t => (t && t.msg === msg ? null : t)), 3500)
  }, [])

  // Persist mode preference across sessions
  useEffect(() => {
    const stored = localStorage.getItem('shevSalesModeUi')
    if (stored === 'customer' || stored === 'staff') setMode(stored)
  }, [])
  useEffect(() => {
    localStorage.setItem('shevSalesModeUi', mode)
  }, [mode])

  // Always start at the dashboard — it's the entry/landing for Sales Mode —
  // UNLESS Stonebooks launched us with a specific order to open (see initialOrderId effect).
  useEffect(() => {
    if (initialOrderId) return  // the initialOrderId effect handles this case
    setPhase('resume')
  }, [initialOrderId])

  // Auto-save with debounce
  const orderForSaveRef = useRef(order)
  orderForSaveRef.current = order
  const lastSavedJsonRef = useRef('')
  const saveTimerRef = useRef(null)

  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const o = orderForSaveRef.current
      const snapshot = JSON.stringify(o)
      if (snapshot === lastSavedJsonRef.current) return
      lastSavedJsonRef.current = snapshot

      // Snapshot what was new BEFORE the save so we can detect first-time inserts
      const wasNewCustomer  = !o.customer.id  && (o.customer.firstName || o.customer.lastName)
      const wasNewCemetery  = !o.cemetery.id  && o.cemetery.name?.trim()

      setSaveStatus('saving')
      const result = await saveOrder(o)
      if (result.ok) {
        // If this was the first save (no id before), update state with id + number
        if (!o.id && result.order?.id) {
          setOrder(prev => ({
            ...prev,
            id: result.order.id,
            orderNumber: result.order.orderNumber,
            customer: result.customerId  ? { ...prev.customer,  id: result.customerId }  : prev.customer,
            cemetery: result.cemeteryId  ? { ...prev.cemetery,  id: result.cemeteryId }  : prev.cemetery,
          }))
        } else {
          // Subsequent saves — make sure customer/cemetery IDs are reflected
          if (result.customerId && !o.customer.id) {
            setOrder(prev => ({ ...prev, customer: { ...prev.customer, id: result.customerId } }))
          }
          if (result.cemeteryId && !o.cemetery.id) {
            setOrder(prev => ({ ...prev, cemetery: { ...prev.cemetery, id: result.cemeteryId } }))
          }
        }

        // Toasts for newly-created library entries
        if (wasNewCemetery && result.cemeteryId) {
          showToast(`✓ ${o.cemetery.name} saved to your cemetery library`, 'cemetery')
        }
        if (wasNewCustomer && result.customerId) {
          showToast(`✓ ${o.customer.lastName?.toUpperCase() || ''}, ${o.customer.firstName} saved to customer list`, 'customer')
        }

        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
      } else {
        setSaveStatus(result.reason === 'empty' ? 'idle' : 'error')
      }
    }, 1200)
  }, [showToast])

  // When order changes during the wizard phase, schedule autosave
  useEffect(() => {
    if (phase !== 'wizard') return
    triggerAutoSave()
  }, [order, phase, triggerAutoSave])

  // ---- Update helpers --------------------------------------------------------
  const update = useCallback((patch) => {
    setOrder(prev => ({ ...prev, ...patch }))
  }, [])

  const addStaffNote = useCallback((note) => {
    setOrder(prev => ({ ...prev, staffNotes: [...prev.staffNotes, note] }))
  }, [])

  // ---- Resume screen actions -------------------------------------------------
  const startNew = () => {
    setOrder(makeBlankOrder())
    lastSavedJsonRef.current = ''
    setStepIdx(0)
    setPhase('wizard')
  }

  // Sprint 3i — start a new quote with a known customer pre-filled.
  // Used from the dashboard's "+ New quote" action on a customer row.
  // Cemetery + deceased + service + everything else is left fresh — a
  // returning family might be buying for a different person at a different
  // cemetery, so re-using prior data invites mistakes.
  const startNewQuoteForCustomer = (customerRow) => {
    if (!customerRow) return startNew()
    const blank = makeBlankOrder()
    blank.customer = rowToCustomer(customerRow)
    blank.parentQuoteId = null  // not branched from a specific order; just same customer
    setOrder(blank)
    lastSavedJsonRef.current = ''
    setStepIdx(0)
    setPhase('wizard')
  }

  const pickDraft = async (orderId) => {
    setPhase('loading')
    const loaded = await loadOrder(orderId)
    if (loaded) {
      setOrder(loaded)
      lastSavedJsonRef.current = JSON.stringify(loaded)
      setStepIdx(0)
    }
    setPhase('wizard')
  }

  // ---- Wizard navigation -----------------------------------------------------
  const steps = useMemo(() => buildSteps(order), [order.serviceTypes])
  const safeStepIdx = Math.min(stepIdx, steps.length - 1)
  const step = steps[safeStepIdx]
  const isLast = safeStepIdx === steps.length - 1
  const canAdvance = step.isComplete(order)

  const next = () => safeStepIdx < steps.length - 1 && setStepIdx(safeStepIdx + 1)
  const back = () => safeStepIdx > 0 && setStepIdx(safeStepIdx - 1)

  // If selected services change in a way that shortens the wizard, snap stepIdx back
  useEffect(() => {
    if (stepIdx > steps.length - 1) setStepIdx(steps.length - 1)
  }, [steps.length, stepIdx])

  // Auto-bump status when first step completes
  useEffect(() => {
    if (order.status === 'draft' && order.serviceTypes.length > 0 && order.customer.firstName) {
      update({ status: 'scoping' })
    }
  }, [order.serviceTypes.length, order.customer.firstName, order.status, update])

  // ---- Render ---------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="sm-root">
        <style>{styles}</style>
        <div className="sm-loading">Loading…</div>
      </div>
    )
  }

  if (phase === 'resume') {
    return (
      <div className="sm-root">
        <style>{styles}</style>
        <OrdersDashboard
          onPick={pickDraft}
          onStartNew={startNew}
          onNewQuote={startNewQuoteForCustomer}
          onClose={onClose}
        />
      </div>
    )
  }

  // Wizard view
  return (
    <div className={`sm-root sm-mode-${mode}`}>
      <style>{styles}</style>

      {/* HEADER */}
      <div className="sm-header">
        <div className="sm-brand">
          <div className="sm-brand-mark">S</div>
          <div className="sm-brand-text">
            <div className="sm-brand-eyebrow">Shevchenko Monuments</div>
            <div className="sm-brand-title">Sales Mode</div>
          </div>
        </div>

        <div className="sm-progress">
          {steps.map((s, i) => {
            const done = i < safeStepIdx || (i === safeStepIdx && s.isComplete(order))
            const current = i === safeStepIdx
            return (
              <button
                key={s.key}
                type="button"
                className={`sm-progress-step ${current ? 'on' : ''} ${done && !current ? 'done' : ''}`}
                onClick={() => setStepIdx(i)}
              >
                <div className="sm-progress-dot">{done && !current ? '✓' : i + 1}</div>
                <div className="sm-progress-label">{s.label}</div>
              </button>
            )
          })}
        </div>

        <div className="sm-header-right">
          <div className="sm-save-status" data-status={saveStatus}>
            {saveStatus === 'saving' && <>● Saving…</>}
            {saveStatus === 'saved'  && <>✓ Saved</>}
            {saveStatus === 'error'  && <>! Save error</>}
            {saveStatus === 'idle'   && order.orderNumber && <>● {order.orderNumber}</>}
          </div>

          <div className="sm-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={mode === 'staff' ? 'on' : ''}
              onClick={() => setMode('staff')}
              title="Internal view — shows sales rep, notes, all controls"
            >
              Staff
            </button>
            <button
              type="button"
              className={mode === 'customer' ? 'on' : ''}
              onClick={() => setMode('customer')}
              title="Customer-facing view — hides internal notes/controls"
            >
              Customer
            </button>
          </div>

          <button className="sm-close" onClick={onClose} aria-label="Exit Sales Mode">×</button>
        </div>
      </div>

      {/* BODY */}
      <div className="sm-body">
        <step.Component
          order={order}
          update={update}
          mode={mode}
        />

        {mode === 'staff' && (
          <div className="sm-staff-aside">
            <button
              type="button"
              className="sm-staff-toggle"
              onClick={() => setShowStaffNotes(s => !s)}
            >
              {showStaffNotes ? '▾' : '▸'} Internal staff notes
              {order.staffNotes.length > 0 && <span className="sm-staff-toggle-count">{order.staffNotes.length}</span>}
            </button>
            {showStaffNotes && (
              <StaffNotes
                notes={order.staffNotes}
                onAddNote={addStaffNote}
                salesRep={order.salesRep}
              />
            )}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="sm-footer">
        <button className="sm-btn sm-btn-ghost" onClick={back} disabled={stepIdx === 0}>
          ← Back
        </button>

        <div className="sm-footer-summary">
          {order.salesRep && mode === 'staff' && (
            <span className="sm-pill">Rep: {order.salesRep}</span>
          )}
          {order.customer.lastName && (
            <span className="sm-pill"><strong>{order.customer.lastName.toUpperCase()}</strong></span>
          )}
          {order.cemetery.name && (
            <span className="sm-pill">{order.cemetery.name}</span>
          )}
          {(() => {
            const firstNamed = order.deceased.find(d => !d.isReserved && d.firstName)
            return firstNamed ? (
              <span className="sm-pill">For: {firstNamed.firstName} {firstNamed.lastName}</span>
            ) : null
          })()}
        </div>

        {!isLast ? (
          <button className="sm-btn sm-btn-gold" onClick={next} disabled={!canAdvance}>
            Continue →
          </button>
        ) : (
          <button className="sm-btn sm-btn-navy" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {/* TOAST */}
      {toast && (
        <div className={`sm-toast sm-toast-${toast.kind || 'info'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
function ContinueLater({ order, update }) {
  const shape = SHAPES.find(s => s.code === order.shape)
  const color = GRANITE_COLORS.find(c => c.code === order.graniteColor)
  const dims = [order.width, order.depth, order.thickness].filter(x => x != null).join(' × ')
  const inscType = INSCRIPTION_TYPES.find(t => t.code === order.inscription?.type)?.label

  // Compute grand total from current pricing
  const lineItems = buildLineItems(order)
  const subtotal = lineItems.reduce((sum, it) => {
    const ov = order.pricing?.overrides?.[it.code]
    return sum + (ov != null ? Number(ov) : it.amount)
  }, 0)
  const tax = order.pricing?.applyTax ? subtotal * NJ_TAX_RATE : 0
  const cc  = order.pricing?.applyCCSurcharge ? subtotal * CC_SURCHARGE : 0
  const total = subtotal + tax + cc

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">All set for now</div>
        <h1 className="sm-step-title">Saved.</h1>
        <p className="sm-step-lede">
          Everything captured so far is saved. The contract + signature step
          is the last piece — coming in the next build.
        </p>
      </div>

      <div className="sm-summary">
        <div className="sm-summary-grid">
          <div>
            <div className="sm-summary-lab">Order #</div>
            <div className="sm-summary-val">{order.orderNumber || '—'}</div>
          </div>
          <div>
            <div className="sm-summary-lab">Customer</div>
            <div className="sm-summary-val">
              {order.customer.lastName?.toUpperCase()}, {order.customer.firstName}
            </div>
          </div>
          <div>
            <div className="sm-summary-lab">Cemetery</div>
            <div className="sm-summary-val">{order.cemetery.name || '—'}</div>
          </div>
          <div>
            <div className="sm-summary-lab">Memorial</div>
            <div className="sm-summary-val">
              {(() => {
                const named = order.deceased
                  .filter(d => !d.isReserved && (d.firstName || d.lastName))
                  .map(d => `${d.firstName} ${d.lastName}`.trim())
                const reservedCount = order.deceased.filter(d => d.isReserved).length
                const parts = [...named]
                if (reservedCount > 0) {
                  parts.push(`${reservedCount} reserved space${reservedCount > 1 ? 's' : ''}`)
                }
                return parts.join(' · ') || '—'
              })()}
            </div>
          </div>
          <div>
            <div className="sm-summary-lab">Service types</div>
            <div className="sm-summary-val">
              {order.serviceTypes.map(c => SERVICE_TYPES.find(s => s.code === c)?.label).filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          <div>
            <div className="sm-summary-lab">Status</div>
            <div className="sm-summary-val">
              {ORDER_STATUSES.find(s => s.code === order.status)?.label || order.status}
            </div>
          </div>

          {(shape || color || dims) && (
            <>
              <div>
                <div className="sm-summary-lab">Stone</div>
                <div className="sm-summary-val">
                  {[shape?.label, dims ? dims + '″' : null].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div>
                <div className="sm-summary-lab">Granite</div>
                <div className="sm-summary-val">
                  {color ? `${color.label} (${color.origin})` : '—'}
                </div>
              </div>
            </>
          )}

          {order.designs && order.designs.length > 0 && (
            <div>
              <div className="sm-summary-lab">Designs</div>
              <div className="sm-summary-val">
                {(() => {
                  const primary = order.designs[0]?.snapshot
                  const primaryName = primary?.lastname || primary?.id || '—'
                  const altCount = order.designs.length - 1
                  if (altCount === 0) return `${primaryName} · 1 design (primary only)`
                  return `${primaryName} · 1 primary + ${altCount} alternate${altCount === 1 ? '' : 's'}`
                })()}
              </div>
            </div>
          )}

          {inscType && (
            <div>
              <div className="sm-summary-lab">Inscription type</div>
              <div className="sm-summary-val">{inscType}</div>
            </div>
          )}

          {order.addOns?.length > 0 && (
            <div>
              <div className="sm-summary-lab">Add-ons</div>
              <div className="sm-summary-val">
                {order.addOns.length} item{order.addOns.length === 1 ? '' : 's'}
              </div>
            </div>
          )}

          {total > 0 && (
            <div>
              <div className="sm-summary-lab">Estimated total</div>
              <div className="sm-summary-val sm-summary-val-total">
                ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          {order.inscription?.epitaph && (
            <div className="sm-summary-wide">
              <div className="sm-summary-lab">Epitaph</div>
              <div className="sm-summary-val sm-summary-val-quote">
                "{order.inscription.epitaph}"
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sprint 3s — Designer handoff: surface picked designs + free-text notes
          so the layout team has everything they need on the saved-order page.
          Designer handoff fields stay editable post-signing (production info,
          not contractual). The bound field is order.designPreferences, the
          existing "Describe what they want" textarea from step 7 — single
          source of truth, no new column. */}
      <DesignerHandoffSection order={order} update={update} />

      <Section title="Estimate PDF" eyebrow="Print or email to the customer">
        <PdfDownloadButton order={order} />
      </Section>

      <Section title="Order status" eyebrow="Move this order through its lifecycle">
        <OrderStatusChanger order={order} update={update} />
      </Section>

      <PaymentTrackingSection order={order} update={update} />

      <CancelOrderSection order={order} update={update} />
    </div>
  )
}

// Sprint 3s — Designs + designer notes for the layout team. Lives on step 12
// (Saved) so the production handoff has everything it needs at a glance.
// Reuses order.designPreferences (set in step 7) — both surfaces edit the
// same field. Stays editable after contract signing on purpose: production
// info changes do not affect what the customer signed.
function DesignerHandoffSection({ order, update }) {
  const designs = order.designs || []
  const thumb = (url) => {
    if (!url) return url
    if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w400')
    return url
  }
  const cleanId = (rawId) => {
    if (!rawId) return ''
    const m = String(rawId).match(/^local_([A-Z]+)(\d+)\.(?:jpg|jpeg|png|webp)/i)
    if (m) return m[1].toUpperCase() + parseInt(m[2], 10)
    const s = String(rawId)
    return s.length > 10 ? s.slice(0, 10) : s
  }
  const altCount = designs.length - 1
  const footerText = designs.length === 0
    ? null
    : designs.length === 1
      ? 'Primary only'
      : designs.length === 6
        ? '1 primary + 5 alternates (max)'
        : `1 primary + ${altCount} alternate${altCount === 1 ? '' : 's'}`

  return (
    <Section title="Designs for the layout team" eyebrow="Production handoff — editable even after the contract is signed">
      {designs.length === 0 ? (
        <div className="sm-selected-empty">
          No designs picked. Go back to step 7 to add up to 6 designs.
        </div>
      ) : (
        <>
          <div className="sm-handoff-grid">
            {designs.map((d, i) => {
              const s = d.snapshot || {}
              const isPrimary = i === 0
              return (
                <div
                  key={d.id}
                  className={`sm-handoff-card ${isPrimary ? 'primary' : 'alternate'}`}
                >
                  <div className={`sm-selected-role ${isPrimary ? 'primary' : 'alternate'}`}>
                    {isPrimary ? 'PRIMARY' : `Alternate ${i + 1}`}
                  </div>
                  <div className="sm-handoff-thumb">
                    {s.img && <img src={thumb(s.img)} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  </div>
                  <div className="sm-handoff-info">
                    <div className="sm-selected-id">{cleanId(s.id || d.id)}</div>
                    {(s.lastname || s.name) && (
                      <div className="sm-selected-name">{s.lastname || s.name}</div>
                    )}
                    {s.granite_color && (
                      <div className="sm-selected-tags">
                        <span className="sm-modal-tag">{s.granite_color}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="sm-selected-footer">{footerText}</div>
        </>
      )}

      <div className="sm-handoff-notes">
        <div className="sm-handoff-notes-eyebrow">
          Designer notes — describe what the customer wants, which aspects of the designs to emphasize, anything specific for layout
        </div>
        <TextArea
          value={order.designPreferences || ''}
          onChange={v => update({ designPreferences: v })}
          rows={5}
          placeholder="e.g., emphasize the dove from the primary design but use the lettering style from alternate 2…"
        />
      </div>
    </Section>
  )
}

// Sprint 3i — Track deposit + balance payments
function PaymentTrackingSection({ order, update }) {
  // Compute current grand total so we can show balance owed
  const lineItems = buildLineItems(order)
  const subtotalDisc = lineItems.reduce(
    (s, it) => s + (it.code === 'addon-permit' ? 0 : (
      order.pricing?.overrides?.[it.code] != null
        ? Number(order.pricing.overrides[it.code])
        : (it.amount || 0))), 0)
  const subtotalPermit = lineItems.reduce(
    (s, it) => s + (it.code === 'addon-permit' ? (
      order.pricing?.overrides?.[it.code] != null
        ? Number(order.pricing.overrides[it.code])
        : (it.amount || 0)) : 0), 0)
  const customs = (order.pricing?.customLineItems || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const discountPct = Number(order.pricing?.discountPct) || 0
  const discountAmt = (subtotalDisc + customs) * (discountPct / 100)
  const taxBase = (subtotalDisc + customs - discountAmt) + subtotalPermit
  const tax = order.pricing?.applyTax ? taxBase * NJ_TAX_RATE : 0
  const cc  = order.pricing?.applyCCSurcharge ? (taxBase + tax) * CC_SURCHARGE : 0
  const grandTotal = taxBase + tax + cc

  // Sprint M2 Phase 2 — array-driven. payments[] is authoritative; the UI never
  // touches the legacy depositAmount/balanceAmount fields anymore (orderToRow
  // mirrors them from payments[] on write). One row editable at a time.
  const [editingId, setEditingId] = useState(null)

  // Ledger order: oldest first, by createdAt. The !voided filter is inert in
  // Phase 2 (no void UI yet) but correct for Phase 4.
  const visiblePayments = useMemo(
    () => (order.payments || [])
      .filter(p => !p.voided)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    [order.payments]
  )

  const collected = visiblePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, grandTotal - collected)

  const methodLabel = (m) => ({ cash: 'Cash', check: 'Check', card: 'Card', other: 'Other' }[m] || 'Payment')
  const formatPaymentDate = (iso) => {
    if (!iso) return '—'
    const datePart = String(iso).slice(0, 10)  // handles 'YYYY-MM-DD' and full ISO timestamps
    const d = new Date(datePart + 'T00:00:00')
    return isNaN(d) ? datePart : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  // Phase 2 status trigger: simple + one-directional. When the non-voided sum
  // reaches the grand total, flip to 'paid_in_full'. No auto-revert on delete
  // or edit-down (locked decision T6 — Phase 3 makes it fully reactive).
  const statusPatchFor = (payments) => {
    const sum = payments.filter(p => !p.voided).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    return (sum >= grandTotal && order.status !== 'paid_in_full' && order.status !== 'completed')
      ? { status: 'paid_in_full' }
      : {}
  }

  const addPayment = () => {
    const defaultAmount = visiblePayments.length === 0
      ? Math.round(grandTotal * 0.5 * 100) / 100
      : Math.max(0, Math.round((grandTotal - collected) * 100) / 100)
    const newPayment = {
      id: newPaymentId(),
      amount: defaultAmount,
      method: 'check',
      ref: '',
      receivedAt: new Date().toISOString().slice(0, 10),  // YYYY-MM-DD, today
      createdAt: new Date().toISOString(),                // full ISO, ledger-sort key
      createdBy: order.salesRep || null,
      note: null,
      voided: false,
      voidedReason: null,
      voidedAt: null,
      voidedBy: null,
    }
    // Preserve any voided entries that visiblePayments filtered out (none in
    // Phase 2, but written defensively).
    const newPayments = [...(order.payments || []), newPayment]
    update({ payments: newPayments, ...statusPatchFor(newPayments) })
    setEditingId(newPayment.id)  // open it immediately for edit
  }

  const updatePayment = (id, patch) => {
    const newPayments = (order.payments || []).map(p => p.id === id ? { ...p, ...patch } : p)
    update({ payments: newPayments, ...statusPatchFor(newPayments) })
  }

  const deletePayment = (id) => {
    if (!confirm('Remove this payment?')) return
    const newPayments = (order.payments || []).filter(p => p.id !== id)
    // No auto-revert of status on delete in Phase 2 (locked decision T6).
    update({ payments: newPayments })
    if (editingId === id) setEditingId(null)
  }

  return (
    <Section title="Payments" eyebrow={`Grand total $${grandTotal.toFixed(2)} · 50% deposit at signing`}>
      <div className="sm-payment-summary">
        <div className="sm-payment-summary-row">
          <span>Grand total</span>
          <strong>${grandTotal.toFixed(2)}</strong>
        </div>
        <div className="sm-payment-summary-row">
          <span>Collected</span>
          <strong className="sm-payment-collected">${collected.toFixed(2)}</strong>
        </div>
        <div className="sm-payment-summary-row sm-payment-summary-rem">
          <span>Remaining</span>
          <strong>${remaining.toFixed(2)}</strong>
        </div>
      </div>

      <button type="button" className="sm-add-btn" onClick={addPayment} style={{ marginTop: 12 }}>
        + Add payment
      </button>

      {visiblePayments.length === 0 ? (
        <div className="sm-payment-empty">
          No payments recorded yet. Click "Add payment" to record the first one.
        </div>
      ) : (
        <div className="sm-payment-list">
          {visiblePayments.map(payment => (
            editingId === payment.id ? (
              <div key={payment.id} className="sm-payment-row sm-payment-row-editing">
                <div className="sm-grid-2">
                  <Field label="Amount">
                    <TextInput
                      type="number"
                      value={payment.amount}
                      onChange={v => updatePayment(payment.id, { amount: v === '' ? 0 : Number(v) })}
                    />
                  </Field>
                  <Field label="Method">
                    <SelectInput
                      value={payment.method || 'check'}
                      onChange={v => updatePayment(payment.id, { method: v })}
                      options={[
                        { value: 'check', label: 'Check' },
                        { value: 'cash',  label: 'Cash' },
                        { value: 'card',  label: 'Credit / debit card' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                  </Field>
                  <Field label="Reference (check #, last 4, etc.)">
                    <TextInput
                      value={payment.ref || ''}
                      onChange={v => updatePayment(payment.id, { ref: v })}
                      placeholder="check #4421"
                    />
                  </Field>
                  <Field label="Date received">
                    <input
                      type="date"
                      className="sm-textinput"
                      value={(payment.receivedAt || '').slice(0, 10)}
                      onChange={e => updatePayment(payment.id, { receivedAt: e.target.value || null })}
                    />
                  </Field>
                </div>
                <div className="sm-payment-row-actions">
                  <button type="button" className="sm-link-btn" onClick={() => setEditingId(null)}>Done</button>
                </div>
              </div>
            ) : (
              <div key={payment.id} className="sm-payment-row sm-payment-row-collapsed">
                <div className="sm-payment-row-summary">
                  <strong>${(Number(payment.amount) || 0).toFixed(2)}</strong>
                  <span>— {methodLabel(payment.method)}</span>
                  {payment.ref && <span>#{payment.ref}</span>}
                  <span>· {formatPaymentDate(payment.receivedAt)}</span>
                </div>
                <div className="sm-payment-row-actions">
                  <button type="button" className="sm-link-btn" onClick={() => setEditingId(payment.id)}>Edit</button>
                  <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={() => deletePayment(payment.id)}>Remove</button>
                </div>
                <ReceiptActions order={order} payment={payment} />
              </div>
            )
          ))}
        </div>
      )}
    </Section>
  )
}

// Sprint 3j — Receipt action toolbar (Preview / Download / Email / Print).
// Sprint M2 Phase 2: takes a specific payment object (was paymentType).
function ReceiptActions({ order, payment }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewFilename, setPreviewFilename] = useState('')

  const buildDoc = async () => {
    return await generateReceiptPDF(order, payment, { returnDoc: true })
  }

  const handlePreview = async () => {
    setBusy('preview'); setErr(null)
    try {
      const { doc, filename } = await buildDoc()
      const blob = doc.output('blob')
      setPreviewUrl(URL.createObjectURL(blob))
      setPreviewFilename(filename)
    } catch (e) { setErr(e.message || 'Preview failed') } finally { setBusy(null) }
  }
  const handleDownload = async () => {
    setBusy('download'); setErr(null)
    try { const { doc, filename } = await buildDoc(); doc.save(filename) }
    catch (e) { setErr(e.message || 'Download failed') } finally { setBusy(null) }
  }
  const handlePrint = async () => {
    setBusy('print'); setErr(null)
    try {
      const { doc } = await buildDoc()
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank')
      if (w) { setTimeout(() => { try { w.print() } catch {} }, 500) }
    } catch (e) { setErr(e.message || 'Print failed') } finally { setBusy(null) }
  }
  const handleEmail = async () => {
    setBusy('email'); setErr(null)
    try {
      const { doc, filename } = await buildDoc(); doc.save(filename)
      const to = order.customer?.email || ''
      const firstName = order.customer?.firstName || 'there'
      const orderNum = order.orderNumber || 'DRAFT'
      const repName = order.salesRep || 'the Shevchenko team'
      const subject = `Payment receipt — ${orderNum}`
      const body = [
        `Hello ${firstName},`, '',
        `Attached is your payment receipt for order ${orderNum} — file: ${filename}`,
        '',
        `Thank you for your business.`,
        '',
        `— ${repName}`, `Shevchenko Monuments`, `732-442-1286`,
      ].join('\n')
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    } catch (e) { setErr(e.message || 'Email failed') } finally { setBusy(null) }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewFilename('')
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #d4cfc4' }}>
      <div className="sm-helper" style={{ marginBottom: 8 }}>
        <strong>Receipt:</strong> for this payment
      </div>
      <div className="sm-pdf-actions">
        <button type="button" className="sm-btn sm-btn-ghost sm-pdf-btn" onClick={handlePreview} disabled={busy !== null}>
          {busy === 'preview' ? 'Building…' : '👁 Preview'}
        </button>
        <button type="button" className="sm-btn sm-btn-navy sm-pdf-btn" onClick={handleDownload} disabled={busy !== null}>
          {busy === 'download' ? 'Building…' : '📄 Download receipt'}
        </button>
        <button type="button" className="sm-btn sm-btn-ghost sm-pdf-btn" onClick={handlePrint} disabled={busy !== null}>
          {busy === 'print' ? 'Building…' : '🖨 Print'}
        </button>
        <button type="button" className="sm-btn sm-btn-ghost sm-pdf-btn" onClick={handleEmail} disabled={busy !== null}>
          {busy === 'email' ? 'Building…' : '✉️ Email'}
        </button>
      </div>
      {err && <div className="sm-pdf-err">⚠ {err}</div>}

      {previewUrl && (
        <div className="sm-pdf-preview-overlay" onClick={closePreview}>
          <div className="sm-pdf-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="sm-pdf-preview-head">
              <div className="sm-pdf-preview-title">{previewFilename}</div>
              <div className="sm-pdf-preview-actions">
                <button type="button" className="sm-link-btn" onClick={handleDownload}>📄 Download</button>
                <button type="button" className="sm-link-btn" onClick={closePreview}>Close ×</button>
              </div>
            </div>
            <iframe src={previewUrl} className="sm-pdf-preview-frame" title="Receipt preview" />
          </div>
        </div>
      )}
    </div>
  )
}

// Sprint 3k — Archive / cancel / delete actions
// Uses synchronous save with error feedback so silent DB failures
// (missing column, etc.) surface immediately instead of leaving the
// order stuck in its previous status.
function CancelOrderSection({ order, update }) {
  const isCancelled = order.status === 'cancelled'
  const isArchived  = order.status === 'archived'
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  // Save the patch synchronously and surface any DB error.
  // This is the same pattern as SignStep's handleConvert — fixes the
  // "stuck in scoping after cancel" bug.
  const applyAndSave = async (patch, label) => {
    setBusy(label); setErr(null)
    try {
      const next = { ...order, ...patch }
      const result = await saveOrder(next)
      if (!result.ok) {
        const reason = result.error?.message || result.reason || 'unknown error'
        throw new Error(`Database save failed: ${reason}. If a column is missing, run the latest SQL migration in Supabase Studio.`)
      }
      // Mirror to in-memory state
      update(patch)
    } catch (e) {
      setErr(e.message || 'Save failed')
      console.error(`${label} error:`, e)
    } finally {
      setBusy(null)
    }
  }

  const doCancel = async () => {
    if (!order.cancelReason) { alert('Pick a reason'); return }
    await applyAndSave({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    }, 'cancel')
    if (!err) setShowCancelForm(false)
  }

  const doRestore = async () => {
    if (!confirm('Restore this order to draft status?')) return
    await applyAndSave({
      status: 'draft',
      cancelledAt: null,
      cancelReason: null,
      cancelNotes: '',
    }, 'restore')
  }

  const doArchive = async () => {
    if (!confirm(`Archive this order? It'll be hidden from active views but recoverable from the Archive filter on the dashboard.`)) return
    await applyAndSave({
      status: 'archived',
      // Keep cancelledAt/Reason if previously cancelled — the order is now
      // both cancelled AND archived; restoring later puts it back to cancelled.
    }, 'archive')
  }

  const doRestoreFromArchive = async () => {
    if (!confirm('Restore this order from the archive?')) return
    // If it was cancelled before being archived, restore to cancelled. Otherwise to draft.
    const restoreTo = order.cancelledAt ? 'cancelled' : 'draft'
    await applyAndSave({ status: restoreTo }, 'restore')
  }

  const doHardDelete = async () => {
    const ack = prompt(
      'PERMANENTLY DELETE this order? This cannot be undone. Type DELETE to confirm.'
    )
    if (ack !== 'DELETE') return
    setBusy('delete'); setErr(null)
    try {
      const { error } = await supabase.from('orders').delete().eq('id', order.id)
      if (error) throw new Error(error.message)
      // Reload to clear in-memory state and bounce back to dashboard
      window.location.reload()
    } catch (e) {
      setErr(e.message || 'Delete failed')
      console.error('hard delete:', e)
    } finally {
      setBusy(null)
    }
  }

  // ---- Archived view ----
  if (isArchived) {
    return (
      <Section title="Archived" eyebrow="Hidden from active views — recoverable below">
        <div className="sm-cancel-display">
          <div>This order is archived.</div>
          {order.cancelReason && (
            <div className="sm-helper" style={{ marginTop: 6 }}>
              Cancelled before archiving · {CANCEL_REASONS.find(r => r.code === order.cancelReason)?.label}
              {order.cancelNotes && ` · ${order.cancelNotes}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="sm-btn sm-btn-navy" onClick={doRestoreFromArchive} disabled={busy !== null}>
            {busy === 'restore' ? 'Restoring…' : '↩ Restore from archive'}
          </button>
          <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={doHardDelete} disabled={busy !== null}>
            {busy === 'delete' ? 'Deleting…' : '🗑 Permanently delete'}
          </button>
        </div>
        {err && <div className="sm-pdf-err" style={{ marginTop: 10 }}>⚠ {err}</div>}
      </Section>
    )
  }

  // ---- Cancelled view (not yet archived) ----
  if (isCancelled) {
    const reasonLabel = CANCEL_REASONS.find(r => r.code === order.cancelReason)?.label
    return (
      <Section title="Cancelled" eyebrow={order.cancelledAt ? new Date(order.cancelledAt).toLocaleDateString() : ''}>
        <div className="sm-cancel-display">
          <div><strong>Reason:</strong> {reasonLabel || 'Unspecified'}</div>
          {order.cancelNotes && <div className="sm-helper" style={{ marginTop: 6 }}>{order.cancelNotes}</div>}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="sm-link-btn" onClick={doRestore} disabled={busy !== null}>
            {busy === 'restore' ? 'Restoring…' : '↩ Restore order'}
          </button>
          <button type="button" className="sm-link-btn" onClick={doArchive} disabled={busy !== null}>
            {busy === 'archive' ? 'Archiving…' : '📦 Archive'}
          </button>
        </div>
        {err && <div className="sm-pdf-err" style={{ marginTop: 10 }}>⚠ {err}</div>}
      </Section>
    )
  }

  // ---- Default — cancel or archive available ----
  if (!showCancelForm) {
    return (
      <Section title="Archive or cancel" eyebrow="Soft actions — data is kept">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="sm-link-btn" onClick={doArchive} disabled={busy !== null}>
            {busy === 'archive' ? 'Archiving…' : '📦 Archive this order'}
          </button>
          <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={() => setShowCancelForm(true)} disabled={busy !== null}>
            ✗ Cancel this order
          </button>
        </div>
        <div className="sm-helper" style={{ marginTop: 8 }}>
          <strong>Archive</strong> hides the order from active views — useful when it's not active but you don't want to record a cancel reason.<br />
          <strong>Cancel</strong> records a reason for later reporting — went with cemetery direct, family changed mind, etc.
        </div>
        {err && <div className="sm-pdf-err" style={{ marginTop: 10 }}>⚠ {err}</div>}
      </Section>
    )
  }

  // ---- Cancel form ----
  return (
    <Section title="Cancel this order" eyebrow="Pick a reason and confirm">
      <Field label="Reason">
        <SelectInput
          value={order.cancelReason || ''}
          onChange={v => update({ cancelReason: v || null })}
          options={CANCEL_REASONS.map(r => ({ value: r.code, label: r.label }))}
          placeholder="— pick a reason —"
        />
      </Field>
      <Field label="Notes (optional)" wide>
        <TextArea
          value={order.cancelNotes || ''}
          onChange={v => update({ cancelNotes: v })}
          placeholder="Anything that helps for later reporting"
          rows={2}
        />
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" className="sm-btn sm-btn-navy" onClick={doCancel} disabled={busy !== null}>
          {busy === 'cancel' ? 'Cancelling…' : 'Confirm cancel'}
        </button>
        <button type="button" className="sm-link-btn" onClick={() => setShowCancelForm(false)}>
          Don't cancel
        </button>
      </div>
      {err && <div className="sm-pdf-err" style={{ marginTop: 10 }}>⚠ {err}</div>}
    </Section>
  )
}

// Status pills + helper text. Picking a new status updates the order
// (auto-save persists it). Locked orders (signed contracts) can still
// progress forward through production statuses.
function OrderStatusChanger({ order, update }) {
  const current = order.status || 'draft'
  return (
    <>
      <div className="sm-status-pills">
        {ORDER_STATUSES.map(s => {
          const on = s.code === current
          return (
            <button
              key={s.code}
              type="button"
              className={`sm-status-pill ${on ? 'on' : ''}`}
              data-status={s.code}
              onClick={() => update({ status: s.code })}
            >
              {on && '✓ '}{s.label}
            </button>
          )
        })}
      </div>
      <div className="sm-helper" style={{ marginTop: 10 }}>
        {ORDER_STATUSES.find(s => s.code === current)?.blurb || ''}
      </div>
    </>
  )
}

// =============================================================================
// SPRINT 3b — SIGNATURE CANVAS + ESTIMATE → CONTRACT CONVERSION
// =============================================================================

// Drawing pad. Mouse + touch + pen-stylus all work via Pointer Events.
// onChange fires with the latest data URL whenever the user lifts the pen.
function SignatureCanvas({ value, onChange, label, disabled }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const [hasContent, setHasContent] = useState(!!value)

  // Initialize canvas — fill white background, paint existing signature if any
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    // Scale for retina
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.width, rect.height)

    if (value) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        setHasContent(true)
      }
      img.src = value
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e) => {
    if (disabled) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    lastPosRef.current = getPos(e)
  }
  const move = (e) => {
    if (!drawingRef.current || disabled) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.strokeStyle = '#1e2d3d'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPosRef.current = pos
    setHasContent(true)
  }
  const end = (e) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    try { canvasRef.current.releasePointerCapture?.(e.pointerId) } catch {}
    onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setHasContent(false)
    onChange(null)
  }

  return (
    <div className="sm-signature">
      {label && <div className="sm-signature-label">{label}</div>}
      <div className={`sm-signature-pad ${disabled ? 'disabled' : ''}`}>
        <canvas
          ref={canvasRef}
          className="sm-signature-canvas"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!hasContent && (
          <div className="sm-signature-hint">
            {disabled ? '🔒 Locked' : '✎  Sign with your mouse, finger, or stylus'}
          </div>
        )}
      </div>
      {!disabled && (
        <div className="sm-signature-actions">
          <button type="button" className="sm-link-btn" onClick={clear}>
            Clear
          </button>
          {hasContent && <span className="sm-signature-ok">✓ Captured</span>}
        </div>
      )}
    </div>
  )
}

// Sprint 3v Part B — modal wrapper around SignatureCanvas. The customer taps
// the signature box, this opens, they draw, "Save signature" commits the data
// URL back to the order. Backdrop click cancels.
function SignatureModal({ open, onSave, onCancel }) {
  const [draft, setDraft] = useState(null)
  // Reset the draft each time the modal opens so a fresh canvas starts blank.
  useEffect(() => {
    if (open) setDraft(null)
  }, [open])
  if (!open) return null
  return (
    <div className="sm-pdf-preview-overlay" onClick={onCancel}>
      <div className="sm-signature-modal" onClick={e => e.stopPropagation()}>
        <div className="sm-pdf-preview-head">
          <div className="sm-pdf-preview-title">Customer signature</div>
        </div>
        <div style={{ padding: 18 }}>
          <SignatureCanvas value={null} onChange={setDraft} label="Sign below" />
          <div className="sm-signature-modal-actions">
            <button type="button" className="sm-link-btn" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="sm-btn sm-btn-navy"
              onClick={() => onSave(draft)}
              disabled={!draft}
            >Save signature</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Sprint 3v Part B — customer signature surface. Empty → a "Tap to sign" box
// that opens SignatureModal. Filled → the signature image with a Clear button.
// Returns null when locked (the locked view leans on the contract preview
// iframe instead — see the rationale comment in SignStep).
function CustomerSignatureBox({ value, onChange, locked }) {
  const [modalOpen, setModalOpen] = useState(false)
  if (locked) return null
  if (value) {
    return (
      <div className="sm-sigbox-filled">
        <img src={value} alt="Customer signature" />
        {/* Pre-conversion Clear is just "oops, redo" — no warning needed. The
            warning is for the post-conversion Unlock flow in Part C. */}
        <button
          type="button"
          className="sm-sigbox-clear-btn"
          onClick={() => onChange(null)}
        >✕ Clear</button>
      </div>
    )
  }
  return (
    <>
      <button
        type="button"
        className="sm-sigbox-empty"
        onClick={() => setModalOpen(true)}
      >
        <span className="sm-sigbox-prompt">✎ Tap to sign</span>
      </button>
      <SignatureModal
        open={modalOpen}
        onSave={(dataUrl) => { onChange(dataUrl); setModalOpen(false) }}
        onCancel={() => setModalOpen(false)}
      />
    </>
  )
}

// Sprint 3v Part C — confirmation modal for unlocking a signed contract.
// Unlock is destructive (voids the customer's signature), so unlike the
// pre-conversion Clear button it requires explicit confirmation.
function UnlockConfirmModal({ open, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="sm-pdf-preview-overlay" onClick={onCancel}>
      <div className="sm-unlock-modal" onClick={e => e.stopPropagation()}>
        <h2 className="sm-unlock-modal-title">Unlock this signed contract?</h2>
        <p className="sm-unlock-modal-body">
          This will void the customer's signature and require a new signature
          when ready. This action cannot be undone.
        </p>
        <div className="sm-unlock-modal-actions">
          <button type="button" className="sm-link-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="sm-unlock-modal-confirm" onClick={onConfirm}>
            Yes, Unlock
          </button>
        </div>
      </div>
    </div>
  )
}

// New wizard step — captures signatures and converts Estimate → Contract.
// Shows lock-banner if order is already in CONTRACT state.
function SignStep({ order, update }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewErr, setPreviewErr] = useState(null)
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)

  const isLocked = !!(order.signedAt || order.pricingLockedAt)
  const customerSig = order.customerSignature || order.customerSignatureUrl
  const repSig = order.repSignature || order.repSignatureUrl
  const ready = customerSig && repSig && !isLocked

  // Sprint 3v Part A — inline contract preview. Reuses generateContractPDF
  // (forces mode:'contract'), so the preview is the exact contract layout —
  // single source of truth, no duplicated rendering. Regenerates only when the
  // lock state flips, so the locked view picks up the embedded signatures.
  // NOT regenerated on every signature stroke — PDF generation is expensive.
  useEffect(() => {
    let cancelled = false
    let createdUrl = null
    setPreviewErr(null)
    generateContractPDF(order, { returnDoc: true })
      .then(({ doc }) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(doc.output('blob'))
        setPreviewUrl(createdUrl)
      })
      .catch(e => {
        if (cancelled) return
        setPreviewErr(e.message || 'Contract preview failed to render')
      })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [isLocked])  // eslint-disable-line react-hooks/exhaustive-deps

  const updateSig = (which, dataUrl) => {
    if (which === 'customer') update({ customerSignature: dataUrl })
    else update({ repSignature: dataUrl })
  }

  const handleConvert = async () => {
    if (!ready) return
    setBusy(true)
    setErr(null)
    try {
      // Upload both signatures (only the new ones — skip if already URL'd)
      let custUp = { url: order.customerSignatureUrl, path: order.customerSignaturePath }
      if (order.customerSignature) {
        custUp = await uploadSignature(order.customerSignature, 'customer', order.id)
      }
      let repUp = { url: order.repSignatureUrl, path: order.repSignaturePath }
      if (order.repSignature) {
        repUp = await uploadSignature(order.repSignature, 'rep', order.id)
      }
      const now = new Date().toISOString()

      // Build the contracted-state order
      const contractedOrder = {
        ...order,
        status: 'contracted',
        customerSignature: null,
        repSignature: null,
        customerSignatureUrl: custUp.url,
        customerSignaturePath: custUp.path,
        repSignatureUrl: repUp.url,
        repSignaturePath: repUp.path,
        signedAt: now,
        pricingLockedAt: now,
      }

      // Save synchronously and surface any DB errors immediately —
      // this prevents the silent-failure case where a missing column
      // causes the auto-save to reject and the status reverts on reload.
      const result = await saveOrder(contractedOrder)
      if (!result.ok) {
        const reason = result.error?.message || result.reason || 'unknown error'
        throw new Error(
          `Database save failed: ${reason}. ` +
          `If this mentions a missing column, run the latest SQL migration in Supabase Studio.`
        )
      }

      // Mirror to in-memory state
      update({
        status: 'contracted',
        customerSignature: null,
        repSignature: null,
        customerSignatureUrl: custUp.url,
        customerSignaturePath: custUp.path,
        repSignatureUrl: repUp.url,
        repSignaturePath: repUp.path,
        signedAt: now,
        pricingLockedAt: now,
      })
    } catch (e) {
      setErr(e.message || 'Conversion failed')
      console.error('Convert error:', e)
    } finally {
      setBusy(false)
    }
  }

  // Sprint 3v Part C — unlock a signed contract back to draft. Voids both
  // signatures and stamps the order notes for audit. Only camelCase fields are
  // nulled — the in-memory order is camelCase; toOrderRow maps to snake_case
  // columns on save.
  // Storage files preserved on unlock — only DB references nulled. Audit recovery possible if needed.
  const handleUnlock = () => {
    update({
      customerSignature: null,
      repSignature: null,
      customerSignatureUrl: null,
      customerSignaturePath: null,
      repSignatureUrl: null,
      repSignaturePath: null,
      signedAt: null,
      pricingLockedAt: null,
      status: 'draft',
      notes: (order.notes || '') + (order.notes ? '\n\n' : '') + `[CONTRACT UNLOCKED by ${order.salesRep || 'staff'} on ${new Date().toLocaleString()}: prior signature voided.]`,
    })
    setUnlockModalOpen(false)
  }

  return (
    <div className="sm-step">
      <div className="sm-step-head">
        <div className="sm-step-eyebrow">Step · Sign &amp; convert</div>
        <h1 className="sm-step-title">Make it a contract</h1>
        <p className="sm-step-lede">
          Capture both signatures here. When you click "Convert to Contract",
          the pricing locks and this estimate becomes a binding agreement.
        </p>
      </div>

      {isLocked && (
        <div className="sm-locked-banner">
          🔒 <strong>This order is now a CONTRACT.</strong>{' '}
          {order.signedAt && <>Signed {new Date(order.signedAt).toLocaleString()}.</>}{' '}
          Pricing is locked.
        </div>
      )}

      <Section title="Contract preview" eyebrow="Customer should review before signing">
        {previewErr ? (
          <div className="sm-pdf-err">⚠ {previewErr}</div>
        ) : previewUrl ? (
          <iframe
            src={previewUrl}
            className="sm-pdf-preview-frame"
            title="Contract preview"
            style={{ minHeight: 850, width: '100%', borderRadius: 6 }}
          />
        ) : (
          <div className="sm-helper">Building contract preview…</div>
        )}
      </Section>

      {/* Sign section hidden when locked — the iframe preview above shows the signed contract
          with both signatures inline. Avoiding duplicate signature UI in the locked view. */}
      {!isLocked && (
        <Section title="Shevchenko Monuments representative" eyebrow="Required">
          <SignatureCanvas
            value={order.repSignature || order.repSignatureUrl}
            onChange={(d) => updateSig('rep', d)}
            label={order.salesRep || 'Sales representative'}
            disabled={isLocked}
          />
        </Section>
      )}

      {/* Sign section hidden when locked — the iframe preview above shows the signed contract
          with both signatures inline. Avoiding duplicate signature UI in the locked view. */}
      {!isLocked && (
        <Section title="Customer signature" eyebrow="Required">
          <CustomerSignatureBox
            value={order.customerSignature}
            onChange={(v) => update({ customerSignature: v })}
            locked={isLocked}
          />
        </Section>
      )}

      {!isLocked && (
        <Section title="Convert to Contract" eyebrow="Locks pricing — final, binding">
          <button
            type="button"
            className="sm-btn sm-btn-navy sm-convert-btn"
            onClick={handleConvert}
            disabled={!ready || busy}
          >
            {busy ? 'Converting…' : '🔒 Convert to Contract'}
          </button>
          {!ready && !busy && (
            <div className="sm-helper" style={{ marginTop: 10 }}>
              Both signatures required before converting.
            </div>
          )}
          {err && <div className="sm-pdf-err">⚠ {err}</div>}
        </Section>
      )}

      {isLocked && (
        <Section title="Download contract PDF" eyebrow="Print or email">
          <PdfDownloadButton order={order} label="Download Contract PDF" />
        </Section>
      )}

      {isLocked && (
        <Section title="Unlock & Edit" eyebrow="Staff only — need to make changes?">
          <button
            type="button"
            className="sm-unlock-btn"
            onClick={() => setUnlockModalOpen(true)}
          >
            🔓 Unlock &amp; Edit
          </button>
          <div className="sm-helper" style={{ marginTop: 10 }}>
            Unlocking voids the customer's signature and returns this order to
            draft so changes can be made. The contract must be re-signed afterward.
          </div>
        </Section>
      )}

      <UnlockConfirmModal
        open={unlockModalOpen}
        onConfirm={handleUnlock}
        onCancel={() => setUnlockModalOpen(false)}
      />
    </div>
  )
}

// =============================================================================
// STYLES — design tokens match App.jsx (cream/navy/brass; Playfair + Lato)
// =============================================================================

const styles = `
.sm-root {
  position: fixed; inset: 0;
  background: var(--cream, #faf8f4);
  display: flex; flex-direction: column;
  font-family: var(--font-b, 'Lato'), 'Helvetica Neue', sans-serif;
  color: var(--text, #2a2a2a);
  z-index: 1000;
  --sm-gold: var(--accent, #8c6d3f);
  --sm-gold-light: var(--accent-light, #b8935a);
  --sm-gold-pale: var(--accent-pale, #f5ede0);
  --sm-navy: var(--navy, #1e2d3d);
  --sm-cream: var(--cream, #faf8f4);
  --sm-cream-mid: var(--cream-mid, #e8e4dc);
  --sm-border: var(--border, #e0dbd2);
  --sm-border-dark: var(--border-dark, #cdc8be);
}

.sm-loading {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-d, 'Playfair Display'), Georgia, serif;
  font-size: 22px; color: var(--text-light, #888); letter-spacing: 0.04em;
}

/* ---- HEADER ---------------------------------------------------------------- */
.sm-header {
  display: grid;
  grid-template-columns: minmax(0,1fr) auto minmax(0,1fr);
  align-items: center;
  padding: 20px 32px;
  background: #fff;
  border-bottom: 1px solid var(--sm-border);
  gap: 24px;
  position: relative;
}
.sm-header::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--sm-gold) 30%, var(--sm-gold) 70%, transparent 100%);
  opacity: 0.35;
}

.sm-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.sm-brand-mark {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--sm-navy); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-d, 'Playfair Display'), serif; font-size: 22px; font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 6px rgba(30,45,61,0.18), inset 0 0 0 1px rgba(184,147,90,0.4);
}
.sm-brand-text { display: flex; flex-direction: column; min-width: 0; }
.sm-brand-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.18em;
  color: var(--sm-gold); text-transform: uppercase;
}
.sm-brand-title {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 22px; font-weight: 500; color: var(--sm-navy);
  letter-spacing: 0.005em;
}

/* ---- PROGRESS -------------------------------------------------------------- */
.sm-progress { display: flex; align-items: center; gap: 0; justify-content: center; }
.sm-progress-step {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  padding: 4px 16px; position: relative;
  font: inherit; color: var(--text-light, #888);
  transition: color 0.2s;
}
.sm-progress-step:hover { color: var(--sm-navy); }
.sm-progress-step + .sm-progress-step::before {
  content: ''; position: absolute; left: -8px; top: 14px;
  width: 16px; height: 1px; background: var(--sm-border-dark);
}
.sm-progress-step.done + .sm-progress-step::before,
.sm-progress-step.on + .sm-progress-step::before {
  background: var(--sm-gold-light);
}
.sm-progress-dot {
  width: 28px; height: 28px; border-radius: 50%;
  border: 1.5px solid var(--sm-border-dark);
  background: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  transition: all 0.2s;
}
.sm-progress-step.on .sm-progress-dot {
  background: var(--sm-navy); color: #fff; border-color: var(--sm-navy);
  box-shadow: 0 0 0 4px rgba(30,45,61,0.08);
}
.sm-progress-step.done .sm-progress-dot {
  background: var(--sm-gold); color: #fff; border-color: var(--sm-gold);
}
.sm-progress-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase;
}
.sm-progress-step.on .sm-progress-label { color: var(--sm-navy); }
.sm-progress-step.done .sm-progress-label { color: var(--sm-gold); }

/* ---- HEADER RIGHT ---------------------------------------------------------- */
.sm-header-right {
  display: flex; align-items: center; gap: 14px; justify-content: flex-end;
}
.sm-save-status {
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  color: var(--text-light, #888);
  font-variant-numeric: tabular-nums;
  min-width: 110px; text-align: right;
}
.sm-save-status[data-status='saving'] { color: var(--sm-gold); }
.sm-save-status[data-status='saved']  { color: #2d8659; }
.sm-save-status[data-status='error']  { color: #b3261e; }

.sm-mode-toggle {
  display: inline-flex; padding: 3px;
  background: var(--sm-cream-mid); border-radius: 999px;
  border: 1px solid var(--sm-border);
}
.sm-mode-toggle button {
  border: none; background: transparent; cursor: pointer;
  padding: 6px 14px; border-radius: 999px;
  font: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-mid, #555);
  transition: all 0.18s;
}
.sm-mode-toggle button.on {
  background: #fff; color: var(--sm-navy);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px var(--sm-border);
}
.sm-mode-toggle button:not(.on):hover { color: var(--sm-navy); }

.sm-close {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid var(--sm-border); background: #fff;
  font-size: 22px; line-height: 1; color: var(--text-mid, #555);
  cursor: pointer; transition: all 0.18s;
}
.sm-close:hover { background: var(--sm-cream-mid); color: var(--sm-navy); }

/* ---- BODY LAYOUT ----------------------------------------------------------- */
.sm-body {
  flex: 1; overflow-y: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0;
  padding: 32px 32px 100px;
  position: relative;
}
.sm-mode-customer .sm-body { grid-template-columns: 1fr; }

.sm-body::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 20% 10%, rgba(140,109,63,0.025) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(30,45,61,0.02) 0%, transparent 40%);
  pointer-events: none;
}
.sm-step, .sm-staff-aside { position: relative; z-index: 1; }

.sm-step { max-width: 880px; margin: 0 auto; width: 100%; }

/* ---- STEP HEADERS ---------------------------------------------------------- */
.sm-step-head { margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid var(--sm-border); }
.sm-step-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.22em;
  color: var(--sm-gold); text-transform: uppercase;
  margin-bottom: 10px;
}
.sm-step-title {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 44px; font-weight: 400; line-height: 1.1; color: var(--sm-navy);
  margin: 0 0 12px; letter-spacing: -0.01em;
}
.sm-step-lede {
  font-size: 16px; line-height: 1.55; color: var(--text-mid, #555);
  margin: 0; max-width: 620px;
}
.sm-step-lede em { font-style: italic; color: var(--sm-navy); }

/* ---- SECTIONS -------------------------------------------------------------- */
.sm-section {
  background: #fff; border: 1px solid var(--sm-border); border-radius: 4px;
  padding: 28px 32px; margin-bottom: 20px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.sm-section-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 20px;
}
.sm-section-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.18em;
  color: var(--sm-gold); text-transform: uppercase; margin-bottom: 4px;
}
.sm-section-title {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 22px; font-weight: 500; color: var(--sm-navy);
}
.sm-section-body { display: flex; flex-direction: column; gap: 16px; }

.sm-divider { height: 1px; background: var(--sm-border); margin: 8px 0; }

/* ---- CARD GRID ------------------------------------------------------------- */
.sm-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.sm-card-grid-services { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.sm-card {
  position: relative;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
  padding: 18px 20px;
  background: #fff; border: 1.5px solid var(--sm-border); border-radius: 4px;
  cursor: pointer; text-align: left; font: inherit; color: inherit;
  transition: all 0.2s; min-height: 110px;
}
.sm-card:hover {
  border-color: var(--sm-gold-light); background: var(--sm-gold-pale);
  transform: translateY(-1px);
}
.sm-card.on {
  border-color: var(--sm-navy);
  background: linear-gradient(135deg, #fff 0%, var(--sm-gold-pale) 100%);
  box-shadow: 0 2px 8px rgba(30,45,61,0.1);
}
.sm-card-icon { font-size: 24px; line-height: 1; }
.sm-card-title {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 17px; font-weight: 500; color: var(--sm-navy);
}
.sm-card-blurb { font-size: 13px; line-height: 1.45; color: var(--text-mid, #555); }
.sm-card-check {
  position: absolute; top: 12px; right: 12px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--sm-gold); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
}
.sm-card-badge {
  position: absolute; top: 10px; right: 10px;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--sm-gold);
  background: var(--sm-gold-pale); padding: 3px 8px; border-radius: 999px;
}

/* ---- CHIPS ----------------------------------------------------------------- */
.sm-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.sm-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: #fff; border: 1.5px solid var(--sm-border);
  border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 14px; color: var(--text-mid, #555);
  transition: all 0.18s;
}
.sm-chip:hover { border-color: var(--sm-gold-light); color: var(--sm-navy); }
.sm-chip.on { background: var(--sm-navy); color: #fff; border-color: var(--sm-navy); }
.sm-chip-mark { font-size: 11px; opacity: 0.6; }
.sm-chip.on .sm-chip-mark { opacity: 1; }
.sm-chip-label { font-weight: 500; }

/* ---- HELPER TEXT ----------------------------------------------------------- */
.sm-helper {
  font-size: 13px; line-height: 1.5; color: var(--text-mid, #555);
  font-style: italic;
}
.sm-helper-strong {
  font-style: normal; color: var(--sm-navy); font-weight: 500;
  padding: 10px 14px; background: var(--sm-gold-pale);
  border-radius: 3px; border-left: 3px solid var(--sm-gold);
}

/* ---- FIELDS ---------------------------------------------------------------- */
.sm-field { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.sm-field-wide { grid-column: 1 / -1; }
.sm-field-lab {
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-mid, #555);
}
.sm-field-req { color: var(--sm-gold); margin-left: 4px; }
.sm-field-hint {
  font-size: 12px; color: var(--text-light, #888); font-style: italic;
}

.sm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 720px) {
  .sm-grid-2, .sm-grid-3 { grid-template-columns: 1fr; }
}

/* ---- INPUTS ---------------------------------------------------------------- */
.sm-text-input, .sm-textarea, .sm-select {
  font: inherit; font-size: 15px; padding: 11px 14px;
  border: 1.5px solid var(--sm-border);
  background: #fff; color: var(--text);
  border-radius: 3px;
  transition: border-color 0.18s, box-shadow 0.18s;
  width: 100%; box-sizing: border-box;
  font-family: var(--font-b, 'Lato'), sans-serif;
}
.sm-text-input:focus, .sm-textarea:focus, .sm-select:focus {
  outline: none; border-color: var(--sm-gold);
  box-shadow: 0 0 0 3px rgba(140,109,63,0.12);
}
.sm-text-input::placeholder, .sm-textarea::placeholder {
  color: #b8b3a8; font-style: italic;
}
.sm-text-input:disabled, .sm-textarea:disabled {
  background: var(--sm-cream-mid); color: var(--text-light); cursor: not-allowed;
}
.sm-textarea { resize: vertical; min-height: 60px; line-height: 1.5; }

.sm-select-wrap { position: relative; }
.sm-select { appearance: none; -webkit-appearance: none; padding-right: 36px; background: #fff; }
.sm-select-chev {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  pointer-events: none; color: var(--text-light, #888); font-size: 12px;
}

/* ---- SEARCH ---------------------------------------------------------------- */
.sm-search { position: relative; }
.sm-search-input { padding-left: 38px; }
.sm-search-icon {
  position: absolute; left: 14px; top: 12px;
  font-size: 16px; color: var(--text-light, #888);
}
.sm-search-pop {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  background: #fff; border: 1px solid var(--sm-border-dark);
  border-radius: 3px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  z-index: 100; max-height: 320px; overflow-y: auto;
}
.sm-search-row {
  display: block; width: 100%; text-align: left;
  padding: 12px 16px; border: none; background: none; cursor: pointer;
  font: inherit; color: inherit;
  border-bottom: 1px solid var(--sm-border);
}
.sm-search-row:last-child { border-bottom: none; }
.sm-search-row.sm-search-result:hover { background: var(--sm-gold-pale); }
.sm-search-loading, .sm-search-empty {
  font-style: italic; color: var(--text-light, #888); cursor: default;
}
.sm-result-line1 {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 15px; color: var(--sm-navy); font-weight: 500;
}
.sm-result-line2 { font-size: 12px; color: var(--text-mid, #555); margin-top: 2px; }

.sm-existing-banner {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; gap: 12px;
  background: var(--sm-gold-pale);
  border: 1px solid var(--sm-gold-light);
  border-radius: 3px; font-size: 14px;
}

.sm-link-btn {
  background: none; border: none; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 600;
  color: var(--sm-gold);
  text-decoration: underline; text-underline-offset: 3px;
  padding: 0; transition: color 0.18s;
}
.sm-link-btn:hover { color: var(--sm-navy); }
.sm-link-btn-danger { color: #b3261e; }
.sm-link-btn-danger:hover { color: #861a14; }

/* ---- BUTTONS --------------------------------------------------------------- */
.sm-btn {
  font: inherit; font-size: 14px; font-weight: 700; letter-spacing: 0.06em;
  padding: 12px 24px; border-radius: 3px; cursor: pointer;
  transition: all 0.18s;
  display: inline-flex; align-items: center; gap: 8px;
}
.sm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.sm-btn-gold {
  background: var(--sm-gold); color: #fff;
  border: 1.5px solid var(--sm-gold);
  box-shadow: 0 2px 6px rgba(140,109,63,0.25);
}
.sm-btn-gold:hover:not(:disabled) {
  background: var(--sm-gold-light); border-color: var(--sm-gold-light);
  transform: translateY(-1px);
}
.sm-btn-navy {
  background: var(--sm-navy); color: #fff; border: 1.5px solid var(--sm-navy);
}
.sm-btn-navy:hover:not(:disabled) {
  background: var(--navy-mid, #2c3e50); border-color: var(--navy-mid, #2c3e50);
}
.sm-btn-ghost {
  background: transparent; color: var(--text-mid, #555);
  border: 1.5px solid var(--sm-border);
}
.sm-btn-ghost:hover:not(:disabled) {
  background: #fff; color: var(--sm-navy); border-color: var(--sm-border-dark);
}

.sm-add-btn {
  display: block; width: 100%;
  padding: 18px;
  background: transparent; border: 2px dashed var(--sm-border-dark);
  border-radius: 4px; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 600;
  color: var(--text-mid, #555);
  transition: all 0.18s;
  margin-bottom: 20px;
}
.sm-add-btn:hover {
  background: var(--sm-gold-pale); border-color: var(--sm-gold);
  color: var(--sm-navy);
}

/* ---- MAP HELPERS ----------------------------------------------------------- */
.sm-map-help {
  font-size: 13px; line-height: 1.55; color: var(--text-mid, #555);
  padding: 12px 14px;
  background: var(--sm-cream-mid); border-radius: 3px;
  border-left: 3px solid var(--sm-gold-light);
}
.sm-map-preview {
  margin-top: 8px; border-radius: 4px; overflow: hidden;
  border: 1px solid var(--sm-border); height: 320px;
}
.sm-map-preview iframe { width: 100%; height: 100%; border: 0; display: block; }

/* ---- DECEASED CARDS -------------------------------------------------------- */
.sm-deceased-card {
  background: #fff; border: 1px solid var(--sm-border); border-radius: 4px;
  padding: 24px 28px; margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
  display: flex; flex-direction: column; gap: 16px;
  position: relative;
}
.sm-deceased-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--sm-gold-light);
  border-radius: 4px 0 0 4px;
}
.sm-deceased-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 12px; border-bottom: 1px solid var(--sm-border);
}
.sm-deceased-num {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 18px; color: var(--sm-navy); font-weight: 500;
}
.sm-deceased-actions { display: flex; align-items: center; gap: 14px; }

/* ---- TITLE BUILDER (3-part: prefix + relation + final) -------------------- */
.sm-title-builder {
  background: var(--sm-cream);
  border: 1px solid var(--sm-border);
  border-radius: 4px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sm-title-builder-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--sm-gold);
}
.sm-title-builder-hint {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text-light);
  font-style: italic;
  font-size: 11px;
  margin-left: 6px;
}

/* ---- RESERVED-SPACE CARD VARIANT ------------------------------------------ */
.sm-deceased-card-reserved {
  background: var(--sm-gold-pale);
  border-style: dashed;
  border-color: var(--sm-gold-light);
}
.sm-deceased-card-reserved::before {
  background: var(--sm-gold-light);
  opacity: 0.5;
}
.sm-reserved-icon {
  display: inline-block;
  margin-right: 6px;
  color: var(--sm-gold);
  font-size: 18px;
  vertical-align: -2px;
}
.sm-deceased-num-sub {
  font-family: var(--font-b), sans-serif;
  font-size: 13px;
  font-style: italic;
  color: var(--text-light);
  font-weight: 400;
}

/* ---- ADD-ROW (two add buttons side by side) ------------------------------- */
.sm-add-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}
.sm-add-row .sm-add-btn { margin-bottom: 0; }
.sm-add-btn-secondary {
  background: var(--sm-cream-mid);
  border-style: dashed;
  color: var(--text-mid);
}
.sm-add-btn-secondary:hover {
  background: var(--sm-gold-pale);
  border-color: var(--sm-gold);
  color: var(--sm-gold);
}
@media (max-width: 720px) {
  .sm-add-row { grid-template-columns: 1fr; }
}

/* ---- OTHER service description box ---------------------------------------- */
.sm-other-box {
  margin-top: 16px;
  padding: 16px 18px;
  background: var(--sm-gold-pale);
  border: 1px solid var(--sm-gold-light);
  border-radius: 4px;
}

/* ---- STAFF NOTES ASIDE ----------------------------------------------------- */
.sm-staff-aside {
  width: 320px; flex-shrink: 0;
  margin-left: 28px;
  position: sticky; top: 0;
}
.sm-staff-toggle {
  background: #fff; border: 1px solid var(--sm-border);
  border-radius: 3px; padding: 12px 14px; width: 100%;
  font: inherit; font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--sm-navy); cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  transition: all 0.18s;
}
.sm-staff-toggle:hover { background: var(--sm-cream-mid); }
.sm-staff-toggle-count {
  margin-left: auto;
  background: var(--sm-gold); color: #fff;
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  letter-spacing: 0;
}

.sm-staff-notes {
  margin-top: 8px;
  background: #fff; border: 1px solid var(--sm-border); border-radius: 3px;
  padding: 16px;
  display: flex; flex-direction: column; gap: 14px;
}
.sm-staff-notes-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 10px; border-bottom: 1px solid var(--sm-border);
}
.sm-staff-notes-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--sm-gold);
}
.sm-staff-notes-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-light);
  padding: 2px 7px; border: 1px solid var(--sm-border-dark); border-radius: 999px;
}
.sm-staff-notes-empty {
  font-size: 13px; line-height: 1.5; color: var(--text-light, #888);
  font-style: italic;
}
.sm-staff-notes-list {
  display: flex; flex-direction: column; gap: 10px;
  max-height: 280px; overflow-y: auto;
}
.sm-staff-note {
  padding: 10px 12px;
  background: var(--sm-cream-mid); border-radius: 3px;
  border-left: 2px solid var(--sm-gold);
}
.sm-staff-note-meta {
  font-size: 11px; color: var(--text-light); margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}
.sm-staff-note-meta strong { color: var(--sm-navy); font-weight: 700; }
.sm-staff-note-text {
  font-size: 13px; line-height: 1.5; color: var(--text); white-space: pre-wrap;
}
.sm-staff-notes-input {
  display: flex; flex-direction: column; gap: 8px;
  padding-top: 10px; border-top: 1px solid var(--sm-border);
}

.sm-mode-customer .sm-staff-aside { display: none; }

/* ---- FOOTER ---------------------------------------------------------------- */
.sm-footer {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: 16px;
  padding: 16px 32px;
  background: #fff;
  border-top: 1px solid var(--sm-border);
  z-index: 10;
}
.sm-footer-summary {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
}
.sm-pill {
  font-size: 12px; padding: 4px 10px;
  background: var(--sm-cream-mid);
  border-radius: 999px; color: var(--text-mid);
  border: 1px solid var(--sm-border);
  font-family: var(--font-b);
}
.sm-pill strong {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-weight: 500; color: var(--sm-navy);
  letter-spacing: 0.04em;
}

/* ---- RESUME SCREEN --------------------------------------------------------- */
.sm-resume {
  flex: 1; display: flex; align-items: flex-start; justify-content: center;
  padding: 80px 32px 60px;
  overflow-y: auto;
  background:
    radial-gradient(circle at 30% 20%, rgba(140,109,63,0.04) 0%, transparent 40%),
    radial-gradient(circle at 80% 80%, rgba(30,45,61,0.03) 0%, transparent 40%),
    var(--sm-cream);
}
.sm-resume-inner {
  max-width: 640px; width: 100%;
  display: flex; flex-direction: column; gap: 20px;
}
.sm-resume-head { text-align: center; margin-bottom: 24px; }
.sm-resume-head .sm-step-title { font-size: 52px; }
.sm-resume-head .sm-step-eyebrow { display: block; }
.sm-resume-head .sm-step-lede { margin: 0 auto; }

.sm-resume-newcard {
  display: flex; align-items: center; gap: 18px;
  padding: 26px 32px;
  background: linear-gradient(135deg, var(--sm-navy) 0%, #2c3e50 100%);
  border: none; border-radius: 4px;
  cursor: pointer; text-align: left; color: #fff;
  font: inherit;
  box-shadow: 0 4px 14px rgba(30,45,61,0.18);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative; overflow: hidden;
}
.sm-resume-newcard::before {
  content: ''; position: absolute; top: 0; right: 0; width: 100px; height: 100%;
  background: linear-gradient(90deg, transparent 0%, rgba(184,147,90,0.2) 100%);
  pointer-events: none;
}
.sm-resume-newcard:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(30,45,61,0.25);
}
.sm-resume-newcard-icon {
  width: 48px; height: 48px; flex-shrink: 0;
  background: var(--sm-gold); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; line-height: 1; font-weight: 300;
}
.sm-resume-newcard-title {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 22px; font-weight: 500; margin-bottom: 2px;
}
.sm-resume-newcard-blurb { font-size: 13px; opacity: 0.78; }

.sm-resume-divider {
  display: flex; align-items: center; gap: 16px; margin: 12px 0;
}
.sm-resume-divider::before, .sm-resume-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--sm-border);
}
.sm-resume-divider span {
  font-size: 11px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--text-light, #888);
}

.sm-resume-list { display: flex; flex-direction: column; gap: 8px; }
.sm-resume-row {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  padding: 16px 20px;
  background: #fff; border: 1px solid var(--sm-border);
  border-radius: 4px; cursor: pointer; text-align: left;
  font: inherit; color: inherit;
  transition: all 0.18s;
}
.sm-resume-row:hover {
  border-color: var(--sm-gold-light); background: var(--sm-gold-pale);
  transform: translateX(2px);
}
.sm-resume-row-main { flex: 1; min-width: 0; }
.sm-resume-row-num {
  font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--sm-gold); margin-bottom: 2px;
}
.sm-resume-row-name {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 18px; font-weight: 500; color: var(--sm-navy);
  margin-bottom: 4px;
}
.sm-resume-row-meta {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-size: 12px; color: var(--text-mid, #555);
}
.sm-resume-row-status {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 5px 10px; border-radius: 999px;
  white-space: nowrap; flex-shrink: 0;
  background: var(--sm-cream-mid); color: var(--text-mid);
}
.sm-resume-row-status[data-status='draft']    { background: #f0ede6; color: #6b6258; }
.sm-resume-row-status[data-status='scoping']  { background: #fff3dc; color: #8a6d20; }
.sm-resume-row-status[data-status='quoted']   { background: #e3edf5; color: #2a5078; }
.sm-resume-row-status[data-status='contracted']    { background: #e3f1e6; color: #2d6b3e; }
.sm-resume-row-status[data-status='in_production'] { background: #ede3f5; color: #4a2d78; }
.sm-resume-row-status[data-status='installed']     { background: #1e2d3d; color: #fff; }

.sm-resume-back {
  align-self: center; margin-top: 12px;
  background: none; border: none; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--text-light, #888);
  padding: 8px 16px;
  transition: color 0.18s;
}
.sm-resume-back:hover { color: var(--sm-navy); }

/* ---- SUMMARY (continue-later view) ---------------------------------------- */
.sm-summary {
  background: #fff; border: 1px solid var(--sm-border); border-radius: 4px;
  padding: 28px 32px; margin-bottom: 24px;
}
.sm-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 24px;
}
.sm-summary-lab {
  font-size: 10px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--sm-gold); margin-bottom: 6px;
}
.sm-summary-val {
  font-family: var(--font-d, 'Playfair Display'), serif;
  font-size: 17px; color: var(--sm-navy); line-height: 1.35;
}

.sm-future {
  background: var(--sm-gold-pale);
  border: 1px solid var(--sm-gold-light); border-radius: 4px;
  padding: 24px 28px;
}
.sm-future-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--sm-gold); margin-bottom: 10px;
}
.sm-future ul {
  margin: 0; padding-left: 18px; color: var(--text-mid);
  font-size: 14px; line-height: 1.7;
}
.sm-future ul li::marker { color: var(--sm-gold-light); }

.sm-existing-meta { color: var(--text-mid); font-size: 13px; }

/* ---- DIM ROW (shape size pickers) ----------------------------------------- */
.sm-dim-row { display: flex; gap: 8px; align-items: stretch; }
.sm-dim-row .sm-select-wrap { flex: 1; }
.sm-dim-row .sm-text-input { flex: 1; }

/* ---- SHAPE GRID ----------------------------------------------------------- */
.sm-card-grid-shapes { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }

/* ---- STANDARD SIZE PICKER (Sprint 2.1) ----------------------------------- */
.sm-size-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.sm-size-card {
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  transition: all 0.18s;
}
.sm-size-card:hover {
  border-color: var(--sm-gold-light);
  background: var(--sm-gold-pale);
}
.sm-size-card.on {
  border-color: var(--sm-navy);
  background: var(--sm-navy);
  color: #fff;
}
.sm-size-card-custom {
  border-style: dashed;
}
.sm-size-card-custom.on {
  border-style: solid;
  background: var(--sm-gold);
  border-color: var(--sm-gold);
  color: #fff;
}
.sm-size-label {
  font-family: var(--font-d), serif;
  font-size: 15px; font-weight: 600;
  margin-bottom: 4px;
  letter-spacing: 0.02em;
}
.sm-size-card.on .sm-size-label { color: #fff; }
.sm-size-meta {
  font-size: 11px; color: var(--text-mid);
  letter-spacing: 0.04em;
}
.sm-size-card.on .sm-size-meta { color: rgba(255,255,255,0.85); }

/* ---- CHIP BUTTONS (used for top shape, custom shape, base height, relations) */
.sm-chip-btn {
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 5px;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--sm-navy);
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sm-chip-btn:hover {
  border-color: var(--sm-gold-light);
  background: var(--sm-gold-pale);
}
.sm-chip-btn.on {
  background: var(--sm-navy);
  color: #fff;
  border-color: var(--sm-navy);
}
.sm-chip-btn-small { padding: 6px 10px; font-size: 12px; }
.sm-chip-btn-tall {
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 10px 12px;
  min-height: 56px;
}
.sm-chip-btn-label { font-weight: 600; }
.sm-chip-btn-blurb {
  font-size: 11px;
  margin-top: 3px;
  color: var(--text-mid);
  font-weight: 400;
}
.sm-chip-btn.on .sm-chip-btn-blurb { color: rgba(255,255,255,0.78); }

.sm-custom-shape-grid {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;
}
.sm-top-shape-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.sm-base-height-grid {
  display: flex; gap: 8px; flex-wrap: wrap;
}
.sm-base-height-grid .sm-chip-btn {
  flex-direction: column;
  min-width: 70px;
  padding: 10px 16px;
}
.sm-rel-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
}

/* ---- DESIGN STEP — sectioned-by-symbol layout ----------------------------- */
.sm-design-empty-mini {
  padding: 20px;
  text-align: center;
  color: var(--text-light);
  font-style: italic;
  font-size: 13px;
  background: var(--sm-cream-mid);
  border-radius: 6px;
}
.sm-show-more-btn {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 10px 16px;
  background: #fff;
  border: 1.5px dashed var(--sm-border);
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  color: var(--sm-navy);
  cursor: pointer;
  transition: all 0.15s;
}
.sm-show-more-btn:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
  border-style: solid;
}

/* ---- PREVIEW GATING (Sprint 2.1) ------------------------------------------ */
.sm-preview-blocked {
  text-align: center;
  padding: 32px 24px;
  background: var(--sm-cream-mid);
  border: 1px dashed var(--sm-border-dark);
  border-radius: 8px;
}
.sm-preview-blocked-icon {
  font-size: 32px; margin-bottom: 12px; opacity: 0.6;
}
.sm-preview-blocked-msg {
  font-family: var(--font-d), serif;
  font-size: 15px;
  color: var(--sm-navy);
  margin-bottom: 12px;
}
.sm-preview-blocked-list {
  display: inline-block;
  text-align: left;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.sm-preview-blocked-list li {
  padding: 4px 0 4px 22px;
  position: relative;
  font-size: 13px;
  color: var(--text-mid);
}
.sm-preview-blocked-list li::before {
  content: '○';
  position: absolute;
  left: 0;
  color: var(--sm-gold);
}
.sm-preview-blocked-hint {
  font-size: 12px;
  color: var(--text-light);
  font-style: italic;
}
.sm-preview-optin {
  text-align: center;
  padding: 12px 0;
}
.sm-preview-optin .sm-add-btn {
  max-width: 240px;
  margin: 0 auto;
}
.sm-live-preview-actions {
  display: flex; justify-content: flex-end;
  margin-bottom: 8px;
}

/* ---- COLOR GRID (Step 6) -------------------------------------------------- */
.sm-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.sm-color-card {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  padding: 0;
  transition: all 0.18s;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sm-color-card:hover {
  border-color: var(--sm-gold-light);
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(30,45,61,0.12);
}
.sm-color-card.on {
  border-color: var(--sm-navy);
  box-shadow: 0 4px 12px rgba(30,45,61,0.18);
}
.sm-color-swatch {
  width: 100%; aspect-ratio: 4/3;
  background: #f0ede6;
  position: relative;
  overflow: hidden;
}
.sm-color-swatch img {
  width: 100%; height: 100%; object-fit: cover;
  display: block;
}
.sm-color-popular {
  position: absolute; top: 8px; right: 8px;
  background: rgba(255,255,255,0.95);
  border-radius: 999px;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}
.sm-color-info {
  padding: 10px 12px;
}
.sm-color-name {
  font-family: var(--font-d), serif;
  font-size: 14px; font-weight: 500; color: var(--sm-navy);
  margin-bottom: 3px; line-height: 1.2;
}
.sm-color-meta {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; color: var(--text-mid);
}
.sm-color-premium {
  background: var(--sm-gold-pale);
  color: var(--sm-gold);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.sm-color-check {
  position: absolute; top: 8px; left: 8px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--sm-navy); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  box-shadow: 0 2px 6px rgba(30,45,61,0.3);
}

/* ---- DESIGN STEP — symbols, grid, selected pick --------------------------- */
.sm-toggle-group {
  display: inline-flex; padding: 3px;
  background: var(--sm-cream-mid);
  border-radius: 999px;
  border: 1px solid var(--sm-border);
  flex-shrink: 0;
}
.sm-toggle-btn {
  border: none; background: transparent; cursor: pointer;
  padding: 6px 12px;
  border-radius: 999px;
  font: inherit; font-size: 11px; font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-mid);
  transition: all 0.18s;
}
.sm-toggle-btn.on {
  background: #fff; color: var(--sm-navy);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px var(--sm-border);
}

/* Sprint 3r — Design step category tab strip */
.sm-design-tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.sm-design-tab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  border: 1.5px solid var(--sm-border);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px; font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-mid);
  transition: all 0.18s;
}
.sm-design-tab:hover {
  border-color: var(--sm-gold-light);
  background: var(--sm-gold-pale);
  color: var(--sm-navy);
}
.sm-design-tab.on {
  background: var(--sm-navy);
  color: #fff;
  border-color: var(--sm-navy);
}
.sm-design-tab-count {
  display: inline-block;
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(0,0,0,0.06);
  color: inherit;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.sm-design-tab.on .sm-design-tab-count {
  background: rgba(255,255,255,0.18);
  color: #fff;
}
.sm-design-tab.configurator {
  border-color: var(--sm-gold);
  color: var(--sm-gold-dark, var(--sm-navy));
}
.sm-design-tab.configurator:hover {
  background: var(--sm-gold-pale);
}
.sm-design-tab.configurator.on {
  background: var(--sm-gold);
  border-color: var(--sm-gold);
  color: #fff;
}
.sm-design-match-color {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-mid);
  cursor: pointer;
  user-select: none;
}
.sm-design-match-color input { cursor: pointer; }

.sm-symbol-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.sm-symbol-chip {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px;
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  transition: all 0.18s;
}
.sm-symbol-chip:hover {
  border-color: var(--sm-gold-light);
  background: var(--sm-gold-pale);
}
.sm-symbol-chip.on {
  background: var(--sm-navy);
  color: #fff;
  border-color: var(--sm-navy);
}
.sm-symbol-icon { font-size: 20px; }
.sm-symbol-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em;
}

.sm-design-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}
.sm-design-card {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  padding: 0;
  overflow: hidden;
  transition: all 0.18s;
}
.sm-design-card:hover {
  border-color: var(--sm-gold-light);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(30,45,61,0.1);
}
.sm-design-card.on {
  border-color: var(--sm-navy);
  box-shadow: 0 4px 12px rgba(30,45,61,0.2);
}
.sm-design-thumb {
  width: 100%; aspect-ratio: 4/3;
  background: #fff;
  display: flex; align-items: center; justify-content: center;
  position: relative;
  overflow: hidden;
}
.sm-design-thumb img {
  width: 100%; height: 100%; object-fit: contain;
}
.sm-design-no-img { font-size: 30px; opacity: 0.2; }
.sm-design-badge {
  position: absolute; top: 6px; right: 6px;
  background: var(--sm-navy); color: #fff;
  font-size: 9px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 3px;
}
.sm-design-info {
  padding: 8px 10px 10px;
}
.sm-design-id {
  font-size: 9px; color: var(--sm-gold);
  letter-spacing: 0.16em; font-weight: 700;
  margin-bottom: 2px;
}
.sm-design-name {
  font-family: var(--font-d), serif;
  font-size: 13px; font-weight: 600; color: var(--sm-navy);
  margin-bottom: 4px; line-height: 1.1;
}
.sm-design-tags {
  display: flex; flex-wrap: wrap; gap: 3px;
}
.sm-design-check {
  position: absolute; top: 8px; left: 8px;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--sm-gold);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  box-shadow: 0 2px 6px rgba(140,109,63,0.4);
}

.sm-modal-tag {
  background: var(--sm-cream-mid);
  color: var(--text-mid);
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 3px;
  font-weight: 700;
}
.sm-modal-tag-carve { background: #e8f0e4; color: #3a5c2e; }
.sm-modal-tag-color { background: #e4ecf5; color: #1e3a5c; }

.sm-design-loading, .sm-design-empty {
  padding: 40px 20px; text-align: center;
  color: var(--text-light);
  font-style: italic;
  font-size: 14px;
}

.sm-selected-design {
  display: flex; gap: 16px; align-items: center;
}
.sm-selected-thumb {
  width: 120px; aspect-ratio: 4/3;
  flex-shrink: 0;
  border: 1px solid var(--sm-border);
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.sm-selected-thumb img {
  width: 100%; height: 100%; object-fit: contain;
}
.sm-selected-info { flex: 1; min-width: 0; }
.sm-selected-id {
  font-size: 10px; color: var(--sm-gold);
  letter-spacing: 0.18em; font-weight: 700;
  margin-bottom: 2px;
}
.sm-selected-name {
  font-family: var(--font-d), serif;
  font-size: 18px; font-weight: 600; color: var(--sm-navy);
  margin-bottom: 4px; line-height: 1.1;
}
.sm-selected-sub {
  font-size: 12px; color: var(--text-mid);
  margin-bottom: 8px;
}
.sm-selected-tags { display: flex; flex-wrap: wrap; gap: 4px; }

/* Sprint 3r.2 — multi-select designs panel */
.sm-selected-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-light);
  font-style: italic;
  font-size: 14px;
  border: 1.5px dashed var(--sm-border);
  border-radius: 6px;
  background: var(--sm-cream-light, #fafaf7);
}
.sm-selected-designs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.sm-selected-card {
  position: relative;
  display: flex; gap: 10px;
  padding: 10px 10px 10px 12px;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
}
.sm-selected-card.primary  { border-color: var(--sm-gold); }
.sm-selected-card.alternate { border-color: var(--sm-navy); }
.sm-selected-card .sm-selected-thumb {
  width: 80px; aspect-ratio: 4/3;
}
.sm-selected-role {
  position: absolute;
  top: -8px; left: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
}
.sm-selected-role.primary   { background: var(--sm-gold); }
.sm-selected-role.alternate { background: var(--sm-navy); }
.sm-selected-actions {
  display: flex; flex-direction: column; gap: 4px;
  align-self: center;
  flex-shrink: 0;
}
.sm-selected-footer {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-mid);
  font-style: italic;
}
.sm-design-cap-notice {
  margin-top: 10px;
  padding: 8px 12px;
  background: #fef3c7;
  border: 1px solid #fbbf24;
  border-radius: 6px;
  color: #92400e;
  font-size: 13px;
  font-weight: 500;
}

/* Design grid card — primary-design override (navy is the base .on style) */
.sm-design-card.on.primary { border-color: var(--sm-gold); }
.sm-design-role-badge {
  position: absolute;
  top: 6px; left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  z-index: 1;
  pointer-events: none;
}
.sm-design-role-badge.primary   { background: var(--sm-gold); }
.sm-design-role-badge.alternate { background: var(--sm-navy); }

/* Sprint 3s — Designer handoff section on step 12 (Saved) */
.sm-handoff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.sm-handoff-card {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
  overflow: hidden;
}
.sm-handoff-card.primary  { border-color: var(--sm-gold); }
.sm-handoff-card.alternate { border-color: var(--sm-navy); }
.sm-handoff-thumb {
  width: 100%; aspect-ratio: 4/3;
  background: #fff;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.sm-handoff-thumb img {
  width: 100%; height: 100%; object-fit: contain;
}
.sm-handoff-info {
  padding: 10px 12px;
}
.sm-handoff-notes {
  margin-top: 18px;
}
.sm-handoff-notes-eyebrow {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-bottom: 6px;
}

/* ---- INSCRIPTION STEP ----------------------------------------------------- */
.sm-photo-preview {
  display: flex; gap: 16px; align-items: flex-start;
  padding: 12px;
  background: var(--sm-cream-mid);
  border-radius: 4px;
  border: 1px solid var(--sm-border);
}
.sm-photo-preview img {
  max-width: 280px; max-height: 200px;
  width: auto; height: auto;
  border-radius: 4px;
  border: 1px solid var(--sm-border-dark);
  background: #fff;
}

.sm-text-summary {
  background: var(--sm-cream);
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 24px 28px;
  font-family: var(--font-d), serif;
  text-align: center;
  display: flex; flex-direction: column; gap: 16px;
}
.sm-text-summary-row {
  display: flex; flex-direction: column; gap: 2px;
}
.sm-text-summary-title {
  font-size: 13px; font-style: italic;
  color: var(--text-mid);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.sm-text-summary-name {
  font-size: 24px; font-weight: 500;
  color: var(--sm-navy);
  letter-spacing: 0.04em;
}
.sm-text-summary-dates {
  font-size: 14px;
  color: var(--text-mid);
}
.sm-text-summary-epitaph {
  font-size: 14px; font-style: italic;
  color: var(--text-mid);
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--sm-border);
}

/* ---- LIVE PREVIEW (SVG stone) --------------------------------------------- */
.sm-live-preview {
  background: linear-gradient(180deg, #f5f1e9 0%, #e8e3d8 100%);
  border-radius: 6px;
  padding: 16px;
  border: 1px solid var(--sm-border);
}
.sm-live-preview svg {
  width: 100%; max-width: 600px;
  display: block;
  margin: 0 auto;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.18));
}
.sm-live-preview-caption {
  display: flex; flex-wrap: wrap; gap: 14px;
  justify-content: center;
  margin-top: 14px;
  font-size: 12px; color: var(--text-mid);
  letter-spacing: 0.04em;
}
.sm-live-preview-caption span {
  padding: 4px 10px;
  background: rgba(255,255,255,0.7);
  border-radius: 999px;
}

/* ---- SUMMARY: wide row (for long values like epitaph) -------------------- */
.sm-summary-wide { grid-column: 1 / -1; }
.sm-summary-val-quote {
  font-style: italic;
  color: var(--text-mid);
  font-size: 14px;
}

/* ---- EPITAPH LIBRARY (Sprint 2.5) ----------------------------------------- */
.sm-epi-open-btn {
  margin-bottom: 12px;
}
.sm-epi-library {
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  background: var(--sm-cream);
  overflow: hidden;
  margin-bottom: 12px;
}
.sm-epi-library-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid var(--sm-border);
}
.sm-epi-library-title {
  font-family: var(--font-d), serif;
  font-size: 15px; font-weight: 600;
  color: var(--sm-navy);
}
.sm-epi-search-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--sm-border);
  background: #fff;
}
.sm-epi-cat-row {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sm-border);
  background: #fff;
}
.sm-epi-cat {
  background: var(--sm-cream-mid);
  border: 1px solid var(--sm-border);
  border-radius: 999px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.15s;
  color: var(--text-mid);
}
.sm-epi-cat:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-epi-cat.on {
  background: var(--sm-navy);
  color: #fff;
  border-color: var(--sm-navy);
}
.sm-epi-cat-count {
  font-size: 10px;
  opacity: 0.6;
  font-weight: 700;
}
.sm-epi-list, .sm-epi-search-results {
  padding: 8px 12px;
  max-height: 360px;
  overflow-y: auto;
}
.sm-epi-item {
  display: flex; justify-content: space-between; align-items: center;
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 8px 12px;
  text-align: left;
  font: inherit;
  font-family: var(--font-d), serif;
  font-size: 14px;
  color: var(--sm-navy);
  cursor: pointer;
  transition: all 0.12s;
}
.sm-epi-item:hover {
  background: var(--sm-gold-pale);
  border-color: var(--sm-gold-light);
}
.sm-epi-item.on {
  background: var(--sm-navy);
  color: #fff;
  border-color: var(--sm-navy);
}
.sm-epi-item-cat {
  font-family: var(--font-b), sans-serif;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-right: 12px;
  min-width: 90px;
  flex-shrink: 0;
}
.sm-epi-item.on .sm-epi-item-cat { color: rgba(255,255,255,0.7); }
.sm-epi-item-text { flex: 1; }
.sm-epi-item-check {
  margin-left: 8px; font-weight: 700;
}
.sm-epi-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-light);
  font-style: italic;
  font-size: 13px;
}

/* ---- ADD-ONS STEP (Sprint 3) ---------------------------------------------- */
.sm-addon-grid {
  display: flex; flex-direction: column; gap: 8px;
}

/* ---- CARVINGS — 6-card add-on grid (Sprint 3j → 3p.1) ------------------- */
.sm-carve-types {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 4px;
}
@media (max-width: 980px) {
  .sm-carve-types { grid-template-columns: 1fr 1fr; }
}
.sm-carve-card {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 8px;
  padding: 0;
  text-align: left;
  font: inherit; color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.18s;
  display: flex;
  flex-direction: column;
}
.sm-carve-card:hover {
  border-color: var(--sm-gold-light);
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(30,45,61,0.12);
}
.sm-carve-card.on {
  border-color: var(--sm-navy);
  box-shadow: 0 4px 14px rgba(30,45,61,0.2);
}
.sm-carve-img {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #f0ede6;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sm-carve-img img {
  width: 100%; height: 100%; object-fit: cover;
}
.sm-carve-img svg {
  width: 70%; max-width: 200px;
}
.sm-carve-card-body {
  padding: 12px 14px 14px;
}
.sm-carve-label {
  font-family: var(--font-d), serif;
  font-size: 16px; font-weight: 600;
  color: var(--sm-navy);
  margin-bottom: 4px;
}
.sm-carve-blurb {
  font-size: 12px;
  color: var(--text-mid);
  line-height: 1.4;
}
.sm-carve-check {
  position: absolute; top: 10px; right: 10px;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--sm-navy);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700;
  z-index: 3;
  box-shadow: 0 2px 8px rgba(30,45,61,0.4);
}

.sm-carve-config {
  margin-top: 16px;
  padding: 14px;
  background: var(--sm-cream-mid);
  border: 1px solid var(--sm-border);
  border-radius: 6px;
}
.sm-carve-config-eyebrow {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-bottom: 10px;
}

.sm-shape-design-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
.sm-shape-design-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 6px;
  font: inherit; color: inherit;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.sm-shape-design-card:hover {
  border-color: var(--sm-gold-light);
  background: var(--sm-gold-pale);
}
.sm-shape-design-card.on {
  border-color: var(--sm-navy);
  background: var(--sm-cream);
}
.sm-shape-design-label {
  flex: 1;
  font-family: var(--font-d), serif;
  font-size: 14px;
  color: var(--sm-navy);
}
.sm-shape-design-price {
  font-size: 12px;
  color: var(--text-mid);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.sm-carve-design-config {
  margin-top: 10px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
}
.sm-carve-design-config-label {
  font-family: var(--font-d), serif;
  font-size: 14px; font-weight: 600;
  color: var(--sm-navy);
  margin-bottom: 8px;
  overflow: hidden;
}

/* ---- PHOTO — type + size grid (Sprint 2.5+) ----------------------------- */
.sm-photo-type-row {
  display: inline-flex;
  gap: 4px;
  background: var(--sm-cream-mid);
  border: 1px solid var(--sm-border);
  border-radius: 999px;
  padding: 3px;
  margin-bottom: 12px;
}
.sm-photo-size-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.sm-photo-size-card {
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 8px;
  padding: 16px 12px 12px;
  cursor: pointer;
  font: inherit; color: inherit;
  text-align: center;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.sm-photo-size-card:hover {
  border-color: var(--sm-gold);
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(30,45,61,0.1);
  background: var(--sm-gold-pale);
}
.sm-photo-size-oval {
  width: 50%;
  aspect-ratio: 3 / 4;
  background: var(--sm-cream-mid);
  border: 2px solid var(--sm-border-dark);
  border-radius: 50%;
  margin-bottom: 8px;
}
.sm-photo-size-name {
  font-family: var(--font-d), serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--sm-navy);
}
.sm-photo-size-dim {
  font-size: 10px;
  color: var(--text-mid);
  letter-spacing: 0.04em;
}
.sm-photo-size-price {
  font-family: var(--font-d), serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--sm-gold);
  margin-top: 4px;
}

.sm-customer-photo-wrap {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--sm-border);
}
.sm-customer-photo-eyebrow {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-bottom: 8px;
}
.sm-customer-photo-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.sm-customer-photo-row img {
  max-width: 200px;
  max-height: 240px;
  width: auto;
  height: auto;
  border-radius: 4px;
  border: 1px solid var(--sm-border-dark);
  background: #fff;
}
.sm-customer-photo-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Veteran category — collapsed toggle button */
.sm-veteran-toggle {
  margin-top: 14px;
  background: transparent;
  border: 1.5px dashed var(--sm-gold);
  color: var(--sm-gold);
  font-family: var(--font-d), serif;
  font-size: 14px;
  letter-spacing: 0.04em;
}
.sm-veteran-toggle:hover {
  background: var(--sm-gold-pale);
  border-style: solid;
}
.sm-veteran-toggle-hint {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
  margin-left: 6px;
}

/* PDF download button (Sprint 3a) */
.sm-pdf-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.sm-pdf-err {
  margin-top: 10px;
  padding: 10px 14px;
  background: #fde9e9;
  border: 1px solid #d97777;
  border-radius: 6px;
  color: #9a2929;
  font-size: 13px;
}

/* ---- SIGNATURE CANVAS + CONTRACT CONVERSION (Sprint 3b) ---------------- */
.sm-signature {
  margin: 4px 0;
}
.sm-signature-label {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-bottom: 8px;
}
.sm-signature-pad {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border-dark);
  border-radius: 8px;
  height: 180px;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;     /* prevent scroll while drawing */
  user-select: none;
}
.sm-signature-pad.disabled {
  cursor: not-allowed;
  background: var(--sm-cream-mid);
  opacity: 0.85;
}
.sm-signature-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.sm-signature-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: var(--sm-border-dark);
  font-style: italic;
  font-size: 14px;
  letter-spacing: 0.04em;
}
.sm-signature-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 6px;
}
.sm-signature-ok {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: #2d8a4f;
  font-weight: 700;
}

/* Sprint 3v Part B — customer signature box (tap-to-open) + signature modal */
.sm-sigbox-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 340px;
  height: 150px;
  background: #fff;
  border: 2px dashed var(--sm-border-dark);
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  transition: all 0.18s;
}
.sm-sigbox-empty:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-sigbox-prompt {
  color: var(--sm-border-dark);
  font-style: italic;
  font-size: 15px;
  letter-spacing: 0.04em;
  transition: color 0.18s;
}
.sm-sigbox-empty:hover .sm-sigbox-prompt {
  color: var(--sm-gold);
}
.sm-sigbox-filled {
  position: relative;
  width: 100%;
  max-width: 340px;
  height: 150px;
  background: #fff;
  border: 2px solid var(--sm-border-dark);
  border-radius: 8px;
  overflow: hidden;
}
.sm-sigbox-filled img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.sm-sigbox-clear-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 3px 9px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--sm-border-dark);
  border-radius: 5px;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-mid, #555);
  cursor: pointer;
  transition: all 0.15s;
}
.sm-sigbox-clear-btn:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.sm-signature-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 560px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.sm-signature-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 14px;
}

/* Sprint 3v Part C — unlock signed contract: serious red button + confirm modal */
.sm-unlock-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: #fff;
  border: 2px solid #c0392b;
  border-radius: 6px;
  color: #c0392b;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.18s;
}
.sm-unlock-btn:hover {
  background: #c0392b;
  color: #fff;
}
.sm-unlock-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 480px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.sm-unlock-modal-title {
  font-family: var(--font-d), serif;
  font-size: 19px;
  font-weight: 600;
  color: var(--sm-navy);
  margin-bottom: 10px;
}
.sm-unlock-modal-body {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-mid, #555);
  margin-bottom: 20px;
}
.sm-unlock-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  align-items: center;
}
.sm-unlock-modal-confirm {
  padding: 9px 20px;
  background: #c0392b;
  border: none;
  border-radius: 6px;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background 0.15s;
}
.sm-unlock-modal-confirm:hover {
  background: #a93226;
}

.sm-locked-banner {
  margin: 0 0 18px;
  padding: 14px 18px;
  background: linear-gradient(180deg, #fff8e8, #f5e9c8);
  border: 1.5px solid #c9a957;
  border-radius: 6px;
  color: #6a4f12;
  font-size: 14px;
  letter-spacing: 0.01em;
  line-height: 1.45;
}
.sm-locked-banner strong {
  color: #4a3608;
}

/* When in a locked step, dim editable inputs and disable interaction —
   PDF download still works (sm-pdf-btn is excluded) */
.sm-locked input[type="text"],
.sm-locked input[type="number"],
.sm-locked textarea,
.sm-locked .sm-toggle-btn,
.sm-locked .sm-add-btn:not(.sm-pdf-btn),
.sm-locked .sm-link-btn:not(.sm-pdf-btn) {
  pointer-events: none;
  opacity: 0.65;
  cursor: not-allowed;
}

.sm-convert-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.sm-convert-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- CUSTOM DESIGN panel (Sprint 3c, two-photo layout in 3d) ---------- */
.sm-custom-design {
  display: grid;
  grid-template-rows: auto auto;
  gap: 0;
  margin-bottom: 22px;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.18s;
}
.sm-custom-design.on {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
  box-shadow: 0 4px 16px rgba(140, 109, 63, 0.22);
}

.sm-custom-design-photos {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  background: var(--sm-cream-mid);
}
.sm-custom-design-photo {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sm-custom-design-photo img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
  border-radius: 6px;
  border: 1px solid var(--sm-border-dark);
  background: #fff;
}
.sm-custom-design-photo figcaption {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-mid, #666);
  text-align: center;
  font-weight: 600;
}
.sm-custom-design-arrow {
  font-size: 32px;
  color: var(--sm-gold);
  font-weight: 300;
  user-select: none;
  padding: 0 6px;
}

.sm-custom-design-body {
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
}
.sm-custom-design-eyebrow {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin-bottom: 8px;
}
.sm-custom-design-title {
  font-family: var(--font-d), serif;
  font-size: 22px;
  font-weight: 600;
  color: var(--sm-navy);
  margin: 0 0 8px;
  line-height: 1.2;
}
.sm-custom-design-blurb {
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-mid, #555);
  margin: 0 0 16px;
}
.sm-custom-design-actions {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.sm-custom-design-btn {
  padding: 11px 22px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.sm-custom-design-price {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--sm-gold);
  font-weight: 700;
}
.sm-custom-design-note {
  margin-top: 14px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.6);
  border-left: 3px solid var(--sm-gold);
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-mid, #555);
  border-radius: 0 4px 4px 0;
}
@media (max-width: 720px) {
  .sm-custom-design-photos {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
  .sm-custom-design-arrow {
    transform: rotate(90deg);
    padding: 0;
  }
  .sm-custom-design-photo img { aspect-ratio: 16/10; }
}

.sm-design-search {
  position: relative;
}
.sm-design-search-input {
  width: 100%;
  font-size: 16px;
  font-family: inherit;
  color: var(--text);
  padding: 12px 40px 12px 16px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.sm-design-search-input:focus {
  border-color: var(--sm-gold);
  box-shadow: 0 0 0 3px var(--sm-gold-pale);
}
.sm-design-search-clear {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  background: var(--sm-cream-mid);
  border: none;
  border-radius: 50%;
  width: 26px;
  height: 26px;
  font-size: 18px;
  color: var(--text-mid, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.sm-design-search-clear:hover {
  background: var(--sm-border-dark);
}

/* ---- Deposit & balance card (Sprint 3e — 50% policy) ------------------- */
.sm-deposit-card {
  margin-top: 14px;
  border: 2px solid var(--sm-gold);
  border-radius: 8px;
  background: var(--sm-gold-pale);
  overflow: hidden;
}
.sm-deposit-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
}
.sm-deposit-card-due {
  background: linear-gradient(135deg, var(--sm-gold), var(--sm-gold-light));
  color: #fff;
}
.sm-deposit-card-due .sm-deposit-card-amt,
.sm-deposit-card-due .sm-deposit-card-sub {
  color: #fff;
}
.sm-deposit-card-lab {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
}
.sm-deposit-card-lab strong {
  font-size: 16px;
  letter-spacing: 0.02em;
}
.sm-deposit-card-sub {
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}
.sm-deposit-card-amt {
  font-family: var(--font-d), serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--sm-navy);
  white-space: nowrap;
}
.sm-deposit-card-amt-bal {
  font-size: 18px;
  color: var(--sm-navy);
  opacity: 0.85;
}

/* ---- Discount controls (Sprint 3f) ------------------------------------- */
.sm-discount-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.sm-discount-chip {
  padding: 9px 18px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--sm-navy);
  cursor: pointer;
  transition: all 0.15s;
}
.sm-discount-chip:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-discount-chip.on {
  background: var(--sm-gold);
  border-color: var(--sm-gold);
  color: #fff;
}
.sm-discount-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sm-discount-custom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 14px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 999px;
}
.sm-discount-custom-lab {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-mid, #555);
}
.sm-discount-custom-input {
  width: 60px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--sm-navy);
  outline: none;
  text-align: right;
  padding: 4px 0;
}
.sm-discount-custom-pct {
  color: var(--sm-navy);
  font-size: 13px;
  font-weight: 700;
}
.sm-discount-summary {
  margin-top: 12px;
  padding: 8px 14px;
  background: var(--sm-gold-pale);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--sm-navy);
}
.sm-discount-summary strong {
  font-family: var(--font-d), serif;
  font-size: 16px;
  color: var(--sm-gold);
}
.sm-totals-row-discount {
  color: var(--sm-gold);
}
.sm-totals-row-discount span:last-child {
  font-weight: 700;
}

/* ---- Referral source chips (Sprint 3g) --------------------------------- */
.sm-referral-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sm-referral-chip {
  padding: 9px 16px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--sm-navy);
  cursor: pointer;
  transition: all 0.15s;
}
.sm-referral-chip:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-referral-chip.on {
  background: var(--sm-navy);
  border-color: var(--sm-navy);
  color: #fff;
}

/* ---- Orders Dashboard (Sprint 3h) -------------------------------------- */
.sm-dashboard-inner {
  max-width: 980px;
}
.sm-dashboard-search {
  position: relative;
  margin: 18px 0 12px;
}
.sm-dashboard-search input {
  width: 100%;
  font-size: 15px;
  font-family: inherit;
  color: var(--text);
  padding: 12px 40px 12px 16px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.sm-dashboard-search input:focus {
  border-color: var(--sm-gold);
  box-shadow: 0 0 0 3px var(--sm-gold-pale);
}
.sm-dashboard-search button {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  background: var(--sm-cream-mid);
  border: none;
  border-radius: 50%;
  width: 26px;
  height: 26px;
  font-size: 18px;
  color: var(--text-mid, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.sm-dashboard-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 14px;
}
.sm-dashboard-divider {
  color: var(--sm-border-dark);
  margin: 0 4px;
  font-size: 18px;
  user-select: none;
}
.sm-dashboard-pill {
  padding: 7px 14px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--sm-navy);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.sm-dashboard-pill:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-dashboard-pill.on {
  background: var(--sm-navy);
  border-color: var(--sm-navy);
  color: #fff;
}
.sm-dashboard-pill-count {
  font-size: 10px;
  background: var(--sm-cream-mid);
  border-radius: 999px;
  padding: 1px 7px;
  color: var(--sm-navy);
  font-weight: 700;
}
.sm-dashboard-pill.on .sm-dashboard-pill-count {
  background: rgba(255,255,255,0.2);
  color: #fff;
}

/* Status-specific accent strip on the row badge (re-used in dashboard
   and ContinueLater status changer) */
.sm-status-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sm-status-pill {
  padding: 9px 16px;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--sm-navy);
  cursor: pointer;
  transition: all 0.15s;
}
.sm-status-pill:hover {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-status-pill.on {
  background: var(--sm-navy);
  border-color: var(--sm-navy);
  color: #fff;
}
.sm-status-pill[data-status="cancelled"].on { background: #b54040; border-color: #b54040; }
.sm-status-pill[data-status="installed"].on,
.sm-status-pill[data-status="paid_in_full"].on,
.sm-status-pill[data-status="closed"].on  { background: #2d8a4f; border-color: #2d8a4f; }

/* ---- SPRINT 3i — Production timeline ----------------------------------- */
.sm-timeline-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.sm-timeline-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 14px;
  align-items: center;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
}
.sm-timeline-svc {
  font-family: var(--font-d), serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--sm-navy);
}
.sm-timeline-std {
  font-size: 13px;
  color: var(--text-mid, #555);
}
.sm-timeline-std strong {
  color: var(--sm-navy);
}
.sm-timeline-arrow {
  margin: 0 8px;
  color: var(--sm-gold);
  font-weight: 700;
}
.sm-timeline-rush {
  color: var(--sm-gold);
  font-weight: 700;
}
.sm-timeline-custom-note {
  color: var(--text-mid, #888);
  font-style: italic;
}
.sm-rush-toggle-wrap {
  margin-top: 8px;
  margin-bottom: 4px;
}

/* ---- SPRINT 3i — PDF Action Toolbar + Preview Modal ------------------- */
.sm-pdf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.sm-pdf-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.sm-pdf-preview-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 900px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.sm-pdf-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--sm-cream-mid);
  border-bottom: 1px solid var(--sm-border);
}
.sm-pdf-preview-title {
  font-family: var(--font-d), serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--sm-navy);
}
.sm-pdf-preview-actions {
  display: flex;
  gap: 16px;
}
.sm-pdf-preview-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: #525659;
}

/* ---- Sprint 3p.1 — Coming Soon modal & badge (Vase/BLING) ------------- */
.sm-coming-soon-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 420px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.sm-coming-soon-body {
  font-size: 14px;
  color: var(--sm-navy);
  line-height: 1.5;
}
.sm-carve-coming-soon {
  position: absolute;
  top: 8px;
  left: 8px;
  background: var(--sm-bronze, #b08d57);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
  z-index: 2;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

/* ---- Sprint 3p.2 — BLING configurator -------------------------------- */
.sm-bling-config { padding-top: 6px; }
.sm-bling-step-label {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sm-gold);
  font-weight: 700;
  margin: 14px 0 8px;
}
.sm-bling-size-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sm-bling-size-card {
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  display: flex; flex-direction: column; gap: 4px;
  transition: all 0.15s;
}
.sm-bling-size-card:hover { border-color: var(--sm-gold); background: var(--sm-gold-pale); }
.sm-bling-size-card.on { border-color: var(--sm-navy); background: var(--sm-gold-pale); }
.sm-bling-size-name { font-family: var(--font-d), serif; font-size: 15px; font-weight: 600; color: var(--sm-navy); }
.sm-bling-size-dim { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-mid, #666); }
.sm-bling-size-price { font-size: 14px; font-weight: 700; color: var(--sm-navy); margin-top: 6px; }
.sm-bling-size-add { margin-top: 4px; font-size: 11px; letter-spacing: 0.05em; color: var(--sm-gold); font-weight: 700; text-transform: uppercase; }
.sm-bling-size-on { margin-top: 4px; font-size: 11px; letter-spacing: 0.05em; color: #2d8a4f; font-weight: 700; text-transform: uppercase; }

.sm-bling-shape-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 720px) { .sm-bling-shape-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1100px) { .sm-bling-shape-grid { grid-template-columns: repeat(5, 1fr); } }
.sm-bling-shape-card {
  position: relative;
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 8px;
  padding: 6px;
  cursor: pointer;
  text-align: center;
  font: inherit; color: inherit;
  display: flex; flex-direction: column; gap: 6px;
  transition: all 0.15s;
  overflow: hidden;
}
.sm-bling-shape-card:hover { border-color: var(--sm-gold-light); transform: translateY(-1px); }
.sm-bling-shape-card.on { border-color: var(--sm-navy); box-shadow: 0 4px 12px rgba(30,45,61,0.18); }
.sm-bling-shape-thumb {
  width: 100%; aspect-ratio: 1 / 1;
  background: #f0ede6;
  border-radius: 4px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.sm-bling-shape-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.sm-bling-shape-label { font-size: 12px; color: var(--sm-navy); line-height: 1.3; padding: 0 2px 4px; }
.sm-bling-shape-check {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--sm-navy); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  box-shadow: 0 2px 6px rgba(30,45,61,0.3);
}

.sm-bling-step-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.sm-bling-color-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 8px;
}
.sm-bling-match-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sm-navy); cursor: pointer; }
.sm-bling-match-toggle input { margin: 0; cursor: pointer; }
.sm-bling-stone-name { font-weight: 600; color: var(--sm-navy); }
.sm-bling-stone-empty { color: var(--text-mid); font-style: italic; font-size: 12px; }
.sm-bling-color-current { font-size: 13px; color: var(--sm-navy); }
.sm-bling-color-upcharge { color: var(--sm-gold); font-weight: 700; }

.sm-bling-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.sm-bling-color-card {
  position: relative;
  background: #fff;
  border: 2px solid var(--sm-border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  padding: 0;
  display: flex; flex-direction: column;
  transition: all 0.15s;
  overflow: hidden;
}
.sm-bling-color-card:hover { border-color: var(--sm-gold-light); }
.sm-bling-color-card.on { border-color: var(--sm-navy); box-shadow: 0 3px 8px rgba(30,45,61,0.18); }
.sm-bling-color-swatch { width: 100%; aspect-ratio: 4 / 3; background: #f0ede6; overflow: hidden; }
.sm-bling-color-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sm-bling-color-info { padding: 6px 8px 8px; }
.sm-bling-color-name { font-size: 12px; font-weight: 600; color: var(--sm-navy); line-height: 1.2; }
.sm-bling-color-prem { font-size: 10px; color: var(--sm-gold); font-weight: 700; margin-top: 2px; }

.sm-bling-add-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  margin-top: 14px;
  padding: 12px;
  background: var(--sm-gold-pale);
  border: 1px solid var(--sm-border);
  border-radius: 8px;
}
.sm-bling-add-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.sm-bling-add-eyebrow { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-mid); }
.sm-bling-add-amt { font-family: var(--font-d), serif; font-size: 20px; font-weight: 700; color: var(--sm-navy); }
.sm-bling-add-upcharge { font-size: 12px; color: var(--sm-gold); font-weight: 600; }
.sm-bling-add-btn {
  background: var(--sm-navy);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 18px;
  font: inherit; font-weight: 700; font-size: 13px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.15s;
}
.sm-bling-add-btn:hover:not(:disabled) { background: var(--sm-gold); transform: translateY(-1px); }
.sm-bling-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sm-bling-instances {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--sm-border-dark);
}
/* Per-instance BLING row — stacked layout matching the Laser Etching pattern.
   Header (thumb + label + remove) on top, addon-config-grid (qty/price/total)
   below. Prevents the QTY column from colliding with long label text. */
.sm-bling-instance-row { margin-bottom: 10px; }
.sm-bling-instance-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}
.sm-bling-instance-thumb-inline {
  width: 48px; height: 48px;
  flex-shrink: 0;
  background: #f0ede6;
  border-radius: 4px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.sm-bling-instance-thumb-inline img { width: 100%; height: 100%; object-fit: contain; display: block; }
.sm-bling-instance-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.sm-bling-instance-label-main {
  font-family: var(--font-d), serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--sm-navy);
  line-height: 1.3;
}
.sm-bling-instance-sub {
  font-size: 12px;
  color: var(--text-mid);
  margin-top: 2px;
}

.sm-bling-examples-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 720px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.sm-bling-examples-body { padding: 16px; overflow-y: auto; }
.sm-bling-examples-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.sm-bling-examples-card {
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 8px;
  padding: 0;
  cursor: pointer;
  font: inherit; color: inherit;
  display: flex; flex-direction: column;
  overflow: hidden;
  transition: all 0.15s;
}
.sm-bling-examples-card:hover { border-color: var(--sm-gold); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(30,45,61,0.12); }
.sm-bling-examples-thumb { width: 100%; aspect-ratio: 7 / 5; background: #f0ede6; overflow: hidden; }
.sm-bling-examples-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sm-bling-examples-card-label { padding: 8px 10px; font-size: 12px; color: var(--sm-navy); line-height: 1.3; }
.sm-bling-examples-empty { padding: 24px; text-align: center; color: var(--text-mid); font-style: italic; }
.sm-bling-examples-enlarged { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.sm-bling-examples-enlarged img { max-width: 100%; max-height: 60vh; object-fit: contain; }
.sm-bling-examples-caption { font-size: 13px; color: var(--text-mid); }

/* ---- Sprint 3p.3 — Vase configurator --------------------------------- */
.sm-vase-config { padding-top: 6px; }
.sm-vase-rec-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 12px;
  background: var(--sm-cream-mid);
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  margin: 8px 0 14px;
  font-size: 13px;
  color: var(--sm-navy);
}
.sm-vase-rec-text { line-height: 1.5; }
.sm-vase-rec-text strong { color: var(--sm-navy); font-weight: 700; }
.sm-vase-rec-text em { color: var(--text-mid); font-style: italic; }
.sm-vase-rec-warn { color: #b54040; font-weight: 600; }

.sm-vase-soft-notice {
  padding: 10px 14px;
  background: #fff8ed;
  border: 1px solid #e6c79a;
  border-left: 4px solid var(--sm-gold);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--sm-navy);
}
.sm-vase-soft-notice-strong {
  background: #fff4e0;
  border-color: var(--sm-gold);
}

.sm-vase-size-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 760px) { .sm-vase-size-grid { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 1100px) { .sm-vase-size-grid { grid-template-columns: repeat(6, 1fr); } }
.sm-vase-size-card {
  position: relative;
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  font: inherit; color: inherit;
  display: flex; flex-direction: column; gap: 4px;
  transition: all 0.15s;
}
.sm-vase-size-card:hover:not(:disabled) { border-color: var(--sm-gold); background: var(--sm-gold-pale); }
.sm-vase-size-card.on { border-color: var(--sm-navy); background: var(--sm-gold-pale); }
.sm-vase-size-card:disabled { opacity: 0.55; cursor: not-allowed; background: #f5f3ed; }
.sm-vase-size-card.sm-fit-yellow:not(.on) { border-color: #d9a64a; }
.sm-vase-size-card.sm-fit-red { border-color: #b54040; }
.sm-vase-size-card.sm-fit-green:not(.on) { border-color: #6a9a4a; }
.sm-vase-rec-badge {
  position: absolute;
  top: 6px; right: 6px;
  background: var(--sm-bronze, #b08d57);
  color: #fff;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}
.sm-vase-size-name { font-family: var(--font-d), serif; font-size: 14px; font-weight: 600; color: var(--sm-navy); margin-top: 4px; }
.sm-vase-size-vol { font-size: 11px; color: var(--text-mid); letter-spacing: 0.04em; text-transform: uppercase; }
.sm-vase-size-price { font-size: 14px; font-weight: 700; color: var(--sm-navy); margin-top: 4px; }
.sm-vase-size-fit { font-size: 11px; margin-top: 4px; min-height: 14px; }
.sm-fit-ok { color: #2d8a4f; font-weight: 600; }
.sm-fit-warn { color: #b87f1a; font-weight: 600; }
.sm-fit-bad { color: #b54040; font-weight: 600; }
.sm-fit-unknown { color: var(--text-mid); font-style: italic; }
.sm-vase-size-add { margin-top: 4px; font-size: 11px; letter-spacing: 0.05em; color: var(--sm-gold); font-weight: 700; text-transform: uppercase; }
.sm-vase-size-on { margin-top: 4px; font-size: 11px; letter-spacing: 0.05em; color: #2d8a4f; font-weight: 700; text-transform: uppercase; }

.sm-vase-shape-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 720px) { .sm-vase-shape-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1100px) { .sm-vase-shape-grid { grid-template-columns: repeat(6, 1fr); } }
.sm-vase-shape-card {
  position: relative;
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 8px;
  padding: 6px;
  cursor: pointer;
  text-align: center;
  font: inherit; color: inherit;
  display: flex; flex-direction: column; gap: 6px;
  transition: all 0.15s;
  overflow: hidden;
}
.sm-vase-shape-card:hover { border-color: var(--sm-gold-light); transform: translateY(-1px); }
.sm-vase-shape-card.on { border-color: var(--sm-navy); box-shadow: 0 4px 12px rgba(30,45,61,0.18); }
.sm-vase-shape-thumb {
  width: 100%; aspect-ratio: 3 / 4;
  background: #f0ede6;
  border-radius: 4px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.sm-vase-shape-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.sm-vase-shape-label { font-size: 12px; color: var(--sm-navy); line-height: 1.3; padding: 0 2px 4px; }
.sm-vase-shape-check {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--sm-navy); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  box-shadow: 0 2px 6px rgba(30,45,61,0.3);
}

.sm-vase-fit-warning-modal {
  background: #fff;
  border-radius: 10px;
  width: 100%;
  max-width: 500px;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  border-top: 4px solid #b54040;
}
.sm-vase-fit-warning-body { padding: 18px 24px 22px; font-size: 13px; color: var(--sm-navy); line-height: 1.55; }
.sm-vase-fit-warning-body p { margin: 0 0 10px; }
.sm-vase-fit-warning-body strong { color: var(--sm-navy); font-weight: 700; }
.sm-vase-fit-warning-actions {
  display: flex; gap: 12px; flex-wrap: wrap;
  margin: 14px 0 8px;
}
.sm-vase-override-btn {
  background: #fff;
  color: var(--sm-navy);
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 6px;
  padding: 10px 16px;
  font: inherit; font-weight: 600; font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.sm-vase-override-btn:hover { background: var(--sm-cream-mid); border-color: var(--sm-gold); }
.sm-vase-fit-warning-fine {
  font-size: 11px;
  color: var(--text-mid);
  font-style: italic;
  margin-top: 6px !important;
}

/* ---- SPRINT 3i — Payment tracking ------------------------------------- */
.sm-payment-summary {
  background: var(--sm-cream-mid);
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 10px 16px;
  margin-bottom: 16px;
}
.sm-payment-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 14px;
}
.sm-payment-collected {
  color: #2d8a4f;
}
.sm-payment-summary-rem {
  border-top: 1px solid var(--sm-border);
  margin-top: 4px;
  padding-top: 8px;
  font-size: 16px;
  color: var(--sm-navy);
}
.sm-payment-summary-rem strong {
  font-family: var(--font-d), serif;
  font-size: 18px;
}
.sm-payment-block {
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 14px;
  margin-bottom: 12px;
}
.sm-payment-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sm-payment-block-head strong {
  font-family: var(--font-d), serif;
  color: var(--sm-navy);
  font-size: 14px;
}

/* ---- SPRINT M2 Phase 2 — array-driven payment rows ------------------- */
.sm-payment-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-payment-row {
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 12px 14px;
}
.sm-payment-row-collapsed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
}
.sm-payment-row-summary {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--text-mid);
}
.sm-payment-row-summary strong {
  font-family: var(--font-d), serif;
  font-size: 16px;
  color: var(--sm-navy);
}
.sm-payment-row-editing {
  border-color: var(--sm-gold);
}
.sm-payment-row-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
/* ReceiptActions toolbar drops to its own full-width line below the summary. */
.sm-payment-row-collapsed > div:last-child {
  flex: 1 1 100%;
}
.sm-payment-row-collapsed .sm-payment-row-summary,
.sm-payment-row-collapsed .sm-payment-row-actions {
  flex-basis: auto;
}
.sm-payment-empty {
  margin-top: 12px;
  padding: 20px;
  text-align: center;
  color: var(--text-light, #999);
  font-style: italic;
  font-size: 14px;
  background: var(--sm-cream-mid);
  border: 1px dashed var(--sm-border);
  border-radius: 6px;
}

/* ---- SPRINT 3i — Cancel order ---------------------------------------- */
.sm-cancel-display {
  background: #fff8f8;
  border: 1px solid #d9b0b0;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 10px;
  font-size: 13px;
}

/* ---- SPRINT 3i — Dashboard row + new-quote button ------------------- */
.sm-resume-row-wrap {
  position: relative;
  display: flex;
  gap: 0;
}
.sm-resume-row-wrap .sm-resume-row {
  flex: 1;
}
.sm-resume-row-action {
  background: var(--sm-cream-mid);
  border: 1.5px solid var(--sm-border-dark);
  border-left: none;
  padding: 0 16px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--sm-gold);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  border-radius: 0 6px 6px 0;
}
.sm-resume-row-action:hover {
  background: var(--sm-gold);
  color: #fff;
  border-color: var(--sm-gold);
}

/* Date input matches text input look */
input[type="date"].sm-textinput {
  font-family: inherit;
}

/* ---- SPRINT 3j — Laser etching size grid ------------------------------ */
.sm-laser-cap {
  font-size: 11px;
  color: var(--text-mid, #666);
  margin-left: 8px;
}
.sm-laser-warn {
  color: #b54040;
  font-weight: 600;
}
.sm-laser-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 12px;
}
@media (min-width: 880px) {
  .sm-laser-grid { grid-template-columns: repeat(4, 1fr); }
}
.sm-laser-size-card {
  background: #fff;
  border: 1.5px solid var(--sm-border-dark);
  border-radius: 8px;
  padding: 12px;
  text-align: left;
  font: inherit; color: inherit;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-laser-size-card:hover:not(:disabled) {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-laser-size-card.on {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-laser-size-card:disabled { opacity: 0.7; cursor: default; }
.sm-laser-size-name {
  font-family: var(--font-d), serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--sm-navy);
}
.sm-laser-size-dim {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-mid, #666);
}
.sm-laser-size-blurb {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-mid, #555);
  margin-top: 4px;
  flex: 1;
}
.sm-laser-size-price {
  margin-top: 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--sm-navy);
}
.sm-laser-size-disc {
  font-size: 11px;
  color: var(--sm-gold);
  font-weight: 600;
}
.sm-laser-size-add {
  margin-top: 4px;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--sm-gold);
  font-weight: 700;
  text-transform: uppercase;
}
.sm-laser-size-on {
  margin-top: 4px;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: #2d8a4f;
  font-weight: 700;
  text-transform: uppercase;
}

.sm-addon-row {
  background: #fff;
  border: 1.5px solid var(--sm-border);
  border-radius: 6px;
  overflow: hidden;
  transition: all 0.15s;
}
.sm-addon-row.on {
  border-color: var(--sm-gold);
  background: var(--sm-gold-pale);
}
.sm-addon-toggle {
  width: 100%;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  font: inherit; color: inherit;
  text-align: left;
}
.sm-addon-checkbox {
  width: 22px; height: 22px;
  border: 2px solid var(--sm-border-dark);
  border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  flex-shrink: 0;
  background: #fff;
}
.sm-addon-checkbox.on {
  background: var(--sm-navy);
  border-color: var(--sm-navy);
  color: #fff;
}
.sm-addon-label {
  flex: 1;
  font-family: var(--font-d), serif;
  font-size: 15px; font-weight: 500;
  color: var(--sm-navy);
}
.sm-addon-default-price {
  font-size: 13px;
  color: var(--text-mid);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.sm-addon-config {
  padding: 12px 14px 14px;
  border-top: 1px dashed var(--sm-border);
  background: rgba(255,255,255,0.5);
}
.sm-addon-config-grid {
  display: grid;
  grid-template-columns: 80px 120px 120px;
  gap: 12px;
  margin-bottom: 8px;
}
.sm-addon-summary {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  background: var(--sm-navy);
  color: #fff;
  border-radius: 6px;
}
.sm-addon-summary-label {
  font-family: var(--font-d), serif;
  font-size: 14px;
  letter-spacing: 0.04em;
}
.sm-addon-summary-amount {
  font-family: var(--font-d), serif;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* ---- PRICING STEP (Sprint 3) ---------------------------------------------- */
.sm-pricing-table {
  display: flex; flex-direction: column; gap: 6px;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 10px;
}
.sm-pricing-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-radius: 4px;
}
.sm-pricing-row:nth-child(even) {
  background: var(--sm-cream-mid);
}
.sm-pricing-row-custom {
  background: var(--sm-gold-pale) !important;
}
.sm-pricing-label {
  flex: 1;
  font-family: var(--font-d), serif;
  font-size: 14px;
  color: var(--sm-navy);
}
.sm-pricing-label-input {
  flex: 1;
  font: inherit;
  font-family: var(--font-d), serif;
  font-size: 14px;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--sm-navy);
}
.sm-pricing-amount {
  display: inline-flex; align-items: center; gap: 4px;
  flex-shrink: 0;
}
.sm-pricing-dollar {
  font-family: var(--font-d), serif;
  color: var(--text-mid);
  font-size: 14px;
}
.sm-pricing-amount-input {
  width: 100px;
  text-align: right;
  font: inherit;
  font-family: var(--font-d), serif;
  font-size: 14px; font-weight: 600;
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--sm-navy);
}
.sm-pricing-reset {
  background: transparent; border: none; cursor: pointer;
  color: var(--sm-gold);
  font-size: 14px;
  padding: 0 4px;
}
.sm-pricing-remove {
  background: transparent; border: none; cursor: pointer;
  color: #b8423a;
  font-size: 18px; font-weight: 700;
  padding: 0 8px;
}

.sm-tax-toggles {
  display: flex; gap: 8px; flex-wrap: wrap;
}

.sm-totals {
  background: #fff;
  border: 1px solid var(--sm-border);
  border-radius: 6px;
  padding: 14px 18px;
}
.sm-totals-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0;
  font-family: var(--font-d), serif;
  font-size: 14px;
  color: var(--text-mid);
}
.sm-totals-row-grand {
  font-size: 20px;
  color: var(--sm-navy);
  font-weight: 600;
  border-top: 2px solid var(--sm-border);
  margin-top: 8px;
  padding-top: 12px;
}

.sm-summary-val-total {
  font-size: 20px;
  font-weight: 600;
  color: var(--sm-gold);
}


.sm-toast {
  position: fixed; left: 50%; bottom: 88px;
  transform: translateX(-50%);
  padding: 14px 22px;
  border-radius: 999px;
  font-size: 14px; font-weight: 600;
  color: #fff;
  z-index: 10000;
  display: inline-flex; align-items: center; gap: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08);
  animation: sm-toast-in 0.32s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  max-width: 90%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sm-toast-info     { background: var(--sm-navy); }
.sm-toast-cemetery {
  background: linear-gradient(135deg, #2d6a4f 0%, #3a8866 100%);
}
.sm-toast-customer {
  background: linear-gradient(135deg, var(--sm-gold) 0%, var(--sm-gold-light) 100%);
  color: #fff;
}
@keyframes sm-toast-in {
  from { opacity: 0; transform: translate(-50%, 12px) scale(0.96); }
  to   { opacity: 1; transform: translate(-50%, 0)    scale(1); }
}

/* ---- RESPONSIVE ----------------------------------------------------------- */
@media (max-width: 1100px) {
  .sm-header { grid-template-columns: 1fr auto; gap: 16px; padding: 16px 20px; }
  .sm-progress { grid-column: 1 / -1; order: 3; padding-top: 8px; border-top: 1px solid var(--sm-border); }
  .sm-body { padding: 24px 20px 100px; grid-template-columns: 1fr; }
  .sm-staff-aside { width: 100%; margin-left: 0; margin-top: 24px; position: static; }
}
@media (max-width: 720px) {
  .sm-step-title { font-size: 32px; }
  .sm-section { padding: 20px; }
  .sm-deceased-card { padding: 18px 20px; }
  .sm-footer { grid-template-columns: 1fr 1fr; padding: 14px 16px; }
  .sm-footer-summary { display: none; }
  .sm-progress-label { display: none; }
  .sm-progress-step { padding: 4px 8px; }
  .sm-progress-step + .sm-progress-step::before { width: 8px; left: -4px; }
}
`


