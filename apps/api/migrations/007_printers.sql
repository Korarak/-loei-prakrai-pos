-- LAN receipt/kitchen printers (design doc §6: 80 mm ESC/POS over LAN, Thai sent as raster).
-- The server cannot reach a shop's LAN, so a print agent on a shop PC polls for jobs over HTTPS
-- and forwards each bitmap to the printer on port 9100. Browsers render tickets to 1-bit bitmaps.

CREATE TABLE printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  host text NOT NULL,                                       -- LAN address as the agent sees it
  port int NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
  width_px int NOT NULL DEFAULT 576 CHECK (width_px IN (384, 576)),   -- 58 mm / 80 mm at 203 dpi
  role text NOT NULL CHECK (role IN ('receipt','kitchen','bar')),
  terminal_id uuid REFERENCES terminals(id),                -- receipt printer of one till; null = any till
  kick_drawer boolean NOT NULL DEFAULT false,               -- cash drawer is wired to this printer
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Agents are looked up by token before the shop is known, so this is a platform table (no RLS),
-- like devices; every query filters by tenant_id itself.
CREATE TABLE print_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX print_agents_tenant ON print_agents (tenant_id);

CREATE TABLE print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  printer_id uuid NOT NULL REFERENCES printers(id),
  kind text NOT NULL CHECK (kind IN ('receipt','kitchen','test')),
  width int NOT NULL,
  height int NOT NULL CHECK (height BETWEEN 1 AND 6000),
  bitmap bytea NOT NULL,                                    -- 1 bit per pixel, rows of ceil(width/8) bytes, MSB = left, 1 = black
  kick_drawer boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','done','failed')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  agent_id uuid REFERENCES print_agents(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  CHECK (length(bitmap) = ((width + 7) / 8) * height)
);
CREATE INDEX print_jobs_queue ON print_jobs (tenant_id, created_at) WHERE status IN ('queued','printing');

ALTER TABLE printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON printers USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON print_jobs USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

GRANT SELECT, INSERT, UPDATE ON printers, print_jobs TO prakai_app;
GRANT SELECT, INSERT, UPDATE ON print_agents TO prakai_app;
