import { requestCurrentDeviceDirection, requestCurrentDeviceLocation } from "./image-location.js";

const API_BUILDINGS = "/api/buildings/";
const API_ASSET_JSON = "/api/assets/json/";
const API_LOCATE_VIA_GPS = "/api/locate-via-gps/";
const API_MYHUB_PINS = "/api/myhub-pins/";
const PIC_VIEWER_TEMPLATE_URL = "/static/collector/panorama-viewer.html";
const ROOT_BUILDING_ID = "__root__";
const DEFAULT_BUILDING_ID = "SUTD";
const DEFAULT_FLOOR_ID = "main-buildings";
const DEFAULT_MYHUB_STATUS_MESSAGE = "Choose a category, then tap the map to place it.";
const MIN_MAP_ZOOM = 0.25;
const MAX_MAP_ZOOM = 16;
const MAP_ZOOM_STEP = 0.1;
const DEFAULT_MAP_ZOOM = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const OPEN_IDEA_CATEGORY_KEY = "open_idea";
const OPEN_IDEA_MAX_LENGTH = 128;

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

const MYHUB_CATEGORIES = [
  { key: OPEN_IDEA_CATEGORY_KEY, label: "Open idea", color: "#0d9488" },
  { key: "tables", label: "Tables", color: "#2563eb" },
  { key: "benches", label: "Benches", color: "#0f766e" },
  { key: "soft_seating_corners", label: "Soft seating corners", color: "#db2777" },
  { key: "courtyards", label: "Courtyards", color: "#65a30d" },
  { key: "atriums", label: "Atriums", color: "#7c3aed" },
  { key: "activity_rooms", label: "Activity rooms", color: "#ea580c" },
  { key: "childrens_play_areas", label: "Children's play areas", color: "#0891b2" },
  { key: "reading_corners", label: "Reading corners", color: "#4f46e5" },
  { key: "planting_areas", label: "Planting areas", color: "#16a34a" },
  { key: "event_spaces", label: "Event spaces", color: "#dc2626" },
  { key: "exercise_areas", label: "Exercise areas", color: "#ca8a04" },
  { key: "makerspaces", label: "Makerspaces", color: "#9333ea" },
];

const mapWrap = document.getElementById("mapWrap");
const mapCanvas = document.getElementById("mapCanvas");
const mapImage = document.getElementById("mapImage");
const pinLayer = document.getElementById("myhubPinLayer");
const mapEmptyState = document.getElementById("myhubMapEmptyState");
const buildingSelect = document.getElementById("buildingSelect");
const floorSelect = document.getElementById("floorSelect");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomValue = document.getElementById("zoomValue");
const locateViaGpsBtn = document.getElementById("locateViaGpsBtn");
const locateViaPoiBtn = document.getElementById("locateViaPoiBtn");
const locateViaPicBtn = document.getElementById("locateViaPicBtn");
const categoryPalette = document.getElementById("myhubCategoryPalette");
const itemsToggleBtn = document.getElementById("myhubItemsToggle");
const itemsPanel = document.getElementById("myhubItemsPanel");
const itemSummary = document.getElementById("myhubItemSummary");
const barChart = document.getElementById("myhubBarChart");
const statusEl = document.getElementById("myhubStatus");
const openIdeaModal = document.getElementById("openIdeaModal");
const openIdeaForm = document.getElementById("openIdeaForm");
const openIdeaInput = document.getElementById("openIdeaInput");
const openIdeaError = document.getElementById("openIdeaError");
const openIdeaCount = document.getElementById("openIdeaCount");
const picPreviewModal = document.getElementById("picPreviewModal");
const picPreviewFrame = document.getElementById("picPreviewFrame");
const picPreviewModalCoords = document.getElementById("picPreviewModalCoords");
const poiMapsCache = new Map();
const poiLoadPromises = new Map();
const photoMapsCache = new Map();
const photoLoadPromises = new Map();

let buildingMaps = {};
let assetsBaseUrl = "";
let currentBuildingId = "";
let currentFloorId = "";
let mapZoomLevel = DEFAULT_MAP_ZOOM;
let lastZoomAnchor = null;
let pinchStartDistance = 0;
let pinchStartZoom = DEFAULT_MAP_ZOOM;
let activeCategoryKey = MYHUB_CATEGORIES[0].key;
let pins = [];
let isSavingPin = false;
let userLocationPoint = null;
let isLocatingViaGps = false;
let isLocatingViaPoi = false;
let poiVisible = false;
let picOverlayVisible = false;
let poiRequestToken = 0;
let photoRequestToken = 0;
let shouldAnimatePois = false;
let questionnaireContext = parseQuestionnaireContext();
let pendingOpenIdeaResolve = null;

initialize();

