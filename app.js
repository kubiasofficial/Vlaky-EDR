const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_POSITIONS = `/api-simrail/train-positions-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], cachedEDR = null, currentStation = null;
let delayHistory = {}, expandedTrains = new Set();
let isFirstLoad = true;
let isAutoAnnounce = false, announcementQueue = [], isSpeaking = false, announcedTrains = new Set();

function norm(str) {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, 'l').replace(/\s+/g, '');
}

const fetchData = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };

// Hodiny
setInterval(() => { 
    const c = document.getElementById('clock');
    if (c) c.innerText = new Date().toLocaleTimeString('cs-CZ'); 
}, 1000);

async function init() {
    const [stData, edrData] = await Promise.all([fetchData(API_STATIONS), fetchData(API_EDR)]);
    if (stData?.data) {
        allStations = stData.data.sort((a,b) => a.Name.localeCompare(b.Name));
        renderStations(allStations);
    }
    if (edrData) cachedEDR = edrData;
}
init();

function renderStations(stations) {
    const grid = document.getElementById('stations-grid');
    if (!grid) return;
    grid.innerHTML = stations.map(st => `
        <div class="st-card" onclick="openBoard('${st.Name.replace(/'/g, "\\'")}')">${st.Name}</div>
    `).join('');
}

// Vyhledávání stanic
document.getElementById('station-search').oninput = (e) => {
    const val = norm(e.target.value);
    renderStations(allStations.filter(st => norm(st.Name).includes(val)));
};

// Vyhledávání vlaku
document.getElementById('train-global-search').oninput = async (e) => {
    const val = e.target.value;
    const resDiv = document.getElementById('global-train-result');
    if (val.length < 2 || !cachedEDR) { resDiv.classList.add('hidden'); return; }

    const live = await fetchData(API_TRAINS);
    const trainLive = live?.data?.find(t => t.TrainNoLocal.toString().includes(val));
    
    if (trainLive) {
        const trainInfo = cachedEDR.find(t => t.trainNoLocal === trainLive.TrainNoLocal);
        const currentStop = trainInfo?.timetable.find(s => s.indexOfPoint === trainLive.TrainData.VDDelayedTimetableIndex);
        resDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#1a242f; padding:15px; border:1px solid var(--accent-blue); margin-top:10px; border-radius:5px;">
                <div style="text-align:left;"><b style="color:var(--neon-cyan)">${trainLive.TrainName}</b><br>Aktuálně v: <b>${currentStop?.nameForPerson || 'Na trati'}</b></div>
                <button class="glass-btn" onclick="openBoard('${currentStop?.nameForPerson}')">ZOBRAZIT STANICI</button>
            </div>`;
        resDiv.classList.remove('hidden');
    }
};

async function openBoard(name) {
    if (!name || name === "Na trati") return;
    currentStation = name; isFirstLoad = true;
    document.getElementById('st-name').innerText = name.toUpperCase();
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    updateLoop();
}

async function updateLoop() {
    if (!currentStation) return;
    const [liveData, posData] = await Promise.all([fetchData(API_TRAINS), fetchData(API_POSITIONS)]);
    renderTable(liveData, posData);
    setTimeout(updateLoop, 15000);
}

