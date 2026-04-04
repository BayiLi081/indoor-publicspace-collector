import { loadActivityCatalog } from "./activity-catalog.js";

const API_BUILDINGS = "/api/buildings/";
const API_RECORDS = "/api/records/";
const API_RECORDS_EXPORT = "/api/records/export/";
const API_SITE_OBSERVATIONS = "/api/site-observations/";

const ROOT_BUILDING_ID = "__root__";
const ALL_BUILDINGS_ID = "__all_buildings__";
const ALL_FLOORS_ID = "__all_floors__";
const AUTO_ACTOR_ID_PATTERN = /^CL(\d+)-P(\d+)$/i;
const MIN_MAP_ZOOM = 0.25;
const MAX_MAP_ZOOM = 16;
const MAP_ZOOM_STEP = 0.1;
const DEFAULT_MAP_ZOOM = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const MAX_PREVIEW_DATA_URL_LENGTH = 180000;
const PREVIEW_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i;
const ACTIVITY_CATALOG = loadActivityCatalog();
const ACTIVITY_TYPE_OPTIONS = ACTIVITY_CATALOG.options;
const ACTIVITY_TYPE_ALIASES = ACTIVITY_CATALOG.aliases;

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

const buildingSelect = document.getElementById("buildingSelect");
const floorSelect = document.getElementById("floorSelect");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const exportBtn = document.getElementById("exportBtn");
const managementStatus = document.getElementById("managementStatus");
const managementMapWrap = document.getElementById("managementMapWrap");
const managementMapCanvas = document.getElementById("managementMapCanvas");
const managementMapImage = document.getElementById("managementMapImage");
const managementMapEmptyState = document.getElementById("managementMapEmptyState");
const managementMapStatus = document.getElementById("managementMapStatus");
const managementZoomOutBtn = document.getElementById("managementZoomOutBtn");
const managementZoomInBtn = document.getElementById("managementZoomInBtn");
const managementZoomResetBtn = document.getElementById("managementZoomResetBtn");
const managementZoomValue = document.getElementById("managementZoomValue");
const managementMapPopup = document.getElementById("managementMapPopup");
const managementMapPopupTitle = document.getElementById("managementMapPopupTitle");
const managementMapPopupSubtitle = document.getElementById("managementMapPopupSubtitle");
const managementMapPopupBody = document.getElementById("managementMapPopupBody");
const managementMapPopupCloseBtn = document.getElementById("managementMapPopupCloseBtn");
const observationCount = document.getElementById("observationCount");
const observationList = document.getElementById("observationList");
const observationPhotoModal = document.getElementById("observationPhotoModal");
const observationPhotoModalImage = document.getElementById("observationPhotoModalImage");
const observationPhotoModalTitle = document.getElementById("observationPhotoModalTitle");
const observationPhotoModalSubtitle = document.getElementById("observationPhotoModalSubtitle");
const observationPhotoModalCloseBtn = document.getElementById("observationPhotoModalCloseBtn");
const recordCount = document.getElementById("recordCount");
const recordsTbody = document.getElementById("recordsTbody");

let records = [];
let observations = [];
let buildingMaps = {};
let currentBuildingId = ALL_BUILDINGS_ID;
let currentFloorId = ALL_FLOORS_ID;
let mapZoomLevel = DEFAULT_MAP_ZOOM;
let lastZoomAnchor = null;
let selectedMapItem = null;

initialize().catch((error) => {
  console.error("Management initialization failed:", error);
  setManagementStatus(`Could not load management interface: ${error.message}`, "error");
  alert(`Could not load management interface: ${error.message}`);
});

async function initialize() {
  setManagementStatus("Loading buildings, records, and site observations...", "muted");
  buildingSelect.innerHTML = "<option>Loading...</option>";
  floorSelect.innerHTML = "<option>Loading...</option>";
  setManagementMapStatus("Select one building and one floor to display the map.");

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  searchInput.addEventListener("input", renderRecords);
  refreshBtn.addEventListener("click", onRefresh);
  exportBtn.addEventListener("click", onExport);
  if (managementMapWrap && managementMapImage) {
    managementMapWrap.addEventListener("click", onMapBackgroundClick);
    managementMapWrap.addEventListener("wheel", onMapWheel, { passive: false });
    managementMapWrap.addEventListener("pointermove", onMapPointerMove);
    managementMapImage.addEventListener("load", () => {
      setMapEmptyState("", false);
      renderManagementMap();
      updateZoomControls();
    });
    managementMapImage.addEventListener("error", () => {
      clearMapVisualisation("Could not load the selected floor map.");
    });
  }
  if (managementZoomOutBtn && managementZoomInBtn && managementZoomResetBtn) {
    managementZoomOutBtn.addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
    managementZoomInBtn.addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
    managementZoomResetBtn.addEventListener("click", () => setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false }));
  }
  if (managementMapPopupCloseBtn) {
    managementMapPopupCloseBtn.addEventListener("click", clearMapSelection);
  }
  if (observationPhotoModalCloseBtn) {
    observationPhotoModalCloseBtn.addEventListener("click", closeObservationPhotoModal);
  }
  if (observationPhotoModal) {
    observationPhotoModal.addEventListener("click", onObservationPhotoModalClick);
  }
  document.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("resize", () => {
    renderManagementMap();
    updateZoomControls();
  });
  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });

  await loadBuildingMaps();
  await loadManagementData();
  renderRecords();
}

function onBuildingChange(event) {
  currentBuildingId = event.target.value || ALL_BUILDINGS_ID;
  renderFloorOptions(currentBuildingId);
  currentFloorId = floorSelect.value || ALL_FLOORS_ID;
  updateMapForSelection();
  renderRecords();
}

function onFloorChange(event) {
  currentFloorId = event.target.value || ALL_FLOORS_ID;
  updateMapForSelection();
  renderRecords();
}

