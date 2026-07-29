"use client";

import React, { useEffect, useRef } from "react";

export default function ParticleNetwork({ isActive = false }: { isActive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;
    
    interface Ripple {
      radius: number;
      speed: number;
      alpha: number;
    }
    let ripples: Ripple[] = [];
    let transitionState = 1; // 1 = waves, 0 = ripples

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      
      const isLoggingIn = isActiveRef.current;

      // Smooth transition between waves and ripples
      if (isLoggingIn) {
        transitionState = Math.max(0, transitionState - 0.02);
      } else {
        transitionState = Math.min(1, transitionState + 0.02);
      }

      // Ambient state (flowing waves) removed as requested.
      // The background will remain blank until login is clicked.

      // Draw expanding circles (active login state)
      if (transitionState < 1) {
        if (isLoggingIn && time % 24 === 0) { // Emit a new ripple periodically
          ripples.push({ radius: 0, speed: 6 + Math.random() * 4, alpha: 1 });
        }

        ctx.lineWidth = 2;
        // The fingerprint button actual center
        let btnX = cx;
        let btnY = cy + 50;
        const btn = document.querySelector('.fp-container');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          btnX = rect.left + rect.width / 2;
          btnY = rect.top + rect.height / 2;
        }

        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.radius += r.speed;
          r.alpha -= 0.006; // fade out slowly

          if (r.alpha <= 0) {
            ripples.splice(i, 1);
            continue;
          }

          ctx.beginPath();
          ctx.arc(btnX, btnY, r.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${r.alpha * 0.5 * (1 - transitionState)})`;
          ctx.stroke();
        }
      }

      time += 16; // approx 16ms per frame
      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", resize);
    resize();
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
      style={{ background: "transparent" }}
    />
  );
}
