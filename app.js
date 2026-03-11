const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set();
let isFirstLoad = true;

// Funkce pro normalizaci textu (řeší polské znaky a mezery pro Koluszki)
function norm(str) {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/ł/g, 'l').replace(/\s+/g, '');
}

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

setInterval(() => { 
    document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ'); 
}, 1000);

async function init() {
    const [stData, edrData] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    if (stData?.data) {
        allStations = stData.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
    if (edrData) cachedEDR = edrData;
}
init();

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = stations.map(st => `<div class="st-card" onclick="openBoard('${st.Name}')">${st.Name}</div>`).join('');
}

// Filtrování stanic na úvodní ploše
document.getElementById('station-search').oninput = (e) => {
    const val = norm(e.target.value);
    renderStations(allStations.filter(st => norm(st.Name).includes(val)));
};

// Globální hledání vlaku (bleskové z cache)
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
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px; text-align:left;">
                <div><b class="cyan" style="font-size:1.2rem;">${trainLive.TrainName}</b><br>Aktuální poloha: <b style="color:var(--accent-green)">${currentStop?.nameForPerson || 'Na trati'}</b></div>
                <button class="glass-btn" onclick="openBoard('${currentStop?.nameForPerson}')">SLEDOVAT STANICI</button>
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

async function updateLoop() {
    if (!currentStation) return;
    const liveData = await fetchData(API_TRAINS);
    renderTable(liveData);
    setTimeout(updateLoop, 15000);
}

function renderTable(liveData) {
    if (!cachedEDR) return;
    const body = document.getElementById('departures-body');
    const normTarget = norm(currentStation);
    
    // Filtr pro vybranou stanici (podporuje Koluszki)
    const trains = cachedEDR.filter(t => t.timetable.some(s => norm(s.nameForPerson).includes(normTarget)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
            const sB = b.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    let html = "";
    trains.forEach(item => {
        const stop = item.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
        const live = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const delay = live?.TrainData?.Delay || 0;
        const currIdx = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
        
        let status = "PŘIJEDE", rowClass = "";
        if (currIdx === stop.indexOfPoint) { status = "VE STANICI"; rowClass = "row-at-station"; }
        else if (currIdx > stop.indexOfPoint) { status = "ODJEL"; rowClass = "row-departed"; }

        const isExp = expandedTrains.has(item.trainNoLocal.toString());
        html += `
            <div class="train-row ${rowClass}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? fmt(stop.arrivalTime) : '--:--'}<br><span class="cyan">${stop.departureTime ? fmt(stop.departureTime) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">+${delay} min ${getTrend(item.trainNoLocal, delay)}</div>
                <div>${status}</div>
            </div>
            <div id="det-${item.trainNoLocal}" class="train-detail ${isExp ? '' : 'hidden'}">
                <div class="tt-grid" style="color:var(--accent-blue); font-weight:bold;"><div>Příj.</div><div>Odj.</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map((s, i) => `
                    <div class="tt-grid ${i === currIdx ? 'current-pos' : ''}">
                        <div>${s.arrivalTime ? fmt(s.arrivalTime) : '--:--'}</div>
                        <div>${s.departureTime ? fmt(s.departureTime) : '--:--'}</div>
                        <div>${s.nameForPerson} ${i === currIdx ? '📍' : ''}</div>
                        <div>${s.platform || ''}</div>
                    </div>`).join('')}
            </div>`;
    });

    body.innerHTML = html;
    if (isFirstLoad) {
        const active = body.querySelector('.row-at-station') || body.querySelector('.train-row:not(.row-departed)');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
}

function getTrend(id, delay) {
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

function getCleanName(tt, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < tt.length) {
        if (!["PZS", "R145", "R154", "Głowice"].some(p => tt[i].nameForPerson.includes(p))) return tt[i].nameForPerson;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Cíl";
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('back-btn').onclick = () => location.reload();