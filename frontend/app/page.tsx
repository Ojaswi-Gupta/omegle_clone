
"use client";
import { useEffect } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "../src/lib/firebase";
import ParticleNetwork from "../components/ParticleNetwork";

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
    username: process.env.NEXT_PUBLIC_TURN_USERNAME,
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL
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
  const [isLanding, setIsLanding] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
  if (isLanding) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden">
        <div className="landing-background">
          <ParticleNetwork isActive={isLoggingIn} />
        </div>
        <div className="z-10 flex flex-col items-center">
          <h1 className="relative euphoria-script-regular text-7xl md:text-9xl mb-12 text-white z-10">
            <span className="absolute inset-0 bg-black blur-xl scale-110 rounded-full -z-10"></span>
            <span className="relative z-10 flex">
              {"VibeChat".split("").map((letter, index) => (
                <span
                  key={index}
                  className="inline-block animate-wave-letter"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {letter}
                </span>
              ))}
            </span>
          </h1>
          <FingerprintLogin 
            onLogin={() => setIsLanding(false)} 
            onLoginStart={() => setIsLoggingIn(true)}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <ParticleNetwork isActive={false} />
      
      <h1 className="relative euphoria-script-regular text-5xl md:text-6xl mb-4 text-white z-10">
        <span className="absolute inset-0 bg-black blur-xl scale-125 rounded-full -z-10"></span>
        <span className="relative z-10">VibeChat</span>
      </h1>


      <div className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-gray-300 backdrop-blur-md mb-4 z-10">
        {status}
      </div>


      <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl z-10">


        {/* VIDEO CONTAINER */}
        <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl transition-all duration-300">

          {/* REMOTE VIDEO (MAIN) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover transition-all duration-300 ${!inCall ? "blur-sm scale-105" : ""
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
              {status === "Click Start to find a stranger" || status === "Call ended" ? (
                <span className="text-sm tracking-wide">Ready to connect</span>
              ) : (
                <>
                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span className="text-sm tracking-wide">{status}</span>
                </>
              )}
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
      <div className="flex flex-wrap justify-center gap-4 mt-6 z-10">

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

function FingerprintLogin({ onLogin, onLoginStart }: { onLogin: () => void, onLoginStart?: () => void }) {
  const [active, setActive] = useState(false);

  const handleClick = () => {
    if (active) return;
    setActive(true);
    if (onLoginStart) onLoginStart();
    setTimeout(() => {
      onLogin();
    }, 6000);
  };

  return (
    <div className={`fp-container ${active ? 'fp-active' : ''}`} onClick={handleClick}>
      <span className="fp-text">LOGIN</span>
      <svg className="fp-fingerprint fp-fingerprint-base" xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <g className="fp-fingerprint-out" fill="none" strokeWidth="2" strokeLinecap="round">
          <path className="fp-odd" d="m 25.117139,57.142857 c 0,0 -1.968558,-7.660465 -0.643619,-13.149003 1.324939,-5.488538 4.659682,-8.994751 4.659682,-8.994751" />
          <path className="fp-odd" d="m 31.925369,31.477584 c 0,0 2.153609,-2.934998 9.074971,-5.105078 6.921362,-2.17008 11.799844,-0.618718 11.799844,-0.618718" />
          <path className="fp-odd" d="m 57.131213,26.814448 c 0,0 5.127709,1.731228 9.899495,7.513009 4.771786,5.781781 4.772971,12.109204 4.772971,12.109204" />
          <path className="fp-odd" d="m 72.334009,50.76769 0.09597,2.298098 -0.09597,2.386485" />
          <path className="fp-even" d="m 27.849282,62.75 c 0,0 1.286086,-1.279223 1.25,-4.25 -0.03609,-2.970777 -1.606117,-7.675266 -0.625,-12.75 0.981117,-5.074734 4.5,-9.5 4.5,-9.5" />
          <path className="fp-even" d="m 36.224282,33.625 c 0,0 8.821171,-7.174484 19.3125,-2.8125 10.491329,4.361984 11.870558,14.952665 11.870558,14.952665" />
          <path className="fp-even" d="m 68.349282,49.75 c 0,0 0.500124,3.82939 0.5625,5.8125 0.06238,1.98311 -0.1875,5.9375 -0.1875,5.9375" />
          <path className="fp-odd" d="m 31.099282,65.625 c 0,0 1.764703,-4.224042 2,-7.375 0.235297,-3.150958 -1.943873,-9.276886 0.426777,-15.441942 2.370649,-6.165056 8.073223,-7.933058 8.073223,-7.933058" />
          <path className="fp-odd" d="m 45.849282,33.625 c 0,0 12.805566,-1.968622 17,9.9375 4.194434,11.906122 1.125,24.0625 1.125,24.0625" />
          <path className="fp-even" d="m 59.099282,70.25 c 0,0 0.870577,-2.956221 1.1875,-4.5625 0.316923,-1.606279 0.5625,-5.0625 0.5625,-5.0625" />
          <path className="fp-even" d="m 60.901059,56.286612 c 0,0 0.903689,-9.415996 -3.801777,-14.849112 -3.03125,-3.5 -7.329245,-4.723939 -11.867187,-3.8125 -5.523438,1.109375 -7.570313,5.75 -7.570313,5.75" />
          <path className="fp-even" d="m 34.072577,68.846248 c 0,0 2.274231,-4.165782 2.839205,-9.033748 0.443558,-3.821814 -0.49394,-5.649939 -0.714206,-8.05386 -0.220265,-2.403922 0.21421,-4.63364 0.21421,-4.63364" />
          <path className="fp-odd" d="m 37.774165,70.831845 c 0,0 2.692139,-6.147592 3.223034,-11.251208 0.530895,-5.103616 -2.18372,-7.95562 -0.153491,-13.647655 2.030229,-5.692035 8.108442,-4.538898 8.108442,-4.538898" />
          <path className="fp-odd" d="m 54.391174,71.715729 c 0,0 2.359472,-5.427681 2.519068,-16.175068 0.159595,-10.747388 -4.375223,-12.993087 -4.375223,-12.993087" />
          <path className="fp-even" d="m 49.474282,73.625 c 0,0 3.730297,-8.451831 3.577665,-16.493718 -0.152632,-8.041887 -0.364805,-11.869326 -4.765165,-11.756282 -4.400364,0.113044 -3.875,4.875 -3.875,4.875" />
          <path className="fp-even" d="m 41.132922,72.334447 c 0,0 2.49775,-5.267079 3.181981,-8.883029 0.68423,-3.61595 0.353553,-9.413359 0.353553,-9.413359" />
          <path className="fp-odd" d="m 45.161782,73.75 c 0,0 1.534894,-3.679847 2.40625,-6.53125 0.871356,-2.851403 1.28125,-7.15625 1.28125,-7.15625" />
          <path className="fp-odd" d="m 48.801947,56.125 c 0,0 0.234502,-1.809418 0.109835,-3.375 -0.124667,-1.565582 -0.5625,-3.1875 -0.5625,-3.1875" />
        </g>
      </svg>
      <svg className="fp-fingerprint fp-fingerprint-active" xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <g className="fp-fingerprint-out" fill="none" strokeWidth="2" strokeLinecap="round">
          <path className="fp-odd" d="m 25.117139,57.142857 c 0,0 -1.968558,-7.660465 -0.643619,-13.149003 1.324939,-5.488538 4.659682,-8.994751 4.659682,-8.994751" />
          <path className="fp-odd" d="m 31.925369,31.477584 c 0,0 2.153609,-2.934998 9.074971,-5.105078 6.921362,-2.17008 11.799844,-0.618718 11.799844,-0.618718" />
          <path className="fp-odd" d="m 57.131213,26.814448 c 0,0 5.127709,1.731228 9.899495,7.513009 4.771786,5.781781 4.772971,12.109204 4.772971,12.109204" />
          <path className="fp-odd" d="m 72.334009,50.76769 0.09597,2.298098 -0.09597,2.386485" />
          <path className="fp-even" d="m 27.849282,62.75 c 0,0 1.286086,-1.279223 1.25,-4.25 -0.03609,-2.970777 -1.606117,-7.675266 -0.625,-12.75 0.981117,-5.074734 4.5,-9.5 4.5,-9.5" />
          <path className="fp-even" d="m 36.224282,33.625 c 0,0 8.821171,-7.174484 19.3125,-2.8125 10.491329,4.361984 11.870558,14.952665 11.870558,14.952665" />
          <path className="fp-even" d="m 68.349282,49.75 c 0,0 0.500124,3.82939 0.5625,5.8125 0.06238,1.98311 -0.1875,5.9375 -0.1875,5.9375" />
          <path className="fp-odd" d="m 31.099282,65.625 c 0,0 1.764703,-4.224042 2,-7.375 0.235297,-3.150958 -1.943873,-9.276886 0.426777,-15.441942 2.370649,-6.165056 8.073223,-7.933058 8.073223,-7.933058" />
          <path className="fp-odd" d="m 45.849282,33.625 c 0,0 12.805566,-1.968622 17,9.9375 4.194434,11.906122 1.125,24.0625 1.125,24.0625" />
          <path className="fp-even" d="m 59.099282,70.25 c 0,0 0.870577,-2.956221 1.1875,-4.5625 0.316923,-1.606279 0.5625,-5.0625 0.5625,-5.0625" />
          <path className="fp-even" d="m 60.901059,56.286612 c 0,0 0.903689,-9.415996 -3.801777,-14.849112 -3.03125,-3.5 -7.329245,-4.723939 -11.867187,-3.8125 -5.523438,1.109375 -7.570313,5.75 -7.570313,5.75" />
          <path className="fp-even" d="m 34.072577,68.846248 c 0,0 2.274231,-4.165782 2.839205,-9.033748 0.443558,-3.821814 -0.49394,-5.649939 -0.714206,-8.05386 -0.220265,-2.403922 0.21421,-4.63364 0.21421,-4.63364" />
          <path className="fp-odd" d="m 37.774165,70.831845 c 0,0 2.692139,-6.147592 3.223034,-11.251208 0.530895,-5.103616 -2.18372,-7.95562 -0.153491,-13.647655 2.030229,-5.692035 8.108442,-4.538898 8.108442,-4.538898" />
          <path className="fp-odd" d="m 54.391174,71.715729 c 0,0 2.359472,-5.427681 2.519068,-16.175068 0.159595,-10.747388 -4.375223,-12.993087 -4.375223,-12.993087" />
          <path className="fp-even" d="m 49.474282,73.625 c 0,0 3.730297,-8.451831 3.577665,-16.493718 -0.152632,-8.041887 -0.364805,-11.869326 -4.765165,-11.756282 -4.400364,0.113044 -3.875,4.875 -3.875,4.875" />
          <path className="fp-even" d="m 41.132922,72.334447 c 0,0 2.49775,-5.267079 3.181981,-8.883029 0.68423,-3.61595 0.353553,-9.413359 0.353553,-9.413359" />
          <path className="fp-odd" d="m 45.161782,73.75 c 0,0 1.534894,-3.679847 2.40625,-6.53125 0.871356,-2.851403 1.28125,-7.15625 1.28125,-7.15625" />
          <path className="fp-odd" d="m 48.801947,56.125 c 0,0 0.234502,-1.809418 0.109835,-3.375 -0.124667,-1.565582 -0.5625,-3.1875 -0.5625,-3.1875" />
        </g>
      </svg>
      <svg className="fp-ok" xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path d="M34.912 50.75l10.89 10.125L67 36.75" fill="none" stroke="#fff" strokeWidth="6"/></svg>
    </div>
  );
}


