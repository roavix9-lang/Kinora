import { store } from '../store';
import { Clip, clipEnd, defaultText, hasSound, makeClip, Project, TextStyle, Track, uid } from '../types';
import { mixInto, MixJob } from '../wasm/dsp';
import type { Segment, WorkerMessage, WorkerRequest } from './captions.worker';
import { audioBuffers, hasAudioSource } from './media';

const RATE = 16000; // Whisper's input rate

// ---- options -------------------------------------------------------------------

export const LANGUAGES: { id: string; name: string }[] = [
  { id: 'auto', name: 'Auto detect' }, { id: 'english', name: 'English' }, { id: 'spanish', name: 'Spanish' },
  { id: 'french', name: 'French' }, { id: 'german', name: 'German' }, { id: 'italian', name: 'Italian' },
  { id: 'portuguese', name: 'Portuguese' }, { id: 'dutch', name: 'Dutch' }, { id: 'polish', name: 'Polish' },
  { id: 'turkish', name: 'Turkish' }, { id: 'russian', name: 'Russian' }, { id: 'ukrainian', name: 'Ukrainian' },
  { id: 'arabic', name: 'Arabic' }, { id: 'hindi', name: 'Hindi' }, { id: 'chinese', name: 'Chinese' },
  { id: 'japanese', name: 'Japanese' }, { id: 'korean', name: 'Korean' }, { id: 'indonesian', name: 'Indonesian' },
  { id: 'vietnamese', name: 'Vietnamese' }, { id: 'thai', name: 'Thai' }, { id: 'swedish', name: 'Swedish' },
  { id: 'yoruba', name: 'Yoruba' }, { id: 'swahili', name: 'Swahili' },
];

export const MODELS = [
  { id: 'onnx-community/whisper-tiny', name: 'Fast', hint: '~40 MB' },
  { id: 'onnx-community/whisper-base', name: 'Balanced', hint: '~80 MB' },
  { id: 'onnx-community/whisper-small', name: 'Accurate', hint: '~250 MB' },
];

export interface CaptionTemplate { id: string; name: string; y: number; style: Partial<TextStyle>; css: string }

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  { id: 'classic', name: 'Classic', y: 0.33, style: { font: 'Inter', size: 64, bold: true, color: '#ffffff', strokeColor: '#000000', strokeWidth: 6, background: '', shadow: false, highlightColor: '#ffe600' }, css: 'font:700 14px Inter;color:#fff;-webkit-text-stroke:1px #000' },
  { id: 'bold-pop', name: 'Bold pop', y: 0.3, style: { font: 'Montserrat', size: 76, bold: true, color: '#ffffff', strokeColor: '#000000', strokeWidth: 12, background: '', shadow: true, highlightColor: '#22d3ee' }, css: 'font:800 15px Montserrat;color:#fff;-webkit-text-stroke:1.5px #000' },
  { id: 'yellow', name: 'Yellow', y: 0.33, style: { font: 'Anton', size: 80, bold: false, color: '#ffe600', strokeColor: '#000000', strokeWidth: 10, background: '', shadow: false, highlightColor: '#ffffff' }, css: 'font:400 16px Anton;color:#ffe600;-webkit-text-stroke:1px #000' },
  { id: 'box', name: 'Box', y: 0.36, style: { font: 'Inter', size: 56, bold: false, color: '#ffffff', strokeWidth: 0, background: 'rgba(0,0,0,0.7)', shadow: false, highlightColor: '#facc15' }, css: 'font:500 12px Inter;color:#fff;background:rgba(0,0,0,.7);padding:2px 6px;border-radius:3px' },
  { id: 'minimal', name: 'Minimal', y: 0.38, style: { font: 'Inter', size: 50, bold: false, color: '#ffffff', strokeWidth: 0, background: '', shadow: true, highlightColor: '#ffffff' }, css: 'font:400 12px Inter;color:#fff;text-shadow:0 1px 3px #000' },
  { id: 'neon', name: 'Neon', y: 0.3, style: { font: 'Montserrat', size: 70, bold: true, color: '#ff4fd8', strokeWidth: 0, background: '', shadow: true, highlightColor: '#7cf7ff' }, css: 'font:700 14px Montserrat;color:#ff4fd8;text-shadow:0 0 6px #ff4fd8' },
  { id: 'impact', name: 'Impact', y: 0.0, style: { font: 'Bebas Neue', size: 130, bold: false, color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, background: '', shadow: false, highlightColor: '#ef4444' }, css: 'font:400 18px "Bebas Neue";color:#fff;-webkit-text-stroke:1px #000' },
  { id: 'lyrics', name: 'Lyrics', y: 0.3, style: { font: 'Playfair Display', size: 66, bold: false, italic: true, color: '#ffffff', strokeWidth: 0, background: '', shadow: true, highlightColor: '#fbcfe8' }, css: 'font:italic 400 14px "Playfair Display";color:#fff;text-shadow:0 1px 4px #000' },
];

