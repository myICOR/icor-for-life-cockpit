# Security Policy

The ICOR for Life - Cockpit is local, per-user software. It runs on the machine it
is installed on and reads two folders there.

## Supported versions

| Version | Supported |
|---|---|
| 2.0.x | Yes |
| 1.x (myPKA Cockpit) | No, archived |

## Reporting a vulnerability

Report privately, never in a public issue: use GitHub private vulnerability
reporting on this repository, or email `support@myicor.com`. Include the version,
the steps to reproduce and the impact. We acknowledge, fix, and credit you if you
wish, before any public disclosure.

## Standing rules

- Binds `127.0.0.1` only. There is no LAN mode and no remote access.
- A request whose `Host` header is not a loopback name is refused (DNS rebinding).
- Read-only toward both folders: every data route is a `GET`. The one write
  (`POST /api/settings`) needs the `X-Cockpit: 1` header, a loopback `Origin` when
  present, and writes only `cockpit.settings.json` in the Cockpit folder.
- Every served path is contained with `path.relative` after `realpath`; dot
  folders, `.env*`, `.mcp.json`, `07 Databases` and AI Session transcripts are
  never served. Text previews are capped at 2 MB and served with a no-script CSP.
- No secrets: the Cockpit reads no credentials and needs none.
- Nothing auto-starts: no login item, launch agent or scheduled job.
