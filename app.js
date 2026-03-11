const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [];
let currentStation = null;
let refreshInterval = null;
let isFirstLoad = true;
let lastSearchTerm = "";

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) { return null; }
}

// Hodiny a vyhledávání
setInterval(() => {
    const el = document.getElementById('clock');
    if (el) el.innerText = new Date().toLocaleTimeString('cs-CZ');
}, 1000);

document.getElementById('global-search').addEventListener('input', (e) => {
    lastSearchTerm = e.target.value.toLowerCase();
    if (currentStation) updateBoardData();
    else renderStations(allStations.filter(st => st.Name.toLowerCase().includes(lastSearchTerm)));
});

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
    document.getElementById('global-search').value = "";
    lastSearchTerm = "";
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('st-name').innerText = name;
    
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000); // Rychlejší refresh pro zpoždění
}

function getValidStation(timetable, currentIndex, direction) {
    let idx = currentIndex + direction;
    return (idx >= 0 && idx < timetable.length) ? timetable[idx].nameForPerson : (direction === -1 ? "Výchozí" : "Konečná");
}

async function updateBoardData() {
    if (!currentStation) return;
    const [edr, liveData] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const body = document.getElementById('departures-body');
    const now = new Date();
    body.innerHTML = "";

    if (!edr) return;

    const filtered = edr.filter(t => {
        const hasStation = t.timetable.some(s => s.nameForPerson === currentStation);
        const matchesSearch = t.trainName.toLowerCase().includes(lastSearchTerm) || t.trainNoLocal.toString().includes(lastSearchTerm);
        return hasStation && matchesSearch;
    }).sort((a,b) => {
        const stopA = a.timetable.find(s => s.nameForPerson === currentStation);
        const stopB = b.timetable.find(s => s.nameForPerson === currentStation);
        return new Date(stopA.departureTime || stopA.arrivalTime) - new Date(stopB.departureTime || stopB.arrivalTime);
    });

    filtered.forEach(item => {
        const stopIndex = item.timetable.findIndex(s => s.nameForPerson === currentStation);
        const stop = item.timetable[stopIndex];
        const liveTrain = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        
        // --- DYNAMICKÝ VÝPOČET ZPOŽDĚNÍ ---
        let delay = liveTrain ? (liveTrain.TrainData?.Delay || 0) : 0;
        const schedArr = stop.arrivalTime ? new Date(stop.arrivalTime) : null;
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;
        
        let rowClass = "row-arrival";
        let statusText = "PŘIJEDE";

        // Kontrola stavu "VE STANICI" a dopočet zpoždění při pobytu
        if (liveTrain && liveTrain.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) {
            rowClass = "row-at-station";
            statusText = "VE STANICI";
            
            // Pokud je vlak ve stanici a už měl odjet, přičítáme zpoždění v reálném čase
            if (schedDep) {
                const expectedDep = new Date(schedDep.getTime() + delay * 60000);
                if (now > expectedDep) {
                    const extra = Math.floor((now - expectedDep) / 60000);
                    delay += extra;
                }
            }
        } else if (schedDep && now > new Date(schedDep.getTime() + delay * 60000)) {
            rowClass = "row-departed";
            statusText = "ODJEL";
        }

        body.innerHTML += `
            <div class="train-row ${rowClass}">
                <div>
                    <span class="time-label">Příjezd</span>${schedArr ? schedArr.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}
                    <span class="time-label">Odjezd</span><span class="cyan">${schedDep ? schedDep.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span>
                </div>
                <div><b>${item.trainName}</b><br><small>${item.trainNoLocal}</small></div>
                <div>${getValidStation(item.timetable, stopIndex, -1)}</div>
                <div><b>${getValidStation(item.timetable, stopIndex, 1)}</b><br><small>Cíl: ${item.endStation}</small></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : (liveTrain ? 'var(--accent-green)' : 'var(--text-dim)')}; font-weight:bold; font-size:1.1rem;">
                    ${liveTrain ? (delay !== 0 ? (delay > 0 ? '+'+delay : delay) + ' min' : 'VČAS') : 'MIMO MAPU'}
                </div>
                <div>${statusText}</div>
            </div>`;
    });

    if (isFirstLoad && lastSearchTerm === "") {
        const firstActive = body.querySelector('.row-at-station, .row-arrival');
        if (firstActive) { firstActive.scrollIntoView({ behavior: 'smooth', block: 'center' }); isFirstLoad = false; }
    }
}

document.getElementById('back-btn').onclick = () => location.reload();