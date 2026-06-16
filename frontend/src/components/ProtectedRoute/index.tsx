import {
  fetchCurrentUserAPI,
  selectUser,
} from "@/redux/slices/userSlice";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation, useParams } from "react-router";
import { useEffect, useRef } from "react";
import type { AppDispatch } from "@/redux/store";
import { useProtectedRouteChatSockets } from "@/hooks/useProtectedRouteChatSockets";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { conversationId } = useParams();
  const bootstrappedMe = useRef(false);

  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);

  useProtectedRouteChatSockets(conversationId);

  useEffect(() => {
    if (!user?.id) {
      bootstrappedMe.current = false;
      return;
    }
    if (bootstrappedMe.current) return;
    bootstrappedMe.current = true;
    void dispatch(fetchCurrentUserAPI());
  }, [dispatch, user?.id]);

  if (!user?.id) {
    return <Navigate to="/auth" replace />;
  }

  if (
    user.hasCompletedInterestOnboarding === false &&
    !location.pathname.startsWith("/onboarding/interests")
  ) {
    return <Navigate to="/onboarding/interests" replace />;
  }

  return children;
};

export default ProtectedRoute;
