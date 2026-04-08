import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Gavel, User, ChevronRight, Pause, Play, Square } from 'lucide-react';
import playersData from '../data/players.json';

const TIMER_DURATION = 15; // seconds per player
const INCREMENT_LAKH = 10; // 10 Lakh per bid (0.1 Cr)

const Auction = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [squads, setSquads] = useState<any[]>([]);
  const [currentUserTeam, setCurrentUserTeam] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TIMER_DURATION);
  const [isSold, setIsSold] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const timerRef = useRef<any>(null);

  useEffect(() => {
    const adminStr = localStorage.getItem('auction_is_admin');
    setIsAdmin(adminStr === 'true');
    loadInitialData();
  }, [roomId]);

  useEffect(() => {
    if (!room?.id) return;

    // Setup Realtime DB Subscriptions ONLY when room.id is known
    const channel = supabase.channel(`room_${roomId}_auction`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `room_id=eq.${room.id}` }, () => {
        loadBids(room.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `room_code=eq.${roomId}` }, payload => {
        setRoom(payload.new);
        const newRecord = payload.new as any;
        if (newRecord.status === 'RESULTS') navigate(`/room/${roomId}/results`);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'squads', filter: `room_id=eq.${room.id}` }, () => {
        setIsSold(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${room.id}` }, () => {
        loadTeams(room.id);
      })
      .on('broadcast', { event: 'timer_tick' }, payload => {
        setTimeLeft(payload.payload.time);
      })
      .on('broadcast', { event: 'pause_toggle' }, payload => {
        setIsPaused(payload.payload.isPaused);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, roomId]);
  
  // Whenever room's current player index changes, reset auction UI state
  useEffect(() => {
    setIsSold(false);
  }, [room?.current_player_index]);

  const loadInitialData = async () => {
    try {
      const { data: rm } = await supabase.from('rooms').select('*').eq('room_code', roomId).single();
      if (!rm) return;
      setRoom(rm);
      
      const { data: tms } = await supabase.from('teams').select('*').eq('room_id', rm.id);
      setTeams(tms || []);
      
      const me = tms?.find(t => t.user_id === localStorage.getItem('auction_user_id'));
      if (me) setCurrentUserTeam(me);

      // Load squad
      const { data: sqs } = await supabase.from('squads').select('*').eq('room_id', rm.id);
      setSquads(sqs || []);

      await loadBids(rm.id);
      
      // If admin, start the loop
      if (localStorage.getItem('auction_is_admin') === 'true') {
        startTimer(rm.id);
      }
      
    } catch (err) { console.error(err); }
  };

  const loadTeams = async (rmId: string) => {
    const { data } = await supabase.from('teams').select('*').eq('room_id', rmId);
    setTeams(data || []);
    const me = data?.find((t: any) => t.user_id === localStorage.getItem('auction_user_id'));
    if (me) setCurrentUserTeam(me);
    // Also reload squads to keep limit checks fresh
    const { data: sqs } = await supabase.from('squads').select('*').eq('room_id', rmId);
    setSquads(sqs || []);
  };

  const loadBids = async (rmId: string) => {
    if (!rmId) return;
    const { data } = await supabase.from('bids').select('*').eq('room_id', rmId).order('created_at', { ascending: false });
    setBids(data || []);
  };

  // ADMIN ONLY TICK FUNCTION
  const startTimer = (rmId: string, initialTime = TIMER_DURATION) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let time = initialTime;
    setTimeLeft(time);
    
    timerRef.current = setInterval(async () => {
      time -= 1;
      
      // Update local state (Admin)
      setTimeLeft(time);
      
      // Broadcast to everyone else
      supabase.channel(`room_${roomId}_auction`).send({
        type: 'broadcast',
        event: 'timer_tick',
        payload: { time }
      });

      if (time <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleTimerEnd(rmId);
      }
    }, 1000);
  };

  const handleTimerEnd = async (rmId: string) => {
    // Only Admin runs this
    const { data: currentBids } = await supabase.from('bids').select('*').eq('room_id', rmId).order('amount', { ascending: false }).limit(1);
    
    if (currentBids && currentBids.length > 0) {
      // Sold!
      const topBid = currentBids[0];
      const currentPlayerId = room?.current_player_index || 0;
      
      // Insert to squads
      await supabase.from('squads').insert([{
        room_id: rmId,
        team_id: topBid.team_id,
        player_id: currentPlayerId,
        bought_for: topBid.amount
      }]);
      
      // Deduct purse
      const team = teams.find(t => t.id === topBid.team_id);
      if (team) {
        await supabase.from('teams').update({ purse: team.purse - topBid.amount }).eq('id', team.id);
      }
    } else {
      // Unsold
      setIsSold(true);
    }
  };

  const currentPlayer = playersData[room?.current_player_index || 0];
  if (!currentPlayer) return <div>Auction Over</div>;

  const highestBid = bids.length > 0 ? bids[0] : null;
  const currentPrice = highestBid ? highestBid.amount : currentPlayer.base_price; // in Lakhs
  const nextBidAmount = highestBid ? currentPrice + INCREMENT_LAKH : currentPrice;

  const handleBid = async () => {
    if (!currentUserTeam || isSold) return;
    
    // Squad size limits
    const mySquad = squads.filter(s => s.team_id === currentUserTeam.id);
    if (mySquad.length >= 25) {
      alert('Your squad is full! (Max 25 players)');
      return;
    }
    // Overseas limit
    const overseasInSquad = mySquad.filter(s => {
      const p = (playersData as any[])[s.player_id];
      return p?.is_overseas;
    }).length;
    const currentPlayerData = (playersData as any[])[room?.current_player_index || 0];
    if (currentPlayerData?.is_overseas && overseasInSquad >= 8) {
      alert('Overseas player limit reached! (Max 8 overseas players)');
      return;
    }

    // Check purse — amounts stored in paise (Lakh * 100000)
    const amountInRs = nextBidAmount * 100000;
    if (currentUserTeam.purse < amountInRs) {
       alert('Not enough purse limit!');
       return;
    }
    
    // Insert bid
    await supabase.from('bids').insert([{
      room_id: room.id,
      player_id: room.current_player_index,
      team_id: currentUserTeam.id,
      amount: amountInRs
    }]);
  };
  
  // Actually, we need Admin to reset timer on ANY bid.
  // We can add a useEffect to listen to `bids` change if Admin.
  useEffect(() => {
    if (isAdmin && bids.length > 0 && !isSold && !isPaused) {
      startTimer(room.id);
    }
  }, [bids, isPaused]);

  const togglePause = () => {
    if (!isAdmin) return;
    const newState = !isPaused;
    setIsPaused(newState);
    if (!newState) {
      startTimer(room.id, timeLeft);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    supabase.channel(`room_${roomId}_auction`).send({
      type: 'broadcast',
      event: 'pause_toggle',
      payload: { isPaused: newState }
    });
  };

  const handleEndAuction = async () => {
    if (!isAdmin) return;
    
    try {
      console.log("Forcing room to RESULTS for:", roomId);
      // Fallback update using room_code directly
      await supabase.from('rooms').update({ status: 'RESULTS' }).eq('room_code', roomId);
      
      console.log("Navigating directly to results...");
      navigate(`/room/${roomId}/results`);
      // Force reload UI just in case
      setTimeout(() => {
        window.location.href = `/room/${roomId}/results`;
      }, 500);
    } catch (e) {
      console.error(e);
    }
  };

  const handleNextPlayer = async () => {
    if (!isAdmin || !room) return;
    
    const nextIdx = room.current_player_index + 1;
    if (nextIdx >= playersData.length) {
       await supabase.from('rooms').update({ status: 'RESULTS' }).eq('id', room.id);
       return;
    }

    // Clear local bids manually so UI snaps immediately, then DB syncs
    setBids([]);
    // Clear bids for next player DB side
    await supabase.from('bids').delete().eq('room_id', room.id);
    // Update room
    await supabase.from('rooms').update({ current_player_index: nextIdx }).eq('id', room.id);
    startTimer(room.id);
  };

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
            <strong>{room?.current_player_index + 1} / {playersData.length}</strong>
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={togglePause} style={{ padding: '8px 15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
              {isPaused ? <Play size={16} /> : <Pause size={16} />} {isPaused ? "Resume" : "Pause"}
            </button>
            <button className="btn-primary" onClick={handleEndAuction} style={{ padding: '8px 15px', background: '#ff4d4d', color: '#fff', borderColor: '#cc0000', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
              <Square size={16} /> End Auction
            </button>
          </div>
        )}

        {currentUserTeam && (
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 20px', borderRadius: '12px' }}>
            <div className="flex-col text-right">
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Your Team</span>
              <strong style={{ color: 'var(--accent-gold)' }}>{currentUserTeam.team_name}</strong>
            </div>
            <div className="flex-col text-right border-l pl-4" style={{ borderLeft: '1px solid var(--glass-border)', paddingLeft: '20px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Purse Remaining</span>
              <strong>₹ {(currentUserTeam.purse / 10000000).toFixed(2)} Cr</strong>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 2fr) 1fr', gap: '30px', flex: 1 }}>
        
        {/* Main Auction Area */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          
          {/* Timer Ring */}
          <div style={{ position: 'absolute', top: 30, right: 30, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '2rem', fontWeight: 'bold', color: timeLeft <= 5 ? '#ff007f' : '#fff' }} className={timeLeft <= 5 ? 'timer-pulse' : ''}>
            <Timer size={32} />
            {timeLeft}s
          </div>

          <AnimatePresence mode="wait">
            <motion.div 
              key={currentPlayer.id}
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 1.1 }}
              transition={{ duration: 0.5 }}
              style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              <div style={{ 
                width: '120px', height: '120px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--bg-secondary), var(--glass-bg))', 
                border: '2px solid var(--glass-border)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px'
              }}>
                <User size={64} color="var(--text-muted)" />
              </div>

              <h1>{currentPlayer.name}</h1>
              
              <div style={{ display: 'flex', gap: '15px', marginBottom: '40px' }}>
                <span className="player-tag">{currentPlayer.role}</span>
                <span className="player-tag" style={{ background: 'rgba(0, 229, 255, 0.1)', color: 'var(--accent-blue)' }}>
                  Base: ₹ {currentPlayer.base_price > 99 ? (currentPlayer.base_price/100).toFixed(2) + ' Cr' : currentPlayer.base_price + ' L'}
                </span>
              </div>

              {isSold ? (
                <div style={{ background: 'rgba(0, 255, 127, 0.1)', border: '1px solid #00ff7f', padding: '20px 40px', borderRadius: '16px', color: '#00ff7f' }}>
                  {highestBid ? (
                    <>
                      <h2 style={{ color: '#00ff7f', margin: 0 }}>SOLD!</h2>
                      <p style={{ color: '#fff' }}>to {teams.find(t=>t.id===highestBid.team_id)?.team_name} for ₹ {(highestBid.amount / 10000000).toFixed(2)} Cr</p>
                    </>
                  ) : (
                    <h2 style={{ color: '#ff4d4d', margin: 0 }}>UNSOLD</h2>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                  <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Current Bid</div>
                  <div style={{ fontSize: '4rem', fontWeight: '800', lineHeight: 1, color: highestBid ? 'var(--accent-gold)' : '#fff' }}>
                    ₹ {highestBid ? (highestBid.amount / 10000000).toFixed(2) : (currentPlayer.base_price > 99 ? (currentPlayer.base_price/100).toFixed(2) : currentPlayer.base_price/100)} Cr
                  </div>
                  <div style={{ fontSize: '1.2rem' }}>
                    {highestBid ? `Bid by ${teams.find(t=>t.id===highestBid.team_id)?.team_name}` : 'Waiting for bids...'}
                    {isPaused && <span style={{ color: '#ffbe0b', marginLeft: '10px' }}>(Paused)</span>}
                  </div>

                  <button 
                    className="btn-bid" 
                    onClick={handleBid} 
                    disabled={isSold || isPaused || timeLeft <= 0 || (highestBid && highestBid.team_id === currentUserTeam?.id)}
                    style={{ marginTop: '20px' }}
                  >
                    Bid ₹ {(nextBidAmount * 100000 / 10000000).toFixed(2)} Cr
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

        {/* Right Sidebar - Bid History */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Gavel size={20} /> Bid Log
          </h3>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {bids.map(bid => {
              const t = teams.find(tm => tm.id === bid.team_id);
              return (
                <div key={bid.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <span style={{ fontWeight: 500, color: t?.team_name === currentUserTeam?.team_name ? 'var(--accent-blue)' : '#fff' }}>{t?.team_name}</span>
                  <span style={{ color: 'var(--accent-gold)' }}>₹ {(bid.amount / 10000000).toFixed(2)} Cr</span>
                </div>
              );
            })}
            {bids.length === 0 && <div style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>No bids yet</div>}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Auction;
