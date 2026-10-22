import { h, icon } from './dom';

export interface Option<T> { id: T; name: string; disabled?: boolean; hint?: string; preview?: HTMLElement }

let openPop: { el: HTMLElement; close: () => void } | null = null;

export function closePopover() { openPop?.close(); }

/**
 * Anchored floating panel. Flips above the anchor when there is no room below
 * and closes on outside click, Escape, scroll or resize.
 */
export function popover(anchor: HTMLElement, content: HTMLElement, opts: { align?: 'start' | 'end'; minWidth?: number; preferBelow?: number } = {}) {
  closePopover();
  const el = h('div.popover', { role: 'menu' }, content);
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    el.style.minWidth = `${Math.max(opts.minWidth ?? 0, r.width)}px`;
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const below = window.innerHeight - r.bottom - 8;
    // preferBelow: open downward (scrolling if needed) whenever at least that much room is below.
    const down = below >= ph || below >= r.top || (opts.preferBelow !== undefined && below >= opts.preferBelow);
    const top = down ? r.bottom + 4 : r.top - ph - 4;
    let left = opts.align === 'end' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${left}px`;
    el.style.maxHeight = `${Math.max(120, window.innerHeight - 16 - Math.max(8, top))}px`;
  };
  place();
  anchor.classList.add('open');
  const onDown = (e: PointerEvent) => { if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  const onScroll = (e: Event) => { if (!el.contains(e.target as Node)) close(); };
  function close() {
    el.remove();
    anchor.classList.remove('open');
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    if (openPop?.el === el) openPop = null;
  }
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  openPop = { el, close };
  return { el, close };
}

/** Styled dropdown replacing the native <select>. */
export function dropdown<T extends string | number>(
  value: T,
  options: Option<T>[],
  onChange: (v: T) => void,
  opts: { className?: string; label?: (o: Option<T> | undefined) => string; align?: 'start' | 'end' } = {},
): HTMLElement {
  let current = value;
  const labelEl = h('span.dd-label');
  const btn = h(`button.dd${opts.className ? `.${opts.className}` : ''}`, { type: 'button', 'aria-haspopup': 'listbox' }, labelEl, icon('chevron', 14));
  const paint = () => {
    const o = options.find((x) => x.id === current);
    labelEl.textContent = opts.label ? opts.label(o) : o?.name ?? String(current);
  };
  paint();

  btn.addEventListener('click', () => {
    if (btn.classList.contains('open')) { closePopover(); return; }
    const list = h('div.dd-list', { role: 'listbox' });
    const items: HTMLElement[] = [];
    let pop: { el: HTMLElement; close: () => void } | null = null;
    let focus = Math.max(0, options.findIndex((o) => o.id === current));
    const setFocus = (i: number) => {
      focus = (i + items.length) % items.length;
      items.forEach((it, k) => it.classList.toggle('focus', k === focus));
      // Scroll only inside the list: scrollIntoView would also scroll the page behind it,
      // and any page scroll closes the popover.
      const it = items[focus], box = pop?.el;
      if (it && box) {
        if (it.offsetTop < box.scrollTop) box.scrollTop = it.offsetTop - 4;
        else if (it.offsetTop + it.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = it.offsetTop + it.offsetHeight - box.clientHeight + 4;
      }
    };
    const pick = (o: Option<T>) => {
      if (o.disabled) return;
      pop?.close();
      btn.focus();
      if (o.id !== current) { current = o.id; paint(); onChange(o.id); }
    };
    options.forEach((o, i) => {
      const it = h(`button.dd-item${o.id === current ? '.selected' : ''}${o.disabled ? '.disabled' : ''}`, {
        type: 'button', role: 'option', 'aria-selected': o.id === current,
        onclick: () => pick(o), onpointerenter: () => setFocus(i),
      }, o.preview ?? null, h('span.dd-name', null, o.name), o.hint ? h('span.dd-hint', null, o.hint) : null,
      o.id === current ? icon('check', 14) : h('span.dd-check'));
      items.push(it);
      list.append(it);
    });
    pop = popover(btn, list, { align: opts.align });
    setFocus(focus);
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(focus + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(focus - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[focus]); }
    });
    items[focus]?.focus({ preventScroll: true });
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btn.click(); }
  });
  return btn;
}
