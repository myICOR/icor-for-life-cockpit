// PlannerBoardView.tsx - the ICOR for Life Planner as a read-only week board.
//
// Source: GET /api/planner?from=&to= over `02 Planner/` (items, the week note,
// habits, routines). The Planner plugin is the only writer of these notes, so
// nothing here drags, checks or reorders: every card opens its note in
// Obsidian, where the board plugin does the planning.
//
// Layout: the week header (priorities + today's highlight), then one column per
// day split Morning / Afternoon / Anytime, with that day's habits and routines
// on top; the unscheduled tray on the side, weekly goals pinned first. Children
// nest under their parent (same source only). Calendar Events.md renders as
// markdown on demand (D2 F2: not parsed in this version).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarRange, ChevronLeft, ChevronRight, ArrowUpRight, Pin, CheckCircle2, Circle,
  Repeat2, ListChecks, Star, CalendarDays, ExternalLink,
} from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { navigate } from '../lib/router';
import { PageHeader } from '../components/PageHeader';
import { WikiMarkdown } from '../components/WikiMarkdown';
import { markerLabel, type PlannerBoard, type PlannerItem, type PlannerColumn } from '../lib/api';
import './planner.css';

const DAY_MS = 86400000;

function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return new Date(x.getTime() - ((x.getDay() + 6) % 7) * DAY_MS);
}

function dayHeading(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T12:00:00`);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

function isDone(i: PlannerItem): boolean {
  return i.status === 'done' || i.doneLocal;
}

function PlanCard({ item }: { item: PlannerItem }) {
  const done = isDone(item);
  const overdue = !done && item.due != null && item.due < isoLocal(new Date());
  return (
    <li className="pb-card" data-done={done || undefined} data-goal={item.weeklyGoal || undefined}>
      <a className="pb-card-main" href={item.uri} title="Open in Obsidian to plan or edit it">
        <span className="pb-card-check" aria-hidden="true">
          {done ? <CheckCircle2 size={15} strokeWidth={1.5} /> : <Circle size={15} strokeWidth={1.5} />}
        </span>
        <span className="pb-card-title">
          <span className="sr-only">{done ? 'Done: ' : 'Open: '}</span>
          {item.title}
        </span>
        {item.weeklyGoal && <Pin size={13} strokeWidth={1.5} aria-label="Pinned to the week" className="pb-card-pin" />}
      </a>
      <span className="pb-card-meta">
        <span className="pb-chip">{item.source}</span>
        {item.priority < 5 && <span className="pb-chip" data-prio={item.priority}>P{item.priority}</span>}
        {item.due && <span className="pb-chip" data-overdue={overdue || undefined}>due {item.due}</span>}
        {item.linkedNote && (
          <button type="button" className="pb-link" onClick={() => navigate({ name: 'resolve', slug: item.linkedNote as string })}>
            {item.linkedNote}
          </button>
        )}
        {item.url && /^https?:\/\//i.test(item.url) && (
          <a className="pb-link" href={item.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${item.title} in ${item.source}`}>
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
          </a>
        )}
      </span>
      {item.children && item.children.length > 0 && (
        <ul className="pb-children">
          {item.children.map((c) => <PlanCard key={c.path} item={c} />)}
        </ul>
      )}
    </li>
  );
}

function Lane({ label, items }: { label: string; items: PlannerItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pb-lane">
      <p className="pb-lane-label">{label}</p>
      <ul className="pb-cards">{items.map((i) => <PlanCard key={i.path} item={i} />)}</ul>
    </div>
  );
}

