// ===== src/firebase.js (utility for username + keys) =====

// 規範化使用者名稱：去除多餘空白、全形轉半形、轉小寫。
export function normalizeName(name) {
  // NFKC 正規化可把全形英數轉為半形、合併相似字元
  const n = (name || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return n;
}

// localStorage Keys。以「名稱命名空間」避免不同使用者的資料互相覆蓋
export const LSK = {
  CURRENT_NAME: "mvp.currentName.v2",
  ENTRIES: (user) => `mvp.entries.v1::${user}`,
  SETTINGS: (user) => `mvp.settings.v1::${user}`,
};

/* 若後續要接 Firebase，可在此補上設定與導出：
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
*/
