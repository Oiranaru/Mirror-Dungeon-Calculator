// main.js
import {
  initialShardsOwned,
  defaultTargetShards,
  avgShardsPerBox,
  boxesPerRun,
  costPer000,
  costPer00,
  sinnerNames,
  defaultActiveSinner,
} from "./data.js";

const STORAGE_KEY = "mdShardCalculatorState_v1";

const expectedShardsPerRun = avgShardsPerBox * boxesPerRun; // 2 × 9 = 18

// ----- State helpers -----

function createInitialState() {
  const safeDefault = sinnerNames.includes(defaultActiveSinner)
    ? defaultActiveSinner
    : sinnerNames[0];

  const sinnerShards = {};
  const sinnerTargets = {};
  const sinnerGoals = {};

  sinnerNames.forEach((name) => {
    sinnerShards[name] = 0;

    // Default goal: 1×000 ID/EGO (400 shards), 0×00 IDs
    sinnerGoals[name] = { count000: 1, count00: 0 };
    sinnerTargets[name] =
      sinnerGoals[name].count000 * costPer000 +
      sinnerGoals[name].count00 * costPer00;
  });

  // Use initialShardsOwned for the default active Sinner
  sinnerShards[safeDefault] = initialShardsOwned;

  return {
    activeSinner: safeDefault,
    sinnerShards,
    sinnerTargets,
    sinnerGoals,
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
      activeSinner: parsed.activeSinner || base.activeSinner,
      unopenedBoxes:
        typeof parsed.unopenedBoxes === "number" && parsed.unopenedBoxes >= 0
          ? parsed.unopenedBoxes
          : base.unopenedBoxes,
    };

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

// ----- DOM refs -----

const currentEl = document.getElementById("current-shards");
const targetEl = document.getElementById("target-shards");
const remainingEl = document.getElementById("remaining-shards");
const runsCompletedEl = document.getElementById("runs-completed");
const bonusTotalEl = document.getElementById("bonus-shards-total");
const boxesNeededTopEl = document.getElementById("boxes-needed-avg-top");

const avgPerRunEl = document.getElementById("avg-per-run");
const runsLeftTheoEl = document.getElementById("runs-left-theoretical");
const runsLeftTheoCeilEl = document.getElementById("runs-left-theoretical-ceil");
const actualAvgEl = document.getElementById("actual-avg-per-run");
const runsLeftActualEl = document.getElementById("runs-left-actual");

const form = document.getElementById("add-run-form");
const shardsThisRunInput = document.getElementById("shards-this-run");
const formErrorEl = document.getElementById("form-error");
const resetButton = document.getElementById("reset-button");
const historyList = document.getElementById("run-history");

const bonusForm = document.getElementById("bonus-form");
const bonusInput = document.getElementById("bonus-shards");
const bonusErrorEl = document.getElementById("bonus-error");

const activeSinnerSelect = document.getElementById("active-sinner");

const sinnerShardsForm = document.getElementById("sinner-shards-form");
const sinnerShardsGrid = document.getElementById("sinner-shards-grid");
const sinnerShardsErrorEl = document.getElementById("sinner-shards-error");

const overviewGrid = document.getElementById("overview-grid");

// Unopened boxes card
const boxesForm = document.getElementById("boxes-form");
const boxesInput = document.getElementById("unopened-boxes-input");
const boxesErrorEl = document.getElementById("boxes-error");
const boxesExpectedEl = document.getElementById("boxes-expected-shards");

// Maps of Sinner name -> input element
const sinnerShardsInputs = new Map();
const sinnerGoal000Inputs = new Map();
const sinnerGoal00Inputs = new Map();

// ----- UI builders -----

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
  sinnerGoal000Inputs.clear();
  sinnerGoal00Inputs.clear();

  sinnerNames.forEach((name) => {
    const wrapper = document.createElement("div");
    wrapper.className = "sinner-goal-card";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = name;

    const row = document.createElement("div");
    row.className = "sinner-row";

    const goals =
      (state.sinnerGoals && state.sinnerGoals[name]) || { count000: 1, count00: 0 };

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

    // 000 IDs / EGOs field
    const goal000Field = document.createElement("div");
    goal000Field.className = "sinner-field";

    const goal000SubLabel = document.createElement("span");
    goal000SubLabel.className = "sub-label";
    goal000SubLabel.textContent = "000 IDs / EGOs";

    const goal000Input = document.createElement("input");
    goal000Input.type = "number";
    goal000Input.min = "0";
    goal000Input.step = "1";
    goal000Input.value = goals.count000 ?? 0;

    goal000Field.appendChild(goal000SubLabel);
    goal000Field.appendChild(goal000Input);

    // 00 IDs field
    const goal00Field = document.createElement("div");
    goal00Field.className = "sinner-field";

    const goal00SubLabel = document.createElement("span");
    goal00SubLabel.className = "sub-label";
    goal00SubLabel.textContent = "00 IDs";

    const goal00Input = document.createElement("input");
    goal00Input.type = "number";
    goal00Input.min = "0";
    goal00Input.step = "1";
    goal00Input.value = goals.count00 ?? 0;

    goal00Field.appendChild(goal00SubLabel);
    goal00Field.appendChild(goal00Input);

    row.appendChild(shardField);
    row.appendChild(goal000Field);
    row.appendChild(goal00Field);

    wrapper.appendChild(label);
    wrapper.appendChild(row);
    sinnerShardsGrid.appendChild(wrapper);

    sinnerShardsInputs.set(name, shardInput);
    sinnerGoal000Inputs.set(name, goal000Input);
    sinnerGoal00Inputs.set(name, goal00Input);
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

// ----- Render -----

function render() {
  // Ensure active Sinner is valid
  if (!sinnerNames.includes(state.activeSinner)) {
    state.activeSinner = sinnerNames[0];
  }

  if (activeSinnerSelect) {
    activeSinnerSelect.value = state.activeSinner;
  }

  const currentForActive =
    (state.sinnerShards && state.sinnerShards[state.activeSinner]) || 0;
  const currentTarget =
    (state.sinnerTargets && state.sinnerTargets[state.activeSinner]) ||
    defaultTargetShards;

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

  // Sync per-Sinner inputs
  sinnerNames.forEach((name) => {
    const shardInput = sinnerShardsInputs.get(name);
    const goal000Input = sinnerGoal000Inputs.get(name);
    const goal00Input = sinnerGoal00Inputs.get(name);

    if (shardInput) {
      const val =
        (state.sinnerShards && state.sinnerShards[name]) != null
          ? state.sinnerShards[name]
          : 0;
      shardInput.value = val;
    }

    const goals =
      (state.sinnerGoals && state.sinnerGoals[name]) || { count000: 1, count00: 0 };

    if (goal000Input) {
      goal000Input.value = goals.count000 ?? 0;
    }

    if (goal00Input) {
      goal00Input.value = goals.count00 ?? 0;
    }
  });

  // Theoretical projection (18 shards/run)
  if (avgPerRunEl) {
    avgPerRunEl.textContent = expectedShardsPerRun.toFixed(1);
  }

  if (remaining === 0) {
    if (runsLeftTheoEl) runsLeftTheoEl.textContent = "0 (target reached)";
    if (runsLeftTheoCeilEl) runsLeftTheoCeilEl.textContent = "0";
  } else {
    const theoRuns = remaining / expectedShardsPerRun;
    if (runsLeftTheoEl) runsLeftTheoEl.textContent = theoRuns.toFixed(2);
    if (runsLeftTheoCeilEl)
      runsLeftTheoCeilEl.textContent = Math.ceil(theoRuns).toString();
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

  // Overview per Sinner
  buildOverviewGrid();
}

// ----- Event handlers -----

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

// Per-Sinner shard + goal editor
if (sinnerShardsForm) {
  sinnerShardsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sinnerShardsErrorEl) sinnerShardsErrorEl.textContent = "";

    const updatedShards = {};
    const updatedGoals = {};
    const updatedTargets = {};

    for (const name of sinnerNames) {
      const shardInput = sinnerShardsInputs.get(name);
      const goal000Input = sinnerGoal000Inputs.get(name);
      const goal00Input = sinnerGoal00Inputs.get(name);
      if (!shardInput || !goal000Input || !goal00Input) continue;

      const shardRaw = shardInput.value.trim();
      const goal000Raw = goal000Input.value.trim();
      const goal00Raw = goal00Input.value.trim();

      const shardNum = shardRaw === "" ? 0 : Number(shardRaw);
      const goal000Num = goal000Raw === "" ? 0 : Number(goal000Raw);
      const goal00Num = goal00Raw === "" ? 0 : Number(goal00Raw);

      if (!Number.isFinite(shardNum) || shardNum < 0) {
        if (sinnerShardsErrorEl) {
          sinnerShardsErrorEl.textContent =
            `Invalid shard value for ${name}. Please use a non-negative number.`;
        }
        return;
      }

      if (!Number.isFinite(goal000Num) || goal000Num < 0) {
        if (sinnerShardsErrorEl) {
          sinnerShardsErrorEl.textContent =
            `Invalid 000 ID/EGO count for ${name}.`;
        }
        return;
      }

      if (!Number.isFinite(goal00Num) || goal00Num < 0) {
        if (sinnerShardsErrorEl) {
          sinnerShardsErrorEl.textContent =
            `Invalid 00 ID count for ${name}.`;
        }
        return;
      }

      const shardsInt = Math.floor(shardNum);
      const g000Int = Math.floor(goal000Num);
      const g00Int = Math.floor(goal00Num);

      updatedShards[name] = shardsInt;
      updatedGoals[name] = { count000: g000Int, count00: g00Int };
      updatedTargets[name] = g000Int * costPer000 + g00Int * costPer00;
    }

    state.sinnerShards = {
      ...state.sinnerShards,
      ...updatedShards,
    };

    state.sinnerGoals = {
      ...state.sinnerGoals,
      ...updatedGoals,
    };

    state.sinnerTargets = {
      ...state.sinnerTargets,
      ...updatedTargets,
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

// ----- Initial setup -----
initSinnerSelect();
buildSinnerShardsUI();
render();
