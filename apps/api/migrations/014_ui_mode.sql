-- Simple mode: a shop that wants "sell, take money, see today's sales" and nothing else.
-- It only changes what the app shows and a few defaults (shift opens by itself); no table is dropped or
-- forked, so a shop can switch between the two at any time without losing data.
ALTER TABLE tenants
  ADD COLUMN ui_mode text NOT NULL DEFAULT 'full' CHECK (ui_mode IN ('simple', 'full'));
