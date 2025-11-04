// src/cloud.js
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc
} from "firebase/firestore";
import { db } from "./firebase";

// 取得網址上 ?link=xxxxx 的值（用來識別資料庫的節點）
export function getLinkIdFromURL() {
  const u = new URL(window.location.href);
  return u.searchParams.get("link") || null;
}

// 如果沒有 linkId，就自動生成一個 UUID 並放到網址上
export function ensureLinkIdInURL() {
  let link = getLinkIdFromURL();
  if (!link) {
    link = crypto.randomUUID();
    const u = new URL(window.location.href);
    u.searchParams.set("link", link);
    window.history.replaceState({}, "", u.toString());
  }
  return link;
}

// --- 讀取紀錄 ---
export async function loadEntries(linkId) {
  const col = collection(db, "boards", linkId, "entries");
  const snap = await getDocs(col);
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr.map((e) => ({
    date: e.date,
    improve: e.improve,
    gratitude: e.gratitude || [],
    bookkeeping: !!e.bookkeeping,
  }));
}

// --- 寫入 / 更新紀錄 ---
export async function upsertEntry(linkId, payload) {
  const ref = doc(db, "boards", linkId, "entries", payload.date);
  await setDoc(ref, payload, { merge: true });
}

// --- 刪除紀錄 ---
export async function removeEntry(linkId, date) {
  const ref = doc(db, "boards", linkId, "entries", date);
  await deleteDoc(ref);
}

// --- 讀取設定 ---
export async function loadSettings(linkId) {
  const ref = doc(db, "boards", linkId, "settings", "global");
  const s = await getDoc(ref);
  if (!s.exists()) return { savingsRatio: 0 };
  return s.data();
}

// --- 儲存設定 ---
export async function saveSettings(linkId, settings) {
  const ref = doc(db, "boards", linkId, "settings", "global");
  await setDoc(ref, settings, { merge: true });
}
