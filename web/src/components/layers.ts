// The six chapters of the ascent, bottom to top. Shared by the page and the scene.
// Altitudes are approximate and the scroll scale is compressed (not to scale).

export type Layer = {
  id: string;
  name: string;
  km: [number, number];
  /** Sky gradient, [top, bottom]. Blended continuously while scrolling. */
  sky: [string, string];
};

export const LAYERS: Layer[] = [
  { id: "troposphere", name: "Troposphere", km: [0, 12], sky: ["#2a6fd6", "#6fb3ff"] },
  { id: "stratosphere", name: "Stratosphere", km: [12, 50], sky: ["#0f2f6e", "#1b4fb0"] },
  { id: "mesosphere", name: "Mesosphere", km: [50, 85], sky: ["#0a1236", "#0b1d4a"] },
  { id: "thermosphere", name: "Thermosphere", km: [85, 600], sky: ["#080e24", "#080e24"] },
  { id: "upper-orbit", name: "Upper orbit", km: [600, 780], sky: ["#050914", "#050914"] },
  { id: "debris-field", name: "Debris field", km: [780, 780], sky: ["#050914", "#050914"] },
];
