// Sidebar.tsx - the cockpit's left navigation.
//
// Mirrors the shadcn/ui Sidebar anatomy: SidebarMenu > SidebarMenuItem >
// SidebarMenuButton (data-active) + SidebarMenuBadge for the per-type counts,
// the Cmd/Ctrl+B toggle, and the mobile off-canvas that collapses into an
// overlay. Built with the design tokens + ZERO new deps (structure and a11y
// contract reproduced, not the package).
import { useEffect, useId, useRef, useState } from 'react';
import {
  NotebookPen, Users, Hash, FolderKanban,
  KeyRound, Repeat2, Target, Building2, FileText, PanelLeftClose,
  UsersRound, LayoutDashboard, SlidersHorizontal, Search,
  ScrollText, ListChecks, BookText, ChevronRight, BarChart3, Sparkles, ClipboardList,
  Inbox, PenLine, Files,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavType, EntityType } from '../lib/cockpitTypes';
import { type Route, hrefFor, TEAM_ROUTE_NAMES } from '../lib/router';
import { InklineMark } from './InklineMark';
import { modulesForSection, type ModuleNavSection } from '../lib/moduleRegistry';
import { S } from '../lib/strings';

const TYPE_ICON: Record<EntityType, LucideIcon> = {
  key_elements: KeyRound,
  goals: Target,
  projects: FolderKanban,
  habits: Repeat2,
  topics: Hash,
  people: Users,
  companies: Building2,
  notes: FileText,
  documents: Files,
  journal: NotebookPen,
  journey_notes: NotebookPen,
  scratchpad: PenLine,
  inbox: Inbox,
  planner: ListChecks,
};

interface SidebarProps {
  navTypes: NavType[];
  /** Document notes (type: document); a Documents row shows when > 0. */
  documents: number;
  /** An agents folder is connected: show the team group. */
  agents: boolean;
  /** The shell is the off-canvas drawer (below 1024px). */
  drawer: boolean;
  /** The content folder has no ICOR for Life 2 manifest (D2 section 2). */
  unverified: boolean;
  route: Route;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void; // close the mobile drawer after a click
  onOpenSearch: () => void; // open the ⌘K command palette
}

// Mac shows ⌘K; everyone else shows Ctrl+K. navigator.platform is deprecated but
// still the most reliable client-side OS hint for this cosmetic shortcut badge.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The "My AI Team" fly-out destinations. The trigger row stays lit while any of
// them is the active route.
function isTeamRoute(route: Route): boolean {
  return (TEAM_ROUTE_NAMES as readonly string[]).includes(route.name);
}

function isActive(route: Route, target: Route): boolean {
  if (route.name !== target.name) return false;
  if (target.name === 'type' && route.name === 'type') return route.type === target.type;
  // Drop-in modules disambiguate by slug (one nav row per module).
  if (target.name === 'module' && route.name === 'module') return route.slug === target.slug;
  return true;
}

function NavRow({
  icon: Icon, label, count, href, active, onClick,
}: {
  icon: LucideIcon; label: string; count?: number; href: string; active: boolean; onClick: () => void;
}) {
  return (
    <li className="menu-item">
      <a href={href} onClick={onClick} data-active={active} className="menu-button" aria-current={active ? 'page' : undefined}>
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="menu-icon" />
        <span className="menu-label">{label}</span>
        {count != null && <span className="menu-badge" aria-label={`${count} entries`}>{count}</span>}
      </a>
    </li>
  );
}

// Renders the nav rows for every active drop-in module attached to a sidebar
// section. A module without its pack (gated off / not installed) contributes
// nothing - the section simply doesn't show its row.
function ModuleRows({
  section, route, onNavigate,
}: {
  section: ModuleNavSection; route: Route; onNavigate: () => void;
}) {
  return (
    <>
      {modulesForSection(section).map((m) => (
        <NavRow
          key={m.slug}
          icon={m.navIcon}
          label={m.navLabel}
          href={hrefFor({ name: 'module', slug: m.slug })}
          active={isActive(route, { name: 'module', slug: m.slug })}
          onClick={onNavigate}
        />
      ))}
    </>
  );
}

