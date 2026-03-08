# Indoor Data Collector

A lightweight web app to record where human activities happen on an indoor map.

## Features

- Let users switch between floors (`Floor 1`, `Floor 2`, `Floor 3`).
- Display a different embedded indoor map per selected floor.
- Click any point on the map to select a location.
- Save activity details (type, ID, timestamp, notes) linked to that location.
- Store each activity with its floor and view records for the current floor.
- Persist records in browser local storage.
- Export records as JSON.

## Run

No build step is required.

1. Open `index.html` in a web browser.
2. Click locations and save activity records.

## Embedded Map

- Floor map files:
  - `assets/floor-1.svg`
  - `assets/floor-2.svg`
  - `assets/floor-3.svg`
- Map routing is configured in `FLOOR_MAPS` inside `app.js`.
- Replace these files or update `FLOOR_MAPS` to point to your real map images.

## Data Format

Each record includes:

- `id`
- `createdAt`
- `activityType`
- `actorId`
- `activityTime`
- `notes`
- `floorId`
- `location` (`xPct`, `yPct`, `xPx`, `yPx`)
