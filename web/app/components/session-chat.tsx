"use client";

import { useState, useRef, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  const rendered = message.content
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text-primary)">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background: var(--bg-primary); padding: 1px 4px; border-radius: 3px; font-size: 12px; color: var(--orchid-pink)">$1</code>');

  const paragraphs = rendered.split("\n\n").filter(Boolean);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
          style={{
            background: isUser ? "var(--accent-muted)" : "var(--orchid-pink-muted)",
            color: isUser ? "var(--accent)" : "var(--orchid-pink)",
          }}
        >
          {isUser ? "Y" : "O"}
        </div>
        <span className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
          {isUser ? "You" : "Orchid"}
        </span>
      </div>
      <div
        className="rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.7]"
        style={{
          background: isUser ? "var(--bg-tertiary)" : "var(--bg-secondary)",
          borderLeft: isUser ? "2px solid var(--accent)" : "2px solid var(--orchid-pink)",
          color: "var(--text-primary)",
        }}
      >
        {paragraphs.map((para, i) => (
          <p key={i} className={i > 0 ? "mt-2" : ""} dangerouslySetInnerHTML={{ __html: para.replace(/\n/g, "<br/>") }} />
        ))}
      </div>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "What was the main goal of this session?",
  "What key decisions were made and why?",
  "Were there any tradeoffs discussed?",
  "What was built or changed?",
  "Were there any issues or problems encountered?",
];

export function SessionChat({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(question: string) {
    if (!question.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: question.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(
        `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/chat`,
        {
          method: "POST",
          headers: {
            "X-API-Key": API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: question.trim(),
            history: messages,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that question. Please try again." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] max-w-3xl mx-auto px-6 py-4">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: "var(--orchid-pink-muted)" }}
            >
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--orchid-pink)" }}>
                <path d="M2 4h12v8H4l-2 2V4z" strokeLinejoin="round" />
                <path d="M5 7h6M5 9h4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>
              Ask about this session
            </p>
            <p className="text-[12px] mb-6 text-center max-w-sm" style={{ color: "var(--text-tertiary)" }}>
              Ask questions about the conversation and Orchid will reason through the transcript to find answers.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-[11px] px-3 py-1.5 rounded-full border transition-colors cursor-pointer"
                  style={{
                    background: "var(--bg-secondary)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--orchid-pink)";
                    e.currentTarget.style.color = "var(--orchid-pink)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <ChatBubble key={i} message={msg} />
            ))}
            {loading && (
              <div className="animate-fade-in">
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ background: "var(--orchid-pink-muted)", color: "var(--orchid-pink)" }}
                  >
                    O
                  </div>
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>Orchid</span>
                </div>
                <div
                  className="rounded-lg px-3.5 py-2.5 inline-flex items-center gap-1.5"
                  style={{ background: "var(--bg-secondary)", borderLeft: "2px solid var(--orchid-pink)" }}
                >
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div
        className="shrink-0 border rounded-lg flex items-end gap-2 px-3 py-2"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this conversation..."
          rows={1}
          className="flex-1 bg-transparent text-[13px] resize-none outline-none placeholder-opacity-50"
          style={{ color: "var(--text-primary)", maxHeight: "120px" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = Math.min(target.scrollHeight, 120) + "px";
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer"
          style={{
            background: input.trim() && !loading ? "var(--orchid-pink)" : "var(--bg-tertiary)",
            color: input.trim() && !loading ? "white" : "var(--text-tertiary)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8h12M10 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
