const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], currentStation = null, refreshInterval = null;
let delayHistory = {}, expandedTrains = new Set();
let isAutoAnnounce = false, announcementQueue = [], isSpeaking = false, announcedTrains = new Set();
let isFirstLoad = true;

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ'); }, 1000);

// Inicializace
async function init() {
    const data = await fetchData(API_STATIONS);
    if (data?.data) {
        allStations = data.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
}
init();

// Globální hledání stanice
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

// GLOBÁLNÍ HLEDÁNÍ VLAKU
document.getElementById('train-global-search').oninput = async (e) => {
    const val = e.target.value;
    const resDiv = document.getElementById('global-train-result');
    if (val.length < 2) { resDiv.classList.add('hidden'); return; }

    const [edr, live] = await Promise.all([fetchData(API_EDR), fetchData(API_TRAINS)]);
    const trainLive = live?.data?.find(t => t.TrainNoLocal.toString().includes(val));
    
    if (trainLive) {
        const trainInfo = edr.find(t => t.trainNoLocal === trainLive.TrainNoLocal);
        const currentStop = trainInfo?.timetable[trainLive.TrainData.VDDelayedTimetableIndex];
        resDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div><strong class="cyan" style="font-size:1.3rem;">${trainLive.TrainName}</strong><br>Aktuálně ve stanici: <b class="accent-green">${currentStop?.nameForPerson || 'Na cestě'}</b></div>
                <div style="text-align:right">
                    <span style="color:${trainLive.TrainData.Delay > 0 ? 'red' : 'green'}">Zpoždění: ${trainLive.TrainData.Delay} min</span><br>
                    <button class="glass-btn" style="margin-top:10px" onclick="openBoard('${currentStop?.nameForPerson}')">PŘEJÍT NA DISPEČINK</button>
                </div>
            </div>`;
        resDiv.classList.remove('hidden');
    } else {
        resDiv.innerHTML = "Vlak s tímto číslem nebyl na serveru nalezen...";
    }
};

// LOGIKA DISPEČINKU
async function openBoard(name) {
    if (!name) return;
    currentStation = name; isFirstLoad = true;
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    await updateBoardData();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(updateBoardData, 15000);
}

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
        let currIdx = live?.TrainData?.VDDelayedTimetableIndex || -1;
        
        const trend = getTrend(item.trainNoLocal, delay);
        const isExpanded = expandedTrains.has(item.trainNoLocal.toString());

        body.innerHTML += `
            <div class="train-row ${currIdx === stop.indexOfPoint ? 'row-at-station' : (currIdx > stop.indexOfPoint ? 'row-departed' : '')}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? new Date(stop.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}<br><span class="cyan">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}"><b>${delay > 0 ? '+'+delay : 'VČAS'}</b> ${trend}</div>
                <div>${currIdx === stop.indexOfPoint ? 'VE STANICI' : (currIdx > stop.indexOfPoint ? 'ODJEL' : 'PŘIJEDE')}</div>
            </div>
            <div id="det-${item.trainNoLocal}" class="train-detail ${isExpanded ? '' : 'hidden'}">
                <div class="tt-grid tt-header"><div>Příjezd</div><div>Odjezd</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map((s, idx) => `
                    <div class="tt-grid ${idx === currIdx ? 'current-pos' : ''}">
                        <div>${s.arrivalTime ? new Date(s.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</div>
                        <div>${s.departureTime ? new Date(s.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</div>
                        <div>${s.nameForPerson} ${idx === currIdx ? ' 📍' : ''}</div>
                        <div>${s.platform || ''}</div>
                    </div>`).join('')}
            </div>`;
    });

    if (isFirstLoad) {
        const active = body.querySelector('.row-at-station') || body.querySelector('.train-row:not(.row-departed)');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
    updateAnnUI();
}

// TRENDY A ROZBALOVÁNÍ
function getTrend(id, delay) {
    const last = delayHistory[id];
    delayHistory[id] = delay;
    if (last === undefined || last === delay) return '=';
    return delay > last ? '<span class="trend-up">↗️</span>' : '<span class="trend-down">↘️</span>';
}

function toggleTrain(id) {
    const el = document.getElementById(`det-${id}`);
    if (expandedTrains.has(id)) { expandedTrains.delete(id); el.classList.add('hidden'); }
    else { expandedTrains.add(id); el.classList.remove('hidden'); }
}

function getCleanName(tt, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < tt.length) {
        const n = tt[i].nameForPerson;
        if (!["PZS", "R145", "R154", "Głowice"].some(p => n.includes(p))) return n;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Cíl";
}

// TTS HLÁŠENÍ
function announce(text) {
    if (!text) return;
    announcementQueue.push(text);
    if (!isSpeaking) processQueue();
}

function processQueue() {
    if (announcementQueue.length === 0) { isSpeaking = false; return; }
    isSpeaking = true;
    const msg = new SpeechSynthesisUtterance(announcementQueue.shift());
    msg.lang = 'cs-CZ'; msg.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    msg.voice = voices.find(v => v.name.includes("Vlasta") || v.name.includes("Antonin")) || voices.find(v => v.lang === "cs-CZ");
    msg.onend = () => setTimeout(processQueue, 1000);
    window.speechSynthesis.speak(msg);
}

const formatNum = (n) => n.toString().split('').join(' ');
const getArrText = (t, s) => `Vážení cestující. Vlak ${t.trainName.split(' ')[0]} číslo ${formatNum(t.trainNoLocal)} ze stanice ${getCleanName(t.timetable, t.timetable.indexOf(s), -1)} přijede k nástupišti číslo ${s.platform || 'jedna'} kolej ${s.track || 'jedna'}. Vlak dále pokračuje ve směru ${t.endStation}. Pravidelný příjezd v ${new Date(s.arrivalTime).getHours()} hodin a ${new Date(s.arrivalTime).getMinutes()} minut. Upozorňujeme cestující, nevstupujte do kolejiště před zastavením vlaku.`;
const getDepText = (t, s) => `Vážení cestující, vlak ${t.trainName.split(' ')[0]} číslo ${formatNum(t.trainNoLocal)} do stanice ${t.endStation} na nástupišti číslo ${s.platform || 'jedna'} kolej ${s.track || 'jedna'} je připraven k odjezdu.`;

function updateAnnUI() {
    const arrC = document.getElementById('arrivals-queue'), depC = document.getElementById('departures-queue');
    if (!arrC) return; arrC.innerHTML = ""; depC.innerHTML = "";
    window.lastTrains.forEach(t => {
        const stop = t.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === t.trainNoLocal);
        if (!live || (stop.arrivalTime === null && stop.departureTime === null)) return;
        const isAt = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint;
        const isApp = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint - 1;
        if (isApp || isAt) {
            arrC.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button onclick="announce(getArrText(window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}), window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}).timetable.find(s=>s.nameForPerson.includes(currentStation))))">🔊</button></div>`;
            if (isAutoAnnounce && isApp && !announcedTrains.has(t.trainNoLocal+"_a")) { announce(getArrText(t, stop)); announcedTrains.add(t.trainNoLocal+"_a"); }
        }
        if (isAt) {
            depC.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button onclick="announce(getDepText(window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}), window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}).timetable.find(s=>s.nameForPerson.includes(currentStation))))">🔊</button></div>`;
            if (isAutoAnnounce && !announcedTrains.has(t.trainNoLocal+"_d")) { announce(getDepText(t, stop)); announcedTrains.add(t.trainNoLocal+"_d"); }
        }
    });
}

// RETRO TABULE
document.getElementById('view-toggle').onclick = () => {
    const modal = document.getElementById('board-modal'), container = document.getElementById('modal-board-container');
    modal.classList.remove('hidden');
    const stopping = window.lastTrains.filter(t => t.timetable.find(s => s.nameForPerson.includes(currentStation)).departureTime !== null).slice(0, 8);
    container.innerHTML = `<div class="board-header-row" style="color:#888; font-size:0.8rem; margin-bottom:10px;"><span>DRUH</span><span>ČÍSLO</span><span>CÍLOVÁ STANICE</span><span>PŘES</span><span>NÁST.</span><span>KOL.</span><span>ODJEZD</span><span>ZPOŽ.</span></div>`;
    stopping.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const type = item.trainName.includes("Os") ? "board-os" : "board-fast";
        container.innerHTML += `<div class="board-row ${type}">
            <span>${item.trainName.split(' ')[0]}</span><span>${item.trainNoLocal}</span>
            <span>${item.endStation.toUpperCase()}</span><span>${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</span>
            <span class="board-orange">${stop.platform || ''}</span><span class="board-orange">${stop.track || ''}</span>
            <span class="board-orange">${new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</span>
            <span style="color:red">${window.lastLive?.data?.find(l=>l.TrainNoLocal===item.trainNoLocal)?.TrainData?.Delay || ''}</span>
        </div>`;
    });
};

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('announcement-btn').onclick = () => document.getElementById('announcement-modal').classList.remove('hidden');
document.getElementById('auto-ann-toggle').onclick = function() {
    isAutoAnnounce = !isAutoAnnounce; this.innerText = `AUTOMATICKÉ HLÁŠENÍ: ${isAutoAnnounce ? 'ZAPNUTO' : 'VYPNUTO'}`; this.classList.toggle('active');
};
document.getElementById('back-btn').onclick = () => location.reload();