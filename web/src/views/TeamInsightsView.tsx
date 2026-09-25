// TeamInsightsView.tsx - every agent's durable insights in one feed.
//
// Source: GET /api/team/insights over `06 AI Team/Agents/<Name>/Journal/`
// (journal-entry notes; `_template.md` skipped). Newest first; superseded
// entries are dimmed and can be hidden; filter by agent. Each card shows
// "What I learned" and "When this applies" when the entry carries them.
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { PageHeader } from '../components/PageHeader';
import './team.css';

interface Insight {
  agent: string;
  agentName: string;
  path: string;
  slug: string;
  title: string;
  topic: string | null;
  created: string | null;
  status: 'durable' | 'superseded';
  learned: string | null;
  applies: string | null;
  excerpt: string;
}
interface InsightsResponse { total: number; entries: Insight[] }

export function TeamInsightsView() {
  const { data, loading, error } = useFetch<InsightsResponse>('/api/team/insights?limit=500');
  const [agent, setAgent] = useState('');
  const [showSuperseded, setShowSuperseded] = useState(false);

  const agents = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data?.entries ?? []) m.set(e.agent, e.agentName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const rows = (data?.entries ?? []).filter((e) => (!agent || e.agent === agent) && (showSuperseded || e.status === 'durable'));

  return (
    <section className="roster-view team-page-view animate-fade-rise">
      <PageHeader
        title="Insights"
        icon={Sparkles}
        subtitle={data ? `${rows.length} of ${data.total} insights, newest first` : 'What your agents learned'}
      />
      <div className="type-list-toolbar insights-toolbar">
        <label className="insights-filter">
          <span className="sr-only">Agent</span>
          <select className="settings-input" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agents.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={`sort-pill${showSuperseded ? ' is-active' : ''}`}
          aria-pressed={showSuperseded}
          onClick={() => setShowSuperseded((v) => !v)}
        >
          Show superseded
        </button>
      </div>

      {loading && <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>}
      {error && <p role="alert" className="view-error">Could not load insights: {error}</p>}
      {data && rows.length === 0 && <p className="team-journal-empty">No insights here yet.</p>}

      <ol className="team-journal-list">
        {rows.map((e) => (
          <li key={e.path} className="team-journal-li" data-status={e.status}>
            <article className="team-insight">
              <div className="team-insight-meta">
                {e.created && <time className="team-insight-date" dateTime={e.created.slice(0, 10)}>{e.created.slice(0, 10)}</time>}
                <span className="team-insight-topic">{e.agentName}</span>
                {e.topic && <span className="team-insight-topic">{e.topic}</span>}
                {e.status === 'superseded' && <span className="team-insight-topic">superseded</span>}
              </div>
              <h3 className="team-insight-title">{e.title}</h3>
              {e.learned ? (
                <>
                  <p className="team-insight-excerpt"><strong>What I learned.</strong> {e.learned}</p>
                  {e.applies && <p className="team-insight-excerpt"><strong>When this applies.</strong> {e.applies}</p>}
                </>
              ) : (
                e.excerpt && <p className="team-insight-excerpt">{e.excerpt}</p>
              )}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
