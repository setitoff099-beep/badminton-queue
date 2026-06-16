const CACHE_NAME = 'badminton-v2';
// รายชื่อไฟล์ในระบบทั้งหมดที่เจ๋งมี
const urlsToCache = [
  './',
  './index.html',
  './index2.html',
  './billing.html',
  './history.html',
  './manifest.json'
];

// ตอนติดตั้ง Service Worker ให้จำไฟล์หลักๆ ไว้
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// ตอนดึงข้อมูล ให้พยายามดึงจากเน็ตเวิร์คก่อน (เพื่อให้ได้ข้อมูลอัปเดต) ถ้าไม่ได้ค่อยดึงจาก Cache
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});