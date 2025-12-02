/* 
  app.js - Główna logika aplikacji
*/

// --- Konfiguracja i Stan Globalny ---
const SHEET_ID = "1_4ZEm_I27_I0c6Gnlr2Ffs3lUg8alIcEwrHCzwXwysk";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const POLLING_INTERVAL = 10000;

const state = {
  contests: [],
  slides: [],
  currentSlideIndex: 0,
  presentationStarted: false,
  pollingTimer: null,
  currentAnimation: null
};

// --- Funkcje Pomocnicze ---

function fixOrphans(text) {
  if (!text) return "";
  const orphans = ['a', 'i', 'o', 'u', 'w', 'z', 'do', 'na', 'po', 'za', 'od', 'we', 'ze', 'ku', 'o', 'nr', 'im.', 'woj.'];
  let result = text;
  orphans.forEach(word => {
    // Regex: granica słowa lub początek stringa + słowo + kropka(opcjonalnie) + spacja
    // Zamieniamy spację na twardą spację (\u00A0)
    const regex = new RegExp(`(^|\\s)(${word.replace('.', '\\.')})\\s`, 'gi');
    result = result.replace(regex, `$1$2\u00A0`);
  });
  // Wyróżnienie słowa "Olimpiada"
  result = result.replace(/Olimpiada/g, "<b>Olimpiada</b>");
  return result;
}

function showError(message) {
  const el = document.getElementById("error-message");
  if (el) {
    el.textContent = message;
    el.classList.add("visible");
  }
  console.error(message);
}

// --- Pobieranie i Przetwarzanie Danych ---

async function fetchSheetData() {
  // Jeśli jesteśmy w trybie offline, dane są już w zmiennej globalnej
  if (window.OFFLINE_CONTESTS) {
    return null; // Sygnał, że nie pobieramy z sieci
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const res = await fetch(SHEET_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error("Błąd pobierania danych: " + res.status);
    }
    const text = await res.text();
    // Wyciągnięcie JSON z JSONP
    const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(jsonStr).table;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error("Przekroczono limit czasu (8s).");
    }
    throw err;
  }
}

function parseContestsFromTable(table) {
  if (window.OFFLINE_CONTESTS) return window.OFFLINE_CONTESTS;
  if (!table) return [];

  const cols = table.cols || [];
  const rows = table.rows || [];

  function findCol(label) {
    return cols.findIndex(c => (c.label || "").trim().toLowerCase() === label.toLowerCase());
  }

  let idxName = findCol("nazwa_konkursu");
  let idxOrg = findCol("organizator");
  let idxWinnerName = findCol("imiona_nazwiska_laureata");
  let idxSchool = findCol("nazwa_szkoly");
  let idxRegion = findCol("wojewodztwo");

  // Fallback: szukanie w pierwszym wierszu, jeśli nagłówki nie są zdefiniowane w metadanych
  let dataRows = rows;
  if (idxName === -1 && rows.length > 0) {
    const firstRow = rows[0].c || [];
    const headers = firstRow.map(cell => (cell && cell.v != null ? String(cell.v).trim().toLowerCase() : ""));
    
    idxName = headers.indexOf("nazwa_konkursu");
    idxOrg = headers.indexOf("organizator");
    idxWinnerName = headers.indexOf("imiona_nazwiska_laureata");
    idxSchool = headers.indexOf("nazwa_szkoly");
    idxRegion = headers.indexOf("wojewodztwo");
    
    dataRows = rows.slice(1);
  }

  if (idxName === -1) {
    console.warn("Nie znaleziono kolumny 'nazwa_konkursu'.");
    return [];
  }

  const result = [];
  let currentContest = null;

  for (const row of dataRows) {
    const c = row.c || [];
    const getVal = (i) => (i !== -1 && c[i] && c[i].v != null) ? String(c[i].v).trim() : "";

    const nameVal = getVal(idxName);
    const orgVal = getVal(idxOrg);
    const winnerNameVal = getVal(idxWinnerName);
    const schoolVal = getVal(idxSchool);
    const regionVal = getVal(idxRegion);

    if (!nameVal && !orgVal && !winnerNameVal) continue;

    if (nameVal) {
      if (currentContest) result.push(currentContest);
      currentContest = {
        title: nameVal,
        organizer: orgVal,
        winners: []
      };
    }

    if (currentContest && winnerNameVal) {
      currentContest.winners.push({
        name: winnerNameVal,
        school: schoolVal,
        region: regionVal
      });
    }
  }
  if (currentContest) result.push(currentContest);
  return result;
}

