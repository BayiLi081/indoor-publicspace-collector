import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List

from django.conf import settings

GPS_MAP_FILENAME = "gps-map.json"
ROOT_BUILDING_ID = "__root__"


class GPSMappingError(Exception):
  """Indicates the GPS-to-image mapping cannot be computed."""


@dataclass(frozen=True)
class _GpsAnchor:
  x_pct: Decimal
  y_pct: Decimal
  latitude: Decimal
  longitude: Decimal


_CALIBRATION_CACHE: Dict[str, Dict[str, Any]] = {}


def locate_map_point_from_gps(building_id: str, floor_id: str, latitude: Any, longitude: Any) -> Dict[str, Decimal]:
  """Return the map percentages for a GPS coordinate in the given building/floor."""

  normalized_building_id = _normalize_identifier(building_id)
  normalized_floor_id = _normalize_identifier(floor_id)

  anchors = _load_floor_anchors(normalized_building_id, normalized_floor_id)
  lat_value = _to_decimal(latitude, "latitude")
  lon_value = _to_decimal(longitude, "longitude")

  lon_scale = _derive_scale(anchors, "longitude", "x_pct")
  if lon_scale is None:
    raise GPSMappingError("GPS calibration needs at least two anchors with distinct longitudes.")

  lat_scale = _derive_scale(anchors, "latitude", "y_pct")
  if lat_scale is None:
    raise GPSMappingError("GPS calibration needs at least two anchors with distinct latitudes.")

  reference = anchors[0]
  x_pct = reference.x_pct + (lon_value - reference.longitude) * lon_scale
  y_pct = reference.y_pct + (lat_value - reference.latitude) * lat_scale

  x_pct = _clamp_percent(x_pct)
  y_pct = _clamp_percent(y_pct)

  return {"xPct": x_pct, "yPct": y_pct}


def get_floor_heading_offset(building_id: str, floor_id: str) -> Decimal:
  """Return the optional heading offset to align device direction with the current map."""

  normalized_building_id = _normalize_identifier(building_id)
  normalized_floor_id = _normalize_identifier(floor_id)
  floor_payload = _load_floor_payload(normalized_building_id, normalized_floor_id)

  return _parse_optional_decimal_field(
    floor_payload,
    ("headingOffsetDeg", "mapHeadingOffsetDeg", "directionOffsetDeg"),
    Decimal("0"),
  )


def _normalize_identifier(value: Any) -> str:
  if not isinstance(value, str):
    raise GPSMappingError("Building and floor identifiers are required.")

  candidate = value.strip()
  if not candidate:
    raise GPSMappingError("Building and floor identifiers are required.")

  if "/" in candidate or "\\" in candidate:
    raise GPSMappingError("Building/floor identifier contains invalid characters.")

  return candidate


def _load_floor_anchors(building_id: str, floor_id: str) -> List[_GpsAnchor]:
  floor_payload = _load_floor_payload(building_id, floor_id)

  raw_points = None
  for key in ("referencePoints", "anchors", "points"):
    candidate = floor_payload.get(key)
    if isinstance(candidate, list) and candidate:
      raw_points = candidate
      break

  if not raw_points:
    raise GPSMappingError("No GPS anchors defined for this floor.")

  anchors: List[_GpsAnchor] = []
  for entry in raw_points:
    if not isinstance(entry, dict):
      continue
    anchors.append(_parse_anchor(entry))

  if len(anchors) < 2:
    raise GPSMappingError("GPS calibration requires at least two anchor points.")

  return anchors


def _load_floor_payload(building_id: str, floor_id: str) -> Dict[str, Any]:
  building_data = _load_building_calibration(building_id)
  floor_payload = _get_floor_payload(building_data, floor_id)

  # If the requested floor is missing, refresh cache once in case the file was updated at runtime.
  if floor_payload is None:
    _CALIBRATION_CACHE.pop(building_id, None)
    building_data = _load_building_calibration(building_id)
    floor_payload = _get_floor_payload(building_data, floor_id)

  if not isinstance(floor_payload, dict):
    raise GPSMappingError("GPS calibration is unavailable for this floor.")

  return floor_payload


