import { extractPhotoLocationFromImage, requestCurrentDeviceLocation } from "./image-location.js";

const STORAGE_KEY = "indoor-activity-records-v1";
const ASSETS_ROOT = "assets/";
const BUILDINGS_MANIFEST_PATH = `${ASSETS_ROOT}buildings.manifest.json`;
const ROOT_BUILDING_ID = "__root__";
const DEFAULT_BUILDING_ID = "One-Punggol";
const DEFAULT_FLOOR_ID = "Floor-1";
const MAX_PREVIEW_BYTES = 100 * 1024;
const MAX_PREVIEW_DATA_URL_LENGTH = 180000;
const PREVIEW_MAX_DIMENSION = 240;
const PREVIEW_MIN_DIMENSION = 56;
const PREVIEW_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i;
const AUTO_ACTOR_ID_PATTERN = /^CL(\d+)-P(\d+)$/i;
const MIN_MAP_ZOOM = 0.25;
const MAX_MAP_ZOOM = 8;
const MAP_ZOOM_STEP = 0.1;
const DEFAULT_MAP_ZOOM = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const MAP_FILE_PATTERN = /\.(svg|png|jpe?g|webp)$/i;

const LEGACY_BUILDING_MAPS = {
  [ROOT_BUILDING_ID]: {
    label: "Main Building",
    floors: {
      "floor-1": { label: "Floor 1", mapSrc: "assets/floor-1.svg" },
      "floor-2": { label: "Floor 2", mapSrc: "assets/floor-2.svg" },
      "floor-3": { label: "Floor 3", mapSrc: "assets/floor-3.svg" },
    },
  },
};

const mapWrap = document.getElementById("mapWrap");
const mapCanvas = document.getElementById("mapCanvas");
const mapImage = document.getElementById("mapImage");
const buildingSelect = document.getElementById("buildingSelect");
const floorSelect = document.getElementById("floorSelect");
const activityForm = document.getElementById("activityForm");
const activityType = document.getElementById("activityType");
const actorId = document.getElementById("actorId");
const ageGroup = document.getElementById("ageGroup");
const activityTime = document.getElementById("activityTime");
const photoInput = document.getElementById("photoInput");
const photoLocationStatus = document.getElementById("photoLocationStatus");
const notes = document.getElementById("notes");
const selectedCoords = document.getElementById("selectedCoords");
const recordsTbody = document.getElementById("recordsTbody");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const resetFormBtn = document.getElementById("resetFormBtn");
const collectToggleBtn = document.getElementById("collectToggleBtn");
const collectStatus = document.getElementById("collectStatus");
const locateViaGpsBtn = document.getElementById("locateViaGpsBtn");
const locateStatus = document.getElementById("locateStatus");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomValue = document.getElementById("zoomValue");
const genderButtons = Array.from(document.querySelectorAll(".gender-btn[data-gender]"));
const savePrompt = document.getElementById("savePrompt");

let records = loadRecords();
let selectedPoint = null;
let selectedPointTimestampIso = "";
let selectedGender = "";
let selectedPhotoLocation = null;
let selectedPhotoName = "";
let selectedPhotoPreviewDataUrl = "";
let isPhotoLocationLoading = false;
let buildingMaps = {};
let currentBuildingId = "";
let currentFloorId = "";
let isCollecting = false;
let currentClusterNumber = 0;
let currentPersonNumber = 0;
let lastGeneratedClusterNumber = 0;
let savePromptTimerId = 0;
let mapZoomLevel = DEFAULT_MAP_ZOOM;
let userLocationPoint = null;
let isLocatingViaGps = false;
let lastZoomAnchor = null;
let pinchStartDistance = 0;
let pinchStartZoom = DEFAULT_MAP_ZOOM;
let touchPanState = null;
let mousePanState = null;
let suppressMapClickUntil = 0;

initialize().catch((error) => {
  console.error("Initialization failed:", error);
  alert("Could not initialize building/floor maps. Check assets configuration.");
});

async function initialize() {
  activityTime.value = toDateTimeLocalValue(new Date());
  setPhotoLocationStatus("No image selected.", "muted");
  setLocateStatus("Tap Locate via GPS to see your spot on the map.", "muted");
  setSavePrompt("", "muted");

  buildingSelect.innerHTML = "<option>Loading...</option>";
  floorSelect.innerHTML = "<option>Loading...</option>";

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  mapWrap.addEventListener("click", onMapClick);
  mapWrap.addEventListener("wheel", onMapWheel, { passive: false });
  mapWrap.addEventListener("pointerdown", onMapPointerDown);
  mapWrap.addEventListener("pointermove", onMapPointerMove);
  mapWrap.addEventListener("pointerup", onMapPointerUp);
  mapWrap.addEventListener("pointercancel", onMapPointerUp);
  mapWrap.addEventListener("pointerleave", onMapPointerUp);
  mapWrap.addEventListener("touchstart", onMapTouchStart, { passive: true });
  mapWrap.addEventListener("touchmove", onMapTouchMove, { passive: false });
  mapWrap.addEventListener("touchend", onMapTouchEnd, { passive: true });
  mapWrap.addEventListener("touchcancel", onMapTouchEnd, { passive: true });
  mapImage.addEventListener("dragstart", onMapImageDragStart);
  mapImage.addEventListener("load", () => {
    renderMarkers();
    updateZoomControls();
  });
  window.addEventListener("resize", () => {
    renderMarkers();
    updateZoomControls();
  });
  photoInput.addEventListener("change", onPhotoChange);
  activityForm.addEventListener("submit", onFormSubmit);
  searchInput.addEventListener("input", renderRecords);
  exportBtn.addEventListener("click", onExport);
  resetFormBtn.addEventListener("click", () => resetForm(true, false));
  collectToggleBtn.addEventListener("click", onCollectToggle);
  if (zoomOutBtn && zoomInBtn && zoomResetBtn) {
    zoomOutBtn.addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
    zoomInBtn.addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
  zoomResetBtn.addEventListener("click", () => setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false }));
  }
  genderButtons.forEach((button) => {
    button.addEventListener("click", () => setSelectedGender(button.dataset.gender || ""));
  });
  if (locateViaGpsBtn) {
    locateViaGpsBtn.addEventListener("click", onLocateViaGps);
  }
  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });

  setCollectionActive(false);
  setSelectedGender("");

  await loadBuildingMaps();
  lastGeneratedClusterNumber = getMaxKnownClusterNumber(records);
  renderMarkers();
  renderRecords();
}

