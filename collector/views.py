import json
import re
from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import DatabaseError
from django.db.models import Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .models import ActivityRecord

ROOT_BUILDING_ID = "__root__"
MAP_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}


def index(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/index.html")


@require_http_methods(["GET"])
def api_buildings(request: HttpRequest) -> JsonResponse:
  building_maps = discover_building_maps()
  return JsonResponse({"buildings": building_maps})


@require_http_methods(["GET", "POST"])
def api_records(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    try:
      query = ActivityRecord.objects.all()

      building_id = request.GET.get("building_id", "").strip()
      floor_id = request.GET.get("floor_id", "").strip()
      search_text = request.GET.get("q", "").strip()

      if building_id:
        query = query.filter(building_id=building_id)
      if floor_id:
        query = query.filter(floor_id=floor_id)
      if search_text:
        query = query.filter(
          Q(activity_type__icontains=search_text)
          | Q(actor_id__icontains=search_text)
          | Q(notes__icontains=search_text)
          | Q(photo_name__icontains=search_text)
          | Q(building_id__icontains=search_text)
          | Q(floor_id__icontains=search_text)
        )

      records = [serialize_record(record) for record in query]
      return JsonResponse({"records": records})
    except DatabaseError as exc:
      return database_error_response(exc)

  payload, error_response = parse_json_request(request)
  if error_response:
    return error_response

  try:
    record = build_record_from_payload(payload)
    record.full_clean()
    record.save()
  except DatabaseError as exc:
    return database_error_response(exc)
  except ValidationError as exc:
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  return JsonResponse({"record": serialize_record(record)}, status=201)


@require_http_methods(["DELETE"])
def api_record_detail(request: HttpRequest, record_id) -> JsonResponse:
  try:
    deleted_count, _ = ActivityRecord.objects.filter(id=record_id).delete()
  except DatabaseError as exc:
    return database_error_response(exc)

  if deleted_count == 0:
    return JsonResponse({"error": "Record not found."}, status=404)
  return JsonResponse({"deleted": True})


@require_http_methods(["GET"])
def api_records_export(request: HttpRequest) -> HttpResponse:
  try:
    records = [serialize_record(record) for record in ActivityRecord.objects.all()]
  except DatabaseError as exc:
    return database_error_response(exc)

  payload = json.dumps(records, indent=2)

  filename = f"indoor-activity-records-{datetime.utcnow().strftime('%Y-%m-%d')}.json"
  response = HttpResponse(payload, content_type="application/json")
  response["Content-Disposition"] = f'attachment; filename="{filename}"'
  return response


def parse_json_request(request: HttpRequest) -> tuple[dict[str, Any], JsonResponse | None]:
  try:
    payload = json.loads(request.body.decode("utf-8"))
  except (UnicodeDecodeError, json.JSONDecodeError):
    return {}, JsonResponse({"error": "Invalid JSON payload."}, status=400)

  if not isinstance(payload, dict):
    return {}, JsonResponse({"error": "JSON payload must be an object."}, status=400)

  return payload, None


def database_error_response(error: Exception) -> JsonResponse:
  message = str(error).lower()
  if "no such table" in message or "does not exist" in message:
    return JsonResponse(
      {
        "error": (
          "Database schema is not initialized. "
          "Run `python3 manage.py migrate` and restart the server."
        )
      },
      status=503,
    )

  return JsonResponse({"error": "Database error while processing request."}, status=500)


def build_record_from_payload(payload: dict[str, Any]) -> ActivityRecord:
  building_id = require_non_empty_string(payload, "buildingId")
  floor_id = require_non_empty_string(payload, "floorId")
  activity_type = require_non_empty_string(payload, "activityType")
  actor_id = optional_string(payload.get("actorId"))
  notes = optional_string(payload.get("notes"))
  activity_time = parse_required_datetime(payload.get("activityTime"), "activityTime")

  location = payload.get("location")
  location_x_pct, location_y_pct = parse_location(location)

  photo_name = optional_string(payload.get("photoName"))
  photo_location = payload.get("photoLocation")
  photo_latitude, photo_longitude, photo_altitude = parse_photo_location(photo_location)

  if location_x_pct is None and photo_latitude is None:
    raise ValidationError({"location": ["Provide map coordinates or photo GPS coordinates."]})

  return ActivityRecord(
    building_id=building_id,
    floor_id=floor_id,
    activity_type=activity_type,
    actor_id=actor_id,
    activity_time=activity_time,
    notes=notes,
    location_x_pct=location_x_pct,
    location_y_pct=location_y_pct,
    photo_name=photo_name,
    photo_latitude=photo_latitude,
    photo_longitude=photo_longitude,
    photo_altitude=photo_altitude,
  )


def require_non_empty_string(payload: dict[str, Any], key: str) -> str:
  value = payload.get(key)
  if isinstance(value, str) and value.strip():
    return value.strip()
  raise ValidationError({key: ["This field is required."]})


def optional_string(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def parse_required_datetime(value: Any, key: str):
  if not isinstance(value, str) or not value.strip():
    raise ValidationError({key: ["A valid datetime string is required."]})

  parsed = parse_datetime(value.strip())
  if parsed is None:
    raise ValidationError({key: ["Invalid datetime format."]})

  if timezone.is_naive(parsed):
    parsed = timezone.make_aware(parsed, timezone.get_current_timezone())

  return parsed


def parse_location(value: Any) -> tuple[Decimal | None, Decimal | None]:
  if value is None:
    return None, None

  if not isinstance(value, dict):
    raise ValidationError({"location": ["Location must be an object."]})

  x_value = value.get("xPct")
  y_value = value.get("yPct")

  if x_value is None and y_value is None:
    return None, None

  if x_value is None or y_value is None:
    raise ValidationError({"location": ["Both xPct and yPct are required when location is set."]})

  return parse_decimal(x_value, "location.xPct"), parse_decimal(y_value, "location.yPct")


def parse_photo_location(value: Any) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
  if value is None:
    return None, None, None

  if not isinstance(value, dict):
    raise ValidationError({"photoLocation": ["photoLocation must be an object."]})

  latitude = value.get("latitude")
  longitude = value.get("longitude")
  altitude = value.get("altitude")

  if latitude is None and longitude is None:
    return None, None, None

  if latitude is None or longitude is None:
    raise ValidationError(
      {"photoLocation": ["Both latitude and longitude are required when photoLocation is set."]}
    )

  parsed_altitude = None if altitude is None else parse_decimal(altitude, "photoLocation.altitude")
  return (
    parse_decimal(latitude, "photoLocation.latitude"),
    parse_decimal(longitude, "photoLocation.longitude"),
    parsed_altitude,
  )


def parse_decimal(value: Any, key: str) -> Decimal:
  try:
    return Decimal(str(value))
  except (InvalidOperation, ValueError, TypeError):
    raise ValidationError({key: ["Must be a numeric value."]})


def normalize_validation_error(error: ValidationError) -> dict[str, Any]:
  if hasattr(error, "message_dict"):
    return {"fields": error.message_dict}
  return {"message": error.messages}


def serialize_record(record: ActivityRecord) -> dict[str, Any]:
  location = None
  if record.location_x_pct is not None and record.location_y_pct is not None:
    location = {
      "xPct": float(record.location_x_pct),
      "yPct": float(record.location_y_pct),
    }

  photo_location = None
  if record.photo_latitude is not None and record.photo_longitude is not None:
    photo_location = {
      "latitude": float(record.photo_latitude),
      "longitude": float(record.photo_longitude),
    }
    if record.photo_altitude is not None:
      photo_location["altitude"] = float(record.photo_altitude)

  return {
    "id": str(record.id),
    "createdAt": isoformat_utc(record.created_at),
    "buildingId": record.building_id,
    "floorId": record.floor_id,
    "activityType": record.activity_type,
    "actorId": record.actor_id,
    "activityTime": isoformat_utc(record.activity_time),
    "notes": record.notes,
    "location": location,
    "photoName": record.photo_name or None,
    "photoLocation": photo_location,
  }


def isoformat_utc(value):
  if value is None:
    return None

  if timezone.is_naive(value):
    value = timezone.make_aware(value, datetime_timezone.utc)

  return value.astimezone(datetime_timezone.utc).isoformat().replace("+00:00", "Z")


def discover_building_maps() -> dict[str, Any]:
  manifest_maps = discover_buildings_from_manifest()
  if has_any_building_floors(manifest_maps):
    return normalize_building_maps(manifest_maps)

  listed_maps = discover_buildings_from_assets_folder()
  if has_any_building_floors(listed_maps):
    return normalize_building_maps(listed_maps)

  return normalize_building_maps(legacy_building_maps())


def discover_buildings_from_manifest() -> dict[str, Any] | None:
  manifest_path = settings.ASSETS_DIR / "buildings.manifest.json"
  if not manifest_path.exists():
    return None

  try:
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
  except (OSError, json.JSONDecodeError):
    return None

  if not isinstance(payload, dict):
    return None

  buildings = payload.get("buildings")
  if isinstance(buildings, dict):
    return buildings

  return payload


def discover_buildings_from_assets_folder() -> dict[str, Any]:
  assets_dir = Path(settings.ASSETS_DIR)
  if not assets_dir.exists() or not assets_dir.is_dir():
    return {}

  buildings: dict[str, Any] = {}

  directories = sorted(
    [entry for entry in assets_dir.iterdir() if entry.is_dir() and not entry.name.startswith(".")],
    key=lambda entry: natural_sort_key(entry.name),
  )

  for directory in directories:
    floors = extract_floor_maps(directory)
    if floors:
      buildings[directory.name] = {
        "label": format_building_label(directory.name),
        "floors": floors,
      }

  root_floors = extract_floor_maps(assets_dir)
  if root_floors:
    buildings[ROOT_BUILDING_ID] = {
      "label": "Shared Maps" if directories else "Main Building",
      "floors": root_floors,
    }

  return buildings


def extract_floor_maps(folder: Path) -> dict[str, Any]:
  floors: dict[str, Any] = {}

  file_entries = sorted(
    [entry for entry in folder.iterdir() if entry.is_file() and entry.suffix.lower() in MAP_EXTENSIONS],
    key=lambda entry: natural_sort_key(entry.name),
  )

  for file_entry in file_entries:
    floor_id = file_entry.stem
    if floor_id in floors:
      continue

    relative_path = file_entry.relative_to(settings.ASSETS_DIR).as_posix()
    floors[floor_id] = {
      "label": format_floor_label(floor_id),
      "mapSrc": f"/assets/{relative_path}",
    }

  return floors


def legacy_building_maps() -> dict[str, Any]:
  fallback_floors = {}
  for filename in ["floor-1.svg", "floor-2.svg", "floor-3.svg"]:
    path = settings.ASSETS_DIR / filename
    if not path.exists():
      continue

    floor_id = path.stem
    fallback_floors[floor_id] = {
      "label": format_floor_label(floor_id),
      "mapSrc": f"/assets/{filename}",
    }

  if not fallback_floors:
    return {}

  return {
    ROOT_BUILDING_ID: {
      "label": "Main Building",
      "floors": fallback_floors,
    }
  }


def normalize_building_maps(raw_maps: Any) -> dict[str, Any]:
  if not isinstance(raw_maps, dict):
    return {}

  normalized: dict[str, Any] = {}
  for building_id in sorted(raw_maps.keys(), key=natural_sort_key):
    building = raw_maps.get(building_id)
    if not isinstance(building, dict):
      continue

    floors_source = building.get("floors")
    if not isinstance(floors_source, dict):
      continue

    floors = {}
    for floor_id in sorted(floors_source.keys(), key=natural_sort_key):
      floor = floors_source.get(floor_id)
      if not isinstance(floor, dict):
        continue

      map_src = floor.get("mapSrc")
      if not isinstance(map_src, str) or not map_src.strip():
        continue

      normalized_floor_id = str(floor_id)
      floors[normalized_floor_id] = {
        "label": optional_label(floor.get("label"), format_floor_label(normalized_floor_id)),
        "mapSrc": normalize_map_src(map_src),
      }

    if not floors:
      continue

    normalized_building_id = str(building_id)
    normalized[normalized_building_id] = {
      "label": optional_label(building.get("label"), format_building_label(normalized_building_id)),
      "floors": floors,
    }

  return normalized


def optional_label(value: Any, default: str) -> str:
  if isinstance(value, str) and value.strip():
    return value.strip()
  return default


def normalize_map_src(value: str) -> str:
  src = value.strip()
  if src.startswith("http://") or src.startswith("https://") or src.startswith("/"):
    return src

  src = src.lstrip("./")
  if src.startswith("assets/"):
    return f"/{src}"

  return f"/assets/{src}"


def has_any_building_floors(candidate_maps: Any) -> bool:
  if not isinstance(candidate_maps, dict):
    return False

  for building in candidate_maps.values():
    if not isinstance(building, dict):
      continue

    floors = building.get("floors")
    if isinstance(floors, dict) and len(floors) > 0:
      return True

  return False


def format_building_label(value: str) -> str:
  return to_display_label(value)


def format_floor_label(value: str) -> str:
  label = to_display_label(value)
  floor_match = re.match(r"^Floor\s*(\d+)$", label, re.IGNORECASE)
  if floor_match:
    return f"Floor {floor_match.group(1)}"
  return label


def to_display_label(value: Any) -> str:
  cleaned = re.sub(r"\s+", " ", re.sub(r"[-_]+", " ", str(value or "")).strip())
  if not cleaned:
    return "Unnamed"
  return " ".join(part.capitalize() for part in cleaned.split(" "))


def natural_sort_key(value: str):
  return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]
