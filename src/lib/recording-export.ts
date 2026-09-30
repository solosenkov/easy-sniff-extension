import type { RecordingSession } from "./recording";

function crc32(bytes: Uint8Array, initial = 0xffffffff) {
  let crc = initial;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}
async function fileCrc(data: Uint8Array | Blob) {
  if (data instanceof Uint8Array) return (crc32(data) ^ 0xffffffff) >>> 0;
  let crc = 0xffffffff;
  for (let offset = 0; offset < data.size; offset += 1024 * 1024) {
    crc = crc32(
      new Uint8Array(
        await data.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      ),
      crc,
    );
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipFiles(
  files: Array<{ name: string; data: string | Blob }>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const size = data instanceof Blob ? data.size : data.length;
    if (size > 0xffffffff) throw new Error("A file exceeds the ZIP size limit");
    const crc = await fileCrc(data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local as BlobPart, data as BlobPart);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, size, true);
    d.setUint32(24, size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir as BlobPart);
    offset += local.length + size;
  }
  const centralSize = central.reduce(
    (sum, part) => sum + (part as Uint8Array).length,
    0,
  );
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
export function reportHtml(session: RecordingSession): string {
  const safeJson = JSON.stringify(session)
    .replace(/</g, "\\u003c")
    .replace(/&/g, "\\u0026");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Easy Sniff · Bug replay</title><style>
*{box-sizing:border-box}body{margin:0;background:#121617;color:#e0e6df;font:14px system-ui,sans-serif}header{padding:28px 4vw;border-bottom:1px solid #303a34}h1{font-size:25px;margin:6px 0}p{color:#9dab9f}main{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:24px;padding:24px 4vw}.video{position:sticky;top:24px;align-self:start}video{width:100%;background:#050606;border:1px solid #364037;border-radius:8px}.timeline{position:relative;height:42px;background:#253029;border-radius:5px;margin-top:16px}.tick{position:absolute;top:0;width:3px;height:100%;background:#b9d893;cursor:pointer}.tick.error{background:#f17e75;width:5px}.tick.warning{background:#e4b96b}.cursor{position:absolute;top:0;height:100%;width:2px;background:#fff;pointer-events:none}.filters{display:flex;gap:6px;margin-bottom:12px}.filters button{background:#222c25;color:#cdd9cc;border:1px solid #3a4a3e;padding:8px 12px;border-radius:5px;cursor:pointer}.filters button.active{background:#bddf9f;color:#152019}.events{max-height:calc(100vh - 175px);overflow:auto}.event{display:block;width:100%;text-align:left;background:#1a211c;border:1px solid #303c33;padding:12px;margin-bottom:5px;border-radius:5px;color:#dfe7dd;cursor:pointer}.event.error{border-left:3px solid #f17e75}.event.warning{border-left:3px solid #e4b96b}.event:hover,.event.current{background:#29372b}.event small{display:block;color:#9daa9d;margin-top:5px;overflow-wrap:anywhere}.time{color:#bddd9d;font-variant-numeric:tabular-nums;margin-right:10px}@media(max-width:900px){main{grid-template-columns:1fr}.video{position:static}.events{max-height:none}}
  </style></head><body><header><small>Easy Sniff / BUG REPLAY</small><h1 id="title"></h1><p id="meta"></p><p>Local report. Review the video for any sensitive data before sharing.</p></header><main><section class="video"><video id="video" controls preload="metadata" src="video.webm"></video><div id="timeline" class="timeline"><span class="cursor" id="cursor"></span></div><p>Click a timeline mark or event to jump to that moment.</p></section><section><div id="filters" class="filters"></div><div id="events" class="events"></div></section></main><script id="report" type="application/json">${safeJson}</script><script>
const data=JSON.parse(document.getElementById('report').textContent),video=document.getElementById('video'),events=document.getElementById('events'),timeline=document.getElementById('timeline'),filters=document.getElementById('filters');
document.getElementById('title').textContent=data.title;document.getElementById('meta').textContent=new Date(data.startedAt).toLocaleString()+' · '+Math.round(((data.endedAt||data.startedAt)-data.startedAt)/1000)+' s · '+data.events.length+' events · '+data.tabUrl;
const duration=Math.max(1,(data.endedAt-data.startedAt)||1);let filter='all';const fmt=ms=>(ms/1000).toFixed(1)+'s';
function seek(ms){const end=Number.isFinite(video.duration)?video.duration:duration/1000;video.currentTime=Math.min(ms/1000,Math.max(0,end-.01));video.play().catch(()=>{});}
function render(){events.replaceChildren();filters.replaceChildren();timeline.querySelectorAll('.tick').forEach(x=>x.remove());for(const type of ['all','errors','network','console','markers']){const b=document.createElement('button');b.textContent=type;b.className=filter===type?'active':'';b.onclick=()=>{filter=type;render()};filters.append(b)}
for(const event of data.events){const match=filter==='all'||filter==='errors'&&event.severity==='error'||filter==='network'&&['request','response','network-error','websocket'].includes(event.kind)||filter==='console'&&['console','exception'].includes(event.kind)||filter==='markers'&&event.kind==='marker';if(!match)continue;const row=document.createElement('button');row.className='event '+event.severity;const top=document.createElement('span');top.className='time';top.textContent=fmt(event.at);row.append(top,document.createTextNode(event.title));if(event.detail){const small=document.createElement('small');small.textContent=event.detail;row.append(small)}row.onclick=()=>seek(event.at);events.append(row);if(event.severity!=='normal'||event.kind==='marker'){const tick=document.createElement('button');tick.className='tick '+event.severity;tick.style.left=Math.min(99.5,100*event.at/duration)+'%';tick.title=fmt(event.at)+' · '+event.title;tick.onclick=()=>seek(event.at);timeline.append(tick)}}}
render();video.addEventListener('loadedmetadata',()=>{if(!Number.isFinite(video.duration)){video.currentTime=1e10;video.addEventListener('seeked',()=>{video.currentTime=0},{once:true})}});video.ontimeupdate=()=>{document.getElementById('cursor').style.left=Math.min(100,video.currentTime*1000/duration)+'%'};
  </script></body></html>`;
}
