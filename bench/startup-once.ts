#!/usr/bin/env bun
/**
 * Single cold-start probe for `hyperfine`:
 *   hyperfine --warmup 5 --runs 30 'bun bench/startup-once.ts'
 * Prints one line: `cold_start_ms=<n> rss_mb=<n>`.
 */
import { measureStartup } from "./startup";

const s = await measureStartup(100, 3499);
console.log(
  `cold_start_ms=${(s.build_ms + s.listen_ms).toFixed(2)} rss_mb=${s.rss_mb}`,
);
