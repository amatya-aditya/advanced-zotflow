import React, { useState, useRef, useEffect, useCallback } from "react";
import { ObsidianIcon } from "ui/ObsidianIcon";

export interface MultiSelectOption {
    value: string;
    label: string;
}

interface MultiSelectDropdownProps {
    options: MultiSelectOption[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
}

/** Checkbox whose `indeterminate` property is driven by a prop. */
const IndeterminateCheckbox: React.FC<{
    checked: boolean;
    indeterminate: boolean;
    onChange: () => void;
}> = ({ checked, indeterminate, onChange }) => {
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);

    return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />;
};

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
    options,
    selected,
    onChange,
    placeholder = "Select…",
    disabled = false,
}) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const toggle = useCallback(
        (value: string) => {
            if (selected.includes(value)) {
                onChange(selected.filter((v) => v !== value));
            } else {
                onChange([...selected, value]);
            }
        },
        [selected, onChange],
    );

    const allSelected = options.length > 0 && selected.length === options.length;
    const noneSelected = selected.length === 0;
    const indeterminate = !allSelected && !noneSelected;

    const handleToggleAll = useCallback(() => {
        if (allSelected) {
            onChange([]);
        } else {
            onChange(options.map((o) => o.value));
        }
    }, [allSelected, options, onChange]);

    const triggerLabel =
        selected.length === 0
            ? placeholder
            : `${selected.length} annotation${selected.length > 1 ? "s" : ""} selected`;

    return (
        <div className="zotflow-multiselect" ref={containerRef}>
            <button
                className="zotflow-multiselect-trigger"
                onClick={() => setOpen((o) => !o)}
                disabled={disabled}
            >
                <span className="zotflow-multiselect-trigger-label">
                    {triggerLabel}
                </span>
                <ObsidianIcon
                    icon="chevron-down"
                    className="zotflow-multiselect-chevron"
                />
            </button>

            {open && (
                <div className="zotflow-multiselect-dropdown">
                    {options.length > 0 && (
                        <label className="zotflow-multiselect-item zotflow-multiselect-toggle-all">
                            <IndeterminateCheckbox
                                checked={allSelected}
                                indeterminate={indeterminate}
                                onChange={handleToggleAll}
                            />
                            <span className="zotflow-multiselect-item-label">
                                {allSelected ? "Deselect all" : "Select all"}
                            </span>
                        </label>
                    )}
                    {options.length === 0 && (
                        <div className="zotflow-multiselect-empty">
                            No annotations available
                        </div>
                    )}
                    {options.map((opt) => (
                        <label
                            key={opt.value}
                            className="zotflow-multiselect-item"
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(opt.value)}
                                onChange={() => toggle(opt.value)}
                            />
                            <span className="zotflow-multiselect-item-label">
                                {opt.label}
                            </span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};
