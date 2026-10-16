-- Shop logo: shown in the app header and on receipts. Purely cosmetic; legal seller details stay in tax_documents.seller.
ALTER TABLE tenants ADD COLUMN logo_url text;
ALTER TABLE tenants ADD COLUMN logo_on_receipt boolean NOT NULL DEFAULT true;
