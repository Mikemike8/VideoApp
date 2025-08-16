import React, { useRef, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function VideoChat() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const [callId, setCallId] = useState('');
  const [generatedId, setGeneratedId] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function initPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add TURN server if needed
      ],
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE Connection State:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        setError('Connection failed. Please try restarting the call.');
      }
    };
  }

  async function startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach(track => pcRef.current?.addTrack(track, stream));
      setError('');
    } catch (err) {
      console.error('Cannot access webcam/mic:', err);
      setError('Cannot access webcam/mic. Ensure permissions are granted and use HTTPS.');
    }
  }

  async function setupSubscriptions(callId, type) {
    supabase.removeAllChannels();
    if (type === 'offer') {
      supabase
        .channel(`public:calls:id=eq.${callId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
          payload => {
            if (payload.new.answer_sdp && pcRef.current) {
              pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(payload.new.answer_sdp)));
            }
          }
        )
        .subscribe();
    }

    supabase
      .channel(`public:candidates:call_id=eq.${callId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'candidates', filter: `call_id=eq.${callId}` },
        payload => {
          if (payload.new.type !== type && pcRef.current) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(payload.new.candidate));
          }
        }
      )
      .subscribe();
  }

  async function createCall() {
    setIsLoading(true);
    try {
      const { data: call } = await supabase.from('calls').insert({}).select().single();
      setGeneratedId(call.id);
      await setupSubscriptions(call.id, 'offer');

      pcRef.current.onicecandidate = async (event) => {
        if (event.candidate) {
          await supabase.from('candidates').insert({
            call_id: call.id,
            type: 'offer',
            candidate: event.candidate.toJSON(),
          });
        }
      };

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      await supabase.from('calls').update({ offer_sdp: JSON.stringify(offer) }).eq('id', call.id);

      setError('');
    } catch (err) {
      console.error('Error creating call:', err);
      setError('Failed to create call. Check your Supabase connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function answerCall() {
    setIsLoading(true);
    try {
      if (!callId) throw new Error('Call ID is required');
      const { data: call } = await supabase.from('calls').select().eq('id', callId).single();
      if (!call) throw new Error('Call ID not found');

      await initPeerConnection();
      await setupSubscriptions(callId, 'answer');

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));

      pcRef.current.onicecandidate = async (event) => {
        if (event.candidate) {
          await supabase.from('candidates').insert({
            call_id: callId,
            type: 'answer',
            candidate: event.candidate.toJSON(),
          });
        }
      };

      await pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(call.offer_sdp)));

      const { data: candidates } = await supabase
        .from('candidates')
        .select()
        .eq('call_id', callId)
        .eq('type', 'offer');
      for (const candidate of candidates) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate.candidate));
      }

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      await supabase.from('calls').update({ answer_sdp: JSON.stringify(answer) }).eq('id', callId);

      setError('');
    } catch (err) {
      console.error('Cannot answer call:', err);
      setError(err.message || 'Failed to answer call. Check Call ID, permissions, and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    initPeerConnection();
    startWebcam();
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (localVideoRef.current?.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      supabase.removeAllChannels();
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-gray-900 flex items-center justify-center">
      <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <div className="absolute top-4 right-4 w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden border-2 border-white shadow-lg">
        <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      </div>
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-3 w-11/12 sm:w-auto">
        {error && <div className="bg-red-600 text-white p-2 rounded mb-2">{error}</div>}
        {isLoading && <div className="bg-yellow-600 text-white p-2 rounded mb-2">Connecting...</div>}
        {generatedId && (
          <div className="bg-black bg-opacity-70 text-white font-mono font-bold p-2 rounded flex items-center gap-2 w-full sm:w-auto justify-between">
            <span className="truncate">ID: {generatedId}</span>
            <button
              onClick={() => navigator.clipboard.writeText(generatedId)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            onClick={startWebcam}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-full shadow-lg w-full sm:w-auto"
            disabled={isLoading}
          >
            Start Webcam
          </button>
          <button
            onClick={createCall}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-full shadow-lg w-full sm:w-auto"
            disabled={isLoading}
          >
            Create Call
          </button>
          <button
            onClick={answerCall}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-full shadow-lg w-full sm:w-auto"
            disabled={isLoading}
          >
            Answer
          </button>
        </div>
        <input
          value={callId}
          onChange={e => setCallId(e.target.value)}
          placeholder="Enter Call ID"
          className="mt-2 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 w-full sm:w-auto"
          disabled={isLoading}
        />
      </div>
    </div>
  );
}