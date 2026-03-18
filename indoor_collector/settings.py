import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


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

ASSETS_DIR = BASE_DIR / "assets"
SYNC_BUILDINGS_ON_MIGRATE = env_bool("DJANGO_SYNC_BUILDINGS_ON_MIGRATE", True)

# Azure App Service terminates TLS at the front door and forwards protocol via header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", not DEBUG)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
