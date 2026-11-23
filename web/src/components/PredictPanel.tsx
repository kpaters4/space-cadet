"use client";

// The prediction tool: a form that calls the live API's /predict, with presets,
// loading, success and error states, and a health badge from /health.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Rocket, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  ApiError,
  getHealth,
  predict,
  type ObjectType,
  type PredictInput,
  type PredictResult,
  type RcsSize,
} from "@/lib/api";

type Form = Record<Exclude<keyof PredictInput, "object_type" | "rcs_size">, string> & {
  object_type: ObjectType;
  rcs_size: RcsSize;
};

const PRESETS: { name: string; note: string; values: Form }[] = [
  {
    name: "Small debris, low orbit",
    note: "A fragment near 300 km that is losing altitude quickly.",
    values: { perigee_km: "290", apogee_km: "420", perigee_km_30d_ago: "318", inclination_deg: "74", bstar: "0.0011",
      object_type: "DEBRIS", rcs_size: "SMALL", age_days: "2400", f107_81d_mean: "150", ap_27d_mean: "12" },
  },
  {
    name: "Rocket body at 550 km",
    note: "A large spent stage in a higher, slowly decaying orbit.",
    values: { perigee_km: "550", apogee_km: "590", perigee_km_30d_ago: "551", inclination_deg: "98", bstar: "0.00008",
      object_type: "ROCKET BODY", rcs_size: "LARGE", age_days: "3600", f107_81d_mean: "150", ap_27d_mean: "12" },
  },
  {
    name: "Medium fragment, 420 km",
    note: "Somewhere in between: a slow, steady descent.",
    values: { perigee_km: "420", apogee_km: "460", perigee_km_30d_ago: "426", inclination_deg: "51.6", bstar: "0.0004",
      object_type: "DEBRIS", rcs_size: "MEDIUM", age_days: "1200", f107_81d_mean: "150", ap_27d_mean: "12" },
  },
];

