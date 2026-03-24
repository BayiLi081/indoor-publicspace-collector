# Image database setup guide

## Cloud Services

[Introduction to Blob (object) Storage - Azure Storage | Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction)

## Purpose

This document explains how to set up an image database for site photographs and how to store image GPS coordinates (latitude and longitude) in the metadata database. The aim is to keep the image files, metadata, and spatial information consistent and easy to query.

## 1. Recommended structure

Use a two-part structure:

* **Image storage**: stores the actual image files
* **Metadata database**: stores descriptive fields for each image, including file path, date, photographer, and GPS coordinates

This separation keeps the system simple. Image files can stay in **local storage, cloud object storage, or a project server**, while the **metadata database** can be queried for analysis and figure production.

## 2. Folder and naming convention

Store images with a clear and stable naming rule.

### Suggested folder structure

```text
images/
  SUTD/
    SUTD_2025_01_15_001.jpg
    SUTD_2025_01_15_002.jpg
  One-Punngol/
    One-Punngol_2025_01_20_001.jpg
  Tampines/
    Tampines_2025_01_18_001.jpg
```

### Suggested file naming format

```text
[HUBCODE]_[YYYY]_[MM]_[DD]_[IMAGEID].jpg
```

Example:

```text
Tampines_2025_01_20_003.jpg
```

This makes the file name readable and reduces duplicate names.

## 3. Core metadata fields

Each image should have one metadata record.

### Required fields

| Field name        | Type             | Description                                          |
| ----------------- | ---------------- | ---------------------------------------------------- |
| image_id          | string / integer | Unique ID for each image                             |
| file_name         | string           | Original image file name                             |
| file_path         | string           | Storage path or object URL                           |
| hub_code          | string           | Short code                                           |
| hub_name          | string           | Full hub name                                        |
| date_taken        | date             | Date when photo was taken                            |
| time_taken        | time             | Time when photo was taken                            |
| photographer      | string           | ID of data collector                                 |
| latitude          | decimal          | GPS latitude from EXIF or field record               |
| longitude         | decimal          | GPS longitude from EXIF or field record              |
| coordinate_source | string           | EXIF, mobile GPS, manual correction, or field survey |
| description       | text             | Short note on what the photo shows                   |
| view_type         | string           | For example entrance, lake, lawn, path, playground   |
| direction         | string           | Optional viewing direction, such as N, NE, E         |
| quality_check     | string / boolean | Whether metadata has been checked                    |
| notes             | text             | Any extra remarks                                    |

## 4. Add GPS to the metadata database

Latitude and longitude should be stored as separate numeric fields.

### Why store them separately

* easier for mapping and GIS export
* easier for spatial joins
* easier to validate incorrect coordinates
* compatible with most database and analysis tools

### Recommended field format

* **latitude**: decimal(10, 7)
* **longitude**: decimal(10, 7)

Example:

* latitude: `1.3578421`
* longitude: `103.8324517`

## 5. Suggested database schema

### Option A: Simple metadata table

```sql
CREATE TABLE image_metadata (
    image_id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    hub_code VARCHAR(20) NOT NULL,
    hub_name VARCHAR(255),
    date_taken DATE,
    time_taken TIME,
    photographer VARCHAR(255),
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    coordinate_source VARCHAR(50),
    description TEXT,
    view_type VARCHAR(100),
    direction VARCHAR(20),
    quality_check BOOLEAN DEFAULT FALSE,
    notes TEXT
);
```

## 6. How to get GPS from images

There are three common sources.

### A. EXIF metadata from the image file

Many phone and camera images contain GPS in EXIF.

Store:

* latitude
  n- longitude
* timestamp

This is the best source when location services were enabled during capture.

### B. Mobile field collection app

If the team uses a field app, store the app-recorded coordinates in the metadata table.

### C. Manual correction

If EXIF is missing or inaccurate, assign coordinates manually from a field log, map click, or GPS device. Mark this in `coordinate_source`.

## 7. Data ingestion workflow

A practical workflow is:

1. Upload image files to the image storage folder or cloud bucket
2. Extract EXIF metadata automatically
3. Create one metadata record for each image
4. Parse GPS into decimal latitude and longitude
5. Add hub code, hub name, view type, and description
7. Save the cleaned metadata into the database

## 8. Quality control rules

The developer should add checks for the following:

* file name must be unique
* latitude must be between -90 and 90
* longitude must be between -180 and 180
* coordinates should fall within Singapore or within the expected study hub boundary
* missing GPS should be flagged
* duplicate coordinates and timestamps should be reviewed
* image path should point to an existing file

### Suggested flags

| Flag                | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| missing_gps         | GPS is not available                              |
| outside_hub         | Coordinate falls outside the assigned hub         |
| duplicate_record    | Same file or same metadata appears more than once |
| needs_manual_review | Record needs checking                             |

## 9. Link image data to hub analysis

To support your research workflow, each image record should be linkable to:

* hub boundary
* nearby POIs
* survey point or audit point
* street-view or perception sampling point

This will allow the images to be used in:

* figure preparation
* environmental audits
* perception validation
* spatial comparison with NDVI, GVI, POIs, and path network dat

## 10. Developer notes

The developer should ensure that:

* the metadata database accepts decimal GPS values
* GPS can be extracted automatically from EXIF where available
* manual editing is possible when GPS is missing or wrong
* each image record can be updated without changing the stored file
* the database can export CSV or GeoJSON for GIS and analysis
* image IDs remain stable across updates

## 12. Recommended next step

A good next step is to build:

1. an **image metadata table** in PostgreSQL or SQLite
2. an **EXIF extraction script** for batch import
3. an optional **GIS geometry field** for mapping and validation

This setup will support both archive management and spatial analysis.
