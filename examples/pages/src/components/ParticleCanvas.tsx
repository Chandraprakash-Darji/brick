import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export function ParticleCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxNull = canvas.getContext("2d");
    if (!ctxNull) return;
    const ctx: CanvasRenderingContext2D = ctxNull;

    const w = (canvas.width = canvas.offsetWidth);
    const h = (canvas.height = canvas.offsetHeight);
    const mouse = { x: w / 2, y: h / 2 };

    const N = 60;
    const particles = Array.from({ length: N }, () => ({
      opacity: Math.random() * 0.4 + 0.1,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      x: Math.random() * w,
      y: Math.random() * h,
    }));

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    canvas.addEventListener("mousemove", onMove);

    let raf = 0;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        if (Math.sqrt(dx * dx + dy * dy) < 120) {
          p.vx += dx * 0.00008;
          p.vy += dy * 0.00008;
        }
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(167,139,250,${p.opacity})`;
        ctx.fill();
      }
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 80) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(167,139,250,${0.08 * (1 - d / 80)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn("absolute inset-0 h-full w-full", className)}
    />
  );
}
