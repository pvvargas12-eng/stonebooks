-- 2026-08-26 — signature_requests.kind: what document the link signs.
-- 'contract' (default — every existing row) | 'permit' (Permit Builder e-sign,
-- PB-ESIGN). signing-submit branches on it: permit signings do NOT flip the
-- order to contracted; the signed permit lands in the order's attachments.
alter table signature_requests add column if not exists kind text not null default 'contract';
