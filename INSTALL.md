# Install the ICOR for Life - Cockpit

Interim install notes for 2.0.0. The full guide for your own AI assistant, with a
launcher generated from a readable template and a Node version check, is written in
the next release step; until then these steps are complete for a manual install.

Read [DISCLAIMER.md](./DISCLAIMER.md) first.

1. Check Node.js: `node --version` must print v20 or newer.
2. Put this folder anywhere outside your vault, for example `~/Apps/icor-for-life-cockpit`.
3. In this folder run `npm run install:all`, then `npm run build`.
4. Start it: `npm start`. It prints `serving: http://127.0.0.1:4317`.
5. Open that address, go to **Settings**, enter the absolute path of your ICOR for
   Life folder, and optionally your agents folder. Save.
6. Stop it with `Ctrl+C` in the terminal window.

What the install never does: it creates no login item, no launch agent, no
scheduled job and no background service, and it writes nothing into your vault.

Uninstall: stop the Cockpit and delete this folder. Your notes are untouched; the
only file the Cockpit ever wrote is `cockpit.settings.json` inside this folder.
