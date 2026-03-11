const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set();
let isFirstLoad = true;

// Normalizace pro Koluszki (odstranění diakritiky a mezer)
function norm(str) {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/ł/g, 'l').replace(/\s+/g, '');
}

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

// Hodiny
setInterval(() => { 
    const clock = document.getElementById('clock');
    if (clock) clock.innerText = new Date().toLocaleTimeString('cs-CZ'); 
}, 1000);

// Inicializace
async function init() {
    const [stData, edrData] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    if (stData?.data) {
        allStations = stData.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
    if (edrData) cachedEDR = edrData;
}
init();

// Vykreslení stanic do mřížky
function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    if (!grid) return;
    grid.innerHTML = stations.map(st => `
        <div class="st-card" onclick="openBoard('${st.Name.replace(/'/g, "\\'")}')">
            ${st.Name}
        </div>
    `).join('');
}

// Vyhledávání stanic
document.getElementById('station-search').oninput = (e) => {
    const val = norm(e.target.value);
    renderStations(allStations.filter(st => norm(st.Name).includes(val)));
};

// Otevření stanice
async function openBoard(name) {
    currentStation = name;
    isFirstLoad = true;
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
    if (!cachedEDR || !currentStation) return;
    const body = document.getElementById('departures-body');
    const normTarget = norm(currentStation);
    
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

        html += `
            <div class="train-row ${rowClass}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? fmt(stop.arrivalTime) : '--:--'}<br><span class="cyan">${stop.departureTime ? fmt(stop.departureTime) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">+${delay} min</div>
                <div>${status}</div>
            </div>`;
    });
    body.innerHTML = html;
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

function toggleTrain(id) {
    // Rozbalování jizdního řádu můžeš přidat sem
}