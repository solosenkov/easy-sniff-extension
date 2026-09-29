import { t } from "../lib/i18n";
import { useEffect, useRef, type ReactNode } from "react";
import { Plus, Trash, X, Copy, Check } from "@phosphor-icons/react";
import { useState } from "react";
import { pair, type Pair } from "../lib/types";
export function Button({
  children,
  icon: Icon,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ElementType;
}) {
  return (
    <button className={`button ${className}`} {...props}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
export function IconButton({
  icon: Icon,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      <Icon size={17} />
    </button>
  );
}
export function CopyButton({
  value,
  label = t("Копировать"),
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      aria-label={copied ? t("Скопировано") : label}
      className={compact ? "copy-compact" : "copy-button"}
      disabled={!value}
      icon={copied ? Check : Copy}
      title={error || label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setError("");
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          setError(t("Не удалось скопировать. Выделите текст вручную."));
        }
      }}
    >
      {compact ? (
        <span className="sr-only">
          {error || (copied ? t("Скопировано") : label)}
        </span>
      ) : (
        error || (copied ? t("Скопировано") : label)
      )}
    </Button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton icon={X} label={t("Закрыть")} onClick={onClose} />
      </header>
      {children}
    </dialog>
  );
}
export function PairEditor({
  rows,
  onChange,
  label = t("Заголовки"),
}: {
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
  label?: string;
}) {
  return (
    <div className="pair-editor">
      <div className="pair-head">
        <span />
        <span>{t("Ключ")}</span>
        <span>{t("Значение")}</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="pair-row" key={row.id}>
          <input
            type="checkbox"
            aria-label={t("{0}: включить строку {1}", [label, index + 1])}
            checked={row.enabled}
            onChange={(e) =>
              onChange(
                rows.map((r) =>
                  r.id === row.id ? { ...r, enabled: e.target.checked } : r,
                ),
              )
            }
          />
          <input
            aria-label={t("{0}: ключ {1}", [label, index + 1])}
            placeholder={t("Ключ")}
            value={row.key}
            onChange={(e) =>
              onChange(
                rows.map((r) =>
                  r.id === row.id ? { ...r, key: e.target.value } : r,
                ),
              )
            }
          />
          <input
            aria-label={t("{0}: значение {1}", [label, index + 1])}
            placeholder={t("Значение")}
            value={row.value}
            onChange={(e) =>
              onChange(
                rows.map((r) =>
                  r.id === row.id ? { ...r, value: e.target.value } : r,
                ),
              )
            }
          />
          <IconButton
            icon={Trash}
            label={t("Удалить строку {0}", [index + 1])}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          />
        </div>
      ))}
      <Button
        icon={Plus}
        className="quiet add-row"
        onClick={() => onChange([...rows, pair()])}
      >
        {t("Добавить строку")}
      </Button>
    </div>
  );
}
export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} weight="light" />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="error-note" role="alert">
      {error}
    </div>
  ) : null;
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          className={value === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
