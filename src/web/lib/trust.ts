import type { Entity } from "../../domain/model";

export const trustLabel: Record<Entity["trust"], string> = {
  VERIFIED: "Verified",
  DECLARED: "Declared",
  INFERRED: "Inferred",
  UNKNOWN: "Unknown",
  STALE: "Stale",
  DISPUTED: "Disputed",
};

export const trustDescription: Record<Entity["trust"], string> = {
  VERIFIED: "A person explicitly confirmed this fact.",
  DECLARED: "A person entered this fact, but it has not been confirmed.",
  INFERRED: "An agent suggested this fact. A person still needs to review it.",
  UNKNOWN: "Required information is missing.",
  STALE: "This was previously known, but it changed or needs rechecking.",
  DISPUTED: "People or sources disagree about this fact.",
};

export const trustOrder: Entity["trust"][] = [
  "VERIFIED",
  "DECLARED",
  "INFERRED",
  "UNKNOWN",
  "STALE",
  "DISPUTED",
];
