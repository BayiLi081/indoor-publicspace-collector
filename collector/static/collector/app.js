import { extractPhotoLocationFromImage, requestCurrentDeviceDirection, requestCurrentDeviceLocation } from "./image-location.js";
import { loadActivityCatalog } from "./activity-catalog.js";

const API_BUILDINGS = "/api/buildings/";
const API_RECORDS = "/api/records/";
const API_RECORDS_EXPORT = "/api/records/export/";
const API_SITE_OBSERVATIONS = "/api/site-observations/";
const DEFAULT_LOCATE_STATUS_MESSAGE = "Use Locate via GPS for your approximate spot, or Locate via POI to show named places.";
const DEFAULT_OBSERVATION_STATUS_MESSAGE = "Site Observations";

const ROOT_BUILDING_ID = "__root__";
const DEFAULT_BUILDING_ID = "SUTD";
const DEFAULT_FLOOR_ID = "main-buildings";
const MAX_PREVIEW_DATA_URL_LENGTH = 180000;
const PREVIEW_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i;
const AUTO_ACTOR_ID_PATTERN = /^CL(\d+)-P(\d+)$/i;
const MIN_MAP_ZOOM = 0.25;
const MAX_MAP_ZOOM = 8;
const MAP_ZOOM_STEP = 0.1;
const DEFAULT_MAP_ZOOM = 1;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
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

const mapWrap = document.getElementById("mapWrap");
const mapCanvas = document.getElementById("mapCanvas");
const mapImage = document.getElementById("mapImage");
const mapPanel = document.querySelector(".map-panel");
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
const saveRecordBtn = document.getElementById("saveRecordBtn");
const collectToggleBtn = document.getElementById("collectToggleBtn");
const collectControls = collectToggleBtn ? collectToggleBtn.closest(".collect-controls") : null;
const collectStatus = document.getElementById("collectStatus");
const locateViaGpsBtn = document.getElementById("locateViaGpsBtn");
const locateViaPoiBtn = document.getElementById("locateViaPoiBtn");
const locateStatus = document.getElementById("locateStatus");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomValue = document.getElementById("zoomValue");
const activityTypeButtons = Array.from(document.querySelectorAll(".toggle-btn[data-activity-type]"));
const genderButtons = Array.from(document.querySelectorAll(".toggle-btn[data-gender]"));
const ageGroupButtons = Array.from(document.querySelectorAll(".toggle-btn[data-age-group]"));
const indivGrpButtons = Array.from(document.querySelectorAll(".indivgrp-btn[data-indivgrp-type]"));
const activityFormHeading = document.getElementById("activityFormHeading");
const recordMode = document.getElementById("recordMode");
const grpCounterDown = document.getElementById("grpCounterDown");
const grpCounterUp = document.getElementById("grpCounterUp");
const groupValue = document.getElementById("groupValue");
const groupCounterContainer = document.getElementById("groupCounterContainer");
const individualDetailFields = document.getElementById("individualDetailFields");
const groupDetailsPanel = document.getElementById("groupDetailsPanel");
const groupDetailsHint = document.getElementById("groupDetailsHint");
const groupPersonList = document.getElementById("groupPersonList");
const savePrompt = document.getElementById("savePrompt");
const groupPointModal = document.getElementById("groupPointModal");
const groupPointForm = document.getElementById("groupPointForm");
const groupPointModalTitle = document.getElementById("groupPointModalTitle");
const groupPointModalCoords = document.getElementById("groupPointModalCoords");
const groupPointModalPrompt = document.getElementById("groupPointModalPrompt");
const groupPointCancelBtn = document.getElementById("groupPointCancelBtn");
const groupPointRemoveBtn = document.getElementById("groupPointRemoveBtn");
const groupPointSaveBtn = document.getElementById("groupPointSaveBtn");
const groupPointActivityButtons = Array.from(document.querySelectorAll(".group-point-activity-btn"));
const groupPointGenderButtons = Array.from(document.querySelectorAll(".group-point-gender-btn"));
const groupPointAgeButtons = Array.from(document.querySelectorAll(".group-point-age-btn"));
const observationCameraBtn = document.getElementById("observationCameraBtn");
const observationNoteBtn = document.getElementById("observationNoteBtn");
const observationStatus = document.getElementById("observationStatus");
const observationPhotoInput = document.getElementById("observationPhotoInput");
const observationModal = document.getElementById("observationModal");
const observationForm = document.getElementById("observationForm");
const observationContext = document.getElementById("observationContext");
const observationNote = document.getElementById("observationNote");
const observationPrompt = document.getElementById("observationPrompt");
const observationCancelBtn = document.getElementById("observationCancelBtn");
const observationSaveBtn = document.getElementById("observationSaveBtn");
const poiMapsCache = new Map();
const poiLoadPromises = new Map();

let records = [];
let selectedPoints = [];
let draftGroupPoint = null;
let selectedActivityTypes = [];
let selectedGender = "";
let selectedPhotoFile = null;
let selectedPhotoLocation = null;
let selectedPhotoName = "";
let isPhotoLocationLoading = false;
let buildingMaps = {};
let currentBuildingId = "";
let currentFloorId = "";
let isCollecting = false;
let currentClusterNumber = 0;
let currentPersonNumber = 0;
let lastGeneratedClusterNumber = 0;
let savePromptTimerId = 0;
let observationStatusTimerId = 0;
let mapZoomLevel = DEFAULT_MAP_ZOOM;
let userLocationPoint = null;
let isLocatingViaGps = false;
let isLocatingViaPoi = false;
let poiVisible = false;
let poiRequestToken = 0;
let shouldAnimatePois = false;
let lastZoomAnchor = null;
let pinchStartDistance = 0;
let pinchStartZoom = DEFAULT_MAP_ZOOM;
let groupCount = 2;
let groupPointModalState = null;
let groupPointSelectedActivityTypes = [];
let groupPointSelectedGender = "";
let groupPointSelectedAgeGroup = "";
let isSavingObservation = false;

initialize().catch((error) => {
  console.error("Initialization failed:", error);
  alert("Could not initialize the application. Check Django API and assets configuration.");
});

