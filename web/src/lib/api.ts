// api.ts - wire types for the status, dashboard and Planner routes
// (server/app.js, server/planner.js, server/snapshot.js). Strict; no `any`.

export interface StatusResponse {
  version: string;
  schema: { id: string; version: string };
  content:
    | { ok: true; root: string; vault: string; unverified: boolean; version: string | null }
    | { ok: false; reason: string };
  agents: { ok: true; root: string } | { ok: false; set: boolean; reason: string };
  mode: 'A' | 'B' | null;
  counts: Record<string, number> | null;
  agentCount: number;
  scannedAt: string | null;
  scanMs: number;
  error: string | null;
}

// ---- Planner ---------------------------------------------------------------
export type Marker =
  | { state: 'done' | 'missed' | 'skipped' | 'pending' }
  | { state: 'partial'; done: number; total: number };

export interface PlannerItem {
  path: string;
  uri: string;
  folder: string;
  source: string;
  externalId: string | null;
  title: string;
  status: 'open' | 'done';
  doneLocal: boolean;
  priority: number;
  due: string | null;
  url: string | null;
  tags: string[];
  plannedDay: string | null;
  plannedHalf: 'am' | 'pm' | null;
  plannedOrder: number | null;
  weeklyGoal: boolean;
  linkedNote: string | null;
  parentId: string | null;
  recurring: boolean | null;
  syncedAt: string | null;
  doneAt: string | null;
  children?: PlannerItem[];
}

export interface PlannerColumn {
  day: string;
  am: PlannerItem[];
  pm: PlannerItem[];
  anytime: PlannerItem[];
}

export interface PlannerWeek {
  week: string;
  path: string | null;
  uri?: string;
  priorities: { text: string; done: boolean }[];
  highlights: { date: string; text: string; marker: Marker }[];
}

export interface HabitDay {
  name: string;
  path: string;
  uri: string;
  marker: Marker;
}

export interface RoutineDay {
  name: string;
  path: string;
  uri: string;
  routineType: string | null;
  start: string | null;
  end: string | null;
  steps: number;
  marker: Marker;
}

export interface PlannerBoard {
  from: string;
  to: string;
  today: string;
  vault: string;
  week: PlannerWeek;
  columns: PlannerColumn[];
  tray: PlannerItem[];
  habitDays: Record<string, HabitDay[]>;
  routineDays: Record<string, RoutineDay[]>;
  calendar: { path: string; updated: string } | null;
  counts: { items: number; open: number; done: number };
}

// ---- Dashboard -------------------------------------------------------------
// snapshot.json (schema 1) is untrusted display text: every field is optional
// here and rendered as text only.
export interface SnapshotNamed {
  name?: string;
  path?: string | null;
  status?: string | null;
  target_date?: string | null;
  days_to_target?: number | null;
  focus_rank?: number | null;
  key_element?: string | null;
  open_goals?: number;
  active_projects?: number;
  attention?: { score?: number; n7?: number };
  goal?: { name?: string; status?: string } | null;
}

export interface SnapshotData {
  schema: number;
  generated_at?: string;
  week?: { iso?: string; start?: string; end?: string };
  goals?: { open?: SnapshotNamed[] };
  projects?: { focus?: SnapshotNamed[]; active?: SnapshotNamed[] };
  weekly_goals?: { items?: { text?: string; done?: boolean }[] };
  highlight?: { date?: string; text?: string | null; done?: boolean | null };
  key_elements?: SnapshotNamed[];
  topics?: { hot?: SnapshotNamed[] };
}

export interface DashboardRow {
  path: string;
  slug?: string;
  name?: string;
  title: string;
  docType?: string | null;
  type?: string | null;
  date: string | null;
  subtitle?: string | null;
}

export interface DashboardResponse {
  today: string;
  vault: string;
  snapshot: {
    status: 'ok' | 'stale' | 'missing' | 'refused';
    reason: string | null;
    ageHours: number | null;
    data: SnapshotData | null;
    path: string;
  };
  counts: Record<string, number>;
  planner: {
    items: PlannerItem[];
    habits: HabitDay[];
    routines: RoutineDay[];
    week: PlannerWeek;
    calendar: { path: string; updated: string } | null;
    counts: { items: number; open: number; done: number };
  };
  recentJournal: DashboardRow[];
  recentNotes: DashboardRow[];
  inbox: { captures: number };
}

export function markerLabel(m: Marker): string {
  switch (m.state) {
    case 'done': return 'done';
    case 'missed': return 'not done';
    case 'skipped': return 'skipped';
    case 'partial': return `${m.done}/${m.total}`;
    default: return 'pending';
  }
}
