import { useEffect } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthPage from "./pages/Auth";
import ChatPage from "./pages/Chat";

import { createBrowserRouter, RouterProvider } from "react-router";
import { socket } from "./lib/socket";
import { FriendsPage } from "./pages/Friend/FriendPage";
import ListFriend from "./pages/Friend/ListFriend";
import ListGroupCommunity from "./pages/Friend/ListGroupCommunity";
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
import { upsertOnlineFriend, updateStatusOffline } from "./redux/slices/friendSlice";
import NotificationSettingsPage from "./pages/NotificationSettings";

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthPage />,
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
    element: (
      <ProtectedRoute>
        <FriendsPage>
          <ListGroupCommunity />
        </FriendsPage>
      </ProtectedRoute>
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
    element: (
      <ProtectedRoute>
        <NotificationSettingsPage />
      </ProtectedRoute>
    ),
  },
]);

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const [play] = useSound(notificationSound, { volume: 0.5 });

  useEffect(() => {
    if (!user?.id) return;

    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const handler = ({ conversation }: { conversation: Conversation }) => {
      dispatch(addConversation({ conversation, userId: user.id }));
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
    const handleOfflineStatusChanged = (data: { userId: string; lastSeen: string }) => {
      console.log("handleOfflineStatusChanged", data.userId, data.lastSeen);
      dispatch(updateStatusOffline({ friendId: data.userId, lastSeen: data.lastSeen }));
    };

    socket.on("user.offline_status_changed", handleOfflineStatusChanged);

    return () => {
      socket.off("user.offline_status_changed", handleOfflineStatusChanged);
    };
  }, [dispatch]);

  return <RouterProvider router={router} />;
}

export default App;
