import { useState } from "react";

import type { GeoLocation } from "@/apis/user";
import {
  circleRadiusPx,
  project,
  TILE_SIZE,
  tilesAround,
  zoomForRadius,
} from "@/utils/geo";

/** Khung cố định: số tile cần tải là hàm thuần của toạ độ, không phải đo DOM. */
const WIDTH = 320;
const HEIGHT = 160;

/**
 * Bản đồ tĩnh ghép từ tile Esri. Vòng tròn đỏ là VÙNG BẤT ĐỊNH của vị
 * trí ước tính từ IP chứ không phải một điểm: IP chỉ biết tới quốc gia sẽ hiện
 * thành một vòng phủ cả nước, không phải một pin trông chính xác.
 *
 * Tile nào lỗi (mất mạng, bị chặn) thì bỏ cả khối. Nhãn và link Maps nằm ngoài
 * component này nên vẫn còn — người dùng chỉ mất hình, không mất thông tin.
 */
export function SessionMiniMap({ location }: { location: GeoLocation }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  const zoom = zoomForRadius(location.latitude, location.accuracyRadiusKm);
  const center = project(location.latitude, location.longitude, zoom);
  const radius = circleRadiusPx(
    location.latitude,
    location.accuracyRadiusKm,
    zoom,
  );

  return (
    <div
      role="img"
      aria-label={`Bản đồ vùng ước tính, bán kính khoảng ${Math.round(location.accuracyRadiusKm)} km`}
      className="relative h-40 w-80 max-w-full overflow-hidden rounded-lg border border-border bg-muted"
    >
      <div
        data-map-tiles
        className="absolute top-1/2 left-1/2 dark:brightness-75 dark:contrast-125"
      >
        {tilesAround(center, zoom, WIDTH, HEIGHT).map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <span
        data-accuracy-circle
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-destructive bg-destructive/15"
        style={{ width: radius * 2, height: radius * 2 }}
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-2 ring-background"
      />
    </div>
  );
}
