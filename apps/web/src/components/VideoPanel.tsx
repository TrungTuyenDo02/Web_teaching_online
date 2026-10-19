import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

interface Props {
  url: string;
  token: string;
  onDisconnected: () => void;
}

export default function VideoPanel({ url, token, onDisconnected }: Props) {
  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      video
      audio
      data-lk-theme="default"
      className="video"
      onDisconnected={onDisconnected}
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
