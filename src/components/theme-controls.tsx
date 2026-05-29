"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ACCENT_STORAGE_KEY = "agent-flow-accent";
const ACCENTS = [
  { label: "藍色", value: "blue", swatch: "bg-blue-600" },
  { label: "綠色", value: "green", swatch: "bg-emerald-600" },
  { label: "紫色", value: "violet", swatch: "bg-violet-600" },
] as const;
const MODES = [
  { icon: Sun, label: "淺色", value: "light" },
  { icon: Moon, label: "深色", value: "dark" },
  { icon: Monitor, label: "跟隨系統", value: "system" },
] as const;

type Accent = (typeof ACCENTS)[number]["value"];

function isAccent(value: string | null): value is Accent {
  return ACCENTS.some((accent) => accent.value === value);
}

function readStoredAccent() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "blue";
  }

  try {
    const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccent(storedAccent) ? storedAccent : "blue";
  } catch {
    return "blue";
  }
}

function writeStoredAccent(accent: Accent) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Ignore storage failures; the active DOM theme still applies for this session.
  }
}

export function ThemeControls() {
  const { mounted, resolvedTheme, setTheme, theme } = useTheme();
  const [accent, setAccent] = useState<Accent>("blue");
  const [accentStorageReady, setAccentStorageReady] = useState(false);

  useEffect(() => {
    const restoreAccent = window.setTimeout(() => {
      setAccent(readStoredAccent());
      setAccentStorageReady(true);
    }, 0);

    return () => window.clearTimeout(restoreAccent);
  }, []);

  useEffect(() => {
    if (!mounted || !accentStorageReady) {
      return;
    }

    document.documentElement.dataset.accent = accent;
    writeStoredAccent(accent);
  }, [accent, accentStorageReady, mounted]);

  const currentTheme = mounted ? theme : "system";
  const isDark = mounted && resolvedTheme === "dark";
  const TriggerIcon = isDark ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="切換外觀"
          className="h-10 w-10 bg-background/95 shadow-sm"
          size="icon-lg"
          type="button"
          variant="outline"
        >
          <TriggerIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" sideOffset={8}>
        <DropdownMenuLabel>外觀</DropdownMenuLabel>
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = currentTheme === mode.value;

          return (
            <DropdownMenuItem
              className="cursor-pointer justify-between"
              key={mode.value}
              onSelect={() => setTheme(mode.value)}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {mode.label}
              </span>
              {active ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>強調色</DropdownMenuLabel>
        {ACCENTS.map((item) => {
          const active = accent === item.value;

          return (
            <DropdownMenuItem
              className="cursor-pointer justify-between"
              key={item.value}
              onSelect={() => setAccent(item.value)}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-3 w-3 rounded-full ${item.swatch}`}
                />
                {item.label}
              </span>
              {active ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
          <Palette className="h-3.5 w-3.5" />
          設定會儲存在此瀏覽器
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
