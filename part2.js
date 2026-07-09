function selectTeam(excludeList, reqCount = 2, vsTeam = []) {
    let rawPool = getAvailablePlayers(excludeList);

    // ฟังก์ชันช่วย: เรียงผู้เล่นตาม lastBenchTime → played
    function sortByPriority(arr) {
        return [...arr].sort((a, b) => {
            let aBench = playerStats[a] ? (playerStats[a].lastBenchTime || 0) : 0;
            let bBench = playerStats[b] ? (playerStats[b].lastBenchTime || 0) : 0;
            if (aBench !== bBench) return aBench - bBench;
            let aPlayed = playerStats[a] ? (playerStats[a].played || 0) : 0;
            let bPlayed = playerStats[b] ? (playerStats[b].played || 0) : 0;
            return aPlayed - bPlayed;
        });
    }

    // [แก้ไข] กรองคนที่มีคู่ล็อคแต่คู่ไม่อยู่ใน rawPool ออกก่อน
    // เพื่อไม่ให้คนที่ล็อคคู่ถูกดึงมาเล่นโดยไม่มีคู่ของตัวเอง
    let validRawPool = rawPool.filter(p => !lockedPairs[p] || rawPool.includes(lockedPairs[p]));
    if (validRawPool.length < reqCount) validRawPool = rawPool;

    validRawPool = sortByPriority(validRawPool);

    // แยก "พักพอ" กับ "เพิ่งแพ้"
    let restedPool = validRawPool.filter(p => playerStats[p] && playerStats[p].lastBenchTime <= globalMatchCounter);
    // [แก้ไข Rule 1 — Just Played / Minimum Necessary Override]
    // เดิม fallback: restedPool ไม่พอ → ใช้ validRawPool "ทั้งก้อน" ทันที (ทิ้งการกันคนเพิ่งลงทั้งหมด)
    //   ผลคือ Immediate Replay: ดึงคนเพิ่งลง 2 คนได้ ทั้งที่ควรดึงเท่าที่จำเป็นเท่านั้น
    // ใหม่: เพราะ validRawPool ถูก sortByPriority (lastBenchTime น้อย→มาก) แล้ว คนพักพอ (rested)
    //   จึงเป็น "prefix" ของ validRawPool เสมอ และคนเพิ่งลง (lastBenchTime = gmc+1) เป็น suffix เสมอ
    //   → slice(0, max(reqCount, restedPool.length)) = restedPool ทั้งหมด + คนเพิ่งลง "เท่าที่ขาด" เท่านั้น
    //     - restedPool พอ (>= reqCount): slice = restedPool (ผลลัพธ์เท่าเดิมทุกประการ)
    //     - restedPool ไม่พอ: เติมคนเพิ่งลงที่ "พักนานสุดในกลุ่มเพิ่งลง" ทีละคนจนครบ (Minimum Necessary)
    //     - คนทั้งหมดไม่ถึง reqCount: slice = validRawPool ทั้งหมด (Availability floor เท่าเดิม)
    let pool = validRawPool.slice(0, Math.max(reqCount, restedPool.length));


    if (reqCount === 1) return pool.length > 0 ? pool.slice(0, 1) : validRawPool.slice(0, 1);

    // [แก้ไข] fallback reqCount=2 ต้องกรอง lockedPairs ด้วย ไม่ใช่แค่ slice ตรงๆ
    if (pool.length < 2) {
        let fb = validRawPool.filter(p => !lockedPairs[p]);
        if (fb.length >= 2) return fb.slice(0, 2);
        return validRawPool.slice(0, 2);
    }

    // --- Step 1: เช็คคู่ล็อค ---
    // [แก้ไข Bug โครงสร้างร้ายแรง] เดิม Step 1 ใช้ lastBenchTime (hasMorePatient) ทั้งหมด
    // ซึ่งเป็นคนละระบบกับ waitingRounds-based Fairness Gate ที่ใช้กับคนอื่นใน Step 2
    // ผลคือคู่ล็อคไม่ได้อยู่ใต้ fairness gate เดียวกับทุกคน
    // พบจริงจากการเทส (เรียก production code ตรงๆ ผ่าน vm, ไม่ใช่ copy logic):
    //   12 คน 1 สนาม → คู่ล็อครอถึง waitingRounds=12 ขณะที่คนอื่นสูงสุดแค่ 3
    // แก้: ใช้ waitingRounds เดียวกันทุกคน คู่ล็อคนับเป็น 1 หน่วยที่มี waiting = max ของทั้งคู่
    for (let p1 of pool) {
        if (!lockedPairs[p1]) continue;
        let lp = lockedPairs[p1];
        if (!validRawPool.includes(lp)) continue;

        let lockWaiting = Math.max(
            playerStats[p1] ? (playerStats[p1].waitingRounds || 0) : 0,
            playerStats[lp] ? (playerStats[lp].waitingRounds || 0) : 0
        );
        let nonLockedAvail = validRawPool.filter(p => !lockedPairs[p]);
        let othersMaxWaiting = nonLockedAvail.length > 0
            ? Math.max(0, ...nonLockedAvail.map(p => playerStats[p] ? (playerStats[p].waitingRounds || 0) : 0))
            : 0;

        if (lockWaiting > othersMaxWaiting) {
            // คู่ล็อครอนานกว่าทุกคนจริง → ต้องได้เล่น ไม่มีข้อยกเว้น (fairness floor)
            return [p1, lp];
        }
        if (lockWaiting === othersMaxWaiting) {
            // เสมอกัน → ใช้ Pair Lock Bias เป็น tiebreaker เท่านั้น (ไม่ override fairness)
            // ถ้าคู่ล็อคเพิ่งเล่นไปและมีตัวเลือกอื่น ให้คนอื่นไปก่อนตอนเสมอกัน
            if (isRecentPair(p1, lp) && nonLockedAvail.length >= 2) continue;
            return [p1, lp];
        }
        // lockWaiting < othersMaxWaiting → ยังไม่ถึงตาคู่ล็อค ปล่อยให้ Step 2 จัดการคนอื่นก่อน
    }

    // --- Step 2: หาคู่ที่ดีที่สุดจาก pool (ไม่มีล็อค) ---
    // [แก้ไข Bug หลัก] เดิม: เลือก p1 ที่พักนานสุด → หา p2 ที่ดีสุดสำหรับ p1
    //   ปัญหา: p1 เดิมซ้ำทุกรอบ → เกิด Silo ถาวร (เจ๋ง&พี่กาย, ลุงจ้อย&พี่น้ำแข็ง)
    // ใหม่: วนทุก combination จาก pool → เลือกคู่ที่มีคะแนนรวมต่ำสุด
    //   Score = historyPairs * 20 + (bench_i + bench_j)
    //   → คู่ที่ไม่เคยเล่นกัน (hist=0) ได้เปรียบมาก
    //   → rest time ยังใช้เป็น tiebreaker เพื่อความยุติธรรม
    let nonLockedPool = pool.filter(p => !lockedPairs[p]);

    // [แก้ไข] ถ้า nonLockedPool < 2 คน ให้ขยายหาจาก validRawPool ด้วย
    // เพื่อป้องกัน fallback ที่อาจดึง locked player มาจับกับคนที่ไม่ใช่คู่ล็อค
    // [แก้ไข Rule 1 — ปิดช่องทางที่ยัง bypass patch แล้วดึง validRawPool ทั้งก้อน]
    //   เดิมดึงคนไม่ล็อคจาก validRawPool "ทั้งหมด" (รวมคนเพิ่งลงทุกคน) → ยังเกิด Immediate Replay ได้
    //   ใหม่: ดึง "เท่าที่ขาดให้ครบ 2" เท่านั้น และเพราะ validRawPool เรียง lastBenchTime แล้ว
    //   คนที่ถูกดึงจึงเป็นคนพักนานสุดก่อนเสมอ (Availability คงเดิม: ครบ 2 ก็ต่อเมื่อของเดิมก็ครบ)
    if (nonLockedPool.length < 2) {
        let needMore = 2 - nonLockedPool.length;
        let extra = validRawPool
            .filter(p => !lockedPairs[p] && !nonLockedPool.includes(p))
            .slice(0, Math.max(0, needMore));
        nonLockedPool = [...nonLockedPool, ...extra];
    }

    if (nonLockedPool.length >= 2) {
        // [Non-linear Bench] ใช้ waitingRounds โดยตรง (แม่นยำกว่า lastBenchTime)
        // wait=0→0, wait=1→-2, wait=2→-6, wait=4→-20
        const nonLinearBench = (p) => {
            let wait = playerStats[p] ? (playerStats[p].waitingRounds || 0) : 0;
            return -Math.min(wait * (wait + 1), 30);
        };

        // ─── FAIRNESS GATE ──────────────────────────────────────────────────────
        // ใช้ waitingRounds จริง ไม่ต้องคำนวณจาก lastBenchTime อีกต่อไป
        // "คนที่ถูกข้ามมากที่สุดต้องได้สิทธิ์ก่อนเสมอ"
        //
        // หา maxWaiting = waitingRounds สูงสุดในกลุ่ม non-locked pool
        // mandatory = ทุกคนที่มี waitingRounds == maxWaiting
        //
        // ตัวอย่าง: เก้น(3) ฟ่า(3) นนท์นั่น(1) น้ำแข็ง(0)
        //   maxWaiting = 3 → mandatory = [เก้น, ฟ่า] → ต้องลงก่อน
        let maxWaiting = Math.max(0, ...nonLockedPool.map(p => playerStats[p]?.waitingRounds || 0));
        let mandatory = maxWaiting > 0
            ? nonLockedPool.filter(p => (playerStats[p]?.waitingRounds || 0) === maxWaiting)
            : [];

        if (mandatory.length >= 1) {
            // [แก้ไข Bug โครงสร้าง — พิสูจน์จาก debug log จริง]
            // เดิม: ถ้า mandatory.length>=2 (เช่น เก้น,พี่กาย tie กันที่ waitingRounds สูงสุด)
            //   จะสร้าง mPairs จาก "ภายในกลุ่ม mandatory เท่านั้น" → บังคับจับคู่กันเองเสมอ
            //   ปิดโอกาสคู่ใหม่ทั้งหมดในสนาม แม้จะมีคู่ใหม่ (hist=0) เหลืออีกหลายสิบคู่
            //   (เคสจริงที่เจอ: เก้น&พี่กาย ถูกบังคับจับคู่กัน ทั้งที่มีคู่ใหม่เหลือ 12 คู่)
            // ใหม่: สร้าง mPairs จาก "ทุกคู่ที่มีสมาชิกอย่างน้อย 1 คนเป็น mandatory"
            //   รับประกัน fairness (มี mandatory ได้ลงแน่นอน) แต่เปิดให้จับคู่กับคนสดใหม่ได้
            //   ถ้ามี mandatory คนที่ไม่ได้ลงรอบนี้ waitingRounds เขาจะกลายเป็น max เดี่ยวในรอบหน้า
            //   แล้วได้รับการจัดการแบบเดียวกันอีกครั้ง (ไม่มี edge case ตกหล่น)
            let mandatorySet = new Set(mandatory);
            let mPairs = [];
            for (let i = 0; i < nonLockedPool.length; i++) {
                for (let j = i + 1; j < nonLockedPool.length; j++) {
                    let pi = nonLockedPool[i], pj = nonLockedPool[j];
                    if (mandatorySet.has(pi) || mandatorySet.has(pj)) {
                        mPairs.push([pi, pj]);
                    }
                }
            }

            if (mPairs.length > 0) {
                let scored = mPairs.map(([pi, pj]) => {
                    let hist = (historyPairs[pi] && historyPairs[pi][pj]) || 0;
                    let bT = nonLinearBench(pi) + nonLinearBench(pj);
                    let oppS = 0, rOpp = 0;
                    vsTeam.forEach(o => {
                        oppS += (opponentHistory[pi] && opponentHistory[pi][o]) || 0;
                        oppS += (opponentHistory[pj] && opponentHistory[pj][o]) || 0;
                        if (isRecentOpponent(pi, o)) rOpp += RECENT_OPP_PENALTY;
                        if (isRecentOpponent(pj, o)) rOpp += RECENT_OPP_PENALTY;
                    });
                    let recentPen = isRecentPair(pi, pj) ? 100 : 0; // เบาลงสำหรับ mandatory
                    let sc = (hist === 0 ? 0 : hist * PARTNER_WEIGHT) + bT + oppS * OPP_WEIGHT + rOpp + recentPen;
                    return { pair: [pi, pj], score: sc, isFresh: hist === 0 };
                });

                let freshM = scored.filter(s => s.isFresh);
                let eligible = freshM.length > 0 ? freshM : scored;
                let minSc = Math.min(...eligible.map(s => s.score));
                let best = eligible.filter(s => s.score <= minSc + SCORE_TOLERANCE);
                let chosen = best[Math.floor(Math.random() * best.length)].pair;

                if (DEBUG_MATCHMAKING) {
                    matchmakingLog.push({
                        gmc: globalMatchCounter,
                        path: 'FAIRNESS_GATE (รวม mandatory + คู่สดใหม่ที่เหลือทั้งหมด)',
                        maxWaiting, mandatoryPlayers: mandatory,
                        candidates: nonLockedPool.map(p => ({
                            ชื่อ: p, waitingRounds: playerStats[p]?.waitingRounds || 0, mandatory: mandatory.includes(p),
                        })),
                        mPairsConsidered: scored,
                        freshOptionsAvailable: freshM.length,
                        selected: chosen,
                        เหตุผล: freshM.length > 0
                            ? `มี mandatory player (${mandatory.join(',')}) ต้องได้ลง → เลือกคู่สดใหม่ (hist=0) ที่ดีที่สุดจาก ${freshM.length} ตัวเลือกที่มี mandatory อยู่ด้วย`
                            : `มี mandatory player (${mandatory.join(',')}) ต้องได้ลง → ไม่มีคู่สดใหม่เหลือ เลือกคู่เก่าที่ penalty ต่ำสุด`
                    });
                }

                return chosen;
            }
        }
        // ─── END FAIRNESS GATE ──────────────────────────────────────────────────

        // [Dynamic Diversity] คนน้อย → weight สูง (ต้องช่วย), คนเยอะ → weight ต่ำ (diversity เกิดเอง)
        // 8 คน → ×2, 16 คน → ×1, 24 คน → ×0.67
        const dynamicDiversityWeight = DIVERSITY_WEIGHT * (16 / Math.max(8, players.length));

        let freshPairs = [];
        let allUsedPairs = [];

        // Diversity: precompute connectivity ก่อน loop (O(n²) ครั้งเดียว)
        const connectivity = {};
        nonLockedPool.forEach(p => {
            connectivity[p] = nonLockedPool.reduce(
                (s, q) => s + (q !== p ? ((historyPairs[p] && historyPairs[p][q]) || 0) : 0), 0
            );
        });

        for (let i = 0; i < nonLockedPool.length; i++) {
            for (let j = i + 1; j < nonLockedPool.length; j++) {
                let pi = nonLockedPool[i], pj = nonLockedPool[j];
                let hist = (historyPairs[pi] && historyPairs[pi][pj]) || 0;
                let bench_i = playerStats[pi] ? (playerStats[pi].lastBenchTime || 0) : 0;
                let bench_j = playerStats[pj] ? (playerStats[pj].lastBenchTime || 0) : 0;
                let recent = isRecentPair(pi, pj);
                let diversityBonus = (connectivity[pi] || 0) + (connectivity[pj] || 0);

                // [Champion Bias] penalty เพิ่มถ้า challenger เพิ่งเจอ champ ทีมนี้มา
                let oppScore = 0;
                let recentOppPenalty = 0;
                vsTeam.forEach(opp => {
                    oppScore += (opponentHistory[pi] && opponentHistory[pi][opp]) || 0;
                    oppScore += (opponentHistory[pj] && opponentHistory[pj][opp]) || 0;
                    if (isRecentOpponent(pi, opp)) recentOppPenalty += RECENT_OPP_PENALTY;
                    if (isRecentOpponent(pj, opp)) recentOppPenalty += RECENT_OPP_PENALTY;
                });

                // ใช้ nonLinearBench ด้วย waitingRounds (แม่นยำกว่า lastBenchTime)
                let benchTerm = nonLinearBench(pi) + nonLinearBench(pj);

                if (hist === 0) {
                    freshPairs.push({ pair: [pi, pj], oppScore, diversityBonus, recent, recentOppPenalty, benchTerm });
                } else {
                    let recentPenalty = recent ? 500 : 0;
                    let score = hist * PARTNER_WEIGHT
                              + benchTerm
                              + oppScore * OPP_WEIGHT
                              + recentOppPenalty
                              + diversityBonus * dynamicDiversityWeight
                              + recentPenalty;
                    allUsedPairs.push({ pair: [pi, pj], score });
                }
            }
        }

        // Tier 1: คู่ใหม่ก่อนเสมอ
        if (freshPairs.length > 0) {
            let nonRecentFresh = freshPairs.filter(f => !f.recent);
            let activeFresh = nonRecentFresh.length > 0 ? nonRecentFresh : freshPairs;

            // [แก้ไข Bug] รวม benchTerm เข้าไปในการเลือก fresh pair ด้วย
            // เดิม: ใช้แค่ oppScore + diversityBonus → คนที่ไม่เคยลง (bench ต่ำมาก) ยังถูกสุ่มทิ้ง
            // ใหม่: freshScore = oppScore + recentOppPenalty + benchTerm (ต่ำ = ดี)
            //   เก้น (รอ 3 รอบ) → benchTerm = -12, freshScore = -12
            //   ฟ่า  (รอ 3 รอบ) → benchTerm = -12, freshScore = -12
            //   เก้น+ฟ่า together → freshScore = -24 → ชนะชัดเจน ✅
            let minFreshScore = Math.min(...activeFresh.map(f => f.oppScore + f.recentOppPenalty + f.benchTerm));
            let scoreFiltered = activeFresh.filter(f => f.oppScore + f.recentOppPenalty + f.benchTerm <= minFreshScore + SCORE_TOLERANCE);
            // tiebreak ด้วย diversityBonus
            let minDiv = Math.min(...scoreFiltered.map(f => f.diversityBonus));
            let bestFresh = scoreFiltered.filter(f => f.diversityBonus <= minDiv + SCORE_TOLERANCE * 2);
            let chosenFresh = bestFresh[Math.floor(Math.random() * bestFresh.length)].pair;

            if (DEBUG_MATCHMAKING) {
                matchmakingLog.push({
                    gmc: globalMatchCounter,
                    path: 'FRESH_PAIR (Tier 1, ไม่ผ่าน Fairness Gate)',
                    candidates: freshPairs.map(f => ({
                        คู่: f.pair.join('+'), oppScore: f.oppScore, recentOppPenalty: f.recentOppPenalty,
                        benchTerm: f.benchTerm, diversityBonus: f.diversityBonus, recent: f.recent,
                        freshScore: f.oppScore + f.recentOppPenalty + f.benchTerm
                    })),
                    selected: chosenFresh,
                    เหตุผล: `เลือกจากคู่ใหม่ (hist=0) ที่มี oppScore+recentOppPenalty+benchTerm ต่ำสุด`
                });
            }

            return chosenFresh;
        }

        // Tier 2: ไม่มีคู่ใหม่แล้ว → เลือกคู่เก่าที่ score ต่ำสุด + SCORE_TOLERANCE
        if (allUsedPairs.length > 0) {
            let minScore = Math.min(...allUsedPairs.map(p => p.score));
            let eligible = allUsedPairs.filter(p => p.score <= minScore + SCORE_TOLERANCE);
            let chosenUsed = eligible[Math.floor(Math.random() * eligible.length)].pair;

            if (DEBUG_MATCHMAKING) {
                matchmakingLog.push({
                    gmc: globalMatchCounter,
                    path: 'USED_PAIR (Tier 2, ไม่มีคู่ใหม่เหลือใน pool นี้แล้ว)',
                    candidates: allUsedPairs.map(p => ({ คู่: p.pair.join('+'), score: p.score })),
                    selected: chosenUsed,
                    เหตุผล: `ไม่มีคู่ hist=0 เหลือใน nonLockedPool แล้ว → เลือกคู่เก่าที่ penalty ต่ำสุด`
                });
            }

            return chosenUsed;
        }
    }

    // fallback สุดท้าย: ใช้ validRawPool เพื่อความปลอดภัย ไม่ใช่ pool
    // ป้องกันการดึง locked player ไปจับกับคนที่ไม่ใช่คู่ล็อค
    let noLock = validRawPool.filter(p => !lockedPairs[p]);
    if (noLock.length >= 2) return noLock.slice(0, 2);
    let readyPairs = validRawPool.filter(p => lockedPairs[p] && validRawPool.includes(lockedPairs[p]));
    if (readyPairs.length >= 1) return [readyPairs[0], lockedPairs[readyPairs[0]]];
    return validRawPool.slice(0, 2);
}

