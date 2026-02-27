'use client';

import React, { useState, useEffect } from 'react';

const SCRAMBLE_CHARS = 'h&jR9%mJs0.L@#kW!xZ$qP2^dF8nT*vY3bG7cA+eU6';

export function ScrambleText({ text, className }: { text: string; className?: string }) {
  const target = text;
  const [chars, setChars] = useState<string[]>(() =>
    Array.from({ length: target.length }, () =>
      SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    )
  );
  const [phase, setPhase] = useState<'resolving' | 'shimmer' | 'dissolving'>('resolving');
  const [locked, setLocked] = useState<boolean[]>(new Array(target.length).fill(false));
  const [shimmerPos, setShimmerPos] = useState(-1);

  // Scramble unlocked characters
  useEffect(() => {
    const interval = setInterval(() => {
      setChars(prev =>
        prev.map((ch, i) =>
          locked[i] ? target[i] : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        )
      );
    }, 50);
    return () => clearInterval(interval);
  }, [locked, target]);

  // Phase: resolving — lock characters one at a time at random intervals
  useEffect(() => {
    if (phase !== 'resolving') return;
    const indices = Array.from({ length: target.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const timeouts: NodeJS.Timeout[] = [];
    indices.forEach((charIdx) => {
      const delay = 100 + Math.random() * 900;
      timeouts.push(setTimeout(() => {
        setLocked(prev => {
          const next = [...prev];
          next[charIdx] = true;
          return next;
        });
      }, delay));
    });
    const totalTime = 1100;
    timeouts.push(setTimeout(() => setPhase('shimmer'), totalTime));
    return () => timeouts.forEach(clearTimeout);
  }, [phase, target]);

  // Phase: shimmer — gold sweeps left to right, then dissolve
  useEffect(() => {
    if (phase !== 'shimmer') return;
    setShimmerPos(-1);
    let pos = -1;
    const sweepLen = target.length + 3;
    let sweep = 0;
    const interval = setInterval(() => {
      pos++;
      if (pos > sweepLen) {
        sweep++;
        if (sweep >= 3) {
          clearInterval(interval);
          setShimmerPos(-1);
          setTimeout(() => setPhase('dissolving'), 500);
          return;
        }
        pos = -1;
        setShimmerPos(-1);
        return;
      }
      setShimmerPos(pos);
    }, 125);
    return () => clearInterval(interval);
  }, [phase, target.length]);

  // Phase: dissolving — unlock characters one at a time then restart
  useEffect(() => {
    if (phase !== 'dissolving') return;
    const indices = Array.from({ length: target.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const timeouts: NodeJS.Timeout[] = [];
    indices.forEach((charIdx, order) => {
      const delay = 50 + order * (500 / target.length) + Math.random() * 100;
      timeouts.push(setTimeout(() => {
        setLocked(prev => {
          const next = [...prev];
          next[charIdx] = false;
          return next;
        });
      }, delay));
    });
    const totalTime = 50 + target.length * (500 / target.length) + 300;
    timeouts.push(setTimeout(() => {
      setLocked(new Array(target.length).fill(false));
      setPhase('resolving');
    }, totalTime));
    return () => timeouts.forEach(clearTimeout);
  }, [phase, target]);

  const getCharStyle = (i: number): React.CSSProperties => {
    if (phase === 'shimmer' && shimmerPos >= 0) {
      const dist = Math.abs(i - shimmerPos);
      if (dist <= 2) {
        const intensity = 1 - dist / 3;
        return {
          color: `rgba(235, 200, 120, ${0.7 + intensity * 0.3})`,
          textShadow: `0 0 ${6 * intensity}px rgba(235, 190, 80, ${0.6 * intensity})`,
        };
      }
    }
    if (locked[i]) {
      return { color: 'rgba(200, 175, 140, 0.8)' };
    }
    return { color: 'rgba(180, 155, 120, 0.5)' };
  };

  return (
    <span className={`text-xs font-mono tracking-wide select-none ${className || ''}`}>
      {chars.map((ch, i) => (
        <span key={i} style={getCharStyle(i)}>
          {ch}
        </span>
      ))}
    </span>
  );
}
