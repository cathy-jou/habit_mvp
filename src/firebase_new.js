// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBo5PK2DE-1Dm1NITEfounaFsdMXxRJcxY",
  authDomain: "cybernetic-pact-475902-c8.firebaseapp.com",
  projectId: "cybernetic-pact-475902-c8",
  storageBucket: "cybernetic-pact-475902-c8.appspot.com", // 這行不影響 Firestore，保留即可
  messagingSenderId: "39386275749",
  appId: "1:39386275749:web:374bb080c1ee4a29aa9924c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
