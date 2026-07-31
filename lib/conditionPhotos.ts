/**
 * Resolves a return item's condition photos into one ordered list.
 *
 * Items created before multi-photo support carry a single `damageImageStorageId`.
 * That field is read-only and never backfilled, so every display path must fold
 * it in — newest array first, legacy photo last.
 */
export type ConditionPhotoSource = {
  conditionImageStorageIds?: string[] | null;
  damageImageStorageId?: string | null;
};

export function resolveConditionPhotoIds(item: ConditionPhotoSource): string[] {
  const ids = (item.conditionImageStorageIds ?? []).filter(Boolean);
  const legacy = item.damageImageStorageId;
  if (legacy && !ids.includes(legacy)) ids.push(legacy);
  return ids;
}
