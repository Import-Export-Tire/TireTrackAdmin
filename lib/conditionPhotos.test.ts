import { describe, it, expect } from "vitest";
import { resolveConditionPhotoIds } from "./conditionPhotos";

describe("resolveConditionPhotoIds", () => {
  it("returns an empty array when the item has no photos", () => {
    expect(resolveConditionPhotoIds({})).toEqual([]);
  });

  it("returns the new array as-is, preserving order", () => {
    expect(
      resolveConditionPhotoIds({ conditionImageStorageIds: ["a", "b", "c"] }),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns the legacy single photo for a pre-migration item", () => {
    expect(resolveConditionPhotoIds({ damageImageStorageId: "legacy" })).toEqual([
      "legacy",
    ]);
  });

  it("appends the legacy photo AFTER the new array", () => {
    expect(
      resolveConditionPhotoIds({
        conditionImageStorageIds: ["a", "b"],
        damageImageStorageId: "legacy",
      }),
    ).toEqual(["a", "b", "legacy"]);
  });

  it("does not duplicate a legacy id that is already in the new array", () => {
    expect(
      resolveConditionPhotoIds({
        conditionImageStorageIds: ["a", "legacy"],
        damageImageStorageId: "legacy",
      }),
    ).toEqual(["a", "legacy"]);
  });

  it("tolerates null and undefined from Convex optional fields", () => {
    expect(
      resolveConditionPhotoIds({
        conditionImageStorageIds: null,
        damageImageStorageId: null,
      }),
    ).toEqual([]);
  });

  it("drops empty-string ids rather than emitting a broken image", () => {
    expect(
      resolveConditionPhotoIds({ conditionImageStorageIds: ["a", ""] }),
    ).toEqual(["a"]);
  });
});
