'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const FIREWALL_HELPER = path.join(ROOT, 'scripts', 'tuneos-firewall');
const TUNEOS_TAG = 'TuneOS-12345678-1234-1234-1234-123456789abc';

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child, logFile) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`TuneOS exited during startup:\n${fs.readFileSync(logFile, 'utf8')}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* Wait briefly while the test server binds its loopback port. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`TuneOS did not start:\n${fs.readFileSync(logFile, 'utf8')}`);
}

test('authentication protects APIs and live host integrations use the isolated test database', async (t) => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneos-auth-test-'));
  const dataDir = path.join(testDir, 'data');
  const logFile = path.join(testDir, 'server.log');
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  fs.writeFileSync(logFile, '');
  fs.mkdirSync(dataDir, { recursive: true });
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'schema.sql'), schema);
  const adminId = crypto.randomUUID();
  const adminUsername = `admin_${Date.now()}`;
  const adminEmail = `${adminUsername}@example.test`;
  const adminPassword = crypto.randomBytes(24).toString('base64url');
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(adminPassword, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const seedDb = new DatabaseSync(path.join(dataDir, 'tuneos.sqlite'));
  seedDb.exec(schema);
  seedDb.prepare('INSERT INTO users (user_id, username, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(adminId, adminUsername, adminEmail, `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`);
  seedDb.close();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ALLOWED_CLIENT_IPS: '127.0.0.1', TUNEOS_DATA_DIR: dataDir, TUNEOS_OS_ADMIN_ID: adminId },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => fs.appendFileSync(logFile, chunk));
  child.stderr.on('data', (chunk) => fs.appendFileSync(logFile, chunk));
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child, logFile);
  const origin = baseUrl;
  const publicHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(publicHealth.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/auth/session`)).status, 200);

  const protectedRoutes = [
    ['/api/tracks', 'GET'], ['/api/tracks/import', 'POST'], ['/api/audio/1', 'GET'],
    ['/api/projects', 'GET'], ['/api/projects', 'POST'], ['/api/settings', 'GET'],
    ['/api/settings/theme', 'PUT'], ['/api/system/metrics', 'GET'], ['/api/system/processes', 'GET'],
    ['/api/firewall/status', 'GET'], ['/api/firewall', 'GET'], ['/api/firewall/rules', 'POST'],
    ['/api/firewall/actual/rules', 'GET'], ['/api/firewall/actual/rules', 'POST'],
    ['/api/firewall/actual/rules/00000000-0000-0000-0000-000000000000', 'DELETE'],
    ['/api/ssh/status', 'GET'], ['/api/ssh/password-authentication', 'POST'],
    ['/api/activity', 'GET'], ['/api/activity', 'POST']
  ];
  for (const [route, method] of protectedRoutes) {
    const response = await fetch(`${baseUrl}${route}`, { method });
    assert.equal(response.status, 401, `Expected unauthenticated ${method} ${route} to return 401`);
  }

  const username = `test_${Date.now()}`;
  const email = `${username}@example.test`;
  const password = crypto.randomBytes(24).toString('base64url');
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username, email, password })
  });
  assert.equal(register.status, 201);
  const firstCookieHeader = register.headers.get('set-cookie');
  assert.match(firstCookieHeader, /HttpOnly/i);
  assert.match(firstCookieHeader, /SameSite=Strict/i);
  const firstCookie = firstCookieHeader.split(';', 1)[0];
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: { Cookie: firstCookie } })).status, 200);
  for (const route of ['/api/projects', '/api/settings', '/api/activity', '/api/firewall']) {
    assert.equal((await fetch(`${baseUrl}${route}`, { headers: { Cookie: firstCookie } })).status, 200, `Existing ${route} API should remain available to an authenticated user`);
  }
  const displayFirewall = await (await fetch(`${baseUrl}/api/firewall`, { headers: { Cookie: firstCookie } })).json();
  assert.equal(displayFirewall.simulated, true, 'Legacy SQLite firewall rules must remain explicitly separate from UFW');
  const osMutation = await fetch(`${baseUrl}/api/ssh/password-authentication`, {
    method: 'POST', headers: { Cookie: firstCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, confirmKeyAccess: true })
  });
  assert.equal(osMutation.status, 403, 'A normal TuneOS user must not manage host SSH settings');
  const firewallMutation = await fetch(`${baseUrl}/api/firewall/actual/rules`, {
    method: 'POST', headers: { Cookie: firstCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'allow', protocol: 'tcp', port: 9999, source: 'any' })
  });
  assert.equal(firewallMutation.status, 403, 'A normal TuneOS user must not manage host firewall rules');
  const firewallDeletion = await fetch(`${baseUrl}/api/firewall/actual/rules/00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE', headers: { Cookie: firstCookie }
  });
  assert.equal(firewallDeletion.status, 403, 'A normal TuneOS user must not perform OS-management operations');

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: adminUsername, password: adminPassword })
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';', 1)[0];
  const adminFirewallStatus = await fetch(`${baseUrl}/api/firewall/status`, { headers: { Cookie: adminCookie } });
  assert.ok([200, 503].includes(adminFirewallStatus.status));
  if (adminFirewallStatus.status === 200) assert.equal((await adminFirewallStatus.json()).canManage, false);
  else assert.match((await adminFirewallStatus.json()).error, /Unable to retrieve UFW status/);
  for (const port of [22, 3030]) {
    for (const action of ['allow', 'deny']) {
      const adminProtectedPortAttempt = await fetch(`${baseUrl}/api/firewall/actual/rules`, {
        method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, protocol: 'tcp', port, source: 'any' })
      });
      assert.equal(adminProtectedPortAttempt.status, 400, `Configured OS admin must not add ${action} rules on protected port ${port}`);
    }
  }
  const adminRuleAdd = await fetch(`${baseUrl}/api/firewall/actual/rules`, {
    method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'allow', protocol: 'tcp', port: 8443, source: 'any' })
  });
  assert.equal(adminRuleAdd.status, 501, 'Configured OS admin must be refused while actual UFW changes are disabled');
  const adminRuleDelete = await fetch(`${baseUrl}/api/firewall/actual/rules/00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE', headers: { Cookie: adminCookie }
  });
  assert.equal(adminRuleDelete.status, 501, 'Configured OS admin must be refused while actual UFW deletion is disabled');
  const adminInvalidSshRequest = await fetch(`${baseUrl}/api/ssh/password-authentication`, {
    method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: 'no' })
  });
  assert.equal(adminInvalidSshRequest.status, 400, 'Configured OS admin must pass authorization, then receive SSH input validation');
  const adminSshChange = await fetch(`${baseUrl}/api/ssh/password-authentication`, {
    method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, confirmKeyAccess: true })
  });
  assert.equal(adminSshChange.status, 501, 'Configured OS admin must be refused while SSH modifications are disabled');

  const metricsResponse = await fetch(`${baseUrl}/api/system/metrics`, { headers: { Cookie: firstCookie } });
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.json();
  assert.ok(Number.isFinite(metrics.memoryTotal) && metrics.memoryTotal > 0);
  assert.ok(Number.isFinite(metrics.cpuUsagePercent) || metrics.cpuUsagePercent === null);
  assert.ok(Number.isFinite(metrics.processMemoryRss) && metrics.processMemoryRss > 0);
  assert.ok(metrics.disk && Number.isFinite(metrics.disk.total) && metrics.disk.total > 0);

  const processResponse = await fetch(`${baseUrl}/api/system/processes`, { headers: { Cookie: firstCookie } });
  assert.equal(processResponse.status, 200);
  const processData = await processResponse.json();
  if (process.platform === 'linux') {
    assert.equal(processData.available, true);
    assert.ok(processData.processes.some((entry) => entry.pid === processData.serverPid));
  }

  const sshStatusResponse = await fetch(`${baseUrl}/api/ssh/status`, { headers: { Cookie: firstCookie } });
  assert.ok([200, 503].includes(sshStatusResponse.status), 'SSH status must be actual data or an explicit unavailable response');
  if (sshStatusResponse.status === 503) assert.match((await sshStatusResponse.json()).error, /Unable to retrieve SSH configuration/);
  const ufwRulesResponse = await fetch(`${baseUrl}/api/firewall/actual/rules`, { headers: { Cookie: firstCookie } });
  assert.ok([200, 503].includes(ufwRulesResponse.status), 'UFW rules must be actual data or an explicit unavailable response');
  if (ufwRulesResponse.status === 503) assert.match((await ufwRulesResponse.json()).error, /Unable to list actual UFW rules/);

  if (process.platform === 'linux') {
    const ufwResponse = await fetch(`${baseUrl}/api/firewall/status`, { headers: { Cookie: firstCookie } });
    assert.equal(ufwResponse.status, 200, 'Read-only UFW status wrapper should succeed on the configured Ubuntu VM');
    assert.match((await ufwResponse.json()).status, /Status:/);
  }

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: firstCookie, 'Content-Type': 'application/json', Origin: origin }, body: '{}'
  });
  assert.equal(logout.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: firstCookie } })).json()).user, null);
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: { Cookie: firstCookie } })).status, 401);

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /class="auth-pending"/);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: username, password })
  });
  assert.equal(login.status, 200);
  const secondCookie = login.headers.get('set-cookie').split(';', 1)[0];
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: { Cookie: secondCookie } })).status, 200);

  const token = secondCookie.slice('tuneos.sid='.length);
  const database = new DatabaseSync(path.join(dataDir, 'tuneos.sqlite'));
  database.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .run(0, crypto.createHash('sha256').update(token).digest('hex'));
  database.close();
  assert.equal((await fetch(`${baseUrl}/api/projects`, { headers: { Cookie: secondCookie } })).status, 401);
  assert.equal((await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: secondCookie } })).json()).user, null);
});

