(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const APP_LIST = [
    ['dj', 'DJ Studio', '♫', 'violet', 'Mix tracks across two or four decks'],
    ['studio', 'Audio Studio', '▥', 'cyan', 'Record and edit multitrack audio'],
    ['library', 'Music Library', '▤', 'blue', 'Browse tracks and saved projects'],
    ['files', 'File Manager', '▰', 'amber', 'Manage local audio and project files'],
    ['monitor', 'System Monitor', '◴', 'green', 'View live host resource telemetry'],
    ['process', 'Process Manager', '▤', 'blue', 'Inspect local workspace processes'],
    ['memory', 'Memory Manager', '▥', 'cyan', 'Review host memory use'],
    ['scheduler', 'CPU Scheduler', '◷', 'amber', 'Explore scheduling simulations'],
    ['resources', 'Resource Manager', '◉', 'green', 'Inspect browser and app resources'],
    ['firewall', 'Firewall Manager', '⬡', 'red', 'Edit simulated local firewall rules'],
    ['system', 'System Information', '⌘', 'slate', 'Host and runtime details'],
    ['activity', 'Activity Logs', '≋', 'blue', 'Review recent desktop activity'],
    ['settings', 'Settings', '⚙', 'slate', 'Personalize your workspace']
  ];
  const APPS = Object.fromEntries(APP_LIST.map((item) => [item[0], { id: item[0], name: item[1], icon: item[2], tone: item[3], description: item[4] }]));
  const state = {
    tracks: [], projects: [], settings: { theme: 'dark', shortcuts: true }, windows: new Map(), z: 10, activeApp: null,
    deckCount: 2, decks: { A: { trackId: 1, playing: false, volume: 0.82, pitch: 0 }, B: { trackId: 5, playing: false, volume: 0.76, pitch: 0 }, C: { trackId: 6, playing: false, volume: 0.76, pitch: 0 }, D: { trackId: 7, playing: false, volume: 0.76, pitch: 0 } },
    master: 0.8, crossfade: 0.5, libraryGenre: 'All', librarySearch: '', studio: { id: null, name: 'Untitled Audio Project', clips: [], effects: { Reverb: true, Delay: false, Equalizer: true }, recording: false, playing: false, undo: [], redo: [] }, metrics: null, schedulerMode: 'FCFS'
  };
  const audio = new window.TuneAudioEngine();
  const windowsEl = $('#windows');

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function toast(message, tone = '') {
    const el = document.createElement('div'); el.className = `toast ${tone}`; el.textContent = message;
    $('#toast-region').append(el); window.setTimeout(() => el.remove(), 3200);
  }
  function log(message, category = 'desktop', level = 'info') {
    api('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, level, message }) }).catch(() => {});
  }
  function duration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }
  function colorFor(track) { return track?.color || '#69d9d2'; }
  function trackById(id) { return state.tracks.find((track) => Number(track.id) === Number(id)); }
  function waveBars(seed = 1, count = 46) {
    let n = seed * 4321 + 55;
    return `<div class="wave-bars">${Array.from({ length: count }, () => { n = (n * 16807) % 2147483647; return `<i style="--h:${12 + (n % 89)}%"></i>`; }).join('')}</div>`;
  }
  function formatTime(value) {
    const date = new Date(value || Date.now());
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  async function loadData() {
    const [tracks, projects, settings] = await Promise.all([
      api('/api/tracks'), api('/api/projects'), api('/api/settings')
    ]);
    state.tracks = tracks; state.projects = projects;
    if (!state.studio.id && projects[0]) { state.studio.id = projects[0].id; state.studio.name = projects[0].name; state.studio.clips = projects[0].data?.clips || []; }
    Object.assign(state.settings, settings);
    document.body.classList.toggle('theme-light', state.settings.theme === 'light');
  }

  function iconMarkup(app) { return `<span class="window-app-icon ${app.tone}">${app.icon}</span>`; }
  function openApp(id) {
    hideOverlays();
    if (id === 'launcher') { showOverlay('launcher'); return; }
    if (!APPS[id]) return;
    if (state.windows.has(id)) {
      const existing = state.windows.get(id);
      existing.classList.remove('minimized'); existing.style.zIndex = ++state.z;
      state.activeApp = id; updateActive();
      if (id === 'monitor' || id === 'memory' || id === 'system') refreshMetrics();
      return;
    }
    const app = APPS[id];
    const win = document.createElement('section');
    const small = ['settings', 'system', 'memory', 'scheduler', 'firewall', 'activity'].includes(id);
    win.className = `app-window ${small ? 'small-window' : ''}`;
    win.dataset.window = id; win.style.zIndex = ++state.z;
    win.innerHTML = `<header class="window-titlebar"><span class="window-app-icon ${app.tone}">${app.icon}</span><div class="window-heading"><strong>${esc(app.name)}</strong><small>${esc(app.description)}</small></div><div class="window-actions"><button data-window-action="minimize" aria-label="Minimize">—</button><button data-window-action="maximize" aria-label="Maximize">□</button><button class="close-window" data-window-action="close" aria-label="Close">×</button></div></header><div class="window-content">${appView(id)}</div>`;
    windowsEl.append(win); state.windows.set(id, win); state.activeApp = id; updateActive();
    if (id === 'monitor' || id === 'memory' || id === 'system') refreshMetrics();
    if (id === 'activity') refreshActivity();
    if (id === 'firewall') refreshFirewall();
    if (id === 'library') refreshProjects();
    if (id === 'files') refreshProjects();
    log(`Opened ${app.name}`);
  }
  function closeApp(id) {
    const win = state.windows.get(id); if (!win) return;
    win.remove(); state.windows.delete(id);
    if (id === 'dj') for (const deck of ['A', 'B', 'C', 'D']) audio.stop(deck);
    if (id === 'studio' && state.studio.playing) audio.stop('studio');
    state.activeApp = [...state.windows.keys()].at(-1) || null; updateActive();
  }
  function updateActive() {
    $$('.dock-app').forEach((el) => el.classList.toggle('active', el.dataset.app === state.activeApp));
    $$('.shortcut').forEach((el) => el.classList.toggle('active', el.dataset.app === state.activeApp));
    $('#topbar-app').textContent = state.activeApp ? APPS[state.activeApp].name : 'Desktop';
    $('.desktop-welcome').style.opacity = state.windows.size ? '0' : '1';
    $('.desktop-welcome').style.pointerEvents = state.windows.size ? 'none' : 'auto';
  }
  function refreshApp(id) {
    const win = state.windows.get(id); if (win) $('.window-content', win).innerHTML = appView(id);
  }
  function showOverlay(id) {
    hideOverlays(); const el = $(`#${id}`); if (el) { el.hidden = false; if (id === 'launcher') $('#launcher-search').focus(); if (id === 'search') $('#global-search').focus(); }
    if (id === 'notifications') refreshNotifications();
  }
  function hideOverlays() { $$('.overlay').forEach((item) => { item.hidden = true; }); }
  function updateClock() {
    const now = new Date(); const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
    $('#clock').textContent = time; $('#dock-clock').textContent = time; $('#date').textContent = day; $('#dock-date').textContent = day;
  }
  function renderLauncher(filter = '') {
    const q = filter.toLowerCase();
    const items = APP_LIST.filter((app) => `${app[1]} ${app[4]}`.toLowerCase().includes(q));
    $('#launcher-results').innerHTML = items.map(([id, name, icon, tone, description]) => `<button class="app-tile" data-app="${id}" title="${esc(description)}"><span class="${tone}">${icon}</span><small>${esc(name)}</small></button>`).join('') || '<p class="muted">No matching apps.</p>';
  }
  function renderSearch(query = '') {
    const q = query.toLowerCase().trim(); if (!q) { $('#search-results').innerHTML = '<p class="muted">Search apps, tracks, and projects.</p>'; return; }
    const apps = APP_LIST.filter((app) => `${app[1]} ${app[4]}`.toLowerCase().includes(q)).slice(0, 4);
    const tracks = state.tracks.filter((track) => `${track.title} ${track.artist} ${track.genre}`.toLowerCase().includes(q)).slice(0, 5);
    const projects = state.projects.filter((project) => project.name.toLowerCase().includes(q)).slice(0, 3);
    const out = [
      ...apps.map(([id, name, icon]) => `<button class="search-result" data-app="${id}"><span>${icon}</span><b>${esc(name)}</b><small>App</small></button>`),
      ...tracks.map((track) => `<button class="search-result" data-action="load-track" data-track="${track.id}" data-deck="A"><span>♫</span><b>${esc(track.title)}</b><small>Track · ${esc(track.artist)}</small></button>`),
      ...projects.map((project) => `<button class="search-result" data-app="library"><span>▱</span><b>${esc(project.name)}</b><small>Project</small></button>`)
    ].join('');
    $('#search-results').innerHTML = out || '<p class="muted">Nothing found.</p>';
  }
  async function refreshNotifications() {
    try {
      const logs = await api('/api/activity');
      $('#notification-list').innerHTML = logs.slice(0, 7).map((item) => `<div class="notification-item"><b>${esc(item.category)}</b><p>${esc(item.message)}</p><small>${formatTime(item.created_at)}</small></div>`).join('') || '<p class="muted">You\'re all caught up.</p>';
    } catch { /* Desktop still works offline. */ }
  }

  function appView(id) {
    if (id === 'dj') return renderDj();
    if (id === 'studio') return renderStudio();
    if (id === 'library') return renderLibrary();
    if (id === 'files') return renderFiles();
    if (id === 'settings') return renderSettings();
    if (id === 'monitor') return renderMonitor();
    if (id === 'process') return renderProcess();
    if (id === 'memory') return renderMemory();
    if (id === 'scheduler') return renderScheduler();
    if (id === 'resources') return renderResources();
    if (id === 'firewall') return renderFirewall();
    if (id === 'system') return renderSystem();
    if (id === 'activity') return renderActivity();
    return '<p class="empty-state">This app is not available.</p>';
  }
  function renderDj() {
    const deckIds = ['A', 'B', ...(state.deckCount === 4 ? ['C', 'D'] : [])];
    return `<div class="app-view dj-view"><div class="view-header"><div><span class="eyebrow">DJ WORKSPACE</span><h2>DJ Studio</h2><p>Load tracks, shape the blend, and save your mix.</p></div><div class="view-actions"><label class="pill"><input type="radio" name="deck-count" value="2" ${state.deckCount === 2 ? 'checked' : ''} data-action="deck-count"> 2 decks</label><label class="pill"><input type="radio" name="deck-count" value="4" ${state.deckCount === 4 ? 'checked' : ''} data-action="deck-count"> 4 decks</label><button class="small-button" data-action="import-audio">＋ Import</button><button class="small-button primary" data-action="save-mix">Save mix</button></div></div><div class="toolbar"><span class="pill active">● Audio engine ready</span><span class="muted">Preview mode synthesizes a short beat for demo tracks. Imported audio plays from local storage.</span></div><div class="deck-grid ${state.deckCount === 4 ? 'four' : ''}">${deckIds.map(renderDeck).join('')}</div><div class="mix-footer"><strong>MASTER</strong><div class="slider-line" style="flex:0 0 130px;margin:0"><input type="range" min="0" max="100" value="${Math.round(state.master * 100)}" data-action="master"><output>${Math.round(state.master * 100)}%</output></div><div class="crossfader"><span>A</span><input type="range" min="0" max="100" value="${Math.round(state.crossfade * 100)}" data-action="crossfade"><span>B</span></div><button class="small-button icon" data-action="stop-all">Stop all</button></div><div class="deck-library"><div class="view-header"><div><span class="eyebrow">TRACK CRATE</span><h2 style="font-size:13px">Library tracks</h2></div><span class="muted">${state.tracks.length} tracks</span></div>${renderTrackTable(state.tracks.slice(0, 8), 'dj')}</div></div>`;
  }
  function renderDeck(id) {
    const deck = state.decks[id]; const track = trackById(deck.trackId) || state.tracks[0];
    const bpm = track?.bpm || 120; const displayTitle = track?.title || 'No track loaded';
    return `<article class="deck" data-deck-card="${id}"><div class="deck-top"><span class="deck-label">DECK ${id}</span><span class="pill">${deck.playing ? 'PLAYING' : 'STANDBY'}</span></div><div class="deck-track"><span class="cover-art" style="background:${colorFor(track)}">♫</span><div><h3>${esc(displayTitle)}</h3><p>${esc(track?.artist || 'Choose from track crate')}</p></div><select class="select-control" data-action="deck-load" data-deck="${id}" aria-label="Load track on deck ${id}"><option value="">Load track…</option>${state.tracks.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(deck.trackId) ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select></div><div class="deck-metrics"><span>BPM <b>${bpm}</b></span><span>KEY <b>${track?.source === 'imported' ? '—' : '8A'}</b></span><span>${duration(track?.duration_seconds)}</span></div><div style="color:${colorFor(track)}">${waveBars(Number(track?.id || id.charCodeAt(0)), 56)}</div><div class="deck-controls"><button class="round-control" data-action="cue" data-deck="${id}" title="Cue">C</button><button class="round-control" data-action="stop-deck" data-deck="${id}" title="Stop">■</button><button class="round-control play" data-action="play-deck" data-deck="${id}" title="Play">${deck.playing ? 'Ⅱ' : '▶'}</button><button class="round-control" data-action="sync" data-deck="${id}" title="Sync tempo">⟲</button><span class="muted">${track?.audioUrl ? 'LOCAL AUDIO' : 'SYNTH PREVIEW'}</span></div><div class="slider-line"><span>LEVEL</span><input type="range" min="0" max="100" value="${Math.round(deck.volume * 100)}" data-action="deck-volume" data-deck="${id}"><output>${Math.round(deck.volume * 100)}%</output></div><div class="slider-line"><span>PITCH</span><input type="range" min="-12" max="12" value="${deck.pitch}" data-action="deck-pitch" data-deck="${id}"><output>${deck.pitch > 0 ? '+' : ''}${deck.pitch}%</output></div></article>`;
  }
  function renderTrackTable(tracks, context = 'library') {
    if (!tracks.length) return '<div class="empty-state"><strong>No tracks yet</strong>Import a local audio file to add it to your library.</div>';
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>TRACK</th><th>GENRE</th><th>BPM</th><th>DURATION</th><th>SOURCE</th><th>ACTIONS</th></tr></thead><tbody>${tracks.map((track) => `<tr data-search="${esc(`${track.title} ${track.artist}`.toLowerCase())}"><td><div class="track-cell"><span class="cover-art" style="background:${colorFor(track)}">♫</span><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></span></div></td><td><span class="tag">${esc(track.genre)}</span></td><td>${track.bpm || '—'}</td><td class="mono">${duration(track.duration_seconds)}</td><td>${track.source === 'imported' ? 'Imported' : 'Library'}</td><td><div class="view-actions"><button class="small-button icon" data-action="load-track" data-track="${track.id}" data-deck="A" title="Load in DJ Studio">Load</button>${context === 'library' ? `<button class="small-button icon" data-action="rename-track" data-track="${track.id}">Rename</button><button class="small-button icon danger" data-action="delete-track" data-track="${track.id}">Delete</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderLibrary() {
    const genres = ['All', ...new Set(state.tracks.map((track) => track.genre))];
    const filtered = state.tracks.filter((track) => (state.libraryGenre === 'All' || track.genre === state.libraryGenre) && `${track.title} ${track.artist}`.toLowerCase().includes(state.librarySearch.toLowerCase()));
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">YOUR COLLECTION</span><h2>Music Library</h2><p>Keep local imports and demo tracks organized.</p></div><div class="view-actions"><button class="small-button" data-action="import-audio">＋ Import audio</button><button class="small-button primary" data-app="studio">Open Audio Studio ↗</button></div></div><div class="stat-grid"><div class="stat-card"><small>TRACKS</small><strong>${state.tracks.length}</strong><em>in this workspace</em></div><div class="stat-card"><small>IMPORTED</small><strong>${state.tracks.filter((t) => t.source === 'imported').length}</strong><em>stored on this device</em></div><div class="stat-card"><small>GENRES</small><strong>${new Set(state.tracks.map((t) => t.genre)).size}</strong><em>across your library</em></div><div class="stat-card"><small>PROJECTS</small><strong>${state.projects.length}</strong><em>saved in SQLite</em></div></div><div class="toolbar"><input class="search-input" type="search" placeholder="Search tracks…" value="${esc(state.librarySearch)}" data-action="library-search"><div class="filter-row">${genres.map((genre) => `<button class="pill ${state.libraryGenre === genre ? 'active' : ''}" data-action="genre" data-genre="${esc(genre)}">${esc(genre)}</button>`).join('')}</div></div>${renderTrackTable(filtered)}<div class="deck-library"><div class="view-header"><div><span class="eyebrow">RECENT WORK</span><h2 style="font-size:13px">Projects</h2></div><button class="small-button" data-action="new-project">＋ New project</button></div><div id="project-list">${renderProjectList()}</div></div></div>`;
  }
  function renderProjectList() {
    if (!state.projects.length) return '<p class="muted">No saved projects yet.</p>';
    return `<div class="file-list">${state.projects.map((project) => `<div class="file-item"><span class="folder-icon">${project.kind === 'mix' ? '♫' : '▤'}</span><div><strong>${esc(project.name)}</strong><small>${project.kind === 'mix' ? 'DJ mix' : 'Audio Studio'} · ${new Date(project.updated_at).toLocaleDateString()}</small></div><div class="item-actions"><button class="small-button icon" data-action="open-project" data-project="${project.id}">Open</button></div></div>`).join('')}</div>`;
  }
  async function refreshProjects() {
    try { state.projects = await api('/api/projects'); }
    catch { return; }
    const win = state.windows.get('library'); if (win) { const list = $('#project-list', win); if (list) list.innerHTML = renderProjectList(); }
  }
  function renderFiles() {
    const imported = state.tracks.filter((track) => track.source === 'imported');
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">LOCAL STORAGE</span><h2>File Manager</h2><p>Audio is stored in TuneOS/storage/audio on this machine.</p></div><div class="view-actions"><button class="small-button" data-action="import-audio">＋ Upload audio</button></div></div><div class="toolbar"><span class="pill active">/storage/audio</span><span class="toolbar-spacer"></span><span class="system-badge">LOCAL FILES</span></div><div class="file-list"><div class="file-item"><span class="folder-icon">▱</span><div><strong>audio</strong><small>${imported.length} imported files · private to this workspace</small></div><div class="item-actions"><button class="small-button icon" data-app="library">Browse</button></div></div><div class="file-item"><span class="folder-icon">▤</span><div><strong>projects</strong><small>${state.projects.length} SQLite project records</small></div><div class="item-actions"><button class="small-button icon" data-app="library">Browse</button></div></div></div><div class="surface-card" style="margin-top:14px"><h3>Imported audio</h3>${imported.length ? renderTrackTable(imported, 'files') : '<div class="empty-state"><strong>Your storage is empty</strong>Import audio to store and play it locally.</div>'}</div><div class="toast-note">Uploads are kept under this TuneOS project folder. They are not sent to a cloud service.</div></div>`;
  }

  function studioVisibleClips() {
    if (state.studio.clips.length) return state.studio.clips;
    return [
      { id: 'demo-1', name: 'Lead vocal', trackId: 1, at: 0, lane: 0, demo: true },
      { id: 'demo-2', name: 'Harmony take', trackId: 4, at: 9, lane: 1, demo: true },
      { id: 'demo-3', name: 'Imported ambience', trackId: 3, at: 18, lane: 2, demo: true }
    ];
  }
  function renderStudio() {
    const clips = studioVisibleClips();
    const lanes = [0, 1, 2, 3].map((lane) => clips.filter((clip) => Number(clip.lane || 0) === lane));
    const names = ['Lead vocal', 'Harmony take', 'Imported ambience', 'New track'];
    const seconds = Array.from({ length: 9 }, (_v, i) => `<span>${String(i * 8).padStart(2, '0')}:00</span>`).join('');
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">MULTITRACK WORKSPACE</span><h2>${esc(state.studio.name)}</h2><p>Record, arrange, and export local audio.</p></div><div class="view-actions"><button class="small-button" data-action="new-project">New Project</button><button class="small-button" data-action="save-project">Save Project</button><button class="small-button primary" data-action="export-audio">Export Audio</button></div></div><div class="studio-layout"><div class="timeline-card"><div class="timeline-toolbar"><button class="small-button ${state.studio.recording ? 'danger' : ''}" data-action="record">${state.studio.recording ? '● Recording…' : '● Record'}</button><button class="small-button" data-action="pause-studio">Ⅱ Pause</button><button class="small-button" data-action="stop-studio">■ Stop</button><button class="small-button primary" data-action="play-studio">${state.studio.playing ? 'Ⅱ Pause' : '▶ Play'}</button><span class="dock-spacer"></span><button class="small-button icon" data-action="undo">↶</button><button class="small-button icon" data-action="redo">↷</button><button class="small-button icon" data-action="trim">Trim</button><button class="small-button icon" data-action="split">Split</button><button class="small-button icon danger" data-action="delete-clip">Delete</button><button class="small-button icon" data-action="import-audio">＋</button></div><div class="timeline-ruler">${seconds}</div>${lanes.map((laneClips, index) => `<div class="timeline-track"><div class="timeline-track-label"><span>${esc(laneClips[0]?.name || names[index])}</span><small>● ${index === 0 ? 'Vocal' : index === 1 ? 'Harmony' : 'Audio'}</small></div><div class="timeline-lane">${laneClips.length ? laneClips.map((clip) => { const track = trackById(clip.trackId); return `<button class="clip" data-action="select-clip" data-clip="${esc(clip.id)}" style="flex:${Math.max(1, Number(track?.duration_seconds || 15) / 15)}"><strong>${esc(track?.title || clip.name)}${clip.demo ? ' · DEMO' : ''}</strong>${waveBars(track?.id || index + 4, 32)}</button>`; }).join('') : `<span class="muted">Drop imported audio here or use + to add a track.</span>`}</div></div>`).join('')}</div><aside class="studio-inspector"><h3>Inspector</h3><span class="eyebrow">MIC INPUT</span><div class="setting-line"><div><strong>Default input</strong><small>Browser microphone access</small></div><span class="pill">Ready</span></div><span class="eyebrow" style="margin-top:13px">AUDIO EFFECTS</span>${Object.entries(state.studio.effects).map(([name, enabled]) => `<div class="effect-chip"><span>${name}</span><button class="toggle ${enabled ? 'on' : ''}" data-action="effect-toggle" data-effect="${name}" aria-label="Toggle ${name}"></button></div>`).join('')}<div class="file-drop"><b>Import audio</b>Supported audio formats stay on this device.<button class="small-button" style="margin-top:8px" data-action="import-audio">Choose file</button></div><div class="toast-note">Effect controls are UI foundations; processing is not applied to WAV export yet.</div></aside></div></div>`;
  }
  function renderSettings() {
    const theme = state.settings.theme || 'dark';
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">PREFERENCES</span><h2>Settings</h2><p>Personalize this local workspace.</p></div><span class="pill active">LOCAL PROFILE</span></div><div class="toolbar">${['Appearance', 'Desktop', 'Audio', 'Privacy', 'About'].map((tab, index) => `<button class="pill ${index === 0 ? 'active' : ''}" data-action="settings-tab" data-tab="${tab}">${tab}</button>`).join('')}</div><div class="surface-card"><h3>Appearance</h3><div class="setting-line"><div><strong>Color theme</strong><small>Switch between dark and light workspace styling.</small></div><button class="small-button" data-theme-toggle>${theme === 'dark' ? 'Dark mode' : 'Light mode'} · Change</button></div><div class="setting-line"><div><strong>App launcher shortcut</strong><small>Open search with Ctrl / ⌘ + K.</small></div><button class="toggle ${state.settings.shortcuts !== false ? 'on' : ''}" data-action="toggle-shortcut" aria-label="Toggle keyboard shortcut"></button></div><div class="setting-line"><div><strong>Audio engine</strong><small>Browser Web Audio API. Starts after a play action.</small></div><span class="good-label">● Ready</span></div><div class="setting-line"><div><strong>Local audio storage</strong><small>TuneOS/storage/audio · SQLite metadata</small></div><span class="pill">On this device</span></div></div><div class="surface-card" style="margin-top:12px"><h3>Network access</h3><p class="muted">The server listens on 127.0.0.1 by default. See README for trusted LAN setup and exact-IP allowlisting.</p><span class="system-badge">NO OS FIREWALL CHANGES</span></div></div>`;
  }
  function renderMonitor() {
    const m = state.metrics || {};
    const used = m.memoryTotal ? Math.round(m.memoryUsed / m.memoryTotal * 100) : 0;
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">LIVE HOST TELEMETRY</span><h2>System Monitor</h2><p>Metrics reported by the Node.js host process.</p></div><button class="small-button" data-action="refresh-metrics">Refresh</button></div><div class="stat-grid"><div class="stat-card"><small>CPU CORES</small><strong>${m.cpus ?? '—'}</strong><em>${esc(m.architecture || 'Loading host')}</em></div><div class="stat-card"><small>MEMORY USED</small><strong>${used}%</strong><em>${m.memoryTotal ? `${(m.memoryUsed / 1073741824).toFixed(1)} of ${(m.memoryTotal / 1073741824).toFixed(1)} GB` : 'Waiting for API'}</em></div><div class="stat-card"><small>HOST UPTIME</small><strong>${m.uptimeSeconds ? `${Math.floor(m.uptimeSeconds / 3600)}h ${Math.floor(m.uptimeSeconds / 60) % 60}m` : '—'}</strong><em>system uptime</em></div><div class="stat-card"><small>TUNEOS</small><strong>${esc(m.node || '—')}</strong><em>Node.js runtime</em></div></div><div class="two-col"><div class="surface-card"><h3>Memory pressure</h3><div class="bar-row"><span>Used</span><div class="meter"><i style="width:${used}%"></i></div><b>${used}%</b></div><div class="bar-row"><span>Free</span><div class="meter"><i style="width:${100 - used}%"></i></div><b>${100 - used}%</b></div><p class="toast-note">OS memory and load averages are host-level snapshots, not per-app profiling.</p></div><div class="surface-card"><h3>System load</h3><div class="bar-row"><span>1 minute</span><div class="meter"><i style="width:${Math.min(100, (m.loadAverage?.[0] || 0) * 15)}%"></i></div><b>${m.loadAverage?.[0]?.toFixed(2) ?? '—'}</b></div><div class="bar-row"><span>5 minutes</span><div class="meter"><i style="width:${Math.min(100, (m.loadAverage?.[1] || 0) * 15)}%"></i></div><b>${m.loadAverage?.[1]?.toFixed(2) ?? '—'}</b></div></div></div></div>`;
  }
  function renderProcess() {
    const items = [...state.windows.keys()].map((id) => ({ name: APPS[id].name, type: 'Desktop app', status: 'Active' }));
    items.push({ name: 'Express local API', type: 'Node.js', status: 'Running' }, { name: 'SQLite database', type: 'Local data', status: 'Ready' });
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">WORKSPACE PROCESSES</span><h2>Process Manager</h2><p>Applications and services active in this TuneOS session.</p></div><span class="pill active">${items.length} ACTIVE</span></div><div class="toolbar"><span class="muted">Process control is limited to TuneOS windows.</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>NAME</th><th>TYPE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${items.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.type)}</td><td><span class="good-label">● ${esc(item.status)}</span></td><td><span class="muted">Managed</span></td></tr>`).join('')}</tbody></table></div><div class="toast-note">Host system services are visible only as platform telemetry; this app cannot terminate OS processes.</div></div>`;
  }
  function renderMemory() {
    const m = state.metrics || {}; const used = m.memoryTotal ? Math.round(m.memoryUsed / m.memoryTotal * 100) : 0;
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">HOST MEMORY</span><h2>Memory Manager</h2><p>Read-only memory information from Node.js.</p></div><button class="small-button" data-action="refresh-metrics">Refresh</button></div><div class="surface-card"><div class="view-header"><div><h2 style="font-size:13px">System memory</h2><p>${m.memoryTotal ? `${(m.memoryUsed / 1073741824).toFixed(2)} GB used of ${(m.memoryTotal / 1073741824).toFixed(2)} GB` : 'Loading telemetry…'}</p></div><strong>${used}%</strong></div><div class="meter" style="height:10px"><i style="width:${used}%"></i></div><div class="bar-row"><span>Available</span><div class="meter"><i style="width:${100 - used}%"></i></div><b>${100 - used}%</b></div></div><div class="surface-card" style="margin-top:12px"><h3>TuneOS process</h3><div class="bar-row"><span>RSS</span><div class="meter"><i style="width:${Math.min(100, Math.round((processMemoryEstimate() / Math.max(1, m.memoryTotal || 1)) * 100))}%"></i></div><b>browser</b></div><p class="toast-note">Browser memory is not exposed precisely to a normal web page; per-tab footprint is estimated by your browser.</p></div></div>`;
  }
  function processMemoryEstimate() { return 0; }
  function renderScheduler() {
    const jobs = [{ name: 'Audio playback buffer', burst: 4 }, { name: 'Waveform render', burst: 7 }, { name: 'Library indexing', burst: 3 }, { name: 'Project autosave', burst: 2 }];
    let clock = 0; let schedule = [];
    if (state.schedulerMode === 'FCFS') schedule = jobs.map((job) => { const start = clock; clock += job.burst; return { ...job, start, end: clock }; });
    else {
      const queue = jobs.map((job) => ({ ...job, left: job.burst }));
      while (queue.some((job) => job.left > 0)) for (const job of queue) if (job.left > 0) { const slice = Math.min(job.left, 2); schedule.push({ ...job, start: clock, end: clock + slice }); job.left -= slice; clock += slice; }
    }
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">SIMULATION</span><h2>CPU Scheduler</h2><p>Compare simple scheduling strategies for example audio tasks.</p></div><select class="select-control" data-action="scheduler-mode"><option ${state.schedulerMode === 'FCFS' ? 'selected' : ''}>FCFS</option><option ${state.schedulerMode === 'Round Robin' ? 'selected' : ''}>Round Robin</option></select></div><div class="surface-card"><h3>${state.schedulerMode} schedule · time units</h3>${schedule.map((job) => `<div class="bar-row"><span>${esc(job.name)}</span><div class="meter"><i style="margin-left:${job.start / Math.max(1, clock) * 100}%;width:${Math.max(5, (job.end - job.start) / Math.max(1, clock) * 100)}%"></i></div><b>${job.start}–${job.end}</b></div>`).join('')}</div><div class="toast-note">Illustrative scheduling model only; it does not change how Ubuntu or your computer schedules work.</div></div>`;
  }
  function renderResources() {
    const m = state.metrics || {};
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">RESOURCE OVERVIEW</span><h2>Resource Manager</h2><p>Browser, local service, and host resources.</p></div><button class="small-button" data-action="refresh-metrics">Refresh</button></div><div class="stat-grid"><div class="stat-card"><small>WINDOWS OPEN</small><strong>${state.windows.size}</strong><em>desktop views</em></div><div class="stat-card"><small>TRACKS</small><strong>${state.tracks.length}</strong><em>SQLite catalog</em></div><div class="stat-card"><small>PROJECTS</small><strong>${state.projects.length}</strong><em>SQLite records</em></div><div class="stat-card"><small>SERVER UPTIME</small><strong>${m.processUptimeSeconds ? `${Math.floor(m.processUptimeSeconds / 60)}m` : '—'}</strong><em>Node process</em></div></div><div class="surface-card"><h3>Resource providers</h3><div class="setting-line"><div><strong>Web Audio</strong><small>Browser audio graph and imported file playback</small></div><span class="pill">On demand</span></div><div class="setting-line"><div><strong>SQLite</strong><small>Local metadata and project records</small></div><span class="pill">Ready</span></div><div class="setting-line"><div><strong>Host memory</strong><small>System-level values from the Node.js host</small></div><span class="pill">${m.memoryTotal ? 'Available' : 'Loading'}</span></div></div></div>`;
  }
  function renderFirewall() {
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">SIMULATED POLICY DESK</span><h2>Firewall Manager</h2><p>These rules are saved in SQLite for UI demonstration only.</p></div><span class="system-badge">OS FIREWALL UNCHANGED</span></div><div class="surface-card"><h3>Add a display rule</h3><form data-form="firewall" class="form-row"><input class="text-input" name="name" placeholder="Rule name" style="flex:1;min-width:120px"><input class="text-input" name="address" placeholder="IP address / CIDR" required style="flex:1;min-width:120px"><input class="number-input" name="port" placeholder="Port"><select class="select-control" name="action"><option value="allow">Allow</option><option value="block">Block</option></select><button class="small-button primary">Add rule</button></form></div><div id="firewall-rules" class="surface-card" style="margin-top:12px"><p class="muted">Loading local rules…</p></div><div class="toast-note">Actual network access is controlled by HOST, ALLOWED_CLIENT_IPS, Windows Firewall, and UFW. See README before opening this server to a LAN.</div></div>`;
  }
  function renderSystem() {
    const m = state.metrics || {};
    return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">HOST DETAILS</span><h2>System Information</h2><p>Values are read from the Express host environment.</p></div><span class="pill">${m.wsl ? 'WSL DETECTED' : 'LOCAL HOST'}</span></div><div class="surface-card">${[['Platform', m.platform], ['Release', m.release], ['Architecture', m.architecture], ['Node.js', m.node], ['Hostname', m.hostname], ['CPU cores', m.cpus], ['WSL environment', m.wsl ? 'Detected' : 'Not detected'], ['TuneOS API', 'Express 5 · SQLite']].map(([label, value]) => `<div class="setting-line"><div><strong>${esc(label)}</strong></div><span class="mono muted">${esc(value ?? 'Loading…')}</span></div>`).join('')}</div></div>`;
  }
  function renderActivity() { return `<div class="app-view"><div class="view-header"><div><span class="eyebrow">LOCAL EVENT HISTORY</span><h2>Activity Logs</h2><p>Recent TuneOS actions stored in SQLite.</p></div><button class="small-button" data-action="refresh-activity">Refresh</button></div><div id="activity-list" class="surface-card"><p class="muted">Loading activity…</p></div><div class="toast-note">Logs contain app actions, not audio file contents.</div></div>`; }

  async function refreshMetrics() {
    try { state.metrics = await api('/api/system/metrics'); }
    catch (error) { toast(`Host metrics unavailable: ${error.message}`); return; }
    for (const id of ['monitor', 'memory', 'system', 'resources']) refreshApp(id);
  }
  async function refreshActivity() {
    const win = state.windows.get('activity'); if (!win) return;
    try {
      const entries = await api('/api/activity');
      const target = $('#activity-list', win);
      if (target) target.innerHTML = entries.length ? entries.map((item) => `<div class="log-line"><time>${new Date(item.created_at).toLocaleString()}</time><span class="${item.level === 'warning' ? 'warning' : ''}">${esc(item.category)}</span><span>${esc(item.message)}</span></div>`).join('') : '<p class="muted">No activity logged yet.</p>';
    } catch (error) { toast(error.message); }
  }
  async function refreshFirewall() {
    const win = state.windows.get('firewall'); if (!win) return;
    try {
      const data = await api('/api/firewall');
      const target = $('#firewall-rules', win);
      if (target) target.innerHTML = `<div class="view-header"><div><h3 style="margin:0">Saved display rules</h3><p class="muted">Runtime API allowlist: ${data.allowlist.length ? esc(data.allowlist.join(', ')) : 'loopback only'}</p></div><span class="system-badge">SIMULATION ONLY</span></div>${data.rules.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>NAME</th><th>ADDRESS</th><th>PORT</th><th>POLICY</th><th>STATE</th><th></th></tr></thead><tbody>${data.rules.map((rule) => `<tr><td>${esc(rule.name)}</td><td class="mono">${esc(rule.address)}</td><td>${rule.port || 'Any'}</td><td>${esc(rule.action)}</td><td>${rule.enabled ? 'On' : 'Off'}</td><td><button class="small-button icon danger" data-action="delete-rule" data-rule="${rule.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No simulated rules yet.</div>'}`;
    } catch (error) { const target = $('#firewall-rules', win); if (target) target.textContent = error.message; }
  }
  function updateTheme(theme) {
    state.settings.theme = theme;
    document.body.classList.toggle('theme-light', theme === 'light');
    api('/api/settings/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: theme }) }).catch(() => {});
    refreshApp('settings');
  }
  function startUpload(targetApp) {
    const input = $('#audio-upload');
    input.dataset.target = targetApp || 'library'; input.value = ''; input.click();
  }
  async function audioDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file); const probe = new Audio();
      probe.onloadedmetadata = () => { const seconds = Math.round(probe.duration || 0); URL.revokeObjectURL(url); resolve(seconds); };
      probe.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      probe.src = url;
    });
  }
  async function importFile(file, targetApp = 'library', titleOverride = '') {
    const durationSeconds = await audioDuration(file);
    const body = new FormData(); body.append('audio', file, file.name || 'recording.webm');
    body.append('title', titleOverride || file.name.replace(/\.[^.]+$/, '')); body.append('artist', 'Imported audio'); body.append('duration', String(durationSeconds));
    const track = await api('/api/tracks/import', { method: 'POST', body });
    state.tracks.unshift(track);
    if (targetApp === 'studio') {
      const lane = Math.min(3, state.studio.clips.length);
      state.studio.clips.push({ id: `clip-${Date.now()}`, name: track.title, trackId: track.id, at: 0, lane });
    }
    if (targetApp === 'dj') { state.decks.A.trackId = track.id; state.decks.A.playing = false; }
    for (const id of ['dj', 'studio', 'library', 'files']) refreshApp(id);
    toast(`Added “${track.title}” to your local library.`); log(`Imported ${track.title}`, 'library');
  }
  function projectSnapshot() {
    return { clips: state.studio.clips, effects: state.studio.effects, savedAt: new Date().toISOString() };
  }
  async function saveStudioProject() {
    const payload = { name: state.studio.name || 'Untitled Audio Project', kind: 'studio', data: projectSnapshot() };
    const saved = state.studio.id ? await api(`/api/projects/${state.studio.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) : await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    state.studio.id = saved.id; state.studio.name = saved.name;
    await refreshProjects(); toast(`Saved “${saved.name}”.`); log(`Saved project ${saved.name}`, 'project');
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportStudio() {
    const all = studioVisibleClips().map((clip) => ({ ...clip, track: trackById(clip.trackId) })).filter((clip) => clip.track?.audioUrl);
    const blob = await audio.renderWav(all);
    downloadBlob(blob, `${(state.studio.name || 'tuneos-mix').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`);
    toast('Rendered WAV downloaded.'); log('Exported WAV from Audio Studio', 'studio');
  }
  async function recordStudio() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Microphone recording is not supported by this browser.'); return; }
    state.studio.recording = true; refreshApp('studio'); toast('Recording for up to 12 seconds. Allow microphone access if prompted.');
    try {
      const blob = await audio.recordMicrophone(12);
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `TuneOS-recording-${Date.now()}.${ext}`, { type: blob.type });
      await importFile(file, 'studio', `Microphone take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) { toast(`Recording could not start: ${error.message}`); }
    finally { state.studio.recording = false; refreshApp('studio'); }
  }
  function keepStudioUndo() {
    state.studio.undo.push(JSON.stringify(state.studio.clips));
    if (state.studio.undo.length > 25) state.studio.undo.shift();
    state.studio.redo = [];
  }
  function toggleTheme() { updateTheme(state.settings.theme === 'light' ? 'dark' : 'light'); }
  async function handleAction(action, el) {
    const trackId = Number(el.dataset.track); const deckId = el.dataset.deck || 'A';
    if (action === 'import-audio') return startUpload(el.closest('[data-window]')?.dataset.window || 'library');
    if (action === 'deck-count') { state.deckCount = Number(el.value); refreshApp('dj'); return; }
    if (action === 'deck-load') { if (el.value) state.decks[deckId].trackId = Number(el.value); state.decks[deckId].playing = false; audio.stop(deckId); refreshApp('dj'); return; }
    if (action === 'play-deck') {
      const deck = state.decks[deckId]; const track = trackById(deck.trackId);
      if (deck.playing) { audio.stop(deckId); deck.playing = false; }
      else if (track) { try { const mode = await audio.play(deckId, track, deck.volume, deck.pitch); deck.playing = true; toast(mode === 'file' ? `Playing ${track.title}.` : `Synth preview · ${track.title}`); }
        catch (error) { toast(`Audio could not start: ${error.message}`); } }
      refreshApp('dj'); return;
    }
    if (action === 'stop-deck') { audio.stop(deckId); state.decks[deckId].playing = false; refreshApp('dj'); return; }
    if (action === 'stop-all') { for (const id of ['A', 'B', 'C', 'D']) { audio.stop(id); state.decks[id].playing = false; } refreshApp('dj'); return; }
    if (action === 'cue') { const deck = state.decks[deckId]; const track = trackById(deck.trackId); if (track) { try { await audio.play(deckId, track, deck.volume, deck.pitch); deck.playing = true; toast(`Cueing ${track.title}.`); } catch (error) { toast(error.message); } } refreshApp('dj'); return; }
    if (action === 'sync') { const otherId = deckId === 'A' ? 'B' : 'A'; const here = trackById(state.decks[deckId].trackId); const other = trackById(state.decks[otherId].trackId); if (here?.bpm && other?.bpm) { state.decks[deckId].pitch = Math.round(Math.max(-12, Math.min(12, ((other.bpm - here.bpm) / here.bpm) * 100))); await audio.setPitch(deckId, state.decks[deckId].pitch); toast(`Deck ${deckId} tempo matched toward Deck ${otherId}.`); } refreshApp('dj'); return; }
    if (action === 'load-track') { if (!trackById(trackId)) return; state.decks[deckId].trackId = trackId; state.decks[deckId].playing = false; audio.stop(deckId); openApp('dj'); refreshApp('dj'); toast(`Loaded ${trackById(trackId).title} on Deck ${deckId}.`); return; }
    if (action === 'save-mix') {
      const name = prompt('Name this mix:', 'Untitled DJ Mix'); if (!name) return;
      const saved = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: 'mix', data: { decks: state.decks, deckCount: state.deckCount, crossfade: state.crossfade, master: state.master } }) });
      state.projects.unshift(saved); toast(`Saved “${name}”.`); log(`Saved mix ${name}`, 'project'); return;
    }
    if (action === 'library-search') { state.librarySearch = el.value; const win = state.windows.get('library'); $$('.data-table tbody tr', win).forEach((row) => { row.hidden = !row.dataset.search.includes(state.librarySearch.toLowerCase()); }); return; }
    if (action === 'genre') { state.libraryGenre = el.dataset.genre; refreshApp('library'); return; }
    if (action === 'rename-track') { const track = trackById(trackId); const title = prompt('Track name', track?.title || ''); if (!track || !title?.trim()) return; await api(`/api/tracks/${trackId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) }); await loadData(); refreshApp('library'); toast('Track renamed.'); return; }
    if (action === 'delete-track') { const track = trackById(trackId); if (!track || !confirm(`Remove “${track.title}” from the local library?`)) return; await api(`/api/tracks/${trackId}`, { method: 'DELETE' }); await loadData(); for (const id of ['dj', 'studio', 'library', 'files']) refreshApp(id); toast('Track removed.'); return; }
    if (action === 'new-project') { state.studio = { id: null, name: 'Untitled Audio Project', clips: [], effects: { Reverb: true, Delay: false, Equalizer: true }, recording: false, playing: false, undo: [], redo: [] }; openApp('studio'); refreshApp('studio'); toast('New audio project created.'); return; }
    if (action === 'save-project') { try { await saveStudioProject(); } catch (error) { toast(`Project could not be saved: ${error.message}`); } return; }
    if (action === 'open-project') { const project = state.projects.find((item) => Number(item.id) === Number(el.dataset.project)); if (!project) return; if (project.kind === 'mix') { openApp('dj'); toast(`Opened mix “${project.name}” (mix state is stored).`); } else { state.studio.id = project.id; state.studio.name = project.name; state.studio.clips = project.data?.clips || []; state.studio.effects = project.data?.effects || state.studio.effects; openApp('studio'); refreshApp('studio'); toast(`Opened “${project.name}”.`); } return; }
    if (action === 'export-audio') { try { await exportStudio(); } catch (error) { toast(error.message); } return; }
    if (action === 'record') { recordStudio(); return; }
    if (action === 'play-studio') { const clip = studioVisibleClips().find((item) => trackById(item.trackId)?.audioUrl); const track = clip && trackById(clip.trackId); if (!track) { toast('Import an audio file first. Demo waveform lanes are visual references.'); return; } if (state.studio.playing) audio.stop('studio'); else { try { await audio.play('studio', track); } catch (error) { toast(error.message); } } state.studio.playing = !state.studio.playing; refreshApp('studio'); return; }
    if (action === 'pause-studio' || action === 'stop-studio') { audio.stop('studio'); state.studio.playing = false; if (action === 'stop-studio') toast('Playback stopped.'); refreshApp('studio'); return; }
    if (action === 'effect-toggle') { state.studio.effects[el.dataset.effect] = !state.studio.effects[el.dataset.effect]; refreshApp('studio'); toast(`${el.dataset.effect} ${state.studio.effects[el.dataset.effect] ? 'enabled' : 'bypassed'} in the inspector.`); return; }
    if (action === 'select-clip') { $$('.clip', el.closest('.window-content')).forEach((item) => item.classList.remove('selected')); el.classList.add('selected'); return; }
    if (action === 'trim') { const clips = state.studio.clips; if (!clips.length) { toast('Import audio to create an editable clip.'); return; } keepStudioUndo(); const clip = clips.at(-1); clip.trimmed = !clip.trimmed; toast(clip.trimmed ? 'Trim marker added to the selected clip.' : 'Trim marker cleared.'); refreshApp('studio'); return; }
    if (action === 'split') { if (!state.studio.clips.length) { toast('Import audio before splitting a clip.'); return; } keepStudioUndo(); const clip = state.studio.clips.at(-1); state.studio.clips.push({ ...clip, id: `clip-${Date.now()}`, name: `${clip.name} · split`, at: Number(clip.at || 0) + 8, lane: clip.lane }); toast('Clip split at the current 8-second demo marker.'); refreshApp('studio'); return; }
    if (action === 'delete-clip') { if (!state.studio.clips.length) { toast('Select an imported clip first.'); return; } keepStudioUndo(); state.studio.clips.pop(); refreshApp('studio'); toast('Last clip removed.'); return; }
    if (action === 'undo') { if (state.studio.undo.length) { state.studio.redo.push(JSON.stringify(state.studio.clips)); state.studio.clips = JSON.parse(state.studio.undo.pop()); refreshApp('studio'); } else toast('Nothing to undo.'); return; }
    if (action === 'redo') { if (state.studio.redo.length) { state.studio.undo.push(JSON.stringify(state.studio.clips)); state.studio.clips = JSON.parse(state.studio.redo.pop()); refreshApp('studio'); } else toast('Nothing to redo.'); return; }
    if (action === 'toggle-shortcut') { state.settings.shortcuts = state.settings.shortcuts === false; api('/api/settings/shortcuts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: state.settings.shortcuts }) }).catch(() => {}); refreshApp('settings'); return; }
    if (action === 'settings-tab') { toast(`${el.dataset.tab} preferences are shown in this workspace panel.`); return; }
    if (action === 'refresh-metrics') { await refreshMetrics(); toast('Host metrics refreshed.'); return; }
    if (action === 'refresh-activity') { await refreshActivity(); return; }
    if (action === 'scheduler-mode') { state.schedulerMode = el.value; refreshApp('scheduler'); return; }
    if (action === 'delete-rule') { await api(`/api/firewall/rules/${el.dataset.rule}`, { method: 'DELETE' }); await refreshFirewall(); toast('Display rule removed.'); return; }
    if (action === 'toggle-rule') { await api(`/api/firewall/rules/${el.dataset.rule}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: el.checked }) }); await refreshFirewall(); return; }
  }

  document.addEventListener('click', async (event) => {
    const winAction = event.target.closest('[data-window-action]');
    if (winAction) {
      const win = winAction.closest('[data-window]'); const action = winAction.dataset.windowAction; const id = win.dataset.window;
      if (action === 'close') closeApp(id);
      if (action === 'minimize') win.classList.add('minimized');
      if (action === 'maximize') win.classList.toggle('maximized');
      return;
    }
    const appButton = event.target.closest('[data-app]'); if (appButton) { openApp(appButton.dataset.app); return; }
    const openButton = event.target.closest('[data-open]'); if (openButton) { showOverlay(openButton.dataset.open); return; }
    const closeOverlay = event.target.closest('[data-close-overlay]'); if (closeOverlay) { hideOverlays(); return; }
    const themeButton = event.target.closest('[data-theme-toggle]'); if (themeButton) { toggleTheme(); return; }
    const action = event.target.closest('[data-action]');
    if (action && !['library-search', 'deck-volume', 'deck-pitch', 'master', 'crossfade'].includes(action.dataset.action)) {
      try { await handleAction(action.dataset.action, action); } catch (error) { toast(error.message || 'That action failed.'); }
    }
    if (event.target.classList.contains('overlay')) hideOverlays();
  });
  document.addEventListener('change', async (event) => {
    const el = event.target;
    if (el.id === 'audio-upload') {
      const file = el.files?.[0]; if (!file) return;
      try { await importFile(file, el.dataset.target || 'library'); }
      catch (error) { toast(`Import failed: ${error.message}`); }
      return;
    }
    if (el.matches('[data-action="deck-load"]')) { try { await handleAction('deck-load', el); } catch (error) { toast(error.message); } return; }
    if (el.matches('[data-action="deck-count"]')) { state.deckCount = Number(el.value); refreshApp('dj'); return; }
    if (el.matches('[data-action="scheduler-mode"]')) { state.schedulerMode = el.value; refreshApp('scheduler'); return; }
    if (el.matches('[data-action="master"]')) { state.master = Number(el.value) / 100; audio.setMaster(state.master).catch(() => {}); return; }
    if (el.matches('[data-action="crossfade"]')) { state.crossfade = Number(el.value) / 100; audio.setCrossfade(state.crossfade); return; }
    if (el.matches('[data-action="deck-volume"]')) { const deck = el.dataset.deck; state.decks[deck].volume = Number(el.value) / 100; audio.setVolume(deck, state.decks[deck].volume).catch(() => {}); return; }
    if (el.matches('[data-action="deck-pitch"]')) { const deck = el.dataset.deck; state.decks[deck].pitch = Number(el.value); audio.setPitch(deck, state.decks[deck].pitch); return; }
    if (el.matches('[data-form="firewall"]')) {
      event.preventDefault(); const form = new FormData(el);
      try { await api('/api/firewall/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) }); el.reset(); await refreshFirewall(); toast('Saved simulated rule. OS firewall is unchanged.'); }
      catch (error) { toast(error.message); }
      return;
    }
  });
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.id === 'launcher-search') renderLauncher(el.value);
    if (el.id === 'global-search') renderSearch(el.value);
    if (el.matches('[data-action="library-search"]')) handleAction('library-search', el);
    if (el.matches('[data-action="master"], [data-action="deck-volume"], [data-action="deck-pitch"], [data-action="crossfade"]')) {
      const output = el.parentElement.querySelector('output');
      if (output) output.textContent = el.dataset.action === 'deck-pitch' ? `${Number(el.value) > 0 ? '+' : ''}${el.value}%` : `${el.value}%`;
      if (el.dataset.action === 'master') { state.master = Number(el.value) / 100; audio.setMaster(state.master).catch(() => {}); }
      if (el.dataset.action === 'deck-volume') { state.decks[el.dataset.deck].volume = Number(el.value) / 100; audio.setVolume(el.dataset.deck, state.decks[el.dataset.deck].volume).catch(() => {}); }
      if (el.dataset.action === 'deck-pitch') { state.decks[el.dataset.deck].pitch = Number(el.value); audio.setPitch(el.dataset.deck, el.value); }
      if (el.dataset.action === 'crossfade') { state.crossfade = Number(el.value) / 100; audio.setCrossfade(state.crossfade); }
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="firewall"]'); if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try { await api('/api/firewall/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); form.reset(); await refreshFirewall(); toast('Saved simulated rule. OS firewall is unchanged.'); }
    catch (error) { toast(error.message); }
  });

  let drag = null;
  document.addEventListener('pointerdown', (event) => {
    const bar = event.target.closest('.window-titlebar'); const win = bar?.closest('.app-window');
    if (!win || event.target.closest('button') || win.classList.contains('maximized')) return;
    const rect = win.getBoundingClientRect(); win.style.zIndex = ++state.z;
    drag = { win, x: event.clientX - rect.left, y: event.clientY - rect.top };
    bar.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const bounds = windowsEl.getBoundingClientRect();
    const x = Math.max(-bounds.width * .15, Math.min(bounds.width - 150, event.clientX - bounds.left - drag.x));
    const y = Math.max(0, Math.min(bounds.height - 45, event.clientY - bounds.top - drag.y));
    drag.win.style.left = `${x}px`; drag.win.style.top = `${y}px`; drag.win.style.transform = 'none';
  });
  document.addEventListener('pointerup', () => { drag = null; });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideOverlays();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && state.settings.shortcuts !== false) { event.preventDefault(); renderSearch(''); showOverlay('search'); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'shift' && event.code === 'KeyK') { event.preventDefault(); showOverlay('launcher'); }
    if (event.altKey && event.key === 'F4' && state.activeApp) { event.preventDefault(); closeApp(state.activeApp); }
  });

  const uploadInput = document.createElement('input'); uploadInput.id = 'audio-upload'; uploadInput.type = 'file'; uploadInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm'; uploadInput.hidden = true;
  document.body.append(uploadInput);
  renderLauncher(); updateClock(); window.setInterval(updateClock, 15000);
  loadData().then(() => { renderLauncher(); openApp(new URLSearchParams(location.search).get('demo') === '1' ? 'dj' : 'dj'); })
    .catch((error) => { toast(`TuneOS API unavailable: ${error.message}`); openApp('dj'); });
})();
