// Main Content Script for YouTube Translate & Speak
import { getSettings, saveSettings } from '../lib/storage.js';
import { SUPPORTED_LANGUAGES } from '../lib/languages.js';
import { tts } from '../lib/tts.js';
import { generateSRT, downloadSRT } from '../lib/srt.js';

// Database wrappers communicating with background service worker (Extension origin)
async function dbGetSubtitleRecord(videoId, targetLang, engine) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_GET_SUBTITLES',
        payload: { videoId, targetLang, engine }
      }, resolve);
    });
    return res?.success ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function dbUpdateBatchTranslations(videoId, targetLang, engine, items, meta = {}) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_UPDATE_BATCH',
        payload: { videoId, targetLang, engine, items, meta }
      }, resolve);
    });
    return res?.success ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function dbUpdateSingleTranslation(videoId, targetLang, engine, index, newTranslation) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_UPDATE_SINGLE',
        payload: { videoId, targetLang, engine, index, newTranslation }
      }, resolve);
    });
    return res?.success ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function dbDeleteCache(videoId, targetLang, engine) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_DELETE',
        payload: { videoId, targetLang, engine }
      }, resolve);
    });
    return res?.success;
  } catch (e) {
    return false;
  }
}

async function dbSaveOriginalSubtitles(videoId, videoTitle, items, languageCode = 'en') {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_SAVE_ORIGINAL',
        payload: { videoId, videoTitle, items, languageCode }
      }, resolve);
    });
    return res?.success;
  } catch (e) {
    return false;
  }
}

async function dbGetOriginalSubtitles(videoId) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_GET_ORIGINAL',
        payload: { videoId }
      }, resolve);
    });
    return res?.success ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function dbGetAnySubtitles(videoId) {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DB_GET_ANY',
        payload: { videoId }
      }, resolve);
    });
    return res?.success ? res.data : null;
  } catch (e) {
    return null;
  }
}

// Migrate any legacy cache stored in page-origin IndexedDB over to extension-origin IndexedDB
async function migrateLegacyPageCache() {
  try {
    if (typeof indexedDB === 'undefined') return;
    const req = indexedDB.open('YouTubeTranslatorDB', 1);
    req.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('subtitles_cache')) return;
      const tx = db.transaction('subtitles_cache', 'readonly');
      const store = tx.objectStore('subtitles_cache');
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const records = getAllReq.result || [];
        if (records.length > 0) {
          console.log(`[YouTube Translator] Migrating ${records.length} legacy page-origin records to extension DB...`);
          records.forEach(rec => {
            chrome.runtime.sendMessage({
              type: 'DB_SAVE_RECORD',
              payload: { record: rec }
            });
          });
          try {
            const clearTx = db.transaction('subtitles_cache', 'readwrite');
            clearTx.objectStore('subtitles_cache').clear();
          } catch (clearErr) {}
        }
      };
    };
  } catch (err) {
    // Ignore migration error
  }
}

let settings = null;
let currentVideoId = null;
let currentVideoTitle = '';
let captionTracks = [];
let subtitles = []; // Array of subtitle items
let activeIndex = -1;
let isTranslating = false;
let isDrawerOpen = false;
let playerCheckInterval = null;
let pendingLookaheadIndex = null;
let hasLiveSubtitles = false;
let lastProcessedTimedtextUrl = '';

export async function init() {
  console.log('[YouTube Translator] Initializing content script...');
  settings = await getSettings();

  // One-time sync of any legacy cache created in page origin
  migrateLegacyPageCache();

  // Listen for settings changes from popup/options
  chrome.storage.onChanged.addListener(async () => {
    settings = await getSettings();
    applyStyles();
    updateUIElements();
  });

  // Listen for messages from injected main world script (registered in manifest.json)
  window.addEventListener('message', handleMainWorldMessages);

  // Monitor video element and page changes
  startPlayerObserver();
}

// Handle messages from the main world
function handleMainWorldMessages(event) {
  if (!event.data || event.data.source !== 'YT_TRANSLATOR_MAIN') return;

  if (event.data.type === 'CAPTION_TRACKS_FOUND') {
    const { videoId, title, tracks } = event.data.payload;
    if (videoId && (videoId !== currentVideoId || !hasLiveSubtitles || captionTracks.length === 0)) {
      currentVideoId = videoId;
      currentVideoTitle = title || document.title;
      captionTracks = tracks || [];
      console.log('[YouTube Translator] Found tracks for video:', videoId, tracks);
      loadSubtitles();
    }
  } else if (event.data.type === 'TIMEDTEXT_DATA_CAPTURED') {
    const { url, rawText } = event.data.payload;
    if (rawText && (!hasLiveSubtitles || subtitles.length === 0)) {
      console.log('[YouTube Translator] Captured live timedtext data from network intercept');
      let trackLang = 'en';
      try {
        if (url) {
          const u = new URL(url);
          trackLang = u.searchParams.get('lang') || trackLang;
        }
      } catch (e) {}
      parseRawSubtitles(rawText, trackLang);
    }
  } else if (event.data.type === 'TIMEDTEXT_URL_DETECTED') {
    const { url } = event.data.payload;
    if (url && (!hasLiveSubtitles || subtitles.length === 0) && url !== lastProcessedTimedtextUrl) {
      console.log('[YouTube Translator] Detected active timedtext request:', url);
      let trackLang = 'en';
      try {
        const u = new URL(url);
        trackLang = u.searchParams.get('lang') || trackLang;
      } catch (e) {}
      fetchAndParseTimedtext(url, trackLang);
    }
  }
}

let lastTrackRequestTime = 0;
let isFetchingTimedtext = false;

// Start observing the YouTube video player
function startPlayerObserver() {
  const checkPlayer = () => {
    const video = document.querySelector('video');
    const playerContainer = document.getElementById('movie_player');
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (videoId && videoId !== currentVideoId) {
      currentVideoId = videoId;
      currentVideoTitle = document.title.replace(' - YouTube', '');
      subtitles = [];
      activeIndex = -1;
      captionTracks = [];
      hasLiveSubtitles = false;
      lastProcessedTimedtextUrl = '';
      lastTrackRequestTime = Date.now();
      loadSubtitles();
      // Ask injected script for tracks
      window.postMessage({ source: 'YT_TRANSLATOR_CONTENT', type: 'REQUEST_CAPTION_TRACKS' }, '*');
    } else if (videoId && !hasLiveSubtitles && !isFetchingTimedtext && (Date.now() - lastTrackRequestTime > 3000)) {
      // Periodically request tracks if live timedtext not yet loaded (catches late-initializing captions without CC)
      lastTrackRequestTime = Date.now();
      window.postMessage({ source: 'YT_TRANSLATOR_CONTENT', type: 'REQUEST_CAPTION_TRACKS' }, '*');
    }

    if (playerContainer && !document.getElementById('yt-translator-floating-bar')) {
      mountUI(playerContainer);
    }

    if (video && !video.__yt_translator_bound) {
      video.__yt_translator_bound = true;
      video.addEventListener('timeupdate', () => onTimeUpdate(video));
      video.addEventListener('seeked', () => onSeeked(video));
    }
  };

  checkPlayer();
  playerCheckInterval = setInterval(checkPlayer, 1000);
}

