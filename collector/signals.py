import logging

from django.conf import settings
from django.db.models.signals import post_migrate

from .building_sync import sync_buildings_from_assets

logger = logging.getLogger(__name__)


def register_signal_handlers(app_config) -> None:
  post_migrate.connect(
    sync_buildings_after_migrate,
    sender=app_config,
    dispatch_uid="collector.sync_buildings_after_migrate",
  )


def sync_buildings_after_migrate(sender, using, **kwargs) -> None:
  if not getattr(settings, "SYNC_BUILDINGS_ON_MIGRATE", True):
    logger.info("Skipping building sync because SYNC_BUILDINGS_ON_MIGRATE is disabled.")
    return

  sync_buildings_from_assets(using=using)
