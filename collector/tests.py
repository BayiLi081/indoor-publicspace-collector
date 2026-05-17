import json

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .management_auth import MANAGEMENT_ACCESS_SESSION_KEY
from .models import ActivityRecord, LargeGroupRecord, MyHubConceptPin, PersonQuestionnaireResponse


@override_settings(
  MANAGEMENT_ACCESS_ENABLED=True,
  MANAGEMENT_ACCESS_CODE="test-code",
  CAPTURE_ACCESS_ENABLED=False,
)
class AutoActorIdTests(TestCase):
  def create_record(self, actor_id: str) -> ActivityRecord:
    return ActivityRecord.objects.create(
      building_id="SUTD",
      floor_id="main-buildings",
      activity_type="Walking",
      actor_id=actor_id,
      gender="male",
      ethnic_group="Chinese",
      age_group="20-60 years old",
      facial_expression="happy",
      activity_time=timezone.now(),
      location_x_pct=10,
      location_y_pct=20,
    )

  def build_payload(self, actor_id: str, x_pct: int = 50, y_pct: int = 60) -> dict:
    return {
      "buildingId": "SUTD",
      "floorId": "main-buildings",
      "activityType": "Walking",
      "actorId": actor_id,
      "gender": "female",
      "ethnicGroup": "Malay",
      "ageGroup": "20-60 years old",
      "facialExpression": "no_expression",
      "activityTime": "2026-04-17T10:00:00Z",
      "location": {"xPct": x_pct, "yPct": y_pct},
    }

  def post_records(self, payload: dict) -> dict:
    response = self.client.post(
      reverse("api_records"),
      data=json.dumps(payload),
      content_type="application/json",
    )
    self.assertEqual(response.status_code, 201, response.content)
    return response.json()

  def grant_management_access(self) -> None:
    session = self.client.session
    session[MANAGEMENT_ACCESS_SESSION_KEY] = True
    session.save()

  def test_next_cluster_endpoint_is_session_scoped_without_management_session(self):
    self.create_record("CL0007-P002")

    response = self.client.get(reverse("api_records_next_cluster"))

    self.assertEqual(response.status_code, 200, response.content)
    self.assertEqual(response.json()["nextClusterNumber"], 1)
    self.assertEqual(response.json()["firstActorId"], "CL0001-P001")

  def test_next_cluster_endpoint_uses_database_with_management_session(self):
    self.create_record("CL0007-P002")
    self.grant_management_access()

    response = self.client.get(reverse("api_records_next_cluster"))

    self.assertEqual(response.status_code, 200, response.content)
    self.assertEqual(response.json()["nextClusterNumber"], 8)
    self.assertEqual(response.json()["firstActorId"], "CL0008-P001")

  def test_group_auto_actor_ids_are_reallocated_on_save(self):
    self.create_record("CL0007-P001")

    payload = {
      "records": [
        self.build_payload("CL0001-P001", 40, 50),
        self.build_payload("CL0001-P002", 60, 70),
      ]
    }
    data = self.post_records(payload)

    actor_ids = [record["actorId"] for record in data["records"]]
    self.assertEqual(actor_ids, ["CL0008-P001", "CL0008-P002"])
    self.assertEqual(self.client.get(reverse("api_records_next_cluster")).json()["nextClusterNumber"], 9)

  def test_individual_auto_actor_id_is_reallocated_on_save(self):
    self.create_record("CL0002-P001")

    data = self.post_records(self.build_payload("CL0001-P001"))

    self.assertEqual(data["record"]["actorId"], "CL0003-P001")

  def test_large_group_record_is_saved_in_dedicated_table(self):
    payload = {
      "largeGroupRecord": {
        "buildingId": "SUTD",
        "floorId": "main-buildings",
        "actorId": "CL0001-P001",
        "sizeBand": "20-50 people",
        "genderComposition": "half-half",
        "ageComposition": "all age group",
        "activityDescription": "Watching a performance",
        "activityTime": "2026-04-17T10:00:00Z",
        "location": {"xPct": 50, "yPct": 60},
      }
    }

    data = self.post_records(payload)

    self.assertEqual(ActivityRecord.objects.count(), 0)
    self.assertEqual(LargeGroupRecord.objects.count(), 1)
    large_group = LargeGroupRecord.objects.get()
    self.assertEqual(large_group.size_band, "20-50 people")
    self.assertEqual(large_group.gender_composition, "half-half")
    self.assertEqual(large_group.age_composition, "all age group")
    self.assertEqual(large_group.activity_description, "Watching a performance")
    self.assertEqual(data["record"]["recordType"], "largeGroup")
    self.assertEqual(data["record"]["sizeBand"], "20-50 people")

  def test_custom_actor_id_is_not_rewritten(self):
    data = self.post_records(self.build_payload("manual-person-1"))

    self.assertEqual(data["record"]["actorId"], "manual-person-1")
    self.assertEqual(self.client.get(reverse("api_records_next_cluster")).json()["nextClusterNumber"], 1)


