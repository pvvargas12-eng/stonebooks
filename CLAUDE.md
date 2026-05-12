# Stonebooks CRM — Shevchenko Monuments

Staff-facing CRM for Shevchenko Monuments (Perth Amboy, NJ, est. 1919).
React + Supabase. Internal use only.

## Operational locks

- Shevchenko tenant UUID: `a1b2c3d4-e5f6-7890-abcd-ef0123456789` (default for every new `tenant_id` column)
- NJ sales tax: 6.625%
- Sprint naming convention: `3o → 3p → 3q`
- Design tokens: Inter + JetBrains Mono, bronze accent on near-black `#0F1419` sidebar
- Staff never touch Supabase directly — all DB ops go through the app
- Photo storage: Supabase Storage bucket `key photos` (URLs already live; slugify filenames before SaaS launch)
- Base sizing math: round up to nearest whole inch; supplier cuts to whatever spec we give

## Workflow rules (important — follow these)

- **Plan before code.** Always describe the change before writing it.
- **Wait for explicit "go"** before editing files. Don't start patching just because the plan was acknowledged.
- **One thing at a time.** Don't bundle multiple bugs or features into one patch.
- **Confirm file receipts by name** when files are shared.
- **Ship as zips with non-technical install steps** for the user (Paul) to apply.

## Stack

- Frontend: React (Vite), single-page app
- Backend: Supabase (Postgres + Auth + Storage)
- Hosting: Vercel (old `shevchenko-catalog.vercel.app` is stale; new deploys not yet wired)
- Key file: `src/SalesMode.jsx` is ~11k lines and holds the sales wizard

## What's shipped

- Today dashboard with action items
- Customers, Orders, Calendar (cemetery deadlines + target dates)
- Reports
- Full Sales wizard
- Theming, auth

## Current sprint — 3o (in progress)

Four items, not yet shipped:

1. **Shape Carved bug** — prices/clicking broken
2. **Laser Etching bug** — add-on broken entirely
3. **Hand Sculpted photo** — drop key photo into existing card
4. **Laser Etching photo** — drop key photo into existing card

Photo URLs (note the spacing/casing — fine for now, slugify before SaaS):

- Hand Sculpted: `hand sculpted key photo.jpg`
- Laser Etching: `laser-etching-key photo.jpg`
- BLING: `key bling photo .jpg` (trailing space)
- Vase: `Vase Key Photo .jpg` (trailing space)

Full Supabase URLs:
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/hand%20sculpted%20key%20photo.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/laser-etching-key%20photo.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/key%20bling%20photo%20.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Vase%20Key%20Photo%20.jpg

## Next sprint — 3p (fully spec'd, ready to start)

Add Vase + BLING as add-on cards #5 and #6. Categories will be: Flat Carve, Shape Carve, Hand Sculpted, Laser Etching, Vase, BLING.

### Phases

- **3p.1** — Add `MARKETING_PHOTOS` constants block. Refactor existing hand-sculpted and laser-etching photos to read from it. Add BLING and Vase as cards #5 and #6 in the add-ons grid (photo + name only, click opens "coming soon" placeholder modal).
- **3p.2** — BLING configurator: 3 sizes (Small $695, Medium $745, Large $795), 21-color picker, defaults to "match stone color" with inline "change" link (Pattern A).
- **3p.3** — Vase configurator. Three-step flow: size → shape → color. 6 sizes (text options, recommended size pre-selected based on die size). 17 unique shape thumbnails on the shape step regardless of size. Color step defaults to stone match, inline change opens 21-color picker.

### Vase pricing (locked)

| Size | Volume (ci) | Price |
|---|---|---|
| 4×4×10 | 160 | $195 |
| 5×4×9 | 180 | $210 |
| 5×5×9 | 225 | $250 |
| 6×6×10 | 360 | $375 |
| 8×6×10 | 480 | $475 |
| 8×8×12 | 768 | $725 |

### Vase color upcharge

Granite schedule: Jet Black +25%, Bahama Blue +30%, Imperial Red / Mahogany / Royal Pink / Cats Eye +35%, rest at base.

### Vase shape thumbnails (17 unique URLs)

https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/4-4-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/5-5-9-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/6-6-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/8-6-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/8-8-1-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape1-258x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape2-288x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape3-298x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape4-293x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape5-360x270.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape6-305x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape7-281x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape8-291x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape9-241x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape10-296x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape11-298x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape12-300x405.png

### Vase fit verification math

- 1 vase: `base_W ≥ die_W + vase_W + 3"` (minimum); recommendation aims for 2" per gap → `ceil(die_W + vase_W + 4)`
- 2 vases (symmetric layout `[outer][vase][gap][die][gap][vase][outer]`): minimum `base_W ≥ die_W + 2×vase_W + 6"`; recommendation `ceil(die_W + 2×vase_W + 8)`
- Depth: `base_D ≥ vase_D + 2"`
- Reactive fit indicators on each size: ✓ green / ⚠ yellow tight / ✗ red disabled with "Increase base to X" caption
- "Recommended" badge on the largest size that gets ✓; that size is the default selection
- Warning popup if below 1.5" clearance — Adjust / Override; override prepends to order notes

## Available base widths

Supplier cuts to whatever spec we give. Recommendation rounds up to nearest whole inch.

## Open items still needing Paul's input

- BLING Medium and Large prices confirmation (current assumption: $745 / $795)
- BLING shapes catalog + reference photos
- Zelle QR upload (for 3q Zelle integration)
- baseWidth migration strategy for existing pre-3p uprights (options: derive/backfill, leave null and prompt, or default to die_W + 12" adjustable)

## Feature backlog after 3p

1. Zelle integration
2. Sign step restructure (preview first, then signature)
3. Hand Sculpted quote-request flow
4. Remote contract signing

## Git / GitHub

- GitHub repo: https://github.com/pvvargas12-eng/stonebooks (private)
- Branch: `main`
- First commit on 2026-05-11 captured the project at end of Sprint 3o