// Trigger lookahead translation and initial display starting at current video playback position
function triggerInitialLookahead() {
  const video = document.querySelector('video');
  const curTime = video ? video.currentTime : 0;
  const curIdx = subtitles.findIndex(item => curTime >= item.start && curTime <= (item.end + 0.5));
  let startIdx = curIdx;
  if (startIdx === -1 && curTime > 0) {
    startIdx = subtitles.findIndex(item => item.start >= curTime);
  }
  if (startIdx === -1) startIdx = 0;

  console.log(`[YouTube Translator] Initial batch starting around index ${startIdx} (video at ${curTime.toFixed(1)}s)`);

  if (curIdx !== -1 && subtitles[curIdx]) {
    activeIndex = curIdx;
    displaySubtitle(subtitles[curIdx]);
  } else if (curTime > 0) {
    const prevIdx = subtitles.findIndex(item => curTime >= item.end && curTime <= (item.end + 2.0));
    if (prevIdx !== -1 && subtitles[prevIdx]) {
      displaySubtitle(subtitles[prevIdx]);
    }
  }

  if (settings.autoPreTranslate && settings.showTranslation !== false) {
    checkLookaheadTranslation(startIdx, false);
  }
}

// Load subtitles: ALWAYS prioritize full caption tracks, with local cache as fallback
async function loadSubtitles() {
  if (!currentVideoId) return;

  // 1. If caption tracks are available, fetch the FULL timedtext track from YouTube
  if (captionTracks && captionTracks.length > 0) {
    let track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
      || captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en'))
      || captionTracks.find(t => !t.kind || t.kind !== 'asr')
      || captionTracks[0];

    if (track && track.baseUrl) {
      let timedTextUrl = track.baseUrl;
      if (!timedTextUrl.includes('fmt=')) {
        timedTextUrl += '&fmt=json3';
      }
      await fetchAndParseTimedtext(timedTextUrl, track.languageCode || 'en');
      return;
    }
  }

  // 2. Fallback: if live caption tracks not yet received, check local cache temporarily
  if (settings.useCache && !hasLiveSubtitles) {
    const isValidRecord = (rec) => rec && Array.isArray(rec.items) && rec.items.length > 0 && rec.items.some(i => typeof i.start === 'number' && !isNaN(i.start) && i.text);
    const normalizeCachedItem = (it) => ({
      index: it.index,
      start: (typeof it.start === 'number' && !isNaN(it.start)) ? it.start : 0,
      dur: (typeof it.dur === 'number' && !isNaN(it.dur)) ? it.dur : 2,
      end: (typeof it.end === 'number' && !isNaN(it.end)) ? it.end : (((typeof it.start === 'number' && !isNaN(it.start)) ? it.start : 0) + 2),
      text: it.text || '',
      translation: it.translation || '',
      status: it.status || (it.translation ? 'translated' : 'pending')
    });

    try {
      const [cached, origCached, anyCached] = await Promise.all([
        dbGetSubtitleRecord(currentVideoId, settings.targetLang, settings.engine),
        dbGetOriginalSubtitles(currentVideoId),
        dbGetAnySubtitles(currentVideoId)
      ]);

      const validRecords = [origCached, anyCached, cached].filter(isValidRecord);
      if (validRecords.length > 0) {
        // Pick the record with the most items as base track to ensure full subtitle list
        validRecords.sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0));
        const baseRecord = validRecords[0];

        // Collect all available translations and original text by index
        const transMap = new Map();
        const textMap = new Map();
        [origCached, anyCached, cached].forEach(rec => {
          if (rec && Array.isArray(rec.items)) {
            rec.items.forEach(it => {
              if (it.text && it.text.trim() && !textMap.has(it.index)) {
                textMap.set(it.index, it.text.trim());
              }
              if (it.translation && it.translation.trim()) {
                transMap.set(it.index, it.translation.trim());
              }
            });
          }
        });

        // Merge base items with translations and guaranteed original text
        const merged = baseRecord.items.map(it => {
          const norm = normalizeCachedItem(it);
          const trans = transMap.get(norm.index) || norm.translation || '';
          const origText = textMap.get(norm.index) || norm.text || '';
          return {
            ...norm,
            text: origText,
            translation: trans,
            status: trans ? 'translated' : 'pending'
          };
        });

        // If cached had extra items not present in baseRecord, append them
        [cached, anyCached].forEach(rec => {
          if (rec && Array.isArray(rec.items)) {
            rec.items.forEach(it => {
              if (!merged.some(m => m.index === it.index)) {
                merged.push(normalizeCachedItem(it));
              }
            });
          }
        });
        merged.sort((a, b) => a.index - b.index);

        if (!hasLiveSubtitles && merged.length > subtitles.length) {
          subtitles = merged;
          const hitCount = subtitles.filter(s => s.status === 'translated').length;
          console.log(`[YouTube Translator] Pre-loaded ${subtitles.length} items (${hitCount} translated) from cache`);
          if (hitCount > 0) {
            showToast(`已从缓存加载字幕 (${hitCount}/${subtitles.length} 条已翻译)`);
          }
          renderDrawerList();
          triggerInitialLookahead();
        }
      }
    } catch (cacheErr) {
      console.warn('[YouTube Translator] Cache fallback error:', cacheErr);
    }
  }
}

// Fetch and parse timedtext JSON3 / XML
async function fetchAndParseTimedtext(url, trackLang = 'en') {
  if (isFetchingTimedtext) return;
  isFetchingTimedtext = true;

  try {
    let rawText = null;

    // 1. Direct fetch inside YouTube page (same-origin, carries cookies and tokens)
    try {
      const direct = await fetch(url);
      if (direct.ok) {
        rawText = await direct.text();
      }
    } catch (directErr) {
      // Direct fetch failed, try background fallback
    }

    // 2. Background service worker fallback
    if (!rawText) {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_TIMEDTEXT', payload: { url } }, resolve);
      });
      if (res && res.success && res.data) {
        rawText = res.data;
      }
    }

    if (!rawText) {
      console.warn('[YouTube Translator] Unable to fetch timedtext from direct or background');
      return;
    }

    await parseRawSubtitles(rawText, trackLang);
  } catch (err) {
    console.error('[YouTube Translator] Error fetching subtitles:', err);
  } finally {
    isFetchingTimedtext = false;
  }
}

