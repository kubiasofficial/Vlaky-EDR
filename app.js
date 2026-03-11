const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [];
let currentStation = null;
let refreshInterval = null;
let isFirstLoad = true;
let lastSearchTerm = "";
let isBoardView = false;

const EXCLUDED_POINTS = ["Koluszki PZS", "PZS R145", "PZS R154"];

async function fetchData(url) {
    try { const response = await fetch(url); return await response.json(); } catch (e) { return null; }
}

setInterval(() => {
    document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ');
}, 1000);

document.getElementById('view-toggle').onclick = () => {
    isBoardView = !isBoardView;
    document.getElementById('view-toggle').innerText = isBoardView ? "SEZNAM" : "TABULE";
    updateBoardData();
};

document.getElementById('global-search').oninput = (e) => {
    lastSearchTerm = e.target.value.toLowerCase();
    if (currentStation) updateBoardData();
    else renderStations(allStations.filter(st => st.Name.toLowerCase().includes(lastSearchTerm)));
};

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
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('view-toggle').classList.remove('hidden');
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000);
}

function getHumanStation(timetable, currentIndex, direction) {
    let idx = currentIndex + direction;
    while (idx >= 0 && idx < timetable.length) {
        const name = timetable[idx].nameForPerson;
        if (!EXCLUDED_POINTS.some(p => name.includes(p))) return name;
        idx += direction;
    }
    return direction === -1 ? "Výchozí" : "Konečná";
}

async function updateBoardData() {
    if (!currentStation) return;
    const [edr, liveData] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const container = document.getElementById('departures-body');
    const header = document.getElementById('table-header');
    const now = new Date();
    container.innerHTML = "";

    if (!edr) return;

    const filtered = edr.filter(t => 
        t.timetable.some(s => s.nameForPerson === currentStation) &&
        (t.trainName.toLowerCase().includes(lastSearchTerm) || t.trainNoLocal.toString().includes(lastSearchTerm))
    ).sort((a,b) => {
        const sA = a.timetable.find(s => s.nameForPerson === currentStation);
        const sB = b.timetable.find(s => s.nameForPerson === currentStation);
        return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
    });

    if (isBoardView) {
        header.classList.add('hidden');
        renderClassicBoard(container, filtered, liveData, now);
    } else {
        header.classList.remove('hidden');
        renderModernList(container, filtered, liveData, now);
    }
}

function renderModernList(container, data, liveData, now) {
    data.forEach(item => {
        const stopIndex = item.timetable.findIndex(s => s.nameForPerson === currentStation);
        const stop = item.timetable[stopIndex];
        const liveTrain = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        let delay = liveTrain?.TrainData?.Delay || 0;
        
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;
        let rowClass = "row-arrival", statusText = "PŘIJEDE";

        if (liveTrain?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) {
            rowClass = "row-at-station"; statusText = "VE STANICI";
            if (schedDep && now > new Date(schedDep.getTime() + delay * 60000)) delay += Math.floor((now - new Date(schedDep.getTime() + delay * 60000)) / 60000);
        } else if (liveTrain?.TrainData?.VDDelayedTimetableIndex > stop.indexOfPoint || (schedDep && now > new Date(schedDep.getTime() + delay * 60000))) {
            rowClass = "row-departed"; statusText = "ODJEL";
        }

        container.innerHTML += `
            <div class="train-row ${rowClass}">
                <div><span class="time-label">Příjezd</span>${stop.arrivalTime ? new Date(stop.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}
                     <span class="time-label">Odjezd</span><span class="cyan">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getHumanStation(item.timetable, stopIndex, -1)}</div>
                <div><b>${getHumanStation(item.timetable, stopIndex, 1)}</b><br><small>Cíl: ${item.endStation}</small></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}; font-weight:bold;">${liveTrain ? (delay > 0 ? '+'+delay+' min' : 'VČAS') : 'MIMO MAPU'}</div>
                <div>${statusText}</div>
            </div>`;
    });
}

function renderClassicBoard(container, data, liveData, now) {
    container.innerHTML = `<div class="board-header-row"><span>Druh</span><span>Číslo</span><span>CÍLOVÁ STANICE</span><span>Přes</span><span>Nás.</span><span>Kol.</span><span>Prav. odjezd</span><span>Zpož.</span></div>`;
    data.forEach(item => {
        const stopIndex = item.timetable.findIndex(s => s.nameForPerson === currentStation);
        const stop = item.timetable[stopIndex];
        const liveTrain = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        let delay = liveTrain?.TrainData?.Delay || 0;
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;

        if (schedDep && now > new Date(schedDep.getTime() + (delay + 2) * 60000)) return;

        const type = item.trainName.split(" ")[0];
        const typeClass = ["Rx", "Ex", "IC", "EC", "TLK"].includes(type) ? "board-fast" : "board-os";

        container.innerHTML += `
            <div class="board-row">
                <span class="${typeClass}">${type}</span>
                <span class="${typeClass}">${item.trainNoLocal}</span>
                <span class="${typeClass}">${item.endStation.toUpperCase()}</span>
                <span>${getHumanStation(item.timetable, stopIndex, 1)}</span>
                <span class="board-orange">${stop.platform || ''}</span>
                <span class="board-orange">${stop.track || ''}</span>
                <span class="board-orange">${schedDep?.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) || ''}</span>
                <span class="board-red">${delay > 0 ? delay : ''}</span>
            </div>`;
    });
}

document.getElementById('back-btn').onclick = () => location.reload();