import { VideoCodec } from 'mediabunny';
import { exportProject, hasVisual, projectDuration, supportedCodecs, VIDEO_CODECS } from '../engine/export';
import { Project } from '../types';
import { FRAME_RATES } from './projectSettings';
import { Player } from '../engine/player';
import { sizeForRatio, store } from '../store';
import { clear, fmtBytes, fmtTime, h, icon, toast } from './dom';
import { closePopover, dropdown } from './select';

const QUALITY = [
  { id: 'low', name: 'Lower (smaller file)', bpp: 0.05 },
  { id: 'rec', name: 'Recommended', bpp: 0.1 },
  { id: 'high', name: 'Higher', bpp: 0.17 },
];

type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

/** Opens the export dialog for the current timeline, or for `project` (e.g. a single media item). */
export function openExportDialog(player: Player, project?: Project) {
  const p = project ?? store.project;
  const duration = projectDuration(p);
  const visual = hasVisual(p);
  if (duration <= 0) { toast('Add something to the timeline first'); return; }
  player.pause();
  const state = {
    name: (project ? p.name : store.projectTitle).replace(/[^\w\- ]+/g, '').trim() || 'kinora-export',
    short: Math.min(p.width, p.height) as number,
    fps: p.fps,
    container: 'mp4' as 'mp4' | 'webm',
    codec: 'auto' as VideoCodec | 'auto',
    quality: 'rec',
    audio: true,
    toDisk: 'showSaveFilePicker' in window && Math.min(p.width, p.height) >= 2160,
  };
  let supported: VideoCodec[] = [];
  let ctrl: AbortController | null = null;

  const backdrop = h('div.modal-backdrop');
  const modal = h('div.modal');
  backdrop.append(modal);
  document.body.append(backdrop);
  const close = () => { ctrl?.abort(); closePopover(); backdrop.remove(); };
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop && !ctrl) close(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ctrl) close(); });

  const dims = () => sizeForRatio(p.width / p.height, state.short);
  const bpp = () => QUALITY.find((q) => q.id === state.quality)!.bpp;

  async function refreshCodecs() {
    if (!visual) { supported = ['avc']; renderForm(); return; }
    const [w, hh] = dims();
    supported = await supportedCodecs(state.container, w, hh, w * hh * state.fps * bpp());
    if (state.codec !== 'auto' && !supported.includes(state.codec)) state.codec = 'auto';
    renderForm();
  }

  function field(label: string, control: HTMLElement) {
    return h('div.ex-field', null, h('label', null, label), control);
  }

  function sel<T extends string | number>(value: T, opts: { id: T; name: string; disabled?: boolean }[], on: (v: T) => void) {
    return dropdown(value, opts, on);
  }

  function renderForm() {
    clear(modal);
    const [w, hh] = dims();
    const est = (visual ? (w * hh * state.fps * bpp() * duration) / 8 : 0) + (state.audio || !visual ? 24000 * duration : 0);
    const nameInp = h('input.text-field', { value: state.name }) as HTMLInputElement;
    nameInp.addEventListener('input', () => { state.name = nameInp.value; });
    const resOpts = [720, 1080, 1440, 2160].map((s) => {
      const [a, b] = sizeForRatio(p.width / p.height, s);
      return { id: s, name: `${s === 2160 ? '4K' : s === 1440 ? '2K' : `${s}p`} · ${a}×${b}` };
    });
    const codecOpts: { id: VideoCodec | 'auto'; name: string; disabled?: boolean }[] = [
      { id: 'auto', name: 'Auto (best supported)' },
      ...VIDEO_CODECS.concat(state.container === 'webm' ? [{ id: 'vp8' as VideoCodec, name: 'VP8' }] : [])
        .filter((c) => state.container === 'mp4' ? c.id !== 'vp8' : ['vp9', 'av1', 'vp8'].includes(c.id))
        .map((c) => ({ id: c.id, name: supported.includes(c.id) ? c.name : `${c.name} (not supported)`, disabled: !supported.includes(c.id) })),
    ];
    modal.append(
      h('div.modal-head', null, h('h2', null, project ? `Export “${p.name}”` : 'Export'), h('button.icon-btn', { onclick: close }, icon('x'))),
      !visual ? h('div.ex-grid', null, field('File name', nameInp),
        field('Format', sel(state.container, [{ id: 'mp4', name: 'M4A (AAC)' }, { id: 'webm', name: 'WebM (Opus)' }], (v) => { state.container = v; renderForm(); }))) : '',
      visual ? h('div.ex-grid', null,
        field('File name', nameInp),
        field('Resolution', sel(state.short, resOpts, (v) => { state.short = v; void refreshCodecs(); })),
        field('Frame rate', sel(state.fps, FRAME_RATES.map((f) => ({ id: f, name: `${f} fps` })), (v) => { state.fps = v; void refreshCodecs(); })),
        field('Format', sel(state.container, [{ id: 'mp4', name: 'MP4' }, { id: 'webm', name: 'WebM' }], (v) => { state.container = v; void refreshCodecs(); })),
        field('Codec', sel(state.codec, codecOpts, (v) => { state.codec = v; renderForm(); })),
        field('Quality', sel(state.quality, QUALITY.map((q) => ({ id: q.id, name: q.name })), (v) => { state.quality = v; void refreshCodecs(); })),
      ) : '',
      !visual ? '' : h('label.check', null, h('input', { type: 'checkbox', checked: state.audio, onchange: (e: Event) => { state.audio = (e.target as HTMLInputElement).checked; renderForm(); } }), 'Include audio'),
      'showSaveFilePicker' in window
        ? h('label.check', null, h('input', { type: 'checkbox', checked: state.toDisk, onchange: (e: Event) => { state.toDisk = (e.target as HTMLInputElement).checked; } }), 'Stream directly to disk (recommended for 4K and long videos)')
        : '',
      h('div.ex-summary', null,
        h('span', null, visual ? `${w}×${hh} · ${state.fps} fps · ${fmtTime(duration)}` : `Audio only · ${fmtTime(duration)}`),
        h('span', null, `≈ ${fmtBytes(est)}`),
        h('span.ex-hw', null, icon('check', 12), 'Hardware-accelerated WebCodecs encode')),
      supported.length === 0 ? h('div.hint.warn', null, 'Checking encoder support…') : '',
      h('div.modal-foot', null,
        h('button.ghost-btn', { onclick: close }, 'Cancel'),
        h('button.primary-btn', { onclick: start, disabled: supported.length === 0 }, icon('download', 16), 'Export')),
    );
  }

  async function start() {
    const [w, hh] = dims();
    let fileHandle: FileSystemFileHandle | undefined;
    const ext = visual ? state.container : state.container === 'mp4' ? 'm4a' : 'webm';
    const fname = `${state.name || 'kinora-export'}.${ext}`;
    const mime = `${visual ? 'video' : 'audio'}/${state.container}`;
    if (state.toDisk && 'showSaveFilePicker' in window) {
      try {
        fileHandle = await (window as unknown as { showSaveFilePicker: Picker }).showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }],
        });
      } catch { return; }
    }
    ctrl = new AbortController();
    clear(modal);
    const bar = h('div.progress-fill');
    const pctEl = h('div.progress-pct', null, '0%');
    const stage = h('div.progress-stage', null, 'Preparing…');
    const meta = h('div.progress-meta');
    modal.append(
      h('div.modal-head', null, h('h2', null, 'Exporting…')),
      h('div.progress-wrap', null, pctEl, h('div.progress', null, bar), stage, meta),
      h('div.modal-foot', null, h('button.ghost-btn', { onclick: () => ctrl?.abort() }, 'Cancel')),
    );
    const t0 = performance.now();
    try {
      const res = await exportProject({
        width: w, height: hh, fps: state.fps, container: state.container, codec: state.codec, bpp: bpp(),
        includeAudio: state.audio, fileHandle, signal: ctrl.signal, project: p,
        onProgress: ({ frame, total, fps, stage: s }) => {
          const f = frame / total;
          bar.style.width = `${f * 100}%`;
          pctEl.textContent = `${Math.floor(f * 100)}%`;
          stage.textContent = s;
          if (fps > 0) {
            const eta = (total - frame) / fps;
            meta.textContent = `Frame ${frame} / ${total} · ${fps.toFixed(1)} fps · ${fmtTime(eta)} left · ${((performance.now() - t0) / 1000).toFixed(0)}s elapsed`;
          }
        },
      });
      ctrl = null;
      done(res.blob, fname, res.codec, res.bytes, res.seconds, w, hh);
    } catch (err) {
      ctrl = null;
      if ((err as DOMException).name === 'AbortError') { toast('Export cancelled'); close(); return; }
      console.error(err);
      clear(modal);
      modal.append(
        h('div.modal-head', null, h('h2', null, 'Export failed'), h('button.icon-btn', { onclick: close }, icon('x'))),
        h('div.hint.warn', null, err instanceof Error ? err.message : String(err)),
        h('div.modal-foot', null, h('button.ghost-btn', { onclick: () => renderForm() }, 'Back')),
      );
    }
  }

  function done(blob: Blob | undefined, fname: string, codec: string, bytes: number, secs: number, w: number, hh: number) {
    clear(modal);
    const url = blob ? URL.createObjectURL(blob) : '';
    const dl = () => { const a = h('a', { href: url, download: fname }) as HTMLAnchorElement; a.click(); };
    modal.append(
      h('div.modal-head', null, h('h2', null, 'Export complete'), h('button.icon-btn', { onclick: () => { if (url) URL.revokeObjectURL(url); close(); } }, icon('x'))),
      url ? h(visual ? 'video.ex-video' : 'audio.ex-video', { src: url, controls: true }) : h('div.hint', null, `Saved to ${fname}`),
      h('div.ex-summary', null,
        h('span', null, visual ? `${w}×${hh} · ${codec.toUpperCase()}` : 'Audio'),
        h('span', null, fmtBytes(bytes)),
        h('span', null, `Rendered in ${secs.toFixed(1)}s (${(duration / secs).toFixed(2)}× realtime)`)),
      h('div.modal-foot', null, url ? h('button.primary-btn', { onclick: dl }, icon('download', 16), 'Download') : null),
    );
    if (url) dl();
  }

  renderForm();
  void refreshCodecs();
}
