const EXIFR_MODULE_URL = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js";
let gpsReaderPromise = null;

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function getGpsReader() {
  if (!gpsReaderPromise) {
    gpsReaderPromise = import(EXIFR_MODULE_URL).then((moduleRef) => {
      if (typeof moduleRef.gps !== "function") {
        throw new Error("GPS parser is unavailable from EXIF module.");
      }
      return moduleRef.gps;
    });
  }
  return gpsReaderPromise;
}

export async function extractPhotoLocationFromImage(file) {
  if (!(file instanceof File)) {
    throw new Error("Image file is required.");
  }

  const gpsReader = await getGpsReader();
  const gps = await gpsReader(file);

  if (!gps || typeof gps.latitude !== "number" || typeof gps.longitude !== "number") {
    return null;
  }

  const location = {
    latitude: round6(gps.latitude),
    longitude: round6(gps.longitude),
  };

  if (typeof gps.altitude === "number") {
    location.altitude = round2(gps.altitude);
  }

  return location;
}
