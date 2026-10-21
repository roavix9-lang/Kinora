import { updateClip } from '../actions';
import { Clip } from '../types';
import { h, icon } from './dom';
import { dropdown, Option } from './select';

// Shared inspector controls: sliders with value boxes, rows, collapsible sections, toggles.

const collapsed = new Set<string>();

export type Fmt = { show: (v: number) => string; parse: (s: string) => number; unit?: string };
export const PCT: Fmt = { show: (v) => String(Math.round(v * 100)), parse: (s) => parseFloat(s) / 100, unit: '%' };
export const SIGNED: Fmt = { show: (v) => String(Math.round(v * 100)), parse: (s) => parseFloat(s) / 100 };
export const RAW = (digits = 0, unit = ''): Fmt => ({ show: (v) => v.toFixed(digits), parse: (s) => parseFloat(s), unit });

/** One slider gesture = one undo step: the first input checkpoints, later inputs don't. */
export function live(clipId: string, fn: (c: Clip, v: number) => void) {
  let started = false;
  return {
    input: (v: number) => { updateClip(clipId, (c) => fn(c, v), !started); started = true; },
    end: () => { started = false; },
  };
}

/** Numeric box with stacked up/down steppers, as in CapCut. */
export function valueBox(value: number, min: number, max: number, step: number, fmt: Fmt, onSet: (v: number) => void) {
  const inp = h('input.vb-input', { type: 'text', inputmode: 'decimal', value: fmt.show(value), 'aria-label': 'value' }) as HTMLInputElement;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  let cur = value;
  const set = (v: number) => { cur = clamp(v); inp.value = fmt.show(cur); onSet(cur); };
  inp.addEventListener('change', () => {
    const v = fmt.parse(inp.value);
    if (Number.isNaN(v)) inp.value = fmt.show(cur); else set(v);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); set(cur + step * (e.shiftKey ? 10 : 1)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); set(cur - step * (e.shiftKey ? 10 : 1)); }
    if (e.key === 'Enter') inp.blur();
  });
  const box = h('div.vb', null, inp, fmt.unit ? h('span.vb-unit', null, fmt.unit) : null,
    h('div.vb-steps', null,
      h('button', { type: 'button', tabindex: -1, 'aria-label': 'increase', onclick: () => set(cur + step) }, icon('chevronUp', 10)),
      h('button', { type: 'button', tabindex: -1, 'aria-label': 'decrease', onclick: () => set(cur - step) }, icon('chevron', 10))));
  return { el: box, update: (v: number) => { cur = v; inp.value = fmt.show(v); } };
}

export function slider(label: string, value: number, min: number, max: number, step: number, fmt: Fmt, onInput: (v: number) => void, onEnd: () => void, def?: number, track?: string) {
  const range = h(`input.range${track ? '.tracked' : ''}`, { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
  // A custom track (e.g. Temp blue→yellow) replaces the usual left-side fill.
  if (track) range.style.setProperty('--track', track);
  const paint = () => range.style.setProperty('--p', `${((+range.value - min) / (max - min)) * 100}%`);
  const vb = valueBox(value, min, max, step, fmt, (v) => { range.value = String(v); paint(); onInput(v); onEnd(); });
  paint();
  range.addEventListener('input', () => { onInput(+range.value); vb.update(+range.value); paint(); });
  range.addEventListener('change', onEnd);
  range.addEventListener('dblclick', () => {
    if (def === undefined) return;
    range.value = String(def); paint(); vb.update(def); onInput(def); onEnd();
  });
  return row(label, h('div.slider-ctl', null, range, vb.el));
}

export function row(label: string, control: HTMLElement | (HTMLElement | null)[], cls = '') {
  return h(`div.prop-row${cls}`, null, h('label.prop-label', null, label), h('div.prop-ctl', null, control));
}

export function section(id: string, title: string, onReset: (() => void) | null, ...children: (HTMLElement | null | false)[]) {
  const isCollapsed = collapsed.has(id);
  const body = h('div.sec-body', null, ...children);
  const caret = icon('chevronUp', 14);
  const head = h('div.sec-head', null,
    h('button.sec-toggle', { type: 'button', onclick: () => {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      sec.classList.toggle('collapsed');
    } }, h('span', null, title), caret),
    onReset ? h('button.icon-btn.small', { type: 'button', title: `Reset ${title.toLowerCase()}`, onclick: onReset }, icon('reset', 15)) : null);
  const sec = h(`div.section${isCollapsed ? '.collapsed' : ''}`, null, head, body);
  return sec;
}

export function colorCtl(label: string, value: string, onChange: (v: string) => void) {
  const inp = h('input', { type: 'color', value: value.startsWith('#') ? value.slice(0, 7) : '#000000', 'aria-label': label }) as HTMLInputElement;
  const hex = h('span.color-hex', null, inp.value.toUpperCase());
  inp.addEventListener('input', () => { hex.textContent = inp.value.toUpperCase(); onChange(inp.value); });
  return row(label, h('label.color-ctl', null, h('span.color-swatch', { style: { background: inp.value } }, inp), hex));
}

export function toggle(label: string, on: boolean, onChange: (v: boolean) => void) {
  return row(label, h('label.switch', null, h('input', { type: 'checkbox', checked: on, 'aria-label': label, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }), h('i')));
}

export function selectRow<T extends string | number>(label: string, value: T, options: Option<T>[], onChange: (v: T) => void) {
  return row(label, dropdown(value, options, onChange));
}

