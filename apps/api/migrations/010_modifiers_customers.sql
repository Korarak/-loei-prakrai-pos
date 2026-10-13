-- prakai-pos schema v10: menu options (modifiers) and the customer book.
-- A group is a question on a dish ("ระดับเผ็ด", "ท็อปปิ้ง"); its options may add to the price and to the
-- ingredients drawn from stock. Options are never deleted (orders keep a frozen copy), only deactivated.

CREATE TABLE modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  min_select int NOT NULL DEFAULT 0 CHECK (min_select >= 0),     -- 1 = the cashier must choose
  max_select int NOT NULL DEFAULT 1 CHECK (max_select >= 1),     -- 1 = pick one, >1 = checkboxes
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  CHECK (min_select <= max_select)
);

CREATE TABLE modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  group_id uuid NOT NULL REFERENCES modifier_groups(id),
  name text NOT NULL,
  price bigint NOT NULL DEFAULT 0 CHECK (price >= 0),            -- satang added to the dish price
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0
);

-- Extra usable base units per serving when this option is chosen (e.g. +1 egg).
CREATE TABLE modifier_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  modifier_id uuid NOT NULL REFERENCES modifiers(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  UNIQUE (modifier_id, ingredient_id)
);

CREATE TABLE menu_item_modifier_groups (
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id),
  group_id uuid NOT NULL REFERENCES modifier_groups(id),
  sort int NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, group_id)
);

-- [{id, name, price}] as chosen; unit_price already includes the sum of the option prices.
ALTER TABLE order_lines ADD COLUMN options jsonb NOT NULL DEFAULT '[]';

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  name text NOT NULL,
  tax_id text NOT NULL,
  branch text NOT NULL DEFAULT '00000',
  address text NOT NULL,
  phone text,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tax_id, branch)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['modifier_groups','modifiers','modifier_ingredients','menu_item_modifier_groups','customers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prakai_app', t);
  END LOOP;
END $$;
