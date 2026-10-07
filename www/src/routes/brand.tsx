import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpRightIcon } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { BrandGuidelines, BrandSymbol } from "@/components/brand-guidelines";

export const Route = createFileRoute("/brand")({
  head: () => ({
    meta: [
      { title: "Brand · Brick" },
      {
        name: "description",
        content:
          "The Brick identity: the angular knot, logo downloads, usage guidelines, and brand applications.",
      },
    ],
  }),
  component: Brand,
});

const applications = [
  {
    file: "stationery",
    title: "On paper",
    text: "A simple mark, printed with confidence.",
    alt: "Brick angular knot printed on black and off-white business cards and letterhead",
  },
  {
    file: "laptop",
    title: "At work",
    text: "A small symbol for the things you build.",
    alt: "White angular knot sticker on a graphite laptop",
  },
  {
    file: "apparel",
    title: "Out in the world",
    text: "Made to travel beyond the screen.",
    alt: "Angular knot embroidered on a charcoal sweatshirt and printed on a canvas tote",
  },
];

function Brand() {
  return (
    <main className="brand-page">
      <section className="brand-intro">
        <p className="label">THE BRICK IDENTITY</p>
        <LogoMark className="brand-hero-mark" />
        <h1>
          Parts that fit.
          <br />
          An identity that holds.
        </h1>
        <p className="brand-lead">
          The angular knot brings separate forms together into one compact
          symbol. Open at its center. Connected at its edges. Built from the
          same idea as Brick.
        </p>
        <div className="hero-actions">
          <a
            href="/brand/brand-kit.zip"
            download
            className="home-button home-button-primary"
          >
            Download brand kit
            <ArrowDownIcon className="size-3.5" />
          </a>
          <a
            href="/brand/logo.svg"
            download
            className="home-button home-button-secondary"
          >
            Get the SVG
            <ArrowDownIcon className="size-3.5" />
          </a>
        </div>
      </section>

      <section className="brand-section" aria-labelledby="brand-symbol">
        <div className="brand-section-heading">
          <div>
            <p className="label">01 / THE SYMBOL</p>
            <h2 id="brand-symbol">One shape. Room to breathe.</h2>
          </div>
          <p>
            Keep the silhouette, proportions, and open spaces intact. A single
            color lets the geometry do the work.
          </p>
        </div>
        <div className="brand-symbols">
          <div className="brand-symbol-panel">
            <BrandSymbol />
            <span className="label">PRIMARY</span>
          </div>
          <div className="brand-symbol-panel brand-symbol-inverse">
            <BrandSymbol />
            <span className="label">REVERSE</span>
          </div>
        </div>
        <div className="brand-asset-links">
          <a href="/brand/logo.svg" download>
            Vector / SVG <ArrowDownIcon className="size-3" />
          </a>
          <a href="/brand/logo.png" download>
            Transparent / PNG <ArrowDownIcon className="size-3" />
          </a>
        </div>
      </section>

      <section className="brand-section" aria-labelledby="brand-guidelines">
        <div className="brand-section-heading">
          <div>
            <p className="label">02 / CONSTRUCTION & USAGE</p>
            <h2 id="brand-guidelines">A considered system.</h2>
          </div>
          <a
            className="capability-link"
            href="/brand/guidelines.html"
            target="_blank"
            rel="noreferrer"
          >
            Open printable guide
            <ArrowUpRightIcon className="size-3" />
          </a>
        </div>
        <BrandGuidelines />
        <div className="brand-rules">
          <article>
            <p className="label">CLEAR SPACE</p>
            <h3>Give it a quarter.</h3>
            <p>
              Leave at least one-quarter of the visible symbol’s width clear on
              every side. Measure from the mark, excluding transparent canvas
              padding.
            </p>
          </article>
          <article>
            <p className="label">MINIMUM SIZE</p>
            <h3>Start at 24 px.</h3>
            <p>
              Use a visible symbol width of at least 24 px. Keep its central
              opening and joins clear at the intended display size.
            </p>
          </article>
          <article>
            <p className="label">KEEP THE FORM</p>
            <h3>Let the shape speak.</h3>
            <p>
              Preserve its orientation and proportions. Avoid stretching,
              outlines, gradients, shadows, and separate colors on its forms.
            </p>
          </article>
        </div>
        <p className="brand-note">
          Construction guides present a geometry study of the selected symbol.
        </p>
      </section>

      <section className="brand-section" aria-labelledby="brand-palette">
        <div className="brand-section-heading">
          <div>
            <p className="label">03 / THE PALETTE</p>
            <h2 id="brand-palette">Quiet colors. Clear contrast.</h2>
          </div>
          <p>
            Near-black and off-white form the foundation. Reverse the mark to
            white on dark surfaces.
          </p>
        </div>
        <div className="brand-palette">
          <div style={{ background: "#171716", color: "#fff" }}>
            <span>Ink</span>
            <span>#171716</span>
          </div>
          <div style={{ background: "#F5F5F3", color: "#171716" }}>
            <span>Paper</span>
            <span>#F5F5F3</span>
          </div>
          <div style={{ background: "#FFFFFF", color: "#171716" }}>
            <span>White</span>
            <span>#FFFFFF</span>
          </div>
        </div>
      </section>

      <section className="brand-section" aria-labelledby="brand-applications">
        <div className="brand-section-heading">
          <div>
            <p className="label">04 / IN CONTEXT</p>
            <h2 id="brand-applications">A mark that goes places.</h2>
          </div>
          <p>
            Three applications of the same identity, from your desk to the
            everyday.
          </p>
        </div>
        <div className="brand-applications">
          {applications.map((item) => (
            <article key={item.file}>
              <a
                href={`/brand/mockups/${item.file}.png`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${item.title.toLowerCase()} mockup`}
              >
                <img
                  src={`/brand/mockups/${item.file}.png`}
                  width={1536}
                  height={1024}
                  loading="lazy"
                  alt={item.alt}
                />
              </a>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <p className="brand-note">
          Mockups illustrate applications; they are concept presentations.
        </p>
      </section>

      <section className="brand-download">
        <p className="label">MAKE IT YOURS</p>
        <h2>Everything in one place.</h2>
        <p>
          The vector logo, transparent PNG, guidelines, and all three mockups.
        </p>
        <a
          href="/brand/brand-kit.zip"
          download
          className="home-button home-button-primary"
        >
          Download brand kit
          <ArrowDownIcon className="size-3.5" />
        </a>
      </section>
    </main>
  );
}
