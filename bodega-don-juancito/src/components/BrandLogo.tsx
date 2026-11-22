import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'lg', className = '' }) => {
  const sizeClasses =
    size === 'sm'
      ? 'w-9 h-9 border border-amber-700/35'
      : 'w-28 h-28 border-2 border-amber-700/30 shadow-sm';

  return (
    <div
      className={`rounded-full overflow-hidden bg-white shrink-0 ${sizeClasses} ${className}`}
    >
      <img
        src="/assets/aistudio/1795355857364_30bf3593.jpg"
        alt="Logo Don Juancito — Tienda y Abarrotes"
        className="w-full h-full object-cover object-[50%_49.2%]"
      />
    </div>
  );
};
