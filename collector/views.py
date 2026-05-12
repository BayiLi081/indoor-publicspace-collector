import json
import ipaddress
import re
from urllib import error as urlerror
from urllib import request as urlrequest
from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
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
from .asset_urls import fetch_json_from_url, get_effective_assets_base_url, is_allowed_asset_proxy_url
from .building_catalog import discover_building_maps as discover_building_maps_catalog
from .floorplan_svg import convert_jpg_floorplan_to_svg, should_regenerate_jpg_wrapper
from .locate_via_gps import GPSMappingError, get_floor_heading_offset, locate_map_point_from_gps
from .management_auth import (
  CAPTURE_ACCESS_SESSION_KEY,
  clear_capture_access,
  clear_management_access,
  get_management_access_denial_response,
  grant_capture_access,
  grant_management_access,
  management_access_required,
  validate_capture_access_code,
  validate_management_access_code,
)
from .models import (
  ActivityIdSequence,
  ActivityRecord,
  FlowingLineCount,
  FlowingLineRecord,
  LargeGroupRecord,
  MyHubConceptPin,
  PersonQuestionnaireResponse,
  SiteObservation,
)
from .object_storage import build_image_object_url, delete_image_object, save_uploaded_image_object

ROOT_BUILDING_ID = "__root__"
MAP_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
MAX_PHOTO_PREVIEW_LENGTH = 180_000
ALLOWED_OBSERVATION_TYPES = {"photo", "note", "questions"}
AUTO_ACTOR_ID_PATTERN = re.compile(r"^CL(\d+)-P(\d+)$", re.IGNORECASE)
AUTO_ACTOR_CLUSTER_SEQUENCE_KEY = "auto_actor_cluster"
SHORT_QUESTION_RESPONSE_FIELDS = (
  ("seatingAvailability", "seating_availability"),
  ("greeneryLevel", "greenery_level"),
  ("noiseLevel", "noise_level"),
  ("cleanliness", "cleanliness"),
)
PERSON_QUESTIONNAIRE_RESPONSE_FIELDS = (
  ("mainPurpose", "main_purpose"),
  ("visitFrequency", "visit_frequency"),
  ("stayDuration", "stay_duration"),
  ("socialInteraction", "social_interaction"),
)
PERSON_QUESTIONNAIRE_BOOLEAN_FIELDS = (
  ("wantsToMapHub", "wants_to_map_hub"),
)
PERSON_QUESTIONNAIRE_HUB_RESPONSE_FIELDS = {
  "visitedComparativeCase",
  "comparativeVisitFrequency",
  "promotesGroupActivities",
  "preferredForSociospatialCapital",
}
MYHUB_CATEGORY_LABELS = dict(MyHubConceptPin.CATEGORY_CHOICES)
MYHUB_CATEGORY_COLORS = {
  "tables": "#2563eb",
  "benches": "#0f766e",
  "soft_seating_corners": "#db2777",
  "courtyards": "#65a30d",
  "atriums": "#7c3aed",
  "activity_rooms": "#ea580c",
  "childrens_play_areas": "#0891b2",
  "reading_corners": "#4f46e5",
  "planting_areas": "#16a34a",
  "event_spaces": "#dc2626",
  "exercise_areas": "#ca8a04",
  "makerspaces": "#9333ea",
}
PERSON_QUESTIONNAIRE_ALLOWED_CHOICES = {
  "mainPurpose": {choice[0] for choice in PersonQuestionnaireResponse.MAIN_PURPOSE_CHOICES},
  "visitFrequency": {choice[0] for choice in PersonQuestionnaireResponse.VISIT_FREQUENCY_CHOICES},
  "stayDuration": {choice[0] for choice in PersonQuestionnaireResponse.STAY_DURATION_CHOICES},
  "socialInteraction": {choice[0] for choice in PersonQuestionnaireResponse.SOCIAL_INTERACTION_CHOICES},
}
ALLOWED_GENDERS = {"male", "female"}
ALLOWED_LARGE_GROUP_GENDER_COMPOSITIONS = {
  "only male",
  "majority male",
  "half-half",
  "majority female",
  "only female",
}
ALLOWED_AGE_GROUPS = {
  "<10 years old",
  "10-20 years old",
  "20-60 years old",
  ">60 years old",
}
ALLOWED_LARGE_GROUP_AGE_COMPOSITIONS = {
  "only young people",
  "majority young people",
  "all age group",
  "majority elderly",
  "only elderly",
}
ALLOWED_LARGE_GROUP_SIZE_BANDS = {"9-20 people", "20-50 people", "50-100 people", "more than 100 people"}
ALLOWED_ETHNIC_GROUPS = {"Chinese", "Malay", "Indian", "Others"}
ALLOWED_FACIAL_EXPRESSIONS = {"happy", "no_expression", "unhappy"}
ALLOWED_FLOWING_DIRECTIONS = {"ab", "ba"}
FLOWING_AGE_GROUP_VALUES = ("<10 years old", "10-20 years old", "20-60 years old", ">60 years old")
FLOWING_AGE_GROUP_ALIASES = {
  "under-10": "<10 years old",
  "<10 years old": "<10 years old",
  "10-20": "10-20 years old",
  "10-20 years old": "10-20 years old",
  "20-60": "20-60 years old",
  "20-60 years old": "20-60 years old",
  "over-60": ">60 years old",
  ">60 years old": ">60 years old",
}
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
MAX_REMOTE_IMAGE_BYTES = 40 * 1024 * 1024


