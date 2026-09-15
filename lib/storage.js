// Chrome storage helper for user settings

export const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: 'zh-CN',
  engine: 'google', // 'google' | 'openai' | 'gemini' | 'deepseek' | 'ollama' | 'custom'

  // Optimization #1: Batch pre-translation settings
  batchSize: 10,             // Number of sentences to pre-translate ahead (default: 10 lines)
  bufferThreshold: 10,       // Pre-translate next batch when buffer drops below this (default: 10 lines)
  autoPreTranslate: true,    // Lookahead translate while playing
  maxLookaheadSeconds: 30,   // Or up to 30 seconds ahead

  // Optimization #3: Font size and styling
  originalFontSize: 16,      // px
  translatedFontSize: 24,    // px
  showOriginal: true,
  showTranslation: true,
  fontColor: '#ffffff',      // Translated font color
  originalFontColor: '#d1d5db', // Original font color
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  textStroke: true,
  subtitlePosition: 'bottom', // 'bottom' | 'top' | 'custom'
  customYPercent: 82,        // % from player top

  // Optimization #4: Local caching
  useCache: true,            // Prioritize local cache

  // TTS settings
  ttsEnabled: false,
  ttsVoice: '',
  ttsRate: 1.0,
  ttsVolume: 1.0,
  audioDucking: true,
  duckingLevel: 0.3,

  // API Providers
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',

  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com/v1',
  deepseekModel: 'deepseek-chat',

  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',

  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',

  customApiKey: '',
  customBaseUrl: '',
  customModel: '',

  systemPrompt: 'You are an expert video subtitle translator. Translate subtitles faithfully, naturally, and concisely in context. Maintain appropriate brevity suitable for real-time video subtitles.'
};

export async function getSettings() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...items });
      });
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...items });
      });
    } else {
      resolve(DEFAULT_SETTINGS);
    }
  });
}

export async function saveSettings(newSettings) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(newSettings, () => resolve(true));
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(newSettings, () => resolve(true));
    } else {
      resolve(true);
    }
  });
}
