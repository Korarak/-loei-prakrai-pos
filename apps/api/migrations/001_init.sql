-- prakai-pos schema v1: multi-tenant POS with Thai tax documents.
-- Shop data is isolated by Row-Level Security on tenant_id (design doc §10.1).
-- Money columns are bigint satang; rates are integer basis points (700 = 7%).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The API connects as prakai_app: not a table owner and no BYPASSRLS,
-- so every policy below applies to it even if a query forgets to filter.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prakai_app') THEN
    CREATE ROLE prakai_app LOGIN;
  END IF;
END $$;

CREATE FUNCTION current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------- platform-wide tables (no RLS) ----------

CREATE TABLE tax_rates (
  id serial PRIMARY KEY,
  rate_bp int NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  valid_from date NOT NULL,
  valid_to date,
  legal_ref text
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  phone text,
  name text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','pending','suspended','closed')),
  trial_ends_at date,
  legal_name text,
  tax_id text,
  address text,
  vat_registered boolean NOT NULL DEFAULT false,
  vat_registered_at date,
  price_includes_vat boolean NOT NULL DEFAULT true,
  service_charge_bp int NOT NULL DEFAULT 0 CHECK (service_charge_bp BETWEEN 0 AND 2000),
  cash_rounding text NOT NULL DEFAULT 'none' CHECK (cash_rounding IN ('none','down-baht','down-25')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','kitchen')),
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);

-- ---------- shop data (RLS by tenant) ----------

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  branch_code text NOT NULL DEFAULT '00000' CHECK (branch_code ~ '^\d{5}$'),
  address text
);

CREATE TABLE terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  code text NOT NULL DEFAULT 'P1',            -- printed prefix of document numbers
  rd_pos_id text,                             -- Revenue Department POS ID; null = not approved
  serial_no text,
  grand_total bigint NOT NULL DEFAULT 0,      -- never reset (ประกาศอธิบดีฯ VAT ฉบับที่ 46)
  UNIQUE (tenant_id, code)
);

CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  category_id uuid REFERENCES menu_categories(id),
  name text NOT NULL,
  price bigint NOT NULL CHECK (price >= 0),
  vat_exempt boolean NOT NULL DEFAULT false,
  station text NOT NULL DEFAULT 'kitchen',
  image_url text,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  seats int NOT NULL DEFAULT 4,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  table_id uuid REFERENCES dining_tables(id),
  bill_no serial,
  channel text NOT NULL DEFAULT 'dine_in' CHECK (channel IN ('dine_in','takeaway','delivery')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  guests int NOT NULL DEFAULT 1,
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')),
  discount_value bigint NOT NULL DEFAULT 0,
  opened_by uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
-- at most one open order per table
CREATE UNIQUE INDEX orders_one_open_per_table ON orders (table_id) WHERE status = 'open' AND table_id IS NOT NULL;

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  menu_item_id uuid REFERENCES menu_items(id),
  name text NOT NULL,
  unit_price bigint NOT NULL,
  qty int NOT NULL CHECK (qty > 0),
  vat_exempt boolean NOT NULL DEFAULT false,
  note text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','void')),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  method text NOT NULL CHECK (method IN ('cash','promptpay','card','transfer')),
  amount bigint NOT NULL CHECK (amount > 0),   -- applied to the bill
  tendered bigint,                             -- cash handed over
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doc_sequences (
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  terminal_id uuid NOT NULL REFERENCES terminals(id),
  doc_type text NOT NULL,
  period text NOT NULL,                        -- BE month, e.g. 2569-09
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, terminal_id, doc_type, period)
);

CREATE TABLE tax_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  terminal_id uuid NOT NULL REFERENCES terminals(id),
  order_id uuid REFERENCES orders(id),
  doc_type text NOT NULL CHECK (doc_type IN ('ABB','FULL','RECEIPT','CN')),
  doc_no text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  vat_rate_bp int NOT NULL,
  gross bigint NOT NULL,
  discount bigint NOT NULL,
  vatable_base bigint NOT NULL,
  exempt_base bigint NOT NULL,
  service_charge bigint NOT NULL,
  vat bigint NOT NULL,
  total bigint NOT NULL,
  rounding bigint NOT NULL DEFAULT 0,
  lines jsonb NOT NULL,                         -- frozen copy of what was sold
  seller jsonb NOT NULL,                        -- frozen seller name/tax id/branch/POS ID
  buyer_name text,
  buyer_tax_id text,
  buyer_branch text,
  buyer_address text,
  replaces_doc_id uuid REFERENCES tax_documents(id),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  void_reason text,
  voided_by uuid REFERENCES users(id),
  voided_at timestamptz,
  created_by uuid REFERENCES users(id),
  UNIQUE (tenant_id, terminal_id, doc_type, doc_no),
  CHECK (doc_type <> 'FULL' OR (buyer_name IS NOT NULL AND buyer_tax_id IS NOT NULL AND buyer_address IS NOT NULL))
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  hash text
);

-- ---------- tax documents and audit log are append-only ----------

CREATE FUNCTION tax_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tax documents cannot be deleted';
  END IF;
  -- the only permitted change: issued -> void with a reason
  IF OLD.status = 'issued' AND NEW.status = 'void' AND coalesce(NEW.void_reason, '') <> ''
     AND (to_jsonb(NEW) - '{status,void_reason,voided_by,voided_at}'::text[])
       = (to_jsonb(OLD) - '{status,void_reason,voided_by,voided_at}'::text[]) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tax documents are immutable; only voiding with a reason is allowed';
END $$;
CREATE TRIGGER tax_documents_guard BEFORE UPDATE OR DELETE ON tax_documents
  FOR EACH ROW EXECUTE FUNCTION tax_documents_guard();

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'audit log is append-only';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.tenant_id::text));
  SELECT hash INTO NEW.prev_hash FROM audit_log WHERE tenant_id = NEW.tenant_id ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(digest(concat_ws('|', NEW.prev_hash, NEW.tenant_id, NEW.user_id, NEW.action,
                     NEW.entity, NEW.entity_id, NEW.detail::text, NEW.at), 'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT OR UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- ---------- RLS ----------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','terminals','menu_categories','menu_items','dining_tables','orders',
                           'order_lines','payments','doc_sequences','tax_documents','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO prakai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prakai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prakai_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO prakai_app;
-- audit rows are insert-only for the app as well (trigger is the second line of defence)
REVOKE UPDATE, DELETE ON audit_log FROM prakai_app;
REVOKE DELETE ON tax_documents FROM prakai_app;

INSERT INTO tax_rates (rate_bp, valid_from, valid_to, legal_ref) VALUES
  (700, '2025-10-01', '2026-09-30', 'พ.ร.ฎ. ลดอัตรา VAT (ฉบับก่อนหน้า)'),
  (700, '2026-10-01', '2027-09-30', 'พ.ร.ฎ. ฉบับที่ 807 พ.ศ. 2569');
