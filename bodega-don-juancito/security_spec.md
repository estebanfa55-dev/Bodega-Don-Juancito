# Especificación de Seguridad (Phase 0 TDD) — Bodega al Día

## 1. Invariantes de Datos y Acceso (RBAC + Aislamiento de Costos/PII)
1. **Identidad Verificada Obligatoria**: Toda operación de lectura o escritura requiere `request.auth != null && request.auth.token.email_verified == true`.
2. **Administrador Principal (Bootstrap)**: El correo `estebanfa005@gmail.com` (verificado) posee privilegios de Administrador para configurar accesos, aprobar otros celulares, ver costos, ganancias, libreta completa de fiados y auditoría.
3. **Aislamiento Estricto del Rol Vendedor**:
   - Un Vendedor activo en `/staff_members/{uid}` solo puede leer `/pos_products`, `/pos_customers` (sin teléfono/notas), `/quick_buttons`, `/unlisted_suggestions`, y únicamente las ventas `/sales` que él mismo registró (`recordedByUid == request.auth.uid`).
   - Un Vendedor **NO** puede leer ni escribir `/inventory_meta` (costos de compra, vencimientos), `/customers_private` (teléfonos/notas), `/credit_payments`, `/expenses`, `/quick_button_costs`, `/unlisted_costs`, `/movements` (lectura) ni `/audit_logs` (lectura).
4. **Inmutabilidad y Bloqueo de Estado Terminal**:
   - Una venta creada debe iniciar con `voided == false`, `recordedByUid == request.auth.uid`, `createdAt == request.time`, `updatedAt == request.time`.
   - Un Vendedor solo puede actualizar su propia venta para transicionar `voided: false -> true` actualizando únicamente `['voided', 'voidedAt', 'voidedByUid', 'voidedByEmail', 'voidedByRole', 'voidReason', 'updatedAt']`; una vez `voided == true`, no puede volver a modificarla.
5. **Integridad Relacional y Tamaño de Cargas**:
   - Todos los IDs de ruta cumplen `^[a-zA-Z0-9_-]+$` y `<= 128` caracteres.
   - Todas las cadenas y arreglos (`items` en `sales`, máx. 50 elementos) tienen límites explícitos de longitud y tipos validados en funciones `isValid[Entity]()`.
   - Ningún usuario puede auto-asignarse `role: 'admin'` en `/admins`, `/staff_members`, `/staff_invites` o `/access_requests`.

## 2. The "Dirty Dozen" Adversarial Payloads (Deben devolver `PERMISSION_DENIED`)

1. **Unverified Email Spoof**: Usuario con `email: "estebanfa005@gmail.com"` pero `email_verified: false` intenta leer `/inventory_meta/prod_1`.
2. **Self-Privilege Escalation (Staff Member)**: Vendedor (`uid: "vend_1"`) intenta escribir `/staff_members/vend_1` con `{ role: "admin", active: true }`.
3. **Access Request Role Injection (Shadow Field)**: Usuario nuevo intenta crear `/access_requests/user_2` incluyendo campo fantasma `{ status: "pending", role: "admin" }`.
4. **Vendedor Reading Purchase Costs**: Vendedor intenta hacer `get` o `list` sobre `/inventory_meta`.
5. **Vendedor Reading Customer PII**: Vendedor intenta hacer `get` o `list` sobre `/customers_private`.
6. **Vendedor Scraping Store Sales**: Vendedor intenta hacer `list` en `/sales` sin filtro `recordedByUid == "vend_1"` (o intenta leer venta de otro vendedor).
7. **Vendedor Tampering With Sale Price/Total on Void**: Vendedor intenta actualizar su venta cambiando `total: 0.10` junto con `voided: true`.
8. **Double-Void / Un-Voiding Terminal Sale**: Vendedor intenta actualizar una venta que ya tiene `voided: true` para revertirla a `voided: false`.
9. **Identity Spoofing on Sale Create**: Vendedor (`uid: "vend_1"`) intenta crear `/sales/sale_99` con `recordedByUid: "admin_1"`.
10. **Client Timestamp Forgery**: Usuario intenta crear `/sales/sale_100` con `createdAt` distinto de `request.time`.
11. **Path ID Poisoning (1.5KB ID)**: Usuario intenta crear `/pos_products/${"a".repeat(300)}` con un ID fuera del límite.
12. **Vendedor Deleting Expenses or Credit Payments**: Vendedor intenta leer/crear/eliminar documentos en `/expenses` o `/credit_payments`.