export interface CaptionOptions {
  language: string;
  bilingual: 'none' | 'english';
  highlight: boolean;
  emojis: boolean;
  removeFillers: boolean;
  model: string;
  templateId: string;
  replace: boolean;
  lyrics: boolean;
}

export type Progress = { stage: string; progress: number | null };

// ---- audio ---------------------------------------------------------------------

function soundClips(p: Project): Clip[] {
  const out: Clip[] = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      const m = c.mediaId ? store.media.get(c.mediaId) : undefined;
      if (!c.muted && c.volume > 0 && hasSound(c, m) && hasAudioSource(c.mediaId!)) out.push(c);
    }
  }
  return out;
}

/** Mixes everything audible on the timeline to 16 kHz mono (WebAssembly mixer). */
async function mixMono(p: Project, duration: number): Promise<Float32Array> {
  const clips = soundClips(p);
  const out = new Float32Array(Math.ceil(duration * RATE));
  const BLOCK = 10 * RATE;
  for (let b0 = 0; b0 < out.length; b0 += BLOCK) {
    const dst = out.subarray(b0, Math.min(out.length, b0 + BLOCK));
    const tA = b0 / RATE, tB = (b0 + dst.length) / RATE;
    const jobs: MixJob[] = [];
    for (const c of clips) {
      const s = Math.max(tA, c.start), e = Math.min(tB, clipEnd(c));
      if (e <= s) continue;
      const srcA = c.in + (s - c.start) * c.speed;
      const srcB = c.in + (e - c.start) * c.speed;
      const chunks: AudioBuffer[] = [];
      let firstTs = -1;
      for await (const wb of audioBuffers(c.mediaId!, srcA, srcB + 0.05)) {
        if (firstTs < 0) firstTs = wb.timestamp;
        chunks.push(wb.buffer);
      }
      if (!chunks.length) continue;
      const rate = chunks[0].sampleRate;
      const mono = new Float32Array(chunks.reduce((n, x) => n + x.length, 0));
      let o = 0;
      for (const ch of chunks) {
        const l = ch.getChannelData(0), r = ch.getChannelData(Math.min(1, ch.numberOfChannels - 1));
        for (let i = 0; i < ch.length; i++) mono[o + i] = (l[i] + r[i]) * 0.5;
        o += ch.length;
      }
      jobs.push({
        src: mono, dstOffset: Math.round((s - tA) * RATE), srcStart: (srcA - firstTs) * rate,
        rate: (c.speed * rate) / RATE, gain: c.volume, clipOffset: 0, clipLen: 1e9, fadeIn: 0, fadeOut: 0,
      });
    }
    if (jobs.length) mixInto(dst, jobs);
  }
  return out;
}

/**
 * Cuts audio into ≤ 28 s windows at the quietest moment near each boundary so words
 * aren't split, and drops windows that are silent.
 */
