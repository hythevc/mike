// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { OptionPill } from "@/app/components/ui/option-pill";
import { focusNeighbour } from "@/app/lib/focusNeighbour";
import type { JurisdictionEntry } from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { authInputUIClassName } from "@/shared/ui/AuthStylesUI";
import {
    Dropdown,
    DropdownCheckboxItem,
    DropdownContent,
    DropdownTrigger,
} from "@/shared/ui/dropdown";
import { LIQUID_GLASS_HOVER_CLASS } from "@/shared/ui/LiquidGlassUI";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { JurisdictionChips } from "./JurisdictionChips";
import { jurisdictionLabel, jurisdictionName } from "./jurisdictionLabels";

// The two places this is used draw their fields differently: a modal's glass
// control (as ModalSelect does) and a settings page's flat field (as
// SettingsSelectRow does). The behaviour is the same in both.
const TRIGGER_CLASS = {
    modal: cn(
        FORM_CONTROL_GLASS_CLASS,
        "flex h-10 items-center justify-between",
        LIQUID_GLASS_HOVER_CLASS,
    ),
    settings: cn(
        "flex h-9 w-full items-center justify-between gap-2 text-left text-sm outline-none disabled:cursor-default disabled:opacity-60",
        authInputUIClassName,
    ),
} as const;

/**
 * Choose several jurisdictions from the registry.
 *
 * The button opens a menu of checkboxes that stays open while several are
 * ticked. What is chosen is listed underneath, each with a button that
 * removes it, in the order it was chosen. The line between the two says how
 * many are chosen, or `emptyText` when none are, and is read out when it
 * changes.
 *
 * Two ways of not being usable, which look different on purpose. `disabled`
 * is for a moment, such as a save in flight: everything stays where it is
 * and cannot be pressed. `readOnly` is for somebody who may see the list but
 * not change it: the names are shown without anything to press.
 *
 * The visible label belongs to the caller: point it at `id` with `htmlFor`.
 */
export function JurisdictionMultiSelect({
    id,
    value,
    onChange,
    options,
    max,
    emptyText,
    disabled = false,
    readOnly = false,
    surface = "modal",
}: {
    id: string;
    /** The chosen codes, in the order they were chosen. */
    value: readonly string[];
    onChange: (codes: string[]) => void;
    options: readonly JurisdictionEntry[];
    /** The most that may be chosen. */
    max: number;
    /** Said in place of the count when nothing is chosen. */
    emptyText: string;
    /** Held for now: shown as it is, with nothing that can be pressed. */
    disabled?: boolean;
    /** May be read but not changed: the names, without remove buttons. */
    readOnly?: boolean;
    surface?: keyof typeof TRIGGER_CLASS;
}) {
    const statusId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const atLimit = value.length >= max;
    const unusable = disabled || readOnly;

    function toggle(code: string) {
        if (value.includes(code)) {
            onChange(value.filter((chosen) => chosen !== code));
        } else if (!atLimit) {
            onChange([...value, code]);
        }
    }

    // A chip that is removed leaves the page with the keyboard on it. Move
    // to the chip beside it, or back to the control when it was the last.
    function remove(code: string, chip: HTMLElement | null) {
        if (value.length === 1 || !focusNeighbour(chip))
            triggerRef.current?.focus();
        onChange(value.filter((chosen) => chosen !== code));
    }

    function clear() {
        triggerRef.current?.focus();
        onChange([]);
    }

    const status =
        value.length === 0
            ? emptyText
            : atLimit
              ? `${value.length} of ${max} chosen. Remove one to choose another.`
              : `${value.length} of ${max} chosen`;

    return (
        <div data-slot="jurisdiction-multi-select" className="min-w-0">
            <Dropdown>
                {/* The menu opens on pointer-down, which a disabled button
                    still receives, so the trigger is told as well. */}
                <DropdownTrigger asChild disabled={unusable}>
                    <button
                        ref={triggerRef}
                        id={id}
                        type="button"
                        disabled={unusable}
                        aria-describedby={statusId}
                        className={TRIGGER_CLASS[surface]}
                    >
                        <span
                            className={cn(
                                "truncate",
                                value.length === 0 && "text-fg-muted",
                            )}
                        >
                            {value.length === 0
                                ? "Select jurisdictions"
                                : `${value.length} selected`}
                        </span>
                        <ChevronDown
                            aria-hidden="true"
                            className="ml-2 h-3.5 w-3.5 shrink-0 text-fg-muted"
                        />
                    </button>
                </DropdownTrigger>
                <DropdownContent
                    align="start"
                    sideOffset={4}
                    collisionPadding={12}
                    // Escape closes the menu, not the modal it may be in.
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
                >
                    {options.map((option) => {
                        const checked = value.includes(option.code);
                        return (
                            <DropdownCheckboxItem
                                key={option.code}
                                checked={checked}
                                // At the limit, what is chosen can still be
                                // unticked; nothing more can be ticked.
                                disabled={!checked && atLimit}
                                onCheckedChange={() => toggle(option.code)}
                                // Stays open so several can be chosen in a row.
                                onSelect={(event) => event.preventDefault()}
                                textValue={option.name}
                                className={option.parent ? "pl-6" : undefined}
                            >
                                <span className="min-w-0 [overflow-wrap:anywhere]">
                                    {option.name}{" "}
                                    <span className="text-fg-muted">
                                        {option.code}
                                    </span>
                                </span>
                            </DropdownCheckboxItem>
                        );
                    })}
                </DropdownContent>
            </Dropdown>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p
                    id={statusId}
                    aria-live="polite"
                    className="min-w-0 text-xs text-fg-muted"
                >
                    {status}
                </p>
                {value.length > 0 && !readOnly ? (
                    <TextButtonUI
                        size="xs"
                        // The text is one line tall; the target is not.
                        className="min-h-6"
                        disabled={disabled}
                        onClick={clear}
                    >
                        Clear all
                    </TextButtonUI>
                ) : null}
            </div>

            {readOnly ? (
                // Somebody who may read the list but not change it gets the
                // names, not a row of dead "Remove" buttons.
                <JurisdictionChips
                    codes={value}
                    entries={options}
                    label="Chosen jurisdictions"
                    className="mt-2"
                />
            ) : value.length > 0 ? (
                <ul
                    aria-label="Chosen jurisdictions"
                    className="mt-2 flex flex-wrap gap-2"
                >
                    {value.map((code) => {
                        const name = jurisdictionName(code, options);
                        return (
                            <li key={code} className="min-w-0 max-w-full">
                                <OptionPill
                                    title={jurisdictionLabel(code, options)}
                                    aria-label={`Remove ${name}`}
                                    disabled={disabled}
                                    onClick={(event) =>
                                        remove(
                                            code,
                                            event.currentTarget.parentElement,
                                        )
                                    }
                                >
                                    <span className="min-w-0 [overflow-wrap:anywhere]">
                                        {name}
                                    </span>
                                    <X
                                        aria-hidden="true"
                                        className="h-3 w-3 shrink-0"
                                    />
                                </OptionPill>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
