/* =========================
   CONFIG
========================= */
const WEBSITE_URL = "https://stevenschmid.ch"; // <- anpassen falls du willst
const DEFAULT_ROOM = "baden";                   // Cloud DEFAULT_ROOM kann das auch
const COUNTDOWN_SECONDS = 3;

/* =========================
   DOM
========================= */
const wsDot = document.getElementById("wsDot");
const wsBadge = document.getElementById("wsBadge");
const rendererBadge = document.getElementById("rendererBadge");

const screenMode = document.getElementById("screenMode");
const screenPlayer = document.getElementById("screenPlayer");
const screenControl = document.getElementById("screenControl");

const btnPVC = document.getElementById("btnPVC");
const btnPVP = document.getElementById("btnPVP");
const btnWebsite = document.getElementById("btnWebsite");

const playerHeadline = document.getElementById("playerHeadline");
const btnP1 = document.getElementById("btnP1");
const btnP2 = document.getElementById("btnP2");
const btnReady = document.getElementById("btnReady");
const btnBack = document.getElementById("btnBack");

const btnUp = document.getElementById("btnUp");
const btnDown = document.getElementById("btnDown");
const btnPause = document.getElementById("btnPause");

const metaMode = document.getElementById("metaMode");
const metaMe = document.getElementById("metaMe");
const metaMode2 = document.getElementById("metaMode2");
const metaMe2 = document.getElementById("metaMe2");

const overlay = document.getElementById("countdownOverlay");
const countNum = document.getElementById("countNum");
const overlayHint = document.getElementById("overlayHint");

/* =========================
   STATE
========================= */
let ws = null;
let wsOk = false;
let rendererOnline = false;

let room = new URLSearchParams(location.search).get("room") || DEFAULT_ROOM;

// UI mode: "pvc" | "pvp"
let mode = null;

// my side: "p1" | "p2" | null
let me = null;

// lobby state from server
let lobby = {
    mode: "cvc",
    claimed: { p1: false, p2: false },
    ready: { p1: false, p2: false }
};

function setBadgeConnected(ok) {
    wsOk = ok;
    wsDot.style.background = ok ? "#0f9d58" : "#c1121f";
    wsBadge.textContent = ok ? "Verbunden" : "Getrennt";
}

function setRendererOnline(ok) {
    rendererOnline = ok;
    rendererBadge.textContent = ok ? "Renderer: online" : "Renderer: offline";
    rendererBadge.style.opacity = ok ? "1" : ".7";
}

function showScreen(which) {
    screenMode.classList.toggle("hidden", which !== "mode");
    screenPlayer.classList.toggle("hidden", which !== "player");
    screenControl.classList.toggle("hidden", which !== "control");
}

function setMeta() {
    const m = mode ? mode.toUpperCase() : "-";
    const s = me ? me.toUpperCase() : "-";
    metaMode.textContent = `mode: ${m}`;
    metaMe.textContent = `me: ${s}`;
    metaMode2.textContent = `mode: ${m}`;
    metaMe2.textContent = `me: ${s}`;
}

function selectSide(side) {
    me = side;
    btnP1.classList.toggle("selected", side === "p1");
    btnP2.classList.toggle("selected", side === "p2");
    setMeta();
}

function enableReady(enable) {
    btnReady.classList.toggle("disabled", !enable);
}