test('firewall helper validates broad and specific rules without invoking UFW', { skip: process.platform !== 'linux' || !fs.existsSync('/usr/bin/python3') }, () => {
  const validate = (...args) => spawnSync('/bin/bash', [FIREWALL_HELPER, ...args], { encoding: 'utf8' });
  const broad = validate('validate-add', 'allow', 'tcp', '8443', 'any', TUNEOS_TAG);
  assert.equal(broad.status, 0, broad.stderr);
  const specific = validate('validate-add', 'deny', 'udp', '8443', '192.168.204.0/24', TUNEOS_TAG);
  assert.equal(specific.status, 0, specific.stderr);

  for (const port of ['22', '3030', '00022', '03030']) {
    for (const action of ['allow', 'deny', 'limit']) {
      const result = validate('validate-add', action, 'tcp', port, 'any', TUNEOS_TAG);
      assert.notEqual(result.status, 0, `${action} add on protected port ${port} must fail`);
      assert.match(result.stderr, /protected.*port/i);
      const deletion = validate('validate-delete', action, 'tcp', port, 'any', TUNEOS_TAG);
      assert.notEqual(deletion.status, 0, `${action} delete on protected port ${port} must fail`);
      assert.match(deletion.stderr, /protected.*port/i);
    }
  }

  for (const operation of ['add', 'delete']) {
    const result = validate(operation, 'allow', 'tcp', '8443', 'any', TUNEOS_TAG);
    assert.notEqual(result.status, 0, `operational ${operation} must be unavailable in read-only mode`);
    assert.match(result.stderr, /supported operations are status and list/i);
  }

  const injectionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneos-firewall-validation-'));
  const injectionMarker = path.join(injectionDir, 'must-not-be-created');
  try {
    for (const invalidArgs of [
    ['validate-add', 'drop', 'tcp', '8443', 'any', TUNEOS_TAG],
    ['validate-add', 'allow', 'icmp', '8443', 'any', TUNEOS_TAG],
    ['validate-add', 'allow', 'tcp', '0', 'any', TUNEOS_TAG],
    ['validate-add', 'allow', 'tcp', '65536', 'any', TUNEOS_TAG],
    ['validate-add', 'allow', 'tcp', '8443', 'any', 'not-a-tuneos-tag']
    ]) {
      assert.notEqual(validate(...invalidArgs).status, 0, `invalid helper arguments must be rejected: ${invalidArgs.join(' ')}`);
    }
    const injection = validate('validate-add', 'allow', 'tcp', '8443', `192.168.1.1;touch ${injectionMarker}`, TUNEOS_TAG);
    assert.notEqual(injection.status, 0, 'shell metacharacters in a source argument must be rejected');
    assert.equal(fs.existsSync(injectionMarker), false, 'source input must never be executed by a shell');
  } finally {
    fs.rmSync(injectionDir, { recursive: true, force: true });
  }
});

