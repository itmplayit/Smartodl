'use strict';

/**
 * Stable per-attempt question ordering.
 *
 * Live quizzes use a deterministic randomized Latin-square assignment. For the
 * first N participants in a session (N = question count), every displayed
 * question number points to a different underlying question for every student.
 * This is the strongest mathematically possible guarantee: once participants
 * outnumber questions, at least two students must share a question at a given
 * ordinal. Additional groups receive a new shuffled base so complete papers do
 * not simply repeat.
 *
 * Regular quizzes with shuffle enabled get a deterministic attempt-specific
 * shuffle. Determinism is important: reload/resume/result-review must never
 * renumber a student's paper.
 */
const crypto = require('crypto');

function randomStream(seed) {
  let block = Buffer.alloc(0);
  let cursor = 0;
  let counter = 0;
  return () => {
    if (cursor + 4 > block.length) {
      block = crypto.createHash('sha256').update(`${seed}:${counter}`).digest();
      counter += 1;
      cursor = 0;
    }
    const value = block.readUInt32BE(cursor);
    cursor += 4;
    return value / 0x100000000;
  };
}

function stableShuffle(items, seed) {
  const output = [...items];
  const random = randomStream(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function rotate(items, offset) {
  if (!items.length) return [];
  const normalised = ((Number(offset) || 0) % items.length + items.length) % items.length;
  return normalised ? items.slice(normalised).concat(items.slice(0, normalised)) : [...items];
}

function buildQuestionOrder(questions, options = {}) {
  const source = Array.isArray(questions) ? questions : [];
  if (source.length < 2 || !options.shuffle) {
    return {
      questions: [...source],
      individualized: false,
      seat_number: options.live ? Math.max(1, Number(options.seatNumber) || 1) : null,
      unique_positions_for_first: source.length,
    };
  }

  if (options.live) {
    const seatNumber = Math.max(1, Math.floor(Number(options.seatNumber) || 1));
    const zeroBasedSeat = seatNumber - 1;
    const cycle = Math.floor(zeroBasedSeat / source.length);
    const seatInCycle = zeroBasedSeat % source.length;
    const seed = `smartodl-live:${options.quizId}:${options.sessionSeed || 'session'}:cycle:${cycle}`;
    // Randomize symbols (question ids), displayed columns and seat rows around a
    // Latin square. Every paper looks independently mixed while each displayed
    // column remains collision-free across this group of N students.
    const indices = source.map((_, index) => index);
    const symbols = stableShuffle(source, `${seed}:symbols`);
    const columns = stableShuffle(indices, `${seed}:columns`);
    const rows = stableShuffle(indices, `${seed}:rows`);
    const rowOffset = rows[seatInCycle];
    return {
      questions: columns.map((column) => symbols[(column + rowOffset) % source.length]),
      individualized: true,
      seat_number: seatNumber,
      cycle: cycle + 1,
      unique_positions_for_first: source.length,
    };
  }

  return {
    questions: stableShuffle(
      source,
      `smartodl-attempt:${options.quizId}:${options.attemptId}:${options.userId}`,
    ),
    individualized: true,
    seat_number: null,
    unique_positions_for_first: null,
  };
}

module.exports = { buildQuestionOrder, stableShuffle, rotate };
