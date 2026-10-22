import { store } from '../store';
import { MediaItem, Project } from '../types';
import { importFiles } from './media';

// Projects, kept in IndexedDB across reloads: each project's timelines, title, folders and the
// imported media files themselves (copied in, so they survive even if the originals move).
// Media files are shared between projects and only removed once no project uses them.
// Undo history is not kept.

const DB_NAME = 'kinora';
const INDEX = 'projects';
const LEGACY_SESSION = 'session';
const projectKey = (id: string) => `project:${id}`;

export interface Session {
  v: 1;
  projectTitle: string;
  activeTimelineId: string;
  timelines: { id: string; project: Project }[];
  folders: typeof store.folders;
  media: Pick<MediaItem, 'id' | 'name' | 'folderId' | 'deleted'>[];
  /** Open the template slot strip on first load (projects started from "Use template"). */
  openStrip?: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  created: number;
  updated: number;
  duration: number;
  /** Small WebP data URL of a frame. */
  cover?: string;
  /** Set when moved to Trash (time it was trashed). */
  trashed?: number;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: 'kv' | 'files', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const getKv = <T,>(key: string) => tx<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>);
const putKv = (key: string, v: unknown) => tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(v)), key));
const delKv = (key: string) => tx('kv', 'readwrite', (s) => s.delete(key));
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---- project list ---------------------------------------------------------------------------

async function readIndex(): Promise<ProjectMeta[]> {
  // Skip broken entries (a project must have a real id).
  let list = ((await getKv<ProjectMeta[]>(INDEX)) ?? []).filter((p) => p && typeof p.id === 'string' && /^[\w-]+$/.test(p.id) && p.id !== 'undefined');
  // One-time move of the old single session into a project.
  const legacy = await getKv<Session>(LEGACY_SESSION);
  if (legacy?.v === 1) {
    const id = newId();
    await putKv(projectKey(id), legacy);
    const now = Date.now();
    list = [{ id, name: legacy.projectTitle || 'Untitled project', created: now, updated: now, duration: durationOf(legacy) }, ...list];
    await putKv(INDEX, list);
    await delKv(LEGACY_SESSION);
  }
  return list;
}

function durationOf(s: Session) {
  let d = 0;
  for (const tl of s.timelines) for (const t of tl.project.tracks) for (const c of t.clips) d = Math.max(d, c.start + c.duration);
  return d;
}

export const listProjects = readIndex;

async function updateMeta(id: string, patch: Partial<ProjectMeta>) {
  const list = await readIndex();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  await putKv(INDEX, list);
}

/** Creates a project (empty, or from a prepared session) and returns its id. */
export async function createProject(session?: Partial<Session>): Promise<string> {
  const id = newId();
  const now = Date.now();
  const s: Session = { v: 1, projectTitle: 'Untitled project', activeTimelineId: '', timelines: [], folders: [], media: [], ...session };
  if (s.timelines.length || s.media.length) await putKv(projectKey(id), s);
  const list = await readIndex();
  await putKv(INDEX, [{ id, name: s.projectTitle, created: now, updated: now, duration: durationOf(s) }, ...list]);
  return id;
}

export const renameProject = (id: string, name: string) => updateMeta(id, { name: name.trim() || 'Untitled project' });
export const trashProject = (id: string) => updateMeta(id, { trashed: Date.now() });
export const restoreProject = (id: string) => updateMeta(id, { trashed: undefined });

export async function duplicateProject(id: string): Promise<string> {
  const list = await readIndex();
  const meta = list.find((p) => p.id === id);
  const s = await getKv<Session>(projectKey(id));
  const copy = newId();
  const now = Date.now();
  if (s) await putKv(projectKey(copy), { ...s, projectTitle: `${s.projectTitle} copy` });
  await putKv(INDEX, [{ ...(meta ?? { duration: 0 }), id: copy, name: `${meta?.name ?? 'Untitled project'} copy`, created: now, updated: now, trashed: undefined }, ...list]);
  return copy;
}

/** Deletes a project for good, and any media files no other project uses. */
export async function deleteProject(id: string) {
  await delKv(projectKey(id));
  const list = (await readIndex()).filter((p) => p.id !== id);
  await putKv(INDEX, list);
  const used = new Set<string>();
  for (const p of list) for (const m of (await getKv<Session>(projectKey(p.id)))?.media ?? []) used.add(m.id);
  const keys = (await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys())) ?? [];
  for (const k of keys) if (!used.has(String(k))) await tx('files', 'readwrite', (s) => s.delete(k));
}

// ---- the open project -----------------------------------------------------------------------

let currentId = '';
const savedFiles = new Set<string>();
let coverFn: (() => string | null) | null = null;
let lastCover = 0;

