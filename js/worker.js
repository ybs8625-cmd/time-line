import { parseTimeline } from "./parser.js";

self.onmessage = (event) => {
  try {
    let text = new TextDecoder("utf-8").decode(event.data.buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const data = JSON.parse(text);
    const timeline = parseTimeline(data);
    self.postMessage({ ok: true, points: timeline.points });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
    });
  }
};