async function loadBuildingMaps() {
  const discoveredMaps = await discoverBuildingMaps();
  buildingMaps = normalizeBuildingMaps(discoveredMaps);

  if (!hasAnyBuildingFloors(buildingMaps)) {
    buildingMaps = normalizeBuildingMaps(LEGACY_BUILDING_MAPS);
  }

  const buildingIds = getBuildingIds();
  currentBuildingId = buildingIds.includes(DEFAULT_BUILDING_ID)
    ? DEFAULT_BUILDING_ID
    : buildingIds[0] || "";

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId, DEFAULT_FLOOR_ID);
  currentFloorId = floorSelect.value || "";

  updateMapForSelection();
}

async function discoverBuildingMaps() {
  const manifestMaps = await discoverBuildingMapsFromManifest();
  if (hasAnyBuildingFloors(manifestMaps)) {
    return manifestMaps;
  }

  const listedMaps = await discoverBuildingMapsFromDirectoryListing();
  if (hasAnyBuildingFloors(listedMaps)) {
    return listedMaps;
  }

  return LEGACY_BUILDING_MAPS;
}

async function discoverBuildingMapsFromManifest() {
  try {
    const response = await fetch(BUILDINGS_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    if (payload.buildings && typeof payload.buildings === "object" && !Array.isArray(payload.buildings)) {
      return payload.buildings;
    }

    return payload;
  } catch (error) {
    console.warn("Building manifest is unavailable or invalid:", error);
    return null;
  }
}

async function discoverBuildingMapsFromDirectoryListing() {
  try {
    const assetsUrl = new URL(ensureTrailingSlash(ASSETS_ROOT), window.location.href).href;
    const rootEntries = await listDirectoryEntries(assetsUrl);
    const buildings = {};

    const buildingDirectories = rootEntries.filter((entry) => entry.isDirectory);
    for (const buildingDirectory of buildingDirectories) {
      const floors = await discoverFloorsInDirectory(buildingDirectory.url);
      if (!Object.keys(floors).length) {
        continue;
      }

      buildings[buildingDirectory.name] = {
        label: formatBuildingLabel(buildingDirectory.name),
        floors,
      };
    }

    const rootFloors = extractFloorsFromEntries(rootEntries);
    if (Object.keys(rootFloors).length) {
      buildings[ROOT_BUILDING_ID] = {
        label: buildingDirectories.length ? "Shared Maps" : "Main Building",
        floors: rootFloors,
      };
    }

    return buildings;
  } catch (error) {
    console.warn("Directory listing discovery failed:", error);
    return null;
  }
}

async function discoverFloorsInDirectory(directoryUrl) {
  const entries = await listDirectoryEntries(directoryUrl);
  return extractFloorsFromEntries(entries);
}

function extractFloorsFromEntries(entries) {
  const floors = {};

  entries
    .filter((entry) => !entry.isDirectory)
    .forEach((entry) => {
      if (!MAP_FILE_PATTERN.test(entry.name)) {
        return;
      }

      const floorId = stripFileExtension(entry.name);
      if (!floorId || floors[floorId]) {
        return;
      }

      floors[floorId] = {
        label: formatFloorLabel(floorId),
        mapSrc: toPathFromUrl(entry.url),
      };
    });

  return floors;
}

async function listDirectoryEntries(directoryUrl) {
  const directory = new URL(ensureTrailingSlash(directoryUrl), window.location.href);
  const normalizedDirectoryPath = ensureTrailingSlash(directory.pathname);

  const response = await fetch(directory.href, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to read directory: ${directory.pathname}`);
  }

  const page = await response.text();
  const documentNode = new DOMParser().parseFromString(page, "text/html");
  const anchors = Array.from(documentNode.querySelectorAll("a[href]"));
  const entries = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("?")) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(href, directory.href);
    } catch {
      continue;
    }

    if (resolved.origin !== window.location.origin) {
      continue;
    }

    if (!resolved.pathname.startsWith(normalizedDirectoryPath)) {
      continue;
    }

    let relativeName = resolved.pathname.slice(normalizedDirectoryPath.length);
    if (!relativeName) {
      continue;
    }

    const isDirectory = relativeName.endsWith("/");
    relativeName = relativeName.replace(/\/$/, "");

    if (!relativeName || relativeName === ".." || relativeName.includes("/")) {
      continue;
    }

    const name = decodeURIComponent(relativeName);
    const dedupeKey = `${name}|${isDirectory ? "d" : "f"}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    entries.push({ name, isDirectory, url: resolved.href });
  }

  return entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return naturalCompare(left.name, right.name);
  });
}

function onBuildingChange(event) {
  currentBuildingId = event.target.value;
  renderFloorOptions(currentBuildingId);
  currentFloorId = floorSelect.value || "";
  userLocationPoint = null;
  setLocateStatus("Tap Locate via GPS to see your spot on the map.", "muted");

  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  userLocationPoint = null;
  setLocateStatus("Tap Locate via GPS to see your spot on the map.", "muted");
  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
}

function onCollectToggle() {
  if (isCollecting) {
    finishCollection();
    return;
  }
  startCollection();
}

function startCollection() {
  initializeAutoIdsForCollection();
  setCollectionActive(true);
  clearTemporarySelection();
  setCollectStatus(
    `Collecting started for ${getCurrentClusterIdLabel()}. Tap one person on the map, fill form, and save.`,
    "active"
  );
}

