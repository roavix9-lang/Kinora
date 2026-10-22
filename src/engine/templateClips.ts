import { store } from '../store';
import { buildTemplateProject, TEMPLATES, templateDuration } from '../templates';
import { Clip, Project } from '../types';
import { loadSamples, loadTemplateSamples, samplesReady, slotSample } from './sampleMedia';

// A template clip plays a whole template (its own little timeline) inside one clip.
// The nested timeline is rebuilt only when the clip's slot media change, so nested clip
// ids stay stable and video decoders aren't recreated every frame.

const cache = new Map<string, { key: string; project: Project }>();

export const templateDef = (c: Clip) => (c.template ? TEMPLATES.find((t) => t.id === c.template!.id) : undefined);

/** Slot media for a template clip; empty slots show the template's samples. */
export function slotMedia(c: Clip) {
  const t = templateDef(c);
  return (c.template?.media ?? []).map((id, i) => (id ? store.media.get(id) : undefined) ?? (t ? slotSample(t, i) : undefined));
}

export const placeholdersLeft = (c: Clip) => (c.template?.media ?? []).filter((id) => !id || !store.media.get(id)).length;

/** The nested timeline a template clip renders, or null while the sample photos load. */
export function nestedProject(c: Clip): Project | null {
  const t = templateDef(c);
  if (!t) return null;
  if (!samplesReady()) { void loadSamples(); return null; }
  // Bundled photos stand in until the template's own samples arrive (then it rebuilds).
  void loadTemplateSamples(t);
  const media = slotMedia(c);
  const key = media.map((m) => m?.id ?? '-').join('|');
  const hit = cache.get(c.id);
  if (hit && hit.key === key) return hit.project;
  const project = buildTemplateProject(t, media);
  cache.set(c.id, { key, project });
  return project;
}

/** Length of a template clip's content (shorter user videos shorten their slots). */
export function nestedDuration(c: Clip): number {
  const p = nestedProject(c);
  if (!p) return templateDuration(templateDef(c)!);
  let d = 0;
  for (const tr of p.tracks) for (const x of tr.clips) d = Math.max(d, x.start + x.duration);
  return d;
}
