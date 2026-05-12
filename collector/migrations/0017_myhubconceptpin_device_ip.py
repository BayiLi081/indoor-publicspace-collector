from django.db import migrations, models


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0016_myhubconceptpin"),
  ]

  operations = [
    migrations.AddField(
      model_name="myhubconceptpin",
      name="device_ip",
      field=models.GenericIPAddressField(blank=True, db_index=True, null=True),
    ),
  ]