function finishCollection() {
  setCollectionActive(false);
  clearTemporarySelection();
  clearAutoIdsForCollection();
  setCollectStatus("Collection ended. Click Start to begin a new cluster.", "muted");
}

function setCollectionActive(active) {
  isCollecting = !!active;
  collectToggleBtn.textContent = isCollecting ? "End" : "Start";
  collectToggleBtn.classList.toggle("active", isCollecting);
  collectToggleBtn.setAttribute("aria-pressed", isCollecting ? "true" : "false");
}

function setCollectStatus(message, state = "muted") {
  collectStatus.textContent = message;
  collectStatus.dataset.state = state;
}

function setSelectedGender(value) {
  selectedGender = value === "male" || value === "female" ? value : "";
  genderButtons.forEach((button) => {
    const isActive = button.dataset.gender === selectedGender;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function initializeAutoIdsForCollection() {
  lastGeneratedClusterNumber = Math.max(lastGeneratedClusterNumber, getMaxKnownClusterNumber(records));
  currentClusterNumber = lastGeneratedClusterNumber + 1;
  lastGeneratedClusterNumber = currentClusterNumber;
  currentPersonNumber = 1;
  actorId.value = buildAutoActorId(currentClusterNumber, currentPersonNumber);
}

function clearAutoIdsForCollection() {
  currentClusterNumber = 0;
  currentPersonNumber = 0;
  actorId.value = "";
}

function advanceAutoPersonId() {
  if (!currentClusterNumber) {
    return;
  }

  currentPersonNumber = Math.max(1, currentPersonNumber) + 1;
  actorId.value = buildAutoActorId(currentClusterNumber, currentPersonNumber);
}

function restoreCurrentAutoPersonId() {
  if (!currentClusterNumber) {
    actorId.value = "";
    return;
  }

  currentPersonNumber = Math.max(1, currentPersonNumber);
  actorId.value = buildAutoActorId(currentClusterNumber, currentPersonNumber);
}

function getCurrentClusterIdLabel() {
  if (!currentClusterNumber) {
    return "";
  }
  return `CL${String(currentClusterNumber).padStart(4, "0")}`;
}

function buildAutoActorId(clusterNumber, personNumber) {
  return `CL${String(clusterNumber).padStart(4, "0")}-P${String(personNumber).padStart(3, "0")}`;
}

function getMaxKnownClusterNumber(values) {
  if (!Array.isArray(values)) {
    return 0;
  }

  let maxClusterNumber = 0;
  values.forEach((record) => {
    const parsedActor = parseAutoActorId(record && record.actorId);
    if (!parsedActor) {
      return;
    }

    maxClusterNumber = Math.max(maxClusterNumber, parsedActor.clusterNumber);
  });

  return maxClusterNumber;
}

function parseAutoActorId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(AUTO_ACTOR_ID_PATTERN);
  if (!match) {
    return null;
  }

  const clusterNumber = Number.parseInt(match[1], 10);
  const personNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(clusterNumber) || !Number.isFinite(personNumber)) {
    return null;
  }

  return { clusterNumber, personNumber };
}

function renderBuildingOptions(preferredBuildingId = "") {
  const buildingIds = getBuildingIds();

  buildingSelect.innerHTML = "";

  if (!buildingIds.length) {
    buildingSelect.disabled = true;
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No buildings";
    buildingSelect.appendChild(option);
    return;
  }

  buildingSelect.disabled = false;

  buildingIds.forEach((buildingId) => {
    const option = document.createElement("option");
    option.value = buildingId;
    option.textContent = getBuildingLabel(buildingId);
    buildingSelect.appendChild(option);
  });

  buildingSelect.value =
    preferredBuildingId && buildingMaps[preferredBuildingId] ? preferredBuildingId : buildingIds[0];
}

function renderFloorOptions(buildingId, preferredFloorId = "") {
  floorSelect.innerHTML = "";

  const floorIds = getFloorIds(buildingId);
  if (!floorIds.length) {
    floorSelect.disabled = true;
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No floors";
    floorSelect.appendChild(option);
    return;
  }

  floorSelect.disabled = false;

  floorIds.forEach((floorId) => {
    const option = document.createElement("option");
    option.value = floorId;
    option.textContent = getFloorLabel(buildingId, floorId);
    floorSelect.appendChild(option);
  });

  floorSelect.value = floorIds.includes(preferredFloorId) ? preferredFloorId : floorIds[0];
}

function updateMapForSelection() {
  const currentFloor = getFloorConfig(currentBuildingId, currentFloorId);
  if (!currentFloor) {
    mapImage.removeAttribute("src");
    mapImage.alt = "No indoor map available";
    return;
  }

  mapImage.src = currentFloor.mapSrc;
  mapImage.alt = `Indoor map ${getBuildingLabel(currentBuildingId)} ${currentFloor.label}`;
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

  const previousWidth = mapCanvas ? mapCanvas.clientWidth : 0;
  const previousHeight = mapCanvas ? mapCanvas.clientHeight : 0;
  const fallbackAnchor = preserveCenter ? { x: mapWrap.clientWidth / 2, y: mapWrap.clientHeight / 2 } : null;
  const activeAnchor = anchor || fallbackAnchor;

  let anchorXRatio = 0.5;
  let anchorYRatio = 0.5;
  if (activeAnchor && previousWidth && previousHeight) {
    anchorXRatio = (mapWrap.scrollLeft + activeAnchor.x) / previousWidth;
    anchorYRatio = (mapWrap.scrollTop + activeAnchor.y) / previousHeight;
  }

  mapZoomLevel = clampedZoom;
  if (mapCanvas) {
    mapCanvas.style.width = `${(mapZoomLevel * 100).toFixed(2)}%`;
  }
  updateZoomControls();
  renderMarkers();

  if (activeAnchor && mapCanvas) {
    const nextWidth = mapCanvas.clientWidth || previousWidth;
    const nextHeight = mapCanvas.clientHeight || previousHeight;
    if (nextWidth) {
      mapWrap.scrollLeft = clampScrollValue(nextWidth * anchorXRatio - activeAnchor.x);
    }
    if (nextHeight) {
      mapWrap.scrollTop = clampScrollValue(nextHeight * anchorYRatio - activeAnchor.y);
    }
  }
}

function clampZoom(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAP_ZOOM;
  }
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, value));
}