async function initialize() {
  renderCategoryPalette();
  setStatus(DEFAULT_MYHUB_STATUS_MESSAGE, "muted");
  buildingSelect.innerHTML = '<option value="" selected>Building</option>';
  floorSelect.innerHTML = '<option value="" selected>Floor</option>';
  setSelectPlaceholderState(buildingSelect);
  setSelectPlaceholderState(floorSelect);

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  mapImage.addEventListener("pointerdown", onMapPointerDown);
  mapWrap.addEventListener("pointermove", onMapPointerMove);
  mapWrap.addEventListener("wheel", onMapWheel, { passive: false });
  mapWrap.addEventListener("touchstart", onMapTouchStart, { passive: true });
  mapWrap.addEventListener("touchmove", onMapTouchMove, { passive: false });
  mapWrap.addEventListener("touchend", onMapTouchEnd, { passive: true });
  mapWrap.addEventListener("touchcancel", onMapTouchEnd, { passive: true });
  mapImage.addEventListener("load", () => {
    updateMapEmptyState();
    renderPins();
    updateZoomControls();
  });
  window.addEventListener("resize", renderPins);
  zoomOutBtn.addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
  zoomInBtn.addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
  zoomResetBtn.addEventListener("click", () => setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false }));
  if (locateViaGpsBtn) {
    locateViaGpsBtn.addEventListener("click", onLocateViaGps);
  }
  if (locateViaPoiBtn) {
    locateViaPoiBtn.addEventListener("click", onLocateViaPoi);
  }
  if (locateViaPicBtn) {
    locateViaPicBtn.addEventListener("click", () => {
      void onLocateViaPic();
    });
  }
  if (picPreviewModal) {
    picPreviewModal.addEventListener("click", onPicPreviewModalClick);
  }
  if (itemsToggleBtn) {
    itemsToggleBtn.addEventListener("click", toggleItemsPanel);
  }
  if (openIdeaForm) {
    openIdeaForm.addEventListener("submit", onOpenIdeaFormSubmit);
  }
  if (openIdeaInput) {
    openIdeaInput.addEventListener("input", updateOpenIdeaCount);
  }
  if (openIdeaModal) {
    openIdeaModal.addEventListener("click", onOpenIdeaModalClick);
  }
  document.addEventListener("keydown", onDocumentKeydown);

  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });

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
  const preferredBuildingId = questionnaireContext.buildingId;
  currentBuildingId = preferredBuildingId && buildingIds.includes(preferredBuildingId)
    ? preferredBuildingId
    : buildingIds.includes(DEFAULT_BUILDING_ID) ? DEFAULT_BUILDING_ID : buildingIds[0] || "";

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId, questionnaireContext.floorId || DEFAULT_FLOOR_ID);
  currentFloorId = floorSelect.value || "";
  await loadPins();
  updateMapForSelection();
  updateQuestionnaireContextStatus();
}

async function fetchBuildingMaps() {
  try {
    const payload = await apiGet(API_BUILDINGS);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    assetsBaseUrl = normalizeAssetsBaseUrl(payload.assetsBaseUrl);
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
    setSelectPlaceholderState(buildingSelect);
    return;
  }

  buildingSelect.disabled = false;
  buildingIds.forEach((buildingId) => {
    buildingSelect.appendChild(new Option(getBuildingLabel(buildingId), buildingId));
  });
  buildingSelect.value = preferredBuildingId && buildingMaps[preferredBuildingId] ? preferredBuildingId : buildingIds[0];
  setSelectPlaceholderState(buildingSelect);
}

function renderFloorOptions(buildingId, preferredFloorId = "") {
  const floorIds = getFloorIds(buildingId);
  floorSelect.innerHTML = "";

  if (!floorIds.length) {
    floorSelect.disabled = true;
    floorSelect.appendChild(new Option("No floors", ""));
    setSelectPlaceholderState(floorSelect);
    return;
  }

  floorSelect.disabled = false;
  floorIds.forEach((floorId) => {
    floorSelect.appendChild(new Option(getFloorLabel(buildingId, floorId), floorId));
  });
  floorSelect.value = floorIds.includes(preferredFloorId) ? preferredFloorId : floorIds[0];
  setSelectPlaceholderState(floorSelect);
}

function onBuildingChange(event) {
  currentBuildingId = event.target.value;
  setSelectPlaceholderState(buildingSelect);
  renderFloorOptions(currentBuildingId);
  currentFloorId = floorSelect.value || "";
  userLocationPoint = null;
  if (!poiVisible && !picOverlayVisible) {
    resetLocateStatusToBase();
  }
  updateMapForSelection();
  if (poiVisible) {
    void refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
  } else if (picOverlayVisible) {
    void refreshPhotoOverlayForCurrentFloor({ loadingMessage: "Loading photos for this floor..." });
  }
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  setSelectPlaceholderState(floorSelect);
  userLocationPoint = null;
  if (!poiVisible && !picOverlayVisible) {
    resetLocateStatusToBase();
  }
  updateMapForSelection();
  if (poiVisible) {
    void refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
  } else if (picOverlayVisible) {
    void refreshPhotoOverlayForCurrentFloor({ loadingMessage: "Loading photos for this floor..." });
  }
}

function updateMapForSelection() {
  const currentFloor = getFloorConfig(currentBuildingId, currentFloorId);
  if (!currentFloor) {
    mapImage.removeAttribute("src");
    mapImage.alt = "No indoor map available";
    updateMapEmptyState();
    renderPins();
    renderLocateOverlays();
    renderItemDistribution();
    return;
  }

  mapImage.src = currentFloor.mapSrc;
  mapImage.alt = `Indoor map ${getBuildingLabel(currentBuildingId)} ${currentFloor.label}`;
  updateMapEmptyState();
  renderPins();
  renderLocateOverlays();
  renderItemDistribution();
}

function renderCategoryPalette() {
  categoryPalette.innerHTML = MYHUB_CATEGORIES.map((category) => {
    const active = category.key === activeCategoryKey;
    return `
      <button
        type="button"
        class="myhub-category-button"
        data-myhub-category="${escapeHtml(category.key)}"
        aria-pressed="${active ? "true" : "false"}"
        style="--category-color: ${category.color};"
      >
        <span class="myhub-color-dot" aria-hidden="true"></span>
        <span>${escapeHtml(category.label)}</span>
      </button>
    `;
  }).join("");

  categoryPalette.querySelectorAll("[data-myhub-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategoryKey = button.dataset.myhubCategory || MYHUB_CATEGORIES[0].key;
      renderCategoryPalette();
      const category = getCategory(activeCategoryKey);
      if (category.key === OPEN_IDEA_CATEGORY_KEY) {
        setStatus("Open idea active. Tap the map, then enter your idea text.", "muted");
        return;
      }
      setStatus(`${category.label} active. Tap the map to place a pin.`, "muted");
    });
  });
}

function requestOpenIdeaLabel() {
  if (!openIdeaModal || !openIdeaForm || !openIdeaInput) {
    setStatus("Open idea input is unavailable.", "error");
    return Promise.resolve(null);
  }

  if (pendingOpenIdeaResolve) {
    pendingOpenIdeaResolve(null);
  }

  openIdeaForm.reset();
  setOpenIdeaError("");
  updateOpenIdeaCount();
  openIdeaModal.hidden = false;
  openIdeaModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.requestAnimationFrame(() => openIdeaInput.focus());

  return new Promise((resolve) => {
    pendingOpenIdeaResolve = resolve;
  });
}

