const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set(), announcedTrains = new Set();
let isAutoAnnounce = false, announcementQueue = [], isSpeaking = false, isFirstLoad = true;

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ'); }, 1000);

// OPTIMALIZOVANÝ START
async function init() {
    console.log("Stahuji data...");
    const [stData, edrData] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    if (stData?.data) {
        allStations = stData.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
    if (edrData) cachedEDR = edrData;
    console.log("Data připravena.");
}
init();

// FILTRACE STANIC
document.getElementById('station-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    renderStations(allStations.filter(st => st.Name.toLowerCase().includes(term)));
};

// GLOBÁLNÍ HLEDÁNÍ VLAKU (Okamžité z cache)
document.getElementById('train-global-search').oninput = async (e) => {
    const val = e.target.value;
    const resDiv = document.getElementById('global-train-result');
    if (val.length < 2 || !cachedEDR) { resDiv.classList.add('hidden'); return; }

    const live = await fetchData(API_TRAINS);
    const trainLive = live?.data?.find(t => t.TrainNoLocal.toString().includes(val));
    
    if (trainLive) {
        const trainInfo = cachedEDR.find(t => t.trainNoLocal === trainLive.TrainNoLocal);
        const currentStop = trainInfo?.timetable[trainLive.TrainData.VDDelayedTimetableIndex];
        resDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; text-align:left;">
                <div><b class="cyan">${trainLive.TrainName}</b><br>Poloha: <b style="color:var(--accent-green)">${currentStop?.nameForPerson || 'Na trati'}</b></div>
                <button class="glass-btn" onclick="openBoard('${currentStop?.nameForPerson}')">PŘEJÍT NA STANICI</button>
            </div>`;
        resDiv.classList.remove('hidden');
    }
};

async function openBoard(name) {
    if (!name || name === "Na trati") return;
    currentStation = name; isFirstLoad = true;
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    updateLoop();
}

// SMYČKA AKTUALIZACE - Stahuje jen pár KB live dat
async function updateLoop() {
    if (!currentStation) return;
    const liveData = await fetchData(API_TRAINS);
    renderTable(liveData);
    setTimeout(updateLoop, 15000);
}

function renderTable(liveData) {
    if (!cachedEDR) return;
    const body = document.getElementById('departures-body');
    
    const trains = cachedEDR.filter(t => t.timetable.some(s => s.nameForPerson.includes(currentStation)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => s.nameForPerson.includes(currentStation));
            const sB = b.timetable.find(s => s.nameForPerson.includes(currentStation));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    window.lastTrains = trains; window.lastLive = liveData;
    let html = "";
    
    trains.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const delay = live?.TrainData?.Delay || 0;
        const currIdx = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
        
        let status = "PŘIJEDE", rowClass = "";
        if (currIdx === stop.indexOfPoint) { status = "VE STANICI"; rowClass = "row-at-station"; }
        else if (currIdx > stop.indexOfPoint) { status = "ODJEL"; rowClass = "row-departed"; }

        const trend = getTrendIcon(item.trainNoLocal, delay);
        const isExp = expandedTrains.has(item.trainNoLocal.toString());

        html += `
            <div class="train-row ${rowClass}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? fmt(stop.arrivalTime) : '--:--'}<br><span class="cyan">${stop.departureTime ? fmt(stop.departureTime) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getClean(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">+${delay} min ${trend}</div>
                <div>${status}</div>
            </div>
            <div id="det-${item.trainNoLocal}" class="train-detail ${isExp ? '' : 'hidden'}">
                <div class="tt-grid" style="color:var(--accent-blue); font-weight:bold;"><div>Příj.</div><div>Odj.</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map((s, i) => `
                    <div class="tt-grid ${i === currIdx ? 'current-pos' : ''}">
                        <div>${s.arrivalTime ? fmt(s.arrivalTime) : ''}</div>
                        <div>${s.departureTime ? fmt(s.departureTime) : ''}</div>
                        <div>${s.nameForPerson} ${i === currIdx ? '📍' : ''}</div>
                        <div>${s.platform || ''}</div>
                    </div>`).join('')}
            </div>`;
    });

    body.innerHTML = html;
    if (isFirstLoad) {
        const target = body.querySelector('.row-at-station') || body.querySelector('.train-row:not(.row-departed)');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
    updateAnnUI();
}

function getTrendIcon(id, delay) {
    const last = delayHistory[id]; delayHistory[id] = delay;
    if (last === undefined || last === delay) return "";
    return delay > last ? "↗️" : "↘️";
}

function toggleTrain(id) {
    const el = document.getElementById(`det-${id}`);
    if (expandedTrains.has(id.toString())) { expandedTrains.delete(id.toString()); el.classList.add('hidden'); }
    else { expandedTrains.add(id.toString()); el.classList.remove('hidden'); }
}

const fmt = (d) => new Date(d).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});

function getClean(tt, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < tt.length) {
        if (!["PZS", "R145", "R154", "Głowice"].some(p => tt[i].nameForPerson.includes(p))) return tt[i].nameForPerson;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Cíl";
}

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = stations.map(st => `<div class="st-card" onclick="openBoard('${st.Name}')">${st.Name}</div>`).join('');
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('back-btn').onclick = () => location.reload();

// Zbytek funkcí pro hlášení (TTS) je stejný jako v předchozí stabilní verzi