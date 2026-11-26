# TuneOS

TuneOS is a local desktop-style DJ and audio workspace recreated from the connected Figma Make preview. The app is built with plain HTML, CSS, and browser JavaScript, plus Node.js, Express, and SQLite. It contains no React, Next.js, Vite, or Payload dependencies.

## Run on the Ubuntu Server VM

The project is developed on Windows and runs from `~/TuneOS` on an Ubuntu Server VM in VMware. The package declares Node.js `>=24.15.0`. Node.js `v24.22.3` is installed through NVM and is the VM's NVM default; however, a normal non-login SSH command resolves `/usr/bin/node` (`v22.22.1`) because it does not load NVM. In an interactive shell, run `source ~/.nvm/nvm.sh` and `nvm use 24` before starting TuneOS. If a service manager is used later, configure its `PATH` or Node executable explicitly; no TuneOS systemd service was found during the latest inspection. From the VM project directory, install dependencies and start with `npm install` and `npm start` (or `npm run dev` during development). Do not overwrite an existing `.env` when preparing environment settings.

TuneOS defaults to binding `127.0.0.1:3030`, which only accepts local connections. To use it from the Windows host, the server must bind to a VM-reachable address and the app allowlist, Ubuntu firewall, and VMware network must permit only the intended Windows host. Then open `http://<Ubuntu-VM-address>:3030` in Windows. The exact address and allowlist depend on the VM network configuration. Do not expose the demo service to untrusted networks; this setup uses HTTP, not TLS.

TuneOS creates `database/tuneos.sqlite` and `storage/audio/` on first run. The database seeds eight demo tracks and one starter project. Demo tracks do not include playable source recordings; they use an explicitly labeled synthesized beat preview. Imported audio is stored locally and can be played through the browser's Web Audio API.

## What works

- Desktop shell with app launcher/search (`Ctrl`/`⌘ + K`), dock, task switching, draggable windows, minimize, maximize/restore, close, clock, notifications, and dark/light themes.
- DJ Studio with two or four decks, per-deck play/stop/cue, tempo sync, pitch and volume controls, master level, crossfader, local audio imports, and saved mix state.
- Audio Studio with multitrack lanes, microphone recording (up to 12 seconds per take), import, project save/open, undo/redo for clip edits, and WAV rendering for imported clips.
- Music Library with genre filters, search, rename/delete, track loading, and recent projects.
- File Manager for locally imported audio and projects.
- System Monitor, Process Manager, and Memory Manager read host CPU, RAM, disk, uptime, TuneOS process RSS, and Linux `/proc` process data from the server. Process controls are read-only.
- CPU Scheduler is an educational FCFS/Round Robin simulation; it does not change Linux scheduling. Browser and application resource panels are TuneOS-side information, not a complete OS resource manager.
- Firewall Manager reads live UFW status and numbered rules through the restricted helper. The presentation build is read-only: adding and deleting UFW rules are disabled. Existing SQLite firewall records are labeled demonstrations and do not change UFW.
- SSH Manager reads effective OpenSSH settings and service state through a restricted helper. SSH configuration changes are disabled in the presentation build.
- Express API and SQLite tables store tracks, project state, playlists, settings, managed UFW rule metadata, and activity logs.

## API routes

- `GET /api/health`
- `GET /api/auth/session`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/tracks`, `POST /api/tracks/import`, `PATCH /api/tracks/:id`, `DELETE /api/tracks/:id`, `GET /api/audio/:id`
- `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`
- `GET /api/settings`, `PUT /api/settings/:key`
- `GET /api/system/metrics`, `GET /api/system/processes`
- `GET /api/firewall/status`, `GET /api/firewall/actual/rules` (live read-only Ubuntu data; actual rule mutations are disabled in the presentation build)
- `GET /api/firewall`, `POST /api/firewall/rules`, `PATCH /api/firewall/rules/:id`, `DELETE /api/firewall/rules/:id` (SQLite demo rules)
- `GET /api/ssh/status` (live read-only Ubuntu data; SSH configuration mutations are disabled in the presentation build)
- `GET /api/activity`, `POST /api/activity`

Account records are stored in SQLite's `users` table. Passwords use salted scrypt hashes; session tokens are random, expire after seven days, and are stored hashed in the `sessions` table. The browser cookie is HTTP-only and SameSite strict, and is marked Secure when TuneOS is reached over HTTPS. On the documented plain HTTP setup, the connection itself is not encrypted, so use a unique password and do not expose the app to untrusted networks. Accounts currently identify the user in the interface; existing tracks, projects, and settings remain shared by this local TuneOS instance.

## Authentication, firewall, and IP allowlisting

Health and authentication routes are public; application APIs require a valid unexpired SQLite session. The API also rejects non-loopback client addresses unless `ALLOWED_CLIENT_IPS` lists the exact remote address. This is an app-level exact-address allowlist; it does not accept CIDR ranges and does not replace Windows Firewall or UFW.

To access TuneOS from Windows through VMware, first determine the Windows host address that Ubuntu actually sees. Configure `HOST` and `ALLOWED_CLIENT_IPS` to permit only that address, and verify that the VM network and existing inbound firewall rules allow TCP 3030 from it. Then open `http://<Ubuntu-VM-address>:3030` in Windows. Keep the existing SSH and TuneOS access rules intact. TuneOS does not add or delete UFW rules in the presentation build; status and numbered rule listing are read-only. Existing UFW rules, including ports 22 and 3030, are left untouched.

## Current limits

- The Figma Make source bundle was recoverable and its original source snapshot contains the project, but that downloaded snapshot predates the latest live preview revision. The current preview was inspected separately; this implementation follows the current desktop shell and app surfaces, while the archive's older UI-specific assets are retained under `public/assets/reference/` rather than misrepresented as current artwork.
- The original Figma project did not include audio files for its demo songs. Demo playback is synthesized; imported local files play as actual audio.
- Reverb, delay, and EQ controls are interface foundations and are not yet applied to the rendered WAV. WAV export currently mixes imported clips at their stored timeline positions.
- Cloud sync and per-user isolation of tracks, projects, and settings are not implemented; those records are shared by this local TuneOS instance.
- Ubuntu helper installation and sudoers policy are system-level deployment prerequisites. Source code alone does not install or grant permission to run the helpers. The last reported Ubuntu inspection confirmed UFW active and SSH configuration valid. Read-only helper deployment and permissions still need to be verified on the VM before the live panels can be demonstrated.
- CPU scheduling and SQLite firewall display rules are educational simulations. They do not control the host OS.
- Browser microphone recording requires microphone permission and a secure browser context. `localhost` is treated as a secure context by modern browsers.

## Design source and assets

The Figma Make export was inspected and recovered to a temporary workspace staging directory during implementation. The project's synced `sources/` directory was left unchanged. Three images from an older BeatBox OS draft are preserved in `public/assets/reference/` for provenance; the current desktop is drawn with local CSS so the app does not depend on remote image services or fonts.
