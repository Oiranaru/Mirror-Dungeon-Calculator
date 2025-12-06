// main.js

import {
  initialShardsOwned,
  defaultTargetShards,
  avgShardsPerBox,
  boxesPerRun,
  costPer000,
  costPer00,
  sinners,
  sinnerNames,
  sinnerSlugByName,
  sinnerIdentities,
  sinnerEgos,
  shardCostByRarity,
  defaultActiveSinner,
  sinnerNameBySlug,
} from "./data.js";

const STORAGE_KEY = "mdShardCalculatorState_v1";

const expectedShardsPerRun = avgShardsPerBox * boxesPerRun; // 2 × 9 = 18

// ---------------------------------------------------------
// ID/EGO state helpers (new system)
// ---------------------------------------------------------

// Build a default owned/goal/enabled record for every ID & EGO
function createEmptyIdEgoState() {
  const result = {};
  sinners.forEach(({ id: sinnerId }) => {
    const items = [
      ...(sinnerIdentities[sinnerId] || []),
      ...(sinnerEgos[sinnerId] || []),
    ];
    result[sinnerId] = {};
    items.forEach((item) => {
      result[sinnerId][item.id] = {
        owned: false,  // whether you already own this ID/EGO
        goal: false,   // whether this ID/EGO is a goal
        enabled: true, // whether to include this goal in shard target calculations
      };
    });
  });
  return result;
}

// Merge saved idEgoState with the fresh default structure
function mergeIdEgoState(saved, base) {
  const result = { ...base };
  if (!saved) return result;

  Object.entries(saved).forEach(([sinnerId, items]) => {
    if (!result[sinnerId]) result[sinnerId] = {};
    Object.entries(items || {}).forEach(([itemId, itemState]) => {
      const owned = itemState.owned ?? itemState.own ?? false;
      const goal = !!itemState.goal;
      const enabled = itemState.enabled === false ? false : true;
      result[sinnerId][itemId] = { owned, goal, enabled };
    });
  });

  return result;
}

function getShardCostForItem(item) {
  const cost = shardCostByRarity[item.rarity];
  return typeof cost === "number" ? cost : 0;
}

// Recompute sinnerTargets based on all goal items that are currently enabled
function recomputeTargetForSinnerFromGoals(currentState, sinnerName) {
  if (!currentState.idEgoState) return;

  const sinnerId = sinnerSlugByName[sinnerName];
  if (!sinnerId) return;

  const items = [
    ...(sinnerIdentities[sinnerId] || []),
    ...(sinnerEgos[sinnerId] || []),
  ];

  let totalFromGoals = 0;

  items.forEach((item) => {
    const itemState = currentState.idEgoState?.[sinnerId]?.[item.id];
    if (!itemState || !itemState.goal) return;

    const enabled =
      itemState.enabled === undefined ? true : itemState.enabled;
    if (!enabled) return;

    totalFromGoals += getShardCostForItem(item);
  });

  // Always set this sinner’s target to the sum of enabled goals (0 if none)
  currentState.sinnerTargets[sinnerName] = totalFromGoals;
}

function recomputeAllTargetsFromGoals(currentState) {
  sinnerNames.forEach((name) =>
    recomputeTargetForSinnerFromGoals(currentState, name)
  );
}

function hasAnySavedGoals(savedIdEgoState) {
  if (!savedIdEgoState) return false;
  return Object.values(savedIdEgoState).some((items) =>
    items && Object.values(items).some((st) => st && st.goal)
  );
}

// ----- Helpers for Sinner + item data -----

function getSinnerSlugFromName(name) {
  return sinnerSlugByName[name];
}

function getAllItemsForSinnerByName(name) {
  const slug = getSinnerSlugFromName(name);
  if (!slug) return [];
  const ids = sinnerIdentities[slug] || [];
  const egos = sinnerEgos[slug] || [];
  return [
    ...ids.map((item) => ({ ...item, kind: "ID" })),
    ...egos.map((item) => ({ ...item, kind: "EGO" })),
  ];
}

