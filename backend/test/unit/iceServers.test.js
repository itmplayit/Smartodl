'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const ice = require('../../services/iceServers.service');

test('ICE parsing keeps only stun/turn URLs and bounds the list', () => {
  const servers = ice.parseIceServers(JSON.stringify([
    { urls: 'stun:stun.example.com:3478' },
    { urls: 'https://evil.example.com/steal' },
    { urls: ['turn:turn.example.com:3478', 'javascript:alert(1)'], username: 'u', credential: 'p' },
    'garbage',
    { urls: '' },
  ]));
  assert.equal(servers.length, 2);
  assert.equal(servers[0].urls, 'stun:stun.example.com:3478');
  assert.equal(servers[1].urls, 'turn:turn.example.com:3478');
  assert.equal(servers[1].username, 'u');
  assert.deepEqual(ice.parseIceServers('not json'), []);
  assert.deepEqual(ice.parseIceServers('{"urls":"stun:x"}'), []);
});

test('without TURN env the configured/static list is used, else STUN fallback', () => {
  const configured = ice.buildIceServers({
    rawSetting: '[{"urls":"stun:custom.example.com:3478"}]', env: {}, userId: 5, now: 0,
  });
  assert.equal(configured.ice_servers[0].urls, 'stun:custom.example.com:3478');
  assert.equal(configured.expires_at, null);

  const fallback = ice.buildIceServers({ rawSetting: '', env: {}, userId: 5, now: 0 });
  assert.ok(fallback.ice_servers.length >= 1);
  assert.match(String(fallback.ice_servers[0].urls), /^stun:/);
});

test('env TURN mints short-lived coturn credentials and replaces static TURN', () => {
  const now = 1700000000000;
  const built = ice.buildIceServers({
    rawSetting: JSON.stringify([
      { urls: 'stun:keep.example.com:3478' },
      { urls: 'turn:static.example.com:3478', username: 'static-user', credential: 'static-pass' },
    ]),
    env: {
      PROCTOR_TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:5349',
      PROCTOR_TURN_SECRET: 'test-secret',
      PROCTOR_TURN_TTL_SECONDS: '600',
    },
    userId: 42,
    now,
  });
  const turn = built.ice_servers.find((s) => JSON.stringify(s.urls).includes('relay.example.com'));
  assert.ok(turn, 'env TURN server present');
  assert.equal(built.ice_servers.some((s) => JSON.stringify(s).includes('static-pass')), false);
  const expectedUser = `${Math.floor(now / 1000) + 600}:42`;
  assert.equal(turn.username, expectedUser);
  const expectedCredential = crypto.createHmac('sha1', 'test-secret').update(expectedUser).digest('base64');
  assert.equal(turn.credential, expectedCredential);
  assert.equal(built.expires_at, new Date((Math.floor(now / 1000) + 600) * 1000).toISOString());
  // Static STUN survives alongside the minted TURN entry.
  assert.ok(built.ice_servers.some((s) => String(s.urls).includes('keep.example.com')));
});
