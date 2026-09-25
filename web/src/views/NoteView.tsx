// NoteView.tsx - the universal note viewer.
//
// Renders any note in the ICOR for Life folder: the markdown body with
// clickable [[wikilinks]], the schema fields, a raw disclosure for fields the
// schema does not know, "what links here" from the index, and an Open in
// Obsidian link (the Cockpit is read-only; every edit happens in Obsidian).
//
// Two entry shapes share this view:
//   #/resolve/:slug      -> /api/note?name=        (collision-aware, "also:")
//   #/note/:type/:slug   -> /api/note?concept=&name=
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Link2, CornerUpLeft, Info, Calendar, FileText, Maximize2, FileQuestion } from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { fileRouteSrc, hrefFor, navigate, type Route } from '../lib/router';
import type { ResolveResponse, CockpitNote, Backlink, OutboundLink, NotePreview } from '../lib/cockpitTypes';
import { WikiMarkdown } from '../components/WikiMarkdown';
import { ImageLightbox } from '../components/ImageLightbox';
import { MoodChip, EnergyChip } from '../components/JournalChips';
import { MiniGraph } from '../components/graph/MiniGraph';

export function NoteView({ route }: { route: Extract<Route, { name: 'resolve' | 'note' }> }) {
  const url =
    route.name === 'resolve'
      ? `/api/note?name=${encodeURIComponent(route.slug)}`
      : `/api/note?concept=${encodeURIComponent(route.type)}&name=${encodeURIComponent(route.slug)}`;
  const { data, loading, error } = useFetch<ResolveResponse>(url);
  const topRef = useRef<HTMLDivElement | null>(null);
  // Lightbox-lite for the media strip - the same shared ImageLightbox the
  // journal timeline uses (portalled to document.body, which keeps it outside
  // this article's animate-fade-rise containing block).
  const [lightbox, setLightbox] = useState<{ path: string; alt: string } | null>(null);

  // Scroll the note to the top whenever we navigate to a new one.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' });
  }, [url]);

  // Link target -> resolved title, so in-body [[wikilinks]] show the note's
  // title. Hooks run above the early returns; a missing note yields an empty
  // map and the renderer falls back to the raw target.
  const titleBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of data?.note?.outbound ?? []) {
      if (o.title) {
        m.set(o.raw, o.title);
        if (o.slug) m.set(o.slug, o.title);
      }
    }
    return m;
  }, [data]);
  // Targets with no note render as plain labels, never as a dead link.
  const resolvable = useMemo(() => {
    const set = new Set<string>();
    for (const o of data?.note?.outbound ?? []) if (o.clickable) set.add(o.raw);
    return set;
  }, [data]);
  const isResolvable = useCallback((target: string): boolean => resolvable.has(target), [resolvable]);
  const resolveTitle = useCallback(
    (slug: string): string | null => titleBySlug.get(slug) ?? null,
    [titleBySlug],
  );

  if (loading) return <ViewSkeleton />;
  if (error) return <ViewError message={error} />;
  if (!data || !data.found || !data.note) return <NotFound slug={route.slug} />;

  const note = data.note;
  const secondary = data.secondary ?? [];

  return (
    <article ref={topRef} className="note-view animate-fade-rise">
      <button type="button" className="back-button" onClick={() => window.history.back()}>
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back
      </button>

      <header className="note-header">
        <div className="note-header-row">
          <span className="note-type-pill">{note.typeLabel}</span>
          {note.docType && note.docType !== note.type && <span className="meta-cat">{note.docType}</span>}
          {note.unparsed && <span className="meta-cat" title="The frontmatter could not be read">unreadable frontmatter</span>}
          <a className="note-open-obsidian" href={note.uri} title="Open this note in Obsidian to edit it">
            Open in Obsidian <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
          </a>
        </div>
        <h1 className="note-title">{note.title}</h1>
        {note.journal && <JournalHeaderMeta note={note} />}
        {secondary.length > 0 && (
          <p className="note-also">
            also:{' '}
            {secondary.map((s, i) => (
              <span key={s.path}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="wikilink"
                  onClick={() => navigate({ name: 'note', type: s.type, slug: s.slug })}
                >
                  {s.label}: {s.title ?? s.slug}
                </button>
              </span>
            ))}
          </p>
        )}
      </header>

      <div className="note-grid">
        <div className="note-body-col">
          {note.preview && <DocumentPreview preview={note.preview} title={note.title} />}
          {note.media && note.media.images.length > 0 && (
            <div className="note-media-strip">
              {note.media.images.map((img, i) => (
                <ImageThumb
                  key={i}
                  path={img.path}
                  caption={img.caption}
                  onOpen={(path, alt) => setLightbox({ path, alt })}
                />
              ))}
            </div>
          )}
          {note.body.trim() ? (
            <WikiMarkdown body={note.body} resolveTitle={resolveTitle} isResolvable={isResolvable} />
          ) : (
            <p className="note-empty">This entry has no body text.</p>
          )}
          {note.media && note.media.audioCount > 0 && (
            <p className="note-audio-note">
              {note.media.audioCount} audio recording{note.media.audioCount > 1 ? 's' : ''} linked (not played).
            </p>
          )}
          {/* Mini-graph - product decision (option B): full-content-width, in the MAIN
              reading column directly below the rendered note body (the body's
              "Related" tail). NOT in the right rail. The rail's "What links here" /
              "Links to" cards stay untouched as the non-visual text fallback (§8.9).
              Lazy-loaded so React Flow + d3-force stay out of the critical bundle. */}
          <MiniGraph focusType={note.type} slug={note.slug} />
        </div>

        <aside className="note-side">
          <MetadataPanel metadata={note.metadata} raw={note.rawFrontmatter} filePath={note.filePath} />
          <BacklinksPanel backlinks={note.backlinks} />
          <OutboundPanel outbound={note.outbound} />
        </aside>
      </div>

      {lightbox && (
        <ImageLightbox path={lightbox.path} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </article>
  );
}

// In-app document preview. The binary (PDF/image/txt) is served from disk
// through the jailed /api/file route and embedded inline. PDFs use a
// native <iframe> (no renderer dependency); images use <img>. Non-previewable types
// (docx/xlsx/external links) show a calm "not previewable" note with the path - we
// never force a download or show a broken embed.
function DocumentPreview({ preview, title }: { preview: NotePreview; title: string }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/file?path=${encodeURIComponent(preview.path)}`;
  const fileName = preview.path.split('/').pop() || preview.path;

  if (!preview.previewable || failed) {
    return (
      <section className="doc-preview doc-preview-unavailable">
        <div className="doc-preview-head">
          <FileQuestion size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Document</span>
        </div>
        <p className="doc-preview-note">
          {preview.kind === 'external'
            ? 'External file - no inline preview.'
            : failed
              ? 'File not found on disk.'
              : `No inline preview for ${preview.ext ? `.${preview.ext}` : 'this file type'}.`}
        </p>
        <p className="doc-preview-path font-mono">{preview.path}</p>
      </section>
    );
  }

  return (
    <section className="doc-preview">
      <div className="doc-preview-head">
        <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="doc-preview-name">{fileName}</span>
        {/* Routed "Large" - same in-app reading page (#/file/<src>) the tree
            previews and DocumentsView use, instead of the raw URL in a new tab. */}
        <a
          href={hrefFor({ name: 'file', src: fileRouteSrc('file', preview.path) })}
          className="doc-preview-open"
          title="Open the large reading page"
        >
          <Maximize2 size={14} strokeWidth={1.5} aria-hidden="true" /> Large
        </a>
      </div>
      {preview.kind === 'image' ? (
        <img
          className="doc-preview-image"
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        // PDF + txt: native iframe, zero renderer dependency.
        <iframe
          className="doc-preview-frame"
          src={src}
          title={`Preview: ${title}`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </section>
  );
}

function JournalHeaderMeta({ note }: { note: CockpitNote }) {
  const j = note.journal!;
  return (
    <div className="note-journal-meta">
      {j.entryDate && (
        <span className="meta-pair">
          <Calendar size={13} strokeWidth={1.5} aria-hidden="true" />
          {formatDate(j.entryDate)}
        </span>
      )}
      {j.mood && <MoodChip mood={j.mood} />}
      {j.energy && <EnergyChip energy={j.energy} />}
      {j.category && <span className="meta-cat">{j.category}</span>}
    </div>
  );
}

function ImageThumb({
  path,
  caption,
  onOpen,
}: {
  path: string;
  caption: string | null;
  onOpen: (path: string, alt: string) => void;
}) {
  // Lazy thumbnail via the read-only media route. A real <button> wraps the
  // image (cursor: zoom-in, Enter/Space for free) and opens the shared
  // lightbox. Degrades silently when the bytes are missing on disk. No
  // broken-image icon.
  const [failed, setFailed] = useState(false);
  const name = path.split('/').pop() ?? path;
  if (failed) return null;
  return (
    <div className="media-thumb">
      <button
        type="button"
        className="media-thumb-btn"
        onClick={() => onOpen(path, caption || name)}
        aria-label={`View image ${caption || name}`}
      >
        <img
          src={`/api/asset?path=${encodeURIComponent(path)}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </button>
      {caption && <span className="media-thumb-cap">{caption}</span>}
    </div>
  );
}

