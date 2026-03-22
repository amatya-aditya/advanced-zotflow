import React, { useEffect, useRef } from "react";
import { setIcon } from "obsidian";

interface ObsidianIconProps {
    ref?: React.RefObject<HTMLDivElement | null>;
    icon: string;
    className?: string;
    containerStyle?: React.CSSProperties;
    iconStyle?: React.CSSProperties;
    onClick?: () => void;
}

/** React wrapper that renders an Obsidian icon via `setIcon()` inside a ref-managed div. */
export const ObsidianIcon: React.FC<ObsidianIconProps> = ({
    ref,
    icon,
    className,
    containerStyle,
    iconStyle,
    onClick,
}) => {
    if (!ref) {
        ref = useRef<HTMLDivElement | null>(null);
    }

    useEffect(() => {
        if (ref.current) {
            ref.current.innerHTML = "";
            setIcon(ref.current, icon);
        }
        if (iconStyle) {
            const iconElement = ref.current?.firstElementChild as HTMLElement;
            if (iconElement) {
                Object.assign(iconElement.style, iconStyle);
            }
        }
    }, [icon]);

    return (
        <div
            ref={ref}
            className={className}
            style={{ display: "flex", alignItems: "center", ...containerStyle }}
            onClick={onClick}
        />
    );
};
