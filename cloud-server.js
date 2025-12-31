import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const PORT = process.env.PORT || 10000;
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || "baden";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Root = default room controller
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});
app.get("/controller", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});

// Optional multi-room (falls du später mehrere Screens willst)
app.get("/r/:room", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "controller.html"));
});

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
    // room can come from ws query ?room= OR default
    try {
        const u = new URL(reqUrl, "http://x");
        return (u.searchParams.get("room") || DEFAULT_ROOM).trim() || DEFAULT_ROOM;
    } catch {
        return DEFAULT_ROOM;
    }
}

wss.on("connection", (ws, req) => {
    const role = (() => {
        try {
            const u = new URL(req.url, `http://${req.headers.host}`);
            return u.searchParams.get("role");
        } catch { return null; }
    })();

    const room = parseRoom(req.url);
    if (!role) return ws.close();

    const R = getRoom(room);

    if (role === "renderer") {
        if (R.renderer && R.renderer !== ws) { try { R.renderer.close(); } catch { } }
        R.renderer = ws;

        safeSend(ws, { type: "hello", role: "renderer", room });
        for (const c of R.controllers.values()) safeSend(c, { type: "renderer", online: true });

        ws.on("message", (buf) => {
            let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
            for (const c of R.controllers.values()) safeSend(c, msg);
        });

        ws.on("close", () => {
            if (R.renderer === ws) R.renderer = null;
            for (const c of R.controllers.values()) safeSend(c, { type: "renderer", online: false });
        });

        return;
    }

    if (role !== "controller") return ws.close();

    const cid = newCid();
    R.controllers.set(cid, ws);

    safeSend(ws, { type: "hello", role: "controller", room, cid });
    safeSend(ws, { type: "renderer", online: !!R.renderer });
    if (R.renderer) safeSend(R.renderer, { type: "connect", cid });

    ws.on("message", (buf) => {
        let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
        if (R.renderer) safeSend(R.renderer, { type: "input", cid, msg });
    });

    ws.on("close", () => {
        R.controllers.delete(cid);
        if (R.renderer) safeSend(R.renderer, { type: "disconnect", cid });
    });
});

server.listen(PORT, () => console.log("Cloud listening on", PORT, "default room =", DEFAULT_ROOM));