// ---------------------------------------------------------
// State helpers
// ---------------------------------------------------------

function createInitialState() {
  const safeDefault = sinnerNames.includes(defaultActiveSinner)
    ? defaultActiveSinner
    : sinnerNames[0];

  const sinnerShards = {};
  const sinnerTargets = {};
  const sinnerGoals = {};

  sinnerNames.forEach((name) => {
    sinnerShards[name] = 0;

    // Simple default: 1×000 ID/EGO (400 shards) – overridden once planner is used.
    sinnerGoals[name] = { count000: 1, count00: 0 };
    sinnerTargets[name] =
      sinnerGoals[name].count000 * costPer000 +
      sinnerGoals[name].count00 * costPer00;
  });

  // Use initialShardsOwned for the default active Sinner
  sinnerShards[safeDefault] = initialShardsOwned;

  const idEgoState = createEmptyIdEgoState();

  return {
    activeSinner: safeDefault,
    sinnerShards,
    sinnerTargets,
    sinnerGoals,
    idEgoState,
    runsCompleted: 0,
    totalShardsGained: 0, // from MD runs only
    bonusShardsTotal: 0,  // from weekly bonuses
    unopenedBoxes: 0,     // global stash of unopened yellow boxes
    history: [],          // { runNumber, shardsGained, sinner, timestamp }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);

    const base = createInitialState();

    // Backwards compatibility: old single-sinner state
    if (!parsed.sinnerShards && typeof parsed.currentShards === "number") {
      base.sinnerShards[base.activeSinner] = parsed.currentShards;
    }

    const merged = {
      ...base,
      ...parsed,
      sinnerShards: parsed.sinnerShards || base.sinnerShards,
      sinnerTargets: parsed.sinnerTargets || base.sinnerTargets,
      sinnerGoals: parsed.sinnerGoals || base.sinnerGoals,
      idEgoState: mergeIdEgoState(parsed.idEgoState, base.idEgoState),
      activeSinner: parsed.activeSinner || base.activeSinner,
      unopenedBoxes:
        typeof parsed.unopenedBoxes === "number" && parsed.unopenedBoxes >= 0
          ? parsed.unopenedBoxes
          : base.unopenedBoxes,
    };

       // Use saved ID/EGO goals to override targets where applicable
    if (hasAnySavedGoals(parsed.idEgoState)) {
      recomputeAllTargetsFromGoals(merged);
    }

    return merged;
  } catch (err) {
    console.error("Failed to load state", err);
    return createInitialState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save state", err);
  }
}

let state = loadState();

function getIdEgoItemState(sinnerId, itemId) {
  if (!state.idEgoState) {
    state.idEgoState = createEmptyIdEgoState();
  }
  if (!state.idEgoState[sinnerId]) {
    state.idEgoState[sinnerId] = {};
  }
  if (!state.idEgoState[sinnerId][itemId]) {
    state.idEgoState[sinnerId][itemId] = {
      owned: false,
      goal: false,
      enabled: true,
    };
  }
  return state.idEgoState[sinnerId][itemId];
}

// ---------------------------------------------------------
// DOM refs
// ---------------------------------------------------------

const currentEl = document.getElementById("current-shards");
const targetEl = document.getElementById("target-shards");
const remainingEl = document.getElementById("remaining-shards");
const runsCompletedEl = document.getElementById("runs-completed");
const bonusTotalEl = document.getElementById("bonus-shards-total");
const boxesNeededTopEl = document.getElementById("boxes-needed-avg-top");

const avgPerRunEl = document.getElementById("avg-per-run");
const runsLeftTheoEl = document.getElementById("runs-left-theoretical");
const runsLeftTheoCeilEl = document.getElementById(
  "runs-left-theoretical-ceil"
);
const actualAvgEl = document.getElementById("actual-avg-per-run");
const runsLeftActualEl = document.getElementById("runs-left-actual");
const modulesNeededEl = document.getElementById("modules-needed");

const form = document.getElementById("add-run-form");
const shardsThisRunInput = document.getElementById("shards-this-run");
const formErrorEl = document.getElementById("form-error");
const resetButton = document.getElementById("reset-button");
const historyList = document.getElementById("run-history");

