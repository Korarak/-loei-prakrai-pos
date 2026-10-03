-- Split/merge bills, sub-recipes (prep items), PromptPay QR and partial credit notes.

-- ---------- bills ----------
-- merged_into: a bill folded into another; its lines moved there and it is closed as void.
-- split_from: a bill split off another table's bill; it has no table of its own (one open bill per table).
ALTER TABLE orders
  ADD COLUMN merged_into uuid REFERENCES orders(id),
  ADD COLUMN split_from uuid REFERENCES orders(id);

-- ---------- sub-recipes ----------
-- A prep item (น้ำจิ้ม, น้ำซุป) is an ingredient made in the shop from other ingredients.
-- It holds no stock: using it draws its components, so the ledger stays in purchased goods only.
ALTER TABLE ingredients
  ADD COLUMN is_prep boolean NOT NULL DEFAULT false,
  ADD COLUMN batch_yield numeric(14,4) CHECK (batch_yield > 0),     -- base units one batch of the prep makes
  ADD CONSTRAINT prep_has_yield CHECK (NOT is_prep OR batch_yield IS NOT NULL);

CREATE TABLE prep_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  prep_id uuid NOT NULL REFERENCES ingredients(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),                        -- usable base units per batch
  UNIQUE (prep_id, ingredient_id),
  CHECK (prep_id <> ingredient_id)
);
ALTER TABLE prep_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON prep_lines USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON prep_lines TO prakai_app;

-- ---------- PromptPay ----------
-- Phone (10 digits) or tax ID / national ID (13 digits) the shop receives PromptPay on.
ALTER TABLE tenants ADD COLUMN promptpay_id text CHECK (promptpay_id ~ '^(\d{10}|\d{13})$');

-- ---------- credit notes ----------
-- Credit notes may now credit part of a bill, so one document can have several; the API keeps the
-- credited quantities within what was sold.
DROP INDEX tax_documents_one_cn;
CREATE INDEX tax_documents_credits ON tax_documents (credits_doc_id) WHERE credits_doc_id IS NOT NULL;
