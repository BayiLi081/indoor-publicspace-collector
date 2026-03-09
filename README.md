# Indoor Data Collector

A lightweight web app to record where human activities happen on an indoor map.

## Features

- Auto-discover buildings from `assets/` subfolders and let users choose building first.
- Auto-discover floor map files per selected building and let users choose floor next.
- Display a different indoor map per selected building/floor.
- Click any point on the map to select an indoor location.
- Capture/upload an image from camera and extract GPS metadata (if available).
- Save activity details (type, ID, timestamp, notes) with map point and/or photo GPS.
- Store each activity with its building and floor, and view records for the current selection.
- Persist records in browser local storage.
- Export records as JSON.

## Local Run (Development)

No build step is required.

1. Start a local static server:
   `python -m http.server 8000`
2. Open `http://localhost:8000` in a web browser.
3. Select building and floor, then click a location on the map and/or upload a GPS-tagged image.
4. Save activity records.

## Deployment Guide (Detailed)

### 1. Prerequisites

Software prerequisites:

- A static web server (at least one):
- Python 3.8+ (`python -m http.server`) for local test.
- Node.js 18+ (`npx serve`) for local test alternative.
- Nginx 1.18+ or Apache 2.4+ for self-hosted production.
- Git 2.30+ (optional, recommended for source control and CI/CD).
- A modern browser for validation:
- Chrome 110+, Edge 110+, Firefox 110+, Safari 16+.

Infrastructure prerequisites:

- HTTPS-enabled domain for production (recommended, especially for mobile camera workflows).
- Outbound HTTPS access to CDN if you keep EXIF parser on jsDelivr.
- Permission to configure cache and security headers on your hosting platform.
- For automatic folder scanning: enable directory listing for `/assets/` on your server.
- If directory listing is disabled: provide `assets/buildings.manifest.json` (see map section below).

Project/runtime prerequisites:

- This app is fully static (no backend required).
- User records are stored in browser `localStorage` per browser profile + domain.
- Deploy target must serve `.js`, `.css`, `.html`, `.svg`, and `.json` with standard MIME types.

### 2. Pre-Deployment Checklist

1. Confirm files exist in project root:
   `index.html`, `app.js`, `image-location.js`, `styles.css`, `assets/`.
2. Confirm building/floor assets follow your intended folder structure under `assets/`.
3. If directory listing is disabled on your host, create `assets/buildings.manifest.json`.
4. Decide EXIF parser strategy:
   keep CDN URL in `image-location.js` or self-host a local vendor copy.
5. Decide hostname/domain early, because `localStorage` is origin-specific.

### 3. External Dependency (EXIF Parser)

Current implementation in `image-location.js` imports:

`https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js`

If your environment is air-gapped or blocks CDNs:

1. Download that file and store it in your project (example: `vendor/exifr-lite.esm.js`).
2. Update `EXIFR_MODULE_URL` in `image-location.js` to:
   `./vendor/exifr-lite.esm.js`
3. Redeploy and retest image GPS extraction.

### 4. Local Validation Before Production Deploy

1. Run:
   `python -m http.server 8000`
2. Open:
   `http://localhost:8000`
3. Validate functional flows:
   map click marker appears, record save works, search works, delete works, JSON export works.
4. Validate photo flow:
   upload a GPS-tagged image and verify `Photo GPS` column is populated.
5. Validate non-GPS image flow:
   upload image without GPS and verify status shows no GPS metadata.
6. Validate browser refresh:
   saved records remain in table from `localStorage`.

### 5. Deployment Option A: GitHub Pages

1. Push project to a GitHub repository.
2. Ensure files are in repository root (not nested under build output folders).
3. In GitHub: `Settings -> Pages`.
4. Set source to deploy from `main` branch (root).
5. Save and wait for deployment to finish.
6. Open published URL and run validation checklist from section 4.
7. If using a custom domain, configure DNS and enable HTTPS in Pages settings.

### 6. Deployment Option B: Netlify

1. Log in to Netlify and create a new site.
2. Choose one of these methods:
   drag-and-drop project folder, connect Git repository, or use Netlify CLI.
3. Build command:
   leave empty (no build required).
4. Publish directory:
   set to repository root (`.`).
5. Deploy and verify app from Netlify URL.
6. Add custom domain and force HTTPS in Netlify domain settings.

### 7. Deployment Option C: Vercel

1. Import repository into Vercel.
2. Framework preset:
   `Other` (plain static site).