function updateZoomControls() {
  if (!zoomValue || !zoomOutBtn || !zoomInBtn) {
    return;
  }

  const zoomPercent = Math.round(mapZoomLevel * 100);
  zoomValue.textContent = `${zoomPercent}%`;
  zoomOutBtn.disabled = mapZoomLevel <= MIN_MAP_ZOOM + 0.0001;
  zoomInBtn.disabled = mapZoomLevel >= MAX_MAP_ZOOM - 0.0001;
}

function onMapWheel(event) {
  if (!mapImage || !mapImage.getAttribute("src")) {
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

function onMapPointerMove(event) {
  if (mousePanState && event.pointerId === mousePanState.pointerId) {
    const deltaX = event.clientX - mousePanState.startClientX;
    const deltaY = event.clientY - mousePanState.startClientY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      mousePanState.hasDragged = true;
    }

    mapWrap.scrollLeft = clampScrollValue(mousePanState.startScrollLeft - deltaX);
    mapWrap.scrollTop = clampScrollValue(mousePanState.startScrollTop - deltaY);
    lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
    return;
  }

  if (event.pointerType === "mouse" && event.buttons !== 0) {
    return;
  }
  lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
}

function onMapPointerDown(event) {
  if (event.pointerType !== "mouse" || event.button !== 0) {
    return;
  }
  if (mapZoomLevel <= DEFAULT_MAP_ZOOM || !hasScrollableMapArea()) {
    return;
  }

  mousePanState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScrollLeft: mapWrap.scrollLeft,
    startScrollTop: mapWrap.scrollTop,
    hasDragged: false,
  };
  mapWrap.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onMapPointerUp(event) {
  if (!mousePanState || event.pointerId !== mousePanState.pointerId) {
    return;
  }

  if (mousePanState.hasDragged) {
    suppressMapClickUntil = Date.now() + 250;
  }
  mapWrap.releasePointerCapture?.(event.pointerId);
  mousePanState = null;
}

function onMapImageDragStart(event) {
  if (mapZoomLevel > DEFAULT_MAP_ZOOM) {
    event.preventDefault();
  }
}

function onMapTouchStart(event) {
  if (event.touches.length === 1) {
    startMapTouchPan(event.touches[0]);
    return;
  }

  touchPanState = null;
  if (event.touches.length !== 2) {
    return;
  }

  pinchStartDistance = getTouchDistance(event.touches[0], event.touches[1]);
  pinchStartZoom = mapZoomLevel;
}

function onMapTouchMove(event) {
  if (event.touches.length === 1 && touchPanState) {
    const activeTouch = getTouchByIdentifier(event.touches, touchPanState.identifier);
    if (!activeTouch) {
      return;
    }

    const deltaX = activeTouch.clientX - touchPanState.startClientX;
    const deltaY = activeTouch.clientY - touchPanState.startClientY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      touchPanState.hasDragged = true;
    }

    event.preventDefault();
    mapWrap.scrollLeft = clampScrollValue(touchPanState.startScrollLeft - deltaX);
    mapWrap.scrollTop = clampScrollValue(touchPanState.startScrollTop - deltaY);
    lastZoomAnchor = getAnchorFromClientPoint(activeTouch.clientX, activeTouch.clientY);
    return;
  }

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

  const scale = nextDistance / pinchStartDistance;
  setMapZoom(pinchStartZoom * scale, { anchor });
}

function onMapTouchEnd(event) {
  if (event.touches.length < 2) {
    pinchStartDistance = 0;
    pinchStartZoom = mapZoomLevel;
  }

  if (touchPanState && event.touches.length === 1) {
    const remainingTouch = event.touches[0];
    startMapTouchPan(remainingTouch);
    return;
  }

  if (touchPanState && touchPanState.hasDragged) {
    suppressMapClickUntil = Date.now() + 250;
  }
  if (event.touches.length === 0) {
    touchPanState = null;
  }
}

function startMapTouchPan(touch) {
  if (!touch || mapZoomLevel <= DEFAULT_MAP_ZOOM || !hasScrollableMapArea()) {
    touchPanState = null;
    return;
  }

  touchPanState = {
    identifier: touch.identifier,
    startClientX: touch.clientX,
    startClientY: touch.clientY,
    startScrollLeft: mapWrap.scrollLeft,
    startScrollTop: mapWrap.scrollTop,
    hasDragged: false,
  };
}

