const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], currentStation = null, refreshInterval = null;
let isAutoAnnounce = false, announcementQueue = [], isSpeaking = false, announcedTrains = new Set();
let isFirstLoad = true;

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ'); }, 1000);

// Načtení a hledání stanic
async function init() {
    const data = await fetchData(API_STATIONS);
    if (data?.data) {
        allStations = data.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
}
init();

document.getElementById('station-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    renderStations(allStations.filter(st => st.Name.toLowerCase().includes(term)));
};

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    grid.innerHTML = "";
    stations.forEach(st => {
        const div = document.createElement('div');
        div.className = 'st-card';
        div.innerText = st.Name;
        div.onclick = () => openBoard(st.Name);
        grid.appendChild(div);
    });
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// --- LOGIKA HLÁŠENÍ (TTS) ---
function announce(text) {
    if (!text) return;
    announcementQueue.push(text);
    if (!isSpeaking) processQueue();
}

function processQueue() {
    if (announcementQueue.length === 0) { isSpeaking = false; return; }
    isSpeaking = true;
    const msg = new SpeechSynthesisUtterance(announcementQueue.shift());
    msg.lang = 'cs-CZ'; msg.rate = 0.88;
    const voices = window.speechSynthesis.getVoices();
    const bestVoice = voices.find(v => v.name.includes("Vlasta") || v.name.includes("Antonin")) || voices.find(v => v.lang === "cs-CZ");
    if (bestVoice) msg.voice = bestVoice;
    msg.onend = () => setTimeout(processQueue, 1200);
    window.speechSynthesis.speak(msg);
}

// Pomocník pro čtení čísel po cifrách
const formatTrainNum = (num) => num.toString().split('').join(' ');

const getArrivalText = (t, stop) => {
    const from = getCleanName(t.timetable, t.timetable.indexOf(stop), -1);
    const arrTime = new Date(stop.arrivalTime);
    return `Vážení cestující. Vlak ${t.trainName.split(' ')[0]} číslo ${formatTrainNum(t.trainNoLocal)} ze stanice ${from} přijede k nástupišti číslo ${stop.platform || 'jedna'} kolej ${stop.track || 'jedna'}. Vlak dále pokračuje ve směru ${t.endStation}. Pravidelný příjezd v ${arrTime.getHours()} hodin a ${arrTime.getMinutes()} minut. Upozorňujeme cestující, nevstupujte do kolejiště před zastavením vlaku.`;
};

const getDepartureText = (t, stop) => {
    return `Vážení cestující, vlak ${t.trainName.split(' ')[0]} číslo ${formatTrainNum(t.trainNoLocal)} do stanice ${t.endStation} na nástupišti číslo ${stop.platform || 'jedna'} kolej ${stop.track || 'jedna'} je připraven k odjezdu.`;
};

// Otevření dispečinku
async function openBoard(name) {
    currentStation = name;
    isFirstLoad = true;
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000);
}

// Funkce pro kontrolu, zda vlak ve stanici zastavuje (není technický průjezd)
const doesTrainStop = (t, stationName) => {
    const stop = t.timetable.find(s => s.nameForPerson.includes(stationName));
    return stop && (stop.arrivalTime !== null || stop.departureTime !== null);
};

// Hlavní update dat s AUTOMATICKÝM FOKUSEM
async function updateBoardData() {
    if (!currentStation) return;
    const [edr, liveData] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const body = document.getElementById('departures-body');
    if (!edr) return;

    const trains = edr.filter(t => t.timetable.some(s => s.nameForPerson.includes(currentStation)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => s.nameForPerson.includes(currentStation));
            const sB = b.timetable.find(s => s.nameForPerson.includes(currentStation));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    window.lastTrains = trains; window.lastLive = liveData;
    body.innerHTML = "";
    
    trains.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        let delay = live?.TrainData?.Delay || 0;
        let rowClass = "", status = "PŘIJEDE";

        if (live?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) { rowClass = "row-at-station"; status = "VE STANICI"; }
        else if (live?.TrainData?.VDDelayedTimetableIndex > stop.indexOfPoint) { rowClass = "row-departed"; status = "ODJEL"; }

        body.innerHTML += `<div class="train-row ${rowClass}">
            <div>${stop.arrivalTime ? new Date(stop.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}<br><span class="cyan">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span></div>
            <div><b>${item.trainName}</b></div>
            <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
            <div><b>${item.endStation}</b></div>
            <div>${stop.platform || '-'}/${stop.track || '-'}</div>
            <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}; font-weight:bold;">${delay > 0 ? '+'+delay+' min' : 'VČAS'}</div>
            <div>${status}</div>
        </div>`;
    });

    // FOKUS: Skok na aktuální vlaky
    if (isFirstLoad) {
        const active = body.querySelector('.row-at-station') || body.querySelector('.train-row:not(.row-departed)');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
    updateAnnUI();
}

