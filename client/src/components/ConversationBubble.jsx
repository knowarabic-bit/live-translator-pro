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
const ConversationBubble = memo(function ConversationBubble({ entry, isActive }) {
  const isArabic = entry?.detected_language === 'ar';

  // Non-speech event pill
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-col gap-2"
    >
      {/* ── Original ── */}
      <div
        className={`max-w-[80%] px-5 py-3 rounded-2xl ${
          isArabic
            ? 'self-end bg-violet-500/10 border border-violet-500/20 rounded-br-sm'
            : 'self-start bg-cyan-500/10 border border-cyan-500/20 rounded-bl-sm'
        }`}
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <p className={`text-white text-sm leading-relaxed ${isArabic ? 'font-cairo' : 'font-inter'}`}>
          <WordStream
            text={entry?.original_text ?? ''}
            isActive={isActive}
            wordDelay={isArabic ? 90 : 80}
          />
        </p>
        <span className={`text-xs mt-1 block ${isArabic ? 'text-violet-400 text-right' : 'text-cyan-400'}`}>
          {(entry?.detected_language ?? '').toUpperCase()} · original
        </span>
      </div>

      {/* ── Translation: null = pending, string = done ── */}
      {entry?.translated_text === null ? (
        // Pending spinner
        <div className={`max-w-[80%] px-5 py-3 rounded-2xl bg-slate-800/40 border border-slate-700/30 ${
          isArabic ? 'self-start rounded-tl-sm' : 'self-end rounded-tr-sm'
        }`}>
          <div className="flex items-center gap-2">
            {[0, 150, 300].map((d) => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-cyan-500/60 animate-bounce"
                style={{ animationDelay: `${d}ms` }} />
            ))}
            <span className="text-xs text-slate-600 ml-1">Translating…</span>
          </div>
        </div>
      ) : entry?.translated_text ? (
        // Done — stream translation word-by-word
        <div
          className={`max-w-[80%] px-5 py-3 rounded-2xl bg-slate-800/60 border border-slate-700/50 ${
            isArabic ? 'self-start rounded-tl-sm' : 'self-end rounded-tr-sm'
          }`}
          dir={isArabic ? 'ltr' : 'rtl'}
        >
          <p className={`text-slate-200 text-sm leading-relaxed ${isArabic ? 'font-inter' : 'font-cairo'}`}>
            <WordStream
              text={entry.translated_text}
              isActive={isActive}
              wordDelay={isArabic ? 70 : 85}
            />
          </p>
          <span className={`text-xs mt-1 block text-slate-500 ${isArabic ? '' : 'text-right'}`}>
            {(entry?.target_language ?? '').toUpperCase()} · translation
          </span>
        </div>
      ) : null}
    </motion.div>
  );
});

export default ConversationBubble;
