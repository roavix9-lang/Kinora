import { updateClip } from '../actions';
import { layerGeom } from '../engine/layout';
import { store } from '../store';
import { AdjustMask, Clip, defaultMask } from '../types';
import { drag, h, icon } from './dom';

// Adjust › Mask frame on the player, like CapCut: drag anywhere to move the mask, and use
// the handles to rotate (below), feather (above), resize (edges) and round the corners
// (rectangle). Shown only while the Mask tab is open for the selected clip.

const SVG = 'http://www.w3.org/2000/svg';

/** Shape outline in a -1..1 box (matches the shader's maskValue). */
function outline(m: AdjustMask, hw: number, hh: number): string {
  switch (m.type) {
    case 'split': return '<path d="M-1 0H1"/>';
    case 'filmstrip': return '<path d="M-1 -1H1M-1 1H1"/>';
    case 'circle': return '<ellipse cx="0" cy="0" rx="1" ry="1"/>';
    case 'rectangle': {
      const r = (m.round ?? 0) * Math.min(hw, hh);
      return `<rect x="-1" y="-1" width="2" height="2" rx="${r / Math.max(1e-3, hw)}" ry="${r / Math.max(1e-3, hh)}"/>`;
    }
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * Math.PI * 2;
        const rs = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(a * 2.5)), 4);
        pts.push(`${(rs * Math.sin(a)).toFixed(4)},${(-rs * Math.cos(a)).toFixed(4)}`);
      }
      return `<polygon points="${pts.join(' ')}"/>`;
    }
    case 'heart': {
      const pts: string[] = [];
      const v = (x: number, y: number) => Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y;
      for (let i = 0; i <= 180; i++) {
        const a = (i / 180) * Math.PI * 2;
        let r = 0;
        while (r < 1.8 && v(r * Math.sin(a), r * Math.cos(a)) <= 0) r += 0.005;
        const x = r * Math.sin(a), y = r * Math.cos(a);
        pts.push(`${(x / 1.1).toFixed(4)},${(-(y - 0.15) / 1.1).toFixed(4)}`);
      }
      return `<polygon points="${pts.join(' ')}"/>`;
    }
  }
}