async function initialize() {
  activityTime.value = toDateTimeLocalValue(new Date());
  setPhotoLocationStatus("No image selected.", "muted");
  setLocateStatus(DEFAULT_LOCATE_STATUS_MESSAGE, "muted");
  setObservationStatus(DEFAULT_OBSERVATION_STATUS_MESSAGE, "muted");
  setPoiOverlayButtonState(false);
  setSavePrompt("", "muted");

  buildingSelect.innerHTML = "<option>Loading...</option>";
  floorSelect.innerHTML = "<option>Loading...</option>";

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  mapWrap.addEventListener("click", onMapClick);
  mapWrap.addEventListener("wheel", onMapWheel, { passive: false });
  mapWrap.addEventListener("pointermove", onMapPointerMove);
  mapWrap.addEventListener("touchstart", onMapTouchStart, { passive: true });
  mapWrap.addEventListener("touchmove", onMapTouchMove, { passive: false });
  mapWrap.addEventListener("touchend", onMapTouchEnd, { passive: true });
  mapWrap.addEventListener("touchcancel", onMapTouchEnd, { passive: true });
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
  if (searchInput) {
    searchInput.addEventListener("input", renderRecords);
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", onExport);
  }
  resetFormBtn.addEventListener("click", () => resetForm(true, false));
  if (collectToggleBtn) {
    collectToggleBtn.addEventListener("click", onCollectToggle);
  }
  if (zoomOutBtn && zoomInBtn && zoomResetBtn) {
    zoomOutBtn.addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
    zoomInBtn.addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
    zoomResetBtn.addEventListener("click", () => setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false }));
  }
  activityTypeButtons.forEach((button) => {
    button.addEventListener("click", () => toggleActivityType(button.dataset.activityType || ""));
  });
  genderButtons.forEach((button) => {
    button.addEventListener("click", () => setSelectedGender(button.dataset.gender || ""));
  });
  ageGroupButtons.forEach((button) => {
    button.addEventListener("click", () => setSelectedAgeGroup(button.dataset.ageGroup || ""));
  });
  indivGrpButtons.forEach((button) => {
    button.addEventListener("click", () => activateCaptureMode(button.dataset.indivgrpType || ""));
  });
  if (grpCounterUp && grpCounterDown) {
    grpCounterUp.addEventListener("click", () => changeGroupCount(1));
    grpCounterDown.addEventListener("click", () => changeGroupCount(-1));
  }
  if (locateViaGpsBtn) {
    locateViaGpsBtn.addEventListener("click", onLocateViaGps);
  }
  if (locateViaPoiBtn) {
    locateViaPoiBtn.addEventListener("click", onLocateViaPoi);
  }
  if (groupPointForm) {
    groupPointForm.addEventListener("submit", onGroupPointFormSubmit);
  }
  if (groupPointCancelBtn) {
    groupPointCancelBtn.addEventListener("click", onGroupPointCancel);
  }
  if (groupPointRemoveBtn) {
    groupPointRemoveBtn.addEventListener("click", onGroupPointRemove);
  }
  if (groupPointModal) {
    groupPointModal.addEventListener("click", onGroupPointModalClick);
  }
  if (observationCameraBtn) {
    observationCameraBtn.addEventListener("click", onObservationCameraClick);
  }
  if (observationNoteBtn) {
    observationNoteBtn.addEventListener("click", onObservationNoteClick);
  }
  if (observationPhotoInput) {
    observationPhotoInput.addEventListener("change", onObservationPhotoChange);
  }
  if (observationForm) {
    observationForm.addEventListener("submit", onObservationFormSubmit);
  }
  if (observationCancelBtn) {
    observationCancelBtn.addEventListener("click", () => closeObservationModal());
  }
  if (observationModal) {
    observationModal.addEventListener("click", onObservationModalClick);
  }
  groupPointActivityButtons.forEach((button) => {
    button.addEventListener("click", () => toggleGroupPointActivityType(button.dataset.groupPointActivityType || ""));
  });
  groupPointGenderButtons.forEach((button) => {
    button.addEventListener("click", () => setGroupPointSelectedGender(button.dataset.groupPointGender || ""));
  });
  groupPointAgeButtons.forEach((button) => {
    button.addEventListener("click", () => setGroupPointSelectedAgeGroup(button.dataset.groupPointAgeLabel || ""));
  });
  document.addEventListener("keydown", onDocumentKeyDown);
  setMapZoom(DEFAULT_MAP_ZOOM, { preserveCenter: false });

  setCollectionActive(false);
  setSelectedActivityTypes([]);
  setSelectedGender("");
  setSelectedAgeGroup("");
  setRecordMode("");

  await loadBuildingMaps();
  updateObservationContext();
  records = await loadRecords();
  lastGeneratedClusterNumber = getMaxKnownClusterNumber(records);
  renderMarkers();
  renderRecords();
}

