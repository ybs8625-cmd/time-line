import { positionAtDistance, positionAtProgress, project } from "./models.js";

const CAMERA_CONTEXT_KM = 650;
const TRAIL_VISIBLE_SECONDS = 2.5;
const MIN_TRAIL_KM = 80;
const MAX_TRAIL_KM = 2000;
const MIN_ROUTE_PIXEL_SPACING = 1.35;
const OVERVIEW_ROUTE_ALPHA = 190;
const OVERVIEW_PADDING = 1.22;
const OVERLAY_BOTTOM = 132;
const OVERVIEW_SIDE_INSET = 34;
const OVERVIEW_HEADER_GAP = 20;
const OVERVIEW_BOTTOM_INSET = 34;
const CAMERA_TRACK_SAMPLES = 240;
const CAMERA_DEAD_ZONE_HALF = 0.2;
const ZOOM_OUT_ALPHA = 0.32;
const ZOOM_IN_ALPHA = 0.065;
const TILE_ZOOM_HYSTERESIS = 0.15;
const MIN_VIEWPORT_SPAN = 0.0003;
const MAX_VIEWPORT_SPAN = 0.72;
const MAX_OVERVIEW_VIEWPORT_SPAN = 1.25;
const MIN_TILE_ZOOM = 2;
const MAX_TILE_ZOOM = 15;
const BRAND = "#E90064";
const INK = "#24191D";
const MUTED = "#5C4B52";
const CARD = "rgba(255, 248, 250, 0.86)";

function lerp(start, end, fraction) {
  return start + (end - start) * fraction;
}

function unwrapNear(value, reference) {
  let result = value;
  while (result - reference > 0.5) result -= 1;
  while (result - reference < -0.5) result += 1;
  return result;
}

function easeOutCubic(value) {
  const inverse = 1 - Math.min(1, Math.max(0, value));
  return 1 - inverse * inverse * inverse;
}

