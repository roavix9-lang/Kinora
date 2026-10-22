import './styles.css';
import {
  copyAttributes, copySelected, cutSelected, deleteSelected, deleteSide, duplicateSelected, extractAudio, pasteAttributes, pasteClip, recoverAudio,
  splitAtPlayhead, toggleDisabled, toggleMarker,
} from './actions';

import { Player } from './engine/player';
import { store } from './store';
import { h, icon, toast } from './ui/dom';
import { openExportDialog } from './ui/exportDialog';
import { importOnly } from './ui/importer';
import { mountInspector } from './ui/inspector';
import { mountLeftPanel } from './ui/leftpanel';
import { mountPreview } from './ui/preview';
import { initAssets, onAssetsChanged } from './engine/assets';
import { flushSave, initPersistence } from './engine/persist';
import { go, parseRoute } from './router';
import { mountHome } from './ui/home';
import { initIsolate } from './engine/isolate';
import { ensureTemplateMedia } from './engine/sampleMedia';
import { initLibraryPreview } from './ui/libraryPreview';
import { mountTimeline } from './ui/timeline';
import { initDsp } from './wasm/dsp';

function unsupported(): string | null {
  if (!('VideoDecoder' in window) || !('VideoEncoder' in window)) return 'This browser lacks WebCodecs. Use a recent Chrome, Edge, or Safari 17+ / Firefox 130+.';
  if (!document.createElement('canvas').getContext('webgl2')) return 'WebGL2 is required for the compositor.';
  return null;
}

