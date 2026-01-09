
"use client";
import { useEffect } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "../src/lib/firebase";

import { useRef, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  DocumentSnapshot,
  QuerySnapshot,
} from "firebase/firestore";
import { db } from "../src/lib/firebase";

type Role = "caller" | "callee";



const iceServers: RTCIceServer[] = [
  {
    urls: "stun:stun.relay.metered.ca:80"
  },
  {
    urls: [
      "turn:global.relay.metered.ca:80?transport=udp",
      "turns:global.relay.metered.ca:443?transport=tcp"
    ],
    username: "c34780a931b136ee92464ce3",
    credential: "QeT1XvSB+n3GnbZP"
  }
];


export default function Home() {

  useEffect(() => {
    if (auth.currentUser) return;
  
    signInAnonymously(auth)
      .then((cred) => {
        console.log("✅ Anonymous UID:", cred.user.uid);
      })
      .catch((err) => {
        console.error("❌ Auth error:", err);
      });
  }, []);
  

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const roleRef = useRef<Role | null>(null);

  const roomUnsubRef = useRef<(() => void) | null>(null);
  const callerCandUnsubRef = useRef<(() => void) | null>(null);
  const calleeCandUnsubRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState("Click Start to find a stranger");
  const [inCall, setInCall] = useState(false);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);

  // ------------------ MEDIA ------------------

  async function startCamera(): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera not supported or insecure (HTTP) connection.");
    }
  
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
  
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  
    localStreamRef.current = stream;
  
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  
    return stream; // ✅ ALWAYS returns MediaStream now
  }
  
  function toggleMute() {
    if (!localStreamRef.current) return;
  
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = isMuted; // flip
    });
  
    setIsMuted((prev) => !prev);
  }
  
  function toggleCamera() {
    if (!localStreamRef.current) return;
  
    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = !isCameraOn;
    });
  
    setIsCameraOn((prev) => !prev);
  }
  

  // ------------------ MATCHING ------------------
  async function findOrCreateMatch() {
    const waitingRef = collection(db, "waiting");
    const q = query(waitingRef, orderBy("createdAt"), limit(1));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const partner = snap.docs[0];
      await deleteDoc(doc(db, "waiting", partner.id));
      return { role: "callee" as Role, roomId: partner.id };
    } else {
      const newDoc = await addDoc(waitingRef, {
        createdAt: new Date(),
      });
      return { role: "caller" as Role, roomId: newDoc.id };
    }
  }

  // ------------------ PEER ------------------
  function createPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        cleanupCall();
      }
    };

    return pc;
  }

  // ------------------ START ------------------
 

  async function handleStart() {
    try {
      setStatus("Starting camera...");
      const stream = await startCamera(); // ✅ Now always MediaStream
  
      setStatus("Finding a stranger...");
      const match = await findOrCreateMatch();
  
      roleRef.current = match.role;
      roomIdRef.current = match.roomId;
  
      // setStatus(`Matched as ${match.role}`);
      setStatus(
        match.role === "caller"
          ? "Connecting you to a stranger…"
          : "A stranger joined!"
      );
      
      setInCall(true);
  
      const pc = createPeerConnection();
      pcRef.current = pc;
  
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  
      const roomRef = doc(db, "rooms", match.roomId);
  
      if (match.role === "caller") {
        await callerFlow(pc, roomRef);
      } else {
        await calleeFlow(pc, roomRef);
      }
    } catch (err) {
      console.error(err);
      setStatus("Camera not supported on this device or insecure connection.");
      alert("Camera access failed. Please use HTTPS (Vercel) or a supported browser.");
    }
  }
  

  // ------------------ CALLER ------------------
  async function callerFlow(pc: RTCPeerConnection, roomRef: any) {
    await setDoc(roomRef, { createdAt: new Date() });

    const callerCandidates = collection(roomRef, "callerCandidates");
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(callerCandidates, event.candidate.toJSON());
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await setDoc(roomRef, { offer });

   
    roomUnsubRef.current = onSnapshot(
      roomRef,
      async (snap: DocumentSnapshot) => {
        const data = snap.data() as any;
    
        if (data?.answer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          setStatus("Connected to stranger!");
        }
      }
    );
    



    const calleeCandidates = collection(roomRef, "calleeCandidates");
  
    calleeCandUnsubRef.current = onSnapshot(
      calleeCandidates,
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
          }
        });
      }
    );
    
  }

  // ------------------ CALLEE ------------------
  async function calleeFlow(pc: RTCPeerConnection, roomRef: any) {
    const calleeCandidates = collection(roomRef, "calleeCandidates");
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(calleeCandidates, event.candidate.toJSON());
      }
    };


    const roomSnap = await getDoc(roomRef);
    const data = roomSnap.data() as any;

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );


    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await updateDoc(roomRef, { answer });

    setStatus("Connected to stranger!");

    const callerCandidates = collection(roomRef, "callerCandidates");
   
    callerCandUnsubRef.current = onSnapshot(
      callerCandidates,
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
          }
        });
      }
    );
    
  }

  // ------------------ CLEANUP ------------------
  function cleanupCall() {
    setInCall(false);
    setStatus("Call ended");

    roomUnsubRef.current?.();
    callerCandUnsubRef.current?.();
    calleeCandUnsubRef.current?.();

    pcRef.current?.close();
    pcRef.current = null;

    if (remoteVideoRef.current) {
      const stream = remoteVideoRef.current.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      remoteVideoRef.current.srcObject = null;
    }
  }

  function handleEnd() {
    cleanupCall();
  }

  async function handleNext() {
    cleanupCall();                    
    setStatus("Finding a new stranger...");
    await handleStart();              
  }
  
  // ------------------ UI ------------------
  return (
    <main className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">

      <h1 className="text-3xl font-bold tracking-tight mb-4">Mini Omegle</h1>


      <div className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-gray-300 backdrop-blur-md mb-4">
        {status}
      </div>


      <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">


{/* VIDEO CONTAINER */}
<div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl transition-all duration-300">

  {/* REMOTE VIDEO (MAIN) */}
<video
  ref={remoteVideoRef}
  autoPlay
  playsInline
  className={`w-full h-full object-cover transition-all duration-300 ${
    !inCall ? "blur-sm scale-105" : ""
  }`}
/>

<button
  onClick={() => remoteVideoRef.current?.requestFullscreen()}
  className="absolute top-4 right-4 z-10 bg-black/60 hover:bg-black/80 text-white px-3 py-2 rounded-lg text-sm backdrop-blur-md transition"
>
  ⛶
</button>

<button
  onClick={toggleMute}
  title={isMuted ? "Unmute" : "Mute"}
  className="absolute top-4 left-4 z-10 bg-black/60 hover:bg-black/80 text-white w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition"
>
  {isMuted ? "🔇" : "🎤"}
</button>

<button
  onClick={toggleCamera}
  title={isCameraOn ? "Turn camera off" : "Turn camera on"}
  className="absolute top-4 left-16 z-10 bg-black/60 hover:bg-black/80 text-white w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition"
>
  {isCameraOn ? "🎥" : "📵"}
</button>


  {/* WAITING OVERLAY */}
  {!inCall && (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-3 bg-black/40">
      <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      <span className="text-sm tracking-wide">Waiting for a stranger…</span>
    </div>
  )}

  {/* LOCAL VIDEO (FLOATING) */}
  <div className="absolute bottom-4 right-4 w-40 h-28 md:w-48 md:h-32 rounded-xl overflow-hidden border border-white/20 shadow-lg transition-all duration-300 hover:scale-105">
    <video
      ref={localVideoRef}
      autoPlay
      muted
      playsInline
      className="w-full h-full object-cover"
    />
    {!isCameraOn && (
  <div className="absolute inset-0 flex items-center justify-center bg-black text-gray-400 text-sm">
    Camera Off
  </div>
)}

  </div>

</div>


</div>

     

{/* <div className="flex gap-5 mt-6"> */}
<div className="flex flex-wrap justify-center gap-4 mt-6">

<button
  onClick={handleStart}
  disabled={inCall}
  className="px-6 py-2 rounded-full bg-green-600 hover:bg-green-500 transition disabled:bg-gray-700"
>
  ▶ Start
</button>

<button
  onClick={handleNext}
  disabled={!inCall}
  className="px-6 py-2 rounded-full bg-yellow-500 hover:bg-yellow-400 transition disabled:bg-gray-700"
>
  ⏭ Next
</button>

<button
  onClick={handleEnd}
  disabled={!inCall}
  className="px-6 py-2 rounded-full bg-red-600 hover:bg-red-500 transition disabled:bg-gray-700"
>
  ⛔ End
</button>

</div>

    </main>
  );
}


