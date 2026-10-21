import { Clip, clipEnd, MediaItem, Project, Track, TrackKind, uid } from './types';

type Topic = 'project' | 'time' | 'select' | 'media' | 'playing' | 'view';
type Listener = () => void;

const HISTORY_LIMIT = 100;

export const ASPECTS: Record<string, [number, number]> = {
  '16:9': [16, 9],
  '4:3': [4, 3],
  '2.35:1': [2.35, 1],
  '2:1': [2, 1],
  '1.85:1': [1.85, 1],
  '9:16': [9, 16],
  '3:4': [3, 4],
  '5.8-inch': [9, 19.5],
  '1:1': [1, 1],
};

/** Grouping used by the Ratio menu (landscape, then portrait/square), as in CapCut. */
export const ASPECT_GROUPS = [['16:9', '4:3', '2.35:1', '2:1', '1.85:1'], ['9:16', '3:4', '5.8-inch', '1:1']];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Canvas size for a width/height ratio, with the short edge at `shortEdge` pixels. */
export function sizeForRatio(r: number, shortEdge = 1080): [number, number] {
  return r >= 1 ? [even(shortEdge * r), even(shortEdge)] : [even(shortEdge), even(shortEdge / r)];
}

export function sizeFor(aspect: string, shortEdge = 1080): [number, number] {
  const [a, b] = ASPECTS[aspect] ?? ASPECTS['16:9'];
  return sizeForRatio(a / b, shortEdge);
}

/** The project's ratio choice; older projects without one map to the closest preset. */
export function aspectOf(p: Project): string {
  if (p.ratio) return p.ratio;
  const r = p.width / p.height;
  for (const [k, [a, b]] of Object.entries(ASPECTS)) if (Math.abs(a / b - r) < 0.01) return k;
  return 'custom';
}

/** Width/height of the first visual media on the timeline (main track first), if any. */
export function originalRatio(p: Project, media: Map<string, MediaItem>): number | null {
  const tracks = [...p.tracks].sort((a, b) => Number(!!b.main) - Number(!!a.main));
  for (const t of tracks) for (const c of t.clips) {
    const m = c.mediaId ? media.get(c.mediaId) : undefined;
    if ((c.type === 'video' || c.type === 'image') && m?.width && m.height) {
      return m.rotation % 180 ? m.height / m.width : m.width / m.height;
    }
  }
  return null;
}

/** Short edge implied by the project's resolution setting ('adapted' follows the first video/photo, max 4K). */
export function targetShortEdge(p: Project, media: Map<string, MediaItem>): number {
  if (typeof p.resolution === 'number') return p.resolution;
  const tracks = [...p.tracks].sort((a, b) => Number(!!b.main) - Number(!!a.main));
  for (const t of tracks) for (const c of t.clips) {
    const m = c.mediaId ? media.get(c.mediaId) : undefined;
    if ((c.type === 'video' || c.type === 'image') && m?.width && m.height) return Math.min(2160, Math.min(m.width, m.height));
  }
  return Math.min(p.width, p.height);
}

/** Applies a Ratio-menu choice at the project's resolution setting. */
export function applyRatio(p: Project, choice: string, media: Map<string, MediaItem>) {
  const short = targetShortEdge(p, media);
  if (choice === 'original') {
    const r = originalRatio(p, media);
    if (r) [p.width, p.height] = sizeForRatio(r, short);
  } else if (ASPECTS[choice]) {
    [p.width, p.height] = sizeFor(choice, short);
  }
  p.ratio = choice;
}

export interface Folder { id: string; name: string }

export interface Timeline { id: string; project: Project; undo: string[]; redo: string[] }

export function newProject(): Project {
  return {
    name: 'Timeline 01',
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#000000',
    ratio: 'original',
    resolution: 'adapted',
    tracks: [{ id: uid('trk'), kind: 'video', clips: [], muted: false, hidden: false, locked: false, main: true }],
  };
}

class Store {
  project: Project = newProject();
  media = new Map<string, MediaItem>();
  selectedId: string | null = null;
  currentTime = 0;
  playing = false;
  /** Timeline zoom, pixels per second. */
  zoom = 60;
  snapping = true;
  /** CapCut-style magnetic main track: clips close gaps automatically. Off = free placement. */
  mainMagnet = (() => { try { return localStorage.getItem('kinora.mainMagnet') === '1'; } catch { return false; } })();

