// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBo5PK2DE-1Dm1NITEfounaFsdMXxRJcxY",
  authDomain: "cybernetic-pact-475902-c8.firebaseapp.com",
  projectId: "cybernetic-pact-475902-c8",
  storageBucket: "cybernetic-pact-475902-c8.firebasestorage.app",
  messagingSenderId: "39386275749",
  appId: "1:39386275749:web:374b080c1ee4a29aa9924c",
  measurementId: "G-GE7LPDYVXR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);