import { extractPhotoLocationFromImage } from "./image-location.js";

const STORAGE_KEY = "indoor-activity-records-v1";
const ASSETS_ROOT = "assets/";
const BUILDINGS_MANIFEST_PATH = `${ASSETS_ROOT}buildings.manifest.json`;
const ROOT_BUILDING_ID = "__root__";
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

let records = loadRecords();
let selectedPoint = null;
let selectedPhotoLocation = null;
let selectedPhotoName = "";
let isPhotoLocationLoading = false;
let buildingMaps = {};
let currentBuildingId = "";
let currentFloorId = "";

initialize().catch((error) => {
  console.error("Initialization failed:", error);
  alert("Could not initialize building/floor maps. Check assets configuration.");
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
  currentBuildingId = buildingIds[0] || "";

  renderBuildingOptions(currentBuildingId);
  renderFloorOptions(currentBuildingId);
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

function onFormSubmit(event) {
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

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    buildingId: currentBuildingId,
    floorId: currentFloorId,
    activityType: activityType.value.trim(),
    actorId: actorId.value.trim(),
    activityTime: safeActivityTime,
    notes: notes.value.trim(),
    location: selectedPoint ? { ...selectedPoint } : null,
    photoName: selectedPhotoName || null,
    photoLocation: selectedPhotoLocation ? { ...selectedPhotoLocation } : null,
  };

  records.push(record);
  saveRecords(records);
  resetForm(false);
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

function deleteRecord(id) {
  records = records.filter((record) => record.id !== id);
  saveRecords(records);
  renderMarkers();
  renderRecords();
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
    location: hasMapLocation(record.location) ? { ...record.location } : null,
    photoLocation: isValidPhotoLocation(record.photoLocation) ? { ...record.photoLocation } : null,
    photoName: typeof record.photoName === "string" && record.photoName.trim() ? record.photoName : null,
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