  /** True when the given track packs its clips back-to-back. */
  isMagnetic(t: Track) { return !!t.main && this.mainMagnet; }
  leftTab = 'media';
  previewFull = false;
  /** Project title (top bar); timelines inside it have their own names. */
  projectTitle = 'Untitled project';
  /** "Copy media to project": imported files are copied into memory, so moving or deleting the original doesn't break the project. */
  copyMedia = false;
  /** Prefer the GPU's video decoder (WebCodecs hardwareAcceleration). */
  hwDecode = true;
  /** Whether the selected template clip's slot strip is showing on the timeline. */
  templateStripOpen = false;
  /** Inspector tab to open on the next render (e.g. clicking a transition marker). */
  inspectorTab: string | null = null;
  /** Clip whose Adjust › Mask tab is open (shows the mask frame on the player). */
  maskEdit: string | null = null;
  /** Manual height of the upper (panels + player) area; null = automatic. */
  workH: number | null = null;
  /** Media item highlighted in the bin. */
  mediaSelectedId: string | null = null;
  /**
   * Library preview (CapCut): clicking a media item, sticker, effect, transition, template…
   * shows it in the player without adding it. Null = the player shows the timeline.
   */
  preview: { key: string; project: Project; time: number; from: number; to: number | null } | null = null;
  folders: Folder[] = [];

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Every timeline in the session; the open one mirrors `project` and the history stacks. */
  timelines: Timeline[] = [{ id: uid('tl'), project: this.project, undo: [], redo: [] }];
  activeTimelineId = this.timelines[0].id;
  private listeners = new Map<Topic, Set<Listener>>();
  private pending = new Set<Topic>();
  private scheduled = false;