// Parse JSON3 or XML timedtext into normalized subtitle items and merge cache
async function parseRawSubtitles(raw, trackLang = 'en') {
  let parsedItems = [];

  // Try JSON3 format
  try {
    const json = JSON.parse(raw);
    if (json.events && Array.isArray(json.events)) {
      let idx = 0;
      json.events.forEach(evt => {
        if (!evt.segs) return;
        const text = evt.segs.map(s => s.utf8 || '').join('').trim();
        if (!text || text === '\n') return;

        const start = (evt.tStartMs || 0) / 1000;
        const dur = (evt.dDurationMs || 0) / 1000;
        parsedItems.push({
          index: idx++,
          start,
          dur: dur > 0 ? dur : 2.0,
          end: start + (dur > 0 ? dur : 2.0),
          text: text.replace(/\n+/g, ' '),
          translation: '',
          status: 'pending'
        });
      });
    }
  } catch (e) {
    // Fallback to XML format (handles both legacy format=1 <text> and modern format=3 <p t="ms" d="ms">)
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/xml');
      let nodes = Array.from(doc.querySelectorAll('text'));
      const isFormat3 = nodes.length === 0;
      if (isFormat3) {
        nodes = Array.from(doc.querySelectorAll('p'));
      }

      let idx = 0;
      nodes.forEach(node => {
        const text = (node.textContent || '').trim();
        if (!text) return;

        let start = 0;
        let dur = 2.0;

        if (isFormat3) {
          const tVal = node.getAttribute('t');
          const dVal = node.getAttribute('d');
          start = tVal !== null ? (parseFloat(tVal) / 1000) : 0;
          dur = dVal !== null ? (parseFloat(dVal) / 1000) : 2.0;
        } else {
          start = parseFloat(node.getAttribute('start') || '0');
          dur = parseFloat(node.getAttribute('dur') || '2');
        }

        parsedItems.push({
          index: idx++,
          start,
          dur: dur > 0 ? dur : 2.0,
          end: start + (dur > 0 ? dur : 2.0),
          text: text.replace(/\n+/g, ' '),
          translation: '',
          status: 'pending'
        });
      });
    } catch (xmlErr) {
      console.error('[YouTube Translator] XML parse failed:', xmlErr);
    }
  }

  if (parsedItems.length > 0) {
    hasLiveSubtitles = true;

    // Save original subtitles to local cache (Original subtitle cache)
    if (settings.useCache && currentVideoId) {
      dbSaveOriginalSubtitles(currentVideoId, currentVideoTitle, parsedItems, trackLang).catch(() => {});
    }

    // Preserve any existing translations already in memory
    if (subtitles && subtitles.length > 0) {
      subtitles.forEach(s => {
        if (s.translation && s.status === 'translated') {
          const target = parsedItems.find(p => p.index === s.index || (Math.abs(p.start - s.start) < 0.5 && p.text === s.text));
          if (target) {
            target.translation = s.translation;
            target.status = 'translated';
          }
        }
      });
    }

    // Merge existing translations from IndexedDB local cache!
    if (settings.useCache && currentVideoId) {
      try {
        const cached = await dbGetSubtitleRecord(currentVideoId, settings.targetLang, settings.engine);
        if (cached && cached.items && cached.items.length > 0) {
          const cachedMap = new Map();
          cached.items.forEach(c => {
            if (c.translation) {
              cachedMap.set(c.index, c.translation);
            }
          });
          let hitCount = 0;
          parsedItems.forEach(item => {
            if (!item.translation && cachedMap.has(item.index)) {
              item.translation = cachedMap.get(item.index);
              item.status = 'translated';
              hitCount++;
            }
          });
          if (hitCount > 0) {
            console.log(`[YouTube Translator] Merged ${hitCount} cached translations from IndexedDB!`);
            showToast(`已加载本地缓存 (${hitCount}/${parsedItems.length} 条)`);
          }
        }
      } catch (cacheErr) {
        console.warn('[YouTube Translator] Cache merge error:', cacheErr);
      }
    }

    subtitles = parsedItems;
    console.log(`[YouTube Translator] Subtitles ready: ${subtitles.length} items.`);
    renderDrawerList();

    triggerInitialLookahead();
  }
}

// Main playback loop (timeupdate)
function onTimeUpdate(video) {
  if (!settings.enabled || subtitles.length === 0) {
    hideSubtitleBox();
    return;
  }

  const currentTime = video.currentTime;
  const currentItemIndex = subtitles.findIndex(item =>
    currentTime >= item.start && currentTime <= (item.end + 0.3)
  );

  if (currentItemIndex !== -1) {
    const currentItem = subtitles[currentItemIndex];
    if (currentItemIndex !== activeIndex) {
      activeIndex = currentItemIndex;
      displaySubtitle(currentItem);

      // Trigger TTS if enabled
      if (settings.ttsEnabled && currentItem.translation) {
        tts.speak(currentItem.translation, {
          videoElement: video,
          ducking: settings.audioDucking,
          duckingLevel: settings.duckingLevel,
          rate: settings.ttsRate,
          volume: settings.ttsVolume,
          lang: settings.targetLang
        });
      }

      // Highlight active sentence in drawer
      highlightDrawerItem(currentItemIndex);
    } else {
      // Refresh display if translation just finished while on this sentence
      displaySubtitle(currentItem);
    }

    // Optimization #1: Check and pre-translate upcoming batch
    if (settings.autoPreTranslate && settings.showTranslation !== false) {
      checkLookaheadTranslation(currentItemIndex);
    }
  } else {
    // If between subtitles
    if (activeIndex !== -1) {
      const prevItem = subtitles[activeIndex];
      if (currentTime > (prevItem.end + 0.5) || currentTime < prevItem.start) {
        activeIndex = -1;
        hideSubtitleBox();
      }
    }
  }
}

let seekDebounceTimer = null;

function onSeeked(video) {
  tts.stop();
  activeIndex = -1;
  const currentTime = video.currentTime;
  const currIdx = subtitles.findIndex(item => currentTime >= item.start && currentTime <= (item.end + 0.5));
  let lookaheadIdx = currIdx;
  if (lookaheadIdx === -1) {
    lookaheadIdx = subtitles.findIndex(item => item.start >= currentTime);
  }
  if (currIdx !== -1) {
    activeIndex = currIdx;
    displaySubtitle(subtitles[currIdx]);
  }

  // Clear previous debounce timer to avoid firing while user is actively dragging the seekbar
  if (seekDebounceTimer) {
    clearTimeout(seekDebounceTimer);
  }

  // Debounce seek lookahead translation by 250ms
  seekDebounceTimer = setTimeout(() => {
    if (settings.autoPreTranslate && settings.showTranslation !== false && lookaheadIdx !== -1) {
      // Use force=false so replaying already-translated sections will NOT trigger redundant API translations!
      // Only when jumping to untranslated sections or when remaining buffer <= BUFFER_THRESHOLD will it translate.
      checkLookaheadTranslation(lookaheadIdx, false);
    }
  }, 250);
}

// ---------------- Optimization #1: Batch Pre-Translation (Buffer Watermark Strategy) ----------------

/**
 * Trigger condition:
 * - When remaining translated buffer ahead of playback is <= BUFFER_THRESHOLD (e.g. 3 lines),
 *   OR when current line itself is pending (e.g. initial start or user seek).
 * - Always collects a FULL batch of batchSize (default 10 lines) starting from the first untranslated line!
 */
