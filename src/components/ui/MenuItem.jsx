import './MenuItem.css';

// Compact row for point-anchored menus. Row's 64px min-height is a list-item
// height, not a menu-item height.
export default function MenuItem({ tone = 'default', className = '', children, ...rest }) {
  return (
    <button type="button" className={`ui-menuitem ui-menuitem-${tone}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
