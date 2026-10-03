-- prakai-pos schema v2: ingredients, recipes, purchases, stock ledger, expenses (design doc §4, §7).
-- Quantities are numeric(14,4) in the ingredient's base unit (g / ml / pc).
-- Ingredient costs are bigint "micro" = 1/10,000 satang per base unit, so 0.0033 baht/ml survives.

CREATE TABLE ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'food' CHECK (kind IN ('food','beverage','packaging')),
  base_unit text NOT NULL CHECK (base_unit IN ('g','ml','pc')),
  purchase_unit text NOT NULL,                       -- กก., แกลลอน, แผง
  purchase_factor numeric(14,4) NOT NULL CHECK (purchase_factor > 0),  -- base units per purchase unit
  yield_pct int NOT NULL DEFAULT 100 CHECK (yield_pct BETWEEN 1 AND 100),
  avg_cost bigint NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  on_hand numeric(14,4) NOT NULL DEFAULT 0,          -- kept in step with stock_movements in the same transaction
  reorder_point numeric(14,4) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name)
);

-- qty = usable base units per serving; stock is drawn at qty ÷ yield.
CREATE TABLE recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  UNIQUE (menu_item_id, ingredient_id)
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  purchased_on date NOT NULL,
  supplier_name text NOT NULL,
  supplier_tax_id text,
  supplier_branch text,
  invoice_no text,
  vat_mode text NOT NULL CHECK (vat_mode IN ('none','included','excluded')),
  vat_claimable boolean NOT NULL,                    -- full tax invoice + VAT-registered shop → input VAT credited on ภ.พ.30
  subtotal bigint NOT NULL,                          -- ex-VAT
  input_vat bigint NOT NULL,
  total bigint NOT NULL,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT vat_claimable OR (supplier_tax_id IS NOT NULL AND invoice_no IS NOT NULL))
);

CREATE TABLE purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  purchase_id uuid NOT NULL REFERENCES purchases(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),         -- purchase units as on the invoice
  base_qty numeric(14,4) NOT NULL CHECK (base_qty > 0),
  amount bigint NOT NULL CHECK (amount >= 0),         -- as written on the invoice
  cost bigint NOT NULL,                               -- what enters stock value
  unit_cost bigint NOT NULL                           -- micro per base unit
);

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  counted_at timestamptz NOT NULL DEFAULT now(),
  counted_by uuid REFERENCES users(id),
  note text
);

CREATE TABLE stock_count_lines (
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  count_id uuid NOT NULL REFERENCES stock_counts(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  system_qty numeric(14,4) NOT NULL,
  counted_qty numeric(14,4) NOT NULL CHECK (counted_qty >= 0),
  unit_cost bigint NOT NULL,
  PRIMARY KEY (count_id, ingredient_id)
);

-- The stock ledger. Insert-only; on-hand quantities are derived from it.
CREATE TABLE stock_movements (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  kind text NOT NULL CHECK (kind IN ('purchase','sale','waste','adjust')),
  qty numeric(14,4) NOT NULL,                        -- signed: + in, − out
  unit_cost bigint NOT NULL,
  value bigint NOT NULL,                             -- signed satang
  ref_type text,
  ref_id uuid,
  reason text,
  created_by uuid REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'waste' OR coalesce(reason, '') <> '')
);
CREATE INDEX stock_movements_at ON stock_movements (tenant_id, at);

CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION append_only();

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),   -- month the cost belongs to (Gregorian, like reports)
  paid_on date NOT NULL,
  category text NOT NULL CHECK (category IN ('labor','rent','utilities','packaging','fees','marketing','other')),
  description text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),             -- cost to the shop, ex claimable VAT
  input_vat bigint NOT NULL DEFAULT 0 CHECK (input_vat >= 0),
  wht_rate_bp int NOT NULL DEFAULT 0 CHECK (wht_rate_bp BETWEEN 0 AND 1500),
  wht_amount bigint NOT NULL DEFAULT 0,
  payee_name text,
  payee_tax_id text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Frozen at payment so later price changes never rewrite past margins (design doc §4).
ALTER TABLE order_lines ADD COLUMN net_ex_vat bigint, ADD COLUMN cost_snapshot bigint;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ingredients','recipe_lines','purchases','purchase_lines','stock_counts',
                           'stock_count_lines','stock_movements','expenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredients, recipe_lines, purchases, purchase_lines, stock_counts,
  stock_count_lines, expenses TO prakai_app;
GRANT SELECT, INSERT ON stock_movements TO prakai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prakai_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO prakai_app;
-- purchases are evidence for input VAT (ม.87): no deletes by the app
REVOKE DELETE ON purchases, purchase_lines, stock_counts, stock_count_lines FROM prakai_app;
REVOKE UPDATE ON purchases, purchase_lines, stock_count_lines FROM prakai_app;
