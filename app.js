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
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_POSITIONS = `/api-simrail/train-positions-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set();
let isFirstLoad = true;

function norm(str) {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, 'l').replace(/\s+/g, '');
}

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

setInterval(() => { 
    const c = document.getElementById('clock');
    if(c) c.innerText = new Date().toLocaleTimeString('cs-CZ'); 
}, 1000);

async function init() {
    const [st, edr] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    if (st?.data) {
        allStations = st.data.sort((a,b) => a.Name.localeCompare(b.Name));
        const grid = document.getElementById('stations-grid');
        if(grid) grid.innerHTML = allStations.map(s => `<div class="st-card" onclick="openBoard('${s.Name.replace(/'/g, "\\'")}')">${s.Name}</div>`).join('');
    }
    if (edr) cachedEDR = edr;
}
init();

document.getElementById('station-search').oninput = (e) => {
    const val = norm(e.target.value);
    const filtered = allStations.filter(s => norm(s.Name).includes(val));
    const grid = document.getElementById('stations-grid');
    if (filtered.length === 0) {
        grid.innerHTML = '<div style="color:var(--accent-red);padding:20px;">Žádná stanice nenalezena.</div>';
    } else {
        grid.innerHTML = filtered.map(s => `<div class="st-card" onclick="openBoard('${s.Name.replace(/'/g, "\\'")}')">${s.Name}</div>`).join('');
    }
};

async function openBoard(name) {
    currentStation = name; isFirstLoad = true;
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    updateLoop();
}

async function updateLoop() {
    if (!currentStation) return;
    showLoading();
    const [live, pos] = await Promise.all([fetchData(API_TRAINS), fetchData(API_POSITIONS)]);
    hideLoading();
    renderTable(live, pos);
    setTimeout(updateLoop, 15000);
}

function renderTable(liveData, posData) {
    if (!cachedEDR || !currentStation) return;
    const body = document.getElementById('departures-body');
    const nTarget = norm(currentStation);
    
    const trains = cachedEDR.filter(t => t.timetable.some(s => norm(s.nameForPerson).includes(nTarget)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => norm(s.nameForPerson).includes(nTarget));
            const sB = b.timetable.find(s => norm(s.nameForPerson).includes(nTarget));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    window.lastTrains = trains; window.lastLive = liveData;
    let html = "";

    trains.forEach(item => {
        const stop = item.timetable.find(s => norm(s.nameForPerson).includes(nTarget));
        const live = liveData?.data?.find(l => l.TrainNoLocal === item.trainNoLocal);
        const pos = posData?.data?.find(p => p.id === live?.Id);
        const speed = pos ? Math.round(pos.Velocity) : 0;
        const delay = live?.TrainData?.Delay || 0;
        const currIdx = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
        
        let status = "PŘIJEDE", rowClass = "";
        
        if (currIdx === stop.indexOfPoint) {
            status = speed < 5 ? "VE STANICI" : "PROJÍŽDÍ";
            rowClass = "row-at-station";
        } else if (currIdx === (stop.indexOfPoint + 1)) {
            status = "ODJÍŽDÍ"; rowClass = "row-departing";
        } else if (currIdx > stop.indexOfPoint) {
            status = "ODJEL"; rowClass = "row-departed";
        }

        const isExp = expandedTrains.has(item.trainNoLocal.toString());
        
        html += `
            <div class="train-row ${rowClass}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? fmt(stop.arrivalTime) : '--:--'}<br><span style="color:var(--neon-cyan)">${stop.departureTime ? fmt(stop.departureTime) : '--:--'}</span></div>
                <div><b>${item.trainName} ${item.trainNoLocal}</b></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">+${delay} min</div>
                <div><b>${status}</b></div>
            </div>
            <div id="det-${item.trainNoLocal}" class="train-detail ${isExp ? '' : 'hidden'}">
                <div class="speed-badge">GPS Rychlost: <b style="color:var(--accent-green)">${speed} km/h</b></div>
                <div class="tt-grid" style="color:var(--accent-blue); font-weight:bold; border-bottom:1px solid #333;"><div>Příj.</div><div>Odj.</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map(s => `
                    <div class="tt-grid ${s.indexOfPoint === currIdx ? 'current-pos' : ''}">
                        <div>${s.arrivalTime ? fmt(s.arrivalTime) : '--:--'}</div>
                        <div>${s.departureTime ? fmt(s.departureTime) : '--:--'}</div>
                        <div>${s.nameForPerson} ${s.indexOfPoint === currIdx ? '📍' : ''}</div>
                        <div>${s.platform || ''}</div>
                    </div>`).join('')}
            </div>`;
    });
    body.innerHTML = html;

    if (isFirstLoad) {
        const act = body.querySelector('.row-at-station') || body.querySelector('.row-departing') || body.querySelector('.train-row:not(.row-departed)');
        if (act) act.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
    // updateAnnUI odstraněno
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
        if (!["PZS", "R145", "R154", "Glowice"].some(p => tt[i].nameForPerson.includes(p))) return tt[i].nameForPerson;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Cíl";
}

// odstraněno: zbytky po hlášení
