    let players = [];
    let mainQueue = []; 
    let historyPairs = {}; 
    let opponentHistory = {}; // ประวัติการเจอกันในฐานะคู่ต่อสู้ (A เจอ B กี่รอบ)
    let recentPairs = [];     // partner pairs ล่าสุด RECENT_GAMES เกม → ห้ามซ้ำ
    let recentOpponents = []; // opponent pairs ล่าสุด → Champion Bias
    let eliminatedOrder = []; 
    let matchHistory = [];
    let playerStats = {};
    let lockedPairs = {}; 
    
    let winScore = 21;
    let maxChamps = 1;
    let numCourts = 1;

    // ── ตัวแปรน้ำหนักคะแนน (ปรับตรงนี้จุดเดียว ไม่ต้องไล่หาทั้งไฟล์) ──
    const PARTNER_WEIGHT  = 12;  // โทษต่อครั้งที่เคยเป็นคู่กัน
    const OPP_WEIGHT      = 6;   // โทษต่อครั้งที่เคยเจอกันเป็นคู่ต่อสู้ (สมดุลกับ PARTNER มากขึ้น 2:1 แทน 3:1)
    const OPP_FLAT        = 50;  // โทษคงที่เมื่อ partner ซ้ำ (ใน optimizeFourPlayers)
    const OPP_SCALE       = 5;   // โทษเพิ่มตาม hist (ใน optimizeFourPlayers)
    const DIVERSITY_WEIGHT = 1;  // โบนัสกระจายคู่: คนที่ยังเล่นกับคนในสนามน้อยจะได้ priority
    const H_MAX_OPP       = 5;   // cap ของ opponentHistory (ไม่ให้โตไม่รู้จบ)
    const DECAY_INTERVAL  = 15;  // ทุก N เกม ให้ decay ค่า history ลง
    const DECAY_FACTOR    = 0.9; // อัตราการ decay (0.9 = ลง 10% ต่อรอบ)
    const SCORE_TOLERANCE = 5;   // คะแนนต่างกันไม่เกินนี้ → สุ่มแทนเลือกค่าต่ำสุดเสมอ ดูเป็นธรรมชาติ
    const RECENT_GAMES    = 3;   // จำนวนเกมล่าสุดที่จะหลีกเลี่ยงคู่ซ้ำ (anti-repeat รอบสั้น)
    const RECENT_OPP_PENALTY = 12; // โทษเพิ่มถ้า challenger เพิ่งเจอ champ ทีมนี้มา (Champion Bias)
    let courts = []; 
    
    let startTimeExact = null;
    let startTimeCalculated = null;
    let globalMatchCounter = 0;

    // จำนวนรอบสูงสุดที่เก็บในประวัติ (ใช้ค่าเดียวกันทั้ง index.html และ history.html)
    const MAX_HISTORY = 3;

    // ตรวจสอบ URL parameter: ?mode=single → จำกัดแชมป์ 1 สมัย
    const _urlParams = new URLSearchParams(window.location.search);
    const _isSingleMode = _urlParams.get('mode') === 'single';

    // --- เพิ่มโค้ดส่วนนี้ ---
    let cachedNextMatch = null;

    // ═══ DEBUG MODE: ไม่กระทบ behavior เลยเมื่อปิด (default false) ═══
    // เปิดได้จาก console: DEBUG_MATCHMAKING = true
    // ดู log: console.table(matchmakingLog[matchmakingLog.length-1].candidates)
    let DEBUG_MATCHMAKING = false;
    let matchmakingLog = [];

    // [แก้ไข] ป้องกัน XSS: แปลงอักขระพิเศษ HTML ก่อนนำไปแสดงผลใน innerHTML
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    // [แก้ไข] สุ่มลำดับแบบ Fisher-Yates ซึ่งถูกต้องและ uniform random จริง
    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // [แก้ไข] Hash PIN ด้วย SHA-256 ผ่าน Web Crypto API (ไม่เก็บรหัสดิบในโค้ด)
    async function hashPIN(pin) {
        const msgBuffer = new TextEncoder().encode(pin);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function clearPreviewCache() {
        cachedNextMatch = null;
        let previewBox = document.getElementById('nextUpPreviewBox');
        if (previewBox) previewBox.innerHTML = '';
    }

    // ฟังก์ชันกลางสำหรับแสดง popup แจ้งเตือน (ใช้แทนโค้ดซ้ำหลายจุด)
    function showNotification(html, color = '#f59e0b') {
        let popup = document.createElement('div');
        popup.innerHTML = html;
        popup.style.cssText = `position:fixed; top:20px; right:20px; background:${color}; color:#fff; padding:15px; border-radius:8px; z-index:9999; box-shadow:0 4px 6px rgba(0,0,0,0.1); font-size:14px; animation: fadeOut 5s forwards;`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 5000);
    }
    // ----------------------

    function getCurrentTimeStr() {
        let now = new Date();
        return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    // --- ระบบจัดการคอร์ทแบบแยกอิสระ ---
    function openMidGameSettings() {
        let html = `
            <div class="form-group" style="background: #e0f2fe; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd;">
                <label style="color:#0369a1;">เปิดจำนวนกี่คอร์ท?:</label>
                <select id="midNumCourts" onchange="renderMidGameCourtsSettings()" class="protected-btn">
                    <option value="1" ${numCourts==1?'selected':''}>1 สนาม</option>
                    <option value="2" ${numCourts==2?'selected':''}>2 สนาม</option>
                    <option value="3" ${numCourts==3?'selected':''}>3 สนาม</option>
                    <option value="4" ${numCourts==4?'selected':''}>4 สนาม</option>
                    <option value="5" ${numCourts==5?'selected':''}>5 สนาม</option>
                    <option value="6" ${numCourts==6?'selected':''}>6 สนาม</option>
                    <option value="7" ${numCourts==7?'selected':''}>7 สนาม</option>
                    <option value="8" ${numCourts==8?'selected':''}>8 สนาม</option>
                </select>
                <p style="font-size:12px; color:#0284c7; margin:5px 0 0 0;">(ถ้าลดคอร์ท คนในคอร์ทที่โดนปิดจะเด้งกลับเข้าคิว)</p>
            </div>
            <div id="midCourtsConfigContainer" style="max-height: 40vh; overflow-y: auto; padding-right: 5px;"></div>
        `;
        document.getElementById('midGameDynamicConfig').innerHTML = html;
        renderMidGameCourtsSettings();
        document.getElementById('midGameSettingsModal').style.display = 'flex';
    }

    function renderMidGameCourtsSettings() {
        let count = parseInt(document.getElementById('midNumCourts').value);
        let html = '';
        for(let i=0; i<count; i++) {
            let cWin = courts[i] ? (courts[i].winScore || winScore) : winScore; 
            let cChamp = courts[i] ? (courts[i].maxChamps || maxChamps) : maxChamps;
            html += `
                <div style="background:#f8fafc; padding:15px; border-radius:8px; margin-bottom:10px; border: 1px solid #e2e8f0;">
                    <strong style="display:block; margin-bottom:10px; color:#334155; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">🏸 คอร์ทที่ ${i+1}</strong>
                    <div style="display:flex; gap:10px;">
                        <div style="flex:1;">
                            <label style="font-size:12px;">แต้มจบ:</label>
                            <input type="number" id="midWin_${i}" value="${cWin}" min="1" class="protected-btn">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:12px;">แชมป์ (สมัย):</label>
                            <input type="number" id="midChamp_${i}" value="${cChamp}" min="1" class="protected-btn">
                        </div>
                    </div>
                </div>
            `;
        }
        document.getElementById('midCourtsConfigContainer').innerHTML = html;
    }

    function closeMidGameSettings() {
        document.getElementById('midGameSettingsModal').style.display = 'none';
    }

    function saveMidGameSettings() {
        let newNumCourts = parseInt(document.getElementById('midNumCourts').value);

        if (newNumCourts < numCourts) {
            if(!confirm(`คุณกำลังลดจำนวนคอร์ทจาก ${numCourts} เหลือ ${newNumCourts} คอร์ท\nคอร์ทที่เกินมาจะถูกปิด และผู้เล่นบนคอร์ทนั้นจะถูกดันกลับเข้าคิว ยืนยันไหมครับ?`)) return;
            
            for(let i = courts.length - 1; i >= newNumCourts; i--) {
                let court = courts[i];
                undoPartnerships(court.teamA, court.teamB);
                let onCourt = [];
                if (court.teamA) {
                    if (court.teamA.p1) onCourt.push(court.teamA.p1);
                    if (court.teamA.p2) onCourt.push(court.teamA.p2);
                }
                if (court.teamB) {
                    if (court.teamB.p1) onCourt.push(court.teamB.p1);
                    if (court.teamB.p2) onCourt.push(court.teamB.p2);
                }
                onCourt.reverse().forEach(p => { 
                    if(!eliminatedOrder.includes(p) && !mainQueue.includes(p)) eliminatedOrder.unshift(p); 
                });
            }
            courts.splice(newNumCourts); 
        }

        for(let i=0; i<newNumCourts; i++) {
            let wScore = parseInt(document.getElementById(`midWin_${i}`).value) || 21;
            let mChamp = parseInt(document.getElementById(`midChamp_${i}`).value) || 1;
            
            if (courts[i]) {
                courts[i].winScore = wScore;
                courts[i].maxChamps = mChamp;
            } else {
                courts.push({
                    id: i, name: `Court ${i+1}`, matchType: 'doubles',
                    teamA: null, teamB: null, scoreA: 0, scoreB: 0,
                    isGameOver: false, matchRound: 1, currentChamp: null, stateBeforeFinishStr: null, nextMatchData: null,
                    winScore: wScore, maxChamps: mChamp, isPaused: false
                });
            }
        }

        numCourts = newNumCourts;

        courts.forEach((c, idx) => {
            if (!c.teamA && !c.teamB && !c.isGameOver && !c.isPaused) {
                rePairCourtMatch(idx, true);
            }
        });

        closeMidGameSettings();
        renderAll();
        saveData();
    }

    function startTournament() {
            const text = document.getElementById('playerInput').value.trim();
            if(!text) { alert('กรุณากรอกชื่อผู้เล่นครับ'); return; }
            
            // --- ส่วนที่แก้ไขใหม่: ดึงชื่อผู้เล่นและเช็คสัญลักษณ์ + ---
            let rawLines = text.split('\n').map(p => p.trim()).filter(p => p !== "");
            let extractedPlayers = [];
            
            rawLines.forEach(line => {
                if(line.includes('+')) {
                    // ถ้ามี + ให้แยกชื่อออกเป็น 2 คน
                    let pair = line.split('+').map(p => p.trim()).filter(p => p !== "");
                    extractedPlayers.push(...pair);
                } else {
                    extractedPlayers.push(line);
                }
            });
            
            players = [...new Set(extractedPlayers)]; // ตัดชื่อที่อาจจะซ้ำกันออก
            
            numCourts = parseInt(document.getElementById('numCourtsSetting').value) || 1;
            let requiredPlayers = numCourts * 4;
            
            if(players.length < requiredPlayers) { 
                if(!confirm(`ถ้าเปิด ${numCourts} สนาม ปกติควรมีผู้เล่นเริ่มต้นอย่างน้อย ${requiredPlayers} คน แต่ถ้าคุณต้องการเล่น "ประเภทเดี่ยว (1v1)" คุณสามารถกดยืนยันเพื่อเริ่มได้เลยครับ ยืนยันหรือไม่?`)) return;
            }

            winScore = parseInt(document.getElementById('winScore').value) || 21;
            maxChamps = parseInt(document.getElementById('maxChamps').value) || 1;
            
            // ถ้าเปิดด้วย ?mode=single ให้บังคับแชมป์ 1 สมัยเสมอ
            if (_isSingleMode) maxChamps = 1;
            
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            startTimeExact = `${h}:${m}`;
            const calcM = now.getMinutes() >= 30 ? '30' : '00';
            startTimeCalculated = `${h}:${calcM}`;
            
            initFreshData(); // ฟังก์ชันนี้จะเคลียร์ค่า lockedPairs เราจึงต้องเซ็ตค่าใหม่ด้านล่าง
            
            // --- ส่วนที่แก้ไขใหม่: บันทึกการล็อคคู่เข้าสู่ระบบ ---
            rawLines.forEach(line => {
                if(line.includes('+')) {
                    let pair = line.split('+').map(p => p.trim()).filter(p => p !== "");
                    if(pair.length >= 2) {
                        lockedPairs[pair[0]] = pair[1];
                        lockedPairs[pair[1]] = pair[0];
                    }
                }
            });
            
            mainQueue = shuffleArray(players); // [แก้ไข] ใช้ Fisher-Yates แทน sort() ที่ให้ผลลำเอียง
            
            document.getElementById('setupSection').classList.remove('active');
            document.getElementById('gameSection').classList.add('active');
            
            setupAllCourts(); // ระบบจะจับคู่ตาม lockedPairs อัตโนมัติในฟังก์ชันนี้
            saveData(); 
        }

    function initFreshData() {
        eliminatedOrder = []; matchHistory = []; courts = [];
        historyPairs = {}; playerStats = {}; lockedPairs = {}; 
        globalMatchCounter = 0;
        
        let timeNow = getCurrentTimeStr();

        players.forEach(p => {
            historyPairs[p] = {};
            playerStats[p] = { played: 0, wins: 0, losses: 0, waitingRounds: 0, arrivalTime: timeNow, lastBenchTime: 0, onBreak: false };
            players.forEach(p2 => { if(p !== p2) historyPairs[p][p2] = 0; });
            if (!opponentHistory[p]) opponentHistory[p] = {};
            players.forEach(p2 => { if(p !== p2) { if(!opponentHistory[p2]) opponentHistory[p2] = {}; opponentHistory[p][p2] = 0; opponentHistory[p2][p] = 0; } });
        });

        for(let i = 0; i < numCourts; i++) {
            courts.push({
                id: i, name: `Court ${i+1}`, matchType: 'doubles', 
                teamA: null, teamB: null, scoreA: 0, scoreB: 0,
                isGameOver: false, matchRound: 1, currentChamp: null, stateBeforeFinishStr: null, nextMatchData: null,
                winScore: winScore, maxChamps: maxChamps, isPaused: false
            });
        }
    }

    function getAvailablePlayers(excludeList) {
        let pool = [];
        for (let p of mainQueue) { if (!excludeList.includes(p) && !(playerStats[p] && playerStats[p].onBreak)) pool.push(p); }
        for (let p of eliminatedOrder) { if (!excludeList.includes(p) && !pool.includes(p) && !(playerStats[p] && playerStats[p].onBreak)) pool.push(p); }
        return pool;
    }

    function pullPlayer(playerName) {
        mainQueue = mainQueue.filter(p => p !== playerName);
        eliminatedOrder = eliminatedOrder.filter(p => p !== playerName);
    }

// 🌟 1. อัปเกรดลอจิกเลือกทีมหลัก ( selectTeam )
