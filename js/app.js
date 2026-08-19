import { frameAtOverallProgress } from "./animation.js";
import {
  buildJourney,
  clampPeriod,
  dataSpan,
  defaultPeriod,
  filterPoints,
  formatDataSpanKorean,
  formatPeriodKorean,
  monthsForYear,
  periodLabel,
  positionAtProgress,
  resolveTitle,
  yearsInSpan,
} from "./models.js";
import { TimelinePainter } from "./painter.js";
import { recordJourney, renderOverview } from "./recorder.js";
import { deleteVideo, downloadBlob, listVideos, saveVideo } from "./store.js";
import { TileCache } from "./tiles.js";

const DURATIONS = [10, 15, 20, 30, 45, 60];
const DEFAULT_TEMPLATE = "{year}년 {name}의 타임라인";
const FALLBACK_TITLE = "나의 타임라인";
const SETTINGS_KEY = "timeline-visualizer-settings";

const els = {
  fileInput: document.querySelector("#file-input"),
  chooseFile: document.querySelector("#choose-file"),
  sampleFile: document.querySelector("#sample-file"),
  helpBtn: document.querySelector("#help-btn"),
  restoreBtn: document.querySelector("#restore-btn"),
  fileMeta: document.querySelector("#file-meta"),
  startYear: document.querySelector("#start-year"),
  startMonth: document.querySelector("#start-month"),
  endYear: document.querySelector("#end-year"),
  endMonth: document.querySelector("#end-month"),
  periodSummary: document.querySelector("#period-summary"),
  ownerName: document.querySelector("#owner-name"),
  titleTemplate: document.querySelector("#title-template"),
  titlePreview: document.querySelector("#title-preview"),
  duration: document.querySelector("#duration"),
  previewBtn: document.querySelector("#preview-btn"),
  createBtn: document.querySelector("#create-btn"),
  overviewBtn: document.querySelector("#overview-btn"),
  canvas: document.querySelector("#stage"),
  status: document.querySelector("#status"),
  videos: document.querySelector("#videos"),
  emptyVideos: document.querySelector("#empty-videos"),
  privacyDialog: document.querySelector("#privacy-dialog"),
  helpDialog: document.querySelector("#help-dialog"),
  restoreDialog: document.querySelector("#restore-dialog"),
  acceptPrivacy: document.querySelector("#accept-privacy"),
  progressWrap: document.querySelector("#progress-wrap"),
  progressBar: document.querySelector("#progress-bar"),
  progressLabel: document.querySelector("#progress-label"),
  cancelExport: document.querySelector("#cancel-export"),
};

const tiles = new TileCache();
const painter = new TimelinePainter();
const worker = new Worker("./js/worker.js", { type: "module" });

let points = [];
let fileName = "";
let journey = null;
let previewing = false;
let previewStart = 0;
let previewProgress = 0;
let exportAbort = null;
let privacyAccepted = localStorage.getItem("timeline-privacy-ok") === "1";
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const viewControl = { zoom: 1, panX: 0, panY: 0 };

function resetView() {
  viewControl.zoom = 1;
  viewControl.panX = 0;
  viewControl.panY = 0;
}

function previewDrawOptions() {
  return { keepTrail: true, viewControl };
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      name: els.ownerName.value,
      template: els.titleTemplate.value,
      duration: Number(els.duration.value),
    }),
  );
}

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
}

function currentPeriod() {
  return {
    startYear: Number(els.startYear.value),
    startMonth: Number(els.startMonth.value),
    endYear: Number(els.endYear.value),
    endMonth: Number(els.endMonth.value),
  };
}

function currentTitle() {
  const period = currentPeriod();
  return resolveTitle(
    els.titleTemplate.value || DEFAULT_TEMPLATE,
    periodLabel(period),
    els.ownerName.value || "여행자",
    FALLBACK_TITLE,
  );
}