test('SSH helper rejects configuration changes in read-only mode', { skip: process.platform !== 'linux' }, () => {
  const result = spawnSync('/bin/bash', [path.join(ROOT, 'scripts', 'tuneos-ssh'), 'set-password-auth', 'yes'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supported operation is status/i);
});

test('SSH sudoers candidate grants only the exact status helper operation', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'scripts', 'tuneos-ssh.sudoers'), 'utf8')
    .split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  assert.deepEqual(policy, ['devantuneos ALL=(root) NOPASSWD: /usr/local/sbin/tuneos-ssh status']);
  assert.doesNotMatch(policy.join('\n'), /\*|ALL\s*$/);
});

test('UFW helper operational cases are read-only status and list', () => {
  const helper = fs.readFileSync(FIREWALL_HELPER, 'utf8');
  assert.match(helper, /exec "\$UFW" status verbose/);
  assert.match(helper, /exec "\$UFW" status numbered/);
  assert.doesNotMatch(helper, /exec "\$UFW" --force delete|exec "\$UFW" "\$action"/);
});

test('OpenSSH rejects an invalid temporary config without touching the system configuration', { skip: process.platform !== 'linux' || !fs.existsSync('/usr/sbin/sshd') }, (t) => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuneos-sshd-validation-'));
  const configPath = path.join(testDir, 'sshd_config');
  fs.writeFileSync(configPath, 'ThisIsNotAValidOpenSshDirective yes\n');
  t.after(() => fs.rmSync(testDir, { recursive: true, force: true }));

  const result = spawnSync('/usr/sbin/sshd', ['-t', '-f', configPath], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'sshd -t must reject an invalid temporary config');
  assert.match(`${result.stdout}\n${result.stderr}`, /bad configuration option/i);
});