function speechWindows(audio: Float32Array): { start: number; end: number }[] {
  const frame = Math.round(RATE * 0.1);
  const rms = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += audio[i] * audio[i];
    return Math.sqrt(s / Math.max(1, b - a));
  };
  const windows: { start: number; end: number }[] = [];
  let pos = 0;
  while (pos < audio.length) {
    let cut = Math.min(audio.length, pos + 28 * RATE);
    if (cut < audio.length) {
      let best = cut, bestE = Infinity;
      for (let f = pos + 18 * RATE; f + frame <= cut; f += frame) {
        const e = rms(f, f + frame);
        if (e < bestE) { bestE = e; best = f + frame / 2; }
      }
      cut = Math.round(best);
    }
    if (rms(pos, cut) > 0.003) windows.push({ start: pos / RATE, end: cut / RATE });
    pos = cut;
  }
  return windows;
}

// ---- recognition ---------------------------------------------------------------

let worker: Worker | null = null;
const newWorker = () => new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' });

export function cancelCaptions() {
  worker?.terminate();
  worker = null;
}

async function recognise(audio: Float32Array, windows: { start: number; end: number }[], o: CaptionOptions, onProgress: (p: Progress) => void) {
  worker ??= newWorker();
  const w = worker;
  const tasks: WorkerRequest['tasks'] = ['transcribe'];
  if (o.bilingual === 'english' && o.language !== 'english') tasks.push('translate');
  return new Promise<Record<string, Segment[]>>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'download') onProgress({ stage: 'Downloading speech model (first time only)', progress: m.progress / 100 });
      else if (m.type === 'ready') onProgress({ stage: `Recognising speech on ${m.device === 'webgpu' ? 'GPU' : 'CPU'}`, progress: 0 });
      else if (m.type === 'progress') onProgress({ stage: 'Recognising speech', progress: m.progress });
      else if (m.type === 'result') resolve(m.segments);
      else if (m.type === 'error') reject(new Error(m.message));
    };
    w.onerror = (e) => reject(new Error(e.message || 'Speech worker failed'));
    const req: WorkerRequest = { audio, windows, model: o.model, language: o.language, tasks };
    w.postMessage(req, [audio.buffer]);
  });
}

// ---- text shaping --------------------------------------------------------------

const FILLERS = /\b(um+|uh+|erm+|er|ah+|hmm+|mm+|you know|i mean|sort of|kind of)\b[,.]?\s*/gi;

const STOP = new Set(('the a an and or but if then so to of in on at by for with from up down out over is are was were be been being am ' +
  'i you he she it we they me him her us them my your his its our their this that these those there here what which who whom ' +
  'do does did have has had will would can could should just not no yes very really also too than as about into like get got ' +
  'go going gonna want know think one all some any more most much many well now oh okay yeah').split(' '));

