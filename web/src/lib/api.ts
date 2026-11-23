// Client for the Space Cadet reentry API (FastAPI on Modal).
// The base URL comes from NEXT_PUBLIC_API_URL (set it in Vercel and in .env.local).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

/** Modal can take a while to wake a cold container. */
const TIMEOUT_MS = 60_000;

export type ObjectType = "DEBRIS" | "ROCKET BODY" | "UNKNOWN" | "TBA";
export type RcsSize = "SMALL" | "MEDIUM" | "LARGE" | "UNKNOWN";

export type PredictInput = {
  perigee_km: number;
  apogee_km: number;
  perigee_km_30d_ago: number;
  inclination_deg: number;
  bstar: number;
  object_type: ObjectType;
  rcs_size: RcsSize;
  age_days: number;
  f107_81d_mean: number;
  ap_27d_mean: number;
};

export type PredictResult = {
  probability: number;
  reenters_within_365d: boolean;
  threshold: number;
  physics_baseline: { reenters_within_365d: boolean; days_to_120km: number | null };
  out_of_training_range: boolean;
  out_of_range_fields: string[];
  model_version: string;
};

export type Health = { status: string; loaded: boolean; error: string | null };

export type PipelineInfo = {
  model_version: string;
  sklearn_version: string;
  steps: string[];
  threshold: number;
  fit_on: string;
  rows: { train: number; valid: number; fitted: number };
  objects: { train: number; valid: number };
  validation_metrics: Record<"model" | "physics_baseline" | "training_rate_baseline",
    { pr_auc: number; brier: number; roc_auc: number; "recall_at_far_0.10": number }>;
};

export type ApiErrorKind = "config" | "validation" | "unavailable" | "timeout" | "network" | "server";

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    /** field name -> message, for 422 responses */
    public fields: Record<string, string> = {},
    public status?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError("config", "The API address is not configured (NEXT_PUBLIC_API_URL).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError("timeout", "The API took too long to answer. It may be waking up; try again.");
    }
    throw new ApiError("network", "Could not reach the API. Check your connection, or the service may be down.");
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return (await res.json()) as T;

  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const fields: Record<string, string> = {};
    for (const d of (body?.detail ?? []) as { loc?: (string | number)[]; msg?: string }[]) {
      const loc = d.loc ?? [];
      const key = String(loc[loc.length - 1] ?? "request");
      fields[key === "body" ? "request" : key] = (d.msg ?? "Invalid value").replace(/^Value error, /, "");
    }
    throw new ApiError("validation", "Some inputs were rejected. Check the highlighted fields.", fields, 422);
  }
  if (res.status === 503) {
    throw new ApiError("unavailable", "The model is not available right now (the API returned 503).", {}, 503);
  }
  throw new ApiError("server", `The API returned an unexpected error (${res.status}).`, {}, res.status);
}

export const getHealth = () => request<Health>("/health");
export const getPipelineInfo = () => request<PipelineInfo>("/pipeline-info");
export const predict = (input: PredictInput) =>
  request<PredictResult>("/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
