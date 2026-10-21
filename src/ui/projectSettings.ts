import { Player } from '../engine/player';
import { applyRatio, aspectOf, ASPECT_GROUPS, sizeForRatio, store, targetShortEdge } from '../store';
import { h, toast } from './dom';
import { closePopover, dropdown } from './select';

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

const RESOLUTIONS: { id: 'adapted' | number; name: string }[] = [
  { id: 'adapted', name: 'Adapted' }, { id: 720, name: '720p' }, { id: 1080, name: '1080p' },
  { id: 1440, name: '2K' }, { id: 2160, name: '4K' },
];

const SAVE_TO = 'This browser tab';
const ratioLabel = (k: string) => (k === 'original' ? 'Original' : k === 'custom' ? 'Custom' : k);
const resLabel = (r: 'adapted' | number | undefined) => RESOLUTIONS.find((x) => x.id === (r ?? 'adapted'))?.name ?? `${r}p`;
const mediaLabel = () => (store.copyMedia ? 'Copy media to project' : 'Stay in original location');

const ARRANGE_TIP = 'Clips dropped on top of each other move to their own track automatically.';
const PROXY_TIP = 'Media is decoded at full quality with WebCodecs, so no proxy files are made.';
const FPS_TIP = 'Frames per second for playback and export.';

function help(text: string) {
  return h('span.help', { title: text, 'aria-label': text, tabindex: 0 }, '?');
}

function detailRow(label: string, value: string, tip?: string) {
  return h('div.det-row', null, h('span.det-label', null, `${label}:`, tip ? help(tip) : null), h('span.det-value', null, value));
}

/** Read-only "Details" view shown on the right when nothing is selected (CapCut layout). */
export function detailsPanel(root: HTMLElement, player: Player) {
  const p = store.project;
  root.append(h('div.insp-tabs', null, h('button.active', null, 'Details')));
  const body = h('div.insp-body.det-body');
  body.append(
    detailRow('Name', store.projectTitle),
    detailRow('Path', SAVE_TO),
    detailRow('Color space', 'Rec. 709 SDR'),
    detailRow('Imported media', mediaLabel()),
    detailRow('Arrange layers', 'Turned on', ARRANGE_TIP),
    detailRow('Proxy', 'Turned off', PROXY_TIP),
    h('div.det-sep'),
    detailRow('Timeline name', store.timelineName(store.activeTimelineId)),
    detailRow('Aspect ratio', ratioLabel(aspectOf(p))),
    detailRow('Resolution', resLabel(p.resolution)),
    detailRow('Frame rate', `${p.fps.toFixed(2)}fps`),
  );
  root.append(body, h('div.det-foot', null, h('button.det-modify', { type: 'button', onclick: () => openProjectSettings(player) }, 'Modify')));
}