async function checkLookaheadTranslation(currentIndex, force = false) {
  if (!settings.enabled || subtitles.length === 0 || settings.showTranslation === false) return;

  if (isTranslating) {
    pendingLookaheadIndex = currentIndex;
    return;
  }

  const currentIdx = Math.max(0, currentIndex);
  const currentItem = subtitles[currentIdx];
  if (!currentItem && !force) return;

  const batchSize = Math.max(1, parseInt(settings.batchSize || 10, 10));
  // User setting: trigger when translated buffer ahead < 10 lines (default 10)
  const BUFFER_THRESHOLD = Math.max(1, parseInt(settings.bufferThreshold ?? 10, 10));

  // Count consecutive translated lines ahead of current playback
  let translatedAheadCount = 0;
  if (currentItem && currentItem.status === 'translated') {
    for (let i = currentIdx + 1; i < subtitles.length; i++) {
      if (subtitles[i].status === 'translated') {
        translatedAheadCount++;
      } else {
        break;
      }
    }
  }

  // Check if we need to trigger next batch (buffer < BUFFER_THRESHOLD)
  const needFetch = force || !currentItem || currentItem.status !== 'translated' || translatedAheadCount < BUFFER_THRESHOLD;
  if (!needFetch) return;

  // Find the first untranslated sentence index at or after current position
  let firstPendingIndex = -1;
  const searchStart = force ? currentIdx : Math.max(0, currentIdx);
  for (let i = searchStart; i < subtitles.length; i++) {
    if (subtitles[i].status === 'pending') {
      firstPendingIndex = i;
      break;
    }
  }

  // If none found ahead, try finding any pending sentence from start
  if (firstPendingIndex === -1 && force) {
    firstPendingIndex = subtitles.findIndex(s => s.status === 'pending');
  }

  if (firstPendingIndex === -1) return; // All sentences already translated

  // If not a forced manual trigger, ensure the pending index is within a reasonable playback lookahead range
  const maxLookaheadDistance = Math.max(batchSize * 3, BUFFER_THRESHOLD + batchSize + 5);
  if (!force && firstPendingIndex - currentIdx > maxLookaheadDistance) {
    return;
  }

  // Collect a FULL BATCH of batchSize (e.g. exactly 10 sentences)
  const pendingItems = [];
  for (let i = firstPendingIndex; i < subtitles.length && pendingItems.length < batchSize; i++) {
    if (subtitles[i].status === 'pending') {
      pendingItems.push(subtitles[i]);
    }
  }

  if (pendingItems.length === 0) return;

  isTranslating = true;
  pendingItems.forEach(item => (item.status = 'translating'));
  renderDrawerProgress();

  console.log(`[YouTube Translator] Triggered batch translation: ${pendingItems.length} lines (indices ${pendingItems[0].index}..${pendingItems[pendingItems.length - 1].index}, translated ahead: ${translatedAheadCount})`);

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: {
          items: pendingItems.map(item => ({
            index: item.index,
            text: item.text,
            start: item.start,
            dur: item.dur
          })),
          targetLang: settings.targetLang,
          engine: settings.engine,
          settings
        }
      }, resolve);
    });

    if (response && response.success && Array.isArray(response.data)) {
      response.data.forEach(res => {
        const target = subtitles.find(s => s.index === res.index);
        if (target) {
          target.translation = res.translation;
          target.status = 'translated';
        }
      });

      // Save to local cache with FULL item timing and text metadata
      if (settings.useCache && currentVideoId) {
        const itemsToSave = response.data.map(res => {
          const target = subtitles.find(s => s.index === res.index) || pendingItems.find(p => p.index === res.index);
          return {
            index: res.index,
            translation: res.translation,
            text: target?.text || '',
            start: (typeof target?.start === 'number' && !isNaN(target.start)) ? target.start : 0,
            dur: (typeof target?.dur === 'number' && !isNaN(target.dur)) ? target.dur : 2,
            end: (typeof target?.end === 'number' && !isNaN(target.end)) ? target.end : 2,
            status: 'translated'
          };
        });

        await dbUpdateBatchTranslations(
          currentVideoId,
          settings.targetLang,
          settings.engine,
          itemsToSave,
          {
            videoTitle: currentVideoTitle,
            baseItems: subtitles.map(s => ({
              index: s.index,
              start: s.start,
              dur: s.dur,
              end: s.end,
              text: s.text
            }))
          }
        );
      }

      // Update currently active subtitle if in this batch
      if (activeIndex !== -1 && subtitles[activeIndex]) {
        displaySubtitle(subtitles[activeIndex]);
      }

      renderDrawerList();
    } else {
      console.warn('[YouTube Translator] Batch translation failed:', response?.error);
      pendingItems.forEach(item => (item.status = 'pending'));
    }
  } catch (err) {
    console.error('[YouTube Translator] Batch translation error:', err);
    pendingItems.forEach(item => (item.status = 'pending'));
  } finally {
    isTranslating = false;
    renderDrawerProgress();

    if (activeIndex !== -1 && subtitles[activeIndex]) {
      displaySubtitle(subtitles[activeIndex]);
    }

    if (pendingLookaheadIndex !== null) {
      const nextIdx = pendingLookaheadIndex;
      pendingLookaheadIndex = null;
      checkLookaheadTranslation(nextIdx);
    }
  }
}

// ---------------- Optimization #2: Re-translate Single Sentence ----------------

export async function retranslateSingle(index) {
  const item = subtitles.find(s => s.index === index);
  if (!item) return;

  const prevItem = subtitles.find(s => s.index === index - 1);
  const nextItem = subtitles.find(s => s.index === index + 1);

  item.status = 'translating';
  renderDrawerItem(item);
  showToast(`正在重新翻译第 ${index + 1} 句...`);

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'RETRANSLATE_SINGLE',
        payload: {
          item: { index: item.index, text: item.text },
          prevText: prevItem?.text || '',
          nextText: nextItem?.text || '',
          targetLang: settings.targetLang,
          engine: settings.engine,
          settings
        }
      }, resolve);
    });

    if (response && response.success && response.translation) {
      item.translation = response.translation;
      item.status = 'translated';

      // Update in local cache (Optimization #4)
      if (settings.useCache && currentVideoId) {
        await dbUpdateSingleTranslation(
          currentVideoId,
          settings.targetLang,
          settings.engine,
          index,
          response.translation
        );
      }

      showToast(`第 ${index + 1} 句重新翻译完成`);

      if (activeIndex === index) {
        displaySubtitle(item);
      }
      renderDrawerItem(item);
    } else {
      item.status = 'translated';
      showToast(`重新翻译失败: ${response?.error || '未知错误'}`);
    }
  } catch (err) {
    item.status = 'translated';
    showToast(`重新翻译失败: ${err.message}`);
  }
}

// ---------------- UI Rendering & Optimization #3: Font Styling ----------------

