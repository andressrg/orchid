"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Session {
  id: string;
  user_name: string;
  branch: string;
  status: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://24.144.97.81:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "orchid-poc-api-key-2024";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Session[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const togglePalette = () => {
    setOpen((prev) => {
      if (!prev) {
        setQuery("");
        setResults([]);
        setSelectedIndex(0);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      return !prev;
    });
  };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        togglePalette();
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/sessions?q=${encodeURIComponent(query)}`,
          { headers: { "X-API-Key": API_KEY } }
        );
        if (res.ok) {
          setResults((await res.json()) as Session[]);
          setSelectedIndex(0);
        }
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const items = getItems();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) navigate(item.href);
    }
  }

  function getItems() {
    const staticItems = [
      { label: "Sessions", desc: "View all sessions", href: "/dashboard" },
      { label: "Search", desc: "Search conversations", href: "/search" },
      { label: "Activity", desc: "Team activity", href: "/activity" },
    ];

    const sessionItems = results.map((s) => ({
      label: s.branch || s.id,
      desc: `${s.user_name} · ${s.status}`,
      href: `/sessions/${encodeURIComponent(s.id)}`,
    }));

    return query.trim() ? [...sessionItems, ...staticItems] : staticItems;
  }

  if (!open) return null;

  const items = getItems();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: "rgba(0, 0, 0, 0.6)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden animate-fade-in"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--text-tertiary)" }}>
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search sessions, navigate..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full py-3 text-[13px] outline-none"
            style={{ background: "transparent", color: "var(--text-primary)" }}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-tertiary)" }}
          >
            ESC
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {items.map((item, i) => (
            <button
              key={item.href}
              className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
              style={{
                background: i === selectedIndex ? "var(--bg-hover)" : "transparent",
              }}
              onClick={() => navigate(item.href)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="flex-1">
                <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {item.label}
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {item.desc}
                </div>
              </div>
              {i === selectedIndex && (
                <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  Enter
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
