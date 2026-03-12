from django.db import migrations, models


class Migration(migrations.Migration):
  dependencies = [
    ("collector", "0001_initial"),
  ]

  operations = [
    migrations.AddField(
      model_name="activityrecord",
      name="photo_preview_data_url",
      field=models.TextField(blank=True),
    ),
  ]
