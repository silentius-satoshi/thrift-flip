import './Card.css';

export default function Card({ flush = false, className = '', children, ...rest }) {
  return (
    <div className={`ui-card${flush ? ' flush' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}
