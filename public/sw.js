// Service worker tối giản — chỉ để Chrome coi trang là "installable" (điều kiện bắt buộc
// để beforeinstallprompt tự bắn ra), không cache/offline gì thêm.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // cần có fetch handler để thoả điều kiện installable
