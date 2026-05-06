import hmac
from functools import wraps
from typing import Any
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, JsonResponse
from django.urls import reverse

MANAGEMENT_ACCESS_SESSION_KEY = "management_access_granted"
CAPTURE_ACCESS_SESSION_KEY = "capture_access_granted"
HTML_ACCEPT_MARKERS = ("text/html", "application/xhtml+xml")
SITE_ACCESS_EXEMPT_PREFIXES = (
  "/capture/login/",
  "/capture/logout/",
  "/management/login/",
  "/management/logout/",
  "/static/",
  "/media/",
  "/admin/",
  "/favicon.ico",
)


class SiteAccessCodeMiddleware:
  def __init__(self, get_response):
    self.get_response = get_response

  def __call__(self, request: HttpRequest) -> HttpResponse:
    if is_site_access_exempt_path(request.path):
      return self.get_response(request)

    if is_management_path(request.path):
      return self.get_response(request)

    denial_response = get_capture_access_denial_response(request)
    if denial_response is not None:
      return denial_response

    return self.get_response(request)


def management_access_required(view_func):
  @wraps(view_func)
  def wrapped(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
    denial_response = get_management_access_denial_response(request)
    if denial_response is not None:
      return denial_response
    return view_func(request, *args, **kwargs)

  return wrapped


def get_management_access_denial_response(request: HttpRequest) -> HttpResponse | None:
  if not getattr(settings, "MANAGEMENT_ACCESS_ENABLED", False):
    return None

  access_code = getattr(settings, "MANAGEMENT_ACCESS_CODE", "")
  if not access_code:
    return build_management_auth_response(
      request,
      status=503,
      error_message="Management access code is not configured.",
      include_login_url=False,
    )

  if request.session.get(MANAGEMENT_ACCESS_SESSION_KEY):
    return None

  return build_management_auth_response(
    request,
    status=401,
    error_message="Management access code required.",
    include_login_url=True,
  )


def grant_management_access(request: HttpRequest) -> None:
  request.session[MANAGEMENT_ACCESS_SESSION_KEY] = True
  request.session.set_expiry(getattr(settings, "MANAGEMENT_ACCESS_SESSION_AGE_SECS", 4 * 60 * 60))
  request.session.cycle_key()


def clear_management_access(request: HttpRequest) -> None:
  if MANAGEMENT_ACCESS_SESSION_KEY in request.session:
    del request.session[MANAGEMENT_ACCESS_SESSION_KEY]


def get_capture_access_denial_response(request: HttpRequest) -> HttpResponse | None:
  if not getattr(settings, "CAPTURE_ACCESS_ENABLED", False):
    return None

  access_code = getattr(settings, "CAPTURE_ACCESS_CODE", "")
  if not access_code:
    return build_capture_auth_response(
      request,
      status=503,
      error_message="Capture access code is not configured.",
      include_login_url=False,
    )

  if request.session.get(CAPTURE_ACCESS_SESSION_KEY):
    return None

  # Management-authenticated users can still use API endpoints required by management UI.
  if request.session.get(MANAGEMENT_ACCESS_SESSION_KEY):
    return None

  return build_capture_auth_response(
    request,
    status=401,
    error_message="Capture access code required.",
    include_login_url=True,
  )


def grant_capture_access(request: HttpRequest) -> None:
  request.session[CAPTURE_ACCESS_SESSION_KEY] = True
  request.session.set_expiry(getattr(settings, "CAPTURE_ACCESS_SESSION_AGE_SECS", 4 * 60 * 60))
  request.session.cycle_key()


def clear_capture_access(request: HttpRequest) -> None:
  if CAPTURE_ACCESS_SESSION_KEY in request.session:
    del request.session[CAPTURE_ACCESS_SESSION_KEY]


def validate_capture_access_code(candidate_code: str) -> bool:
  configured_code = getattr(settings, "CAPTURE_ACCESS_CODE", "")
  if not configured_code:
    return False
  return hmac.compare_digest(candidate_code, configured_code)


def validate_management_access_code(candidate_code: str) -> bool:
  configured_code = getattr(settings, "MANAGEMENT_ACCESS_CODE", "")
  if not configured_code:
    return False
  return hmac.compare_digest(candidate_code, configured_code)


def build_management_auth_response(
  request: HttpRequest,
  *,
  status: int,
  error_message: str,
  include_login_url: bool,
) -> HttpResponse:
  login_url = build_management_login_url(request)
  if status == 401 and include_login_url and expects_html_response(request):
    return HttpResponseRedirect(login_url)

  payload: dict[str, Any] = {"error": error_message}
  if include_login_url:
    payload["loginUrl"] = login_url
  return JsonResponse(payload, status=status)


def build_management_login_url(request: HttpRequest) -> str:
  next_path = request.get_full_path()
  query = urlencode({"next": next_path})
  return f"{reverse('management_login')}?{query}"


def build_capture_auth_response(
  request: HttpRequest,
  *,
  status: int,
  error_message: str,
  include_login_url: bool,
) -> HttpResponse:
  login_url = build_capture_login_url(request)
  if status == 401 and include_login_url and expects_html_response(request):
    return HttpResponseRedirect(login_url)

  payload: dict[str, Any] = {"error": error_message}
  if include_login_url:
    payload["loginUrl"] = login_url
  return JsonResponse(payload, status=status)


def build_capture_login_url(request: HttpRequest) -> str:
  next_path = request.get_full_path()
  query = urlencode({"next": next_path})
  return f"{reverse('capture_login')}?{query}"


def expects_html_response(request: HttpRequest) -> bool:
  accepted_types = request.headers.get("Accept", "")
  if any(marker in accepted_types for marker in HTML_ACCEPT_MARKERS):
    return True
  return request.path.startswith("/management/")


def is_site_access_exempt_path(path: str) -> bool:
  return any(path.startswith(prefix) for prefix in SITE_ACCESS_EXEMPT_PREFIXES)


def is_management_path(path: str) -> bool:
  return path.startswith("/management/")
