import { useState, useEffect } from 'react';

const STORAGE_KEY = 'thrift-flip-cart';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useCart() {
  const [cart, setCart] = useState(loadFromStorage);

  useEffect(() => {
    // Strip photoBase64 before persisting — full base64 images blow the 5MB localStorage limit
    const serializable = cart.map(({ photoBase64: _, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }, [cart]);

  function addItem(item) {
    setCart(prev => [...prev, { ...item, id: item.id ?? Date.now(), addedAt: Date.now() }]);
  }

  function removeItem(id) {
    setCart(prev => prev.filter(item => item.id !== id));
  }

  function updateItem(id, updates) {
    setCart(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }

  function clearCart() {
    setCart([]);
  }

  return { cart, addItem, removeItem, updateItem, clearCart };
}
