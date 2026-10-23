-- The catalogue becomes operator-editable.
--
-- commerce.catalog only carried a price. The operator needs to change the
-- price, the wording and whether a service is offered at all, so the table
-- gains the descriptive fields the public site shows. Existing rows keep
-- working: the added columns are nullable and the site falls back to the
-- archived definition when they are empty.
ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS game TEXT;
ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE commerce.catalog ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
