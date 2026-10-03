"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastTone = "success" | "warning" | "danger" | "info";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue>({
  toast: () => {},
  dismiss: () => {},
});

export function useToast(): ToastContextValue {
  return React.useContext(ToastContext);
}

const TONE_ICON: Record<ToastTone, React.ComponentType<{ size?: number | string }>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

const TONE_COLOR: Record<ToastTone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-accent)",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (item: Omit<ToastItem, "id">) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev.slice(-4), { ...item, id }]);
      setTimeout(() => {
        dismiss(id);
      }, 4200);
    },
    [dismiss]
  );

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ds-toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => {
          const tone = t.tone ?? "info";
          const Icon = TONE_ICON[tone];
          return (
            <div key={t.id} className="ds-toast" role="status">
              <span style={{ color: TONE_COLOR[tone], flexShrink: 0, marginTop: 1 }}>
                <Icon size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                {t.description && (
                  <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                    {t.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
                aria-label="Dismiss notification"
                style={{ width: 24, height: 24 }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
