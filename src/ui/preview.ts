import { updateClip } from '../actions';
import { layerGeom } from '../engine/layout';
import { Player } from '../engine/player';
import { visibleClips } from '../engine/scene';
import { applyRatio, aspectOf, ASPECT_GROUPS, ASPECTS, newProject, originalRatio, store } from '../store';
import { Clip } from '../types';
import { drag, fmtTime, h, icon, toast } from './dom';
import { mountMaskOverlay } from './maskOverlay';
import { closePopover, dropdown, Option, popover } from './select';

const GUIDE_SNAP = 0.01;

export function mountPreview(root: HTMLElement, canvas: HTMLCanvasElement, player: Player) {
  const box = h('div.sel-box', null,
    ...['nw', 'ne', 'sw', 'se'].map((c) => h(`div.handle.${c}`, { 'data-h': c })),
    h('div.rot-handle', { 'data-h': 'rot' }, icon('redo', 12)),
  );
  const guideV = h('div.guide.v');
  const guideH = h('div.guide.h');
  const canvasWrap = h('div.canvas-wrap', null, canvas, box, guideV, guideH);
  const stage = h('div.stage', null, canvasWrap);
  const mask = mountMaskOverlay(canvasWrap, () => scale);

  // Stereo level meter (CapCut): 5 segments per channel, green → orange → red. Driven by
  // loudness (RMS), so normal speech and music sit in the green and only loud peaks reach
  // the top. Pausing freezes it; it clears when you leave what was playing.
  const SEGS = 5;
  const STEPS_DB = [-45, -32, -22, -12, -5];
  const cols = [0, 1].map(() => h('div.meter-col', null, ...Array.from({ length: SEGS }, () => h('i'))));
  const meter = h('div.level-meter', { title: 'Audio level', 'aria-hidden': 'true' }, ...cols);
  const shownDb = [-Infinity, -Infinity];
  let meterRaf = 0;
  const paintSegments = () => shownDb.forEach((db, ch) => {
    const lit = STEPS_DB.filter((s) => db >= s).length;
    [...cols[ch].children].forEach((seg, i) => seg.classList.toggle('on', SEGS - 1 - i < lit));
  });
  const paintMeter = () => {
    meterRaf = 0;
    if (!store.playing) return;
    player.audio.levels().forEach((rms, ch) => {
      const db = rms > 1e-5 ? 20 * Math.log10(rms) : -Infinity;
      // Fast rise, ~20 dB/s fall.
      shownDb[ch] = Math.max(db, shownDb[ch] - 0.35);
    });
    paintSegments();
    meterRaf = requestAnimationFrame(paintMeter);
  };
  store.on('playing', () => { if (store.playing && !meterRaf) meterRaf = requestAnimationFrame(paintMeter); });
  let lastKey = store.preview?.key ?? null;
  store.on('view', () => {
    const key = store.preview?.key ?? null;
    if (key !== lastKey && !store.playing) { shownDb.fill(-Infinity); paintSegments(); }
    lastKey = key;
  });

  const timeCur = h('span.time-cur');
  const timeTot = h('span.time-tot');
  const playBtn = h('button.play-btn', { title: 'Play (Space)', 'aria-label': 'Play', onclick: () => player.toggle() });
  const qualityBtn = h('button.pb-box', {
    title: 'Preview quality: Full renders at project resolution, Auto matches the screen',
    onclick: () => { store.previewFull = !store.previewFull; store.emit('view'); toast(`Preview quality: ${store.previewFull ? 'Full' : 'Auto'}`); },
  });
  const ratioBtn = h('button.pb-box', { title: 'Aspect ratio', 'aria-haspopup': 'menu' });
  ratioBtn.addEventListener('click', () => {
    if (ratioBtn.classList.contains('open')) { closePopover(); return; }
    const cur = aspectOf(store.project);
    const choose = (k: string) => {
      closePopover();
      if (k === 'custom') { openCustomRatio(); return; }
      if (k === 'original' && !originalRatio(store.project, store.media)) toast('Original follows your first video or photo. Add one to the timeline.');
      store.commit((p) => applyRatio(p, k, store.media));
    };
    const item = (k: string, label: string) => {
      const [a, b] = ASPECTS[k] ?? [0, 0];
      // Icons fit a 16×16 box, like CapCut's (16:9 → 16×9, 9:16 → 9×16, 1:1 → 16×16).
      const s = a ? Math.min(16 / a, 16 / b) : 0;
      return h(`button.ratio-item${k === cur ? '.selected' : ''}`, { type: 'button', role: 'menuitemradio', 'aria-checked': k === cur, onclick: () => choose(k) },
        h('span.ri-check', null, k === cur ? icon('check', 16) : null),
        h('span.ri-label', null, label),
        a ? h('span.ri-icon', null, h('i', { style: { width: `${Math.round(a * s)}px`, height: `${Math.round(b * s)}px` } })) : null);
    };
    const menu = h('div.ratio-menu', { role: 'menu' },
      item('original', 'Original'), item('custom', 'Custom'),
      ...ASPECT_GROUPS.flatMap((g) => [h('div.ri-sep'), ...g.map((k) => item(k, k))]));
    popover(ratioBtn, menu, { align: 'end' }).el.classList.add('ratio-pop');
  });

  function openCustomRatio() {
    const p = store.project;
    const w = h('input.text-field', { type: 'number', min: 16, max: 8192, step: 2, value: p.width, 'aria-label': 'Width' }) as HTMLInputElement;
    const hh = h('input.text-field', { type: 'number', min: 16, max: 8192, step: 2, value: p.height, 'aria-label': 'Height' }) as HTMLInputElement;
    const close = () => backdrop.remove();
    const apply = () => {
      const even = (v: string) => Math.min(8192, Math.max(16, Math.round((+v || 0) / 2) * 2));
      store.commit((pp) => { pp.width = even(w.value); pp.height = even(hh.value); pp.ratio = 'custom'; });
      close();
    };
    const backdrop = h('div.modal-backdrop', {
      onpointerdown: (e: Event) => { if (e.target === backdrop) close(); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') apply(); },
    }, h('div.modal.small', { role: 'dialog', 'aria-label': 'Custom ratio' },
      h('div.modal-head', null, h('h2', null, 'Custom ratio'), h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, icon('x'))),
      h('div.ex-grid', null,
        h('div.ex-field', null, h('label', null, 'Width (px)'), w),
        h('div.ex-field', null, h('label', null, 'Height (px)'), hh)),
      h('div.modal-foot', null, h('button.ghost-btn', { onclick: close }, 'Cancel'), h('button.primary-btn', { onclick: apply }, 'Apply'))));
    document.body.append(backdrop);
    w.focus();
    w.select();
  }

  const controls = h('div.player-bar', null,
    h('div.pb-left', null, timeCur, h('span.time-sep', null, '/'), timeTot, meter),
    // Frame stepping lives on the ← / → keys.
    h('div.pb-center', null, playBtn),
    h('div.pb-right', null, qualityBtn, ratioBtn,
      h('button.icon-btn', { title: 'Fullscreen', 'aria-label': 'Fullscreen', onclick: () => stage.requestFullscreen?.() }, icon('fullscreen', 16))),
  );
  // Header: "Player" + timeline switcher (CapCut shows "Player-Timeline 01").
  const head = h('div.panel-head');
  const renderHead = () => {
    const opts: Option<string>[] = store.timelines.map((t) => ({ id: t.id, name: store.timelineName(t.id) }));
    opts.push({ id: '__new', name: '+ New empty timeline' });
    head.replaceChildren(h('span', null, 'Player'), h('span.head-sep', null, '·'),
      dropdown(store.activeTimelineId, opts, (id) => {
        if (id === '__new') {
          const p = newProject();
          p.name = `Timeline ${String(store.timelines.length + 1).padStart(2, '0')}`;
          Object.assign(p, { width: store.project.width, height: store.project.height, fps: store.project.fps });
          store.addTimeline(p);
        } else {
          player.pause();
          store.switchTimeline(id);
        }
      }, { className: 'timeline-dd' }));
  };
  renderHead();
  store.on('project', renderHead);
  store.on('view', renderHead);
  root.append(head, stage, controls);

  const HEAD_H = 41, BAR_H = 48, PAD = 7, MIN_TIMELINE = 170;
  let scale = 1;
  /**
   * Sizes the upper area so a 16:9 canvas spans the player width with exactly PAD px
   * each side; the timeline gets the remaining height. Always based on 16:9, never the
   * project's ratio, so switching ratios doesn't resize the UI: other shapes fit inside.
   */
  const sizeWorkspace = () => {
    let hgt: number;
    if (store.workH !== null) hgt = store.workH;
    else {
      const pw = root.getBoundingClientRect().width;
      hgt = HEAD_H + BAR_H + PAD * 2 + ((pw - PAD * 2) * 9) / 16;
    }
    const max = window.innerHeight - 34 - 12 - MIN_TIMELINE;
    hgt = Math.round(Math.max(260, Math.min(max, hgt)));
    document.documentElement.style.setProperty('--work-h', `${hgt}px`);
  };
  const layout = () => {
    sizeWorkspace();
    const r = stage.getBoundingClientRect();
    // 7px breathing room on each side of the canvas, as in CapCut.
    const res = player.fit(Math.max(50, r.width - 14), Math.max(50, r.height - 14));
    scale = res.scale;
    canvasWrap.style.width = `${res.cssW}px`;
    canvasWrap.style.height = `${res.cssH}px`;
    updateBox();
    mask.update();
  };
  new ResizeObserver(layout).observe(stage);
  new ResizeObserver(layout).observe(root);
  window.addEventListener('resize', layout);

  function selectedVisible(): Clip | null {
    const c = store.selected;
    // Effect/filter layers cover the whole frame; no transform box. Nothing to edit in a library preview.
    if (store.preview || !c || c.type === 'audio' || c.type === 'effect' || c.type === 'filter') return null;
    const t = store.currentTime;
    if (t < c.start || t >= c.start + c.duration) return null;
    const found = store.findClip(c.id);
    if (found?.track.hidden) return null;
    return c;
  }

  function updateBox() {
    const c = selectedVisible();
    if (!c || store.playing || mask.active()) { box.style.display = 'none'; return; }
    const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
    const g = layerGeom(c, m, store.project, store.currentTime, false);
    box.style.display = 'block';
    box.style.width = `${g.w * scale}px`;
    box.style.height = `${g.h * scale}px`;
    box.style.transform = `translate(${(g.cx - g.w / 2) * scale}px, ${(g.cy - g.h / 2) * scale}px) rotate(${g.rotation}rad)`;
    box.classList.toggle('locked', !!store.findClip(c.id)?.track.locked);
  }

  function updateBar() {
    const fps = store.viewProject.fps;
    timeCur.textContent = fmtTime(store.viewTime, fps, true);
    timeTot.textContent = fmtTime(store.viewDuration, fps, true);
    // Swap the icon only when the state changes: replacing it every frame while playing
    // removes the element under the pointer mid-click, and the browser drops the click.
    const state = store.playing ? 'pause' : 'play';
    if (playBtn.dataset.state !== state) {
      playBtn.dataset.state = state;
      playBtn.replaceChildren(icon(state, 18));
      playBtn.setAttribute('aria-label', store.playing ? 'Pause' : 'Play');
      playBtn.title = store.playing ? 'Pause (Space)' : 'Play (Space)';
    }
    qualityBtn.textContent = store.previewFull ? 'Full' : 'Auto';
    const r = aspectOf(store.project);
    ratioBtn.textContent = r === 'original' ? 'Original' : r === 'custom' ? 'Custom' : r;
    qualityBtn.classList.toggle('on', store.previewFull);
    stage.classList.toggle('empty', !store.viewProject.tracks.some((t) => t.clips.length));
  }

  // Hit-test clips under the pointer (topmost first) in project space.
  function hit(px: number, py: number): Clip | null {
    const list = visibleClips(store.project, store.currentTime).reverse();
    for (const { clip, track } of list) {
      if (track.locked || clip.type === 'effect' || clip.type === 'filter') continue;
      const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
      const g = layerGeom(clip, m, store.project, store.currentTime, false);
      const dx = px - g.cx, dy = py - g.cy;
      const c = Math.cos(-g.rotation), s = Math.sin(-g.rotation);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) return clip;
    }
    return null;
  }

  const toProject = (e: PointerEvent) => {
    const r = canvasWrap.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  function showGuides(x: boolean, y: boolean) {
    guideV.style.display = x ? 'block' : 'none';
    guideH.style.display = y ? 'block' : 'none';
  }

  canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || store.preview) return;
    const handle = (e.target as HTMLElement).closest('[data-h]') as HTMLElement | null;
    const [px, py] = toProject(e);
    let clip = store.selected;
    if (!handle) {
      const hitClip = hit(px, py);
      if (!hitClip) { store.select(null); return; }
      if (hitClip.id !== clip?.id) store.select(hitClip.id);
      clip = hitClip;
    }
    if (!clip || store.findClip(clip.id)?.track.locked) return;
    player.pause();
    const id = clip.id;
    const p = store.project;
    const t0 = { ...clip.transform };
    const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
    const g0 = layerGeom(clip, m, p, store.currentTime, false);
    let first = true;
    const apply = (fn: (c: Clip) => void) => { updateClip(id, fn, first); first = false; updateBox(); };
    const kind = handle?.dataset.h;

    drag(e, (_dx, _dy, ev) => {
      const [qx, qy] = toProject(ev);
      if (!kind) {
        let nx = t0.x + (qx - px) / p.width;
        let ny = t0.y + (qy - py) / p.height;
        const sx = Math.abs(nx) < GUIDE_SNAP, sy = Math.abs(ny) < GUIDE_SNAP;
        if (sx) nx = 0;
        if (sy) ny = 0;
        showGuides(sx, sy);
        apply((c) => { c.transform.x = nx; c.transform.y = ny; });
      } else if (kind === 'rot') {
        const a0 = Math.atan2(py - g0.cy, px - g0.cx);
        const a1 = Math.atan2(qy - g0.cy, qx - g0.cx);
        let deg = t0.rotation + ((a1 - a0) * 180) / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
        apply((c) => { c.transform.rotation = Math.round(deg); });
      } else {
        const d0 = Math.hypot(px - g0.cx, py - g0.cy);
        const d1 = Math.hypot(qx - g0.cx, qy - g0.cy);
        const s = Math.max(0.05, Math.min(10, (t0.scale * d1) / Math.max(1, d0)));
        apply((c) => { c.transform.scale = s; });
      }
    }, () => showGuides(false, false));
  });

  store.on('time', () => { updateBar(); updateBox(); });
  store.on('project', () => { updateBar(); layout(); });
  store.on('select', updateBox);
  store.on('playing', () => { updateBar(); updateBox(); });
  store.on('view', () => { updateBar(); layout(); });
  store.on('media', updateBox);
  updateBar();
}
