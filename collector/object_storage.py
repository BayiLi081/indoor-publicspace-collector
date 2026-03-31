import mimetypes
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import UploadedFile
from django.utils import timezone

ALLOWED_IMAGE_CONTENT_TYPES = {
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
}
DEFAULT_EXTENSION_BY_CONTENT_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
}
MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024


def save_uploaded_image_object(uploaded_file: UploadedFile, category: str) -> str:
  validate_uploaded_image(uploaded_file)

  date_prefix = timezone.now().strftime("%Y/%m/%d")
  safe_category = normalize_category_name(category)
  extension = guess_image_extension(uploaded_file)
  object_name = (
    f"{settings.OBJECT_STORAGE_PREFIX.rstrip('/')}/{safe_category}/{date_prefix}/{uuid.uuid4().hex}{extension}"
  )

  return default_storage.save(object_name, uploaded_file)


def build_image_object_url(object_name: str) -> str | None:
  normalized_name = str(object_name or "").strip()
  if not normalized_name:
    return None

  try:
    return default_storage.url(normalized_name)
  except Exception:
    return None


def delete_image_object(object_name: str) -> None:
  normalized_name = str(object_name or "").strip()
  if not normalized_name:
    return

  try:
    if default_storage.exists(normalized_name):
      default_storage.delete(normalized_name)
  except Exception:
    return


def validate_uploaded_image(uploaded_file: UploadedFile) -> None:
  if not isinstance(uploaded_file, UploadedFile):
    raise ValidationError({"photo": ["Upload a valid image file."]})

  if uploaded_file.size and uploaded_file.size > MAX_IMAGE_UPLOAD_BYTES:
    raise ValidationError({"photo": [f"Image exceeds max size of {MAX_IMAGE_UPLOAD_BYTES} bytes."]})

  content_type = (uploaded_file.content_type or "").strip().lower()
  if content_type and content_type not in ALLOWED_IMAGE_CONTENT_TYPES and not content_type.startswith("image/"):
    raise ValidationError({"photo": ["Only image uploads are supported."]})

  extension = Path(uploaded_file.name or "").suffix.lower()
  if not extension and not content_type:
    raise ValidationError({"photo": ["Uploaded image must have a filename or content type."]})


def normalize_category_name(value: str) -> str:
  cleaned = re.sub(r"[^a-z0-9/_-]+", "-", str(value or "").strip().lower())
  cleaned = cleaned.strip("/-")
  return cleaned or "uploads"


def guess_image_extension(uploaded_file: UploadedFile) -> str:
  extension = Path(uploaded_file.name or "").suffix.lower()
  if extension:
    return extension

  content_type = (uploaded_file.content_type or "").strip().lower()
  if content_type in DEFAULT_EXTENSION_BY_CONTENT_TYPE:
    return DEFAULT_EXTENSION_BY_CONTENT_TYPE[content_type]

  guessed_extension = mimetypes.guess_extension(content_type) if content_type else ""
  return guessed_extension or ".bin"
