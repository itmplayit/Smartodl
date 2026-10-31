'use strict';
/** Print RFC1918 IPv4 URLs for the Vite LAN opt-in (does not expose the API port). */
const os = require('os');
const port = Math.max(1, Math.min(65535, Number(process.argv[2]) || 5173));
const ignoredInterface = /loopback|virtual|vmware|virtualbox|hyper-v|wsl|docker|bluetooth|tunnel/i;
const interfaces = os.networkInterfaces();
const candidates = [];

function isPrivateIpv4(address) {
  const octets = String(address).split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

Object.entries(interfaces).forEach(([name, addresses]) => {
  if (ignoredInterface.test(name)) return;
  (addresses || []).forEach((entry) => {
    const isV4 = entry.family === 'IPv4' || entry.family === 4;
    if (isV4 && !entry.internal && isPrivateIpv4(entry.address)) {
      candidates.push({ name, address: entry.address, preferred: /wi-?fi|wireless|ethernet|wlan|en\d|eth\d/i.test(name) });
    }
  });
});

const unique = Array.from(new Map(candidates.map((item) => [item.address, item])).values())
  .sort((a, b) => Number(b.preferred) - Number(a.preferred));
if (!unique.length) {
  console.log('[LAN] Could not auto-detect a private IPv4 address. Run `ipconfig` and use the Wi-Fi/Ethernet IPv4 address.');
  process.exit(0);
}
unique.forEach((item) => console.log(`[LAN] ${item.name}: http://${item.address}:${port}`));
console.log('[LAN] Open one of these URLs on a second device on the same trusted Wi-Fi/LAN (not localhost).');
