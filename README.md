# Indoor Data Collector (Django)

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
- Save activity details (type, ID, timestamp, notes) with map point and/or photo GPS.
- Persist records in Django database.
- Search, delete, and export records as JSON.

## Project Structure

- `manage.py`
- `indoor_collector/` Django project settings and root URL config.
- `collector/` Django app (models, views, API, template, static frontend files).
- `assets/` building/floor map files served at `/assets/...`.

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

1. Apply migrations:


```bash
python3 manage.py migrate
```

2. Start server:

```bash
python3 manage.py runserver
```

3. Open:

`http://127.0.0.1:8000/`

## API Endpoints

- `GET /api/buildings/` - returns discovered building/floor map metadata.
- `GET /api/records/` - list records.
- `POST /api/records/` - create a record.
- `DELETE /api/records/<uuid>/` - delete a record.
- `GET /api/records/export/` - download all records as JSON.

## Assets Discovery

The server discovers maps in `assets/` using:

1. `assets/buildings.manifest.json` (if present and valid), else
2. filesystem scan of `assets/` directories/files.

Supported map file extensions:

- `.svg`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

## Notes

- Photo GPS extraction still uses `exifr` from jsDelivr in the browser.
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
