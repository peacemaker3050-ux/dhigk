const CACHE_NAME = 'uni-bot-cache-v4'; // تحديث رقم الإصدار لضمان التحديث

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // حفظ الصفحة الرئيسية فقط عند التثبيت
            return cache.addAll(['./', 'index.html']);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // استراتيجية (أ): الشبكة أولاً لبيانات JSONBin (للتحديث)
    if (url.hostname.includes('jsonbin.io')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // استراتيجية (ب): الكاش أولاً لملفات التليجرام والصور (للسرعة والأوفلاين)
    // هذا يجعل الملفات تفتح فوراً إذا كانت محملة من قبل
    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request).then(response => {
                // إذا كان رداً صحيحاً، احفظه للاستخدام القادم
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
                }
                return response;
            });
        }).catch(() => {
            // إذا فشل كل شيء وحاولنا فتح الصفحة نفسها
            if (e.request.mode === 'navigate') {
                return caches.match('./');
            }
        })
    );
});