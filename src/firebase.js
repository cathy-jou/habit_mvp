// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ---- Name normalization ----
export function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

// ---- Paths ----
export const paths = {
  profileDoc: (name) => doc(db, "usersByName", normalizeName(name), "profile", "info"),
  settingsDoc: (name) => doc(db, "usersByName", normalizeName(name), "settings", "config"),
  entriesCol: (name) => collection(db, "usersByName", normalizeName(name), "entries"),
  entryDoc: (name, dateISO) => doc(db, "usersByName", normalizeName(name), "entries", dateISO),
};

// ---- Read/Write APIs ----
export async function getProfile(name) {
  const snap = await getDoc(paths.profileDoc(name));
  return snap.exists() ? snap.data() : null;
}

export async function setProfile(name, data) {
  await setDoc(paths.profileDoc(name), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function getSettings(name) {
  const snap = await getDoc(paths.settingsDoc(name));
  return snap.exists() ? snap.data() : { savingsRatio: 0 };
}

export async function setSettings(name, partial) {
  await setDoc(paths.settingsDoc(name), { ...partial, updatedAt: serverTimestamp() }, { merge: true });
}

export async function listEntries(name) {
  const snap = await getDocs(paths.entriesCol(name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveEntry(name, dateISO, data) {
  await setDoc(paths.entryDoc(name, dateISO), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteEntry(name, dateISO) {
  await setDoc(paths.entryDoc(name, dateISO), { __deleted: true, updatedAt: serverTimestamp() }, { merge: true });
}
