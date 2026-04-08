import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, generateRoomCode } from '../lib/supabase';
import { Trophy, ArrowRight, Plus } from 'lucide-react';

const Home = () => {
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    setIsCreating(true);
    setError('');
    
    try {
      const code = generateRoomCode();
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert([{ room_code: code, status: 'LOBBY' }])
        .select()
        .single();
        
      if (roomError) throw roomError;
      
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert([{ name: userName, room_id: room.id }])
        .select()
        .single();
        
      if (userError) throw userError;

      // Make the creator the admin of the room
      await supabase
        .from('rooms')
        .update({ admin_id: user.id })
        .eq('id', room.id);
      
      // Store user info basically in localstorage for this session
      localStorage.setItem('auction_user_id', user.id);
      localStorage.setItem('auction_user_name', userName);
      localStorage.setItem('auction_is_admin', 'true');
      
      navigate(`/room/${code}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create room');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !roomCode.trim()) {
      setError('Please enter your name and room code');
      return;
    }
    
    setIsJoining(true);
    setError('');
    
    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .single();
        
      if (roomError || !room) throw new Error('Room not found');
      
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert([{ name: userName, room_id: room.id }])
        .select()
        .single();
        
      if (userError) throw userError;
      
      localStorage.setItem('auction_user_id', user.id);
      localStorage.setItem('auction_user_name', userName);
      localStorage.setItem('auction_is_admin', 'false');
      
      navigate(`/room/${room.room_code}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to join room');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="container flex-col flex-center" style={{ minHeight: '100vh' }}>
      <div className="glass-panel" style={{ maxWidth: '500px', width: '100%', textAlign: 'center' }}>
        <Trophy size={64} color="var(--accent-gold)" style={{ marginBottom: '20px' }} />
        <h1>IPL Auction Pro</h1>
        <p style={{ marginBottom: '40px' }}>Experience the thrill of a real-time multiplayer IPL cricket auction.</p>
        
        {error && (
          <div style={{ color: '#ff4d4d', background: 'rgba(255,0,0,0.1)', padding: '10px', borderRadius: '8px', marginBottom: '20px' }}>
            {error}
          </div>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* Create Room Section */}
          <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h2>Create a Room</h2>
            <input 
              type="text" 
              placeholder="Your Name (Host)" 
              value={userName} 
              onChange={e => setUserName(e.target.value)} 
              maxLength={20}
            />
            <button type="submit" className="btn-primary flex-center" disabled={isCreating} style={{ gap: '10px' }}>
              {isCreating ? 'Creating...' : 'Create New Room'} <Plus size={20} />
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
            <span style={{ margin: '0 15px', color: 'var(--text-muted)' }}>OR</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
          </div>

          {/* Join Room Section */}
          <form onSubmit={handleJoinRoom} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h2>Join a Room</h2>
            <input 
              type="text" 
              placeholder="Your Name" 
              value={userName} 
              onChange={e => setUserName(e.target.value)} 
              maxLength={20}
            />
            <input 
              type="text" 
              placeholder="6-Letter Room Code" 
              value={roomCode} 
              onChange={e => setRoomCode(e.target.value)} 
              maxLength={6}
              style={{ textTransform: 'uppercase' }}
            />
            <button type="submit" className="btn-secondary flex-center" disabled={isJoining} style={{ gap: '10px' }}>
              {isJoining ? 'Joining...' : 'Join Room'} <ArrowRight size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Home;
