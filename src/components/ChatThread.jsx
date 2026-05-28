import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../utils/webhooks';
import './ChatThread.css';

export default function ChatThread({ chatHistory, onUpdateHistory, itemContext }) {
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  async function handleSend() {
    const text = inputValue.trim();
    if (!text || isTyping) return;
    setInputValue('');
    onUpdateHistory(prev => [...prev, { role: 'user', text }]);
    setIsTyping(true);
    try {
      const res = await sendChatMessage({ message: text, chatHistory, itemContext });
      onUpdateHistory(prev => [...prev, { role: 'ai', text: res.text }]);
    } catch {
      onUpdateHistory(prev => [...prev, { role: 'ai', text: 'Sorry, I had trouble responding. Please try again.' }]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="card">
      <div className="chat-title">Ask Flip AI</div>
      <div className="chat-messages">
        {chatHistory.map((msg, i) => (
          <div key={i} className={`chat-bubble-wrap ${msg.role === 'user' ? 'user' : 'ai'}`}>
            <div className={`chat-bubble ${msg.role === 'user' ? 'user' : 'ai'}`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="chat-bubble-wrap ai chat-typing-wrap">
            <div className="chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="form-input"
          placeholder="Ask about this item..."
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={isTyping || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
