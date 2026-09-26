// App.tsx - the ICOR for Life - Cockpit shell: left sidebar + routed content.
// A read-only viewer over your ICOR for Life folder (dashboard, journal, notes
// with backlinks, Planner board, Inbox, WiP) and, when an agents folder is
// connected in Settings, the team (roster, insights, session logs, tasks,
// analytics, SOPs / Workstreams / Guidelines). Hash-routed, local-only.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Menu, UsersRound } from 'lucide-react';
import { useFetch } from './lib/useCockpit';
import { useRoute, hrefFor, TEAM_ROUTE_NAMES } from './lib/router';
import { useTheme } from './lib/theme';
import type { NavType } from './lib/cockpitTypes';
import { Sidebar } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { PageHeader } from './components/PageHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HubView } from './views/HubView';
import { JournalView } from './views/JournalView';
import { RosterView } from './views/RosterView';
import { SessionLogView } from './views/SessionLogView';
import { TeamAnalyticsView } from './views/TeamAnalyticsView';
import { TeamKnowledgeListView } from './views/TeamKnowledgeListView';
import { TeamInsightsView } from './views/TeamInsightsView';
import { TeamTasksView } from './views/TeamTasksView';
import { SettingsView } from './views/SettingsView';
import { TypeListView } from './views/TypeListView';
import { NoteView } from './views/NoteView';
import { DocumentsView } from './views/DocumentsView';
import { FileView } from './views/FileView';
import { moduleForSlug } from './lib/moduleRegistry';
import { isDesktop, useIsDrawer } from './lib/breakpoint';

interface NavResponse {
  content: boolean;
  unverified: boolean;
  agents: boolean;
  types: NavType[];
  documents: number;
}

function readSidebarPref(): boolean {
  try {
    const stored = window.localStorage.getItem('cockpit-sidebar');
    if (stored != null) return stored === '1';
  } catch {
    /* storage blocked: fall back to the viewport */
  }
  return isDesktop();
}

