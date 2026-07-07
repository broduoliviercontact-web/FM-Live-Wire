import type * as React from "react";
import { Toaster as Sonner } from "sonner";
import { cn } from "../../lib/utils";

// Toaster wrapper. next-themes is intentionally not used in this stack;
// dark mode is the default and toggled via the `dark` class on <html>.
type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ className, ...props }: ToasterProps) => {
  return (
    <Sonner
      className={cn("toaster group", className)}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      theme="dark"
      {...props}
    />
  );
};

export { Toaster };