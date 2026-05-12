from django.urls import path

from . import views

urlpatterns = [
  path("", views.index, name="index"),
  path("flowing/", views.flowing, name="flowing"),
  path("myhub/", views.myhub, name="myhub"),
  path("capture/login/", views.capture_login, name="capture_login"),
  path("capture/logout/", views.capture_logout, name="capture_logout"),
  path("management/login/", views.management_login, name="management_login"),
  path("management/logout/", views.management_logout, name="management_logout"),
  path("management/", views.management, name="management"),
  path("api/buildings/", views.api_buildings, name="api_buildings"),
  path("api/assets/json/", views.api_asset_json, name="api_asset_json"),
  path("api/assets/image/", views.api_asset_image, name="api_asset_image"),
  path("api/locate-via-gps/", views.api_locate_via_gps, name="api_locate_via_gps"),
  path("api/records/", views.api_records, name="api_records"),
  path("api/records/next-cluster/", views.api_records_next_cluster, name="api_records_next_cluster"),
  path("api/flowing-records/", views.api_flowing_records, name="api_flowing_records"),
  path("api/myhub-pins/", views.api_myhub_pins, name="api_myhub_pins"),
  path("api/site-observations/", views.api_site_observations, name="api_site_observations"),
  path(
    "api/person-questionnaire-responses/",
    views.api_person_questionnaire_responses,
    name="api_person_questionnaire_responses",
  ),
  path("api/records/export/", views.api_records_export, name="api_records_export"),
  path("api/records/<uuid:record_id>/", views.api_record_detail, name="api_record_detail"),
  path(
    "api/site-observations/<uuid:observation_id>/",
    views.api_site_observation_detail,
    name="api_site_observation_detail",
  ),
]
