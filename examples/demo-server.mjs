import { createServer } from "node:http";
import { createHash } from "node:crypto";

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo shop · Easy Sniff</title><style>
body{background:#f4f6f1;color:#1c3023;font:17px system-ui;margin:0;padding:64px;max-width:960px}small{letter-spacing:2px;color:#60735e}h1{font-size:48px;margin:16px 0}p{line-height:1.6;color:#60735e}button{font:inherit;background:#1e402a;color:white;border:0;border-radius:7px;padding:14px 22px;margin:8px 12px 8px 0;cursor:pointer}pre{background:white;border:1px solid #cbd7c7;border-radius:10px;padding:24px;white-space:pre-wrap}#status{font-weight:600}#events{color:#365437}footer{margin-top:36px;font-size:13px;color:#60735e}</style>
<small>LOCAL QA DEMO / FICTIONAL DATA</small><h1>A small bug. The whole story.</h1><p>Use this page to capture a request, test an HTTP mock, and inspect a WebSocket event. No account or API key needed.</p>
<button id="load">Load items</button><button id="save">Save changes</button><button id="event">Send socket event</button><p id="status">Ready to test.</p><pre id="result">Click Load items to make a request.</pre><pre id="events">WebSocket connecting…</pre><footer>All names and payloads are made up. This server binds to localhost only.</footer>
<script>
const result=document.getElementById('result'),status=document.getElementById('status'),events=document.getElementById('events');
async function request(path,options){status.textContent='Loading…';try{const response=await fetch(path,options);const body=await response.json();result.textContent=JSON.stringify(body,null,2);status.textContent=response.ok?'Request succeeded.':'Request failed: HTTP '+response.status;if(!response.ok)console.error('Demo save failed',response.status)}catch(error){status.textContent='Network error';console.error(error)}}
document.getElementById('load').onclick=()=>request('/api/items');document.getElementById('save').onclick=()=>request('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Release checklist',completed:true})});
const socket=new WebSocket('ws://'+location.host+'/events');socket.onopen=()=>events.textContent='WebSocket connected. Send a test event.';socket.onmessage=event=>events.textContent=JSON.stringify(JSON.parse(event.data),null,2);document.getElementById('event').onclick=()=>socket.send(JSON.stringify({type:'comment_added',text:'Please check the empty state',author:'Demo tester'}));
</script></html>`;
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/api/items") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        items: [
          { id: 1, title: "Release checklist", completed: false },
          { id: 2, title: "Empty-state test", completed: true },
        ],
      }),
    );
  } else if (req.url === "/api/save") {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Demo save failed", code: "DEMO_ERROR" }));
  } else if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(page);
  }
});
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(
      req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n",
  );
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0] & 15;
      const masked = !!(pending[1] & 128);
      let size = pending[1] & 127,
        offset = 2;
      if (size === 127) {
        socket.destroy();
        return;
      }
      if (size === 126) {
        if (pending.length < 4) return;
        size = pending.readUInt16BE(2);
        offset = 4;
      }
      const maskSize = masked ? 4 : 0;
      if (pending.length < offset + maskSize + size) return;
      const mask = pending.subarray(offset, offset + maskSize);
      const payload = Buffer.from(
        pending.subarray(offset + maskSize, offset + maskSize + size),
      );
      if (masked)
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      pending = pending.subarray(offset + maskSize + size);
      if (opcode === 8) {
        socket.end(Buffer.from([0x88, 0]));
        return;
      }
      if (opcode !== 1 && opcode !== 9) continue;
      const head = Buffer.alloc(payload.length < 126 ? 2 : 4);
      head[0] = opcode === 9 ? 0x8a : 0x81;
      head[1] = payload.length < 126 ? payload.length : 126;
      if (head.length === 4) head.writeUInt16BE(payload.length, 2);
      socket.write(Buffer.concat([head, payload]));
    }
  });
  socket.on("error", () => {});
});
server.listen(4318, "127.0.0.1", () =>
  console.log("Demo: http://127.0.0.1:4318"),
);
