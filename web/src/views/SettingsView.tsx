// SettingsView.tsx - the two folders, the theme and the dashboard layout.
//
// FOLDERS: the ICOR for Life folder (required) and the agents folder
// (optional; the same folder or a separate one). Saving writes the Cockpit's
// own settings file (never either vault) and the server re-reads both folders
// at once. The status line under each field comes from GET /api/status, so a
// refusal reads exactly as the server decided it.
//
// THEME and DASHBOARD: per-browser conveniences in localStorage.
//
// ACCESSIBILITY: labelled inputs, a real submit button, an aria-live status;
// the dashboard reorder is keyboard-first (real move buttons, focus follows
// the moved row) and each section switch is a <button role="switch">.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SlidersHorizontal, Check, ChevronUp, ChevronDown, Sun, Moon, Monitor, FolderCog } from 'lucide-react';
import { useFetch } from '../lib/useCockpit';
import { useTheme, type ThemePref } from '../lib/theme';
import { HUB_MODULES, useHubPrefs } from '../lib/hubPrefs';
import { PageHeader } from '../components/PageHeader';
import type { StatusResponse } from '../lib/api';
import './settings.css';

interface SettingsResponse {
  contentRoot: string | null;
  agentsRoot: string | null;
  lockedByEnv: { content: boolean; agents: boolean };
  resolveCheck: string;
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function FoldersSection() {
  const [reload, setReload] = useState(0);
  const { data: settings } = useFetch<SettingsResponse>(`/api/settings?r=${reload}`);
  const { data: status } = useFetch<StatusResponse>(`/api/status?r=${reload}`);
  const [content, setContent] = useState('');
  const [agents, setAgents] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    if (!settings) return;
    setContent(settings.contentRoot ?? '');
    setAgents(settings.agentsRoot ?? '');
  }, [settings]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: 'saving' });
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' },
        body: JSON.stringify({ contentRoot: content.trim(), agentsRoot: agents.trim() }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setState({ kind: 'error', message: body.error ?? `The server answered ${r.status}.` });
        return;
      }
      setState({ kind: 'saved' });
      setReload((n) => n + 1);
      window.dispatchEvent(new CustomEvent('cockpit:roots-changed'));
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  const contentLine = status
    ? status.content.ok
      ? `Connected: ${status.counts ? Object.entries(status.counts).filter(([k]) => k !== 'planner' && k !== 'documents').reduce((a, [, v]) => a + v, 0) : 0} notes indexed.${status.content.unverified ? ' Unverified folder: no ICOR for Life 2 manifest was found, so older paths may be missing.' : ''}`
      : status.content.reason
    : '';
  const agentsLine = status
    ? status.agents.ok
      ? status.mode
        ? `Connected in mode ${status.mode}: ${status.agentCount} agents.`
        : `Found ${status.agentCount} agents. Connect the ICOR for Life folder too.`
      : status.agents.set ? status.agents.reason : 'Not connected. Agents, insights and analytics stay hidden.'
    : '';
  // "Saved" only when every folder that was entered is accepted (D6 M10).
  const allAccepted = Boolean(status && status.content.ok && (status.agents.ok || !status.agents.set) && (!status.agents.ok || status.mode));

  return (
    <section className="settings-section" aria-labelledby="settings-folders">
      <h2 className="settings-section-title" id="settings-folders">Folders</h2>
      <form className="settings-folders" onSubmit={onSubmit}>
        <label className="settings-field">
          <span className="settings-row-label">ICOR for Life folder</span>
          <span className="settings-row-hint">The absolute path of your vault, for example /Users/you/Documents/ICOR for Life.</span>
          <input
            type="text"
            className="settings-input"
            value={content}
            onChange={(e) => { setContent(e.target.value); setState({ kind: 'idle' }); }}
            placeholder="/path/to/your/ICOR for Life folder"
            spellCheck={false}
            autoComplete="off"
            disabled={settings?.lockedByEnv.content}
          />
          {contentLine && (
            <span className="settings-field-status" data-ok={status?.content.ok ?? false}>{contentLine}</span>
          )}
        </label>

        <label className="settings-field">
          <span className="settings-row-label">Agents folder (same or separate)</span>
          <span className="settings-row-hint">
            Optional. The folder that holds AGENTS.md and 06 AI Team. Leave empty to hide the team views.
          </span>
          <input
            type="text"
            className="settings-input"
            value={agents}
            onChange={(e) => { setAgents(e.target.value); setState({ kind: 'idle' }); }}
            placeholder="empty, or /path/to/your myPKA folder"
            spellCheck={false}
            autoComplete="off"
            disabled={settings?.lockedByEnv.agents}
          />
          {agentsLine && (
            <span className="settings-field-status" data-ok={status?.agents.ok ?? false}>{agentsLine}</span>
          )}
        </label>

        {(settings?.lockedByEnv.content || settings?.lockedByEnv.agents) && (
          <p className="settings-row-hint">A field set by an environment variable (ICOR_CONTENT_ROOT, ICOR_AGENTS_ROOT) cannot be changed here.</p>
        )}
        {settings?.resolveCheck && (
          <p className="settings-row-hint">
            To check your team setup itself, run this in the agents folder:{' '}
            <code className="font-mono">{settings.resolveCheck}</code>. Custom note locations from
            .mypka/sources.yaml are not read in this version; the Cockpit uses the default ICOR for Life paths.
          </p>
        )}

        <div className="settings-folders-actions">
          <button type="submit" className="page-action-btn" disabled={state.kind === 'saving'}>
            Save folders
          </button>
          <span className="settings-status" role="status" aria-live="polite">
            {state.kind === 'saving' && <span className="settings-status-saving">Saving...</span>}
            {state.kind === 'saved' && allAccepted && (
              <span className="settings-status-saved"><Check size={14} strokeWidth={2} aria-hidden="true" /> Saved</span>
            )}
            {state.kind === 'saved' && !allAccepted && (
              <span className="settings-status-error">Saved. Fix the folder above.</span>
            )}
            {state.kind === 'error' && <span className="settings-status-error">{state.message}</span>}
          </span>
        </div>
      </form>
    </section>
  );
}