async function onRefresh() {
  refreshBtn.disabled = true;
  setManagementStatus("Refreshing records and site observations...", "muted");

  try {
    await loadManagementData({ showSuccess: true });
    renderRecords();
  } catch (error) {
    setManagementStatus(`Could not refresh management data: ${error.message}`, "error");
    alert(`Could not refresh management data: ${error.message}`);
  } finally {
    refreshBtn.disabled = false;
  }
}

async function loadManagementData({ showSuccess = false } = {}) {
  const [recordsResult, observationsResult] = await Promise.allSettled([loadRecords(), loadSiteObservations()]);

  if (recordsResult.status !== "fulfilled") {
    throw recordsResult.reason;
  }

  records = recordsResult.value;
  observations = observationsResult.status === "fulfilled" ? observationsResult.value : [];

  if (observationsResult.status === "rejected") {
    const observationMessage =
      observationsResult.reason && typeof observationsResult.reason.message === "string"
        ? observationsResult.reason.message
        : "Site observations are unavailable.";
    setManagementStatus(
      `Loaded ${records.length} record${records.length === 1 ? "" : "s"}, but site observations could not be loaded: ${observationMessage}`,
      "error"
    );
    return;
  }

  const summary = `Loaded ${records.length} record${records.length === 1 ? "" : "s"} and ${observations.length} site observation${observations.length === 1 ? "" : "s"}.`;
  setManagementStatus(summary, showSuccess ? "success" : "muted");
}

async function loadBuildingMaps() {
  const discoveredMaps = await fetchBuildingMaps();
  buildingMaps = normalizeBuildingMaps(discoveredMaps);

  if (!hasAnyBuildingFloors(buildingMaps)) {
    buildingMaps = normalizeBuildingMaps(LEGACY_BUILDING_MAPS);
  }

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId, currentFloorId);
  currentBuildingId = buildingSelect.value || ALL_BUILDINGS_ID;
  currentFloorId = floorSelect.value || ALL_FLOORS_ID;
  updateMapForSelection();
}

async function fetchBuildingMaps() {
  try {
    const payload = await apiGet(API_BUILDINGS);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    if (payload.buildings && typeof payload.buildings === "object" && !Array.isArray(payload.buildings)) {
      return payload.buildings;
    }

    return payload;
  } catch (error) {
    console.warn("Could not fetch building maps from API:", error);
    return null;
  }
}

function renderBuildingOptions(preferredBuildingId = ALL_BUILDINGS_ID) {
  const buildingIds = getBuildingIds();
  buildingSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = ALL_BUILDINGS_ID;
  allOption.textContent = "All buildings";
  buildingSelect.appendChild(allOption);

  buildingIds.forEach((buildingId) => {
    const option = document.createElement("option");
    option.value = buildingId;
    option.textContent = getBuildingLabel(buildingId);
    buildingSelect.appendChild(option);
  });

  const selectedBuildingId = preferredBuildingId !== ALL_BUILDINGS_ID && buildingMaps[preferredBuildingId]
    ? preferredBuildingId
    : ALL_BUILDINGS_ID;
  buildingSelect.value = selectedBuildingId;
}

function renderFloorOptions(buildingId, preferredFloorId = ALL_FLOORS_ID) {
  floorSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = ALL_FLOORS_ID;
  allOption.textContent = buildingId === ALL_BUILDINGS_ID ? "All floors" : "All floors in building";
  floorSelect.appendChild(allOption);

  if (buildingId !== ALL_BUILDINGS_ID) {
    getFloorIds(buildingId).forEach((floorId) => {
      const option = document.createElement("option");
      option.value = floorId;
      option.textContent = getFloorLabel(buildingId, floorId);
      floorSelect.appendChild(option);
    });
  }

  floorSelect.disabled = buildingId === ALL_BUILDINGS_ID;
  const selectedFloorId =
    buildingId !== ALL_BUILDINGS_ID && preferredFloorId !== ALL_FLOORS_ID && getFloorIds(buildingId).includes(preferredFloorId)
      ? preferredFloorId
      : ALL_FLOORS_ID;
  floorSelect.value = selectedFloorId;
}

