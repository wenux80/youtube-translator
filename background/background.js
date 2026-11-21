// Background Service Worker for YouTube Translator & Speak
import { translateBatch, retranslateSingleSentence } from '../lib/translator.js';
import { getSettings, saveSettings } from '../lib/storage.js';
import {
  getSubtitleRecord,
  saveSubtitleRecord,
  updateBatchTranslations,
  updateSingleTranslation,
  clearItemTranslations,
  clearItemTranslationsByKey,
  getAllCachedRecords,
  deleteCache,
  deleteCacheBatch,
  updateVideoChannelMeta,
  clearAllCache,
  saveOriginalSubtitleRecord,
  getOriginalSubtitleRecord,
  getAnySubtitleRecordForVideo
} from '../lib/db.js';

console.log('[YouTube Translator] Background Service Worker initialized.');

async function broadcastCacheUpdated(payload, excludeTabId = null) {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://*.youtube.com/*', 'https://youtube.com/*', 'https://*.youtube-nocookie.com/*']
    });
    tabs.forEach(tab => {
      if (!tab?.id || tab.id === excludeTabId) return;
      chrome.tabs.sendMessage(tab.id, { type: 'CACHE_UPDATED', payload }).catch(() => {});
    });
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[YouTube Translator] Installed.');
});

// Handle incoming messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  if (type === 'TRANSLATE_BATCH') {
    const { items, targetLang, engine, settings } = payload;
    translateBatch(items, targetLang, engine, settings)
      .then(results => sendResponse({ success: true, data: results }))
      .catch(err => {
        console.warn('[Background] Batch translation failed:', err.message || err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  if (type === 'RETRANSLATE_SINGLE') {
    const { item, prevText, nextText, targetLang, engine, settings } = payload;
    retranslateSingleSentence(item, prevText, nextText, targetLang, engine, settings)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => {
        console.warn('[Background] Single re-translation failed:', err.message || err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (type === 'FETCH_TIMEDTEXT') {
    const { url } = payload;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // --- IndexedDB Operations (Extension Origin Sandbox) ---
  if (type === 'DB_GET_SUBTITLES') {
    const { videoId, targetLang, engine } = payload;
    getSubtitleRecord(videoId, targetLang, engine)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_UPDATE_BATCH') {
    const { videoId, targetLang, engine, items, meta } = payload;
    updateBatchTranslations(videoId, targetLang, engine, items, meta)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_UPDATE_SINGLE') {
    const { videoId, targetLang, engine, index, newTranslation } = payload;
    updateSingleTranslation(videoId, targetLang, engine, index, newTranslation)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_CLEAR_ITEMS') {
    const { videoId, targetLang, engine, indices } = payload;
    clearItemTranslations(videoId, targetLang, engine, indices)
      .then(data => {
        broadcastCacheUpdated({ videoId, targetLang, engine, indices }, sender?.tab?.id);
        sendResponse({ success: true, data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_CLEAR_ITEMS_BY_KEY') {
    const { key, indices } = payload;
    clearItemTranslationsByKey(key, indices)
      .then(data => {
        broadcastCacheUpdated({
          key,
          keys: [key],
          videoId: data?.videoId || '',
          indices
        }, sender?.tab?.id);
        sendResponse({ success: true, data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_SAVE_RECORD') {
    const { record } = payload;
    saveSubtitleRecord(record)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_SAVE_ORIGINAL') {
    const { videoId, videoTitle, items, languageCode, channelName, channelId } = payload;
    saveOriginalSubtitleRecord(videoId, videoTitle, items, languageCode, channelName, channelId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_GET_ORIGINAL') {
    const { videoId } = payload;
    getOriginalSubtitleRecord(videoId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_GET_ANY') {
    const { videoId } = payload;
    getAnySubtitleRecordForVideo(videoId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_GET_ALL') {
    getAllCachedRecords()
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_DELETE') {
    const { videoId, targetLang, engine } = payload;
    deleteCache(videoId, targetLang, engine)
      .then(data => {
        broadcastCacheUpdated({ videoId, targetLang, engine }, sender?.tab?.id);
        sendResponse({ success: true, data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_DELETE_BATCH') {
    const { keys } = payload;
    deleteCacheBatch(keys)
      .then(data => {
        broadcastCacheUpdated({ keys }, sender?.tab?.id);
        sendResponse({ success: true, data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_UPDATE_CHANNEL_META') {
    const { videoId, channelName, channelId } = payload;
    updateVideoChannelMeta(videoId, channelName, channelId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'DB_CLEAR') {
    clearAllCache()
      .then(data => {
        broadcastCacheUpdated({ clearedAll: true }, sender?.tab?.id);
        sendResponse({ success: true, data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'OPEN_OPTIONS_PAGE') {
    const tabHash = payload?.tab ? `#${payload.tab}` : '';
    const optionsUrl = chrome.runtime.getURL(`options/options.html${tabHash}`);
    chrome.tabs.create({ url: optionsUrl });
    sendResponse({ success: true });
    return false;
  }

  if (type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse({ success: true, settings }));
    return true;
  }

  if (type === 'SAVE_SETTINGS') {
    saveSettings(payload).then(() => sendResponse({ success: true }));
    return true;
  }

  return false;
});
