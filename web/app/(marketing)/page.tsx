'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const terminalLines = [
  { text: '$ orchid claude', delay: 0, style: 'command' },
  { text: '', delay: 400, style: 'blank' },
  { text: '  Orchid v1.0 \u2014 Wrapping Claude Code', delay: 600, style: 'orchid' },
  { text: '  \u21b3 Watching /feature-new-auth', delay: 900, style: 'dim' },
  { text: '  \u21b3 Found 2 repos: backend, frontend', delay: 1200, style: 'dim' },
  { text: '  \u21b3 Session syncing every 5s...', delay: 1500, style: 'green' },
  { text: '', delay: 1800, style: 'blank' },
  { text: '  [Claude Code started]', delay: 2100, style: 'dim' },
  { text: '', delay: 2300, style: 'blank' },
  { text: '> Add OAuth2 authentication with PKCE flow', delay: 2600, style: 'user' },
  { text: '', delay: 2900, style: 'blank' },
  { text: '  \u2713 Synced 12 messages to Orchid cloud', delay: 3200, style: 'green' },
  { text: '  \u2713 Linked to PR #42 (backend) + PR #18 (frontend)', delay: 3600, style: 'green' },
];

function TerminalAnimation() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    terminalLines.forEach((line, i) => {
      timers.push(setTimeout(() => setVisibleLines(i + 1), line.delay));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="terminal-window">
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="terminal-dot terminal-dot-red" />
          <span className="terminal-dot terminal-dot-yellow" />
          <span className="terminal-dot terminal-dot-green" />
        </div>
        <span className="terminal-title">Terminal</span>
      </div>
      <div className="terminal-body">
        {terminalLines.slice(0, visibleLines).map((line, i) => (
          <div key={i} className={`terminal-line terminal-${line.style}`}>
            {line.text}
          </div>
        ))}
        <span className="terminal-cursor" />
      </div>
    </div>
  );
}

function OrchidLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--orchid-pink)"
        strokeWidth="1.5"
        fill="var(--orchid-pink-muted)"
      />
      <path
        d="M12 6C12 6 8 9 8 13C8 15.2 9.8 17 12 17C14.2 17 16 15.2 16 13C16 9 12 6 12 6Z"
        fill="var(--orchid-pink)"
        opacity="0.7"
      />
      <circle cx="12" cy="12" r="2" fill="var(--bg-primary)" />
    </svg>
  );
}

