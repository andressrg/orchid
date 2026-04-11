"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Session {
  id: string;
  user_name: string;
  branch: string;
  status: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export function CommandPalette({ teamSlug = '' }: { teamSlug?: string }) {
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
          `${API_URL}/api/sessions?q=${encodeURIComponent(query)}${teamSlug ? `&team=${teamSlug}` : ''}`,
          { credentials: 'include' }
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
  }, [query, teamSlug]);

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
      href: teamSlug ? `/t/${teamSlug}/sessions/${encodeURIComponent(s.id)}` : `/sessions/${encodeURIComponent(s.id)}`,
    }));

    return query.trim() ? [...sessionItems, ...staticItems] : staticItems;
  }

  if (!open) return null;

  const items = getItems();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-night-600 shadow-2xl overflow-hidden animate-fade-in bg-night-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-night-750">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-night-400">
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
            className="w-full py-3 text-[13px] outline-none bg-transparent text-night-100"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded shrink-0 bg-night-850 text-night-400">
            ESC
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {items.map((item, i) => (
            <button
              key={item.href}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${i === selectedIndex ? 'bg-night-800' : ''}`}
              onClick={() => navigate(item.href)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="flex-1">
                <div className="text-[13px] font-medium text-night-100">
                  {item.label}
                </div>
                <div className="text-[11px] text-night-400">
                  {item.desc}
                </div>
              </div>
              {i === selectedIndex && (
                <span className="text-[10px] text-night-400">
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
