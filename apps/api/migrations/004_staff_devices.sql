-- Staff sign in with a 6-digit PIN, but only on a device the owner registered (design doc §9).
-- Devices are looked up by token before the shop is known, so this is a platform table (no RLS),
-- like tenant_members; every query filters by tenant_id itself.

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  terminal_id uuid REFERENCES terminals(id),     -- the till this device prints tax documents on
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,                -- sha256 of a 256-bit random token held in an httpOnly cookie
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX devices_tenant ON devices (tenant_id);

ALTER TABLE tenant_members
  ADD COLUMN pin_failed int NOT NULL DEFAULT 0,
  ADD COLUMN pin_locked_until timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

GRANT SELECT, INSERT, UPDATE ON devices TO prakai_app;
