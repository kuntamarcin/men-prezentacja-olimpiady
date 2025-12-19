/* 
  app.js - Główna logika aplikacji
*/

// --- Konfiguracja i Stan Globalny ---
// ID arkusza z bazą laureatów (Gala Olimpijczyków 2025)
const SHEET_ID = "1WfKruLD8xTsUVhsjvnmtrJHjttR9jJF_Qopizn9u6aM";
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
  const orphans = [
    'a', 'i', 'o', 'u', 'w', 'z', 
    'do', 'na', 'po', 'za', 'od', 'we', 'ze', 'ku', 
    'o', 'nr', 'im.', 'woj.', 
    'nad', 'pod', 'przez', 'przy', 'dla', 'bez'
  ];
  let result = text;
  
  // Przenoszenie zawartości w nawiasach do nowej linii
  // Zamienia "tekst (nawias)" na "tekst <br>(nawias)"
  result = result.replace(/(\s+)(\([^)]+\))/g, '<br>$2');

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

function normalizeMedal(raw) {
  if (!raw) return null;
  const val = String(raw).trim().toLowerCase();
  if (!val || val === "brak") return null;
  if (val.startsWith("zł") || val.startsWith("zl")) return "złoty";
  if (val.startsWith("srebr")) return "srebrny";
  if (val.startsWith("brą") || val.startsWith("bra")) return "brązowy";
  if (val.startsWith("wyr")) return "wyróżnienie";
  return null;
}

function medalSortKey(medal) {
  if (medal === "złoty") return 1;
  if (medal === "srebrny") return 2;
  if (medal === "brązowy") return 3;
  if (medal === "wyróżnienie") return 4;
  return 5;
}

function parseContestsFromTable(table) {
  if (window.OFFLINE_CONTESTS) return window.OFFLINE_CONTESTS;
  if (!table) return [];

  const cols = table.cols || [];
  const rows = table.rows || [];

  function findCol(label) {
    return cols.findIndex(c => (c.label || "").trim().toLowerCase() === label.toLowerCase());
  }

  let idxKind = findCol("rodzaj olimpiady");
  let idxName = findCol("nazwa olimpiady");
  let idxStudent = findCol("reprezentacja");
  let idxMedal = findCol("medal");
  let idxSchool = findCol("nazwa szkoły");

  // Fallback: szukanie w pierwszym wierszu, jeśli nagłówki nie są zdefiniowane w metadanych
  let dataRows = rows;
  if (idxKind === -1 && rows.length > 0) {
    const firstRow = rows[0].c || [];
    const headers = firstRow.map(cell => (cell && cell.v != null ? String(cell.v).trim().toLowerCase() : ""));

    idxKind = headers.indexOf("rodzaj olimpiady");
    idxName = headers.indexOf("nazwa olimpiady");
    idxStudent = headers.indexOf("reprezentacja");
    idxMedal = headers.indexOf("medal");
    idxSchool = headers.indexOf("nazwa szkoły");

    dataRows = rows.slice(1);
  }

  if (idxKind === -1 || idxName === -1) {
    console.warn("Nie znaleziono kolumn 'rodzaj olimpiady' lub 'nazwa olimpiady'.");
    return [];
  }

  const kindMap = new Map();
  let lastKind = "";
  let lastName = "";

  for (const row of dataRows) {
    const c = row.c || [];
    const getVal = (i) => (i !== -1 && c[i] && c[i].v != null) ? String(c[i].v).trim() : "";

    const kindValRaw = getVal(idxKind);
    const nameValRaw = getVal(idxName);
    const studentName = getVal(idxStudent);
    const medalRaw = getVal(idxMedal);
    const schoolVal = getVal(idxSchool);

    if (!kindValRaw && !nameValRaw && !studentName && !schoolVal && !medalRaw) {
      continue;
    }

    if (kindValRaw) lastKind = kindValRaw;
    if (nameValRaw) lastName = nameValRaw;

    const kindTitle = lastKind;
    const olympiadName = lastName;

    // Wiersz z samym rodzajem olimpiady (bez nazwy, uczniów itp.)
    // traktujemy jako osobny nagłówek – tworzymy grupę rodzaju
    // z pustą listą olimpiad, żeby powstał sam slajd tytułowy.
    if (!kindTitle) {
      continue;
    }
    if (!olympiadName) {
      if (!kindMap.has(kindTitle)) {
        kindMap.set(kindTitle, {
          kindTitle,
          olympiads: new Map()
        });
      }
      continue;
    }

    let kindGroup = kindMap.get(kindTitle);
    if (!kindGroup) {
      kindGroup = {
        kindTitle,
        olympiads: new Map()
      };
      kindMap.set(kindTitle, kindGroup);
    }

    let olympiad = kindGroup.olympiads.get(olympiadName);
    if (!olympiad) {
      olympiad = {
        name: olympiadName,
        participants: []
      };
      kindGroup.olympiads.set(olympiadName, olympiad);
    }

    if (studentName || schoolVal || medalRaw) {
      const medal = normalizeMedal(medalRaw);
      olympiad.participants.push({
        name: studentName,
        school: schoolVal,
        medal,
        medalSort: medalSortKey(medal)
      });
    }
  }

  const result = [];
  for (const [, kindGroup] of kindMap) {
    const olympiads = [];
    for (const [, olympiad] of kindGroup.olympiads) {
      olympiads.push(olympiad);
    }
    result.push({
      kindTitle: kindGroup.kindTitle,
      olympiads
    });
  }
  return result;
}

