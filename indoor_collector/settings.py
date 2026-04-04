import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool) -> bool:
  value = os.getenv(name)
  if value is None:
    return default
  return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str) -> list[str]:
  raw = os.getenv(name, default)
  return [item.strip() for item in raw.split(",") if item.strip()]


def env_str(name: str, default: str) -> str:
  value = os.getenv(name)
  if value is None:
    return default
  return value.strip()


def env_int(name: str, default: int) -> int:
  value = os.getenv(name)
  if value is None:
    return default

  stripped = value.strip()
  if not stripped:
    return default

  return int(stripped)


def env_optional_int(name: str) -> int | None:
  value = os.getenv(name)
  if value is None:
    return None

  stripped = value.strip()
  if not stripped:
    return None

  return int(stripped)


def build_db_options() -> dict[str, str]:
  options: dict[str, str] = {}

  sslmode = env_str("DJANGO_DB_SSLMODE", "")
  if sslmode:
    options["sslmode"] = sslmode

  sslrootcert = env_str("DJANGO_DB_SSLROOTCERT", "")
  if sslrootcert:
    options["sslrootcert"] = sslrootcert

  connect_timeout = env_str("DJANGO_DB_CONNECT_TIMEOUT", "")
  if connect_timeout:
    options["connect_timeout"] = connect_timeout

  return options


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "change-me-in-production")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.azurewebsites.net")
CSRF_TRUSTED_ORIGINS = env_list(
  "DJANGO_CSRF_TRUSTED_ORIGINS",
  "http://localhost,http://127.0.0.1,https://*.azurewebsites.net",
)

INSTALLED_APPS = [
  "django.contrib.admin",
  "django.contrib.auth",
  "django.contrib.contenttypes",
  "django.contrib.sessions",
  "django.contrib.messages",
  "django.contrib.staticfiles",
  "collector",
]

MIDDLEWARE = [
  "django.middleware.security.SecurityMiddleware",
  "django.contrib.sessions.middleware.SessionMiddleware",
  "django.middleware.common.CommonMiddleware",
  "django.middleware.csrf.CsrfViewMiddleware",
  "django.contrib.auth.middleware.AuthenticationMiddleware",
  "django.contrib.messages.middleware.MessageMiddleware",
  "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "indoor_collector.urls"

TEMPLATES = [
  {
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {
      "context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
      ],
    },
  }
]

WSGI_APPLICATION = "indoor_collector.wsgi.application"
ASGI_APPLICATION = "indoor_collector.asgi.application"

DB_ENGINE = env_str("DJANGO_DB_ENGINE", "sqlite").lower()
if DB_ENGINE in {"postgres", "postgresql", "django.db.backends.postgresql"}:
  db_options = build_db_options()
  DATABASES = {
    "default": {
      "ENGINE": "django.db.backends.postgresql",
      "NAME": env_str("DJANGO_DB_NAME", "indoor_activities"),
      "USER": env_str("DJANGO_DB_USER", "postgres"),
      "PASSWORD": env_str("DJANGO_DB_PASSWORD", ""),
      "HOST": env_str("DJANGO_DB_HOST", "127.0.0.1"),
      "PORT": env_str("DJANGO_DB_PORT", "5432"),
      **({"OPTIONS": db_options} if db_options else {}),
    }
  }
else:
  DATABASES = {
    "default": {
      "ENGINE": "django.db.backends.sqlite3",
      "NAME": Path(env_str("DJANGO_DB_NAME", str(BASE_DIR / "db.sqlite3"))),
    }
  }

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "collector" / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = env_str("DJANGO_MEDIA_URL", "/media/")
MEDIA_ROOT = Path(env_str("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media")))
OBJECT_STORAGE_PREFIX = env_str("DJANGO_OBJECT_STORAGE_PREFIX", "objects")
OBJECT_STORAGE_BACKEND = env_str("DJANGO_OBJECT_STORAGE_BACKEND", "django.core.files.storage.FileSystemStorage")
AZURE_CONNECTION_STRING = env_str("AZURE_CONNECTION_STRING", "")
AZURE_ACCOUNT_NAME = env_str("AZURE_ACCOUNT_NAME", "")
AZURE_ACCOUNT_KEY = env_str("AZURE_ACCOUNT_KEY", "")
AZURE_CONTAINER = env_str("AZURE_CONTAINER", "")
AZURE_SAS_TOKEN = env_str("AZURE_SAS_TOKEN", "")
AZURE_CUSTOM_DOMAIN = env_str("AZURE_CUSTOM_DOMAIN", "")
AZURE_ENDPOINT_SUFFIX = env_str("AZURE_ENDPOINT_SUFFIX", "core.windows.net")
AZURE_LOCATION = env_str("AZURE_LOCATION", "")
AZURE_CACHE_CONTROL = env_str("AZURE_CACHE_CONTROL", "")
AZURE_SSL = env_bool("AZURE_SSL", True)
AZURE_OVERWRITE_FILES = env_bool("AZURE_OVERWRITE_FILES", False)
AZURE_USE_MANAGED_IDENTITY = env_bool("AZURE_USE_MANAGED_IDENTITY", False)
AZURE_MANAGED_IDENTITY_CLIENT_ID = env_str("AZURE_MANAGED_IDENTITY_CLIENT_ID", "")
AZURE_UPLOAD_MAX_CONN = env_int("AZURE_UPLOAD_MAX_CONN", 2)
AZURE_CONNECTION_TIMEOUT_SECS = env_int("AZURE_CONNECTION_TIMEOUT_SECS", 20)
AZURE_BLOB_MAX_MEMORY_SIZE = env_int("AZURE_BLOB_MAX_MEMORY_SIZE", 2 * 1024 * 1024)
AZURE_URL_EXPIRATION_SECS = env_optional_int("AZURE_URL_EXPIRATION_SECS")
MANAGEMENT_ACCESS_ENABLED = env_bool("DJANGO_MANAGEMENT_ACCESS_ENABLED", False)
MANAGEMENT_ACCESS_CODE = env_str("DJANGO_MANAGEMENT_ACCESS_CODE", "")
MANAGEMENT_ACCESS_SESSION_AGE_SECS = env_int("DJANGO_MANAGEMENT_ACCESS_SESSION_AGE_SECS", 4 * 60 * 60)
DEFAULT_STORAGE_OPTIONS = {}
if OBJECT_STORAGE_BACKEND == "django.core.files.storage.FileSystemStorage":
  DEFAULT_STORAGE_OPTIONS = {
    "location": str(MEDIA_ROOT),
    "base_url": MEDIA_URL,
  }
