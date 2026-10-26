'use strict';

/**
 * The single safe place for reading CLIENT_URL.
 *
 * Two issues repeatedly caused bugs:
 *
 *  1. CLIENT_URL may contain multiple comma-separated origins; the CORS allow-list
 *     in server.js is built that way. Code that treated the whole value as one URL
 *     produced invalid values such as "http://a,https://b".
 *
 *  2. `new URL(...)` throws a TypeError for an empty value or a value without
 *     a scheme. In one place (certificate rendering) that error was uncaught, so the whole page
 *     returned 500 "Service temporarily unavailable". This helper never throws;
 *     even with invalid configuration, it returns a usable fallback origin.
 */

const FALLBACK = 'http://localhost:5173';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

/** Return the origin of a parseable value, or null when it cannot be parsed. */
function parseOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    // "localhost:5173" also parses (with scheme "localhost:"), but its origin
    // is the string "null", so do not treat it as valid.
    return url.origin && url.origin !== 'null' ? url.origin : null;
  } catch (_) {
    return null;
  }
}

/**
 * Return the first configured client origin, including its scheme. This function never throws.
 * @returns {string} For example, "https://abc.trycloudflare.com".
 */
function clientOrigin() {
  const first = String(process.env.CLIENT_URL || '').split(',')[0].trim();

  const direct = parseOrigin(first);
  if (direct) return direct;

  // Was the scheme omitted, as in "abc.trycloudflare.com"? Use HTTP for a local
  // address and HTTPS otherwise.
  if (first && !first.includes('://')) {
    const guessed = parseOrigin(`${LOCAL_HOST.test(first) ? 'http' : 'https'}://${first}`);
    if (guessed) return guessed;
  }

  return FALLBACK;
}

/** Base URL without a trailing slash, for joining links. */
function clientBase() {
  return clientOrigin().replace(/\/+$/, '');
}

/** Report whether the configuration is valid, so startup can warn when it is not. */
function isClientUrlConfigured() {
  const first = String(process.env.CLIENT_URL || '').split(',')[0].trim();
  return Boolean(parseOrigin(first));
}

module.exports = { clientOrigin, clientBase, isClientUrlConfigured };