function buildSlidesFromContests(contestsByKind) {
  const slides = [];

  contestsByKind.forEach(kindGroup => {
    // Slajd z rodzajem olimpiady
    slides.push({
      type: "kind",
      kindTitle: kindGroup.kindTitle
    });

    kindGroup.olympiads.forEach(olympiad => {
      // Slajd z nazwą konkretnej olimpiady
      slides.push({
        type: "olympiadTitle",
        kindTitle: kindGroup.kindTitle,
        olympiadName: olympiad.name
      });

      // Slajd z podsumowaniem medali
      const medalCounts = {
        złoty: 0,
        srebrny: 0,
        brązowy: 0,
        wyróżnienie: 0
      };

      olympiad.participants.forEach(p => {
        if (p.medal === "złoty") medalCounts.złoty++;
        else if (p.medal === "srebrny") medalCounts.srebrny++;
        else if (p.medal === "brązowy") medalCounts.brązowy++;
        else if (p.medal === "wyróżnienie") medalCounts.wyróżnienie++;
      });

      slides.push({
        type: "medals",
        kindTitle: kindGroup.kindTitle,
        olympiadName: olympiad.name,
        medalCounts
      });

      // Slajd z reprezentacją – wszyscy uczniowie, posortowani wg medali
      const participantsSorted = [...olympiad.participants].sort((a, b) => {
        if (a.medalSort !== b.medalSort) return a.medalSort - b.medalSort;
        if (a.name && b.name) return a.name.localeCompare(b.name, "pl");
        return 0;
      });

      slides.push({
        type: "representation",
        kindTitle: kindGroup.kindTitle,
        olympiadName: olympiad.name,
        participants: participantsSorted
      });
    });
  });

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

const KIND_VIDEO_FILES = {
  "Olimpiada Języka Łacińskiego i Kultury Antycznej": "animations/bg_olimpiada_jezyka_lacinskiego_i_kultury_antycznej.mp4",
  "Olimpiada Fizyczna": "animations/bg_olimpiada_fizyczna.mp4",
  "Olimpiada Biologiczna": "animations/bg_olimpiada_biologiczna.mp4",
  "Olimpiada Informatyczna": "animations/bg_olimpiada_informatyczna.mp4",
  "Olimpiada Informatyczna Juniorów": "animations/bg_olimpiada_informatyczna_juniorow.mp4",
  "Olimpiada Chemiczna": "animations/bg_olimpiada_chemiczna.mp4",
  "Olimpiada Filozoficzna": "animations/bg_olimpiada_filozoficzna.mp4",
  "Olimpiada Geograficzna": "animations/bg_olimpiada_geograficzna.mp4",
  "Olimpiada Matematyczna": "animations/bg_olimpiada_matematyczna.mp4",
  "Olimpiada Lingwistyki Matematycznej": "animations/bg_olimpiada_lingwistyki_matematycznej.mp4",
  "Olimpiada Astronomiczna": "animations/bg_olimpiada_astronomiczna.mp4",
  "Olimpiada Astronomii i Astrofizyki": "animations/bg_olimpiada_astrofizyczna.mp4",
  "Olimpiada Wiedzy Ekonomicznej": "animations/bg_wiedzy_ekonomicznej.mp4",
  "Konkurs Umiejętności Zawodowych": "animations/bg_konkurs_umiejetnosci_zawodowych.mp4"
};

const DEFAULT_BG_VIDEO = "animations/bg-ogolny.mp4";

function getVideoForKind(kindTitle) {
  return KIND_VIDEO_FILES[kindTitle] || DEFAULT_BG_VIDEO;
}

function createKindSlideContent(kindTitle) {
  const container = document.createElement("div");
  container.className = "slide-content";

  const titleEl = document.createElement("div");
  titleEl.className = "slide-title fade-seq";
  titleEl.innerHTML = fixOrphans(kindTitle || "(bez rodzaju)");

  container.appendChild(titleEl);
  return container;
}

function createOlympiadTitleSlideContent(kindTitle, olympiadName) {
  const container = document.createElement("div");
  container.className = "slide-content";

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "slide-subtitle fade-seq";
  subtitleEl.innerHTML = fixOrphans(kindTitle || "");

  const titleEl = document.createElement("div");
  titleEl.className = "slide-title fade-seq";
  titleEl.innerHTML = fixOrphans(olympiadName || "(bez nazwy)");

  container.appendChild(subtitleEl);
  container.appendChild(titleEl);
  return container;
}

function createMedalsSlideContent(slide) {
  const container = document.createElement("div");
  container.className = "slide-content slide-content--medals";

  // Usunięto nagłówek "Nagrody" na życzenie użytkownika
  // const headerEl = document.createElement("div");
  // headerEl.className = "winners-header fade-seq";
  // headerEl.textContent = "Nagrody";

  const listEl = document.createElement("div");
  listEl.className = "winners-list winners-list--medals";

  const parts = [];

  if (slide.medalCounts.złoty > 0) {
    parts.push({ key: "złoty", label: "złote", count: slide.medalCounts.złoty });
  }
  if (slide.medalCounts.srebrny > 0) {
    parts.push({ key: "srebrny", label: "srebrne", count: slide.medalCounts.srebrny });
  }
  if (slide.medalCounts.brązowy > 0) {
    parts.push({ key: "brązowy", label: "brązowe", count: slide.medalCounts.brązowy });
  }
  if (slide.medalCounts.wyróżnienie > 0) {
    parts.push({ key: "wyróżnienie", label: "wyróżnienia", count: slide.medalCounts.wyróżnienie });
  }

  // Dodajemy klasę pomocniczą w zależności od liczby kolumn (rodzajów medali)
  // Umożliwia to skalowanie ikon/tekstu w CSS (np. ogromne przy 1 rodzaju)
  listEl.classList.add(`medals-count-${parts.length}`);

  parts.forEach(p => {
    const item = document.createElement("div");
    item.className = "winner winner--medal fade-seq";

    const iconWrapper = document.createElement("div");
    iconWrapper.className = "medal-label-icon-wrapper";

    const medalVideoSrc = getVideoForMedal(p.key);
    if (medalVideoSrc) {
      const medalEl = document.createElement("video");
      medalEl.className = "medal-icon medal-icon--large";
      medalEl.src = medalVideoSrc;
      medalEl.autoplay = true;
      medalEl.muted = true;
      medalEl.loop = true;
      medalEl.playsInline = true;
      medalEl.setAttribute("preload", "auto");
      iconWrapper.appendChild(medalEl);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "winner-name";
    nameEl.textContent = `${p.label}: ${p.count}`;

    item.appendChild(iconWrapper);
    item.appendChild(nameEl);
    listEl.appendChild(item);
  });

  // container.appendChild(headerEl);
  container.appendChild(listEl);
  return container;
}

const MEDAL_VIDEO_FILES = {
  "złoty": "animations/zloto.webm",
  "srebrny": "animations/srebro.webm",
  "brązowy": "animations/braz.webm",
  "wyróżnienie": "animations/wyroznienie.webm"
};

function getVideoForMedal(medal) {
  if (!medal) return null;
  return MEDAL_VIDEO_FILES[medal] || null;
}

function createRepresentationSlideContent(slide) {
  const container = document.createElement("div");
  container.className = "slide-content";

  const headerEl = document.createElement("div");
  headerEl.className = "winners-header fade-seq";
  headerEl.textContent = slide.olympiadName || "Reprezentacja";

  const listEl = document.createElement("div");
  listEl.className = "winners-list";

  // Porządek zawsze: złote -> srebrne -> brązowe -> wyróżnienia -> bez medalu
  // (potem szkoła, potem nazwisko).
  const participantsSorted = (Array.isArray(slide.participants) ? [...slide.participants] : []).sort((a, b) => {
    const aSort = a && a.medalSort != null ? a.medalSort : medalSortKey(a ? a.medal : null);
    const bSort = b && b.medalSort != null ? b.medalSort : medalSortKey(b ? b.medal : null);
    if (aSort !== bSort) return aSort - bSort;

    const aSchool = (a && a.school) ? a.school : "";
    const bSchool = (b && b.school) ? b.school : "";
    const schoolCmp = aSchool.localeCompare(bSchool, "pl");
    if (schoolCmp !== 0) return schoolCmp;

    const aName = (a && a.name) ? a.name : "";
    const bName = (b && b.name) ? b.name : "";
    return aName.localeCompare(bName, "pl");
  });

  // Przy bardzo długich listach przełączamy się na 2 kolumny,
  // żeby nazwiska lepiej wypełniały przestrzeń i mieściły się w kadrze.
  // Ważne: dzielimy równo po liczbie osób (a nie "po wysokości" jak w CSS columns).
  const totalParticipants = participantsSorted.length;
  if (totalParticipants >= 10) {
    container.classList.add("slide-content--wide");
    listEl.classList.add("winners-list--two-cols");

    const colLeft = document.createElement("div");
    colLeft.className = "winners-col";

    const colRight = document.createElement("div");
    colRight.className = "winners-col";

    listEl.appendChild(colLeft);
    listEl.appendChild(colRight);

    const splitIndex = Math.ceil(totalParticipants / 2);

    participantsSorted.forEach((p, idx) => {
      const block = document.createElement("div");
      block.className = "winner-person-block fade-seq";

      const medalVideoSrc = getVideoForMedal(p.medal);
      if (medalVideoSrc) {
        const medalEl = document.createElement("video");
        medalEl.className = "medal-icon medal-icon--person";
        medalEl.src = medalVideoSrc;
        medalEl.autoplay = true;
        medalEl.muted = true;
        medalEl.loop = true;
        medalEl.playsInline = true;
        medalEl.setAttribute("preload", "auto");
        block.appendChild(medalEl);
      }

      const nameEl = document.createElement("div");
      nameEl.className = "winner-name";
      nameEl.innerHTML = fixOrphans(p.name || "");
      block.appendChild(nameEl);

      if (p.school) {
        const schoolEl = document.createElement("div");
        schoolEl.className = "winner-details";
        schoolEl.innerHTML = fixOrphans(p.school);
        block.appendChild(schoolEl);
      }

      const targetCol = idx < splitIndex ? colLeft : colRight;
      targetCol.appendChild(block);
    });

    container.appendChild(headerEl);
    container.appendChild(listEl);
    return container;
  }

  // Dla krótszych list: jedna kolumna, ale dalej ta sama kolejność (wg medali).
  participantsSorted.forEach(p => {
    const block = document.createElement("div");
    block.className = "winner-person-block fade-seq";

    const medalVideoSrc = getVideoForMedal(p.medal);
    if (medalVideoSrc) {
      const medalEl = document.createElement("video");
      medalEl.className = "medal-icon medal-icon--person";
      medalEl.src = medalVideoSrc;
      medalEl.autoplay = true;
      medalEl.muted = true;
      medalEl.loop = true;
      medalEl.playsInline = true;
      medalEl.setAttribute("preload", "auto");
      block.appendChild(medalEl);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "winner-name";
    nameEl.innerHTML = fixOrphans(p.name || "");
    block.appendChild(nameEl);

    if (p.school) {
      const schoolEl = document.createElement("div");
      schoolEl.className = "winner-details";
      schoolEl.innerHTML = fixOrphans(p.school);
      block.appendChild(schoolEl);
    }

    listEl.appendChild(block);
  });

  container.appendChild(headerEl);
  container.appendChild(listEl);
  return container;
}

function setBackgroundForSlide(slide) {
  const video = document.getElementById("video-bg");
  if (!video) return;

  let targetSrc = DEFAULT_BG_VIDEO;
  if (slide.type === "kind" || slide.type === "olympiadTitle") {
    targetSrc = getVideoForKind(slide.kindTitle);
  }

  const current = video.getAttribute("data-src") || video.getAttribute("src") || "";
  if (current.endsWith(targetSrc)) {
    return;
  }

  video.setAttribute("data-src", targetSrc);
  const wasPaused = video.paused;

  video.src = targetSrc;
  if (!wasPaused) {
    video.play().catch(() => {});
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
  if (slide.type === "kind") {
    content = createKindSlideContent(slide.kindTitle);
  } else if (slide.type === "olympiadTitle") {
    content = createOlympiadTitleSlideContent(slide.kindTitle, slide.olympiadName);
  } else if (slide.type === "medals") {
    content = createMedalsSlideContent(slide);
  } else if (slide.type === "representation") {
    content = createRepresentationSlideContent(slide);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "slide-content";
    fallback.textContent = "Brak danych do wyświetlenia.";
    content = fallback;
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
  // Automatyczne odświeżanie z arkusza wyłączone na czas prezentacji,
  // żeby slajdy nie zmieniały się same.
  // startPolling();
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
      const prevIndex = state.currentSlideIndex;

      state.contests = newContests;
      state.slides = newSlides;

      state.currentSlideIndex = Math.min(prevIndex, Math.max(0, state.slides.length - 1));

      if (state.presentationStarted) {
        renderCurrentSlide();
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
    const videoFileNames = [
      "animations/bg-ogolny.mp4",
      "animations/bg_olimpiada_jezyka_lacinskiego_i_kultury_antycznej.mp4",
      "animations/bg_olimpiada_fizyczna.mp4",
      "animations/bg_olimpiada_biologiczna.mp4",
      "animations/bg_olimpiada_informatyczna.mp4",
      "animations/bg_olimpiada_informatyczna_juniorow.mp4",
      "animations/bg_olimpiada_chemiczna.mp4",
      "animations/bg_olimpiada_filozoficzna.mp4",
      "animations/bg_olimpiada_geograficzna.mp4",
      "animations/bg_olimpiada_matematyczna.mp4",
      "animations/bg_olimpiada_lingwistyki_matematycznej.mp4",
      "animations/bg_olimpiada_astronomiczna.mp4",
      "animations/bg_olimpiada_astrofizyczna.mp4",
      "animations/bg_wiedzy_ekonomicznej.mp4",
      "animations/bg_konkurs_umiejetnosci_zawodowych.mp4",
      "animations/zloto.webm",
      "animations/srebro.webm",
      "animations/braz.webm",
      "animations/wyroznienie.webm"
    ];

    const [videoBlobs, font, animeLib, appJs, styleCss] = await Promise.all([
      Promise.all(videoFileNames.map(name => fetch(name).then(r => r.blob()))),
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
  <title>Gala olimpijczyków międzynarodowych 2025 (Offline)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${styleCss}</style>
</head>
<body>
  <div id="app">
    <div id="loading-overlay"><div class="loader"></div></div>
    <div id="video-layer">
      <video id="video-bg" src="animations/bg-ogolny.mp4" autoplay muted loop playsinline></video>
    </div>
    <div id="slide-layer"></div>
    <div id="start-overlay">
      <h1>Gala olimpijczyków międzynarodowych 2025 (Offline)</h1>
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
    videoFileNames.forEach((name, idx) => {
      zip.file(name, videoBlobs[idx]);
    });
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
  const bgVideo = document.getElementById("video-bg");

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
    await videoReady(bgVideo);

    clearTimeout(safetyNet);

    // 3. Pokaż UI startowe
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