3. Build command:
   leave empty.
4. Output directory:
   leave default (root static files).
5. Deploy and run validation checklist from section 4.
6. Configure custom domain and verify HTTPS is active.

### 8. Deployment Option D: Self-Hosted Nginx (Linux)

1. Install Nginx.
2. Copy project files to server path (example: `/var/www/indoor-data-collector`).
3. Create Nginx server block:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/indoor-data-collector;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        autoindex on;
    }

    location ~* \.(css|js|svg)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

4. Enable config, test Nginx config, reload Nginx.
5. Add TLS using Certbot and redirect HTTP to HTTPS.
6. Validate all flows in browser.

### 9. Deployment Option E: Self-Hosted Apache (Linux)

1. Install Apache (`apache2`).
2. Copy project files to DocumentRoot (example: `/var/www/indoor-data-collector`).
3. Create virtual host:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    DocumentRoot /var/www/indoor-data-collector

    <Directory /var/www/indoor-data-collector>
        Options Indexes FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
</VirtualHost>
```

4. Enable required modules (`headers`, `ssl` if using HTTPS).
5. Enable site, reload Apache, then add TLS cert and redirect to HTTPS.
6. Validate all flows in browser.

### 10. Post-Deployment Verification Checklist

1. `index.html`, `app.js`, `image-location.js`, and `assets/*.svg` all return `200`.
2. Browser console has no module loading errors.
3. Photo upload works and GPS extraction status appears.
4. JSON export downloads successfully.
5. Floor switching and marker rendering work on all configured floors.
6. Building switching works and floor list updates according to selected building.
7. Responsive layout works on desktop and mobile widths.
8. HTTPS lock icon appears on production domain.

### 11. Known Operational Notes

- Data persistence is client-side only (`localStorage`), not shared across users/devices.
- Clearing browser storage removes records for that origin.
- Export JSON regularly if records are important.
- EXIF GPS is available only when uploaded image actually contains GPS metadata.
- CDN outage for jsDelivr can affect GPS extraction unless you self-host EXIF parser.

### 12. Troubleshooting

Issue: `Failed to fetch dynamically imported module`.

1. Confirm `image-location.js` is served with HTTP/HTTPS (not blocked local file context).
2. Confirm outbound access to jsDelivr.
3. Check browser console network errors.
4. If needed, self-host EXIF parser as described in section 3.

Issue: Camera upload works but no coordinates found.

1. Verify image was captured with location services enabled on device.
2. Confirm EXIF GPS metadata exists in the file.
3. Test with another known geotagged image.

Issue: Building list or floor list is empty.

1. Confirm your maps are inside `assets/<building-name>/`.
2. Confirm directory listing is enabled for `/assets/`, or add `assets/buildings.manifest.json`.
3. Confirm map file extensions are supported (`.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`).
4. Hard refresh browser and check console/network errors.

Issue: Records missing after deployment change.

1. Confirm domain/origin changed (new origin has separate `localStorage`).
2. Import data from previously exported JSON if needed.

## Embedded Map

### Automatic Discovery from `assets/`

The app scans `assets/` at runtime:

1. Each subfolder is treated as a building.
2. Each map image file inside that subfolder is treated as a floor option.
3. Supported map file extensions: `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`.

Example structure:

```
assets/
  building-a/
    floor-1.svg
    floor-2.svg
  building-b/
    l1.svg
    l2.svg
```

### Optional Manifest (for hosts without directory listing)

Create `assets/buildings.manifest.json`:

```json
{
  "buildings": {
    "building-a": {
      "label": "Building A",
      "floors": {
        "floor-1": { "label": "Floor 1", "mapSrc": "assets/building-a/floor-1.svg" },
        "floor-2": { "label": "Floor 2", "mapSrc": "assets/building-a/floor-2.svg" }
      }
    },
    "building-b": {
      "label": "Building B",
      "floors": {
        "l1": { "label": "Level 1", "mapSrc": "assets/building-b/l1.svg" },
        "l2": { "label": "Level 2", "mapSrc": "assets/building-b/l2.svg" }
      }
    }
  }
}
```

## Data Format

Each record includes:

- `id`
- `createdAt`
- `activityType`
- `actorId`
- `activityTime`
- `notes`
- `buildingId`
- `floorId`
- `location` (`xPct`, `yPct`, `xPx`, `yPx`) or `null`
- `photoName` (file name) or `null`
- `photoLocation` (`latitude`, `longitude`, optional `altitude`) or `null`
