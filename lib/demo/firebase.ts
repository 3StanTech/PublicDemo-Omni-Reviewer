import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAvRiumYrU4K0OR2C2vIg_s8i7eVD8rWSM",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "omni-reviewer-demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "omni-reviewer-demo",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:393547047731:web:51d463bfaeb114e7f11446",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "393547047731",
};
const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "6LcUvOktAAAAAHib82jgn2v_tWkmbnTz8sAwHTZG";

type Runtime = { auth: Auth; db: Firestore };
let runtime: Promise<Runtime> | undefined;
let signingIn: Promise<User> | undefined;
const profiles = new Map<string, Promise<void>>();

async function initialize(): Promise<Runtime> {
  const [appSdk, checkSdk, authSdk, storeSdk] = await Promise.all([
    import("firebase/app"), import("firebase/app-check"),
    import("firebase/auth"), import("firebase/firestore"),
  ]);
  const app = appSdk.getApps().find((entry) => entry.name === "omni-reviewer-demo")
    ?? appSdk.initializeApp(firebaseConfig, "omni-reviewer-demo");
  const debug = process.env.NEXT_PUBLIC_APPCHECK_DEBUG;
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && debug && debug !== "false") {
    (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean })
      .FIREBASE_APPCHECK_DEBUG_TOKEN = debug === "true" ? true : debug;
  }
  checkSdk.initializeAppCheck(app, {
    provider: new checkSdk.ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const db = storeSdk.initializeFirestore(app, { localCache: storeSdk.persistentLocalCache() });
  const auth = authSdk.getAuth(app);
  authSdk.onAuthStateChanged(auth, () => { signingIn = undefined; });
  await auth.authStateReady();
  return { auth, db };
}

export async function readyFirebase(): Promise<{ uid: string; db: Firestore }> {
  // Importing the client during static prerender must not start Auth or reCAPTCHA.
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Demo progress is available in the browser only.");
  }
  runtime ??= initialize().catch((error: unknown) => { runtime = undefined; throw error; });
  const { auth, db } = await runtime;
  const authSdk = await import("firebase/auth");
  const user = auth.currentUser ?? await (signingIn ??= authSdk.signInAnonymously(auth)
    .then((result) => result.user)
    .catch((error: unknown) => { signingIn = undefined; throw error; }));
  if (!user.isAnonymous) throw new Error("The demo requires an anonymous visitor session.");
  if (!profiles.has(user.uid)) {
    const profile = (async () => {
      const { doc, getDoc, runTransaction, serverTimestamp } = await import("firebase/firestore");
      const ref = doc(db, "demos", user.uid);
      if ((await getDoc(ref)).exists()) return;
      await runTransaction(db, async (transaction) => {
        if (!(await transaction.get(ref)).exists()) {
          transaction.set(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }
      });
    })().catch((error: unknown) => { profiles.delete(user.uid); throw error; });
    profiles.set(user.uid, profile);
  }
  await profiles.get(user.uid);
  return { uid: user.uid, db };
}
