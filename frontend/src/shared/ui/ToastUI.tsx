"use client";

/**
 * Shared toast (snackbar) system for the web app and the Word add-in.
 *
 * The store is a module singleton so any layer, including non-React code
 * such as the API client, can raise a notification with `showToast`. React
 * subscribes through `useToasts`, and `ToastViewportUI` renders the stack
 * once near the root of each client, at the top centre of the page.
 *
 * The viewport also owns the slot a web `WarningPopup` renders into, so
 * popups and toasts share one column and never cover each other.
 *
 * Error toasts stay until dismissed when they carry actions, because a
 * "Retry" that vanishes mid-read is worse than none. Everything else
 * auto-dismisses and pauses while hovered or focused. `TOAST_FOCUS_KEY`
 * moves the keyboard onto the newest toast, so a timed action such as
 * "Undo" can be reached before it runs out.
 *
 * The store drops a toast the moment it closes. The viewport keeps drawing it
 * for the length of its exit transition, out of reach of pointer, keyboard
 * and screen reader (see "Exit" below), so closing is never held up by motion.
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactElement,
} from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
    NoticeCardUI,
    noticeActionClassName,
    noticeActionEmphasis,
} from "./NoticeCardUI";

import {
    closeToast,
    dismissToast,
    subscribe,
    getSnapshot,
    getServerSnapshot,
    type ToastAction,
    type ToastRecord,
} from "../lib/toastStore";
export {
    showToast,
    dismissToast,
    clearToasts,
    MAX_VISIBLE_TOASTS,
    type ToastAction,
    type ToastCloseReason,
    type ToastInput,
    type ToastRecord,
    type ToastTone,
} from "../lib/toastStore";

/**
 * Toast entrance and exit: one interruptible transition (not a keyframe) on a
 * transform and on opacity. A new toast fades in while it settles 4px down
 * into the column, and a closing one fades out while it lifts the same 4px;
 * closing a toast that is still arriving turns it round from where it is.
 * The travel is the `translate` property, so a toast on the move never nudges
 * its neighbours, and the list names `translate` rather than `transform`
 * because that is the property Tailwind v4's `translate-y-*` sets.
 *
 * Under reduced motion the travel is dropped and the fade stays.
 */
export const TOAST_MOTION_BASE_CLASS =
    "transition-[translate,opacity] ease-out-strong motion-reduce:transition-opacity";
/** Settled in the column: where an entrance lands and an exit starts. */
export const TOAST_ENTER_CLASS = "translate-y-0 opacity-100";
/** Hidden: where an entrance starts and an exit lands. */
export const TOAST_EXIT_CLASS =
    "-translate-y-1 opacity-0 motion-reduce:translate-y-0";
/** An exit is a tier quicker than an entrance, like every dismissal. */
export const TOAST_ENTER_DURATION_CLASS = "duration-(--motion-duration-enter)";
export const TOAST_EXIT_DURATION_CLASS = "duration-(--motion-duration-exit)";

/**
 * `entering` is the one frame a new toast spends hidden before it moves in;
 * `leaving` is a closed toast on its way out.
 */
export type ToastMotionState = "entering" | "shown" | "leaving";

/** The classes of the element that carries a toast's entrance and exit. */
export function toastMotionClassName(state: ToastMotionState): string {
    return clsx(
        TOAST_MOTION_BASE_CLASS,
        state === "leaving"
            ? TOAST_EXIT_DURATION_CLASS
            : TOAST_ENTER_DURATION_CLASS,
        state === "shown" ? TOAST_ENTER_CLASS : TOAST_EXIT_CLASS,
    );
}

const toastNodes = new Map<string, HTMLElement>();

/**
 * Where keyboard focus was before it entered a toast, by toast id. A toast
 * that closes while it holds focus hands it back there instead of dropping
 * it to the top of the page.
 */
const focusReturnTargets = new Map<string, HTMLElement>();

/**
 * The key that moves keyboard focus onto the newest toast on screen (see
 * `focusNewestToast`). A focused toast's timer is paused, so this is how a
 * keyboard or screen-reader user reaches a timed action such as "Undo".
 */
export const TOAST_FOCUS_KEY = "F8";

