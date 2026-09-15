// SRT subtitle generator and export

function formatTime(seconds) {
  const pad = (num, size = 2) => String(num).padStart(size, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Generate SRT content from subtitle items
 * @param {Array<{index: number, start: number, dur: number, text: string, translation?: string}>} items
 * @param {'bilingual'|'translation'|'original'} mode
 */
export function generateSRT(items, mode = 'bilingual') {
  if (!items || items.length === 0) return '';

  return items.map((item, idx) => {
    const srtIndex = idx + 1;
    const startTime = formatTime(item.start);
    const endTime = formatTime(item.start + item.dur);
    
    let content = '';
    if (mode === 'bilingual') {
      content = `${item.translation || item.text}\n${item.text}`;
    } else if (mode === 'translation') {
      content = item.translation || item.text;
    } else {
      content = item.text;
    }

    return `${srtIndex}\n${startTime} --> ${endTime}\n${content}\n`;
  }).join('\n');
}

/**
 * Trigger file download in browser
 */
export function downloadSRT(filename, srtContent) {
  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.srt') ? filename : `${filename}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