function onOpenIdeaFormSubmit(event) {
  event.preventDefault();
  if (!openIdeaInput) {
    closeOpenIdeaModal(null);
    return;
  }

  const normalized = openIdeaInput.value.trim();
  if (!normalized) {
    setOpenIdeaError("Enter idea text before placing it.");
    return;
  }
  if (normalized.length > OPEN_IDEA_MAX_LENGTH) {
    setOpenIdeaError(`Keep open idea text to ${OPEN_IDEA_MAX_LENGTH} characters or fewer.`);
    return;
  }

  closeOpenIdeaModal(normalized);
}

function onOpenIdeaModalClick(event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.hasAttribute("data-open-idea-close")) {
    closeOpenIdeaModal(null);
  }
}

function onDocumentKeydown(event) {
  if (event.key === "Escape" && openIdeaModal && !openIdeaModal.hidden) {
    closeOpenIdeaModal(null);
  }
}

function closeOpenIdeaModal(value) {
  if (!openIdeaModal) {
    return;
  }

  openIdeaModal.hidden = true;
  openIdeaModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  const resolve = pendingOpenIdeaResolve;
  pendingOpenIdeaResolve = null;
  if (resolve) {
    resolve(value);
  }
}

function setOpenIdeaError(message) {
  if (!openIdeaError) {
    return;
  }

  openIdeaError.textContent = message;
  openIdeaError.hidden = !message;
}

function updateOpenIdeaCount() {
  if (!openIdeaInput || !openIdeaCount) {
    return;
  }

  openIdeaCount.textContent = `${openIdeaInput.value.length} / ${OPEN_IDEA_MAX_LENGTH}`;
}

