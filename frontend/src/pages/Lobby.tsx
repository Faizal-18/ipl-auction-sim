import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, Play, Shield } from 'lucide-react';

const IPL_TEAMS = [
  { id: 'CSK', name: 'Chennai Super Kings', color: '#F9CD05' },
  { id: 'MI', name: 'Mumbai Indians', color: '#004BA0' },
  { id: 'RCB', name: 'Royal Challengers Bengaluru', color: '#EA1A2A' },
  { id: 'KKR', name: 'Kolkata Knight Riders', color: '#3A225D' },
  { id: 'RR', name: 'Rajasthan Royals', color: '#EA1E63' },
  { id: 'DC', name: 'Delhi Capitals', color: '#00008B' },
  { id: 'PBKS', name: 'Punjab Kings', color: '#DD1F2D' },
  { id: 'GT', name: 'Gujarat Titans', color: '#1B2133' },
  { id: 'LSG', name: 'Lucknow Super Giants', color: '#A72251' },
  { id: 'SRH', name: 'Sunrisers Hyderabad', color: '#F26522' },
];

const Lobby = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [participants, setParticipants] = useState<any[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [room, setRoom] = useState<any>(null);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const uid = localStorage.getItem('auction_user_id');
    const adminStr = localStorage.getItem('auction_is_admin');
    if (!uid) { navigate('/'); return; }
    setUserId(uid);
    setIsAdmin(adminStr === 'true');
    loadRoomAndParticipants();
  }, [roomId]);

  // Set up realtime subscriptions ONLY after room is loaded (room.id is known)
  useEffect(() => {
    if (!room?.id) return;

    const ch = supabase.channel(`lobby_${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `room_id=eq.${room.id}` }, () => {
        loadRoomAndParticipants();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${room.id}` }, () => {
        loadRoomAndParticipants();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_code=eq.${roomId}` }, payload => {
        const updated = payload.new as any;
        if (updated.status === 'AUCTION') {
          navigate(`/room/${roomId}/auction`);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [room?.id, roomId]);

  const loadRoomAndParticipants = async () => {
    try {
      const { data: rm } = await supabase.from('rooms').select('*').eq('room_code', roomId).single();
      if (!rm) return;
      setRoom(rm);

      // If status already AUCTION, go there
      if (rm.status === 'AUCTION') {
        navigate(`/room/${roomId}/auction`);
        return;
      }

      const { data: users } = await supabase.from('users').select('*').eq('room_id', rm.id);
      const { data: teams } = await supabase.from('teams').select('*').eq('room_id', rm.id);

      const combined = users?.map(u => {
        const t = teams?.find(team => team.user_id === u.id);
        if (u.id === localStorage.getItem('auction_user_id') && t) {
          setSelectedTeam(t.team_name);
        }
        return { ...u, team: t };
      }) || [];

      setParticipants(combined);

      if (rm.admin_id === localStorage.getItem('auction_user_id')) {
        setIsAdmin(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectTeam = async (teamId: string) => {
    if (!room || !userId) {
      alert('Room not loaded yet, please wait a moment and try again.');
      return;
    }

    // check if taken by someone else
    const isTaken = participants.some(p => p.team?.team_name === teamId && p.id !== userId);
    if (isTaken) { alert('Team is already taken!'); return; }

    try {
      const { data: existingTeam } = await supabase
        .from('teams').select('*')
        .eq('user_id', userId).eq('room_id', room.id)
        .single();

      if (existingTeam) {
        await supabase.from('teams').update({ team_name: teamId }).eq('id', existingTeam.id);
      } else {
        await supabase.from('teams').insert([{
          room_id: room.id,
          user_id: userId,
          team_name: teamId,
          purse: 1000000000
        }]);
      }
      setSelectedTeam(teamId);
      loadRoomAndParticipants();
    } catch (err) {
      console.error(err);
    }
  };

  const startAuction = async () => {
    if (!room) return;
    try {
      await supabase.from('rooms').update({ status: 'AUCTION' }).eq('id', room.id);
      // Navigate admin immediately; others navigate via realtime subscription
      navigate(`/room/${roomId}/auction`);
    } catch (err) {
      console.error(err);
    }
  };

  const allHaveTeams = participants.length > 0 && participants.every(p => !!p.team);

  return (
    <div className="container flex-col" style={{ gap: '30px' }}>
      <div className="glass-panel text-center" style={{ padding: '20px' }}>
        <h2>Room: <span style={{ color: 'var(--accent-gold)', letterSpacing: '2px' }}>{roomId}</span></h2>
        <p>Share this code with your friends to join.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '30px' }}>

        {/* Participants Left Col */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={24} color="var(--accent-blue)" />
            <h3>Participants ({participants.length})</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {participants.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                <span style={{ fontWeight: '500' }}>{p.name} {p.id === userId && '(You)'}</span>
                {p.team ? (
                  <span className="player-tag" style={{ background: IPL_TEAMS.find(t => t.id === p.team.team_name)?.color || 'rgba(255,255,255,0.1)' }}>
                    {p.team.team_name}
                  </span>
                ) : (
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>Selecting...</span>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <>
              <button
                className="btn-primary"
                style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', gap: '10px' }}
                onClick={startAuction}
                disabled={!allHaveTeams}
              >
                Start Auction <Play size={20} />
              </button>
              {!allHaveTeams && (
                <p style={{ fontSize: '0.8rem', color: '#ffbe0b', textAlign: 'center' }}>
                  {selectedTeam ? 'Waiting for all players to select a team.' : '⬅️ Select your team first!'}
                </p>
              )}
            </>
          )}
        </div>

        {/* Team Selection Right Col */}
        <div className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Shield size={24} color="var(--accent-pink)" />
            <h3>Select Your Team</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '15px' }}>
            {IPL_TEAMS.map(team => {
              const isTaken = participants.some(p => p.team?.team_name === team.id && p.id !== userId);
              const isMine = selectedTeam === team.id;

              return (
                <button
                  key={team.id}
                  onClick={() => selectTeam(team.id)}
                  disabled={isTaken}
                  style={{
                    background: isMine ? team.color : (isTaken ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'),
                    border: `1px solid ${isMine ? '#fff' : (isTaken ? 'transparent' : 'rgba(255,255,255,0.1)')}`,
                    padding: '20px',
                    borderRadius: '16px',
                    color: isTaken ? '#555' : '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: isTaken ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: isMine ? `0 0 20px ${team.color}80` : 'none',
                    opacity: isTaken ? 0.5 : 1
                  }}
                >
                  <span style={{ fontSize: '1.5em', fontWeight: 'bold' }}>{team.id}</span>
                  <span style={{ fontSize: '0.8em', textAlign: 'center' }}>{team.name}</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Lobby;
