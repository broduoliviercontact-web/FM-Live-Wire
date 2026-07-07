import type { Config } from "tailwindcss";

// shadcn/ui theme (Tailwind v3). Dark by default via the `.dark` class on <html>.
// Story 6.2 — DESIGN.md tokens are now wired in: the semantic signal / base /
// midi colors are exposed as raw `var(--c-*)` utilities (bg-on-air, text-info,
// border-l-late, …) and the shadcn HSL slots are remapped onto the same hex
// values in `src/index.css` `.dark`. Fonts: Inter (UI) + JetBrains Mono (data).
const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Story 6.2 — DESIGN.md semantic tokens (raw hex vars from tokens.css).
        // Used as utilities: bg-on-air, text-info, border-l-late, bg-danger-fill…
        "on-air": "var(--c-on-air)",
        connected: "var(--c-connected)",
        late: "var(--c-late)",
        danger: "var(--c-danger)",
        "danger-fill": "var(--c-danger-fill)",
        info: "var(--c-info)",
        surface: "var(--c-surface)",
        "surface-2": "var(--c-surface-2)",
        "border-strong": "var(--c-border-strong)",
        "pitch-bend": "var(--c-pitch-bend)",
        "note-on": "var(--c-note-on)",
        "note-off": "var(--c-note-off)",
        ink: {
          DEFAULT: "var(--c-ink-primary)",
          secondary: "var(--c-ink-secondary)",
          muted: "var(--c-ink-muted)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // DESIGN.md `rounded.pill` — status pills only.
        pill: "999px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Story 6.1 — on-air pulse (DESIGN.md `pulse_on_air` 1.6s). A sober
        // opacity pulse for the landing on-air dot; disabled under
        // prefers-reduced-motion (the component also gates the class via the
        // `usePrefersReducedMotion` hook for testability, AC-U2 / UX-DR3).
        "pulse-on-air": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-on-air": "pulse-on-air 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;