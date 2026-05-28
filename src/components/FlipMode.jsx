import { useState, useEffect } from 'react';
import { getIndex, saveConversation, updateChatHistory, getConversation } from '../utils/conversationStore';
import ChatThread from './ChatThread';
import './FlipMode.css';

export default function FlipMode({ cart, listingItem, onNavigateToCart, onNavigateToListing }) {
  const [conversations, setConversations] = useState(() => getIndex());
  // conversations[0] is the most recent — index is stored newest-first
  const [selectedId, setSelectedId] = useState(() => getIndex()[0]?.id ?? null);
  const [activeConv, setActiveConv] = useState(() => selectedId ? getConversation(selectedId) : null);
  const [chatHistory, setChatHistory] = useState(() => activeConv?.chatHistory ?? []);

  useEffect(() => {
    if (selectedId === null) {
      setActiveConv(null);
      setChatHistory([]);
      return;
    }
    const conv = getConversation(selectedId);
    setActiveConv(conv);
    setChatHistory(conv?.chatHistory ?? []);
  }, [selectedId]);

  function handleUpdateHistory(updater) {
    setChatHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (selectedId) updateChatHistory(selectedId, next);
      return next;
    });
  }

  function handleNewChat() {
    const id = Date.now();
    saveConversation(id, 'New Chat', [], null);
    const updated = getIndex();
    setConversations(updated);
    setSelectedId(id);
  }

  function handleSelectChip(id) {
    setSelectedId(id);
  }

  const inCart = activeConv?.itemId && cart.some(i => i.id === activeConv.itemId);
  const inListing = activeConv?.itemId && listingItem?.id === activeConv.itemId;

  return (
    <div className="screen">
      <div className="flip-chips-row">
        <button className="flip-chip flip-chip-new" onClick={handleNewChat}>+ New</button>
        {conversations.map(c => (
          <button
            key={c.id}
            className={`flip-chip ${selectedId === c.id ? 'active' : ''}`}
            onClick={() => handleSelectChip(c.id)}
          >
            {c.itemName}
          </button>
        ))}
      </div>

      {inCart && (
        <div className="flip-banner" role="button" onClick={onNavigateToCart}>
          🛒 This item is in your cart — tap to view
        </div>
      )}
      {!inCart && inListing && (
        <div className="flip-banner" role="button" onClick={onNavigateToListing}>
          🏷️ Currently in Listing Mode — tap to view
        </div>
      )}

      {selectedId ? (
        <ChatThread
          chatHistory={chatHistory}
          onUpdateHistory={handleUpdateHistory}
          itemContext={activeConv?.itemContext ?? null}
        />
      ) : (
        <div className="flip-empty">
          <span className="empty-icon">💬</span>
          <p>No saved chats yet — tap + New or analyze an item in Shopping.</p>
        </div>
      )}
    </div>
  );
}
