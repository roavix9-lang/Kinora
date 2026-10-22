// Kinora asset API: the catalog lives in D1, the files in R2.
//   GET /catalog            every asset, grouped by kind
//   GET /catalog/:kind      one kind (stickers | effects | filters | transitions | animations | templates | music | sounds)
//   GET /a/<r2 key>         an asset file or thumbnail
//   GET /p?u=<url>          music from sites without CORS (Jamendo), passed through, not stored
//   POST /templates         save a user template (gzipped JSON + WebP cover), header x-kinora-owner
//   GET /templates/mine     this device's templates (header x-kinora-owner)
//   DELETE /templates/:id   delete one of this device's templates
// The app holds no Cloudflare credentials. Template uploads are limited (size, type, count per
// device) because there are no accounts: a device proves ownership with a random secret it
// keeps locally; only the secret's SHA-256 is stored.

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
}

const KINDS = new Set(['stickers', 'effects', 'filters', 'transitions', 'animations', 'templates', 'music', 'sounds']);
/** Hosts the pass-through serves (CC0 / CC BY music sources that send no CORS headers). */
const PASS_HOSTS = /(^|\.)jamendo\.com$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const MAX_TEMPLATE_GZ = 256 * 1024;
const MAX_THUMB = 100 * 1024;
/** Templates one device may create in any 7 days; deleting one doesn't give the slot back. */
const PER_WEEK = 5;
/**
 * Backstop per network (IP address) per 7 days, for someone clearing site data to get a new device
 * key. Higher than PER_WEEK because homes, schools and offices share one address.
 */
const PER_NETWORK_WEEK = 10;
const PER_DEVICE = 100;

const dayOf = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const today = () => dayOf();
const DAY_MS = 86400000;

