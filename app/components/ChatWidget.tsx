'use client';

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { MessageSquare, X, Send, Trash2, Search, Loader2 } from 'lucide-react';
import { useChat } from '@/hooks/useChat';

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, status, streaming, error, send, clear } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    send(input);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
                   bg-accent text-black flex items-center justify-center
                   shadow-lg shadow-accent/25 hover:scale-105 transition-transform"
        aria-label="Open chat"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] max-h-[600px] flex flex-col
                    rounded-2xl border border-border bg-[#0a0a0a] shadow-2xl shadow-black/50
                    animate-fade-in overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold">Ask the Data</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clear}
              className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[440px]">
        {messages.length === 0 && !streaming && (
          <div className="text-center py-8 text-muted text-sm space-y-3">
            <p>Ask questions about your dashboard data.</p>
            <div className="space-y-1.5">
              {[
                'What were the top sellers last week?',
                'How does this month compare to last year?',
                'Which category is trending up?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="block w-full text-left text-xs px-3 py-2 rounded-lg
                             bg-white/[0.03] border border-border hover:border-border-hover
                             hover:bg-white/[0.06] transition-colors text-secondary"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent/15 text-white rounded-br-md'
                  : 'bg-white/[0.05] text-secondary rounded-bl-md'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {(status === 'thinking' || status === 'searching') && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl rounded-bl-md bg-white/[0.05] text-secondary text-sm">
              {status === 'searching' ? (
                <Search className="w-3.5 h-3.5 animate-pulse text-accent" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              )}
              {status === 'searching' ? 'Searching data...' : 'Thinking...'}
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2 bg-card">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-white
                       placeholder:text-muted outline-none py-2 px-1
                       max-h-[80px] overflow-y-auto"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-2 rounded-lg bg-accent text-black hover:bg-accent/80
                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
