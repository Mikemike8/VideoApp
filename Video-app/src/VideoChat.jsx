import React, { useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export default function VideoChat() {
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const pcRef = useRef(null)
  const [callId, setCallId] = useState('')
  const [generatedId, setGeneratedId] = useState('')

  async function initPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    pcRef.current = pc

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]
    }
  }

  async function startWebcam() {
    await initPeerConnection()
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localVideoRef.current.srcObject = stream
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream))
  }

  async function createCall() {
    const { data: call } = await supabase.from('calls').insert({}).select().single()
    setGeneratedId(call.id)

    pcRef.current.onicecandidate = async (event) => {
      if (event.candidate) {
        await supabase.from('candidates').insert({
          call_id: call.id,
          type: 'offer',
          candidate: event.candidate.toJSON()
        })
      }
    }

    const offer = await pcRef.current.createOffer()
    await pcRef.current.setLocalDescription(offer)

    await supabase.from('calls').update({ offer_sdp: JSON.stringify(offer) }).eq('id', call.id)

    supabase
      .channel(`public:calls:id=eq.${call.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${call.id}` }, payload => {
        if (payload.new.answer_sdp) {
          pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(payload.new.answer_sdp)))
        }
      })
      .subscribe()

    supabase
      .channel(`public:candidates:call_id=eq.${call.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `call_id=eq.${call.id} AND type=eq.answer` }, payload => {
        pcRef.current.addIceCandidate(new RTCIceCandidate(payload.new.candidate))
      })
      .subscribe()
  }

  async function answerCall() {
    const { data: call } = await supabase.from('calls').select().eq('id', callId).single()
    await initPeerConnection()

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localVideoRef.current.srcObject = stream
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream))

    pcRef.current.onicecandidate = async (event) => {
      if (event.candidate) {
        await supabase.from('candidates').insert({ call_id: callId, type: 'answer', candidate: event.candidate.toJSON() })
      }
    }

    await pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(call.offer_sdp)))

    const answer = await pcRef.current.createAnswer()
    await pcRef.current.setLocalDescription(answer)

    await supabase.from('calls').update({ answer_sdp: JSON.stringify(answer) }).eq('id', callId)

    supabase
      .channel(`public:candidates:call_id=eq.${callId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `call_id=eq.${callId} AND type=eq.offer` }, payload => {
        pcRef.current.addIceCandidate(new RTCIceCandidate(payload.new.candidate))
      })
      .subscribe()
  }

  return (
   <div className="relative w-full h-screen bg-gray-900 flex items-center justify-center">
  {/* Caller Video */}
    <video
      ref={remoteVideoRef}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
    />

    {/* Your own video overlay */}
    <div className="absolute top-4 right-4 w-32 h-32 md:w-48 md:h-48 rounded-full overflow-hidden border-4 border-white shadow-lg">
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
    </div>

    {/* Controls */}
    <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4">
      <button
        onClick={startWebcam}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-full shadow-lg transition"
      >
        Start Webcam
      </button>
      <button
        onClick={createCall}
        className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-full shadow-lg transition"
      >
        Create Call
      </button>
      <button
        onClick={answerCall}
        className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-full shadow-lg transition"
      >
        Answer
      </button>
    </div>

    {/* Call ID input */}
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex gap-2">
      {generatedId && (
        <p className="text-white font-mono font-bold bg-black bg-opacity-50 p-2 rounded">
          Share this ID: {generatedId}
        </p>
      )}
      <input
        value={callId}
        onChange={e => setCallId(e.target.value)}
        placeholder="Enter Call ID"
        className="px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    </div>
  </div>

  )
}
