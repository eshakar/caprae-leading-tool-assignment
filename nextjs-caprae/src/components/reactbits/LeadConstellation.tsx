"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface LeadConstellationProps {
  /** Approximate node count for a 1000px-wide canvas; scales with area. */
  density?: number;
  /** Distance (px) under which two nodes are linked. */
  linkDistance?: number;
  /** Base node / link color (any CSS color). */
  color?: string;
  /** Color of the pulsing "hot lead" nodes. */
  hotColor?: string;
  /** Share of nodes rendered as hot leads (0-1). */
  hotRatio?: number;
  className?: string;
}

type Node = { x: number; y: number; vx: number; vy: number; r: number; hot: boolean; phase: number };

/**
 * An interactive "lead graph" background in the spirit of React Bits: drifting company nodes link up with
 * their neighbours, hot leads pulse, and the cursor acts as a scout that connects to nearby nodes and nudges
 * them aside. Pauses when off-screen or when the tab is hidden, and renders a still frame for reduced motion.
 */
export default function LeadConstellation({
  density = 70,
  linkDistance = 130,
  color = "rgba(20, 184, 166, 1)",
  hotColor = "rgba(245, 158, 11, 1)",
  hotRatio = 0.12,
  className,
}: LeadConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let frame = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999, active: false };

    const seed = () => {
      const count = Math.round(density * Math.max(0.35, (width * height) / (1000 * 360)));
      nodes = Array.from({ length: Math.min(count, 180) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1.2 + Math.random() * 1.6,
        hot: Math.random() < hotRatio,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      const linkSq = linkDistance * linkDistance;

      for (const n of nodes) {
        if (!reduceMotion) {
          if (pointer.active) {
            const dx = n.x - pointer.x;
            const dy = n.y - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 9000 && d2 > 1) {
              const push = (1 - d2 / 9000) * 0.6;
              const d = Math.sqrt(d2);
              n.x += (dx / d) * push;
              n.y += (dy / d) * push;
            }
          }
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -10) n.x = width + 10;
          else if (n.x > width + 10) n.x = -10;
          if (n.y < -10) n.y = height + 10;
          else if (n.y > height + 10) n.y = -10;
        }
      }

      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkSq) {
            ctx.globalAlpha = (1 - d2 / linkSq) * 0.35;
            ctx.strokeStyle = a.hot && b.hot ? hotColor : color;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (pointer.active) {
          const dx = a.x - pointer.x;
          const dy = a.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          const reach = linkSq * 1.6;
          if (d2 < reach) {
            ctx.globalAlpha = (1 - d2 / reach) * 0.7;
            ctx.strokeStyle = a.hot ? hotColor : color;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const pulse = n.hot && !reduceMotion ? (Math.sin(t / 500 + n.phase) + 1) / 2 : 0.5;
        if (n.hot) {
          ctx.globalAlpha = 0.18 + pulse * 0.22;
          ctx.fillStyle = hotColor;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r * (3 + pulse * 3), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = n.hot ? 0.95 : 0.6;
        ctx.fillStyle = n.hot ? hotColor : color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.hot ? n.r + 0.8 : n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      draw(t);
      frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!reduceMotion && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
    };
    const onLeave = () => {
      pointer.active = false;
    };

    resize();
    draw(0);
    start();

    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    io.observe(canvas);
    // The canvas sits behind content (pointer-events: none), so listen on its interactive parent.
    const host = canvas.parentElement?.parentElement ?? canvas;
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", start);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", start);
    };
  }, [density, linkDistance, color, hotColor, hotRatio]);

  return <canvas ref={canvasRef} aria-hidden className={cn("block h-full w-full", className)} />;
}
