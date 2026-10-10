# Brick Cloud & CLI Master Roadmap

## 3. Pillar II: Brick Cloud (Using Coolify as the Infrastructure Base)

### 3.1 Why Coolify as the Base?

Coolify (`coollabsio/coolify`) is Apache 2.0 licensed, production-proven, and solves the hardest parts of self-hosted cloud infrastructure:

1. **Docker Engine Management:** Creating networks, starting containers, managing volumes, tracking health.
2. **Reverse Proxy & Edge Mesh:** Dynamic Traefik configuration, automated Let's Encrypt SSL certificates, domain routing.
3. **Multi-Server Management:** Connects to any VPS (Hetzner, AWS, Oracle Cloud) via SSH without complex cluster setups.
4. **Git Webhook Integrations:** Handles GitHub/GitLab webhook events and triggers build pipelines.

### 3.2 How We Customize It for Brick-TS ("Brick Cloud")

Instead of treating Brick apps as generic Dockerfiles, Brick Cloud adds **framework-aware intelligence**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Coolify Base Engine                             │
│   (SSH Workers, Docker Socket, Traefik Reverse Proxy, Let's Encrypt)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ powers
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Brick Cloud Specialization Layer                    │
│                                                                        │
│  1. Architecture IR Inspector: Reads `brick-ir.json` on push           │
│  2. Service Topology View: read-only routes/graph from IR in dashboard │
│  3. Action Tracing: Shows domain action latency (not just HTTP 200s)   │
│  4. Client SDK Registry: Auto-publishes `@org/client` on every deploy  │
│  5. Scale-to-Zero Postgres: Neon integration + Redis cache guard       │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3 System Architecture

1. **The Control Plane (Dashboard & API):**
   - Built with Brick-TS + Vite/React + shadcn/ui.
   - Manages projects, environments, team members, and billing (Stripe).
2. **The Deployment Worker (Coolify Core Engine):**
   - Connects to worker nodes (e.g. Free 24GB Oracle ARM or Hetzner servers).
   - Ingests Git pushes, runs `brick build` on the build runner (e.g. 32GB M1 Pro runner via Cloudflare Tunnel), and starts containers.
3. **The Ingress / Router:**
   - Traefik dynamically reloaded by the worker. Maps `project.brickcloud.io` and custom domains to container ports.
4. **The Database Layer:**
   - Primary: Integrated Postgres or Neon Partner API for instant database branching per Git PR.
   - Secondary: Redis for caching cron checks to prevent waking sleeping databases.

---

## 4. Implementation Phasing & Milestones

### Milestone 1: Build Runner & Image Pipeline

- Goal: An automated pipeline that builds Brick-TS monoliths into one optimized Docker image.
- Deliverables:
  - Standardized multi-stage Bun + Brick Dockerfile template (single `server.js` + `brick-ir.json`).
  - Setup M1 Pro runner using Cloudflare Tunnel and webhook listener.
  - Automated extraction and caching of `brick-ir.json` and generated client SDKs.

### Milestone 2: Coolify-Based Engine Integration

- Goal: Deploying Brick-TS apps to the free 24GB Oracle Cloud server.
- Deliverables:
  - Coolify core deployment worker running on Oracle Cloud.
  - Automated Traefik ingress configuration for Brick-TS web/API apps.
  - Live deployment log streaming via WebSockets.

### Milestone 3: Brick Cloud UI & Framework Magic

- Goal: The dedicated Brick Cloud developer dashboard.
- Deliverables:
  - Project creation and GitHub repo linking.
  - Visual service topology and action routes inspection in the browser.
  - Database provisioning (Neon scale-to-zero) and environment variable management.

---

## 5. Decision Log & Principles

| Decision                  | Choice                                 | Rationale                                                                                                       |
| :------------------------ | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **PaaS Engine Base**      | Coolify (Apache 2.0)                   | Permissive open-source, battle-tested Docker/Traefik integration, active community.                             |
| **CLI Runtime**           | Bun Shebang (`#!/usr/bin/env bun`)     | Instant startup (~10ms), native TypeScript execution, shared workspace dependencies.                            |
| **Initial Compute**       | Oracle 24GB ARM (Free) + M1 Pro Runner | Zero initial hosting cost, high build speed on Apple Silicon, arm64 container parity.                           |
| **Database Strategy**     | Neon Scale-to-Zero + Redis Guard       | Avoids paying for idle database compute; Redis prevents 1-minute crons from waking Postgres.                    |
| **Physical Partitioning** | Explicit non-goal                      | Single monolith artifact keeps CLI/Cloud small; no `partition`, no `--services` split, no distributed stubbing. |