function applyStyles() {
  const root = document.documentElement;
  if (!root || !settings) return;

  root.style.setProperty('--yt-trans-orig-size', `${settings.originalFontSize || 16}px`);
  root.style.setProperty('--yt-trans-trans-size', `${settings.translatedFontSize || 24}px`);
  root.style.setProperty('--yt-trans-font-color', settings.fontColor || '#ffffff');
  root.style.setProperty('--yt-trans-orig-color', settings.originalFontColor || '#d1d5db');
  root.style.setProperty('--yt-trans-bg-color', settings.backgroundColor || 'rgba(0, 0, 0, 0.75)');
}

// Seek video to specific timestamp
export function seekToVideoTime(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return;

  // 1. Post to MAIN world for smooth YouTube player seeking
  window.postMessage({
    source: 'YT_TRANSLATOR_CONTENT',
    type: 'SEEK_TO',
    payload: { seconds }
  }, '*');

  // 2. Direct video element seek as fallback
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = seconds;
    if (typeof video.play === 'function') {
      video.play().catch(() => {});
    }
  }

  const pad = (n) => String(Math.floor(n)).padStart(2, '0');
  const timeStr = `${pad(seconds / 60)}:${pad(seconds % 60)}`;
  showToast(`已跳转到: ${timeStr}`);
}

// Copy subtitle text to clipboard
export function copySubtitleText(item) {
  if (!item) return;
  const orig = (item.text || '').trim();
  const trans = (item.translation || '').trim();
  let textToCopy = '';

  if (orig && trans) {
    textToCopy = `${orig}\n${trans}`;
  } else {
    textToCopy = trans || orig;
  }

  if (!textToCopy) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('📋 已复制双语字幕');
    }).catch(() => fallbackCopy(textToCopy));
  } else {
    fallbackCopy(textToCopy);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('📋 已复制双语字幕');
}

// Display modes: 'bilingual' (双语) | 'orig_only' (仅原文) | 'trans_only' (仅译文)
function getSubtitleMode() {
  const showOrig = settings.showOriginal !== false;
  const showTrans = settings.showTranslation !== false;
  if (showOrig && showTrans) return 'bilingual';
  if (showOrig && !showTrans) return 'orig_only';
  if (!showOrig && showTrans) return 'trans_only';
  return 'bilingual';
}

function getModeLabel() {
  const mode = getSubtitleMode();
  if (mode === 'orig_only') return '🔤 仅原文';
  if (mode === 'trans_only') return '🔤 仅译文';
  return '🔤 双语';
}

function cycleSubtitleMode() {
  const current = getSubtitleMode();
  if (current === 'bilingual') {
    settings.showOriginal = true;
    settings.showTranslation = false;
    showToast('字幕模式: 🔤 仅原文');
  } else if (current === 'orig_only') {
    settings.showOriginal = false;
    settings.showTranslation = true;
    showToast('字幕模式: 🔤 仅译文');
  } else {
    settings.showOriginal = true;
    settings.showTranslation = true;
    showToast('字幕模式: 🔤 双语对照');
  }

  saveSettings({
    showOriginal: settings.showOriginal,
    showTranslation: settings.showTranslation
  });

  updateUIElements();

  if (activeIndex !== -1 && subtitles[activeIndex]) {
    displaySubtitle(subtitles[activeIndex]);
  }

  // If switched back to bilingual or translation and autoPreTranslate is on, trigger pre-translation
  if (settings.enabled && settings.autoPreTranslate && settings.showTranslation && subtitles.length > 0) {
    const start = activeIndex !== -1 ? activeIndex : 0;
    checkLookaheadTranslation(start, false);
  }
}

function toggleNativeCC() {
  window.postMessage({
    source: 'YT_TRANSLATOR_CONTENT',
    type: 'TOGGLE_NATIVE_CC'
  }, '*');

  setTimeout(() => {
    const nativeCcBtn = document.querySelector('.ytp-subtitles-button');
    const isNativeOn = nativeCcBtn?.getAttribute('aria-pressed') === 'true';
    const nativeCcToggle = document.getElementById('yt-native-cc-toggle');
    if (nativeCcToggle) {
      nativeCcToggle.classList.toggle('active', isNativeOn);
    }
    showToast(isNativeOn ? '已开启 YouTube 原生 CC 字幕' : '已关闭 YouTube 原生 CC 字幕');
  }, 100);
}

