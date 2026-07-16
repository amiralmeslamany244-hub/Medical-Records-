// firebase.js — minimal Firebase Realtime Database wrapper
// Loads only what we need (tree-shaken modular SDK v10 from gstatic CDN).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, child, get, update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

// TODO: paste your firebaseConfig here (same one used by the main app).
const firebaseConfig = {
  apiKey: "AIzaSyCmxCr5-jG9MPWRQea5TOzWlUk8pgRMjrs",
  authDomain: "ymco-medical-records.firebaseapp.com",
  databaseURL: "https://ymco-medical-records-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ymco-medical-records",
  storageBucket: "ymco-medical-records.firebasestorage.app",
  messagingSenderId: "50957375156",
  appId: "1:50957375156:web:5797087c6514bd796269e1",
  measurementId: "G-C335G5EL6N",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/**
 * Fetch a single checklist by barcode. Uses a one-shot get() (no listener).
 * Expected data shape at /checklists/{barcode}:
 *   { title: string, items: { [id]: { text: string, done?: boolean } } }
 * Returns null if not found.
 */
export async function fetchChecklist(barcode) {
  const snap = await get(child(ref(db), `checklists/${barcode}`));
  return snap.exists() ? snap.val() : null;
}

/**
 * Partial update — only writes the fields that actually changed.
 * `changes` is a map of { itemId: boolean } for done flags.
 */
export async function saveChecklistDiff(barcode, changes) {
  const patch = {};
  for (const [id, done] of Object.entries(changes)) {
    patch[`checklists/${barcode}/items/${id}/done`] = done;
  }
  patch[`checklists/${barcode}/updatedAt`] = Date.now();
  await update(ref(db), patch);
}
