import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const PORT = process.env.PORT || 10000;
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || "baden";

// optional: Logs schützen (empfohlen!). Wenn gesetzt, brauchst du ?token=...
const LOG_TOKEN = process.env.LOG_TOKEN || "";
const MAX_LOGS = Number(process.env.MAX_LOGS || 2000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

/* =========================
   SIMPLE IN-MEMORY LOG
========================= */
const logs = [];
function addLog(evt) {
    const row = {
        ts: new Date().toISOString(),
        ...evt,
    };
    logs.push(row);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

function requireToken(req, res, next) {
    if (!LOG_TOKEN) return next(); // unprotected if not configured
    const token = req.query.token || req.headers["x-log-token"];
    if (token === LOG_TOKEN) return next();
    res.status(401).send("Unauthorized");
}

function htmlEscape(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================
   ROUTES
========================= */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});

app.get("/controller", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});

// optional multi-room controller page
app.get("/r/:room", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});

// logs pages
app.get("/logs", requireToken, (req, res) => {
    const rows = logs.slice().reverse().slice(0, 500); // show last 500
    const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Pong Logs</title>
  <style>
    body{font-family:system-ui;margin:20px;background:#0b1020;color:#eaf0ff}
    a{color:#5eead4}
    .muted{opacity:.7}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid rgba(255,255,255,.12);padding:10px 8px;text-align:left;vertical-align:top}
    th{font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
    .pill{display:inline-block;border:1px solid rgba(255,255,255,.16);padding:2px 8px;border-radius:999px;font-size:12px;opacity:.9}
    .wrap{white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
  <h1>Pong Logs</h1>
  <div class="muted">Zeigt die letzten ${rows.length} Einträge (max 500 im UI). JSON: <a href="/logs.json${LOG_TOKEN ? `?token=${encodeURIComponent(req.query.token || "")}` : ""}">/logs.json</a></div>
  <table>
    <thead>
      <tr><th>Zeit (UTC)</th><th>Room</th><th>Event</th><th>Details</th></tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td class="muted">${htmlEscape(r.ts)}</td>
          <td><span class="pill">${htmlEscape(r.room || "-")}</span></td>
          <td><b>${htmlEscape(r.type || "-")}</b></td>
          <td class="wrap">${htmlEscape(JSON.stringify(r.data || {}, null, 2))}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>`;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(html);
});

app.get("/logs.json", requireToken, (req, res) => {
    res.json({ count: logs.length, logs: logs.slice().reverse() });
});

/* =========================
   WS RELAY
========================= */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map();
function getRoom(room) {
    if (!rooms.has(room)) rooms.set(room, { renderer: null, controllers: new Map() });
    return rooms.get(room);
}
function safeSend(ws, obj) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
}
function newCid() {
    return crypto.randomBytes(8).toString("hex");
}
function parseRoom(reqUrl) {
    try {
        const u = new URL(reqUrl, "http://x");
        return (u.searchParams.get("room") || DEFAULT_ROOM).trim() || DEFAULT_ROOM;
    } catch {
        return DEFAULT_ROOM;
    }
}
function getClientIp(req) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
    return req.socket?.remoteAddress || "";
}

wss.on("connection", (ws, req) => {
    const ip = getClientIp(req);

    let role = null;
    try {
        const u = new URL(req.url, `http://${req.headers.host}`);
        role = u.searchParams.get("role");
    } catch { }

    const room = parseRoom(req.url);
    if (!role) return ws.close();

    const R = getRoom(room);

    if (role === "renderer") {
        if (R.renderer && R.renderer !== ws) { try { R.renderer.close(); } catch { } }
        R.renderer = ws;

        addLog({ type: "renderer_connected", room, data: { ip } });

        safeSend(ws, { type: "hello", role: "renderer", room });
        for (const c of R.controllers.values()) safeSend(c, { type: "renderer", online: true });

        ws.on("message", (buf) => {
            let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

            // log interesting renderer events (optional)
            if (msg?.type === "game_event") {
                addLog({ type: "game_event", room, data: msg.data || {} });
            }

            // renderer -> all controllers
            for (const c of R.controllers.values()) safeSend(c, msg);
        });

        ws.on("close", () => {
            if (R.renderer === ws) R.renderer = null;
            addLog({ type: "renderer_disconnected", room, data: { ip } });
            for (const c of R.controllers.values()) safeSend(c, { type: "renderer", online: false });
        });

        return;
    }

    if (role !== "controller") return ws.close();

    const cid = newCid();
    R.controllers.set(cid, ws);

    addLog({ type: "controller_connected", room, data: { cid, ip } });

    safeSend(ws, { type: "hello", role: "controller", room, cid });
    safeSend(ws, { type: "renderer", online: !!R.renderer });
    if (R.renderer) safeSend(R.renderer, { type: "connect", cid });

    ws.on("message", (buf) => {
        let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

        // log some controller actions (privacy: keep it minimal)
        if (msg?.type === "mode" || msg?.type === "start" || msg?.type === "ready" || msg?.type === "claim") {
            addLog({ type: `controller_${msg.type}`, room, data: { cid, ...msg } });
        }

        if (R.renderer) safeSend(R.renderer, { type: "input", cid, msg });
    });

    ws.on("close", () => {
        R.controllers.delete(cid);
        addLog({ type: "controller_disconnected", room, data: { cid, ip } });
        if (R.renderer) safeSend(R.renderer, { type: "disconnect", cid });
    });
});

server.listen(PORT, () => console.log("Cloud listening on", PORT, "default room =", DEFAULT_ROOM));
