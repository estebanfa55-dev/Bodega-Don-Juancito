import React, { useMemo, useState } from 'react';
import {
  Camera,
  Plus,
  Minus,
  Trash2,
  Search,
  Banknote,
  Smartphone,
  BookOpen,
  Tag,
  CheckCircle2,
  X,
  UserPlus,
  AlertCircle,
  Zap,
  RotateCcw,
  WifiOff,
  CloudUpload,
  Settings2,
  QrCode,
  Loader2,
} from 'lucide-react';
import type {
  CartItem,
  PaymentMethod,
  PosCustomer,
  PosProduct,
  PosQuickButton,
  PosRecentSale,
  PosSuggestion,
  UserRole,
} from '../types/bodega';
import type { CompleteSaleResult } from '../store/useBodegaStore';
import { formatCurrency, formatDateTime, generateId, playScanBeep } from '../utils/format';
import { processYapeQrImageFile } from '../utils/qrImage';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { BrandLogo } from './BrandLogo';

interface PosViewProps {
  userRole: UserRole;
  isOnline: boolean;
  hasPendingWrites: boolean;
  products: PosProduct[];
  customers: PosCustomer[];
  suggestions: PosSuggestion[];
  quickButtons: PosQuickButton[];
  recentSales: PosRecentSale[];
  findPosProductByBarcode: (barcode: string) => PosProduct | undefined;
  createQuickProduct: (input: {
    barcode?: string;
    name: string;
    salePrice: number;
    costPrice?: number;
    stock?: number;
  }) => Promise<PosProduct | null>;
  completeSale: (params: {
    cart: CartItem[];
    paymentMethod: PaymentMethod;
    customerId?: string;
    newCustomerName?: string;
    newCustomerPhone?: string;
    allowOverLimit?: boolean;
  }) => Promise<CompleteSaleResult>;
  voidSale: (saleId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  addQuickButton: (params: { name: string; price: number; costPrice: number }) => Promise<boolean>;
  deleteQuickButton: (id: string) => Promise<boolean>;
  yapeQrDataUrl: string | null;
  saveYapeQr: (dataUrl: string) => Promise<boolean>;
}

export const PosView: React.FC<PosViewProps> = ({
  userRole,
  isOnline,
  hasPendingWrites,
  products,
  customers,
  suggestions,
  quickButtons,
  recentSales,
  findPosProductByBarcode,
  createQuickProduct,
  completeSale,
  voidSale,
  addQuickButton,
  deleteQuickButton,
  yapeQrDataUrl,
  saveYapeQr,
}) => {
  const isAdmin = userRole === 'admin';

  const [cart, setCart] = useState<CartItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScannedFeedback, setLastScannedFeedback] = useState<string | null>(null);

  // Unknown barcode modal state
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [newProdName, setNewProdName] = useState('');
  const [newProdSalePrice, setNewProdSalePrice] = useState('');
  const [newProdCostPrice, setNewProdCostPrice] = useState('');
  const [newProdStock, setNewProdStock] = useState('1');
  const [savingQuickProd, setSavingQuickProd] = useState(false);

  // Unlisted ("Producto sin código") state
  const [showUnlistedForm, setShowUnlistedForm] = useState(false);
  const [unlistedName, setUnlistedName] = useState('');
  const [unlistedPrice, setUnlistedPrice] = useState('');
  const [unlistedCost, setUnlistedCost] = useState('');

  // Quick buttons config (Admin only)
  const [configQuickOpen, setConfigQuickOpen] = useState(false);
  const [qbName, setQbName] = useState('');
  const [qbPrice, setQbPrice] = useState('');
  const [qbCost, setQbCost] = useState('');

  // Quick inventory search
  const [searchQuery, setSearchQuery] = useState('');

  // Checkout modals
  const [checkoutModal, setCheckoutModal] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [submittingSale, setSubmittingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [overLimitConfirm, setOverLimitConfirm] = useState<string | null>(null);

  // Recent sales / Void modal
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PosRecentSale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Sale completed banner
  const [saleBanner, setSaleBanner] = useState<string | null>(null);

  // Yape QR upload state
  const qrInputRef = React.useRef<HTMLInputElement | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const cartTotal = useMemo(
    () => Number(cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2)),
    [cart]
  );

