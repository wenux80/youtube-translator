// Content script loader for Manifest V3 ES Modules
(async () => {
  try {
    const src = chrome.runtime.getURL('content/content.js');
    const module = await import(src);
    if (module && typeof module.init === 'function') {
      module.init();
    }
  } catch (err) {
    console.error('[YouTube Translator] Failed to load content module:', err);
  }
})();
