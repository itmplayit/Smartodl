import test from 'node:test';
import assert from 'node:assert/strict';
import { certificateTierLabel, contestPlacementLabel, contestRankLabel } from '../src/utils/certificateLabels.js';

test('known tiers map to display labels', () => {
  assert.equal(certificateTierLabel('completion'), 'Completion');
  assert.equal(certificateTierLabel('excellence'), 'Excellence');
  assert.equal(certificateTierLabel('champion'), 'Champion');
  assert.equal(certificateTierLabel('runner_up'), 'Runner-Up');
  assert.equal(certificateTierLabel(''), '');
  assert.equal(certificateTierLabel(null), '');
});

test('top_N tiers become ordinals (incl. the 11-13 exception)', () => {
  assert.equal(certificateTierLabel('top_1'), '1st Place');
  assert.equal(certificateTierLabel('top_2'), '2nd Place');
  assert.equal(certificateTierLabel('top_3'), '3rd Place');
  assert.equal(certificateTierLabel('top_4'), '4th Place');
  assert.equal(certificateTierLabel('top_11'), '11th Place');
  assert.equal(certificateTierLabel('top_12'), '12th Place');
  assert.equal(certificateTierLabel('top_13'), '13th Place');
  assert.equal(certificateTierLabel('top_21'), '21st Place');
});

test('unknown tiers degrade to a readable label, placements/ranks do not crash', () => {
  assert.ok(certificateTierLabel('special_mention').length > 0);
  assert.equal(typeof contestPlacementLabel('champion'), 'string');
  assert.equal(typeof contestRankLabel('runner_up'), 'string');
  assert.equal(typeof contestPlacementLabel(undefined), 'string');
});
