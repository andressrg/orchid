"use client";
import { useEffect } from "react";

export function TurnHighlighter({ turn }: { turn: number }) {
  useEffect(() => {
    const el = document.getElementById(`turn-${turn}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.outline = "2px solid var(--accent)";
    el.style.outlineOffset = "6px";
    el.style.borderRadius = "8px";
    el.style.transition = "outline 0.3s ease";
    // Fade out highlight after 3s
    setTimeout(() => {
      el.style.outline = "2px solid transparent";
    }, 3000);
  }, [turn]);

  return null;
}
