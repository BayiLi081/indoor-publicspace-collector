from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0017_myhubconceptpin_device_ip"),
  ]

  operations = [
    migrations.AddField(
      model_name="personquestionnaireresponse",
      name="postcode",
      field=models.CharField(blank=True, db_index=True, default="", max_length=16),
    ),
    migrations.AddField(
      model_name="personquestionnaireresponse",
      name="wants_to_map_hub",
      field=models.BooleanField(default=False),
    ),
    migrations.AddField(
      model_name="myhubconceptpin",
      name="activity_record",
      field=models.ForeignKey(
        blank=True,
        null=True,
        on_delete=django.db.models.deletion.SET_NULL,
        related_name="myhub_concept_pins",
        to="collector.activityrecord",
      ),
    ),
    migrations.AddField(
      model_name="myhubconceptpin",
      name="actor_id",
      field=models.CharField(blank=True, db_index=True, default="", max_length=128),
    ),
    migrations.AddField(
      model_name="myhubconceptpin",
      name="questionnaire_response",
      field=models.ForeignKey(
        blank=True,
        null=True,
        on_delete=django.db.models.deletion.SET_NULL,
        related_name="myhub_concept_pins",
        to="collector.personquestionnaireresponse",
      ),
    ),
    migrations.AddField(
      model_name="myhubconceptpin",
      name="respondent_postcode",
      field=models.CharField(blank=True, db_index=True, default="", max_length=16),
    ),
  ]
