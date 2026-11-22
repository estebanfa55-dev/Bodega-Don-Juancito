import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  STORE_ID,
} from '../firebase';
import type {
  AccessRequest,
  AuditLog,
  AuthGateStatus,
  AuthUser,
  BodegaState,
  CartItem,
  CashMethod,
  CreditPayment,
  Customer,
  Expense,
  InventoryMovement,
  PaymentMethod,
  PosCustomer,
  PosProduct,
  PosQuickButton,
  PosRecentSale,
  PosSuggestion,
  Product,
  QuickButton,
  Sale,
  SaleItem,
  StaffInvite,
  StaffMember,
  SupplierReceipt,
  UnlistedSuggestion,
  UserRole,
} from '../types/bodega';
import { daysUntilExpiry, generateId, isToday } from '../utils/format';
import { YAPE_QR_DATA_URL_REGEX, YAPE_QR_MAX_LENGTH } from '../utils/qrImage';
import {
  RECEIPT_ATTACHMENT_MAX_LENGTH,
  RECEIPT_ATTACHMENT_REGEX,
  type ReceiptAttachmentMime,
} from '../utils/receiptAttachment';

export interface FinancialSummary {
  efectivoVentas: number;
  yapeVentas: number;
  efectivoAbonos: number;
  yapeAbonos: number;
  gastosEfectivo: number;
  gastosYape: number;
  totalGastos: number;
  totalCobradoEfectivo: number;
  totalCobradoYape: number;
  totalCobrado: number;
  cajaNetaDespuesGastos: number;
  ventasFiadas: number;
  totalVendido: number;
  costoMercaderiaVendida: number;
  costoSalidasSinVenta: number;
  gananciaBruta: number;
  gananciaNetaEstimada: number;
  totalFiadoPorCobrar: number;
  valorInventarioCosto: number;
  valorInventarioVenta: number;
}

export interface CompleteSaleResult {
  total: number;
  customerName?: string;
  offlineQueued?: boolean;
  creditLimitExceeded?: {
    message: string;
    creditLimit: number;
    currentDebt: number;
    projectedDebt: number;
  };
  error?: string;
}

interface InventoryMetaDoc {
  productId: string;
  costPrice: number;
  minStock: number;
  expiryDate?: string;
}

interface CustomerPrivateDoc {
  customerId: string;
  name: string;
  phone?: string;
  note?: string;
  createdAt: string;
}

function safeEmailKey(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 120);
}

