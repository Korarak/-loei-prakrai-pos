-- Cash shifts per till (design doc §5 module 7), credit notes (§2.3) and kitchen-ticket batches.

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  terminal_id uuid NOT NULL REFERENCES terminals(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_float bigint NOT NULL CHECK (opening_float >= 0),
  opened_by uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  expected_cash bigint,                        -- frozen at close: float + cash sales + cash in − cash out
  counted_cash bigint CHECK (counted_cash >= 0),
  close_note text,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz,
  CHECK (status = 'open' OR (expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND closed_at IS NOT NULL))
);
-- one drawer, one open shift
CREATE UNIQUE INDEX shifts_one_open_per_terminal ON shifts (terminal_id) WHERE status = 'open';

CREATE TABLE cash_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants(id),
  shift_id uuid NOT NULL REFERENCES shifts(id),
  kind text NOT NULL CHECK (kind IN ('in','out')),
  amount bigint NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  ref_doc_id uuid REFERENCES tax_documents(id),   -- set for a cash refund against a credit note
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ADD COLUMN shift_id uuid REFERENCES shifts(id);
CREATE INDEX payments_shift ON payments (shift_id);

-- A credit note points at the document it corrects and says why (ป.รัษฎากร มาตรา 86/10).
ALTER TABLE tax_documents
  ADD COLUMN credits_doc_id uuid REFERENCES tax_documents(id),
  ADD COLUMN reason text,
  ADD CONSTRAINT cn_has_reference CHECK (doc_type <> 'CN' OR (credits_doc_id IS NOT NULL AND coalesce(reason, '') <> ''));
-- one credit note per document (the whole bill is credited)
CREATE UNIQUE INDEX tax_documents_one_cn ON tax_documents (credits_doc_id) WHERE status = 'issued';

-- Lines sent together print on one kitchen ticket.
ALTER TABLE order_lines ADD COLUMN sent_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts','cash_moves'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON shifts TO prakai_app;
GRANT SELECT, INSERT ON cash_moves TO prakai_app;
