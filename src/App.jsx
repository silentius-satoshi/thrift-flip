import { useState, useEffect } from 'react';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { UserProvider } from './contexts/UserContext';
import { useCart } from './hooks/useCart';
import { calcProfit } from './utils/calculations';
import { saveDraft } from './utils/draftsStore';
import Nav from './components/Nav';
import ShoppingMode from './components/ShoppingMode';
import FlipMode from './components/FlipMode';
import CartMode from './components/CartMode';
import ListingMode from './components/ListingMode';
import PreviewMode from './components/PreviewMode';
import HistoryMode from './components/HistoryMode';
import DraftsMode from './components/DraftsMode';
import './App.css';

function AppInner() {
  const { showToast } = useToast();
  const [currentScreen, setCurrentScreen] = useState(() => {
    // Direct read — sync required for useState lazy init
    const saved = localStorage.getItem('thrift-flip-screen');
    const valid = ['shop', 'flip', 'cart', 'listing', 'history', 'drafts'];
    if (saved === 'preview') return 'listing';
    return valid.includes(saved) ? saved : 'shop';
  });
  const [previewData, setPreviewData] = useState(null);
  const [flipTargetId, setFlipTargetId] = useState(null);
  const [previousScreen, setPreviousScreen] = useState(() => {
    // Direct read — sync required for useState lazy init
    return localStorage.getItem('thrift-flip-previous-screen') ?? null;
  });
  const { cart, addItem, removeItem } = useCart();

  const [listingItem, setListingItem] = useState(() => {
    try {
      const raw = localStorage.getItem('thrift-flip-listing');
      return raw ? JSON.parse(raw).item : null;
    } catch { return null; }
  });
  const [listingData, setListingData] = useState(() => {
    try {
      const raw = localStorage.getItem('thrift-flip-listing');
      return raw ? JSON.parse(raw).data : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (listingItem || listingData) {
      localStorage.setItem('thrift-flip-listing', JSON.stringify({ item: listingItem, data: listingData }));
    } else {
      localStorage.removeItem('thrift-flip-listing');
    }
  }, [listingItem, listingData]);

  useEffect(() => {
    localStorage.setItem('thrift-flip-screen', currentScreen);
  }, [currentScreen]);

  useEffect(() => {
    if (previousScreen !== null) {
      localStorage.setItem('thrift-flip-previous-screen', previousScreen);
    } else {
      localStorage.removeItem('thrift-flip-previous-screen');
    }
  }, [previousScreen]);

  function handleReadyToList(item, generatedListing) {
    setListingItem(item);
    setListingData(generatedListing);
    setCurrentScreen('listing');
  }

  function handleClearListing(options = {}) {
    const { skipAutoSave = false } = options;
    if (!skipAutoSave) {
      const edits = (() => {
        try { return JSON.parse(localStorage.getItem('thrift-flip-listing-edits')); } catch { return null; }
      })();
      if (edits && edits.title) {
        saveDraft({
          id: listingItem?.id,
          ...edits,
          photos: (edits.photos ?? []).map(d => ({ dataUrl: d, mimeType: 'image/jpeg' })),
          goodwillPrice: listingItem?.goodwillPrice ?? 0,
          estProfit: calcProfit(parseFloat(edits.price) || 0, listingItem?.goodwillPrice ?? 0).net,
          source: 'auto-saved',
        });
      }
    }
    localStorage.removeItem('thrift-flip-listing-edits');
    localStorage.removeItem('thrift-flip-previous-screen');
    setListingItem(null);
    setListingData(null);
    setCurrentScreen('cart');
  }

  function handleRestoreDraft(draft) {
    setListingItem({ id: draft.id, goodwillPrice: draft.goodwillPrice });
    setListingData({
      title: draft.title,
      condition: draft.condition,
      price: draft.price,
      description: draft.description,
      specifics: draft.specifics,
      category: draft.category,
    });
    localStorage.setItem('thrift-flip-listing-edits', JSON.stringify({
      title: draft.title,
      selectedCondition: draft.condition,
      price: String(draft.price),
      qty: '1',
      description: draft.description,
      specifics: draft.specifics,
      selectedShipping: draft.shipping,
      selectedCategory: draft.category,
      photos: (draft.photos ?? []).map(p => typeof p === 'string' ? p : p.dataUrl),
    }));
    setCurrentScreen('listing');
  }

  function handleSaveCurrentAsDraft() {
    const edits = (() => {
      try { return JSON.parse(localStorage.getItem('thrift-flip-listing-edits')); } catch { return null; }
    })();
    if (edits && edits.title) {
      saveDraft({
        id: listingItem?.id,
        ...edits,
        photos: (edits.photos ?? []).map(d => ({ dataUrl: d, mimeType: 'image/jpeg' })),
        goodwillPrice: listingItem?.goodwillPrice ?? 0,
        estProfit: calcProfit(parseFloat(edits.price) || 0, listingItem?.goodwillPrice ?? 0).net,
        source: 'manual',
      });
      showToast('Current listing saved as draft 🔖');
    }
  }

  function handlePreview(data) {
    setPreviewData(data);
    setCurrentScreen('preview');
  }

  return (
    <>
      {currentScreen === 'shop' && (
        <ShoppingMode
          onAddToCart={addItem}
          onNavigateToCart={() => setCurrentScreen('cart')}
          onGoToFlip={(id) => { setPreviousScreen('shop'); setFlipTargetId(id); setCurrentScreen('flip'); }}
        />
      )}
      {currentScreen === 'flip' && (
        <FlipMode
          cart={cart}
          listingItem={listingItem}
          onNavigateToCart={() => setCurrentScreen('cart')}
          onNavigateToListing={() => setCurrentScreen('listing')}
          targetConversationId={flipTargetId}
          onTargetConsumed={() => setFlipTargetId(null)}
          returnScreen={previousScreen}
          onReturn={() => { setCurrentScreen(previousScreen); setPreviousScreen(null); localStorage.removeItem('thrift-flip-previous-screen'); }}
        />
      )}
      {currentScreen === 'cart' && (
        <CartMode
          cart={cart}
          onRemoveItem={removeItem}
          onReadyToList={handleReadyToList}
          listingItem={listingItem}
          onSaveCurrentAsDraft={handleSaveCurrentAsDraft}
        />
      )}
      {currentScreen === 'listing' && (
        <ListingMode
          listingItem={listingItem}
          listingData={listingData}
          onClearListing={handleClearListing}
          onPreview={handlePreview}
          onRemoveFromCart={() => removeItem(listingItem?.id)}
          onViewDrafts={() => setCurrentScreen('drafts')}
        />
      )}
      {currentScreen === 'preview' && (
        <PreviewMode
          previewData={previewData}
          onBack={() => setCurrentScreen('listing')}
        />
      )}
      {currentScreen === 'history' && <HistoryMode />}
      {currentScreen === 'drafts' && (
        <DraftsMode
          onBack={() => setCurrentScreen('listing')}
          onRestoreDraft={handleRestoreDraft}
        />
      )}
      {currentScreen !== 'preview' && currentScreen !== 'drafts' && (
        <Nav
          currentScreen={currentScreen}
          setCurrentScreen={setCurrentScreen}
          cartCount={cart.length}
          hasActiveListing={listingItem !== null}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <UserProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </UserProvider>
  );
}
