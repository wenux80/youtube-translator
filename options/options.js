// Options page logic
import { getSettings, saveSettings } from '../lib/storage.js';
import { getAllCachedRecords, deleteCache, deleteCacheBatch, updateVideoChannelMeta, clearAllCache, makeCacheKey } from '../lib/db.js';
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
  const subWidthSlider = document.getElementById('opt-sub-width');
  const transLbl = document.getElementById('lbl-trans-size');
  const origLbl = document.getElementById('lbl-orig-size');
  const subWidthLbl = document.getElementById('lbl-sub-width');
  const fontColor = document.getElementById('opt-font-color');
  const origColor = document.getElementById('opt-orig-font-color');
  const bgColor = document.getElementById('opt-bg-color');

  let currentWidthMode = settings.subtitleWidthMode === 'fixed' ? 'fixed' : 'auto';
  transSlider.value = settings.translatedFontSize || 24;
  origSlider.value = settings.originalFontSize || 16;
  subWidthSlider.value = settings.subtitleMaxWidth || 85;
  transLbl.textContent = transSlider.value;
  origLbl.textContent = origSlider.value;
  subWidthLbl.textContent = currentWidthMode === 'fixed' ? `${subWidthSlider.value}%` : '自适应';
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
    box.style.width = currentWidthMode === 'fixed' ? `${subWidthSlider.value}%` : '';
    box.style.maxWidth = `${subWidthSlider.value}%`;

    transLbl.textContent = transSlider.value;
    origLbl.textContent = origSlider.value;
    subWidthLbl.textContent = currentWidthMode === 'fixed' ? `${subWidthSlider.value}%` : '自适应';
  }

  transSlider.addEventListener('input', updatePreview);
  origSlider.addEventListener('input', updatePreview);
  subWidthSlider.addEventListener('input', () => {
    currentWidthMode = 'fixed';
    updatePreview();
  });
  const optSubWidthAutoBtn = document.getElementById('opt-sub-width-auto-btn');
  if (optSubWidthAutoBtn) {
    optSubWidthAutoBtn.addEventListener('click', () => {
      currentWidthMode = 'auto';
      subWidthSlider.value = 85;
      updatePreview();
    });
  }
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
      subtitleMaxWidth: parseInt(subWidthSlider.value, 10),
      subtitleWidthMode: currentWidthMode,
      fontColor: fontColor.value,
      originalFontColor: origColor.value,
      backgroundColor: bgColor.value
    };

    await saveSettings(newSettings);
    showToast('设置已保存成功！');
  });

  // Optimization #4: Channel-Grouped & Batch-Selectable Cache Management
  const UNKNOWN_CHANNEL = '未知频道 / 早期缓存';
  let allCachedRecords = [];
  const selectedKeys = new Set();
  const collapsedChannels = new Set();

  function getRecordKey(rec) {
    return rec.id || makeCacheKey(rec.videoId, rec.targetLang, rec.engine);
  }

  function getChannelLabel(rec) {
    return (rec.channelName && rec.channelName.trim()) ? rec.channelName.trim() : UNKNOWN_CHANNEL;
  }

  function getFilteredRecords() {
    const query = (document.getElementById('cache-search-input')?.value || '').trim().toLowerCase();
    if (!query) return allCachedRecords;
    return allCachedRecords.filter(rec => {
      const title = (rec.videoTitle || '').toLowerCase();
      const ch = getChannelLabel(rec).toLowerCase();
      const vid = (rec.videoId || '').toLowerCase();
      return title.includes(query) || ch.includes(query) || vid.includes(query);
    });
  }

  function updateSelectionUI() {
    const visibleRecords = getFilteredRecords();
    const visibleKeys = visibleRecords.map(getRecordKey);
    const visibleSelectedCount = visibleKeys.filter(k => selectedKeys.has(k)).length;
    const totalSelectedCount = selectedKeys.size;

    const selectAllEl = document.getElementById('select-all-cache');
    if (selectAllEl) {
      selectAllEl.checked = visibleKeys.length > 0 && visibleSelectedCount === visibleKeys.length;
      selectAllEl.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleKeys.length;
    }

    const countLbl = document.getElementById('selected-count-label');
    if (countLbl) {
      countLbl.textContent = `已选 ${totalSelectedCount} 条`;
      countLbl.classList.toggle('has-selection', totalSelectedCount > 0);
    }

    const batchDelBtn = document.getElementById('batch-delete-cache-btn');
    if (batchDelBtn) {
      batchDelBtn.disabled = totalSelectedCount === 0;
      batchDelBtn.textContent = totalSelectedCount > 0
        ? `🗑️ 批量删除选中 (${totalSelectedCount})`
        : '🗑️ 批量删除选中';
    }

    // Sync channel group checkboxes & row highlights
    document.querySelectorAll('.channel-group-card').forEach(card => {
      const groupKeys = Array.from(card.querySelectorAll('.cache-row-checkbox')).map(cb => cb.dataset.key);
      const checkedInGroup = groupKeys.filter(k => selectedKeys.has(k)).length;
      const groupCb = card.querySelector('.channel-select-checkbox');
      if (groupCb) {
        groupCb.checked = groupKeys.length > 0 && checkedInGroup === groupKeys.length;
        groupCb.indeterminate = checkedInGroup > 0 && checkedInGroup < groupKeys.length;
      }
      card.querySelectorAll('.cache-row').forEach(row => {
        const cb = row.querySelector('.cache-row-checkbox');
        if (cb) {
          const isSel = selectedKeys.has(cb.dataset.key);
          cb.checked = isSel;
          row.classList.toggle('selected', isSel);
        }
      });
    });
  }

  function renderCacheGroups() {
    const container = document.getElementById('cache-groups-container');
    if (!container) return;

    const records = getFilteredRecords();
    if (allCachedRecords.length === 0) {
      container.innerHTML = `<div class="cache-empty-state">暂无已缓存的视频字幕记录</div>`;
      updateSelectionUI();
      return;
    }

    if (records.length === 0) {
      container.innerHTML = `<div class="cache-empty-state">未匹配到符合搜索条件的缓存记录</div>`;
      updateSelectionUI();
      return;
    }

    // Group records by channelName
    const channelMap = new Map();
    records.forEach(rec => {
      const chName = getChannelLabel(rec);
      if (!channelMap.has(chName)) {
        channelMap.set(chName, {
          channelName: chName,
          records: [],
          videoIds: new Set(),
          latestUpdatedAt: 0
        });
      }
      const group = channelMap.get(chName);
      group.records.push(rec);
      group.videoIds.add(rec.videoId);
      if ((rec.updatedAt || 0) > group.latestUpdatedAt) {
        group.latestUpdatedAt = rec.updatedAt || 0;
      }
    });

    // Sort channels: newest activity first, unknown channel last
    const groups = Array.from(channelMap.values()).sort((a, b) => {
      if (a.channelName === UNKNOWN_CHANNEL) return 1;
      if (b.channelName === UNKNOWN_CHANNEL) return -1;
      return b.latestUpdatedAt - a.latestUpdatedAt;
    });

    container.innerHTML = '';

    groups.forEach(group => {
      // Sort records inside channel by updatedAt desc, then original/targetLang
      group.records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      const isCollapsed = collapsedChannels.has(group.channelName);
      const card = document.createElement('div');
      card.className = 'channel-group-card';

      const header = document.createElement('div');
      header.className = 'channel-group-header';
      header.innerHTML = `
        <div class="channel-group-left">
          <input type="checkbox" class="cache-checkbox channel-select-checkbox" title="全选 / 取消全选该频道所有缓存">
          <span class="channel-collapse-icon">${isCollapsed ? '▸' : '▾'}</span>
          <span class="channel-name-text" title="${escapeHTML(group.channelName)}">📺 ${escapeHTML(group.channelName)}</span>
          <span class="channel-meta-badge">${group.videoIds.size} 个视频 · ${group.records.length} 条记录</span>
        </div>
        <div class="channel-group-actions">
          <button class="btn btn-sm btn-danger delete-channel-btn" title="删除此频道下所有缓存">🗑️ 删除整组</button>
        </div>
      `;

      const body = document.createElement('div');
      body.className = `channel-group-body table-container ${isCollapsed ? 'collapsed' : ''}`;

      const table = document.createElement('table');
      table.className = 'cache-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th style="width: 36px;"></th>
            <th>视频标题 / ID</th>
            <th>目标语言</th>
            <th>翻译引擎</th>
            <th>翻译条数</th>
            <th>缓存更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');

      group.records.forEach(rec => {
        const key = getRecordKey(rec);
        const isOriginal = rec.targetLang === 'original';
        const itemsArr = Array.isArray(rec.items) ? rec.items : [];
        const translatedCount = itemsArr.filter(i => i.status === 'translated' || i.translation).length;
        const totalCount = itemsArr.length;
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

        const tr = document.createElement('tr');
        tr.className = `cache-row ${selectedKeys.has(key) ? 'selected' : ''}`;
        tr.innerHTML = `
          <td>
            <input type="checkbox" class="cache-checkbox cache-row-checkbox" data-key="${escapeHTML(key)}" ${selectedKeys.has(key) ? 'checked' : ''}>
          </td>
          <td>
            <div>
              <a class="cache-video-link" href="https://www.youtube.com/watch?v=${encodeURIComponent(rec.videoId)}" target="_blank" rel="noopener noreferrer">
                ${escapeHTML(rec.videoTitle || '未命名视频')}
              </a>
            </div>
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

        const rowCb = tr.querySelector('.cache-row-checkbox');
        rowCb.addEventListener('change', (e) => {
          e.stopPropagation();
          if (rowCb.checked) selectedKeys.add(key);
          else selectedKeys.delete(key);
          updateSelectionUI();
        });

        tr.querySelector('.export-rec-btn').addEventListener('click', () => {
          const mode = isOriginal ? 'original' : 'bilingual';
          const srt = generateSRT(itemsArr, mode);
          downloadSRT(`${rec.videoTitle || rec.videoId}_${rec.targetLang}.srt`, srt);
          showToast(isOriginal ? '已导出原版 SRT！' : '已导出双语 SRT！');
        });

        tr.querySelector('.del-rec-btn').addEventListener('click', async () => {
          if (confirm(`确定删除视频 "${rec.videoTitle || rec.videoId}" 的此条缓存吗？`)) {
            await performBatchDelete([key]);
            showToast('缓存记录已删除');
          }
        });

        tbody.appendChild(tr);
      });

      // Channel checkbox handler
      const groupCb = header.querySelector('.channel-select-checkbox');
      groupCb.addEventListener('click', (e) => e.stopPropagation());
      groupCb.addEventListener('change', () => {
        const groupKeys = group.records.map(getRecordKey);
        if (groupCb.checked) {
          groupKeys.forEach(k => selectedKeys.add(k));
        } else {
          groupKeys.forEach(k => selectedKeys.delete(k));
        }
        updateSelectionUI();
      });

      // Delete entire channel handler
      header.querySelector('.delete-channel-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const groupKeys = group.records.map(getRecordKey);
        if (confirm(`确定删除频道 "${group.channelName}" 下的全部 ${groupKeys.length} 条缓存记录吗？`)) {
          await performBatchDelete(groupKeys);
          showToast(`已删除频道 "${group.channelName}" 的 ${groupKeys.length} 条缓存`);
        }
      });

      // Collapse / expand channel group on header click
      header.addEventListener('click', () => {
        const icon = header.querySelector('.channel-collapse-icon');
        if (collapsedChannels.has(group.channelName)) {
          collapsedChannels.delete(group.channelName);
          body.classList.remove('collapsed');
          if (icon) icon.textContent = '▾';
        } else {
          collapsedChannels.add(group.channelName);
          body.classList.add('collapsed');
          if (icon) icon.textContent = '▸';
        }
      });

      body.appendChild(table);
      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);
    });

    updateSelectionUI();
  }

  async function performBatchDelete(keys) {
    if (!keys || keys.length === 0) return;
    await new Promise(r => chrome.runtime.sendMessage({
      type: 'DB_DELETE_BATCH',
      payload: { keys }
    }, r)).catch(() => {});
    await deleteCacheBatch(keys);
    keys.forEach(k => selectedKeys.delete(k));
    await loadCacheTable();
  }

  async function loadCacheTable() {
    const container = document.getElementById('cache-groups-container');
    if (container) {
      container.innerHTML = `<div class="cache-empty-state">正在加载缓存记录...</div>`;
    }

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

    // Propagate known channelName across records sharing the same videoId
    const videoChannelMap = new Map();
    records.forEach(rec => {
      if (rec.videoId && rec.channelName && rec.channelName.trim()) {
        videoChannelMap.set(rec.videoId, {
          channelName: rec.channelName.trim(),
          channelId: rec.channelId || ''
        });
      }
    });
    records.forEach(rec => {
      if ((!rec.channelName || !rec.channelName.trim()) && videoChannelMap.has(rec.videoId)) {
        const info = videoChannelMap.get(rec.videoId);
        rec.channelName = info.channelName;
        rec.channelId = info.channelId;
      }
    });

    allCachedRecords = records;

    // Clean up any stale keys from selection
    const validKeySet = new Set(allCachedRecords.map(getRecordKey));
    Array.from(selectedKeys).forEach(k => {
      if (!validKeySet.has(k)) selectedKeys.delete(k);
    });

    // Show/hide "resolve unknown channels" button
    const unknownVideoIds = new Set(
      allCachedRecords
        .filter(rec => !rec.channelName || !rec.channelName.trim())
        .map(rec => rec.videoId)
        .filter(Boolean)
    );
    const resolveBtn = document.getElementById('resolve-channels-btn');
    if (resolveBtn) {
      if (unknownVideoIds.size > 0) {
        resolveBtn.style.display = 'inline-flex';
        resolveBtn.textContent = `🏷️ 识别未知频道 (${unknownVideoIds.size})`;
      } else {
        resolveBtn.style.display = 'none';
      }
    }

    renderCacheGroups();
  }

  // Master select-all checkbox
  const selectAllCheckbox = document.getElementById('select-all-cache');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      const visibleKeys = getFilteredRecords().map(getRecordKey);
      if (selectAllCheckbox.checked) {
        visibleKeys.forEach(k => selectedKeys.add(k));
      } else {
        visibleKeys.forEach(k => selectedKeys.delete(k));
      }
      updateSelectionUI();
    });
  }

  // Batch delete selected button
  const batchDeleteBtn = document.getElementById('batch-delete-cache-btn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      const keys = Array.from(selectedKeys);
      if (keys.length === 0) return;
      if (confirm(`确定批量删除选中的 ${keys.length} 条缓存记录吗？删除后不可恢复。`)) {
        await performBatchDelete(keys);
        showToast(`已批量删除 ${keys.length} 条缓存记录`);
      }
    });
  }

  // Collapse / expand all groups toggle
  const toggleAllGroupsBtn = document.getElementById('toggle-all-groups-btn');
  if (toggleAllGroupsBtn) {
    toggleAllGroupsBtn.addEventListener('click', () => {
      const channelNames = new Set(getFilteredRecords().map(getChannelLabel));
      const allCollapsed = Array.from(channelNames).every(ch => collapsedChannels.has(ch));
      if (allCollapsed) {
        channelNames.forEach(ch => collapsedChannels.delete(ch));
        toggleAllGroupsBtn.textContent = '📂 全部折叠';
      } else {
        channelNames.forEach(ch => collapsedChannels.add(ch));
        toggleAllGroupsBtn.textContent = '📂 全部展开';
      }
      renderCacheGroups();
    });
  }

  // Search filter input
  const cacheSearchInput = document.getElementById('cache-search-input');
  if (cacheSearchInput) {
    cacheSearchInput.addEventListener('input', renderCacheGroups);
  }

  // Resolve unknown channels via YouTube oEmbed for legacy cached videos
  const resolveChannelsBtn = document.getElementById('resolve-channels-btn');
  if (resolveChannelsBtn) {
    resolveChannelsBtn.addEventListener('click', async () => {
      const unknownIds = Array.from(new Set(
        allCachedRecords
          .filter(rec => (!rec.channelName || !rec.channelName.trim()) && rec.videoId)
          .map(rec => rec.videoId)
      ));
      if (unknownIds.length === 0) return;

      resolveChannelsBtn.disabled = true;
      resolveChannelsBtn.textContent = `⏳ 正在识别 (${unknownIds.length})...`;

      let resolvedCount = 0;
      const chunkSize = 4;
      for (let i = 0; i < unknownIds.length; i += chunkSize) {
        const chunk = unknownIds.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (vid) => {
          try {
            const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(vid)}&format=json`);
            if (res.ok) {
              const data = await res.json();
              if (data && data.author_name) {
                await new Promise(r => chrome.runtime.sendMessage({
                  type: 'DB_UPDATE_CHANNEL_META',
                  payload: { videoId: vid, channelName: data.author_name, channelId: data.author_url || '' }
                }, r)).catch(() => {});
                await updateVideoChannelMeta(vid, data.author_name, data.author_url || '');
                resolvedCount++;
              }
            }
          } catch (e) {}
        }));
      }

      resolveChannelsBtn.disabled = false;
      showToast(resolvedCount > 0 ? `成功识别 ${resolvedCount} 个视频的所属频道！` : '未能识别未知频道（可能视频已下架或网络不可用）');
      await loadCacheTable();
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
      selectedKeys.clear();
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