function MetadataPanel({
  metadata, raw, filePath,
}: { metadata: Record<string, unknown>; raw: Record<string, unknown>; filePath: string | null }) {
  const entries = Object.entries(metadata).filter(([k]) => k !== 'body' && k !== 'content');
  const rawEntries = Object.entries(raw);
  return (
    <section className="side-panel">
      <h2 className="side-panel-title"><Info size={15} strokeWidth={1.5} aria-hidden="true" /> Metadata</h2>
      {entries.length === 0 ? (
        <p className="side-empty">No frontmatter fields.</p>
      ) : (
        <dl className="meta-list">
          {entries.map(([k, v]) => (
            <div key={k} className="meta-row">
              <dt>{k}</dt>
              <dd>{renderValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {rawEntries.length > 0 && (
        <details className="meta-raw">
          <summary>Other frontmatter ({rawEntries.length})</summary>
          <dl className="meta-list">
            {rawEntries.map(([k, v]) => (
              <div key={k} className="meta-row">
                <dt>{k}</dt>
                <dd>{renderValue(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {filePath && <p className="side-filepath font-mono">{filePath}</p>}
    </section>
  );
}

function renderValue(v: unknown): string {
  if (v == null) return '-';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function BacklinksPanel({ backlinks }: { backlinks: Backlink[] }) {
  return (
    <section className="side-panel">
      <h2 className="side-panel-title"><CornerUpLeft size={15} strokeWidth={1.5} aria-hidden="true" /> What links here</h2>
      {backlinks.length === 0 ? (
        <p className="side-empty">No backlinks yet.</p>
      ) : (
        <ul className="backlink-list">
          {backlinks.map((b) => (
            <li key={b.path}>
              {b.clickable ? (
                <button type="button" className="backlink" onClick={() => navigate({ name: 'note', type: b.sourceType, slug: b.slug })}>
                  <span className="backlink-label">{b.label}</span>
                  <span className="backlink-title">{b.title}</span>
                </button>
              ) : (
                <span className="backlink is-plain" title="Source is not a navigable note">
                  <span className="backlink-label">{b.label}</span>
                  <span className="backlink-title">{b.title}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OutboundPanel({ outbound }: { outbound: OutboundLink[] }) {
  if (outbound.length === 0) return null;
  // Plain (non-clickable) links are shown muted, never as broken links.
  return (
    <section className="side-panel">
      <h2 className="side-panel-title"><Link2 size={15} strokeWidth={1.5} aria-hidden="true" /> Links to</h2>
      <ul className="outbound-list">
        {outbound.map((o, i) => (
          <li key={`${o.raw}-${i}`}>
            {o.clickable && o.slug ? (
              <button type="button" className="wikilink" onClick={() => navigate({ name: 'note', type: String(o.targetType), slug: o.slug! })}>
                {o.raw}
              </button>
            ) : (
              <span className="outbound-plain" title={o.linkType === 'embed' ? 'Embedded file' : 'No note with this name yet'}>{o.raw}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

function ViewSkeleton() {
  return (
    <div className="note-view" aria-busy="true">
      <div className="skeleton-line w-half" />
      <div className="skeleton-block" />
      <div className="skeleton-block" />
    </div>
  );
}

function ViewError({ message }: { message: string }) {
  return <div role="alert" className="view-error">Could not load the entry: {message}</div>;
}

function NotFound({ slug }: { slug: string }) {
  return (
    <div className="note-view">
      <button type="button" className="back-button" onClick={() => window.history.back()}>
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back
      </button>
      <p className="note-empty">
        No entry found for <span className="font-mono">{slug}</span>. This link points to something that does not (yet) exist as a note.
      </p>
    </div>
  );
}
