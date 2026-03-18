from django.db import migrations, models


class Migration(migrations.Migration):
  dependencies = [
    ("collector", "0003_activityrecord_gender_age_group"),
  ]

  operations = [
    migrations.AlterField(
      model_name="activityrecord",
      name="activity_type",
      field=models.CharField(max_length=255),
    ),
  ]
