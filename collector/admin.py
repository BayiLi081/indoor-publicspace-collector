from django.contrib import admin

from .models import ActivityRecord, PersonQuestionnaireResponse


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


@admin.register(PersonQuestionnaireResponse)
class PersonQuestionnaireResponseAdmin(admin.ModelAdmin):
  list_display = (
    "questionnaire_time",
    "actor_id",
    "main_purpose",
    "visit_frequency",
    "stay_duration",
    "overall_rating",
    "social_interaction",
    "created_at",
  )
  list_filter = ("main_purpose", "visit_frequency", "stay_duration", "overall_rating", "social_interaction")
  search_fields = ("actor_id", "activity_record__actor_id")
  ordering = ("-questionnaire_time",)
