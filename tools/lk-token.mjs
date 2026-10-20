// Dev only: hands out LiveKit tokens for a local `livekit-server --dev` (keys devkey/secret).
// node tools/lk-token.mjs  → http://127.0.0.1:7890/token?room=...&name=...   (game URL: ?net=lkdev)
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { AccessToken } = require("../game/node_modules/livekit-server-sdk");
const server = process.env.LK_URL || "ws://127.0.0.1:7880";
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (u.pathname !== "/token") return res.writeHead(404).end();
    const room = u.searchParams.get("room") || "test";
    const name = u.searchParams.get("name") || "player";
    const identity = "dev_" + Math.random().toString(36).slice(2, 8);
    const at = new AccessToken("devkey", "secret", { identity, name, ttl: "2h" });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ token: await at.toJwt(), serverUrl: server }));
  })
  .listen(7890, "127.0.0.1", () => console.log("dev token server on :7890"));
