ACTIVITY_TYPE_OPTIONS = (
  "Walking",
  "Strolling",
  "Sitting",
  "Standing",
  "Talking",
  "Singing",
  "Sharing Food",
  "Queueing",
  "Phone Calling",
  "Smoking",
  "Consuming F&B",
  "Running",
  "Exercising",
  "Others",
)

INDIVIDUAL_ACTIVITY_TYPE_OPTIONS = tuple(
  activity for activity in ACTIVITY_TYPE_OPTIONS if activity not in {"Singing", "Sharing Food"}
)

GROUP_ACTIVITY_TYPOLOGY_OPTIONS = (
  "Talking",
  "Singing",
  "Sharing Food",
  "Others",
)

ACTIVITY_TYPE_ALIASES = {
  "other": "Others",
  "sing": "Singing",
  "share food": "Sharing Food",
  "sharing food": "Sharing Food",
  "sharing foods": "Sharing Food",
  "food sharing": "Sharing Food",
  "sharing f&b": "Sharing Food",
}

ACTIVITY_CATEGORY_MAPPING = {
  "moving": [
    "Walking",
    "Strolling",
    "Running",
    "Exercising",
    "Talking",
    "Phone Calling",
    "Consuming F&B",
    "Others",
  ],
  "lingering": [
    "Sitting",
    "Standing",
    "Talking",
    "Singing",
    "Sharing Food",
    "Queueing",
    "Phone Calling",
    "Smoking",
    "Consuming F&B",
    "Others",
  ],
}


def build_activity_catalog_payload() -> dict[str, object]:
  return {
    "options": list(ACTIVITY_TYPE_OPTIONS),
    "aliases": dict(ACTIVITY_TYPE_ALIASES),
    "categories": dict(ACTIVITY_CATEGORY_MAPPING),
  }
