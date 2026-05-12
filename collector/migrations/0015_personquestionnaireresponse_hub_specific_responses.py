from django.db import migrations, models


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0014_flowinglinerecord_flowinglinecount"),
  ]

  operations = [
    migrations.AddField(
      model_name="personquestionnaireresponse",
      name="hub_specific_responses",
      field=models.JSONField(blank=True, default=dict),
    ),
  ]
