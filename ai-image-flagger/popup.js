document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('modeSlider');
  const modeText = document.getElementById('modeText');
  const statusBadge = document.getElementById('statusBadge');
  const modeDescription = document.getElementById('modeDescription');
  const modeNames = ['off', 'light', 'strict'];
  const modeLabels = ['off', 'basic', 'strict'];
  const modeDescriptions = [
    'Extension is <strong> INACTIVE </strong>. No filtering applied.',
    'Extension is in <strong> BASIC </strong> mode. AI feeds will be marked.',
    'Extension is in <strong> STRICT </strong> mode. AI elements will be eliminated'
  ];

  const statusTexts = ['Inactive', 'Active (Basic)', 'Active (Strict)'];
  const statusClasses = ['inactive', 'active', 'strict'];

  function updateText(value) {
    const idx = parseInt(value);
    modeText.textContent = modeLabels[idx];
    statusBadge.textContent = statusTexts[idx];
    statusBadge.className = 'status-badge ' + statusClasses[idx];
    
    modeDescription.style.opacity = '0';
    setTimeout(() => {
      modeDescription.innerHTML = `<p class="description-text">${modeDescriptions[idx]}</p>`;
      modeDescription.style.opacity = '1';
    }, 150);
  }

  async function applyToActiveTab(mode) {
    try {
      // 1. Save to Storage
      await chrome.storage.local.set({ mode });

      // 2. Send Message (Safely)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
        chrome.tabs.sendMessage(tab.id, { type: 'setMode', mode }, () => {
           if (chrome.runtime.lastError) void 0; 
        });
      });
    } catch (error) {
      console.error('[popup] error:', error);
    }
  }

  function initializePopup() {
    chrome.storage.local.get('mode', ({ mode }) => {
      let current = mode || 'light';
      if (mode === null) current = 'off';

      let idx = modeNames.indexOf(current);
      if (idx === -1) idx = 1;

      slider.value = idx;
      updateText(idx);
      slider.style.transition = 'opacity 0.3s ease';
    });
  }

  modeDescription.style.transition = 'opacity 0.3s ease, background-color 0.3s ease';

  slider.addEventListener('input', (e) => updateText(e.target.value));
  slider.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value);
    applyToActiveTab(modeNames[idx]);
  });

  initializePopup();
});