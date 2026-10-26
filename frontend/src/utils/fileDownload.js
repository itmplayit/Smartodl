/**
 * Saves a binary axios response (responseType: 'blob') to the user's disk.
 *
 * The server already decides the filename in Content-Disposition, so we prefer
 * that and keep `fallback` only for the case where a proxy strips the header.
 */
export function downloadBlobResponse(res, fallback = 'download') {
  const blob = res.data instanceof Blob
    ? res.data
    : new Blob([res.data], { type: res.headers?.['content-type'] || 'application/octet-stream' });

  let filename = fallback;
  const disposition = res.headers?.['content-disposition'] || '';
  // RFC 5987 (filename*=UTF-8''…) first, then the plain quoted form.
  const encoded = /filename\*=UTF-8''([^;\n]+)/i.exec(disposition);
  const plain = /filename="?([^";\n]+)"?/i.exec(disposition);
  if (encoded) { try { filename = decodeURIComponent(encoded[1]); } catch (_) { /* keep fallback */ } }
  else if (plain) filename = plain[1].trim();

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
