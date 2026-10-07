import { Link, useLocation } from "@tanstack/react-router"
import { GitHubIcon } from "@/components/icons"
import { Wordmark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { site } from "@/lib/site"

const navLink = "text-muted-foreground transition-colors hover:text-foreground data-current:text-gopher-ink data-current:font-medium"

export function SiteHeader() {
  const pathname = useLocation({ select: (l) => l.pathname })
  return (
    <header className="frame sticky top-0 z-40 flex flex-wrap items-center gap-x-8 gap-y-3 border-b bg-background/95 py-5 backdrop-blur-xl">
      <Link to="/">
        <Wordmark />
      </Link>
      <nav className="order-3 flex w-full items-center gap-6 text-sm sm:order-none sm:w-auto">
        <Link to="/" className={navLink} data-current={pathname === "/" || undefined}>
          Home
        </Link>
        <Link to="/benchmarks" className={navLink} data-current={pathname.startsWith("/benchmarks") || undefined}>
          Benchmarks
        </Link>
        <Link to="/docs/$" params={{ _splat: "" }} className={navLink} data-current={pathname.startsWith("/docs") || undefined}>
          Docs
        </Link>
        <a href={`${site.repo}/tree/main/examples`} target="_blank" rel="noreferrer" className={navLink}>
          Examples
        </a>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <a
          href={site.repo}
          aria-label="GitHub"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <GitHubIcon className="size-4" />
        </a>
        <ThemeToggle />
      </div>
    </header>
  )
}
