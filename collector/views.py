import json
import re
from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .activity_catalog import (
  ACTIVITY_TYPE_ALIASES,
  ACTIVITY_TYPE_OPTIONS,
  GROUP_ACTIVITY_TYPOLOGY_OPTIONS,
  INDIVIDUAL_ACTIVITY_TYPE_OPTIONS,
  build_activity_catalog_payload,
)
from .building_catalog import discover_building_maps as discover_building_maps_catalog
from .floorplan_svg import convert_jpg_floorplan_to_svg, should_regenerate_jpg_wrapper
from .locate_via_gps import GPSMappingError, get_floor_heading_offset, locate_map_point_from_gps
from .management_auth import (
  clear_management_access,
  get_management_access_denial_response,
  grant_management_access,
  management_access_required,
  validate_management_access_code,
)
from .models import ActivityRecord, SiteObservation
from .object_storage import build_image_object_url, delete_image_object, save_uploaded_image_object

ROOT_BUILDING_ID = "__root__"
MAP_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
MAX_PHOTO_PREVIEW_LENGTH = 180_000
ALLOWED_OBSERVATION_TYPES = {"photo", "note", "questions"}
SHORT_QUESTION_RESPONSE_FIELDS = (
  ("seatingAvailability", "seating_availability"),
  ("greeneryLevel", "greenery_level"),
  ("noiseLevel", "noise_level"),
  ("cleanliness", "cleanliness"),
)
ALLOWED_GENDERS = {"male", "female"}
ALLOWED_AGE_GROUPS = {
  "<10 years old",
  "10-20 years old",
  "20-60 years old",
  ">60 years old",
}
ALLOWED_ETHNIC_GROUPS = {"Chinese", "Malay", "Indian", "Others"}
ALLOWED_FACIAL_EXPRESSIONS = {"happy", "no_expression", "unhappy"}
FACIAL_EXPRESSION_ALIASES = {
  "happy": "happy",
  "smiling": "happy",
  "smile": "happy",
  "no expression": "no_expression",
  "no-expression": "no_expression",
  "no_expression": "no_expression",
  "neutral": "no_expression",
  "unhappy": "unhappy",
  "sad": "unhappy",
}
MAP_EXTENSION_PRIORITY = {
  ".svg": 0,
  ".png": 1,
  ".webp": 2,
  ".jpg": 3,
  ".jpeg": 4,
}


