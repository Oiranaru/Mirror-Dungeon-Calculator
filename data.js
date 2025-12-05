// data.js

// How many shards you currently own for the *initial* tracked Sinner.
export const initialShardsOwned = 0;

// Default target shards for each Sinner (used if no goals are set yet)
export const defaultTargetShards = 400;

// Game constants
export const avgShardsPerBox = 2;   // 1–3 shards → average of 2
export const boxesPerRun = 9;       // 9 yellow boxes per MD run
export const weeklyBonusBoxes = 63; // 3 bonuses cashed at once

// Costs
export const costPer000 = 400; // one 000 ID or EGO set
export const costPer00 = 150;  // one 00 ID

// All 12 Sinners
export const sinnerNames = [
  "Yi Sang",
  "Faust",
  "Don Quixote",
  "Ryōshū",
  "Meursault",
  "Hong Lu",
  "Heathcliff",
  "Ishmael",
  "Rodion",
  "Sinclair",
  "Outis",
  "Gregor",
];

// Which Sinner the calculator tracks by default
export const defaultActiveSinner = "Yi Sang";
