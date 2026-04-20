import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

// ─── Word-by-word streaming text ─────────────────────────────────────────────
function WordStream({ text = '', isActive = false, wordDelay = 80 }) {
  const [count, setCount]   = useState(0);
  const wordsRef            = useRef([]);
  const timerRef            = useRef(null);

  useEffect(() => {
    // Split preserving whitespace tokens so joined output matches original spacing
    const tokens = text.split(/(\s+)/);
    wordsRef.current = tokens;
    setCount(0);
    clearInterval(timerRef.current);

    if (!tokens.length) return;
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setCount(i);
      if (i >= tokens.length) clearInterval(timerRef.current);
    }, wordDelay);

    return () => clearInterval(timerRef.current);
  }, [text, wordDelay]);

  const tokens = wordsRef.current;
  const done   = count >= tokens.length;

  return (
    <span>
      {tokens.slice(0, count).join('')}
      {isActive && !done && (
        <span className="inline-block w-0.5 h-4 bg-cyan-400 ml-0.5 align-middle animate-pulse" />
      )}
    </span>
  );
}

// ─── Event icons ─────────────────────────────────────────────────────────────
const EVENT_ICONS = {
  laughter: '😄', applause: '👏', music: '🎵',
  silence:  '🤫', noise:    '🔇', unclear: '❓',
};

// ─── Main bubble ─────────────────────────────────────────────────────────────
// The live view only shows the translation (Arabic). The original text is
// preserved in the entry payload so it can be included in the exported PDF
// appendix, but never rendered on-screen.
const ConversationBubble = memo(function ConversationBubble({ entry, isActive }) {
  // Non-speech event pill — kept because it's language-neutral feedback.
  if (entry?.event_type) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="flex justify-center my-1"
      >
        <span className="text-xs italic text-slate-500 bg-slate-800/50 border border-slate-700/40 px-3 py-1.5 rounded-full">
          {EVENT_ICONS[entry.event_type] || '•'} {entry.original_text}
        </span>
      </motion.div>
    );
  }

  // Skip bubbles that somehow have no translatable content.
  if (entry?.translated_text === undefined) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-col gap-2"
    >
      {entry.translated_text === null ? (
        // Pending — translation in flight
        <div className="self-end max-w-[80%] px-5 py-3 rounded-2xl bg-slate-800/40 border border-slate-700/30 rounded-tr-sm">
          <div className="flex items-center gap-2">
            {[0, 150, 300].map((d) => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-violet-500/60 animate-bounce"
                style={{ animationDelay: `${d}ms` }} />
            ))}
            <span className="text-xs text-slate-500 ml-1 font-cairo">جارٍ الترجمة…</span>
          </div>
        </div>
      ) : entry.translated_text ? (
        <div
          className="self-end max-w-[80%] px-5 py-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 rounded-br-sm"
          dir="rtl"
        >
          <p className="text-white text-base leading-relaxed font-cairo">
            <WordStream
              text={entry.translated_text}
              isActive={isActive}
              wordDelay={70}
            />
          </p>
        </div>
      ) : null}
    </motion.div>
  );
});

export default ConversationBubble;
