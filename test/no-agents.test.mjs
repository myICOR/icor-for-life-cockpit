// no-agents.test.mjs - test bed 1: a fresh ICOR for Life folder with no agents
// folder. Knowledge and Planner work; every team route answers no_agents_root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoots, startApp, rmrf } from './helpers.mjs';

test('content only: team routes are hidden, knowledge works', async () => {
  const roots = makeRoots();
  const api = await startApp({ contentRoot: roots.content, agentsRoot: null });
  try {
    const status = (await api.json('/api/status')).body;
    assert.equal(status.agents.ok, false);
    assert.equal(status.agents.set, false);
    assert.equal(status.mode, null);
    const r = await api.json('/api/team/agents');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'no_agents_root');
    assert.equal((await api.json('/api/nav')).body.agents, false);
    assert.equal((await api.json('/api/list/projects')).status, 200);
  } finally {
    await api.close();
    rmrf(roots.content, roots.agents);
  }
});

test('nothing set: the data routes explain what is missing', async () => {
  const api = await startApp({ contentRoot: null, agentsRoot: null });
  try {
    const r = await api.json('/api/dashboard');
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'no_content_root');
    assert.equal((await api.json('/api/status')).body.content.ok, false);
  } finally {
    await api.close();
  }
});
