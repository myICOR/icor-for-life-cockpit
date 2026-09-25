// JournalView.tsx - the journal as a Stoic-app-style vertical timeline.
//
// A single reading column hangs off a left spine (token hairline). Months are
// sticky dividers; each entry is a calm card with a mood-tinted date node on
// the spine, mood/energy chips, a ~400-char excerpt that UNFOLDS in place to
// the full entry (WikiMarkdown), embedded image thumbnails (lightbox-lite),
// and an open-full link into the universal note viewer.
//
// Data: GET /api/journal?before=<YYYY-MM-DD>&limit=20 over the in-memory index. Infinite scroll BACKWARDS: an IntersectionObserver
// sentinel at the bottom loads the next page (before = oldest loaded date);
// the end-state is a quiet "the beginning of your journal".
//
// Motion is CSS-only and inherits the global prefers-reduced-motion collapse
// (index.css); the unfold reuses the measurement-free .collapse-rows utility.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, NotebookPen, ArrowUpRight } from 'lucide-react';
import { navigate } from '../lib/router';
import type { CockpitNote } from '../lib/cockpitTypes';
import { MoodChip, EnergyChip } from '../components/JournalChips';
import { WikiMarkdown } from '../components/WikiMarkdown';
import { ImageLightbox } from '../components/ImageLightbox';
import { PageHeader } from '../components/PageHeader';
import './journal.css';

// ---------------------------------------------------------------------------
// Feed payload types (server/journalFeed.js).
// ---------------------------------------------------------------------------
interface FeedEntry {
  slug: string;
  path: string;
  concept: 'journal' | 'journey_notes' | 'scratchpad';
  title: string;
  date: string;
  mood: string | null;
  moodValence: number | null;
  energy: string | null;
  category: string | null;
  excerpt: string;
  contentLength: number;
  images: string[];
}

interface FeedResponse {
  entries: FeedEntry[];
  hasMore: boolean;
  nextBefore: string | null;
}

interface NoteResponse {
  found: boolean;
  note?: CockpitNote;
}

const PAGE_SIZE = 20;

type Kind = 'journal' | 'journey_notes' | 'scratchpad';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'journal', label: 'Journal' },
  { key: 'journey_notes', label: 'ICOR Journey Notes' },
  { key: 'scratchpad', label: 'Daily Scratchpad' },
];

// ---------------------------------------------------------------------------
// Small date helpers.
// ---------------------------------------------------------------------------
function monthKey(date: string): string {
  return date.slice(0, 7); // "2026-06-01" -> "2026-06"
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function dayLabel(date: string): string {
  try {
    return new Date(`${date}T12:00:00`)
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return date;
  }
}

// GL-003 §8.11.1 mood→tint ladder (the --stoic-mood-* tokens): the timeline's
// spine node carries the valence as a quiet border tint. No valence -> hairline.
function valenceClass(v: number | null): string {
  if (v == null) return 'jt-node--neutral';
  if (v >= 5) return 'jt-node--positive';
  if (v >= 4) return 'jt-node--positive-soft';
  if (v <= 1) return 'jt-node--hard';
  if (v <= 2) return 'jt-node--tense';
  return 'jt-node--neutral';
}

// Same-origin GET; a failed read surfaces inline, never tears the app down.
async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`Server responded ${r.status}`);
  return r.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------
