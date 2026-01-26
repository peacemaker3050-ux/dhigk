// ============================================================
// === HYBRID SERVICE WORKER (FCM + POLLING) ===
// ============================================================

// 1. IMPORT FIREBASE LIBRARIES (لتفعيل FCM)
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// 2. CONFIGURATION (Firebase + JSONBin)
const firebaseConfig = {
  apiKey: "AIzaSyBUzcbZDAFS3rhjcp2-maEiSTmuBmUlGPQ",
  authDomain: "libirary-b2424.firebaseapp.com",
  projectId: "libirary-b2424",
  storageBucket: "libirary-b2424.firebasestorage.app",
  messagingSenderId: "371129360013",
  appId: "1:371129360013:web:377ef70759204018a60cc4"
};

// تهيئة Firebase فوراً
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// إعدادات JSONBin
const CACHE_VERSION = 'v20'; 
const BIN_ID = "696e77bfae596e708fe71e9d";
const BIN_KEY = "$2a$10$TunKuA35QdJp478eIMXxRunQfqgmhDY3YAxBXUXuV/JrgIFhU0Lf2";

// 3. INDEXEDDB SETUP (من كودك القديم - مهم لحفظ التوكن)
let db;
let dbReady = false;

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('UniBotSWDB', 1);
    request.onupgradeneeded = (e) => {
        db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('auth')) {
            db.createObjectStore('auth', { keyPath: 'id' });
        }
    };
    request.onsuccess = (e) => {
        db = e.target.result;
        dbReady = true;
        console.log("[SW] DB Initialized");
        resolve(db);
    };
    request.onerror = (e) => {
        console.error("[SW] DB Error", e);
        reject(e);
    };
  });
};

// دالات مساعدة لجلب التوكن والوقت
async function getUserToken() {
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction('auth', 'readonly');
        const store = tx.objectStore('auth');
        const req = store.get('userToken');
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function getLastTime() {
    if (!db) return 0;
    return new Promise((resolve) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get('lastNotifTime');
        req.onsuccess = () => resolve(req.result ? req.result.value : 0);
        req.onerror = () => resolve(0);
    });
}

async function setLastTime(time) {
    if (!db) return;
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'lastNotifTime', value: time });
}

async function saveUserToken(token) {
    if (!db) return;
    const tx = db.transaction('auth', 'readwrite');
    tx.objectStore('auth').put({ id: 'userToken', value: token });
    console.log("[SW] Token saved to DB");
}

// 4. SW LIFECYCLE EVENTS
self.addEventListener('install', event => { 
    self.skipWaiting(); 
    console.log("[SW] Installed");
    // نقوم بتهيئة الـ DB فوراً عند التثبيت
    initDB();
});

self.addEventListener('activate', event => { 
    event.waitUntil(self.clients.claim()); 
    console.log("[SW] Activated");
    // بدء الفحص الدوري (Polling) كـ Backup للنظام
    event.waitUntil(
        setInterval(() => {
            checkNotifications();
        }, 20000) // كل 20 ثانية (كما كان في كودك)
    );
});

// 5. FCM: استقبال الإشعارات في الخلفية (مهم جداً)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] FCM Message received:', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png',
    vibrate: [200, 100, 200],
    data: {
        click_action: payload.fcmOptions?.link || '/'
    }
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// التعامل مع الضغط على إشعار FCM
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.click_action || '/')
    );
});

// 6. استقبال الرسائل من التطبيق (Test Messages)
self.addEventListener('message', event => {
    const data = event.data;
    // FCM Test Messages
    if (data.type === 'SYNCED_NOTIF_DOCTOR' || data.type === 'TEST_NOTIF') {
        if (Notification.permission === 'granted') {
            self.registration.showNotification(data.type === 'TEST_NOTIF' ? '🧪 Test Successful' : '📢 Messages from Doctors', { 
                body: data.body || 'Tap to read details.', 
                icon: data.icon || 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png', 
                requireInteraction: false, 
                tag: 'doctor-notification', 
                silent: false, 
                vibrate: [200, 100, 200] 
            });
        }
    }
});

// 7. POLLING LOGIC (منطق JSONBin القديم - يعمل كـ Backup)
async function checkNotifications() {
    if (!dbReady) {
        console.log("[SW] DB not ready yet...");
        // نحاول تهيئة الـ DB مرة أخرى
        await initDB();
        if(!dbReady) return;
    }

    const userToken = await getUserToken();
    const lastNotifTime = await getLastTime();

    // ملاحظة: هذا الفحص يأخذ التوكن ويرسله للسيرفر (ليس فكرة جيدة إذا كان التوكن خاص)
    // بما أننا نستخدم Master Key هنا، فالـ Polling يعمل بشكل عام.
    // إذا أردت استخدام FCM لاحقاً، يمكنك تقليل أهمية هذا الجزء.

    const url = 'https://api.jsonbin.io/v3/b/'+BIN_ID+'/latest?nocache=' + Date.now();
    const headers = { 
        'X-Master-Key': BIN_KEY, 
        'X-Bin-Meta': 'false'
    };
    
    if (userToken) {
        // نحاول إرسال التوكن في الهيدر لكي يتعرف السيرفر به (اختياري)
        headers['Authorization'] = `Bearer ${userToken}`;
    }

    fetch(url, { method: 'GET', headers: headers })
    .then(res => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.json();
    })
    .then(data => {
        // هذا هو الشرط القديم الخاص بك للفحص
        if (data && data.latestNotificationUpdate && data.latestNotificationUpdate > lastNotifTime) {
            console.log("[SW] New Update via Polling!");
            setLastTime(data.latestNotificationUpdate);

            if (Notification.permission === 'granted') {
                self.registration.showNotification('📢 Messages from Doctors', { 
                    body: 'Tap to open app and read details.', 
                    icon: 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png', 
                    requireInteraction: false,
                    tag: 'doctor-notification', 
                    silent: false, 
                    vibrate: [200, 100, 200] 
                });
            }
        }
    })
    .catch(err => {
        console.error("[SW] Polling Error:", err);
    });
}

// 8. Periodic Background Sync (Android Only)
self.addEventListener('sync', event => {
    console.log("[SW] Sync Triggered:", event.tag);
    if (event.tag === 'check-doctor-msg') {
        event.waitUntil(checkNotifications());
    }
});