import NavBar from './ui/NavBar';

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
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

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </svg>
  );
}

export default function Nav({ currentScreen, setCurrentScreen, cartCount, hasActiveListing }) {
  // Conversations are about items being bought — the flip screen highlights Buy.
  // Settings is reached from the Selling header, so it keeps that tab lit.
  const ACTIVE_FOR = { flip: 'shop', settings: 'history' };
  const active = ACTIVE_FOR[currentScreen] ?? currentScreen;
  const tabs = [
    { id: 'shop',    label: 'Buy',     icon: <CameraIcon /> },
    { id: 'cart',    label: 'Cart',    icon: <CartIcon />, badge: cartCount > 0 ? (cartCount > 9 ? '9+' : cartCount) : null },
    { id: 'listing', label: 'List',    icon: <TagIcon />,  badgeDot: hasActiveListing },
    { id: 'history', label: 'Selling', icon: <ChartIcon /> },
  ];

  return <NavBar tabs={tabs} active={active} onSelect={setCurrentScreen} />;
}
