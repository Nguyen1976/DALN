import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { UserPlus } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export default function RecommendationPage() {
  const user = useSelector(selectUser);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<
    RecommendationCandidateItem[]
  >([]);

  const loadRecommendations = async () => {
    try {
      setIsLoading(true);
      const response = await getMyRecommendationsAPI();
      setRecommendations(response.candidates || []);
    } catch (error) {
      console.log(error);
      toast.error("Không tải được danh sách gợi ý bạn bè");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadRecommendations();
  }, [user?.id]);

  const handleMakeFriend = async (candidate: RecommendationCandidateItem) => {
    try {
      const profile = await getUserProfileByIdAPI(candidate.candidateId);
      if (!profile?.email) {
        toast.error("Không lấy được email của người dùng này");
        return;
      }

      await makeFriendRequest(profile.email);
      toast.success(`Đã gửi lời mời kết bạn đến ${candidate.profile.username}`);
    } catch (error) {
      console.log(error);
      toast.error("Không thể gửi lời mời kết bạn");
    }
  };

  const emptyState = !isLoading && recommendations.length === 0;

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-black-bland min-h-0">
        <div className="border-b p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Danh sách bạn bè gợi ý</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Chỉ hiển thị danh sách người dùng và nút kết bạn.
              </p>
            </div>

            <Button
              variant="outline"
              className="bg-transparent"
              onClick={() => void loadRecommendations()}
              disabled={isLoading}
            >
              Tải lại
            </Button>
          </div>
        </div>

        <ScrollArea className="h-full">
          <div className="p-6">
            {isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index} className="bg-card/60">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-4">
                        <Skeleton className="h-14 w-14 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-56" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                        <Skeleton className="h-10 w-24" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {emptyState && (
              <div className="rounded-2xl border border-dashed p-10 text-center bg-card/30">
                <p className="text-lg font-medium">Chưa có danh sách bạn bè</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Hệ thống sẽ hiển thị người dùng phù hợp khi đã có dữ liệu.
                </p>
              </div>
            )}

            {!isLoading && recommendations.length > 0 && (
              <div className="space-y-3">
                {recommendations.map((candidate) => {
                  const profile = candidate.profile;

                  return (
                    <Card
                      key={candidate.candidateId}
                      className="bg-card/70 border-border/60"
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="flex items-start gap-4 min-w-0 flex-1">
                            <div className="relative shrink-0">
                              <Avatar className="h-14 w-14 border">
                                <AvatarImage
                                  src={profile.avatar || "/placeholder.svg"}
                                  alt={profile.username}
                                />
                                <AvatarFallback>
                                  {profile.username?.[0]?.toUpperCase() || "U"}
                                </AvatarFallback>
                              </Avatar>
                              {profile.isActive ? (
                                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-green-500" />
                              ) : null}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-base font-semibold">
                                  {profile.fullName || profile.username}
                                </h3>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                @{profile.username}
                              </p>
                              {profile.bio ? (
                                <p className="mt-2 line-clamp-2 text-sm text-foreground/80">
                                  {profile.bio}
                                </p>
                              ) : (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  Chưa có bio
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-2 md:flex-col md:items-stretch">
                            <Button
                              className="interceptor-loading"
                              onClick={() => void handleMakeFriend(candidate)}
                            >
                              <UserPlus className="mr-2 h-4 w-4" />
                              Kết bạn
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </MainLayout>
  );
}
