// Page sections, bottom (launch pad) to top (debris field). Used by the page and the readout.
export const CHAPTERS = [
  { id: "launch", label: "Launch pad", readout: "Launch pad" },
  { id: "predict", label: "Predict", readout: "Low orbit" },
  { id: "results", label: "Results", readout: "Low orbit" },
  { id: "method", label: "Method", readout: "Upper orbit" },
  { id: "play", label: "Debris field", readout: "Debris field" },
] as const;
