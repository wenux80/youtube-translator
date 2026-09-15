// Options page logic
import { getSettings, saveSettings } from '../lib/storage.js';
import { getAllCachedRecords, deleteCache, clearAllCache } from '../lib/db.js';
import { generateSRT, downloadSRT } from '../lib/srt.js';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();

  // Tab Switching
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const targetId = `tab-${tab.dataset.tab}`;
      document.getElementById(targetId)?.classList.add('active');

      if (tab.dataset.tab === 'cache-manager') {
        loadCacheTable();
      }
    });
  });

  // Populate Form Inputs
  document.getElementById('deepseek-key').value = settings.deepseekApiKey || '';
  document.getElementById('deepseek-url').value = settings.deepseekBaseUrl || 'https://api.deepseek.com/v1';
  document.getElementById('deepseek-model').value = settings.deepseekModel || 'deepseek-chat';

  document.getElementById('openai-key').value = settings.openaiApiKey || '';
  document.getElementById('openai-url').value = settings.openaiBaseUrl || 'https://api.openai.com/v1';
  document.getElementById('openai-model').value = settings.openaiModel || 'gpt-4o-mini';

  document.getElementById('gemini-key').value = settings.geminiApiKey || '';
  document.getElementById('gemini-model').value = settings.geminiModel || 'gemini-1.5-flash';

  document.getElementById('ollama-url').value = settings.ollamaBaseUrl || 'http://localhost:11434';
  document.getElementById('ollama-model').value = settings.ollamaModel || 'llama3.2';

  document.getElementById('custom-key').value = settings.customApiKey || '';
  document.getElementById('custom-url').value = settings.customBaseUrl || '';
  document.getElementById('custom-model').value = settings.customModel || '';

  document.getElementById('system-prompt').value = settings.systemPrompt || '';

  // Optimization #1: Batch pre-translate
  document.getElementById('opt-batch-size').value = settings.batchSize || 10;
  document.getElementById('opt-buffer-threshold').value = settings.bufferThreshold ?? 10;
  document.getElementById('opt-auto-pretranslate').checked = !!settings.autoPreTranslate;

  // Optimization #4: Local cache
  document.getElementById('opt-use-cache').checked = !!settings.useCache;

  // Optimization #3: Appearance
  const transSlider = document.getElementById('opt-trans-size');
  const origSlider = document.getElementById('opt-orig-size');
  const transLbl = document.getElementById('lbl-trans-size');
  const origLbl = document.getElementById('lbl-orig-size');
  const fontColor = document.getElementById('opt-font-color');
  const origColor = document.getElementById('opt-orig-font-color');
  const bgColor = document.getElementById('opt-bg-color');

  transSlider.value = settings.translatedFontSize || 24;
  origSlider.value = settings.originalFontSize || 16;
  transLbl.textContent = transSlider.value;
  origLbl.textContent = origSlider.value;
  fontColor.value = settings.fontColor || '#ffffff';
  origColor.value = settings.originalFontColor || '#d1d5db';
  bgColor.value = settings.backgroundColor || 'rgba(0, 0, 0, 0.75)';

  function updatePreview() {
    const box = document.getElementById('preview-box');
    const orig = document.getElementById('preview-orig');
    const trans = document.getElementById('preview-trans');

    orig.style.fontSize = `${origSlider.value}px`;
    orig.style.color = origColor.value;
    trans.style.fontSize = `${transSlider.value}px`;
    trans.style.color = fontColor.value;
    box.style.backgroundColor = bgColor.value;

    transLbl.textContent = transSlider.value;
    origLbl.textContent = origSlider.value;
  }

  transSlider.addEventListener('input', updatePreview);
  origSlider.addEventListener('input', updatePreview);
  fontColor.addEventListener('input', updatePreview);
  origColor.addEventListener('input', updatePreview);
  bgColor.addEventListener('input', updatePreview);
  updatePreview();

  // Save Settings
  document.getElementById('save-btn').addEventListener('click', async () => {
    const newSettings = {
      deepseekApiKey: document.getElementById('deepseek-key').value.trim(),
      deepseekBaseUrl: document.getElementById('deepseek-url').value.trim(),
      deepseekModel: document.getElementById('deepseek-model').value.trim(),

      openaiApiKey: document.getElementById('openai-key').value.trim(),
      openaiBaseUrl: document.getElementById('openai-url').value.trim(),
      openaiModel: document.getElementById('openai-model').value.trim(),

      geminiApiKey: document.getElementById('gemini-key').value.trim(),
      geminiModel: document.getElementById('gemini-model').value.trim(),

      ollamaBaseUrl: document.getElementById('ollama-url').value.trim(),
      ollamaModel: document.getElementById('ollama-model').value.trim(),

      customApiKey: document.getElementById('custom-key').value.trim(),
      customBaseUrl: document.getElementById('custom-url').value.trim(),
      customModel: document.getElementById('custom-model').value.trim(),

      systemPrompt: document.getElementById('system-prompt').value.trim(),

      batchSize: parseInt(document.getElementById('opt-batch-size').value, 10) || 10,
      bufferThreshold: parseInt(document.getElementById('opt-buffer-threshold').value, 10) || 10,
      autoPreTranslate: document.getElementById('opt-auto-pretranslate').checked,

      useCache: document.getElementById('opt-use-cache').checked,

      translatedFontSize: parseInt(transSlider.value, 10),
      originalFontSize: parseInt(origSlider.value, 10),
      fontColor: fontColor.value,
      originalFontColor: origColor.value,
      backgroundColor: bgColor.value
    };

    await saveSettings(newSettings);
    showToast('设置已保存成功！');
  });

  // Optimization #4: Cache Management Table
  async function loadCacheTable() {
    const tbody = document.getElementById('cache-list-body');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">
          正在加载缓存记录...
        </td>
      </tr>
    `;

    let records = [];
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'DB_GET_ALL' }, resolve);
      });
      if (res && res.success && Array.isArray(res.data)) {
        records = res.data;
      } else {
        records = await getAllCachedRecords();
      }
    } catch (e) {
      records = await getAllCachedRecords();
    }

    if (!records || records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">
            暂无已缓存的视频字幕记录
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    records.forEach(rec => {
      const tr = document.createElement('tr');
      const isOriginal = rec.targetLang === 'original';
      const translatedCount = (rec.items || []).filter(i => i.status === 'translated' || i.translation).length;
      const totalCount = (rec.items || []).length;
      const dateStr = rec.updatedAt ? new Date(rec.updatedAt).toLocaleString() : '-';

      const langBadge = isOriginal
        ? `<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">原版字幕</span>`
        : `<span class="badge">${escapeHTML(rec.targetLang)}</span>`;
      const engineBadge = isOriginal
        ? `<span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;">YouTube</span>`
        : `<span class="badge">${escapeHTML(rec.engine)}</span>`;
      const countDisplay = isOriginal
        ? `<strong>${totalCount}</strong> 条 (原版)`
        : `<strong>${translatedCount}</strong> / ${totalCount} 条`;

      tr.innerHTML = `
        <td>
          <div style="font-weight: 500;">${escapeHTML(rec.videoTitle || '未命名视频')}</div>
          <div style="font-size: 11px; color: #64748b;">ID: ${escapeHTML(rec.videoId)}</div>
        </td>
        <td>${langBadge}</td>
        <td>${engineBadge}</td>
        <td>${countDisplay}</td>
        <td style="font-size: 12px; color: #94a3b8;">${dateStr}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-primary export-rec-btn">📥 导出SRT</button>
            <button class="btn btn-sm btn-danger del-rec-btn">🗑️ 删除</button>
          </div>
        </td>
      `;

      tr.querySelector('.export-rec-btn').addEventListener('click', () => {
        const mode = isOriginal ? 'original' : 'bilingual';
        const srt = generateSRT(rec.items || [], mode);
        downloadSRT(`${rec.videoTitle || rec.videoId}_${rec.targetLang}.srt`, srt);
        showToast(isOriginal ? '已导出原版 SRT！' : '已导出双语 SRT！');
      });

      tr.querySelector('.del-rec-btn').addEventListener('click', async () => {
        if (confirm(`确定删除视频 "${rec.videoTitle || rec.videoId}" 的缓存吗？`)) {
          await new Promise(r => chrome.runtime.sendMessage({
            type: 'DB_DELETE',
            payload: { videoId: rec.videoId, targetLang: rec.targetLang, engine: rec.engine }
          }, r)).catch(() => {});
          await deleteCache(rec.videoId, rec.targetLang, rec.engine);
          showToast('缓存记录已删除');
          loadCacheTable();
        }
      });

      tbody.appendChild(tr);
    });
  }

  // Refresh cache button
  const refreshBtn = document.getElementById('refresh-cache-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadCacheTable();
      showToast('缓存列表已刷新');
    });
  }

  document.getElementById('clear-all-cache-btn').addEventListener('click', async () => {
    if (confirm('确定要清空所有本地翻译缓存记录吗？清空后再次播放将需要重新翻译。')) {
      await new Promise(r => chrome.runtime.sendMessage({ type: 'DB_CLEAR' }, r)).catch(() => {});
      await clearAllCache();
      showToast('所有本地缓存已清空！');
      loadCacheTable();
    }
  });

  // Handle hash navigation (e.g. #cache-manager)
  function handleHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'cache-manager' || hash === 'tab-cache-manager') {
      const cacheTabBtn = document.querySelector('.tab-btn[data-tab="cache-manager"]');
      if (cacheTabBtn) {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        cacheTabBtn.classList.add('active');
        document.getElementById('tab-cache-manager')?.classList.add('active');
        loadCacheTable();
      }
    }
  }

  window.addEventListener('hashchange', handleHash);
  handleHash();

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
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
});
