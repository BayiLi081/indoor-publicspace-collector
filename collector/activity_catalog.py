ACTIVITY_TYPE_OPTIONS = (
  "Walking",
  "Strolling",
  "Sitting",
  "Standing",
  "Talking",
  "Queueing",
  "Phone Calling",
  "Smoking",
  "Consuming F&B",
  "Running",
  "Exercising",
  "Others",
)

ACTIVITY_TYPE_ALIASES = {
  "other": "Others",
}


def build_activity_catalog_payload() -> dict[str, object]:
  return {
    "options": list(ACTIVITY_TYPE_OPTIONS),
    "aliases": dict(ACTIVITY_TYPE_ALIASES),
  }
