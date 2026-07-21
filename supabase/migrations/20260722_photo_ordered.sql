-- Ceramic/porcelain photo ordering tracker (Admin Command Center): nothing
-- recorded "photo ordered" before. Set from the ACC photos lane.
alter table orders add column if not exists photo_ordered_at date;
alter table orders add column if not exists photo_ordered_by text;
