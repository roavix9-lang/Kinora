// Kinora asset API: the catalog lives in D1, the files in R2.
//   GET /catalog            every asset, grouped by kind
//   GET /catalog/:kind      one kind (stickers | effects | filters | transitions | templates)
//   GET /a/<r2 key>         an asset file or thumbnail
// Read-only and public: the app holds no Cloudflare credentials.

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
}

const KINDS = new Set(['stickers', 'effects', 'filters', 'transitions', 'templates']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

interface Row { kind: string; id: string; name: string; category: string; sort: number; file: string; thumb: string | null; size: number; version: number; meta: string }

const shape = (r: Row) => ({ ...r, meta: JSON.parse(r.meta) });

function json(body: unknown, maxAge = 300) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors });
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === '/catalog' || path.startsWith('/catalog/')) {
      const kind = path.slice('/catalog/'.length);
      if (kind && !KINDS.has(kind)) return json({ error: 'unknown kind' }, 60);
      const q = kind
        ? env.DB.prepare('SELECT * FROM assets WHERE kind = ? ORDER BY sort').bind(kind)
        : env.DB.prepare('SELECT * FROM assets ORDER BY kind, sort');
      const { results } = await q.all<Row>();
      if (kind) return json(results.map(shape));
      const grouped: Record<string, unknown[]> = {};
      for (const r of results) (grouped[r.kind] ??= []).push(shape(r));
      return json(grouped);
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
