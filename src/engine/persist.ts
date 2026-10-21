import { store } from '../store';
import { MediaItem, Project } from '../types';
import { importFiles } from './media';

// Keeps the session across page reloads: every timeline, the project title, folders and
// the imported media files themselves (copied into IndexedDB, so they survive even if the
// originals move). Undo history is not kept.

const DB_NAME = 'kinora';
const SESSION = 'session';

interface Session {
  v: 1;
  projectTitle: string;
  activeTimelineId: string;
  timelines: { id: string; project: Project }[];
  folders: typeof store.folders;
  media: Pick<MediaItem, 'id' | 'name' | 'folderId' | 'deleted'>[];
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

const savedFiles = new Set<string>();

async function save() {
  const live = [...store.media.values()].filter((m) => !m.sample);
  const session: Session = {
    v: 1,
    projectTitle: store.projectTitle,
    activeTimelineId: store.activeTimelineId,
    timelines: store.timelines.map((t) => ({ id: t.id, project: t.id === store.activeTimelineId ? store.project : t.project })),
    folders: store.folders,
    media: live.map((m) => ({ id: m.id, name: m.name, folderId: m.folderId, deleted: m.deleted })),
  };
  await tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(session)), SESSION));
  // Media bytes: store new files once, drop files whose media is gone.
  for (const m of live) {
    if (savedFiles.has(m.id)) continue;
    await tx('files', 'readwrite', (s) => s.put(m.file, m.id));
    savedFiles.add(m.id);
  }
  const ids = new Set(live.map((m) => m.id));
  for (const id of [...savedFiles]) {
    if (ids.has(id)) continue;
    await tx('files', 'readwrite', (s) => s.delete(id));
    savedFiles.delete(id);
  }
}

let timer = 0;
let saving = Promise.resolve();
function scheduleSave() {
  clearTimeout(timer);
  timer = window.setTimeout(() => { saving = saving.then(save).catch((err) => console.warn('Could not save the session', err)); }, 500);
}

/** Restores the last session (if any), then saves on every change. */
export async function initPersistence() {
  try {
    const session = await tx<Session>('kv', 'readonly', (s) => s.get(SESSION) as IDBRequest<Session>);
    if (session?.v === 1 && session.timelines.length) {
      store.projectTitle = session.projectTitle;
      store.folders = session.folders ?? [];
      store.timelines = session.timelines.map((t) => ({ id: t.id, project: t.project, undo: [], redo: [] }));
      const active = store.timelines.find((t) => t.id === session.activeTimelineId) ?? store.timelines[0];
      store.activeTimelineId = active.id;
      store.project = active.project;
      store.emit('project', 'media', 'view', 'time');
      // Bring the media back under its old ids (thumbnails and audio rebuild in the background).
      const files: File[] = [];
      const meta: Session['media'] = [];
      for (const m of session.media) {
        const f = await tx<File>('files', 'readonly', (s) => s.get(m.id) as IDBRequest<File>);
        if (f) { files.push(f); meta.push(m); savedFiles.add(m.id); }
      }
      if (files.length) void importFiles(files, meta);
    }
  } catch (err) {
    console.warn('Could not restore the last session', err);
  }
  store.on('project', scheduleSave);
  store.on('media', scheduleSave);
  store.on('view', scheduleSave);
  // Save straight away when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); void save(); } });
}
