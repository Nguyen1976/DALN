import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import {
  Check,
  MapPin,
  RefreshCw,
  Sparkles,
  UserPlus,
  Users,
  Users2,
} from "lucide-react";
import { toast } from "sonner";

import MainLayout from "@/layouts/MainLayout";
import { selectUser } from "@/redux/slices/userSlice";
import {
  getMyRecommendationsAPI,
  getUserProfileByIdAPI,
  makeFriendRequest,
  type RecommendationCandidateItem,
} from "@/apis";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarWithPresence,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { showErrorToast } from "@/utils/toastError";
import { cn } from "@/lib/utils";

/**
 * Turns the raw graph features into the two or three reasons a person actually
 * cares about. Showing *why* someone is suggested is what makes the list
 * trustworthy rather than arbitrary.
 */
function buildReasons(candidate: RecommendationCandidateItem) {
  const reasons: { icon: typeof Users; label: string }[] = [];

  if (candidate.adamic_adar > 0 || candidate.jaccard > 0) {
    reasons.push({ icon: Users, label: "Có bạn chung" });
  }
  if (candidate.same_group > 0 || candidate.group_inter > 0) {
    reasons.push({ icon: Users2, label: "Cùng nhóm" });
  }
  if (candidate.bio_cosine > 0.3) {
    reasons.push({ icon: Sparkles, label: "Sở thích tương đồng" });
  }
  if (candidate.dist_km > 0 && candidate.dist_km <= 50) {
    reasons.push({
      icon: MapPin,
      label:
        candidate.dist_km < 1
          ? "Ngay gần bạn"
          : `Cách ~${Math.round(candidate.dist_km)} km`,
    });
  }

  return reasons.slice(0, 3);
}

export default function RecommendationPage() {
  const user = useSelector(selectUser);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<
    RecommendationCandidateItem[]
  >([]);
  const [pendingCandidateIds, setPendingCandidateIds] = useState<string[]>([]);

  const loadRecommendations = async () => {
    try {
      setIsLoading(true);
      const response = await getMyRecommendationsAPI();
      setRecommendations(response.candidates || []);
    } catch (error) {
      showErrorToast(error, "Không tải được danh sách gợi ý bạn bè");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadRecommendations();
  }, [user?.id]);

  useEffect(() => {
    const handleNotification = (payload: { message?: string } | null) => {
      const message = String(payload?.message ?? "").toLowerCase();
      if (message.includes("lời mời kết bạn") && message.includes("chấp nhận")) {
        void loadRecommendations();
      }
    };

    const handleWindowFocus = () => {
      if (!user?.id) return;
      void loadRecommendations();
    };

    socket.on(SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION, handleNotification);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      socket.off(SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION, handleNotification);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [user?.id]);

  const handleMakeFriend = async (candidate: RecommendationCandidateItem) => {
    const candidateId = candidate.candidateId;
    if (pendingCandidateIds.includes(candidateId)) {
      return;
    }

    setPendingCandidateIds((prev) => [...prev, candidateId]);
    try {
      const profile = await getUserProfileByIdAPI(candidate.candidateId);
      if (!profile?.email) {
        toast.error("Không lấy được email của người dùng này");
        return;
      }

      await makeFriendRequest(profile.email);
      toast.success(`Đã gửi lời mời kết bạn đến ${candidate.profile.username}`);
    } catch (error) {
      showErrorToast(error, "Không thể gửi lời mời kết bạn");
      setPendingCandidateIds((prev) => prev.filter((id) => id !== candidateId));
    }
  };

  const emptyState = !isLoading && recommendations.length === 0;

  return (
    <MainLayout>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PageHeader
          icon={Sparkles}
          title="Gợi ý kết bạn"
          description="Những người có thể bạn quen, dựa trên bạn chung, nhóm và sở thích."
          actions={
            <Button
              variant="outline"
              onClick={() => void loadRecommendations()}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("size-4", isLoading && "animate-spin")}
                aria-hidden="true"
              />
              Tải lại
            </Button>
          }
        />

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {isLoading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <Skeleton className="size-14 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                  <Skeleton className="mt-4 h-10 w-full rounded-lg" />
                </div>
              ))}
            </div>
          )}

          {emptyState && (
            <EmptyState
              icon={UserPlus}
              title="Chưa có gợi ý nào"
              description="Khi bạn kết bạn và tham gia nhóm nhiều hơn, hệ thống sẽ tìm được những người phù hợp với bạn."
              action={
                <Button
                  variant="outline"
                  onClick={() => void loadRecommendations()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Thử lại
                </Button>
              }
            />
          )}

          {!isLoading && recommendations.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {recommendations.map((candidate) => {
                const profile = candidate.profile;
                const reasons = buildReasons(candidate);
                const sent = pendingCandidateIds.includes(
                  candidate.candidateId,
                );

                return (
                  <li
                    key={candidate.candidateId}
                    className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs transition-shadow duration-[--motion-base] hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <AvatarWithPresence
                        status={profile.isActive ? "online" : null}
                      >
                        <Avatar className="size-14 border border-border">
                          <AvatarImage
                            src={profile.avatar || ""}
                            alt={`Ảnh đại diện ${profile.username}`}
                          />
                          <AvatarFallback>
                            {profile.username?.[0]?.toUpperCase() || "U"}
                          </AvatarFallback>
                        </Avatar>
                      </AvatarWithPresence>

                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold leading-tight text-foreground">
                          {profile.fullName || profile.username}
                        </h3>
                        <p className="truncate text-sm text-muted-foreground">
                          @{profile.username}
                        </p>
                        <p
                          className={cn(
                            "mt-1.5 text-sm leading-relaxed",
                            profile.bio
                              ? "text-ellipsis-2 text-foreground/85"
                              : "text-muted-foreground",
                          )}
                        >
                          {profile.bio || "Chưa có giới thiệu"}
                        </p>
                      </div>
                    </div>

                    {reasons.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {reasons.map(({ icon: Icon, label }) => (
                          <li key={label}>
                            <Badge variant="soft">
                              <Icon className="size-3.5" aria-hidden="true" />
                              {label}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}

                    <Button
                      className="interceptor-loading mt-4 w-full"
                      variant={sent ? "outline" : "default"}
                      onClick={() => void handleMakeFriend(candidate)}
                      disabled={sent}
                    >
                      {sent ? (
                        <>
                          <Check className="size-4" aria-hidden="true" />
                          Đã gửi lời mời
                        </>
                      ) : (
                        <>
                          <UserPlus className="size-4" aria-hidden="true" />
                          Kết bạn
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
