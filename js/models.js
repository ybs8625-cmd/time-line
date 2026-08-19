const EARTH_KM = 6371.0088;
const MAX_LAT = 85.05112878;
const MAX_RENDER_STEP_KM = 75;
const MAX_STEPS_PER_SEGMENT = 320;

export function yearMonthOf(ms, timeZone) {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  return { year, month, value: year * 12 + month };
}

export function periodLabel(period) {
  if (period.startYear === period.endYear) return String(period.startYear);
  return `${period.startYear}–${period.endYear}`;
}

export function formatPeriodKorean(period) {
  if (period.startYear === period.endYear) {
    return `${period.startYear}년 ${period.startMonth}월–${period.endMonth}월`;
  }
  return `${period.startYear}년 ${period.startMonth}월–${period.endYear}년 ${period.endMonth}월`;
}

export function haversineKm(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolate(a, b, fraction) {
  if (fraction <= 0) return a;
  if (fraction >= 1) return b;
  const lat1 = (a.lat * Math.PI) / 180;
  const lon1 = (a.lon * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const lon2 = (b.lon * Math.PI) / 180;
  const ax = Math.cos(lat1) * Math.cos(lon1);
  const ay = Math.cos(lat1) * Math.sin(lon1);
  const az = Math.sin(lat1);
  const bx = Math.cos(lat2) * Math.cos(lon2);
  const by = Math.cos(lat2) * Math.sin(lon2);
  const bz = Math.sin(lat2);
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const omega = Math.acos(dot);
  let left;
  let right;
  if (Math.sin(omega) < 1e-8) {
    left = 1 - fraction;
    right = fraction;
  } else {
    left = Math.sin((1 - fraction) * omega) / Math.sin(omega);
    right = Math.sin(fraction * omega) / Math.sin(omega);
  }
  const x = left * ax + right * bx;
  const y = left * ay + right * by;
  const z = left * az + right * bz;
  return {
    t: a.t + (b.t - a.t) * fraction,
    lat: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

export function project(lat, lon) {
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  const x = (lon + 180) / 360;
  const sinLat = Math.sin((clamped * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y: Math.min(1, Math.max(0, y)) };
}

export function yearsFromPoints(points, timeZone) {
  const years = new Set();
  for (const point of points) years.add(yearMonthOf(point.t, timeZone).year);
  return [...years].sort((a, b) => b - a);
}

export function dataSpan(points, timeZone) {
  if (!points.length) return null;
  const first = yearMonthOf(points[0].t, timeZone);
  const last = yearMonthOf(points[points.length - 1].t, timeZone);
  return { first, last };
}

export function formatDataSpanKorean(points, timeZone) {
  const span = dataSpan(points, timeZone);
  if (!span) return "";
  const { first, last } = span;
  if (first.year === last.year && first.month === last.month) {
    return `${first.year}년 ${first.month}월`;
  }
  if (first.year === last.year) {
    return `${first.year}년 ${first.month}월–${last.month}월`;
  }
  return `${first.year}년 ${first.month}월–${last.year}년 ${last.month}월`;
}

export function defaultPeriod(points, timeZone) {
  const span = dataSpan(points, timeZone);
  if (!span) {
    const year = new Date().getFullYear();
    return { startYear: year, startMonth: 1, endYear: year, endMonth: 12 };
  }
  return {
    startYear: span.first.year,
    startMonth: span.first.month,
    endYear: span.last.year,
    endMonth: span.last.month,
  };
}

export function filterPoints(points, period, timeZone) {
  const start = period.startYear * 12 + period.startMonth;
  const end = period.endYear * 12 + period.endMonth;
  return points.filter((point) => {
    const current = yearMonthOf(point.t, timeZone).value;
    return current >= start && current <= end;
  });
}

function binarySearch(values, target) {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = values[mid];
    if (value === target) return mid;
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }
  return -low - 1;
}

export function buildJourney(points, period) {
  const distances = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    distances[i] = distances[i - 1] + haversineKm(points[i - 1], points[i]);
  }
  const journey = {
    period,
    points,
    distances,
    totalDistanceKm: distances.at(-1) ?? 0,
  };
  journey.renderPath = buildRenderPath(journey);
  return journey;
}

function buildRenderPath(journey) {
  const { points, distances } = journey;
  if (!points.length) return [];
  if (points.length === 1) return [{ point: points[0], distanceKm: 0 }];
  const path = [{ point: points[0], distanceKm: 0 }];
  for (let i = 1; i < points.length; i++) {
    const startDistance = distances[i - 1];
    const segmentDistance = distances[i] - startDistance;
    const steps = Math.min(
      MAX_STEPS_PER_SEGMENT,
      Math.max(1, Math.ceil(segmentDistance / MAX_RENDER_STEP_KM)),
    );
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      path.push({
        point: interpolate(points[i - 1], points[i], fraction),
        distanceKm: startDistance + segmentDistance * fraction,
      });
    }
  }
  return path;
}

export function positionAtDistance(journey, distanceKm) {
  const { points, distances, totalDistanceKm } = journey;
  if (!points.length) {
    return {
      point: { t: 0, lat: 0, lon: 0 },
      distanceKm: 0,
      fromIndex: 0,
      toIndex: 0,
      segmentFraction: 0,
    };
  }
  if (points.length === 1 || totalDistanceKm <= 0) {
    return { point: points[0], distanceKm: 0, fromIndex: 0, toIndex: 0, segmentFraction: 0 };
  }
  const target = Math.min(totalDistanceKm, Math.max(0, distanceKm));
  const exact = binarySearch(distances, target);
  if (exact >= 0) {
    return { point: points[exact], distanceKm: target, fromIndex: exact, toIndex: exact, segmentFraction: 0 };
  }
  const to = Math.min(points.length - 1, Math.max(1, -exact - 1));
  const from = to - 1;
  const segmentDistance = distances[to] - distances[from];
  const fraction =
    segmentDistance <= 0 ? 0 : Math.min(1, Math.max(0, (target - distances[from]) / segmentDistance));
  return {
    point: interpolate(points[from], points[to], fraction),
    distanceKm: target,
    fromIndex: from,
    toIndex: to,
    segmentFraction: fraction,
  };
}

export function positionAtProgress(journey, progress) {
  return positionAtDistance(journey, journey.totalDistanceKm * Math.min(1, Math.max(0, progress)));
}

export function resolveTitle(template, yearLabel, name, fallback) {
  const resolved = template
    .replace(/\{year\}/gi, yearLabel)
    .replace(/\{name\}/gi, name.trim())
    .trim();
  return resolved || fallback;
}
