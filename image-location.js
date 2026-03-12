const EXIFR_MODULE_URL = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js";
const DEFAULT_GEOLOCATION_TIMEOUT_MS = 12000;
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

function hasGeolocationSupport() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.geolocation &&
    typeof navigator.geolocation.getCurrentPosition === "function"
  );
}

function geolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "Could not get current device location.";
  }

  if (error.code === 1) {
    return "Location permission was denied.";
  }
  if (error.code === 2) {
    return "Current location is unavailable.";
  }
  if (error.code === 3) {
    return "Location request timed out.";
  }

  return "Could not get current device location.";
}

export async function requestCurrentDeviceLocation({
  timeoutMs = DEFAULT_GEOLOCATION_TIMEOUT_MS,
  maximumAgeMs = 0,
  enableHighAccuracy = true,
} = {}) {
  if (!hasGeolocationSupport()) {
    throw new Error("Browser geolocation is unavailable.");
  }

  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("Device location fallback requires HTTPS (or localhost).");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { coords } = position;
        const location = {
          latitude: round6(coords.latitude),
          longitude: round6(coords.longitude),
        };

        if (Number.isFinite(coords.altitude)) {
          location.altitude = round2(coords.altitude);
        }

        resolve(location);
      },
      (error) => reject(new Error(geolocationErrorMessage(error))),
      {
        enableHighAccuracy,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      }
    );
  });
}