function mountUI(playerContainer) {
  applyStyles();

  // 1. Create Subtitle Overlay Container
  let overlayContainer = document.getElementById('yt-translator-overlay-container');
  if (!overlayContainer) {
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'yt-translator-overlay-container';
    overlayContainer.innerHTML = `
      <div class="yt-trans-box" style="display: none;" title="点击重听本句，按住可拖拽位置，双击重置位置">
        <button class="yt-trans-corner-close" id="yt-corner-close-btn" title="关闭双语字幕">×</button>
        <div class="yt-trans-hover-actions">
          <button class="yt-trans-action-btn" id="yt-replay-btn" title="跳转至当前句子开头 (重新播放本句)">⏮️ 句首</button>
          <button class="yt-trans-action-btn" id="yt-copy-btn" title="复制当前双语字幕">📋 复制</button>
          <button class="yt-trans-action-btn" id="yt-mode-btn" title="切换显示模式 (双语 / 仅原文 / 仅译文)">🔤 模式</button>
          <button class="yt-trans-action-btn" id="yt-retrans-btn" title="重新翻译这句 (Optimization #2)">🔄 重译</button>
          <button class="yt-trans-action-btn" id="yt-speak-btn" title="朗读">🔊 朗读</button>
          <button class="yt-trans-action-btn yt-trans-close-btn" id="yt-close-btn" title="关闭字幕 (可在控制条重新开启)">✖ 关闭</button>
        </div>
        <div class="yt-trans-orig"></div>
        <div class="yt-trans-trans"></div>
      </div>
    `;
    playerContainer.appendChild(overlayContainer);

    // Make subtitle box draggable with click-to-seek support
    makeDraggable(overlayContainer);

    // Double-click subtitle box to reset to default centered position
    const transBox = overlayContainer.querySelector('.yt-trans-box');
    transBox.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      overlayContainer.classList.remove('custom-positioned');
      overlayContainer.style.top = '';
      overlayContainer.style.bottom = '';
      overlayContainer.style.left = '';
      overlayContainer.style.transform = '';
      showToast('字幕位置已重置为默认居中');
    });

    // Close subtitle button handler
    const handleCloseSubtitles = (e) => {
      e.stopPropagation();
      settings.enabled = false;
      saveSettings({ enabled: false });
      updateUIElements();
      hideSubtitleBox();

      // Automatically turn on YouTube native CC if it's currently off so user can still see original subtitles!
      const nativeCcBtn = document.querySelector('.ytp-subtitles-button');
      const isNativeOn = nativeCcBtn?.getAttribute('aria-pressed') === 'true';
      if (!isNativeOn) {
        window.postMessage({
          source: 'YT_TRANSLATOR_CONTENT',
          type: 'TOGGLE_NATIVE_CC',
          payload: { state: 'on' }
        }, '*');
        showToast('已关闭双语插件字幕，已为您开启 YouTube 原生 CC 字幕');
      } else {
        showToast('已关闭双语插件字幕 (原生 CC 字幕保持开启)');
      }
    };

    overlayContainer.querySelector('#yt-close-btn').addEventListener('click', handleCloseSubtitles);
    overlayContainer.querySelector('#yt-corner-close-btn').addEventListener('click', handleCloseSubtitles);

    // Bind hover action buttons
    overlayContainer.querySelector('#yt-replay-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeIndex !== -1 && subtitles[activeIndex]) {
        seekToVideoTime(subtitles[activeIndex].start);
      }
    });

    overlayContainer.querySelector('#yt-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeIndex !== -1 && subtitles[activeIndex]) {
        copySubtitleText(subtitles[activeIndex]);
      }
    });

    overlayContainer.querySelector('#yt-mode-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      cycleSubtitleMode();
    });

    overlayContainer.querySelector('#yt-retrans-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeIndex !== -1) retranslateSingle(activeIndex);
    });

    overlayContainer.querySelector('#yt-speak-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeIndex !== -1 && subtitles[activeIndex]) {
        const item = subtitles[activeIndex];
        tts.speak(item.translation || item.text, {
          videoElement: document.querySelector('video'),
          ducking: settings.audioDucking,
          duckingLevel: settings.duckingLevel,
          rate: settings.ttsRate,
          volume: settings.ttsVolume,
          lang: settings.targetLang
        });
      }
    });
  }

  // 2. Create Floating Control Bar
  let floatingBar = document.getElementById('yt-translator-floating-bar');
  if (!floatingBar) {
    floatingBar = document.createElement('div');
    floatingBar.id = 'yt-translator-floating-bar';
    floatingBar.innerHTML = `
      <button class="yt-bar-btn ${settings.enabled ? 'active' : ''}" id="yt-toggle-btn" title="${settings.enabled ? '双语字幕已开启 (点击关闭)' : '双语字幕已关闭 (点击开启)'}">
        ${settings.enabled ? '🌐 翻译' : '🌐 开启翻译'}
      </button>

      <button class="yt-bar-btn" id="yt-mode-toggle" title="切换显示模式: 双语 / 仅原文 / 仅译文">
        ${getModeLabel()}
      </button>

      <button class="yt-bar-btn" id="yt-native-cc-toggle" title="开关 YouTube 原生 CC 字幕">
        📺 原生CC
      </button>

      <select class="yt-bar-select" id="yt-lang-select" title="目标语言">
        ${SUPPORTED_LANGUAGES.map(l => `<option value="${l.code}" ${l.code === settings.targetLang ? 'selected' : ''}>${l.nativeName}</option>`).join('')}
      </select>

      <select class="yt-bar-select" id="yt-engine-select" title="翻译引擎">
        <option value="google" ${settings.engine === 'google' ? 'selected' : ''}>Google (免Key)</option>
        <option value="openai" ${settings.engine === 'openai' ? 'selected' : ''}>OpenAI</option>
        <option value="deepseek" ${settings.engine === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
        <option value="gemini" ${settings.engine === 'gemini' ? 'selected' : ''}>Gemini</option>
        <option value="ollama" ${settings.engine === 'ollama' ? 'selected' : ''}>Ollama 本地</option>
        <option value="custom" ${settings.engine === 'custom' ? 'selected' : ''}>自定义 API</option>
      </select>

      <!-- Font size quick adjust (Optimization #3) -->
      <div class="yt-font-adjust" title="调整字号 (Optimization #3)">
        <button class="yt-font-btn" id="yt-font-dec">A-</button>
        <button class="yt-font-btn" id="yt-font-inc">A+</button>
      </div>

      <button class="yt-bar-btn ${settings.ttsEnabled ? 'active' : ''}" id="yt-tts-toggle" title="语音朗读开关">
        🔊
      </button>

      <button class="yt-bar-btn" id="yt-drawer-toggle" title="展开字幕侧边栏">
        📜 字幕列表
      </button>
    `;
    playerContainer.appendChild(floatingBar);

    // Bind Bar Event Listeners
    floatingBar.querySelector('#yt-toggle-btn').addEventListener('click', () => {
      settings.enabled = !settings.enabled;
      saveSettings({ enabled: settings.enabled });
      updateUIElements();
      if (!settings.enabled) {
        hideSubtitleBox();
        showToast('已关闭字幕翻译');
      } else {
        showToast('已开启字幕翻译');
        if (activeIndex !== -1 && subtitles[activeIndex]) {
          displaySubtitle(subtitles[activeIndex]);
        }
        if (settings.autoPreTranslate && subtitles.length > 0 && settings.showTranslation !== false) {
          triggerInitialLookahead();
        }
      }
    });

    floatingBar.querySelector('#yt-mode-toggle').addEventListener('click', cycleSubtitleMode);
    floatingBar.querySelector('#yt-native-cc-toggle').addEventListener('click', toggleNativeCC);

    floatingBar.querySelector('#yt-lang-select').addEventListener('change', (e) => {
      settings.targetLang = e.target.value;
      saveSettings({ targetLang: settings.targetLang });
      showToast(`切换语言: ${e.target.value}`);
      loadSubtitles();
    });

    floatingBar.querySelector('#yt-engine-select').addEventListener('change', (e) => {
      settings.engine = e.target.value;
      saveSettings({ engine: settings.engine });
      showToast(`切换引擎: ${e.target.value}`);
      loadSubtitles();
    });

    floatingBar.querySelector('#yt-font-dec').addEventListener('click', () => adjustFontSize(-2));
    floatingBar.querySelector('#yt-font-inc').addEventListener('click', () => adjustFontSize(2));

    floatingBar.querySelector('#yt-tts-toggle').addEventListener('click', () => {
      settings.ttsEnabled = !settings.ttsEnabled;
      saveSettings({ ttsEnabled: settings.ttsEnabled });
      updateUIElements();
      showToast(settings.ttsEnabled ? '已开启配音朗读' : '已关闭配音朗读');
    });

    floatingBar.querySelector('#yt-drawer-toggle').addEventListener('click', toggleDrawer);
  }

  // 3. Create Transcript Drawer attached to document.body
  if (!document.getElementById('yt-transcript-drawer')) {
    createDrawer();
  }
}

// Adjust font size (Optimization #3)
function adjustFontSize(delta) {
  const newSize = Math.max(12, Math.min(48, (settings.translatedFontSize || 24) + delta));
  const newOrigSize = Math.max(10, Math.min(36, (settings.originalFontSize || 16) + delta));
  settings.translatedFontSize = newSize;
  settings.originalFontSize = newOrigSize;
  saveSettings({ translatedFontSize: newSize, originalFontSize: newOrigSize });
  applyStyles();
  showToast(`字号调整为: ${newSize}px`);
}

