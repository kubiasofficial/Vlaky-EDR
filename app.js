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

const elements = {
    homeScreen: document.getElementById("home-screen"),
    landingScreen: document.getElementById("landing-screen"),
    stationHub: document.getElementById("station-hub"),
    enterStationsBtn: document.getElementById("enter-stations-btn"),
    hubBackBtn: document.getElementById("hub-back-btn"),
    mainContent: document.getElementById("main-content"),
    stationsGrid: document.getElementById("stations-grid"),
    stationSearch: document.getElementById("station-search"),
    stationName: document.getElementById("st-name"),
    departuresBody: document.getElementById("departures-body"),
    backBtn: document.getElementById("back-btn"),
    viewToggle: document.getElementById("view-toggle"),
    clock: document.getElementById("clock"),
    boardModal: document.getElementById("board-modal"),
    closeBoard: document.getElementById("close-board"),
    boardContainer: document.getElementById("modal-board-container"),
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

const uiState = {
    stationFilter: "all",
    trainQuery: "",
    sortMode: "time"
};

const RETRO_MAX_ROWS = 8;
const RETRO_PAST_WINDOW_MIN = 8;
const RETRO_FUTURE_WINDOW_MIN = 120;

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

function getCleanName(timetable, index, direction) {
    let currentIndex = index + direction;
    while (currentIndex >= 0 && currentIndex < timetable.length) {
        const stopName = timetable[currentIndex].nameForPerson;
        if (!["PZS", "R145", "R154", "Glowice"].some((ignored) => stopName.includes(ignored))) {
            return stopName;
        }
        currentIndex += direction;
    }
    return direction === -1 ? "Výchozí" : "Cíl";
}

function setClock() {
    if (elements.clock) {
        elements.clock.textContent = new Date().toLocaleTimeString("cs-CZ");
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

    if (compact.includes("36WED")) return "grafika/36wed-001.png";
    if (compact.includes("E6ACTA") || compact.includes("DRAGON2")) return "grafika/e6acta-016.png";
    if (compact.includes("ET22")) return "grafika/et22-836.png";
    if (compact.includes("EU07") || compact.includes("EP07") || compact.includes("4E")) return "grafika/eu07-005.png";
    if (compact.includes("EP08")) return "grafika/ep08-001.png";
    if (compact.includes("163")) return "grafika/163_021-9.png";
    if (compact.includes("E186")) return "grafika/e186-134.png";
    if (compact.includes("ED250")) return "grafika/ed250-018.png";
    if (compact.includes("EN76") || compact.includes("EN96") || compact.includes("ELF")) return "grafika/en76-006.png";
    if (compact.includes("EN57") || compact.includes("EN71")) return "grafika/en57-1000.png";

    return "";
}

function getVehicleCodeLabel(vehicles) {
    const raw = String(vehicles?.leadVehicle || "").trim();
    if (!raw) return "?";
    const normalized = raw.toUpperCase();
    if (normalized.includes("ED250")) return "ED250";
    if (normalized.includes("36WED")) return "36WED";
    const token = normalized.split(/[-\s]/)[0];
    return token || "?";
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
    }

    return 0;
}

function isRetroCandidate(row) {
    if (row.live) {
        return row.currentIndex >= row.stop.indexOfPoint - 1 && row.currentIndex <= row.stop.indexOfPoint + 1;
    }
    const now = Date.now();
    const plan = getStopPlanDate(row.stop).getTime();
    return plan >= now - RETRO_PAST_WINDOW_MIN * 60 * 1000 && plan <= now + RETRO_FUTURE_WINDOW_MIN * 60 * 1000;
}

function collectStationRows(liveData) {
    const target = norm(currentStation);
    if (!target) return [];

    return cachedEDR
        .map((train) => {
            const stop = train.timetable.find((entry) => norm(entry.nameForPerson).includes(target));
            if (!stop) return null;

            const live = liveData?.data?.find((entry) => entry.TrainNoLocal === train.trainNoLocal);
            const currentIndex = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
            const plannedTime = getStopPlanDate(stop).getTime();

            return { train, stop, live, currentIndex, plannedTime };
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
            return `
                <button type="button" class="st-card" data-station="${escapeHtml(station.Name)}">
                    <span class="st-card-media" aria-hidden="true">${escapeHtml(initials || "ST")}</span>
                    <span class="st-card-title">${escapeHtml(station.Name)}</span>
                </button>
            `;
        })
        .join("");
}

function updateKpis(rows) {
    const activeCount = rows.length;

    const stationCount = rows.filter((row) => row.currentIndex === row.stop.indexOfPoint).length;

    const maxDelay = rows.reduce((maximum, row) => Math.max(maximum, row.live?.TrainData?.Delay || 0), 0);

    elements.kpiActive.textContent = String(activeCount);
    elements.kpiStation.textContent = String(stationCount);
    elements.kpiDelay.textContent = `+${maxDelay} min`;
}

function renderRetroBoard() {
    const retroRows = lastStationRows.filter(isRetroCandidate).slice(0, RETRO_MAX_ROWS);

    if (!currentStation || !retroRows.length) {
        elements.boardContainer.innerHTML = '<div class="retro-empty">Retro tabule je dostupná po otevření stanice s daty.</div>';
        return;
    }

    elements.boardContainer.innerHTML = `
        <div class="retro-board">
            <div class="retro-board-topline">
                <div class="retro-route-title">Odjezdy <span>Departures</span></div>
                <div class="retro-station-name">${escapeHtml(currentStation.toUpperCase())}</div>
                <div class="retro-clock">${new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <div class="retro-board-grid retro-board-grid-head">
                <div>Čas</div><div>Vlak</div><div>Směr</div><div>Nástupiště</div><div>Zpoždění</div><div>Stav</div>
            </div>
            ${retroRows.map((row) => {
                const item = row.train;
                const stop = row.stop;
                const live = row.live;
                const currentIndex = row.currentIndex;
                const delay = row.delayMinutes || 0;
                const stopIndex = item.timetable.indexOf(stop);
                const origin = getCleanName(item.timetable, stopIndex, -1);
                const nextStation = getCleanName(item.timetable, stopIndex, 1);
                let status = "PŘIJEDE";
                let retroRowClass = "";
                if (currentIndex === stop?.indexOfPoint) status = "VE STANICI";
                else if (currentIndex === (stop?.indexOfPoint ?? -1) + 1) {
                    status = "ODJÍŽDÍ";
                    retroRowClass = "retro-row-departing";
                }
                return `
                    <div class="retro-board-grid ${retroRowClass}">
                        <div class="retro-time-cell">${fmt(stop?.departureTime || stop?.arrivalTime)}</div>
                        <div class="retro-train-cell">
                            <strong>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</strong>
                            <span>${escapeHtml(origin)}</span>
                        </div>
                        <div class="retro-dir-cell">${escapeHtml(nextStation || "-")}</div>
                        <div class="retro-platform-cell">${escapeHtml(stop?.platform || "-")}/${escapeHtml(stop?.track || "-")}</div>
                        <div class="retro-delay-cell">+${delay}</div>
                        <div class="retro-status-cell">${status}</div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
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
        const vehicleCodeLabel = getVehicleCodeLabel(vehicles);
        const currentIndex = row.currentIndex;
        const stopIndex = item.timetable.indexOf(stop);
        const originStation = getCleanName(item.timetable, stopIndex, -1);
        const nextStation = getCleanName(item.timetable, stopIndex, 1);
        const classCode = getTrainClassCode(item.trainName);
        const classBadgeClass = getTrainClassBadgeClass(classCode);
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
                    <span class="vehicle-orb ${vehicleImagePath ? "has-image" : "no-image"}">
                        ${vehicleImagePath
                            ? `<img src="${escapeHtml(vehicleImagePath)}" alt="${escapeHtml(vehicleCodeLabel)}">`
                            : `<span>${escapeHtml(vehicleCodeLabel)}</span>`}
                    </span>
                    <span class="vehicle-caption">${escapeHtml(classCode)} ${escapeHtml(String(item.trainNoLocal || ""))}</span>
                </div>
                <div class="cell" data-label="Odkud">${escapeHtml(originStation)}</div>
                <div class="cell" data-label="Kam pojede"><b>${escapeHtml(nextStation || "-")}</b></div>
                <div class="cell" data-label="Nást./Kol.">${escapeHtml(stop.platform || "-")}/${escapeHtml(stop.track || "-")}</div>
                <div class="cell ${delay > 0 ? "delay-high" : "delay-ok"}" data-label="Zpoždění">+${delay} min</div>
                <div class="cell status-cell ${statusClass}" data-label="Stav"><b>${status}</b></div>
            </div>
            <div id="det-${escapeHtml(item.trainNoLocal)}" class="train-detail ${isExpanded ? "" : "hidden"}">
                <div class="detail-topbar">
                    <div class="speed-badge">GPS rychlost: <b>${speed} km/h</b></div>
                    <div class="speed-badge">Souprava: <b>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</b></div>
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

    if (!elements.boardModal.classList.contains("hidden")) {
        renderRetroBoard();
    }

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
    activeRequestId += 1;
    isFirstLoad = true;
    expandedTrains.clear();
    clearTimeout(refreshTimer);
    elements.mainContent.classList.add("hidden");
    elements.homeScreen.classList.remove("hidden");
    elements.landingScreen.classList.add("hidden");
    elements.stationHub.classList.remove("hidden");
    elements.departuresBody.innerHTML = "";
    elements.boardModal.classList.add("hidden");
}

function openStationHub() {
    elements.landingScreen.classList.add("hidden");
    elements.stationHub.classList.remove("hidden");
    elements.stationSearch.focus();
}

function backToLanding() {
    elements.stationHub.classList.add("hidden");
    elements.landingScreen.classList.remove("hidden");
    elements.stationSearch.value = "";
    renderStationGrid(allStations);
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
    refreshTimer = setTimeout(updateLoop, 15000);
}

async function openBoard(stationName) {
    currentStation = stationName;
    isFirstLoad = true;
    resetTableControls();
    elements.stationName.textContent = stationName.toUpperCase();
    elements.homeScreen.classList.add("hidden");
    elements.mainContent.classList.remove("hidden");
    await updateLoop();
}

function bindEvents() {
    elements.enterStationsBtn.addEventListener("click", openStationHub);
    elements.hubBackBtn.addEventListener("click", backToLanding);

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

    elements.stationsGrid.addEventListener("click", (event) => {
        const stationButton = event.target.closest("[data-station]");
        if (stationButton) openBoard(stationButton.dataset.station);
    });

    elements.departuresBody.addEventListener("click", (event) => {
        const row = event.target.closest(".train-row[data-train-id]");
        if (row) toggleTrain(row.dataset.trainId);
    });

    elements.backBtn.addEventListener("click", goHome);
    elements.viewToggle.addEventListener("click", () => {
        renderRetroBoard();
        elements.boardModal.classList.remove("hidden");
    });
    elements.closeBoard.addEventListener("click", () => elements.boardModal.classList.add("hidden"));
    elements.boardModal.addEventListener("click", (event) => {
        if (event.target === elements.boardModal) elements.boardModal.classList.add("hidden");
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") elements.boardModal.classList.add("hidden");
    });
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
}

init();
