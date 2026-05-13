import json

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import ActivityRecord, LargeGroupRecord, MyHubConceptPin, PinUserInfo


@override_settings(MANAGEMENT_ACCESS_ENABLED=True, MANAGEMENT_ACCESS_CODE="test-code")
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

  def test_next_cluster_endpoint_uses_database_without_management_session(self):
    self.create_record("CL0007-P002")

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


class MyHubPinIpCaptureTests(TestCase):
  def build_pin_user_info_payload(self) -> dict:
    return {
      "gender": "male",
      "ethnicGroup": "chinese",
      "ageGroup": "20_60",
      "housingType": "hdb_4_room",
      "housingTypeOther": "",
      "tenureStatus": "owner",
    }

  def test_myhub_pin_saves_remote_addr_as_device_ip(self):
    payload = {
      "buildingId": "SUTD",
      "buildingLabel": "SUTD",
      "floorId": "main-buildings",
      "floorLabel": "Floor 3",
      "categoryKey": "tables",
      "pinUserInfo": self.build_pin_user_info_payload(),
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

  def test_myhub_pin_saves_and_links_quick_profile(self):
    payload = {
      "buildingId": "SUTD",
      "buildingLabel": "SUTD",
      "floorId": "main-buildings",
      "floorLabel": "Floor 3",
      "categoryKey": "tables",
      "pinUserInfo": self.build_pin_user_info_payload(),
      "location": {"xPct": 60.5, "yPct": 30.25},
    }

    response = self.client.post(
      reverse("api_myhub_pins"),
      data=json.dumps(payload),
      content_type="application/json",
    )

    self.assertEqual(response.status_code, 201, response.content)
    self.assertEqual(PinUserInfo.objects.count(), 1)
    pin = MyHubConceptPin.objects.select_related("pin_user_info").get()
    self.assertIsNotNone(pin.pin_user_info)
    self.assertEqual(response.json()["pin"]["pinUserInfoId"], str(pin.pin_user_info_id))
