import React from 'react';
import {
  ShieldCheck,
  ShoppingBag,
  AlertCircle,
  Clock,
  CheckCircle2,
  LogOut,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { AuthGateStatus } from '../types/bodega';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginViewProps {
  authGateStatus: AuthGateStatus;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  error: string | null;
  accessRequestSent: boolean;
  onLoginWithGoogle: () => Promise<void>;
  onSubmitAccessRequest: () => Promise<boolean>;
  onRetryCheck: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({
  authGateStatus,
  firebaseUser,
  loading,
  error,
  accessRequestSent,
  onLoginWithGoogle,
  onSubmitAccessRequest,
  onRetryCheck,
  onLogout,
}) => {
  if (authGateStatus === 'initializing') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F8] px-4">
        <div className="text-center space-y-3 flex flex-col items-center">
          <BrandLogo size="lg" />
          <div>
            <p className="text-lg font-bold text-slate-900">Don Juancito</p>
            <p className="text-xs font-semibold text-amber-800">Tienda y Abarrotes</p>
          </div>
          <p className="text-sm text-slate-500">Conectando con la nube de tu tienda...</p>
        </div>
      </div>
    );
  }

  if (authGateStatus === 'unverified_email') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F8] px-4 py-8">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex flex-col items-center text-center space-y-1.5">
            <BrandLogo size="lg" />
            <h1 className="text-lg font-bold text-slate-900 pt-1">Don Juancito</h1>
            <p className="text-xs font-semibold text-amber-800">Tienda y Abarrotes</p>
          </div>

          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-rose-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900">Correo no verificado</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Por seguridad, tu cuenta de Google debe tener el correo verificado para acceder a
                los datos de la tienda.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition"
          >
            Cambiar de cuenta
          </button>
        </div>
      </div>
    );
  }

  if (authGateStatus === 'pending_approval' && firebaseUser) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F8] px-4 py-8">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-6 space-y-5 shadow-sm">
          <div className="flex flex-col items-center text-center space-y-2">
            <BrandLogo size="lg" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Don Juancito</h1>
              <p className="text-xs font-semibold text-amber-800">Tienda y Abarrotes</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-amber-700 text-xs font-bold">
              <Clock className="w-4 h-4" />
              <span>CELULAR PENDIENTE DE AUTORIZACIÓN</span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Iniciaste sesión como{' '}
              <strong className="text-slate-900">{firebaseUser.email}</strong>. Para proteger el
              inventario y los fiados, el Administrador debe aprobar este celular.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {accessRequestSent ? (
            <div className="p-4 rounded-2xl bg-teal-50 border border-teal-200 space-y-1.5">
              <p className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Solicitud enviada al Administrador</span>
              </p>
              <p className="text-xs text-teal-800 leading-relaxed">
                En el celular del Administrador, ve a{' '}
                <strong>Inventario → Ajustes → Celulares y Roles</strong> y aprueba esta cuenta.
                Esta pantalla entrará automáticamente al aprobarse.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={onSubmitAccessRequest}
              className="w-full min-h-[52px] rounded-xl bg-teal-700 text-white text-sm font-bold hover:bg-teal-800 disabled:opacity-50 active:scale-[0.99] transition"
            >
              Solicitar acceso como Vendedor
            </button>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={onRetryCheck}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Verificar ahora</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Otra cuenta</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F8] px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex flex-col items-center text-center space-y-2.5">
          <BrandLogo size="lg" />
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Don Juancito</h1>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Tienda y Abarrotes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-1.5">
            <ShieldCheck className="w-5 h-5 text-teal-700" />
            <p className="text-xs font-bold text-slate-900">Administrador</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              Cobro, libreta de fiados, stock, costos, ganancias y control del equipo.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-1.5">
            <ShoppingBag className="w-5 h-5 text-amber-700" />
            <p className="text-xs font-bold text-slate-900">Vendedor</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              Acceso directo solo a la caja de cobro, sin ver costos ni libreta completa.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={onLoginWithGoogle}
            className="w-full min-h-[54px] px-4 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50 active:scale-[0.99] transition flex items-center justify-center gap-2.5"
          >
            <Smartphone className="w-4 h-4 text-teal-300" />
            <span>{loading ? 'Abriendo Google...' : 'Ingresar con cuenta de Google'}</span>
          </button>

          <PWAInstallButton className="w-full" />
        </div>
      </div>
    </div>
  );
};
