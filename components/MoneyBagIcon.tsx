import React from 'react';

interface MoneyBagIconProps {
  size?: number;
  className?: string;
}

/** Money bag: outline only (no fill). Sack with gathered top + dollar sign. Live Trading UI. */
const MoneyBagIcon: React.FC<MoneyBagIconProps> = ({ size = 24, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Bag: outline only, no fill. Gathered top, rounded sack. */}
    <path fill="none" d="M9 6 L7.5 7.5 Q6 11 7 17 Q9 20 12 20 Q15 20 17 17 Q18 11 16.5 7.5 L15 6 Q12 5 9 6 Z" />
    {/* Dollar sign: outline only */}
    <path fill="none" d="M12 8v1M12 15v1" />
    <path fill="none" d="M13.5 11h-3a1 1 0 0 0 0 2h3a1 1 0 0 1 0 2h-3" />
  </svg>
);

export default MoneyBagIcon;
