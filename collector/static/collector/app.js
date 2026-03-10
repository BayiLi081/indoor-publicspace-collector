import { extractPhotoLocationFromImage } from "./image-location.js";

const API_BUILDINGS = "/api/buildings/";
const API_RECORDS = "/api/records/";
const API_RECORDS_EXPORT = "/api/records/export/";

const ROOT_BUILDING_ID = "__root__";

const LEGACY_BUILDING_MAPS = {
  [ROOT_BUILDING_ID]: {
    label: "Main Building",
    floors: {
      "floor-1": { label: "Floor 1", mapSrc: "/assets/floor-1.svg" },
      "floor-2": { label: "Floor 2", mapSrc: "/assets/floor-2.svg" },
      "floor-3": { label: "Floor 3", mapSrc: "/assets/floor-3.svg" },
    },
  },
};

const mapWrap = document.getElementById("mapWrap");
const mapImage = document.getElementById("mapImage");
const buildingSelect = document.getElementById("buildingSelect");
const floorSelect = document.getElementById("floorSelect");
const activityForm = document.getElementById("activityForm");
const activityType = document.getElementById("activityType");
const actorId = document.getElementById("actorId");
const activityTime = document.getElementById("activityTime");
const photoInput = document.getElementById("photoInput");
const photoLocationStatus = document.getElementById("photoLocationStatus");
const notes = document.getElementById("notes");
const selectedCoords = document.getElementById("selectedCoords");
const recordsTbody = document.getElementById("recordsTbody");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const resetFormBtn = document.getElementById("resetFormBtn");
const clearMarkersBtn = document.getElementById("clearMarkersBtn");

let records = [];
let selectedPoint = null;
let selectedPhotoLocation = null;
let selectedPhotoName = "";
let isPhotoLocationLoading = false;
let buildingMaps = {};
let currentBuildingId = "";
let currentFloorId = "";

initialize().catch((error) => {
  console.error("Initialization failed:", error);
  alert("Could not initialize the application. Check Django API and assets configuration.");
});

async function initialize() {
  activityTime.value = toDateTimeLocalValue(new Date());
  setPhotoLocationStatus("No image selected.", "muted");

  buildingSelect.innerHTML = "<option>Loading...</option>";
  floorSelect.innerHTML = "<option>Loading...</option>";

  buildingSelect.addEventListener("change", onBuildingChange);
  floorSelect.addEventListener("change", onFloorChange);
  mapWrap.addEventListener("click", onMapClick);
  photoInput.addEventListener("change", onPhotoChange);
  activityForm.addEventListener("submit", onFormSubmit);
  searchInput.addEventListener("input", renderRecords);
  exportBtn.addEventListener("click", onExport);
  resetFormBtn.addEventListener("click", resetForm);
  clearMarkersBtn.addEventListener("click", clearTemporarySelection);

  await loadBuildingMaps();
  records = await loadRecords();
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
  currentBuildingId = buildingIds[0] || "";

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId);
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

  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  updateMapForSelection();
  clearTemporarySelection();
  renderRecords();
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

function onMapClick(event) {
  if (event.target !== mapImage) return;

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

  selectedCoords.textContent = `${selectedPoint.xPct}%, ${selectedPoint.yPct}%`;
  renderMarkers();
}

async function onPhotoChange(event) {
  const file = event.target.files?.[0];
  selectedPhotoLocation = null;
  selectedPhotoName = "";

  if (!file) {
    setPhotoLocationStatus("No image selected.", "muted");
    return;
  }

  selectedPhotoName = file.name;
  isPhotoLocationLoading = true;
  setPhotoLocationStatus("Reading GPS metadata from image...", "muted");

  try {
    const extractedLocation = await extractPhotoLocationFromImage(file);
    selectedPhotoLocation = extractedLocation;

    if (!extractedLocation) {
      setPhotoLocationStatus("Image selected, but no GPS metadata was found.", "warn");
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

async function onFormSubmit(event) {
  event.preventDefault();

  if (!currentBuildingId || !currentFloorId) {
    alert("No building/floor map is available. Check your assets folder.");
    return;
  }

  if (isPhotoLocationLoading) {
    alert("Please wait for image GPS extraction to finish.");
    return;
  }

  if (!selectedPoint && !selectedPhotoLocation) {
    alert("Please click a location on the map or attach a GPS-tagged image first.");
    return;
  }

  const parsedActivityTime = new Date(activityTime.value);
  const safeActivityTime = Number.isNaN(parsedActivityTime.getTime())
    ? new Date().toISOString()
    : parsedActivityTime.toISOString();

  const payload = {
    buildingId: currentBuildingId,
    floorId: currentFloorId,
    activityType: activityType.value.trim(),
    actorId: actorId.value.trim(),
    activityTime: safeActivityTime,
    notes: notes.value.trim(),
    location: selectedPoint ? { xPct: selectedPoint.xPct, yPct: selectedPoint.yPct } : null,
    photoName: selectedPhotoName || null,
    photoLocation: selectedPhotoLocation ? { ...selectedPhotoLocation } : null,
  };

  try {
    const response = await apiRequest(API_RECORDS, {
      method: "POST",
      body: payload,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    const createdRecord = normalizeRecord(data.record);
    if (createdRecord) {
      records.push(createdRecord);
    }

    resetForm(false);
    renderMarkers();
    renderRecords();
  } catch (error) {
    alert(`Could not save record: ${error.message}`);
  }
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

function resetForm(resetDateTime = true) {
  activityForm.reset();
  if (resetDateTime) {
    activityTime.value = toDateTimeLocalValue(new Date());
  }
  selectedPoint = null;
  selectedPhotoLocation = null;
  selectedPhotoName = "";
  isPhotoLocationLoading = false;
  photoInput.value = "";
  selectedCoords.textContent = "None";
  setPhotoLocationStatus("No image selected.", "muted");
  renderMarkers();
}

function clearTemporarySelection() {
  selectedPoint = null;
  selectedCoords.textContent = "None";
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
  mapWrap.querySelectorAll(".marker").forEach((node) => node.remove());

  records.forEach((record) => {
    const recordBuildingId = getRecordBuildingId(record);
    if (recordBuildingId !== currentBuildingId) {
      return;
    }

    const recordFloorId = getRecordFloorId(record, recordBuildingId);
    if (recordFloorId !== currentFloorId) {
      return;
    }

    if (hasMapLocation(record.location)) {
      createMarker(record.location.xPct, record.location.yPct, false);
    }
  });

  if (selectedPoint) {
    createMarker(selectedPoint.xPct, selectedPoint.yPct, true);
  }
}

function createMarker(xPct, yPct, selected) {
  const marker = document.createElement("span");
  marker.className = selected ? "marker selected" : "marker";
  marker.style.left = `${xPct}%`;
  marker.style.top = `${yPct}%`;
  mapWrap.appendChild(marker);
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
    tr.innerHTML = `<td colspan="9">No records yet for this building and floor.</td>`;
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
      <td>${escapeHtml(getBuildingLabel(recordBuildingId))}</td>
      <td>${escapeHtml(getFloorLabel(recordBuildingId, recordFloorId))}</td>
      <td>${escapeHtml(formatMapLocation(record.location))}</td>
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
    location: hasMapLocation(record.location) ? { ...record.location } : null,
    photoLocation: isValidPhotoLocation(record.photoLocation) ? { ...record.photoLocation } : null,
    photoName: typeof record.photoName === "string" && record.photoName.trim() ? record.photoName : null,
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
