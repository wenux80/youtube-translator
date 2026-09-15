import { getSettings, saveSettings } from '../lib/storage.js';
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
  const transFontVal = document.getElementById('trans-font-val');
  const origFontVal = document.getElementById('orig-font-val');
  const origFontColorInput = document.getElementById('orig-font-color');
  const transFontColorInput = document.getElementById('trans-font-color');
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
  origFontColorInput.value = settings.originalFontColor || '#d1d5db';
  transFontColorInput.value = settings.fontColor || '#ffffff';

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

  // Optimization #3: Font size & color adjusters
  transFontSizeSlider.addEventListener('input', () => {
    transFontVal.textContent = transFontSizeSlider.value;
    saveSettings({ translatedFontSize: parseInt(transFontSizeSlider.value, 10) });
  });

  origFontSizeSlider.addEventListener('input', () => {
    origFontVal.textContent = origFontSizeSlider.value;
    saveSettings({ originalFontSize: parseInt(origFontSizeSlider.value, 10) });
  });

  origFontColorInput.addEventListener('input', () => {
    saveSettings({ originalFontColor: origFontColorInput.value });
  });

  transFontColorInput.addEventListener('input', () => {
    saveSettings({ fontColor: transFontColorInput.value });
  });

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
    saveSettings({ ttsRate: parseFloat(ttsRateSlider.value) });
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