async function loadBuildingMaps() {
  const discoveredMaps = await fetchBuildingMaps();
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

function onBuildingChange(event) {
  currentBuildingId = event.target.value;
  renderFloorOptions(currentBuildingId);
  currentFloorId = floorSelect.value || "";
  updateObservationContext();
  userLocationPoint = null;
  if (!poiVisible) {
    resetLocateStatusToBase();
  }

  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
  if (poiVisible) {
    void refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
  }
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  updateObservationContext();
  userLocationPoint = null;
  if (!poiVisible) {
    resetLocateStatusToBase();
  }
  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
  if (poiVisible) {
    void refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
  }
}

function onCollectToggle() {
  if (!isCollecting) {
    return;
  }
  finishCollection();
}

function activateCaptureMode(value) {
  const mode = normalizeRecordMode(value);
  if (!mode) {
    return;
  }

  if (isCollecting && recordMode.value === mode && currentClusterNumber) {
    setCollectStatus(getCollectionActivatedMessage(mode), "active");
    return;
  }

  setRecordMode(mode);
  initializeAutoIdsForCollection();
  setCollectionActive(true);
  resetForm(true, false);
  setSavePrompt("", "muted");
  setCollectStatus(getCollectionActivatedMessage(mode), "active");
}

function finishCollection(message = "Capture ended. Select Individual or Group to begin again.") {
  setCollectionActive(false);
  clearAutoIdsForCollection();
  resetForm(true, false);
  setRecordMode("");
  setCollectStatus(message, "muted");
}

function setCollectionActive(active) {
  isCollecting = !!active;
  if (mapPanel) {
    mapPanel.classList.toggle("capture-active", isCollecting);
  }
  if (!collectToggleBtn) {
    return;
  }

  collectToggleBtn.textContent = "End Capture";
  collectToggleBtn.classList.toggle("active", isCollecting);
  collectToggleBtn.setAttribute("aria-pressed", isCollecting ? "true" : "false");
  collectToggleBtn.disabled = !isCollecting;
  if (collectControls) {
    collectControls.hidden = !isCollecting;
  } else {
    collectToggleBtn.hidden = !isCollecting;
  }
}

function setCollectStatus(message, state = "muted") {
  if (!collectStatus) {
    return;
  }
  collectStatus.textContent = message;
  collectStatus.dataset.state = state;
}

function normalizeRecordMode(value) {
  return value === "individual" || value === "group" ? value : "";
}

function isGroupMode() {
  return recordMode.value === "group";
}

function getCollectionActivatedMessage(mode) {
  const clusterLabel = getCurrentClusterIdLabel();
  if (mode === "group") {
    return `Group capture active for ${clusterLabel}. Tap a map point to open the member details popup. Save the group form after all ${groupCount} members are entered.`;
  }

  return `Individual capture active for ${clusterLabel}. Tap one person on the map, fill the form, and save to finish.`;
}

function toggleActivityType(value) {
  const normalized = normalizeActivityTypeLabel(value);
  if (!normalized) {
    return;
  }

  const nextSelection = selectedActivityTypes.includes(normalized)
    ? selectedActivityTypes.filter((item) => item !== normalized)
    : [...selectedActivityTypes, normalized];
  setSelectedActivityTypes(nextSelection);
}

function changeGroupCount(delta) {
  groupCount += delta;
  if (groupCount < 2) {
    groupCount = 2;
  }
  if (selectedPoints.length > groupCount) {
    selectedPoints = selectedPoints.slice(0, groupCount);
  }
  if (
    draftGroupPoint && selectedPoints.length >= groupCount ||
    (groupPointModalState && Number.isInteger(groupPointModalState.index) && groupPointModalState.index >= groupCount)
  ) {
    closeGroupPointModal({ discardDraft: true, keepStatus: true });
  }
  if (groupValue) {
    groupValue.textContent = groupCount;
  }
  updateSelectedCoordsText();
  if (isCollecting && isGroupMode()) {
    setCollectStatus(getGroupCaptureProgressMessage(), "active");
    renderMarkers();
  }
  renderGroupPersonList();
  return groupCount;
}

function setSelectedActivityTypes(values) {
  selectedActivityTypes = normalizeActivityTypeSelection(values);
  activityType.value = selectedActivityTypes.join(", ");
  activityTypeButtons.forEach((button) => {
    const activity = normalizeActivityTypeLabel(button.dataset.activityType || "");
    const isActive = selectedActivityTypes.includes(activity);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setSelectedGender(value) {
  selectedGender = value === "male" || value === "female" ? value : "";
  genderButtons.forEach((button) => {
    const isActive = button.dataset.gender === selectedGender;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setSelectedAgeGroup(value) {
  const selectedButton = ageGroupButtons.find((button) => button.dataset.ageGroup === value) || null;
  const nextAgeGroup = selectedButton ? selectedButton.dataset.ageLabel || selectedButton.textContent.trim() : "";
  ageGroup.value = nextAgeGroup;
  ageGroupButtons.forEach((button) => {
    const isActive = button === selectedButton;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setRecordMode(value) {
  const mode = normalizeRecordMode(value);
  recordMode.value = mode;
  indivGrpButtons.forEach((button) => {
    const isActive = button.dataset.indivgrpType === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  const headingText = mode === "group" ? "Record Group" : "Record Activity";
  activityFormHeading.textContent = headingText;

  if (groupCounterContainer) {
    groupCounterContainer.style.display = mode === "group" ? "flex" : "none";
  }
  if (individualDetailFields) {
    individualDetailFields.hidden = mode === "group";
  }
  if (groupDetailsPanel) {
    groupDetailsPanel.hidden = mode !== "group";
  }
  if (saveRecordBtn) {
    saveRecordBtn.textContent = mode === "group" ? "Save Group" : "Save Record";
  }
  if (mode !== "group") {
    closeGroupPointModal({ discardDraft: true, keepStatus: true });
  }
  renderGroupPersonList();
}

function updateSelectedCoordsText() {
  if (!selectedPoints.length) {
    selectedCoords.textContent = "None";
    return;
  }

  if (!isGroupMode() && selectedPoints.length === 1) {
    const [point] = selectedPoints;
    selectedCoords.textContent = `${point.xPct}%, ${point.yPct}%`;
    return;
  }

  const latestPoint = selectedPoints[selectedPoints.length - 1];
  selectedCoords.textContent = `${selectedPoints.length} of ${groupCount} members saved. Latest: ${latestPoint.xPct}%, ${latestPoint.yPct}%`;
}

function getGroupCaptureProgressMessage() {
  const clusterLabel = getCurrentClusterIdLabel();
  if (isGroupPointModalOpen()) {
    return `Group capture active for ${clusterLabel}. Complete the member popup before selecting another point.`;
  }
  if (!selectedPoints.length) {
    return `Group capture active for ${clusterLabel}. Tap a point on the map to enter member 1 of ${groupCount}.`;
  }

  if (selectedPoints.length < groupCount) {
    return `Group capture active for ${clusterLabel}. ${selectedPoints.length} of ${groupCount} members saved. Tap the map to add the next member.`;
  }

  return `Group capture active for ${clusterLabel}. All ${groupCount} members are ready. Save the group form to finish.`;
}

function isGroupPointModalOpen() {
  return !!groupPointModalState;
}

function isObservationModalOpen() {
  return !!observationModal && !observationModal.hidden;
}

function isCompleteGroupPoint(point) {
  return (
    !!point &&
    Array.isArray(point.activityTypes) &&
    point.activityTypes.length > 0 &&
    (point.gender === "male" || point.gender === "female") &&
    typeof point.ageGroup === "string" &&
    point.ageGroup.trim().length > 0
  );
}

function toggleGroupPointActivityType(value) {
  const normalized = normalizeActivityTypeLabel(value);
  if (!normalized) {
    return;
  }

  const nextSelection = groupPointSelectedActivityTypes.includes(normalized)
    ? groupPointSelectedActivityTypes.filter((item) => item !== normalized)
    : [...groupPointSelectedActivityTypes, normalized];
  setGroupPointSelectedActivityTypes(nextSelection);
}

function setGroupPointSelectedActivityTypes(values) {
  groupPointSelectedActivityTypes = normalizeActivityTypeSelection(values);
  groupPointActivityButtons.forEach((button) => {
    const activity = normalizeActivityTypeLabel(button.dataset.groupPointActivityType || "");
    const isActive = groupPointSelectedActivityTypes.includes(activity);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setGroupPointSelectedGender(value) {
  groupPointSelectedGender = value === "male" || value === "female" ? value : "";
  groupPointGenderButtons.forEach((button) => {
    const isActive = button.dataset.groupPointGender === groupPointSelectedGender;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setGroupPointSelectedAgeGroup(value) {
  groupPointSelectedAgeGroup = typeof value === "string" ? value.trim() : "";
  groupPointAgeButtons.forEach((button) => {
    const isActive = (button.dataset.groupPointAgeLabel || "").trim() === groupPointSelectedAgeGroup;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function openGroupPointModal(point, index = null) {
  if (!groupPointModal || !groupPointForm || !point) {
    return;
  }

  groupPointModalState = { index };
  const pointNumber = index === null ? selectedPoints.length + 1 : index + 1;
  const isEditing = index !== null;
  const pointDetails = isEditing ? selectedPoints[index] : point;

  if (groupPointModalTitle) {
    groupPointModalTitle.textContent = isEditing
      ? `Edit Member ${pointNumber}`
      : `Member ${pointNumber} Details`;
  }
  if (groupPointModalCoords) {
    groupPointModalCoords.textContent = `Point ${point.xPct}%, ${point.yPct}%`;
  }
  if (groupPointRemoveBtn) {
    groupPointRemoveBtn.hidden = !isEditing;
  }
  if (groupPointSaveBtn) {
    groupPointSaveBtn.textContent = isEditing ? "Update Member" : "Save Member";
  }

  setGroupPointSelectedActivityTypes(pointDetails.activityTypes || []);
  setGroupPointSelectedGender(pointDetails.gender || "");
  setGroupPointSelectedAgeGroup(pointDetails.ageGroup || "");
  setSavePrompt("", "muted");
  setGroupPointModalPrompt("", "muted");

  groupPointModal.hidden = false;
  groupPointModal.setAttribute("aria-hidden", "false");
  syncModalOpenState();
}

function closeGroupPointModal({ discardDraft = false, keepStatus = false } = {}) {
  if (!groupPointModal) {
    return;
  }

  if (discardDraft) {
    draftGroupPoint = null;
  }
  groupPointModal.hidden = true;
  groupPointModal.setAttribute("aria-hidden", "true");
  groupPointModalState = null;
  setGroupPointSelectedActivityTypes([]);
  setGroupPointSelectedGender("");
  setGroupPointSelectedAgeGroup("");
  setGroupPointModalPrompt("", "muted");
  syncModalOpenState();
  if (!keepStatus && isCollecting && isGroupMode()) {
    setCollectStatus(getGroupCaptureProgressMessage(), "active");
  }
  renderMarkers();
}

function syncModalOpenState() {
  document.body.classList.toggle("modal-open", isGroupPointModalOpen() || isObservationModalOpen());
}

function setGroupPointModalPrompt(message, state = "muted") {
  if (!groupPointModalPrompt) {
    return;
  }
  groupPointModalPrompt.textContent = message;
  groupPointModalPrompt.dataset.state = state;
}

function renderGroupPersonList() {
  if (!groupDetailsPanel || !groupPersonList || !groupDetailsHint) {
    return;
  }

  if (!isGroupMode()) {
    groupPersonList.innerHTML = "";
    groupDetailsHint.textContent = "Tap a point on the map to open the member details popup.";
    return;
  }

  if (isGroupPointModalOpen()) {
    groupDetailsHint.textContent = `Complete the popup for member ${selectedPoints.length + 1} of ${groupCount}.`;
  } else if (selectedPoints.length < groupCount) {
    groupDetailsHint.textContent = `Saved ${selectedPoints.length} of ${groupCount} members. Tap the map to add the next member.`;
  } else {
    groupDetailsHint.textContent = `All ${groupCount} members are ready. You can now save the group form.`;
  }

  if (!selectedPoints.length) {
    groupPersonList.innerHTML = `<p class="group-person-empty">No group members saved yet.</p>`;
    return;
  }

  groupPersonList.innerHTML = selectedPoints
    .map((point, index) => {
      const activityText = formatActivityType(point.activityTypes);
      const genderText = formatGender(point.gender);
      const ageText = formatAgeGroup(point.ageGroup);
      return `
        <article class="group-person-card">
          <div class="group-person-copy">
            <strong>Member ${index + 1}</strong>
            <span>${escapeHtml(point.xPct)}%, ${escapeHtml(point.yPct)}%</span>
            <span>${escapeHtml(activityText)} | ${escapeHtml(genderText)} | ${escapeHtml(ageText)}</span>
          </div>
          <div class="group-person-actions">
            <button type="button" class="secondary" data-group-edit-index="${index}">Edit</button>
            <button type="button" class="secondary" data-group-remove-index="${index}">Remove</button>
          </div>
        </article>
      `;
    })
    .join("");

  groupPersonList.querySelectorAll("[data-group-edit-index]").forEach((button) => {
    button.addEventListener("click", () => onGroupPointEdit(Number.parseInt(button.dataset.groupEditIndex || "-1", 10)));
  });
  groupPersonList.querySelectorAll("[data-group-remove-index]").forEach((button) => {
    button.addEventListener("click", () => removeGroupPoint(Number.parseInt(button.dataset.groupRemoveIndex || "-1", 10)));
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
  if (event.pointerType === "mouse" && event.buttons !== 0) {
    return;
  }
  lastZoomAnchor = getAnchorFromClientPoint(event.clientX, event.clientY);
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

  const scale = nextDistance / pinchStartDistance;
  setMapZoom(pinchStartZoom * scale, { anchor });
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
  if (!isCollecting) {
    setCollectStatus("Select Individual or Group before selecting map points.", "warn");
    return;
  }
  if (isGroupMode() && isGroupPointModalOpen()) {
    setCollectStatus("Finish the open member popup before selecting another point.", "warn");
    return;
  }

  const rect = mapImage.getBoundingClientRect();
  const xPx = event.clientX - rect.left;
  const yPx = event.clientY - rect.top;
  const xPct = (xPx / rect.width) * 100;
  const yPct = (yPx / rect.height) * 100;

  if (isGroupMode() && selectedPoints.length >= groupCount) {
    setCollectStatus(`Group already has ${groupCount} saved members. Save the group or remove one to continue.`, "warn");
    return;
  }

  const clickTime = new Date();
  const selectedPoint = {
    xPct: round2(xPct),
    yPct: round2(yPct),
    xPx: Math.round(xPx),
    yPx: Math.round(yPx),
    timestampIso: clickTime.toISOString(),
  };
  activityTime.value = toDateTimeLocalValue(clickTime);

  if (isGroupMode()) {
    draftGroupPoint = selectedPoint;
    openGroupPointModal(selectedPoint);
    setCollectStatus(`Group capture active for ${getCurrentClusterIdLabel()}. Complete member ${selectedPoints.length + 1} in the popup.`, "active");
  } else {
    selectedPoints = [selectedPoint];
    setCollectStatus(`Individual point selected for ${getCurrentClusterIdLabel()}. Save record to finish.`, "active");
  }

  updateSelectedCoordsText();
  renderGroupPersonList();
  renderMarkers();
}

function onGroupPointModalClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.hasAttribute("data-group-point-close")) {
    onGroupPointCancel();
  }
}

function onDocumentKeyDown(event) {
  if (event.key === "Escape" && isObservationModalOpen()) {
    closeObservationModal();
    return;
  }

  if (event.key === "Escape" && isGroupPointModalOpen()) {
    onGroupPointCancel();
  }
}

function onGroupPointCancel() {
  const isEditing = groupPointModalState && Number.isInteger(groupPointModalState.index);
  closeGroupPointModal({ discardDraft: !isEditing });
  renderGroupPersonList();
}

function onGroupPointRemove() {
  if (!groupPointModalState || !Number.isInteger(groupPointModalState.index)) {
    closeGroupPointModal({ discardDraft: true });
    renderGroupPersonList();
    return;
  }

  removeGroupPoint(groupPointModalState.index);
}

function onGroupPointEdit(index) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedPoints.length) {
    return;
  }
  draftGroupPoint = null;
  openGroupPointModal(selectedPoints[index], index);
  setCollectStatus(`Editing group member ${index + 1} for ${getCurrentClusterIdLabel()}.`, "active");
  renderMarkers();
}

function removeGroupPoint(index) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedPoints.length) {
    return;
  }

  selectedPoints = selectedPoints.filter((_, itemIndex) => itemIndex !== index);
  closeGroupPointModal({ discardDraft: true, keepStatus: true });
  updateSelectedCoordsText();
  renderGroupPersonList();
  if (isCollecting && isGroupMode()) {
    setCollectStatus(getGroupCaptureProgressMessage(), "active");
  }
  renderMarkers();
}

function onGroupPointFormSubmit(event) {
  event.preventDefault();

  if (!groupPointModalState) {
    return;
  }

  if (!groupPointSelectedActivityTypes.length) {
    setGroupPointModalPrompt("Select at least one activity type.", "error");
    return;
  }
  if (!groupPointSelectedGender) {
    setGroupPointModalPrompt("Select gender.", "error");
    return;
  }
  if (!groupPointSelectedAgeGroup) {
    setGroupPointModalPrompt("Select an age group.", "error");
    return;
  }

  const isEditing = Number.isInteger(groupPointModalState.index);
  const index = isEditing ? groupPointModalState.index : -1;
  const sourcePoint = isEditing ? selectedPoints[index] : draftGroupPoint;
  if (!sourcePoint) {
    setGroupPointModalPrompt("Selected point is unavailable. Tap the map again.", "error");
    return;
  }

  const completedPoint = {
    ...sourcePoint,
    activityTypes: [...groupPointSelectedActivityTypes],
    gender: groupPointSelectedGender,
    ageGroup: groupPointSelectedAgeGroup,
  };

  if (isEditing) {
    selectedPoints = selectedPoints.map((point, pointIndex) => (pointIndex === index ? completedPoint : point));
  } else {
    selectedPoints = [...selectedPoints, completedPoint];
    draftGroupPoint = null;
  }

  closeGroupPointModal({ keepStatus: true });
  updateSelectedCoordsText();
  renderGroupPersonList();
  setCollectStatus(getGroupCaptureProgressMessage(), "active");
  renderMarkers();
}

function onObservationModalClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.hasAttribute("data-observation-close")) {
    closeObservationModal();
  }
}

function onObservationCameraClick() {
  if (!observationPhotoInput || isSavingObservation) {
    return;
  }

  if (isGroupPointModalOpen()) {
    setObservationStatus("Finish the open group member popup before saving a site observation.", "warn");
    return;
  }

  if (isObservationModalOpen()) {
    closeObservationModal({ preserveNote: true });
  }

  observationPhotoInput.click();
}

function onObservationNoteClick() {
  if (isSavingObservation) {
    return;
  }

  if (isGroupPointModalOpen()) {
    setObservationStatus("Finish the open group member popup before saving a site observation.", "warn");
    return;
  }

  if (isObservationModalOpen()) {
    observationNote?.focus();
    return;
  }

  openObservationModal();
}

function openObservationModal() {
  if (!observationModal) {
    return;
  }

  updateObservationContext();
  setObservationPrompt("", "muted");
  observationModal.hidden = false;
  observationModal.setAttribute("aria-hidden", "false");
  syncModalOpenState();
  observationNote?.focus();
}

function closeObservationModal({ preserveNote = false } = {}) {
  if (!observationModal) {
    return;
  }

  if (!preserveNote && observationNote) {
    observationNote.value = "";
  }
  setObservationPrompt("", "muted");
  observationModal.hidden = true;
  observationModal.setAttribute("aria-hidden", "true");
  syncModalOpenState();
}

async function onObservationFormSubmit(event) {
  event.preventDefault();

  if (isSavingObservation) {
    return;
  }

  const noteText = observationNote?.value.trim() || "";
  if (!noteText) {
    setObservationPrompt("Enter a note before saving.", "error");
    return;
  }

  const createdObservation = await saveSiteObservation({
    observationType: "note",
    noteText,
  });
  if (createdObservation) {
    closeObservationModal();
  }
}

async function onObservationPhotoChange(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file || isSavingObservation) {
    return;
  }

  await saveSiteObservation({
    observationType: "photo",
    file,
  });
}

async function saveSiteObservation({ observationType, noteText = "", file = null }) {
  setObservationActionState(true);
  if (observationType === "note") {
    setObservationPrompt("Saving site observation...", "muted");
    setObservationStatus("Saving site observation note...", "muted");
  } else {
    setObservationStatus("Preparing site observation photo...", "muted");
  }

  try {
    const photoData = file ? await buildPhotoCaptureState(file, setObservationStatus) : null;
    const response = await apiRequest(API_SITE_OBSERVATIONS, {
      method: "POST",
      body: buildRequestBodyWithOptionalPhoto(
        buildSiteObservationPayload({
          observationType,
          noteText,
          photoData,
        }),
        file
      ),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    if (!data?.observation) {
      throw new Error("Server did not return the created observation.");
    }

    const successMessage =
      observationType === "photo" ? "Site observation photo saved." : "Site observation note saved.";
    setObservationStatus(successMessage, "success");
    if (observationType === "note") {
      setObservationPrompt(successMessage, "success");
    }
    return data.observation;
  } catch (error) {
    const errorMessage = `Could not save site observation: ${error.message}`;
    setObservationStatus(errorMessage, "error");
    if (observationType === "note") {
      setObservationPrompt(errorMessage, "error");
    }
    alert(errorMessage);
    return null;
  } finally {
    setObservationActionState(false);
  }
}

function buildSiteObservationPayload({ observationType, noteText = "", photoData = null }) {
  return {
    buildingId: currentBuildingId || null,
    floorId: currentFloorId || null,
    observationType,
    observationTime: new Date().toISOString(),
    note: noteText || null,
    photoName: photoData?.photoName || null,
    photoLocation: photoData?.photoLocation ? { ...photoData.photoLocation } : null,
  };
}

function updateObservationContext() {
  if (!observationContext) {
    return;
  }

  if (currentBuildingId && currentFloorId) {
    observationContext.textContent = `${getBuildingLabel(currentBuildingId)} / ${getFloorLabel(currentBuildingId, currentFloorId)}.`;
    return;
  }

  if (currentBuildingId) {
    observationContext.textContent = `${getBuildingLabel(currentBuildingId)}. Observation will be saved without a floor.`;
    return;
  }

  observationContext.textContent = "No building or floor selected. Observation will be saved without map context.";
}

function setObservationActionState(busy) {
  isSavingObservation = !!busy;
  if (observationCameraBtn) {
    observationCameraBtn.disabled = !!busy;
  }
  if (observationNoteBtn) {
    observationNoteBtn.disabled = !!busy;
  }
  if (observationSaveBtn) {
    observationSaveBtn.disabled = !!busy;
  }
  if (observationCancelBtn) {
    observationCancelBtn.disabled = !!busy;
  }
  if (observationPhotoInput) {
    observationPhotoInput.disabled = !!busy;
  }
}

async function buildPhotoCaptureState(file, setStatus) {
  if (!(file instanceof File)) {
    throw new Error("No image selected.");
  }

  setStatus("Preparing image metadata...", "muted");

  let photoLocation = null;
  setStatus("Reading GPS metadata from image...", "muted");

  try {
    const extractedLocation = await extractPhotoLocationFromImage(file);
    photoLocation = extractedLocation;

    if (!extractedLocation) {
      setStatus("No EXIF GPS found. Requesting current device location...", "muted");
      try {
        const fallbackLocation = await requestCurrentDeviceLocation();
        photoLocation = fallbackLocation;
        const fallbackText = `${formatCoordinate(fallbackLocation.latitude)}, ${formatCoordinate(
          fallbackLocation.longitude
        )}`;
        setStatus(`EXIF missing. Using current device location: ${fallbackText}`, "success");
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError && typeof fallbackError.message === "string" && fallbackError.message
            ? fallbackError.message
            : "Could not get current device location.";
        setStatus(`Image selected, but GPS was unavailable: ${fallbackMessage}`, "warn");
      }

      return {
        photoName: file.name,
        photoLocation,
      };
    }

    const gpsText = `${formatCoordinate(extractedLocation.latitude)}, ${formatCoordinate(
      extractedLocation.longitude
    )}`;
    setStatus(`GPS found: ${gpsText}`, "success");
  } catch (error) {
    setStatus(`Could not read photo GPS: ${error.message}`, "error");
  }

  return {
    photoName: file.name,
    photoLocation,
  };
}

async function onPhotoChange(event) {
  const file = event.target.files?.[0];
  selectedPhotoFile = null;
  selectedPhotoLocation = null;
  selectedPhotoName = "";

  if (!file) {
    setPhotoLocationStatus("No image selected.", "muted");
    return;
  }

  selectedPhotoFile = file;
  isPhotoLocationLoading = true;

  try {
    const photoData = await buildPhotoCaptureState(file, setPhotoLocationStatus);
    selectedPhotoLocation = photoData.photoLocation;
    selectedPhotoName = photoData.photoName;
  } catch (error) {
    setPhotoLocationStatus(error?.message || "Could not prepare the selected image.", "error");
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
  setLocateStatus("Requesting device location and direction...", "muted");

  const directionAbortController = typeof AbortController === "function" ? new AbortController() : null;
  const directionPromise = requestCurrentDeviceDirection({
    signal: directionAbortController?.signal || null,
  }).catch((error) => {
    console.warn("Device direction unavailable:", error);
    return null;
  });

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

    const displayHeading = applyHeadingOffset(deviceDirection?.heading, payload?.headingOffsetDeg);

    userLocationPoint = {
      xPct: clampPercent(location.xPct),
      yPct: clampPercent(location.yPct),
      heading: displayHeading,
      rawHeading: Number.isFinite(deviceDirection?.heading) ? deviceDirection.heading : null,
      headingSource: typeof deviceDirection?.source === "string" ? deviceDirection.source : "",
      source: deviceLocation,
    };

    setLocateStatus(buildLocateStatusMessage(userLocationPoint), "success");
    renderMarkers();
  } catch (error) {
    console.error("Locate via GPS failed:", error);
    directionAbortController?.abort();
    userLocationPoint = null;
    setLocateStatus(error?.message || "Could not determine location.", "error");
    renderMarkers();
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
    setLocateStatus("Select a building and floor first.", "warn");
    return;
  }

  if (poiVisible) {
    poiVisible = false;
    poiRequestToken += 1;
    shouldAnimatePois = false;
    setPoiOverlayButtonState(false);
    renderMarkers();
    resetLocateStatusToBase();
    return;
  }

  poiVisible = true;
  setPoiOverlayButtonState(true);
  await refreshPoiOverlayForCurrentFloor({ animate: true, loadingMessage: "Loading POIs for this floor..." });
}

async function refreshPoiOverlayForCurrentFloor({ animate = false, loadingMessage = "" } = {}) {
  if (!poiVisible) {
    renderMarkers();
    return;
  }

  if (!currentBuildingId || !currentFloorId) {
    renderMarkers();
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
    setLocateStatus(loadingMessage, "muted");
  }

  try {
    await loadPoiMapsForBuilding(buildingId);
    if (!poiVisible || requestToken !== poiRequestToken || buildingId !== currentBuildingId || floorId !== currentFloorId) {
      return;
    }

    renderMarkers();
    const status = buildPoiOverlayStatus(buildingId, floorId);
    setLocateStatus(status.message, status.state);
  } catch (error) {
    if (requestToken !== poiRequestToken) {
      return;
    }

    renderMarkers();
    setLocateStatus(error?.message || "Could not load POIs.", "error");
  } finally {
    if (requestToken === poiRequestToken) {
      setPoiLoadingState(false);
    }
  }
}

async function onFormSubmit(event) {
  event.preventDefault();

  if (!isCollecting) {
    alert("Select Individual or Group before saving records.");
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

  if (!selectedPoints.length) {
    alert("Please click point(s) on the map before saving.");
    return;
  }

  const activeMode = recordMode.value;
  if (activeMode !== "group") {
    if (!selectedGender) {
      alert("Please select gender (male or female).");
      return;
    }

    if (!selectedActivityTypes.length) {
      alert("Please select at least one activity type.");
      return;
    }

    if (!ageGroup.value.trim()) {
      alert("Please select an age group.");
      return;
    }
  }

  const requiredPointCount = activeMode === "group" ? groupCount : 1;
  if (selectedPoints.length !== requiredPointCount) {
    alert(
      `Please complete ${requiredPointCount} point${requiredPointCount === 1 ? "" : "s"} before saving the ${
        activeMode === "group" ? "group" : "record"
      }.`
    );
    return;
  }
  if (activeMode === "group" && isGroupPointModalOpen()) {
    alert("Please save or cancel the open member popup before saving the group.");
    return;
  }
  if (activeMode === "group" && selectedPoints.some((point) => !isCompleteGroupPoint(point))) {
    alert("Each group member needs activity type, gender, and age group before you can save the group.");
    return;
  }

  const autoActorId = actorId.value.trim();
  if (activeMode === "individual" && !autoActorId) {
    alert("Auto ID is unavailable. Select Individual again.");
    return;
  }
  if (activeMode === "group" && !currentClusterNumber) {
    alert("Group capture is unavailable. Select Group again.");
    return;
  }

  const parsedActivityTime = new Date(activityTime.value);
  const fallbackActivityTime = Number.isNaN(parsedActivityTime.getTime())
    ? new Date().toISOString()
    : parsedActivityTime.toISOString();

  try {
    if (activeMode === "group") {
      const payloads = selectedPoints.map((point, index) =>
        buildRecordPayload(point, buildAutoActorId(currentClusterNumber, index + 1), fallbackActivityTime, {
          activityTypes: point.activityTypes,
          gender: point.gender,
          ageGroup: point.ageGroup,
        })
      );
      const response = await apiRequest(API_RECORDS, {
        method: "POST",
        body: buildRequestBodyWithOptionalPhoto({ records: payloads }, selectedPhotoFile),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = await response.json();
      const createdRecords = Array.isArray(data.records)
        ? data.records.map((record) => normalizeRecord(record)).filter((record) => record !== null)
        : [];
      if (!createdRecords.length) {
        throw new Error("Server did not return the created group records.");
      }

      records.push(...createdRecords);
      setSavePrompt(`Saved ${createdRecords.length} group records successfully.`, "success");
      finishCollection(`Group saved with ${createdRecords.length} records. Select Individual or Group for the next capture.`);
    } else {
      const response = await apiRequest(API_RECORDS, {
        method: "POST",
        body: buildRequestBodyWithOptionalPhoto(
          buildRecordPayload(selectedPoints[0], autoActorId, fallbackActivityTime),
          selectedPhotoFile
        ),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = await response.json();
      const createdRecord = normalizeRecord(data.record);
      if (!createdRecord) {
        throw new Error("Server did not return the created record.");
      }

      records.push(createdRecord);
      setSavePrompt(`Saved ${autoActorId} successfully.`, "success");
      finishCollection("Individual record saved. Select Individual or Group for the next capture.");
    }
    renderMarkers();
    renderRecords();
  } catch (error) {
    setSavePrompt(`Could not save record: ${error.message}`, "error");
    alert(`Could not save record: ${error.message}`);
  }
}

function buildRecordPayload(point, actorIdValue, fallbackActivityTime, overrides = {}) {
  const safeActivityTime = point?.timestampIso || fallbackActivityTime;
  const nextActivityTypes = normalizeActivityTypeSelection(overrides.activityTypes ?? selectedActivityTypes);
  const nextGender = overrides.gender ?? selectedGender;
  const nextAgeGroup = typeof overrides.ageGroup === "string" ? overrides.ageGroup.trim() : ageGroup.value.trim();
  return {
    buildingId: currentBuildingId,
    floorId: currentFloorId,
    activityType: nextActivityTypes.join(", "),
    actorId: actorIdValue,
    gender: nextGender,
    ageGroup: nextAgeGroup,
    activityTime: safeActivityTime,
    notes: notes.value.trim(),
    location: point ? { xPct: point.xPct, yPct: point.yPct } : null,
    photoName: selectedPhotoName || selectedPhotoFile?.name || null,
    photoLocation: selectedPhotoLocation ? { ...selectedPhotoLocation } : null,
  };
}

async function onExport() {
  try {
    const response = await fetch(API_RECORDS_EXPORT, { credentials: "same-origin" });
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

function buildRequestBodyWithOptionalPhoto(payload, photoFile) {
  if (!(photoFile instanceof File)) {
    return payload;
  }

  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  formData.append("photo", photoFile);
  return formData;
}

function resetForm(resetDateTime = true, advanceActorId = false) {
  const previousActorId = actorId.value;
  const previousRecordMode = recordMode.value;
  activityForm.reset();
  if (resetDateTime) {
    activityTime.value = toDateTimeLocalValue(new Date());
  }
  selectedPoints = [];
  draftGroupPoint = null;
  setSelectedActivityTypes([]);
  setSelectedGender("");
  setSelectedAgeGroup("");
  selectedPhotoFile = null;
  selectedPhotoLocation = null;
  selectedPhotoName = "";
  isPhotoLocationLoading = false;
  photoInput.value = "";
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
  closeGroupPointModal({ discardDraft: true, keepStatus: true });
  setRecordMode(previousRecordMode);
  updateSelectedCoordsText();
  renderMarkers();
}

function clearTemporarySelection() {
  selectedPoints = [];
  draftGroupPoint = null;
  closeGroupPointModal({ discardDraft: true, keepStatus: true });
  updateSelectedCoordsText();
  renderGroupPersonList();
  renderMarkers();
}

async function deleteRecord(id) {
  try {
    const response = await apiRequest(`${API_RECORDS}${id}/`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    records = records.filter((record) => record.id !== id);
    renderMarkers();
    renderRecords();
  } catch (error) {
    alert(`Could not delete record: ${error.message}`);
  }
}

function renderMarkers() {
  const overlayHost = mapCanvas || mapWrap;
  overlayHost.querySelectorAll(".marker, .cluster-link, .poi-marker").forEach((node) => node.remove());

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

  if (poiVisible) {
    renderPoiMarkers();
  }

  if (selectedPoints.length || draftGroupPoint) {
    drawSelectedPointClusterLink(visibleRecords);
  }
  if (selectedPoints.length) {
    selectedPoints.forEach((point) => {
      createMarker(point.xPct, point.yPct, true);
    });
  }
  if (draftGroupPoint) {
    createMarker(draftGroupPoint.xPct, draftGroupPoint.yPct, true);
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
  const previewPoints = draftGroupPoint ? [...selectedPoints, draftGroupPoint] : [...selectedPoints];
  if (!previewPoints.length || !isCollecting || !currentClusterNumber) {
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

  if (currentClusterRecords.length) {
    currentClusterRecords.sort((left, right) => {
      if (left.personNumber !== right.personNumber) {
        return left.personNumber - right.personNumber;
      }
      return String(left.activityTime).localeCompare(String(right.activityTime));
    });
  }

  let previousPoint = currentClusterRecords[currentClusterRecords.length - 1] || null;
  previewPoints.forEach((point) => {
    if (previousPoint) {
      createClusterLink(previousPoint, point, true);
    }
    previousPoint = point;
  });
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

  createUserLocationMarker(userLocationPoint.xPct, userLocationPoint.yPct, userLocationPoint.heading);
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

function createUserLocationMarker(xPct, yPct, heading) {
  const overlayHost = mapCanvas || mapWrap;
  if (!overlayHost || !Number.isFinite(xPct) || !Number.isFinite(yPct)) {
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

  overlayHost.appendChild(marker);
}

function createPoiMarker(point, index, animate) {
  const overlayHost = mapCanvas || mapWrap;
  if (!overlayHost || !point || !Number.isFinite(point.xPct) || !Number.isFinite(point.yPct)) {
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
  overlayHost.appendChild(marker);
}

function renderRecords() {
  if (!recordsTbody) {
    return;
  }

  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
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
    button.addEventListener("click", () => deleteRecord(button.dataset.deleteId));
  });
}

async function loadRecords() {
  try {
    const payload = await apiGet(API_RECORDS);
    const values = Array.isArray(payload.records) ? payload.records : [];
    return values
      .map((record) => normalizeRecord(record))
      .filter((record) => record !== null);
  } catch (error) {
    console.warn("Could not load records from API:", error);
    return [];
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;

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

function resetLocateStatusToBase() {
  if (userLocationPoint) {
    setLocateStatus(buildLocateStatusMessage(userLocationPoint), "success");
    return;
  }

  setLocateStatus(DEFAULT_LOCATE_STATUS_MESSAGE, "muted");
}

function setPoiOverlayButtonState(active) {
  if (!locateViaPoiBtn) {
    return;
  }

  locateViaPoiBtn.classList.toggle("is-active", !!active);
  locateViaPoiBtn.setAttribute("aria-pressed", String(!!active));
}

function setPoiLoadingState(loading) {
  isLocatingViaPoi = !!loading;
  if (locateViaPoiBtn) {
    locateViaPoiBtn.disabled = !!loading;
  }
}

function buildPoiOverlayStatus(buildingId, floorId) {
  const poiMaps = poiMapsCache.get(buildingId);
  const floorLabel = getFloorLabel(buildingId, floorId);

  if (poiMaps === null) {
    return {
      message: `No poi.json found for ${getBuildingLabel(buildingId)}.`,
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

function getPoiAssetUrl(buildingId) {
  if (buildingId === ROOT_BUILDING_ID) {
    return "/assets/poi.json";
  }

  return `/assets/${encodeURIComponent(buildingId)}/poi.json`;
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
    const response = await fetch(getPoiAssetUrl(buildingId), {
      headers: { Accept: "application/json" },
    });

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

function getPoiPointsForFloor(buildingId, floorId) {
  return getPoiPointsForFloorFromMaps(poiMapsCache.get(buildingId), floorId);
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

function setPhotoLocationStatus(message, state) {
  photoLocationStatus.textContent = message;
  photoLocationStatus.dataset.state = state;
}

function setObservationPrompt(message, state = "muted") {
  if (!observationPrompt) {
    return;
  }

  observationPrompt.textContent = message;
  observationPrompt.dataset.state = state;
}

function setObservationStatus(message, state = "muted") {
  if (!observationStatus) {
    return;
  }

  observationStatus.textContent = message;
  observationStatus.dataset.state = state;

  if (observationStatusTimerId) {
    window.clearTimeout(observationStatusTimerId);
    observationStatusTimerId = 0;
  }

  if (state === "success" && message) {
    observationStatusTimerId = window.setTimeout(() => {
      setObservationStatus(DEFAULT_OBSERVATION_STATUS_MESSAGE, "muted");
    }, 2600);
  }
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

async function apiGet(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return response.json();
}

async function apiRequest(url, { method = "GET", body = null } = {}) {
  const headers = {
    Accept: "application/json",
  };

  let payload = null;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== null) {
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
