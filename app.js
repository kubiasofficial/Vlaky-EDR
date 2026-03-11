const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [];
let currentStation = null;
let refreshInterval = null;
let isFirstLoad = true;

const EXCLUDED_STATIONS = ["Koluszki PZS R145", "Koluszki PZS R154"];

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) { return null; }
}

function getNow() { return new Date(); }

setInterval(() => {
    document.getElementById('clock').innerText = getNow().toLocaleTimeString('cs-CZ');
}, 1000);

document.getElementById('enter-dispatch').onclick = () => {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    initDispatch();
};

async function initDispatch() { await loadStations(); }

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
    if (currentStation) updateBoardData(term);
    else renderStations(allStations.filter(s => s.Name.toLowerCase().includes(term)));
};

async function openBoard(name) {
    currentStation = name;
    isFirstLoad = true;
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('st-name').classList.remove('hidden');
    document.getElementById('st-name').innerText = name;
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('brand-info').classList.add('hidden');

    await updateBoardData();
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

    const now = getNow();
    body.innerHTML = "";

    const stationTrains = edr.filter(t => {
        const isInStation = t.timetable.some(s => s.nameForPerson === currentStation);
        const matches = t.trainNoLocal.toString().includes(filterTerm) || t.trainName.toLowerCase().includes(filterTerm);
        return isInStation && matches;
    }).sort((a,b) => {
        const tA = new Date(a.timetable.find(s => s.nameForPerson === currentStation).departureTime || a.timetable.find(s => s.nameForPerson === currentStation).arrivalTime);
        const tB = new Date(b.timetable.find(s => s.nameForPerson === currentStation).departureTime || b.timetable.find(s => s.nameForPerson === currentStation).arrivalTime);
        return tA - tB;
    });

    stationTrains.forEach(item => {
        const stopIndex = item.timetable.findIndex(s => s.nameForPerson === currentStation);
        const stop = item.timetable[stopIndex];
        
        const live = trains?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const delay = live?.TrainData?.Delay || 0;
        
        const schedArr = stop.arrivalTime ? new Date(stop.arrivalTime) : null;
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;
        const realDep = schedDep ? new Date(schedDep.getTime() + delay * 60000) : null;
        
        const odkud = getValidStation(item.timetable, stopIndex, -1);
        const kam = getValidStation(item.timetable, stopIndex, 1);

        let statusText = "PŘIJEDE";
        let rowClass = "row-arrival";

        if (realDep && now > realDep) {
            statusText = "ODJEL";
            rowClass = "row-departed";
        } else if (live?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) {
            statusText = "VE STANICI";
            rowClass = "row-at-station";
            if (realDep && (realDep - now) < 60000) rowClass += " row-departing";
        }

        const arrTimeStr = schedArr ? schedArr.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}) : '--:--';
        const depTimeStr = schedDep ? schedDep.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}) : '--:--';

        body.innerHTML += `
            <tr class="${rowClass}">
                <td class="time-cell">
                    <span class="cyan"><span class="time-label">Příjezd</span>${arrTimeStr}</span>
                    <span class="neon"><span class="time-label">Odjezd</span>${depTimeStr}</span>
                </td>
                <td><b>${item.trainName}</b><br><small>${item.trainNoLocal}</small></td>
                <td>${odkud}</td>
                <td><b>${kam}</b><br><small>Cíl: ${item.endStation}</small></td>
                <td>${stop.platform || '-'}/${stop.track || '-'}</td>
                <td style="font-weight:bold; color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">
                    ${delay !== 0 ? (delay > 0 ? '+'+delay : delay)+' min' : 'VČAS'}
                </td>
                <td>${statusText}</td>
            </tr>`;
    });

    if (isFirstLoad && filterTerm === "") {
        const firstActive = body.querySelector('.row-at-station, .row-arrival');
        if (firstActive) {
            setTimeout(() => {
                const headerOffset = 120;
                const elementPosition = firstActive.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                isFirstLoad = false;
            }, 500);
        }
    }
}

document.getElementById('back-btn').onclick = () => location.reload();