import { useState, useEffect } from 'react';
import { ToastProvider } from './contexts/ToastContext';
import { useCart } from './hooks/useCart';
import Nav from './components/Nav';
import ShoppingMode from './components/ShoppingMode';
import CartMode from './components/CartMode';
import ListingMode from './components/ListingMode';
import PreviewMode from './components/PreviewMode';
import './App.css';

function AppInner() {
  const [currentScreen, setCurrentScreen] = useState('shop');
  const [previewData, setPreviewData] = useState(null);
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
        />
      )}
      {currentScreen === 'cart' && (
        <CartMode
          cart={cart}
          onRemoveItem={removeItem}
          onReadyToList={handleReadyToList}
        />
      )}
      {currentScreen === 'listing' && (
        <ListingMode
          listingItem={listingItem}
          listingData={listingData}
          onClearListing={handleClearListing}
          onPreview={handlePreview}
        />
      )}
      {currentScreen === 'preview' && (
        <PreviewMode
          previewData={previewData}
          onBack={() => setCurrentScreen('listing')}
        />
      )}
      {currentScreen !== 'preview' && (
        <Nav
          currentScreen={currentScreen}
          setCurrentScreen={setCurrentScreen}
          cartCount={cart.length}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
