document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('modeSlider');
  const modeText = document.getElementById('modeText');
  const modeNames = [null, 'light', 'strict'];
  const modeLabels = ['off', 'basic', 'strict'];

  function updateText(value) {
    modeText.innerHTML = 'filtering mode<br><span class="current-mode">' + modeLabels[value] + '</span>';
  }

  async function applyToActiveTab(mode) {
    await chrome.storage.local.set({ mode });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
      chrome.tabs.sendMessage(tab.id, { type: 'setMode', mode }, () => {
        if (chrome.runtime.lastError) {
          console.debug('[popup] no receiver:', chrome.runtime.lastError.message);
        }
      });
    });
  }

  chrome.storage.local.get('mode', ({ mode }) => {
    let idx = modeNames.indexOf(mode);
    if (idx === -1) idx = 0;
    slider.value = idx;
    updateText(slider.value);
  });

  slider.addEventListener('input', () => {
    updateText(slider.value);
  });

  slider.addEventListener('change', () => {
    const idx = parseInt(slider.value);
    const mode = modeNames[idx];
    applyToActiveTab(mode);
  });
});