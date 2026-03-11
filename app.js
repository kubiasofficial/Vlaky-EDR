const SERVER = "cz1";
const API_STATIONS = `/api-simrail/stations-open?serverCode=${SERVER}`;
const API_TRAINS = `/api-simrail/trains-open?serverCode=${SERVER}`;
const API_EDR = `/api-aws/getEDRTimetables?serverCode=${SERVER}`;

let allStations = [], currentStation = null, refreshInterval = null;
let isAutoAnnounce = false, announcementQueue = [], isSpeaking = false, announcedTrains = new Set();
const TECH_POINTS = ["PZS", "R145", "R154", "Głowice"];

async function fetchData(url) { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } }

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('cs-CZ'); }, 1000);

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
        card.innerHTML = `<img src="${st.MainImageURL}" style="width:100%;height:100%;object-fit:cover;filter:brightness(1.2);"><h3>${st.Name}</h3>`;
        card.onclick = () => openBoard(st.Name);
        grid.appendChild(card);
    });
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function doesTrainStop(train, stationName) {
    const stop = train.timetable.find(s => s.nameForPerson.includes(stationName));
    return stop && (stop.arrivalTime !== null || stop.departureTime !== null);
}

function getCleanName(timetable, idx, dir) {
    let i = idx + dir;
    while (i >= 0 && i < timetable.length) {
        const n = timetable[i].nameForPerson;
        if (!TECH_POINTS.some(p => n.includes(p))) return n;
        i += dir;
    }
    return dir === -1 ? "Výchozí stanice" : "Konečná stanice";
}

// --- TTS LOGIKA ---
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

const getArrivalText = (t, stop) => {
    const trainNum = t.trainNoLocal.toString().split('').join(' ');
    const from = getCleanName(t.timetable, t.timetable.indexOf(stop), -1);
    const arrTime = new Date(stop.arrivalTime);
    return `Vážení cestující. Vlak ${t.trainName.split(' ')[0]} číslo ${trainNum} ze stanice ${from} přijede k nástupišti číslo ${stop.platform || 'jedna'} kolej ${stop.track || 'jedna'}. Vlak dále pokračuje ve směru ${t.endStation}. Pravidelný příjezd v ${arrTime.getHours()} hodin a ${arrTime.getMinutes()} minut. Upozorňujeme cestující, nevstupujte do kolejiště před zastavením vlaku.`;
};

const getDepartureText = (t, stop) => {
    const trainNum = t.trainNoLocal.toString().split('').join(' ');
    return `Vážení cestující, vlak ${t.trainName.split(' ')[0]} číslo ${trainNum} do stanice ${t.endStation} na nástupišti číslo ${stop.platform || 'jedna'} kolej ${stop.track || 'jedna'} je připraven k odjezdu.`;
};

async function openBoard(name) {
    currentStation = name;
    document.getElementById('st-name').innerText = name;
    document.getElementById('stations-grid').classList.add('hidden');
    document.getElementById('station-view').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    document.getElementById('view-toggle').classList.remove('hidden');
    document.getElementById('announcement-btn').classList.remove('hidden');
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
        let rowClass = "row-arrival", status = "PŘIJEDE";

        if (live?.TrainData?.VDDelayedTimetableIndex === stop.indexOfPoint) { rowClass = "row-at-station"; status = "VE STANICI"; }
        else if (live?.TrainData?.VDDelayedTimetableIndex > stop.indexOfPoint) { rowClass = "row-departed"; status = "ODJEL"; }

        body.innerHTML += `<div class="train-row ${rowClass}">
            <div>${stop.arrivalTime ? new Date(stop.arrivalTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}<br><span style="color:var(--neon-cyan)">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span></div>
            <div><b>${item.trainName}</b></div>
            <div>${getCleanName(item.timetable, item.timetable.indexOf(stop), -1)}</div>
            <div><b>${item.endStation}</b></div>
            <div>${stop.platform || '-'}/${stop.track || '-'}</div>
            <div style="color:${delay > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">${delay > 0 ? '+'+delay : 'VČAS'}</div>
            <div>${status}</div>
        </div>`;
    });
    updateAnnUI();
}

function updateAnnUI() {
    const arrCont = document.getElementById('arrivals-queue'), depCont = document.getElementById('departures-queue');
    if (!arrCont) return;
    arrCont.innerHTML = ""; depCont.innerHTML = "";

    window.lastTrains.forEach(t => {
        const stop = t.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === t.trainNoLocal);
        if (!live || !doesTrainStop(t, currentStation)) return;

        const isAtStation = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint;
        const isApproaching = live.TrainData.VDDelayedTimetableIndex === stop.indexOfPoint - 1;

        if (isApproaching || isAtStation) {
            arrCont.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button class="btn-speak" onclick="announce(getArrivalText(window.lastTrains.find(tr=>tr.trainNoLocal==='${t.trainNoLocal}'), window.lastTrains.find(tr=>tr.trainNoLocal==='${t.trainNoLocal}').timetable.find(s=>s.nameForPerson.includes(currentStation))))">🔊</button></div>`;
            if (isAutoAnnounce && isApproaching && !announcedTrains.has(t.trainNoLocal + "_arr")) {
                announce(getArrivalText(t, stop)); announcedTrains.add(t.trainNoLocal + "_arr");
            }
        }
        if (isAtStation) {
            depCont.innerHTML += `<div class="ann-item"><span>${t.trainName}</span><button class="btn-speak" onclick="announce(getDepartureText(window.lastTrains.find(tr=>tr.trainNoLocal==='${t.trainNoLocal}'), window.lastTrains.find(tr=>tr.trainNoLocal==='${t.trainNoLocal}').timetable.find(s=>s.nameForPerson.includes(currentStation))))">🔊</button></div>`;
            if (isAutoAnnounce && !announcedTrains.has(t.trainNoLocal + "_dep")) {
                announce(getDepartureText(t, stop)); announcedTrains.add(t.trainNoLocal + "_dep");
            }
        }
    });
}

document.getElementById('view-toggle').onclick = () => {
    const modal = document.getElementById('board-modal'), container = document.getElementById('modal-board-container');
    modal.classList.remove('hidden');
    const next8 = window.lastTrains.filter(t => doesTrainStop(t, currentStation)).slice(0, 8);
    container.innerHTML = `<div class="board-header-row"><span>Druh</span><span>Číslo</span><span>CÍLOVÁ STANICE</span><span>Přes</span><span>Nás.</span><span>Kol.</span><span>Prav. odjezd</span><span>Zpož.</span></div>`;
    next8.forEach(item => {
        const stop = item.timetable.find(s => s.nameForPerson.includes(currentStation));
        const live = window.lastLive?.data?.find(lt => lt.TrainNoLocal === item.trainNoLocal);
        const type = item.trainName.split(" ")[0].toLowerCase();
        container.innerHTML += `<div class="board-row">
            <span class="board-${type}">${type.toUpperCase()}</span><span class="board-${type}">${item.trainNoLocal}</span>
            <span class="board-${type}">${item.endStation.toUpperCase()}</span><span>${getCleanName(item.timetable, item.timetable.indexOf(stop), 1)}</span>
            <span class="board-orange">${stop.platform || ''}</span><span class="board-orange">${stop.track || ''}</span>
            <span class="board-orange">${stop.departureTime ? new Date(stop.departureTime).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
            <span style="color:red">${live?.TrainData?.Delay || ''}</span>
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