function buildSlidesFromContests(contests) {
  const slides = [];
  for (const contest of contests) {
    slides.push({ type: "title", contest });
    slides.push({ type: "winners", contest });
  }
  return slides;
}

// --- Renderowanie Slajdów ---

// Dopasowanie całej zawartości slajdu do bezpiecznego kadru
// Jeśli treści (np. bardzo długa lista laureatów) jest zbyt dużo,
// cała zawartość jest proporcjonalnie skalowana w dół tak, aby
// zmieściła się w "safe area" wyznaczonej przez #slide-layer.
function fitSlideContentToSafeArea() {
  const slideLayer = document.getElementById("slide-layer");
  if (!slideLayer) return;

  const content = slideLayer.querySelector(".slide-content");
  if (!content) return;

  // Reset ewentualnego poprzedniego skalowania
  content.style.transform = "";

  // Wysokość obszaru roboczego (bezpieczeństwa)
  const layerHeight = slideLayer.clientHeight || slideLayer.getBoundingClientRect().height;
  const verticalMargin = layerHeight * 0.05; // ok. 5% wysokości u góry i dołu
  const safeHeight = layerHeight - verticalMargin * 2;

  // Naturalna wysokość treści (nieograniczona max-height)
  const contentHeight = content.scrollHeight;
  if (!contentHeight || contentHeight <= 0) return;

  const scale = safeHeight / contentHeight;

  // Skalujemy tylko w dół; nie powiększamy ponad 100%
  if (scale < 1) {
    content.style.transformOrigin = "center center";
    content.style.transform = `scale(${scale})`;
  }
}

function createTitleSlideContent(contest) {
  const container = document.createElement("div");
  container.className = "slide-content";

  const titleEl = document.createElement("div");
  titleEl.className = "slide-title fade-seq";
  titleEl.innerHTML = fixOrphans(contest.title || "(bez tytułu)");

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "slide-subtitle fade-seq";
  subtitleEl.innerHTML = fixOrphans(contest.organizer || "");

  container.appendChild(titleEl);
  container.appendChild(subtitleEl);
  return container;
}

function createWinnersSlideContent(contest) {
  const container = document.createElement("div");
  container.className = "slide-content";

  const winnersCount = contest.winners.length;
  const headerText = winnersCount === 1 ? "Zwycięzca" : "Zwycięzcy";

  const headerEl = document.createElement("div");
  headerEl.className = "winners-header fade-seq";
  headerEl.textContent = headerText;

  const winnersListEl = document.createElement("div");
  winnersListEl.className = "winners-list";

  contest.winners.forEach((w) => {
    const item = document.createElement("div");
    item.className = "winner fade-seq";

    const nameEl = document.createElement("div");
    nameEl.className = "winner-name";
    nameEl.innerHTML = fixOrphans(w.name);

    const detailsEl = document.createElement("div");
    detailsEl.className = "winner-details";
    const regionText = w.region ? `woj.\u00A0${w.region}` : "";
    const detailsParts = [w.school, regionText].filter(Boolean);
    detailsEl.innerHTML = fixOrphans(detailsParts.join(" • "));

    item.appendChild(nameEl);
    item.appendChild(detailsEl);
    winnersListEl.appendChild(item);
  });

  container.appendChild(headerEl);
  container.appendChild(winnersListEl);
  return container;
}

function setBackgroundForSlide(slide) {
  const titleVideo = document.getElementById("video-title-bg");
  const winnersVideo = document.getElementById("video-winners-bg");
  
  if (!titleVideo || !winnersVideo) return;

  if (slide.type === "title") {
    titleVideo.classList.add("visible");
    winnersVideo.classList.remove("visible");
  } else {
    winnersVideo.classList.add("visible");
    titleVideo.classList.remove("visible");
  }
}

// --- Animacje ---

// Prosta animacja całych bloków (bez rozbijania na litery)
function fadeInSequence(elements) {
  if (state.currentAnimation) {
    state.currentAnimation.pause();
    state.currentAnimation = null;
  }

  if (!window.anime || !elements.length) return;

  // Stan początkowy: całe bloki są niżej i trochę mniejsze
  elements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(60px) scale(0.9)';
  });

  // Dostojeństwo: dłuższy czas i większy odstęp między kolejnymi blokami
  state.currentAnimation = anime({
    targets: Array.from(elements),
    opacity: [0, 1],
    translateY: [60, 0],
    scale: [0.9, 1],
    easing: 'easeOutCubic',
    duration: 1200,              // wolniej
    delay: anime.stagger(320),   // tytuł -> podtytuł -> laureaci po kolei
    complete: () => {
      state.currentAnimation = null;
    }
  });
}

