// Pages: Home (projects), Templates, and the editor for one project.
//   #/home   #/templates   #/library   #/edit/<projectId>
// Moving between the editor and the other pages reloads, so each editor session starts clean.

export type Route = { page: 'home' } | { page: 'templates' } | { page: 'library' } | { page: 'edit'; id: string };

export function parseRoute(hash = location.hash): Route {
  const m = /^#\/edit\/([\w-]+)/.exec(hash);
  if (m) return { page: 'edit', id: m[1] };
  if (hash.startsWith('#/templates')) return { page: 'templates' };
  if (hash.startsWith('#/library')) return { page: 'library' };
  return { page: 'home' };
}

export const routeHash = (r: Route) => (r.page === 'edit' ? `#/edit/${r.id}` : `#/${r.page}`);

/** Goes to a page; crossing into or out of the editor reloads. */
export function go(r: Route) {
  const from = parseRoute();
  location.hash = routeHash(r);
  if (from.page === 'edit' || r.page === 'edit') location.reload();
}
