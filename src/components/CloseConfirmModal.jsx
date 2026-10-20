import { DownloadIcon } from "./Icons";
import { t } from "../utils/i18n";

export default function CloseConfirmModal({ count, onConfirm, onCancel }) {
  return (
    <div className="close-confirm-overlay">
      <div className="close-confirm-modal">
        <div className="close-confirm-icon-wrap">
          <div className="close-confirm-icon-ring">
            <DownloadIcon />
          </div>
        </div>

        <div className="close-confirm-title">
          {t("closeDownloadsWarningTitle")}
        </div>

        <div className="close-confirm-body">
          <span className="close-confirm-count">
            {count}{" "}
            {count > 1
              ? t("activeDownloadCountPlural")
              : t("activeDownloadCount")}
          </span>{" "}
          {t("downloadsWillCancel")}
        </div>

        <div className="close-confirm-actions">
          <button className="btn close-confirm-btn-cancel" onClick={onCancel}>
            {t("keepDownloading")}
          </button>
          <button className="btn close-confirm-btn-confirm" onClick={onConfirm}>
            {t("cancelAndCloseApp")}
          </button>
        </div>
      </div>
    </div>
  );
}
