// HubView.tsx - the dashboard.
//
// One fetch (GET /api/dashboard) composes the day: today's Planner items,
// habits and routines; this week's priorities and highlight; the life overview
// from `.icor-for-life/scripts/snapshot.json` (goals, focus projects, key
// elements, hot topics); bucket counts; the newest journal entries and notes;
// and On This Day. The snapshot is untrusted display text (reader rules in
// server/snapshot.js): it renders as text, a stale one says so, a missing one
// says "not generated", never "no goals". Sections show and reorder from
// Settings (per browser). Read-only; every card opens in the Cockpit or in
// Obsidian.
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight, CalendarCheck, CheckCircle2, Circle, FileText, FolderKanban, Hash, KeyRound,
  NotebookPen, Repeat2, Target, Compass, Star, ListChecks, Settings as SettingsIcon, Inbox,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { navigate, hrefFor } from '../lib/router';
import { useHubPrefs } from '../lib/hubPrefs';
import { markerLabel, type DashboardResponse, type StatusResponse, type SnapshotNamed, type PlannerItem } from '../lib/api';
import { HubSection } from './hub/HubSection';
import { OnThisDayCard } from './hub/OnThisDayCard';
import './hub.css';

const HERO_AREAS: { type: string; label: string; icon: LucideIcon; concept: string }[] = [
  { type: 'projects', label: 'My Projects', icon: FolderKanban, concept: 'project' },
  { type: 'key_elements', label: 'Key Elements', icon: KeyRound, concept: 'key-element' },
  { type: 'topics', label: 'My Topics', icon: Hash, concept: 'topic' },
];
const SUB_AREAS: { type: string; label: string; icon: LucideIcon; concept: string }[] = [
  { type: 'goals', label: 'My Goals', icon: Target, concept: 'goal' },
  { type: 'habits', label: 'My Habits', icon: Repeat2, concept: 'habit' },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Open a snapshot entry by name, never by a raw path from the file. */
function NamedLink({ item, concept }: { item: SnapshotNamed; concept: string }) {
  if (!item.name) return null;
  return (
    <a className="hub-journal-row" href={hrefFor({ name: 'note', type: concept, slug: item.name })}>
      <span className="hub-journal-title">{item.name}</span>
      {item.status && <span className="hub-journal-mood">{item.status}</span>}
    </a>
  );
}

function BucketsModule({ counts }: { counts: Record<string, number> }) {
  return (
    <>
      <div className="hub-areas" role="list">
        {HERO_AREAS.map(({ type, label, icon: Icon, concept }) => (
          <a key={type} role="listitem" className="hub-area" data-concept={concept} href={hrefFor({ name: 'type', type })}>
            <span className="hub-area-glyph"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></span>
            <span className="hub-area-name">{label}</span>
            <span className="hub-area-meta">{plural(counts[type] ?? 0, 'note', 'notes')}</span>
            <ArrowRight className="hub-area-arrow" size={16} strokeWidth={1.5} aria-hidden="true" />
          </a>
        ))}
      </div>
      <div className="hub-areas hub-areas--sub" role="list">
        {SUB_AREAS.map(({ type, label, icon: Icon, concept }) => (
          <a key={type} role="listitem" className="hub-area hub-area--sub" data-concept={concept} href={hrefFor({ name: 'type', type })}>
            <span className="hub-area-glyph"><Icon size={18} strokeWidth={1.5} aria-hidden="true" /></span>
            <span className="hub-area-name">{label}</span>
            <span className="hub-area-meta">{plural(counts[type] ?? 0, 'note', 'notes')}</span>
          </a>
        ))}
      </div>
    </>
  );
}

function TodayItem({ item }: { item: PlannerItem }) {
  const done = item.status === 'done' || item.doneLocal;
  return (
    <li className="hub-today-row">
      <span className="hub-today-check" aria-hidden="true">
        {done ? <CheckCircle2 size={14} strokeWidth={1.5} /> : <Circle size={14} strokeWidth={1.5} />}
      </span>
      <a className="hub-today-text" href={item.uri} data-done={done || undefined} title="Open in Obsidian">
        <span className="sr-only">{done ? 'Done: ' : 'Open: '}</span>{item.title}
      </a>
      <span className="hub-today-source">{item.plannedHalf === 'am' ? 'morning' : item.plannedHalf === 'pm' ? 'afternoon' : item.source}</span>
    </li>
  );
}

function TodayModule({ data }: { data: DashboardResponse }) {
  const p = data.planner;
  const open = p.items.filter((i) => i.status === 'open' && !i.doneLocal).length;
  return (
    <HubSection
      icon={CalendarCheck}
      title="Today"
      hint={p.counts.items === 0 ? 'No Planner items yet' : `${open} open, ${p.items.length - open} done`}
      action={{ label: 'Planner', onClick: () => navigate({ name: 'module', slug: 'planner' }) }}
    >
      {p.items.length === 0 && p.habits.length === 0 && p.routines.length === 0 ? (
        <p className="hub-empty">
          Nothing planned for today. Plan your day on the Planner board in Obsidian; it shows up here.
        </p>
      ) : (
        <div className="hub-today">
          {p.items.length > 0 && (
            <div className="hub-today-col">
              <h3 className="hub-section-title"><ListChecks size={15} strokeWidth={1.5} aria-hidden="true" /> Actions</h3>
              <ul className="hub-today-list">{p.items.map((i) => <TodayItem key={i.path} item={i} />)}</ul>
            </div>
          )}
          {(p.habits.length > 0 || p.routines.length > 0) && (
            <div className="hub-today-col">
              <h3 className="hub-section-title"><Repeat2 size={15} strokeWidth={1.5} aria-hidden="true" /> Habits and routines</h3>
              <ul className="hub-today-list">
                {p.routines.map((r) => (
                  <li key={r.path} className="hub-today-row">
                    <span className="hub-today-time">{r.start ?? ''}</span>
                    <a className="hub-today-text" href={r.uri}>{r.name}</a>
                    <span className="hub-today-source">{markerLabel(r.marker)}</span>
                  </li>
                ))}
                {p.habits.map((h) => (
                  <li key={h.path} className="hub-today-row">
                    <span className="hub-today-time" />
                    <a className="hub-today-text" href={h.uri}>{h.name}</a>
                    <span className="hub-today-source">{markerLabel(h.marker)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </HubSection>
  );
}

function WeekModule({ data }: { data: DashboardResponse }) {
  const w = data.planner.week;
  const highlight = w.highlights.find((h) => h.date === data.today);
  return (
    <HubSection icon={Star} title="This week" hint={w.week}>
      {w.priorities.length === 0 && !highlight ? (
        <p className="hub-empty">No weekly priorities or highlight for {w.week} yet.</p>
      ) : (
        <div className="hub-week">
          {highlight && (
            <p className="hub-week-highlight">
              <span className="hub-week-label">Today&apos;s highlight</span> {highlight.text}
              <span className="hub-journal-mood">{markerLabel(highlight.marker)}</span>
            </p>
          )}
          {w.priorities.length > 0 && (
            <ul className="hub-week-priorities">
              {w.priorities.map((pr, i) => (
                <li key={i} data-done={pr.done || undefined}>
                  {pr.done ? <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden="true" /> : <Circle size={14} strokeWidth={1.5} aria-hidden="true" />}
                  <span className="sr-only">{pr.done ? 'Done: ' : 'Open: '}</span>
                  {pr.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </HubSection>
  );
}

function LifeModule({ data }: { data: DashboardResponse }) {
  const snap = data.snapshot;
  const d = snap.data;
  const hint = snap.status === 'ok'
    ? `From snapshot.json, ${snap.ageHours != null ? `${Math.max(0, Math.round(snap.ageHours))} h old` : 'current'}`
    : snap.status === 'stale'
      ? `Stale snapshot (${snap.reason ?? 'old'}). Ask your AI team to refresh it.`
      : snap.status === 'missing'
        ? 'Snapshot not generated. Counts below come from your notes.'
        : `Snapshot not read: ${snap.reason ?? 'refused'}.`;
  const goals = d?.goals?.open ?? [];
  const focus = (d?.projects?.focus?.length ? d.projects.focus : d?.projects?.active ?? []).slice(0, 6);
  const kes = d?.key_elements ?? [];
  const hot = d?.topics?.hot ?? [];
  return (
    <HubSection icon={Compass} title="My life" hint={hint}>
      {!d ? (
        <p className="hub-empty">
          {plural(data.counts.goals ?? 0, 'goal', 'goals')}, {plural(data.counts.projects ?? 0, 'project', 'projects')},{' '}
          {plural(data.counts.key_elements ?? 0, 'key element', 'key elements')}. The life snapshot is written by your
          ICOR for Life scripts; the Cockpit only reads it.
        </p>
      ) : (
        <div className="hub-life" data-stale={snap.status !== 'ok' || undefined}>
          <div className="hub-life-col">
            <h3 className="hub-section-title"><Target size={15} strokeWidth={1.5} aria-hidden="true" /> Open goals</h3>
            {goals.length === 0 ? <p className="hub-empty">None open.</p> : (
              <ul className="hub-journal">{goals.slice(0, 6).map((g, i) => <li key={i}><NamedLink item={g} concept="goals" /></li>)}</ul>
            )}
          </div>
          <div className="hub-life-col">
            <h3 className="hub-section-title"><FolderKanban size={15} strokeWidth={1.5} aria-hidden="true" /> {d.projects?.focus?.length ? 'Focus projects' : 'Active projects'}</h3>
            {focus.length === 0 ? <p className="hub-empty">None active.</p> : (
              <ul className="hub-journal">{focus.map((p, i) => <li key={i}><NamedLink item={p} concept="projects" /></li>)}</ul>
            )}
          </div>
          <div className="hub-life-col">
            <h3 className="hub-section-title"><KeyRound size={15} strokeWidth={1.5} aria-hidden="true" /> Key elements</h3>
            {kes.length === 0 ? <p className="hub-empty">None yet.</p> : (
              <ul className="hub-journal">{kes.slice(0, 8).map((k, i) => <li key={i}><NamedLink item={k} concept="key_elements" /></li>)}</ul>
            )}
          </div>
          <div className="hub-life-col">
            <h3 className="hub-section-title"><Hash size={15} strokeWidth={1.5} aria-hidden="true" /> Hot topics</h3>
            {hot.length === 0 ? <p className="hub-empty">No recent attention.</p> : (
              <ul className="hub-journal">{hot.slice(0, 5).map((t, i) => <li key={i}><NamedLink item={t} concept="topics" /></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </HubSection>
  );
}

function LatestJournalModule({ data }: { data: DashboardResponse }) {
  return (
    <HubSection icon={NotebookPen} title="Latest journal" action={{ label: 'Journal', onClick: () => navigate({ name: 'journal' }) }}>
      {data.recentJournal.length === 0 ? (
        <p className="hub-empty">No journal entries yet.</p>
      ) : (
        <ul className="hub-journal">
          {data.recentJournal.slice(0, 5).map((j) => (
            <li key={j.path}>
              <a href={hrefFor({ name: 'note', type: 'journal', slug: j.slug ?? j.title })} className="hub-journal-row">
                <span className="hub-journal-date">{j.date ?? ''}</span>
                <span className="hub-journal-title">{j.title}</span>
                {j.subtitle && <span className="hub-journal-mood">{j.subtitle}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </HubSection>
  );
}

function LatestNotesModule({ data }: { data: DashboardResponse }) {
  return (
    <HubSection icon={FileText} title="Latest notes" hint="Changed most recently" action={{ label: 'All notes', onClick: () => navigate({ name: 'type', type: 'notes' }) }}>
      {data.recentNotes.length === 0 ? (
        <p className="hub-empty">No notes yet.</p>
      ) : (
        <div className="hub-docs" role="list">
          {data.recentNotes.map((n) => (
            <button key={n.path} type="button" role="listitem" className="hub-doc" onClick={() => navigate({ name: 'note', type: 'notes', slug: n.name ?? n.title })}>
              <span className="hub-doc-glyph" aria-hidden="true"><FileText size={15} strokeWidth={1.5} /></span>
              <span className="hub-doc-title">{n.title}</span>
              <span className="hub-doc-meta">
                {n.type && <em className="hub-doc-chip">{n.type}</em>}
                {n.date && <span className="hub-doc-date">{n.date}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </HubSection>
  );
}

function SetupCard({ reason }: { reason: string }) {
  return (
    <div className="hub">
      <header className="hub-head">
        <h1 className="hub-title">Welcome to your Cockpit</h1>
      </header>
      <HubSection icon={SettingsIcon} title="Connect your ICOR for Life folder">
        <p className="hub-empty">{reason}</p>
        <p>
          <a className="hub-today-link" href={hrefFor({ name: 'settings' })}>Open Settings and add the folder</a>
        </p>
      </HubSection>
    </div>
  );
}

export function HubView() {
  const { data: status } = useFetch<StatusResponse>('/api/status');
  const ready = status?.content.ok === true;
  const { data, loading, error } = useFetch<DashboardResponse>(ready ? '/api/dashboard' : null);
  const { prefs, isOn } = useHubPrefs();

  if (status && !status.content.ok) return <SetupCard reason={status.content.reason} />;
  if (!status || (loading && !data)) {
    return <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>;
  }
  if (error || !data) return <p className="view-error">The dashboard could not load. {error || ''}</p>;

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const renderers: Record<string, () => ReactNode> = {
    today: () => <TodayModule data={data} />,
    week: () => <WeekModule data={data} />,
    life: () => <LifeModule data={data} />,
    buckets: () => <BucketsModule counts={data.counts} />,
    latestJournal: () => <LatestJournalModule data={data} />,
    latestNotes: () => <LatestNotesModule data={data} />,
    onThisDay: () => <OnThisDayCard />,
  };

  return (
    <div className="hub">
      <header className="hub-head">
        <p className="hub-date">{today}</p>
        <h1 className="hub-title">My Life</h1>
        {data.inbox.captures > 0 && (
          <p className="hub-section-hint">
            <a className="hub-today-link" href={hrefFor({ name: 'module', slug: 'inbox' })}>
              <Inbox size={13} strokeWidth={1.5} aria-hidden="true" /> {plural(data.inbox.captures, 'capture', 'captures')} waiting in your Inbox
            </a>
          </p>
        )}
      </header>
      {prefs.order.map((key) => (isOn(key) && renderers[key] ? <Fragment key={key}>{renderers[key]()}</Fragment> : null))}
    </div>
  );
}