@ensure_csrf_cookie
def index(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/index.html", build_page_context("capture"))


@ensure_csrf_cookie
@require_http_methods(["GET", "POST"])
def management_login(request: HttpRequest) -> HttpResponse:
  if not settings.MANAGEMENT_ACCESS_ENABLED:
    return redirect("management")

  if not settings.MANAGEMENT_ACCESS_CODE:
    return render(
      request,
      "collector/management_login.html",
      {
        "next_path": "/management/",
        "error_message": "Management access code is not configured.",
        "management_access_enabled": settings.MANAGEMENT_ACCESS_ENABLED,
      },
      status=503,
    )

  next_path = get_safe_management_redirect_target(request)
  if request.session.get("management_access_granted"):
    return redirect(next_path)

  error_message = ""
  if request.method == "POST":
    submitted_code = request.POST.get("access_code", "")
    if validate_management_access_code(submitted_code):
      grant_management_access(request)
      return redirect(next_path)

    error_message = "Incorrect access code."

  return render(
    request,
    "collector/management_login.html",
    {
      "next_path": next_path,
      "error_message": error_message,
      "management_access_enabled": settings.MANAGEMENT_ACCESS_ENABLED,
    },
    status=403 if error_message else 200,
  )


@require_http_methods(["POST"])
def management_logout(request: HttpRequest) -> HttpResponse:
  clear_management_access(request)
  return redirect("management_login")


@management_access_required
@ensure_csrf_cookie
def management(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/management.html", build_page_context("management"))


@require_http_methods(["GET"])
def api_buildings(request: HttpRequest) -> JsonResponse:
  print("DEBUG: Entered api_buildings view.") # New Debug print 1
  building_maps = discover_building_maps_catalog()
  return JsonResponse({"buildings": building_maps})


@require_http_methods(["GET"])
def api_locate_via_gps(request: HttpRequest) -> JsonResponse:
  building_id = request.GET.get("building_id", "").strip()
  floor_id = request.GET.get("floor_id", "").strip()
  latitude = request.GET.get("latitude")
  longitude = request.GET.get("longitude")

  if not building_id or not floor_id:
    return JsonResponse({"error": "building_id and floor_id are required."}, status=400)

  if latitude is None or longitude is None:
    return JsonResponse({"error": "latitude and longitude are required."}, status=400)

  try:
    mapped_point = locate_map_point_from_gps(building_id, floor_id, latitude, longitude)
    heading_offset = get_floor_heading_offset(building_id, floor_id)
  except GPSMappingError as exc:
    return JsonResponse({"error": str(exc)}, status=400)

  return JsonResponse(
    {
      "buildingId": building_id,
      "floorId": floor_id,
      "headingOffsetDeg": float(heading_offset),
      "location": {
        "xPct": float(mapped_point["xPct"]),
        "yPct": float(mapped_point["yPct"]),
      },
    }
  )


@require_http_methods(["GET", "POST"])
def api_records(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    denial_response = get_management_access_denial_response(request)
    if denial_response is not None:
      return denial_response

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
          | Q(gender__icontains=search_text)
          | Q(age_group__icontains=search_text)
          | Q(facial_expression__icontains=search_text)
          | Q(notes__icontains=search_text)
          | Q(photo_name__icontains=search_text)
          | Q(building_id__icontains=search_text)
          | Q(floor_id__icontains=search_text)
        )

      records = [serialize_record(record) for record in query]
      return JsonResponse({"records": records})
    except DatabaseError as exc:
      return database_error_response(exc)

  payload, uploaded_photo, error_response = parse_request_payload(request)
  if error_response:
    return error_response

  uploaded_photo_object_name = ""
  try:
    if uploaded_photo is not None:
      uploaded_photo_object_name = save_uploaded_image_object(uploaded_photo, "activity-records")

    batch_payload = payload.get("records")
    if batch_payload is not None:
      if not isinstance(batch_payload, list) or not batch_payload:
        raise ValidationError({"records": ["Provide at least one record payload."]})

      records = []
      for item in batch_payload:
        if not isinstance(item, dict):
          raise ValidationError({"records": ["Each record payload must be an object."]})

        record = build_record_from_payload(
          item,
          fallback_photo_object_name=uploaded_photo_object_name,
          fallback_photo_name=uploaded_photo.name if uploaded_photo is not None else "",
        )
        record.full_clean()
        records.append(record)

      with transaction.atomic():
        for record in records:
          record.save()
    else:
      record = build_record_from_payload(
        payload,
        fallback_photo_object_name=uploaded_photo_object_name,
        fallback_photo_name=uploaded_photo.name if uploaded_photo is not None else "",
      )
      record.full_clean()
      record.save()
  except DatabaseError as exc:
    delete_image_object_if_unused(uploaded_photo_object_name)
    return database_error_response(exc)
  except ValidationError as exc:
    delete_image_object_if_unused(uploaded_photo_object_name)
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  if batch_payload is not None:
    return JsonResponse({"records": [serialize_record(record) for record in records]}, status=201)

  return JsonResponse({"record": serialize_record(record)}, status=201)


@require_http_methods(["GET", "POST"])
def api_site_observations(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    denial_response = get_management_access_denial_response(request)
    if denial_response is not None:
      return denial_response

    try:
      query = SiteObservation.objects.all()

      building_id = request.GET.get("building_id", "").strip()
      floor_id = request.GET.get("floor_id", "").strip()
      search_text = request.GET.get("q", "").strip()

      if building_id:
        query = query.filter(building_id=building_id)
      if floor_id:
        query = query.filter(floor_id=floor_id)
      if search_text:
        query = query.filter(
          Q(observation_type__icontains=search_text)
          | Q(note__icontains=search_text)
          | Q(photo_name__icontains=search_text)
          | Q(building_id__icontains=search_text)
          | Q(floor_id__icontains=search_text)
        )

      observations = [serialize_site_observation(observation) for observation in query]
      return JsonResponse({"observations": observations})
    except DatabaseError as exc:
      return database_error_response(exc)

  payload, uploaded_photo, error_response = parse_request_payload(request)
  if error_response:
    return error_response

  uploaded_photo_object_name = ""
  try:
    if uploaded_photo is not None:
      uploaded_photo_object_name = save_uploaded_image_object(uploaded_photo, "site-observations")

    observation = build_site_observation_from_payload(
      payload,
      fallback_photo_object_name=uploaded_photo_object_name,
      fallback_photo_name=uploaded_photo.name if uploaded_photo is not None else "",
    )
    observation.full_clean()
    observation.save()
  except DatabaseError as exc:
    delete_image_object_if_unused(uploaded_photo_object_name)
    return database_error_response(exc)
  except ValidationError as exc:
    delete_image_object_if_unused(uploaded_photo_object_name)
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  return JsonResponse({"observation": serialize_site_observation(observation)}, status=201)


@management_access_required
@require_http_methods(["DELETE"])
def api_record_detail(request: HttpRequest, record_id) -> JsonResponse:
  try:
    record = ActivityRecord.objects.filter(id=record_id).first()
  except DatabaseError as exc:
    return database_error_response(exc)

  if record is None:
    return JsonResponse({"error": "Record not found."}, status=404)

  photo_object_name = record.photo_object_name

  try:
    record.delete()
  except DatabaseError as exc:
    return database_error_response(exc)

  delete_image_object_if_unused(photo_object_name)
  return JsonResponse({"deleted": True})


@management_access_required
@require_http_methods(["DELETE"])
def api_site_observation_detail(request: HttpRequest, observation_id) -> JsonResponse:
  try:
    observation = SiteObservation.objects.filter(id=observation_id).first()
  except DatabaseError as exc:
    return database_error_response(exc)

  if observation is None:
    return JsonResponse({"error": "Site observation not found."}, status=404)

  photo_object_name = observation.photo_object_name

  try:
    observation.delete()
  except DatabaseError as exc:
    return database_error_response(exc)

  delete_image_object_if_unused(photo_object_name)
  return JsonResponse({"deleted": True})


@management_access_required
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


def build_page_context(active_page: str) -> dict[str, Any]:
  return {
    "active_page": active_page,
    "activity_options": INDIVIDUAL_ACTIVITY_TYPE_OPTIONS,
    "group_activity_typology_options": GROUP_ACTIVITY_TYPOLOGY_OPTIONS,
    "activity_catalog": build_activity_catalog_payload(),
  }


def get_safe_management_redirect_target(request: HttpRequest) -> str:
  candidate = request.POST.get("next") or request.GET.get("next") or ""
  if candidate and url_has_allowed_host_and_scheme(candidate, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
    return candidate
  return "/management/"

def parse_request_payload(request: HttpRequest) -> tuple[dict[str, Any], Any | None, JsonResponse | None]:
  content_type = (request.content_type or "").lower()
  if content_type.startswith("multipart/form-data"):
    raw_payload = request.POST.get("payload", "")
    payload, error_response = parse_json_payload_text(raw_payload)
    return payload, request.FILES.get("photo"), error_response

  payload, error_response = parse_json_request(request)
  return payload, None, error_response


def parse_json_request(request: HttpRequest) -> tuple[dict[str, Any], JsonResponse | None]:
  try:
    raw_payload = request.body.decode("utf-8")
  except UnicodeDecodeError:
    return {}, JsonResponse({"error": "Invalid JSON payload."}, status=400)

  return parse_json_payload_text(raw_payload)


def parse_json_payload_text(raw_payload: str) -> tuple[dict[str, Any], JsonResponse | None]:
  try:
    payload = json.loads(raw_payload)
  except json.JSONDecodeError:
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


def delete_image_object_if_unused(object_name: str) -> None:
  normalized_name = optional_string(object_name)
  if not normalized_name:
    return

  try:
    if ActivityRecord.objects.filter(photo_object_name=normalized_name).exists():
      return

    if SiteObservation.objects.filter(photo_object_name=normalized_name).exists():
      return
  except DatabaseError:
    return

  delete_image_object(normalized_name)


def build_record_from_payload(
  payload: dict[str, Any],
  *,
  fallback_photo_object_name: str = "",
  fallback_photo_name: str = "",
) -> ActivityRecord:
  building_id = require_non_empty_string(payload, "buildingId")
  floor_id = require_non_empty_string(payload, "floorId")
  activity_type = parse_activity_type(payload.get("activityType"))
  actor_id = optional_string(payload.get("actorId"))
  gender = parse_gender(payload.get("gender"))
  age_group = parse_age_group(payload.get("ageGroup"))
  ethnic_group = parse_ethnic_group(payload.get("ethnicGroup"))
  facial_expression = parse_facial_expression(payload.get("facialExpression", payload.get("expression")))
  notes = optional_string(payload.get("notes"))
  activity_time = parse_required_datetime(payload.get("activityTime"), "activityTime")

  location = payload.get("location")
  location_x_pct, location_y_pct = parse_location(location)

  photo_name = optional_string(payload.get("photoName"))
  photo_object_name = fallback_photo_object_name or optional_string(payload.get("photoObjectName"))
  photo_preview_data_url = parse_photo_preview(payload.get("photoPreview"))
  photo_location = payload.get("photoLocation")
  photo_latitude, photo_longitude, photo_altitude = parse_photo_location(photo_location)

  if location_x_pct is None and photo_latitude is None:
    raise ValidationError({"location": ["Provide map coordinates or photo GPS coordinates."]})

  return ActivityRecord(
    building_id=building_id,
    floor_id=floor_id,
    activity_type=activity_type,
    actor_id=actor_id,
    gender=gender,
    age_group=age_group,
    ethnic_group=ethnic_group,
    facial_expression=facial_expression,
    activity_time=activity_time,
    notes=notes,
    location_x_pct=location_x_pct,
    location_y_pct=location_y_pct,
    photo_name=photo_name or fallback_photo_name,
    photo_object_name=photo_object_name,
    photo_preview_data_url=photo_preview_data_url,
    photo_latitude=photo_latitude,
    photo_longitude=photo_longitude,
    photo_altitude=photo_altitude,
  )


def build_site_observation_from_payload(
  payload: dict[str, Any],
  *,
  fallback_photo_object_name: str = "",
  fallback_photo_name: str = "",
) -> SiteObservation:
  building_id = optional_string(payload.get("buildingId"))
  floor_id = optional_string(payload.get("floorId"))
  observation_type = parse_observation_type(payload.get("observationType"))
  observation_time = parse_optional_datetime(payload.get("observationTime"), "observationTime")
  note = optional_string(payload.get("note", payload.get("notes")))
  photo_name = optional_string(payload.get("photoName"))
  photo_object_name = fallback_photo_object_name or optional_string(payload.get("photoObjectName"))
  photo_preview_data_url = parse_photo_preview(payload.get("photoPreview"))
  photo_location = payload.get("photoLocation")
  photo_latitude, photo_longitude, photo_altitude = parse_photo_location(photo_location)
  short_question_responses = parse_short_question_responses(
    payload.get("shortQuestionResponses"),
    observation_type,
  )

  return SiteObservation(
    building_id=building_id,
    floor_id=floor_id,
    observation_type=observation_type,
    observation_time=observation_time,
    note=note,
    photo_name=photo_name or fallback_photo_name,
    photo_object_name=photo_object_name,
    photo_preview_data_url=photo_preview_data_url,
    photo_latitude=photo_latitude,
    photo_longitude=photo_longitude,
    photo_altitude=photo_altitude,
    **short_question_responses,
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


def parse_observation_type(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"observationType": ["Observation type is required."]})

  normalized = value.strip().lower()
  if normalized not in ALLOWED_OBSERVATION_TYPES:
    raise ValidationError({"observationType": ["Observation type must be 'photo', 'note', or 'questions'."]})

  return normalized


def parse_short_question_responses(value: Any, observation_type: str) -> dict[str, int]:
  if observation_type != "questions":
    return {}

  if not isinstance(value, dict):
    raise ValidationError({"shortQuestionResponses": ["Answer all short Qs from 1 to 5."]})

  parsed_values: dict[str, int] = {}
  errors: dict[str, list[str]] = {}

  for payload_key, model_field in SHORT_QUESTION_RESPONSE_FIELDS:
    raw_value = value.get(payload_key)
    error_key = f"shortQuestionResponses.{payload_key}"

    if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
      errors[error_key] = ["This answer is required."]
      continue

    if isinstance(raw_value, bool):
      errors[error_key] = ["Answer must be between 1 and 5."]
      continue

    if isinstance(raw_value, float) and not raw_value.is_integer():
      errors[error_key] = ["Answer must be between 1 and 5."]
      continue

    try:
      parsed_value = int(raw_value)
    except (TypeError, ValueError):
      errors[error_key] = ["Answer must be between 1 and 5."]
      continue

    if parsed_value < 1 or parsed_value > 5:
      errors[error_key] = ["Answer must be between 1 and 5."]
      continue

    parsed_values[model_field] = parsed_value

  if errors:
    raise ValidationError(errors)

  return parsed_values


def parse_activity_type(value: Any) -> str:
  if isinstance(value, str):
    raw_values = value.split(",")
  elif isinstance(value, (list, tuple)):
    raw_values = list(value)
  else:
    raise ValidationError({"activityType": ["Select at least one activity type."]})

  selected: set[str] = set()
  for item in raw_values:
    if not isinstance(item, str):
      raise ValidationError({"activityType": ["Activity types must be strings."]})

    normalized = normalize_activity_type_label(item)
    if not normalized:
      continue
    selected.add(normalized)

  if not selected:
    raise ValidationError({"activityType": ["Select at least one activity type."]})

  return ", ".join([activity for activity in ACTIVITY_TYPE_OPTIONS if activity in selected])


def normalize_activity_type_label(value: str) -> str:
  normalized = value.strip()
  if not normalized:
    return ""

  aliased = ACTIVITY_TYPE_ALIASES.get(normalized.lower(), normalized)
  for activity in ACTIVITY_TYPE_OPTIONS:
    if activity.lower() == aliased.lower():
      return activity

  raise ValidationError({"activityType": [f"'{normalized}' is not a valid activity type."]})


def parse_gender(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"gender": ["Gender is required."]})

  normalized = value.strip().lower()
  if normalized not in ALLOWED_GENDERS:
    raise ValidationError({"gender": ["Gender must be either 'male' or 'female'."]})
  return normalized


def parse_age_group(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"ageGroup": ["Age group is required."]})

  normalized = value.strip()
  if normalized not in ALLOWED_AGE_GROUPS:
    raise ValidationError({"ageGroup": ["Age group is invalid."]})
  return normalized

def parse_ethnic_group(value: Any) -> str:
  """Parses and validates the ethnic group field."""
  if not isinstance(value, str):
    # If not a string, it's considered empty/optional.
    return ""

  normalized = value.strip()
  if not normalized:
    return ""

  if normalized not in ALLOWED_ETHNIC_GROUPS:
    raise ValidationError({"ethnicGroup": [f"Ethnic group must be one of: {','.join(ALLOWED_ETHNIC_GROUPS)}."]})
  return normalized


def parse_facial_expression(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"facialExpression": ["Facial expression is required."]})

  normalized = value.strip().lower()
  matched = FACIAL_EXPRESSION_ALIASES.get(normalized, normalized)
  if matched not in ALLOWED_FACIAL_EXPRESSIONS:
    raise ValidationError({"facialExpression": ["Facial expression must be happy, no expression, or unhappy."]})
  return matched


def parse_required_datetime(value: Any, key: str):
  if not isinstance(value, str) or not value.strip():
    raise ValidationError({key: ["A valid datetime string is required."]})

  parsed = parse_datetime(value.strip())
  if parsed is None:
    raise ValidationError({key: ["Invalid datetime format."]})

  if timezone.is_naive(parsed):
    parsed = timezone.make_aware(parsed, timezone.get_current_timezone())

  return parsed


def parse_optional_datetime(value: Any, key: str):
  if value is None:
    return timezone.now()

  if isinstance(value, str) and not value.strip():
    return timezone.now()

  return parse_required_datetime(value, key)


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


def parse_photo_preview(value: Any) -> str:
  if value is None:
    return ""

  if not isinstance(value, str):
    raise ValidationError({"photoPreview": ["photoPreview must be a string."]})

  preview = value.strip()
  if not preview:
    return ""

  if not preview.startswith("data:image/") or ";base64," not in preview:
    raise ValidationError({"photoPreview": ["photoPreview must be a base64 image data URL."]})

  if len(preview) > MAX_PHOTO_PREVIEW_LENGTH:
    raise ValidationError(
      {"photoPreview": [f"photoPreview exceeds max length of {MAX_PHOTO_PREVIEW_LENGTH} characters."]}
    )

  return preview


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
    "gender": record.gender or None,
    "ageGroup": record.age_group or None,
    "ethnicGroup": record.ethnic_group or None,
    "facialExpression": record.facial_expression or None,
    "activityTime": isoformat_utc(record.activity_time),
    "notes": record.notes,
    "location": location,
    "photoName": record.photo_name or None,
    "photoObjectName": record.photo_object_name or None,
    "photoUrl": build_image_object_url(record.photo_object_name),
    "photoPreview": record.photo_preview_data_url or None,
    "photoLocation": photo_location,
  }


