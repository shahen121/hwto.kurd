import { useEffect, useRef, useState } from "react";
import { t } from "../utils/i18n";
import { translateToSorani } from "../utils/translation";

export default function SoraniOverview({ overview, mediaId }) {
  const [translatedOverview, setTranslatedOverview] = useState(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    setTranslatedOverview(null);
    setShowTranslated(false);
    setLoading(false);
    setError(false);
    return () => {
      requestId.current += 1;
    };
  }, [mediaId, overview]);

  if (!overview) return null;

  const handleToggle = async () => {
    if (showTranslated) {
      setShowTranslated(false);
      return;
    }
    if (translatedOverview) {
      setShowTranslated(true);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const result = await translateToSorani(overview);
      if (requestId.current === currentRequest) {
        setTranslatedOverview(result);
        setShowTranslated(true);
      }
    } catch (translationError) {
      console.error("Sorani synopsis translation failed:", translationError);
      if (requestId.current === currentRequest) setError(true);
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  };

  return (
    <div className="detail-overview-wrap">
      <div className="detail-overview-toolbar">
        <span>
          {showTranslated
            ? t("translatedToSorani")
            : t("englishSynopsis")}
        </span>
        <button
          type="button"
          className="overview-translate-btn"
          onClick={handleToggle}
          disabled={loading}
        >
          {loading
            ? t("translationLoading")
            : showTranslated
              ? t("showOriginalSynopsis")
              : t("translateToSorani")}
        </button>
      </div>
      <p
        className="detail-overview"
        dir={showTranslated ? "rtl" : "ltr"}
        aria-live="polite"
      >
        {showTranslated ? translatedOverview : overview}
      </p>
      {error && (
        <span className="overview-translation-error" role="status">
          {t("overviewTranslationFailed")}
        </span>
      )}
    </div>
  );
}
