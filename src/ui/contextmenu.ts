import { h } from './dom';
import { closePopover } from './select';

export type MenuItem =
  | {
    label: string; onSelect?: () => void; disabled?: boolean; badge?: string; title?: string; danger?: boolean;
    /** Keys as tokens: 'mod' (⌘ / Ctrl), 'shift', 'alt', 'ctrl', 'del', or a letter. */
    shortcut?: string[];
    submenu?: MenuItem[];
    /** Radio-style choice: shows a ✓ (items in that menu get room for it). */
    checked?: boolean;
  }
  | 'separator';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_MAC: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', del: '⌫' };
const KEY_WIN: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', del: 'Del' };
/** Shortcut keys as this platform writes them (⌘ ⇧ C on a Mac, Ctrl Shift C on Windows). */
export const keyCaps = (keys: string[]) => keys.map((k) => (IS_MAC ? KEY_MAC : KEY_WIN)[k] ?? k.toUpperCase());

let current: { el: HTMLElement; close: () => void } | null = null;

export function closeContextMenu() { current?.close(); }

/** Shows a CapCut-style context menu at viewport coordinates, kept on screen. */
export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeContextMenu();
  closePopover();
  const buttons: HTMLButtonElement[] = [];
  const menu = h('div.ctx-menu', { role: 'menu' });
  let sub: HTMLElement | null = null;
  const closeSub = () => { sub?.remove(); sub = null; };
  const openSub = (b: HTMLElement, list: MenuItem[]) => {
    closeSub();
    sub = h('div.ctx-menu.ctx-sub', { role: 'menu' });
    for (const it of list) addItem(sub, it, false);
    document.body.append(sub);
    const br = b.getBoundingClientRect(), sr = sub.getBoundingClientRect();
    const right = br.right + 2 + sr.width < window.innerWidth - 8;
    sub.style.left = `${right ? br.right + 2 : br.left - sr.width - 2}px`;
    sub.style.top = `${Math.max(8, Math.min(br.top - 4, window.innerHeight - sr.height - 8))}px`;
  };
  function addItem(into: HTMLElement, it: MenuItem, top: boolean) {
    if (it === 'separator') { into.append(h('div.ctx-sep', { role: 'separator' })); return; }
    const right = it.submenu
      ? h('span.ctx-more', null, '›')
      : it.shortcut ? h('span.ctx-keys', null, ...keyCaps(it.shortcut).map((k) => h('kbd', null, k))) : null;
    const b = h(`button.ctx-item${it.danger ? '.danger' : ''}`, {
      type: 'button', role: 'menuitem', title: it.title, 'aria-disabled': it.disabled ? 'true' : undefined,
      'aria-haspopup': it.submenu ? 'menu' : undefined,
      onclick: () => {
        if (it.disabled) return;
        if (it.submenu) { openSub(b, it.submenu); return; }
        close(); it.onSelect?.();
      },
      onmouseenter: () => { if (top) { if (it.submenu && !it.disabled) openSub(b, it.submenu); else closeSub(); } },
    }, it.checked !== undefined ? h('span.ctx-check', null, it.checked ? '✓' : '') : null, h('span', null, it.label), it.badge ? h('span.ctx-badge', null, it.badge) : null, right) as HTMLButtonElement;
    if (it.disabled) b.classList.add('disabled');
    if (top) buttons.push(b);
    into.append(b);
  }
  for (const it of items) addItem(menu, it, true);
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
  const onDown = (e: PointerEvent) => { if (!menu.contains(e.target as Node) && !sub?.contains(e.target as Node)) close(); };
  function close() {
    closeSub();
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