function fillSelect(select, values, selected) {
  select.innerHTML = values
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`)
    .join("");
}

function monthOptions(months, selected) {
  const pick = months.includes(selected) ? selected : months[0];
  return months
    .map((month) => `<option value="${month}" ${month === pick ? "selected" : ""}>${month}월</option>`)
    .join("");
}

let rebuildingPeriod = false;

function rebuildPeriodSelectors(preferred) {
  const span = dataSpan(points, timeZone);
  if (!span) {
    els.startYear.innerHTML = "";
    els.endYear.innerHTML = "";
    els.startMonth.innerHTML = "";
    els.endMonth.innerHTML = "";
    return;
  }
  rebuildingPeriod = true;
  const period = clampPeriod(preferred ?? defaultPeriod(points, timeZone), span);
  const years = yearsInSpan(span);
  const startYears = years.filter((year) => year <= period.endYear);
  const endYears = years.filter((year) => year >= period.startYear);
  fillSelect(els.startYear, startYears, period.startYear);
  fillSelect(els.endYear, endYears, period.endYear);

  const startMonths = monthsForYear(period.startYear, span);
  els.startMonth.innerHTML = monthOptions(startMonths, period.startMonth);
  const startMonth = Number(els.startMonth.value);
  let endMonths = monthsForYear(period.endYear, span);
  if (period.endYear === period.startYear) {
    endMonths = endMonths.filter((month) => month >= startMonth);
  }
  els.endMonth.innerHTML = monthOptions(endMonths, period.endMonth);
  rebuildingPeriod = false;
}

function syncJourney() {
  if (!points.length) {
    journey = null;
    els.periodSummary.textContent = "시작하려면 타임라인 파일을 선택하세요.";
    drawIdle();
    return;
  }
  let period = currentPeriod();
  if (period.endYear * 12 + period.endMonth < period.startYear * 12 + period.startMonth) {
    els.endYear.value = String(period.startYear);
    els.endMonth.value = String(period.startMonth);
    period = currentPeriod();
  }
  const selected = filterPoints(points, period, timeZone);
  journey = buildJourney(selected, period);
  const count = selected.length.toLocaleString("ko-KR");
  const km = Math.round(journey.totalDistanceKm).toLocaleString("ko-KR");
  if (!selected.length) {
    els.periodSummary.textContent = "이 기간에는 위치 정보가 없습니다";
  } else if (selected.length === 1) {
    els.periodSummary.textContent = "위치 1개 · 기간을 넓혀 주세요";
  } else if (journey.totalDistanceKm <= 0) {
    els.periodSummary.textContent = `위치 ${count}개 · 이동 없음`;
  } else {
    els.periodSummary.textContent = `위치 ${count}개 · 약 ${km} km · ${formatPeriodKorean(period)}`;
  }
  els.titlePreview.textContent = currentTitle();
  resetView();
  if (!previewing) drawFrame(0);
}

function sizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const side = Math.max(320, Math.floor(rect.width));
  els.canvas.width = Math.floor(side * dpr);
  els.canvas.height = Math.floor(side * dpr);
}

function drawIdle() {
  const ctx = els.canvas.getContext("2d");
  const { width, height } = els.canvas;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#FAF6F7");
  gradient.addColorStop(1, "#E0E8EF");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#5C4B52";
  ctx.textAlign = "center";
  ctx.font = `500 ${Math.round(width * 0.032)}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
  ctx.fillText("타임라인 파일을 불러오면 여기에 여정이 그려집니다.", width / 2, height / 2);
}

async function drawFrame(overallProgress) {
  previewProgress = overallProgress;
  if (!journey?.points.length) {
    drawIdle();
    return;
  }
  const ctx = els.canvas.getContext("2d");
  const frame = frameAtOverallProgress(overallProgress, Number(els.duration.value));
  const viewport = painter.viewport(
    journey,
    frame,
    els.canvas.width,
    els.canvas.height,
    viewControl,
  );
  await tiles.loadAll(painter.requiredTiles(viewport));
  painter.draw(
    ctx,
    els.canvas.width,
    els.canvas.height,
    journey,
    frame,
    Number(els.duration.value),
    currentTitle(),
    tiles,
    previewDrawOptions(),
  );
}

function loop(now) {
  if (!previewing || !journey) return;
  const elapsed = (now - previewStart) / 1000;
  const total = Number(els.duration.value) + 1.5;
  const progress = Math.min(1, elapsed / total);
  const position = positionAtProgress(journey, Math.min(1, elapsed / Number(els.duration.value)));
  drawFrame(progress);
  if (progress < 1) {
    const km = Math.round(position.distanceKm).toLocaleString("ko-KR");
    setStatus(`미리보기 · ${km} km`);
    requestAnimationFrame(loop);
  } else {
    previewing = false;
    els.previewBtn.textContent = "미리보기";
    setStatus("미리보기 완료. 다시 누르면 처음부터 재생됩니다.");
  }
}

function ensurePrivacy() {
  if (privacyAccepted) return Promise.resolve(true);
  els.privacyDialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      els.privacyDialog.removeEventListener("close", onClose);
      resolve(privacyAccepted);
    };
    els.privacyDialog.addEventListener("close", onClose);
  });
}

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      cleanup();
      if (event.data.ok) resolve(event.data.points);
      else reject(new Error(event.data.error));
    };
    const onError = () => {
      cleanup();
      reject(new Error("타임라인 파일을 처리하는 중 오류가 발생했습니다."));
    };
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ buffer }, [buffer]);
  });
}

