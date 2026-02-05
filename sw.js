const CACHE_NAME = 'uni-bot-cache-v3'; // نسخة جديدة لإجبار المتصفح على التحديث

// الملفات التي يجب حفظها لكي يعمل الموقع بدون إنترنت
const ASSETS_TO_CACHE = [
    './', // الصفحة الرئيسية
    'index.html' // ملف الـ HTML
];

// 1. التثبيت: حفظ الملفات الأساسية
self.addEventListener('install', e => {
    console.log('[SW] Installing Service Worker...');
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching app shell');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting(); // تفعيل الـ SW الجديد فوراً
});

// 2. التفعيل: حذف الكاش القديم
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. معالجة الطلبات (Fetch Logic) - الجزء الأهم
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // (أ) استراتيجية الشبكة دائماً لبيانات JSONBin (لضمان تحديث البيانات)
    if (url.hostname.includes('jsonbin.io')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // (ب) استراتيجية الكاش أولاً للملفات (الصور، PDFs، الروابط)
    // هذا يتيح فتح الملفات المحملة سابقاً بدون إنترنت
    if (e.request.method === 'GET') {
        e.respondWith(
            caches.match(e.request).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(e.request).then(networkResponse => {
                    // حفظ النسخة الجديدة في الكاش
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(e.request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(error => {
                    // في حالة فشل الشبكة وعدم وجود الكاش (للصفحة الرئيسية فقط)
                    // نحاول إعادة توجيهه للصفحة المحفوظة
                    if (e.request.mode === 'navigate') {
                        return caches.match('./').then(res => res || caches.match('index.html'));
                    }
                    throw error;
                });
            })
        );
    }
});