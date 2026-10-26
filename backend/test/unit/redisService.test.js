'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Pin the env BEFORE the service is required: with no REDIS_URL the whole
// Redis layer must stay dormant (single-instance deployments never load it).
delete process.env.REDIS_URL;
const redis = require('../../services/redis.service');

test('without REDIS_URL, Redis stays off and no client is created', () => {
  assert.equal(redis.redisEnabled(), false);
  assert.equal(redis.getRedisClient(), null);
  assert.equal(redis.duplicateRedisClient(), null);
});
