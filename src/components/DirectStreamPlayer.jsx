import React, { useEffect, useState } from "react";
import HlsPlayer from "./HlsPlayer";
import { fetchExtractedStream } from "../utils/directStream";
import { fetchAuthorizedHlsStream } from "../utils/hlsClient";

/**
 * Ad-free direct player for extra servers: pulls a raw .m3u8 via the
 * Cloudflare Worker and plays it in our own <video> (hls.js) with our
 * Kurdish/Arabic <track> subtitles. If no stream can be extracted it falls
 * back to the sanitised /embed-proxy page (`fallbackUrl`).
 */
export default function DirectStreamPlayer({
  type,
  id,
  season = 0,
  episode = 0,
  serverKey,
  subtitles = [],
  initialTime = 0,
  onProgress,
  onBack,
  accentColor,
  fallbackUrl,
  onModeChange,
}) {
  const [state, setState] = useState({ status: "loading", streamUrl: null });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading", streamUrl: null });
    fetchExtractedStream(
      { type, id, season, episode, serverKey },
      { fallbackResolver: fetchAuthorizedHlsStream },
    ).then((res) => {
      if (!alive) return;
      if (res.ok) setState({ status: "ready", streamUrl: res.streamUrl });
      else setState({ status: "failed", streamUrl: null });
      onModeChange?.(res.ok ? "hls" : "iframe");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, season, episode, serverKey]);

  if (state.status === "ready") {
    return (
      <HlsPlayer
        streamUrl={state.streamUrl}
        subtitles={subtitles}
        initialTime={initialTime}
        onProgress={onProgress}
        onBack={onBack}
        accentColor={accentColor}
      />
    );
  }

  if (state.status === "failed" && fallbackUrl) {
    return (
      <iframe
        src={fallbackUrl}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="origin"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
          background: "#000",
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5,
      }}
    >
      <div className="spinner" />
    </div>
  );
}
