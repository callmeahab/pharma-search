"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initGA, trackPageView } from "@/utils/analytics";

export function Analytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initGA();
  }, []);

  useEffect(() => {
    if (pathname) {
      trackPageView(
        pathname +
          (searchParams?.toString() ? `?${searchParams.toString()}` : "")
      );
    }
  }, [pathname, searchParams]);

  return null;
}
