// D3 results, copied from the outputs of the team's notebooks on main:
//   src/Models/classification_with_PLAN_requirements.ipynb       (training CV + validation)
//   src/Models/classification_with_PLAN_requirements_test.ipynb  (test, descriptive)
// and the Sun check in PLAN.md "Known gaps" (time-ordered cross-validation, PR #7).
// Target: reenters_within_horizon (reenters within 365 days of the snapshot).

export type Row = { model: string; kind: "model" | "baseline"; prAuc: number; prAucCi?: [number, number]; brier: number; rocAuc: number; recallAtFar10: number };

export const VALIDATION = {
  rows: 4954,
  objects: 612,
  positiveRate: 0.299,
  table: [
    { model: "Gradient boosting, with Sun", kind: "model", prAuc: 0.9588, prAucCi: [0.9446, 0.9696], brier: 0.0681, rocAuc: 0.9793, recallAtFar10: 0.9338 },
    { model: "Gradient boosting, no Sun", kind: "model", prAuc: 0.9576, prAucCi: [0.9448, 0.9697], brier: 0.0568, rocAuc: 0.9785, recallAtFar10: 0.9325 },
    { model: "Logistic regression, no Sun", kind: "model", prAuc: 0.8801, prAucCi: [0.8445, 0.9097], brier: 0.0882, rocAuc: 0.9444, recallAtFar10: 0.8292 },
    { model: "Logistic regression, with Sun", kind: "model", prAuc: 0.8789, prAucCi: [0.8466, 0.9096], brier: 0.0935, rocAuc: 0.9411, recallAtFar10: 0.8197 },
    { model: "Physics baseline (perigee descent)", kind: "baseline", prAuc: 0.3901, prAucCi: [0.3551, 0.4292], brier: 0.2582, rocAuc: 0.5814, recallAtFar10: 0.1823 },
    { model: "Training-rate baseline", kind: "baseline", prAuc: 0.299, prAucCi: [0.2634, 0.3369], brier: 0.2706, rocAuc: 0.5, recallAtFar10: 0 },
  ] satisfies Row[],
};

export const TEST = {
  rows: 6921,
  objects: 508,
  table: [
    { model: "Gradient boosting, with Sun (selected)", kind: "model", prAuc: 0.9391, prAucCi: [0.9218, 0.9531], brier: 0.0458, rocAuc: 0.977, recallAtFar10: 0.9268 },
    { model: "Gradient boosting, no Sun", kind: "model", prAuc: 0.935, prAucCi: [0.915, 0.95], brier: 0.0602, rocAuc: 0.9757, recallAtFar10: 0.9199 },
    { model: "Logistic regression, no Sun", kind: "model", prAuc: 0.8292, prAucCi: [0.7964, 0.8609], brier: 0.083, rocAuc: 0.9368, recallAtFar10: 0.775 },
    { model: "Logistic regression, with Sun", kind: "model", prAuc: 0.7916, prAucCi: [0.757, 0.8262], brier: 0.121, rocAuc: 0.9132, recallAtFar10: 0.7267 },
    { model: "Physics baseline (perigee descent)", kind: "baseline", prAuc: 0.3267, brier: 0.1786, rocAuc: 0.5961, recallAtFar10: 0.2084 },
    { model: "Training-rate baseline", kind: "baseline", prAuc: 0.2094, brier: 0.1903, rocAuc: 0.5, recallAtFar10: 0 },
  ] satisfies Row[],
};

/** Sun minus no-Sun, PR-AUC, paired object bootstrap. */
export const SUN = {
  testBoosting: { delta: 0.0041, ci: [-0.0022, 0.0108] as [number, number] },
  testLogistic: { delta: -0.0376, ci: [-0.0478, -0.0275] as [number, number] },
  cvBoosting: 0.019,
  cvLogistic: -0.013,
};

/** Test errors for the selected model, by perigee band (counts from the test notebook). */
export const ERRORS_BY_PERIGEE = [
  { band: "≤ 200 km", rows: 102, objects: 27, positiveRate: 0.461, errorRate: 0.343, fp: 35, fn: 0 },
  { band: "200–400 km", rows: 1585, objects: 182, positiveRate: 0.235, errorRate: 0.098, fp: 154, fn: 2 },
  { band: "400–600 km", rows: 5234, objects: 410, positiveRate: 0.197, errorRate: 0.185, fp: 933, fn: 37 },
];
