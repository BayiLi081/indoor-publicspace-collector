from django.contrib import admin

from .models import ActivityIdSequence, ActivityRecord, FlowingLineCount, FlowingLineRecord, PersonQuestionnaireResponse


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


class FlowingLineCountInline(admin.TabularInline):
  model = FlowingLineCount
  extra = 0
  readonly_fields = ("direction", "age_group", "gender", "count")
  can_delete = False


@admin.register(FlowingLineRecord)
class FlowingLineRecordAdmin(admin.ModelAdmin):
  list_display = (
    "started_at",
    "building_id",
    "floor_id",
    "direction_duration_seconds",
    "completed_at",
    "created_at",
  )
  list_filter = ("building_id", "floor_id", "started_at")
  search_fields = ("building_id", "floor_id", "notes")
  ordering = ("-started_at",)
  inlines = [FlowingLineCountInline]


@admin.register(ActivityIdSequence)
class ActivityIdSequenceAdmin(admin.ModelAdmin):
  list_display = ("key", "next_cluster_number", "updated_at")
  readonly_fields = ("updated_at",)
