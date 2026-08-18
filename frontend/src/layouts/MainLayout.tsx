import { LeftNavigation } from "@/components/LeftNavigation";
import React from "react";

/**
 * App shell for authenticated screens.
 *
 * Theme is provided at the root (main.tsx) so every route — including the
 * auth screens outside this layout — shares one theme context.
 */
const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex h-[100dvh] w-full flex-col-reverse overflow-hidden bg-background text-foreground md:flex-row">
      <a
        href="#main-content"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
      >
        Bỏ qua điều hướng
      </a>
      <LeftNavigation />
      <div id="main-content" className="flex min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
};

export default MainLayout;
