import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  demoAssetByEntityId,
  demoWorkspaces,
  reviewedAssetForType,
} from "./demoWorkspaces";

const portraitAssets = new Set([
  "/assets/nodes/studio/01.webp",
  "/assets/nodes/studio/08.webp",
  "/assets/nodes/studio/21.webp",
  "/assets/nodes/studio/23.webp",
  "/assets/nodes/studio/24.webp",
  "/assets/nodes/education/01.webp",
  "/assets/nodes/education/02.webp",
  "/assets/nodes/education/03.webp",
  "/assets/nodes/education/04.webp",
  "/assets/nodes/education/05.webp",
  "/assets/nodes/hospitality/01.webp",
  "/assets/nodes/hospitality/02.webp",
  "/assets/nodes/hospitality/03.webp",
  "/assets/nodes/hospitality/04.webp",
  "/assets/nodes/hospitality/05.webp",
  "/assets/nodes/charter/01.webp",
  "/assets/nodes/charter/02.webp",
  "/assets/nodes/charter/04.webp",
  "/assets/nodes/charter/05.webp",
]);

const deviceAssets = new Set([
  "/assets/nodes/studio/03.webp",
  "/assets/nodes/education/23.webp",
  "/assets/nodes/hospitality/17.webp",
  "/assets/nodes/hospitality/20.webp",
  "/assets/nodes/charter/17.webp",
  "/assets/nodes/charter/18.webp",
]);

const locationAssets = new Set([
  "/assets/nodes/hospitality/06.webp",
  "/assets/nodes/hospitality/16.webp",
]);

describe("fictional demo asset assignments", () => {
  test("assigns one reviewed, existing asset to every demo entity", () => {
    const publicRoot = join(import.meta.dir, "../../public");
    const entities = demoWorkspaces.flatMap((workspace) => workspace.entities);
    expect(Object.keys(demoAssetByEntityId)).toHaveLength(entities.length);
    for (const entity of entities) {
      expect(demoAssetByEntityId[entity.id]).toBeDefined();
      expect(entity.image).toBeTruthy();
      expect(existsSync(join(publicRoot, entity.image!.slice(1)))).toBeTrue();
    }
  });

  test("uses portraits only for people and gives every person a distinct portrait per company", () => {
    for (const workspace of demoWorkspaces) {
      const people = workspace.entities.filter(
        (entity) => entity.type === "person",
      );
      expect(
        people.every((person) => portraitAssets.has(person.image!)),
      ).toBeTrue();
      expect(new Set(people.map((person) => person.image)).size).toBe(
        people.length,
      );
      expect(
        workspace.entities
          .filter((entity) => entity.type !== "person")
          .every((entity) => !portraitAssets.has(entity.image!)),
      ).toBeTrue();
    }
  });

  test("keeps literal devices and locations on visually matching assets", () => {
    const entities = demoWorkspaces.flatMap((workspace) => workspace.entities);
    expect(
      entities
        .filter((entity) => entity.type === "device")
        .every((entity) => deviceAssets.has(entity.image!)),
    ).toBeTrue();
    expect(
      entities
        .filter((entity) => entity.type === "location")
        .every((entity) => locationAssets.has(entity.image!)),
    ).toBeTrue();
  });

  test("keeps agent-drafted assets semantically matched by entity type", () => {
    for (let index = 0; index < 30; index += 1) {
      expect(
        portraitAssets.has(reviewedAssetForType("person", index)),
      ).toBeTrue();
      expect(
        deviceAssets.has(reviewedAssetForType("device", index)),
      ).toBeTrue();
      expect(
        locationAssets.has(reviewedAssetForType("location", index)),
      ).toBeTrue();
      for (const type of [
        "team",
        "service",
        "vendor",
        "device",
        "document",
        "account",
        "workflow",
        "location",
        "communication-channel",
        "recovery-mechanism",
      ] as const)
        expect(
          portraitAssets.has(reviewedAssetForType(type, index)),
        ).toBeFalse();
    }
  });
});
