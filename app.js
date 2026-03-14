// Loading spinner
function showLoading() {
    if (document.getElementById('loading-spinner')) return;
    const loader = document.createElement('div');
    loader.id = 'loading-spinner';
    loader.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(loader);
}
function hideLoading() {
    const loader = document.getElementById('loading-spinner');
    if (loader) loader.remove();
}
const SERVER = "cz1";
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_SIMRAIL_BASE = IS_LOCALHOST ? "http://localhost:8080/https://panel.simrail.eu:8084" : "/api-simrail";
const API_AWS_BASE = IS_LOCALHOST ? "http://localhost:8080/https://api1.aws.simrail.eu:8082/api" : "/api-aws";
const API_STATIONS = `${API_SIMRAIL_BASE}/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `${API_SIMRAIL_BASE}/trains-open?serverCode=${SERVER}`;
const API_POSITIONS = `${API_SIMRAIL_BASE}/train-positions-open?serverCode=${SERVER}`;
const API_EDR = `${API_AWS_BASE}/getEDRTimetables?serverCode=${SERVER}`;
const API_STEAM_NAME = IS_LOCALHOST ? "http://localhost:8080/steam-name" : "/api/steam-name";

const elements = {
    homeScreen: document.getElementById("home-screen"),
    landingScreen: document.getElementById("landing-screen"),
    stationHub: document.getElementById("station-hub"),
    trainHub: document.getElementById("train-hub"),
    boardHub: document.getElementById("board-hub"),
    enterStationsBtn: document.getElementById("enter-stations-btn"),
    enterTrainsBtn: document.getElementById("enter-trains-btn"),
    enterBoardsBtn: document.getElementById("enter-boards-btn"),
    hubBackBtn: document.getElementById("hub-back-btn"),
    trainHubBackBtn: document.getElementById("train-hub-back-btn"),
    boardHubBackBtn: document.getElementById("board-hub-back-btn"),
    mainContent: document.getElementById("main-content"),
    trainContent: document.getElementById("train-content"),
    boardContent: document.getElementById("board-content"),
    stationsGrid: document.getElementById("stations-grid"),
    trainsGrid: document.getElementById("trains-grid"),
    boardStationsGrid: document.getElementById("board-stations-grid"),
    stationSearch: document.getElementById("station-search"),
    trainHubSearch: document.getElementById("train-hub-search"),
    boardStationSearch: document.getElementById("board-station-search"),
    stationName: document.getElementById("st-name"),
    boardPageStation: document.getElementById("board-page-station"),
    boardPageClock: document.getElementById("board-page-clock"),
    boardViewBackBtn: document.getElementById("board-view-back-btn"),
    dualBoardContainer: document.getElementById("dual-board-container"),
    departuresBody: document.getElementById("departures-body"),
    backBtn: document.getElementById("back-btn"),
    trainBackBtn: document.getElementById("train-back-btn"),
    clock: document.getElementById("clock"),
    trainPanelClock: document.getElementById("train-panel-clock"),
    trainPanelNumber: document.getElementById("train-panel-number"),
    trainSideNumber: document.getElementById("train-side-number"),
    trainOrigin: document.getElementById("train-origin"),
    trainDestination: document.getElementById("train-destination"),
    trainPreviousStop: document.getElementById("train-previous-stop"),
    trainNextStop: document.getElementById("train-next-stop"),
    trainPanelClass: document.getElementById("train-panel-class"),
    trainPanelVehicle: document.getElementById("train-panel-vehicle"),
    trainPanelDelay: document.getElementById("train-panel-delay"),
    trainLiveBanner: document.getElementById("train-live-banner"),
    trainLiveStation: document.getElementById("train-live-station"),
    trainTimetableBody: document.getElementById("train-timetable-body"),
    kpiActive: document.getElementById("kpi-active"),
    kpiStation: document.getElementById("kpi-station"),
    kpiDelay: document.getElementById("kpi-delay"),
    trainSearch: document.getElementById("train-search"),
    sortMode: document.getElementById("sort-mode"),
    filterChips: Array.from(document.querySelectorAll(".filter-chip"))
};

let allStations = [];
let cachedEDR = [];
let currentStation = null;
let expandedTrains = new Set();
let isFirstLoad = true;
let refreshTimer = null;
let activeRequestId = 0;
let lastRenderedTrains = [];
let lastLiveData = null;
let lastStationRows = [];
let lastPositionsData = null;
let lastTrainHubItems = [];
let currentTrainNo = null;
let currentBoardStation = null;
let currentView = "landing";
let trainPanelNeedsFocus = false;
let boardDirectionRotatorTimer = null;
const steamPlayerNameCache = new Map();
const steamPlayerNamePending = new Set();

const BOARD_MAX_ROWS = 8;
const BOARD_PAST_WINDOW_MIN = 10;
const BOARD_FUTURE_WINDOW_MIN = 120;

const uiState = {
    stationFilter: "all",
    trainQuery: "",
    sortMode: "time",
    trainHubQuery: "",
    boardHubQuery: ""
};

function showLoading() {
    if (document.getElementById("loading-spinner")) return;
    const loader = document.createElement("div");
    loader.id = "loading-spinner";
    loader.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(loader);
}

function hideLoading() {
    const loader = document.getElementById("loading-spinner");
    if (loader) loader.remove();
}

function norm(str) {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/\s+/g, "");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch {
        return null;
    }
}

function fmt(dateValue) {
    if (!dateValue) return "--:--";
    return new Date(dateValue).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function isTechnicalStopName(stopName) {
    return ["PZS", "R145", "R154", "Glowice"].some((ignored) => String(stopName || "").includes(ignored));
}

function getRelevantTimetable(timetable) {
    return (Array.isArray(timetable) ? timetable : []).filter((entry) => !isTechnicalStopName(entry?.nameForPerson));
}

function getCleanName(timetable, index, direction) {
    let currentIndex = index + direction;
    while (currentIndex >= 0 && currentIndex < timetable.length) {
        const stopName = timetable[currentIndex].nameForPerson;
        if (!isTechnicalStopName(stopName)) {
            return stopName;
        }
        currentIndex += direction;
    }
    return direction === -1 ? "Výchozí" : "Cíl";
}

function setClock() {
    const formatted = new Date().toLocaleTimeString("cs-CZ");
    if (elements.clock) {
        elements.clock.textContent = formatted;
    }
    if (elements.trainPanelClock) {
        elements.trainPanelClock.textContent = formatted;
    }
    if (elements.boardPageClock) {
        elements.boardPageClock.textContent = new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    }
}

function parseVehicles(rawVehicles) {
    const raw = String(rawVehicles || "").trim();
    if (!raw) {
        return { leadVehicle: "", consist: "" };
    }

    const consist = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
    if (!consist) {
        return { leadVehicle: "", consist: "" };
    }

    const firstVehicle = consist.split(",")[0].trim();
    const modelPart = firstVehicle.includes("/") ? firstVehicle.split("/")[1] : firstVehicle;
    const leadVehicle = modelPart.split(":")[0].trim();

    return { leadVehicle, consist };
}

function getVehicleImagePath(vehicles) {
    const haystack = `${vehicles?.leadVehicle || ""} ${vehicles?.consist || ""}`.toUpperCase();
    const compact = haystack.replace(/[^A-Z0-9]/g, "");

    if (compact.includes("36WED")) return "https://wiki.simrail.eu/vehicle/poland/trains/elec-multiple-unit/impuls2/20260224104216_1.jpg";
    if (compact.includes("E6ACTA") || compact.includes("DRAGON2") || compact.includes("ET25")) return "https://wiki.simrail.eu/vehicle/et25-002.png";
    if (compact.includes("ET22")) return "https://wiki.simrail.eu/vehicle/et22-243.png";
    if (compact.includes("EU07") || compact.includes("EP07") || compact.includes("4E")) return "https://wiki.simrail.eu/vehicle/eu07-005.png";
    if (compact.includes("EP08")) return "https://wiki.simrail.eu/vehicle/ep08-001.png";
    if (compact.includes("163") || compact.includes("71E")) return "https://wiki.simrail.eu/vehicle/163_021-9.png";
    if (compact.includes("E186") || compact.includes("TRAXX") || compact.includes("EU43")) return "https://wiki.simrail.eu/vehicle/e186-134.png";
    if (compact.includes("ED250") || compact.includes("PENDOLINO")) return "https://wiki.simrail.eu/vehicle/ed250-001.png";
    if (compact.includes("EN76") || compact.includes("EN96") || compact.includes("ELF")) return "https://wiki.simrail.eu/vehicle/en76-006.png";
    if (compact.includes("EN57")) return "https://wiki.simrail.eu/vehicle/en57-009.png";
    if (compact.includes("EN71")) return "https://wiki.simrail.eu/vehicle/en71-002.png";
    if (compact.includes("TY2") || compact.includes("BR52")) return "https://wiki.simrail.eu/vehicle/ty2-70.png";

    // Broad fallbacks so most unknown variants still get a representative image.
    if (compact.includes("EN")) return "https://wiki.simrail.eu/vehicle/en57-009.png";
    if (compact.includes("ED")) return "https://wiki.simrail.eu/vehicle/ed250-001.png";
    if (compact.includes("ET")) return "https://wiki.simrail.eu/vehicle/et22-243.png";
    if (compact.includes("EP")) return "https://wiki.simrail.eu/vehicle/ep08-001.png";
    if (compact.includes("EU")) return "https://wiki.simrail.eu/vehicle/eu07-005.png";
    if (compact.includes("E6ACT")) return "https://wiki.simrail.eu/vehicle/et25-002.png";
    if (compact.includes("E186") || compact.includes("TRAXX")) return "https://wiki.simrail.eu/vehicle/e186-134.png";
    if (compact.includes("163")) return "https://wiki.simrail.eu/vehicle/163_021-9.png";

    return "";
}

function getClassFallbackImage(classCode) {
    const code = String(classCode || "").toUpperCase();

    if (["EIP", "EIC", "ECE", "EC", "IC"].includes(code)) {
        return "https://wiki.simrail.eu/vehicle/ed250-001.png";
    }
    if (["TLK", "MPE"].includes(code)) {
        return "https://wiki.simrail.eu/vehicle/eu07-005.png";
    }
    if (["R", "RE", "REG", "KS", "KD", "EN"].includes(code)) {
        return "https://wiki.simrail.eu/vehicle/en57-009.png";
    }
    if (["TME", "LTE"].includes(code)) {
        return "https://wiki.simrail.eu/vehicle/et25-002.png";
    }

    return "https://wiki.simrail.eu/vehicle/eu07-005.png";
}

function getVehicleCodeLabel(vehicles) {
    const fromLead = String(vehicles?.leadVehicle || "").trim();
    const fromConsist = String(vehicles?.consist || "").split(",")[0].trim();
    const raw = fromLead || fromConsist;
    if (!raw) return "VOZIDLO";

    const normalized = raw.toUpperCase();
    if (normalized.includes("ED250")) return "ED250";
    if (normalized.includes("36WED")) return "36WED";
    const token = normalized
        .replace(/^\{/, "")
        .replace(/\}$/, "")
        .replace(/^[^A-Z0-9]+/, "")
        .split(/[\s,:]/)[0]
        .split("/")
        .pop();

    return token || "VOZIDLO";
}

function getTrainClassCode(trainName) {
    const token = String(trainName || "")
        .trim()
        .toUpperCase()
        .split(/\s+/)[0]
        .replace(/[^A-Z0-9]/g, "");

    if (!token) return "JINY";
    if (token.startsWith("TLK")) return "TLK";
    if (token.startsWith("MPE")) return "MPE";
    if (token.startsWith("ECE")) return "ECE";
    if (token.startsWith("EIP")) return "EIP";
    if (token.startsWith("EIC")) return "EIC";
    if (token === "EC") return "EC";
    if (token === "IC") return "IC";
    if (token === "RE") return "RE";
    if (token === "R") return "R";
    if (token.startsWith("EN")) return "EN";
    if (token.startsWith("REG") || token.startsWith("KS") || token.startsWith("KD")) return "REG";
    return token;
}

function getTrainClassBadgeClass(classCode) {
    if (["EIP", "EIC", "ECE", "EC", "IC"].includes(classCode)) return "class-premium";
    if (classCode === "TLK") return "class-tlk";
    if (classCode === "MPE") return "class-mpe";
    if (["R", "RE", "REG", "KS", "KD"].includes(classCode)) return "class-regional";
    if (classCode === "EN") return "class-night";
    return "class-other";
}

function isFastClass(classCode) {
    return ["EIP", "EIC", "ECE", "EC", "IC"].includes(classCode);
}

function applyRowsUiState(rows) {
    const query = norm(uiState.trainQuery);

    let filtered = rows.filter((row) => {
        const delay = row.delayMinutes || 0;
        const inStation = row.currentIndex === row.stop.indexOfPoint;
        const classCode = getTrainClassCode(row.train?.trainName);

        if (uiState.stationFilter === "station" && !inStation) return false;
        if (uiState.stationFilter === "delayed" && delay <= 0) return false;
        if (uiState.stationFilter === "fast" && !isFastClass(classCode)) return false;

        if (!query) return true;

        const haystack = `${row.train?.trainName || ""} ${row.train?.trainNoLocal || ""}`;
        return norm(haystack).includes(query);
    });

    if (uiState.sortMode === "delay") {
        filtered = filtered.slice().sort((first, second) => {
            const delayDiff = (second.delayMinutes || 0) - (first.delayMinutes || 0);
            if (delayDiff !== 0) return delayDiff;
            return first.plannedTime - second.plannedTime;
        });
    }

    return filtered;
}

function setActiveFilterChip(selectedFilter) {
    elements.filterChips.forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === selectedFilter);
    });
}

function getFallbackPlayerLabel(trainData, steamNameFromCache) {
    const steamId = String(trainData?.ControlledBySteamID || "").trim();
    const xboxId = String(trainData?.ControlledByXboxID || "").trim();

    if (steamNameFromCache) {
        return steamNameFromCache;
    }

    if (steamId && steamId !== "0") {
        return `Steam ${steamId}`;
    }

    if (xboxId && xboxId !== "0") {
        return `Xbox ${xboxId}`;
    }

    return "Hráč";
}

function getTrainControlInfo(liveTrain) {
    const trainData = liveTrain?.TrainData || {};
    const steamId = String(trainData.ControlledBySteamID || "").trim();
    const xboxId = String(trainData.ControlledByXboxID || "").trim();
    const playerName = String(
        trainData.ControlledBySteamName ||
        trainData.ControlledByPlayerName ||
        trainData.ControlledByName ||
        liveTrain?.ControlledBySteamName ||
        liveTrain?.ControlledByPlayerName ||
        ""
    ).trim();

    const hasSteam = steamId && steamId !== "0";
    const hasXbox = xboxId && xboxId !== "0";
    const steamNameFromCache = hasSteam ? String(steamPlayerNameCache.get(steamId) || "").trim() : "";
    const isHuman = Boolean(playerName || hasSteam || hasXbox);

    if (!isHuman) {
        return {
            shortLabel: "AI",
            detailLabel: "Řídí AI",
            cssClass: "control-ai"
        };
    }

    const resolvedName = playerName || getFallbackPlayerLabel(trainData, steamNameFromCache);
    return {
        shortLabel: `Hráč: ${resolvedName}`,
        detailLabel: `Řídí hráč: ${resolvedName}`,
        cssClass: "control-player"
    };
}

function getSteamNameUrl(steamId) {
    const safeId = encodeURIComponent(String(steamId || "").trim());
    return `${API_STEAM_NAME}?steamId=${safeId}`;
}

async function fetchSteamPlayerName(steamId) {
    const normalizedId = String(steamId || "").trim();
    if (!normalizedId || normalizedId === "0") return null;
    if (steamPlayerNameCache.has(normalizedId)) return steamPlayerNameCache.get(normalizedId);
    if (steamPlayerNamePending.has(normalizedId)) return null;

    steamPlayerNamePending.add(normalizedId);
    try {
        const response = await fetch(getSteamNameUrl(normalizedId));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json();
        const name = String(payload?.name || "").trim();
        const finalName = name && name.toLowerCase() !== "private profile" ? name : null;
        if (finalName) {
            steamPlayerNameCache.set(normalizedId, finalName);
        }
        return finalName;
    } catch {
        return null;
    } finally {
        steamPlayerNamePending.delete(normalizedId);
    }
}

async function resolveSteamNamesForRows(rows) {
    const steamIds = Array.from(new Set(
        (rows || [])
            .map((row) => String(row?.live?.TrainData?.ControlledBySteamID || "").trim())
            .filter((steamId) => steamId && steamId !== "0" && !steamPlayerNameCache.has(steamId))
    ));

    if (!steamIds.length) return;

    const names = await Promise.all(steamIds.map((steamId) => fetchSteamPlayerName(steamId)));
    const hasAnyResolvedName = names.some((entry) => Boolean(entry));
    if (hasAnyResolvedName) {
        rerenderCurrentStation();
    }
}

function rerenderCurrentStation() {
    if (!currentStation || !lastLiveData || !lastPositionsData) return;
    renderTable(lastLiveData, lastPositionsData);
}

function resetTableControls() {
    uiState.stationFilter = "all";
    uiState.trainQuery = "";
    uiState.sortMode = "time";

    if (elements.trainSearch) elements.trainSearch.value = "";
    if (elements.sortMode) elements.sortMode.value = "time";
    setActiveFilterChip("all");
}

function getApiHint() {
    if (!IS_LOCALHOST) return "";
    return ' Na localhostu spusť také proxy přes příkaz: node proxy.js';
}

function getStopPlanDate(stop) {
    return new Date(stop?.departureTime || stop?.arrivalTime || 0);
}

function getPointDelayMinutes(point) {
    if (!point) return null;

    const plannedRaw = point.departureTime || point.arrivalTime;
    const actualRaw = point.actualDepartureTime || point.actualArrivalTime;
    if (!plannedRaw || !actualRaw) return null;

    const plannedMs = new Date(plannedRaw).getTime();
    const actualMs = new Date(actualRaw).getTime();
    if (!Number.isFinite(plannedMs) || !Number.isFinite(actualMs)) return null;

    return Math.max(0, Math.round((actualMs - plannedMs) / 60000));
}

function computeTrainDelayMinutes(train, stop, currentIndex) {
    const stopDelay = getPointDelayMinutes(stop);
    if (stopDelay !== null) return stopDelay;

    if (currentIndex >= 0) {
        const currentPoint = train.timetable.find((entry) => entry.indexOfPoint === currentIndex);
        const currentDelay = getPointDelayMinutes(currentPoint);
        if (currentDelay !== null) return currentDelay;

        for (let index = train.timetable.length - 1; index >= 0; index -= 1) {
            const entry = train.timetable[index];
            if (entry.indexOfPoint > currentIndex) continue;
            const historicalDelay = getPointDelayMinutes(entry);
            if (historicalDelay !== null) return historicalDelay;
        }

        const currentPointFallback = train.timetable.find((entry) => entry.indexOfPoint === currentIndex);
        const plannedNowRaw = currentPointFallback?.departureTime || currentPointFallback?.arrivalTime;
        const plannedNowMs = plannedNowRaw ? new Date(plannedNowRaw).getTime() : NaN;
        if (Number.isFinite(plannedNowMs)) {
            const lagMinutes = Math.round((Date.now() - plannedNowMs) / 60000);
            if (lagMinutes > 0) return Math.min(lagMinutes, 180);
        }
    }

    const plannedStopRaw = stop?.departureTime || stop?.arrivalTime;
    const plannedStopMs = plannedStopRaw ? new Date(plannedStopRaw).getTime() : NaN;
    if (Number.isFinite(plannedStopMs)) {
        const lagAtStop = Math.round((Date.now() - plannedStopMs) / 60000);
        if (lagAtStop > 0 && currentIndex <= stop.indexOfPoint) return Math.min(lagAtStop, 180);
    }

    return 0;
}

function collectStationRows(liveData) {
    const target = norm(currentStation);
    if (!target) return [];

    return cachedEDR
        .map((train) => {
            const stop = train.timetable.find((entry) => norm(entry.nameForPerson).includes(target));
            if (!stop) return null;

            const live = liveData?.data?.find((entry) => String(entry.TrainNoLocal) === String(train.trainNoLocal));
            const currentIndex = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
            const plannedTime = getStopPlanDate(stop).getTime();
            const delayMinutes = computeTrainDelayMinutes(train, stop, currentIndex);

            return { train, stop, live, currentIndex, plannedTime, delayMinutes };
        })
        .filter(Boolean)
        .sort((first, second) => {
            const now = Date.now();
            const firstIsPast = first.plannedTime < now;
            const secondIsPast = second.plannedTime < now;
            if (firstIsPast !== secondIsPast) return firstIsPast ? 1 : -1;
            return first.plannedTime - second.plannedTime;
        });
}

function renderStationGrid(stations) {
    if (!stations.length) {
        elements.stationsGrid.innerHTML = '<div class="empty-state">Žádná stanice nenalezena.</div>';
        return;
    }

    elements.stationsGrid.innerHTML = stations
        .map((station) => {
            const initials = station.Name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
            const imageUrl = String(station.MainImageURL || "").trim();
            return `
                <button type="button" class="st-card ${imageUrl ? "has-photo" : "no-photo"}" data-station="${escapeHtml(station.Name)}">
                    <span class="st-card-bg" aria-hidden="true">
                        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
                    </span>
                    <span class="st-card-media" aria-hidden="true">${escapeHtml(initials || "ST")}</span>
                    <span class="st-card-title">${escapeHtml(station.Name)}</span>
                </button>
            `;
        })
        .join("");
}

function renderBoardStationGrid(stations) {
    if (!stations.length) {
        elements.boardStationsGrid.innerHTML = '<div class="empty-state">Žádná stanice nenalezena.</div>';
        return;
    }

    elements.boardStationsGrid.innerHTML = stations
        .map((station) => {
            const initials = station.Name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
            const imageUrl = String(station.MainImageURL || "").trim();
            return `
                <button type="button" class="st-card ${imageUrl ? "has-photo" : "no-photo"}" data-board-station="${escapeHtml(station.Name)}">
                    <span class="st-card-bg" aria-hidden="true">
                        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
                    </span>
                    <span class="st-card-media" aria-hidden="true">${escapeHtml(initials || "ST")}</span>
                    <span class="st-card-title">${escapeHtml(station.Name)}</span>
                </button>
            `;
        })
        .join("");
}

function getBoardEventTime(row, boardType) {
    if (boardType === "arrivals") {
        return new Date(row.stop?.arrivalTime || row.stop?.departureTime || 0).getTime();
    }
    return new Date(row.stop?.departureTime || row.stop?.arrivalTime || 0).getTime();
}

function isBoardCandidate(row, boardType) {
    const now = Date.now();
    const eventTime = getBoardEventTime(row, boardType);
    if (!Number.isFinite(eventTime)) return false;

    const inWindow = eventTime >= now - BOARD_PAST_WINDOW_MIN * 60 * 1000 && eventTime <= now + BOARD_FUTURE_WINDOW_MIN * 60 * 1000;
    if (!inWindow) return false;

    if (!row.live) return true;

    if (boardType === "arrivals") {
        // Remove arrival rows once the train has clearly passed the station.
        return row.currentIndex <= row.stop.indexOfPoint;
    }

    // Keep departure row only until the departure moment; then hide it.
    return row.currentIndex >= row.stop.indexOfPoint - 1 && row.currentIndex <= row.stop.indexOfPoint + 1;
}

function collectBoardRows(stationName, liveData) {
    const target = norm(stationName);
    if (!target) return [];

    return cachedEDR
        .map((train) => {
            const stop = train.timetable.find((entry) => norm(entry.nameForPerson).includes(target));
            if (!stop) return null;

            const live = liveData?.data?.find((entry) => String(entry.TrainNoLocal) === String(train.trainNoLocal));
            const currentIndex = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
            const plannedTime = getStopPlanDate(stop).getTime();
            const delayMinutes = computeTrainDelayMinutes(train, stop, currentIndex);

            return { train, stop, live, currentIndex, plannedTime, delayMinutes };
        })
        .filter(Boolean);
}

function buildBoardRowsByType(rows, boardType) {
    const now = Date.now();

    const statusPriority = (row) => {
        const stopIndex = row.stop?.indexOfPoint;
        const currentIndex = row.currentIndex;
        if (currentIndex === stopIndex) return 0; // In station first.
        if (boardType === "departures" && currentIndex === stopIndex + 1) return 1; // Just departing.
        return 2;
    };

    return rows
        .filter((row) => isBoardCandidate(row, boardType))
        .sort((first, second) => {
            const firstPriority = statusPriority(first);
            const secondPriority = statusPriority(second);
            if (firstPriority !== secondPriority) return firstPriority - secondPriority;

            const firstTime = getBoardEventTime(first, boardType);
            const secondTime = getBoardEventTime(second, boardType);
            const firstDistance = Math.abs(firstTime - now);
            const secondDistance = Math.abs(secondTime - now);

            if (firstDistance !== secondDistance) return firstDistance - secondDistance;
            return firstTime - secondTime;
        })
        .slice(0, BOARD_MAX_ROWS);
}

function getBoardStatus(row, boardType) {
    const stopIndex = row.stop.indexOfPoint;
    const currentIndex = row.currentIndex;

    if (boardType === "arrivals") {
        if (currentIndex < stopIndex) return "PRIJEDE";
        if (currentIndex === stopIndex) return "VE STANICI";
        return "PRIJEL";
    }

    if (currentIndex === stopIndex) return "VE STANICI";
    if (currentIndex === stopIndex + 1) return "ODJIZDI";
    return "PRIJEDE";
}

function getBoardPlatformLabel(stop) {
    const platform = String(stop?.platform || "").trim();
    const track = String(stop?.track || "").trim();

    if (!platform && !track) {
        return "PROJIZDI";
    }

    return `${platform || "-"}/${track || "-"}`;
}

function getBoardRouteBadgeText(train, boardType) {
    const relevantStops = getRelevantTimetable(train?.timetable || []);
    if (!relevantStops.length) return "-";

    if (boardType === "arrivals") {
        return relevantStops[0]?.nameForPerson || "-";
    }

    return relevantStops[relevantStops.length - 1]?.nameForPerson || "-";
}

function getBoardRotatorStops(train, stop, boardType) {
    const relevantStops = getRelevantTimetable(train?.timetable || []);
    if (!relevantStops.length) return [];

    const stopPoint = stop?.indexOfPoint;
    const candidates = boardType === "arrivals"
        ? relevantStops.filter((entry) => entry.indexOfPoint < stopPoint)
        : relevantStops.filter((entry) => entry.indexOfPoint > stopPoint);

    const uniqueNames = [];
    const seen = new Set();

    candidates.forEach((entry) => {
        const name = String(entry?.nameForPerson || "").trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        uniqueNames.push(name);
    });

    return uniqueNames;
}

function stopBoardDirectionRotator() {
    if (boardDirectionRotatorTimer) {
        clearInterval(boardDirectionRotatorTimer);
        boardDirectionRotatorTimer = null;
    }
}

function startBoardDirectionRotator() {
    stopBoardDirectionRotator();

    const rotators = Array.from(document.querySelectorAll(".js-board-dir-rotator"));
    if (!rotators.length) return;

    boardDirectionRotatorTimer = setInterval(() => {
        rotators.forEach((node) => {
            const rawStops = String(node.dataset.stops || "");
            if (!rawStops) return;

            const stops = rawStops.split("|||").map((entry) => entry.trim()).filter(Boolean);
            if (stops.length <= 1) return;

            const currentIndex = Number(node.dataset.idx || 0);
            const nextIndex = (Number.isFinite(currentIndex) ? currentIndex : 0) + 1;
            const normalizedIndex = nextIndex % stops.length;

            node.dataset.idx = String(normalizedIndex);
            node.textContent = stops[normalizedIndex];
        });
    }, 1800);
}

function getBoardDelayMeta(delayMinutes) {
    const delay = Math.max(0, Number(delayMinutes) || 0);

    if (delay >= 10) {
        return { label: `+${delay}`, cssClass: "retro-delay-severe" };
    }

    if (delay >= 3) {
        return { label: `+${delay}`, cssClass: "retro-delay-medium" };
    }

    if (delay > 0) {
        return { label: `+${delay}`, cssClass: "retro-delay-low" };
    }

    return { label: "+0", cssClass: "retro-delay-none" };
}

function renderSingleBoard(rows, boardType, stationName) {
    const boardTitle = boardType === "arrivals" ? "Příjezdy" : "Odjezdy";
    const boardSubtitle = boardType === "arrivals" ? "Arrivals" : "Departures";
    const boardRows = buildBoardRowsByType(rows, boardType);

    if (!boardRows.length) {
        return `
            <section class="retro-board-panel">
                <div class="retro-board-panel-title">${boardTitle} <span>${boardSubtitle}</span></div>
                <div class="retro-empty">Pro tuto stanici teď nejsou dostupná data tabule.</div>
            </section>
        `;
    }

    return `
        <section class="retro-board-panel retro-board-panel-${boardType}">
            <div class="retro-board retro-board-${boardType}">
                <div class="retro-board-topline">
                    <div class="retro-route-title">${boardTitle} <span>${boardSubtitle}</span></div>
                    <div class="retro-station-name">${escapeHtml(stationName.toUpperCase())}</div>
                    <div class="retro-clock">${new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <div class="retro-board-grid retro-board-grid-head">
                    <div>Cas</div><div>Vlak</div><div>${boardType === "arrivals" ? "Odkud" : "Smer"}</div><div>Peron</div><div>Opozn.</div><div>Status</div>
                </div>
                ${boardRows.map((row) => {
                    const item = row.train;
                    const stop = row.stop;
                    const stopIndex = item.timetable.indexOf(stop);
                    const delay = row.delayMinutes || 0;
                    const delayMeta = getBoardDelayMeta(delay);
                    const classCode = getTrainClassCode(item.trainName);
                    const badgeClass = getTrainClassBadgeClass(classCode);
                    const status = getBoardStatus(row, boardType);
                    const directionName = boardType === "arrivals" ? getCleanName(item.timetable, stopIndex, -1) : getCleanName(item.timetable, stopIndex, 1);
                    const routeBadgeText = getBoardRouteBadgeText(item, boardType);
                    const rotatorStops = getBoardRotatorStops(item, stop, boardType);
                    const rotatorSerialized = rotatorStops.join("|||");
                    const initialRotatorText = rotatorStops[0] || (boardType === "arrivals" ? "Trasa pred stanic" : "Trasa za stanici");
                    const eventTimeRaw = boardType === "arrivals" ? stop?.arrivalTime || stop?.departureTime : stop?.departureTime || stop?.arrivalTime;
                    const eventTime = new Date(eventTimeRaw);
                    const expectedTime = Number.isFinite(eventTime.getTime()) ? new Date(eventTime.getTime() + delay * 60000) : null;
                    const rowClass = [
                        status === "ODJIZDI" ? "retro-row-departing" : "",
                        delayMeta.cssClass
                    ].filter(Boolean).join(" ");
                    const statusClass = status === "VE STANICI"
                        ? "retro-status-station"
                        : status === "ODJIZDI"
                            ? "retro-status-departing"
                            : "retro-status-arriving";

                    return `
                        <div class="retro-board-grid ${rowClass}">
                            <div class="retro-time-cell">
                                <strong>${fmt(eventTimeRaw)}</strong>
                                <span>${expectedTime ? `exp ${fmt(expectedTime)}` : "exp --:--"}</span>
                            </div>
                            <div class="retro-train-cell">
                                <span class="train-class-badge ${badgeClass} retro-route-badge" title="${escapeHtml(routeBadgeText)}">${escapeHtml(routeBadgeText)}</span>
                                <strong>${escapeHtml(classCode)} ${escapeHtml(item.trainNoLocal)}</strong>
                                <span>${escapeHtml(item.trainName)}</span>
                            </div>
                            <div class="retro-dir-cell">
                                <strong class="retro-dir-main">${escapeHtml(directionName || "-")}</strong>
                                <span class="retro-dir-rotator js-board-dir-rotator" data-stops="${escapeHtml(rotatorSerialized)}" data-idx="0">${escapeHtml(initialRotatorText)}</span>
                            </div>
                            <div class="retro-platform-cell">${escapeHtml(getBoardPlatformLabel(stop))}</div>
                            <div class="retro-delay-cell"><b>${delayMeta.label}</b><span>min</span></div>
                            <div class="retro-status-cell"><b class="${statusClass}">${status}</b></div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

function renderDualBoards(stationName, liveData) {
    const rows = collectBoardRows(stationName, liveData);

    if (!rows.length) {
        stopBoardDirectionRotator();
        elements.dualBoardContainer.innerHTML = '<div class="retro-empty">Pro tuto stanici nejsou v EDR dostupná data pro tabuli.</div>';
        return;
    }

    elements.dualBoardContainer.innerHTML = `${renderSingleBoard(rows, "arrivals", stationName)}${renderSingleBoard(rows, "departures", stationName)}`;
    startBoardDirectionRotator();
}

function buildTrainHubItems(liveData) {
    const liveRows = Array.isArray(liveData?.data) ? liveData.data : [];

    const rows = (liveRows.length ? liveRows.map((liveTrain) => {
        const edrTrain = cachedEDR.find((entry) => String(entry.trainNoLocal) === String(liveTrain.TrainNoLocal));
        const relevantStops = getRelevantTimetable(edrTrain?.timetable || []);
        const vehicles = parseVehicles(liveTrain.Vehicles);
        const classCode = getTrainClassCode(liveTrain.TrainName);

        return {
            liveTrain,
            edrTrain,
            trainNoLocal: String(liveTrain.TrainNoLocal),
            trainName: liveTrain.TrainName || edrTrain?.trainName || "Vlak",
            classCode,
            origin: relevantStops[0]?.nameForPerson || liveTrain.StartStation || "Výchozí",
            destination: relevantStops[relevantStops.length - 1]?.nameForPerson || liveTrain.EndStation || "Cíl",
            vehicles,
            vehicleImage: getVehicleImagePath(vehicles) || getClassFallbackImage(classCode)
        };
    }) : cachedEDR.map((edrTrain) => {
        const relevantStops = getRelevantTimetable(edrTrain?.timetable || []);
        const classCode = getTrainClassCode(edrTrain?.trainName);
        const vehicles = parseVehicles("");

        return {
            liveTrain: null,
            edrTrain,
            trainNoLocal: String(edrTrain?.trainNoLocal || ""),
            trainName: edrTrain?.trainName || "Vlak",
            classCode,
            origin: relevantStops[0]?.nameForPerson || "Výchozí",
            destination: relevantStops[relevantStops.length - 1]?.nameForPerson || "Cíl",
            vehicles,
            vehicleImage: getClassFallbackImage(classCode)
        };
    }))
        .filter((item) => item.trainNoLocal);

    return rows.sort((first, second) => {
        const classCompare = first.classCode.localeCompare(second.classCode, "cs");
        if (classCompare !== 0) return classCompare;
        return first.trainNoLocal.localeCompare(second.trainNoLocal, "cs", { numeric: true });
    });
}

function renderTrainGrid(items) {
    if (!items.length) {
        elements.trainsGrid.innerHTML = '<div class="empty-state">Na serveru CZ1 teď není dostupný žádný vlak.</div>';
        return;
    }

    elements.trainsGrid.innerHTML = items
        .map((item) => `
            <button type="button" class="train-card" data-train-no="${escapeHtml(item.trainNoLocal)}">
                <div class="train-card-orb-wrap">
                    <span class="train-card-orb">
                        <img src="${escapeHtml(item.vehicleImage)}" alt="${escapeHtml(item.trainName)}" onerror="this.onerror=null;this.src='grafika/eu07-005.png';">
                    </span>
                </div>
                <div class="train-card-body">
                    <div class="train-card-topline">
                        <span class="train-class-badge ${escapeHtml(getTrainClassBadgeClass(item.classCode))}">${escapeHtml(item.classCode)}</span>
                        <strong>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</strong>
                    </div>
                    <div class="train-card-route">${escapeHtml(item.origin)} <span>→</span> ${escapeHtml(item.destination)}</div>
                    <div class="train-card-meta">${escapeHtml(item.vehicles.leadVehicle || item.classCode)}</div>
                </div>
            </button>
        `)
        .join("");
}

function getTrainContext(trainNoLocal, liveData, positionsData) {
    const edrTrain = cachedEDR.find((entry) => String(entry.trainNoLocal) === String(trainNoLocal));
    const liveTrain = liveData?.data?.find((entry) => String(entry.TrainNoLocal) === String(trainNoLocal));
    const position = positionsData?.data?.find((entry) => entry.id === liveTrain?.id);
    if (!edrTrain || !liveTrain) return null;

    const currentIndex = liveTrain?.TrainData?.VDDelayedTimetableIndex ?? -1;
    const relevantStops = getRelevantTimetable(edrTrain.timetable || []);
    const currentStop = relevantStops.find((entry) => entry.indexOfPoint === currentIndex) || null;
    const previousStop = [...relevantStops].reverse().find((entry) => entry.indexOfPoint < currentIndex) || relevantStops[0] || null;
    const nextStop = relevantStops.find((entry) => entry.indexOfPoint > currentIndex) || relevantStops[relevantStops.length - 1] || null;
    const origin = relevantStops[0] || null;
    const destination = relevantStops[relevantStops.length - 1] || null;
    const delayMinutes = computeTrainDelayMinutes(edrTrain, currentStop || nextStop || origin, currentIndex);
    const vehicles = parseVehicles(liveTrain.Vehicles);
    const classCode = getTrainClassCode(liveTrain.TrainName || edrTrain.trainName);
    const currentSpeed = position ? Math.round(position.Velocity) : 0;
    const isAtStation = Boolean(currentStop) && currentSpeed < 5;

    return {
        edrTrain,
        liveTrain,
        currentIndex,
        relevantStops,
        currentStop,
        previousStop,
        nextStop,
        origin,
        destination,
        delayMinutes,
        vehicles,
        classCode,
        currentSpeed,
        isAtStation
    };
}

function focusActiveTrainTimetableRow() {
    const targetRow = elements.trainTimetableBody?.querySelector('[data-transit-stop="true"]')
        || elements.trainTimetableBody?.querySelector('[data-current-stop="true"]')
        || elements.trainTimetableBody?.querySelector('[data-next-stop="true"]');

    if (!targetRow) return;

    requestAnimationFrame(() => {
        targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    });
}

function renderTrainPanel(trainContext) {
    if (!trainContext) {
        elements.trainTimetableBody.innerHTML = '<div class="empty-panel">Nepodařilo se najít data vlaku na CZ1.</div>';
        return;
    }

    const {
        edrTrain,
        liveTrain,
        currentIndex,
        relevantStops,
        currentStop,
        previousStop,
        nextStop,
        origin,
        destination,
        delayMinutes,
        vehicles,
        classCode,
        isAtStation
    } = trainContext;

    const trainNumberLabel = `${liveTrain.TrainName || edrTrain.trainName} ${liveTrain.TrainNoLocal}`;
    const shouldShowTransitRow = !isAtStation && previousStop && nextStop && previousStop.indexOfPoint !== nextStop.indexOfPoint;

    elements.trainPanelNumber.textContent = trainNumberLabel;
    elements.trainSideNumber.textContent = String(liveTrain.TrainNoLocal);
    elements.trainOrigin.textContent = origin?.nameForPerson || "Výchozí stanice";
    elements.trainDestination.textContent = destination?.nameForPerson || "Cílová stanice";
    elements.trainPreviousStop.textContent = previousStop?.nameForPerson || "-";
    elements.trainNextStop.textContent = nextStop?.nameForPerson || "-";
    elements.trainPanelClass.textContent = classCode;
    elements.trainPanelVehicle.textContent = vehicles.leadVehicle || "-";
    elements.trainPanelDelay.textContent = `+${delayMinutes} min`;

    if (isAtStation && currentStop) {
        elements.trainLiveStation.textContent = currentStop.nameForPerson;
        elements.trainLiveBanner.classList.remove("hidden");
    } else {
        elements.trainLiveBanner.classList.add("hidden");
    }

    elements.trainTimetableBody.innerHTML = relevantStops
        .map((stop) => {
            let status = "Další";
            let rowClass = "train-tt-future";

            if (stop.indexOfPoint < currentIndex) {
                status = "Projelo";
                rowClass = "train-tt-past";
            }

            if (stop.indexOfPoint === currentIndex) {
                status = isAtStation ? "Ve stanici" : "Na trase";
                rowClass = "train-tt-current";
            }

            if (nextStop && stop.indexOfPoint === nextStop.indexOfPoint) {
                status = "Následující";
                rowClass = rowClass === "train-tt-current" ? rowClass : "train-tt-next";
            }

            const isCurrentStop = stop.indexOfPoint === currentIndex;
            const isNextStop = Boolean(nextStop) && stop.indexOfPoint === nextStop.indexOfPoint;
            const isPinnedStop = isAtStation && isCurrentStop;
            const shouldRenderTransitRow = shouldShowTransitRow && isNextStop;
            const indicatorClass = isPinnedStop
                ? "tt-indicator-pin"
                : isNextStop
                    ? "tt-indicator-next"
                    : stop.indexOfPoint < currentIndex
                        ? "tt-indicator-past"
                        : "tt-indicator-idle";
            const transitMarkup = shouldRenderTransitRow
                ? `
                    <div class="train-transit-row" data-transit-stop="true">
                        <div class="train-transit-time">--:--</div>
                        <div class="train-transit-station-cell">
                            <div class="train-transit-arrow-group" aria-hidden="true">
                                <span class="train-transit-arrow"></span>
                                <span class="train-transit-arrow"></span>
                                <span class="train-transit-arrow"></span>
                            </div>
                            <div class="train-transit-copy">
                                <strong>Prave mezi stanicemi</strong>
                                <span>${escapeHtml(previousStop.nameForPerson)} -> ${escapeHtml(nextStop.nameForPerson)}</span>
                            </div>
                        </div>
                        <div>-/-</div>
                        <div>Presun</div>
                    </div>
                `
                : "";

            return `${transitMarkup}
                <div class="train-timetable-row ${rowClass}" data-current-stop="${isCurrentStop}" data-next-stop="${isNextStop}">
                    <div>${fmt(stop.arrivalTime)}<br><span>${fmt(stop.departureTime)}</span></div>
                    <div class="train-station-cell"><span class="tt-indicator ${indicatorClass}" aria-hidden="true"></span><strong>${escapeHtml(stop.nameForPerson)}</strong></div>
                    <div>${escapeHtml(stop.platform || "-")}/${escapeHtml(stop.track || "-")}</div>
                    <div>${status}</div>
                </div>
            `;
        })
        .join("");

    if (trainPanelNeedsFocus) {
        focusActiveTrainTimetableRow();
        trainPanelNeedsFocus = false;
    }
}

function updateKpis(rows) {
    const activeCount = rows.length;

    const stationCount = rows.filter((row) => row.currentIndex === row.stop.indexOfPoint).length;

    const maxDelay = rows.reduce((maximum, row) => Math.max(maximum, row.delayMinutes || 0), 0);

    elements.kpiActive.textContent = String(activeCount);
    elements.kpiStation.textContent = String(stationCount);
    elements.kpiDelay.textContent = `+${maxDelay} min`;
}

function renderTable(liveData, posData) {
    if (!currentStation || !cachedEDR.length) return;

    const rows = collectStationRows(liveData);
    const visibleRows = applyRowsUiState(rows);

    lastStationRows = rows;
    lastRenderedTrains = rows.map((row) => row.train);
    lastLiveData = liveData;
    lastPositionsData = posData;

    if (!rows.length) {
        elements.departuresBody.innerHTML = '<div class="empty-panel">Pro tuto stanici nejsou v EDR dostupné žádné spoje.</div>';
        updateKpis([]);
        return;
    }

    if (!visibleRows.length) {
        elements.departuresBody.innerHTML = '<div class="empty-panel">Žádný spoj neodpovídá zvolenému filtru.</div>';
        updateKpis(rows);
        return;
    }

    elements.departuresBody.innerHTML = visibleRows.map((row) => {
        const item = row.train;
        const stop = row.stop;
        const live = row.live;
        const position = posData?.data?.find((entry) => entry.id === live?.Id);
        const speed = position ? Math.round(position.Velocity) : 0;
        const delay = row.delayMinutes || 0;
        const vehicles = parseVehicles(live?.Vehicles);
        const vehicleImagePath = getVehicleImagePath(vehicles);
        const classCode = getTrainClassCode(item.trainName);
        const resolvedVehicleImagePath = vehicleImagePath || getClassFallbackImage(classCode);
        const vehicleCodeLabel = getVehicleCodeLabel(vehicles);
        const currentIndex = row.currentIndex;
        const stopIndex = item.timetable.indexOf(stop);
        const originStation = getCleanName(item.timetable, stopIndex, -1);
        const nextStation = getCleanName(item.timetable, stopIndex, 1);
        const classBadgeClass = getTrainClassBadgeClass(classCode);
        const controlInfo = getTrainControlInfo(live);
        let status = "PŘIJEDE";
        let rowClass = "";
        let statusClass = "status-arriving";

        if (currentIndex === stop.indexOfPoint) {
            status = speed < 5 ? "VE STANICI" : "PROJÍŽDÍ";
            rowClass = "row-at-station";
            statusClass = "status-on-station";
        } else if (currentIndex === stop.indexOfPoint + 1) {
            status = "ODJÍŽDÍ";
            rowClass = "row-departing";
            statusClass = "status-departing";
        }

        const isExpanded = expandedTrains.has(String(item.trainNoLocal));

        return `
            <div class="train-row ${rowClass}" data-train-id="${escapeHtml(item.trainNoLocal)}">
                <div class="cell" data-label="Čas">${fmt(stop.arrivalTime)}<br><span class="cell-accent">${fmt(stop.departureTime)}</span></div>
                <div class="cell train-cell" data-label="Vlak">
                    <span class="train-class-badge ${classBadgeClass}">${escapeHtml(classCode)}</span>
                    <b>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</b>
                    ${vehicles.leadVehicle ? `<span class="vehicle-inline">Lok/Jednotka: ${escapeHtml(vehicles.leadVehicle)}</span>` : ""}
                </div>
                <div class="cell vehicle-cell" data-label="Vozidlo">
                    <span class="vehicle-orb has-image">
                        <img src="${escapeHtml(resolvedVehicleImagePath)}" alt="${escapeHtml(vehicleCodeLabel)}" onerror="this.onerror=null;this.src='grafika/eu07-005.png';">
                    </span>
                    <span class="vehicle-caption">${escapeHtml(classCode)} ${escapeHtml(String(item.trainNoLocal || ""))}</span>
                </div>
                <div class="cell" data-label="Odkud">${escapeHtml(originStation)}</div>
                <div class="cell" data-label="Kam pojede"><b>${escapeHtml(nextStation || "-")}</b></div>
                <div class="cell" data-label="Nást./Kol.">${escapeHtml(stop.platform || "-")}/${escapeHtml(stop.track || "-")}</div>
                <div class="cell ${delay > 0 ? "delay-high" : "delay-ok"}" data-label="Zpoždění">+${delay} min</div>
                <div class="cell control-cell" data-label="Řízení"><b class="${controlInfo.cssClass}" title="${escapeHtml(controlInfo.detailLabel)}">${escapeHtml(controlInfo.shortLabel)}</b></div>
                <div class="cell status-cell ${statusClass}" data-label="Stav"><b>${status}</b></div>
            </div>
            <div id="det-${escapeHtml(item.trainNoLocal)}" class="train-detail ${isExpanded ? "" : "hidden"}">
                <div class="detail-topbar">
                    <div class="speed-badge">GPS rychlost: <b>${speed} km/h</b></div>
                    <div class="speed-badge">Souprava: <b>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</b></div>
                    <div class="speed-badge">${escapeHtml(controlInfo.detailLabel)}</div>
                    ${vehicles.leadVehicle ? `<div class="speed-badge vehicle-badge">Lok/Jednotka: <b>${escapeHtml(vehicles.leadVehicle)}</b></div>` : ""}
                </div>
                ${vehicles.consist ? `<div class="consist-line"><span>Sestava:</span> ${escapeHtml(vehicles.consist)}</div>` : ""}
                <div class="tt-grid tt-grid-head"><div>Příj.</div><div>Odj.</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map((entry) => `
                    <div class="tt-grid ${entry.indexOfPoint === currentIndex ? "current-pos" : ""}">
                        <div>${fmt(entry.arrivalTime)}</div>
                        <div>${fmt(entry.departureTime)}</div>
                        <div>${escapeHtml(entry.nameForPerson)} ${entry.indexOfPoint === currentIndex ? "●" : ""}</div>
                        <div>${escapeHtml(entry.platform || "")}</div>
                    </div>
                `).join("")}
            </div>
        `;
    }).join("");

    updateKpis(rows);

    if (isFirstLoad) {
        const activeRow = elements.departuresBody.querySelector(".row-at-station") || elements.departuresBody.querySelector(".row-departing") || elements.departuresBody.querySelector(".train-row:not(.row-departed)");
        if (activeRow) activeRow.scrollIntoView({ behavior: "smooth", block: "center" });
        isFirstLoad = false;
    }
}

function toggleTrain(id) {
    const detail = document.getElementById(`det-${id}`);
    if (!detail) return;
    if (expandedTrains.has(String(id))) {
        expandedTrains.delete(String(id));
        detail.classList.add("hidden");
    } else {
        expandedTrains.add(String(id));
        detail.classList.remove("hidden");
    }
}

function goHome() {
    currentStation = null;
    currentTrainNo = null;
    currentBoardStation = null;
    currentView = "station-hub";
    activeRequestId += 1;
    isFirstLoad = true;
    expandedTrains.clear();
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.landingScreen.classList.add("hidden");
    elements.stationHub.classList.remove("hidden");
    elements.trainHub.classList.add("hidden");
    elements.boardHub.classList.add("hidden");
    elements.departuresBody.innerHTML = "";
}

function openStationHub() {
    currentBoardStation = null;
    currentView = "station-hub";
    elements.landingScreen.classList.add("hidden");
    elements.trainHub.classList.add("hidden");
    elements.boardHub.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.stationHub.classList.remove("hidden");
    elements.stationSearch.focus();
}

async function openTrainHub() {
    currentView = "train-hub";
    currentStation = null;
    currentTrainNo = null;
    currentBoardStation = null;
    uiState.trainHubQuery = "";
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.landingScreen.classList.add("hidden");
    elements.stationHub.classList.add("hidden");
    elements.boardHub.classList.add("hidden");
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.trainHub.classList.remove("hidden");
    elements.trainHubSearch.value = "";
    elements.trainHubSearch.focus();

    showLoading();
    const liveData = await fetchData(API_TRAINS);
    hideLoading();

    lastTrainHubItems = buildTrainHubItems(liveData);
    renderTrainGrid(lastTrainHubItems);
}

function openBoardHub() {
    currentView = "board-hub";
    currentStation = null;
    currentTrainNo = null;
    currentBoardStation = null;
    uiState.boardHubQuery = "";
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.landingScreen.classList.add("hidden");
    elements.stationHub.classList.add("hidden");
    elements.trainHub.classList.add("hidden");
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.boardHub.classList.remove("hidden");
    elements.boardStationSearch.value = "";
    renderBoardStationGrid(allStations);
    elements.boardStationSearch.focus();
}

function backToLanding() {
    currentView = "landing";
    currentTrainNo = null;
    currentStation = null;
    currentBoardStation = null;
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.stationHub.classList.add("hidden");
    elements.trainHub.classList.add("hidden");
    elements.boardHub.classList.add("hidden");
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.landingScreen.classList.remove("hidden");
    elements.stationSearch.value = "";
    elements.trainHubSearch.value = "";
    elements.boardStationSearch.value = "";
    renderStationGrid(allStations);
    renderBoardStationGrid(allStations);
}

function backToTrainHub() {
    currentTrainNo = null;
    currentView = "train-hub";
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.trainHub.classList.remove("hidden");
}

function backToBoardHub() {
    currentBoardStation = null;
    currentView = "board-hub";
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.boardContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.boardHub.classList.remove("hidden");
}

async function updateLoop() {
    if (!currentStation) return;
    clearTimeout(refreshTimer);
    const requestId = ++activeRequestId;
    showLoading();
    const [liveData, positionsData] = await Promise.all([fetchData(API_TRAINS), fetchData(API_POSITIONS)]);
    hideLoading();

    if (requestId !== activeRequestId || !currentStation) return;

    if (!liveData || !positionsData) {
        elements.departuresBody.innerHTML = `<div class="empty-panel error-panel">Nepodařilo se načíst live data. Zkontroluj připojení nebo API.${getApiHint()}</div>`;
        refreshTimer = setTimeout(updateLoop, 15000);
        return;
    }

    renderTable(liveData, positionsData);
    resolveSteamNamesForRows(lastStationRows).catch(() => null);
    refreshTimer = setTimeout(updateLoop, 15000);
}

async function updateTrainLoop() {
    if (!currentTrainNo) return;
    clearTimeout(refreshTimer);
    const requestId = ++activeRequestId;
    showLoading();
    const [liveData, positionsData] = await Promise.all([fetchData(API_TRAINS), fetchData(API_POSITIONS)]);
    hideLoading();

    if (requestId !== activeRequestId || !currentTrainNo) return;

    if (!liveData || !positionsData) {
        elements.trainTimetableBody.innerHTML = `<div class="empty-panel error-panel">Nepodařilo se načíst data vlaku.${getApiHint()}</div>`;
        refreshTimer = setTimeout(updateTrainLoop, 15000);
        return;
    }

    const trainContext = getTrainContext(currentTrainNo, liveData, positionsData);
    renderTrainPanel(trainContext);
    refreshTimer = setTimeout(updateTrainLoop, 15000);
}

async function updateBoardLoop() {
    if (!currentBoardStation) return;
    clearTimeout(refreshTimer);
    const requestId = ++activeRequestId;
    showLoading();
    const liveData = await fetchData(API_TRAINS);
    hideLoading();

    if (requestId !== activeRequestId || !currentBoardStation) return;

    if (!liveData) {
        elements.dualBoardContainer.innerHTML = `<div class="empty-panel error-panel">Nepodařilo se načíst live data pro tabule.${getApiHint()}</div>`;
        refreshTimer = setTimeout(updateBoardLoop, 15000);
        return;
    }

    renderDualBoards(currentBoardStation, liveData);
    refreshTimer = setTimeout(updateBoardLoop, 15000);
}

async function openBoard(stationName) {
    currentStation = stationName;
    currentTrainNo = null;
    currentView = "station-view";
    stopBoardDirectionRotator();
    isFirstLoad = true;
    resetTableControls();
    elements.stationName.textContent = stationName.toUpperCase();
    elements.homeScreen.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.mainContent.classList.remove("hidden");
    await updateLoop();
}

async function openDualBoards(stationName) {
    currentBoardStation = stationName;
    currentStation = null;
    currentTrainNo = null;
    currentView = "board-view";
    activeRequestId += 1;
    clearTimeout(refreshTimer);
    elements.boardPageStation.textContent = stationName.toUpperCase();
    elements.homeScreen.classList.add("hidden");
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.add("hidden");
    elements.boardContent.classList.remove("hidden");
    await updateBoardLoop();
}

async function openTrainPanel(trainNoLocal) {
    currentTrainNo = String(trainNoLocal);
    currentStation = null;
    currentView = "train-view";
    activeRequestId += 1;
    trainPanelNeedsFocus = true;
    stopBoardDirectionRotator();
    clearTimeout(refreshTimer);
    elements.homeScreen.classList.add("hidden");
    elements.mainContent.classList.add("hidden");
    elements.trainContent.classList.remove("hidden");
    await updateTrainLoop();
}

function bindEvents() {
    elements.enterStationsBtn.addEventListener("click", openStationHub);
    elements.enterTrainsBtn.addEventListener("click", openTrainHub);
    elements.enterBoardsBtn.addEventListener("click", openBoardHub);
    elements.hubBackBtn.addEventListener("click", backToLanding);
    elements.trainHubBackBtn.addEventListener("click", backToLanding);
    elements.boardHubBackBtn.addEventListener("click", backToLanding);

    elements.filterChips.forEach((chip) => {
        chip.addEventListener("click", () => {
            uiState.stationFilter = chip.dataset.filter || "all";
            setActiveFilterChip(uiState.stationFilter);
            rerenderCurrentStation();
        });
    });

    elements.trainSearch.addEventListener("input", (event) => {
        uiState.trainQuery = event.target.value || "";
        rerenderCurrentStation();
    });

    elements.sortMode.addEventListener("change", (event) => {
        uiState.sortMode = event.target.value || "time";
        rerenderCurrentStation();
    });

    elements.stationSearch.addEventListener("input", (event) => {
        const value = norm(event.target.value);
        const filtered = allStations.filter((station) => norm(station.Name).includes(value));
        renderStationGrid(filtered);
    });

    elements.trainHubSearch.addEventListener("input", (event) => {
        uiState.trainHubQuery = event.target.value || "";
        const query = norm(uiState.trainHubQuery);
        const filtered = lastTrainHubItems.filter((item) => norm(`${item.trainName} ${item.trainNoLocal} ${item.origin} ${item.destination}`).includes(query));
        renderTrainGrid(filtered);
    });

    elements.boardStationSearch.addEventListener("input", (event) => {
        uiState.boardHubQuery = event.target.value || "";
        const query = norm(uiState.boardHubQuery);
        const filtered = allStations.filter((station) => norm(station.Name).includes(query));
        renderBoardStationGrid(filtered);
    });

    elements.stationsGrid.addEventListener("click", (event) => {
        const stationButton = event.target.closest("[data-station]");
        if (stationButton) openBoard(stationButton.dataset.station);
    });

    elements.trainsGrid.addEventListener("click", (event) => {
        const trainButton = event.target.closest("[data-train-no]");
        if (trainButton) openTrainPanel(trainButton.dataset.trainNo);
    });

    elements.boardStationsGrid.addEventListener("click", (event) => {
        const stationButton = event.target.closest("[data-board-station]");
        if (stationButton) openDualBoards(stationButton.dataset.boardStation);
    });

    elements.departuresBody.addEventListener("click", (event) => {
        const row = event.target.closest(".train-row[data-train-id]");
        if (row) toggleTrain(row.dataset.trainId);
    });

    elements.backBtn.addEventListener("click", goHome);
    elements.trainBackBtn.addEventListener("click", backToTrainHub);
    elements.boardViewBackBtn.addEventListener("click", backToBoardHub);
}

async function init() {
    setClock();
    setInterval(setClock, 1000);
    bindEvents();

    showLoading();
    const [stationsData, edrData] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    hideLoading();

    if (!stationsData?.data || !edrData) {
        renderStationGrid([]);
        elements.stationsGrid.innerHTML = `<div class="empty-state">Nepodařilo se načíst výchozí data z API.${getApiHint()}</div>`;
        return;
    }

    allStations = stationsData.data.slice().sort((first, second) => first.Name.localeCompare(second.Name, "cs"));
    cachedEDR = Array.isArray(edrData) ? edrData : [];
    renderStationGrid(allStations);
    renderBoardStationGrid(allStations);
}

init();
