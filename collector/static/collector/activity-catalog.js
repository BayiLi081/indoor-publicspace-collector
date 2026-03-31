export function loadActivityCatalog(scriptId = "activityCatalogData") {
  const fallbackCatalog = {
    options: [],
    aliases: {},
  };

  const script = document.getElementById(scriptId);
  if (!script || !script.textContent) {
    return fallbackCatalog;
  }

  try {
    const payload = JSON.parse(script.textContent);
    const rawOptions = Array.isArray(payload?.options) ? payload.options : [];
    const rawAliases = payload?.aliases && typeof payload.aliases === "object" ? payload.aliases : {};

    const options = rawOptions
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);

    const aliases = {};
    Object.entries(rawAliases).forEach(([rawKey, rawValue]) => {
      if (typeof rawValue !== "string") {
        return;
      }

      const key = String(rawKey).trim().toLowerCase();
      const value = rawValue.trim();
      if (!key || !value) {
        return;
      }

      aliases[key] = value;
    });

    return {
      options,
      aliases,
    };
  } catch (error) {
    console.error("Could not parse activity catalog payload:", error);
    return fallbackCatalog;
  }
}
