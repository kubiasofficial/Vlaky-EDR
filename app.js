const SERVER = "cz1";

// Cesty definované v souboru vercel.json (vlastní Vercel Proxy)
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;
const API_TIME = `/api-aws/getTime?serverCode=${SERVER}`;

let serverTimeOffset = 0;

/**
 * Hlavní funkce pro načítání dat přes vnitřní přesměrování Vercelu
 */
async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server odpověděl chybou: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error("Chyba při komunikaci s API:", url, error);
        return null;
    }
}

/**
 * Spuštění aplikace
 */
async function init() {
    console.log("Systém SimRail CZ1 se spouští přes Vercel Proxy...");
    
    // Okamžitě rozjet hodiny
    setInterval(updateClock, 1000);
    
    // Synchronizace času
    const timeData = await fetchData(API_TIME);
    if (timeData) {
        serverTimeOffset = parseInt(timeData) - Date.now();
        console.log("Čas synchronizován.");
    }

    await loadStations();
}

function updateClock() {
    const now = new Date(Date.now() + serverTimeOffset);
    const clockEl = document.getElementById('clock');
    if (clockEl) clockEl.innerText = now.toLocaleTimeString('cs-CZ');
}

async function loadStations() {
    const grid = document.getElementById('stations-grid');
    if (!grid) return;
    
    grid.innerHTML = "<div class='cyan'>NAČÍTÁM STANICE ZE SERVERU CZ1...</div>";

    const data = await fetchData(API_STATIONS);
    if (data && data.data) {
        grid.innerHTML = "";
        data.data.sort((a,b) => a.Name.localeCompare(b.Name)).forEach(st => {
            const card = document.createElement('div');
            card.className = 'st-card glass';
            card.innerHTML = `
                <img src="${st.MainImageURL}" onerror="this.src='https://via.placeholder.com/400x200/01080b/00f2ff?text=${st.Name}'">
                <h3>${st.Name}</h3>
            `;
            card.onclick = () => openBoard(st.Name);
            grid.appendChild(card);
        });
    } else {
        grid.innerHTML = "<div class='delay'>Nepodařilo se načíst stanice. Zkontroluj vercel.json na GitHubu.</div>";
    }
}

async function openBoard(stationName) {
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('st-name').innerText = stationName;

    const body = document.getElementById('departures-body');
    body.innerHTML = "<tr><td colspan='7' style='text-align:center' class='cyan'>DEKÓDUJI JÍZDNÍ ŘÁDY...</td></tr>";

    const [edrData, trainData] = await Promise.all([
        fetchData(API_EDR),
        fetchData(API_TRAINS)
    ]);

    if (!edrData) {
        body.innerHTML = "<tr><td colspan='7' class='delay'>Chyba spojení s EDR serverem.</td></tr>";
        return;
    }

    body.innerHTML = "";
    const boardData = [];

    edrData.forEach(train => {
        const stop = train.timetable.find(s => s.nameForPerson === stationName);
        if (stop && stop.departureTime) {
            const liveInfo = trainData?.data?.find(lt => lt.TrainNoLocal === train.trainNoLocal);
            boardData.push({ ...train, stop, liveInfo });
        }
    });

    boardData.sort((a,b) => new Date(a.stop.departureTime) - new Date(b.stop.departureTime));

    if (boardData.length === 0) {
        body.innerHTML = "<tr><td colspan='7' style='text-align:center'>Žádné odjezdy v nejbližší době.</td></tr>";
        return;
    }

    boardData.forEach(item => {
        const depTime = new Date(item.stop.departureTime).toLocaleTimeString('cs-CZ', {hour: '2-digit', minute:'2-digit'});
        const delay = item.liveInfo?.TrainData?.Delay || 0;
        const isAtStation = (item.liveInfo?.TrainData?.VDDelayedTimetableIndex === item.stop.indexOfPoint);
        const velocity = item.liveInfo?.TrainData?.Velocity || 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="cyan">${depTime}</td>
            <td><small>${item.trainNoLocal}</small><br>${item.trainName}</td>
            <td><b>${item.endStation}</b></td>
            <td>${item.stop.platform || '-'}</td>
            <td>${item.stop.track || '-'}</td>
            <td>
                <span class="${delay > 0 ? 'delay' : 'on-time'}">${delay > 0 ? '+' + delay + ' min' : 'VČAS'}</span>
            </td>
            <td>
                ${isAtStation ? '<span class="status-tag s-here">STOJÍ</span>' : '<span class="status-tag s-wait">JEDE</span>'}
                ${velocity > 0 ? `<br><small style="opacity:0.5">${velocity} km/h</small>` : ''}
            </td>
        `;
        body.appendChild(row);
    });
}

document.getElementById('back-btn').onclick = () => {
    document.getElementById('stations-grid').classList.remove('hidden');
    document.getElementById('station-view').classList.add('hidden');
    document.getElementById('back-btn').classList.add('hidden');
};

init();