"use client";

import React from "react";
import Link from "next/link";

// Shared iOS-style palette and components for the WMS section.
// Filename starts with _ so Next.js App Router ignores it as a route.

export const iOS = {
  bg: "#F2F2F7",
  card: "#FFFFFF",
  separator: "#E5E5EA",
  text: "#1C1C1E",
  text2: "#6E6E73",
  text3: "#8E8E93",
  accent: "#007AFF",
  destructive: "#FF3B30",
  success: "#34C759",
  warn: "#FF9500",
} as const;

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

export const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: iOS.text3,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: iOS.bg,
        minHeight: "100vh",
        color: iOS.text,
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}
    >
      {children}
    </div>
  );
}

export function TopBar({
  back,
  title,
  subtitle,
  trailing,
}: {
  back?: { href: string; label: string };
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div style={{ background: iOS.bg, paddingTop: 16, paddingBottom: 12, paddingLeft: 24, paddingRight: 24 }}>
      {back && (
        <Link href={back.href} style={{ color: iOS.accent, fontSize: 17, display: "inline-block", marginBottom: 8 }}>
          ‹ {back.label}
        </Link>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 700, color: iOS.text, letterSpacing: -0.4, lineHeight: 1.05 }}>
            {title}
          </h1>
          {subtitle && <div style={{ color: iOS.text2, fontSize: 15, marginTop: 4 }}>{subtitle}</div>}
        </div>
        {trailing}
      </div>
    </div>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  padded?: boolean;
}) {
  return (
    <div
      style={{
        background: iOS.card,
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        padding: padded ? 20 : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PillButton({
  children,
  onClick,
  href,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles: React.CSSProperties = {
    background:
      variant === "primary"
        ? iOS.accent
        : variant === "destructive"
        ? iOS.destructive
        : variant === "secondary"
        ? "#E8E8ED"
        : "transparent",
    color:
      variant === "primary" || variant === "destructive"
        ? "#fff"
        : variant === "secondary"
        ? iOS.text
        : iOS.accent,
    border: "none",
    borderRadius: 980,
    padding: "10px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: FONT_STACK,
  };
  if (href) {
    return (
      <Link href={href} style={{ ...styles, textDecoration: "none" }}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={styles}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", background: "#E8E8ED", borderRadius: 9, padding: 2 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              background: active ? "#fff" : "transparent",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              border: "none",
              padding: "6px 14px",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              color: iOS.text,
              cursor: "pointer",
              fontFamily: FONT_STACK,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function TextField(
  props: React.InputHTMLAttributes<HTMLInputElement> & { wide?: boolean },
) {
  const { wide, style, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        background: "#fff",
        border: `1px solid ${iOS.separator}`,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 15,
        color: iOS.text,
        fontFamily: FONT_STACK,
        width: wide ? "100%" : undefined,
        ...style,
      }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        background: "#fff",
        border: `1px solid ${iOS.separator}`,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 15,
        color: iOS.text,
        fontFamily: FONT_STACK,
        minWidth: 140,
        ...(props.style ?? {}),
      }}
    />
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(2px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: iOS.card,
          borderRadius: 18,
          width: 460,
          maxWidth: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: `1px solid ${iOS.separator}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: 17, fontWeight: 700, color: iOS.text }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              color: iOS.accent,
              fontSize: 15,
              fontWeight: 500,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: FONT_STACK,
            }}
          >
            Done
          </button>
        </div>
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: "12px 20px",
              borderTop: `1px solid ${iOS.separator}`,
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              background: iOS.bg,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupedList({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: iOS.card,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

export function GroupedRow({
  children,
  isLast,
  onClick,
}: {
  children: React.ReactNode;
  isLast?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 16px",
        borderBottom: isLast ? "none" : `1px solid ${iOS.separator}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {children}
    </div>
  );
}
