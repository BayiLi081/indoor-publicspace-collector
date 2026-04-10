from django.db import migrations, models


class Migration(migrations.Migration):
  dependencies = [
    ("collector", "0007_activityrecord_photo_object_name_and_more"),
  ]

  operations = [
    migrations.AddField(
      model_name="activityrecord",
      name="facial_expression",
      field=models.CharField(blank=True, default="", max_length=16),
    ),
  ]
