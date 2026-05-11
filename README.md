# Shevchenko Memorials — Catalog

Internal catalog browser for the Shevchenko monument inventory. Reads from the
`monuments` table populated by the GOD Mode tagger, and lets sales staff search
and filter by carve type, granite color, motifs, categories, and family name.

This is **Phase 1** of the sales portal. The CRM (customers, orders, invoicing)
will be layered on top of this foundation later.

---

## 1. Setup (first time, ~5 minutes)

### Prereqs
- Node.js 20 or newer (`node --version` to check)
- A Supabase project with the `monuments` table populated by the tagger

### Install

```bash
npm install
```

### Configure environment

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Then open `.env.local` and paste in:
- `VITE_SUPABASE_URL` — from Supabase → Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY` — from Supabase → Settings → API → `anon` `public` key

> The `anon` key is **safe** to expose in the browser. Do **not** use the
> `service_role` key — that one bypasses all security.

### Allow the catalog to read the monuments table

By default, Supabase locks tables behind Row Level Security. Run the SQL in
`supabase/monuments_read_policy.sql` in your Supabase SQL Editor. It enables
RLS with a public-read policy — uploads from the tagger keep working because
the tagger uses the service_role key, but the browser can now read the catalog.

### Run it

```bash
npm run dev
```

Opens at <http://localhost:5173>. You should see your monuments load.

---

## 2. Deploy to Vercel

This repo is already wired to a Vercel project (`shevchenko-catalog`). To deploy:

1. Commit and push to GitHub (`master` branch).
2. Vercel auto-builds and deploys.
3. **Crucial:** add the env vars in Vercel → Project → Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Add to all three environments (Production / Preview / Development).
4. Trigger a redeploy from Vercel after adding env vars (otherwise build still uses the empty values).

---

## 3. How it works

```
┌─────────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  GOD Mode Tagger    │ writes │  Supabase        │ reads  │  Catalog browser │
│  (separate app)     │ ─────► │  monuments table │ ─────► │  (this app)      │
└─────────────────────┘        └──────────────────┘        └──────────────────┘
```

The tagger writes records like:
```json
{
  "id": "R1729800000123",
  "lastname": "PETROV",
  "name": "Twin uprights with cross",
  "img": "https://drive.google.com/thumbnail?id=...&sz=w800",
  "carve_type": "upright-double",
  "granite_color": "Black",
  "cats": ["religious", "traditional"],
  "tags": ["cross", "roses", "praying-hands"],
  "badge": "FEATURED",
  "description": "...",
  "meta": { "Family": "PETROV", "Layout": "Double", ... }
}
```

The catalog reads these records and provides:
- Faceted filtering (type / granite / motifs / categories / badge)
- Full-text search across name, description, tags
- Detail view with all metadata

---

## 4. What's next (CRM phase)

The catalog browser is the foundation. The next phases layer on top:

- **Phase 2 — Customers + Orders.** Tie monuments to specific orders, track
  pipeline (lead → quote → design → production → install).
- **Phase 3 — Invoicing.** Estimates, deposits, payment tracking, QuickBooks
  sync.
- **Phase 4 — Communication.** Email integration, family-facing portal,
  AI-drafted replies.

When the CRM phase begins, the "Attach to Order" button in the detail panel
becomes functional.

---

## 5. Troubleshooting

**"Supabase not configured"** — `.env.local` is missing or doesn't have both
vars. Copy from `.env.example` and restart `npm run dev`.

**"Couldn't load catalog: permission denied for table monuments"** — RLS is on
but no read policy exists. Run `supabase/monuments_read_policy.sql`.

**Catalog is empty even though the tagger uploaded photos** — verify in
Supabase Table Editor that records are actually in `public.monuments`. If they
went to a different schema, update the table reference in `src/App.jsx`.

**Drive thumbnails don't load** — the Drive files must be set to "Anyone with
the link can view." Right-click the file in Drive → Share → change to
"Anyone with the link." This is a Drive permission issue, not a portal bug.

**Vercel build succeeds but the site shows "Supabase not configured"** — env
vars not set in Vercel project settings, or set but not redeployed. Add them
in Settings → Environment Variables, then trigger a redeploy.