const EMOJI: [RegExp, string][] = [
  [/\b(love|heart|loved)\b/i, '❤️'], [/\b(fire|hot|lit)\b/i, '🔥'], [/\b(money|cash|dollars?|pay|paid|price)\b/i, '💰'],
  [/\b(laugh|funny|lol|haha|joke)\b/i, '😂'], [/\b(happy|smile|glad)\b/i, '😊'], [/\b(sad|cry|crying)\b/i, '😢'],
  [/\b(wow|amazing|incredible|insane|crazy)\b/i, '🤯'], [/\b(music|song|sing)\b/i, '🎵'], [/\b(food|eat|eating|hungry|pizza)\b/i, '🍕'],
  [/\b(coffee)\b/i, '☕'], [/\b(time|clock|minutes?|hours?)\b/i, '⏰'], [/\b(idea|think|smart)\b/i, '💡'],
  [/\b(win|won|winner|champion)\b/i, '🏆'], [/\b(car|drive|driving)\b/i, '🚗'], [/\b(phone|call)\b/i, '📱'],
  [/\b(camera|photo|picture|video)\b/i, '📸'], [/\b(world|earth|travel)\b/i, '🌍'], [/\b(sun|sunny|summer)\b/i, '☀️'],
  [/\b(rain|raining)\b/i, '🌧️'], [/\b(party|celebrate)\b/i, '🎉'], [/\b(dog|puppy)\b/i, '🐶'], [/\b(cat|kitten)\b/i, '🐱'],
  [/\b(rocket|launch|grow|growth)\b/i, '🚀'], [/\b(strong|gym|workout)\b/i, '💪'], [/\b(look|see|watch)\b/i, '👀'],
  [/\b(yes|right|correct|done)\b/i, '✅'], [/\b(stop|wrong|never)\b/i, '❌'], [/\?\s*$/, '🤔'],
];

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function keywords(line: string): string[] {
  const words = line.split(/\s+/).map(norm).filter((w) => w && !STOP.has(w) && !w.includes("'"));
  const scored = words.map((w) => ({ w, s: (/\d/.test(w) ? 10 : 0) + w.length }));
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s >= 5).slice(0, line.length > 24 ? 2 : 1).map((x) => x.w);
}

interface Line { text: string; start: number; end: number; second?: string }

function splitLines(segs: Segment[], maxWords: number, maxChars: number): Line[] {
  const lines: Line[] = [];
  for (const s of segs) {
    const words = s.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const groups: string[][] = [];
    let cur: string[] = [];
    for (const w of words) {
      const len = [...cur, w].join(' ').length;
      if (cur.length && (cur.length >= maxWords || len > maxChars)) { groups.push(cur); cur = []; }
      cur.push(w);
      // Prefer breaking after punctuation.
      if (/[.!?,;:]$/.test(w) && cur.length >= 3) { groups.push(cur); cur = []; }
    }
    if (cur.length) groups.push(cur);
    const total = groups.reduce((n, g) => n + g.join(' ').length, 0);
    let t = s.start;
    for (const g of groups) {
      const text = g.join(' ');
      const d = ((s.end - s.start) * text.length) / total;
      lines.push({ text, start: t, end: t + d });
      t += d;
    }
  }
  return lines;
}

// ---- timeline ------------------------------------------------------------------

function captionTrack(p: Project): Track {
  let t = p.tracks.find((x) => x.role === 'captions');
  if (!t) {
    t = { id: uid('trk'), kind: 'text', role: 'captions', clips: [], muted: false, hidden: false, locked: false };
    p.tracks.unshift(t);
  }
  return t;
}

export const captionClips = (p: Project = store.project) =>
  p.tracks.flatMap((t) => t.clips.filter((c) => c.caption)).sort((a, b) => a.start - b.start);

const templateOf = (id: string) => CAPTION_TEMPLATES.find((t) => t.id === id) ?? CAPTION_TEMPLATES[0];

function makeCaption(line: Line, tpl: CaptionTemplate, highlight: string[] | undefined): Clip {
  const content = line.second ? `${line.text}\n${line.second}` : line.text;
  const clip = makeClip('text', {
    name: line.text.slice(0, 40), start: line.start, duration: Math.max(0.3, line.end - line.start), caption: true,
    text: defaultText({ ...tpl.style, content, highlightWords: highlight?.length ? highlight : undefined }),
  });
  clip.transform.y = tpl.y;
  return clip;
}

/** Puts caption lines on the captions track as one undo step. */
function placeCaptions(lines: Line[], o: Pick<CaptionOptions, 'templateId' | 'replace' | 'highlight'>) {
  const tpl = templateOf(o.templateId);
  store.commit((p) => {
    const track = captionTrack(p);
    if (o.replace) track.clips = track.clips.filter((c) => !c.caption);
    let prevEnd = 0;
    for (const l of lines) {
      const start = Math.max(l.start, prevEnd);
      if (l.end - start < 0.15) continue;
      const clip = makeCaption({ ...l, start }, tpl, o.highlight ? keywords(l.text) : undefined);
      if (!store.fits(track, clip.start, clip.duration)) continue;
      track.clips.push(clip);
      prevEnd = clipEnd(clip);
    }
  });
}