const bonusForm = document.getElementById("bonus-form");
const bonusInput = document.getElementById("bonus-shards");
const bonusErrorEl = document.getElementById("bonus-error");

const activeSinnerSelect = document.getElementById("active-sinner");
const activeSinnerLabelEl = document.getElementById("active-sinner-label");

const sinnerShardsForm = document.getElementById("sinner-shards-form");
const sinnerShardsGrid = document.getElementById("sinner-shards-grid");
const sinnerShardsErrorEl = document.getElementById("sinner-shards-error");

const overviewGrid = document.getElementById("overview-grid");
const activeSinnerGoalItemsEl = document.getElementById(
  "active-sinner-goal-items"
);
const unopenedBoxesDisplayEl = document.getElementById(
  "unopened-boxes-display"
);

// ID/EGO planner search UI
const idEgoPlannerRoot = document.getElementById("id-ego-planner-root");
const idEgoSearchInput = document.getElementById("id-ego-search-input");
const idEgoSearchErrorEl = document.getElementById("id-ego-search-error");

// Unopened boxes card
const boxesForm = document.getElementById("boxes-form");
const boxesInput = document.getElementById("unopened-boxes-input");
const boxesErrorEl = document.getElementById("boxes-error");
const boxesExpectedEl = document.getElementById("boxes-expected-shards");

// Maps of Sinner name -> input element (for shard overrides)
const sinnerShardsInputs = new Map();

// ---------------------------------------------------------
// ID/EGO planner UI & active progress
// ---------------------------------------------------------

// Top block under "Tracked IDs & EGOs for ..."
function renderActiveSinnerGoals() {
  if (!activeSinnerLabelEl || !activeSinnerGoalItemsEl) return;

  activeSinnerLabelEl.textContent = state.activeSinner || "";

  const sinnerId = sinnerSlugByName[state.activeSinner];
  activeSinnerGoalItemsEl.innerHTML = "";

  if (!sinnerId) return;

  const items = [
    ...(sinnerIdentities[sinnerId] || []),
    ...(sinnerEgos[sinnerId] || []),
  ];

  const goals = items.filter((item) => {
    const itemState = state.idEgoState?.[sinnerId]?.[item.id];
    return itemState && itemState.goal;
  });

  if (!goals.length) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent =
      "No specific IDs/EGOs selected for this Sinner yet.";
    activeSinnerGoalItemsEl.appendChild(empty);
    return;
  }

  goals.forEach((item) => {
    const itemState = state.idEgoState?.[sinnerId]?.[item.id] || {};
    const enabled = itemState.enabled !== false;

    const row = document.createElement("div");
    row.className = "goal-item-row";

    const left = document.createElement("div");
    left.className = "goal-item-main";

    const img = document.createElement("img");
    img.src = item.img;
    img.alt = item.name;
    img.className = "goal-item-image";

    const textWrap = document.createElement("div");
    textWrap.className = "goal-item-text";

    const nameEl = document.createElement("div");
    nameEl.className = "goal-item-name";
    nameEl.textContent = item.name;

    const metaEl = document.createElement("div");
    metaEl.className = "goal-item-meta";
    const rarityLabel =
      item.rarity === "base"
        ? "Base ID (0 shards)"
        : `${item.rarity} · ${getShardCostForItem(item)} shards`;
    metaEl.textContent = rarityLabel;

    textWrap.appendChild(nameEl);
    textWrap.appendChild(metaEl);
    left.appendChild(img);
    left.appendChild(textWrap);

        const right = document.createElement("div");
    right.className = "goal-item-controls";

    // --- Include toggle ---
    const includeLabel = document.createElement("label");
    includeLabel.className = "goal-item-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;

    const span = document.createElement("span");
    span.textContent = "Include";

    includeLabel.appendChild(checkbox);
    includeLabel.appendChild(span);

    checkbox.addEventListener("change", () => {
      const s = getIdEgoItemState(sinnerId, item.id);
      s.enabled = checkbox.checked;

      const sinnerName = state.activeSinner;
      recomputeTargetForSinnerFromGoals(state, sinnerName);

      saveState(state);
      render();
    });

    // --- Got it button ---
    const gotButton = document.createElement("button");
    gotButton.type = "button";
    gotButton.className = "goal-item-got-button";
    gotButton.textContent = "Got it";

    gotButton.addEventListener("click", () => {
      const sinnerName = state.activeSinner;
      const cost = getShardCostForItem(item);

      const sure = confirm(
        `Mark "${item.name}" as obtained for ${sinnerName}? ` +
        `This will mark it as Owned, remove it from your goals, and subtract ${cost} shards ` +
        `from ${sinnerName}'s shard total.`
      );
      if (!sure) return;

      // 1) Update ID/EGO ownership/goal state
      const s = getIdEgoItemState(sinnerId, item.id);
      s.owned = true;
      s.goal = false;
      s.enabled = true;

      // 2) Subtract shards for this Sinner (clamp at 0)
      const current = state.sinnerShards[sinnerName] || 0;
      state.sinnerShards[sinnerName] = Math.max(0, current - cost);

      // 3) Recompute target from remaining goals for this Sinner
      recomputeTargetForSinnerFromGoals(state, sinnerName);

      // 4) Sync the planner checkboxes for this entry (Own ON, Goal OFF)
      const plannerRow = document.getElementById(`planner-entry-${item.id}`);
      if (plannerRow) {
        const ownCb = plannerRow.querySelector('input[data-role="own"]');
        const goalCb = plannerRow.querySelector('input[data-role="goal"]');
        if (ownCb) ownCb.checked = true;
        if (goalCb) goalCb.checked = false;
      }

      saveState(state);
      render(); // removes it from the tracked list
    });

    right.appendChild(includeLabel);
    right.appendChild(gotButton);

    row.appendChild(left);
    row.appendChild(right);

    activeSinnerGoalItemsEl.appendChild(row);
  });
}

