// strings.ts - the single home for the cockpit's UI CHROME copy (English).
//
// Why this file exists: until 2026-06 the cockpit shipped a mix of German and
// English chrome. This module collects the fixed UI text the app ships - nav
// labels, view titles, buttons, placeholders, empty-states, aria-labels - into
// one English source of truth.
//
// This is NOT an i18n framework and NOT a locale toggle. It's a flat constant
// tree so that a future per-user UI-language switch has a single seam to route
// through (swap `S` for a locale-keyed lookup) without a framework rewrite.
//
// SCOPE - chrome only. This file MUST NOT contain user content or data-derived
// values: note bodies, journal text, or anything read from your folders. Those
// stay in whatever language the data is in.

export const S = {
    roster: {
    title: 'My AI Team',
    countSub: (n: number) =>
      `${n} ${n === 1 ? 'specialist' : 'specialists'} · one model, many hats`,
    loadError: 'Could not load the team',
    feedTitle: 'Team session log',
    feedEmptyTitle: 'No session logs yet',
    feedEmptySub: 'Your team’s session history appears here once your specialists start logging their work.',
    feedLoadError: 'Could not load the session log',
    rosterHeading: 'The roster',
  },

  // The "My AI Team" fly-out submenu (Sidebar) + the pages it routes to. The
  // fly-out opens off the "My AI Team" nav row and offers five destinations.
  team: {
    menuLabel: 'My AI Team',
    menuAria: 'My AI Team - open team menu',
    flyout: {
      roster: 'Team (Roster)',
      sessionLog: 'Session Log',
      workstreams: 'Workstreams',
      sops: 'SOPs',
      guidelines: 'Guidelines',
    },
    sessionLog: {
      title: 'Team Session Log',
      sub: 'Your team’s working history - newest first.',
    },
    workstreams: {
      title: 'Workstreams',
      sub: 'Multi-agent orchestrations (WS-NNN).',
      empty: 'No workstreams yet',
      emptySub:
        'Your team’s multi-step orchestrations appear here once they’re written in the agents folder.',
      loadError: 'Could not load the workstreams',
    },
    sops: {
      title: 'SOPs',
      sub: 'Standard operating procedures (SOP-NNN).',
      empty: 'No SOPs yet',
      emptySub:
        'Your team’s atomic procedures appear here once they’re written in the agents folder.',
      loadError: 'Could not load the SOPs',
    },
    guidelines: {
      title: 'Guidelines',
      sub: 'Static reference + house rules (GL-NNN).',
      empty: 'No guidelines yet',
      emptySub:
        'Your team’s reference guidelines appear here once they’re written in the agents folder.',
      loadError: 'Could not load the guidelines',
    },
  },

} as const;