/**
 * Move keyboard focus onto a toast. Toasts never take focus on their own —
 * yanking the caret out of what the user is typing is worse than the
 * failure being reported — so a caller that must be acted on immediately
 * asks for it explicitly. Returns false when the toast is not on screen, or
 * has closed and is only fading out.
 */
export function focusToast(id: string): boolean {
    const node = toastNodes.get(id);
    if (!node || !getSnapshot().some((toast) => toast.id === id)) return false;
    node.focus();
    return true;
}

/**
 * Move keyboard focus onto the newest toast on screen that has an action,
 * or else the newest toast, landing on its first action button. When that
 * toast closes, focus goes back to where it was. Returns false when no toast
 * is on screen.
 */
export function focusNewestToast(): boolean {
    let target: { id: string; node: HTMLElement; hasAction: boolean } | null =
        null;
    for (const toast of getSnapshot()) {
        const node = toastNodes.get(toast.id);
        if (!node) continue;
        const hasAction = Boolean(toast.actions?.length);
        // Later toasts are newer: the newest with an action wins, and the
        // newest of all when none has one.
        if (hasAction || !target?.hasAction) {
            target = { id: toast.id, node, hasAction };
        }
    }
    if (!target) return false;
    const previous = document.activeElement;
    if (
        previous instanceof HTMLElement &&
        previous !== document.body &&
        !target.node.contains(previous)
    ) {
        focusReturnTargets.set(target.id, previous);
    }
    (
        target.node.querySelector<HTMLElement>("[data-toast-action]") ??
        target.node
    ).focus();
    return true;
}

let noticeStackSlot: HTMLElement | null = null;
const noticeStackSlotListeners = new Set<() => void>();

function setNoticeStackSlot(node: HTMLElement | null) {
    if (noticeStackSlot === node) return;
    noticeStackSlot = node;
    for (const listener of noticeStackSlotListeners) listener();
}

function subscribeNoticeStackSlot(listener: () => void) {
    noticeStackSlotListeners.add(listener);
    return () => {
        noticeStackSlotListeners.delete(listener);
    };
}

/**
 * The element at the head of the mounted viewport's column, or null when no
 * viewport is mounted. `WarningPopup` portals its card here so it stacks
 * with the toasts instead of sitting on top of them.
 */
export function useNoticeStackSlot(): HTMLElement | null {
    return useSyncExternalStore(
        subscribeNoticeStackSlot,
        () => noticeStackSlot,
        () => null,
    );
}

export function toastHasActions(toast: ToastRecord): boolean {
    return Boolean(toast.actions?.length || toast.supportHref);
}

/** A toast's "Contact support" link and action buttons, for a card's action row. */
export function ToastActionsUI({ toast }: { toast: ToastRecord }): ReactElement {
    const runAction = async (action: ToastAction) => {
        if (!action.keepOpen) closeToast(toast.id, "action");
        await action.onClick();
    };

    // Contact support comes first, so it is never the primary action
    // unless it is the only one.
    const supportCount = toast.supportHref ? 1 : 0;
    const count = supportCount + (toast.actions?.length ?? 0);

    return (
        <>
            {toast.supportHref && (
                <a
                    href={toast.supportHref}
                    className={noticeActionClassName(
                        noticeActionEmphasis(0, count),
                    )}
                >
                    {toast.supportLabel ?? "Contact support"}
                </a>
            )}
            {toast.actions?.map((action, index) => (
                <button
                    key={action.label}
                    type="button"
                    // Where `focusNewestToast` puts the keyboard.
                    data-toast-action=""
                    onClick={() => void runAction(action)}
                    className={noticeActionClassName(
                        noticeActionEmphasis(supportCount + index, count),
                        action.tone,
                    )}
                >
                    {action.label}
                </button>
            ))}
        </>
    );
}

