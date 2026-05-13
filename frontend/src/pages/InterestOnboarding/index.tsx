import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
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
          console.error("[interest-tags]", e);
          toast.error(
            e instanceof Error
              ? e.message
              : "Không tải được danh sách sở thích",
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
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="relative z-20 flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg backdrop-blur-xl bg-card/80 border-border/50 shadow-2xl relative max-h-[90vh] flex flex-col">
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
              <p className="text-center text-sm text-muted-foreground py-8">
                Đang tải danh mục…
              </p>
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
              {submitting ? "Đang lưu…" : "Tiếp tục"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
