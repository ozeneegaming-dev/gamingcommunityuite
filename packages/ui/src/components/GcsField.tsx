import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "../cx";

type FieldControlProps = {
  id?: string;
  className?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
};

export type GcsFieldProps = {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  /** Un singur control (`<input>`, `<select>`, `<textarea>`), legat automat de etichetă, indiciu și eroare. */
  children: ReactNode;
};

export function GcsField({ label, error, hint, className, children }: GcsFieldProps) {
  const generatedId = useId();
  const control = isValidElement<FieldControlProps>(children) ? (children as ReactElement<FieldControlProps>) : null;
  const id = control?.props.id ?? `gcs-field-${generatedId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [control?.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  const field = control
    ? cloneElement(control, {
        id,
        className: cx(control.type === "input" || control.type === "textarea" || control.type === "select" ? "gcs-input" : undefined, control.props.className),
        ...(error ? { "aria-invalid": true } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })
    : children;

  return (
    <div className={cx("gcs-field", error && "gcs-field--invalid", className)}>
      <label className="gcs-field__label" htmlFor={id}>
        {label}
      </label>
      {field}
      {hint && (
        <p id={hintId} className="gcs-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="gcs-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
