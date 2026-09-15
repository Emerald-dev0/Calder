import * as React from "react";
import { cn } from "../utils.js";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[#0B0C0E] text-white hover:bg-[#1a1d21] border border-[#0B0C0E] shadow-sm",
  secondary: "bg-white text-[#0B0C0E] border border-[#E5E5E5] hover:bg-[#F5F4EF]",
  outline: "bg-transparent text-[#0B0C0E] border border-[#D4D4D4] hover:bg-[#F5F4EF]",
  ghost:
    "bg-transparent text-[#737373] hover:text-[#0B0C0E] hover:bg-[#F5F4EF] border border-transparent",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs font-medium",
  md: "h-9 px-4 text-sm font-medium",
  lg: "h-10 px-6 text-sm font-medium",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
