import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  PackagePlus,
  PackageMinus,
  Search,
  CheckCircle2,
  Download,
  Trash2,
  Users,
  UserPlus,
  AlertCircle,
  AlertTriangle,
  Receipt,
  FileSpreadsheet,
  ShieldCheck,
  Loader2,
  Plus,
  QrCode,
  FileText,
  Upload,
  Eye,
  X,
} from 'lucide-react';
import { BOOTSTRAP_ADMIN_EMAIL } from '../firebase';
import type {
  AccessRequest,
  BodegaState,
  InventoryMovement,
  Product,
  StaffInvite,
  StaffMember,
  SupplierReceipt,
  UserRole,
} from '../types/bodega';
import type { FinancialSummary } from '../store/useBodegaStore';
import {
  daysUntilExpiry,
  downloadCsv,
  formatCurrency,
  formatDateTime,
  playScanBeep,
} from '../utils/format';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { PWAInstallButton } from './PWAInstallButton';
import { processYapeQrImageFile } from '../utils/qrImage';
import {
  processSupplierReceiptFile,
  type ProcessedReceiptAttachment,
} from '../utils/receiptAttachment';

interface InventoryViewProps {
  state: BodegaState;
  currentAdminUid: string;
  currentAdminEmail: string;
  staffMembers: StaffMember[];
  staffInvites: StaffInvite[];
  accessRequests: AccessRequest[];
  getFinancialSummary: (period: 'today' | 'all') => FinancialSummary;
  getCustomerBalance: (customerId: string) => {
    totalFiado: number;
    totalAbonado: number;
    saldo: number;
  };
  findProductByBarcode: (barcode: string) => Product | undefined;
  registerStockEntry: (params: {
    productId?: string;
    barcode?: string;
    name: string;
    quantity: number;
    unitCost: number;
    salePrice: number;
    expiryDate?: string;
    note?: string;
  }) => Promise<boolean>;
  registerNonSaleExit: (params: {
    productId: string;
    type: 'consumo_propio' | 'merma';
    quantity: number;
    note?: string;
  }) => Promise<boolean>;
  addSupplierReceipt: (params: {
    supplierName: string;
    amount: number;
    deliveredAt: string;
    note?: string;
    attachmentDataUrl?: string;
    attachmentName?: string;
    attachmentMime?: ProcessedReceiptAttachment['mimeType'];
  }) => Promise<boolean>;
  deleteSupplierReceipt: (id: string) => Promise<boolean>;
  inviteStaffEmail: (email: string, role: UserRole) => Promise<{ ok: boolean; error?: string }>;
  changeStaffInviteRole: (invite: StaffInvite, newRole: UserRole) => Promise<boolean>;
  changeStaffMemberRole: (member: StaffMember, newRole: UserRole) => Promise<boolean>;
  removeStaffInvite: (invite: StaffInvite) => Promise<boolean>;
  approveAccessRequest: (req: AccessRequest, role: UserRole) => Promise<boolean>;
  rejectAccessRequest: (uid: string) => Promise<boolean>;
  toggleStaffActive: (member: StaffMember) => Promise<boolean>;
  removeStaffMember: (member: StaffMember) => Promise<boolean>;
  yapeQrDataUrl: string | null;
  saveYapeQr: (dataUrl: string) => Promise<boolean>;
  removeYapeQr: () => Promise<boolean>;
}

type InventorySubTab = 'stock' | 'entrada' | 'salida' | 'boletas' | 'ajustes';
type StockFilter = 'all' | 'low' | 'expiring';

