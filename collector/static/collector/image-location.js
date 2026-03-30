const EXIFR_MODULE_URL = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js";
const DEFAULT_GEOLOCATION_TIMEOUT_MS = 12000;
const DEFAULT_DIRECTION_TIMEOUT_MS = 2500;
let gpsReaderPromise = null;

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function normalizeHeading(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = value % 360;
  return round1(normalized < 0 ? normalized + 360 : normalized);
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

function hasDeviceOrientationSupport() {
  return typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";
}

function readHeadingFromCoordinates(coords) {
  if (!coords || typeof coords !== "object") {
    return null;
  }

  const heading = normalizeHeading(coords.heading);
  if (heading === null) {
    return null;
  }

  return {
    heading,
    source: "geolocation",
  };
}

function readDirectionFromOrientationEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const webkitCompassHeading = normalizeHeading(event.webkitCompassHeading);
  if (webkitCompassHeading !== null) {
    const direction = {
      heading: webkitCompassHeading,
      source: "orientation",
    };

    if (Number.isFinite(event.webkitCompassAccuracy)) {
      direction.accuracy = round1(Math.abs(event.webkitCompassAccuracy));
    }

    return direction;
  }

  if (event.absolute !== true) {
    return null;
  }

  const alpha = normalizeHeading(event.alpha);
  if (alpha === null) {
    return null;
  }

  return {
    // Best-effort compass heading derived from the absolute z-axis rotation.
    heading: normalizeHeading(360 - alpha),
    source: "orientation",
  };
}

async function requestDeviceOrientationPermission() {
  if (!hasDeviceOrientationSupport()) {
    return false;
  }

  const orientationEvent = window.DeviceOrientationEvent;
  if (!orientationEvent || typeof orientationEvent.requestPermission !== "function") {
    return true;
  }

  try {
    const permission = await orientationEvent.requestPermission(true);
    return permission === "granted";
  } catch (error) {
    try {
      const permission = await orientationEvent.requestPermission();
      return permission === "granted";
    } catch (_fallbackError) {
      return false;
    }
  }
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
        const headingData = readHeadingFromCoordinates(coords);

        if (Number.isFinite(coords.altitude)) {
          location.altitude = round2(coords.altitude);
        }

        if (headingData) {
          location.heading = headingData.heading;
          location.headingSource = headingData.source;
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

export async function requestCurrentDeviceDirection({
  timeoutMs = DEFAULT_DIRECTION_TIMEOUT_MS,
  signal = null,
} = {}) {
  if (!hasDeviceOrientationSupport()) {
    return null;
  }

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return null;
  }

  const permissionGranted = await requestDeviceOrientationPermission();
  if (!permissionGranted) {
    return null;
  }

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }

    const eventNames = ["deviceorientationabsolute", "deviceorientation"];
    let settled = false;
    let timeoutId = 0;

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      eventNames.forEach((eventName) => {
        window.removeEventListener(eventName, onOrientation);
      });
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const onAbort = () => finish(null);

    const onOrientation = (event) => {
      const direction = readDirectionFromOrientationEvent(event);
      if (!direction) {
        return;
      }
      finish(direction);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    eventNames.forEach((eventName) => {
      window.addEventListener(eventName, onOrientation);
    });
    timeoutId = window.setTimeout(() => finish(null), timeoutMs);
  });
}
