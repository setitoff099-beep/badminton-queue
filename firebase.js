    import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
    import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

    const firebaseConfig = {
        apiKey: "AIzaSyDjr0JN8PsYD2aij_ltzUk9GccN0gqsw4",
        authDomain: "badmintonqueue-a8ed0.firebaseapp.com",
        databaseURL: "https://badmintonqueue-a8ed0-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "badmintonqueue-a8ed0",
        storageBucket: "badmintonqueue-a8ed0.appspot.com",
        messagingSenderId: "822657948314",
        appId: "1:822657948314:web:9687af599920298c469163",
        measurementId: "G-MT942JX2PP"
    };

    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const dbRef = ref(db, 'badminton/tournamentState');

    window.saveToCloud = function(stateStr) {
        // [แก้ไข] เซฟเป็น { data: "string" } แทนที่จะ JSON.parse แล้วเซฟเป็น object
        // เพราะ Firebase ไม่อนุญาตให้ใช้ . $ # [ ] / ใน key
        // และชื่อผู้เล่นถูกใช้เป็น key ใน historyPairs/playerStats → ถ้าชื่อมีจุดจะ reject ทั้งหมด
        set(dbRef, { data: stateStr })
            .then(() => {
                _setCloudStatus('online');
            })
            .catch((err) => {
                console.error('Firebase save error:', err);
                _setCloudStatus('error');
            });
    };
    window.clearCloudData = function() {
        // [แก้ไข] ล้าง Firebase แล้ว redirect เสมอ ไม่ว่า Firebase จะสำเร็จหรือไม่
        // ป้องกันปัญหากดจบแล้วค้างเพราะ Firebase error หรือเน็ตหลุด
        remove(dbRef)
            .catch((err) => { console.error('Firebase clear error (non-blocking):', err); })
            .finally(() => { window.location.href = 'index.html'; });
    };
    let _cloudInitialized = false;

    onValue(dbRef, (snapshot) => {
        const val = snapshot.val();
        // [แก้ไข] รับ { data: "string" } แล้ว parse กลับเป็น object ก่อนส่งไป restoreFromCloud
        const cloudData = val && val.data ? JSON.parse(val.data) : null;

        if (cloudData && window.restoreFromCloud) {
            // Firebase มีข้อมูล → sync มาที่เครื่องนี้
            window.restoreFromCloud(cloudData);
        } else if (!cloudData && !_cloudInitialized) {
            // Firebase ว่างเปล่า + เชื่อมสำเร็จครั้งแรก
            // → ถ้าเครื่องนี้มีข้อมูลใน localStorage ให้ push ขึ้น Firebase ทันที
            const localState = localStorage.getItem('badminton_game_state');
            if (localState && window.saveToCloud) {
                window.saveToCloud(localState);
            }
        }

        _cloudInitialized = true;
        _setCloudStatus('online');
    }, (err) => {
        console.error('Firebase listen error:', err);
        _setCloudStatus('error');
    });

    // อัปเดต indicator 🟢/🔴 บน top-nav ให้สะท้อนสถานะ sync จริงๆ
    function _setCloudStatus(status) {
        const el = document.querySelector('.top-nav span[style*="color"]');
        if (!el) return;
        if (status === 'online') {
            el.textContent = '🟢 ออนไลน์';
            el.style.color = '#10b981';
        } else {
            el.textContent = '🔴 sync ล้มเหลว';
            el.style.color = '#ef4444';
        }
    }