function getCurrentLocalDateTimeInput(): string {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  state,
  currentAdminUid,
  currentAdminEmail,
  staffMembers,
  staffInvites,
  accessRequests,
  getFinancialSummary,
  getCustomerBalance,
  findProductByBarcode,
  registerStockEntry,
  registerNonSaleExit,
  addSupplierReceipt,
  deleteSupplierReceipt,
  inviteStaffEmail,
  changeStaffInviteRole,
  changeStaffMemberRole,
  removeStaffInvite,
  approveAccessRequest,
  rejectAccessRequest,
  toggleStaffActive,
  removeStaffMember,
  yapeQrDataUrl,
  saveYapeQr,
  removeYapeQr,
}) => {
  const [period, setPeriod] = useState<'today' | 'all'>('today');
  const [subTab, setSubTab] = useState<InventorySubTab>('stock');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const [scannerMode, setScannerMode] = useState<'entrada' | 'salida' | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  // Entrada form state
  const [entryProductId, setEntryProductId] = useState<string>('');
  const [entryBarcode, setEntryBarcode] = useState('');
  const [entryName, setEntryName] = useState('');
  const [entryQty, setEntryQty] = useState('1');
  const [entryCost, setEntryCost] = useState('');
  const [entrySalePrice, setEntrySalePrice] = useState('');
  const [entryExpiry, setEntryExpiry] = useState('');
  const [entryNote, setEntryNote] = useState('');

  // Salida sin venta form state
  const [exitProductId, setExitProductId] = useState<string>('');
  const [exitType, setExitType] = useState<'consumo_propio' | 'merma'>('consumo_propio');
  const [exitQty, setExitQty] = useState('1');
  const [exitNote, setExitNote] = useState('');

  // Supplier receipts (Boletas de compras y proveedores) state
  const [supName, setSupName] = useState('');
  const [supAmount, setSupAmount] = useState('');
  const [supDeliveredAt, setSupDeliveredAt] = useState<string>(() => getCurrentLocalDateTimeInput());
  const [supNote, setSupNote] = useState('');
  const [supAttachment, setSupAttachment] = useState<ProcessedReceiptAttachment | null>(null);
  const [supAttProcessing, setSupAttProcessing] = useState(false);
  const [supAttError, setSupAttError] = useState<string | null>(null);
  const [supSaving, setSupSaving] = useState(false);
  const [supSearch, setSupSearch] = useState('');
  const [viewingReceipt, setViewingReceipt] = useState<SupplierReceipt | null>(null);
  const receiptCameraRef = useRef<HTMLInputElement | null>(null);
  const receiptFileRef = useRef<HTMLInputElement | null>(null);

  // Team / multi-phone invite & action state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('vendedor');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [teamBusyKey, setTeamBusyKey] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);

  // Feedback banner
  const [feedback, setFeedback] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const summary = useMemo(() => getFinancialSummary(period), [getFinancialSummary, period]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  const lowStockCount = useMemo(
    () => state.products.filter((p) => p.stock <= p.minStock).length,
    [state.products]
  );

  const expiringSoonCount = useMemo(
    () =>
      state.products.filter((p) => {
        const d = daysUntilExpiry(p.expiryDate);
        return d !== null && d <= 15;
      }).length,
    [state.products]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.products
      .filter((p) => {
        if (stockFilter === 'low' && p.stock > p.minStock) return false;
        if (stockFilter === 'expiring') {
          const d = daysUntilExpiry(p.expiryDate);
          if (d === null || d > 15) return false;
        }
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.stock - b.stock);
  }, [state.products, search, stockFilter]);

  const prefillEntryFromProduct = (prod: Product) => {
    setEntryProductId(prod.id);
    setEntryBarcode(prod.barcode || '');
    setEntryName(prod.name);
    setEntryQty('1');
    setEntryCost(prod.costPrice > 0 ? prod.costPrice.toString() : '');
    setEntrySalePrice(prod.salePrice > 0 ? prod.salePrice.toString() : '');
    setEntryExpiry(prod.expiryDate || '');
    setEntryNote('');
    setSubTab('entrada');
  };

  const prefillExitFromProduct = (prod: Product) => {
    setExitProductId(prod.id);
    setExitQty('1');
    setExitNote('');
    setSubTab('salida');
  };

  const handleScan = (barcode: string) => {
    playScanBeep();
    const found = findProductByBarcode(barcode);

    if (scannerMode === 'entrada') {
      if (found) {
        prefillEntryFromProduct(found);
        showToast(`Producto encontrado: ${found.name}`);
      } else {
        setEntryProductId('');
        setEntryBarcode(barcode);
        setEntryName('');
        setEntryQty('1');
        setEntryCost('');
        setEntrySalePrice('');
        setEntryExpiry('');
        showToast(`Código nuevo ${barcode}: completa nombre, costo y precio`);
      }
      setScannerMode(null);
    } else if (scannerMode === 'salida') {
      if (found) {
        prefillExitFromProduct(found);
        showToast(`Seleccionado para salida: ${found.name}`);
      } else {
        showToast(`El código ${barcode} aún no está en inventario.`);
      }
      setScannerMode(null);
    }
  };

  const handleSubmitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(entryQty, 10) || 0;
    const unitCost = parseFloat(entryCost) || 0;
    const salePrice = parseFloat(entrySalePrice) || 0;
    if (!entryName.trim() || qty <= 0 || salePrice <= 0) return;

    const ok = await registerStockEntry({
      productId: entryProductId || undefined,
      barcode: entryBarcode.trim() || undefined,
      name: entryName.trim(),
      quantity: qty,
      unitCost,
      salePrice,
      expiryDate: entryExpiry || undefined,
      note: entryNote,
    });

    if (ok) {
      showToast(`Entrada guardada: +${qty} und de ${entryName.trim()}`);
      setEntryProductId('');
      setEntryBarcode('');
      setEntryName('');
      setEntryQty('1');
      setEntryCost('');
      setEntrySalePrice('');
      setEntryExpiry('');
      setEntryNote('');
      setSubTab('stock');
    }
  };

  const handleSubmitExit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(exitQty, 10) || 0;
    if (!exitProductId || qty <= 0) return;

    const prod = state.products.find((p) => p.id === exitProductId);
    const ok = await registerNonSaleExit({
      productId: exitProductId,
      type: exitType,
      quantity: qty,
      note: exitNote,
    });

    if (ok) {
      showToast(
        `Salida registrada: −${qty} und de ${prod?.name || 'producto'} (${
          exitType === 'consumo_propio' ? 'Consumo propio' : 'Merma'
        })`
      );
      setExitProductId('');
      setExitQty('1');
      setExitNote('');
      setSubTab('stock');
    }
  };

  const filteredSupplierReceipts = useMemo(() => {
    const q = supSearch.trim().toLowerCase();
    if (!q) return state.supplierReceipts;
    return state.supplierReceipts.filter(
      (r) =>
        r.supplierName.toLowerCase().includes(q) ||
        (r.note && r.note.toLowerCase().includes(q))
    );
  }, [state.supplierReceipts, supSearch]);

  const totalSupplierPaid = useMemo(
    () => filteredSupplierReceipts.reduce((sum, r) => sum + r.amount, 0),
    [filteredSupplierReceipts]
  );

  const handleReceiptAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSupAttError(null);
    setSupAttProcessing(true);
    try {
      const processed = await processSupplierReceiptFile(file);
      setSupAttachment(processed);
    } catch (err) {
      setSupAttError(
        err instanceof Error ? err.message : 'No se pudo procesar el archivo de la boleta.'
      );
    } finally {
      setSupAttProcessing(false);
    }
  };

  const handleSubmitSupplierReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supSaving || supAttProcessing) return;
    const amount = parseFloat(supAmount);
    if (!supName.trim() || !Number.isFinite(amount) || amount <= 0) return;

    const deliveredIso = supDeliveredAt
      ? new Date(supDeliveredAt).toISOString()
      : new Date().toISOString();

    setSupAttError(null);
    setSupSaving(true);
    try {
      const ok = await addSupplierReceipt({
        supplierName: supName.trim(),
        amount,
        deliveredAt: deliveredIso,
        note: supNote.trim() || undefined,
        attachmentDataUrl: supAttachment?.dataUrl,
        attachmentName: supAttachment?.fileName,
        attachmentMime: supAttachment?.mimeType,
      });
      if (ok) {
        showToast(`Boleta guardada: ${supName.trim()} (${formatCurrency(amount)})`);
        setSupName('');
        setSupAmount('');
        setSupDeliveredAt(getCurrentLocalDateTimeInput());
        setSupNote('');
        setSupAttachment(null);
      } else {
        setSupAttError('No se pudo guardar la boleta. Verifica los datos e intenta otra vez.');
      }
    } catch {
      setSupAttError('No se pudo guardar la boleta en la nube. Verifica tu conexión.');
    } finally {
      setSupSaving(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteBusy) return;
    setInviteError(null);
    setTeamError(null);
    const clean = inviteEmail.trim();
    if (!clean) return;
    setInviteBusy(true);
    try {
      const res = await inviteStaffEmail(clean, inviteRole);
      if (!res.ok) {
        setInviteError(res.error || 'No se pudo habilitar el usuario.');
        return;
      }
      const roleLabel = inviteRole === 'admin' ? 'Administrador' : 'Vendedor';
      showToast(`Usuario habilitado como ${roleLabel}: ${clean}`);
      setInviteEmail('');
    } catch {
      setInviteError('No se pudo guardar en la nube. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setInviteBusy(false);
    }
  };

  // Deduplicate pending invites that do not yet have an active linked phone in staffMembers
  const pendingInvitesOnly = useMemo(() => {
    const linkedEmails = new Set(staffMembers.map((m) => m.email.trim().toLowerCase()));
    const bootstrapLower = BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
    return staffInvites.filter((inv) => {
      const em = inv.email.trim().toLowerCase();
      return em !== bootstrapLower && !linkedEmails.has(em);
    });
  }, [staffInvites, staffMembers]);

  // CSV / Excel Exports
  const handleExportSalesCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `ventas-don-juancito-${today}.csv`,
      [
        'Fecha',
        'Estado',
        'Método',
        'Cliente',
        'Productos',
        'Total (S/)',
        'Costo (S/)',
        'Rol',
        'Usuario',
      ],
      state.sales.map((s) => [
        formatDateTime(s.createdAt),
        s.voided ? 'ANULADA' : 'VÁLIDA',
        s.paymentMethod.toUpperCase(),
        s.customerName || '',
        s.items.map((i) => `${i.quantity}x ${i.name}`).join(' | '),
        s.total.toFixed(2),
        s.totalCost.toFixed(2),
        s.recordedByRole || '',
        s.recordedByEmail || '',
      ])
    );
    showToast('Reporte de ventas descargado para Excel.');
  };

  const handleExportInventoryCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `inventario-don-juancito-${today}.csv`,
      ['Producto', 'Código', 'Stock', 'Stock Mínimo', 'Costo (S/)', 'Precio Venta (S/)', 'Vencimiento'],
      state.products.map((p) => [
        p.name,
        p.barcode || '',
        p.stock,
        p.minStock,
        p.costPrice.toFixed(2),
        p.salePrice.toFixed(2),
        p.expiryDate || '',
      ])
    );
    showToast('Reporte de inventario descargado para Excel.');
  };

  const handleExportCreditsCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `fiados-don-juancito-${today}.csv`,
      ['Cliente', 'Teléfono', 'Tope Fiado (S/)', 'Total Fiado (S/)', 'Abonado (S/)', 'Saldo Pendiente (S/)'],
      state.customers.map((c) => {
        const bal = getCustomerBalance(c.id);
        return [
          c.name,
          c.phone || '',
          c.creditLimit ? c.creditLimit.toFixed(2) : '',
          bal.totalFiado.toFixed(2),
          bal.totalAbonado.toFixed(2),
          bal.saldo.toFixed(2),
        ];
      })
    );
    showToast('Reporte de fiados descargado para Excel.');
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-don-juancito-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Respaldo JSON descargado en tu dispositivo.');
  };

  const movementLabel = (m: InventoryMovement): string => {
    switch (m.type) {
      case 'entrada':
        return 'Entrada de compra';
      case 'venta':
        return 'Venta';
      case 'consumo_propio':
        return 'Consumo propio';
      case 'merma':
        return 'Merma / vencido';
      case 'anulacion':
        return 'Reposición por anulación';
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-lg border border-slate-700"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Alerts Strip (Low Stock or Expiring Soon) */}
      {(lowStockCount > 0 || expiringSoonCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Alertas de inventario:
              {lowStockCount > 0 && ` ${lowStockCount} con stock bajo`}
              {lowStockCount > 0 && expiringSoonCount > 0 && ' ·'}
              {expiringSoonCount > 0 && ` ${expiringSoonCount} próximos a vencer`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lowStockCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSubTab('stock');
                  setStockFilter('low');
                }}
                className="underline text-amber-900 hover:text-amber-700"
              >
                Ver stock bajo
              </button>
            )}
            {expiringSoonCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSubTab('stock');
                  setStockFilter('expiring');
                }}
                className="underline text-rose-800 hover:text-rose-600"
              >
                Ver por vencer
              </button>
            )}
          </div>
        </div>
      )}

      {/* Financial Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">Resumen de caja</h2>
            <p className="text-xs text-slate-500">
              Ingresos cobrados y ventas fiadas por cobrar
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setPeriod('today')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition ${
                period === 'today'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setPeriod('all')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition ${
                period === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <p className="text-xs font-medium text-slate-500">Ingresos cobrados</p>
            <p className="text-2xl font-bold font-mono-num text-emerald-700">
              {formatCurrency(summary.totalCobrado)}
            </p>
            <p className="text-xs text-slate-600 font-mono-num">
              Efec {formatCurrency(summary.totalCobradoEfectivo)} · Yape{' '}
              {formatCurrency(summary.totalCobradoYape)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
            <p className="text-xs font-medium text-slate-500">
              Ventas fiadas ({period === 'today' ? 'hoy' : 'total'})
            </p>
            <p className="text-2xl font-bold font-mono-num text-amber-700">
              {formatCurrency(summary.ventasFiadas)}
            </p>
            <p className="text-xs text-slate-600 font-mono-num">
              Por cobrar total: {formatCurrency(summary.totalFiadoPorCobrar)}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="grid grid-cols-5 gap-1 p-1 bg-slate-200/70 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('stock')}
          className={`min-h-[42px] px-1.5 rounded-xl text-[11px] sm:text-sm font-semibold transition truncate ${
            subTab === 'stock'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Stock
        </button>
        <button
          type="button"
          onClick={() => setSubTab('entrada')}
          className={`min-h-[42px] px-1.5 rounded-xl text-[11px] sm:text-sm font-semibold transition truncate ${
            subTab === 'entrada'
              ? 'bg-white text-teal-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          + Entrada
        </button>
        <button
          type="button"
          onClick={() => setSubTab('salida')}
          className={`min-h-[42px] px-1.5 rounded-xl text-[11px] sm:text-sm font-semibold transition truncate ${
            subTab === 'salida'
              ? 'bg-white text-rose-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          − Salida
        </button>
        <button
          type="button"
          onClick={() => setSubTab('boletas')}
          className={`min-h-[42px] px-1.5 rounded-xl text-[11px] sm:text-sm font-semibold transition truncate ${
            subTab === 'boletas'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Boletas
        </button>
        <button
          type="button"
          onClick={() => setSubTab('ajustes')}
          className={`min-h-[42px] px-1.5 rounded-xl text-[11px] sm:text-sm font-semibold transition truncate ${
            subTab === 'ajustes'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Ajustes{accessRequests.length > 0 ? ` (${accessRequests.length})` : ''}
        </button>
      </div>

      {/* TAB 1: STOCK ACTUAL */}
      {subTab === 'stock' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto o código..."
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => setStockFilter('all')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  stockFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Todos ({state.products.length})
              </button>
              <button
                type="button"
                onClick={() => setStockFilter('low')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  stockFilter === 'low' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600'
                }`}
              >
                Bajo ({lowStockCount})
              </button>
              <button
                type="button"
                onClick={() => setStockFilter('expiring')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  stockFilter === 'expiring'
                    ? 'bg-rose-700 text-white shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Por vencer ({expiringSoonCount})
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Capital en mercadería: {formatCurrency(summary.valorInventarioCosto)}
            <span aria-hidden="true"> · </span>
            Valor estimado de venta: {formatCurrency(summary.valorInventarioVenta)}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-slate-500">
                No hay productos que coincidan con este filtro.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('entrada')}
                className="min-h-[42px] px-4 rounded-xl bg-teal-700 text-white text-xs font-bold"
              >
                Registrar mercadería
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredProducts.map((prod) => {
                const isLow = prod.stock <= prod.minStock;
                const unitMargin = prod.salePrice - prod.costPrice;
                const expDays = daysUntilExpiry(prod.expiryDate);
                const isExpiring = expDays !== null && expDays <= 15;
                return (
                  <li
                    key={prod.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{prod.name}</p>
                      <p className="text-xs text-slate-500 font-mono-num">
                        Compra {formatCurrency(prod.costPrice)}
                        <span aria-hidden="true"> · </span>
                        Venta {formatCurrency(prod.salePrice)}
                        <span aria-hidden="true"> · </span>
                        Ganas {formatCurrency(unitMargin)}
                        {prod.barcode ? ` · ${prod.barcode}` : ''}
                      </p>
                      {prod.expiryDate && (
                        <p
                          className={`text-xs mt-0.5 font-medium ${
                            isExpiring ? 'text-rose-700 font-semibold' : 'text-slate-500'
                          }`}
                        >
                          {expDays !== null && expDays <= 0
                            ? `Vencido (${prod.expiryDate})`
                            : expDays !== null && expDays <= 15
                              ? `Vence en ${expDays} días (${prod.expiryDate})`
                              : `Vence: ${prod.expiryDate}`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                      <span
                        className={`text-xs font-bold font-mono-num mr-1 ${
                          prod.stock <= 0
                            ? 'text-rose-700'
                            : isLow
                              ? 'text-amber-700'
                              : 'text-slate-800'
                        }`}
                      >
                        {prod.stock <= 0
                          ? `Sin stock (${prod.stock})`
                          : isLow
                            ? `Stock bajo: ${prod.stock}`
                            : `Stock: ${prod.stock}`}
                      </span>

                      <button
                        type="button"
                        onClick={() => prefillEntryFromProduct(prod)}
                        className="min-h-[40px] px-3 rounded-xl bg-teal-50 text-teal-800 hover:bg-teal-100 text-xs font-bold transition"
                      >
                        + Entrada
                      </button>
                      <button
                        type="button"
                        onClick={() => prefillExitFromProduct(prod)}
                        className="min-h-[40px] px-3 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold transition"
                      >
                        − Salida
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* TAB 2: ENTRADA */}
      {subTab === 'entrada' && (
        <form
          onSubmit={handleSubmitEntry}
          className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-teal-700" />
                <span>Registrar entrada de mercadería</span>
              </h3>
              <p className="text-xs text-slate-500">
                Escanea el producto o selecciónalo para sumar unidades al stock
              </p>
            </div>

            <button
              type="button"
              onClick={() => setScannerMode('entrada')}
              className="min-h-[46px] px-4 rounded-xl bg-teal-700 text-white text-sm font-bold flex items-center gap-2 hover:bg-teal-800 active:scale-[0.98] transition"
            >
              <Camera className="w-4 h-4" />
              <span>Escanear cámara</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              O elegir producto ya registrado (opcional)
            </label>
            <select
              value={entryProductId}
              onChange={(e) => {
                const prod = state.products.find((p) => p.id === e.target.value);
                if (prod) {
                  prefillEntryFromProduct(prod);
                } else {
                  setEntryProductId('');
                }
              }}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="">-- Nuevo producto o escaneado --</option>
              {state.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock actual: {p.stock})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nombre del producto
              </label>
              <input
                type="text"
                required
                value={entryName}
                onChange={(e) => setEntryName(e.target.value)}
                placeholder="Ej. Leche Gloria Azul 395g"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Código de barras (opcional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={entryBarcode}
                onChange={(e) => setEntryBarcode(e.target.value)}
                placeholder="Ej. 7750243000125"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cantidad ingresa
              </label>
              <input
                type="number"
                min="1"
                required
                inputMode="numeric"
                value={entryQty}
                onChange={(e) => setEntryQty(e.target.value)}
                className="w-full min-h-[46px] px-3 rounded-xl border border-slate-300 text-base font-mono-num font-bold focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Costo compra (S/)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                inputMode="decimal"
                value={entryCost}
                onChange={(e) => setEntryCost(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[46px] px-3 rounded-xl border border-slate-300 text-base font-mono-num font-semibold focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

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
                value={entrySalePrice}
                onChange={(e) => setEntrySalePrice(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[46px] px-3 rounded-xl border border-slate-300 text-base font-mono-num font-semibold focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {(parseFloat(entryCost) > 0 || parseFloat(entrySalePrice) > 0) && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 font-mono-num">
              <span>
                Inversión total:{' '}
                <strong className="text-slate-900">
                  {formatCurrency((parseInt(entryQty, 10) || 0) * (parseFloat(entryCost) || 0))}
                </strong>
              </span>
              <span>
                Margen por unidad:{' '}
                <strong className="text-teal-800">
                  {formatCurrency((parseFloat(entrySalePrice) || 0) - (parseFloat(entryCost) || 0))}
                </strong>
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Fecha de vencimiento próxima (opcional)
              </label>
              <input
                type="date"
                value={entryExpiry}
                onChange={(e) => setEntryExpiry(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Nota (opcional)
              </label>
              <input
                type="text"
                value={entryNote}
                onChange={(e) => setEntryNote(e.target.value)}
                placeholder="Ej. Compra mercado mayorista"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full min-h-[50px] rounded-xl bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 active:scale-[0.99] transition"
          >
            Sumar al stock
          </button>
        </form>
      )}

      {/* TAB 3: SALIDA SIN VENTA */}
      {subTab === 'salida' && (
        <form
          onSubmit={handleSubmitExit}
          className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <PackageMinus className="w-5 h-5 text-rose-700" />
                <span>Salida sin venta</span>
              </h3>
              <p className="text-xs text-slate-500">
                Registra consumo de casa o productos vencidos/dañados para no descuadrar stock
              </p>
            </div>

            <button
              type="button"
              onClick={() => setScannerMode('salida')}
              className="min-h-[46px] px-4 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center gap-2 hover:bg-slate-800 active:scale-[0.98] transition"
            >
              <Camera className="w-4 h-4" />
              <span>Escanear cámara</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Producto a descontar
            </label>
            <select
              required
              value={exitProductId}
              onChange={(e) => setExitProductId(e.target.value)}
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-600"
            >
              <option value="">-- Selecciona un producto --</option>
              {state.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock actual: {p.stock})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Motivo de la salida
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setExitType('consumo_propio')}
                className={`min-h-[48px] px-3 rounded-xl border text-sm font-bold transition ${
                  exitType === 'consumo_propio'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                Consumo propio
              </button>
              <button
                type="button"
                onClick={() => setExitType('merma')}
                className={`min-h-[48px] px-3 rounded-xl border text-sm font-bold transition ${
                  exitType === 'merma'
                    ? 'bg-rose-700 text-white border-rose-700'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                Merma / vencido
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cantidad
              </label>
              <input
                type="number"
                min="1"
                required
                inputMode="numeric"
                value={exitQty}
                onChange={(e) => setExitQty(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-base font-mono-num font-bold focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Detalle (opcional)
              </label>
              <input
                type="text"
                value={exitNote}
                onChange={(e) => setExitNote(e.target.value)}
                placeholder="Ej. Para el almuerzo / botella rota"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!exitProductId}
            className="w-full min-h-[50px] rounded-xl bg-rose-700 text-white text-sm font-bold hover:bg-rose-800 disabled:opacity-40 transition"
          >
            Descontar del inventario
          </button>
        </form>
      )}

      {/* TAB 4: BOLETAS DE COMPRAS Y ENTREGA DE PROVEEDORES */}
      {subTab === 'boletas' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSubmitSupplierReceipt}
            className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-700" />
                <span>Boletas de compras y proveedores</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Registra los pedidos entregados a Don Juancito y guarda la foto o archivo de la boleta en la nube.
              </p>
            </div>

            {supAttError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{supAttError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Empresa o proveedor
                </label>
                <input
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="Ej. Distribuidora Central, Alicorp, Gloria..."
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Monto total de la boleta (S/)
                </label>
                <input
                  type="number"
                  step="0.10"
                  min="0.10"
                  required
                  inputMode="decimal"
                  value={supAmount}
                  onChange={(e) => setSupAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-base font-mono-num font-bold focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Fecha y hora de entrega
                </label>
                <input
                  type="datetime-local"
                  required
                  value={supDeliveredAt}
                  onChange={(e) => setSupDeliveredAt(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Observación / detalle del pedido (opcional)
                </label>
                <input
                  type="text"
                  value={supNote}
                  onChange={(e) => setSupNote(e.target.value)}
                  placeholder="Ej. Abarrotes, bebidas, limpieza..."
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            {/* Camera capture / file upload for boleta */}
            <div className="space-y-2.5">
              <label className="block text-xs font-semibold text-slate-700">
                Foto o archivo de la boleta / factura (opcional)
              </label>

              <input
                ref={receiptCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleReceiptAttachmentChange}
                className="hidden"
              />
              <input
                ref={receiptFileRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleReceiptAttachmentChange}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={supAttProcessing}
                  onClick={() => receiptCameraRef.current?.click()}
                  className="min-h-[46px] px-3 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-900 text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {supAttProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 shrink-0" />
                  )}
                  <span>Tomar foto</span>
                </button>

                <button
                  type="button"
                  disabled={supAttProcessing}
                  onClick={() => receiptFileRef.current?.click()}
                  className="min-h-[46px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {supAttProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 shrink-0" />
                  )}
                  <span>Adjuntar imagen / PDF</span>
                </button>
              </div>

              {supAttachment && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    {supAttachment.mimeType === 'application/pdf' ? (
                      <div className="w-12 h-12 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
                        <FileText className="w-6 h-6" />
                      </div>
                    ) : (
                      <img
                        src={supAttachment.dataUrl}
                        alt="Vista previa de boleta"
                        className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-white"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {supAttachment.fileName}
                      </p>
                      <p className="text-[11px] text-teal-700 font-medium">
                        Listo para guardar en la nube
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSupAttachment(null)}
                    className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 shrink-0"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={supSaving || supAttProcessing}
              className="w-full min-h-[50px] rounded-xl bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {supSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{supSaving ? 'Guardando boleta...' : 'Guardar boleta de compra'}</span>
            </button>
          </form>

          {/* Saved Supplier Receipts List */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Historial de boletas ({filteredSupplierReceipts.length})
                </h3>
                <p className="text-xs text-slate-500 font-mono-num">
                  Total pagado a proveedores: {formatCurrency(totalSupplierPaid)}
                </p>
              </div>
            </div>

            {state.supplierReceipts.length > 0 && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder="Buscar por empresa, proveedor o detalle..."
                  className="w-full min-h-[42px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            )}

            {filteredSupplierReceipts.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                {state.supplierReceipts.length === 0
                  ? 'Aún no hay boletas de compras registradas.'
                  : 'No se encontraron boletas con esa búsqueda.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredSupplierReceipts.map((rec) => {
                  const isPdf = rec.attachmentMime === 'application/pdf';
                  return (
                    <li
                      key={rec.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {rec.attachmentDataUrl ? (
                          isPdf ? (
                            <button
                              type="button"
                              onClick={() => setViewingReceipt(rec)}
                              className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0 hover:bg-rose-100 transition"
                              aria-label={`Ver boleta PDF de ${rec.supplierName}`}
                            >
                              <FileText className="w-5 h-5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setViewingReceipt(rec)}
                              className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 hover:opacity-90 transition"
                              aria-label={`Ver foto de boleta de ${rec.supplierName}`}
                            >
                              <img
                                src={rec.attachmentDataUrl}
                                alt={`Boleta ${rec.supplierName}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          )
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                            <Receipt className="w-5 h-5" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {rec.supplierName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(rec.deliveredAt)}
                          </p>
                          {rec.note && (
                            <p className="text-xs text-slate-600 mt-0.5 break-words">{rec.note}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                        <span className="font-mono-num text-sm font-bold text-slate-900 mr-1">
                          {formatCurrency(rec.amount)}
                        </span>

                        {rec.attachmentDataUrl && (
                          <button
                            type="button"
                            onClick={() => setViewingReceipt(rec)}
                            className="min-h-[38px] px-3 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-900 text-xs font-bold flex items-center gap-1.5 transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver boleta</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await deleteSupplierReceipt(rec.id);
                            if (ok) showToast(`Boleta de ${rec.supplierName} eliminada.`);
                          }}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg"
                          aria-label={`Eliminar boleta ${rec.supplierName}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: AJUSTES, QR YAPE, EXCEL/CSV Y RESPALDO */}
      {subTab === 'ajustes' && (
        <div className="space-y-4">
          {/* Yape QR Management */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#742284]" />
                  <span>Método de pago: QR de Yape</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sube el QR oficial de Don Juancito para mostrarlo al cobrar con Yape en todos tus celulares.
                </p>
              </div>
            </div>

            {qrError && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{qrError}</span>
              </div>
            )}

            <input
              ref={qrInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setQrError(null);
                setQrUploading(true);
                try {
                  const dataUrl = await processYapeQrImageFile(file);
                  const ok = await saveYapeQr(dataUrl);
                  if (ok) {
                    showToast('QR de Yape guardado y sincronizado.');
                  } else {
                    setQrError('No se pudo guardar el QR de Yape.');
                  }
                } catch (err) {
                  setQrError(
                    err instanceof Error ? err.message : 'No se pudo procesar la imagen del QR.'
                  );
                } finally {
                  setQrUploading(false);
                }
              }}
            />

            <div className="flex flex-col sm:flex-row items-center gap-3.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              {yapeQrDataUrl ? (
                <div className="w-28 h-28 rounded-xl bg-white border border-[#742284]/25 p-1.5 shrink-0 flex items-center justify-center">
                  <img
                    src={yapeQrDataUrl}
                    alt="QR de Yape de Don Juancito"
                    className="w-full h-full object-contain rounded-lg"
                  />
                </div>
              ) : (
                <div className="w-28 h-28 rounded-xl border-2 border-dashed border-slate-300 bg-white shrink-0 flex flex-col items-center justify-center text-slate-400 gap-1">
                  <QrCode className="w-7 h-7" />
                  <span className="text-[11px] font-medium">Sin QR</span>
                </div>
              )}

              <div className="flex-1 w-full space-y-2">
                <p className="text-xs font-semibold text-slate-800">
                  {yapeQrDataUrl
                    ? 'QR guardado en la nube y listo para cobrar.'
                    : 'Todavía no has cargado ningún QR de Yape.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={qrUploading}
                    onClick={() => qrInputRef.current?.click()}
                    className="min-h-[42px] px-3.5 rounded-xl bg-[#742284] hover:bg-[#5f1b6d] text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                  >
                    {qrUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 stroke-[2.75]" />
                    )}
                    <span>
                      {qrUploading
                        ? 'Subiendo...'
                        : yapeQrDataUrl
                          ? 'Cambiar QR de Yape'
                          : 'Agregar QR de Yape'}
                    </span>
                  </button>

                  {yapeQrDataUrl && (
                    <button
                      type="button"
                      disabled={qrUploading}
                      onClick={async () => {
                        setQrError(null);
                        setQrUploading(true);
                        try {
                          const ok = await removeYapeQr();
                          if (ok) showToast('QR de Yape quitado.');
                        } catch {
                          setQrError('No se pudo quitar el QR.');
                        } finally {
                          setQrUploading(false);
                        }
                      }}
                      className="min-h-[42px] px-3 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Excel / CSV Reports */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                <span>Reportes para Excel (CSV)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Descarga tus tablas listas para abrir en Excel o Google Sheets
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={handleExportSalesCsv}
                className="min-h-[44px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 flex items-center justify-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Ventas (.CSV)</span>
              </button>
              <button
                type="button"
                onClick={handleExportInventoryCsv}
                className="min-h-[44px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 flex items-center justify-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Inventario (.CSV)</span>
              </button>
              <button
                type="button"
                onClick={handleExportCreditsCsv}
                className="min-h-[44px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 flex items-center justify-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Fiados (.CSV)</span>
              </button>
            </div>
          </div>

          {/* Multi-Phone Team Access Management */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-700" />
                <span>Celulares y Roles del Equipo (hasta 3 celulares)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Habilita cuentas Google eligiendo si tendrán rol de Vendedor o Administrador.
              </p>
            </div>

            {teamError && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{teamError}</span>
              </div>
            )}

            {accessRequests.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
                <p className="text-xs font-bold text-amber-950">
                  Solicitudes de celulares esperando aprobación ({accessRequests.length})
                </p>
                <ul className="divide-y divide-amber-200/70">
                  {accessRequests.map((req) => {
                    const isApprovingVend = teamBusyKey === `approve-vendedor:${req.uid}`;
                    const isApprovingAdmin = teamBusyKey === `approve-admin:${req.uid}`;
                    const isRejecting = teamBusyKey === `reject:${req.uid}`;
                    const rowBusy = teamBusyKey !== null;
                    return (
                      <li
                        key={req.uid}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {req.displayName}
                          </p>
                          <p className="text-[11px] text-slate-600 truncate">{req.email}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={async () => {
                              setTeamError(null);
                              setTeamBusyKey(`approve-vendedor:${req.uid}`);
                              try {
                                const ok = await approveAccessRequest(req, 'vendedor');
                                if (ok) showToast(`${req.email} aprobado como Vendedor.`);
                              } catch {
                                setTeamError(
                                  `No se pudo aprobar a ${req.email}. Verifica tu internet e intenta otra vez.`
                                );
                              } finally {
                                setTeamBusyKey(null);
                              }
                            }}
                            className="min-h-[38px] px-3 rounded-lg bg-teal-700 text-white text-xs font-bold hover:bg-teal-800 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isApprovingVend && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>{isApprovingVend ? 'Aprobando...' : 'Aprobar Vendedor'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={async () => {
                              setTeamError(null);
                              setTeamBusyKey(`approve-admin:${req.uid}`);
                              try {
                                const ok = await approveAccessRequest(req, 'admin');
                                if (ok) showToast(`${req.email} aprobado como Administrador.`);
                              } catch {
                                setTeamError(
                                  `No se pudo aprobar a ${req.email}. Verifica tu internet e intenta otra vez.`
                                );
                              } finally {
                                setTeamBusyKey(null);
                              }
                            }}
                            className="min-h-[38px] px-3 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isApprovingAdmin && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>{isApprovingAdmin ? 'Aprobando...' : 'Aprobar Admin'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={async () => {
                              setTeamError(null);
                              setTeamBusyKey(`reject:${req.uid}`);
                              try {
                                const ok = await rejectAccessRequest(req.uid);
                                if (ok) showToast('Solicitud rechazada.');
                              } catch {
                                setTeamError(
                                  'No se pudo rechazar la solicitud. Intenta de nuevo.'
                                );
                              } finally {
                                setTeamBusyKey(null);
                              }
                            }}
                            className="min-h-[38px] px-2.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold disabled:opacity-50"
                          >
                            {isRejecting ? 'Rechazando...' : 'Rechazar'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <form onSubmit={handleInviteUser} className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="invite-email-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Correo Google del usuario
                </label>
                {inviteError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{inviteError}</span>
                  </div>
                )}
                <input
                  id="invite-email-input"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Ej. usuario.tienda@gmail.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              {/* Role selector directly below Google email field */}
              <div className="space-y-1.5" role="radiogroup" aria-label="Rol del usuario">
                <span className="block text-xs font-semibold text-slate-700">
                  Rol asignado
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={inviteRole === 'vendedor'}
                    onClick={() => setInviteRole('vendedor')}
                    className={`min-h-[54px] p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                      inviteRole === 'vendedor'
                        ? 'border-amber-500 bg-amber-50/70 ring-1 ring-amber-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        inviteRole === 'vendedor'
                          ? 'border-amber-600 bg-amber-600'
                          : 'border-slate-300'
                      }`}
                    >
                      {inviteRole === 'vendedor' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900">Vendedor</span>
                      <span className="block text-[11px] text-slate-600 leading-snug">
                        Solo ve la pestaña Cobrar.
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={inviteRole === 'admin'}
                    onClick={() => setInviteRole('admin')}
                    className={`min-h-[54px] p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                      inviteRole === 'admin'
                        ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        inviteRole === 'admin'
                          ? 'border-teal-700 bg-teal-700'
                          : 'border-slate-300'
                      }`}
                    >
                      {inviteRole === 'admin' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900">Administrador</span>
                      <span className="block text-[11px] text-slate-600 leading-snug">
                        Acceso completo a Cobrar, Fiados, Inventario y configuración.
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={inviteBusy}
                className="w-full min-h-[46px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {inviteBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                <span>{inviteBusy ? 'Guardando...' : 'Habilitar Usuario'}</span>
              </button>
            </form>

            {/* Authorized Team Emails List */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-slate-700">
                Correos autorizados del equipo:
              </p>

              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl px-3">
                {/* Primary Bootstrap Admin (Protected) */}
                <li className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {BOOTSTRAP_ADMIN_EMAIL}
                      </p>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-100 text-teal-900 text-[10px] font-bold">
                        <ShieldCheck className="w-3 h-3" />
                        ADMIN PRINCIPAL
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Protegido · No se puede eliminar ni bajar de rol
                    </p>
                  </div>
                </li>

                {/* Pre-authorized Emails (Waiting for first login) */}
                {pendingInvitesOnly.map((inv) => {
                  const nextRole: UserRole = inv.role === 'admin' ? 'vendedor' : 'admin';
                  const isChangingRole = teamBusyKey === `inv-role:${inv.id}`;
                  const isDeleting = teamBusyKey === `inv-del:${inv.id}`;
                  const rowBusy = teamBusyKey !== null;
                  return (
                    <li
                      key={inv.id}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-bold text-slate-900 truncate">{inv.email}</p>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              inv.role === 'admin'
                                ? 'bg-teal-100 text-teal-900'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {inv.role === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Pre-autorizado · Esperando primer ingreso en su celular
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={async () => {
                            setTeamError(null);
                            setTeamBusyKey(`inv-role:${inv.id}`);
                            try {
                              const ok = await changeStaffInviteRole(inv, nextRole);
                              if (ok) {
                                showToast(
                                  `Rol actualizado: ${inv.email} ahora es ${
                                    nextRole === 'admin' ? 'Administrador' : 'Vendedor'
                                  }.`
                                );
                              }
                            } catch {
                              setTeamError(
                                `No se pudo cambiar el rol de ${inv.email}. Verifica tu conexión.`
                              );
                            } finally {
                              setTeamBusyKey(null);
                            }
                          }}
                          className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {isChangingRole && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>
                            {isChangingRole
                              ? 'Cambiando...'
                              : inv.role === 'admin'
                                ? 'Cambiar a Vendedor'
                                : 'Cambiar a Admin'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={async () => {
                            setTeamError(null);
                            setTeamBusyKey(`inv-del:${inv.id}`);
                            try {
                              const ok = await removeStaffInvite(inv);
                              if (ok) showToast(`Acceso eliminado: ${inv.email}`);
                            } catch {
                              setTeamError(`No se pudo eliminar a ${inv.email}.`);
                            } finally {
                              setTeamBusyKey(null);
                            }
                          }}
                          className="min-h-[36px] px-2.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>{isDeleting ? 'Eliminando...' : 'Eliminar'}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}

                {/* Linked Phones / Active or Paused Staff Members */}
                {staffMembers
                  .filter(
                    (member) =>
                      member.email.trim().toLowerCase() !== BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
                  )
                  .map((member) => {
                    const isSelf =
                      member.uid === currentAdminUid ||
                      member.email.trim().toLowerCase() === currentAdminEmail.trim().toLowerCase();
                    const nextRole: UserRole = member.role === 'admin' ? 'vendedor' : 'admin';
                    const isChangingRole = teamBusyKey === `role:${member.uid}`;
                    const isToggling = teamBusyKey === `toggle:${member.uid}`;
                    const isRevoking = teamBusyKey === `revoke:${member.uid}`;
                    const rowBusy = teamBusyKey !== null;
                    return (
                      <li
                        key={member.uid}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {member.email}
                            </p>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                member.role === 'admin'
                                  ? 'bg-teal-100 text-teal-900'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {member.role === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate">
                            {member.displayName} · {member.active ? 'Activo' : 'Pausado'}
                            {isSelf ? ' · Tu sesión actual' : ''}
                          </p>
                        </div>

                        {!isSelf && (
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={async () => {
                                setTeamError(null);
                                setTeamBusyKey(`role:${member.uid}`);
                                try {
                                  const ok = await changeStaffMemberRole(member, nextRole);
                                  if (ok) {
                                    showToast(
                                      `Rol actualizado: ${member.email} ahora es ${
                                        nextRole === 'admin' ? 'Administrador' : 'Vendedor'
                                      }.`
                                    );
                                  }
                                } catch {
                                  setTeamError(
                                    `No se pudo cambiar el rol de ${member.email}. Verifica tu conexión.`
                                  );
                                } finally {
                                  setTeamBusyKey(null);
                                }
                              }}
                              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {isChangingRole && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>
                                {isChangingRole
                                  ? 'Cambiando...'
                                  : member.role === 'admin'
                                    ? 'Cambiar a Vendedor'
                                    : 'Cambiar a Admin'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={async () => {
                                setTeamError(null);
                                setTeamBusyKey(`toggle:${member.uid}`);
                                const wasActive = member.active;
                                try {
                                  const ok = await toggleStaffActive(member);
                                  if (ok) {
                                    showToast(
                                      wasActive
                                        ? `${member.displayName} pausado.`
                                        : `${member.displayName} reactivado.`
                                    );
                                  }
                                } catch {
                                  setTeamError(
                                    `No se pudo ${wasActive ? 'pausar' : 'activar'} a ${member.displayName}. Verifica tu conexión.`
                                  );
                                } finally {
                                  setTeamBusyKey(null);
                                }
                              }}
                              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {isToggling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>
                                {isToggling
                                  ? member.active
                                    ? 'Pausando...'
                                    : 'Activando...'
                                  : member.active
                                    ? 'Pausar'
                                    : 'Activar'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={async () => {
                                setTeamError(null);
                                setTeamBusyKey(`revoke:${member.uid}`);
                                try {
                                  const ok = await removeStaffMember(member);
                                  if (ok) {
                                    showToast(`Acceso eliminado para ${member.email}.`);
                                  }
                                } catch {
                                  setTeamError(
                                    `No se pudo eliminar el acceso de ${member.email}. Verifica tu conexión.`
                                  );
                                } finally {
                                  setTeamBusyKey(null);
                                }
                              }}
                              className="min-h-[36px] px-2.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {isRevoking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>{isRevoking ? 'Eliminando...' : 'Eliminar'}</span>
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>

          {/* Recent Inventory Movements with User Attribution */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Historial de movimientos por usuario (en tiempo real)
            </h3>
            {state.movements.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                Aún no hay movimientos registrados.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {state.movements.slice(0, 40).map((mov) => (
                  <li key={mov.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {mov.productName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {movementLabel(mov)}
                        <span aria-hidden="true"> · </span>
                        {mov.actorRole === 'admin' ? 'Admin' : 'Vendedor'} ({mov.actorEmail})
                        <span aria-hidden="true"> · </span>
                        {formatDateTime(mov.createdAt)}
                        {mov.note ? ` · ${mov.note}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-sm font-bold font-mono-num ${
                          mov.type === 'entrada' || mov.type === 'anulacion'
                            ? 'text-teal-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {mov.type === 'entrada' || mov.type === 'anulacion'
                          ? `+${mov.quantity}`
                          : `−${mov.quantity}`}
                      </span>
                      <p className="text-[11px] font-mono-num text-slate-400">
                        {formatCurrency(mov.totalCost)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* JSON Backup Download */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Copia de seguridad en la nube y JSON</h3>
              <p className="text-xs text-slate-500">
                Toda tu tienda se guarda automáticamente en Firebase Firestore. Puedes descargar una
                copia adicional en archivo JSON cuando quieras.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleExportJson}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Descargar respaldo completo (JSON)</span>
              </button>
              <PWAInstallButton className="w-full sm:w-auto" />
            </div>
          </div>
        </div>
      )}

      {/* Camera Scanner Modal for Inventory */}
      <BarcodeScannerModal
        isOpen={scannerMode !== null}
        title={
          scannerMode === 'entrada'
            ? 'Escanear producto que ingresa'
            : 'Escanear producto para salida'
        }
        subtitle="Apunta al código de barras del empaque"
        continuous={false}
        sampleProducts={state.products}
        onClose={() => setScannerMode(null)}
        onScan={handleScan}
      />

      {/* Supplier Receipt Image / PDF Lightbox Modal */}
      {viewingReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 truncate">
                  {viewingReceipt.supplierName}
                </h3>
                <p className="text-xs text-slate-500">
                  {formatDateTime(viewingReceipt.deliveredAt)}
                  <span aria-hidden="true"> · </span>
                  <strong className="font-mono-num text-slate-900">
                    {formatCurrency(viewingReceipt.amount)}
                  </strong>
                </p>
                {viewingReceipt.note && (
                  <p className="text-xs text-slate-600 mt-1">{viewingReceipt.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700 shrink-0"
                aria-label="Cerrar vista de boleta"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-50 flex items-center justify-center">
              {viewingReceipt.attachmentDataUrl ? (
                viewingReceipt.attachmentMime === 'application/pdf' ? (
                  <iframe
                    title={`Boleta ${viewingReceipt.supplierName}`}
                    src={viewingReceipt.attachmentDataUrl}
                    className="w-full h-[60dvh] rounded-xl border border-slate-200 bg-white"
                  />
                ) : (
                  <img
                    src={viewingReceipt.attachmentDataUrl}
                    alt={`Boleta de ${viewingReceipt.supplierName}`}
                    className="max-w-full max-h-[62dvh] object-contain rounded-xl border border-slate-200 bg-white shadow-sm"
                  />
                )
              ) : (
                <p className="text-sm text-slate-500 py-8">Esta boleta no tiene archivo adjunto.</p>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row gap-2">
              {viewingReceipt.attachmentDataUrl && (
                <a
                  href={viewingReceipt.attachmentDataUrl}
                  download={
                    viewingReceipt.attachmentName ||
                    `boleta-${viewingReceipt.supplierName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                  }
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar boleta</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="flex-1 min-h-[46px] px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
