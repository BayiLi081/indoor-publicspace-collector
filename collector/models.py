import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

FLOWING_ALLOWED_AGE_GROUPS = {
  "<10 years old",
  "10-20 years old",
  "20-60 years old",
  ">60 years old",
}


class ActivityRecord(models.Model):
  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  building_id = models.CharField(max_length=128, db_index=True)
  floor_id = models.CharField(max_length=128, db_index=True)
  activity_type = models.CharField(max_length=255)
  actor_id = models.CharField(max_length=128, blank=True)
  gender = models.CharField(max_length=16, blank=True, default="")
  age_group = models.CharField(max_length=32, blank=True, default="")
  ethnic_group = models.CharField(max_length=50,blank=True, default="")
  facial_expression = models.CharField(max_length=16, blank=True, default="")
  activity_time = models.DateTimeField(db_index=True)
  notes = models.TextField(blank=True)

  location_x_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
  location_y_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

  photo_name = models.CharField(max_length=255, blank=True)
  photo_object_name = models.CharField(max_length=512, blank=True, default="")
  photo_preview_data_url = models.TextField(blank=True)
  photo_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_altitude = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)

  class Meta:
    ordering = ["-activity_time", "-created_at"]

  def clean(self) -> None:
    has_map_x = self.location_x_pct is not None
    has_map_y = self.location_y_pct is not None
    has_photo_lat = self.photo_latitude is not None
    has_photo_lng = self.photo_longitude is not None

    if has_map_x != has_map_y:
      raise ValidationError("Both map X and Y coordinates must be provided together.")

    if has_photo_lat != has_photo_lng:
      raise ValidationError("Both photo latitude and longitude must be provided together.")

    if not (has_map_x and has_map_y) and not (has_photo_lat and has_photo_lng):
      raise ValidationError("A map location or a photo GPS location is required.")

  def __str__(self) -> str:
    return f"{self.activity_type} @ {self.building_id}/{self.floor_id} ({self.activity_time.isoformat()})"


class ActivityIdSequence(models.Model):
  key = models.CharField(max_length=64, primary_key=True)
  next_cluster_number = models.PositiveIntegerField(default=1)
  updated_at = models.DateTimeField(auto_now=True)

  class Meta:
    verbose_name = "activity ID sequence"
    verbose_name_plural = "activity ID sequences"

  def __str__(self) -> str:
    return f"{self.key}: next CL{self.next_cluster_number:04d}"


class LargeGroupRecord(models.Model):
  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  building_id = models.CharField(max_length=128, db_index=True)
  floor_id = models.CharField(max_length=128, db_index=True)
  actor_id = models.CharField(max_length=128, blank=True)
  size_band = models.CharField(max_length=64)
  gender_composition = models.CharField(max_length=32)
  age_composition = models.CharField(max_length=64)
  activity_description = models.TextField()
  activity_time = models.DateTimeField(db_index=True)
  notes = models.TextField(blank=True)

  location_x_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
  location_y_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

  photo_name = models.CharField(max_length=255, blank=True)
  photo_object_name = models.CharField(max_length=512, blank=True, default="")
  photo_preview_data_url = models.TextField(blank=True)
  photo_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_altitude = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)

  class Meta:
    ordering = ["-activity_time", "-created_at"]

  def clean(self) -> None:
    has_map_x = self.location_x_pct is not None
    has_map_y = self.location_y_pct is not None
    has_photo_lat = self.photo_latitude is not None
    has_photo_lng = self.photo_longitude is not None

    if has_map_x != has_map_y:
      raise ValidationError("Both map X and Y coordinates must be provided together.")

    if has_photo_lat != has_photo_lng:
      raise ValidationError("Both photo latitude and longitude must be provided together.")

    if not (has_map_x and has_map_y) and not (has_photo_lat and has_photo_lng):
      raise ValidationError("A map location or a photo GPS location is required.")

  def __str__(self) -> str:
    return f"Large group {self.size_band} @ {self.building_id}/{self.floor_id} ({self.activity_time.isoformat()})"


