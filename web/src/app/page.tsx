const models = ["Baseline", "Logistic Regression", "Gradient Boosting"];

export default function Home() {
  return (
    <>
      <nav className="sticky top-0 z-10 border-b border-white/10 bg-space/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl gap-6 px-4 py-3">
          <a href="#intro" className="font-bold text-amber">Space Cadet</a>
          <a href="#intro" className="hover:text-amber">Intro</a>
          <a href="#models" className="hover:text-amber">Models</a>
          <a href="#game" className="hover:text-amber">Game</a>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl space-y-16 px-4 py-12">
        <section id="intro" className="scroll-mt-16 space-y-4">
          <h1 className="text-4xl font-bold">Space Cadet</h1>
          <p className="text-lg">
            Can we predict how many days a piece of space junk has left before it
            burns up, and does knowing what the Sun is doing make the prediction
            better?
          </p>
          <p className="opacity-80">
            Placeholder: a short introduction to space debris and why reentry
            matters.
          </p>
          <p className="opacity-80">
            Placeholder: the data we used and how the game connects to the models.
          </p>
        </section>

        <section id="models" className="scroll-mt-16 space-y-4">
          <h2 className="text-2xl font-bold">Models</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {models.map((name) => (
              <div key={name} className="rounded border border-white/15 p-4">
                <h3 className="font-semibold">{name}</h3>
                <p className="mt-2 text-sm opacity-70">Coming soon</p>
              </div>
            ))}
          </div>
        </section>

        <section id="game" className="scroll-mt-16 space-y-4">
          <h2 className="text-2xl font-bold">Game</h2>
          <iframe
            src="/game/world.html"
            title="Space Cadet game"
            allow="fullscreen"
            className="w-full rounded border border-white/15"
            style={{ aspectRatio: "16 / 10" }}
          />
          <a
            href="/game/world.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded border border-amber px-4 py-2 text-amber hover:bg-amber hover:text-space"
          >
            Play fullscreen
          </a>
        </section>
      </main>
    </>
  );
}
