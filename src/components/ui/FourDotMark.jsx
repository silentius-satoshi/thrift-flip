import './FourDotMark.css';

export default function FourDotMark({ className = '', ...rest }) {
  return (
    <span className={`ui-fourdot${className ? ` ${className}` : ''}`} aria-hidden="true" {...rest}>
      <span /><span /><span /><span />
    </span>
  );
}