class PersonQuestionnaireResponse(models.Model):
  MAIN_PURPOSE_CHOICES = (
    ("errand_transit", "Errand / transit (necessary)"),
    ("relaxing_passing_time", "Relaxing / passing time (optional)"),
    ("meeting_people_social", "Meeting people / social activity"),
  )
  VISIT_FREQUENCY_CHOICES = (
    ("daily", "Daily"),
    ("1_4_times_per_week", "1-4 times per week"),
    ("1_3_times_per_month", "1-3 times per month"),
    ("first_time", "First time"),
  )
  STAY_DURATION_CHOICES = (
    ("under_5_minutes", "<5 minutes"),
    ("5_20_minutes", "5-20 minutes"),
    ("20_60_minutes", "20-60 minutes"),
    ("over_60_minutes", ">60 minutes"),
  )
  SOCIAL_INTERACTION_CHOICES = (
    ("not_at_all", "Not at all"),
    ("slightly", "Slightly"),
    ("moderately", "Moderately"),
    ("yes", "Yes"),
    ("definitely", "Definitely"),
  )

  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  activity_record = models.ForeignKey(
    ActivityRecord,
    on_delete=models.CASCADE,
    related_name="questionnaire_responses",
  )
  actor_id = models.CharField(max_length=128, blank=True, db_index=True)
  questionnaire_time = models.DateTimeField(db_index=True, default=timezone.now)
  main_purpose = models.CharField(max_length=64, choices=MAIN_PURPOSE_CHOICES)
  visit_frequency = models.CharField(max_length=64, choices=VISIT_FREQUENCY_CHOICES)
  stay_duration = models.CharField(max_length=64, choices=STAY_DURATION_CHOICES)
  overall_rating = models.PositiveSmallIntegerField()
  social_interaction = models.CharField(max_length=64, choices=SOCIAL_INTERACTION_CHOICES)

  class Meta:
    ordering = ["-questionnaire_time", "-created_at"]

  def clean(self) -> None:
    if self.overall_rating is not None and not 1 <= self.overall_rating <= 5:
      raise ValidationError({"overallRating": ["Overall rating must be between 1 and 5."]})

  def __str__(self) -> str:
    return f"Questionnaire for {self.actor_id or self.activity_record_id} ({self.questionnaire_time.isoformat()})"


class SiteObservation(models.Model):
  OBSERVATION_TYPE_CHOICES = (
    ("photo", "Photo"),
    ("note", "Note"),
    ("questions", "Short Qs"),
  )

  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  building_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
  floor_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
  observation_type = models.CharField(max_length=16, choices=OBSERVATION_TYPE_CHOICES, db_index=True)
  observation_time = models.DateTimeField(db_index=True, default=timezone.now)
  note = models.TextField(blank=True)
  photo_name = models.CharField(max_length=255, blank=True)
  photo_object_name = models.CharField(max_length=512, blank=True, default="")
  photo_preview_data_url = models.TextField(blank=True)
  photo_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
  photo_altitude = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
  seating_availability = models.PositiveSmallIntegerField(null=True, blank=True)
  greenery_level = models.PositiveSmallIntegerField(null=True, blank=True)
  noise_level = models.PositiveSmallIntegerField(null=True, blank=True)
  cleanliness = models.PositiveSmallIntegerField(null=True, blank=True)

  class Meta:
    ordering = ["-observation_time", "-created_at"]

  def clean(self) -> None:
    has_note = bool((self.note or "").strip())
    has_photo_object = bool((self.photo_object_name or "").strip())
    has_photo_preview = bool((self.photo_preview_data_url or "").strip())
    has_photo_lat = self.photo_latitude is not None
    has_photo_lng = self.photo_longitude is not None
    question_fields = {
      "seating_availability": self.seating_availability,
      "greenery_level": self.greenery_level,
      "noise_level": self.noise_level,
      "cleanliness": self.cleanliness,
    }
    has_question_answers = any(value is not None for value in question_fields.values())

    if has_photo_lat != has_photo_lng:
      raise ValidationError("Both photo latitude and longitude must be provided together.")

    for field_name, value in question_fields.items():
      if value is not None and not 1 <= value <= 5:
        raise ValidationError({field_name: ["Answer must be between 1 and 5."]})

    if self.observation_type == "note" and not has_note:
      raise ValidationError({"note": ["A note is required for note observations."]})

    if self.observation_type == "photo" and not has_photo_preview and not has_photo_object:
      raise ValidationError({"photoObjectName": ["A stored image is required for photo observations."]})

    if self.observation_type == "questions":
      missing_fields = [field_name for field_name, value in question_fields.items() if value is None]
      if missing_fields:
        raise ValidationError({field_name: ["This short Q answer is required."] for field_name in missing_fields})
      if not (has_photo_lat and has_photo_lng):
        raise ValidationError({"photoLocation": ["Current device GPS is required for short Q observations."]})

    if not has_note and not has_photo_preview and not has_photo_object and not has_question_answers:
      raise ValidationError("A note, photo, or short Q answer is required.")

  def __str__(self) -> str:
    observation_label = self.observation_type.title()
    location_label = "/".join(part for part in [self.building_id, self.floor_id] if part) or "unassigned"
    return f"{observation_label} observation @ {location_label} ({self.observation_time.isoformat()})"