// Single planner row inside <details> per Sinner
function buildPlannerItemRow(sinnerId, item, isEgo = false) {
  const itemState = getIdEgoItemState(sinnerId, item.id);

  const row = document.createElement("div");
  row.className = "planner-item-row";
  // Data for the search feature
  row.dataset.entryId = item.id;
  row.dataset.entryName = (item.name || "").toLowerCase();
  row.id = `planner-entry-${item.id}`;

  const left = document.createElement("div");
  left.className = "planner-item-main";

  const img = document.createElement("img");
  img.src = item.img;
  img.alt = item.name;
  img.className = "planner-item-image";

  const textWrap = document.createElement("div");
  textWrap.className = "planner-item-text";

  const nameEl = document.createElement("div");
  nameEl.className = "planner-item-name";
  nameEl.textContent = item.name;

  const metaEl = document.createElement("div");
  metaEl.className = "planner-item-meta";

  const rarityLabel =
    item.rarity === "base"
      ? "Base ID"
      : `${item.rarity}${isEgo ? " EGO" : " ID"} · ${getShardCostForItem(
          item
        )} shards`;

  metaEl.textContent = rarityLabel;

  textWrap.appendChild(nameEl);
  textWrap.appendChild(metaEl);

  left.appendChild(img);
  left.appendChild(textWrap);

  const right = document.createElement("div");
  right.className = "planner-item-controls";

  // Owned checkbox
  const ownLabel = document.createElement("label");
  ownLabel.className = "checkbox-inline";

  const ownInput = document.createElement("input");
  ownInput.type = "checkbox";
  ownInput.checked = !!itemState.owned;
  ownInput.dataset.role = "own";

  ownInput.addEventListener("change", () => {
    const s = getIdEgoItemState(sinnerId, item.id);
    s.owned = ownInput.checked;
    saveState(state);
  });

  ownLabel.appendChild(ownInput);
  ownLabel.appendChild(document.createTextNode("Own"));

  // Goal checkbox
  const goalLabel = document.createElement("label");
  goalLabel.className = "checkbox-inline";

  const goalInput = document.createElement("input");
  goalInput.type = "checkbox";
  goalInput.checked = !!itemState.goal;
  goalInput.dataset.role = "goal";

    goalInput.addEventListener("change", () => {
    const s = getIdEgoItemState(sinnerId, item.id);
    s.goal = goalInput.checked;

    // If it just became a goal, default to enabled
    if (goalInput.checked && s.enabled === undefined) {
      s.enabled = true;
    }

    const sinnerName = sinnerNameBySlug[sinnerId] || state.activeSinner;
    recomputeTargetForSinnerFromGoals(state, sinnerName);

    saveState(state);
    render();
  });

  goalLabel.appendChild(goalInput);
  goalLabel.appendChild(document.createTextNode("Goal"));

  right.appendChild(ownLabel);
  right.appendChild(goalLabel);

  row.appendChild(left);
  row.appendChild(right);

  return row;
}

