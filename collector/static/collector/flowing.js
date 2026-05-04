const API_BUILDINGS = "/api/buildings/";
const API_FLOWING_RECORDS = "/api/flowing-records/";
const ROOT_BUILDING_ID = "__root__";
const DEFAULT_BUILDING_ID = "SUTD";
const DEFAULT_FLOOR_ID = "main-buildings";
const MIN_MAP_ZOOM = 0.25;
const MAX_MAP_ZOOM = 16;
const MAP_ZOOM_STEP = 0.1;
const DEFAULT_MAP_ZOOM = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const DIRECTION_SECONDS = 5 * 60;

const LEGACY_BUILDING_MAPS = {
  [ROOT_BUILDING_ID]: {
    label: "Sutd",
    floors: {
      "whole-campus": { label: "Whole Campus", mapSrc: "/assets/SUTD/whole-campus.svg" },
      "ground-floor": { label: "Floor 1", mapSrc: "/assets/SUTD/ground-floor.svg" },
      "second-floor": { label: "Floor 2", mapSrc: "/assets/SUTD/second-floor.svg" },
      "main-buildings": { label: "Floor 3", mapSrc: "/assets/SUTD/main-buildings.svg" },
    },
  },
};

const AGE_GROUPS = [
  { key: "under-10", label: "<10 years old" },
  { key: "10-20", label: "10-20 years old" },
  { key: "20-60", label: "20-60 years old" },
  { key: "over-60", label: ">60 years old" },
];
const GENDERS = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
];
const DIRECTIONS = ["ab", "ba"];

const mapWrap = document.getElementById("mapWrap");
const mapCanvas = document.getElementById("mapCanvas");
const mapImage = document.getElementById("mapImage");
const flowingOverlay = document.getElementById("flowingOverlay");
const mapEmptyState = document.getElementById("flowingMapEmptyState");
const buildingSelect = document.getElementById("buildingSelect");
const floorSelect = document.getElementById("floorSelect");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomValue = document.getElementById("zoomValue");
const clearLineBtn = document.getElementById("clearLineBtn");
const flowingStatus = document.getElementById("flowingStatus");
const directionLabel = document.getElementById("flowingDirectionLabel");
const directionHint = document.getElementById("flowingDirectionHint");
const timerDisplay = document.getElementById("flowingTimer");
const startBtn = document.getElementById("startFlowingBtn");
const resetBtn = document.getElementById("resetFlowingBtn");
const matrix = document.getElementById("flowingMatrix");
const countSummary = document.getElementById("flowingCountSummary");
const totalAB = document.getElementById("totalAB");
const totalBA = document.getElementById("totalBA");

let buildingMaps = {};
let currentBuildingId = "";
let currentFloorId = "";
let mapZoomLevel = DEFAULT_MAP_ZOOM;
let lastZoomAnchor = null;
let pinchStartDistance = 0;
let pinchStartZoom = DEFAULT_MAP_ZOOM;
let crossline = null;
let draftLine = null;
let isDrawingLine = false;
let activeDirectionIndex = 0;
let timerSeconds = DIRECTION_SECONDS;
let timerId = 0;
let isTimerRunning = false;
let counts = createEmptyCounts();
let sessionStartedAt = "";
let sessionCompletedAt = "";
let savedFlowingRecordId = "";
let isSavingFlowingRecord = false;

initialize();

async function initialize() {
  buildingSelect.innerHTML = "<option>Loading...</option>";
  floorSelect.innerHTML = "<option>Loading...</option>";
  renderMatrix();
  setStatus("Drag on the map to draw the crossline, then press Start.", "muted");

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  mapImage.addEventListener("pointerdown", onMapPointerDown);
  mapWrap.addEventListener("pointermove", onMapPointerMove);
  mapWrap.addEventListener("pointerup", onMapPointerUp);
  mapWrap.addEventListener("pointercancel", cancelDraftLine);
  mapWrap.addEventListener("wheel", onMapWheel, { passive: false });
  mapWrap.addEventListener("touchstart", onMapTouchStart, { passive: true });
  mapWrap.addEventListener("touchmove", onMapTouchMove, { passive: false });
  mapWrap.addEventListener("touchend", onMapTouchEnd, { passive: true });
  mapWrap.addEventListener("touchcancel", onMapTouchEnd, { passive: true });
  mapImage.addEventListener("load", () => {
    updateMapEmptyState();
    renderCrossline();
    updateZoomControls();
  });
  window.addEventListener("resize", renderCrossline);
  zoomOutBtn.addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
  zoomInBtn.addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
  zoomResetBtn.addEventListener("click", () => setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false }));
  clearLineBtn.addEventListener("click", clearCrossline);
  startBtn.addEventListener("click", onTimerToggle);
  resetBtn.addEventListener("click", resetSession);

  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });
  updateSessionControls();

  try {
    await loadBuildingMaps();
  } catch (error) {
    console.error("Could not load building maps:", error);
    setStatus("Could not load maps. Check the building asset setup.", "error");
  }
}

