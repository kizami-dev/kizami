/**
 * GPS付き打刻(v0.4、docs/requirements.md §3)。
 *
 * - 初回はブラウザの標準ダイアログで許可を求める(navigator.geolocation.getCurrentPosition が担う)
 * - 許可されなかった/取得できなかった場合は null を返す。呼び出し側(PunchHome)はこれを
 *   「位置情報なしで打刻する」の合図として扱い、例外として打刻自体を止めることはしない
 * - タイムアウトは10秒(依頼どおり)。GPSの取得に時間がかかっても打刻をいつまでも待たせない
 */

/** navigator.geolocation の取得タイムアウト(ミリ秒)。 */
export const GEOLOCATION_TIMEOUT_MS = 10_000;

export interface GeolocationResult {
  lat: number;
  lng: number;
}

/**
 * 現在位置を取得する。取得できない場合(非対応ブラウザ・権限拒否・タイムアウト・
 * その他のエラー)は例外を投げず null を返す。
 */
export function getCurrentPositionSafe(): Promise<GeolocationResult | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
