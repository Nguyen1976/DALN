import type { GeoLocation } from "@/apis/user";

/**
 * Toán cho bản đồ mini ở trang "Thiết bị đang đăng nhập": Web Mercator và
 * lưới tile 256px của OpenStreetMap. Hàm thuần, không thư viện — cả bản đồ
 * chỉ là vài ảnh tile ghép lại cộng một vòng tròn.
 */

export const TILE_SIZE = 256;

/** Mét trên một pixel ở xích đạo, zoom 0. */
const EQUATOR_METERS_PER_PIXEL = 156543.03392;
/** Zoom được chọn để vòng tròn rơi vào khoảng 24–48px. */
const TARGET_RADIUS_PX = 48;
const MIN_ZOOM = 2;
const MAX_ZOOM = 13;
/** Vòng không biến mất khi bán kính ~0, và không tràn khỏi khung cao 160px. */
const MIN_CIRCLE_PX = 8;
const MAX_CIRCLE_PX = 76;
/** Web Mercator không vẽ được tới cực. */
const MAX_LATITUDE = 85.05112878;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const metersPerPixel = (lat: number, zoom: number) =>
  (EQUATOR_METERS_PER_PIXEL * Math.cos(toRadians(lat))) / 2 ** zoom;

/**
 * Zoom sao cho vùng bất định vừa khung: bán kính 10km ra zoom 8, bán kính
 * 534km (chỉ biết tới quốc gia) lùi ra zoom 3. Chính việc lùi zoom này giữ
 * cho bản đồ không trông chắc chắn hơn dữ liệu.
 */
export function zoomForRadius(lat: number, radiusKm: number): number {
  const radiusMeters = Math.max(radiusKm, 0.1) * 1000;
  const zoom = Math.floor(
    Math.log2((metersPerPixel(lat, 0) * TARGET_RADIUS_PX) / radiusMeters),
  );
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Bán kính vòng tròn trên màn hình (px) ở `zoom` đã chọn. */
export function circleRadiusPx(
  lat: number,
  radiusKm: number,
  zoom: number,
): number {
  return clamp(
    (radiusKm * 1000) / metersPerPixel(lat, zoom),
    MIN_CIRCLE_PX,
    MAX_CIRCLE_PX,
  );
}

/** Toạ độ pixel toàn cầu của một điểm ở `zoom`. */
export function project(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(toRadians(clamp(lat, -MAX_LATITUDE, MAX_LATITUDE)));
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface MapTile {
  key: string;
  url: string;
  /** Góc trên-trái của tile, tính từ TÂM khung. */
  left: number;
  top: number;
}

/**
 * Các tile phủ một khung `width`×`height` có tâm là `center`. Cột quấn quanh
 * kinh tuyến 180 (modulo 2^zoom); hàng bị kẹp vì trên cực không có tile.
 */
export function tilesAround(
  center: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
): MapTile[] {
  const count = 2 ** zoom;
  const firstCol = Math.floor((center.x - width / 2) / TILE_SIZE);
  const lastCol = Math.floor((center.x + width / 2) / TILE_SIZE);
  const firstRow = Math.max(0, Math.floor((center.y - height / 2) / TILE_SIZE));
  const lastRow = Math.min(
    count - 1,
    Math.floor((center.y + height / 2) / TILE_SIZE),
  );

  const tiles: MapTile[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const wrapped = ((col % count) + count) % count;
      tiles.push({
        key: `${zoom}/${col}/${row}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${row}.png`,
        left: col * TILE_SIZE - center.x,
        top: row * TILE_SIZE - center.y,
      });
    }
  }
  return tiles;
}

/** Mở Google Maps ở đúng vùng và mức zoom của bản đồ mini — cố ý không cắm pin. */
export function googleMapsUrl(lat: number, lon: number, zoom: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=${zoom}`;
}

/** "London, United Kingdom", "Bhutan", hoặc null khi không có gì để nói. */
export function formatPlace(
  location: GeoLocation | null | undefined,
): string | null {
  if (!location) return null;
  const parts = [location.city, location.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
