import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`min-h-[44px] px-4 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-bold text-teal-900 flex items-center justify-center gap-2 transition ${className}`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Instalar app en celular</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`min-h-[44px] px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 transition ${className}`}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Agregar a pantalla de inicio (iPhone)</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-slate-200 space-y-3">
              <h3 className="text-base font-bold text-slate-900">
                Instalar Don Juancito en iPhone / iPad
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Toca el botón <strong>Compartir</strong> en la barra de Safari.
                <br />
                2. Desliza y toca <strong>Agregar a pantalla de inicio</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
