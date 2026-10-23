# Build security — Ello Smart TV

This app talks to the **ello panel** for licensing + anti-abuse, and ships with
anti-tamper and obfuscation. Three layers, plus one honest caveat.

## 1. Panel licensing (runtime)

The main process gates startup through `src/main/panel/` (SDK + config + the
license gate). On launch it validates the user's license key and the build's
integrity with the panel, prompts for a key if needed, then heartbeats so a
revoke / ban / device-disable takes effect while the app runs.

Configure it in **`src/main/panel/config.ts`** (or via `ELLO_PANEL_URL`,
`ELLO_PANEL_APP_ID`, `ELLO_PANEL_APP_SECRET` env at build): paste the App ID +
secret you got when registering this app in the panel. Until it's configured the
gate is disabled, so development isn't blocked.

## 2. Obfuscation (build time)

`electron.vite.config.ts` runs [`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator)
over the **main and preload** bundles (where the license logic lives). Settings
are conservative (`target: node`, no self-defending) so they don't break the mpv
child-process + IPC wiring. Set `ELLO_NO_OBFUSCATE=1` to build without it when
debugging. The renderer (React UI) is intentionally left un-obfuscated — it
holds no secrets and obfuscating it tends to break.

## 3. Anti-tamper fuses + ASAR integrity (package time)

`electron-builder.yml` → `electronFuses` flips Electron security fuses when the
app is packaged:

- **`enableEmbeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar`** — the app
  refuses to launch if `app.asar` is modified after signing.
- **`runAsNode` / `enableRunAsNode` / `enableNodeOptionsEnvironmentVariable` /
  `enableNodeCliInspectArguments` = false** — close off running the binary as a
  plain Node process (e.g. `ELECTRON_RUN_AS_NODE`) to skip app code.

This is belt-and-braces with the panel's own build-integrity allowlist: after a
release, add that build's hash under **Security → Known-good builds** in the
panel. Compute it from the packaged `app.asar`:

```bash
node -e "import('./src/main/panel/panel-client').then(m=>console.log(m.computeSelfHash(['release/win-unpacked/resources/app.asar'])))"
```

(or the SDK copy in `admin-panel/clients/`). On Windows the fuse-based integrity
check is strongest with a real code-signing certificate; this project ships
unsigned, so SmartScreen still warns on first run.

## The honest caveat

Obfuscation and fuses **raise the bar** — they make it much harder to read,
patch, or repackage the app — but a determined attacker with the binary can
still get in, and the embedded per-app `appSecret` can be extracted. That's why
the real access decision lives on the **server**: only the panel can
revoke/expire/ban/disable, and those can't be patched out of a client. Never
ship anything in this app that must stay secret.
