import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { getInterestTagsAPI, type InterestTagItem } from "@/apis";
import {
  completeInterestOnboardingAPI,
  selectUser,
} from "@/redux/slices/userSlice";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/redux/store";

function groupByCategory(tags: InterestTagItem[]) {
  const map = new Map<string, InterestTagItem[]>();
  for (const t of tags) {
    const key = t.category || "other";
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function InterestOnboardingPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);

  const [tags, setTags] = useState<InterestTagItem[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user.hasCompletedInterestOnboarding) {
      navigate("/", { replace: true });
    }
  }, [user.hasCompletedInterestOnboarding, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getInterestTagsAPI();
        if (!cancelled) setTags(data);
      } catch (e) {
        if (!cancelled) {
          toast.error(
            getErrorMessage(e, "Không tải được danh sách sở thích"),
          );
        }
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => groupByCategory(tags), [tags]);

  const toggle = useCallback((slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const onSubmit = async () => {
    if (selected.size === 0) {
      toast.info("Vui lòng chọn ít nhất một sở thích");
      return;
    }
    setSubmitting(true);
    try {
      await dispatch(completeInterestOnboardingAPI([...selected])).unwrap();
      toast.success("Đã lưu sở thích của bạn");
      navigate("/", { replace: true });
    } catch (e) {
      const message = typeof e === "string" ? e : "Không thể lưu, vui lòng thử lại";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 size-80 rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div className="relative z-20 flex w-full max-w-lg justify-center">
        <Card className="relative flex max-h-[90dvh] w-full flex-col border-border/60 bg-card/80 shadow-2xl backdrop-blur-xl">
          <div className="absolute top-4 right-4">
            <ModeToggle />
          </div>

          <CardHeader className="space-y-1 shrink-0">
            <CardTitle className="text-2xl font-bold text-center">
              Chọn sở thích của bạn
            </CardTitle>
            <CardDescription className="text-center">
              Giúp chúng tôi gợi ý bạn bè và nội dung phù hợp hơn. Bạn có thể chọn
              nhiều nhãn.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 min-h-0 flex-1">
            <p className="text-center text-sm text-muted-foreground">
              Đã chọn: {selected.size}
            </p>

            {loadingTags ? (
              <div className="space-y-6 py-2">
                {Array.from({ length: 3 }).map((_, groupIndex) => (
                  <div key={groupIndex} className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 6 }).map((_, chipIndex) => (
                        <Skeleton
                          key={chipIndex}
                          className="h-8 w-24 rounded-full"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[min(420px,50vh)] pr-3">
                <div className="space-y-6 pb-2">
                  {grouped.map(([category, items]) => (
                    <div key={category} className="space-y-2">
                      <h3 className="text-sm font-semibold capitalize text-foreground/90">
                        {category.replace(/-/g, " ")}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {items.map((tag) => {
                          const on = selected.has(tag.slug);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggle(tag.slug)}
                              className={[
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                                on
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border bg-background/60 hover:bg-muted/80",
                              ].join(" ")}
                            >
                              <span aria-hidden>{tag.emoji}</span>
                              <span>{tag.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <Button
              type="button"
              className="w-full shrink-0"
              disabled={submitting || loadingTags || selected.size === 0}
              onClick={() => void onSubmit()}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Đang lưu…" : "Tiếp tục"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
