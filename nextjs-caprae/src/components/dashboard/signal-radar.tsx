"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { LeadListItem } from "@/lib/api";

type Node = { lead: LeadListItem; x: number; y: number; hot: boolean };

/** Deterministic 0-1 pseudo-random value per lead, so dots keep their place across renders. */
function hash(n: number, salt: number) {
  const v = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * A live "cluster map" of the real pipeline: every dot is a lead, hot leads pulse amber and link to nearby hot
 * leads, and higher scores sit closer to the centre. Hover for the company, click to open it.
 */
export function SignalRadar({ leads }: { leads: LeadListItem[] | undefined }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const hoverRef = useRef<Node | null>(null);
  const [tip, setTip] = useState<{ node: Node; left: number; top: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !wrap || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;

    const layout = () => {
      // Polar layout: angle from the lead id, radius shrinks as the score grows.
      nodesRef.current = (leads ?? []).map((lead) => {
        const angle = hash(lead.id, 1) * Math.PI * 2;
        const radius = (0.12 + (1 - lead.score / 100) * 0.95 + hash(lead.id, 2) * 0.12) * 0.5;
        return {
          lead,
          hot: lead.score_tier === "hot",
          x: Math.min(0.95, Math.max(0.05, 0.5 + Math.cos(angle) * radius * 1.15)),
          y: Math.min(0.92, Math.max(0.08, 0.5 + Math.sin(angle) * radius)),
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const css = getComputedStyle(document.documentElement);
    const amber = css.getPropertyValue("--amber").trim() || "#f59e0b";
    const gold = css.getPropertyValue("--gold").trim() || "#fbbf24";
    const cold = css.getPropertyValue("--cold").trim() || "#94a3b8";

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
      for (const r of [0.25, 0.45]) {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, height * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const nodes = nodesRef.current;
      ctx.strokeStyle = amber;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (!a.hot || !b.hot) continue;
          const x1 = a.x * width, y1 = a.y * height, x2 = b.x * width, y2 = b.y * height;
          if (Math.hypot(x1 - x2, y1 - y2) < 110) {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const cx = n.x * width;
        const cy = n.y * height;
        const hovered = n === hoverRef.current;
        if (n.hot) {
          const pulse = reduceMotion ? 6 : 5 + Math.sin(t / 400 + n.x * 10) * 2;
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = amber;
          ctx.beginPath();
          ctx.arc(cx, cy, pulse + 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = hovered ? gold : amber;
          ctx.beginPath();
          ctx.arc(cx, cy, hovered ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = hovered ? 1 : 0.55;
          ctx.fillStyle = cold;
          ctx.beginPath();
          ctx.arc(cx, cy, hovered ? 4.5 : 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    };

    const loop = (t: number) => {
      draw(t);
      frame = requestAnimationFrame(loop);
    };

    layout();
    resize();
    if (reduceMotion) draw(0);
    else frame = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [leads]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => Math.hypot(n.x * rect.width - mx, n.y * rect.height - my) < 12) ?? null;
    hoverRef.current = hit;
    setTip(hit ? { node: hit, left: Math.min(rect.width - 180, mx + 12), top: Math.max(8, my - 34) } : null);
  }

  return (
    <div ref={wrapRef} className="relative h-[240px] w-full flex-1 overflow-hidden rounded-md bg-background">
      <canvas
        ref={canvasRef}
        className={tip ? "block size-full cursor-pointer" : "block size-full cursor-crosshair"}
        onMouseMove={onMove}
        onMouseLeave={() => {
          hoverRef.current = null;
          setTip(null);
        }}
        onClick={() => tip && router.push(`/leads/${tip.node.lead.id}`)}
        aria-label="Cluster map of leads; hot leads are amber"
        role="img"
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-input bg-surface-card px-2 py-1 font-mono text-[11px] shadow-2xl"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="font-bold text-gold">{tip.node.lead.company_name}</div>
          <div className="text-[10px] text-muted-foreground">
            Signal {tip.node.lead.score}/100 · {[tip.node.lead.industry, tip.node.lead.state].filter(Boolean).join(" ")}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-3 rounded bg-card/90 px-2 py-1 font-mono text-[11px] backdrop-blur">
        <span className="flex items-center gap-1 text-gold">
          <span className="size-2 rounded-full bg-amber" /> Hot (75+)
        </span>
        <span className="flex items-center gap-1 text-outline">
          <span className="size-2 rounded-full bg-cold" /> Below 75
        </span>
      </div>
    </div>
  );
}
