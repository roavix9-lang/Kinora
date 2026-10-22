import {
  addMediaToTimeline, copyAttributes, copySelected, cutSelected, deleteSelected, deleteSide, duplicateSelected, extractAudio, hasAttributes,
  pasteAttributes, recoverAudio, replaceClipMedia, replaceTemplateSlot, sourceDuration, splitAtPlayhead, toggleDisabled, toggleMarker, updateClip,
} from '../actions';
import { displayName } from '../engine/gltransitions';
import { trackTransitions } from '../engine/scene';
import { nestedProject, placeholdersLeft } from '../engine/templateClips';
import { mediaStill, openSlotPicker } from './slotPicker';
import { stickerById, stickerDataUrl } from '../stickers';
import { relinkMedia, thumbAt } from '../engine/media';
import { Player } from '../engine/player';
import { store } from '../store';
import { Clip, clipEnd, MediaItem, Track, TrackKind, uid } from '../types';
import { clear, drag, fmtTime, h, icon, toast } from './dom';
import { importAndAdd, pickFiles } from './importer';
import { MenuItem, onContextMenu } from './contextmenu';
import { openExportDialog } from './exportDialog';
import { saveAdjustPreset } from './adjustPanel';
import { isolateProgress, setIsolate } from '../engine/isolate';
import { dropLibItem } from './libraryPreview';

const RULER_H = 22;
const MIN_ZOOM = 2;
const MAX_ZOOM = 400;
const MIN_CLIP = 1 / 30;
const SNAP_PX = 8;
/** Template slot strip: fixed height and the gap kept between it and its clip. */
const STRIP_H = 112;
const STRIP_GAP = 6;

const MARKER_COLOR = '#22d3ee';
/** Marker flag (8×9 px) with its point at (x, y + 9). */
function flag(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x + 4, y + 6); ctx.lineTo(x, y + 9); ctx.lineTo(x - 4, y + 6);
  ctx.closePath();
  ctx.fill();
}
/** Height of the name/length strip on video and photo clips. */
const CLIP_HEAD = 16;
const trackHeight = (t: Track) => (t.main ? 68 : t.kind === 'video' ? 54 : t.kind === 'audio' ? 46 : 34);

