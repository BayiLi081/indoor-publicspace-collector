from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0015_personquestionnaireresponse_hub_specific_responses"),
  ]

  operations = [
    migrations.CreateModel(
      name="MyHubConceptPin",
      fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("building_id", models.CharField(db_index=True, max_length=128)),
        ("building_label", models.CharField(blank=True, default="", max_length=255)),
        ("floor_id", models.CharField(db_index=True, max_length=128)),
        ("floor_label", models.CharField(blank=True, default="", max_length=255)),
        (
          "category_key",
          models.CharField(
            choices=[
              ("tables", "Tables"),
              ("benches", "Benches"),
              ("soft_seating_corners", "Soft seating corners"),
              ("courtyards", "Courtyards"),
              ("atriums", "Atriums"),
              ("activity_rooms", "Activity rooms"),
              ("childrens_play_areas", "Children's play areas"),
              ("reading_corners", "Reading corners"),
              ("planting_areas", "Planting areas"),
              ("event_spaces", "Event spaces"),
              ("exercise_areas", "Exercise areas"),
              ("makerspaces", "Makerspaces"),
            ],
            db_index=True,
            max_length=64,
          ),
        ),
        ("category_label", models.CharField(max_length=128)),
        ("category_color", models.CharField(max_length=16)),
        ("location_x_pct", models.DecimalField(decimal_places=2, max_digits=6)),
        ("location_y_pct", models.DecimalField(decimal_places=2, max_digits=6)),
      ],
      options={
        "ordering": ["-created_at"],
      },
    ),
    migrations.AddIndex(
      model_name="myhubconceptpin",
      index=models.Index(fields=["building_id", "floor_id", "category_key"], name="collector_m_buildin_3a0ae7_idx"),
    ),
  ]