/** "Project settings" dialog: Details + Performance tabs, Cancel / Save. */
export function openProjectSettings(player: Player) {
  const p = store.project;
  const draft = {
    title: store.projectTitle,
    copyMedia: store.copyMedia,
    ratio: aspectOf(p) === 'custom' ? '16:9' : aspectOf(p),
    resolution: (p.resolution ?? 'adapted') as 'adapted' | number,
    fps: p.fps,
    previewFull: store.previewFull,
    hwDecode: store.hwDecode,
  };
  let tab: 'details' | 'performance' = 'details';

  const close = () => { closePopover(); backdrop.remove(); };
  const modal = h('div.modal.ps-modal', { role: 'dialog', 'aria-label': 'Project settings' });
  const backdrop = h('div.modal-backdrop', {
    onpointerdown: (e: Event) => { if (e.target === backdrop) close(); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); },
  }, modal);

  const row = (label: string, control: HTMLElement | string, tip?: string) =>
    h('div.ps-row', null, h('div.ps-label', null, label, tip ? help(tip) : null), typeof control === 'string' ? h('div.ps-text', null, control) : control);

  const toggle = (on: boolean, change: (v: boolean) => void, label: string, disabled = false) =>
    h('label.switch.ps-switch', null, h('input', { type: 'checkbox', checked: on, disabled, 'aria-label': label, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) }), h('i'));

  function radio(name: string, label: string, checked: boolean, on: () => void) {
    return h('label.ps-radio', null, h('input', { type: 'radio', name, checked, onchange: on }), h('span', null, label));
  }

  function details() {
    const name = h('input.text-field', { value: draft.title, 'aria-label': 'Name', spellcheck: false }) as HTMLInputElement;
    name.addEventListener('input', () => { draft.title = name.value; });
    return h('div.ps-card', null,
      h('div.ps-heading', null, 'Details'),
      row('Name', name),
      row('Save to', SAVE_TO),
      row('Imported media', h('div.ps-radios', null,
        radio('ps-media', 'Copy media to project', draft.copyMedia, () => { draft.copyMedia = true; }),
        radio('ps-media', 'Stay in original location', !draft.copyMedia, () => { draft.copyMedia = false; }))),
      row('Color space', dropdown('rec709', [{ id: 'rec709', name: 'Rec. 709 SDR' }], () => {})),
      row('Arrange layers', h('div.ps-stack', null,
        toggle(true, () => {}, 'Arrange layers', true),
        h('div.ps-note', null, '*Cannot be turned off after turned on')), ARRANGE_TIP),
      h('div.ps-sep'),
      h('div.ps-heading', null, 'Timeline settings'),
      row('Apply to', store.timelineName(store.activeTimelineId)),
      row('Aspect ratio', dropdown(draft.ratio, ['original', ...ASPECT_GROUPS.flat()].map((k) => ({ id: k, name: ratioLabel(k) })), (v) => { draft.ratio = v; })),
      row('Resolution', dropdown(draft.resolution, RESOLUTIONS, (v) => { draft.resolution = v; })),
      row('Frame rate', dropdown(draft.fps, FRAME_RATES.map((f) => ({ id: f, name: `${f.toFixed(2)} fps` })), (v) => { draft.fps = v; }), FPS_TIP),
    );
  }

  function performance() {
    return h('div.ps-card', null,
      row('Full-resolution preview', toggle(draft.previewFull, (v) => { draft.previewFull = v; }, 'Full-resolution preview')),
      row('Hardware decoding', toggle(draft.hwDecode, (v) => { draft.hwDecode = v; }, 'Hardware decoding')),
    );
  }

  function render() {
    modal.replaceChildren(
      h('div.ps-head', null, h('h2', null, 'Project settings')),
      h('div.sub-tabs.ps-tabs', null,
        h(`button${tab === 'details' ? '.active' : ''}`, { type: 'button', onclick: () => { tab = 'details'; render(); } }, 'Details'),
        h(`button${tab === 'performance' ? '.active' : ''}`, { type: 'button', onclick: () => { tab = 'performance'; render(); } }, 'Performance')),
      tab === 'details' ? details() : performance(),
      h('div.ps-foot', null,
        h('button.ps-btn.cancel', { type: 'button', onclick: close }, 'Cancel'),
        h('button.ps-btn.save', { type: 'button', onclick: save }, 'Save')),
    );
  }

  function save() {
    store.projectTitle = draft.title.trim() || 'Untitled project';
    store.copyMedia = draft.copyMedia;
    store.commit((pp) => {
      pp.fps = draft.fps;
      pp.resolution = draft.resolution;
      applyRatio(pp, draft.ratio, store.media);
      if (draft.ratio === 'original' && !pp.tracks.some((t) => t.clips.length)) {
        [pp.width, pp.height] = sizeForRatio(pp.width / pp.height, targetShortEdge(pp, store.media));
      }
    });
    store.previewFull = draft.previewFull;
    if (draft.hwDecode !== store.hwDecode) { store.hwDecode = draft.hwDecode; player.resetDecoders(); }
    store.emit('view');
    close();
    toast('Project settings saved', 'ok');
  }

  render();
  document.body.append(backdrop);
}
