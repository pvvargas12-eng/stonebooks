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

// Carving reference photos — embedded as base64 so they always load.
// (No filesystem path dependency.)
const FLAT_CARVE_IMAGE = "data:image/jpeg;base64,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"
const SHAPE_CARVED_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAEFAqgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0u7j024K6frlus6WNj5NmsUiqq7mby2/4C3zfKv3v++qzkZo7bbZ3UsVkvl7bqf8A2dv97b95v/QahS4/tTUdOs21Zbeea2Zrm+eJVVY9ytHH8y7m+9t+X/gVAurHVLmKa11S3tVt7mOSBpV82KeONvmjaP5v4m/9B/u0EF17OztdRe6vrf7VcbZLq2Z3WRZJlb5Vbd/D833fvLtoub7TY9VRZLpree8b7HZz+UskK+cvzLGqr95v4f8AZ+7/ABVVFrbyXc//AAkG97iHUpI7uW2VvLtppP8Almy/Kq/Nt/75p9vprWd9e2NvdMlvYrM0W6PzGkmWFV3f7K/N8v8AFQBqeZof9oRat4d3bYY2jtp1kbdFMsn7xd27+Hcv8X8S1Qgaa30u1ur5nnn2zL5T3fmebt2s0nl7V+WokvPFDaU/2xoJWhjkmsVtVWONmkk+6rbvvbVX/vn/AIFU8zapHLo1vJDZW94sH2iVI18yGKP7u1m/iZl+7/tNQBX0mPTZrp5pLi/0tF0+O4jtpfm2/K21W+98zbpG/wD2Vp2latpd5osrf2feNb2/l7buJv3aruVWVl+9/vf7tWdes7W68RNNqH2yCCzu1jgeSLbJc/Ku1drL91m/8dqlo0ba0brVtYvILBbO+ka5tlZmWWNlb7rK395d3/AqCynf/atP1WzsVs3tYIdy6VAyeYsjM0ci+Yzbtv3mb+H/AOJ2NMvrrS5tO02SG4il82ZZ7ae2/c2lq3zMu1f73y7f4vmqtc6X/aj2Gn3klqn9j232pZ7W6WNZbj5mZf8Aab5v4l/iX/gKXFxbsFW1upbq41C0W8aWX/V7mVlVY2Xau3c23/gNBBWla4j0r+2Ldmt7i+vPMSJWabyrdm8pv3bbmX5f7v8AwKttJrGO8ljs9STZI25tqssk/lr8v3l3Mq7vm2/3mrIvLryzpcmmzRXVqulLDJcyfK37vzF3R7f7rL93/aqWKHVtUtxa3TRW95o9z/aFtPuaPzG3Kse7+8u75WX/AGf9qgBsutap5y6b4msYk0nz2ur6C5tZFm/0dlkhkhX7qt/Dtbb/AOO07xNq2rW6QXUemzx3U155yWN9Lt8uORlXzG/h27fm2r97bu+9WvEu28uJLi8R5YbFodVe+fzPMkb73zL/AAs3mbv4vlrLa8k025s7rxFbwfaLyVpJ2e0aX7JI21VaGTdt8vbt+b+Hb833qAJZLWxtbWz0/Sb5L+ePzN1y92ytAzN8qqu1Y9q/e2/7S/3qn1jWo7zxVFceZLcXV4q+bHbeX5W5V+8rSbVVt3/AVqrcaTNDqCXVnJPdNp902+dZY5IJYW2qsnzMvy/M1XV03+2IbxfMRG3SNbL5G5ZWVW3fKv3fvf3l+9QWU7xmvIbe1j1KKfVre2aaLUFZo1tvvLuZtrbtrN8397d/u1Lq8lnNpVw3g3WJ7yJpPtUttt2/2hHbRr5jfN935pNu7/4qq8d5qix29reQxW9rcT/Y1uYJFjWeRfmjjbc33lk+Zv7392tFLq1sbB9SutSs5dcXzNNg09m8yOKNtv75v7zfM3977v8AdoIMSzZrOGza+1y3gfUNHmkudPV9rRxtt3L97+Ffl+X+H+61WNKhvFm037HIqQW9jJMsksu1o7eNfMkaNmbbtZlX93833futSHw3pOk6GmnzabaXt5M0f2PbuVdzN8yqzfNt3Lu/u/N81LpepafcTWclvb295pdnFJaytBJJIsS/xK25dq/N/wCO/N81AHGeMvhD4d8UPFZ6tHPa3uoTxrZ2MbM006s3+sVf7u7+L7v+7tr54+Kn7Nun+E5b26uLqdZ4ZNrN9q3bW/2lb+78v/j1fVtv4m0/4c6Pf/ELx5eQWepN5i6VB8u5odq7W+b940a/7W35lb5dv3viD4pftNXniz7VY29vayyzSeS8iJ+8b5W2sv8AD/F/DQWeQa14X+y3KQwyI9x8qpEq7WkZv9n/ANCr3H4K/sr6l8TNWtf7YjvYtOjlj+1XMC/u9u3dtVdys27avzK21fvV1X7Nf7IfjLx9eX/jb4lWtv4cstHj/wBVqTNDJJuX/eXy2bcv7z/vr+KvsbRP7UtfE1lb+DW037HZxra3LXcbLPbTKrL5kax/u5NqqrK3/oVBBz3hHwX4N8E+D4tN8G6w+iatper/AGhdPvoGlkvWZfL2rJ91dqq0ix/Kq/L/ABV59+1t8M18caCvjTTby4sb5dNmmgigi3eb5e3zofmX7rLub5f/AB7bXqmj+NbO417VIZvGGjLp3iX7Rcagt8vk3f8AaVo29Vj3LtjZvM/2d21vvKzUmmeA7q38AJYyTR3uqRtdSavtlVoLbzNrbfM3bdzKy/u4/wDZ/vUFn5o+ENeuvAvirTvE2nzNZS28qzLbTybmVlZWZf8AaVl27l/+Jr9VPhp8TtL+LHhm38XQtaxC6S33IrfvYZGZvMaT/d/u/wC1X5ufGD4K6h4V1K6ms5kuLWz3SfMrblVm/vbt3+Vqx+zx8aPGXw5ubjS7WZLrSVZo7yxkg/4+YV27drbvlk2+ZQB+n2t6lcRiXS9N8+8WSWSNp4Jd3zSNtb/a3NXmPxZ+HOn+JFs/C+m+es8OlLNH9pgZpI5vtLKrNt+X/ln91l/hb5a1PAXx28G+ONC1G485Li9a1WOO2gXyVimj+by23fN8v95a6BI/tmieIPFGpSXUWrzXjR2ybV+ZV8vcrM3zNGu5qAPnN/AerWutW/8Awjtu2p2GrW0n9rzrF5axTRyMv3f4W+Xb/d+Zq2vhJpuoSeDrjT7hla30/wA61tFl+by9zbtrMv8ACytuVfm+Wut1PQfEWi6DBqVrMtnZ32pXEd5Z+YrSeXG26aTcv8LbvlVd33m+7uqO5s2j0TWdas9z2qy263kCzr5El5uVlhZf7zR7fmX+7QQcDpU3iL7Tq8c2mrLP/aDNJO8jeXJt2/Z45Nv+r3Mu1f4awrq4/sXwrrOmyeH2lutQtluJ2WVligVm3bVb723cu37zbv8Adr0rTYdS0PQr3TdasYFv7iJbq5s7Z9qyxsu6P9993dtX73+z/tbqwbfwfpbfDS/0fxJrDQeWsMkf2ufyWitZvlaNvlb5l+ba33fmWgs5fw34L16G20tdF3QS27SXi3Kx7mlkWPzdzbl+aNm2/L8u7c1b/jW88H6frnhrUpplVrfdDfTxKsS/NDJu+Xbtba393/7GuM8d/tQfDfwLob+A/Deuf2lBZtGqNE3nSy7o9u2Sb5dqr/vV4j4v+J19r2gT69/wjsCu08lvti/erHC0a7WVV+7H/F/n5Qg9B/ag/ae1bVtGbwP4fuIreJoIYbZrWJl/ds37ySRmb+Lav/Aq+evgN4R/4TD4v+EPD99C08d9qsazpvXcyrukk+9/sr96ua8Rax/wknn6g0nmttj3bl2t8q/7P+fvV9HfsN+E9P8AFHxdefUI3W10mzjuoHgZlkhZmZt0bf8AAV3f7O1aCz9I/Bfh+x0fSr/wPpslxLYWsUcemRf6vzPmb5W/3Vb7zVqeJbVZriKzvmRmWVWdLaVWXy1jb5f++l3f8CrD/tbWrfxDYWszLeWGpK0n71vLkaPavl/N97/nnV9pPM0Hb9hay1KaRluVWJl8xdzbd3+193a235qAPPPFGrW9rLf31vdPPqStJ/Z8USNK0kO1trSbflj2/wC1t+7Xz/q3h3bpn/CWalMt3q99qKrdLv8AJaBYVWTzl8z5VX9ztVdzf7q7m3fSXje6s91r4fjvr2yurz7Pbz6nOzR+VZtuZvlX7zfvGX7v/oNeDeN9JurrVbzRfDsk91olrB9qa78raqqvyyeZu+6zfN8tAHn/AI5uNUbxTqn9oNdXV5fQQ3iS3Sqs9tcK0m1WjVvlb5Y23f3dq11Fnod03h2z1b+0IkvbG5VXe0gbyvLZtvnKzfMu7cy7t3y10ug+CbHUnW+vI9RtYGkX7ZHdQL9tkjkXavzMrMy7v4l/u11Wu6foOg6Frc1j59xarp0k0izuqxtt3Mqtu2t8u35vu0EHn/xn8QaH8BdBRbyaV2WNms9HedZVlk2/u93zfMvzf7P/AI7XyL4Ts9S/aO+N+lv4+1q4vEk3TahuVU8u3jk+WGPb/CzMq/8AAqpfED4j+Lvil8RoLXxtPJM814um6fOIEX9z5uyNv7rf3v8Avmvuf4f/AAJ+G/waaXS/Cyy3l/qEEck91LGz3MrNu+XzN23btb+Ff7y7aCzBvJtD028s/C9jY/2Wl1a3C6RFafu41jVWaZdu5lZmVfl2/wC0teW6tdSaxeXmpaHfLLBY/wDE0l1KCXbGrRx/u90f3d25VXcv97/eau8+Ibafotst4un3VneWemXWn2MuotH5bNM377du+ZW27WVl/vV5jayWP/CK6DZ3FnZ28+oJtvol8yGRo/4WVvM8tt25lXdu3f8AAaCDI8c3q6loGnXUPn79ckb7W6srQLdbfmZWX7rbtv8AvfNWPp8NnqTWbaO3mrbywyWP2lv3bTLJuZY2bbt+Zfur93dVTX4ZtLe8s7W6eCzuv3cu+L/X3SruXav8P8XzL8taENqt5Z2Wg2sb3iyT2c0crweXJFub955bfKqrtX5qAPq74TaTq3hfw34h1TWvD63U940moWl5Fcxzqs0m7b5a7v4v721q+FP2h9U1pvFCQ6lbzrO0Tf61maRfm/8Asq+xPhxqX/CZab/wmUck9hBpNo1vbXkDN5McayNHH5i/dkb7zbm/2f8Aeryf9rjwf4P1j4PWHxM0+xii1zR9eXSbm7ikZYr2GSFm2+SzfKyyKzfL/DQBf/4Jy+ONUbWfFXw9b7Oq6h4cmuraX7Mvnt9nZvljb+7+8+bb83/fNfX1tp+k6fpuk33iTUr1fJvpIbS0itvPjlkZd0e6Zvuq277rf3d1fn3+w3pt9qHx88OQ6PeNbyx6ffSM0cas0i7dvlr5nyruZl+b+H/Z+9X3lrE019YadoMl9Z3qTXUccTeX8un3C7Wkn8tW+ZV2/wDAttBZk6rdTa9badrWseHbW4v5pYbWeSeWSJY7qHd5ax+Xt+Vvm3VraLDDo/iDUdQa3ungukkkvGuoPMkjuvLVY1/55tGq/Mu7d8zfe+9R4hvreO8tbWa8gup5HW4/tC1Vo4Zf4fOVW+7u3Lt+Xb81aGgR65qXh6wuF1JWumRZkaOJm3SbmjaGb5du7/ebbt3UEFfVvtU1qul6hfW8Ut0iskU86ySND5ny+W25lZvl/wCA7qFbWo72K1s4Z7WWae4hgklSPbItuv7yTd/Cy+Yq/wDAt1ZDw3GoXdnJD4d1K4vLpWkkil+b7NI22Ntqxqqsvy7tvzfMtaN99o8NtcR6LJqW+TbNdNtWRtzMqzNGrbtsaqqq23+GgBNNkvtYFh4quIUg1G6Vprxtu7zFVfL2+Wvy7vvVU/s++s5G0+za4vNOs7ySOJfL87datHG0cm7d+7+7J8v3dv8AvVKmoR25ns7fT1v7LVHk8qVHWFY1j+ZW+b5vvfLtX5v92rXhDxJ4g0m32yXDaXLqUbWMksaxyf8ALPbuZtvyrtagCCG1m1L7RrWi3V/LFYrMzfaVZVk3MrRs3yruX+Ff9mpbbWLrSdKisbrUlsJ2ZmeJLlZZFkmjba3+zHtVmbbV1/E2rW62VnpurRacmmpD9pikljVpFX7rbV/4F/erP1D7Vq0aXmqfYmi1CDyby28jylXbuVm3Rrt2/wDxVBZY1LTdNh0zRlmaBrW3uYbi2ll2x+XI33dv8Ss21du75vvVBpNjDH4nW+1jULJPtCNDfXSNtWP73lsrL/F83+1/47TtWWzvNLsvO83Urm4lWTULyWJWZpl+WHy9q/dX5f8Avr5v4qffXX2rTmkhtbJGurqPzEtrONodq/LIzSbdysrfe/75+WgCPTJtW1aybUNUtVupbdd0c63fmRyxxybo5PMX721vl3bdrVb1ix0+Ga8uLiZftUcsLWbLF5qyfN+8VZNu35W+8y/7NUNI0e80vQls9QawsoY7b7DPFablhkkZmZdvmNuXdt+7/tVdu1uLiyljs7WySCSz8zbPGy+VGq7mVZP727/vqggh8Q/bI9d8lVuV06aCO63T3y7vMVmZo5GVW/d/3V+VvmasZby403Tbq+a6iuLeaBre2Vvmkn8z7s3/AH1u+atqazuLHw/ZteKq3s26ZY41aaRpmXau5vu/Mvy/3dtSXn2W3vH0nUGnguLiWGO2aRlVbKTc26P7vyx7pN3/AKDQBhPdXGjx3VvZtb6vdapdx7YEVWmkXy/vSbV/dxKrL83+6392pLS8vLfTreHdbqmqI0KzwKzTbo9vl7WZfmj+8zN/FtrSguNSW+v49L0v/SNLuls4GtLny4J1kVVaRpG/5Zsv95m2/wC192s22bT20dtNsbdd9jbSMkDS+ZHG0i7V8tl+bbtX727+KgDVvdJs7ezXVNB89LWGe3VZbld0kkjM3nfvG/vL8yr8tVLzSbferWdveSxLBHdXP79mVdv+rhVl+XzN27/vr/a+anaWt5dWN7p82nwXVvayrqEXkKzLBtVVZpm/2dv/AAHctS3DatcWxjut6pN5duunqyxxy7d26T5f4Y1bczM3/wBkAFtZtYu91Ha3Fvarp627Nczs0sk3mNtVV3fNtbd97dWleNb+JtCdtQuIokkjjsbOOdZJJPmkbzNu1vl2/wC7826q7atqGpJYW91dS/ardY5JI3VY4/s8irHG27b93dHJ/F/FV+S8m03SUs5tJlt9S3fZ9Q/dRyeXtX5WhVdzL/eZt3y0FlXVbdboWWnyTac95G21IrlmZbb5tu1lX5fM2/d/3apQaXbtqVlfW8jpZ6DLN58iybpJJP7sbfKyt81Rw+KLeG/i1KHR7hrW4sZGtrmJY/Ou7rdt/d+Yzfd+9937rUssP2W2vP7L1CH+0vLt4XZn8tZJJP8AWSf3Wlbd93/ZWgg19HuL5r9pLr7PE9rBM1rdO3nSTx7t0m5W+626q2l6frVx4YlkvNH0u8nbUvLliSJlkVdzblXb833fvMv+zUketQ3WvXXiK4WVvs9qukql3crHJJHt+8sfyr/s/d/iq7YWdnJc29xcateXTeQy/Y7P919mkZW+Vm/i/hb5m/ioAyTpN1a30WntJBFb6XHI0EHmfLL8yt/F825WWqF9I0bLHdWa3t7NukW2jgVptzN95fmX5lX/AOxq+ml682jz+dbpFDNcx3UlyzfN5Pmf3v8Aa21et9Qj15J9Sj3f2pa2bM7JarJ5arIzbvM/hVdv3v8AaoAq6fdWdro+oto9uzOtt5MqxrD5cSsq+Y235tsiqzfxbvm/4DUviHUI7FLBdLvLjW7q3s4YZYmX5ZY5GbzJtrL8u3cv/wBjVVrWa40tbPRVilS48n7WtpK00cke5Wmmkk+6sf8AD/D8y7qfJDa2++bT2tdRuNLlkjWBG8mRY5G3bW+b95Gqx/L/ALtAGl4hk0u31rS7zRdUe40++Ty7nzGjWe0j/wCWkkm35WbbG21f7rLWNp91fX0n9pLC6aXqUklist1E0k8twzeWy7m/vL/FUutw6X9u03T9Js4Eb7dHrUat8qyRyL5cki7vm2qse1dy7dzNRZ6eun2H/EwuGeeOXzo2Sf8AdwR7vm3fL8zKu3/d/wDHqCzT8Mafot9bPDHC6xXUkMywRfuo4plm8tWaNf4VVfM/75oqn4Pa4t9S0681aR7XzpGWLfbLBHPJuVd33dzL80a7vu/LRQBTitZF8UWfk6bLLd2tqt812qr5MEirt/1e77u75f8AgP3dv3tBLOGN57qNlSfyFkTUJ49rTzfe+Vfur/d3f981zbX0N439pXkjXk8e6GfyFaONYWZm+X7vmLu+X+Lc1betLZ3GpPbrZy6jYXH2eO0luWZY7aRv9czMqqqxru3R7v7rfeoIGak0f9ipHDGl1psk9vfagsS/vWmZtrLJJ/srGv8AwGq1nbwyWcskmqWf2rypLjTolZpGkjZmXcq/xbfvf8Cq0u6PRLKSzvp4IJlZru8ngXyJVaRvmVdu7b5a1l391dXEM9nJp7Wu7/R7GBV8uRbPduZv+mfy/wB5vvMtAFx5rfVoNU03UJLq6dZZIbaBY/3kskO2Tc21f3a/M27d8rbafPHpcd5Zf2hdb9SmtI47WD5mVppFbzN23721fL+b7q7qTzGW1bSbW6s9Lim+z/abnyG3SQ7vMk8tv9Zub5V+XbVWy0ua31hryGadIJra4kWSSP8AefvF3Ky/8C3bVoAl0Sz/AHz6DJavLBDY+c946s32b9433mZm3Myr8vyt8v8AdqnayQ6lLcLrFutu+mr5cUTOskjed+7ZpP4dyr93d92rlrps1jpUH2W+d7hYIfs1zO3lLHCzN5zTfxSNt+7u+VasQW9vD9ttbySK4a8WS6uYoPL86SRo127t3zeXujVaAIrPUNNvNTspLqGC126f5drKksa+bcN8u3+Ld8q7m/3aZpuoeG20RrqO3uHljaGP7GrKzecv3WVdu5YlX5mb/a/iqO+0/Sb7VXs/7J3W+jvDeMyfu5lmb5mb/a/9m21Z0mT+0En1hl+z3UlzMuzyvm8tdv8ACq/N83l7v7v93dQA+Wzj0/TLVtsrW8dpJMkCuu1fMZWZv7zL8v8AFT7+zh0fWrDQdP1Kef8AtCdbi5SKPbJ8v7yNWb+Fdy/N/e/4FUTXEkj2trpOmpPBDKq3cW5bZZLf7u1lb5vl+Zt3y/e+WrMVja2+q+ZDqEHzXW6WWRG89pJG+Vo9y7vLVdy7mVaCyDw/9o1KzvG+x29nLdWc15eTySMzfK3y+T838Xy7v7tWtNaFoft2jx3VxPbtJDLaS7l2q0as0m6T721trbV+X5v++sTTND09U0jR9Q02VYri7uFvl0+VV8qNm+b5vusrL5e7+Hcv+zWrqOoaouoMt5qC3NrGy2tj9mlVVvWkb95uWNflZVVf9n+H+9tAI7DXrxknt7q1WKVpF+x+XbeYsnlr5kkjf3fvfd3Lu/8AHatajbwx6hBqF5rkDPprw3U8CxtGu3czfMu3aq/d+X7zbvvVPosa2ttrP9qasm1bZpovKjZvMuGXb5e7+H/abdt+aqNlfXk01k19o8TX9r/pUSzyN5MlrHu+abb8q/MrLtb+FaCCpNYx6fqWl61NostxdatpjTfZl8tYI7yRvlmZfvR7vlVW/wCBU+HRfEGpW2mafqmn2di9q01xcxqrTtHIq7lWTbt+823a3y/3qlsLqz167utc1a3t4mmZoYp926NflX/V/wAP+18y/LXPeOPiR4b8D+M9I8I+LPP8/wARWzNHLFK0ix3Hy7Vba275l2tu/wBpV+WgDpNUuNPh0SyvtShvYljs1/18qst3feY37v8AhWNdu3/d21FLqnh3wj8NNR8deLrezRZt1xZ6fbS7YJJI2bcu5fvf7X97cv8AtVFY6Ppt02nXWvTK+g6PH9qW6u3mikib/lpth/ib5flZvu/+O18pftS/Hix157DwX4VjSXSNNtvJjii/dr53mf6tf4m3f8C+b/vqgs8y+Ovxs8ffFzW59Ou7VopLhm329qvEv91FX+5/eb5f/Zq9P+AP7Kl94YuNH8ZfEfRY0uLo/aLOGOVWaBfvRsy/73y7vm/3v4q3v2bv2YYb7wff+PviV4fuINWupGs7bTvN8tltWj+WZWVmZWZvl3f7NfWng2x17wjc6c0N1fpdabaR6fqNi0EM+5dv3vM+Zt21W+b+Fd26gg5rw74i8fW/hKw/4SrWvD9uytNJfWMloy/bbdZN0Mkat975flaP+Fm/h/il+Iviq802e11Dwn4V8+xvmur68SBo7aSyuNu1VVW+aTc275f4fu/d3Vrr4f8AtiS+MtWuLdodLuvsOnLcyxwybWXc22NflZd23738S7vvLWf4a1rS7dfFfh/XLe6e4hjuLfUEuo42/wBMVlb/AFa7W2qvlqrL/e/3qCynr3g/wL420u68K6xts2htodWg0qSLy7mW48tvOjZl+bzNqxtub5d2771dVoXi6PWIfEfjiOG5tbeN4b67iis/IjnvlWNbdpIfl3fLHub727b93+Ksyz0nRZLuXxNbyS2uqWujyWsi3l2rS3skjeYzSbvmZo9qqqr/AAyMv3azdWurjQ7K6s7O8t2tdSVtQ1lmkZv3m37q/L92Ndyqvy/Lu/vNQQcR+0hY+D/FyXn2OztYPt2mzTXk6R+VBLfMzN+7jb+Ffl/3d38NfAutzR+E9blkt5Glg1KCO4Vllb5Zl3Kyt92vo74zfEBrG3njbxVp0sFm3+ixQL5n2uPb8vy7d21fu7v9mvlbWNQ+1BmXZtaTd5bL8qtu/hb+GgDqrfxtfWrpeabfLBLcR/vFSVt25l+bcq/e/wCA/wDs1eh6V+1h448O/ZWm1ZtUsLeNmRZP4dy7WX7vzV4bpEi/abVWkeKKSVbfcv3lWRlVvvblr690T9iD4e+LEkhtZr3S3s7mSx3T3jNDPIqrIrbm+7u3bf8AgP8AvUFlGx/bA8Os9veXGj3l/E1jcW88cjMsW2T+L+9u3L/erIm/a40nRdYnvPDvh9rqBp47yCNpNq+ZHGq/MrN823au3+GrNt+x3pc0H27TfFhlvLedrXyPNbbA27bukbbt2/L/ABU/UP2OfDeg6tpejya9dPf6hthgeN/9G86TduX7v91ZNv8A31QQcD4q/bO+LGqXD/2PNpGnRXTtJAixLJJF8u3/AHV/i+X/AOxrzvXvGnxW+I1xFa6lqGo6k118r20H7vz1Vfu7V/hXcv3v71fVujfsn+B7PSrOaSOdr+Fd0vlIzRr/AHfMb5ty/L/+zXong3wn4L0XwxZ+MPCeh2e2NlZGWLzJ55I5Gi2/xfLIy/w/d3f71BZ8eeEf2X/HWqfYtY8ReG3sLO4ZmiSeJl8/bJtWNd3zbm/2q+1PA3w50fwPp3/CP6TpvnwXkv2fUJbtdslpM0e7aq7f935f96tmG61DULTwW2qbbeytZ5PNtF3NNYXEjSNGzMvzKvzfNu/irR8YWd5o+tNNpv2xNSa5hvtG3OrRz3EkPzKzf9c9zKrfw7f91Qg+Yv2i/wBmnT4dEuvHHg2xsl2xKrLFAsf3WXzN3l/xbW3fNt/3q4H9nD4jL8FZr+48XTS2UOpR7Vb7I3lztHuVV8zb8u7/ANmr7H8IXmnyaOi69HLP9qaSS+iaWHbbL9p8r5VX7yt83yt/tV4t+0Z8L9H8L3N4tnIk9ndRM09tJF5kDQyMu2SP+7JtZvmXbQWdNd/tmaLJNpt8vhuJ7K3X7PFqE8/mSLGrfK3y/N8rVtw/t+aLata6fr2hs9rcSfu9Ss925mX+Lay/Nu/76/ir5p+FPwD0/wAdQ6pfaD42uLDRrF/LezVFklbzF2ttZv4f4v8APy+taV+xj4R1Kyax1jxN46jls3WRXWKBVSby93k7vK27tu1lX/aX71BB6xH+0x+z/wCLrVLWz8faTa39xumlg1ndBNbTbdqrHM23+Lb8u7+H5avvqi+OLBtUt9Qt2sLO7WZm0yRZ4b2RYVVoZGVty7tv3v733q+Wtc/YX8cWP2zXvDfiq1u4o/8Al21XTvs3mRq25Va4Xcu7+HdtWvNLr4K/tLeFdet5rHwndWEV06r5Gn6nH9mkXd91mWTbQWff/hnXNUhtVuPGV0mnTxq11qUt3ErLEq/NGysv8O1d27+9XzH8ef2wF1Se78B+A9HRdI8qTS7nUJYtrXPmfM3lr/yzVlZfm/75+7Wfb6P4sa/tW1jWNWltYVmjuUubppm8lo1XyF/75q54n+HvhnxhZ3N9ocM+kywyqrN97cy/xNuX/nm33aCDwT4X3Gk/8LR8P3HijVEn0vS7n7Z+/ZvIjkXa3zfe+Vf++q+y9F+O3w98TR6jceF5ri8stJlt7XzbSBlb7RJ8ysvy7drNt+b/AGa8G1f9h/4keI9Gk8QfD3UJdUghsZrpbbUofIkuWjVmk8mRf4v7qt/31XP/ALKnjLSZNRvfB89qkAuo1vmfz1jXdHtjb5W+Xd91l/utQB778S4/+Ek8K6XfeZLa7bu4VZ2eNpJ5vmXcytt+Xavy/N8277rMq1z7WNr4sS9hj1xWa3s47qza5iWNY5oW+aNfl+Vl+7/20r1LxD4R8O3VnZ6HdSbdOkkmuo5baTzPKZV3Kyt95m3f3f4q4jxLpMen3lxo+h2aXFrdQW8ct5s+zSRbv9YyxyfN8yttZV/vLQB896qt9r1ymoakyy2qz+XPqSyrHH5bMqrGu37rbfvfLWv4b0FtYSNtWjv4LLS4lZ7m02syxrJIqzNt+8vl/e3V0WtN9l0TTvDsOnvdJcRzSXiwRrtiXdtWZV+83yqzf981neEGt7WG8m1LS7i4s7jSJNJgliVtsknzN5jKu35vm/u0AeseAYZNFudE0NdUl0nQ7WVlgligZo590i7VZlbayr93b8vzVzv7cetXWn/AnwX4dvLG3tZ9e8S32sSssUaySxwxrFGzbf8Aro33flr0T4J+FbXWvBmm+DV1BPsVxfNq1zc3KyeZFaqq+ZD/ANM9rfN/utXyj+2B8XtH+KnxC0nR/Cvm/wBh+EbP+y7RmlaTzJPMZpJFZv73y/8AfNAHbf8ABPSxvP8Ahbt54kt76W3/ALJ8PXkjttjZZN38LeZ93/V/eX5q+047qz8Jx3Gi30MrrNcq0/kRRyNJJIu1Zlb7yr833d38NfN3/BPPwfdSW3ivxdNY3UFleIujyTtbebHHtjkZm+X5t3zbd3+1X01DrFw0UC3Wmq7XGmqssc7tM0bSbdrbl+b5V+bdu+X+KgsHt9Yh1mL+1NU0v7Ba20dnGqxeY0jfeVVb+FmkkWo3kbTdYnt9U/tp1j8yx1KK08vy1vNv7uRmVdv8X3fu1m6v9hW507Tbe4gaCPVY9SliW58xZNse5Zt393d8u3+Ld92tmfTY7O01dr7aln4kf7RFB9p3eXIytHCrLG3ytu3Nu/u0AMsNS1y3ubKS4a8t/ssv+kq0ayfKqt5MiyL8qqzN95v7v8NUbO+16SSVdcjs7XUbhWWNY7zzJ1uG2tuZm/h2/e/u/wB3+KtG8k+3ajDCtm8UU2mxwyx2115nlqsjLH91vvSMzf8AfNUtV0+S61m1b7dEtxpc7NbSpGqySbW2tu2ttaRfl/2fm/ioIOmsZFuGvNPk094LLSbNrHb9p86Fb6bcyybo4/mbcv8Au/L96sP7R4m0FW0nXrGCLUdLs1t9PZbqOZZLdl/d7l2/N8y/w/M27/eq34g1bTdNa1sbX7QratZ29n5jfuFnuFk3NJt3fwtIq/7O5axtVht7W/8A7YhurifUVijtba2lVpFnjXc25pFVm2q3+18ytQBLo9rqF1pEviyGGwv9SZd0rbfJ8xmX+HzNq7flaTay/wDAm/ilmtbySwXXIVaxaaOG1ls2sZo5J7VlZmZV3bf+BfxVJCuk6SLhdP3Wv265+x3UTbvLk8z/AMeXbu+7/tUs81xcW1k11JPpzMzW+kQSz/vJLdt3mNH/AMs22/7TfL/47QAx7q10d7O6WOKLS76Ty/IikWRdrM3zKqttaT5f4v73+9U89no9rFLHJp7bdSlmumVY2WWJW/5Z7fu/w/3fvNUSWcfh0aLCsdxZ2uoagsdzbXNm080Tbl2yLJt8uNv935fl/h3U+Gax2QWP2i41K10+5kheVZPJWX+GH5mXd83935d27dQWUzJqF9bL4T0fwzatNNctNJLP826Hy/maPb8v91fm/i/76q5P5d5YacujxssUckbT+aqrK0cf+sVWX7u3d/F/31V2PUv9DiuNQjnsrq3+0Wumvc/LHcxsv7xWZm+Zvm/h/vLWbfzSWKW81jHLZW+1rF/Nk3Ky7fuqv+s2/wB77rUEEe2GOK90/Q9a1GCCHUGktYLmVpLv955aqq7VVWj+bdu/+JplrZ+HWvLq11CZbCyt7ZrpZ7tZrmeeRlZVb738UirGrf7P3avzalqV9osE1vbz3mrLHHHcrArSRtCqtI0ytu+95e5mj/hVazbSSa3RV+zt8q+XaK67pJWVWaP/AHl3eY38P+z/AHmCyez1LxBrVgy+IrqLVGtYo5rptM3QQS267lVfl/ijWquqMvh/UbLS9LhWCyhuZm2LF5jSwtt3Krbdzf7NNsLzVNJSwjs7hrJtPg+yz+XtjaT5fmjbd/e3L83/AMVUtzJfaheQa1ZrBPaw7Vu38xv3c38X3v4l/wB3+L/eoIH2F1eaXq0mk6K0stnceZDqqyS/8s5l+WNv7qt/dWqSaPJNqdlY2+kyr9ql+wzxXLeXNGq7pJI2ZmVWZtrfL95v9rbWjYa9DNq8uk2trdT2U32eOW5tWjVp7j/WKsknzMrKzbfvU3RrG4ur97VvEF491HJNqkEkjq0kd0y/Mysv+sXbtX/0JqCxqW80N1qNxDptrBLpqrDKl9IsbQW7fLH8v+8zfKtMa6bWre6ms21G33SyR3MrKscn+rVVj+b7u7/KrU/i2PT9cfUW0ua41Gzura1vI3kbc08km5pPMZV3MzSN91f/AImn63dXUn2i6utPt1t/3K7bZvLkj8uT/WNH8y7tzfNubd93d/sgGRrNvfR23h+OPbFYR7o7lbZWkWCTd8zM3zbVZm27v9mrWnXmmzX09xqVrLeLpcrfZZbGRfLi8yNdqyfws25v91f9qn2mpXi2FurWL2CNd+SzeWs+5dv3pNv+03y7t27/AIF8t7UpLi+vLzULWzuGS3ikt57FrZYtzL/q5lVV2tu3fKrbvu0EFO/0uSzay02zt7V547lry78xf3bNJtaOPd/dZf4v9pqlMdvZ3kv9m30Gy+1GP7YsHyws25V2w7v7q/7XzbqrWOoSfa47PS9Sne8msZJvtO3dJdqv/LPcy7V+78zbl2/dX71S2OntIlno9jNBEki3E3mySq00kjfvN0e75f8A2agsl1XTdcj8TP4fs9LuGuId32NpJPMVoVXc3mRt95lWodcj+1XlhpfgnWrKfTbi6hhb7HEsC3fyr5kc3/PP7zbm+X/x6tK51KOx1Sw0+8V7XUbXT1haVZW86RpG+aRlVvl3fd+b+6tULfw3fXGsajeXGsXFusMX2qeOCBfLZfl8tfvfxbZPm+981AFKzksdP1G8hWbyNB8jyYo7bzPl8v5t3mL95d3+9Wpex3l897qFvui+w3Uc19HKqwySqy/e2/KzL833qwtS1bVLWXTtN0HTbiz0e6imt2ggVbmOJpGVfOmb5mX5du3b8v8As1ZaO11bxUy2d0j2Cpdefc2LtPBtWNfmmZvl/u7f7u3/AGttBBdW601Yv7as9QlWe3kWx2tuaRmbbuj/AHi/3tv+7WvbzaTpviyLTZo/sH2PTo963n79nm+b92u1flaT5V/+JqJ7PTda0Wex0ForWLS7S3voopJN0fzN8zM38W7aq/3v/ZsPUpG1yGeG802WytbhY9SWSBlWfbG25W+791t25VagDo9N+1a9rSeIPEWl3jXkclrYtFJbeQsEbSeWqwxs3zK395d33f8AZop2mWun6l4jfUPE2pajaz2clvDZ2rbpo/tHy/8ALT7qsv8A47uooLOVXT/Ov7mPT7dona5mWxs1l3N8y/Mv/jv/AI9V/T7iHQba8s/tC2sFrAsMW5vM8u4uG+b5f7qqv/oVTssetaxf3UOtW7XukwSXFiqx7muZG/d7W8tdq7VVm/u1RvLWa303Vmt47p4pLuFnvJ1+9tkba0a/daNmb/x2gghuvMvJ5fDuoWs8UU3kxr5UayMyxs3mTfL8u5l/vL8tWo2uGnutSsdQSC3vmh8u1ji8yVfl2srfw/u2+Zv9qqyaPDawz6fHJLZO0sl1tgn2yTyKv+r3fw7tv8P8Na1neWtvPeWOk6klu0cHlyy7v9Y0aqzfM3zeYyyUFmbG3mXE7axY3Go3UlzHD5cs6tJGsi7dy+X8y/7tR3/2xtXs9BjsZ9Ye+fzo7mORVjsVjh+bcq/ej2/d3fxbmos7ePw7DFeQs9rBdNH5l01s0snl7fmVZPvR/wAO5v8A4qnIy6PYS6fY6pfy2t1PuvJ4p/lZWVmZV3fw/Nt/4FQQT69qEmmx6RpOraXb6NPdadaxwRSs26+aT7qx7vmZmX5vlqKw1TUvC8K2sbPPBJH9j8hots23/aZvm/8AHt21af4q03WmlS48TaXLZ+JV1hb7ToLyBpGiVVVVZtq7l+XdtWrj2tr/AGbeW/8Awk1xevqFzCzbmWKOP/npC3y7vM+Vtv8Ad+ZqAKtlNGuqX+qafY3jXVqvkqsiqrL8u2Nmbdt+9J97+9ups2l2dvqSaTrF1bfZ1l+S+lZoP3zR7pNqrt+Vm2r/ABbvvNV3SoYZtD8Q27XCSxbLry1idVl3NCrRtub5mWNY/wC7t+b+81Q6zZ/2fq9lZ3kNqllcTxzfZlj3STw+T8zN8v8AD8391fmoArSaXqWmxT6svypbxSXCwTxNIzSTLtaNtv3V3bflb+7TEkuPD+g3+tWd81xPcRW9rFbNHJ5kjbv9Tu2/d2/e2/NUt9qUk1yt54k3wWckEyxy206tHIrSbl3f3V2t/wCPN96q9vbx2+nSw/2XarbreNDYvcytutlb5Yf3n8TM0f3v9lvvfeYA3/D+k6fp6adJdX1rYNcNNa3LIsi+Vb7Vbd5bfKv7xmX5vm3f7NYs1rHpafaptQ2r822X7NJ5bR7t0e7/AHv73y/3flpdU0XT20iz0PS5p9Ue8fztSldWkjjkjaPbGqt8yq3/AHy1Wk/sll1lluEllZ5Lq1jjlaRWtYVXzFZdu5drN/eX7tADNSjtfCdzqm3ULJtbZ2t7mVZd0LW7LujaNfm27f4v73yrVPxFJfWq3un/ANk/6ZJLCs7fL5ccLSKvzN96Pdu2sv8AFUmlNDqXh7VtYurO233lnHdNLtXcyyTNHDtb/d27m/8AiVq6txfTJdNeWcrXtv5k0/myybmjj/1bNu/u/N/n5aAJdGtftF/PfeXZtpsbTXF48a7odvy/u1X5drbtq/d/ir4+/aX8TWuoeOF8SXFxFLdabOsiRfNG3mbvm/4F8q7a+t/Ec1x4H8Es1jMsv262mup5Wb+9tWNm+6yt977395a/Nj42eKlvtefTdPuor+WFv9OuYFZYvM3N8q/99f7VAHQePf2ovG2tWX9l6bdLBYNbNbttjVflb+H7v+f+A16H+xx8GX8bavP8UPiHNOkGm7rfRVu2Vt1wyqysyt825lb9233dys392vFPgP8ADfTfih4/0jTvF1zLZeHLi8WOeVNqySt95lX/AOx2/LX6h2PhXwjJZXk2nslnBb2jXFppzNtW5+z7mj3Kqr8zfNt2/wB2gsgufBeoa14SsrO8ay0nV/COuTR3bSytdtd2caq0McbR/Kvzbflb+6rV538X/i5deD/FaXnhG+Vrqxna4a1ddsbRqrfNIv8AFuVvu/73935vWr7xt4R0P4S6vZ+GbjUmtVs47d5bxlk8i4XzGk+Zl3bmXbH8392vzL+IHxIvvE3i7+xdHvFv7jULpbdHnkba27+Jm/3dv97/ANloIPuf4YfEjwL8aJUtZPG2neGvEasrTySR+XHA0cbMzRwt8sm5m+X5v4fvfL83RQqura7deILfUpU1u4tZLPUWSBZPte1dqyL5i/Ltj3N/+zXwRrvwH/aB0O7sm1S2RNsvyS6czSSf89FVW27t38NbelePPjp4Tma60Wa8sp2tWjWW5gjaSX/np97/AGf/AEKgs+0tRvNL8EieTXPEis0KtHbTytH+7hjXbtWP7zbv4vvfer5r+LPxk03ULy60nR2ngdmVbuRpfs3zf89PL/5abt23/gK/3a88ul8deNomvvGmoXNxPC3mL5rs3y/d+VVX7v3vvMv3Wq//AMK/tby2+zrHqM7rL8ySRRqzLtVtzSfeX/2Wgg8X8c3V9eaw01xfJcT/ALxZGWfcqyfNt/2Vrm3jmkuHa42P8zbPm3N97726vYvHXw1h8J6JPcNG3mrJGq7m+WXd97d/dZa8x+xs0v7uN9qqrfL83y7f7tBZqeFNLm1rxl4c0vTYvMuNQ1WzjVfMX95+8Vm+9u+X5a/S/QdB1jTbd7pb57V4dQbUneWJZ4vtVxtjW2+X5WXy4d3/AAJa+X/2Q/hLHrV1efEzXLH7HPawKvhyWd9sX2pW3MzfN/Cyr/49X1poNnqFjosv27R7ie/sYJNL8xm2/adS+aWS5/usrR3MbLt+X93/AA0AZOm2Mk3hy80tbqK11a6a3s4rRZVgjnjabd8zf7XzfKzfLt+WofEFja+FdIvdW8SNBcJoNy0PlWzr5i/vt3ysvzMrRt83+7/D/DvX8N1rWq+T9sRLDTZLWa5SKJY2lX7rfd3eX/nb/FusXmh2viBpdN0nS7ee3ZGupImfbNLDuZWVd3zMzUEHKWurapp+tJqWi6Ct7ceJLFWiu3l+WOFd0f3f7qr83/AqNSsdHsdAbS9LjuLPTY51kXYrNIsf2jdcNH8v3t3mMu2ukl8L2cN281vcMkH2No1s5Vkjmg2t93+9uZfm+X+9XL6nrkKwW9jpsc63Vu22KSJWkW0b+FZl/iVv7tAEmq6tqFvqr+G7zS59N8P6sslxFqCMv7to4Plkm/u7tq/Ky/xVd0PxNHrEN1daXdacqRxQ3z2sa+fNJ8vls3zbvLbd/d27v+BVzenagswurzxFsdVn2yx2ys1gsy/u90jSbtu5WX5W+X5fur/Fzfg/xJoel3E9ra3VrZztc/2g0TKy/L5ke1VkX7ysq7V+991f7tAHR+I9B+y+IdOWxs726srFfMe2kVV82SRo/l3N91V3blVv7q1n/tFeCW8UfCbxDa+E7iWTxH4Ps5NUnjZmll+ztuZtzL8vzbvl/wB2t9tc1rx14Q1m4+x/Ymm8QyLqGnzqsNz5fmL+8Xc27b5aq277v/fNbvwfjh03xJrjeOPFFq1lrkbWN3bSwKsn2Vv3EMcbfdb7q/8As38K0FnwF+yX8VofCPiuXwvrF8lvo+tRSRySSLuZZP4dv9373+dtfovpum/armK60HUrpYv9HvJ1llZl+9tjVY1+638O5f8AgVfmX+0H4AT4G/tC6r4c0/TJ7ez0u+tbq2glO5vJljWRf+AtubbX6h/CDT9Nm8EWeua1NBb3Wm21vdW0UTMzRq0fzK21v9X833ttADvE+h6tdarqNitnJf6NdQeTqEHmr+7aRWk3bl2qrN/vV5al54ihvF2zK+h6PoLXEkTwbf7PuFkkX99J/Fu2/L/C21m+X+L2bx54bk0PUbfxFqDQLod5bbbmXzWba3ktJHN/tf8A2NeO+Kr7SY5LzQdY+ywfatN8uSeCJlW5jkZm+WNW8v7zfxL8rUAc/purR3mhPqGrfYvtHy27eRF5nlbvmZtqrtVdzbtzfd+X71HhnQ4dP1LRJPE2h3EV/bxTMzrEsa3rTN/Ft+9/s7tv+z/s814HtZtN+GepTXC3kt1qmpSRvulWOeBVj2ruX/nnt2sv+9/u12j+Lpm0e81xtPS61HT7W3Wxl8/zIW8lvl8uT7u7738TL93a38TAHt3wt163vvDmiW+j6wjWXkfYZ7GVv3ltJ5zeYrf7LK0e5V/iVq/LXTvBcml/tcQ/D/QZFgit/F/2WNWbzF8tZt0kbf3l+XbX6BfszahdXTW8N80EqTNeak1pYxM0ljNu3Nuk3fNtZf4f9r/Zr4H+JElx4f8A2t73Wlvlg8nxFDefal+VVZtrfxbfl/vf7LUEH6CeKriS8ezs1s4oriZZLOWVoljhtvMb7yr91fL/ALv8W6vJfE8Mcd/qV5fW8C3VvKzOsksm25b/AJZtbru2qytGzbW/2f8AaVfeLzR4W8M2U00cs+pNafaNvyyfaZtrfvNv8O7/AID/AOzL89eL47qz1fRrzxFYxaXcXlysbbH3eQzKyr5is33m3Nt/3aAPN9Pt5vET2c3yxy6an+l3as0ckEaqu7+H+796uw8H+GW8ba28dvpq6dqmn2kl0i2kXm213826Ft275W+8rf3qxbbRbG11l7HWpPI8yP7LZzxSSbZ7iSNtrNtZvmbaq7f9pa9a+H1xqWi3t1caTpN00F9bNpuoIs7XMkcyqvmKzSfNG3zfdX7v92gDzT9oz43aT8I/h7b/AA/+HbWSa3qizfap4JVla0WT5ZFb5t27buX+7/s18r/Bv4X6h8TvE2m6FpentK99cx28bf8ALOPb80kzf7K7vu/7S/erpP2rrfw7pPxe1LQ9BmluIodqtK27+JtzL/7LXvf7Hvwrk034aJ8VLzWooNQ1C7vLezs2uVj3Qr5fzfdb5mZm2/7tBZ9IeCbHR/hL4BsPhH4H1qCVNQuVW+ZXVWuWWRt0m77ytt2/d2r83zVqQx2uoeGLDRbFbOW6mS4VfKnVvK+XduZv4t33VX+Lb/vUvhnUP7B0G40O18P2Cy3kC2btfN5vkMrMrTR/M3zNu/i/iqd20eYaj4bhm+y2NvHHdN+7VZ9q/eZpF+bau37v/wAVQQV/DkdvJY3Wi+JL6fSdX0ueHdarZ+R5Uki7W3Rqu7+H5fvL81VbbQ9PjdrizuNSSDT7lbqCV2WSSeRZPmaT+80bfdXb/FVq78Sab9oXWtSmlbUlWOO28xVWSSaH7rfMvzfeVfm/u/w1g3PjzwC1/PY+JPGmk+HNXkiVZ7W81BZLmNoW8zdHtk2qrfe/3v8AdoLNpNe8vSNe0+NbX7erQxrdxQfvlk8xWXcv8X3m+Xb/ALNRStZx6bdTaXZon27XriRrx1b95t+95cf3f4f9mqQ+K3wp8WNqmuX1091fySt5uoaZPGttEy/NuaFfvM3y/wDstZN58XvhH4ZtYr7xN4wi0u48z7dp6+fDHubav7xo9vzRtt/8doA6e5k0m41XTvs+pLqF5bywtA0sjNNYxt800aq3ys3lt5m1l/hrZtNW1Cb+2dUm1SDV5Y7XbaxNHunuVZv+We75vu7Wb/7KuXfx1pfiyOLx1pvijTtc03Wra4vrzUNKVdrTR7V27fl8tt3+z/eq7NttfElnqmpWcq6lp8lvcJGsTSRxqzbVkZY/uq3y/LJ8v/fNBAWV5psNnLp91I1080v2ppFWNZIrrbtVpFX5mVfMXcqtV/y77XALOZrWWXQ7Py7xJ28yVbfa25Yfm+bcys33vu1m32ltb3llp9wrxQLqH2j7YjLG3zSKyyLu+8u35dv8Sr/tVtarcXmqaxq99DqGqXiXltI12iRwxwW0Mfyr5jKv3VXd95vm3fd+X5QDKuW0/wDsmf8Asm1vP7RjX7RBGsrN9rVY90n+z83/AMVVPxVJazaPLdRybdU+0wtFLPFuVY5Nqss25vlZW/i/vf3quJJZtrVnZwxwJZfZfMs2nn8mBo/l+VV+9/u/L96otNmaGD7Ctv59leW21XnVZJJFaT5lZm+VqALuoabHcWcreINSdYtH1CS6trSfc3zKqr5Ktt2qrbW+9u+9UF5fQwwwW+ufZdUia2Zlii/167vmWBZPurJu/ibb/wACp2o6PY6fa6ysM15dPqW6aSCXzJFnmZdqrD97aq7fuq3/AMVRY6fdXjW8PjzSbJLzSVVrZdPnZY45vJ3bvL/ur8q7W3f3qAJZP7FvGs11LUrrSWs/Mmi/s/5lvm2/NG3y/Kyr97/eqnY28y2FxZzSW+m/bpVuoFllVl8v7saxt95fu7tu7+KtPSLPybq6h1KT+y/sdnJdSJefM1221lZbf/x3/wAerMu7q4bUntb7SXvNNVW8p12t5G5V2qyqu3crf8B27f8AaoAdo8djqU2pSR3n2ewheO3k3L5/n/vmWRY493mM0a/N8v8AD8vy1FbabCwmha1lhure5kvLxWkWNfObb5bLt/hbbu2/99fxVPpV1J4XttI0HTdPZkjdtP8APtp/Na0uJPl3Sbv9lv3jfw/Lt/vVQ0fyVfXrpdDns1t7yO3ZmkaZpZm27WXd/FtXd8396gstWul262tvo9vb+TPql80kVnJBuadlVV3LtX725qtX9qqzWTRzW6XVutvZyss+5WaPd8rLH91V+Xcv+7/dqJdPvL7xPpzf2ldROyXDTx20m1ovMk3Ky7f+WjLu/wB3cv8As0X15JHbX9reWrwbbxbG6VZNu2aTase7/nmyqy0AP0y3vtHf7HJdPA19drNFLLcqu2Nmb/ZX7vzf7XzVY0G18P6l4XuNY8VTXEUEcrQyJAzeVezfNtt93+18rMzN/ep0s0NrqkWuX1m9vayWLLZ+anmLE3zbd275V/4F/drmksdLtb+LSYdPil0G4imjuotSdVaO8b+7Gu1mbb8v7tdy0EGnHHr2ofY7rUNWtUnmkVr60iZVjWGNlXaq/M3y7V+Zf7v+1SvcX0N5eafNdPa3EmpSboIlkaSK1bbt8z+L+Jm+ZqS0/wCEoutKsobzSbWzi1C2uNNgWLy/MW3/AOWi7vvNuZtv95VXbWrDJN4X1TUrFbp3a4gjktngXzbmS6WNv3fzLt2/7Tf3moLKtzHosN22qaXqF1dJp9nMsEc9t5balu2rI25tvyxtu+Vf9qkT7LHAmkySItzZs1xFub/Vt/F95d33dvyrU99p8kmladqlvGq27NM0T+Y0i2y7VWRty/K3zfw7dq1W1u4vpIX1hbOW5/dQ2rO0SwQyxzSSL8v+15cf8P8AeZqCBs15b6P4cvNUhme4kvLONb6O5iVv3LNujZmX5VVmWqkS6ksMug2bW6tcSN/aNykjRt+8h+aGPd95mVm+993/AL5WqN5eWP2v7VHfW8mkzTw29y15FtXdC26OFV/5aL8yqv8A7NV99L/tIS6hdaei3syRzXMk87Rx7fusyr/dZf7q0AWdFvLNdL1Kzs2llvYYrfyJ7G88z7NNGu5pGb+9/ut/DVPTG/su0uNLuJrfTkW5urWOLa0Kysyq0i+Wq/N95vu/xNUtlatq0F5p+i3F6qRyRtLLHaL8yqu7y9v/AAFf/Ht1S6lNeXl7ZKtxFJB/Zy3Ei/ZvN82aRm85vm/u/L833vmoLKvhvVvt2lNq3iZYLO/aBrO00yKdvLZY2by2kaNW3fLub71OmW+k0+10VpJYopLz7RE8DRztBDtVZI2bb83yr8q1bv4bfVPsc1xHcM15aNJGts6xtHNIvyyMu1dy7t33qT7d4gbQhpNr/wAsY2Z2/d7o1jVV8yRlZtzfxbf/AGagBuh3V1p9xo2irJO88l9HIv2yJmbd5y7vMVvu7fl+b/KlalpNql144TUNUVrd5FjWLdGqyXf75flaZt33vl+X5W+WigDBXXpP7K+z2tvL/wATCdY7SCeP/Ww7dzKzfw/Mv/xVTx+IGtdNt4dW1K8+23VmtrFFPZtJ5kayfNHHHt+VV3N+8+7uZaji02TVrmK+vLdoriOWaNraBmnkto18tty7fmaParN833dq/d+aktptLuIpW+0b7jULRre1vpZPNnjVd0kjLt+6rM3/AI7QQWLmS8ur6z8m3U6jcTq0/n7o4YlZWVZFX+Laq7m+b/Z/iqneafa6lLPod5at5E07N5ssixxtNC0e5l2/8s23L/F83zVa8RXCw3EF40kXnrHDpqtBI06xr96Tb/dX5v8AvmnReJlvtO0a+ha6tfJgkjubVoFhmaTczbpF/h2/w/xUAXLq8vprpY9U17Rv3MjfI0W1Y2k+7Dt3feVaq3d5NZ3K/wBj6DZxRapKsMsa/wDLCNV+a5Xdu+9/d+78vzVnW18yq/k2Ngk8l3JcQeRE07Xq/wATfN/dX7zfd3bvvbaZaR3Emg6bHprOv2izm2+erboFjbayyMv3dy/8s/l+7/vUAa9tq15qWpXGtNqF7Ltgj+zT3MXlzXqszfNG3/PPdupktxG1zazWOl37PHOskbNEvlxszL5m5m/2qjsoZGs57WO+dri1ihZ3uWVWZfvfLJ/C3+z83/j1S6barJ/a0Oks+6RpoZVvJd3n+XGu1of4v4m/ef7Py0AV7aOO+1e8/wBKnRoZGa5f5WjkX/Z/4Eu35f8Aa/2auX2ta5r2sND4g2rqUl2s1nIsqxxLCrKrbm/hX/ZpbS3urN4tDkW4s7W1kZY0/wBW0jTbWWSRtu75lX7vzfNVW7tbWH7FqFnqG52/1WnfxNJ/F83y/LuX/wAe/ioA1LTRYY3fUNU1i3uryPzLHyFk3LK0zfNIu35Y9q/+hf71NudW02Ga8jbVpVvfsn2e22RebbSM0+2TdIv8W1l2r/s1RFrfKtxHZ2v9lvfNGtzKqt+6VWVvut/s7l3f/tU6Nm1LxC2oNpdnLpatdeask/lruZv3c21drM3y7v8AgP8As/MFkd9b6fD4p1KbR5HuvsdrcXip5v7ppNvlr5n/AAGsh4Y2eK4sWW3gsYvJuVnZfJjjm+8qsu3zF+Zm2/xNt+792tSHT7Wawi02zvvISO1ktfLZmWSVlX5vtH8KrI33laniGGFYWhjDweRHI0DL8qru2/Kv97d83zfw0EFPWLe68XXyt/aC2rSPtgltpVjgkhjbcvysv8P/AH0v/jtdBoOoL4g13VPDtjHdO19aeX9rXd/oVvG3mSfvP+Wnyq3zbf8AZ/vVjed9htH+0bbiLT4lafa26e5VpJGm2/3f4dy1Y1DVrfwn8N9Z8WalN9gutQtF8j7SqxybWXc25f73yr8v3qAPJ/2lvjNYzXN7Y6X5XlNH5apGyqreWvyrtb/gP+d1fCOk+E7q+1LTvDLSXMUuqSRrcysisqtJIqt/tfxNXodl4Z8RftAfFG18JXFxeLpEazXFzLBBuaONfmZlbb8v92vqv4N/BX4d/C3xhq2qeINPt9et7eC3j0axvpWaS7hbduk2t91lbbt+X5dv/fQWdp8LvhXovwt8Ff8ACH65ovhzUdJur68828n8vcsLQrEsi7fmjX7y/wALfL/tVfv7zw/a3NhdW6zb9FsW0lY4GkWOJVm3Rt/00/dszNuq3JrVj4f8G+IbOPwOuqQW/wBl02e5u0aRrGOaZvMmjXduZY9yszf3Vb5lqfUvBtva+HxdabeNr0DT7ZdSWJfL8mZW+zzR7mZV27f4m+Vvl/3gDn9Shh174Z+LPEX9k3EGqXVyzTxM37uWPy9se5f9pdv91vl+7X5m+Frm3/4XHosl5pvnRR65awtbRv8AM22ZV+Xb/FX6peI9evPD/gP4l+HdShuP9DijuJJLuJlkkk8hpGZv4flXb93+983+1+Tfw3tf7S+JXhezk+9da5Yx/N8v3riOgg/Vi8bVFv7BvJYatG0jM0EfnyeW33d0f8K7m+993avzKv8ADDN4L8P6h4zTT9S0Gyvf7StoY21GS282Pzm3L/tfNuVfutXRzXH2XV/+JppbwTx20mlvFZtu8yFl2/8Aj3/stef6i1r4ftoPCeh3Sqt5F9qsWXdG0bR7mXzG3f6z5d393/vr5gsz/Dfh/wAMrqWnXU2m29gq3OqRxW0i7ZGul3Ksir/d+9tX5vvf71dD4fbS/EHhmw/tjwjaxN58lrBaSK3y+X96ST5fmZvm+78u3dXC6LrGi6h4js9UvPNsE0+zmt767vm+WW4Vo1+VWX7rKzfd/wDHvvV0ekeKrfSdbnvNQ83RlZmaJJ4vMWTb95lb+6yr96gg8c/bP0fwz8PfCCt4d1SdL2+ubeRbNpGkWNd33d3+6v8AF833a+evhZ4TXxxcWGi263kr3F0sa+Wu75f+WkjfK21VVvvVo/tS/Eq4+JHj688ttum2KbkXZtVrht3zbf4f92vpT9jD4W2/h3w3/wAJg2nz3txNJ5doy/NH5a/8fHmL935v4d38K7qCz2nwJ4X0Pwv4Si0OP7RZrptnCtrp0rNIzTec27c38W5d3zV36aLcf2tqzR6pbp9jsY5ls5f+ejfwq27+6vzNV7ULWRdEeHUvAqXFxdN51rdWbMsjbVb/AFm3d8q/+Pf3aj1bwn4f0fT4luNeluFuoPtDX1su7bJ5e5l2/wC8v/j1AGRd2OpXWvPdafC8C3kCtcrtWOORtzMsf+1uqvrS3Xh/xEmpfZ0VpLH7PbS/djiby2+Xavy/e3Vl+I/E1q0FhdX101ujWi2skckSs3y/dZW2/wB3/Zrwrxn4+vrprzQ9BtZ105ZWk8+6i85pZFb70f8ADtZo6APRPHPxK1q6ZLeS+WV2iaOV7Rds/wArfK235v4mrzH/AITqTUNSuNU0u+iVrePbLdq7eXtVfmbarfNJt+X+L/2avPNe8Va9ca69ra6bZtLHbTXEnkJ83lru3Kq/3vm+Xb97+GuKuNe1S6tlulkt7dJHhhlinbdOvy7lkVd275vm3f3Wagg9g07xgt1pS2rQxXul3F5NcLbXcvlySt5attk2tub5fmVflrmbbxBGviCw1KbS2jt7H95Fp7Rtu2wxsyxt/Ey7l2r/AL1ecw6s1rHA0ccSS2tzI3mfe8tl+Vv4vlXbJ8tb1h4ih0WwvtHkVb17r7uobvMh+9ub95/E27au3/eoA9GXxxrniDUdL1aZXWe60i8uNQggX5Yo23LGzMv3dqqv/wBlXZfDfxFfNbeGrPxJZpZ6Jb3cNxLcy2zSNP5bebHG0n3fvfM3+yteF/8ACXW+i38+sWsPn/ZdNZVW5k+WTzNytG237y/xfe3bq9q+FWva5fS+ENL8uXUvD02ns0dssHmM1xt/efd+b92v8P3vu0AcF/wVC8Pf2x8S9E+M2msrWfiLT47GeOJP3cUlv8sbK3+0rf8AAdtfRnwcuo5Pgz4fuLXXPtlxdaNDHLcxRtHJHG235f7rLt+X/gVeX/8ABRrVNNX4efDzwfpO2dYZ7rUPPZmjm8lVZfJk/wBrduqX9n5l8I/BbSdD1KbUkihtpG+3QRfuJVmmZljZtv8ArF3bV+8v3aCz27xD4w1C4/s35Z9tuzeVFHLGq3LbdvlyLI3zLt/iX+9/ery/XvGln4iEWk2ulxJZ3kqtGtzaMscXzfe3bf3f97bu/wC+axPih4qbTYrjXLORpb+ztpGtot3yxKy+XHI277275ty1wHgLVNQ1LQWsfs9xawTJJfavqMErN5rN95mjb7qx/Ku1WVqCDurVbfTZrDR/7QnuJbq2m89FkWdZF+barN/e3fKrN91d1crH4m0ObTfEupXmpPb/ANiwLb2OnxS/u5JGVfMaRf727+L5aoaf4skt5bq8W6vGikvJPPupJ/mlt41+Xd/zz+b+9u27v7q1wFvr0eqaxqnjDVtFRPt0DWsWnWzbljVtu2aRm+8q/wAX+9/3yAe3fsxfFaPwz4+XQ4YYoE1CDzFaedo93mSfNDHu/wBlt27+9/495V+3P8MZPBPxIn8VW3lT6d4ggWSVnVtts3y7ZI/977tYfgySG31mzjjmuL29ju45omtpfO2tHMrLtb+L5Vbcv/jy19lX994B+OHguLw/r1vbpqNvFN/Z27avns0bNtb5tysu1f8AvqgDgf2cv2kL74peGEsdW1aw0jxLpcX2WdbqdY2uYVjX5o13K3zf/FVf8a6bp9nrraxrlrZ39rDAt9pupyLuaORVaRV2qzfxf3vl/wB75q+U/FXgO68J+K7NdNuJ47qF9ttE3yyR/d8ySRfvbf8AaX5a7ez+PVn4b8H+KPC+pWrI2vTxs8sETSXMU0fy+Yrfwr/E38LUAejeL47rxU+neG/C+kwNcahZreNEkvm3Mqx7v3iru/8Aifvf8Br1fw94y8P+C/gDb/EzxJttdXhs7y+ls9iqslx5f93duVlZa8rtP2mv2fdQ1nw/4002xbw/e+HdI+wusDN5zSbvmZv7y/7O35dq14d+0P8AtJXHxUaXQ7HR5YNEmXat2s6tJJ8y/wAP93/x6gDwr7dqHxC8ZS6prUjT3mpXPmTttbarM3/Av8tX6G/CXR7jw78OfD+k6x4fgnv7GOSGWezgkZomZVaPazfNuZtrbm/u/wCzXzJ+xx4N8O6h46bxZ4st0fTtH8xomaXdI1x/CzL93av3v+BV618Y/wBtDR/hvo8Pg/4L3j6pf3m6a+vrm8WSO0b/AJ5qq/K3zfw7vl20AexeMNe8B/C3RLLWPEniCLSVsbOSZbG5uY2uZJG+ZlX+Ldub5flb7zf3q+bPHP7fWteImfTfBfgux8NKsX/IRu1Wa5Ztu35l+VV+X/e/vV8+6JoPxO+N3i+ea3sdW1zV9Sk3SzpbSSsytu+7tXbGvzf7KrX138Df2F7FY9Rm+IniqK1vbeSFoII5FWS73bfmjkb+Hd/ut83/AH0Fnyv4q+MXxm8YX0S3niTXNrJtTazRL/47935v4qwrH4a+OtaNxcXWh6tPcXC+d57RtMsq/eb5lVt33a/S6T4f+E/Av9nab4b8I6Yst9Bt1C51WP8AdyTNIyqv95mb+H7zNurL8Ra1/wAIWNet9N3PqkOkRrZxSQLHDHN+8/dw7f7u5fvf7X3qAPgXTPAfxYt4YtY0Xwjr6tuaaV4LSRZ12qv3lX7y/wCy396sTxrNr3iLUGvNevhqN0qMse2Jlk2/3WVvmVq/Unwi19b+KfBuqaHHZ39nfLaw6x8zRzSXCt95V/i+9t2/LtVq+Gv2mbzTdS+K+palDoM9rcNPJbyz/ZmjVmVm2/7K/eb7tAHvn7H9joul/AfRFbbf3WqT3lxKrMs6xSRt8q/L8sO35W+b+9ur3vUl163i1TQ5r63/ALW16zhjl1BJPO8qRV3Qqv8AD/E275f/AB2vzx8N/tSeIfBKWun33g7T08uDy4ZbV1hkX/a+VdrN8q/N8v8A481em+Cf24GvtUtW8XaTPLPG0kiPdt5i7pFVW+ZV3bf3a/eoIPq+5hvvEkqahNJeppuj20lrP5jKrbvMXaq7l+Zd275v/sts13qkdx4hWS8hleK487z5HnaCONvlXa3y7WVd277y/drg9B+NnhH4kSy3V54otdGuJIvJs5P7SWaG5jZtzR7m+7823+7/AHq9DTVry40aW816SBJ7jTWh0+O2f7Sqqu5mb+6vzbv97dQWXdPjW1udU0/T9StdUnWfy7aRZdyrCv8Arljkb7qsu7/a/wCBVai1CSzsnurWHTltbWxm022i/dwyRws3yybdv7xl3feb/wBCqvb3l9NHP/wjutbLW8tGa52t5bLuX7q/Ky7flVmX/dWssXzfZrWO3kgitLqWZb6S5iX97ceWqxsrfdX+L/0KggzbCa6bU7fXNQt5be8k/wBFWOxumaONfmX/AHf3n/oTLW5/ZusaXereQxpftdaYt9c20sqySeW0jK0LbvuyfL/dVlZt3+1Uqal4f1Z9RXXprpLqz0/7Vp8axKyySeY3l7vL/wBrc26suKPS9Ndb5rGVnumaO5vnkkVYZG+XbuX/AGW+ags6KJbjUL/WdLjvrLZ9hZra81FF3NHDH5nlrJ/e+Xb97/0GsBJIbp5bj7V5sU0dvNFFBA21m3bpG3K3zKvl7v8AgO5vvVo2NrrU1xeedefavs8EmyeSPcslqu3y445Nu7c23/x6sOwvm0vwe1xdWreattNcafZyKsf2aS4XbIvyr97/AHvm+agDQ0q3ulF5qkOpPa3s15JN5Cxq0cjKzNHJ5m7/AGv+A/8AAapaayqJWvrO68+S5kuL6e5WSPzP3a7ZvLb+FV3bdvy/LUttotjpqXdjDpO1Fj8m5eWL9/8ANGrNMrL8u5m2r/wH/Zqrf3k01ve32oSapPb2fkx2kErLukuG/drGzbfmXa25m/8A2aCBmlawzabBbrp6QXkbr9miVJIGiWFflb9597crKy/7Tf7NX5tQWT+0tP1K6+yy3Wowtcsy+ZJJNtXa25vm+VVXdWjcLa3WpXPibxBqUX2iOKGOJEXb5zblVW27mX5VX/0GsW2j0XVLjUdQvLW3t5bdm8jz7TbJG0jNt+b7u7b826gsdZ6frGm+ErfT9SuIrVrO8mms4Lmdmku1jZW/eN/D/sr/APtUzWIV0/VVk8M6at7ZyR+ZLPdPukjkuF2tu+X73y/L/vf7NTeI7jWtJ8TxXkizqk0sMctsy7WsoWj+bbu+993cv+9/s1LctoNxr6w3WnytFdeZeXbXNzukimVd3mfKu3/gPy/8CoICJvD8OrtY2OoT6bbwwSXFssDK0Mvk/Ltbd80e35vlX5vu0mmXGoQvp19pum3VnbrYrfSzyy7pmm/5aL838TLub5l/h21R8NtHfXd7qX2eBHvJ28r7ZHtadY2X5Y4/4dv97/a+7V99uva5Pb3UKXFksrWMkCfNLP8A3tv8W1mZvmoLJ/sreJtd8vUtYWzaxdvsMUbMttK02373977v3f4qNct49U0y9tbe4tZfJjhae1ibzI5P3nzM3+7/AHVqnqVr/bGu6zJZ2f2B7WeOGLyo/wB3G0m3asO5vmk/vbW+X+Kr3i3Vr7VtVvbebTdGgitZ9sqfaWaKPy1VvMjVfvNuXb/s7qAK1zCsOotYybpWj3RxSNGv7hmVtsm3/gSt/vVVuNYtVa8uNWsZUs7f/R49v7yTcqr5P95tu5mXbUmoWKwvYaDNNJBZqv2yT7NtWSRZGbzI5P7rNt27fvVYktby3e3WOOJLO4ikhSBdsXmRqy7fmb7zL+83N/sr92ggS60uPT/sd1eQyYXzt8Vm37+Nljk/hX5W+Zvut93d/u1YuNYjt3g22qqkNnHar9ll+7eLuZvOX+Fm3Ku3/wCKrnZtJ0uN5bex8N39xBDdtbxyee0fmN80kkys3zMu7/0KrUMM2li6mm0+VfOvvtCqrMrSRxqu5m/3tv8AvfK3+zQBaS8vtN0qwVtJS1VZGkuvP/10cKr8zeX/ABN8u3bVr7Qt9py2t1rFrpsSy+WzNE0LMsnzbv4vM2r8y7f4qiuf7U/te1vm8pria72sqs0jNHMu1mkZvvbV+b5vmq5qurWtjeatHb3C6jpcjLbxTyqqyNHtZWkWP70f3m/vUAUvDbW9xPpNvZw3l/b286wpLdL++lXzl/0jy1X5du35d3+9RWrbfatJt9J0ux0m1lW6WzZbxlWPda+cu5v+mn7v/gNFBZlQ3F9pdtdeKvDdxeX9vpsa2sktqvl/aY23bljb+821tqr83/AmWruh7bezuPD/AIX1iz0i1uIJo2aT97NI23zGg3feVt23b/vfw7a56+t9Jhsr3XI7i8Z7idZoIldv3U0zLGu1f4Vj27v95v8AarVtLjSYZp7H+z4vs9vdR3FtL83nLJu27V2/L8yt8ytu+7QBSs7PR2n/ALH0+3lg3WzXkU93OrL9oZm3Kvy/db/Z/wCA1cVbVrC90WGa3S4t/s+pLefKzN/ej2ruVY/mbczfN/7NSt1s7zW7hvsqtPC37jcv7v5dy7vl+X+L/vpl/wCA29F/s9bDUptH1a11SDTVm2R3krNNeyN+7jjZY9vyxsrNu+b/AMdoIK//AAkE0Ov2ralNPArKzSs0Cx+VDGreWrNub7zf3f738P3WseGZryz06z021aJrfXFt5JF+VvLZW3Mrf8Cb+L+7/DVKzhjvIZf7S01VaS0bTZ4pf3kdzcMu7zvM+VVVdzbV+7/s1b0jVJLHT9Ok0PTWe/0nSGsXlg3RSQ7vMWRv7v3dq/N/Cq/7NBZX0S3bWLyJby4t9Ol3zal9rkkjkWVlVmVY/uqu7bJ/e/h/vVYWaO+tpbrVLOf7VfLHJs8395ArSbV+Xbub+Fv+BVP4ctZI/Df9i2Nra21rNLb27ajeL5jLHGzbvL+7t3bf7v8AyzXa2370Wn+HdSm1OeHQ7yBbqxRpGvmu1X7asO1m3N/wH5VWgguaVb3UmmPdXkdhP9nijWO83t+9VW/dyf3l/wDZtv8AwGm6tHb6fc3S2M15L/p0LWc6rtjuYfu/xfwrt+9/vfM1WtRt1W3a4uLy3VWRbdUj2xxSN975t33tv97b/F/dpl1JdXFpexw3EVvDdRfaHWeD5W+Xaqx/e27dv/j1AGdquj2un63tm+zrp0a/aokW5knVZvutHIyt825dvy/w7azmkvtJ0fat5JK15BHp9tE0TeZ9n3MyzM3975pG3N/erotas7jSdIsrGONnvW/0dfsaL5X2iTb+88xflb5fvf7tVUj02TVW0O6uHtV1C+jZZ5Z9y2m3bHIq/wDTNd33d1BZlt9q02O30fR2/tlby+mmnWWCTy4IfL/19wy/e27vu/3vvfdqWe4abTrOxa8l+z6t5kjSW0Xlt+72qrbv4V2tuVf+BVbtv7Y1bULqT+y4Intb77Os87NBbR2+3c0i7v4WjX7v95qz47yxk0x7WzWLfsWGBdzSRs0jfM0a/wB35VWgDVv7W3mtrfUtNk+wW8dyscEEs6qrSbW85dzfNuZdv/fVeK/tveJNL+Hfhjw/4N0u3is9RvIpri8eX7zXEkfzM3+7HtX738P8P3a9z0HSdYk12DR9Q0/d9l1OO6bzLbyvsiyMu5drN833fvf7P+zXwb+3L8RI/F3xTnkt5EleHzGaT+L5mVdv+f7tBB6d+xD4Zt7XwN4k8dalZy63qWqXTWOm2kV15PlQx/8ALzu+VmXc0nyt8vyr8tfUXhCPR7zUNW8WX0c+py2tpHcfbpYo4vLj8xmkhjkX5mVWVW+X/vr7teafA/wXa+Ffgt4Ij8vTbzV9Ng+2Wsj6g0Cw+YyrcbpPlXbuZvl+98v92uj0S1t/BNxdWeh2tvbwNPH5FnLeeZHGytumWPb/ABN97bQA/wAO6hqk3jzW5rG+WfQ/FS3ml3Ml1GyrpPnQ+V8y7vvbt21m+b5q2Y/B+taD4J0jR7PXPPm8N3MOm6hpkqLPDHDH/q/m/wCWjM3zK3/Af93m/Dk2l6PrFxGuk6svnN/aEcU8Hlx30c0m6Rmbd+8b5V+625V/hrodbXQ/APhrUdQ0/UHTSdQvLXWJLNNvnR3Vu3mL8zfeVdyr8v8Ad20Acl+2l8QpPhr8H9RtfFWsRT654qikhtYIpY2k3SQ+U0bKvy/u1+b/AIFXxT+xx8A9T+MfxGXWvOii0fwebfVLtpVZvtUkcm6O3X5l+9tb+98q/wC1WF+0t8QtW+K3xZna6kZoLeX7DYp95fmbc0n/AALcvzV+if7JHwj0X4b/AAutYVadILy2W6luX2s0kzbmbbtZfl/h2/eoLOu+JGrLDo8XiSaOCJo4lW0iik8nzJN38K/e+X/Z/vV8v/Ez4gNb60qtbrPZ3iL9hWdNyr95ZGb+797/AGVr3f49rdaXZ266XeWDzx7oVb5Y/LVY9yyL975mVv8Ax2vz38WePl0nxDatotqk9y1ptnjZPlkmkZl2tu+Vd396gg9p0/xNqlxY3Vu2qJdNfRrqFyyyRyRxLu/1f3dy7dv+fu0k/wATL7TdHuNHvrWC9fS45Jm1Dz/LlW3ZmX5d33l2/wB6vMrC4uPD+gadNprXslx5TQzyyttjVd25o2+X5lX+Fv7tcrrWrapNBe3Uk3lTsskbN97dGy/7v3aCzkfDnh+4+J3xMsPD+lzXV6+rahulZV3Msf8AE3zf7O6v1/8ACvhHwzH4Ia38K3Ua3kbW9w0as25mjj27f++V/u/xV+aH7EngmbxV8bre8+y3jxaTtml8hvmjVm/i/wCAqy1+o2laWuj289j4fW8WKOWSS2bb5bQK33mZV+9822gDD/sWaPSVZbVbWeRo7iCfzJNyqrbVj/u/xfxf3VrG8b+LG0+FbrVI7W3ls4Gt/MT5V2/Mq7m/vNub/vmuq1i4t7W3uNQ+3LA8Ks0Fiki+XJJtX+6u1drfNt/9Br5k+M+sNNcRaCyrPpqwR+f5EHmNHIyt5bN/tK0m7+KgDjfGHizWtYvftjNeQWH2pmkg3NG06+X/AAtu2q33fl2t/DWFqniySbS9Z0mTXNUuot7Mlt9k8tpJPm3btrfMyt8vy/3d3y1keK9S+w3jtDdNe2CyrG0Er+Ws6/KyzL/DH91V+7/DXKalqitre6xsb6wnhs/tDLAzbY933m3N8u75flb/AMd2/eCDa1O6t5NUlhhm+wM3ks0+5plVlVWjVW2/7Ks393+9XGanHqWpLercXVu08kn79ZW3NLM3zRsrf8C+Wqya5b3mlXULSXSeZ+8jVpdyoy/Lu+b5vu7vu/7Nczc+ILhrZ2hjSKC4dVuVb/VyKq/L/u0AbesahcR3d1b3TL8sDSXMaxtu3bvu7v733v4qgO61urG6VVa1hWRl+b5ZG+7tb/0KsK51xpneGba+3bsljjZW3Mv8VSG4hhigjbYkLSs2yRl8xW+b5m+b7u1vvf7NBZ2Wk6hH9j/sW6tbdmuNQjaJnfaq/d27v7qrX0p8CtUk8N/8Iv8AYZPtVwupXkbRrtWCK3kXy45Gb+Fm+bazfL8v96vkhb6x8hY7pmguIVZVlVv3cv3fu/xf+O1qeHvjxfeFZEbTY55fJl3RSuzeWu1t33f4qCD6i/bDk8P614T06bULd9bVlmjVbGXbJaSNu3fdVt3zbV/4FXnPwW8TR3Xw0n8MyXUkupaPtV4rxfKaS1abdHujZvm2/vF+7/Du/iauY/4Wh8Svid4mfVrHSXbUZrWSGJLZFjjaNWXavmNuVWZtrf8A7Nel3Xwp1S8uNLvtQtdOtdcmg86WeRt1paLt+aHzl/3dvzfxN8tAHB+N7fUPCukvotjNcRLdTrDebG87yoV/eK3ys25fm3bt3+zWNbaw3huNLH+0PPZoJG1CVYmWSSH/AFjSLH/Du/u16vo/wJ+NGpPcatHfeHLPS7iRbf8AtB9X3N5km1d0cKx/eVf73935mb5an1X9iePVtSa6vvihFLql0nkreRabIytGqqqqy+Z93au37y/+g0Aeb33iDWPEE+pSSWL6bZ6xqDLd2iRtJO1vDGrNt2/wybvvLuX5ayNSk8yws9L0ONvsDRzL590rKy/MqtC3+z80fzfxVs6h8O/GXwjtL211zT52S8fcuq2l0zfu9yqsbKy/u/lVW2/3d1YVzb3Vu9w1r9oWLctqr+b8tpHIy7VX5fm3fMq7V+WgDqNGurqbxJp10traxT6PYyQx7pVisorfy/3jMv8Ae2s1dXqWsXminTLWO6nn1HTdTWa11WKDzIPLkj8qPa23b5f95pN397+7XHav4+t7q7bWtJ0VrjdbLI0sa+XKqw7lWSZV/wBW33flX722i4upobuDVrpp55VvFaLfO3lXa/3mh+9GrKyt/wCzUAe1ePPGGk+LNUtdP8WWd/Z2dvJ5Or3NnFH9rgj2/My3CqyyRf7O1flb5q8v8Z/sv+F7+7i1LRdcuHs75VmtdNtrn5pI9y/MrfN/eX5V/vfxfeq1/bVrJZ6JcafC9na6pHeWd5JK6tHAzLt3L/FtZWZdzfNXR+EPiBeeE9H1zXofDem2d4rWeiwWk+6OSONvuzxq33m2/wAPzbmjWgDx/wAPfs2yNrl5N4w0fxVBZ2McjK2mxLI0dxu+WNmmjZfm+b+Jf4f+A5OofAuaztbW4WfxHJPdNtSOSzXiST/gO1V/i3fMtfa/gvUNF023vdPvry4a88UXnnXOlRruaPbGreZcTL93czfK3/Aa6i7m1bxJqK/btQe81HdHbou1ljto1k/dqv3vm/2qCz8zfiv8GfEXw/gtfEN9b3H9l3UrWf2yK2aONJlX/Vt/vLu+7XIeFPCt94o1uw8O2MLvPqV1HZxrBB5jKsjbWk2/e2r96vt//gp94q1zw9o3gf4NXV558U0tx4k1DeytM0yr5UfzL8qx7WkrD/4J/wDwf0fXrO9+IGsM8V39pjt9PVv3fmLD8zbW+7uZm/2l+X/gNAH1H8A/gzD8DdN/snRfE1xcK2nyL9sax/fLMys0kf8A1z+b5V+bbtX/AGdu3rGpfYf7L+3QwQ2Gnr9l8xYG89V3bvMb+9u3NXqMNva6PqF5qFwseqPqFp9qlRo1j8tvusrf7Xy/99LXz/r0OqePNSbwrpc1npq+ZHffaXVlX5t37tf7zbV/4Cu3+98oBz39rN4f8QX8moagupaNpus2OqM14sixxNu2x+WzLt+Vl3Mv3fm+9/dydbuLfxhqOuahD4wtUsLhY5Lq5sblZo23fM0Kr935m2/xf/E159pt9o8ni5dDb7Rc6azfaLpLy5bcske5fJ8tW+ZvM/hXd83/AAGuq+HWl6posc/h+TVriK109ZJoIraNppI5P+WMLRsyqvzK33V/i/hoIMfxDH4q03xZ4a021uPI+2SfaGaT5vKXzF+833VbatX/AIi6XoPjrxHp00fg+3sp9SvPLjtopV8+5VfmaSNt3+z/ABLVqJr7Uobj4gWei6jriwrHYyLLBGscca/LMrR/Ky/ekb5f7u7+81dLq/gOz0PWI/Emk30Uq6bbQ6lBK0m5trfu5FZV/vfLt/2v++VAPILv9nn4S+ItH1TUNQs9Zg1K8naGxi/dyT2zL8qx/Mu1m/i/8d+9XAeJP2QbnT7eDXNH8aafa3EzRtZ2N5bNDM3zfe2+Zt+6te82Wk+G5jqOqeIGeK/a6Vo2ZpFni2t8zLHt+833V/vfNWN410nVrrVbDS/EV5A+neE7aO6s52k/cyt5irtb5vvfd/i+9838NAHyL8Qvh34++F/jJLPWvDt1pDSSLIt9H5i2U6t95vm+Vvl+981eofBb9qbWPCLS6Lq2l2uvabJ+7ltpb5ofL+X5pLbb83+1t/2Vr6rvPF19q3iDWbPVtPiuvC+l6L50sGpWiyefHtZf3a7vu/KtfOXjT9ke38ReG4vF3wX1y4bbp9xr1z4avGXzoo13N/ozLt+9t/1e3d8v3qCz6qfxFpPjqz8NahoevRX/AIe1hpG1P7MyxzRyLtVYZI13Mu5f4m27q3LTUtQW6l0e1WW4uIYoZLNZflWWPc3zSMv+saPy/wDx35q/O/4Z/FbxBpuqy+JtP15NB1ezlXa2791qXl/8sZo/73/AV/4DX178Mfjt4T+In2WzktX8M63HthaBpW8u7VvveXJ/C33vlb/gP3qAPQrmSSTTdOvtJmdYrq5+z3N2m3z4Jv73lyK22ONtu5d33aNR8tr77LcahcXSRzzahHcyMtpHP5ar8zLu2t97d/tf+hO8XfZW1rwza/2Sk8Wl3i2sUvzQMslxIrbm3M275V27v+As1dbrGuW+kpdeG9P0+3utL8QafCyW0S7miWO4+W3Vm3fL/ebb83ytQQZFjq1xpfkalJ4ma1eZGaCVot0d3tX93DuX5Y1+9u+b+L5azNY0G6+32Ul9cRXWgrbR3jNA26WCST5fs7f8CX/eZa1n0vw/JI2oWdvFOulsrSx7NsDXX8Lf9NGX/ZX+GsG5W6kCWbW9xFdR6nHcRS3K/wCrVfmkVY93y7tzL83zLtoLNG5mvrfUoNF1aN9+k2rWsfmbV3fN5n7xfvL95v7vzVGbGzt9Rltbib7Z5lzHukST5YJG+9/F8zfN/wCOrV/xVYzXzX91MzbJFXVvISBWZtzMu2Ztu75fmasWw0ePVrmDULHR4rpI4/7SttzN58bQrt3Mu3bt27m+Zf8AeoAbpupaatyn2e3ndNPs5pJJbbdu3blVW3LuVpPvNtb/AGa2YvGGrfZLi+s7iWLTtQaOxa2e2WeSKP7zf+zf7v8A49WdbahDNZpfeG7hbODbDZ3SrO2693N/C237v3fl/iqHTYdSkv00e81BVvLW8maS8aNVhaNVjZfmXcqt97/PzUEFrRNSuNSmS6WNrN9WvPJuY7lvO2tDuWOSP+Hdt3fd/vVauF1C4v4JtL0dbq3juZLyWTUFZVWFm2tJJtXavy7vlb+7VP8AsVtLl/s/S9QeV4W8yeRpVZt0m35d393bVzUdH0++isLGNfs1krs0Sp++mu9sjMzSKvy7vurQA3S1+y6k9ro8djKLieZZ/tMTNHBDJHtkuF3f8tPlZV/3aqwt/ZuqLfatp7WVncMq2s6wbZJIVbaszN833v4W+X/aq5c29rcarZ6Xb3Tu3ntqF9Oqx+bFtb5Y/vf3aj0uPVtSSWFvGFy0F5ujW6uV2xxWu7bt/wBqRW/ioA1NSuJrH+0tPhhW4it7u3jil3NttLfzlbzlVVVpm3bv4f8A4pa/i+HT9WjvLiG43RaotxDBLPB5kzNG3zMyr8qszNt/9lqh/alvdXl1dXlwrJIqrFuVt3mRt825v4VZdv8A6DU8mm3Ed9rN9Y2tukC3fmRz30n7y2jaD7y/8C+agBviO1uJIrNbO8XVEZLfzZVbzIo49v8Aq22/d+aqgvNS+y2FxNY2+/SV/s2K8jg8uBvm3Kqq33WZqmaRo/D0Uek6OqJHZs0/lbYvLmZf9d/tfL/8T/DUUc1rJqL2tjcfb7CRZGniu5/MWRl2tH8q/KsnzNu/ioApxabqVu6x3C+bLI0mpbbm5VvsTf6yONdvys0jL93+FV/i/i1IdSj1R/tC3V6/2e2+yySXls25pI2bcyrt/i/vf3dtO03RdHkmvfEV1dRRXlmrXVjp9nOsn2uT5d3mNt2t8vy7fvVk6Podrp8drHMrwRRzzXl825o2kXau1trK25dzfe/2aALVrZ6Lr0Nhea1eI9vHeXFurQTtC32qPa0fnKzLtX5tu1f7rVat5Na/4SVpmWzW6vv9KSRm8tlmVWjWTbIv+r+b+H+7VSSazt7+4hksV2aLLDNuaJt08kknysyt8y+YtNvLeZprjVNa1DTVuriJoU/0lmjgaSTd5cO37235vvLt/u/ebcAa/h6S8bVND1TUI1s7y3vIdPgs52+0tcwrJ806s3+rjZvvfe3f3qKheT+2tT0P7VpMVldaeljp+my3cu3yv9J/eMrfdZmk3fKv93/gNFAEFst9dJYXU1rE0l0rfaW+9DB/Eq7fl27dv3d1VbW3uL61nt7OZ7q102OZWuV+VWWOPd5bf7S+Yvzf99Vaub5tUsr/AFDRdaezuryPbLA0jfL525ZPl27vl2/dX/ZrSu4fD9vNFp9na2dxLo7edFH8zLaLt/eXPk/3tu3d/CrL96gsqalHdR6Va2t9qkTyW9tH+8ibb5kjfdZm+78u37v3ais7XUPD9pA1irM9xZqrStt3SrNJ8275f3e1fl+Xd96qegyWcOlWccepRajbzSzee+1l3fu/m/i/8d/2q2dPk1hvFer3k2j6REsdjHt83c32aPyWbzI1WTbHP/D838TbttBBk39neabqEHh+x1T7fprahHNLGu6GNvLby/4vm2qrbvmp2uWcdjpsmpNfXSXXmyWsEXlqy+XI21f3f+993dt+apdXuPLltZLW4+23UP7u2byGlaf5dzMyr8qru+81V7nT2ktJdLj1x1g1i6hutTuZdq7dsa+TDDH/AM893/AvmoAt3NjqH9uXjK0qRaXafNFtabdIytt3bfl2qv3vvfe+WhPLjvbLUrOE3Vlbqtw0qxsq/wC6397/ADuqaOOzvJX1DTdQiWDUor6TzY7vc0Tbdvkr/tMy/d/hpulWuqSRpY3WoM08kckksfm7o4Jl/vNt+7/wGgBunaHqn9lLpek30DW9w019O0qNJJBGq/dVm3fe/wCBfKq7atTLJrFpZRxySPZQy/apIpWVWkhX7zeZtXy13N8tH2yZr6626tdanefZmaS2klWSGCGRtqyQsv3vlXa27+GqWqbrGSz1SaNbK1vHaHy/N8ySRfuxs0f8K7t38VAFP+w9Ps9H+w2MN/ZvZ322CzZmkljjmkVm+Zm27dqr/D/eq/YSaDb21/Y31r/ZMVvYq2nwWlp580jNu2szbtqszLuZv9mn6vdX2oad5em6Ovmw+XHd7HXy5/LjZvMj3Nu3N8qt/D/u1UhuLqO2l8uz2SyRzLbIu3buaNVjZv4fl+bav+z/AHaAH2a32tIt9rUj+I4tNjhaSdo2VZ45G+aby927bH/e+b5VWrqNq1rcW+g6XJ5CtLeLZqyxrtjjVmba33VZVZflX+9WXNNeXTW10t55X9nxNa7Ek8tWkVflVtv8O6r1hfTak9/4g0O+iWW1aHT0s2k2s32hV8y48tf7qr827/vqgDa8IXVxdf8ACV+Nr6xZZdP06RZZY22xyXUkbR7trfwx7mZW+X+L+9X5V+Nv+Ks+NiaK1vLe/atVtbORIG8xp1aRd23/AGvmr9HfEd5D4f8Agv4q+x3E8ratP+8kk/dyN5cPzfw/Kv3f+AtX54/s4Ryax8fPD+oQ3V1byrczXnnx/M0bbWXdQWfpT4j8L+HYfCmqW9jpaJoOi3flrBqCsrRx+WrKywqy/wDLRfl/hWquo/DH/hKrO41LxgunT6dawR3SRafqsdttumjWONpvuszeXuVvL27f9mrt5Z6p4w0211T4hWq/25ff6LYxW1s1sssKybVkkXd838W3/gVc5f8A9qfb5bXUNDXQ7KFbi4Rln8ndHCq/d3btzSMrMv3f/igCh4e8J6ho+qWt9ptnfxWFnKtumn3l3HPukmkXczfNu2wxrtX5v++tvy898cvFGoXF5eQ3yxIkdq1vBtdY44rVf4lX+8zbvlXbu/ir0nSrHWLzTdU1qOz/ANAs41tYFXb5kc0itJ5kjfxf3V/3Wr40/ao8fXlrepa6fbwT3F9thd0VlZW2/dVf96gg8P8AG+oWfh3xfp15C0d1Lpd5HdMqOu2TbIrbVb/dVVr73+Ff7YXwxk8JzzWuj3kr30cP2l3jkjjtLjczfwtt/wA/7VfIvw5/Zj8VeLNupa9ZypLvhbYytJ5SyNuXzPmX727/AD96vbdP/ZLvrXSmVfGj2KWO7ymtVj2/KrMrMrfLt3fN9773+9QB71pXxw+Dvxe8MXUOpeLtNsr9maGS1u5FjX5VZdqszf53V8jeOfDOl3ni9PDNxqVndW99KskuoR3Kz7Y4dvlqqrtX/vqu3vP2S7e8srqzvvHHkXsardTxWdjDAs8m1W2qzMzNu+X7rf8AoNeBeP8Aw74k/Z98c6br1nHNPZXkX2hftlq0fnSKzfuZv9r/AGqCz0vxwuuXmjs1u0V5axxKryyyKrMsjfu4/wDa2rXkvj/Vl0Xw9a3VvD5F5qEske1X3Ksa/wB7dXqX/CXfD/xdo9hqlvHLb6dHFHJc2MVyqtbXH7zd977y7v8AvqvKPig1vrH2XUtJuGitbW58ySKRl8tdzLtkX/2agg+lv+CYmi6Lb6h4t1TULy6ivbj7LZxLGjbfLaOST73+8y/981+gNvcR+G7RtQmkd54ZJI2l+8237ytt+X/Z/wC+Wr4t/wCCdNrCzeNdPkt1WzWW1m3Mqt5k0cbNGv8As7du7dX2hdW900d1Y2sbfZ4Yo2laf5ZGb5dyqtBZ5V47mmjeW82pukikvJ7Pd+6WRv8AK/8AfVfL/jzXPsuq6pJNGkU91FHvnki3eUv3VkXa23b935f9ndX094/+z/2zqMlmsF5AsCs/2VmaNd0f/oSt97/dr5D8f29xJDqP2OG6eeRWhu/KZlm+z/xMvy/L/D8v/fNBByV4y6aZfEF5bpFf2rTMy3K+esjSKqtNGq/Ku1tu1drbd3/Aq4q81SS4CTWf2jyrdfJlnuflgkaT7zfKqttbb/erV1rUNP0+e/0+1uJWiZo4YrmRfmZdv3m/iVVZvmrmdUmuo4W0213xeY0fmJFJu3fdbcrfd/iagDL1LUptUW8uppP9YzK0kTbV/wCA1zjfKrt86/L5bLv3NtX/AGtu7b/8VXQwrIts1va7vIZ5Gjj8j5mX5tzN/wB8/wDj1OsfCviLVmgm0/S3WC8ZZF82Xbtk/hVmb/d/u0FnFyX1ws+21t0+Vdvy7tvy/db/ANB/75qzZtfTXlvCsfzM7bFj/hZv/Qq7LSvgn4416+ihW3s4E2szypK0ioq/7P3d23+HdXeax8I9J+GNtbzW9vP4m1m6tG2xNOsLLcSL8qxxxq3zKv8AEzfL8y0AcbL4fuNJ01/El9YxLPYvu8hv4vL3fN/6FR8NPhvZ+OtffT2uvNgVpLhlVtsLL/tf8CZflWooI/HHi6aDSdasfs8EbeXKzfNLFGu3dJ/3ytfV/wAEvhT4Ttfhkrabb27T6sv2VrySRpFjt5Jtrbm+XbIrbtzf7VAGz8B/A/g24+H+qW+qaHFFdaHc30ltB5X7y7j8nase3733l3bf93+9urv9Hh1rxt4T/wCE2vJLXSdIuGjsV2R+XHB5KrtXbu/i2ruX/are+G/w5vL7w5rPhXxJqUDXFvJN9j1W2ZfM3SbvLkbd8ysq/wDstbjalp/g3wzpNvqmuWttptusk0ti8+1o7xWZfMaNfmZtqr/F/DQQefQXk2pfClZNP09rhLHXptSgs1ZZZJ28xVZVh+9/Cvzf7P8AwGu+/wBHutWs7WHyonjW1m8+T7sqyfLNH5f/AEz+997+Ffu181+LfjN4H8D+LbrxNpuyW6tbb+zbZFiVWaO4VvOZdzfeXc3/ANl81Xfhp+2BoumzaJ4J8RNKrLcyeRrjMu1Wk2rHHI33dq/Kvy/e+ZmoA+nvEXhHR/HFhrcf+h3A8hoWWJflkVl+ZmX+HcrLt+9Xw349+GesfAVbLS7GHVNZ0nUpWaTU52WNmkXcywSbm/hVvl/vfMtfYPiG81jw74w0Pw7Z6lbW6wy/8TrU7S88yCVtv7tY/wDgW3/LfN1viLwnovxg8Aat4L1a1lZ/E1ptguY4NslpeRr/AKPN/D5f7xvm/wB2gD8lrzWLrSbKe3+bzW/1u52Zrlfm3fd/h27a7fSby11Twtq9xHqx3NA18ssbNG0rLJta3j+b7v3lX73zbq8w1jWLzztRhurdINRjuWs7tIv3itNGvlySLu/2q6D4d6LDqWifaNU3Law3bTNtZf3i7dys3+zu2/NQWdbba9qn9kaXpMkf2OeOKNp4FdWZod3yt8y/Ky7m3Lu/2qln8VaxefZ7ddctZXmijkVkbb5bK25VVv4mXav/AAJl/wCA83c+KrqbUrzUrdooJ5GaNl+Zdsf8LK38S/N/+1UGmzSWOlNcXkbt9sfdKqqvmKy/w7t38VBB9GeB/HGk6xr+ieD7OG4lS+umjvrq2i2y3skjblWb+Lb5ny7vm+X+796vqPwzocNr8StEuPESte3Fj5itBbK0USySKq+Ysat8v/j21lavjn4bSaf4f0p5tPjT+0b7R7rUEWJN01hNHu8tVb+Hd8zf8Br7D/Zj1C88XahB4q8VaGyXmraZ5NsrJtkaO3X5pPm+98zfw/wtQB+cH7Yfiy88YfGnUY7q6+0S6bF9lV413M7eYzbf738S1+jX7O2g2Pw78H6J4b1zRWnuIVhaKWSLaqyNtVvuqvl/L/vfdr8qfEX27xJ8XLyTVJvKuNQ8Q/Z52/hTdNt/vfd21+uXgHR7fR0bS9JxeWq6V9jiknud3kTL8rMrNu3UAd5bXGqQ2H9reKPEUF232u4+yxS3Kt+7ZlVYY/7zf3v96vKvFN5pd5qbLqmoXtvq99P9obyo1g/d26rHHDD/ALLbm3bf7u3+Ku8Een6l4b1fVvEV9O2s6bB5NtB5UiyRqy7flb7u77v8NcRqOrN/wr2CTwnpc8WqafJJDaN9p86Tay7WZv4l2s3+roLPL5o5PB9hb+AdD0nzb/ULZrrUruKJZPszSSM23c33f+Wjbmb+KneGNDvIYLr+y5NRbTZIIWvJ0ZZJGZW+80nzfej3K38S/wDfNdhf/arW7T+y1SXUtQ16HSdQvpVVY4t0a7pI1/55r95q0rfwnpvh+6W6h8QTrolrqMkjRbY1aNmjVdy7W+aL/e/iX71BBleBvC/2rQm0fQ4beys9Uaa8ZZWWFZLdV/1bSN95m+9u+827+KsS50fT7fTW/wCEo1S4vX/sCPTdOtG2rJLukk3SNuX5VX5f/Ha7DV/G3wh8J6VZ6C3xo8IZuv8Al2knhjmg/u7lVvvfeX738NeY63428D6H4gW10/4heF9RvPFUq2eoNJrVuzQWszfvG8v/AGVVtq/xM3+7tAGarpa2L6b4bk1bUbpYZbe8kni3edNbqyssjSfNt2tu+Vdq/ern/FDXmrXUupeH7ezRdU1Nbe8a7i/1Hlru8xlX7zMy/N8v/srVr6rqmueMtMsrjT7yWW1vPtVrJ9kkaRpbO2bayrJ8rRr/APFf7SrXUPpemyeI9bk0XVpYotSs4WjitpFktp7iNWVoP3f+r+X7zf3tv8NAHkmiTX3ijRP+EovLj+yZbPTr7zLu5nWKW7mjb/Vwx7mZV+X7v+1U3h/xRfeDfDa+IvksvEd0n9n3aLArRru/erIzN+83fvPvfdrd8H6Hp9x8Mb1fEGkxfbbW+uGigjikknsty7fvMyqu5V3fxf7X3mWuc8nQfg7bXnhG8sYNXi8TaPJ5GoXcfnSLeN8sP/oX/wC1QBY+IP7Pfw//AGkJr/xx4V2+EvFdvpjXDQQRLJZapcKrfu5lby2jl+VdzLuX5vm+7XxHD4u1Jnihhvp4nWVZNrPtbzFb+9/vV+hPwkuvEEfwX8S6H4RuPseqTRySRXNzcqv2mORWjkjjjb5v4dv8LbWWvzl1jRNS8P3zafqFn5TLctGu5fm+Vvu/L93/AOyoLPqX9mr9pj4kafrdv8KJtB/tqw167j/f2Y/0m0k+75nmf889rKzK3/Af7tfYtlp9jpt+txDfT3VvHFNJdr/rfs03mf6n/d+63+z/ALtfPv7Flx4F0HwlqlvpdnZp4rsbzzrnezST3cPy+XJHH/FGvzblr6Ha302a8v20e4ngaaBbyzittywXK7m85d33v7vyt/s/3qCCW+j0/wANz/bLfWNthqCed+4ZZ/Njb+9t+bd/C392or+8kX+0tQuGZFW8VbaVmjaaRVXc33f9r7vy0xbe4W3vJLOG6li1C78u5tknXav7vy1jZtv7vd/eq/pkdvax3F5dXlmt9ptt5nmyP+8n2/Kv8W1tv+1QBR1iOFoUa3uH+2Tbbzz/ADVVf9WqyRsv93d/D/vbatWGoWvh+W/vtH1K1v73Xlt1lliVV8uHcyzeX833mVvmb5m/3qzYo7fS9M8u41Kf7VGzSSSq0fkeWv8AwH+H7q7f+BVFDcXl4Z21rTVtftVzD9mRLlVku41b7y+Wrbdv935V+7/tbQDc8N3ml+HftTafa3EX2qVZm8iNmaCaT7sa7l+bd/z0/wBqsh5IVd9NsZFe3umjknks18uOBlZtyyeZ/F/u7d1aWoXVu13r1x4svLx72aOGNo1nZlWPc21mZdu6RVVl21J4bvJNW0XUrPxJfSaNfxwNHY7pFka9jVdqx/dZvMbd/e/hoAztIuNS16z/ALU8YWr2V5M25ZYFWPbNC3mQssbbm+barban8S69ql9qVnM199o1LUnt18ifbJIke1t0i7V2/Lu+WPb/ABfeaqMM15rF7ZWdjbouqX1nJNLcxyeZaRN8u2P7yr8ys33v7rVcmuo9Wkgvry4vJWuF+1K0n7tpZlk8tVZW+Zv4m/4FQBjWVq2i6le6TZ+IH1ZrGWa4gdnjXzJG/wCejLt2qrfKq/7NdXb6bDY6HPeQ6fcXVuqNDLLbKy+VNI38Ujf99fdrNuvD6rqOqR6Xb2cCX27/AEaW5WFotqsv+s/iVvvfd/8AsYI7Wa60uK8bWrNtrWcPkXP7hbn7qssbf3VWP721v9Yy/wC6Aab3HiCPTYtLvltbW4tYljaXytsksLK21W/hXd/31ub5qjudQ1bRRb6XHN9q0m1lkk1CRdu5m27W/wB7+6v3aRI/EnhXUdZht2aK31SeS1jkjVWWGNlVlVdy/Nu+b/aWrE1jb31s8y6t9iaSDzFnlk87evzKy/725f4floAi0/Q7iawg0++1S3gS6ikWBlvlaSP94rNJJt/h2/w/w/dqe/m0210x5Gmnt4riWNma1jWSbasi+Y3l/e+bb8v3qy44ZL5IJJNNZ0hbzrad5GXz9vzL83zKvzf99bqJF1K1tmh+0JealcfamWVtsaweZ8qqrfN/d/3vmoArawumyae2rSahvupLq6W08tWjZof9WrKv97arfN93c3y/w1J4juFbUdR0Wa3e1lV49NgaJVl81Vj+VZv7vzf8B/75rUvIdPaby7OPTdLnjs42niWRpoV8lW8xY23fNJJu3fL/ALNVbvSVt7y/vGvN7SNbss8cq+ZOrLt2yN97cv8A30q/xUAUBI2oWU+l3H2e8WSSSbUo7Rm8yFlVdrSSfMzbVVfm+X71LrUdr4fK7ZIrdrhlkW2sV87d8y/LIzL/AHt3+9ubb8tXJbySO0j+z2qJ50i2sit+7jVfOZpJPm27lZf9n+Gn6atvrV69qqtZSwqsN5c3P+rkuGVvu7vvfLH/AA/w/wC8rUAWre4hh1Wyh1jczX2pRx2dtK3zW33dq/LuVfu/L/wL+Kiqnhxrq1v7Wa30HfEt8si3UG79wsky7pGVmb+H+L/aaigsrWF5dNfvNqmkrp1xYy3FqjKyszMsMf7zcv3Vb/gX3l/2ttm2/tbRbJdS1DRUuH+wtZ21y12yySRyMu5m2/Mvzfe/vf7NTa/Hpum2drY2dvb6bq+oXcNrB8km1pFjZpJpJG+6zK33VXa22jTvtTWiQ3GoRLFG8cztdLtgu7dWb7zLt3fN/wChUEEUNrpug6Dp1rpN15/9m6es0csdtH8qs3mTN95l/hb/AL6/iqfQ9WtdLT7VdWe975ppHjvkaP8A65ybl2tu+Ztv95qw7e40m+gSTVLO3WCPUlji02OdpGnaNd3lr/dj2t/3z/dZq1tAsfs6Lebks4LFZIYI22xN+7jZmb7zeZ5e75f95aCzPa1uodK0j+yZJZ59Lsbi1aeJ42knjb5m/u/dVf4Wb73y1p6pfTaTb/Z7eF7meNrVrmzgg2ssP8W5v9n73+6v/fOX4e0+6t3stYkuLjYs6xtHI6yLHH5nzNJtX733fl/h3f71R6LNrCp9u1SS6t57y+8uWBV8uOKSRvmWNv4V2/7q/wDfS0AXzb2sd9I2oL5ttrEbf2e0CMsVttb5m+X92u77395qTSbXWLi+s7Gzs7O1iVfL+w3bRr5FnHJ8rRszN+8b/aXd/s1Fo32y8TUWj0uBlaVZmjvlZVWONtrfZ1+Vfm/i/wB2lEej3V9pt1D/AKi1imuJ2uYNv2Gbbtj+b+L7v+y3+7toIIfCsdnZ6Pq15dXjaS9jc7bW2lj3faWWRv3MLKq/u/8AaVfut8tbOqaoul2kGiyXya551ptiilXasjK27y/Mb5vlb7vy/wAVLFZ6TdabBGrRfatJlkuIJJVabzdy/Kv8Py7l/wDHqiuNShvL9dQ1DR7W4e3l+ypK3yyWbMzKzK235v7zbV+agCHxB/YupX2nXmpTXq3GmxSNYtpzSeXOv/Lb7R8rbf4fl3fMrNS2ejww20ul6tfQWf2q7j1JVbd5XmN/3yq7V/vN/F/tVas4dP09rqZpJ1la1W4trO2Vm+2/eWaSRv8Aliu3/wBCaooYWUTx6tcJLZXlrdW63Lv/AKvdGrLDu+6zfwqyr/D/AA/NQBV0prW4tr3xNJusrBbu1tba1tlWZr2NmZWkVfvbY227m+X5mWqDa5fLpi2MNjvuLhpFkjVfLllhWNdrM3y/xMqsv+zWzpuqaati8NrCrRWaQxt5ESs1s277sat/y02/8Cqq+m6tdahBqVvDfxLCu2S5nby/s1q0knzN8u35l2/L977v92gs5b9qrxRdaD8A7K6hmS61HXIrqaWVv3SwRqqxKqqv3f8AUt/D/FXyx/wT9hkXxr4m8XW9qjPpNjb2qSSRq3lrM0m5v97bHX0J/wAFJtctbL4YeDdJjhVp5NHtd0ivuZmkjZmk3fKzbvM3f7zV5B+wZourXGh+ML7Q7yOC3s76zkkbb80sa7lZV3fMv8XzbqAPrq4mhvJIJNSkumv4ZG+yTtIyxzrub5tv+zuX7zfxfL81YGreEda8SaTZ6LrHiB0uI7ZdUubOSXdC1vHIrNDGzeXtbbH8u3d97/gNVZNP8Uagi3195dvtuprf7It15kk8Pyxqytt3KzL/AArt+b+9t3V0d1ZySanZW99o+jWF4stnZ31tcyLHLLC3+rWNmZtrbm3bd33l/wBmggrapJoN5Nq9x9huLPQVXbLbWlzttp1VWZWVvvLJtbb/AMC/2a+BfjjJDdeI9LvNLjfytPlWSRmXdt2s3yt/eb7vzV9o+P1t/CPhu88O27Oi2s8iz7mVlZvmXc3+z/wH7q/Lt+WviH4iWMMOr3Vrbxp5Vqu7Z8zeZu/u7vvUAfXnwg+LHh3xppVh4gbSYLLUWaPSbmCxZmaD5vlnZf4vl/8AHl/766yW68TWcs8eua1bta+b9l820kXy5Wk+WPcv/LPb/ss3zfd3fNt+P/2dfiBN4F8baTbyX0X9k+JEWxvJGXd5Ctu8vbu/iVm/8er7LvLrSZnuPC9notlBoesQRyRSLG01zbLG33vlVV3bmX5m/u0Aac2pXkjalb3ytLFp9z81tcx7WVvs7Lujm3fL975axv7J8F+KvDlx4J8ZMt/ptjpX2OdLuDy55W+b5d3/AHz8y/3l+7TtYt7ySW/t/LurqS+01pI7ll2r8zbdrbfuqvytT/E9w39lWtjZ609x9lb7HqN3Aq7rmNY/3izMvyxtu2t/C3zN/tUAfOPxD/YCj0Dz7v4f+MJkt9S/eQRTvHPGu35mh8xWX+8qru+avmvxV4L1rwO72OoRzs0yr87xMq7f7vltu27q/SC08Qafa2lnpsOmz3EEbtDHc+Yy7vvSecq7f3nzMq+Z/wBNK5T4pfCXSfix4ei1jTdSddbt7SaZbXaqtcrt+aNo/wDvr+Ffvf8AAaAPN/8Agm9r2n6gPGmg3F9b2us2rWd9YxTy7WljjVlZfM/2v+BbvlX+7X3v9lW106DTYWgltpIpJp5ZVZpV3fNtX/d21+WPwL8TeIP2Ufj8tv4u8J+fpfiCJdFnXUVVWiWbcscit93dG3zbv+BV+pOm6lDeWllrUkbM0cEjRNt/eRR7dqxsv3fmoLPJfFWm3lwqeXut4LySaRVj+VlVm+bcv+7XzJ8U/Dt9C97ri6kk/wBsl8mfynZWWFm3LIy/3t0bfe/2f71fXPjGxvre8luLe8lliW5+/PEq/e+98v8AvLXzL8XIbj+xn8yO3sp1jZmg3r5as0jReYrL/s7V/wBlW/2aCD5k8X6XNHHYQ2caeX5XktJv3bpmaRdzbv8AdVtvyqu7+9VK2WNo4L68tYmaGKSNU81lZmVWX5v9n5f4d1bni/ybea4+zx+UsO1l+ZvLb5lVW+9tX+78u7d/FSeGtBXWNSgt76b9/bqq7o/mjZpJF+9/wL/aoLKfg/wbqXjrU0/4mi2FruXfc3KbdrNJt3Lu+X5VX/7H71eg6J4Taz8R/wBg291Ja2dvK0MUskS+XGv8UjMvyrH91lb/AGq29N0fT7PVre68P3yQXVxLJDBp8iK3m+Wq+YzN/ErfMv8AwH/ar2r4aeF5NSe41q4+yrczQM2oSQRq3mXTRqvkr/F5W1V3bv8AaoIM+x0nXLfQtO26ay/2xaQ2t48Sq0cPl7vmXd97cv8ACu7+H7u6vAv2mNQs9D8VXE32eLUbO3s5Lfz2utzLM38Xl/xbt3zV9VaZ4bvLXSbzWLG6it7WFG+zQJPHLDOy/Ky/7vzbty/3V/u1+f3xp1y48eePbzRbe8+a3vI9NtovK/19x8qszf3fm+Xd/s0Ae1fAWzhkgsmh0e3nl8UXkkeobo/mW1hXc235vmb95u2/xV9P/B/w7ovh/wCG8VrpK3MrW/76Pc23y1a5ZmX5vu7tzf7teI/Cj7V4XsbWz0/Sd1/o8kdxBP5fmRrdLtjkWRlbay7VZq+t9CuNH8L+F4vF2rXlksUME11Ikq+RA7N935mb727d/wCO0AdP478RaX8PdHvdY0fUI7NrpvJnVFVm2tGvzLt/u7f/AB6vgb9o/wCIF41nqmpR3Vm11a7Zlkba0zbvuxt/tf8AoNcl8cf2utW8caxqOj6LpO7TWeRfNSVt1yv+r8tdvy/eX+H/AIDXmutfBf44eJPCj/ES68J38WibW2xXMrLNIqtu+6y7m+9uoA8rS6kvrmfUtQvHnuriXdLJIytJJ/eb/wBBrSh86RPJaR/s/wAzbd27c3+zV34b+BY/Fnjiy0HWJLjTbWSRfMbymaRd3+z/AMBb/vmvfpP2I/iBDrc9n4bZtS021i3Pd2zLJtVlWRm8v73+z/tUFna/s1eIvEniT4OXGg3mk3l/YaHebp7yNfmj2ssiwr/3z975q+8/gzq32PTtLtW0mWKfWGmmeJW/haRdrMq/dVd3/fSrXzH+zN8ObPwb8K/F8mi2N/Ptlt/tMV3ebfNuIf3jTKv3W+ZtrL/s/wC9X0F8OvEWn+CdAvfEni7UG0610F7zULn7YqxSS/Kske1v7zfw/wC7QB+SvjfQ7O4+IXjLS/D9ndXFla+KLyO2aOP/AFcMk+1d3/ftVq1qscnhP+zYbGaB4IYpFlZY9qzx7vmWT+81YOsa1dah4wn1y8t7qyl1bUJLxdy7ZI47iZpGhZvuyKrSf3f++a176+kmtp45lWKC4i8uNVVdyyfdby/l+X+9QBkJcfaEuIWj3W6s0kbKv+rb+FVX/vn71bejx7rR5JrX/lqrMqxfu42Zv4mX/gPy/wB2sG2tfLaW3X93uVlVmb+Fv4q9W+GfhnT5PENvql5NfwWCz+Z5Hlf8ttq7Vbcv3dzN93+GgCp4ejvNNbWf7Q1Tb5cEKxpBPtWeSRmVV/76/hVq+7PhJq3iLw3q/g3wfdaXpF/BpsC2Lzx3P7zybtfLVo1+98vlt+7b/Zavi3xP4X1qz+IiR+Hbid4oZY21OSKP5YlkkXzG2s3+z95W+XbX0t8HIbX7PLrWn6pcfb5tatWjnkiWNrmGNty+Wrf6zcrN/u/LQQfGP7Q/hG8+Hf7S2v6LqkKRNb68twsca/L5bTfu2X5v7u1v+BV+kHwpt/8AhKNDs9Wh1xl1K4sZNU0+fyljaD5vmj2/d3bv738LV8af8FQLN4f2xtW1H50i1DStJuo/l8varW+1WX/gUf3v726vo39nLUrzxd8HfB+oWultBLDctYyott/rNrL80jM25vu0FnoHx11z4oeNvhXZ6h4H0m6u9SX7RDrltp6qsisv/LTb/e2/N823dXwpq3xu/ae8B6nFFHN4j+yzMrNBqfhyRWj27f70a7vl2/8Aj1fqBB4dkWF/+Ef161i2yyXDR3L7V+b5mj3bv+Bf8CrBv9evIfDqeLJNQsLh9Daa1bz7xWkkm/iVV/i/2WoIPy21L46ftG+KrPVNN1jVtWSXWLlZoPL05o5Y2j/5Zw7dvkr/AHvvfe/76paN8Gf2jvi9M8l8urPp0O77ZealffuLZfvM0i7vl/ibbX3h441CbVvF2nRrqUUepXGn3ElrYtGytLGu1dvmbvmkbc3yr/d/i21B4a0m41jwpq/gfWNWvkvL61aSSfd5LQQybtts3y/vvlX7zbfvfw0FnzBpX7Bksf2C88QfEt9PgurhYo5U0hf+Atu83a3+983/AI7XQv8AsB6Db+f9h+JGoterJ5ljL/ZkbRzfN/zz3blb/gX/AHzX09F4qk8aPZeIrrR2bTdBi+x2kcXy7o44932hYfmVm/hpl14ytb6a4jsY0dlW3unubN1kijjZWVWb+63yt8v8W2gg+W9T+Hv7QX7NtxBeaHpsvj/RI22wahpEUkkkDbvmjmt13Mv3fvfMv+1UM/7X3iKHTL+x8efA+Xw9Z6lqdrN/aEcEsS2k0LbmWNWjVdzbfmX71e3Dx9fTXPmafrTtokd4tmsssSwRNdK25o13bdy/Mv8A318tat7q2l6l4E1fUI7P+1PCmsTtNO0v71mZv+eMLN93cy/e/vbvl+agsz9E8RaX4g8Pf8JNp/heXdM7LFEu3bFG23bP833VZdv/AHz/AL1edfGC+uL7xnpuk69qSrBZ6hHYrOtt8sDfejWNV+Xc25fus33V+b5a6yw8M3XgnxmsNrCmlWV5LDZrY20+22nWZVWORty7mZW3Ky/N/D935a8w+KUNvpvjCWS6urdbyznhktYllZYZZGb5ZF8vbt2qqr8396gg2Nd3eH9e8OafNqTS2TQSTTwWkce5Zmb5Y93/AC0b+6v3v+A1X/aS+FcHxs0rVPHHhSOOLxb4Jttt5ZwLu/teH7zSL8zN56r8235tyqq1zdzr3ijxB4jimuNH+x3SpNJbWd1u2ys0a7vJba3l7mjba25fu/8AAa9e+E+qL9vspPC99PealdazDJc+ejeZbLGv3ZplX923y7f9paAPjP4U/FLWPhv420vxtY6gyxWbeTeRp/y1tWZfMX+7/Crf71fpnp+uafrVhpOreGfG1vFo11A0f+jXayWzLI3+pVv/AIn+9XwB+1p8LdP+Evxme80FVi0DxdA2tWLbV8qKRpG86GNl+Xasny/7Kste1/sI+NLO88HeKvDuveIIIpfDd5DrmnWcsfmzz2sistxHGq/Myqy7v95l+9uoLPpyyt9P083mis1vtX5ZY5ImaOSaZWXdDMv93/aZvm2/eWp9RvJIbiDUtLazvbXS47eNp9zN5rfNu8xf4mX+Jvu/LRpUNrawv/p2+3voGuomuYvM+VpN21lX7u35v3f3vmpviGSz8L+VDZ3yNYNbQtp8TRrF5/7z5odqt8rbWb5d3/j1BAabqTeHbHxD51qt1/bCrY3MjNG01sy+Yy+Su7+L5aWVreHUr+PUpoILyRVmb7XFumgVt26aP+H/AGdv+9/wGG1sbib7bqV5JZabeXXnXm5omXzZNqr5ce1mXdtrnotFvLXwZpFna6o73900lxO3lNJdtbxzbttx/tMu6gs2dFjbQUt/7YvnsLzUJbizlWSLzJI1m2/uZv8Aa2t/D/e+WrsGqTaPaveSWNgn9jv5ltJGv7v7LJ8rNu/vMu7au3+JaoQalpsl9b2djpdxZeZdLHcySqyxRTNH95v+AstFva2djqSeFdQjWe8VmhW6gZpPl3N5m1lb+6tBAlhoa2tlYTXl8qtZ2slutrFE3+rZvlVf4V27flb/AGqiu7G+mu1sdLW9t7Vo2a5kiZlhtlX5lZpJNyruVdu1afcXyt4W1G68mW88m5htbaWW52y7lkZvljb7y7vl/wCBLWt4n1r/AISCLTfDNnb6lqWieYrXN35CrHHeKyt5czNu2xR7vl+795qAI7G4sZppZrXULJljtlt1WX/XfKrfKv8AE3y/53Vn6ha6XqFnp1ra6lbzwKsP2FV/eKrR/vFmb+783+fmrSsLq3jv9RurWz+0alHG1nEqTxtFAu6RWZV2/NuX7v8As1X0rULqPTYvsMlxpyQ/6V5CfLOzMvy7t275VZV/75oAu6jDot5rEreG5LW/srpIbq5ikkaNrS43N/D/ALX/AI9t/u1VuI4dtm0lvvt7W6aG5gtdyx2kKqqxszf733V/+xqLTrW41iwhjjvoN8zQ/vFiWGeJoZG8zczMvy7vm+6v3v8Adp9tNHayrfae3mbbnzo2iVZNrSLt+bbt+6397+9QBSlt9SuPDcF9azRfao2aNvPnWSSa3/5aKsa/KrLu+997dTZrG38xLOzuoreytVjWeWKKTbLJGzNCzbm3KzfN/vbVre0exW1fxDcNcQO0jbVktrbdJuVd0m3+6rf98/NWBDHcWqWeqXkdwqR3M1xBbPJt8y1X+GRdvzbdvy/L/FQBV0Wb7Rdz+KrzUvsV1J9ouFtnib7u3cvlr/CzLt+9WppP9rL5urala2em6pZ2P257ZYpN0DbWVVk3fM0m1aJo/sNtodnY3Et+mtW0jXixMzSQMrKqwSTfdb93833VZt1F3NNpb2tvq32P+0dSto4Z/sN00nkRszNtkb5t3yrQWN0DTVkR49PmuPtt1I0krStHJJHbsrboVVvu/Lubd/eaq8lrb3VhY3U1mur3u6O3tpIGWT7y/NIy/wAKr83y/N9771R2F5rVjqss1qqK15LcW89mtt5cksMy/wB77y/+Pbt1Mu9PvLpv7PvLhbCDR5Wa5WKfy2iZV/1Pl/ek+Vl+Vv8AZ/3qANLwzJZ2+u2Wm/YWs4prz70cnmLOsMi/LIu793u/9BopPDzNY+JNBvrhbdF1CeT7VZwR/u4pF+X5pPm3bfl3f3mZV/hooIILqOO81qW8s7pWk8PpDIltuVt0zfK0at/dVf8A0L+GrSTWtxLdR6THFFbrdL9liRlk2/Kvys237v8Ad2/xNTdFhs9B8T+H9NtbG6l0uNbq8b7Yu5oJmVfJZmXduZm3L/d+Ws2GPVLG5t411S6s9sskcs8s6szSL8235V27VVv9lvmb5vvUAWLbT7i6s4Lhmt0vdNtpGWDcu2GPcrMzfMv7z/2ar0Nrot5fM2patZ/u5I428+Vtv7z/AFjN/eb5fu/7X8VY2ls0kMsM2oXkCqjWM8V3beUqtIy/vI/l/eUTabpNnDqVnp8K6knmTXUFy6+XJeyRwqu1fm+Vdqq2773zUFlvSLq301rCZfDcWlxW88mpKy3ytFFbq27a0bfM3/AWpwtdcjSLRbOzW8dbn7ZPOsbLHLb7ty7l+baqr/tfdWnzQyaxFZra2qXqyaYsnmrJ8ttJIv3W/i+Wp4ppIbz+zVtbJt0C2bXjRfLGyr8zKu7+98u7/Z/3qCC5qupWcl9atJIurwQ2kk09rBH+8jkX5VVW2/d+6y7f975v4ca2s7i8+33EesW6wLpzQweai+bHI27d+7/56fe+9/dWteZbFtVv9UkvLlLeNVhbz0WNpVVf3a7f4t33v7v/AAKqU0kckVrfSXHyzSLZ20Gz7NHB5it+7Xb/AL33m+7QBoXd1NqlwmpQtsikjVW+yszRySLGu5m3bv7vzL/s/wCzWHovjqH4iaVFHoOoadqL6Hrn9j3kcsSrHuhZo23Mv3vuq3/AVq1puhyaPbwWOmyQTvYxyXVzqF3GskMscn+ujbb/AA/w/wDAqdpum6bpt3pt9Zw2ul+ZBNeSLY7Y1aS5ZZI/MVfl8z5Wbc38TN/tUAVdE1TUJkXS/Dt5Z2ssnmaHFBdt5cnlr8yt/tNuX+Jvm3f8Co0prPS7+40/T9NitUWNmvvtly0nkTSfLHGqqv8Ast/30ta9to95eX9rqTf6ZO08y2qqreZLcbVZpGZvl/i/8drEv5tQ1aa3bUre4lSG5ZpV8tlZmVtrbl2/Mqr8y/7tAEmkaDZ6s91cf2bLu0mC4uF2q0cawyR7WaRVX7v8VS3mnx61/Z2pW8l1LFHLG1zbNLuVFVW8vy42bdt3fN/3z/dqxMs0dnqOoahv8qSWS3tlW2ZZ45lVW8yRf4Y/m+7tXd81UtK1TS1v9B8SatC/mw3PktLdXbeXEqx/N5kce35WZtqq21tv977tAHi3/BVDGlnwppP2w3Hl2tjC77V+ZY4W3N97+9/u0fsN6PqHgv4TWfja4WKJfFGpzWto086/ZpLeP93tmX73yszbV/yvK/8ABTfULe48aW9vZtKsULLbxM7fN8vy7f8Ad21lfsj3moSfDr/hH5PDNxe6HdX0bSaqvneXp833pG/u/d/hX/x2gs+xtOs75vEVxotnZpqVvDqEk2nWas0n7y3Vfvbvm8vd8y/+zViDw6t94vg0NtHt0W1nXxFqdrLdLM0l1tZlmjb7yrt3fK3zblaovEOm6bfeLLDxZqGpPolrDPDGtzFF8sMLLtZW8tv4mVW+b+Ku3j1LwzrVn9u8N6XbwRNbfZZfIjZWlut3/LT5tq/Ku5v95qCDwz4sfY20me4vL5/s9xL9onWOX5lkX7v8P3W/8d2/7VfF/jm6WSW8mhmeL7OjWvlovmRt83+7/D/DX2b8ZrNpNNl8v7FcSyWsm9ZNv7pl+7tbd/F/7Kv/AAL4X8SR3m9/tl95HkyNuttyrIzbf87v87QCto95G+n2Myx/PCyyK23aqsvzLu/3a+6PhR4muvF3gbwhJfR2/wBq1q0mjubm02wrF5bbmjZV/wB5f++v9mvgnw5532Vrdo0dJtytu/ustfWn7IutNb+Cdb0ubcrafeedpyrHuWOT5fl+b7se7/x3c3zUFn0P4B09tD03XJJrp57zUkmt9Pg+60cKt80iq391lqnqOuSQ65o8NrHBZaDcWc0euRRKsbSqq7t3zfe/u/d/hrstTt47fRLy6bQ1XybVftc6yKu1lbc0n/j3/Attec+LPLvPCviOO8+ywTyeXY6e0sTQK/y/LJG3+823d/s0EEHia+mjs9EurezSw0aTzFgSeVmmijaZZNrL/D8yrt/3v4as2euSWviuDxFp8KXVleaisK3TT+XJZRzfKzMv+95e1f4VrmGjs7jwZq3gW616WW6hW6m/tBpFhZfLVfLh/wBr+7uWtjwwtjp/g2803Uri3nntb6G6udkS7r392sm1d3yt93bQB2HxO+Cvh39orwTFpetfNrel6fIq3UCqzSSSM0cMi/3l+9838P8AFXJfsbeItes9E1T4T+LoX1TXPDd35kU93KzSSWMjMu7b97zIfLb5f7tbnhLxdfaDqVr4iWNradV2tFAvmRyRyTLuXb/Evzfxfdqp8Y/gDDZ/E23+NXgnUH8OzySL572iLHuuF3MrM33fLbdtb+9/s/NQB7Z4kt7GFpdSuJFnaNpprmDdu3M3/sqs3/j1fNf7Q9x4fhu4IbfUrqC3ktJGa5W23L8u3/Z/vK23/drvdW/aAsbHwSun+NNPfRLyaSS8320az+f5n7tvmX/Vr/st93dXzr+0J8ULOzuIppLqWzurG2aO1i+0+XJcrt27Vh2/vN3/AD0/9B20Fnk+qL4f1zxJp3hG41pmsNSu41VmXb5cO3czMrL8vy7q0LiOHw/4lW802FPIs4mjXyo2k8zy5G8tm/vL/wABrN8KW9/qCReJtZtcXuoXEkcSRfM0Maxrt27l+9Iq1raR4maHUIPs+mtexWMczfZrqXy5FjkhZdu7d/Du/wCAtQQdn4Ek0tdes49Qt5fs+oRSLbPtWOKOSORZd25vmjVm3f8AoNe9fDGx1CxsrObUFWCDUtSWFlkZlZWkj/dyR7v9ZGyr83zfw/w/NXjHhTRfDuueD9N0f+0pd2pT/YXSWL95ArXG1trbdrKys1e96Dca9o/h2KFpILzTtLtvsdjI8HzKsbeWreX92Rm+792gDS1u303wj8HvE3jKOFLW00+ORorGJVitlk+7t27d25vm/i+Zf96vzN+GdrceOvipBqE1xHZM09xrDyszblWNWZVXd/tKq195ftf+KLfwL+zj4g8L30duL/xJ9lhVdn7xWaSOT+L7u3a1fMv7LnwqfWNG1b4k2sc7Pp6SafBsXd5P7td0i/3vmZvvbfl3bf4qCz67+Cfw31DR9Ktdt01xceIp4W8qWf5pZLhl+ZV+95e1du1fl+X+81eUf8FC/jNeXGrwfAnSdNt7DTdvmX1ys/7yNl+9bq33Vi3L/wACVa91+BWi32n+BtO8VatbwWNroem3Enntd/8ALNWaTb+8+ZV/2f4Wavzi+M3iq8+Knxi1nxB5zLNfXjWNnul3blXav3v7rMzf99UAd/8AsxfCWT4veNtIt1XyrPT3/cN9maWGNWbazMy7d275m/h/2a/RX4iaXpc3wl8TaNeWtql1osm5PLb93cxrCq7l/wCA/wCz/DXhnwR+FLfC+HwfH/aH2O8VZIdXlWXyYLtZFZV3Lt3bY/lX5dq/er3OOSz0PRJ9JvtYa6drOS3uUVFbzI1kXaq/wsvy/L/vf71BB8EX1nZ6DfxaxcWtrerpssdxcu0nlzRwyN821f8AV7WX/wCyr6y+F/jqTw++nSaHdW+paHrnl6lPdrK0lzbN8sflqq/L8qr/ABf+hV5T8WPB+seDdc1HVNL8Po8WpKrNLPB5bNb7WZo1j+XzI9rM396sTw54i0XwX4jXUNNt7Ww3Jb+VafNBHd/u/M+6zN8u75f+Bf7NAH2P4bsdN0tNZ0+zt7dF8ZXMnzQQN5Ns0e6T5fl3KzNJu/76r5W/bS+Lmm3HxBi+DvhO8vP7L8NyxtqUrOu2+vJFXbH8q7WX7vy/7v3azfiL+2R8SrrTby4a30jwvAqyeX5dmzTRsy7Y5FaRl/h3fw/7tfM+nX2rXn2S+1C8uL3WLi8aRnlbdt3bfmj2/Mzf3Vbd92gDI+JENr/b73Vra+UsjedF86yMjfwqzL8tUdB8daPY6hc2fijwv/alvJHJCvmXLRrHI3yrM21fm27l/wC+a7u88ItqSy28Pm2XlwfvJ7yPy/m/i2/d2/w/7VQaP8HfAuvQazJH4w1m0n022jmaKOzWdZF3fN838Kr97+Kgs5zQLq11a/XTbyO1tYLiVY2nklXdGu77y7q9T+Gl9/YKXlrDJb37XF3Gtsyyxq0TLu3SLub+6yru/wB6r3hr9jbw54o1eCCP4u3GkyyPHNYzajpibLhW2/dbzF2srbfl+b73+zR41/Yv1yz06/az+JGjz6lDcyWdtpz2rR/bm+b5lbzG2t/d/wDiaANnXdLs49DtZNJsZ729a8kuNR+1y/Mu7b+7jbd+8j+X/wBCr3jw7a2Opa7oN1bw3EdnrFmtxPFJtVbaSNm/1Kr92viS31zx98H5pfDfirT9U07zLtVW11P93HHGv/LSGRv9Yvy/wtXvHwT/AGrvAHg20ns/F1y1mtnd/wBpRKn73zFVdskcbfNu3Mu1fu7W/wC+aCCD/gq7Hp9r+0b4ah01X3Q+DNPjkZ/vMyzXO3cv8Py7f/Qq9w/YM/svXPgrpMceoSpcW/2qFY2VpPJZZFb5W/i8zc3zbWWvgr42fF7WP2gvi9rfxO1y1ay+1SR/Y9PVvlitY/8AVx/98r81fon+wNazWP7P3h/T202JU1KO8mgnll/fyR7m27f+BN/wH/x2gs+i7i1az+2zX1mzNv8As6bt3mS/7TfNt+X/AGf7vy/eryH4o6Ho+oaxPNYtb29uzL5UtpEyqvy/M235v3m5W/8A2a9Uu5m81bONb95du5WVo5Nsar83mMy/vPl/9B215r49XXJob+S1tbWXbFttt9zuknmb5Y22/eVfvUAfP7+Lv7SXVPGmoQ3d5LpdiraHdwRySNHIsm3cyrt2/wDLP7v3v7tanwS+LGoebqmqeMNUibxAsFw0Cxp5Czx/MvzLu+Ztv/LP/ao8T+G/Dfg3UNE0mPUNR1lWgmtdVWCRdzNJHuVY1b5d275awfh14Hs/h/rT+JLi6sNSstQaP7Jps8SyTxsrL8qyL8qx/L8zf5UA6/8At648H+HtRa4+yteabpC2s6LqEbQTt/z0Vtq/Mv8Atfe2/wC0u7mPD/izT9Q8Nrb6b4g1SK4tYrGziaKBVkjvNzSLbybV+aPd93b935vmb5ah03wjH4s1fxzqGsRwLawyR6la2zblWVZI2VoV+ZW/5Zr83zf+O1j6po+saDpkGl6XdPe3F9qel3WqrFH+/wBPjjkVV+Vvusqsrf7v8O2ggxr77cvjzS7fXLe1lgaeTVJbOWDzLCSbcv7z/Z/2tzfw11Gi6xDNcS6bpvkW39tStHY7o5PLtI/9W3k7vvR/3V+7WHr2rWtx4q1m4jt7O/t7d20eCJZf3kq/89l27d3+993+9V3w5pOi3Vz4c0PSY72W415I7WCWCJm8iZpNrM3zfL/rPvUAdL4n/snWEbT7GO8bUtDiW+tLlo5JZZ5o2+b95u/dr8q/M395v+Bcv46+Hq3Ri1j+0EuJb62a8dmiWZZ93zMy7W2qy/N93/e/ir3D/hHV8P8AiZtS+y2UUsL/AGeXzFjjVYVVW27d27du3fN93b8tcT4NvLG81vUtc8cX0EWneH/tFrpSpc/vo9y7ty/NuZaCzxHxJot94dl8OeLtDkvWVZVhk+95jSK37v5fvL/d/wBr7u6u28LL4o+HOq6l4ZmsUsp/G0bXVz8zRyRNJHtVV+8rf+hK3+7trc1jw7oP9iRSR3mnG9vtXW6ig89ZG2/e3MzN8sbbf+A7a0YdYh8L+JpfEVxo63UWuanp8c9zaXKyrZbm8v5W+bau5t3zf3f9mgg5H9q/wlB8Qv2atQ+IEGkNpjfDPXYbf7N8srfZ73y49rNtXy13eWy/8B+9Xzl+yF4i1Tw/8dvD1vpd1LajxEk2j3TLLt/dzLu/u/xNHX2r+0V4Vk8P/s1/Gu11iSK6drzT2W5tLlfJn2zbl3MrfM3y/NX5w+AVurfxN4XurKSeG6h1i1kieJvLkZvPj+6zfLu3fxf7NBZ+rOoabqmlva+GdPunnsI9sc6KvmSRs38Tfxblb71TX19dWJs9SmVInt9QjtZItyyefGzLum2/8s2/8drTjms2SXTbVWaWSPzJZPN8u5VvvNJI23buX/0Japppen32m/2p/aGl3nnM159rnlWGVmVvljb/AGm2/wD2VAGDPD4ft/Dt1JNqU+pLebrOKJpFmaLdMqsqs33WVmjb/gNaV5ptxodlq2l6OyztcWtwsWqzzqt2snlrujh+63935vm+8v3quS2q3kV7atp6QWd9B50Fp5vltE021WmVf73+zt/hX7tZp1bUl8izs2utSvJrbbp0E6LJJHHIzMyt93b8y/N/d3UEGXaX003hx7jXIZW1zUGkZ7O5tJpJ/Jjj27YW+XcrfxSKu1W/iroVuLPw3pES3DXUF59jsYblNu6SCFpGXy/l+Vt395v7zVk23iC+t3g0+TS7i9uJFa1sbTdHB9mWZd0itMu5ZFVvm2/K3zf7tOnuGvtUfQ11BoNEazWG5fbuuVaFvlWP5mbbtZv3n8TN8vy/NQBr31neeGb690/Sb6KVbNpLzfHGzSRyMzfuV2/ebdu/i+Wuc/4R+xt4LzS7OzvWgvNTjmf7LKskkbbdzNGv8K7fmb73zV0UN5Z3WrQa94ZWKzi02Bvs0W2ZZZ4/L/1ciszbmb727+83yrWFo2kroc39rSQ3jyNZzK0tzKzQxszbvL/3tv8AwL/ZoLNO3s5rrRZY1tfsT2M6yNA0qrI8e7cvyr83lbV27f8Avpq0tK1S32Nri6D5rraNDH9pXz45Vm+aST/Z+78v93b96qFtpMOlrf6tdXl0160DXEFzZtDetJJt/wBTt+Xy1/2fvf8AjtTrqlrJbW9xbw6i91rWmKsrXe2NopP73zfMrf7P8O35qAIrDXL7w3M99pOh/uNtxG0rL5ixs395VX7rbqu2tjqmh3l/Y3WoRPdKvnXcu1VhXdH8q+X5fzNuX5drVYtrzct0un+F7dfD9xa7ryS2naTy9qsqybm3Mu37zL8yt/dqlfQyaw97cRrayoqtN9sW72xr91Vb+7I27/vn5aAKtlp+n6fqNrb3yva3UmmzWM92ztNFu8xW2tGu3bIv/Av71Ztt5ehwwNNp+1dQnjjnvJ4t0sas37mNY12t838X+7Wlp+rQ3lurLZyy/aJ1aKWDbHJE0atu8zc23y5PuszLuqhaNrENzKupaatu8KtG8jMrMzKvl7l/i/56fe2t/wB9UEFi51LzL+8s/D9xe3WkX12saQTweQ0Ks3/Hyu1tqq3y7f8Adapbi4m0nTbpdN01tEl8i4s7tFTa0ki/dba38Xzbv+A/3qr3l1q11NqNu22KO+8loFZVX93GvzfMv+0zfeo3XmqBtHsbi3eeNlkjnlk3NJGq7WZmb5t27/P8NBZBLqUlxbQSQ2rRavNA1nbTyNtaRlk+8v8Atfe/2vl/4FV7XLdZnjvPsKS/6Mt0jNbSSRzyRqys27737tvmaT7v+7tqnf69qVv9nsdJhS6uLhvOuVjl2zL5a7la3/4F/F/st/u1JqGn2Nre2F1p8zadb3VrDa+RHdedCsLSLuWRm/ik3N93+Gggb4Lk1C48V6Hod1p73UEdrJeR3cSqqyQtIsjMv+7tVdq/eWitLT5GtfFtm2m3Fgyafc/2XHKu5YPJ3L8sbMu7d975f9r+Gigse7afb3zX1vZ2dnFHthtra5uWk3R7lXztv/LP5m/8eX+9WVrHl3UCW99GurS6tc+dcskf79bqOTy/3fzfdZV/75VqNUuFt4bKO8aK4TUvOuvtMafLBJG3mLu2r8q7tqx/7X/fVXdXs4be1guNQvomSZd07xXjRyRbfmZm/u/e+X/doIH2s2qN4Yv/AAr4skiW/wBSaSRrmT/llHDtVVZfvbmaRm/h27f9mrmnabDa6K15qHOs6bA1u0ccrLJBNIq/djVtsjNu/vVz/h6402+kTVG1i3vLeRmmnVnk2yKu3dCvl/LGyq23/a3L/e3VPb2t1a+HYtWaPS1iaS4k2tE3mfZV2tIv3v3bfeXd/wDs0AQQ6hNo+mbprWdP7PVptQto90VzLHCyyL+5b/e2/wB3dWx4as1tY1uJpoJ9Ghk8u5to7nbNtk2+XIrbW/2mb/7JarXNjpsPgy38Wafbxz2FxKskk7Ss0nl7t21l2/eZf4Wb7tM1a8m0fV7fR5PI1SKFofNa0ZVigVm8xdzN838X91vu0ASza9rTa/Pa/Y5bjUtQtrj7C08v7uSNV+Xa3zfL95f++qyP7Qj1Sz+0X2+X7Ppn9msys0n2uSTbuZY9u1dq7V3f73+1WpZ6a1nqUvnXjQT3CSWtzLJukaBmVmVl3fKu3d/vN8v+9XMaUt5oemNHeSXtvqUN5GrLJK0klzHJIv8AEvy/Mrbd38LUFmzeXFrHfX8kaxXVndeXpqSxStHBBH95m8tv9c25vvbf7392kuIdLutFn8PzaparaabeMrK0Hy3fkqu1VZW3fd3f99fL92tlYbXUBZ2el6K+kxaakm2eJ/OiW4/hZty7lbdIvzfxbWqaTQZIdLvNQtYbxbKxjjvGu4J1aRZGnZdu3721m+98vy0AZ+pXXiLS/DunXyxwWDyS+Zp0Ee5vlZlWSZo/l+ZV/vU290WG+t9UjVrdItJuVs2ngdvNX5d3mbW+b7v/AHzuqe7huLHXLyHUlgurPT0uLpZ523NHD/Ft3fN8zfw/3dvy1j3l1qWl/Z2vJnvLe+s7qFZY/mjlkmZfLZV+8zfd2q3+1935VoINi48Tfbry/wDE2tapPcJeXMcNnasreXPMrNHt3bvmbcv91laq3ge+vI5rXQ9a1CKeC6u2k1BZ2b5VWb5VVl+Xd91fl2/dZqrwR2+noq6LqypBY2n2VnvEZrmWSNtzbVX5f3is1XdBt7qPxCt1qzT38UbLMqyNHHAyrJH/AKuP/ln/AKz+Lc3y0AfHn/BSa4ab4med80XnXNxtgVvl+9/s/wC9/wCPV9CfsZ61cf8ADNmg6WsavZ3jXWmxrEjSeZcN8zM237u1W+b/AIF/tV89f8FK7r/i7kVnHGUWNrhtu35fmb/gX+fvV9C/sT6xceFvgToHiiGRLmWx1DzFsYoF82O3kj2yNH/eb+9u/wBn5aAPUNBax1DUtO1i80NZfDdwvnKq+WyyzW23au1fmb5mXc3+7Uslj42jsNZ0/SdJgfS7G2/tK8TeyyKq/LG0LbfmZqr3K3nhuKfUPD+lvpc9xqTXG3ULllZmuGXzv4dq/K275d3/AAGs6ztbO61e11LR7ie6lX5b6WS5kj+zKsn8O3/WfxUAcr498Hw6fYytdaxFK/ledK7W22T7vzR/N/s/xV8FfEXTbO38QXlurRXFvDeMsUrM0cki7d3/AMT/AN8197/Fe8hawnutWkne38/zJ2VfM+X+Fd393d/47X5/fFGS4XxNqMM2xN138y7lX5dv3VWgDB0toWibdGnlSJ95v/Qf9qvsX9huTzvD/ibRY7VXum1VprVv7v7lV/8AHWVvm/2a+NLGaSaN4bfZE7Mu1vu7fl+81fbn7DFrD/wrPxDdW/2hdUutSa1tmTb5ax7fLkZm+98zK3/fNBZ9RW/h26s/Des6XcXG2489rhm8hpJJGjX/AFat/d/h+avMvEF1qXi7w82uSQ2HlaPJJJPp95B+8VdrMsi/3W3bW+b+9/davYPFl9HDb2dnHYxMt0v2VZElZdvk7d27+GRv/Zf9qvJfHknnX6WP9h3raMzNqCyWqrHtmtpFbyfL/wCmi/8A2VAHgnizVJvHmseEvCfk3D3UzW8cvkRLGrQ26tI00n+027b8u77v+1XV6xrGg6lf3umrrl5s0uONtDVYljjihbbu87+L73yr8qt/e+9XG+HvDeqLBrjXmrW9lf289xfNfNu3RW7Q/Kqyfd/1m77v8O3bu+aq+l69pdnojafuuL3UdYns7O5gT5WnhaRtscO7/abczf8AAqCD1qwvI7O8bSdD0n7H/bG2O6s3nXdC0i/66Nl+6qqrfL/u17x4c1Cz8aeCrrS7iFbiCTy1ib70cjbdq7m+78u1fm/75rwq70W1a9v7NoYkvPDOkLeTrFKzNI0bbZFb+98v97/7Guq+Ferf2TLocOh30Nwkdis2oWkXyxRw7tzSMy/8C+Vl/vUAcv48+GNjb2d5dabcKz2byM0DyfLu2tuZl27f4Vb71fFeqaPNffEOW3vpvNaRfJ+2Mu5YGjZmZtq/ej/h/vbm/wBmv0m8d+GWtVtYVuluLXzZl81du5lX/WQt/vK3ytXwl8R9Pk03436XJNNBFPqSzQ+W25YVjmWSNdzfMyqvyr/wGgsw/Jt5LFFs5mgv7Vm8pI/+WrL8275v93/arqdC8K3F5480jTW8QQNLdPDby3yrt8uSZd237y/drm7yxbR0TT5PKe5j8zc0bs3/AD0/eLt+78u2uy+GK6a3j7w5/aU1ncwXmoNulb5pI227lZlb+78tBB6Z4a8E3XhnUls5NYtbq80HXI9NsbO8fdBP9q2qrKq/dXdJI275tu3+GvWvAcN5G174Hurh7+eNpI4/mZlihjmaVV3N975pFX5fu7VrjNKuPDsOj6t/wkWn2t1da54hkk0+6X73kxzRq23/AGdu77vzLurpPiH420X4G+ELzxtr37xdN8z7HYxOv+ktIqrGqt/vMrbv9n+9QB82/wDBSD4gahq3xK0j4d2txFLa6Pp9rfTrAN0i3kke3azfe+Xcv/fVd/8Asj2E3gr4VNrWoRf6R9qaO8g+75qtLuk/3ZFWRlb/AHa+aPg34P8AGH7QHxgbxprM11ebb6PUNQuZImlVtrKyxszfeVVVV/3Vr9CLDwnb2/iDUvC9rawWc81nHNZ3NyvzS+YzeYsbLtVW+9/vUAVv2kPGUnhn9j7xbrxtZbBdank0mztZ1VZot3lx7mZfl+b73y/3d38Nfnf+zd4Bh8afFfS9JvJg0FnuupXVd0asqtKvzfwt8u3/AHq9x/4KD+Ol0/XNG+Aum6tLe2+h2cOoahKs7NtumXdtZf7235v+BLWv+yf4Rj8N/CG4utUhf7b4odf7P+zf69oZGWPd83y/xN/u/N/tUAfR3h/xNpbeBNG8RSbtWtdQivrHUJJ4vLubSG33fK39395H97d825fvbq1rPSYdYfRrxrWWLUdanhbTZ/M8mNVkVmhVlb5V+Xd8u7/2Wqs2qaPawS/D+8s1tbiG78t7mNfMjnhk8uRlkVdq7v8Ae/iat60k0/XFs9B1K6S3XUJfMs2+by7Ffuxq391mZV+6v/2QB12g2Nj4801G8RWdrFeWd5J9stmtlbypI/8Anmzf3o2X+GuW1X4W/DXSZbjxhoui2+nPeRrHBK06yNGv3W3f3fvNXoSaHpulxv8A2pq3/ExtfLtY57af/Rp41VV8yT+8zLt/+yrwT9pn4+aD4XW38A6XZq+ualayah5kTrI0VvuZd27d8v3WVf8AeoLPjn9pxvDtnr11D4fvor+3j3WNpIqt+68xvmX5fvLu+63+01eUeH7rTV1K30+NXvft08e1dzbvvL8vzN975fl/3q7/AOJtwt5qtlYzatPcRaX5e+NovLb5l8z5W/ur/u/98/NXl1ncWbeK9D8mSa1tV1O1bbJIzNu8zd83/j392gD3Sy0HUNSurq1166uLKzs1+VZV81m/hj+aNl3fMvzV0um6bqXw78MXljJcX+n/AGy+WTz937ye3WPy7i2X5t21pGVvm/3a5/Qv7N8Oj+zdUvG1KW3aaS0W5bcqyfKvzMv3W3fN8u3+JanfxVqk1/a6brGrQRaXH52zyovMlVmX7rMzfd3Mvy/w/wC7QQdX4Q8Vf2Dqvhu68Wakl5p1qjXVj58G5YoWZVjVY1+8zbvlb/7Kva7NmvvBi3GqWMC2Hh1VuLaLU23Sy3SzNIsiqvzLF8q/K3/At1eBeBvHk3hmCDw7oemtLq0izf8AExnjjaSNV27VXzPmjjVvm3L/ABV02j2uqTWPiHxZH4mt7+CS0Vrlm3NJPJI0m6O33Lu2r/6F/CtAHr0PiTw38YPhFeap4m8P2VxoVjqEmn21nfbfOg+0Mqq0bbtzL5jK3+zu/wB6vF/G37FPh9dKl8SeC42s28iSRrNp2aSLy2/55ru+8v8ADXrXwlt5rrw3o03l6dHYQ2NwySyfN5bKy+W0396VWX5W/wBqr3hCO18K2ek/2lb3l7qzS3VvJrMv+okjZl8uT/Z+9t+Zm+ZaAPzq1/wTrHhW6ihvFvliml/cSzwNG3y/3l3NuX/db+Kv0O/Yh+KHh3Uvh7ZWOk+bZS6bp81r5bXLSTRyM27d83+1u/vVF8WvhL4R+M0b6TpN19g8Qx2M0i7V85V2s3zbvvL8237tfnwl54s+EPxElsY473SbzT7yG4niklaPa0cn+sX+9G33t237tBZ+ydlrV94ijvLq3V7rbZzLfKkDRr5e35lVdvytXM6rqGqR7riPxA2nfaIodt3BAsrRrHu2x7v4ZNsn+7XiP7L37RC+NNN8QaT4gupVuvtyxrBG/wC/8uRfmkaT7zK3/fPytXtz6P4gvNIgt/LWdPl+eCX9zBHuZV8xf7zbaAPKvFvhG61BdWm02432f2m41Se6ndvMaRoVVV+b5tu5d3/Aq8rvteh0HSvD11DdXUVrcRq221jVpGWRfLZVVvur8v8AF/7NXv8Aqq29qJbfUrxWt4Y5vPgWRpGn+Vty/e/vf7P8NeMeGPCNxZ694Z8G6h5E9nosE10kEkfyyQ7lbdJI3/LTd/DQQdQum6sya9JfWP2VIYo7iBorlfMnhWPcsLfe+VW8z/vpqo+Hl1iO3XxZdah9qs9avLe4gV9u2OGTavlt/e3bf/Has6jp7aHqN14L2slr4i8ltKTYrfYZl3bljb737xZF2/w1s+ANH1KTSte8F+II3nuNFntbPTW3bfLt5F3eZ8v+sb73zUAeYa5oerW+u3Gj2OmrFeWrR30TMq7Y4Wkb5d38W35l3LW7oF9Z+HdQ8K+MtFWVGkvLyTzVi8+S22ttj+637v73zf71dhq/h+bXvH9ndfbLmO3tYIY52bdub95taPcu1VX5fut/C38NcrrHxG+D/wAEdV1mHxl40t5ovPuLi20FN17uXayqy/d27v4f96gsl+N3w91b4jeGH+I1m1xLcNZySanbSRyLIu3c3mRsvytu/wBr+61fBQ+KXiLQ5zbqv2iJd1uqzyM00e35W+b/APar3Lxr+3ZrFr8L5/hP8LfC0+kadqFs1reajqb+Zdsrfe8vb/q93+995d1fPMPgu81Czg1RpGtYNzLtkXdMzf7S/wDs1BBeX4max+4uIdcltXtfMVWj+9tb7u7/AGaoP8VPHkm2RfEzyyw7fLkaKPzNv/fP/oVe3/s5fs++OPGHiGz8aWdvBb+HNBvLf+1Vlj8uS5jba0kasy7f9Wv97+KvqzVPgL4F8QLrdxDbwWVxocv+onVYZJLNo/MVt23dIzbvvL/s/e+ags/O3W/iV8WPGGgL4N8QeL7+60qGX7Qtm8qrGZP+A/e2/wB1vu0nhJbpvFvhVdP/AHtx/atjtaT5V8zzlZd391fvV9S/FD9kfR9SaK88H+KLewutzeXFfRN/rNq/u5G3fNu3LtZf733a8M8CfBnxvJ8WvDfgfxZpN54cn1aeS6We+tmgjaGHdI0kO5fm/wBXt/8AQqAP058QahJfajZaheaoyT3k6tPBA0ayK0bbVVVX+9/48u5qyraPVIdLRYd3iC6uLyaNpVVY/KVmWTdHuX+Hcyt/vLWgbqa4vvMs47eKK4WGOOS8fbOsKr+8aP8A7527v9qs86Lr1vFcXkeofarKzvlvovKby5I42Xy1jb+8q7WZmVvvNQQF3b+G/Ji0u4t7C3ZrS6h+1ea3nrIy/Kq7f9pf7393+61UNEtY2+z6bp7W95BosvlvqCbYp47i4jVl+825t3zbt38Sr/wHobqTR2u7O1W8lggWxkmXyF8xZbjd/Fu27V2/3fu/7VYdkt5a+feNo6N5jxw3SxSrJ5f7zy1k/h+bb/wKgBba4hk02ez0trVnvLmSO1W5i2su2P8AeN/dVtrL81JFrHnX8/hHVLqews2RvszT2yrIu37sMkkbN/d/8eqK+jt4dORWaNoNJ1G4hSC2bdLc7o13NI38X8LKv+9urU1Cbbpr3Wj6fOkVw8N1+9k8po2X5vL2/daNl2/N/s/724AgsI5tJu31LQ5P7LtbiBdsXmqzRtGrMyx/3d3mN8zf3vvVFc2fiSzsdXhtViVpGWSWT5pvKjZV+WNWb5m/z838UVnqGtQzLb+dcROu2O8kitvMiVbj7vls3zfdXbu/vfw0zTbzS1ubyazaW6lurRl8+TdDBFGvyrtVm3NI23+6v/AqANWS4sdL1C8h1TR282ORre7uYlXcy7VVl2qzfeb/AIF8tUtImutHa9s/EWkqyq0lqjfLI0isqrHNGrfdbd97d/wH+GjU44bOTUYY5Im+z3zLffvWjWJpPuxtIy/M3yt96rWsTXFvdvdaC1leRLHbrePFH+7nXzGZdqybWjZfvbl+9t3fNQBl+BrO6k02LVNS1IXDXlpfQ3LWzM0TeZIu5fLVvvKvy/8AAmX5q0bfWIdP06ddJ1aCK3s4o7GCJkZmu1j+bztv3d33l+9/FQ+m2NvLY6p/Zs6Tx+dHFLA6t5CyMrM0n/Avu1V0iHUpJbpZtPsrDSL68kkWO7Vo5p1X5Zmb5drLJ93+Hb/6CAX21LS7jSdXt/7DTTrK8VvPngu903l/xXEaxrt+b+7975fvVQtLfTbO7t9Ssbi8SDS1+x+fdOyzq0i/ek+X5l2qv/fVXdTjXz0a302WztfNW3S+b5Y7SP8A5aMyr95fm+X/AHabql5NJqM/9j273tusk1rPulaNpdu3y5GX/wAd2/7K/wDAgDPfTYZLvS9LsZrOeWadbqW+glWNbKFpP9ZJuZm+Vd3+183+1U0U2lrLZtNZ3vm3kEljA08HkK1wzfvv3f8AEvzL83977q1cs7iFU1HVNP01EvL6P7RFatOscjRw/Ky/L/yzbd93+Jm+aqV3NNfeIPD7SaXPeXWrW0moebPJJ5llHtVmhZmX5tqqv3fvM3+zQBahtY7EX98yywWVnZt5c6P5nlLuZV/2m/i/vVam0OO3sW/tKzTzbxlvLPz/ADI/KhWFlaaOP7rK38LferCvoftnhVre4a6g851WKKKVWk3NJ5i/Nu3LHt/9CremsYdJuLXR7W1uvPvLSa4gnnlk3N5LbpvLaT7ysvlr/wABoLM3wZHp/h9dLurqZ9n9s27QLI3mfvm8tVWPd/eb/wBCoq14Kkt7jWrLXLWxsJXuvLmRVi3NZK0y7dzSf8tG3fe+9RQBkaJNp8McWnzWqXCX14sKRSW25baNVbzv9nbu27f97/Z+XQOk2uqRpNqH2i11FdS+0NBLctHH9nWP5dzfxMzbm2t8v3f7tRS6hcatqS+ILyFbOzuNMulitoFZW2ybljZlX7q7lb+L+9/wGpFJdWukJqUNvBdXlja+ZbQXP71bbavyt5m35tu5vm2tQBfgbUM3viCHTfKa3RpGVol8iOGP5fMX+9ub/gX/AI7UaeFWj0RZGt717jzY9Q+0qys0UbM0lwrRr/C21VVtzf8AAqqTaXqHh/XtOsYbfUpUvnkvJZLxW22W7b+7aNvlZd27+L+GtV45rdlksf8AStRs7FofNiVv3iruZpGXc38K/wDoVBA1ZtDk0G8msWv0uNS05prHerbYpI22yMv91pFZVX/d2/3qRY5LF9ZWHfp9vqCrHJJPB5nmtt3NDu27m/8AHf4vu0waK2tRJHDtlXT5/wC0lWRdsm5fvKzf3W/2v4VonvoZNU03/TkdtSvJIWtlb94v+r2qrfw/M3zf7Lf7VBZA+pXn/CQtG0dqt00kPmO3mL8u1f3m35tvy/L838Tf3altrq6jhuLpft6pDfK0jS3KstsrMzbvm3M3y/w/wr/u1f16bS5L9tD8P3TabYW91J/au6TdLcyfeVd3zMsUflsq7mrJksf7L8Nqrasl5Z/2lDfT3c6NI32P5tsfmN8237y/8BoILTa1dRw3TNeXF/513G1rbLuiaRvMVfMbc37xfm+Wq9zHZyeJE0241xvtlxJNJHPI3mSSeXJu+zt5fytuZW/3fvf71i81JrfW7jSbf7Ar2/lzNPbW0kkfltuXdH8v3ty/Mrf7P+zWbY6t9hsrya4s7iB1jWPzdvy/amZvMXd/d2svzf733aCyw0epQyX91eb7rUbrTJFuZJW/dwbl3Sbfl+by9v8AFt3f+gs/s9o4Ft5Lh7afUlhZrmNNsn3d3yr/AMs/l+X/AIF8tMXVJNDtp7jWGns5ftk0MDKvmRxsyt+5jj+7IzNt3f7v3qtpcNJaLD9lMl5NEq2yz/uY/LWTdtbb/Fu/vf3f+A0ECaZujl06O3kltbrbJ5ryssnlNIzbVmkb5vlVdv3W+b5af4et47PxDFqTQ+fBcSRxySvF5nlLuj+Xd97zG3fw0/W9NaxeW3uLyK/tbpo4buRHWOFlkWTb/D8vltu/9lqQSa1Hd2ej/wBqWdrZr5NwqQWqrDBDH8qtJ/tMzNt+X/gPy0Fnx7/wUvZbj4oWbRyM/krcRqzR7ZGXd/F/tfK1e7/si6lpvhH9mzTta1JvKsLOWG8vGuo2k8uGRdu6Ndqq27b/AHv4f4q8N/4KHafcW/j+4a8kS5aFpoYpV+WNV+b5l/3v9qvcP2Nby1v/ANknUNP1RG1rTtQRrG6e+jZo7La3l/u1/vKrbV2/+zbaCD1XV9c0/wAWeKrK6vPIuLWa08mzjg3LDJu3KsjfLu2qu3c23b/ebd92Xwq2h6f4w8Q29rNFKumx+TOytuhjkX5WWPb/AA7m3fN/eX/gMh8I+HfD9xf7bjW9RuJpLe6gf7ZI27bC3mQKsjKyq22Nl2t/y03fN8tJouj3TL4j8QXnh+30O2ZftVjZ745Lny/m8zzGX/dX+L5m/wB5qCzy74j6stjYXVra3UDReU0c8csfy/e+9t/ir4D+IUkmpeIXWHY8sfmRvt+VWb71fevxTWx1BbzVJrjcsdt+7Vl2+ZI27/x35t3977v+1u/P7xHbr9ueaTz2WaSSSCTd/rN3+f8Ax6gCHRLWb/j68x4ljZvNXbtVl21+gf7FEdvofwrghkkSe11Rpmuf3a7o2/hk/wC+v4vu18E6OrSWlqtvIitdN5cfyfxN/er9Pvh7ptqtg+h2NqlrB9mjadrOOOKHzNq7t3+98tAHrWpahJqiW+qQ2Nu0qxxrYtKy7YFb5V3Kq/eZm+9XkHj+Ty9L1G6s7yNmvJbj+0JPL/dRRr8q+X838Tf+Pbf71evf2DpraTZ3Wk6lcLdeascltO3yxq391vm3bfvV5H498P6ovh690u11C3a381riWNd0kEv8TRs3zfe2stAHzN8V7i4ur+/+wxpP5yrHJZ2yq0EEP8Syf3vm+8y/981N44jXWNb0FpvKa4XT4WkvI13KzfN80aqvy7fm+9/7LUPxFWa++x2+m6K0D61Z/wBofaZY/Lmjt42+6u35du3av/Af+BVoaAtrcX8/g+HS1ifVtKWa0nuYNy2y/eh3M3zfL8zbvvfd27fvUEHRaF4s8ReMNcn0vULGKys4bFrdrll/eeXDIrbv96St74eeKtQ0Xw3reqLtlW+vGhW2i2tJLH91ZJJNu7bH/tfw7vvVxaeJtDsYdbhsY2uoNPsf7Pke0iWNZ5pmZpvm/vbdvzVufCjxlN4R0JNQutJ2aJqnmR2kTtunslVmVm/vMzfKvy/3aAPp/Vlh8QeGmkvPs7X6+XMs6xfu4/lb923+9Xw5+2h4BZdEXxp/Y7QXWmsvlXit5cka+Y21Wj/u7lZty/8APT/Zr6U8K+Lr6GZW/s14NB0/bYytcq0c92rSR+W3+0u5lVm3M3yt92qn7TPgvVNS8GeIPD66ek6tYs0qvJ5rSMzNtkXdtb5f93/0KgD49mvtL+xaHdaXb2sX9pafa6gzSMrRr8q7lZf4vmVmaui03S5tU8Yzt4d8q61u1iaONol2xxL5KqzRr/z1XduVa4H4b2dnbWlr4L1KaWz1uznuFiuZ22w+WreYscbN91t275fu13reKLWz1Gfx5rEKxrpNi10ssDLHJLNHJt+b+Jm2/L8v95f7tAHst3No/gXxJB4u1LUJNN8K6XBcXl9a6nE3nR3SqzNHGu75dzfd+9u3f71fIXx++L3iD9qL4n283hvQ7q102RodP0jTmZW2szbfMk2/KrM1YvxW+LXjf9oLxvb3GoXH2W1m2x2dj5m6OJd3ytJ/z0k+b7zfw7Vr6w/Zl/ZxhtdCuGvLWD+3mnXUIJZJdyxxxxqqrtX5fu7mVl3feX+7QB6D8HPgna/Bn4Rpb2t0ura9NKzSxWcDQzy+WytJGv8Ae+X5f++d1dj8YviNa/sz/CLUvEGrSW+o3V5Z7vCttcos0kV5N97dI3zK0bfMy/7P8VdJ4w8eab8C7PVPE3xS1q1bTdHto5rPTorZfMvWX+Fd3zK0jfe/9lr8z/jv8XvFH7UHxTfxFDps9las3/Es0hpN0dpb7tzN/wAC/wBmgs5/QdP1T4seOk1DxVrlw95rl402p6jOvmMv95v91V2/xV+g/wAJfB/h+68Dab4PjvPtl54fVmW5g3Rqse75dzRszLuX+Ffl+b/drx79nT4X/wDCH3ek6bq3hvbextJfam7wbY1tdrMsaybm3Ntbdt/2q+i9b0/T9NvNE1jwXJPobTTxzPA86yedGzfNu/2dq/d/vL81BBLYSaPr3jFdckjit7PTZP3lpJu8llhkXdGrN80jMvzLu/u16ha2dnq13eeKLe3t57O1tJIfLuYlVZPL+ZWX5Wj+623/AIDXL+FdPXXIbDxt4fsbd9Ohuf3lpFu8yKRW8uT5m/ik/wBZ/wACrs7K18Pq88Ojx+TcX0q266VcuysreZ/eb5dvzLu/3qCzD8S69YrYOviDULq2SGL7U6eR8vl7Vb5fm2/Lt/z/AA/Afx3161+IXj/V/HWl6XPbtNPb29m3mfMtrHbx+T/D+73SfvG2/L81e8ftJ+Ltc1LWNR8K6Tq11f6TZzrb3y6fE08Uu2NZGbzFZW2rtVdu3+Fl+Wvi3xBrl5Zz3UK6o9xbzRLIsTxfKrMy7WX+6yrt+agCv46k1DTdSbS1jla4jkXzJ2iWNZ1kVfusrf6v5flasvwha/2TqcGrXmxbqN5FgZtqrEsbfNIv+1937vzL/wCO0/Ur6x1xbXVPkgRYPJdpZ/MkkkVvl2/8BVVrPRrrdFDa+fvuIvJbzPlj3M25t1AHo+nag32W9uriQwPDLua5f960jfe2rtXa23+KsqTVrG+ZoZLPdPqUUaxys/zLI3zeZt/vf3v+A1zkMlrtW1jvrqC3WdmkbzNsTSfKu5dv+0rVoX02m2f2rS9JjaWJZVktpJH3K3lr/DQB2Fn4kutS1WW61aFmfUlaxibzN0tt5LL+8jX+H5f/AGau2e4vP+Fd6jb6xcXTeKvtzfZomuflW327VZdvy7Wba237y/8AAa8et9Bkaawa4uF06W8vIfMX+KBWk2su2vVLeaG68ev4y+x3F1o2nzw2N3Kn7vyt25VkVVX/AIFt+781AH0X8NtS8O3XgO4j0eOe9it9Gt7Gee+j8nyrj5pJJFX+Ld5i7dv93/gVT+DfEGtah4k8PSahM6W+rahJcW2n6hbMy39vGqssf/TNmZfM2/NWf4AZfB6tpsOrWGs2+peTpKafp+6GSeb5vJmWRm/1i7vm+6v3a6bWIdD8dCXWPEFiukro9jZrd7kZltGtml8xv+mcnyr8y/3VoIOv0zQ/FV5rza5DY/2Tqis39sqy+X5dvu3NDHGv8W1t275a+cf+Cjdv8N9a8N+GvGV9qFha+O455LWCxto1WS7s1k3eZNt/3vvf/FNXOfH3/goldeLrI+HfhL4cl8PQ2dv9jnuo5/8Aj527l87/AJ6f3fvV8n6L4X8WePtTbWtQuru48x2V9QvJNzSybv7zN/tUAdB4G1zVtJ1S31bwfrU9re6fP5yKsn7xVb7y/K3zL8v8X/fNfb3w4/ak8O+JvDMXhfVNSn0+8juo45Z77cvnx7l8zdtXcrL83+z81fNPgb9m/XtY1CCx03VtOe3WJpLllZf3vy/3o923b/n7tYPif4E6x4RCLfSN5VxPJHFJPtjZvm+Vlk3fMv3l+Vf7tBZ9/nUtF1q8sv7J1Zb+/wBzXFnLu/4+13bWX/gW3/x6qupWslrqN7dLbrdf2greZau/ywKu1fMb+6yt/wB9LX5z2Xib4ieC7yD/AIRvxJq+lvbsv8bNHIv+yvzV6z4f/aW+JlvoUE2tWOmyy7mmkluZ2b7S33Wbb/D8u3+L/wAeoIPuHQF0/UvEGuWfi63sJ9Rk0yOPSl8ry2imhVpFb7v+sb7v3V/hr4H8d/trfEi31O803wPffY7f95C13JFtmkbc3zL838P8NdNJ+3B8UI4pbPw74X0m1v5LaSG21N0aRolZdu5V27t237rfer5Vu9HmhudtxDcbt25mfduZWags7/RdZ+K/xIt7y81Lx/rksVqPMeBtQm/erJu3Mqr/AHWrU0f4N69M1vJ9qLP/AKud1tvNk2/w7d25Y2/3q9u/Y/8AC3hT4j+Cdcju79NL1Lw+9vbxwRfM13HIu5mVl+7ur6P1L4Y+D/DNn50OmwWtxDfWdxBHLctJ5qq25lb5dreYu5drfdoIPi34a/AXVtW1G8j0nw3qmvTQywtP+4jbylZmWORt23aqt8zN/DtavqX4e/A3wnodut94ws7XWbxrNWs7WJd0cEit8zSf89G+78u3b/er3K116xj1SdZNFli+1RtZ2i+RGqyxqu6aNf8Anoy7l+Zfu/7v3uT0qG4t7b+0JtPupUh0xrWVF8v9w3mNtZVX5t3y/eX/AGaALTtNMBDa2r6XEsDeVFeWqxs21fljXb8u3b8y7f4WqvJdaTfaPax/YZ2ls7qGaK5jj8xY1mZV+WRvmkX/ANl3fLV/WFtcN4kk0/VLLRo2s42gluZJr2yuPl+Zl+X92ysv97/aqJ7y30XWVtbiNLWzaSOa2ktomWONdy7ZPlbb95v++W/2aCy5eXki2F1pd9Jb3H7yPyLnyN0kcka/u41/i2/+O/d+X5abqdxazXi2d9cPdvNEyyQSSblibdt3LuXd83/stQW1vql0l7Zrb2eo3ELN599Fcq0lsqyf3vlXcysvy1Zsbe1sf7RuNPvIL37OvlxpcyrJ5nmfL95v4f8APy0EDdDbT9ev4v8AiSvrKafKvmRqzNJ8sjbpo93yttX5du7+L7v8NTXOoW98NRmsdqXV1I0kVtLtXyodv8O1VXbtrF0RtSt9Os5LfWp4GaWb7ZpUG6NopGVdvzK38K/N8tWtKuLe3ubWzaZrO1152s1ZWaSOKZf4m/hZW8z/AHfloLLWsafJNozapHH9jurOSSP7M3+olk2qyqv3mVtzfdqh5eh3E+oSWdnb6ddSaZIscrLIqtcMq7dyru3N8rKv93d/DUttG2m6Ov2xftUFvI2mvBtXzJ1kb93cK3+z97/Z/vVStr6zWbUrz5Ll4VVWk8rzmZfusu5W/h/8d2/99BBoafY6Lql5dXGqW72V1Y2MLWt5Fc7ljuFXcy/Mv8X3W2/NWbDb6l5ksOsMt1qN5tuJ5/PkljgVm2xqq/KqrtXdt+9/tV1es6b4TtzcW9jqSweXBHstLNW/0m6kX95u3N+82su5tv8AermZtNk0vT9R1SzZ2RpY1uYJX2yRrNIvnTKvzbfLXzPlXb/8SAC3V5/YOmwxyNPf+btXfOyxRxxruXcy/wC1/Dt/4E1OsPEUOoT3l1b3CS3Sxtb3MCxruiWHdub5vl2/N8rL96svSrq61KZZLiFvKtVmmtmlTd9pZdq7tv8AErK27/gPy1dt9Ps9Plv5JLhIL+8kaOSOX71yvl/e3fw/d+7/ALVADtSvrWGW11DzltWvnjVUjdlb5vm+VV/i+7/u1qQ3moRzy2N1qUSwM0c06uv7yRlkZl+6u5mVf/Qqpz6tpra3q+mtY21lFM6ssiKzNE235f4fvbdtZt5b3l0Fvo9Y8hlj85dkfmt+8b95IzL825fLoAt6xN/wkWpT3l5GDBcXLXUcDM23zPm/d7mX5Y/u7fm/9mq/qtv9u02y161mtYna5tYYo5X8ySeOZWXzFbd8qr8rf7Tf981Fa6pNJqVvp+sRokH25bFU2qu2OONW3fK38TSbd1XLSO11LVL1tP8ADcN5Lb/aGsYHT5ra3VW3bl3feoLH302pLc2UlxGlnLZvIty2/wDdybVXy5mVl+aRvmbb977rf7VY2vWN5a69eaXZ+Ip7z+zdTj897G1+WS3ba3zK3zL9373+z/wKrlozeIrt9UtVnZZpFWeCBWijtpvl2tIv97btq09reaXr9xcXX2qK3t4o7WdZXaL7bG25mZl+9u/h/wCBKtAFJLH7RPBa6lM1hLYo0arFHGssbbvu/e+7t+XcrfN/s1L/AKRY6ndSX0K6jBJbNa2d1P8AMsEnyt5at/e/ibb8vy/7tZ2lSXGuXMviKa1iguL6+uF81WWSFfLZVhXa33Vb7393/wAdqW/tftGoW9npsc9rFJdtNfeVdfuZF+VpPlX7v3fl/wB5vuq1BA19UuP7faZbOdoLdZPN2WbLG8kcfzQq38KrHt+b/ab+L5ad/aklnc6fJdXEUTSJcLBOkq/LGqr5nl/3V+6u3+Jl3fNTLK4bWrC1uLqG3stOkl3JbOqzSLG23dIrfe8xlX/gO2lv9Ss9S1HSFhs71rBlkWX90ska/eZd25flVfl+X+L+98rKwBe8LQ6TYy2GvNeQGC6ube1igl+VfO87dt3bm/h2/wDj1FR2Onw3mteHtUjuFa3/ALakWJfI3RySMsW75f7y/wAP+9RQBFomqLqDecqxOy3kkK+YirNcxtH/AKtf4Y41bd/31R9st9P0b92tqjLFb2PzMrN5PzM0Ksv3V2/K1JrWk3mqXNlpOpKkVnHcreXn2GBWZmVf3MckjN/q2Ztu1f4fvfebdWit9Ujs7K48v7BeWa3Ulyyxqqxx/L8sbf3fl/8AHvm/h2hYzX/FFrY2c+pTSRa5dXF5arfPc/NHbLGu3bG33t38W35fm206W11rwvpOmzfZZbK4jgt1W5WCPy442m27d27dIzfN/Du+X5l/hpbzVrfT7f7DrUnmpNP9nj89Y/JjbczK3l/3t0m35v7v/AquRX2g31z/AG8umwaXqOpXkP2PSrxY5PI8lmXdCq/Ksfzfe/8AQfloAuad4f8AJW/0OGNXv9QaZXaVWVoFjVtsat8u7du/8dX+7WXfXmk30Fna32nypeWtq1vE0rKq2V033W2qu3d/31/vfMu6LRLW61rX3bS45YrzS9SmuLq8uWaZYo5t3yxsrfNtWP5WVtv3f+A37W4tbWw1dptNluFk/fWM8qMrW15/d+X5W3bV+7/9lQQRaPNq2rSaTpOn6tocF4sTW9zfL+6aRfuybZNq7l27vvfLub+JqtLo815o91rVxq0H2iNVW2k+Zo90bNtXb8u5V/u/7X/AqrW142iw3Wk6t9jupdy2tr5C+dHEu1pGXzG+6zbvvf8AxNS6VeWc0Kf2LpO1ZtKkkafUZZJGsrppFZd0jfN5n3fu/wANAFm9+3alpv8Ab2peezNHMzSsiwbY9zL5K7d38W6q13pMd4n2PajPZvbraW0ckjefuX5W2/8APRmb7vzfep1zHdQ6ZYK1vZ6i9nP5k88it5azNIu1V+Vf4t3y7f7tFho+saxqNxdaXfT3uo6Ssl9cy2cSwQRt95lVt3y7fLbb97/vqgsppfeH47h9Smm+2JayyWMbXaTNLHNI3l+ZDH91ZFb+7STQxx6HZXjXkU8un20jLLGu5v3m1V3L/e+Vm/4Fu/hq7p2qQ6hsuNH0v/hFJb6WOa7+1o0s8EjLt3Nt/vLu+b/7GqEMNno9/a6TdRz3U9081veXby/uvMX5Y5vLb+Jf7vy0AOXVrq60drGOS8sms9TbdHJBHHJPDt2rt/6Z/ept54gj8i81CO3ggg/cq10y+dL5m1fLjb5dvzbvu/N96rVlcQ6b9q8O6lHby3WrQTKt4qszWixyfLtX+83/AAGsmXUpLWSzbUrxZYGeOGKeKJfL2sy+ZMrfw/LJt3Nt+VW/3qCDwv8A4KQaPDeax/bjXXmtcRLdRPIvzSNJ975v9ndWz+xH4ivpP2ab+1tbzba6Ld6pHeWv2nb57TRq0LeXu/1is3yt/DuVt1dH+3X5fizwR4c8UWNvus77RfJWVpfOk/drt3bl+X5trNXjv7Bml/2loPiOS6kum0vw/rlvqDR2qf6tpI/L8xmZl+X5VX+997+9QB9daPHDqmhaR4i86K3utWijsbxH/wBRp7bm+WSb+JmVvvbd3yrWvpf9tWuiXGnx+GUsLNWaSSVV/fSxtD5sMnzfvPL2/wAPy/xf7zVvEENjHqviXwn4m0W4t7ex0+S+WzgX5Y5l8vdMu5drbmZfm/75+9Umir4ibxJq3/CQTWdxLceH4Y45YrlVll8lZGZtu7bu2tu+Vvu/980AeO/FprWTTnvLy4ggtbyNvmVm+6v/ANju/vf+g18N+I7NdPvLi1ma4nby5GikjXb5it8qs27+GvuL4kWsa6ZPNqEyOse7arRbl2szbdy/w/K1fE/xCmurW7uLeS82MsbQu0a7Y5FZty/L/wB80AUPD1u1vd6NceXvdZ4dyP8AekXzFr9WtG8NzWdhp0kdxZrb6pF9okZV+ado13Ku7/a/h/4DX5W+A2t9U8SeF7W4jVoG1Wxhli8xVWWPzo9yszfwt81fqf8ADOx1iaa8tYbhrq30n/Q1i3bYYI5NzRsu75tvl7lb5f4aCz0aKaOTQZbjS9Qt/NsdskCsreY0bRt5iq395f8A0Ja8j8bNq1xLPdQtbwW8ltHHPbPJ/wAs2h27dv8AeXbXr9rGuk3P9h6tZ/2pLeXSzRPbS7pIF2r5ituX7u3a3/Aq8i1TS9QvNevL7TbOBZdLtJrfy9Qkb96zN8u1VXb/AA/eZv7tAHzD4q1RbPwwupW+ly3Eq+ZZpqDRboYlZdqwr83ytt8z/vmua8VateWOu6dJp6wXjag0kNjtlk22UbRqqszfe+833f8A7Jq9o8a+Gb7S/AWqeGZo4L+doo7yR4o/LgnkWTzI22/eb/7Jf92vLtb+H+tL450HwPDrFqsupaf9uglj2rG0nyyeXHt/h/hX/doIKXhOGx0O803wHtnv9Nvmmt9Qvm/1UdxDt8z7Ov8Au/Nub+7urq/CVrpPn+ILjR9cVtNtbH7ZF837+5uJNzQ28f8A3z823727+H+HiPsq2Nxp0mueIryW1vomuIEkXy2juPl3Kyru3fdb5fl+8v3q6DXtP1DQ9ZXxBJfQX9vpK2saxW37lW8zcsartbczfdX7v3tv8W2gD2HwJfWMdzZ+G/GmrS3F5Y6Vdahqtoqbm87crQw7ZPm+Xbt2tXo/g/xFpPizQL+z1COcNqG77HIz7vMXayqu7/erwvR9UhtfFx0/VI38VRTam2oSLayR+bIqxxxszSN/zzj/AL392ut+F2rXXhPRtc8NtI9/cWepXF5ZxSTq21lVZI1X+6qrIv8AuszfK1AHgf7Q3wH1bUPEM/iDwnZ3q+Wq30qS3O5WVv7v8X8P/wBjXzx4j8K3X27SfD8MNuuo6hO1r5ckvmMu35vM/wB35v8AP3q/T2HXND8faJp32q3gt73VI5PMW23eX5ca7ZNv3W+9/u/MtfOHxL0PSfhz4muPGlxo9heT2NrDC3260jaBvvbZNq/Krfd+7u+ZaCzzT4EfBPXLHxhpEeoeGbq9a4ud0t80DLHZTbdyqyt95dq/5/i+jPjH+094L/ZhjuPCvh/T4PEPiO4gZYlafb9mWRf4m/u18l+OfjB8dvGVtZeDbPxJLpGka5dLa2mlWa+WrNNIu398q7tv+7t+X5a6W3/Ys8QaHfWUOvXz6trd5ffYUs4LaRraSTy/uySSfxbv4v8AaoIPHJJPiN8fvG8+valJcahdXEiszssjW0Ee7au35flj3fL/AN9V9W/AT4Erottpdnqy2s+s3k6reS/8+kNxuVfOZf8AajXb/wAC3f7PqvwW+F+k6b8HZ/CdnZxRai2sfYdQuXgXyZ5IWVvJVlX+L92rf738X3q9a0qaxh1HXPF11pNkmmWstrpupWdnP5cjL5Kxs0attb5dyt/e+Wgs4Wex0PWNfutL8O6s6JpaRx/Y2l3LfXCxr+83Rr83zMqr/wAC/wBll6HR9PuJtN1FdSmnTxDHfRyLLBBujW1VdzRtub5fl3fw/wAVUEj8Iw2b+G/MeWCPUFmtblVjjkbzP4Wb/ZZvlbdXbX2i6heWC6ffaxpq3ti/mLLZt5c0sfyqvmbfmkZf97+GgCDwbdLo6XWnw2rLo9qrKyq7R7pm3NuZW2/3v/Ha4/4v/FD/AIkl1HpdrqMvii1i2ztFIscEEKx/KzL821v4t3zfL/49558YP2kNN0PUtX+E+j6s+palGtvHc3kUUaxr5zbVWNmbc0i7l+992vHdO1TxldeIbvT7pZfPj0xYZZLyNWka4j3fL/vMu35f9n7zUED/ABg1xoumOv8AalvLLpcC+bFFuWSeH/WNIv8Ae3bm+b/Z+b71eE+PNPWPWJdLms3t4GeNbOJpW3L8qruZlb5vl/hr3a40XWNLN7Y32uO1hq1qrf2esXlrBM37tmjaRv8AV/Lt2/L/AHl3V5j4p8L/ALhmvvKnvGnX5mlbzoI1k27drL/n7tAHnltp7WNnbzSRpL5lzI21vu+Wv/2St/6DV+30eaSSK3aR/Nt7rbL5jfuY1+8v8X3Wrobax0+S9W31KSKJNPeO3niWNt06/wAO1l+Vf4fmqzpOg6asWoqy3FveWbKy7pNytubdGv3l/wBpWoLOfsLe4mv4riH5pbO7mXy2Xdu/1bbm/vfxf8BogtVuNT+xxqzQNJ5flP8A8s2Xbtb/AL6X71dXqem3jCyhWOynvJLtrqXyF8uOBdqqsastI+l2813f/YfIit5FaG781WZo22/6xfLX5d33V/2loIKF5pv/AAkFre61N9ogeR2WB0bdtaPb91t3+zXt/gO4s/Glu+ralb2OnaXpNorX32WdYpZ5vL3K235f+BfxVxU1jrmlw3Xhv+zftiNBb30e3c0sUMas25V/hZl/hrsvDWlt8P8Awp/bHi7S7LVE8RSwzKsUXy2KyL5ayN/tMzf+Q/8AvkA9J8I+FdU8UWFhr2g6fceHrbUL6O+0+K1ZZI4JNq7pJGb5v3m37v3V/wCBV4t+2J8cpI7iL4L/AA9uJ7Owt1ZtYud21pd33Y2b/ZXd8zfw7a+mLPVLX9n/AOCHizXNcvkurXTYmm0hnXczSN80ccbfw/N8v/Alr8vEfWPF/iK81y/eW7upna6uXHzM25vlRf8A0Ff+A0Fnp3wP+Dc3xG8T29nZxxR3UbbraK7X9wrKrNukb7vzMu3btr7o+HPwv8H+GdPurG40eLXp2ePbqN1BCy20zL91Y93yqu3/ACtY/wAHfhnJ8O/h3YabNHarr2qXPmXMsTbmaORl2szMq/LH/wDFNtXdXodhcWek6pP5Mz6s+l3XkrBcqskV7JCrbo/u/wCr+b5dtAEV3qln/ZsUM2kpZzsy28n2aLdCn8Mbbtu1Wbayt/CzMtZ3iDT/AAreeHbG1t/Iil16LzNP3WnmSRqrLu3Rt8se5mVf87a1rvVrWazfUPEFjb2TW+nreSQQR+ZGvzbo/vfKv93+6u6qfh3Wl8I6ckOsWrQNqU6yT212irJbNJ/qWhb+JW3f8B/9BCDh9V+Efw98bG8vNJ0O10ueaf7CrRxRt5bbf4dq/d+b5l+WuJn/AGX9LsfDNzdR+IrW8eG+/s+Np4GaXzJNq7o1Vm2x7l+8rf7Ve13clxpp8PN4g8TJdXULTWdraRP/AK+Rm+VZF/vfd/vf99NWlf2NndXEsa6s0TWNm0ksaq0SyfM26SNfu7lZaAPEI/2YbzQ7ODQ2vvD0t1dLHqCNZpI0kqtuXy/mX5WVl+Zf4a8/8Wfsi69qV+mm26pbztBuaWRNsibm/wBZ97+Flb7v92vri50+40m7s7qbUIm/tDzL6KS7ZvJ+z7vlWNVXcu5tvy/7S1FLqFn48tJbrw/oqrFJatqXn2kW5Y7eNmaZVZvlZtq/MrfMu7+GgD5i+A/7Ovxa+DPxLs/FS+JPD1xpuoJJpuoxwXMnmyLIu5W2su3zP7vzfwt92vqrR9NhXStXW315rOxhi+0W32yXdPI0bLtVVbczNJ8y/erNubezhi3a1Jv/ALa8toFjVWXbH95ZvM+aPcv+z8u7dT3t7iz1O40G4WNGuNQhj2SRblih8tZFZfM+bduVvu0FlK4bTdWtYLryWtVuJbi4SOdfMWOaRfvR/dZf+A7a17i8s9NKXE2nxRWDRQyXUvlt5kTRtt3bV+bymXczN/tf7NUNKvtLuodOa609rOCxaRpHT5VuZFk+9J/F/s1Tl0XUrrSNR1i6mdbiOSSOL52ka7hZt3lw7m/h3f8Aj1AGomg3WrXc8lvr372bzJoGnn8yOSNW8zarf7vyqvy7f7tO1jQ9Yhn0mzVYL2y1LU/s/mNdKsccbRq23b975V/2f4qPFV9p+k36x6Xa3dv5ksLT/M08kn3tu6P7u1ttPjt4dY8TXmoRzWult9mjms9O8xlhX725l3fdk/2V/hZdtBBjG8/0e80+a6gt4tFnja8VXVoZ2jkb5mbbuaNo1/i+6qtV+81T+y7/AEH+z1uIE1aBW+8skcUattVty7vutJ/3yv8AdaobnxFos15qOi6DeIsvleW0kkbNHKytt2qzL823d91f9n+9WpKtnYx219dM+kzx2qrFFcxM0c7M37zy1j+7t+9QAz7VZ2JuJr6NLddQWSNZ4lbzGm+Xc0f8LfKu3+781U9Gt/sK28MMKXGk3CxzebEy/LN95W+zt8275drU37Lb3jwa9a6sj3Wn3LfuLlvmfy/vSbd33m3fe/2altG1yzC+NN32ZfMkjvIpFWSaRfvRtHtXbGy/N8rfe/3qAKs1vNqW7xN4kki1GXUJZJrRbOTy441WNVVWj2/3vm2tt+7W4b6bdb2Nvp8SS3CNJL5cfl+XG21ZFk+Vvut/d/8A2aSWOm3EMGtSXS2sNwy/ZbaSRlW73K25l/2d33l3fwrTGt9QsQ91b311eWtu0dvEjM21t33lVmb5vl/ioLI4bHRW1ZY7PUIL1tHtpFuVnVmWLdu3Mrfe2q3+795v7tYrrJdQWFi0zfZ2to76C2Vf3kirJtZpPvfKzbdrferU1DRbxodX1iHdZ6ba+S1zp0svytbwtJ8se3+KRWbd975VWjXtH1JtS0jSfsNlZS69FDcKkbqqrC25oWZv+We1fvbf4qAGXN1b6hrF7a6xNbLt02T7NOnytbSSbtsbN/tMyt/wH/dqtf65da9bz3U1rZpPJ/oMHkRKsUjRxx+Wyszfe/vf733vlrb1LdeeH5dPjVrBpLbdczsqyLI0O6SNV/8AZl3feb/ZrLWbS43nuL6aWKzjn+0TxNtjWBWZVby4/wCHd97/AGm/3qCCjZXEd9HZMrb7exgks5blV2tLcfK0cjbvvNu/9BrTuG0m1+xwyXTrPawTRySbf4lZdvmN/tM33f4qztYuNBvrmfVNNvorewtZY/7Pik/d7vveWzbf4mb/AMdWixvNPt9Pl+ysiNfanDJAjKvn3KrJ5jMvzNtjb+8zLu/75agsn1LT7rR4p7rUpvNn1y8jtfN8tY1jt2ZVaRV/vM3yr/us3+6qRwxx3usR31/e2skUjSxNKvl2zMyxqsf3vlb738LfM33auJdaxp+laja6pas8trP51z5UCyfxN5fzbvuq21v+Bf8AfNe81qTw/Iml6LZ3UC3l8sdrcsv7zarKyyKy/NuaRmVWX7u2gCxYTabeJq66bfRXS6Wnk7bOfd9mZV+Zo1+Xc3+y3/Aai1BdU8TW0WoaT4uiuGjb7D5Vyu1ru3kj2xs391o2+9u3bmWq9m1neaj/AMI7b288CW6tJPLPBuZZF+ZlaTbu2tu+Zv8Aa/vVauNQVtaZpI0WK3ikWKDa0Me1flWNVVdsi/3v4fm/2qCBby4tbXSk+w2rWem6tKsccck6xSS/Zv8AWMq/xMyt97/Z/wC+mXi2dxfWuofbopWVpF8iBlWORV2/e/u/7v8As1PZ6beWvhHRLWbUnZ7N1sVl8xVku1mb5pFX721f4m/hrJh0+T7QbG3s7e2vdLn8meC+i87zVkXb+7X/AHf4vm27loLLWq6pp9iyx2tvLdT6tBatsg2srNIyxrt/6Zr8vyq1XGvLzVNSb7KupaM1jPNdMvm7VZvux/K33VXa1S6ru028vfBtxYxWt/btH/pfmeY1pGqsu2Ntv/oP93/vnMhmm3rqCwzzpqWkSLFa/NugkVv9d+8X+Ld/+1toA0fDkkmoazYSXUd4b+1ljvFurlo/Njk8zbIvytt+6v8AD97+7RU+m2+m6brWnW8OpPf381zDY/adjbUjVo2k+9937yru/wDQqKCCtHDarq17qWoaP59rqV8t1/Z9tujj3blaONfmbcsjf+Or/vVSH7kJp+pX1vavqE/2FbSNWbyGVvmX5v4ZGb/x2n2EzTWbSW+n3FwzS/YY76Wf5lWNlX7u7c23dt+b/a/4FJ4mtVvteiZbxVaZWutse3d8yr8yr/Dt2/d/2qALGgSSW8OowyWel2Ut1E1mrXKrG0casv7xWX+L7v8AvfLVOGNdJt7JbXSZbOfVo2tZZXjj8vasjN5jf3Wbd/nbVw27TG6uprx1e+tGa2VY2l/d/wDLRZv4V/1a0RTNNJpMljHeaXYalp0ca/2ltaSVY28tm+Vtvl7vmX+9u/2aAKsWn2t9pEt5pMM9rbwzrb6g9y32loN3yqyqv/LPb/461P0TUIbHR9Tt9Ws7XUmjnaOCRnkk8vc22ParL8zfL97/AGvlqvNfaX4f3QrpqvcR+ZDdfY4mjW5k+Xy9v3Vk+9/wGuga8a8Z47G1a9uLXbIsiXm5Y/LVlb5W+825vvbv9mgs529uG1aHQ9LuNHi89pVa58p1gX7zbVkX5vMb+H5t1WZtYt4/D7TR6pua+lWNFniaGSBf4l2r/wACX73zU+5sb7S7f+y/EElvPeeZ9qWK22t9kjkXd80n3Vl3btq/w1PDoPizxBp7w2OpNcSKs0zt8rRWmmx/N5P+9u3fw/xf7NBBE7Wem+G7e6uP3rTXbRxTzy7llkjXd/q/4VVfmXdVb/QWjuri4ZX+z2jRuqfu45PJX5Y9v95mkrb0uZm0a9s5NBaC8V4223m1laORWXcrfMv/AMV8v93dWJp/nX2m/bLO3W4nW62xMkW1Vt/9X+8jbavzf71BZPp2qWukx/ZWsUvYLrTdt3Jdu25WjXd5i7fvSLUGsNDJ4pijurVpX+8isiqvzKrfN83+1/db/wAdqbTtPm1C5vLHS2+2JDPH5rwSrH5Ukzf7TbdrbW+622oNNW4j8P28MOrRXFrM810zJ+8ZYVZv3bN/D83y0EFvT7jR4dSvdPj1S1TUYZIby7a5lZljaNfMkgjjX+GZdq7fl+983y1n21nfSG1m1S3tbd7G5kvJ1tG86O5hk+VYWXb8qr/tU/TNLvLXTYtUsZp7q8a8mmW83LJKrbfur/dX/Z/2WqXWo77S5J10e8ZotWihWWDdNGq7l3eW0ny7mZvm3fd+b/ZoA80/aT8G3S/A/wAIWumyPPLpdtcWd15W5l2wttX+L7rL/wChL/wLyf8A4Jy+JPDel+I/HOh+IvNgi1aWxjlVnj2rCzTrIrK33m+b+H/ar6b+I2nt4q+E2s29rp7wJo7NJKtzJ5jN5kf8LL/tR18G/sl6j/Y/7SvhwTWulMdQ8y1ke+G5LRt27cv/AE0+Xav+9u/hoLP0Lv76z8P+FILW48q6uLq+Wx07UJ1aRdyrt8uRvveWyx/N/u0/RIbq11Cz0Ozjs9btY4P7QtrlpGWWxjbduj3bfu7v4f8AZb/gXLzaprnjLRfDWvR6PBpes2PijVo7mL7K00ckKyLEu3dt27m+ZW2rt/8AHa6XV9U8O6Pqi+EfCem3N7q1rfWPm6rKzQwRR/M0kbL/ABfdb5fvfxUEHnnxaZbjSZ7WS4inlhi3fd2/Mq/L/nbXwp8RLi6k1vU7prqKV1/dyxL8vzfxfdr78+OultCNUjhjXYsrXW5fmZW+6y7v7u2vzq8WahHda5qlxHJuWS5aPd/eZf8A0Kgsq+Fr7+z7qy1BWV10/UFuPl2t91o5P9n+7/49X6peA5tebwtrfixb5UuoZI7rbErbvs7R7l3Nu2ruZWr8pbCP7LpUscfyP8rbW+8tffH7NXxM/wCEs+G6NdNcOvmx6fqLRT7WVo4dyyN/eX5vl/8AHaAPo7w/4gurfTbzVpGns7q4kkX7NH+8Wy8xdqszbt33tzbf9mjxF4gj8aRT+BdUuPsst9pC/wDEw02NVjjvNvytuZVb+Hcu3/vquf0eT+xfBP2G8kW6TxIzTT3MEv8Ar5I/u7l2/L93/d+amL4k1jxFZ3kc2pPLFeQLI6puZYFVm2qzUAcR4w8K2/h3SpdP1rxBAl9bx3lx9k2syySMvyw/e+7/AA7fu1554w8Etcat4I0exutOg/sG6s7q8ufKVfKVVbdGqqu7a235l/vV7N/Ztv4i1jV2vIUns9N0+1vkng+VpZmaRfLXd827atcHaXVnqXhWy0nQ9NtWP2z7HPLJbK1yskcm7y5G/wCmf8X+9QQS33h/wzY+P7XULfwrby/2okNrpUjRLO1pceYzNIzbdqttb5lXb8teb+IfBP8AxPrzx54w1BYItP1X7O1onyxxyRtuXztu5dzKq7W+6u7dX0Ld2tnp76Tptxr32+VV87z4IF/dSMy7Y9v+f92uM8W+FW1bxVBptuqpYX08y3i3fzTN5a/3f4vl+WgDyazt4bWWWOz0N4bpnuIV+0v/AKy4mVWkaPa25dqqv3v/AIpq7LQtebxNc6Xr19JbWtxbzxxx7I/laRl8uRfL+78se1tzf3v92qXjKHWvDPh/SbjVLi1+36f51uskCr5l7CrKytt/vKrN81c1reh+ItJutI0v91qiR2ytIkEq+Wsdy0kS7mb/AFn93b935f8AgVAHqUv9ueC7DWfiFHqUF3bM7afbWts237XH8qttVvu7v73/AKF/D2/ivS9Lvrmy8N6tHZ3C3kFvJFdJHua2kZdzRtu/u/7P8W2vMUmuvC+p2fhvxhdWGr6Pov2e1tLny90sfy+Z5e1vvfKzL/e3LuatTyVm+IGnK0NwltqCTahFLI7SLHb7VWHa33tvmfe+8y0Acl46/ZZh1R4te8L6si6us7NHa3LSLFHuX93tb+Fv7rfNtrmvh7+0V4m+CNxq3g3xZp9vqMnmrefbNZuW8+0kjbbtjm2srLu2/N95Vr6Ei1S68I6Pq/hGZoLjxO224ngSVpWkhkb5WX/Z+Zfm2/w/7NS20Oh3nhRW1jT123ytY3K3ltHJH9oVvmZV/hXbt/75oA+ez+2R8P7GwW4WO80uW+vJLi7tLOSG5aOTy9sjfLtZl2/Nur1i0/aC+Hfh+HSNW0/WrLUtIjaS4vrzUbZlW9VmXzFkj/h2sy7V3Lt/3qpeJ/2Vfh/H4cvF0/wzBFBebWXULWxj8pW8tdzfNtbb/F/+1XB/EH4F3V9PFqmlrFcRW7w3DRrH5VtKyxqqt5a/7XzMq/3aAL/if9pT4L6ff/apLyUvfO0dmtjp26a2ZZN3zLIy7f4v7vy15f4+/aa0fVvhz4jj8A6Hqmk3t4smnxS6hbbZGWb70kLKzMrN5jfL/DWR4w+HesaXdtJqVq17qKwM0tzHbeZuba33lbd/D935v/Hvmri/G3gu+8N+G21TULV59OWNZP8AWtHubb/D/CrfN/dags808DteTaxFpMMm77QrLLBO21pfm3bl3fxbvm/h+Za+0PBka6xoMWsTLb3D2NsqtZyLH5izNJ/x8Sbv9n5dv+1Xi3we0vwCv+mWqzouoMsaxTpH9pVvLbcqyKvy/N/dr0jQ9JuPDfiC8tVuF1FIYpPMnlg2tLD5a/u2ZtyyKsjfMq/NtWgDt5o9BWwv/wDQYpZYf9RH5bbZW+80a/wqu35f7v3fvfLXndtosdxqUF9fWKRXU0m6BVbd5W77qzf7X3m/+J/i9KvNSum8UT6LJNYIn2G1uLue2Rolijk+WNl/4F8u771TN4fkuluNU0dp/st9LDZ20nl+as9x91ty7ty7W+VmX+7/ALNAHinjLwnGszaTa6OlrLJcrDFBaSq0yzfM25f7yt83/Aap6j4PmsdVvLeSNLy4j8tmWSXz/Kh/1bR7v73zfL/wGvctd8Lw6xpk994Tt4LeXwun+mahLJ5cErL80ir8275vl+b5fvVhaJ4Tvta1LW7zT/N06draOS63bZIbm3mZtqySfL83yt/dVf8AgNBB53YW91pul6lpdxo++4uIGs7Zo33N5it+7kbb/wAC/i+Wp9N8P2Nv4t8y1ZFivNFm+1afIrNNP95WaNf9ndu2/wC9XQ32h3Wk32qaL9ls9UvWs/O8133R20durLI0bfxfe3V1fivR/BOl+ArC68K6bP8AaNUjX7DqUbN5UEm1dvltt3fNub73+1QB5zoK32i3mk/2befa7zxFHDpNyrfvGj8xm3N5m7cu1fvba9U0fwDZyeJv+EZVU/0G7tby2trl/Mhnht5tzR7vvf8ALT73+7VjTfCepeHdQ0vWIbO11JvC9zHcardLH83ltDtZtrL/ALrfL91l+7XUfGD4yfD34A+H5PidJH9t8Q61Y3Gn+HNPjdpGhk2/65mb7qruVvu/NtoA8A/4KO/FRrzxJpvwn0maWOK1i/tDUIFlVljkZm8uHd/FtX/vn5f7teafsf8Awnm8feNX1DULqK30vQ/s+qXMEkHmefIrM0cLf9M90e7/AIEteMWlvqHiC/uPEWvXlxcXVxIzPLP+8aeZm/i3fxbvlr9C/gB8M/8AhUfw7ij1yFLW98VTw3Tfaf4tqq0dv5f/AAL/AMeb+9QWel+Lf7Y0e5sLOaHUop1udtzBbL+7hjaPcrfe/u7vu7v4WqbUpm1JLuPw/cLA9xBbzW1zsaWT5d3mN5cnzfdb5v8AK1o3lneSWF/C0d1P9nuofPWT/V2i3LbWZmb5l+VflX/ZaqWmzaLrWqf29pMctkzWM261aRoFjjVW+Vf4fmVdy0AQabrX2XSpZNevvtrW7M1zO0fmMytGyrDtZtzR7m/z/FYfxNb29nf+H/MsNW/t5Y91zOnlNaRxtuVfmb726Rm/i/4DVKzk02FLK4+aVre+W4s54t3935YZN33o9u773+1W3pvhe60+2n1jUIZZdLjjt5mW2l3SeZJu2qvmK3y/L8393/aoIMvU/MjhtdSjuki2u0KzxwLKu1pF+Vm3bfm/harupzafcap5f2VLWe4laa2eSSOadlVdzM0f3o2/i+9/db5qpajr2l+GbqwsVuoEt7hZLO7VV3M0ki7maST7qsqt8rfMy/L/AHab4c8N+ItPsYtJvtSS8uNJl+0S3zQf6Tukj2xqq/Nu3N/CtADEaaNbW8tdSvLzTprxobFo5/O8uSRt235f9nb/AA7a0PLvLG7ury+vLKziW2k3W1tJ8vzNtZty/wATfxfw/NVfQfEUM3h57jbZ6dqMyx2dtAy/LLtX5l3bvlk3fwt83zfNT9Ps7zUNKXULi1lnsdP3Lcqk6+Yu75o1/wB3bu/76oAnuLWObz9Qh0+3gls3WN4/mjkaGb+FV/3f/Qt1ZuoedfSz6tqV5dTy6W00litzuXdbttjXd97dJGyttb7vzV0fmXWipFY6lY2csWuWy311I063LKzbljVmVd0e3crbf9muc/tRrdILPxI2oysrNayvbK0cMnzLtaNl3L/8Vu/vK1AGzNuuLltWj1a323lmtvBBcr5kd6y/eh3KqqrKy/xf3qjXR7jQdN+x68qX8Vrbf2fFKiRyRwXEjbvLWRf7q7drLt/75qzdzfZ/DNxdf2hBK6yta3fn/vbmNvLX94qrt/2fm3f8B/vc1NZ2f2DTodUkninhZb6eSCP5ZGaRfLZvm+b+7u/u7aCyfSNBkuLa18TQyQTtYyNbz3PmMs9z8v7vcv3lZW3f3tzVNqWqXGpWdnrF5b38tut4q20iov7q6+VmWTbu+X/gX8X/AAKrWpNHp+lXmm2v2eySPU44bxoJWj3QrtbdtXbu8z+L/drPht5ry/tbGbxFJZLDJJcWy2aru3fw+Z/e/u/d+9QQdM000lnq1rp9qttZXjRw3jQRNLHBHu+VtzN8rNtb5f7qtWbcXmpaOkVjpKvcSxt9nnZXZvKVW+aSGRW2r8rbv9rbUc1xNq2taiq3lrB5jSRteStJ5sfy7lVm2/NVq8vpre2l168uLiwt7jy7dbmT9xHGzKv7yRdrMy/K33v7y0AIl5Nqzy68tna6dcX080kvmQLHPJIq/ejZfvRt/tU2/h0Hzr37LY3jxXzK0XlRL/Eq7Wba33lZv9n7tUL/AEvQ7e8S10XVrjUtOt5WuILx1kj3NJH83lw/eZd38NXIdSjuoVaGOdls1jWJpImg8ptv3ZI2X73yt81BZf0ebUtS0PV1jtYpYGuYYYvPgk8yPy/+ee7cy/L97b/erM1i3uIbiymsZrL7TcXNvbzqs7SRx/N95fvfN97+792rUWj6xrWlxTL5DXVvIt5JFbTt5nlxsvmbf4drL/Ezbqhs9upWOt2t1G95df6ZfRtHL5fkRrGu2Fl2/Mvzbt3+zQQZjXEOrW97cafJufUHaGL7HAreU3+qaP8A3W2/L/8As0zV1mt7mz1KOFZW1C++zyeaqyTQQqu1Y1/h27l8z/gVO8JeXZwvDJDcWtrJbR3jKz/LukVlXcv3m+b5v9lagSxtdB8Kro9n5G6O8W3W58pZdzLtbdbR/eX721fmX5l3UAb19NC11Z2s2qXSQN5cMW2Las7SSbWkb/vpv91a55fFWnzWEupL4bji05blbyK8eNd0cMLMskcbfxLI25t3+z/FWz9uvtPvZbHw/JAn9qWt5p9yzsskqx/Z187yWb7rMrLt2/das7WpNDvJmtdJs2igjit9PtLPzGaOJo2XczSf7O6gBy29xb2msyXWm2qfY4o5pVj2s0LMsjK27+KT5WXb/Dt/iq/qrf2lDpqw6W9m8kS3zeb8skke35mk+bbuVWX/AIF/49FNJ9ndrW3m0qCezkj0+W2SVmWfdH8vlt/eVW+638TVR8UfZ473RPMa9sNJ1BvMvoL6XbPFcL+7+bb/AM9tvyrQWFu11IE1Cx81rWxgZbqJPmhuZPMZfm/3VX7rf3l3fdqpbWOlyWul27XFw1lCzTWjXjfd2/dXdu/vN93/AGv9mtDVNU8u/ivLe+SKKzvGs5fKj223zMreW0bfK33V2t/FuqK/ktdFuLr7QqM+mtG1qrbljnkkXdJJt/5aL8u3/gLUEDNU1y+uNVab+z5dQgurlbGeKJvLjgt9v3mZf73zfL/s/wAO6pb+xjbUp7HS76CDbujvJFVvLWNm+9/s/N/dp7WbW+o6JZ6hJqipcWzXV3YpArRSXDfd3f3V+b5l/wDiakhul1aGXXo21B7f+0tsEksqqsnlr+8jbb8rRtt+625l/wC+aCyLT9esbie61CSFVRZZLeKKTdtkjaHy/wB2rfdZmjb7v3trf7VUbaHS7O8g1LUtUnd9Du45oEkj+Vdy7V3M3+s+Zd33fvbf7tadxfW9rp1hcaevnprGoSQ+Urs1zbL/AA/w7VVmkZV/u7f92rdzpN5ZxrqWpWsUFv5u2PbO00kXmNtjZvl/dyN5bL8v/oVACW1432/S76+097zUdnkyS/N+/ZvmkZpG+bd8u6Ndrfe+bbUHiHULjUNS066htb6J9sMkcTo3nsvzbt1zuZY/l/h2/dbdTLqbS1bw5dXmlrb2Ml2vl20E7f65V3M33tu1tq7v73/jtLomsafDqS31xY7dE8xmu1WRoZ1uNzfMu35tqqy/e/ur/DQBZ8JWN1J4k0633K+nW8kM1tGzMv75WZptzN95dqr83y/w0VLpzabputvHJY3GovcXlnNp/wBpbbJF5km3zpl2/dZV+X/aaigChLDax30800f2C8VWtWtvN8tpZPuqrbv/AGWm2arfWPmXGmrcTx3fk2l23yqsMa/LJ/tbd1WodU/tKG1uJFeK8sWmjeWK2jaSJVX5Zl3f3fl2/e+9RY2dxZyass2lvBax/NbLLc+c0SybfMbd/Du3fd/2aCDLt4ftF6utX1x9nnmuVhWOJpFjkhjj+bzNu35tv8P+1VjTWjm0O98UTNb65ZaS32WLTvIZZoI45GkWRVb7y/eVmX+6vy1FNqH9n6xpug2a3l7Aq3F1dLB5c0ki7ljVV3NtVtrf7X/Aa6DUdJvodJt7jS2gtbdruSFVW52yNJub5tu7+HcvzUAY1xNrHlr/AGlC089nH9onjiTy1iX7235m3fxbfu1pXFnpuj3llH/Ytv8AY9QtLi8aCBt3lxyM25WZfmVty/das+z0fUrrTbzyY/sf7+3W51OBlaGJpmb95Iq7mZl2t8v+yv8AtVLqnnafqsEN1p9/Osdt/Z891IrKsrMy7bho1+bdt/8AHVoALa10Pw/DcX1w0t6k11NcW32Zm27vLby42X7vysyr8zf3f9qqsui2MlrpEMkd+1xfXjahLOt822Vtu7yG2/dX5fu/xVobdU1h7zTdN0e30mDSbyTVpbG2RYI4rfbtjk8z725lX7v+181IkOn3GtxWemwpb2scUaxxbfMa2mk8xt00kny/M23/AGvvfeoArX1vHHbywxzXks+pbYW+Vmhgt9qsv8Xzf7y/3v733ZbnVrW+vLqzhvG0vUrGCRY5FkkVW8vasbbtu1o2Vl+b/a+Vq2Ndh1bS9caa3vNJsLjw/EtrPtl8z7bu2/L8u1W/7521lzW901zP9osYGSGe3k89vLaadWmZl/3V+Vfm/wB2gB2j/wBi6PYWHh26b7ZdXkX2j7JOskf226ZmWNmX5laSNm3Kv91m27aytEuo7qLVLy315bxW1K3advs3kR/6z/Vtu+Vfut/3z/3zo6bHeLbW/iS6tU1S3jupry2lnl2yxt83yr/Eq/dX/gNUNItbVbD7PbyW/n3lzNceVHBHtjmVVjX5t33VXb/nbtCy1ZtqDeINGuLOx05oo7SRrNZ13Q7Vmbd5ka/L/wACb722rUP2PVlghuNQlaWaXc0rbpJLaRt33vm+6rfxf7VV9J163+0WuvQtLvuLxYYmvFVo7lV2/e2/wq3/AKF93+Goruz0f7Pda5J9oS6upJlgaJW8vdM3+rVv4dy7dv8Ad+XbQQb9hdLrmlT6D4mksFe40qa3ijtWZtsixtIvnMy/ebbtX/e/u1+Vuj3E3gP4zabcXGk28/8AZviPb9lfdtkjab+Jvvbfm/8AHa/Uc61H9p05mtZfKVLVmeVV89mVvuyN/E23/wBCr4N/bj+Gv/CE/EyTVNNt2t1mZlnXZtVZN25ZF2/73/j1AH3r5Nxpto99b61cRassjahLd6btaH7PHIu1ZIf9n5trf3Vrm9a+0fE77L4ktb5dOuLq7utenna5WNrmSFd1v5fzbVVtzN/wGvMv2M/FWl618K9Tvtc8Taj++g26hEu5tvzNuZZGk+bau75W3L/D/er2TxD4q0nT08G29vqFreWq+H1t1WWL/Romjmbdu3LtjaRW+Vf4tv3vloA5r4j65Z694T03xVeXkV5dahayR3Pmbo9s235lbb/Eu2Ovzn1u3X7TLGsm5prlpPlXcrbfvN81fpdr2n2+tDxL4RXyHit7GHULZpWWNt0jMvlrH97+Ffu18PeFvAdx42+KFr4XtY3+ytPI0u1V2qu7dtb5vlb73zN/doLOm0L4A2vjzwVLdWLXVvqWk6f/AGpa3LQSRwX21m8yPc33tu3b8u77396s74D/ABC0v4O+OINHvLhn8OeNEWRfKbbHaXCttZW3fe27m/4Ftr7livrjw+6+E1kt59Ij0yPzLtVX5pvm/c7f++W+9/FXwB8cvDtjpPiG8hsdPS3dfL1K22ybfKj3NG0e3/a27v8AaoA+6fDElvp9i3hWHytUtbxpLjTdX3bfsyxt80e3+Lc22meG7xtBs9c8ZaTa+RLNG0Kaf5u2RpFb+GOvnj9n34yWereCZ/h7fQtLqMc8f2W+aXy1VVb/AFf95dzL/wDs12n7Xf7W3hn4a6xb+C/AOmLqniG3iWZrzeu2ybbt2/7Tbfm+XbQB6zrvhm8ht7fSdS15YFsbWG8trlv3fm/vG+X/AIDt/wDHqwtB1yz03QdZ0ObVLOXVtPaaSCe2dVju1k3bmb5v9Z/tf+PV8Cafqvx+/aI1XzrG+1K9um/0dpPtLRWyruZmb/gPy/NXour/ALJP7RVuiLeSaJeajb2rTNbRalJHI0PzfvF+X5qAPqvwbayahr9hrmrXlnAkcC/Zot//ADzk+VpNvysyttX+L/0Kuq16G+V9UW+aCK8mn8xXgZVaJv4ZG+X7q/xV+cll44+LnwN1yW18Tf2lZX7KsiwX25o7mNZNzKrfd2/LX2D8GPjZ4X8feE11rR7jdr11ctdX1jdyf6uaPb93b/yz+b5f+A0EHpOtafJrk16sy6T9qtb5rWLbGs0St/eX+JW+b7vy7dv8X8XD+KfDbeCb9mvLy3gv7jSmjuYoI2m2t5cjN5f8TMu3dt/3fu16N8OLO41KbxBDq2mzwXEd9ujjVV3fLGrM0i/3W3L/AOO10N5p+pLZWsa6a909jB5P7rbJHIv7xpFb/gMn96gDwS28SaPZ6DpukzaCzXmtWcixzyr++85W8xmZW+bzG3LtZf7y/wANPsvFn/CKo2m61Y3CRXUkM0WoyOv2uzt1jVWXdt/2W+X5V3bf9qr/AMevDraTNpE0djLFqNxumTylXy4lk+WNmb+6vy/99N/dauP8SeG7iO78M6X4mV50jXcrRJ8zSbdqszfxbZG+627/AMeoA9R8L3Udn4e/4TTR/NlvNUkmur6TUFaOe5hjkk8mNW/hXbtb/d/u1cs9YurWyfWLO3n1Tasc0cc7NHD5nl+asiszbtzbtvzL/D8zVzVhqWteGYr3TdaupdRlsYLWzjtotvlt5jbd21l/h3L81afhrUP+EH0G61bXGgvPOiW8tYlf5oIf9XGu1V+6u1vu/wAP3aCztfEPi66uFn0nS7zytD8RNDG8Eq+Z9mutq/dZfux/e2/53HxL1zSbfwxqP9jzT6d/Zb2Nitiz7ljaZo42bdt2/wAW7+GuL8JeKG1zwRbXF9eRLZtrEd5PFJGrN5K7WVv4dtSX3iaSz8RxLHa+bB4gjmjWxnbbDHMsf7uSRvvLuVdy/wC181BB2njTS9P0m003UGtY7+CRo4ZZNu2WObau7du/h2sv3v4V3fw1D4h+Fen6lpt/4f8AEmi6HeeZF+/s1ZfOiWRVkXcu35l+bcu37u7+HbVDVI9Q03w9ZXS3H2hri5W4XytrR7Vba33m+Ztq7d237q/w1l6jqlnrWr3t5cahLLLHp6rGq/u2Vbf/AMeaNtu1v9lt1AHyf8R/gX4q+COvRa5o+jy6toNwu6VIv9XYsu75mZv9XuVlVf4f9pqt/D342eGW8LyeHYWv59WkuVvtHup32wQx+YvmW8m5m2qzR/8AoP8Ad3V9i+G/E11rV/Z+H7fT7O6s77T1uL67eCSaONf7vzKyqyrt3LXk/wAQf2ZdL8ZeJm+KnwdmsrW4jXy9T8OQWyxx3Kx/u/Mh2/6lmVW3N91ttAHEJq3ibxZ4n8P3k2ny2v8AbElvDIse1Y42hkZlk+VvmjXb8tdrYXUlnr2m+D49YS4m1L7RdLIqNJHGu5v3kbfd3bVZdq/NXh3xQ8QX3gfUJ7PXrXXPD728W6KzdlVvLX/lpHJH/F/llrg9H/ai8deGbl5NHmspZbeRVg1O8tv9JgX5fMX/AGl3M3/s1AH154tvPD+n3FhdLCjJqEk2ntJH5kbXLbW3fu938X3fm3VPoWg6pnV/O1aC32tarGnyyedCyssatt2qvzblr491L9rbxvqmoWE2pXWl39xpMv2ixu5NMVVgm/56eXu+Vq9E8Nftuw6VfW6+LvhXZa1cLbTf6TYXLRu7Sbd0jKy/N93+9tXd/s0AfWMPguxs9K1u8vNLtbddL0D+yY4oJVXy2m3NJM3y/N/D977tZGq/DdrXwx4e8trf+0dLgtbjSmiWTyJY9q7o5Fb93u2/721mr5xuf2+Nes55f+Ed+FsETzSSNc/2heblnVo1VVZVXb8u1WryDxp+1p8c/HkEWl/8Jg+h6cu6FLHT90atu27v9r7v+7QWfdvjn4jfDf4bzT6tqlxYTz+R/omlW0/3mb/npu/h+b7v+y1fn38SPiV4q+P3xJl8XeIIvKeFo7Wxs1k3R2lvHu/dr/481Zfg/wAK+JvEF7LDHJvurqJZmn1Hc27+7t/i3fM1Z2o6DdfDnxDHp+qZaWGVZHVV3RyL8vy/N/CytQB7n+zP8H5vHHxD06zuliez0eeO+uY5P3cErKzfL5n3dzMvyq33ttfcd5qn2y3vF8QWN5qyrLDb2bW0rR/ZpFj3Q+crbvu7v/Hf++vPvg546+EvxA0yfxJ4F0mDw9Z/aYWu9DjZVbzGjVfMZo9v8Xzbfm/hX+GuytpLj7Rq81xJdJPH/pUiq3mN8rbd3y0ED5ryGzSX7Y15FcTXnmTxyRf6ySPau3dt+7t+bd/8TUrLJeXmr2P2don8/wAy2gX93MqqvzeWy/e3bvu7v4aNX1C1WybwzNcWuovNHJDpvnq3n2y7V3NJJ/Cy/eX/AIE1Ja2994f1K4uppmv0s4Ghjk1D/Wqu1ZNy/wC7t+9/tbvvUAGn291HZW8zSXUq27eSnmyNtufvLtZl+X71Vri+sdJt7fUtF2Ms14y3kUEknyxtD+72t/vVqy6tdeKNUsP7BW1s4LjcsunwNu3LuVdyyN/y03fN8v3qyrO8h0mK6/sfSbq4bRZ5I/LX+FVba21dvzf5/wBmgDUt2urGV7O8t2jumjW4ntViXzJ49u1pPu7WVVX5v8rWRZWa2+hXmmw3Syz+VJcQNJK0e2NZGbb8u7+9t+b+GrVzI1jHca9NqGopqN4y2sUC3nywSTN97/vr7zfNt+arF/pesKLi4vLF1a1ZY1VblW8yRl3eYrL/AHtu3y2oAhvPC8OkzWU2kwwXtr5bbvKuvN+Vl/125m3Mvzfe27qL+4tbcac2papvurp28hkl3NIrbf3ckP8As7l/i/8AQmo/07T5E+3WthqSRwSNatEix+XGy7VWRl/iVv4l2/dpuleKLe6W1juNLSdbzd5X2qPy/K8tm8tVb727du/75oA1Laza1mutSuIUdZFa3ja5b+H7yyKytu3K25du3/ep/wBjj024g0u6hjS90mfzHvo2VY2+ZWVY2X/Z+78u2qovNDt7J4ZrHUvKmjkhtmtHZZo7pm+VZlZf3ka7f9lvmp1loupa5Z6uzLerqVnqHnW3kXUcckSxruVlXd83+0vy/LtoAp/bIbq9g8QNprpZ3E6rJA3lxRx3zfe85V+9G3yt8q1PY3Wj29pew3Wmz+ffTrb2cH2plWOZd3+r/vfeotprhbae61ia4lvZrNriVXi3KzLuVvM2/wATfwtu/u1FDG27wz/pSK/myNHcsnzQLt2qs3zf6z7vzfN8y/w0FhNqkMltbrY28U/2q7kt5dsUm793833f4fu/xUPpurW8sV5Y26o91H5jq6q37mRvlXdu3K25W+7/AHal8OyNo8A1CS+sdRS+gm0955HkVpLhW3Ky+Wv3l8z/AIF8v93dUT6trEcWgzWOi2dnLdSrdXaNAy209rG3+sZV27dzfKrfw/3f4qCC+2qabr1y2sSfZ/s/2lWu7mRmaCP5drNIq/d+Zd3/AAKqUrasq2trrGx7bXpfJ09ldWktoY/vRsu75Vbd8u7d96l26f4ohSHT9q+S21rSW2WNZ45GZWWTd83y/wAP97d/FVfTb5dLs59N1y1gnurzUfJiku18xYPLXbCvmbfl+X/x7/eoAui4s7O8aa80uVp7fbHFBFtljkh3fK23+H/e/wBmnHULXVvD09nHcM8tu63CSyqzSrtb/lt/Ft/+Jp9lpunwomgxyK32W2a4aVW/ffMzfL/D93b/AN8tVS0k1KQX+qXFjcN9nihZbbd5O1m+6zKy/N97du3N/wB9bqALUMklnbz65a6fPqMtmsn3l+aC1k2q027+Ly933dv8NN8V6K2jpdeH5tWa3SG0kktPI3SNLtX5dqqy/L95f+A1PYyfaEuriOzWybUG+ytqFtAvlyR7WaSORVZWVvl+8q/w/e21natYq3irRpLFWukba0iSr5TL91tu1W+VflZfm3UAOeabTbCDUtL1KDUbXT47X5mtlWVlkZtv7tfu7du7/wCJWqula5pvhW08PXjLZu8d35N1JvbzrlZJNzSKrbljX+H+Jl+X/aqxrF1NdeMm1CHVE0ltQVbr7DaxRrHcyKq+XGrfxKrL8zfL95aoahMtxaW8c0KwJq1yvlQW0fmSrGu7zJJPu+Wu3zF/i+7ub71BYeH/AA7Na+ffXWraksUNnN9jgilbbdzL8zN/e/uqzfdqdfFGirPdal5io9wlqys0TQr50iyRtH5e394ysv3q0LPSYVlfxBfafLp3zreaYyyLHDFa/wCrjVlX+Fmj3Kv/AH192qU2m6l/aXh2zVYJYNLnVZZGl3f6PuaVlVW/4D97+HdQQRWdvNHdsrR6dOumwR3F5IqttlmVfl2/d2t93/vqnarb6xY3Rj8SXj6XO0tu15On7yOSPc3lyKrL97bu2/8AxVNudNuNQs0urG4SzupL7c9p5iyfLGqsys38O5f/AIn5v4oNWs7PzbDVLy31FYoZ11BrZv3nmR/d27v7q7vu/d+WgDRubPSVlX7HDdW+l3GoqqLfOu67kWH5ZJF3N8u5vl/2v/HoH03TdY1WL7Zo/nwLLNMkscvkKzeXtZm2t8yxsvyq277zfLVySGO18P6s01mu66gVoGuv38jLJN96P5vlkbay7v8AZo8TLp91bNb+W2orpMtvDdPbQNHHHNI275tv+yv96gDL0rWreO8ia4sfIba0KRJO26CZV+Wf7vzbd23b/srt+9TNLa80vSp9W1DS3lZXkVZbz7tpbtJt8xV+9ub/ANmq3dQzLNLqVr9nayup/OaBV8nzdv7v5ty/3vu7WqX+1tNutdurNpkaW1jjkWKONf8ASY1b5vLbd97cvy/7rUAOe6vI9SuG8M6lNdadHBHHeWsdi0HmTfKrSK25lVY/mXc33mq1pWpeGbXVLPRZrWJLpblo5VW5ZmuWhWORfm/3v4v9pm/i+Zms6bdRw6bNJa2vh6yW286KSNWla+aORtyySf7TfL/F91qzl0+G4ht9WhZm064gbUJLtvlmVV+98v3v8rQA59Ujt7DdJpqPdM3kyrYpukij3NubczKq7f8A2atlbq8h1GCSG6a9g1SRo7xZ4l85mk3KrMzNt2/d+bdu/wDZaGpLa6bqT3VvpsS295+80j7XO26Lcu5d3ysvmKu5v+Bf8Cqtp11p8djZ2ul6fBJ5j3i+X5bNJP5Kx7mk3L8zMzL97/7KgDZ8L6w3ibVX1i8Vmnja1sZVeJv3lxbt8zLu2t93b/eoqL+zbOz1/SbyG6ura/tby1jezaVY455GkVZPM/2looLKEGsatcX0GpaxqE72t9dR3Vs07bvLs4/m3Mv/AC0ZmjZv91qq6ZY2sdvq14twyRa1qPmQM8kcLeXGu6RVXduj+Zm+X+Lb/s/NreHLzUL63bT4/DssF1qTNYttnXyYo13eW0fzbVi3bv8Avmq9varqmq6TNcfL5cbK2yBZtsLbdzKv97bQAQ6pptnqWnalqFx9lghgaRV81p2i3Lumk3N8rMv/AHz8qr/tVFfSWtrNq0NjdNsW5b+z5dqsrW+1VkaRf4WWTd83+9VW5j1S4spVs7GKXQ1tZt0E+1ZGbzPlVf8Avn5v+A1FeXEdxa2f/CO6SioyLa6hOzfuvtDbvvL/ABL/APFf7VBBr6hZrp9++h/bGT+1oFVryL/USQx7tqtJu/1jM3937vzVF4kWPUrvSI9HjnTTrGTzL5mZWkjkWP8AeSN/eVm+Vf7u1v7tWrDR9em8PJ4gh019R06xs47O8nW+XbLIrNHu27V+8reXtqa58F681q2oW+lvYX8nl29zEirJ5flqqyKyq27au7+FaCytrGi+ILrw3ax6hdXSot215LeRN5e6Hy1+zqrf8tNzKy7f97+9tqtA3iiRLfSfFVvPZ6pJaNeWlosC7orf5lVpGb721t3zLRPrWn6h9gtbi1ut3nx2MEXlt/rFm2qq/wAO1lbdu/2qvXepaS10tvDqVxvkimhs5FiZVWNZtsnzSLu/i+X+9/31QQZdppNnrFtf6XpfiJLyCz1q3kWX/UXMiqqq0LM38O7b8q7f/Hvm12aa40q/uNShgW8tfM09W8zzP321Vjj3N80artZv9nc33qoWt14Vs9J1uTWlvYk1KDzLSVbTzGjmjXaszL/e/wBXu+98q/8AAqlmjtY7Ce61q8skuY1bbJZru8y48lW3bfus21WoAILPUNNs57W61x3uriJZomaWNo2/vK23+H+GhZrfWtTe1khstNW+Xa0VtEu11kXb5ir91Y9y/Nt3N83/AH1PbQ/brS91S4V7WezWOxli81Vjl3fN5jfNu2yL8v8AwH7tLc6XHcX0umyfZ7fVIba4urOC5uV/dwrt2sv8Mm1mZfl/2aAGabb31jpnltDZRfaolmuZ2ihhaNVk+9H/AHW+X+Gq51y+judN1T4e3Vr8s8yrLdxNM0iq27zvmXdHIv8AtbvvUzUtS1TSyLOxa3uJW/4/mllZt1uzbpGh/vMv8W1v4V3VdRrWG1XxBa+G7OysL6zaOKxtrlmZZFb722RtytIu35aAG2mn6lJLfxq15Zp/rPtMarJNIqsrblZl+b5t3+dteBftxeE7rUPCGkeIl1C3nuI7Rre68pvLX9233vm/i2+Tu/3t1e9y2OpWafYbjULqJI23QNA/mLBuXcvmbvmaub8beG9P8dfCHxLHcKiy2MU0kTW1s0Mf3drbf73zLHub7v3qCz5i/YN+Jnh/wbB4j0HXNPv9SiumVdNtra186SdptsfkyN/yzjZtu7/gVfVdta6DDJPb6L4Zl0u4uLy3up/CFsvmNeyRybZPl+baq/e+Zt3/AAGvzw/Zu8eX3wx+Mmk3UyxJ50/2GTdGrKsjSLtZd38S/wC1X6RatNqFvbz6tqF1ql5d2NzHI19YrtaS4m2s0jSL/q4d33lZW/i/u7qCDP8AiJrHh/RfHmm2dvp91Z6pfSrcLHFuu447ONfM/eeXtX5dzK27+H73+zgeFdL8F+BfCVvr1r4Xv4rrxtq81xa6q8bKzNJ5ce1Y/wCGP5l+VvlWus0zxJpdnJqza5cLYXmpW0lrbeb++Vdq7WWP+FmZpv8AeX/Z+as/Q/COpMuh+G9N8TXmp6XpdrJJHJdoqxxN5jL5jQsvyt/1z+X5fm/iWgB3iKxj8P8Ahpmmvtr3F5JcMrLtWDdtXdt/3V+7/E3+9X5yfG/xNH4g8dajdWc2zyVWxkib5l/d/Mu1v+2jV9x/G/xBcWulJbrMVuLpmmgkeRVj2xr83y/3l+Vv+Bf98/AXjqOwXW382O0tZJo2vJU3/u2Zm+Xb8vzN/wCzUAc/DdTfbZ1tZJYm2ttZX2qrf3l/2t27bWz4e0G31TXbO1mj+2y6kyq7SybpG+b/AFnzfd/irJs9L1JbZbyazliSafbGzR7dy/eXbXf/AAguNN034s+EV1zeml3Wprazu33o45G27W/2du35qCz738B+D9F8O6nZ/DfSbeKyuI9Ma6ae2b5ZPMVo1+b+98u7b/3zXQad4d8RXCeEob7T2l8R6bcq1zIku6OfT2ZVaRW3f7LfK1cv400PWPDPxBs9H02ZNJ8Q29suoJcyt+4l09t33v8Aa+Vl3fL97/d3dJp2tXljqSal4mkab7VPb2sUFt5m2D5d0is33l+aRf7vyt/F81BBF8WfA/w1+NnhbXvD+qaOzXsMdw2mXksW6SCZo/l2/wDAl+WvzG+DvjLUPB/i1LixuJ4Gvv3MqxNt3Lu+7/s1+unhuG8tf7U1a8WCKDS1m1BoIJI2X7PDCzNJu/2v7u7d8tfjCky6hrdxfWdukEU135kcX91Wk3Kv+7QWfsb4Rt11DQrnWtQkT7ZNplvveK5XdI23dtXd97/aWu0vGjmtPtGn/aJ4lubdkSJfLXau1mVl/i/i+9/dryHwZqGk6TFpsMeitBA0X7uJrlWjs5FVd27/AGvm3Kv8X96vZtAt76PwxLqFvffaHW586B1j2tPub5WVv7v/ANlQB5b8dvDdn4ouVutPZoHaNVjRfvMu7/VyL/D97dXiGra1pPhvw1LYwwur6ksmnrPLukjghj+6ytt+60nzba+ir+HVJtBn1jXLpvt9xPNatF5f+qZf4d38X3f/AEGvnX4i6Trmua7FqE0cWm+GtJX7Vc+arbZZG/1i7du5t25VXbQQc74V0XxBZtp39qXH9o29nPcasjNLujkhZWVmXc3zfMu7b/vVJoPi63uPHC6x4Ps1XTbyxk09mZZGgjuFVv3fy/xVzvim41TT9TuvEH2Ge3srGJrOz065i+Vo5IV3bV/h+9u/3ad4Kh1pozdabcaboOk2MVxcSxzy7mj/AHe1ZF27v4v4vvf7v8IB297rml2viGfS9DhfTbxdFm3rGzeR5iqzbWZvuqy/N/vba0vFWrQ6t4VsFkmlt5WihupFidfMaOONl8tf4tvy7vlrl7izupPEc7XVxeeRp8cf2yeSKRY185V8mNm27vm+Xd8u6r/iW88P6D4Hv9P1KZ7y9kga4i1Jo5FWLarLJGu7+Hav3f8A7GgDp9O1Ka8+FlgvhPyJUtZ2hWSX5Vga4m+638Srubd/FtrobDQ7PzdZ+2aotrqmoLHY2kabZPsUix7pF3bvus27/eX+Fa801S8ktfh1omm6Pp729rrTQqrtGscdz523bIse7/vr/gVaPhC+h8O3+nW/iK3+23Hip/scV5JJtgWbzJF+Vf4W/hZvm/8AHqCz2HStBt20Hw9Y2cbQajo9tNcXN9bXbLJqSws25fvbdv8AD/vL/wB8t0G6t11RNahvLizuLOzjmZLONvI+y7vusy/xfd3Kvzfd+b5vmoafJo/hu+1TTdQ1CKwuNFiuGuYLORpIJIZNrKq7f4m/+KqOTxBZ3nh/VPEHhlVRbe5aG2gu5FVWjkjVpGb+6u5m+ZqALPxF8D6b8VPAWotdeD7C8T95b3ME6r50DKu6OSNtvyr80bbl/ir89viL8MYfhr40+w3i3ctno89vNco0bbWhZV+Zfl2/d+b5f9qv0Y8O+IpLPW7rWNU1S8stOj8uN7P/AJ6/u9u6Rf4V2/73yr/stt+bv299Ee08E+HfiDpjCI6/fNZxSLt3S27Rsyq2373+rb738NBB6hoHhvwPa+GrPT/A9rZ6loP9nrcLd+VDtWTbJ97d97/aZv8A0H5a+c/FXw5+HepWLtoOtLpssjQyfLbbmkZvlkh3L93+H7y/+gtUX7NPi64tfAV7pd1qmowPpN41m9pE3leZZ3C7vmb73ytu+X+7urm/HHiqbTylno8mm+eqR/M0Sq0+5v8AWf520AUvD3gnSbHxPPps3h9r1bdmjlju18xo28zarL/E3y7W3L/8VXt3gz4a+Edc0rXNU0/R7L+y44Ga2nuo2tFkZflZlj+Zo9rf3vvV4TpPxShmudL1a8jV5bVmhito4vKjiX7u5lX/AIDtruvD3xEksbCDT9J1K1t0mSS3vGn3TebG38Pl7trMq7v++m/3aAPoL4c6T4ds7zVtY22tppuizrqkFssa/L8v7tf+mi7Vb/vpf4t1eO/t6fCu40+fT/idpen/AGJJl+x6rYqnzQM21o23L8u3/arvvhr4o+3KureGfKltWghs7m+2s3mSLG0qwtG33f4Y1/3v73y17j/YPhfx98KdZ8H3UbXt14gtms7m7uY/Mk+0SQ/uY9v3l8tv7rfLuoLPiH9iH43aL8PfFd/4P8WLKbLxY8NvZ3Sr/wAe14zbY2Zm+6rM33v9mvu9Lq40nUtTkt7WRbiaXy1+zSbvLb5Y2aT/AJ6K3/sv+81fkQP7S8I+IXs7qNorzR77bKiMu5biGT5fm/3lr9XPh9408O/FDw7pHxI0OzvEgmtGVomZV/0j5VXd8y/8tP8A0L7tBBuWzao2tRWt1NPLdTXjLLK0SrI0bbflX/gP8X97d937tV/7Nvrq5i8vT4He3i231zdyL83zfL5as21vm/u/dosNWmvobi6s9YRpbeSOOWfymjVmX5mZW/hb+H5f4fm+9T77w74ikks7VdHgt/sMi6hJazz7t1n/ABeWq/6xdq/Nu+7QA6bSdYsYdNvGt5YHh3TSbpPmWSNm3bfL+Ztyrt/4D/FVXTo9PmS38WW7ebe3TTTebKskci+Yu1o4227fl2q3+1uqnZfbtF0641q61Cxe8s7yaG0tLn935XmSLtZZF+VlaP5l/wBr5W21Fd6lfSWOiQxyW9m/nq25t0kErKu1l2t/31QBf0q6t9YuJ7yGZYNLjtmheLyvmjul3LIqt/478vy/99Vc16aTTZrK1mjvbOW+u18iDa0jSxxr+7by2+X5t3+z8y1PHa29j4hisYbyWyS6im81V2r58cn8W3+Jdzf99N/eaqOr6w1vNLcW90k72qQ2sXm+ZuVfm8z/AGo5F/hZf73zUAOtrXUo4ribS9Wignhlt2n+0/6uRtzbtq7flb5V3L/tVBpU2qahpOm6gultLpt5qV0t49zJt8zy9q7Wh+bb5cjLt+WotPmutQistNXVmgl1CxjuPMjVZP3iybWZm3bm3fK3/AWpy2c0dppK2OpM72sslxqcDQSKs8m75pI23Lt3bl+X5aCyW8mm1RraSO1luNStVkuJ41ZlWSFV+ZlZtqq3y/db71Lr9utrZ6pJqlu3n3XkyQSxttb7L8v3fL+Xdu3fd/2aZLp819D/AG1pMbzusSws32to2+795lb723cu7/a/3qtX0djbtZtrW57qN5Gu7ZladbmNW+VVVfu7f++aCBks2m6a0FveQtBf3GntcWMu9vMkZVZWhZf9r5d3+7VW0s9c8O6boMmoaokqXFtbreJA3zRyNuVvLb5tvzN92m3F9oOraSuqWtqyT/NDZyrIrRwKyr+7+b7rfe+X/aWrVzNNp9htjtbyW1kW1judsH+qZl/1nyt+7ZfvUAaMzWel6bcW9u08GmzRKyxPJ/rGVm2tu/56bt1ZsdrfXQTxRcawiad5UklmyyeVtjX5ZIWjVvvLt/8AHv8AvrSe11C1s7j7RCs8unrunaVlkWdVX+8rbfvN81ZaW9xp+npY6GqxSX13JHKyvuji8zb5m6P733m3UAbJvrHWjoNx4Rs72/t5JGW8TVbtfMhhVfmaNvlZm3L/AKvb/d+9WbouoWs1q6x2cX2e8RmaN4mX/V/ejVf9r5afbWcNrYJ4g8QMt5cRq0N3eRfu91x8vltGq/e27fmqfR9Q+y3l/fXUM8EVjIq2Krt/1jfNI0bf3l3f+Pfw0AWmhht7/UvElrqV1b/PHdRWeoRL5cdq0e1vLbbu+9u/76/2azLPTY5jPotx9vvINHaTVLaVmVpFj/u/u/vRqv8AD/d/3qh8QNeSaJBcQ6le2H2rzLqC6kiaZfJ8yNfLZmj+Vvu7dv3dtW9Uk1Dzp18P3l0zqrR6hdNIrNLb/L5kjbv4drfMv+zQWVRfeH9YsNLbRby4fUbG5kjnllgZYf3jKu1WX5t3+s2t/DuqrNJqmnySWujwtK2oMtrE1zPt8uGORpJGbb/z0Vtvzf3q07jR7rRwsdu1mujalHDNZ+ZBH5kc25l3fL8ysv7uqt9pNvZ6a+mx6ktvOqbrlp18xbvy22tbxrHu27vu/wC6v+1QA+bUrO33TSRpBdWaw2enyq3zLDMzf3V+9u/75+Wm27TW+n+INehuJbK8vrm3sURIvOa0t2Zt0PmR/Nu/i/iVmapLSHUrcalcW9n9vWGW3XT7Gf73kzbl+VfvfKq7vvf/ABVNhWHUkudD8M3W+6uLxYZ/IgVY1k3feXzNu3y12r/F8qtQBF4bmm86ztdc32q2t3dWK206bfM2/Mqszfd+98rM397/AHazX1jS9N0fQNSt9BvLiC+861W5a2837MzSKsLSSfwru3f5Vq0orq1bXdU/tKSDUriTU4beCPylbzZtu1Wk3fLuZW+b5tu3a33abLcTaHa3Xh+1s7O9aG5abe+oSM0Cru/dxx/daNdrfN97/vqggzdJ0+zuNPsrjVry4is4ZFup7a0i2xsy/L5cjN96P5lbb/FtWuj0rRWjbWNPvJpfstmv9pLbRs0PmQ/Kq/dX/no33V/76+9WRcW9npOnXNuuuSyxappzfY1kaSXzbhm/1zbf4flVf4fvN/Dtre8Sal5mt/2bDpr/AOlWKrc3fmtAsdxGvzfu1/h+ZtrfL/49QBjaVNHN/wASW31BLJrVoZo4rlmk8y4+XbGv8W75Wba3y03RIftXhFr7SZrhNSZWa7gleZlVdzbpJF/i2/Kyqv3v9mrUuuXGnxWd5DZyqjRLbzzxxbfMaORm89m27tqqy/N96qUOnw29xZ6tp9jdXGlruZrOOX5vOkZVabdu+bb97y/u/eoAun7Ppt+k3iCa8lt47NZJVgiVY1uG2rDubd+7Vt3zfxVTfT4bN5bG61BXXT1s5PIZW8yP5maOPd/d27f4vvM26rVl4ZW8t7+1vvF09rBb3MP+iX1o0rah/q2Xaqrt3Rs25m/2v9n5au7zof7W2tcLuaG+bzFk83av3tu7+Ffm/wCBUFl/Wv7Jjsbi60e4n+y3Eu62+1osckEcyru+Vd277rMv+9VC20uZbG3jh1BHt98bXSybpFljbau2Ff4m+X7v+1/FUthb3V5qCrNp8V9p0iNNc7d33Y9vls3+1/rF2/7NVLnTbjVL+w0+4tUg0yNmupYEZvMi2ruXbtb7y/eb/wCxoA0tYX+ybuytdcs9R037RZzMzRWitD9n+7bL/FtkkXduZvm+b/drL0vR4dN8R6NfX261l+x3EeoRQT/uo7ry12+Xt/2drf8AfLN/drWmbWNS01ZrO1Vf7PjhW+l89pFkVmbbJIzfe/hXb/eaqwZfES3t5cWKQeZqCrHbSQbYo/MjX5vlZt33qCCTR2a+1HTdH09pLy9+1Wt1d3M7K3lfMu6Nfmb733v73yt91qK1NLkvLHxD/wAI/qTRXr2a2se5YNrKzTbvl2t/vfe+9/dooAwW0tdQtYJtNupbVbeDy90csnlyTfvF/eM3zbdzM3y1Ytm+z6/qky61KiWdssMlrEu3zJNv8Ujfw/xfeqvq82n32pWsek2c6o32VZIJdzTRW+5vO+Vfl+6v/j1WLyaOG8lm1q1g064ksVt4rRW8yRZm+7JJ8v8ArGVdyrQBV03Uof8AhH4NNhuonutUljuPnZtqrHJ++W3Xbtbb8u7d/wCO1DNbzM1vZ6XbtAi6h9ouYFXc18v3mkbd/Fu/75qa8vm1C2ivLHT/ALFNJa3X9nWsc7blj2/Ky7f4fm+b/dpusfbLrT9J1Sz1K3l1GSKO1nubWJWaSaTbGsMPzbo13blZm/vUFm3psmk6lBPY+H4737ErLeWsnmzMslx5zN83+z8rfN/s1VtNak1i6vNY0/Ur2KdVmt2a2ik2rJ97zGZvm2s3y/8AAv8AZqlqzXkL3Fjo63WnJbwLJL5X7uTydqs0e7dt/ik3f73+1WpfTXEmj2994d8QWq2sc6wtG0XzT7drRr5i7Vjbd977y/LQBWvm0tftrfarqeya5/e7mWdopt33Vb5mj/8AZd1X9YvJJr+3vrXS4LCzs4t1stttk+ybW/hVl3Mzf7P92otQ01tBuF1KSzWK8t/Mm1VZZd0cbM25ZlVf9Y23b/3y1JB5ljqcrafZ2+pW95E0yz+bIsK/KsbSKzfxbf4fl+792ggbf3UjLBYw+ILy3guoJF+2RS+d8zfMrbZNy/d+X7tP1ZYbOBrqSRHuNU3TWkk8bNH/AAqvy/dXd/7L/u1Z1a6VXgsY7G3WC3RY7RrllVol8vbuVl+981Nkj8UXkbzeIrxbNNBit2bTVZmVmkZmXa27+6rfxL96gBmq2+j3ltBJDYvbyyWn2W+XyF+W4X/lorM27y2X+H+Fl+7VbdpfibXWvNDa9nlaKOHSpWTzpI4WVt3l7vvN/wChUa9Z3zR3FvY3EVhL81xHG0n3m+8u3/e2/wDj392k8SXWk2Om/bNPji8OLeSx3EjeR5vlt91mj3Nu27tvzf3l+9QBqPY6lbpf6bfRrfPDFIyq7yWzLDMvzbo2+bb8v93+63y1QsLO81K8077Oy37rttWgnZfMi2/N5it97dt/hb71Wm/tTVHvbrWtPuP7Sms1sYr5rppJIFbc23a38Lbv7tLpUen31teX1vfXS26rDIksEC+ZLNH/AL33d3zbdtAFLRNSXUPDmr3k0lwkV1tvI4mimjmkj3fNHGrL/s/L8v8AF/306102O1Fvb2f7+1ZZJnuY2byZFkj2yRyR/wDPT5t23btpus65Hp+oaJodxfXUrXUjXFmrWzSSrCy7mjVvl2/8Bb+KqdzHJoOmXuhreXFnrN1eRyWyMrNHt/iWRtv3vu/3fu0Afn1+1V8PW+HvxPbUNP0+WzWTy7pYkVl8tlb5W/8AHfvV9p/DHUo/EHwiabwz4ilv7XWI21SRWlaRp4VVWuLe4X5mba3yru+b5v8AZrg/23tDj8SaVpHjDS9jveaR5d9tj2/6VHI0cytHt+VfMWRl/wBlq57/AIJ6aTdeMNA8WeCbrXLfS5fCt5a6wssq72kt93mNHH/eVmhZm/2W/wBqgD2y8021vNa8GrJ4fTUrXVLlrdfMi/49rfy/9Tbr8vl/M25mb/7Gu08F6hrXh2dfDesW9/apqyyQ2Nzc3MatdxrIzR/L975trNtkVf4mX5VqXTtD+IFn4ybxVcWum39xea1cR6fBaeXE1luhZvMX+7GzfeVv4d3y/LXKaBp/ji40u38TeHfD9jFFeNJdah9u1ppmit1+ZljVt3lqs275fl/2qAOO+O1rZx6DEy2csX+gtJBcyI25ZFbb8v8AvK23/wDZr5e0H4Y2vxE8b3sP9mxNLp+n+WttfOrNLJ5jbpF+b95/8V/vV93fE3RfD+tabL5OuJqNqrM0UartjX5V8z5m/wB5v7v3a+UvDVrceBfHbeIvD9rLrNnZxNDqHnqqzJ5i7WaH/dVd3y0ANm+BviDxddy6fZ2Nql1assbRSybWiVvlX5V3f+O1o/Cf9jm+bxnZt8UJooEhSS8tbX7T5Tbrf+KRf+A/w/w7f4vmr0vwprGm+NPiQnibTdUTRIrWOzuI2ljZWnaHzGkjkVf9ll+9XoXxT8aLdfETw942ks2trWSzms2uY9srLDuVo9v91vl2t8vzKq0AcHLJqWvTeKtW0/UH17WdJ0qOG2vLxt0kEKrL5yx/L+8Vd33fvbf/AB32HwtDpOqDRvLh8290+0t4dQ+Xb8zf3Vbb5m5dvy7fu/7XzVy9np6+LrJ9S8J2a2TXkEk3mNH5XmKu5Zl27v4tv/jv+z81rwzNpun+HrXULfzbXUmuWmliV1+Zo2barf7rf+hN/wACAMv4x/EDR/hH8HPGk15D5suqafNZwMjbpN0kbRwt/u7mj+7/AHa/Mn4W+G18TeMtH0ibzIo5tQt1uW3fvPLWSPdt/wBr7yr/AL1fWX7VXiK48aeGtXutQtfNnaPzIo22qsUit83y7fm/hb/erG/Zp0fwz4J0i8/t6xin1TULaOOx/ceY26RV/eRszfL83+7/ABf3aAPoTSrXxNY2fiW18SR2rC+vl09JGVWk+ZVjVv8Ae27V+X+7/s7q+jPDaw6bo1g1v5q6d4dkjtbmK5f7rRx+Z8v+zubd/wB9f8C8OWxvPCdrBNr2rf2nZX0/mfv9s8yt5e2Ndq/d2t97dXpmkatNeaFetcXW/S7zTI1aVVVZvtTfLtZWb/a/h/vbqANH7ZJo97rMeqahBLFeTx32+CD7qs26Tb/dWvD/ABz4d0/xh4quvDK32rS6aytsRovLh3MvmbtrfN/8TXpuqtfXHhuJmuGuPEMKyQ6fFGnlrLDGu5d21f7u5fvfw/8AfON5k1x4eXVG8TQOzaj5LQTxySNcxyL8ytIq/Kqt/wAC+X/gVAHjfiTSZLfW7Gx/tjVri/jjkjsbZpI/Lim8tdrfN96Py/m+b+Jf++YvCfw/0vwTAtv4g1RbjV9Q1NW8qRljX7PuZf8AU7f9Wy7f8tXTeMNBvtN8WaTcWrWHmzNJNLeRXLNJaN5f3m3Lu27dy7WX5f8AZ+7UVtpOnyeI5fE2sWfmtDeLax2Kvukn3Kv7zcyrtVt26gCppOpatrWvLq2l2Nvb+H7fVY7y+tt0bN5ke2PzNrfd/wBXuX7y1LqPhWH4keFV0vT7xr/Wf3jQWN9HHBBLDIzMqrIv8W1f+A7f4a6u28K2N98YIJrzUE0vwvJAtxqdtZz+Ysaqv7lWZfm+9u+VW/hWtTxHdSWPi3VtPuLhm0u68ltAiaDasci7VVpP4vu/+O7v7tAHjdzpurXmtpa2rW7RaPp62cmlMyxxtuVo2WFv4WWTb8y1xvhmOTxQdL8LtNEj6XLdX0tncpJ58S+d91W+6ytJu+6y7tzfdr2Txj4RjuPEOt3niC1sJ9LmsV0/7TBOyzW1xJ/Eu7+H7u75lrzHUrfXvDvjC18K6xItvrmi6ZDDpSQRed/aX3mVZJl+8v8AD/8AE0AX/CGoax4g1/xrodnsltdQs4Yb6W5Vli8lW8tpoZvveYrRtuZf9mvSNPkuL7wvZyaTJp0sVrJa2rxy7Y5r6HzFWSTav/oX+z/u1xl54b8SQ2stx4ThsPDWqaXp01xqelXNzuku1aTzJJI1XcvzLuXdu+81dFZeEdFs/HvgrXvBu+30m8sZJrmL95+8tWhkb/UttVZFk+793+9/vAHSaxb6hZ2d61vIiRWt2sbamrK3lx/L+5/7Zq21d3+zVD9obwKvjr9kfxH4TupIr3xL4R2+IrGLasjfZ1/1jQt/d8vzPlWrNnb6S1hpFra6o17oesX1xa6hPeReYzKys3l7v4mZlVf91m+996tfwvNpt18Tr268TRz3/h66tpPD8tt821oZl/i2/e+9t+9/D/tUAfnn8B/Hkej6u2irawbtYdfLbasci3H3f9Z/Cv8AF/wKu48Y+Cde1j7RYrNaqzfvpN3/AAJtqs33V/8AQq8u+O/w1vPgZ8YtZ8Ixx7LWxvPt2lbX8zdbs26H5m+b5du3+98tfTngPS4fH3hSw16OSK1t9SZbdVZZG8xl/wBY0jfdj/4F/tf8BAPldNBvtB3XEkO6LzPklX7yrt2ttXdWjpVneWem/wBoXFr5sEd4tuzSRfMu77rL/wB9fNX0Lr3wr26zZeG7q3WB77U5Ldblo1j3LtVo1Vf4Y/m+9/tVnJ4B+w2GoyXUcC2u/wCwu08m6ZlaTa3/AAHcy/8Ajv8AFQAzwJqlxrUes6T4T02C1t7yNoYPMnWOKOSOPa235trfMy/7S19VeD9a03wzaaTpt4trFezXlnavbRxbZftC/KrN95tvzfKy188eEfhy3hu88R+Fda0u6+a2jk0iCC5aNoLrdJ/F8qtuX/e/ir2y51xtU1jSPFGg2qtq0bK13bXaM0ttIs3ls393cq/Lu/vbf4aAPz6/ae8P/wDCK/tB+NdNjs2sxHqsl0sT/wAPmbZP4v8Ae3V9b/sP65eXXwRi0vWN09hb6zJa2dtbRr+83SLIyzN97buk/vbdrV84/tyaxDr37UPjC6hbeytbwyNJ8rNIsEe7d/tbq96/YYupLX4T6tDb2ctx9q8WyQr+78uNNtpF5jNJ91W2t/47VgfRNzbyWekXGl27MjQ3UkcsTRLGysrfKse1fm27v/Hqu6xJeaXr2m6xfSNPayNb2LX1tdrJPF5n3VZvu+X/AHl/h3fw7abFJoN0ktnqE11calIsjK0TKq3N9HtZo1Zv+uitt/i3VnQzaW3h641DTZriws9PeOZvtUTNE0ka/M3y/KrKq/xLt+WoAvXMccevJcR6CqJG0lvJLKq7tu3dGsKx/Kyrt3Nu+b/a+9T7+S+XUXm1COW60u1Vmngnl85vM/vfLt/vf+O0TWdnZ/aNcs7y31O30v8AfSrFcyLJHI0a/dX725f7v3aLG1h1SFJNLtbee4kgaG+WVm8mT+JZN38LMv8A+1QWENra+JNYfUN1lLLo7rb22/5tzN/F/eX/AGv+BfL81JprapcPe2trcLBbtJ9qvHVv3Eyr8q7V2/w/3V/8eqPVtD1LQ9CupNQW1ST7dZzLcxXPmR/Z2Zfl3f3WVZPvbl/vf3qiWxvtPXzo2eW30GTdrMts0axra7t21VZdzbfm3Kq7tu1t3zfMAMh1TxBfS6as15va4toY4o2kjj8r73mLG3937rbW+b71WNKW6sbhJNPvrye3mVreLzf+W8ci7WjZfvbdrfe/h+b/AHanm0n+wdX23Vw73TSzSWsUlsrM1v5isu5vvbvm/u/NWbY2OpW+n2cl1Irz/a/OjaCVd0SyMu6Fty/Mu3+Ffu/8B3UAWvs63WlMt1cWsUS3M3keUzeVJNt2sqzL93b/ALXys1Fy101t/ZdxqFwtxcQfuv3rSR7fmbazfxVbub7wi2pXkPh/T7z+xo9v2G2uZWkkW4Xd5n7xWZfvfKu7/ZqrqEcNv5Vraxyz2d5As225/wBcsnmbmbcrfwsys33t38P8VBBU0zUtLvLB7G1jl+3rG108UEXmQq0Mf7zdH/Ey7lZW+8tak91YwwKtvNKiXGnLNLbJtZp5F+9JJ/D/AHv4qj1S3/se/wBNVr66ivLiKZWe2iZlZlZV2/7X3l3bt397+HbVCyvtLhtZdLjjntbiztJLfdp6tPBOqybvm+XdG3+8vy/8BagDY0jSby8ae1mvnxJbLqUVnEv769h2srfKvy/dVdy/7NURItv/AMTjVLqWeW8+XTpLa2Vlb/norbfm3fKvzN/F/wB81PbrYyPpuuQ6ldO1nZ/uGs9ytJN5m5l+Zvvfwtt/uru/2WSyW+kya1eafMsEtisd193zI7aZm+bd/wBM2+X7v3du6gCW3023hEGoec06+e1xLbI25Y2X5t23/PzLVWzks5o7OS8vJ3X7XJeWM6xNu0ttrf8AHwv3drN8qt/s/wB6tS91iOzsVk0/RUt76NoVu/InaNZFk+VmZZNv3WX/AICtWmt/7a1K8jhjt4LVZ/st1JBKsccTMu1W+bd8vyt/lqCzHhmuNj6lq0d1p0El35nkSbZF8v8A56R/3VZl3fNVKG4uLey1ez0m3n36payXXmq3mebJ91t0m77rNt/76qdLi4s768hb+zVfT4tse+VZIZW3bWZf4Wj/AIf9lv71PkuLfS5m1C3023037VFIz20afNabvlkZW3MrLt2tt/8A2aCDW12S1W2aPVNP2rb7ZGZt0n2m127ZJN27935bf8C+Vq52wjtdNNvbtIsVxqEskcS+buVbdl/2v4fm+997dVqW8vrNbCzuprrV73UopNPnj8rcrMy7l2t8qr83y7mXb8q/8BLG3tVv7e8tdNie/wBenjWznu4mWOJo/wDWM27d5e7d8v3f4aCyXRdevPD8sirpNq2uafYt9kaBvl8uNtqyKy/N5n3fl+b738VUNNjXw+lxJdagj3F9PHarunWTyLyTdukhjb721W+X+Ldu/wBmrUN9a2MV1qF9HFBbzRSR2yxN8sdx/DI3/TPd/dqkP7WbRdOvtQ0+6uJY4IbjUpI1WHzY2XbJJu/56fLt2r8zbqCCe+jbT7b/AIR3TbGS4b7TbrpV4tssSrHt2s235maRlk/8d/75reKW02ObzmVYEtXtbGz+0xbZJJGbbNM237rN/F/wJq6jxLfW9q8Gpf2fb29hHZ2tnPefaZJJo5l8yVW8vduXcsm35f7q1ha9at4i037VJNbeVDLHJbWsvzM25trMqs3zfu9vzN93/wAdoAt69bzaHq8uk+GbWJZbi0WbyJJfMk/eSbY4Wmb5lVflb/vqiKTVodS1SxvtUuJZ5pJLeeCSPzJJFaNVjVf9ny/9r+L+Kq7SaouoLo/2OC/vL7bJ9rVm/cND5kkjLJ96RVj2/wCy21louLdVsLXVptcnT7Qv9oSNt23M6x/L5jf3flWgDQ1GHwqurT2um3GrztYt5dpE8scasqrukW42yKq/dVVX5t1ZVx9st7HTbrTY3gtZoPJnjSVVZljVZGX5m/ebt235fm/hX+9U1jDdaxNZ6peSfYv7P1GHULm0s1/fT2sO3czN/eZmX71V/El1pt9f/arOR7C8t2W4g3Msk8W1tsit/DtkXd/D/DQWXdSjupprK4j1SXZY2yw6gk67m+2My+Wyrt27dv3V+Xd8tWl0vUNQ1xf7Yht/suhxLdR+Q22O5uN37tmXcvy/d3fw7f8AdqqY9SvHgt9Wur9Iry+8u6gtm3Rybl/crJ/DuVd33tv/AAL5ahe4jVUt5rf7ZZ3DXEd596SZY922NV/2VVm+X/ZoILesf2t9vs7fT9Svb1I5ZI7yWd1h2xt+8a3WFfvLuZvm+981QvqS6TZ6pqiwyrftBdQwLbSblj2su2RVX5WXbu/2aqR6LY6xqPhy1t5rq8/sW2a6vPtMiwySqu6T7zf67+Fvm/u/7W1rPnNC/wDYa3ywT6gy28jvcyM06yf6yNf4dv8Au/3v4aANaKHzrO1WHS3RbeJpNQe5WFmlkVmWOS38tvu/7zbm+asKBdSVH8P6W1vEyuskt1LKv7uP5tzbV3fvNrf+O1rTzWN9f+HmVX8i1+0Q6jH95fL2/u1h8v7yq27/AL5X/drn/DkkjTf2bJGlxceRNMsm5Y5JtzfM0zL8zNt2/wC7QWdZ4SutSbxTeXVrCtla6hfWsMFtt8xp1hZlaSZf4flbduoqnpX2G68QLDHau15puo2vmxwXMyxMrN80n3vm+VZP9n71FAGQbfWLFtR1SRfs8sy+WkctyqtGvyr5bMrfM23d937u5v71Rta2OrTTqtvcNdNO11Lc3Mn77duWOOOPd937u2jxNY2enzxw3ywQIsrTWsE7faZpF3L/AAq22Nt33m/yt/VWt9i2viS4WJ5p4/7MXb5Mkf8Ay0Xcu7crL95d38TUEGXp+l6XfSWtrDarPLp+nzW/2lWbzIVWT94v/oP3f4v92rj2untqjLNIyajMq3UUEESxxRRx7dqwr/s/7X96rGhWvjTTdNvdQ1LxFp0WuNp9xDdwQNHtk86Ty7e3/dqy7m+9u/76/u1laXIviJpbqOzvUihu5NPbzZGjuWkXb53lr/dZm/3f+BbdwBvX2n+INNe1+y2flQNtaVmX5mjbzW/efe+8rL/tfeqJJre4Sya10+C3XULGS4+b/USSRttj3f5/h3VGLrULrR59J0G6SWe3n+1anBcytHts9qruVo1+9/rP4v4ans5LzVJrXw/Ywy775FmtPL/13l7vlXb/ABRsyru/ioAi1XSYdNuW03XLi1fVrdtt5Pcs3kS3G792qzR/6xlVW+98v3vu7t1aSSaLNfvYx2t/Ppd1pjfK12rQed/ejVW3f7v+7WfNebdIn1S6V4lt77+zfsd3FtVWVlbzF+Vmk+9/e+7VHXJLyT7H9ljsoL7TZ42uomkXy5Ldm+ZY2X+Jdu5V+9QBor4gXUJv+PXTUuPsqwpFcqzbfL/2m/1bNuq/rWoXlq1lpOvXFmdbuoI7qWWKVZ/tse5mVmZfl3bW2/w/Lt/4FzmsNNeax4chvFnigs5JoWn2fupW8lpI1mVV+XarM25v71WpdS0m30HSLrSb5WluorfS7adP3kX2VmXzFVmbc0n91m3fMzUAXNYs2YQafcQrBPavHcXbQK3lxR7Vbb83zf8AAf8AaqrDdWOoIurNYwNttPssEm2Ro7mTd+8k2yfd+b+7/s1tNcLfQ3mjzSas86xrcaZcybVVmVW3Rzf7LL/n71Y1rcaXqk0X2XVptHgmaSNbGWRWjlvFX94u5vlX+H5aAJbma61q3ia3+22q2cDSXy3fzSXLbm2rt/4Fu/4FVewtdNj0+y0/R9UuF02aCSSC8V/MWW6Zv3kfy/d3f98/NXQ61pupXDJZ6hcJp1/NFDGksDK0LRqv97/gKru/2axbxtUa1vP9R5V0sdvdwWsCxwLH/ebau2OX73zfe+VaCx9/Iupaha65oa3EEFvEt0tnPbRs0bL+72x7du1d38VULa+tbe20u++0CLUprmGx2+Z/qlbazR/M3zSVYRpryFtJ0fUrW1WNvsv2a6l/13zbvL3f3lX+9/eqlbR6OyvrF9dPLBa6hHePbRM03lzKrKysq/N8rfN/wKggn+NfgmPWvhrrzaDpNha/Y/8AiYPBHcrLJJHMrLIy/wAW3crfxfxf7VfAHwN8USeBfj5oyx6hfW+ma5PHot0tt8rStJJ+5VlZtv8ArNv+781fpb4Nmht7m90eOF/sElrNpK2t58rR29yvyt/tfvFVlavzO/aA8OyeE/Hf2zw6z28umyR31rOjLGsk0MnzSL/d+ZVb/eags/SLxBrmk+GfFlxq2jw6lFpd9BJZ2d3fJ8q6hGssckLL/e/6af8AxVctp6+LtH+F1r4g0FdDlnaCaz1LR5ZFj+zfxKrMzN827d9771UdM8caH40+EmneOrq4lXw/eadDeN9h/efZrrd5arNu/wBX+8/i/i/vV1V3Ja6fa2Xh/UpLKVY4oftVp9hkjjtrqZW2/vFX94u3y9rNtVv+A0EGD4HvLzxV4PlXxdpq2EUj3FnYtcsvnfaFhj3M0f8Azzb+8vy/NXkvj7wLqVi8Fno9ja7vI3XLIzL5e37rR/xSbvm+X+9XdS2Oi+Hb/SfD+va5P9vkVo9DiuVbz1vJGaPduVVVo1+X+9t+7/dru/D1jH8QrW4h0vR4r+LwnbRrJqDzwr9pVZG3NGv3m+b+H+L/AIEtBZ8mRSafoutweZr39jX6xXCyoySeRer8vzTK38W7+Jf4a9D0X4gTeILa4jW1+z6lpcC3EksTLJHJD8sf7v8A2f8A4n/gNe4eJPAvhXVIZdN1rw3ptwu5ldbvbuZpI9sbK397c1eQ3/w10/wrrOnX2m6K7aa1jNNd225W8xY/vMrN/eX+Hcv3aCC1c+LJrzR9RuLO8lX+y5Vhli3Kyyfek3R/Nub5f8/LUWteJIZEdZrG6srxbVrrymttyxMy7d3yt8v/AALb/FXmmqaLqmm6pYXXh3T7ywsmWS4niZmbbuXdJ83+yv8AtVe1bx5D5C2Opa9Zy3F8yxx3MiNJtjX+Ftq/L8zUAZfjiS1vvCGraTJD/plwqwtIitJ5m7cu1mZvlX7v3f8A2auQ8M3Vu1xb7fPsrizfdBB93Z5f3Vb/AL5rX8UalJqWkJfSSeUqzww3Vsu393J/DMrfe/h+7/s1wtzqjWN1BNceU6eey3PmfeVl/wCejK3ysy/+PUAfSPgP41W/iSFdP8VXEVrdW6t9julTasm1WbbtX+Jm/wDQq9NXXo5vB2krHte31qe1j/dsqtGy7fmb5v3bbl2/8Cr4XuvEy2eowXCzRKtr5jSRNJuWX/aX5f8A4mtfRfjR4is9Ht4f7UeW2tfm+wysvkybWX7y/wB77v8A3zQB94eLbzzv7Jt7HUpbZrOWOaKXzNsjfLtk+ZV/iXctUpb611Swv/tlm1la26R6hLEu6SaKRZNqr/F822Pd8tfN2lftVabZ22nat4ms4Ht9P/czx2cbbfJWT5fl/vKzL/F/3zXSw/tifC+GW91LxBb6tqMGpSLJtSLy9y+Wvlqy/wCyyr/3zQWdb4u8O6h4q8NNfWbNAuqJJM07blkjt9zKsMka/wC791vm+7Wgmn2OpaLpy3UlxBpLL9ofY3ltPJuVWkXc3mL8vzbvut/49Xl2qftefCO48KatHZ6XrPn3UjLE0ltt/c+Wu6P5t3+1/erOn/bJ+DtxFFDpMerfa7fdtklVljnX73lsrf3f/ZqCD6J07WNP8VXbWfhO1S3guoFhllnVY1juo12srNI277qr9773ytWZq66tHqOg6ffb2uo2aTVWWBl8hfMZVXc27cu3b91vvf3fu14VH+2F4X+0PdeF/BNva3F40cjReZ8skkK7vM2/3mVfvf7NO1T9uDUPN1S+bwSt1BqkEcN5+9+ZVXb5f+7tZV/z81BZ7lNpNr428Ff2fazXEul/bptP8yxl8r5lk27dsn8W3b/lq5xvD+k+Hdfa11a3n/tLw/pEMen3zbWn8tpG/wBIX5l/eKvy7tv8P8W75fNdD/a48LyaT/xL9FvNOivrqO4um3LHtkaTdJJGv97b/Ev/AMVXc6R8UPhD8Rtb1m+s/FmtteMq2en/AGldrLDt+X9591trbl/3aCDe1Lw34b17+1/HWitez3VvpEmjxtO6yTbtv7ybd/Dub7391V+Wrvgzwr4w1rSfDXiTSbjS2vNLtPLa5e5ZVWFY/wB4sir8sm6RflX7yttqvNJNpcFhpOg2tk2mahut766ZtsPzNuZm/wC+f9qum8KaHb2tt4rvluJbLRNNghjvtOs3XyLmObb5n8O5l3bd235fu/3qCzlPBOqQ6L8PLy3a4nfVoVa4VVg3Q/bFkZmZW3bdrRs3+d23obaOa11C1s9HvLee4vLy3vJ5512+azMq+Xt/hXau1v8Ae/4FUlhD4XtdKnmtbie1it/9FggZvMjVbjb5MzM277u7/wAeqs+h2tn4kt1s7i6S6uPmtrtfmj8ndukj8v8Ahbd8yt/8TQQfMf8AwUT8H3WufHaK8t7eCz8yxWP5m/d7vObau77vy7m/y1dT+yjfW9n8G2bUrq1S88P6nM0EF5LHHHLH/wA8W/hbd8rf99f3Vrmf24fHFjpfxRg0+6mlurVoGmg2r827cy+ZJ/tbv/Qa+YdN03xZ4ivLnVtLa4SK4bzINz+Wsu1v4V+7/wB9UFn3N8RtQ0GZNLuv+E40mXVLe5kkaW2utrLH8vyxru+bbub/AHqp6p408L2ul3lrqGsaCvmRfZ1kaSONZLfzGbzFh+Xc25v95fvV8Yaj8MfGy30VxcaGkV5cbpkX7SvmNub+La3ytSTeC/Hlw0tjfeH5fNhi3MlzcxyM23+Jd38VAH3tc33h3UNU01dJ8dWVxFdWkduk8jL5i3W7dGzN91vm2r/3zXpejabNrmu/bm0uTTrnSYIb68jaJZYZYVWT7RukVl+X5Y2/3lr8o18L+MLe4iWGFrWXb50XlT/N/vLtb5a3Yvit8ddP0yfSx8QPF8FjfQSWdwjahM3mRsu1o2/i2/w/NQQZXxZ8VSeOvip4l8URzfaE1LU5pInX/lpCrbY//HVWvvb9j7TPDtt+zlo13ctqqSyaheahtWfy4fO3Kq/L96RWWNl/urtr88tN0+Rl+xw/vbq4ZYYFX5f3jNt+9/n7tfqj4F8LzeBfhbp2h3lvdPFoenR26vFIrfZGb5mk27m/u/e+b7zN826gs0rxrHULVV0lZ7OBtV+1RLtVpLaaRlVmX5V2q21Vb/Z+ameKdN1yONtDt1i83SZf9MgZtsLbl2yLJ/C23du2/wC03+7Wlc6e1qtxb6PCl/F+72XMe22b+L70bf3vvU3U/E2oMl5eLprvcX1zJHBuiVfLVvlWSaNW2/Nu/wB75f4qCAtbyG1s4lXT7i/t7eRbhYrWNmka8X/WN8vzbWVVqgLjwz9hvNS0+8vG8v5du2SNVkVvmj27vmXcyr/s1t6dJHpL6dDHdeIF1KGCTdcwSeVJGzfLt3L/ALW7+Hd81YMEPiBbtVWzt51hby7zdc/6tZG+9tZfmk/i3f3t1BZd1FtY8O6DqK61N5txpLQwyRPKvly2sn3v4fmXbu+98zVZvtJjs5bizkbYk1r8/kbvMl+X5f8Arou7+9/wL+Kqeo6tfXlzBHeWsUC30U1mzTyLcrL5LeYrf98tt+Xb/wDFMj1qxutN1HWJNq2cM+21b5laDdH8sLK21tu7/gPyrQQWI7z+1Gv7rxE39rajawRzafLEzLLbfL91o/l3bfl/8drS1Vrho4pI/wDiaXlxaTTJHI3lxyRx7VaTd/z0X5W+b/ZrKhsdShtre6bTWstUvLT7Z5ksqq0lqzKrKqr/ALS/d/3d1WryHT9YuUZrxLCz8hbizuVXdM3+15bfNuZlVW/h/i/u0FhpFjugurGx0W4V5J/tCy+bu8rcu5tys3yxyMy/N/s1au1vtQ1pbNbh0a3WPcqttWNl3LIqt97bt/h/2qq6TeaffHSW0VmuEk0+S41WS28z9wq/Lu3MvzfxfL8v3araat9b2DyagqXEEMnyzyOvnSLu/dt8rbt3+f8AZoIKCbo9U86+jt2sptXkt4pGuW3Kqxrtm/4F93bV+2t47e6isdLvl+1eX512rKqxrbs3zMysy/6vazf7VQvZ3mg3102oKpjW7jk3W0v2mO2mkXdH/DtXd8v3qt21jpsd1L/ot7LdfbJrGSR1WSaBmj3f8tG3NH93atAEVktxqA1ZdFjisLLbHbxtafN5v3mkaP8AiXd/vfw0bZLW0Zv7Wn+23VjJbyL5bRqvzbWZl+6y/wALbv4W3VF4gtb6zt7VdNmSA26xwtAsTKs8zMy/dX7v92rh26l9v0m30P7LeWdsrSeUjM0Ssq7reRm2/wB3cu7726gCe8mh8QXlxJMtxPFpse6O2lbyvLt1+7GrfxbW+7/vVQn0+6ktrDUNNkaJLeCa4u2ZPOjbaq/Myr91f975q0La3t77wrbrDNFeLp8bTWzxfNJ5fnKvkyM21mXcu35t23/dqlZ6L/ammXXnX0sT6PbXUd3OzbWlXb96NvlkVvm2/wAXytQWUvCtxHqircSNZWt5NJJHHBcxssfmbVby4/lbasjN93b83y0+z0+OG8S41qFFt7hvJniklbyWm/6Zs27d91fm/wBmtS5vv+EivPCHiDVIUis7e2aNoLaJVbazbmZtu3cy/wAPzf3azbnWtLt0WHVLeK68zUPsuny/LGzSMyt80a/L/Ev/AHz/AA0EGy11rGl+GVWG++2JJBJJ9luZ22xwxyKzfd+993/vqsvVmt7W50mxjW8uLjUoreR1ibdHBN5fm7VWRvm2qqsy/daprbT5FuWvrO6gvBJYyfbJWbzI4G2/u42jZvm+b+6v/oK1lx61pN1e2uoXSy6XFpt3bx3VsqSTSS7YfLmmX/d3UFjtRj1hfDVheWNqjJeLD9ujjjjXyo42Xb+5/vN++bb/APs11+iLY2et2erXGl3F5o1xub7HFLuVmVWkjkbdt/u7tqsv3a5HQdQumSf7LqEaaXDqPy3TOqzxKy7Y/l+9JtjZtzfdXzFrb03UPEEOlL4TW+kuLrWrlZNPktrny4Ypo127W2sq7ljb+L+7QQYyQ6hJqP2hfsd1Fqksl9OktyrNFbtIqrJDu+9tVflVqZHb2ek6VBqlxcNdKrtHbXMjfLA0m2PcrN823d5fy/d3VLp11Nb6nBq1u09vZw2s1vHF5jSTSxqzKsm3+75i/wAP/wBjRY27a5ZwWt1CjS3X7z7LuWRW+b95Irf3t393/doLL/in+1v+Ejt1ur6WW40WKGF5/sce6/tY/vL8v/LPd/D/ABf7VS+J9Lt9YsIre11a1ibUoGjvJ1Rl8n95tkXbtVvL2/M235ayP7U1a8mutSa3+1adas1vqct40izbfM+ZVXbuZV3bflZd25vu/K1WIdQ1Lw7pFhYyXXy6gy2MUCt/q41jZvLb+8u7+9/wKggsWF5NeXurXmkstq1urQxxQJ5UH2fy22zbf4v4fl/i/wCA1kQzfYbXVriNlS3t1tVuUby/OWORm/h2/d+63+1u/iq1pFxqFvcWsK3X2f8A4mU0N191pfux/Z4FjkXcq7tu6T5flbdV+703TYfFWrza9p8n22aT7RBp8knyz3EaqreWy/K0asv8X8W7726gsfcah4dj1Lcs109veRrJHaRt5cM821vMuZv4ty/u9rfd+6tQxapdabrMl5ouxrCFWj+0+fIzbmXc0e7+783zfd27qztJkhtYbhbyS3aW6lXzPNkZY45G2qyszNu+X5W2/wAW2runaaum22rzXUjS3i3P9qReR+8ju1uGVW/2fmVW/wCBNQQT6pJHbltQurW4iuJLlre2ktm8yCeNl2su1W+8zN95vu1Q1Nfs83nXF1Kl/C32eC182Nvs1v5f97bt3eYzf7VT6jIv9q2VrcWbz7Z9vlQNJ5cbK27a38Py/wC1/wCPU3TbXUNJtp12pLL5jahJO25vNk3N8y/eXb8q/wCz93/gIBFrOn32kyaasMcEWoyXMzLE0U3lyMv/ACzX/ZX727+83/Aabf6tfWugrpN19lnvby5axa5ZWaNY1XzW3M38LM33v4mWtHULGSxns5te17VvtTX3lrJbReZEyr+8kVtu7cq/3m+8zf7tS3l1HcWz7pLi/T+01kn1CSLyZPssaqu7yZPvNu/iX7tAEWhSeXrGlt5aebDqEdvElt8vmL5is0bN/FuX+H+Hb/wKimWXma5rCto8cD3EeuWMyySssbSx+Z+8kX/poyrt/hooAk1nTraGw0/UHXzZLvTVvCG6I5X5QPYVRimtdQttSv7izM1xpt1G8T3ErS5klIG/5u65bH+9RRQBDp9s39s2VlG0UUcmqC7nMcKq03ly7I1Y/wCyO9V7fU1kaa8gtRE9/cI0eZC32Zt4DFP97HNFFBZt6Lcz6V4g/sO2fyjqNpcQzyw/Luhk+9Hhtx28+tHh6+jv/EZ1O7tFkm0/Si0X72RPmf5SfkYcY7UUUAR2FppKak8GnaVHaLHLFMzebJK7uGMe4vIzH7oqx4dsZdT8N+MNUlmhWLQkiia2Fsu26Vww+Y9Rj2oooIM/RtWvNR1aa01CT7SBdYVpfnP+rX72fvVX1cIuj6Vp+iINL+06nFa27RIjLaYYfNGpGM8miiguRvaVY6lcaQNR1LWZZ3W68xlQNEHbITnDfd+cnbWV/ZV5c6LZ3NxqMcgbxBb20kZtU2uspU7j/tDb196KKCA1eJ9A8WixlcXradd3EMbtuQGMqdqlVbHy7BitPTtbFhpE8raZaXMrWzxSmYMyumVC4Xdww/vUUUAc6LKCzMtg8MU8CzpMWlDGU+Z0Hmbt2R6/987al1DWbqW+sZUwo1GSLzVPzAxuyZU+v315/wBn3NFFAHp//CE3Om+KLPUrzxDcXyRXcFkkEke1VwQVbIbPG8/L0r84v2oW2eMIre3LRfurv7rfLxN/doooKR6b/wAE9fEtxDa6j4Kv7aLUNNvLm1VorjlQrZyMfVy1fXH9iW934nup70rczzmJS8qBgI0MgCbemOD+dFFAzxv4heOXvtJ8Nyano9rd6nbajb2trqMir5sEWVfao24xksf95t1et+EhpPhfWdM0nQNISzs57WeWaNJWzIDOE2k+hyS397c396iigDU8QafaPolpqi26CculuzMWbOSx3fe61yOv6HYA2kHlERwO1ywV3HmKpYGNufumiigg8Z8XS22nSXtrDZKY720lZFMsmyFnxyq7scZrhta0nTdLutOt7K38kfY1u8oFU+buj5+7/tmiigs8u1u8e9jgj2LEy3IhLr1bEg+b681QvbxToTeIFjdZL67eSZA4+Ygsn3sZ96KKCDgtT1K4sLmO2hCcq43beea5+91vUoQkQlQg5x8nVShO1v73Wiigsv6lqWr6lAqS34QTP+8WOIKj9eq9Oy/981V1GG7tLC1tY7iLypSI9vk9AWb/AGqKKAL2q6BeWCywtqiS+Tb/AGhT9m2evHDe9c5Lp8ZuHgZsjb1xz92iigD0r4Z+AoNbSS4vdZvV8pfkWEhAreWJd35Db/8AW4rp/G/w80TSbG7Gmz3ttNBCJmZJyySMf7yvk/rRRQB4n4hW+8NatNp/2tbgQKuD5ZUD/dUk7azF8R6h9ot7iGea2YR7F+zytHsB64ooqwPUvhn+0n8TfCeq2fhx9YfUtOW6RPKuduQC+Plbbx+Oa/RPQ9dWS2tbG3sEh/4SKO3bzPMZmtgBsYL6k9cmiigkveJPD9qNDSIyOdvl2RP99cZy3qeau+H9LjsYNLjv5nu7m1sor23mX935W/exQfebGEx97uaKKgR+Zv7S3iO98VfG7xFNqBf/AESaO2iG8nauSf619WfAj4MeHfE3wug8WXFxJbXMVvFqCJBGqqvKhk/Hd97rxRRVges6N8MPANre3Mt34eXUVhvIYALuVmYq3XLLtq9a/Bz4c39tPPfeHImZYI5y0Z2sW88D7xz/AAvj8KKKiQFHU/g58PNITVby30CNrpJltBOzfN5W8pj9M14L8V/hL4c0i28RXWkwW9n9ikMarDBtDqUJ5w33ufvUUUAfNHww0a11P41eENJnRJLW412BXjlTIZUkXhtu3dnFfpibO2tbWPVJHubiGO+l09rWWYNHLDN/C/HO3tRRQWWXZ71re1uXMxNnLCJJPvfJE0oZtu3cfl2/Q1BpkVpq2l3IEMkSwW6zrumaRt2xn+83uv60UUEGhokkN7ZaNdXsLTjW9OnvmjeQ7YpEk2/8CyCOvpWd4Zg/tN9XkuFiD2tvFLA6KwdWd2HzHd8+MLjP92iigC3dQQ3mkTayyFZXmjhgUH5bfzPlZk9DnmqOuWv9j2a3fmvOWnSNlf5gSUU7vm3UUUAX7nT49dt7XXDLLBeWLy6ejq25SFfLNtPHzeWuRWLZX8f9jWGqQ2FtFc6tcxxu6p/qxICG2/lRRQWWTrdjpV1Ppum6Mlv/AGfex2YlWT5pI3j3fN8vZuf5Yqhq0lxpemw/2Y0EMVzuaWJ4FdS3ytlc/d5LdPWiigDT0LWtW1y6srC8vpVN9PN9rljkdWn8l1Ee75u3mNTtf128sC2v3UVvcz6ozQMqxCJYZI2+WaPb916KKAJGmYy6jp90kUoY/aRKsYSQNz/EPov/AHzXSaTpKah4sSwnurjy/EGjefcSb/32+NGK/P1NFFBBzOnTakHuIXvhLbaPBJ9igkiDLGuQMH15GaZchLnQNG1C2QWj6k0jzpH/AKthnGNvTtRRQA+ziNvodpLbyNvCSkmX95nLhO/sKraB9nvPEmm6i9sAPPSNIixKpJIo8yUf7TZX/vgUUUAa2p+H4YdWm8PPcyPp+iW7mKLoZJIsOrs3XO5M/iaXw/aPqdj4geG4aH7NpllOUdRMkkjzSqWZW+maKKAM/T2uRaraXV290081y4lmAZkKPGBj/vn9araXBb3hSbUYvtUlgzzQOzFCrL1+5jrRRQWW7e4uX1K7EjRM2lGK53GJcupCHy1/55rufPy+gqCzuYbC3t5NMtFtjbQOsWDu8uEy58tf7v3fvdeaKKAL7QLrN9EkTvbus1zPKzN5qzMhDMrK3G1iOnarbaDDB4gnge4lkY6LHdPI33i8h3Nj+7yw/L6YKKADWLW50/xvHp8l4LqPUbafUblp4VZ5ZASikt/eAC/N/s1zujWzx6faSXF1LcXEE3mQXDt+8hdlXLIf4aKKCBV1v+01vr28tVkhs5bmA2x27JGTy8P935T83+fl2zWqf2r4W8OzZIl1O5uNzzEyGGBPuRJgr93+826iigsxb3xpeQQpG9lAE+1KCsBMefl98/3f1qRtXvdc0XQrgzvbQXtnbxPDE3RWlGcN9HI/+txRRQB1esaUvhzxTqNoLy5vEjeQBZnyvXHSs2yijstStFjadhdabKg3zMfLQAnaPyX/AL5oooILllZpaa/oAZzOs9ibpFlAYQyRzssbL/ulc/jRRRQWf//Z"

