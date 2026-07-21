-- Which permit blank an order uses: 'cemetery' (their own form) or 'shevco'
-- (our form). Selecting shevco auto-tasks Admin to build it in Permit Builder.
alter table orders add column if not exists permit_form text;
