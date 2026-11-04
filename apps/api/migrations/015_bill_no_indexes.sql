-- 1) Bill numbers count per shop. They used to come from one sequence shared by every shop, so a new shop
--    started at a random number and saw gaps. Existing numbers are kept; a shop's next bill is its highest + 1.
CREATE UNIQUE INDEX orders_bill_no ON orders (tenant_id, bill_no);

CREATE FUNCTION orders_bill_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bill:' || NEW.tenant_id::text));
  SELECT coalesce(max(bill_no), 0) + 1 INTO NEW.bill_no FROM orders WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_bill_no BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_bill_no();

-- 2) Indexes for the lookups every screen and report makes (foreign keys have none by default).
CREATE INDEX order_lines_order ON order_lines (order_id);
CREATE INDEX payments_order ON payments (order_id);
CREATE INDEX orders_closed ON orders (tenant_id, closed_at);
CREATE INDEX tax_documents_issued ON tax_documents (tenant_id, issued_at);
CREATE INDEX tax_documents_order ON tax_documents (order_id);
CREATE INDEX purchase_lines_purchase ON purchase_lines (purchase_id);
CREATE INDEX expenses_month ON expenses (tenant_id, month);
CREATE INDEX cash_moves_shift ON cash_moves (shift_id);
CREATE INDEX modifiers_group ON modifiers (group_id);