def serialize_site_observation(observation: SiteObservation) -> dict[str, Any]:
  photo_location = None
  if observation.photo_latitude is not None and observation.photo_longitude is not None:
    photo_location = {
      "latitude": float(observation.photo_latitude),
      "longitude": float(observation.photo_longitude),
    }
    if observation.photo_altitude is not None:
      photo_location["altitude"] = float(observation.photo_altitude)

  short_question_responses = None
  if any(getattr(observation, model_field) is not None for _, model_field in SHORT_QUESTION_RESPONSE_FIELDS):
    short_question_responses = {
      payload_key: getattr(observation, model_field)
      for payload_key, model_field in SHORT_QUESTION_RESPONSE_FIELDS
    }

  return {
    "id": str(observation.id),
    "createdAt": isoformat_utc(observation.created_at),
    "buildingId": observation.building_id or None,
    "floorId": observation.floor_id or None,
    "observationType": observation.observation_type,
    "observationTime": isoformat_utc(observation.observation_time),
    "note": observation.note or None,
    "photoName": observation.photo_name or None,
    "photoObjectName": observation.photo_object_name or None,
    "photoUrl": build_image_object_url(observation.photo_object_name),
    "photoPreview": observation.photo_preview_data_url or None,
    "photoLocation": photo_location,
    "shortQuestionResponses": short_question_responses,
  }


