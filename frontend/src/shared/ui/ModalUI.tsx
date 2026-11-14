"use client";

import {
    useEffect,
    useId,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LIQUID_GLASS_MODAL_CLASS } from "./LiquidGlassUI";
import { CloseButton } from "./CloseButton";
import { HeadingUI } from "./HeadingUI";
import { TextUI } from "./TextUI";

export type ModalUISize = "sm" | "md" | "lg" | "xl";

export interface ModalUIProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    /**
     * The dialog's visible title, rendered as a heading and wired to the
     * dialog's `aria-labelledby`. Prefer this over `ariaLabel`: a named
     * heading is both the accessible name and the visible one.
     */
    title?: ReactNode;
    /** Sits under the title and wires the dialog's `aria-describedby`. */
    description?: ReactNode;
    breadcrumbs?: ReactNode[];
    headerAction?: ReactNode;
    size?: ModalUISize;
    className?: string;
    /**
     * A fallback accessible name, used only when neither `title` nor
     * `breadcrumbs` name the dialog. Prefer `title`.
     */
    ariaLabel?: string;
    footerStatus?: ReactNode;
    primaryAction?: ReactNode;
    secondaryAction?: ReactNode;
    cancelAction?: ReactNode;
    keepMounted?: boolean;
}

const sizeClassName: Record<ModalUISize, string> = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

// Fade and settle in place on W26's tokens: opacity plus a 0.98 scale, in on
// enter, a tier quicker out on exit, on the ease-out curve. Under reduced
// motion the scale is dropped (and MotionUI.css drops the rest), leaving the
// fade. The dialog grows with its content and unmounts on close, so the enter
// plays on open; the exit classes keep parity with the menu surface and play
// where the dialog is kept mounted.
const MODAL_MOTION_CLASS =
    "data-[state=open]:animate-in data-[state=closed]:animate-out " +
    "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 " +
    "data-[state=open]:zoom-in-[0.98] data-[state=closed]:zoom-out-[0.98] " +
    "data-[state=open]:animation-duration-(--motion-duration-enter) data-[state=closed]:animation-duration-(--motion-duration-exit) " +
    "data-[state=open]:ease-out-strong data-[state=closed]:ease-out-strong " +
    "motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100";

