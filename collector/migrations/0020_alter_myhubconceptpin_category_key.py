from django.db import migrations, models


class Migration(migrations.Migration):

  dependencies = [
    ("collector", "0019_pin_user_info"),
  ]

  operations = [
    migrations.AlterField(
      model_name="myhubconceptpin",
      name="category_key",
      field=models.CharField(
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
          ("open_idea", "Open idea"),
        ],
        db_index=True,
        max_length=64,
      ),
    ),
  ]
