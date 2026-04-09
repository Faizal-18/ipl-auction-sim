import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Gavel, User, ChevronRight, Pause, Play, Square } from 'lucide-react';
import playersData from '../data/players.json';

const TIMER_DURATION = 15;
const BID_TIME_BONUS = 3;
const INCREMENT_LAKH = 10;

const lakhToRupees = (lakhs: number) => lakhs * 100000;
const rupeesToCr = (rupees: number) => (rupees / 10000000).toFixed(2);

const Auction = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [room, setRoom] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [squads, setSquads] = useState<any[]>([]);
  const [currentUserTeam, setCurrentUserTeam] = useState<any>(null);
  const [isAdmin] = useState(() => localStorage.getItem('auction_is_admin') === 'true');
  const [timeLeft, setTimeLeft] = useState(TIMER_DURATION);
  const [isSold, setIsSold] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [bidError, setBidError] = useState('');

  // Refs so async callbacks always have fresh values (avoids stale closure bugs)
  const roomRef = useRef<any>(null);
  const teamsRef = useRef<any[]>([]);
  const timerRef = useRef<any>(null);
  const timeLeftRef = useRef(TIMER_DURATION);
  const isSoldRef = useRef(false);
  const isPausedRef = useRef(false);
  const prevBidCountRef = useRef(0);

  // Keep refs in sync with state
  const updateRoom = (r: any) => { roomRef.current = r; setRoom(r); };
  const updateTeams = (t: any[]) => { teamsRef.current = t; setTeams(t); };
  const updateIsSold = (v: boolean) => { isSoldRef.current = v; setIsSold(v); };
  const updateIsPaused = (v: boolean) => { isPausedRef.current = v; setIsPaused(v); };

  // ──── Data Loaders ────────────────────────────────────────────────────────

  const loadBids = useCallback(async (rmId: string) => {
    const { data } = await supabase.from('bids').select('*').eq('room_id', rmId).order('amount', { ascending: false });
    setBids(data || []);
    return data || [];
  }, []);

  const loadTeams = useCallback(async (rmId: string) => {
    const { data } = await supabase.from('teams').select('*').eq('room_id', rmId);
    updateTeams(data || []);
    const me = data?.find((t: any) => t.user_id === localStorage.getItem('auction_user_id'));
    if (me) setCurrentUserTeam(me);
    return data || [];
  }, []);

  const loadSquads = useCallback(async (rmId: string) => {
    const { data } = await supabase.from('squads').select('*').eq('room_id', rmId);
    setSquads(data || []);
    return data || [];
  }, []);

  // ──── Timer (admin only) ──────────────────────────────────────────────────

  const handleTimerEnd = useCallback(async (rmId: string) => {
    const currentIndex = roomRef.current?.current_player_index ?? 0;

    // Fetch fresh bids for this player
    const { data: currentBids } = await supabase
      .from('bids').select('*')
      .eq('room_id', rmId)
      .eq('player_id', currentIndex)
      .order('amount', { ascending: false })
      .limit(1);

    if (currentBids && currentBids.length > 0) {
      const topBid = currentBids[0];

      await supabase.from('squads').insert([{
        room_id: rmId,
        team_id: topBid.team_id,
        player_id: currentIndex,
        bought_for: topBid.amount
      }]);

      // Deduct purse with fresh team data
      const { data: freshTeam } = await supabase.from('teams').select('*').eq('id', topBid.team_id).single();
      if (freshTeam) {
        await supabase.from('teams').update({ purse: freshTeam.purse - topBid.amount }).eq('id', freshTeam.id);
      }
    } else {
      // Unsold — mark via broadcast so all clients update
      updateIsSold(true);
      supabase.channel(`room_${roomId}_auction`).send({
        type: 'broadcast', event: 'player_sold',
        payload: { sold: false, playerIndex: currentIndex }
      });
    }
  }, [roomId]);

  const startTimer = useCallback((rmId: string, initialTime = TIMER_DURATION) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let time = initialTime;
    setTimeLeft(time);
    timeLeftRef.current = time;

    timerRef.current = setInterval(async () => {
      if (isPausedRef.current) return; // skip tick if paused

      time -= 1;
      setTimeLeft(time);
      timeLeftRef.current = time;

      supabase.channel(`room_${roomId}_auction`).send({
        type: 'broadcast', event: 'timer_tick', payload: { time }
      });

      if (time <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        handleTimerEnd(rmId);
      }
    }, 1000);
  }, [roomId, handleTimerEnd]);

  // ──── Initial Load + Realtime Setup ──────────────────────────────────────

  useEffect(() => {
    let channel: any = null;

    const init = async () => {
      const { data: rm } = await supabase.from('rooms').select('*').eq('room_code', roomId).single();
      if (!rm) return;
      updateRoom(rm);

      const [tms, sqs, bidsData] = await Promise.all([
        loadTeams(rm.id),
        loadSquads(rm.id),
        loadBids(rm.id),
      ]);

      prevBidCountRef.current = (bidsData as any[]).filter(b => b.player_id === rm.current_player_index).length;

      // Subscribe to realtime
      channel = supabase.channel(`room_${roomId}_auction`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `room_id=eq.${rm.id}` }, async () => {
          const fresh = await loadBids(rm.id);

          if (isAdmin) {
            const currentIdx = roomRef.current?.current_player_index ?? 0;
            const playerBids = (fresh as any[]).filter(b => b.player_id === currentIdx);
            if (playerBids.length > prevBidCountRef.current && !isSoldRef.current && !isPausedRef.current) {
              const newTime = Math.min(timeLeftRef.current + BID_TIME_BONUS, TIMER_DURATION);
              startTimer(rm.id, newTime);
            }
            prevBidCountRef.current = playerBids.length;
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_code=eq.${roomId}` }, payload => {
          updateRoom(payload.new);
          if ((payload.new as any).status === 'RESULTS') navigate(`/room/${roomId}/results`);
          if ((payload.new as any).current_player_index !== roomRef.current?.current_player_index) {
            updateIsSold(false);
            setBidError('');
            prevBidCountRef.current = 0;
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'squads', filter: `room_id=eq.${rm.id}` }, () => {
          updateIsSold(true);
          loadSquads(rm.id);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${rm.id}` }, () => {
          loadTeams(rm.id);
        })
        .on('broadcast', { event: 'timer_tick' }, payload => {
          setTimeLeft(payload.payload.time);
          timeLeftRef.current = payload.payload.time;
        })
        .on('broadcast', { event: 'pause_toggle' }, payload => {
          updateIsPaused(payload.payload.isPaused);
        })
        .on('broadcast', { event: 'player_sold' }, payload => {
          if (!isAdmin) updateIsSold(true);
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED' && isAdmin) {
            startTimer(rm.id);
          }
        });
    };

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roomId]);

  // ──── Player index change — reset UI ─────────────────────────────────────

  useEffect(() => {
    if (!room) return;
    updateIsSold(false);
    setBidError('');
    prevBidCountRef.current = 0;
    setBids([]);
    if (isAdmin && room.id) {
      loadBids(room.id);
    }
  }, [room?.current_player_index]);

  // ──── Derived values ──────────────────────────────────────────────────────

  const currentIndex = room?.current_player_index ?? 0;
  const currentPlayer = (playersData as any[])[currentIndex];

  if (!room) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#fff', fontSize: '1.5rem' }}>
        Loading auction...
      </div>
    );
  }

  if (!currentPlayer) {
    return <div style={{ color: '#fff', textAlign: 'center', marginTop: '40px' }}>Auction Over</div>;
  }

  const currentPlayerBids = bids.filter(b => b.player_id === currentIndex);
  const highestBid = currentPlayerBids.length > 0 ? currentPlayerBids[0] : null;
  const basePriceRs = lakhToRupees(currentPlayer.base_price);
  const currentBidRs = highestBid ? highestBid.amount : basePriceRs;
  const nextBidRs = highestBid ? currentBidRs + lakhToRupees(INCREMENT_LAKH) : basePriceRs;

  // ──── Actions ─────────────────────────────────────────────────────────────

  const handleBid = async () => {
    if (!currentUserTeam || isSold) return;
    setBidError('');

    const mySquad = squads.filter(s => s.team_id === currentUserTeam.id);
    if (mySquad.length >= 25) { setBidError('Squad full! (Max 25)'); return; }

    const overseasInSquad = mySquad.filter(s => (playersData as any[])[s.player_id]?.is_overseas).length;
    if (currentPlayer.is_overseas && overseasInSquad >= 8) { setBidError('Overseas limit reached! (Max 8)'); return; }
    if (currentUserTeam.purse < nextBidRs) { setBidError('Not enough purse!'); return; }

    const { error } = await supabase.from('bids').insert([{
      room_id: room.id,
      player_id: currentIndex,
      team_id: currentUserTeam.id,
      amount: nextBidRs
    }]);

    if (error) {
      console.error('Bid error:', error);
      setBidError('Failed to place bid. Try again.');
    }
  };

  const togglePause = () => {
    if (!isAdmin) return;
    const newPaused = !isPausedRef.current;
    updateIsPaused(newPaused);
    if (!newPaused) {
      startTimer(room.id, timeLeftRef.current);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    supabase.channel(`room_${roomId}_auction`).send({
      type: 'broadcast', event: 'pause_toggle', payload: { isPaused: newPaused }
    });
  };

  const handleEndAuction = async () => {
    if (!isAdmin) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    await supabase.from('rooms').update({ status: 'RESULTS' }).eq('room_code', roomId);
    navigate(`/room/${roomId}/results`);
  };

  const handleNextPlayer = async () => {
    if (!isAdmin || !room) return;
    const nextIdx = currentIndex + 1;
    if (nextIdx >= (playersData as any[]).length) {
      await supabase.from('rooms').update({ status: 'RESULTS' }).eq('id', room.id);
      return;
    }
    setBids([]);
    prevBidCountRef.current = 0;
    await supabase.from('bids').delete().eq('room_id', room.id);
    await supabase.from('rooms').update({ current_player_index: nextIdx }).eq('id', room.id);
    startTimer(room.id);
  };

  const isBidDisabled = isSold || isPaused || timeLeft <= 0 || !currentUserTeam ||
    (highestBid && highestBid.team_id === currentUserTeam?.id);

  // ──── UI ─────────────────────────────────────────────────────────────────

  return (
    <div className="container flex-col" style={{ minHeight: '100vh' }}>

      {/* Top Bar */}
      <div className="glass-panel" style={{ padding: '15px 30px', display: 'flex', justifyContent: 'space-between', marginBottom: '30px', flexWrap: 'wrap', gap: '20px' }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div className="flex-col">
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Room</span>
            <strong>{roomId}</strong>
          </div>
          <div className="flex-col">
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Player</span>
            <strong>{currentIndex + 1} / {(playersData as any[]).length}</strong>
          </div>
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

        {currentUserTeam && (
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 20px', borderRadius: '12px' }}>
            <div className="flex-col">
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Your Team</span>
              <strong style={{ color: 'var(--accent-gold)' }}>{currentUserTeam.team_name}</strong>
            </div>
            <div className="flex-col" style={{ borderLeft: '1px solid var(--glass-border)', paddingLeft: '20px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Purse Left</span>
              <strong>₹ {rupeesToCr(currentUserTeam.purse)} Cr</strong>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 2fr) 1fr', gap: '30px', flex: 1 }}>

        {/* Main Auction Area */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>

          <div style={{ position: 'absolute', top: 30, right: 30, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '2rem', fontWeight: 'bold', color: timeLeft <= 5 ? '#ff007f' : '#fff' }} className={timeLeft <= 5 ? 'timer-pulse' : ''}>
            <Timer size={32} /> {timeLeft}s
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 1.1 }}
              transition={{ duration: 0.5 }}
              style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--bg-secondary), var(--glass-bg))', border: '2px solid var(--glass-border)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px' }}>
                <User size={64} color="var(--text-muted)" />
              </div>

              <h1>{currentPlayer.name}</h1>

              <div style={{ display: 'flex', gap: '15px', marginBottom: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <span className="player-tag">{currentPlayer.role}</span>
                <span className="player-tag" style={{ background: 'rgba(0,229,255,0.1)', color: 'var(--accent-blue)' }}>
                  Base: ₹ {currentPlayer.base_price > 99 ? (currentPlayer.base_price / 100).toFixed(2) + ' Cr' : currentPlayer.base_price + ' L'}
                </span>
                {currentPlayer.is_overseas && (
                  <span className="player-tag" style={{ background: 'rgba(255,190,11,0.1)', color: 'var(--accent-gold)' }}>Overseas</span>
                )}
              </div>

              {isSold ? (
                <div style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid #00ff7f', padding: '20px 40px', borderRadius: '16px' }}>
                  {highestBid ? (
                    <>
                      <h2 style={{ color: '#00ff7f', margin: 0 }}>SOLD!</h2>
                      <p style={{ color: '#fff' }}>to {teams.find(t => t.id === highestBid.team_id)?.team_name} for ₹ {rupeesToCr(highestBid.amount)} Cr</p>
                    </>
                  ) : (
                    <h2 style={{ color: '#ff4d4d', margin: 0 }}>UNSOLD</h2>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                  <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Current Bid</div>
                  <div style={{ fontSize: '4rem', fontWeight: '800', lineHeight: 1, color: highestBid ? 'var(--accent-gold)' : '#fff' }}>
                    ₹ {rupeesToCr(currentBidRs)} Cr
                  </div>
                  <div style={{ fontSize: '1.2rem' }}>
                    {highestBid ? `Bid by ${teams.find(t => t.id === highestBid.team_id)?.team_name}` : 'Waiting for bids...'}
                    {isPaused && <span style={{ color: '#ffbe0b', marginLeft: '10px' }}>(Paused)</span>}
                  </div>

                  {bidError && (
                    <div style={{ color: '#ff4d4d', background: 'rgba(255,0,0,0.1)', padding: '8px 16px', borderRadius: '8px', fontSize: '0.9rem' }}>
                      {bidError}
                    </div>
                  )}

                  <button className="btn-bid" onClick={handleBid} disabled={!!isBidDisabled} style={{ marginTop: '20px' }}>
                    Bid ₹ {rupeesToCr(nextBidRs)} Cr
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
          <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Gavel size={20} /> Bid Log
          </h3>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {currentPlayerBids.map(bid => {
              const t = teams.find(tm => tm.id === bid.team_id);
              return (
                <div key={bid.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <span style={{ fontWeight: 500, color: t?.id === currentUserTeam?.id ? 'var(--accent-blue)' : '#fff' }}>{t?.team_name}</span>
                  <span style={{ color: 'var(--accent-gold)' }}>₹ {rupeesToCr(bid.amount)} Cr</span>
                </div>
              );
            })}
            {currentPlayerBids.length === 0 && <div style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>No bids yet</div>}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Auction;