async function loadPoints(nextPoints, label) {
  points = nextPoints;
  fileName = label;
  els.fileMeta.textContent = `${label} · 위치 ${points.length.toLocaleString("ko-KR")}개 · ${formatDataSpanKorean(points, timeZone)}`;
  rebuildPeriodSelectors();
  syncJourney();
  setStatus("타임라인을 불러왔습니다. 기간을 확인하고 미리보기를 눌러 보세요.");
}

async function loadFile(file) {
  const allowed = await ensurePrivacy();
  if (!allowed) return;
  setStatus("타임라인 파일 읽는 중…");
  try {
    const buffer = await file.arrayBuffer();
    const parsed = await parseInWorker(buffer);
    await loadPoints(parsed, file.name);
  } catch (error) {
    setStatus(error.message || "파일을 불러오지 못했습니다", "error");
  }
}

async function refreshVideos() {
  const items = await listVideos();
  els.emptyVideos.hidden = items.length > 0;
  els.videos.querySelectorAll("[data-id]").forEach((node) => node.remove());
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "video-card";
    card.dataset.id = item.id;
    const thumb = item.thumbnail ? URL.createObjectURL(item.thumbnail) : "";
    card.innerHTML = `
      ${thumb ? `<img alt="" src="${thumb}">` : `<div class="thumb-fallback"></div>`}
      <div>
        <strong>${item.title}</strong>
        <p>${item.periodLabel} · ${item.durationSeconds}초</p>
        <div class="row">
          <button type="button" data-act="watch">보기</button>
          <button type="button" data-act="save">저장</button>
          <button type="button" class="ghost" data-act="delete">삭제</button>
        </div>
      </div>
    `;
    card.addEventListener("click", async (event) => {
      const act = event.target.dataset.act;
      if (!act) return;
      if (act === "watch") {
        const url = URL.createObjectURL(item.blob);
        window.open(url, "_blank", "noopener");
      } else if (act === "save") {
        downloadBlob(item.blob, item.filename);
      } else if (act === "delete") {
        await deleteVideo(item.id);
        refreshVideos();
      }
    });
    els.videos.appendChild(card);
  }
}

function bindUi() {
  const settings = loadSettings();
  els.ownerName.value = settings.name || "여행자";
  els.titleTemplate.value = settings.template || DEFAULT_TEMPLATE;
  els.duration.innerHTML = DURATIONS.map(
    (value) => `<option value="${value}" ${value === 60 ? "selected" : ""}>${value}초</option>`,
  ).join("");

  els.chooseFile.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) loadFile(file);
  });
  els.sampleFile.addEventListener("click", async () => {
    const allowed = await ensurePrivacy();
    if (!allowed) return;
    setStatus("샘플 타임라인 불러오는 중…");
    const response = await fetch("./sample/korea-2025.json");
    const buffer = await response.arrayBuffer();
    const parsed = await parseInWorker(buffer);
    await loadPoints(parsed, "korea-2025.json (샘플)");
  });
  els.helpBtn.addEventListener("click", () => els.helpDialog.showModal());
  els.restoreBtn.addEventListener("click", () => els.restoreDialog.showModal());
  els.acceptPrivacy.addEventListener("click", (event) => {
    event.preventDefault();
    privacyAccepted = true;
    localStorage.setItem("timeline-privacy-ok", "1");
    els.privacyDialog.close();
  });

  for (const select of [els.startYear, els.startMonth, els.endYear, els.endMonth, els.duration]) {
    select.addEventListener("change", () => {
      if (rebuildingPeriod) return;
      saveSettings();
      previewing = false;
      els.previewBtn.textContent = "미리보기";
      if (select !== els.duration) rebuildPeriodSelectors(currentPeriod());
      syncJourney();
    });
  }
  for (const input of [els.ownerName, els.titleTemplate]) {
    input.addEventListener("input", () => {
      saveSettings();
      els.titlePreview.textContent = currentTitle();
      if (!previewing && journey) drawFrame(0);
    });
  }

  els.previewBtn.addEventListener("click", () => {
    if (!journey?.points.length) {
      setStatus("먼저 타임라인 파일을 선택하세요.", "error");
      return;
    }
    if (previewing) {
      previewing = false;
      els.previewBtn.textContent = "미리보기";
      setStatus("미리보기를 일시정지했습니다.");
      return;
    }
    previewing = true;
    previewStart = performance.now();
    els.previewBtn.textContent = "미리보기 일시정지";
    requestAnimationFrame(loop);
  });

  els.createBtn.addEventListener("click", async () => {
    if (!journey?.points.length || journey.totalDistanceKm <= 0) {
      setStatus("이동이 있는 기간을 선택해 주세요.", "error");
      return;
    }
    exportAbort = new AbortController();
    els.progressWrap.hidden = false;
    els.createBtn.disabled = true;
    try {
      const title = currentTitle();
      const durationSeconds = Number(els.duration.value);
      const { blob, extension } = await recordJourney(journey, {
        durationSeconds,
        title,
        tiles,
        signal: exportAbort.signal,
        onProgress: (value) => {
          els.progressBar.value = Math.round(value * 100);
          els.progressLabel.textContent =
            value < 0.35 ? `지도 준비 중 · ${Math.round(value * 100)}%` : `영상 만드는 중 · ${Math.round(value * 100)}%`;
        },
      });
      const thumbnail = await renderOverview(journey, durationSeconds, title, tiles, 480);
      const record = {
        id: crypto.randomUUID(),
        title,
        periodLabel: formatPeriodKorean(currentPeriod()),
        durationSeconds,
        createdAt: Date.now(),
        filename: `${title}.${extension}`,
        blob,
        thumbnail,
      };
      await saveVideo(record);
      downloadBlob(blob, record.filename);
      await refreshVideos();
      setStatus("MP4 저장 완료. 다운로드 폴더의 파일을 아이폰으로 보내면 바로 재생됩니다.");
    } catch (error) {
      if (error.name === "AbortError") setStatus("영상 만들기를 취소했습니다.");
      else setStatus(error.message || "영상을 만들지 못했습니다", "error");
    } finally {
      els.progressWrap.hidden = true;
      els.createBtn.disabled = false;
      exportAbort = null;
    }
  });

  els.cancelExport.addEventListener("click", () => exportAbort?.abort());

  els.overviewBtn.addEventListener("click", async () => {
    if (!journey?.points.length) {
      setStatus("먼저 타임라인 파일을 선택하세요.", "error");
      return;
    }
    const blob = await renderOverview(journey, Number(els.duration.value), currentTitle(), tiles);
    downloadBlob(blob, `${currentTitle()}-전체경로.png`);
    setStatus("전체 경로 이미지를 저장했습니다.");
  });

  window.addEventListener("resize", () => {
    sizeCanvas();
    if (journey) drawFrame(previewProgress);
    else drawIdle();
  });

  bindMapInteraction();
}

