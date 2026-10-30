import React from "react";
import { t } from "../utils/i18n";

/**
 * PullToRefreshIndicator
 * Sleek, native-feeling cyberpunk capsule indicator for pull-to-refresh
 */
export default function PullToRefreshIndicator({
  pullDistance = 0,
  isPulling = false,
  isRefreshing = false,
  isSuccess = false,
  canRefresh = false,
  progress = 0,
  onManualRefresh,
}) {
  const visible = pullDistance > 0 || isRefreshing || isSuccess;
  if (!visible) return null;

  // Visual calculation
  const translateY = Math.min(pullDistance, 75);
  const opacity = Math.min(1, Math.max(0.2, pullDistance / 35));
  const scale = Math.min(1, 0.8 + progress * 0.2);

  // Circle circumference for r=9: 2 * PI * 9 ~= 56.55
  const circumference = 56.55;
  const strokeDashoffset = circumference - circumference * Math.min(1, Math.max(0, progress));

  return (
    <div
      className={`ptr-capsule-container ${isPulling ? "ptr-active" : ""} ${
        isRefreshing ? "ptr-refreshing" : ""
      } ${isSuccess ? "ptr-success" : ""}`}
      style={{
        transform: `translate(-50%, ${translateY}px) scale(${scale})`,
        opacity: isRefreshing || isSuccess ? 1 : opacity,
        transition: isPulling ? "none" : "all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      }}
      onClick={onManualRefresh}
      role="status"
      aria-live="polite"
      title={isRefreshing ? t("refreshing") : t("pullToRefresh")}
    >
      <div className="ptr-capsule-body">
        {/* State 1: Refreshing Spinner */}
        {isRefreshing && (
          <div className="ptr-spinner-box">
            <svg
              className="ptr-spinner-svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="rgba(255, 255, 255, 0.15)"
                strokeWidth="2.8"
              />
              <path
                d="M12 3a9 9 0 0 1 9 9"
                stroke="url(#ptr-gradient)"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="ptr-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ed227b" />
                  <stop offset="100%" stopColor="#ff70a6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        )}

        {/* State 2: Success Checkmark */}
        {isSuccess && (
          <div className="ptr-icon-box ptr-success-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00e676"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {/* State 3: Interactive Pull Ring + Arrow */}
        {!isRefreshing && !isSuccess && (
          <div className="ptr-ring-box">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              className="ptr-ring-svg"
            >
              {/* Background ring */}
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="rgba(255, 255, 255, 0.15)"
                strokeWidth="2.4"
              />
              {/* Progress filling ring */}
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#ed227b"
                strokeWidth="2.4"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 12 12)"
                style={{
                  transition: isPulling ? "none" : "stroke-dashoffset 0.2s ease",
                }}
              />
            </svg>
            <div
              className={`ptr-arrow-glyph ${canRefresh ? "ptr-arrow-flip" : ""}`}
              style={{
                transform: `translate(-50%, -50%) rotate(${canRefresh ? 180 : 0}deg)`,
                transition: "transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ed227b"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </div>
          </div>
        )}

        {/* Label */}
        <span className="ptr-label">
          {isSuccess
            ? t("refreshSuccess")
            : isRefreshing
            ? t("refreshing")
            : canRefresh
            ? t("releaseToRefresh")
            : t("pullToRefresh")}
        </span>
      </div>
    </div>
  );
}
