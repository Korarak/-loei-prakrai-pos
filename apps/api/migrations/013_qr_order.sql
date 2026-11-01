-- QR ordering at the table: a customer scans the sticker on their table, picks dishes, and the order
-- waits here until staff accept it onto the table's open bill (or reject it).
--
-- Table links are signed: HMAC-SHA256(qr_secret, "<slug>:<table id>"). Nothing in the link can be guessed
-- or edited, and the owner can rotate qr_secret to kill every printed sticker at once.

ALTER TABLE tenants
  ADD COLUMN qr_secret text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ADD COLUMN qr_order_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE qr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  table_id uuid NOT NULL REFERENCES dining_tables(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  order_id uuid REFERENCES orders(id)
);
CREATE INDEX qr_requests_pending ON qr_requests (tenant_id, created_at) WHERE status = 'pending';

-- Prices are frozen at the moment the customer ordered so the staff screen shows what the customer saw;
-- accepting re-prices from the live menu, so a price change between the two is never silently ignored.
CREATE TABLE qr_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES qr_requests(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id),
  name text NOT NULL,
  unit_price bigint NOT NULL,
  qty int NOT NULL CHECK (qty > 0),
  note text,
  options jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX qr_request_lines_request ON qr_request_lines (request_id);

ALTER TABLE qr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_request_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qr_requests USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY tenant_isolation ON qr_request_lines USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON qr_requests, qr_request_lines TO prakai_app;
