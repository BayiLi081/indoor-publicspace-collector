from django.urls import path

from . import views

urlpatterns = [
  path("", views.index, name="index"),
  path("management/", views.management, name="management"),
  path("api/buildings/", views.api_buildings, name="api_buildings"),
  path("api/locate-via-gps/", views.api_locate_via_gps, name="api_locate_via_gps"),
  path("api/records/", views.api_records, name="api_records"),
  path("api/site-observations/", views.api_site_observations, name="api_site_observations"),
  path("api/records/export/", views.api_records_export, name="api_records_export"),
  path("api/records/<uuid:record_id>/", views.api_record_detail, name="api_record_detail"),
  path(
    "api/site-observations/<uuid:observation_id>/",
    views.api_site_observation_detail,
    name="api_site_observation_detail",
  ),
]
