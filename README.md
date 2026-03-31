# Indoor Data Collector (Django)

<div align="center">
    <a href="https://lkycic.sutd.edu.sg/">
        <img src="https://img.shields.io/badge/LKYCIC-SUTD-blue" alt="LKYCIC-SUTD">
    </a>
    <a href="https://img.shields.io/github/stars/BayiLi081/indoor-activities-collector/graphs/contributors">
        <img src="https://img.shields.io/github/contributors/BayiLi081/indoor-activities-collector.svg" alt="GitHub contributors">
    </a>
    <a href="https://github.com/BayiLi081/GIS-training/blob/main/LICENSE">
        <img src="https://img.shields.io/github/license/BayiLi081/indoor-activities-collector?color=blue" alt="GitHub license">
    </a>
    <a href="https://deepwiki.com/BayiLi081/indoor-activities-collector">
        <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki">
    </a>
    <br>
    <a href="hhttps://github.com/BayiLi081/GIS-training">
        <img src="https://img.shields.io/github/stars/BayiLi081/indoor-activities-collector" alt="GitHub stars">
    </a>
    <a href="https://github.com/BayiLi081/GIS-training/fork">
        <img src="https://img.shields.io/github/forks/BayiLi081/indoor-activities-collector" alt="GitHub forks">
    </a>
</div>

A Django-based web app to record where human activities happen on an indoor map.

## What Changed

This project has been rewritten from a static site into a Django application with:

- Persistent activity records stored in SQLite via Django ORM.
- JSON API endpoints for building/floor metadata and record CRUD/export.
- Existing interactive frontend behavior retained (map click markers, photo GPS extraction, search, delete, export).
- Building/floor map discovery performed on the server from `assets/` (with optional manifest support).

## Features

- Auto-discover buildings from `assets/` subfolders and let users choose building first.
- Auto-discover floor map files per selected building and let users choose floor next.
- Display a different indoor map per selected building/floor.
- Click any point on the map to select an indoor location.
- Capture/upload an image and extract GPS metadata (if available).
- Use the "Locate via GPS" button to convert the device location into map percentages (calibrated via `assets/<building>/gps-map.json`), then show the current position and device direction on the floor plan when supported by the browser.
- Use the "Locate via POI" button to show named points of interest from `assets/<building>/poi.json` on the current floor plan.
- Save activity details (type, ID, timestamp, notes) with map point and/or photo GPS.
- Save quick site observations from the floating camera or note buttons without mixing them into the structured activity survey dataset.

- Persist records in Django database.
- Search, delete, and export records as JSON.

## Project Structure

- `manage.py`
- `indoor_collector/` Django project settings and root URL config.
- `collector/` Django app (models, views, API, template, static frontend files).
- `assets/` building/floor map files served at `/assets/...`.

## Database Setup

For PostgreSQL setup, required tables, and SQLite-to-PostgreSQL data migration steps, see [`POSTGRESQL_SETUP.md`](./POSTGRESQL_SETUP.md).

For cloud deployment guidance for PostgreSQL and app configuration, see [`database_cloud_setup.md`](./database_cloud_setup.md).

## Requirements

- Python 3.10+
- pip

Create and activate a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

## Run Locally

For a local PostgreSQL test setup, create a `.env` file in the project root. This file is ignored by git, so it is the right place for local database credentials.

Use a dedicated PostgreSQL user for this app instead of the `postgres` superuser.

```dotenv
DJANGO_DB_ENGINE=postgresql
DJANGO_DB_NAME=indoor_activities
DJANGO_DB_USER=indoor_app
DJANGO_DB_PASSWORD=your_strong_password
DJANGO_DB_HOST=127.0.0.1
DJANGO_DB_PORT=5432
```

Load the environment variables into your shell:

```bash
set -a
source .env
set +a
```

If you want to use SQLite for a quick local run, you can skip the `.env` file.

1. Apply migrations:


```bash
python3 manage.py migrate
```

`migrate` will also sync the discovered buildings from `assets/` into the existing `buildings` table when that table is available in the configured database.

2. Start server:

```bash
python3 manage.py runserver
```

3. Open:

`http://127.0.0.1:8000/`

or

`http://localhost:8000/`

## Azure Blob Storage Deployment

The app now stores uploaded images through Django's `default` storage backend, so you can switch the upload path from local filesystem storage to Azure Blob Storage without changing the upload code.

This repository already includes the Azure storage dependencies in `requirements.txt`. After updating your Azure App Service deployment, configure Blob Storage like this:

