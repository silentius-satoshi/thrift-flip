import './Nav.css';

function ShopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
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

export default function Nav({ currentScreen, setCurrentScreen, cartCount }) {
  const tabs = [
    { id: 'shop',    label: 'Shopping', Icon: ShopIcon },
    { id: 'cart',    label: 'Cart',     Icon: CartIcon },
    { id: 'listing', label: 'Listing',  Icon: TagIcon  },
  ];

  return (
    <nav className="nav">
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`nav-tab ${currentScreen === id ? 'active' : ''}`}
          onClick={() => setCurrentScreen(id)}
        >
          <span className="nav-icon-wrap">
            <Icon />
            {id === 'cart' && cartCount > 0 && (
              <span className="nav-badge">{cartCount > 9 ? '9+' : cartCount}</span>
            )}
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}
