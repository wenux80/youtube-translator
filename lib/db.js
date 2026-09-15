// IndexedDB storage for video subtitles and AI translations (Optimization #4 & #2)

const DB_NAME = 'YouTubeTranslatorDB';
const DB_VERSION = 1;
const STORE_NAME = 'subtitles_cache';

let dbInstance = null;

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('videoId', 'videoId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onversionchange = () => {
        try { dbInstance.close(); } catch (e) {}
        dbInstance = null;
      };
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

export function makeCacheKey(videoId, targetLang, engine) {
  return `${videoId}::${targetLang}::${engine}`;
}

/**
 * Retrieve cached subtitle record for a video
 */
export async function getSubtitleRecord(videoId, targetLang, engine) {
  try {
    const db = await openDB();
    const key = makeCacheKey(videoId, targetLang, engine);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('DB getSubtitleRecord failed:', err);
    return null;
  }
}

/**
 * Save or overwrite an entire subtitle record
 */
export async function saveSubtitleRecord(record) {
  try {
    const db = await openDB();
    const key = makeCacheKey(record.videoId, record.targetLang, record.engine);
    const data = {
      ...record,
      id: key,
      updatedAt: Date.now()
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('DB saveSubtitleRecord failed:', err);
    return false;
  }
}

/**
 * Update a batch of translated items into the cache (Optimization #1 & #4)
 */
export async function updateBatchTranslations(videoId, targetLang, engine, translatedItems, meta = {}) {
  try {
    let record = await getSubtitleRecord(videoId, targetLang, engine);
    const origRecord = await getOriginalSubtitleRecord(videoId);

    if (!record) {
      record = {
        videoId,
        targetLang,
        engine,
        videoTitle: meta.videoTitle || origRecord?.videoTitle || '',
        createdAt: Date.now(),
        items: []
      };
    }

    // Seed map with original or base items to ensure the complete subtitle track is preserved
    const map = new Map();
    const baseList = (origRecord?.items && origRecord.items.length > 0)
      ? origRecord.items
      : (Array.isArray(meta.baseItems) && meta.baseItems.length > 0 ? meta.baseItems : null);

    if (baseList) {
      baseList.forEach(item => {
        map.set(item.index, {
          index: item.index,
          start: (typeof item.start === 'number' && !isNaN(item.start)) ? item.start : 0,
          dur: (typeof item.dur === 'number' && !isNaN(item.dur)) ? item.dur : 2,
          end: (typeof item.end === 'number' && !isNaN(item.end)) ? item.end : (((typeof item.start === 'number' && !isNaN(item.start)) ? item.start : 0) + 2),
          text: item.text || '',
          translation: item.translation || '',
          status: item.translation ? 'translated' : 'pending'
        });
      });

      // Also ensure original subtitle record is saved if not present yet
      if (!origRecord) {
        saveOriginalSubtitleRecord(videoId, meta.videoTitle || '', baseList).catch(() => {});
      }
    }

    // Overlay any existing items in this record
    (record.items || []).forEach(item => {
      const prev = map.get(item.index) || {};
      map.set(item.index, { ...prev, ...item });
    });

    // Merge translated items by index, preserving timing and text
    translatedItems.forEach(item => {
      const prev = map.get(item.index) || {};
      map.set(item.index, {
        ...prev,
        ...item,
        text: item.text || prev.text || '',
        start: (typeof item.start === 'number' && !isNaN(item.start)) ? item.start : (typeof prev.start === 'number' ? prev.start : 0),
        dur: (typeof item.dur === 'number' && !isNaN(item.dur)) ? item.dur : (typeof prev.dur === 'number' ? prev.dur : 2),
        end: (typeof item.end === 'number' && !isNaN(item.end)) ? item.end : (typeof prev.end === 'number' ? prev.end : 2),
        translation: item.translation || prev.translation || '',
        status: 'translated'
      });
    });

    // Reconstruct sorted items array
    const sorted = Array.from(map.values()).sort((a, b) => a.index - b.index);
    record.items = sorted;
    record.updatedAt = Date.now();
    if (meta.videoTitle && !record.videoTitle) {
      record.videoTitle = meta.videoTitle;
    }

    await saveSubtitleRecord(record);
    return record;
  } catch (err) {
    console.warn('DB updateBatchTranslations failed:', err);
    return null;
  }
}

/**
 * Re-translate a single sentence and update it in local cache (Optimization #2)
 */
export async function updateSingleTranslation(videoId, targetLang, engine, index, newTranslation) {
  try {
    let record = await getSubtitleRecord(videoId, targetLang, engine);
    if (!record) {
      const origRecord = await getOriginalSubtitleRecord(videoId);
      if (origRecord && Array.isArray(origRecord.items) && origRecord.items.length > 0) {
        record = {
          videoId,
          targetLang,
          engine,
          videoTitle: origRecord.videoTitle || '',
          createdAt: Date.now(),
          items: origRecord.items.map(it => ({ ...it, translation: '', status: 'pending' }))
        };
      }
    }
    if (!record || !record.items) return null;

    const item = record.items.find(i => i.index === index);
    if (item) {
      item.translation = newTranslation;
      item.status = 'translated';
      item.retranslatedAt = Date.now();
      record.updatedAt = Date.now();
      await saveSubtitleRecord(record);
      return item;
    }
    return null;
  } catch (err) {
    console.warn('DB updateSingleTranslation failed:', err);
    return null;
  }
}

/**
 * Get all cached video records for cache management UI
 */
export async function getAllCachedRecords() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('DB getAllCachedRecords failed:', err);
    return [];
  }
}

/**
 * Delete a specific video subtitle cache
 */
export async function deleteCache(videoId, targetLang, engine) {
  try {
    const db = await openDB();
    const key = makeCacheKey(videoId, targetLang, engine);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('DB deleteCache failed:', err);
    return false;
  }
}

/**
 * Clear all cache entries
 */
export async function clearAllCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('DB clearAllCache failed:', err);
    return false;
  }
}

/**
 * Save original untranslated subtitle track to cache
 */
export async function saveOriginalSubtitleRecord(videoId, videoTitle, items, languageCode = 'en') {
  if (!videoId || !items || items.length === 0) return false;
  return saveSubtitleRecord({
    videoId,
    targetLang: 'original',
    engine: 'source',
    videoTitle: videoTitle || '',
    languageCode,
    items: items.map(it => ({
      index: it.index,
      start: it.start,
      dur: it.dur,
      end: it.end,
      text: it.text
    }))
  });
}

/**
 * Get cached original subtitle track for a video
 */
export async function getOriginalSubtitleRecord(videoId) {
  if (!videoId) return null;
  return getSubtitleRecord(videoId, 'original', 'source');
}

/**
 * Find any cached subtitle record (original or previously translated) for this video
 */
export async function getAnySubtitleRecordForVideo(videoId) {
  if (!videoId) return null;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('videoId');
      const req = index.get(videoId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('DB getAnySubtitleRecordForVideo failed:', err);
    return null;
  }
}

