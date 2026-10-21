import { updateClip } from '../actions';
import {
  addCaptionAt, applyTemplate, cancelCaptions, CAPTION_TEMPLATES, captionClips, CaptionOptions, exportSrt,
  generateCaptions, importSubtitles, LANGUAGES, MODELS, Progress,
} from '../engine/captions';
import { store } from '../store';
import { fmtTime, h, icon, toast } from './dom';
import { dropdown } from './select';

const SAVED = 'kinora.captionOptions';

const opts: CaptionOptions = {
  language: 'auto', bilingual: 'none', highlight: false, emojis: false, removeFillers: true,
  model: MODELS[1].id, templateId: 'classic', replace: true, lyrics: false,
  ...(() => { try { return JSON.parse(localStorage.getItem(SAVED) ?? '{}'); } catch { return {}; } })(),
};
const save = () => { try { localStorage.setItem(SAVED, JSON.stringify(opts)); } catch { /* ignore */ } };

/** Generation state survives tab switches so progress keeps showing. */
const job: { running: boolean; progress: Progress | null; error: string | null; listeners: Set<() => void> } = {
  running: false, progress: null, error: null, listeners: new Set(),
};
const notify = () => job.listeners.forEach((fn) => fn());

function toggleRow(label: string, on: boolean, onChange: (v: boolean) => void, badge?: string) {
  return h('label.cap-toggle', null,
    h('span.cap-label', null, label, badge ? h('span.cap-badge', null, badge) : null),
    h('span.switch', null, h('input', { type: 'checkbox', checked: on, 'aria-label': label, onchange: (e: Event) => { onChange((e.target as HTMLInputElement).checked); save(); } }), h('i')));
}

function field(label: string, control: HTMLElement) {
  return h('div.cap-field', null, h('div.cap-label', null, label), control);
}

function progressBlock() {
  const fill = h('div.progress-fill');
  const stage = h('div.cap-stage');
  const wrap = h('div.cap-progress', null, stage, h('div.progress', null, fill),
    h('button.ghost-btn.cap-cancel', { type: 'button', onclick: () => { cancelCaptions(); job.running = false; job.progress = null; notify(); toast('Captions cancelled'); } }, 'Cancel'));
  const paint = () => {
    const p = job.progress;
    stage.textContent = p ? `${p.stage}${p.progress !== null ? ` · ${Math.round(p.progress * 100)}%` : '…'}` : 'Starting…';
    fill.style.width = p?.progress !== null && p ? `${p.progress * 100}%` : '15%';
    fill.classList.toggle('indeterminate', !p || p.progress === null);
  };
  paint();
  return { el: wrap, paint };
}

async function run(lyrics: boolean) {
  if (job.running) return;
  job.running = true;
  job.error = null;
  job.progress = null;
  notify();
  try {
    const n = await generateCaptions({ ...opts, lyrics, templateId: lyrics && opts.templateId === 'classic' ? 'lyrics' : opts.templateId }, (p) => { job.progress = p; notify(); });
    toast(n ? `Added ${n} captions` : 'No speech was recognised', n ? 'ok' : 'info');
  } catch (err) {
    if (job.running) job.error = err instanceof Error ? err.message : String(err);
  } finally {
    job.running = false;
    notify();
  }
}

