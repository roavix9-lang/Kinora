import { Player } from '../engine/player';
import { relinkMedia } from '../engine/media';
import { newProject, store } from '../store';
import { makeClip, MediaItem, Project, uid } from '../types';
import { MenuItem, confirmDialog } from './contextmenu';
import { toast } from './dom';
import { openExportDialog } from './exportDialog';
import { pickFiles } from './importer';

export interface MediaMenuHooks {
  player: Player;
  /** Puts the item's name into inline edit mode. */
  startRename: (m: MediaItem) => void;
  /** Shows a media-bin folder. */
  openFolder: (folderId: string) => void;
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Context menu for a media-bin item, mirroring CapCut's. */
export function mediaMenu(m: MediaItem, hooks: MediaMenuHooks): MenuItem[] {
  const ready = m.status === 'ready';
  return [
    { label: 'Open file location', disabled: true, title: 'Browsers are not allowed to open Finder or File Explorer' },
    { label: 'Rename', onSelect: () => hooks.startRename(m) },
    { label: 'Delete', onSelect: () => void deleteMedia(m), danger: true },
    { label: 'Create multi-camera clip', disabled: true, badge: 'Soon' },
    { label: 'New folder with selected item', onSelect: () => hooks.openFolder(newFolderWith(m)) },
    { label: 'New timeline with selected item', disabled: !ready, onSelect: () => newTimelineWith(m) },
    { label: 'Link to media', onSelect: () => void linkToMedia(m) },
    { label: 'Split scenes', disabled: true, badge: 'Soon' },
    { label: 'Transcript', disabled: true },
    { label: 'Export selected clips', disabled: !ready, onSelect: () => openExportDialog(hooks.player, singleItemProject(m)) },
  ];
}

export function renameMedia(m: MediaItem, name: string) {
  name = name.trim();
  if (!name || name === m.name) return;
  const old = m.name;
  m.name = name;
  // Clips that still carry the media's name follow the rename (in every timeline).
  for (const tl of store.timelines) {
    const p = tl.id === store.activeTimelineId ? store.project : tl.project;
    for (const t of p.tracks) for (const c of t.clips) if (c.mediaId === m.id && c.name === old) c.name = name;
  }
  store.emit('media', 'project');
}

async function deleteMedia(m: MediaItem) {
  const used = store.project.tracks.reduce((n, t) => n + t.clips.filter((c) => c.mediaId === m.id).length, 0);
  if (used) {
    const ok = await confirmDialog(
      `Delete “${m.name}”?`,
      `It's used by ${used} clip${used > 1 ? 's' : ''} on this timeline. Those clips will be removed too. You can undo this with Ctrl+Z.`,
    );
    if (!ok) return;
    store.commit((p) => { for (const t of p.tracks) t.clips = t.clips.filter((c) => c.mediaId !== m.id); });
    if (store.selected?.mediaId === m.id) store.select(null);
  }
  m.deleted = true;
  if (store.mediaSelectedId === m.id) store.mediaSelectedId = null;
  store.emit('media');
  toast(`Deleted “${m.name}”`);
}

function newFolderWith(m: MediaItem): string {
  let n = store.folders.length + 1;
  while (store.folders.some((f) => f.name === `New folder ${n}`)) n++;
  const folder = { id: uid('fld'), name: `New folder ${n}` };
  store.folders.push(folder);
  m.folderId = folder.id;
  store.emit('media');
  toast(`Moved “${m.name}” into ${folder.name}. Right-click the folder to rename it.`);
  return folder.id;
}

/** A one-clip timeline sized to the media, used by "New timeline" and "Export selected clips". */
function singleItemProject(m: MediaItem): Project {
  const p = newProject();
  p.name = baseName(m.name);
  p.fps = Math.round(m.fps) || store.project.fps;
  if (m.width && m.height) {
    const rotated = m.rotation % 180 !== 0;
    const w = rotated ? m.height : m.width, hh = rotated ? m.width : m.height;
    const scale = Math.min(1, 2160 / Math.min(w, hh));
    const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
    p.width = even(w);
    p.height = even(hh);
  } else {
    p.width = store.project.width;
    p.height = store.project.height;
  }
  const type = m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'audio' : 'video';
  const clip = makeClip(type, { mediaId: m.id, name: m.name, duration: m.duration });
  if (type === 'audio') p.tracks.push({ id: uid('trk'), kind: 'audio', clips: [clip], muted: false, hidden: false, locked: false });
  else p.tracks[0].clips.push(clip);
  return p;
}

function newTimelineWith(m: MediaItem) {
  const p = singleItemProject(m);
  store.addTimeline(p);
  toast(`Created timeline “${p.name}”. Switch timelines from the Player header.`, 'ok');
}

async function linkToMedia(m: MediaItem) {
  const [file] = await pickFiles();
  if (!file) return;
  toast(`Linking “${m.name}” to ${file.name}…`);
  try {
    const ok = await relinkMedia(m, file);
    toast(ok ? `Linked to ${file.name}` : `Couldn't use ${file.name}: ${m.error}`, ok ? 'ok' : 'error');
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
  }
}
