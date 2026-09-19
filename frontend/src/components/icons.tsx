/**
 * Every icon in the app is imported from here, never from lucide-react
 * directly.
 *
 * Where Animate UI ships an animated version (Lucide's glyph drawn with
 * Motion), the name points to it; the rest stay Lucide's static icons. A few
 * names map to the closest animated glyph with the same meaning: Phone ->
 * PhoneCall, SquarePen (new group) -> MessageSquarePlus, Maximize2/Minimize2
 * -> Maximize/Minimize, KeyRound -> Key, Settings2 -> SlidersHorizontal,
 * OctagonXIcon -> CircleX.
 *
 * Animated icons sit still until triggered. Buttons, tab triggers and menu
 * items animate the icons inside them on hover (see those ui components);
 * elsewhere, wrap with <AnimateIcon animateOnHover> or animateOnView.
 * They are normalised to Lucide's defaults (24px, aria-hidden), so moving a
 * name between the two lists changes nothing at the call sites.
 */
import type * as React from "react";

import type { IconProps } from "@/components/animate-ui/icons/icon";
import { ArrowLeft as AnimatedArrowLeft } from "@/components/animate-ui/icons/arrow-left";
import { Bell as AnimatedBell } from "@/components/animate-ui/icons/bell";
import { BellOff as AnimatedBellOff } from "@/components/animate-ui/icons/bell-off";
import { BellRing as AnimatedBellRing } from "@/components/animate-ui/icons/bell-ring";
import { ChartColumn as AnimatedChartColumn } from "@/components/animate-ui/icons/chart-column";
import { Check as AnimatedCheck } from "@/components/animate-ui/icons/check";
import { CheckCheck as AnimatedCheckCheck } from "@/components/animate-ui/icons/check-check";
import { ChevronDown as AnimatedChevronDown } from "@/components/animate-ui/icons/chevron-down";
import { ChevronRight as AnimatedChevronRight } from "@/components/animate-ui/icons/chevron-right";
import { CircleCheck as AnimatedCircleCheck } from "@/components/animate-ui/icons/circle-check";
import { CircleX as AnimatedCircleX } from "@/components/animate-ui/icons/circle-x";
import { Clock as AnimatedClock } from "@/components/animate-ui/icons/clock";
import { Ellipsis as AnimatedEllipsis } from "@/components/animate-ui/icons/ellipsis";
import { EllipsisVertical as AnimatedEllipsisVertical } from "@/components/animate-ui/icons/ellipsis-vertical";
import { Key as AnimatedKey } from "@/components/animate-ui/icons/key";
import { Link2 as AnimatedLink2 } from "@/components/animate-ui/icons/link-2";
import { Lock as AnimatedLock } from "@/components/animate-ui/icons/lock";
import { LogOut as AnimatedLogOut } from "@/components/animate-ui/icons/log-out";
import { MapPin as AnimatedMapPin } from "@/components/animate-ui/icons/map-pin";
import { Maximize as AnimatedMaximize } from "@/components/animate-ui/icons/maximize";
import { MessageCircle as AnimatedMessageCircle } from "@/components/animate-ui/icons/message-circle";
import { MessageSquare as AnimatedMessageSquare } from "@/components/animate-ui/icons/message-square";
import { MessageSquareOff as AnimatedMessageSquareOff } from "@/components/animate-ui/icons/message-square-off";
import { MessageSquarePlus as AnimatedMessageSquarePlus } from "@/components/animate-ui/icons/message-square-plus";
import { MessageSquareText as AnimatedMessageSquareText } from "@/components/animate-ui/icons/message-square-text";
import { Minimize as AnimatedMinimize } from "@/components/animate-ui/icons/minimize";
import { Moon as AnimatedMoon } from "@/components/animate-ui/icons/moon";
import { Paperclip as AnimatedPaperclip } from "@/components/animate-ui/icons/paperclip";
import { PhoneCall as AnimatedPhoneCall } from "@/components/animate-ui/icons/phone-call";
import { Pin as AnimatedPin } from "@/components/animate-ui/icons/pin";
import { PinOff as AnimatedPinOff } from "@/components/animate-ui/icons/pin-off";
import { Plus as AnimatedPlus } from "@/components/animate-ui/icons/plus";
import { RefreshCw as AnimatedRefreshCw } from "@/components/animate-ui/icons/refresh-cw";
import { RotateCcw as AnimatedRotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { Search as AnimatedSearch } from "@/components/animate-ui/icons/search";
import { Send as AnimatedSend } from "@/components/animate-ui/icons/send";
import { Settings as AnimatedSettings } from "@/components/animate-ui/icons/settings";
import { SlidersHorizontal as AnimatedSlidersHorizontal } from "@/components/animate-ui/icons/sliders-horizontal";
import { Sparkles as AnimatedSparkles } from "@/components/animate-ui/icons/sparkles";
import { Sun as AnimatedSun } from "@/components/animate-ui/icons/sun";
import { Trash2 as AnimatedTrash2 } from "@/components/animate-ui/icons/trash-2";
import { User as AnimatedUser } from "@/components/animate-ui/icons/user";
import { UserRound as AnimatedUserRound } from "@/components/animate-ui/icons/user-round";
import { Users as AnimatedUsers } from "@/components/animate-ui/icons/users";
import { UsersRound as AnimatedUsersRound } from "@/components/animate-ui/icons/users-round";
import { Volume2 as AnimatedVolume2 } from "@/components/animate-ui/icons/volume-2";
import { X as AnimatedX } from "@/components/animate-ui/icons/x";

export { AnimateIcon } from "@/components/animate-ui/icons/icon";

/** Anything the app renders as an icon, animated or Lucide. */
export type AppIcon = React.ComponentType<{ className?: string }>;

function lucideLike<P extends IconProps<string>>(Icon: React.ComponentType<P>) {
  function LucideLikeIcon(props: P) {
    return <Icon {...({ size: 24, "aria-hidden": true, ...props } as P)} />;
  }
  return LucideLikeIcon;
}

export const ArrowLeft = lucideLike(AnimatedArrowLeft);
export const BarChart3 = lucideLike(AnimatedChartColumn);
export const Bell = lucideLike(AnimatedBell);
export const BellOff = lucideLike(AnimatedBellOff);
export const BellRing = lucideLike(AnimatedBellRing);
export const Check = lucideLike(AnimatedCheck);
export const CheckIcon = Check;
export const CheckCheck = lucideLike(AnimatedCheckCheck);
export const ChevronDown = lucideLike(AnimatedChevronDown);
export const ChevronRight = lucideLike(AnimatedChevronRight);
export const ChevronRightIcon = ChevronRight;
export const CircleCheckIcon = lucideLike(AnimatedCircleCheck);
export const Clock = lucideLike(AnimatedClock);
export const Link2 = lucideLike(AnimatedLink2);
export const Lock = lucideLike(AnimatedLock);
export const LogOut = lucideLike(AnimatedLogOut);
export const MapPin = lucideLike(AnimatedMapPin);
export const MessageCircle = lucideLike(AnimatedMessageCircle);
export const MessageSquare = lucideLike(AnimatedMessageSquare);
export const MessageSquareOff = lucideLike(AnimatedMessageSquareOff);
export const MessageSquareText = lucideLike(AnimatedMessageSquareText);
export const Moon = lucideLike(AnimatedMoon);
export const MoreHorizontal = lucideLike(AnimatedEllipsis);
export const MoreVertical = lucideLike(AnimatedEllipsisVertical);
export const Paperclip = lucideLike(AnimatedPaperclip);
export const Pin = lucideLike(AnimatedPin);
export const PinOff = lucideLike(AnimatedPinOff);
export const Plus = lucideLike(AnimatedPlus);
export const RefreshCw = lucideLike(AnimatedRefreshCw);
export const RotateCcw = lucideLike(AnimatedRotateCcw);
export const Search = lucideLike(AnimatedSearch);
export const Send = lucideLike(AnimatedSend);
export const Settings = lucideLike(AnimatedSettings);
export const Sparkles = lucideLike(AnimatedSparkles);
export const Sun = lucideLike(AnimatedSun);
export const Trash2 = lucideLike(AnimatedTrash2);
export const User = lucideLike(AnimatedUser);
export const UserRound = lucideLike(AnimatedUserRound);
export const Users = lucideLike(AnimatedUsers);
export const Users2 = lucideLike(AnimatedUsersRound);
export const UsersRound = Users2;
export const Volume2 = lucideLike(AnimatedVolume2);
export const X = lucideLike(AnimatedX);
export const XIcon = X;
export const Phone = lucideLike(AnimatedPhoneCall);
export const SquarePen = lucideLike(AnimatedMessageSquarePlus);
export const Maximize2 = lucideLike(AnimatedMaximize);
export const Minimize2 = lucideLike(AnimatedMinimize);
export const KeyRound = lucideLike(AnimatedKey);
export const Settings2 = lucideLike(AnimatedSlidersHorizontal);
export const OctagonXIcon = lucideLike(AnimatedCircleX);

// No animated version yet: Lucide's static icons.
export {
  AlertCircle,
  AlertTriangle,
  AtSign,
  Camera,
  CircleIcon,
  Eye,
  EyeOff,
  FileText,
  ImageIcon,
  Inbox,
  InfoIcon,
  ListChecks,
  Loader2,
  Loader2Icon,
  Mail,
  MailCheck,
  MessagesSquare,
  Mic,
  MicOff,
  PencilLine,
  PhoneMissed,
  PhoneOff,
  Quote,
  Reply,
  Save,
  SearchX,
  Shield,
  ShieldCheck,
  Smile,
  SwitchCamera,
  TriangleAlertIcon,
  UserPlus,
  UserX,
  Video,
  VideoOff,
  WifiOff,
  Zap,
} from "lucide-react";
