chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'classify') {
    console.log("[background] Classification request - server-only mode");
    sendResponse({
      ok: false,
      error: 'server-only-mode',
      prob: 0.90
    });
    return false;
  }
  if (message?.type === 'fetchImage' && message.url) {
    console.log("[background] Fetching image:", message.url.substring(0, 100));
    fetch(message.url)
      .then(resp => {
        if (!resp.ok) throw new Error('Network error ' + resp.status);
        return resp.arrayBuffer();
      })
      .then(buf => {
        console.log("[background] Image fetched successfully, size:", buf.byteLength);
        sendResponse({ arrayBuffer: buf });
      })
      .catch(err => {
        console.warn('[background] fetchImage error:', err.message, err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  return false;
});