async function loadBuildingMaps() {
  const discoveredMaps = await fetchBuildingMaps();
  buildingMaps = normalizeBuildingMaps(discoveredMaps);

  if (!hasAnyBuildingFloors(buildingMaps)) {
    buildingMaps = normalizeBuildingMaps(LEGACY_BUILDING_MAPS);
  }

  const buildingIds = getBuildingIds();
  currentBuildingId = buildingIds.includes(DEFAULT_BUILDING_ID) ? DEFAULT_BUILDING_ID : buildingIds[0] || "";

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId, DEFAULT_FLOOR_ID);
  currentFloorId = floorSelect.value || "";
  updateMapForSelection();
}

async function fetchBuildingMaps() {
  try {
    const payload = await apiGet(API_BUILDINGS);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload.buildings && typeof payload.buildings === "object" && !Array.isArray(payload.buildings)
      ? payload.buildings
      : payload;
  } catch (error) {
    console.warn("Could not fetch building maps from API:", error);
    return null;
  }
}

function renderBuildingOptions(preferredBuildingId = "") {
  const buildingIds = getBuildingIds();
  buildingSelect.innerHTML = "";

  if (!buildingIds.length) {
    buildingSelect.disabled = true;
    buildingSelect.appendChild(new Option("No buildings", ""));
    return;
  }

  buildingSelect.disabled = false;
  buildingIds.forEach((buildingId) => {
    buildingSelect.appendChild(new Option(getBuildingLabel(buildingId), buildingId));
  });
  buildingSelect.value = preferredBuildingId && buildingMaps[preferredBuildingId] ? preferredBuildingId : buildingIds[0];
}

function renderFloorOptions(buildingId, preferredFloorId = "") {
  const floorIds = getFloorIds(buildingId);
  floorSelect.innerHTML = "";

  if (!floorIds.length) {
    floorSelect.disabled = true;
    floorSelect.appendChild(new Option("No floors", ""));
    return;
  }

  floorSelect.disabled = false;
  floorIds.forEach((floorId) => {
    floorSelect.appendChild(new Option(getFloorLabel(buildingId, floorId), floorId));
  });
  floorSelect.value = floorIds.includes(preferredFloorId) ? preferredFloorId : floorIds[0];
}

function onBuildingChange(event) {
  currentBuildingId = event.target.value;
  renderFloorOptions(currentBuildingId);
  currentFloorId = floorSelect.value || "";
  clearCrossline();
  updateMapForSelection();
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  clearCrossline();
  updateMapForSelection();
}

function updateMapForSelection() {
  const currentFloor = getFloorConfig(currentBuildingId, currentFloorId);
  if (!currentFloor) {
    mapImage.removeAttribute("src");
    mapImage.alt = "No indoor map available";
    updateMapEmptyState();
    return;
  }

  mapImage.src = currentFloor.mapSrc;
  mapImage.alt = `Indoor map ${getBuildingLabel(currentBuildingId)} ${currentFloor.label}`;
  updateMapEmptyState();
}

function onMapPointerDown(event) {
  if (!mapImage.getAttribute("src") || isTimerRunning) {
    return;
  }

  const point = getMapPointFromEvent(event);
  if (!point) {
    return;
  }

  event.preventDefault();
  mapImage.setPointerCapture?.(event.pointerId);
  isDrawingLine = true;
  draftLine = { start: point, end: point };
  renderCrossline();
}