def isoformat_utc(value):
  if value is None:
    return None

  if timezone.is_naive(value):
    value = timezone.make_aware(value, datetime_timezone.utc)

  return value.astimezone(datetime_timezone.utc).isoformat().replace("+00:00", "Z")


def discover_building_maps() -> dict[str, Any]:
  print("DEBUG: Entered discover_building_maps function.") # New Debug print 2
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
  print(f"DEBUG: Extracting floor maps from folder: {folder}") # Debug print 1
  floors: dict[str, Any] = {}
  try:
    file_entries = sorted(
      [entry for entry in folder.iterdir() if entry.is_file() and entry.suffix.lower() in MAP_EXTENSIONS],
      key=lambda entry: (
        natural_sort_key(entry.stem),
        MAP_EXTENSION_PRIORITY.get(entry.suffix.lower(), 999),
        natural_sort_key(entry.name),
      ),
    )
    print(f"DEBUG: Found file entries in {folder}: {[entry.name for entry in file_entries]}") # Debug print 2

    for file_entry in file_entries:
      print(f"DEBUG: Processing file: {file_entry.name} in {folder}") # Debug print 3
      if file_entry.stem in floors:
        print(f"DEBUG: Skipping duplicate floor ID: {file_entry.stem}") # Debug print 4
        continue

      floor_id = file_entry.stem
      floor_map_path = resolve_floor_map_path(file_entry)
      print(f"DEBUG: resolve_floor_map_path returned: {floor_map_path}") # Debug print 5

      # This section is critical for path resolution.
      try:
          relative_path = floor_map_path.relative_to(settings.ASSETS_DIR).as_posix()
          mapSrc = f"/assets/{relative_path}"
          print(f"DEBUG: Calculated relative_path: {relative_path}, mapSrc: {mapSrc}") # Debug print 6
          floors[floor_id] = {
            "label": format_floor_label(floor_id),
            "mapSrc": mapSrc,
          }
      except ValueError as ve:
          print(f"DEBUG: ValueError during relative_to for {file_entry.name} in {folder}. Error: {ve}") # Debug print 7
          print(f"DEBUG: file_entry: {file_entry}, settings.ASSETS_DIR: {settings.ASSETS_DIR}") # Debug print 8
      except Exception as e:
          print(f"DEBUG: Unexpected error during path processing for {file_entry.name} in {folder}. Error: {e}") # Debug print 9

  except Exception as e:
    print(f"DEBUG: UNHANDLED EXCEPTION in extract_floor_maps for folder {folder}. Error: {e}") # Debug print 10
    # Returning empty floors to ensure consistent behavior on error.
    return {} 

  print(f"DEBUG: Finished extract_floor_maps for folder {folder}. Floors found: {len(floors)}") # Debug print 11
  return floors


def resolve_floor_map_path(file_path: Path) -> Path:
  if file_path.suffix.lower() not in {".jpg", ".jpeg"}:
    return file_path

  svg_path = file_path.with_suffix(".svg")
  if svg_path.exists() and not should_regenerate_jpg_wrapper(svg_path, file_path):
    return svg_path

  try:
    return convert_jpg_floorplan_to_svg(file_path, svg_path=svg_path, overwrite=True)
  except (OSError, ValueError):
    return svg_path if svg_path.exists() else file_path


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
