import { useState, useEffect, useRef, useCallback } from "react";

/**
 * usePullToRefresh - Production-grade hook for touch pull-to-refresh
 *
 * @param {Object} options
 * @param {React.RefObject<HTMLElement>} options.containerRef - Ref to the scrollable container (.main)
 * @param {Function} options.onRefresh - Async function invoked when pull threshold is met
 * @param {number} [options.threshold=70] - Distance in px to trigger refresh
 * @param {number} [options.maxPull=120] - Maximum pull distance in px with damping
 * @param {boolean} [options.disabled=false] - Whether pull-to-refresh is disabled
 */
export function usePullToRefresh({
  containerRef,
  onRefresh,
  threshold = 72,
  maxPull = 125,
  disabled = false,
}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const canPullRef = useRef(false);
  const directionLockedRef = useRef(false);
  const isRefreshingRef = useRef(false);
  const vibratedRef = useRef(false);

  // Keep isRefreshingRef in sync
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const triggerRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    setIsRefreshing(true);
    isRefreshingRef.current = true;
    setPullDistance(60); // Pin at comfortable viewing height

    try {
      if (typeof onRefresh === "function") {
        await onRefresh();
      }
      setIsSuccess(true);
      // Brief success feedback before closing
      await new Promise((r) => setTimeout(r, 450));
    } catch (err) {
      console.warn("Pull-to-refresh failed:", err);
    } finally {
      setIsSuccess(false);
      setIsRefreshing(false);
      isRefreshingRef.current = false;
      setPullDistance(0);
      setIsPulling(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el || disabled) return;

    const onTouchStart = (e) => {
      if (isRefreshingRef.current) return;

      // Only engage if container is scrolled to the absolute top
      if (el.scrollTop > 1) {
        canPullRef.current = false;
        return;
      }

      // Ignore if user tapped interactive form elements or video player controls
      const target = e.target;
      if (
        target?.closest?.(
          "input, textarea, select, button, iframe, video, .player-container, [data-no-ptr='true']"
        )
      ) {
        canPullRef.current = false;
        return;
      }

      const touch = e.touches[0];
      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      canPullRef.current = true;
      directionLockedRef.current = false;
      vibratedRef.current = false;
    };

    const onTouchMove = (e) => {
      if (!canPullRef.current || isRefreshingRef.current) return;
      if (el.scrollTop > 1) {
        canPullRef.current = false;
        setPullDistance(0);
        setIsPulling(false);
        return;
      }

      const touch = e.touches[0];
      const deltaY = touch.clientY - startYRef.current;
      const deltaX = touch.clientX - startXRef.current;

      // If user is swiping horizontally (like a carousel), cancel pull to refresh
      if (!directionLockedRef.current) {
        if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
          directionLockedRef.current = true;
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            canPullRef.current = false;
            setPullDistance(0);
            setIsPulling(false);
            return;
          }
        }
      }

      // Only handle downward pull
      if (deltaY > 0) {
        // Logarithmic / exponential damping resistance
        const damped = Math.min(
          maxPull,
          Math.pow(deltaY, 0.82) * 1.65
        );

        if (e.cancelable && damped > 5) {
          e.preventDefault();
        }

        setIsPulling(true);
        setPullDistance(damped);

        // Haptic feedback when threshold crossed
        if (damped >= threshold && !vibratedRef.current) {
          try {
            navigator.vibrate?.(14);
          } catch (_) {}
          vibratedRef.current = true;
        } else if (damped < threshold) {
          vibratedRef.current = false;
        }
      } else {
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    const onTouchEnd = () => {
      if (!canPullRef.current || isRefreshingRef.current) return;
      canPullRef.current = false;

      setPullDistance((currentDistance) => {
        if (currentDistance >= threshold) {
          triggerRefresh();
          return 60;
        } else {
          setIsPulling(false);
          return 0;
        }
      });
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [containerRef, disabled, maxPull, threshold, triggerRefresh]);

  const progress = Math.min(1, pullDistance / threshold);
  const canRefresh = pullDistance >= threshold;

  return {
    pullDistance,
    isPulling,
    isRefreshing,
    isSuccess,
    canRefresh,
    progress,
    triggerRefresh,
  };
}
