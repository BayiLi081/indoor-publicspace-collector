import json
import logging

from django.db import connections, transaction
from django.utils import timezone

from .building_catalog import ROOT_BUILDING_ID, discover_building_maps
from .models import Building

logger = logging.getLogger(__name__)


def sync_buildings_from_assets(using: str = "default") -> dict[str, int]:
  connection = connections[using]
  table_name = Building._meta.db_table
  available_tables = set(connection.introspection.table_names())
  if table_name not in available_tables:
    logger.info("Skipping building sync for database '%s': table '%s' does not exist.", using, table_name)
    return {"created": 0, "updated": 0, "skipped": 0}

  discovered = discover_building_maps()
  building_rows = build_building_rows(discovered)

  created_count = 0
  updated_count = 0
  skipped_count = 0

  with transaction.atomic(using=using):
    existing_rows = {}
    for building in Building.objects.using(using).all().order_by("id"):
      existing_rows.setdefault(building.name, building)

    for row in building_rows:
      existing = existing_rows.get(row["name"])
      if existing is None:
        Building.objects.using(using).create(**row)
        created_count += 1
        continue

      update_fields = []
      if existing.floors != row["floors"]:
        existing.floors = row["floors"]
        update_fields.append("floors")

      # Preserve manually maintained addresses once they are set.
      if not (existing.address or "").strip() and row["address"]:
        existing.address = row["address"]
        update_fields.append("address")

      if update_fields:
        existing.save(update_fields=update_fields)
        updated_count += 1
      else:
        skipped_count += 1

  logger.info(
    "Building sync complete for database '%s': %s created, %s updated, %s unchanged.",
    using,
    created_count,
    updated_count,
    skipped_count,
  )
  return {"created": created_count, "updated": updated_count, "skipped": skipped_count}


def build_building_rows(discovered: dict[str, object]) -> list[dict[str, object]]:
  rows: list[dict[str, object]] = []
  now = timezone.now()

  for building_id, building in discovered.items():
    if building_id == ROOT_BUILDING_ID or not isinstance(building, dict):
      continue

    floors = building.get("floors")
    if not isinstance(floors, dict) or not floors:
      continue

    rows.append(
      {
        "name": str(building_id),
        "address": normalize_address(building.get("address")),
        "floors": serialize_floors(floors),
        "created_at": now,
      }
    )

  return rows


def normalize_address(value: object) -> str:
  if isinstance(value, str):
    return value.strip()
  return ""


def serialize_floors(floors: dict[str, object]) -> str:
  serialized = []
  for floor_id, floor in floors.items():
    if not isinstance(floor, dict):
      continue

    serialized.append(
      {
        "id": str(floor_id),
        "label": str(floor.get("label", "")).strip(),
        "mapSrc": str(floor.get("mapSrc", "")).strip(),
      }
    )

  return json.dumps(serialized, ensure_ascii=True, separators=(",", ":"))
