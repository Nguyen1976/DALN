import { LeftNavigation } from "@/components/LeftNavigation";
import { ThemeProvider } from "@/components/ThemeProvider";
import React from "react";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div className="flex h-[100dvh] w-full flex-col-reverse overflow-hidden bg-background text-foreground md:flex-row">
        <LeftNavigation />
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </ThemeProvider>
  );
};

export default MainLayout;
