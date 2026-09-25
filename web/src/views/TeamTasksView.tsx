// TeamTasksView.tsx - the AI team's task queue, read from
// `AI Team Knowledge/Tasks/{open,in-progress,done,cancelled}`. The state comes
// from the folder; when a task's own `status` field disagrees, the card says
// so. Read-only: every card opens its note in Obsidian.
import { useMemo, useState } from 'react';
import { ClipboardList, ArrowUpRight } from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { PageHeader } from '../components/PageHeader';
import './team.css';
import './planner.css';

type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';
interface Task {
  path: string;
  uri: string;
  slug: string;
  title: string;
  state: TaskState;
  status: string | null;
  disagrees: boolean;
  assignee: string | null;
  due: string | null;
  created: string | null;
  month: string | null;
}
interface TasksResponse { tasks: Task[] }

const STATES: { key: TaskState; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function TeamTasksView() {
  const { data, loading, error } = useFetch<TasksResponse>('/api/team/tasks');
  const [assignee, setAssignee] = useState('');
  const assignees = useMemo(
    () => [...new Set((data?.tasks ?? []).map((t) => t.assignee ?? 'unassigned'))].sort(),
    [data],
  );
  const tasks = (data?.tasks ?? []).filter((t) => !assignee || (t.assignee ?? 'unassigned') === assignee);

  return (
    <section className="roster-view team-page-view animate-fade-rise">
      <PageHeader
        title="Team tasks"
        icon={ClipboardList}
        subtitle={data ? `${tasks.length} tasks` : 'The AI team task queue'}
      />
      <div className="type-list-toolbar insights-toolbar">
        <label className="insights-filter">
          <span className="sr-only">Assignee</span>
          <select className="settings-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>
            {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      {loading && <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>}
      {error && <p role="alert" className="view-error">Could not load tasks: {error}</p>}

      <div className="tasks-board">
        {STATES.map(({ key, label }) => {
          const col = tasks
            .filter((t) => t.state === key)
            .sort((a, b) => String(b.month ?? b.created ?? '').localeCompare(String(a.month ?? a.created ?? '')));
          return (
            <section key={key} className="tasks-col" aria-label={label}>
              <h2 className="pb-week-title">{label} <span className="pb-tray-count">{col.length}</span></h2>
              {col.length === 0 ? <p className="pb-empty">None.</p> : (
                <ul className="pb-cards">
                  {col.slice(0, key === 'done' || key === 'cancelled' ? 60 : 500).map((t) => (
                    <li key={t.path} className="pb-card">
                      <a className="pb-card-main" href={t.uri} title="Open in Obsidian">
                        <span className="pb-card-title">{t.title}</span>
                        <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
                      </a>
                      <span className="pb-card-meta">
                        {t.assignee && <span className="pb-chip">{t.assignee}</span>}
                        {t.due && <span className="pb-chip">due {t.due}</span>}
                        {t.month && <span className="pb-chip">{t.month}</span>}
                        {t.disagrees && <span className="pb-chip" data-overdue>status says {t.status}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