function getTouchByIdentifier(touchList, identifier) {
  for (const touch of touchList) {
    if (touch.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function hasScrollableMapArea() {
  return mapWrap.scrollWidth > mapWrap.clientWidth || mapWrap.scrollHeight > mapWrap.clientHeight;
}

function getTouchDistance(leftTouch, rightTouch) {
  const dx = leftTouch.clientX - rightTouch.clientX;
  const dy = leftTouch.clientY - rightTouch.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAnchorFromTouchPair(leftTouch, rightTouch) {
  const midpointX = (leftTouch.clientX + rightTouch.clientX) / 2;
  const midpointY = (leftTouch.clientY + rightTouch.clientY) / 2;
  return getAnchorFromClientPoint(midpointX, midpointY);
}

function getAnchorFromClientPoint(clientX, clientY) {
  const rect = mapWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return normalizeZoomAnchor({
    x: clientX - rect.left,
    y: clientY - rect.top,
  });
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

function clampScrollValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function onMapClick(event) {
  if (event.target !== mapImage) return;
  if (Date.now() < suppressMapClickUntil) return;
  if (!isCollecting) {
    setCollectStatus("Click Start before selecting map points.", "warn");
    return;
  }

  const rect = mapImage.getBoundingClientRect();
  const xPx = event.clientX - rect.left;
  const yPx = event.clientY - rect.top;
  const xPct = (xPx / rect.width) * 100;
  const yPct = (yPx / rect.height) * 100;

  selectedPoint = {
    xPct: round2(xPct),
    yPct: round2(yPct),
    xPx: Math.round(xPx),
    yPx: Math.round(yPx),
  };
  const clickTime = new Date();
  selectedPointTimestampIso = clickTime.toISOString();
  activityTime.value = toDateTimeLocalValue(clickTime);

  selectedCoords.textContent = `${selectedPoint.xPct}%, ${selectedPoint.yPct}%`;
  renderMarkers();
}

async function onPhotoChange(event) {
  const file = event.target.files?.[0];
  selectedPhotoLocation = null;
  selectedPhotoName = "";
  selectedPhotoPreviewDataUrl = "";

  if (!file) {
    setPhotoLocationStatus("No image selected.", "muted");
    return;
  }

  selectedPhotoName = file.name;
  selectedPhotoPreviewDataUrl = await createPhotoPreviewDataUrl(file);
  isPhotoLocationLoading = true;
  setPhotoLocationStatus("Reading GPS metadata from image...", "muted");

  try {
    const extractedLocation = await extractPhotoLocationFromImage(file);
    selectedPhotoLocation = extractedLocation;

    if (!extractedLocation) {
      setPhotoLocationStatus("No EXIF GPS found. Requesting current device location...", "muted");
      try {
        const fallbackLocation = await requestCurrentDeviceLocation();
        selectedPhotoLocation = fallbackLocation;
        const fallbackText = `${formatCoordinate(fallbackLocation.latitude)}, ${formatCoordinate(
          fallbackLocation.longitude
        )}`;
        setPhotoLocationStatus(`EXIF missing. Using current device location: ${fallbackText}`, "success");
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError && typeof fallbackError.message === "string" && fallbackError.message
            ? fallbackError.message
            : "Could not get current device location.";
        setPhotoLocationStatus(`Image selected, but GPS was unavailable: ${fallbackMessage}`, "warn");
      }
      return;
    }

    const gpsText = `${formatCoordinate(extractedLocation.latitude)}, ${formatCoordinate(
      extractedLocation.longitude
    )}`;
    setPhotoLocationStatus(`GPS found: ${gpsText}`, "success");
  } catch (error) {
    setPhotoLocationStatus(`Could not read photo GPS: ${error.message}`, "error");
  } finally {
    isPhotoLocationLoading = false;
  }
}

async function onLocateViaGps() {
  if (!locateViaGpsBtn || isLocatingViaGps) {
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    setLocateStatus("Select a building and floor first.", "warn");
    return;
  }

  isLocatingViaGps = true;
  locateViaGpsBtn.disabled = true;
  setLocateStatus("Requesting device location...", "muted");

  try {
    const deviceLocation = await requestCurrentDeviceLocation();
    const params = new URLSearchParams({
      building_id: currentBuildingId,
      floor_id: currentFloorId,
      latitude: String(deviceLocation.latitude),
      longitude: String(deviceLocation.longitude),
    });

    const response = await fetch(`/api/locate-via-gps/?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `Server returned ${response.status}`);
    }

    const payload = await response.json();
    const location = payload?.location;
    if (!location || typeof location.xPct !== "number" || typeof location.yPct !== "number") {
      throw new Error("Server did not return a valid location.");
    }

    userLocationPoint = {
      xPct: clampPercent(location.xPct),
      yPct: clampPercent(location.yPct),
      source: deviceLocation,
    };

    setLocateStatus(
      `Image location ${round2(userLocationPoint.xPct)}%, ${round2(userLocationPoint.yPct)}%`,
      "success"
    );
    renderMarkers();
  } catch (error) {
    console.error("Locate via GPS failed:", error);
    userLocationPoint = null;
    setLocateStatus(error?.message || "Could not determine location.", "error");
    renderMarkers();
  } finally {
    isLocatingViaGps = false;
    locateViaGpsBtn.disabled = false;
  }
}

function onFormSubmit(event) {
  event.preventDefault();

  if (!isCollecting) {
    alert("Click Start before saving records.");
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    alert("No building/floor map is available. Check your assets folder.");
    return;
  }

  if (isPhotoLocationLoading) {
    alert("Please wait for image GPS extraction to finish.");
    return;
  }

  if (!selectedPoint) {
    alert("Please click a person location on the map before saving.");
    return;
  }

  if (!selectedGender) {
    alert("Please select gender (male or female).");
    return;
  }

  if (!ageGroup.value.trim()) {
    alert("Please select an age group.");
    return;
  }

  const autoActorId = actorId.value.trim();
  if (!autoActorId) {
    alert("Auto ID is unavailable. Click End and Start collection again.");
    return;
  }

  const parsedActivityTime = new Date(activityTime.value);
  const fallbackActivityTime = Number.isNaN(parsedActivityTime.getTime())
    ? new Date().toISOString()
    : parsedActivityTime.toISOString();
  const safeActivityTime =
    selectedPoint && selectedPointTimestampIso ? selectedPointTimestampIso : fallbackActivityTime;

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    buildingId: currentBuildingId,
    floorId: currentFloorId,
    activityType: activityType.value.trim(),
    actorId: autoActorId,
    gender: selectedGender,
    ageGroup: ageGroup.value.trim(),
    activityTime: safeActivityTime,
    notes: notes.value.trim(),
    location: selectedPoint ? { ...selectedPoint } : null,
    photoName: selectedPhotoName || null,
    photoPreview: selectedPhotoPreviewDataUrl || null,
    photoLocation: selectedPhotoLocation ? { ...selectedPhotoLocation } : null,
  };

  records.push(record);
  saveRecords(records);
  resetForm(false, true);
  setSavePrompt(`Saved ${autoActorId} successfully.`, "success");
  setCollectStatus("Record saved. Click next person point or End to finish.", "active");
  renderMarkers();
  renderRecords();
}

function onExport() {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `indoor-activity-records-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetForm(resetDateTime = true, advanceActorId = false) {
  const previousActorId = actorId.value;
  activityForm.reset();
  if (resetDateTime) {
    activityTime.value = toDateTimeLocalValue(new Date());
  }
  selectedPoint = null;
  selectedPointTimestampIso = "";
  setSelectedGender("");
  selectedPhotoLocation = null;
  selectedPhotoName = "";
  selectedPhotoPreviewDataUrl = "";
  isPhotoLocationLoading = false;
  photoInput.value = "";
  selectedCoords.textContent = "None";
  setPhotoLocationStatus("No image selected.", "muted");
  if (isCollecting && currentClusterNumber) {
    if (advanceActorId) {
      advanceAutoPersonId();
    } else if (previousActorId) {
      actorId.value = previousActorId;
    } else {
      restoreCurrentAutoPersonId();
    }
  } else {
    actorId.value = "";
  }
  renderMarkers();
}

function clearTemporarySelection() {
  selectedPoint = null;
  selectedPointTimestampIso = "";
  selectedCoords.textContent = "None";
  renderMarkers();
}

function deleteRecord(id) {
  records = records.filter((record) => record.id !== id);
  saveRecords(records);
  renderMarkers();
  renderRecords();
}

function renderMarkers() {
  const overlayHost = mapCanvas || mapWrap;
  overlayHost.querySelectorAll(".marker, .cluster-link").forEach((node) => node.remove());

  const visibleRecords = records.filter((record) => {
    const recordBuildingId = getRecordBuildingId(record);
    if (recordBuildingId !== currentBuildingId) {
      return false;
    }

    const recordFloorId = getRecordFloorId(record, recordBuildingId);
    if (recordFloorId !== currentFloorId) {
      return false;
    }

    return hasMapLocation(record.location);
  });

  drawClusterLinks(visibleRecords);

  visibleRecords.forEach((record) => {
    createMarker(record.location.xPct, record.location.yPct, false);
  });

  if (selectedPoint) {
    drawSelectedPointClusterLink(visibleRecords);
    createMarker(selectedPoint.xPct, selectedPoint.yPct, true);
  }

  if (userLocationPoint) {
    renderUserLocationMarker();
  }
}

function drawClusterLinks(visibleRecords) {
  const clusterPoints = new Map();

  visibleRecords.forEach((record) => {
    const parsedActor = parseAutoActorId(record.actorId);
    if (!parsedActor || !hasMapLocation(record.location)) {
      return;
    }

    const currentPoints = clusterPoints.get(parsedActor.clusterNumber) || [];
    currentPoints.push({
      xPct: record.location.xPct,
      yPct: record.location.yPct,
      personNumber: parsedActor.personNumber,
      activityTime: record.activityTime || "",
    });
    clusterPoints.set(parsedActor.clusterNumber, currentPoints);
  });

  clusterPoints.forEach((points) => {
    points.sort((left, right) => {
      if (left.personNumber !== right.personNumber) {
        return left.personNumber - right.personNumber;
      }
      return String(left.activityTime).localeCompare(String(right.activityTime));
    });

    for (let index = 1; index < points.length; index += 1) {
      createClusterLink(points[index - 1], points[index], false);
    }
  });
}

function drawSelectedPointClusterLink(visibleRecords) {
  if (!selectedPoint || !isCollecting || !currentClusterNumber) {
    return;
  }

  const currentClusterRecords = visibleRecords
    .map((record) => {
      const parsedActor = parseAutoActorId(record.actorId);
      if (!parsedActor || parsedActor.clusterNumber !== currentClusterNumber) {
        return null;
      }

      return {
        xPct: record.location.xPct,
        yPct: record.location.yPct,
        personNumber: parsedActor.personNumber,
        activityTime: record.activityTime || "",
      };
    })
    .filter((entry) => entry !== null);

  if (!currentClusterRecords.length) {
    return;
  }

  currentClusterRecords.sort((left, right) => {
    if (left.personNumber !== right.personNumber) {
      return left.personNumber - right.personNumber;
    }
    return String(left.activityTime).localeCompare(String(right.activityTime));
  });

  const lastPoint = currentClusterRecords[currentClusterRecords.length - 1];
  createClusterLink(lastPoint, selectedPoint, true);
}

function createClusterLink(fromPoint, toPoint, preview) {
  const overlayHost = mapCanvas || mapWrap;
  const fromPixels = toMapPixelPoint(fromPoint);
  const toPixels = toMapPixelPoint(toPoint);
  if (!fromPixels || !toPixels) {
    return;
  }

  const dx = toPixels.x - fromPixels.x;
  const dy = toPixels.y - fromPixels.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (!Number.isFinite(length) || length <= 0) {
    return;
  }

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const line = document.createElement("span");
  line.className = preview ? "cluster-link preview" : "cluster-link";
  line.style.left = `${fromPixels.x}px`;
  line.style.top = `${fromPixels.y}px`;
  line.style.width = `${length}px`;
  line.style.transform = `translateY(-50%) rotate(${angle}deg)`;
  overlayHost.appendChild(line);
}

function toMapPixelPoint(point) {
  const overlayHost = mapCanvas || mapWrap;
  if (!point || typeof point.xPct !== "number" || typeof point.yPct !== "number") {
    return null;
  }

  const mapWidth = mapImage.clientWidth || overlayHost.clientWidth;
  const mapHeight = mapImage.clientHeight || overlayHost.clientHeight;
  if (!mapWidth || !mapHeight) {
    return null;
  }

  return {
    x: (point.xPct / 100) * mapWidth,
    y: (point.yPct / 100) * mapHeight,
  };
}

function createMarker(xPct, yPct, selected) {
  const overlayHost = mapCanvas || mapWrap;
  const marker = document.createElement("span");
  marker.className = selected ? "marker selected" : "marker";
  marker.style.left = `${xPct}%`;
  marker.style.top = `${yPct}%`;
  overlayHost.appendChild(marker);
}

function renderUserLocationMarker() {
  if (!userLocationPoint) {
    return;
  }

  createUserLocationMarker(userLocationPoint.xPct, userLocationPoint.yPct);
}

function createUserLocationMarker(xPct, yPct) {
  const overlayHost = mapCanvas || mapWrap;
  if (!overlayHost || !Number.isFinite(xPct) || !Number.isFinite(yPct)) {
    return;
  }

  const marker = document.createElement("span");
  marker.className = "marker user-location";
  marker.style.left = `${xPct}%`;
  marker.style.top = `${yPct}%`;
  overlayHost.appendChild(marker);
}

function renderRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = records
    .slice()
    .sort((left, right) => right.activityTime.localeCompare(left.activityTime))
    .filter((record) => {
      const recordBuildingId = getRecordBuildingId(record);
      const recordFloorId = getRecordFloorId(record, recordBuildingId);

      if (recordBuildingId !== currentBuildingId || recordFloorId !== currentFloorId) {
        return false;
      }

      if (!query) {
        return true;
      }

      const target = [
        record.activityType,
        record.actorId,
        formatGender(record.gender),
        formatAgeGroup(record.ageGroup),
        record.notes,
        getBuildingLabel(recordBuildingId),
        getFloorLabel(recordBuildingId, recordFloorId),
        formatDate(record.activityTime),
        formatMapLocation(record.location),
        formatPhotoLocationText(record.photoLocation, record.photoName),
      ]
        .join(" ")
        .toLowerCase();

      return target.includes(query);
    });

  recordsTbody.innerHTML = "";

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="12">No records yet for this building and floor.</td>`;
    recordsTbody.appendChild(tr);
    return;
  }

  filtered.forEach((record) => {
    const recordBuildingId = getRecordBuildingId(record);
    const recordFloorId = getRecordFloorId(record, recordBuildingId);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(record.activityTime)}</td>
      <td>${escapeHtml(record.activityType)}</td>
      <td>${escapeHtml(record.actorId || "-")}</td>
      <td>${escapeHtml(formatGender(record.gender))}</td>
      <td>${escapeHtml(formatAgeGroup(record.ageGroup))}</td>
      <td>${escapeHtml(getBuildingLabel(recordBuildingId))}</td>
      <td>${escapeHtml(getFloorLabel(recordBuildingId, recordFloorId))}</td>
      <td>${escapeHtml(formatMapLocation(record.location))}</td>
      <td>${formatPhotoPreviewCell(record.photoPreview, record.photoName)}</td>
      <td>${escapeHtml(formatPhotoLocationText(record.photoLocation, record.photoName))}</td>
      <td>${escapeHtml(record.notes || "-")}</td>
      <td><button type="button" class="danger" data-delete-id="${record.id}">Delete</button></td>
    `;
    recordsTbody.appendChild(tr);
  });

  recordsTbody.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.deleteId));
  });
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((record) => normalizeRecord(record))
      .filter((record) => record !== null);
  } catch {
    return [];
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;

  return {
    ...record,
    buildingId: typeof record.buildingId === "string" && record.buildingId.trim() ? record.buildingId : null,
    floorId: typeof record.floorId === "string" && record.floorId.trim() ? record.floorId : null,
    gender: normalizeGender(record.gender),
    ageGroup: normalizeAgeGroup(record.ageGroup),
    location: hasMapLocation(record.location) ? { ...record.location } : null,
    photoLocation: isValidPhotoLocation(record.photoLocation) ? { ...record.photoLocation } : null,
    photoName: typeof record.photoName === "string" && record.photoName.trim() ? record.photoName : null,
    photoPreview: normalizePhotoPreview(record.photoPreview),
  };
}

function saveRecords(nextRecords) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
}