function DayColumn({ col, board }: { col: PlannerColumn; board: PlannerBoard }) {
  const h = dayHeading(col.day);
  const habits = board.habitDays[col.day] ?? [];
  const routines = board.routineDays[col.day] ?? [];
  const isToday = col.day === board.today;
  const isPast = col.day < board.today;
  const empty = col.am.length + col.pm.length + col.anytime.length === 0;
  const highlight = board.week.highlights.find((x) => x.date === col.day);
  return (
    <section className="pb-col" data-today={isToday || undefined} data-past={isPast || undefined} aria-label={`${h.weekday} ${h.date}${isToday ? ', today' : ''}`}>
      <header className="pb-col-head">
        <span className="pb-col-weekday">{h.weekday}</span>
        <span className="pb-col-date">{h.date}</span>
      </header>
      {highlight && (
        <p className="pb-highlight" data-state={highlight.marker.state}>
          <Star size={12} strokeWidth={1.5} aria-hidden="true" /> {highlight.text}
        </p>
      )}
      {(habits.length > 0 || routines.length > 0) && (
        <ul className="pb-rituals" aria-label="Habits and routines">
          {routines.map((r) => (
            <li key={r.path}>
              <a className="pb-ritual" href={r.uri} data-state={r.marker.state} title={`${r.name}: ${markerLabel(r.marker)}`}>
                <ListChecks size={12} strokeWidth={1.5} aria-hidden="true" />
                <span>{r.name}</span>
                <span className="pb-ritual-state">{r.marker.state === 'partial' ? markerLabel(r.marker) : r.start ?? ''}</span>
              </a>
            </li>
          ))}
          {habits.map((x) => (
            <li key={x.path}>
              <a className="pb-ritual" href={x.uri} data-state={x.marker.state} title={`${x.name}: ${markerLabel(x.marker)}`}>
                <Repeat2 size={12} strokeWidth={1.5} aria-hidden="true" />
                <span>{x.name}</span>
                <span className="pb-ritual-state">{markerLabel(x.marker)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <Lane label="Morning" items={col.am} />
      <Lane label="Afternoon" items={col.pm} />
      <Lane label="Anytime" items={col.anytime} />
      {empty && <p className="pb-empty">Nothing planned.</p>}
    </section>
  );
}

function CalendarPanel() {
  const { data, loading } = useFetch<{ available: boolean; body: string; updated: string | null }>('/api/planner/calendar');
  if (loading) return <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>;
  if (!data?.available) return <p className="pb-empty">No calendar events yet. Connect a calendar in the Planner plugin.</p>;
  return (
    <div className="pb-calendar">
      {data.updated && <p className="pb-calendar-updated">Last synced {new Date(data.updated).toLocaleString()}</p>}
      <WikiMarkdown body={data.body} />
    </div>
  );
}

export function PlannerBoardView() {
  const [weekStart, setWeekStart] = useState<string>(() => isoLocal(mondayOf(new Date())));
  const [showCalendar, setShowCalendar] = useState(false);
  const to = useMemo(() => isoLocal(new Date(new Date(`${weekStart}T12:00:00`).getTime() + 6 * DAY_MS)), [weekStart]);
  const { data, loading, error } = useFetch<PlannerBoard>(`/api/planner?from=${weekStart}&to=${to}`);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Bring today's column into view on a wide week that scrolls sideways.
  useEffect(() => {
    const today = boardRef.current?.querySelector<HTMLElement>('.pb-col[data-today]');
    today?.scrollIntoView({ block: 'nearest', inline: 'start' });
  }, [data]);

  const shift = (weeks: number) => {
    const d = new Date(`${weekStart}T12:00:00`);
    setWeekStart(isoLocal(new Date(d.getTime() + weeks * 7 * DAY_MS)));
  };
  const thisWeek = isoLocal(mondayOf(new Date()));

  return (
    <section className="pb-view animate-fade-rise">
      <PageHeader
        title="Planner"
        icon={CalendarRange}
        subtitle={data ? `${data.week.week} · ${data.counts.open} open, ${data.counts.done} done. Read-only: plan in Obsidian.` : 'Your week from the ICOR Planner.'}
        action={
          <div className="pb-nav" role="group" aria-label="Week">
            <button type="button" className="page-action-btn" onClick={() => shift(-1)} aria-label="Previous week">
              <ChevronLeft size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className="page-action-btn" onClick={() => setWeekStart(thisWeek)} disabled={weekStart === thisWeek}>
              This week
            </button>
            <button type="button" className="page-action-btn" onClick={() => shift(1)} aria-label="Next week">
              <ChevronRight size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className="page-action-btn" aria-pressed={showCalendar} onClick={() => setShowCalendar((v) => !v)}>
              <CalendarDays size={15} strokeWidth={1.5} aria-hidden="true" /> Calendar
            </button>
          </div>
        }
      />

      {loading && !data && <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>}
      {error && <p role="alert" className="view-error">The Planner could not load: {error}</p>}

      {data && (
        <>
          {showCalendar && <CalendarPanel />}

          {(data.week.priorities.length > 0 || data.week.path) && (
            <section className="pb-week" aria-label="Weekly priorities">
              <h2 className="pb-week-title">Weekly priorities</h2>
              {data.week.priorities.length === 0 ? (
                <p className="pb-empty">No priorities written for this week yet.</p>
              ) : (
                <ul className="pb-priorities">
                  {data.week.priorities.map((p, i) => (
                    <li key={i} data-done={p.done || undefined}>
                      {p.done ? <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden="true" /> : <Circle size={14} strokeWidth={1.5} aria-hidden="true" />}
                      <span className="sr-only">{p.done ? 'Done: ' : 'Open: '}</span>
                      {p.text}
                    </li>
                  ))}
                </ul>
              )}
              {data.week.uri && (
                <a className="note-open-obsidian" href={data.week.uri}>
                  Open the week note <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
                </a>
              )}
            </section>
          )}

          <div className="pb-layout">
            <div className="pb-board" role="list" aria-label="Days" ref={boardRef}>
              {data.columns.map((c) => (
                <div role="listitem" key={c.day} className="pb-board-cell">
                  <DayColumn col={c} board={data} />
                </div>
              ))}
            </div>
            <aside className="pb-tray" aria-label="Unscheduled">
              <h2 className="pb-tray-title">Unscheduled <span className="pb-tray-count">{data.tray.length}</span></h2>
              {data.tray.length === 0 ? (
                <p className="pb-empty">Everything open has a day.</p>
              ) : (
                <ul className="pb-cards">{data.tray.map((i) => <PlanCard key={i.path} item={i} />)}</ul>
              )}
            </aside>
          </div>

          {data.counts.items === 0 && (
            <p className="pb-empty">
              No Planner items yet. Sync Todoist, ClickUp or starred email with the ICOR Planner plugin in Obsidian and
              they appear here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
