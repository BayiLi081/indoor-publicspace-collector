from django.db import migrations, models


class Migration(migrations.Migration):
  dependencies = [
    ("collector", "0002_activityrecord_photo_preview_data_url"),
  ]

  operations = [
    migrations.AddField(
      model_name="activityrecord",
      name="gender",
      field=models.CharField(blank=True, default="", max_length=16),
    ),
    migrations.AddField(
      model_name="activityrecord",
      name="age_group",
      field=models.CharField(blank=True, default="", max_length=32),
    ),
  ]
