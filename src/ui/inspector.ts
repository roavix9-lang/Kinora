import { extractAudio, previousAdjacent, recoverAudio, replaceTemplateSlot, resolveOverlap, setSpeed, updateClip } from '../actions';
import { nestedProject, placeholdersLeft, templateDef } from '../engine/templateClips';
import { mediaStill, openSlotPicker } from './slotPicker';
import { ADJUST_TABS, adjustContent, adjustFooter } from './adjustPanel';
import { displayName, transitions } from '../engine/gltransitions';
import { allEffects, FONTS, TRANSITIONS } from '../catalog';
import { catalogOf, download, isDownloaded, isDownloading } from '../engine/assets';
import { AnimKey, cssKeyframes } from '../engine/anims';
import { lutList } from '../engine/luts';
import { lookPreview } from './lookPreview';
import { baseSize } from '../engine/layout';
import { Player } from '../engine/player';
import { stickerById, stickerDataUrl } from '../stickers';
import { store } from '../store';
import { Clip, defaultChroma, TextStyle, defaultText, defaultTransform } from '../types';
import { clear, fmtTime, h, icon, toast } from './dom';
import { detailsPanel } from './projectSettings';
import { Option } from './select';
import { PCT, RAW, colorCtl, live, row, section, selectRow, slider, toggle, valueBox } from './controls';


const activeTab: Record<string, string> = {};
let presetsOpen = false;

/** The look fields a preset style sets; "none" puts them back to plain white text. */
const PLAIN_LOOK: Partial<TextStyle> = { color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, background: '', shadow: false, shadowColor: undefined, shadowBlur: undefined, shadowX: undefined, shadowY: undefined };
const L = (name: string, style: Partial<TextStyle>, css: string, bg?: string) => ({ name, style, css, bg });
const glow = (c: string) => ({ shadow: true, shadowColor: c, shadowBlur: 0.35, shadowX: 0, shadowY: 0 });
const drop = (c: string, d: number, blur = 0) => ({ shadow: true, shadowColor: c, shadowBlur: blur, shadowX: d, shadowY: d });
const TEXT_LOOKS = [
  L('None', {}, ''),
  L('Black outline', { strokeColor: '#000000', strokeWidth: 12 }, 'color:#fff;-webkit-text-stroke:2px #000;paint-order:stroke'),
  L('Outline + shadow', { strokeColor: '#000000', strokeWidth: 8, ...drop('#000000', 0.06) }, 'color:#fff;-webkit-text-stroke:1.5px #000;paint-order:stroke;text-shadow:2px 2px 0 #000'),
  L('Drop shadow', drop('#000000', 0.06), 'color:#fff;text-shadow:2px 2px 0 #000'),
  L('Soft shadow', glow('rgba(0,0,0,0.9)'), 'color:#fff;text-shadow:0 0 6px #000,0 0 6px #000'),
  L('Yellow', { color: '#e6ff00', strokeColor: '#000000', strokeWidth: 12 }, 'color:#e6ff00;-webkit-text-stroke:2px #000;paint-order:stroke'),
  L('Red', { color: '#ff2a2a', strokeColor: '#ffffff', strokeWidth: 12 }, 'color:#ff2a2a;-webkit-text-stroke:2px #fff;paint-order:stroke'),
  L('Orange', { color: '#ff8a00', strokeColor: '#ffffff', strokeWidth: 12 }, 'color:#ff8a00;-webkit-text-stroke:2px #fff;paint-order:stroke'),
  L('Blue', { color: '#1e90ff', strokeColor: '#ffffff', strokeWidth: 12 }, 'color:#1e90ff;-webkit-text-stroke:2px #fff;paint-order:stroke'),
  L('Green', { color: '#22e51a', strokeColor: '#000000', strokeWidth: 12 }, 'color:#22e51a;-webkit-text-stroke:2px #000;paint-order:stroke'),
  L('Black on grey', { color: '#000000', background: '#9b9b9b' }, 'color:#000', '#9b9b9b'),
  L('White on grey', { color: '#ffffff', background: '#a3a3a3' }, 'color:#fff', '#a3a3a3'),
  L('Black on yellow', { color: '#000000', background: '#ffd400' }, 'color:#000', '#ffd400'),
  L('White on purple', { color: '#ffffff', background: '#8000ff' }, 'color:#fff', '#8000ff'),
  L('Purple on white', { color: '#8000ff', background: '#ffffff' }, 'color:#8000ff', '#ffffff'),
  L('Black on white', { color: '#000000', background: '#ffffff' }, 'color:#000', '#ffffff'),
  L('White on black', { color: '#ffffff', background: '#000000' }, 'color:#fff', '#000000'),
  L('Green on black', { color: '#22e51a', background: '#000000' }, 'color:#22e51a', '#000000'),
  L('Green 3D', { color: '#000000', ...drop('#22e51a', 0.06) }, 'color:#000;text-shadow:2px 2px 0 #22e51a'),
  L('Yellow 3D', { color: '#ffd400', ...drop('#e11d1d', 0.06) }, 'color:#ffd400;text-shadow:2px 2px 0 #e11d1d'),
  L('Pink glow', { color: '#ffffff', ...glow('#ff2d78') }, 'color:#fff;text-shadow:0 0 6px #ff2d78,0 0 10px #ff2d78'),
  L('Yellow glow', { color: '#ffffff', ...glow('#ffd400') }, 'color:#fff;text-shadow:0 0 6px #ffd400,0 0 10px #ffd400'),
  L('Green glow', { color: '#ffffff', ...glow('#22e51a') }, 'color:#fff;text-shadow:0 0 6px #22e51a,0 0 10px #22e51a'),
];
const lookMatches = (s: TextStyle, p: Partial<TextStyle>) =>
  (Object.keys(PLAIN_LOOK) as (keyof TextStyle)[]).every((k) => (k in p ? p[k] : PLAIN_LOOK[k]) === s[k]);
