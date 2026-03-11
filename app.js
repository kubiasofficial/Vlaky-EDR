const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set();
let isFirstLoad = true;

// Normalizace pro Koluszki a další polské názvy
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
    if (!grid) return;
    grid.innerHTML = stations.map(st => `
        <div class="st-card" onclick="openBoard('${st.Name}')">
            ${st.Name}
        </div>
    `).join('');
}

document.getElementById('station-search').oninput = (e) => {
    const val = norm(e.target.value);
    renderStations(allStations.filter(st => norm(st.Name).includes(val)));
};

// ... (zbytek funkcí openBoard, updateLoop a renderTable zůstává stejný jako v předchozí verzi)