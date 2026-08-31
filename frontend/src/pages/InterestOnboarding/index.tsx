import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandLockup } from "@/components/Brand";
import { Check, Loader2, Sparkles } from "lucide-react";
import { getInterestTagsAPI, type InterestTagItem } from "@/apis";
import {
  completeInterestOnboardingAPI,
  selectUser,
} from "@/redux/slices/userSlice";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/redux/store";

const RECOMMENDED_MIN = 3;

const CATEGORY_LABELS: Record<string, string> = {
  music: "Âm nhạc",
  sport: "Thể thao",
  sports: "Thể thao",
  movie: "Phim ảnh",
  movies: "Phim ảnh",
  travel: "Du lịch",
  food: "Ẩm thực",
  tech: "Công nghệ",
  technology: "Công nghệ",
  game: "Trò chơi",
  gaming: "Trò chơi",
  book: "Sách",
  books: "Sách",
  art: "Nghệ thuật",
  fashion: "Thời trang",
  pet: "Thú cưng",
  pets: "Thú cưng",
  other: "Khác",
  creative: "Sáng tạo",
  education: "Học tập",
  entertainment: "Giải trí",
  lifestyle: "Đời sống",
  social: "Xã hội",
  outdoors: "Ngoài trời",
  wellness: "Sức khoẻ",
  business: "Kinh doanh",
  finance: "Tài chính",
};

const categoryLabel = (key: string) =>
  CATEGORY_LABELS[key] ?? key.replace(/-/g, " ");

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

  /**
   * `skip: true` finishes onboarding with no interests.
   *
   * The step sharpens friend suggestions; it is not a gate. Without a way out,
   * a new account that does not want to answer is simply stuck on this screen,
   * because every private route redirects back here until it is completed.
   */
  const onSubmit = async ({ skip = false } = {}) => {
    if (!skip && selected.size === 0) {
      toast.info("Vui lòng chọn ít nhất một sở thích");
      return;
    }
    setSubmitting(true);
    try {
      const slugs = skip ? [] : [...selected];
      await dispatch(completeInterestOnboardingAPI(slugs)).unwrap();
      toast.success(
        skip
          ? "Bạn có thể chọn sở thích sau trong phần hồ sơ"
          : "Đã lưu sở thích của bạn",
      );
      navigate("/", { replace: true });
    } catch (e) {
      const message = typeof e === "string" ? e : "Không thể lưu, vui lòng thử lại";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = Math.max(0, RECOMMENDED_MIN - selected.size);

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-40 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 right-0 size-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-30">
        <ModeToggle />
      </div>

      <div className="relative z-20 mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-5 py-10 sm:px-8">
        <BrandLockup className="mb-10" />

        <header className="mb-8 space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Bước cuối
          </span>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-foreground">
            Bạn quan tâm điều gì?
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Chọn vài chủ đề bạn thích để chúng tôi gợi ý những người bạn có cùng
            sở thích. Bạn có thể thay đổi bất cứ lúc nào trong phần cài đặt.
          </p>
        </header>

        <div className="min-h-0 flex-1 pb-32">
          {loadingTags ? (
            <div className="space-y-8">
              {Array.from({ length: 3 }).map((_, groupIndex) => (
                <div key={groupIndex} className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 7 }).map((_, chipIndex) => (
                      <Skeleton
                        key={chipIndex}
                        className="h-9 w-28 rounded-full"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(([category, items]) => (
                <section key={category} className="space-y-3">
                  <h2 className="text-sm font-semibold capitalize text-foreground">
                    {categoryLabel(category)}
                  </h2>
                  {/* Chips wrap instead of truncating so no label is ever cut. */}
                  <div className="flex flex-wrap gap-2">
                    {items.map((tag) => {
                      const on = selected.has(tag.slug);
                      return (
                        <Chip
                          key={tag.id}
                          selected={on}
                          onClick={() => toggle(tag.slug)}
                        >
                          {tag.emoji && (
                            <span aria-hidden="true">{tag.emoji}</span>
                          )}
                          <span>{tag.label}</span>
                          {on && (
                            <Check className="size-3.5" aria-hidden="true" />
                          )}
                        </Chip>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Sticky action bar: the primary action stays reachable no matter how
            long the tag list gets. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Đã chọn{" "}
              <span className="font-semibold text-foreground">
                {selected.size}
              </span>{" "}
              chủ đề
              {remaining > 0 && selected.size > 0
                ? ` — chọn thêm ${remaining} nữa để gợi ý chính xác hơn`
                : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={submitting}
                onClick={() => void onSubmit({ skip: true })}
              >
                Bỏ qua
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={submitting || loadingTags || selected.size === 0}
                onClick={() => void onSubmit()}
              >
                {submitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {submitting ? "Đang lưu…" : "Tiếp tục"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