// ---- Custom design example (LALIS stone) — embedded reference image -----
const CUSTOM_DESIGN_IMAGE = "data:image/jpeg;base64,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"
const CUSTOM_DESIGN_REFERENCE_IMAGE = "data:image/jpeg;base64,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"

// ---- Carving types (Flat Carve vs Shape Carved) ---------------------------
// 4 carving styles — ANY combination can be selected on one stone
// (flat + shape + hand-sculpted + laser etching can all coexist).
const CARVE_TYPES = [
  {
    code: 'flat',
    label: 'Flat Carve',
    blurb: 'Etched/engraved into the stone surface — design appears recessed. Included with stone (no extra charge).',
    image: 'FLAT',  // SVG renderer key
    freeWithStone: true,
  },
  {
    code: 'shape',
    label: 'Shape Carved',
    blurb: 'Sculpted in 3D relief — design has dimensional depth.',
    image: 'SHAPE',
    freeWithStone: false,
  },
  {
    code: 'sculpted',
    label: 'Hand Sculpted',
    blurb: 'Hand-carved sculptural element — fully custom, priced per project.',
    image: 'SCULPT',
    freeWithStone: false,
    customPrice: true,
  },
  {
    code: 'laser',
    label: 'Laser Etching',
    blurb: 'Photo-realistic laser-etched imagery on a polished panel.',
    image: 'LASER',
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

  // Vase
  { code: 'unitized-vase',  label: '24x14 M Unitized Vase Panel', category: 'Vase',    price: 175  },

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
    designId: null,             // monuments.id
    designSnapshot: null,       // jsonb cache of the chosen monument record
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

    design_id: order.designId || null,
    design_snapshot: order.designSnapshot || null,
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
    cemetery_deadline: order.cemeteryDeadline || null,
    timeline_notes: order.timelineNotes || null,
    deposit_amount: order.depositAmount ?? null,
    deposit_method: order.depositMethod || null,
    deposit_ref: order.depositRef || null,
    deposit_received_at: order.depositReceivedAt || null,
    balance_amount: order.balanceAmount ?? null,
    balance_method: order.balanceMethod || null,
    balance_ref: order.balanceRef || null,
    balance_received_at: order.balanceReceivedAt || null,
    cancelled_at: order.cancelledAt || null,
    cancel_reason: order.cancelReason || null,
    cancel_notes: order.cancelNotes || null,
    parent_quote_id: order.parentQuoteId || null,
    mausoleum_intake: order.mausoleumIntake || null,

    deceased: order.deceased || [],
    staff_notes: order.staffNotes || [],
  }
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

    designId: row.design_id || null,
    designSnapshot: row.design_snapshot || null,
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

function DesignStep({ order, update }) {
  const [allMonuments, setAllMonuments] = useState(null)
  const [loading, setLoading] = useState(true)
  const [autoFilter, setAutoFilter] = useState(true)
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

  const matchesShape = (m, shapeCode) => {
    if (!m.cats) return false
    // Map our internal shape codes onto the catalog's category names
    const codeToCat = {
      slant: 'slant', 'double-slant': 'double-slant',
      die: 'single-upright', 'double-die': 'double-upright',
      grass: 'flat-marker', hickey: 'flat-marker', bronze: 'flat-marker',
      custom: 'custom-shape',
    }
    const cat = codeToCat[shapeCode]
    return cat ? m.cats.includes(cat) : false
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

  // The base list — auto-filtered by shape+color when toggle is on,
  // then optionally narrowed by the free-text search.
  // Sprint 3j: when the user picks element/symbol filters they're explicitly
  // saying "show me this symbol" — that intent should override the
  // "stones like this shape" auto-filter, so symbols pull from all shapes.
  const baseList = useMemo(() => {
    if (!allMonuments) return []
    let list = allMonuments
    const hasSymbolFilters = (order.elementFilters || []).length > 0 && !searchText.trim()
    if (autoFilter && order.shape && !hasSymbolFilters) {
      list = list.filter(m => matchesShape(m, order.shape))
    }
    if (autoFilter && order.graniteColor) {
      const colorRec = GRANITE_COLORS.find(c => c.code === order.graniteColor)
      if (colorRec) list = list.filter(m => matchesColorFamily(m, colorRec.family))
    }
    if (searchText.trim()) {
      list = list.filter(m => matchesQuery(m, searchText))
    }
    return list
  }, [allMonuments, autoFilter, order.shape, order.graniteColor, searchText, order.elementFilters])

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

  const pickDesign = (m) => {
    const snapshot = {
      id: m.id, lastname: m.lastname, name: m.name, img: m.img,
      carve_type: m.carve_type, granite_color: m.granite_color,
      cats: m.cats, tags: m.tags, description: m.description,
    }
    update({ designId: m.id, designSnapshot: snapshot })
  }

  const clearDesign = () => update({ designId: null, designSnapshot: null })

  const thumb = (url) => {
    if (!url) return url
    if (url.includes('drive.google.com')) return url.replace(/sz=w\d+/i, 'sz=w400')
    return url
  }

  const renderCard = (m) => (
    <button
      key={m.id}
      type="button"
      className={`sm-design-card ${order.designId === m.id ? 'on' : ''}`}
      onClick={() => pickDesign(m)}
    >
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
      {order.designId === m.id && <div className="sm-design-check">✓</div>}
    </button>
  )

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

      {/* ---- Selected design (sticky-ish at the top) ----------------------- */}
      {order.designSnapshot && (
        <Section title="Selected design" eyebrow={order.useCustomDesign ? 'Reference for the custom design' : 'Currently picked'}
          right={<button type="button" className="sm-link-btn" onClick={clearDesign}>Clear pick</button>}
        >
          <div className="sm-selected-design">
            <div className="sm-selected-thumb">
              {order.designSnapshot.img && <img src={thumb(order.designSnapshot.img)} alt="" />}
            </div>
            <div className="sm-selected-info">
              <div className="sm-selected-id">{cleanCatalogId(order.designSnapshot.id)}</div>
              <div className="sm-selected-name">{order.designSnapshot.lastname || order.designSnapshot.name}</div>
              {order.designSnapshot.lastname && order.designSnapshot.name && (
                <div className="sm-selected-sub">{order.designSnapshot.name}</div>
              )}
              <div className="sm-selected-tags">
                {order.designSnapshot.carve_type && <span className="sm-modal-tag">{order.designSnapshot.carve_type}</span>}
                {order.designSnapshot.granite_color && <span className="sm-modal-tag">{order.designSnapshot.granite_color}</span>}
              </div>
            </div>
          </div>
        </Section>
      )}

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

      {/* ---- Element filter chips ------------------------------------------ */}
      <Section title="Symbols & elements" eyebrow="Pick what they want — each gets its own row below"
        right={
          <div className="sm-toggle-group">
            <button
              type="button"
              className={`sm-toggle-btn ${autoFilter ? 'on' : ''}`}
              onClick={() => setAutoFilter(true)}
            >Match shape + color</button>
            <button
              type="button"
              className={`sm-toggle-btn ${!autoFilter ? 'on' : ''}`}
              onClick={() => setAutoFilter(false)}
            >Browse all</button>
          </div>
        }
      >
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

      {/* ---- Sectioned results --------------------------------------------- */}
      {loading && (
        <Section title="Catalog" eyebrow="Loading…">
          <div className="sm-design-loading">Loading designs from the catalog…</div>
        </Section>
      )}

      {!loading && sections.map(section => {
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
                No designs match. {autoFilter && <>Try "Browse all" above or remove some symbols.</>}
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
  // Detect what's on by checking add-ons
  const flatOn     = order.addOns.some(a => a.code === 'flat-carve')
  const shapeOn    = order.addOns.some(a => SHAPE_CARVED_CODES.includes(a.code))
  const sculptedOn = order.addOns.some(a => a.code === 'hand-sculpted')
  const laserOn    = order.addOns.some(a => a.code?.startsWith('laser-'))

  const isOn = (code) =>
    code === 'flat'     ? flatOn
  : code === 'shape'    ? shapeOn
  : code === 'sculpted' ? sculptedOn
  : code === 'laser'    ? laserOn
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
    if (shapeOn) {
      // Remove all shape-carved designs
      update({ addOns: order.addOns.filter(a => !SHAPE_CARVED_CODES.includes(a.code)) })
    }
    // No "add" action — turning Shape on just opens the picker; user picks designs to actually add
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
    if (laserOn) {
      update({ addOns: order.addOns.filter(a => !a.code?.startsWith('laser-')) })
    }
    // No "add" action — turning Laser on opens the size picker
  }
  const toggleByCode = (code) =>
    code === 'flat'     ? toggleFlat()
  : code === 'shape'    ? toggleShape()
  : code === 'sculpted' ? toggleSculpted()
  : code === 'laser'    ? toggleLaser()
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
    <Section
      title="Carvings"
      eyebrow="Pick any combination — Flat, Shape, Hand-Sculpted, Laser Etching"
    >
      {/* 4 type toggles */}
      <div className="sm-carve-types">
        {CARVE_TYPES.map(t => (
          <CarveTypeCard
            key={t.code}
            type={t}
            on={isOn(t.code)}
            onClick={() => toggleByCode(t.code)}
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
      {shapeOn && (
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
      {laserOn && (
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
                    {isWhole && !stoneSqIn
                      ? '— pick a stone size first'
                      : `$${price.toLocaleString()}`}
                    {size.discount > 0 && (
                      <span className="sm-laser-size-disc"> ({Math.round(size.discount * 100)}% off)</span>
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
    </Section>
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

  // Map type.image key to actual photo source (only flat + shape have photos for now)
  const imgSrc =
    type.image === 'FLAT'  ? FLAT_CARVE_IMAGE
  : type.image === 'SHAPE' ? SHAPE_CARVED_IMAGE
  : null
  const fallback =
    type.code === 'flat'     ? <FlatCarveSVG />
  : type.code === 'shape'    ? <ShapeCarvedSVG />
  : type.code === 'sculpted' ? <HandSculptedSVG />
  : type.code === 'laser'    ? <LaserEtchSVG />
  : <FlatCarveSVG />

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

  // Helper: ensure we have room for `need` mm of content; otherwise new page
  const ensure = (need) => {
    if (y + need > H - M - 12) {  // leave room for footer
      addFooter()
      doc.addPage()
      y = M
    }
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
    sectionHeader('Stone specifications')
    const stdSize = order.standardSizeCode ? shape.standardSizes.find(s => s.code === order.standardSizeCode) : null
    // The standardSize label IS the dimensions (e.g. "2-0 × 1-0 × 1-6"),
    // so use it directly. Custom dims fall back to the entered numbers.
    const sizeText = stdSize
      ? stdSize.label
      : [order.width, order.depth, order.thickness].filter(x => x != null).join(' × ') + '"'
    kvRow('Shape', sizeText ? `${shape.label} — ${sizeText}` : shape.label)

    const color = GRANITE_COLORS.find(g => g.code === order.graniteColor)
    if (color) kvRow('Granite color', `${color.label} (${color.origin})`)

    const top = TOP_SHAPES.find(t => t.code === order.topShape)
    if (top) kvRow('Top shape', top.label)

    const polish = POLISH_LEVELS.find(p => p.code === order.polishLevel)
    if (polish) kvRow('Polish level', polish.label)

    const sides = SIDES_OPTIONS.find(s => s.code === order.sides)
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
  const designRef = order.designSnapshot?.lastname || order.designSnapshot?.id
  if (designRef || order.elementFilters?.length || order.designPreferences) {
    sectionHeader('Design')
    if (order.elementFilters?.length) {
      const symLabels = order.elementFilters.map(c => SYMBOLS.find(s => s.code === c)?.label || c)
      kvRow('Symbols', symLabels.join(', '))
    }
    if (designRef) {
      kvRow('Reference', `Catalog #${designRef}`)
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

  // Header row
  ensure(6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GREY)
  doc.text('DESCRIPTION', M, y)
  doc.text('AMOUNT', W - M, y, { align: 'right' })
  y += 1.5
  doc.setDrawColor(...LIGHT_RULE)
  doc.setLineWidth(0.2)
  doc.line(M, y, W - M, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...TEXT)

  let subtotalDisc = 0       // discount-eligible (everything except cemetery permit)
  let subtotalPermitPdf = 0  // cemetery permit only (passed through, no discount)
  for (const it of itemsResolved) {
    if (it.amount == null) continue
    ensure(5)
    const wrapped = doc.splitTextToSize(it.label, W - M - M - 30)
    doc.text(wrapped, M, y)
    doc.text(fmtUSD(it.amount), W - M, y, { align: 'right' })
    y += 4 * wrapped.length + 0.5
    if (it.code === 'addon-permit') subtotalPermitPdf += Number(it.amount) || 0
    else                            subtotalDisc      += Number(it.amount) || 0
  }
  for (const it of customItems) {
    if (!it.label && !it.amount) continue
    ensure(5)
    const wrapped = doc.splitTextToSize(it.label || '(custom item)', W - M - M - 30)
    doc.text(wrapped, M, y)
    doc.text(fmtUSD(it.amount), W - M, y, { align: 'right' })
    y += 4 * wrapped.length + 0.5
    subtotalDisc += Number(it.amount) || 0
  }
  const subtotalPdf = subtotalDisc + subtotalPermitPdf

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
  const discountPctPdf = Number(order.pricing?.discountPct) || 0
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
  doc.line(W - M - 80, y, W - M, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...GOLD)
  doc.text(isContract ? 'DUE TODAY (50% DEPOSIT)' : 'DEPOSIT AT SIGNING (50%)', W - M - 60, y)
  doc.setTextColor(...NAVY)
  doc.text(fmtUSD(deposit), W - M, y, { align: 'right' })
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GREY)
  doc.text('Balance (at delivery / installation)', W - M - 60, y)
  doc.setTextColor(...TEXT)
  doc.text(fmtUSD(balance), W - M, y, { align: 'right' })
  y += 7

  // ============================ NOTES ====================================
  // Customer-facing notes from the pricing step (NOT the internal staff notes)
  // We show pricing.notes here only if it's marked customer-facing — for now
  // we keep it internal and don't emit it.

  // ============================ SIGN-OFF =================================
  ensure(40)
  y += 6
  doc.setDrawColor(...LIGHT_RULE)
  doc.setLineWidth(0.2)
  doc.line(M, y, W - M, y)
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREY)
  const acceptText = isContract
    ? 'This contract has been signed by the customer and Shevchenko Monuments. ' +
      'Pricing is locked and production may proceed per the terms above.'
    : 'This estimate is valid for 30 days from the date above. ' +
      'To accept and proceed with production, please sign below. A signed copy will become your contract.'
  const wrapped = doc.splitTextToSize(acceptText, W - M - M)
  doc.text(wrapped, M, y)
  y += 4 * wrapped.length + 6

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

// Sprint 3j — Receipt PDF. paymentType is 'deposit' or 'balance'.
// Each payment generates its own receipt showing what was paid + the
// running running running.
async function generateReceiptPDF(order, paymentType = 'deposit', opts = {}) {
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
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

  let y = M
  const ensure = (need) => {
    if (y + need > H - 16) {
      doc.addPage(); y = M
    }
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

  const isDeposit = paymentType === 'deposit'
  const paymentAmount = Number(isDeposit ? order.depositAmount : order.balanceAmount) || 0
  const paymentMethod = isDeposit ? order.depositMethod : order.balanceMethod
  const paymentRef    = isDeposit ? order.depositRef : order.balanceRef
  const paymentDate   = isDeposit ? order.depositReceivedAt : order.balanceReceivedAt
  const totalPaidToDate = (Number(order.depositAmount) || 0) +
    (isDeposit ? 0 : (Number(order.balanceAmount) || 0))
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
  const receiptNo = `R-${order.orderNumber || 'DRAFT'}-${isDeposit ? 'D' : 'B'}`
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
  doc.text(isDeposit ? 'PAYMENT RECEIVED — DEPOSIT (50%)' : 'PAYMENT RECEIVED — FINAL BALANCE', M, y)
  y += 7

  // Payment details table
  const methodLabels = { check: 'Check', cash: 'Cash', card: 'Credit / Debit Card', other: 'Other' }
  const rows = [
    ['Amount paid', fmtUSD(paymentAmount)],
    ['Method', methodLabels[paymentMethod] || paymentMethod || '—'],
    ['Reference', paymentRef || '—'],
    ['Date received', fmtDate(paymentDate)],
  ]
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

      <div className="sm-grid-2" style={{ marginTop: 14 }}>
        <Field label="Target completion date" hint="Promised by — what to plan production around">
          <input
            type="date"
            className="sm-textinput"
            value={order.targetCompletionDate || ''}
            onChange={e => setDate('targetCompletionDate', e.target.value)}
            disabled={isLocked}
          />
        </Field>
        <Field label="Cemetery deadline" hint="Permit window expires, install must be by, etc.">
          <input
            type="date"
            className="sm-textinput"
            value={order.cemeteryDeadline || ''}
            onChange={e => setDate('cemeteryDeadline', e.target.value)}
            disabled={isLocked}
          />
        </Field>
      </div>

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

          {order.designSnapshot && (
            <div>
              <div className="sm-summary-lab">Design pick</div>
              <div className="sm-summary-val">
                {order.designSnapshot.lastname || order.designSnapshot.id}
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

  const expectedDeposit = grandTotal * 0.5
  const collectedDeposit = Number(order.depositAmount) || 0
  const collectedBalance = Number(order.balanceAmount) || 0
  const collected = collectedDeposit + collectedBalance
  const remaining = Math.max(0, grandTotal - collected)

  const recordDeposit = () => {
    if (order.depositAmount != null) return
    update({
      depositAmount: Math.round(expectedDeposit * 100) / 100,
      depositMethod: 'check',
      depositRef: '',
      depositReceivedAt: new Date().toISOString(),
    })
  }
  const clearDeposit = () => {
    if (!confirm('Clear deposit record?')) return
    update({ depositAmount: null, depositMethod: null, depositRef: null, depositReceivedAt: null })
  }
  const recordBalance = () => {
    if (order.balanceAmount != null) return
    update({
      balanceAmount: Math.round(remaining * 100) / 100,
      balanceMethod: 'check',
      balanceRef: '',
      balanceReceivedAt: new Date().toISOString(),
      // Auto-advance status if both are now collected
      status: remaining > 0 ? 'paid_in_full' : order.status,
    })
  }
  const clearBalance = () => {
    if (!confirm('Clear balance record?')) return
    update({ balanceAmount: null, balanceMethod: null, balanceRef: null, balanceReceivedAt: null })
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

      {/* Deposit row */}
      <div className="sm-payment-block">
        <div className="sm-payment-block-head">
          <strong>Deposit (50% at signing)</strong>
          {order.depositAmount == null
            ? <button type="button" className="sm-add-btn" onClick={recordDeposit}>+ Record deposit (${expectedDeposit.toFixed(2)})</button>
            : <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={clearDeposit}>Clear</button>}
        </div>
        {order.depositAmount != null && (
          <div className="sm-grid-2" style={{ marginTop: 8 }}>
            <Field label="Amount">
              <TextInput type="number" value={order.depositAmount}
                onChange={v => update({ depositAmount: v === '' ? null : Number(v) })} />
            </Field>
            <Field label="Method">
              <SelectInput
                value={order.depositMethod || ''}
                onChange={v => update({ depositMethod: v || null })}
                options={[
                  { value: 'check', label: 'Check' },
                  { value: 'cash',  label: 'Cash' },
                  { value: 'card',  label: 'Credit / debit card' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Field>
            <Field label="Reference (check #, last 4, etc.)">
              <TextInput value={order.depositRef || ''}
                onChange={v => update({ depositRef: v })}
                placeholder="check #4421" />
            </Field>
            <Field label="Date received">
              <input type="date" className="sm-textinput"
                value={order.depositReceivedAt ? order.depositReceivedAt.slice(0, 10) : ''}
                onChange={e => update({ depositReceivedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
          </div>
        )}
        {order.depositAmount != null && (
          <ReceiptActions order={order} paymentType="deposit" />
        )}
      </div>

      {/* Balance row */}
      <div className="sm-payment-block">
        <div className="sm-payment-block-head">
          <strong>Balance (at delivery / installation)</strong>
          {order.balanceAmount == null
            ? <button type="button" className="sm-add-btn" onClick={recordBalance} disabled={order.depositAmount == null}>
                + Record balance (${remaining.toFixed(2)})
              </button>
            : <button type="button" className="sm-link-btn sm-link-btn-danger" onClick={clearBalance}>Clear</button>}
        </div>
        {order.depositAmount == null && (
          <div className="sm-helper" style={{ marginTop: 6 }}>Record the deposit first.</div>
        )}
        {order.balanceAmount != null && (
          <div className="sm-grid-2" style={{ marginTop: 8 }}>
            <Field label="Amount">
              <TextInput type="number" value={order.balanceAmount}
                onChange={v => update({ balanceAmount: v === '' ? null : Number(v) })} />
            </Field>
            <Field label="Method">
              <SelectInput
                value={order.balanceMethod || ''}
                onChange={v => update({ balanceMethod: v || null })}
                options={[
                  { value: 'check', label: 'Check' },
                  { value: 'cash',  label: 'Cash' },
                  { value: 'card',  label: 'Credit / debit card' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Field>
            <Field label="Reference (check #, last 4, etc.)">
              <TextInput value={order.balanceRef || ''}
                onChange={v => update({ balanceRef: v })} />
            </Field>
            <Field label="Date received">
              <input type="date" className="sm-textinput"
                value={order.balanceReceivedAt ? order.balanceReceivedAt.slice(0, 10) : ''}
                onChange={e => update({ balanceReceivedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
          </div>
        )}
        {order.balanceAmount != null && (
          <ReceiptActions order={order} paymentType="balance" />
        )}
      </div>
    </Section>
  )
}

// Sprint 3j — Receipt action toolbar (Preview / Download / Email / Print)
function ReceiptActions({ order, paymentType }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewFilename, setPreviewFilename] = useState('')

  const buildDoc = async () => {
    return await generateReceiptPDF(order, paymentType, { returnDoc: true })
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
      const subject = `Receipt for ${paymentType === 'deposit' ? 'deposit' : 'balance'} payment — ${orderNum}`
      const body = [
        `Hello ${firstName},`, '',
        `Attached is your receipt for the ${paymentType} payment on order ${orderNum} — file: ${filename}`,
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
        <strong>Receipt:</strong> for this {paymentType} payment
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

// New wizard step — captures signatures and converts Estimate → Contract.
// Shows lock-banner if order is already in CONTRACT state.
function SignStep({ order, update }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isLocked = !!(order.signedAt || order.pricingLockedAt)
  const customerSig = order.customerSignature || order.customerSignatureUrl
  const repSig = order.repSignature || order.repSignatureUrl
  const ready = customerSig && repSig && !isLocked

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

      <Section title="Customer signature" eyebrow={isLocked ? 'Captured' : 'Required'}>
        <SignatureCanvas
          value={order.customerSignature || order.customerSignatureUrl}
          onChange={(d) => updateSig('customer', d)}
          label={`${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'Customer'}
          disabled={isLocked}
        />
      </Section>

      <Section title="Shevchenko Monuments representative" eyebrow={isLocked ? 'Captured' : 'Required'}>
        <SignatureCanvas
          value={order.repSignature || order.repSignatureUrl}
          onChange={(d) => updateSig('rep', d)}
          label={order.salesRep || 'Sales representative'}
          disabled={isLocked}
        />
      </Section>

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

/* ---- CARVINGS — multi-select 4-card grid (Sprint 3j) -------------------- */
.sm-carve-types {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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


