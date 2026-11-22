import React, { useMemo, useState } from 'react';
import {
  Search,
  ChevronRight,
  ArrowLeft,
  UserPlus,
  Banknote,
  Smartphone,
  Copy,
  Check,
  X,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import type { CashMethod, CreditPayment, Customer, Sale } from '../types/bodega';
import { formatCurrency, formatDateTime } from '../utils/format';

interface CreditsViewProps {
  customers: Customer[];
  sales: Sale[];
  creditPayments: CreditPayment[];
  getCustomerBalance: (customerId: string) => {
    totalFiado: number;
    totalAbonado: number;
    saldo: number;
  };
  createCustomer: (
    name: string,
    phone?: string,
    note?: string,
    creditLimit?: number
  ) => Promise<Customer | null>;
  updateCustomer: (
    customerId: string,
    updates: { creditLimit?: number | null; phone?: string; note?: string }
  ) => Promise<boolean>;
  registerCustomerPayment: (params: {
    customerId: string;
    amount: number;
    method: CashMethod;
    note?: string;
  }) => Promise<boolean>;
}

export const CreditsView: React.FC<CreditsViewProps> = ({
  customers,
  sales,
  creditPayments,
  getCustomerBalance,
  createCustomer,
  updateCustomer,
  registerCustomerPayment,
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'debtors' | 'all'>('debtors');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Payment modal
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<CashMethod>('efectivo');
  const [payNote, setPayNote] = useState('');

  // New customer modal
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custNote, setCustNote] = useState('');
  const [custLimit, setCustLimit] = useState('');

  // Edit limit modal
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState('');

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const enrichedCustomers = useMemo(() => {
    return customers
      .map((c) => ({
        ...c,
        balance: getCustomerBalance(c.id),
      }))
      .sort((a, b) => b.balance.saldo - a.balance.saldo);
  }, [customers, getCustomerBalance]);

  const totalPendingAll = useMemo(
    () => Number(enrichedCustomers.reduce((sum, c) => sum + c.balance.saldo, 0).toFixed(2)),
    [enrichedCustomers]
  );

  const debtorsCount = useMemo(
    () => enrichedCustomers.filter((c) => c.balance.saldo > 0).length,
    [enrichedCustomers]
  );

  const overLimitCount = useMemo(
    () =>
      enrichedCustomers.filter(
        (c) => typeof c.creditLimit === 'number' && c.creditLimit > 0 && c.balance.saldo >= c.creditLimit
      ).length,
    [enrichedCustomers]
  );

  const visibleCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedCustomers.filter((c) => {
      if (filterMode === 'debtors' && c.balance.saldo <= 0) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.note && c.note.toLowerCase().includes(q))
      );
    });
  }, [enrichedCustomers, filterMode, search]);

  const selectedCustomer = useMemo(
    () => enrichedCustomers.find((c) => c.id === selectedId) || null,
    [enrichedCustomers, selectedId]
  );

  const customerHistory = useMemo(() => {
    if (!selectedCustomer) return [];
    const fiadoEntries = sales
      .filter((s) => s.paymentMethod === 'fiado' && s.customerId === selectedCustomer.id)
      .map((s) => ({
        kind: 'fiado' as const,
        id: s.id,
        createdAt: s.createdAt,
        amount: s.total,
        items: s.items,
        voided: Boolean(s.voided),
      }));

    const paymentEntries = creditPayments
      .filter((p) => p.customerId === selectedCustomer.id)
      .map((p) => ({
        kind: 'abono' as const,
        id: p.id,
        createdAt: p.createdAt,
        amount: p.amount,
        method: p.method,
        note: p.note,
      }));

    return [...fiadoEntries, ...paymentEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [selectedCustomer, sales, creditPayments]);

  const handleOpenPayment = () => {
    if (!selectedCustomer) return;
    setPayAmount(selectedCustomer.balance.saldo.toFixed(2));
    setPayMethod('efectivo');
    setPayNote('');
    setPaymentModalOpen(true);
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const ok = await registerCustomerPayment({
      customerId: selectedCustomer.id,
      amount,
      method: payMethod,
      note: payNote,
    });
    if (ok) setPaymentModalOpen(false);
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) return;
    const parsedLimit = parseFloat(custLimit);
    const created = await createCustomer(
      custName,
      custPhone,
      custNote,
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined
    );
    if (created) {
      setCustName('');
      setCustPhone('');
      setCustNote('');
      setCustLimit('');
      setNewCustomerOpen(false);
      setFilterMode('all');
      setSelectedId(created.id);
    }
  };

  const handleSaveLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const parsed = parseFloat(limitInput);
    const ok = await updateCustomer(selectedCustomer.id, {
      creditLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    });
    if (ok) setEditingLimit(false);
  };

  const handleCopySummary = async () => {
    if (!selectedCustomer) return;
    const recentFiados = sales
      .filter(
        (s) => !s.voided && s.paymentMethod === 'fiado' && s.customerId === selectedCustomer.id
      )
      .slice(0, 5);
    const lines = [
      `Hola ${selectedCustomer.name}, resumen de tu cuenta en Don Juancito:`,
      ...recentFiados.map(
        (s) =>
          `• ${formatDateTime(s.createdAt)}: ${s.items
            .map((i) => `${i.quantity}x ${i.name}`)
            .join(', ')} = ${formatCurrency(s.total)}`
      ),
      `Total fiado: ${formatCurrency(selectedCustomer.balance.totalFiado)}`,
      `Abonos realizados: ${formatCurrency(selectedCustomer.balance.totalAbonado)}`,
      `Saldo pendiente: ${formatCurrency(selectedCustomer.balance.saldo)}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(selectedCustomer.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Summary Strip */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Total fiado por cobrar</p>
          <p className="text-2xl sm:text-3xl font-bold font-mono-num text-amber-700">
            {formatCurrency(totalPendingAll)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {debtorsCount} {debtorsCount === 1 ? 'cliente con deuda' : 'clientes con deuda'}
            <span aria-hidden="true"> · </span>
            {customers.length} registrados
            {overLimitCount > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-semibold text-rose-700">
                  {overLimitCount} en su tope
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setNewCustomerOpen(true)}
          className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center gap-2 hover:bg-slate-800 active:scale-[0.98] transition whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" />
          <span>Nuevo cliente</span>
        </button>
      </div>

      {/* Master-Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div
          className={`lg:col-span-5 space-y-3 ${
            selectedCustomer ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente por nombre..."
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setFilterMode('debtors')}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${
                  filterMode === 'debtors'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Con deuda ({debtorsCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${
                  filterMode === 'all'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos ({customers.length})
              </button>
            </div>

            {visibleCustomers.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                {filterMode === 'debtors'
                  ? 'No tienes clientes con deuda pendiente.'
                  : 'No hay clientes registrados aún.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visibleCustomers.map((cust) => {
                  const isActive = selectedId === cust.id;
                  const hasLimit = typeof cust.creditLimit === 'number' && cust.creditLimit > 0;
                  const atLimit = hasLimit && cust.balance.saldo >= (cust.creditLimit ?? 0);
                  return (
                    <li key={cust.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(cust.id);
                          setEditingLimit(false);
                        }}
                        className={`w-full min-h-[64px] px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition ${
                          isActive ? 'bg-amber-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {cust.name}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {cust.phone ? `Tel: ${cust.phone}` : 'Sin teléfono'}
                            {hasLimit ? ` · Tope ${formatCurrency(cust.creditLimit!)}` : ''}
                            {atLimit ? ' · Límite alcanzado' : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <p
                              className={`text-sm font-bold font-mono-num ${
                                atLimit
                                  ? 'text-rose-700'
                                  : cust.balance.saldo > 0
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {formatCurrency(cust.balance.saldo)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {atLimit
                                ? 'Superó tope'
                                : cust.balance.saldo > 0
                                  ? 'Por pagar'
                                  : 'Al día'}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right Detail Panel */}
        <div
          className={`lg:col-span-7 ${
            selectedCustomer ? 'block' : 'hidden lg:block'
          }`}
        >
          {!selectedCustomer ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
              <p className="text-sm font-medium text-slate-600">
                Selecciona un cliente de la lista para ver qué productos fió, ajustar su tope y
                registrar abonos.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="lg:hidden min-h-[40px] px-3 rounded-xl bg-slate-100 text-slate-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Clientes</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopySummary}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 ml-auto"
                  >
                    {copiedId === selectedCustomer.id ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-700" />
                        <span>Copiado para WhatsApp</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar resumen</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {selectedCustomer.name}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Total fiado: {formatCurrency(selectedCustomer.balance.totalFiado)}
                      <span aria-hidden="true"> · </span>
                      Abonado: {formatCurrency(selectedCustomer.balance.totalAbonado)}
                    </p>
                  </div>

                  <div className="text-left sm:text-right">
                    <p className="text-xs font-medium text-slate-500">Saldo pendiente</p>
                    <p
                      className={`text-2xl font-bold font-mono-num ${
                        selectedCustomer.balance.saldo > 0
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(selectedCustomer.balance.saldo)}
                    </p>
                  </div>
                </div>

                {/* Credit Limit Status & Inline Edit */}
                <div className="pt-1">
                  {!editingLimit ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {typeof selectedCustomer.creditLimit === 'number' &&
                        selectedCustomer.creditLimit > 0 ? (
                          selectedCustomer.balance.saldo >= selectedCustomer.creditLimit ? (
                            <span className="font-bold text-rose-700 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Límite de fiado alcanzado (
                              {formatCurrency(selectedCustomer.creditLimit)})
                            </span>
                          ) : (
                            <span className="text-slate-600 font-medium">
                              Tope de fiado: {formatCurrency(selectedCustomer.creditLimit)}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-500">Sin límite de fiado configurado</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setLimitInput(
                            selectedCustomer.creditLimit
                              ? selectedCustomer.creditLimit.toString()
                              : ''
                          );
                          setEditingLimit(true);
                        }}
                        className="text-teal-800 font-semibold hover:underline flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Configurar tope</span>
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSaveLimit} className="flex items-center gap-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        inputMode="decimal"
                        value={limitInput}
                        onChange={(e) => setLimitInput(e.target.value)}
                        placeholder="Ej. 30 (0 = sin tope)"
                        className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-300 text-xs font-mono-num"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-3 rounded-xl bg-slate-900 text-white text-xs font-bold"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLimit(false)}
                        className="min-h-[40px] px-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                    </form>
                  )}
                </div>

                {selectedCustomer.balance.saldo > 0 && (
                  <button
                    type="button"
                    onClick={handleOpenPayment}
                    className="w-full min-h-[50px] rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 active:scale-[0.99] transition"
                  >
                    Registrar abono o pago total
                  </button>
                )}
              </div>

              {/* Chronological History */}
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Detalle de fiados y abonos
                </h3>

                {customerHistory.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">
                    Este cliente aún no tiene movimientos registrados.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {customerHistory.map((entry) =>
                      entry.kind === 'fiado' ? (
                        <li key={entry.id} className="py-3.5 space-y-2">
                          <div className="flex items-baseline justify-between gap-3">
                            <div>
                              <span
                                className={`text-xs font-bold ${
                                  entry.voided ? 'text-slate-400 line-through' : 'text-amber-800'
                                }`}
                              >
                                {entry.voided ? 'Compra fiada (Anulada)' : 'Compra fiada'}
                              </span>
                              <span className="text-xs text-slate-400" aria-hidden="true">
                                {' '}
                                ·{' '}
                              </span>
                              <span className="text-xs text-slate-500">
                                {formatDateTime(entry.createdAt)}
                              </span>
                            </div>
                            <span
                              className={`font-mono-num text-sm font-bold ${
                                entry.voided ? 'text-slate-400 line-through' : 'text-amber-800'
                              }`}
                            >
                              +{formatCurrency(entry.amount)}
                            </span>
                          </div>

                          <ul className="pl-3 space-y-1 border-l border-slate-200">
                            {entry.items.map((item, idx) => (
                              <li
                                key={`${entry.id}_${idx}`}
                                className={`flex items-center justify-between text-xs gap-2 ${
                                  entry.voided ? 'text-slate-400 line-through' : 'text-slate-700'
                                }`}
                              >
                                <span className="truncate">
                                  {item.quantity} × {item.name}
                                </span>
                                <span className="font-mono-num shrink-0">
                                  {formatCurrency(item.subtotal)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ) : (
                        <li
                          key={entry.id}
                          className="py-3.5 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-xs font-bold text-emerald-800">
                              Abono en {entry.method === 'yape' ? 'Yape' : 'Efectivo'}
                              <span className="text-slate-400 font-normal" aria-hidden="true">
                                {' '}
                                ·{' '}
                              </span>
                              <span className="text-slate-500 font-normal">
                                {formatDateTime(entry.createdAt)}
                              </span>
                            </p>
                            {entry.note && (
                              <p className="text-xs text-slate-500 mt-0.5">{entry.note}</p>
                            )}
                          </div>
                          <span className="font-mono-num text-sm font-bold text-emerald-700 shrink-0">
                            −{formatCurrency(entry.amount)}
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Register Payment (Abono) Modal */}
      {paymentModalOpen && selectedCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmPayment}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Registrar abono</h3>
                <p className="text-xs text-slate-500">
                  {selectedCustomer.name} · Debe {formatCurrency(selectedCustomer.balance.saldo)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Monto que abona (S/)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.10"
                    min="0.10"
                    max={selectedCustomer.balance.saldo}
                    required
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="flex-1 min-h-[48px] px-4 rounded-xl border border-slate-300 text-lg font-mono-num font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => setPayAmount(selectedCustomer.balance.saldo.toFixed(2))}
                    className="min-h-[48px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 whitespace-nowrap"
                  >
                    Pagar todo
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  ¿Cómo pagó?
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPayMethod('efectivo')}
                    className={`min-h-[48px] rounded-xl border font-bold text-sm flex items-center justify-center gap-2 transition ${
                      payMethod === 'efectivo'
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Efectivo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('yape')}
                    className={`min-h-[48px] rounded-xl border font-bold text-sm flex items-center justify-center gap-2 transition ${
                      payMethod === 'yape'
                        ? 'bg-[#742284] text-white border-[#742284]'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Yape</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Nota (opcional)
                </label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Ej. Abono de la semana"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full min-h-[50px] rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 transition"
            >
              Guardar abono
            </button>
          </form>
        </div>
      )}

      {/* New Customer Modal */}
      {newCustomerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleCreateCustomer}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Nuevo cliente para fiado</h3>
              <button
                type="button"
                onClick={() => setNewCustomerOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre o apodo
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="Ej. Sra. Carmen (Dpto 3)"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Celular / WhatsApp
                  </label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                    placeholder="987654321"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Tope de fiado (S/)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    inputMode="decimal"
                    value={custLimit}
                    onChange={(e) => setCustLimit(e.target.value)}
                    placeholder="Ej. 30"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Referencia (opcional)
                </label>
                <input
                  type="text"
                  value={custNote}
                  onChange={(e) => setCustNote(e.target.value)}
                  placeholder="Ej. Paga los sábados"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition"
            >
              Crear cliente
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
