const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [];
let currentStation = null;
let refreshInterval = null;
let isFirstLoad = true;
let lastSearchTerm = "";

// Body, které nejsou pro cestující zajímavé a kazí výpis Odkud/Kam
const EXCLUDED_POINTS = ["Koluszki PZS R145", "Koluszki PZS R154", "PZS R145", "PZS R154", "PZS"];

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) { return null; }
}

// Časovač hodin
setInterval(() => {
    const el = document.getElementById('clock');
    if (el) el.innerText = new Date().toLocaleTimeString('cs-CZ');
}, 1000);

// Logika vyhledávání (stanice i vlaky)
document.getElementById('global-search').addEventListener('input', (e) => {
    lastSearchTerm = e.target.value.toLowerCase();
    if (currentStation) {
        updateBoardData();
    } else {
        const filtered = allStations.filter(st => st.Name.toLowerCase().includes(lastSearchTerm));
        renderStations(filtered);
    }
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
    document.getElementById('st-name').innerText = name.toUpperCase();
    
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000); // 15s refresh pro dynamiku
}

// Funkce, která přeskočí technické body a najde skutečnou stanici
function getHumanStation(timetable, currentIndex, direction) {
    let idx = currentIndex + direction;
    while (idx >= 0 && idx < timetable.length) {
        const point = timetable[idx];
        const isTechnical = EXCLUDED_POINTS.some(p => point.nameForPerson.includes(p));
        if (!isTechnical) {
            return point.nameForPerson;
        }
        idx += direction;
    }
    return direction === -1 ? "Výchozí" : "Konečná";
}

async function updateBoardData() {
    if (!currentStation) return;
    const [edr, liveData] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const body = document.getElementById('departures-body');
    const now = new Date();
    body.innerHTML = "";

    if (!edr) return;

    // Filtrujeme vlaky pro danou stanici a aplikujeme hledání
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
        
        // GLOBÁLNÍ ZPOŽDĚNÍ: Pokud je vlak na mapě, bereme jeho zpoždění bez ohledu na to, kde je
        let delay = liveTrain ? (liveTrain.TrainData?.Delay || 0) : 0;
        
        const schedArr = stop.arrivalTime ? new Date(stop.arrivalTime) : null;
        const schedDep = stop.departureTime ? new Date(stop.departureTime) : null;
        
        let rowClass = "row-arrival";
        let statusText = "PŘIJEDE";

        if (liveTrain && liveTrain.TrainData) {
            const currentTrainIdx = liveTrain.TrainData.VDDelayedTimetableIndex;
            
            // Logika stavů
            if (currentTrainIdx === stop.indexOfPoint) {
                rowClass = "row-at-station";
                statusText = "VE STANICI";
                
                // Dynamické zpoždění ve stanici: pokud už měl odjet, přičítáme minuty
                if (schedDep) {
                    const expectedDep = new Date(schedDep.getTime() + delay * 60000);
                    if (now > expectedDep) {
                        delay += Math.floor((now - expectedDep) / 60000);
                    }
                }
            } else if (currentTrainIdx > stop.indexOfPoint) {
                rowClass = "row-departed";
                statusText = "ODJEL";
            }
        } else if (schedDep && now > new Date(schedDep.getTime() + delay * 60000)) {
            // Pokud není na mapě, ale čas už vypršel
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
                <div>${getHumanStation(item.timetable, stopIndex, -1)}</div>
                <div><b>${getHumanStation(item.timetable, stopIndex, 1)}</b><br><small>Cíl: ${item.endStation}</small></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : (liveTrain ? 'var(--accent-green)' : 'var(--text-dim)')}; font-weight:bold; font-size:1.1rem;">
                    ${liveTrain ? (delay !== 0 ? (delay > 0 ? '+'+delay : delay) + ' min' : 'VČAS') : 'MIMO MAPU'}
                </div>
                <div>${statusText}</div>
            </div>`;
    });

    // Scrollování na první podstatný vlak
    if (isFirstLoad && lastSearchTerm === "") {
        const firstActive = body.querySelector('.row-at-station, .row-arrival');
        if (firstActive) {
            firstActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
            isFirstLoad = false;
        }
    }
}

document.getElementById('back-btn').onclick = () => location.reload();