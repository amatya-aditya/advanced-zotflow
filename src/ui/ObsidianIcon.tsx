import React, { useCallback, useEffect, useRef } from "react";
import { setIcon } from "obsidian";

interface ObsidianIconProps {
    icon: string;
    className?: string;
    containerStyle?: React.CSSProperties;
    iconStyle?: React.CSSProperties;
    onClick?: () => void;
}

/** React wrapper that renders an Obsidian icon via `setIcon()` inside a ref-managed div. */
export const ObsidianIcon = React.forwardRef<HTMLDivElement, ObsidianIconProps>(
    ({ icon, className, containerStyle, iconStyle, onClick }, forwardedRef) => {
        const localRef = useRef<HTMLDivElement | null>(null);

        const setRefs = useCallback(
            (node: HTMLDivElement | null) => {
                localRef.current = node;
                if (typeof forwardedRef === "function") {
                    forwardedRef(node);
                } else if (forwardedRef) {
                    (
                        forwardedRef
                    ).current = node;
                }
            },
            [forwardedRef],
        );

        useEffect(() => {
            const container = localRef.current;
            if (!container) {
                return;
            }

            container.innerHTML = "";
            setIcon(container, icon);

            if (iconStyle) {
                const iconElement = container.firstElementChild as HTMLElement | null;
                if (iconElement) {
                    Object.assign(iconElement.style, iconStyle);
                }
            }
        }, [icon, iconStyle]);

        return (
            <div
                ref={setRefs}
                className={className}
                style={{ display: "flex", alignItems: "center", ...containerStyle }}
                onClick={onClick}
            />
        );
    },
);

ObsidianIcon.displayName = "ObsidianIcon";