@override_settings(CAPTURE_ACCESS_ENABLED=False)
class MyHubPinIpCaptureTests(TestCase):
  def test_myhub_pin_saves_remote_addr_as_device_ip(self):
    payload = {
      "buildingId": "SUTD",
      "buildingLabel": "SUTD",
      "floorId": "main-buildings",
      "floorLabel": "Floor 3",
      "categoryKey": "tables",
      "location": {"xPct": 60.5, "yPct": 30.25},
    }

    response = self.client.post(
      reverse("api_myhub_pins"),
      data=json.dumps(payload),
      content_type="application/json",
      REMOTE_ADDR="203.0.113.7",
    )

    self.assertEqual(response.status_code, 201, response.content)
    pin = MyHubConceptPin.objects.get()
    self.assertEqual(pin.device_ip, "203.0.113.7")
    self.assertEqual(response.json()["pin"]["deviceIp"], "203.0.113.7")


@override_settings(
  MANAGEMENT_ACCESS_ENABLED=True,
  MANAGEMENT_ACCESS_CODE="test-code",
  CAPTURE_ACCESS_ENABLED=False,
)
class CurrentSessionDataAccessTests(TestCase):
  def grant_management_access(self) -> None:
    session = self.client.session
    session[MANAGEMENT_ACCESS_SESSION_KEY] = True
    session.save()

  def create_record(self, actor_id: str = "manual-person-1") -> ActivityRecord:
    return ActivityRecord.objects.create(
      building_id="SUTD",
      floor_id="main-buildings",
      activity_type="Walking",
      actor_id=actor_id,
      gender="male",
      ethnic_group="Chinese",
      age_group="20-60 years old",
      facial_expression="happy",
      activity_time=timezone.now(),
      location_x_pct=10,
      location_y_pct=20,
    )

  def build_record_payload(self, actor_id: str = "manual-person-2") -> dict:
    return {
      "buildingId": "SUTD",
      "floorId": "main-buildings",
      "activityType": "Walking",
      "actorId": actor_id,
      "gender": "female",
      "ethnicGroup": "Malay",
      "ageGroup": "20-60 years old",
      "facialExpression": "no_expression",
      "activityTime": "2026-04-17T10:00:00Z",
      "location": {"xPct": 50, "yPct": 60},
    }

  def build_questionnaire_payload(self, record_id: str) -> dict:
    return {
      "recordId": record_id,
      "responses": {
        "postcode": "123456",
        "mainPurpose": "errand_transit",
        "visitFrequency": "daily",
        "stayDuration": "under_5_minutes",
        "overallRating": 5,
        "socialInteraction": "yes",
        "wantsToMapHub": "yes",
      },
    }

  def post_record(self, payload: dict | None = None) -> dict:
    response = self.client.post(
      reverse("api_records"),
      data=json.dumps(payload or self.build_record_payload()),
      content_type="application/json",
    )
    self.assertEqual(response.status_code, 201, response.content)
    return response.json()

  def post_myhub_pin(self, payload: dict) -> dict:
    response = self.client.post(
      reverse("api_myhub_pins"),
      data=json.dumps(payload),
      content_type="application/json",
    )
    self.assertEqual(response.status_code, 201, response.content)
    return response.json()

  def build_myhub_pin_payload(self, **overrides: object) -> dict:
    payload = {
      "buildingId": "SUTD",
      "buildingLabel": "SUTD",
      "floorId": "main-buildings",
      "floorLabel": "Floor 3",
      "categoryKey": "tables",
      "location": {"xPct": 60.5, "yPct": 30.25},
    }
    payload.update(overrides)
    return payload

  def test_activity_record_get_returns_only_current_session_records(self):
    old_record = self.create_record("old-person")
    created_record = self.post_record()["record"]

    response = self.client.get(reverse("api_records"))

    self.assertEqual(response.status_code, 200, response.content)
    returned_ids = {record["id"] for record in response.json()["records"]}
    self.assertEqual(returned_ids, {created_record["id"]})
    self.assertNotIn(str(old_record.id), returned_ids)

  def test_management_record_get_can_return_all_records(self):
    old_record = self.create_record("old-person")
    created_record = self.post_record()["record"]
    self.grant_management_access()

    response = self.client.get(reverse("api_records"))

    self.assertEqual(response.status_code, 200, response.content)
    returned_ids = {record["id"] for record in response.json()["records"]}
    self.assertIn(str(old_record.id), returned_ids)
    self.assertIn(created_record["id"], returned_ids)

  def test_export_requires_management_session(self):
    self.create_record("old-person")

    response = self.client.get(reverse("api_records_export"))

    self.assertEqual(response.status_code, 401, response.content)

  def test_myhub_get_returns_only_current_session_pins(self):
    old_pin = MyHubConceptPin.objects.create(
      building_id="SUTD",
      building_label="SUTD",
      floor_id="main-buildings",
      floor_label="Floor 3",
      category_key="tables",
      category_label="Tables",
      category_color="#2563eb",
      location_x_pct=10,
      location_y_pct=20,
    )
    created_pin = self.post_myhub_pin(self.build_myhub_pin_payload())["pin"]

    response = self.client.get(reverse("api_myhub_pins"))

    self.assertEqual(response.status_code, 200, response.content)
    returned_ids = {pin["id"] for pin in response.json()["pins"]}
    self.assertEqual(returned_ids, {created_pin["id"]})
    self.assertNotIn(str(old_pin.id), returned_ids)

  def test_myhub_delete_is_limited_to_current_session_pins(self):
    old_pin = MyHubConceptPin.objects.create(
      building_id="SUTD",
      building_label="SUTD",
      floor_id="main-buildings",
      floor_label="Floor 3",
      category_key="tables",
      category_label="Tables",
      category_color="#2563eb",
      location_x_pct=10,
      location_y_pct=20,
    )

    response = self.client.delete(f"{reverse('api_myhub_pins')}?id={old_pin.id}")

    self.assertEqual(response.status_code, 200, response.content)
    self.assertEqual(response.json()["deleted"], 0)
    self.assertTrue(MyHubConceptPin.objects.filter(id=old_pin.id).exists())

  def test_questionnaire_post_rejects_record_outside_current_session(self):
    old_record = self.create_record("old-person")

    response = self.client.post(
      reverse("api_person_questionnaire_responses"),
      data=json.dumps(self.build_questionnaire_payload(str(old_record.id))),
      content_type="application/json",
    )

    self.assertEqual(response.status_code, 400, response.content)
    self.assertEqual(PersonQuestionnaireResponse.objects.count(), 0)

  def test_myhub_post_rejects_record_outside_current_session(self):
    old_record = self.create_record("old-person")

    response = self.client.post(
      reverse("api_myhub_pins"),
      data=json.dumps(self.build_myhub_pin_payload(recordId=str(old_record.id))),
      content_type="application/json",
    )

    self.assertEqual(response.status_code, 400, response.content)
    self.assertEqual(MyHubConceptPin.objects.count(), 0)

  def test_myhub_pin_can_link_current_session_questionnaire_response(self):
    created_record = self.post_record()["record"]
    questionnaire_response = self.client.post(
      reverse("api_person_questionnaire_responses"),
      data=json.dumps(self.build_questionnaire_payload(created_record["id"])),
      content_type="application/json",
    )
    self.assertEqual(questionnaire_response.status_code, 201, questionnaire_response.content)
    response_id = questionnaire_response.json()["responses"][0]["id"]

    created_pin = self.post_myhub_pin(
      self.build_myhub_pin_payload(
        recordId=created_record["id"],
        questionnaireResponseId=response_id,
      )
    )["pin"]

    self.assertEqual(created_pin["recordId"], created_record["id"])
    self.assertEqual(created_pin["questionnaireResponseId"], response_id)

  def test_myhub_open_idea_is_saved_as_custom_label(self):
    payload = {
      "buildingId": "SUTD",
      "buildingLabel": "SUTD",
      "floorId": "main-buildings",
      "floorLabel": "Floor 3",
      "categoryKey": "open_idea",
      "categoryLabel": "Add more chess tables",
      "location": {"xPct": 60.5, "yPct": 30.25},
    }

    response = self.client.post(
      reverse("api_myhub_pins"),
      data=json.dumps(payload),
      content_type="application/json",
    )

    self.assertEqual(response.status_code, 201, response.content)
    pin = MyHubConceptPin.objects.get()
    self.assertEqual(pin.category_key, "open_idea")
    self.assertEqual(pin.category_label, "Add more chess tables")
    self.assertEqual(response.json()["pin"]["categoryLabel"], "Add more chess tables")