async function save() {
  if (!currentId) return;
  // Library songs live in the offline cache already; samples are bundled.
  const live = [...store.media.values()].filter((m) => !m.sample && !m.library);
  const session: Session = {
    v: 1,
    projectTitle: store.projectTitle,
    activeTimelineId: store.activeTimelineId,
    timelines: store.timelines.map((t) => ({ id: t.id, project: t.id === store.activeTimelineId ? store.project : t.project })),
    folders: store.folders,
    media: live.map((m) => ({ id: m.id, name: m.name, folderId: m.folderId, deleted: m.deleted })),
  };
  await putKv(projectKey(currentId), session);
  for (const m of live) {
    if (savedFiles.has(m.id)) continue;
    await tx('files', 'readwrite', (s) => s.put(m.file, m.id));
    savedFiles.add(m.id);
  }
  const patch: Partial<ProjectMeta> = { name: store.projectTitle, updated: Date.now(), duration: store.duration };
  // A fresh cover now and then (it's a small WebP of the current frame).
  if (coverFn && Date.now() - lastCover > 10000) {
    const c = coverFn();
    if (c) { patch.cover = c; lastCover = Date.now(); }
  }
  await updateMeta(currentId, patch);
}

let timer = 0;
let saving = Promise.resolve();
function scheduleSave() {
  clearTimeout(timer);
  timer = window.setTimeout(() => { saving = saving.then(save).catch((err) => console.warn('Could not save the project', err)); }, 500);
}
/** Saves now (e.g. before going back to Home). */
export function flushSave() { clearTimeout(timer); saving = saving.then(save).catch(() => {}); return saving; }

/** Reads a session's saved media files (in parallel) with the details they were saved with. */
async function readFiles(media: Session['media']) {
  const got = await Promise.all(media.map((m) => tx<File>('files', 'readonly', (s) => s.get(m.id) as IDBRequest<File>)));
  const files: File[] = [];
  const meta: Session['media'] = [];
  got.forEach((f, i) => { if (f) { files.push(f); meta.push(media[i]); savedFiles.add(media[i].id); } });
  return { files, meta };
}

/** Opens a project in the editor and keeps saving it. `cover` grabs a thumbnail of the player. */
export async function initPersistence(projectId: string, cover?: () => string | null) {
  if (!projectId || projectId === 'undefined') return;
  currentId = projectId;
  coverFn = cover ?? null;
  try {
    const list = await readIndex();
    if (!list.some((p) => p.id === projectId)) {
      const now = Date.now();
      await putKv(INDEX, [{ id: projectId, name: 'Untitled project', created: now, updated: now, duration: 0 }, ...list]);
    }
    const session = await getKv<Session>(projectKey(projectId));
    if (session?.v === 1 && !session.timelines.length && session.media.length) {
      // Started from the Library: media in the bin, empty timeline.
      const { files, meta } = await readFiles(session.media);
      if (files.length) void importFiles(files, meta);
      store.projectTitle = session.projectTitle;
      store.emit('view');
    } else if (session?.v === 1 && session.timelines.length) {
      // Media first (registered at once, still loading), then the timelines that use it, so the
      // player never shows "Media Not Found" for clips whose file is on its way.
      const { files, meta } = await readFiles(session.media);
      if (files.length) void importFiles(files, meta);
      store.projectTitle = session.projectTitle;
      store.folders = session.folders ?? [];
      store.timelines = session.timelines.map((t) => ({ id: t.id, project: t.project, undo: [], redo: [] }));
      const active = store.timelines.find((t) => t.id === session.activeTimelineId) ?? store.timelines[0];
      store.activeTimelineId = active.id;
      store.project = active.project;
      if (session.openStrip) {
        store.templateStripOpen = true;
        const tpl = active.project.tracks.flatMap((t) => t.clips).find((c) => c.type === 'template');
        if (tpl) store.selectedId = tpl.id;
      }
      store.emit('project', 'media', 'view', 'time', 'select');
    } else {
      const meta = list.find((p) => p.id === projectId);
      if (meta) { store.projectTitle = meta.name; store.emit('view'); }
    }
  } catch (err) {
    console.warn('Could not open the project', err);
  }
  store.on('project', scheduleSave);
  store.on('media', scheduleSave);
  store.on('view', scheduleSave);
  // Save straight away when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave(); });
}

// ---- Library (every imported file, across projects) ----------------------------------------

export interface LibraryFile {
  id: string;
  name: string;
  file: File;
  /** Names of the projects that use it. */
  projects: string[];
}

export async function listLibraryMedia(): Promise<LibraryFile[]> {
  const list = await readIndex();
  const out = new Map<string, LibraryFile>();
  for (const p of list) {
    if (p.trashed) continue;
    for (const m of (await getKv<Session>(projectKey(p.id)))?.media ?? []) {
      if (m.deleted) continue;
      const hit = out.get(m.id);
      if (hit) { if (!hit.projects.includes(p.name)) hit.projects.push(p.name); continue; }
      const f = await tx<File>('files', 'readonly', (s) => s.get(m.id) as IDBRequest<File>);
      if (f) out.set(m.id, { id: m.id, name: m.name, file: f, projects: [p.name] });
    }
  }
  return [...out.values()];
}
