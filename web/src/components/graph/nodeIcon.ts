// nodeIcon.ts - entity type -> Lucide glyph, per GL-003 §8.9.3 / §5.5.
//
// The node's TYPE is a SHAPE concern (icon), NEVER a colour concern. There is no
// per-type hue anywhere in the graph (GL-003 §8.6 / §8.8.7 / §9.5 ban, fully in
// force on this surface). The glyph is the only type differentiator; colour is
// reserved for the single Gen-0 brass moment (§8.9.2).
//
// One glyph per icor-concepts/1 concept.
import {
  FileText,
  Calendar,
  Flag,
  Repeat,
  User,
  Building2,
  Tag,
  Package,
  KeyRound,
  NotebookPen,
  Inbox,
  PenLine,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import type { GraphNodeType } from '../../lib/cockpitTypes';

// One canonical glyph per concept. Monochrome; type is a SHAPE concern
// (glyph) only, never a colour concern.
const TYPE_ICON: Record<GraphNodeType, LucideIcon> = {
  key_elements: KeyRound,
  goals: Flag,
  projects: Package,
  habits: Repeat,
  topics: Tag,
  people: User,
  companies: Building2,
  notes: FileText,
  documents: FileText,
  journal: Calendar,
  journey_notes: NotebookPen,
  scratchpad: PenLine,
  inbox: Inbox,
  planner: ListChecks,
};

export function iconForType(type: string): LucideIcon {
  return TYPE_ICON[type as GraphNodeType] ?? FileText;
}
