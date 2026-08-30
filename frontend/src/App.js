import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Radio, AlertCircle, Heart, ShieldAlert, UserCheck, Bell, History, FileText, Send, Zap, Volume2, Wind, PhoneCall, X, CheckCircle, MessageSquare, Phone, ChevronRight } from 'lucide-react';

export default function App() {
  const [patients, setPatients] = useState([
    { 
      id: 'S2', 
      name: 'Subject S2 (Active)', 
      score: 0.15, 
      status: 'Baseline', 
      hr: 72, 
      trend: [0.12, 0.15, 0.14, 0.18, 0.15],
      history: [
        { id: 1, time: '10:15 AM', type: 'Audio Grounding', status: 'Completed', outcome: 'Distress lowered to 15%' },
        { id: 2, time: '08:30 AM', type: 'Guided Breathing', status: 'Completed', outcome: 'Heart rate stabilized' }
      ],
      notes: [
        { id: 1, time: '10:18 AM', text: 'Patient responded well to the morning audio exercise.' }
      ],
      caregiver: { name: 'Sarah Jenkins', relation: 'Primary Caregiver', phone: '+1 (555) 234-5678' }
    },
    { 
      id: 'S3', 
      name: 'Subject S3', 
      score: 0.82, 
      status: 'Elevated', 
      hr: 115, 
      trend: [0.4, 0.55, 0.68, 0.75, 0.82],
      history: [
        { id: 1, time: '11:02 AM', type: 'Emergency Contact Alert', status: 'Triggered', outcome: 'Caregiver notified' }
      ],
      notes: [
        { id: 1, time: '11:05 AM', text: 'Elevated stress response observed; intervention recommended.' }
      ],
      caregiver: { name: 'David Miller', relation: 'Spouse', phone: '+1 (555) 987-6543' }
    },
    { 
      id: 'S4', 
      name: 'Subject S4', 
      score: 0.22, 
      status: 'Baseline', 
      hr: 68, 
      trend: [0.2, 0.22, 0.21, 0.25, 0.22],
      history: [],
      notes: [],
      caregiver: { name: 'Elena Rostova', relation: 'Guardian', phone: '+1 (555) 456-7890' }
    },
  ]);

  const [selectedId, setSelectedId] = useState('S2');
  const [noteInput, setNoteInput] = useState('');
  const [activeModal, setActiveModal] = useState(null);

  const activePatient = patients.find((p) => p.id === selectedId) || patients[0];

  useEffect(() => {
    const interval = setInterval(() => {
      setPatients((prevPatients) =>
        prevPatients.map((patient) => {
          if (patient.id !== selectedId) return patient;
          const randomDelta = (Math.random() - 0.48) * 0.1;
          const newScore = Math.min(Math.max(patient.score + randomDelta, 0.05), 0.95);
          const newHr = Math.round(60 + newScore * 60);
          const isElevated = newScore > 0.6;
          const updatedTrend = [...patient.trend.slice(-14), newScore];

          return {
            ...patient,
            score: newScore,
            status: isElevated ? 'Elevated' : 'Baseline',
            hr: newHr,
            trend: updatedTrend,
          };
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedId]);

  const recordIntervention = (type, outcome) => {
    const newHistoryItem = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: type,
      status: 'Active Now',
      outcome: outcome
    };

    setPatients((prev) =>
      prev.map((p) => {
        if (p.id === selectedId) {
          const updatedScore = Math.max(0.1, p.score - 0.25);
          return {
            ...p,
            score: updatedScore,
            history: [newHistoryItem, ...p.history]
          };
        }
        return p;
      })
    );
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!noteInput.trim()) return;

    const newNote = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: noteInput
    };

    setPatients((prev) =>
      prev.map((p) =>
        p.id === selectedId ? { ...p, notes: [newNote, ...p.notes] } : p
      )
    );

    setNoteInput('');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#eaf3ef', color: '#17312b', fontFamily: 'sans-serif' }}>
      
      {/* Pop-up Modals */}
      {activeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(23, 49, 43, 0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#ffffff', border: '1px solid #d9e5df', borderRadius: '24px',
            padding: '24px', width: '420px', boxShadow: '0 20px 55px rgba(27, 65, 53, 0.16)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '16px', color: '#17312b' }}>{activeModal.title}</span>
              <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', color: '#6f817b', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* AUDIO OPTIONS MODAL */}
            {activeModal.type === 'audio_menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#6f817b' }}>Select an audio track to stream to patient's device:</p>
                {[
                  { name: '432Hz Ambient Sea Waves', desc: 'Slower heart rate frequency' },
                  { name: 'Soft Rain & Gentle Wind', desc: 'Calming auditory grounding' },
                  { name: 'Guided Body Scan (5-min)', desc: 'Voice instructions for muscle relaxation' },
                  { name: 'White Noise Comfort Track', desc: 'Reduces overstimulation' }
                ].map((track, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      recordIntervention('Audio Grounding', `Started: ${track.name}`);
                      setActiveModal({ type: 'preview', title: 'Audio Stream Active', description: `Now playing "${track.name}" on patient device.`, icon: <Volume2 size={16} /> });
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px',
                      backgroundColor: '#f8fbf8', border: '1px solid #d9e5df', borderRadius: '14px', cursor: 'pointer', textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#226552' }}>{track.name}</div>
                      <div style={{ fontSize: '11px', color: '#6f817b' }}>{track.desc}</div>
                    </div>
                    <ChevronRight size={16} color="#2f7d67" />
                  </button>
                ))}
              </div>
            )}

            {/* BREATHING OPTIONS MODAL */}
            {activeModal.type === 'breathing_menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#6f817b' }}>Select a breathing pacing exercise:</p>
                {[
                  { name: '4-7-8 Deep Relaxation', desc: 'Inhale 4s, Hold 7s, Exhale 8s' },
                  { name: 'Box Breathing (4-4-4-4)', desc: 'Equal intervals for quick acute stress reset' },
                  { name: 'Coherence Breathing (5-5)', desc: 'Balances autonomic nervous system' }
                ].map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      recordIntervention('Guided Breathing', `Started: ${ex.name}`);
                      setActiveModal({ type: 'preview', title: 'Breathing Visualizer Pushed', description: `Patient visualizer active with ${ex.name}.`, icon: <Wind size={16} /> });
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px',
                      backgroundColor: '#f8fbf8', border: '1px solid #d9e5df', borderRadius: '14px', cursor: 'pointer', textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#28446e' }}>{ex.name}</div>
                      <div style={{ fontSize: '11px', color: '#6f817b' }}>{ex.desc}</div>
                    </div>
                    <ChevronRight size={16} color="#28446e" />
                  </button>
                ))}
              </div>
            )}

            {/* EMERGENCY CAREGIVER CONTACT CARD MODAL */}
            {activeModal.type === 'caregiver_card' && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: '#fff7e8', padding: '20px', borderRadius: '18px', border: '1px solid #d9e5df', marginBottom: '16px' }}>
                  <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#2f7d67', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 'bold', marginBottom: '10px' }}>
                    {activePatient.caregiver.name.charAt(0)}
                  </div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#17312b' }}>{activePatient.caregiver.name}</h3>
                  <div style={{ fontSize: '12px', color: '#6f817b', fontWeight: '600' }}>{activePatient.caregiver.relation}</div>
                  <div style={{ fontSize: '12px', color: '#226552', marginTop: '4px' }}>{activePatient.caregiver.phone}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <button
                    onClick={() => {
                      recordIntervention('Caregiver Contact', `Dispatched SMS to ${activePatient.caregiver.name}`);
                      setActiveModal({ type: 'preview', title: 'Message Sent', description: `Automated distress SMS delivered to ${activePatient.caregiver.name}.`, icon: <MessageSquare size={16} /> });
                    }}
                    style={{ padding: '12px', backgroundColor: '#e9f1ff', border: '1px solid #28446e', color: '#28446e', borderRadius: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}
                  >
                    <MessageSquare size={18} /> Send Message
                  </button>

                  <button
                    onClick={() => {
                      recordIntervention('Caregiver Contact', `Initiated emergency call to ${activePatient.caregiver.name}`);
                      setActiveModal({ type: 'preview', title: 'Call Initiated', description: `Dialing emergency contact ${activePatient.caregiver.phone}...`, icon: <Phone size={16} /> });
                    }}
                    style={{ padding: '12px', backgroundColor: '#ffecec', border: '1px solid #d83b3b', color: '#d83b3b', borderRadius: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}
                  >
                    <Phone size={18} /> Place Call
                  </button>
                </div>
              </div>
            )}

            {/* ACTION PREVIEW CONFIRMATION */}
            {activeModal.type === 'preview' && (
              <div>
                <div style={{ backgroundColor: '#fff7e8', border: '1px solid #d9e5df', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#6f817b', lineHeight: '1.4' }}>{activeModal.description}</p>
                  <div style={{ backgroundColor: '#ffffff', padding: '10px', borderRadius: '12px', fontSize: '12px', color: '#2f7d67', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d9e5df' }}>
                    {activeModal.icon}
                    <span>Pushed live to patient</span>
                  </div>
                </div>

                <button
                  onClick={() => setActiveModal(null)}
                  style={{ width: '100%', padding: '12px', backgroundColor: '#2f7d67', color: '#ffffff', border: 'none', borderRadius: '18px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <div style={{ width: '280px', borderRight: '1px solid #d9e5df', padding: '16px', backgroundColor: '#f8fbf8', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <Activity color="#2f7d67" size={24} />
          <h1 style={{ fontWeight: 'bold', fontSize: '18px', margin: 0, color: '#17312b' }}>Companio Care</h1>
        </div>
        <div style={{ fontSize: '12px', color: '#6f817b', fontWeight: 'bold', marginBottom: '8px' }}>ACTIVE PATIENT STREAM</div>
        {patients.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '18px',
              textAlign: 'left',
              marginBottom: '8px',
              cursor: 'pointer',
              backgroundColor: selectedId === p.id ? '#dff1eb' : '#ffffff',
              border: selectedId === p.id ? '1px solid #2f7d67' : '1px solid #d9e5df',
              color: selectedId === p.id ? '#226552' : '#17312b'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontWeight: '600' }}>{p.name}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#6f817b' }}>
              Distress: {(p.score * 100).toFixed(0)}% | {p.hr} BPM
            </div>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #d9e5df', paddingBottom: '12px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', color: '#17312b' }}>{activePatient.name} Dashboard</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6f817b' }}>Therapist Clinical View</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#dff1eb', padding: '6px 12px', borderRadius: '18px', color: '#226552', fontWeight: 'bold' }}>
            <Radio color="#2f7d67" size={16} />
            <span style={{ fontSize: '12px' }}>Live Stream</span>
          </div>
        </header>

        {/* Dynamic Alerts Component */}
        {activePatient.score > 0.6 && (
          <div style={{ backgroundColor: '#ffecec', border: '1px solid #ffd0d0', color: '#8d1d1d', padding: '12px 16px', borderRadius: '18px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'bold' }}>
            <Bell size={20} color="#d83b3b" />
            <div>
              <strong>High Distress Alert:</strong> Patient threshold exceeded ({(activePatient.score * 100).toFixed(0)}%). Trigger an intervention below.
            </div>
          </div>
        )}

        {/* Dynamic Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
            <div style={{ fontSize: '12px', color: '#6f817b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={14} color="#2f7d67" /> Distress Proxy Score
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px', color: '#17312b' }}>{(activePatient.score * 100).toFixed(0)}%</div>
          </div>
          <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
            <div style={{ fontSize: '12px', color: '#6f817b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Heart size={14} color="#d83b3b" /> Heart Rate
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px', color: '#17312b' }}>{activePatient.hr} BPM</div>
          </div>
          <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
            <div style={{ fontSize: '12px', color: '#6f817b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {activePatient.score > 0.6 ? <ShieldAlert size={14} color="#d83b3b" /> : <UserCheck size={14} color="#2f7d67" />} Grounding State
            </div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '8px', color: activePatient.score > 0.6 ? '#d83b3b' : '#226552' }}>
              {activePatient.score > 0.6 ? 'Action Recommended' : 'Passive Monitoring'}
            </div>
          </div>
        </div>

        {/* Direct Therapist Interventions Box */}
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <Zap size={18} color="#2f7d67" />
            <h3 style={{ margin: 0, fontSize: '14px', color: '#17312b' }}>Trigger Therapist Intervention</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <button
              onClick={() => setActiveModal({ type: 'audio_menu', title: 'Audio Grounding Options' })}
              style={{ padding: '12px', backgroundColor: '#dff1eb', border: '1px solid #2f7d67', color: '#226552', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 'bold' }}
            >
              <Volume2 size={16} /> Send Audio Grounding
            </button>

            <button
              onClick={() => setActiveModal({ type: 'breathing_menu', title: 'Guided Breathing Options' })}
              style={{ padding: '12px', backgroundColor: '#e9f1ff', border: '1px solid #28446e', color: '#28446e', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 'bold' }}
            >
              <Wind size={16} /> Start Guided Breathing
            </button>

            <button
              onClick={() => setActiveModal({ type: 'caregiver_card', title: 'Emergency Contact Card' })}
              style={{ padding: '12px', backgroundColor: '#ffecec', border: '1px solid #d83b3b', color: '#d83b3b', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 'bold' }}
            >
              <PhoneCall size={16} /> Contact Caregiver
            </button>
          </div>
        </div>

        {/* Real-Time Chart */}
        <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#17312b' }}>Real-Time Distress Signal Stream</h3>
          <div style={{ height: '180px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activePatient.trend.map((v, i) => ({ time: `T-${(activePatient.trend.length - i) * 2}s`, val: v }))}>
                <XAxis dataKey="time" stroke="#6f817b" fontSize={12} />
                <YAxis domain={[0, 1]} stroke="#6f817b" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#d9e5df', color: '#17312b' }} />
                <Line type="monotone" dataKey="val" stroke={activePatient.score > 0.6 ? '#d83b3b' : '#2f7d67'} strokeWidth={2} dot={{ fill: '#2f7d67' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* History & Notes Split View */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Intervention History */}
          <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <History size={16} color="#2f7d67" />
              <h3 style={{ margin: 0, fontSize: '14px', color: '#17312b' }}>Intervention History</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto' }}>
              {activePatient.history.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#6f817b' }}>No intervention history recorded.</div>
              ) : (
                activePatient.history.map((h) => (
                  <div key={h.id} style={{ backgroundColor: '#f8fbf8', border: '1px solid #d9e5df', padding: '10px', borderRadius: '12px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f817b', marginBottom: '4px' }}>
                      <span>{h.time}</span>
                      <span style={{ color: '#226552', fontWeight: 'bold' }}>{h.status}</span>
                    </div>
                    <div><strong>{h.type}:</strong> {h.outcome}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Caregiver Notes */}
          <div style={{ background: '#ffffff', padding: '16px', borderRadius: '18px', border: '1px solid #d9e5df', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <FileText size={16} color="#2f7d67" />
              <h3 style={{ margin: 0, fontSize: '14px', color: '#17312b' }}>Therapist / Caregiver Notes</h3>
            </div>
            
            <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input 
                type="text" 
                value={noteInput} 
                onChange={(e) => setNoteInput(e.target.value)} 
                placeholder="Add clinical observation..."
                style={{ flex: 1, backgroundColor: '#f8fbf8', border: '1px solid #d9e5df', borderRadius: '14px', padding: '8px 12px', color: '#17312b', fontSize: '12px' }}
              />
              <button type="submit" style={{ backgroundColor: '#2f7d67', border: 'none', borderRadius: '14px', padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <Send size={14} color="#ffffff" />
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '150px' }}>
              {activePatient.notes.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#6f817b' }}>No notes added yet.</div>
              ) : (
                activePatient.notes.map((n) => (
                  <div key={n.id} style={{ backgroundColor: '#f8fbf8', border: '1px solid #d9e5df', padding: '8px 10px', borderRadius: '12px', fontSize: '12px' }}>
                    <span style={{ color: '#6f817b', fontSize: '10px', display: 'block' }}>{n.time}</span>
                    <div>{n.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}