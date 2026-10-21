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
