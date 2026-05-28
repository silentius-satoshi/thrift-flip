import { useState, useEffect } from 'react';
import { ToastProvider } from './contexts/ToastContext';
import { UserProvider } from './contexts/UserContext';
import { useCart } from './hooks/useCart';
import Nav from './components/Nav';
import ShoppingMode from './components/ShoppingMode';
import FlipMode from './components/FlipMode';
import CartMode from './components/CartMode';
import ListingMode from './components/ListingMode';
import PreviewMode from './components/PreviewMode';
import HistoryMode from './components/HistoryMode';
import './App.css';

function AppInner() {
  const [currentScreen, setCurrentScreen] = useState(() => {
    // Direct read — sync required for useState lazy init
    const saved = localStorage.getItem('thrift-flip-screen');
    const valid = ['shop', 'flip', 'cart', 'listing', 'history'];
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

  function handleClearListing() {
    localStorage.removeItem('thrift-flip-listing-edits');
    setListingItem(null);
    setListingData(null);
    setCurrentScreen('cart');
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
        />
      )}
      {currentScreen === 'listing' && (
        <ListingMode
          listingItem={listingItem}
          listingData={listingData}
          onClearListing={handleClearListing}
          onPreview={handlePreview}
          onRemoveFromCart={() => removeItem(listingItem?.id)}
        />
      )}
      {currentScreen === 'preview' && (
        <PreviewMode
          previewData={previewData}
          onBack={() => setCurrentScreen('listing')}
        />
      )}
      {currentScreen === 'history' && <HistoryMode />}
      {currentScreen !== 'preview' && (
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