export function mountMaskOverlay(wrap: HTMLElement, getScale: () => number) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-1 -1 2 2');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('mask-svg');
  const handle = (kind: string, ...kids: (Node | string)[]) => h(`div.mask-h.mh-${kind}`, { 'data-mh': kind }, ...kids);
  const frame = h('div.mask-frame', null, svg,
    handle('move'), handle('rot', icon('redo', 12)), handle('feather', icon('chevronUp', 10), icon('chevron', 10)),
    handle('w'), handle('h'), handle('round'));
  const layer = h('div.mask-layer', null, frame);
  wrap.append(layer);

  const clipOf = (): Clip | null => {
    const c = store.selected;
    if (!c || store.preview || store.maskEdit !== c.id || store.playing || !c.adjMask?.enabled) return null;
    if (store.currentTime < c.start || store.currentTime >= c.start + c.duration) return null;
    return c;
  };

  /** Mask centre/size/rotation in project pixels. */
  const geom = (c: Clip) => {
    const m = c.adjMask!;
    const g = layerGeom(c, c.mediaId ? store.media.get(c.mediaId) : undefined, store.project, store.currentTime, false);
    const lx = (m.x - 0.5) * g.w, ly = (m.y - 0.5) * g.h;
    const cr = Math.cos(g.rotation), sr = Math.sin(g.rotation);
    const s = Math.max(1, Math.min(g.w, g.h));
    return {
      g, s, m,
      cx: g.cx + lx * cr - ly * sr, cy: g.cy + lx * sr + ly * cr,
      hw: (m.w * s) / 2, hh: (m.h * s) / 2,
      rot: g.rotation + (m.rotation * Math.PI) / 180,
    };
  };

  function update() {
    const c = clipOf();
    layer.style.display = c ? 'block' : 'none';
    if (!c) return;
    const sc = getScale();
    const G = geom(c);
    const lines = G.m.type === 'split' || G.m.type === 'filmstrip';
    // Line masks span the whole layer; the split line has no height.
    const hw = lines ? Math.hypot(G.g.w, G.g.h) : G.hw;
    const hh = G.m.type === 'split' ? 0 : G.hh;
    frame.style.width = `${hw * 2 * sc}px`;
    frame.style.height = `${hh * 2 * sc}px`;
    frame.style.transform = `translate(${(G.cx - hw) * sc}px, ${(G.cy - hh) * sc}px) rotate(${G.rot}rad)`;
    frame.dataset.shape = G.m.type;
    svg.innerHTML = outline(G.m, G.hw, G.hh);
    const round = frame.querySelector<HTMLElement>('.mh-round')!;
    const r = (G.m.round ?? 0) * Math.min(G.hw, G.hh) * sc;
    round.style.left = round.style.top = `${r * 0.29 - 14}px`;
  }

  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const c = clipOf();
    if (!c) return;
    e.stopPropagation();
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-mh]')?.dataset.mh ?? 'move';
    const sc = getScale();
    const wr = wrap.getBoundingClientRect();
    const toP = (ev: PointerEvent) => [(ev.clientX - wr.left) / sc, (ev.clientY - wr.top) / sc];
    const [px, py] = toP(e);
    const G = geom(c);
    const m0 = { ...G.m };
    const ax = [Math.cos(G.rot), Math.sin(G.rot)], ay = [-Math.sin(G.rot), Math.cos(G.rot)];
    let first = true;
    const set = (fn: (m: AdjustMask) => void) => {
      updateClip(c.id, (x) => { x.adjMask = { ...(x.adjMask ?? defaultMask()) }; fn(x.adjMask); }, first);
      first = false;
      update();
    };
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    drag(e, (_dx, _dy, ev) => {
      const [qx, qy] = toP(ev);
      const vx = qx - G.cx, vy = qy - G.cy;
      if (kind === 'move') {
        const dx = qx - px, dy = qy - py;
        const cr = Math.cos(-G.g.rotation), sr = Math.sin(-G.g.rotation);
        const lx = dx * cr - dy * sr, ly = dx * sr + dy * cr;
        set((m) => { m.x = clamp(m0.x + lx / G.g.w, -0.5, 1.5); m.y = clamp(m0.y + ly / G.g.h, -0.5, 1.5); });
      } else if (kind === 'rot') {
        const a0 = Math.atan2(py - G.cy, px - G.cx), a1 = Math.atan2(vy, vx);
        let deg = m0.rotation + ((a1 - a0) * 180) / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
        set((m) => { m.rotation = Math.round(deg); });
      } else if (kind === 'w') {
        set((m) => { m.w = clamp((2 * Math.abs(vx * ax[0] + vy * ax[1])) / G.s, 0.02, 3); });
      } else if (kind === 'h') {
        set((m) => { m.h = clamp((2 * Math.abs(vx * ay[0] + vy * ay[1])) / G.s, 0.02, 3); });
      } else if (kind === 'feather') {
        // Drag away from the shape (up) to soften the edge.
        const d = -((qx - px) * ay[0] + (qy - py) * ay[1]);
        set((m) => { m.feather = clamp(m0.feather + (d / G.s) * 2, 0, 1); });
      } else if (kind === 'round') {
        // Drag towards the centre to round the corners.
        const len = Math.SQRT2;
        const d = ((qx - px) * (ax[0] + ay[0]) + (qy - py) * (ax[1] + ay[1])) / len;
        set((m) => { m.round = clamp((m0.round ?? 0) + d / Math.max(1, Math.min(G.hw, G.hh)), 0, 1); });
      }
    });
  });

  store.on('time', update);
  store.on('project', update);
  store.on('select', update);
  store.on('playing', update);
  store.on('view', update);
  return { update, active: () => !!clipOf() };
}
