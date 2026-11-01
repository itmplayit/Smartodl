'use strict';

/**
 * Turn a raw User-Agent string into a short, human-readable device label
 * ("Chrome on Windows 10/11") for the "my sessions" screen.
 *
 * Deliberately dependency-free: a full UA parser is a lot of bytes for a
 * label that only has to be *recognisable*, not exhaustive. Order matters —
 * Edge/Opera also advertise "Chrome", and Chrome also advertises "Safari".
 */
function deviceLabel(ua) {
  const s = String(ua || '').trim();
  if (!s) return 'Unknown device';

  let browser = 'Unknown browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  let os = '';
  if (/Windows NT 10|Windows NT 11/.test(s)) os = 'Windows 10/11';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

module.exports = { deviceLabel };
