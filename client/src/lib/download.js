/**
 * Hands a fetched file to the user.
 *
 * On a phone the share sheet is how a file reaches «Fichiers», WhatsApp or the
 * printer, and a bare download link is unreliable inside an installed PWA on
 * iOS — so touch devices that can share files get the share sheet first. A
 * refused share (not a cancelled one) falls back to the plain download link,
 * which is what desktops get directly.
 */
export async function saveFile(blob, filename) {
  const type = blob.type || 'application/pdf';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && typeof File === 'function' && navigator.canShare) {
    const file = new File([blob], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the browser to start the download before the URL dies
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