/** One-way id for the caller's IP (the address itself is never stored). */
async function networkKey(req: Request) {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kinora|${ip}`));
  return 'ip:' + [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Templates created in the last 7 days (today and the 6 before it), per key. */
async function quotaUsed(env: Env, keys: string[]) {
  const since = dayOf(6 * DAY_MS);
  const rows = await Promise.all(keys.map((k) => env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM template_quota WHERE key = ? AND day >= ?').bind(k, since).first<{ n: number }>()));
  return rows.map((r) => r?.n ?? 0);
}

/** How many templates this device can still create this week (rolling 7 days). */
async function quotaLeft(req: Request, env: Env, owner: string) {
  const [device, network] = await quotaUsed(env, [`dev:${owner}`, await networkKey(req)]);
  return Math.max(0, Math.min(PER_WEEK - device, PER_NETWORK_WEEK - network));
}

async function ownerHash(req: Request): Promise<string | null> {
  const secret = req.headers.get('x-kinora-owner') ?? '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return null;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const MAX_TEMPLATE_SECONDS = 300;
const err = (status: number, message: string) => json({ error: message }, 0, status);

async function saveTemplate(req: Request, env: Env) {
  const owner = await ownerHash(req);
  if (!owner) return err(401, 'missing device key');
  if (Number(req.headers.get('content-length') ?? 0) > 600 * 1024) return err(413, 'template too large');
  let body: { name?: string; category?: string; ratio?: string; slots?: number; duration?: number; gz?: string; thumb?: string };
  try { body = await req.json(); } catch { return err(400, 'bad json'); }
  const name = String(body.name ?? '').trim().slice(0, 60);
  const ratio = String(body.ratio ?? '');
  if (!name || !/^\d+(\.\d+)?:\d+$/.test(ratio)) return err(400, 'name and ratio required');
  const duration = Math.max(0, Number(body.duration) || 0);
  if (duration > MAX_TEMPLATE_SECONDS) return err(400, 'templates can be at most 5 minutes');
  const gz = b64(String(body.gz ?? ''));
  const thumb = body.thumb ? b64(String(body.thumb)) : null;
  // gzip magic bytes / WebP RIFF header: only these two formats are accepted.
  if (gz.length < 20 || gz.length > MAX_TEMPLATE_GZ || gz[0] !== 0x1f || gz[1] !== 0x8b) return err(400, 'template must be gzip, max 256 KB');
  if (thumb && (thumb.length > MAX_THUMB || String.fromCharCode(...thumb.slice(8, 12)) !== 'WEBP')) return err(400, 'cover must be WebP, max 100 KB');
  const now = Date.now();
  if ((await quotaLeft(req, env, owner)) <= 0) return err(429, `You can create ${PER_WEEK} templates a week. Try again in a few days.`);
  const counts = await env.DB.prepare('SELECT COUNT(*) AS total FROM assets WHERE owner = ?').bind(owner).first<{ total: number }>();
  if ((counts?.total ?? 0) >= PER_DEVICE) return err(429, `You can keep up to ${PER_DEVICE} templates. Delete some first.`);
  const id = `u-${crypto.randomUUID()}`;
  const file = `user-templates/${id}.json.gz`, thumbKey = thumb ? `user-templates/${id}.webp` : null;
  const httpMetadata = { cacheControl: 'public, max-age=31536000, immutable' };
  await env.ASSETS.put(file, gz, { httpMetadata: { ...httpMetadata, contentType: 'application/gzip' } });
  if (thumb && thumbKey) await env.ASSETS.put(thumbKey, thumb, { httpMetadata: { ...httpMetadata, contentType: 'image/webp' } });
  const meta = { ratio, slots: Math.max(1, Math.min(50, Number(body.slots) || 1)), duration, featured: false, userCategory: String(body.category ?? '').slice(0, 30) };
  await env.DB.prepare('INSERT INTO assets (kind, id, name, category, sort, file, thumb, size, version, meta, owner, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .bind('templates', id, name, 'Yours', 0, file, thumbKey, gz.length, JSON.stringify(meta), owner, now).run();
  const day = today();
  const bump = 'INSERT INTO template_quota (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1';
  const old = dayOf(8 * DAY_MS);
  await env.DB.batch([
    env.DB.prepare(bump).bind(`dev:${owner}`, day),
    env.DB.prepare(bump).bind(await networkKey(req), day),
    env.DB.prepare('DELETE FROM template_quota WHERE day < ?').bind(old),
  ]);
  return json({ kind: 'templates', id, name, category: 'Yours', sort: 0, file, thumb: thumbKey, size: gz.length, version: 1, meta }, 0);
}

interface Row { kind: string; id: string; name: string; category: string; sort: number; file: string; thumb: string | null; size: number; version: number; meta: string; owner?: string | null; created?: number | null }

// Never send owner hashes back out.
const shape = ({ owner: _o, created: _c, ...r }: Row) => ({ ...r, meta: JSON.parse(r.meta) });

function json(body: unknown, maxAge = 300, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === '/templates' && req.method === 'POST') return saveTemplate(req, env);
    if (path === '/templates/mine' && req.method === 'GET') {
      const owner = await ownerHash(req);
      if (!owner) return err(401, 'missing device key');
      const { results } = await env.DB.prepare('SELECT * FROM assets WHERE owner = ? ORDER BY created DESC').bind(owner).all<Row>();
      return json(results.map(shape), 0);
    }
    if (path === '/templates/quota' && req.method === 'GET') {
      const owner = await ownerHash(req);
      if (!owner) return err(401, 'missing device key');
      return json({ left: await quotaLeft(req, env, owner), perWeek: PER_WEEK }, 0);
    }
    if (path.startsWith('/templates/') && req.method === 'DELETE') {
      const owner = await ownerHash(req);
      if (!owner) return err(401, 'missing device key');
      const id = path.slice('/templates/'.length);
      const row = await env.DB.prepare('SELECT file, thumb FROM assets WHERE kind = ? AND id = ? AND owner = ?').bind('templates', id, owner).first<{ file: string; thumb: string | null }>();
      if (!row) return err(404, 'not found');
      await env.ASSETS.delete([row.file, ...(row.thumb ? [row.thumb] : [])]);
      await env.DB.prepare('DELETE FROM assets WHERE kind = ? AND id = ? AND owner = ?').bind('templates', id, owner).run();
      return json({ ok: true }, 0);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors });

    if (path === '/catalog' || path.startsWith('/catalog/')) {
      const kind = path.slice('/catalog/'.length);
      if (kind && !KINDS.has(kind)) return json({ error: 'unknown kind' }, 60);
      const q = kind
        ? env.DB.prepare('SELECT * FROM assets WHERE kind = ? AND owner IS NULL ORDER BY sort').bind(kind)
        : env.DB.prepare('SELECT * FROM assets WHERE owner IS NULL ORDER BY kind, sort');
      const { results } = await q.all<Row>();
      if (kind) return json(results.map(shape));
      const grouped: Record<string, unknown[]> = {};
      for (const r of results) (grouped[r.kind] ??= []).push(shape(r));
      return json(grouped);
    }

    if (path === '/p') {
      let src: URL;
      try { src = new URL(url.searchParams.get('u') ?? ''); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
      if (src.protocol !== 'https:' || !PASS_HOSTS.test(src.hostname)) return new Response('Host not allowed', { status: 403, headers: cors });
      const upstream = await fetch(src.toString(), { cf: { cacheEverything: true, cacheTtl: 2592000 } });
      const headers = new Headers(cors);
      for (const k of ['content-type', 'content-length', 'accept-ranges', 'etag', 'last-modified']) {
        const v = upstream.headers.get(k);
        if (v) headers.set(k, v);
      }
      headers.set('Cache-Control', 'public, max-age=2592000');
      return new Response(req.method === 'HEAD' ? null : upstream.body, { status: upstream.ok ? 200 : upstream.status, headers });
    }

    if (path.startsWith('/a/')) {
      const key = path.slice(3);
      const obj = await env.ASSETS.get(key);
      if (!obj) return new Response('Not found', { status: 404, headers: cors });
      const headers = new Headers(cors);
      obj.writeHttpMetadata(headers);
      headers.set('ETag', obj.httpEtag);
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
    }

    return json({ ok: true, endpoints: ['/catalog', '/catalog/:kind', '/a/:key'] }, 60);
  },
};
