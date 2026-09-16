import type { CallInfo } from "@/redux/slices/messageSlice";

/**
 * Suy ra callInfo từ văn bản tin log CŨ (tạo trước khi có type=CALL) để tin lịch
 * sử cũ vẫn hiển thị thành thẻ "như một tin nhắn" thay vì chữ hệ thống trơn.
 * Trả null nếu không phải tin cuộc gọi.
 */
export function parseLegacyCallInfo(text: string): CallInfo | null {
  if (!text || !/^Cuộc gọi/.test(text)) return null;
  const scope: CallInfo["scope"] = /nhóm/.test(text) ? "group" : "direct";
  const callType: CallInfo["callType"] = /video/.test(text) ? "video" : "audio";
  let outcome = "ENDED";
  if (/nhỡ/.test(text)) outcome = "MISSED";
  else if (/từ chối/.test(text)) outcome = "REJECTED";
  else if (/không kết nối/.test(text)) outcome = "UNREACHABLE";
  const mm = text.match(/(\d+)\s*phút/);
  const ss = text.match(/(\d+)\s*giây/);
  const durationSeconds =
    (mm ? Number(mm[1]) * 60 : 0) + (ss ? Number(ss[1]) : 0);
  const pc = text.match(/(\d+)\s*người/);
  return {
    scope,
    callType,
    outcome,
    durationSeconds,
    participantCount: pc ? Number(pc[1]) : undefined,
  };
}
