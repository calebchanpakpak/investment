export const ERROR_TEXT = {
  not_configured: '未設定後端。真實持倉唔會用範例數字代替。',
  invalid_endpoint: '網址必須係 https://script.google.com/macros/s/…/exec，而且唔可以帶查詢字串或帳號。',
  unauthorized: '權杖被拒。',
  action_not_allowed: '呢個動作未獲允許。前端只會要求讀取持倉。',
  read_failed: '試算表讀取失敗。',
  cors: '瀏覽器未能讀取回應（CORS）。請確認網頁應用程式係匿名可存取、用 POST，而且前端冇用 no-cors。',
  bad_response: '回應格式不正確。',
  network: '網絡連線失敗。',
  no_indexeddb: '呢個瀏覽器未能使用 IndexedDB，所以儲存唔到設定。',
};

export const NEWS_STATE_TEXT = {
  loading: '載入緊公開新聞快取…',
  error: '新聞快取讀取失敗。來源連結仍然可以打開。',
  empty: '來源有回應，但未有可用標題。',
  stale: '新聞快取已過期或今次更新失敗。以下標題嚟自上次成功擷取，唔係即時消息。',
  ok: '以下標題嚟自延遲快取，唔係即時消息。',
};

export const SCHEDULE_STATE_TEXT = {
  loading: '載入緊已公布日程…',
  error: '聯儲局日曆快取讀取失敗。請直接打開官方頁面。',
  empty: '未能從快取解析到已公布會議。',
  stale: '日程快取已過期或今次更新失敗。以下日期嚟自上次成功擷取，請對照官方頁面。',
  ok: '以下日期解析自聯儲局官方日曆，唔係利率預測。',
};

export function errorText(code) {
  return ERROR_TEXT[code] || '讀取失敗。';
}
