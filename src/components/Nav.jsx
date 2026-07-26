import NavBar from './ui/NavBar';

function ShopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.98-1.7l1.62-10.3H6" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4l3 3" />
      <path d="M3.05 11a9 9 0 1 0 .5-4" />
      <path d="M3 3v4h4" />
    </svg>
  );
}

export default function Nav({ currentScreen, setCurrentScreen, cartCount, hasActiveListing }) {
  const tabs = [
    { id: 'shop',    label: 'Shopping', icon: <ShopIcon /> },
    { id: 'flip',    label: 'Flip',     icon: <ChatIcon /> },
    { id: 'cart',    label: 'Cart',     icon: <CartIcon />, badge: cartCount > 0 ? (cartCount > 9 ? '9+' : cartCount) : null },
    { id: 'listing', label: 'Listing',  icon: <TagIcon />,  badgeDot: hasActiveListing },
    { id: 'history', label: 'History',  icon: <HistoryIcon /> },
  ];

  return <NavBar tabs={tabs} active={currentScreen} onSelect={setCurrentScreen} />;
}
