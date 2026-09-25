// App.tsx - the ICOR for Life - Cockpit shell: left sidebar + routed content.
// A read-only viewer over your ICOR for Life folder (dashboard, journal, notes
// with backlinks, Planner board, Inbox, WiP) and, when an agents folder is
// connected in Settings, the team (roster, insights, session logs, tasks,
// analytics, SOPs / Workstreams / Guidelines). Hash-routed, local-only.
import { Suspense, useEffect, useState } from 'react';
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

interface NavResponse {
  content: boolean;
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
  return window.matchMedia('(min-width: 768px)').matches;
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
  return [open, () => setOpen((o) => !o), () => setOpen(false)] as const;
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

  const onNavigate = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) closeSidebar();
  };

  const fullBleed = route.name === 'module' && Boolean(moduleForSlug(route.slug)?.fullBleed);
  const teamFull = (TEAM_ROUTE_NAMES as readonly string[]).includes(route.name);

  return (
    <div className={`cockpit-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar
        navTypes={nav?.types ?? []}
        documents={nav?.documents ?? 0}
        agents={nav?.agents ?? false}
        route={route}
        open={sidebarOpen}
        onToggle={toggleSidebar}
        onNavigate={onNavigate}
        onOpenSearch={() => setSearchOpen(true)}
      />

      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}

      <div className="cockpit-main">
        {!sidebarOpen && (
          <div className="cockpit-topbar">
            <button type="button" className="topbar-menu" onClick={toggleSidebar} aria-label="Open navigation">
              <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        )}

        <main className={`cockpit-content ${fullBleed ? 'cockpit-content--full' : ''} ${teamFull ? 'cockpit-content--team' : ''}`}>
          <ErrorBoundary resetKey={window.location.hash}>
            <ContentRouter route={route} agents={nav?.agents ?? null} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
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