// The fly-out destinations under "My AI Team", in display order. Each is a
// core Route the App's ContentRouter renders as its own full page.
const TEAM_FLYOUT_ITEMS: ReadonlyArray<{ route: Route; label: string; icon: LucideIcon }> = [
  { route: { name: 'roster' }, label: S.team.flyout.roster, icon: UsersRound },
  { route: { name: 'insights' }, label: 'Insights', icon: Sparkles },
  { route: { name: 'session-log' }, label: S.team.flyout.sessionLog, icon: ScrollText },
  { route: { name: 'team-tasks' }, label: 'Tasks', icon: ClipboardList },
  { route: { name: 'team-analytics' }, label: 'Analytics', icon: BarChart3 },
  { route: { name: 'workstreams' }, label: S.team.flyout.workstreams, icon: Repeat2 },
  { route: { name: 'sops' }, label: S.team.flyout.sops, icon: ListChecks },
  { route: { name: 'guidelines' }, label: S.team.flyout.guidelines, icon: BookText },
];

// "My AI Team" - a fly-out trigger. Clicking the row opens a submenu (a fly-out
// panel) anchored to the row, offering the five team destinations. Accessibility
// follows the standard menu-button pattern: aria-haspopup +
// aria-expanded on the trigger, a role="menu" panel of role="menuitem" links,
// Escape closes + returns focus, outside-click + route-change close, Up/Down/
// Home/End arrow navigation within the menu, and first-item autofocus on open.
function TeamFlyout({ route, onNavigate }: { route: Route; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLLIElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const menuId = useId();
  const active = isTeamRoute(route);

  // Close on outside click/tap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close when the route changes (a selection navigated away).
  useEffect(() => { setOpen(false); }, [route]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const closeAndReturnFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = TEAM_FLYOUT_ITEMS.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        itemRefs.current[index === last ? 0 : index + 1]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        itemRefs.current[index === 0 ? last : index - 1]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        itemRefs.current[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        itemRefs.current[last]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        closeAndReturnFocus();
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeAndReturnFocus();
    }
  };

  return (
    <li className="menu-item team-flyout-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="menu-button team-flyout-trigger"
        data-active={active}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <UsersRound size={18} strokeWidth={1.5} aria-hidden="true" className="menu-icon" />
        <span className="menu-label">{S.team.menuLabel}</span>
        <ChevronRight
          size={15}
          strokeWidth={1.5}
          aria-hidden="true"
          className={`team-flyout-caret ${open ? 'is-open' : ''}`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          className="team-flyout-menu"
          role="menu"
          aria-label={S.team.menuAria}
        >
          {TEAM_FLYOUT_ITEMS.map((item, i) => (
            <a
              key={item.route.name}
              ref={(el) => { itemRefs.current[i] = el; }}
              href={hrefFor(item.route)}
              role="menuitem"
              tabIndex={-1}
              className="team-flyout-item"
              data-active={isActive(route, item.route)}
              aria-current={isActive(route, item.route) ? 'page' : undefined}
              onClick={() => { setOpen(false); onNavigate(); }}
              onKeyDown={(e) => onItemKeyDown(e, i)}
            >
              <item.icon size={16} strokeWidth={1.5} aria-hidden="true" className="team-flyout-item-icon" />
              <span className="team-flyout-item-label">{item.label}</span>
            </a>
          ))}
        </div>
      )}
    </li>
  );
}

