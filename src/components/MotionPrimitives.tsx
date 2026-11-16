"use client";

import React, { useEffect } from "react";
import {
  motion,
  useSpring,
  useTransform,
  AnimatePresence,
} from "framer-motion";

/**
 * 1. Clean KRDS (Gov24) White Card with subtle spring lift on hover
 */
export function GovCard({
  children,
  className = "",
  onClick,
  active = false,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={onClick ? { y: -3 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={`rounded-[16px] bg-white transition-shadow duration-200 ${
        active
          ? "ring-2 ring-[#256EF4] shadow-[0_8px_24px_rgba(37,110,244,0.12)]"
          : "border border-[#E6EAF0] shadow-[0_2px_10px_rgba(15,41,107,0.04)] hover:shadow-[0_8px_24px_rgba(15,41,107,0.08)]"
      } ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </motion.div>
  );
}

/**
 * 2. Spring Physics Number Ticker (Animated Counter)
 */
export function SpringCounter({
  value,
  suffix = "",
  prefix = "",
  className = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const spring = useSpring(value, {
    mass: 0.6,
    stiffness: 110,
    damping: 18,
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  const display = useTransform(spring, (current) =>
    `${prefix}${Math.round(current).toLocaleString("ko-KR")}${suffix}`
  );

  return <motion.span className={`tabular-nums ${className}`}>{display}</motion.span>;
}

/**
 * 3. Smooth Morphing Text (for AI國民비서 Search Bar & Titles)
 */
export function MorphingText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex relative overflow-hidden ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 30,
          }}
          className="inline-block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * 4. Animated SVG Checkmark in Gov24 Blue
 */
export function AnimatedCheckIcon({ checked }: { checked: boolean }) {
  return (
    <div
      className={`w-5 h-5 rounded-[6px] flex items-center justify-center border transition-colors duration-200 shrink-0 ${
        checked
          ? "bg-[#256EF4] border-[#256EF4] text-white"
          : "bg-white border-[#C8D1E0] text-transparent"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
      >
        <motion.path
          d="M20 6L9 17l-5-5"
          initial={false}
          animate={{
            pathLength: checked ? 1 : 0,
            opacity: checked ? 1 : 0,
          }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 28,
          }}
        />
      </svg>
    </div>
  );
}

/**
 * 5. Document Mini Icon Badge (Gov24 '자주 찾는 서비스' orange/blue/teal document icon style)
 */
export function DocMiniBadge({
  tone = "orange",
}: {
  tone?: "orange" | "blue" | "teal" | "rose";
}) {
  const palette = {
    orange: { bg: "bg-[#FFF3E8]", doc: "bg-[#FF8A3D]", badge: "bg-[#256EF4]" },
    blue: { bg: "bg-[#EAF2FE]", doc: "bg-[#256EF4]", badge: "bg-[#00B8A9]" },
    teal: { bg: "bg-[#E6F8F6]", doc: "bg-[#00B8A9]", badge: "bg-[#256EF4]" },
    rose: { bg: "bg-[#FFECEE]", doc: "bg-[#F04452]", badge: "bg-[#FF8A3D]" },
  }[tone];

  return (
    <div
      className={`w-9 h-9 rounded-xl ${palette.bg} flex items-center justify-center relative shrink-0`}
    >
      <div className={`w-4 h-5 rounded-[3px] ${palette.doc} relative opacity-90`}>
        <div className="absolute top-1 left-1 right-1 h-[1.5px] bg-white/80 rounded-full" />
        <div className="absolute top-2.5 left-1 right-1.5 h-[1.5px] bg-white/80 rounded-full" />
      </div>
      <div
        className={`w-2.5 h-2.5 rounded-full ${palette.badge} border-2 border-white absolute -bottom-0.5 -right-0.5`}
      />
    </div>
  );
}

export const SpotlightCard = GovCard;

export function MagneticButton({
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </motion.button>
  );
}

