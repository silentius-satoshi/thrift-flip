import './NavBar.css';

export default function NavBar({ tabs = [], active, onSelect, className = '', ...rest }) {
  return (
    <nav className={`ui-nav${className ? ` ${className}` : ''}`} {...rest}>
      {tabs.map(({ id, label, icon, badge, badgeDot }) => (
        <button
          key={id}
          type="button"
          className={`ui-nav-tab${active === id ? ' active' : ''}`}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onSelect?.(id)}
        >
          <span className="ui-nav-icon">
            {icon}
            {badge ? <span className="ui-nav-badge">{badge}</span> : null}
            {badgeDot && <span className="ui-nav-dot" />}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
