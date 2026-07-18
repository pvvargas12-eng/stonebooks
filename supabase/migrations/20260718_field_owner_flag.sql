-- =============================================================================
-- FIELD-2 (2026-07-18) — owner flag on employees
-- =============================================================================
-- The redesigned /field app resolves its build (owner vs crew) from the person
-- picked at sign-in. Owner build shows money (balances, LEAD amounts); crew
-- build renders none of it. Flag lives on the employees roster so the desktop
-- Settings > Staff owner toggle drives it.
-- Applied to prod via the Management API on 2026-07-18 (Paul = true).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

UPDATE employees SET is_owner = true WHERE name = 'Paul';