function normalizeBuildingMaps(rawMaps) {
  if (!rawMaps || typeof rawMaps !== "object" || Array.isArray(rawMaps)) {
    return {};
  }

  const normalized = {};
  const buildingEntries = Object.entries(rawMaps).sort(([leftId], [rightId]) =>
    naturalCompare(String(leftId), String(rightId))
  );

  buildingEntries.forEach(([rawBuildingId, rawBuilding]) => {
    if (!rawBuilding || typeof rawBuilding !== "object" || Array.isArray(rawBuilding)) {
      return;
    }

    const buildingId = String(rawBuildingId);
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
        label:
          typeof floor.label === "string" && floor.label.trim()
            ? floor.label.trim()
            : formatFloorLabel(floorId),
        mapSrc: floor.mapSrc.trim(),
      };
    });

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
  if (!candidateMaps || typeof candidateMaps !== "object" || Array.isArray(candidateMaps)) {
    return false;
  }

  return Object.values(candidateMaps).some((building) => {
    if (!building || typeof building !== "object") {
      return false;
    }

    const floors = building.floors;
    return !!floors && typeof floors === "object" && Object.keys(floors).length > 0;
  });
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

function getRecordBuildingId(record) {
  const candidateBuildingId = typeof record.buildingId === "string" ? record.buildingId : "";
  if (candidateBuildingId && buildingMaps[candidateBuildingId]) {
    return candidateBuildingId;
  }

  const candidateFloorId = typeof record.floorId === "string" ? record.floorId : "";
  if (candidateFloorId) {
    const matchedBuildingId = getBuildingIds().find(
      (buildingId) => buildingMaps[buildingId].floors[candidateFloorId]
    );
    if (matchedBuildingId) {
      return matchedBuildingId;
    }
  }

  return getBuildingIds()[0] || "";
}

