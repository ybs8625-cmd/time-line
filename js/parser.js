const MAX_LAT = 85.05112878;

export function parseCoordinate(raw) {
  if (raw == null) return null;
  let value = raw;
  if (typeof value === "object") {
    value = value.latLng || value.point || null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const cleaned = value
    .trim()
    .replace(/^geo:/i, "")
    .split("?", 1)[0]
    .replace(/°/g, "")
    .replace(/\s+/g, "");
  const pieces = cleaned.split(",");
  if (pieces.length < 2) return null;

  let latitude = Number(pieces[0]);
  let longitude = Number(pieces[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 1_000_000 || Math.abs(longitude) > 1_000_000) {
    latitude /= 10_000_000;
    longitude /= 10_000_000;
  }
  if (latitude < -MAX_LAT || latitude > MAX_LAT || longitude < -180 || longitude > 180) {
    return null;
  }
  return { lat: latitude, lon: longitude };
}

export function parseInstant(raw) {
  if (!raw || typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function addPoint(points, timeValue, coordinateValue) {
  const instant = parseInstant(timeValue);
  const coordinate = parseCoordinate(coordinateValue);
  if (instant == null || !coordinate) return;
  points.push({ t: instant, lat: coordinate.lat, lon: coordinate.lon });
}

function readVisit(visit) {
  if (!visit || typeof visit !== "object") return null;
  const candidate = visit.topCandidate;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate.placeLocation ?? null;
}

function ingestSegment(segment, points) {
  if (!segment || typeof segment !== "object") return;
  const startTime = segment.startTime;
  const endTime = segment.endTime;

  const path = Array.isArray(segment.timelinePath) ? segment.timelinePath : [];
  for (const item of path) {
    if (!item || typeof item !== "object") continue;
    addPoint(points, item.time, item.point);
  }

  const activity = segment.activity;
  if (activity && typeof activity === "object") {
    addPoint(points, startTime, activity.start);
    addPoint(points, endTime, activity.end);
  }

  addPoint(points, startTime, readVisit(segment.visit));
}

export function parseTimeline(data) {
  let segments;
  if (Array.isArray(data)) {
    segments = data;
  } else if (data && typeof data === "object") {
    if (!Array.isArray(data.semanticSegments)) {
      throw new Error("이 JSON에는 semanticSegments가 없습니다.");
    }
    segments = data.semanticSegments;
  } else {
    throw new Error("Timeline JSON은 객체 또는 배열로 시작해야 합니다.");
  }

  const points = [];
  for (const segment of segments) ingestSegment(segment, points);

  const unique = new Map();
  for (const point of points) {
    if (point.lat < -MAX_LAT || point.lat > MAX_LAT || point.lon < -180 || point.lon > 180) {
      continue;
    }
    unique.set(`${point.t}|${point.lat}|${point.lon}`, point);
  }

  const normalized = [...unique.values()].sort((a, b) => a.t - b.t);
  if (!normalized.length) {
    throw new Error("지원되는 위치 정보를 찾지 못했습니다.");
  }
  return { points: normalized };
}
