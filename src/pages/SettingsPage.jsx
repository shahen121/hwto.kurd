import { useState, useEffect } from "react";
import {
  storage,
  STORAGE_KEYS,
  clearAppCaches,
  formatBytes,
} from "../utils/storage";
import { clearTmdbCache } from "../utils/api";
import {
  ACCENT_PRESETS,
  applyAccentColor,
  THEME_PRESETS,
  applyTheme,
} from "../utils/appearance";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";
import {
  t,
  getCurrentLanguage,
  SUPPORTED_LANGUAGES,
  isRTL,
} from "../utils/i18n";
import {
  getAgeLimitSetting,
  getRatingCountry,
  RATING_COUNTRIES,
} from "../utils/ageRating";

export default function SettingsPage({ onTriggerLanguageChange }) {
  const currentLang = getCurrentLanguage();
  const rtl = isRTL();

  // Accent & Theme
  const [accent, setAccent] = useState(
    () => storage.get(STORAGE_KEYS.ACCENT_COLOR) || "hwto",
  );
  const [theme, setTheme] = useState(
    () => storage.get(STORAGE_KEYS.THEME) || "dark",
  );
  const [cardSize, setCardSize] = useState(
    () => storage.get(STORAGE_KEYS.CARD_SIZE) || "normal",
  );

  // Languages
  const [subLang, setSubLang] = useState(
    () => storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "ku",
  );

  // Playback
  const [autoplayNext, setAutoplayNext] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED) !== false,
  );
  const [autoplayDuration, setAutoplayDuration] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION) || 10,
  );
  const [skipIntro, setSkipIntro] = useState(
    () => storage.get(STORAGE_KEYS.INTRO_SKIP_MODE) || "auto",
  );
  const [watchedThreshold, setWatchedThreshold] = useState(
    () => storage.get(STORAGE_KEYS.WATCHED_THRESHOLD) || 90,
  );
  const [ageLimit, setAgeLimit] = useState(() => getAgeLimitSetting(storage));
  const [ratingCountry, setRatingCountry] = useState(() =>
    getRatingCountry(storage),
  );

  // Status flashes
  const [statusMsg, setStatusMsg] = useState(null);
  const flash = (msg) => {
    setStatusMsg(msg || t("savedCheck"));
    setTimeout(() => setStatusMsg(null), 2500);
  };

  // Handlers
  const handleAccentChange = (id) => {
    setAccent(id);
    storage.set(STORAGE_KEYS.ACCENT_COLOR, id);
    applyAccentColor(id);
    window.dispatchEvent(new CustomEvent("hwto:accent-changed"));
    flash();
  };

  const handleThemeChange = (id) => {
    setTheme(id);
    storage.set(STORAGE_KEYS.THEME, id);
    applyTheme(id);
    flash();
  };

  const handleCardSizeChange = (size) => {
    setCardSize(size);
    storage.set(STORAGE_KEYS.CARD_SIZE, size);
    flash();
  };

  const handleSubLangChange = (code) => {
    setSubLang(code);
    storage.set(STORAGE_KEYS.SUBTITLE_LANG, code);
    flash();
  };

  const handleClearCache = async () => {
    clearTmdbCache();
    await clearAppCaches();
    flash(t("clearCacheSuccess"));
  };

  const handleClearProgress = () => {
    if (window.confirm(t("clearHistoryPrompt"))) {
      storage.remove(STORAGE_KEYS.WATCH_PROGRESS);
      storage.remove("videoPositions");
      flash(t("clearHistorySuccess"));
    }
  };

  const handleResetApp = () => {
    if (window.confirm(t("resetAppPrompt"))) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div
      className="settings-page"
      dir={rtl ? "rtl" : "ltr"}
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "40px 24px 80px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: "var(--text)",
            marginBottom: 8,
          }}
        >
          {t("settingsTitle")}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text3)" }}>
          {t("settingsSubtitle")}
        </p>
      </div>

      {statusMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 30,
            [rtl ? "left" : "right"]: 30,
            zIndex: 9999,
            background: "var(--surface3)",
            border: "1px solid var(--red)",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* ── SECTION 1: App Language & Subtitles ── */}
      <SettingsCard
        title={t("groupLanguage")}
        subtitle={t("groupLanguageSub")}
        icon="🌐"
      >
        {/* App Interface Language */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {t("appLanguage")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
            {t("appLanguageDesc")}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {SUPPORTED_LANGUAGES.map((l) => {
              const active = l.code === currentLang;
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => {
                    if (l.code !== currentLang) {
                      onTriggerLanguageChange &&
                        onTriggerLanguageChange(l.code);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 18px",
                    borderRadius: 8,
                    background: active ? "var(--red)" : "var(--surface2)",
                    border: `1px solid ${active ? "var(--red)" : "var(--border)"}`,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{l.flag}</span>
                  <span>{l.label}</span>
                  {active && <span style={{ fontSize: 12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Preferred Subtitle Language */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {t("subtitleLanguage")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
            {t("subtitleLanguageDesc")}
          </div>
          <select
            value={subLang}
            onChange={(e) => handleSubLangChange(e.target.value)}
            style={selectStyle}
          >
            {SUBTITLE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
      </SettingsCard>

      {/* ── SECTION 2: Appearance & Colors ── */}
      <SettingsCard
        title={t("groupAppearance")}
        subtitle={t("groupAppearanceSub")}
        icon="🎨"
      >
        {/* Accent Color */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            {t("accentColor")}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {ACCENT_PRESETS.map((p) => {
              const active = accent === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleAccentChange(p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: active
                      ? "rgba(255,255,255,0.12)"
                      : "var(--surface2)",
                    border: `2px solid ${active ? p.color : "var(--border)"}`,
                    color: "var(--text)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: p.color,
                      boxShadow: active ? `0 0 10px ${p.color}` : "none",
                    }}
                  />
                  <span>
                    {p.id === "hwto"
                      ? p.label
                      : t(`color${p.id[0].toUpperCase()}${p.id.slice(1)}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Theme mode */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            {t("themeMode")}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {THEME_PRESETS.map((th) => {
              const active = theme === th.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => handleThemeChange(th.id)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 8,
                    background: active ? "var(--surface3)" : "var(--surface2)",
                    border: `1px solid ${active ? "var(--red)" : "var(--border)"}`,
                    color: active ? "#fff" : "var(--text2)",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {t(`themePreset${th.id[0].toUpperCase()}${th.id.slice(1)}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Card size */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            {t("cardSize")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { id: "sm", label: t("cardSmall") },
              { id: "normal", label: t("cardNormal") },
              { id: "lg", label: t("cardLarge") },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCardSizeChange(c.id)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  background:
                    cardSize === c.id ? "var(--surface3)" : "var(--surface2)",
                  border: `1px solid ${cardSize === c.id ? "var(--red)" : "var(--border)"}`,
                  color: cardSize === c.id ? "#fff" : "var(--text3)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: cardSize === c.id ? 700 : 500,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </SettingsCard>

      {/* ── SECTION 3: Playback Experience ── */}
      <SettingsCard
        title={t("groupPlayback")}
        subtitle={t("groupPlaybackSub")}
        icon="▶"
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {t("ageLimit")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
            {t("ageLimitDesc")}
          </div>
          <select
            value={ageLimit === null ? "none" : String(ageLimit)}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "none") {
                storage.remove(STORAGE_KEYS.AGE_LIMIT);
                setAgeLimit(null);
              } else {
                const nextLimit = Number(value);
                storage.set(STORAGE_KEYS.AGE_LIMIT, nextLimit);
                setAgeLimit(nextLimit);
              }
              flash();
            }}
            style={selectStyle}
          >
            <option value="none">{t("noAgeLimit")}</option>
            {Array.from({ length: 19 }, (_, age) => age).map((age) => (
              <option key={age} value={age}>
                {age === 0 ? t("allAges") : `${age}+`}
              </option>
            ))}
          </select>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {t("ratingCountry")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
            {t("ratingCountryDesc")}
          </div>
          <select
            value={ratingCountry}
            onChange={(e) => {
              const value = e.target.value;
              setRatingCountry(value);
              storage.set(STORAGE_KEYS.RATING_COUNTRY, value);
              flash();
            }}
            style={selectStyle}
          >
            {RATING_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Autoplay next episode */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {t("autoplayNext")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("autoplayNextDesc")}
            </div>
          </div>
          <ToggleSwitch
            checked={autoplayNext}
            onChange={(val) => {
              setAutoplayNext(val);
              storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED, val);
              flash();
            }}
          />
        </div>

        {autoplayNext && (
          <div style={{ marginBottom: 24, padding: "12px 16px", background: "var(--surface2)", borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("countdownDuration")}
            </div>
            <input
              type="number"
              min={3}
              max={60}
              value={autoplayDuration}
              onChange={(e) => {
                const val = Number(e.target.value);
                setAutoplayDuration(val);
                storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION, val);
              }}
              style={{ ...selectStyle, width: 100 }}
            />
          </div>
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Intro Skip */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {t("autoSkipIntro")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("autoSkipIntroDesc")}
            </div>
          </div>
          <ToggleSwitch
            checked={skipIntro === "auto"}
            onChange={(val) => {
              const mode = val ? "auto" : "off";
              setSkipIntro(mode);
              storage.set(STORAGE_KEYS.INTRO_SKIP_MODE, mode);
              flash();
            }}
          />
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Auto Watched Threshold */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {t("autoWatchedThreshold")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
            {t("autoWatchedDesc")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="number"
              min={10}
              max={300}
              value={watchedThreshold}
              onChange={(e) => {
                const val = Number(e.target.value);
                setWatchedThreshold(val);
                storage.set(STORAGE_KEYS.WATCHED_THRESHOLD, val);
              }}
              style={{ ...selectStyle, width: 100 }}
            />
            <span style={{ fontSize: 13, color: "var(--text3)" }}>
              {t("seconds")}
            </span>
          </div>
        </div>
      </SettingsCard>

      {/* ── SECTION 4: Storage & Data ── */}
      <SettingsCard
        title={t("groupStorage")}
        subtitle={t("groupStorageSub")}
        icon="🧹"
      >
        {/* Clear cache */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {t("clearCache")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("clearCacheDesc")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClearCache}
          >
            {t("clearCache")}
          </button>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Clear progress */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {t("clearHistoryConfirm")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("clearHistoryDesc")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClearProgress}
            style={{ color: "#ff3860", borderColor: "rgba(255,56,96,0.3)" }}
          >
            {t("clearHistoryConfirm")}
          </button>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        {/* Reset app */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--red)", marginBottom: 2 }}>
              {t("resetApp")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("resetAppDesc")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleResetApp}
          >
            {t("resetApp")}
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}

function SettingsCard({ title, subtitle, icon, children }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "24px 28px",
        marginBottom: 28,
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            {title}
          </h2>
          <p style={{ fontSize: 12, color: "var(--text3)", margin: "3px 0 0" }}>
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "var(--red)" : "var(--surface3)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          position: "absolute",
          top: 2,
          left: checked ? 22 : 2,
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}

const selectStyle = {
  padding: "9px 14px",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
  minWidth: 220,
  cursor: "pointer",
};
