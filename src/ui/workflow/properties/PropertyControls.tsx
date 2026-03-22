import React, { useRef, useCallback } from "react";
import type { ChangeEvent } from "react";

// --- Section & Title ---

export interface PropertySectionProps {
    title: string;
    children: React.ReactNode;
}

export function PropertySection({ title, children }: PropertySectionProps) {
    return (
        <div className="zotflow-wf-props-section">
            <div className="zotflow-wf-props-section-title">{title}</div>
            {children}
        </div>
    );
}

import { ObsidianIcon } from "../../ObsidianIcon";

export interface PropertyFieldProps {
    label: string;
    htmlFor?: string;
    readOnly?: boolean;
    children: React.ReactNode;
}

export function PropertyField({
    label,
    htmlFor,
    readOnly,
    children,
}: PropertyFieldProps) {
    return (
        <div
            className={`zotflow-wf-props-field ${readOnly ? "zotflow-wf-props-readonly" : ""}`}
        >
            <div className="zotflow-wf-props-field-header">
                {htmlFor && !readOnly ? (
                    <label htmlFor={htmlFor}>{label}</label>
                ) : (
                    <label>{label}</label>
                )}
                {readOnly && (
                    <div className="zotflow-wf-props-readonly-icon">
                        <ObsidianIcon icon="lock" />
                    </div>
                )}
            </div>
            {children}
        </div>
    );
}

export interface PropertyToggleFieldProps {
    label: string;
    htmlFor?: string;
    children: React.ReactNode;
}

export function PropertyToggleField({
    label,
    htmlFor,
    children,
}: PropertyToggleFieldProps) {
    return (
        <div className="zotflow-wf-props-field zotflow-wf-props-toggle-field">
            {htmlFor ? (
                <label htmlFor={htmlFor}>{label}</label>
            ) : (
                <label>{label}</label>
            )}
            {children}
        </div>
    );
}

// --- Inputs ---

import { ContextVariablePickerButton } from "./ContextVariablePicker";

export interface PropertyInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    id?: string;
    value: string;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    readOnly?: boolean;
    /** When set, shows a context variable picker button beside the input. */
    contextNodeId?: string;
}

export function PropertyInput({ contextNodeId, ...rest }: PropertyInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handlePickerSelect = useCallback((path: string) => {
        const input = inputRef.current;
        if (!input) return;

        const insertion = `{{${path}}}`;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const newValue =
            input.value.slice(0, start) + insertion + input.value.slice(end);

        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        )?.set;
        nativeSetter?.call(input, newValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));

        const newPos = start + insertion.length;
        requestAnimationFrame(() => {
            input.setSelectionRange(newPos, newPos);
            input.focus();
        });
    }, []);

    if (!contextNodeId) {
        return <input type="text" {...rest} />;
    }

    return (
        <div className="zotflow-wf-expression-wrapper">
            <input ref={inputRef} type="search" spellCheck={false} {...rest} />
            <div className="input-right-decorator clickable-icon">
                <ContextVariablePickerButton
                    nodeId={contextNodeId}
                    onSelect={handlePickerSelect}
                />
            </div>
        </div>
    );
}

export interface PropertyTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    id?: string;
    value: string;
    onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    rows?: number;
    readOnly?: boolean;
    /** When set, shows a context variable picker button beside the textarea. */
    contextNodeId?: string;
}

export function PropertyTextarea({
    contextNodeId,
    ...rest
}: PropertyTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handlePickerSelect = useCallback((path: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const insertion = `{{${path}}}`;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const newValue =
            textarea.value.slice(0, start) +
            insertion +
            textarea.value.slice(end);

        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
        )?.set;
        nativeSetter?.call(textarea, newValue);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));

        const newPos = start + insertion.length;
        requestAnimationFrame(() => {
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();
        });
    }, []);

    if (!contextNodeId) {
        return <textarea {...rest} />;
    }

    return (
        <div className="zotflow-wf-expression-wrapper">
            <textarea ref={textareaRef} {...rest} />
            <div
                className="clickable-icon"
                style={{
                    position: "absolute",
                    top: "var(--input-icon-inset)",
                    insetInlineEnd: "var(--input-icon-inset)",
                }}
            >
                <ContextVariablePickerButton
                    nodeId={contextNodeId}
                    onSelect={handlePickerSelect}
                />
            </div>
        </div>
    );
}

export interface PropertyReadOnlyTextProps {
    value?: string;
    placeholder?: string;
    multiline?: boolean;
}

export function PropertyReadOnlyText({
    value,
    placeholder,
    multiline,
}: PropertyReadOnlyTextProps) {
    return (
        <div
            className={`zotflow-wf-props-readonly-text ${!value ? "is-empty" : ""} ${multiline ? "is-multiline" : ""}`}
        >
            {value || placeholder}
        </div>
    );
}

export interface PropertyCheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
    id?: string;
    checked: boolean;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function PropertyCheckbox(props: PropertyCheckboxProps) {
    return <input type="checkbox" {...props} />;
}