// 🌟 2. อัปเกรดลอจิกเกลี่ยทีมย่อย ( optimizeFourPlayers ) ตัวการทำบิ๊กลูปแตก!
function optimizeFourPlayers(pArr) {
    if (!pArr || pArr.length !== 4) return { teamA: [pArr[0], pArr[1]], teamB: [pArr[2], pArr[3]] };
    
    const combinations = [
        { teamA: [pArr[0], pArr[1]], teamB: [pArr[2], pArr[3]] },
        { teamA: [pArr[0], pArr[2]], teamB: [pArr[1], pArr[3]] },
        { teamA: [pArr[0], pArr[3]], teamB: [pArr[1], pArr[2]] }
    ];
    
    let bestCombos = [];
    let minWeight = Infinity;
    
    combinations.forEach(combo => {
        let violatesLock = false;
        combo.teamA.forEach(p => {
            if (lockedPairs[p] && pArr.includes(lockedPairs[p]) && !combo.teamA.includes(lockedPairs[p])) violatesLock = true;
        });
        combo.teamB.forEach(p => {
            if (lockedPairs[p] && pArr.includes(lockedPairs[p]) && !combo.teamB.includes(lockedPairs[p])) violatesLock = true;
        });
        
        if (violatesLock) return;

        const wA = (historyPairs[combo.teamA[0]] && historyPairs[combo.teamA[0]][combo.teamA[1]]) || 0;
        const wB = (historyPairs[combo.teamB[0]] && historyPairs[combo.teamB[0]][combo.teamB[1]]) || 0;
        
        // penalty คู่ partner ซ้ำ
        let penalty = 0;
        if (wA > 0) penalty += OPP_FLAT + wA * OPP_SCALE;
        if (wB > 0) penalty += OPP_FLAT + wB * OPP_SCALE;

        // penalty คู่ต่อสู้ซ้ำ: ผลรวมของ opponentHistory ทุกคู่ข้ามทีม
        let oppScore = 0;
        combo.teamA.forEach(a => combo.teamB.forEach(b => {
            oppScore += (opponentHistory[a] && opponentHistory[a][b]) || 0;
        }));
        if (oppScore > 0) penalty += oppScore * OPP_WEIGHT;

        const totalWeight = wA + wB + penalty;
        
        if (totalWeight < minWeight) {
            minWeight = totalWeight;
            bestCombos = [combo];
        } else if (totalWeight === minWeight) {
            // [แก้ไข] เมื่อ weight เท่ากัน ให้เก็บไว้ทุก combination แล้วสุ่มเลือก
            // เดิมเลือก combination แรกเสมอ ทำให้คู่แข็งตัวไม่หมุน
            bestCombos.push(combo);
        }
    });
    
    if (bestCombos.length === 0) return combinations[0];
    // สุ่มเลือกจาก combination ที่ดีที่สุดเท่ากัน
    return bestCombos[Math.floor(Math.random() * bestCombos.length)];
}

