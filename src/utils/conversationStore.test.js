import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveConversation, updateItemContext, updateChatHistory, getConversation, getIndex,
} from './conversationStore';

const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

const ID = 1730000000000;
const THREAD = [
  { role: 'ai', text: 'Pendleton blankets in this pattern sell well.' },
  { role: 'user', text: 'Is the tag original?' },
  { role: 'ai', text: 'It looks like a 1970s label, yes.' },
];

describe('updateItemContext — a revision is not a new conversation', () => {
  // W1: a re-check carries new notes and a new condition, so the item's context
  // changes. saveConversation writes the whole record, chatHistory included —
  // so routing a re-check through it would replace a real Flip thread with the
  // fresh analysis's one-line teaser. This is the whole reason it exists.
  it('leaves the chat completely alone', () => {
    saveConversation(ID, 'wool blanket', THREAD, { details: 'wool blanket', condition: 'Good' });
    updateItemContext(ID, { details: 'wool blanket, the box is a bit rough', condition: 'Fair' });

    expect(getConversation(ID).chatHistory).toEqual(THREAD);
  });

  it('merges the new context over the old rather than replacing it', () => {
    saveConversation(ID, 'wool blanket', THREAD, { details: 'wool blanket', condition: 'Good', goodwillPrice: 8 });
    updateItemContext(ID, { details: 'wool blanket, box rough', condition: 'Fair' });

    expect(getConversation(ID).itemContext).toEqual({
      details: 'wool blanket, box rough',
      condition: 'Fair',
      goodwillPrice: 8,   // untouched by a revision that never mentioned it
    });
  });

  it('keeps the rest of the record intact', () => {
    saveConversation(ID, 'wool blanket', THREAD, { details: 'wool blanket' });
    const before = getConversation(ID);
    updateItemContext(ID, { condition: 'Fair' });
    const after = getConversation(ID);

    expect(after.itemId).toBe(before.itemId);
    expect(after.itemName).toBe(before.itemName);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('does nothing at all for an item with no conversation', () => {
    expect(() => updateItemContext(999, { condition: 'Fair' })).not.toThrow();
    expect(getConversation(999)).toBeNull();
    expect(getIndex()).toEqual([]);
  });

  it('survives a corrupt record rather than throwing', () => {
    localStorage.setItem(`thrift-flip-conversation-${ID}`, '{not json');
    expect(() => updateItemContext(ID, { condition: 'Fair' })).not.toThrow();
  });

  // The two updaters are mirrors; neither may reach into the other's half.
  it('does not disturb a chat updated after the revision', () => {
    saveConversation(ID, 'wool blanket', THREAD, { details: 'wool blanket' });
    updateItemContext(ID, { condition: 'Fair' });
    updateChatHistory(ID, [...THREAD, { role: 'user', text: 'Worth relisting?' }]);

    const record = getConversation(ID);
    expect(record.chatHistory).toHaveLength(4);
    expect(record.itemContext.condition).toBe('Fair');
  });
});

describe('saveConversation — what the revision path is avoiding', () => {
  // Pinned so the reason updateItemContext exists cannot quietly stop being true.
  it('replaces the whole record, chat included', () => {
    saveConversation(ID, 'wool blanket', THREAD, { details: 'wool blanket' });
    saveConversation(ID, 'wool blanket', [{ role: 'ai', text: 'fresh teaser' }], { details: 'wool blanket, rough' });

    expect(getConversation(ID).chatHistory).toHaveLength(1);
  });

  it('does not duplicate the index entry on a re-save', () => {
    saveConversation(ID, 'wool blanket', THREAD, {});
    saveConversation(ID, 'wool blanket', THREAD, {});
    expect(getIndex()).toHaveLength(1);
  });
});
