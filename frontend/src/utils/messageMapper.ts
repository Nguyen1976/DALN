import type { Message } from "@/redux/slices/messageSlice";

export const MessageMapper = {
  previewText(message: Pick<Message, "text" | "type" | "isRevoked" | "poll">) {
    if (message.isRevoked) return "Tin nhắn đã bị thu hồi";

    const text = String(message.text || "").trim();
    if (text) return text;

    switch (message.type) {
      case "IMAGE":
        return "Hình ảnh";
      case "VIDEO":
        return "Video";
      case "FILE":
        return "Tệp đính kèm";
      case "POLL":
        return `Bình chọn: ${message.poll?.question || "Khảo sát"}`;
      default:
        return "";
    }
  },
};