function renderCurrentSlide() {
  const slide = state.slides[state.currentSlideIndex];
  const slideLayer = document.getElementById("slide-layer");
  if (!slide || !slideLayer) return;

  slideLayer.innerHTML = "";

  let content;
  if (slide.type === "title") {
    content = createTitleSlideContent(slide.contest);
  } else {
    content = createWinnersSlideContent(slide.contest);
  }

  slideLayer.appendChild(content);
  setBackgroundForSlide(slide);

  // Dopasowanie zawartości do bezpiecznego kadru (szczególnie przy wielu laureatach)
  fitSlideContentToSafeArea();

  // Animujemy wszystko co ma klasę fade-seq
  const animatables = slideLayer.querySelectorAll(".fade-seq");
  fadeInSequence(animatables);
}

// --- Nawigacja ---

function nextSlide() {
  if (!state.presentationStarted) return;
  if (state.currentSlideIndex < state.slides.length - 1) {
    state.currentSlideIndex++;
    renderCurrentSlide();
  }
}

function prevSlide() {
  if (!state.presentationStarted) return;
  if (state.currentSlideIndex > 0) {
    state.currentSlideIndex--;
    renderCurrentSlide();
  }
}

function goToFirstSlide() {
  if (!state.presentationStarted) return;
  state.currentSlideIndex = 0;
  renderCurrentSlide();
}

function goToLastSlide() {
  if (!state.presentationStarted) return;
  state.currentSlideIndex = state.slides.length - 1;
  renderCurrentSlide();
}

function setupKeyboardNavigation() {
  window.addEventListener("keydown", (e) => {
    if (!state.presentationStarted) return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        e.preventDefault();
        nextSlide();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        e.preventDefault();
        prevSlide();
        break;
      case "Home":
        e.preventDefault();
        goToFirstSlide();
        break;
      case "End":
        e.preventDefault();
        goToLastSlide();
        break;
    }
  });
}

function requestFullscreen() {
  const elem = document.documentElement;
  if (elem.requestFullscreen) return elem.requestFullscreen();
  if (elem.webkitRequestFullscreen) return elem.webkitRequestFullscreen();
  return Promise.resolve();
}

function startPresentation() {
  const startOverlay = document.getElementById("start-overlay");
  if (startOverlay) startOverlay.style.display = "none";
  
  state.presentationStarted = true;

  if (!state.slides.length) {
    showError("Brak slajdów do wyświetlenia.");
    return;
  }

  state.currentSlideIndex = 0;
  renderCurrentSlide();
  startPolling();
}

// --- Polling (Odświeżanie danych) ---

function startPolling() {
  if (state.pollingTimer || window.OFFLINE_CONTESTS) return;
  state.pollingTimer = setInterval(refreshData, POLLING_INTERVAL);
}

async function refreshData() {
  try {
    const table = await fetchSheetData();
    if (!table) return;
    
    const newContests = parseContestsFromTable(table);
    const newSlides = buildSlidesFromContests(newContests);

    if (newSlides.length > 0) {
      // Próba zachowania pozycji slajdu
      const currentSlide = state.slides[state.currentSlideIndex];
      const currentTitle = currentSlide?.contest?.title;
      const currentType = currentSlide?.type;

      state.contests = newContests;
      state.slides = newSlides;

      let newIndex = -1;
      if (currentTitle) {
        newIndex = state.slides.findIndex(s => s.contest.title === currentTitle && s.type === currentType);
      }

      if (newIndex !== -1) {
        state.currentSlideIndex = newIndex;
      } else {
        // Safe index
        state.currentSlideIndex = Math.min(state.currentSlideIndex, Math.max(0, state.slides.length - 1));
        if (state.presentationStarted) renderCurrentSlide();
      }
      console.log("Dane odświeżone.");
    }
  } catch (err) {
    console.warn("Błąd odświeżania danych:", err);
  }
}

// --- Generator Offline ---

