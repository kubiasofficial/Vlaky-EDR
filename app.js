const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;
const API_TIME = `/api-aws/getTime?serverCode=${SERVER}`;

let serverTimeOffset = 0;
let allStations = [];
let currentStation = null;
let refreshInterval = null;

// Seznam stanic, které chceme v jízdním řádu přeskočit
const EXCLUDED_STATIONS = ["Koluszki PZS R145", "Koluszki PZS R154"];

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) { return null; }
}

function getServerTime() {
    // Přidáváme offset a korekci 1 hodiny (3600000 ms)
    return new Date(Date.now() + serverTimeOffset + 3600000);
}

setInterval(() => {
    document.getElementById('clock').innerText = getServerTime().toLocaleTimeString('cs-CZ');
}, 1000);

document.getElementById('enter-dispatch').onclick = () => {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    initDispatch();
};

async function initDispatch() {
    const timeData = await fetchData(API_TIME);
    if (timeData) serverTimeOffset = parseInt(timeData) - Date.now();
    await loadStations();
}

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
        card.className = 'st-card glass-panel';
        card.innerHTML = `<img src="${st.MainImageURL}"><h3>${st.Name}</h3>`;
        card.onclick = () => openBoard(st.Name);
        grid.appendChild(card);
    });
}

document.getElementById('global-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    if (currentStation) {
        updateBoardData(term);
    } else {
        const filtered = allStations.filter(s => s.Name.toLowerCase().includes(term));
        renderStations(filtered);
    }
};

async function openBoard(name) {
    currentStation = name;
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('st-name').classList.remove('hidden');
    document.getElementById('st-name').innerText = name;
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('brand-info').classList.add('hidden');
    document.getElementById('global-search').placeholder = "Hledat vlak...";

    updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 30000);
}

function getValidStation(timetable, currentIndex, direction) {
    let searchIndex = currentIndex + direction;
    while (searchIndex >= 0 && searchIndex < timetable.length) {
        const stationName = timetable[searchIndex].nameForPerson;
        if (!EXCLUDED_STATIONS.includes(stationName)) return stationName;
        searchIndex += direction;
    }
    return direction === -1 ? "Výchozí" : "Konečná";
}

async function updateBoardData(filterTerm = "") {
    if (!currentStation) return;
    const body = document.getElementById('departures-body');
    const [edr, trains] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    if (!edr) return;

    const now = getServerTime();
    body.innerHTML = "";

    edr.filter(t => {
        const isInStation = t.timetable.some(s => s.nameForPerson === currentStation);
        const matches = t.trainNoLocal.toString().includes(filterTerm) || t.trainName.toLowerCase().includes(filterTerm);
        return isInStation && matches;
    }).sort((a,b) => {
        const tA = new Date(a.timetable.find(s => s.nameForPerson === currentStation).departureTime);
        const tB = new Date(b.timetable.find(s => s.nameForPerson === currentStation).departureTime);
        return tA - tB;
    }).forEach(item => {
        const stopIndex = item.timetable.findIndex(s => s.nameForPerson === currentStation);
        const stop = item.timetable[stopIndex];
        const odkud = getValidStation(item.timetable, stopIndex, -1);
        const kam = getValidStation(item.timetable, stopIndex, 1);
        
        const live = trains?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const delay = live?.TrainData?.Delay || 0;
        const schedDep = new Date(stop.departureTime);
        const realDep = new Date(schedDep.getTime() + delay * 60000);
        
        let statusText = "PŘIJEDE";
        let rowClass = "row-arrival";

        if (now > realDep) {
            statusText = "ODJEL";
            rowClass = "row-departed";
        } else if (live?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) {
            statusText = "VE STANICI";
            rowClass = "row-at-station";
            if ((realDep - now) < 60000) rowClass += " row-departing";
        }

        body.innerHTML += `
            <tr class="${rowClass}">
                <td class="cyan">${schedDep.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'})}</td>
                <td><b>${item.trainName}</b><br><small>${item.trainNoLocal}</small></td>
                <td>${odkud}</td>
                <td><b>${kam}</b><br><small>Cíl: ${item.endStation}</small></td>
                <td>${stop.platform || '-'}/${stop.track || '-'}</td>
                <td style="font-weight:bold">${delay > 0 ? '+'+delay+' min' : (delay < 0 ? delay : 'VČAS')}</td>
                <td>${statusText}</td>
            </tr>`;
    });
}

document.getElementById('back-btn').onclick = () => location.reload();