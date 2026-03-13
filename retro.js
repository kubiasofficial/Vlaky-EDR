const SERVER = "cz1";
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_SIMRAIL_BASE = IS_LOCALHOST ? "http://localhost:8080/https://panel.simrail.eu:8084" : "/api-simrail";
const API_AWS_BASE = IS_LOCALHOST ? "http://localhost:8080/https://api1.aws.simrail.eu:8082/api" : "/api-aws";
const API_TRAINS = `${API_SIMRAIL_BASE}/trains-open?serverCode=${SERVER}`;
const API_EDR = `${API_AWS_BASE}/getEDRTimetables?serverCode=${SERVER}`;

const RETRO_MAX_ROWS = 8;
const RETRO_PAST_WINDOW_MIN = 8;
const RETRO_FUTURE_WINDOW_MIN = 120;

const params = new URLSearchParams(window.location.search);
const stationName = (params.get("station") || "").trim();

const elements = {
    boardContainer: document.getElementById("retro-page-board-container"),
    stationTitle: document.getElementById("retro-page-station"),
    clock: document.getElementById("retro-page-clock"),
    backBtn: document.getElementById("retro-back-btn")
};

let cachedEDR = [];
let refreshTimer = null;

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

function isRetroCandidate(row) {
    if (row.live) {
        return row.currentIndex >= row.stop.indexOfPoint - 1 && row.currentIndex <= row.stop.indexOfPoint + 1;
    }

    const now = Date.now();
    const plan = getStopPlanDate(row.stop).getTime();
    return plan >= now - RETRO_PAST_WINDOW_MIN * 60 * 1000 && plan <= now + RETRO_FUTURE_WINDOW_MIN * 60 * 1000;
}

function getCleanName(timetable, index, direction) {
    let currentIndex = index + direction;
    while (currentIndex >= 0 && currentIndex < timetable.length) {
        const stopName = timetable[currentIndex].nameForPerson;
        if (stopName) return stopName;
        currentIndex += direction;
    }
    return direction === -1 ? "Vychozi" : "Cil";
}

function collectStationRows(liveData) {
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
        .filter(Boolean)
        .sort((first, second) => {
            const now = Date.now();
            const firstIsPast = first.plannedTime < now;
            const secondIsPast = second.plannedTime < now;
            if (firstIsPast !== secondIsPast) return firstIsPast ? 1 : -1;
            return first.plannedTime - second.plannedTime;
        });
}

function renderRetroBoard(rows) {
    const retroRows = rows.filter(isRetroCandidate).slice(0, RETRO_MAX_ROWS);

    if (!retroRows.length) {
        elements.boardContainer.innerHTML = '<div class="retro-empty">Pro tuto stanici teď nejsou vhodné odjezdy na retro tabuli.</div>';
        return;
    }

    elements.boardContainer.innerHTML = `
        <div class="retro-board">
            <div class="retro-board-topline">
                <div class="retro-route-title">Odjezdy <span>Departures</span></div>
                <div class="retro-station-name">${escapeHtml(stationName.toUpperCase())}</div>
                <div class="retro-clock">${new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <div class="retro-board-grid retro-board-grid-head">
                <div>Cas</div><div>Vlak</div><div>Smer</div><div>Nastupiste</div><div>Zpozdeni</div><div>Stav</div>
            </div>
            ${retroRows.map((row) => {
                const item = row.train;
                const stop = row.stop;
                const currentIndex = row.currentIndex;
                const delay = row.delayMinutes || 0;
                const stopIndex = item.timetable.indexOf(stop);
                const origin = getCleanName(item.timetable, stopIndex, -1);
                const nextStation = getCleanName(item.timetable, stopIndex, 1);
                let status = "PRIJEDE";
                let retroRowClass = "";
                if (currentIndex === stop?.indexOfPoint) status = "VE STANICI";
                else if (currentIndex === (stop?.indexOfPoint ?? -1) + 1) {
                    status = "ODJIZDI";
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

function setClock() {
    elements.clock.textContent = new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function renderMissingStationMessage() {
    elements.stationTitle.textContent = "NEZADANA STANICE";
    elements.boardContainer.innerHTML = '<div class="retro-empty">Chybi parametr stanice. Otevri nejdriv stanici v hlavnim prehledu a znovu klikni na Retro tabule.</div>';
}

async function updateLoop() {
    clearTimeout(refreshTimer);
    const liveData = await fetchData(API_TRAINS);

    if (!liveData) {
        elements.boardContainer.innerHTML = '<div class="retro-empty">Nepodarilo se nacist live data. Zkus to znovu za chvili.</div>';
        refreshTimer = setTimeout(updateLoop, 15000);
        return;
    }

    const rows = collectStationRows(liveData);
    renderRetroBoard(rows);
    refreshTimer = setTimeout(updateLoop, 15000);
}

async function init() {
    elements.backBtn.addEventListener("click", () => {
        window.location.href = "index.html";
    });

    setClock();
    setInterval(setClock, 1000);

    if (!stationName) {
        renderMissingStationMessage();
        return;
    }

    elements.stationTitle.textContent = stationName.toUpperCase();

    showLoading();
    const edrData = await fetchData(API_EDR);
    hideLoading();

    if (!edrData || !Array.isArray(edrData)) {
        elements.boardContainer.innerHTML = '<div class="retro-empty">Nepodarilo se nacist EDR data pro retro tabuli.</div>';
        return;
    }

    cachedEDR = edrData;
    await updateLoop();
}

init();
