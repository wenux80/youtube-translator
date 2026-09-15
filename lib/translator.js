// Multi-engine subtitle translation (Google Free, OpenAI, DeepSeek, Gemini, Ollama, Custom)
// Uses clear line-by-line batching with [number] prefixes (e.g. 10 lines per batch) for optimal token efficiency & stability

import { formatTargetLangName } from './languages.js';

/**
 * Translate a batch of subtitle items (e.g. 10 items at once)
 * @param {Array<{index: number, text: string, start: number, dur: number}>} items
 * @param {string} targetLang
 * @param {string} engine
 * @param {object} settings
 * @returns {Promise<Array<{index: number, translation: string}>>}
 */
export async function translateBatch(items, targetLang, engine, settings) {
  if (!items || items.length === 0) return [];

  switch (engine) {
    case 'google':
      return translateBatchWithGoogle(items, targetLang);
    case 'openai':
      return translateBatchWithOpenAI(items, targetLang, settings);
    case 'deepseek':
      return translateBatchWithDeepSeek(items, targetLang, settings);
    case 'gemini':
      return translateBatchWithGemini(items, targetLang, settings);
    case 'ollama':
      return translateBatchWithOllama(items, targetLang, settings);
    case 'custom':
      return translateBatchWithCustom(items, targetLang, settings);
    default:
      return translateBatchWithGoogle(items, targetLang);
  }
}

/**
 * Re-translate a single subtitle sentence with surrounding context (Optimization #2)
 */
export async function retranslateSingleSentence(targetItem, prevText, nextText, targetLang, engine, settings) {
  if (!targetItem || !targetItem.text) return '';

  if (engine === 'google') {
    return await translateGoogleSingle(targetItem.text, targetLang);
  }

  const langDisplay = formatTargetLangName(targetLang);
  let systemPrompt = `You are a subtitle translator. Translate each line to ${langDisplay}. RULES:
- Keep [number] prefix exactly
- Translate the COMPLETE meaning of the line
- No explanations`;

  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    systemPrompt += `\n\nADDITIONAL TRANSLATION GUIDELINES:\n${settings.systemPrompt.trim()}`;
  }

  const contextBlock = [];
  if (prevText) contextBlock.push(`[Previous] ${prevText}`);
  contextBlock.push(`[0] ${targetItem.text}`);
  if (nextText) contextBlock.push(`[Next] ${nextText}`);

  const userPrompt = `Context lines for reference:
${contextBlock.join('\n')}

Translate line [0] to ${langDisplay}:`;

  try {
    let raw = '';
    if (engine === 'openai' || engine === 'deepseek' || engine === 'custom') {
      const cfg = getOpenAICompatibleConfig(engine, settings);
      raw = await callOpenAIChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], cfg);
    } else if (engine === 'gemini') {
      raw = await callGemini(`${systemPrompt}\n\n${userPrompt}`, settings);
    } else if (engine === 'ollama') {
      raw = await callOllama(`${systemPrompt}\n\n${userPrompt}`, settings);
    }

    // Extract [0] result or clean text
    const match = raw.match(/\[0\]\s*(.*)$/m);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
    return raw.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    console.warn(`Re-translation with ${engine} failed, falling back to Google:`, err);
    return await translateGoogleSingle(targetItem.text, targetLang);
  }
}

// ---------------- Prompt Construction & Parsing ----------------

/**
 * Build batch translation prompt using standard [number] prefix format
 */
function buildBatchPrompt(items, targetLang, customSystemPrompt) {
  const langDisplay = formatTargetLangName(targetLang);
  let system = `You are a subtitle translator. Translate each line to ${langDisplay}. RULES:
- Keep [number] prefix exactly
- One translated line per input line, do NOT merge or skip
- Translate the COMPLETE meaning of each line
- No explanations`;

  if (customSystemPrompt && customSystemPrompt.trim()) {
    system += `\n\nADDITIONAL TRANSLATION GUIDELINES:\n${customSystemPrompt.trim()}`;
  }

  const lines = items.map((item, idx) => `[${idx}] ${item.text}`).join('\n');
  const user = `Translate each line to ${langDisplay}:\n${lines}`;
  return { system, user };
}

/**
 * Parse [number] prefix lines from LLM response into normalized items
 */