async function onMapPointerDown(event) {
  if (!mapImage.getAttribute("src") || isSavingPin) {
    return;
  }

  const point = getMapPointFromEvent(event);
  if (!point) {
    return;
  }

  event.preventDefault();
  const category = getCategory(activeCategoryKey);
  const categoryLabel = category.key === OPEN_IDEA_CATEGORY_KEY ? await requestOpenIdeaLabel() : category.label;
  if (!categoryLabel) {
    return;
  }

  isSavingPin = true;
  setStatus(`Saving ${categoryLabel}...`, "muted");

  try {
    const response = await apiRequest(API_MYHUB_PINS, {
      method: "POST",
      body: {
        buildingId: currentBuildingId,
        buildingLabel: getBuildingLabel(currentBuildingId),
        floorId: currentFloorId,
        floorLabel: getFloorLabel(currentBuildingId, currentFloorId),
        categoryKey: category.key,
        categoryLabel,
        recordId: questionnaireContext.recordId,
        actorId: questionnaireContext.actorId,
        postcode: questionnaireContext.postcode,
        questionnaireResponseId: questionnaireContext.questionnaireResponseId,
        location: point,
      },
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(parseApiErrorPayload(payload));
    }

    pins = [payload.pin, ...pins.filter((pin) => pin.id !== payload.pin.id)];
    renderPins();
    renderItemDistribution();
    setStatus(`${payload.pin.categoryLabel || categoryLabel} placed.`, "success");
  } catch (error) {
    console.error("Could not save MyHub pin:", error);
    setStatus(error instanceof Error ? error.message : "Could not save item.", "error");
  } finally {
    isSavingPin = false;
  }
}

function onMapPointerMove(event) {
  lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
}

async function onLocateViaGps() {
  if (!locateViaGpsBtn || isLocatingViaGps) {
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    setStatus("Select a building and floor first.", "warn");
    return;
  }

  isLocatingViaGps = true;
  locateViaGpsBtn.disabled = true;
  setStatus("Requesting device location and direction...", "muted");

  const directionAbortController = typeof AbortController === "function" ? new AbortController() : null;
  const directionPromise = requestCurrentDeviceDirection({
    signal: directionAbortController?.signal || null,
  }).catch(() => null);

  try {
    const deviceLocation = await requestCurrentDeviceLocation();
    let deviceDirection =
      Number.isFinite(deviceLocation.heading) && typeof deviceLocation.headingSource === "string"
        ? { heading: deviceLocation.heading, source: deviceLocation.headingSource }
        : null;

    if (deviceDirection) {
      directionAbortController?.abort();
    } else {
      deviceDirection = await directionPromise;
    }

    const params = new URLSearchParams({
      building_id: currentBuildingId,
      floor_id: currentFloorId,
      latitude: String(deviceLocation.latitude),
      longitude: String(deviceLocation.longitude),
    });

    const response = await fetch(`${API_LOCATE_VIA_GPS}?${params.toString()}`, {
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

    const displayHeading = applyHeadingOffset(deviceDirection?.heading, payload?.headingOffsetDeg);
    userLocationPoint = {
      xPct: clampPercent(location.xPct),
      yPct: clampPercent(location.yPct),
      heading: displayHeading,
      rawHeading: Number.isFinite(deviceDirection?.heading) ? deviceDirection.heading : null,
      headingSource: typeof deviceDirection?.source === "string" ? deviceDirection.source : "",
    };

    setStatus(buildLocateStatusMessage(userLocationPoint), "success");
    renderLocateOverlays();
  } catch (error) {
    directionAbortController?.abort();
    userLocationPoint = null;
    setStatus(error?.message || "Could not determine location.", "error");
    renderLocateOverlays();
  } finally {
    directionAbortController?.abort();
    isLocatingViaGps = false;
    locateViaGpsBtn.disabled = false;
  }
}

async function onLocateViaPoi() {
  if (!locateViaPoiBtn || isLocatingViaPoi) {
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    setStatus("Select a building and floor first.", "warn");
    return;
  }

  if (poiVisible) {
    poiVisible = false;
    poiRequestToken += 1;
    shouldAnimatePois = false;
    setPoiOverlayButtonState(false);
    renderLocateOverlays();
    resetLocateStatusToBase();
    return;
  }

  if (picOverlayVisible) {
    picOverlayVisible = false;
    setPicOverlayButtonState(false);
    closePicPreviewModal();
  }

  poiVisible = true;
  setPoiOverlayButtonState(true);
  await refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
}

async function onLocateViaPic() {
  if (!locateViaPicBtn) {
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    setStatus("Select a building and floor first.", "warn");
    return;
  }

  if (picOverlayVisible) {
    picOverlayVisible = false;
    photoRequestToken += 1;
    setPicOverlayButtonState(false);
    closePicPreviewModal();
    renderLocateOverlays();
    resetLocateStatusToBase();
    return;
  }

  if (poiVisible) {
    poiVisible = false;
    poiRequestToken += 1;
    shouldAnimatePois = false;
    setPoiOverlayButtonState(false);
  }

  picOverlayVisible = true;
  setPicOverlayButtonState(true);
  await refreshPhotoOverlayForCurrentFloor({ loadingMessage: "Loading photos for this floor..." });
}

async function refreshPhotoOverlayForCurrentFloor({ loadingMessage = "" } = {}) {
  if (!picOverlayVisible || !currentBuildingId || !currentFloorId) {
    renderLocateOverlays();
    return;
  }

  const buildingId = currentBuildingId;
  const floorId = currentFloorId;
  const requestToken = ++photoRequestToken;

  locateViaPicBtn.disabled = true;
  if (loadingMessage) {
    setStatus(loadingMessage, "muted");
  }

  try {
    await loadPhotoMapsForBuilding(buildingId);
    if (!picOverlayVisible || requestToken !== photoRequestToken || buildingId !== currentBuildingId || floorId !== currentFloorId) {
      return;
    }

    renderLocateOverlays();
    const status = buildPicOverlayStatus(buildingId, floorId);
    setStatus(status.message, status.state);
  } catch (error) {
    if (requestToken !== photoRequestToken) {
      return;
    }

    renderLocateOverlays();
    setStatus("Could not load image points right now.", "error");
  } finally {
    if (requestToken === photoRequestToken && locateViaPicBtn) {
      locateViaPicBtn.disabled = false;
    }
  }
}

async function refreshPoiOverlayForCurrentFloor({ animate = false, loadingMessage = "" } = {}) {
  if (!poiVisible || !currentBuildingId || !currentFloorId) {
    renderLocateOverlays();
    return;
  }

  const buildingId = currentBuildingId;
  const floorId = currentFloorId;
  const requestToken = ++poiRequestToken;

  if (animate) {
    shouldAnimatePois = true;
  }

  setPoiLoadingState(true);
  if (loadingMessage) {
    setStatus(loadingMessage, "muted");
  }

  try {
    await loadPoiMapsForBuilding(buildingId);
    if (!poiVisible || requestToken !== poiRequestToken || buildingId !== currentBuildingId || floorId !== currentFloorId) {
      return;
    }

    renderLocateOverlays();
    const status = buildPoiOverlayStatus(buildingId, floorId);
    setStatus(status.message, status.state);
  } catch (error) {
    if (requestToken !== poiRequestToken) {
      return;
    }

    renderLocateOverlays();
    setStatus("Could not load place points right now.", "error");
  } finally {
    if (requestToken === poiRequestToken) {
      setPoiLoadingState(false);
    }
  }
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

function renderPins() {
  const floorPins = getCurrentFloorPins();
  pinLayer.innerHTML = floorPins.map((pin, index) => `
    <button
      type="button"
      class="myhub-pin"
      data-myhub-pin-id="${escapeHtml(pin.id)}"
      style="left: ${pin.xPct}%; top: ${pin.yPct}%; --pin-color: ${pin.color};"
      title="${escapeHtml(pin.categoryLabel)}"
      aria-label="${escapeHtml(pin.categoryLabel)} at ${pin.xPct}%, ${pin.yPct}%"
    >
      <span>${index + 1}</span>
    </button>
    ${pin.categoryKey === OPEN_IDEA_CATEGORY_KEY ? `
      <span
        class="myhub-open-idea-label"
        style="left: ${pin.xPct}%; top: ${pin.yPct}%; --pin-color: ${pin.color};"
      >${escapeHtml(pin.categoryLabel)}</span>
    ` : ""}
  `).join("");

  pinLayer.querySelectorAll("[data-myhub-pin-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const pin = pins.find((candidate) => candidate.id === button.dataset.myhubPinId);
      if (pin) {
        setStatus(`${pin.categoryLabel} at ${pin.xPct}%, ${pin.yPct}%.`, "muted");
      }
    });
  });
}

function renderLocateOverlays() {
  clearLocateOverlays();
  if (!mapImage.getAttribute("src")) {
    return;
  }

  if (poiVisible) {
    renderPoiMarkers();
  }
  if (picOverlayVisible) {
    renderPicOverlayMarkers();
  }
  if (userLocationPoint) {
    createUserLocationMarker(userLocationPoint.xPct, userLocationPoint.yPct, userLocationPoint.heading);
  }
}

function clearLocateOverlays() {
  mapCanvas.querySelectorAll(".marker.user-location, .poi-marker, .pic-marker").forEach((node) => node.remove());
}

function renderPoiMarkers() {
  if (!currentBuildingId || !currentFloorId || !poiMapsCache.has(currentBuildingId)) {
    return;
  }

  const poiPoints = getPoiPointsForFloor(currentBuildingId, currentFloorId);
  if (!poiPoints.length) {
    shouldAnimatePois = false;
    return;
  }

  const animate = shouldAnimatePois;
  poiPoints.forEach((point, index) => {
    createPoiMarker(point, index, animate);
  });
  shouldAnimatePois = false;
}

function renderPicOverlayMarkers() {
  if (!currentBuildingId || !currentFloorId || !photoMapsCache.has(currentBuildingId)) {
    return;
  }

  const picPoints = getPhotoPointsForFloor(currentBuildingId, currentFloorId);
  if (!picPoints.length) {
    return;
  }

  picPoints.forEach((point, index) => {
    createPicOverlayMarker(point, index);
  });
}

function createUserLocationMarker(xPct, yPct, heading) {
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) {
    return;
  }

  const marker = document.createElement("span");
  marker.className = "marker user-location";
  marker.style.left = `${xPct}%`;
  marker.style.top = `${yPct}%`;

  if (Number.isFinite(heading)) {
    marker.classList.add("has-direction");
    const direction = document.createElement("span");
    direction.className = "marker-direction";
    direction.style.transform = `translate(-50%, -82%) rotate(${heading}deg)`;
    marker.appendChild(direction);
  }

  mapCanvas.appendChild(marker);
}