async function boot() {
  const app = document.getElementById('app')!;
  const route = parseRoute();
  // Home and Templates are their own light pages; the editor only boots for a project.
  if (route.page !== 'edit') {
    mountHome(app, route.page);
    return;
  }
  const problem = unsupported();
  if (problem) {
    app.append(h('div.fatal', null, h('div.logo-mark', null, icon('logo', 28)), h('h1', null, 'Kinora needs a newer browser'), h('p', null, problem)));
    return;
  }
  await initDsp();

  const canvas = h('canvas.preview-canvas') as HTMLCanvasElement;
  const player = new Player(canvas);

  // ---- top bar ---------------------------------------------------------------
  const nameEl = h('input.project-name', { value: store.projectTitle, spellcheck: false, 'aria-label': 'Project name' }) as HTMLInputElement;
  nameEl.addEventListener('change', () => { store.projectTitle = nameEl.value.trim() || 'Untitled project'; store.emit('view'); });
  store.on('view', () => { if (document.activeElement !== nameEl) nameEl.value = store.projectTitle; });
  const savedAt = h('span.save-state');
  const stamp = () => { savedAt.textContent = `Edited ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; };
  stamp();
  store.on('project', stamp);

  const body = document.body;
  const toggleDrawer = (cls: string) => {
    const on = !body.classList.contains(cls);
    body.classList.remove('show-left', 'show-right');
    if (on) body.classList.add(cls);
  };
  const topbar = h('header.topbar', null,
    h('div.tb-left', null,
      h('button.brand', { type: 'button', title: 'Back to Home', 'aria-label': 'Back to Home', onclick: () => void flushSave().then(() => go({ page: 'home' })) }, h('div.logo-mark', null, icon('logo', 16)), h('span', null, 'Kinora')),
      h('button.icon-btn.drawer-btn.drawer-left', { title: 'Media panel', 'aria-label': 'Toggle media panel', onclick: () => toggleDrawer('show-left') }, icon('panelL')),
      savedAt,
    ),
    h('div.tb-center', null, nameEl),
    h('div.tb-right', null,
      h('button.icon-btn.drawer-btn.drawer-right', { title: 'Properties panel', 'aria-label': 'Toggle properties panel', onclick: () => toggleDrawer('show-right') }, icon('panelR')),
      h('button.export-btn', { onclick: () => openExportDialog(player) }, icon('upload', 16), h('span', null, 'Export')),
    ),
  );

  // ---- layout ----------------------------------------------------------------
  const panel = h('aside.left-panel.card', { 'aria-label': 'Media and assets' });
  const previewEl = h('section.preview.card', { 'aria-label': 'Player' });
  const inspector = h('aside.inspector.card', { 'aria-label': 'Properties' });
  const timelineEl = h('section.timeline', { 'aria-label': 'Timeline' });
  // Plain gap between the player area and the timeline (its height is automatic).
  const splitter = h('div.h-splitter', { 'aria-hidden': 'true' });
  const scrim = h('div.scrim', { onclick: () => body.classList.remove('show-left', 'show-right') });
  const workspace = h('div.workspace', null, panel, previewEl, inspector, scrim);
  app.append(topbar, workspace, splitter, timelineEl);
  // Selecting a clip on a narrow screen opens the properties drawer automatically.
  store.on('select', () => { if (store.selectedId && window.innerWidth < 1100 && body.classList.contains('show-left')) body.classList.remove('show-left'); });

  // The upper area's height is automatic (sized so the video fills the player width).
  try { localStorage.removeItem('kinora.timelineH'); } catch { /* storage unavailable */ }

  // Library assets come from Cloudflare (D1 catalog, R2 files); downloaded ones load from the
  // browser cache, so this works offline. Redraw once they're registered.
  void initAssets().then(() => player.invalidate());
  // Restore the last session (timelines + media) and keep saving it.
  // Open this project (and keep saving it); covers for Home come from the player.
  // Panels stay hidden until the project is back, so an empty editor doesn't flash first.
  document.body.classList.add('restoring');
  void initPersistence(route.id, () => {
    try {
      player.draw(store.currentTime);
      const k = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(canvas.width * k));
      c.height = Math.max(1, Math.round(canvas.height * k));
      c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
      return store.project.tracks.some((t) => t.clips.length) ? c.toDataURL('image/webp', 0.7) : null;
    } catch { return null; }
  }).finally(() => document.body.classList.remove('restoring'));
  initIsolate();
  // Template songs and samples aren't saved with the project; fetch them again (offline cache first).
  store.on('project', () => ensureTemplateMedia(store.project));
  onAssetsChanged(() => player.invalidate());
  mountLeftPanel(panel, player);
  mountPreview(previewEl, canvas, player);
  initLibraryPreview(player);
  mountInspector(inspector, player);
  const tl = mountTimeline(timelineEl, player);

  // ---- global drag & drop ------------------------------------------------------
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer?.files.length) await importOnly([...e.dataTransfer.files]);
  });

  // ---- keyboard ------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const fps = store.project.fps;
    let handled = true;
    if (k === ' ') player.toggle();
    else if (mod && e.shiftKey && k === 'c') copyAttributes();
    else if (mod && e.shiftKey && k === 'v') pasteAttributes();
    else if (mod && !e.shiftKey && k === 'c') copySelected();
    else if (mod && !e.shiftKey && k === 'x') cutSelected();
    else if (mod && !e.shiftKey && k === 'v') pasteClip();
    else if (e.ctrlKey && e.shiftKey && k === 's') { const c = store.selected; if (c) (c.extractedTo ? recoverAudio(c) : extractAudio(c)); }
    else if (!mod && !e.shiftKey && k === 'v') { if (store.selected) toggleDisabled(store.selected); }
    else if (mod && k === 'z' && !e.shiftKey) store.undo();
    else if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) store.redo();
    else if ((mod && k === 'b') || (!mod && k === 's')) splitAtPlayhead();
    else if (mod && k === 'd') duplicateSelected();
    else if (mod && k === 'e') openExportDialog(player);
    else if (k === 'delete' || k === 'backspace') deleteSelected(e.shiftKey);
    else if (k === 'arrowleft') e.shiftKey ? player.seek(store.currentTime - 1) : player.step(-1);
    else if (k === 'arrowright') e.shiftKey ? player.seek(store.currentTime + 1) : player.step(1);
    else if (k === 'home') player.seek(0);
    else if (k === 'end') player.seek(store.duration);
    else if (k === '=' || k === '+') tl.setZoom(store.zoom * 1.4);
    else if (k === '-') tl.setZoom(store.zoom / 1.4);
    else if (k === 'z' && e.shiftKey) tl.fitZoom();
    else if (!mod && k === 'q') deleteSide('left');
    else if (!mod && k === 'w') deleteSide('right');
    else if (!mod && k === 'm') toggleMarker();
    else if (k === 'n') { store.snapping = !store.snapping; store.emit('view'); toast(`Snapping ${store.snapping ? 'on' : 'off'}`); }
    else if (k === 'escape') { store.select(null); body.classList.remove('show-left', 'show-right'); }
    else if (k === 'j') player.seek(store.currentTime - 10 / fps);
    else if (k === 'l') player.seek(store.currentTime + 10 / fps);
    else handled = false;
    if (handled) e.preventDefault();
  });

  // Offline support (production only: in dev it would cache the hot-reloading modules).
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }

  // Dev builds skip the leave-page prompt so hot reloads don't get blocked.
  if (import.meta.env.PROD) {
    window.addEventListener('beforeunload', (e) => {
      if (store.project.tracks.some((t) => t.clips.length)) e.preventDefault();
    });
  }
}

// Page changes from the browser's back / forward buttons.
window.addEventListener('hashchange', () => { const r = parseRoute(); if ((r.page === 'edit') !== !!document.querySelector('.topbar')) location.reload(); });

void boot();
