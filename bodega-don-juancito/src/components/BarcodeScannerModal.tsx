import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, X, Keyboard, Check, AlertCircle } from 'lucide-react';

interface ScannerSampleProduct {
  id: string;
  name: string;
  barcode?: string;
}

interface BarcodeScannerModalProps {
  isOpen: boolean;
  title?: string;
  subtitle?: string;
  continuous?: boolean;
  lastScannedFeedback?: string | null;
  sampleProducts?: ScannerSampleProduct[];
  onClose: () => void;
  onScan: (barcode: string) => void;
}

const SCANNER_ELEMENT_ID = 'bodega-barcode-reader';

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  title = 'Escanear código de barras',
  subtitle = 'Apunta la cámara trasera al código del producto',
  continuous = false,
  lastScannedFeedback = null,
  sampleProducts = [],
  onClose,
  onScan,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; timestamp: number }>({ code: '', timestamp: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setCameraError(null);
    setCameraActive(false);

    const startScanner = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (cancelled) return;

        const container = document.getElementById(SCANNER_ELEMENT_ID);
        if (!container) return;

        const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
        });
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            qrbox: { width: 250, height: 130 },
            aspectRatio: 1.333,
          },
          (decodedText) => {
            const now = Date.now();
            // 1.5s cooldown for the exact same code so continuous scanning doesn't double-fire accidentally
            if (
              decodedText === lastScanRef.current.code &&
              now - lastScanRef.current.timestamp < 1500
            ) {
              return;
            }
            lastScanRef.current = { code: decodedText, timestamp: now };
            onScanRef.current(decodedText.trim());
          },
          () => {
            // Ignore per-frame decode misses
          }
        );

        if (!cancelled) {
          setCameraActive(true);
        } else {
          await html5QrCode.stop().catch(() => {});
          html5QrCode.clear();
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'No se pudo acceder a la cámara del dispositivo.';
          setCameraError(
            message.includes('Permission') || message.includes('NotAllowed')
              ? 'Permiso de cámara denegado. Actívalo en tu navegador o ingresa el código manualmente abajo.'
              : 'Cámara no disponible aquí. Puedes escribir el código o probar con un producto rápido abajo.'
          );
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        if (instance.isScanning) {
          instance
            .stop()
            .then(() => {
              try {
                instance.clear();
              } catch {
                // ignore
              }
            })
            .catch(() => {});
        } else {
          try {
            instance.clear();
          } catch {
            // ignore
          }
        }
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) return;
    onScan(clean);
    setManualCode('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="min-w-0 pr-3">
            <h2 className="text-base font-bold text-slate-900 truncate">{title}</h2>
            <p className="text-xs text-slate-500 truncate">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95 transition"
            aria-label="Cerrar escáner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Camera Viewfinder */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 min-h-[220px] flex items-center justify-center">
            <div id={SCANNER_ELEMENT_ID} className="w-full" />

            {!cameraActive && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 gap-2 p-4 text-center">
                <Camera className="w-8 h-8 text-teal-400" />
                <p className="text-sm font-medium">Iniciando cámara...</p>
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-200 p-5 text-center gap-2">
                <AlertCircle className="w-8 h-8 text-amber-400 shrink-0" />
                <p className="text-sm leading-relaxed">{cameraError}</p>
              </div>
            )}
          </div>

          {/* Continuous feedback banner */}
          {lastScannedFeedback && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 text-sm font-medium">
              <Check className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="truncate">{lastScannedFeedback}</span>
            </div>
          )}

          {/* Manual Barcode Fallback */}
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Keyboard className="w-3.5 h-3.5 text-slate-500" />
              <span>Ingresar código manualmente</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Ej. 7750243000125"
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:scale-[0.98] transition whitespace-nowrap shrink-0"
              >
                Agregar
              </button>
            </div>
          </form>

          {/* Quick barcode shortcuts for registered products */}
          {sampleProducts.some((p) => Boolean(p.barcode)) && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-medium text-slate-500">
                Atajo rápido (productos con código):
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sampleProducts
                  .filter((p) => Boolean(p.barcode))
                  .slice(0, 4)
                  .map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => prod.barcode && onScan(prod.barcode)}
                      className="min-h-[44px] px-3 py-2 text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 active:scale-[0.98] transition"
                    >
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {prod.name}
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-500 truncate">
                        {prod.barcode}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 active:scale-[0.99] transition"
          >
            {continuous ? 'Listo, volver a la cuenta' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
};
