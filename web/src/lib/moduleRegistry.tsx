// moduleRegistry.tsx - the Cockpit's drop-in module registry.
//
// A module is one entry: slug, sidebar label, icon, sidebar group and a
// statically imported view. The sidebar row, the hash route (#/<slug>) and the
// content mount all derive from the entry. There is no runtime plugin loader:
// adding a module means adding an entry here and rebuilding.
//
// HOW TO ADD A MODULE
//   1. Add a read-only GET route in server/app.js that reads the index.
//   2. Add a view under web/src/views/ that fetches it with useFetch.
//   3. Append one entry below and run `npm run build`.
// Rolling a module back = deleting its entry and its files.
import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarRange, FolderOpen, Inbox } from 'lucide-react';

const PlannerBoardView = lazy(() => import('../views/PlannerBoardView').then((m) => ({ default: m.PlannerBoardView })));
const InboxView = lazy(() => import('../views/InboxView').then((m) => ({ default: m.InboxView })));
const WipView = lazy(() => import('../views/WipView').then((m) => ({ default: m.WipView })));

export type ModuleNavSection = 'top' | 'overview' | 'knowledge';

export interface CockpitModule {
  /** The hash slug, e.g. 'planner' -> #/planner. Must not collide with a core route. */
  slug: string;
  navLabel: string;
  navIcon: LucideIcon;
  navSection: ModuleNavSection;
  View: ComponentType;
  /** Optional gate; false hides the module completely. */
  enabled?: () => boolean;
  /** Render full width instead of the reading column. */
  fullBleed?: boolean;
}

export const COCKPIT_MODULES: readonly CockpitModule[] = [
  { slug: 'planner', navLabel: 'Planner', navIcon: CalendarRange, navSection: 'overview', View: PlannerBoardView, fullBleed: true },
  { slug: 'inbox', navLabel: 'Inbox', navIcon: Inbox, navSection: 'overview', View: InboxView },
  { slug: 'wip', navLabel: 'Work in progress', navIcon: FolderOpen, navSection: 'overview', View: WipView },
];

export function activeModules(): readonly CockpitModule[] {
  return COCKPIT_MODULES.filter((m) => m.enabled?.() ?? true);
}

export function moduleForSlug(slug: string): CockpitModule | undefined {
  return activeModules().find((m) => m.slug === slug);
}

export function modulesForSection(section: ModuleNavSection): readonly CockpitModule[] {
  return activeModules().filter((m) => m.navSection === section);
}
