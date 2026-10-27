import {
  isTrackReference,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useConnectionQualityIndicator,
  useTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { AudioPresets, ConnectionQuality, DisconnectReason, Track, VideoPresets, type Participant, type RoomOptions } from "livekit-client";
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

/**
 * Ưu tiên tiếng nói trên mạng yếu: camera chỉ để thấy mặt (nội dung bài ở bảng viết) nên gửi 360p kèm
 * lớp 180p; nhận theo cỡ ô hiển thị và ngừng gửi lớp không ai xem; Opus cấu hình cho giọng nói, RED
 * gửi kèm gói dự phòng để bớt rè khi mất gói, DTX ngừng gửi lúc im lặng. Khử vọng/ồn là mặc định.
 */
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: {
    videoEncoding: VideoPresets.h360.encoding,
    videoSimulcastLayers: [VideoPresets.h180],
    audioPreset: AudioPresets.speech,
    red: true,
    dtx: true,
  },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/** Một ô video; không có hình (chưa vào phòng, tắt camera) thì hiện linh vật chibi. */
function Tile({ label, note, status, self, children }: { label: string; note?: string; status?: ReactNode; self?: boolean; children?: ReactNode }) {
  return (
    <figure className={`video-tile${self ? " video-tile--self" : ""}`}>
      {children ?? <img className="video-tile__chibi" src={mascot} alt="" decoding="async" />}
      <figcaption>
        {label}
        {note && <span> · {note}</span>}
        {status}
      </figcaption>
    </figure>
  );
}

/** Chất lượng đường truyền LiveKit đo cho từng người (mạng của người đó tới máy chủ video). */
function QualityNote({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });
  const text = {
    [ConnectionQuality.Excellent]: t("mạng tốt"),
    [ConnectionQuality.Good]: t("mạng tốt"),
    [ConnectionQuality.Poor]: t("mạng yếu"),
    [ConnectionQuality.Lost]: t("mất kết nối"),
  }[quality as string];
  return text ? <span className={`video-tile__net video-tile__net--${quality}`}> · {text}</span> : null;
}

function TrackTile({ trackRef, label, waiting, self }: { trackRef?: TrackReferenceOrPlaceholder; label: string; waiting?: string; self?: boolean }) {
  const on = trackRef && isTrackReference(trackRef) && !trackRef.publication.isMuted;
  return (
    <Tile
      label={trackRef?.participant.name || label}
      note={!trackRef ? waiting : on ? undefined : t("tắt camera")}
      status={trackRef && <QualityNote participant={trackRef.participant} />}
      self={self}
    >
      {on ? <VideoTrack trackRef={trackRef} /> : undefined}
    </Tile>
  );
}

/** Mức âm micro 0–1 từ AnalyserNode; chỉ đọc trên máy này. */
function useMicLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) return setLevel(0);
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s - 128)), 0);
      setLevel(peak / 128);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void audio.close();
    };
  }, [stream]);
  return level;
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

/** Bật/tắt một luồng camera hoặc micro trên máy này; tắt (hoặc rời trang) thì dừng thiết bị. */
function useLocalStream(constraints: MediaStreamConstraints) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);
  async function toggle() {
    if (stream) return setStream(null);
    try {
      setError(false);
      setStream(await navigator.mediaDevices.getUserMedia(constraints));
    } catch {
      setError(true);
    }
  }
  return { stream, error, toggle };
}

/** Xem trước: không có LiveKit; camera, micro chỉ mở trên máy này khi bấm, không gửi đi đâu. */
function PreviewTiles({ peerLabel }: { peerLabel: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const { stream, error, toggle } = useLocalStream({ video: true });
  const mic = useLocalStream({ audio: true });
  const micLevel = useMicLevel(mic.stream);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

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
        <Button size="sm" onClick={() => void mic.toggle()} aria-pressed={!!mic.stream}>
          {mic.stream ? t("Tắt micro") : t("Thử micro")}
        </Button>
        {mic.stream && <meter className="video-mic-level" aria-label={t("Mức âm micro")} min={0} max={1} low={0.05} value={micLevel} />}
        {mic.error && <span role="status">{t("không mở được micro")}</span>}
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
      options={ROOM_OPTIONS}
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
      <p className="video-tip">{t("Nghe vọng hoặc hú: đeo tai nghe, và đừng để hai máy cùng phòng mở loa.")}</p>
    </LiveKitRoom>
  );
}
