import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ERRORS_BY_PERIGEE, SUN, TEST, VALIDATION, type Row } from "@/content/results";

const f = (v: number, d = 3) => v.toFixed(d);
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(3)}`;

function MetricsTable({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[36rem]">
        <TableCaption className="text-left text-[#c9d6ec]">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="border-white/15">
            <TableHead className="text-[#eef4ff]">Model</TableHead>
            <TableHead className="text-right text-[#eef4ff]">PR-AUC ↑</TableHead>
            <TableHead className="text-right text-[#eef4ff]">Brier ↓</TableHead>
            <TableHead className="text-right text-[#eef4ff]">ROC AUC ↑</TableHead>
            <TableHead className="text-right text-[#eef4ff]">Recall at ≤10% false alarms ↑</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.model} className="border-white/10">
              <TableCell className={r.kind === "baseline" ? "italic" : "font-medium"}>{r.model}</TableCell>
              <TableCell className="text-right tabular-nums">
                {f(r.prAuc)}
                {r.prAucCi && <span className="block text-xs opacity-80">[{f(r.prAucCi[0])}, {f(r.prAucCi[1])}]</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{f(r.brier)}</TableCell>
              <TableCell className="text-right tabular-nums">{f(r.rocAuc)}</TableCell>
              <TableCell className="text-right tabular-nums">{f(r.recallAtFar10)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ResultsSection() {
  return (
    <div className="space-y-6">
      <div className="panel space-y-4">
        <h3 className="text-xl font-semibold text-amber">Both models beat both baselines by a wide margin</h3>
        <p>
          On validation data, gradient boosting ranks objects far better than the physics baseline (PR-AUC 0.959
          vs 0.390) or simply guessing the training rate (0.299). It was selected on validation PR-AUC, with the
          Brier score as the tie-breaker. PR-AUC is the main metric because only a minority of snapshots
          reenter within a year.
        </p>
        <Tabs defaultValue="valid" className="w-full">
          <TabsList className="bg-white/10">
            <TabsTrigger value="valid">Validation (2022)</TabsTrigger>
            <TabsTrigger value="test">Test (2024 onward)</TabsTrigger>
          </TabsList>
          <TabsContent value="valid" className="pt-3">
            <MetricsTable rows={VALIDATION.table}
              caption={`Validation: ${VALIDATION.rows.toLocaleString()} snapshots of ${VALIDATION.objects} objects, ${(VALIDATION.positiveRate * 100).toFixed(1)}% reentered within a year. PR-AUC brackets are 95% intervals from resampling objects.`} />
          </TabsContent>
          <TabsContent value="test" className="pt-3">
            <MetricsTable rows={TEST.table}
              caption={`Test: ${TEST.rows.toLocaleString()} snapshots of ${TEST.objects} objects. An earlier notebook version already looked at this split, so treat these as a development holdout, not an untouched final test.`} />
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel space-y-3">
          <h3 className="text-xl font-semibold text-amber">Does knowing the Sun help? No clear effect yet</h3>
          <p>We fitted each model with and without 32 solar and geomagnetic features and compared them on the same objects.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Gradient boosting on test: PR-AUC {signed(SUN.testBoosting.delta)} with the Sun (95% interval {signed(SUN.testBoosting.ci[0])} to {signed(SUN.testBoosting.ci[1])}), so no reliable gain.</li>
            <li>Logistic regression on test: {signed(SUN.testLogistic.delta)}, so the extra features made it worse.</li>
            <li>Time-ordered cross-validation within training: {signed(SUN.cvBoosting)} for boosting, {signed(SUN.cvLogistic)} for logistic regression.</li>
          </ul>
          <p>
            Validation (2022) and every test snapshot fall in a period of high solar activity, so these splits cannot
            tell &ldquo;the Sun does not matter&rdquo; apart from &ldquo;these years never tested it&rdquo;.
          </p>
        </div>

        <div className="panel space-y-3">
          <h3 className="text-xl font-semibold text-amber">Where the selected model goes wrong</h3>
          <p>Test errors for gradient boosting with the Sun, at the threshold locked on validation, by perigee:</p>
          <div className="overflow-x-auto">
            <Table className="min-w-[26rem]">
              <TableHeader>
                <TableRow className="border-white/15">
                  <TableHead className="text-[#eef4ff]">Perigee</TableHead>
                  <TableHead className="text-right text-[#eef4ff]">Objects</TableHead>
                  <TableHead className="text-right text-[#eef4ff]">Error rate</TableHead>
                  <TableHead className="text-right text-[#eef4ff]">False alarms</TableHead>
                  <TableHead className="text-right text-[#eef4ff]">Missed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ERRORS_BY_PERIGEE.map((r) => (
                  <TableRow key={r.band} className="border-white/10">
                    <TableCell>{r.band}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.objects}</TableCell>
                    <TableCell className="text-right tabular-nums">{(r.errorRate * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.fp}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.fn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p>
            Almost all mistakes are false alarms: the threshold was set to catch nearly every reentry, so the model
            errs on the side of &ldquo;it will fall&rdquo;. Very low objects (below 200 km) are the hardest, but that group is small.
          </p>
        </div>
      </div>
    </div>
  );
}