function getRecordFloorId(record, buildingId = getRecordBuildingId(record)) {
  const candidateFloorId = typeof record.floorId === "string" ? record.floorId : "";
  const building = buildingMaps[buildingId];
  if (!building) {
    return "";
  }

  if (candidateFloorId && building.floors[candidateFloorId]) {
    return candidateFloorId;
  }

  return getFloorIds(buildingId)[0] || "";
}

function getBuildingLabel(buildingId) {
  return buildingMaps[buildingId]?.label || "Unknown Building";
}

function getFloorLabel(buildingId, floorId) {
  return buildingMaps[buildingId]?.floors?.[floorId]?.label || "Unknown Floor";
}

function hasMapLocation(location) {
  return !!location && typeof location.xPct === "number" && typeof location.yPct === "number";
}

function isValidPhotoLocation(photoLocation) {
  return (
    !!photoLocation &&
    typeof photoLocation.latitude === "number" &&
    typeof photoLocation.longitude === "number"
  );
}

function formatMapLocation(location) {
  if (!hasMapLocation(location)) return "-";
  return `${location.xPct}%, ${location.yPct}%`;
}

function formatPhotoLocationText(photoLocation, photoName) {
  const normalizedPhotoName =
    typeof photoName === "string" && photoName.trim() ? photoName.trim() : "";

  if (!isValidPhotoLocation(photoLocation)) {
    return normalizedPhotoName ? `${normalizedPhotoName} (no GPS)` : "-";
  }

  const coordinates = `${formatCoordinate(photoLocation.latitude)}, ${formatCoordinate(
    photoLocation.longitude
  )}`;
  return normalizedPhotoName ? `${coordinates} (${normalizedPhotoName})` : coordinates;
}