export function mountTimeline(root: HTMLElement, player: Player) {
  const btn = (name: string, title: string, onclick: () => void, extra = '') =>
    h(`button.icon-btn${extra}`, { title, onclick }, icon(name));

  const undoBtn = btn('undo', 'Undo (Ctrl+Z)', () => store.undo());
  const redoBtn = btn('redo', 'Redo (Ctrl+Shift+Z)', () => store.redo());
  const splitBtn = btn('split', 'Split (Ctrl+B)', splitAtPlayhead);
  const delLeftBtn = btn('deleteLeft', 'Delete left (Q)', () => deleteSide('left'));
  const delRightBtn = btn('deleteRight', 'Delete right (W)', () => deleteSide('right'));
  const delBtn = btn('trash', 'Delete (Del)', () => deleteSelected());
  const markerBtn = btn('marker', 'Add marker (M)', toggleMarker);
  const dupBtn = btn('copy', 'Duplicate (Ctrl+D)', duplicateSelected);
  const mirrorBtn = btn('flip', 'Mirror', () => { const c = store.selected; if (c && c.type !== 'audio') updateClip(c.id, (x) => { x.transform.flipX = !x.transform.flipX; }); });
  const rotateBtn = btn('rotate', 'Rotate 90°', () => { const c = store.selected; if (c && c.type !== 'audio') updateClip(c.id, (x) => { x.transform.rotation = ((x.transform.rotation + 90 + 180) % 360) - 180; }); });
  const snapBtn = btn('magnet', 'Snapping (N)', () => { store.snapping = !store.snapping; store.emit('view'); });
  const magnetBtn = btn('chain', 'Main track magnet', () => {
    store.mainMagnet = !store.mainMagnet;
    try { localStorage.setItem('kinora.mainMagnet', store.mainMagnet ? '1' : '0'); } catch { /* ignore */ }
    // Turning it on packs the main track immediately (one undo step).
    if (store.mainMagnet) store.commit(() => {}); else store.emit('view');
    toast(store.mainMagnet
      ? 'Main track magnet on: clips on the main track stay joined with no gaps'
      : 'Main track magnet off: clips stay where you drop them');
  });
  const zoomSlider = h('input.range.zoom-slider', { type: 'range', min: 0, max: 1000, title: 'Zoom', 'aria-label': 'Timeline zoom' }) as HTMLInputElement;
  const zoomToSlider = (z: number) => String(Math.round((Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 1000));
  const sliderToZoom = (v: number) => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / 1000);
  zoomSlider.oninput = () => setZoom(sliderToZoom(+zoomSlider.value));

  const toolbar = h('div.tl-toolbar', null,
    h('div.tl-tools', null, undoBtn, redoBtn, h('span.sep'), splitBtn, delLeftBtn, delRightBtn, delBtn, markerBtn, dupBtn, mirrorBtn, rotateBtn),
    h('div.tl-tools', null,
      magnetBtn, snapBtn, h('span.sep'),
      btn('zoomFit', 'Zoom to fit timeline (Shift+Z)', () => fitZoom()),
      btn('zoomOut', 'Zoom out (-)', () => setZoom(store.zoom / 1.4)),
      zoomSlider,
      btn('zoomIn', 'Zoom in (+)', () => setZoom(store.zoom * 1.4)),
    ),
  );

  const headers = h('div.tl-headers');
  const ruler = h('canvas.tl-ruler') as HTMLCanvasElement;
  const rows = h('div.tl-rows');
  const playhead = h('div.tl-playhead', null, h('div.tl-playhead-cap'));
  const snapLine = h('div.tl-snapline');
  const content = h('div.tl-content', null, rows, playhead, snapLine);
  const scroller = h('div.tl-scroll', null, h('div.tl-ruler-wrap', null, ruler), content);
  const empty = h('div.tl-empty', null, icon('film', 22), h('span', null, 'Drag media here to start creating'));
  const headersWrap = h('div.tl-headers-wrap', null, h('div.tl-corner'), headers);
  // Phones (CapCut mobile): the playhead stays fixed in the middle and the tracks scroll under it.
  const centreLine = h('div.tl-centre-line', null, h('div.tl-playhead-cap'));
  const body = h('div.tl-body', null, headersWrap, scroller, empty, centreLine);
  root.append(toolbar, body);

  // ---- centred playhead (small screens) ----------------------------------------
  // The track headers move inside the scroll area, to the left of 00:00, so they scroll away
  // with the clips. Scrolling sideways scrubs; playing scrolls the tracks under the line.

  const phone = matchMedia('(max-width: 760px)');
  let centred = false;
  /** Space before the headers so 00:00 can sit under the centre line. */
  let lead = 0;
  const HEADERS_W = 128;
  /** Where time 0 is inside the scroll area (lead + headers). */
  const timeOrigin = () => (centred ? lead + HEADERS_W : 0);
  let settingScroll = false;

  function applyMode() {
    centred = phone.matches;
    body.classList.toggle('centred', centred);
    if (centred && headersWrap.parentElement !== scroller) scroller.prepend(headersWrap);
    if (!centred && headersWrap.parentElement !== body) body.prepend(headersWrap);
    if (!centred) { content.style.marginLeft = ''; content.style.marginRight = ''; headersWrap.style.left = ''; headers.style.transform = ''; }
    schedule();
  }
  phone.addEventListener('change', applyMode);

  /** Puts the current time under the centre line. */
  function syncScroll() {
    if (!centred) return;
    const want = Math.max(0, store.currentTime * store.zoom + timeOrigin() - scroller.clientWidth / 2);
    if (Math.abs(scroller.scrollLeft - want) < 0.5) return;
    settingScroll = true;
    scroller.scrollLeft = want;
  }

  scroller.addEventListener('scroll', () => {
    if (!centred) return;
    if (settingScroll) { settingScroll = false; return; }
    // The user scrolled: the time under the centre line is the new playhead time.
    if (store.playing) player.pause();
    const t = (scroller.scrollLeft + scroller.clientWidth / 2 - timeOrigin()) / store.zoom;
    player.seek(Math.max(0, Math.min(store.duration, t)));
  });

  // ---- zoom --------------------------------------------------------------------

  function setZoom(z: number, anchorX?: number) {
    const old = store.zoom;
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (centred) { store.zoom = z; render(); store.emit('view'); return; }
    const ax = anchorX ?? (store.currentTime * old - scroller.scrollLeft);
    const tAtAnchor = (scroller.scrollLeft + ax) / old;
    store.zoom = z;
    render();
    scroller.scrollLeft = tAtAnchor * z - ax;
    store.emit('view');
  }

  /** Zoom so the whole timeline (a 2 min video = 2 min) fills the visible width. */
  function fitZoom() {
    const d = Math.max(store.duration, 1);
    if (centred) { setZoom((scroller.clientWidth / 2 - 12) / d); return; }
    setZoom((scroller.clientWidth - 24) / d);
    scroller.scrollLeft = 0;
  }

  // CapCut-style wheel: wheel scrolls time horizontally, Shift+wheel scrolls tracks,
  // Ctrl/Cmd+wheel (and trackpad pinch) zooms around the cursor.
  scroller.addEventListener('wheel', (e) => {
    const rect = scroller.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(store.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left);
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad horizontal swipe: native
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if (e.shiftKey) scroller.scrollTop += d;
    else scroller.scrollLeft += d;
  }, { passive: false });

  // ---- ruler -------------------------------------------------------------------

  function drawRuler() {
    const dpr = window.devicePixelRatio || 1;
    const w = content.offsetWidth;
    const viewW = scroller.clientWidth;
    // x0: the time-axis pixel at the left edge of the view (the headers sit before 00:00 on phones).
    const x0 = scroller.scrollLeft - timeOrigin();
    // Only rasterise the visible slice; the canvas is positioned with sticky offset.
    ruler.width = Math.max(1, viewW * dpr);
    ruler.height = RULER_H * dpr;
    ruler.style.width = `${viewW}px`;
    ruler.style.transform = `translateX(${scroller.scrollLeft}px)`;
    (ruler.parentElement as HTMLElement).style.width = `${w + timeOrigin() + (centred ? viewW / 2 : 0)}px`;
    const ctx = ruler.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, viewW, RULER_H);
    const z = store.zoom;
    const steps = [1 / 30, 1 / 10, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * z >= 80) ?? 600;
    // CapCut splits each labelled step into 10 (fewer when zoomed so far out they'd crowd).
    const minor = major / (major * z >= 70 ? 10 : 5);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    // Integer tick indices avoid float drift (3.9999 rendering as "00:03").
    const perMajor = Math.round(major / minor);
    const iStart = Math.floor(x0 / z / minor);
    const iEnd = Math.ceil((x0 + viewW) / z / minor) + 1;
    ctx.beginPath();
    for (let i = iStart; i <= iEnd; i++) {
      const t = Math.round(i * minor * 1000) / 1000;
      const x = Math.round(t * z - x0) + 0.5;
      if (t < 0) continue;
      const isMajor = i % perMajor === 0;
      ctx.moveTo(x, isMajor ? 0 : 15);
      ctx.lineTo(x, RULER_H);
      if (isMajor) {
        const label = major < 1 ? `${fmtTime(t)}:${String(Math.round((t % 1) * store.project.fps)).padStart(2, '0')}` : fmtTime(t);
        ctx.fillText(label, x + 3, 2);
      }
    }
    ctx.stroke();
    // Timeline markers: small cyan flags on the ruler.
    ctx.fillStyle = MARKER_COLOR;
    for (const m of store.project.markers ?? []) {
      const x = m * z - x0;
      if (x < -8 || x > viewW + 8) continue;
      flag(ctx, x, RULER_H - 9);
    }
  }

  scroller.addEventListener('scroll', () => {
    drawRuler();
    if (!centred) headers.style.transform = `translateY(${-scroller.scrollTop}px)`;
  });

  const seekFromEvent = (ev: PointerEvent) => {
    const rect = content.getBoundingClientRect();
    let t = (ev.clientX - rect.left) / store.zoom;
    if (store.snapping) {
      const snap = findSnap(t, null);
      if (snap !== null) t = snap;
    }
    player.seek(t);
  };
  ruler.addEventListener('pointerdown', (e) => {
    seekFromEvent(e);
    drag(e, (_dx, _dy, ev) => seekFromEvent(ev));
  });
  playhead.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    drag(e, (_dx, _dy, ev) => seekFromEvent(ev));
  });

  // ---- snapping ----------------------------------------------------------------

  function snapPoints(ignore: string | null): number[] {
    const pts = [0, store.currentTime, ...(store.project.markers ?? [])];
    for (const t of store.project.tracks) for (const c of t.clips) if (c.id !== ignore) pts.push(c.start, clipEnd(c), ...(c.markers ?? []).map((m) => c.start + m));
    return pts;
  }

  function findSnap(t: number, ignore: string | null): number | null {
    const thr = SNAP_PX / store.zoom;
    let best: number | null = null;
    let bestD = thr;
    for (const p of snapPoints(ignore)) {
      const d = Math.abs(p - t);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function showSnap(t: number | null) {
    snapLine.style.display = t === null ? 'none' : 'block';
    if (t !== null) snapLine.style.left = `${t * store.zoom}px`;
  }

  // ---- clip interactions -------------------------------------------------------

  function rowAt(clientY: number): { track: Track | null; above: boolean; below: boolean } {
    const els = [...rows.children] as HTMLElement[];
    if (!els.length) return { track: null, above: true, below: false };
    const first = els[0].getBoundingClientRect();
    const last = els[els.length - 1].getBoundingClientRect();
    if (clientY < first.top) return { track: null, above: true, below: false };
    if (clientY > last.bottom) return { track: null, above: false, below: true };
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return { track: store.project.tracks.find((t) => t.id === el.dataset.id) ?? null, above: false, below: false };
    }
    return { track: null, above: false, below: false };
  }

  function kindOf(c: Clip): TrackKind { return store.trackKindFor(c); }

  function startMove(e: PointerEvent, clip: Clip, track: Track) {
    store.select(clip.id);
    if (track.locked) return;
    const origStart = clip.start;
    const origTrack = track;
    let curTrack = track;
    let checkpointed = false;
    let overlap = false;
    const grabOffset = (e.clientX - content.getBoundingClientRect().left) / store.zoom - clip.start;

    drag(e, (_dx, _dy, ev) => {
      if (!checkpointed) { store.checkpoint(); checkpointed = true; }
      const rect = content.getBoundingClientRect();
      let start = Math.max(0, (ev.clientX - rect.left) / store.zoom - grabOffset);
      let snapped: number | null = null;
      if (store.snapping) {
        const s1 = findSnap(start, clip.id);
        const s2 = findSnap(start + clip.duration, clip.id);
        if (s1 !== null && (s2 === null || Math.abs(s1 - start) <= Math.abs(s2 - start - clip.duration))) { start = s1; snapped = s1; }
        else if (s2 !== null) { start = s2 - clip.duration; snapped = s2; }
      }
      showSnap(snapped);

      // Track switching.
      const { track: hover, above, below } = rowAt(ev.clientY);
      let target = curTrack;
      if (hover && hover.kind === kindOf(clip) && !hover.locked) target = hover;
      else if ((above && kindOf(clip) !== 'audio') || (below && kindOf(clip) === 'audio')) {
        // Dragging past the edge creates a fresh track, as in CapCut.
        if (curTrack.clips.length > 1 || curTrack.main) {
          const nt: Track = { id: uid('trk'), kind: kindOf(clip), clips: [], muted: false, hidden: false, locked: false };
          if (above) store.project.tracks.unshift(nt); else store.project.tracks.push(nt);
          target = nt;
        }
      }
      if (target !== curTrack) {
        if (store.isMagnetic(target) || store.fits(target, start, clip.duration, clip.id)) {
          curTrack.clips = curTrack.clips.filter((c) => c.id !== clip.id);
          target.clips.push(clip);
          if (!curTrack.main && !curTrack.clips.length && curTrack !== origTrack) {
            store.project.tracks = store.project.tracks.filter((t) => t !== curTrack);
          }
          curTrack = target;
        }
      }
      // Follow the pointer freely; an overlap is resolved on drop (CapCut moves it to a free track).
      clip.start = start;
      overlap = !store.isMagnetic(curTrack) && !store.fits(curTrack, start, clip.duration, clip.id);
      render();
      rows.querySelector(`.clip[data-id="${clip.id}"]`)?.classList.toggle('overlap', overlap);
    }, (moved) => {
      showSnap(null);
      if (!moved) return;
      if (overlap) {
        curTrack.clips = curTrack.clips.filter((c) => c.id !== clip.id);
        const placed = store.placeClip(store.project, clip);
        if (placed !== origTrack) toast('Dropped on top of another clip, so it moved to its own track');
      }
      if (clip.start === origStart && curTrack === origTrack && !overlap) return;
      store.normalize();
      store.emit('project');
    });
  }

  function startTrim(e: PointerEvent, clip: Clip, track: Track, side: 'l' | 'r') {
    e.stopPropagation();
    store.select(clip.id);
    if (track.locked) return;
    const orig = { start: clip.start, duration: clip.duration, in: clip.in };
    const srcDur = sourceDuration(clip);
    const others = track.clips.filter((c) => c.id !== clip.id);
    const prevEnd = store.isMagnetic(track) ? 0 : Math.max(0, ...others.filter((c) => clipEnd(c) <= orig.start + 1e-4).map(clipEnd));
    const nextStart = store.isMagnetic(track) ? Infinity : Math.min(Infinity, ...others.filter((c) => c.start >= orig.start + orig.duration - 1e-4).map((c) => c.start));
    let checkpointed = false;
    // Set when the user drags past the end (or start) of the source media.
    let limit: 'source' | 'neighbour' | null = null;

    drag(e, (dx) => {
      if (!checkpointed) { store.checkpoint(); checkpointed = true; }
      let d = dx / store.zoom;
      let snapped: number | null = null;
      limit = null;
      if (side === 'l') {
        let ns = orig.start + d;
        if (store.snapping) { const s = findSnap(ns, clip.id); if (s !== null) { ns = s; snapped = s; } }
        d = ns - orig.start;
        // Can't extend before source start, before the previous clip, or below minimum length.
        const srcMin = -orig.in / clip.speed;
        const minD = Math.max(srcMin, prevEnd - orig.start, -orig.start);
        const maxD = orig.duration - MIN_CLIP;
        if (d < minD - 1e-3) limit = minD === srcMin ? 'source' : 'neighbour';
        d = Math.min(maxD, Math.max(minD, d));
        clip.start = orig.start + d;
        clip.duration = orig.duration - d;
        clip.in = orig.in + d * clip.speed;
      } else {
        let ne = orig.start + orig.duration + d;
        if (store.snapping) { const s = findSnap(ne, clip.id); if (s !== null) { ne = s; snapped = s; } }
        d = ne - orig.start - orig.duration;
        const srcMax = (srcDur - orig.in) / clip.speed;
        const maxDur = Math.min(srcMax, nextStart - orig.start);
        if (orig.duration + d > maxDur + 1e-3) limit = maxDur === srcMax ? 'source' : 'neighbour';
        clip.duration = Math.min(maxDur, Math.max(MIN_CLIP, orig.duration + d));
      }
      showSnap(snapped);
      render();
      rows.querySelector(`.clip[data-id="${clip.id}"]`)?.classList.toggle(`limit-${side}`, limit !== null);
    }, (moved) => {
      showSnap(null);
      if (limit === 'source') {
        const what = clip.type === 'audio' ? 'audio' : 'video';
        toast(side === 'r'
          ? `That's the end of the ${what} (${fmtTime(srcDur)}). To make it longer, slow it down in Speed.`
          : `That's the start of the ${what}. There's no earlier footage to reveal.`);
      } else if (limit === 'neighbour') {
        toast('Another clip is in the way. Move it first, or drop this clip on another track.');
      }
      if (moved) { store.normalize(); store.emit('project'); }
    });
  }

  // ---- drag & drop from media bin / OS ------------------------------------------

  content.addEventListener('dragover', (e) => {
    e.preventDefault();
    content.classList.add('drop');
  });
  content.addEventListener('dragleave', () => content.classList.remove('drop'));
  content.addEventListener('drop', async (e) => {
    e.preventDefault();
    content.classList.remove('drop');
    const rect = content.getBoundingClientRect();
    const t = Math.max(0, (e.clientX - rect.left) / store.zoom);
    const { track } = rowAt(e.clientY);
    if (dropLibItem(e.dataTransfer, t)) return;
    const id = e.dataTransfer?.getData('kinora/media');
    if (id) {
      const m = store.media.get(id);
      if (m) addMediaToTimeline(m, track?.main ? undefined : t, track?.main ? undefined : track?.id);
    } else if (e.dataTransfer?.files.length) {
      await importAndAdd([...e.dataTransfer.files]);
    }
  });
  body.addEventListener('dragover', (e) => e.preventDefault());
  body.addEventListener('drop', async (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (dropLibItem(e.dataTransfer, store.currentTime)) return;
    const id = e.dataTransfer?.getData('kinora/media');
    if (id) { const m = store.media.get(id); if (m) addMediaToTimeline(m); }
    else if (e.dataTransfer?.files.length) await importAndAdd([...e.dataTransfer.files]);
  });

  rows.addEventListener('pointerdown', (e) => {
    if (e.target === rows || (e.target as HTMLElement).classList.contains('tl-row')) {
      store.select(null);
      seekFromEvent(e);
    }
  });

  // ---- rendering ---------------------------------------------------------------

  const clipCanvasCache = new WeakMap<HTMLCanvasElement, string>();

  /** Template clip: each slot's picture tiled across the time it plays. */
  function drawTemplateCanvas(cv: HTMLCanvasElement, clip: Clip, w: number, hgt: number) {
    const nested = nestedProject(clip);
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.min(w, 8000);
    cv.width = Math.max(1, Math.round(vw * dpr));
    cv.height = Math.max(1, Math.round(hgt * dpr));
    cv.style.width = `${vw}px`;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    if (!nested) return;
    const main = nested.tracks.find((t) => t.main);
    for (const c of main?.clips ?? []) {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      const bmp = m?.poster ?? m?.thumbs[0];
      if (!bmp) continue;
      const x0 = (c.start - clip.in) * store.zoom, x1 = x0 + c.duration * store.zoom;
      const tw = Math.max(16, (hgt * bmp.width) / bmp.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, hgt); ctx.clip();
      for (let x = x0; x < x1; x += tw) ctx.drawImage(bmp, x, 0, tw, hgt);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x1 - 1, 0, 2, hgt);
    }
  }

  /** Strip above a selected template clip: one tile per slot, with Replace. */
  function templateStrip(clip: Clip, rowTop: number) {
    const nested = nestedProject(clip);
    const main = nested?.tracks.find((t) => t.main);
    const media = clip.template?.media ?? [];
    // Sits fully above the template clip's row (render() guarantees the room).
    const strip = h('div.tpl-strip', { style: { left: `${clip.start * store.zoom}px`, top: `${rowTop - STRIP_H - STRIP_GAP}px`, height: `${STRIP_H}px` } });
    strip.addEventListener('pointerdown', (e) => e.stopPropagation());
    (main?.clips ?? []).forEach((c, i) => {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      const tile = h('button.tpl-strip-slot', { type: 'button', title: `Replace clip ${i + 1}` },
        mediaStill(m),
        h('span.tpl-strip-replace', null, 'Replace'));
      tile.addEventListener('click', () => openSlotPicker(tile, (pick) => replaceTemplateSlot(clip.id, i, pick.id)));
      strip.append(h('div.tpl-strip-item', null, tile,
        h('div.tpl-strip-dur', null, !media[i] ? h('i.tpl-dot') : null, `${c.duration.toFixed(1)}s`)));
    });
    return strip;
  }

  function drawClipCanvas(cv: HTMLCanvasElement, clip: Clip, w: number, hgt: number) {
    const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
    const key = `${clip.in}|${clip.duration}|${clip.speed}|${w}|${hgt}|${m?.thumbs.length}|${!!m?.peaks}|${clip.volume}|${clip.extractedTo ?? ''}`;
    if (clipCanvasCache.get(cv) === key) return;
    clipCanvasCache.set(cv, key);
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.min(w, 8000);
    cv.width = Math.max(1, Math.round(vw * dpr));
    cv.height = Math.max(1, Math.round(hgt * dpr));
    cv.style.width = `${vw}px`;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    if (!m) return;
    // A video's waveform gets its own strip under the thumbnails (CapCut), so it never covers the picture.
    const waveH = clip.type === 'video' && m.peaks && !clip.extractedTo ? Math.round(hgt * 0.3) : 0;
    const picH = hgt - waveH;
    if ((clip.type === 'video' || clip.type === 'image') && m.thumbs.length) {
      const first = m.thumbs[0];
      const tw = Math.max(16, (picH * first.width) / first.height);
      for (let x = 0; x < vw; x += tw) {
        const src = clip.in + (x / store.zoom) * clip.speed;
        const bmp = thumbAt(m, src);
        if (bmp) ctx.drawImage(bmp, x, 0, tw, picH);
      }
    }
    if (m.peaks && (clip.type === 'audio' || (clip.type === 'video' && !clip.extractedTo))) {
      const isAudio = clip.type === 'audio';
      const band = isAudio ? hgt - 14 : waveH - 3;
      const baseY = hgt - 1;
      if (!isAudio) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, picH, vw, waveH); }
      const wave = isAudio ? 'rgba(160, 255, 210, 0.85)' : 'rgba(140, 230, 255, 0.9)';
      const vol = Math.min(1.5, clip.volume);
      // Peak value (0..1 on the scaled peaks) where the real level reaches about -1 dBFS.
      const redAt = 0.89 / Math.max(1e-6, (m.peakScale ?? 1) * clip.volume);
      for (let x = 0; x < vw; x++) {
        const src = clip.in + (x / store.zoom) * clip.speed;
        const i0 = Math.floor(src * m.peaksPerSecond);
        const i1 = Math.max(i0 + 1, Math.floor((clip.in + ((x + 1) / store.zoom) * clip.speed) * m.peaksPerSecond));
        let v = 0;
        for (let i = i0; i < i1 && i < m.peaks.length; i++) v = Math.max(v, m.peaks[i]);
        const bh = Math.max(1, Math.min(1, v * vol) * band);
        // Only the tip above the loud level (≈ -1 dBFS, real level) is red, as in CapCut.
        const hot = Math.min(bh, Math.max(0, (v - redAt) * vol * band));
        const cool = bh - hot;
        if (isAudio) {
          const top = 12 + (band - bh) / 2;
          ctx.fillStyle = wave;
          ctx.fillRect(x, top + hot / 2, 1, cool);
          if (hot > 0) { ctx.fillStyle = '#ff4d4f'; ctx.fillRect(x, top, 1, hot / 2); ctx.fillRect(x, top + bh - hot / 2, 1, hot / 2); }
        } else {
          ctx.fillStyle = wave;
          ctx.fillRect(x, baseY - cool, 1, cool);
          if (hot > 0) { ctx.fillStyle = '#ff4d4f'; ctx.fillRect(x, baseY - bh, 1, hot); }
        }
      }
    }
  }

  function clipEl(clip: Clip, track: Track, hgt: number) {
    const w = Math.max(2, clip.duration * store.zoom);
    const selected = clip.id === store.selectedId;
    const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
    const el = h(`div.clip.t-${clip.type}`, {
      'data-id': clip.id,
      class: `${selected ? 'selected' : ''} ${track.locked ? 'locked' : ''} ${clip.disabled ? 'disabled' : ''}`,
      // 1px inset each side leaves a visible 2px gap between back-to-back clips.
      style: { left: `${clip.start * store.zoom + 1}px`, width: `${Math.max(2, w - 2)}px`, height: `${hgt - 6}px` },
    });
    if (clip.type === 'template') {
      const cv = h('canvas.clip-canvas') as HTMLCanvasElement;
      el.append(cv);
      drawTemplateCanvas(cv, clip, w, hgt - 6);
      const left = placeholdersLeft(clip);
      const strip = selected && store.templateStripOpen;
      if (strip) {
        el.append(h('button.tpl-clip-chip', { type: 'button', onpointerdown: (e: Event) => e.stopPropagation(), onclick: () => { store.templateStripOpen = false; render(); } }, icon('chevron', 14), 'Hide'));
      } else if (left) {
        el.append(h('button.tpl-clip-chip', {
          type: 'button', onpointerdown: (e: Event) => e.stopPropagation(),
          onclick: () => { store.templateStripOpen = true; store.select(clip.id); render(); },
        }, `${left} clip${left > 1 ? 's' : ''} to be replaced`));
      } else if (selected) {
        el.append(h('button.tpl-clip-chip', { type: 'button', onpointerdown: (e: Event) => e.stopPropagation(), onclick: () => { store.templateStripOpen = true; render(); } }, 'Replace clips'));
      }
    } else if (clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') {
      const cv = h('canvas.clip-canvas') as HTMLCanvasElement;
      el.append(cv);
      // Video/photo clips keep the name and length in a strip above the pictures (CapCut).
      drawClipCanvas(cv, clip, w, hgt - 6 - (clip.type === 'audio' ? 0 : CLIP_HEAD));
    }
    const label = clip.type === 'text' ? clip.text!.content.replace(/\n/g, ' ') : clip.name;
    const def = clip.type === 'sticker' && clip.sticker ? stickerById(clip.sticker.id) : undefined;
    const badges: (HTMLElement | null)[] = [
      clip.speed !== 1 ? h('span.badge', null, `${+clip.speed.toFixed(2)}x`) : null,
      clip.filter.id !== 'none' ? h('span.badge', null, 'FX') : null,
      clip.muted || clip.volume === 0 ? h('span.badge', null, icon('mute', 10)) : null,
    ];
    el.append(h('div.clip-label', null,
      clip.type === 'text' ? icon('text', 11) : clip.type === 'effect' ? icon('effects', 11) : clip.type === 'filter' ? icon('filters', 11) : null,
      def ? h('img.clip-sticker', { src: stickerDataUrl(def, clip.sticker!.color), alt: '' }) : null,
      h('span', null, label), ...badges,
      m && clip.type !== 'image' ? h('span.clip-dur', null, fmtTime(clip.duration)) : null));
    for (const mk of clip.markers ?? []) {
      if (mk < 0 || mk > clip.duration) continue;
      el.append(h('div.clip-marker', { title: `Marker ${fmtTime(clip.start + mk)}`, style: { left: `${mk * store.zoom - 1}px` } }));
    }
    if (clip.fadeIn > 0) el.append(h('div.fade.fade-in', { style: { width: `${clip.fadeIn * store.zoom}px` } }));
    if (clip.fadeOut > 0) el.append(h('div.fade.fade-out', { style: { width: `${clip.fadeOut * store.zoom}px` } }));
    if (clip.transitionIn.type !== 'none') el.append(h('div.tr-mark.in', { title: `In: ${clip.transitionIn.type}`, style: { width: `${clip.transitionIn.duration * store.zoom}px` } }));
    if (clip.transitionOut.type !== 'none') el.append(h('div.tr-mark.out', { title: `Out: ${clip.transitionOut.type}`, style: { width: `${clip.transitionOut.duration * store.zoom}px` } }));
    const hl = h('div.trim.l');
    const hr = h('div.trim.r');
    hl.addEventListener('pointerdown', (e) => startTrim(e as PointerEvent, clip, track, 'l'));
    hr.addEventListener('pointerdown', (e) => startTrim(e as PointerEvent, clip, track, 'r'));
    el.append(hl, hr);
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) startMove(e as PointerEvent, clip, track); });
    el.addEventListener('dblclick', () => player.seek(clip.start));
    onContextMenu(el, () => { if (store.selectedId !== clip.id) store.select(clip.id); return clipMenu(clip, el); });
    return el;
  }

  /** Right-click menu on a timeline clip (CapCut's list; unavailable items are greyed out). */
  /** Items CapCut leaves out of an audio clip's menu. */
  const VIDEO_ONLY = new Set(['Edit', 'Extract audio', 'Recover audio', 'Export selected clips', 'Trim clip', 'Replace clip', 'Edit effects', 'Show variable speed animation', 'Render']);

  function clipMenu(clip: Clip, el: HTMLElement): MenuItem[] {
    const items = fullClipMenu(clip, el);
    if (clip.type !== 'audio') return items;
    const kept = items.filter((it) => it === 'separator' || !VIDEO_ONLY.has(it.label));
    // Tidy separators left next to each other.
    return kept.filter((it, i) => !(it === 'separator' && (i === 0 || kept[i - 1] === 'separator' || i === kept.length - 1)));
  }

  function fullClipMenu(clip: Clip, el: HTMLElement): MenuItem[] {
    const m = clip.mediaId ? store.media.get(clip.mediaId) : undefined;
    const visual = clip.type === 'video' || clip.type === 'image';
    const tr = clip.start < store.currentTime && store.currentTime < clipEnd(clip);
    return [
      { label: 'Copy', shortcut: ['mod', 'c'], onSelect: copySelected },
      { label: 'Cut', shortcut: ['mod', 'x'], onSelect: cutSelected },
      { label: 'Copy attributes', shortcut: ['mod', 'shift', 'c'], onSelect: copyAttributes },
      { label: 'Paste attributes', shortcut: ['mod', 'shift', 'v'], disabled: !hasAttributes(), onSelect: pasteAttributes },
      { label: 'Delete', shortcut: ['del'], onSelect: () => deleteSelected() },
      'separator',
      {
        label: 'Edit', submenu: [
          { label: 'Split', shortcut: ['mod', 'b'], disabled: !tr, onSelect: splitAtPlayhead },
          { label: 'Delete left', shortcut: ['q'], disabled: !tr, onSelect: () => deleteSide('left') },
          { label: 'Delete right', shortcut: ['w'], disabled: !tr, onSelect: () => deleteSide('right') },
          { label: 'Duplicate', shortcut: ['mod', 'd'], onSelect: duplicateSelected },
          { label: 'Mirror', disabled: clip.type === 'audio', onSelect: () => updateClip(clip.id, (x) => { x.transform.flipX = !x.transform.flipX; }) },
          { label: 'Rotate 90°', disabled: clip.type === 'audio', onSelect: () => updateClip(clip.id, (x) => { x.transform.rotation = ((x.transform.rotation + 90 + 180) % 360) - 180; }) },
        ],
      },
      {
        label: isolateProgress(clip.mediaId ?? '') !== undefined ? `Isolate voice (${Math.round((isolateProgress(clip.mediaId!) ?? 0) * 100)}%)` : 'Isolate voice',
        disabled: !(clip.type === 'video' || clip.type === 'audio') || !m || (clip.type === 'video' && !m.hasAudio),
        submenu: [
          { label: "Don't isolate voice", checked: !clip.isolate, onSelect: () => setIsolate(clip.id, undefined) },
          { label: 'Remove vocal', checked: clip.isolate === 'remove', onSelect: () => setIsolate(clip.id, 'remove') },
          { label: 'Keep vocal', checked: clip.isolate === 'keep', onSelect: () => setIsolate(clip.id, 'keep') },
        ],
      },
      clip.extractedTo
        ? { label: 'Recover audio', shortcut: ['shift', 'ctrl', 's'], onSelect: () => recoverAudio(clip) }
        : { label: 'Extract audio', shortcut: ['shift', 'ctrl', 's'], disabled: clip.type !== 'video' || !m?.hasAudio, onSelect: () => extractAudio(clip) },
      { label: 'Sync video and audio', disabled: true, title: 'Select a video and an audio clip to sync' },
      'separator',
      { label: 'Create compound clip (subproject)', shortcut: ['alt', 'g'], disabled: true, title: 'Select two or more clips' },
      { label: 'Save preset', disabled: !visual, onSelect: () => saveAdjustPreset(clip) },
      { label: 'Group', disabled: true, title: 'Select two or more clips' },
      { label: 'Ungroup', disabled: true },
      'separator',
      { label: 'Export selected clips', onSelect: () => exportClip(clip) },
      { label: clip.disabled ? 'Activate clip' : 'Deactivate clip', shortcut: ['v'], onSelect: () => toggleDisabled(clip) },
      { label: 'Trim clip', disabled: true },
      { label: 'Replace clip', disabled: !visual && clip.type !== 'audio', onSelect: () => openSlotPicker(el, (pick) => replaceClipMedia(clip, pick)) },
      { label: 'Link to media', disabled: m?.status !== 'error', onSelect: () => void relink(m!) },
      { label: 'Open file location', disabled: !m, onSelect: () => { store.leftTab = 'media'; store.mediaSelectedId = m!.id; store.emit('view', 'media'); } },
      'separator',
      { label: 'Edit effects', disabled: !clip.effect || clip.effect.id === 'none', onSelect: () => { store.leftTab = 'effects'; store.emit('view'); } },
      { label: 'Show variable speed animation', disabled: true },
      {
        label: 'Range', submenu: [
          { label: 'Play clip', onSelect: () => player.playRange(clip.start, clipEnd(clip)) },
          { label: 'Zoom to clip', onSelect: () => { setZoom((scroller.clientWidth - 80) / Math.max(0.2, clip.duration)); scroller.scrollLeft = Math.max(0, clip.start * store.zoom - 40); } },
        ],
      },
      { label: 'Render', submenu: [{ label: 'Render clip', disabled: true, title: 'Kinora plays edits live, so nothing needs pre-rendering' }] },
    ];
  }

  async function relink(m: MediaItem) {
    const [file] = await pickFiles();
    if (file && await relinkMedia(m, file)) { store.emit('media', 'project'); toast(`Linked “${m.name}”`, 'ok'); }
  }

  /** Exports just this clip: a copy of the timeline holding only it, starting at 0. */
  function exportClip(clip: Clip) {
    const p = structuredClone(store.project);
    for (const t of p.tracks) t.clips = t.clips.filter((c) => c.id === clip.id).map((c) => ({ ...c, start: 0 }));
    openExportDialog(player, p);
  }

  function header(track: Track, hgt: number) {
    const toggle = (name: string, on: boolean, title: string, fn: () => void) =>
      h(`button.th-btn${on ? '.on' : ''}`, { title, onclick: () => { store.commit(() => fn()); } }, icon(name, 14));
    const btns: HTMLElement[] = [];
    if (track.kind === 'audio' || track.main) btns.push(toggle(track.muted ? 'mute' : 'volume', track.muted, track.muted ? 'Unmute track' : 'Mute track', () => { track.muted = !track.muted; }));
    if (track.kind !== 'audio') btns.push(toggle(track.hidden ? 'eyeOff' : 'eye', track.hidden, track.hidden ? 'Show track' : 'Hide track', () => { track.hidden = !track.hidden; }));
    btns.push(toggle(track.locked ? 'lock' : 'unlock', track.locked, track.locked ? 'Unlock track' : 'Lock track', () => { track.locked = !track.locked; }));
    const kindIcon = track.kind === 'audio' ? 'audio' : track.kind === 'text' ? 'text' : track.kind === 'effect' ? 'effects' : 'film';
    return h('div.tl-header', { style: { height: `${hgt}px` }, class: track.main ? 'main' : '' },
      h('span.th-kind', { title: track.main ? 'Main track' : `${track.kind} track` }, icon(kindIcon, 13)),
      h('div.th-btns', null, btns),
    );
  }

  function render() {
    const p = store.project;
    clear(rows);
    clear(headers);
    const viewW = scroller.clientWidth || 800;
    const width = centred
      ? Math.max(1, store.duration * store.zoom)
      : Math.max(viewW, (store.duration + Math.max(30, viewW / store.zoom * 0.5)) * store.zoom);
    if (centred) {
      lead = Math.max(0, viewW / 2 - HEADERS_W);
      content.style.marginLeft = `${timeOrigin()}px`;
      // Room after the end so the last frame can reach the centre line.
      content.style.marginRight = `${viewW / 2}px`;
      headersWrap.style.left = `${lead}px`;
      centreLine.style.left = `${viewW / 2}px`;
    }
    content.style.width = `${width}px`;
    rows.style.width = `${width}px`;
    let total = 0;
    let stripFor: { clip: Clip; offset: number } | null = null;
    for (const track of p.tracks) {
      const hgt = trackHeight(track);
      total += hgt;
      const row = h(`div.tl-row.k-${track.kind}`, { 'data-id': track.id, class: `${track.main ? 'main' : ''} ${track.hidden || track.muted ? 'dim' : ''}`, style: { height: `${hgt}px` } });
      for (const clip of track.clips) {
        row.append(clipEl(clip, track, hgt));
        if (clip.type === 'template' && clip.id === store.selectedId && store.templateStripOpen) stripFor = { clip, offset: total - hgt };
      }
      // Transition markers sit on the cut, spanning the transition's duration.
      for (const x of trackTransitions(track)) {
        const w = Math.max(16, (x.end - x.start) * store.zoom);
        const mark = h(`button.xf-mark${store.selectedId === x.b.id ? '.selected' : ''}`, {
          type: 'button', title: `Transition: ${displayName(x.type)}`,
          style: { left: `${x.b.start * store.zoom - w / 2}px`, width: `${w}px`, top: `${(hgt - 22) / 2}px` },
        }, icon('transitions', 12));
        mark.addEventListener('pointerdown', (e) => e.stopPropagation());
        mark.addEventListener('click', () => { store.inspectorTab = 'Transition'; store.select(x.b.id); store.emit('view'); });
        row.append(mark);
      }
      rows.append(row);
      headers.append(header(track, hgt));
    }
    // Like CapCut, the track stack floats in the vertical middle of the timeline.
    const avail = scroller.clientHeight - RULER_H;
    let pad = Math.max(10, Math.floor((avail - total) / 2));
    // Make room above a template clip for its slot strip so the strip never covers the clip.
    if (stripFor) pad = Math.max(pad, STRIP_H + STRIP_GAP + 4 - stripFor.offset);
    rows.style.paddingTop = `${pad}px`;
    headers.style.paddingTop = `${pad}px`;
    if (stripFor) rows.append(templateStrip(stripFor.clip, pad + stripFor.offset));
    content.style.height = `${Math.max(total + pad + 24, avail)}px`;
    const hasClips = p.tracks.some((t) => t.clips.length);
    empty.style.display = hasClips ? 'none' : 'flex';
    undoBtn.toggleAttribute('disabled', !store.canUndo);
    redoBtn.toggleAttribute('disabled', !store.canRedo);
    const sel = !!store.selectedId;
    delBtn.toggleAttribute('disabled', !sel);
    dupBtn.toggleAttribute('disabled', !sel);
    const visualSel = sel && store.selected?.type !== 'audio';
    mirrorBtn.toggleAttribute('disabled', !visualSel);
    rotateBtn.toggleAttribute('disabled', !visualSel);
    snapBtn.classList.toggle('active', store.snapping);
    magnetBtn.classList.toggle('active', store.mainMagnet);
    magnetBtn.title = `Main track magnet: ${store.mainMagnet ? 'on' : 'off'}`;
    zoomSlider.value = zoomToSlider(store.zoom);
    zoomSlider.style.setProperty('--p', `${+zoomSlider.value / 10}%`);
    drawRuler();
    positionPlayhead();
  }

  function positionPlayhead() {
    if (centred) { syncScroll(); return; }
    const x = store.currentTime * store.zoom;
    playhead.style.transform = `translateX(${x}px)`;
    if (store.playing) {
      const viewW = scroller.clientWidth;
      if (x > scroller.scrollLeft + viewW - 60 || x < scroller.scrollLeft) scroller.scrollLeft = x - 60;
    }
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  store.on('project', schedule);
  store.on('select', schedule);
  store.on('media', schedule);
  store.on('view', schedule);
  store.on('time', positionPlayhead);
  new ResizeObserver(schedule).observe(scroller);
  applyMode();
  render();

  return { fitZoom, setZoom };
}
