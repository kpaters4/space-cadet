import AscentScene from "@/components/AscentScene";
import GameEmbed from "@/components/GameEmbed";

const models = ["Baseline", "Logistic Regression", "Gradient Boosting"];

const sources = [
  ["CelesTrak Space Weather", "Daily solar flux (F10.7) and geomagnetic indices (Ap/Kp), from October 1957."],
  ["Space-Track satellite catalogue", "One row per object: launch date, orbit, type and radar cross-section."],
  ["Space-Track decay table", "When each object actually came down. These dates are the labels."],
  ["Space-Track gp_history", "Each object's orbit history, so a snapshot only uses what was known on that date."],
];

export default function Home() {
  return (
    <>
      <AscentScene />

      <main className="chapters">
        <section id="troposphere" className="chapter chapter-hero">
          <div className="panel reveal">
            <p className="eyebrow">Troposphere · 0–12 km</p>
            <h1>Space Cadet</h1>
            <p className="lead">
              Can we predict how many days a piece of space junk has left before it burns up,
              and does knowing what the Sun is doing make the prediction better?
            </p>
            <p>Scroll up through the atmosphere to the debris field.</p>
          </div>
        </section>

        <section id="stratosphere" className="chapter">
          <div className="panel reveal">
            <p className="eyebrow">Stratosphere · 12–50 km</p>
            <h2>The problem: space junk</h2>
            <p>
              We study junk only: debris, rocket bodies and unidentified objects. Active
              satellites are left out, because they use thrusters to hold their altitude, so
              when they come down is the operator&apos;s decision, not physics.
            </p>
            <p>
              Every object has a catalogue number. The satellite catalogue records its launch
              date, orbit, type and radar cross-section.
            </p>
          </div>
        </section>

        <section id="mesosphere" className="chapter">
          <div className="panel reveal">
            <p className="eyebrow">Mesosphere · 50–85 km</p>
            <h2>Reentry and burn-up</h2>
            <p>
              Drag on an object depends on its area-to-mass ratio. The catalogue has no mass or
              area, so radar cross-section is the closest stand-in we have.
            </p>
            <p>
              Space-Track&apos;s decay table records when each object actually came down. Only
              historical records are used, not predictions. Those dates are what the models
              learn from.
            </p>
          </div>
        </section>

        <section id="thermosphere" className="chapter chapter-tall">
          <div className="panel reveal">
            <p className="eyebrow">Thermosphere · 85–600 km</p>
            <h2>The Sun and the data</h2>
            <p>
              The second half of the question asks whether solar activity helps. We fit the same
              model with and without the Sun&apos;s recent history and compare the two. The gap
              between them is the answer.
            </p>
            <p>
              Each object is observed on the 1st of every month from 2015, using only data from
              before that date.
            </p>
            <h3>Data sources</h3>
            <dl className="sources">
              {sources.map(([name, what]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="upper-orbit" className="chapter">
          <div className="panel panel-wide reveal">
            <p className="eyebrow">Upper orbit · 600–780 km</p>
            <h2>Models</h2>
            <p>
              The models are still being built. Each one will be compared against a simple
              baseline. The team is still choosing the target; the recommended option is
              whether an object will reenter within the next 365 days.
            </p>
            <div className="model-grid">
              {models.map((name) => (
                <div key={name} className="model-card">
                  <h3>{name}</h3>
                  <p>Coming soon</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="debris-field" className="chapter chapter-game">
          <div className="panel panel-wide reveal">
            <p className="eyebrow">Debris field · 780 km</p>
            <h2>The game</h2>
            <p>
              You&apos;re a cadet with limited shots and a sky full of space junk. Shooting
              creates fragments, so the skill is knowing which pieces will fall on their own and
              which will stay up for decades.
            </p>
          </div>
          <GameEmbed />
        </section>
      </main>
    </>
  );
}
