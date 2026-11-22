export type UserRole = 'admin' | 'vendedor';

export interface AuthUser {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
}

export interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  approvedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffInvite {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  invitedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessRequest {
  uid: string;
  email: string;
  displayName: string;
  status: 'pending';
  createdAt: string;
  updatedAt: string;
}

export type AuthGateStatus =
  | 'initializing'
  | 'signed_out'
  | 'unverified_email'
  | 'pending_approval'
  | 'authorized';

export type PaymentMethod = 'efectivo' | 'yape' | 'fiado';

export type CashMethod = 'efectivo' | 'yape';

export type InventoryMovementType =
  | 'entrada'
  | 'venta'
  | 'consumo_propio'
  | 'merma'
  | 'anulacion';

export interface Product {
  id: string;
  barcode?: string;
  name: string;
  salePrice: number;
  costPrice: number;
  stock: number;
  minStock: number;
  unitLabel?: string;
  expiryDate?: string;
  updatedAt: string;
}

/** Sanitized product view for POS (Vendedor never sees costPrice, minStock, or expiryDate) */
export interface PosProduct {
  id: string;
  barcode?: string;
  name: string;
  salePrice: number;
  stock: number;
  unitLabel?: string;
  updatedAt: string;
}

/** Sanitized customer view for POS (no phone/notes PII) */
export interface PosCustomer {
  id: string;
  name: string;
  creditLimit?: number;
  currentDebt: number;
  updatedAt: string;
}

/** Sanitized suggestion for unlisted items in POS */
export interface PosSuggestion {
  id: string;
  name: string;
  lastPrice: number;
  usageCount: number;
}

/** Configurable 1-tap quick sale button for unlisted frequent items */
export interface QuickButton {
  id: string;
  name: string;
  price: number;
  costPrice: number;
}

/** Sanitized quick button for POS */
export interface PosQuickButton {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  id: string;
  productId?: string;
  barcode?: string;
  name: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  isUnlisted: boolean;
}

export interface SaleItem {
  productId?: string;
  barcode?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  subtotal: number;
  isUnlisted: boolean;
}

export interface Sale {
  id: string;
  clientTxId: string;
  createdAt: string;
  updatedAt: string;
  items: SaleItem[];
  itemsSummary: string;
  itemCount: number;
  total: number;
  totalCost: number;
  paymentMethod: PaymentMethod;
  customerId?: string;
  customerName?: string;
  recordedByUid: string;
  recordedByEmail: string;
  recordedByRole: UserRole;
  voided: boolean;
  voidedAt?: string;
  voidedByUid?: string;
  voidedByEmail?: string;
  voidedByRole?: UserRole;
  voidReason?: string;
  hasPendingWrites?: boolean;
}

export interface PosRecentSale {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod: PaymentMethod;
  customerName?: string;
  itemCount: number;
  itemsSummary: string;
  voided: boolean;
  hasPendingWrites?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  note?: string;
  creditLimit?: number;
  currentDebt: number;
  createdAt: string;
}

export interface CreditPayment {
  id: string;
  customerId: string;
  amount: number;
  method: CashMethod;
  createdAt: string;
  note?: string;
  recordedByEmail?: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  type: InventoryMovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  note?: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole;
  createdAt: string;
}

export interface UnlistedSuggestion {
  id: string;
  name: string;
  lastPrice: number;
  lastCost: number;
  usageCount: number;
  updatedAt: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  method: CashMethod;
  recordedByEmail?: string;
  createdAt: string;
}

export interface SupplierReceipt {
  id: string;
  supplierName: string;
  amount: number;
  deliveredAt: string;
  note?: string;
  attachmentDataUrl?: string;
  attachmentName?: string;
  attachmentMime?: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
  recordedByEmail?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: 'venta_anulada' | 'limite_fiado_superado' | 'acceso_equipo';
  summary: string;
  actorUid: string;
  actorEmail: string;
  role: UserRole;
  createdAt: string;
}

export interface BodegaState {
  products: Product[];
  sales: Sale[];
  customers: Customer[];
  creditPayments: CreditPayment[];
  movements: InventoryMovement[];
  unlistedSuggestions: UnlistedSuggestion[];
  quickButtons: QuickButton[];
  expenses: Expense[];
  supplierReceipts: SupplierReceipt[];
  auditLogs: AuditLog[];
}