function DashboardSection() {
  const { prefs, toggle, move } = useHubPrefs();
  const [liveMsg, setLiveMsg] = useState('');
  const moveBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const refocus = useRef<{ key: string; dir: 'up' | 'down' } | null>(null);

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    const btn = moveBtnRefs.current[`${r.key}:${r.dir}`];
    if (btn && !btn.disabled) btn.focus();
    else moveBtnRefs.current[`${r.key}:${r.dir === 'up' ? 'down' : 'up'}`]?.focus();
    refocus.current = null;
  }, [prefs.order]);

  const byKey = new Map(HUB_MODULES.map((m) => [m.key, m]));
  const rows = prefs.order.map((k) => byKey.get(k)).filter((m): m is (typeof HUB_MODULES)[number] => m != null);

  const onMove = (key: string, dir: 'up' | 'down') => {
    const i = prefs.order.indexOf(key);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= prefs.order.length) return;
    refocus.current = { key, dir };
    setLiveMsg(`${byKey.get(key)?.label ?? key} moved ${dir}, now position ${j + 1} of ${prefs.order.length}.`);
    move(key, dir);
  };

  return (
    <section className="settings-section" aria-labelledby="settings-hub-modules">
      <h2 className="settings-section-title" id="settings-hub-modules">Dashboard sections</h2>
      <ol className="settings-list">
        {rows.map((m, idx) => {
          const enabled = !prefs.hidden.includes(m.key);
          return (
            <li className="settings-row" key={m.key}>
              <div className="settings-reorder" role="group" aria-label={`Reorder ${m.label}`}>
                <button
                  type="button"
                  className="settings-move"
                  ref={(el) => { moveBtnRefs.current[`${m.key}:up`] = el; }}
                  onClick={() => onMove(m.key, 'up')}
                  disabled={idx === 0}
                  aria-label={`Move ${m.label} up`}
                >
                  <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="settings-move"
                  ref={(el) => { moveBtnRefs.current[`${m.key}:down`] = el; }}
                  onClick={() => onMove(m.key, 'down')}
                  disabled={idx === rows.length - 1}
                  aria-label={`Move ${m.label} down`}
                >
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
              <div className="settings-row-text">
                <span className="settings-row-label">{m.label}</span>
                <span className="settings-row-hint">{m.hint}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${m.label}: ${enabled ? 'shown on the dashboard' : 'hidden from the dashboard'}`}
                className="settings-switch"
                data-on={enabled}
                onClick={() => toggle(m.key)}
              >
                <span className="settings-switch-track" aria-hidden="true">
                  <span className="settings-switch-thumb" />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>
    </section>
  );
}

export function SettingsView() {
  const { pref: themePref, resolved: themeResolved, setPref: setThemePref } = useTheme();
  const themeOptions: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="settings">
      <PageHeader
        title="Settings"
        icon={SlidersHorizontal}
        subtitle="Your folders, the theme and the dashboard layout. Saved on this machine only."
      />

      <FoldersSection />

      <section className="settings-section" aria-labelledby="settings-appearance">
        <h2 className="settings-section-title" id="settings-appearance">Appearance</h2>
        <div className="settings-row settings-row--theme">
          <div className="settings-row-text">
            <span className="settings-row-label">Theme</span>
            <span className="settings-row-hint">
              {themePref === 'system' ? `Follows your system, currently ${themeResolved}.` : `Always ${themePref}.`}
            </span>
          </div>
          <div className="theme-segmented" role="radiogroup" aria-label="Theme">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const active = themePref === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="theme-option"
                  data-active={active}
                  onClick={() => setThemePref(opt.value)}
                >
                  <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <DashboardSection />

      <p className="settings-row-hint settings-foot">
        <FolderCog size={13} strokeWidth={1.5} aria-hidden="true" /> The Cockpit only reads your folders. Every edit
        happens in Obsidian.
      </p>
    </div>
  );
}
