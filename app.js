const STORAGE_KEY = "indoor-activity-records-v1";
const FLOOR_MAPS = {
  "floor-1": { label: "Floor 1", mapSrc: "assets/floor-1.svg" },
  "floor-2": { label: "Floor 2", mapSrc: "assets/floor-2.svg" },
  "floor-3": { label: "Floor 3", mapSrc: "assets/floor-3.svg" },
};
const DEFAULT_FLOOR_ID = "floor-1";

const mapWrap = document.getElementById("mapWrap");
const mapImage = document.getElementById("mapImage");
const floorSelect = document.getElementById("floorSelect");
const activityForm = document.getElementById("activityForm");
const activityType = document.getElementById("activityType");
const actorId = document.getElementById("actorId");
const activityTime = document.getElementById("activityTime");
const notes = document.getElementById("notes");
const selectedCoords = document.getElementById("selectedCoords");
const recordsTbody = document.getElementById("recordsTbody");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const resetFormBtn = document.getElementById("resetFormBtn");
const clearMarkersBtn = document.getElementById("clearMarkersBtn");

let records = loadRecords();
let selectedPoint = null;
let currentFloorId = DEFAULT_FLOOR_ID;

initialize();

function initialize() {
  activityTime.value = toDateTimeLocalValue(new Date());
  floorSelect.value = DEFAULT_FLOOR_ID;
  floorSelect.addEventListener("change", onFloorChange);
  mapWrap.addEventListener("click", onMapClick);
  activityForm.addEventListener("submit", onFormSubmit);
  searchInput.addEventListener("input", renderRecords);
  exportBtn.addEventListener("click", onExport);
  resetFormBtn.addEventListener("click", resetForm);
  clearMarkersBtn.addEventListener("click", clearTemporarySelection);

  updateMapForFloor(currentFloorId);
  renderMarkers();
  renderRecords();
}

function onFloorChange(event) {
  currentFloorId = event.target.value;
  updateMapForFloor(currentFloorId);
  clearTemporarySelection();
  renderRecords();
}

function updateMapForFloor(floorId) {
  const floor = FLOOR_MAPS[floorId] || FLOOR_MAPS[DEFAULT_FLOOR_ID];
  mapImage.src = floor.mapSrc;
  mapImage.alt = `Indoor map ${floor.label}`;
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

function onFormSubmit(event) {
  event.preventDefault();

  if (!selectedPoint) {
    alert("Please click a location on the map first.");
    return;
  }

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    floorId: currentFloorId,
    activityType: activityType.value.trim(),
    actorId: actorId.value.trim(),
    activityTime: new Date(activityTime.value).toISOString(),
    notes: notes.value.trim(),
    location: { ...selectedPoint },
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
  selectedCoords.textContent = "None";
  renderMarkers();
}

function clearTemporarySelection() {
  selectedPoint = null;
  selectedCoords.textContent = "None";
  renderMarkers();
}

function deleteRecord(id) {
  records = records.filter((r) => r.id !== id);
  saveRecords(records);
  renderMarkers();
  renderRecords();
}

function renderMarkers() {
  mapWrap.querySelectorAll(".marker").forEach((node) => node.remove());

  records
    .filter((record) => getRecordFloorId(record) === currentFloorId)
    .forEach((record) => {
    createMarker(record.location.xPct, record.location.yPct, false);
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
    .sort((a, b) => b.activityTime.localeCompare(a.activityTime))
    .filter((record) => {
      if (getRecordFloorId(record) !== currentFloorId) return false;
      if (!query) return true;
      const target = [
        record.activityType,
        record.actorId,
        record.notes,
        getFloorLabel(getRecordFloorId(record)),
        formatDate(record.activityTime),
      ].join(" ").toLowerCase();
      return target.includes(query);
    });

  recordsTbody.innerHTML = "";

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7">No records yet for this floor.</td>`;
    recordsTbody.appendChild(tr);
    return;
  }

  filtered.forEach((record) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(record.activityTime)}</td>
      <td>${escapeHtml(record.activityType)}</td>
      <td>${escapeHtml(record.actorId || "-")}</td>
      <td>${escapeHtml(getFloorLabel(getRecordFloorId(record)))}</td>
      <td>${record.location.xPct}%, ${record.location.yPct}%</td>
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(nextRecords) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
}

function getRecordFloorId(record) {
  return FLOOR_MAPS[record.floorId] ? record.floorId : DEFAULT_FLOOR_ID;
}

function getFloorLabel(floorId) {
  return FLOOR_MAPS[floorId]?.label || FLOOR_MAPS[DEFAULT_FLOOR_ID].label;
}

function toDateTimeLocalValue(date) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
