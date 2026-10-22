// Builds seed.sql (the D1 catalog) from pack-gz/manifest.json (gzip JSON / LUT data, WebP covers).
// Only the built-in library rows are replaced; music, sound effects and user templates stay.
// Usage: node cloud/seed.mjs  →  then: wrangler d1 execute kinora --remote --file cloud/seed.sql
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = path.join(here, '..', 'pack-gz');
const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'));
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const lines = ["DELETE FROM assets WHERE owner IS NULL AND kind IN ('stickers', 'effects', 'filters', 'transitions', 'animations', 'templates');"];
for (const a of manifest) {
  const size = fs.statSync(path.join(pack, a.file)).size;
  lines.push(`INSERT INTO assets (kind, id, name, category, sort, file, thumb, size, version, meta) VALUES (${q(a.kind)}, ${q(a.id)}, ${q(a.name)}, ${q(a.category)}, ${a.sort}, ${q(a.file)}, ${q(a.thumb)}, ${size}, ${a.version ?? 1}, ${q(JSON.stringify(a.meta))});`);
}
fs.writeFileSync(path.join(here, 'seed.sql'), lines.join('\n') + '\n');
console.log(`seed.sql: ${manifest.length} assets`);
