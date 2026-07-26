import './Button.css';

export default function Button({ variant = 'primary', full = false, size = 'md', className = '', children, ...rest }) {
  return (
    <button
      className={`ui-btn ui-btn-${variant} ui-btn-${size}${full ? ' ui-btn-full' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
