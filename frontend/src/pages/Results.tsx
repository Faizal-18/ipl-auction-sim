import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';
import { Download, Users } from 'lucide-react';
import playersData from '../data/players.json';

const Results = () => {
  const { roomId } = useParams();
  const [teams, setTeams] = useState<any[]>([]);
  const [squads, setSquads] = useState<any[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadResults();
  }, [roomId]);

  const loadResults = async () => {
    try {
      const { data: rm } = await supabase.from('rooms').select('*').eq('room_code', roomId).single();
      if (!rm) return;
      
      const { data: tms } = await supabase.from('teams').select('*').eq('room_id', rm.id);
      setTeams(tms || []);
      
      const { data: squ } = await supabase.from('squads').select('*').eq('room_id', rm.id);
      setSquads(squ || []);
    } catch (err) { console.error(err); }
  };

  const handleExport = async () => {
    if (!resultRef.current) return;
    try {
      const canvas = await html2canvas(resultRef.current, { backgroundColor: '#0a0a0f' });
      const image = canvas.toDataURL('image/png', 1.0);
      
      // Convert Data URL to Blob to prevent browser filename stripping on large strings
      const byteString = atob(image.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });
      
      // Use file-saver plugin to perfectly bypass all browser restrictions on generated Blobs
      saveAs(blob, `IPL_Auction_${roomId}_Squads.png`);
    } catch (err) {
      console.error(err);
      alert('Failed to export image.');
    }
  };

  return (
    <div className="container flex-col" style={{ minHeight: '100vh', gap: '30px' }}>
      
      <div className="glass-panel text-center" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Auction Results - Room <span style={{ color: 'var(--accent-gold)' }}>{roomId}</span></h2>
          <p>The auction has concluded! Here are the final squads.</p>
        </div>
        <button className="btn-primary" onClick={handleExport} style={{ display: 'flex', gap: '10px' }}>
          <Download size={20} /> Export Image
        </button>
      </div>

      <div ref={resultRef} style={{ display: 'flex', flexDirection: 'column', gap: '30px', padding: '20px' }}>
        {teams.map(team => {
          const teamSquad = squads.filter(s => s.team_id === team.id);
          const totalSpent = teamSquad.reduce((acc, curr) => acc + curr.bought_for, 0);
          
          return (
            <div key={team.id} className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '15px' }}>
                <h3 style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Users size={24} /> {team.team_name}
                </h3>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <span><span style={{ color: 'var(--text-muted)' }}>Spent:</span> ₹ {(totalSpent / 10000000).toFixed(2)} Cr</span>
                  <span><span style={{ color: 'var(--text-muted)' }}>Purse Left:</span> ₹ {(team.purse / 10000000).toFixed(2)} Cr</span>
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
                {teamSquad.length > 0 ? teamSquad.map(sq => {
                  const player = playersData[sq.player_id];
                  return (
                    <div key={sq.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', padding: '12px 16px', borderRadius: '8px' }}>
                      <span style={{ fontWeight: 500 }}>{player?.name || 'Unknown'}</span>
                      <span style={{ color: 'var(--accent-gold)' }}>₹ {(sq.bought_for / 10000000).toFixed(2)} Cr</span>
                    </div>
                  );
                }) : (
                  <p style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: '#666' }}>No players bought.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};

export default Results;
