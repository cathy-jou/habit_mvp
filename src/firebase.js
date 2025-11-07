// ===== src/firebase.js — Firebase Cloud (Firestore) wiring & CRUD =====
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, query, orderBy, limit, serverTimestamp
} from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// ---------- 0) Helpers ----------
export function normalizeName(name) {
  const n = (name || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return n;
}

// ---------- 1) Initialize Firebase (填入你的專案設定) ----------
// 建議把這段搬到 .env 檔（Vite: VITE_*），這裡先用 placeholder 方便測試
const firebaseConfig = {
  apiKey: "AIzaSyCil1XGW0wW_z44qF7hYqnQ0o7h0Zk3Pfk",
  authDomain: "habit-mvp-76dc0.firebaseapp.com",
  projectId: "habit-mvp-76dc0",
  storageBucket: "habit-mvp-76dc0.firebasestorage.app",
  messagingSenderId: "206158504661",
  appId: "1:206158504661:web:0c36e6a61e9b0ba006f85c",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 匿名登入（無密碼）
export async function ensureSignedInAnonymously() {
  // 若已登入就直接返回
  if (auth.currentUser) return auth.currentUser;
  // 等待現有 session（如果有）或執行匿名登入
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          unsub();
          resolve(u);
        } else {
          const cred = await signInAnonymously(auth);
          unsub();
          resolve(cred.user);
        }
      } catch (e) {
        unsub();
        reject(e);
      }
    });
  });
}

// ---------- 2) Firestore 路徑設計 ----------
// users/{username}/settings/main
// users/{username}/entries/{dateId}   // dateId = YYYY-MM-DD
function userRoot(username) {
  const u = normalizeName(username);
  return `users/${u}`;
}
function settingsDocPath(username) {
  return `${userRoot(username)}/settings/main`;
}
function entryDocPath(username, dateId) {
  return `${userRoot(username)}/entries/${dateId}`;
}

// ---------- 3) Health check：寫入 + 讀取 ----------
export async function healthCheck(username) {
  await ensureSignedInAnonymously();
  const now = new Date().toISOString();
  const ref = doc(db, `${userRoot(username)}/health/ping`);
  await setDoc(ref, { ts: serverTimestamp(), clientISO: now }, { merge: true });
  const snap = await getDoc(ref);
  return { ok: snap.exists(), data: snap.data() || null };
}

// ---------- 4) Settings CRUD ----------
export async function getSettings(username) {
  await ensureSignedInAnonymously();
  const ref = doc(db, settingsDocPath(username));
  const snap = await getDoc(ref);
  if (!snap.exists()) return { savingsRatio: 0 };
  return snap.data();
}

export async function setSettings(username, settings) {
  await ensureSignedInAnonymously();
  const ref = doc(db, settingsDocPath(username));
  await setDoc(ref, { ...settings, updatedAt: serverTimestamp() }, { merge: true });
}

// ---------- 5) Entries CRUD ----------
export async function listEntries(username, opts = {}) {
  await ensureSignedInAnonymously();
  const { limitRows = 365, order = "desc" } = opts;
  const coll = collection(db, `${userRoot(username)}/entries`);
  const q = query(coll, orderBy("date", order === "desc" ? "desc" : "asc"), limit(limitRows));
  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => rows.push(d.data()));
  return rows;
}

export async function saveEntry(username, entry) {
  await ensureSignedInAnonymously();
  // entry 需包含 { date: "YYYY-MM-DD", improve, gratitude:[], bookkeeping:bool }
  if (!entry || !entry.date) throw new Error("saveEntry: entry.date is required (YYYY-MM-DD)");
  const ref = doc(db, entryDocPath(username, entry.date));
  await setDoc(ref, { ...entry, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteEntry(username, dateId) {
  await ensureSignedInAnonymously();
  if (!dateId) throw new Error("deleteEntry: dateId is required");
  const ref = doc(db, entryDocPath(username, dateId));
  await deleteDoc(ref);
}