function createPoiMarker(point, index, animate) {
  if (!point || !Number.isFinite(point.xPct) || !Number.isFinite(point.yPct)) {
    return;
  }

  const marker = document.createElement("span");
  marker.className = animate ? "poi-marker is-appearing" : "poi-marker";
  marker.style.left = `${point.xPct}%`;
  marker.style.top = `${point.yPct}%`;
  if (animate) {
    marker.style.setProperty("--poi-delay", `${Math.min(index * 70, 420)}ms`);
  }

  const nodeAnchor = document.createElement("span");
  nodeAnchor.className = "poi-node-anchor";
  const node = document.createElement("span");
  node.className = "poi-node";
  nodeAnchor.appendChild(node);

  const labelAnchor = document.createElement("span");
  labelAnchor.className = "poi-label-anchor";
  const label = document.createElement("span");
  label.className = "poi-label";
  label.textContent = point.name;
  labelAnchor.appendChild(label);

  marker.appendChild(nodeAnchor);
  marker.appendChild(labelAnchor);
  mapCanvas.appendChild(marker);
}

function createPicOverlayMarker(point, index) {
  if (!point || !Number.isFinite(point.xPct) || !Number.isFinite(point.yPct)) {
    return;
  }

  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "pic-marker";
  marker.style.left = `${point.xPct}%`;
  marker.style.top = `${point.yPct}%`;
  marker.style.setProperty("--pic-delay", `${Math.min(index * 70, 420)}ms`);
  marker.setAttribute("aria-label", `Open image preview for ${point.name}`);
  marker.title = `Open image: ${point.name}`;
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    openPicPreviewModal(point);
  });

  const node = document.createElement("span");
  node.className = "pic-node";
  const label = document.createElement("span");
  label.className = "pic-label";
  label.textContent = point.name;

  marker.appendChild(node);
  marker.appendChild(label);
  mapCanvas.appendChild(marker);
}

function buildPoiOverlayStatus(buildingId, floorId) {
  const poiMaps = poiMapsCache.get(buildingId);
  const floorLabel = getFloorLabel(buildingId, floorId);

  if (poiMaps === null) {
    return {
      message: `No place points found for ${getBuildingLabel(buildingId)}.`,
      state: "warn",
    };
  }

  const poiPoints = getPoiPointsForFloorFromMaps(poiMaps, floorId);
  if (!poiPoints.length) {
    return {
      message: `No POIs defined for ${floorLabel}.`,
      state: "warn",
    };
  }

  return {
    message: `Showing ${poiPoints.length} POI${poiPoints.length === 1 ? "" : "s"} on ${floorLabel}.`,
    state: "success",
  };
}

function buildPicOverlayStatus(buildingId, floorId) {
  const photoMaps = photoMapsCache.get(buildingId);
  const floorLabel = getFloorLabel(buildingId, floorId);

  if (photoMaps === null) {
    return {
      message: `No image points found for ${getBuildingLabel(buildingId)}.`,
      state: "warn",
    };
  }

  const points = getPhotoPointsForFloorFromMaps(photoMaps, floorId);
  if (!points.length) {
    return {
      message: `No image points defined for ${floorLabel}.`,
      state: "warn",
    };
  }

  return {
    message: `Showing ${points.length} image point${points.length === 1 ? "" : "s"} on ${floorLabel}. Tap a point to open the photo preview.`,
    state: "success",
  };
}

function setPoiOverlayButtonState(active) {
  if (!locateViaPoiBtn) {
    return;
  }

  locateViaPoiBtn.classList.toggle("is-active", !!active);
  locateViaPoiBtn.setAttribute("aria-pressed", String(!!active));
}

function setPicOverlayButtonState(active) {
  if (!locateViaPicBtn) {
    return;
  }

  locateViaPicBtn.classList.toggle("is-active", !!active);
  locateViaPicBtn.setAttribute("aria-pressed", String(!!active));
}

function setPoiLoadingState(loading) {
  isLocatingViaPoi = !!loading;
  if (locateViaPoiBtn) {
    locateViaPoiBtn.disabled = !!loading;
  }
}

function resetLocateStatusToBase() {
  if (picOverlayVisible) {
    const status = buildPicOverlayStatus(currentBuildingId, currentFloorId);
    setStatus(status.message, status.state);
    return;
  }

  if (poiVisible) {
    const status = buildPoiOverlayStatus(currentBuildingId, currentFloorId);
    setStatus(status.message, status.state);
    return;
  }

  if (userLocationPoint) {
    setStatus(buildLocateStatusMessage(userLocationPoint), "success");
    return;
  }

  setStatus(DEFAULT_MYHUB_STATUS_MESSAGE, "muted");
}

function openPicPreviewModal(point) {
  if (!picPreviewModal || !picPreviewFrame || !point || !point.imageUrl) {
    return;
  }

  if (picPreviewModalCoords) {
    picPreviewModalCoords.textContent = `Point ${round2(point.xPct)}%, ${round2(point.yPct)}%`;
  }

  picPreviewFrame.src = buildPicPreviewIframeUrl(point);
  picPreviewModal.hidden = false;
  picPreviewModal.setAttribute("aria-hidden", "false");
}

