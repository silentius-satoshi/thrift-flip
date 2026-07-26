import './Chip.css';

export default function Chip({ selected = false, onPress, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`ui-chip${selected ? ' selected' : ''}${className ? ` ${className}` : ''}`}
      onClick={onPress}
      {...rest}
    >
      {children}
    </button>
  );
}