// Whole planner accordion in the "ID & EGO Planner" section
// Whole planner accordion in the "ID & EGO Planner" section
function buildIdEgoPlanner() {
  if (!idEgoPlannerRoot) return;

  idEgoPlannerRoot.innerHTML = "";

  sinners.forEach(({ id: sinnerId, name }) => {
    const details = document.createElement("details");
    details.className = "planner-sinner-panel";
    details.dataset.sinnerId = sinnerId;

    const summary = document.createElement("summary");
    summary.className = "planner-sinner-summary";
    summary.textContent = name;

    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "planner-sinner-body";

    const idList = sinnerIdentities[sinnerId] || [];
    if (idList.length) {
      const heading = document.createElement("h4");
      heading.textContent = "Identities";
      body.appendChild(heading);

      idList.forEach((item) => {
        body.appendChild(buildPlannerItemRow(sinnerId, item, false));
      });
    }

    const egoList = sinnerEgos[sinnerId] || [];
    if (egoList.length) {
      const heading = document.createElement("h4");
      heading.textContent = "EGOs";
      body.appendChild(heading);

      egoList.forEach((item) => {
        body.appendChild(buildPlannerItemRow(sinnerId, item, true));
      });
    }

    details.appendChild(body);
    idEgoPlannerRoot.appendChild(details);
  });
}

// ---------------------------------------------------------
// Other UI builders
// ---------------------------------------------------------

function initSinnerSelect() {
  if (!activeSinnerSelect) return;

  activeSinnerSelect.innerHTML = "";
  sinnerNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    activeSinnerSelect.appendChild(option);
  });
}

function buildSinnerShardsUI() {
  if (!sinnerShardsGrid) return;

  sinnerShardsGrid.innerHTML = "";
  sinnerShardsInputs.clear();

  sinnerNames.forEach((name) => {
    const wrapper = document.createElement("div");
    wrapper.className = "sinner-goal-card";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = name;

    const row = document.createElement("div");
    row.className = "sinner-row";

    // Shards field
    const shardField = document.createElement("div");
    shardField.className = "sinner-field";

    const shardSubLabel = document.createElement("span");
    shardSubLabel.className = "sub-label";
    shardSubLabel.textContent = "Shards";

    const shardInput = document.createElement("input");
    shardInput.type = "number";
    shardInput.min = "0";
    shardInput.step = "1";

    const shardVal =
      (state.sinnerShards && state.sinnerShards[name]) != null
        ? state.sinnerShards[name]
        : 0;
    shardInput.value = shardVal;

    shardField.appendChild(shardSubLabel);
    shardField.appendChild(shardInput);

    row.appendChild(shardField);

    wrapper.appendChild(label);
    wrapper.appendChild(row);
    sinnerShardsGrid.appendChild(wrapper);

    sinnerShardsInputs.set(name, shardInput);
  });
}

