import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
  initial = True

  dependencies = []

  operations = [
    migrations.CreateModel(
      name="ActivityRecord",
      fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("building_id", models.CharField(db_index=True, max_length=128)),
        ("floor_id", models.CharField(db_index=True, max_length=128)),
        ("activity_type", models.CharField(max_length=64)),
        ("actor_id", models.CharField(blank=True, max_length=128)),
        ("activity_time", models.DateTimeField(db_index=True)),
        ("notes", models.TextField(blank=True)),
        ("location_x_pct", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
        ("location_y_pct", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
        ("photo_name", models.CharField(blank=True, max_length=255)),
        ("photo_latitude", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
        ("photo_longitude", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
        ("photo_altitude", models.DecimalField(blank=True, decimal_places=2, max_digits=9, null=True)),
      ],
      options={"ordering": ["-activity_time", "-created_at"]},
    ),
  ]