function getCleanName(tt, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < tt.length) {
        const name = tt[i].nameForPerson;
        if (!["PZS", "R145", "R154", "Głowice", "Rozjazd"].some(p => name.includes(p))) return name;
        i += dir;
    }
    return dir === -1 ? "Výchozí stanice" : "Konečná stanice";
}

// Aktualizace seznamů pro hlášení
function updateAnnUI() {
    const arrC = document.getElementById('arrivals-queue'), depC = document.getElementById('departures-queue');
    if (!arrC) return; arrC.innerHTML = ""; depC.innerHTML = "";

    window.lastTrains.forEach(t => {
        const stop = t.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === t.trainNoLocal);
        if (!live || !doesTrainStop(t, currentStation)) return;

        const isAtStation = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint;
        const isApproaching = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint - 1;

        if (isApproaching || isAtStation) {
            const div = document.createElement('div'); div.className = 'ann-item';
            div.innerHTML = `<span>${t.trainName}</span><button class="glass-btn">🔊</button>`;
            div.querySelector('button').onclick = () => announce(getArrivalText(t, stop));
            arrC.appendChild(div);
            if (isAutoAnnounce && isApproaching && !announcedTrains.has(t.trainNoLocal + "_a")) { announce(getArrivalText(t, stop)); announcedTrains.add(t.trainNoLocal + "_a"); }
        }
        if (isAtStation) {
            const div = document.createElement('div'); div.className = 'ann-item';
            div.innerHTML = `<span>${t.trainName}</span><button class="glass-btn">🔊</button>`;
            div.querySelector('button').onclick = () => announce(getDepartureText(t, stop));
            depC.appendChild(div);
            if (isAutoAnnounce && !announcedTrains.has(t.trainNoLocal + "_d")) { announce(getDepartureText(t, stop)); announcedTrains.add(t.trainNoLocal + "_d"); }
        }
    });
}

// TABULE
document.getElementById('view-toggle').onclick = () => {
    const modal = document.getElementById('board-modal'), container = document.getElementById('modal-board-container');
    modal.classList.remove('hidden');
    const stoppingTrains = window.lastTrains.filter(t => doesTrainStop(t, currentStation)).slice(0, 8);
    container.innerHTML = `<div class="board-header-row" style="color:#aaa; font-size:0.8rem; text-transform:uppercase;"><span>Druh</span><span>Číslo</span><span>CÍLOVÁ STANICE</span><span>Přes</span><span>Nás.</span><span>Kol.</span><span>Prav. odjezd</span><span>Zpož.</span></div>`;
    stoppingTrains.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const type = item.trainName.includes("Os") || item.trainName.includes("R") ? "board-os" : "board-fast";
        container.innerHTML += `<div class="board-row ${type}">
            <span>${item.trainName.split(' ')[0]}</span><span>${item.trainNoLocal}</span>
            <span>${item.endStation.toUpperCase()}</span><span>${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</span>
            <span class="board-orange">${stop.platform || ''}</span><span class="board-orange">${stop.track || ''}</span>
            <span class="board-orange">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
            <span style="color:var(--accent-red)">${window.lastLive?.data?.find(l=>l.TrainNoLocal===item.trainNoLocal)?.TrainData?.Delay || ''}</span>
        </div>`;
    });
};

document.getElementById('announcement-btn').onclick = () => document.getElementById('announcement-modal').classList.remove('hidden');
document.getElementById('auto-ann-toggle').onclick = function() {
    isAutoAnnounce = !isAutoAnnounce;
    this.innerText = `AUTOMATICKÉ HLÁŠENÍ: ${isAutoAnnounce ? 'ZAPNUTO' : 'VYPNUTO'}`;
    this.classList.toggle('active', isAutoAnnounce);
};
document.getElementById('back-btn').onclick = () => location.reload();