function getFilteredRecords() {
  const query = searchInput.value.trim().toLowerCase();

  return records
    .slice()
    .sort((left, right) => right.activityTime.localeCompare(left.activityTime))
    .filter((record) => {
      const recordBuildingId = getRecordBuildingId(record);
      const recordFloorId = getRecordFloorId(record, recordBuildingId);

      if (currentBuildingId !== ALL_BUILDINGS_ID && recordBuildingId !== currentBuildingId) {
        return false;
      }
      if (currentFloorId !== ALL_FLOORS_ID && recordFloorId !== currentFloorId) {
        return false;
      }

      if (!query) {
        return true;
      }

      const target = [
        formatActivityType(record.activityType),
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
}

function getFilteredObservations() {
  const query = searchInput.value.trim().toLowerCase();

  return observations
    .slice()
    .sort((left, right) => getObservationSortValue(right) - getObservationSortValue(left))
    .filter((observation) => {
      const observationBuildingId = getObservationBuildingId(observation);
      const observationFloorId = getObservationFloorId(observation);

      if (currentBuildingId !== ALL_BUILDINGS_ID && observationBuildingId !== currentBuildingId) {
        return false;
      }
      if (currentFloorId !== ALL_FLOORS_ID && observationFloorId !== currentFloorId) {
        return false;
      }

      if (!query) {
        return true;
      }

      const target = [
        observation.observationType,
        observation.note,
        observation.photoName,
        getObservationContextText(observation),
        formatDate(observation.observationTime || observation.createdAt),
      ]
        .join(" ")
        .toLowerCase();

      return target.includes(query);
    });
}

function updateMapForSelection() {
  if (!managementMapImage) {
    return;
  }

  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });

  if (currentBuildingId === ALL_BUILDINGS_ID) {
    clearMapVisualisation("Select one building and one floor to display the map.");
    return;
  }

  if (currentFloorId === ALL_FLOORS_ID) {
    clearMapVisualisation(`Select one floor in ${getBuildingLabel(currentBuildingId)} to display the map.`);
    return;
  }

  const currentFloor = getFloorConfig(currentBuildingId, currentFloorId);
  if (!currentFloor) {
    clearMapVisualisation("No indoor map is available for the selected floor.");
    return;
  }

  setMapEmptyState("", false);
  managementMapImage.src = currentFloor.mapSrc;
  managementMapImage.alt = `Indoor map ${getBuildingLabel(currentBuildingId)} ${currentFloor.label}`;
  renderManagementMap();
}

function clearMapVisualisation(message) {
  clearMapSelection({ render: false });
  if (managementMapImage) {
    managementMapImage.removeAttribute("src");
    managementMapImage.alt = message || "No indoor map available";
  }
  clearMapMarkers();
  setMapEmptyState(message || "No indoor map available.", true);
  setManagementMapStatus(message || "No indoor map available.");
  updateZoomControls();
}

function setMapEmptyState(message, visible) {
  if (!managementMapEmptyState) {
    return;
  }

  managementMapEmptyState.textContent = message || "";
  managementMapEmptyState.hidden = !visible;
}

function setManagementMapStatus(message) {
  if (!managementMapStatus) {
    return;
  }

  managementMapStatus.textContent = message;
}

function renderManagementMap(filteredRecords = getFilteredRecords()) {
  clearMapMarkers();

  if (!managementMapImage || !managementMapImage.getAttribute("src")) {
    renderMapPopup([]);
    return;
  }

  const visibleRecords = filteredRecords.filter((record) => {
    const recordBuildingId = getRecordBuildingId(record);
    const recordFloorId = getRecordFloorId(record, recordBuildingId);
    return (
      recordBuildingId === currentBuildingId &&
      recordFloorId === currentFloorId &&
      hasMapLocation(record.location)
    );
  });

  const clusterMap = buildVisibleClusterMap(visibleRecords);
  syncMapSelection(visibleRecords, clusterMap);
  drawClusterLinks(clusterMap);
  visibleRecords.forEach((record) => {
    const clusterSize = getRecordClusterSize(record, clusterMap);
    createMarker(record, {
      selected: isRecordSelected(record),
      dimmed: hasActiveSelection() && !isRecordSelected(record),
      clusterSize,
    });
  });
  renderMapPopup(visibleRecords, clusterMap);

  const floorLabel = getFloorLabel(currentBuildingId, currentFloorId);
  const buildingLabel = getBuildingLabel(currentBuildingId);
  setManagementMapStatus(
    `Showing ${visibleRecords.length} matching record${visibleRecords.length === 1 ? "" : "s"} on ${buildingLabel}, ${floorLabel}.`
  );
}

function clearMapMarkers() {
  const overlayHost = managementMapCanvas || managementMapWrap;
  if (!overlayHost) {
    return;
  }

  overlayHost.querySelectorAll(".marker, .cluster-link").forEach((node) => node.remove());
}

function buildVisibleClusterMap(visibleRecords) {
  const clusterMap = new Map();

  visibleRecords.forEach((record) => {
    const parsedActor = parseAutoActorId(record.actorId);
    if (!parsedActor) {
      return;
    }

    const clusterRecords = clusterMap.get(parsedActor.clusterNumber) || [];
    clusterRecords.push({
      record,
      personNumber: parsedActor.personNumber,
      clusterNumber: parsedActor.clusterNumber,
    });
    clusterMap.set(parsedActor.clusterNumber, clusterRecords);
  });

  clusterMap.forEach((clusterRecords) => {
    clusterRecords.sort((left, right) => {
      if (left.personNumber !== right.personNumber) {
        return left.personNumber - right.personNumber;
      }
      return String(left.record.activityTime || "").localeCompare(String(right.record.activityTime || ""));
    });
  });

  return clusterMap;
}

function drawClusterLinks(clusterMap) {
  clusterMap.forEach((clusterRecords, clusterNumber) => {
    if (clusterRecords.length < 2) {
      return;
    }

    const selected = isGroupSelected(clusterNumber);
    const dimmed = hasActiveSelection() && !selected;
    for (let index = 1; index < clusterRecords.length; index += 1) {
      createClusterLink(clusterRecords[index - 1].record, clusterRecords[index].record, {
        clusterNumber,
        selected,
        dimmed,
      });
    }
  });
}

function createClusterLink(fromRecord, toRecord, options = {}) {
  const overlayHost = managementMapCanvas || managementMapWrap;
  const fromPixels = toMapPixelPoint(fromRecord?.location);
  const toPixels = toMapPixelPoint(toRecord?.location);
  if (!overlayHost || !fromPixels || !toPixels) {
    return;
  }

  const dx = toPixels.x - fromPixels.x;
  const dy = toPixels.y - fromPixels.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length <= 0) {
    return;
  }

  const line = document.createElement("span");
  line.className = "cluster-link interactive";
  if (options.selected) {
    line.classList.add("is-selected");
  }
  if (options.dimmed) {
    line.classList.add("is-dimmed");
  }
  line.style.left = `${fromPixels.x}px`;
  line.style.top = `${fromPixels.y}px`;
  line.style.width = `${length}px`;
  line.style.transform = `translateY(-50%) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
  line.title = `Inspect ${getClusterLabel(options.clusterNumber)}`;
  wireInteractiveNode(line, (event) => {
    event.stopPropagation();
    selectGroup(options.clusterNumber);
  });
  overlayHost.appendChild(line);
}

function toMapPixelPoint(point) {
  const overlayHost = managementMapCanvas || managementMapWrap;
  if (!point || typeof point.xPct !== "number" || typeof point.yPct !== "number" || !overlayHost) {
    return null;
  }

  const mapWidth = managementMapImage?.clientWidth || overlayHost.clientWidth;
  const mapHeight = managementMapImage?.clientHeight || overlayHost.clientHeight;
  if (!mapWidth || !mapHeight) {
    return null;
  }

  return {
    x: (point.xPct / 100) * mapWidth,
    y: (point.yPct / 100) * mapHeight,
  };
}

function createMarker(record, options = {}) {
  const overlayHost = managementMapCanvas || managementMapWrap;
  const location = record?.location;
  if (
    !overlayHost ||
    !location ||
    !Number.isFinite(location.xPct) ||
    !Number.isFinite(location.yPct)
  ) {
    return;
  }

  const marker = document.createElement("span");
  marker.className = "marker interactive";
  if (options.selected) {
    marker.classList.add("is-selected");
  }
  if (options.dimmed) {
    marker.classList.add("is-dimmed");
  }
  marker.style.left = `${location.xPct}%`;
  marker.style.top = `${location.yPct}%`;
  marker.title = getMarkerTitle(record, options.clusterSize);
  wireInteractiveNode(marker, (event) => {
    event.stopPropagation();
    selectRecord(record.id);
  });
  overlayHost.appendChild(marker);
}

function getMarkerTitle(record, clusterSize = 0) {
  const actorLabel = record?.actorId || "Record";
  const activityLabel = formatActivityType(record?.activityType);
  if (clusterSize > 1) {
    return `${actorLabel} | ${activityLabel} | Click point for this person, or line for the group`;
  }
  return `${actorLabel} | ${activityLabel}`;
}

function wireInteractiveNode(node, onActivate) {
  if (!node || typeof onActivate !== "function") {
    return;
  }

  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", onActivate);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(event);
    }
  });
}

function hasActiveSelection() {
  return !!selectedMapItem;
}

function selectRecord(recordId) {
  if (!recordId) {
    return;
  }

  selectedMapItem = { type: "record", recordId };
  renderRecords();
}

function selectGroup(clusterNumber) {
  if (!Number.isFinite(clusterNumber)) {
    return;
  }

  selectedMapItem = { type: "group", clusterNumber };
  renderRecords();
}

function clearMapSelection(options = {}) {
  const render = options.render !== false;
  selectedMapItem = null;
  hideMapPopup();
  if (render) {
    renderRecords();
  }
}

function syncMapSelection(visibleRecords, clusterMap) {
  if (!selectedMapItem) {
    return;
  }

  if (selectedMapItem.type === "record") {
    const selectedRecord = visibleRecords.find((record) => record.id === selectedMapItem.recordId);
    if (!selectedRecord) {
      clearMapSelection({ render: false });
    }
    return;
  }

  if (selectedMapItem.type === "group") {
    const selectedGroup = clusterMap.get(selectedMapItem.clusterNumber) || [];
    if (!selectedGroup.length) {
      clearMapSelection({ render: false });
    }
  }
}

function isRecordSelected(record) {
  if (!selectedMapItem || !record) {
    return false;
  }

  if (selectedMapItem.type === "record") {
    return record.id === selectedMapItem.recordId;
  }

  if (selectedMapItem.type === "group") {
    const parsedActor = parseAutoActorId(record.actorId);
    return !!parsedActor && parsedActor.clusterNumber === selectedMapItem.clusterNumber;
  }

  return false;
}

function isGroupSelected(clusterNumber) {
  return !!selectedMapItem && selectedMapItem.type === "group" && selectedMapItem.clusterNumber === clusterNumber;
}

function getRecordClusterSize(record, clusterMap) {
  const parsedActor = parseAutoActorId(record?.actorId);
  if (!parsedActor) {
    return 0;
  }

  return (clusterMap.get(parsedActor.clusterNumber) || []).length;
}

function renderMapPopup(visibleRecords, clusterMap = buildVisibleClusterMap(visibleRecords)) {
  if (!managementMapPopup || !managementMapPopupBody || !managementMapPopupTitle || !managementMapPopupSubtitle) {
    return;
  }

  if (!selectedMapItem) {
    hideMapPopup();
    return;
  }

  if (selectedMapItem.type === "record") {
    const record = visibleRecords.find((item) => item.id === selectedMapItem.recordId) || null;
    if (!record) {
      hideMapPopup();
      return;
    }

    const parsedActor = parseAutoActorId(record.actorId);
    const clusterSize = getRecordClusterSize(record, clusterMap);
    managementMapPopupTitle.textContent = record.actorId || "Record Details";
    managementMapPopupSubtitle.textContent = parsedActor && clusterSize > 1
      ? `Group member ${parsedActor.personNumber} of ${clusterSize}. Click a connecting line to inspect the full group.`
      : "Selected map point";
    managementMapPopupBody.innerHTML = renderRecordPopupBody(record, clusterSize);
    managementMapPopup.hidden = false;
    return;
  }

  if (selectedMapItem.type === "group") {
    const clusterEntries = clusterMap.get(selectedMapItem.clusterNumber) || [];
    if (!clusterEntries.length) {
      hideMapPopup();
      return;
    }

    const clusterRecords = clusterEntries.map((entry) => entry.record);
    managementMapPopupTitle.textContent = `${getClusterLabel(selectedMapItem.clusterNumber)} Group`;
    managementMapPopupSubtitle.textContent = `${clusterRecords.length} member${clusterRecords.length === 1 ? "" : "s"} selected`;
    managementMapPopupBody.innerHTML = renderGroupPopupBody(clusterRecords);
    managementMapPopup.hidden = false;
  }
}

function hideMapPopup() {
  if (!managementMapPopup || !managementMapPopupBody || !managementMapPopupTitle || !managementMapPopupSubtitle) {
    return;
  }

  managementMapPopup.hidden = true;
  managementMapPopupTitle.textContent = "Selection Details";
  managementMapPopupSubtitle.textContent = "Click a point or group line on the map.";
  managementMapPopupBody.innerHTML = "";
}

function renderRecordPopupBody(record, clusterSize = 0) {
  const parsedActor = parseAutoActorId(record.actorId);
  const groupText =
    parsedActor && clusterSize > 1
      ? `${getClusterLabel(parsedActor.clusterNumber)} | member ${parsedActor.personNumber} of ${clusterSize}`
      : "Individual";

  const items = [
    ["Activity Type", formatActivityType(record.activityType)],
    ["Gender", formatGender(record.gender)],
    ["Age Group", formatAgeGroup(record.ageGroup)],
    ["Time", formatDate(record.activityTime)],
    ["Group", groupText],
    ["Building", getBuildingLabel(getRecordBuildingId(record))],
    ["Floor", getFloorLabel(getRecordBuildingId(record), getRecordFloorId(record, getRecordBuildingId(record)))],
    ["Map Point", formatMapLocation(record.location)],
    ["Photo GPS", formatPhotoLocationText(record.photoLocation, record.photoName)],
    ["Notes", record.notes || "-"],
  ];

  return renderPopupGrid(items);
}

function renderGroupPopupBody(clusterRecords) {
  const sortedRecords = sortGroupRecords(clusterRecords);
  const items = [
    ["Members", String(sortedRecords.length)],
    ["Time", summarizeSharedRecordValue(sortedRecords, (record) => formatDate(record.activityTime))],
    ["Building", summarizeSharedRecordValue(sortedRecords, (record) => getBuildingLabel(getRecordBuildingId(record)))],
    ["Floor", summarizeSharedRecordValue(sortedRecords, (record) => getFloorLabel(getRecordBuildingId(record), getRecordFloorId(record, getRecordBuildingId(record))))],
    ["Notes", summarizeSharedRecordValue(sortedRecords, (record) => record.notes || "-", { multiValue: "Mixed notes" })],
    ["Photo GPS", summarizeSharedRecordValue(sortedRecords, (record) => formatPhotoLocationText(record.photoLocation, record.photoName), { multiValue: "Mixed photo locations" })],
  ];

  const memberCards = sortedRecords
    .map((record) => {
      const parsedActor = parseAutoActorId(record.actorId);
      const memberLabel = parsedActor ? `Member ${parsedActor.personNumber}` : record.actorId || "Member";
      return `
        <article class="management-map-member-card">
          <strong>${escapeHtml(memberLabel)}${record.actorId ? ` · ${escapeHtml(record.actorId)}` : ""}</strong>
          <span>${escapeHtml(formatActivityType(record.activityType))}</span>
          <span>${escapeHtml(formatGender(record.gender))} | ${escapeHtml(formatAgeGroup(record.ageGroup))}</span>
          <span>${escapeHtml(formatMapLocation(record.location))} | ${escapeHtml(formatDate(record.activityTime))}</span>
        </article>
      `;
    })
    .join("");

  return `
    ${renderPopupGrid(items)}
    <section class="management-map-popup-item">
      <p class="management-map-popup-label">Members</p>
      <div class="management-map-member-list">
        ${memberCards}
      </div>
    </section>
  `;
}

function renderPopupGrid(items) {
  return `
    <dl class="management-map-popup-grid">
      ${items
        .map(
          ([label, value]) => `
            <div class="management-map-popup-item">
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value ?? "-")}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

function summarizeSharedRecordValue(records, formatter, options = {}) {
  const values = records
    .map((record) => formatter(record))
    .filter((value) => typeof value === "string" && value.trim());

  if (!values.length) {
    return options.emptyValue || "-";
  }

  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 1) {
    return uniqueValues[0];
  }

  return options.multiValue || "Mixed";
}

function sortGroupRecords(records) {
  return [...records].sort((left, right) => {
    const leftParsed = parseAutoActorId(left.actorId);
    const rightParsed = parseAutoActorId(right.actorId);
    if (leftParsed && rightParsed && leftParsed.personNumber !== rightParsed.personNumber) {
      return leftParsed.personNumber - rightParsed.personNumber;
    }
    return String(left.activityTime || "").localeCompare(String(right.activityTime || ""));
  });
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

function getClusterLabel(clusterNumber) {
  if (!Number.isFinite(clusterNumber)) {
    return "Group";
  }

  return `CL${String(clusterNumber).padStart(4, "0")}`;
}

function onMapBackgroundClick(event) {
  if (
    event.target === managementMapWrap ||
    event.target === managementMapCanvas ||
    event.target === managementMapImage
  ) {
    clearMapSelection();
  }
}

function onDocumentKeyDown(event) {
  if (event.key === "Escape" && isObservationPhotoModalOpen()) {
    closeObservationPhotoModal();
    return;
  }

  if (event.key === "Escape" && selectedMapItem) {
    clearMapSelection();
  }
}

function onObservationPhotoModalClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.hasAttribute("data-observation-photo-close")) {
    closeObservationPhotoModal();
  }
}

function openObservationPhotoModal(observationId) {
  if (!observationPhotoModal || !observationPhotoModalImage || !observationId) {
    return;
  }

  const observation = observations.find((item) => item.id === observationId);
  const imageSource = observation?.photoUrl || observation?.photoPreview;
  if (!imageSource) {
    return;
  }

  observationPhotoModalImage.src = imageSource;
  observationPhotoModalImage.alt = observation.photoName || "Zoomed site observation";
  if (observationPhotoModalTitle) {
    observationPhotoModalTitle.textContent = observation.photoName || "Observation Photo";
  }
  if (observationPhotoModalSubtitle) {
    observationPhotoModalSubtitle.textContent = `${formatDate(observation.observationTime || observation.createdAt)} | ${getObservationContextText(observation)}`;
  }
  observationPhotoModal.hidden = false;
  observationPhotoModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeObservationPhotoModal() {
  if (!observationPhotoModal || !observationPhotoModalImage) {
    return;
  }

  observationPhotoModal.hidden = true;
  observationPhotoModal.setAttribute("aria-hidden", "true");
  observationPhotoModalImage.removeAttribute("src");
  observationPhotoModalImage.alt = "Zoomed site observation";
  document.body.classList.remove("modal-open");
}

function isObservationPhotoModalOpen() {
  return !!observationPhotoModal && !observationPhotoModal.hidden;
}

function getFloorConfig(buildingId, floorId) {
  return buildingMaps[buildingId]?.floors?.[floorId] || null;
}

function changeMapZoom(delta) {
  setMapZoom(mapZoomLevel + delta, { anchor: lastZoomAnchor });
}

function setMapZoom(nextZoom, options = {}) {
  if (!managementMapWrap || !managementMapCanvas) {
    return;
  }

  const preserveCenter = options.preserveCenter !== false;
  const anchor = normalizeZoomAnchor(options.anchor);
  const clampedZoom = clampZoom(nextZoom);
  if (!Number.isFinite(clampedZoom)) {
    return;
  }

  const previousWidth = managementMapCanvas.clientWidth;
  const previousHeight = managementMapCanvas.clientHeight;
  const fallbackAnchor = preserveCenter
    ? { x: managementMapWrap.clientWidth / 2, y: managementMapWrap.clientHeight / 2 }
    : null;
  const activeAnchor = anchor || fallbackAnchor;

  let anchorXRatio = 0.5;
  let anchorYRatio = 0.5;
  if (activeAnchor && previousWidth && previousHeight) {
    anchorXRatio = (managementMapWrap.scrollLeft + activeAnchor.x) / previousWidth;
    anchorYRatio = (managementMapWrap.scrollTop + activeAnchor.y) / previousHeight;
  }

  mapZoomLevel = clampedZoom;
  managementMapCanvas.style.width = `${(mapZoomLevel * 100).toFixed(2)}%`;
  updateZoomControls();
  renderManagementMap();

  if (activeAnchor) {
    const nextWidth = managementMapCanvas.clientWidth || previousWidth;
    const nextHeight = managementMapCanvas.clientHeight || previousHeight;
    if (nextWidth) {
      managementMapWrap.scrollLeft = clampScrollValue(nextWidth * anchorXRatio - activeAnchor.x);
    }
    if (nextHeight) {
      managementMapWrap.scrollTop = clampScrollValue(nextHeight * anchorYRatio - activeAnchor.y);
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
  if (!managementZoomValue || !managementZoomOutBtn || !managementZoomInBtn || !managementZoomResetBtn) {
    return;
  }

  const hasActiveMap = !!managementMapImage?.getAttribute("src");
  managementZoomValue.textContent = hasActiveMap ? `${Math.round(mapZoomLevel * 100)}%` : "--";
  managementZoomOutBtn.disabled = !hasActiveMap || mapZoomLevel <= MIN_MAP_ZOOM + 0.0001;
  managementZoomInBtn.disabled = !hasActiveMap || mapZoomLevel >= MAX_MAP_ZOOM - 0.0001;
  managementZoomResetBtn.disabled = !hasActiveMap;
}

function onMapWheel(event) {
  if (!managementMapImage || !managementMapImage.getAttribute("src")) {
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
  if (event.pointerType === "mouse" && event.buttons !== 0) {
    return;
  }

  lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
}

function getAnchorFromClientPoint(clientX, clientY) {
  if (!managementMapWrap) {
    return null;
  }

  const rect = managementMapWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  return normalizeZoomAnchor({
    x: clientX - rect.left,
    y: clientY - rect.top,
  });
}

function normalizeZoomAnchor(anchor) {
  if (!managementMapWrap || !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return null;
  }

  return {
    x: Math.min(managementMapWrap.clientWidth, Math.max(0, anchor.x)),
    y: Math.min(managementMapWrap.clientHeight, Math.max(0, anchor.y)),
  };
}

function clampScrollValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function renderRecords() {
  const filtered = getFilteredRecords();
  const filteredObservations = getFilteredObservations();

  recordCount.textContent = `${filtered.length} of ${records.length} record${records.length === 1 ? "" : "s"}`;
  renderSiteObservations(filteredObservations);
  recordsTbody.innerHTML = "";
  renderManagementMap(filtered);

  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="12">No records match the current filters.</td>`;
    recordsTbody.appendChild(tr);
    return;
  }

  filtered.forEach((record) => {
    const recordBuildingId = getRecordBuildingId(record);
    const recordFloorId = getRecordFloorId(record, recordBuildingId);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(record.activityTime)}</td>
      <td>${escapeHtml(formatActivityType(record.activityType))}</td>
      <td>${escapeHtml(record.actorId || "-")}</td>
      <td>${escapeHtml(formatGender(record.gender))}</td>
      <td>${escapeHtml(formatAgeGroup(record.ageGroup))}</td>
      <td>${escapeHtml(getBuildingLabel(recordBuildingId))}</td>
      <td>${escapeHtml(getFloorLabel(recordBuildingId, recordFloorId))}</td>
      <td>${escapeHtml(formatMapLocation(record.location))}</td>
      <td>${formatPhotoPreviewCell(record.photoUrl, record.photoPreview, record.photoName)}</td>
      <td>${escapeHtml(formatPhotoLocationText(record.photoLocation, record.photoName))}</td>
      <td>${escapeHtml(record.notes || "-")}</td>
      <td><button type="button" class="danger" data-delete-id="${record.id}">Delete</button></td>
    `;
    recordsTbody.appendChild(tr);
  });

  recordsTbody.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.deleteId || ""));
  });
}

function renderSiteObservations(filteredObservations = getFilteredObservations()) {
  if (!observationList || !observationCount) {
    return;
  }

  observationCount.textContent = `${filteredObservations.length} of ${observations.length} observation${observations.length === 1 ? "" : "s"}`;
  observationList.innerHTML = "";

  if (!filteredObservations.length) {
    observationList.innerHTML = `<p class="observation-empty">No site observations match the current filters.</p>`;
    return;
  }

  filteredObservations.forEach((observation) => {
    const imageSource = observation.photoUrl || observation.photoPreview;
    const observationTypeLabel = observation.observationType === "photo" ? "Photo" : "Note";
    const card = document.createElement("article");
    card.className = "observation-card";
    card.innerHTML = `
      <div class="observation-card-media">
        ${
          imageSource
            ? `
              <button type="button" class="observation-photo-button" data-observation-photo-id="${escapeHtml(observation.id)}" aria-label="Zoom observation photo">
                <img
                  class="observation-card-photo"
                  src="${imageSource}"
                  alt="${escapeHtml(observation.photoName || "Site observation photo")}"
                  loading="lazy"
                  decoding="async"
                >
              </button>
            `
            : `<div class="observation-photo-placeholder">No photo</div>`
        }
      </div>
      <div class="observation-card-copy">
        <p class="observation-card-meta">${escapeHtml(formatDate(observation.observationTime || observation.createdAt))}</p>
        <p class="observation-card-context">${escapeHtml(getObservationContextText(observation))}</p>
        <p class="observation-card-note">${escapeHtml(truncateWords(observation.note || "No note added.", 100))}</p>
        <div class="observation-card-actions">
          <span class="observation-card-type">${escapeHtml(observationTypeLabel)}</span>
          <button type="button" class="danger observation-delete-btn" data-delete-observation-id="${escapeHtml(observation.id)}">Delete</button>
        </div>
      </div>
    `;
    observationList.appendChild(card);
  });

  observationList.querySelectorAll("[data-observation-photo-id]").forEach((button) => {
    button.addEventListener("click", () => openObservationPhotoModal(button.dataset.observationPhotoId || ""));
  });
  observationList.querySelectorAll("[data-delete-observation-id]").forEach((button) => {
    button.addEventListener("click", () => deleteSiteObservation(button.dataset.deleteObservationId || ""));
  });
}

async function loadRecords() {
  const payload = await apiGet(API_RECORDS);
  const values = Array.isArray(payload.records) ? payload.records : [];
  return values
    .map((record) => normalizeRecord(record))
    .filter((record) => record !== null);
}

async function loadSiteObservations() {
  const payload = await apiGet(API_SITE_OBSERVATIONS);
  const values = Array.isArray(payload.observations) ? payload.observations : [];
  return values
    .map((observation) => normalizeObservation(observation))
    .filter((observation) => observation !== null);
}

async function deleteRecord(id) {
  if (!id) {
    return;
  }

  const record = records.find((item) => item.id === id);
  const label = record?.actorId ? `record ${record.actorId}` : "this record";
  if (!window.confirm(`Delete ${label}?`)) {
    return;
  }

  try {
    const response = await apiRequest(`${API_RECORDS}${id}/`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    records = records.filter((item) => item.id !== id);
    renderRecords();
    setManagementStatus(`Deleted ${label}.`, "success");
  } catch (error) {
    setManagementStatus(`Could not delete record: ${error.message}`, "error");
    alert(`Could not delete record: ${error.message}`);
  }
}

async function deleteSiteObservation(id) {
  if (!id) {
    return;
  }

  const observation = observations.find((item) => item.id === id);
  const label = buildObservationDeleteLabel(observation);
  if (!window.confirm(`Delete ${label}?`)) {
    return;
  }

  try {
    const response = await apiRequest(`${API_SITE_OBSERVATIONS}${id}/`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    observations = observations.filter((item) => item.id !== id);
    closeObservationPhotoModal();
    renderRecords();
    setManagementStatus(`Deleted ${label}.`, "success");
  } catch (error) {
    setManagementStatus(`Could not delete site observation: ${error.message}`, "error");
    alert(`Could not delete site observation: ${error.message}`);
  }
}

function buildObservationDeleteLabel(observation) {
  if (!observation) {
    return "this site observation";
  }

  if (observation.observationType === "photo") {
    return observation.photoName ? `photo observation ${observation.photoName}` : "this photo observation";
  }

  return "this note observation";
}

async function onExport() {
  try {
    const response = await fetch(API_RECORDS_EXPORT, { credentials: "same-origin" });
    if (await maybeRedirectToManagementLogin(response)) {
      return;
    }
    if (!response.ok) {
      throw new Error(`Export failed (${response.status}).`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getDownloadFilename(response.headers.get("Content-Disposition"));
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    setManagementStatus(`Could not export records: ${error.message}`, "error");
    alert(`Could not export records: ${error.message}`);
  }
}

function getDownloadFilename(contentDispositionHeader) {
  if (!contentDispositionHeader) {
    return `indoor-activity-records-${new Date().toISOString().slice(0, 10)}.json`;
  }

  const match = contentDispositionHeader.match(/filename="?([^";]+)"?/i);
  if (match?.[1]) {
    return match[1];
  }

  return `indoor-activity-records-${new Date().toISOString().slice(0, 10)}.json`;
}

function setManagementStatus(message, state = "muted") {
  managementStatus.textContent = message;
  managementStatus.dataset.state = state;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    ...record,
    buildingId: typeof record.buildingId === "string" && record.buildingId.trim() ? record.buildingId : null,
    floorId: typeof record.floorId === "string" && record.floorId.trim() ? record.floorId : null,
    activityType: normalizeActivityTypeValue(record.activityType),
    gender: normalizeGender(record.gender),
    ageGroup: normalizeAgeGroup(record.ageGroup),
    location: hasMapLocation(record.location) ? { ...record.location } : null,
    photoLocation: isValidPhotoLocation(record.photoLocation) ? { ...record.photoLocation } : null,
    photoName: typeof record.photoName === "string" && record.photoName.trim() ? record.photoName : null,
    photoUrl: normalizePhotoUrl(record.photoUrl),
    photoPreview: normalizePhotoPreview(record.photoPreview),
  };
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== "object") {
    return null;
  }

  const normalizedType =
    observation.observationType === "photo" || observation.observationType === "note"
      ? observation.observationType
      : "note";

  return {
    ...observation,
    buildingId:
      typeof observation.buildingId === "string" && observation.buildingId.trim() ? observation.buildingId : null,
    floorId: typeof observation.floorId === "string" && observation.floorId.trim() ? observation.floorId : null,
    observationType: normalizedType,
    note: typeof observation.note === "string" && observation.note.trim() ? observation.note.trim() : null,
    photoName:
      typeof observation.photoName === "string" && observation.photoName.trim() ? observation.photoName.trim() : null,
    photoUrl: normalizePhotoUrl(observation.photoUrl),
    photoPreview: normalizePhotoPreview(observation.photoPreview),
  };
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

function getObservationBuildingId(observation) {
  return typeof observation?.buildingId === "string" && observation.buildingId.trim() ? observation.buildingId : "";
}

function getObservationFloorId(observation) {
  return typeof observation?.floorId === "string" && observation.floorId.trim() ? observation.floorId : "";
}

function getObservationContextText(observation) {
  const buildingId = getObservationBuildingId(observation);
  const floorId = getObservationFloorId(observation);

  if (buildingId && floorId) {
    return `${getBuildingLabel(buildingId)} / ${getFloorLabel(buildingId, floorId)}`;
  }
  if (buildingId) {
    return getBuildingLabel(buildingId);
  }
  return "No map context";
}

function getObservationSortValue(observation) {
  const observationTime = Date.parse(observation?.observationTime || "");
  if (Number.isFinite(observationTime)) {
    return observationTime;
  }

  const createdAt = Date.parse(observation?.createdAt || "");
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return 0;
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
  if (!hasMapLocation(location)) {
    return "-";
  }
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

function formatActivityType(value) {
  if (Array.isArray(value)) {
    const normalized = normalizeActivityTypeSelection(value);
    return normalized.length ? normalized.join(", ") : "-";
  }

  if (typeof value !== "string") {
    return "-";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }

  const normalized = normalizeActivityTypeSelection(trimmed);
  return normalized.length ? normalized.join(", ") : trimmed;
}

function formatAgeGroup(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function normalizeActivityTypeValue(value) {
  if (Array.isArray(value)) {
    const normalized = normalizeActivityTypeSelection(value);
    return normalized.length ? normalized.join(", ") : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeActivityTypeSelection(trimmed);
  return normalized.length ? normalized.join(", ") : trimmed;
}

function normalizeActivityTypeSelection(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const selected = new Set();

  rawValues.forEach((candidate) => {
    const normalized = normalizeActivityTypeLabel(candidate);
    if (normalized) {
      selected.add(normalized);
    }
  });

  return ACTIVITY_TYPE_OPTIONS.filter((option) => selected.has(option));
}

function normalizeActivityTypeLabel(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const aliased = ACTIVITY_TYPE_ALIASES[trimmed.toLowerCase()] || trimmed;
  const matchedOption = ACTIVITY_TYPE_OPTIONS.find((option) => option.toLowerCase() === aliased.toLowerCase());
  return matchedOption || "";
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

function formatPhotoPreviewCell(photoUrl, photoPreview, photoName) {
  const imageSource = normalizePhotoUrl(photoUrl) || normalizePhotoPreview(photoPreview);
  if (!imageSource) {
    return "-";
  }

  const altText = escapeHtml(photoName ? `${photoName} preview` : "Photo preview");
  return `<img class="record-photo-preview" src="${imageSource}" alt="${altText}" loading="lazy" decoding="async">`;
}

function normalizePhotoUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  ) {
    return normalized;
  }

  return null;
}

function normalizePhotoPreview(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_PREVIEW_DATA_URL_LENGTH) {
    return null;
  }

  if (!PREVIEW_DATA_URL_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function truncateWords(value, wordLimit = 100) {
  if (typeof value !== "string") {
    return "";
  }

  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) {
    return words.join(" ");
  }

  return `${words.slice(0, wordLimit).join(" ")}...`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function formatCoordinate(value) {
  return (Math.round(value * 1000000) / 1000000).toFixed(6);
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

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
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
    headers: {
      Accept: "application/json",
    },
  });

  if (await maybeRedirectToManagementLogin(response)) {
    throw new Error("Management access code required.");
  }

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return response.json();
}

async function apiRequest(url, { method = "GET", body = null } = {}) {
  const headers = {
    Accept: "application/json",
  };

  let payload;
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

  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers,
    body: payload,
  });

  if (await maybeRedirectToManagementLogin(response)) {
    throw new Error("Management access code required.");
  }

  return response;
}

function getCsrfToken() {
  const tokenPair = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("csrftoken="));

  if (tokenPair) {
    return decodeURIComponent(tokenPair.slice("csrftoken=".length));
  }

  const formToken = document.querySelector("input[name='csrfmiddlewaretoken']")?.value;
  return formToken || "";
}

async function parseApiError(response) {
  try {
    const data = await response.json();

    if (typeof data.error === "string" && data.error) {
      return data.error;
    }

    if (data.error && typeof data.error === "object") {
      if (data.error.fields && typeof data.error.fields === "object") {
        const message = Object.entries(data.error.fields)
          .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(", ") : messages}`)
          .join(" | ");
        if (message) {
          return message;
        }
      }

      if (Array.isArray(data.error.message)) {
        return data.error.message.join(", ");
      }
    }
  } catch {
    // Fall through to status text.
  }

  return `Request failed (${response.status} ${response.statusText})`;
}

async function maybeRedirectToManagementLogin(response) {
  if (response.status !== 401) {
    return false;
  }

  try {
    const payload = await response.clone().json();
    if (typeof payload.loginUrl === "string" && payload.loginUrl) {
      window.location.assign(payload.loginUrl);
      return true;
    }
  } catch {
    // Ignore JSON parsing errors and let normal error handling continue.
  }

  return false;
}
