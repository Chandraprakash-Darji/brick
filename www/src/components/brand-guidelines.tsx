import { useId, type SVGProps } from "react";

// The two paths trace the approved angular-knot logo.
function KnotPaths() {
  return (
    <g fill="currentColor">
      <path d="M870 412 L869 697 L739 771 L916 877 L1071 788 L1070 527 Z" />
      <path d="M626 150 L183 403 L183 722 L372 846 L372 514 L626 371 L627 505 L410 629 L410 842 L783 1073 L920 995 L919 902 L470 633 L630 540 L830 658 L830 266 Z" />
    </g>
  );
}

export function BrandSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="183 150 889 924" aria-hidden="true" {...props}>
      <KnotPaths />
    </svg>
  );
}

function ConstructionStudy() {
  const gridId = useId();
  return (
    <svg
      className="brand-guide-diagram"
      viewBox="0 0 1600 1500"
      role="img"
      aria-label="Angular knot on a geometric construction grid"
    >
      <defs>
        <pattern
          id={gridId}
          width="111.125"
          height="111.125"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M111.125 0H0V111.125"
            className="brand-guide-grid"
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="1600" height="1500" fill={`url(#${gridId})`} />
      <g transform="translate(173 100)">
        <KnotPaths />
      </g>
      <g className="brand-guide-lines" fill="none">
        <rect
          x="356"
          y="250"
          width="889"
          height="924"
          strokeDasharray="12 12"
        />
        <path d="M356 500L1245 0M356 1174L1245 674M800 0V1500M0 712H1600" />
      </g>
    </svg>
  );
}

function ClearSpace() {
  return (
    <svg
      className="brand-guide-diagram"
      viewBox="0 0 1600 1500"
      role="img"
      aria-label="Clear space equal to one-quarter of visible symbol width around every side"
    >
      <g transform="translate(173 100)">
        <KnotPaths />
      </g>
      <g className="brand-guide-lines" fill="none">
        <rect
          x="356"
          y="250"
          width="889"
          height="924"
          strokeDasharray="12 12"
        />
        <rect x="133.75" y="27.75" width="1333.5" height="1368.5" />
        <path d="M133.75 712H356M800 27.75V250M1245 712H1467.25M800 1174V1396.25" />
      </g>
      <g className="brand-guide-dimensions">
        <text x="240" y="690">
          x
        </text>
        <text x="820" y="145">
          x
        </text>
        <text x="1340" y="690">
          x
        </text>
        <text x="820" y="1300">
          x
        </text>
      </g>
    </svg>
  );
}

export function BrandGuidelines() {
  return (
    <div className="brand-guideline-grid">
      <article className="brand-guide-panel">
        <p className="label">01 / CONSTRUCTION STUDY</p>
        <h3>Geometry and negative space.</h3>
        <ConstructionStudy />
        <p className="brand-guide-description">
          Angular edges, interlocking forms, and an open center. The guides
          illustrate the geometry of the selected symbol.
        </p>
      </article>
      <article className="brand-guide-panel">
        <p className="label">02 / FINAL SYMBOL</p>
        <h3>One shape. Two treatments.</h3>
        <div className="brand-guide-variants">
          <div>
            <BrandSymbol />
          </div>
          <div className="brand-guide-reverse">
            <BrandSymbol />
          </div>
        </div>
        <p className="brand-guide-description">
          A single-color mark on contrasting surfaces. Preserve its orientation,
          proportions, and the gaps between its forms.
        </p>
      </article>
      <article className="brand-guide-panel">
        <p className="label">03 / CLEAR SPACE</p>
        <h3>x = ¼ of the symbol width.</h3>
        <ClearSpace />
        <p className="brand-guide-description">
          Keep at least x clear on every side. Measure from the visible mark,
          excluding transparent canvas padding.
        </p>
      </article>
      <article className="brand-guide-panel">
        <p className="label">04 / MINIMUM SIZE</p>
        <h3>Small, but still distinct.</h3>
        <div className="brand-guide-sizes">
          {[24, 32, 48].map((size) => (
            <figure key={size}>
              <BrandSymbol style={{ width: size }} />
              <figcaption>{size} px</figcaption>
            </figure>
          ))}
        </div>
        <p className="brand-guide-description">
          Use a visible width of at least 24 px. Check that the central opening
          and angular joins remain clear at the intended display size.
        </p>
        <div className="brand-guide-size-callout">
          <BrandSymbol />
          <span>Keep the center open.</span>
        </div>
      </article>
    </div>
  );
}
