// RosterView.tsx - the team roster, read from the optional agents folder.
//
// One row per agent (avatar, name, role, clamped bio); a row opens the agent
// like a note page: the AGENT.md contract (folded by default), a metadata and
// stats panel (sessions, insights, tasks) and the agent's durable insights
// from its Journal/ folder, superseded ones dimmed. Avatars come from the
// agent's own folder or AI Team Knowledge/Avatars through /api/asset; a
// missing image falls back to initials. Read-only; tokens only.
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import {
  UsersRound, ArrowLeft, ChevronDown, ChevronUp, ArrowUpRight,
  Info, Sparkles,
} from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { S } from '../lib/strings';
import { PageHeader } from '../components/PageHeader';
import { WikiMarkdown } from '../components/WikiMarkdown';
import './team.css';

// ---------------------------------------------------------------------------
// Types - GET /api/team/agents, /api/team/agent/:slug and its /journal.
// ---------------------------------------------------------------------------
interface Agent {
  slug: string;
  name: string;
  role: string | null;
  folder: string;
  status: string | null;
  bio: string;
  avatarPath: string | null;
  routing: string | null;
}
interface AgentsResponse { agents: Agent[] }

interface AgentStats {
  sessions: number;
  lastSession: string | null;
  insights: number;
  tasksOpen: number;
  tasksDone: number;
}
interface AgentDetail extends Agent {
  contractBody: string;
  frontmatter: Record<string, unknown>;
  uri?: string;
  stats?: AgentStats;
}
interface AgentResponse { found: boolean; agent?: AgentDetail }

interface JournalEntry {
  slug: string;
  path: string;
  title: string;
  topic: string | null;
  created: string | null;
  updated: string | null;
  status: 'durable' | 'superseded';
  tags: string[];
  excerpt: string;
  body: string;
  contentLength: number;
}
interface JournalResponse { available: boolean; entries: JournalEntry[] }

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarSrc(path: string | null): string | null {
  return path ? `/api/asset?root=agents&path=${encodeURIComponent(path)}` : null;
}

