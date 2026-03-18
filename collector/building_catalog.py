import json
import re
from pathlib import Path
from typing import Any

from django.conf import settings

from .floorplan_svg import convert_jpg_floorplan_to_svg, should_regenerate_jpg_wrapper

ROOT_BUILDING_ID = "__root__"
MAP_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
MAP_EXTENSION_PRIORITY = {
  ".svg": 0,
  ".png": 1,
  ".webp": 2,
  ".jpg": 3,
  ".jpeg": 4,
}


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
        "address": "",
        "floors": floors,
      }

  root_floors = extract_floor_maps(assets_dir)
  if root_floors:
    buildings[ROOT_BUILDING_ID] = {
      "label": "Shared Maps" if directories else "Main Building",
      "address": "",
      "floors": root_floors,
    }

  return buildings


def extract_floor_maps(folder: Path) -> dict[str, Any]:
  floors: dict[str, Any] = {}
  file_entries = sorted(
    [entry for entry in folder.iterdir() if entry.is_file() and entry.suffix.lower() in MAP_EXTENSIONS],
    key=lambda entry: (
      natural_sort_key(entry.stem),
      MAP_EXTENSION_PRIORITY.get(entry.suffix.lower(), 999),
      natural_sort_key(entry.name),
    ),
  )

  for file_entry in file_entries:
    floor_id = file_entry.stem
    if floor_id in floors:
      continue

    floor_map_path = resolve_floor_map_path(file_entry)
    relative_path = floor_map_path.relative_to(settings.ASSETS_DIR).as_posix()
    floors[floor_id] = {
      "label": format_floor_label(floor_id),
      "mapSrc": f"/assets/{relative_path}",
    }

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
      "address": "",
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
        "label": optional_text(floor.get("label"), format_floor_label(normalized_floor_id)),
        "mapSrc": normalize_map_src(map_src),
      }

    if not floors:
      continue

    normalized_building_id = str(building_id)
    normalized[normalized_building_id] = {
      "label": optional_text(building.get("label"), format_building_label(normalized_building_id)),
      "address": optional_text(building.get("address"), ""),
      "floors": floors,
    }

  return normalized


def optional_text(value: Any, default: str) -> str:
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
