import { Link } from "@tanstack/react-router"
import { site } from "@/lib/site"

export function SiteFooter() {
  return (
    <footer className="frame label flex flex-wrap items-center justify-between gap-4 border-t px-4 py-6 sm:px-6">
      <span>
        Brick v{site.version} ·{" "}
        <a href={`${site.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="hover:text-foreground">
          MIT License
        </a>
      </span>
      <nav className="flex gap-6">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <Link to="/benchmarks" className="hover:text-foreground">
          Benchmarks
        </Link>
        <a href={`${site.repo}/tree/main/bench`} target="_blank" rel="noreferrer" className="hover:text-foreground">
          Bench Lab
        </a>
        <a href={`${site.repo}/releases`} target="_blank" rel="noreferrer" className="hover:text-foreground">
          Releases
        </a>
        <a href={site.repo} target="_blank" rel="noreferrer" className="hover:text-foreground">
          GitHub
        </a>
      </nav>
    </footer>
  )
}
