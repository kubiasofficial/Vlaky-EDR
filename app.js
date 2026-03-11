const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [];
let currentStation = null;
let refreshInterval = null;
let isFirstLoad = true;

const TECH_POINTS = ["PZS", "R145", "R154", "Głowice", "Rozjazd"];

async function fetchData(url) {
    try { const r = await fetch(url); return await r.json(); } catch(e) { return null; }
}

setInterval(() => {
    const el = document.getElementById('clock');
    if (el) el.innerText = new Date().toLocaleTimeString('cs-CZ');
}, 1000);

document.getElementById('enter-dispatch').onclick = () => {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    loadStations();
};

async function loadStations() {
    const data = await fetchData(API_STATIONS);
    if (data?.data) {
        allStations = data.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
}

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = "";
    stations.forEach(st => {
        const card = document.createElement('div');
        card.className = 'st-card';
        card.innerHTML = `<img src="${st.MainImageURL}"><h3>${st.Name}</h3>`;
        card.onclick = () => openBoard(st.Name);
        grid.appendChild(card);
    });
}

async function openBoard(name) {
    currentStation = name;
    isFirstLoad = true;
    document.getElementById('st-name').innerText = name;
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('view-toggle').classList.remove('hidden');
    
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000);
}

function getCleanName(timetable, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < timetable.length) {
        const n = timetable[i].nameForPerson;
        if (!TECH_POINTS.some(p => n.includes(p))) return n;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Konečná";
}

async function updateBoardData() {
    if (!currentStation) return;
    const [edr, liveData] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const body = document.getElementById('departures-body');
    const now = new Date();
    
    if (!edr) return;

    // Filtrujeme vlaky. Pro Koluszki hledáme shodu v názvu stanice v jízdním řádu
    const trains = edr.filter(t => t.timetable.some(s => s.nameForPerson.includes(currentStation)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => s.nameForPerson.includes(currentStation));
            const sB = b.timetable.find(s => s.nameForPerson.includes(currentStation));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    body.innerHTML = "";
    trains.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        let delay = live?.TrainData?.Delay || 0;
        
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;
        let rowClass = "row-arrival", status = "PŘIJEDE";

        if (live?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) {
            rowClass = "row-at-station"; status = "VE STANICI";
        } else if (live?.TrainData?.VDDelayedTimetableIndex > stop.indexOfPoint || (schedDep && now > new Date(schedDep.getTime() + delay * 60000))) {
            rowClass = "row-departed"; status = "ODJEL";
        }

        body.innerHTML += `
            <div class="train-row ${rowClass}">
                <div>${stop.arrivalTime ? new Date(stop.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}<br>
                     <span class="cyan">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span></div>
                <div><b>${item.trainName}</b><br><small>${item.trainNoLocal}</small></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</b><br><small>Cíl: ${item.endStation}</small></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}; font-weight:bold;">${delay > 0 ? '+'+delay+' min' : 'VČAS'}</div>
                <div>${status}</div>
            </div>`;
    });

    if (isFirstLoad) {
        const active = body.querySelector('.row-at-station, .row-arrival');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }

    // Globální uložení pro Modal
    window.lastTrains = trains;
    window.lastLive = liveData;
}

// OTEVŘENÍ MODALU (TABULE)
document.getElementById('view-toggle').onclick = () => {
    const modal = document.getElementById('board-modal');
    const container = document.getElementById('modal-board-container');
    modal.classList.remove('hidden');

    const now = new Date();
    const next8 = window.lastTrains
        .filter(t => {
            const s = t.timetable.find(st => st.nameForPerson.includes(currentStation));
            const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === t.trainNoLocal);
            const dep = s.departureTime ? new Date(s.departureTime) : new Date();
            const delay = live?.TrainData?.Delay || 0;
            return new Date(dep.getTime() + delay * 60000) >= new Date(now.getTime() - 120000);
        })
        .slice(0, 8);

    container.innerHTML = `<div class="board-header-row"><span>Druh</span><span>Číslo</span><span>CÍLOVÁ STANICE</span><span>Přes</span><span>Nás.</span><span>Kol.</span><span>Prav. odjezd</span><span>Zpož.</span></div>`;
    
    next8.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const type = item.trainName.split(" ")[0].toLowerCase();
        
        container.innerHTML += `
            <div class="board-row">
                <span class="board-${type}">${type.toUpperCase()}</span>
                <span class="board-${type}">${item.trainNoLocal}</span>
                <span class="board-${type}">${item.endStation.toUpperCase()}</span>
                <span>${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</span>
                <span class="board-orange">${stop.platform || ''}</span>
                <span class="board-orange">${stop.track || ''}</span>
                <span class="board-orange">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
                <span class="board-red">${(live?.TrainData?.Delay > 0) ? live.TrainData.Delay : ''}</span>
            </div>`;
    });
};

document.getElementById('close-modal').onclick = () => document.getElementById('board-modal').classList.add('hidden');
document.getElementById('back-btn').onclick = () => location.reload();
document.getElementById('global-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    if (!currentStation) {
        renderStations(allStations.filter(st => st.Name.toLowerCase().includes(term)));
    }
};