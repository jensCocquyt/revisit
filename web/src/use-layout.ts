import { useSyncExternalStore } from "react";

export type Layout = "phone" | "narrow" | "wide";

// Keep in step with the breakpoints in styles.css.
export function useLayout(): Layout {
  const phone = useMediaQuery("(width < 600px)");
  const narrow = useMediaQuery("(width < 900px)");
  return phone ? "phone" : narrow ? "narrow" : "wide";
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