function formatGender(gender) {
  if (gender === "male") {
    return "Male";
  }
  if (gender === "female") {
    return "Female";
  }
  return "-";
}

function formatAgeGroup(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function normalizeGender(value) {
  if (value === "male" || value === "female") {
    return value;
  }
  return null;
}

function normalizeAgeGroup(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function formatPhotoPreviewCell(photoPreview, photoName) {
  const normalizedPreview = normalizePhotoPreview(photoPreview);
  if (!normalizedPreview) {
    return "-";
  }

  const altText = escapeHtml(photoName ? `${photoName} preview` : "Photo preview");
  return `<img class="record-photo-preview" src="${normalizedPreview}" alt="${altText}" loading="lazy" decoding="async">`;
}

function normalizePhotoPreview(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_PREVIEW_DATA_URL_LENGTH) {
    return null;
  }

  if (!PREVIEW_DATA_URL_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

async function createPhotoPreviewDataUrl(file) {
  if (!(file instanceof File)) {
    return "";
  }

  let image;
  try {
    image = await loadImageFromFile(file);
  } catch {
    return "";
  }

  let targetWidth = image.naturalWidth || image.width;
  let targetHeight = image.naturalHeight || image.height;
  if (!targetWidth || !targetHeight) {
    return "";
  }

  const sizeScale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(targetWidth, targetHeight));
  targetWidth = Math.max(1, Math.round(targetWidth * sizeScale));
  targetHeight = Math.max(1, Math.round(targetHeight * sizeScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    return "";
  }

  let bestAttempt = "";
  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    for (let quality = 0.82; quality >= 0.35; quality -= 0.12) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const byteSize = estimateDataUrlByteSize(dataUrl);
      if (byteSize <= MAX_PREVIEW_BYTES) {
        return dataUrl;
      }
      bestAttempt = dataUrl;
    }

    const nextWidth = Math.max(PREVIEW_MIN_DIMENSION, Math.round(targetWidth * 0.82));
    const nextHeight = Math.max(PREVIEW_MIN_DIMENSION, Math.round(targetHeight * 0.82));
    if (nextWidth === targetWidth && nextHeight === targetHeight) {
      break;
    }

    targetWidth = nextWidth;
    targetHeight = nextHeight;
  }

  if (bestAttempt && estimateDataUrlByteSize(bestAttempt) <= MAX_PREVIEW_BYTES) {
    return bestAttempt;
  }
  return "";
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode image file."));
    };

    image.src = objectUrl;
  });
}

function estimateDataUrlByteSize(dataUrl) {
  if (typeof dataUrl !== "string") {
    return 0;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return 0;
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function toDateTimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatCoordinate(value) {
  return (Math.round(value * 1000000) / 1000000).toFixed(6);
}

function setPhotoLocationStatus(message, state) {
  photoLocationStatus.textContent = message;
  photoLocationStatus.dataset.state = state;
}

function setLocateStatus(message, state = "muted") {
  if (!locateStatus) {
    return;
  }

  locateStatus.textContent = message;
  locateStatus.dataset.state = state;
}

function setSavePrompt(message, state = "muted") {
  if (!savePrompt) {
    return;
  }

  savePrompt.textContent = message;
  savePrompt.dataset.state = state;

  if (savePromptTimerId) {
    window.clearTimeout(savePromptTimerId);
    savePromptTimerId = 0;
  }

  if (state === "success" && message) {
    savePromptTimerId = window.setTimeout(() => {
      setSavePrompt("", "muted");
    }, 2600);
  }
}

function formatBuildingLabel(value) {
  return toDisplayLabel(value);
}

function formatFloorLabel(value) {
  const label = toDisplayLabel(value);
  const floorMatch = label.match(/^Floor\s*(\d+)$/i);
  if (floorMatch) {
    return `Floor ${floorMatch[1]}`;
  }
  return label;
}

function toDisplayLabel(value) {
  const cleaned = String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Unnamed";
  }

  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function stripFileExtension(fileName) {
  return String(fileName).replace(/\.[^.]+$/, "");
}

function toPathFromUrl(urlString) {
  const url = new URL(urlString);
  return `${url.pathname}${url.search}`;
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
