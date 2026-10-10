-- Platform operator view of sign-ups: last sign-in per person, a private note and the time of the last status change per shop.
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE tenants ADD COLUMN admin_note text;
ALTER TABLE tenants ADD COLUMN status_changed_at timestamptz;
CREATE INDEX audit_log_tenant_at ON audit_log (tenant_id, id DESC);
