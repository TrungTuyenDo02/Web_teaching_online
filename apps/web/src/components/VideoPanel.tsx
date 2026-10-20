import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason } from "livekit-client";
import { t } from "../lib/i18n";

interface Props {
  url: string;
  token: string;
  /** Phòng bị đóng vì giáo viên kết thúc buổi học (API xóa phòng). */
  onRoomClosed: () => void;
}

export default function VideoPanel({ url, token, onRoomClosed }: Props) {
  // Không có địa chỉ máy chủ video: chỉ xảy ra ở chế độ xem trước (dữ liệu minh họa, bản development)
  if (!url) {
    return (
      <section className="room__video" aria-label="Video">
        <div className="video-placeholder">
          <p>
            {t("Khu vực video")}
            <br />
            <span>{t("(xem trước, không kết nối LiveKit)")}</span>
          </p>
        </div>
      </section>
    );
  }
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      video
      audio
      data-lk-theme="default"
      className="room__video"
      onDisconnected={(reason) => reason === DisconnectReason.ROOM_DELETED && onRoomClosed()}
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
