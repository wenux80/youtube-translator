import { getSettings, saveSettings, parseRgbaColor, buildRgbaColor } from '../lib/storage.js';
import { SUPPORTED_LANGUAGES } from '../lib/languages.js';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();

  // Populate languages
  const langSelect = document.getElementById('target-lang');
  SUPPORTED_LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = `${lang.nativeName} (${lang.name})`;
    if (lang.code === settings.targetLang) opt.selected = true;
    langSelect.appendChild(opt);
  });

  // Init Form Values
  const enabledToggle = document.getElementById('enabled-toggle');
  const engineSelect = document.getElementById('engine-select');
  const batchSizeInput = document.getElementById('batch-size');
  const autoPretranslateCheck = document.getElementById('auto-pretranslate');
  const transFontSizeSlider = document.getElementById('trans-font-size');
  const origFontSizeSlider = document.getElementById('orig-font-size');
  const subWidthSlider = document.getElementById('sub-width-slider');
  const transFontVal = document.getElementById('trans-font-val');
  const origFontVal = document.getElementById('orig-font-val');
  const subWidthVal = document.getElementById('sub-width-val');
  const origFontColorInput = document.getElementById('orig-font-color');
  const transFontColorInput = document.getElementById('trans-font-color');
  const bgColorPicker = document.getElementById('bg-color-picker');
  const bgOpacitySlider = document.getElementById('bg-opacity-slider');
  const bgOpacityVal = document.getElementById('bg-opacity-val');
  const bgTransparentBtn = document.getElementById('bg-transparent-btn');
  const showOrigCheck = document.getElementById('show-orig');
  const showTransCheck = document.getElementById('show-trans');
  const useCacheCheck = document.getElementById('use-cache');
  const ttsEnabledCheck = document.getElementById('tts-enabled');
  const ttsRateSlider = document.getElementById('tts-rate');
  const ttsRateVal = document.getElementById('tts-rate-val');
  const audioDuckingCheck = document.getElementById('audio-ducking');

  enabledToggle.checked = !!settings.enabled;
  engineSelect.value = settings.engine || 'google';
  batchSizeInput.value = settings.batchSize || 10;
  autoPretranslateCheck.checked = !!settings.autoPreTranslate;

  transFontSizeSlider.value = settings.translatedFontSize || 24;
  transFontVal.textContent = transFontSizeSlider.value;
  origFontSizeSlider.value = settings.originalFontSize || 16;
  origFontVal.textContent = origFontSizeSlider.value;
  subWidthSlider.value = settings.subtitleMaxWidth || 85;
  subWidthVal.textContent = settings.subtitleWidthMode === 'fixed' ? `${subWidthSlider.value}%` : '自适应';
  origFontColorInput.value = settings.originalFontColor || '#d1d5db';
  transFontColorInput.value = settings.fontColor || '#ffffff';
  const parsedBg = parseRgbaColor(settings.backgroundColor || 'rgba(0, 0, 0, 0.75)');
  bgColorPicker.value = parsedBg.hex;
  bgOpacitySlider.value = parsedBg.opacity;
  bgOpacityVal.textContent = parsedBg.opacity;

  showOrigCheck.checked = !!settings.showOriginal;
  showTransCheck.checked = !!settings.showTranslation;
  useCacheCheck.checked = !!settings.useCache;

  ttsEnabledCheck.checked = !!settings.ttsEnabled;
  ttsRateSlider.value = settings.ttsRate || 1.0;
  ttsRateVal.textContent = ttsRateSlider.value;
  audioDuckingCheck.checked = !!settings.audioDucking;

  // Bind change handlers
  enabledToggle.addEventListener('change', () => {
    saveSettings({ enabled: enabledToggle.checked });
  });

  langSelect.addEventListener('change', () => {
    saveSettings({ targetLang: langSelect.value });
  });

  engineSelect.addEventListener('change', () => {
    saveSettings({ engine: engineSelect.value });
  });

  // Optimization #1: Batch pre-translate
  batchSizeInput.addEventListener('change', () => {
    const val = Math.max(1, parseInt(batchSizeInput.value, 10) || 10);
    batchSizeInput.value = val;
    saveSettings({ batchSize: val });
  });

  autoPretranslateCheck.addEventListener('change', () => {
    saveSettings({ autoPreTranslate: autoPretranslateCheck.checked });
  });

  // Debounce frequent slider / color picker writes to avoid chrome.storage.sync quota errors
  const pendingSyncUpdates = {};
  let syncDebounceTimer = null;
  function saveSettingsDebounced(partial, delayMs = 250) {
    Object.assign(pendingSyncUpdates, partial);
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      const payload = { ...pendingSyncUpdates };
      Object.keys(pendingSyncUpdates).forEach(k => delete pendingSyncUpdates[k]);
      saveSettings(payload);
    }, delayMs);
  }

  // Optimization #3: Font size & color adjusters
  transFontSizeSlider.addEventListener('input', () => {
    transFontVal.textContent = transFontSizeSlider.value;
    saveSettingsDebounced({ translatedFontSize: parseInt(transFontSizeSlider.value, 10) });
  });

  origFontSizeSlider.addEventListener('input', () => {
    origFontVal.textContent = origFontSizeSlider.value;
    saveSettingsDebounced({ originalFontSize: parseInt(origFontSizeSlider.value, 10) });
  });

  subWidthSlider.addEventListener('input', () => {
    const val = parseInt(subWidthSlider.value, 10);
    subWidthVal.textContent = `${val}%`;
    saveSettingsDebounced({ subtitleWidthMode: 'fixed', subtitleMaxWidth: val });
  });

  const subWidthAutoBtn = document.getElementById('sub-width-auto-btn');
  if (subWidthAutoBtn) {
    subWidthAutoBtn.addEventListener('click', () => {
      subWidthSlider.value = 85;
      subWidthVal.textContent = '自适应';
      saveSettings({ subtitleWidthMode: 'auto', subtitleMaxWidth: 85 });
    });
  }

  origFontColorInput.addEventListener('input', () => {
    saveSettingsDebounced({ originalFontColor: origFontColorInput.value });
  });

  transFontColorInput.addEventListener('input', () => {
    saveSettingsDebounced({ fontColor: transFontColorInput.value });
  });

  const saveBackgroundStyle = () => {
    bgOpacityVal.textContent = bgOpacitySlider.value;
    saveSettingsDebounced({
      backgroundColor: buildRgbaColor(bgColorPicker.value, bgOpacitySlider.value)
    });
  };

  bgColorPicker.addEventListener('input', saveBackgroundStyle);
  bgOpacitySlider.addEventListener('input', saveBackgroundStyle);
  if (bgTransparentBtn) {
    bgTransparentBtn.addEventListener('click', () => {
      bgOpacitySlider.value = 0;
      bgOpacityVal.textContent = '0';
      saveSettings({
        backgroundColor: buildRgbaColor(bgColorPicker.value, 0)
      });
    });
  }

  showOrigCheck.addEventListener('change', () => {
    saveSettings({ showOriginal: showOrigCheck.checked });
  });

  showTransCheck.addEventListener('change', () => {
    saveSettings({ showTranslation: showTransCheck.checked });
  });

  // Optimization #4: Local caching
  useCacheCheck.addEventListener('change', () => {
    saveSettings({ useCache: useCacheCheck.checked });
  });

  // TTS
  ttsEnabledCheck.addEventListener('change', () => {
    saveSettings({ ttsEnabled: ttsEnabledCheck.checked });
  });

  ttsRateSlider.addEventListener('input', () => {
    ttsRateVal.textContent = ttsRateSlider.value;
    saveSettingsDebounced({ ttsRate: parseFloat(ttsRateSlider.value) });
  });

  audioDuckingCheck.addEventListener('change', () => {
    saveSettings({ audioDucking: audioDuckingCheck.checked });
  });

  // Open full options
  document.getElementById('open-options-btn').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  // Open cache manager tab directly
  const openCacheBtn = document.getElementById('open-cache-btn');
  if (openCacheBtn) {
    openCacheBtn.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('options/options.html#cache-manager'));
    });
  }
});
