import { Link } from "@tanstack/react-router"
import { ArrowUpRightIcon } from "lucide-react"
import { Wordmark } from "@/components/logo"
import { site } from "@/lib/site"

export function SiteFooter() {
  return (
    <footer className="frame home-footer">
      <div className="home-footer-main">
        <div className="footer-brand"><Link to="/" aria-label="Brick home"><Wordmark /></Link><p>TypeScript definitions.<br />Production execution.</p><a href={site.repo} target="_blank" rel="noreferrer">Open source, built for Bun <ArrowUpRightIcon className="size-3" /></a></div>
        <nav aria-label="Platform links"><p className="label">Platform</p><Link to="/docs/$" params={{ _splat: "resources" }}>Resources</Link><Link to="/docs/$" params={{ _splat: "access-control" }}>Access control</Link><Link to="/docs/$" params={{ _splat: "migrations" }}>Databases</Link><Link to="/docs/$" params={{ _splat: "plugins" }}>Extensions</Link></nav>
        <nav aria-label="Developer links"><p className="label">Developers</p><Link to="/docs/$" params={{ _splat: "getting-started" }}>Getting started</Link><Link to="/docs/$" params={{ _splat: "" }}>Documentation</Link><Link to="/benchmarks">Benchmarks</Link><a href={`${site.repo}/tree/main/examples`} target="_blank" rel="noreferrer">Examples</a></nav>
        <nav aria-label="Project links"><p className="label">Project</p><a href={site.repo} target="_blank" rel="noreferrer">GitHub</a><a href={`${site.repo}/releases`} target="_blank" rel="noreferrer">Releases</a><a href={`${site.repo}/issues`} target="_blank" rel="noreferrer">Issues</a><a href={`${site.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a></nav>
      </div>
      <div className="home-footer-bottom"><span>BRICK v{site.version}</span><span>TYPESCRIPT IN. BACKEND OUT.</span><a href="#site-top">BACK TO TOP ↑</a></div>
    </footer>
  )
}
