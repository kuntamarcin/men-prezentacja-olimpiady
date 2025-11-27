// Funkcja generująca HTML dla wersji offline
window.generateOfflineHtml = function(contestsData, animeJsCode) {
  const contestsJson = JSON.stringify(contestsData);
  
  const css = `
    @font-face { font-family: "UniSansHeavyCAPS"; src: url("fonts/Uni Sans Heavy.otf") format("opentype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "UniSansHeavyCAPS"; src: url("fonts/Uni Sans Heavy.otf") format("opentype"); font-weight: 700; font-style: normal; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    b, strong { font-weight: normal; color: #0679ca; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    body { font-family: "UniSansHeavyCAPS", system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color: #000; }
    #app { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
    #video-layer { position: absolute; inset: 0; overflow: hidden; z-index: 0; background: #000; }
    #video-layer video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.6s ease; }
    #video-title-bg.visible, #video-winners-bg.visible { opacity: 1; }
    #slide-layer { position: relative; z-index: 1; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 4vh 6vw; pointer-events: none; }
    .slide-content { max-width: 80vw; max-height: 90vh; text-align: center; color: #000; display: flex; flex-direction: column; justify-content: center; gap: 3vh; word-wrap: break-word; overflow: visible; perspective: 1000px; }
    .slide-title { font-weight: 700; font-size: min(7vh, 5vw); line-height: 1.35; padding-top: 0.1em; }
    .slide-subtitle { font-weight: 400; font-size: min(4.5vh, 3.4vw); line-height: 1.35; padding-top: 0.1em; }
    .winners-header { font-weight: 700; font-size: min(4vh, 2.88vw); line-height: 1.35; padding-top: 0.1em; margin-bottom: 2vh; }
    .winners-list { display: flex; flex-direction: column; gap: 2vh; align-items: center; }
    .winner { max-width: 80vw; }
    .winner-name { font-weight: 700; font-size: min(4.4vh, 3.2vw); line-height: 1.35; padding-top: 0.1em; color: #0679ca; }
    .winner-details { font-weight: 400; font-size: min(2.8vh, 2.08vw); line-height: 1.35; padding-top: 0.1em; margin-top: 0.8vh; }
    #loading-overlay { position: absolute; inset: 0; z-index: 5; background: #000; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #fff; text-align: center; }
    #loading-overlay.hidden { display: none; }
    .loader { width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #start-overlay { position: absolute; inset: 0; z-index: 2; background: rgba(0, 0, 0, 0.6); display: none; align-items: center; justify-content: center; flex-direction: column; color: #fff; text-align: center; padding: 2rem; }
    #start-overlay.visible { display: flex; }
    #start-overlay h1 { font-family: "UniSansHeavyCAPS", sans-serif; font-weight: 700; font-size: 3rem; margin-bottom: 1rem; }
    #start-overlay p { font-size: 1.1rem; margin-bottom: 1.5rem; max-width: 32rem; }
    #start-button { pointer-events: auto; cursor: pointer; border: none; font-family: "UniSansHeavyCAPS", sans-serif; font-weight: 700; font-size: 1.4rem; padding: 0.9rem 2.4rem; border-radius: 999px; background: #ffffff; color: #000000; transition: transform 0.15s ease, box-shadow 0.15s ease; }
    #start-button:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(0,0,0,0.5); }
    #start-button:active { transform: translateY(1px); box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
    .fade-seq { opacity: 0; transform: translateY(10px); }
    #error-message { position: absolute; inset: 0; z-index: 3; display: none; align-items: center; justify-content: center; padding: 2rem; text-align: center; background: rgba(0,0,0,0.8); color: #fff; font-size: 1.1rem; }
    #error-message.visible { display: flex; }
  `;

  const jsCode = `
    const OFFLINE_CONTESTS = ${contestsJson};
    let slides = [];
    let currentSlideIndex = 0;
    let presentationStarted = false;

    function fixOrphans(text) {
      const orphans = ['a','i','o','u','w','z','do','na','po','za','od','we','ze','ku','o','nr','im.','woj.'];
      let result = text;
      orphans.forEach(function(word) {
        const regex = new RegExp('(^|\\\\\\\\s)(' + word.replace('.', '\\\\\\\\.') + ')\\\\\\\\s','gi');
        result = result.replace(regex, '$1$2\\\\u00A0');
      });
      result = result.replace(/Olimpiada/g, "<b>Olimpiada</b>");
      return result;
    }

    function showError(message) {
      const el = document.getElementById('error-message');
      el.textContent = message;
      el.classList.add('visible');
    }

    function buildSlidesFromContests(contests) {
      const generatedSlides = [];
      for (let i = 0; i < contests.length; i++) {
        generatedSlides.push({ type: 'title', contest: contests[i] });
        generatedSlides.push({ type: 'winners', contest: contests[i] });
      }
      return generatedSlides;
    }

    function setBackgroundForSlide(slide) {
      const titleVideo = document.getElementById('video-title-bg');
      const winnersVideo = document.getElementById('video-winners-bg');
      if (slide.type === 'title') {
        titleVideo.classList.add('visible');
        winnersVideo.classList.remove('visible');
      } else {
        winnersVideo.classList.add('visible');
        titleVideo.classList.remove('visible');
      }
    }

    function createTitleSlideContent(contest) {
      const container = document.createElement('div');
      container.className = 'slide-content';
      const titleEl = document.createElement('div');
      titleEl.className = 'slide-title fade-seq';
      titleEl.innerHTML = fixOrphans(contest.title || '(bez tytulu)');
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'slide-subtitle fade-seq';
      subtitleEl.innerHTML = fixOrphans(contest.organizer || '');
      container.appendChild(titleEl);
      container.appendChild(subtitleEl);
      return container;
    }

    function wrapLetters(element) {
      const text = element.textContent;
      element.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const ch of text) {
        const span = document.createElement('span');
        span.textContent = ch;
        span.className = 'letter';
        frag.appendChild(span);
      }
      element.appendChild(frag);
    }

    function createWinnersSlideContent(contest) {
      const container = document.createElement('div');
      container.className = 'slide-content';
      const winnersCount = contest.winners.length;
      const headerText = winnersCount === 1 ? 'Zwyciezca' : 'Zwyciezcy';
      const headerEl = document.createElement('div');
      headerEl.className = 'winners-header fade-seq';
      headerEl.textContent = headerText;
      const winnersListEl = document.createElement('div');
      winnersListEl.className = 'winners-list';
      contest.winners.forEach(function(w) {
        const item = document.createElement('div');
        item.className = 'winner fade-seq';
        const nameEl = document.createElement('div');
        nameEl.className = 'winner-name';
        nameEl.innerHTML = fixOrphans(w.name);
        wrapLetters(nameEl);
        const detailsEl = document.createElement('div');
        detailsEl.className = 'winner-details';
        const regionText = w.region ? 'woj.\\u00A0' + w.region : '';
        const detailsParts = [w.school, regionText].filter(Boolean);
        detailsEl.innerHTML = fixOrphans(detailsParts.join(' \\u2022 '));
        item.appendChild(nameEl);
        item.appendChild(detailsEl);
        winnersListEl.appendChild(item);
      });
      container.appendChild(headerEl);
      container.appendChild(winnersListEl);
      return container;
    }

    let currentAnimation = null;
    function fadeInSequence(elements) {
      if (currentAnimation) { currentAnimation.pause(); currentAnimation = null; }
      if (!window.anime || !elements.length) return;

      for (let i = 0; i < elements.length; i++) {
        elements[i].style.opacity = '1';
        elements[i].style.transform = 'none';
      }

      const letterNodes = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.classList.contains('winner-name') || el.classList.contains('slide-title')) {
          const letters = el.querySelectorAll('.letter');
          for (let j = 0; j < letters.length; j++) {
            letterNodes.push(letters[j]);
          }
        }
      }

      if (!letterNodes.length) {
        currentAnimation = anime({
          targets: Array.from(elements),
          opacity: [0,1],
          translateY: [30,0],
          scale: [0.95,1],
          easing: 'easeOutCubic',
          duration: 700,
          delay: anime.stagger(120),
          complete: function() { currentAnimation = null; }
        });
        return;
      }

      for (let i = 0; i < letterNodes.length; i++) {
        letterNodes[i].style.display = 'inline-block';
        letterNodes[i].style.opacity = '0';
        letterNodes[i].style.transform = 'translateY(30px) scale(0.9)';
      }

      currentAnimation = anime({
        targets: letterNodes,
        opacity: [0,1],
        translateY: [30,0],
        scale: [0.9,1],
        easing: 'easeOutCubic',
        duration: 600,
        delay: anime.stagger(25),
        complete: function() { currentAnimation = null; }
      });
    }

    function renderCurrentSlide() {
      const slide = slides[currentSlideIndex];
      const slideLayer = document.getElementById('slide-layer');
      slideLayer.innerHTML = '';
      let content;
      if (slide.type === 'title') content = createTitleSlideContent(slide.contest);
      else content = createWinnersSlideContent(slide.contest);
      slideLayer.appendChild(content);
      setBackgroundForSlide(slide);
      const animatables = slideLayer.querySelectorAll('.fade-seq');
      fadeInSequence(animatables);
    }

    function nextSlide() {
      if (!presentationStarted) return;
      if (currentSlideIndex < slides.length - 1) { currentSlideIndex += 1; renderCurrentSlide(); }
    }

    function prevSlide() {
      if (!presentationStarted) return;
      if (currentSlideIndex > 0) { currentSlideIndex -= 1; renderCurrentSlide(); }
    }

    function setupKeyboardNavigation() {
      window.addEventListener('keydown', function(e) {
        if (!presentationStarted) return;
        switch (e.key) {
          case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': e.preventDefault(); nextSlide(); break;
          case 'ArrowLeft': case 'ArrowUp': case 'PageUp': e.preventDefault(); prevSlide(); break;
          case 'Home': e.preventDefault(); currentSlideIndex = 0; renderCurrentSlide(); break;
          case 'End': e.preventDefault(); currentSlideIndex = slides.length - 1; renderCurrentSlide(); break;
        }
      });
    }

    function requestFullscreenForPresentation() {
      const elem = document.documentElement;
      if (elem.requestFullscreen) return elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) return elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) return elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) return elem.msRequestFullscreen();
      return Promise.resolve();
    }

    function startPresentation() {
      const startOverlay = document.getElementById('start-overlay');
      startOverlay.style.display = 'none';
      presentationStarted = true;
      if (!OFFLINE_CONTESTS.length) { showError('Brak slajdow do wyswietlenia.'); return; }
      slides = buildSlidesFromContests(OFFLINE_CONTESTS);
      currentSlideIndex = 0;
      renderCurrentSlide();
    }

    document.addEventListener('DOMContentLoaded', function() {
      setupKeyboardNavigation();
      const loadingOverlay = document.getElementById('loading-overlay');
      const startOverlay = document.getElementById('start-overlay');
      const startButton = document.getElementById('start-button');
      const video1 = document.getElementById('video-title-bg');
      const video2 = document.getElementById('video-winners-bg');

      function videoReady(video) {
        return new Promise(function(resolve) {
          if (video.readyState >= 3) resolve();
          else { video.addEventListener('canplaythrough', resolve, { once: true }); setTimeout(resolve, 5000); }
        });
      }

      Promise.all([videoReady(video1), videoReady(video2)]).then(function() {
        video1.classList.add('visible');
        video2.classList.remove('visible');
        loadingOverlay.classList.add('hidden');
        startOverlay.classList.add('visible');
      }).catch(function() {
        loadingOverlay.classList.add('hidden');
        showError('Blad podczas wczytywania danych.');
      });

      startButton.addEventListener('click', function() {
        requestFullscreenForPresentation().catch(function(e) { console.warn('Fullscreen error:', e); });
        startPresentation();
      });
    });
  `;

  return '<!DOCTYPE html>\n' +
    '<html lang="pl">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <title>Prezentacja laureatów (offline)</title>\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <link rel="preload" href="bg-1.mp4" as="video" type="video/mp4">\n' +
    '  <link rel="preload" href="bg-2.mp4" as="video" type="video/mp4">\n' +
    '  <style>' + css + '</style>\n' +
    '  <script>' + animeJsCode + '</' + 'script>\n' +
    '  <script>' + jsCode + '</' + 'script>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <div id="app">\n' +
    '    <div id="loading-overlay"><div class="loader"></div></div>\n' +
    '    <div id="video-layer">\n' +
    '      <video id="video-title-bg" src="bg-1.mp4" autoplay muted loop playsinline preload="auto"></video>\n' +
    '      <video id="video-winners-bg" src="bg-2.mp4" autoplay muted loop playsinline preload="auto"></video>\n' +
    '    </div>\n' +
    '    <div id="slide-layer"></div>\n' +
    '    <div id="start-overlay">\n' +
    '      <h1>Prezentacja laureatów (offline)</h1>\n' +
    '      <p>Kliknij „Start prezentacji", aby wejść w tryb pełnoekranowy. Następnie używaj klawiszy strzałek (jak w PowerPoincie), aby przechodzić między slajdami.</p>\n' +
    '      <button id="start-button">Start prezentacji</button>\n' +
    '    </div>\n' +
    '    <div id="error-message"></div>\n' +
    '  </div>\n' +
    '</body>\n' +
    '</html>';
};
