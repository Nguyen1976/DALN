import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Shown instead of the default screen, when a section wants its own. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a white screen.
 *
 * Without this, one bad render anywhere — a malformed message payload, a null
 * field the UI did not expect — unmounts the whole React tree and the user is
 * left staring at a blank page with no way back. Catching it turns that into a
 * screen that says what happened and offers a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept on the console on purpose: this is the one place a crash is
    // recoverable, so the stack must stay reachable for whoever debugs it.
    console.error("Lỗi không bắt được trong giao diện:", error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-5 bg-background px-6 text-center"
      >
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-2xl bg-destructive/12 text-destructive-text"
        >
          <AlertTriangle className="size-7" />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            Ứng dụng gặp sự cố
          </h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            Đã có lỗi ngoài dự tính khi hiển thị màn hình này. Dữ liệu của bạn
            không bị ảnh hưởng — hãy tải lại trang để tiếp tục.
          </p>
        </div>
        <Button onClick={this.handleReload}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Tải lại trang
        </Button>
      </div>
    );
  }
}

export default ErrorBoundary;
