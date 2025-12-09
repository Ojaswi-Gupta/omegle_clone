// "use client";

// import {
//   collection,
//   addDoc,
//   getDocs,
//   deleteDoc,
//   query,
//   orderBy,
//   limit,
//   doc,
// } from "firebase/firestore";
// // import { db } from "@/lib/firebase";
// import { db } from "../src/lib/firebase";


// import { useRef, useState } from "react";

// export default function Home() {
//   const localVideoRef = useRef<HTMLVideoElement | null>(null);
//   const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

//   const [status, setStatus] = useState("Click Start to find a stranger");
//   const [inCall, setInCall] = useState(false);

//   const localStreamRef = useRef<MediaStream | null>(null);


//   async function findOrCreateMatch() {
//     const waitingRef = collection(db, "waiting");
  
//     const q = query(waitingRef, orderBy("createdAt"), limit(1));
//     const snap = await getDocs(q);
  
//     if (!snap.empty) {
//       const partner = snap.docs[0];
//       await deleteDoc(doc(db, "waiting", partner.id));
//       return { role: "callee", roomId: partner.id };
//     } else {
//       const newDoc = await addDoc(waitingRef, {
//         createdAt: new Date(),
//       });
//       return { role: "caller", roomId: newDoc.id };
//     }
//   }
  


//   async function startCamera() {
//     if (localStreamRef.current) return localStreamRef.current;

//     const stream = await navigator.mediaDevices.getUserMedia({
//       video: true,
//       audio: true,
//     });

//     localStreamRef.current = stream;
//     if (localVideoRef.current) {
//       localVideoRef.current.srcObject = stream;
//     }

//     return stream;
//   }

//   // async function handleStart() {
//   //   setStatus("Camera starting...");
//   //   await startCamera();
//   //   setStatus("Camera ready. Stranger matching will be added next.");
//   //   setInCall(true);
//   // }
//   async function handleStart() {
//     setStatus("Starting camera...");
//     await startCamera();
  
//     setStatus("Finding a stranger...");
//     const match = await findOrCreateMatch();
  
//     setStatus(`Matched as ${match.role}. Room: ${match.roomId}`);
//     setInCall(true);
//   }
  

//   function handleEnd() {
//     setInCall(false);
//     setStatus("Call ended");

//     if (localStreamRef.current) {
//       localStreamRef.current.getTracks().forEach((t) => t.stop());
//       localStreamRef.current = null;
//     }

//     if (localVideoRef.current) localVideoRef.current.srcObject = null;
//     if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
//   }

//   return (
//     <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
//       <h1 className="text-3xl font-bold">Mini Omegle</h1>
//       <p className="text-gray-400 text-sm text-center">{status}</p>

//       <div className="flex flex-col md:flex-row gap-4">
//         <div className="flex flex-col items-center gap-2">
//           <span className="text-xs text-gray-400">You</span>
//           <video
//             ref={localVideoRef}
//             autoPlay
//             muted
//             playsInline
//             className="w-64 h-48 bg-gray-800 rounded-xl"
//           />
//         </div>

//         <div className="flex flex-col items-center gap-2">
//           <span className="text-xs text-gray-400">Stranger</span>
//           <video
//             ref={remoteVideoRef}
//             autoPlay
//             playsInline
//             className="w-64 h-48 bg-gray-800 rounded-xl"
//           />
//         </div>
//       </div>

//       <div className="flex gap-3 mt-4">
//         <button
//           onClick={handleStart}
//           disabled={inCall}
//           className="px-4 py-2 bg-green-600 rounded disabled:bg-gray-700"
//         >
//           Start
//         </button>

//         <button
//           onClick={handleEnd}
//           disabled={!inCall}
//           className="px-4 py-2 bg-red-600 rounded disabled:bg-gray-700"
//         >
//           End
//         </button>
//       </div>
//     </main>
//   );
// }



"use client";

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
  { urls: "stun:stun.l.google.com:19302" },
];

export default function Home() {
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

  // ------------------ MEDIA ------------------
  async function startCamera() {
    if (localStreamRef.current) return localStreamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    return stream;
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
    setStatus("Starting camera...");
    const stream = await startCamera();

    setStatus("Finding a stranger...");
    const match = await findOrCreateMatch();

    roleRef.current = match.role;
    roomIdRef.current = match.roomId;

    setStatus(`Matched as ${match.role}`);
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

    // roomUnsubRef.current = onSnapshot(roomRef, async (snap) => {
    //   const data = snap.data();
    //   if (data?.answer && !pc.currentRemoteDescription) {
    //     await pc.setRemoteDescription(
    //       new RTCSessionDescription(data.answer)
    //     );
    //     setStatus("Connected to stranger!");
    //   }
    // });
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
    // calleeCandUnsubRef.current = onSnapshot(calleeCandidates, (snap) => {
    //   snap.docChanges().forEach((change) => {
    //     if (change.type === "added") {
    //       pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
    //     }
    //   });
    // });
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

    // const roomSnap = await getDoc(roomRef);
    // const data = roomSnap.data();

    // await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
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
    // callerCandUnsubRef.current = onSnapshot(callerCandidates, (snap) => {
    //   snap.docChanges().forEach((change) => {
    //     if (change.type === "added") {
    //       pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
    //     }
    //   });
    // });
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
    cleanupCall();                     // End current call
    setStatus("Finding a new stranger...");
    await handleStart();               // Start a new match
  }
  
  // ------------------ UI ------------------
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-3xl font-bold">Mini Omegle</h1>
      <p className="text-gray-400 text-sm text-center">{status}</p>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-gray-400">You</span>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-64 h-48 bg-gray-800 rounded-xl"
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-gray-400">Stranger</span>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-64 h-48 bg-gray-800 rounded-xl"
          />
        </div>
      </div>

      {/* <div className="flex gap-3 mt-4">
        <button
          onClick={handleStart}
          disabled={inCall}
          className="px-4 py-2 bg-green-600 rounded disabled:bg-gray-700"
        >
          Start
        </button>

        <button
          onClick={handleEnd}
          disabled={!inCall}
          className="px-4 py-2 bg-red-600 rounded disabled:bg-gray-700"
        >
          End
        </button>
      </div> */}

<div className="flex gap-3 mt-4">
  <button
    onClick={handleStart}
    disabled={inCall}
    className="px-4 py-2 bg-green-600 rounded disabled:bg-gray-700"
  >
    Start
  </button>

  <button
    onClick={handleNext}
    disabled={!inCall}
    className="px-4 py-2 bg-blue-600 rounded disabled:bg-gray-700"
  >
    Next
  </button>

  <button
    onClick={handleEnd}
    disabled={!inCall}
    className="px-4 py-2 bg-red-600 rounded disabled:bg-gray-700"
  >
    End
  </button>
</div>

    </main>
  );
}
