import { saveVideo } from "./lib/recording";

let recorder: MediaRecorder | undefined;
let stream: MediaStream | undefined;
let audio: AudioContext | undefined;
let chunks: Blob[] = [];
let currentId = "";
let limitTimer: ReturnType<typeof setTimeout> | undefined;
let stoppingPromise:
  Promise<{ id: string; size: number; mimeType: string }> | undefined;
const mediaTypes = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

async function start(id: string, streamId: string) {
  if (recorder && recorder.state !== "inactive")
    throw new Error("A recording is already running");
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  } as MediaStreamConstraints);
  if (stream.getAudioTracks().length) {
    audio = new AudioContext();
    const source = audio.createMediaStreamSource(stream);
    source.connect(audio.destination);
  }
  const mimeType = mediaTypes.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });
  chunks = [];
  currentId = id;
  stoppingPromise = undefined;
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    void audio?.close();
    stream = undefined;
    audio = undefined;
  };
  recorder.start(1000);
  stream.getVideoTracks()[0]?.addEventListener(
    "ended",
    () => {
      if (recorder?.state === "recording")
        void stop().then((result) =>
          chrome.runtime
            .sendMessage({ type: "recording.media.completed", result })
            .catch(() => {}),
        );
    },
    { once: true },
  );
  limitTimer = setTimeout(() => {
    void stop().then((result) =>
      chrome.runtime
        .sendMessage({ type: "recording.media.completed", result })
        .catch(() => {}),
    );
  }, 5 * 60_000);
  return { mimeType: recorder.mimeType };
}
function stop() {
  if (!stoppingPromise) stoppingPromise = finish();
  return stoppingPromise;
}
async function finish() {
  if (!recorder || recorder.state === "inactive")
    throw new Error("No active video recording");
  if (limitTimer) {
    clearTimeout(limitTimer);
    limitTimer = undefined;
  }
  const active = recorder;
  await new Promise<void>((resolve, reject) => {
    active.addEventListener("stop", () => resolve(), { once: true });
    active.addEventListener("error", (event) => reject(event), { once: true });
    active.stop();
  });
  const video = new Blob(chunks, { type: active.mimeType });
  await saveVideo(currentId, video);
  const result = { id: currentId, size: video.size, mimeType: active.mimeType };
  recorder = undefined;
  chunks = [];
  currentId = "";
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !["recording.media.start", "recording.media.stop"].includes(message.type)
  )
    return;
  void (
    message.type === "recording.media.start"
      ? start(message.id, message.streamId)
      : stop()
  )
    .then((data) => reply({ ok: true, data }))
    .catch((error) =>
      reply({ ok: false, error: String(error?.message || error) }),
    );
  return true;
});