export async function generateCaptions(o: CaptionOptions, onProgress: (p: Progress) => void): Promise<number> {
  const p = store.project;
  const duration = p.tracks.reduce((d, t) => Math.max(d, ...t.clips.map(clipEnd)), 0);
  if (!soundClips(p).length) throw new Error('There is no audio on the timeline to caption.');
  onProgress({ stage: 'Preparing audio', progress: null });
  const audio = await mixMono(p, duration);
  const windows = speechWindows(audio);
  if (!windows.length) throw new Error('No speech found: the timeline audio is silent.');
  const segs = await recognise(audio, windows, o, onProgress);

  let main = segs.transcribe ?? [];
  if (o.removeFillers) {
    main = main.map((s) => ({ ...s, text: s.text.replace(FILLERS, '').replace(/\s{2,}/g, ' ').trim() })).filter((s) => s.text);
  }
  const translated = segs.translate;
  let lines: Line[];
  if (translated) {
    // Bilingual: one caption per sentence with the English line underneath.
    lines = main.map((s) => {
      const mid = (s.start + s.end) / 2;
      const tr = translated.find((t) => mid >= t.start && mid <= t.end)
        ?? translated.reduce((best, t) => (Math.abs((t.start + t.end) / 2 - mid) < Math.abs((best.start + best.end) / 2 - mid) ? t : best), translated[0]);
      return { text: s.text, start: s.start, end: s.end, second: tr?.text };
    });
  } else {
    lines = o.lyrics ? splitLines(main, 5, 28) : splitLines(main, 7, 34);
  }
  if (o.emojis) {
    for (const l of lines) {
      const hit = EMOJI.find(([re]) => re.test(l.text));
      if (hit) l.text = `${l.text} ${hit[1]}`;
    }
  }
  onProgress({ stage: 'Adding captions', progress: 1 });
  placeCaptions(lines, o);
  return lines.length;
}

// ---- templates / manual --------------------------------------------------------

/** Restyles every caption on the timeline with a template, keeping words and timing. */
export function applyTemplate(id: string) {
  const tpl = templateOf(id);
  store.commit((p) => {
    for (const c of captionClips(p)) {
      const keep = { content: c.text!.content, highlightWords: c.text!.highlightWords };
      c.text = defaultText({ ...tpl.style, ...keep });
      c.transform.y = tpl.y;
    }
  });
}

export function addCaptionAt(t: number, templateId: string) {
  const line = { text: 'Your caption', start: t, end: t + 2 };
  const tpl = templateOf(templateId);
  const clip = makeCaption(line, tpl, undefined);
  store.commit((p) => {
    const track = captionTrack(p);
    if (store.fits(track, clip.start, clip.duration)) track.clips.push(clip);
    else store.placeClip(p, clip);
  });
  store.select(clip.id);
}

// ---- SRT -----------------------------------------------------------------------

const srtTime = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export function exportSrt(): string {
  return captionClips().map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(clipEnd(c))}\n${c.text!.content}\n`).join('\n');
}

const parseTime = (s: string) => {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000;
};

/** Parses .srt or .vtt text into caption lines. */
export function importSubtitles(text: string, o: Pick<CaptionOptions, 'templateId' | 'replace' | 'highlight'>): number {
  const lines: Line[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n').filter((r) => r.trim() && r.trim() !== 'WEBVTT');
    const ti = rows.findIndex((r) => r.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = rows[ti].split('-->');
    const start = parseTime(a), end = parseTime(b);
    const body = rows.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (body && end > start) lines.push({ text: body, start, end });
  }
  if (lines.length) placeCaptions(lines, o);
  return lines.length;
}
