// =============================================================================
// monumentCatalog.js — the monument SPEC catalog (Phase 1 extraction).
// =============================================================================
// Dependency-FREE: this module imports nothing from the app. It holds the spec
// constants (shapes / tops / sides / polish / bases / colors) + the die-spec
// builder, lifted verbatim out of SalesMode.jsx so SalesMode, OrderForm,
// orderRates, and the PDF can all import from ONE place with no import cycle.
// Pure data + pure functions — ZERO behavior change from the move.
// =============================================================================

// ---- Format helper: feet-inches notation used throughout shape sizes ------
// 24 → "2-0", 18 → "1-6", 4 → "0-4"
export function ftIn(inches) {
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
export const SHAPES = [
  {
    code: 'grass',
    label: 'Grass Marker',
    blurb: 'Flush marker installed at grass level.',
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
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
    icon: '',
    standardSizes: [],
    canHaveBase: false,
    onlyForServices: ['MAUSOLEUM'],
  },
  {
    code: 'civic',
    label: 'Civic / Memorial',
    blurb: 'Public, veterans, or religious monument.',
    icon: '',
    standardSizes: [],
    canHaveBase: true,
    onlyForServices: ['CIVIC_MEMORIAL'],
  },
]

// ---- Top shapes (apply to slant/die/upright shapes) -----------------------
export const TOP_SHAPES = [
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
export const SIDES_OPTIONS = [
  { code: 'brp',                   label: 'BRP',                   blurb: 'Balanced Rock Pitch on all sides.' },
  { code: 'brp-vertical',          label: 'BRP Vertical Sides',    blurb: 'BRP on the vertical sides only.' },
  { code: 'all-polish-no-sides',   label: 'All Polish No Sides',   blurb: 'Fully polished — no sides treatment.' },
  { code: 'saw-back',              label: 'Saw Back',              blurb: 'Sawn back surface (smooth, unpolished).' },
  { code: 'rough-back',            label: 'Rough Back',            blurb: 'Rough-quarry texture on the back.' },
]

// ---- Base sides (different option set than die sides)
export const BASE_SIDES_OPTIONS = [
  { code: 'polish-top-brp',  label: 'Polish Top BRP',  blurb: 'Polished top with BRP sides.' },
  { code: 'all-polish',      label: 'All Polish',      blurb: 'Fully polished base.' },
  { code: 'brp-sawback',     label: 'BRP Sawback',     blurb: 'BRP sides with sawn back.' },
]

// Auto-default sides based on polish level for dies/slants
export const POLISH_TO_SIDES_DEFAULT = {
  P2: 'brp',
  P3: 'brp-vertical',
  P5: 'all-polish-no-sides',
}

// ---- Polish levels --------------------------------------------------------
export const POLISH_LEVELS = [
  { code: 'P2', label: 'P2 — Polished 2',  blurb: 'Front and back polished.' },
  { code: 'P3', label: 'P3 — Polished 3',  blurb: 'Front, back, and top polished.' },
  { code: 'P5', label: 'P5 — Polished 5',  blurb: 'All sides polished except the bottom.' },
]

// ---- Base sizes (used when adding a base to slant/die/etc.) --------------
export const BASE_SIZES = [
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
export const BASE_HEIGHTS = [
  { code: 6,  label: '6″',  upcharge: 125 },
  { code: 8,  label: '8″',  upcharge: 150 },
  { code: 10, label: '10″', upcharge: 175 },
  { code: 12, label: '12″', upcharge: 200 },
]

// ---- Granite colors -------------------------------------------------------
export const GRANITE_COLORS = [
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

// ---- Shared DIE spec-string builder ────────────────────────────────────────
// The physical spec the way Paul orders a die: "L × W × H · Top · Sides · Color"
// (e.g. "1-10 × 0-8 × 2-4 · Serp Top · P2 · Cloud Gray"). ONE source used by the
// Financial / order-form line items (buildLineItems) AND the contract PDF, so
// they can never diverge. Size is ALWAYS 3 dimensions from w/d/t — the die
// standardSizes carry all three; only their label string dropped the middle one.
export const DIE_TOP_TRADE = {
  'classic-serp': 'Serp Top', 'cathedral-serp': 'Serp Top',
  'flat-top': 'Flat Top', 'roof-top': 'Roof Top', 'oval-top': 'Oval Top',
  'cathedral': 'Cathedral', 'gothic': 'Gothic',
}
export const dimsFromWDT = (o) => [ftIn(o?.w), ftIn(o?.d), ftIn(o?.t)].filter(Boolean).join(' × ')
export function dieSize3(order, shape) {
  const std = order.standardSizeCode ? shape?.standardSizes?.find(s => s.code === order.standardSizeCode) : null
  // Phase 3 — the die's TALL (3rd) dimension is canonically order.thickness (the
  // wizard's "Height" input writes it there), but OrderForm writes the tall dim to
  // order.height and leaves thickness null on a CUSTOM die. Read `thickness ?? height`
  // so the 3rd dim never drops, regardless of which form built the order. LABEL ONLY:
  // dieSize3 feeds buildDieSpec (a label); the face-area price math reads order.height
  // directly in computeFormLineItems and is untouched here, so no total moves.
  return dimsFromWDT({ w: std?.w ?? order.width, d: std?.d ?? order.depth, t: std?.t ?? order.thickness ?? order.height })
}
// Shared top-shape resolver (Phase 6) — the SAME value the die line item AND the
// contract's Stone-specifications block both render, so the two paths can't diverge
// on top shape (trade name vs raw label).
export function dieTopLabel(order) {
  if (!order?.topShape) return ''
  return DIE_TOP_TRADE[order.topShape] || TOP_SHAPES.find(t => t.code === order.topShape)?.label || ''
}
export function buildDieSpec(order) {
  const shape = SHAPES.find(s => s.code === order.shape)
  if (!shape) return ''
  const size = dieSize3(order, shape)
  const topTrade = dieTopLabel(order)
  const polishCode = order.polishLevel || ''
  const color = GRANITE_COLORS.find(c => c.code === order.graniteColor)?.label || ''
  return [size, topTrade, polishCode, color].filter(Boolean).join(' · ')
}

// The single-line BASE spec the way the base line item reads — size + top finish +
// folded height + folded margin + back/treatment finish. The finish CHARGE folds
// into the price (computeFormLineItems), not the label. A baseTextOverride prints
// verbatim. Used by the form BASE-line preview so it matches the contract's folded
// base row.
//
// Phase 5 — base TOP finish (new, display-only) + BACK/treatment finish in the line.
// The back finish is stored two ways across the app: OrderForm's BASE_FINISHES
// (baseConfig.finish: SB/RB/BRP/AP) and the wizard's BASE_SIDES_OPTIONS
// (baseConfig.sides). We read BOTH so the finish shows no matter which form built the
// order. LABEL ONLY — the price-bearing saw-base (finish=SB) / all-polish (finish=AP)
// charges compute separately from baseConfig.finish and are NOT touched here, so no
// total moves.
const BASE_TOP_FINISH_LABEL  = { pol: 'POL TOP', frost: 'FROST TOP' }
const BASE_BACK_FINISH_LABEL = { SB: 'SB', RB: 'RB', BRP: 'BRP', AP: 'ALL POL' }
// The wizard's combo sides bundle a TOP + BACK finish into one label ("Polish Top
// BRP"). Split them so the top finish isn't printed twice and the back reads as a
// clean code (matches the contract's intended "… · POL TOP, BRP").
const BASE_SIDES_SPLIT = {
  'polish-top-brp': { top: 'POL TOP', back: 'BRP' },
  'all-polish':     { top: '',        back: 'ALL POL' },
  'brp-sawback':    { top: '',        back: 'BRP, SAW BACK' },
}

export function buildBaseSpec(order) {
  const bc = order.baseConfig || {}
  const override = (bc.baseTextOverride || '').trim()
  if (override) return override
  const baseSizeObj = BASE_SIZES.find(b => b.code === bc.sizeCode)
  // DIMENSIONS ONLY — some BASE_SIZES labels embed " polished top"; strip it so the
  // top finish below isn't doubled (was "… polished top POL TOP").
  const size = baseSizeObj
    ? baseSizeObj.label.replace(/\s*polished\s+top\s*$/i, '').trim()
    : [ftIn(bc.width), ftIn(bc.depth)].filter(Boolean).join(' × ')
  const sidesSplit = bc.sides ? BASE_SIDES_SPLIT[bc.sides] : null
  const hOpt = (bc.heightCode != null) ? BASE_HEIGHTS.find(h => h.code === bc.heightCode) : null
  const topFinish = BASE_TOP_FINISH_LABEL[bc.topFinish] || (sidesSplit ? sidesSplit.top : '')
  // Prefer the OrderForm finish code, then a raw finish, then the split wizard back.
  const backFinish = BASE_BACK_FINISH_LABEL[bc.finish]
    || (bc.finish ? String(bc.finish) : '')
    || (sidesSplit ? sidesSplit.back : (bc.sides ? (BASE_SIDES_OPTIONS.find(s => s.code === bc.sides)?.label || '') : ''))
  const finishes = [
    topFinish,
    (hOpt && hOpt.upcharge > 0) ? `${hOpt.label} height` : '',
    bc.polishMargin2in ? '2" polished margin' : '',
    backFinish,
  ].filter(Boolean)
  if (!size) return finishes.join(', ') || 'Base'
  return finishes.length ? `${size} · ${finishes.join(', ')}` : size
}
