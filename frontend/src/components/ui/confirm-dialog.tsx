import { AlertTriangle, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One confirmation dialog for every irreversible action.
 *
 * Some destructive actions ran on the first click, and the ones that did ask
 * used `window.confirm` — an OS dialog that ignores the app's theme, cannot
 * name the thing being deleted in the app's own voice, and blocks the whole
 * page. This keeps the wording pattern in one place: what will happen, to
 * what, and that it cannot be undone.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Huỷ",
  pendingLabel,
  destructive = true,
  isPending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  destructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {destructive && (
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/12 text-destructive-text"
              >
                <AlertTriangle className="size-5" />
              </span>
            )}
            <div className="min-w-0 space-y-1.5 text-left">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="leading-relaxed">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
          {/* Cancel comes first and is the resting focus: the destructive
              button should never be the one Enter lands on. */}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isPending ? (pendingLabel ?? "Đang xử lý...") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
