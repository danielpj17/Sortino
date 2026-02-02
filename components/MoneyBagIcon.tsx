import React from 'react';
import { CircleDollarSign } from 'lucide-react';

interface MoneyBagIconProps {
  size?: number;
  className?: string;
}

/** Live Trading icon: Lucide CircleDollarSign (clean money icon). */
const MoneyBagIcon: React.FC<MoneyBagIconProps> = ({ size = 24, className = '' }) => (
  <CircleDollarSign size={size} className={className} />
);

export default MoneyBagIcon;
