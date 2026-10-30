import { useSeasonalEvent } from "../components/seasonalEvents.jsx";
import { isElectron } from "../utils/storage";
import { t } from "../utils/i18n";
import {
  HwtoLogo,
  HomeIcon,
  LibraryUnifiedIcon,
  SettingsIcon,
  DownloadsQueueIcon,
  QuitIcon,
} from "./Icons";

export default function Sidebar({
  page,
  onNavigate,
  savedList = [],
  activeDownloads,
}) {
  const seasonalEvent = useSeasonalEvent();

  return (
    <div className="sidebar">
      {/* Desktop Logo */}
      <div
        className="sidebar-logo"
        onClick={() => onNavigate("home")}
        title="hwto-kurd"
        style={{ position: "relative" }}
      >
        <HwtoLogo />
        {seasonalEvent && seasonalEvent.render()}
      </div>

      {/* 1. Saved & History Unified Button */}
      <SideBtn
        className="sidebar-btn-library"
        active={page === "history"}
        onClick={() => onNavigate("history")}
        icon={<LibraryUnifiedIcon />}
        label={t("savedAndHistory")}
        badge={savedList?.length > 0 ? savedList.length : null}
      />

      {/* 2. Center Home Button */}
      <SideBtn
        className="sidebar-btn-home"
        active={page === "home"}
        onClick={() => onNavigate("home")}
        icon={<HomeIcon />}
        label={t("home")}
      />

      {/* 3. Settings Button */}
      <div className="sidebar-bottom">
        <SideBtn
          className="sidebar-btn-settings"
          active={page === "settings"}
          onClick={() => onNavigate("settings")}
          icon={<SettingsIcon />}
          label={t("settings")}
        />

        {/* Optional Desktop / Electron Controls */}
        {isElectron && activeDownloads > 0 && (
          <SideBtn
            active={page === "downloads"}
            onClick={() => onNavigate("downloads")}
            icon={<DownloadsQueueIcon />}
            label={t("downloads")}
            badge={activeDownloads}
          />
        )}

        {isElectron && (
          <button
            className="sidebar-btn sidebar-quit-btn"
            onClick={() => window.electron?.quitApp?.()}
            title={t("quitApp")}
            style={{ color: "#e53e3e", marginTop: 4 }}
          >
            <QuitIcon />
            <span className="tooltip">{t("quitApp")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function SideBtn({ className = "", active, onClick, icon, label, badge }) {
  return (
    <button
      className={`sidebar-btn ${className} ${active ? "active" : ""}`}
      onClick={onClick}
      style={{ position: "relative" }}
    >
      {icon}
      <span className="tooltip">{label}</span>
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--red)",
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            padding: "0 4px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