async function generateOfflineZip() {
  const btn = document.getElementById("download-offline-button");
  if (btn) {
    btn.classList.add("loading");
    btn.disabled = true;
  }

  try {
    // 1. Pobierz aktualne dane
    let contestsData;
    if (window.OFFLINE_CONTESTS) {
      contestsData = window.OFFLINE_CONTESTS;
    } else {
      const table = await fetchSheetData();
      contestsData = parseContestsFromTable(table);
    }

    // 2. Pobierz zasoby (CSS, JS, Video, Fonty, Biblioteki)
    // Pobieramy aktualny tekst app.js i style.css, żeby offline był identyczny
    const [bg1, bg2, font, animeLib, appJs, styleCss] = await Promise.all([
      fetch("bg-1.mp4").then(r => r.blob()),
      fetch("bg-2.mp4").then(r => r.blob()),
      fetch("fonts/Uni Sans Heavy.otf").then(r => r.blob()),
      fetch("https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js").then(r => r.text()),
      fetch("app.js").then(r => r.text()),
      fetch("style.css").then(r => r.text())
    ]);

    // 3. Zbuduj HTML offline
    // Używamy pobranego appJs jako osobnego pliku, żeby uniknąć problemu z </script>
    // wewnątrz inline'owego skryptu.
    const offlineHtml = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Prezentacja (Offline)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${styleCss}</style>
</head>
<body>
  <div id="app">
    <div id="loading-overlay"><div class="loader"></div></div>
    <div id="video-layer">
      <video id="video-title-bg" src="bg-1.mp4" autoplay muted loop playsinline></video>
      <video id="video-winners-bg" src="bg-2.mp4" autoplay muted loop playsinline></video>
    </div>
    <div id="slide-layer"></div>
    <div id="start-overlay">
      <h1>Prezentacja laureatów (Offline)</h1>
      <p>Tryb offline. Kliknij Start.</p>
      <button id="start-button">Start prezentacji</button>
    </div>
    <div id="error-message"></div>
  </div>

  <script src="anime.min.js"></script>
  <script>
    window.OFFLINE_CONTESTS = ${JSON.stringify(contestsData)};
  </script>
  <script src="app.js"></script>
</body>
</html>`;

    // 4. Pakowanie ZIP
    const zip = new JSZip();
    zip.file("index.html", offlineHtml);
    zip.file("anime.min.js", animeLib);
    zip.file("app.js", appJs);
    zip.file("bg-1.mp4", bg1);
    zip.file("bg-2.mp4", bg2);
    zip.folder("fonts").file("Uni Sans Heavy.otf", font);

    const blob = await zip.generateAsync({type:"blob"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prezentacja-offline.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Błąd generowania offline:", err);
    alert("Nie udało się wygenerować paczki.");
  } finally {
    if (btn) {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }
}

// --- Inicjalizacja Aplikacji ---

document.addEventListener("DOMContentLoaded", async () => {
  setupKeyboardNavigation();

  // Elementy UI
  const loadingOverlay = document.getElementById("loading-overlay");
  const startOverlay = document.getElementById("start-overlay");
  const startButton = document.getElementById("start-button");
  const downloadBtn = document.getElementById("download-offline-button");
  const v1 = document.getElementById("video-title-bg");
  const v2 = document.getElementById("video-winners-bg");

  if (startButton) startButton.addEventListener("click", () => {
    requestFullscreen().catch(e => console.warn(e));
    startPresentation();
  });

  if (downloadBtn) downloadBtn.addEventListener("click", generateOfflineZip);

  // Safety net (timeout ładowania)
  const safetyNet = setTimeout(() => {
    if (loadingOverlay && !loadingOverlay.classList.contains("hidden")) {
      console.warn("Safety net triggered.");
      loadingOverlay.classList.add("hidden");
      if (startOverlay) startOverlay.classList.add("visible");
      showError("Ładowanie trwało zbyt długo.");
    }
  }, 10000);

  function videoReady(video) {
    return new Promise(resolve => {
      if (!video) return resolve();
      if (video.readyState >= 3) resolve();
      else {
        video.addEventListener('canplaythrough', resolve, { once: true });
        setTimeout(resolve, 3000); // 3s timeout na wideo
      }
    });
  }

  try {
    // 1. Pobierz dane (jeśli online)
    if (!window.OFFLINE_CONTESTS) {
      const table = await fetchSheetData();
      state.contests = parseContestsFromTable(table);
    } else {
      state.contests = window.OFFLINE_CONTESTS;
    }
    
    state.slides = buildSlidesFromContests(state.contests);

    // 2. Czekaj na wideo
    await Promise.all([videoReady(v1), videoReady(v2)]);

    clearTimeout(safetyNet);

    // 3. Pokaż UI startowe
    if (v1) v1.classList.add("visible");
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
    if (startOverlay) startOverlay.classList.add("visible");

    if (!state.slides.length) {
      showError("Brak danych do wyświetlenia.");
    }

  } catch (err) {
    console.error(err);
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
    showError("Wystąpił błąd podczas ładowania aplikacji.");
  }
});