1. Create a blob container in your Azure Storage account.
   Use one container such as `media`. This app already separates uploads internally with object paths like `objects/activity-records/...` and `objects/site-observations/...`.
2. Open your Azure App Service in the Azure portal and go to `Settings` -> `Environment variables`.
   App Service injects these values as environment variables and restarts the app when they change.
3. Add the base storage settings:

```text
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-app>.azurewebsites.net,<your-custom-domain>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<your-app>.azurewebsites.net,https://<your-custom-domain>
DJANGO_OBJECT_STORAGE_BACKEND=storages.backends.azure_storage.AzureStorage
DJANGO_OBJECT_STORAGE_PREFIX=objects
AZURE_CONTAINER=media
AZURE_ACCOUNT_NAME=<your-storage-account-name>
```

4. Choose one authentication method.

Recommended: Managed identity
Enable the system-assigned managed identity on the App Service, then grant that identity the `Storage Blob Data Contributor` role on the storage account.

```text
AZURE_USE_MANAGED_IDENTITY=True
AZURE_URL_EXPIRATION_SECS=3600
```

Optional:
If you use a user-assigned managed identity, also set `AZURE_MANAGED_IDENTITY_CLIENT_ID=<client-id>`.

Alternative: Connection string
If you prefer account-key-based access, keep managed identity off and set:

```text
AZURE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=<account>;AccountKey=<key>;EndpointSuffix=core.windows.net
```

5. Optional Azure Blob settings:

```text
AZURE_CUSTOM_DOMAIN=<cdn-or-custom-domain>
AZURE_CACHE_CONTROL=public,max-age=31536000,immutable
AZURE_OVERWRITE_FILES=False
```

6. Save the App Service settings and restart the app if Azure has not already restarted it automatically.
7. Run migrations on the deployed app if needed, then upload a test photo from the site.

Notes:
- This setup changes uploaded image storage only. Static files are still handled separately by Django/App Service.
- If your blob container is private, keep `AZURE_URL_EXPIRATION_SECS` set so generated image links are signed and time-limited.
- The Azure storage backend does not create containers automatically, so create `media` before testing uploads.

## API Endpoints

- `GET /api/buildings/` - returns discovered building/floor map metadata.
- `GET /api/records/` - list records.
- `POST /api/records/` - create a record.
- `GET /api/site-observations/` - list saved site observations.
- `POST /api/site-observations/` - create a site observation note or photo entry.
- `DELETE /api/records/<uuid>/` - delete a record.
- `GET /api/records/export/` - download all records as JSON.

## Assets Discovery

The server discovers maps in `assets/` using:

1. `assets/buildings.manifest.json` (if present and valid), else
2. filesystem scan of `assets/` directories/files.

Additionally, optional `assets/<building>/gps-map.json` files can describe floor-level `referencePoints` (each with `xPct`, `yPct`, `latitude`, and `longitude`). The helper in `collector/locate_via_gps.py` uses those anchors to translate device GPS coordinates into map percentages for the Locate via GPS button.

Each floor object may also include an optional `headingOffsetDeg` value. This offset is added to the device heading before drawing the direction arrow, which is useful when the floor plan image is not aligned to north.

Optional `assets/<building>/poi.json` files can describe floor-level `referencePoints` for points of interest. Each POI entry should include `xPct`, `yPct`, and `name`, for example:

```json
{
  "main-buildings": {
    "referencePoints": [
      {
        "xPct": 10.13,
        "yPct": 57.24,
        "name": "Upper Changi MRT EXIT"
      }
    ]
  }
}
```

Supported map file extensions:

- `.svg`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

## Notes

- Photo GPS extraction still uses `exifr` from jsDelivr in the browser.
- Uploaded images now go through Django's default storage backend instead of being stored only as base64 preview data in the database.
- Local development uses filesystem-backed object storage under `media/objects/...`, so local testing already follows an object-store-style path layout.
- Azure Blob Storage is supported through `storages.backends.azure_storage.AzureStorage` plus App Service environment variables.
- For production, serve static files and `/assets/` through your web server (Nginx/Apache/CDN) rather than Django's development server.

## Troubleshooting

- If saving a record fails with `500 Internal Server Error`, initialize the database schema:

```bash
python3 manage.py migrate
```

- After migration, restart the Django server (`python3 manage.py runserver`).

- If saving a record fails with `403 Forbidden` after Azure App Service deployment, configure App Settings:

```text
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-app>.azurewebsites.net,<your-custom-domain>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<your-app>.azurewebsites.net,https://<your-custom-domain>
```

- Restart the App Service after updating settings.
