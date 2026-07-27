import './IconButton.css';

// Circular icon-only control. `label` is required and becomes the accessible
// name — an icon button with no name is invisible to a screen reader.
export default function IconButton({ label, size = 'md', tone = 'plain', className = '', children, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`ui-iconbtn ui-iconbtn-${size} ui-iconbtn-${tone}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