elif OBJECT_STORAGE_BACKEND == "storages.backends.azure_storage.AzureStorage":
  if not AZURE_CONTAINER:
    raise ImproperlyConfigured(
      "AZURE_CONTAINER is required when DJANGO_OBJECT_STORAGE_BACKEND uses AzureStorage."
    )

  DEFAULT_STORAGE_OPTIONS = {
    "azure_container": AZURE_CONTAINER,
    "azure_ssl": AZURE_SSL,
    "upload_max_conn": AZURE_UPLOAD_MAX_CONN,
    "timeout": AZURE_CONNECTION_TIMEOUT_SECS,
    "max_memory_size": AZURE_BLOB_MAX_MEMORY_SIZE,
    "overwrite_files": AZURE_OVERWRITE_FILES,
  }

  if AZURE_CONNECTION_STRING:
    DEFAULT_STORAGE_OPTIONS["connection_string"] = AZURE_CONNECTION_STRING
  elif AZURE_ACCOUNT_NAME and AZURE_ACCOUNT_KEY:
    DEFAULT_STORAGE_OPTIONS["account_name"] = AZURE_ACCOUNT_NAME
    DEFAULT_STORAGE_OPTIONS["account_key"] = AZURE_ACCOUNT_KEY
  elif AZURE_USE_MANAGED_IDENTITY and AZURE_ACCOUNT_NAME:
    try:
      from azure.identity import DefaultAzureCredential
    except ImportError as exc:
      raise ImproperlyConfigured(
        "azure-identity must be installed when AZURE_USE_MANAGED_IDENTITY=True."
      ) from exc

    credential_options = {}
    if AZURE_MANAGED_IDENTITY_CLIENT_ID:
      credential_options["managed_identity_client_id"] = AZURE_MANAGED_IDENTITY_CLIENT_ID

    DEFAULT_STORAGE_OPTIONS["account_name"] = AZURE_ACCOUNT_NAME
    DEFAULT_STORAGE_OPTIONS["token_credential"] = DefaultAzureCredential(**credential_options)
  elif AZURE_SAS_TOKEN and AZURE_ACCOUNT_NAME:
    DEFAULT_STORAGE_OPTIONS["account_name"] = AZURE_ACCOUNT_NAME
    DEFAULT_STORAGE_OPTIONS["sas_token"] = AZURE_SAS_TOKEN
  else:
    raise ImproperlyConfigured(
      "AzureStorage requires AZURE_CONNECTION_STRING, AZURE_ACCOUNT_NAME/AZURE_ACCOUNT_KEY, "
      "AZURE_SAS_TOKEN with AZURE_ACCOUNT_NAME, or AZURE_USE_MANAGED_IDENTITY=True with AZURE_ACCOUNT_NAME."
    )

  if AZURE_CUSTOM_DOMAIN:
    DEFAULT_STORAGE_OPTIONS["custom_domain"] = AZURE_CUSTOM_DOMAIN
  if AZURE_ENDPOINT_SUFFIX:
    DEFAULT_STORAGE_OPTIONS["endpoint_suffix"] = AZURE_ENDPOINT_SUFFIX
  if AZURE_LOCATION:
    DEFAULT_STORAGE_OPTIONS["location"] = AZURE_LOCATION
  if AZURE_CACHE_CONTROL:
    DEFAULT_STORAGE_OPTIONS["cache_control"] = AZURE_CACHE_CONTROL
  if AZURE_URL_EXPIRATION_SECS is not None:
    DEFAULT_STORAGE_OPTIONS["expiration_secs"] = AZURE_URL_EXPIRATION_SECS

STORAGES = {
  "default": {
    "BACKEND": OBJECT_STORAGE_BACKEND,
    **({"OPTIONS": DEFAULT_STORAGE_OPTIONS} if DEFAULT_STORAGE_OPTIONS else {}),
  },
  "staticfiles": {
    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
  },
}

ASSETS_DIR = BASE_DIR / "assets"
SYNC_BUILDINGS_ON_MIGRATE = env_bool("DJANGO_SYNC_BUILDINGS_ON_MIGRATE", True)

# Azure App Service terminates TLS at the front door and forwards protocol via header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", not DEBUG)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