function onMapPointerMove(event) {
  lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
  if (!isDrawingLine || !draftLine) {
    return;
  }

  const point = getMapPointFromEvent(event);
  if (!point) {
    return;
  }

  draftLine = { ...draftLine, end: point };
  renderCrossline();
}

function onMapPointerUp(event) {
  if (!isDrawingLine || !draftLine) {
    return;
  }

  const point = getMapPointFromEvent(event);
  if (point) {
    draftLine = { ...draftLine, end: point };
  }

  mapImage.releasePointerCapture?.(event.pointerId);
  const distance = getLineLength(draftLine);
  isDrawingLine = false;

  if (distance < 8) {
    draftLine = null;
    renderCrossline();
    setStatus("Draw a longer crossline before starting.", "warn");
    return;
  }

  crossline = draftLine;
  draftLine = null;
  renderCrossline();
  renderMatrix();
  setStatus("Crossline ready. Press Start when you are ready to count A -> B.", "success");
  updateSessionControls();
}

function cancelDraftLine() {
  isDrawingLine = false;
  draftLine = null;
  renderCrossline();
}

function getMapPointFromEvent(event) {
  const rect = mapImage.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const xPx = event.clientX - rect.left;
  const yPx = event.clientY - rect.top;
  if (xPx < 0 || yPx < 0 || xPx > rect.width || yPx > rect.height) {
    return null;
  }

  return {
    xPct: round2((xPx / rect.width) * 100),
    yPct: round2((yPx / rect.height) * 100),
  };
}

function clearCrossline() {
  crossline = null;
  draftLine = null;
  isDrawingLine = false;
  stopTimer();
  activeDirectionIndex = 0;
  timerSeconds = DIRECTION_SECONDS;
  counts = createEmptyCounts();
  sessionStartedAt = "";
  sessionCompletedAt = "";
  savedFlowingRecordId = "";
  renderCrossline();
  renderMatrix();
  updateSessionControls();
  updateTimerDisplay();
  setStatus("Draw a crossline on the map before starting.", "muted");
}

function renderCrossline() {
  const line = draftLine || crossline;
  flowingOverlay.innerHTML = "";

  const width = mapImage.clientWidth || mapCanvas.clientWidth || 0;
  const height = mapImage.clientHeight || mapCanvas.clientHeight || 0;
  flowingOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  flowingOverlay.style.width = `${width}px`;
  flowingOverlay.style.height = `${height}px`;

  if (!line || !width || !height) {
    return;
  }

  const start = toPixelPoint(line.start, width, height);
  const end = toPixelPoint(line.end, width, height);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const normal = {
    x: -dy / length,
    y: dx / length,
  };
  const arrowLength = Math.min(120, Math.max(62, length * 0.55));
  const sideA = clampPoint(
    { x: midpoint.x - normal.x * arrowLength * 0.5, y: midpoint.y - normal.y * arrowLength * 0.5 },
    width,
    height
  );
  const sideB = clampPoint(
    { x: midpoint.x + normal.x * arrowLength * 0.5, y: midpoint.y + normal.y * arrowLength * 0.5 },
    width,
    height
  );
  const arrowStart = getActiveDirection() === "ab" ? sideA : sideB;
  const arrowEnd = getActiveDirection() === "ab" ? sideB : sideA;

  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker", {
    id: "flowingArrowHead",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "5",
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.appendChild(createSvgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#dc2626" }));
  defs.appendChild(marker);
  flowingOverlay.appendChild(defs);

  flowingOverlay.appendChild(
    createSvgElement("line", {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      class: draftLine ? "flowing-crossline is-draft" : "flowing-crossline",
    })
  );
  flowingOverlay.appendChild(
    createSvgElement("line", {
      x1: arrowStart.x,
      y1: arrowStart.y,
      x2: arrowEnd.x,
      y2: arrowEnd.y,
      class: "flowing-direction-arrow",
      "marker-end": "url(#flowingArrowHead)",
    })
  );

  addFlowLabel("A", sideA.x, sideA.y);
  addFlowLabel("B", sideB.x, sideB.y);
}

function addFlowLabel(label, x, y) {
  const group = createSvgElement("g", { class: "flowing-side-label" });
  group.appendChild(createSvgElement("circle", { cx: x, cy: y, r: 13 }));
  const text = createSvgElement("text", { x, y: y + 4, "text-anchor": "middle" });
  text.textContent = label;
  group.appendChild(text);
  flowingOverlay.appendChild(group);
}

function renderMatrix() {
  const direction = getActiveDirection();
  matrix.innerHTML = "";
  matrix.style.setProperty("--flowing-age-row-count", AGE_GROUPS.length);

  const corner = document.createElement("div");
  corner.className = "flowing-matrix-corner";
  corner.textContent = "Age Group";
  matrix.appendChild(corner);

  GENDERS.forEach((gender) => {
    const header = document.createElement("div");
    header.className = "flowing-matrix-header";
    header.textContent = gender.label;
    matrix.appendChild(header);
  });

  AGE_GROUPS.forEach((ageGroup) => {
    const rowHeader = document.createElement("div");
    rowHeader.className = "flowing-matrix-age";
    rowHeader.textContent = ageGroup.label;
    matrix.appendChild(rowHeader);

    GENDERS.forEach((gender) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "flowing-matrix-cell";
      cell.disabled = !isCountingActive();
      cell.setAttribute("aria-label", `Add one ${gender.label}, ${ageGroup.label}`);
      cell.addEventListener("click", () => changeCount(ageGroup.key, gender.key, 1));

      const value = document.createElement("strong");
      value.textContent = String(counts[direction][ageGroup.key][gender.key]);
      cell.appendChild(value);

      matrix.appendChild(cell);
    });
  });

  updateCountSummary();
}