@ensure_csrf_cookie
def index(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/index.html", build_page_context("capture"))


@ensure_csrf_cookie
def flowing(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/flowing.html", build_page_context("flowing"))


@ensure_csrf_cookie
def myhub(request: HttpRequest) -> HttpResponse:
  return render(request, "collector/myhub.html", build_page_context("myhub"))


@ensure_csrf_cookie
@require_http_methods(["GET", "POST"])
def capture_login(request: HttpRequest) -> HttpResponse:
  if not settings.CAPTURE_ACCESS_ENABLED:
    return redirect("index")

  if not settings.CAPTURE_ACCESS_CODE:
    return render(
      request,
      "collector/capture_login.html",
      {
        "next_path": "/",
        "error_message": "Capture access code is not configured.",
      },
      status=503,
    )

  next_path = get_safe_redirect_target(request, default_path="/", expected_route_name="capture_login")
  if request.session.get(CAPTURE_ACCESS_SESSION_KEY):
    return redirect(next_path)

  error_message = ""
  if request.method == "POST":
    submitted_code = request.POST.get("access_code", "")
    if validate_capture_access_code(submitted_code):
      grant_capture_access(request)
      return redirect(next_path)

    error_message = "Incorrect access code."

  return render(
    request,
    "collector/capture_login.html",
    {
      "next_path": next_path,
      "error_message": error_message,
    },
    status=403 if error_message else 200,
  )


@require_http_methods(["POST"])
def capture_logout(request: HttpRequest) -> HttpResponse:
  clear_capture_access(request)
  return redirect("capture_login")


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

  next_path = get_safe_redirect_target(request, default_path="/management/", expected_route_name="management_login")
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
  building_maps = discover_building_maps_catalog()
  return JsonResponse({"buildings": building_maps, "assetsBaseUrl": get_effective_assets_base_url()})


@require_http_methods(["GET"])
def api_asset_json(request: HttpRequest) -> JsonResponse:
  url = request.GET.get("url", "").strip()
  if not url:
    return JsonResponse({"error": "url query parameter is required."}, status=400)

  allowed_hosts = getattr(settings, "ASSET_PROXY_ALLOWED_HOSTS", [])
  if not is_allowed_asset_proxy_url(url, allowed_hosts):
    return JsonResponse({"error": "Remote URL host is not allowed."}, status=403)

  timeout_secs = getattr(settings, "BUILDINGS_MANIFEST_TIMEOUT_SECS", 10)
  payload = fetch_json_from_url(url, timeout=timeout_secs, label="asset json")
  if payload is None:
    return JsonResponse({"error": "Could not fetch remote JSON from the provided URL."}, status=502)

  if not isinstance(payload, (dict, list)):
    return JsonResponse({"error": "Remote payload is not valid JSON content."}, status=502)

  return JsonResponse(payload, safe=isinstance(payload, dict))


@require_http_methods(["GET"])
def api_asset_image(request: HttpRequest) -> HttpResponse:
  url = request.GET.get("url", "").strip()
  if not url:
    return JsonResponse({"error": "url query parameter is required."}, status=400)

  allowed_hosts = getattr(settings, "ASSET_PROXY_ALLOWED_HOSTS", [])
  if not is_allowed_asset_proxy_url(url, allowed_hosts):
    return JsonResponse({"error": "Remote URL host is not allowed."}, status=403)

  timeout_secs = getattr(settings, "BUILDINGS_MANIFEST_TIMEOUT_SECS", 10)
  remote_request = urlrequest.Request(
    url,
    headers={
      "User-Agent": "indoor-publicspace-collector/1.0",
    },
  )

  try:
    with urlrequest.urlopen(remote_request, timeout=timeout_secs) as response:
      image_bytes = response.read(MAX_REMOTE_IMAGE_BYTES + 1)
      content_type = response.headers.get_content_type() or "application/octet-stream"
  except (OSError, ValueError, urlerror.URLError):
    return JsonResponse({"error": "Could not fetch remote image from the provided URL."}, status=502)

  if len(image_bytes) > MAX_REMOTE_IMAGE_BYTES:
    return JsonResponse({"error": "Remote image is too large to proxy."}, status=413)

  proxied_response = HttpResponse(image_bytes, content_type=content_type)
  proxied_response["Cache-Control"] = "public, max-age=3600"
  return proxied_response


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
      large_group_query = LargeGroupRecord.objects.all()

      if building_id:
        large_group_query = large_group_query.filter(building_id=building_id)
      if floor_id:
        large_group_query = large_group_query.filter(floor_id=floor_id)
      if search_text:
        large_group_query = large_group_query.filter(
          Q(actor_id__icontains=search_text)
          | Q(size_band__icontains=search_text)
          | Q(gender_composition__icontains=search_text)
          | Q(age_composition__icontains=search_text)
          | Q(activity_description__icontains=search_text)
          | Q(notes__icontains=search_text)
          | Q(photo_name__icontains=search_text)
          | Q(building_id__icontains=search_text)
          | Q(floor_id__icontains=search_text)
        )

      records.extend(serialize_large_group_record(record) for record in large_group_query)
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
    large_group_payload = payload.get("largeGroupRecord")
    if batch_payload is not None and large_group_payload is not None:
      raise ValidationError({"records": ["Submit either records or a largeGroupRecord, not both."]})

    if large_group_payload is not None:
      if not isinstance(large_group_payload, dict):
        raise ValidationError({"largeGroupRecord": ["largeGroupRecord must be an object."]})

      large_group_record = build_large_group_record_from_payload(
        large_group_payload,
        fallback_photo_object_name=uploaded_photo_object_name,
        fallback_photo_name=uploaded_photo.name if uploaded_photo is not None else "",
      )
      with transaction.atomic():
        assign_auto_actor_ids([large_group_record])
        large_group_record.full_clean()
        large_group_record.save()
      return JsonResponse({"record": serialize_large_group_record(large_group_record)}, status=201)

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
        records.append(record)

      with transaction.atomic():
        assign_auto_actor_ids(records)
        for record in records:
          record.full_clean()
        for record in records:
          record.save()
    else:
      record = build_record_from_payload(
        payload,
        fallback_photo_object_name=uploaded_photo_object_name,
        fallback_photo_name=uploaded_photo.name if uploaded_photo is not None else "",
      )
      with transaction.atomic():
        assign_auto_actor_ids([record])
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


@require_http_methods(["GET"])
def api_records_next_cluster(request: HttpRequest) -> JsonResponse:
  try:
    next_cluster_number = get_next_auto_actor_cluster_number()
  except DatabaseError as exc:
    return database_error_response(exc)

  return JsonResponse(
    {
      "nextClusterNumber": next_cluster_number,
      "clusterId": build_auto_actor_cluster_id(next_cluster_number),
      "firstActorId": build_auto_actor_id(next_cluster_number, 1),
    }
  )


@require_http_methods(["GET", "POST"])
def api_flowing_records(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    denial_response = get_management_access_denial_response(request)
    if denial_response is not None:
      return denial_response

    try:
      query = FlowingLineRecord.objects.prefetch_related("counts").all()
      building_id = request.GET.get("building_id", "").strip()
      floor_id = request.GET.get("floor_id", "").strip()

      if building_id:
        query = query.filter(building_id=building_id)
      if floor_id:
        query = query.filter(floor_id=floor_id)

      return JsonResponse({"flowingRecords": [serialize_flowing_line_record(record) for record in query]})
    except DatabaseError as exc:
      return database_error_response(exc)

  payload, error_response = parse_json_request(request)
  if error_response:
    return error_response

  try:
    flowing_record, count_records = build_flowing_line_record_from_payload(payload)
    with transaction.atomic():
      flowing_record.full_clean()
      flowing_record.save()
      for count_record in count_records:
        count_record.flowing_line = flowing_record
        count_record.full_clean()
      FlowingLineCount.objects.bulk_create(count_records)
  except DatabaseError as exc:
    return database_error_response(exc)
  except ValidationError as exc:
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  return JsonResponse({"flowingRecord": serialize_flowing_line_record(flowing_record)}, status=201)


@require_http_methods(["GET", "POST", "DELETE"])
def api_myhub_pins(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    try:
      query = MyHubConceptPin.objects.all()
      building_id = request.GET.get("building_id", "").strip()
      floor_id = request.GET.get("floor_id", "").strip()
      record_id = request.GET.get("record_id", "").strip()
      questionnaire_response_id = request.GET.get("questionnaire_response_id", "").strip()

      if building_id:
        query = query.filter(building_id=building_id)
      if floor_id:
        query = query.filter(floor_id=floor_id)
      if record_id:
        try:
          query = query.filter(activity_record_id=UUID(record_id))
        except (TypeError, ValueError):
          raise ValidationError({"recordId": ["Record id must be a valid UUID."]})
      if questionnaire_response_id:
        try:
          query = query.filter(questionnaire_response_id=UUID(questionnaire_response_id))
        except (TypeError, ValueError):
          raise ValidationError({"questionnaireResponseId": ["Questionnaire response id must be a valid UUID."]})

      return JsonResponse({"pins": [serialize_myhub_pin(pin) for pin in query]})
    except DatabaseError as exc:
      return database_error_response(exc)
    except ValidationError as exc:
      return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  if request.method == "DELETE":
    try:
      pin_id = request.GET.get("id", "").strip()
      if pin_id:
        try:
          deleted_count, _ = MyHubConceptPin.objects.filter(id=UUID(pin_id)).delete()
        except (TypeError, ValueError):
          raise ValidationError({"id": ["Pin id must be a valid UUID."]})
        return JsonResponse({"deleted": deleted_count})

      building_id = request.GET.get("building_id", "").strip()
      floor_id = request.GET.get("floor_id", "").strip()
      record_id = request.GET.get("record_id", "").strip()
      if not building_id or not floor_id:
        raise ValidationError({"floor": ["Provide id, or both building_id and floor_id query parameters."]})

      query = MyHubConceptPin.objects.filter(building_id=building_id, floor_id=floor_id)
      if record_id:
        try:
          query = query.filter(activity_record_id=UUID(record_id))
        except (TypeError, ValueError):
          raise ValidationError({"recordId": ["Record id must be a valid UUID."]})
      deleted_count, _ = query.delete()
      return JsonResponse({"deleted": deleted_count})
    except DatabaseError as exc:
      return database_error_response(exc)
    except ValidationError as exc:
      return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  payload, error_response = parse_json_request(request)
  if error_response:
    return error_response

  try:
    pin = build_myhub_pin_from_payload(payload, device_ip=get_request_ip_address(request))
    pin.full_clean()
    pin.save()
  except DatabaseError as exc:
    return database_error_response(exc)
  except ValidationError as exc:
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  return JsonResponse({"pin": serialize_myhub_pin(pin)}, status=201)


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


@require_http_methods(["GET", "POST"])
def api_person_questionnaire_responses(request: HttpRequest) -> JsonResponse:
  if request.method == "GET":
    denial_response = get_management_access_denial_response(request)
    if denial_response is not None:
      return denial_response

    try:
      query = PersonQuestionnaireResponse.objects.select_related("activity_record").all()

      record_id = request.GET.get("record_id", "").strip()
      actor_id = request.GET.get("actor_id", "").strip()
      if record_id:
        try:
          query = query.filter(activity_record_id=UUID(record_id))
        except (TypeError, ValueError):
          raise ValidationError({"recordId": ["Record id must be a valid UUID."]})
      if actor_id:
        query = query.filter(actor_id=actor_id)

      responses = [serialize_person_questionnaire_response(response) for response in query]
      return JsonResponse({"responses": responses})
    except DatabaseError as exc:
      return database_error_response(exc)
    except ValidationError as exc:
      return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  payload, uploaded_photo, error_response = parse_request_payload(request)
  if error_response:
    return error_response
  if uploaded_photo is not None:
    return JsonResponse({"error": "Questionnaire responses do not accept photo uploads."}, status=400)

  try:
    record_ids = parse_questionnaire_record_ids(payload.get("recordIds", payload.get("recordId")))
    response_values = parse_person_questionnaire_responses(payload.get("responses", payload))
    questionnaire_time = parse_optional_datetime(payload.get("questionnaireTime"), "questionnaireTime")

    records_by_id = {
      str(record.id): record
      for record in ActivityRecord.objects.filter(id__in=record_ids)
    }
    missing_ids = [record_id for record_id in record_ids if record_id not in records_by_id]
    if missing_ids:
      raise ValidationError({"recordIds": ["One or more selected people no longer exist."]})

    questionnaire_responses = []
    for record_id in record_ids:
      activity_record = records_by_id[record_id]
      response = PersonQuestionnaireResponse(
        activity_record=activity_record,
        actor_id=activity_record.actor_id,
        questionnaire_time=questionnaire_time,
        **response_values,
      )
      response.full_clean()
      questionnaire_responses.append(response)

    with transaction.atomic():
      for response in questionnaire_responses:
        response.save()
  except DatabaseError as exc:
    return database_error_response(exc)
  except ValidationError as exc:
    return JsonResponse({"error": normalize_validation_error(exc)}, status=400)

  return JsonResponse(
    {"responses": [serialize_person_questionnaire_response(response) for response in questionnaire_responses]},
    status=201,
  )


@management_access_required
@require_http_methods(["DELETE"])
def api_record_detail(request: HttpRequest, record_id) -> JsonResponse:
  try:
    record = ActivityRecord.objects.filter(id=record_id).first()
    if record is None:
      record = LargeGroupRecord.objects.filter(id=record_id).first()
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
    records.extend(serialize_large_group_record(record) for record in LargeGroupRecord.objects.all())
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


def get_safe_redirect_target(request: HttpRequest, *, default_path: str, expected_route_name: str) -> str:
  candidate = request.POST.get("next") or request.GET.get("next") or ""
  if candidate and url_has_allowed_host_and_scheme(candidate, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
    expected_path = reverse(expected_route_name)
    if candidate.startswith(expected_path):
      return default_path
    return candidate
  return default_path

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

    if LargeGroupRecord.objects.filter(photo_object_name=normalized_name).exists():
      return

    if SiteObservation.objects.filter(photo_object_name=normalized_name).exists():
      return
  except DatabaseError:
    return

  delete_image_object(normalized_name)


def parse_auto_actor_id(value: Any) -> tuple[int, int] | None:
  if not isinstance(value, str):
    return None

  match = AUTO_ACTOR_ID_PATTERN.match(value.strip())
  if not match:
    return None

  cluster_number = int(match.group(1))
  person_number = int(match.group(2))
  if cluster_number < 1 or person_number < 1:
    return None

  return cluster_number, person_number


def build_auto_actor_cluster_id(cluster_number: int) -> str:
  return f"CL{cluster_number:04d}"


def build_auto_actor_id(cluster_number: int, person_number: int) -> str:
  return f"{build_auto_actor_cluster_id(cluster_number)}-P{person_number:03d}"


def get_max_stored_auto_actor_cluster_number() -> int:
  max_cluster_number = 0
  actor_ids = list(ActivityRecord.objects.filter(actor_id__istartswith="CL").values_list("actor_id", flat=True))
  actor_ids.extend(LargeGroupRecord.objects.filter(actor_id__istartswith="CL").values_list("actor_id", flat=True))

  for actor_id in actor_ids:
    parsed_actor_id = parse_auto_actor_id(actor_id)
    if parsed_actor_id is None:
      continue

    cluster_number, _ = parsed_actor_id
    max_cluster_number = max(max_cluster_number, cluster_number)

  return max_cluster_number


def get_next_auto_actor_cluster_number() -> int:
  sequence = ActivityIdSequence.objects.filter(key=AUTO_ACTOR_CLUSTER_SEQUENCE_KEY).first()
  sequence_next = sequence.next_cluster_number if sequence is not None else 1
  return max(sequence_next, get_max_stored_auto_actor_cluster_number() + 1)


def allocate_auto_actor_cluster_numbers(cluster_count: int) -> list[int]:
  if cluster_count <= 0:
    return []

  with transaction.atomic():
    sequence, _ = ActivityIdSequence.objects.select_for_update().get_or_create(
      key=AUTO_ACTOR_CLUSTER_SEQUENCE_KEY,
      defaults={"next_cluster_number": get_max_stored_auto_actor_cluster_number() + 1},
    )
    next_cluster_number = max(sequence.next_cluster_number, get_max_stored_auto_actor_cluster_number() + 1)
    allocated_cluster_numbers = list(range(next_cluster_number, next_cluster_number + cluster_count))

    sequence.next_cluster_number = next_cluster_number + cluster_count
    sequence.save(update_fields=["next_cluster_number", "updated_at"])

  return allocated_cluster_numbers


def assign_auto_actor_ids(records: list[ActivityRecord]) -> None:
  parsed_actor_ids = [parse_auto_actor_id(record.actor_id) for record in records]
  submitted_cluster_numbers = []

  for parsed_actor_id in parsed_actor_ids:
    if parsed_actor_id is None:
      continue

    cluster_number, _ = parsed_actor_id
    if cluster_number not in submitted_cluster_numbers:
      submitted_cluster_numbers.append(cluster_number)

  if not submitted_cluster_numbers:
    return

  allocated_cluster_numbers = allocate_auto_actor_cluster_numbers(len(submitted_cluster_numbers))
  cluster_number_map = dict(zip(submitted_cluster_numbers, allocated_cluster_numbers))

  for record, parsed_actor_id in zip(records, parsed_actor_ids):
    if parsed_actor_id is None:
      continue

    submitted_cluster_number, person_number = parsed_actor_id
    record.actor_id = build_auto_actor_id(cluster_number_map[submitted_cluster_number], person_number)


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


def build_large_group_record_from_payload(
  payload: dict[str, Any],
  *,
  fallback_photo_object_name: str = "",
  fallback_photo_name: str = "",
) -> LargeGroupRecord:
  building_id = require_non_empty_string(payload, "buildingId")
  floor_id = require_non_empty_string(payload, "floorId")
  actor_id = optional_string(payload.get("actorId"))
  size_band = parse_large_group_size_band(payload.get("sizeBand"))
  gender_composition = parse_large_group_gender_composition(payload.get("genderComposition"))
  age_composition = parse_large_group_age_composition(payload.get("ageComposition"))
  activity_description = require_non_empty_string(payload, "activityDescription")
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

  return LargeGroupRecord(
    building_id=building_id,
    floor_id=floor_id,
    actor_id=actor_id,
    size_band=size_band,
    gender_composition=gender_composition,
    age_composition=age_composition,
    activity_description=activity_description,
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


def build_flowing_line_record_from_payload(payload: dict[str, Any]) -> tuple[FlowingLineRecord, list[FlowingLineCount]]:
  building_id = require_non_empty_string(payload, "buildingId")
  floor_id = require_non_empty_string(payload, "floorId")
  line_geometry = parse_flowing_line_geometry(payload.get("lineGeometry"))
  direction_duration_seconds = parse_positive_integer(
    payload.get("directionDurationSeconds", 300),
    "directionDurationSeconds",
  )
  started_at = parse_optional_datetime(payload.get("startedAt"), "startedAt")
  completed_at = parse_optional_datetime(payload.get("completedAt"), "completedAt")
  notes = optional_string(payload.get("notes"))
  count_records = parse_flowing_counts(payload.get("counts"))

  flowing_record = FlowingLineRecord(
    building_id=building_id,
    floor_id=floor_id,
    line_geometry=line_geometry,
    direction_duration_seconds=direction_duration_seconds,
    started_at=started_at,
    completed_at=completed_at,
    notes=notes,
  )
  return flowing_record, count_records


def build_myhub_pin_from_payload(payload: dict[str, Any], *, device_ip: str | None = None) -> MyHubConceptPin:
  building_id = require_non_empty_string(payload, "buildingId")
  floor_id = require_non_empty_string(payload, "floorId")
  category_key = parse_myhub_category_key(payload.get("categoryKey"))
  location_x_pct, location_y_pct = parse_location(payload.get("location"))
  if location_x_pct is None or location_y_pct is None:
    raise ValidationError({"location": ["Map coordinates are required."]})

  activity_record = parse_optional_activity_record(payload.get("recordId"))
  questionnaire_response = parse_optional_questionnaire_response(payload.get("questionnaireResponseId"))
  actor_id = optional_string(payload.get("actorId")) or (activity_record.actor_id if activity_record else "")
  respondent_postcode = parse_postcode(payload.get("postcode"), required=False)

  return MyHubConceptPin(
    building_id=building_id,
    building_label=optional_string(payload.get("buildingLabel")),
    floor_id=floor_id,
    floor_label=optional_string(payload.get("floorLabel")),
    activity_record=activity_record,
    questionnaire_response=questionnaire_response,
    actor_id=actor_id,
    respondent_postcode=respondent_postcode,
    category_key=category_key,
    category_label=MYHUB_CATEGORY_LABELS[category_key],
    category_color=MYHUB_CATEGORY_COLORS[category_key],
    device_ip=device_ip,
    location_x_pct=location_x_pct,
    location_y_pct=location_y_pct,
  )


def parse_myhub_category_key(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"categoryKey": ["Category is required."]})

  normalized = value.strip()
  if normalized not in MYHUB_CATEGORY_LABELS:
    raise ValidationError({"categoryKey": ["Category is invalid."]})
  return normalized


def parse_optional_activity_record(value: Any) -> ActivityRecord | None:
  if not isinstance(value, str) or not value.strip():
    return None
  try:
    record_id = UUID(value.strip())
  except (TypeError, ValueError):
    raise ValidationError({"recordId": ["Record id must be a valid UUID."]})

  record = ActivityRecord.objects.filter(id=record_id).first()
  if record is None:
    raise ValidationError({"recordId": ["Selected person record does not exist."]})
  return record


def parse_optional_questionnaire_response(value: Any) -> PersonQuestionnaireResponse | None:
  if not isinstance(value, str) or not value.strip():
    return None
  try:
    response_id = UUID(value.strip())
  except (TypeError, ValueError):
    raise ValidationError({"questionnaireResponseId": ["Questionnaire response id must be a valid UUID."]})

  response = PersonQuestionnaireResponse.objects.filter(id=response_id).first()
  if response is None:
    raise ValidationError({"questionnaireResponseId": ["Questionnaire response does not exist."]})
  return response


def require_non_empty_string(payload: dict[str, Any], key: str) -> str:
  value = payload.get(key)
  if isinstance(value, str) and value.strip():
    return value.strip()
  raise ValidationError({key: ["This field is required."]})


def optional_string(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def get_request_ip_address(request: HttpRequest) -> str | None:
  x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
  forwarded_candidates = [segment.strip() for segment in x_forwarded_for.split(",") if segment.strip()]
  remote_addr = str(request.META.get("REMOTE_ADDR", "")).strip()
  candidates = [*forwarded_candidates, remote_addr]

  for candidate in candidates:
    try:
      parsed_ip = ipaddress.ip_address(candidate)
      return str(parsed_ip)
    except ValueError:
      continue

  return None


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


def parse_questionnaire_record_ids(value: Any) -> list[str]:
  raw_values = value if isinstance(value, list) else [value]
  if not raw_values or raw_values == [None]:
    raise ValidationError({"recordIds": ["Select at least one person."]})

  parsed_ids: list[str] = []
  errors = []
  for raw_value in raw_values:
    try:
      parsed_id = str(UUID(str(raw_value)))
    except (TypeError, ValueError, AttributeError):
      errors.append("Record id must be a valid UUID.")
      continue

    if parsed_id not in parsed_ids:
      parsed_ids.append(parsed_id)

  if errors:
    raise ValidationError({"recordIds": errors})
  if not parsed_ids:
    raise ValidationError({"recordIds": ["Select at least one person."]})
  if len(parsed_ids) > 1:
    raise ValidationError({"recordIds": ["Select only one person for each questionnaire response."]})

  return parsed_ids


def parse_person_questionnaire_responses(value: Any) -> dict[str, Any]:
  if not isinstance(value, dict):
    raise ValidationError({"responses": ["Questionnaire responses are required."]})

  parsed_values: dict[str, Any] = {}
  errors: dict[str, list[str]] = {}

  try:
    parsed_values["postcode"] = parse_postcode(value.get("postcode"), required=True)
  except ValidationError as exc:
    if hasattr(exc, "message_dict"):
      errors.update(exc.message_dict)
    else:
      errors["responses.postcode"] = exc.messages

  for payload_key, model_field in PERSON_QUESTIONNAIRE_RESPONSE_FIELDS:
    raw_value = value.get(payload_key)
    allowed_values = PERSON_QUESTIONNAIRE_ALLOWED_CHOICES[payload_key]
    if not isinstance(raw_value, str) or raw_value.strip() not in allowed_values:
      errors[f"responses.{payload_key}"] = ["Select one of the provided options."]
      continue
    parsed_values[model_field] = raw_value.strip()

  raw_rating = value.get("overallRating")
  if raw_rating is None or (isinstance(raw_rating, str) and not raw_rating.strip()):
    errors["responses.overallRating"] = ["Overall rating is required."]
  elif isinstance(raw_rating, bool):
    errors["responses.overallRating"] = ["Overall rating must be between 1 and 5."]
  elif isinstance(raw_rating, float) and not raw_rating.is_integer():
    errors["responses.overallRating"] = ["Overall rating must be between 1 and 5."]
  else:
    try:
      parsed_rating = int(raw_rating)
      if parsed_rating < 1 or parsed_rating > 5:
        raise ValueError
      parsed_values["overall_rating"] = parsed_rating
    except (TypeError, ValueError):
      errors["responses.overallRating"] = ["Overall rating must be between 1 and 5."]

  for payload_key, model_field in PERSON_QUESTIONNAIRE_BOOLEAN_FIELDS:
    raw_value = value.get(payload_key)
    if raw_value not in {"yes", "no", True, False}:
      errors[f"responses.{payload_key}"] = ["Select one of the provided options."]
      continue
    parsed_values[model_field] = raw_value in {"yes", True}

  if errors:
    raise ValidationError(errors)

  parsed_values["hub_specific_responses"] = parse_hub_specific_questionnaire_responses(
    value.get("hubSpecificResponses", {})
  )

  return parsed_values


def parse_postcode(value: Any, *, required: bool) -> str:
  if value is None or (isinstance(value, str) and not value.strip()):
    if required:
      raise ValidationError({"responses.postcode": ["Postcode is required."]})
    return ""

  normalized = str(value).strip().replace(" ", "")
  if not re.fullmatch(r"\d{6}", normalized):
    raise ValidationError({"responses.postcode": ["Enter a 6-digit postcode."]})
  return normalized


def parse_hub_specific_questionnaire_responses(value: Any) -> dict[str, str]:
  if value in (None, ""):
    return {}
  if not isinstance(value, dict):
    raise ValidationError({"responses.hubSpecificResponses": ["Hub-specific responses must be an object."]})

  parsed_values: dict[str, str] = {}
  errors: dict[str, list[str]] = {}
  for key, raw_value in value.items():
    if key not in PERSON_QUESTIONNAIRE_HUB_RESPONSE_FIELDS:
      errors[f"responses.hubSpecificResponses.{key}"] = ["This hub-specific question is not supported."]
      continue
    if not isinstance(raw_value, str) or not raw_value.strip():
      errors[f"responses.hubSpecificResponses.{key}"] = ["Select one of the provided options."]
      continue
    parsed_values[key] = raw_value.strip()

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
  allowed_values = ALLOWED_GENDERS | ALLOWED_LARGE_GROUP_GENDER_COMPOSITIONS
  if normalized not in allowed_values:
    raise ValidationError(
      {
        "gender": [
          "Gender must be either 'male' or 'female', or one of the large-group compositions: only/majority male, half-half, only/majority female."
        ]
      }
    )
  return normalized


def parse_large_group_gender_composition(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"genderComposition": ["Gender composition is required."]})

  normalized = value.strip().lower()
  if normalized not in ALLOWED_LARGE_GROUP_GENDER_COMPOSITIONS:
    raise ValidationError({"genderComposition": ["Gender composition is invalid."]})
  return normalized


def parse_age_group(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"ageGroup": ["Age group is required."]})

  normalized = value.strip()
  allowed_values = ALLOWED_AGE_GROUPS | ALLOWED_LARGE_GROUP_AGE_COMPOSITIONS
  if normalized not in allowed_values:
    raise ValidationError({"ageGroup": ["Age group is invalid."]})
  return normalized


def parse_large_group_age_composition(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"ageComposition": ["Age composition is required."]})

  normalized = value.strip().lower()
  if normalized not in ALLOWED_LARGE_GROUP_AGE_COMPOSITIONS:
    raise ValidationError({"ageComposition": ["Age composition is invalid."]})
  return normalized


def parse_large_group_size_band(value: Any) -> str:
  if not isinstance(value, str):
    raise ValidationError({"sizeBand": ["Size band is required."]})

  normalized = value.strip().lower()
  if normalized not in ALLOWED_LARGE_GROUP_SIZE_BANDS:
    raise ValidationError({"sizeBand": ["Size band is invalid."]})
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


def parse_flowing_line_geometry(value: Any) -> dict[str, Any]:
  if not isinstance(value, dict):
    raise ValidationError({"lineGeometry": ["Line geometry is required."]})

  return {
    "start": parse_flowing_line_point(value.get("start"), "lineGeometry.start"),
    "end": parse_flowing_line_point(value.get("end"), "lineGeometry.end"),
  }


def parse_flowing_line_point(value: Any, key: str) -> dict[str, float]:
  if not isinstance(value, dict):
    raise ValidationError({key: ["Line point must be an object."]})

  x_pct = parse_percent_float(value.get("xPct"), f"{key}.xPct")
  y_pct = parse_percent_float(value.get("yPct"), f"{key}.yPct")
  return {"xPct": x_pct, "yPct": y_pct}


def parse_percent_float(value: Any, key: str) -> float:
  parsed = parse_decimal(value, key)
  if parsed < 0 or parsed > 100:
    raise ValidationError({key: ["Must be between 0 and 100."]})
  return float(parsed)


def parse_positive_integer(value: Any, key: str) -> int:
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    raise ValidationError({key: ["Must be a positive integer."]})

  if parsed < 1:
    raise ValidationError({key: ["Must be a positive integer."]})
  return parsed


def parse_flowing_counts(value: Any) -> list[FlowingLineCount]:
  if not isinstance(value, dict):
    raise ValidationError({"counts": ["Counts must be an object keyed by direction."]})

  count_records = []
  errors = {}

  for direction in ("ab", "ba"):
    direction_counts = value.get(direction)
    if not isinstance(direction_counts, dict):
      errors[f"counts.{direction}"] = ["Counts for this direction are required."]
      continue

    for age_group in FLOWING_AGE_GROUP_VALUES:
      age_key = next(
        (candidate_key for candidate_key, candidate_value in FLOWING_AGE_GROUP_ALIASES.items()
         if candidate_value == age_group and candidate_key in direction_counts),
        "",
      )
      age_counts = direction_counts.get(age_key) if age_key else None

      if not isinstance(age_counts, dict):
        errors[f"counts.{direction}.{age_group}"] = ["Age-group counts must be an object."]
        continue

      for gender in ("male", "female"):
        try:
          count_value = parse_non_negative_integer(age_counts.get(gender, 0), f"counts.{direction}.{age_group}.{gender}")
        except ValidationError as exc:
          if hasattr(exc, "message_dict"):
            errors.update(exc.message_dict)
          else:
            errors[f"counts.{direction}.{age_key}.{gender}"] = exc.messages
          continue

        count_records.append(
          FlowingLineCount(
            direction=direction,
            age_group=age_group,
            gender=gender,
            count=count_value,
          )
        )

  if errors:
    raise ValidationError(errors)

  expected_count_records = len(ALLOWED_FLOWING_DIRECTIONS) * len(ALLOWED_AGE_GROUPS) * len(ALLOWED_GENDERS)
  if len(count_records) != expected_count_records:
    raise ValidationError({"counts": ["Counts must include every direction, age group, and gender."]})

  return count_records


def parse_non_negative_integer(value: Any, key: str) -> int:
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    raise ValidationError({key: ["Must be a non-negative integer."]})

  if parsed < 0:
    raise ValidationError({key: ["Must be a non-negative integer."]})
  return parsed


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


def serialize_large_group_record(record: LargeGroupRecord) -> dict[str, Any]:
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
    "recordType": "largeGroup",
    "createdAt": isoformat_utc(record.created_at),
    "buildingId": record.building_id,
    "floorId": record.floor_id,
    "activityType": "Large Group",
    "actorId": record.actor_id,
    "gender": record.gender_composition or None,
    "genderComposition": record.gender_composition or None,
    "ethnicGroup": None,
    "ageGroup": record.age_composition or None,
    "ageComposition": record.age_composition or None,
    "facialExpression": None,
    "sizeBand": record.size_band,
    "activityDescription": record.activity_description,
    "activityTime": isoformat_utc(record.activity_time),
    "notes": record.notes,
    "location": location,
    "photoName": record.photo_name or None,
    "photoObjectName": record.photo_object_name or None,
    "photoUrl": build_image_object_url(record.photo_object_name),
    "photoPreview": record.photo_preview_data_url or None,
    "photoLocation": photo_location,
  }


def serialize_flowing_line_record(record: FlowingLineRecord) -> dict[str, Any]:
  counts = {
    "ab": {age_group: {"male": 0, "female": 0} for age_group in FLOWING_AGE_GROUP_VALUES},
    "ba": {age_group: {"male": 0, "female": 0} for age_group in FLOWING_AGE_GROUP_VALUES},
  }

  for count_record in record.counts.all():
    if count_record.direction not in counts:
      continue
    if count_record.age_group not in counts[count_record.direction]:
      counts[count_record.direction][count_record.age_group] = {"male": 0, "female": 0}
    counts[count_record.direction][count_record.age_group][count_record.gender] = count_record.count

  return {
    "id": str(record.id),
    "createdAt": isoformat_utc(record.created_at),
    "buildingId": record.building_id,
    "floorId": record.floor_id,
    "lineGeometry": record.line_geometry,
    "directionDurationSeconds": record.direction_duration_seconds,
    "startedAt": isoformat_utc(record.started_at),
    "completedAt": isoformat_utc(record.completed_at),
    "notes": record.notes,
    "counts": counts,
  }


def serialize_myhub_pin(pin: MyHubConceptPin) -> dict[str, Any]:
  return {
    "id": str(pin.id),
    "createdAt": isoformat_utc(pin.created_at),
    "buildingId": pin.building_id,
    "buildingLabel": pin.building_label,
    "floorId": pin.floor_id,
    "floorLabel": pin.floor_label,
    "recordId": str(pin.activity_record_id) if pin.activity_record_id else None,
    "questionnaireResponseId": str(pin.questionnaire_response_id) if pin.questionnaire_response_id else None,
    "actorId": pin.actor_id or None,
    "postcode": pin.respondent_postcode or None,
    "categoryKey": pin.category_key,
    "categoryLabel": pin.category_label,
    "color": pin.category_color,
    "deviceIp": pin.device_ip,
    "xPct": float(pin.location_x_pct),
    "yPct": float(pin.location_y_pct),
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


def serialize_person_questionnaire_response(response: PersonQuestionnaireResponse) -> dict[str, Any]:
  activity_record = response.activity_record
  return {
    "id": str(response.id),
    "createdAt": isoformat_utc(response.created_at),
    "questionnaireTime": isoformat_utc(response.questionnaire_time),
    "recordId": str(response.activity_record_id),
    "actorId": response.actor_id or activity_record.actor_id,
    "buildingId": activity_record.building_id,
    "floorId": activity_record.floor_id,
    "responses": {
      "mainPurpose": response.main_purpose,
      "postcode": response.postcode,
      "visitFrequency": response.visit_frequency,
      "stayDuration": response.stay_duration,
      "overallRating": response.overall_rating,
      "socialInteraction": response.social_interaction,
      "wantsToMapHub": response.wants_to_map_hub,
      "hubSpecificResponses": response.hub_specific_responses or {},
    },
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