// FIX 1 - dedupe the lead paragraph. When an agent's AGENTS.md carries no `bio`
// frontmatter, the bio can repeat the contract body's first prose paragraph.
// The member detail would then render it
// twice: once as the header bio, and again as the lead of the WikiMarkdown body.
// We detect that prefix-duplication (whitespace-normalised) and suppress the
// separate header bio, letting the body lead with the paragraph once - mirroring
// WikiMarkdown.dropLeadingH1's "the viewer already shows it, don't double it" rule.
function firstParagraphOf(md: string): string {
  for (const para of md.split(/\n\s*\n/)) {
    const p = para.trim();
    if (p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('-')) return p;
  }
  return '';
}
function normalizeProse(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
// True when the header bio is just a (possibly truncated) copy of the body's lead
// paragraph - so showing it separately would duplicate the contract's opening.
function bioDuplicatesBodyLead(bio: string | null, body: string): boolean {
  if (!bio) return false;
  const b = normalizeProse(bio);
  if (!b) return false;
  const lead = normalizeProse(firstParagraphOf(body));
  if (!lead) return false;
  // The bio may be the body lead capped at 400 chars, so the lead
  // starts with the bio; treat either-direction prefix as a duplicate.
  return lead.startsWith(b) || b.startsWith(lead);
}

// A YYYY-MM-DD (or ISO) string → a readable day label, with a safe fallback.
function dayLabel(date: string | null): string {
  if (!date) return '';
  const head = date.slice(0, 10);
  try {
    return new Date(`${head}T12:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return head;
  }
}

// ---------------------------------------------------------------------------
// Avatar - degrades to initials on a NULL path or an image load error.
// ---------------------------------------------------------------------------
function Avatar({
  name, avatarPath, size = 'card',
}: {
  name: string;
  avatarPath: string | null;
  size?: 'card' | 'row' | 'lead' | 'detail';
}) {
  const src = avatarSrc(avatarPath);
  const [failed, setFailed] = useState(false);
  const display = name;
  const showImg = src && !failed;
  return (
    <span className={`roster-avatar roster-avatar--${size}`} aria-hidden="true">
      {showImg ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="roster-avatar-img"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="roster-avatar-initials">{initialsOf(display)}</span>
      )}
    </span>
  );
}

// ===========================================================================
// THE SESSION-LOG FEED + CARD moved to views/team/SessionLogFeed.tsx (the
// 2026-06 / v3.1.0 split). SessionLogView renders them on their own full-height
// page; this roster page no longer embeds the feed.
// ===========================================================================

// ===========================================================================
// RIGHT COLUMN - the compact roster list (ITEM 3).
// One row per member (avatar + name + role + clamped bio). The whole row is a
// button → opens the rich member detail (the large view). Its own scroll region.
// ===========================================================================
function RosterRow({ agent, onOpen }: { agent: Agent; onOpen: (a: Agent) => void }) {
  const { name, role } = agent;
  return (
    <li className="roster-row-li">
      <button
        type="button"
        className="roster-row"
        onClick={() => onOpen(agent)}
        aria-label={`Open ${name}${role ? `, ${role}` : ''}`}
      >
        <Avatar name={agent.name} avatarPath={agent.avatarPath} size="row" />
        <span className="roster-row-body">
          <span className="roster-row-name">{name}</span>
          {role && <span className="roster-row-role">{role}</span>}
          {agent.bio && <span className="roster-row-bio">{agent.bio}</span>}
        </span>
      </button>
    </li>
  );
}

// ===========================================================================
// MEMBER DETAIL - the large "note page" .
// Contract body (WikiMarkdown) + metadata panel + connections canvas (bottom of
// the reading column) + the agent's journal feed. Each backing read degrades to
// a calm empty state independently.
// ===========================================================================

// Metadata panel - reuses NoteView's .side-panel / .meta-list CSS verbatim.
function AgentMetaPanel({ agent }: { agent: AgentDetail }) {
  const rows: Array<[string, string]> = [];
  if (agent.role) rows.push(['role', agent.role]);
  if (agent.status) rows.push(['status', agent.status]);
  const st = agent.stats;
  if (st) {
    rows.push(['sessions', String(st.sessions)]);
    if (st.lastSession) rows.push(['last session', st.lastSession]);
    rows.push(['insights', String(st.insights)]);
    rows.push(['tasks open', String(st.tasksOpen)]);
    rows.push(['tasks done', String(st.tasksDone)]);
  }
  rows.push(['slug', agent.slug]);
  return (
    <section className="side-panel">
      <h2 className="side-panel-title">
        <Info size={15} strokeWidth={1.5} aria-hidden="true" /> Metadata
      </h2>
      <dl className="meta-list">
        {rows.map(([k, v]) => (
          <div key={k} className="meta-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {agent.folder && <p className="side-filepath font-mono">{agent.folder}</p>}
      {agent.uri && (
        <a className="note-open-obsidian" href={agent.uri}>
          Open in Obsidian <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

// The agent's internal journal/insights feed - newest-first, each entry unfolds
// in place (date + title + snippet → full body via WikiMarkdown). Calm empty
// state when the agent has no journal/ folder (or the table is absent).
function AgentJournalFeed({ slug }: { slug: string }) {
  const { data, loading, error } = useFetch<JournalResponse>(
    `/api/team/agent/${encodeURIComponent(slug)}/journal`,
  );

  if (loading) {
    return <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>;
  }
  if (error) {
    return <p role="alert" className="jt-foot-error">Could not load insights: {error}</p>;
  }
  // available:false (no table) and an empty feed read the same: a calm note.
  if (!data || !data.available || data.entries.length === 0) {
    return <p className="team-journal-empty">No durable insights captured yet.</p>;
  }

  return (
    <ol className="team-journal-list">
      {data.entries.map((entry) => (
        <li key={entry.path} className="team-journal-li" data-status={entry.status}>
          <AgentJournalCard entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function AgentJournalCard({ entry }: { entry: JournalEntry }) {
  const [open, setOpen] = useState(false);
  const bodyId = `team-insight-${entry.slug}`;
  const date = entry.created || entry.updated;
  return (
    <article className="team-insight">
      <div className="team-insight-meta">
        {date && <time className="team-insight-date" dateTime={date.slice(0, 10)}>{dayLabel(date)}</time>}
        {entry.topic && <span className="team-insight-topic">{entry.topic}</span>}
        {entry.status === 'superseded' && <span className="team-insight-topic">superseded</span>}
      </div>
      <h4 className="team-insight-title">{entry.title}</h4>
      {!open && entry.excerpt && <p className="team-insight-excerpt">{entry.excerpt}</p>}
      <div className="collapse-rows" data-open={open} id={bodyId}>
        <div className="collapse-rows-inner">
          <div className="team-insight-full">
            {open && <WikiMarkdown body={entry.body} />}
          </div>
        </div>
      </div>
      {entry.tags.length > 0 && (
        <div className="team-insight-tagrow">
          {entry.tags.map((t) => <span key={t} className="team-insight-tag">{t}</span>)}
        </div>
      )}
      {(entry.body || entry.excerpt) && (
        <button
          type="button"
          className="team-log-unfold"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          {open
            ? <><ChevronUp size={14} strokeWidth={1.5} aria-hidden="true" /> Fold</>
            : <><ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" /> Unfold</>}
        </button>
      )}
    </article>
  );
}

// FIX 2 - the contract body is long; wrap it in the cockpit's established
// collapse pattern (the `.collapse-rows` grid-rows transition + a `.team-log-unfold`
// toggle, exactly as the session-log and insight cards use). Collapsed by default
// with a short capped preview (the lead paragraph) so the page opens calm; expand
// reveals the full AGENTS.md via WikiMarkdown. FIX 3 - the body's [[wikilinks]] get
// the isResolvable oracle so Team-Knowledge SOP/WS/GL targets degrade instead of
// routing to a "No entry found" page.
function AgentContractBody({
  body,
  isResolvable,
}: {
  body: string;
  isResolvable: (slug: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const preview = useMemo(() => {
    const lead = firstParagraphOf(body);
    return lead.length > 320 ? `${lead.slice(0, 320).trimEnd()}...` : lead;
  }, [body]);
  return (
    <section className="roster-contract" aria-label="Contract">
      {!open && preview && <p className="roster-contract-preview">{preview}</p>}
      <div className="collapse-rows" data-open={open} id={bodyId}>
        <div className="collapse-rows-inner">
          <div className="roster-contract-full">
            {open && <WikiMarkdown body={body} isResolvable={isResolvable} />}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="team-log-unfold"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        {open
          ? <><ChevronUp size={14} strokeWidth={1.5} aria-hidden="true" /> Fold contract</>
          : <><ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" /> Read full contract</>}
      </button>
    </section>
  );
}

// The large member-detail view (a note page). Fetches the detail on slug change.
function AgentLargeView({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const { data, loading, error } = useFetch<AgentResponse>(
    `/api/team/agent/${encodeURIComponent(agent.slug)}`,
  );
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }); }, [agent.slug]);

  // The roster row gives name, role and avatar at once; the detail fetch adds
  // the contract body, frontmatter and stats.
  const detail: AgentDetail = {
    ...agent,
    ...(data?.agent ?? {}),
    contractBody: data?.agent?.contractBody ?? '',
    frontmatter: data?.agent?.frontmatter ?? {},
  };
  const { name, role } = detail;

  // Contract wikilinks point at team files (SOPs, other agents), not at notes
  // in the ICOR for Life folder, so they render as plain labels.
  const isResolvable = useCallback((): boolean => false, []);

  // FIX 1 - suppress the header bio when it merely duplicates the contract's lead
  // paragraph (a bio without its own text repeats the body lead as
  // the bio). The body then leads with the paragraph exactly once.
  const showBio = detail.bio && !bioDuplicatesBodyLead(detail.bio, detail.contractBody);

  return (
    <article ref={topRef} className="note-view roster-large animate-fade-rise">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back to team
      </button>

      <header className="note-header">
        <div className="note-header-row">
          <span className="note-type-pill">{role || 'Specialist'}</span>
        </div>
        <div className="roster-large-titlerow">
          <Avatar name={detail.name} avatarPath={detail.avatarPath} size="detail" />
          <h1 className="note-title">{name}</h1>
        </div>
        {showBio && <p className="roster-large-bio">{detail.bio}</p>}
      </header>

      <div className="note-grid">
        <div className="note-body-col">
          {loading && !data ? (
            <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>
          ) : error ? (
            <p role="alert" className="view-error">Could not load this member: {error}</p>
          ) : detail.contractBody ? (
            <AgentContractBody body={detail.contractBody} isResolvable={isResolvable} />
          ) : (
            <p className="note-empty">No contract on file for this member yet.</p>
          )}

          {/* The agent's internal journal / durable-insight feed (§16). */}
          <section className="team-journal" aria-label="Durable insights">
            <h2 className="mg-title">
              <Sparkles size={15} strokeWidth={1.5} aria-hidden="true" /> Durable insights
            </h2>
            <AgentJournalFeed slug={agent.slug} />
          </section>
        </div>

        <aside className="note-side">
          <AgentMetaPanel agent={detail} />
        </aside>
      </div>
    </article>
  );
}

// ===========================================================================
// THE PAGE.
// ===========================================================================
export function RosterView() {
  const { data, loading, error } = useFetch<AgentsResponse>('/api/team/agents');
  const topRef = useRef<HTMLDivElement | null>(null);
  const [large, setLarge] = useState<Agent | null>(null);
  const rosterHeadingId = useId();
  useEffect(() => { if (!large) topRef.current?.scrollIntoView({ block: 'start' }); }, [large]);

  if (loading) return <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>;
  if (error) return <div role="alert" className="view-error">{S.roster.loadError}: {error}</div>;
  if (!data) return null;

  const agents = data.agents;

  // The large note-page view replaces the two-column list (a focused surface).
  if (large) {
    return <AgentLargeView agent={large} onBack={() => setLarge(null)} />;
  }

  // Empty state - a bare scaffold may have no active agents.
  if (agents.length === 0) {
    return (
      <section ref={topRef} className="roster-view animate-fade-rise">
        <PageHeader title={S.roster.title} icon={UsersRound} />
        <div className="library-empty">
          <span className="library-empty-mark" aria-hidden="true">
            <UsersRound size={28} strokeWidth={1.5} />
          </span>
          <p className="library-empty-title">No team members yet</p>
          <p className="library-empty-sub">
            Your specialists appear here once your team is set up.
          </p>
        </div>
      </section>
    );
  }

  const ordered = agents;
  const openMember = (a: Agent) => setLarge(a);

  return (
    <section ref={topRef} className="roster-view team-page-view team-solo-view animate-fade-rise">
      <PageHeader title={S.roster.title} icon={UsersRound} subtitle={S.roster.countSub(agents.length)} />

      {/* A single full-height column: the roster list scrolls inside its own
          contained region (.team-solo-scroll) so the page fills the viewport and
          the window itself never scrolls a short floating card - team.css. */}
      <section className="team-solo-col" aria-labelledby={rosterHeadingId}>
        <h2 id={rosterHeadingId} className="team-col-head">
          <UsersRound size={16} strokeWidth={1.5} aria-hidden="true" /> {S.roster.rosterHeading}
        </h2>
        <div className="team-solo-scroll">
          <ul className="roster-rows">
            {ordered.map((a) => (
              <RosterRow key={a.slug} agent={a} onOpen={openMember} />
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