function closePicPreviewModal() {
  if (!picPreviewModal || !picPreviewFrame) {
    return;
  }

  picPreviewModal.hidden = true;
  picPreviewModal.setAttribute("aria-hidden", "true");
  picPreviewFrame.src = "about:blank";
}

function onPicPreviewModalClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.hasAttribute("data-pic-preview-close")) {
    closePicPreviewModal();
  }
}

function buildPicPreviewIframeUrl(point) {
  const params = new URLSearchParams();
  params.set("original", getEmbeddableImageUrl(point.imageUrl));
  return `${PIC_VIEWER_TEMPLATE_URL}?${params.toString()}`;
}

function getEmbeddableImageUrl(url) {
  if (!isAbsoluteHttpUrl(url)) {
    return url;
  }
  return `${API_ASSET_JSON}?url=${encodeURIComponent(url)}`;
}

function renderItemDistribution() {
  const floorPins = getCurrentFloorPins();
  itemSummary.textContent = `${floorPins.length} item${floorPins.length === 1 ? "" : "s"}`;
  if (!barChart) {
    return;
  }

  if (!floorPins.length) {
    barChart.innerHTML = '<p class="myhub-empty-list">No items placed on this floor.</p>';
    return;
  }

  const categoryRows = getCurrentFloorCategoryDistribution(floorPins);
  barChart.innerHTML = categoryRows.map((row) => `
    <article class="myhub-bar-row">
      <div class="myhub-bar-head">
        <strong>${escapeHtml(row.label)}</strong>
        <span>${row.count} (${row.percentLabel})</span>
      </div>
      <div class="myhub-bar-track" aria-hidden="true">
        <span class="myhub-bar-fill" style="--bar-color: ${row.color}; width: ${row.percent.toFixed(2)}%;"></span>
      </div>
    </article>
  `).join("");
}

