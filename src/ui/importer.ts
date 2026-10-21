import { addMediaToTimeline } from '../actions';
import { importFiles } from '../engine/media';
import { toast } from './dom';

const ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov,.mts,.m4a,.flac,.opus';

export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: ACCEPT });
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export async function importOnly(files: File[]) {
  if (!files.length) return [];
  const items = await importFiles(files);
  const failed = items.filter((i) => i.status === 'error');
  if (failed.length) toast(`Couldn't import ${failed.map((f) => f.name).join(', ')}: ${failed[0].error}`, 'error');
  if (items.length < files.length) toast('Some files were skipped (unsupported type)', 'error');
  return items;
}

/** Imports files and appends each successfully probed item to the timeline. */
export async function importAndAdd(files: File[]) {
  const items = await importOnly(files);
  for (const m of items) if (m.status === 'ready') addMediaToTimeline(m);
}
