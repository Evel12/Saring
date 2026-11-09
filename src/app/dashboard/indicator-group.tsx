"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

type Box = { x: number; y: number; width: number; height: number };

// Wadah menu atau tab dengan satu "pil" aktif yang meluncur ke item bertanda
// data-active="true". Posisi diukur dari layout, jadi jalan di semua browser.
export function IndicatorGroup({
  as: Tag = "div",
  className = "",
  activeKey,
  children,
  ...rest
}: {
  as?: "div" | "nav";
  className?: string;
  activeKey: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(
        ':scope > [data-active="true"]',
      );
      setBox(
        el
          ? {
              x: el.offsetLeft,
              y: el.offsetTop,
              width: el.offsetWidth,
              height: el.offsetHeight,
            }
          : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [activeKey]);

  // Posisi pertama langsung dipasang, baru setelah itu perpindahan dianimasikan.
  useEffect(() => {
    if (!box || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [box, animate]);

  return (
    <Tag
      ref={ref as RefObject<HTMLDivElement>}
      className={`${className} indicator-group ${box ? "has-indicator" : ""}`}
      {...rest}
    >
      {box && (
        <span
          aria-hidden="true"
          className={`slide-indicator ${animate ? "animate" : ""}`}
          style={{
            width: box.width,
            height: box.height,
            transform: `translate(${box.x}px, ${box.y}px)`,
          }}
        />
      )}
      {children}
    </Tag>
  );
}