function getCurrentFloorCategoryDistribution(floorPins) {
  const countsByCategory = new Map();
  floorPins.forEach((pin) => {
    countsByCategory.set(pin.categoryKey, (countsByCategory.get(pin.categoryKey) || 0) + 1);
  });

  const total = floorPins.length;
  return Array.from(countsByCategory.entries())
    .map(([categoryKey, count]) => {
      const category = getCategory(categoryKey);
      const percent = total > 0 ? (count / total) * 100 : 0;
      return {
        categoryKey,
        label: category.label,
        color: category.color,
        count,
        percent,
        percentLabel: formatPercent(percent),
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return naturalCompare(left.label, right.label);
    });
}

function formatPercent(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safeValue * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function toggleItemsPanel() {
  if (!itemsToggleBtn || !itemsPanel) {
    return;
  }

  const expanded = itemsToggleBtn.getAttribute("aria-expanded") === "true";
  const nextExpanded = !expanded;
  itemsToggleBtn.setAttribute("aria-expanded", String(nextExpanded));
  itemsPanel.hidden = !nextExpanded;
}

function getCurrentFloorPins() {
  return pins.filter((pin) => pin.buildingId === currentBuildingId && pin.floorId === currentFloorId);
}

async function loadPins() {
  try {
    const payload = await apiGet(buildMyHubPinsListUrl());
    pins = Array.isArray(payload.pins) ? payload.pins : [];
    renderPins();
    renderItemDistribution();
  } catch (error) {
    console.error("Could not load MyHub pins:", error);
    pins = [];
    setStatus("Could not load saved MyHub items.", "error");
  }
}

function buildMyHubPinsListUrl() {
  if (!questionnaireContext.recordId && !questionnaireContext.questionnaireResponseId) {
    return API_MYHUB_PINS;
  }

  const params = new URLSearchParams();
  if (questionnaireContext.recordId) {
    params.set("record_id", questionnaireContext.recordId);
  }
  if (questionnaireContext.questionnaireResponseId) {
    params.set("questionnaire_response_id", questionnaireContext.questionnaireResponseId);
  }
  return `${API_MYHUB_PINS}?${params.toString()}`;
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
  renderPins();

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
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function parseQuestionnaireContext() {
  const params = new URLSearchParams(window.location.search);
  return {
    buildingId: params.get("buildingId") || "",
    floorId: params.get("floorId") || "",
    recordId: params.get("recordId") || "",
    actorId: params.get("actorId") || "",
    postcode: params.get("postcode") || "",
    questionnaireResponseId: params.get("questionnaireResponseId") || "",
  };
}

function updateQuestionnaireContextStatus() {
  if (!questionnaireContext.recordId && !questionnaireContext.postcode) {
    return;
  }

  const contextParts = [
    questionnaireContext.actorId ? `Person ${questionnaireContext.actorId}` : "Selected person",
    questionnaireContext.postcode ? `postcode ${questionnaireContext.postcode}` : "",
  ].filter(Boolean);
  setStatus(`${contextParts.join(" | ")}. Add place ideas on the floor plan.`, "muted");
}

function buildLocateStatusMessage(locationPoint) {
  const locationText = `Map location ${round2(locationPoint.xPct)}%, ${round2(locationPoint.yPct)}%`;
  const headingLabel = formatHeadingLabel(locationPoint?.rawHeading);

  if (!headingLabel) {
    return `${locationText}. Direction unavailable on this device.`;
  }

  if (locationPoint.headingSource === "geolocation") {
    return `${locationText}. Travel heading ${headingLabel}.`;
  }

  return `${locationText}. Facing ${headingLabel}.`;
}

function normalizeHeadingDegrees(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function applyHeadingOffset(heading, offset) {
  const normalizedHeading = normalizeHeadingDegrees(heading);
  if (normalizedHeading === null) {
    return null;
  }

  const safeOffset = Number.isFinite(offset) ? offset : 0;
  return normalizeHeadingDegrees(normalizedHeading + safeOffset);
}

function getCompassDirectionLabel(heading) {
  const normalizedHeading = normalizeHeadingDegrees(heading);
  if (normalizedHeading === null) {
    return "";
  }

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(normalizedHeading / 45) % directions.length];
}

function formatHeadingLabel(heading) {
  const normalizedHeading = normalizeHeadingDegrees(heading);
  if (normalizedHeading === null) {
    return "";
  }

  return `${getCompassDirectionLabel(normalizedHeading)} (${Math.round(normalizedHeading)}°)`;
}

function setSelectPlaceholderState(selectElement) {
  if (!selectElement) {
    return;
  }
  selectElement.classList.toggle("is-placeholder", !selectElement.value);
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

      if (typeof rawBuilding.poiSrc === "string" && rawBuilding.poiSrc.trim()) {
        normalized[buildingId].poiSrc = rawBuilding.poiSrc.trim();
      }
      if (typeof rawBuilding.photosSrc === "string" && rawBuilding.photosSrc.trim()) {
        normalized[buildingId].photosSrc = rawBuilding.photosSrc.trim();
      }
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

function getCategory(categoryKey) {
  return MYHUB_CATEGORIES.find((category) => category.key === categoryKey) || MYHUB_CATEGORIES[0];
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

function normalizeAssetsBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\/+$/, "");
}

function buildAssetUrl(relativePath) {
  const rawPath = String(relativePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "");
  const { path, suffix } = splitAssetPathSuffix(rawPath);

  if (!assetsBaseUrl) {
    return path.startsWith("assets/") ? `/${encodeAssetPath(path)}${suffix}` : `/assets/${encodeAssetPath(path)}${suffix}`;
  }

  const normalizedPath =
    path.startsWith("assets/") && assetsBaseUrl.endsWith("/assets") ? path.slice("assets/".length) : path;
  return `${assetsBaseUrl}/${encodeAssetPath(normalizedPath)}${suffix}`;
}

function splitAssetPathSuffix(value) {
  const hashIndex = value.indexOf("#");
  const pathAndQuery = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : value.slice(hashIndex);
  const queryIndex = pathAndQuery.indexOf("?");

  if (queryIndex === -1) {
    return { path: pathAndQuery, suffix: fragment };
  }

  return {
    path: pathAndQuery.slice(0, queryIndex),
    suffix: `${pathAndQuery.slice(queryIndex)}${fragment}`,
  };
}

function encodeAssetPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getPoiAssetUrl(buildingId) {
  const building = buildingMaps[buildingId];
  if (building && typeof building.poiSrc === "string" && building.poiSrc.trim()) {
    return building.poiSrc.trim();
  }

  if (buildingId === ROOT_BUILDING_ID) {
    return buildAssetUrl("poi.json");
  }
  return buildAssetUrl(`${buildingId}/poi.json`);
}

function getPhotoAssetUrl(buildingId) {
  const building = buildingMaps[buildingId];
  if (building && typeof building.photosSrc === "string" && building.photosSrc.trim()) {
    return building.photosSrc.trim();
  }

  if (buildingId === ROOT_BUILDING_ID) {
    return buildAssetUrl("photos.json");
  }
  return buildAssetUrl(`${buildingId}/photos.json`);
}

async function loadPoiMapsForBuilding(buildingId) {
  if (!buildingId) {
    return null;
  }
  if (poiMapsCache.has(buildingId)) {
    return poiMapsCache.get(buildingId);
  }
  if (poiLoadPromises.has(buildingId)) {
    return poiLoadPromises.get(buildingId);
  }

  const loadPromise = (async () => {
    const response = await fetchAssetJson(getPoiAssetUrl(buildingId));
    if (response.status === 404) {
      poiMapsCache.set(buildingId, null);
      return null;
    }
    if (!response.ok) {
      throw new Error(`Could not load POIs for ${getBuildingLabel(buildingId)}.`);
    }

    const payload = await response.json().catch(() => {
      throw new Error(`POI data for ${getBuildingLabel(buildingId)} is not valid JSON.`);
    });
    const normalized = normalizePoiMaps(payload);
    poiMapsCache.set(buildingId, normalized);
    return normalized;
  })().finally(() => {
    poiLoadPromises.delete(buildingId);
  });

  poiLoadPromises.set(buildingId, loadPromise);
  return loadPromise;
}

async function loadPhotoMapsForBuilding(buildingId) {
  if (!buildingId) {
    return null;
  }
  if (photoMapsCache.has(buildingId)) {
    return photoMapsCache.get(buildingId);
  }
  if (photoLoadPromises.has(buildingId)) {
    return photoLoadPromises.get(buildingId);
  }

  const loadPromise = (async () => {
    const response = await fetchAssetJson(getPhotoAssetUrl(buildingId));
    if (response.status === 404) {
      photoMapsCache.set(buildingId, null);
      return null;
    }
    if (!response.ok) {
      throw new Error(`Could not load photo data for ${getBuildingLabel(buildingId)}.`);
    }

    const payload = await response.json().catch(() => {
      throw new Error(`Photo data for ${getBuildingLabel(buildingId)} is not valid JSON.`);
    });
    const normalized = normalizePhotoMaps(payload);
    photoMapsCache.set(buildingId, normalized);
    return normalized;
  })().finally(() => {
    photoLoadPromises.delete(buildingId);
  });

  photoLoadPromises.set(buildingId, loadPromise);
  return loadPromise;
}

async function fetchAssetJson(assetUrl) {
  try {
    return await fetch(assetUrl, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (!isAbsoluteHttpUrl(assetUrl)) {
      throw error;
    }

    const proxyUrl = `${API_ASSET_JSON}?url=${encodeURIComponent(assetUrl)}`;
    return fetch(proxyUrl, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  }
}

function isAbsoluteHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /^https?:\/\//i.test(value.trim());
}

function normalizePoiMaps(rawMaps) {
  if (!rawMaps || typeof rawMaps !== "object" || Array.isArray(rawMaps)) {
    return {};
  }

  const floorSource =
    rawMaps.floors && typeof rawMaps.floors === "object" && !Array.isArray(rawMaps.floors) ? rawMaps.floors : rawMaps;

  const normalized = {};
  Object.entries(floorSource).forEach(([rawFloorId, floorPayload]) => {
    const poiPoints = normalizePoiFloorPoints(floorPayload);
    if (!poiPoints.length) {
      return;
    }
    normalized[String(rawFloorId)] = poiPoints;
  });
  return normalized;
}

function normalizePoiFloorPoints(floorPayload) {
  if (Array.isArray(floorPayload)) {
    return floorPayload.map(normalizePoiPoint).filter((point) => point !== null);
  }
  if (!floorPayload || typeof floorPayload !== "object") {
    return [];
  }

  const pointKeys = ["referencePoints", "points", "pois"];
  for (const key of pointKeys) {
    const rawPoints = floorPayload[key];
    if (!Array.isArray(rawPoints)) {
      continue;
    }
    return rawPoints.map(normalizePoiPoint).filter((point) => point !== null);
  }
  return [];
}

function normalizePoiPoint(rawPoint) {
  if (!rawPoint || typeof rawPoint !== "object") {
    return null;
  }

  const xPct = Number(rawPoint.xPct ?? rawPoint.x ?? rawPoint.xPercent);
  const yPct = Number(rawPoint.yPct ?? rawPoint.y ?? rawPoint.yPercent);
  const nameSource =
    typeof rawPoint.name === "string" && rawPoint.name.trim()
      ? rawPoint.name
      : typeof rawPoint.label === "string" && rawPoint.label.trim()
        ? rawPoint.label
        : typeof rawPoint.title === "string" && rawPoint.title.trim()
          ? rawPoint.title
          : "";

  if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !nameSource) {
    return null;
  }

  return {
    xPct: clampPercent(xPct),
    yPct: clampPercent(yPct),
    name: nameSource.trim(),
  };
}

function normalizePhotoMaps(rawMaps) {
  if (!rawMaps || typeof rawMaps !== "object" || Array.isArray(rawMaps)) {
    return {};
  }

  const floorSource =
    rawMaps.floors && typeof rawMaps.floors === "object" && !Array.isArray(rawMaps.floors) ? rawMaps.floors : rawMaps;

  const normalized = {};
  Object.entries(floorSource).forEach(([rawFloorId, floorPayload]) => {
    const photoPoints = normalizePhotoFloorPoints(floorPayload);
    if (!photoPoints.length) {
      return;
    }
    normalized[String(rawFloorId)] = photoPoints;
  });
  return normalized;
}

function normalizePhotoFloorPoints(floorPayload) {
  if (Array.isArray(floorPayload)) {
    return floorPayload.map(normalizePhotoPoint).filter((point) => point !== null);
  }
  if (!floorPayload || typeof floorPayload !== "object") {
    return [];
  }

  const pointKeys = ["referencePoints", "points", "photos"];
  for (const key of pointKeys) {
    const rawPoints = floorPayload[key];
    if (!Array.isArray(rawPoints)) {
      continue;
    }
    return rawPoints.map(normalizePhotoPoint).filter((point) => point !== null);
  }
  return [];
}

function normalizePhotoPoint(rawPoint) {
  if (!rawPoint || typeof rawPoint !== "object") {
    return null;
  }

  const xPct = Number(rawPoint.xPct ?? rawPoint.x ?? rawPoint.xPercent);
  const yPct = Number(rawPoint.yPct ?? rawPoint.y ?? rawPoint.yPercent);
  const imageUrlSource =
    typeof rawPoint.imageUrl === "string" && rawPoint.imageUrl.trim()
      ? rawPoint.imageUrl
      : typeof rawPoint.url === "string" && rawPoint.url.trim()
        ? rawPoint.url
        : typeof rawPoint.photoUrl === "string" && rawPoint.photoUrl.trim()
          ? rawPoint.photoUrl
          : "";
  const nameSource =
    typeof rawPoint.name === "string" && rawPoint.name.trim()
      ? rawPoint.name
      : typeof rawPoint.label === "string" && rawPoint.label.trim()
        ? rawPoint.label
        : typeof rawPoint.title === "string" && rawPoint.title.trim()
          ? rawPoint.title
          : "Photo point";

  if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !imageUrlSource) {
    return null;
  }

  return {
    xPct: clampPercent(xPct),
    yPct: clampPercent(yPct),
    name: nameSource.trim(),
    imageUrl: imageUrlSource.trim(),
  };
}

function getPoiPointsForFloor(buildingId, floorId) {
  return getPoiPointsForFloorFromMaps(poiMapsCache.get(buildingId), floorId);
}

function getPhotoPointsForFloor(buildingId, floorId) {
  return getPhotoPointsForFloorFromMaps(photoMapsCache.get(buildingId), floorId);
}

function getPoiPointsForFloorFromMaps(poiMaps, floorId) {
  if (!poiMaps || typeof poiMaps !== "object" || !floorId) {
    return [];
  }

  if (Array.isArray(poiMaps[floorId])) {
    return poiMaps[floorId];
  }

  const loweredFloorId = String(floorId).toLowerCase();
  for (const [candidateFloorId, points] of Object.entries(poiMaps)) {
    if (String(candidateFloorId).toLowerCase() === loweredFloorId && Array.isArray(points)) {
      return points;
    }
  }

  return [];
}

function getPhotoPointsForFloorFromMaps(photoMaps, floorId) {
  if (!photoMaps || typeof photoMaps !== "object" || !floorId) {
    return [];
  }

  if (Array.isArray(photoMaps[floorId])) {
    return photoMaps[floorId];
  }

  const sharedFloorKeys = ["all", "*", "__all__"];
  for (const sharedKey of sharedFloorKeys) {
    if (Array.isArray(photoMaps[sharedKey])) {
      return photoMaps[sharedKey];
    }
  }

  const loweredFloorId = String(floorId).toLowerCase();
  for (const [candidateFloorId, points] of Object.entries(photoMaps)) {
    if (String(candidateFloorId).toLowerCase() === loweredFloorId && Array.isArray(points)) {
      return points;
    }
  }

  return [];
}

function clampZoom(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAP_ZOOM;
  }
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, value));
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

  return "Request failed.";
}
