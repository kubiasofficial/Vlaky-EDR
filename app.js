const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;
const API_TIME = `/api-aws/getTime?serverCode=${SERVER}`;

let serverTimeOffset = 0;

async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error("Chyba API:", url, error);
        return null;
    }
}

async function init() {
    setInterval(updateClock, 1000);
    const timeData = await fetchData(API_TIME);
    if (timeData) serverTimeOffset = parseInt(timeData) - Date.now();
    await loadStations();
}

function updateClock() {
    const now = new Date(Date.now() + serverTimeOffset);
    document.getElementById('clock').innerText = now.toLocaleTimeString('cs-CZ');
}

async function loadStations() {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = "<div class='cyan'>NAČÍTÁM DISPEČERSKÝ REŽIM...</div>";
    const data = await fetchData(API_STATIONS);
    if (data && data.data) {
        grid.innerHTML = "";
        data.data.sort((a,b) => a.Name.localeCompare(b.Name)).forEach(st => {
            const card = document.createElement('div');
            card.className = 'st-card';
            card.innerHTML = `<img src="${st.MainImageURL}"><h3>${st.Name}</h3>`;
            card.onclick = () => openBoard(st.Name);
            grid.appendChild(card);
        });
    }
}

async function openBoard(stationName) {
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('st-name').innerText = stationName;
    
    const body = document.getElementById('departures-body');
    body.innerHTML = "<tr><td colspan='7' style='text-align:center'>Synchronizace s EDR...</td></tr>";

    const [edr, trains] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);

    body.innerHTML = "";
    const filtered = edr.filter(t => t.timetable.some(s => s.nameForPerson === stationName));
    
    filtered.sort((a,b) => {
        const tA = a.timetable.find(s => s.nameForPerson === stationName).departureTime;
        const tB = b.timetable.find(s => s.nameForPerson === stationName).departureTime;
        return new Date(tA) - new Date(tB);
    }).forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson === stationName);
        const live = trains?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const delay = live?.TrainData?.Delay || 0;
        const depTime = new Date(stop.departureTime).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});

        body.innerHTML += `
            <tr>
                <td class="cyan">${depTime}</td>
                <td>${item.trainName}<br><small>${item.trainNoLocal}</small></td>
                <td>${item.endStation}</td>
                <td>${stop.platform || '-'}</td>
                <td>${stop.track || '-'}</td>
                <td><span class="${delay > 0 ? 'delay' : 'on-time'}">${delay > 0 ? '+'+delay : 'VČAS'}</span></td>
                <td><span class="status-tag ${delay > 0 ? 's-wait' : 's-here'}">${delay > 0 ? 'NA CESTĚ' : 'KLID'}</span></td>
            </tr>`;
    });
}

document.getElementById('back-btn').onclick = () => location.reload();
init();