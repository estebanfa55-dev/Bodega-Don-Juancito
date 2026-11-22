/**
 * Phase 0: Payload-First Security TDD Spec & Verification Matrix
 * Documents the 12 adversarial payloads ("Dirty Dozen") and verifies each
 * against the compiled Firestore Security Rules contract.
 */

export interface AdversarialPayloadCase {
  id: number;
  name: string;
  actor: {
    uid: string;
    email: string;
    emailVerified: boolean;
    role: 'admin' | 'vendedor' | 'anonymous';
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  blockingRule: string;
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoof (admin email with email_verified=false)',
    actor: {
      uid: 'spoof_uid',
      email: 'estebanfa005@gmail.com',
      emailVerified: false,
      role: 'anonymous',
    },
    operation: 'get',
    path: '/inventory_meta/prod_1',
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'isVerified() requires request.auth.token.email_verified == true',
  },
  {
    id: 2,
    name: 'Self-Privilege Escalation on /staff_members/{uid}',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'create',
    path: '/staff_members/vend_1',
    payload: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      displayName: 'Cajero',
      role: 'admin',
      active: true,
      approvedByUid: 'vend_1',
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'Non-admin staff create requires incoming().role == "vendedor" + valid staff_invites',
  },
  {
    id: 3,
    name: 'Access Request Ghost Field / Role Injection',
    actor: {
      uid: 'new_phone',
      email: 'nuevo@gmail.com',
      emailVerified: true,
      role: 'anonymous',
    },
    operation: 'create',
    path: '/access_requests/new_phone',
    payload: {
      uid: 'new_phone',
      email: 'nuevo@gmail.com',
      displayName: 'Celular 3',
      status: 'pending',
      role: 'admin',
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'isValidAccessRequest enforces keys().hasOnly([uid,email,displayName,status,createdAt,updatedAt])',
  },
  {
    id: 4,
    name: 'Vendedor Reading Purchase Costs (/inventory_meta)',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'list',
    path: '/inventory_meta',
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'allow list on /inventory_meta requires isAdmin()',
  },
  {
    id: 5,
    name: 'Vendedor Reading Customer PII (/customers_private)',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'get',
    path: '/customers_private/cust_1',
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'allow get on /customers_private requires isAdmin()',
  },
  {
    id: 6,
    name: 'Vendedor Scraping Store Sales Without recordedByUid Filter',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'list',
    path: '/sales',
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'allow list for non-admin requires resource.data.recordedByUid == request.auth.uid',
  },
  {
    id: 7,
    name: 'Vendedor Tampering With Sale Total During Void',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'update',
    path: '/sales/sale_1',
    payload: {
      voided: true,
      total: 0.1,
      voidReason: 'Ajuste',
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'Non-admin sale update affectedKeys().hasOnly([voided,voidedAt,voidedByUid,voidedByEmail,voidedByRole,voidReason,updatedAt])',
  },
  {
    id: 8,
    name: 'Un-Voiding Terminal Sale (voided: true -> false)',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'update',
    path: '/sales/sale_1',
    payload: {
      voided: false,
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'Terminal state lock enforces existing().voided == false && incoming().voided == true',
  },
  {
    id: 9,
    name: 'Identity Spoofing on Sale Create',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'create',
    path: '/sales/sale_99',
    payload: {
      id: 'sale_99',
      storeId: 'bodega_principal',
      recordedByUid: 'admin_uid',
      recordedByRole: 'admin',
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'Sale create enforces incoming().recordedByUid == request.auth.uid',
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery on Sale Create',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'create',
    path: '/sales/sale_100',
    payload: {
      id: 'sale_100',
      createdAt: '2020-01-01T00:00:00.000Z',
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'Sale create enforces incoming().createdAt == request.time && incoming().updatedAt == request.time',
  },
  {
    id: 11,
    name: 'Path Variable ID Poisoning (>128 chars)',
    actor: {
      uid: 'admin_uid',
      email: 'estebanfa005@gmail.com',
      emailVerified: true,
      role: 'admin',
    },
    operation: 'create',
    path: `/pos_products/${'a'.repeat(300)}`,
    payload: {
      id: 'a'.repeat(300),
      storeId: 'bodega_principal',
      name: 'Arroz',
      salePrice: 4.5,
      stock: 10,
    },
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'isValidId(productId) requires id.size() <= 128 && id.matches("^[a-zA-Z0-9_\\\\-]+$")',
  },
  {
    id: 12,
    name: 'Vendedor Deleting or Creating Expenses / Credit Payments',
    actor: {
      uid: 'vend_1',
      email: 'cajero@gmail.com',
      emailVerified: true,
      role: 'vendedor',
    },
    operation: 'delete',
    path: '/expenses/exp_1',
    expectedResult: 'PERMISSION_DENIED',
    blockingRule: 'allow read, write on /expenses and /credit_payments restricted to isAdmin()',
  },
];
