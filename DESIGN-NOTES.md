# TuneOS design conversion notes

- Reference: connected Figma Make file “Build BeatBox OS DJ Mixer”, including its live `/workspace?demo=1` preview.
- The current visual language is a deep navy desktop with a thin top status bar, compact left app rail, centered translucent bottom dock, outlined audio-ring wallpaper, and dark rounded app windows.
- The DJ Studio window includes two/four-deck selection, per-deck transport and level controls, waveforms, a central crossfader, master level, import/save actions, and a track crate.
- Audio Studio, Music Library, File Manager, and system utilities are represented as separate draggable windows. Simulated OS-facing features carry an explicit label.
- The downloadable `.make` bundle was older than the latest visible Make revision. The recovered source tree and two included raster references were retained during conversion; current desktop chrome is recreated in HTML/CSS rather than using the older draft images.
- This conversion uses only browser-native HTML/CSS/JavaScript and an Express + SQLite service. No framework-based front-end or bundler is required.