function easeInOutCubic(value) {
  const amount = Math.min(1, Math.max(0, value));
  if (amount < 0.5) return 4 * amount * amount * amount;
  const inverse = -2 * amount + 2;
  return 1 - (inverse * inverse * inverse) / 2;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, values.length - 1));
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function clampCenterY(centerY, spanY) {
  const half = spanY / 2;
  return half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, centerY));
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export class TimelinePainter {
  constructor() {
    this.cachedJourney = null;
    this.cachedPrepared = null;
    this.cachedCamera = null;
  }

  prepare(journey) {
    if (this.cachedJourney === journey) return this.cachedPrepared;
    const projected = journey.renderPath.map((sample) => project(sample.point.lat, sample.point.lon));
    const unwrappedX = [];
    if (projected.length) {
      unwrappedX.push(projected[0].x);
      for (let i = 1; i < projected.length; i++) {
        unwrappedX.push(unwrapNear(projected[i].x, unwrappedX[i - 1]));
      }
    }
    const distances = journey.renderPath.map((sample) => sample.distanceKm);
    this.cachedJourney = journey;
    this.cachedPrepared = { projected, unwrappedX, distances };
    this.cachedCamera = null;
    return this.cachedPrepared;
  }

  viewport(journey, frame, width, height) {
    if (width <= 0 || height <= 0) return this.rawViewport(journey, frame.journeyProgress, width, height);
    const journeyViewport = this.cameraTrack(journey, width, height).viewportAt(frame.journeyProgress);
    if (frame.outroProgress <= 0) return journeyViewport;
    return this.blendViewport(
      journeyViewport,
      this.overviewViewport(journey, width, height),
      easeOutCubic(frame.outroProgress),
      width,
      height,
    );
  }

  requiredTiles(viewport) {
    const count = 1 << viewport.zoom;
    const xMin = Math.floor(viewport.minX * count);
    const xMax = Math.floor(viewport.maxX * count);
    const yMin = Math.min(count - 1, Math.max(0, Math.floor(viewport.minY * count)));
    const yMax = Math.min(count - 1, Math.max(0, Math.floor(viewport.maxY * count)));
    const tiles = [];
    for (let worldX = xMin; worldX <= xMax; worldX++) {
      const normalizedX = ((worldX % count) + count) % count;
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ id: { zoom: viewport.zoom, x: normalizedX, y }, worldX });
      }
    }
    return tiles.slice(0, 36);
  }

  draw(ctx, width, height, journey, frame, journeyDurationSeconds, title, tiles) {
    if (!journey.points.length || width <= 0 || height <= 0) return;
    const viewport = this.viewport(journey, frame, width, height);
    const prepared = this.prepare(journey);
    this.drawBackground(ctx, width, height);
    this.drawTiles(ctx, width, height, viewport, tiles);

    const current = positionAtProgress(journey, frame.journeyProgress);
    const trailWindow = this.trailWindowDistance(journey, journeyDurationSeconds);
    const trailStart = Math.max(0, current.distanceKm - trailWindow);
    const visibleTrail = current.distanceKm - trailStart;
    const oldEnd = trailStart + visibleTrail * 0.45;
    const middleEnd = trailStart + visibleTrail * 0.75;
    const activeAlpha = Math.min(1, Math.max(0, 1 - easeOutCubic(frame.outroProgress)));

    this.drawRouteRange(ctx, journey, prepared, viewport, width, height, trailStart, Math.min(oldEnd, current.distanceKm), {
      color: BRAND,
      width: 4,
      alpha: 0.22 * activeAlpha,
    });
    this.drawRouteRange(ctx, journey, prepared, viewport, width, height, Math.min(oldEnd, current.distanceKm), Math.min(middleEnd, current.distanceKm), {
      color: BRAND,
      width: 6,
      alpha: 0.53 * activeAlpha,
    });
    this.drawRouteRange(ctx, journey, prepared, viewport, width, height, Math.min(middleEnd, current.distanceKm), current.distanceKm, {
      color: BRAND,
      width: 8,
      alpha: activeAlpha,
    });

    if (frame.outroProgress > 0) {
      ctx.save();
      ctx.globalAlpha = (OVERVIEW_ROUTE_ALPHA / 255) * easeInOutCubic(frame.outroProgress);
      this.drawRouteRange(ctx, journey, prepared, viewport, width, height, 0, journey.totalDistanceKm, {
        color: BRAND,
        width: 3.5,
        alpha: 1,
      });
      ctx.restore();
    }

    const head = this.screenPoint(current, prepared, viewport, width, height);
    const markerAlpha = activeAlpha;
    if (markerAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = markerAlpha;
      ctx.beginPath();
      ctx.arc(head.x, head.y, width * 0.013, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 5;
      ctx.strokeStyle = BRAND;
      ctx.beginPath();
      ctx.arc(head.x, head.y, width * 0.017, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawOverlay(ctx, width, height, current, title);
  }

  rawViewport(journey, progress, width, height) {
    const prepared = this.prepare(journey);
    const current = positionAtProgress(journey, progress);
    const tailDistance = Math.max(0, current.distanceKm - CAMERA_CONTEXT_KM);
    const lookaheadDistance = Math.min(journey.totalDistanceKm, current.distanceKm + CAMERA_CONTEXT_KM);
    const start = lowerBound(prepared.distances, tailDistance);
    const end = upperBound(prepared.distances, lookaheadDistance);
    const focus = [
      positionAtDistance(journey, tailDistance).point,
      ...journey.renderPath.slice(start, end + 1).map((sample) => sample.point),
      current.point,
      positionAtDistance(journey, lookaheadDistance).point,
    ].map((point) => project(point.lat, point.lon));

    const routeReferenceX = this.referenceX(prepared, current.distanceKm);
    const centerPoint = project(current.point.lat, current.point.lon);
    const centerX = unwrapNear(centerPoint.x, routeReferenceX);
    const wrappedX = focus.map((point) => unwrapNear(point.x, centerX));
    const ys = focus.map((point) => point.y);
    const centerY = centerPoint.y;
    const contentSpanX = Math.max(0.00015, Math.max(...wrappedX) - Math.min(...wrappedX));
    const contentSpanY = Math.max(0.00015, Math.max(...ys) - Math.min(...ys));
    const aspect = width / Math.max(1, height);
    let spanY = Math.max(contentSpanY * 2.8, (contentSpanX * 2.8) / aspect);
    spanY = Math.min(0.72, Math.max(0.0003, spanY));
    const spanX = spanY * aspect;
    const minY = Math.max(0, centerY - spanY / 2);
    const maxY = Math.min(1, centerY + spanY / 2);
    const minX = centerX - spanX / 2;
    const maxX = centerX + spanX / 2;
    const zoom = Math.min(
      MAX_TILE_ZOOM,
      Math.max(
        MIN_TILE_ZOOM,
        Math.floor(Math.log2(Math.max(1, width) / (256 * Math.max(maxX - minX, (maxY - minY) * aspect)))),
      ),
    );
    return { minX, maxX, minY, maxY, zoom };
  }

  cameraTrack(journey, width, height) {
    if (
      this.cachedCamera &&
      this.cachedCamera.journey === journey &&
      this.cachedCamera.width === width &&
      this.cachedCamera.height === height
    ) {
      return this.cachedCamera.track;
    }
    const track = this.buildCameraTrack(journey, width, height);
    this.cachedCamera = { journey, width, height, track };
    return track;
  }

  buildCameraTrack(journey, width, height) {
    const aspect = width / Math.max(1, height);
    const frames = [];
    let previous = null;
    for (let sample = 0; sample <= CAMERA_TRACK_SAMPLES; sample++) {
      const progress = sample / CAMERA_TRACK_SAMPLES;
      const raw = this.rawViewport(journey, progress, width, height);
      const rawCenterX = (raw.minX + raw.maxX) / 2;
      const rawCenterY = (raw.minY + raw.maxY) / 2;
      const rawSpanY = Math.max(MIN_VIEWPORT_SPAN, raw.maxY - raw.minY);
      const marker = project(
        positionAtProgress(journey, progress).point.lat,
        positionAtProgress(journey, progress).point.lon,
      );
      let frame;
      if (!previous) {
        frame = { centerX: rawCenterX, centerY: rawCenterY, spanY: rawSpanY, zoom: raw.zoom };
      } else {
        const zoomAlpha = rawSpanY > previous.spanY ? ZOOM_OUT_ALPHA : ZOOM_IN_ALPHA;
        const spanY = Math.min(
          MAX_VIEWPORT_SPAN,
          Math.max(MIN_VIEWPORT_SPAN, Math.exp(lerp(Math.log(previous.spanY), Math.log(rawSpanY), zoomAlpha))),
        );
        const spanX = spanY * aspect;
        const markerX = unwrapNear(marker.x, previous.centerX);
        let centerX = previous.centerX;
        let centerY = previous.centerY;
        const deadHalfX = spanX * CAMERA_DEAD_ZONE_HALF;
        const deadHalfY = spanY * CAMERA_DEAD_ZONE_HALF;
        if (markerX < centerX - deadHalfX) centerX = markerX + deadHalfX;
        else if (markerX > centerX + deadHalfX) centerX = markerX - deadHalfX;
        if (marker.y < centerY - deadHalfY) centerY = marker.y + deadHalfY;
        else if (marker.y > centerY + deadHalfY) centerY = marker.y - deadHalfY;
        centerY = clampCenterY(centerY, spanY);
        const continuousZoom = Math.log2(Math.max(1, width) / (256 * spanX));
        frame = {
          centerX,
          centerY,
          spanY,
          zoom: this.stabilizedTileZoom(previous.zoom, continuousZoom),
        };
      }
      frames.push(frame);
      previous = frame;
    }

    return {
      frames,
      aspect,
      viewportAt: (progress) => {
        if (frames.length === 1) return this.frameToViewport(frames[0], aspect);
        const position = Math.min(1, Math.max(0, progress)) * (frames.length - 1);
        const fromIndex = Math.min(frames.length - 1, Math.max(0, Math.floor(position)));
        const toIndex = Math.min(frames.length - 1, fromIndex + 1);
        const fraction = position - fromIndex;
        const from = frames[fromIndex];
        const to = frames[toIndex];
        const blended = {
          centerX: lerp(from.centerX, to.centerX, fraction),
          centerY: lerp(from.centerY, to.centerY, fraction),
          spanY: Math.exp(lerp(Math.log(from.spanY), Math.log(to.spanY), fraction)),
          zoom: fraction < 0.5 ? from.zoom : to.zoom,
        };
        return this.frameToViewport(blended, aspect);
      },
    };
  }

  frameToViewport(frame, aspect) {
    const halfY = frame.spanY / 2;
    const halfX = (frame.spanY * aspect) / 2;
    return {
      minX: frame.centerX - halfX,
      maxX: frame.centerX + halfX,
      minY: frame.centerY - halfY,
      maxY: frame.centerY + halfY,
      zoom: frame.zoom,
    };
  }

  stabilizedTileZoom(previous, continuous) {
    let zoom = previous;
    while (zoom < MAX_TILE_ZOOM && continuous >= zoom + 1 + TILE_ZOOM_HYSTERESIS) zoom += 1;
    while (zoom > MIN_TILE_ZOOM && continuous < zoom - TILE_ZOOM_HYSTERESIS) zoom -= 1;
    return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, zoom));
  }

  overviewSafeArea(width, height) {
    const scale = width / 720;
    return {
      left: OVERVIEW_SIDE_INSET * scale,
      top: OVERLAY_BOTTOM * scale + OVERVIEW_HEADER_GAP * scale,
      right: width - OVERVIEW_SIDE_INSET * scale,
      bottom: height - OVERVIEW_BOTTOM_INSET * scale,
      width() {
        return this.right - this.left;
      },
      height() {
        return this.bottom - this.top;
      },
      centerX() {
        return (this.left + this.right) / 2;
      },
      centerY() {
        return (this.top + this.bottom) / 2;
      },
    };
  }

  overviewViewport(journey, width, height) {
    const prepared = this.prepare(journey);
    const minX = prepared.unwrappedX.length ? Math.min(...prepared.unwrappedX) : 0.5;
    const maxX = prepared.unwrappedX.length ? Math.max(...prepared.unwrappedX) : minX;
    const minY = prepared.projected.length ? Math.min(...prepared.projected.map((p) => p.y)) : 0.5;
    const maxY = prepared.projected.length ? Math.max(...prepared.projected.map((p) => p.y)) : minY;
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const contentSpanX = Math.max(MIN_VIEWPORT_SPAN, maxX - minX);
    const contentSpanY = Math.max(MIN_VIEWPORT_SPAN, maxY - minY);
    const safe = this.overviewSafeArea(width, height);
    const worldPerPixel =
      Math.max(contentSpanX / Math.max(1, safe.width()), contentSpanY / Math.max(1, safe.height())) *
      OVERVIEW_PADDING;
    const spanX = Math.max(MIN_VIEWPORT_SPAN, worldPerPixel * width);
    const spanY = Math.min(MAX_OVERVIEW_VIEWPORT_SPAN, Math.max(MIN_VIEWPORT_SPAN, worldPerPixel * height));
    let minViewportY = contentCenterY - safe.centerY() * worldPerPixel;
    if (spanY <= 1) minViewportY = Math.min(1 - spanY, Math.max(0, minViewportY));
    const minViewportX = contentCenterX - safe.centerX() * worldPerPixel;
    const zoom = Math.min(
      MAX_TILE_ZOOM,
      Math.max(MIN_TILE_ZOOM, Math.floor(Math.log2(Math.max(1, width) / (256 * spanX)))),
    );
    return {
      minX: minViewportX,
      maxX: minViewportX + spanX,
      minY: minViewportY,
      maxY: minViewportY + spanY,
      zoom,
    };
  }

  blendViewport(from, to, fraction, width, height) {
    const amount = Math.min(1, Math.max(0, fraction));
    const aspect = width / Math.max(1, height);
    const fromCenterX = (from.minX + from.maxX) / 2;
    const toCenterX = unwrapNear((to.minX + to.maxX) / 2, fromCenterX);
    const centerX = lerp(fromCenterX, toCenterX, amount);
    const centerY = lerp((from.minY + from.maxY) / 2, (to.minY + to.maxY) / 2, amount);
    const fromSpanY = Math.max(MIN_VIEWPORT_SPAN, from.maxY - from.minY);
    const toSpanY = Math.max(MIN_VIEWPORT_SPAN, to.maxY - to.minY);
    const spanY = Math.min(
      MAX_OVERVIEW_VIEWPORT_SPAN,
      Math.max(MIN_VIEWPORT_SPAN, Math.exp(lerp(Math.log(fromSpanY), Math.log(toSpanY), amount))),
    );
    const spanX = spanY * aspect;
    const adjustedCenterY = clampCenterY(centerY, spanY);
    const zoom = Math.min(
      MAX_TILE_ZOOM,
      Math.max(MIN_TILE_ZOOM, Math.floor(Math.log2(Math.max(1, width) / (256 * spanX)))),
    );
    return {
      minX: centerX - spanX / 2,
      maxX: centerX + spanX / 2,
      minY: adjustedCenterY - spanY / 2,
      maxY: adjustedCenterY + spanY / 2,
      zoom,
    };
  }

  trailWindowDistance(journey, journeyDurationSeconds) {
    if (journey.totalDistanceKm <= 0) return 0;
    const distance =
      (journey.totalDistanceKm * TRAIL_VISIBLE_SECONDS) / Math.max(1, journeyDurationSeconds);
    return Math.min(journey.totalDistanceKm, Math.min(MAX_TRAIL_KM, Math.max(MIN_TRAIL_KM, distance)));
  }

  drawBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#FAF6F7");
    gradient.addColorStop(1, "#E0E8EF");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawTiles(ctx, width, height, viewport, tiles) {
    const count = 1 << viewport.zoom;
    for (const tile of this.requiredTiles(viewport)) {
      const bitmap = tiles.get(tile.id);
      if (!bitmap) continue;
      const leftWorld = tile.worldX / count;
      const rightWorld = (tile.worldX + 1) / count;
      const topWorld = tile.id.y / count;
      const bottomWorld = (tile.id.y + 1) / count;
      const left = ((leftWorld - viewport.minX) / (viewport.maxX - viewport.minX)) * width;
      const right = ((rightWorld - viewport.minX) / (viewport.maxX - viewport.minX)) * width;
      const top = ((topWorld - viewport.minY) / (viewport.maxY - viewport.minY)) * height;
      const bottom = ((bottomWorld - viewport.minY) / (viewport.maxY - viewport.minY)) * height;
      ctx.drawImage(bitmap, left, top, right - left + 1, bottom - top + 1);
    }
  }

  worldToScreen(point, viewport, width, height) {
    const x = unwrapNear(point.x, (viewport.minX + viewport.maxX) / 2);
    return {
      x: ((x - viewport.minX) / (viewport.maxX - viewport.minX)) * width,
      y: ((point.y - viewport.minY) / (viewport.maxY - viewport.minY)) * height,
    };
  }

  referenceX(prepared, distanceKm) {
    if (!prepared.distances.length) return 0.5;
    const after = lowerBound(prepared.distances, distanceKm);
    const before = Math.max(0, after - 1);
    const nearest =
      after < prepared.distances.length &&
      Math.abs(prepared.distances[after] - distanceKm) < Math.abs(prepared.distances[before] - distanceKm)
        ? after
        : before;
    return prepared.unwrappedX[nearest];
  }

  screenPoint(position, prepared, viewport, width, height) {
    const projected = project(position.point.lat, position.point.lon);
    const reference = this.referenceX(prepared, position.distanceKm);
    return this.worldToScreen({ x: unwrapNear(projected.x, reference), y: projected.y }, viewport, width, height);
  }

  drawRouteRange(ctx, journey, prepared, viewport, width, height, startDistance, endDistance, style) {
    if (endDistance <= startDistance || !prepared.distances.length || style.alpha <= 0) return;
    const start = this.screenPoint(positionAtDistance(journey, startDistance), prepared, viewport, width, height);
    const end = this.screenPoint(positionAtDistance(journey, endDistance), prepared, viewport, width, height);
    const firstIndex = lowerBound(prepared.distances, startDistance);
    const lastIndex = upperBound(prepared.distances, endDistance);
    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    let lastX = start.x;
    let lastY = start.y;
    for (let index = firstIndex; index <= lastIndex && index < prepared.projected.length; index++) {
      const projected = prepared.projected[index];
      const screen = this.worldToScreen(
        { x: prepared.unwrappedX[index], y: projected.y },
        viewport,
        width,
        height,
      );
      const dx = screen.x - lastX;
      const dy = screen.y - lastY;
      if (dx * dx + dy * dy >= MIN_ROUTE_PIXEL_SPACING * MIN_ROUTE_PIXEL_SPACING) {
        ctx.lineTo(screen.x, screen.y);
        lastX = screen.x;
        lastY = screen.y;
      }
    }
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  drawOverlay(ctx, width, height, position, title) {
    const scale = width / 720;
    const card = { x: 34 * scale, y: 28 * scale, w: width - 68 * scale, h: (OVERLAY_BOTTOM - 28) * scale };
    ctx.fillStyle = CARD;
    roundRect(ctx, card.x, card.y, card.w, card.h, 24 * scale);
    ctx.fill();

    const displayTitle = title || "나의 타임라인";
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let titleSize = 34 * scale;
    ctx.font = `700 ${titleSize}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
    const available = card.w - 36 * scale;
    while (titleSize > 20 * scale && ctx.measureText(displayTitle).width > available) {
      titleSize -= 1 * scale;
      ctx.font = `700 ${titleSize}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
    }
    let fitted = displayTitle;
    if (ctx.measureText(fitted).width > available) {
      while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > available) fitted = fitted.slice(0, -1);
      fitted = `${fitted.trimEnd()}…`;
    }
    ctx.fillText(fitted, width / 2, 72 * scale);

    const date = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "numeric" }).format(
      new Date(position.point.t),
    );
    const distance = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(position.distanceKm);
    ctx.fillStyle = MUTED;
    ctx.font = `400 ${20 * scale}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
    ctx.fillText(`${date}  ·  ${distance} km`, width / 2, 108 * scale);

    ctx.fillStyle = "rgba(36, 25, 29, 0.72)";
    ctx.textAlign = "right";
    ctx.font = `400 ${13 * scale}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
    ctx.fillText("© OpenStreetMap  © CARTO", width - 12 * scale, height - 12 * scale);
  }
}
