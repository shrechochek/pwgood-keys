// content.js — усиленная защита от повторных триггеров
(() => {
  const KEYWORD = 'ключ';
  const VIDEO_RESOURCE = chrome.runtime.getURL('replacement.mp4');

  const OBSERVE_INTERVAL_MS = 250;
  const TRIGGER_COOLDOWN_MS = 5000; // общий таймаут после триггера (ms)
  const VIDEO_TIME_COOLDOWN_S = 5;    // если триггер уже был в этой же временной окрестности (секунды) — игнорируем

  let lastCheck = 0;
  let replacing = false;
  let overlayVideo = null;
  let originalVideo = null;

  // защита
  let lastTriggeredText = null;
  let lastTriggeredAt = 0;          // ms
  let lastTriggeredVideoTime = null; // seconds (position оригинального видео)
  let disabledUntil = 0;            // ms — временно запрещённые триггеры

  function findPlayerVideo() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return null;
    const vid = player.querySelector('video');
    return { player, vid };
  }

  function getVisibleCaptionsText() {
    const selectors = ['.ytp-caption-segment', '.caption-window', '.captions-text'];
    const texts = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const t = el.innerText || el.textContent;
        if (t && t.trim()) texts.push(t.trim());
      });
    });
    const aria = document.querySelector('[aria-live="assertive"], [aria-live="polite"]');
    if (aria && aria.innerText) texts.push(aria.innerText.trim());
    return texts.join(' ').toLowerCase();
  }

  function createOverlayVideo(bounds) {
    const v = document.createElement('video');
    v.id = 'ext-replacement-video';
    v.src = VIDEO_RESOURCE;
    v.autoplay = true;
    v.playsInline = true;
    v.controls = false;
    v.muted = false;
    v.preload = 'auto';
    v.style.position = 'absolute';
    v.style.left = `${bounds.left + window.scrollX}px`;
    v.style.top = `${bounds.top + window.scrollY}px`;
    v.style.width = `${bounds.width}px`;
    v.style.height = `${bounds.height}px`;
    v.style.zIndex = 2147483647;
    v.style.background = 'black';
    v.style.objectFit = 'cover';
    v.style.pointerEvents = 'none';
    return v;
  }

  function startReplacement(visibleCaptionTextAtTrigger) {
    if (replacing) {
      console.log('[ext] startReplacement ignored: already replacing');
      return;
    }
    const pv = findPlayerVideo();
    if (!pv || !pv.vid) {
      console.warn('[ext] player/video not found');
      return;
    }

    originalVideo = pv.vid;
    const rect = pv.vid.getBoundingClientRect();
    const resumeTime = originalVideo.currentTime;

    try { originalVideo.pause(); } catch (e) { console.warn('pause original failed', e); }

    overlayVideo = createOverlayVideo(rect);
    document.body.appendChild(overlayVideo);

    // защита: фиксируем текст и время и заблокируем триггеры на cooldown
    lastTriggeredText = visibleCaptionTextAtTrigger;
    lastTriggeredAt = Date.now();
    lastTriggeredVideoTime = resumeTime;
    disabledUntil = Date.now() + TRIGGER_COOLDOWN_MS;

    console.log('[ext] Replacement started. resumeTime=', resumeTime, 'disabledUntil=', new Date(disabledUntil).toISOString());

    overlayVideo.addEventListener('ended', () => {
      stopReplacement(true, resumeTime);
    });

    overlayVideo.addEventListener('canplaythrough', () => {
      overlayVideo.play().catch(err => {
        console.warn('Autoplay blocked for replacement video:', err);
      });
    });

    overlayVideo.play().catch(()=>{});

    replacing = true;
  }

  function stopReplacement(resumeOriginal = false, resumeTime = 0) {
    if (!replacing) {
      console.log('[ext] stopReplacement ignored: not replacing');
      return;
    }

    if (overlayVideo) {
      try { overlayVideo.pause(); } catch (e) {}
      overlayVideo.remove();
      overlayVideo = null;
    }

    if (resumeOriginal && originalVideo) {
      try {
        originalVideo.currentTime = resumeTime;
        originalVideo.play().catch(()=>{});
      } catch (e) {
        console.warn('resume original failed', e);
      }
    }

    // устанавливаем дополнительную защиту: не позволяем срабатывать короткое время после окончания
    disabledUntil = Math.max(disabledUntil, Date.now() + TRIGGER_COOLDOWN_MS);
    console.log('[ext] Replacement stopped. new disabledUntil=', new Date(disabledUntil).toISOString());

    replacing = false;
    originalVideo = null;
  }

  // Доп. проверка: не тригерить если
  //  - общий disabledUntil ещё не прошёл
  //  - либо если текущая позиция оригинального видео близка к lastTriggeredVideoTime
  function shouldIgnoreTrigger(visibleText) {
    const now = Date.now();
    if (now < disabledUntil) {
      console.log('[ext] trigger ignored: global cooldown active until', new Date(disabledUntil).toISOString());
      return true;
    }

    const pv = findPlayerVideo();
    if (!pv || !pv.vid) return false;

    const currentTime = pv.vid.currentTime;
    if (lastTriggeredVideoTime !== null) {
      const diff = Math.abs(currentTime - lastTriggeredVideoTime);
      if (diff <= VIDEO_TIME_COOLDOWN_S) {
        console.log('[ext] trigger ignored: video time within cooldown (diff s)=', diff.toFixed(2));
        return true;
      }
    }

    // если видимый текст точно совпадает с последним и прошло мало времени — игнорируем
    if (lastTriggeredText && visibleText === lastTriggeredText && (now - lastTriggeredAt) < TRIGGER_COOLDOWN_MS) {
      console.log('[ext] trigger ignored: same visible text recently triggered');
      return true;
    }

    return false;
  }

  function observeCaptions() {
    const observer = new MutationObserver(muts => {
      const now = Date.now();
      if (now - lastCheck < OBSERVE_INTERVAL_MS) return;
      lastCheck = now;

      if (replacing) return; // не тригерим, пока показываем replacement

      const text = getVisibleCaptionsText();
      if (!text) return;

      if (text.includes(KEYWORD.toLowerCase())) {
        // перед запуском — дополнительная проверка, чтобы избежать повторного триггера
        if (shouldIgnoreTrigger(text)) return;
        console.log('[ext] keyword found, launching replacement');
        startReplacement(text);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // корректировка позиции оверлея
  function watchPlayerGeometry() {
    let lastRect = null;
    setInterval(() => {
      if (!replacing || !overlayVideo) return;
      const pv = findPlayerVideo();
      if (!pv || !pv.vid) return;
      const rect = pv.vid.getBoundingClientRect();
      const changed = !lastRect ||
        rect.left !== lastRect.left || rect.top !== lastRect.top ||
        rect.width !== lastRect.width || rect.height !== lastRect.height;
      if (changed) {
        overlayVideo.style.left = `${rect.left + window.scrollX}px`;
        overlayVideo.style.top = `${rect.top + window.scrollY}px`;
        overlayVideo.style.width = `${rect.width}px`;
        overlayVideo.style.height = `${rect.height}px`;
        lastRect = rect;
      }
    }, 200);
  }

  function setupHotkeys() {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && replacing) {
        stopReplacement(true);
      }
    });
  }

  function init() {
    observeCaptions();
    watchPlayerGeometry();
    setupHotkeys();

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        stopReplacement(false);
        // очистим маркеры при навигации
        lastTriggeredText = null;
        lastTriggeredAt = 0;
        lastTriggeredVideoTime = null;
        disabledUntil = 0;
      }
    }, 1000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();