/* =========================
   WS
========================= */
function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws?role=controller&room=${encodeURIComponent(room)}`;
}

function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function connect() {
    try {
        ws = new WebSocket(wsUrl());
    } catch (e) {
        setBadgeConnected(false);
        return;
    }

    ws.onopen = () => {
        setBadgeConnected(true);
    };

    ws.onclose = () => {
        setBadgeConnected(false);
        setRendererOnline(false);
        setTimeout(connect, 1200);
    };

    ws.onerror = () => {
        // handled by close
    };

    ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === "renderer") {
            setRendererOnline(!!msg.online);
            return;
        }

        if (msg.type === "lobby") {
            lobby = {
                mode: msg.mode || lobby.mode,
                claimed: msg.claimed || lobby.claimed,
                ready: msg.ready || lobby.ready
            };
            applyLobbyToUI();
            return;
        }

        if (msg.type === "start") {
            // renderer says: round starting
            startCountdownThenControls();
            return;
        }

        if (msg.type === "claim_result") {
            // optional feedback; we could show toast later
            return;
        }
    };
}

function applyLobbyToUI() {
    // for pvp: if my chosen side becomes unavailable, reflect it
    if (mode === "pvp") {
        // disable selecting side if already claimed (by someone)
        btnP1.classList.toggle("disabled", lobby.claimed?.p1 && me !== "p1");
        btnP2.classList.toggle("disabled", lobby.claimed?.p2 && me !== "p2");
    } else {
        btnP1.classList.remove("disabled");
        btnP2.classList.remove("disabled");
    }

    // ready button logic
    if (mode === "pvc") {
        enableReady(!!me);
    } else if (mode === "pvp") {
        // allow ready only if side selected and (not already ready)
        enableReady(!!me);
        btnReady.textContent = lobby.ready?.[me] ? "Ready ✓" : "Ready";
        btnReady.classList.toggle("selected", !!lobby.ready?.[me]);
    }

    setMeta();
}

/* =========================
   COUNTDOWN
========================= */
let countdownTimer = null;

function showOverlay(show, hint = "Bitte warten…") {
    overlay.classList.toggle("hidden", !show);
    overlayHint.textContent = hint;
}

function startCountdownThenControls() {
    showOverlay(true, "Spiel startet…");
    let t = COUNTDOWN_SECONDS;
    countNum.textContent = String(t);

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        t -= 1;
        if (t <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            showOverlay(false);
            showScreen("control");
            return;
        }
        countNum.textContent = String(t);
    }, 1000);
}

/* =========================
   INPUT (UP/DOWN)
========================= */
function vibrate(ms = 10) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { }
}

function sendMove(dir) {
    if (!me) return;
    send({ type: "move", who: me, dir });
}

function bindHoldButton(el, dir) {
    const down = (e) => {
        e.preventDefault();
        vibrate(8);
        sendMove(dir);
    };
    const up = (e) => {
        e.preventDefault();
        sendMove(0);
    };

    el.addEventListener("pointerdown", down, { passive: false });
    el.addEventListener("pointerup", up, { passive: false });
    el.addEventListener("pointercancel", up, { passive: false });
    el.addEventListener("pointerleave", up, { passive: false });
}

/* =========================
   UI EVENTS
========================= */
btnWebsite.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(WEBSITE_URL, "_blank", "noopener,noreferrer");
});

btnPVC.addEventListener("click", () => {
    mode = "pvc";
    me = null;
    send({ type: "mode", mode: "pvc" });
    playerHeadline.textContent = "Select Player";
    selectSide(null);
    enableReady(false);
    showScreen("player");
    setMeta();
});

btnPVP.addEventListener("click", () => {
    mode = "pvp";
    me = null;
    send({ type: "mode", mode: "pvp" });
    playerHeadline.textContent = "Select Player";
    selectSide(null);
    enableReady(false);
    showScreen("player");
    setMeta();
});

btnBack.addEventListener("click", () => {
    // reset local UI
    mode = null;
    me = null;
    showOverlay(false);
    showScreen("mode");
    setMeta();
});

btnP1.addEventListener("click", () => {
    selectSide("p1");
    send({ type: "claim", who: "p1" });
    send({ type: "side", who: "p1" });
    applyLobbyToUI();
});

btnP2.addEventListener("click", () => {
    selectSide("p2");
    send({ type: "claim", who: "p2" });
    send({ type: "side", who: "p2" });
    applyLobbyToUI();
});

btnReady.addEventListener("click", () => {
    if (!mode || !me) return;

    if (mode === "pvc") {
        // PVC: direkt starten -> local countdown -> controls
        send({ type: "start" });
        startCountdownThenControls();
        return;
    }

    if (mode === "pvp") {
        // PVP: ready togglen; Start kommt vom renderer wenn beide ready
        const next = !lobby.ready?.[me];
        send({ type: "ready", who: me, ready: next });
        // UI is updated by lobby snapshot
    }
});

bindHoldButton(btnUp, -1);
bindHoldButton(btnDown, +1);

btnPause.addEventListener("click", () => {
    vibrate(12);
    // optional: falls du später Pause implementierst
    send({ type: "control", action: "pause", who: me });
});

/* =========================
   INIT
========================= */
showScreen("mode");
setMeta();
setBadgeConnected(false);
setRendererOnline(false);
connect();
