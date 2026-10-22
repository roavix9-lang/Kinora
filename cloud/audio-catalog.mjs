// Builds the Audio tab catalog (music + sound effects) from Openverse, keeping only licenses
// that allow use in any video and redistribution: CC0 and CC BY. Only metadata goes into D1;
// the files stay on their source sites (Jamendo, Freesound, ...).
// Usage: node cloud/audio-catalog.mjs  →  cloud/audio-seed.sql
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://api.openverse.org/v1/audio/';
const PER = 10;

// Each category tries its search words in order until it has enough tracks.
const MUSIC = {
  Vlog: ['happy', 'upbeat', 'acoustic'], 'Hip hop': ['hip hop', 'rap'], 'Lo-fi': ['lofi', 'chill', 'jazz'], Cinematic: ['cinematic', 'epic', 'orchestral'],
  Funny: ['funny', 'comedy', 'quirky'], Electronic: ['electronic', 'techno', 'house'], Pop: ['pop'], Rock: ['rock'],
  Fitness: ['workout', 'energetic', 'dance'], Travel: ['travel', 'world', 'adventure'], Romantic: ['romantic', 'love', 'piano'], Ambient: ['ambient', 'relaxing'],
};
const SOUNDS = {
  Whoosh: ['whoosh'], Transition: ['swoosh', 'transition'], Click: ['click'], Notification: ['notification', 'ding'],
  Applause: ['applause'], Laugh: ['laugh'], Camera: ['camera shutter'], Explosion: ['explosion'], Nature: ['birds', 'rain'], Magic: ['magic', 'sparkle'],
};

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term, params) {
  const url = `${API}?${new URLSearchParams({ q: term, license: 'cc0,by', page_size: '20', ...params })}`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) { await sleep(res.status === 429 ? 15000 : 3000); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()).results;
  }
  console.warn(`skipped (server busy): ${term}`);
  return [];
}

const rows = [];
const seen = new Set();
async function collect(kind, cats, params, ok) {
  let sort = 0;
  for (const [cat, terms] of Object.entries(cats)) {
    let n = 0;
    for (const term of terms) {
    if (n >= PER) break;
    const res = await search(term, params);
    await sleep(1200);
    for (const r of res) {
      if (n >= PER || seen.has(r.id) || !r.url || !ok(r)) continue;
      seen.add(r.id);
      n++;
      rows.push({
        kind, id: r.id, name: r.title.replace(/\.(wav|mp3|aiff?|flac|ogg)$/i, '').slice(0, 80), category: cat, sort: sort++,
        file: r.url, thumb: r.thumbnail ?? null,
        meta: {
          artist: r.creator ?? '', duration: Math.round((r.duration ?? 0) / 1000), license: r.license, licenseVersion: r.license_version,
          licenseUrl: r.license_url, attribution: r.attribution, landing: r.foreign_landing_url, source: r.source,
        },
      });
    }
    }
    console.log(`${kind} / ${cat}: ${n}`);
  }
}

await collect('music', MUSIC, { category: 'music' }, (r) => r.duration >= 30000 && r.duration <= 300000);
await collect('sounds', SOUNDS, { source: 'freesound' }, (r) => r.duration > 0 && r.duration <= 20000);

const sql = [`DELETE FROM assets WHERE kind IN ('music', 'sounds');`];
for (const r of rows) {
  sql.push(`INSERT INTO assets (kind, id, name, category, sort, file, thumb, size, version, meta) VALUES (${q(r.kind)}, ${q(r.id)}, ${q(r.name)}, ${q(r.category)}, ${r.sort}, ${q(r.file)}, ${q(r.thumb)}, 0, 1, ${q(JSON.stringify(r.meta))});`);
}
fs.writeFileSync(path.join(here, 'audio-seed.sql'), sql.join('\n') + '\n');
console.log(`audio-seed.sql: ${rows.length} tracks`);