const NUMBER_FIELDS: { key: keyof Form; label: string; unit: string; help: string; step: string }[] = [
  { key: "perigee_km", label: "Perigee now", unit: "km", help: "Lowest point of the orbit today.", step: "1" },
  { key: "apogee_km", label: "Apogee now", unit: "km", help: "Highest point of the orbit today.", step: "1" },
  { key: "perigee_km_30d_ago", label: "Perigee 30 days ago", unit: "km", help: "Used to work out how fast it is coming down.", step: "1" },
  { key: "inclination_deg", label: "Inclination", unit: "°", help: "Tilt of the orbit from the equator.", step: "0.1" },
  { key: "bstar", label: "BSTAR drag term", unit: "1/ER", help: "From the object's element set; higher means more drag.", step: "0.00001" },
  { key: "age_days", label: "Age", unit: "days", help: "Days since launch.", step: "1" },
  { key: "ap_27d_mean", label: "Geomagnetic Ap", unit: "27-day mean", help: "Higher during geomagnetic storms.", step: "1" },
];

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 || p > 0.99 ? 1 : 0)}%`;

export default function PredictPanel() {
  const [form, setForm] = useState<Form>(PRESETS[0].values);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<"checking" | "ok" | "no-model" | "down">("checking");

  useEffect(() => {
    getHealth()
      .then((h) => setHealth(h.loaded ? "ok" : "no-model"))
      .catch(() => setHealth("down"));
  }, []);

  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const fieldError = (key: string) => (error?.kind === "validation" ? error.fields[key] : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    const toNum = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
    const body = {
      ...Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, toNum(form[key])])),
      f107_81d_mean: toNum(form.f107_81d_mean),
      object_type: form.object_type,
      rcs_size: form.rcs_size,
    } as PredictInput;
    try {
      setResult(await predict(body));
      setHealth("ok");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("server", "Something went wrong."));
      if (err instanceof ApiError && (err.kind === "network" || err.kind === "timeout")) setHealth("down");
    } finally {
      setLoading(false);
    }
  }

  const solar = Number(form.f107_81d_mean) || 150;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <form onSubmit={submit} noValidate className="panel space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-amber">Describe a piece of junk</h3>
          <HealthBadge state={health} />
        </div>

        <div>
          <p className="mb-2 text-sm">Start from an example:</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.name} type="button" variant="outline" size="sm" title={p.note}
                onClick={() => { setForm(p.values); setResult(null); setError(null); }}>
                {p.name}
              </Button>
            ))}
          </div>
        </div>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="object_type">Object type</FieldLabel>
            <Select value={form.object_type} onValueChange={(v) => set("object_type", v)}>
              <SelectTrigger id="object_type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DEBRIS">Debris fragment</SelectItem>
                <SelectItem value="ROCKET BODY">Rocket body</SelectItem>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
                <SelectItem value="TBA">Not yet identified (TBA)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rcs_size">Radar size</FieldLabel>
            <Select value={form.rcs_size} onValueChange={(v) => set("rcs_size", v)}>
              <SelectTrigger id="rcs_size" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SMALL">Small (under 0.1 m²)</SelectItem>
                <SelectItem value="MEDIUM">Medium (0.1–1 m²)</SelectItem>
                <SelectItem value="LARGE">Large (over 1 m²)</SelectItem>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {NUMBER_FIELDS.map(({ key, label, unit, help, step }) => {
            const msg = fieldError(key);
            return (
              <Field key={key} data-invalid={msg ? true : undefined}>
                <FieldLabel htmlFor={key}>
                  {label} <span className="font-normal opacity-80">({unit})</span>
                </FieldLabel>
                <Input id={key} type="number" inputMode="decimal" step={step} value={form[key]}
                  aria-invalid={msg ? true : undefined} onChange={(e) => set(key, e.target.value)} />
                {msg ? <FieldError>{msg}</FieldError> : <FieldDescription>{help}</FieldDescription>}
              </Field>
            );
          })}

          <Field className="sm:col-span-2" data-invalid={fieldError("f107_81d_mean") ? true : undefined}>
            <FieldLabel htmlFor="f107">
              Solar activity: F10.7 flux, 81-day mean <span className="font-normal opacity-80">({solar} sfu)</span>
            </FieldLabel>
            <Slider id="f107" min={65} max={250} step={1} value={[solar]}
              onValueChange={([v]) => set("f107_81d_mean", String(v))} aria-label="Solar flux F10.7, 81-day mean" />
            <div className="flex justify-between text-xs"><span>Quiet Sun (65)</span><span>Very active Sun (250)</span></div>
            <FieldDescription>
              The training years (2015–2020) only reached about 156, so higher values are a what-if the model has not seen.
            </FieldDescription>
            {fieldError("f107_81d_mean") && <FieldError>{fieldError("f107_81d_mean")}</FieldError>}
          </Field>
        </FieldGroup>

        {/* Errors not tied to one number field, e.g. "apogee must be at least perigee". */}
        {error?.kind === "validation" &&
          Object.entries(error.fields)
            .filter(([k]) => !NUMBER_FIELDS.some((f) => f.key === k) && k !== "f107_81d_mean")
            .map(([k, m]) => (
              <p key={k} role="alert" className="text-sm text-[#ffb4a8]">{k === "request" ? m : `${k}: ${m}`}</p>
            ))}

        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
          {loading ? <><Loader2 className="animate-spin" /> Asking the model…</> : <><Rocket /> Predict reentry</>}
        </Button>
      </form>

      <div aria-live="polite" className="space-y-4">
        {loading && <LoadingCard />}
        {!loading && error && <ErrorAlert error={error} />}
        {!loading && result && <ResultCard result={result} />}
        {!loading && !error && !result && (
          <div className="panel text-sm">
            <p>Pick an example or enter your own values, then press <strong>Predict reentry</strong>.</p>
            <p className="mt-2">The answer comes from the team&apos;s fitted model, running live on Modal.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function HealthBadge({ state }: { state: "checking" | "ok" | "no-model" | "down" }) {
  if (state === "checking") return <Badge variant="outline"><Loader2 className="animate-spin" /> Checking API</Badge>;
  if (state === "ok") return <Badge className="bg-[#1f6f4a] text-[#eef4ff]"><CheckCircle2 /> API online</Badge>;
  if (state === "no-model") return <Badge variant="destructive"><TriangleAlert /> Model not loaded</Badge>;
  return <Badge variant="destructive"><AlertCircle /> API unreachable</Badge>;
}

function LoadingCard() {
  return (
    <Card className="panel-card" aria-busy="true">
      <CardHeader>
        <CardTitle>Asking the model…</CardTitle>
        <CardDescription className="text-[#c9d6ec]">The first request can take up to a minute while the server wakes up.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-10 w-2/3 bg-white/15" />
        <Skeleton className="h-3 w-full bg-white/15" />
        <Skeleton className="h-16 w-full bg-white/15" />
      </CardContent>
    </Card>
  );
}

function ErrorAlert({ error }: { error: ApiError }) {
  const title = {
    validation: "Check your inputs",
    unavailable: "Model unavailable",
    timeout: "The API timed out",
    network: "Can't reach the API",
    config: "API not configured",
    server: "Something went wrong",
  }[error.kind];
  return (
    <Alert variant="destructive" className="panel-alert">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

function ResultCard({ result }: { result: PredictResult }) {
  const { probability: p, reenters_within_365d: yes, physics_baseline: base } = result;
  return (
    <Card className="panel-card">
      <CardHeader>
        <CardDescription className="text-[#c9d6ec]">Chance it reenters within 365 days</CardDescription>
        <CardTitle className="text-4xl text-amber">{pct(p)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/15" aria-hidden="true">
          <div className="h-full origin-left rounded-full bg-amber" style={{ transform: `scaleX(${p})` }} />
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">Model&apos;s call</dt>
            <dd>{yes ? "Will fall within a year: let it burn up." : "Will stay up longer than a year."}
              <span className="block opacity-80">Threshold {result.threshold.toFixed(3)}, set on validation data.</span></dd>
          </div>
          <div>
            <dt className="font-semibold">Physics baseline</dt>
            <dd>{base.reenters_within_365d ? "Falls within a year" : "Stays up longer than a year"}
              <span className="block opacity-80">
                {base.days_to_120km === null ? "Not descending at its current rate." : `About ${Math.round(base.days_to_120km).toLocaleString()} days to reach 120 km at its current descent rate.`}
              </span></dd>
          </div>
        </dl>
        {result.out_of_training_range && (
          <Alert className="panel-alert border-amber/60">
            <TriangleAlert className="text-amber" />
            <AlertTitle>Outside what the model has seen</AlertTitle>
            <AlertDescription>
              {result.out_of_range_fields.join(", ")} {result.out_of_range_fields.length === 1 ? "is" : "are"} outside the training data&apos;s usual range, so treat this answer with care.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-xs opacity-80">Model {result.model_version}</p>
      </CardContent>
    </Card>
  );
}
