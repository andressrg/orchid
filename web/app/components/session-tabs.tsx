'use client';

import { useState, type ReactNode } from 'react';
import { SessionCommits } from './session-commits';
import { SessionChat } from './session-chat';

interface SessionTabsProps {
  sessionId: string;
  // The conversation body is rendered on the server and streamed in (see
  // session-conversation.tsx); this client component just slots it under the
  // Conversation tab so metadata paints without waiting on the transcript.
  conversation: ReactNode;
}

const TABS = [
  {
    id: 'conversation' as const,
    label: 'Conversation',
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M2 4h12v8H4l-2 2V4z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'commits' as const,
    label: 'Commits',
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="4" r="2" />
        <circle cx="4" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
      </svg>
    ),
  },
  {
    id: 'chat' as const,
    label: 'Ask',
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M6 6.5c0-1.1.9-2 2-2s2 .9 2 2c0 .7-.4 1.4-1 1.7V9" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
];

type TabId = (typeof TABS)[number]['id'];

export function SessionTabs({ sessionId, conversation }: SessionTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('conversation');

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-6 border-b border-night-750 bg-night-900">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors relative cursor-pointer ${activeTab === tab.id ? 'text-night-100' : 'text-night-400'}`}
          >
            <span className={activeTab === tab.id ? 'text-orchid' : ''}>{tab.icon}</span>
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t bg-orchid" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'conversation' && conversation}
      {activeTab === 'commits' && <SessionCommits sessionId={sessionId} />}
      {activeTab === 'chat' && <SessionChat sessionId={sessionId} />}
    </div>
  );
}
