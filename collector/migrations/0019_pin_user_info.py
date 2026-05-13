from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0018_questionnaire_postcode_myhub_linkage"),
  ]

  operations = [
    migrations.CreateModel(
      name="PinUserInfo",
      fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("gender", models.CharField(choices=[("male", "Male"), ("female", "Female"), ("other", "Other")], max_length=16)),
        (
          "ethnic_group",
          models.CharField(choices=[("chinese", "Chinese"), ("malay", "Malay"), ("indian", "Indian"), ("others", "Others")], max_length=32),
        ),
        (
          "age_group",
          models.CharField(
            choices=[("under_10", "<10 years old"), ("10_20", "10-20 years old"), ("20_60", "20-60 years old"), ("over_60", ">60 years old")],
            max_length=32,
          ),
        ),
        (
          "housing_type",
          models.CharField(
            choices=[
              ("hdb_1_2_room", "1 or 2 room HDB flat"),
              ("hdb_3_room", "3 room HDB flat"),
              ("hdb_4_room", "4 room HDB flat"),
              ("hdb_5_room", "5 room HDB flat"),
              ("private_condo_apartment", "Private condo/ apartment"),
              ("private_landed", "Private landed housing"),
              ("other", "Other"),
            ],
            max_length=64,
          ),
        ),
        ("housing_type_other", models.CharField(blank=True, default="", max_length=255)),
        ("tenure_status", models.CharField(choices=[("tenant", "Tenant"), ("owner", "Owner")], max_length=16)),
      ],
      options={
        "db_table": "pin_user_info",
        "ordering": ["-created_at"],
      },
    ),
    migrations.AddField(
      model_name="myhubconceptpin",
      name="pin_user_info",
      field=models.ForeignKey(
        blank=True,
        null=True,
        on_delete=django.db.models.deletion.SET_NULL,
        related_name="myhub_pins",
        to="collector.pinuserinfo",
      ),
    ),
  ]
