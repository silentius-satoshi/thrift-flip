import { useState, useRef, useEffect, Fragment } from 'react';
import { sendChatMessage } from '../utils/ai';
import { TextArea } from './ui/Field';
import IconButton from './ui/IconButton';
import './ChatThread.css';

function ChatIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

// Same taxonomy as the analyze path — a chat failure is not a mystery either.
const CHAT_ERROR_COPY = {
  'no-key': 'Add your AI key in Settings and Flip can answer',
  'bad-key': "That key didn't work — check it in Settings",
  quota: 'Google says the key is out of free calls today',
  offline: 'No signal — the question is still here',
  locked: 'Unlock cancelled — Flip needs your key',
  'bad-response': 'Odd reply from the model',
  default: "Couldn't get an answer",
};

function isSameGroupPrev(messages, i) {
  return i > 0 && messages[i].role === messages[i - 1].role;
}
function isSameGroupNext(messages, i) {
  return i < messages.length - 1 && messages[i].role === messages[i + 1].role;
}
function formatGroupTs(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

export default function ChatThread({ chatHistory, onUpdateHistory, itemContext, itemId }) {
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // A failed turn is NOT written into the thread. The mock used to append an
  // apology as if the model had said it, which persisted a sentence the model
  // never produced into a record Dad keeps. It lives here instead, beside a
  // Retry, and disappears when the retry lands.
  const [failed, setFailed] = useState(null); // { text, code }
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [chatHistory, isTyping]);

  async function ask(text, { alreadyInThread = false } = {}) {
    if (!alreadyInThread) onUpdateHistory(prev => [...prev, { role: 'user', text, ts: Date.now() }]);
    setFailed(null);
    setIsTyping(true);
    try {
      const res = await sendChatMessage({ itemId, message: text, chatHistory, itemContext });
      onUpdateHistory(prev => [...prev, { role: 'ai', text: res.text, ts: Date.now() }]);
    } catch (e) {
      // The question stays in the thread — it was really asked. Only the
      // answer is missing, and it says so.
      setFailed({ text, code: e?.code ?? 'bad-response' });
    } finally {
      setIsTyping(false);
    }
  }

  function handleSend() {
    const text = inputValue.trim();
    if (!text || isTyping) return;
    setInputValue('');
    ask(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-thread">
      <div className="chat-messages" ref={messagesContainerRef}>
        {chatHistory.length === 0 && !isTyping && (
          <div className="chat-empty">
            <span className="chat-empty-icon"><ChatIcon /></span>
            <span className="chat-empty-text">Ask Flip anything about this item</span>
          </div>
        )}
        {chatHistory.map((msg, i) => {
          const prevSame = isSameGroupPrev(chatHistory, i);
          const nextSame = isSameGroupNext(chatHistory, i);
          const hasTail = !nextSame;
          const showSep = i > 0 && msg.ts && chatHistory[i - 1]?.ts &&
            msg.ts - chatHistory[i - 1].ts > 5 * 60 * 1000;
          const isUser = msg.role === 'user';
          return (
            <Fragment key={i}>
              {showSep && (
                <div className="chat-time-sep">{formatGroupTs(msg.ts)}</div>
              )}
              <div className={`chat-bubble-wrap ${isUser ? 'user' : 'ai'}${prevSame ? ' same-prev' : ''}`}>
                {!isUser && (
                  <div className={`chat-avatar${prevSame ? ' invisible' : ''}`}>F</div>
                )}
                <div className={`chat-bubble ${isUser ? 'user' : 'ai'}${hasTail ? ' has-tail' : ''}`}>
                  {msg.text}
                </div>
              </div>
            </Fragment>
          );
        })}
        {isTyping && (
          <div className="chat-bubble-wrap ai">
            <div className="chat-avatar">F</div>
            <div className="chat-typing"><span /><span /><span /></div>
          </div>
        )}
        {failed && !isTyping && (
          <div className="chat-failed">
            <span>{CHAT_ERROR_COPY[failed.code] ?? CHAT_ERROR_COPY.default}</span>
            <button type="button" className="tap44" onClick={() => ask(failed.text, { alreadyInThread: true })}>
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <TextArea
          className="composer"
          placeholder="Ask about this item..."
          rows={1}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping}
        />
        <IconButton
          label="Send"
          size="md"
          tone="blue"
          onClick={handleSend}
          disabled={isTyping || !inputValue.trim()}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
