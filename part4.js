    function isRecentPair(pi, pj) {
        return recentPairs.some(rp =>
            (rp.p1 === pi && rp.p2 === pj) || (rp.p1 === pj && rp.p2 === pi)
        );
    }

    // helper: เช็คว่า pi เพิ่งเจอ opp เป็นคู่ต่อสู้ในเกมล่าสุดไหม (Champion Bias)
    function isRecentOpponent(pi, opp) {
        return recentOpponents.some(ro =>
            (ro.p1 === pi && ro.p2 === opp) || (ro.p1 === opp && ro.p2 === pi)
        );
    }

    function undoPartnerships(teamA, teamB) {
        if (teamA && teamA.p1 && teamA.p2) {
            if(historyPairs[teamA.p1] && historyPairs[teamA.p1][teamA.p2] > 0) historyPairs[teamA.p1][teamA.p2]--;
            if(historyPairs[teamA.p2] && historyPairs[teamA.p2][teamA.p1] > 0) historyPairs[teamA.p2][teamA.p1]--;
            // ลบออกจาก recentPairs ด้วย (undo 1 รายการ)
            const idx = recentPairs.findIndex(rp => (rp.p1 === teamA.p1 && rp.p2 === teamA.p2) || (rp.p1 === teamA.p2 && rp.p2 === teamA.p1));
            if (idx !== -1) recentPairs.splice(idx, 1);
        }
        if (teamB && teamB.p1 && teamB.p2) {
            if(historyPairs[teamB.p1] && historyPairs[teamB.p1][teamB.p2] > 0) historyPairs[teamB.p1][teamB.p2]--;
            if(historyPairs[teamB.p2] && historyPairs[teamB.p2][teamB.p1] > 0) historyPairs[teamB.p2][teamB.p1]--;
            const idx = recentPairs.findIndex(rp => (rp.p1 === teamB.p1 && rp.p2 === teamB.p2) || (rp.p1 === teamB.p2 && rp.p2 === teamB.p1));
            if (idx !== -1) recentPairs.splice(idx, 1);
        }
        // undo opponentHistory ด้วย
        if (teamA && teamB) {
            const aPlayers = [teamA.p1, teamA.p2].filter(Boolean);
            const bPlayers = [teamB.p1, teamB.p2].filter(Boolean);
            aPlayers.forEach(a => bPlayers.forEach(b => {
                if (opponentHistory[a] && opponentHistory[a][b] > 0) opponentHistory[a][b]--;
                if (opponentHistory[b] && opponentHistory[b][a] > 0) opponentHistory[b][a]--;
                const idx = recentOpponents.findIndex(ro => (ro.p1===a&&ro.p2===b)||(ro.p1===b&&ro.p2===a));
                if (idx !== -1) recentOpponents.splice(idx, 1);
            }));
        }
    }

    function setupAllCourts() {
        courts.forEach((court) => {
            let req = (court.matchType === 'singles') ? 1 : 2;
            let teamA = selectTeam([], req);
            // [แก้ไข] ถ้าไม่มีผู้เล่นพอสำหรับทีม A ให้ข้ามคอร์ทนี้ไป (กรณีคนคี่/คนน้อย)
            if (!teamA || teamA.length < req || !teamA[0]) return;

            let teamB = selectTeam([...teamA], req);
            // [แก้ไข] ถ้าไม่มีผู้เล่นพอสำหรับทีม B ให้คืนคน teamA กลับคิวแล้วข้าม
            if (!teamB || teamB.length < req || !teamB[0]) {
                teamA.forEach(p => { if(!mainQueue.includes(p) && !eliminatedOrder.includes(p)) eliminatedOrder.unshift(p); });
                return;
            }

            teamA.forEach(p => pullPlayer(p));
            teamB.forEach(p => pullPlayer(p));
            
            if (req === 1) {
                court.teamA = { p1: teamA[0] };
                court.teamB = { p1: teamB[0] };
            } else {
                let optimized = optimizeFourPlayers([...teamA, ...teamB]);
                court.teamA = { p1: optimized.teamA[0], p2: optimized.teamA[1] };
                court.teamB = { p1: optimized.teamB[0], p2: optimized.teamB[1] };
            }
            recordPartnerships(court.teamA, court.teamB);
        });
        renderAll();
    }

    window.changeCourtMode = function(courtIndex, mode) {
        let court = courts[courtIndex];
        if ((court.matchType || 'doubles') === mode) return;

        if (court.scoreA > 0 || court.scoreB > 0 || court.isGameOver) {
            if(!confirm(`คอร์ท ${court.name} มีการแข่งขันค้างอยู่ ยืนยันเปลี่ยนประเภทการเล่นหรือไม่? (ระบบจะล้างคะแนนและดึงคนจัดใหม่ทั้งหมด)`)) {
                renderAll(); return;
            }
        }

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

        court.matchType = mode;
        court.currentChamp = null; 
        court.isGameOver = false;
        court.teamA = null;
        court.teamB = null;
        court.scoreA = 0;
        court.scoreB = 0;

        rePairCourtMatch(courtIndex, true);
    }

    // --- ระบบหยุดพักคอร์ท (Pause Court) ---
    window.togglePauseCourt = function(courtIndex) {
        clearPreviewCache();
        let court = courts[courtIndex];

        if (court.isPaused) {
            // โหมดกลับมาเปิดใช้งานคอร์ทอีกครั้ง
            court.isPaused = false;
            rePairCourtMatch(courtIndex, true); // สั่งสุ่มผู้เล่นลงสนามทันที
        } else {
            // โหมดสั่งพักคอร์ท
            let hasPlayers = court.teamA || court.teamB;
            let toFront = false;

            if (hasPlayers && (!court.isGameOver)) {
                let choice = confirm("มีผู้เล่นอยู่ในสนาม!\n\nต้องการให้ผู้เล่นกลุ่มนี้กลับไป 'หัวแถว' (ลัดคิวให้ได้เล่นคอร์ทอื่นก่อน) ใช่หรือไม่?\n\n- กด [OK/ตกลง] = ไปหัวแถว\n- กด [Cancel/ยกเลิก] = ไปท้ายแถวตามปกติ");
                toFront = choice;
            }

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
                eliminatedOrder = eliminatedOrder.filter(x => x !== p);
                mainQueue = mainQueue.filter(x => x !== p);
                if (toFront) {
                    mainQueue.unshift(p); // ไปอยู่ลำดับแรกสุดใน mainQueue รับรองว่าโดนดึงแน่นอน
                } else {
                    eliminatedOrder.push(p); // ต่อท้ายตามปกติ
                }
            });

            court.isPaused = true;
            court.teamA = null;
            court.teamB = null;
            court.scoreA = 0;
            court.scoreB = 0;
            court.isGameOver = false;
            court.currentChamp = null;
        }

        renderAll();
        saveData();
    }

    function addScore(courtIndex, team) {
            let court = courts[courtIndex];
            if (court.isGameOver || court.isPaused) return;
            
            // เช็กว่าแต้มที่กำลังจะบวกนี้ ทำให้จบเกมหรือไม่
            let nextA = court.scoreA + (team === 'A' ? 1 : 0);
            let nextB = court.scoreB + (team === 'B' ? 1 : 0);
            let maxScore = Math.max(nextA, nextB);
            let minScore = Math.min(nextA, nextB);
            let targetWin = court.winScore || winScore;
            
            // เซฟข้อมูลเฉพาะตอนที่แต้มถึงจุดที่ "จบเกม" เท่านั้น ไม่ต้องเซฟทุกแต้มเพื่อประหยัด RAM
            if (maxScore >= targetWin && (maxScore - minScore >= 2 || maxScore === 30)) {
                court.stateBeforeFinishStr = createDeepSnapshot(); 
            }

            if (team === 'A') court.scoreA++; else court.scoreB++;
            
            if (maxScore >= targetWin && (maxScore - minScore >= 2 || maxScore === 30)) {
                finishMatch(courtIndex, court.scoreA > court.scoreB ? 'A' : 'B');
                return;
            }
            
            renderAll();
            saveData();
        }

    function decreaseScore(courtIndex, team, event) {
        if(event) event.stopPropagation();
        let court = courts[courtIndex];
        if(court.isGameOver || court.isPaused) return;
        if(team === 'A' && court.scoreA > 0) court.scoreA--;
        if(team === 'B' && court.scoreB > 0) court.scoreB--;
        renderAll();
        saveData();
    }

    function finishMatch(courtIndex, winnerTeam) {
        let court = courts[courtIndex];
        court.isGameOver = true;
        let req = (court.matchType === 'singles') ? 1 : 2;
        let targetChamp = court.maxChamps || maxChamps;
        
        let winner = winnerTeam === 'A' ? court.teamA : court.teamB;
        let loser = winnerTeam === 'A' ? court.teamB : court.teamA;

        let loserArr = req === 1 ? [loser.p1] : [loser.p1, loser.p2];
        let winnerArr = req === 1 ? [winner.p1] : [winner.p1, winner.p2];

        globalMatchCounter++;

        // อัปเดต waitingRounds: ติดตาม "รอบที่ถูกข้ามติดต่อกัน" โดยตรง ไม่ต้องคำนวณจาก lastBenchTime
        // คนที่เพิ่งลง → reset = 0
        // คนที่ยังรออยู่ใน queue (ไม่ได้ลงรอบนี้) → +1
        // คนที่กำลังเล่นในสนามอื่น (ถูก pullPlayer ไปแล้ว) → ไม่นับ (ยังไม่ถูกข้าม)
        let justPlayedSet = new Set([...loserArr, ...winnerArr]);
        players.forEach(p => {
            if (!playerStats[p] || playerStats[p].onBreak) return;
            if (justPlayedSet.has(p)) {
                playerStats[p].waitingRounds = 0; // เพิ่งลง → รีเซ็ต
            } else if (mainQueue.includes(p) || eliminatedOrder.includes(p)) {
                // อยู่ใน queue = รอจริงๆ ไม่ใช่กำลังเล่นในสนามอื่น
                playerStats[p].waitingRounds = (playerStats[p].waitingRounds || 0) + 1;
            }
        });

        // Decay ค่า historyPairs ทุก DECAY_INTERVAL รอบ
        // ข้อมูลเก่าจะค่อยๆ จางลง ไม่ใช่ตันอยู่ที่เลขเดิมตลอด
        // ทำให้เมื่อเล่นยาวหลาย 10 รอบ คู่ที่เคยเล่นนานแล้วยังมีโอกาสได้เลือกอีกครั้ง
        if (globalMatchCounter > 0 && globalMatchCounter % DECAY_INTERVAL === 0) {
            players.forEach(p => {
                players.forEach(q => {
                    if (p !== q) {
                        if (historyPairs[p] && historyPairs[p][q]) {
                            historyPairs[p][q] = Math.round(historyPairs[p][q] * DECAY_FACTOR);
                        }
                        // Decay opponentHistory พร้อมกัน เพื่อสมดุลกัน
                        if (opponentHistory[p] && opponentHistory[p][q]) {
                            opponentHistory[p][q] = Math.round(opponentHistory[p][q] * DECAY_FACTOR);
                        }
                    }
                });
            });
        }

        // [แก้ไข Bug] ใช้ globalMatchCounter + 1 เพื่อให้ selectTeam กรองคนแพ้ออกได้ถูกต้อง
        // เหตุผล: selectTeam เช็ค lastBenchTime !== globalMatchCounter ณ เวลาที่เรียก
        // แต่ตอนนั้น globalMatchCounter ยังเป็นค่าปัจจุบัน (ไม่ได้บวกเพิ่ม)
        // หากบันทึก lastBenchTime = globalMatchCounter คนแพ้จะถูกมองว่า "พักแล้ว" แต่เช็คค่าไม่ตรง
        // จึงต้องบันทึกล่วงหน้าเป็น globalMatchCounter + 1 ให้ตรงกับแมตช์ถัดไป
        loserArr.forEach(p => { if (playerStats[p]) playerStats[p].lastBenchTime = globalMatchCounter + 1; pushToEliminated(p); });

        [...winnerArr, ...loserArr].forEach(p => playerStats[p].played++);
        winnerArr.forEach(p => playerStats[p].wins++);
        loserArr.forEach(p => playerStats[p].losses++);

        let champStatus = "";
        let isSameChamp = false;
        
        if (court.currentChamp) {
            if (req === 1 && court.currentChamp.p1 === winner.p1) isSameChamp = true;
            if (req === 2 && (court.currentChamp.p1 === winner.p1 || (court.teamA.p2 && court.currentChamp.p1 === winner.p2))) isSameChamp = true;
        }

        if(isSameChamp) { 
            court.currentChamp.count++; 
        } else { 
            court.currentChamp = req === 1 ? { p1: winner.p1, count: 1 } : { p1: winner.p1, p2: winner.p2, count: 1 }; 
        }

        let isChampOut = false;
        if(court.currentChamp.count >= targetChamp) {
            isChampOut = true; champStatus = `(แชมป์ครบ ${targetChamp} สมัย)`;
            winnerArr.forEach(p => { if (playerStats[p]) playerStats[p].lastBenchTime = globalMatchCounter + 1; pushToEliminated(p); });
        } else { champStatus = `(แชมป์ ${court.currentChamp.count} สมัย)`; }

        let winText = req === 1 ? winner.p1 : (winner.p2 ? `${winner.p1}&${winner.p2}` : winner.p1);
        let loseText = req === 1 ? loser.p1 : (loser.p2 ? `${loser.p1}&${loser.p2}` : loser.p1);

        matchHistory.push({ 
            courtName: court.name, round: court.matchRound, 
            result: `${winText} ชนะ ${loseText} [${court.scoreA}-${court.scoreB}] ${champStatus}` 
        });
        
        court.nextMatchData = { winner, loser, isChampOut, winnerSide: winnerTeam };
        
        renderAll();
        saveData();
    }

    function prepareNextMatch(courtIndex) {
            let court = courts[courtIndex];
            if (court.isPaused) return;

            let data = court.nextMatchData;
            let req = (court.matchType === 'singles') ? 1 : 2;
            
            court.isGameOver = false; court.scoreA = 0; court.scoreB = 0; court.matchRound++;
            //court.stateBeforeFinishStr = null; // ปิดไว้เพื่อให้ย้อนผลได้

            if (data.isChampOut) {
                court.currentChamp = null;

                // 🔧 [SILO BREAKER] ทำงานกับทุกจำนวนคน ไม่ใช่แค่ 8 คน
                if (numCourts === 1 && court.matchType !== 'singles') {
                    if (globalMatchCounter % 3 === 0) {
                        let waitP = eliminatedOrder.find(p => playerStats[p].lastBenchTime <= globalMatchCounter && !lockedPairs[p]);
                        let justP = eliminatedOrder.find(p => playerStats[p].lastBenchTime > globalMatchCounter && !lockedPairs[p]);
                        if (waitP && justP) {
                            playerStats[justP].lastBenchTime = 0; 
                            playerStats[waitP].lastBenchTime = globalMatchCounter + 1; 
                            showNotification(`🔀 <b>ระบบทลายกลุ่มปิด (Silo) ทำงาน!</b><br>ดึง <b>${justP}</b> (ตีต่อ) สลับกับ <b>${waitP}</b> (ได้พักต่อ)`);
                            clearPreviewCache();
                        }
                    }
                }

                let teamA, teamB;
                // [แก้ไข Bug] ล้าง cache เสมอก่อนเลือกผู้เล่น
                // เพราะ cache ถูกสร้างตอนแมตช์ยังไม่จบ ณ เวลานั้น lastBenchTime ของคนแพ้ยังไม่ถูก set
                // หากใช้ cache ตรงๆ จะข้ามการกรอง restedPool ทำให้คนแพ้รอบล่าสุดถูกดึงลงสนามซ้ำได้
                clearPreviewCache();
                teamA = selectTeam([], req);
                teamB = selectTeam([...teamA], req);

                // [แก้ไข] ป้องกันกรณีคนคี่/คนไม่พอ
                if (!teamA || !teamA[0] || !teamB || !teamB[0]) {
                    court.isGameOver = false; court.scoreA = 0; court.scoreB = 0;
                    court.teamA = null; court.teamB = null; court.isPaused = true;
                    renderAll(); saveData(); return;
                }

                teamA.forEach(p => pullPlayer(p));
                teamB.forEach(p => pullPlayer(p));
                
                if (req === 1) {
                    court.teamA = { p1: teamA[0] };
                    court.teamB = { p1: teamB[0] };
                } else {
                    let optimized = optimizeFourPlayers([...teamA, ...teamB]);
                    court.teamA = { p1: optimized.teamA[0], p2: optimized.teamA[1] };
                    court.teamB = { p1: optimized.teamB[0], p2: optimized.teamB[1] };
                }
            } else {
                let champTeam = req === 1 ? { p1: data.winner.p1 } : { p1: data.winner.p1, p2: data.winner.p2 };
                let excludeList = req === 1 ? [champTeam.p1] : [champTeam.p1, champTeam.p2];
                
                let challengers;
                // [แก้ไข Bug] ล้าง cache เสมอ เพราะ cache ถูกสร้างก่อน finishMatch set lastBenchTime
                // ทำให้คนแพ้รอบล่าสุดอาจถูกดึงมาเป็นผู้ท้าชิงได้ทันที
                clearPreviewCache();
                challengers = selectTeam(excludeList, req, [champTeam.p1, champTeam.p2].filter(Boolean));

                // [แก้ไข] ป้องกันกรณีคนคี่/คนไม่พอสำหรับผู้ท้าชิง
                if (!challengers || challengers.length < req || !challengers[0]) {
                    court.isGameOver = false; court.scoreA = 0; court.scoreB = 0;
                    court.isPaused = true;
                    renderAll(); saveData(); return;
                }

                challengers.forEach(p => pullPlayer(p));
                
                let challengerTeam = req === 1 ? { p1: challengers[0] } : { p1: challengers[0], p2: challengers[1] };
                
                if (data.winnerSide === 'A') {
                    court.teamA = champTeam; court.teamB = challengerTeam;
                } else {
                    court.teamB = champTeam; court.teamA = challengerTeam;
                }
                // [แก้ไข Bug] เดิมส่ง null เป็น teamA → opponentHistory ไม่ถูกบันทึกเลย
                // เพราะฟังก์ชันเช็ค if(teamA && teamB) ซึ่งเป็น false ตลอดเมื่อ teamA=null
                // ผลคือ Champion Bias "บอด" ทุกครั้งที่แชมป์อยู่ต่อ (เคสส่วนใหญ่ของระบบ king-of-hill)
                // แก้: ส่ง champTeam จริงเข้าไป (ให้ opponentHistory ทำงาน) แต่ skip historyPairs
                // ของ champTeam ไม่ให้นับซ้ำ (เพราะนับไปแล้วตอนถูกเลือกเป็นแชมป์ครั้งแรก)
                recordPartnerships(champTeam, challengerTeam, true);
            }
            
            // isChampOut: บันทึกทั้งสองทีม (ทั้งคู่ถูกเลือกมาใหม่ในรอบนี้)
            // !isChampOut: บันทึกแค่ผู้ท้าชิง (บันทึกไปแล้วข้างบน) ไม่บันทึกทีมแชมป์อีก
            if (data.isChampOut) {
                recordPartnerships(court.teamA, court.teamB);
            }
            
            // ล้างความจำหลังใช้งานเสร็จทันที
            clearPreviewCache(); 
            
            renderAll();
            saveData();
        }

    function undoFinishMatch(courtIndex) {
            let court = courts[courtIndex];
            if(!court.stateBeforeFinishStr) return;
            
            if(!confirm('คุณต้องการย้อนกลับไปแก้ไขผลแมตช์ก่อนหน้านี้ใช่หรือไม่?\n(ระบบจะดึงรายชื่อและคะแนนทั้งหมดกลับมาเหมือนตอนก่อนจบเกม)')) return;

            restoreSnapshot(JSON.parse(court.stateBeforeFinishStr));
            renderAll();
            saveData();
        }

    function rePairCourtMatch(courtIndex, auto = false) {
        clearPreviewCache();
        let court = courts[courtIndex];
        if (court.isGameOver || court.isPaused) return;
        if (!auto && (court.scoreA > 0 || court.scoreB > 0)) {
            if (!confirm(`มีคะแนนสะสมอยู่ใน ${court.name} การจัดคู่ใหม่จะรีเซ็ตคะแนนรอบนี้ ต้องการดำเนินการต่อหรือไม่?`)) return;
        }

        undoPartnerships(court.teamA, court.teamB);
        let req = (court.matchType === 'singles') ? 1 : 2;
        let onCourt = [];
        if (court.teamA) {
            if (court.teamA.p1) onCourt.push(court.teamA.p1);
            if (court.teamA.p2) onCourt.push(court.teamA.p2);
        }
        if (court.teamB) {
            if (court.teamB.p1) onCourt.push(court.teamB.p1);
            if (court.teamB.p2) onCourt.push(court.teamB.p2);
        }

        court.scoreA = 0; court.scoreB = 0;
        let expectedPlayers = req === 1 ? 2 : 4;

        if (onCourt.length === expectedPlayers) {
            mainQueue = mainQueue.filter(p => !onCourt.includes(p));
            eliminatedOrder = eliminatedOrder.filter(p => !onCourt.includes(p));
            if (req === 1) {
                court.teamA = { p1: onCourt[0] };
                court.teamB = { p1: onCourt[1] };
            } else {
                let optimized = optimizeFourPlayers(onCourt);
                court.teamA = { p1: optimized.teamA[0], p2: optimized.teamA[1] };
                court.teamB = { p1: optimized.teamB[0], p2: optimized.teamB[1] };
            }
        } else {
            let tA = selectTeam([], req);
            let tB = selectTeam([...tA], req);
            tA.forEach(p => pullPlayer(p));
            tB.forEach(p => pullPlayer(p));

            if (req === 1) {
                court.teamA = { p1: tA[0] };
                court.teamB = { p1: tB[0] };
            } else {
                // [แก้ไข] ผ่าน optimizeFourPlayers เหมือนกับ prepareNextMatch
                // เดิมไม่ผ่าน ทำให้คู่ไม่ถูก optimize และไม่เช็ค lockedPairs
                let optimized = optimizeFourPlayers([...tA, ...tB]);
                court.teamA = { p1: optimized.teamA[0], p2: optimized.teamA[1] };
                court.teamB = { p1: optimized.teamB[0], p2: optimized.teamB[1] };
            }
        }

        recordPartnerships(court.teamA, court.teamB);
        renderAll();
        saveData();
    }

    function pushToEliminated(player) {
        eliminatedOrder = eliminatedOrder.filter(p => p !== player);
        eliminatedOrder.push(player); 
    }

    window.toggleBreakFromSelect = function() {
        let name = document.getElementById('manualBreakSelect').value;
        if(!name) return alert('กรุณาเลือกผู้เล่นจากเมนูก่อนครับ');
        togglePlayerBreak(name);
    }

