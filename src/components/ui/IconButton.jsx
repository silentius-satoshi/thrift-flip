import './IconButton.css';

// Circular icon-only control. `label` is required and becomes the accessible
// name — an icon button with no name is invisible to a screen reader.
export default function IconButton({ label, size = 'md', tone = 'plain', className = '', children, ...rest }) {
  // sm (34px) and md (40px) are drawn smaller than a thumb on purpose — a back
  // arrow should not weigh as much as the screen it sits above. The halo brings
  // the touch area to 44 without moving or repainting anything. lg is already 44.
  const slop = size === 'lg' ? '' : ' tap44';
  return (
    <button
      type="button"
      aria-label={label}
      className={`ui-iconbtn ui-iconbtn-${size} ui-iconbtn-${tone}${slop}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