const activeSub: Record<string, string> = {};
/** What the animation catalog row carries for the tile previews. */
interface AnimMeta { dur: number; loop?: boolean; keys: AnimKey[] }

export function mountInspector(root: HTMLElement, player: Player) {
  /** The player shows the mask frame only while Adjust › Mask is open. */
  function setMaskEdit(id: string | null) {
    if (store.maskEdit === id) return;
    store.maskEdit = id;
    store.emit('time');
  }

  function render() {
    const scroll = root.querySelector('.insp-body')?.scrollTop ?? 0;
    clear(root);
    const clip = store.selected;
    if (!clip) { setMaskEdit(null); renderProject(); return; }
    const tabs = tabsFor(clip);
    if (store.inspectorTab && tabs.includes(store.inspectorTab)) activeTab[clip.type] = store.inspectorTab;
    store.inspectorTab = null;
    const cur = tabs.includes(activeTab[clip.type]) ? activeTab[clip.type] : tabs[0];
    root.append(h('div.insp-tabs', { role: 'tablist' }, tabs.map((t) =>
      h(`button${t === cur ? '.active' : ''}`, { role: 'tab', onclick: () => { activeTab[clip.type] = t; render(); } }, t))));
    const body = h(`div.insp-body${cur === 'Adjust' ? '.adj-body' : ''}`);
    root.append(body);
    const subs = subTabsFor(cur);
    let subCur = '';
    if (subs.length) {
      const key = `${clip.type}:${cur}`;
      subCur = subs.includes(activeSub[key]) ? activeSub[key] : subs[0];
      body.append(h('div.sub-tabs', null, subs.map((s) =>
        h(`button${s === subCur ? '.active' : ''}`, { onclick: () => { activeSub[key] = s; render(); } }, s))));
    }
    body.append(...content(clip, cur, subCur));
    if (cur === 'Adjust') root.append(adjustFooter(clip));
    setMaskEdit(cur === 'Adjust' && subCur === 'Mask' ? clip.id : null);
    body.scrollTop = scroll;
  }

  function tabsFor(c: Clip): string[] {
    switch (c.type) {
      case 'video': return ['Video', 'Animation', ...(previousAdjacent(c) ? ['Transition'] : []), 'Adjust', 'Speed', 'Audio'];
      case 'image': return ['Photo', 'Animation', ...(previousAdjacent(c) ? ['Transition'] : []), 'Adjust'];
      case 'audio': return ['Audio', 'Speed'];
      case 'text': return ['Text', 'Animation'];
      case 'sticker': return ['Sticker', 'Animation'];
      case 'effect': return ['Effect', 'Animation'];
      case 'filter': return ['Filter', 'Animation'];
      case 'template': return ['Template', 'Animation'];
    }
  }

  function subTabsFor(tab: string): string[] {
    if (tab === 'Video' || tab === 'Photo') return ['Basic', 'Remove BG', 'Effects'];
    if (tab === 'Text') return ['Basic', 'Transform', 'Effects'];
    if (tab === 'Sticker') return ['Basic', 'Effects'];
    if (tab === 'Animation') return ['In', 'Out', 'Combo'];
    if (tab === 'Adjust') return ADJUST_TABS;
    return [];
  }

  function content(c: Clip, tab: string, subTab: string): HTMLElement[] {
    switch (tab) {
      case 'Video': case 'Photo':
        if (subTab === 'Remove BG') return [chromaSection(c)];
        if (subTab === 'Effects') return lookSections(c);
        return [transformSection(c), opacitySection(c)];
      case 'Text':
        if (subTab === 'Transform') return [transformSection(c), opacitySection(c)];
        if (subTab === 'Effects') return lookSections(c);
        return textSections(c);
      case 'Sticker':
        if (subTab === 'Effects') return lookSections(c);
        return [stickerSection(c), transformSection(c), opacitySection(c)].filter(Boolean) as HTMLElement[];
      case 'Adjust': return adjustContent(c, subTab, render);
      case 'Audio': return [audioSection(c)];
      case 'Speed': return [speedSection(c)];
      case 'Transition': return [crossSection(c)];
      case 'Template': return [templateSection(c), transformSection(c)];
      case 'Effect': return [layerLookSection(c, 'effect')];
      case 'Filter': return [layerLookSection(c, 'filter')];
      case 'Animation': return [animationSection(c, subTab === 'Combo' ? 'combo' : subTab === 'Out' ? 'transitionOut' : 'transitionIn')];
    }
    return [];
  }

  // ---- transform -------------------------------------------------------------

  function transformSection(c: Clip) {
    const id = c.id;
    const t = c.transform;
    const p = store.project;
    const sc = live(id, (x, v) => { x.transform.scale = v; });
    const rot = live(id, (x, v) => { x.transform.rotation = v; });
    const pos = (axis: 'x' | 'y') => valueBox(Math.round(t[axis] * (axis === 'x' ? p.width : p.height)), -p.width * 2, p.width * 2, 1, RAW(0),
      (v) => updateClip(id, (x) => { x.transform[axis] = v / (axis === 'x' ? p.width : p.height); })).el;

    const align = (fn: (w: number, hh: number) => Partial<{ x: number; y: number }>) => () => {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      const [bw, bh] = baseSize(c, m, p);
      const out = fn((bw * c.transform.scale) / p.width, (bh * c.transform.scale) / p.height);
      updateClip(id, (x) => Object.assign(x.transform, out));
    };
    const alignBtn = (name: string, title: string, fn: () => void) => h('button.align-btn', { type: 'button', title, onclick: fn }, icon(name, 16));

    return section('transform', 'Transform', () => updateClip(id, (x) => { x.transform = { ...defaultTransform(), opacity: x.transform.opacity }; }),
      slider('Scale', t.scale, 0.1, 5, 0.01, PCT, sc.input, sc.end, 1),
      row('Position', [h('span.axis', null, 'X'), pos('x'), h('span.axis', null, 'Y'), pos('y')], '.pos-row'),
      slider('Rotate', t.rotation, -180, 180, 1, RAW(0, '°'), rot.input, rot.end, 0),
      h('div.align-row', null,
        alignBtn('alignL', 'Align left', align((w) => ({ x: w / 2 - 0.5 }))),
        alignBtn('alignCH', 'Center horizontally', align(() => ({ x: 0 }))),
        alignBtn('alignR', 'Align right', align((w) => ({ x: 0.5 - w / 2 }))),
        alignBtn('alignT', 'Align top', align((_w, hh) => ({ y: hh / 2 - 0.5 }))),
        alignBtn('alignCV', 'Center vertically', align(() => ({ y: 0 }))),
        alignBtn('alignB', 'Align bottom', align((_w, hh) => ({ y: 0.5 - hh / 2 }))),
        h('span.align-sep'),
        alignBtn('flip', 'Mirror', () => updateClip(id, (x) => { x.transform.flipX = !x.transform.flipX; })),
        c.type === 'video' || c.type === 'image' ? alignBtn('fit', 'Fill canvas', () => fillCanvas(c)) : null,
      ),
    );
  }

  function opacitySection(c: Clip) {
    const op = live(c.id, (x, v) => { x.transform.opacity = v; });
    return section('opacity', 'Opacity', () => updateClip(c.id, (x) => { x.transform.opacity = 1; }),
      slider('Opacity', c.transform.opacity, 0, 1, 0.01, PCT, op.input, op.end, 1));
  }

  function fillCanvas(c: Clip) {
    const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
    if (!m || !m.width) return;
    const p = store.project;
    const rotated = m.rotation % 180 !== 0;
    const mw = rotated ? m.height : m.width, mh = rotated ? m.width : m.height;
    const contain = Math.min(p.width / mw, p.height / mh);
    const cover = Math.max(p.width / mw, p.height / mh);
    updateClip(c.id, (x) => { x.transform.scale = cover / contain; x.transform.x = 0; x.transform.y = 0; });
  }

  // ---- looks -----------------------------------------------------------------

  function lookSections(c: Clip): HTMLElement[] {
    const f = live(c.id, (x, v) => { x.filter.intensity = v; });
    const e = live(c.id, (x, v) => { x.effect.intensity = v; });
    return [
      section('filter', 'Filter', () => updateClip(c.id, (x) => { x.filter = { id: 'none', intensity: 1 }; }),
        selectRow('Filter', c.filter.id, filterOptions(), (v) => updateClip(c.id, (x) => { x.filter.id = v; })),
        c.filter.id !== 'none' ? slider('Intensity', c.filter.intensity, 0, 1, 0.01, PCT, f.input, f.end, 1) : null),
      section('effect', 'Effect', () => updateClip(c.id, (x) => { x.effect = { id: 'none', intensity: 0.6 }; }),
        selectRow('Effect', c.effect.id, [{ id: 'none', name: 'None' }, ...allEffects().map((l) => ({ id: l.id, name: l.name, hint: l.category, preview: thumb(lookPreview('effect', l.id)) }))], (v) => updateClip(c.id, (x) => { x.effect.id = v; })),
        c.effect.id !== 'none' ? slider('Strength', c.effect.intensity, 0, 1, 0.01, PCT, e.input, e.end, 0.6) : null),
    ];
  }

  const thumb = (src: string) => h('img.dd-thumb', { src, alt: '' });
  function filterOptions(): Option<string>[] {
    return [{ id: 'none', name: 'None' }, ...lutList().map((l) => ({ id: l.id, name: l.name, hint: l.category, preview: thumb(lookPreview('filter', l.id)) }))];
  }

  /** Template clip: replace each slot's media. */
  function templateSection(c: Clip) {
    const def = templateDef(c);
    const nested = nestedProject(c);
    const slots = nested?.tracks.find((t) => t.main)?.clips ?? [];
    const left = placeholdersLeft(c);
    const grid = h('div.tpl-insp-slots', null, slots.map((s, i) => {
      const tile = h('button.tpl-strip-slot', { type: 'button', title: `Replace clip ${i + 1}` },
        mediaStill(s.mediaId ? store.media.get(s.mediaId) : undefined),
        h('span.tpl-strip-replace', null, 'Replace'));
      tile.addEventListener('click', () => openSlotPicker(tile, (m) => replaceTemplateSlot(c.id, i, m.id)));
      return h('div.tpl-strip-item', null, tile, h('div.tpl-strip-dur', null, !c.template!.media[i] ? h('i.tpl-dot') : null, `${s.duration.toFixed(1)}s`));
    }));
    return section('template', def?.name ?? 'Template', null,
      grid,
      h('p.hint', null, left ? `${left} of ${slots.length} clips still show the sample photo (red dot). Click one to replace it.` : 'All clips replaced. Click any to swap it.'));
  }

  /** GL transition into this clip from the one before it. */
  function crossSection(c: Clip) {
    const prev = previousAdjacent(c);
    const list = transitions();
    const maxDur = Math.max(0.1, Math.min(3, c.duration, prev?.duration ?? 3));
    const d = live(c.id, (x, v) => { if (x.crossIn) x.crossIn.duration = v; });
    return section('cross', 'Transition', c.crossIn ? () => updateClip(c.id, (x) => { x.crossIn = undefined; }) : null,
      selectRow('Type', c.crossIn?.type ?? 'none', [{ id: 'none', name: 'None' }, ...list.map((t) => ({ id: t.name, name: displayName(t.name) }))],
        (v) => updateClip(c.id, (x) => { x.crossIn = v === 'none' ? undefined : { type: v, duration: Math.min(x.crossIn?.duration ?? 0.8, maxDur) }; })),
      c.crossIn ? slider('Duration', c.crossIn.duration, 0.1, maxDur, 0.05, RAW(1, 's'), d.input, d.end, Math.min(0.8, maxDur)) : null,
      h('p.hint', null, prev ? `Blends “${prev.name}” into this clip, centred on the cut. Pick more in the Transitions tab.` : ''),
    );
  }

  /** Effect / filter layer clip: pick the look and its strength. */
  function layerLookSection(c: Clip, field: 'effect' | 'filter') {
    const l = live(c.id, (x, v) => { x[field].intensity = v; });
    const options = field === 'effect'
      ? allEffects().map((x) => ({ id: x.id, name: x.name, hint: x.category, preview: thumb(lookPreview('effect', x.id)) }))
      : filterOptions().filter((x) => x.id !== 'none');
    return section(`layer-${field}`, field === 'effect' ? 'Effect' : 'Filter', () => updateClip(c.id, (x) => { x[field].intensity = field === 'effect' ? 0.6 : 1; }),
      selectRow(field === 'effect' ? 'Effect' : 'Filter', c[field].id, options,
        (v) => updateClip(c.id, (x) => { x[field].id = v; x.name = options.find((y) => y.id === v)?.name ?? x.name; })),
      slider(field === 'effect' ? 'Strength' : 'Intensity', c[field].intensity, 0, 1, 0.01, PCT, l.input, l.end, field === 'effect' ? 0.6 : 1),
      h('p.hint', null, 'Applies to everything below this layer on the timeline while it plays.'),
    );
  }

  function chromaSection(c: Clip) {
    const k = c.chroma;
    const s = live(c.id, (x, v) => { x.chroma.similarity = v; });
    const sm = live(c.id, (x, v) => { x.chroma.smoothness = v; });
    return section('chroma', 'Chroma key', () => updateClip(c.id, (x) => { x.chroma = defaultChroma(); }),
      toggle('Remove color', k.enabled, (v) => updateClip(c.id, (x) => { x.chroma.enabled = v; })),
      k.enabled ? colorCtl('Key color', k.color, (v) => updateClip(c.id, (x) => { x.chroma.color = v; })) : null,
      k.enabled ? slider('Strength', k.similarity, 0, 1, 0.01, PCT, s.input, s.end, 0.35) : null,
      k.enabled ? slider('Edge', k.smoothness, 0, 1, 0.01, PCT, sm.input, sm.end, 0.1) : null,
      h('p.hint', null, 'Removes a solid background color, e.g. green screen. Pick the color you want to make transparent.'),
    );
  }

  // ---- audio / speed / animation -------------------------------------------------

  function audioSection(c: Clip) {
    const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
    if (c.type === 'video' && !m?.hasAudio) return section('audio', 'Basic', null, h('p.hint', null, 'This clip has no audio track.'));
    const v = live(c.id, (x, val) => { x.volume = val; });
    const fi = live(c.id, (x, val) => { x.fadeIn = val; });
    const fo = live(c.id, (x, val) => { x.fadeOut = val; });
    const maxFade = Math.min(10, c.duration / 2);
    return section('audio', 'Basic', () => updateClip(c.id, (x) => { x.volume = 1; x.fadeIn = 0; x.fadeOut = 0; x.muted = false; }),
      slider('Volume', c.volume, 0, 2, 0.01, PCT, v.input, v.end, 1),
      toggle('Mute', c.muted, (val) => updateClip(c.id, (x) => { x.muted = val; })),
      slider('Fade in', c.fadeIn, 0, maxFade, 0.05, RAW(1, 's'), fi.input, fi.end, 0),
      slider('Fade out', c.fadeOut, 0, maxFade, 0.05, RAW(1, 's'), fo.input, fo.end, 0),
      c.type === 'video' ? (c.extractedTo
        ? h('button.wide-btn', { type: 'button', onclick: () => recoverAudio(c) }, icon('audio', 14), 'Recover audio')
        : h('button.wide-btn', { type: 'button', onclick: () => extractAudio(c) }, icon('audio', 14), 'Extract audio')) : null,
    );
  }

  function speedSection(c: Clip) {
    const presets = [0.25, 0.5, 1, 1.5, 2, 3, 5];
    const sp = live(c.id, (x, v) => {
      const srcLen = x.duration * x.speed;
      x.speed = v;
      x.duration = srcLen / v;
    });
    return section('speed', 'Standard', () => setSpeed(c.id, 1),
      h('div.chip-row', null, presets.map((p) => h(`button.chip${Math.abs(c.speed - p) < 1e-3 ? '.active' : ''}`, { onclick: () => setSpeed(c.id, p) }, `${p}x`))),
      slider('Speed', c.speed, 0.1, 10, 0.05, RAW(2, 'x'), sp.input, () => { sp.end(); resolveOverlap(c.id); }, 1),
      row('Duration', h('span.prop-value', null, `${fmtTime(c.duration, store.project.fps, true)}`)),
    );
  }

  /**
   * Animation › In / Out / Combo (CapCut): the animation library from R2. Tiles move on hover;
   * ones not downloaded yet show the arrow and download on first use. Combo replaces In / Out.
   */
  function clearAnim(x: Clip, key: 'transitionIn' | 'transitionOut' | 'combo') {
    if (key === 'combo') x.combo = undefined; else x[key] = { type: 'none', duration: 0.5 };
  }

  function animationSection(c: Clip, key: 'transitionIn' | 'transitionOut' | 'combo') {
    const kind = key === 'combo' ? 'combo' : key === 'transitionOut' ? 'out' : 'in';
    const tr = c[key] ?? { type: 'none', duration: 0.5 };
    const lib = catalogOf('animations').filter((a) => a.category.toLowerCase() === kind);
    // Offline before the library ever loaded: the basic built-in ones still work.
    const items: { id: string; name: string; meta?: AnimMeta }[] = lib.length
      ? lib.map((a) => ({ id: a.id, name: a.name, meta: a.meta as unknown as AnimMeta }))
      : key === 'combo' ? [] : TRANSITIONS.filter((t) => t.id !== 'none');
    const maxDur = Math.max(0.2, key === 'combo' ? c.duration : Math.min(5, c.duration));
    const d = live(c.id, (x, v) => { x[key] = { ...(x[key] ?? tr), duration: v }; });
    const apply = (id: string, dur: number) => {
      updateClip(c.id, (x) => {
        x[key] = { type: id, duration: Math.min(dur, maxDur) };
        // CapCut: a combo takes over the whole clip, and picking In / Out drops the combo.
        if (key === 'combo') { x.transitionIn = { type: 'none', duration: 0.5 }; x.transitionOut = { type: 'none', duration: 0.5 }; } else if (x.combo) x.combo = undefined;
      });
      // Play the animated part once so the pick is visible right away.
      const pad = 0.4;
      if (key === 'transitionOut') player.playRange(Math.max(c.start, c.start + c.duration - dur - pad), c.start + c.duration);
      else player.playRange(c.start, Math.min(c.start + c.duration, c.start + (key === 'combo' ? Math.max(dur, 2) : dur + pad)));
    };
    const tile = (it: { id: string; name: string; meta?: AnimMeta }) => {
      const fromLib = !!it.meta;
      const have = !fromLib || isDownloaded('animations', it.id);
      const busy = fromLib && isDownloading('animations', it.id);
      const demo = h('div.anim-demo');
      const sw = h('div.look-swatch.anim-sw', fromLib ? null : { 'data-tr': it.id }, fromLib ? demo : h('div.tr-demo'));
      let run: Animation | null = null;
      const btn = h(`button.anim${tr.type === it.id ? '.active' : ''}`, {
        type: 'button', title: it.name,
        onpointerenter: () => {
          if (!it.meta?.keys) return;
          run = demo.animate(cssKeyframes({ id: it.id, name: it.name, kind, dur: it.meta.dur, keys: it.meta.keys }), {
            duration: Math.max(500, it.meta.dur * 1000), iterations: Infinity, endDelay: kind === 'combo' ? 0 : 350, direction: 'normal',
          });
        },
        onpointerleave: () => { run?.cancel(); run = null; },
        onclick: async () => {
          const dur = it.meta?.dur ?? (tr.type !== 'none' ? tr.duration : 0.5);
          if (fromLib && !have) {
            if (!(await download('animations', it.id))) { toast(`Couldn't download “${it.name}”. Check your connection.`, 'error'); return; }
          }
          apply(it.id, key === 'combo' && !it.meta?.loop ? c.duration : dur);
        },
      }, sw, h('span', null, it.name));
      if (fromLib && !have) sw.append(h(`span.dl-btn.small${busy ? '.busy' : ''}`, { 'aria-hidden': 'true' }, busy ? h('div.spinner.small') : icon('download', 12)));
      return btn;
    };
    const none = h(`button.anim${tr.type === 'none' ? '.active' : ''}`, { type: 'button', title: 'None', onclick: () => updateClip(c.id, (x) => { clearAnim(x, key); }) },
      h('div.look-swatch.anim-sw', { 'data-tr': 'none' }, h('div.tr-demo')), h('span', null, 'None'));
    const grid = h('div.anim-grid', null, none, items.map(tile));
    const title = key === 'combo' ? 'Combo animation' : key === 'transitionIn' ? 'In animation' : 'Out animation';
    return section(`anim-${key}`, title, () => updateClip(c.id, (x) => { clearAnim(x, key); }),
      grid,
      !items.length ? h('p.hint', null, navigator.onLine ? 'Loading animations…' : 'Connect to the internet once to see the animation library.') : null,
      tr.type !== 'none' ? slider('Duration', tr.duration, 0.1, maxDur, 0.05, RAW(1, 's'), d.input, d.end, 0.5) : null,
    );
  }

  // ---- text / sticker --------------------------------------------------------------

  /** Preset style grid (CapCut): one row until expanded. */
  function presetStyles(c: Clip) {
    const s = c.text!;
    const current = TEXT_LOOKS.findIndex((p) => lookMatches(s, p.style));
    const grid = h(`div.ps-grid${presetsOpen ? '.open' : ''}`, null, TEXT_LOOKS.map((p, i) =>
      h(`button.ps-tile${(current === -1 ? 0 : current) === i ? '.on' : ''}`, {
        type: 'button', title: p.name, style: p.bg ? { background: p.bg } : {},
        onclick: () => updateClip(c.id, (x) => { Object.assign(x.text!, PLAIN_LOOK, p.style); }),
      }, i === 0 ? icon('none', 22) : h('span', { style: p.css }, 'Aa'))));
    const more = h('button.ps-more', {
      type: 'button', title: presetsOpen ? 'Show less' : 'Show all styles', 'aria-expanded': presetsOpen,
      onclick: () => { presetsOpen = !presetsOpen; render(); },
    });
    // Filled triangle like CapCut's, pointing up when expanded.
    more.innerHTML = `<svg viewBox="0 0 16 10" width="11" height="7" fill="currentColor"><path d="${presetsOpen ? 'M8 1 15 9H1z' : 'M1 1h14L8 9z'}"/></svg>`;
    return h('div.ps-wrap', null, h('div.ps-label', null, 'Preset style'), grid, more);
  }

  function textSections(c: Clip): HTMLElement[] {
    const s = c.text!;
    let typing = false;
    const ta = h('textarea.text-input', { rows: 3, 'aria-label': 'Text content', spellcheck: false }) as HTMLTextAreaElement;
    ta.value = s.content;
    ta.addEventListener('input', () => {
      updateClip(c.id, (x) => { x.text!.content = ta.value; x.name = ta.value.split('\n')[0].slice(0, 40) || 'Text'; }, !typing);
      typing = true;
    });
    ta.addEventListener('blur', () => { typing = false; });
    const set = (fn: (t: NonNullable<Clip['text']>) => void) => updateClip(c.id, (x) => fn(x.text!));
    const size = live(c.id, (x, v) => { x.text!.size = v; });
    const sw = live(c.id, (x, v) => { x.text!.strokeWidth = v; });
    const ls = live(c.id, (x, v) => { x.text!.letterSpacing = v; });
    const lh = live(c.id, (x, v) => { x.text!.lineHeight = v; });
    const fmtBtn = (label: Node | string, title: string, on: boolean, fn: () => void) =>
      h(`button.fmt${on ? '.on' : ''}`, { type: 'button', title, 'aria-pressed': on, onclick: fn }, label);
    const fontOpts = FONTS.map((f) => ({ id: f, name: f, preview: h('span.font-prev', { style: { fontFamily: `"${f}"` } }, 'Aa') }));
    // Alignment (CapCut): left / centre / right, then vertical text aligned top / middle / bottom.
    const vIcon = (mode: 'top' | 'middle' | 'bottom') => {
      const sp = document.createElement('span');
      const ys = mode === 'top' ? [[4, 16], [4, 20], [4, 13]] : mode === 'middle' ? [[7, 17], [4, 20], [8, 16]] : [[8, 20], [4, 20], [11, 20]];
      sp.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${ys.map(([a, b], i) => `<path d="M${7 + i * 5} ${a}V${b}"/>`).join('')}</svg>`;
      return sp.firstElementChild as SVGElement;
    };
    const alignRow = row('Alignment', h('div.fmt-row.align-row', null,
      fmtBtn(icon('alignL', 15), 'Align left', !s.vertical && s.align === 'left', () => set((t) => { t.align = 'left'; t.vertical = undefined; })),
      fmtBtn(icon('alignCH', 15), 'Center', !s.vertical && s.align === 'center', () => set((t) => { t.align = 'center'; t.vertical = undefined; })),
      fmtBtn(icon('alignR', 15), 'Align right', !s.vertical && s.align === 'right', () => set((t) => { t.align = 'right'; t.vertical = undefined; })),
      fmtBtn(vIcon('top'), 'Vertical, top', s.vertical === 'top', () => set((t) => { t.vertical = 'top'; })),
      fmtBtn(vIcon('middle'), 'Vertical, middle', s.vertical === 'middle', () => set((t) => { t.vertical = 'middle'; })),
      fmtBtn(vIcon('bottom'), 'Vertical, bottom', s.vertical === 'bottom', () => set((t) => { t.vertical = 'bottom'; })),
    ));
    return [
      section('text-content', 'Text', null, ta, alignRow, presetStyles(c)),
      section('text-style', 'Style', () => set((t) => { const d = defaultText(); Object.assign(t, { ...d, content: t.content }); }),
        selectRow('Font', s.font, fontOpts, (v) => set((t) => { t.font = v; })),
        slider('Font size', s.size, 8, 400, 1, RAW(0), size.input, size.end, 96),
        row('Pattern', h('div.fmt-row', null,
          fmtBtn(h('b', null, 'B'), 'Bold', s.bold, () => set((t) => { t.bold = !t.bold; })),
          fmtBtn(h('i', null, 'I'), 'Italic', s.italic, () => set((t) => { t.italic = !t.italic; })),
        )),
        colorCtl('Color', s.color, (v) => set((t) => { t.color = v; })),
        slider('Character', s.letterSpacing, -10, 50, 1, RAW(0), ls.input, ls.end, 0),
        slider('Line', s.lineHeight, 0.7, 3, 0.05, RAW(2), lh.input, lh.end, 1.2),
      ),
      section('text-stroke', 'Stroke', () => set((t) => { t.strokeWidth = 0; }),
        colorCtl('Color', s.strokeColor, (v) => set((t) => { t.strokeColor = v; if (!t.strokeWidth) t.strokeWidth = 6; })),
        slider('Width', s.strokeWidth, 0, 30, 0.5, RAW(1), sw.input, sw.end, 0),
      ),
      section('text-bg', 'Background', () => set((t) => { t.background = ''; }),
        toggle('Background', !!s.background, (v) => set((t) => { t.background = v ? 'rgba(0,0,0,0.6)' : ''; })),
        s.background ? colorCtl('Color', s.background, (v) => set((t) => { t.background = v; })) : null,
      ),
      section('text-shadow', 'Shadow', null, toggle('Shadow / glow', s.shadow, (v) => set((t) => { t.shadow = v; }))),
    ];
  }

  function stickerSection(c: Clip) {
    const def = c.sticker ? stickerById(c.sticker.id) : undefined;
    if (!def) return null;
    return section('sticker', 'Sticker', def.color ? () => updateClip(c.id, (x) => { x.sticker!.color = def.color!; }) : null,
      h('div.sticker-preview', null, h('img', { src: stickerDataUrl(def, c.sticker!.color), alt: def.name }), h('span', null, def.name)),
      def.color ? colorCtl('Color', c.sticker!.color, (v) => updateClip(c.id, (x) => { x.sticker!.color = v; })) : null,
    );
  }

  // ---- project (no selection) -------------------------------------------------------

  function renderProject() {
    detailsPanel(root, player);
  }

  // Don't rebuild while the user is typing in or dragging a control; catch up afterwards.
  const isEditing = () => {
    const a = document.activeElement;
    return !!a && root.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a as HTMLInputElement).type !== 'checkbox'));
  };
  let shownId: string | null = null;
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!isEditing() || store.selectedId !== shownId) { shownId = store.selectedId; render(); }
    });
  };
  store.on('select', schedule);
  store.on('project', schedule);
  store.on('view', schedule);
  // Focus moving into one of our dropdown lists isn't "done editing": rebuilding now would
  // replace the dropdown's button and close the list straight away.
  root.addEventListener('focusout', (e) => {
    if ((e.relatedTarget as Element | null)?.closest?.('.popover, .ctx-menu')) return;
    setTimeout(schedule, 0);
  });
  root.addEventListener('change', (e) => { if ((e.target as HTMLInputElement).type === 'range') (e.target as HTMLElement).blur(); });
  render();
}
