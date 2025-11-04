// src/cloud.js
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// Read ?link=xxxxx from URL
export function getLinkIdFromURL() {
  const u = new URL(window.location.href);
  return u.searchParams.get("link") || null;
}

// Ensure linkId exists in URL; if not, generate a UUID and inject it
export function ensureLinkIdInURL() {
  let link = getLinkIdFromURL();
  if (!link) {
    // Use Web Crypto UUID
    link = crypto.randomUUID();
    const u = new URL(window.location.href);
    u.searchParams.set("link", link);
    window.history.replaceState({}, "", u.toString());
  }
  return link;
}

// ---- Entries CRUD ----
export async function loadEntries(linkId) {
  const col = collection(db, "boards", linkId, "entries");
  const snap = await getDocs(col);
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  // Normalize shape to App.jsx needs
  return arr.map((e) => ({
    date: e.date,
    improve: e.improve,
    gratitude: e.gratitude || [],
    bookkeeping: !!e.bookkeeping,
  }));
}

export async function upsertEntry(linkId, payload) {
  // Use date as document id (1 record per day)
  const ref = doc(db, "boards", linkId, "entries", payload.date);
  await setDoc(ref, payload, { merge: true });
}

export async function removeEntry(linkId, date) {
  const ref = doc(db, "boards", linkId, "entries", date);
  await deleteDoc(ref);
}

// ---- Settings ----
export async function loadSettings(linkId) {
  const ref = doc(db, "boards", linkId, "settings", "global");
  const s = await getDoc(ref);
  if (!s.exists()) return { savingsRatio: 0 };
  return s.data();
}

export async function saveSettings(linkId, settings) {
  const ref = doc(db, "boards", linkId, "settings", "global");
  await setDoc(ref, settings, { merge: true });
}
