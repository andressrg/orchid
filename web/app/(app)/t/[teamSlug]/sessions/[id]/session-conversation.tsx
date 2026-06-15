import { parseTranscript } from '@/app/lib/api';
import { getSessionTranscriptById } from '@/app/lib/queries';
import { TurnHighlighter } from './turn-highlighter';

// Renders one conversation turn. Pure presentation — no client interactivity,
// so it stays a server component and ships zero JS.
function MessageBubble({
  role,
  text,
  userName,
  turnNumber,
}: {
  role: string;
  text: string;
  userName: string;
  turnNumber: number;
}) {
  const isUser = role === 'user';
  const paragraphs = text.split('\n\n').filter(Boolean);

  return (
    <div className="animate-fade-in group" style={{ animationDelay: `${turnNumber * 0.03}s` }}>
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ${isUser ? 'bg-accent-muted text-accent' : 'bg-orchid-muted text-orchid'}`}
        >
          {isUser ? userName[0]?.toUpperCase() || 'H' : 'AI'}
        </div>
        <span className="text-[11px] font-medium text-night-300">
          {isUser ? userName : 'Claude'}
        </span>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-night-950 text-night-400">
          #{turnNumber}
        </span>
      </div>
      <div
        className={`rounded-lg px-4 py-3 text-[13px] leading-[1.7] text-night-100 ${isUser ? 'bg-night-850 border-l-2 border-accent' : 'bg-night-900 border-l-2 border-orchid'}`}
      >
        {paragraphs.map((para, i) => {
          if (para.startsWith('```')) {
            const lines = para.split('\n');
            const lang = lines[0].replace('```', '').trim();
            const code = lines
              .slice(1, lines[lines.length - 1] === '```' ? -1 : undefined)
              .join('\n');
            return (
              <div key={i} className="my-3">
                {lang && (
                  <div className="text-[10px] font-mono px-3 py-1 rounded-t border-b bg-night-950 text-night-400 border-night-750">
                    {lang}
                  </div>
                )}
                <pre className="font-mono text-[12px] p-3 rounded-b overflow-x-auto bg-night-950 text-night-300">
                  <code>{code}</code>
                </pre>
              </div>
            );
          }

          if (/^\d+\./.test(para)) {
            const items = para.split(/\n/).filter(Boolean);
            return (
              <div key={i} className="my-2 space-y-1.5">
                {items.map((item, j) => (
                  <div key={j} className="flex gap-2">
                    <span className="shrink-0 font-mono text-[12px] text-accent opacity-60">
                      {item.match(/^\d+\./)?.[0] || ''}
                    </span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: item
                          .replace(/^\d+\.\s*/, '')
                          .replace(
                            /\*\*(.*?)\*\*/g,
                            '<strong style="color: var(--text-primary)">$1</strong>',
                          ),
                      }}
                    />
                  </div>
                ))}
              </div>
            );
          }

          if (para.startsWith('- ') || para.startsWith('* ')) {
            const items = para.split(/\n/).filter(Boolean);
            return (
              <div key={i} className="my-2 space-y-1">
                {items.map((item, j) => (
                  <div key={j} className="flex gap-2">
                    <span className="shrink-0 text-orchid opacity-50">&bull;</span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: item
                          .replace(/^[-*]\s*/, '')
                          .replace(
                            /\*\*(.*?)\*\*/g,
                            '<strong style="color: var(--text-primary)">$1</strong>',
                          )
                          .replace(
                            /`([^`]+)`/g,
                            '<code style="background: var(--bg-primary); padding: 1px 4px; border-radius: 3px; font-size: 12px; color: var(--orchid-pink)">$1</code>',
                          ),
                      }}
                    />
                  </div>
                ))}
              </div>
            );
          }

          const rendered = para
            .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text-primary)">$1</strong>')
            .replace(
              /`([^`]+)`/g,
              '<code style="background: var(--bg-primary); padding: 1px 4px; border-radius: 3px; font-size: 12px; color: var(--orchid-pink)">$1</code>',
            );

          return (
            <p
              key={i}
              className={i > 0 ? 'mt-2.5' : ''}
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Streamed conversation body. Fetches ONLY the transcript (dedicated read),
// parses it, and renders the turns. Rendered behind a <Suspense> boundary on
// the session page so the metadata + AI summary paint before the (potentially
// large) transcript is read — without putting the JSONL on the metadata path.
export async function SessionConversation({
  sessionId,
  teamId,
  userId,
  userName,
  isActive,
  highlightTurn,
}: {
  sessionId: string;
  teamId: string;
  userId: string;
  userName: string;
  isActive: boolean;
  highlightTurn: number | null;
}) {
  const transcript = await getSessionTranscriptById({ sessionId, teamId, userId });
  const turns = transcript ? parseTranscript(transcript) : [];

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      {turns.length === 0 ? (
        <div className="text-center py-16 text-night-300">
          <p className="text-sm">No conversation messages found in this session.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {turns.map((turn, i) => (
            <div
              key={i}
              className="timeline-connector message-enter"
              style={{ animationDelay: `${i * 0.05}s` }}
              id={`turn-${i + 1}`}
            >
              <MessageBubble
                role={turn.role}
                text={turn.text}
                userName={userName}
                turnNumber={i + 1}
              />
            </div>
          ))}
        </div>
      )}

      {isActive && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold bg-orchid-muted text-orchid">
              AI
            </div>
            <div className="px-4 py-3 rounded-lg flex items-center gap-1.5 bg-night-900 border-l-2 border-orchid">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[12px] px-4 py-3 rounded-lg border border-success bg-success-muted text-success">
            <span className="w-2 h-2 rounded-full animate-pulse-dot bg-success" />
            This session is still active. Page refreshes automatically every 10 seconds.
          </div>
        </div>
      )}

      {/* Anchors exist now that turns are rendered → deep-link scroll works. */}
      {highlightTurn !== null && !Number.isNaN(highlightTurn) && (
        <TurnHighlighter turn={highlightTurn} />
      )}
    </div>
  );
}

// Skeleton shown while the transcript streams in.
export function ConversationSkeleton() {
  return (
    <div className="px-6 py-6 max-w-3xl mx-auto space-y-6" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="space-y-2 animate-fade-in"
          style={{ animationDelay: `${i * 0.05}s` }}
        >
          <div className="h-3 w-24 rounded bg-night-850" />
          <div className="h-20 rounded-lg bg-night-900 border-l-2 border-night-750" />
        </div>
      ))}
    </div>
  );
}