const useCases = [
  {
    title: 'Code Review with Context',
    description:
      'Reviewer sees the conversations that produced each commit. No more guessing why something was done a certain way.',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: 'Agent Handoff',
    description:
      'An agent picks up where another session left off. It reads the prior conversations and understands what was tried, what failed, what the user wanted.',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: 'Team Visibility',
    description:
      'See how AI is being used across your team. Which repos, how often, what kinds of tasks. Live session viewing included.',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: 'Onboarding & Archaeology',
    description:
      'New developer wants to understand why the auth system works this way? Find the conversations from when it was built.',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
];

const steps = [
  {
    num: '01',
    title: 'Capture',
    description: 'Prefix your command with orchid. Zero config, zero friction.',
    code: '$ orchid claude',
  },
  {
    num: '02',
    title: 'Sync',
    description: 'Conversations stream to the cloud in real-time as you work.',
    code: '\u2713 Synced 47 messages',
  },
  {
    num: '03',
    title: 'Surface',
    description: 'Context appears where you need it \u2014 PRs, CLI, web UI, or other agents.',
    code: '$ orchid data search "auth"',
  },
];

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="landing-page">
      {/* Ambient background */}
      <div className="landing-glow" />

      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="flex items-center gap-2.5">
            <OrchidLogo size={24} />
            <span className="text-[15px] font-semibold tracking-tight">Orchid</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="landing-nav-link hidden sm:block">
              How it works
            </a>
            <a href="#use-cases" className="landing-nav-link hidden sm:block">
              Use cases
            </a>
            <Link
              href="/dashboard"
              className="landing-cta-small text-[13px] sm:text-[14px] px-3 sm:px-4 py-1.5 sm:py-2"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className={`landing-hero ${mounted ? 'landing-visible' : 'landing-hidden'}`}>
        <div className="landing-badge">
          <span className="landing-badge-dot" />
          Built for teams using AI to write code
        </div>

        <h1 className="landing-headline">
          <span className="landing-headline-dim">Code tells you what.</span>
          <br />
          <span className="landing-headline-dim">Git tells you when.</span>
          <br />
          <span className="landing-headline-accent">Orchid tells you why.</span>
        </h1>

        <p className="landing-subheadline">
          Capture every AI coding conversation. Surface the reasoning behind your code to reviewers,
          teammates, and agents.
        </p>

        <div className="landing-hero-actions">
          <Link href="/dashboard" className="landing-cta-primary">
            Open Dashboard
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </Link>
          <div className="landing-install-cmd">
            <code>$ orchid claude</code>
          </div>
        </div>

        <div className="landing-terminal-wrapper">
          <TerminalAnimation />
        </div>
      </section>

      {/* Problem */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-problem-grid">
            {[
              {
                emoji: '\u{1F914}',
                text: 'You review a PR. The diff looks weird. Why did they do it this way?',
              },
              {
                emoji: '\u{1F3D6}\uFE0F',
                text: 'A teammate goes on vacation mid-feature. Their context goes with them.',
              },
              {
                emoji: '\u{1F916}',
                text: 'An agent picks up work from another session. It starts from scratch.',
              },
            ].map((item, i) => (
              <div key={i} className="landing-problem-card">
                <span className="landing-problem-emoji">{item.emoji}</span>
                <p className="landing-problem-text">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="landing-section">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">How it works</h2>
          <p className="landing-section-subtitle">Three steps. No hooks, no config, no setup.</p>

          <div className="landing-steps">
            {steps.map((step) => (
              <div key={step.num} className="landing-step">
                <div className="landing-step-num">{step.num}</div>
                <h3 className="landing-step-title">{step.title}</h3>
                <p className="landing-step-desc">{step.description}</p>
                <div className="landing-step-code">
                  <code>{step.code}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="landing-section">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Built for how teams actually work</h2>
          <p className="landing-section-subtitle">
            The conversations between developers and AI are the missing layer of documentation.
          </p>

          <div className="landing-usecases-grid">
            {useCases.map((uc) => (
              <div key={uc.title} className="landing-usecase-card">
                <div className="landing-usecase-icon">{uc.icon}</div>
                <h3 className="landing-usecase-title">{uc.title}</h3>
                <p className="landing-usecase-desc">{uc.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CLI preview */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">The CLI is the agent interface</h2>
          <p className="landing-section-subtitle">
            Any agent can shell out to <code className="landing-inline-code">orchid data</code>{' '}
            commands. No MCP server, no special integration.
          </p>

          <div className="landing-cli-preview">
            <div className="terminal-window">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <span className="terminal-dot terminal-dot-red" />
                  <span className="terminal-dot terminal-dot-yellow" />
                  <span className="terminal-dot terminal-dot-green" />
                </div>
                <span className="terminal-title">orchid data</span>
              </div>
              <div className="terminal-body">
                <div className="terminal-line terminal-command">$ orchid data list</div>
                <div className="terminal-line terminal-blank">&nbsp;</div>
                <div className="terminal-line terminal-dim">
                  {' '}
                  #12 andres 2h ago &quot;Add auth middleware&quot; (47 msgs, active)
                </div>
                <div className="terminal-line terminal-dim">
                  {' '}
                  #11 julian 5h ago &quot;Fix payment flow&quot; (23 msgs, done)
                </div>
                <div className="terminal-line terminal-dim">
                  {' '}
                  #10 andres 1d ago &quot;Refactor DB layer&quot; (89 msgs, done)
                </div>
                <div className="terminal-line terminal-blank">&nbsp;</div>
                <div className="terminal-line terminal-command">
                  $ orchid data search &quot;why websockets&quot;
                </div>
                <div className="terminal-line terminal-blank">&nbsp;</div>
                <div className="terminal-line terminal-green"> Found 3 relevant conversations:</div>
                <div className="terminal-line terminal-dim">
                  {' '}
                  #12 turn 23: &quot;We chose WebSockets over SSE because...&quot;
                </div>
                <div className="terminal-line terminal-dim">
                  {' '}
                  #10 turn 45: &quot;SSE would work but doesn&apos;t support...&quot;
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-section landing-cta-section">
        <div className="landing-section-inner" style={{ textAlign: 'center' }}>
          <h2 className="landing-cta-headline">Stop losing the reasoning behind your code</h2>
          <p className="landing-section-subtitle">
            Start capturing AI conversations today. It takes one command.
          </p>
          <div className="landing-hero-actions" style={{ justifyContent: 'center' }}>
            <Link href="/dashboard" className="landing-cta-primary">
              Open Dashboard
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
          </div>
          <div className="landing-install-cmd" style={{ margin: '24px auto 0' }}>
            <code>$ orchid claude</code>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="flex items-center gap-2">
            <OrchidLogo size={18} />
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Orchid
            </span>
          </div>
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            The missing context layer for AI-assisted development.
          </span>
        </div>
      </footer>
    </div>
  );
}
