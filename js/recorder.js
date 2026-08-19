import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer.mjs";
import { frameAtOverallProgress, totalDurationSeconds } from "./animation.js";
import { TimelinePainter } from "./painter.js";

const FPS = 30;
const AVC_CODECS = [
  "avc1.640028",
  "avc1.4D0028",
  "avc1.4D001F",
  "avc1.42001F",
  "avc1.42001E",
];

function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function pickAvcConfig(width, height) {
  if (typeof VideoEncoder === "undefined" || typeof VideoEncoder.isConfigSupported !== "function") {
    return null;
  }
  const extras = [
    { avc: { format: "avc" }, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" },
    { avc: { format: "avc" }, hardwareAcceleration: "prefer-hardware" },
    { avc: { format: "avc" } },
    {},
  ];
  for (const codec of AVC_CODECS) {
    for (const extra of extras) {
      const config = {
        codec,
        width,
        height,
        bitrate: 5_000_000,
        framerate: FPS,
        ...extra,
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported) return { ...config, ...(support.config || {}) };
      } catch {
        // try the next combination
      }
    }
  }
  return null;
}

export async function preloadJourneyTiles(painter, tiles, journey, durationSeconds, width, height, onProgress) {
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    const frame = frameAtOverallProgress(i / samples, durationSeconds);
    await tiles.loadAll(painter.requiredTiles(painter.viewport(journey, frame, width, height)));
    onProgress?.((i / samples) * 0.35);
  }
}

export async function renderOverview(journey, durationSeconds, title, tiles, size = 1080) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const painter = new TimelinePainter();
  const frame = { journeyProgress: 1, outroProgress: 1 };
  await tiles.loadAll(painter.requiredTiles(painter.viewport(journey, frame, size, size)));
  painter.draw(ctx, size, size, journey, frame, durationSeconds, title, tiles);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function createStage(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  return { canvas, ctx };
}

async function encodeMp4(canvas, ctx, painter, journey, { durationSeconds, title, tiles, onProgress, signal, size }) {
  let config = await pickAvcConfig(size, size);
  let encodeSize = size;
  if (!config) {
    encodeSize = 1088;
    config = await pickAvcConfig(encodeSize, encodeSize);
    if (config) {
      canvas.width = encodeSize;
      canvas.height = encodeSize;
    }
  }
  if (!config) throw new Error("mp4-unsupported");

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width: encodeSize,
      height: encodeSize,
      frameRate: FPS,
    },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  const totalSeconds = totalDurationSeconds(durationSeconds);
  const totalFrames = Math.max(2, Math.round(FPS * totalSeconds));
  const frameDuration = Math.round(1e6 / FPS);

  try {
    for (let index = 0; index < totalFrames; index++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (encoderError) throw encoderError;
      const progress = index / (totalFrames - 1);
      const frame = frameAtOverallProgress(progress, durationSeconds);
      await tiles.loadAll(painter.requiredTiles(painter.viewport(journey, frame, encodeSize, encodeSize)));
      painter.draw(ctx, encodeSize, encodeSize, journey, frame, durationSeconds, title, tiles);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: index * frameDuration,
        duration: frameDuration,
      });
      encoder.encode(videoFrame, { keyFrame: index % FPS === 0 });
      videoFrame.close();

      while (encoder.encodeQueueSize > 12) {
        await new Promise((resolve) => {
          const finish = () => resolve();
          encoder.addEventListener("dequeue", finish, { once: true });
          setTimeout(finish, 30);
        });
      }
      onProgress?.(0.35 + (index / totalFrames) * 0.65);
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch {
      // already closed
    }
  }
}

export async function recordJourney(journey, { durationSeconds, title, tiles, onProgress, signal }) {
  const size = 1080;
  const { canvas, ctx } = createStage(size);
  const painter = new TimelinePainter();

  try {
    await preloadJourneyTiles(painter, tiles, journey, durationSeconds, size, size, onProgress);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    try {
      const blob = await encodeMp4(canvas, ctx, painter, journey, {
        durationSeconds,
        title,
        tiles,
        onProgress,
        signal,
        size,
      });
      return { blob, extension: "mp4" };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("MP4 encoding failed, falling back to MediaRecorder", error);
    }

    const types = ["video/mp4;codecs=avc1.4D0028", "video/mp4;codecs=avc1", "video/mp4"];
    const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType || typeof canvas.captureStream !== "function") {
      throw new Error("이 브라우저는 아이폰에서 바로 볼 수 있는 MP4를 만들지 못합니다. 최신 Chrome 또는 Edge를 사용해 주세요.");
    }

    const first = frameAtOverallProgress(0, durationSeconds);
    painter.draw(ctx, size, size, journey, first, durationSeconds, title, tiles);
    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/mp4" }));
      recorder.onerror = () => reject(new Error("영상을 만들지 못했습니다."));
    });

    const totalSeconds = totalDurationSeconds(durationSeconds);
    const totalFrames = Math.max(2, Math.round(FPS * totalSeconds));
    recorder.start();
    for (let index = 0; index < totalFrames; index++) {
      if (signal?.aborted) {
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Aborted", "AbortError");
      }
      const progress = index / (totalFrames - 1);
      const frame = frameAtOverallProgress(progress, durationSeconds);
      await tiles.loadAll(painter.requiredTiles(painter.viewport(journey, frame, size, size)));
      painter.draw(ctx, size, size, journey, frame, durationSeconds, title, tiles);
      onProgress?.(0.35 + (index / totalFrames) * 0.65);
      await waitFrame();
    }
    await waitFrame();
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    return { blob: await stopped, extension: "mp4" };
  } finally {
    canvas.remove();
  }
}
