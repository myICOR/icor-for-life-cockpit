// router.ts - a tiny hash router (zero deps). The Cockpit is a local
// single-server SPA; hash routing keeps deep links and the back button working.
//
// Routes:
//   #/  (or #/hub)              -> the dashboard
//   #/journal                   -> the journal timeline
//   #/type/:type                -> browse one concept (projects, people, notes ...)
//   #/note/:type/:slug          -> open a note by concept + note name
//   #/resolve/:slug             -> resolve a [[wikilink]] by name (collision-aware)
//   #/file/:src                 -> a raw file from a content room (FileView)
//   #/<module-slug>             -> planner, inbox, wip (see moduleRegistry)
//   #/roster, #/insights, #/session-log, #/team-analytics, #/team-tasks,
//   #/workstreams, #/sops, #/guidelines   -> the optional agents folder
//   #/settings                  -> the two folders and the theme
//
// File-route src: the vault-relative path of the file ("03 WiP/Projects/x.md"),
// served by the jailed route /api/file?path=; a `team:` prefix marks a file in
// the agents folder, served by /api/team/file?path=. In the hash it rides as
// ONE encoded segment; parseHash also accepts hand-typed raw slashes.
import { useEffect, useState } from 'react';
import { moduleForSlug } from './moduleRegistry';

export type TeamRouteName =
  | 'roster' | 'insights' | 'session-log' | 'team-analytics' | 'team-tasks'
  | 'workstreams' | 'sops' | 'guidelines';

export const TEAM_ROUTE_NAMES: readonly TeamRouteName[] = [
  'roster', 'insights', 'session-log', 'team-analytics', 'team-tasks', 'workstreams', 'sops', 'guidelines',
];

export type Route =
  | { name: 'hub' }
  | { name: 'journal' }
  | { name: TeamRouteName }
  | { name: 'settings' }
  | { name: 'module'; slug: string }
  | { name: 'type'; type: string }
  | { name: 'note'; type: string; slug: string }
  | { name: 'resolve'; slug: string }
  | { name: 'file'; src: string };

// Which jailed route serves the bytes: the content folder or the agents folder.
export type FileSource = 'file' | 'team';

/** Build the `src` for a { name: 'file' } route. */
export function fileRouteSrc(source: FileSource, path: string): string {
  return source === 'team' ? `team:${path}` : path;
}

/** Decode a file-route `src` into the display path and the jailed serving URL. */
export function parseFileSrc(src: string): { path: string; fileUrl: string } {
  if (src.startsWith('team:')) {
    const path = src.slice('team:'.length);
    return { path, fileUrl: `/api/team/file?path=${encodeURIComponent(path)}` };
  }
  return { path: src, fileUrl: `/api/file?path=${encodeURIComponent(src)}` };
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const head = parts[0];
  if (!head || head === 'hub') return { name: 'hub' };
  if (head === 'journal') return { name: 'journal' };
  if (head === 'settings') return { name: 'settings' };
  if ((TEAM_ROUTE_NAMES as readonly string[]).includes(head)) return { name: head as TeamRouteName };
  if (head === 'file' && parts.length > 1) return { name: 'file', src: parts.slice(1).join('/') };
  if (moduleForSlug(head)) return { name: 'module', slug: head };
  if (head === 'type' && parts[1]) return { name: 'type', type: parts[1] };
  if (head === 'note' && parts[1] && parts[2]) return { name: 'note', type: parts[1], slug: parts.slice(2).join('/') };
  if (head === 'resolve' && parts[1]) return { name: 'resolve', slug: parts.slice(1).join('/') };
  return { name: 'hub' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'hub': return '#/hub';
    case 'journal': return '#/journal';
    case 'settings': return '#/settings';
    case 'module': return `#/${encodeURIComponent(route.slug)}`;
    case 'type': return `#/type/${encodeURIComponent(route.type)}`;
    case 'note': return `#/note/${encodeURIComponent(route.type)}/${encodeURIComponent(route.slug)}`;
    case 'resolve': return `#/resolve/${encodeURIComponent(route.slug)}`;
    case 'file': return `#/file/${encodeURIComponent(route.src)}`;
    default: return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  const href = hrefFor(route);
  if (window.location.hash !== href) window.location.hash = href;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