// ════════════════════════════════════════════════════════════════════
// MATCHMAKING ENGINE V2 — Constraint-based Pipeline (Phase 1, ตาม Design Doc)
// ════════════════════════════════════════════════════════════════════
// สถานะ: ยังไม่ถูกเรียกใช้จริงจากที่ไหนเลย — selectTeam/optimizeFourPlayers/
// prepareNextMatch เดิมข้างบนทำงานตามปกติทุกประการ ไม่มีผลกระทบต่อ UI/behavior ใดๆ
// (ตามข้อกำหนด: ห้ามเปลี่ยนพฤติกรรม UI, ห้ามลบโค้ดเดิมจนกว่า Pipeline นี้จะผ่าน Validation)
//
// เปิด debug log: DEBUG_PIPELINE = true แล้วดู pipelineLog ใน console
// ════════════════════════════════════════════════════════════════════

let DEBUG_PIPELINE = false; // เปิด/ปิด debug log ของ pipeline ใหม่ (แยกจาก DEBUG_MATCHMAKING เดิมโดยเจตนา)
let pipelineLog = [];

// helper: unordered pair key — บังคับ A+B === B+A เป็น invariant ของโครงสร้างข้อมูล
function pairKey(a, b) {
    return [a, b].sort().join('|');
}

// Stage 0+1+2: Eligible Universe + Just-Played Exclusion + Locked Pair Integrity
// minRequired: จำนวนคนขั้นต่ำที่ต้องการจริง (2 สำหรับ challenger-selection, 4 สำหรับ fresh-selection)
// [แก้ไข] เดิม hardcode เป็น 4 เสมอ ทำให้ challenger-selection (ต้องการแค่ 2) ผ่อนกฎ just-played
// บ่อยเกินจำเป็นในกลุ่มเล็ก (ยืนยันจริง: 6 คน 1 ล็อคคู่ → just-played violations พุ่งสูงผิดปกติ)
