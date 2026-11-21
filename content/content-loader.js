// Content script loader for Manifest V3 ES Modules
(async () => {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    const src = chrome.runtime.getURL('content/content.js');
    const module = await import(src);
    if (module && typeof module.init === 'function') {
      module.init();
    }
  } catch (err) {
    if (String(err?.message || err).includes('Extension context invalidated')) return;
    console.warn('[YouTube Translator] Failed to load content module:', err);
  }
})();
