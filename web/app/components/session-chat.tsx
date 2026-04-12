"use client";

import { useState, useRef, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${isUser ? 'bg-accent-muted text-accent' : 'bg-orchid-muted text-orchid'}`}
        >
          {isUser ? "Y" : "O"}
        </div>
        <span className="text-[11px] font-medium text-night-400">
          {isUser ? "You" : "Orchid"}
        </span>
      </div>
      <div
        className={`rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.7] text-night-100 ${isUser ? 'bg-night-850 border-l-2 border-accent' : 'bg-night-900 border-l-2 border-orchid'}`}
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
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
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

  const canSend = input.trim() && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] max-w-3xl mx-auto px-6 py-4">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-orchid-muted">
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orchid">
                <path d="M2 4h12v8H4l-2 2V4z" strokeLinejoin="round" />
                <path d="M5 7h6M5 9h4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[14px] font-medium mb-1 text-night-100">
              Ask about this session
            </p>
            <p className="text-[12px] mb-6 text-center max-w-sm text-night-400">
              Ask questions about the conversation and Orchid will reason through the transcript to find answers.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="suggested-q text-[11px] px-3 py-1.5 rounded-full border transition-colors cursor-pointer bg-night-900"
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
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold bg-orchid-muted text-orchid">
                    O
                  </div>
                  <span className="text-[11px] font-medium text-night-400">Orchid</span>
                </div>
                <div className="rounded-lg px-3.5 py-2.5 inline-flex items-center gap-1.5 bg-night-900 border-l-2 border-orchid">
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
      <div className="shrink-0 border rounded-lg flex items-end gap-2 px-3 py-2 bg-night-900 border-night-750">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this conversation..."
          rows={1}
          className="flex-1 bg-transparent text-[13px] resize-none outline-none placeholder-opacity-50 text-night-100"
          style={{ maxHeight: "120px" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = Math.min(target.scrollHeight, 120) + "px";
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!canSend}
          className={`shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer ${canSend ? 'bg-orchid text-white' : 'bg-night-850 text-night-400'}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8h12M10 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
