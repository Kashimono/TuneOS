'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { promisify } = require('node:util');
const express = require('express');
const multer = require('multer');
const { execFile } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'database');
const AUDIO_DIR = path.join(ROOT, 'storage', 'audio');
for (const dir of [DATA_DIR, AUDIO_DIR]) fs.mkdirSync(dir, { recursive: true });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3030);
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const allowedIps = (process.env.ALLOWED_CLIENT_IPS || '').split(',').map((v) => v.trim()).filter(Boolean);
const db = new DatabaseSync(path.join(DATA_DIR, 'tuneos.sqlite'));
db.exec(fs.readFileSync(path.join(DATA_DIR, 'schema.sql'), 'utf8'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'tuneos.sid';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const FIREWALL_WRAPPER_PATH = '/usr/local/sbin/tuneos-firewall';

function getUfwStatus() {
  return new Promise((resolve, reject) => {
    execFile(
      'sudo',
      ['-n', FIREWALL_WRAPPER_PATH, 'status'],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr.trim() || error.message || 'Firewall status command failed.'));
        }

        const status = stdout.trim();
        if (!status) return reject(new Error('Firewall status wrapper returned no output.'));
        resolve(status);
      }
    );
  });
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use((req, res, next) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (allowedIps.length ? !allowedIps.includes(ip) : !local) {
    return res.status(403).json({ error: 'Client IP is not allowlisted. Configure ALLOWED_CLIENT_IPS for trusted LAN access.' });
  }
  next();
});
app.use(express.json({ limit: '2mb' }));

const seedTracks = [
  ['Neon Courtyard', 'Mira Vale', 'House', 124, 196, '#a78bfa'],
  ['Static Language', 'Circuit Halo', 'Techno', 132, 213, '#60a5fa'],
  ['Cassette Weather', 'Soft Focus', 'Lo-fi', 86, 174, '#f59e0b'],
  ['Afterglow Hotline', 'June Arcade', 'Pop', 112, 188, '#ec4899'],
  ['Velocity Bloom', 'North Relay', 'Drum & Bass', 174, 204, '#22d3ee'],
  ['Glass Elevator', 'Aster & Co.', 'House', 120, 225, '#34d399'],
  ['Redline Ritual', 'Mono State', 'Techno', 138, 241, '#fb7185'],
  ['Sundown Receiver', 'Low Atlas', 'Lo-fi', 92, 169, '#fbbf24']
];
if (db.prepare('SELECT COUNT(*) AS count FROM tracks').get().count === 0) {
  const insert = db.prepare('INSERT INTO tracks (title, artist, genre, bpm, duration_seconds, color, source) VALUES (?, ?, ?, ?, ?, ?, \'library\')');
  for (const track of seedTracks) insert.run(...track);
}
if (db.prepare('SELECT COUNT(*) AS count FROM projects').get().count === 0) {
  db.prepare('INSERT INTO projects (name, kind, data_json) VALUES (?, ?, ?)').run('Untitled Audio Project', 'studio', JSON.stringify({ tracks: [] }));
}
if (db.prepare('SELECT COUNT(*) AS count FROM playlists').get().count === 0) {
  db.prepare('INSERT INTO playlists (name) VALUES (?)').run('Late Night Set');
}

function log(category, message, level = 'info') {
  db.prepare('INSERT INTO activity_logs (level, category, message) VALUES (?, ?, ?)').run(level, category, message);
}
function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }
function publicTrack(track) {
  return { ...track, duration: track.duration_seconds, audioUrl: track.file_name ? `/api/audio/${track.id}` : null };
}
function safeTrackName(name) { return path.basename(name || 'audio').replace(/[\r\n]/g, '').slice(0, 180); }

