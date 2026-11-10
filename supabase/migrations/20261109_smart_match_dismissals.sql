-- SMART-WALK (2026-11-09): Paul can DISMISS a Smart Matches card ("i want a
-- dismiss button") without saying anything about the stone. One row per need
-- key (`<order_id>:stone|base|backer`); restoring deletes the row. The order's
-- own piece statuses are untouched — a dismissal only hides the card.

CREATE TABLE IF NOT EXISTS smart_match_dismissals (
  need_key      text PRIMARY KEY,
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  kind          text,
  reason        text,
  dismissed_by  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smart_match_dismissals_order ON smart_match_dismissals(order_id);

ALTER TABLE smart_match_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS smart_match_dismissals_authenticated_all ON smart_match_dismissals;
CREATE POLICY smart_match_dismissals_authenticated_all
  ON smart_match_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE smart_match_dismissals IS
  'Smart Matches cards the office dismissed by hand. Hides the card only; order piece statuses are not touched.';
