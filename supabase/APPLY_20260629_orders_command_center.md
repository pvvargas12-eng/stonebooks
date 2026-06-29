# Apply: Orders Command-Center migrations (2026-06-29)

Three small migrations. Apply them in **Supabase Studio → SQL Editor** (you must be
signed in — these tables are RLS-protected). Order does **not** matter; each is
idempotent (safe to re-run). Takes ~1 minute total.

---

## Migration 1 — Permit soft fields (`permit_meta`)

Open **`supabase/migrations/20260629_orders_permit_meta.sql`**, copy its contents
into the SQL Editor, and click **Run**.

What it does: adds one column, `orders.permit_meta` (a JSON blob), to hold the
permit *type* and the two *notes* fields. Nothing else changes; existing orders get
an empty `{}`.

---

## Migration 2 — Permit-expense dedup key (`source_permit_key`)

Open **`supabase/migrations/20260629_outgoing_payments_source_permit_key.sql`**,
copy, **Run**.

What it does: adds a column to the **outgoing-payments** (money-out) table so the
same permit fee can never be recorded twice. This is the database guarding your
money, not the app. It does **not** touch customer payments or balances.

---

## Migration 3 — Permit-status safety (free-text)

**Optional verify first.** If you want to *see* whether a hidden rule on the permit
status exists, paste just this SELECT and **Run** it:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.orders'::regclass
  and contype = 'c'
  and pg_get_constraintdef(oid) ilike '%permit_status%';
```

- **Empty result** → nothing to fix; you can skip migration 3 entirely (or run it,
  it just does nothing).
- **A row comes back** → a hidden rule exists and would block the two new permit
  statuses. Run migration 3 to clear it.

To apply: open **`supabase/migrations/20260629_permit_status_drop_check.sql`**,
copy, **Run**. It safely removes any such rule and adds none.

---

## After all three

That's it — no data cleanup needed. Old orders that said "Required" will simply show
as **"Permit Needed"** in the app (they still count as needing a permit). Everything
else works immediately.