function changeCount(ageKey, genderKey, delta) {
  if (!crossline) {
    setStatus("Draw a crossline before counting people.", "warn");
    return;
  }
  if (!isCountingActive()) {
    setStatus("Start the timer before counting people.", "warn");
    return;
  }

  const direction = getActiveDirection();
  const nextValue = Math.max(0, counts[direction][ageKey][genderKey] + delta);
  counts[direction][ageKey][genderKey] = nextValue;
  renderMatrix();
}

function onTimerToggle() {
  if (isFlowingSessionFinished() && !savedFlowingRecordId) {
    void saveFlowingRecord();
    return;
  }

  if (isTimerRunning) {
    pauseTimer();
    return;
  }

  if (!crossline) {
    setStatus("Draw a crossline before starting.", "warn");
    return;
  }

  if (timerSeconds <= 0) {
    timerSeconds = DIRECTION_SECONDS;
  }
  if (!sessionStartedAt) {
    sessionStartedAt = new Date().toISOString();
  }

  isTimerRunning = true;
  timerId = window.setInterval(tickTimer, 1000);
  setStatus(`Counting ${formatDirection(getActiveDirection())}.`, "active");
  renderMatrix();
  updateSessionControls();
}

function pauseTimer() {
  stopTimer();
  setStatus(`Paused at ${formatTimer(timerSeconds)} for ${formatDirection(getActiveDirection())}.`, "warn");
}

function tickTimer() {
  timerSeconds = Math.max(0, timerSeconds - 1);
  updateTimerDisplay();

  if (timerSeconds > 0) {
    return;
  }

  stopTimer();
  if (getActiveDirection() === "ab") {
    setStatus("A -> B finished. Start B -> A when ready.", "success");
    activeDirectionIndex = 1;
    timerSeconds = DIRECTION_SECONDS;
    renderCrossline();
    renderMatrix();
  } else {
    sessionCompletedAt = new Date().toISOString();
    setStatus("Flowing count complete for both directions. Saving...", "success");
    void saveFlowingRecord();
  }
  updateSessionControls();
  updateTimerDisplay();
}

function resetSession() {
  stopTimer();
  activeDirectionIndex = 0;
  timerSeconds = DIRECTION_SECONDS;
  counts = createEmptyCounts();
  sessionStartedAt = "";
  sessionCompletedAt = "";
  savedFlowingRecordId = "";
  isSavingFlowingRecord = false;
  renderCrossline();
  renderMatrix();
  updateSessionControls();
  updateTimerDisplay();
  setStatus(crossline ? "Session reset. Start A -> B when ready." : "Draw a crossline before starting.", "muted");
}

function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = 0;
  }
  isTimerRunning = false;
  renderMatrix();
  updateSessionControls();
}

