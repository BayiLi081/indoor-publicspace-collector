import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class ActivityRecord(models.Model):
  id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
  created_at = models.DateTimeField(auto_now_add=True)
  building_id = models.CharField(max_length=128, db_index=True)
  floor_id = models.CharField(max_length=128, db_index=True)
  activity_type = models.CharField(max_length=255)
  actor_id = models.CharField(max_length=128, blank=True)
  gender = models.CharField(max_length=16, blank=True, default="")
  age_group = models.CharField(max_length=32, blank=True, default="")
  activity_time = models.DateTimeField(db_index=True)
  notes = models.TextField(blank=True)

  location_x_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
  location_y_pct = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

  photo_name = models.CharField(max_length=255, blank=True)
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
