-- Kinora asset catalog. Each row points at a file in the kinora-assets R2 bucket.
CREATE TABLE IF NOT EXISTS assets (
  kind TEXT NOT NULL,          -- stickers | effects | filters | transitions | templates
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL,          -- R2 key of the asset itself (what "download" saves)
  thumb TEXT,                  -- R2 key of the tile picture
  size INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  meta TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS assets_kind_sort ON assets (kind, sort);

-- User templates (Templates › Yours): owner = SHA-256 of the device's secret; NULL for the public library.
ALTER TABLE assets ADD COLUMN owner TEXT;
ALTER TABLE assets ADD COLUMN created INTEGER;
CREATE INDEX IF NOT EXISTS assets_owner ON assets (owner, created);

-- Template-creation counts per day, summed over 7 days for the weekly limit (Templates › Create template). key = 'dev:<owner hash>' or
-- 'ip:<IP hash>'; day = UTC date. Rows only ever count up, so deleting doesn't refund.
CREATE TABLE IF NOT EXISTS template_quota (key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, day));
