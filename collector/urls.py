from django.urls import path

from . import views

urlpatterns = [
  path("", views.index, name="index"),
  path("api/buildings/", views.api_buildings, name="api_buildings"),
  path("api/records/", views.api_records, name="api_records"),
  path("api/records/export/", views.api_records_export, name="api_records_export"),
  path("api/records/<uuid:record_id>/", views.api_record_detail, name="api_record_detail"),
]