function renderTable(liveData, posData) {
    if (!cachedEDR || !currentStation) return;
    const body = document.getElementById('departures-body');
    const normTarget = norm(currentStation);
    
    const trains = cachedEDR.filter(t => t.timetable.some(s => norm(s.nameForPerson).includes(normTarget)))
        .sort((a,b) => {
            const sA = a.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
            const sB = b.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
            return new Date(sA.departureTime || sA.arrivalTime) - new Date(sB.departureTime || sB.arrivalTime);
        });

    window.lastTrains = trains; window.lastLive = liveData;
    let html = "";
    
    trains.forEach(item => {
        const stop = item.timetable.find(s => norm(s.nameForPerson).includes(normTarget));
        const live = liveData?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const pos = posData?.data?.find(p => p.id === live?.Id);
        
        const speed = pos ? Math.round(pos.Velocity) : 0;
        const delay = live?.TrainData?.Delay || 0;
        const currIdx = live?.TrainData?.VDDelayedTimetableIndex ?? -1;
        
        let status = "PŘIJEDE", rowClass = "";
        
        // LOGIKA BAREV PODLE INDEXU A RYCHLOSTI
        if (currIdx === stop.indexOfPoint) {
            status = speed < 5 ? "VE STANICI" : "PROJÍŽDÍ";
            rowClass = "row-at-station";
        } else if (currIdx === stop.indexOfPoint + 1) {
            status = "ODJÍŽDÍ"; 
            rowClass = "row-departing";
        } else if (currIdx > stop.indexOfPoint) {
            status = "ODJEL"; 
            rowClass = "row-departed";
        }

        const isExp = expandedTrains.has(item.trainNoLocal.toString());
        html += `
            <div class="train-row ${rowClass}" onclick="toggleTrain('${item.trainNoLocal}')">
                <div>${stop.arrivalTime ? fmt(stop.arrivalTime) : '--:--'}<br><span style="color:var(--neon-cyan)">${stop.departureTime ? fmt(stop.departureTime) : '--:--'}</span></div>
                <div><b>${item.trainName}</b></div>
                <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
                <div><b>${item.endStation}</b></div>
                <div>${stop.platform || '-'}/${stop.track || '-'}</div>
                <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">+${delay} min ${getTrend(item.trainNoLocal, delay)}</div>
                <div><b>${status}</b></div>
            </div>
            <div id="det-${item.trainNoLocal}" class="train-detail ${isExp ? '' : 'hidden'}">
                <div class="speed-badge">GPS Rychlost: <span style="color:var(--accent-green)">${speed} km/h</span></div>
                <div class="tt-grid" style="color:var(--accent-blue); font-weight:bold; border-bottom:1px solid #333;"><div>Příj.</div><div>Odj.</div><div>Stanice</div><div>Nást.</div></div>
                ${item.timetable.map(s => `
                    <div class="tt-grid ${s.indexOfPoint === currIdx ? 'current-pos' : ''}">
                        <div>${s.arrivalTime ? fmt(s.arrivalTime) : '--:--'}</div>
                        <div>${s.departureTime ? fmt(s.departureTime) : '--:--'}</div>
                        <div>${s.nameForPerson} ${s.indexOfPoint === currIdx ? '📍' : ''}</div>
                        <div>${s.platform || ''}</div>
                    </div>`).join('')}
            </div>`;
    });
    body.innerHTML = html;

    if (isFirstLoad) {
        const active = body.querySelector('.row-at-station') || body.querySelector('.row-departing') || body.querySelector('.train-row:not(.row-departed)');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        isFirstLoad = false;
    }
    updateAnnUI();
}

function getTrend(id, delay) {
    const last = delayHistory[id]; delayHistory[id] = delay;
    if (last === undefined || last === delay) return "";
    return delay > last ? "↗️" : "↘️";
}

function toggleTrain(id) {
    const el = document.getElementById(`det-${id}`);
    if (expandedTrains.has(id.toString())) { expandedTrains.delete(id.toString()); el.classList.add('hidden'); }
    else { expandedTrains.add(id.toString()); el.classList.remove('hidden'); }
}

const fmt = (d) => new Date(d).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});

function getCleanName(tt, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < tt.length) {
        if (!["PZS", "R145", "R154", "Głowice"].some(p => tt[i].nameForPerson.includes(p))) return tt[i].nameForPerson;
        i += dir;
    }
    return dir === -1 ? "Výchozí" : "Cíl";
}

// --- HLÁŠENÍ (TTS) ---
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
    msg.onend = () => setTimeout(processQueue, 1000);
    window.speechSynthesis.speak(msg);
}

const formatNum = (n) => n.toString().split('').join(' ');
const getArrText = (t, s) => `Vážení cestující. Vlak ${t.trainName.split(' ')[0]} číslo ${formatNum(t.trainNoLocal)} ze stanice ${getCleanName(t.timetable, t.timetable.indexOf(s), -1)} přijede k nástupišti číslo ${s.platform || 'jedna'} kolej ${s.track || 'jedna'}. Vlak dále pokračuje ve směru ${t.endStation}.`;
const getDepText = (t, s) => `Vážení cestující, vlak ${t.trainName.split(' ')[0]} číslo ${formatNum(t.trainNoLocal)} do stanice ${t.endStation} na nástupišti číslo ${s.platform || 'jedna'} kolej ${s.track || 'jedna'} je připraven k odjezdu.`;