def _get_floor_payload(building_data: Dict[str, Any], floor_id: str) -> Any:
  if floor_id in building_data:
    return building_data[floor_id]

  lowered = floor_id.lower()
  for key, value in building_data.items():
    if isinstance(key, str) and key.lower() == lowered:
      return value

  return None


def _parse_anchor(data: dict[str, Any]) -> _GpsAnchor:
  x_pct = _parse_decimal_field(data, ("xPct", "x", "xPercent"), "xPct")
  y_pct = _parse_decimal_field(data, ("yPct", "y", "yPercent"), "yPct")
  latitude = _parse_decimal_field(data, ("latitude", "lat"), "latitude")
  longitude = _parse_decimal_field(data, ("longitude", "lon", "lng"), "longitude")

  return _GpsAnchor(x_pct=x_pct, y_pct=y_pct, latitude=latitude, longitude=longitude)


def _parse_decimal_field(source: dict[str, Any], keys: tuple[str, ...], label: str) -> Decimal:
  for key in keys:
    if key not in source:
      continue
    value = source[key]
    if value is None:
      continue
    try:
      return Decimal(str(value))
    except (InvalidOperation, ValueError):
      break

  raise GPSMappingError(f"GPS map anchor is missing a valid {label} value.")


def _parse_optional_decimal_field(source: dict[str, Any], keys: tuple[str, ...], default: Decimal) -> Decimal:
  for key in keys:
    if key not in source:
      continue

    value = source[key]
    if value is None:
      continue

    try:
      return Decimal(str(value))
    except (InvalidOperation, ValueError):
      continue

  return default


def _to_decimal(value: Any, label: str) -> Decimal:
  try:
    return Decimal(str(value))
  except (InvalidOperation, ValueError, TypeError):
    raise GPSMappingError(f"Invalid {label} value.")


def _derive_scale(anchors: List[_GpsAnchor], source_attr: str, target_attr: str) -> Decimal | None:
  total = Decimal("0")
  count = 0
  for index, left in enumerate(anchors[:-1]):
    for right in anchors[index + 1 :]:
      source_delta = getattr(right, source_attr) - getattr(left, source_attr)
      if source_delta == 0:
        continue
      target_delta = getattr(right, target_attr) - getattr(left, target_attr)
      total += target_delta / source_delta
      count += 1

  if count == 0:
    return None

  return total / Decimal(count)


def _clamp_percent(value: Decimal) -> Decimal:
  if value < Decimal("0"):
    return Decimal("0")
  if value > Decimal("100"):
    return Decimal("100")
  return value


def _load_building_calibration(building_id: str) -> Dict[str, Any]:
  if building_id in _CALIBRATION_CACHE:
    return _CALIBRATION_CACHE[building_id]

  map_path = _resolve_gps_map_path(building_id)
  if not map_path or not map_path.exists():
    calibration: Dict[str, Any] = {}
    _CALIBRATION_CACHE[building_id] = calibration
    return calibration

  try:
    payload = json.loads(map_path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError) as error:
    raise GPSMappingError(f"Could not read GPS map for {building_id}: {error}")

  if not isinstance(payload, dict):
    calibration = {}
    _CALIBRATION_CACHE[building_id] = calibration
    return calibration

  calibration = {str(key): value for key, value in payload.items() if isinstance(key, str)}
  _CALIBRATION_CACHE[building_id] = calibration
  return calibration


def _resolve_gps_map_path(building_id: str) -> Path | None:
  assets_dir = Path(settings.ASSETS_DIR)
  if not assets_dir.exists():
    return None

  if building_id == ROOT_BUILDING_ID:
    return assets_dir / GPS_MAP_FILENAME

  building_folder = assets_dir / building_id
  return building_folder / GPS_MAP_FILENAME