export function Sidebar({ navTypes, documents, agents, drawer, unverified, route, open, onToggle, onNavigate, onOpenSearch }: SidebarProps) {
  // The pinned-top block sits ABOVE the Overview group as an ungrouped block;
  // it disappears while no module is attached to the 'top' section.
  const topModules = modulesForSection('top');
  const navRef = useRef<HTMLElement | null>(null);

  // A closed rail (off-canvas drawer, or the collapsed desktop rail) is out of
  // the tab order and the accessibility tree (D6 H2). React 18 has no `inert`
  // prop, so it is set on the element.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    if (open) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [open]);

  // The open drawer takes focus, keeps Tab inside, and Escape closes it and
  // hands focus back to the menu button (D6 M4).
  useEffect(() => {
    if (!drawer || !open) return;
    const el = navRef.current;
    if (!el) return;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    (el.querySelector<HTMLElement>('.menu-button') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onToggle();
        window.dispatchEvent(new CustomEvent('cockpit:return-focus'));
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, open, onToggle]);

  const closeFromScrim = () => {
    onToggle();
    window.dispatchEvent(new CustomEvent('cockpit:return-focus'));
  };

  return (
    <>
      {/* Mobile scrim (only visible when the drawer is open on small screens). */}
      <div
        className={`sidebar-scrim ${open ? 'is-open' : ''}`}
        onClick={closeFromScrim}
        aria-hidden="true"
      />
      <nav
        ref={navRef}
        className={`cockpit-sidebar ${open ? 'is-open' : ''}`}
        aria-label="Cockpit navigation"
      >
        <div className="sidebar-header">
          <span className="sidebar-brand-mark" aria-hidden="true">
            <InklineMark size={26} />
          </span>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">Cockpit</span>
            <span className="sidebar-brand-sub">ICOR for Life</span>
          </div>
          {/* Collapse affordance lives IN the sidebar header (moved out of the top
              content bar). Collapses the rail on desktop; closes the drawer on mobile. */}
          <button
            type="button"
            className="sidebar-collapse"
            onClick={onToggle}
            aria-label="Collapse navigation"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Global search trigger - opens the Cmd+K command palette (titles,
            excerpts and frontmatter). Looks like a search field but is a button: the
            real input lives in the modal (focus trap + keyboard nav). */}
        <div className="sidebar-search">
          <button
            type="button"
            className="sidebar-search-trigger"
            onClick={() => { onOpenSearch(); onNavigate(); }}
            aria-label="Search your knowledge base"
            aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
          >
            <Search size={16} strokeWidth={1.5} aria-hidden="true" className="sidebar-search-icon" />
            <span className="sidebar-search-placeholder">Search…</span>
            <kbd className="sidebar-search-kbd" aria-hidden="true">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        </div>

        <div className="sidebar-content">
          {/* Pinned-top block, ABOVE the dashboard. Ungrouped
              (no section header) so they read as a primary top-of-rail block;
              absent entirely when no module is attached to the 'top' section. */}
          {topModules.length > 0 && (
            <div className="sidebar-group">
              <ul className="menu">
                <ModuleRows section="top" route={route} onNavigate={onNavigate} />
              </ul>
            </div>
          )}

          <div className="sidebar-group">
            <span className="sidebar-group-label">Overview</span>
            <ul className="menu">
              <NavRow
                icon={LayoutDashboard} label="Hub" href={hrefFor({ name: 'hub' })}
                active={isActive(route, { name: 'hub' })} onClick={onNavigate}
              />
              <NavRow
                icon={NotebookPen} label="Journal" href={hrefFor({ name: 'journal' })}
                active={isActive(route, { name: 'journal' })} onClick={onNavigate}
              />
              {/* Drop-in extension modules attached to the Overview group. */}
              <ModuleRows section="overview" route={route} onNavigate={onNavigate} />
            </ul>
          </div>

          <div className="sidebar-group">
            <span className="sidebar-group-label">Knowledge</span>
            <ul className="menu">
              {navTypes
                .map((t) => (
                  <NavRow
                    key={t.type}
                    icon={TYPE_ICON[t.type]}
                    label={t.label}
                    count={t.count}
                    href={hrefFor({ name: 'type', type: t.type })}
                    active={isActive(route, { name: 'type', type: t.type })}
                    onClick={onNavigate}
                  />
                ))}
              {documents > 0 && (
                <NavRow
                  icon={Files}
                  label="Documents"
                  count={documents}
                  href={hrefFor({ name: 'type', type: 'documents' })}
                  active={isActive(route, { name: 'type', type: 'documents' })}
                  onClick={onNavigate}
                />
              )}
              <ModuleRows section="knowledge" route={route} onNavigate={onNavigate} />
            </ul>
          </div>
        </div>

        {/* Pinned to the BOTTOM of the rail, just above the footer. It lives
            OUTSIDE .sidebar-content (which is flex:1 + scrolls), so it stays put
            regardless of how long the Overview/Knowledge lists grow. */}
        <div className="sidebar-bottom">
          <ul className="menu">
            {/* "My AI Team": a fly-out trigger, shown only when an agents folder
                is connected in Settings. */}
            {agents && <TeamFlyout route={route} onNavigate={onNavigate} />}
            <NavRow
              icon={SlidersHorizontal} label="Settings" href={hrefFor({ name: 'settings' })}
              active={isActive(route, { name: 'settings' })} onClick={onNavigate}
            />
          </ul>
        </div>

        <div className="sidebar-footer">
          {unverified && (
            <a className="hub-kicker" href={hrefFor({ name: 'settings' })} onClick={onNavigate}>Unverified folder</a>
          )}
          <p className="sidebar-footer-note">
            Read-only. Your notes stay in your folder; edit them in Obsidian.
          </p>
        </div>
      </nav>
    </>
  );
}
