import { useEffect } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthPage from "./pages/Auth";
import ChatPage from "./pages/Chat";

import { createBrowserRouter, RouterProvider } from "react-router";
import { socket } from "./lib/socket";
import {
  installSocketAuthRecovery,
  resetSocketAuthRetries,
} from "./lib/socketAuth";
import { FriendsPage } from "./pages/Friend/FriendPage";
import ListFriend from "./pages/Friend/ListFriend";
import ListFriendRequests from "./pages/Friend/ListFriendRequests";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "./redux/store";
import { useSound } from "use-sound";
import notificationSound from "./assets/notification.mp3";
import {
  addConversation,
  type Conversation,
} from "./redux/slices/conversationSlice";
import { selectUser } from "./redux/slices/userSlice";
import {
  addNotification,
  type Notification,
} from "./redux/slices/notificationSlice";
import {
  upsertOnlineFriend,
  updateStatusOffline,
} from "./redux/slices/friendSlice";
import { useChatSocketEvents } from "./hooks/useChatSocketEvents";
import IncomingCallManager from "./components/IncomingCallManager";
import { CallProvider } from "./contexts/CallProvider";
import { Spinner } from "@/components/ui/feedback";
import VerifyOtpPage from "./pages/VerifyOtp";

/**
 * Secondary screens are split out of the first bundle.
 *
 * Suggestions, notification settings, the interests step and the group list
 * were all pulled in on the very first load even though most sessions never
 * open them.
 *
 * They load through the route's `lazy`, not React.lazy + Suspense. The router
 * fetches the chunk before it commits the navigation, so the current screen
 * (left nav included) stays up until the next one is ready. The old Suspense
 * boundary sat outside each page's MainLayout, so the first visit swapped the
 * whole app shell for a spinner, which looked like a full page reload.
 */
const lazyProtected =
  (
    load: () => Promise<{ default: React.ComponentType }>,
    frame: (page: React.ReactNode) => React.ReactNode = (page) => page,
  ) =>
  async () => {
    const { default: Page } = await load();
    return { element: <ProtectedRoute>{frame(<Page />)}</ProtectedRoute> };
  };

/** Only shown when the app is opened directly on a lazy route (F5, a link). */
function RouteFallback() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center">
      <Spinner label="Đang tải màn hình" />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthPage />,
  },
  {
    path: "/verify-otp",
    element: <VerifyOtpPage />,
  },
  {
    path: "/onboarding/interests",
    hydrateFallbackElement: <RouteFallback />,
    lazy: lazyProtected(() => import("./pages/InterestOnboarding")),
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <ChatPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/chat/:conversationId",
    element: (
      <ProtectedRoute>
        <ChatPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/friends",
    element: (
      <ProtectedRoute>
        <FriendsPage>
          <ListFriend />
        </FriendsPage>
      </ProtectedRoute>
    ),
  },
  {
    path: "/groups",
    hydrateFallbackElement: <RouteFallback />,
    lazy: lazyProtected(
      () => import("./pages/Friend/ListGroupCommunity"),
      (page) => <FriendsPage>{page}</FriendsPage>,
    ),
  },
  {
    path: "/friend_requests",
    element: (
      <ProtectedRoute>
        <FriendsPage>
          <ListFriendRequests />
        </FriendsPage>
      </ProtectedRoute>
    ),
  },
  {
    path: "/settings/notifications",
    hydrateFallbackElement: <RouteFallback />,
    lazy: lazyProtected(() => import("./pages/NotificationSettings")),
  },
  {
    path: "/recommendations",
    hydrateFallbackElement: <RouteFallback />,
    lazy: lazyProtected(() => import("./pages/Recommendation")),
  },
]);

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const [play] = useSound(notificationSound, { volume: 0.5 });

  // Setup chat socket events (typing indicator, seen status)
  useChatSocketEvents();

  useEffect(() => {
    if (!user?.id) return;

    // Gắn cơ chế hồi phục TRƯỚC khi nối: server có thể từ chối ngay ở handshake
    // (access hết hạn) và Socket.IO không tự thử lại sau `io server disconnect`.
    installSocketAuthRecovery();
    resetSocketAuthRetries();
    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const handler = ({ conversation }: { conversation: Conversation }) => {
      dispatch(addConversation({ conversation }));
    };

    socket.on("chat.new_conversation", handler);

    return () => {
      socket.off("chat.new_conversation", handler);
    };
  }, [dispatch, user.id]);

  useEffect(() => {
    const handler = (data: Notification) => {
      dispatch(addNotification(data));
      // play();
    };

    socket.on("notification.new_notification", handler);

    return () => {
      socket.off("notification.new_notification", handler);
    };
  }, [dispatch, play]);

  useEffect(() => {
    const handleOnlineStatusChanged = (userId: string) => {
      void dispatch(upsertOnlineFriend(userId));
    };

    socket.on("user.online_status_changed", handleOnlineStatusChanged);

    return () => {
      socket.off("user.online_status_changed", handleOnlineStatusChanged);
    };
  }, [dispatch]);

  useEffect(() => {
    const handleOfflineStatusChanged = (data: {
      userId: string;
      lastSeen: string;
    }) => {
      dispatch(
        updateStatusOffline({ friendId: data.userId, lastSeen: data.lastSeen }),
      );
    };

    socket.on("user.offline_status_changed", handleOfflineStatusChanged);

    return () => {
      socket.off("user.offline_status_changed", handleOfflineStatusChanged);
    };
  }, [dispatch]);

  return (
    // CallProvider ở cấp app (ngoài router): cuộc gọi ra ngoài sống xuyên trang,
    // "thu nhỏ để tiếp tục nhắn tin" hoạt động. Cuộc gọi đến do IncomingCallManager.
    <CallProvider>
      <RouterProvider router={router} />
      {user?.id ? <IncomingCallManager /> : null}
    </CallProvider>
  );
}

export default App;
