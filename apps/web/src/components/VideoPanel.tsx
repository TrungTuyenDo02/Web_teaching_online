import { isTrackReference, LiveKitRoom, RoomAudioRenderer, StartAudio, TrackToggle, useTracks, VideoTrack, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason, Track } from "livekit-client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import mascot from "../assets/helper-mascot.png";
import { t } from "../lib/i18n";
import { Button } from "../ui/Button";

interface Props {
  url: string;
  token: string;
  /** Tên hiển thị cho người còn lại trong phòng: "Học sinh" với giáo viên, "Thầy cô" với học sinh. */
  peerLabel: string;
  /** Phòng bị đóng vì giáo viên kết thúc buổi học (API xóa phòng). */
  onRoomClosed: () => void;
}

/** Một ô video; không có hình (chưa vào phòng, tắt camera) thì hiện linh vật chibi. */
function Tile({ label, note, self, children }: { label: string; note?: string; self?: boolean; children?: ReactNode }) {
  return (
    <figure className={`video-tile${self ? " video-tile--self" : ""}`}>
      {children ?? <img className="video-tile__chibi" src={mascot} alt="" decoding="async" />}
      <figcaption>
        {label}
        {note && <span> · {note}</span>}
      </figcaption>
    </figure>
  );
}

function TrackTile({ trackRef, label, waiting, self }: { trackRef?: TrackReferenceOrPlaceholder; label: string; waiting?: string; self?: boolean }) {
  const on = trackRef && isTrackReference(trackRef) && !trackRef.publication.isMuted;
  return (
    <Tile label={trackRef?.participant.name || label} note={!trackRef ? waiting : on ? undefined : t("tắt camera")} self={self}>
      {on ? <VideoTrack trackRef={trackRef} /> : undefined}
    </Tile>
  );
}

function Tiles({ peerLabel }: { peerLabel: string }) {
  // Placeholder giữ ô của người đã vào nhưng chưa bật camera; phòng 1-1 nên chỉ lấy một người còn lại
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  return (
    <div className="video-tiles">
      <TrackTile trackRef={tracks.find((r) => !r.participant.isLocal)} label={peerLabel} waiting={t("chưa vào phòng")} />
      <TrackTile trackRef={tracks.find((r) => r.participant.isLocal)} label={t("Bạn")} self />
    </div>
  );
}

/** Xem trước: không có LiveKit; camera chỉ mở trên máy này khi bấm, không gửi đi đâu. */
function PreviewTiles({ peerLabel }: { peerLabel: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  async function toggle() {
    if (stream) return setStream(null);
    try {
      setError(false);
      setStream(await navigator.mediaDevices.getUserMedia({ video: true }));
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <div className="video-tiles">
        <Tile label={peerLabel} note={t("minh họa")} />
        <Tile label={t("Bạn")} note={error ? t("không mở được camera") : stream ? undefined : t("tắt camera")} self>
          {stream ? <video ref={video} autoPlay muted playsInline /> : undefined}
        </Tile>
      </div>
      <div className="video-controls">
        <Button size="sm" onClick={() => void toggle()} aria-pressed={!!stream}>
          {stream ? t("Tắt camera") : t("Thử camera")}
        </Button>
      </div>
    </>
  );
}

export default function VideoPanel({ url, token, peerLabel, onRoomClosed }: Props) {
  // Không có địa chỉ máy chủ video: chỉ xảy ra ở chế độ xem trước (dữ liệu minh họa, bản development)
  if (!url) {
    return (
      <section className="room__video" aria-label="Video">
        <PreviewTiles peerLabel={peerLabel} />
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
      <Tiles peerLabel={peerLabel} />
      <RoomAudioRenderer />
      <div className="video-controls">
        {/* Trình duyệt chặn tự phát âm thanh (iPhone, Safari): nút chỉ hiện khi cần */}
        <StartAudio label={t("Bật âm thanh")} />
        <TrackToggle className="lk-button" source={Track.Source.Microphone}>{t("Micro")}</TrackToggle>
        <TrackToggle className="lk-button" source={Track.Source.Camera}>{t("Camera")}</TrackToggle>
      </div>
    </LiveKitRoom>
  );
}