export function ModalUI({
    open,
    onClose,
    children,
    title,
    description,
    breadcrumbs,
    headerAction,
    size = "lg",
    className = "",
    ariaLabel,
    footerStatus,
    primaryAction,
    secondaryAction,
    cancelAction,
    keepMounted = false,
}: ModalUIProps) {
    const [hasMounted, setHasMounted] = useState(false);
    const dialogRef = useRef<HTMLElement>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();
    const descriptionId = useId();

    // eslint-disable-next-line react-hooks/set-state-in-effect -- portals cannot render during SSR
    useEffect(() => setHasMounted(true), []);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const dialog = dialogRef.current;
        const focusable = (): HTMLElement[] =>
            dialog
                ? Array.from(
                      dialog.querySelectorAll<HTMLElement>(
                          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                      ),
                  ).filter((element) => !element.hasAttribute("hidden"))
                : [];

        window.requestAnimationFrame(() => {
            // React's `autoFocus` prop focuses the element on mount but never
            // writes an `autofocus` attribute, so the attribute probe below
            // never matched and this frame stole focus from the intended
            // field to the first focusable (the Close button). If something
            // inside the dialog already holds focus, leave it there.
            const active = document.activeElement as HTMLElement | null;
            if (dialog && active && active !== dialog && dialog.contains(active)) {
                return;
            }
            const target =
                focusable().find((element) =>
                    element.hasAttribute("autofocus"),
                ) ??
                focusable()[0] ??
                dialog;
            target?.focus();
        });

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                // A control inside the dialog (an open listbox or menu) that
                // handled Escape itself marks it handled; only close for an
                // Escape nothing else claimed.
                if (!event.defaultPrevented) onCloseRef.current();
                return;
            }
            if (event.key !== "Tab") return;

            const items = focusable();
            if (items.length === 0) {
                event.preventDefault();
                dialog?.focus();
                return;
            }

            const first = items[0]!;
            const last = items[items.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            previouslyFocused?.focus();
        };
    }, [open]);

    if (!open && (!keepMounted || !hasMounted)) return null;

    const hasTitle = Boolean(title);
    const hasBreadcrumbs = Boolean(breadcrumbs?.length);
    const hasHeader = hasTitle || hasBreadcrumbs;
    const hasFooter = Boolean(
        footerStatus || primaryAction || secondaryAction || cancelAction,
    );
    // A heading names the dialog when there is one; otherwise the last
    // breadcrumb does. `ariaLabel` is the fallback only when neither exists.
    const labelledBy = hasTitle || hasBreadcrumbs ? titleId : undefined;
    const state = open ? "open" : "closed";

    return createPortal(
        <div
            data-state={state}
            className={`fixed inset-0 z-[200] flex items-center justify-center bg-white/10 px-4 py-4 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:animation-duration-(--motion-duration-enter) ${open ? "" : "hidden"}`}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-label={labelledBy ? undefined : ariaLabel}
                aria-describedby={description ? descriptionId : undefined}
                aria-hidden={open ? undefined : true}
                tabIndex={-1}
                data-state={state}
                className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-3xl ${LIQUID_GLASS_MODAL_CLASS} ${MODAL_MOTION_CLASS} backdrop-blur-3xl ${sizeClassName[size]} ${className}`}
            >
                {hasHeader && (
                    <header className="flex shrink-0 items-start justify-between gap-3 p-4 pl-5">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {hasBreadcrumbs && (
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs leading-none text-fg-muted">
                                    {breadcrumbs?.map((segment, index) => {
                                        const isLast =
                                            index === breadcrumbs.length - 1;
                                        return (
                                            <span
                                                key={index}
                                                className="flex items-center gap-1.5"
                                            >
                                                {index > 0 && <span>›</span>}
                                                <span
                                                    id={
                                                        !hasTitle && isLast
                                                            ? titleId
                                                            : undefined
                                                    }
                                                    className={`truncate ${isLast ? "text-fg-subtle" : ""}`}
                                                >
                                                    {segment}
                                                </span>
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                            {hasTitle && (
                                <HeadingUI
                                    as="h2"
                                    size="section"
                                    id={titleId}
                                    className="min-w-0 truncate"
                                >
                                    {title}
                                </HeadingUI>
                            )}
                            {description && (
                                <TextUI
                                    as="p"
                                    variant="muted"
                                    id={descriptionId}
                                    className="min-w-0"
                                >
                                    {description}
                                </TextUI>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            {headerAction}
                            <CloseButton onClick={onClose} size="md" />
                        </div>
                    </header>
                )}

                {/* The body grows with its content; once the dialog reaches the
                    viewport it is the body that scrolls, so the header and
                    footer stay put. Scroll gutters protect shadows and focus
                    rings without moving content; nested scrollers mark
                    themselves so they keep their own spacing. */}
                <div
                    data-modal-scroll
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 [&_[data-modal-scroll]]:-mx-2 [&_[data-modal-scroll]]:px-2 [&_[data-modal-scroll=horizontal]]:-my-2 [&_[data-modal-scroll=horizontal]]:py-2"
                >
                    {children}
                </div>

                {hasFooter && (
                    <footer
                        className={`flex shrink-0 items-center gap-3 border-t border-white/60 p-3 ${secondaryAction ? "justify-between" : "justify-end"}`}
                    >
                        {secondaryAction && (
                            <div className="flex min-w-0 items-center gap-2">
                                {secondaryAction}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            {footerStatus}
                            {cancelAction}
                            {primaryAction}
                        </div>
                    </footer>
                )}
            </section>
        </div>,
        document.body,
    );
}