function updateAnnUI() {
    const arrC = document.getElementById('arrivals-queue'), depC = document.getElementById('departures-queue');
    if (!arrC || !window.lastTrains) return; 
    arrC.innerHTML = ""; depC.innerHTML = "";

    window.lastTrains.forEach(t => {
        const stop = t.timetable.find(s => norm(s.nameForPerson).includes(norm(currentStation)));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === t.trainNoLocal);
        if (!live) return;
        
        const isAt = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint;
        const isApp = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint - 1;
        
        if (isApp || isAt) {
            arrC.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button class="glass-btn" onclick="announce(getArrText(window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}), window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}).timetable.find(s=>norm(s.nameForPerson).includes(norm(currentStation)))))">🔊</button></div>`;
            if (isAutoAnnounce && isApp && !announcedTrains.has(t.trainNoLocal+"_a")) { announce(getArrText(t, stop)); announcedTrains.add(t.trainNoLocal+"_a"); }
        }
        if (isAt) {
            depC.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button class="glass-btn" onclick="announce(getDepText(window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}), window.lastTrains.find(x=>x.trainNoLocal===${t.trainNoLocal}).timetable.find(s=>norm(s.nameForPerson).includes(norm(currentStation)))))">🔊</button></div>`;
            if (isAutoAnnounce && !announcedTrains.has(t.trainNoLocal+"_d")) { announce(getDepText(t, stop)); announcedTrains.add(t.trainNoLocal+"_d"); }
        }
    });
}

// Tlačítka a Modaly
document.getElementById('back-btn').onclick = () => location.reload();
document.getElementById('announcement-btn').onclick = () => document.getElementById('announcement-modal').classList.remove('hidden');
document.getElementById('close-ann').onclick = () => document.getElementById('announcement-modal').classList.add('hidden');
document.getElementById('auto-ann-toggle').onclick = function() {
    isAutoAnnounce = !isAutoAnnounce;
    this.innerText = `AUTOMATICKÉ HLÁŠENÍ: ${isAutoAnnounce ? 'ZAPNUTO' : 'VYPNUTO'}`;
    this.classList.toggle('active');
};
document.getElementById('view-toggle').onclick = () => {
    const modal = document.getElementById('board-modal'), container = document.getElementById('modal-board-container');
    modal.classList.remove('hidden');
    if(!window.lastTrains) return;
    const stopping = window.lastTrains.filter(t => t.timetable.find(s => norm(s.nameForPerson).includes(norm(currentStation))).departureTime !== null).slice(0, 8);
    container.innerHTML = `<div style="display:grid; grid-template-columns: 0.5fr 0.7fr 2fr 1.5fr 0.4fr 0.4fr 1fr 0.5fr; color:#888; font-size:0.8rem; margin-bottom:10px;"><span>TYP</span><span>ČÍSLO</span><span>CÍLOVÁ STANICE</span><span>PŘES</span><span>NÁST.</span><span>KOL.</span><span>ODJEZD</span><span>ZPOŽ.</span></div>`;
    stopping.forEach(item => {
        const stop = item.timetable.find(s => norm(s.nameForPerson).includes(norm(currentStation)));
        const delay = window.lastLive?.data?.find(l=>l.TrainNoLocal===item.trainNoLocal)?.TrainData?.Delay || 0;
        container.innerHTML += `<div style="display:grid; grid-template-columns: 0.5fr 0.7fr 2fr 1.5fr 0.4fr 0.4fr 1fr 0.5fr; padding:12px 0; border-bottom:1px solid #222; font-family:monospace; font-size:1.2rem;">
            <span style="color:${item.trainName.includes('Os') ? 'var(--accent-green)' : 'var(--accent-red)'}">${item.trainName.split(' ')[0]}</span>
            <span>${item.trainNoLocal}</span>
            <span style="color:white; font-weight:bold;">${item.endStation.toUpperCase()}</span>
            <span style="font-size:0.9rem;">${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</span>
            <span style="color:orange;">${stop.platform || ''}</span><span style="color:orange;">${stop.track || ''}</span>
            <span style="color:orange;">${fmt(stop.departureTime)}</span>
            <span style="color:red;">${delay > 0 ? delay : ''}</span>
        </div>`;
    });
};
document.getElementById('close-board').onclick = () => document.getElementById('board-modal').classList.add('hidden');