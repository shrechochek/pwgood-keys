// popup.js — управляет настройками
document.addEventListener('DOMContentLoaded', () => {
  const enabledEl = document.getElementById('enabled');
  const triggerEl = document.getElementById('triggerCooldownMs');
  const videoTimeEl = document.getElementById('videoTimeCooldownS');
  const saveBtn = document.getElementById('save');
  const resetBtn = document.getElementById('reset');
  const status = document.getElementById('status');

  const DEFAULTS = {
    enabled: true,
    triggerCooldownMs: 2000,
    videoTimeCooldownS: 3
  };

  function showStatus(text, timeout = 1500) {
    status.textContent = text;
    setTimeout(() => { status.textContent = ''; }, timeout);
  }

  // load
  chrome.storage.sync.get(['enabled','triggerCooldownMs','videoTimeCooldownS'], (res) => {
    enabledEl.checked = (typeof res.enabled === 'boolean') ? res.enabled : DEFAULTS.enabled;
    triggerEl.value = (typeof res.triggerCooldownMs === 'number') ? res.triggerCooldownMs : DEFAULTS.triggerCooldownMs;
    videoTimeEl.value = (typeof res.videoTimeCooldownS === 'number') ? res.videoTimeCooldownS : DEFAULTS.videoTimeCooldownS;
  });

  saveBtn.addEventListener('click', () => {
    const enabled = !!enabledEl.checked;
    const triggerCooldownMs = Math.max(0, Number(triggerEl.value) || DEFAULTS.triggerCooldownMs);
    const videoTimeCooldownS = Math.max(0, Number(videoTimeEl.value) || DEFAULTS.videoTimeCooldownS);

    chrome.storage.sync.set({
      enabled,
      triggerCooldownMs,
      videoTimeCooldownS
    }, () => {
      showStatus('Сохранено');
    });
  });

  resetBtn.addEventListener('click', () => {
    chrome.storage.sync.set(DEFAULTS, () => {
      enabledEl.checked = DEFAULTS.enabled;
      triggerEl.value = DEFAULTS.triggerCooldownMs;
      videoTimeEl.value = DEFAULTS.videoTimeCooldownS;
      showStatus('Сброшено');
    });
  });

  // удобство — сохранять сразу при переключении тумблера
  enabledEl.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: !!enabledEl.checked }, () => {
      showStatus('Сохранено');
    });
  });
});
