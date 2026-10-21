import { h } from './dom';
import { closePopover } from './select';

export type MenuItem =
  | { label: string; onSelect?: () => void; disabled?: boolean; badge?: string; title?: string; danger?: boolean }
  | 'separator';

let current: { el: HTMLElement; close: () => void } | null = null;

export function closeContextMenu() { current?.close(); }

/** Shows a CapCut-style context menu at viewport coordinates, kept on screen. */
export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeContextMenu();
  closePopover();
  const buttons: HTMLButtonElement[] = [];
  const menu = h('div.ctx-menu', { role: 'menu' });
  for (const it of items) {
    if (it === 'separator') { menu.append(h('div.ctx-sep', { role: 'separator' })); continue; }
    const b = h(`button.ctx-item${it.danger ? '.danger' : ''}`, {
      type: 'button', role: 'menuitem', title: it.title, 'aria-disabled': it.disabled ? 'true' : undefined,
      onclick: () => { if (it.disabled) return; close(); it.onSelect?.(); },
    }, h('span', null, it.label), it.badge ? h('span.ctx-badge', null, it.badge) : null) as HTMLButtonElement;
    if (it.disabled) b.classList.add('disabled');
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, y + r.height > window.innerHeight - 8 ? y - r.height : y)}px`;

  const enabled = () => buttons.filter((b) => !b.classList.contains('disabled'));
  const move = (dir: number) => {
    const list = enabled();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + dir + list.length) % list.length].focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };
  const onDown = (e: PointerEvent) => { if (!menu.contains(e.target as Node)) close(); };
  function close() {
    menu.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    document.removeEventListener('scroll', close, true);
    if (current?.el === menu) current = null;
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  document.addEventListener('scroll', close, true);
  current = { el: menu, close };
  enabled()[0]?.focus({ preventScroll: true });
}

/**
 * Opens a menu on right-click (PC), two-finger tap or Ctrl+click (Mac trackpads fire
 * `contextmenu` for both) and long-press on touch screens.
 */
export function onContextMenu(el: HTMLElement, build: (e: { x: number; y: number }) => MenuItem[]) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, build({ x: e.clientX, y: e.clientY }));
  });
  let timer = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const { clientX: x, clientY: y } = e;
    timer = window.setTimeout(() => showContextMenu(x, y, build({ x, y })), 550);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 4)) cancel(); });
}

/** Small styled confirmation modal; resolves true when confirmed. */
export function confirmDialog(title: string, body: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { backdrop.remove(); resolve(v); };
    const ok = h('button.primary-btn.danger', { type: 'button', onclick: () => done(true) }, confirmLabel);
    const backdrop = h('div.modal-backdrop', {
      onpointerdown: (e: Event) => { if (e.target === backdrop) done(false); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); },
    }, h('div.modal.small', { role: 'alertdialog', 'aria-label': title },
      h('div.modal-head', null, h('h2', null, title)),
      h('p.modal-text', null, body),
      h('div.modal-foot', null, h('button.ghost-btn', { type: 'button', onclick: () => done(false) }, 'Cancel'), ok)));
    document.body.append(backdrop);
    ok.focus();
  });
}
