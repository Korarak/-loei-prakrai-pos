-- Shops manage their own floor plan. A table that has ever had a bill is retired, not deleted,
-- so past orders keep pointing at it.
ALTER TABLE dining_tables ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX dining_tables_active_name ON dining_tables (tenant_id, branch_id, name) WHERE active;
