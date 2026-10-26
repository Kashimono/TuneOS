(() => {
  'use strict';

  const STORAGE_KEY = 'tuneos.preferences.v1';
  const DEFAULTS = Object.freeze({ accent: 'violet', theme: 'midnight', wallpaper: 'aurora', showClock: true });
  const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i;
  const allowed = {
    accent: new Set(['violet', 'blue', 'mint', 'rose', 'amber']),
    theme: new Set(['midnight', 'dusk']),
    wallpaper: new Set(['aurora', 'orbit'])
  };
  const desktop = document.getElementById('desktop');
  const audio = document.getElementById('audio');
  const playlistElement = document.getElementById('playlist');
  const playerWindow = document.getElementById('playerWindow');
  const settingsWindow = document.getElementById('settingsWindow');
  const windows = { player: playerWindow, settings: settingsWindow };
  let preferences = readPreferences();
  let tracks = [];
  let currentIndex = -1;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let frequencyData = null;
  let animationFrame = 0;
  let toastTimer = 0;
  let highestZ = 6;

  function readPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        accent: allowed.accent.has(saved.accent) ? saved.accent : DEFAULTS.accent,
        theme: allowed.theme.has(saved.theme) ? saved.theme : DEFAULTS.theme,
        wallpaper: allowed.wallpaper.has(saved.wallpaper) ? saved.wallpaper : DEFAULTS.wallpaper,
        showClock: typeof saved.showClock === 'boolean' ? saved.showClock : DEFAULTS.showClock
      };
    } catch (_error) {
      return { ...DEFAULTS };
    }
  }

  function savePreferences() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
    catch (_error) { showToast('Could not save preferences in this browser.'); }
  }

  function applyPreferences() {
    document.body.dataset.accent = preferences.accent;
    document.body.dataset.theme = preferences.theme;
    document.body.dataset.wallpaper = preferences.wallpaper;
    document.getElementById('clockWidget').hidden = !preferences.showClock;
    document.getElementById('clockToggle').checked = preferences.showClock;
    document.getElementById('accentValue').textContent = preferences.accent.toUpperCase();
    document.querySelectorAll('[data-accent-choice]').forEach((button) => button.classList.toggle('selected', button.dataset.accentChoice === preferences.accent));
    document.querySelectorAll('[data-theme-choice]').forEach((button) => button.classList.toggle('selected', button.dataset.themeChoice === preferences.theme));
    document.querySelectorAll('[data-wallpaper-choice]').forEach((button) => button.classList.toggle('selected', button.dataset.wallpaperChoice === preferences.wallpaper));
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  async function loadServerInfo() {
    try {
      const [statusResponse, configResponse] = await Promise.all([fetch('/api/status'), fetch('/api/config')]);
      if (!statusResponse.ok || !configResponse.ok) throw new Error('API unavailable');
      const status = await statusResponse.json();
      const config = await configResponse.json();
      document.getElementById('systemMessage').textContent = `${status.name} v${status.version} · ${config.capabilities.localAudio ? 'LOCAL AUDIO READY' : 'DESKTOP READY'}`;
    } catch (_error) {
      document.getElementById('systemMessage').textContent = 'Your space, in rhythm';
    }
  }

  function updateClocks() {
    const now = new Date();
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
    const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(now);
    document.getElementById('desktopTime').textContent = time;
    document.getElementById('taskbarTime').textContent = time;
    document.getElementById('desktopDate').textContent = date;
    document.getElementById('taskbarDate').textContent = shortDate;
  }

  function focusWindow(appName) {
    const windowElement = windows[appName];
    if (!windowElement) return;
    windowElement.hidden = false;
    windowElement.style.zIndex = String(++highestZ);
    windowElement.classList.add('is-active');
    Object.values(windows).forEach((item) => { if (item !== windowElement) item.classList.remove('is-active'); });
    const taskbarButton = document.querySelector(`.taskbar-app[data-open-window="${appName}"]`);
    taskbarButton?.classList.add('is-open');
    renderOpenApps();
  }

  function minimizeWindow(appName) {
    const item = windows[appName];
    if (!item) return;
    item.hidden = true;
    item.classList.remove('is-active');
    document.querySelector(`.taskbar-app[data-open-window="${appName}"]`)?.classList.remove('is-open');
    renderOpenApps();
  }

  function closeWindow(appName) {
    const item = windows[appName];
    if (!item) return;
    item.hidden = true;
    item.classList.remove('is-active', 'is-maximized');
    document.querySelector(`.taskbar-app[data-open-window="${appName}"]`)?.classList.remove('is-open');
    renderOpenApps();
  }

  function renderOpenApps() {
    const container = document.getElementById('taskbarOpenApps');
    container.replaceChildren();
    Object.entries(windows).forEach(([appName, item]) => {
      if (item.hidden) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = appName === 'player' ? '♫ Music' : '◌ Settings';
      button.addEventListener('click', () => minimizeWindow(appName));
      container.append(button);
    });
  }

  document.querySelectorAll('[data-open-window]').forEach((button) => {
    button.addEventListener('click', () => focusWindow(button.dataset.openWindow));
  });
  document.querySelectorAll('.taskbar-app').forEach((button) => {
    button.addEventListener('click', () => {
      const item = windows[button.dataset.openWindow];
      if (item && !item.hidden && item.classList.contains('is-active')) minimizeWindow(button.dataset.openWindow);
      else focusWindow(button.dataset.openWindow);
    });
  });
  document.querySelectorAll('.app-window').forEach((item) => {
    item.addEventListener('pointerdown', () => {
      item.style.zIndex = String(++highestZ);
      item.classList.add('is-active');
    });
    item.querySelectorAll('[data-window-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const appName = item.dataset.window;
        const action = button.dataset.windowAction;
        if (action === 'close') closeWindow(appName);
        if (action === 'minimize') minimizeWindow(appName);
        if (action === 'maximize') item.classList.toggle('is-maximized');
      });
    });
    const bar = item.querySelector('[data-drag-handle]');
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || item.classList.contains('is-maximized') || event.button !== 0) return;
      const rect = item.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      item.style.left = `${rect.left}px`;
      item.style.top = `${rect.top}px`;
      item.style.transform = 'none';
      bar.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const maxX = Math.max(8, window.innerWidth - item.offsetWidth - 8);
        const maxY = Math.max(65, window.innerHeight - item.offsetHeight - 62);
        item.style.left = `${Math.min(maxX, Math.max(8, moveEvent.clientX - offsetX))}px`;
        item.style.top = `${Math.min(maxY, Math.max(65, moveEvent.clientY - offsetY))}px`;
      };
      const finish = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', finish);
        bar.removeEventListener('pointercancel', finish);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', finish);
      bar.addEventListener('pointercancel', finish);
      event.preventDefault();
    });
  });

  document.querySelectorAll('[data-accent-choice]').forEach((button) => button.addEventListener('click', () => {
    preferences.accent = button.dataset.accentChoice;
    applyPreferences(); savePreferences();
  }));
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
    preferences.theme = button.dataset.themeChoice;
    applyPreferences(); savePreferences();
  }));
  document.querySelectorAll('[data-wallpaper-choice]').forEach((button) => button.addEventListener('click', () => {
    preferences.wallpaper = button.dataset.wallpaperChoice;
    applyPreferences(); savePreferences();
  }));
  document.getElementById('clockToggle').addEventListener('change', (event) => {
    preferences.showClock = event.target.checked;
    applyPreferences(); savePreferences();
  });
  document.getElementById('resetSettings').addEventListener('click', () => {
    preferences = { ...DEFAULTS };
    applyPreferences(); savePreferences(); showToast('Preferences reset to default.');
  });

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function displayName(fileName) { return fileName.replace(/\.[^.]+$/, '').replace(/[._]/g, ' '); }

  function updateLibrarySummary() {
    const count = tracks.length;
    document.getElementById('trackCount').textContent = String(count);
    document.getElementById('librarySummary').textContent = count ? `${count} ${count === 1 ? 'track' : 'tracks'} in your local library` : 'Add a few tracks to get started.';
  }

  function renderPlaylist() {
    playlistElement.replaceChildren();
    updateLibrarySummary();
    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-library';
      const icon = document.createElement('span'); icon.textContent = '♫';
      const heading = document.createElement('strong'); heading.textContent = 'Your library starts here';
      const copy = document.createElement('p'); copy.append('Choose audio files from your device.', document.createElement('br'), 'Your music stays right here in your browser.');
      const action = document.createElement('button'); action.className = 'text-button'; action.id = 'emptyAddButton'; action.type = 'button'; action.append('Choose audio files ', Object.assign(document.createElement('span'), { textContent: '↗' }));
      action.addEventListener('click', openAudioPicker);
      empty.append(icon, heading, copy, action); playlistElement.append(empty); return;
    }
    tracks.forEach((track, index) => {
      const row = document.createElement('div'); row.className = `track-row${index === currentIndex ? ' current' : ''}`;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'track-select'; select.setAttribute('aria-label', `Play ${track.name}`);
      const number = document.createElement('span'); number.className = 'track-index'; number.textContent = index === currentIndex && !audio.paused ? '♫' : String(index + 1).padStart(2, '0');
      const nameWrap = document.createElement('span'); nameWrap.className = 'track-name-wrap';
      const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.name;
      const meta = document.createElement('span'); meta.className = 'track-meta'; meta.textContent = track.file.type || 'Local audio'; nameWrap.append(name, meta); select.append(number, nameWrap);
      select.addEventListener('click', () => playTrack(index));
      const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = formatTime(track.duration);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-track'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${track.name}`);
      remove.addEventListener('click', () => removeTrack(index));
      row.append(select, duration, remove); playlistElement.append(row);
    });
  }

  function openAudioPicker() { document.getElementById('audioPicker').click(); }
  document.getElementById('addTracksButton').addEventListener('click', openAudioPicker);
  document.getElementById('emptyAddButton')?.addEventListener('click', openAudioPicker);
  document.getElementById('audioPicker').addEventListener('change', (event) => {
    const incoming = Array.from(event.target.files || []);
    const accepted = incoming.filter((file) => file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name));
    const rejectedCount = incoming.length - accepted.length;
    accepted.forEach((file) => tracks.push({ file, name: displayName(file.name), url: URL.createObjectURL(file), duration: 0 }));
    event.target.value = '';
    renderPlaylist();
    if (rejectedCount) showToast(`${rejectedCount} unsupported ${rejectedCount === 1 ? 'file was' : 'files were'} skipped.`);
    else if (accepted.length) showToast(`${accepted.length} ${accepted.length === 1 ? 'track' : 'tracks'} added to your local library.`);
  });

  function removeTrack(index) {
    const [removed] = tracks.splice(index, 1);
    if (!removed) return;
    const wasCurrent = currentIndex === index;
    URL.revokeObjectURL(removed.url);
    if (index < currentIndex) currentIndex -= 1;
    if (wasCurrent) {
      audio.pause(); audio.removeAttribute('src'); audio.load(); currentIndex = -1;
      if (tracks.length) playTrack(Math.min(index, tracks.length - 1));
      else resetTrackDisplay();
    }
    renderPlaylist();
  }

  function ensureAudioGraph() {
    if (!window.AudioContext && !window.webkitAudioContext) throw new Error('Web Audio is not supported in this browser.');
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      sourceNode = audioContext.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') audioContext.resume();
  }

  async function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    currentIndex = index;
    const track = tracks[index];
    if (audio.src !== track.url) audio.src = track.url;
    try {
      ensureAudioGraph();
      await audio.play();
      updateTrackDisplay();
      focusWindow('player');
      renderPlaylist();
    } catch (error) {
      audio.pause();
      const message = error.name === 'NotAllowedError' ? 'Your browser blocked playback. Press play to try again.' : 'This audio file could not be played. Try another format.';
      showToast(message);
      updatePlayState();
    }
  }

  function resetTrackDisplay() {
    document.getElementById('currentTitle').textContent = 'Nothing playing';
    document.getElementById('currentArtist').textContent = 'Pick a track from your library';
    document.getElementById('ambientTitle').textContent = 'A quiet moment';
    document.getElementById('ambientArtist').textContent = 'Your library is waiting';
    document.getElementById('ambientState').textContent = 'READY WHEN YOU ARE';
    document.getElementById('duration').textContent = '0:00';
    document.getElementById('currentTime').textContent = '0:00';
    document.getElementById('seekBar').value = '0';
    updatePlayState();
  }

  function updateTrackDisplay() {
    const track = tracks[currentIndex];
    if (!track) return resetTrackDisplay();
    document.getElementById('currentTitle').textContent = track.name;
    document.getElementById('currentArtist').textContent = track.file.type || 'Local audio file';
    document.getElementById('ambientTitle').textContent = track.name;
    document.getElementById('ambientArtist').textContent = track.file.type || 'Local audio';
    document.getElementById('ambientState').textContent = audio.paused ? 'PAUSED' : 'PLAYING FROM YOUR LIBRARY';
    document.getElementById('duration').textContent = formatTime(audio.duration || track.duration);
    updatePlayState();
  }

  function updatePlayState() {
    const isPlaying = !audio.paused && currentIndex >= 0;
    const button = document.getElementById('playButton');
    button.textContent = isPlaying ? 'Ⅱ' : '▶';
    button.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    document.getElementById('visualizerStatus').textContent = isPlaying ? 'ANALYZING AUDIO' : currentIndex >= 0 ? 'PLAYBACK PAUSED' : 'WAITING FOR SOUND';
    document.querySelector('.visualizer-wrap').classList.toggle('is-playing', isPlaying);
    document.getElementById('ambientState').textContent = isPlaying ? 'PLAYING FROM YOUR LIBRARY' : currentIndex >= 0 ? 'PAUSED' : 'READY WHEN YOU ARE';
  }

  document.getElementById('playButton').addEventListener('click', () => {
    if (currentIndex < 0) { if (tracks.length) playTrack(0); else { focusWindow('player'); openAudioPicker(); } return; }
    if (audio.paused) playTrack(currentIndex); else audio.pause();
  });
  document.getElementById('nextButton').addEventListener('click', () => { if (tracks.length) playTrack((currentIndex + 1 + tracks.length) % tracks.length); });
  document.getElementById('previousButton').addEventListener('click', () => {
    if (!tracks.length) return;
    if (audio.currentTime > 3) audio.currentTime = 0;
    else playTrack((currentIndex - 1 + tracks.length) % tracks.length);
  });
  audio.addEventListener('loadedmetadata', () => {
    if (tracks[currentIndex]) tracks[currentIndex].duration = audio.duration;
    document.getElementById('duration').textContent = formatTime(audio.duration);
    renderPlaylist();
  });
  audio.addEventListener('timeupdate', () => {
    const position = audio.duration ? audio.currentTime / audio.duration * 1000 : 0;
    document.getElementById('seekBar').value = String(position);
    document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
    document.getElementById('ambientProgress').style.width = `${position / 10}%`;
  });
  audio.addEventListener('play', () => { updateTrackDisplay(); renderPlaylist(); });
  audio.addEventListener('pause', () => { updatePlayState(); renderPlaylist(); });
  audio.addEventListener('ended', () => { if (tracks.length > 1) playTrack((currentIndex + 1) % tracks.length); else { audio.currentTime = 0; updatePlayState(); } });
  audio.addEventListener('error', () => { if (currentIndex >= 0) showToast('Unable to decode this audio file. Try another file.'); });
  document.getElementById('seekBar').addEventListener('input', (event) => {
    if (Number.isFinite(audio.duration) && audio.duration) audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
  });
  document.getElementById('volumeBar').addEventListener('input', (event) => {
    audio.volume = Number(event.target.value);
    document.getElementById('volumeValue').textContent = `${Math.round(audio.volume * 100)}%`;
  });
  audio.volume = 0.75;

  const visualizerCanvas = document.getElementById('visualizer');
  const visualizerContext = visualizerCanvas.getContext('2d');
  const wallpaperCanvas = document.getElementById('wallpaperCanvas');
  const wallpaperContext = wallpaperCanvas.getContext('2d');
  let visualizerSize = { width: 0, height: 0, dpr: 1 };
  let wallpaperSize = { width: 0, height: 0, dpr: 1 };

  function sizeCanvas(canvas, context, target) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height; context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    target.width = rect.width; target.height = rect.height; target.dpr = dpr;
  }

  function drawVisualizer(time) {
    if (playerWindow.hidden) return;
    const { width, height } = visualizerSize;
    if (!width || !height) return;
    visualizerContext.clearRect(0, 0, width, height);
    const playing = !audio.paused && analyser && frequencyData;
    const accentRgb = getComputedStyle(document.body).getPropertyValue('--accent-rgb').trim() || '168,139,255';
    const bars = Math.max(24, Math.floor(width / 8));
    const barWidth = Math.max(2, width / (bars * 1.75));
    const gap = (width - bars * barWidth) / (bars + 1);
    const center = height * .64;
    if (playing) analyser.getByteFrequencyData(frequencyData);
    for (let i = 0; i < bars; i += 1) {
      const dataIndex = Math.min(frequencyData ? frequencyData.length - 1 : 0, Math.floor(i / bars * (frequencyData?.length || 1) * .72));
      const value = playing ? frequencyData[dataIndex] / 255 : 0;
      const idle = 2.1 + (Math.sin(time / 1050 + i * .32) + 1) * 1.25;
      const barHeight = Math.max(playing ? 2 : 1.5, (playing ? value * height * .59 : idle));
      const x = gap + i * (barWidth + gap);
      const gradient = visualizerContext.createLinearGradient(0, center - barHeight, 0, center);
      gradient.addColorStop(0, `rgba(${accentRgb},${.36 + value * .58})`);
      gradient.addColorStop(1, `rgba(${accentRgb},${.13 + value * .4})`);
      visualizerContext.fillStyle = gradient;
      visualizerContext.beginPath();
      visualizerContext.roundRect(x, center - barHeight, barWidth, barHeight, 3);
      visualizerContext.fill();
      if (playing) { visualizerContext.globalAlpha = .2; visualizerContext.fillRect(x, center + 3, barWidth, barHeight * .3); visualizerContext.globalAlpha = 1; }
    }
  }

  function drawWallpaper(time) {
    const { width, height } = wallpaperSize;
    if (!width || !height) return;
    wallpaperContext.clearRect(0, 0, width, height);
    const playing = !audio.paused && analyser && frequencyData;
    if (playing) analyser.getByteFrequencyData(frequencyData);
    let bass = 0;
    if (playing && frequencyData) {
      for (let i = 0; i < Math.min(18, frequencyData.length); i += 1) bass += frequencyData[i];
      bass = bass / (18 * 255);
    }
    const accent = getComputedStyle(document.body).getPropertyValue('--accent-rgb').trim() || '168,139,255';
    if (preferences.wallpaper === 'orbit') {
      const cx = width * .71; const cy = height * .52; const scale = Math.min(width, height) * .22;
      for (let ring = 0; ring < 4; ring += 1) {
        wallpaperContext.beginPath();
        wallpaperContext.ellipse(cx, cy, scale * (1 + ring * .31) + bass * 15, scale * (.31 + ring * .08) + bass * 7, -.22, 0, Math.PI * 2);
        wallpaperContext.strokeStyle = `rgba(${accent},${.08 - ring * .012 + bass * .08})`;
        wallpaperContext.lineWidth = 1;
        wallpaperContext.stroke();
      }
      const glow = wallpaperContext.createRadialGradient(cx, cy, 0, cx, cy, scale * (1.25 + bass * .2));
      glow.addColorStop(0, `rgba(${accent},${.1 + bass * .16})`); glow.addColorStop(1, `rgba(${accent},0)`);
      wallpaperContext.fillStyle = glow; wallpaperContext.fillRect(cx - scale * 1.4, cy - scale * 1.4, scale * 2.8, scale * 2.8);
      const orbitX = cx + Math.cos(time / 2600) * scale * 1.32; const orbitY = cy + Math.sin(time / 2600) * scale * .38;
      wallpaperContext.beginPath(); wallpaperContext.arc(orbitX, orbitY, 2.5 + bass * 3, 0, Math.PI * 2); wallpaperContext.fillStyle = `rgba(${accent},${.35 + bass * .4})`; wallpaperContext.fill();
    } else {
      const cx = width * .76; const cy = height * .48; const reach = Math.max(width, height) * .7;
      for (let layer = 0; layer < 3; layer += 1) {
        const drift = Math.sin(time / (3700 + layer * 900) + layer * 1.5) * 20;
        const swell = bass * (18 + layer * 8);
        const glow = wallpaperContext.createRadialGradient(cx - drift, cy + layer * 30, 8, cx - drift, cy + layer * 30, reach * (.38 + layer * .1) + swell);
        glow.addColorStop(0, `rgba(${accent},${.034 + bass * .045 - layer * .006})`); glow.addColorStop(1, `rgba(${accent},0)`);
        wallpaperContext.fillStyle = glow; wallpaperContext.fillRect(0, 0, width, height);
      }
      if (playing) {
        wallpaperContext.beginPath();
        const left = width * .51; const baseY = height * .71;
        for (let x = 0; x <= 48; x += 1) {
          const index = Math.floor(x / 48 * frequencyData.length * .48);
          const y = baseY - frequencyData[index] / 255 * height * .11;
          const px = left + x / 48 * width * .49;
          if (x === 0) wallpaperContext.moveTo(px, y); else wallpaperContext.lineTo(px, y);
        }
        wallpaperContext.strokeStyle = `rgba(${accent},${.06 + bass * .09})`; wallpaperContext.lineWidth = 1.3; wallpaperContext.stroke();
      }
    }
  }

  function animate(time) {
    if (animate.lastFrame && time - animate.lastFrame < 32) {
      animationFrame = window.requestAnimationFrame(animate);
      return;
    }
    animate.lastFrame = time;
    sizeCanvas(visualizerCanvas, visualizerContext, visualizerSize);
    sizeCanvas(wallpaperCanvas, wallpaperContext, wallpaperSize);
    drawVisualizer(time);
    drawWallpaper(time);
    animationFrame = window.requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    sizeCanvas(visualizerCanvas, visualizerContext, visualizerSize);
    sizeCanvas(wallpaperCanvas, wallpaperContext, wallpaperSize);
  });
  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(animationFrame);
    tracks.forEach((track) => URL.revokeObjectURL(track.url));
    if (audioContext && audioContext.state !== 'closed') audioContext.close();
  });

  applyPreferences();
  updateClocks();
  window.setInterval(updateClocks, 1000);
  loadServerInfo();
  renderPlaylist();
  animationFrame = window.requestAnimationFrame(animate);
})();
