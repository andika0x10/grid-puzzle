export const legacyObjectFrames = ["gem-0", "gem-1", "start", "finish", "pickup"] as const;
export const modeObjectFrames = [
  "parcel",
  "depot",
  "key-red",
  "key-blue",
  "key-gold",
  "door-red",
  "door-blue",
  "door-gold",
  "door-open",
  "outpost",
  "hazard-warning",
  "hazard-active",
] as const;
export const classicObjectFrames = ["checkpoint-idle", "checkpoint-done", "gate-open", "gate-closed", "gem-blue", "gem-red", "gem-dormant", "gem-fever"] as const;
export const sharedObjectFrames = [...legacyObjectFrames, ...modeObjectFrames, ...classicObjectFrames] as const;
export type SharedObjectFrame = (typeof sharedObjectFrames)[number];