function publicUser(user) {
  return { userId: user.user_id, username: user.username, email: user.email, createdAt: user.created_at };
}
function readSessionToken(req) {
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = entry?.slice(SESSION_COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function sessionCookie(token, req, maxAge = SESSION_TTL_SECONDS) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (req.socket.encrypted) parts.push('Secure');
  return parts.join('; ');
}
function clearSessionCookie(req, res) { res.setHeader('Set-Cookie', sessionCookie('', req, 0)); }
function requestHasSameOrigin(req) {
  const origin = req.get('origin');
  if (origin) {
    try { return new URL(origin).origin === `${req.protocol}://${req.get('host')}`; }
    catch { return false; }
  }
  return req.get('sec-fetch-site') !== 'cross-site';
}
function requireSameOrigin(req, res) {
  if (requestHasSameOrigin(req)) return true;
  res.status(403).json({ error: 'This account request must come from TuneOS.' });
  return false;
}
function findSessionUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT users.id, users.user_id, users.username, users.email, users.created_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, Math.floor(Date.now() / 1000));
  return row || null;
}
async function issueSession(user, req, res) {
  const previousToken = readSessionToken(req);
  if (previousToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(previousToken).digest('hex'));
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  res.setHeader('Set-Cookie', sessionCookie(token, req));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [scheme, cost, blockSize, parallel, saltHex, hashHex] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || cost !== '16384' || blockSize !== '8' || parallel !== '1' || !/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(safeTrackName(file.originalname)).toLowerCase()}`)
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const accepted = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm'];
    if (!accepted.includes(ext)) return cb(new Error('Choose an MP3, WAV, OGG, M4A, AAC, FLAC, or WebM audio file.'));
    cb(null, true);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'TuneOS', version: '1.0.0', database: 'sqlite' }));

app.get('/api/auth/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = findSessionUser(req);
  if (!user && readSessionToken(req)) clearSessionCookie(req, res);
  res.json({ user: user ? publicUser(user) : null });
});
app.post('/api/auth/register', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireSameOrigin(req, res)) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 characters using letters, numbers, or underscores.' });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
  const duplicate = db.prepare('SELECT username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, email);
  if (duplicate) return res.status(409).json({ error: duplicate.username.toLowerCase() === username.toLowerCase() ? 'That username is already registered.' : 'That email address is already registered.' });

  const passwordHash = await hashPassword(password);
  let user;
  try {
    const result = db.prepare('INSERT INTO users (user_id, username, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), username, email, passwordHash);
    user = db.prepare('SELECT id, user_id, username, email, created_at FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('users.username')) return res.status(409).json({ error: 'That username is already registered.' });
    if (String(error.message).includes('users.email')) return res.status(409).json({ error: 'That email address is already registered.' });
    throw error;
  }
  await issueSession(user, req, res);
  log('account', 'A new TuneOS account was registered.');
  res.status(201).json({ user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireSameOrigin(req, res)) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || identifier.length > 254 || !password || password.length > 128) return res.status(400).json({ error: 'Enter your username or email and password.' });
  const user = db.prepare(`SELECT id, user_id, username, email, password_hash, created_at FROM users
    WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`).get(identifier, identifier.toLowerCase());
  if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: 'Incorrect username/email or password.' });
  await issueSession(user, req, res);
  log('account', 'A TuneOS account signed in.');
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireSameOrigin(req, res)) return;
  const token = readSessionToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex'));
    log('account', 'A TuneOS account signed out.');
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/tracks', (req, res) => {
  const search = `%${String(req.query.search || '').slice(0, 100)}%`;
  const genre = String(req.query.genre || '');
  const tracks = db.prepare(`SELECT * FROM tracks WHERE (title LIKE ? OR artist LIKE ?) AND (? = '' OR genre = ?) ORDER BY id`).all(search, search, genre, genre);
  res.json(tracks.map(publicTrack));
});
app.post('/api/tracks/import', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select an audio file first.' });
  const title = String(req.body.title || path.parse(req.file.originalname).name).slice(0, 160);
  const artist = String(req.body.artist || 'Imported audio').slice(0, 120);
  const bpm = Number(req.body.bpm) || null;
  const result = db.prepare('INSERT INTO tracks (title, artist, genre, bpm, duration_seconds, color, source, file_name, mime_type) VALUES (?, ?, ?, ?, ?, ?, \'imported\', ?, ?)')
    .run(title, artist, String(req.body.genre || 'Imported').slice(0, 60), bpm, Math.max(0, Number(req.body.duration) || 0), '#69b8ff', req.file.filename, req.file.mimetype || 'application/octet-stream');
  log('library', `Imported ${title}`);
  res.status(201).json(publicTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(result.lastInsertRowid))));
});
app.get('/api/audio/:id', (req, res) => {
  const track = db.prepare('SELECT file_name, mime_type FROM tracks WHERE id = ?').get(Number(req.params.id));
  if (!track?.file_name) return res.status(404).json({ error: 'No local audio file is stored for this track.' });
  const filePath = path.join(AUDIO_DIR, path.basename(track.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio file is missing from local storage.' });
  res.type(track.mime_type || 'application/octet-stream').sendFile(path.basename(filePath), { root: AUDIO_DIR });
});
app.patch('/api/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  if (!old) return res.status(404).json({ error: 'Track not found.' });
  const title = String(req.body.title ?? old.title).trim().slice(0, 160) || old.title;
  const artist = String(req.body.artist ?? old.artist).trim().slice(0, 120) || old.artist;
  db.prepare('UPDATE tracks SET title = ?, artist = ?, genre = ?, bpm = ? WHERE id = ?').run(title, artist, req.body.genre ?? old.genre, Number(req.body.bpm) || old.bpm, id);
  log('library', `Updated ${title}`);
  res.json(publicTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)));
});
app.delete('/api/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  if (!track) return res.status(404).json({ error: 'Track not found.' });
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  if (track.file_name) fs.rmSync(path.join(AUDIO_DIR, path.basename(track.file_name)), { force: true });
  log('library', `Removed ${track.title}`);
  res.status(204).end();
});

app.get('/api/projects', (_req, res) => {
  res.json(db.prepare('SELECT id, name, kind, data_json, updated_at FROM projects ORDER BY updated_at DESC').all().map((p) => ({ ...p, data: parseJson(p.data_json) })));
});
app.post('/api/projects', (req, res) => {
  const name = String(req.body.name || 'Untitled Project').trim().slice(0, 120);
  const kind = req.body.kind === 'mix' ? 'mix' : 'studio';
  const result = db.prepare('INSERT INTO projects (name, kind, data_json) VALUES (?, ?, ?)').run(name, kind, JSON.stringify(req.body.data || {}));
  log('project', `Created ${name}`);
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid)));
});
app.put('/api/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return res.status(404).json({ error: 'Project not found.' });
  db.prepare('UPDATE projects SET name = ?, kind = ?, data_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(String(req.body.name || 'Untitled Project').slice(0, 120), req.body.kind === 'mix' ? 'mix' : 'studio', JSON.stringify(req.body.data || {}), id);
  log('project', `Saved ${req.body.name || 'project'}`);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json({ ...project, data: parseJson(project.data_json) });
});
app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(Number(req.params.id));
  res.status(204).end();
});

app.get('/api/settings', (_req, res) => {
  const rows = db.prepare('SELECT key, value_json FROM settings').all();
  res.json(Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, row.value_json)])));
});
app.put('/api/settings/:key', (req, res) => {
  const key = String(req.params.key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!key) return res.status(400).json({ error: 'Invalid settings key.' });
  const value = JSON.stringify(req.body.value ?? null);
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, value);
  res.json({ key, value: parseJson(value, value) });
});

app.get('/api/system/metrics', (_req, res) => {
  const total = os.totalmem();
  const free = os.freemem();
  res.json({
    hostname: os.hostname(), platform: process.platform, release: os.release(), architecture: process.arch,
    node: process.version, uptimeSeconds: Math.round(os.uptime()), processUptimeSeconds: Math.round(process.uptime()),
    memoryTotal: total, memoryFree: free, memoryUsed: total - free,
    loadAverage: os.loadavg(), cpus: os.cpus().length, wsl: Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
  });
});
app.get('/api/firewall/status', async (_req, res) => {
  try {
    const status = await getUfwStatus();
    res.json({ status });
  } catch (error) {
    log('firewall', `UFW status request failed: ${error.message}`, 'warning');
    res.status(503).json({ error: 'Unable to retrieve UFW status through the configured wrapper.', detail: error.message });
  }
});
app.get('/api/firewall', (_req, res) => res.json({ simulated: true, allowlist: allowedIps, rules: db.prepare('SELECT * FROM firewall_rules ORDER BY id DESC').all() }));
app.post('/api/firewall/rules', (req, res) => {
  const address = String(req.body.address || '').trim();
  if (!address || address.length > 64) return res.status(400).json({ error: 'Enter a valid IP address or range label.' });
  const result = db.prepare('INSERT INTO firewall_rules (name, direction, address, port, protocol, action, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(String(req.body.name || 'Local rule').slice(0, 100), req.body.direction === 'outbound' ? 'outbound' : 'inbound', address, Number(req.body.port) || null, req.body.protocol === 'udp' ? 'udp' : 'tcp', req.body.action === 'block' ? 'block' : 'allow', req.body.enabled === false ? 0 : 1);
  log('firewall', `Added simulated ${req.body.action || 'allow'} rule for ${address}`);
  res.status(201).json(db.prepare('SELECT * FROM firewall_rules WHERE id = ?').get(Number(result.lastInsertRowid)));
});
app.patch('/api/firewall/rules/:id', (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body.enabled ? 1 : 0;
  db.prepare('UPDATE firewall_rules SET enabled = ? WHERE id = ?').run(enabled, id);
  res.json(db.prepare('SELECT * FROM firewall_rules WHERE id = ?').get(id) || null);
});
app.delete('/api/firewall/rules/:id', (req, res) => { db.prepare('DELETE FROM firewall_rules WHERE id = ?').run(Number(req.params.id)); res.status(204).end(); });
app.get('/api/activity', (_req, res) => res.json(db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100').all()));
app.post('/api/activity', (req, res) => {
  const message = String(req.body.message || '').slice(0, 300);
  if (message) log(String(req.body.category || 'desktop').slice(0, 60), message, req.body.level === 'warning' ? 'warning' : 'info');
  res.status(204).end();
});

app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('*path', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : (error.status >= 400 && error.status < 600 ? error.status : 500);
  if (status === 500) console.error(error);
  res.status(status).json({ error: error.message || 'Unexpected server error.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`TuneOS is running at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${path.relative(ROOT, path.join(DATA_DIR, 'tuneos.sqlite'))}`);
  console.log(HOST === '127.0.0.1' ? 'Loopback-only by default.' : `Remote clients restricted to: ${allowedIps.join(', ') || '(none)'}`);
  log('system', 'TuneOS server started');
});
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