function buildOverviewGrid() {
  if (!overviewGrid) return;

  overviewGrid.innerHTML = "";

  sinnerNames.forEach((name) => {
    const current =
      (state.sinnerShards && state.sinnerShards[name]) != null
        ? state.sinnerShards[name]
        : 0;
    const target =
      (state.sinnerTargets && state.sinnerTargets[name]) != null
        ? state.sinnerTargets[name]
        : defaultTargetShards;

    const remaining = Math.max(target - current, 0);
    const runsLeft = remaining > 0 ? remaining / expectedShardsPerRun : 0;
    const boxesNeeded = remaining > 0 ? remaining / avgShardsPerBox : 0;

    const item = document.createElement("div");
    item.className = "overview-item";

    const nameEl = document.createElement("div");
    nameEl.className = "overview-name";
    nameEl.textContent = name;

    const line1 = document.createElement("span");
    line1.className = "overview-line";
    line1.textContent = `Shards: ${current} / ${target}`;

    const line2 = document.createElement("span");
    line2.className = "overview-line";
    line2.textContent =
      remaining === 0 ? "Remaining: 0 (done)" : `Remaining: ${remaining}`;

    const line3 = document.createElement("span");
    line3.className = "overview-line";
    line3.textContent =
      remaining === 0
        ? "Runs left (avg): 0"
        : `Runs left (avg): ${runsLeft.toFixed(2)}`;

    const line4 = document.createElement("span");
    line4.className = "overview-line";
    line4.textContent =
      remaining === 0
        ? "Boxes needed (avg): 0"
        : `Boxes needed (avg): ${boxesNeeded.toFixed(1)}`;

    item.appendChild(nameEl);
    item.appendChild(line1);
    item.appendChild(line2);
    item.appendChild(line3);
    item.appendChild(line4);

    overviewGrid.appendChild(item);
  });
}

// ---------------------------------------------------------
// ID/EGO planner search
// ---------------------------------------------------------

function handleIdEgoSearch() {
  if (!idEgoSearchInput || !idEgoPlannerRoot) return;

  const queryRaw = idEgoSearchInput.value.trim();
  const query = queryRaw.toLowerCase();

  if (!query) {
    if (idEgoSearchErrorEl) {
      idEgoSearchErrorEl.textContent =
        "Type part of an ID or EGO name to search.";
    }
    return;
  }

  const allEntries = idEgoPlannerRoot.querySelectorAll(".planner-item-row");
  let bestMatch = null;

  allEntries.forEach((entry) => {
    if (bestMatch) return;
    const name = entry.dataset.entryName || "";
    if (name.includes(query)) {
      bestMatch = entry;
    }
  });

  if (!bestMatch) {
    if (idEgoSearchErrorEl) {
      idEgoSearchErrorEl.textContent =
        "No ID or EGO found with that name.";
    }
    return;
  }

  if (idEgoSearchErrorEl) {
    idEgoSearchErrorEl.textContent = "";
  }

  // Ensure the containing Sinner <details> is open
  const detailsEl = bestMatch.closest("details");
  if (detailsEl && !detailsEl.open) {
    detailsEl.open = true;
  }

  // Scroll the entry into view
  bestMatch.scrollIntoView({ behavior: "smooth", block: "center" });

  // Brief highlight
  bestMatch.classList.add("planner-entry-highlight");
  setTimeout(() => {
    bestMatch.classList.remove("planner-entry-highlight");
  }, 1200);
}

// Trigger search when pressing Enter in the search box
if (idEgoSearchInput) {
  idEgoSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleIdEgoSearch();
    }
  });
}

// ---------------------------------------------------------
// Render
// ---------------------------------------------------------