function useSidebarOpen() {
  const [open, setOpen] = useState(readSidebarPref);
  useEffect(() => {
    try {
      window.localStorage.setItem('cockpit-sidebar', open ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  }, [open]);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return [open, toggle, close] as const;
}

export default function App() {
  const route = useRoute();
  useTheme();
  // Re-read the nav when Settings changes the folders.
  const [navTick, setNavTick] = useState(0);
  useEffect(() => {
    const onChange = () => setNavTick((n) => n + 1);
    window.addEventListener('cockpit:roots-changed', onChange);
    return () => window.removeEventListener('cockpit:roots-changed', onChange);
  }, []);
  const { data: nav } = useFetch<NavResponse>(`/api/nav?t=${navTick}`);
  const [sidebarOpen, toggleSidebar, closeSidebar] = useSidebarOpen();

  // The Cmd/Ctrl+K command palette, mounted at the shell.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const drawer = useIsDrawer();

  // After the drawer closes by Escape or the scrim, focus goes back to the
  // menu button that opened it (D6 M4). The button mounts on close, so the
  // hand-off waits for that render.
  const returnFocus = useRef(false);
  useEffect(() => {
    const onReturn = () => { returnFocus.current = true; };
    window.addEventListener('cockpit:return-focus', onReturn);
    return () => window.removeEventListener('cockpit:return-focus', onReturn);
  }, []);
  useEffect(() => {
    if (sidebarOpen || !returnFocus.current) return;
    returnFocus.current = false;
    document.getElementById('cockpit-menu-button')?.focus();
  }, [sidebarOpen]);

  // A route change starts the new view at the top, names it in the title, and
  // moves focus to its heading (D6 M3; WCAG 2.4.2, 2.4.3).
  const routeKey = hrefFor(route);
  const firstRoute = useRef(true);
  useEffect(() => {
    document.title = `${titleFor(route, nav?.types ?? [])} · Cockpit`;
  }, [routeKey, nav, route]);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    window.scrollTo(0, 0);
    const id = window.setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>('main h1');
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [routeKey]);
  const onNavigate = () => {
    if (!isDesktop()) closeSidebar();
  };

  const fullBleed = route.name === 'module' && Boolean(moduleForSlug(route.slug)?.fullBleed);
  const teamFull = (TEAM_ROUTE_NAMES as readonly string[]).includes(route.name);

  return (
    <div className={`cockpit-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <a className="skip-link" href="#main-content" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>Skip to content</a>
      <Sidebar
        navTypes={nav?.types ?? []}
        documents={nav?.documents ?? 0}
        agents={nav?.agents ?? false}
        route={route}
        open={sidebarOpen}
        drawer={drawer}
        unverified={nav?.unverified ?? false}
        onToggle={toggleSidebar}
        onNavigate={onNavigate}
        onOpenSearch={() => setSearchOpen(true)}
      />

      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}

      <div className="cockpit-main">
        {!sidebarOpen && (
          <div className="cockpit-topbar">
            <button type="button" id="cockpit-menu-button" className="topbar-menu" onClick={toggleSidebar} aria-label="Open navigation">
              <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className={`cockpit-content ${fullBleed ? 'cockpit-content--full' : ''} ${teamFull ? 'cockpit-content--team' : ''}`}>
          <ErrorBoundary resetKey={window.location.hash}>
            <ContentRouter route={route} agents={nav?.agents ?? null} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

const TEAM_TITLES: Record<string, string> = {
  roster: 'My AI Team', insights: 'Insights', 'session-log': 'Session Log', 'team-tasks': 'Team tasks',
  'team-analytics': 'Team analytics', workstreams: 'Workstreams', sops: 'SOPs', guidelines: 'Guidelines',
};

function titleFor(route: ReturnType<typeof useRoute>, types: NavType[]): string {
  switch (route.name) {
    case 'hub': return 'My Life';
    case 'journal': return 'Journal';
    case 'settings': return 'Settings';
    case 'module': return moduleForSlug(route.slug)?.navLabel ?? 'Cockpit';
    case 'type':
      if (route.type === 'documents') return 'Documents';
      return types.find((t) => t.type === route.type)?.label ?? route.type;
    case 'note':
    case 'resolve': return route.slug;
    case 'file': return route.src.split('/').pop() ?? 'File';
    default: return TEAM_TITLES[route.name] ?? 'Cockpit';
  }
}

function NoAgents() {
  return (
    <section className="animate-fade-rise">
      <PageHeader title="My AI Team" icon={UsersRound} subtitle="No agents folder is connected." />
      <p className="hub-empty">
        Connect the folder that holds your AI team (AGENTS.md and 06 AI Team) in{' '}
        <a className="hub-today-link" href={hrefFor({ name: 'settings' })}>Settings</a>. It can be your ICOR for Life
        folder itself or a separate one.
      </p>
    </section>
  );
}

function ContentRouter({ route, agents }: { route: ReturnType<typeof useRoute>; agents: boolean | null }) {
  const isTeam = (TEAM_ROUTE_NAMES as readonly string[]).includes(route.name);
  if (isTeam && agents === false) return <NoAgents />;
  switch (route.name) {
    case 'hub': return <HubView />;
    case 'journal': return <JournalView />;
    case 'roster': return <RosterView />;
    case 'insights': return <TeamInsightsView />;
    case 'session-log': return <SessionLogView />;
    case 'team-tasks': return <TeamTasksView />;
    case 'team-analytics': return <TeamAnalyticsView />;
    case 'workstreams': return <TeamKnowledgeListView family="workstreams" />;
    case 'sops': return <TeamKnowledgeListView family="sops" />;
    case 'guidelines': return <TeamKnowledgeListView family="guidelines" />;
    case 'settings': return <SettingsView />;
    case 'module': {
      const mod = moduleForSlug(route.slug);
      if (!mod) return <HubView />;
      const { View } = mod;
      return (
        <Suspense fallback={<LazyFallback />}>
          <View />
        </Suspense>
      );
    }
    case 'type':
      if (route.type === 'documents') return <DocumentsView />;
      return <TypeListView route={route} />;
    case 'note':
    case 'resolve': return <NoteView route={route} />;
    case 'file': return <FileView route={route} />;
    default: return <HubView />;
  }
}

function LazyFallback() {
  return (
    <div className="list-skeleton" aria-busy="true">
      <div className="skeleton-block" />
    </div>
  );
}
