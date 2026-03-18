from django.apps import AppConfig


class CollectorConfig(AppConfig):
  default_auto_field = "django.db.models.BigAutoField"
  name = "collector"

  def ready(self) -> None:
    from .signals import register_signal_handlers

    register_signal_handlers(self)
