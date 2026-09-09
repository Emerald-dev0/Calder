import * as React from "react";
import { cn } from "../utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
 return (
 <div
 className={cn("rounded-xl border border-[#E5E5E5] bg-white shadow-sm", className)}
 {...props}
 />
 );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
 return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
 return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
 return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