export function useToasts(): readonly ToastRecord[] {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/*
 * Exit.
 *
 * The store is synchronous: a closed toast is gone from it at once, and its
 * `onClose` has run. What stays behind is only the picture. The viewport draws
 * from the list below, which follows the store and holds a closed toast as
 * `leaving` until its exit transition ends. A leaving toast is inert and
 * hidden from assistive technology, so for everyone but the eye it has
 * already gone.
 *
 * A toast leaves at once, with no exit, when there is nothing to animate:
 * its element has no transition (a unit test with no stylesheet, or
 * `transition: none`), it is still hidden before its entrance, or a newer
 * toast with the same dedupe key has taken its place.
 */

/** A toast the viewport draws; `leaving` once the store has dropped it. */
interface ToastPresence {
    toast: ToastRecord;
    leaving: boolean;
}

const NO_TOASTS_PRESENT: readonly ToastPresence[] = [];
let presence: readonly ToastPresence[] = NO_TOASTS_PRESENT;
/** The store snapshot `presence` was last brought in line with. */
let presenceSource: readonly ToastRecord[] | null = null;
const presenceListeners = new Set<() => void>();
let stopFollowingStore: (() => void) | null = null;

/**
 * Removes a leaving toast if its `transitionend` never arrives (a hidden tab,
 * a cancelled transition), this long after the transition should have ended.
 */
const EXIT_GRACE_MS = 100;
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** `0.18s` or `180ms` as milliseconds; 0 for anything else. */
function cssTimeMs(value: string): number {
    const amount = parseFloat(value);
    if (!Number.isFinite(amount)) return 0;
    return value.trim().endsWith("ms") ? amount : amount * 1000;
}

/**
 * The longest this element's transition can run, or 0 when it has none to
 * run: no transition at all, or nothing on screen to fade.
 */
function exitTransitionMs(item: HTMLElement): number {
    const style = getComputedStyle(item);
    if (style.transitionProperty === "none" || style.opacity === "0") return 0;
    const longest = (list: string) =>
        Math.max(0, ...list.split(",").map(cssTimeMs));
    const duration = longest(style.transitionDuration);
    return duration > 0 ? duration + longest(style.transitionDelay) : 0;
}

function notifyPresence() {
    for (const listener of presenceListeners) listener();
}

/**
 * Start a closed toast's exit. Returns false when it should simply be
 * removed. Runs before React renders the leaving state, while the card can
 * still be asked whether it holds the keyboard: the inert attribute that
 * state adds would drop focus on the floor, so it is handed back first.
 */
function beginToastExit(id: string): boolean {
    const card = toastNodes.get(id);
    const item = card?.closest<HTMLElement>("[data-toast-item]");
    if (!card || !item) return false;
    const exitMs = exitTransitionMs(item);
    if (exitMs === 0) return false;

    const returnTo = focusReturnTargets.get(id);
    focusReturnTargets.delete(id);
    if (returnTo?.isConnected && card.contains(document.activeElement)) {
        returnTo.focus();
    }
    exitTimers.set(
        id,
        setTimeout(() => finishToastExit(id), exitMs + EXIT_GRACE_MS),
    );
    return true;
}

/** Remove a leaving toast from the page: its exit has ended. */
function finishToastExit(id: string) {
    const timer = exitTimers.get(id);
    if (timer !== undefined) {
        clearTimeout(timer);
        exitTimers.delete(id);
    }
    const remaining = presence.filter(
        (entry) => !(entry.leaving && entry.toast.id === id),
    );
    if (remaining.length === presence.length) return;
    presence = remaining;
    notifyPresence();
}

/**
 * Bring `presence` in line with the store. With `animate`, a toast the store
 * has just dropped stays as `leaving` when it has an exit to run. Returns
 * whether anything changed.
 */
function followStore(animate: boolean): boolean {
    const next = getSnapshot();
    if (next === presenceSource) return false;
    presenceSource = next;

    const live = new Set(next.map((toast) => toast.id));
    const drawn = new Set(presence.map((entry) => entry.toast.id));
    // A toast replaced through its dedupe key hands over in place: the
    // newcomer's entrance is the whole swap.
    const arrivingKeys = new Set<string>();
    for (const toast of next) {
        if (!drawn.has(toast.id) && toast.dedupeKey) {
            arrivingKeys.add(toast.dedupeKey);
        }
    }

    const entries: ToastPresence[] = [];
    for (const entry of presence) {
        const { toast } = entry;
        if (entry.leaving || live.has(toast.id)) {
            entries.push(entry);
            continue;
        }
        const replaced =
            toast.dedupeKey !== undefined && arrivingKeys.has(toast.dedupeKey);
        if (animate && !replaced && beginToastExit(toast.id)) {
            entries.push({ toast, leaving: true });
        }
    }
    for (const toast of next) {
        if (!drawn.has(toast.id)) entries.push({ toast, leaving: false });
    }
    presence = entries;
    return true;
}

function subscribePresence(listener: () => void) {
    presenceListeners.add(listener);
    stopFollowingStore ??= subscribe(() => {
        if (followStore(true)) notifyPresence();
    });
    return () => {
        presenceListeners.delete(listener);
        if (presenceListeners.size > 0) return;
        // No viewport is drawing any more, so there is no exit left to show.
        stopFollowingStore?.();
        stopFollowingStore = null;
        for (const timer of exitTimers.values()) clearTimeout(timer);
        exitTimers.clear();
        presence = presence.filter((entry) => !entry.leaving);
    };
}

function getPresenceSnapshot() {
    // Catches up on what the store did while no viewport was subscribed.
    // With one mounted, the subscription above has already done the work and
    // this returns the same list, so a render never reads the page.
    followStore(false);
    return presence;
}

function getServerPresenceSnapshot() {
    return NO_TOASTS_PRESENT;
}

function ToastItemUI({
    toast,
    leaving,
}: {
    toast: ToastRecord;
    leaving: boolean;
}) {
    // Mount hidden, then flip on the next frame so the browser transitions the
    // toast in rather than painting it already settled. The transition is
    // interruptible: a re-render mid-entrance re-targets it smoothly.
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const frame = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const pausedRef = useRef(false);
    const hoveredRef = useRef(false);
    const focusedRef = useRef(false);
    const deadlineRef = useRef<number | null>(null);
    const remainingRef = useRef<number | null>(toast.durationMs);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const arm = useCallback(() => {
        clearTimer();
        const remaining = remainingRef.current;
        if (remaining === null) return;
        deadlineRef.current = Date.now() + remaining;
        timerRef.current = setTimeout(
            () => closeToast(toast.id, "expired"),
            remaining,
        );
    }, [clearTimer, toast.id]);

    const pause = useCallback(() => {
        if (pausedRef.current || remainingRef.current === null) return;
        pausedRef.current = true;
        if (deadlineRef.current !== null) {
            remainingRef.current = Math.max(
                1_000,
                deadlineRef.current - Date.now(),
            );
        }
        clearTimer();
    }, [clearTimer]);

    const resume = useCallback(() => {
        if (!pausedRef.current || hoveredRef.current || focusedRef.current) return;
        pausedRef.current = false;
        arm();
    }, [arm]);

    useEffect(() => {
        // A leaving toast has already closed; it has no time left to run out.
        if (leaving) return;
        arm();
        return clearTimer;
    }, [arm, clearTimer, leaving]);

    // Kept after React detaches the ref, for the cleanup below.
    const nodeRef = useRef<HTMLElement | null>(null);
    // A toast that closes while it holds keyboard focus (its Undo was
    // pressed, or its time ran out) hands focus back to where it came from.
    // The cleanup runs while the card is still on the page; focus moves
    // once React has removed it, and only if nothing else has taken it.
    // A toast that fades out has handed focus back already, when its exit
    // began (`beginToastExit`), and finds nothing left to do here.
    useLayoutEffect(() => {
        const id = toast.id;
        return () => {
            const returnTo = focusReturnTargets.get(id);
            focusReturnTargets.delete(id);
            if (!returnTo || !nodeRef.current?.contains(document.activeElement)) {
                return;
            }
            queueMicrotask(() => {
                const active = document.activeElement;
                if (returnTo.isConnected && (!active || active === document.body)) {
                    returnTo.focus();
                }
            });
        };
    }, [toast.id]);

    const isError = toast.tone === "error";
    // A timed action can run out before the keyboard reaches it at the end
    // of the page, so the announcement says how to get there.
    const firstAction = toast.actions?.[0];
    const focusHint =
        firstAction && toast.durationMs !== null ? (
            <span className="sr-only">
                Press {TOAST_FOCUS_KEY} to reach {firstAction.label}.
            </span>
        ) : null;

    // The card's look lives in NoticeCardUI, shared with WarningPopup, so the
    // entrance and exit ride a wrapper rather than the card itself — the card
    // stays byte-identical to a popup's (WarningPopup.test checks this). This
    // item adds only toast behaviour: the timer, hover/focus pause, the
    // entrance and exit, and the node registry `focusToast` uses.
    return (
        <div
            // How `beginToastExit` finds the element that carries the motion.
            data-toast-item=""
            className={toastMotionClassName(
                leaving ? "leaving" : shown ? "shown" : "entering",
            )}
            // Closed already: while it fades it takes no pointer, no keyboard
            // focus, and is not announced.
            inert={leaving}
            aria-hidden={leaving || undefined}
            onTransitionEnd={(event) => {
                // Only this element's own fade ends the exit. The pills inside
                // the card have transitions too, and their events bubble. And
                // only a fade that has reached nothing: an entrance finishing
                // in the frame the toast closed reports an end as well, with
                // the toast still fully drawn.
                if (
                    leaving &&
                    event.target === event.currentTarget &&
                    event.propertyName === "opacity" &&
                    getComputedStyle(event.currentTarget).opacity === "0"
                ) {
                    finishToastExit(toast.id);
                }
            }}
        >
            <NoticeCardUI
                tone={toast.tone}
                title={toast.title}
                message={toast.message}
                onDismiss={() => dismissToast(toast.id)}
                dismissLabel="Dismiss notification"
                // The item owns the live semantics: `alert` is implicitly
                // assertive, `status` polite. The viewport around it is a plain
                // region, because a live region nested in a live region is
                // announced unpredictably (or twice).
                role={isError ? "alert" : "status"}
                // Not in the tab order, but focusable so `focusToast` can put
                // the keyboard on a critical failure and its actions.
                tabIndex={-1}
                ref={(node) => {
                    if (node) {
                        toastNodes.set(toast.id, node);
                        nodeRef.current = node;
                    } else {
                        toastNodes.delete(toast.id);
                    }
                }}
                data-testid="toast"
                onMouseEnter={() => { hoveredRef.current = true; pause(); }}
                onMouseLeave={() => { hoveredRef.current = false; resume(); }}
                onFocus={(event) => {
                    focusedRef.current = true;
                    pause();
                    // Tabbing in counts too, not only the focus key.
                    const from = event.relatedTarget;
                    if (
                        from instanceof HTMLElement &&
                        !event.currentTarget.contains(from) &&
                        !focusReturnTargets.has(toast.id)
                    ) {
                        focusReturnTargets.set(toast.id, from);
                    }
                }}
                onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    focusedRef.current = false;
                    // The person moved on; closing later must not pull them back.
                    focusReturnTargets.delete(toast.id);
                    resume();
                }}
                actions={
                    toastHasActions(toast) ? (
                        <>
                            {focusHint}
                            <ToastActionsUI toast={toast} />
                        </>
                    ) : undefined
                }
            />
        </div>
    );
}

