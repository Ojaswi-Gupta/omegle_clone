"use client";

import { useRef, useState } from "react";

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState("Click Start to turn on your camera");

  async function handleStartCamera() {
    try {
      setStatus("Requesting camera & microphone...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setStatus("Camera is live ✅");
    } catch (err) {
      console.error(err);
      setStatus("Permission denied or no camera found ❌");
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-3xl font-bold">Mini Omegle — Webcam Test</h1>
      <p className="text-gray-400 text-sm">{status}</p>

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="w-80 h-60 bg-gray-800 rounded-xl"
      />

      <button
        onClick={handleStartCamera}
        className="px-6 py-2 bg-green-600 rounded-xl hover:bg-green-700"
      >
        Start Camera
      </button>
    </div>
  );
}