function render() {
  // Ensure active Sinner is valid
  if (!sinnerNames.includes(state.activeSinner)) {
    state.activeSinner = sinnerNames[0];
  }

  if (activeSinnerSelect) {
    activeSinnerSelect.value = state.activeSinner;
  }

  // Update tracked ID/EGO list for the active Sinner
  renderActiveSinnerGoals();
  if (activeSinnerLabelEl) {
    activeSinnerLabelEl.textContent = state.activeSinner;
  }

  const currentForActive =
    (state.sinnerShards && state.sinnerShards[state.activeSinner]) || 0;
  const currentTarget =
    (state.sinnerTargets && state.sinnerTargets[state.activeSinner]) != null
      ? state.sinnerTargets[state.activeSinner]
      : defaultTargetShards;

  const remaining = Math.max(currentTarget - currentForActive, 0);

  // Boxes needed (avg) for selected Sinner (ignores stash)
  let boxesNeededTop = 0;
  if (remaining > 0) {
    boxesNeededTop = remaining / avgShardsPerBox; // avg 2 shards per box
  }
  if (boxesNeededTopEl) {
    boxesNeededTopEl.textContent = boxesNeededTop.toFixed(1);
  }

  if (targetEl) targetEl.textContent = currentTarget;
  if (currentEl) currentEl.textContent = currentForActive;
  if (remainingEl) remainingEl.textContent = remaining;
  if (runsCompletedEl) runsCompletedEl.textContent = state.runsCompleted;
  if (bonusTotalEl) bonusTotalEl.textContent = state.bonusShardsTotal || 0;

  // Sync per-Sinner shard inputs
  sinnerNames.forEach((name) => {
    const shardInput = sinnerShardsInputs.get(name);

    if (shardInput) {
      const val =
        (state.sinnerShards && state.sinnerShards[name]) != null
          ? state.sinnerShards[name]
          : 0;
      shardInput.value = val;
    }
  });

  // Theoretical projection (18 shards/run)
  if (avgPerRunEl) {
    avgPerRunEl.textContent = expectedShardsPerRun.toFixed(1);
  }

  if (remaining === 0) {
    if (runsLeftTheoEl) runsLeftTheoEl.textContent = "0 (target reached)";
    if (runsLeftTheoCeilEl) runsLeftTheoCeilEl.textContent = "0";
    if (modulesNeededEl) modulesNeededEl.textContent = "0";
  } else {
    const theoRuns = remaining / expectedShardsPerRun;
    const theoRunsCeil = Math.ceil(theoRuns);
    const modulesNeeded = theoRunsCeil * 5; // 5 modules per run

    if (runsLeftTheoEl) runsLeftTheoEl.textContent = theoRuns.toFixed(2);
    if (runsLeftTheoCeilEl)
      runsLeftTheoCeilEl.textContent = theoRunsCeil.toString();
    if (modulesNeededEl)
      modulesNeededEl.textContent = modulesNeeded.toString();
  }

  // Actual projection based on real run data
  if (state.runsCompleted > 0 && state.totalShardsGained > 0 && remaining > 0) {
    const actualAvg = state.totalShardsGained / state.runsCompleted;
    if (actualAvgEl) actualAvgEl.textContent = actualAvg.toFixed(2);
    const runsLeftActual = remaining / actualAvg;
    if (runsLeftActualEl)
      runsLeftActualEl.textContent = runsLeftActual.toFixed(2);
  } else if (remaining === 0) {
    if (actualAvgEl) actualAvgEl.textContent = "–";
    if (runsLeftActualEl)
      runsLeftActualEl.textContent = "0 (target reached)";
  } else {
    if (actualAvgEl) actualAvgEl.textContent = "–";
    if (runsLeftActualEl) runsLeftActualEl.textContent = "–";
  }

  // History
  if (historyList) {
    historyList.innerHTML = "";
    state.history
      .slice()
      .reverse()
      .forEach((entry) => {
        const li = document.createElement("li");
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "short",
        });
        const sinnerText = entry.sinner ? ` – ${entry.sinner}` : "";
        li.textContent = `Run #${entry.runNumber}: +${entry.shardsGained} shards${sinnerText} (${timeStr})`;
        historyList.appendChild(li);
      });
  }

  // Unopened boxes display
  const boxesVal = state.unopenedBoxes || 0;
  if (boxesInput) boxesInput.value = boxesVal;
  if (boxesExpectedEl) {
    boxesExpectedEl.textContent = (boxesVal * avgShardsPerBox).toFixed(0);
  }
  if (unopenedBoxesDisplayEl) {
    unopenedBoxesDisplayEl.textContent = boxesVal.toString();
  }

  // Overview per Sinner
  buildOverviewGrid();
}

