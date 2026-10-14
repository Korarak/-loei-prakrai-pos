-- No free-trial period any more: every shop is simply active until an operator suspends it.
UPDATE tenants SET status = 'active' WHERE status = 'trial';
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('active', 'pending', 'suspended', 'closed'));
ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE tenants DROP COLUMN trial_ends_at;
