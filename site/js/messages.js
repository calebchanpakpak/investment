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

export function errorText(code) {
  return ERROR_TEXT[code] || '讀取失敗。';
}