// ---------------------------------------------------------
// Event handlers
// ---------------------------------------------------------

// Run form
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (formErrorEl) formErrorEl.textContent = "";

    const rawValue = shardsThisRunInput?.value.trim();
    const value = Number(rawValue);

    if (!rawValue || !Number.isFinite(value) || value < 0) {
      if (formErrorEl) {
        formErrorEl.textContent =
          "Please enter a non-negative number of shards.";
      }
      return;
    }

    const shards = Math.floor(value);

    state.runsCompleted += 1;
    state.totalShardsGained += shards;

    if (!state.sinnerShards[state.activeSinner]) {
      state.sinnerShards[state.activeSinner] = 0;
    }
    state.sinnerShards[state.activeSinner] += shards;

    state.history.push({
      runNumber: state.runsCompleted,
      shardsGained: shards,
      sinner: state.activeSinner,
      timestamp: new Date().toISOString(),
    });

    saveState(state);
    render();

    form.reset();
    if (shardsThisRunInput) shardsThisRunInput.focus();
  });
}

// Weekly bonus form
if (bonusForm) {
  bonusForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (bonusErrorEl) bonusErrorEl.textContent = "";

    const rawValue = bonusInput?.value.trim();
    const value = Number(rawValue);

    if (!rawValue || !Number.isFinite(value) || value < 0) {
      if (bonusErrorEl) {
        bonusErrorEl.textContent =
          "Please enter a non-negative number of shards.";
      }
      return;
    }

    const shards = Math.floor(value);

    state.bonusShardsTotal += shards;

    if (!state.sinnerShards[state.activeSinner]) {
      state.sinnerShards[state.activeSinner] = 0;
    }
    state.sinnerShards[state.activeSinner] += shards;

    saveState(state);
    render();

    bonusForm.reset();
    if (bonusInput) bonusInput.focus();
  });
}

// Per-Sinner shard editor
if (sinnerShardsForm) {
  sinnerShardsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sinnerShardsErrorEl) sinnerShardsErrorEl.textContent = "";

    const updatedShards = {};

    for (const name of sinnerNames) {
      const shardInput = sinnerShardsInputs.get(name);
      if (!shardInput) continue;

      const shardRaw = shardInput.value.trim();
      const shardNum = shardRaw === "" ? 0 : Number(shardRaw);

      if (!Number.isFinite(shardNum) || shardNum < 0) {
        if (sinnerShardsErrorEl) {
          sinnerShardsErrorEl.textContent =
            `Invalid shard value for ${name}. Please use a non-negative number.`;
        }
        return;
      }

      const shardsInt = Math.floor(shardNum);
      updatedShards[name] = shardsInt;
    }

    state.sinnerShards = {
      ...state.sinnerShards,
      ...updatedShards,
    };

    saveState(state);
    render();
  });
}

// Sinner selector
if (activeSinnerSelect) {
  activeSinnerSelect.addEventListener("change", () => {
    const value = activeSinnerSelect.value;
    if (!sinnerNames.includes(value)) return;
    state.activeSinner = value;
    saveState(state);
    render();
  });
}

// Unopened boxes form
if (boxesForm) {
  boxesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (boxesErrorEl) boxesErrorEl.textContent = "";

    const rawValue = boxesInput?.value.trim();
    const value = Number(rawValue);

    if (!rawValue || !Number.isFinite(value) || value < 0) {
      if (boxesErrorEl) {
        boxesErrorEl.textContent =
          "Please enter a non-negative number of boxes.";
      }
      return;
    }

    state.unopenedBoxes = Math.floor(value);

    saveState(state);
    render();
  });
}

// Reset button
if (resetButton) {
  resetButton.addEventListener("click", () => {
    const sure = confirm(
      "Reset progression and use the starting shards from data.js?"
    );
    if (!sure) return;

    state = createInitialState();
    saveState(state);
    render();
  });
}

// ---------------------------------------------------------
// Initial setup
// ---------------------------------------------------------

initSinnerSelect();
buildSinnerShardsUI();
buildIdEgoPlanner();
render();
