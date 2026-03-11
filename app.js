const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;
const API_TIME = `/api-aws/getTime?serverCode=${SERVER}`;

let serverTimeOffset = 0;
let allStations = [];
let refreshInterval = null;
let currentStation = null;

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) { return null; }
}

// Hodiny
setInterval(() => {
    const now = new Date(Date.now() + serverTimeOffset);
    document.getElementById('clock').innerText = now.toLocaleTimeString('cs-CZ');
}, 1000);

// Vstup do systému
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
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = "<div class='cyan'>Načítám dispečerská data...</div>";
    const data = await fetchData(API_STATIONS);
    if (data && data.data) {
        allStations = data.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
}

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = "";
    stations.forEach(st => {
        const card = document.createElement('div');
        card.className = 'st-card animate-fade-in';
        card.innerHTML = `<img src="${st.MainImageURL}" style="width:100%; height:140px; object-fit:cover; opacity:0.5">
                          <h3 style="text-align:center; padding:10px; margin:0">${st.Name}</h3>`;
        card.onclick = () => openBoard(st.Name);
        grid.appendChild(card);
    });
}

// Vyhledávání
document.getElementById('station-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allStations.filter(s => s.Name.toLowerCase().includes(term));
    renderStations(filtered);
};

// Tabule a auto-obnovení (30s)
async function openBoard(name) {
    currentStation = name;
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-search').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('st-name').innerText = name;
    
    updateBoardData();
    refreshInterval = setInterval(updateBoardData, 30000); // 30 sekund
}

async function updateBoardData() {
    if (!currentStation) return;
    const body = document.getElementById('departures-body');
    const [edr, trains] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);

    if (!edr) return;
    body.innerHTML = "";
    
    edr.filter(t => t.timetable.some(s => s.nameForPerson === currentStation))
       .sort((a,b) => {
           const tA = a.timetable.find(s => s.nameForPerson === currentStation).departureTime;
           const tB = b.timetable.find(s => s.nameForPerson === currentStation).departureTime;
           return new Date(tA) - new Date(tB);
       }).forEach(item => {
           const stop = item.timetable.find(s => s.nameForPerson === currentStation);
           const live = trains?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
           const delay = live?.TrainData?.Delay || 0;
           const depTime = new Date(stop.departureTime).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});

           body.innerHTML += `<tr>
               <td class="cyan">${depTime}</td>
               <td>${item.trainName}<br><small>${item.trainNoLocal}</small></td>
               <td><b>${item.endStation}</b></td>
               <td>${stop.platform || '-'}</td>
               <td>${stop.track || '-'}</td>
               <td style="color:${delay > 0 ? '#d71920' : '#00ff88'}">${delay > 0 ? '+'+delay : 'VČAS'}</td>
               <td><span class="status-tag">${delay > 0 ? 'NA CESTĚ' : 'KLID'}</span></td>
           </tr>`;
       });
}

document.getElementById('back-btn').onclick = () => {
    currentStation = null;
    clearInterval(refreshInterval);
    document.getElementById('stations-grid').classList.remove('hidden');
    document.getElementById('station-search').classList.remove('hidden');
    document.getElementById('station-view').classList.add('hidden');
    document.getElementById('back-btn').classList.add('hidden');
};