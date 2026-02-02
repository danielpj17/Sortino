import React from 'react';

interface MoneyBagIconProps {
  size?: number;
  className?: string;
}

/** Line-art money bag with dollar sign — used for all Live Trading UI. */
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
    {/* Sack: bulbous bottom, cinched neck */}
    <path d="M5 8h14l-1.5 12H6.5L5 8z" />
    <path d="M8 8V6a4 4 0 0 1 8 0v2" />
    {/* Dollar sign on front */}
    <path d="M12 11v6" />
    <path d="M12 6v1" />
    <path d="M14 14h-2a1 1 0 0 0 0 2h2a1 1 0 0 1 0 2h-2" />
  </svg>
);

export default MoneyBagIcon;
