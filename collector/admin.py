from django.contrib import admin

from .models import ActivityRecord


@admin.register(ActivityRecord)
class ActivityRecordAdmin(admin.ModelAdmin):
  list_display = (
    "activity_time",
    "activity_type",
    "actor_id",
    "facial_expression",
    "building_id",
    "floor_id",
    "created_at",
  )
  list_filter = ("building_id", "floor_id", "activity_type", "facial_expression")
  search_fields = ("actor_id", "notes", "photo_name", "facial_expression")
  ordering = ("-activity_time",)