  const totalUnits = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const addProductToCart = (product: PosProduct) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => !i.isUnlisted && i.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        {
          id: generateId('cart'),
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          unitPrice: product.salePrice,
          unitCost: 0,
          quantity: 1,
          isUnlisted: false,
        },
        ...prev,
      ];
    });
  };

  const addQuickItemToCart = (name: string, price: number) => {
    setCart((prev) => {
      const idx = prev.findIndex(
        (i) => i.isUnlisted && i.name.toLowerCase() === name.toLowerCase() && i.unitPrice === price
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        {
          id: generateId('cart'),
          name,
          unitPrice: price,
          unitCost: 0,
          quantity: 1,
          isUnlisted: true,
        },
        ...prev,
      ];
    });
  };

  const handleBarcodeScanned = (barcode: string) => {
    playScanBeep();
    const found = findPosProductByBarcode(barcode);
    if (found) {
      addProductToCart(found);
      setLastScannedFeedback(`Agregado: ${found.name} (${formatCurrency(found.salePrice)})`);
    } else {
      setScannerOpen(false);
      setUnknownBarcode(barcode);
      setNewProdName('');
      setNewProdSalePrice('');
      setNewProdCostPrice('');
      setNewProdStock('1');
    }
  };

  const handleSaveUnknownProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unknownBarcode || !newProdName.trim()) return;
    const salePrice = parseFloat(newProdSalePrice) || 0;
    const costPrice = parseFloat(newProdCostPrice) || 0;
    const stock = parseInt(newProdStock, 10) || 1;
    if (salePrice <= 0) return;

    setSavingQuickProd(true);
    const created = await createQuickProduct({
      barcode: unknownBarcode,
      name: newProdName.trim(),
      salePrice,
      costPrice: isAdmin ? costPrice : undefined,
      stock: isAdmin ? stock : undefined,
    });
    setSavingQuickProd(false);

    if (created) {
      addProductToCart(created);
      setUnknownBarcode(null);
    }
  };

  const handleAddUnlisted = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = unlistedName.trim();
    const price = parseFloat(unlistedPrice);
    const cost = isAdmin ? parseFloat(unlistedCost) || 0 : 0;
    if (!cleanName || !Number.isFinite(price) || price <= 0) return;

    setCart((prev) => {
      const idx = prev.findIndex(
        (i) =>
          i.isUnlisted &&
          i.name.toLowerCase() === cleanName.toLowerCase() &&
          i.unitPrice === price
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        {
          id: generateId('cart'),
          name: cleanName,
          unitPrice: Number(price.toFixed(2)),
          unitCost: Number(cost.toFixed(2)),
          quantity: 1,
          isUnlisted: true,
        },
        ...prev,
      ];
    });

    setUnlistedName('');
    setUnlistedPrice('');
    setUnlistedCost('');
    setShowUnlistedForm(false);
  };

  const applySuggestion = (s: PosSuggestion) => {
    setUnlistedName(s.name);
    setUnlistedPrice(s.lastPrice.toString());
    setUnlistedCost('');
  };

  const updateCartQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const removeCartItem = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const filteredSuggestions = useMemo(() => {
    const q = unlistedName.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 6);
    return suggestions.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [unlistedName, suggestions]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [products, searchQuery]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
  }, [customers, customerSearch]);

  const selectedCustomerObj = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const clientLimitWarning = useMemo(() => {
    if (
      checkoutModal !== 'fiado' ||
      !selectedCustomerObj ||
      typeof selectedCustomerObj.creditLimit !== 'number'
    ) {
      return null;
    }
    const debt = selectedCustomerObj.currentDebt ?? 0;
    const projected = debt + cartTotal;
    if (projected > selectedCustomerObj.creditLimit) {
      return `Tope de fiado: ${formatCurrency(selectedCustomerObj.creditLimit)}. Con esta venta llega a ${formatCurrency(projected)}.`;
    }
    return null;
  }, [checkoutModal, selectedCustomerObj, cartTotal]);

  const openCheckout = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    setCheckoutModal(method);
    setCashReceived('');
    setSelectedCustomerId('');
    setNewCustomerName('');
    setNewCustomerPhone('');
    setCustomerSearch('');
    setSaleError(null);
    setQrError(null);
    setOverLimitConfirm(null);
  };

  const handleQrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isAdmin) return;
    setQrError(null);
    setQrUploading(true);
    try {
      const dataUrl = await processYapeQrImageFile(file);
      const ok = await saveYapeQr(dataUrl);
      if (ok) {
        setSaleBanner('QR de Yape de Don Juancito guardado en la tienda.');
        setTimeout(() => setSaleBanner(null), 4000);
      } else {
        setQrError('No se pudo guardar el QR. Verifica tu sesión e intenta otra vez.');
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'No se pudo procesar la imagen del QR.');
    } finally {
      setQrUploading(false);
    }
  };

  const handleConfirmCheckout = async (allowOverLimit = false) => {
    if (!checkoutModal || cart.length === 0) return;
    if (checkoutModal === 'fiado' && !selectedCustomerId && !newCustomerName.trim()) {
      return;
    }

    setSubmittingSale(true);
    setSaleError(null);

    const result = await completeSale({
      cart,
      paymentMethod: checkoutModal,
      customerId: selectedCustomerId || undefined,
      newCustomerName: newCustomerName.trim() || undefined,
      newCustomerPhone: isAdmin ? newCustomerPhone.trim() || undefined : undefined,
      allowOverLimit,
    });

    setSubmittingSale(false);

    if (result.creditLimitExceeded) {
      setOverLimitConfirm(result.creditLimitExceeded.message);
      return;
    }

    if (result.error) {
      setSaleError(result.error);
      return;
    }

    const methodLabel =
      checkoutModal === 'efectivo'
        ? 'Efectivo'
        : checkoutModal === 'yape'
          ? 'Yape'
          : `Fiado a ${result.customerName || 'Cliente'}`;

    setSaleBanner(
      result.offlineQueued
        ? `Guardado sin internet · ${formatCurrency(result.total)} · ${methodLabel} (se sincronizará)`
        : `Cobro registrado · ${formatCurrency(result.total)} · ${methodLabel}`
    );
    setTimeout(() => setSaleBanner(null), 4500);
    setCart([]);
    setCheckoutModal(null);
    setOverLimitConfirm(null);
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setVoiding(true);
    const res = await voidSale(voidTarget.id, voidReason.trim() || 'Error en cobro');
    setVoiding(false);
    if (res.ok) {
      setSaleBanner(`Venta de ${formatCurrency(voidTarget.total)} anulada y stock repuesto.`);
      setTimeout(() => setSaleBanner(null), 4000);
      setVoidTarget(null);
      setVoidReason('');
      setRecentModalOpen(false);
    } else {
      setSaleError(res.error || 'No se pudo anular.');
    }
  };

  const handleAddQuickButton = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(qbPrice);
    const cost = parseFloat(qbCost) || 0;
    if (!qbName.trim() || !Number.isFinite(price) || price <= 0) return;
    const ok = await addQuickButton({ name: qbName.trim(), price, costPrice: cost });
    if (ok) {
      setQbName('');
      setQbPrice('');
      setQbCost('');
    }
  };

  const cashReceivedNum = parseFloat(cashReceived);
  const changeDue =
    Number.isFinite(cashReceivedNum) && cashReceivedNum >= cartTotal
      ? cashReceivedNum - cartTotal
      : null;

  return (
    <div className="space-y-4">
      {/* Offline / Pending Sync Banner */}
      {(!isOnline || hasPendingWrites) && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-semibold ${
            !isOnline
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!isOnline ? (
              <WifiOff className="w-4 h-4 shrink-0" />
            ) : (
              <CloudUpload className="w-4 h-4 shrink-0" />
            )}
            <span>
              {!isOnline
                ? 'Sin internet · Tus cobros se guardan en este celular y subirán solos al volver la señal.'
                : 'Sincronizando movimientos pendientes con la nube...'}
            </span>
          </div>
        </div>
      )}

      {/* Sale confirmation feedback */}
      {saleBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0" />
            <span className="text-sm font-semibold truncate">{saleBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaleBanner(null)}
            className="text-teal-700 p-1 hover:bg-teal-100 rounded-lg"
            aria-label="Cerrar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Capture Controls */}
        <div className="lg:col-span-6 space-y-4">
          {/* Primary Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setLastScannedFeedback(null);
                setScannerOpen(true);
              }}
              className="min-h-[64px] px-4 py-3 rounded-2xl bg-teal-700 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-sm hover:bg-teal-800 active:scale-[0.98] transition"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <span className="whitespace-nowrap">Escanear código</span>
            </button>

            <button
              type="button"
              onClick={() => setShowUnlistedForm((v) => !v)}
              className={`min-h-[64px] px-4 py-3 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 border transition active:scale-[0.98] ${
                showUnlistedForm
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Tag className="w-5 h-5 shrink-0" />
              <span className="whitespace-nowrap">Sin código</span>
            </button>
          </div>

          {/* Configurable 1-Tap Venta Rápida Buttons */}
          {(quickButtons.length > 0 || isAdmin) && (
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                  <span>Venta rápida (1 toque)</span>
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setConfigQuickOpen((v) => !v)}
                    className="min-h-[32px] px-2.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>{configQuickOpen ? 'Listo' : 'Configurar'}</span>
                  </button>
                )}
              </div>

              {quickButtons.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {quickButtons.map((qb) => (
                    <div key={qb.id} className="relative flex">
                      <button
                        type="button"
                        onClick={() => addQuickItemToCart(qb.name, qb.price)}
                        className="w-full min-h-[52px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-300 active:scale-[0.97] text-left transition flex flex-col justify-center"
                      >
                        <span className="text-xs font-bold text-slate-900 truncate w-full">
                          {qb.name}
                        </span>
                        <span className="text-xs font-mono-num font-bold text-teal-800">
                          {formatCurrency(qb.price)}
                        </span>
                      </button>
                      {isAdmin && configQuickOpen && (
                        <button
                          type="button"
                          onClick={() => deleteQuickButton(qb.id)}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                          aria-label={`Eliminar botón ${qb.name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isAdmin && configQuickOpen && (
                <form
                  onSubmit={handleAddQuickButton}
                  className="pt-2 border-t border-slate-100 grid grid-cols-12 gap-2 items-end"
                >
                  <div className="col-span-5">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Producto
                    </label>
                    <input
                      type="text"
                      required
                      value={qbName}
                      onChange={(e) => setQbName(e.target.value)}
                      placeholder="Ej. Limón x4"
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Precio S/
                    </label>
                    <input
                      type="number"
                      step="0.10"
                      min="0.10"
                      required
                      inputMode="decimal"
                      value={qbPrice}
                      onChange={(e) => setQbPrice(e.target.value)}
                      placeholder="1.00"
                      className="w-full min-h-[40px] px-2 rounded-lg border border-slate-300 text-xs font-mono-num"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">Costo</label>
                    <input
                      type="number"
                      step="0.10"
                      min="0"
                      inputMode="decimal"
                      value={qbCost}
                      onChange={(e) => setQbCost(e.target.value)}
                      placeholder="0.50"
                      className="w-full min-h-[40px] px-2 rounded-lg border border-slate-200 text-xs font-mono-num"
                    />
                  </div>
                  <button
                    type="submit"
                    className="col-span-2 min-h-[40px] rounded-lg bg-slate-900 text-white text-xs font-bold"
                  >
                    +
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Unlisted ("Productos sin código") Form */}
          {showUnlistedForm && (
            <form
              onSubmit={handleAddUnlisted}
              className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Producto sin código de barras
                </h2>
                <button
                  type="button"
                  onClick={() => setShowUnlistedForm(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900 px-2 py-1"
                >
                  Ocultar
                </button>
              </div>

              {filteredSuggestions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">Frecuentes (toca para rellenar):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredSuggestions.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => applySuggestion(s)}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition flex items-center gap-1.5"
                      >
                        <span>{s.name}</span>
                        <span className="text-slate-400" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-num font-semibold text-teal-800">
                          {formatCurrency(s.lastPrice)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre del producto
                  </label>
                  <input
                    type="text"
                    value={unlistedName}
                    onChange={(e) => setUnlistedName(e.target.value)}
                    placeholder="Ej. Pan francés, queso fresco, papa..."
                    required
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div className={`grid gap-2.5 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Precio a cobrar (S/)
                    </label>
                    <input
                      type="number"
                      step="0.10"
                      min="0.10"
                      inputMode="decimal"
                      value={unlistedPrice}
                      onChange={(e) => setUnlistedPrice(e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-base font-mono-num font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  {isAdmin && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Costo aprox. (opcional)
                      </label>
                      <input
                        type="number"
                        step="0.10"
                        min="0"
                        inputMode="decimal"
                        value={unlistedCost}
                        onChange={(e) => setUnlistedCost(e.target.value)}
                        placeholder="0.00"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-base font-mono-num text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 active:scale-[0.99] transition"
              >
                Agregar a la lista de cobro
              </button>
            </form>
          )}

          {/* Quick Catalog Search */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto por nombre o código..."
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            {searchQuery.trim() ? (
              filteredProducts.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {filteredProducts.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => {
                        addProductToCart(prod);
                        setSearchQuery('');
                      }}
                      className="w-full min-h-[52px] py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-xl text-left transition"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{prod.name}</p>
                        <p className="text-xs text-slate-500">
                          {prod.unitLabel || 'und'}
                          {prod.barcode ? ` · ${prod.barcode}` : ''}
                        </p>
                      </div>
                      <span className="font-mono-num text-sm font-bold text-teal-800 shrink-0">
                        {formatCurrency(prod.salePrice)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-2 text-center">
                  No se encontró "{searchQuery}". Usa "Sin código" o escanea para agregarlo.
                </p>
              )
            ) : (
              products.length > 0 && (
                <div className="pt-0.5">
                  <p className="text-xs text-slate-500 mb-2">Productos frecuentes:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {products.slice(0, 4).map((prod) => (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => addProductToCart(prod)}
                        className="min-h-[48px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100 active:scale-[0.98] text-left transition flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-semibold text-slate-800 line-clamp-1">
                          {prod.name}
                        </span>
                        <span className="text-xs font-mono-num font-bold text-teal-800 shrink-0">
                          {formatCurrency(prod.salePrice)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Active Cart + Total & Payment Buttons */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">Cuenta actual</h2>
                <p className="text-xs text-slate-500">
                  {totalUnits === 0
                    ? 'Aún no hay productos'
                    : `${totalUnits} ${totalUnits === 1 ? 'producto' : 'productos'} en lista`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {recentSales.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSaleError(null);
                      setVoidTarget(null);
                      setRecentModalOpen(true);
                    }}
                    className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Anular venta</span>
                  </button>
                )}
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="min-h-[36px] px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg transition"
                  >
                    Vaciar
                  </button>
                )}
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="py-10 px-5 text-center space-y-2">
                <p className="text-sm font-medium text-slate-600">
                  Escanea un código de barras, toca una venta rápida o agrega un producto sin código.
                </p>
                <p className="text-xs text-slate-400">
                  Si vuelves a escanear el mismo producto, la cantidad sube automáticamente.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
                {cart.map((item) => {
                  const subtotal = item.unitPrice * item.quantity;
                  return (
                    <li key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500 font-mono-num">
                          {formatCurrency(item.unitPrice)} c/u
                          <span aria-hidden="true"> · </span>
                          {item.isUnlisted ? 'Sin código' : 'Con código'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.id, -1)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 active:scale-95 transition"
                          aria-label={`Disminuir cantidad de ${item.name}`}
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-8 text-center font-mono-num text-sm font-bold text-slate-900">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.id, 1)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 active:scale-95 transition"
                          aria-label={`Aumentar cantidad de ${item.name}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="text-right shrink-0 min-w-[72px]">
                        <p className="font-mono-num text-sm font-bold text-slate-900">
                          {formatCurrency(subtotal)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCartItem(item.id)}
                        className="min-h-[44px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg transition"
                        aria-label={`Quitar ${item.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-600">TOTAL A COBRAR</span>
                <span className="text-3xl font-bold font-mono-num text-slate-900">
                  {formatCurrency(cartTotal)}
                </span>
              </div>

              {qrError && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{qrError}</span>
                </div>
              )}

              {isAdmin && (
                <input
                  ref={qrInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleQrFileChange}
                  className="hidden"
                />
              )}

              <div className={`grid gap-2 ${isAdmin ? 'grid-cols-[1fr_1.45fr_1fr]' : 'grid-cols-3 gap-2.5'}`}>
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => openCheckout('efectivo')}
                  className="min-h-[54px] px-2 py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 hover:bg-emerald-800 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] transition"
                >
                  <Banknote className="w-5 h-5 shrink-0" />
                  <span>Efectivo</span>
                </button>

                {isAdmin ? (
                  <div className="flex items-stretch gap-1">
                    <button
                      type="button"
                      disabled={cart.length === 0}
                      onClick={() => openCheckout('yape')}
                      className="flex-1 min-h-[54px] px-2 py-2.5 rounded-xl bg-[#742284] text-white font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1 hover:bg-[#5f1b6d] disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] transition"
                    >
                      <Smartphone className="w-5 h-5 shrink-0" />
                      <span>Yape</span>
                    </button>
                    <button
                      type="button"
                      disabled={qrUploading}
                      onClick={() => qrInputRef.current?.click()}
                      title={yapeQrDataUrl ? 'Cambiar QR de Yape' : 'Agregar QR de Yape'}
                      aria-label={yapeQrDataUrl ? 'Cambiar QR de Yape' : 'Agregar QR de Yape'}
                      className="w-11 min-h-[54px] shrink-0 rounded-xl border-2 border-[#742284]/35 bg-[#742284]/10 hover:bg-[#742284]/20 text-[#742284] disabled:opacity-50 active:scale-95 transition flex flex-col items-center justify-center"
                    >
                      {qrUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4 stroke-[2.75]" />
                          <span className="text-[10px] font-bold leading-none mt-0.5">QR</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={cart.length === 0}
                    onClick={() => openCheckout('yape')}
                    className="min-h-[54px] px-2 py-2.5 rounded-xl bg-[#742284] text-white font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 hover:bg-[#5f1b6d] disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] transition"
                  >
                    <Smartphone className="w-5 h-5 shrink-0" />
                    <span>Yape</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => openCheckout('fiado')}
                  className="min-h-[54px] px-2 py-2.5 rounded-xl bg-amber-600 text-white font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1.5 hover:bg-amber-700 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] transition"
                >
                  <BookOpen className="w-5 h-5 shrink-0" />
                  <span>Fiado</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Camera Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={scannerOpen}
        title="Escanear para cobrar"
        subtitle="Cada escaneo suma 1 unidad a la cuenta"
        continuous={true}
        lastScannedFeedback={lastScannedFeedback}
        sampleProducts={products}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScanned}
      />

      {/* New Unknown Barcode Quick Creation Sheet */}
      {unknownBarcode && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveUnknownProduct}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Código nuevo detectado</h3>
                <p className="text-xs font-mono-num text-slate-500 mt-0.5">
                  Código: {unknownBarcode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUnknownBarcode(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Cancelar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del producto
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  placeholder="Ej. Yogurt Gloria Fresa 1L"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className={`grid gap-2.5 ${isAdmin ? 'grid-cols-3' : 'grid-cols-1'}`}>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Precio venta (S/)
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    min="0.10"
                    required
                    inputMode="decimal"
                    value={newProdSalePrice}
                    onChange={(e) => setNewProdSalePrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm font-mono-num font-bold focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                {isAdmin && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Costo compra
                      </label>
                      <input
                        type="number"
                        step="0.10"
                        min="0"
                        inputMode="decimal"
                        value={newProdCostPrice}
                        onChange={(e) => setNewProdCostPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Stock inicial
                      </label>
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={newProdStock}
                        onChange={(e) => setNewProdStock(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingQuickProd}
              className="w-full min-h-[48px] rounded-xl bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 disabled:opacity-50 transition"
            >
              {savingQuickProd ? 'Guardando...' : 'Guardar y agregar a la cuenta'}
            </button>
          </form>
        </div>
      )}

      {/* Checkout Confirmation Modal (Efectivo / Yape / Fiado) */}
      {checkoutModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              {checkoutModal === 'yape' ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandLogo size="sm" />
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 truncate">Don Juancito</h3>
                    <p className="text-xs font-semibold text-[#742284]">Pago con Yape</p>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {checkoutModal === 'efectivo' && 'Cobrar en Efectivo'}
                    {checkoutModal === 'fiado' && 'Registrar venta Fiada'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Total de la cuenta:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {formatCurrency(cartTotal)}
                    </strong>
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCheckoutModal(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700 shrink-0"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {saleError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{saleError}</span>
                </div>
              )}

              {/* EFECTIVO + BIG CHANGE CALCULATOR */}
              {checkoutModal === 'efectivo' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      ¿Con cuánto paga el cliente?
                    </label>
                    <input
                      type="number"
                      step="0.10"
                      inputMode="decimal"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={cartTotal.toFixed(2)}
                      className="w-full min-h-[52px] px-4 rounded-xl border border-slate-300 text-2xl font-mono-num font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <button
                      type="button"
                      onClick={() => setCashReceived(cartTotal.toFixed(2))}
                      className="min-h-[42px] rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900"
                    >
                      Exacto
                    </button>
                    {[5, 10, 20, 50, 100].map((bill) => (
                      <button
                        key={bill}
                        type="button"
                        onClick={() => setCashReceived(bill.toString())}
                        className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-mono-num font-bold text-slate-800"
                      >
                        S/ {bill}
                      </button>
                    ))}
                  </div>

                  {changeDue !== null ? (
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                      <p className="text-xs font-bold text-emerald-900">VUELTO A ENTREGAR</p>
                      <p className="text-4xl font-bold font-mono-num text-emerald-800">
                        {formatCurrency(changeDue)}
                      </p>
                    </div>
                  ) : (
                    Number.isFinite(cashReceivedNum) &&
                    cashReceivedNum > 0 && (
                      <p className="text-xs font-semibold text-rose-700 text-center">
                        Falta {formatCurrency(cartTotal - cashReceivedNum)} para completar la cuenta.
                      </p>
                    )
                  )}
                </div>
              )}

              {/* YAPE */}
              {checkoutModal === 'yape' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-2xl bg-[#742284]/10 border border-[#742284]/20 text-center space-y-0.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#742284]">
                      Monto exacto a pagar
                    </p>
                    <p className="text-4xl sm:text-5xl font-extrabold font-mono-num text-[#5f1b6d] tracking-tight">
                      {formatCurrency(cartTotal)}
                    </p>
                  </div>

                  {qrError && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{qrError}</span>
                    </div>
                  )}

                  {yapeQrDataUrl ? (
                    <div className="rounded-2xl border-2 border-[#742284]/25 bg-white p-3 text-center space-y-2.5 shadow-sm">
                      <div className="bg-white rounded-xl p-1.5 flex items-center justify-center">
                        <img
                          src={yapeQrDataUrl}
                          alt="QR de Yape de Don Juancito"
                          className="w-56 h-56 sm:w-64 sm:h-64 object-contain rounded-lg"
                        />
                      </div>
                      <p className="text-xs font-medium text-slate-600">
                        Muestra este QR al cliente para que realice el yapeo exacto.
                      </p>
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={qrUploading}
                          onClick={() => qrInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-[#742284]/30 bg-[#742284]/5 hover:bg-[#742284]/15 text-xs font-bold text-[#742284] transition"
                        >
                          {qrUploading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Plus className="w-3.5 h-3.5" />
                          )}
                          <span>{qrUploading ? 'Subiendo QR...' : 'Cambiar imagen QR'}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl border-2 border-dashed border-[#742284]/30 bg-[#742284]/5 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-[#742284]/10 text-[#742284] flex items-center justify-center mx-auto">
                        <QrCode className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-900">
                          Aún no hay QR de Yape guardado
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {isAdmin
                            ? 'Sube la imagen del QR de Yape de Don Juancito una sola vez y quedará guardada en la nube para todos los cobros.'
                            : 'Pide al Administrador que suba el QR de Yape de Don Juancito desde su celular.'}
                        </p>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={qrUploading}
                          onClick={() => qrInputRef.current?.click()}
                          className="w-full min-h-[46px] px-4 rounded-xl border-2 border-[#742284] bg-white hover:bg-[#742284]/10 text-[#742284] text-sm font-bold flex items-center justify-center gap-2 transition"
                        >
                          {qrUploading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4 stroke-[2.75]" />
                          )}
                          <span>{qrUploading ? 'Subiendo QR...' : 'Subir QR de Yape'}</span>
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 text-center">
                    Al confirmar se registrará la venta y se descontará el inventario.
                  </p>
                </div>
              )}

              {/* FIADO + CREDIT LIMIT VALIDATION */}
              {checkoutModal === 'fiado' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Selecciona un cliente existente
                    </label>
                    <input
                      type="search"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Buscar vecino o cliente..."
                      className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />

                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                      {filteredCustomers.length === 0 ? (
                        <p className="p-3 text-xs text-slate-500 text-center">
                          No hay clientes con ese nombre. Créalo abajo.
                        </p>
                      ) : (
                        filteredCustomers.map((cust) => {
                          const isSelected = selectedCustomerId === cust.id;
                          const atLimit =
                            typeof cust.creditLimit === 'number' &&
                            (cust.currentDebt ?? 0) >= cust.creditLimit;
                          return (
                            <button
                              key={cust.id}
                              type="button"
                              onClick={() => {
                                setSelectedCustomerId(cust.id);
                                setNewCustomerName('');
                                setOverLimitConfirm(null);
                              }}
                              className={`w-full min-h-[48px] px-3.5 py-2 flex items-center justify-between text-left transition ${
                                isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0 pr-2">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {cust.name}
                                </p>
                                {typeof cust.creditLimit === 'number' && (
                                  <p
                                    className={`text-[11px] font-medium ${
                                      atLimit ? 'text-rose-700' : 'text-slate-500'
                                    }`}
                                  >
                                    {atLimit
                                      ? `Tope alcanzado (${formatCurrency(cust.creditLimit)})`
                                      : `Tope máx: ${formatCurrency(cust.creditLimit)}`}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 ${
                                  isSelected ? 'bg-amber-600 text-white' : 'text-slate-500'
                                }`}
                              >
                                {isSelected ? 'Elegido' : 'Elegir'}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {(clientLimitWarning || overLimitConfirm) && (
                    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 space-y-1">
                      <p className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>Aviso de límite de fiado</span>
                      </p>
                      <p className="text-xs text-rose-800">
                        {overLimitConfirm || clientLimitWarning}
                      </p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <UserPlus className="w-3.5 h-3.5 text-amber-700" />
                      <span>O escribe un cliente nuevo</span>
                    </div>
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => {
                        setNewCustomerName(e.target.value);
                        if (e.target.value.trim()) {
                          setSelectedCustomerId('');
                          setOverLimitConfirm(null);
                        }
                      }}
                      placeholder="Nombre o apodo (ej. Señora María Mz B)"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                    {isAdmin && newCustomerName.trim() && (
                      <input
                        type="tel"
                        inputMode="tel"
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        placeholder="Celular / WhatsApp (opcional)"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2">
              {overLimitConfirm ? (
                <button
                  type="button"
                  disabled={submittingSale}
                  onClick={() => handleConfirmCheckout(true)}
                  className="w-full min-h-[50px] rounded-xl bg-rose-700 text-white text-sm font-bold hover:bg-rose-800 transition"
                >
                  {submittingSale ? 'Registrando...' : 'Autorizar fiado sobre el límite'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={
                    submittingSale ||
                    (checkoutModal === 'fiado' && !selectedCustomerId && !newCustomerName.trim())
                  }
                  onClick={() => handleConfirmCheckout(false)}
                  className={`w-full min-h-[50px] rounded-xl text-white text-sm font-bold transition disabled:opacity-40 ${
                    checkoutModal === 'efectivo'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : checkoutModal === 'yape'
                        ? 'bg-[#742284] hover:bg-[#5f1b6d]'
                        : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {submittingSale
                    ? 'Registrando...'
                    : checkoutModal === 'efectivo'
                      ? `Confirmar cobro (${formatCurrency(cartTotal)})`
                      : checkoutModal === 'yape'
                        ? `Confirmar pago recibido (${formatCurrency(cartTotal)})`
                        : `Anotar fiado (${formatCurrency(cartTotal)})`}
                </button>
              )}

              {checkoutModal === 'yape' && (
                <button
                  type="button"
                  disabled={submittingSale}
                  onClick={() => setCheckoutModal(null)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition"
                >
                  Cancelar y volver atrás
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Sales & Void Modal */}
      {recentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Últimas ventas</h3>
                <p className="text-xs text-slate-500">
                  Si te equivocaste al cobrar, anula la venta y el stock regresa solo
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecentModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              {saleError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {saleError}
                </div>
              )}

              {voidTarget ? (
                <form onSubmit={handleConfirmVoid} className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <p className="text-sm font-bold text-slate-900">
                      Anular venta de {formatCurrency(voidTarget.total)}
                    </p>
                    <p className="text-xs text-slate-600">{voidTarget.itemsSummary}</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Motivo de anulación (queda en auditoría)
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder="Ej. Error de producto / cliente cambió de opinión"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setVoidTarget(null)}
                      className="min-h-[46px] rounded-xl bg-slate-100 text-slate-800 text-xs font-bold"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      disabled={voiding}
                      className="min-h-[46px] rounded-xl bg-rose-700 text-white text-xs font-bold hover:bg-rose-800"
                    >
                      {voiding ? 'Anulando...' : 'Confirmar anulación'}
                    </button>
                  </div>
                </form>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentSales.map((s) => (
                    <li key={s.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-bold font-mono-num ${
                            s.voided ? 'line-through text-slate-400' : 'text-slate-900'
                          }`}
                        >
                          {formatCurrency(s.total)} ·{' '}
                          {s.paymentMethod === 'efectivo'
                            ? 'Efectivo'
                            : s.paymentMethod === 'yape'
                              ? 'Yape'
                              : `Fiado (${s.customerName || 'Cliente'})`}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{s.itemsSummary}</p>
                        <p className="text-[11px] text-slate-400">{formatDateTime(s.createdAt)}</p>
                      </div>

                      {s.voided ? (
                        <span className="text-xs font-semibold text-rose-700 shrink-0">
                          Anulada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidTarget(s);
                            setVoidReason('');
                          }}
                          className="min-h-[40px] px-3 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold shrink-0"
                        >
                          Anular
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
