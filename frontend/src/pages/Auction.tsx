import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Gavel, User, ChevronRight, Pause, Play, Square, Plane } from 'lucide-react';
import playersData from '../data/players.json';

const TIMER_DURATION = 15;
const BID_BONUS = 3;
const INCREMENT_LAKH = 10;

const toRupees = (lakhs: number) => lakhs * 100_000;
const toCr = (rupees: number) => (rupees / 10_000_000).toFixed(2);

const Auction = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const isAdmin = localStorage.getItem('auction_is_admin') === 'true';
  const myUserId = localStorage.getItem('auction_user_id') || '';

  const [room, setRoom] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [squads, setSquads] = useState<any[]>([]);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_DURATION);
  const [isSold, setIsSold] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [bidMsg, setBidMsg] = useState('');

  // Refs — ensure async callbacks always read fresh values
  const roomRef = useRef<any>(null);
  const teamsRef = useRef<any[]>([]);
  const timerRef = useRef<any>(null);
  const timeRef = useRef(TIMER_DURATION);
  const isSoldRef = useRef(false);
  const isPausedRef = useRef(false);
  const prevBidCount = useRef(0);
  const channelRef = useRef<any>(null);  // ← single channel ref for send+receive

  // Sync state + refs together
  const setRoom2 = (r: any) => { roomRef.current = r; setRoom(r); };
  const setTeams2 = (t: any[]) => { teamsRef.current = t; setTeams(t); };
  const setSold = (v: boolean) => { isSoldRef.current = v; setIsSold(v); };
  const setPaused = (v: boolean) => { isPausedRef.current = v; setIsPaused(v); };

  // ─── Data fetchers ───────────────────────────────────────────────────────

  const fetchAll = async (rmId: string) => {
    const [bRes, tRes, sRes] = await Promise.all([
      supabase.from('bids').select('*').eq('room_id', rmId).order('amount', { ascending: false }),
      supabase.from('teams').select('*').eq('room_id', rmId),
      supabase.from('squads').select('*').eq('room_id', rmId),
    ]);
    setBids(bRes.data || []);
    const tms = tRes.data || [];
    setTeams2(tms);
    const me = tms.find((t: any) => t.user_id === myUserId);
    if (me) setMyTeam(me);
    setSquads(sRes.data || []);
    return { bids: bRes.data || [], teams: tms, squads: sRes.data || [] };
  };

  const fetchRoom = async () => {
    const { data: rm } = await supabase.from('rooms').select('*').eq('room_code', roomId).single();
    if (!rm) return null;
    const prev = roomRef.current;
    setRoom2(rm);
    if (rm.status === 'RESULTS') { navigate(`/room/${roomId}/results`); return rm; }
    // Player changed → reset sold state
    if (prev && rm.current_player_index !== prev.current_player_index) {
      setSold(false);
      setBidMsg('');
      prevBidCount.current = 0;
    }
    return rm;
  };

  // ─── Timer (admin only) ──────────────────────────────────────────────────

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const sendTick = (time: number) => {
    channelRef.current?.send({ type: 'broadcast', event: 'timer_tick', payload: { time } });
  };

  const handleTimerEnd = async () => {
    const rmId = roomRef.current?.id;
    const playerIdx = roomRef.current?.current_player_index ?? 0;
    if (!rmId) return;

    const { data: topBids } = await supabase
      .from('bids').select('*')
      .eq('room_id', rmId)
      .eq('player_id', playerIdx)
      .order('amount', { ascending: false })
      .limit(1);

    if (topBids && topBids.length > 0) {
      const top = topBids[0];
      await supabase.from('squads').insert([{
        room_id: rmId, team_id: top.team_id,
        player_id: playerIdx, bought_for: top.amount,
      }]);
      const { data: freshTeam } = await supabase.from('teams').select('*').eq('id', top.team_id).single();
      if (freshTeam) {
        await supabase.from('teams').update({ purse: freshTeam.purse - top.amount }).eq('id', top.team_id);
      }
      setSold(true);
      channelRef.current?.send({ type: 'broadcast', event: 'sold', payload: { sold: true } });
    } else {
      // Unsold — broadcast so all clients know
      setSold(true);
      channelRef.current?.send({ type: 'broadcast', event: 'sold', payload: { sold: false } });
    }
  };

  const startTimer = (initialTime = TIMER_DURATION) => {
    stopTimer();
    let t = initialTime;
    setTimeLeft(t); timeRef.current = t;
    sendTick(t);

    timerRef.current = setInterval(async () => {
      if (isPausedRef.current) return;
      t -= 1;
      setTimeLeft(t); timeRef.current = t;
      sendTick(t);
      if (t <= 0) {
        stopTimer();
        await handleTimerEnd();
      }
    }, 1000);
  };

  // ─── Initialise ──────────────────────────────────────────────────────────

  useEffect(() => {
    let pollInterval: any;

    const init = async () => {
      // 1. Load room first
      const rm = await fetchRoom();
      if (!rm) return;

      // 2. Load all data
      const { bids: initialBids, squads: initialSquads } = await fetchAll(rm.id);
      prevBidCount.current = initialBids.filter((b: any) => b.player_id === rm.current_player_index).length;

      // Check if already sold (for page refreshes)
      if (initialSquads.some((s: any) => s.player_id === rm.current_player_index)) {
        setSold(true);
        setTimeLeft(0);
      }

      // 3. Single channel for BOTH send and receive
      channelRef.current = supabase.channel(`room_${roomId}_v2`, {
        config: { broadcast: { ack: true } },
      });

      channelRef.current
        .on('broadcast', { event: 'timer_tick' }, (p: any) => {
          setTimeLeft(p.payload.time);
          timeRef.current = p.payload.time;
        })
        .on('broadcast', { event: 'pause_toggle' }, (p: any) => setPaused(p.payload.isPaused))
        .on('broadcast', { event: 'sold' }, () => setSold(true))
        .subscribe(() => {
          // Admin starts timer once subscribed
          if (isAdmin) startTimer();
        });

      // 4. Poll every 2 s for data (reliable cross-tab sync)
      pollInterval = setInterval(async () => {
        await fetchRoom();
        if (!roomRef.current?.id) return;
        const { bids: freshBids } = await fetchAll(roomRef.current.id);

        // Admin: if new bid came in → add bonus time
        if (isAdmin && !isSoldRef.current && !isPausedRef.current) {
          const playerBids = freshBids.filter(
            (b: any) => b.player_id === (roomRef.current?.current_player_index ?? 0)
          );
          if (playerBids.length > prevBidCount.current) {
            prevBidCount.current = playerBids.length;
            const newTime = Math.min(timeRef.current + BID_BONUS, TIMER_DURATION);
            startTimer(newTime);
          }
        }
      }, 2000);
    };

    init();

    return () => {
      stopTimer();
      clearInterval(pollInterval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [roomId]);

  // ─── Derived values ──────────────────────────────────────────────────────

  const currentIdx = room?.current_player_index ?? 0;
  const currentPlayer = (playersData as any[])[currentIdx];
  const playerBids = bids.filter(b => b.player_id === currentIdx);
  const topBid = playerBids[0] ?? null;
  const basePriceRs = toRupees(currentPlayer?.base_price ?? 0);
  const currentBidRs = topBid ? topBid.amount : basePriceRs;
  const nextBidRs = topBid ? currentBidRs + toRupees(INCREMENT_LAKH) : basePriceRs;

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleBid = async () => {
    setBidMsg('');
    if (!myTeam) { setBidMsg('You have no team assigned!'); return; }
    if (isSold) { setBidMsg('Round is over.'); return; }
    if (isPaused) { setBidMsg('Auction is paused.'); return; }
    if (timeLeft <= 0) { setBidMsg('Time is up!'); return; }
    if (topBid && topBid.team_id === myTeam.id) { setBidMsg("You're already the highest bidder!"); return; }

    const mySquad = squads.filter(s => s.team_id === myTeam.id);
    if (mySquad.length >= 25) { setBidMsg('Squad full! (Max 25 players)'); return; }
    if (currentPlayer?.is_overseas) {
      const overseas = mySquad.filter(s => (playersData as any[])[s.player_id]?.is_overseas).length;
      if (overseas >= 8) { setBidMsg('Overseas limit reached! (Max 8)'); return; }
    }
    if (myTeam.purse < nextBidRs) { setBidMsg('Not enough purse!'); return; }

    const { error } = await supabase.from('bids').insert([{
      room_id: room.id,
      player_id: currentIdx,
      team_id: myTeam.id,
      amount: nextBidRs,
    }]);

    if (error) {
      console.error('Bid error:', error);
      setBidMsg('Bid failed: ' + error.message);
    }
  };

  const togglePause = () => {
    if (!isAdmin) return;
    const next = !isPausedRef.current;
    setPaused(next);
    if (!next) startTimer(timeRef.current);
    else stopTimer();
    channelRef.current?.send({ type: 'broadcast', event: 'pause_toggle', payload: { isPaused: next } });
  };

  const handleEndAuction = async () => {
    if (!isAdmin) return;
    stopTimer();
    await supabase.from('rooms').update({ status: 'RESULTS' }).eq('room_code', roomId);
    navigate(`/room/${roomId}/results`);
  };

  const handleNextPlayer = async () => {
    if (!isAdmin || !room) return;
    const nextIdx = currentIdx + 1;
    if (nextIdx >= (playersData as any[]).length) {
      await supabase.from('rooms').update({ status: 'RESULTS' }).eq('id', room.id);
      return;
    }
    setBids([]); prevBidCount.current = 0;
    await supabase.from('bids').delete().eq('room_id', room.id);
    await supabase.from('rooms').update({ current_player_index: nextIdx }).eq('id', room.id);
    setSold(false);
    startTimer();
  };

  // ─── Loading state ───────────────────────────────────────────────────────

  if (!room || !currentPlayer) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#fff', fontSize: '1.4rem' }}>
        Loading auction...
      </div>
    );
  }

  const bidDisabled = isSold || isPaused || timeLeft <= 0 || !myTeam ||
    !!(topBid && topBid.team_id === myTeam?.id);

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="container flex-col" style={{ minHeight: '100vh' }}>
      {/* Top Bar */}
      <div className="glass-panel" style={{ padding: '15px 30px', display: 'flex', justifyContent: 'space-between', marginBottom: '30px', flexWrap: 'wrap', gap: '20px' }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div className="flex-col"><span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Room</span><strong>{roomId}</strong></div>
          <div className="flex-col"><span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Player</span><strong>{currentIdx + 1} / {(playersData as any[]).length}</strong></div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={togglePause} style={{ padding: '8px 15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
              {isPaused ? <Play size={16} /> : <Pause size={16} />} {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={handleEndAuction} style={{ padding: '8px 15px', background: '#ff4d4d', color: '#fff', border: '1px solid #cc0000', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              <Square size={16} /> End Auction
            </button>
          </div>
        )}

        {myTeam && (
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 20px', borderRadius: '12px' }}>
            <div className="flex-col"><span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Your Team</span><strong style={{ color: 'var(--accent-gold)' }}>{myTeam.team_name}</strong></div>
            <div className="flex-col" style={{ borderLeft: '1px solid var(--glass-border)', paddingLeft: '20px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Purse Left</span>
              <strong>₹ {toCr(myTeam.purse)} Cr</strong>
            </div>
            <div className="flex-col" style={{ borderLeft: '1px solid var(--glass-border)', paddingLeft: '20px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Squad</span>
              <strong>{squads.filter(s => s.team_id === myTeam.id).length} / 25</strong>
            </div>
          </div>
        )}
        {!myTeam && <div style={{ color: '#ff4d4d', fontSize: '0.9rem' }}>⚠️ No team assigned — go back to lobby</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 2fr) 1fr', gap: '30px', flex: 1 }}>
        {/* Main Area */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 30, right: 30, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '2rem', fontWeight: 'bold', color: timeLeft <= 5 ? '#ff007f' : '#fff' }} className={timeLeft <= 5 ? 'timer-pulse' : ''}>
            <Timer size={32} /> {timeLeft}s
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={currentIdx} initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -50 }} transition={{ duration: 0.4 }} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--bg-secondary), var(--glass-bg))', border: '2px solid var(--glass-border)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px' }}>
                <User size={64} color="var(--text-muted)" />
              </div>
              <h1>{currentPlayer.name}</h1>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <span className="player-tag">{currentPlayer.role}</span>
                <span className="player-tag" style={{ background: 'rgba(0,229,255,0.1)', color: 'var(--accent-blue)' }}>
                  Base: ₹ {currentPlayer.base_price > 99 ? (currentPlayer.base_price / 100).toFixed(2) + ' Cr' : currentPlayer.base_price + ' L'}
                </span>
                {currentPlayer.is_overseas && <span className="player-tag" style={{ background: 'rgba(255,190,11,0.1)', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '6px' }}><Plane size={16} /> Overseas</span>}
              </div>

              {isSold ? (
                <div style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid #00ff7f', padding: '20px 40px', borderRadius: '16px' }}>
                  {topBid
                    ? <><h2 style={{ color: '#00ff7f', margin: 0 }}>SOLD!</h2><p style={{ color: '#fff' }}>to {teams.find(t => t.id === topBid.team_id)?.team_name} for ₹ {toCr(topBid.amount)} Cr</p></>
                    : <h2 style={{ color: '#ff4d4d', margin: 0 }}>UNSOLD</h2>}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Current Bid</div>
                  <div style={{ fontSize: '4rem', fontWeight: 800, lineHeight: 1, color: topBid ? 'var(--accent-gold)' : '#fff' }}>
                    ₹ {toCr(currentBidRs)} Cr
                  </div>
                  <div style={{ fontSize: '1.1rem', color: '#ccc' }}>
                    {topBid ? `Bid by ${teams.find(t => t.id === topBid.team_id)?.team_name}` : 'No bids yet — be first!'}
                    {isPaused && <span style={{ color: '#ffbe0b', marginLeft: '10px' }}> (Paused)</span>}
                  </div>
                  {bidMsg && <div style={{ color: '#ff7070', background: 'rgba(255,0,0,0.1)', padding: '8px 16px', borderRadius: '8px', fontSize: '0.9rem' }}>{bidMsg}</div>}
                  <button className="btn-bid" onClick={handleBid} disabled={bidDisabled} style={{ marginTop: '10px' }}>
                    Bid ₹ {toCr(nextBidRs)} Cr
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {isAdmin && isSold && (
            <button className="btn-primary" onClick={handleNextPlayer} style={{ position: 'absolute', bottom: 30, right: 30, display: 'flex', alignItems: 'center', gap: '10px' }}>
              Next Player <ChevronRight size={20} />
            </button>
          )}
        </div>

        {/* Bid Log */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}><Gavel size={20} /> Bid Log</h3>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {playerBids.map(bid => {
              const t = teams.find(tm => tm.id === bid.team_id);
              return (
                <div key={bid.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <span style={{ fontWeight: 500, color: t?.id === myTeam?.id ? 'var(--accent-blue)' : '#fff' }}>{t?.team_name}</span>
                  <span style={{ color: 'var(--accent-gold)' }}>₹ {toCr(bid.amount)} Cr</span>
                </div>
              );
            })}
            {playerBids.length === 0 && <div style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>No bids yet</div>}
          </div>
        </div>
      </div>

      {/* Squad List Section */}
      {myTeam && (
        <div className="glass-panel" style={{ marginTop: '30px', marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '15px' }}>My Squad ({squads.filter(s => s.team_id === myTeam.id).length}/25)</h3>
          <div style={{ display: 'flex', gap: '15px', overflowX: 'auto', paddingBottom: '10px' }}>
            {squads.filter(s => s.team_id === myTeam.id).map(s => {
              const p = (playersData as any[])[s.player_id];
              return (
                <div key={s.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px 15px', borderRadius: '8px', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p?.name}</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#aaa' }}>
                    <span>{p?.role}</span>
                    <span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>₹ {toCr(s.bought_for)} Cr</span>
                  </div>
                </div>
              );
            })}
            {squads.filter(s => s.team_id === myTeam.id).length === 0 && (
              <div style={{ color: '#888', fontStyle: 'italic', padding: '10px 0' }}>No players bought yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Auction;
