// Chrome storage helper for user settings

export const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: 'zh-CN',
  engine: 'google', // 'google' | 'openai' | 'gemini' | 'deepseek' | 'ollama' | 'custom'

  // Optimization #1: Batch pre-translation settings
  batchSize: 10,             // Number of sentences to pre-translate ahead (default: 10 lines)
  bufferThreshold: 10,       // Pre-translate next batch when buffer drops below this (default: 10 lines)
  batchCooldownSec: 3,       // Minimum wait (seconds) after a completed batch before next auto batch (0 = disabled)
  errorCooldownSec: 5,       // Base wait (seconds) after a failed translation batch before auto retry
  errorExponentialBackoff: true, // Double error cooldown on consecutive failures up to 60s
  autoPreTranslate: true,    // Lookahead translate while playing
  maxLookaheadSeconds: 30,   // Or up to 30 seconds ahead

  // Optimization #3: Font size and styling
  originalFontSize: 16,      // px
  translatedFontSize: 24,    // px
  subtitleMaxWidth: 85,      // % of player width (25 - 96)
  subtitleWidthMode: 'auto', // 'auto' (shrink-to-fit up to maxWidth) | 'fixed' (exact width %)
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

export function parseRgbaColor(colorStr) {
  const raw = String(colorStr || '').trim().toLowerCase();
  if (!raw) return { hex: '#000000', opacity: 75 };
  if (raw === 'transparent') return { hex: '#000000', opacity: 0 };

  const rgbaMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgbaMatch) {
    const clampByte = (n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0));
    const toHex = (n) => clampByte(n).toString(16).padStart(2, '0');
    const hex = `#${toHex(rgbaMatch[1])}${toHex(rgbaMatch[2])}${toHex(rgbaMatch[3])}`;
    const alpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    const opacity = Math.max(0, Math.min(100, Math.round((isNaN(alpha) ? 0.75 : alpha) * 100)));
    return { hex, opacity };
  }

  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return { hex: raw, opacity: 100 };
  }
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return {
      hex: `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`,
      opacity: 100
    };
  }
  return { hex: '#000000', opacity: 75 };
}

export function buildRgbaColor(hex, opacityPercent) {
  const cleanHex = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#000000';
  const r = parseInt(cleanHex.slice(1, 3), 16);
  const g = parseInt(cleanHex.slice(3, 5), 16);
  const b = parseInt(cleanHex.slice(5, 7), 16);
  const pct = Math.max(0, Math.min(100, Number(opacityPercent ?? 75)));
  const alpha = Number((pct / 100).toFixed(2));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function getSettings() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
          if (chrome.runtime.lastError) return resolve(DEFAULT_SETTINGS);
          resolve({ ...DEFAULT_SETTINGS, ...items });
        });
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
          if (chrome.runtime.lastError) return resolve(DEFAULT_SETTINGS);
          resolve({ ...DEFAULT_SETTINGS, ...items });
        });
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    } catch (e) {
      resolve(DEFAULT_SETTINGS);
    }
  });
}

export async function saveSettings(newSettings) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
        chrome.storage.sync.set(newSettings, () => resolve(!chrome.runtime.lastError));
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        chrome.storage.local.set(newSettings, () => resolve(!chrome.runtime.lastError));
      } else {
        resolve(false);
      }
    } catch (e) {
      resolve(false);
    }
  });
}
