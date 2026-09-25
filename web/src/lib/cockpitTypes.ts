// cockpitTypes.ts - types mirroring the /api/* payloads (server/app.js).
// Strict; no `any`. A note's `type` is its icor-concepts/1 concept key and its
// `slug` is the note name (the file name without .md), which is exactly what a
// [[wikilink]] targets.

export type EntityType =
  | 'key_elements' | 'goals' | 'projects' | 'habits' | 'topics'
  | 'people' | 'companies' | 'notes' | 'documents'
  | 'journal' | 'journey_notes' | 'scratchpad' | 'inbox' | 'planner';

export interface NavType {
  type: EntityType;
  label: string;
  count: number;
}

export interface TypeListItem {
  slug: string;
  title: string | null;
  subtitle: string | null;
  date: string | null;
  /** Vault-relative path of the note (unique; the name may collide). */
  path: string;
  /** The frontmatter `type` (note / document / pdf-highlight ...). */
  docType?: string | null;
  unparsed?: boolean;
  /** The per-concept columns named in TypeListResponse.columns. */
  cols?: Record<string, string | number | null>;
}

export interface TypeListResponse {
  type: EntityType;
  label: string;
  items: TypeListItem[];
  total: number;
  /** item-7 - the ordered column aliases present on each row's `cols` map. The
   *  client owns the human header label + width per alias. */
  columns?: string[];
}

// ---------------------------------------------------------------------------
// Global search - the Cmd/Ctrl+K command palette.
// GET /api/search?q=...&limit=30 -> { available, items }.
// A substring match over titles, excerpts and frontmatter in the in-memory
// index (no search database). `available` is always true today.
// ---------------------------------------------------------------------------
export interface GlobalSearchHit {
  type: EntityType | string;
  slug: string;
  path: string;
  entityId: number | null;
  title: string;
  /** A short plain-text fragment around the match. */
  snippet: string;
  /** Human type label (TYPE_LABELS), e.g. "Person", "Journal". */
  label: string;
}

export interface GlobalSearchResponse {
  available: boolean;
  items: GlobalSearchHit[];
}

// An outbound link from a note body. Clickable only when it resolves to one of
// the 10 entity tables; otherwise rendered as a plain, non-clickable label.
export interface OutboundLink {
  raw: string;
  slug: string | null;
  targetType: EntityType | string | null;
  /** The target note's title, or null for an unresolved link. The in-body
   *  renderer prefers an explicit `[[target|label]]`, then this title. */
  title: string | null;
  path?: string | null;
  linkType: 'wikilink' | 'embed';
  clickable: boolean;
}

export interface Backlink {
  sourceType: string;
  slug: string;
  path: string;
  /** The frontmatter field that carries the link, or null for a body link. */
  field: string | null;
  title: string;
  label: string;
  clickable: boolean;
}

export interface JournalMediaImage {
  path: string;
  mediaType: string;
  caption: string | null;
}

export interface NoteJournalMeta {
  entryDate: string | null;
  mood: string | null;
  moodValence?: number | null;
  energy: string | null;
  category: string | null;
  entryType: string | null;
}

// A document's binary (source_file under 05 Assets) previewed inline through
// the jailed /api/file route when the browser can render it (PDF, image, text).
export interface NotePreview {
  path: string;
  kind: 'pdf' | 'image' | 'text' | 'other' | 'external';
  mime: string | null;
  previewable: boolean;
  field: string;
  ext?: string;
}

export interface CockpitNote {
  type: EntityType;
  /** The frontmatter `type` (note, document, journal ...), or null. */
  docType: string | null;
  slug: string;
  title: string;
  typeLabel: string;
  body: string;
  filePath: string | null;
  /** obsidian://open link for this note (all edits happen in Obsidian). */
  uri: string;
  /** Fields the icor-concepts/1 schema declares for this type. */
  metadata: Record<string, unknown>;
  /** Fields outside the schema: shown only in a raw disclosure. */
  rawFrontmatter: Record<string, unknown>;
  unparsed: boolean;
  preview?: NotePreview | null;
  outbound: OutboundLink[];
  backlinks: Backlink[];
  journal?: NoteJournalMeta;
  media?: {
    images: JournalMediaImage[];
    audioCount: number;
    audio?: { path: string; url: string } | null;
  };
}

export interface SecondaryMatch {
  type: EntityType;
  slug: string;
  path: string;
  title: string | null;
  label: string;
}

export interface ResolveResponse {
  found: boolean;
  slug: string;
  note?: CockpitNote;
  secondary?: SecondaryMatch[];
}

// ---------------------------------------------------------------------------
// Knowledge-graph mini-graph (server/graph.js - getNeighborhood).
//   GET /api/graph?concept=&name=&depth=2&cap=12
// Success: { focus, nodes, edges, stats }. Not-found: { found:false, type, slug }.
// `id` = `${type}/${slug}`. Mirrors GL-003 §8.9.
// ---------------------------------------------------------------------------
// A graph node's type. The note graph emits only the 10 entity tables; the agent
// graph (focusType='agents') additionally emits sibling agents + the three
// Team-Knowledge kinds. Navigability is carried by `clickable`, never inferred
// from the type - SOP/WS/GL render as nodes but are not clickable (no route yet).
export type GraphNodeType =
  | EntityType;

export interface GraphFocus {
  id: string;
  type: GraphNodeType;
  slug: string;
  title: string;
  typeLabel: string;
}

export interface GraphNode {
  id: string;                     // `${type}/${slug}`
  type: GraphNodeType;
  typeLabel: string;
  slug: string;
  title: string;
  subtitle: string | null;
  tags: string[];
  gen: 0 | 1 | 2;
  inDegree: number;
  outDegree: number;
  degree: number;
  clickable: boolean;
}

export interface GraphEdge {
  id: string;                     // `${source}->${target}:${linkType}`
  source: string;                 // node id
  target: string;                 // node id
  direction: 'out' | 'back';      // out = focus→neighbor; back = neighbor→focus
  linkType: 'wikilink' | 'embed';
}

export interface GraphStats {
  gen1: number;
  gen2: number;
  capped: Record<string, number>; // gen1 node id -> N hidden grandchildren
  dangling: number;
}

// Success-shape neighborhood response.
export interface GraphNeighborhood {
  focus: GraphFocus;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

// The route returns the success shape OR { found:false } on a miss. The success
// shape has no `found` field, so we discriminate on presence of `focus`.
export type GraphResponse =
  | GraphNeighborhood
  | { found: false; type: string; slug: string };