function autoView(body: HTMLElement, lyrics: boolean) {
  body.append(
    field(lyrics ? 'Song language' : 'Spoken language', dropdown(opts.language, LANGUAGES, (v) => { opts.language = v; save(); })),
    lyrics ? '' : field('Bilingual captions', dropdown(opts.bilingual, [
      { id: 'none', name: 'None' }, { id: 'english', name: 'English (translation)' },
    ], (v) => { opts.bilingual = v as CaptionOptions['bilingual']; save(); })),
    field('Accuracy', dropdown(opts.model, MODELS.map((m) => ({ id: m.id, name: m.name, hint: m.hint })), (v) => { opts.model = v; save(); })),
    h('div.cap-toggles', null,
      toggleRow('Auto highlight keywords', opts.highlight, (v) => { opts.highlight = v; }),
      toggleRow('Auto emojis', opts.emojis, (v) => { opts.emojis = v; }, 'Free'),
      lyrics ? '' : toggleRow('Remove filler words', opts.removeFillers, (v) => { opts.removeFillers = v; }),
      toggleRow('Replace existing captions', opts.replace, (v) => { opts.replace = v; }),
    ),
  );
  const slot = h('div.cap-action');
  body.append(slot,
    h('p.hint', null, lyrics
      ? 'Works best on songs with clear vocals. Runs on your device; nothing is uploaded.'
      : 'Runs on your device with Whisper. The speech model downloads once, then works offline. Nothing is uploaded.'));
  const renderAction = () => {
    slot.replaceChildren();
    if (job.error) slot.append(h('p.hint.warn', null, job.error));
    if (job.running) {
      const pb = progressBlock();
      slot.append(pb.el);
    } else {
      slot.append(h('button.primary-btn.wide', { type: 'button', onclick: () => run(lyrics) }, icon('cc', 16), lyrics ? 'Generate lyrics' : 'Generate'));
    }
  };
  renderAction();
  const listener = () => { if (!slot.isConnected) { job.listeners.delete(listener); return; } renderAction(); };
  job.listeners.add(listener);
}

function templatesView(body: HTMLElement) {
  body.append(h('p.hint', null, 'Choose a style. It applies to every caption on the timeline and to new captions.'));
  const grid = h('div.preset-grid');
  for (const t of CAPTION_TEMPLATES) {
    grid.append(h(`button.preset${opts.templateId === t.id ? '.active' : ''}`, {
      type: 'button', title: t.name,
      onclick: () => {
        opts.templateId = t.id;
        save();
        if (captionClips().length) { applyTemplate(t.id); toast(`Captions restyled: ${t.name}`, 'ok'); }
        else toast(`${t.name} will be used for new captions`);
        store.emit('view');
      },
    }, h('span', { style: t.css }, t.name)));
  }
  body.append(grid);
}

function manualView(body: HTMLElement, rerender: () => void) {
  const file = h('input', { type: 'file', accept: '.srt,.vtt,text/vtt', hidden: true }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const n = importSubtitles(await f.text(), opts);
    toast(n ? `Imported ${n} captions from ${f.name}` : `No captions found in ${f.name}`, n ? 'ok' : 'error');
    rerender();
  });
  const caps = captionClips();
  body.append(file, h('div.cap-buttons', null,
    h('button.primary-btn', { type: 'button', onclick: () => { addCaptionAt(store.currentTime, opts.templateId); rerender(); } }, icon('plus', 16), 'Add caption'),
    h('button.ghost-btn', { type: 'button', onclick: () => file.click() }, icon('upload', 14), 'Import .srt'),
    h('button.ghost-btn', {
      type: 'button', disabled: !caps.length,
      onclick: () => {
        const blob = new Blob([exportSrt()], { type: 'text/plain' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `${store.project.name || 'captions'}.srt` }) as HTMLAnchorElement;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    }, icon('download', 14), 'Export .srt'),
  ));
  if (!caps.length) { body.append(h('p.hint', null, 'No captions yet. Add one at the playhead, import a subtitle file, or use Auto captions.')); return; }
  const list = h('div.cap-list');
  for (const c of caps) {
    const inp = h('textarea.cap-text', { rows: 1, spellcheck: false, 'aria-label': 'Caption text' }) as HTMLTextAreaElement;
    inp.value = c.text!.content;
    let first = true;
    inp.addEventListener('input', () => { updateClip(c.id, (x) => { x.text!.content = inp.value; x.name = inp.value.slice(0, 40); }, first); first = false; });
    inp.addEventListener('focus', () => { store.select(c.id); store.setTime(c.start); });
    list.append(h(`div.cap-row${store.selectedId === c.id ? '.active' : ''}`, null,
      h('button.cap-time', { type: 'button', title: 'Go to caption', onclick: () => { store.select(c.id); store.setTime(c.start); } }, fmtTime(c.start, store.project.fps, true)),
      inp));
  }
  body.append(list);
}

export function captionsTab(body: HTMLElement, sub: string, rerender: () => void) {
  if (sub === 'Templates') templatesView(body);
  else if (sub === 'Add captions') manualView(body, rerender);
  else autoView(body, sub === 'Auto lyrics');
}
