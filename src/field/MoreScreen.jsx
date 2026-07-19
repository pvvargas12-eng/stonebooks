// =============================================================================
// MoreScreen — every Stonebooks section, one tap from the phone
// =============================================================================
// Paul: "I want to be able to access all of my Stonebooks tabs on my phone."
// The bar carries the daily surfaces; everything else lives here. Each row
// opens the FULL desktop app at that tab in a new browser context (the field
// app stays put — on an installed PWA iOS shows a Done button to come back).
// Native phone versions of these surfaces get built as they earn their keep.
// =============================================================================

const SECTIONS = [
  ['customers',       'Customers',       'People, families, history'],
  ['payments',        'Payments',        'Money in, day by day'],
  ['cemetery-orders', 'Cemetery Orders', 'Door + crypt work'],
  ['scheduler',       'Scheduler',       'Build the week'],
  ['calendar',        'Calendar',        'Runs + deadlines'],
  ['email',           'Email',           'The shop inbox'],
  ['vendors',         'Vendors',         'Partner work queue'],
  ['profit',          'Profit',          'Job costs + margin'],
  ['reports',         'Reports',         'Numbers on demand'],
  ['catalog',         'Catalog',         'Designs + monuments'],
  ['reconcile',       'Reconcile',       'Deposits vs the books'],
  ['fixlog',          'Fix Log',         'What got fixed, when'],
  ['sales',           '+ New sale',      'The full sales wizard'],
  ['settings',        'Settings',        'Staff, pricing, options'],
]

export default function MoreScreen() {
  return (
    <div>
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>All of Stonebooks</div>
        <div className="fl-greet-sub">Opens the full desktop view in the browser — sign in if it asks.</div>
      </div>
      {SECTIONS.map(([key, name, sub]) => (
        <button key={key} type="button" className="fl-row fl-row-flex"
          onClick={() => window.open(`/?tab=${key}`, '_blank', 'noopener')}>
          <div className="fl-row-main">
            <div className="fl-fam" style={{ fontSize: 15.5 }}>{name}</div>
            <div className="fl-cem">{sub}</div>
          </div>
          <span className="fl-chev">&#8250;</span>
        </button>
      ))}
    </div>
  )
}
