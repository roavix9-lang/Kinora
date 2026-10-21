import { store } from '../store';
import { MediaItem } from '../types';
import { fmtTime, h, icon } from './dom';
import { importOnly, pickFiles } from './importer';
import { closePopover, popover } from './select';

/** Videos and photos the user has imported (never the hidden sample photos). */
export const pickableMedia = () => [...store.media.values()].filter((m) => !m.deleted && !m.sample && m.status === 'ready' && (m.kind === 'video' || m.kind === 'image'));

export function mediaStill(m: MediaItem | undefined) {
  const bmp = m?.poster ?? m?.thumbs[0];
  if (!bmp) return h('div.tpl-slot-empty', null, icon('image', 16));
  const c = h('canvas') as HTMLCanvasElement;
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c;
}

/** Popover listing imported media; calls onPick with the chosen item. */
export function openSlotPicker(anchor: HTMLElement, onPick: (m: MediaItem) => void) {
  const grid = h('div.slot-picker');
  const render = () => {
    grid.replaceChildren(
      ...pickableMedia().map((m) => h('button.tpl-pick', {
        type: 'button', title: m.name, onclick: () => { closePopover(); onPick(m); },
      }, mediaStill(m), m.kind === 'video' ? h('span.tpl-pick-dur', null, fmtTime(m.duration)) : null)),
      h('button.tpl-pick.add', { type: 'button', title: 'Import media', onclick: async () => { await importOnly(await pickFiles()); render(); } }, icon('upload', 18), h('span', null, 'Import')),
    );
  };
  render();
  popover(anchor, h('div.slot-picker-wrap', null, h('div.section-label', null, 'Replace with'), grid), { minWidth: 300 });
}
