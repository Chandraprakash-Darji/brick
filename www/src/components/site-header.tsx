import { Link, useLocation } from "@tanstack/react-router"
import { GitHubIcon } from "@/components/icons"
import { Wordmark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { site } from "@/lib/site"

const navLink = "text-muted-foreground transition-colors hover:text-foreground data-current:text-foreground"

export function SiteHeader() {
  const pathname = useLocation({ select: (l) => l.pathname })
  return (
    <header className="frame sticky top-0 z-40 flex h-14 items-center gap-6 border-b bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <Link to="/">
        <Wordmark />
      </Link>
      <nav className="hidden items-center gap-5 text-sm sm:flex">
        <Link to="/" className={navLink} data-current={pathname === "/" || undefined}>
          Home
        </Link>
        <Link to="/benchmarks" className={navLink} data-current={pathname.startsWith("/benchmarks") || undefined}>
          Benchmarks
        </Link>
        <a href={`${site.repo}/tree/main/bench`} target="_blank" rel="noreferrer" className={navLink}>
          Bench Lab
        </a>
        <a href={`${site.repo}/tree/main/docs`} target="_blank" rel="noreferrer" className={navLink}>
          Docs
        </a>
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