class FlowingLineRecord(models.Model):
  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  building_id = models.CharField(max_length=128, db_index=True)
  floor_id = models.CharField(max_length=128, db_index=True)
  line_geometry = models.JSONField()
  direction_duration_seconds = models.PositiveSmallIntegerField(default=300)
  started_at = models.DateTimeField(db_index=True, default=timezone.now)
  completed_at = models.DateTimeField(null=True, blank=True)
  notes = models.TextField(blank=True)

  class Meta:
    ordering = ["-started_at", "-created_at"]

  def clean(self) -> None:
    if not isinstance(self.line_geometry, dict):
      raise ValidationError({"line_geometry": ["Line geometry must be an object."]})

    for endpoint in ("start", "end"):
      point = self.line_geometry.get(endpoint)
      if not isinstance(point, dict):
        raise ValidationError({"line_geometry": [f"Line geometry must include {endpoint} point."]})

      for coordinate in ("xPct", "yPct"):
        value = point.get(coordinate)
        if not isinstance(value, (int, float)) or not 0 <= value <= 100:
          raise ValidationError({"line_geometry": [f"{endpoint}.{coordinate} must be between 0 and 100."]})

    if self.direction_duration_seconds < 1:
      raise ValidationError({"direction_duration_seconds": ["Duration must be at least 1 second."]})

  def __str__(self) -> str:
    return f"Flowing line {self.id} @ {self.building_id}/{self.floor_id} ({self.started_at.isoformat()})"


class FlowingLineCount(models.Model):
  DIRECTION_CHOICES = (
    ("ab", "A to B"),
    ("ba", "B to A"),
  )
  GENDER_CHOICES = (
    ("male", "Male"),
    ("female", "Female"),
  )

  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  flowing_line = models.ForeignKey(
    FlowingLineRecord,
    on_delete=models.CASCADE,
    related_name="counts",
  )
  direction = models.CharField(max_length=2, choices=DIRECTION_CHOICES, db_index=True)
  age_group = models.CharField(max_length=32, db_index=True)
  gender = models.CharField(max_length=16, choices=GENDER_CHOICES, db_index=True)
  count = models.PositiveIntegerField(default=0)

  class Meta:
    ordering = ["direction", "age_group", "gender"]
    constraints = [
      models.UniqueConstraint(
        fields=["flowing_line", "direction", "age_group", "gender"],
        name="unique_flowing_count_demographic",
      )
    ]

  def clean(self) -> None:
    if self.direction not in {"ab", "ba"}:
      raise ValidationError({"direction": ["Direction must be 'ab' or 'ba'."]})

    if self.gender not in {"male", "female"}:
      raise ValidationError({"gender": ["Gender must be 'male' or 'female'."]})

    if self.age_group not in FLOWING_ALLOWED_AGE_GROUPS:
      raise ValidationError({"age_group": ["Age group is invalid."]})

  def __str__(self) -> str:
    return f"{self.flowing_line_id} {self.direction} {self.age_group}/{self.gender}: {self.count}"


class Building(models.Model):
  id = models.AutoField(primary_key=True)
  name = models.TextField()
  address = models.TextField(blank=True, default="")
  floors = models.TextField(blank=True, default="")
  created_at = models.DateTimeField(default=timezone.now)

  class Meta:
    db_table = "buildings"
    managed = False
    ordering = ["name", "id"]

  def __str__(self) -> str:
    return self.name