function updateUIElements() {
  const toggleBtn = document.getElementById('yt-toggle-btn');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', !!settings.enabled);
    toggleBtn.textContent = settings.enabled ? '🌐 翻译' : '🌐 开启翻译';
    toggleBtn.title = settings.enabled ? '双语字幕已开启 (点击关闭)' : '双语字幕已关闭 (点击开启)';
  }

  const modeToggle = document.getElementById('yt-mode-toggle');
  if (modeToggle) {
    modeToggle.textContent = getModeLabel();
    const mode = getSubtitleMode();
    modeToggle.title = `当前模式: ${mode === 'orig_only' ? '仅原文' : (mode === 'trans_only' ? '仅译文' : '双语')} (点击切换)`;
  }

  const modeBtn = document.getElementById('yt-mode-btn');
  if (modeBtn) {
    modeBtn.textContent = getModeLabel();
  }

  const nativeCcToggle = document.getElementById('yt-native-cc-toggle');
  if (nativeCcToggle) {
    const nativeCcBtn = document.querySelector('.ytp-subtitles-button');
    const isNativeOn = nativeCcBtn?.getAttribute('aria-pressed') === 'true';
    nativeCcToggle.classList.toggle('active', isNativeOn);
  }

  const ttsBtn = document.getElementById('yt-tts-toggle');
  if (ttsBtn) {
    ttsBtn.classList.toggle('active', !!settings.ttsEnabled);
  }
}

function displaySubtitle(item) {
  if (!settings || !settings.enabled) {
    hideSubtitleBox();
    return;
  }

  const container = document.getElementById('yt-translator-overlay-container');
  if (!container) return;

  const box = container.querySelector('.yt-trans-box');
  const origEl = container.querySelector('.yt-trans-orig');
  const transEl = container.querySelector('.yt-trans-trans');

  if (!box || !origEl || !transEl) return;

  const showOrig = settings.showOriginal !== false;
  const showTrans = settings.showTranslation !== false;

  const origText = (item?.text || '').trim();
  const transText = (item?.translation || (item?.status === 'translating' ? '⏳ 翻译中...' : '')).trim();

  origEl.textContent = showOrig ? origText : '';
  origEl.style.display = (showOrig && origText) ? 'block' : 'none';

  transEl.textContent = showTrans ? transText : '';
  transEl.style.display = (showTrans && transText) ? 'block' : 'none';

  box.style.display = ((showOrig && origText) || (showTrans && transText)) ? 'inline-block' : 'none';
}

function hideSubtitleBox() {
  const box = document.querySelector('#yt-translator-overlay-container .yt-trans-box');
  if (box) box.style.display = 'none';
}

// Make the subtitle overlay draggable across the video player, with click-to-seek support
function makeDraggable(element) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let elemCenterX = 0;
  let elemTop = 0;
  let hasMoved = false;

  element.addEventListener('mousedown', (e) => {
    if (e.target.closest('.yt-trans-hover-actions') || e.target.closest('.yt-trans-corner-close')) return;
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      // Anchor on center: calculate center X relative to parent container
      elemCenterX = (rect.left + rect.width / 2) - parentRect.left;
      elemTop = rect.top - parentRect.top;
    }
    // IMPORTANT: DO NOT set element.style.top or style.bottom on mousedown!
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 4) {
      hasMoved = true;
    }
    if (!hasMoved) return;

    const parent = element.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const currentTop = elemTop + dy;
    const currentCenterX = elemCenterX + dx;

    // Convert to percentage so it scales cleanly across fullscreen and standard view!
    let topPercent = (currentTop / parentRect.height) * 100;
    let centerPercent = (currentCenterX / parentRect.width) * 100;

    topPercent = Math.max(5, Math.min(88, topPercent));
    centerPercent = Math.max(10, Math.min(90, centerPercent));

    element.classList.add('custom-positioned');
    element.style.bottom = 'auto';
    // Fixed anchor at horizontal center: text of varying lengths expands symmetrically!
    element.style.transform = 'translateX(-50%)';
    element.style.left = `${centerPercent}%`;
    element.style.top = `${topPercent}%`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging && !hasMoved) {
      // Clicking on the subtitle overlay directly jumps to current sentence start
      if (activeIndex !== -1 && subtitles[activeIndex]) {
        seekToVideoTime(subtitles[activeIndex].start);
      }
    }
    isDragging = false;
  });

  // Re-clamp position on fullscreen change or window resize
  const onResize = () => {
    if (!element.classList.contains('custom-positioned')) return;
    const parent = element.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.bottom > parentRect.bottom || rect.top < parentRect.top) {
      element.style.top = '80%';
    }
  };

  document.addEventListener('fullscreenchange', onResize);
  window.addEventListener('resize', onResize);
}

// ---------------- Transcript Drawer (Sidebar) ----------------

let drawerSearchFilter = '';

function createDrawer() {
  const drawer = document.createElement('div');
  drawer.id = 'yt-transcript-drawer';
  drawer.innerHTML = `
    <div class="yt-drawer-header">
      <div class="yt-drawer-title">
        <span>📜 双语字幕列表</span>
      </div>
      <button class="yt-drawer-close" id="yt-drawer-close-btn">&times;</button>
    </div>

    <div class="yt-drawer-toolbar">
      <div class="yt-drawer-search-wrapper">
        <span class="yt-drawer-search-icon">🔍</span>
        <input type="text" id="yt-drawer-search-input" class="yt-drawer-search-input" placeholder="搜索关键词，点击任意字幕直达对应视频进度...">
      </div>

      <div class="yt-drawer-row">
        <span class="yt-progress-label" id="yt-progress-label">翻译进度: 0 / 0</span>
        <div class="yt-drawer-actions">
          <button class="yt-btn-sm yt-btn-primary" id="yt-batch-next-btn" title="预处理指定条数 (Optimization #1)">
            ⚡ 预翻译下 ${settings.batchSize || 10} 条
          </button>
          <button class="yt-btn-sm" id="yt-export-srt-btn" title="导出双语 SRT 文件">
            📥 导出SRT
          </button>
          <button class="yt-btn-sm" id="yt-clear-cache-btn" title="清除当前视频缓存">
            🗑️ 清缓存
          </button>
          <button class="yt-btn-sm" id="yt-open-cache-mgr" title="打开扩展缓存管理页面">
            💾 管理缓存
          </button>
        </div>
      </div>
      <div class="yt-progress-bar-container">
        <div class="yt-progress-bar-fill" id="yt-progress-fill"></div>
      </div>
    </div>

    <div class="yt-drawer-list" id="yt-drawer-items-list">
      <div style="text-align: center; color: #64748b; padding: 20px;">暂无字幕，请播放视频或开启 CC</div>
    </div>
  `;

  document.body.appendChild(drawer);

  drawer.querySelector('#yt-drawer-close-btn').addEventListener('click', toggleDrawer);

  drawer.querySelector('#yt-drawer-search-input').addEventListener('input', (e) => {
    drawerSearchFilter = e.target.value.trim();
    renderDrawerList();
  });

  drawer.querySelector('#yt-batch-next-btn').addEventListener('click', () => {
    const video = document.querySelector('video');
    const start = activeIndex !== -1 ? activeIndex : 0;
    checkLookaheadTranslation(start, true);
  });

  drawer.querySelector('#yt-export-srt-btn').addEventListener('click', () => {
    if (subtitles.length === 0) {
      showToast('当前没有字幕可导出');
      return;
    }
    const srtContent = generateSRT(subtitles, 'bilingual');
    const filename = `${currentVideoTitle || 'youtube_subtitles'}_bilingual.srt`;
    downloadSRT(filename, srtContent);
    showToast('双语 SRT 已导出！');
  });

  drawer.querySelector('#yt-clear-cache-btn').addEventListener('click', async () => {
    if (!currentVideoId) return;
    await dbDeleteCache(currentVideoId, settings.targetLang, settings.engine);
    subtitles.forEach(s => {
      s.translation = '';
      s.status = 'pending';
    });
    showToast('已清空当前视频翻译缓存');
    renderDrawerList();
  });

  drawer.querySelector('#yt-open-cache-mgr').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'OPEN_OPTIONS_PAGE',
      payload: { tab: 'cache-manager' }
    });
  });
}

