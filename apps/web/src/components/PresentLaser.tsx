import { useEffect, useRef, useState } from 'react';

type Ripple = { id: number; x: number; y: number };

export function PresentLaser({ active }: { active: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    if (!active) {
      setRipples([]);
      return;
    }

    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const trail: { x: number; y: number; t: number }[] = [];
    const pos = { x: 0, y: 0, ok: false };
    let w = 0;
    let h = 0;
    let raf = 0;
    let nextRipple = 0;

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const show = (x: number, y: number) => {
      pos.x = x;
      pos.y = y;
      pos.ok = true;
      root.style.transform = `translate(${x}px, ${y}px)`;
      root.classList.add('on');
    };

    const hide = () => {
      pos.ok = false;
      root.classList.remove('on');
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      show(e.clientX, e.clientY);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      show(e.clientX, e.clientY);
      const id = ++nextRipple;
      const x = e.clientX;
      const y = e.clientY;
      setRipples((list) => [...list.slice(-3), { id, x, y }]);
      window.setTimeout(() => {
        setRipples((list) => list.filter((item) => item.id !== id));
      }, 620);
    };

    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      hide();
    };

    const tick = (now: number) => {
      if (pos.ok) trail.push({ x: pos.x, y: pos.y, t: now });
      while (trail.length && now - trail[0].t > 120) trail.shift();
      ctx.clearRect(0, 0, w, h);
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          const fade = 1 - (now - b.t) / 120;
          ctx.strokeStyle = `rgba(255, 0, 40, ${fade})`;
          ctx.lineWidth = 2 + fade * 3;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255, 255, 255, ${fade})`;
          ctx.lineWidth = 1 + fade * 1.2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      raf = window.requestAnimationFrame(tick);
    };

    size();
    raf = window.requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', size);
    document.documentElement.addEventListener('mouseleave', onLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', size);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="present-laser-layer" aria-hidden>
      <canvas ref={canvasRef} className="present-laser-trail" />
      <div ref={rootRef} className="present-laser">
        <span className="present-laser-bloom" />
        <span className="present-laser-core" />
        <span className="present-laser-spark" />
      </div>
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="present-laser-pulse"
          style={{ left: ripple.x, top: ripple.y }}
        />
      ))}
    </div>
  );
}
