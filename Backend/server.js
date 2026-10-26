const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'Frontend');

const defaultConfig = {
  name: 'TuneOS',
  version: '0.1.0',
  defaults: { accent: 'violet', theme: 'midnight', wallpaper: 'aurora', showClock: true },
  capabilities: { localAudio: true, spotify: false, externalPlayers: false }
};

app.disable('x-powered-by');
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

app.get('/api/status', (_request, response) => {
  response.json({ status: 'ok', name: defaultConfig.name, version: defaultConfig.version });
});

app.get('/api/config', (_request, response) => {
  response.json(defaultConfig);
});

app.use((error, _request, response, _next) => {
  console.error('TuneOS server error:', error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`TuneOS v${defaultConfig.version} is running at http://localhost:${PORT}`);
});
