import { ASPECTS } from '../store';
import { TemplateDef, TemplateSlot, TemplateSticker, TemplateText } from '../templates';
import { clipEnd, Project } from '../types';

// Turns a timeline into a template: the edit (clip lengths, transitions, effects, titles,
// stickers, filter / effect layers), not the footage. Main-track videos and photos become
// replaceable slots, exactly like the built-in templates.

/** The preset ratio closest to the project's shape ("9:16", "16:9", …). */
function nearestRatio(p: Project): string {
  if (p.ratio && ASPECTS[p.ratio]) return p.ratio;
  const r = p.width / p.height;
  let best = '16:9', d = Infinity;
  for (const [k, [a, b]] of Object.entries(ASPECTS)) {
    const dd = Math.abs(Math.log(a / b / r));
    if (dd < d) { d = dd; best = k; }
  }
  return best;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function projectToTemplate(p: Project, name: string, category: string): TemplateDef | null {
  const main = p.tracks.find((t) => t.main);
  const visuals = (main?.clips ?? []).filter((c) => c.type === 'video' || c.type === 'image').sort((a, b) => a.start - b.start);
  if (!visuals.length) return null;
  const slots: TemplateSlot[] = visuals.map((c) => ({
    dur: round(c.duration),
    ...(c.effect && c.effect.id !== 'none' ? { effect: c.effect.id, effectAmt: round(c.effect.intensity) } : {}),
    ...(c.transitionIn.type !== 'none' ? { anim: c.transitionIn.type } : {}),
    ...(c.transitionOut.type !== 'none' ? { animOut: c.transitionOut.type } : {}),
    ...(c.combo && c.combo.type !== 'none' ? { combo: c.combo.type } : {}),
    ...(c.crossIn?.type ? { transition: c.crossIn.type } : {}),
  }));
  const first = visuals[0].start;
  const at = (t: number) => round(Math.max(0, t - first));
  const all = p.tracks.flatMap((t) => (t.hidden ? [] : t.clips));
  const texts: TemplateText[] = all.filter((c) => c.type === 'text' && c.text).map((c) => ({
    start: at(c.start), dur: round(c.duration), content: c.text!.content,
    style: { ...c.text!, content: undefined } as TemplateText['style'],
    y: round(c.transform.y),
    ...(c.transitionIn.type !== 'none' ? { anim: c.transitionIn.type } : {}),
    ...(c.transitionOut.type !== 'none' ? { animOut: c.transitionOut.type } : {}),
  }));
  const stickers: TemplateSticker[] = all.filter((c) => c.type === 'sticker' && c.sticker).map((c) => ({
    start: at(c.start), dur: round(c.duration), id: c.sticker!.id, color: c.sticker!.color,
    x: round(c.transform.x), y: round(c.transform.y), scale: round(c.transform.scale),
  }));
  const filter = all.find((c) => c.type === 'filter' && c.filter.id !== 'none');
  const fxs = all.filter((c) => c.type === 'effect' && c.effect.id !== 'none');
  const end = Math.max(...visuals.map(clipEnd)) - first;
  return {
    id: '', name, category, ratio: nearestRatio(p), slots,
    ...(filter ? { filter: filter.filter.id, filterAmt: round(filter.filter.intensity) } : {}),
    ...(fxs.length ? { effectLayers: fxs.map((fx) => ({ id: fx.effect.id, amount: round(fx.effect.intensity), start: at(fx.start), dur: round(Math.min(fx.duration, end)) })) } : {}),
    ...(texts.length ? { texts } : {}),
    ...(stickers.length ? { stickers } : {}),
  };
}