function parseBatchResponse(rawText, items) {
  if (!rawText) {
    return items.map(item => ({ index: item.index, translation: item.text }));
  }

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const map = new Map();

  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const text = match[2].trim();
      map.set(idx, text);
    }
  }

  return items.map((item, idx) => {
    let translation = map.get(idx);
    // In case the model returned absolute item.index instead of relative idx:
    if (translation === undefined) {
      translation = map.get(item.index);
    }
    // Fallback: if lines correspond 1:1 without brackets
    if (!translation && lines[idx]) {
      translation = lines[idx].replace(/^(?:\[\d+\]|\d+[.:])\s*/, '').trim();
    }
    return {
      index: item.index,
      translation: translation || item.text
    };
  });
}

// ---------------- Google Translate (Free) ----------------

async function translateGoogleSingle(text, targetLang) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map(segment => segment[0]).filter(Boolean).join('');
    }
    return text;
  } catch (err) {
    console.error('Google single translate error:', err);
    return text;
  }
}

async function translateBatchWithGoogle(items, targetLang) {
  const results = [];
  const chunkSize = 5;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (item) => {
      const translation = await translateGoogleSingle(item.text, targetLang);
      return { index: item.index, translation };
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}

// ---------------- OpenAI / DeepSeek / Custom (Chat Completions) ----------------

function getOpenAICompatibleConfig(engine, settings) {
  if (engine === 'deepseek') {
    return {
      apiKey: settings.deepseekApiKey,
      baseUrl: (settings.deepseekBaseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      model: settings.deepseekModel || 'deepseek-chat'
    };
  } else if (engine === 'custom') {
    return {
      apiKey: settings.customApiKey,
      baseUrl: (settings.customBaseUrl || '').replace(/\/+$/, ''),
      model: settings.customModel || 'gpt-4o-mini'
    };
  } else {
    // default: openai
    return {
      apiKey: settings.openaiApiKey,
      baseUrl: (settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: settings.openaiModel || 'gpt-4o-mini'
    };
  }
}

async function callOpenAIChat(messages, config) {
  if (!config.apiKey && !config.baseUrl.includes('localhost')) {
    throw new Error(`API key is missing for ${config.model}`);
  }

  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages,
    temperature: 0.2
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function translateBatchWithOpenAICompatible(items, targetLang, config, settings) {
  const { system, user } = buildBatchPrompt(items, targetLang, settings.systemPrompt);

  let raw = '';
  try {
    raw = await callOpenAIChat([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], config);
  } catch (err) {
    console.error('LLM Translation call failed:', err);
    throw err;
  }

  return parseBatchResponse(raw, items);
}

async function translateBatchWithOpenAI(items, targetLang, settings) {
  const config = getOpenAICompatibleConfig('openai', settings);
  return translateBatchWithOpenAICompatible(items, targetLang, config, settings);
}

async function translateBatchWithDeepSeek(items, targetLang, settings) {
  const config = getOpenAICompatibleConfig('deepseek', settings);
  return translateBatchWithOpenAICompatible(items, targetLang, config, settings);
}

async function translateBatchWithCustom(items, targetLang, settings) {
  const config = getOpenAICompatibleConfig('custom', settings);
  return translateBatchWithOpenAICompatible(items, targetLang, config, settings);
}

// ---------------- Google Gemini ----------------

async function callGemini(promptText, settings) {
  const apiKey = settings.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const model = settings.geminiModel || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.2
      }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini Error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function translateBatchWithGemini(items, targetLang, settings) {
  const { system, user } = buildBatchPrompt(items, targetLang, settings.systemPrompt);
  const prompt = `${system}\n\n${user}`;
  const raw = await callGemini(prompt, settings);
  return parseBatchResponse(raw, items);
}

// ---------------- Local Ollama ----------------

async function callOllama(promptText, settings) {
  const baseUrl = (settings.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = settings.ollamaModel || 'llama3.2';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: promptText,
      stream: false,
      options: { temperature: 0.2 }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Ollama Error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.response || '';
}

async function translateBatchWithOllama(items, targetLang, settings) {
  const { system, user } = buildBatchPrompt(items, targetLang, settings.systemPrompt);
  const prompt = `${system}\n\n${user}`;
  const raw = await callOllama(prompt, settings);
  return parseBatchResponse(raw, items);
}
