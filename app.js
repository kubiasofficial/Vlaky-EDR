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
    kpiDelay: document.getElementById("kpi-delay")
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

const PASSENGER_TRAIN_TAGS = ["EIP", "EIC", "EC", "EN", "IC", "TLK", "IR", "R", "RE", "RJ", "OS", "SKM", "KM", "KD", "KS", "PR"];

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

function getApiHint() {
    if (!IS_LOCALHOST) return "";
    return ' Na localhostu spusť také proxy přes příkaz: node proxy.js';
}

function hasPlatformStop(stop) {
    const platform = String(stop?.platform ?? "").trim();
    return platform && platform !== "-" && platform !== "0";
}

function isPassengerTrain(train) {
    const trainName = String(train?.trainName ?? "").toUpperCase();
    const prefix = trainName.split(/\s+/)[0] || "";
    return PASSENGER_TRAIN_TAGS.includes(prefix);
}

function collectStationRows(liveData) {
    const target = norm(currentStation);
    if (!target) return [];

    return cachedEDR
        .map((train) => {
            const stop = train.timetable.find((entry) => norm(entry.nameForPerson).includes(target));
            if (!stop) return null;
            if (!isPassengerTrain(train) || !hasPlatformStop(stop)) return null;

            const live = liveData?.data?.find((entry) => entry.TrainNoLocal === train.trainNoLocal);
            if (!live) return null;

            const currentIndex = live.TrainData?.VDDelayedTimetableIndex ?? -1;

            // Keep only trains that are approaching, at station, or just departing.
            if (currentIndex > stop.indexOfPoint + 1) return null;

            return { train, stop, live, currentIndex };
        })
        .filter(Boolean)
        .sort((first, second) => {
            const firstDate = new Date(first.stop?.departureTime || first.stop?.arrivalTime || 0);
            const secondDate = new Date(second.stop?.departureTime || second.stop?.arrivalTime || 0);
            return firstDate - secondDate;
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
    if (!currentStation || !lastStationRows.length) {
        elements.boardContainer.innerHTML = '<div class="retro-empty">Retro tabule je dostupná po otevření stanice s daty.</div>';
        return;
    }

    elements.boardContainer.innerHTML = `
        <div class="retro-board">
            <div class="retro-board-head">
                <span>SIMRAIL CZ1</span>
                <span>${escapeHtml(currentStation.toUpperCase())}</span>
                <span>${new Date().toLocaleTimeString("cs-CZ")}</span>
            </div>
            <div class="retro-board-grid retro-board-grid-head">
                <div>Čas</div><div>Spoj</div><div>Směr</div><div>Nást.</div><div>Zpoždění</div><div>Stav</div>
            </div>
            ${lastStationRows.slice(0, 8).map((row) => {
                const item = row.train;
                const stop = row.stop;
                const live = row.live;
                const currentIndex = row.currentIndex;
                const delay = live?.TrainData?.Delay || 0;
                let status = "PŘIJEDE";
                let retroRowClass = "";
                if (currentIndex === stop?.indexOfPoint) status = "VE STANICI";
                else if (currentIndex === (stop?.indexOfPoint ?? -1) + 1) {
                    status = "ODJÍŽDÍ";
                    retroRowClass = "retro-row-departing";
                }
                return `
                    <div class="retro-board-grid ${retroRowClass}">
                        <div>${fmt(stop?.departureTime || stop?.arrivalTime)}</div>
                        <div>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</div>
                        <div>${escapeHtml(item.endStation || "-")}</div>
                        <div>${escapeHtml(stop?.platform || "-")}/${escapeHtml(stop?.track || "-")}</div>
                        <div>+${delay}</div>
                        <div>${status}</div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderTable(liveData, posData) {
    if (!currentStation || !cachedEDR.length) return;

    const rows = collectStationRows(liveData);

    lastStationRows = rows;
    lastRenderedTrains = rows.map((row) => row.train);
    lastLiveData = liveData;

    if (!rows.length) {
        elements.departuresBody.innerHTML = '<div class="empty-panel">Pro tuto stanici nejsou dostupné žádné živé osobní spoje u nástupiště.</div>';
        updateKpis([]);
        return;
    }

    elements.departuresBody.innerHTML = rows.map((row) => {
        const item = row.train;
        const stop = row.stop;
        const live = row.live;
        const position = posData?.data?.find((entry) => entry.id === live?.Id);
        const speed = position ? Math.round(position.Velocity) : 0;
        const delay = live?.TrainData?.Delay || 0;
        const currentIndex = row.currentIndex;
        let status = "PŘIJEDE";
        let rowClass = "";

        if (currentIndex === stop.indexOfPoint) {
            status = speed < 5 ? "VE STANICI" : "PROJÍŽDÍ";
            rowClass = "row-at-station";
        } else if (currentIndex === stop.indexOfPoint + 1) {
            status = "ODJÍŽDÍ";
            rowClass = "row-departing";
        }

        const isExpanded = expandedTrains.has(String(item.trainNoLocal));

        return `
            <div class="train-row ${rowClass}" data-train-id="${escapeHtml(item.trainNoLocal)}">
                <div class="cell" data-label="Čas">${fmt(stop.arrivalTime)}<br><span class="cell-accent">${fmt(stop.departureTime)}</span></div>
                <div class="cell" data-label="Spoj"><b>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</b></div>
                <div class="cell" data-label="Odkud">${escapeHtml(getCleanName(item.timetable, item.timetable.indexOf(stop), -1))}</div>
                <div class="cell" data-label="Cílová stanice"><b>${escapeHtml(item.endStation || "-")}</b></div>
                <div class="cell" data-label="Nást./Kol.">${escapeHtml(stop.platform || "-")}/${escapeHtml(stop.track || "-")}</div>
                <div class="cell ${delay > 0 ? "delay-high" : "delay-ok"}" data-label="Zpoždění">+${delay} min</div>
                <div class="cell status-cell" data-label="Stav"><b>${status}</b></div>
            </div>
            <div id="det-${escapeHtml(item.trainNoLocal)}" class="train-detail ${isExpanded ? "" : "hidden"}">
                <div class="detail-topbar">
                    <div class="speed-badge">GPS rychlost: <b>${speed} km/h</b></div>
                    <div class="speed-badge">Souprava: <b>${escapeHtml(item.trainName)} ${escapeHtml(item.trainNoLocal)}</b></div>
                </div>
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
    elements.departuresBody.innerHTML = "";
    elements.boardModal.classList.add("hidden");
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
    elements.stationName.textContent = stationName.toUpperCase();
    elements.homeScreen.classList.add("hidden");
    elements.mainContent.classList.remove("hidden");
    await updateLoop();
}

function bindEvents() {
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
