import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
  isPermissionError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      isQuotaError: false,
      isPermissionError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'Ocurrió un error inesperado.';
    let isQuotaError = false;
    let isPermissionError = false;

    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Non-JSON error message
    }

    const lower = message.toLowerCase();
    if (lower.includes('quota exceeded')) {
      isQuotaError = true;
    } else if (lower.includes('permission') || lower.includes('insufficient permissions')) {
      isPermissionError = true;
    }

    return {
      hasError: true,
      message,
      isQuotaError,
      isPermissionError,
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F6F7F8] px-4 py-8">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-slate-900">
                {this.state.isQuotaError
                  ? 'Límite diario de base de datos alcanzado'
                  : this.state.isPermissionError
                    ? 'Acceso restringido por permisos'
                    : 'No se pudo completar la operación'}
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                {this.state.isQuotaError
                  ? 'Se superó la cuota gratuita diaria de lecturas/escrituras. Se restablecerá mañana.'
                  : this.state.isPermissionError
                    ? 'Tu cuenta no tiene permiso para consultar esta sección o tus accesos fueron modificados por el Administrador.'
                    : 'Verifica tu conexión a internet o recarga la pantalla para continuar.'}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3 break-words font-mono-num">
            {this.state.message}
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition"
          >
            <RotateCw className="w-4 h-4" />
            <span>Recargar aplicación</span>
          </button>
        </div>
      </div>
    );
  }
}
