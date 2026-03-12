from django.conf import settings
from django.contrib import admin
from django.contrib.staticfiles.urls import staticfiles_urlpatterns
from django.urls import include, path
from django.views.static import serve

urlpatterns = [
  path("admin/", admin.site.urls),
  path("", include("collector.urls")),
]

if settings.DEBUG:
  urlpatterns += [
    path("assets/<path:path>", serve, {"document_root": settings.ASSETS_DIR}),
  ]
  urlpatterns += staticfiles_urlpatterns()
