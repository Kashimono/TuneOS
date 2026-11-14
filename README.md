# TuneOS

TuneOS is a local desktop-style DJ and audio workspace recreated from the connected Figma Make preview. The app is built with plain HTML, CSS, and browser JavaScript, plus Node.js, Express, and SQLite. It contains no React, Next.js, Vite, or Payload dependencies.

## Start on Ubuntu 22.04 in WSL

1. Install VS Code for Windows and its Microsoft WSL extension. If Ubuntu 22.04 is not installed, run this in PowerShell and finish the first-run setup:

   ```powershell
   wsl --install -d Ubuntu-22.04
   ```

   Microsoft documents this distribution install flow in its [WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install).
2. Open the Ubuntu 22.04 shell. Install `curl`, then install nvm and Node.js 24:

   ```bash
   sudo apt update
   sudo apt install -y curl
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
   source ~/.bashrc
   nvm install 24
   nvm use 24
   node --version
   ```

   The nvm versioned installer and usage follow the [nvm project instructions](https://github.com/nvm-sh/nvm#installing-and-updating). TuneOS uses Node's built-in SQLite module, so keep Node at 24.15 or newer.
3. Open this project folder from Ubuntu. For this workspace, the Windows path maps to:

   ```bash
   cd /mnt/c/Users/aronr/.codex/.chatgpt-projects/g-p-6adf4a8144ec819180ec5c6fc437ce73/TuneOS
   code .
   ```

4. Install the two server dependencies and start TuneOS:

   ```bash
   cp .env.example .env
   npm install
   npm run dev
   ```

5. Open [http://localhost:3030](http://localhost:3030) in your Windows browser. WSL normally forwards local Linux services to Windows localhost. If this machine uses a different WSL networking mode, follow Microsoft's [WSL networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking).

TuneOS creates `database/tuneos.sqlite` and `storage/audio/` on first run. The database seeds eight demo tracks and one starter project. Demo tracks do not include playable source recordings; they use an explicitly labeled synthesized beat preview. Imported audio is stored locally and can be played through the browser's Web Audio API.

## What works

- Desktop shell with app launcher/search (`Ctrl`/`⌘ + K`), dock, task switching, draggable windows, minimize, maximize/restore, close, clock, notifications, and dark/light themes.
- DJ Studio with two or four decks, per-deck play/stop/cue, tempo sync, pitch and volume controls, master level, crossfader, local audio imports, and saved mix state.
- Audio Studio with multitrack lanes, microphone recording (up to 12 seconds per take), import, project save/open, undo/redo for clip edits, and WAV rendering for imported clips.
- Music Library with genre filters, search, rename/delete, track loading, and recent projects.
- File Manager for locally imported audio and projects.
- System Monitor, Process Manager, Memory Manager, CPU Scheduler, Resource Manager, System Information, Firewall Manager, Settings, and Activity Logs. Telemetry comes from the Node host; browser-only and simulated operations are labeled in the UI.
- Express API and SQLite tables for tracks, project state, playlists, settings, firewall display rules, and activity logs.

## API routes

- `GET /api/health`
- `GET /api/tracks`, `POST /api/tracks/import`, `PATCH /api/tracks/:id`, `DELETE /api/tracks/:id`, `GET /api/audio/:id`
- `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`
- `GET /api/settings`, `PUT /api/settings/:key`
- `GET /api/system/metrics`
- `GET /api/firewall`, `POST /api/firewall/rules`, `PATCH /api/firewall/rules/:id`, `DELETE /api/firewall/rules/:id`
- `GET /api/activity`, `POST /api/activity`

## WSL, firewall, and IP allowlisting

TuneOS binds to `127.0.0.1:3030` by default, so only local requests can connect. The API also rejects non-loopback client addresses unless `ALLOWED_CLIENT_IPS` lists the exact remote address. This is an app-level exact-address allowlist; it does not accept CIDR ranges and does not replace Windows Firewall, Hyper-V Firewall, or UFW.

For a trusted LAN test only:

1. Determine the client address that the TuneOS server actually sees (WSL NAT, localhost forwarding, and mirrored networking may present different addresses).
2. In `.env`, set `HOST=0.0.0.0` and set `ALLOWED_CLIENT_IPS` to a comma-separated list of exact trusted addresses, for example `192.168.1.27,192.168.1.28`.
3. Add matching inbound rules on the relevant firewall, restricted to those client addresses and TCP port 3030. Example Ubuntu UFW rule:

   ```bash
   sudo ufw allow from 192.168.1.27 to any port 3030 proto tcp
   sudo ufw status
   ```

   Example elevated PowerShell rule for the Windows host:

   ```powershell
   New-NetFirewallRule -DisplayName "TuneOS 3030 from trusted client" -Direction Inbound -Protocol TCP -LocalPort 3030 -RemoteAddress 192.168.1.27 -Action Allow -Profile Private
   ```

4. Restart TuneOS, then test from the named client. Remove the firewall rule and restore `HOST=127.0.0.1` when LAN access is no longer needed.

WSL2 NAT, mirrored mode, Hyper-V Firewall, and Windows Firewall affect how inbound traffic reaches Linux. Microsoft's [WSL networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking) documents the appropriate forwarding/firewall steps for the installed WSL mode. The TuneOS Firewall Manager only saves simulated rules in SQLite; it never changes OS firewall rules. Do not expose this demo service to an untrusted network: it has no user login or TLS layer.

## Current limits

- The Figma Make source bundle was recoverable and its original source snapshot contains the project, but that downloaded snapshot predates the latest live preview revision. The current preview was inspected separately; this implementation follows the current desktop shell and app surfaces, while the archive's older UI-specific assets are retained under `public/assets/reference/` rather than misrepresented as current artwork.
- The original Figma project did not include audio files for its demo songs. Demo playback is synthesized; imported local files play as actual audio.
- Reverb, delay, and EQ controls are interface foundations and are not yet applied to the rendered WAV. WAV export currently mixes imported clips at their stored timeline positions.
- Account sign-in, cloud sync, and production-grade multi-user access control are not implemented. The default loopback bind is the intended setup.
- Firewall manager rules and CPU scheduling are educational UI simulations. They do not control the host OS.
- Browser microphone recording requires microphone permission and a secure browser context. `localhost` is treated as a secure context by modern browsers.

## Design source and assets

The Figma Make export was inspected and recovered to a temporary workspace staging directory during implementation. The project's synced `sources/` directory was left unchanged. Three images from an older BeatBox OS draft are preserved in `public/assets/reference/` for provenance; the current desktop is drawn with local CSS so the app does not depend on remote image services or fonts.