function currentBaseViewport() {
  const frame = frameAtOverallProgress(previewProgress, Number(els.duration.value));
  return painter.viewport(journey, frame, els.canvas.width, els.canvas.height, {
    zoom: 1,
    panX: 0,
    panY: 0,
  });
}

function zoomAt(fracX, fracY, factor) {
  if (!journey) return;
  const base = currentBaseViewport();
  const baseCx = (base.minX + base.maxX) / 2;
  const baseCy = (base.minY + base.maxY) / 2;
  const baseSpanX = base.maxX - base.minX;
  const baseSpanY = base.maxY - base.minY;
  const spanX = baseSpanX / viewControl.zoom;
  const spanY = baseSpanY / viewControl.zoom;
  const worldX = baseCx + viewControl.panX - spanX / 2 + fracX * spanX;
  const worldY = baseCy + viewControl.panY - spanY / 2 + fracY * spanY;
  viewControl.zoom = Math.min(14, Math.max(0.4, viewControl.zoom * factor));
  const nextSpanX = baseSpanX / viewControl.zoom;
  const nextSpanY = baseSpanY / viewControl.zoom;
  viewControl.panX = worldX - fracX * nextSpanX + nextSpanX / 2 - baseCx;
  viewControl.panY = worldY - fracY * nextSpanY + nextSpanY / 2 - baseCy;
  drawFrame(previewProgress);
}

function bindMapInteraction() {
  const canvas = els.canvas;
  document.querySelector("#zoom-in")?.addEventListener("click", () => zoomAt(0.5, 0.5, 1.25));
  document.querySelector("#zoom-out")?.addEventListener("click", () => zoomAt(0.5, 0.5, 0.8));
  document.querySelector("#zoom-reset")?.addEventListener("click", () => {
    resetView();
    drawFrame(previewProgress);
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!journey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        (event.clientX - rect.left) / Math.max(1, rect.width),
        (event.clientY - rect.top) / Math.max(1, rect.height),
        event.deltaY > 0 ? 0.85 : 1.18,
      );
    },
    { passive: false },
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    if (!journey || event.button !== 0) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || !journey) return;
    const rect = canvas.getBoundingClientRect();
    const base = currentBaseViewport();
    const spanX = (base.maxX - base.minX) / viewControl.zoom;
    const spanY = (base.maxY - base.minY) / viewControl.zoom;
    viewControl.panX -= ((event.clientX - lastX) / Math.max(1, rect.width)) * spanX;
    viewControl.panY -= ((event.clientY - lastY) / Math.max(1, rect.height)) * spanY;
    lastX = event.clientX;
    lastY = event.clientY;
    drawFrame(previewProgress);
  });
  const stopDrag = () => {
    dragging = false;
  };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
}

sizeCanvas();
drawIdle();
bindUi();
refreshVideos();
syncJourney();