function isCountingActive() {
  return !!crossline && isTimerRunning;
}

function isFlowingSessionFinished() {
  return getActiveDirection() === "ba" && timerSeconds <= 0;
}

function updateSessionControls() {
  const hasLine = !!crossline;
  const activeDirection = getActiveDirection();
  const isFinished = isFlowingSessionFinished();

  startBtn.disabled = !hasLine || isSavingFlowingRecord || (isFinished && !!savedFlowingRecordId);
  startBtn.textContent = getPrimaryTimerButtonLabel(isFinished);
  clearLineBtn.disabled = isTimerRunning;

  directionLabel.textContent = formatDirection(activeDirection);
  directionHint.textContent = isTimerRunning
    ? "Counting in progress"
    : hasLine
      ? "Use the red arrow to confirm the crossing direction."
      : "Draw a crossline before starting.";
}

function getPrimaryTimerButtonLabel(isFinished) {
  if (isSavingFlowingRecord) {
    return "Saving...";
  }
  if (savedFlowingRecordId) {
    return "Saved";
  }
  if (isFinished) {
    return "Save";
  }
  if (isTimerRunning) {
    return "Pause";
  }
  return timerSeconds < DIRECTION_SECONDS ? "Resume" : "Start";
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTimer(timerSeconds);
}

function updateCountSummary() {
  countSummary.textContent = `Current direction total: ${getDirectionTotal(getActiveDirection())}`;
  totalAB.textContent = String(getDirectionTotal("ab"));
  totalBA.textContent = String(getDirectionTotal("ba"));
}