function toggleDrawer() {
  const drawer = document.getElementById('yt-transcript-drawer');
  if (!drawer) return;
  isDrawerOpen = !isDrawerOpen;
  drawer.classList.toggle('open', isDrawerOpen);
  if (isDrawerOpen) {
    renderDrawerList();
  }
}

function renderDrawerProgress() {
  const label = document.getElementById('yt-progress-label');
  const fill = document.getElementById('yt-progress-fill');
  if (!label || !fill) return;

  const total = subtitles.length;
  const translated = subtitles.filter(s => s.status === 'translated').length;
  const pct = total > 0 ? Math.round((translated / total) * 100) : 0;

  label.textContent = `翻译进度: ${translated} / ${total} (${pct}%)`;
  fill.style.width = `${pct}%`;
}

function renderDrawerList() {
  renderDrawerProgress();
  const listContainer = document.getElementById('yt-drawer-items-list');
  if (!listContainer || subtitles.length === 0) return;

  const query = (drawerSearchFilter || '').toLowerCase();
  const itemsToRender = query
    ? subtitles.filter(s =>
        (s.text && s.text.toLowerCase().includes(query)) ||
        (s.translation && s.translation.toLowerCase().includes(query))
      )
    : subtitles;

  if (itemsToRender.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; color: #64748b; padding: 24px;">未匹配到包含 "${escapeHTML(drawerSearchFilter)}" 的字幕内容</div>`;
    return;
  }

  listContainer.innerHTML = '';
  itemsToRender.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = `yt-drawer-item ${item.index === activeIndex ? 'active' : ''}`;
    itemEl.id = `yt-item-${item.index}`;
    itemEl.title = '点击直接跳转到该位置播放视频';

    const startSec = (typeof item.start === 'number' && !isNaN(item.start)) ? Math.max(0, item.start) : 0;
    const pad = (n) => String(Math.floor(n)).padStart(2, '0');
    const timeStr = `${pad(startSec / 60)}:${pad(startSec % 60)}`;

    let badgeClass = 'yt-badge-pending';
    let badgeText = '待翻译';
    if (item.status === 'translated') {
      badgeClass = 'yt-badge-cached';
      badgeText = '已就绪';
    } else if (item.status === 'translating') {
      badgeClass = 'yt-badge-translating';
      badgeText = '翻译中...';
    }

    itemEl.innerHTML = `
      <div class="yt-item-header">
        <div class="yt-header-left">
          <span class="yt-item-time" data-time="${startSec}">⏱️ ${timeStr}</span>
          <span class="yt-jump-hint">▶ 点击跳转播放</span>
        </div>
        <span class="yt-item-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="yt-item-orig">${escapeHTML(item.text || '（原文为空）')}</div>
      <div class="yt-item-trans">${escapeHTML(item.translation || (item.status === 'translating' ? '翻译中...' : ''))}</div>
      <div class="yt-item-actions">
        <button class="yt-item-btn yt-item-copy" data-index="${item.index}" title="复制这句字幕">
          📋 复制
        </button>
        <button class="yt-item-btn yt-item-retrans" data-index="${item.index}" title="重新翻译此句 (Optimization #2)">
          🔄 重译
        </button>
        <button class="yt-item-btn yt-item-speak" data-index="${item.index}" title="朗读">
          🔊 朗读
        </button>
      </div>
    `;

    // Clicking anywhere on the subtitle card jumps to that part of the video!
    itemEl.addEventListener('click', (e) => {
      // Don't trigger jump if clicking retranslate or speak buttons
      if (e.target.closest('.yt-item-actions') || e.target.closest('button')) return;
      seekToVideoTime(item.start);
    });

    // Copy single sentence button
    itemEl.querySelector('.yt-item-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copySubtitleText(item);
    });

    // Re-translate single sentence button (Optimization #2)
    itemEl.querySelector('.yt-item-retrans').addEventListener('click', (e) => {
      e.stopPropagation();
      retranslateSingle(item.index);
    });

    // Speak single sentence button
    itemEl.querySelector('.yt-item-speak').addEventListener('click', (e) => {
      e.stopPropagation();
      tts.speak(item.translation || item.text, {
        videoElement: document.querySelector('video'),
        ducking: settings.audioDucking,
        duckingLevel: settings.duckingLevel,
        rate: settings.ttsRate,
        volume: settings.ttsVolume,
        lang: settings.targetLang
      });
    });

    listContainer.appendChild(itemEl);
  });
}

function renderDrawerItem(item) {
  const itemEl = document.getElementById(`yt-item-${item.index}`);
  if (!itemEl) return;

  const transEl = itemEl.querySelector('.yt-item-trans');
  const badgeEl = itemEl.querySelector('.yt-item-badge');

  if (transEl) transEl.textContent = item.translation || (item.status === 'translating' ? '翻译中...' : '');
  if (badgeEl) {
    badgeEl.className = `yt-item-badge ${item.status === 'translated' ? 'yt-badge-cached' : 'yt-badge-translating'}`;
    badgeEl.textContent = item.status === 'translated' ? '已就绪' : '翻译中...';
  }
}

function highlightDrawerItem(index) {
  if (!isDrawerOpen) return;
  document.querySelectorAll('.yt-drawer-item.active').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById(`yt-item-${index}`);
  if (activeEl) {
    activeEl.classList.add('active');
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---------------- Helper Toast Notification ----------------

function showToast(msg) {
  const existing = document.querySelector('.yt-trans-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'yt-trans-toast';
  toast.textContent = msg;

  const player = document.getElementById('movie_player') || document.body;
  player.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentElement) toast.remove();
  }, 3000);
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
