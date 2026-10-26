# TuneOS v0.1

TuneOS is a music-centric web desktop that runs in a browser. It provides a small desktop shell, a local audio player, a real-time audio visualizer, animated wallpaper presets, and desktop customization.

## Requirements

- Node.js 18 or newer
- npm
- A modern browser with Web Audio API support

## Install and run

Dependencies are already listed in `package.json` (Express is the only runtime dependency).

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). For automatic server restarts while editing, use `npm run dev`.

## Using TuneOS

- Open **Music** from the desktop icon or taskbar and add one or more audio files from your device.
- Use the playlist, playback controls, seek bar, and volume slider. Files are played in the browser and are never uploaded to the server.
- The visualizer and Aurora wallpaper analyze the playing audio through the Web Audio API. Start playback with a user action so the browser can enable audio processing.
- Open **Settings** to choose an accent, Midnight or Dusk theme, Aurora or Orbit wallpaper, and whether the desktop clock is shown. Preferences save in browser `localStorage`.
- Drag a window by its title bar. The title bar controls minimize, maximize, and close it; its taskbar button reopens it.

The Express server in `Backend/server.js` serves the frontend from `Frontend/` and exposes `GET /api/status` and `GET /api/config`.

## Limitations

- TuneOS is a web page that simulates a desktop; it does not replace the Windows desktop or set a native Windows wallpaper.
- Spotify and external music players are not supported in v0.1.
- Music files and playlists are not persisted after refresh. Select files again in each browser session.
- Audio decoding depends on browser and file format support. Some browsers may not decode every format.
- Preferences are local to the current browser profile and device.

## Project layout

```text
Frontend/
  index.html
  style.css
  script.js
  assets/
Backend/
  server.js
package.json
package-lock.json
```