async function saveFlowingRecord() {
  if (!crossline || isSavingFlowingRecord || savedFlowingRecordId) {
    return;
  }

  isSavingFlowingRecord = true;
  updateSessionControls();

  try {
    const response = await apiRequest(API_FLOWING_RECORDS, {
      method: "POST",
      body: buildFlowingRecordPayload(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(parseApiErrorPayload(payload));
    }

    savedFlowingRecordId = payload.flowingRecord?.id || "";
    setStatus("Flowing count saved.", "success");
  } catch (error) {
    console.error("Could not save flowing count:", error);
    setStatus(error instanceof Error ? error.message : "Could not save flowing count.", "error");
  } finally {
    isSavingFlowingRecord = false;
    updateSessionControls();
  }
}

function buildFlowingRecordPayload() {
  return {
    buildingId: currentBuildingId,
    floorId: currentFloorId,
    lineGeometry: {
      start: { ...crossline.start },
      end: { ...crossline.end },
    },
    directionDurationSeconds: DIRECTION_SECONDS,
    startedAt: sessionStartedAt || new Date().toISOString(),
    completedAt: sessionCompletedAt || new Date().toISOString(),
    counts,
  };
}

function getDirectionTotal(direction) {
  return AGE_GROUPS.reduce(
    (ageTotal, ageGroup) =>
      ageTotal + GENDERS.reduce((genderTotal, gender) => genderTotal + counts[direction][ageGroup.key][gender.key], 0),
    0
  );
}

function createEmptyCounts() {
  return DIRECTIONS.reduce((directionCounts, direction) => {
    directionCounts[direction] = AGE_GROUPS.reduce((ageCounts, ageGroup) => {
      ageCounts[ageGroup.key] = GENDERS.reduce((genderCounts, gender) => {
        genderCounts[gender.key] = 0;
        return genderCounts;
      }, {});
      return ageCounts;
    }, {});
    return directionCounts;
  }, {});
}

function getActiveDirection() {
  return DIRECTIONS[activeDirectionIndex] || "ab";
}

function formatDirection(direction) {
  return direction === "ba" ? "B -> A" : "A -> B";
}

function formatTimer(value) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function changeMapZoom(delta) {
  setMapZoom(mapZoomLevel + delta, { anchor: lastZoomAnchor });
}

function setMapZoom(nextZoom, options = {}) {
  const preserveCenter = options.preserveCenter !== false;
  const anchor = normalizeZoomAnchor(options.anchor);
  const clampedZoom = clampZoom(nextZoom);
  if (!Number.isFinite(clampedZoom)) {
    return;
  }

  const previousWidth = mapCanvas.clientWidth;
  const previousHeight = mapCanvas.clientHeight;
  const fallbackAnchor = preserveCenter ? { x: mapWrap.clientWidth / 2, y: mapWrap.clientHeight / 2 } : null;
  const activeAnchor = anchor || fallbackAnchor;
  let anchorXRatio = 0.5;
  let anchorYRatio = 0.5;

  if (activeAnchor && previousWidth && previousHeight) {
    anchorXRatio = (mapWrap.scrollLeft + activeAnchor.x) / previousWidth;
    anchorYRatio = (mapWrap.scrollTop + activeAnchor.y) / previousHeight;
  }

  mapZoomLevel = clampedZoom;
  mapCanvas.style.width = `${(mapZoomLevel * 100).toFixed(2)}%`;
  updateZoomControls();
  renderCrossline();

  if (activeAnchor) {
    const nextWidth = mapCanvas.clientWidth || previousWidth;
    const nextHeight = mapCanvas.clientHeight || previousHeight;
    mapWrap.scrollLeft = Math.max(0, nextWidth * anchorXRatio - activeAnchor.x);
    mapWrap.scrollTop = Math.max(0, nextHeight * anchorYRatio - activeAnchor.y);
  }
}

function updateZoomControls() {
  const zoomPercent = Math.round(mapZoomLevel * 100);
  zoomValue.textContent = `${zoomPercent}%`;
  zoomOutBtn.disabled = mapZoomLevel <= MIN_MAP_ZOOM + 0.0001;
  zoomInBtn.disabled = mapZoomLevel >= MAX_MAP_ZOOM - 0.0001;
}

function onMapWheel(event) {
  if (!mapImage.getAttribute("src")) {
    return;
  }

  event.preventDefault();
  const anchor = getAnchorFromClientPoint(event.clientX, event.clientY);
  if (anchor) {
    lastZoomAnchor = anchor;
  }

  const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
  setMapZoom(mapZoomLevel * zoomFactor, { anchor });
}

function onMapTouchStart(event) {
  if (event.touches.length !== 2) {
    return;
  }
  pinchStartDistance = getTouchDistance(event.touches[0], event.touches[1]);
  pinchStartZoom = mapZoomLevel;
}

function onMapTouchMove(event) {
  if (event.touches.length !== 2 || !pinchStartDistance) {
    return;
  }

  const nextDistance = getTouchDistance(event.touches[0], event.touches[1]);
  if (!nextDistance) {
    return;
  }

  event.preventDefault();
  const anchor = getAnchorFromTouchPair(event.touches[0], event.touches[1]);
  if (anchor) {
    lastZoomAnchor = anchor;
  }

  setMapZoom(pinchStartZoom * (nextDistance / pinchStartDistance), { anchor });
}

function onMapTouchEnd(event) {
  if (event.touches.length < 2) {
    pinchStartDistance = 0;
    pinchStartZoom = mapZoomLevel;
  }
}

function getTouchDistance(leftTouch, rightTouch) {
  const dx = leftTouch.clientX - rightTouch.clientX;
  const dy = leftTouch.clientY - rightTouch.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAnchorFromTouchPair(leftTouch, rightTouch) {
  return getAnchorFromClientPoint((leftTouch.clientX + rightTouch.clientX) / 2, (leftTouch.clientY + rightTouch.clientY) / 2);
}

function getAnchorFromClientPoint(clientX, clientY) {
  const rect = mapWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return normalizeZoomAnchor({ x: clientX - rect.left, y: clientY - rect.top });
}

function normalizeZoomAnchor(anchor) {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return null;
  }
  return {
    x: Math.min(mapWrap.clientWidth, Math.max(0, anchor.x)),
    y: Math.min(mapWrap.clientHeight, Math.max(0, anchor.y)),
  };
}

function updateMapEmptyState() {
  mapEmptyState.hidden = !!mapImage.getAttribute("src");
}

function setStatus(message, state = "muted") {
  flowingStatus.textContent = message;
  flowingStatus.dataset.state = state;
}

function normalizeBuildingMaps(rawMaps) {
  if (!rawMaps || typeof rawMaps !== "object" || Array.isArray(rawMaps)) {
    return {};
  }

  const normalized = {};
  Object.entries(rawMaps)
    .sort(([leftId], [rightId]) => naturalCompare(String(leftId), String(rightId)))
    .forEach(([rawBuildingId, rawBuilding]) => {
      if (!rawBuilding || typeof rawBuilding !== "object" || Array.isArray(rawBuilding)) {
        return;
      }

      const floorSource =
        rawBuilding.floors && typeof rawBuilding.floors === "object" && !Array.isArray(rawBuilding.floors)
          ? rawBuilding.floors
          : {};
      const floorEntries = Object.entries(floorSource)
        .filter(([, floor]) => floor && typeof floor === "object" && typeof floor.mapSrc === "string")
        .sort(([leftId], [rightId]) => naturalCompare(String(leftId), String(rightId)));

      if (!floorEntries.length) {
        return;
      }

      const floors = {};
      floorEntries.forEach(([rawFloorId, floor]) => {
        const floorId = String(rawFloorId);
        floors[floorId] = {
          label: typeof floor.label === "string" && floor.label.trim() ? floor.label.trim() : formatFloorLabel(floorId),
          mapSrc: floor.mapSrc.trim(),
        };
      });

      const buildingId = String(rawBuildingId);
      normalized[buildingId] = {
        label:
          typeof rawBuilding.label === "string" && rawBuilding.label.trim()
            ? rawBuilding.label.trim()
            : formatBuildingLabel(buildingId),
        floors,
      };
    });

  return normalized;
}

function hasAnyBuildingFloors(candidateMaps) {
  return (
    !!candidateMaps &&
    typeof candidateMaps === "object" &&
    !Array.isArray(candidateMaps) &&
    Object.values(candidateMaps).some((building) => building?.floors && Object.keys(building.floors).length > 0)
  );
}

function getBuildingIds() {
  return Object.keys(buildingMaps);
}

function getFloorIds(buildingId) {
  const floors = buildingMaps[buildingId]?.floors;
  return floors ? Object.keys(floors) : [];
}

function getFloorConfig(buildingId, floorId) {
  return buildingMaps[buildingId]?.floors?.[floorId] || null;
}

function getBuildingLabel(buildingId) {
  return buildingMaps[buildingId]?.label || "Unknown Building";
}

function getFloorLabel(buildingId, floorId) {
  return buildingMaps[buildingId]?.floors?.[floorId]?.label || "Unknown Floor";
}

function toPixelPoint(point, width, height) {
  return { x: (point.xPct / 100) * width, y: (point.yPct / 100) * height };
}

function clampPoint(point, width, height) {
  return {
    x: Math.max(18, Math.min(width - 18, point.x)),
    y: Math.max(18, Math.min(height - 18, point.y)),
  };
}

function getLineLength(line) {
  const width = mapImage.clientWidth || 1;
  const height = mapImage.clientHeight || 1;
  const start = toPixelPoint(line.start, width, height);
  const end = toPixelPoint(line.end, width, height);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function formatBuildingLabel(value) {
  return toDisplayLabel(value);
}

function formatFloorLabel(value) {
  const label = toDisplayLabel(value);
  const floorMatch = label.match(/^Floor\s*(\d+)$/i);
  return floorMatch ? `Floor ${floorMatch[1]}` : label;
}

function toDisplayLabel(value) {
  const cleaned = String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : "Unnamed";
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function clampZoom(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAP_ZOOM;
  }
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function apiGet(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

async function apiRequest(url, { method = "GET", body = null } = {}) {
  const headers = {
    Accept: "application/json",
  };

  let payload = null;
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers["X-CSRFToken"] = csrfToken;
    }
  }

  return fetch(url, {
    method,
    credentials: "same-origin",
    headers,
    body: payload,
  });
}

function getCsrfToken() {
  const tokenPair = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("csrftoken="));

  if (tokenPair) {
    return decodeURIComponent(tokenPair.slice("csrftoken=".length));
  }

  return "";
}

function parseApiErrorPayload(payload) {
  if (typeof payload?.error === "string" && payload.error) {
    return payload.error;
  }

  if (payload?.error?.message) {
    return payload.error.message;
  }

  if (payload?.error?.fields && typeof payload.error.fields === "object") {
    const firstError = Object.values(payload.error.fields).flat()[0];
    if (firstError) {
      return String(firstError);
    }
  }

  return "Could not save flowing count.";
}