function safeSlugId(prefix: string, text: string): string {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${prefix}_${cleaned || 'item'}`;
}

function clampStr(value: string | undefined | null, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

const EMPTY_ADMIN_STATE: BodegaState = {
  products: [],
  sales: [],
  customers: [],
  creditPayments: [],
  movements: [],
  unlistedSuggestions: [],
  quickButtons: [],
  expenses: [],
  supplierReceipts: [],
  auditLogs: [],
};

export function useBodegaStore() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authGateStatus, setAuthGateStatus] = useState<AuthGateStatus>('initializing');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accessRequestSent, setAccessRequestSent] = useState(false);

  // Network & Firestore offline pending sync state
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingWritesMap, setPendingWritesMap] = useState<Record<string, boolean>>({});

  // Shared POS state (visible to Admin & Vendedor)
  const [posProducts, setPosProducts] = useState<PosProduct[]>([]);
  const [posCustomers, setPosCustomers] = useState<PosCustomer[]>([]);
  const [posSuggestions, setPosSuggestions] = useState<PosSuggestion[]>([]);
  const [posQuickButtons, setPosQuickButtons] = useState<PosQuickButton[]>([]);
  const [salesDocs, setSalesDocs] = useState<Sale[]>([]);
  const [yapeQrDataUrl, setYapeQrDataUrl] = useState<string | null>(null);

  // Admin-only collections
  const [inventoryMetaMap, setInventoryMetaMap] = useState<Record<string, InventoryMetaDoc>>({});
  const [customerPrivateMap, setCustomerPrivateMap] = useState<Record<string, CustomerPrivateDoc>>(
    {}
  );
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [quickButtonCosts, setQuickButtonCosts] = useState<Record<string, number>>({});
  const [unlistedCosts, setUnlistedCosts] = useState<Record<string, number>>({});
  const [supplierReceipts, setSupplierReceipts] = useState<SupplierReceipt[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Admin Team / Multi-phone management
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const markPendingWrites = useCallback((key: string, pending: boolean) => {
    setPendingWritesMap((prev) => {
      if (Boolean(prev[key]) === pending) return prev;
      return { ...prev, [key]: pending };
    });
  }, []);

  const clearStoreState = useCallback(() => {
    setPosProducts([]);
    setPosCustomers([]);
    setPosSuggestions([]);
    setPosQuickButtons([]);
    setSalesDocs([]);
    setInventoryMetaMap({});
    setCustomerPrivateMap({});
    setCreditPayments([]);
    setMovements([]);
    setExpenses([]);
    setQuickButtonCosts({});
    setUnlistedCosts({});
    setSupplierReceipts([]);
    setAuditLogs([]);
    setStaffMembers([]);
    setStaffInvites([]);
    setAccessRequests([]);
    setPendingWritesMap({});
    setYapeQrDataUrl(null);
  }, []);

  // Resolve user role after Firebase Auth sign-in
  const resolveAccessForUser = useCallback(async (fbUser: FirebaseUser) => {
    const email = (fbUser.email || '').trim().toLowerCase();
    const displayName = clampStr(fbUser.displayName || email.split('@')[0] || 'Usuario', 100);

    if (!fbUser.emailVerified || !email) {
      setAuthUser(null);
      setAuthGateStatus('unverified_email');
      return;
    }

    // 1. Bootstrap Admin
    if (email === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
      setAuthUser({
        uid: fbUser.uid,
        email,
        role: 'admin',
        displayName,
      });
      setAuthGateStatus('authorized');
      return;
    }

    // 2. Explicit admin document
    try {
      const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
      if (adminSnap.exists()) {
        setAuthUser({
          uid: fbUser.uid,
          email,
          role: 'admin',
          displayName,
        });
        setAuthGateStatus('authorized');
        return;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `admins/${fbUser.uid}`);
    }

    // 3. Existing staff member record
    try {
      const staffSnap = await getDoc(doc(db, 'staff_members', fbUser.uid));
      if (staffSnap.exists()) {
        const data = staffSnap.data() as DocumentData;
        if (data.active === true && (data.role === 'admin' || data.role === 'vendedor')) {
          setAuthUser({
            uid: fbUser.uid,
            email,
            role: data.role as UserRole,
            displayName: clampStr(String(data.displayName || displayName), 100),
          });
          setAuthGateStatus('authorized');
          return;
        }
        // Account exists in staff_members but is paused (active === false)
        setAuthUser(null);
        setAccessRequestSent(false);
        setAuthError('Tu acceso en este celular fue pausado por el Administrador.');
        setAuthGateStatus('pending_approval');
        return;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `staff_members/${fbUser.uid}`);
    }

    // 4. Pre-approved email invite -> auto-activate vendedor or admin profile
    const emailKey = safeEmailKey(email);
    try {
      const inviteSnap = await getDoc(doc(db, 'staff_invites', emailKey));
      if (inviteSnap.exists()) {
        const inv = inviteSnap.data() as DocumentData;
        if (
          inv.active === true &&
          (inv.role === 'vendedor' || inv.role === 'admin') &&
          typeof inv.invitedByUid === 'string'
        ) {
          const invitedRole = inv.role as UserRole;
          const batch = writeBatch(db);
          batch.set(doc(db, 'staff_members', fbUser.uid), {
            uid: fbUser.uid,
            email,
            displayName,
            role: invitedRole,
            active: true,
            approvedByUid: inv.invitedByUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (invitedRole === 'admin') {
            batch.set(doc(db, 'admins', fbUser.uid), {
              uid: fbUser.uid,
              email,
              displayName,
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
          setAuthUser({
            uid: fbUser.uid,
            email,
            role: invitedRole,
            displayName,
          });
          setAuthGateStatus('authorized');
          return;
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `staff_members/${fbUser.uid}`);
    }

    // 5. Check if access request already submitted
    try {
      const reqSnap = await getDoc(doc(db, 'access_requests', fbUser.uid));
      setAccessRequestSent(reqSnap.exists());
    } catch {
      setAccessRequestSent(false);
    }

    setAuthUser(null);
    setAuthGateStatus('pending_approval');
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthError(null);
      if (!fbUser) {
        setAuthUser(null);
        setAuthGateStatus('signed_out');
        setAccessRequestSent(false);
        clearStoreState();
        return;
      }
      setAuthGateStatus('initializing');
      try {
        await resolveAccessForUser(fbUser);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Error al verificar tu cuenta.');
        setAuthGateStatus('signed_out');
      }
    });
    return () => unsubscribe();
  }, [clearStoreState, resolveAccessForUser]);

  // While waiting for Admin approval on Phone 2/3, listen to own staff_members doc for instant activation
  useEffect(() => {
    if (authGateStatus !== 'pending_approval' || !firebaseUser?.uid) return;
    const email = (firebaseUser.email || '').trim().toLowerCase();
    const fallbackName = clampStr(
      firebaseUser.displayName || email.split('@')[0] || 'Usuario',
      100
    );
    const ref = doc(db, 'staff_members', firebaseUser.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.active === true && (data.role === 'admin' || data.role === 'vendedor')) {
            setAuthError(null);
            setAuthUser({
              uid: firebaseUser.uid,
              email,
              role: data.role as UserRole,
              displayName: clampStr(String(data.displayName || fallbackName), 100),
            });
            setAuthGateStatus('authorized');
          } else {
            setAuthError('Tu acceso en este celular fue pausado por el Administrador.');
          }
        } else {
          setAuthError(null);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `staff_members/${firebaseUser.uid}`)
    );
    return () => unsub();
  }, [authGateStatus, firebaseUser]);

  // While authorized on a linked phone (non-bootstrap admin), enforce Pause / Revoke in real time
  useEffect(() => {
    if (authGateStatus !== 'authorized' || !firebaseUser?.uid || !authUser) return;
    const email = (firebaseUser.email || '').trim().toLowerCase();
    if (email === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) return;

    const ref = doc(db, 'staff_members', firebaseUser.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          if (authUser.role === 'admin') {
            // Verify admins collection before revoking explicit admin
            getDoc(doc(db, 'admins', firebaseUser.uid))
              .then((admSnap) => {
                if (!admSnap.exists()) {
                  clearStoreState();
                  setAuthUser(null);
                  setAccessRequestSent(false);
                  setAuthError('El Administrador revocó el acceso de este celular.');
                  setAuthGateStatus('pending_approval');
                }
              })
              .catch(() => undefined);
            return;
          }
          clearStoreState();
          setAuthUser(null);
          setAccessRequestSent(false);
          setAuthError('El Administrador revocó el acceso de este celular.');
          setAuthGateStatus('pending_approval');
          return;
        }
        const data = snap.data();
        if (data.active !== true) {
          clearStoreState();
          setAuthUser(null);
          setAccessRequestSent(false);
          setAuthError('Tu acceso en este celular fue pausado por el Administrador.');
          setAuthGateStatus('pending_approval');
          return;
        }
        if ((data.role === 'admin' || data.role === 'vendedor') && data.role !== authUser.role) {
          const nextRole = data.role as UserRole;
          if (nextRole === 'vendedor') {
            clearStoreState();
          }
          setAuthUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `staff_members/${firebaseUser.uid}`)
    );
    return () => unsub();
  }, [authGateStatus, authUser, clearStoreState, firebaseUser]);

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('Cerraste la ventana de Google antes de completar el ingreso.');
      } else {
        setAuthError(msg);
      }
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setAuthError(null);
    clearStoreState();
    await signOut(auth);
  }, [clearStoreState]);

  const submitAccessRequest = useCallback(async (): Promise<boolean> => {
    if (!firebaseUser || !firebaseUser.email || !firebaseUser.emailVerified) return false;
    const email = firebaseUser.email.trim().toLowerCase();
    const displayName = clampStr(firebaseUser.displayName || email.split('@')[0] || 'Vendedor', 100);
    const path = `access_requests/${firebaseUser.uid}`;
    const reqRef = doc(db, 'access_requests', firebaseUser.uid);
    try {
      const existingSnap = await getDoc(reqRef);
      if (existingSnap.exists()) {
        await updateDoc(reqRef, {
          displayName,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(reqRef, {
          uid: firebaseUser.uid,
          email,
          displayName,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setAccessRequestSent(true);
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }, [firebaseUser]);

  const retryAccessCheck = useCallback(async () => {
    if (!firebaseUser) return;
    setAuthLoading(true);
    try {
      await resolveAccessForUser(firebaseUser);
    } finally {
      setAuthLoading(false);
    }
  }, [firebaseUser, resolveAccessForUser]);

  // --- REAL-TIME FIRESTORE LISTENERS (POS + ROLE-GATED ADMIN) ---
  useEffect(() => {
    if (authGateStatus !== 'authorized' || !authUser) return;

    const unsubs: Array<() => void> = [];

    // 1. POS Products
    unsubs.push(
      onSnapshot(
        query(collection(db, 'pos_products'), where('storeId', '==', STORE_ID)),
        { includeMetadataChanges: true },
        (snap) => {
          markPendingWrites('pos_products', snap.metadata.hasPendingWrites);
          const list: PosProduct[] = snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                name: String(data.name || ''),
                barcode: typeof data.barcode === 'string' ? data.barcode : undefined,
                salePrice: Number(data.salePrice || 0),
                stock: Number(data.stock || 0),
                unitLabel: typeof data.unitLabel === 'string' ? data.unitLabel : undefined,
                updatedAt: toIso(data.updatedAt),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          setPosProducts(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'pos_products')
      )
    );

    // 2. POS Customers (no phone/notes PII)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'pos_customers'), where('storeId', '==', STORE_ID)),
        { includeMetadataChanges: true },
        (snap) => {
          markPendingWrites('pos_customers', snap.metadata.hasPendingWrites);
          const list: PosCustomer[] = snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                name: String(data.name || ''),
                creditLimit:
                  typeof data.creditLimit === 'number' ? Number(data.creditLimit) : undefined,
                currentDebt: Number(data.currentDebt || 0),
                updatedAt: toIso(data.updatedAt),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          setPosCustomers(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'pos_customers')
      )
    );

    // 3. Quick Sale Buttons
    unsubs.push(
      onSnapshot(
        query(collection(db, 'quick_buttons'), where('storeId', '==', STORE_ID)),
        (snap) => {
          const list: PosQuickButton[] = snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                name: String(data.name || ''),
                price: Number(data.price || 0),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          setPosQuickButtons(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'quick_buttons')
      )
    );

    // 4. Unlisted Suggestions
    unsubs.push(
      onSnapshot(
        query(collection(db, 'unlisted_suggestions'), where('storeId', '==', STORE_ID)),
        (snap) => {
          const list: PosSuggestion[] = snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                name: String(data.name || ''),
                lastPrice: Number(data.lastPrice || 0),
                usageCount: Number(data.usageCount || 1),
              };
            })
            .sort((a, b) => b.usageCount - a.usageCount);
          setPosSuggestions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'unlisted_suggestions')
      )
    );

    // 5. Sales (Admin sees all; Vendedor only sees their own recorded sales per Pillar 8)
    const salesQuery =
      authUser.role === 'admin'
        ? query(collection(db, 'sales'), where('storeId', '==', STORE_ID))
        : query(
            collection(db, 'sales'),
            where('storeId', '==', STORE_ID),
            where('recordedByUid', '==', authUser.uid)
          );

    unsubs.push(
      onSnapshot(
        salesQuery,
        { includeMetadataChanges: true },
        (snap) => {
          markPendingWrites('sales', snap.metadata.hasPendingWrites);
          const list: Sale[] = snap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                clientTxId: String(data.clientTxId || d.id),
                createdAt: toIso(data.createdAt),
                updatedAt: toIso(data.updatedAt),
                items: Array.isArray(data.items) ? (data.items as SaleItem[]) : [],
                itemsSummary: String(data.itemsSummary || ''),
                itemCount: Number(data.itemCount || 1),
                total: Number(data.total || 0),
                totalCost: Number(data.totalCost || 0),
                paymentMethod: data.paymentMethod as PaymentMethod,
                customerId: typeof data.customerId === 'string' ? data.customerId : undefined,
                customerName: typeof data.customerName === 'string' ? data.customerName : undefined,
                recordedByUid: String(data.recordedByUid || ''),
                recordedByEmail: String(data.recordedByEmail || ''),
                recordedByRole: (data.recordedByRole as UserRole) || 'vendedor',
                voided: Boolean(data.voided),
                voidedAt: data.voidedAt ? toIso(data.voidedAt) : undefined,
                voidedByUid: typeof data.voidedByUid === 'string' ? data.voidedByUid : undefined,
                voidedByEmail:
                  typeof data.voidedByEmail === 'string' ? data.voidedByEmail : undefined,
                voidedByRole:
                  data.voidedByRole === 'admin' || data.voidedByRole === 'vendedor'
                    ? (data.voidedByRole as UserRole)
                    : undefined,
                voidReason: typeof data.voidReason === 'string' ? data.voidReason : undefined,
                hasPendingWrites: d.metadata.hasPendingWrites,
              };
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setSalesDocs(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
      )
    );

    // 6. Store Settings (Yape QR visible to all authorized staff)
    unsubs.push(
      onSnapshot(
        doc(db, 'store_settings', STORE_ID),
        (snap) => {
          if (!snap.exists()) {
            setYapeQrDataUrl(null);
            return;
          }
          const data = snap.data();
          setYapeQrDataUrl(typeof data.yapeQrDataUrl === 'string' ? data.yapeQrDataUrl : null);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `store_settings/${STORE_ID}`)
      )
    );

    // 6. Admin-Only Collections (NEVER attached for Vendedor)
    if (authUser.role === 'admin') {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'inventory_meta'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const next: Record<string, InventoryMetaDoc> = {};
            for (const d of snap.docs) {
              const data = d.data();
              next[d.id] = {
                productId: d.id,
                costPrice: Number(data.costPrice || 0),
                minStock: Number(data.minStock ?? 3),
                expiryDate: typeof data.expiryDate === 'string' ? data.expiryDate : undefined,
              };
            }
            setInventoryMetaMap(next);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'inventory_meta')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'customers_private'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const next: Record<string, CustomerPrivateDoc> = {};
            for (const d of snap.docs) {
              const data = d.data();
              next[d.id] = {
                customerId: d.id,
                name: String(data.name || ''),
                phone: typeof data.phone === 'string' ? data.phone : undefined,
                note: typeof data.note === 'string' ? data.note : undefined,
                createdAt: toIso(data.createdAt),
              };
            }
            setCustomerPrivateMap(next);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'customers_private')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'credit_payments'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const list: CreditPayment[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  customerId: String(data.customerId || ''),
                  amount: Number(data.amount || 0),
                  method: (data.method as CashMethod) || 'efectivo',
                  note: typeof data.note === 'string' ? data.note : undefined,
                  recordedByEmail:
                    typeof data.recordedByEmail === 'string' ? data.recordedByEmail : undefined,
                  createdAt: toIso(data.createdAt),
                };
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setCreditPayments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'credit_payments')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'movements'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const list: InventoryMovement[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  productId: String(data.productId || ''),
                  productName: String(data.productName || ''),
                  type: data.type as InventoryMovement['type'],
                  quantity: Number(data.quantity || 0),
                  unitCost: Number(data.unitCost || 0),
                  totalCost: Number(data.totalCost || 0),
                  note: typeof data.note === 'string' ? data.note : undefined,
                  actorUid: String(data.actorUid || ''),
                  actorEmail: String(data.actorEmail || ''),
                  actorRole: (data.actorRole as UserRole) || 'vendedor',
                  createdAt: toIso(data.createdAt),
                };
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setMovements(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'movements')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'expenses'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const list: Expense[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  description: String(data.description || ''),
                  category: String(data.category || 'Otros gastos'),
                  amount: Number(data.amount || 0),
                  method: (data.method as CashMethod) || 'efectivo',
                  recordedByEmail:
                    typeof data.recordedByEmail === 'string' ? data.recordedByEmail : undefined,
                  createdAt: toIso(data.createdAt),
                };
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setExpenses(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'supplier_receipts'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const list: SupplierReceipt[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  supplierName: String(data.supplierName || ''),
                  amount: Number(data.amount || 0),
                  deliveredAt: String(data.deliveredAt || toIso(data.createdAt)),
                  note: typeof data.note === 'string' ? data.note : undefined,
                  attachmentDataUrl:
                    typeof data.attachmentDataUrl === 'string' ? data.attachmentDataUrl : undefined,
                  attachmentName:
                    typeof data.attachmentName === 'string' ? data.attachmentName : undefined,
                  attachmentMime:
                    typeof data.attachmentMime === 'string'
                      ? (data.attachmentMime as SupplierReceipt['attachmentMime'])
                      : undefined,
                  recordedByEmail:
                    typeof data.recordedByEmail === 'string' ? data.recordedByEmail : undefined,
                  createdAt: toIso(data.createdAt),
                };
              })
              .sort((a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime());
            setSupplierReceipts(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'supplier_receipts')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'quick_button_costs'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const next: Record<string, number> = {};
            for (const d of snap.docs) {
              next[d.id] = Number(d.data().costPrice || 0);
            }
            setQuickButtonCosts(next);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'quick_button_costs')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'unlisted_costs'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const next: Record<string, number> = {};
            for (const d of snap.docs) {
              next[d.id] = Number(d.data().lastCost || 0);
            }
            setUnlistedCosts(next);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'unlisted_costs')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'audit_logs'), where('storeId', '==', STORE_ID)),
          (snap) => {
            const list: AuditLog[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  id: d.id,
                  action: data.action as AuditLog['action'],
                  summary: String(data.summary || ''),
                  actorUid: String(data.actorUid || ''),
                  actorEmail: String(data.actorEmail || ''),
                  role: (data.role as UserRole) || 'vendedor',
                  createdAt: toIso(data.createdAt),
                };
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setAuditLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'staff_members'),
          (snap) => {
            const list: StaffMember[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                uid: d.id,
                email: String(data.email || ''),
                displayName: String(data.displayName || ''),
                role: (data.role as UserRole) || 'vendedor',
                active: Boolean(data.active),
                approvedByUid: String(data.approvedByUid || ''),
                createdAt: toIso(data.createdAt),
                updatedAt: toIso(data.updatedAt),
              };
            });
            setStaffMembers(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staff_members')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'staff_invites'),
          (snap) => {
            const list: StaffInvite[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                email: String(data.email || ''),
                role: (data.role as UserRole) || 'vendedor',
                active: Boolean(data.active),
                invitedByUid: String(data.invitedByUid || ''),
                createdAt: toIso(data.createdAt),
                updatedAt: toIso(data.updatedAt),
              };
            });
            setStaffInvites(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staff_invites')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'access_requests'),
          (snap) => {
            const list: AccessRequest[] = snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  uid: d.id,
                  email: String(data.email || ''),
                  displayName: String(data.displayName || ''),
                  status: 'pending' as const,
                  createdAt: toIso(data.createdAt),
                  updatedAt: toIso(data.updatedAt),
                };
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setAccessRequests(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'access_requests')
        )
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [authGateStatus, authUser, markPendingWrites]);

  const hasPendingWrites = useMemo(
    () => Object.values(pendingWritesMap).some(Boolean),
    [pendingWritesMap]
  );

  // Merged Admin State (combines public POS projections + Admin-only private meta/costs)
  const adminState: BodegaState = useMemo(() => {
    if (authUser?.role !== 'admin') return EMPTY_ADMIN_STATE;

    const products: Product[] = posProducts.map((p) => {
      const meta = inventoryMetaMap[p.id];
      return {
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        salePrice: p.salePrice,
        costPrice: meta?.costPrice ?? 0,
        stock: p.stock,
        minStock: meta?.minStock ?? 3,
        unitLabel: p.unitLabel,
        expiryDate: meta?.expiryDate,
        updatedAt: p.updatedAt,
      };
    });

    const customers: Customer[] = posCustomers.map((c) => {
      const priv = customerPrivateMap[c.id];
      return {
        id: c.id,
        name: c.name,
        phone: priv?.phone,
        note: priv?.note,
        creditLimit: c.creditLimit,
        currentDebt: c.currentDebt,
        createdAt: priv?.createdAt || c.updatedAt,
      };
    });

    const quickButtons: QuickButton[] = posQuickButtons.map((qb) => ({
      id: qb.id,
      name: qb.name,
      price: qb.price,
      costPrice: quickButtonCosts[qb.id] ?? 0,
    }));

    const unlistedSuggestions: UnlistedSuggestion[] = posSuggestions.map((s) => ({
      id: s.id,
      name: s.name,
      lastPrice: s.lastPrice,
      lastCost: unlistedCosts[s.id] ?? 0,
      usageCount: s.usageCount,
      updatedAt: new Date().toISOString(),
    }));

    // Enrich sales & movements costs from inventoryMeta when recorded by Vendedor
    const quickCostByName = new Map<string, number>();
    for (const qb of quickButtons) {
      quickCostByName.set(qb.name.trim().toLowerCase(), qb.costPrice);
    }

    const enrichedSales: Sale[] = salesDocs.map((s) => {
      if (s.totalCost > 0) return s;
      let computedCost = 0;
      const resolvedItems = s.items.map((item) => {
        let unitCost = item.unitCost || 0;
        if (unitCost === 0 && !item.isUnlisted && item.productId) {
          unitCost = inventoryMetaMap[item.productId]?.costPrice ?? 0;
        } else if (unitCost === 0 && item.isUnlisted) {
          const sugId = safeSlugId('sug', item.name);
          unitCost = unlistedCosts[sugId] ?? quickCostByName.get(item.name.trim().toLowerCase()) ?? 0;
        }
        computedCost += unitCost * item.quantity;
        return { ...item, unitCost };
      });
      return {
        ...s,
        items: resolvedItems,
        totalCost: Number(computedCost.toFixed(2)),
      };
    });

    const enrichedMovements: InventoryMovement[] = movements.map((m) => {
      if (m.totalCost > 0 || (m.type !== 'venta' && m.type !== 'anulacion')) return m;
      const unitCost = inventoryMetaMap[m.productId]?.costPrice ?? 0;
      return {
        ...m,
        unitCost,
        totalCost: Number((unitCost * m.quantity).toFixed(2)),
      };
    });

    return {
      products,
      sales: enrichedSales,
      customers,
      creditPayments,
      movements: enrichedMovements,
      unlistedSuggestions,
      quickButtons,
      expenses,
      supplierReceipts,
      auditLogs,
    };
  }, [
    authUser?.role,
    posProducts,
    posCustomers,
    posQuickButtons,
    posSuggestions,
    salesDocs,
    inventoryMetaMap,
    customerPrivateMap,
    creditPayments,
    movements,
    expenses,
    supplierReceipts,
    quickButtonCosts,
    unlistedCosts,
    auditLogs,
  ]);

  const posRecentSales: PosRecentSale[] = useMemo(() => {
    return salesDocs.slice(0, 20).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      total: s.total,
      paymentMethod: s.paymentMethod,
      customerName: s.customerName,
      itemCount: s.itemCount,
      itemsSummary: s.itemsSummary,
      voided: s.voided,
      hasPendingWrites: s.hasPendingWrites,
    }));
  }, [salesDocs]);

  // --- POS OPERATIONS (ADMIN + VENDEDOR) ---
  const findPosProductByBarcode = useCallback(
    (barcode: string): PosProduct | undefined => {
      const clean = barcode.trim();
      if (!clean) return undefined;
      return posProducts.find((p) => p.barcode?.trim() === clean);
    },
    [posProducts]
  );

  const findProductByBarcode = useCallback(
    (barcode: string): Product | undefined => {
      const clean = barcode.trim();
      if (!clean) return undefined;
      return adminState.products.find((p) => p.barcode?.trim() === clean);
    },
    [adminState.products]
  );

  const createQuickProduct = useCallback(
    async (input: {
      barcode?: string;
      name: string;
      salePrice: number;
      costPrice?: number;
      stock?: number;
    }): Promise<PosProduct | null> => {
      if (!authUser) return null;
      const productId = generateId('prod');
      const cleanName = clampStr(input.name, 120);
      const cleanBarcode = clampStr(input.barcode, 64);
      const salePrice = Number(Math.max(0.01, input.salePrice).toFixed(2));
      const stock = Math.max(0, Math.round(input.stock ?? 1));

      const posPayload: Record<string, unknown> = {
        id: productId,
        storeId: STORE_ID,
        name: cleanName,
        salePrice,
        stock,
        unitLabel: 'und',
        updatedAt: serverTimestamp(),
      };
      if (cleanBarcode) {
        posPayload.barcode = cleanBarcode;
      }

      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'pos_products', productId), posPayload);

        if (authUser.role === 'admin') {
          const costPrice = Number(Math.max(0, input.costPrice ?? 0).toFixed(2));
          batch.set(doc(db, 'inventory_meta', productId), {
            productId,
            storeId: STORE_ID,
            costPrice,
            minStock: 3,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        return {
          id: productId,
          name: cleanName,
          barcode: cleanBarcode || undefined,
          salePrice,
          stock,
          unitLabel: 'und',
          updatedAt: new Date().toISOString(),
        };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `pos_products/${productId}`);
      }
    },
    [authUser]
  );

  const completeSale = useCallback(
    async (params: {
      cart: CartItem[];
      paymentMethod: PaymentMethod;
      customerId?: string;
      newCustomerName?: string;
      newCustomerPhone?: string;
      allowOverLimit?: boolean;
    }): Promise<CompleteSaleResult> => {
      if (!authUser) return { total: 0, error: 'Sesión no iniciada.' };
      if (params.cart.length === 0) return { total: 0, error: 'El carrito está vacío.' };
      if (params.cart.length > 50) {
        return { total: 0, error: 'Máximo 50 líneas distintas por venta.' };
      }

      const clientTxId = generateId('tx');
      const saleId = generateId('sale');

      const isAdmin = authUser.role === 'admin';
      const normalizedCart = params.cart.slice(0, 50);

      const saleItems: SaleItem[] = normalizedCart.map((c) => {
        const unitCost = isAdmin
          ? c.unitCost > 0
            ? c.unitCost
            : !c.isUnlisted && c.productId
              ? inventoryMetaMap[c.productId]?.costPrice ?? 0
              : 0
          : 0;
        return {
          ...(c.productId ? { productId: c.productId } : {}),
          ...(c.barcode ? { barcode: clampStr(c.barcode, 64) } : {}),
          name: clampStr(c.name, 120),
          quantity: Math.max(1, Math.round(c.quantity)),
          unitPrice: Number(c.unitPrice.toFixed(2)),
          unitCost: Number(unitCost.toFixed(2)),
          subtotal: Number((c.unitPrice * c.quantity).toFixed(2)),
          isUnlisted: c.isUnlisted,
        };
      });

      const total = Number(saleItems.reduce((s, i) => s + i.subtotal, 0).toFixed(2));
      const totalCost = isAdmin
        ? Number(saleItems.reduce((s, i) => s + i.unitCost * i.quantity, 0).toFixed(2))
        : 0;
      const itemCount = Math.max(
        1,
        Math.round(saleItems.reduce((s, i) => s + i.quantity, 0))
      );
      const itemsSummary = clampStr(
        saleItems.map((i) => `${i.quantity}x ${i.name}`).join(', '),
        300
      );

      let resolvedCustomerId = params.customerId;
      let resolvedCustomerName = params.newCustomerName
        ? clampStr(params.newCustomerName, 100)
        : undefined;
      const isNewCustomer =
        params.paymentMethod === 'fiado' && !resolvedCustomerId && Boolean(resolvedCustomerName);
      if (isNewCustomer) {
        resolvedCustomerId = generateId('cust');
      }

      const executeSaleWrites = async () => {
        if (navigator.onLine) {
          // Atomic cloud transaction for multi-phone concurrency safety
          await runTransaction(db, async (tx) => {
            // 1. ALL READS FIRST
            const prodIds = Array.from(
              new Set(
                saleItems
                  .filter((i) => !i.isUnlisted && i.productId)
                  .map((i) => i.productId as string)
              )
            );
            const prodSnaps = await Promise.all(
              prodIds.map((pid) => tx.get(doc(db, 'pos_products', pid)))
            );

            const sugIds = Array.from(
              new Set(saleItems.filter((i) => i.isUnlisted).map((i) => safeSlugId('sug', i.name)))
            );
            const sugSnaps = await Promise.all(
              sugIds.map((sid) => tx.get(doc(db, 'unlisted_suggestions', sid)))
            );

            let custSnap: DocumentSnapshot<DocumentData> | null = null;
            if (params.paymentMethod === 'fiado' && resolvedCustomerId && !isNewCustomer) {
              custSnap = await tx.get(doc(db, 'pos_customers', resolvedCustomerId));
            }

            // 2. VALIDATE FIADO CUSTOMER & CREDIT LIMIT
            let nextDebt = total;
            if (params.paymentMethod === 'fiado' && resolvedCustomerId) {
              if (!isNewCustomer) {
                if (!custSnap || !custSnap.exists()) {
                  throw new Error('CUSTOMER_NOT_FOUND');
                }
                const cData = custSnap.data();
                resolvedCustomerName = String(cData.name || 'Cliente');
                const currentDebt = Number(cData.currentDebt || 0);
                const creditLimit =
                  typeof cData.creditLimit === 'number' ? Number(cData.creditLimit) : undefined;
                nextDebt = Number((currentDebt + total).toFixed(2));
                if (
                  typeof creditLimit === 'number' &&
                  creditLimit > 0 &&
                  nextDebt > creditLimit &&
                  !params.allowOverLimit
                ) {
                  const err = new Error('CREDIT_LIMIT_EXCEEDED') as Error & {
                    creditLimit?: number;
                    currentDebt?: number;
                    projectedDebt?: number;
                  };
                  err.creditLimit = creditLimit;
                  err.currentDebt = currentDebt;
                  err.projectedDebt = nextDebt;
                  throw err;
                }
              }
            }

            // 3. ALL WRITES
            if (params.paymentMethod === 'fiado' && resolvedCustomerId) {
              if (isNewCustomer && resolvedCustomerName) {
                tx.set(doc(db, 'pos_customers', resolvedCustomerId), {
                  id: resolvedCustomerId,
                  storeId: STORE_ID,
                  name: resolvedCustomerName,
                  currentDebt: total,
                  updatedAt: serverTimestamp(),
                });
                if (isAdmin) {
                  const cleanPhone = clampStr(params.newCustomerPhone, 32);
                  tx.set(doc(db, 'customers_private', resolvedCustomerId), {
                    customerId: resolvedCustomerId,
                    storeId: STORE_ID,
                    name: resolvedCustomerName,
                    ...(cleanPhone ? { phone: cleanPhone } : {}),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  });
                }
              } else {
                tx.update(doc(db, 'pos_customers', resolvedCustomerId), {
                  currentDebt: nextDebt,
                  updatedAt: serverTimestamp(),
                });
              }

              if (params.allowOverLimit) {
                const auditId = generateId('aud');
                tx.set(doc(db, 'audit_logs', auditId), {
                  id: auditId,
                  storeId: STORE_ID,
                  action: 'limite_fiado_superado',
                  summary: clampStr(
                    `Fiado por S/ ${total.toFixed(2)} a ${resolvedCustomerName || 'Cliente'} superó su tope (nuevo saldo S/ ${nextDebt.toFixed(2)})`,
                    300
                  ),
                  actorUid: authUser.uid,
                  actorEmail: authUser.email,
                  role: authUser.role,
                  createdAt: serverTimestamp(),
                });
              }
            }

            // Stock deductions + movements
            const qtyByProduct = new Map<string, { qty: number; item: SaleItem }>();
            for (const item of saleItems) {
              if (!item.isUnlisted && item.productId) {
                const existing = qtyByProduct.get(item.productId);
                if (existing) {
                  existing.qty += item.quantity;
                } else {
                  qtyByProduct.set(item.productId, { qty: item.quantity, item });
                }
              }
            }

            prodIds.forEach((pid, idx) => {
              const snap = prodSnaps[idx];
              const entry = qtyByProduct.get(pid);
              if (snap.exists() && entry) {
                const currentStock = Number(snap.data().stock || 0);
                const nextStock = Math.max(0, currentStock - entry.qty);
                tx.update(doc(db, 'pos_products', pid), {
                  stock: nextStock,
                  updatedAt: serverTimestamp(),
                });

                const movId = generateId('mov');
                tx.set(doc(db, 'movements', movId), {
                  id: movId,
                  storeId: STORE_ID,
                  productId: pid,
                  productName: entry.item.name,
                  type: 'venta',
                  quantity: entry.qty,
                  unitCost: isAdmin ? entry.item.unitCost : 0,
                  totalCost: isAdmin
                    ? Number((entry.item.unitCost * entry.qty).toFixed(2))
                    : 0,
                  actorUid: authUser.uid,
                  actorEmail: authUser.email,
                  actorRole: authUser.role,
                  createdAt: serverTimestamp(),
                });
              }
            });

            // Unlisted suggestions upsert
            const seenSug = new Set<string>();
            saleItems.forEach((item) => {
              if (!item.isUnlisted) return;
              const sid = safeSlugId('sug', item.name);
              if (seenSug.has(sid)) return;
              seenSug.add(sid);
              const idx = sugIds.indexOf(sid);
              const snap = idx >= 0 ? sugSnaps[idx] : undefined;
              if (snap && snap.exists()) {
                const prevCount = Number(snap.data().usageCount || 1);
                tx.update(doc(db, 'unlisted_suggestions', sid), {
                  lastPrice: item.unitPrice,
                  usageCount: Math.min(1000000, Math.round(prevCount + 1)),
                  updatedAt: serverTimestamp(),
                });
              } else {
                tx.set(doc(db, 'unlisted_suggestions', sid), {
                  id: sid,
                  storeId: STORE_ID,
                  name: clampStr(item.name, 100),
                  lastPrice: item.unitPrice,
                  usageCount: 1,
                  updatedAt: serverTimestamp(),
                });
              }
              if (isAdmin && item.unitCost > 0) {
                tx.set(doc(db, 'unlisted_costs', sid), {
                  suggestionId: sid,
                  storeId: STORE_ID,
                  lastCost: item.unitCost,
                  updatedAt: serverTimestamp(),
                });
              }
            });

            // Create sale record
            const saleDoc: Record<string, unknown> = {
              id: saleId,
              storeId: STORE_ID,
              clientTxId,
              items: saleItems,
              itemsSummary,
              itemCount,
              total,
              totalCost,
              paymentMethod: params.paymentMethod,
              recordedByUid: authUser.uid,
              recordedByEmail: authUser.email,
              recordedByRole: authUser.role,
              voided: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (params.paymentMethod === 'fiado' && resolvedCustomerId) {
              saleDoc.customerId = resolvedCustomerId;
              saleDoc.customerName = resolvedCustomerName || 'Cliente';
            }
            tx.set(doc(db, 'sales', saleId), saleDoc);
          });
          return { offlineQueued: false };
        } else {
          // Offline persistent cache fallback via writeBatch (syncs automatically when online)
          const batch = writeBatch(db);
          if (params.paymentMethod === 'fiado' && resolvedCustomerId) {
            if (isNewCustomer && resolvedCustomerName) {
              batch.set(doc(db, 'pos_customers', resolvedCustomerId), {
                id: resolvedCustomerId,
                storeId: STORE_ID,
                name: resolvedCustomerName,
                currentDebt: total,
                updatedAt: serverTimestamp(),
              });
            } else {
              const cachedCust = posCustomers.find((c) => c.id === resolvedCustomerId);
              resolvedCustomerName = cachedCust?.name || 'Cliente';
              const nextDebt = Number(((cachedCust?.currentDebt || 0) + total).toFixed(2));
              batch.update(doc(db, 'pos_customers', resolvedCustomerId), {
                currentDebt: nextDebt,
                updatedAt: serverTimestamp(),
              });
            }
          }

          for (const item of saleItems) {
            if (!item.isUnlisted && item.productId) {
              const cachedProd = posProducts.find((p) => p.id === item.productId);
              const nextStock = Math.max(0, (cachedProd?.stock || 0) - item.quantity);
              batch.update(doc(db, 'pos_products', item.productId), {
                stock: nextStock,
                updatedAt: serverTimestamp(),
              });
              const movId = generateId('mov');
              batch.set(doc(db, 'movements', movId), {
                id: movId,
                storeId: STORE_ID,
                productId: item.productId,
                productName: item.name,
                type: 'venta',
                quantity: item.quantity,
                unitCost: isAdmin ? item.unitCost : 0,
                totalCost: isAdmin
                  ? Number((item.unitCost * item.quantity).toFixed(2))
                  : 0,
                actorUid: authUser.uid,
                actorEmail: authUser.email,
                actorRole: authUser.role,
                createdAt: serverTimestamp(),
              });
            }
          }

          const saleDoc: Record<string, unknown> = {
            id: saleId,
            storeId: STORE_ID,
            clientTxId,
            items: saleItems,
            itemsSummary,
            itemCount,
            total,
            totalCost,
            paymentMethod: params.paymentMethod,
            recordedByUid: authUser.uid,
            recordedByEmail: authUser.email,
            recordedByRole: authUser.role,
            voided: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (params.paymentMethod === 'fiado' && resolvedCustomerId) {
            saleDoc.customerId = resolvedCustomerId;
            saleDoc.customerName = resolvedCustomerName || 'Cliente';
          }
          batch.set(doc(db, 'sales', saleId), saleDoc);
          await batch.commit();
          return { offlineQueued: true };
        }
      };

      try {
        const res = await executeSaleWrites();
        return {
          total,
          customerName: resolvedCustomerName,
          offlineQueued: res.offlineQueued,
        };
      } catch (err) {
        const customErr = err as Error & {
          creditLimit?: number;
          currentDebt?: number;
          projectedDebt?: number;
        };
        if (customErr.message === 'CREDIT_LIMIT_EXCEEDED') {
          return {
            total,
            creditLimitExceeded: {
              message: `Supera el límite de fiado (S/ ${(customErr.creditLimit || 0).toFixed(2)}). Saldo actual: S/ ${(customErr.currentDebt || 0).toFixed(2)} → Con esta venta: S/ ${(customErr.projectedDebt || 0).toFixed(2)}.`,
              creditLimit: customErr.creditLimit || 0,
              currentDebt: customErr.currentDebt || 0,
              projectedDebt: customErr.projectedDebt || 0,
            },
          };
        }
        if (customErr.message === 'CUSTOMER_NOT_FOUND') {
          return { total: 0, error: 'El cliente seleccionado ya no existe.' };
        }
        handleFirestoreError(err, OperationType.WRITE, `sales/${saleId}`);
      }
    },
    [authUser, inventoryMetaMap, posCustomers, posProducts]
  );

  const voidSale = useCallback(
    async (saleId: string, reason: string): Promise<{ ok: boolean; error?: string }> => {
      if (!authUser) return { ok: false, error: 'Sesión no iniciada.' };
      if (!navigator.onLine) {
        return { ok: false, error: 'Se requiere conexión a internet para anular una venta.' };
      }

      const cleanReason = clampStr(reason || 'Error en cobro', 200);
      try {
        await runTransaction(db, async (tx) => {
          const saleRef = doc(db, 'sales', saleId);
          const saleSnap = await tx.get(saleRef);
          if (!saleSnap.exists()) {
            throw new Error('SALE_NOT_FOUND');
          }
          const saleData = saleSnap.data();
          if (saleData.voided === true) {
            throw new Error('ALREADY_VOIDED');
          }

          const items = Array.isArray(saleData.items) ? (saleData.items as SaleItem[]) : [];
          const prodIds = Array.from(
            new Set(
              items.filter((i) => !i.isUnlisted && i.productId).map((i) => i.productId as string)
            )
          );
          const prodSnaps = await Promise.all(
            prodIds.map((pid) => tx.get(doc(db, 'pos_products', pid)))
          );

          let custSnap: DocumentSnapshot<DocumentData> | null = null;
          if (saleData.paymentMethod === 'fiado' && typeof saleData.customerId === 'string') {
            custSnap = await tx.get(doc(db, 'pos_customers', saleData.customerId));
          }

          // Writes
          tx.update(saleRef, {
            voided: true,
            voidedAt: serverTimestamp(),
            voidedByUid: authUser.uid,
            voidedByEmail: authUser.email,
            voidedByRole: authUser.role,
            voidReason: cleanReason,
            updatedAt: serverTimestamp(),
          });

          const qtyByProd = new Map<string, { qty: number; item: SaleItem }>();
          for (const item of items) {
            if (!item.isUnlisted && item.productId) {
              const ex = qtyByProd.get(item.productId);
              if (ex) ex.qty += item.quantity;
              else qtyByProd.set(item.productId, { qty: item.quantity, item });
            }
          }

          prodIds.forEach((pid, idx) => {
            const snap = prodSnaps[idx];
            const entry = qtyByProd.get(pid);
            if (snap.exists() && entry) {
              const nextStock = Number(snap.data().stock || 0) + entry.qty;
              tx.update(doc(db, 'pos_products', pid), {
                stock: nextStock,
                updatedAt: serverTimestamp(),
              });

              const movId = generateId('mov');
              tx.set(doc(db, 'movements', movId), {
                id: movId,
                storeId: STORE_ID,
                productId: pid,
                productName: entry.item.name,
                type: 'anulacion',
                quantity: entry.qty,
                unitCost: authUser.role === 'admin' ? entry.item.unitCost || 0 : 0,
                totalCost:
                  authUser.role === 'admin'
                    ? Number(((entry.item.unitCost || 0) * entry.qty).toFixed(2))
                    : 0,
                note: clampStr(`Anulación: ${cleanReason}`, 200),
                actorUid: authUser.uid,
                actorEmail: authUser.email,
                actorRole: authUser.role,
                createdAt: serverTimestamp(),
              });
            }
          });

          if (
            custSnap &&
            custSnap.exists() &&
            saleData.paymentMethod === 'fiado' &&
            typeof saleData.customerId === 'string'
          ) {
            const prevDebt = Number(custSnap.data().currentDebt || 0);
            const nextDebt = Number(Math.max(0, prevDebt - Number(saleData.total || 0)).toFixed(2));
            tx.update(doc(db, 'pos_customers', saleData.customerId), {
              currentDebt: nextDebt,
              updatedAt: serverTimestamp(),
            });
          }

          const auditId = generateId('aud');
          tx.set(doc(db, 'audit_logs', auditId), {
            id: auditId,
            storeId: STORE_ID,
            action: 'venta_anulada',
            summary: clampStr(
              `Venta de S/ ${Number(saleData.total || 0).toFixed(2)} (${String(saleData.itemsSummary || '')}) anulada: ${cleanReason}`,
              300
            ),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            role: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof Error && err.message === 'SALE_NOT_FOUND') {
          return { ok: false, error: 'La venta no existe.' };
        }
        if (err instanceof Error && err.message === 'ALREADY_VOIDED') {
          return { ok: false, error: 'Esta venta ya fue anulada.' };
        }
        handleFirestoreError(err, OperationType.UPDATE, `sales/${saleId}`);
      }
    },
    [authUser]
  );

  // --- ADMIN INVENTORY & FINANCE OPERATIONS ---
  const registerStockEntry = useCallback(
    async (params: {
      productId?: string;
      barcode?: string;
      name: string;
      quantity: number;
      unitCost: number;
      salePrice: number;
      expiryDate?: string;
      note?: string;
    }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const qty = Math.max(1, Math.round(params.quantity));
      const unitCost = Number(Math.max(0, params.unitCost).toFixed(2));
      const salePrice = Number(Math.max(0.01, params.salePrice).toFixed(2));
      const cleanName = clampStr(params.name, 120);
      const cleanBarcode = clampStr(params.barcode, 64);
      const cleanExpiry = clampStr(params.expiryDate, 10);
      const cleanNote = clampStr(params.note, 200);

      // Match existing by ID or barcode
      let targetId = params.productId;
      if (!targetId && cleanBarcode) {
        targetId = posProducts.find((p) => p.barcode?.trim() === cleanBarcode)?.id;
      }
      const isNew = !targetId;
      const pid = targetId || generateId('prod');

      try {
        await runTransaction(db, async (tx) => {
          const posRef = doc(db, 'pos_products', pid);
          const metaRef = doc(db, 'inventory_meta', pid);
          const posSnap = await tx.get(posRef);
          const metaSnap = await tx.get(metaRef);

          const prevStock = posSnap.exists() ? Number(posSnap.data().stock || 0) : 0;
          const nextStock = prevStock + qty;

          const posDoc: Record<string, unknown> = {
            id: pid,
            storeId: STORE_ID,
            name: cleanName,
            salePrice,
            stock: nextStock,
            unitLabel: posSnap.exists()
              ? String(posSnap.data().unitLabel || 'und')
              : 'und',
            updatedAt: serverTimestamp(),
          };
          if (cleanBarcode) {
            posDoc.barcode = cleanBarcode;
          }

          const metaDoc: Record<string, unknown> = {
            productId: pid,
            storeId: STORE_ID,
            costPrice: unitCost,
            minStock: metaSnap.exists() ? Number(metaSnap.data().minStock ?? 3) : 3,
            updatedAt: serverTimestamp(),
          };
          if (cleanExpiry) {
            metaDoc.expiryDate = cleanExpiry;
          }

          if (isNew || !posSnap.exists()) {
            tx.set(posRef, posDoc);
          } else {
            tx.set(posRef, posDoc);
          }
          tx.set(metaRef, metaDoc);

          const movId = generateId('mov');
          tx.set(doc(db, 'movements', movId), {
            id: movId,
            storeId: STORE_ID,
            productId: pid,
            productName: cleanName,
            type: 'entrada',
            quantity: qty,
            unitCost,
            totalCost: Number((unitCost * qty).toFixed(2)),
            ...(cleanNote ? { note: cleanNote } : {}),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            actorRole: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `pos_products/${pid}`);
      }
    },
    [authUser, posProducts]
  );

  const registerNonSaleExit = useCallback(
    async (params: {
      productId: string;
      type: 'consumo_propio' | 'merma';
      quantity: number;
      note?: string;
    }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const qty = Math.max(1, Math.round(params.quantity));
      const cleanNote = clampStr(params.note, 200);

      try {
        await runTransaction(db, async (tx) => {
          const posRef = doc(db, 'pos_products', params.productId);
          const metaRef = doc(db, 'inventory_meta', params.productId);
          const posSnap = await tx.get(posRef);
          const metaSnap = await tx.get(metaRef);
          if (!posSnap.exists()) throw new Error('PRODUCT_NOT_FOUND');

          const prevStock = Number(posSnap.data().stock || 0);
          const nextStock = Math.max(0, prevStock - qty);
          const unitCost = metaSnap.exists() ? Number(metaSnap.data().costPrice || 0) : 0;
          const productName = String(posSnap.data().name || 'Producto');

          tx.update(posRef, {
            stock: nextStock,
            updatedAt: serverTimestamp(),
          });

          const movId = generateId('mov');
          tx.set(doc(db, 'movements', movId), {
            id: movId,
            storeId: STORE_ID,
            productId: params.productId,
            productName,
            type: params.type,
            quantity: qty,
            unitCost,
            totalCost: Number((unitCost * qty).toFixed(2)),
            ...(cleanNote ? { note: cleanNote } : {}),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            actorRole: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `pos_products/${params.productId}`);
      }
    },
    [authUser]
  );

  // --- ADMIN CUSTOMER & CREDIT OPERATIONS ---
  const createCustomer = useCallback(
    async (
      name: string,
      phone?: string,
      note?: string,
      creditLimit?: number
    ): Promise<Customer | null> => {
      if (!authUser || authUser.role !== 'admin') return null;
      const cid = generateId('cust');
      const cleanName = clampStr(name, 100);
      const cleanPhone = clampStr(phone, 32);
      const cleanNote = clampStr(note, 200);
      if (!cleanName) return null;

      try {
        const batch = writeBatch(db);
        const posDoc: Record<string, unknown> = {
          id: cid,
          storeId: STORE_ID,
          name: cleanName,
          currentDebt: 0,
          updatedAt: serverTimestamp(),
        };
        if (typeof creditLimit === 'number' && creditLimit > 0) {
          posDoc.creditLimit = Number(creditLimit.toFixed(2));
        }

        batch.set(doc(db, 'pos_customers', cid), posDoc);
        batch.set(doc(db, 'customers_private', cid), {
          customerId: cid,
          storeId: STORE_ID,
          name: cleanName,
          ...(cleanPhone ? { phone: cleanPhone } : {}),
          ...(cleanNote ? { note: cleanNote } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();

        return {
          id: cid,
          name: cleanName,
          phone: cleanPhone || undefined,
          note: cleanNote || undefined,
          creditLimit: typeof creditLimit === 'number' && creditLimit > 0 ? creditLimit : undefined,
          currentDebt: 0,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `pos_customers/${cid}`);
      }
    },
    [authUser]
  );

  const updateCustomer = useCallback(
    async (
      customerId: string,
      updates: { creditLimit?: number | null; phone?: string; note?: string }
    ): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      try {
        const privRef = doc(db, 'customers_private', customerId);
        const privSnap =
          updates.phone !== undefined || updates.note !== undefined ? await getDoc(privRef) : null;

        const batch = writeBatch(db);
        if (updates.creditLimit !== undefined) {
          batch.update(doc(db, 'pos_customers', customerId), {
            creditLimit:
              updates.creditLimit !== null && updates.creditLimit > 0
                ? Number(updates.creditLimit.toFixed(2))
                : deleteField(),
            updatedAt: serverTimestamp(),
          });
        }
        if (updates.phone !== undefined || updates.note !== undefined) {
          const existingPriv = customerPrivateMap[customerId];
          const existingPos = posCustomers.find((c) => c.id === customerId);
          const cleanPhone = clampStr(updates.phone ?? existingPriv?.phone, 32);
          const cleanNote = clampStr(updates.note ?? existingPriv?.note, 200);
          const cleanName = existingPos?.name || existingPriv?.name || 'Cliente';

          if (privSnap && privSnap.exists()) {
            batch.update(privRef, {
              name: cleanName,
              phone: cleanPhone ? cleanPhone : deleteField(),
              note: cleanNote ? cleanNote : deleteField(),
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(privRef, {
              customerId,
              storeId: STORE_ID,
              name: cleanName,
              ...(cleanPhone ? { phone: cleanPhone } : {}),
              ...(cleanNote ? { note: cleanNote } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `pos_customers/${customerId}`);
      }
    },
    [authUser, customerPrivateMap, posCustomers]
  );

  const registerCustomerPayment = useCallback(
    async (params: {
      customerId: string;
      amount: number;
      method: CashMethod;
      note?: string;
    }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const amount = Number(params.amount.toFixed(2));
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const payId = generateId('pay');
      const cleanNote = clampStr(params.note, 200);

      try {
        await runTransaction(db, async (tx) => {
          const custRef = doc(db, 'pos_customers', params.customerId);
          const custSnap = await tx.get(custRef);
          if (!custSnap.exists()) throw new Error('CUSTOMER_NOT_FOUND');
          const prevDebt = Number(custSnap.data().currentDebt || 0);
          const nextDebt = Number(Math.max(0, prevDebt - amount).toFixed(2));

          tx.update(custRef, {
            currentDebt: nextDebt,
            updatedAt: serverTimestamp(),
          });

          tx.set(doc(db, 'credit_payments', payId), {
            id: payId,
            storeId: STORE_ID,
            customerId: params.customerId,
            amount,
            method: params.method,
            ...(cleanNote ? { note: cleanNote } : {}),
            recordedByUid: authUser.uid,
            recordedByEmail: authUser.email,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `credit_payments/${payId}`);
      }
    },
    [authUser]
  );

  // --- ADMIN EXPENSES & QUICK BUTTONS ---
  const addExpense = useCallback(
    async (params: {
      description: string;
      category: string;
      amount: number;
      method: CashMethod;
    }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const expId = generateId('exp');
      try {
        await setDoc(doc(db, 'expenses', expId), {
          id: expId,
          storeId: STORE_ID,
          description: clampStr(params.description, 160),
          category: clampStr(params.category, 60),
          amount: Number(params.amount.toFixed(2)),
          method: params.method,
          recordedByUid: authUser.uid,
          recordedByEmail: authUser.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `expenses/${expId}`);
      }
    },
    [authUser]
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      try {
        await deleteDoc(doc(db, 'expenses', id));
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `expenses/${id}`);
      }
    },
    [authUser]
  );

  const addSupplierReceipt = useCallback(
    async (params: {
      supplierName: string;
      amount: number;
      deliveredAt: string;
      note?: string;
      attachmentDataUrl?: string;
      attachmentName?: string;
      attachmentMime?: ReceiptAttachmentMime;
    }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const supplierName = clampStr(params.supplierName, 120);
      const amount = Number(params.amount.toFixed(2));
      const deliveredAt = clampStr(params.deliveredAt, 40);
      if (!supplierName || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !deliveredAt) {
        return false;
      }

      const cleanNote = clampStr(params.note, 240);
      const cleanAttUrl = params.attachmentDataUrl?.trim();
      if (
        cleanAttUrl &&
        (cleanAttUrl.length < 30 ||
          cleanAttUrl.length > RECEIPT_ATTACHMENT_MAX_LENGTH ||
          !RECEIPT_ATTACHMENT_REGEX.test(cleanAttUrl))
      ) {
        return false;
      }

      const rid = generateId('bol');
      try {
        await setDoc(doc(db, 'supplier_receipts', rid), {
          id: rid,
          storeId: STORE_ID,
          supplierName,
          amount,
          deliveredAt,
          ...(cleanNote ? { note: cleanNote } : {}),
          ...(cleanAttUrl
            ? {
                attachmentDataUrl: cleanAttUrl,
                ...(params.attachmentName
                  ? { attachmentName: clampStr(params.attachmentName, 120) }
                  : {}),
                ...(params.attachmentMime ? { attachmentMime: params.attachmentMime } : {}),
              }
            : {}),
          recordedByUid: authUser.uid,
          recordedByEmail: clampStr(authUser.email, 120),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `supplier_receipts/${rid}`);
      }
    },
    [authUser]
  );

  const deleteSupplierReceipt = useCallback(
    async (id: string): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      try {
        await deleteDoc(doc(db, 'supplier_receipts', id));
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `supplier_receipts/${id}`);
      }
    },
    [authUser]
  );

  const addQuickButton = useCallback(
    async (params: { name: string; price: number; costPrice: number }): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const bid = generateId('qb');
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'quick_buttons', bid), {
          id: bid,
          storeId: STORE_ID,
          name: clampStr(params.name, 80),
          price: Number(Math.max(0.01, params.price).toFixed(2)),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'quick_button_costs', bid), {
          buttonId: bid,
          storeId: STORE_ID,
          costPrice: Number(Math.max(0, params.costPrice).toFixed(2)),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `quick_buttons/${bid}`);
      }
    },
    [authUser]
  );

  const deleteQuickButton = useCallback(
    async (id: string): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'quick_buttons', id));
        batch.delete(doc(db, 'quick_button_costs', id));
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `quick_buttons/${id}`);
      }
    },
    [authUser]
  );

  // --- ADMIN MULTI-PHONE TEAM ACCESS MANAGEMENT ---
  const inviteStaffEmail = useCallback(
    async (email: string, role: UserRole): Promise<{ ok: boolean; error?: string }> => {
      if (!authUser || authUser.role !== 'admin') {
        return { ok: false, error: 'Solo el Administrador puede habilitar usuarios.' };
      }
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail.includes('@') || cleanEmail.length < 5) {
        return { ok: false, error: 'Ingresa un correo Google válido.' };
      }
      if (cleanEmail === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
        return {
          ok: false,
          error: 'Ese correo ya es el Administrador principal y está protegido.',
        };
      }
      if (cleanEmail === authUser.email.toLowerCase()) {
        return { ok: false, error: 'No puedes modificar tu propio acceso desde aquí.' };
      }
      const key = safeEmailKey(cleanEmail);
      const inviteRef = doc(db, 'staff_invites', key);
      const existingMember = staffMembers.find(
        (m) => m.email.trim().toLowerCase() === cleanEmail
      );
      const roleLabel = role === 'admin' ? 'Administrador' : 'Vendedor';
      try {
        await runTransaction(db, async (tx) => {
          const inviteSnap = await tx.get(inviteRef);
          const memberRef = existingMember ? doc(db, 'staff_members', existingMember.uid) : null;
          const adminRef = existingMember ? doc(db, 'admins', existingMember.uid) : null;
          const memberSnap = memberRef ? await tx.get(memberRef) : null;
          const adminSnap = adminRef ? await tx.get(adminRef) : null;

          if (inviteSnap.exists()) {
            tx.update(inviteRef, {
              role,
              active: true,
              invitedByUid: authUser.uid,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(inviteRef, {
              id: key,
              email: clampStr(cleanEmail, 120),
              role,
              active: true,
              invitedByUid: authUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          if (existingMember && memberRef && memberSnap?.exists()) {
            tx.update(memberRef, {
              role,
              active: true,
              updatedAt: serverTimestamp(),
            });
            if (role === 'admin' && adminRef && adminSnap && !adminSnap.exists()) {
              tx.set(adminRef, {
                uid: existingMember.uid,
                email: clampStr(existingMember.email, 120),
                displayName: clampStr(existingMember.displayName, 100),
                createdAt: serverTimestamp(),
              });
            } else if (role === 'vendedor' && adminRef && adminSnap?.exists()) {
              tx.delete(adminRef);
            }
          }

          const auditId = generateId('aud');
          tx.set(doc(db, 'audit_logs', auditId), {
            id: auditId,
            storeId: STORE_ID,
            action: 'acceso_equipo',
            summary: clampStr(
              `Usuario habilitado: ${cleanEmail} con rol ${roleLabel}`,
              300
            ),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            role: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return { ok: true };
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `staff_invites/${key}`);
      }
    },
    [authUser, staffMembers]
  );

  const changeStaffInviteRole = useCallback(
    async (invite: StaffInvite, newRole: UserRole): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const cleanEmail = invite.email.trim().toLowerCase();
      if (cleanEmail === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) return false;
      const matchingMember = staffMembers.find(
        (m) => m.email.trim().toLowerCase() === cleanEmail
      );
      if (matchingMember && matchingMember.uid === authUser.uid) return false;

      const prevLabel = invite.role === 'admin' ? 'Administrador' : 'Vendedor';
      const nextLabel = newRole === 'admin' ? 'Administrador' : 'Vendedor';
      try {
        await runTransaction(db, async (tx) => {
          const inviteRef = doc(db, 'staff_invites', invite.id);
          const inviteSnap = await tx.get(inviteRef);
          const memberRef = matchingMember ? doc(db, 'staff_members', matchingMember.uid) : null;
          const adminRef = matchingMember ? doc(db, 'admins', matchingMember.uid) : null;
          const memberSnap = memberRef ? await tx.get(memberRef) : null;
          const adminSnap = adminRef ? await tx.get(adminRef) : null;

          if (inviteSnap.exists()) {
            tx.update(inviteRef, {
              role: newRole,
              updatedAt: serverTimestamp(),
            });
          }

          if (matchingMember && memberRef && memberSnap?.exists()) {
            tx.update(memberRef, {
              role: newRole,
              updatedAt: serverTimestamp(),
            });
            if (newRole === 'admin' && adminRef && adminSnap && !adminSnap.exists()) {
              tx.set(adminRef, {
                uid: matchingMember.uid,
                email: clampStr(matchingMember.email, 120),
                displayName: clampStr(matchingMember.displayName, 100),
                createdAt: serverTimestamp(),
              });
            } else if (newRole === 'vendedor' && adminRef && adminSnap?.exists()) {
              tx.delete(adminRef);
            }
          }

          const auditId = generateId('aud');
          tx.set(doc(db, 'audit_logs', auditId), {
            id: auditId,
            storeId: STORE_ID,
            action: 'acceso_equipo',
            summary: clampStr(
              `Cambio de rol: ${invite.email} de ${prevLabel} a ${nextLabel}`,
              300
            ),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            role: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `staff_invites/${invite.id}`);
      }
    },
    [authUser, staffMembers]
  );

  const changeStaffMemberRole = useCallback(
    async (member: StaffMember, newRole: UserRole): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      if (
        member.uid === authUser.uid ||
        member.email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
      ) {
        return false;
      }
      const prevLabel = member.role === 'admin' ? 'Administrador' : 'Vendedor';
      const nextLabel = newRole === 'admin' ? 'Administrador' : 'Vendedor';
      const inviteKey = safeEmailKey(member.email);
      try {
        await runTransaction(db, async (tx) => {
          const staffRef = doc(db, 'staff_members', member.uid);
          const adminRef = doc(db, 'admins', member.uid);
          const inviteRef = inviteKey ? doc(db, 'staff_invites', inviteKey) : null;

          const staffSnap = await tx.get(staffRef);
          const adminSnap = await tx.get(adminRef);
          const inviteSnap = inviteRef ? await tx.get(inviteRef) : null;

          if (!staffSnap.exists()) {
            throw new Error('STAFF_NOT_FOUND');
          }

          tx.update(staffRef, {
            role: newRole,
            updatedAt: serverTimestamp(),
          });

          if (newRole === 'admin' && !adminSnap.exists()) {
            tx.set(adminRef, {
              uid: member.uid,
              email: clampStr(member.email, 120),
              displayName: clampStr(member.displayName, 100),
              createdAt: serverTimestamp(),
            });
          } else if (newRole === 'vendedor' && adminSnap.exists()) {
            tx.delete(adminRef);
          }

          if (inviteRef && inviteSnap?.exists()) {
            tx.update(inviteRef, {
              role: newRole,
              updatedAt: serverTimestamp(),
            });
          }

          const auditId = generateId('aud');
          tx.set(doc(db, 'audit_logs', auditId), {
            id: auditId,
            storeId: STORE_ID,
            action: 'acceso_equipo',
            summary: clampStr(
              `Cambio de rol: ${member.email} de ${prevLabel} a ${nextLabel}`,
              300
            ),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            role: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `staff_members/${member.uid}`);
      }
    },
    [authUser]
  );

  const removeStaffInvite = useCallback(
    async (invite: StaffInvite): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      if (invite.email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) return false;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'staff_invites', invite.id));
        const auditId = generateId('aud');
        batch.set(doc(db, 'audit_logs', auditId), {
          id: auditId,
          storeId: STORE_ID,
          action: 'acceso_equipo',
          summary: clampStr(`Acceso pre-autorizado eliminado: ${invite.email}`, 300),
          actorUid: authUser.uid,
          actorEmail: authUser.email,
          role: authUser.role,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `staff_invites/${invite.id}`);
      }
    },
    [authUser]
  );

  const approveAccessRequest = useCallback(
    async (req: AccessRequest, role: UserRole): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const roleLabel = role === 'admin' ? 'Administrador' : 'Vendedor';
      try {
        await runTransaction(db, async (tx) => {
          const staffRef = doc(db, 'staff_members', req.uid);
          const adminRef = doc(db, 'admins', req.uid);
          const reqRef = doc(db, 'access_requests', req.uid);

          const staffSnap = await tx.get(staffRef);
          const adminSnap = role === 'admin' ? await tx.get(adminRef) : null;

          if (staffSnap.exists()) {
            tx.update(staffRef, {
              email: clampStr(req.email, 120),
              displayName: clampStr(req.displayName, 100),
              role,
              active: true,
              approvedByUid: authUser.uid,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(staffRef, {
              uid: req.uid,
              email: clampStr(req.email, 120),
              displayName: clampStr(req.displayName, 100),
              role,
              active: true,
              approvedByUid: authUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          if (role === 'admin' && adminSnap && !adminSnap.exists()) {
            tx.set(adminRef, {
              uid: req.uid,
              email: clampStr(req.email, 120),
              displayName: clampStr(req.displayName, 100),
              createdAt: serverTimestamp(),
            });
          }

          tx.delete(reqRef);

          const auditId = generateId('aud');
          tx.set(doc(db, 'audit_logs', auditId), {
            id: auditId,
            storeId: STORE_ID,
            action: 'acceso_equipo',
            summary: clampStr(`Usuario habilitado: ${req.email} como ${roleLabel}`, 300),
            actorUid: authUser.uid,
            actorEmail: authUser.email,
            role: authUser.role,
            createdAt: serverTimestamp(),
          });
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `staff_members/${req.uid}`);
      }
    },
    [authUser]
  );

  const rejectAccessRequest = useCallback(
    async (uid: string): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      try {
        await deleteDoc(doc(db, 'access_requests', uid));
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `access_requests/${uid}`);
      }
    },
    [authUser]
  );

  const toggleStaffActive = useCallback(
    async (member: StaffMember): Promise<boolean> => {
      if (
        !authUser ||
        authUser.role !== 'admin' ||
        member.uid === authUser.uid ||
        member.email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
      ) {
        return false;
      }
      const nextActive = !member.active;
      try {
        const batch = writeBatch(db);
        // Partial update ONLY: preserves server-stored createdAt precision required by firestore.rules
        batch.update(doc(db, 'staff_members', member.uid), {
          active: nextActive,
          updatedAt: serverTimestamp(),
        });
        const auditId = generateId('aud');
        batch.set(doc(db, 'audit_logs', auditId), {
          id: auditId,
          storeId: STORE_ID,
          action: 'acceso_equipo',
          summary: clampStr(
            `Celular ${nextActive ? 'reactivado' : 'pausado'}: ${member.email}`,
            300
          ),
          actorUid: authUser.uid,
          actorEmail: authUser.email,
          role: authUser.role,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `staff_members/${member.uid}`);
      }
    },
    [authUser]
  );

  const removeStaffMember = useCallback(
    async (member: StaffMember): Promise<boolean> => {
      if (
        !authUser ||
        authUser.role !== 'admin' ||
        member.uid === authUser.uid ||
        member.email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
      ) {
        return false;
      }
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'staff_members', member.uid));
        if (member.role === 'admin') {
          batch.delete(doc(db, 'admins', member.uid));
        }
        const inviteKey = safeEmailKey(member.email);
        if (inviteKey) {
          batch.delete(doc(db, 'staff_invites', inviteKey));
        }
        batch.delete(doc(db, 'access_requests', member.uid));
        const auditId = generateId('aud');
        batch.set(doc(db, 'audit_logs', auditId), {
          id: auditId,
          storeId: STORE_ID,
          action: 'acceso_equipo',
          summary: clampStr(`Acceso eliminado: ${member.email}`, 300),
          actorUid: authUser.uid,
          actorEmail: authUser.email,
          role: authUser.role,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `staff_members/${member.uid}`);
      }
    },
    [authUser]
  );

  const saveYapeQr = useCallback(
    async (dataUrl: string): Promise<boolean> => {
      if (!authUser || authUser.role !== 'admin') return false;
      const cleanUrl = dataUrl.trim();
      if (
        cleanUrl.length < 30 ||
        cleanUrl.length > YAPE_QR_MAX_LENGTH ||
        !YAPE_QR_DATA_URL_REGEX.test(cleanUrl)
      ) {
        return false;
      }

      const path = `store_settings/${STORE_ID}`;
      try {
        await setDoc(doc(db, 'store_settings', STORE_ID), {
          id: STORE_ID,
          storeId: STORE_ID,
          yapeQrDataUrl: cleanUrl,
          updatedByUid: authUser.uid,
          updatedByEmail: clampStr(authUser.email, 120),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [authUser]
  );

  const removeYapeQr = useCallback(async (): Promise<boolean> => {
    if (!authUser || authUser.role !== 'admin') return false;
    const path = `store_settings/${STORE_ID}`;
    try {
      await deleteDoc(doc(db, 'store_settings', STORE_ID));
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }, [authUser]);

  // --- ADMIN COMPUTED METRICS ---
  const getCustomerBalance = useCallback(
    (customerId: string): { totalFiado: number; totalAbonado: number; saldo: number } => {
      const totalFiado = adminState.sales
        .filter((s) => !s.voided && s.paymentMethod === 'fiado' && s.customerId === customerId)
        .reduce((sum, s) => sum + s.total, 0);
      const totalAbonado = adminState.creditPayments
        .filter((p) => p.customerId === customerId)
        .reduce((sum, p) => sum + p.amount, 0);
      return {
        totalFiado: Number(totalFiado.toFixed(2)),
        totalAbonado: Number(totalAbonado.toFixed(2)),
        saldo: Number(Math.max(0, totalFiado - totalAbonado).toFixed(2)),
      };
    },
    [adminState.sales, adminState.creditPayments]
  );

  const getFinancialSummary = useCallback(
    (period: 'today' | 'all'): FinancialSummary => {
      const activeSales = adminState.sales.filter((s) => !s.voided);
      const salesFiltered =
        period === 'today' ? activeSales.filter((s) => isToday(s.createdAt)) : activeSales;
      const paymentsFiltered =
        period === 'today'
          ? adminState.creditPayments.filter((p) => isToday(p.createdAt))
          : adminState.creditPayments;
      const movementsFiltered =
        period === 'today'
          ? adminState.movements.filter((m) => isToday(m.createdAt))
          : adminState.movements;
      const expensesFiltered =
        period === 'today'
          ? adminState.expenses.filter((e) => isToday(e.createdAt))
          : adminState.expenses;

      const efectivoVentas = salesFiltered
        .filter((s) => s.paymentMethod === 'efectivo')
        .reduce((sum, s) => sum + s.total, 0);
      const yapeVentas = salesFiltered
        .filter((s) => s.paymentMethod === 'yape')
        .reduce((sum, s) => sum + s.total, 0);
      const ventasFiadas = salesFiltered
        .filter((s) => s.paymentMethod === 'fiado')
        .reduce((sum, s) => sum + s.total, 0);

      const efectivoAbonos = paymentsFiltered
        .filter((p) => p.method === 'efectivo')
        .reduce((sum, p) => sum + p.amount, 0);
      const yapeAbonos = paymentsFiltered
        .filter((p) => p.method === 'yape')
        .reduce((sum, p) => sum + p.amount, 0);

      const gastosEfectivo = expensesFiltered
        .filter((e) => e.method === 'efectivo')
        .reduce((sum, e) => sum + e.amount, 0);
      const gastosYape = expensesFiltered
        .filter((e) => e.method === 'yape')
        .reduce((sum, e) => sum + e.amount, 0);
      const totalGastos = gastosEfectivo + gastosYape;

      const totalCobradoEfectivo = efectivoVentas + efectivoAbonos;
      const totalCobradoYape = yapeVentas + yapeAbonos;
      const totalCobrado = totalCobradoEfectivo + totalCobradoYape;
      const cajaNetaDespuesGastos = totalCobrado - totalGastos;
      const totalVendido = efectivoVentas + yapeVentas + ventasFiadas;

      const costoMercaderiaVendida = salesFiltered.reduce((sum, s) => sum + s.totalCost, 0);
      const costoSalidasSinVenta = movementsFiltered
        .filter((m) => m.type === 'consumo_propio' || m.type === 'merma')
        .reduce((sum, m) => sum + m.totalCost, 0);

      const gananciaBruta = totalVendido - costoMercaderiaVendida;
      const gananciaNetaEstimada = gananciaBruta - costoSalidasSinVenta - totalGastos;

      const totalFiadoPorCobrar = adminState.customers.reduce(
        (sum, c) => sum + getCustomerBalance(c.id).saldo,
        0
      );

      const valorInventarioCosto = adminState.products.reduce(
        (sum, p) => sum + Math.max(0, p.stock) * p.costPrice,
        0
      );
      const valorInventarioVenta = adminState.products.reduce(
        (sum, p) => sum + Math.max(0, p.stock) * p.salePrice,
        0
      );

      return {
        efectivoVentas: Number(efectivoVentas.toFixed(2)),
        yapeVentas: Number(yapeVentas.toFixed(2)),
        efectivoAbonos: Number(efectivoAbonos.toFixed(2)),
        yapeAbonos: Number(yapeAbonos.toFixed(2)),
        gastosEfectivo: Number(gastosEfectivo.toFixed(2)),
        gastosYape: Number(gastosYape.toFixed(2)),
        totalGastos: Number(totalGastos.toFixed(2)),
        totalCobradoEfectivo: Number(totalCobradoEfectivo.toFixed(2)),
        totalCobradoYape: Number(totalCobradoYape.toFixed(2)),
        totalCobrado: Number(totalCobrado.toFixed(2)),
        cajaNetaDespuesGastos: Number(cajaNetaDespuesGastos.toFixed(2)),
        ventasFiadas: Number(ventasFiadas.toFixed(2)),
        totalVendido: Number(totalVendido.toFixed(2)),
        costoMercaderiaVendida: Number(costoMercaderiaVendida.toFixed(2)),
        costoSalidasSinVenta: Number(costoSalidasSinVenta.toFixed(2)),
        gananciaBruta: Number(gananciaBruta.toFixed(2)),
        gananciaNetaEstimada: Number(gananciaNetaEstimada.toFixed(2)),
        totalFiadoPorCobrar: Number(totalFiadoPorCobrar.toFixed(2)),
        valorInventarioCosto: Number(valorInventarioCosto.toFixed(2)),
        valorInventarioVenta: Number(valorInventarioVenta.toFixed(2)),
      };
    },
    [
      adminState.sales,
      adminState.creditPayments,
      adminState.movements,
      adminState.expenses,
      adminState.customers,
      adminState.products,
      getCustomerBalance,
    ]
  );

  const lowStockCount = useMemo(
    () => adminState.products.filter((p) => p.stock <= p.minStock).length,
    [adminState.products]
  );

  const expiringSoonCount = useMemo(
    () =>
      adminState.products.filter((p) => {
        const d = daysUntilExpiry(p.expiryDate);
        return d !== null && d <= 15;
      }).length,
    [adminState.products]
  );

  const totalDebtorsCount = useMemo(
    () => adminState.customers.filter((c) => getCustomerBalance(c.id).saldo > 0).length,
    [adminState.customers, getCustomerBalance]
  );

  return {
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
    state: adminState,
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
    addExpense,
    deleteExpense,
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
  };
}