  on(topic: Topic, fn: Listener) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic)!.add(fn);
    return () => this.listeners.get(topic)!.delete(fn);
  }

  /** Coalesces notifications into one dispatch per microtask. */
  emit(...topics: Topic[]) {
    topics.forEach((t) => this.pending.add(t));
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const ts = [...this.pending];
      this.pending.clear();
      for (const t of ts) this.listeners.get(t)?.forEach((fn) => fn());
    });
  }

  // ---- history -------------------------------------------------------------

  /** Records the current project as an undo point. Call before mutating. */
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Checkpoints, applies the mutation, and notifies. */
  commit(mutate: (p: Project) => void) {
    this.checkpoint();
    mutate(this.project);
    this.normalize();
    this.emit('project');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.afterRestore();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.afterRestore();
  }

  private afterRestore() {
    if (this.selectedId && !this.findClip(this.selectedId)) this.selectedId = null;
    this.reviveMedia();
    this.timelines.find((t) => t.id === this.activeTimelineId)!.project = this.project;
    this.emit('project', 'select', 'media');
  }

  /** Undoing a media delete brings its clips back; show the media in the bin again too. */
  private reviveMedia() {
    for (const t of this.project.tracks) for (const c of t.clips) {
      const m = c.mediaId ? this.media.get(c.mediaId) : undefined;
      if (m?.deleted && !m.sample) m.deleted = false;
    }
  }

  // ---- timelines -------------------------------------------------------------

  /** Display name for a timeline, e.g. "Timeline 01". */
  timelineName(id: string) {
    const i = this.timelines.findIndex((t) => t.id === id);
    return this.timelines[i]?.project.name || `Timeline ${String(i + 1).padStart(2, '0')}`;
  }

  /** Adds a timeline and makes it the open one. */
  addTimeline(project: Project) {
    const tl: Timeline = { id: uid('tl'), project, undo: [], redo: [] };
    this.timelines.push(tl);
    this.switchTimeline(tl.id);
    return tl;
  }

  switchTimeline(id: string) {
    const target = this.timelines.find((t) => t.id === id);
    if (!target || id === this.activeTimelineId) return;
    const cur = this.timelines.find((t) => t.id === this.activeTimelineId)!;
    Object.assign(cur, { project: this.project, undo: this.undoStack, redo: this.redoStack });
    this.activeTimelineId = id;
    this.project = target.project;
    this.undoStack = target.undo;
    this.redoStack = target.redo;
    this.selectedId = null;
    this.currentTime = 0;
    this.normalize();
    this.emit('project', 'select', 'time', 'view');
  }

  /** Every clip in every timeline that uses the media item. */
  mediaUsage(mediaId: string) {
    let n = 0;
    for (const tl of this.timelines) {
      const p = tl.id === this.activeTimelineId ? this.project : tl.project;
      for (const t of p.tracks) for (const c of t.clips) if (c.mediaId === mediaId) n++;
    }
    return n;
  }

  // ---- queries -------------------------------------------------------------

  get duration() {
    let d = 0;
    for (const t of this.project.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
    return d;
  }

  /** What the player shows: the library preview if one is open, else the timeline. */
  get viewProject(): Project { return this.preview?.project ?? this.project; }
  get viewTime(): number { return this.preview ? this.preview.time : this.currentTime; }
  get viewDuration(): number {
    if (!this.preview) return this.duration;
    let d = 0;
    for (const t of this.preview.project.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
    return d;
  }
  setViewTime(t: number) {
    if (!this.preview) { this.setTime(t); return; }
    this.preview.time = Math.min(Math.max(0, t), this.viewDuration);
    this.emit('time');
  }
  findViewClip(id: string): { clip: Clip; track: Track } | null {
    for (const track of this.viewProject.tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return { clip, track };
    }
    return null;
  }
  /** `from`/`to`: the part Play plays (e.g. a sticker's 3 s over your video). */
  setPreview(key: string, project: Project, from = 0, to: number | null = null) {
    this.preview = { key, project, time: from, from, to };
    this.emit('view', 'time');
  }
  clearPreview() {
    if (!this.preview) return;
    this.preview = null;
    this.emit('view', 'time');
  }

  findClip(id: string): { clip: Clip; track: Track } | null {
    for (const track of this.project.tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return { clip, track };
    }
    return null;
  }

  /** Finds a clip in any project (e.g. one being exported). */
  findClipIn(p: Project, id: string): Clip | null {
    for (const t of p.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return c; }
    return null;
  }

  get selected(): Clip | null {
    return this.selectedId ? this.findClip(this.selectedId)?.clip ?? null : null;
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('select');
  }

  setTime(t: number) {
    const max = Math.max(this.duration, 0);
    this.currentTime = Math.min(Math.max(0, t), max);
    this.emit('time');
  }

  // ---- structural helpers --------------------------------------------------

  /** Keeps clips sorted, removes empty non-main tracks, keeps a main video track. */
  normalize() {
    const p = this.project;
    for (const t of p.tracks) {
      t.clips.sort((a, b) => a.start - b.start);
      if (this.isMagnetic(t)) {
        // Magnetic main track: clips sit back-to-back from 0.
        let at = 0;
        for (const c of t.clips) { c.start = at; at += c.duration; }
      }
    }
    p.tracks = p.tracks.filter((t) => t.main || t.clips.length > 0);
    if (!p.tracks.some((t) => t.main)) {
      p.tracks.push({ id: uid('trk'), kind: 'video', clips: [], muted: false, hidden: false, locked: false, main: true });
    }
    // Ordering convention: text tracks, overlay video tracks, main track, audio tracks.
    const rank = (t: Track) => (t.kind === 'text' ? 0 : t.kind === 'effect' ? 1 : t.kind === 'video' ? (t.main ? 3 : 2) : 4);
    p.tracks = p.tracks
      .map((t, i) => ({ t, i }))
      .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
      .map((x) => x.t);
  }

  /** True when [start, start+dur) is free on the track (ignoring clip `ignoreId`). */
  fits(track: Track, start: number, dur: number, ignoreId?: string) {
    const eps = 1e-4;
    return track.clips.every((c) => c.id === ignoreId || start + dur <= c.start + eps || start >= clipEnd(c) - eps);
  }

  trackKindFor(clip: Clip): TrackKind {
    if (clip.type === 'audio') return 'audio';
    if (clip.type === 'effect' || clip.type === 'filter') return 'effect';
    return clip.type === 'text' || clip.type === 'sticker' ? 'text' : 'video';
  }

  /**
   * Places a clip on a suitable track: the preferred track if it fits, otherwise
   * the first compatible track with room, otherwise a newly created track.
   */
  placeClip(p: Project, clip: Clip, preferred?: Track): Track {
    const kind = this.trackKindFor(clip);
    if (preferred && preferred.kind === kind && this.fits(preferred, clip.start, clip.duration, clip.id)) {
      preferred.clips.push(clip);
      return preferred;
    }
    // Overlays never land on the magnetic main track implicitly.
    const candidates = p.tracks.filter((t) => t.kind === kind && !t.main);
    for (const t of candidates) {
      if (this.fits(t, clip.start, clip.duration, clip.id)) { t.clips.push(clip); return t; }
    }
    const track: Track = { id: uid('trk'), kind, clips: [clip], muted: false, hidden: false, locked: false };
    const mainIdx = p.tracks.findIndex((t) => t.main);
    if (kind === 'audio') p.tracks.push(track);
    else if (kind === 'text') p.tracks.unshift(track);
    else p.tracks.splice(Math.max(0, mainIdx), 0, track);
    return track;
  }

  /** Appends a clip to the end of the main track (CapCut behaviour for the first video clips). */
  mainTrackEnd(): number {
    const main = this.project.tracks.find((t) => t.main);
    return main && main.clips.length ? Math.max(...main.clips.map(clipEnd)) : 0;
  }
}

export const store = new Store();
(window as unknown as { kinora: Store }).kinora = store;
