import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ConversationBubble from './ConversationBubble';
import { ChevronsDown } from 'lucide-react';

const BOTTOM_THRESHOLD = 80; // px from bottom counts as "at bottom"

export default function ConversationFeed({ entries }) {
  const containerRef        = useRef(null);
  const rafRef              = useRef(null);
  const isScrolledUpRef     = useRef(false);
  const [showJump, setShowJump] = useState(false);

  // rAF scroll — cancels stale frames, fires after paint
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  // Auto-scroll when entries grow, unless user scrolled up
  useEffect(() => {
    if (!isScrolledUpRef.current) scrollToBottom('smooth');
  }, [entries.length, scrollToBottom]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const dist    = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < BOTTOM_THRESHOLD;
    isScrolledUpRef.current = !atBottom;
    setShowJump((prev) => (prev === atBottom ? !atBottom : prev));
  }, []);

  const jumpToBottom = useCallback(() => {
    isScrolledUpRef.current = false;
    setShowJump(false);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  return (
    <div className="relative flex flex-col h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 space-y-2"
        style={{ maxHeight: 'calc(100vh - 300px)', overscrollBehavior: 'contain' }}
      >
        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <ConversationBubble
              key={entry.id}
              entry={entry}
              isActive={i === entries.length - 1}
            />
          ))}
        </AnimatePresence>

        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <div className="w-12 h-12 rounded-2xl border border-slate-800 flex items-center justify-center mb-3">
              <span className="text-2xl">🎙</span>
            </div>
            <p className="text-sm">Start capturing audio to see the live transcript</p>
          </div>
        )}
        <div id="feed-bottom" />
      </div>

      {/* Jump-to-latest button */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={jumpToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-semibold shadow-lg z-10"
          >
            <ChevronsDown className="w-3.5 h-3.5" /> Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
