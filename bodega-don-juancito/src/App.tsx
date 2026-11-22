/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { ScanBarcode, BookOpen, Boxes, LogOut } from 'lucide-react';
import { useBodegaStore } from './store/useBodegaStore';
import { BrandLogo } from './components/BrandLogo';
import { LoginView } from './components/LoginView';
import { PosView } from './components/PosView';
import { CreditsView } from './components/CreditsView';
import { InventoryView } from './components/InventoryView';
import { formatCurrency } from './utils/format';

type AppTab = 'pos' | 'fiados' | 'inventario';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('pos');
  const {
    firebaseUser,
    authGateStatus,
    authUser,
    authLoading,
    authError,
    accessRequestSent,
    loginWithGoogle,
    logout,
    submitAccessRequest,
    retryAccessCheck,
    isOnline,
    hasPendingWrites,
    posProducts,
    posCustomers,
    posSuggestions,
    posQuickButtons,
    posRecentSales,
    state,
    staffMembers,
    staffInvites,
    accessRequests,
    lowStockCount,
    expiringSoonCount,
    totalDebtorsCount,
    findPosProductByBarcode,
    findProductByBarcode,
    createQuickProduct,
    completeSale,
    voidSale,
    registerStockEntry,
    registerNonSaleExit,
    createCustomer,
    updateCustomer,
    registerCustomerPayment,
    addSupplierReceipt,
    deleteSupplierReceipt,
    addQuickButton,
    deleteQuickButton,
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
    getCustomerBalance,
    getFinancialSummary,
  } = useBodegaStore();

  const isAdmin = authUser?.role === 'admin';
  const todaySummary = useMemo(
    () => (isAdmin ? getFinancialSummary('today') : null),
    [isAdmin, getFinancialSummary]
  );
  const inventoryAlertCount = lowStockCount + expiringSoonCount;

  // Unauthenticated or pending approval gate
  if (authGateStatus !== 'authorized' || !authUser) {
    return (
      <LoginView
        authGateStatus={authGateStatus}
        firebaseUser={firebaseUser}
        loading={authLoading}
        error={authError}
        accessRequestSent={accessRequestSent}
        onLoginWithGoogle={loginWithGoogle}
        onSubmitAccessRequest={submitAccessRequest}
        onRetryCheck={retryAccessCheck}
        onLogout={logout}
      />
    );
  }

  // Enforce strict client-side route guard: Vendedor can ONLY ever view POS
  const currentTab: AppTab = isAdmin ? activeTab : 'pos';

  return (
    <div className="min-h-dvh flex flex-col bg-[#F6F7F8] text-slate-900">
      {/* Compact Top Bar */}
      <header className="bg-white border-b border-slate-200 md:sticky md:top-0 z-30">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="flex items-center gap-2.5 min-w-0 text-left shrink-0"
          >
            <BrandLogo size="sm" />
            <span className="min-w-0 leading-tight">
              <span className="block text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
                Don Juancito
              </span>
              <span
                className={`inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded border ${
                  isAdmin
                    ? 'bg-teal-50 text-teal-800 border-teal-200/80'
                    : 'bg-amber-50 text-amber-800 border-amber-200/80'
                }`}
              >
                {isAdmin ? 'Administrador' : 'Vendedor'}
              </span>
            </span>
          </button>

          {/* Desktop Navigation (Admin only) */}
          {isAdmin && (
            <nav className="hidden md:flex items-center gap-6" aria-label="Navegación principal">
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className={`text-sm font-semibold py-1 border-b-2 transition whitespace-nowrap shrink-0 ${
                  currentTab === 'pos'
                    ? 'border-teal-700 text-teal-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Cobrar (POS)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('fiados')}
                className={`text-sm font-semibold py-1 border-b-2 transition whitespace-nowrap shrink-0 ${
                  currentTab === 'fiados'
                    ? 'border-amber-600 text-amber-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Fiados{totalDebtorsCount > 0 ? ` (${totalDebtorsCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('inventario')}
                className={`text-sm font-semibold py-1 border-b-2 transition whitespace-nowrap shrink-0 ${
                  currentTab === 'inventario'
                    ? 'border-teal-700 text-teal-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Inventario
                {inventoryAlertCount + accessRequests.length > 0
                  ? ` (${inventoryAlertCount + accessRequests.length})`
                  : ''}
              </button>
            </nav>
          )}

          {/* Right Header Zone: Today Cash (Admin only) + User Name & Logout */}
          <div className="flex items-center gap-2.5 shrink-0">
            {isAdmin && todaySummary && (
              <div className="hidden sm:block text-right whitespace-nowrap">
                <span className="text-xs text-slate-500 mr-1.5">Cobrado hoy:</span>
                <span className="text-sm font-bold font-mono-num text-emerald-700">
                  {formatCurrency(todaySummary.totalCobrado)}
                </span>
              </div>
            )}

            <span className="hidden sm:inline text-xs font-medium text-slate-500 whitespace-nowrap max-w-[130px] truncate">
              {authUser.displayName}
            </span>

            <button
              type="button"
              onClick={() => {
                setActiveTab('pos');
                logout();
              }}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition whitespace-nowrap shrink-0"
              aria-label="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex-1 max-w-6xl w-full mx-auto px-4 pt-4 ${
          isAdmin ? 'pb-24 md:pb-10' : 'pb-8'
        }`}
      >
        {currentTab === 'pos' && (
          <PosView
            userRole={authUser.role}
            isOnline={isOnline}
            hasPendingWrites={hasPendingWrites}
            products={posProducts}
            customers={posCustomers}
            suggestions={posSuggestions}
            quickButtons={posQuickButtons}
            recentSales={posRecentSales}
            findPosProductByBarcode={findPosProductByBarcode}
            createQuickProduct={createQuickProduct}
            completeSale={completeSale}
            voidSale={voidSale}
            addQuickButton={addQuickButton}
            deleteQuickButton={deleteQuickButton}
            yapeQrDataUrl={yapeQrDataUrl}
            saveYapeQr={saveYapeQr}
          />
        )}

        {isAdmin && currentTab === 'fiados' && (
          <CreditsView
            customers={state.customers}
            sales={state.sales}
            creditPayments={state.creditPayments}
            getCustomerBalance={getCustomerBalance}
            createCustomer={createCustomer}
            updateCustomer={updateCustomer}
            registerCustomerPayment={registerCustomerPayment}
          />
        )}

        {isAdmin && currentTab === 'inventario' && (
          <InventoryView
            state={state}
            currentAdminUid={authUser.uid}
            currentAdminEmail={authUser.email}
            staffMembers={staffMembers}
            staffInvites={staffInvites}
            accessRequests={accessRequests}
            getFinancialSummary={getFinancialSummary}
            getCustomerBalance={getCustomerBalance}
            findProductByBarcode={findProductByBarcode}
            registerStockEntry={registerStockEntry}
            registerNonSaleExit={registerNonSaleExit}
            addSupplierReceipt={addSupplierReceipt}
            deleteSupplierReceipt={deleteSupplierReceipt}
            inviteStaffEmail={inviteStaffEmail}
            changeStaffInviteRole={changeStaffInviteRole}
            changeStaffMemberRole={changeStaffMemberRole}
            removeStaffInvite={removeStaffInvite}
            approveAccessRequest={approveAccessRequest}
            rejectAccessRequest={rejectAccessRequest}
            toggleStaffActive={toggleStaffActive}
            removeStaffMember={removeStaffMember}
            yapeQrDataUrl={yapeQrDataUrl}
            saveYapeQr={saveYapeQr}
            removeYapeQr={removeYapeQr}
          />
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation Bar (Admin only) */}
      {isAdmin && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 h-[62px]"
          aria-label="Menú inferior"
        >
          <div className="grid grid-cols-3 h-full">
            <button
              type="button"
              onClick={() => setActiveTab('pos')}
              className={`flex flex-col items-center justify-center gap-0.5 transition ${
                currentTab === 'pos' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ScanBarcode className="w-5 h-5" />
              <span className="text-[11px] font-bold">Cobrar</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('fiados')}
              className={`flex flex-col items-center justify-center gap-0.5 transition ${
                currentTab === 'fiados' ? 'text-amber-700' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="text-[11px] font-bold">
                Fiados{totalDebtorsCount > 0 ? ` (${totalDebtorsCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inventario')}
              className={`flex flex-col items-center justify-center gap-0.5 transition ${
                currentTab === 'inventario'
                  ? 'text-teal-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Boxes className="w-5 h-5" />
              <span className="text-[11px] font-bold">
                Inventario
                {inventoryAlertCount + accessRequests.length > 0
                  ? ` (${inventoryAlertCount + accessRequests.length})`
                  : ''}
              </span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
