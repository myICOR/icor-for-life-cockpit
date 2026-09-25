# Changelog

All notable changes to the ICOR for Life - Cockpit are documented here.
The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - unreleased

The myPKA Cockpit 1.6.0, retargeted as a standalone viewer for ICOR for Life.

### Changed

- **Standalone.** Installs anywhere, outside the vault. The ICOR for Life folder
  and an optional agents folder (same or separate) are set in Settings.
- **Reads markdown directly.** An in-memory index of frontmatter and wikilinks
  replaces the `mypka.db` SQLite mirror; the index refreshes within a second of a
  change. Paths, types and fields come from the vendored `icor-concepts/1` schema
  (myPKA 6.0.1), pinned by sha256.
- **Knowledge and Planner first.** A new dashboard (today, this week, the life
  snapshot, buckets, latest journal and notes, on this day), the Planner as a
  read-only week board from `02 Planner/`, Inbox and Work in progress rooms, and
  the knowledge lists for all nine ICOR concepts.
- **The AI team is optional.** Roster, insights, session logs (myPKA 6 and 5
  shapes), tasks, analytics and team knowledge appear only when an agents folder
  is connected. AI Session transcripts are never read, only their metadata.
- **Licence:** MIT (was the myICOR Cockpit Personal-Use License).

### Removed

- Connectors (Todoist, ClickUp, iCal, IMAP) and the key vault, finance and
  invoices, wellness and workouts, LAN mode and the PIN, the Fleeting Notes
  editor and whiteboards, the libraries and Outer World modules, the
  discuss-with-AI and terminal launchers, the SQLite extension and regen scripts,
  and the `better-sqlite3`, `imapflow` and `node-ical` dependencies.

### History

Versions 1.0.0 to 1.6.0 shipped as the myPKA Cockpit expansion; that line is
archived.
