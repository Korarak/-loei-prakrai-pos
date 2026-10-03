-- Two-step sign-in with an authenticator app (TOTP, RFC 6238) and a lockout on repeated wrong passwords.
-- Owners sign in from the internet once the shop is live, so a password alone is not enough protection.

ALTER TABLE users
  ADD COLUMN totp_secret text,                          -- base32; set once the first code is confirmed
  ADD COLUMN totp_pending text,                         -- secret shown during setup, until confirmed
  ADD COLUMN totp_last_step bigint,                     -- each code works once (no replay inside its 30 s window)
  ADD COLUMN totp_recovery text[] NOT NULL DEFAULT '{}', -- sha256 of the unused single-use recovery codes
  ADD COLUMN login_failed int NOT NULL DEFAULT 0,
  ADD COLUMN login_locked_until timestamptz;
