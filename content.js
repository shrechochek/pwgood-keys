// content.js
(() => {
  const KEYWORD = 'ключ'; // слово для детекции (нижний регистр)
  const VIDEO_RESOURCE = chrome.runtime.getURL('replacement.mp4');
  const OBSERVE_INTERVAL_MS = 300; // минимальный интервал между проверками (защита от частых срабатываний)

  let lastCheck = 0;
  let replacing = false;
  let overlayVideo = null;
  let originalVideo = null;

  // Найти root плеера и оригинальный <video>
  function findPlayerVideo() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return null;
    // внутри плеера обычно есть элемент <video>
    const vid = player.querySelector('video');
    return { player, vid };
  }

  function getVisibleCaptionsText() {
    // Популярные селекторы для субтитров на YouTube:
    const selectors = [
      '.ytp-caption-segment', // сегменты caption
      '.caption-window',      // старые классы
      '.captions-text',       // альтернативные
      '.ytp-caption-segment .ytp-caption-segment' // защита
    ];
    let texts = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const t = el.innerText || el.textContent;
        if (t && t.trim()) texts.push(t.trim());
      });
    });

    // Иногда контейнер для субтитров имеет aria-live, можно проверить его содержимое
    const aria = document.querySelector('[aria-live="assertive"], [aria-live="polite"]');
    if (aria && aria.innerText) {
      const t = aria.innerText.trim();
      if (t) texts.push(t);
    }

    // объединяем и возвращаем в нижнем регистре
    return texts.join(' ').toLowerCase();
  }

  function createOverlayVideo(bounds) {
    const v = document.createElement('video');
    v.id = 'ext-replacement-video';
    v.src = VIDEO_RESOURCE;
    v.autoplay = true;
    v.playsInline = true;
    v.controls = false;
    v.muted = false; // можно переключать
    v.style.position = 'absolute';
    v.style.left = `${bounds.left + window.scrollX}px`;
    v.style.top = `${bounds.top + window.scrollY}px`;
    v.style.width = `${bounds.width}px`;
    v.style.height = `${bounds.height}px`;
    v.style.zIndex = 2147483647; // максимально высоко
    v.style.background = 'black';
    v.style.objectFit = 'cover';
    v.style.pointerEvents = 'none'; // чтобы не мешать кликам по плееру (по желанию)
    return v;
  }

  function startReplacement() {
    if (replacing) return;
    const pv = findPlayerVideo();
    if (!pv || !pv.vid) return;

    originalVideo = pv.vid;
    const rect = pv.vid.getBoundingClientRect();

    // Пауза оригинала
    try { originalVideo.pause(); } catch (e) { console.warn('pause original failed', e); }

    overlayVideo = createOverlayVideo(rect);
    document.body.appendChild(overlayVideo);

    // Как только replacement видео закончится — убираем оверлей и возобновляем
    overlayVideo.addEventListener('ended', () => {
      stopReplacement(true);
    });

    // На случай автопроигрывания/блокировок — попытаться play()
    const p = overlayVideo.play();
    if (p && p.catch) {
      p.catch(err => {
        // автоплей мог быть заблокирован — попробуем включить звук/потом воспроизвести при пользовательском действии
        console.warn('Autoplay blocked for replacement video:', err);
      });
    }

    replacing = true;
  }

  function stopReplacement(resumeOriginal = false) {
    if (!replacing) return;
    if (overlayVideo) {
      try {
        overlayVideo.pause();
      } catch (e) {}
      overlayVideo.remove();
      overlayVideo = null;
    }
    if (resumeOriginal && originalVideo) {
      try { originalVideo.play().catch(()=>{}); } catch (e) {}
    }
    replacing = false;
    originalVideo = null;
  }

  // Следит за изменениями субтитров
  function observeCaptions() {
    // Используем MutationObserver над body, фильтруем изменения
    const observer = new MutationObserver(muts => {
      const now = Date.now();
      if (now - lastCheck < OBSERVE_INTERVAL_MS) return;
      lastCheck = now;

      // если уже заменяем — ничего не делаем
      if (replacing) return;

      const text = getVisibleCaptionsText();
      if (!text) return;

      if (text.includes(KEYWORD.toLowerCase())) {
        console.log('[ext] keyword found in captions:', KEYWORD);
        // alert("key was spotted!!!")
        startReplacement();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Пересчитает позицию оверлея при ресайзе / смене полноэкранного режима
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
    }, 250);
  }

  // Команда для выключения замены по нажатию клавиши Escape (удобно при тесте)
  function setupHotkeys() {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && replacing) {
        stopReplacement(true);
      }
    });
  }

  // Инициализация
  function init() {
    observeCaptions();
    watchPlayerGeometry();
    setupHotkeys();

    // Очистка при переходах SPA (YouTube динамически меняет содержимое)
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // остановим замены при навигации
        stopReplacement(false);
      }
    }, 1000);
  }

  // Запускаем когда документ готов
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
