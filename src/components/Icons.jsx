export const HwtoLogo = ({ style }) => (
  <img
    src="./logo.svg"
    alt="hwto-kurd"
    width="48"
    height="48"
    style={{
      width: "100%",
      height: "100%",
      objectFit: "contain",
      display: "block",
      ...style,
    }}
  />
);

export const LibraryUnifiedIcon = ({ size = 22 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="10" r="3" strokeWidth="1.7" />
    <path d="M12 8.8v1.4l1 1" strokeWidth="1.7" />
  </svg>
);

export const SearchIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
};
export const HistoryIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M12 8v4l3 3" />
      <path d="M3.05 11a9 9 0 1 1 .5 4" />
      <path d="M3 3v5h5" />
    </svg>
  );
};
export const BookmarkIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
};
export const BookmarkFillIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="currentColor"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
};
export const PlayIcon = ({ size = 16, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="currentColor"
      style={{
        width: w,
        height: h,
        flexShrink: 0,
        display: "inline-block",
        ...style,
      }}
      {...props}
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
};
export const CloseIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
};
export const FilmIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="2" y1="17" x2="7" y2="17" />
    </svg>
  );
};
export const TVIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
      <polyline points="17 2 12 7 7 2" />
    </svg>
  );
};
export const HomeIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
};
export const StarIcon = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
export const SettingsIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
};

export const HelpIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ width: 24, height: 24 }}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line
      x1="12"
      y1="17"
      x2="12.01"
      y2="17"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export const EyeIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
};

export const DownloadIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
};

export const TrashIcon = ({ size = 16, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        width: w,
        height: h,
        flexShrink: 0,
        display: "inline-block",
        ...style,
      }}
      {...props}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
};

export const FolderIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
};

export const WatchedIcon = ({ size = 22 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    style={{ filter: "drop-shadow(0 0 4px rgba(72,199,116,0.7))", flexShrink: 0 }}
  >
    <circle
      cx="12"
      cy="12"
      r="11"
      fill="#1a2e1a"
      stroke="#48c774"
      strokeWidth="1.5"
    />
    <path
      d="M6.5 12.5l3.5 3.5 7-7"
      stroke="#48c774"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const TrailerIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
};

export const DownloadsQueueIcon = ({ size = 18, width, height, style, ...props }) => {
  const w = width || size;
  const h = height || size;
  return (
    <svg
      viewBox="0 0 24 24"
      width={w}
      height={h}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ width: w, height: h, flexShrink: 0, display: "inline-block", ...style }}
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
      <line x1="3" y1="21" x2="21" y2="21" />
    </svg>
  );
};

export const QuitIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const RatingShieldIcon = ({ size = 10 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ flexShrink: 0 }}
  >
    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
  </svg>
);

export const RatingLockIcon = ({ size = 10 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const SourceIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="12" rx="10" ry="10" />
    <ellipse cx="12" cy="12" rx="4" ry="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);

export const WarningIcon = ({ size = 24, color = "var(--red)" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ExternalLinkIcon = ({ size = 13 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 26 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRightIcon = ({ size = 26 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const ShieldBlockIcon = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

export const SubtitlesIcon = ({ size = 16, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
  </svg>
);

export const PopOutIcon = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="7" width="13" height="10" rx="2" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </svg>
);

export const SportIcon = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m4.93 4.93 4.24 4.24" />
    <path d="m14.83 9.17 4.24-4.24" />
    <path d="m14.83 14.83 4.24 4.24" />
    <path d="m9.17 14.83-4.24 4.24" />
    <polygon points="12,8 14.5,10 13.5,13 10.5,13 9.5,10" fill="currentColor" fillOpacity="0.3" />
  </svg>
);

export const AnimeIcon = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" />
    <path d="M4 4.5v18M8 6h8M8 10h5" />
    <path d="m14.5 14 1.5-1 1.5 1v2.5a1.5 1.5 0 0 1-3 0z" />
  </svg>
);

export const UserIcon = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const SyncIcon = ({ size = 18, spinning = false }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={spinning ? { animation: "spin 1s linear infinite" } : undefined}
  >
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
  </svg>
);

