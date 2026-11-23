import { ArrowDown, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GameEmbed from "@/components/GameEmbed";
import LaunchScene from "@/components/LaunchScene";
import PredictPanel from "@/components/PredictPanel";
import ResultsSection from "@/components/ResultsSection";

const SOURCES = [
  ["CelesTrak Space Weather", "Daily solar flux (F10.7) and geomagnetic indices (Ap/Kp) since October 1957."],
  ["Space-Track satellite catalogue", "One row per object: launch date, type, orbit and radar size."],
  ["Space-Track decay table", "When each object actually came down. Only historical records count, never predictions."],
  ["Space-Track orbit history (gp_history)", "Each object's orbit over time, so every snapshot uses only what was known on that date."],
];

export default function Home() {
  return (
    <>
      <LaunchScene />

      <main className="chapters">
        <section id="launch" className="chapter chapter-hero">
          <div className="panel reveal max-w-xl space-y-5">
            <p className="eyebrow">DTSC 3602 · Team 8</p>
            <h1>Space Cadet</h1>
            <p className="lead">
              Will this piece of space junk fall back to Earth within a year? And does knowing what the Sun is
              doing make that prediction better?
            </p>
            <p>
              Thousands of dead fragments and spent rocket stages circle the Earth. Drag slowly pulls them down,
              and solar activity changes how much drag there is. We trained models on years of tracking data to
              predict which pieces will reenter within 365 days.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="#predict"><ArrowDown aria-hidden="true" /> Try the model</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#play"><Gamepad2 aria-hidden="true" /> Play the game</a>
              </Button>
            </div>
          </div>
        </section>

        {/* The climb: open sky between the pad and space. */}
        <div className="climb" aria-hidden="true" />

        <section id="predict" className="chapter">
          <div className="reveal space-y-6">
            <div className="panel max-w-2xl space-y-3">
              <p className="eyebrow">Low orbit · Predict</p>
              <h2>Ask the model</h2>
              <p>
                Describe one object as it is today. The website sends it to our API, which runs the fitted
                scikit-learn pipeline and answers with a probability, its yes-or-no call, and what a simple physics
                rule would have said.
              </p>
            </div>
            <PredictPanel />
          </div>
        </section>

        <section id="results" className="chapter">
          <div className="reveal space-y-6">
            <div className="panel max-w-2xl space-y-3">
              <p className="eyebrow">Low orbit · Results</p>
              <h2>How well it works</h2>
              <p>
                We compared two candidate models against two baselines, each with and without space-weather
                features, using the same splits and metrics.
              </p>
            </div>
            <ResultsSection />
          </div>
        </section>

        <section id="method" className="chapter">
          <div className="reveal grid gap-6 lg:grid-cols-2">
            <div className="panel space-y-4 lg:col-span-2">
              <p className="eyebrow">Upper orbit · Method</p>
              <h2>How we built it</h2>
              <p>
                Each row is one object on the 1st of a month between 2015 and a year before the data ends, so every
                snapshot has a full year of follow-up. The label is whether the object reentered within 365 days.
                We kept junk only: debris, rocket bodies and unidentified objects. Active satellites steer, so their
                reentry is a decision, not physics.
              </p>
            </div>
            <div className="panel space-y-3">
              <h3 className="text-xl font-semibold text-amber">Data</h3>
              <dl className="space-y-3">
                {SOURCES.map(([name, what]) => (
                  <div key={name}>
                    <dt className="font-semibold">{name}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="panel space-y-3">
              <h3 className="text-xl font-semibold text-amber">Keeping it honest</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li>Orbit features come from the latest element set before each snapshot, never from the catalogue&apos;s final values, which already reflect the fall.</li>
                <li>Space weather is taken from the day before the snapshot, observed values only.</li>
                <li>Each object sits in exactly one split: training 2015–2020, validation 2022, test 2024 onward, with gap years between.</li>
                <li>Preprocessing is fitted on training data only; the model and threshold were chosen on validation.</li>
              </ul>
            </div>
            <div className="panel space-y-3">
              <h3 className="text-xl font-semibold text-amber">Limits and bias risks</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li><strong>Tracking bias.</strong> Small debris is tracked unevenly, and older records are thinner, so the catalogue is not a random sample. Check: errors are reported by object type and radar size, with counts.</li>
                <li><strong>One solar period.</strong> Validation and test both fall in high solar activity, so the Sun result may not hold in a quiet Sun. Check: solar features are compared with time-ordered cross-validation inside training.</li>
                <li><strong>No mass or area.</strong> Drag depends on area-to-mass ratio, but the catalogue has neither; radar size is the only stand-in.</li>
                <li><strong>Prediction, not cause.</strong> A feature that helps the model does not prove it causes reentry.</li>
              </ul>
            </div>
            <div className="panel space-y-3">
              <h3 className="text-xl font-semibold text-amber">The model behind the API</h3>
              <p>
                The website&apos;s model uses only the ten fields in the form. A custom transformer turns them into
                features such as descent rate, eccentricity, days to reach 120 km and a drag × solar term, and
                learns the training ranges so it can warn about unusual inputs. It feeds a gradient-boosting
                classifier, the family selected on validation.
              </p>
              <p>
                Built by Team 8 for DTSC 3602. AI assistance (Claude Code) was used within the course policy; the
                final report lists each member&apos;s contribution.
              </p>
            </div>
          </div>
        </section>

        <section id="play" className="chapter chapter-game">
          <div className="panel reveal max-w-2xl space-y-3">
            <p className="eyebrow">780 km · Debris field</p>
            <h2>Now you decide</h2>
            <p>
              You&apos;re a cadet with limited shots and a sky full of space junk. Shooting creates fragments, so
              the skill is knowing which pieces will fall on their own and which will stay up for decades.
            </p>
          </div>
          <GameEmbed />
        </section>
      </main>
    </>
  );
}