export function JournalView() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [lightbox, setLightbox] = useState<{ path: string; alt: string } | null>(null);
  // Which kinds the timeline carries: journal entries always, plus the ICOR
  // Journey Notes and the Daily Scratchpad when switched on.
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(() => new Set<Kind>(['journal']));
  const kindsKey = [...kinds].sort().join(',');

  // Per-month collapse, keyed on "YYYY-MM". Session-only - no persistence.
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(new Set());

  const toggleMonth = useCallback((key: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Live copies for the observer callback (avoids re-wiring it per page).
  const stateRef = useRef({ loading: false, hasMore: true, nextBefore: null as string | null });
  stateRef.current = { loading, hasMore, nextBefore };

  const loadPage = useCallback(async (before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), kinds: kindsKey });
      if (before) qs.set('before', before);
      const page = await fetchJson<FeedResponse>(`/api/journal?${qs.toString()}`);
      setEntries((prev) => {
        // Dedupe on slug across the page seam (defensive; the date cursor
        // shouldn't repeat, but an edit between pages could shift rows).
        const base = before ? prev : [];
        const seen = new Set(base.map((e) => e.path));
        return [...base, ...page.entries.filter((e) => !seen.has(e.path))];
      });
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setInitialised(true);
    }
  }, [kindsKey]);

  // First page on mount, and again whenever the kinds change.
  useEffect(() => { void loadPage(null); }, [loadPage]);

  const toggleKind = useCallback((k: Kind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (next.size === 0) next.add('journal');
      return next;
    });
  }, []);

  // Backwards infinite scroll: the bottom sentinel pulls the next page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        const s = stateRef.current;
        if (obs.some((o) => o.isIntersecting) && !s.loading && s.hasMore && s.nextBefore) {
          void loadPage(s.nextBefore);
        }
      },
      { rootMargin: '480px 0px' }, // start fetching well before the edge
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadPage, initialised]);

  const merged = entries;

  // Consecutive month grouping (entries arrive newest-first, so months are
  // contiguous). Grouped sections - not a flat list - so each sticky month
  // header has its whole month as its sticky scope.
  const groups = useMemo(() => {
    const out: { key: string; entries: FeedEntry[] }[] = [];
    for (const e of merged) {
      const mk = monthKey(e.date);
      const last = out[out.length - 1];
      if (last && last.key === mk) last.entries.push(e);
      else out.push({ key: mk, entries: [e] });
    }
    return out;
  }, [merged]);

  if (!initialised && loading) {
    return <div className="list-skeleton" aria-busy="true"><div className="skeleton-block" /></div>;
  }
  if (!initialised && error) {
    return <div role="alert" className="view-error">Could not load the journal: {error}</div>;
  }

  return (
    <section className="jt-view animate-fade-rise">
      <PageHeader
        title="Journal"
        icon={NotebookPen}
        subtitle={`${merged.length} ${merged.length === 1 ? 'entry' : 'entries'} loaded, newest first`}
      />

      <div className="jt-kinds" role="group" aria-label="Show in the timeline">
        {KINDS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`sort-pill${kinds.has(key) ? ' is-active' : ''}`}
            aria-pressed={kinds.has(key)}
            onClick={() => toggleKind(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {merged.length === 0 ? (
        <p className="jt-empty">No journal entries yet. Your timeline begins with the first one.</p>
      ) : (
        <div className="jt-timeline">
          {groups.map((group) => {
            const expanded = !collapsedMonths.has(group.key);
            const listId = `jt-month-entries-${group.key}`;
            return (
              <section key={group.key} className="jt-month-group">
                {/* The sticky month bar is a real button: it collapses/expands the
                    month. Sticky behaviour is unchanged while expanded; collapsed
                    months reduce to just this bar. */}
                <h2 className="jt-month">
                  <button
                    type="button"
                    className="jt-month-btn"
                    onClick={() => toggleMonth(group.key)}
                    aria-expanded={expanded}
                    aria-controls={listId}
                  >
                    <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" className="jt-month-chevron" />
                    <span className="jt-month-text">{monthLabel(group.key)}</span>
                    <span className="jt-month-count">{group.entries.length}</span>
                  </button>
                </h2>
                <div className="collapse-rows" data-open={expanded} id={listId}>
                  <div className="collapse-rows-inner">
                    <ol className="jt-list">
                      {group.entries.map((entry) => (
                        <li key={entry.path} className="jt-item">
                          <TimelineEntry entry={entry} onImage={(path, alt) => setLightbox({ path, alt })} />
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Footer zone: loader / retry / the calm beginning-of-journal end-state. */}
      <div className="jt-foot">
        {initialised && loading && (
          <div className="list-skeleton jt-foot-loading" aria-busy="true"><div className="skeleton-block" /></div>
        )}
        {initialised && error && !loading && (
          <p role="alert" className="jt-foot-error">
            Could not load older entries: {error}{' '}
            <button type="button" className="jt-retry" onClick={() => void loadPage(nextBefore)}>
              Retry
            </button>
          </p>
        )}
        {!hasMore && merged.length > 0 && (
          <p className="jt-origin">the beginning of your journal</p>
        )}
        <div ref={sentinelRef} className="jt-sentinel" aria-hidden="true" />
      </div>

      {lightbox && (
        <ImageLightbox path={lightbox.path} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One timeline entry card. The unfold lazily fetches the full note body once
// (via the /api/note route) and renders it through
// WikiMarkdown, so in-body [[wikilinks]] and ![[images]] behave exactly as in
// the note viewer. Collapse keeps the fetched body cached for re-unfolds.
// ---------------------------------------------------------------------------
function TimelineEntry({
  entry,
  onImage,
}: {
  entry: FeedEntry;
  onImage: (path: string, alt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const bodyId = `jt-full-${entry.slug}`;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && body === null && !bodyLoading) {
      setBodyLoading(true);
      setBodyError(null);
      fetchJson<NoteResponse>(`/api/note?path=${encodeURIComponent(entry.path)}`)
        .then((res) => {
          setBody(res.found && res.note ? res.note.body : '');
        })
        .catch((err: unknown) => setBodyError((err as Error).message))
        .finally(() => setBodyLoading(false));
    }
  };

  return (
    <article className="jt-entry">
      <span className={`jt-node ${valenceClass(entry.moodValence)}`} aria-hidden="true" />
      <div className="jt-card">
        <div className="jt-meta">
          <time className="jt-date" dateTime={entry.date}>{dayLabel(entry.date)}</time>
          <span className="jt-chips">
            {entry.mood && <MoodChip mood={entry.mood} />}
            {entry.energy && <EnergyChip energy={entry.energy} />}
            {entry.category && <span className="jt-cat">{entry.category}</span>}
          </span>
        </div>

        <h3 className="jt-title">
          {entry.title}
        </h3>

        {/* Collapsed: the excerpt. Unfolded: the full entry (WikiMarkdown). */}
        {!open && entry.excerpt && <p className="jt-excerpt">{entry.excerpt}</p>}
        <div className="collapse-rows" data-open={open} id={bodyId}>
          <div className="collapse-rows-inner">
            <div className="jt-full">
              {bodyLoading && <p className="jt-body-loading">Unfolding…</p>}
              {bodyError && (
                <p role="alert" className="jt-foot-error">Could not load the entry: {bodyError}</p>
              )}
              {body !== null && !bodyLoading && <WikiMarkdown body={body} />}

            </div>
          </div>
        </div>

        {entry.images.length > 0 && (
          <div className="jt-thumbs" role="group" aria-label={`${entry.images.length} attached image${entry.images.length > 1 ? 's' : ''}`}>
            {entry.images.map((path) => (
              <ThumbButton key={path} path={path} title={entry.title} onOpen={onImage} />
            ))}
          </div>
        )}

        <div className="jt-actions">
          <button
            type="button"
            className="jt-unfold"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
          >
            {open
              ? <><ChevronUp size={14} strokeWidth={1.5} aria-hidden="true" /> Fold</>
              : <><ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" /> Unfold</>}
          </button>
          <button
            type="button"
            className="jt-open-full"
            onClick={() => navigate({ name: 'note', type: entry.concept, slug: entry.slug })}
          >
            Open entry <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

// A thumbnail that degrades silently when the bytes are missing on disk (the
// index knows the path; the file may not be there). No broken-image icon.
function ThumbButton({
  path,
  title,
  onOpen,
}: {
  path: string;
  title: string;
  onOpen: (path: string, alt: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const name = path.split('/').pop() ?? path;
  if (failed) return null;
  return (
    <button
      type="button"
      className="jt-thumb"
      onClick={() => onOpen(path, `${title} - ${name}`)}
      aria-label={`View image ${name}`}
    >
      <img
        src={`/api/asset?path=${encodeURIComponent(path)}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </button>
  );
}
