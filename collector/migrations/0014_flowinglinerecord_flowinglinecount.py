import uuid

import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0013_largegrouprecord"),
  ]

  operations = [
    migrations.CreateModel(
      name="FlowingLineRecord",
      fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("building_id", models.CharField(db_index=True, max_length=128)),
        ("floor_id", models.CharField(db_index=True, max_length=128)),
        ("line_geometry", models.JSONField()),
        ("direction_duration_seconds", models.PositiveSmallIntegerField(default=300)),
        ("started_at", models.DateTimeField(db_index=True, default=timezone.now)),
        ("completed_at", models.DateTimeField(blank=True, null=True)),
        ("notes", models.TextField(blank=True)),
      ],
      options={
        "ordering": ["-started_at", "-created_at"],
      },
    ),
    migrations.CreateModel(
      name="FlowingLineCount",
      fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        (
          "direction",
          models.CharField(
            choices=[("ab", "A to B"), ("ba", "B to A")],
            db_index=True,
            max_length=2,
          ),
        ),
        ("age_group", models.CharField(db_index=True, max_length=32)),
        (
          "gender",
          models.CharField(
            choices=[("male", "Male"), ("female", "Female")],
            db_index=True,
            max_length=16,
          ),
        ),
        ("count", models.PositiveIntegerField(default=0)),
        (
          "flowing_line",
          models.ForeignKey(
            on_delete=django.db.models.deletion.CASCADE,
            related_name="counts",
            to="collector.flowinglinerecord",
          ),
        ),
      ],
      options={
        "ordering": ["direction", "age_group", "gender"],
      },
    ),
    migrations.AddConstraint(
      model_name="flowinglinecount",
      constraint=models.UniqueConstraint(
        fields=("flowing_line", "direction", "age_group", "gender"),
        name="unique_flowing_count_demographic",
      ),
    ),
  ]