export interface ToastViewportUIProps {
    /**
     * Set to false when the client draws error notices itself. The web app
     * does, with `WarningPopup`; the Word add-in has no popup and keeps the
     * default.
     */
    showErrors?: boolean;
    className?: string;
}

/**
 * Renders the toast stack. Mount exactly once per client, near the root.
 * The region is always present so assistive tech registers it before the
 * first notification arrives; the live announcement belongs to each toast,
 * not to this container. While it is mounted, `TOAST_FOCUS_KEY` moves the
 * keyboard onto the newest toast.
 */
export function ToastViewportUI({
    showErrors = true,
    className,
}: ToastViewportUIProps) {
    // The store's toasts, plus any that have closed and are still fading out.
    const present = useSyncExternalStore(
        subscribePresence,
        getPresenceSnapshot,
        getServerPresenceSnapshot,
    );
    const items = showErrors
        ? present
        : present.filter(({ toast }) => toast.tone !== "error");

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key !== TOAST_FOCUS_KEY ||
                event.defaultPrevented ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
            ) {
                return;
            }
            // With no toast on screen the key is left to the page.
            if (focusNewestToast()) event.preventDefault();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <div
            // A landmark, not a live region: each toast announces itself
            // through its own role, and `aria-label` needs a role to be
            // exposed at all.
            role="region"
            aria-label="Notifications"
            className={twMerge(
                clsx(
                    "pointer-events-none fixed left-1/2 top-5 z-[260] flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-2 px-4",
                ),
                className,
            )}
        >
            {/* `contents`, so popups portalled in here are flex items of
                the column and take its gap. */}
            <div ref={setNoticeStackSlot} className="contents" />
            {items.map(({ toast, leaving }) => (
                <ToastItemUI key={toast.id} toast={toast} leaving={leaving} />
            ))}
        </div>
    );
}
