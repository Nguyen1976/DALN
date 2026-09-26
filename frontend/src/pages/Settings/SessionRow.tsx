import { useId, useState, type ReactNode } from "react";

import type { UserSession } from "@/apis/user";
import { ChevronDown, ExternalLink, type AppIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  formatFullDateTime,
  formatLastActive,
  formatSignInDate,
} from "@/utils/formatDateTime";
import { formatPlace, googleMapsUrl, zoomForRadius } from "@/utils/geo";
import { SessionMiniMap } from "./SessionMiniMap";

/** Nối các phần có giá trị bằng " · ". */
const joinParts = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const fullTime = (ms: number) => formatFullDateTime(new Date(ms).toISOString());

/**
 * Một thiết bị trong "Phiên đăng nhập": dòng thu gọn để quét nhanh, bấm vào để
 * xem nó đăng nhập ở đâu, lúc nào, và gần nhất đang ở đâu.
 *
 * Nút toggle chỉ bọc icon và chữ. `children` (nút Đăng xuất) nằm cạnh nó vì
 * HTML không cho lồng button.
 */
export function SessionRow({
  icon: Icon,
  title,
  summary,
  session,
  children,
}: {
  icon: AppIcon;
  title: string;
  summary: ReactNode;
  /** Chưa có (danh sách còn đang tải) thì hàng vẫn hiện nhưng chưa mở được. */
  session: UserSession | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const head = (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-sm break-words text-muted-foreground">
          {summary}
        </span>
      </span>
    </>
  );

  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 py-4 sm:px-5">
        {session ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="-m-1.5 flex min-w-0 flex-1 items-center gap-3.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {head}
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3.5">{head}</div>
        )}
        {children && (
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        )}
      </div>
      {session && open && <SessionDetails id={panelId} session={session} />}
    </div>
  );
}

function SessionDetails({ id, session }: { id: string; session: UserSession }) {
  // Bản đồ, bán kính và link cùng một nguồn: thiết bị đang ở đâu. Cố ý KHÔNG
  // lùi về vị trí lúc đăng nhập — IP gần nhất không tra được thì vẽ nơi cũ
  // chẳng khác gì nói "thiết bị vẫn ở đó", đúng loại an tâm giả trang này phải
  // tránh. Server đã trả lastLocation theo `lastIp || ip`, nên phiên chưa từng
  // đổi IP vẫn có bản đồ.
  const shown = session.lastLocation;
  // `?? session.ip`: API cũ trong lúc deploy chưa có lastIp.
  const lastIp = session.lastIp ?? session.ip;

  return (
    <div id={id} className="space-y-3 px-4 pb-4 sm:px-5 sm:pl-[4.375rem]">
      {shown ? (
        <>
          <SessionMiniMap location={shown} />
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Ước tính từ IP · bán kính ~{Math.round(shown.accuracyRadiusKm)} km
            </span>
            <a
              href={googleMapsUrl(
                shown.latitude,
                shown.longitude,
                zoomForRadius(shown.latitude, shown.accuracyRadiusKm),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Mở trên Google Maps
              <ExternalLink className="size-3.5" />
            </a>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Không xác định được vị trí.
        </p>
      )}

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <dt className="text-muted-foreground">Đăng nhập lần đầu</dt>
        <dd
          className="min-w-0 break-words text-foreground"
          title={fullTime(session.createdAt)}
        >
          {joinParts(
            formatSignInDate(session.createdAt),
            formatPlace(session.location),
            session.ip && `IP ${session.ip}`,
          )}
        </dd>
        <dt className="text-muted-foreground">Hoạt động gần nhất</dt>
        <dd
          className="min-w-0 break-words text-foreground"
          title={fullTime(session.lastSeenAt)}
        >
          {joinParts(
            capitalize(formatLastActive(session.lastSeenAt)),
            formatPlace(session.lastLocation),
            lastIp && `IP ${lastIp}`,
          )}
        </dd>
      </dl>

      {shown && (
        <p className="text-xs text-muted-foreground">
          Dữ liệu vị trí: GeoLite2 (
          <a
            href="https://www.maxmind.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            MaxMind
          </a>
          ) · Bản đồ ©{" "}
          <a
            href="https://www.esri.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Esri
          </a>
        </p>
      )}
    </div>
  );
}
