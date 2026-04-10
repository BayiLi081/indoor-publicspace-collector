export function loadActivityCatalog(scriptId = "activityCatalogData") {
  const fallbackCatalog = {
    options: [],
    aliases: {},
    categories: {},
  };

  const script = document.getElementById(scriptId);
  if (!script || !script.textContent) {
    return fallbackCatalog;
  }

  try {
    const payload = JSON.parse(script.textContent);
    const rawOptions = Array.isArray(payload?.options) ? payload.options : [];
    const rawAliases = payload?.aliases && typeof payload.aliases === "object" ? payload.aliases : {};
    const rawCategories = payload?.categories && typeof payload.categories === "object" ? payload.categories : {};

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

    const categories = {};
    Object.entries(rawCategories).forEach(([category, list]) => {
      if (Array.isArray(list)) {
        categories[category] = list.filter((v) => typeof v === "string");
      }
    });

    return {
      options,
      aliases,
      categories,
    };
  } catch (error) {
    console.error("Could not parse activity catalog payload:", error);
    return fallbackCatalog;
  }
}
