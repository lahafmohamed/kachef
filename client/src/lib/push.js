import { useSyncExternalStore } from 'react';
import { api } from '../api';

/*
 * Web Push on this device, for the signed-in account. The service worker
 * (public/sw.js) only shows the notifications; the server decides who gets what
 * (server/push.js). One device can serve several accounts — two brothers on one
 * phone — so «on» always means: on for this account, here.
 *
 * States: loading · on · off (can be switched on) · denied (blocked in the browser)
 * · ios-install (iPhone/iPad outside the home-screen app, where Safari has no push)
 * · unsupported · unavailable (the server has no keys) · error.
 */

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const supported = () =>
  window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Once per page load: the worker that shows the notifications. Caches nothing. */
export function registerServiceWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* no worker, no push — the app itself is unaffected */
  });
}

const toBase64Url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// A subscription is tied to the server key it was made with; after a key change it is dead
const madeWith = (sub, key) =>
  !!sub.options?.applicationServerKey && toBase64Url(sub.options.applicationServerKey) === key.replace(/=+$/, '');

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// ---------- shared state: the bell, the settings and the dashboard prompt read one copy ----------

let snapshot = { state: 'loading', endpoint: null };
const listeners = new Set();
const set = (next) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const usePushDevice = () => useSyncExternalStore(subscribe, () => snapshot);

// Each read or switch bumps it: an answer arriving after a newer one (a language flipped
// twice, a sign-out then another account) is dropped instead of overwriting it
let generation = 0;

/**
 * Reads this device's state for the account, and tells the server the interface
 * language — the language its notifications are written in. Never subscribes by itself.
 */
export async function refreshPush(lang) {
  const mine = ++generation;
  const settle = (next) => mine === generation && set(next);
  try {
    if (isIOS() && !isStandalone() && !('PushManager' in window)) return settle({ state: 'ios-install', endpoint: null });
    if (!supported()) return settle({ state: 'unsupported', endpoint: null });
    if (Notification.permission === 'denied') return settle({ state: 'denied', endpoint: null });
    const sub = await currentSubscription();
    if (!sub || Notification.permission !== 'granted') return settle({ state: 'off', endpoint: null });
    const { publicKey } = await api.get('/push/key');
    if (!publicKey) return settle({ state: 'unavailable', endpoint: null });
    if (!madeWith(sub, publicKey)) return settle({ state: 'off', endpoint: null });
    const { subscribed } = await api.post('/push/subscriptions/sync', { ...sub.toJSON(), lang });
    settle({ state: subscribed ? 'on' : 'off', endpoint: subscribed ? sub.endpoint : null });
  } catch {
    settle({ state: 'error' });
  }
}

/**
 * Switches push on here. Call it straight from the click: Safari only shows the
 * permission prompt inside the gesture. Resolves to the browser's answer.
 */
export async function enablePush(lang) {
  generation += 1; // a read still on its way must not undo this
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    set({ state: permission === 'denied' ? 'denied' : 'off' });
    return permission;
  }
  const { publicKey } = await api.get('/push/key');
  if (!publicKey) {
    set({ state: 'unavailable' });
    throw new Error('push_unavailable');
  }
  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !madeWith(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
  await api.post('/push/subscriptions', { ...sub.toJSON(), lang });
  set({ state: 'on', endpoint: sub.endpoint });
  return 'granted';
}

/** Off for this account on this device; the browser keeps its subscription for the others. */
export async function disablePush() {
  generation += 1;
  const sub = await currentSubscription();
  if (sub) await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
  set({ state: 'off', endpoint: null });
}

/** A test notification to this device. */
export const testPush = () => api.post('/push/test', { endpoint: snapshot.endpoint });
